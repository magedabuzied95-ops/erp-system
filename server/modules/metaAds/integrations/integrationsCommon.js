// Small helpers shared by the integrations/ files (connect, webhooks, attribution,
// Conversions API, competitors). Nothing here talks to the browser.

import crypto from "crypto";

import db from "../../../database/db.js";
import { canonicalPhoneKey, canonicalPhoneSql } from "../../../utils/phoneSearch.js";
import { decryptSecret, metaAppConfig } from "../metaAdsGraph.js";
import { isMetaAdsSchemaReady } from "../metaAdsSchema.js";

export const text = (value) => (value === undefined || value === null ? "" : String(value).trim());
export const lower = (value) => text(value).toLowerCase();
export const clip = (value, max = 500) => text(value).slice(0, max);
export const isReady = () => isMetaAdsSchemaReady();

export const log = (label, details = {}) => console.log(`[meta-ads:${label}]`, details);
export const warn = (label, error, details = {}) =>
  console.warn(`[meta-ads:${label}]`, { ...details, message: clip(error?.message || error, 300), code: error?.code ?? undefined });

// Token failures that mean "reconnect", as Meta words them.
export const TOKEN_INVALID_RE = /(error validating access token|session has expired|has not authorized application|access token.*(invalid|expired)|oauthexception|code\s*190|not connected to facebook)/i;

export const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

// Meta wants E.164 digits without "+". The store is Egyptian, so a local mobile
// (01xxxxxxxxx / 1xxxxxxxxx) gets its 20 prefix back; anything else keeps its digits.
export const e164Digits = (phone) => {
  const key = canonicalPhoneKey(phone);
  if (!key) return "";
  if (/^1\d{9}$/.test(key)) return `20${key}`;
  return key;
};
export const hashPhone = (phone) => {
  const digits = e164Digits(phone);
  return digits ? sha256(digits) : "";
};
export const hashEmail = (email) => {
  const value = lower(email);
  return value && value.includes("@") ? sha256(value) : "";
};

// Checks X-Hub-Signature-256 against the raw body with the app secret(s).
const signatureMatches = (rawBody, header, secrets) => {
  const signature = text(header);
  if (!signature.startsWith("sha256=") || !rawBody) return false;
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody));
  const given = Buffer.from(signature.slice(7), "hex");
  return secrets.some((secret) => {
    const expected = Buffer.from(crypto.createHmac("sha256", secret).update(body).digest("hex"), "hex");
    return expected.length === given.length && crypto.timingSafeEqual(expected, given);
  });
};

const envSecrets = () => [process.env.META_ADS_APP_SECRET, metaAppConfig().appSecret].map(text).filter(Boolean);

export const verifyHubSignature = (rawBody, header) => signatureMatches(rawBody, header, envSecrets());

// Same, plus any per-account app secret saved on an ad account record (the
// "سر التطبيق" field) for tenants that use their own Meta app. Cached briefly.
let accountSecrets = { at: 0, list: [] };
const loadAccountSecrets = async () => {
  if (Date.now() - accountSecrets.at < 5 * 60 * 1000) return accountSecrets.list;
  let list = [];
  try {
    const { rows } = await db.query(
      `SELECT DISTINCT app_secret_encrypted FROM meta_ads_accounts WHERE COALESCE(app_secret_encrypted, '') <> '' LIMIT 50`,
    );
    list = rows.map((row) => decryptSecret(row.app_secret_encrypted)).filter(Boolean);
  } catch {
    list = [];
  }
  accountSecrets = { at: Date.now(), list };
  return list;
};

export const verifyHubSignatureAsync = async (rawBody, header) => {
  if (signatureMatches(rawBody, header, envSecrets())) return true;
  return signatureMatches(rawBody, header, await loadAccountSecrets());
};

// Verify tokens: env first, then any per-account "رمز التحقق من Webhook".
export const isKnownVerifyToken = async (token) => {
  const value = text(token);
  if (!value) return false;
  const env = [process.env.META_ADS_VERIFY_TOKEN, process.env.META_VERIFY_TOKEN, process.env.META_WEBHOOK_VERIFY_TOKEN].map(text).filter(Boolean);
  if (env.includes(value)) return true;
  try {
    const { rows } = await db.query(`SELECT 1 FROM meta_ads_accounts WHERE webhook_verify_token = $1 LIMIT 1`, [value]);
    return Boolean(rows[0]);
  } catch {
    return false;
  }
};

// First connected ad account of a tenant that still has a token (competitor scans,
// datasets without their own token). Returns { account, token } or null.
export const anyTenantToken = async (tenantId, { businessId = "" } = {}) => {
  const { rows } = await db.query(
    `SELECT * FROM meta_ads_accounts
      WHERE tenant_id = $1 AND COALESCE(user_access_token_encrypted, '') <> ''
        AND (token_expires_at IS NULL OR token_expires_at > NOW())
      ORDER BY (business_id IS NOT DISTINCT FROM NULLIF($2, '')) DESC, last_synced_at DESC NULLS LAST, id
      LIMIT 5`,
    [tenantId, text(businessId)],
  );
  for (const row of rows) {
    const token = decryptSecret(row.user_access_token_encrypted);
    if (token) return { account: row, token };
  }
  return null;
};

// CRM customer for a phone: the ERP keys a customer by tenant + canonical phone
// key, so the lookup goes through the same canonical form. Never creates.
export const findCustomerByPhone = async (tenantId, phone) => {
  const key = canonicalPhoneKey(phone);
  if (!key || key.length < 7) return null;
  const { rows } = await db.query(
    `SELECT id, name, phone, email FROM customers WHERE tenant_id = $1 AND ${canonicalPhoneSql("phone")} = $2 ORDER BY id LIMIT 1`,
    [tenantId, key],
  );
  return rows[0] || null;
};

// Find, else create through the ERP's own WhatsApp auto-registration (advisory
// lock per phone, so two leads with the same number never mint two customers).
export const findOrCreateCustomer = async (tenantId, { phone, name }) => {
  const existing = await findCustomerByPhone(tenantId, phone);
  if (existing) return Number(existing.id);
  if (!canonicalPhoneKey(phone)) return null;
  const { autoRegisterWhatsappCustomer } = await import("../../../services/whatsappCustomerAutoRegistrationService.js");
  const result = await autoRegisterWhatsappCustomer({ tenantId, phone: e164Digits(phone) || phone, whatsappName: name || "", avatarSource: "meta_lead" });
  return result?.customerId ? Number(result.customerId) : null;
};

export const writeAdEvent = async ({
  tenantId, accountId = null, severity = "info", webhook = "", summary = "", objectType = null, objectMetaId = null,
  campaignId = null, adId = null, processed = false, payload = null, eventTime = null,
}) => {
  const { rows } = await db.query(
    `INSERT INTO meta_ads_events (tenant_id, account_id, event_time, severity, webhook, summary, object_type, object_meta_id, campaign_id, ad_id, processed, payload)
     VALUES ($1,$2,COALESCE($3::timestamptz, NOW()),$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb) RETURNING id`,
    [tenantId, accountId, eventTime, severity, clip(webhook, 120), clip(summary, 1000), objectType, objectMetaId, campaignId, adId, processed, JSON.stringify(payload ?? null)],
  );
  return rows[0]?.id || null;
};
