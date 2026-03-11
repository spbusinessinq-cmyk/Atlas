import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { notesTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

router.get("/notes", async (req, res) => {
  const caseId = req.query.caseId ? parseInt(req.query.caseId as string) : undefined;
  if (!caseId) return res.status(400).json({ error: "caseId is required" });
  const rows = await db.select().from(notesTable).where(eq(notesTable.caseId, caseId));
  res.json(rows.map(formatNote));
});

router.post("/notes", async (req, res) => {
  const { caseId, content } = req.body;
  const rows = await db
    .insert(notesTable)
    .values({ caseId, content })
    .returning();
  res.status(201).json(formatNote(rows[0]));
});

router.put("/notes/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const { content } = req.body;
  const rows = await db
    .update(notesTable)
    .set({ content, updatedAt: new Date() })
    .where(eq(notesTable.id, id))
    .returning();
  if (!rows.length) return res.status(404).json({ error: "Not found" });
  res.json(formatNote(rows[0]));
});

router.delete("/notes/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  await db.delete(notesTable).where(eq(notesTable.id, id));
  res.status(204).send();
});

function formatNote(n: typeof notesTable.$inferSelect) {
  return {
    id: n.id,
    caseId: n.caseId,
    content: n.content,
    createdAt: n.createdAt.toISOString(),
    updatedAt: n.updatedAt.toISOString(),
  };
}

export default router;
