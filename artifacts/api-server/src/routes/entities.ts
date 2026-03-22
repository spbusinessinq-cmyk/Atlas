import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  entitiesTable,
  relationshipsTable,
  documentsTable,
  timelineEntriesTable,
  entityMentionsTable,
  financialSignalsTable,
} from "@workspace/db/schema";
import { eq, or, and, inArray, ilike } from "drizzle-orm";
import { logEvent } from "../lib/log-event";

const router: IRouter = Router();

router.get("/entities", async (req, res) => {
  const caseId = req.query.caseId ? parseInt(req.query.caseId as string) : undefined;
  let rows;
  if (caseId) {
    rows = await db.select().from(entitiesTable).where(eq(entitiesTable.caseId, caseId));
  } else {
    rows = await db.select().from(entitiesTable);
  }

  if (rows.length === 0) return res.json([]);

  const names = rows.map((e) => e.name.toLowerCase());
  const allMentions = await db
    .select({ entityName: entityMentionsTable.entityName, documentId: entityMentionsTable.documentId, status: entityMentionsTable.status })
    .from(entityMentionsTable);

  const mentionCountMap = new Map<string, number>();
  const docCountMap = new Map<string, Set<number>>();
  for (const m of allMentions) {
    if (m.status !== "approved") continue;
    const key = m.entityName.toLowerCase();
    mentionCountMap.set(key, (mentionCountMap.get(key) || 0) + 1);
    if (!docCountMap.has(key)) docCountMap.set(key, new Set());
    docCountMap.get(key)!.add(m.documentId);
  }

  return res.json(
    rows.map((e) => {
      const key = e.name.toLowerCase();
      return {
        ...formatEntity(e),
        mentionCount: mentionCountMap.get(key) || 0,
        documentCount: docCountMap.get(key)?.size || 0,
      };
    })
  );
});

router.get("/entities/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const rows = await db.select().from(entitiesTable).where(eq(entitiesTable.id, id));
  if (!rows.length) return res.status(404).json({ error: "Not found" });

  const entity = rows[0];

  const mentionFilter = entity.caseId
    ? and(ilike(entityMentionsTable.entityName, entity.name), eq(entityMentionsTable.caseId, entity.caseId))
    : ilike(entityMentionsTable.entityName, entity.name);

  const sigFilter = entity.caseId
    ? and(ilike(financialSignalsTable.entityName, entity.name), eq(financialSignalsTable.caseId, entity.caseId))
    : ilike(financialSignalsTable.entityName, entity.name);

  const [mentions, relationships, timelineAppearances, financialSignals] = await Promise.all([
    db.select().from(entityMentionsTable).where(mentionFilter),
    db
      .select()
      .from(relationshipsTable)
      .where(or(eq(relationshipsTable.entityAId, id), eq(relationshipsTable.entityBId, id))),
    db.select().from(timelineEntriesTable).where(eq(timelineEntriesTable.linkedEntityId, id)),
    db.select().from(financialSignalsTable).where(sigFilter as any),
  ]);

  const mentionDocIds = [...new Set(mentions.map((m) => m.documentId))];

  let linkedDocuments: typeof documentsTable.$inferSelect[] = [];
  if (mentionDocIds.length > 0) {
    linkedDocuments = await db
      .select()
      .from(documentsTable)
      .where(inArray(documentsTable.id, mentionDocIds));
  }

  const mentionCountByDoc: Record<number, number> = {};
  for (const m of mentions) {
    mentionCountByDoc[m.documentId] = (mentionCountByDoc[m.documentId] || 0) + 1;
  }

  let allDocMentions: typeof entityMentionsTable.$inferSelect[] = [];
  if (mentionDocIds.length > 0) {
    allDocMentions = await db
      .select()
      .from(entityMentionsTable)
      .where(
        and(
          inArray(entityMentionsTable.documentId, mentionDocIds),
          eq(entityMentionsTable.status, "approved")
        )
      );
  }

  const coMentionMap = new Map<string, number>();
  const entityNameLower = entity.name.toLowerCase();
  for (const m of mentions) {
    for (const m2 of allDocMentions) {
      if (m2.documentId === m.documentId && m2.entityName.toLowerCase() !== entityNameLower) {
        coMentionMap.set(m2.entityName, (coMentionMap.get(m2.entityName) || 0) + 1);
      }
    }
  }
  const coMentioned = Array.from(coMentionMap.entries())
    .map(([name, count]) => ({
      name,
      count,
      score: count >= 3 ? "HIGH" : count >= 2 ? "MEDIUM" : "LOW",
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  const sortedMentions = [...mentions].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
  const firstSeen = sortedMentions.length > 0 ? sortedMentions[0].createdAt.toISOString() : null;
  const lastSeen =
    sortedMentions.length > 0
      ? sortedMentions[sortedMentions.length - 1].createdAt.toISOString()
      : null;

  const allEntityIds = new Set<number>();
  relationships.forEach((r) => {
    allEntityIds.add(r.entityAId);
    allEntityIds.add(r.entityBId);
  });
  const relatedEntities = await db.select().from(entitiesTable);
  const entityMap = Object.fromEntries(relatedEntities.map((e) => [e.id, e.name]));

  const docIdSet = new Set<number>();
  timelineAppearances.forEach((t) => {
    if (t.linkedDocumentId) docIdSet.add(t.linkedDocumentId);
  });
  relationships.forEach((r) => {
    if (r.evidenceDocumentId) docIdSet.add(r.evidenceDocumentId);
  });

  return res.json({
    entity: formatEntity(entity),
    financialSignals: financialSignals.map((s) => ({
      id: s.id,
      amountRaw: s.amountRaw,
      normalizedAmount: s.normalizedAmount,
      currency: s.currency || "USD",
      signalType: s.signalType,
      eventSummary: s.eventSummary,
      entityName: s.entityName,
      documentId: s.documentId,
      documentTitle: s.documentTitle,
      caseId: s.caseId,
      createdAt: s.createdAt.toISOString(),
    })),
    mentions: mentions.map((m) => ({
      id: m.id,
      documentId: m.documentId,
      entityName: m.entityName,
      entityType: m.entityType,
      confidence: m.confidence,
      status: m.status,
      context: m.context,
      createdAt: m.createdAt.toISOString(),
    })),
    mentionCounts: {
      total: mentions.length,
      approved: mentions.filter((m) => m.status === "approved").length,
      pending: mentions.filter((m) => m.status === "pending").length,
      rejected: mentions.filter((m) => m.status === "rejected").length,
    },
    firstSeen,
    lastSeen,
    linkedDocuments: linkedDocuments.map((d) => ({
      id: d.id,
      title: d.title,
      source: d.source,
      sourceDomain: (d as any).sourceDomain || null,
      ingestMethod: (d as any).ingestMethod || "upload",
      uploadedAt: d.uploadedAt.toISOString(),
      caseId: d.caseId,
      mentionCount: mentionCountByDoc[d.id] || 0,
    })),
    coMentioned,
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
    documents: linkedDocuments.map((d) => ({
      id: d.id,
      title: d.title,
      source: d.source,
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
  return res.status(201).json(formatEntity(rows[0]));
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
  return res.json(formatEntity(rows[0]));
});

router.delete("/entities/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const rows = await db.select().from(entitiesTable).where(eq(entitiesTable.id, id));
  if (!rows.length) return res.status(404).json({ error: "Not found" });
  const entity = rows[0];

  await db
    .delete(relationshipsTable)
    .where(or(eq(relationshipsTable.entityAId, id), eq(relationshipsTable.entityBId, id)));

  await db.delete(entitiesTable).where(eq(entitiesTable.id, id));

  await logEvent(
    "entity_deleted",
    `Entity deleted: ${entity.name} [${entity.type.replace(/_/g, " ").toUpperCase()}]`,
    { caseId: entity.caseId ?? undefined, entityId: id }
  );

  return res.status(204).send();
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
