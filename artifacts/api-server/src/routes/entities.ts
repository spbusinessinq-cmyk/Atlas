import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  entitiesTable,
  relationshipsTable,
  documentsTable,
  timelineEntriesTable,
} from "@workspace/db/schema";
import { eq, or } from "drizzle-orm";

const router: IRouter = Router();

router.get("/entities", async (req, res) => {
  const caseId = req.query.caseId ? parseInt(req.query.caseId as string) : undefined;
  let rows;
  if (caseId) {
    rows = await db.select().from(entitiesTable).where(eq(entitiesTable.caseId, caseId));
  } else {
    rows = await db.select().from(entitiesTable);
  }
  res.json(rows.map(formatEntity));
});

router.get("/entities/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const rows = await db.select().from(entitiesTable).where(eq(entitiesTable.id, id));
  if (!rows.length) return res.status(404).json({ error: "Not found" });

  const entity = rows[0];
  const [relationships, timelineAppearances] = await Promise.all([
    db
      .select()
      .from(relationshipsTable)
      .where(
        or(eq(relationshipsTable.entityAId, id), eq(relationshipsTable.entityBId, id))
      ),
    db
      .select()
      .from(timelineEntriesTable)
      .where(eq(timelineEntriesTable.linkedEntityId, id)),
  ]);

  const allEntityIds = new Set<number>();
  relationships.forEach((r) => {
    allEntityIds.add(r.entityAId);
    allEntityIds.add(r.entityBId);
  });

  const relatedEntities = await db.select().from(entitiesTable);
  const entityMap = Object.fromEntries(relatedEntities.map((e) => [e.id, e.name]));

  const documentIds = new Set<number>();
  timelineAppearances.forEach((t) => {
    if (t.linkedDocumentId) documentIds.add(t.linkedDocumentId);
  });
  relationships.forEach((r) => {
    if (r.evidenceDocumentId) documentIds.add(r.evidenceDocumentId);
  });

  let documents: typeof documentsTable.$inferSelect[] = [];
  if (documentIds.size > 0) {
    documents = await db.select().from(documentsTable);
    documents = documents.filter((d) => documentIds.has(d.id));
  }

  res.json({
    entity: formatEntity(entity),
    relationships: relationships.map((r) => ({
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
    })),
    documents: documents.map((d) => ({
      id: d.id,
      title: d.title,
      filePath: d.filePath,
      source: d.source,
      publishDate: d.publishDate,
      uploadedAt: d.uploadedAt.toISOString(),
      caseId: d.caseId,
    })),
    timelineAppearances: timelineAppearances.map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      eventDate: t.eventDate,
      linkedEntityId: t.linkedEntityId,
      linkedEntityName: entityMap[t.linkedEntityId!] || undefined,
      linkedDocumentId: t.linkedDocumentId,
      caseId: t.caseId,
      createdAt: t.createdAt.toISOString(),
    })),
  });
});

router.post("/entities", async (req, res) => {
  const { name, type, description, aliases, caseId } = req.body;
  const rows = await db
    .insert(entitiesTable)
    .values({ name, type, description, aliases: aliases || [], caseId })
    .returning();
  res.status(201).json(formatEntity(rows[0]));
});

router.put("/entities/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const { name, type, description, aliases } = req.body;
  const rows = await db
    .update(entitiesTable)
    .set({ name, type, description, aliases })
    .where(eq(entitiesTable.id, id))
    .returning();
  if (!rows.length) return res.status(404).json({ error: "Not found" });
  res.json(formatEntity(rows[0]));
});

router.delete("/entities/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  await db.delete(entitiesTable).where(eq(entitiesTable.id, id));
  res.status(204).send();
});

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

export default router;
