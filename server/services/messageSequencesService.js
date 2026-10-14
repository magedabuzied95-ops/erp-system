import db from "../database/db.js";
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
export const SEQUENCE_TRIGGERS = Object.freeze(["manual", "inquiry_no_purchase"]);
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
    .map((step) => ({
      delay_minutes: Math.max(1, Math.min(60 * 24 * 30, int(step?.delay_minutes, 120))),
      body: text(step?.body).slice(0, 2000),
      media: normalizeMedia(step?.media),
    }))
    .filter((step) => step.body || step.media.length)
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
  return normalized;
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
  const result = await db.query(
    `
    INSERT INTO message_sequences (tenant_id, name, trigger_type, is_active, channels, cooldown_days, stop_on_reply, stop_on_purchase, steps, created_by)
    VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9::jsonb, $10)
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
    ]
  );
  autoSequenceCache.delete(safeTenantId);
  return getMessageSequence({ tenantId: safeTenantId, id: result.rows[0].id });
};

export const updateMessageSequence = async ({ tenantId, id, input = {} } = {}) => {
  await ensureMessageSequencesSchema();
  const safeTenantId = tenant(tenantId);
  const safeId = rowId(id, "sequence id");
  const normalized = normalizeSequenceInput(input, { partial: true });
  if (!Object.keys(normalized).length) throw Object.assign(new Error("No sequence changes were supplied"), { status: 400 });
  const fields = [];
  const values = [safeTenantId, safeId];
  for (const [key, value] of Object.entries(normalized)) {
    values.push(key === "steps" || key === "channels" ? JSON.stringify(value) : value);
    fields.push(`${key} = $${values.length}${key === "steps" || key === "channels" ? "::jsonb" : ""}`);
  }
  const result = await db.query(`UPDATE message_sequences SET ${fields.join(", ")}, updated_at = NOW() WHERE tenant_id = $1 AND id = $2 RETURNING id`, values);
  if (!result.rows.length) throw Object.assign(new Error("Sequence not found"), { status: 404 });
  autoSequenceCache.delete(safeTenantId);
  return getMessageSequence({ tenantId: safeTenantId, id: safeId });
};

export const deleteMessageSequence = async ({ tenantId, id } = {}) => {
  await ensureMessageSequencesSchema();
  const safeTenantId = tenant(tenantId);
  const result = await db.query(`DELETE FROM message_sequences WHERE tenant_id = $1 AND id = $2 RETURNING id`, [safeTenantId, rowId(id, "sequence id")]);
  if (!result.rows.length) throw Object.assign(new Error("Sequence not found"), { status: 404 });
  autoSequenceCache.delete(safeTenantId);
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
});

const ENROLLMENT_SELECT = `
  SELECT e.*, s.name AS sequence_name, s.steps
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

const autoSequencesFor = async (tenantId) => {
  const cached = autoSequenceCache.get(tenantId);
  if (cached && Date.now() - cached.at < AUTO_CACHE_MS) return cached.rows;
  const result = await db.query(
    `SELECT * FROM message_sequences WHERE tenant_id = $1 AND is_active = TRUE AND trigger_type = 'inquiry_no_purchase'`,
    [tenantId]
  );
  const rows = result.rows.map(mapSequence).filter((sequence) => sequence.steps.length);
  autoSequenceCache.set(tenantId, { at: Date.now(), rows });
  return rows;
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
    if (int(row.current_step, 0) > 0) {
      if (row.stop_on_reply === false) continue;
      await db.query(
        `UPDATE message_sequence_enrollments SET status = 'stopped', stopped_reason = 'customer_replied', finished_at = NOW(), updated_at = NOW() WHERE id = $1 AND status = 'active'`,
        [row.id]
      );
    } else {
      // Still waiting for the first step: the customer is still talking, so the clock restarts.
      const delay = Math.max(1, int(steps[0]?.delay_minutes, 120));
      await db.query(`UPDATE message_sequence_enrollments SET next_run_at = NOW() + ($2::int * INTERVAL '1 minute'), updated_at = NOW() WHERE id = $1`, [row.id, delay]);
    }
  }

  const candidates = await autoSequencesFor(safeTenantId);
  if (!candidates.length) return;
  const normalizedChannel = normalizeInboxSendChannel(channel);
  const matching = candidates.filter((sequence) => !normalizedChannel || sequence.channels.includes(normalizedChannel));
  if (!matching.length) return;

  const conversation = await resolveInboxConversation({ tenantId: safeTenantId, conversationId: safeSessionId }).catch(() => null);
  if (!conversation) return;
  const { channel: resolvedChannel, recipientId, sessionId: resolvedSessionId } = resolveInboxRecipient(conversation);
  if (!SEQUENCE_CHANNELS.includes(resolvedChannel) || !recipientId) return;
  const phone = await conversationCustomerPhone({ tenantId: safeTenantId, conversation }).catch(() => "");

  for (const sequence of matching) {
    if (!sequence.channels.includes(resolvedChannel)) continue;
    const recent = await db.query(
      `SELECT 1 FROM message_sequence_enrollments
       WHERE tenant_id = $1 AND sequence_id = $2 AND session_id = $3
         AND (status = 'active' OR enrolled_at > NOW() - ($4::int * INTERVAL '1 day'))
       LIMIT 1`,
      [safeTenantId, sequence.id, resolvedSessionId, Math.max(0, sequence.cooldown_days)]
    );
    if (recent.rows.length) continue;
    await db.query(
      `
      INSERT INTO message_sequence_enrollments (tenant_id, sequence_id, session_id, channel, customer_phone, status, current_step, next_run_at, source)
      VALUES ($1, $2, $3, $4, $5, 'active', 0, $6, 'auto')
      ON CONFLICT DO NOTHING
      `,
      [safeTenantId, sequence.id, resolvedSessionId, resolvedChannel, phone || "", firstStepRunAt(sequence)]
    );
  }
};

const purchasedSince = async ({ tenantId, phone, since }) => {
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
    `UPDATE message_sequence_enrollments SET status = $2, stopped_reason = $3, finished_at = NOW(), locked_at = NULL, updated_at = NOW() WHERE id = $1`,
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
  if (!step) {
    await finish(row.id, "completed", "");
    return "completed";
  }
  const conversation = await resolveInboxConversation({ tenantId, conversationId: row.session_id }).catch(() => null);
  if (!conversation) {
    await finish(row.id, "stopped", "conversation_missing");
    return "conversation_missing";
  }
  if (text(conversation.session_status).toLowerCase() === "closed") {
    await finish(row.id, "stopped", "conversation_closed");
    return "conversation_closed";
  }
  if (row.stop_on_reply !== false && stepIndex > 0 && (await customerRepliedSince({ tenantId, sessionId: row.session_id, since: row.last_sent_at }))) {
    await finish(row.id, "stopped", "customer_replied");
    return "customer_replied";
  }
  if (row.stop_on_purchase !== false) {
    const phone = row.customer_phone || (await conversationCustomerPhone({ tenantId, conversation }).catch(() => ""));
    if (phone && (await purchasedSince({ tenantId, phone, since: row.enrolled_at }))) {
      await finish(row.id, "stopped", "customer_purchased");
      return "customer_purchased";
    }
  }

  let delivered = false;
  try {
    if (step.body) {
      const result = await sendInboxText({
        tenantId,
        conversationId: row.session_id,
        messageText: step.body,
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
    `SELECT e.*, s.steps, s.is_active, s.stop_on_reply, s.stop_on_purchase FROM message_sequence_enrollments e JOIN message_sequences s ON s.id = e.sequence_id WHERE e.id = ANY($1::bigint[])`,
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
