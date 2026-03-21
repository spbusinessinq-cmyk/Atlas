import { pgTable, text, serial, timestamp, integer, real, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const financialSignalsTable = pgTable("financial_signals", {
  id: serial("id").primaryKey(),
  amountRaw: text("amount_raw").notNull(),
  amountDisplay: text("amount_display"),
  normalizedAmount: real("normalized_amount"),
  currency: text("currency").default("USD"),
  signalType: text("signal_type").notNull(),
  eventSummary: text("event_summary"),
  entityName: text("entity_name"),
  controlledBy: text("controlled_by"),
  receivedBy: text("received_by"),
  programName: text("program_name"),
  financialConfidence: real("financial_confidence"),
  inferredSignal: boolean("inferred_signal").default(false),
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
