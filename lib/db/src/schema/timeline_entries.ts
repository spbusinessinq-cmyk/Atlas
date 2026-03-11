import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const timelineEntriesTable = pgTable("timeline_entries", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  eventDate: text("event_date").notNull(),
  linkedEntityId: integer("linked_entity_id"),
  linkedDocumentId: integer("linked_document_id"),
  caseId: integer("case_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertTimelineEntrySchema = createInsertSchema(timelineEntriesTable).omit({
  id: true,
  createdAt: true,
});

export type InsertTimelineEntry = z.infer<typeof insertTimelineEntrySchema>;
export type TimelineEntry = typeof timelineEntriesTable.$inferSelect;
