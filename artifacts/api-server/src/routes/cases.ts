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
  if (type === "low-confidence") {
    toReject = pending.filter(m => (m.confidence ?? 1) < 0.60).map(m => m.id);
  } else if (type === "single-word-person") {
    toReject = pending.filter(m => m.entityType === "person" && !m.entityName.includes(" ")).map(m => m.id);
  } else if (type === "all-pending") {
    toReject = pending.map(m => m.id);
  }

  if (toReject.length > 0) {
    await db.update(entityMentionsTable)
      .set({ status: "rejected" })
      .where(inArray(entityMentionsTable.id, toReject));
  }

  await logEvent(
    "pending_mentions_cleared",
    `Bulk rejected ${toReject.length} pending mentions (filter: ${type}) in case ${caseId}`,
    { caseId }
  );

  res.json({ rejected: toReject.length });
});

function formatCase(
  c: typeof casesTable.$inferSelect,
  entityCount?: number,
  documentCount?: number,
  timelineCount?: number,
  relationshipCount?: number
) {
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
    normalizedAmount: s.normalizedAmount,
    currency: s.currency || "USD",
    signalType: s.signalType,
    eventSummary: s.eventSummary,
    entityName: s.entityName,
    entityId: s.entityId,
    documentId: s.documentId,
    documentTitle: s.documentTitle,
    caseId: s.caseId,
    createdAt: s.createdAt.toISOString(),
  };
}

export default router;
