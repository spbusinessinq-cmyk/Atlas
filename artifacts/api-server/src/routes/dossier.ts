import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  casesTable,
  entitiesTable,
  relationshipsTable,
  documentsTable,
  timelineEntriesTable,
  entityMentionsTable,
} from "@workspace/db/schema";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

// ─── Auto-dossier generation endpoint ──────────────────────────────────────
// GET /api/cases/:caseId/dossier
// Generates a structured 8-section investigation dossier from case data.
// Only promoted (approved) entities appear in the output.

router.get("/cases/:caseId/dossier", async (req, res) => {
  const caseId = parseInt(req.params.caseId);
  if (isNaN(caseId)) return res.status(400).json({ error: "Invalid case ID" });

  const caseRows = await db.select().from(casesTable).where(eq(casesTable.id, caseId));
  if (caseRows.length === 0) return res.status(404).json({ error: "Case not found" });
  const caseData = caseRows[0];

  const entities = await db.select().from(entitiesTable).where(eq(entitiesTable.caseId, caseId));
  const promotedEntityIds = new Set(entities.map((e) => e.id));

  const approvedMentions = entities.length > 0
    ? await db.select().from(entityMentionsTable).where(eq(entityMentionsTable.caseId, caseId))
    : [];
  const approvedOnly = approvedMentions.filter((m) => m.status === "approved");

  const allRelationships = await db.select().from(relationshipsTable).where(eq(relationshipsTable.caseId, caseId));
  const cleanRelationships = allRelationships.filter(
    (r) => promotedEntityIds.has(r.entityAId) && promotedEntityIds.has(r.entityBId)
  );

  const documents = await db.select({
    id: documentsTable.id,
    title: documentsTable.title,
    source: documentsTable.source,
    publishedAt: documentsTable.publishedAt,
    sourceUrl: (documentsTable as any).sourceUrl,
  }).from(documentsTable).where(eq(documentsTable.caseId, caseId));

  const timeline = await db.select().from(timelineEntriesTable).where(
    eq(timelineEntriesTable.caseId, caseId)
  );

  // Parse ATLAS-SEED for intent + next queries
  const desc = caseData.description ?? "";
  const seedMatch = desc.match(/\[ATLAS-SEED:([^\]]+)\]/);
  const kv: Record<string, string> = {};
  if (seedMatch) {
    seedMatch[1].split("|").forEach((p: string) => {
      const eqIdx = p.indexOf("=");
      if (eqIdx > 0) kv[p.slice(0, eqIdx)] = p.slice(eqIdx + 1);
    });
  }
  const dec = (v?: string): string => { try { return v ? decodeURIComponent(v) : ""; } catch { return v ?? ""; } };
  const seedIntent = kv.seed_intent || "general";
  const nextQueriesRaw = dec(kv.next_queries);
  const nextQueriesParsed = nextQueriesRaw ? nextQueriesRaw.split("||").filter(Boolean) : [];
  const autoBuildQuality = kv.auto_build_quality || null;
  const briefText = desc.replace(/\[ATLAS-SEED:[^\]]+\]/, "").trim();

  // Entity map by id
  type EntityRow = typeof entities[number];
  const entityById = new Map<number, EntityRow>(entities.map((e) => [e.id, e]));

  // Doc support per entity
  const entityDocSupport = new Map<number, Set<number>>();
  for (const m of approvedOnly) {
    if (!m.entityId || !m.documentId) continue;
    if (!entityDocSupport.has(m.entityId)) entityDocSupport.set(m.entityId, new Set());
    entityDocSupport.get(m.entityId)!.add(m.documentId);
  }

  // SECTION 1 — Case Summary
  const caseSummary = briefText ||
    `This investigation analyzes ${caseData.title}. ${entities.length} entities identified across ${documents.length} sources.`;

  // SECTION 2 — Key Entities
  const keyEntities = entities.map((e) => ({
    id: e.id,
    name: e.name,
    type: e.type,
    aliases: e.aliases ?? [],
    docCount: entityDocSupport.get(e.id)?.size ?? 0,
  })).sort((a, b) => b.docCount - a.docCount);

  // SECTION 3 — Entity Relationships
  const entityRelationships = cleanRelationships.map((r) => {
    const eA = entityById.get(r.entityAId);
    const eB = entityById.get(r.entityBId);
    return {
      entityAId: r.entityAId,
      entityBId: r.entityBId,
      entityAName: eA?.name ?? "Unknown",
      entityBName: eB?.name ?? "Unknown",
      relationshipType: r.relationshipType,
      confidence: r.confidence,
    };
  }).sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));

  // SECTION 4 — Document Evidence
  const documentEvidence = documents.map((d) => ({
    id: d.id,
    title: d.title,
    source: d.source,
    date: d.publishedAt ?? null,
    url: (d as any).sourceUrl ?? null,
  })).sort((a, b) => {
    if (!a.date && !b.date) return 0;
    if (!a.date) return 1;
    if (!b.date) return -1;
    return new Date(b.date as string).getTime() - new Date(a.date as string).getTime();
  });

  // SECTION 5 — Timeline Signals
  const timelineSignals = timeline
    .filter((t) => t.date != null)
    .sort((a, b) => new Date(a.date!).getTime() - new Date(b.date!).getTime())
    .map((t) => ({
      date: t.date,
      title: t.title,
      description: t.description,
      eventType: t.eventType,
    }));

  // SECTION 6 — Financial Signals (from approved mention contexts)
  const MONEY_RE = /\b(funding|grant|budget|contract|appropriation|allocation|spending|award|procurement|payment|donation|settlement|payout|contribution)\b/i;
  const financialSignals: Array<{ entityName: string; context: string; docId: number | null }> = [];
  for (const m of approvedOnly) {
    const ctx = m.context ?? "";
    if (MONEY_RE.test(ctx) && m.entityId) {
      const entity = entityById.get(m.entityId);
      if (entity) {
        financialSignals.push({
          entityName: entity.name,
          context: ctx.replace(/^\[A:[^\]]+\]\s*/, "").trim(),
          docId: m.documentId ?? null,
        });
      }
    }
  }

  // SECTION 7 — Investigative Angles
  const intentAngles: Record<string, string[]> = {
    crime_corruption:     ["Source of original complaint or tip", "Chain of command in alleged misconduct", "Timeline of decisions and cover-up signals", "Whistleblower protection angle", "Financial benefit to implicated parties"],
    legal_lawsuit:        ["Legal standing and jurisdiction", "Precedent cases cited", "Financial exposure and settlement patterns", "Implicated institutions' prior legal history", "Who funds the legal defense"],
    policy_government:    ["Policy implementation gap analysis", "Who benefits from current policy", "Budget allocation vs. stated goals", "Oversight committee inaction", "Lobbying influence behind the policy"],
    housing_homelessness: ["Contract award trail for shelter funding", "Developer relationships with city officials", "Displacement patterns by neighborhood", "Service provider accountability", "Federal funding compliance"],
    finance_funding:      ["Source of funds and donor identities", "FEC or charity filing discrepancies", "Flow of money through subsidiaries", "Undisclosed conflicts of interest", "Audit history of receiving organizations"],
    general:              ["Follow the money", "Map the decision chain", "Check prior reporting", "Cross-reference public records", "Find contradictory statements"],
  };
  const investigativeAngles = (intentAngles[seedIntent] || intentAngles.general).map((angle) => ({ angle }));

  // SECTION 8 — Auto Query Expansion
  const entityNames = keyEntities.slice(0, 3).map((e) => e.name);
  const intentSuffixes: Record<string, string[]> = {
    crime_corruption:     ["investigation", "indictment", "fraud charges", "corruption probe"],
    legal_lawsuit:        ["lawsuit", "court filing", "settlement", "legal action"],
    policy_government:    ["oversight", "legislation", "committee hearing", "government contract"],
    housing_homelessness: ["shelter funding", "housing contract", "displacement", "homeless services"],
    finance_funding:      ["FEC filing", "donor records", "grant award", "budget allocation"],
    general:              ["investigation", "report", "accountability", "records"],
  };
  const suffixes = intentSuffixes[seedIntent] || intentSuffixes.general;
  const generatedQueries: string[] = [];
  for (const name of entityNames) {
    for (const suffix of suffixes.slice(0, 2)) {
      generatedQueries.push(`${name} ${suffix}`);
    }
  }
  const nextQueries = [
    ...nextQueriesParsed,
    ...generatedQueries.filter((q) => !nextQueriesParsed.includes(q)),
  ].slice(0, 8);

  return res.json({
    caseId,
    caseTitle: caseData.title,
    seedIntent,
    autoBuildQuality,
    generatedAt: new Date().toISOString(),
    sections: {
      caseSummary,
      keyEntities,
      entityRelationships,
      documentEvidence,
      timelineSignals,
      financialSignals,
      investigativeAngles,
      nextQueries,
    },
    meta: {
      entityCount: entities.length,
      documentCount: documents.length,
      timelineCount: timeline.length,
      financialSignalCount: financialSignals.length,
      relationshipCount: cleanRelationships.length,
    },
  });
});

export default router;
