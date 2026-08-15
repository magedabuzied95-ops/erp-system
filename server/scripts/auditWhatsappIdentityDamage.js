/**
 * Read-only audit of the conversations the WhatsApp username/LID rollout
 * corrupted.
 *
 * Before the identity fix the webhook scraped digits out of whatever the chat
 * JID happened to be, so a LID ("46995733500101@lid") became a conversation that
 * looks like a phone number, a username collapsed to the digits inside it, and
 * an event without a chat JID resolved to the store's own number — filing a
 * customer's message into the owner's own thread.
 *
 * This script only reports. Nothing is written, so it is safe to run against
 * production at any time:
 *
 *   node server/scripts/auditWhatsappIdentityDamage.js
 *   node server/scripts/auditWhatsappIdentityDamage.js --days 30 --tenant 1
 */
import { withReadOnlyDbSession } from "../database/db.js";

const argValue = (name, fallback = "") => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};

const days = Number(argValue("days", "60")) || 60;
const tenantFilter = argValue("tenant", "");
const ownerNumber = String(
  process.env.WHATSAPP_NUMBER ||
  process.env.WHATSAPP_OWNER_NUMBER ||
  process.env.WHATSAPP_CONNECTED_NUMBER ||
  "201000659301"
).replace(/\D/g, "");
const ownerSessionId = `whatsapp:${ownerNumber}`;

// Every real customer of this store is an Egyptian mobile: whatsapp:20##########.
const PLAUSIBLE_SESSION = "^whatsapp:20[0-9]{10}$";

const heading = (title) => console.log(`\n${"=".repeat(78)}\n${title}\n${"=".repeat(78)}`);

const table = (rows, empty) => {
  if (!rows.length) {
    console.log(`  ${empty}`);
    return;
  }
  console.table(rows);
};

const report = await withReadOnlyDbSession(async (client) => {
  const tenantClause = tenantFilter ? "AND tenant_id = $2::bigint" : "";
  const params = tenantFilter ? [days, tenantFilter] : [days];

  const suspiciousSessions = await client.query(
    `
    SELECT
      tenant_id,
      session_id,
      COUNT(*)::int AS message_count,
      MIN(created_at) AS first_seen,
      MAX(created_at) AS last_seen,
      MAX(NULLIF(customer_name, '')) AS customer_name,
      COUNT(*) FILTER (WHERE COALESCE(resolved_phone, '') <> '')::int AS rows_with_phone,
      MAX(NULLIF(remote_jid, '')) AS sample_remote_jid
    FROM ai_support_messages
    WHERE channel = 'whatsapp'
      AND created_at >= NOW() - ($1::int * INTERVAL '1 day')
      AND session_id !~ '${PLAUSIBLE_SESSION}'
      ${tenantClause}
    GROUP BY tenant_id, session_id
    ORDER BY MAX(created_at) DESC
    LIMIT 100
    `,
    params
  );

  const ownerThread = await client.query(
    `
    SELECT
      id,
      tenant_id,
      created_at,
      COALESCE(NULLIF(customer_name, ''), '(no name)') AS customer_name,
      LEFT(COALESCE(NULLIF(message_text, ''), customer_message, ''), 70) AS message_preview,
      COALESCE(remote_jid, '') AS remote_jid,
      COALESCE(resolved_phone, '') AS resolved_phone,
      COALESCE(provider_message_id, '') AS provider_message_id
    FROM ai_support_messages
    WHERE channel = 'whatsapp'
      AND sender_type = 'customer'
      AND session_id = $2
      AND created_at >= NOW() - ($1::int * INTERVAL '1 day')
    ORDER BY created_at DESC
    LIMIT 100
    `,
    [days, ownerSessionId]
  );

  const lidMemory = await client.query(
    `
    SELECT
      tenant_id,
      external_conversation_id,
      COALESCE(NULLIF(customer_name, ''), '(no name)') AS customer_name,
      COALESCE(external_customer_id, '') AS external_customer_id,
      COALESCE(metadata->>'lid_jid', '') AS lid_jid,
      COALESCE(metadata->>'resolved_phone', '') AS resolved_phone,
      last_message_at
    FROM ai_channel_conversations
    WHERE channel = 'whatsapp'
      AND COALESCE(metadata->>'lid_jid', '') <> ''
    ORDER BY last_message_at DESC NULLS LAST
    LIMIT 50
    `
  );

  return { suspiciousSessions: suspiciousSessions.rows, ownerThread: ownerThread.rows, lidMemory: lidMemory.rows };
});

heading(`A. Conversations not keyed by an Egyptian number (last ${days} days)`);
console.log("   A LID or a username that was mistaken for a phone shows up here.");
console.log("   rows_with_phone = 0 means we never learned this customer's real number.\n");
table(report.suspiciousSessions, "none — every WhatsApp conversation is keyed by a real number.");

heading(`B. Customer messages sitting in the store's own thread (${ownerSessionId})`);
console.log("   Anything here that you did not send to yourself was misfiled by the old");
console.log("   identity resolver. Check the timestamps against the phone.\n");
table(report.ownerThread, "none — no customer message landed in the owner's own thread.");

heading("C. LID → phone memory recorded so far");
console.log("   Populated by the identity fix. Rows appear as username customers message in.\n");
table(report.lidMemory, "none yet — expected until a LID chat arrives after the fix is deployed.");

console.log("\nDone. This script wrote nothing.\n");
process.exit(0);
