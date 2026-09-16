/**
 * Fold a LID-keyed WhatsApp thread into the customer's own number thread.
 *
 * A call rings from the caller's LID, never from their number. Until the call
 * handler learned to resolve that LID, every missed call opened a second thread
 * — `whatsapp:lid:<id>`, no name, no avatar, no history — beside the real
 * conversation with that customer. The handler is fixed; this moves the rows
 * that were split while it was wrong.
 *
 * It is the OPPOSITE direction to consolidateWhatsappLidThreads.js, which folds
 * a flattened `whatsapp:<digits>` key back onto `whatsapp:lid:<id>`. That one
 * repairs the LID key space; this one retires a LID thread whose owner we can
 * PROVE is a customer we already know by number.
 *
 * The number is never guessed. A LID is 13-15 digits and passes for an
 * international number, so a match counts only when a stored row ties this LID
 * to a phone: a message from this chat that resolved to one, or a phone-keyed
 * conversation that recorded this LID. No evidence, no merge — the thread is
 * left exactly as it is and reported.
 *
 *   node server/scripts/mergeWhatsappLidThreadIntoPhone.js               # dry run, every LID thread
 *   node server/scripts/mergeWhatsappLidThreadIntoPhone.js --lid=4216... # dry run, one thread
 *   node server/scripts/mergeWhatsappLidThreadIntoPhone.js --apply
 */
import db from "../database/db.js";

const lidKey = (id) => `whatsapp:lid:${id}`;
const phoneKey = (phone) => `whatsapp:${phone}`;

// The store's own number must never be a merge target: folding a customer's
// thread into it is how customer messages landed in the owner's own chat before.
const ownNumbers = () =>
  new Set(
    [
      process.env.WHATSAPP_CONNECTED_NUMBER,
      process.env.WHATSAPP_INSTANCE_OWNER_NUMBER,
      process.env.EVOLUTION_INSTANCE_OWNER_NUMBER,
      process.env.WHATSAPP_OWNER_NUMBER,
      process.env.WHATSAPP_NUMBER,
      "201000659301",
    ]
      .map((value) => String(value || "").replace(/\D/g, ""))
      .filter(Boolean)
  );

export const isUsablePhone = (value, lidId) => {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits || digits === String(lidId || "")) return false;
  if (ownNumbers().has(digits)) return false;
  // Egyptian mobile in international form. A LID is longer and carries no prefix.
  return /^20(10|11|12|15)\d{8}$/.test(digits);
};

/**
 * Which number, if any, this LID provably belongs to. Returns null rather than a
 * best guess: a wrong answer here files one customer's call into another
 * customer's thread, which is worse than the split thread it repairs.
 */
export const chooseMergeTarget = ({ messageRows = [], conversationRows = [], lidId = "" } = {}) => {
  const candidates = [
    ...messageRows.map((row) => ({
      phone: String(row.resolved_phone || "").replace(/\D/g, ""),
      why: `resolved on ${row.hits} message(s)`,
    })),
    ...conversationRows.map((row) => ({
      phone: String(
        row.external_customer_id || row.metadata?.phone || String(row.external_conversation_id || "").replace(/^whatsapp:/, "")
      ).replace(/\D/g, ""),
      why: "recorded on the number's own conversation",
    })),
  ].filter((candidate) => isUsablePhone(candidate.phone, lidId));

  if (!candidates.length) return { target: null, reason: "no_stored_number" };
  const distinct = [...new Set(candidates.map((candidate) => candidate.phone))];
  if (distinct.length > 1) return { target: null, reason: "ambiguous", numbers: distinct };
  return { target: candidates[0], reason: "resolved" };
};

export const main = async ({ apply = false, onlyLid = "" } = {}) => {
  const lidRows = await db.query(
    `
    SELECT DISTINCT tenant_id, lid_id FROM (
      SELECT tenant_id, regexp_replace(session_id, '^whatsapp:lid:', '') AS lid_id
      FROM ai_support_messages
      WHERE channel = 'whatsapp' AND session_id ~ '^whatsapp:lid:[0-9]+$'
      UNION
      SELECT tenant_id, regexp_replace(external_conversation_id, '^whatsapp:lid:', '') AS lid_id
      FROM ai_channel_conversations
      WHERE channel = 'whatsapp' AND external_conversation_id ~ '^whatsapp:lid:[0-9]+$'
    ) proven
    WHERE lid_id ~ '^[0-9]+$' AND ($1 = '' OR lid_id = $1)
    ORDER BY tenant_id, lid_id
    `,
    [onlyLid]
  );

  if (!lidRows.rows.length) {
    console.log(onlyLid ? `No thread found for LID ${onlyLid}. Nothing to do.` : "No LID threads found. Nothing to do.");
    return { merged: 0, movedMessages: 0, leftAlone: 0 };
  }

  console.log(`${lidRows.rows.length} LID thread(s) to check${apply ? "" : "  (dry run — nothing will be written)"}\n`);

  let merged = 0;
  let movedMessages = 0;
  let leftAlone = 0;

  for (const { tenant_id: tenantId, lid_id: lidId } of lidRows.rows) {
    const source = lidKey(lidId);
    const jid = `${lidId}@lid`;

    const contents = await db.query(
      `SELECT COUNT(*)::int AS messages FROM ai_support_messages WHERE tenant_id = $1 AND session_id = $2`,
      [tenantId, source]
    );
    const messageCount = contents.rows[0]?.messages || 0;

    // Evidence 1: a message from this chat that already resolved to a number.
    const fromMessages = await db.query(
      `SELECT resolved_phone, COUNT(*)::int AS hits
       FROM ai_support_messages
       WHERE tenant_id = $1 AND channel = 'whatsapp'
         AND (remote_jid = $2 OR session_id = $3)
         AND COALESCE(resolved_phone, '') <> ''
       GROUP BY resolved_phone ORDER BY hits DESC`,
      [tenantId, jid, source]
    );

    // Evidence 2: a phone-keyed conversation that recorded this LID.
    const fromConversations = await db.query(
      `SELECT external_conversation_id, external_customer_id, metadata
       FROM ai_channel_conversations
       WHERE tenant_id = $1 AND channel = 'whatsapp'
         AND external_conversation_id ~ '^whatsapp:[0-9]+$'
         AND (metadata->>'lid_jid' = $2 OR metadata->>'sender_lid' = $3)
       ORDER BY updated_at DESC`,
      [tenantId, jid, lidId]
    );

    const { target, reason, numbers } = chooseMergeTarget({
      messageRows: fromMessages.rows,
      conversationRows: fromConversations.rows,
      lidId,
    });

    if (!target) {
      leftAlone += 1;
      if (reason === "ambiguous") {
        console.log(`  SKIP  ${source} — this LID points at ${numbers.length} different numbers (${numbers.join(", ")}); refusing to guess`);
      } else {
        console.log(`  keep  ${source} (${messageCount} message(s)) — no stored number for this LID, nothing to merge into`);
      }
      continue;
    }

    const destination = phoneKey(target.phone);
    console.log(`  MERGE ${source} (${messageCount} message(s)) → ${destination}  [${target.why}]`);
    if (!apply) continue;

    const client = await db.connect();
    try {
      await client.query("BEGIN");

      const sessions = await client.query(
        `SELECT id, session_id FROM ai_support_sessions WHERE tenant_id = $1 AND session_id = ANY($2::text[])`,
        [tenantId, [source, destination]]
      );
      let destinationRow = sessions.rows.find((row) => row.session_id === destination);
      const sourceRow = sessions.rows.find((row) => row.session_id === source);

      if (!destinationRow) {
        // The number has no session row of its own: rename the LID row rather
        // than inventing one, so its name and status survive the move.
        if (sourceRow) {
          await client.query(
            `UPDATE ai_support_sessions SET session_id = $3 WHERE tenant_id = $1 AND session_id = $2`,
            [tenantId, source, destination]
          );
        } else {
          await client.query(
            `INSERT INTO ai_support_sessions (tenant_id, session_id, source, status, channel, customer_name, last_message, updated_at)
             VALUES ($1, $2, 'whatsapp', 'ai_active', 'whatsapp', '', '', NOW())
             ON CONFLICT (tenant_id, session_id) DO NOTHING`,
            [tenantId, destination]
          );
        }
        const created = await client.query(
          `SELECT id FROM ai_support_sessions WHERE tenant_id = $1 AND session_id = $2 LIMIT 1`,
          [tenantId, destination]
        );
        destinationRow = { id: created.rows[0]?.id || null, session_id: destination };
      }

      const moved = await client.query(
        `UPDATE ai_support_messages
         SET session_id = $3, session_ref_id = COALESCE($4, session_ref_id)
         WHERE tenant_id = $1 AND session_id = $2 RETURNING id`,
        [tenantId, source, destination, destinationRow.id]
      );
      movedMessages += moved.rowCount;

      if (sourceRow && sourceRow.id !== destinationRow.id) {
        // ai_support_messages.session_ref_id is ON DELETE CASCADE. Dropping the
        // LID session row while any message still points at it by ref id deletes
        // that message with it. Repoint first, prove none is left, then drop.
        await client.query(`UPDATE ai_support_messages SET session_ref_id = $2 WHERE session_ref_id = $1`, [
          sourceRow.id,
          destinationRow.id,
        ]);
        const stillReferenced = await client.query(
          `SELECT COUNT(*)::int AS n FROM ai_support_messages WHERE session_ref_id = $1`,
          [sourceRow.id]
        );
        if (stillReferenced.rows[0].n > 0) {
          throw new Error(`refusing to drop session ${source}: ${stillReferenced.rows[0].n} message(s) still reference it`);
        }
        await client.query(`DELETE FROM ai_support_sessions WHERE tenant_id = $1 AND id = $2`, [tenantId, sourceRow.id]);
      }

      const tail = await client.query(
        `SELECT LEFT(COALESCE(NULLIF(message_text, ''), customer_message, ai_answer, ''), 200) AS last_message, created_at
         FROM ai_support_messages WHERE tenant_id = $1 AND session_id = $2 ORDER BY created_at DESC LIMIT 1`,
        [tenantId, destination]
      );
      const last = tail.rows[0] || null;
      await client.query(
        `UPDATE ai_support_sessions SET last_message = COALESCE(NULLIF($3, ''), last_message, ''), updated_at = NOW()
         WHERE tenant_id = $1 AND session_id = $2`,
        [tenantId, destination, last?.last_message || ""]
      );

      const sourceConv = await client.query(
        `SELECT customer_name, customer_avatar_url FROM ai_channel_conversations
         WHERE tenant_id = $1 AND channel = 'whatsapp' AND external_conversation_id = $2 LIMIT 1`,
        [tenantId, source]
      );
      const destinationConv = await client.query(
        `SELECT id FROM ai_channel_conversations
         WHERE tenant_id = $1 AND channel = 'whatsapp' AND external_conversation_id = $2 LIMIT 1`,
        [tenantId, destination]
      );
      if (sourceConv.rowCount && !destinationConv.rowCount) {
        await client.query(
          `UPDATE ai_channel_conversations SET external_conversation_id = $3, external_customer_id = $4
           WHERE tenant_id = $1 AND channel = 'whatsapp' AND external_conversation_id = $2`,
          [tenantId, source, destination, target.phone]
        );
      } else if (sourceConv.rowCount) {
        await client.query(
          `DELETE FROM ai_channel_conversations WHERE tenant_id = $1 AND channel = 'whatsapp' AND external_conversation_id = $2`,
          [tenantId, source]
        );
      }
      await client.query(
        // Recording the LID on the surviving row is what lets the next call from
        // this customer resolve straight here instead of splitting again.
        `UPDATE ai_channel_conversations
         SET external_customer_id = COALESCE(NULLIF(external_customer_id, ''), $3),
             customer_name = COALESCE(NULLIF(customer_name, ''), NULLIF($4, ''), ''),
             customer_avatar_url = COALESCE(NULLIF(customer_avatar_url, ''), NULLIF($5, ''), ''),
             last_message = COALESCE(NULLIF($6, ''), last_message, ''),
             last_message_at = GREATEST(COALESCE(last_message_at, $7), COALESCE($7, last_message_at)),
             metadata = COALESCE(metadata, '{}'::jsonb)
               || jsonb_build_object('phone', $3::text, 'resolved_phone', $3::text, 'lid_jid', $8::text, 'sender_lid', $9::text),
             updated_at = NOW()
         WHERE tenant_id = $1 AND channel = 'whatsapp' AND external_conversation_id = $2`,
        [
          tenantId,
          destination,
          target.phone,
          sourceConv.rows[0]?.customer_name || "",
          sourceConv.rows[0]?.customer_avatar_url || "",
          last?.last_message || "",
          last?.created_at || null,
          jid,
          lidId,
        ]
      );

      await client.query("COMMIT");
      merged += 1;
      console.log(`        done — ${moved.rowCount} message(s) now in ${destination}`);
    } catch (error) {
      await client.query("ROLLBACK");
      console.error(`        FAILED ${source}: ${error.message}`);
    } finally {
      client.release();
    }
  }

  console.log(
    `\n${apply ? "Merged" : "Would merge"} ${merged} thread(s)${apply ? `, ${movedMessages} message(s) moved` : ""}; ${leftAlone} left alone.`
  );
  if (!apply) console.log("Dry run. Re-run with --apply to write.");
  return { merged, movedMessages, leftAlone };
};

// Only when run as a command. Importing it (a test does) must not touch the database.
if (process.argv[1] && process.argv[1].endsWith("mergeWhatsappLidThreadIntoPhone.js")) {
  const apply = process.argv.includes("--apply");
  const onlyLid = (process.argv.find((arg) => arg.startsWith("--lid=")) || "").split("=")[1]?.replace(/\D/g, "") || "";
  await main({ apply, onlyLid });
  process.exit(0);
}
