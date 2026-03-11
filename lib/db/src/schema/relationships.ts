import { pgTable, text, serial, timestamp, integer, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const relationshipsTable = pgTable("relationships", {
  id: serial("id").primaryKey(),
  entityAId: integer("entity_a_id").notNull(),
  entityBId: integer("entity_b_id").notNull(),
  relationshipType: text("relationship_type").notNull(),
  evidenceDocumentId: integer("evidence_document_id"),
  confidence: real("confidence"),
  dateRange: text("date_range"),
  caseId: integer("case_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertRelationshipSchema = createInsertSchema(relationshipsTable).omit({
  id: true,
  createdAt: true,
});

export type InsertRelationship = z.infer<typeof insertRelationshipSchema>;
export type Relationship = typeof relationshipsTable.$inferSelect;
