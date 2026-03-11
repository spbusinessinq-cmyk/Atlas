import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { documentsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import multer from "multer";
import path from "path";
import fs from "fs";

const router: IRouter = Router();

const uploadDir = process.env.UPLOAD_DIR || "./uploads";
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${unique}${path.extname(file.originalname)}`);
  },
});
const upload = multer({ storage });

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

  const rows = await db
    .insert(documentsTable)
    .values({
      title: docTitle,
      filePath,
      source,
      publishDate,
      caseId: caseId ? parseInt(caseId) : undefined,
    })
    .returning();
  res.status(201).json(formatDoc(rows[0]));
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
    filePath: d.filePath,
    source: d.source,
    publishDate: d.publishDate,
    uploadedAt: d.uploadedAt.toISOString(),
    caseId: d.caseId,
  };
}

export default router;
