import { db } from "@workspace/db";
import { systemLogTable } from "@workspace/db/schema";

export async function logEvent(
  eventType: string,
  message: string,
  meta?: { caseId?: number | null; entityId?: number | null; documentId?: number | null }
) {
  try {
    await db.insert(systemLogTable).values({
      eventType,
      message,
      caseId: meta?.caseId ?? null,
      entityId: meta?.entityId ?? null,
      documentId: meta?.documentId ?? null,
    });
  } catch (err) {
    console.error("[logEvent] failed:", err);
  }
}
