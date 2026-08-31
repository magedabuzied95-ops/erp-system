import db from "../database/db.js";
import { emitToRooms } from "../utils/socket.js";
import { handleInboundMessageIntake } from "./aiInboundIntakeService.js";
import { logChannelEvent, upsertChannelConversationMapping } from "./aiChannelAdapterService.js";
import { appendInboundAiSupportMessage } from "./aiSupportLogService.js";
import {
  materializeTelegramFile,
  normalizeTelegramUpdate,
  TELEGRAM_CHANNEL,
  telegramAttachmentLabel,
  telegramBotToken,
} from "./telegramBotService.js";

const text = (value = "") => String(value ?? "").trim();
const MAX_RETRIES = Math.max(1, Math.min(20, Number(process.env.TELEGRAM_WEBHOOK_MAX_RETRIES || 8)));
const LOCK_TIMEOUT_MINUTES = 5;
const POLL_INTERVAL_MS = Math.max(1_000, Number(process.env.TELEGRAM_WEBHOOK_POLL_MS || 10_000));
const MAX_BATCH_SIZE = 10;

export const safeTelegramProcessingError = (error) => text(error?.code || error?.message || error || "telegram_processing_failed")
  .replace(/https:\/\/api\.telegram\.org\/bot[^/\s]+/gi, "[telegram-api]")
  .replace(/https:\/\/api\.telegram\.org\/file\/bot[^/\s]+/gi, "[telegram-file]")
  .slice(0, 500);

let schemaReadyPromise = null;
export const ensureTelegramIntakeSchema = async (client = db) => {
  if (!schemaReadyPromise || client !== db) {
    const operation = (async () => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS telegram_webhook_updates (
          id BIGSERIAL PRIMARY KEY,
          tenant_id BIGINT NOT NULL,
          update_id BIGINT NOT NULL,
          payload JSONB NOT NULL,
          processing_status TEXT NOT NULL DEFAULT 'pending',
          retry_count INTEGER NOT NULL DEFAULT 0,
          last_error TEXT NOT NULL DEFAULT '',
          next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          locked_at TIMESTAMPTZ NULL,
          received_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          processed_at TIMESTAMPTZ NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (tenant_id, update_id)
        )
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_telegram_webhook_updates_pending
        ON telegram_webhook_updates (processing_status, next_attempt_at, received_at)
        WHERE processing_status IN ('pending', 'failed', 'processing')
      `);
      return true;
    })();
    if (client === db) schemaReadyPromise = operation.catch((error) => { schemaReadyPromise = null; throw error; });
    return operation;
  }
  return schemaReadyPromise;
};

export const persistTelegramWebhookUpdate = async ({ tenantId, update, client = db } = {}) => {
  const safeTenantId = Number(tenantId);
  const updateId = Number(update?.update_id);
  if (!Number.isSafeInteger(safeTenantId) || safeTenantId <= 0) throw Object.assign(new Error("Telegram tenant is not configured"), { status: 503, code: "TELEGRAM_TENANT_MISSING" });
  if (!Number.isSafeInteger(updateId) || updateId < 0) throw Object.assign(new Error("Telegram update_id is invalid"), { status: 400, code: "TELEGRAM_UPDATE_INVALID" });
  await ensureTelegramIntakeSchema(client);
  const result = await client.query(
    `INSERT INTO telegram_webhook_updates (tenant_id, update_id, payload)
     VALUES ($1::bigint, $2::bigint, $3::jsonb)
     ON CONFLICT (tenant_id, update_id) DO NOTHING
     RETURNING id, tenant_id, update_id, processing_status, received_at`,
    [safeTenantId, updateId, JSON.stringify(update)]
  );
  return { accepted: true, duplicate: result.rowCount === 0, record: result.rows[0] || null };
};

export const claimNextTelegramUpdate = async ({ client = db, maxRetries = MAX_RETRIES } = {}) => {
  await ensureTelegramIntakeSchema(client);
  const result = await client.query(
    `WITH candidate AS (
       SELECT id
       FROM telegram_webhook_updates
       WHERE retry_count < $1::int
         AND (
           (processing_status IN ('pending', 'failed') AND next_attempt_at <= NOW())
           OR (processing_status = 'processing' AND locked_at < NOW() - ($2::int * INTERVAL '1 minute'))
         )
       ORDER BY received_at ASC, id ASC
       FOR UPDATE SKIP LOCKED
       LIMIT 1
     )
     UPDATE telegram_webhook_updates queued
     SET processing_status = 'processing', locked_at = NOW(), updated_at = NOW()
     FROM candidate
     WHERE queued.id = candidate.id
     RETURNING queued.*`,
    [Math.max(1, Number(maxRetries) || MAX_RETRIES), LOCK_TIMEOUT_MINUTES]
  );
  return result.rows[0] || null;
};

export const markTelegramUpdateProcessed = async ({ id, client = db } = {}) => {
  await client.query(
    `UPDATE telegram_webhook_updates
     SET processing_status = 'processed', processed_at = NOW(), locked_at = NULL,
         last_error = '', updated_at = NOW()
     WHERE id = $1::bigint`,
    [id]
  );
};

export const markTelegramUpdateFailed = async ({ id, error, client = db } = {}) => {
  const safeError = safeTelegramProcessingError(error);
  await client.query(
    `UPDATE telegram_webhook_updates
     SET processing_status = 'failed', retry_count = retry_count + 1,
         last_error = $2::text, locked_at = NULL,
         next_attempt_at = NOW() + (LEAST(300, POWER(2, LEAST(retry_count, 8))::int) * INTERVAL '1 second'),
         updated_at = NOW()
     WHERE id = $1::bigint`,
    [id, safeError]
  );
};

export const processTelegramUpdateRecord = async (record, {
  botToken = telegramBotToken(),
  materializeFile = materializeTelegramFile,
  appendInbound = appendInboundAiSupportMessage,
  upsertConversation = upsertChannelConversationMapping,
  logEvent = logChannelEvent,
  emit = emitToRooms,
  intake = handleInboundMessageIntake,
} = {}) => {
  const normalized = normalizeTelegramUpdate(record?.payload || {});
  if (!normalized) return { ignored: true, reason: "unsupported_update" };
  const attachments = await materializeFile({ normalizedMessage: normalized, token: botToken });
  const messageText = normalized.text || telegramAttachmentLabel(attachments);
  const inboundRow = await appendInbound({
    tenantId: record.tenant_id,
    sessionId: normalized.session_id,
    message: messageText || "Telegram message",
    messageType: normalized.file?.type || "text",
    channel: TELEGRAM_CHANNEL,
    customerName: normalized.customer_name,
    externalMessageId: normalized.message_id,
    providerMessageId: normalized.provider_message_id,
    visualAttachments: attachments,
    source: "telegram_webhook",
    sourcePath: "telegram_webhook",
    insertSource: "telegram_webhook",
    remoteJid: normalized.chat_id,
    resolvedReplyJid: normalized.chat_id,
    resolvedPhone: "",
  });
  await upsertConversation({
    tenantId: record.tenant_id,
    channel: TELEGRAM_CHANNEL,
    externalConversationId: normalized.session_id,
    externalCustomerId: normalized.user_id,
    customerName: normalized.customer_name,
    metadata: {
      chat_id: normalized.chat_id,
      telegram_user_id: normalized.user_id,
      telegram_message_id: normalized.message_id,
      username: normalized.username,
      first_name: normalized.first_name,
      last_name: normalized.last_name,
      last_message: messageText,
      media_download_status: attachments[0]?.download_status || "none",
    },
    lastMessageAt: normalized.timestamp,
  });
  await logEvent({
    tenantId: record.tenant_id,
    channel: TELEGRAM_CHANNEL,
    direction: "inbound",
    externalCustomerId: normalized.user_id,
    conversationId: normalized.session_id,
    messagePreview: messageText,
    status: "received",
    metadata: { external_message_id: normalized.message_id, update_id: normalized.update_id, attachment_count: attachments.length },
  }).catch(() => {});
  if (inboundRow) {
    emit([`tenant:${record.tenant_id}`], "ai_inbox:message", {
      tenant_id: record.tenant_id,
      session_id: normalized.session_id,
      channel: TELEGRAM_CHANNEL,
      message: { ...inboundRow, from_me: false, direction: "inbound" },
    });
    emit([`tenant:${record.tenant_id}`], "ai_inbox:refresh", {
      tenant_id: record.tenant_id,
      session_id: normalized.session_id,
      channel: TELEGRAM_CHANNEL,
      reason: "telegram_inbound",
      at: new Date().toISOString(),
    });
  }
  await intake({
    tenantId: record.tenant_id,
    channel: TELEGRAM_CHANNEL,
    conversationId: normalized.session_id,
    canonicalMessageId: inboundRow?.id || null,
    providerMessageId: normalized.message_id,
    text: normalized.text,
    fromMe: false,
    autoReplyMode: "suggest_only",
    autoSent: false,
  }).catch(() => {});
  return { processed: true, session_id: normalized.session_id, message_id: normalized.message_id, media_status: attachments[0]?.download_status || "none" };
};

let workerRunning = false;
let workerTimer = null;

export const runTelegramIntakeBatch = async ({ client = db, processRecord = processTelegramUpdateRecord, maxRows = MAX_BATCH_SIZE } = {}) => {
  if (workerRunning && client === db) return { skipped: true, reason: "worker_running" };
  if (client === db) workerRunning = true;
  let processed = 0;
  let failed = 0;
  try {
    for (let index = 0; index < Math.max(1, Number(maxRows) || 1); index += 1) {
      const record = await claimNextTelegramUpdate({ client });
      if (!record) break;
      try {
        await processRecord(record);
        await markTelegramUpdateProcessed({ id: record.id, client });
        processed += 1;
      } catch (error) {
        await markTelegramUpdateFailed({ id: record.id, error, client });
        failed += 1;
        console.warn("[telegram-intake] update processing failed", { update_id: record.update_id, code: error?.code || "", message: safeTelegramProcessingError(error) });
      }
    }
    return { processed, failed };
  } finally {
    if (client === db) workerRunning = false;
  }
};

export const wakeTelegramIntakeWorker = () => {
  setImmediate(() => { void runTelegramIntakeBatch().catch((error) => console.warn("[telegram-intake] worker wake failed", { message: safeTelegramProcessingError(error) })); });
};

export const startTelegramIntakeWorker = () => {
  if (workerTimer) return workerTimer;
  workerTimer = setInterval(wakeTelegramIntakeWorker, POLL_INTERVAL_MS);
  workerTimer.unref?.();
  wakeTelegramIntakeWorker();
  return workerTimer;
};

export const stopTelegramIntakeWorker = () => {
  if (workerTimer) clearInterval(workerTimer);
  workerTimer = null;
};
