// The page's own public replies used to arrive as customer comments (fixed in
// socialCommentAutomationService: `is_page_authored`). Every one of them opened a
// lead in the AI Inbox named after the page itself. This clears those leads.
//
//   node server/scripts/purgePageAuthoredCommentLeads.js            # report only
//   node server/scripts/purgePageAuthoredCommentLeads.js --apply    # delete them
//
// The comment rows in social_comment_automation_runs are kept — they are the
// thread history under the post. Only the phantom conversations go.

import db from "../database/db.js";

const APPLY = process.argv.includes("--apply");
const COMMENT_CHANNELS = ["facebook_comment", "instagram_comment"];

const selfActorIds = async () => {
  const result = await db.query(`
    SELECT DISTINCT id FROM (
      SELECT NULLIF(TRIM(facebook_page_id), '') AS id FROM meta_integration_configs
      UNION ALL
      SELECT NULLIF(TRIM(instagram_business_account_id), '') AS id FROM meta_integration_configs
    ) ids
    WHERE id IS NOT NULL
  `);
  return result.rows.map((row) => String(row.id));
};

const run = async () => {
  const ids = await selfActorIds();
  if (!ids.length) {
    console.log("No connected page / Instagram account id found — nothing to match against.");
    return;
  }
  console.log("Our own ids:", ids.join(", "));

  // A comment conversation whose "customer" is one of our own ids is the page
  // talking to itself. external_conversation_id is the session id shared with
  // ai_support_sessions and with social_comment_automation_runs.inbox_conversation_id.
  const conversations = await db.query(
    `
    SELECT tenant_id, channel, external_conversation_id AS session_id, customer_name, last_message, updated_at
    FROM ai_channel_conversations
    WHERE channel = ANY($1::text[])
      AND external_customer_id = ANY($2::text[])
    ORDER BY updated_at DESC
    `,
    [COMMENT_CHANNELS, ids]
  );
  const sessionIds = conversations.rows.map((row) => String(row.session_id)).filter(Boolean);

  const orphanSessions = await db.query(
    `
    SELECT tenant_id, session_id, customer_name, last_message, updated_at
    FROM ai_support_sessions
    WHERE channel = ANY($1::text[])
      AND external_customer_id = ANY($2::text[])
      AND NOT (session_id = ANY($3::text[]))
    `,
    [COMMENT_CHANNELS, ids, sessionIds]
  );
  const allSessionIds = [...new Set([...sessionIds, ...orphanSessions.rows.map((row) => String(row.session_id))])];

  console.log(`Phantom conversations: ${conversations.rowCount} (+${orphanSessions.rowCount} session rows with no conversation)`);
  conversations.rows.slice(0, 15).forEach((row) => {
    console.log(`  ${row.updated_at?.toISOString?.() || row.updated_at} | ${row.channel} | ${row.customer_name} | ${String(row.last_message || "").slice(0, 70)}`);
  });
  if (!allSessionIds.length) {
    console.log("Nothing to clean.");
    return;
  }

  const messages = await db.query(
    `SELECT COUNT(*)::int AS count FROM ai_support_messages WHERE session_id = ANY($1::text[])`,
    [allSessionIds]
  );
  const linkedRuns = await db.query(
    `SELECT COUNT(*)::int AS count FROM social_comment_automation_runs WHERE inbox_conversation_id = ANY($1::text[])`,
    [allSessionIds]
  );
  console.log(`Messages inside them: ${messages.rows[0]?.count || 0}`);
  console.log(`Comment rows pointing at them: ${linkedRuns.rows[0]?.count || 0} (kept, only the link is cleared)`);

  if (!APPLY) {
    console.log("\nReport only. Re-run with --apply to delete.");
    return;
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const clearedLinks = await client.query(
      `UPDATE social_comment_automation_runs SET inbox_conversation_id = NULL WHERE inbox_conversation_id = ANY($1::text[])`,
      [allSessionIds]
    );
    const deletedMessages = await client.query(
      `DELETE FROM ai_support_messages WHERE session_id = ANY($1::text[])`,
      [allSessionIds]
    );
    const deletedSessions = await client.query(
      `DELETE FROM ai_support_sessions WHERE session_id = ANY($1::text[])`,
      [allSessionIds]
    );
    const deletedConversations = await client.query(
      `DELETE FROM ai_channel_conversations WHERE channel = ANY($1::text[]) AND external_conversation_id = ANY($2::text[])`,
      [COMMENT_CHANNELS, allSessionIds]
    );
    await client.query("COMMIT");
    console.log("\nDone.");
    console.log(`  comment links cleared : ${clearedLinks.rowCount}`);
    console.log(`  messages deleted      : ${deletedMessages.rowCount}`);
    console.log(`  sessions deleted      : ${deletedSessions.rowCount}`);
    console.log(`  conversations deleted : ${deletedConversations.rowCount}`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

run()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("purgePageAuthoredCommentLeads failed:", error?.message || error);
    process.exit(1);
  });
