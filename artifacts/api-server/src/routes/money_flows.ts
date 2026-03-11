import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { moneyFlowsTable, entitiesTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

router.get("/money-flows", async (req, res) => {
  const caseId = req.query.caseId ? parseInt(req.query.caseId as string) : undefined;
  let rows;
  if (caseId) {
    rows = await db.select().from(moneyFlowsTable).where(eq(moneyFlowsTable.caseId, caseId));
  } else {
    rows = await db.select().from(moneyFlowsTable);
  }
  const entities = await db.select().from(entitiesTable);
  const entityMap = Object.fromEntries(entities.map((e) => [e.id, e.name]));
  res.json(rows.map((m) => formatMoneyFlow(m, entityMap)));
});

router.post("/money-flows", async (req, res) => {
  const {
    sourceEntityId,
    destinationEntityId,
    amount,
    currency,
    date,
    description,
    supportingDocumentId,
    confidenceLevel,
    caseId,
  } = req.body;
  const rows = await db
    .insert(moneyFlowsTable)
    .values({
      sourceEntityId,
      destinationEntityId,
      amount,
      currency: currency || "USD",
      date,
      description,
      supportingDocumentId,
      confidenceLevel,
      caseId,
    })
    .returning();
  const entities = await db.select().from(entitiesTable);
  const entityMap = Object.fromEntries(entities.map((e) => [e.id, e.name]));
  res.status(201).json(formatMoneyFlow(rows[0], entityMap));
});

router.delete("/money-flows/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  await db.delete(moneyFlowsTable).where(eq(moneyFlowsTable.id, id));
  res.status(204).send();
});

function formatMoneyFlow(
  m: typeof moneyFlowsTable.$inferSelect,
  entityMap: Record<number, string>
) {
  return {
    id: m.id,
    sourceEntityId: m.sourceEntityId,
    destinationEntityId: m.destinationEntityId,
    sourceEntityName: entityMap[m.sourceEntityId] || `Entity ${m.sourceEntityId}`,
    destinationEntityName: entityMap[m.destinationEntityId] || `Entity ${m.destinationEntityId}`,
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

export default router;
