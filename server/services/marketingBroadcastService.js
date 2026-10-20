// Broadcasts: one message, many customers, through the machinery that already exists.
//
// Nothing here sends. It builds an audience, records a campaign, and hands each recipient to
// `queueWhatsappAutomation` — the same queue that carries order confirmations, with its four brakes
// (connection gate, circuit breaker, rolling-minute rate limit, randomized inter-message delay).
// Re-implementing any of that for marketing would be the fastest way to get the number restricted.
//
// Four rules are enforced here and cannot be switched off from the UI:
//   1. opted-out customers are excluded, always (marketingConsentService);
//   2. quiet hours — nothing leaves between 22:00 and 09:00 Cairo, it waits for the morning;
//   3. a per-customer frequency cap — at most one marketing message every N days;
//   4. the whole feature is behind a flag that ships OFF.
//
// The audience query deliberately does NOT reuse analyticsCustomersService. That service segments
// customers well, but it is hard-blocked from ever selecting `customers.phone` at any permission
// level, and a broadcast needs the phone. Its segment thresholds are mirrored here instead.

import db from "../database/db.js";
import { queueWhatsappAutomation } from "./whatsappQueue/index.js";
import { ensureMarketingConsentSchema } from "./marketingConsentService.js";
import { ensureWhatsappTemplateSchema } from "./whatsappTemplateStudioService.js";
import { customerTagsAnyClauseSql, ensureCustomerTagsSchema, normalizeCustomerTags } from "./customerTagsService.js";
import {
  assertCampaignTemplateUsable,
  deliverTemplateCampaign,
  isCampaignDeliveryRunning,
  normalizeTemplateVariables,
  phoneDedupeKey,
} from "./marketingCampaignTemplateService.js";

const text = (value) => String(value ?? "").trim();
const int = (value, fallback = 0) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

// Ships OFF. The owner turns it on when they have decided what the first campaign says.
export const broadcastsEnabled = () =>
  String(process.env.MARKETING_BROADCASTS_ENABLED || "").trim().toLowerCase() === "true";

export const BROADCAST_AUTOMATION_TYPE = "marketing_broadcast";

// Cairo, because the shop and its customers are. A message at 3am reads as spam even when it is not.
const QUIET_HOURS = Object.freeze({ startHour: 22, endHour: 9, timeZone: "Africa/Cairo" });
const DEFAULT_FREQUENCY_CAP_DAYS = 7;
const MAX_AUDIENCE = 5000;

const cairoParts = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: QUIET_HOURS.timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const hour = int(parts.find((part) => part.type === "hour")?.value, 0);
  const minute = int(parts.find((part) => part.type === "minute")?.value, 0);
  return { hour, minute };
};

/**
 * When a message created now may actually go out. Inside quiet hours it is pushed to the next 09:00
 * Cairo; otherwise it leaves as soon as the queue reaches it.
 */
export const resolveSendWindow = (now = new Date()) => {
  const { hour, minute } = cairoParts(now);
  const inQuietHours = hour >= QUIET_HOURS.startHour || hour < QUIET_HOURS.endHour;
  if (!inQuietHours) return { scheduledAt: null, deferred: false };
  const hoursUntilMorning = hour >= QUIET_HOURS.startHour
    ? 24 - hour + QUIET_HOURS.endHour
    : QUIET_HOURS.endHour - hour;
  const scheduledAt = new Date(now.getTime() + hoursUntilMorning * 60 * 60 * 1000 - minute * 60 * 1000);
  return { scheduledAt, deferred: true };
};

let schemaReadyPromise = null;

export const ensureBroadcastSchema = async (clientOrPool = db) => {
  const run = async () => {
    await ensureMarketingConsentSchema(clientOrPool);
    await clientOrPool.query(`
      CREATE TABLE IF NOT EXISTS marketing_broadcasts (
        id BIGSERIAL PRIMARY KEY,
        tenant_id BIGINT NOT NULL,
        name TEXT NOT NULL DEFAULT '',
        status VARCHAR(20) NOT NULL DEFAULT 'draft',
        audience JSONB NOT NULL DEFAULT '{}'::jsonb,
        message_body TEXT NOT NULL DEFAULT '',
        frequency_cap_days INTEGER NOT NULL DEFAULT 7,
        recipients_total INTEGER NOT NULL DEFAULT 0,
        recipients_queued INTEGER NOT NULL DEFAULT 0,
        recipients_skipped INTEGER NOT NULL DEFAULT 0,
        created_by BIGINT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        started_at TIMESTAMPTZ NULL,
        stopped_at TIMESTAMPTZ NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await clientOrPool.query(`
      CREATE TABLE IF NOT EXISTS marketing_broadcast_recipients (
        id BIGSERIAL PRIMARY KEY,
        broadcast_id BIGINT NOT NULL REFERENCES marketing_broadcasts(id) ON DELETE CASCADE,
        tenant_id BIGINT NOT NULL,
        customer_id BIGINT NULL,
        phone VARCHAR(40) NOT NULL DEFAULT '',
        status VARCHAR(20) NOT NULL DEFAULT 'queued',
        skip_reason VARCHAR(40) NOT NULL DEFAULT '',
        idempotency_key VARCHAR(200) NOT NULL DEFAULT '',
        queued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (broadcast_id, customer_id)
      )
    `);
    await clientOrPool.query(
      `CREATE INDEX IF NOT EXISTS idx_marketing_broadcasts_tenant_created
         ON marketing_broadcasts (tenant_id, created_at DESC)`
    );
    // Campaigns: a broadcast can carry an approved Cloud API template instead of a plain-text body,
    // and can wait for a scheduled time. Text broadcasts keep every default below.
    for (const ddl of [
      `ALTER TABLE marketing_broadcasts ADD COLUMN IF NOT EXISTS channel_mode VARCHAR(12) NOT NULL DEFAULT 'text'`,
      `ALTER TABLE marketing_broadcasts ADD COLUMN IF NOT EXISTS template_id BIGINT NULL`,
      `ALTER TABLE marketing_broadcasts ADD COLUMN IF NOT EXISTS template_variables JSONB NOT NULL DEFAULT '[]'::jsonb`,
      `ALTER TABLE marketing_broadcasts ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ NULL`,
      `ALTER TABLE marketing_broadcasts ADD COLUMN IF NOT EXISTS last_run_at TIMESTAMPTZ NULL`,
      `ALTER TABLE marketing_broadcasts ADD COLUMN IF NOT EXISTS group_name TEXT NOT NULL DEFAULT ''`,
      `ALTER TABLE marketing_broadcasts ADD COLUMN IF NOT EXISTS recipients_sent INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE marketing_broadcasts ADD COLUMN IF NOT EXISTS recipients_failed INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE marketing_broadcasts ADD COLUMN IF NOT EXISTS last_error TEXT NOT NULL DEFAULT ''`,
      `ALTER TABLE marketing_broadcast_recipients ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ NULL`,
      `ALTER TABLE marketing_broadcast_recipients ADD COLUMN IF NOT EXISTS message_id VARCHAR(200) NOT NULL DEFAULT ''`,
      `ALTER TABLE marketing_broadcast_recipients ADD COLUMN IF NOT EXISTS error_code VARCHAR(80) NOT NULL DEFAULT ''`,
      `ALTER TABLE marketing_broadcast_recipients ADD COLUMN IF NOT EXISTS error_meaning VARCHAR(80) NOT NULL DEFAULT ''`,
      `ALTER TABLE marketing_broadcast_recipients ADD COLUMN IF NOT EXISTS error_message TEXT NOT NULL DEFAULT ''`,
      `CREATE INDEX IF NOT EXISTS idx_marketing_broadcasts_due ON marketing_broadcasts (scheduled_at) WHERE status = 'scheduled'`,
      // Replies (GENI's campaign form): an optional chatbot flow that answers a reply to the
      // campaign, the campaign's own instructions for the AI, and "auto lead generation" (each
      // recipient's conversation gets a lead + attribution on send) — ON by default, like GENI.
      // Read by server/modules/campaignAttribution/*.
      `ALTER TABLE marketing_broadcasts ADD COLUMN IF NOT EXISTS chatbot_flow_id BIGINT NULL`,
      `ALTER TABLE marketing_broadcasts ADD COLUMN IF NOT EXISTS ai_instructions TEXT NOT NULL DEFAULT ''`,
      `ALTER TABLE marketing_broadcasts ADD COLUMN IF NOT EXISTS auto_lead_generation BOOLEAN NOT NULL DEFAULT TRUE`,
      // A reply that quotes the campaign message is matched by its wamid; a plain reply by phone
      // inside the last 72 hours.
      `CREATE INDEX IF NOT EXISTS idx_marketing_broadcast_recipients_message ON marketing_broadcast_recipients (tenant_id, message_id) WHERE message_id <> ''`,
      `CREATE INDEX IF NOT EXISTS idx_marketing_broadcast_recipients_sent ON marketing_broadcast_recipients (tenant_id, sent_at DESC) WHERE sent_at IS NOT NULL`,
    ]) {
      await clientOrPool.query(ddl);
    }
  };
  if (clientOrPool !== db) return run();
  if (!schemaReadyPromise) {
    schemaReadyPromise = run().catch((error) => {
      schemaReadyPromise = null;
      throw error;
    });
  }
  return schemaReadyPromise;
};

/*
 * Audience filters. Every one of them is a WHERE clause over `customers`, and the opt-out and
 * frequency-cap conditions are appended unconditionally — they are not filters the caller chooses.
 */
const buildAudienceQuery = ({ tenantId, audience = {}, frequencyCapDays = DEFAULT_FREQUENCY_CAP_DAYS, limit = MAX_AUDIENCE }) => {
  const conditions = ["c.tenant_id = $1", "COALESCE(c.phone, '') <> ''", "c.marketing_opt_out_at IS NULL"];
  const params = [tenantId];
  const push = (value) => {
    params.push(value);
    return `$${params.length}`;
  };

  const minOrders = int(audience.min_orders, 0);
  if (minOrders > 0) conditions.push(`COALESCE(c.total_orders, 0) >= ${push(minOrders)}`);

  const minSpent = Number(audience.min_spent) || 0;
  if (minSpent > 0) conditions.push(`COALESCE(c.total_spent, 0) >= ${push(minSpent)}`);

  const tier = text(audience.loyalty_tier);
  if (tier && tier !== "all") conditions.push(`LOWER(COALESCE(c.loyalty_tier, '')) = LOWER(${push(tier)})`);

  // Customer tags ("VIP", "جملة"): any of the listed ones. The column is
  // ensured by customerTagsService before the audience is ever previewed.
  const tags = normalizeCustomerTags(audience.tags);
  if (tags.length) conditions.push(customerTagsAnyClauseSql(push(tags)));

  // "Bought in the last N days" and "has not bought for N days" are the two that actually get used.
  // `customers` has no last-order column, so this comes from the orders roll-up joined below.
  const boughtWithinDays = int(audience.bought_within_days, 0);
  if (boughtWithinDays > 0) {
    conditions.push(`o.last_order_at IS NOT NULL AND o.last_order_at >= NOW() - (${push(boughtWithinDays)} || ' days')::interval`);
  }
  const quietForDays = int(audience.quiet_for_days, 0);
  if (quietForDays > 0) {
    conditions.push(`(o.last_order_at IS NULL OR o.last_order_at < NOW() - (${push(quietForDays)} || ' days')::interval)`);
  }

  // The frequency cap. Never optional, only tightenable.
  const capDays = Math.max(1, int(frequencyCapDays, DEFAULT_FREQUENCY_CAP_DAYS));
  conditions.push(
    `(c.marketing_last_sent_at IS NULL OR c.marketing_last_sent_at < NOW() - (${push(capDays)} || ' days')::interval)`
  );

  const capped = Math.max(1, Math.min(MAX_AUDIENCE, int(limit, MAX_AUDIENCE)));
  return {
    sql: `
      WITH customer_orders AS (
        SELECT customer_id, MAX(created_at) AS last_order_at
        FROM orders
        WHERE tenant_id = $1 AND customer_id IS NOT NULL
        GROUP BY customer_id
      )
      SELECT c.id, c.name, c.phone
      FROM customers c
      LEFT JOIN customer_orders o ON o.customer_id = c.id
      WHERE ${conditions.join("\n        AND ")}
      ORDER BY c.total_spent DESC NULLS LAST, c.id
      LIMIT ${capped}
    `,
    params,
  };
};

export const previewBroadcastAudience = async ({ tenantId, audience = {}, frequencyCapDays } = {}) => {
  await ensureBroadcastSchema();
  await ensureCustomerTagsSchema();
  const { sql, params } = buildAudienceQuery({ tenantId, audience, frequencyCapDays });
  const result = await db.query(sql, params);
  const rows = result.rows || [];
  return {
    total: rows.length,
    capped_at: MAX_AUDIENCE,
    // A handful of names so the owner can see WHO this is before sending, never the whole list.
    sample: rows.slice(0, 5).map((row) => ({ id: Number(row.id), name: text(row.name) })),
  };
};

const renderBody = (template = "", customer = {}) =>
  text(template).replace(/\{\{\s*customer_name\s*\}\}/g, text(customer.name) || "");

const CHANNEL_MODES = ["text", "template"];

const parseScheduledAt = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw Object.assign(new Error("Invalid schedule time"), { status: 400, code: "CAMPAIGN_SCHEDULE_INVALID" });
  return date;
};

/**
 * The campaign fields shared by create and update. A picked group is a customer tag, so it is merged
 * into audience.tags — the audience query stays the one place that decides who receives a campaign.
 */
const normalizeCampaignFields = async ({ tenantId, input = {} }) => {
  const channelMode = CHANNEL_MODES.includes(text(input.channelMode)) ? text(input.channelMode) : "text";
  const groupName = text(input.groupName).slice(0, 120);
  const audience = { ...(input.audience || {}) };
  if (groupName) {
    const tags = normalizeCustomerTags(audience.tags);
    audience.tags = tags.includes(groupName) ? tags : [...tags, groupName];
  }
  let body = text(input.messageBody);
  let templateId = null;
  let templateVariables = [];
  if (channelMode === "template") {
    const template = await assertCampaignTemplateUsable({ tenantId, templateId: input.templateId });
    templateId = Number(template.id);
    templateVariables = normalizeTemplateVariables(input.templateVariables);
    // Kept for the record: what the campaign says, before per-customer values.
    body = text(template.body_text);
  } else if (!body) {
    throw Object.assign(new Error("A broadcast needs a message"), { status: 400 });
  }
  return {
    channelMode,
    groupName,
    audience,
    body,
    templateId,
    templateVariables,
    frequencyCapDays: Math.max(1, int(input.frequencyCapDays, DEFAULT_FREQUENCY_CAP_DAYS)),
    // Reply handling. A flow only answers replies on the official number, so it is kept for
    // template campaigns alone; the AI instructions and lead generation apply to both kinds.
    chatbotFlowId: channelMode === "template" ? int(input.chatbotFlowId, 0) || null : null,
    aiInstructions: text(input.aiInstructions).slice(0, 2000),
    autoLeadGeneration: input.autoLeadGeneration !== false && input.autoLeadGeneration !== "false",
  };
};

export const createBroadcast = async ({
  tenantId,
  name,
  messageBody,
  audience = {},
  frequencyCapDays,
  createdBy = null,
  channelMode = "text",
  templateId = null,
  templateVariables = [],
  groupName = "",
  chatbotFlowId = null,
  aiInstructions = "",
  autoLeadGeneration = true,
} = {}) => {
  await ensureBroadcastSchema();
  const fields = await normalizeCampaignFields({
    tenantId,
    input: { messageBody, audience, frequencyCapDays, channelMode, templateId, templateVariables, groupName, chatbotFlowId, aiInstructions, autoLeadGeneration },
  });
  const result = await db.query(
    `
    INSERT INTO marketing_broadcasts
      (tenant_id, name, status, audience, message_body, frequency_cap_days, created_by,
       channel_mode, template_id, template_variables, group_name,
       chatbot_flow_id, ai_instructions, auto_lead_generation)
    VALUES ($1, $2, 'draft', $3::jsonb, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13)
    RETURNING *
    `,
    [
      tenantId,
      text(name).slice(0, 200),
      JSON.stringify(fields.audience || {}),
      fields.body,
      fields.frequencyCapDays,
      Number(createdBy) || null,
      fields.channelMode,
      fields.templateId,
      JSON.stringify(fields.templateVariables),
      fields.groupName,
      fields.chatbotFlowId,
      fields.aiInstructions,
      fields.autoLeadGeneration,
    ]
  );
  return result.rows[0];
};

const findBroadcast = async ({ tenantId, broadcastId }) => {
  const found = await db.query(`SELECT * FROM marketing_broadcasts WHERE tenant_id = $1 AND id = $2 LIMIT 1`, [tenantId, broadcastId]);
  if (!found.rows[0]) throw Object.assign(new Error("Broadcast not found"), { status: 404 });
  return found.rows[0];
};

/** Edits a campaign that has not started. A scheduled one stays scheduled. */
export const updateBroadcast = async ({ tenantId, broadcastId, input = {} } = {}) => {
  await ensureBroadcastSchema();
  const current = await findBroadcast({ tenantId, broadcastId });
  if (!["draft", "scheduled"].includes(current.status)) {
    throw Object.assign(new Error(`Broadcast is already ${current.status}`), { status: 409 });
  }
  const fields = await normalizeCampaignFields({
    tenantId,
    input: {
      messageBody: input.messageBody ?? current.message_body,
      audience: input.audience ?? current.audience,
      frequencyCapDays: input.frequencyCapDays ?? current.frequency_cap_days,
      channelMode: input.channelMode ?? current.channel_mode,
      templateId: input.templateId ?? current.template_id,
      templateVariables: input.templateVariables ?? current.template_variables,
      groupName: input.groupName ?? current.group_name,
      chatbotFlowId: input.chatbotFlowId === undefined ? current.chatbot_flow_id : input.chatbotFlowId,
      aiInstructions: input.aiInstructions ?? current.ai_instructions,
      autoLeadGeneration: input.autoLeadGeneration ?? current.auto_lead_generation,
    },
  });
  const result = await db.query(
    `
    UPDATE marketing_broadcasts
       SET name = $3, audience = $4::jsonb, message_body = $5, frequency_cap_days = $6,
           channel_mode = $7, template_id = $8, template_variables = $9::jsonb, group_name = $10,
           chatbot_flow_id = $11, ai_instructions = $12, auto_lead_generation = $13,
           updated_at = NOW()
     WHERE tenant_id = $1 AND id = $2 AND status IN ('draft', 'scheduled')
    RETURNING *
    `,
    [
      tenantId,
      broadcastId,
      text(input.name ?? current.name).slice(0, 200),
      JSON.stringify(fields.audience || {}),
      fields.body,
      fields.frequencyCapDays,
      fields.channelMode,
      fields.templateId,
      JSON.stringify(fields.templateVariables),
      fields.groupName,
      fields.chatbotFlowId,
      fields.aiInstructions,
      fields.autoLeadGeneration,
    ]
  );
  if (!result.rows[0]) throw Object.assign(new Error("Broadcast changed while saving"), { status: 409 });
  return result.rows[0];
};

/** Arms a draft (or moves a scheduled campaign) to fire at `scheduledAt`. Stored as UTC. */
export const scheduleBroadcast = async ({ tenantId, broadcastId, scheduledAt } = {}) => {
  if (!broadcastsEnabled()) {
    throw Object.assign(new Error("Broadcasts are switched off"), { status: 403, code: "BROADCASTS_DISABLED" });
  }
  await ensureBroadcastSchema();
  const at = parseScheduledAt(scheduledAt);
  if (!at) throw Object.assign(new Error("Pick a time to schedule"), { status: 400, code: "CAMPAIGN_SCHEDULE_REQUIRED" });
  if (at.getTime() < Date.now() - 60 * 1000) {
    throw Object.assign(new Error("The schedule time is in the past"), { status: 400, code: "CAMPAIGN_SCHEDULE_PAST" });
  }
  const current = await findBroadcast({ tenantId, broadcastId });
  if (current.channel_mode === "template") await assertCampaignTemplateUsable({ tenantId, templateId: current.template_id });
  const result = await db.query(
    `
    UPDATE marketing_broadcasts
       SET status = 'scheduled', scheduled_at = $3, last_error = '', updated_at = NOW()
     WHERE tenant_id = $1 AND id = $2 AND status IN ('draft', 'scheduled')
    RETURNING *
    `,
    [tenantId, broadcastId, at.toISOString()]
  );
  if (!result.rows[0]) throw Object.assign(new Error(`Broadcast is already ${current.status}`), { status: 409 });
  return result.rows[0];
};

export const cancelBroadcastSchedule = async ({ tenantId, broadcastId } = {}) => {
  await ensureBroadcastSchema();
  const result = await db.query(
    `
    UPDATE marketing_broadcasts
       SET status = 'draft', scheduled_at = NULL, updated_at = NOW()
     WHERE tenant_id = $1 AND id = $2 AND status = 'scheduled'
    RETURNING *
    `,
    [tenantId, broadcastId]
  );
  if (!result.rows[0]) throw Object.assign(new Error("This campaign is not scheduled"), { status: 409 });
  return result.rows[0];
};

/** The per-recipient log: who was sent, who failed, and Meta's reason. */
export const listBroadcastRecipients = async ({ tenantId, broadcastId, limit = 200 } = {}) => {
  await ensureBroadcastSchema();
  const result = await db.query(
    `
    SELECT r.id, r.customer_id, c.name AS customer_name, r.phone, r.status, r.skip_reason,
           r.error_code, r.error_meaning, r.error_message, r.sent_at, r.queued_at
      FROM marketing_broadcast_recipients r
      LEFT JOIN customers c ON c.id = r.customer_id AND c.tenant_id = r.tenant_id
     WHERE r.tenant_id = $1 AND r.broadcast_id = $2
     ORDER BY (r.status = 'failed') DESC, r.id
     LIMIT $3
    `,
    [tenantId, broadcastId, Math.max(1, Math.min(1000, int(limit, 200)))]
  );
  return result.rows;
};

export const listBroadcasts = async ({ tenantId, limit = 20 } = {}) => {
  await ensureBroadcastSchema();
  await ensureWhatsappTemplateSchema();
  const result = await db.query(
    `
    SELECT b.*,
           t.name AS template_name,
           t.language AS template_language,
           t.status AS template_status,
           COUNT(r.id) FILTER (WHERE r.status = 'queued') AS queued_count,
           COUNT(r.id) FILTER (WHERE r.status = 'skipped') AS skipped_count,
           COUNT(r.id) FILTER (WHERE r.status = 'sent') AS sent_count,
           COUNT(r.id) FILTER (WHERE r.status = 'failed') AS failed_count,
           COUNT(r.id) FILTER (WHERE r.status IN ('pending', 'sending')) AS pending_count
    FROM marketing_broadcasts b
    LEFT JOIN marketing_broadcast_recipients r ON r.broadcast_id = b.id
    LEFT JOIN whatsapp_message_templates t ON t.id = b.template_id AND t.tenant_id = b.tenant_id
    WHERE b.tenant_id = $1
    GROUP BY b.id, t.id
    ORDER BY b.created_at DESC
    LIMIT $2
    `,
    [tenantId, Math.max(1, Math.min(100, int(limit, 20)))]
  );
  return result.rows;
};

/**
 * Queues one broadcast. Every recipient becomes one queue row; the queue does the sending.
 * Returns what was queued and what was skipped, with the reason.
 */
export const sendBroadcast = async ({ tenantId, broadcastId } = {}) => {
  if (!broadcastsEnabled()) {
    throw Object.assign(new Error("Broadcasts are switched off"), { status: 403, code: "BROADCASTS_DISABLED" });
  }
  await ensureBroadcastSchema();
  const found = await db.query(
    `SELECT * FROM marketing_broadcasts WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
    [tenantId, broadcastId]
  );
  const existing = found.rows[0];
  if (!existing) throw Object.assign(new Error("Broadcast not found"), { status: 404 });
  if (!["draft", "scheduled"].includes(existing.status)) {
    throw Object.assign(new Error(`Broadcast is already ${existing.status}`), { status: 409 });
  }
  if (existing.channel_mode === "template") {
    // Refused before anything is claimed: only an APPROVED template may start.
    await assertCampaignTemplateUsable({ tenantId, templateId: existing.template_id });
    // Template sends leave immediately (they do not wait in the queue), so inside quiet hours
    // "send now" becomes a schedule for the morning instead.
    const window = resolveSendWindow();
    if (window.deferred) {
      const deferredRow = await db.query(
        `UPDATE marketing_broadcasts SET status = 'scheduled', scheduled_at = $3, updated_at = NOW()
          WHERE tenant_id = $1 AND id = $2 AND status IN ('draft', 'scheduled') RETURNING *`,
        [tenantId, existing.id, window.scheduledAt.toISOString()]
      );
      return { broadcast: deferredRow.rows[0] || existing, queued: 0, skipped: 0, deferred_to_morning: true };
    }
  }
  // The claim: one atomic flip to 'sending', so a double click, or the scheduler racing a manual
  // send, can never start the same campaign twice.
  const claimed = await db.query(
    `UPDATE marketing_broadcasts
        SET status = 'sending', started_at = NOW(), last_run_at = NOW(), last_error = '', updated_at = NOW()
      WHERE tenant_id = $1 AND id = $2 AND status IN ('draft', 'scheduled')
     RETURNING *`,
    [tenantId, existing.id]
  );
  if (!claimed.rows[0]) throw Object.assign(new Error("Broadcast was started by someone else"), { status: 409 });
  return runClaimedBroadcast({ tenantId, broadcast: claimed.rows[0] });
};

/**
 * Runs a campaign that is already claimed (status = 'sending'): by sendBroadcast for "send now",
 * by the scheduler for a due one.
 */
const runClaimedBroadcast = async ({ tenantId, broadcast } = {}) => {
  await ensureCustomerTagsSchema();
  const { sql, params } = buildAudienceQuery({
    tenantId,
    audience: broadcast.audience || {},
    frequencyCapDays: broadcast.frequency_cap_days,
  });
  const audienceRows = (await db.query(sql, params)).rows || [];
  if (broadcast.channel_mode === "template") return prepareTemplateCampaign({ tenantId, broadcast, audienceRows });
  const { scheduledAt, deferred } = resolveSendWindow();

  let queued = 0;
  let skipped = 0;
  for (const customer of audienceRows) {
    const phone = text(customer.phone);
    if (!phone) {
      skipped += 1;
      continue;
    }
    const idempotencySuffix = `broadcast-${broadcast.id}`;
    try {
      // No `directSend` is passed, on purpose. Every other automation keeps a direct path so a queue
      // outage cannot cost a customer their receipt; a broadcast has the opposite priority — hundreds
      // of unpaced messages is exactly the burst the pacer exists to prevent, so if it cannot be
      // queued it is not sent at all. The wrapper then returns `queued: false` rather than throwing,
      // which is why the result is inspected instead of being assumed to be a success.
      const result = await queueWhatsappAutomation({
        tenantId,
        automationType: BROADCAST_AUTOMATION_TYPE,
        customerId: Number(customer.id) || null,
        recipientPhone: phone,
        fallbackBody: renderBody(broadcast.message_body, customer),
        values: { customer_name: text(customer.name) },
        idempotencySuffix,
        scheduledAt,
      });
      if (!result?.queued) {
        skipped += 1;
        await db.query(
          `
          INSERT INTO marketing_broadcast_recipients (broadcast_id, tenant_id, customer_id, phone, status, skip_reason)
          VALUES ($1, $2, $3, $4, 'skipped', $5)
          ON CONFLICT (broadcast_id, customer_id) DO NOTHING
          `,
          [
            broadcast.id,
            tenantId,
            Number(customer.id) || null,
            phone,
            text(result?.reason || (result?.duplicate ? "duplicate" : "not_queued")).slice(0, 40),
          ]
        ).catch(() => {});
        continue;
      }
      await db.query(
        `
        INSERT INTO marketing_broadcast_recipients (broadcast_id, tenant_id, customer_id, phone, status, idempotency_key)
        VALUES ($1, $2, $3, $4, 'queued', $5)
        ON CONFLICT (broadcast_id, customer_id) DO NOTHING
        `,
        [broadcast.id, tenantId, Number(customer.id) || null, phone, idempotencySuffix]
      );
      // The frequency cap is only honest if it is stamped at queue time: a second broadcast started
      // a minute later must not see this customer as untouched.
      await db.query(
        `UPDATE customers SET marketing_last_sent_at = NOW() WHERE tenant_id = $1 AND id = $2`,
        [tenantId, Number(customer.id) || 0]
      );
      queued += 1;
    } catch (error) {
      skipped += 1;
      await db.query(
        `
        INSERT INTO marketing_broadcast_recipients (broadcast_id, tenant_id, customer_id, phone, status, skip_reason)
        VALUES ($1, $2, $3, $4, 'skipped', $5)
        ON CONFLICT (broadcast_id, customer_id) DO NOTHING
        `,
        [broadcast.id, tenantId, Number(customer.id) || null, phone, text(error?.code || "queue_error").slice(0, 40)]
      ).catch(() => {});
    }
  }

  const updated = await db.query(
    `
    UPDATE marketing_broadcasts
       SET status = 'sending',
           recipients_total = $3,
           recipients_queued = $4,
           recipients_skipped = $5,
           updated_at = NOW()
     WHERE tenant_id = $1 AND id = $2
    RETURNING *
    `,
    [tenantId, broadcast.id, audienceRows.length, queued, skipped]
  );

  console.log("[marketing-broadcast] queued", {
    tenant_id: tenantId,
    broadcast_id: broadcast.id,
    audience: audienceRows.length,
    queued,
    skipped,
    deferred_to_morning: deferred,
  });

  return { broadcast: updated.rows[0], queued, skipped, deferred_to_morning: deferred };
};

/**
 * Template mode: every audience member becomes a 'pending' recipient row (deduped by customer AND
 * by phone), the frequency cap is stamped now — same reasoning as the queue path — and delivery
 * runs detached at the pacer's rate. The HTTP request returns as soon as the rows exist.
 */
const prepareTemplateCampaign = async ({ tenantId, broadcast, audienceRows = [] }) => {
  const seenPhones = new Set();
  let queued = 0;
  let skipped = 0;
  for (const customer of audienceRows) {
    const phone = text(customer.phone);
    const key = phoneDedupeKey(phone);
    const duplicate = Boolean(key) && seenPhones.has(key);
    if (key) seenPhones.add(key);
    const status = key && !duplicate ? "pending" : "skipped";
    const reason = !key ? "no_phone" : duplicate ? "duplicate_phone" : "";
    const inserted = await db.query(
      `
      INSERT INTO marketing_broadcast_recipients (broadcast_id, tenant_id, customer_id, phone, status, skip_reason, idempotency_key)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (broadcast_id, customer_id) DO NOTHING
      RETURNING id
      `,
      [broadcast.id, tenantId, Number(customer.id) || null, phone, status, reason, `campaign-${broadcast.id}`]
    );
    if (status !== "pending" || !inserted.rowCount) {
      skipped += 1;
      continue;
    }
    await db.query(`UPDATE customers SET marketing_last_sent_at = NOW() WHERE tenant_id = $1 AND id = $2`, [tenantId, Number(customer.id) || 0]);
    queued += 1;
  }
  const updated = await db.query(
    `
    UPDATE marketing_broadcasts
       SET recipients_total = $3, recipients_queued = $4, recipients_skipped = $5,
           status = CASE WHEN $4::int = 0 THEN 'completed' ELSE status END,
           updated_at = NOW()
     WHERE tenant_id = $1 AND id = $2
    RETURNING *
    `,
    [tenantId, broadcast.id, audienceRows.length, queued, skipped]
  );
  if (queued > 0) void deliverTemplateCampaign({ tenantId, broadcast: updated.rows[0] || broadcast });
  console.log("[marketing-campaign] prepared", { tenant_id: tenantId, broadcast_id: broadcast.id, audience: audienceRows.length, queued, skipped });
  return { broadcast: updated.rows[0], queued, skipped, deferred_to_morning: false };
};

/*
 * The campaign scheduler. Every minute it claims due scheduled campaigns with one atomic
 * UPDATE … WHERE status = 'scheduled' … RETURNING, so each fires exactly once even with several
 * server processes, and it resumes template deliveries a restart interrupted. It does nothing
 * while the feature flag is off or inside quiet hours (a due campaign then fires at 09:00 Cairo).
 * A campaign more than a day overdue (flag was off, server was down) is failed, not fired late.
 */
export const runDueCampaigns = async ({ now = new Date() } = {}) => {
  if (!broadcastsEnabled()) return { claimed: 0, skipped: "disabled" };
  await ensureBroadcastSchema();
  await db.query(
    `UPDATE marketing_broadcasts
        SET status = 'failed', last_error = 'schedule_missed', updated_at = NOW()
      WHERE status = 'scheduled' AND scheduled_at < NOW() - INTERVAL '24 hours'`
  );
  if (resolveSendWindow(now).deferred) return { claimed: 0, skipped: "quiet_hours" };
  const claimed = await db.query(
    `
    UPDATE marketing_broadcasts
       SET status = 'sending', started_at = NOW(), last_run_at = NOW(), last_error = '', updated_at = NOW()
     WHERE id IN (
       SELECT id FROM marketing_broadcasts
        WHERE status = 'scheduled' AND scheduled_at <= NOW()
        ORDER BY scheduled_at
        LIMIT 10
        FOR UPDATE SKIP LOCKED
     )
       AND status = 'scheduled'
    RETURNING *
    `
  );
  for (const broadcast of claimed.rows) {
    const tenantId = Number(broadcast.tenant_id);
    try {
      if (broadcast.channel_mode === "template") {
        await assertCampaignTemplateUsable({ tenantId, templateId: broadcast.template_id });
      }
      await runClaimedBroadcast({ tenantId, broadcast });
    } catch (error) {
      console.error("[marketing-campaign] scheduled run failed", { broadcast_id: broadcast.id, message: error?.message });
      await db.query(
        `UPDATE marketing_broadcasts SET status = 'failed', last_error = $2, updated_at = NOW() WHERE id = $1`,
        [broadcast.id, text(error?.message || "run_failed").slice(0, 500)]
      ).catch(() => {});
    }
  }
  // Template campaigns a restart left half-delivered.
  const interrupted = await db.query(
    `SELECT * FROM marketing_broadcasts b
      WHERE b.status = 'sending' AND b.channel_mode = 'template'
        AND EXISTS (SELECT 1 FROM marketing_broadcast_recipients r WHERE r.broadcast_id = b.id AND r.status IN ('pending', 'sending'))
      LIMIT 10`
  );
  let resumed = 0;
  for (const broadcast of interrupted.rows) {
    if (isCampaignDeliveryRunning(broadcast.id)) continue;
    resumed += 1;
    void deliverTemplateCampaign({ tenantId: Number(broadcast.tenant_id), broadcast });
  }
  return { claimed: claimed.rows.length, resumed };
};

let schedulerTimer = null;

/** Started once from server.js next to the other background workers. */
export const startMarketingCampaignScheduler = ({ register = null, intervalMs = 60 * 1000 } = {}) => {
  if (schedulerTimer) return schedulerTimer;
  const tick = () => {
    void runDueCampaigns().catch((error) => {
      console.error("[marketing-campaign] scheduler tick failed", { message: error?.message });
    });
  };
  schedulerTimer = setInterval(tick, Math.max(10 * 1000, Number(intervalMs) || 60 * 1000));
  schedulerTimer.unref?.();
  if (typeof register === "function") register(schedulerTimer);
  setTimeout(tick, 15 * 1000).unref?.();
  console.log("[server] marketing campaign scheduler started");
  return schedulerTimer;
};

/**
 * The kill switch. Cancels every queue row this broadcast created that has not gone out yet.
 * A message already sent cannot be unsent, and this does not pretend otherwise.
 */
export const stopBroadcast = async ({ tenantId, broadcastId } = {}) => {
  await ensureBroadcastSchema();
  const cancelled = await db.query(
    `
    UPDATE whatsapp_message_queue
       SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW()
     WHERE tenant_id = $1
       AND automation_type = $2
       AND idempotency_key LIKE '%' || $3 || '%'
       AND status IN ('pending', 'scheduled')
    RETURNING id
    `,
    [tenantId, BROADCAST_AUTOMATION_TYPE, `broadcast-${broadcastId}`]
  ).catch(() => ({ rowCount: 0 }));

  const updated = await db.query(
    `
    UPDATE marketing_broadcasts
       SET status = 'stopped', stopped_at = NOW(), updated_at = NOW()
     WHERE tenant_id = $1 AND id = $2
    RETURNING *
    `,
    [tenantId, broadcastId]
  );
  return { broadcast: updated.rows[0] || null, cancelled: cancelled.rowCount || 0 };
};

export default sendBroadcast;
