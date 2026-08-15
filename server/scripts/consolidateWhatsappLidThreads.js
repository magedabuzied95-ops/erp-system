/**
 * Bring every WhatsApp LID conversation onto one key.
 *
 * A customer who hides their number behind a WhatsApp username is identified by
 * a LID, and the canonical key for that chat is `whatsapp:lid:<id>`. Two earlier
 * defects scattered those chats across a second key, `whatsapp:<id>`, which
 * looks like a phone number and is not one:
 *
 *  - the inbox rewrote the conversation key before sending a reply, so the reply
 *    opened a thread of its own
 *  - a startup migration flattened `whatsapp:lid:<id>` session rows back to
 *    digits without moving their messages, orphaning both halves
 *
 * Both are fixed. This moves the data that was split while they were live.
 * Nothing outside the LID key space is touched: a group JID and a real foreign
 * number both look like long digits, so membership is proven by a message row
 * carrying an actual `@lid` JID, never by the shape of the number.
 *
 *   node server/scripts/consolidateWhatsappLidThreads.js            # dry run
 *   node server/scripts/consolidateWhatsappLidThreads.js --apply
 */
import db from "../database/db.js";

const APPLY = process.argv.includes("--apply");
const lidKey = (id) => `whatsapp:lid:${id}`;
const flatKey = (id) => `whatsapp:${id}`;

// A LID is only a LID when a message row proves it with an @lid JID, or when it
// already sits under the canonical prefix.
const { rows: lids } = await db.query(`
  SELECT DISTINCT tenant_id, lid_id FROM (
    SELECT tenant_id, regexp_replace(remote_jid, '@lid$', '') AS lid_id
    FROM ai_support_messages
    WHERE channel = 'whatsapp' AND remote_jid ~ '^[0-9]+@lid$'
    UNION
    SELECT tenant_id, regexp_replace(session_id, '^whatsapp:lid:', '') AS lid_id
    FROM ai_support_messages
    WHERE channel = 'whatsapp' AND session_id ~ '^whatsapp:lid:[0-9]+$'
    UNION
    SELECT tenant_id, regexp_replace(session_id, '^whatsapp:lid:', '') AS lid_id
    FROM ai_support_sessions
    WHERE session_id ~ '^whatsapp:lid:[0-9]+$'
  ) proven
  WHERE lid_id ~ '^[0-9]+$'
  ORDER BY tenant_id, lid_id
`);

if (!lids.length) {
  console.log("No LID conversations found. Nothing to do.");
  process.exit(0);
}

console.log(`${lids.length} LID conversation(s) to check\n`);
let movedMessages = 0;
let mergedSessions = 0;
let mergedConversations = 0;

for (const { tenant_id: tenantId, lid_id: lidId } of lids) {
  const canonical = lidKey(lidId);
  const flat = flatKey(lidId);

  const before = await db.query(
    `SELECT session_id, COUNT(*)::int AS messages FROM ai_support_messages
     WHERE tenant_id = $1 AND session_id = ANY($2::text[]) GROUP BY session_id ORDER BY session_id`,
    [tenantId, [canonical, flat]]
  );
  const split = before.rows.length > 1 || before.rows.some((row) => row.session_id === flat);

  // The startup migration renamed session rows without moving their messages,
  // so a chat can be whole in ai_support_messages and still invisible: the
  // inbox list is driven by ai_support_sessions, and its row now sits under the
  // flattened key.
  const canonicalMessages = before.rows.find((row) => row.session_id === canonical)?.messages || 0;
  const sessionRows = await db.query(
    `SELECT session_id FROM ai_support_sessions WHERE tenant_id = $1 AND session_id = ANY($2::text[])`,
    [tenantId, [canonical, flat]]
  );
  const orphaned = canonicalMessages > 0 && !sessionRows.rows.some((row) => row.session_id === canonical);

  const counts = before.rows.map((row) => `${row.session_id}=${row.messages}`).join(", ") || "no messages";
  if (!split && !orphaned) {
    console.log(`  ok    ${canonical} (${counts})`);
    continue;
  }
  console.log(`  ${split ? "SPLIT" : "NO SESSION ROW"} ${lidId}: ${counts}`);
  if (!APPLY) continue;

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    // One session row at the canonical key, reusing the flat row when it is the
    // only one so nothing it already carries (name, status) is lost.
    const existing = await client.query(
      `SELECT id, session_id FROM ai_support_sessions
       WHERE tenant_id = $1 AND session_id = ANY($2::text[]) ORDER BY (session_id = $3) DESC`,
      [tenantId, [canonical, flat], canonical]
    );
    const hasCanonical = existing.rows.some((row) => row.session_id === canonical);
    if (!hasCanonical && existing.rows.length) {
      await client.query(`UPDATE ai_support_sessions SET session_id = $3 WHERE tenant_id = $1 AND session_id = $2`, [tenantId, flat, canonical]);
      mergedSessions += 1;
    } else if (!hasCanonical) {
      // Neither key has a session row: the messages are here but the thread has
      // nothing to hang off, so the inbox cannot list it.
      await client.query(
        `INSERT INTO ai_support_sessions (tenant_id, session_id, source, status, channel, customer_name, last_message, updated_at)
         VALUES ($1, $2, 'whatsapp', 'ai_active', 'whatsapp', '', '', NOW())
         ON CONFLICT (tenant_id, session_id) DO NOTHING`,
        [tenantId, canonical]
      );
      mergedSessions += 1;
    }
    const sessionRef = await client.query(
      `SELECT id FROM ai_support_sessions WHERE tenant_id = $1 AND session_id = $2 LIMIT 1`,
      [tenantId, canonical]
    );
    const sessionRefId = sessionRef.rows[0]?.id || null;

    const moved = await client.query(
      `UPDATE ai_support_messages
       SET session_id = $3, session_ref_id = COALESCE($4, session_ref_id)
       WHERE tenant_id = $1 AND session_id = $2 RETURNING id`,
      [tenantId, flat, canonical, sessionRefId]
    );
    movedMessages += moved.rowCount;

    if (hasCanonical) {
      // ai_support_messages.session_ref_id is ON DELETE CASCADE. Moving a
      // message by session_id is not enough: any row still pointing at the row
      // about to be dropped would be deleted with it. Repoint every reference
      // first, then drop.
      const flatRow = existing.rows.find((row) => row.session_id === flat);
      if (flatRow) {
        await client.query(
          `UPDATE ai_support_messages SET session_ref_id = $2 WHERE session_ref_id = $1`,
          [flatRow.id, sessionRefId]
        );
        const stillReferenced = await client.query(
          `SELECT COUNT(*)::int AS n FROM ai_support_messages WHERE session_ref_id = $1`,
          [flatRow.id]
        );
        if (stillReferenced.rows[0].n > 0) {
          throw new Error(`refusing to drop session ${flat}: ${stillReferenced.rows[0].n} message(s) still reference it`);
        }
      }
      const dropped = await client.query(
        `DELETE FROM ai_support_sessions WHERE tenant_id = $1 AND session_id = $2 RETURNING id`,
        [tenantId, flat]
      );
      mergedSessions += dropped.rowCount;
    }

    const tail = await client.query(
      `SELECT LEFT(COALESCE(NULLIF(message_text, ''), customer_message, ai_answer, ''), 200) AS last_message, created_at,
              MAX(NULLIF(customer_name, '')) OVER () AS customer_name
       FROM ai_support_messages WHERE tenant_id = $1 AND session_id = $2
       ORDER BY created_at DESC LIMIT 1`,
      [tenantId, canonical]
    );
    const last = tail.rows[0] || null;
    await client.query(
      // customer_name is NOT NULL: a nameless chat on both sides must land on
      // '' rather than NULL, or the merge fails on the customers who have no
      // pushName at all — exactly the ones this script exists for.
      `UPDATE ai_support_sessions
       SET last_message = COALESCE(NULLIF($3, ''), last_message, ''),
           customer_name = COALESCE(NULLIF(customer_name, ''), NULLIF($4, ''), ''),
           updated_at = NOW()
       WHERE tenant_id = $1 AND session_id = $2`,
      [tenantId, canonical, last?.last_message || "", last?.customer_name || ""]
    );

    // Same merge for the channel conversation row, carrying the better name over
    // and recording the LID so the resolver can find this chat again.
    const flatConv = await client.query(
      `SELECT customer_name, last_message, last_message_at FROM ai_channel_conversations
       WHERE tenant_id = $1 AND channel = 'whatsapp' AND external_conversation_id = $2 LIMIT 1`,
      [tenantId, flat]
    );
    const canonConv = await client.query(
      `SELECT id FROM ai_channel_conversations
       WHERE tenant_id = $1 AND channel = 'whatsapp' AND external_conversation_id = $2 LIMIT 1`,
      [tenantId, canonical]
    );
    if (flatConv.rowCount && !canonConv.rowCount) {
      await client.query(
        `UPDATE ai_channel_conversations SET external_conversation_id = $3 WHERE tenant_id = $1 AND channel = 'whatsapp' AND external_conversation_id = $2`,
        [tenantId, flat, canonical]
      );
      mergedConversations += 1;
    } else if (flatConv.rowCount && canonConv.rowCount) {
      await client.query(
        `DELETE FROM ai_channel_conversations WHERE tenant_id = $1 AND channel = 'whatsapp' AND external_conversation_id = $2`,
        [tenantId, flat]
      );
      mergedConversations += 1;
    }
    await client.query(
      `UPDATE ai_channel_conversations
       SET customer_name = COALESCE(NULLIF(customer_name, ''), NULLIF($3, ''), NULLIF($4, ''), ''),
           last_message = COALESCE(NULLIF($5, ''), last_message, ''),
           last_message_at = COALESCE($6, last_message_at),
           external_customer_id = '',
           metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('lid_jid', $7::text, 'sender_lid', $8::text),
           updated_at = NOW()
       WHERE tenant_id = $1 AND channel = 'whatsapp' AND external_conversation_id = $2`,
      [
        tenantId, canonical,
        flatConv.rows[0]?.customer_name || "", last?.customer_name || "",
        last?.last_message || "", last?.created_at || null,
        `${lidId}@lid`, lidId,
      ]
    );

    await client.query("COMMIT");
    console.log(`        merged into ${canonical} (${moved.rowCount} message(s) moved)`);
  } catch (error) {
    await client.query("ROLLBACK");
    console.error(`        FAILED ${lidId}: ${error.message}`);
  } finally {
    client.release();
  }
}

console.log(
  APPLY
    ? `\nDone. ${movedMessages} message(s) moved, ${mergedSessions} session row(s) merged, ${mergedConversations} conversation row(s) merged.\n`
    : "\nDry run — nothing was written. Re-run with --apply.\n"
);
process.exit(0);
