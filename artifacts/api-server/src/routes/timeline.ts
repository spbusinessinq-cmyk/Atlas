import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { timelineEntriesTable, entitiesTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

router.get("/timeline", async (req, res) => {
  const caseId = req.query.caseId ? parseInt(req.query.caseId as string) : undefined;
  let rows;
  if (caseId) {
    rows = await db
      .select()
      .from(timelineEntriesTable)
      .where(eq(timelineEntriesTable.caseId, caseId));
  } else {
    rows = await db.select().from(timelineEntriesTable);
  }
  const entities = await db.select().from(entitiesTable);
  const entityMap = Object.fromEntries(entities.map((e) => [e.id, e.name]));
  res.json(rows.map((t) => formatEntry(t, entityMap)));
});

router.post("/timeline", async (req, res) => {
  const { title, description, eventDate, linkedEntityId, linkedDocumentId, caseId } = req.body;
  const rows = await db
    .insert(timelineEntriesTable)
    .values({ title, description, eventDate, linkedEntityId, linkedDocumentId, caseId })
    .returning();
  const entities = await db.select().from(entitiesTable);
  const entityMap = Object.fromEntries(entities.map((e) => [e.id, e.name]));
  res.status(201).json(formatEntry(rows[0], entityMap));
});

router.delete("/timeline/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  await db.delete(timelineEntriesTable).where(eq(timelineEntriesTable.id, id));
  res.status(204).send();
});

function formatEntry(
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

export default router;
