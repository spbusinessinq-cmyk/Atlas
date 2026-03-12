import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  entityMentionsTable,
  entitiesTable,
  documentsTable,
  timelineEntriesTable,
  financialSignalsTable,
} from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { extractTextFromFile, extractEntities, extractTimelineEvents, extractFinancialSignals } from "../lib/entity-extractor";
import { logEvent } from "../lib/log-event";

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

  // Parse extraction diagnostics from ATLAS-DIAG prefix (new format)
  const diagMatch = text.match(/^\[ATLAS-DIAG:([^\]]+)\]/);
  const diagData: Record<string, string> = {};
  if (diagMatch) {
    diagMatch[1].split("|").forEach((pair) => {
      const [k, v] = pair.split("=");
      if (k && v !== undefined) diagData[k] = v;
    });
  }

  const diagStatus = diagData.status || null;

  // Strip all known prefixes to get clean article text
  const cleanText = text
    .replace(/^\[ATLAS-DIAG:[^\]]+\]\n?/, "")
    .replace(/^\[EXTRACTION_INCOMPLETE\]\n?/, "")
    .replace(/^\[EXTRACTION_FAILED\]\n?/, "")
    .replace(/^\[WRAPPER_BLOCKED\]\n?/, "")
    .replace(/^\[FETCH_FAILED\]\n?/, "")
    .trim();

  // Guard: don't run NER on failed/wrapper content
  const isSkipped = diagStatus === "failed" || diagStatus === "wrapper"
    || text.includes("[WRAPPER_BLOCKED]")
    || text.includes("[EXTRACTION_FAILED]")
    || text.includes("[FETCH_FAILED]");

  if (isSkipped) {
    return res.json({
      documentId: docId,
      mentionsCreated: 0,
      timelineEventsCreated: 0,
      financialSignalsCreated: 0,
      mentions: [],
      textLength: 0,
      extractionMethod: diagStatus === "wrapper" ? "wrapper-blocked" : "failed",
      warning: diagStatus === "wrapper"
        ? "Document is a wrapper/redirect page — no usable article body recovered. Analysis skipped."
        : "Document extraction failed — no usable article body recovered. Analysis skipped.",
    });
  }

  const extracted = extractEntities(cleanText);

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

  // ── Timeline event extraction ───────────────────────────────────────────────
  const timelineEvents = extractTimelineEvents(cleanText);
  let timelineInserted = 0;
  for (const ev of timelineEvents) {
    try {
      await db.insert(timelineEntriesTable).values({
        title: ev.eventType.replace(/_/g, " ") + ": " + ev.summary.slice(0, 80),
        description: ev.summary,
        eventDate: ev.eventDate,
        linkedDocumentId: docId,
        caseId: doc.caseId,
      });
      timelineInserted++;
    } catch { /* skip duplicates */ }
  }
  if (timelineInserted > 0) {
    await logEvent(
      "timeline_event_detected",
      `${timelineInserted} timeline event${timelineInserted !== 1 ? "s" : ""} extracted from "${doc.title || `DOC-${docId}`}"`,
      { caseId: doc.caseId, documentId: docId }
    );
  }

  // ── Financial signal extraction ──────────────────────────────────────────────
  const financialSignals = extractFinancialSignals(cleanText);
  let signalInserted = 0;
  for (const sig of financialSignals) {
    try {
      await db.insert(financialSignalsTable).values({
        amountRaw: sig.amountRaw,
        normalizedAmount: sig.normalizedAmount ?? undefined,
        currency: sig.currency,
        signalType: sig.signalType,
        eventSummary: sig.eventSummary,
        entityName: sig.entityName,
        documentId: docId,
        documentTitle: doc.title,
        caseId: doc.caseId,
      });
      signalInserted++;
    } catch { /* skip duplicates */ }
  }
  if (signalInserted > 0) {
    await logEvent(
      "financial_signal_detected",
      `${signalInserted} financial signal${signalInserted !== 1 ? "s" : ""} extracted from "${doc.title || `DOC-${docId}`}"`,
      { caseId: doc.caseId, documentId: docId }
    );
  }

  await logEvent(
    "analysis_completed",
    `Analysis completed on "${doc.title || `DOC-${docId}`}": ${inserted.length} entity detections, ${timelineInserted} timeline events, ${signalInserted} financial signals`,
    { caseId: doc.caseId, documentId: docId }
  );

  res.json({
    documentId: docId,
    mentionsCreated: inserted.length,
    timelineEventsCreated: timelineInserted,
    financialSignalsCreated: signalInserted,
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

  await logEvent(
    "entity_approved",
    `Entity approved: ${name} [${type.replace(/_/g, " ").toUpperCase()}]`,
    { caseId: resolvedCaseId, entityId: entityRows[0].id }
  );

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

  const mention = rows[0];
  await logEvent(
    "entity_rejected",
    `Detection rejected: ${mention.entityName} [${mention.entityType.replace(/_/g, " ").toUpperCase()}]`,
    { caseId: mention.caseId }
  );

  res.json(formatMention(mention));
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
