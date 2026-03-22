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
import { extractTextFromFile, extractEntities, extractTimelineEvents, extractFinancialSignals, isBudgetDocument, extractBudgetRows } from "../lib/entity-extractor";
import { compileCaseBrief, saveCaseBrief } from "../lib/case-compiler";
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

  // Use stored rawText when available (covers web-ingest, manual entry, and any document with body text)
  if (doc.rawText && doc.rawText.trim().length > 10) {
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

  // T003: Deduplicate extracted entities by lowercase name before insert
  const dedupedExtracted = [...new Map(extracted.map(m => [m.entityName.toLowerCase(), m])).values()];

  // Insert new mentions
  const inserted = [];
  for (const m of dedupedExtracted) {
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

  // T006: Year filter — only insert events within ±2 years of the document date
  const docDateRaw = doc.publishDate || (doc.uploadedAt instanceof Date ? doc.uploadedAt.toISOString() : doc.uploadedAt) || null;
  const docYear = docDateRaw ? new Date(docDateRaw).getFullYear() : null;
  const JUNK_TIMELINE_TYPES = new Set(["SPORTS", "ENTERTAINMENT", "CELEBRITY", "GAME"]);
  const JUNK_TIMELINE_RE = /\b(episode|season|recap|watch|documentary|film|movie|concert|game\s+result|match\s+result|tournament|playoff|bracket|stream\s+now|box\s+office)\b/i;

  for (const ev of timelineEvents) {
    // T006: Year validity check (±2 years from document date, when date is known)
    if (docYear && ev.eventDate) {
      const evYear = new Date(ev.eventDate).getFullYear();
      if (Math.abs(evYear - docYear) > 2) continue; // skip clearly out-of-range events
    }
    // T006: Block explicitly junk types but allow "EVENT" fallback through
    if (ev.eventType && JUNK_TIMELINE_TYPES.has(ev.eventType.toUpperCase())) continue;
    // T006: Junk content filter on summary text
    if (JUNK_TIMELINE_RE.test(ev.summary)) continue;
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
  // Clear old signals for this document (re-analysis produces fresh extraction)
  await db.delete(financialSignalsTable).where(eq(financialSignalsTable.documentId, docId));

  // Detect budget mode
  const budgetMode = isBudgetDocument(cleanText);

  // Normal sentence-level extraction (prose/news documents)
  const financialSignals = extractFinancialSignals(cleanText);

  // Budget table extraction (for fiscal/budget documents — bypasses sentence gates)
  const budgetSignals = budgetMode ? extractBudgetRows(cleanText, doc.title ?? "") : [];

  // Merge: budget signals first (higher confidence), then prose signals
  const allSignals = [...budgetSignals, ...financialSignals];

  // T005: Link financial signals to known entities from this document
  // If a signal has no entityName, try to find a matching extracted entity by name overlap
  const knownEntityNames = dedupedExtracted.map(m => m.entityName);
  const linkedSignals = allSignals.map(sig => {
    if (!sig.entityName && knownEntityNames.length > 0) {
      const match = knownEntityNames.find(eName =>
        sig.programName?.toLowerCase().includes(eName.toLowerCase()) ||
        sig.eventSummary?.toLowerCase().includes(eName.toLowerCase())
      );
      if (match) return { ...sig, entityName: match };
    }
    return sig;
  });

  let signalInserted = 0;
  for (const sig of linkedSignals) {
    try {
      await db.insert(financialSignalsTable).values({
        amountRaw: sig.amountRaw,
        amountDisplay: sig.amountDisplay ?? null,
        normalizedAmount: sig.normalizedAmount ?? undefined,
        currency: sig.currency,
        signalType: sig.signalType,
        eventSummary: sig.eventSummary,
        entityName: sig.entityName ?? null,
        controlledBy: sig.controlledBy ?? null,
        receivedBy: sig.receivedBy ?? null,
        programName: sig.programName ?? null,
        financialConfidence: sig.financialConfidence ?? null,
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

  // T003: Async case compile — update brief after new signals arrive
  if (doc.caseId) {
    compileCaseBrief(doc.caseId)
      .then((brief) => saveCaseBrief(doc.caseId!, brief))
      .catch((err) => console.error("[ATLAS] Post-analyze compile error:", err));
  }

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

// PATCH /entity-mentions/:id — update status directly (confirm/rejected for triage)
router.patch("/entity-mentions/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const { status } = req.body;
  if (!["pending", "approved", "rejected"].includes(status)) {
    return res.status(400).json({ error: "Invalid status. Use: pending, approved, rejected" });
  }
  const rows = await db
    .update(entityMentionsTable)
    .set({ status })
    .where(eq(entityMentionsTable.id, id))
    .returning();
  if (!rows.length) return res.status(404).json({ error: "Mention not found" });
  await logEvent("mention_status_updated", `Mention ${id} → ${status}`, { caseId: rows[0].caseId });
  res.json(formatMention(rows[0]));
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
