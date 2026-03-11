import { pgTable, text, serial, timestamp, integer, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const moneyFlowsTable = pgTable("money_flows", {
  id: serial("id").primaryKey(),
  sourceEntityId: integer("source_entity_id").notNull(),
  destinationEntityId: integer("destination_entity_id").notNull(),
  amount: real("amount").notNull(),
  date: text("date"),
  description: text("description"),
  supportingDocumentId: integer("supporting_document_id"),
  caseId: integer("case_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertMoneyFlowSchema = createInsertSchema(moneyFlowsTable).omit({
  id: true,
  createdAt: true,
});

export type InsertMoneyFlow = z.infer<typeof insertMoneyFlowSchema>;
export type MoneyFlow = typeof moneyFlowsTable.$inferSelect;
