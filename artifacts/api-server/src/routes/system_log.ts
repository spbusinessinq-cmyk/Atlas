import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { systemLogTable } from "@workspace/db/schema";
import { eq, desc } from "drizzle-orm";

const router: IRouter = Router();

router.get("/system-log", async (req, res) => {
  const caseId = req.query.caseId ? parseInt(req.query.caseId as string) : undefined;

  let rows;
  if (caseId) {
    rows = await db
      .select()
      .from(systemLogTable)
      .where(eq(systemLogTable.caseId, caseId))
      .orderBy(desc(systemLogTable.createdAt))
      .limit(200);
  } else {
    rows = await db
      .select()
      .from(systemLogTable)
      .orderBy(desc(systemLogTable.createdAt))
      .limit(200);
  }

  res.json(
    rows.map((r) => ({
      id: r.id,
      eventType: r.eventType,
      message: r.message,
      caseId: r.caseId,
      entityId: r.entityId,
      documentId: r.documentId,
      createdAt: r.createdAt.toISOString(),
    }))
  );
});

export default router;
