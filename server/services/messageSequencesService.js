import db from "../database/db.js";
import { crmStageReference } from '../../shared/crmModel.js';
import {
  conversationCustomerPhone,
  normalizeInboxSendChannel,
  resolveInboxConversation,
  resolveInboxRecipient,
  sendInboxMedia,
  sendInboxText,
} from "./inboxOutboundService.js";

/*
 * Message sequences: "the customer asked and did not buy — nudge them later".
 *
 * A sequence is a list of steps, each "wait N minutes, then send this". A
 * conversation is enrolled either by hand from the inbox or automatically when
 * a customer writes in and the shop has a sequence set to catch that. The
 * clock starts from the customer's LAST message: while they keep talking the
 * first step keeps moving back; once a step has gone out, any reply from the
 * customer ends the sequence — a person is talking now. A purchase ends it
 * too. Nothing here ever pauses the AI or takes the conversation over.
 *
 * Sends go through inboxOutboundService, one conversation at a time, a small
 * batch per minute. That pacing is the whole point of a sequence; a burst
 * would be a broadcast, and broadcasts have their own door.
 */
/*
 * lead_stage (2026-10-20, GENI-style follow-up): a sequence tied to a CRM stage. Moving a
 * conversation into that stage enrols it; moving it out stops it. After the last step the lead is
 * moved to "if replied" or "if no reply" once a grace period passes — the same rule GENI's
 * follow-up card shows ("Moves to … if no reply in …"). A step can be written by the Claude agent
 * from the conversation itself (mode "ai") instead of a fixed text.
 */
/*
 * The customer-signal triggers (2026-10-23, the owner's four ready follow-ups): the agent hears a
 * price objection, the order steps stop half way, or a model the customer waits for comes back
 * (restockWatch). A conversation follows ONE of these at a time — the more specific signal replaces
 * the general one (SIGNAL_PRIORITY) — and while the sales agent is test-only, so are they.
 */
export const SEQUENCE_TRIGGERS = Object.freeze(["manual", "inquiry_no_purchase", "lead_stage", "price_objection", "order_incomplete", "back_in_stock"]);
const SIGNAL_PRIORITY = Object.freeze({ inquiry_no_purchase: 1, price_objection: 2, order_incomplete: 3 });
export const SEQUENCE_STAGES = Object.freeze(["new", "contacted", "interested", "negotiation", "won", "lost"]);
export const STEP_MODES = Object.freeze(["text", "ai"]);
const DEFAULT_FINALIZE_MINUTES = 24 * 60;
export const SEQUENCE_CHANNELS = Object.freeze(["whatsapp", "instagram", "facebook_messenger", "telegram"]);
const AUTOMATION_SENDER = Object.freeze({ id: null, name: "متابعة تلقائية" });
const MAX_STEPS = 8;
const MAX_MEDIA_PER_STEP = 3;
const TICK_BATCH = 15;

let schemaReadyPromise = null;
const autoSequenceCache = new Map(); // tenantId -> { at, rows }
const AUTO_CACHE_MS = 30 * 1000;

const text = (value = "") => String(value ?? "").trim();
const int = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
};
const tenant = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw Object.assign(new Error("A valid tenant id is required"), { status: 400 });
  return Math.trunc(parsed);
};
const rowId = (value, label = "id") => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw Object.assign(new Error(`A valid ${label} is required`), { status: 400 });
  return Math.trunc(parsed);
};

export const ensureMessageSequencesSchema = async () => {
  if (!schemaReadyPromise) {
    schemaReadyPromise = (async () => {
      await db.query(`
        CREATE TABLE IF NOT EXISTS message_sequences (
          id BIGSERIAL PRIMARY KEY,
          tenant_id BIGINT NOT NULL,
          name VARCHAR(120) NOT NULL,
          trigger_type VARCHAR(40) NOT NULL DEFAULT 'manual',
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          channels JSONB NOT NULL DEFAULT '["whatsapp","instagram","facebook_messenger","telegram"]'::jsonb,
          cooldown_days INTEGER NOT NULL DEFAULT 14,
          stop_on_reply BOOLEAN NOT NULL DEFAULT TRUE,
          stop_on_purchase BOOLEAN NOT NULL DEFAULT TRUE,
          steps JSONB NOT NULL DEFAULT '[]'::jsonb,
          created_by BIGINT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_message_sequences_tenant ON message_sequences (tenant_id, is_active)`);
      await db.query(`ALTER TABLE message_sequences ADD COLUMN IF NOT EXISTS trigger_stage VARCHAR(40) NOT NULL DEFAULT ''`);
      await db.query(`ALTER TABLE message_sequences ADD COLUMN IF NOT EXISTS move_to_if_replied VARCHAR(40) NOT NULL DEFAULT ''`);
      await db.query(`ALTER TABLE message_sequences ADD COLUMN IF NOT EXISTS move_to_if_no_reply VARCHAR(40) NOT NULL DEFAULT ''`);
      await db.query(`ALTER TABLE message_sequences ADD COLUMN IF NOT EXISTS finalize_after_minutes INTEGER NOT NULL DEFAULT ${DEFAULT_FINALIZE_MINUTES}`);
      await db.query(`
        CREATE TABLE IF NOT EXISTS message_sequence_enrollments (
          id BIGSERIAL PRIMARY KEY,
          tenant_id BIGINT NOT NULL,
          sequence_id BIGINT NOT NULL REFERENCES message_sequences(id) ON DELETE CASCADE,
          session_id TEXT NOT NULL,
          channel VARCHAR(40) NOT NULL DEFAULT '',
          customer_phone VARCHAR(40) NOT NULL DEFAULT '',
          status VARCHAR(20) NOT NULL DEFAULT 'active',
          current_step INTEGER NOT NULL DEFAULT 0,
          next_run_at TIMESTAMPTZ NULL,
          enrolled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          last_sent_at TIMESTAMPTZ NULL,
          finished_at TIMESTAMPTZ NULL,
          stopped_reason VARCHAR(60) NOT NULL DEFAULT '',
          source VARCHAR(20) NOT NULL DEFAULT 'auto',
          created_by BIGINT NULL,
          locked_at TIMESTAMPTZ NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          CONSTRAINT message_sequence_enrollments_status_check CHECK (status IN ('active', 'completed', 'stopped'))
        )
      `);
      await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_message_sequence_enrollments_active ON message_sequence_enrollments (tenant_id, sequence_id, session_id) WHERE status = 'active'`);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_message_sequence_enrollments_due ON message_sequence_enrollments (status, next_run_at)`);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_message_sequence_enrollments_session ON message_sequence_enrollments (tenant_id, session_id)`);
      // What started this enrolment, for the AI writer: the model that came back in stock, say.
      await db.query(`ALTER TABLE message_sequence_enrollments ADD COLUMN IF NOT EXISTS context JSONB NOT NULL DEFAULT '{}'::jsonb`);
    })().catch((error) => {
      schemaReadyPromise = null;
      throw error;
    });
  }
  await schemaReadyPromise;
};

const normalizeMedia = (value) =>
  (Array.isArray(value) ? value : [])
    .map((item) => ({
      url: text(item?.url),
      kind: item?.kind === "video" ? "video" : "image",
      mime_type: text(item?.mime_type).slice(0, 80),
      file_name: text(item?.file_name).slice(0, 200),
    }))
    // Only files the inbox itself stored: a step must never fetch a stranger's URL.
    .filter((item) => item.url.startsWith("/uploads/"))
    .slice(0, MAX_MEDIA_PER_STEP);

const normalizeSteps = (value) => {
  const steps = (Array.isArray(value) ? value : [])
    .map((step) => {
      const mode = STEP_MODES.includes(text(step?.mode)) ? text(step.mode) : "text";
      return {
        delay_minutes: Math.max(1, Math.min(60 * 24 * 30, int(step?.delay_minutes, 120))),
        mode,
        // For an "ai" step: what this nudge should do, in the owner's words. The text itself is
        // written at send time from the conversation. `body` stays as the fallback text.
        ai_instruction: mode === "ai" ? text(step?.ai_instruction).slice(0, 1000) : "",
        body: text(step?.body).slice(0, 2000),
        media: normalizeMedia(step?.media),
      };
    })
    .filter((step) => step.body || step.media.length || step.ai_instruction)
    .slice(0, MAX_STEPS);
  if (!steps.length) throw Object.assign(new Error("A sequence needs at least one step with a message"), { status: 400 });
  return steps;
};

const normalizeChannels = (value) => {
  const list = (Array.isArray(value) ? value : []).map((item) => normalizeInboxSendChannel(item)).filter((item) => SEQUENCE_CHANNELS.includes(item));
  return list.length ? [...new Set(list)] : [...SEQUENCE_CHANNELS];
};

const normalizeSequenceInput = (input = {}, { partial = false } = {}) => {
  const has = (key) => Object.prototype.hasOwnProperty.call(input, key);
  const normalized = {};
  if (!partial || has("name")) {
    normalized.name = text(input.name).slice(0, 120);
    if (!normalized.name) throw Object.assign(new Error("Sequence name is required"), { status: 400 });
  }
  if (!partial || has("trigger_type")) {
    const trigger = text(input.trigger_type || "manual");
    if (!SEQUENCE_TRIGGERS.includes(trigger)) throw Object.assign(new Error("Unknown sequence trigger"), { status: 400 });
    normalized.trigger_type = trigger;
  }
  if (!partial || has("steps")) normalized.steps = normalizeSteps(input.steps);
  if (!partial || has("channels")) normalized.channels = normalizeChannels(input.channels);
  if (has("is_active")) normalized.is_active = input.is_active !== false;
  if (has("cooldown_days")) normalized.cooldown_days = Math.max(0, Math.min(365, int(input.cooldown_days, 14)));
  if (has("stop_on_reply")) normalized.stop_on_reply = input.stop_on_reply !== false;
  if (has("stop_on_purchase")) normalized.stop_on_purchase = input.stop_on_purchase !== false;
  const stage = (key) => {
    return crmStageReference(input[key]);
  };
  if (!partial || has("trigger_stage")) normalized.trigger_stage = stage("trigger_stage");
  if (!partial || has("move_to_if_replied")) normalized.move_to_if_replied = stage("move_to_if_replied");
  if (!partial || has("move_to_if_no_reply")) normalized.move_to_if_no_reply = stage("move_to_if_no_reply");
  if (has("finalize_after_minutes")) normalized.finalize_after_minutes = Math.max(1, Math.min(60 * 24 * 30, int(input.finalize_after_minutes, DEFAULT_FINALIZE_MINUTES)));
  if (normalized.trigger_type === "lead_stage" && !normalized.trigger_stage) {
    throw Object.assign(new Error("A stage sequence needs the stage that starts it"), { status: 400 });
  }
  return normalized;
};

const validateCrmStageReferences = async (tenantId,input) => {
  const ids=[...new Set(['trigger_stage','move_to_if_replied','move_to_if_no_reply']
    .map(key=>input[key]).filter(value=>value?.startsWith('crm:')).map(value=>value.slice(4)))];
  if (!ids.length) return;
  const result=await db.query('SELECT id FROM crm_stages WHERE tenant_id=$1 AND id=ANY($2::bigint[]) AND NOT is_archived',[tenantId,ids]);
  if(result.rowCount!==ids.length)throw Object.assign(new Error('Invalid CRM stage for this tenant'),{status:400});
};

const mapSequence = (row = {}) => ({
  id: Number(row.id),
  name: text(row.name),
  trigger_type: text(row.trigger_type || "manual"),
  is_active: row.is_active !== false,
  channels: Array.isArray(row.channels) ? row.channels : [],
  cooldown_days: int(row.cooldown_days, 14),
  stop_on_reply: row.stop_on_reply !== false,
  stop_on_purchase: row.stop_on_purchase !== false,
  steps: Array.isArray(row.steps) ? row.steps : [],
  trigger_stage: text(row.trigger_stage),
  move_to_if_replied: text(row.move_to_if_replied),
  move_to_if_no_reply: text(row.move_to_if_no_reply),
  finalize_after_minutes: int(row.finalize_after_minutes, DEFAULT_FINALIZE_MINUTES),
  active_count: int(row.active_count, 0),
  completed_count: int(row.completed_count, 0),
  stopped_count: int(row.stopped_count, 0),
  created_at: row.created_at || null,
  updated_at: row.updated_at || null,
});

const SEQUENCE_SELECT = `
  SELECT s.*,
    (SELECT COUNT(*)::int FROM message_sequence_enrollments e WHERE e.sequence_id = s.id AND e.status = 'active') AS active_count,
    (SELECT COUNT(*)::int FROM message_sequence_enrollments e WHERE e.sequence_id = s.id AND e.status = 'completed') AS completed_count,
    (SELECT COUNT(*)::int FROM message_sequence_enrollments e WHERE e.sequence_id = s.id AND e.status = 'stopped') AS stopped_count
  FROM message_sequences s
`;

export const listMessageSequences = async ({ tenantId } = {}) => {
  await ensureMessageSequencesSchema();
  const result = await db.query(`${SEQUENCE_SELECT} WHERE s.tenant_id = $1 ORDER BY s.is_active DESC, s.updated_at DESC, s.id DESC`, [tenant(tenantId)]);
  return result.rows.map(mapSequence);
};

export const getMessageSequence = async ({ tenantId, id } = {}) => {
  await ensureMessageSequencesSchema();
  const result = await db.query(`${SEQUENCE_SELECT} WHERE s.tenant_id = $1 AND s.id = $2 LIMIT 1`, [tenant(tenantId), rowId(id, "sequence id")]);
  return result.rows[0] ? mapSequence(result.rows[0]) : null;
};

export const createMessageSequence = async ({ tenantId, input = {}, userId = null } = {}) => {
  await ensureMessageSequencesSchema();
  const safeTenantId = tenant(tenantId);
  const normalized = normalizeSequenceInput(input);
  await validateCrmStageReferences(safeTenantId,normalized);
  const result = await db.query(
    `
    INSERT INTO message_sequences (tenant_id, name, trigger_type, is_active, channels, cooldown_days, stop_on_reply, stop_on_purchase, steps, created_by,
                                   trigger_stage, move_to_if_replied, move_to_if_no_reply, finalize_after_minutes)
    VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9::jsonb, $10, $11, $12, $13, $14)
    RETURNING id
    `,
    [
      safeTenantId,
      normalized.name,
      normalized.trigger_type,
      normalized.is_active !== false,
      JSON.stringify(normalized.channels),
      normalized.cooldown_days ?? 14,
      normalized.stop_on_reply !== false,
      normalized.stop_on_purchase !== false,
      JSON.stringify(normalized.steps),
      userId || null,
      normalized.trigger_stage || "",
      normalized.move_to_if_replied || "",
      normalized.move_to_if_no_reply || "",
      normalized.finalize_after_minutes ?? DEFAULT_FINALIZE_MINUTES,
    ]
  );
  forgetAutoSequences(safeTenantId);
  return getMessageSequence({ tenantId: safeTenantId, id: result.rows[0].id });
};

export const updateMessageSequence = async ({ tenantId, id, input = {} } = {}) => {
  await ensureMessageSequencesSchema();
  const safeTenantId = tenant(tenantId);
  const safeId = rowId(id, "sequence id");
  const normalized = normalizeSequenceInput(input, { partial: true });
  await validateCrmStageReferences(safeTenantId,normalized);
  if (!Object.keys(normalized).length) throw Object.assign(new Error("No sequence changes were supplied"), { status: 400 });
  const fields = [];
  const values = [safeTenantId, safeId];
  for (const [key, value] of Object.entries(normalized)) {
    values.push(key === "steps" || key === "channels" ? JSON.stringify(value) : value);
    fields.push(`${key} = $${values.length}${key === "steps" || key === "channels" ? "::jsonb" : ""}`);
  }
  const result = await db.query(`UPDATE message_sequences SET ${fields.join(", ")}, updated_at = NOW() WHERE tenant_id = $1 AND id = $2 RETURNING id`, values);
  if (!result.rows.length) throw Object.assign(new Error("Sequence not found"), { status: 404 });
  forgetAutoSequences(safeTenantId);
  return getMessageSequence({ tenantId: safeTenantId, id: safeId });
};

export const deleteMessageSequence = async ({ tenantId, id } = {}) => {
  await ensureMessageSequencesSchema();
  const safeTenantId = tenant(tenantId);
  const result = await db.query(`DELETE FROM message_sequences WHERE tenant_id = $1 AND id = $2 RETURNING id`, [safeTenantId, rowId(id, "sequence id")]);
  if (!result.rows.length) throw Object.assign(new Error("Sequence not found"), { status: 404 });
  forgetAutoSequences(safeTenantId);
  return true;
};

const mapEnrollment = (row = {}) => ({
  id: Number(row.id),
  sequence_id: Number(row.sequence_id),
  sequence_name: text(row.sequence_name || ""),
  session_id: row.session_id,
  channel: row.channel || "",
  status: row.status,
  current_step: int(row.current_step, 0),
  total_steps: Array.isArray(row.steps) ? row.steps.length : int(row.total_steps, 0),
  next_run_at: row.next_run_at || null,
  enrolled_at: row.enrolled_at || null,
  last_sent_at: row.last_sent_at || null,
  finished_at: row.finished_at || null,
  stopped_reason: row.stopped_reason || "",
  source: row.source || "auto",
  trigger_stage: text(row.trigger_stage),
  move_to_if_replied: text(row.move_to_if_replied),
  move_to_if_no_reply: text(row.move_to_if_no_reply),
  // Every step has gone out; the lead moves once the grace period ends.
  awaiting_result: row.status === "active" && Array.isArray(row.steps) && int(row.current_step, 0) >= row.steps.length,
});

const ENROLLMENT_SELECT = `
  SELECT e.*, s.name AS sequence_name, s.steps, s.stop_on_reply, s.trigger_type, s.trigger_stage,
         s.move_to_if_replied, s.move_to_if_no_reply, s.finalize_after_minutes
  FROM message_sequence_enrollments e
  JOIN message_sequences s ON s.id = e.sequence_id
`;

export const listSessionEnrollments = async ({ tenantId, sessionId } = {}) => {
  await ensureMessageSequencesSchema();
  const safeSessionId = text(sessionId);
  if (!safeSessionId) return [];
  const result = await db.query(
    `${ENROLLMENT_SELECT} WHERE e.tenant_id = $1 AND e.session_id = $2 ORDER BY (e.status = 'active') DESC, e.updated_at DESC LIMIT 10`,
    [tenant(tenantId), safeSessionId]
  );
  return result.rows.map(mapEnrollment);
};

const firstStepRunAt = (sequence) => new Date(Date.now() + Math.max(1, int(sequence.steps?.[0]?.delay_minutes, 120)) * 60 * 1000);

export const enrollSessionInSequence = async ({ tenantId, sequenceId, sessionId, userId = null, source = "manual" } = {}) => {
  await ensureMessageSequencesSchema();
  const safeTenantId = tenant(tenantId);
  const sequence = await getMessageSequence({ tenantId: safeTenantId, id: sequenceId });
  if (!sequence) throw Object.assign(new Error("Sequence not found"), { status: 404 });
  if (!sequence.steps.length) throw Object.assign(new Error("This sequence has no steps"), { status: 400 });
  const conversation = await resolveInboxConversation({ tenantId: safeTenantId, conversationId: sessionId });
  if (!conversation) throw Object.assign(new Error("Conversation not found"), { status: 404 });
  const { channel, recipientId, sessionId: resolvedSessionId } = resolveInboxRecipient(conversation);
  if (!SEQUENCE_CHANNELS.includes(channel) || !recipientId) {
    throw Object.assign(new Error("This conversation cannot receive messages on its channel."), { status: 409, code: "CHANNEL_SEND_UNAVAILABLE" });
  }
  const phone = await conversationCustomerPhone({ tenantId: safeTenantId, conversation }).catch(() => "");
  // A second enrolment in the same sequence restarts it rather than running two clocks.
  await db.query(
    `UPDATE message_sequence_enrollments SET status = 'stopped', stopped_reason = 'restarted', finished_at = NOW(), updated_at = NOW()
     WHERE tenant_id = $1 AND sequence_id = $2 AND session_id = $3 AND status = 'active'`,
    [safeTenantId, sequence.id, resolvedSessionId]
  );
  const result = await db.query(
    `
    INSERT INTO message_sequence_enrollments (tenant_id, sequence_id, session_id, channel, customer_phone, status, current_step, next_run_at, source, created_by)
    VALUES ($1, $2, $3, $4, $5, 'active', 0, $6, $7, $8)
    RETURNING id
    `,
    [safeTenantId, sequence.id, resolvedSessionId, channel, phone || "", firstStepRunAt(sequence), source, userId || null]
  );
  const rows = await db.query(`${ENROLLMENT_SELECT} WHERE e.id = $1`, [result.rows[0].id]);
  return mapEnrollment(rows.rows[0]);
};

export const stopEnrollment = async ({ tenantId, id, reason = "stopped_by_staff" } = {}) => {
  await ensureMessageSequencesSchema();
  const result = await db.query(
    `UPDATE message_sequence_enrollments SET status = 'stopped', stopped_reason = $3, finished_at = NOW(), updated_at = NOW()
     WHERE tenant_id = $1 AND id = $2 AND status = 'active' RETURNING id`,
    [tenant(tenantId), rowId(id, "enrollment id"), text(reason).slice(0, 60) || "stopped_by_staff"]
  );
  if (!result.rows.length) throw Object.assign(new Error("Active enrollment not found"), { status: 404 });
  const rows = await db.query(`${ENROLLMENT_SELECT} WHERE e.id = $1`, [result.rows[0].id]);
  return mapEnrollment(rows.rows[0]);
};

const autoSequencesFor = async (tenantId, triggerType = "inquiry_no_purchase") => {
  const key = `${tenantId}:${triggerType}`;
  const cached = autoSequenceCache.get(key);
  if (cached && Date.now() - cached.at < AUTO_CACHE_MS) return cached.rows;
  const result = await db.query(
    `SELECT * FROM message_sequences WHERE tenant_id = $1 AND is_active = TRUE AND trigger_type = $2`,
    [tenantId, triggerType]
  );
  const rows = result.rows.map(mapSequence).filter((sequence) => sequence.steps.length);
  autoSequenceCache.set(key, { at: Date.now(), rows });
  return rows;
};

/** Every cached trigger list of a tenant, after a sequence is created, edited or deleted. */
const forgetAutoSequences = (tenantId) => {
  for (const key of autoSequenceCache.keys()) {
    if (key === tenantId || String(key).startsWith(`${tenantId}:`)) autoSequenceCache.delete(key);
  }
};

/*
 * Who an AUTOMATIC follow-up may reach. While the sales agent is test-only (AI_SALES_AGENT_SCOPE,
 * default "test"), so are these: only the owner's test numbers (ai_channels.ai_test_contacts).
 * A sequence staff start by hand on a conversation is their decision and is not gated.
 */
export const followUpAudienceAllows = async ({ sessionId = "", phone = "", loadTestContacts = null } = {}) => {
  if (text(process.env.AI_SALES_AGENT_SCOPE).toLowerCase() === "all") return true;
  const { isAiTestContact, parseAiTestContacts } = await import("../utils/aiAutoReplyGate.js");
  const raw = loadTestContacts
    ? await loadTestContacts()
    : await import("./settingsService.js").then((settings) => settings.getSetting("ai_channels.ai_test_contacts", ""));
  const contacts = parseAiTestContacts(raw || "");
  const fromSession = /^whatsapp:/i.test(text(sessionId)) ? text(sessionId).slice("whatsapp:".length) : "";
  return [phone, fromSession].some((value) => text(value) && isAiTestContact(contacts, value));
};

/*
 * Quiet hours: an automatic message never lands at night in Cairo. A step that falls due outside
 * 10:00–22:00 waits for the next 10:00 (plus a few minutes' spread, so a night's backlog does not go
 * out as one burst). Returns null when now is fine.
 */
export const SEND_WINDOW = Object.freeze({ startMinute: 10 * 60, endMinute: 22 * 60 });
export const nextSendWindowStart = (now = new Date(), { spreadMinutes = 0 } = {}) => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Cairo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(now)
      .map((part) => [part.type, part.value])
  );
  const minute = Number(parts.hour) * 60 + Number(parts.minute);
  if (minute >= SEND_WINDOW.startMinute && minute < SEND_WINDOW.endMinute) return null;
  const wait = minute < SEND_WINDOW.startMinute ? SEND_WINDOW.startMinute - minute : 24 * 60 - minute + SEND_WINDOW.startMinute;
  return new Date(now.getTime() + (wait + Math.max(0, spreadMinutes)) * 60 * 1000);
};

/** Enrols a conversation in each sequence that matches its channel, honouring the cooldown. */
const enrollAutomatically = async ({ tenantId, sessionId, channel = "", sequences = [], context = {} }) => {
  const normalizedChannel = normalizeInboxSendChannel(channel);
  const matching = sequences.filter((sequence) => !normalizedChannel || sequence.channels.includes(normalizedChannel));
  if (!matching.length) return 0;
  const conversation = await resolveInboxConversation({ tenantId, conversationId: sessionId }).catch(() => null);
  if (!conversation) return 0;
  const { channel: resolvedChannel, recipientId, sessionId: resolvedSessionId } = resolveInboxRecipient(conversation);
  if (!SEQUENCE_CHANNELS.includes(resolvedChannel) || !recipientId) return 0;
  const phone = await conversationCustomerPhone({ tenantId, conversation }).catch(() => "");
  if (!(await followUpAudienceAllows({ sessionId: resolvedSessionId, phone }).catch(() => false))) return 0;
  let enrolled = 0;
  for (const sequence of matching) {
    if (!sequence.channels.includes(resolvedChannel)) continue;
    // One customer-signal follow-up at a time: a more specific one already running wins, and this
    // one replaces any less specific one («غالي» after a plain inquiry, an unfinished order after both).
    const priority = SIGNAL_PRIORITY[sequence.trigger_type];
    if (priority) {
      const running = await db.query(
        `SELECT s.trigger_type FROM message_sequence_enrollments e JOIN message_sequences s ON s.id = e.sequence_id
         WHERE e.tenant_id = $1 AND e.session_id = $2 AND e.status = 'active' AND s.trigger_type = ANY($3::text[])`,
        [tenantId, resolvedSessionId, Object.keys(SIGNAL_PRIORITY)]
      );
      if (running.rows.some((row) => SIGNAL_PRIORITY[row.trigger_type] >= priority)) continue;
      const weaker = Object.keys(SIGNAL_PRIORITY).filter((trigger) => SIGNAL_PRIORITY[trigger] < priority);
      await db.query(
        `UPDATE message_sequence_enrollments e
            SET status = 'stopped', stopped_reason = $4, finished_at = NOW(), locked_at = NULL, updated_at = NOW()
           FROM message_sequences s
          WHERE s.id = e.sequence_id AND e.tenant_id = $1 AND e.session_id = $2 AND e.status = 'active' AND s.trigger_type = ANY($3::text[])`,
        [tenantId, resolvedSessionId, weaker, `replaced_by_${sequence.trigger_type}`.slice(0, 60)]
      );
    }
    const recent = await db.query(
      `SELECT 1 FROM message_sequence_enrollments
       WHERE tenant_id = $1 AND sequence_id = $2 AND session_id = $3
         AND (status = 'active' OR enrolled_at > NOW() - ($4::int * INTERVAL '1 day'))
       LIMIT 1`,
      [tenantId, sequence.id, resolvedSessionId, Math.max(0, sequence.cooldown_days)]
    );
    if (recent.rows.length) continue;
    const inserted = await db.query(
      `
      INSERT INTO message_sequence_enrollments (tenant_id, sequence_id, session_id, channel, customer_phone, status, current_step, next_run_at, source, context)
      VALUES ($1, $2, $3, $4, $5, 'active', 0, $6, 'auto', $7::jsonb)
      ON CONFLICT DO NOTHING
      RETURNING id
      `,
      [tenantId, sequence.id, resolvedSessionId, resolvedChannel, phone || "", firstStepRunAt(sequence), JSON.stringify(context && typeof context === "object" ? context : {})]
    );
    enrolled += inserted.rows.length;
  }
  return enrolled;
};

/*
 * Moves a conversation's CRM stage, the same columns the inbox's own stage picker writes, and lets
 * the new stage start its own sequence — so one stage's "no reply" can hand over to the next.
 */
export const setConversationLeadStage = async ({ tenantId, sessionId, stage } = {}) => {
  let safeStage;
  try {safeStage=crmStageReference(stage);} catch {return false;}
  if(!safeStage)return false;
  if(safeStage.startsWith('crm:')){
    const current=(await db.query('SELECT id,version FROM ai_lead_opportunities WHERE tenant_id=$1 AND conversation_id=$2 AND channel_conversation_id IS NOT NULL LIMIT 1',[tenantId,text(sessionId)])).rows[0];
    if(!current)return false;
    const {updateCrm}=await import('./crmService.js');
    try {await updateCrm({tenantId,userId:0,isAdmin:true,hiddenKeys:{},source:'sequence'},current.id,{version:current.version,stage_id:safeStage.slice(4)});}
    catch(error){if(error.status===409)return false;throw error;}
    await onLeadStageChanged({tenantId,sessionId,stage:safeStage});
    return true;
  }
  const conversationId = text(sessionId);
  const rawId = conversationId.includes(":") ? conversationId.split(":").slice(1).join(":") : conversationId;
  const lookupIds = [...new Set([conversationId, rawId].filter(Boolean))];
  const result = await db.query(
    `UPDATE ai_channel_conversations c
        SET lead_status = $3,
            metadata = COALESCE(c.metadata, '{}'::jsonb) || jsonb_build_object('lead_status', $3::text, 'source', 'message_sequence'),
            updated_at = CURRENT_TIMESTAMP
      WHERE c.id = (
        SELECT id FROM ai_channel_conversations
         WHERE tenant_id = $1
           AND (external_conversation_id = ANY($2::text[]) OR CONCAT(channel, ':', external_conversation_id) = ANY($2::text[]))
         ORDER BY updated_at DESC
         LIMIT 1
      )
      RETURNING c.id`,
    [tenantId, lookupIds, safeStage]
  ).catch((error) => {
    console.warn("[message-sequence:stage-move-failed]", { session_id: conversationId, stage: safeStage, message: error?.message });
    return { rows: [] };
  });
  if (!result.rows.length) return false;
  await onLeadStageChanged({ tenantId, sessionId: conversationId, stage: safeStage }).catch((error) =>
    console.warn("[message-sequence:stage-chain-failed]", { session_id: conversationId, message: error?.message })
  );
  return true;
};

/*
 * Called when a conversation's CRM stage changes (inbox stage picker, labels, or a sequence's own
 * result). Stage sequences of OTHER stages stop — the lead left them — and this stage's start.
 */
export const onLeadStageChanged = async ({ tenantId, sessionId, stage = "", channel = "" } = {}) => {
  const safeTenantId = Number(tenantId);
  const safeSessionId = text(sessionId);
  let safeStage;
  try {safeStage=crmStageReference(stage);} catch {return 0;}
  if (!safeTenantId || !safeSessionId || !safeStage) return 0;
  await ensureMessageSequencesSchema();
  const rawId = safeSessionId.includes(":") ? safeSessionId.split(":").slice(1).join(":") : safeSessionId;
  const actual=(await db.query(`SELECT o.stage_id,s.legacy_key FROM ai_lead_opportunities o JOIN crm_stages s
    ON s.tenant_id=o.tenant_id AND s.id=o.stage_id WHERE o.tenant_id=$1 AND o.conversation_id=$2 LIMIT 1`,[safeTenantId,safeSessionId])).rows[0];
  const matching=actual?[`crm:${actual.stage_id}`,actual.legacy_key].filter(Boolean):[safeStage];
  if(!matching.includes(safeStage))return 0;
  await db.query(
    `UPDATE message_sequence_enrollments e
        SET status = 'stopped', stopped_reason = 'stage_changed', finished_at = NOW(), locked_at = NULL, updated_at = NOW()
       FROM message_sequences s
      WHERE s.id = e.sequence_id AND e.tenant_id = $1 AND e.status = 'active'
        AND s.trigger_type = 'lead_stage' AND NOT(s.trigger_stage=ANY($3::text[]))
        AND e.session_id=ANY($2::text[])`,
    [safeTenantId, [...new Set([safeSessionId,rawId])], matching]
  );
  const sequences = (await autoSequencesFor(safeTenantId, "lead_stage")).filter((sequence) => matching.includes(sequence.trigger_stage));
  if (!sequences.length) return 0;
  return enrollAutomatically({ tenantId: safeTenantId, sessionId: safeSessionId, channel, sequences });
};

/*
 * A customer signal the AI heard (price_objection, order_incomplete) or the stock worker saw
 * (back_in_stock): enrols the conversation in that trigger's sequences. Fire-and-forget for the
 * callers — a follow-up that cannot start must never break a reply.
 */
export const onCustomerSignal = async ({ tenantId, sessionId, channel = "", signal = "", context = {} } = {}) => {
  const safeTenantId = Number(tenantId);
  const safeSessionId = text(sessionId);
  if (!safeTenantId || !safeSessionId || !SEQUENCE_TRIGGERS.includes(signal) || ["manual", "lead_stage", "inquiry_no_purchase"].includes(signal)) return 0;
  await ensureMessageSequencesSchema();
  const sequences = await autoSequencesFor(safeTenantId, signal);
  if (!sequences.length) return 0;
  return enrollAutomatically({ tenantId: safeTenantId, sessionId: safeSessionId, channel, sequences, context });
};

/*
 * The inbound tap. Called for every customer message that reaches the live
 * inbox (see utils/socket.js); it must be cheap on the common path, which is
 * "no sequences at all" — one cached lookup and out.
 */
export const onInboundCustomerMessage = async ({ tenantId, sessionId, channel = "" } = {}) => {
  const safeTenantId = Number(tenantId);
  const safeSessionId = text(sessionId);
  if (!safeTenantId || !safeSessionId) return;
  await ensureMessageSequencesSchema();

  const active = await db.query(
    `${ENROLLMENT_SELECT} WHERE e.tenant_id = $1 AND e.session_id = $2 AND e.status = 'active'`,
    [safeTenantId, safeSessionId]
  );
  for (const row of active.rows) {
    const steps = Array.isArray(row.steps) ? row.steps : [];
    if (int(row.current_step, 0) > 0 || row.trigger_type==='lead_stage') {
      if (row.stop_on_reply === false) continue;
      const stopped = await db.query(
        `UPDATE message_sequence_enrollments SET status = 'stopped', stopped_reason = 'customer_replied', finished_at = NOW(), updated_at = NOW() WHERE id = $1 AND status = 'active' RETURNING id`,
        [row.id]
      );
      // The follow-up worked: the lead goes to the sequence's "if replied" stage.
      if (stopped.rows.length && text(row.move_to_if_replied)) {
        await setConversationLeadStage({ tenantId: safeTenantId, sessionId: row.session_id, stage: row.move_to_if_replied });
      }
    } else {
      // Still waiting for the first step: the customer is still talking, so the clock restarts.
      const delay = Math.max(1, int(steps[0]?.delay_minutes, 120));
      await db.query(`UPDATE message_sequence_enrollments SET next_run_at = NOW() + ($2::int * INTERVAL '1 minute'), updated_at = NOW() WHERE id = $1`, [row.id, delay]);
    }
  }

  const candidates = await autoSequencesFor(safeTenantId);
  if (!candidates.length) return;
  await enrollAutomatically({ tenantId: safeTenantId, sessionId: safeSessionId, channel, sequences: candidates });
};

const purchasedSince = async ({ tenantId, phone, since, sessionId = "" }) => {
  // An order written from this very chat counts even with no phone on the thread (Messenger,
  // Instagram): orders.ai_agent_conversation_id is the inbox session it came from.
  if (text(sessionId)) {
    const fromChat = await db.query(
      `SELECT 1 FROM orders WHERE tenant_id = $1 AND created_at >= $2 AND ai_agent_conversation_id = $3 LIMIT 1`,
      [tenantId, since, text(sessionId)]
    ).catch(() => ({ rows: [] }));
    if (fromChat.rows.length) return true;
  }
  const digits = text(phone).replace(/\D/g, "");
  if (digits.length < 9) return false;
  const result = await db.query(
    `
    SELECT 1
    FROM orders o
    JOIN customers c ON c.id = o.customer_id
    WHERE o.tenant_id = $1
      AND o.created_at >= $2
      AND RIGHT(regexp_replace(COALESCE(c.phone, ''), '\\D', '', 'g'), 9) = RIGHT($3, 9)
    LIMIT 1
    `,
    [tenantId, since, digits]
  ).catch(() => ({ rows: [] }));
  return result.rows.length > 0;
};

const customerRepliedSince = async ({ tenantId, sessionId, since }) => {
  if (!since) return false;
  const result = await db.query(
    `SELECT 1 FROM ai_support_messages WHERE tenant_id = $1 AND session_id = $2 AND sender_type = 'customer' AND created_at > $3 LIMIT 1`,
    [tenantId, sessionId, since]
  ).catch(() => ({ rows: [] }));
  return result.rows.length > 0;
};

const finish = (id, status, reason = "") =>
  db.query(
    `UPDATE message_sequence_enrollments SET status = $2, stopped_reason = $3, finished_at = NOW(), locked_at = NULL, updated_at = NOW() WHERE id = $1 AND status = 'active' RETURNING id`,
    [id, status, reason]
  );

const processEnrollment = async (row) => {
  const tenantId = Number(row.tenant_id);
  const steps = Array.isArray(row.steps) ? row.steps : [];
  const stepIndex = int(row.current_step, 0);
  const step = steps[stepIndex];

  if (row.is_active === false) {
    // Paused by the owner: wait, do not forget.
    await db.query(`UPDATE message_sequence_enrollments SET next_run_at = NOW() + INTERVAL '1 hour', locked_at = NULL, updated_at = NOW() WHERE id = $1`, [row.id]);
    return "paused";
  }
  const hasStageResult = Boolean(text(row.move_to_if_replied) || text(row.move_to_if_no_reply));
  const conversation = await resolveInboxConversation({ tenantId, conversationId: row.session_id }).catch(() => null);
  if (!conversation) {
    await finish(row.id, "stopped", "conversation_missing");
    return "conversation_missing";
  }
  if (text(conversation.session_status).toLowerCase() === "closed") {
    await finish(row.id, "stopped", "conversation_closed");
    return "conversation_closed";
  }
  if (step && row.stop_on_reply !== false && (stepIndex > 0 || row.trigger_type==='lead_stage') && (await customerRepliedSince({ tenantId, sessionId: row.session_id, since: row.last_sent_at||row.enrolled_at }))) {
    const finished = await finish(row.id, "stopped", "customer_replied");
    if (text(row.move_to_if_replied) && finished.rowCount) await setConversationLeadStage({ tenantId, sessionId: row.session_id, stage: row.move_to_if_replied });
    return "customer_replied";
  }
  if (row.stop_on_purchase !== false) {
    const phone = row.customer_phone || (await conversationCustomerPhone({ tenantId, conversation }).catch(() => ""));
    if (await purchasedSince({ tenantId, phone, since: row.enrolled_at, sessionId: row.session_id })) {
      await finish(row.id, "stopped", "customer_purchased");
      return "customer_purchased";
    }
  }
  if (!step) {
    // Check closure and purchase before applying a delayed stage outcome too.
    if (hasStageResult) {
      const replied = await customerRepliedSince({ tenantId, sessionId: row.session_id, since: row.last_sent_at });
      const nextStage = text(replied ? row.move_to_if_replied : row.move_to_if_no_reply);
      const finished = await finish(row.id, "completed", replied ? "customer_replied" : "no_reply");
      if (nextStage && finished.rowCount) await setConversationLeadStage({ tenantId, sessionId: row.session_id, stage: nextStage });
      return replied ? "completed_replied" : "completed_no_reply";
    }
    await finish(row.id, "completed", "");
    return "completed";
  }
  // An automatic follow-up re-checks its audience at send time too: a number taken off the test
  // list stops getting them, even mid-sequence.
  if (row.source !== "manual" && !(await followUpAudienceAllows({ sessionId: row.session_id, phone: row.customer_phone }).catch(() => false))) {
    await finish(row.id, "stopped", "audience_test_only");
    return "audience_test_only";
  }
  const sendAt = nextSendWindowStart(new Date(), { spreadMinutes: Number(row.id) % 20 });
  if (sendAt) {
    await db.query(`UPDATE message_sequence_enrollments SET next_run_at = $2, locked_at = NULL, updated_at = NOW() WHERE id = $1`, [row.id, sendAt]);
    return "quiet_hours";
  }

  // An "ai" step is written now, from this conversation; its fixed text is only the fallback.
  let messageText = text(step.body);
  if (step.mode === "ai" && text(step.ai_instruction)) {
    const written = await import("./aiClaudeSalesAgentService.js")
      .then((agent) => agent.writeFollowUpMessage({
        tenantId,
        sessionId: row.session_id,
        channel: row.channel,
        customerName: text(conversation.customer_name || conversation.customer_profile?.name),
        instruction: step.ai_instruction,
        stepNumber: stepIndex + 1,
        totalSteps: steps.length,
        context: row.context && typeof row.context === "object" ? row.context : {},
      }))
      .catch((error) => {
        console.warn("[message-sequence:ai-step-failed]", { enrollment_id: row.id, step: stepIndex, message: error?.message });
        return "";
      });
    messageText = text(written) || messageText;
    if (!messageText && !(Array.isArray(step.media) && step.media.length)) {
      await finish(row.id, "stopped", "ai_unavailable");
      return "ai_unavailable";
    }
  }

  let delivered = false;
  // A CRM transition may have cancelled this enrollment while AI text was being
  // generated. Re-read immediately before delivery; cancellation never starts a replacement.
  const live = await db.query('SELECT status FROM message_sequence_enrollments WHERE id=$1 AND tenant_id=$2',[row.id,tenantId]);
  if (live.rows[0]?.status !== 'active') return 'cancelled_before_delivery';
  try {
    if (messageText) {
      const result = await sendInboxText({
        tenantId,
        conversationId: row.session_id,
        messageText,
        staff: AUTOMATION_SENDER,
        clientRequestId: `sequence:${row.id}:${stepIndex}:text`,
        source: "message_sequence",
        preserveSessionState: true,
      });
      delivered = result.sent;
      if (!result.sent) {
        await finish(row.id, "stopped", "delivery_failed");
        return "delivery_failed";
      }
    }
    for (const [mediaIndex, media] of (Array.isArray(step.media) ? step.media : []).entries()) {
      const result = await sendInboxMedia({
        tenantId,
        conversationId: row.session_id,
        relativeUrl: media.url,
        kind: media.kind,
        mimeType: media.mime_type,
        fileName: media.file_name,
        staff: AUTOMATION_SENDER,
        clientRequestId: `sequence:${row.id}:${stepIndex}:media:${mediaIndex}`,
        source: "message_sequence",
        preserveSessionState: true,
      });
      delivered = delivered || result.sent;
    }
  } catch (error) {
    const code = text(error?.code);
    const reason = code === "CHANNEL_SEND_UNAVAILABLE" || code === "RECIPIENT_MISSING" ? "unreachable" : error?.status === 409 ? "conversation_closed" : "send_error";
    console.warn("[message-sequence:send-failed]", { enrollment_id: row.id, step: stepIndex, code, message: error?.message || String(error) });
    await finish(row.id, "stopped", reason);
    return reason;
  }
  if (!delivered) {
    await finish(row.id, "stopped", "delivery_failed");
    return "delivery_failed";
  }

  const nextIndex = stepIndex + 1;
  const nextStep = steps[nextIndex];
  if (!nextStep && hasStageResult) {
    // Wait the grace period, then move the lead on whether they answered (the !step branch above).
    await db.query(
      `UPDATE message_sequence_enrollments
       SET current_step = $2, last_sent_at = NOW(), next_run_at = NOW() + ($3::int * INTERVAL '1 minute'), locked_at = NULL, updated_at = NOW()
       WHERE id = $1`,
      [row.id, nextIndex, Math.max(1, int(row.finalize_after_minutes, DEFAULT_FINALIZE_MINUTES))]
    );
    return "sent";
  }
  if (!nextStep) {
    await db.query(
      `UPDATE message_sequence_enrollments SET current_step = $2, last_sent_at = NOW(), status = 'completed', finished_at = NOW(), next_run_at = NULL, locked_at = NULL, updated_at = NOW() WHERE id = $1`,
      [row.id, nextIndex]
    );
    return "completed";
  }
  await db.query(
    `UPDATE message_sequence_enrollments
     SET current_step = $2, last_sent_at = NOW(), next_run_at = NOW() + ($3::int * INTERVAL '1 minute'), locked_at = NULL, updated_at = NOW()
     WHERE id = $1`,
    [row.id, nextIndex, Math.max(1, int(nextStep.delay_minutes, 120))]
  );
  return "sent";
};

export const runMessageSequencesTick = async () => {
  await ensureMessageSequencesSchema();
  const claimed = await db.query(
    `
    UPDATE message_sequence_enrollments e
    SET locked_at = NOW(), updated_at = NOW()
    WHERE e.id IN (
      SELECT id FROM message_sequence_enrollments
      WHERE status = 'active'
        AND next_run_at IS NOT NULL
        AND next_run_at <= NOW()
        AND (locked_at IS NULL OR locked_at < NOW() - INTERVAL '10 minutes')
      ORDER BY next_run_at ASC
      LIMIT $1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING e.id
    `,
    [TICK_BATCH]
  );
  if (!claimed.rows.length) return { claimed: 0, outcomes: {} };
  const ids = claimed.rows.map((row) => Number(row.id));
  const rows = await db.query(
    `SELECT e.*, s.steps, s.is_active, s.trigger_type, s.trigger_stage, s.stop_on_reply, s.stop_on_purchase, s.move_to_if_replied, s.move_to_if_no_reply, s.finalize_after_minutes FROM message_sequence_enrollments e JOIN message_sequences s ON s.id = e.sequence_id WHERE e.id = ANY($1::bigint[])`,
    [ids]
  );
  const outcomes = {};
  for (const row of rows.rows) {
    try {
      const outcome = await processEnrollment(row);
      outcomes[outcome] = (outcomes[outcome] || 0) + 1;
    } catch (error) {
      console.error("[message-sequence:tick-failed]", { enrollment_id: row.id, message: error?.message || String(error) });
      await db.query(`UPDATE message_sequence_enrollments SET locked_at = NULL, next_run_at = NOW() + INTERVAL '15 minutes', updated_at = NOW() WHERE id = $1`, [row.id]).catch(() => {});
      outcomes.error = (outcomes.error || 0) + 1;
    }
  }
  return { claimed: ids.length, outcomes };
};

/*
 * The owner's four ready follow-ups (2026-10-23), GENI-style: each step is written by the sales agent
 * from the conversation and the customer's memory; the fixed text is only the fallback. Installed
 * once from the sequences screen and edited there like any other sequence. Rules every step keeps:
 * no invented discount, price or stock claim, one short message, no pressure, never a repeat.
 */
const STEP_RULES = "رسالة واحدة قصيرة (سطرين بالكتير) بالعامية المصرية ومن غير ضغط. متخترعش خصم ولا سعر ولا تقول إن مقاس متاح أو محجوز إلا لو مكتوب قدامك. متكررش كلام متابعة قبلها.";
export const FOLLOW_UP_PRESETS = Object.freeze([
  {
    key: "inquiry_no_purchase",
    name: "سأل ومشتراش",
    trigger_type: "inquiry_no_purchase",
    cooldown_days: 14,
    steps: [
      {
        delay_minutes: 120,
        mode: "ai",
        ai_instruction: `العميل سأل عن منتج ووقف الكلام. فكّره بالموديل اللي كان بيسأل عليه (واللون والمقاس لو اتقالوا أو موجودين في customer_memory) واسأله سؤال واحد سهل يرجّعه للكلام، زي لو حابب صور تانية أو يعرف المقاسات. ${STEP_RULES}`,
        body: "لسه حابب حضرتك الموديل اللي سألت عليه؟ لو محتاج صور تانية أو تعرف المقاسات المتاحة أنا موجود 😊",
      },
      {
        delay_minutes: 24 * 60,
        mode: "ai",
        ai_instruction: `متابعة تانية بعد يوم. قدّم قيمة حقيقية مش سؤال مكرر: ميزة في الموديل اللي سأل عليه (الخامة، الراحة، الاستبدال، الدفع عند الاستلام لو مكتوب في company_info)، أو اقترح عليه حاجة قريبة تناسب اللي في customer_memory. ${STEP_RULES}`,
        body: "على فكرة يا فندم، عندنا استبدال لو المقاس مجاش مظبوط، فتقدر تطلب وانت مطمّن. تحب أساعدك تختار؟",
      },
      {
        delay_minutes: 3 * 24 * 60,
        mode: "ai",
        ai_instruction: `آخر متابعة. اختم بلطف واحترام: قوله إنك موجود في أي وقت يحتاج حاجة، ومتسألش سؤال ومتعرضش منتجات. ${STEP_RULES}`,
        body: "مش هطوّل على حضرتك 🙏 لو احتجت أي حاجة في أي وقت ابعتلي هنا وأنا تحت أمرك.",
      },
    ],
  },
  {
    key: "price_objection",
    name: "اعتراض على السعر",
    trigger_type: "price_objection",
    cooldown_days: 7,
    steps: [
      {
        delay_minutes: 60,
        mode: "ai",
        ai_instruction: `العميل قال إن السعر غالي عليه. متنزلش السعر ومتخترعش خصم. ساعده يلاقي اللي يناسب ميزانيته: وضّح بإيجاز الفرق بين الدرجات (مصري / مستورد فيتنامي / ميرور) أو اعرض إنك تبعتله بديل أوفر في نفس الستايل، واسأله هو حابب أنهي. ${STEP_RULES}`,
        body: "فاهم حضرتك تمامًا 👌 عندنا نفس الستايل في درجات أوفر، تحب أبعتلك اختيارات في حدود ميزانيتك؟",
      },
      {
        delay_minutes: 24 * 60,
        mode: "ai",
        ai_instruction: `متابعة تانية بعد اعتراض السعر. فكّره بقيمة الشراء من غير ما تتكلم في تخفيض: الاستبدال، المعاينة، الدفع عند الاستلام — بس اللي مكتوب في company_info. ${STEP_RULES}`,
        body: "وبالمناسبة يا فندم، تقدر تعاين الأوردر وتدفع عند الاستلام، ولو المقاس مجاش مظبوط بنبدّله. لو حابب نكمّل أنا موجود.",
      },
    ],
  },
  {
    key: "order_incomplete",
    name: "أوردر مكملش",
    trigger_type: "order_incomplete",
    cooldown_days: 3,
    steps: [
      {
        delay_minutes: 30,
        mode: "ai",
        ai_instruction: `العميل كان بيعمل أوردر (اختار لون أو مقاس) ووقف قبل ما يكمّل. فكّره بلطف بالموديل واللون والمقاس اللي اختارهم من المحادثة، واسأله لو محتاج مساعدة يكمّل أو عنده أي سؤال. ${STEP_RULES}`,
        body: "حضرتك كنت قربت تخلّص الأوردر 😊 محتاج مساعدة نكمّله سوا؟",
      },
      {
        delay_minutes: 24 * 60,
        mode: "ai",
        ai_instruction: `آخر تذكير بالأوردر اللي مكملش. جملة لطيفة إن الأوردر مستنيه لو لسه حابب، وإنك موجود لأي سؤال. ${STEP_RULES}`,
        body: "الأوردر بتاعك لسه مستني حضرتك لو حابب تكمّله. أنا موجود لأي سؤال 🙏",
      },
    ],
  },
  {
    key: "back_in_stock",
    name: "الموديل نزل تاني",
    trigger_type: "back_in_stock",
    cooldown_days: 0,
    stop_on_reply: true,
    steps: [
      {
        delay_minutes: 1,
        mode: "ai",
        ai_instruction: `العميل كان طالب نبلّغه لما موديل ينزل، والموديل ده رجع متاح دلوقتي (التفاصيل في follow_up_context: الموديل، المقاس، اللون). بلّغه بالخبر بفرحة خفيفة واسأله لو يحب نجهّزهوله. ${STEP_RULES}`,
        body: "خبر حلو يا فندم 🎉 الموديل اللي حضرتك سألت عليه رجع متاح دلوقتي. تحب نجهّزهولك؟",
      },
    ],
  },
]);

// Adds every preset the tenant does not have yet (matched by trigger), active; returns what it added.
export const installFollowUpPresets = async ({ tenantId, userId = null } = {}) => {
  await ensureMessageSequencesSchema();
  const safeTenantId = tenant(tenantId);
  const existing = await db.query(`SELECT trigger_type FROM message_sequences WHERE tenant_id = $1`, [safeTenantId]);
  const have = new Set(existing.rows.map((row) => text(row.trigger_type)));
  const added = [];
  for (const preset of FOLLOW_UP_PRESETS) {
    if (have.has(preset.trigger_type)) continue;
    const input = { ...preset, is_active: true };
    delete input.key;
    added.push(await createMessageSequence({ tenantId: safeTenantId, input, userId }));
  }
  forgetAutoSequences(safeTenantId);
  return added;
};

export const __testing = { normalizeSequenceInput, normalizeSteps, mapEnrollment };
