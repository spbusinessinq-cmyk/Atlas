import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  casesTable,
  entitiesTable,
  documentsTable,
  timelineEntriesTable,
  eventsTable,
  notesTable,
  relationshipsTable,
  moneyFlowsTable,
  entityMentionsTable,
  financialSignalsTable,
} from "@workspace/db/schema";
import { eq, and, or, sql, ilike, inArray } from "drizzle-orm";
import { logEvent } from "../lib/log-event";
import {
  extractEntities,
  extractTimelineEvents,
  extractFinancialSignals,
  normalizeEntityName,
  classifySeedIntent,
  INSTITUTION_PATTERN,
  type SeedIntent,
} from "../lib/entity-extractor";
import { cleanRawText, WRAPPER_ENTITY_BLOCKLIST } from "./web_ingest";
import { compileCaseBrief, saveCaseBrief, loadCaseBrief } from "../lib/case-compiler";

const router: IRouter = Router();

router.get("/cases", async (_req, res) => {
  const cases = await db.select().from(casesTable).orderBy(casesTable.createdAt);

  // Aggregate counts for all cases in 4 queries (not N+1)
  const [entityCounts, docCounts, timelineCounts, relCounts] = await Promise.all([
    db.select({ caseId: entitiesTable.caseId, count: sql<number>`cast(count(*) as int)` })
      .from(entitiesTable).groupBy(entitiesTable.caseId),
    db.select({ caseId: documentsTable.caseId, count: sql<number>`cast(count(*) as int)` })
      .from(documentsTable).groupBy(documentsTable.caseId),
    db.select({ caseId: timelineEntriesTable.caseId, count: sql<number>`cast(count(*) as int)` })
      .from(timelineEntriesTable).groupBy(timelineEntriesTable.caseId),
    db.select({ caseId: relationshipsTable.caseId, count: sql<number>`cast(count(*) as int)` })
      .from(relationshipsTable).groupBy(relationshipsTable.caseId),
  ]);

  const toMap = (rows: { caseId: number | null; count: number }[]) =>
    Object.fromEntries(rows.filter(r => r.caseId != null).map(r => [r.caseId!, r.count]));

  const entityMap = toMap(entityCounts);
  const docMap = toMap(docCounts);
  const timelineMap = toMap(timelineCounts);
  const relMap = toMap(relCounts);

  res.json(cases.map(c => formatCase(c, entityMap[c.id], docMap[c.id], timelineMap[c.id], relMap[c.id])));
});

router.get("/cases/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const rows = await db.select().from(casesTable).where(eq(casesTable.id, id));
  if (!rows.length) return res.status(404).json({ error: "Not found" });
  res.json(formatCase(rows[0]));
});

router.get("/cases/:id/summary", async (req, res) => {
  const id = parseInt(req.params.id);
  const rows = await db.select().from(casesTable).where(eq(casesTable.id, id));
  if (!rows.length) return res.status(404).json({ error: "Not found" });

  const [entities, documents, timeline, events, notes, allRelationships, moneyFlows, pendingMentionsRows, financialSignals] =
    await Promise.all([
      db.select().from(entitiesTable).where(eq(entitiesTable.caseId, id)),
      db.select().from(documentsTable).where(eq(documentsTable.caseId, id)),
      db.select().from(timelineEntriesTable).where(eq(timelineEntriesTable.caseId, id)),
      db.select().from(eventsTable).where(eq(eventsTable.caseId, id)),
      db.select().from(notesTable).where(eq(notesTable.caseId, id)),
      db.select().from(relationshipsTable).where(eq(relationshipsTable.caseId, id)),
      db.select().from(moneyFlowsTable).where(eq(moneyFlowsTable.caseId, id)),
      db.select().from(entityMentionsTable).where(
        and(eq(entityMentionsTable.caseId, id), eq(entityMentionsTable.status, "pending"))
      ),
      db.select().from(financialSignalsTable).where(eq(financialSignalsTable.caseId, id)),
    ]);

  const entityIds = entities.map((e) => e.id);
  const entityMap = Object.fromEntries(entities.map((e) => [e.id, e.name]));

  const relationships = allRelationships.filter(
    (r) => entityIds.includes(r.entityAId) || entityIds.includes(r.entityBId)
  );

  res.json({
    case: formatCase(rows[0], entities.length, documents.length, timeline.length, relationships.length),
    entities: entities.map(formatEntity),
    documents: documents.map(formatDocument),
    timeline: timeline.map((t) => formatTimeline(t, entityMap)),
    events: events.map(formatEvent),
    notes: notes.map(formatNote),
    relationships: relationships.map((r) => formatRelationship(r, entityMap)),
    moneyFlows: moneyFlows.map((m) => formatMoneyFlow(m, entityMap)),
    financialSignals: financialSignals.map(formatFinancialSignal),
    pendingMentions: pendingMentionsRows.length,
  });
});

router.post("/cases", async (req, res) => {
  const { title, description, status, tags } = req.body;
  const rows = await db
    .insert(casesTable)
    .values({ title, description, status: status || "open", tags: tags || [] })
    .returning();
  res.status(201).json(formatCase(rows[0]));
});

router.put("/cases/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const { title, description, status, tags } = req.body;
  const rows = await db
    .update(casesTable)
    .set({ title, description, status, tags, updatedAt: new Date() })
    .where(eq(casesTable.id, id))
    .returning();
  if (!rows.length) return res.status(404).json({ error: "Not found" });
  res.json(formatCase(rows[0]));
});

router.delete("/cases/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  await db.delete(casesTable).where(eq(casesTable.id, id));
  res.status(204).send();
});

// ── Remove entity from case (not globally) ─────────────────────────────────
router.delete("/cases/:caseId/entities/:entityId", async (req, res) => {
  const caseId = parseInt(req.params.caseId);
  const entityId = parseInt(req.params.entityId);

  const rows = await db.select().from(entitiesTable)
    .where(and(eq(entitiesTable.id, entityId), eq(entitiesTable.caseId, caseId)));
  if (!rows.length) return res.status(404).json({ error: "Entity not found in this case" });
  const entity = rows[0];

  // Delete relationships involving this entity in this case
  await db.delete(relationshipsTable).where(
    and(
      eq(relationshipsTable.caseId, caseId),
      or(eq(relationshipsTable.entityAId, entityId), eq(relationshipsTable.entityBId, entityId))
    )
  );

  // Reject all pending mentions with this entity name in this case
  await db.update(entityMentionsTable)
    .set({ status: "rejected" })
    .where(and(
      eq(entityMentionsTable.caseId, caseId),
      ilike(entityMentionsTable.entityName, entity.name),
      eq(entityMentionsTable.status, "pending")
    ));

  await db.delete(entitiesTable).where(eq(entitiesTable.id, entityId));

  await logEvent(
    "entity_removed_from_case",
    `Entity removed from case: "${entity.name}" [${entity.type.replace(/_/g, " ").toUpperCase()}]`,
    { caseId, entityId }
  );

  res.status(204).send();
});

// ── Reject all pending mentions for an entity name in a case ───────────────
router.post("/cases/:caseId/entities/:entityId/reject-mentions", async (req, res) => {
  const caseId = parseInt(req.params.caseId);
  const entityId = parseInt(req.params.entityId);

  const entityRows = await db.select().from(entitiesTable).where(eq(entitiesTable.id, entityId));
  if (!entityRows.length) return res.status(404).json({ error: "Entity not found" });
  const entity = entityRows[0];

  const result = await db.update(entityMentionsTable)
    .set({ status: "rejected" })
    .where(and(
      eq(entityMentionsTable.caseId, caseId),
      ilike(entityMentionsTable.entityName, entity.name),
      eq(entityMentionsTable.status, "pending")
    ))
    .returning();

  await logEvent(
    "pending_mentions_cleared",
    `Pending mentions for "${entity.name}" rejected in case ${caseId} (${result.length} mentions)`,
    { caseId, entityId }
  );

  res.json({ rejected: result.length });
});

// ── Purge failed / wrapper documents from a case ───────────────────────────
router.delete("/cases/:caseId/documents/purge", async (req, res) => {
  const caseId = parseInt(req.params.caseId);
  const type = (req.query.type as string) || "all-failed";

  const docs = await db.select().from(documentsTable).where(eq(documentsTable.caseId, caseId));

  let toDelete: number[];
  if (type === "failed") {
    toDelete = docs.filter(d => d.rawText?.includes("[FETCH_FAILED]")).map(d => d.id);
  } else if (type === "wrapper") {
    toDelete = docs.filter(d => d.rawText?.includes("[WRAPPER_BLOCKED]")).map(d => d.id);
  } else {
    // all-failed: fetch_failed + wrapper + diag status=failed with no ok/partial
    toDelete = docs.filter(d => {
      const rt = d.rawText || "";
      return rt.includes("[FETCH_FAILED]") || rt.includes("[WRAPPER_BLOCKED]") ||
        (rt.includes("status=failed") && !rt.includes("status=ok") && !rt.includes("status=partial"));
    }).map(d => d.id);
  }

  for (const docId of toDelete) {
    await db.delete(entityMentionsTable).where(eq(entityMentionsTable.documentId, docId));
    await db.delete(documentsTable).where(eq(documentsTable.id, docId));
  }

  if (toDelete.length > 0) {
    await logEvent(
      "failed_docs_purged",
      `Purged ${toDelete.length} ${type} document(s) from case ${caseId}`,
      { caseId }
    );
  }

  res.json({ purged: toDelete.length });
});

// ── Reject all pending entity mentions in a case ───────────────────────────
router.delete("/cases/:caseId/mentions/pending", async (req, res) => {
  const caseId = parseInt(req.params.caseId);

  const result = await db.update(entityMentionsTable)
    .set({ status: "rejected" })
    .where(and(
      eq(entityMentionsTable.caseId, caseId),
      eq(entityMentionsTable.status, "pending")
    ))
    .returning();

  await logEvent(
    "pending_mentions_cleared",
    `All pending mentions rejected in case ${caseId} (${result.length} signals)`,
    { caseId }
  );

  res.json({ rejected: result.length });
});

// ── Bulk-reject pending mentions with filter criteria ─────────────────────
router.post("/cases/:caseId/mentions/bulk-reject", async (req, res) => {
  const caseId = parseInt(req.params.caseId);
  const { type } = req.body as { type: string };

  const pending = await db.select().from(entityMentionsTable).where(
    and(eq(entityMentionsTable.caseId, caseId), eq(entityMentionsTable.status, "pending"))
  );

  let toReject: number[] = [];
  let toHold: number[] = [];

  if (type === "low-confidence") {
    toReject = pending.filter(m => (m.confidence ?? 1) < 0.60).map(m => m.id);
  } else if (type === "single-word-person") {
    toReject = pending.filter(m => m.entityType === "person" && !m.entityName.includes(" ")).map(m => m.id);
  } else if (type === "all-pending") {
    toReject = pending.map(m => m.id);
  } else if (type === "off-topic") {
    // Reject mentions where admission context encodes t=OFF_TOPIC
    toReject = pending.filter(m => {
      const ctx = m.context ?? "";
      return /\[A:r=[^|]+\|t=OFF_TOPIC/.test(ctx);
    }).map(m => m.id);
  } else if (type === "junk") {
    // Reject mentions flagged as BLOCKLIST or BOILERPLATE in admission context
    toReject = pending.filter(m => {
      const ctx = m.context ?? "";
      return /BLOCKLIST|BOILERPLATE/i.test(ctx) ||
        // Also catch known junk entity patterns: all-caps 2-3 char tokens, pure numbers, URLs
        /^[A-Z]{1,3}$/.test(m.entityName.trim()) ||
        /^\d+$/.test(m.entityName.trim()) ||
        /https?:\/\//.test(m.entityName);
    }).map(m => m.id);
  } else if (type === "low-role") {
    // Set to "held" (not rejected) — unknown role, needs analyst review
    toHold = pending.filter(m => {
      const ctx = m.context ?? "";
      return /\[A:r=UNKNOWN/.test(ctx);
    }).map(m => m.id);
  } else if (type === "artifact") {
    // Reject mentions from sidebar/footer/nav zones (ZONE_REJECT, ARTIFACT, NAV_RESIDUE, CROSS_STORY)
    toReject = pending.filter(m => {
      const ctx = m.context ?? "";
      const nameL = m.entityName.toLowerCase();
      // Zone-based: sidebar, footer, related
      const zoneSidebar = /\|z=(sidebar|footer|related|boilerplate)\b/.test(ctx);
      // Name looks like a nav artifact
      const navPrefix = /^(next|more|watch|listen|read|share|top|latest|live|breaking|related)\s/i.test(m.entityName);
      // Short all-caps that look like UI chrome
      const uiChrome = /^[A-Z]{2,6}$/.test(m.entityName.trim()) && m.entityName.length < 7;
      return zoneSidebar || navPrefix || uiChrome;
    }).map(m => m.id);
  } else if (type === "nav-boilerplate") {
    // Reject navigation/share-rail fragments and boilerplate UI text
    toReject = pending.filter(m => {
      const ctx = m.context ?? "";
      const nameL = m.entityName.toLowerCase();
      // Context contains share/nav keywords
      const navCtx = /\b(share|email|subscribe|sign in|log in|newsletter|cookie|advertisement|sponsored|copy link|print article|read more|more stories|top stories)\b/i.test(ctx);
      // Entity is only from tail/boilerplate zone
      const tailZone = /\|z=tail\b/.test(ctx) || /\|z=boilerplate\b/.test(ctx);
      // Name is very short generic word
      const genericShort = nameL.length < 8 && /^(share|email|menu|search|close|back|next|more|open|save|edit|view|load|clear|reset|submit|cancel|follow|donate)$/.test(nameL);
      return navCtx || genericShort || (tailZone && (m.confidence ?? 1) < 0.60);
    }).map(m => m.id);
  }

  if (toReject.length > 0) {
    await db.update(entityMentionsTable)
      .set({ status: "rejected" })
      .where(inArray(entityMentionsTable.id, toReject));
  }
  if (toHold.length > 0) {
    await db.update(entityMentionsTable)
      .set({ status: "held" })
      .where(inArray(entityMentionsTable.id, toHold));
  }

  const total = toReject.length + toHold.length;
  await logEvent(
    "pending_mentions_cleared",
    `Bulk action (${type}): rejected ${toReject.length}, held ${toHold.length} pending mentions in case ${caseId}`,
    { caseId }
  );

  res.json({ rejected: toReject.length, held: toHold.length, total });
});

// ── Bulk-approve role-bearing high-confidence pending mentions ─────────────
router.post("/cases/:caseId/mentions/bulk-approve", async (req, res) => {
  const caseId = parseInt(req.params.caseId);
  const { type } = req.body as { type: string };

  const pending = await db.select().from(entityMentionsTable).where(
    and(eq(entityMentionsTable.caseId, caseId), eq(entityMentionsTable.status, "pending"))
  );

  let toApprove: number[] = [];

  if (type === "role-bearing") {
    // Promote mentions that have a real role (not UNKNOWN) and confidence ≥ 0.72
    toApprove = pending.filter(m => {
      const ctx = m.context ?? "";
      const roleMatch = ctx.match(/\[A:r=([^|]+)\|/);
      const role = roleMatch ? roleMatch[1] : "UNKNOWN";
      const conf = m.confidence ?? 0;
      return role !== "UNKNOWN" && conf >= 0.72;
    }).map(m => m.id);
  } else if (type === "title-lead-highconf") {
    // Promote mentions from title/dek/lead zone with high confidence and real role
    toApprove = pending.filter(m => {
      const ctx = m.context ?? "";
      const zoneMatch = ctx.match(/\|z=([^\]]+)/);
      const zone = zoneMatch ? zoneMatch[1] : "";
      const inTitleDekLead = zone === "title" || zone === "dek" || zone === "lead";
      const roleMatch = ctx.match(/\[A:r=([^|]+)\|/);
      const role = roleMatch ? roleMatch[1] : "UNKNOWN";
      const topicMatch = ctx.match(/\|t=([^|]+)\|/);
      const topic = topicMatch ? topicMatch[1] : "LOW";
      const conf = m.confidence ?? 0;
      return inTitleDekLead && role !== "UNKNOWN" && (topic === "HIGH" || topic === "MEDIUM") && conf >= 0.68;
    }).map(m => m.id);
  }

  if (toApprove.length > 0) {
    await db.update(entityMentionsTable)
      .set({ status: "approved" })
      .where(inArray(entityMentionsTable.id, toApprove));
  }

  await logEvent(
    "pending_mentions_promoted",
    `Bulk promoted ${toApprove.length} role-bearing mentions (type: ${type}) in case ${caseId}`,
    { caseId }
  );

  res.json({ approved: toApprove.length });
});

// ── Auto-triage: intelligent automatic triage of pending mentions ───────────
// POST /api/cases/:caseId/mentions/auto-triage
// Classifies all pending mentions automatically:
// - auto-promote: clearly anchor-aligned, role-bearing, high confidence
// - auto-reject:  obviously junk (noise, off-topic, low-confidence bleed)
// - auto-hold:    ambiguous middle (needs analyst review)
// - keep pending: edge cases requiring full analyst attention
// Celebrity names that should be auto-rejected in non-entertainment mentions
const CELEB_AUTO_REJECT_RE = /\b(Taylor Swift|Beyoncé|Beyonce|Kim Kardashian|Kanye West|LeBron James|Tom Brady|Drake|Rihanna|Ariana Grande|Justin Bieber|Selena Gomez|Lady Gaga|Cardi B|Nicki Minaj|Dua Lipa|Billie Eilish|Olivia Rodrigo|Harry Styles|Kylie Jenner|Kris Jenner|Logan Paul|Jake Paul|MrBeast|Cristiano Ronaldo|Lionel Messi|Patrick Mahomes|Joe Rogan|Elon Musk|Jeff Bezos|Mark Zuckerberg|Tim Cook|Oprah Winfrey|Ellen DeGeneres|Jimmy Fallon|Stephen Colbert|Trevor Noah|Gordon Ramsay|Ryan Reynolds|Dwayne Johnson|Kevin Hart|Chris Rock|Adam Sandler)\b/i;

router.post("/cases/:caseId/mentions/auto-triage", async (req, res) => {
  const caseId = parseInt(req.params.caseId);
  if (isNaN(caseId)) return res.status(400).json({ error: "Invalid case ID" });

  const pending = await db.select().from(entityMentionsTable).where(
    and(eq(entityMentionsTable.caseId, caseId), eq(entityMentionsTable.status, "pending"))
  );

  // Build cross-doc entity name → Set<documentId> from all mentions (any status)
  const allMentions = await db.select({
    entityName: entityMentionsTable.entityName,
    documentId: entityMentionsTable.documentId,
  }).from(entityMentionsTable).where(eq(entityMentionsTable.caseId, caseId));

  const entityDocCounts = new Map<string, Set<number>>();
  for (const am of allMentions) {
    if (!am.documentId) continue;
    const key = am.entityName.toLowerCase().trim();
    if (!entityDocCounts.has(key)) entityDocCounts.set(key, new Set());
    entityDocCounts.get(key)!.add(am.documentId);
  }

  const toPromote: number[] = [];
  const toReject: number[]  = [];
  const toHold: number[]    = [];

  for (const m of pending) {
    const ctx   = m.context ?? "";
    const conf  = m.confidence ?? 0;
    const nameL = m.entityName.toLowerCase().trim();

    // Parse admission metadata encoded in context
    const roleMatch   = ctx.match(/\[A:r=([^|]+)\|/);
    const role        = roleMatch ? roleMatch[1] : "UNKNOWN";
    const topicMatch  = ctx.match(/\|t=([^|]+)\|/);
    const topic       = topicMatch ? topicMatch[1] : "LOW";
    const zoneMatch   = ctx.match(/\|z=([^\]]+)/);
    const zone        = zoneMatch ? zoneMatch[1] : "body";

    const inTitleDekLead  = zone === "title" || zone === "dek" || zone === "lead";
    const hasRealRole     = role !== "UNKNOWN" && role !== "PERSON";
    const isHighTopic     = topic === "HIGH";
    const isMedTopic      = topic === "MEDIUM";
    const isLowTopic      = topic === "LOW";

    // Cross-doc support for this entity name (across all mentions)
    const docSupportCount = entityDocCounts.get(nameL)?.size ?? 1;
    const isSingleDocOnly = docSupportCount <= 1;

    // ── AUTO-REJECT criteria ─────────────────────────────────────────────
    // Celebrity name in non-investigative context
    if (CELEB_AUTO_REJECT_RE.test(m.entityName) && !(/\b(fraud|corruption|lawsuit|contract|indictment|investigation|probe|grant|award|procurement)\b/i.test(ctx))) {
      toReject.push(m.id); continue;
    }
    // Already-flagged junk: off-topic, blocklist, boilerplate
    if (/BLOCKLIST|TOPIC_MISMATCH|BOILERPLATE|NAV_RESIDUE|CROSS_STORY/.test(ctx) && conf < 0.60) {
      toReject.push(m.id); continue;
    }
    // Very low confidence regardless of context
    if (conf < 0.50) { toReject.push(m.id); continue; }
    // Side/footer zone with weak signal
    if ((zone === "sidebar" || zone === "footer" || zone === "related") && conf < 0.70) {
      toReject.push(m.id); continue;
    }
    // Short single-word entities with no real role and low confidence
    if (!m.entityName.includes(" ") && m.entityType !== "person" && conf < 0.62) {
      toReject.push(m.id); continue;
    }
    // Single-word org/location with LOW topic and no role = junk fragment
    if (!m.entityName.includes(" ") && m.entityType !== "person" && isLowTopic && role === "UNKNOWN") {
      toReject.push(m.id); continue;
    }
    // All-caps short acronym with no role
    if (/^[A-Z]{1,4}$/.test(m.entityName.trim()) && role === "UNKNOWN") {
      toReject.push(m.id); continue;
    }
    // Tail zone + LOW topic + no role = boilerplate bleed
    if (zone === "tail" && isLowTopic && role === "UNKNOWN") {
      toReject.push(m.id); continue;
    }

    // ── AUTO-PROMOTE criteria ────────────────────────────────────────────
    // Cross-doc requirement: single-doc-only entities are held, not promoted
    // unless they have a GOVERNMENT_AGENCY/COMMITTEE role and very high confidence
    const crossDocMet = !isSingleDocOnly || (role === "GOVERNMENT_AGENCY" || role === "COMMITTEE");

    // Title/dek/lead + HIGH topic + real role + high confidence
    if (crossDocMet && inTitleDekLead && isHighTopic && hasRealRole && conf >= 0.72) {
      toPromote.push(m.id); continue;
    }
    // HIGH topic + real role + very high confidence (any zone)
    if (crossDocMet && isHighTopic && hasRealRole && conf >= 0.85) {
      toPromote.push(m.id); continue;
    }
    // MEDIUM topic + real role + high confidence + premium zone
    if (crossDocMet && isMedTopic && hasRealRole && conf >= 0.78 && inTitleDekLead) {
      toPromote.push(m.id); continue;
    }
    // GOVERNMENT_AGENCY or COMMITTEE role + HIGH/MEDIUM topic + decent confidence
    if ((role === "GOVERNMENT_AGENCY" || role === "COMMITTEE" || role === "OFFICIAL") && (isHighTopic || isMedTopic) && conf >= 0.70) {
      toPromote.push(m.id); continue;
    }
    // Single-doc entity with otherwise good signals: hold for analyst review
    if (isSingleDocOnly && isHighTopic && hasRealRole && conf >= 0.72) {
      toHold.push(m.id); continue;
    }

    // ── AUTO-HOLD criteria ───────────────────────────────────────────────
    // MEDIUM topic + some role + moderate confidence = ambiguous, needs review
    if (isMedTopic && conf >= 0.58) {
      toHold.push(m.id); continue;
    }
    // LOW topic but role-bearing and decent confidence = hold for review
    if (isLowTopic && hasRealRole && conf >= 0.68) {
      toHold.push(m.id); continue;
    }

    // Default: reject remaining junk
    if (isLowTopic && !hasRealRole) {
      toReject.push(m.id); continue;
    }
    // Otherwise hold for analyst
    toHold.push(m.id);
  }

  if (toPromote.length > 0) {
    await db.update(entityMentionsTable)
      .set({ status: "approved" })
      .where(inArray(entityMentionsTable.id, toPromote));
  }
  if (toReject.length > 0) {
    await db.update(entityMentionsTable)
      .set({ status: "rejected" })
      .where(inArray(entityMentionsTable.id, toReject));
  }
  if (toHold.length > 0) {
    await db.update(entityMentionsTable)
      .set({ status: "held" })
      .where(inArray(entityMentionsTable.id, toHold));
  }

  const remainingPending = pending.length - toPromote.length - toReject.length - toHold.length;

  await logEvent(
    "auto_triage_complete",
    `Auto-triage in case ${caseId}: promoted=${toPromote.length}, rejected=${toReject.length}, held=${toHold.length}, remaining=${remainingPending}`,
    { caseId }
  );

  res.json({
    autoPromoted: toPromote.length,
    autoRejected: toReject.length,
    autoHeld: toHold.length,
    remainingPending,
    total: pending.length,
  });
});

function formatCase(
  c: typeof casesTable.$inferSelect,
  entityCount?: number,
  documentCount?: number,
  timelineCount?: number,
  relationshipCount?: number
) {
  const cAny = c as any;
  return {
    id: c.id,
    title: c.title,
    description: c.description,
    status: c.status,
    tags: c.tags || [],
    entityCount: entityCount ?? 0,
    documentCount: documentCount ?? 0,
    timelineCount: timelineCount ?? 0,
    relationshipCount: relationshipCount ?? 0,
    targetMode: cAny.targetMode ?? null,
    targetLabel: cAny.targetLabel ?? null,
    targetConfidence: cAny.targetConfidence != null ? Number(cAny.targetConfidence) : null,
    autoGraphQuality: cAny.autoGraphQuality ?? null,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

function formatEntity(e: typeof entitiesTable.$inferSelect) {
  return {
    id: e.id,
    name: e.name,
    type: e.type,
    description: e.description,
    aliases: e.aliases || [],
    caseId: e.caseId,
    createdAt: e.createdAt.toISOString(),
  };
}

function formatDocument(d: typeof documentsTable.$inferSelect) {
  return {
    id: d.id,
    title: d.title,
    filePath: d.filePath ?? null,
    source: d.source ?? null,
    publishDate: d.publishDate ?? null,
    uploadedAt: d.uploadedAt.toISOString(),
    caseId: d.caseId ?? null,
    sourceUrl: d.sourceUrl ?? null,
    sourceDomain: d.sourceDomain ?? null,
    ingestMethod: d.ingestMethod ?? "upload",
    rawText: d.rawText ?? null,
    previewType: d.previewType ?? "file",
  };
}

function formatTimeline(
  t: typeof timelineEntriesTable.$inferSelect,
  entityMap: Record<number, string>
) {
  return {
    id: t.id,
    title: t.title,
    description: t.description,
    eventDate: t.eventDate,
    linkedEntityId: t.linkedEntityId,
    linkedEntityName: t.linkedEntityId ? entityMap[t.linkedEntityId] : undefined,
    linkedDocumentId: t.linkedDocumentId,
    caseId: t.caseId,
    createdAt: t.createdAt.toISOString(),
  };
}

function formatEvent(e: typeof eventsTable.$inferSelect) {
  return {
    id: e.id,
    title: e.title,
    location: e.location,
    latitude: e.latitude,
    longitude: e.longitude,
    source: e.source,
    timestamp: e.timestamp,
    caseId: e.caseId,
    createdAt: e.createdAt.toISOString(),
  };
}

function formatNote(n: typeof notesTable.$inferSelect) {
  return {
    id: n.id,
    caseId: n.caseId,
    content: n.content,
    createdAt: n.createdAt.toISOString(),
    updatedAt: n.updatedAt.toISOString(),
  };
}

function formatRelationship(
  r: typeof relationshipsTable.$inferSelect,
  entityMap: Record<number, string>
) {
  return {
    id: r.id,
    entityAId: r.entityAId,
    entityBId: r.entityBId,
    entityAName: entityMap[r.entityAId] || `Entity ${r.entityAId}`,
    entityBName: entityMap[r.entityBId] || `Entity ${r.entityBId}`,
    relationshipType: r.relationshipType,
    evidenceDocumentId: r.evidenceDocumentId,
    confidence: r.confidence,
    dateRange: r.dateRange,
    caseId: r.caseId,
    evidenceCount: 0,
    createdAt: r.createdAt.toISOString(),
  };
}

function formatMoneyFlow(
  m: typeof moneyFlowsTable.$inferSelect,
  entityMap: Record<number, string>
) {
  return {
    id: m.id,
    sourceEntityId: m.sourceEntityId,
    destinationEntityId: m.destinationEntityId,
    sourceEntityName: entityMap[m.sourceEntityId] || `Entity ${m.sourceEntityId}`,
    destinationEntityName:
      entityMap[m.destinationEntityId] || `Entity ${m.destinationEntityId}`,
    amount: m.amount,
    currency: m.currency || "USD",
    date: m.date,
    description: m.description,
    supportingDocumentId: m.supportingDocumentId,
    confidenceLevel: m.confidenceLevel,
    caseId: m.caseId,
    createdAt: m.createdAt.toISOString(),
  };
}

function formatFinancialSignal(s: typeof financialSignalsTable.$inferSelect) {
  return {
    id: s.id,
    amountRaw: s.amountRaw,
    amountDisplay: s.amountDisplay,
    normalizedAmount: s.normalizedAmount,
    currency: s.currency || "USD",
    signalType: s.signalType,
    eventSummary: s.eventSummary,
    entityName: s.entityName,
    programName: s.programName,
    controlledBy: s.controlledBy,
    receivedBy: s.receivedBy,
    financialConfidence: s.financialConfidence,
    entityId: s.entityId,
    documentId: s.documentId,
    documentTitle: s.documentTitle,
    caseId: s.caseId,
    createdAt: s.createdAt.toISOString(),
  };
}

// ── Backfill Signals ─────────────────────────────────────────────────────────

function stripAtlasDiag(rawText: string): string {
  return rawText
    .replace(/^\[ATLAS-DIAG:[^\]]+\]\n?/, "")
    .replace(/^\[EXTRACTION_INCOMPLETE\]\n?/, "")
    .replace(/^\[EXTRACTION_FAILED\]\n?/, "")
    .replace(/^\[WRAPPER_BLOCKED\]\n?/, "")
    .trim();
}

router.post("/cases/:caseId/backfill-signals", async (req, res) => {
  const caseId = parseInt(req.params.caseId, 10);
  if (isNaN(caseId)) return res.status(400).json({ error: "Invalid case ID" });

  try {
    const docs = await db
      .select()
      .from(documentsTable)
      .where(eq(documentsTable.caseId, caseId));

    let docsProcessed = 0;
    let timelineAdded = 0;
    let signalsAdded = 0;
    let docsSkipped = 0;

    for (const doc of docs) {
      const rawText = doc.rawText || "";

      // Skip failed / wrapper documents
      const isBlocked =
        rawText.includes("[WRAPPER_BLOCKED]") ||
        rawText.includes("[FETCH_FAILED]") ||
        (rawText.includes("[ATLAS-DIAG:") &&
          (rawText.includes("status=failed") || rawText.includes("status=wrapper")));
      if (isBlocked || rawText.trim().length < 100) {
        docsSkipped++;
        continue;
      }

      const textForAnalysis = stripAtlasDiag(rawText);
      if (textForAnalysis.length < 100) { docsSkipped++; continue; }

      docsProcessed++;

      // ── Timeline events ────────────────────────────────────────────────
      const existingTimeline = await db
        .select({ title: timelineEntriesTable.title, eventDate: timelineEntriesTable.eventDate })
        .from(timelineEntriesTable)
        .where(eq(timelineEntriesTable.linkedDocumentId, doc.id));

      const existingTimelineKeys = new Set(
        existingTimeline.map((e) => `${e.eventDate}:${e.title?.slice(0, 60) ?? ""}`)
      );

      const timelineEvents = extractTimelineEvents(textForAnalysis);
      for (const ev of timelineEvents) {
        const key = `${ev.eventDate}:${`[${ev.eventType}] ${ev.summary.slice(0, 120)}`.slice(0, 60)}`;
        if (existingTimelineKeys.has(key)) continue;
        try {
          await db.insert(timelineEntriesTable).values({
            title: `[${ev.eventType}] ${ev.summary.slice(0, 120)}`,
            description: ev.summary,
            eventDate: ev.eventDate,
            linkedDocumentId: doc.id,
            caseId,
          });
          timelineAdded++;
        } catch { /* skip */ }
      }

      // ── Financial signals ──────────────────────────────────────────────
      const existingSignals = await db
        .select({ amountRaw: financialSignalsTable.amountRaw, signalType: financialSignalsTable.signalType })
        .from(financialSignalsTable)
        .where(eq(financialSignalsTable.documentId, doc.id));

      const existingSignalKeys = new Set(
        existingSignals.map((s) => `${s.amountRaw}:${s.signalType}`)
      );

      const signals = extractFinancialSignals(textForAnalysis);
      for (const sig of signals) {
        const key = `${sig.amountRaw}:${sig.signalType}`;
        if (existingSignalKeys.has(key)) continue;
        try {
          await db.insert(financialSignalsTable).values({
            amountRaw: sig.amountRaw,
            normalizedAmount: sig.normalizedAmount ?? null,
            currency: sig.currency ?? "USD",
            signalType: sig.signalType,
            eventSummary: sig.eventSummary ?? null,
            entityName: sig.entityName ?? null,
            documentId: doc.id,
            documentTitle: doc.title,
            caseId,
          });
          signalsAdded++;
        } catch { /* skip */ }
      }
    }

    await logEvent(
      "backfill_complete",
      `Signal backfill complete — ${docsProcessed} docs reprocessed, ${timelineAdded} timeline events added, ${signalsAdded} financial signals added (${docsSkipped} docs skipped)`,
      { caseId }
    );

    return res.json({
      ok: true,
      docs_processed: docsProcessed,
      docs_skipped: docsSkipped,
      timeline_added: timelineAdded,
      signals_added: signalsAdded,
    });
  } catch (err) {
    console.error("[ATLAS BACKFILL] Error:", err);
    return res.status(500).json({ error: "Backfill failed" });
  }
});

// ── Case Compiler ─────────────────────────────────────────────────────────────

// ── Run Full Analysis — analyze all case docs, promote entities, compile ──────
// POST /api/cases/:caseId/run-analysis
// Called by the frontend ANALYZE button. Runs the full pipeline:
// 1. Extract entities/timeline/financial from any unanalyzed docs
// 2. Run auto-triage on all pending mentions (approve/reject/hold)
// 3. Create entity records in entitiesTable for promoted mentions
// 4. Compile and save the case brief
router.post("/cases/:caseId/run-analysis", async (req, res) => {
  const caseId = parseInt(req.params.caseId, 10);
  if (isNaN(caseId)) return res.status(400).json({ error: "Invalid case ID" });

  try {
    // ── Load case for seedIntent ──────────────────────────────────────────────
    const caseRows = await db.select().from(casesTable).where(eq(casesTable.id, caseId));
    if (!caseRows.length) return res.status(404).json({ error: "Case not found" });
    const theCase = caseRows[0];
    const seedIntent: SeedIntent = classifySeedIntent(theCase.title ?? "");

    // ── Step 1: Analyze unanalyzed docs ──────────────────────────────────────
    const docs = await db.select().from(documentsTable)
      .where(eq(documentsTable.caseId, caseId));

    // Get doc IDs that already have mentions (T002 debounce)
    const existingMentionDocIds = new Set<number>(
      (await db.select({ documentId: entityMentionsTable.documentId })
        .from(entityMentionsTable)
        .where(eq(entityMentionsTable.caseId, caseId)))
        .map(r => r.documentId!)
        .filter(Boolean)
    );

    let newMentions = 0;
    let newTimeline = 0;
    let newFinancial = 0;

    for (const doc of docs) {
      if (!doc.rawText || doc.rawText.trim().length < 10) continue;
      const rawText = doc.rawText;
      const isSkipped = rawText.includes("[WRAPPER_BLOCKED]")
        || rawText.includes("[EXTRACTION_FAILED]")
        || rawText.includes("[FETCH_FAILED]");
      if (isSkipped) continue;

      const cleanText = cleanRawText(rawText)
        .replace(/^\[EXTRACTION_INCOMPLETE\]\n?/, "")
        .replace(/^\[WRAPPER_BLOCKED\]\n?/, "")
        .trim();
      if (cleanText.length < 10) continue;

      // T002: Skip entity extraction if already done for this doc
      if (!existingMentionDocIds.has(doc.id)) {
        // Pass seedIntent for better topicRelevance classification
        const entities = extractEntities(cleanText, undefined, seedIntent);
        for (const m of entities) {
          if (WRAPPER_ENTITY_BLOCKLIST.has(m.entityName)) continue;
          if (!m.admitted) continue;
          try {
            const encodedCtx = `[A:r=${m.role}|t=${m.topicRelevance}|z=${m.zone}] ${m.context}`;
            await db.insert(entityMentionsTable).values({
              documentId: doc.id,
              caseId,
              entityName: m.entityName,
              entityType: m.entityType,
              confidence: m.confidence,
              status: "pending",
              context: encodedCtx,
              startPos: m.startPos,
              endPos: m.endPos,
            });
            newMentions++;
          } catch { /* skip duplicates */ }
        }
      }

      // Timeline extraction (always run — idempotent via try/catch on duplicates)
      try {
        const timelineEvents = extractTimelineEvents(cleanText);
        const docYear = doc.publishDate ? new Date(doc.publishDate).getFullYear() : null;
        const JUNK_TL_RE = /\b(episode|season|recap|film|movie|concert|game\s+result|tournament)\b/i;
        for (const ev of timelineEvents) {
          if (JUNK_TL_RE.test(ev.summary)) continue;
          if (docYear && ev.eventDate) {
            const evYear = new Date(ev.eventDate).getFullYear();
            if (Math.abs(evYear - docYear) > 2) continue;
          }
          try {
            await db.insert(timelineEntriesTable).values({
              title: ev.eventType.replace(/_/g, " ") + ": " + ev.summary.slice(0, 80),
              description: ev.summary,
              eventDate: ev.eventDate,
              linkedDocumentId: doc.id,
              caseId,
            });
            newTimeline++;
          } catch { /* skip duplicates */ }
        }
      } catch { /* don't crash */ }

      // Financial extraction
      try {
        const signals = extractFinancialSignals(cleanText);
        for (const sig of signals) {
          if ((sig.financialConfidence ?? 0) < 0.55) continue;
          try {
            await db.insert(financialSignalsTable).values({
              amountRaw: sig.amountRaw,
              amountDisplay: sig.amountDisplay ?? null,
              normalizedAmount: sig.normalizedAmount ?? undefined,
              currency: sig.currency ?? "USD",
              signalType: sig.signalType,
              eventSummary: sig.eventSummary ?? null,
              entityName: sig.entityName ?? null,
              controlledBy: (sig as any).controlledBy ?? null,
              receivedBy: (sig as any).receivedBy ?? null,
              programName: (sig as any).programName ?? null,
              financialConfidence: sig.financialConfidence ?? null,
              documentId: doc.id,
              documentTitle: doc.title,
              caseId,
            });
            newFinancial++;
          } catch { /* skip duplicates */ }
        }
      } catch { /* don't crash */ }
    }

    // ── Step 2: Auto-triage pending mentions ─────────────────────────────────
    const pending = await db.select().from(entityMentionsTable)
      .where(and(eq(entityMentionsTable.caseId, caseId), eq(entityMentionsTable.status, "pending")));

    // Build cross-doc entity support map
    const allMentions = await db.select({
      entityName: entityMentionsTable.entityName,
      documentId: entityMentionsTable.documentId,
    }).from(entityMentionsTable).where(eq(entityMentionsTable.caseId, caseId));

    const entityDocCounts = new Map<string, Set<number>>();
    for (const am of allMentions) {
      if (!am.documentId) continue;
      const key = am.entityName.toLowerCase().trim();
      if (!entityDocCounts.has(key)) entityDocCounts.set(key, new Set());
      entityDocCounts.get(key)!.add(am.documentId);
    }

    interface PromotionEntry {
      mentionId: number;
      entityName: string;
      entityType: string;
      confidence: number;
      docCount: number;
    }
    const toPromote: PromotionEntry[] = [];
    const toRejectIds: number[] = [];
    const toHoldIds: number[] = [];

    const CELEB_RE = /\b(Taylor Swift|Beyoncé|Kim Kardashian|Kanye West|LeBron James|Tom Brady|Drake|Rihanna|Ariana Grande|Justin Bieber|Selena Gomez|Lady Gaga|Elon Musk|Jeff Bezos|Mark Zuckerberg)\b/i;

    for (const m of pending) {
      const ctx = m.context ?? "";
      const conf = m.confidence ?? 0;
      const nameL = m.entityName.toLowerCase().trim();
      const roleMatch = ctx.match(/\[A:r=([^|]+)\|/);
      const role = roleMatch ? roleMatch[1] : "UNKNOWN";
      const topicMatch = ctx.match(/\|t=([^|]+)\|/);
      const topic = topicMatch ? topicMatch[1] : "LOW";
      const zoneMatch = ctx.match(/\|z=([^\]]+)/);
      const zone = zoneMatch ? zoneMatch[1] : "body";

      const inTitleDekLead = zone === "title" || zone === "dek" || zone === "lead";
      const hasRealRole = role !== "UNKNOWN" && role !== "PERSON";
      const isHighTopic = topic === "HIGH";
      const isMedTopic = topic === "MEDIUM";
      const docSupportCount = entityDocCounts.get(nameL)?.size ?? 1;

      // Auto-reject criteria
      if (CELEB_RE.test(m.entityName) && !(/\b(fraud|corruption|lawsuit|contract|investigation|grant)\b/i.test(ctx))) {
        toRejectIds.push(m.id); continue;
      }
      if (conf < 0.50) { toRejectIds.push(m.id); continue; }
      if ((zone === "sidebar" || zone === "footer" || zone === "related") && conf < 0.70) {
        toRejectIds.push(m.id); continue;
      }
      if (zone === "tail" && topic === "LOW" && role === "UNKNOWN") {
        toRejectIds.push(m.id); continue;
      }
      if (/^[A-Z]{1,4}$/.test(m.entityName.trim()) && role === "UNKNOWN") {
        toRejectIds.push(m.id); continue;
      }

      const isGovtOrInstitution = role === "GOVERNMENT_AGENCY" || role === "COMMITTEE"
        || INSTITUTION_PATTERN.test(m.entityName) || m.entityType === "government_agency";
      const crossDocMet = docSupportCount >= 2 || isGovtOrInstitution;

      // Auto-promote criteria
      if (crossDocMet && inTitleDekLead && isHighTopic && hasRealRole && conf >= 0.70) {
        toPromote.push({ mentionId: m.id, entityName: m.entityName, entityType: m.entityType, confidence: conf, docCount: docSupportCount });
        continue;
      }
      if (crossDocMet && isHighTopic && hasRealRole && conf >= 0.82) {
        toPromote.push({ mentionId: m.id, entityName: m.entityName, entityType: m.entityType, confidence: conf, docCount: docSupportCount });
        continue;
      }
      // Government agencies/institutions: promote even with LOW topic if high confidence + non-tail zone
      if (isGovtOrInstitution && conf >= 0.65 && zone !== "tail" && zone !== "sidebar" && zone !== "footer") {
        toPromote.push({ mentionId: m.id, entityName: m.entityName, entityType: m.entityType, confidence: conf, docCount: docSupportCount });
        continue;
      }
      if ((role === "GOVERNMENT_AGENCY" || role === "COMMITTEE" || isGovtOrInstitution)
          && (isHighTopic || isMedTopic) && conf >= 0.62) {
        toPromote.push({ mentionId: m.id, entityName: m.entityName, entityType: m.entityType, confidence: conf, docCount: docSupportCount });
        continue;
      }
      if (crossDocMet && isMedTopic && hasRealRole && conf >= 0.75 && inTitleDekLead) {
        toPromote.push({ mentionId: m.id, entityName: m.entityName, entityType: m.entityType, confidence: conf, docCount: docSupportCount });
        continue;
      }
      // Multi-doc entities: hold for review even if topic is low
      if (docSupportCount >= 2 && conf >= 0.62 && hasRealRole) {
        toPromote.push({ mentionId: m.id, entityName: m.entityName, entityType: m.entityType, confidence: conf, docCount: docSupportCount });
        continue;
      }

      // Hold ambiguous
      if (isMedTopic && conf >= 0.58) { toHoldIds.push(m.id); continue; }
      if (topic === "LOW" && hasRealRole && conf >= 0.65) { toHoldIds.push(m.id); continue; }

      // Default: reject
      toRejectIds.push(m.id);
    }

    // ── Step 3: Create entity records for promoted mentions ───────────────────
    let entitiesCreated = 0;
    const promotedNames: string[] = [];

    // Group by normalized name to avoid duplicate entity inserts
    const promotionByName = new Map<string, PromotionEntry>();
    for (const p of toPromote) {
      const normKey = normalizeEntityName(p.entityName).toLowerCase();
      const existing = promotionByName.get(normKey);
      if (!existing || p.confidence > existing.confidence) {
        promotionByName.set(normKey, p);
      }
    }

    for (const [, entry] of promotionByName) {
      if (promotedNames.length >= 8) break; // hard cap
      if (WRAPPER_ENTITY_BLOCKLIST.has(entry.entityName)) continue;

      // Check if entity already exists for this case
      const existingEntity = await db.select({ id: entitiesTable.id })
        .from(entitiesTable)
        .where(and(eq(entitiesTable.caseId, caseId),
          eq(entitiesTable.name, entry.entityName)));
      if (existingEntity.length > 0) { promotedNames.push(entry.entityName); continue; }

      try {
        await db.insert(entitiesTable).values({
          name: entry.entityName,
          type: entry.entityType,
          caseId,
          aliases: [],
        });
        promotedNames.push(entry.entityName);
        entitiesCreated++;
      } catch { /* entity may already exist */ }
    }

    // Mark all promoted mentions as approved
    const allPromoteMentionIds = toPromote.map(p => p.mentionId);
    if (allPromoteMentionIds.length > 0) {
      await db.update(entityMentionsTable)
        .set({ status: "approved" })
        .where(inArray(entityMentionsTable.id, allPromoteMentionIds));
    }
    if (toRejectIds.length > 0) {
      await db.update(entityMentionsTable)
        .set({ status: "rejected" })
        .where(inArray(entityMentionsTable.id, toRejectIds));
    }
    if (toHoldIds.length > 0) {
      await db.update(entityMentionsTable)
        .set({ status: "held" })
        .where(inArray(entityMentionsTable.id, toHoldIds));
    }

    // ── Step 4: Compile case brief ────────────────────────────────────────────
    const brief = await compileCaseBrief(caseId);
    await saveCaseBrief(caseId, brief);

    await logEvent(
      "run_analysis_complete",
      `Full analysis: ${newMentions} new detections, ${newTimeline} timeline, ${newFinancial} financial, ${entitiesCreated} entities promoted, quality=${brief.dataQuality}`,
      { caseId }
    );

    return res.json({
      ok: true,
      newMentions,
      newTimeline,
      newFinancial,
      entitiesCreated,
      autoPromoted: allPromoteMentionIds.length,
      autoRejected: toRejectIds.length,
      autoHeld: toHoldIds.length,
      quality: brief.dataQuality,
      brief,
    });
  } catch (err) {
    console.error("[ATLAS RUN-ANALYSIS]", err);
    return res.status(500).json({ error: String(err) });
  }
});

router.post("/cases/:caseId/compile", async (req, res) => {
  const caseId = parseInt(req.params.caseId, 10);
  if (isNaN(caseId)) return res.status(400).json({ error: "Invalid case ID" });
  try {
    const brief = await compileCaseBrief(caseId);
    await saveCaseBrief(caseId, brief);
    await logEvent(
      "case_compiled",
      `Case brief compiled — quality=${brief.dataQuality}, entities=${brief.primaryEntities.length}, timeline=${brief.topTimeline.length}, financial=${brief.topFinancial.length}`,
      { caseId }
    );
    return res.json({ ok: true, brief });
  } catch (err) {
    console.error("[ATLAS COMPILER]", err);
    return res.status(500).json({ error: String(err) });
  }
});

router.get("/cases/:caseId/brief", async (req, res) => {
  const caseId = parseInt(req.params.caseId, 10);
  if (isNaN(caseId)) return res.status(400).json({ error: "Invalid case ID" });
  try {
    const brief = await loadCaseBrief(caseId);
    if (!brief) return res.json({ ok: false, brief: null });
    return res.json({ ok: true, brief });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

// ── Rebuild Graph — re-compute edges between approved entities ─────────────
router.post("/cases/:caseId/rebuild-graph", async (req, res) => {
  const caseId = parseInt(req.params.caseId, 10);
  if (isNaN(caseId)) return res.status(400).json({ error: "Invalid case ID" });
  try {
    // Get all approved entities in case
    const caseEntities = await db.select().from(entitiesTable).where(eq(entitiesTable.caseId, caseId));
    if (caseEntities.length < 2) {
      return res.json({ ok: true, edgesCreated: 0, message: "Need at least 2 entities to build graph" });
    }
    // Get entity mention data per entity
    const mentionsByEntity = await db
      .select({
        entityName: entityMentionsTable.entityName,
        documentId: entityMentionsTable.documentId,
      })
      .from(entityMentionsTable)
      .where(eq(entityMentionsTable.caseId, caseId));

    const entityDocMap = new Map<string, Set<number>>();
    for (const m of mentionsByEntity) {
      const key = m.entityName?.toLowerCase().trim() ?? "";
      if (!key) continue;
      if (!entityDocMap.has(key)) entityDocMap.set(key, new Set());
      if (m.documentId) entityDocMap.get(key)!.add(m.documentId);
    }

    let edgesCreated = 0;
    for (let i = 0; i < caseEntities.length; i++) {
      for (let j = i + 1; j < caseEntities.length; j++) {
        const eA = caseEntities[i];
        const eB = caseEntities[j];
        const docsA = entityDocMap.get(eA.name?.toLowerCase().trim() ?? "") ?? new Set();
        const docsB = entityDocMap.get(eB.name?.toLowerCase().trim() ?? "") ?? new Set();
        const sharedDocs = [...docsA].filter(d => docsB.has(d)).length;
        if (sharedDocs === 0) continue;
        const confidence = sharedDocs >= 3 ? 0.88 : sharedDocs >= 2 ? 0.80 : 0.70;
        const relType = sharedDocs >= 2 ? "repeated_association" : "co_mention";
        try {
          await db.insert(relationshipsTable).values({
            entityAId: eA.id,
            entityBId: eB.id,
            relationshipType: relType,
            caseId,
            confidence,
          });
          edgesCreated++;
        } catch { /* Skip duplicates */ }
      }
    }
    await logEvent("graph_updated", `Graph rebuilt — ${edgesCreated} new edges created`, { caseId });
    return res.json({ ok: true, edgesCreated });
  } catch (err) {
    console.error("[ATLAS REBUILD GRAPH]", err);
    return res.status(500).json({ error: String(err) });
  }
});

export default router;
