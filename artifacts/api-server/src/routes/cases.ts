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
} from "@workspace/db/schema";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

router.get("/cases", async (_req, res) => {
  const cases = await db.select().from(casesTable).orderBy(casesTable.createdAt);
  res.json(cases.map(formatCase));
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

  const [entities, documents, timeline, events, notes, allRelationships, moneyFlows] =
    await Promise.all([
      db.select().from(entitiesTable).where(eq(entitiesTable.caseId, id)),
      db.select().from(documentsTable).where(eq(documentsTable.caseId, id)),
      db.select().from(timelineEntriesTable).where(eq(timelineEntriesTable.caseId, id)),
      db.select().from(eventsTable).where(eq(eventsTable.caseId, id)),
      db.select().from(notesTable).where(eq(notesTable.caseId, id)),
      db.select().from(relationshipsTable).where(eq(relationshipsTable.caseId, id)),
      db.select().from(moneyFlowsTable).where(eq(moneyFlowsTable.caseId, id)),
    ]);

  const entityIds = entities.map((e) => e.id);
  const entityMap = Object.fromEntries(entities.map((e) => [e.id, e.name]));

  const relationships = allRelationships.filter(
    (r) => entityIds.includes(r.entityAId) || entityIds.includes(r.entityBId)
  );

  res.json({
    case: formatCase(rows[0]),
    entities: entities.map(formatEntity),
    documents: documents.map(formatDocument),
    timeline: timeline.map((t) => formatTimeline(t, entityMap)),
    events: events.map(formatEvent),
    notes: notes.map(formatNote),
    relationships: relationships.map((r) => formatRelationship(r, entityMap)),
    moneyFlows: moneyFlows.map((m) => formatMoneyFlow(m, entityMap)),
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

function formatCase(c: typeof casesTable.$inferSelect) {
  return {
    id: c.id,
    title: c.title,
    description: c.description,
    status: c.status,
    tags: c.tags || [],
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
    filePath: d.filePath,
    source: d.source,
    publishDate: d.publishDate,
    uploadedAt: d.uploadedAt.toISOString(),
    caseId: d.caseId,
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
    caseId: r.caseId,
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
    date: m.date,
    description: m.description,
    supportingDocumentId: m.supportingDocumentId,
    caseId: m.caseId,
    createdAt: m.createdAt.toISOString(),
  };
}

export default router;
