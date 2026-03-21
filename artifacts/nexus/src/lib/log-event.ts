const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

export async function logEvent(
  eventType: string,
  message: string,
  meta?: { caseId?: number; entityId?: number; documentId?: number }
) {
  try {
    await fetch(`${BASE}/api/system-log`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventType, message, ...meta }),
    });
  } catch {
    // non-critical, swallow
  }
}
