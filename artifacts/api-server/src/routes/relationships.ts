import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { relationshipsTable, entitiesTable, relationshipEvidenceTable } from "@workspace/db/schema";
import { eq, or } from "drizzle-orm";

const router: IRouter = Router();

router.get("/relationships", async (req, res) => {
  const entityId = req.query.entityId ? parseInt(req.query.entityId as string) : undefined;
  const caseId = req.query.caseId ? parseInt(req.query.caseId as string) : undefined;

  let rows;
  if (entityId) {
    rows = await db
      .select()
      .from(relationshipsTable)
      .where(
        or(
          eq(relationshipsTable.entityAId, entityId),
          eq(relationshipsTable.entityBId, entityId)
        )
      );
  } else if (caseId) {
    rows = await db
      .select()
      .from(relationshipsTable)
      .where(eq(relationshipsTable.caseId, caseId));
  } else {
    rows = await db.select().from(relationshipsTable);
  }

  const entities = await db.select().from(entitiesTable);
  const entityMap = Object.fromEntries(entities.map((e) => [e.id, e.name]));

  // Get evidence counts
  const allEvidence = await db.select().from(relationshipEvidenceTable);
  const evidenceCounts: Record<number, number> = {};
  allEvidence.forEach((e) => {
    evidenceCounts[e.relationshipId] = (evidenceCounts[e.relationshipId] || 0) + 1;
  });

  res.json(rows.map((r) => formatRelationship(r, entityMap, evidenceCounts)));
});

router.post("/relationships", async (req, res) => {
  const { entityAId, entityBId, relationshipType, evidenceDocumentId, confidence, dateRange, caseId } =
    req.body;
  const rows = await db
    .insert(relationshipsTable)
    .values({ entityAId, entityBId, relationshipType, evidenceDocumentId, confidence, dateRange, caseId })
    .returning();

  const entities = await db.select().from(entitiesTable);
  const entityMap = Object.fromEntries(entities.map((e) => [e.id, e.name]));
  res.status(201).json(formatRelationship(rows[0], entityMap, {}));
});

router.delete("/relationships/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  await db.delete(relationshipsTable).where(eq(relationshipsTable.id, id));
  res.status(204).send();
});

function formatRelationship(
  r: typeof relationshipsTable.$inferSelect,
  entityMap: Record<number, string>,
  evidenceCounts: Record<number, number>
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
    evidenceCount: evidenceCounts[r.id] || 0,
    createdAt: r.createdAt.toISOString(),
  };
}

export default router;
