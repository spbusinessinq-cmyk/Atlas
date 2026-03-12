import { pgTable, text, serial, timestamp, integer, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const financialSignalsTable = pgTable("financial_signals", {
  id: serial("id").primaryKey(),
  amountRaw: text("amount_raw").notNull(),
  normalizedAmount: real("normalized_amount"),
  currency: text("currency").default("USD"),
  signalType: text("signal_type").notNull(),
  eventSummary: text("event_summary"),
  entityName: text("entity_name"),
  entityId: integer("entity_id"),
  documentId: integer("document_id"),
  documentTitle: text("document_title"),
  caseId: integer("case_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertFinancialSignalSchema = createInsertSchema(financialSignalsTable).omit({
  id: true,
  createdAt: true,
});

export type InsertFinancialSignal = z.infer<typeof insertFinancialSignalSchema>;
export type FinancialSignal = typeof financialSignalsTable.$inferSelect;
