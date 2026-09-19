// Who answered, how fast, and how much of it the agent handled without them.
//
// Attribution comes from `ai_support_messages.staff_user_id`, never from `ai_support_sessions`.
// That is deliberate: `assigned_user_id` on a session means "currently held by", and
// updateAiSupportConversationState nulls it the moment the conversation goes back to the AI. It is the
// right answer to "who has this right now" and a useless one for "who handled what last month".
// A message row, by contrast, is written once and keeps its author forever — and it records EVERY
// person who touched a conversation, not just the last one holding it.
//
// The first-response figure is also not the one the old analytics reported. `loadAiSalesAnalytics`
// averages `message.created_at - session.created_at`, i.e. distance from the start of the whole
// conversation, which grows with the conversation's age and is not a reply latency at all. Here a
// staff reply is measured against the customer message it actually answers.

import db from "../database/db.js";

const int = (value, fallback = 0) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const seconds = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : null;
};

// A reply that lands days later is almost always the agent reopening an old thread, not a person
// keeping a customer waiting. Counting it would make one stale thread swamp a whole month's average.
const RESPONSE_OUTLIER_CAP_SECONDS = 24 * 60 * 60;

let indexReadyPromise = null;

export const ensureTeamPerformanceIndexes = async () => {
  if (!indexReadyPromise) {
    indexReadyPromise = (async () => {
      await db.query(
        `CREATE INDEX IF NOT EXISTS idx_ai_support_messages_staff_created
           ON ai_support_messages (tenant_id, staff_user_id, created_at DESC)
         WHERE staff_user_id IS NOT NULL`
      );
    })().catch((error) => {
      indexReadyPromise = null;
      throw error;
    });
  }
  return indexReadyPromise;
};

const rangeBounds = ({ from, to } = {}) => {
  const end = to ? new Date(to) : new Date();
  const start = from ? new Date(from) : new Date(end.getTime() - 29 * 24 * 60 * 60 * 1000);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw Object.assign(new Error("Invalid date range"), { status: 400 });
  }
  return { start, end };
};

/**
 * Per-staff inbox performance for a window.
 *
 * `first_response_seconds` is measured from the customer message immediately preceding each person's
 * FIRST reply in a conversation — their share of the wait, not the conversation's total age.
 */
export const loadInboxTeamPerformance = async ({ tenantId, from, to } = {}) => {
  await ensureTeamPerformanceIndexes().catch(() => {});
  const { start, end } = rangeBounds({ from, to });

  const staffRows = await db.query(
    `
    WITH staff_messages AS (
      SELECT
        m.tenant_id,
        m.session_id,
        m.staff_user_id,
        NULLIF(m.staff_user_name, '') AS staff_user_name,
        m.created_at
      FROM ai_support_messages m
      WHERE m.tenant_id = $1
        AND m.created_at >= $2
        AND m.created_at < $3
        AND m.staff_user_id IS NOT NULL
        AND COALESCE(m.staff_message, '') <> ''
        AND m.deleted_at IS NULL
    ),
    first_per_conversation AS (
      SELECT DISTINCT ON (session_id, staff_user_id)
        tenant_id, session_id, staff_user_id, staff_user_name, created_at
      FROM staff_messages
      ORDER BY session_id, staff_user_id, created_at
    ),
    first_with_wait AS (
      SELECT
        f.staff_user_id,
        f.staff_user_name,
        f.session_id,
        EXTRACT(EPOCH FROM (f.created_at - c.created_at)) AS wait_seconds
      FROM first_per_conversation f
      LEFT JOIN LATERAL (
        SELECT m.created_at
        FROM ai_support_messages m
        WHERE m.tenant_id = f.tenant_id
          AND m.session_id = f.session_id
          AND COALESCE(m.customer_message, '') <> ''
          AND m.created_at <= f.created_at
          AND m.deleted_at IS NULL
        ORDER BY m.created_at DESC
        LIMIT 1
      ) c ON TRUE
    ),
    reply_counts AS (
      SELECT staff_user_id, COUNT(*) AS replies_sent
      FROM staff_messages
      GROUP BY staff_user_id
    )
    SELECT
      w.staff_user_id,
      MAX(w.staff_user_name) AS staff_user_name,
      COUNT(DISTINCT w.session_id) AS conversations_handled,
      COALESCE(MAX(r.replies_sent), 0) AS replies_sent,
      AVG(w.wait_seconds) FILTER (WHERE w.wait_seconds IS NOT NULL AND w.wait_seconds <= $4) AS avg_first_response_seconds,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY w.wait_seconds)
        FILTER (WHERE w.wait_seconds IS NOT NULL AND w.wait_seconds <= $4) AS median_first_response_seconds,
      MAX(w.wait_seconds) FILTER (WHERE w.wait_seconds IS NOT NULL AND w.wait_seconds <= $4) AS slowest_first_response_seconds,
      COUNT(*) FILTER (WHERE w.wait_seconds IS NULL OR w.wait_seconds > $4) AS excluded_conversations
    FROM first_with_wait w
    LEFT JOIN reply_counts r ON r.staff_user_id = w.staff_user_id
    GROUP BY w.staff_user_id
    ORDER BY conversations_handled DESC, replies_sent DESC
    `,
    [tenantId, start, end, RESPONSE_OUTLIER_CAP_SECONDS]
  );

  // Two narrow reads rather than one join: the sessions table answers "how many conversations and how
  // many are held by a person right now", the messages table answers "how many got a human vs an AI
  // reply". Joining them would multiply rows for no extra fact.
  const [sessionTotals, replyTotals] = await Promise.all([
    db.query(
      `
      SELECT
        COUNT(*) AS conversations_total,
        COUNT(*) FILTER (WHERE status = 'human_takeover') AS conversations_held_now
      FROM ai_support_sessions
      WHERE tenant_id = $1 AND updated_at >= $2 AND updated_at < $3 AND deleted_at IS NULL
      `,
      [tenantId, start, end]
    ).catch(() => ({ rows: [] })),
    db.query(
      `
      SELECT
        COUNT(DISTINCT session_id) FILTER (WHERE COALESCE(staff_message, '') <> '') AS conversations_with_staff_reply,
        COUNT(DISTINCT session_id) FILTER (WHERE COALESCE(ai_answer, '') <> '') AS conversations_with_ai_reply
      FROM ai_support_messages
      WHERE tenant_id = $1 AND created_at >= $2 AND created_at < $3 AND deleted_at IS NULL
      `,
      [tenantId, start, end]
    ).catch(() => ({ rows: [] })),
  ]);
  const totals = { rows: [{ ...(sessionTotals.rows[0] || {}), ...(replyTotals.rows[0] || {}) }] };

  const staff = staffRows.rows.map((row) => ({
    staff_user_id: int(row.staff_user_id),
    staff_user_name: row.staff_user_name || "",
    conversations_handled: int(row.conversations_handled),
    replies_sent: int(row.replies_sent),
    avg_first_response_seconds: seconds(row.avg_first_response_seconds),
    median_first_response_seconds: seconds(row.median_first_response_seconds),
    slowest_first_response_seconds: seconds(row.slowest_first_response_seconds),
    // Conversations whose wait could not be measured, or that exceeded the outlier cap. Shown rather
    // than hidden: a person whose numbers rest on two of nine conversations deserves the asterisk.
    excluded_conversations: int(row.excluded_conversations),
  }));

  const totalsRow = totals.rows[0] || {};
  const handled = staff.reduce((sum, row) => sum + row.conversations_handled, 0);
  const replies = staff.reduce((sum, row) => sum + row.replies_sent, 0);
  const measured = staff.filter((row) => row.avg_first_response_seconds !== null);

  return {
    range: { from: start.toISOString(), to: end.toISOString() },
    outlier_cap_seconds: RESPONSE_OUTLIER_CAP_SECONDS,
    staff,
    totals: {
      staff_count: staff.length,
      conversations_handled: handled,
      replies_sent: replies,
      conversations_total: int(totalsRow.conversations_total),
      conversations_held_now: int(totalsRow.conversations_held_now),
      conversations_with_staff_reply: int(totalsRow.conversations_with_staff_reply),
      conversations_with_ai_reply: int(totalsRow.conversations_with_ai_reply),
      avg_first_response_seconds: measured.length
        ? Math.round(measured.reduce((sum, row) => sum + row.avg_first_response_seconds, 0) / measured.length)
        : null,
    },
  };
};

export default loadInboxTeamPerformance;
