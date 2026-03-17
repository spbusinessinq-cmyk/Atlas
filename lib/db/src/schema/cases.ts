import { pgTable, text, serial, timestamp, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const casesTable = pgTable("cases", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("open"),
  tags: text("tags").array().default([]),
  compiledBrief: text("compiled_brief"),
  compiledAt: timestamp("compiled_at"),
  // Target intelligence layer (Pass 28)
  targetMode: text("target_mode"),          // person_target | organization_target | ...
  targetLabel: text("target_label"),         // human-readable e.g. "Jeffrey Epstein"
  targetConfidence: real("target_confidence"), // 0.0–1.0
  autoGraphQuality: text("auto_graph_quality"), // STRONG | PROVISIONAL | RECOVERED | WEAK | FAILED
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertCaseSchema = createInsertSchema(casesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertCase = z.infer<typeof insertCaseSchema>;
export type CaseRow = typeof casesTable.$inferSelect;
