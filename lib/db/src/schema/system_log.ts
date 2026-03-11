import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";

export const systemLogTable = pgTable("system_log", {
  id: serial("id").primaryKey(),
  eventType: text("event_type").notNull(),
  message: text("message").notNull(),
  caseId: integer("case_id"),
  entityId: integer("entity_id"),
  documentId: integer("document_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
