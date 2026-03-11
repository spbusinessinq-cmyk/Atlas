import { pgTable, text, serial, timestamp, integer, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const entityMentionsTable = pgTable("entity_mentions", {
  id: serial("id").primaryKey(),
  documentId: integer("document_id").notNull(),
  caseId: integer("case_id"),
  entityName: text("entity_name").notNull(),
  entityType: text("entity_type").notNull(),
  confidence: real("confidence").notNull().default(0.5),
  status: text("status").notNull().default("pending"),
  context: text("context"),
  startPos: integer("start_pos"),
  endPos: integer("end_pos"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertEntityMentionSchema = createInsertSchema(entityMentionsTable).omit({
  id: true,
  createdAt: true,
});

export type InsertEntityMention = z.infer<typeof insertEntityMentionSchema>;
export type EntityMention = typeof entityMentionsTable.$inferSelect;
