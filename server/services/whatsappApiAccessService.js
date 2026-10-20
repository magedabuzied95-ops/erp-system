/*
 * WhatsApp developer access — API keys and outbound webhooks (inbox top bar → WhatsApp →
 * API Keys / API Webhooks).
 *
 * API KEYS let an external system send WhatsApp messages through the shop's official number:
 *   - the plaintext key (`m1wa_` + 40 url-safe chars) is shown ONCE, at creation, and never again;
 *   - only its sha256 and a short display prefix are stored, so a database leak is not a key leak;
 *   - a key may be pinned to one official number (phone_number_id); empty = the default number.
 *
 * WEBHOOKS push our WhatsApp events (message.received / message.status / message.sent) to a URL
 * the external system owns. Every delivery is signed: X-M1-Signature: sha256=<HMAC(secret, body)>.
 *   - delivery is fire-and-forget and NEVER throws to the caller — a broken customer endpoint
 *     must not slow down or fail our own Meta webhook handling;
 *   - consecutive failures are counted; 20 in a row disables the webhook;
 *   - callback URLs must be public http(s): localhost / private / link-local / metadata ranges are
 *     refused when saved AND re-checked against DNS before each delivery (SSRF guard), and
 *     redirects are not followed.
 *
 * The signing secret is encrypted at rest with the WhatsApp Cloud envelope when its key is
 * configured; otherwise it is stored as-is. Either way the API returns only a masked form after
 * creation.
 */

import crypto from "node:crypto";
import dns from "node:dns";
import net from "node:net";

import db from "../database/db.js";
import { cloudConfig, graphRequest, toGraphRecipient } from "./whatsappCloudProvider.js";
import {
  describeWhatsappCloudEncryptionKey,
  encryptWhatsappCloudSecret,
  isWhatsappCloudEncryptedEnvelope,
  tryDecryptWhatsappCloudSecret,
} from "./whatsappCloudCryptoService.js";
import { integrationAccessToken, listIntegrations } from "./whatsappEmbeddedSignupService.js";

export const API_KEY_PREFIX = "m1wa_";
export const API_KEY_RANDOM_LENGTH = 40;
export const WEBHOOK_EVENTS = Object.freeze(["message.received", "message.status", "message.sent"]);
export const WEBHOOK_AUTO_DISABLE_AFTER = 20;
export const WEBHOOK_TIMEOUT_MS = 5000;
const LAST_USED_THROTTLE_MS = 60 * 1000;

const text = (value = "") => String(value ?? "").trim();
const httpError = (message, status = 400, code = "WHATSAPP_API_ACCESS_INVALID") =>
  Object.assign(new Error(message), { status, code });
const tenantOf = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw httpError("A valid tenant id is required");
  return Math.trunc(parsed);
};
const idOf = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 0;
};

/* ------------------------------------------------------------------ schema */

let schemaReady = null;
export const ensureWhatsappApiAccessSchema = () => {
  schemaReady ||= (async () => {
    await db.query(`
      CREATE TABLE IF NOT EXISTS whatsapp_api_keys (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL,
        name VARCHAR(120) NOT NULL DEFAULT '',
        key_prefix VARCHAR(16) NOT NULL,
        key_hash CHAR(64) NOT NULL UNIQUE,
        user_id INTEGER,
        phone_number_id VARCHAR(64) NOT NULL DEFAULT '',
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        last_used_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_whatsapp_api_keys_tenant ON whatsapp_api_keys (tenant_id)`);
    await db.query(`
      CREATE TABLE IF NOT EXISTS whatsapp_api_webhooks (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL,
        callback_url TEXT NOT NULL,
        secret TEXT NOT NULL DEFAULT '',
        events JSONB NOT NULL DEFAULT '[]'::jsonb,
        phone_number_id VARCHAR(64) NOT NULL DEFAULT '',
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        failure_count INTEGER NOT NULL DEFAULT 0,
        last_success_at TIMESTAMPTZ,
        last_error TEXT NOT NULL DEFAULT '',
        last_error_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_whatsapp_api_webhooks_tenant ON whatsapp_api_webhooks (tenant_id, is_active)`);
  })().catch((error) => {
    schemaReady = null;
    throw error;
  });
  return schemaReady;
};

/* ------------------------------------------------------------------ pure helpers (exported for tests) */

export const generateApiKey = () => `${API_KEY_PREFIX}${crypto.randomBytes(30).toString("base64url")}`;

export const hashApiKey = (raw = "") => crypto.createHash("sha256").update(String(raw ?? ""), "utf8").digest("hex");

export const apiKeyDisplayPrefix = (raw = "") => String(raw ?? "").slice(0, API_KEY_PREFIX.length + 8);

export const isWellFormedApiKey = (raw = "") =>
  new RegExp(`^${API_KEY_PREFIX}[A-Za-z0-9_-]{${API_KEY_RANDOM_LENGTH}}$`).test(String(raw ?? ""));

// Both inputs are fixed-length hex digests, so timingSafeEqual never sees a length mismatch.
export const hashesMatch = (left = "", right = "") => {
  const a = Buffer.from(String(left || ""), "utf8");
  const b = Buffer.from(String(right || ""), "utf8");
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
};

/** Reads the key from `X-API-Key` or `Authorization: Bearer m1wa_…`. */
export const extractApiKey = (headers = {}) => {
  const direct = text(headers["x-api-key"] || headers["X-API-Key"]);
  if (direct) return direct;
  const auth = text(headers.authorization || headers.Authorization);
  const match = auth.match(/^Bearer\s+(\S+)$/i);
  return match ? match[1] : "";
};

export const generateWebhookSecret = () => `whsec_${crypto.randomBytes(24).toString("base64url")}`;

export const signWebhookBody = (secret = "", body = "") =>
  `sha256=${crypto.createHmac("sha256", String(secret ?? "")).update(String(body ?? ""), "utf8").digest("hex")}`;

export const verifyWebhookSignature = (secret = "", body = "", signature = "") => {
  const expected = signWebhookBody(secret, body);
  const got = String(signature ?? "");
  return expected.length === got.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(got));
};

const ipv4ToInt = (ip) => ip.split(".").reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
const IPV4_BLOCKED = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
].map(([base, bits]) => [ipv4ToInt(base), bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0]);

/** True for any address an outbound webhook must never reach (loopback, private, link-local, …). */
export const isPrivateAddress = (address = "") => {
  let ip = String(address ?? "").trim().replace(/^\[|\]$/g, "").toLowerCase();
  if (!ip) return true;
  const zone = ip.indexOf("%");
  if (zone >= 0) ip = ip.slice(0, zone);
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) ip = mapped[1];
  const kind = net.isIP(ip);
  if (kind === 4) {
    const value = ipv4ToInt(ip);
    return IPV4_BLOCKED.some(([base, mask]) => ((value & mask) >>> 0) === base);
  }
  if (kind === 6) {
    if (ip === "::" || ip === "::1") return true;
    // ::ffff:7f00:1 style mapped addresses written in hex.
    const hexMapped = ip.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hexMapped) {
      const high = parseInt(hexMapped[1], 16);
      const low = parseInt(hexMapped[2], 16);
      return isPrivateAddress(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
    }
    const first = parseInt(ip.split(":")[0] || "0", 16);
    if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
    if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
    if ((first & 0xff00) === 0xff00) return true; // ff00::/8 multicast
    if (ip.startsWith("64:ff9b:")) return true; // NAT64 can reach IPv4 private space
    return false;
  }
  return true; // not an IP at all: treat as unsafe
};

const BLOCKED_HOST_SUFFIXES = [".localhost", ".local", ".internal", ".localdomain", ".home.arpa"];

/**
 * Static check of a callback URL: http(s) only, no credentials, no localhost-style names, and an
 * IP literal must be public. Returns the normalised URL string; throws a 400 otherwise.
 */
export const assertSafeCallbackUrl = (value = "") => {
  const raw = text(value);
  if (!raw || raw.length > 2000) throw httpError("A callback URL is required", 400, "WHATSAPP_WEBHOOK_URL_INVALID");
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw httpError("The callback URL is not a valid URL", 400, "WHATSAPP_WEBHOOK_URL_INVALID");
  }
  if (!["http:", "https:"].includes(url.protocol)) throw httpError("Only http(s) callback URLs are allowed", 400, "WHATSAPP_WEBHOOK_URL_INVALID");
  if (url.username || url.password) throw httpError("The callback URL must not contain credentials", 400, "WHATSAPP_WEBHOOK_URL_INVALID");
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host) throw httpError("The callback URL needs a host", 400, "WHATSAPP_WEBHOOK_URL_INVALID");
  const bare = host.replace(/^\[|\]$/g, "");
  if (host === "localhost" || BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    throw httpError("Local and internal hosts are not allowed", 400, "WHATSAPP_WEBHOOK_URL_PRIVATE");
  }
  if (net.isIP(bare) && isPrivateAddress(bare)) {
    throw httpError("Private and loopback addresses are not allowed", 400, "WHATSAPP_WEBHOOK_URL_PRIVATE");
  }
  // A bare number host ("2130706433") is a decimal IPv4 that URL already folded; a dotless name
  // that is not an IP is an intranet name.
  if (!net.isIP(bare) && !host.includes(".")) {
    throw httpError("The callback URL needs a public domain name", 400, "WHATSAPP_WEBHOOK_URL_PRIVATE");
  }
  return url.toString();
};

/** Static check plus DNS: every address the name resolves to must be public. */
export const assertCallbackResolvesPublic = async (value = "") => {
  const safe = assertSafeCallbackUrl(value);
  const host = new URL(safe).hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host)) return safe;
  let addresses = [];
  try {
    addresses = await dns.promises.lookup(host, { all: true, verbatim: true });
  } catch {
    throw httpError("The callback host could not be resolved", 400, "WHATSAPP_WEBHOOK_URL_UNRESOLVED");
  }
  if (!addresses.length || addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw httpError("The callback host resolves to a private address", 400, "WHATSAPP_WEBHOOK_URL_PRIVATE");
  }
  return safe;
};

export const normalizeEvents = (value) => {
  const list = (Array.isArray(value) ? value : []).map((item) => text(item)).filter((item) => WEBHOOK_EVENTS.includes(item));
  return list.length ? [...new Set(list)] : [...WEBHOOK_EVENTS];
};

const maskSecret = (value = "") => (value ? `${value.slice(0, 8)}••••${value.slice(-4)}` : "");

/* ------------------------------------------------------------------ secret at rest */

const sealSecret = (plain) => {
  if (describeWhatsappCloudEncryptionKey().ok) {
    try {
      return encryptWhatsappCloudSecret(plain);
    } catch {
      /* fall through to plain storage */
    }
  }
  return plain;
};

const openSecret = (stored = "") =>
  isWhatsappCloudEncryptedEnvelope(stored) ? tryDecryptWhatsappCloudSecret(stored, { surface: "whatsapp_api_webhook" }) : String(stored || "");

/* ------------------------------------------------------------------ shapes */

const publicKey = (row) => ({
  id: row.id,
  name: row.name || "",
  key_prefix: row.key_prefix,
  user_id: row.user_id ?? null,
  user_name: row.user_name || "",
  phone_number_id: row.phone_number_id || "",
  is_active: row.is_active === true,
  last_used_at: row.last_used_at,
  created_at: row.created_at,
});

const publicWebhook = (row) => ({
  id: row.id,
  callback_url: row.callback_url,
  events: Array.isArray(row.events) ? row.events : [],
  phone_number_id: row.phone_number_id || "",
  is_active: row.is_active === true,
  failure_count: Number(row.failure_count) || 0,
  last_success_at: row.last_success_at,
  last_error: row.last_error || "",
  last_error_at: row.last_error_at,
  created_at: row.created_at,
  secret_masked: maskSecret(openSecret(row.secret)),
});

/* ------------------------------------------------------------------ accounts (official numbers) */

export const listWhatsappAccounts = async ({ tenantId }) => {
  const rows = await listIntegrations({ tenantId: tenantOf(tenantId) }).catch(() => []);
  const accounts = rows
    .filter((row) => row.status === "connected" && text(row.phone_number_id))
    .map((row) => ({
      phone_number_id: text(row.phone_number_id),
      display_phone_number: text(row.display_phone_number),
      verified_name: text(row.verified_name),
      source: "embedded_signup",
    }));
  const env = cloudConfig();
  if (env.phoneNumberId && !accounts.some((item) => item.phone_number_id === env.phoneNumberId)) {
    accounts.push({ phone_number_id: env.phoneNumberId, display_phone_number: "", verified_name: "", source: "env" });
  }
  return accounts;
};

/* ------------------------------------------------------------------ API keys */

export const listApiKeys = async ({ tenantId }) => {
  await ensureWhatsappApiAccessSchema();
  const result = await db.query(
    `SELECT k.*, COALESCE(NULLIF(u.name, ''), NULLIF(u.email, ''), '') AS user_name
       FROM whatsapp_api_keys k
       LEFT JOIN users u ON u.id = k.user_id
      WHERE k.tenant_id = $1
      ORDER BY k.created_at DESC, k.id DESC`,
    [tenantOf(tenantId)]
  );
  return result.rows.map(publicKey);
};

/** Returns { key, plaintext } — the plaintext exists only in this response. */
export const createApiKey = async ({ tenantId, userId = null, input = {} }) => {
  await ensureWhatsappApiAccessSchema();
  const name = text(input.name).slice(0, 120);
  if (!name) throw httpError("A name is required");
  const plaintext = generateApiKey();
  const result = await db.query(
    `INSERT INTO whatsapp_api_keys (tenant_id, name, key_prefix, key_hash, user_id, phone_number_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [tenantOf(tenantId), name, apiKeyDisplayPrefix(plaintext), hashApiKey(plaintext), idOf(userId) || null, text(input.phone_number_id).slice(0, 64)]
  );
  return { key: publicKey(result.rows[0]), plaintext };
};

export const updateApiKey = async ({ tenantId, id, input = {} }) => {
  await ensureWhatsappApiAccessSchema();
  const sets = [];
  const params = [tenantOf(tenantId), idOf(id)];
  if (input.name !== undefined) {
    const name = text(input.name).slice(0, 120);
    if (!name) throw httpError("A name is required");
    params.push(name);
    sets.push(`name = $${params.length}`);
  }
  const active = input.is_active ?? input.active;
  if (active !== undefined) {
    params.push(active === true || active === "true");
    sets.push(`is_active = $${params.length}`);
  }
  if (input.phone_number_id !== undefined) {
    params.push(text(input.phone_number_id).slice(0, 64));
    sets.push(`phone_number_id = $${params.length}`);
  }
  if (!sets.length) throw httpError("Nothing to update");
  const result = await db.query(
    `UPDATE whatsapp_api_keys SET ${sets.join(", ")} WHERE tenant_id = $1 AND id = $2 RETURNING *`,
    params
  );
  if (!result.rows[0]) throw httpError("API key not found", 404, "WHATSAPP_API_KEY_NOT_FOUND");
  return publicKey(result.rows[0]);
};

export const deleteApiKey = async ({ tenantId, id }) => {
  await ensureWhatsappApiAccessSchema();
  const result = await db.query(`DELETE FROM whatsapp_api_keys WHERE tenant_id = $1 AND id = $2 RETURNING id`, [tenantOf(tenantId), idOf(id)]);
  if (!result.rows[0]) throw httpError("API key not found", 404, "WHATSAPP_API_KEY_NOT_FOUND");
  return { id: result.rows[0].id };
};

const lastUsedWrites = new Map();

/**
 * Raw key → the active key row, or null. The lookup is by sha256 (an index hit, so no
 * character-by-character compare of the secret ever happens), then confirmed with timingSafeEqual.
 */
export const verifyApiKey = async (raw = "") => {
  const key = text(raw);
  if (!isWellFormedApiKey(key)) return null;
  await ensureWhatsappApiAccessSchema();
  const hash = hashApiKey(key);
  const result = await db.query(`SELECT * FROM whatsapp_api_keys WHERE key_hash = $1 LIMIT 1`, [hash]);
  const row = result.rows[0];
  if (!row || !hashesMatch(String(row.key_hash).trim(), hash) || row.is_active !== true) return null;
  const now = Date.now();
  const lastWrite = lastUsedWrites.get(row.id) || 0;
  if (now - lastWrite > LAST_USED_THROTTLE_MS) {
    lastUsedWrites.set(row.id, now);
    db.query(`UPDATE whatsapp_api_keys SET last_used_at = NOW() WHERE id = $1`, [row.id]).catch(() => {});
  }
  return row;
};

/* ------------------------------------------------------------------ sending through the official number */

export const resolveSendCredentials = async ({ tenantId, phoneNumberId = "" }) => {
  const env = cloudConfig();
  const wanted = text(phoneNumberId);
  const rows = await listIntegrations({ tenantId }).catch(() => []);
  const connected = rows.filter((row) => row.status === "connected" && text(row.phone_number_id) && row.access_token_encrypted);
  const match = wanted ? connected.find((row) => text(row.phone_number_id) === wanted) : connected[0];
  if (match) {
    const token = text(integrationAccessToken(match));
    if (token) return { accessToken: token, phoneNumberId: text(match.phone_number_id), graphVersion: env.graphVersion };
  }
  if (env.accessToken && env.phoneNumberId && (!wanted || wanted === env.phoneNumberId)) {
    return { accessToken: env.accessToken, phoneNumberId: env.phoneNumberId, graphVersion: env.graphVersion };
  }
  throw httpError(
    wanted ? "The WhatsApp number this key is bound to is not connected" : "No official WhatsApp account is connected",
    409,
    "WHATSAPP_CLOUD_NOT_CONNECTED"
  );
};

const postCloudMessage = async ({ tenantId, phoneNumberId, message }) => {
  const credentials = await resolveSendCredentials({ tenantId, phoneNumberId });
  const result = await graphRequest({
    path: `/${credentials.graphVersion}/${credentials.phoneNumberId}/messages`,
    method: "POST",
    body: message,
    accessToken: credentials.accessToken,
  });
  const messageId = text(result?.messages?.[0]?.id);
  void dispatchWhatsappEvent({
    tenantId,
    event: "message.sent",
    phoneNumberId: credentials.phoneNumberId,
    payload: { to: message.to, message_id: messageId, type: message.type, timestamp: Math.floor(Date.now() / 1000) },
  }).catch(() => {});
  return { message_id: messageId, phone_number_id: credentials.phoneNumberId };
};

export const sendApiText = async ({ tenantId, phoneNumberId = "", to, text: body }) => {
  const recipient = toGraphRecipient(to);
  const message = String(body ?? "");
  if (!recipient || recipient.length < 8) throw httpError("`to` must be a phone number in international format", 400, "WHATSAPP_PHONE_REQUIRED");
  if (!message.trim()) throw httpError("`text` is required", 400, "WHATSAPP_MESSAGE_REQUIRED");
  if (message.length > 4096) throw httpError("`text` is longer than 4096 characters", 400, "WHATSAPP_MESSAGE_TOO_LONG");
  return postCloudMessage({
    tenantId,
    phoneNumberId,
    message: { messaging_product: "whatsapp", recipient_type: "individual", to: recipient, type: "text", text: { preview_url: false, body: message } },
  });
};

export const buildTemplateMessage = ({ to, templateName, language = "ar", variables = [] }) => {
  const recipient = toGraphRecipient(to);
  const name = text(templateName);
  if (!recipient || recipient.length < 8) throw httpError("`to` must be a phone number in international format", 400, "WHATSAPP_PHONE_REQUIRED");
  if (!/^[a-z0-9_]{1,512}$/.test(name)) throw httpError("`template_name` is invalid", 400, "WHATSAPP_TEMPLATE_NAME_INVALID");
  const values = (Array.isArray(variables) ? variables : []).map((item) => String(item ?? ""));
  const template = { name, language: { code: text(language) || "ar" } };
  if (values.length) template.components = [{ type: "body", parameters: values.map((value) => ({ type: "text", text: value })) }];
  return { messaging_product: "whatsapp", to: recipient, type: "template", template };
};

export const sendApiTemplate = async ({ tenantId, phoneNumberId = "", to, templateName, language, variables }) =>
  postCloudMessage({ tenantId, phoneNumberId, message: buildTemplateMessage({ to, templateName, language, variables }) });

/* ------------------------------------------------------------------ webhooks */

export const listWebhooks = async ({ tenantId }) => {
  await ensureWhatsappApiAccessSchema();
  const result = await db.query(`SELECT * FROM whatsapp_api_webhooks WHERE tenant_id = $1 ORDER BY created_at DESC, id DESC`, [tenantOf(tenantId)]);
  return result.rows.map(publicWebhook);
};

/** Returns { webhook, secret } — the plaintext secret exists only in this response. */
export const createWebhook = async ({ tenantId, input = {} }) => {
  await ensureWhatsappApiAccessSchema();
  const callbackUrl = assertSafeCallbackUrl(input.callback_url);
  const secret = generateWebhookSecret();
  const result = await db.query(
    `INSERT INTO whatsapp_api_webhooks (tenant_id, callback_url, secret, events, phone_number_id)
     VALUES ($1, $2, $3, $4::jsonb, $5)
     RETURNING *`,
    [tenantOf(tenantId), callbackUrl, sealSecret(secret), JSON.stringify(normalizeEvents(input.events)), text(input.phone_number_id).slice(0, 64)]
  );
  return { webhook: publicWebhook(result.rows[0]), secret };
};

export const updateWebhook = async ({ tenantId, id, input = {} }) => {
  await ensureWhatsappApiAccessSchema();
  const sets = [];
  const params = [tenantOf(tenantId), idOf(id)];
  if (input.callback_url !== undefined) {
    params.push(assertSafeCallbackUrl(input.callback_url));
    sets.push(`callback_url = $${params.length}`);
  }
  if (input.events !== undefined) {
    params.push(JSON.stringify(normalizeEvents(input.events)));
    sets.push(`events = $${params.length}::jsonb`);
  }
  if (input.phone_number_id !== undefined) {
    params.push(text(input.phone_number_id).slice(0, 64));
    sets.push(`phone_number_id = $${params.length}`);
  }
  const active = input.is_active ?? input.active;
  if (active !== undefined) {
    const on = active === true || active === "true";
    params.push(on);
    sets.push(`is_active = $${params.length}`);
    // Re-enabling starts a fresh failure streak, otherwise one more failure disables it again.
    if (on) sets.push("failure_count = 0");
  }
  if (!sets.length) throw httpError("Nothing to update");
  const result = await db.query(`UPDATE whatsapp_api_webhooks SET ${sets.join(", ")} WHERE tenant_id = $1 AND id = $2 RETURNING *`, params);
  if (!result.rows[0]) throw httpError("Webhook not found", 404, "WHATSAPP_WEBHOOK_NOT_FOUND");
  return publicWebhook(result.rows[0]);
};

export const deleteWebhook = async ({ tenantId, id }) => {
  await ensureWhatsappApiAccessSchema();
  const result = await db.query(`DELETE FROM whatsapp_api_webhooks WHERE tenant_id = $1 AND id = $2 RETURNING id`, [tenantOf(tenantId), idOf(id)]);
  if (!result.rows[0]) throw httpError("Webhook not found", 404, "WHATSAPP_WEBHOOK_NOT_FOUND");
  return { id: result.rows[0].id };
};

const recordDelivery = async (row, ok, errorText = "") => {
  if (ok) {
    await db.query(`UPDATE whatsapp_api_webhooks SET failure_count = 0, last_success_at = NOW() WHERE id = $1`, [row.id]);
    return;
  }
  await db.query(
    `UPDATE whatsapp_api_webhooks
        SET failure_count = failure_count + 1,
            last_error = $2,
            last_error_at = NOW(),
            is_active = CASE WHEN failure_count + 1 >= $3 THEN FALSE ELSE is_active END
      WHERE id = $1`,
    [row.id, String(errorText || "error").slice(0, 500), WEBHOOK_AUTO_DISABLE_AFTER]
  );
};

/** One signed POST. Resolves { ok, status, error } — never throws. */
const deliver = async (row, event, data) => {
  const body = JSON.stringify({ event, created_at: new Date().toISOString(), data });
  let ok = false;
  let status = 0;
  let error = "";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
  try {
    const target = await assertCallbackResolvesPublic(row.callback_url);
    const secret = openSecret(row.secret);
    const response = await fetch(target, {
      method: "POST",
      redirect: "manual",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "M1-WhatsApp-Webhooks/1.0",
        "X-M1-Event": event,
        "X-M1-Signature": signWebhookBody(secret, body),
      },
      body,
      signal: controller.signal,
    });
    status = response.status;
    ok = response.status >= 200 && response.status < 300;
    if (!ok) error = `HTTP ${response.status}`;
    response.body?.cancel?.().catch?.(() => {});
  } catch (failure) {
    error = failure?.name === "AbortError" ? `Timed out after ${WEBHOOK_TIMEOUT_MS / 1000}s` : failure?.message || String(failure);
  } finally {
    clearTimeout(timer);
  }
  await recordDelivery(row, ok, error).catch(() => {});
  return { ok, status, error };
};

/**
 * Fan an event out to every active webhook of the tenant that subscribed to it (and, when the
 * webhook is pinned to a number, only for that number). Fire-and-forget: resolves when every
 * delivery settled, and swallows every failure.
 */
export const dispatchWhatsappEvent = async ({ tenantId, event, payload = {}, phoneNumberId = "" } = {}) => {
  try {
    if (!WEBHOOK_EVENTS.includes(event)) return { delivered: 0 };
    const tenant = idOf(tenantId);
    if (!tenant) return { delivered: 0 };
    await ensureWhatsappApiAccessSchema();
    const result = await db.query(
      `SELECT * FROM whatsapp_api_webhooks
        WHERE tenant_id = $1 AND is_active = TRUE AND events ? $2
          AND (phone_number_id = '' OR phone_number_id = $3)`,
      [tenant, event, text(phoneNumberId)]
    );
    if (!result.rows.length) return { delivered: 0 };
    const data = { ...payload, ...(text(phoneNumberId) ? { phone_number_id: text(phoneNumberId) } : {}) };
    const outcomes = await Promise.allSettled(result.rows.map((row) => deliver(row, event, data)));
    return { delivered: outcomes.filter((item) => item.status === "fulfilled" && item.value.ok).length };
  } catch (error) {
    console.warn("[whatsapp-api-webhooks:dispatch-failed]", { event, message: error?.message || String(error) });
    return { delivered: 0 };
  }
};

export const testWebhook = async ({ tenantId, id }) => {
  await ensureWhatsappApiAccessSchema();
  const result = await db.query(`SELECT * FROM whatsapp_api_webhooks WHERE tenant_id = $1 AND id = $2`, [tenantOf(tenantId), idOf(id)]);
  const row = result.rows[0];
  if (!row) throw httpError("Webhook not found", 404, "WHATSAPP_WEBHOOK_NOT_FOUND");
  const outcome = await deliver(row, "ping", { message: "M1 webhook test", webhook_id: row.id, timestamp: Math.floor(Date.now() / 1000) });
  const fresh = await db.query(`SELECT * FROM whatsapp_api_webhooks WHERE id = $1`, [row.id]);
  return { ...outcome, webhook: fresh.rows[0] ? publicWebhook(fresh.rows[0]) : publicWebhook(row) };
};

/**
 * Meta Cloud webhook body → our compact events. Own echoes (Coexistence sends our own outgoing
 * messages back with from = our number) are not "received".
 */
export const extractCloudWebhookEvents = (body = {}) => {
  const events = [];
  for (const entry of Array.isArray(body?.entry) ? body.entry : []) {
    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      const value = change?.value || {};
      const phoneNumberId = text(value?.metadata?.phone_number_id);
      const ours = text(value?.metadata?.display_phone_number).replace(/\D/g, "");
      for (const message of Array.isArray(value.messages) ? value.messages : []) {
        const from = text(message?.from);
        if (ours && from.replace(/\D/g, "") === ours) continue;
        const type = text(message?.type);
        const messageText =
          message?.text?.body ??
          message?.button?.text ??
          message?.interactive?.button_reply?.title ??
          message?.interactive?.list_reply?.title ??
          message?.image?.caption ??
          message?.video?.caption ??
          message?.document?.caption ??
          "";
        events.push({
          event: "message.received",
          phoneNumberId,
          payload: { from, message_id: text(message?.id), type, text: String(messageText ?? ""), timestamp: text(message?.timestamp) },
        });
      }
      for (const status of Array.isArray(value.statuses) ? value.statuses : []) {
        events.push({
          event: "message.status",
          phoneNumberId,
          payload: {
            message_id: text(status?.id),
            status: text(status?.status).toLowerCase(),
            recipient_id: text(status?.recipient_id),
            timestamp: text(status?.timestamp),
            ...(status?.errors?.[0] ? { error: { code: status.errors[0].code ?? null, title: text(status.errors[0].title || status.errors[0].message) } } : {}),
          },
        });
      }
    }
  }
  return events;
};

/** Called from the (already signature-verified) Meta webhook. Never throws. */
export const dispatchWhatsappCloudWebhookEvents = async ({ tenantId, body } = {}) => {
  try {
    const events = extractCloudWebhookEvents(body);
    await Promise.allSettled(events.map((item) => dispatchWhatsappEvent({ tenantId, ...item })));
  } catch {
    /* never surfaces */
  }
};

/* ------------------------------------------------------------------ rate limit */

const rateBuckets = new Map();
export const RATE_LIMIT_PER_MINUTE = 60;

/** Fixed one-minute window per key. Returns { allowed, remaining, resetMs }. */
export const takeRateLimit = (keyId, now = Date.now(), limit = RATE_LIMIT_PER_MINUTE) => {
  const id = String(keyId);
  let bucket = rateBuckets.get(id);
  if (!bucket || now - bucket.start >= 60000) {
    bucket = { start: now, count: 0 };
    rateBuckets.set(id, bucket);
  }
  bucket.count += 1;
  if (rateBuckets.size > 5000) {
    for (const [key, value] of rateBuckets) if (now - value.start >= 60000) rateBuckets.delete(key);
  }
  return { allowed: bucket.count <= limit, remaining: Math.max(0, limit - bucket.count), resetMs: Math.max(0, 60000 - (now - bucket.start)) };
};

export default {
  ensureWhatsappApiAccessSchema,
  listApiKeys,
  createApiKey,
  updateApiKey,
  deleteApiKey,
  verifyApiKey,
  listWebhooks,
  createWebhook,
  updateWebhook,
  deleteWebhook,
  testWebhook,
  dispatchWhatsappEvent,
  dispatchWhatsappCloudWebhookEvents,
  sendApiText,
  sendApiTemplate,
  listWhatsappAccounts,
};
