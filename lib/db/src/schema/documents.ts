import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const documentsTable = pgTable("documents", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  filePath: text("file_path"),
  source: text("source"),
  publishDate: text("publish_date"),
  uploadedAt: timestamp("uploaded_at").defaultNow().notNull(),
  caseId: integer("case_id"),
  sourceUrl: text("source_url"),
  sourceDomain: text("source_domain"),
  ingestMethod: text("ingest_method").default("upload"),
  rawText: text("raw_text"),
  previewType: text("preview_type").default("file"),
});

export const insertDocumentSchema = createInsertSchema(documentsTable).omit({
  id: true,
  uploadedAt: true,
});

export type InsertDocument = z.infer<typeof insertDocumentSchema>;
export type Document = typeof documentsTable.$inferSelect;
