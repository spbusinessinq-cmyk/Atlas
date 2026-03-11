import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const relationshipEvidenceTable = pgTable("relationship_evidence", {
  id: serial("id").primaryKey(),
  relationshipId: integer("relationship_id").notNull(),
  documentId: integer("document_id").notNull(),
  excerpt: text("excerpt"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertRelationshipEvidenceSchema = createInsertSchema(relationshipEvidenceTable).omit({
  id: true,
  createdAt: true,
});

export type InsertRelationshipEvidence = z.infer<typeof insertRelationshipEvidenceSchema>;
export type RelationshipEvidence = typeof relationshipEvidenceTable.$inferSelect;
