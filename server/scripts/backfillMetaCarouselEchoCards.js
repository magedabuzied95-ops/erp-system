/**
 * Repair Messenger/Instagram carousels that were stored as photos.
 *
 * Meta echoes our own outgoing messages back through the webhook. Until
 * `4b1b377` the echo handler asked the recursive image extractor what a generic
 * template was, was told "an image" (the walk reached past the template and
 * returned the FIRST element's `image_url`), and persisted the echo as an image
 * message. The cards never reached the row, so the AI Inbox drew a bare product
 * photo where the customer had received a swipeable carousel.
 *
 * The fix stops it happening again. This repairs what is already stored — and
 * it is deliberately narrow about what "repairable" means, because the template
 * payload itself was never written anywhere. Two shapes exist:
 *
 *   1. Our own send path ALSO logged a row carrying `product_cards`, seconds
 *      apart in the same session. The echo is then a duplicate that renders as
 *      a photo beside the real cards. Those are removed — but only the ones
 *      carrying no words of their own. A carousel's echo never has any (the
 *      lead sentence goes out as its own message; what sits on the row is the
 *      machine's attachment label, "📎 مرفق" and friends). Anything else means
 *      a person wrote it, and a three-minute pairing window is not evidence
 *      enough to delete a real photo someone sent — that needs
 *      --include-captioned, said aloud.
 *   2. No sibling row carries the cards. Nothing on the row, in the session, or
 *      in the media files identifies which colours went out — a re-hosted
 *      `/uploads/inbox-media/facebook/m_<meta-id>.webp` has no link back to the
 *      product image it was made from. Those are reported and left ALONE.
 *      Guessing from the session's current `last_product_cards` would staple
 *      today's products onto an old message, which is worse than a photo.
 *
 * Usage (inside the backend container):
 *   node server/scripts/backfillMetaCarouselEchoCards.js [--tenant 1] [--days 90] [--include-captioned] [--apply]
 *
 * Without --apply it prints the plan and rolls back, so the dry run exercises
 * the identical transaction that the real run commits.
 */
import db from "../database/db.js";

const arg = (name, fallback = "") => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};
const flag = (name) => process.argv.includes(`--${name}`);

const APPLY = flag("apply");
const TENANT = Number(arg("tenant", "0")) || null;
const DAYS = Number(arg("days", "90")) || 90;
// Opt-in, because deleting a row that carries text can delete a real message.
const INCLUDE_CAPTIONED = flag("include-captioned");
// The echo lands within a couple of seconds of our own send; three minutes is
// wide enough for a slow webhook and far too narrow to pair unrelated messages.
const SIBLING_WINDOW = "3 minutes";

const cardCount = (value) => (Array.isArray(value) ? value.length : 0);

// An attachment-only row is not stored blank: the echo handler stamps it with a
// label from inboundAttachmentLabel so the conversation list has something to
// show. Those strings are the machine talking, not a person, so they do not
// count as "someone wrote this" — the first dry run found all 36 rows carrying
// "📎 مرفق" (the fallback label, which is itself the tell: a real photo echo
// would have said "📷 صورة") and refused to touch any of them.
const GENERATED_LABELS = new Set([
  "[attachment]",
  "📎 مرفق",
  "📷 صورة",
  "🌟 ملصق",
  "🎥 فيديو",
  "🎤 رسالة صوتية",
  "📍 موقع",
  "📸 منشن في استوري",
  "📸 رد على استوري",
]);

const isWrittenText = (value) => {
  const trimmed = String(value || "").trim();
  return Boolean(trimmed) && !GENERATED_LABELS.has(trimmed);
};

const run = async () => {
  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const candidates = await client.query(
      `
      SELECT
        m.id,
        m.tenant_id,
        m.session_id,
        m.channel,
        m.created_at,
        m.message_text,
        COALESCE(jsonb_array_length(m.visual_attachments), 0) AS attachment_count,
        (
          SELECT s.product_cards
          FROM ai_support_messages s
          WHERE s.tenant_id = m.tenant_id
            AND s.session_id = m.session_id
            AND s.id <> m.id
            AND COALESCE(jsonb_array_length(s.product_cards), 0) > 0
            AND s.created_at BETWEEN m.created_at - INTERVAL '${SIBLING_WINDOW}'
                                 AND m.created_at + INTERVAL '${SIBLING_WINDOW}'
          ORDER BY ABS(EXTRACT(EPOCH FROM (s.created_at - m.created_at)))
          LIMIT 1
        ) AS sibling_cards
      FROM ai_support_messages m
      WHERE m.insert_source = 'meta_provider_echo'
        AND m.channel IN ('facebook_messenger', 'instagram')
        AND COALESCE(jsonb_array_length(m.product_cards), 0) = 0
        AND COALESCE(jsonb_array_length(m.visual_attachments), 0) > 0
        AND m.created_at >= NOW() - INTERVAL '${DAYS} days'
        ${TENANT ? "AND m.tenant_id = $1" : ""}
      ORDER BY m.created_at DESC
      `,
      TENANT ? [TENANT] : []
    );

    const paired = candidates.rows.filter((row) => cardCount(row.sibling_cards) > 0);
    const orphans = candidates.rows.filter((row) => cardCount(row.sibling_cards) === 0);
    // The carousel's own echo carries no words of its own — the lead sentence
    // goes out as a separate message, and what sits on the row is the machine's
    // attachment label. A row carrying anything ELSE is a message someone wrote,
    // and the three-minute pairing window is not evidence enough to delete it:
    // a real photo sent to a customer minutes after a carousel would look
    // identical to this query. Those need --include-captioned, said out loud.
    const removable = paired.filter((row) => !isWrittenText(row.message_text));
    const captioned = paired.filter((row) => isWrittenText(row.message_text));
    const doomed = INCLUDE_CAPTIONED ? paired : removable;

    console.log(`echo image rows examined : ${candidates.rows.length}`);
    console.log(`  paired with a card row               : ${paired.length}`);
    console.log(`    of those, label only — removable   : ${removable.length}`);
    console.log(`    of those, someone wrote text — kept: ${captioned.length}${INCLUDE_CAPTIONED ? " (INCLUDED by --include-captioned)" : ""}`);
    console.log(`  no cards anywhere (left alone)       : ${orphans.length}`);

    for (const row of doomed.slice(0, 20)) {
      console.log(
        `  DEL  id=${row.id} ${row.channel} ${row.session_id} ${new Date(row.created_at).toISOString()} "${String(row.message_text || "").slice(0, 20)}" ` +
          `attachments=${row.attachment_count} cards_on_sibling=${cardCount(row.sibling_cards)}`
      );
    }
    for (const row of captioned.slice(0, 20)) {
      console.log(`  TEXT id=${row.id} ${row.channel} ${new Date(row.created_at).toISOString()} "${String(row.message_text).slice(0, 60)}"`);
    }
    for (const row of orphans.slice(0, 20)) {
      console.log(`  KEEP id=${row.id} ${row.channel} ${row.session_id} ${new Date(row.created_at).toISOString()}`);
    }
    if (doomed.length > 20 || orphans.length > 20 || captioned.length > 20) console.log("  … (truncated)");

    if (doomed.length) {
      const deleted = await client.query(
        `DELETE FROM ai_support_messages WHERE id = ANY($1::bigint[]) RETURNING id`,
        [doomed.map((row) => row.id)]
      );
      console.log(`${APPLY ? "deleted" : "would delete"} ${deleted.rowCount} duplicate echo rows`);
    }

    if (APPLY) {
      await client.query("COMMIT");
      console.log("committed");
    } else {
      await client.query("ROLLBACK");
      console.log("dry run — rolled back. re-run with --apply to commit.");
    }
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("failed:", error?.message || error);
    process.exitCode = 1;
  } finally {
    client.release();
    await db.end().catch(() => {});
  }
};

run();
