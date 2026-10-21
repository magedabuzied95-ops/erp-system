// Automatic CRM stages for inbox conversations, the way Genie ERP moves its leads.
//
// A conversation is a LEAD once something marks it as one: it came from an ad, a
// campaign generated it, a stage was picked by hand, or a step below moved it.
// Everything else is an ordinary chat with no stage — the stage filter's "جديد"
// means new leads, not every customer who ever wrote.
//
//   came from an ad (click-to-message)      → new
//   was sent a product card (staff or AI)   → interested
//   an order draft was opened for them      → negotiation
//   their order was confirmed               → won
//
// Forward only: a step never moves a conversation back, never touches a won or
// lost one, and so never undoes a stage an operator picked further along. And it
// only writes the stage: the follow-up sequences a stage can start are left to
// the hand-picked path (owner's decision, 2026-10-21) — an automatic move must
// not message a customer by itself.
//
// Fire-and-forget from the hot paths: nothing here may throw into them.

import db from "../../database/db.js";

export const AUTO_STAGE_RANK = Object.freeze({ new: 0, contacted: 1, interested: 2, negotiation: 3, won: 4 });

const text = (value) => String(value ?? "").trim();

// SQL: is this row a lead yet? A stage other than the default "new" counts — it
// was set on purpose before this marker existed.
export const CONVERSATION_IS_LEAD_SQL = `(
    COALESCE(c.metadata, '{}'::jsonb) ? 'crm_lead'
    OR COALESCE(c.metadata, '{}'::jsonb) ? 'campaign_lead'
    OR LOWER(COALESCE(NULLIF(c.lead_status, ''), 'new')) <> 'new'
  )`;

const RANK_SQL = `(CASE LOWER(COALESCE(NULLIF(c.lead_status, ''), 'new'))
    WHEN 'contacted' THEN 1 WHEN 'interested' THEN 2 WHEN 'negotiation' THEN 3 WHEN 'won' THEN 4 WHEN 'lost' THEN 99
    ELSE 0 END)`;

const lookupIdsFor = (sessionId) => {
  const id = text(sessionId);
  const raw = id.includes(":") ? id.split(":").slice(1).join(":") : id;
  return [...new Set([id, raw].filter(Boolean))];
};

/*
 * Moves one conversation forward to `stage` (see the table above). Returns true
 * when a row changed. `source` says which step did it, for the lead marker.
 */
export const advanceConversationLeadStage = async ({ tenantId, sessionId, stage, source = "" } = {}) => {
  const safeTenantId = Number(tenantId);
  const safeStage = text(stage).toLowerCase();
  const lookupIds = lookupIdsFor(sessionId);
  if (!Number.isInteger(safeTenantId) || safeTenantId <= 0 || !lookupIds.length) return false;
  if (!Object.prototype.hasOwnProperty.call(AUTO_STAGE_RANK, safeStage)) return false;
  const marker = JSON.stringify({ source: text(source) || "auto", at: new Date().toISOString() });
  try {
    const result = await db.query(
      `UPDATE ai_channel_conversations c
          SET lead_status = $3::text,
              metadata = COALESCE(c.metadata, '{}'::jsonb)
                || jsonb_build_object(
                     'lead_status', $3::text,
                     'crm_lead', COALESCE(c.metadata->'crm_lead', $5::jsonb),
                     'lead_stage_auto', $5::jsonb || jsonb_build_object('stage', $3::text)
                   ),
              updated_at = CURRENT_TIMESTAMP
        WHERE c.id = (
          SELECT id FROM ai_channel_conversations
           WHERE tenant_id = $1
             AND (external_conversation_id = ANY($2::text[]) OR CONCAT(channel, ':', external_conversation_id) = ANY($2::text[]))
           ORDER BY updated_at DESC
           LIMIT 1
        )
          AND ${RANK_SQL} < 4
          AND (${RANK_SQL} < $4::int OR NOT ${CONVERSATION_IS_LEAD_SQL})
        RETURNING c.id`,
      [safeTenantId, lookupIds, safeStage, AUTO_STAGE_RANK[safeStage], marker]
    );
    return result.rows.length > 0;
  } catch (error) {
    console.warn("[crm-auto-stage] not moved", { stage: safeStage, source, message: text(error?.message).slice(0, 200) });
    return false;
  }
};

// The same, without waiting and without ever throwing — for webhook and send paths.
// `retryAfterMs` re-tries when no row changed: an ad click is recorded as the
// first message arrives, which can be before that conversation's row is written.
export const advanceConversationLeadStageLater = ({ retryAfterMs = [], ...args } = {}) => {
  const attempt = (delays) => {
    Promise.resolve()
      .then(() => advanceConversationLeadStage(args))
      .then((moved) => {
        if (moved || !delays.length) return;
        const [next, ...rest] = delays;
        const timer = setTimeout(() => attempt(rest), next);
        timer.unref?.();
      })
      .catch(() => {});
  };
  attempt(Array.isArray(retryAfterMs) ? retryAfterMs.filter((ms) => Number(ms) > 0) : []);
};
