import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  entityMentionsTable,
  entitiesTable,
  documentsTable,
} from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { extractTextFromFile, extractEntities } from "../lib/entity-extractor";

const router: IRouter = Router();

// Analyze a document and extract entity mentions
router.post("/documents/:id/analyze", async (req, res) => {
  const docId = parseInt(req.params.id);
  const docRows = await db.select().from(documentsTable).where(eq(documentsTable.id, docId));
  if (!docRows.length) return res.status(404).json({ error: "Document not found" });

  const doc = docRows[0];

  let text = "";
  let extractionMethod = "text";

  // Web-ingested documents: use stored rawText
  if (doc.ingestMethod === "web" && doc.rawText && doc.rawText.trim().length > 10) {
    text = doc.rawText;
    extractionMethod = "raw-text";
  } else if (doc.filePath) {
    // File-backed document: extract from file
    try {
      text = await extractTextFromFile(doc.filePath);
      if (doc.filePath.toLowerCase().endsWith(".pdf")) extractionMethod = "pdf-parse";
    } catch (err) {
      console.error("Text extraction error:", err);
    }
  }

  // If no text could be extracted, use title + source as fallback
  if (!text || text.trim().length < 10) {
    text = `${doc.title || ""} ${doc.source || ""}`;
    extractionMethod = "metadata-fallback";
  }

  const extracted = extractEntities(text);

  // Delete old pending mentions for this document
  await db
    .delete(entityMentionsTable)
    .where(
      and(
        eq(entityMentionsTable.documentId, docId),
        eq(entityMentionsTable.status, "pending")
      )
    );

  // Insert new mentions
  const inserted = [];
  for (const m of extracted) {
    const rows = await db
      .insert(entityMentionsTable)
      .values({
        documentId: docId,
        caseId: doc.caseId,
        entityName: m.entityName,
        entityType: m.entityType,
        confidence: m.confidence,
        status: "pending",
        context: m.context,
        startPos: m.startPos,
        endPos: m.endPos,
      })
      .returning();
    inserted.push(rows[0]);
  }

  res.json({
    documentId: docId,
    mentionsCreated: inserted.length,
    mentions: inserted.map(formatMention),
    textLength: text.length,
    extractionMethod,
  });
});

// List entity mentions
router.get("/entity-mentions", async (req, res) => {
  const documentId = req.query.documentId ? parseInt(req.query.documentId as string) : undefined;
  const caseId = req.query.caseId ? parseInt(req.query.caseId as string) : undefined;
  const status = req.query.status as string | undefined;

  let query = db.select().from(entityMentionsTable);
  const conditions = [];

  if (documentId) conditions.push(eq(entityMentionsTable.documentId, documentId));
  if (caseId) conditions.push(eq(entityMentionsTable.caseId, caseId));
  if (status) conditions.push(eq(entityMentionsTable.status, status));

  let rows;
  if (conditions.length > 0) {
    rows = await db.select().from(entityMentionsTable).where(and(...conditions));
  } else {
    rows = await db.select().from(entityMentionsTable);
  }

  res.json(rows.map(formatMention));
});

// Approve a mention — creates entity in registry
router.post("/entity-mentions/:id/approve", async (req, res) => {
  const id = parseInt(req.params.id);
  const { caseId, overrideName, overrideType } = req.body || {};

  const mentionRows = await db
    .select()
    .from(entityMentionsTable)
    .where(eq(entityMentionsTable.id, id));
  if (!mentionRows.length) return res.status(404).json({ error: "Mention not found" });

  const mention = mentionRows[0];
  const name = overrideName || mention.entityName;
  const type = overrideType || mention.entityType;
  const resolvedCaseId = caseId || mention.caseId;

  // Create entity
  const entityRows = await db
    .insert(entitiesTable)
    .values({
      name,
      type,
      caseId: resolvedCaseId,
      aliases: [],
    })
    .returning();

  // Mark mention as approved
  await db
    .update(entityMentionsTable)
    .set({ status: "approved" })
    .where(eq(entityMentionsTable.id, id));

  res.json({
    id: entityRows[0].id,
    name: entityRows[0].name,
    type: entityRows[0].type,
    description: entityRows[0].description,
    aliases: entityRows[0].aliases || [],
    caseId: entityRows[0].caseId,
    createdAt: entityRows[0].createdAt.toISOString(),
  });
});

// Reject a mention
router.post("/entity-mentions/:id/reject", async (req, res) => {
  const id = parseInt(req.params.id);
  const rows = await db
    .update(entityMentionsTable)
    .set({ status: "rejected" })
    .where(eq(entityMentionsTable.id, id))
    .returning();
  if (!rows.length) return res.status(404).json({ error: "Mention not found" });
  res.json(formatMention(rows[0]));
});

function formatMention(m: typeof entityMentionsTable.$inferSelect) {
  return {
    id: m.id,
    documentId: m.documentId,
    caseId: m.caseId,
    entityName: m.entityName,
    entityType: m.entityType,
    confidence: m.confidence,
    status: m.status,
    context: m.context,
    startPos: m.startPos,
    endPos: m.endPos,
    createdAt: m.createdAt.toISOString(),
  };
}

export default router;
