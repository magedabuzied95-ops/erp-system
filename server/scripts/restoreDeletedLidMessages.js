/**
 * Restore WhatsApp messages that the LID thread merge deleted.
 *
 * ai_support_messages.session_ref_id is ON DELETE CASCADE. The first version of
 * consolidateWhatsappLidThreads.js moved messages by session_id and then dropped
 * the duplicate session row — and any message still pointing at that row by ref
 * id went with it. Real customer messages were lost.
 *
 * Reads them back out of a restored pre-merge backup and puts them where they
 * belong. Rows are matched by their original id, so running this twice is a
 * no-op. Dry run by default.
 *
 * Prepare the source database once:
 *   createdb erp_recover && zcat <pre-merge-backup>.sql.gz | psql -d erp_recover
 *
 *   node server/scripts/restoreDeletedLidMessages.js
 *   node server/scripts/restoreDeletedLidMessages.js --apply
 *   node server/scripts/restoreDeletedLidMessages.js --source erp_recover --apply
 */
import pg from "pg";
import db from "../database/db.js";

const APPLY = process.argv.includes("--apply");
const argValue = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};
const sourceDatabase = argValue("source", "erp_recover");

const sourcePool = new pg.Pool({
  host: process.env.DB_HOST || process.env.PGHOST || "erp-postgres",
  port: Number(process.env.DB_PORT || process.env.PGPORT || 5432),
  user: process.env.DB_USER || process.env.PGUSER || "erp_user",
  password: process.env.DB_PASSWORD || process.env.PGPASSWORD || "",
  database: sourceDatabase,
  max: 2,
});

// Every WhatsApp message the backup holds for a LID conversation. Anything
// already present in production is skipped, so this only ever fills gaps.
const { rows: candidates } = await sourcePool.query(`
  SELECT id, to_jsonb(m) AS row
  FROM ai_support_messages m
  WHERE channel = 'whatsapp'
    AND (session_id ~ '^whatsapp:lid:[0-9]+$' OR remote_jid ~ '^[0-9]+@lid$')
  ORDER BY id
`);

if (!candidates.length) {
  console.log(`No LID messages found in ${sourceDatabase}. Nothing to restore.`);
  await sourcePool.end();
  process.exit(0);
}

const ids = candidates.map((row) => Number(row.id));
const { rows: present } = await db.query(
  `SELECT id FROM ai_support_messages WHERE id = ANY($1::bigint[])`,
  [ids]
);
const presentIds = new Set(present.map((row) => Number(row.id)));
const missing = candidates.filter((row) => !presentIds.has(Number(row.id)));

console.log(`${candidates.length} LID message(s) in the backup, ${presentIds.size} already in production.`);
if (!missing.length) {
  console.log("Nothing is missing. Done.");
  await sourcePool.end();
  process.exit(0);
}

console.log(`\n${missing.length} message(s) to restore:\n`);
for (const item of missing) {
  const row = item.row;
  const preview = String(row.message_text || row.customer_message || row.ai_answer || "").replace(/\s+/g, " ").slice(0, 50);
  console.log(`  ${row.id}  ${String(row.sender_type).padEnd(9)} ${row.session_id}  ${preview}`);
}

if (!APPLY) {
  console.log("\nDry run — nothing was written. Re-run with --apply.\n");
  await sourcePool.end();
  process.exit(0);
}

let restored = 0;
let failed = 0;
for (const item of missing) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    // The session row this message used to point at is gone — that is what
    // deleted it. Insert without the stale reference, then bind it to whichever
    // session now owns the key.
    const payload = { ...item.row, session_ref_id: null };
    await client.query(
      `INSERT INTO ai_support_messages
       SELECT * FROM jsonb_populate_record(NULL::ai_support_messages, $1::jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [JSON.stringify(payload)]
    );
    await client.query(
      `UPDATE ai_support_messages m
       SET session_ref_id = s.id
       FROM ai_support_sessions s
       WHERE m.id = $1 AND s.tenant_id = m.tenant_id AND s.session_id = m.session_id`,
      [item.row.id]
    );
    await client.query("COMMIT");
    restored += 1;
    console.log(`  restored ${item.row.id}`);
  } catch (error) {
    await client.query("ROLLBACK");
    failed += 1;
    console.error(`  FAILED ${item.row.id}: ${error.message}`);
  } finally {
    client.release();
  }
}

// The list still shows whatever was there before the restore until the session
// preview catches up with the message that is now newest.
await db.query(`
  UPDATE ai_support_sessions s
  SET last_message = COALESCE(NULLIF(newest.body, ''), s.last_message, ''), updated_at = NOW()
  FROM (
    SELECT DISTINCT ON (session_id, tenant_id) session_id, tenant_id,
           LEFT(COALESCE(NULLIF(message_text, ''), customer_message, ai_answer, ''), 200) AS body
    FROM ai_support_messages
    WHERE session_id ~ '^whatsapp:lid:[0-9]+$'
    ORDER BY session_id, tenant_id, created_at DESC
  ) AS newest
  WHERE s.session_id = newest.session_id AND s.tenant_id = newest.tenant_id
`);

console.log(`\nDone. ${restored} restored, ${failed} failed.\n`);
await sourcePool.end();
process.exit(failed ? 1 : 0);
