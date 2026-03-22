import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  casesTable,
  entitiesTable,
  documentsTable,
  relationshipsTable,
  notesTable,
  moneyFlowsTable,
  entityMentionsTable,
  financialSignalsTable,
  relationshipEvidenceTable,
  systemLogTable,
  timelineEntriesTable,
  eventsTable,
} from "@workspace/db/schema";
import { logEvent } from "../lib/log-event";

const router: IRouter = Router();

/**
 * DELETE /admin/wipe
 * Wipes all case data from the system. Irreversible.
 * Requires confirmation token in body: { confirm: "WIPE_ALL_DATA" }
 */
router.delete("/admin/wipe", async (req, res) => {
  const { confirm } = req.body;
  if (confirm !== "WIPE_ALL_DATA") {
    return res.status(400).json({ error: "Confirmation token required: WIPE_ALL_DATA" });
  }

  try {
    // Delete in dependency order: children first, parents last
    await db.delete(financialSignalsTable);
    await db.delete(entityMentionsTable);
    await db.delete(relationshipEvidenceTable);
    await db.delete(relationshipsTable);
    await db.delete(moneyFlowsTable);
    await db.delete(notesTable);
    await db.delete(eventsTable);
    await db.delete(timelineEntriesTable);
    await db.delete(documentsTable);
    await db.delete(entitiesTable);
    await db.delete(systemLogTable);
    await db.delete(casesTable);

    await logEvent("system_wipe", "SYSTEM WIPE EXECUTED — All case data purged from ATLAS", {});

    return res.json({ ok: true, message: "All data purged. ATLAS system wiped." });
  } catch (err: any) {
    console.error("[ADMIN WIPE] Error:", err);
    return res.status(500).json({ error: "Wipe failed: " + err.message });
  }
});

export default router;
