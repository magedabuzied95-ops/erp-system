import { writeFileSync } from "node:fs";

import db from "../database/db.js";

/* ======================================================
   MERGE THE OUTBOUND ECHOES THAT NEVER FOUND THEIR ROW
   ------------------------------------------------------
   An outbound message we sent through Evolution was written twice:

     ours          message_type product_card, the product cards, delivery "sent", NO provider id
     the echo      message_type text, no cards, the Evolution id, delivery "delivered"

   The cause was one read: the send response puts its id at result.key.id and the reader knew only
   the Cloud shapes, so our row was stored with an empty provider id. Delivery reconciliation could
   not correlate the echo to it and inserted the echo as a new message.

   The customer received ONE message. Both rows are the same send, and each holds half of it — so
   this MERGES rather than deletes: the provider id and the observed delivery status move onto our
   row (the one with the cards), and the bare echo is removed.

   A pair is only ever declared a duplicate when all of these hold, so nothing is matched by text
   alone: same conversation, same direction, identical body, our row has NO provider id, the echo
   DOES, and the echo lands within 120 seconds. A row that already carries a provider id is never
   touched, and neither is a real second send — that has its own id.

   Dry run by default; the CSV is written either way. Pass --apply to change anything.

     node server/scripts/mergeUnmatchedOutboundWhatsappEchoes.js
     node server/scripts/mergeUnmatchedOutboundWhatsappEchoes.js --apply
====================================================== */

const APPLY = process.argv.includes("--apply");
const WINDOW_SECONDS = 120;
const clip = (value = "", length = 46) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, length);
const csvCell = (value = "") => `"${String(value ?? "").replace(/"/g, '""').replace(/\r?\n/g, " ")}"`;

const run = async () => {
  const { rows } = await db.query(
    `
    SELECT
      ours.id            AS ours_id,
      ours.session_id    AS session_id,
      ours.sender_type   AS sender_type,
      ours.message_type  AS ours_type,
      COALESCE(ours.insert_source, '')     AS ours_source,
      COALESCE(ours.delivery_status, '')   AS ours_delivery,
      echo.id            AS echo_id,
      COALESCE(echo.insert_source, '')     AS echo_source,
      COALESCE(echo.external_message_id,'')AS echo_provider_id,
      COALESCE(echo.delivery_status, '')   AS echo_delivery,
      COALESCE(echo.whatsapp_instance, '') AS echo_instance,
      COALESCE(echo.remote_jid, '')        AS echo_remote_jid,
      COALESCE(ours.ai_answer, '')         AS body,
      ours.created_at    AS ours_at,
      ROUND(EXTRACT(EPOCH FROM (echo.created_at - ours.created_at))::numeric, 1) AS gap_seconds
    FROM ai_support_messages ours
    JOIN ai_support_messages echo
      ON  echo.session_id  = ours.session_id
      AND echo.channel     = 'whatsapp'
      AND echo.id         <> ours.id
      AND echo.sender_type IN ('staff', 'ai', 'system')
      AND COALESCE(echo.ai_answer, '') = COALESCE(ours.ai_answer, '')
      AND COALESCE(echo.external_message_id, '') <> ''
      AND echo.created_at BETWEEN ours.created_at AND ours.created_at + ($1 || ' seconds')::interval
    WHERE ours.channel = 'whatsapp'
      AND ours.sender_type IN ('staff', 'ai', 'system')
      AND COALESCE(ours.ai_answer, '') <> ''
      AND COALESCE(ours.external_message_id, '') = ''
    ORDER BY ours.created_at DESC
    `,
    [String(WINDOW_SECONDS)]
  );

  if (!rows.length) {
    console.log("nothing to merge — every outbound row already carries its provider id");
    return;
  }

  // One echo must not be merged into two rows, and one row must not swallow two echoes.
  const takenOurs = new Set();
  const takenEcho = new Set();
  const pairs = [];
  for (const row of rows) {
    if (takenOurs.has(row.ours_id) || takenEcho.has(row.echo_id)) continue;
    takenOurs.add(row.ours_id);
    takenEcho.add(row.echo_id);
    pairs.push(row);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const csvPath = `whatsapp-echo-merge-${stamp}.csv`;
  writeFileSync(
    csvPath,
    [
      ["ours_id", "echo_id", "session_id", "sender_type", "ours_type", "ours_source", "echo_source", "provider_id", "echo_delivery", "gap_seconds", "sent_at", "body"]
        .map(csvCell).join(","),
      ...pairs.map((row) => [
        row.ours_id, row.echo_id, row.session_id, row.sender_type, row.ours_type || "",
        row.ours_source, row.echo_source, row.echo_provider_id, row.echo_delivery,
        row.gap_seconds, row.ours_at?.toISOString?.() || String(row.ours_at || ""), row.body,
      ].map(csvCell).join(",")),
    ].join("\n"),
    "utf8"
  );

  console.log(`${pairs.length} outbound message(s) written twice — the row we sent kept, the bare echo folded into it`);
  console.log(`backup: ${csvPath}`);
  for (const row of pairs) {
    console.log(
      `  ${row.session_id}  keep #${row.ours_id} (${row.ours_type || "text"})  <- #${row.echo_id} [${row.echo_provider_id}] +${row.gap_seconds}s  "${clip(row.body)}"`
    );
  }

  if (!APPLY) {
    console.log("\nDRY RUN — nothing changed. Re-run with --apply to merge.");
    return;
  }

  let merged = 0;
  for (const row of pairs) {
    // The echo goes FIRST. (external_message_id, session_id) is unique, so writing the id onto
    // our row while the echo still holds it is rejected outright — and a pair half-merged would
    // be worse than one not merged at all, hence the transaction.
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query(`DELETE FROM ai_support_messages WHERE id = $1`, [row.echo_id]);
      // The provider id and whatever the echo observed about delivery move onto our row. A status
      // already recorded as delivered or read is never walked backwards.
      await client.query(
        `
        UPDATE ai_support_messages
           SET external_message_id = $2,
               provider_message_id = COALESCE(NULLIF(provider_message_id, ''), $2),
               delivery_status = CASE
                 WHEN delivery_status IN ('read', 'delivered') AND $3 = 'sent' THEN delivery_status
                 ELSE COALESCE(NULLIF($3, ''), delivery_status)
               END,
               whatsapp_instance = COALESCE(NULLIF(whatsapp_instance, ''), NULLIF($4, '')),
               remote_jid = COALESCE(NULLIF(remote_jid, ''), NULLIF($5, '')),
               updated_at = NOW()
         WHERE id = $1
        `,
        [row.ours_id, row.echo_provider_id, row.echo_delivery, row.echo_instance, row.echo_remote_jid]
      );
      await client.query("COMMIT");
      merged += 1;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      console.warn(`  skipped #${row.ours_id}: ${error?.message || error}`);
    } finally {
      client.release();
    }
  }

  console.log(`\nmerged ${merged} pair(s): the cards and the provider id now live on one row`);
};

run()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("merge failed:", error?.message || error);
    process.exit(1);
  });
