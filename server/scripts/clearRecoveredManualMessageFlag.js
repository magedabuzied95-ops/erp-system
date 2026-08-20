/**
 * Take back the "a human replied here" claim from recovered WhatsApp messages.
 *
 * The Evolution history recovery imports a chat's transcript when the thread is
 * opened, and it used to store every outbound message it found with
 * `manual_message = TRUE`. The inbox reads that flag as "a human already reviewed
 * this conversation", so any of our own automated sends the recovery picked up —
 * an order invoice, an AI reply whose provider id never matched the dedup — marked
 * the thread read and quietly emptied the unread filter.
 *
 * Recovery cannot tell a phone-typed reply from an automated one, so it no longer
 * claims either way (whatsappGatewayService). This clears the claim on the rows
 * written while it did. Only rows the recovery itself inserted are touched —
 * `source_path = 'evolution_history_recovery'` — so a real manual reply sent from
 * the ERP keeps its flag. Reading state is not modified: a conversation a human
 * actually opened stays read through `read_at`.
 *
 *   node server/scripts/clearRecoveredManualMessageFlag.js            # dry run
 *   node server/scripts/clearRecoveredManualMessageFlag.js --apply
 */
import db from "../database/db.js";

const APPLY = process.argv.includes("--apply");

const { rows: [before] } = await db.query(`
  SELECT
    COUNT(*)::int AS rows_flagged,
    COUNT(DISTINCT session_id)::int AS conversations
  FROM ai_support_messages
  WHERE source_path = 'evolution_history_recovery'
    AND manual_message = TRUE
`);

console.log("[recovered-manual-flag] rows carrying the claim:", before);

if (!before.rows_flagged) {
  console.log("[recovered-manual-flag] nothing to clear.");
  process.exit(0);
}

if (!APPLY) {
  console.log("[recovered-manual-flag] dry run — re-run with --apply to clear them.");
  process.exit(0);
}

const { rowCount } = await db.query(`
  UPDATE ai_support_messages
  SET manual_message = FALSE
  WHERE source_path = 'evolution_history_recovery'
    AND manual_message = TRUE
`);

console.log("[recovered-manual-flag] cleared:", rowCount);
process.exit(0);
