import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { relationshipEvidenceTable, documentsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

router.get("/relationship-evidence", async (req, res) => {
  const relationshipId = req.query.relationshipId
    ? parseInt(req.query.relationshipId as string)
    : undefined;
  if (!relationshipId)
    return res.status(400).json({ error: "relationshipId is required" });

  const rows = await db
    .select()
    .from(relationshipEvidenceTable)
    .where(eq(relationshipEvidenceTable.relationshipId, relationshipId));

  // Enrich with document titles
  const docIds = [...new Set(rows.map((r) => r.documentId))];
  let docMap: Record<number, string> = {};
  if (docIds.length > 0) {
    const docs = await db.select().from(documentsTable);
    docs.forEach((d) => { docMap[d.id] = d.title; });
  }

  res.json(
    rows.map((r) => ({
      id: r.id,
      relationshipId: r.relationshipId,
      documentId: r.documentId,
      documentTitle: docMap[r.documentId] || `Document ${r.documentId}`,
      excerpt: r.excerpt,
      createdAt: r.createdAt.toISOString(),
    }))
  );
});

router.post("/relationship-evidence", async (req, res) => {
  const { relationshipId, documentId, excerpt } = req.body;
  const rows = await db
    .insert(relationshipEvidenceTable)
    .values({ relationshipId, documentId, excerpt })
    .returning();

  const docs = await db.select().from(documentsTable);
  const docMap: Record<number, string> = {};
  docs.forEach((d) => { docMap[d.id] = d.title; });

  const r = rows[0];
  res.status(201).json({
    id: r.id,
    relationshipId: r.relationshipId,
    documentId: r.documentId,
    documentTitle: docMap[r.documentId] || `Document ${r.documentId}`,
    excerpt: r.excerpt,
    createdAt: r.createdAt.toISOString(),
  });
});

router.delete("/relationship-evidence/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  await db.delete(relationshipEvidenceTable).where(eq(relationshipEvidenceTable.id, id));
  res.status(204).send();
});

export default router;
