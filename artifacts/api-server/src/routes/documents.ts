import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { documentsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import multer from "multer";
import path from "path";
import fs from "fs";
import { logEvent } from "../lib/log-event";

const router: IRouter = Router();

const uploadDir = process.env.UPLOAD_DIR || "./uploads";
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const ABS_UPLOAD_DIR = path.resolve(uploadDir);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${unique}${path.extname(file.originalname)}`);
  },
});
const upload = multer({ storage });

/** Resolve a stored filePath like `/uploads/foo.pdf` to an absolute disk path. */
function resolveFilePath(filePath: string): string {
  const filename = filePath.replace(/^\/uploads\//, "");
  return path.join(ABS_UPLOAD_DIR, filename);
}

router.get("/documents", async (req, res) => {
  const caseId = req.query.caseId ? parseInt(req.query.caseId as string) : undefined;
  let rows;
  if (caseId) {
    rows = await db.select().from(documentsTable).where(eq(documentsTable.caseId, caseId));
  } else {
    rows = await db.select().from(documentsTable);
  }
  res.json(rows.map(formatDoc));
});

router.get("/documents/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const rows = await db.select().from(documentsTable).where(eq(documentsTable.id, id));
  if (!rows.length) return res.status(404).json({ error: "Not found" });
  res.json(formatDoc(rows[0]));
});

/**
 * Serve the raw file inline — used by the viewer iframe / img.
 * Routing through /api/documents/:id/file ensures Replit proxy routes it
 * to the API server (not the Nexus frontend).
 */
router.get("/documents/:id/file", async (req, res) => {
  const id = parseInt(req.params.id);
  const rows = await db.select().from(documentsTable).where(eq(documentsTable.id, id));
  if (!rows.length) return res.status(404).json({ error: "Not found" });
  const doc = rows[0];
  if (!doc.filePath) return res.status(404).json({ error: "No file attached to this document" });

  const absPath = resolveFilePath(doc.filePath);
  if (!fs.existsSync(absPath)) {
    return res.status(404).json({ error: "File not found on disk" });
  }

  res.sendFile(absPath);
});

/**
 * Force-download the file as an attachment.
 * Using Content-Disposition: attachment prevents the browser from treating
 * this as an in-app navigation.
 */
router.get("/documents/:id/download", async (req, res) => {
  const id = parseInt(req.params.id);
  const rows = await db.select().from(documentsTable).where(eq(documentsTable.id, id));
  if (!rows.length) return res.status(404).json({ error: "Not found" });
  const doc = rows[0];
  if (!doc.filePath) return res.status(404).json({ error: "No file attached to this document" });

  const absPath = resolveFilePath(doc.filePath);
  if (!fs.existsSync(absPath)) {
    return res.status(404).json({ error: "File not found on disk" });
  }

  const ext = path.extname(doc.filePath);
  const safeTitle = (doc.title || "document").replace(/[^a-zA-Z0-9_\-. ]/g, "_");
  const downloadName = `${safeTitle}${ext}`;

  res.download(absPath, downloadName);
});

router.post("/documents", async (req, res) => {
  const { title, filePath, source, publishDate, caseId } = req.body;
  const rows = await db
    .insert(documentsTable)
    .values({ title, filePath, source, publishDate, caseId })
    .returning();
  res.status(201).json(formatDoc(rows[0]));
});

router.post("/documents/upload", upload.single("file"), async (req, res) => {
  const { caseId, title, source, publishDate } = req.body;
  const file = req.file;
  if (!file) return res.status(400).json({ error: "No file provided" });

  const filePath = `/uploads/${file.filename}`;
  const docTitle = title || file.originalname;
  const parsedCaseId = caseId ? parseInt(caseId) : undefined;

  const rows = await db
    .insert(documentsTable)
    .values({
      title: docTitle,
      filePath,
      source,
      publishDate,
      caseId: parsedCaseId,
    })
    .returning();

  const doc = rows[0];
  await logEvent(
    "document_ingested",
    `Document uploaded: ${docTitle}`,
    { caseId: parsedCaseId, documentId: doc.id }
  );

  res.status(201).json(formatDoc(doc));
});

router.delete("/documents/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  await db.delete(documentsTable).where(eq(documentsTable.id, id));
  res.status(204).send();
});

function formatDoc(d: typeof documentsTable.$inferSelect) {
  return {
    id: d.id,
    title: d.title,
    filePath: d.filePath ?? null,
    source: d.source ?? null,
    publishDate: d.publishDate ?? null,
    uploadedAt: d.uploadedAt.toISOString(),
    caseId: d.caseId ?? null,
    sourceUrl: d.sourceUrl ?? null,
    sourceDomain: d.sourceDomain ?? null,
    ingestMethod: d.ingestMethod ?? "upload",
    rawText: d.rawText ?? null,
    previewType: d.previewType ?? "file",
  };
}

export default router;
