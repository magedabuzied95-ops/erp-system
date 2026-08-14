import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

import { AI_AGENT_CHANNELS, normalizeChannel } from "../../server/services/aiChannelAdapterService.js";
import { conversationPhoneKeys } from "../../server/services/aiSalesAgentService.js";
import {
  normalizeTelegramUpdate,
  sendTelegramText,
  TelegramApiError,
  validateTelegramWebhookSecret,
} from "../../server/services/telegramBotService.js";
import {
  claimNextTelegramUpdate,
  persistTelegramWebhookUpdate,
  processTelegramUpdateRecord,
  runTelegramIntakeBatch,
} from "../../server/services/telegramIntakeService.js";
import { receiveTelegramWebhook } from "../../server/routes/telegramWebhook.js";
import { backendChannelFilter } from "../../src/modules/aiSupport/services/inboxChannels.js";

const update = ({ updateId = 100, chatId = 777, userId = 555, username, text = "hello", media } = {}) => ({
  update_id: updateId,
  message: {
    message_id: 9,
    date: 1_700_000_000,
    chat: { id: chatId, type: "private" },
    from: { id: userId, first_name: "Mona", ...(username === undefined ? {} : { username }) },
    text,
    ...(media || {}),
  },
});

const response = ({ status = 200, body = {} } = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

test("invalid Telegram webhook secret is rejected before persistence", async () => {
  const previousSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const previousTenant = process.env.TELEGRAM_TENANT_ID;
  process.env.TELEGRAM_WEBHOOK_SECRET = "correct-secret";
  process.env.TELEGRAM_TENANT_ID = "1";
  const result = { statusCode: 0, body: null };
  const req = { body: update(), get: () => "wrong-secret" };
  const res = {
    status(code) { result.statusCode = code; return this; },
    json(body) { result.body = body; return this; },
  };
  try {
    await receiveTelegramWebhook(req, res);
    assert.equal(result.statusCode, 401);
    assert.equal(result.body.success, false);
  } finally {
    if (previousSecret === undefined) delete process.env.TELEGRAM_WEBHOOK_SECRET; else process.env.TELEGRAM_WEBHOOK_SECRET = previousSecret;
    if (previousTenant === undefined) delete process.env.TELEGRAM_TENANT_ID; else process.env.TELEGRAM_TENANT_ID = previousTenant;
  }
});

test("webhook secret comparison fails closed when configuration is absent", () => {
  assert.equal(validateTelegramWebhookSecret({ provided: "anything", expected: "" }), false);
  assert.equal(validateTelegramWebhookSecret({ provided: "same", expected: "same" }), true);
});

test("duplicate update_id is durably accepted but inserted once", async () => {
  const ids = new Set();
  const client = {
    async query(sql, params = []) {
      if (!String(sql).includes("INSERT INTO telegram_webhook_updates")) return { rowCount: 0, rows: [] };
      const key = `${params[0]}:${params[1]}`;
      if (ids.has(key)) return { rowCount: 0, rows: [] };
      ids.add(key);
      return { rowCount: 1, rows: [{ id: ids.size, tenant_id: params[0], update_id: params[1], processing_status: "pending" }] };
    },
  };
  const first = await persistTelegramWebhookUpdate({ tenantId: 1, update: update({ updateId: 44 }), client });
  const duplicate = await persistTelegramWebhookUpdate({ tenantId: 1, update: update({ updateId: 44 }), client });
  assert.equal(first.duplicate, false);
  assert.equal(duplicate.duplicate, true);
  assert.equal(ids.size, 1);
});

test("durable worker claims stale processing rows after restart and processes once", async () => {
  const record = { id: 3, tenant_id: 1, update_id: 91, payload: update({ updateId: 91 }) };
  let available = true;
  let completed = 0;
  const client = {
    async query(sql) {
      const statement = String(sql);
      if (statement.includes("CREATE TABLE") || statement.includes("CREATE INDEX")) return { rowCount: 0, rows: [] };
      if (statement.includes("WITH candidate")) {
        assert.match(statement, /processing_status = 'processing'/);
        assert.match(statement, /locked_at < NOW\(\)/);
        assert.match(statement, /FOR UPDATE SKIP LOCKED/);
        if (!available) return { rowCount: 0, rows: [] };
        available = false;
        return { rowCount: 1, rows: [record] };
      }
      if (statement.includes("processing_status = 'processed'")) { completed += 1; return { rowCount: 1, rows: [] }; }
      return { rowCount: 1, rows: [] };
    },
  };
  const result = await runTelegramIntakeBatch({ client, maxRows: 2, processRecord: async (row) => assert.equal(row.update_id, 91) });
  assert.deepEqual(result, { processed: 1, failed: 0 });
  assert.equal(completed, 1);
  assert.equal(await claimNextTelegramUpdate({ client }), null);
});

test("Telegram numeric identity is never treated as a customer phone", () => {
  const coincidentalPhone = "201553600938";
  assert.deepEqual(conversationPhoneKeys({
    channel: "telegram",
    session_id: `telegram:${coincidentalPhone}`,
    external_customer_id: coincidentalPhone,
    customer_phone: coincidentalPhone,
  }), []);
});

test("missing username is valid and identity remains channel scoped", () => {
  const normalized = normalizeTelegramUpdate(update({ chatId: 123, userId: 456 }));
  assert.equal(normalized.session_id, "telegram:123");
  assert.equal(normalized.user_id, "456");
  assert.equal(normalized.username, "");
});

test("all supported inbound Telegram media types normalize without changing identity", () => {
  const cases = [
    ["photo", { photo: [{ file_id: "small" }, { file_id: "large", file_size: 100 }] }],
    ["document", { document: { file_id: "doc", file_name: "x.pdf", mime_type: "application/pdf" } }],
    ["voice", { voice: { file_id: "voice", mime_type: "audio/ogg" } }],
    ["video", { video: { file_id: "video", mime_type: "video/mp4" } }],
    ["sticker", { sticker: { file_id: "sticker", mime_type: "image/webp" } }],
  ];
  for (const [type, media] of cases) {
    const normalized = normalizeTelegramUpdate(update({ text: "", media: { ...media, caption: "caption" } }));
    assert.equal(normalized.file.type, type);
    assert.equal(normalized.text, "caption");
    assert.equal(normalized.session_id, "telegram:777");
  }
});

test("media download failure does not lose the original message", async () => {
  let persisted = null;
  const result = await processTelegramUpdateRecord({ tenant_id: 1, payload: update({ text: "caption", media: { document: { file_id: "bad", file_name: "invoice.pdf", mime_type: "application/pdf" } } }) }, {
    materializeFile: async () => [{ type: "document", download_status: "failed", download_error: "media_download_failed" }],
    appendInbound: async (input) => { persisted = input; return { id: 99, ...input }; },
    upsertConversation: async () => ({}),
    logEvent: async () => ({}),
    emit: () => {},
    intake: async () => ({}),
  });
  assert.equal(result.processed, true);
  assert.equal(result.media_status, "failed");
  assert.equal(persisted.message, "caption");
  assert.equal(persisted.visualAttachments[0].download_error, "media_download_failed");
});

test("Telegram 429 preserves retry_after without leaking provider details", async () => {
  await assert.rejects(
    () => sendTelegramText({ chatId: "1", messageText: "hello", token: "test-token", fetchImpl: async () => response({ status: 429, body: { ok: false, description: "Too Many Requests", parameters: { retry_after: 17 } } }) }),
    (error) => error instanceof TelegramApiError && error.code === "TELEGRAM_RATE_LIMITED" && error.retryAfter === 17
  );
});

test("bot blocked is stored as an explicit Telegram failure class", async () => {
  await assert.rejects(
    () => sendTelegramText({ chatId: "1", messageText: "hello", token: "test-token", fetchImpl: async () => response({ status: 403, body: { ok: false, description: "Forbidden: bot was blocked by the user" } }) }),
    (error) => error instanceof TelegramApiError && error.code === "TELEGRAM_BOT_BLOCKED"
  );
});

test("channel normalization preserves every existing provider plus Telegram", () => {
  for (const channel of ["web_chat", "whatsapp", "instagram", "facebook_messenger", "telegram"]) {
    assert.equal(normalizeChannel(channel), channel);
  }
  assert.equal(AI_AGENT_CHANNELS.TELEGRAM, "telegram");
  assert.equal(backendChannelFilter("messenger"), "facebook_messenger");
  assert.equal(backendChannelFilter("instagram"), "instagram");
  assert.equal(backendChannelFilter("whatsapp"), "whatsapp");
  assert.equal(backendChannelFilter("web"), "web_chat");
  assert.equal(backendChannelFilter("telegram"), "telegram");
});

test("Telegram outbound branch remains isolated from existing provider branches", async () => {
  const source = await fs.readFile(new URL("../../server/routes/aiAgentOrders.js", import.meta.url), "utf8");
  assert.match(source, /else if \(isTelegramConversation\)[\s\S]*?sendTelegramText/);
  assert.match(source, /else if \(isWhatsAppConversation\)[\s\S]*?sendWhatsAppCloudReply/);
  assert.match(source, /sendMetaInboxOutboundMessage/);
});
