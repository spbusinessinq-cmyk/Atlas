import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { eventsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

router.get("/events", async (req, res) => {
  const caseId = req.query.caseId ? parseInt(req.query.caseId as string) : undefined;
  let rows;
  if (caseId) {
    rows = await db.select().from(eventsTable).where(eq(eventsTable.caseId, caseId));
  } else {
    rows = await db.select().from(eventsTable);
  }
  res.json(rows.map(formatEvent));
});

router.post("/events", async (req, res) => {
  const { title, location, latitude, longitude, source, timestamp, caseId } = req.body;
  const rows = await db
    .insert(eventsTable)
    .values({ title, location, latitude, longitude, source, timestamp, caseId })
    .returning();
  res.status(201).json(formatEvent(rows[0]));
});

router.delete("/events/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  await db.delete(eventsTable).where(eq(eventsTable.id, id));
  res.status(204).send();
});

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

export default router;
