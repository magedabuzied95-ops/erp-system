import db from "../database/db.js";

/* ======================================================
   REMOVE THE COEXISTENCE DUPLICATES
   ------------------------------------------------------
   While the number ran WhatsApp Coexistence, every inbound message was written twice: once by the
   Cloud webhook as `wamid.<base64>` and once by Evolution as the bare provider id. They are the
   same message — the bare id sits INSIDE the base64 the wamid is built from — so a pair is only
   ever declared a duplicate when that containment actually holds. No text matching, no time
   windows, no guessing.

   The EVOLUTION copy is the one kept. It is the id the rest of the system correlates on (delivery
   receipts, reactions, edits all arrive with the bare id), and Evolution is now the only writer on
   this line.

   Dry run by default. Pass --apply to delete.

     node server/scripts/removeCoexistenceDuplicateWhatsappMessages.js
     node server/scripts/removeCoexistenceDuplicateWhatsappMessages.js --apply
====================================================== */

const APPLY = process.argv.includes("--apply");
const clip = (value = "", length = 48) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, length);

// The bare provider id lives inside the wamid's base64. Decode as latin1 so the framing bytes
// survive, then look for the id as a literal substring.
const wamidContains = (wamid = "", bareId = "") => {
  const safeWamid = String(wamid || "");
  const safeBare = String(bareId || "").trim();
  if (!safeWamid.toLowerCase().startsWith("wamid.") || safeBare.length < 8) return false;
  try {
    const decoded = Buffer.from(safeWamid.slice(6).replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("latin1");
    return decoded.includes(safeBare);
  } catch {
    return false;
  }
};

const run = async () => {
  const { rows } = await db.query(
    `
    SELECT id, session_id, sender_type, created_at,
           COALESCE(external_message_id, '') AS ext_id,
           COALESCE(insert_source, '') AS insert_source,
           LEFT(COALESCE(NULLIF(ai_answer, ''), message_text, ''), 120) AS body
    FROM ai_support_messages
    WHERE channel LIKE '%whatsapp%'
      AND COALESCE(external_message_id, '') <> ''
    ORDER BY session_id, id
    `
  );

  const bySession = new Map();
  for (const row of rows) {
    if (!bySession.has(row.session_id)) bySession.set(row.session_id, []);
    bySession.get(row.session_id).push(row);
  }

  const doomed = [];
  for (const [, sessionRows] of bySession) {
    const bare = sessionRows.filter((row) => !row.ext_id.toLowerCase().startsWith("wamid."));
    for (const cloudRow of sessionRows.filter((row) => row.ext_id.toLowerCase().startsWith("wamid."))) {
      const twin = bare.find((row) => wamidContains(cloudRow.ext_id, row.ext_id));
      if (twin) doomed.push({ cloud: cloudRow, evolution: twin });
    }
  }

  console.log(`whatsapp rows scanned              : ${rows.length}`);
  console.log(`confirmed coexistence duplicates   : ${doomed.length}`);
  console.log(`rows to delete (the Cloud copy)    : ${doomed.length}`);
  console.log("");
  for (const pair of doomed.slice(0, 15)) {
    console.log(
      `  delete #${pair.cloud.id} (${pair.cloud.insert_source || "?"}) — keep #${pair.evolution.id} (${pair.evolution.insert_source || "?"})  ${pair.cloud.session_id}  "${clip(pair.cloud.body)}"`
    );
  }
  if (doomed.length > 15) console.log(`  … and ${doomed.length - 15} more`);
  console.log("");

  if (!doomed.length) {
    console.log("Nothing to remove.");
    return;
  }
  if (!APPLY) {
    console.log("DRY RUN — nothing deleted. Re-run with --apply to delete the Cloud copies.");
    return;
  }

  const ids = doomed.map((pair) => pair.cloud.id);
  const result = await db.query(`DELETE FROM ai_support_messages WHERE id = ANY($1::bigint[]) RETURNING id`, [ids]);
  console.log(`DELETED ${result.rowCount} duplicate rows.`);
};

run()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("failed:", error?.message || error);
    process.exit(1);
  });
