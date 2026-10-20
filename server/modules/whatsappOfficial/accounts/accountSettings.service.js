// Per-number settings for the official WhatsApp numbers (Genie "Accounts" form) + the Meta calls
// behind the page's action buttons. Tokens never leave the server: every Graph call resolves the
// number's own token through resolveCloudSendConfig.
import db from "../../../database/db.js";
import { cloudConfig, graphRequest, resolveCloudSendConfig } from "../../../services/whatsappCloudProvider.js";
import { ensureWhatsappCloudIntegrationSchema } from "../../../services/whatsappEmbeddedSignupService.js";
import { ensureWaAccountSettingsSchema } from "./accountSettings.schema.js";

const text = (value) => String(value ?? "").trim();
const httpError = (message, status = 400, code = "WA_ACCOUNT_ERROR") => Object.assign(new Error(message), { status, code });

export const STATUSES = ["active", "inactive", "suspended"];
export const DISTRIBUTION_STRATEGIES = ["broadcast_all", "round_robin", "least_busy", "manual"];
export const CONVERSATION_MODES = ["single_thread", "per_session"];
export const SESSION_TTLS = ["run_once", "1h", "24h", "7d", "always"];
export const AI_LANGUAGES = ["", "auto", "ar", "en", "ar-EG"];

/* ── which number does :integrationId mean ───────────────────────────────────────────────── */

/*
 * "env" = the number configured through environment variables (no integrations row).
 * Anything else must be an integrations row of THIS tenant.
 */
export const resolveAccount = async ({ tenantId = 0, integrationId = "" } = {}) => {
  const id = text(integrationId);
  if (id === "env") {
    const env = cloudConfig();
    if (!env.phoneNumberId) throw httpError("No WhatsApp number is configured", 404, "WA_ACCOUNT_NOT_FOUND");
    return { integrationId: null, phoneNumberId: env.phoneNumberId, wabaId: env.businessAccountId, source: "env", integration: null };
  }
  if (!/^\d+$/.test(id)) throw httpError("Unknown account", 404, "WA_ACCOUNT_NOT_FOUND");
  await ensureWhatsappCloudIntegrationSchema();
  const { rows } = await db.query(
    // SELECT *: the connect work adds columns (name_status, disconnect_reason, …) lazily; read what exists.
    `SELECT * FROM whatsapp_cloud_integrations WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
    [Number(id), Number(tenantId) || 0]
  );
  if (!rows[0]) throw httpError("Unknown account", 404, "WA_ACCOUNT_NOT_FOUND");
  const row = rows[0];
  return { integrationId: Number(row.id), phoneNumberId: text(row.phone_number_id), wabaId: text(row.waba_id), source: "embedded_signup", integration: row };
};

const isCoexistence = (account, settings = {}) => {
  const state = text(account?.integration?.coexistence_state);
  const platform = text(settings?.platform_type || account?.integration?.platform_type).toUpperCase();
  return state === "business_app_coexistence" || platform === "SMB_APP" || platform === "BUSINESS_APP";
};

/* ── settings row ───────────────────────────────────────────────────────────────────────────── */

const timeOut = (value) => (value ? String(value).slice(0, 5) : "");

const publicSettings = (row = {}) => ({
  account_name: row.account_name || "",
  status: row.status || "active",
  team_based_distribution: row.team_based_distribution === true,
  team_id: row.team_id ?? null,
  user_id: row.user_id != null ? Number(row.user_id) : null,
  distribution_strategy: row.distribution_strategy || "broadcast_all",
  admins: Array.isArray(row.admins) ? row.admins.map(Number).filter(Number.isFinite) : [],
  branch_id: row.branch_id != null ? Number(row.branch_id) : null,
  conversation_mode: row.conversation_mode || "single_thread",
  handled_by_ai: row.handled_by_ai !== false,
  automatic_lead: row.automatic_lead === true,
  auto_reply_active: row.auto_reply_active === true,
  auto_reply_message: row.auto_reply_message || "",
  auto_reply_start: timeOut(row.auto_reply_start),
  auto_reply_end: timeOut(row.auto_reply_end),
  chatbot_flow_enabled: row.chatbot_flow_enabled === true,
  chatbot_flow_id: row.chatbot_flow_id != null ? Number(row.chatbot_flow_id) : null,
  session_ttl: row.session_ttl || "run_once",
  active_during_campaign: row.active_during_campaign === true,
  stickers: Array.isArray(row.stickers) ? row.stickers : [],
  ai_workflow_id: row.ai_workflow_id != null ? Number(row.ai_workflow_id) : null,
  comment_workflow_id: row.comment_workflow_id != null ? Number(row.comment_workflow_id) : null,
  followup_workflow_id: row.followup_workflow_id != null ? Number(row.followup_workflow_id) : null,
  ai_language: row.ai_language || "",
  image_describer: row.image_describer === true,
  audio_transcriber: row.audio_transcriber === true,
  image_description_prompt: row.image_description_prompt || "",
  ai_instructions: row.ai_instructions || "",
  send_message_ids_to_ai: row.send_message_ids_to_ai === true,
  separate_bubbles: row.separate_bubbles === true,
  usage_alerts: row.usage_alerts === true,
  meta: {
    display_name_status: row.display_name_status || "",
    new_name_status: row.new_name_status || "",
    pending_display_name: row.pending_display_name || "",
    verified_name: row.verified_name || "",
    display_phone_number: row.display_phone_number || "",
    messaging_limit_tier: row.messaging_limit_tier || "",
    quality_rating: row.quality_rating || "",
    platform_type: row.platform_type || "",
    code_verification_status: row.code_verification_status || "",
    throughput_level: row.throughput_level || "",
    insights_enabled: row.insights_enabled === true,
    blue_tick: row.blue_tick === true,
    business_profile: row.business_profile && typeof row.business_profile === "object" ? row.business_profile : {},
    disconnect_reason: row.disconnect_reason || "",
    disconnected_at: row.disconnected_at || null,
    last_status_sync_at: row.last_status_sync_at || null,
    last_status_error: row.last_status_error || "",
  },
});

const readRow = async ({ tenantId, phoneNumberId }) => {
  await ensureWaAccountSettingsSchema();
  const { rows } = await db.query(
    `SELECT * FROM wa_account_settings WHERE tenant_id = $1 AND phone_number_id = $2 LIMIT 1`,
    [Number(tenantId) || 0, text(phoneNumberId)]
  );
  return rows[0] || null;
};

// Every write goes through here so a number gets its row on first touch.
const ensureRow = async ({ tenantId, account }) => {
  await ensureWaAccountSettingsSchema();
  await db.query(
    `INSERT INTO wa_account_settings (tenant_id, phone_number_id, integration_id, account_name)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (tenant_id, phone_number_id) DO UPDATE SET integration_id = COALESCE(EXCLUDED.integration_id, wa_account_settings.integration_id)`,
    [Number(tenantId) || 0, account.phoneNumberId, account.integrationId, text(account.integration?.verified_name).slice(0, 100)]
  );
};

export const getAccountSettings = async ({ tenantId, account }) => {
  const row = await readRow({ tenantId, phoneNumberId: account.phoneNumberId });
  const settings = publicSettings(row || { account_name: text(account.integration?.verified_name) });
  // The integrations row (kept fresh by the connect work) fills what this page has not read itself.
  const integration = account.integration || {};
  const meta = settings.meta;
  const fill = (key, value) => { if (!meta[key] && value) meta[key] = value; };
  fill("display_name_status", text(integration.name_status));
  fill("new_name_status", text(integration.new_name_status));
  fill("pending_display_name", text(integration.requested_verified_name));
  fill("messaging_limit_tier", text(integration.messaging_limit_tier));
  fill("quality_rating", text(integration.quality_rating));
  fill("disconnect_reason", text(integration.disconnect_reason));
  fill("disconnected_at", integration.disconnected_at || null);
  if (integration.is_official_business_account === true) meta.blue_tick = true;
  meta.name_rejection_reason = text(integration.name_rejection_reason);
  meta.integration_status = text(integration.status);
  meta.registration_status = text(integration.registration_status);
  meta.registration_error = text(integration.registration_error);
  return {
    exists: Boolean(row),
    phone_number_id: account.phoneNumberId,
    waba_id: account.wabaId,
    source: account.source,
    coexistence: isCoexistence(account, row || {}),
    settings,
  };
};

/* ── validation (PUT) ───────────────────────────────────────────────────────────────────────── */

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const bool = (value) => value === true || value === "true" || value === 1 || value === "1";
const optionalId = (value, field) => {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw httpError(`${field} must be a positive id`, 400, "VALIDATION_ERROR");
  return number;
};
const oneOf = (value, list, field) => {
  const v = text(value);
  if (!list.includes(v)) throw httpError(`${field} must be one of: ${list.join(", ")}`, 400, "VALIDATION_ERROR");
  return v;
};
const capped = (value, max, field) => {
  const v = String(value ?? "");
  if (v.length > max) throw httpError(`${field} is longer than ${max} characters`, 400, "VALIDATION_ERROR");
  return v;
};
const time = (value, field) => {
  const v = text(value);
  if (!v) return null;
  if (!TIME_RE.test(v.slice(0, 5))) throw httpError(`${field} must be HH:MM`, 400, "VALIDATION_ERROR");
  return v.slice(0, 5);
};

// field → [column, parser]. Only these can be written; everything else in the body is ignored.
const WRITABLE = {
  account_name: (v) => capped(text(v), 100, "account_name"),
  status: (v) => oneOf(v, STATUSES, "status"),
  team_based_distribution: bool,
  team_id: (v) => optionalId(v, "team_id"),
  user_id: (v) => optionalId(v, "user_id"),
  distribution_strategy: (v) => oneOf(v, DISTRIBUTION_STRATEGIES, "distribution_strategy"),
  admins: (v) => {
    if (!Array.isArray(v)) throw httpError("admins must be a list of user ids", 400, "VALIDATION_ERROR");
    const ids = [...new Set(v.map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 50);
    return JSON.stringify(ids);
  },
  branch_id: (v) => optionalId(v, "branch_id"),
  conversation_mode: (v) => oneOf(v, CONVERSATION_MODES, "conversation_mode"),
  handled_by_ai: bool,
  automatic_lead: bool,
  auto_reply_active: bool,
  auto_reply_message: (v) => capped(v, 4096, "auto_reply_message"),
  auto_reply_start: (v) => time(v, "auto_reply_start"),
  auto_reply_end: (v) => time(v, "auto_reply_end"),
  chatbot_flow_enabled: bool,
  chatbot_flow_id: (v) => optionalId(v, "chatbot_flow_id"),
  session_ttl: (v) => oneOf(v, SESSION_TTLS, "session_ttl"),
  active_during_campaign: bool,
  ai_workflow_id: (v) => optionalId(v, "ai_workflow_id"),
  comment_workflow_id: (v) => optionalId(v, "comment_workflow_id"),
  followup_workflow_id: (v) => optionalId(v, "followup_workflow_id"),
  ai_language: (v) => oneOf(v ?? "", AI_LANGUAGES, "ai_language"),
  image_describer: bool,
  audio_transcriber: bool,
  image_description_prompt: (v) => capped(v, 4000, "image_description_prompt"),
  ai_instructions: (v) => capped(v, 8000, "ai_instructions"),
  send_message_ids_to_ai: bool,
  separate_bubbles: bool,
  usage_alerts: bool,
};
const JSONB_FIELDS = new Set(["admins"]);
const TIME_FIELDS = new Set(["auto_reply_start", "auto_reply_end"]);

export const validateSettingsPatch = (body = {}) => {
  const patch = {};
  for (const [field, parse] of Object.entries(WRITABLE)) {
    if (Object.prototype.hasOwnProperty.call(body || {}, field)) patch[field] = parse(body[field]);
  }
  const message = patch.auto_reply_message ?? null;
  if (patch.auto_reply_active === true && message !== null && !text(message)) {
    throw httpError("Write the auto reply message before turning it on", 400, "VALIDATION_ERROR");
  }
  return patch;
};

export const updateAccountSettings = async ({ tenantId, account, body }) => {
  const patch = validateSettingsPatch(body);
  await ensureRow({ tenantId, account });
  const fields = Object.keys(patch);
  if (fields.length) {
    const sets = fields.map((field, index) => {
      const param = `$${index + 3}`;
      if (JSONB_FIELDS.has(field)) return `${field} = ${param}::jsonb`;
      if (TIME_FIELDS.has(field)) return `${field} = ${param}::time`;
      return `${field} = ${param}`;
    });
    await db.query(
      `UPDATE wa_account_settings SET ${sets.join(", ")}, updated_at = NOW() WHERE tenant_id = $1 AND phone_number_id = $2`,
      [Number(tenantId) || 0, account.phoneNumberId, ...fields.map((field) => patch[field])]
    );
  }
  // A row with auto reply on but no message would never send anything — catch it after the merge.
  const row = await readRow({ tenantId, phoneNumberId: account.phoneNumberId });
  if (row?.auto_reply_active && !text(row.auto_reply_message)) {
    await db.query(`UPDATE wa_account_settings SET auto_reply_active = FALSE WHERE id = $1`, [row.id]);
    row.auto_reply_active = false;
  }
  forgetRuntimeSettings(account.phoneNumberId);
  return getAccountSettings({ tenantId, account });
};

/* ── Meta: status, display name, register, profile ──────────────────────────────────────────── */

const graphFor = async (phoneNumberId) => {
  const config = await resolveCloudSendConfig({ phoneNumberId });
  return { version: config.graphVersion, token: config.accessToken };
};

const STATUS_FIELDS = "verified_name,code_verification_status,display_phone_number,quality_rating,platform_type,throughput,name_status,new_name_status,messaging_limit_tier,is_official_business_account";

export const syncAccountStatus = async ({ tenantId, account }) => {
  await ensureRow({ tenantId, account });
  const { version, token } = await graphFor(account.phoneNumberId);
  let number;
  try {
    number = await graphRequest({ path: `/${version}/${account.phoneNumberId}?fields=${encodeURIComponent(STATUS_FIELDS)}`, accessToken: token, timeoutMs: 12000 });
  } catch (error) {
    await db.query(
      `UPDATE wa_account_settings SET last_status_error = $3, updated_at = NOW() WHERE tenant_id = $1 AND phone_number_id = $2`,
      [Number(tenantId) || 0, account.phoneNumberId, text(error?.message).slice(0, 1000)]
    ).catch(() => {});
    throw error;
  }
  const newNameStatus = text(number?.new_name_status);
  await db.query(
    `UPDATE wa_account_settings SET
        verified_name = $3, display_phone_number = $4, display_name_status = $5, new_name_status = $6::text,
        messaging_limit_tier = $7, quality_rating = $8, platform_type = $9, code_verification_status = $10,
        throughput_level = $11, blue_tick = $12, disconnected_at = $13,
        pending_display_name = CASE WHEN $6::text IN ('APPROVED', 'DECLINED', 'NONE', '') THEN '' ELSE pending_display_name END,
        last_status_sync_at = NOW(), last_status_error = '', updated_at = NOW()
      WHERE tenant_id = $1 AND phone_number_id = $2`,
    [
      Number(tenantId) || 0,
      account.phoneNumberId,
      text(number?.verified_name),
      text(number?.display_phone_number),
      text(number?.name_status),
      newNameStatus,
      text(number?.messaging_limit_tier),
      text(number?.quality_rating),
      text(number?.platform_type),
      text(number?.code_verification_status),
      text(number?.throughput?.level),
      number?.is_official_business_account === true,
      account.integration?.disconnected_at || null,
    ]
  );
  return getAccountSettings({ tenantId, account });
};

export const requestDisplayNameChange = async ({ tenantId, account, newDisplayName }) => {
  const name = text(newDisplayName);
  if (name.length < 3 || name.length > 512) throw httpError("Write the new display name (at least 3 characters)", 400, "VALIDATION_ERROR");
  await ensureRow({ tenantId, account });
  const { version, token } = await graphFor(account.phoneNumberId);
  await graphRequest({ path: `/${version}/${account.phoneNumberId}`, method: "POST", body: { new_display_name: name }, accessToken: token, timeoutMs: 15000 });
  await db.query(
    `UPDATE wa_account_settings SET pending_display_name = $3, new_name_status = 'PENDING_REVIEW', updated_at = NOW()
      WHERE tenant_id = $1 AND phone_number_id = $2`,
    [Number(tenantId) || 0, account.phoneNumberId, name]
  );
  return getAccountSettings({ tenantId, account });
};

// The PIN is used for this one call and never written anywhere (not even logs).
export const registerNumber = async ({ tenantId, account, pin }) => {
  const settings = await readRow({ tenantId, phoneNumberId: account.phoneNumberId });
  if (isCoexistence(account, settings || {})) {
    throw httpError(
      "This number is shared with the WhatsApp Business app (coexistence). It is registered by the app itself and does not need — and must not get — a Cloud API registration.",
      409,
      "WA_COEXISTENCE_NO_REGISTER"
    );
  }
  const code = text(pin);
  if (!/^\d{6}$/.test(code)) throw httpError("The PIN must be exactly 6 digits", 400, "VALIDATION_ERROR");
  const { version, token } = await graphFor(account.phoneNumberId);
  const result = await graphRequest({
    path: `/${version}/${account.phoneNumberId}/register`,
    method: "POST",
    body: { messaging_product: "whatsapp", pin: code },
    accessToken: token,
    timeoutMs: 20000,
  });
  return { success: result?.success !== false };
};

const PROFILE_FIELDS = "about,address,description,email,profile_picture_url,websites,vertical";

export const refreshBusinessProfile = async ({ tenantId, account }) => {
  await syncAccountStatus({ tenantId, account }).catch(() => null);
  const { version, token } = await graphFor(account.phoneNumberId);
  const payload = await graphRequest({
    path: `/${version}/${account.phoneNumberId}/whatsapp_business_profile?fields=${encodeURIComponent(PROFILE_FIELDS)}`,
    accessToken: token,
    timeoutMs: 12000,
  });
  const raw = Array.isArray(payload?.data) ? payload.data[0] || {} : payload || {};
  const profile = {
    about: text(raw.about),
    address: text(raw.address),
    description: text(raw.description),
    email: text(raw.email),
    profile_picture_url: text(raw.profile_picture_url),
    websites: Array.isArray(raw.websites) ? raw.websites.map(text).filter(Boolean) : [],
    vertical: text(raw.vertical),
    fetched_at: new Date().toISOString(),
  };
  await ensureRow({ tenantId, account });
  await db.query(
    `UPDATE wa_account_settings SET business_profile = $3::jsonb, updated_at = NOW() WHERE tenant_id = $1 AND phone_number_id = $2`,
    [Number(tenantId) || 0, account.phoneNumberId, JSON.stringify(profile)]
  );
  return getAccountSettings({ tenantId, account });
};

/* ── stickers ───────────────────────────────────────────────────────────────────────────────── */

export const addStickers = async ({ tenantId, account, stickers = [] }) => {
  await ensureRow({ tenantId, account });
  const row = await readRow({ tenantId, phoneNumberId: account.phoneNumberId });
  const current = Array.isArray(row?.stickers) ? row.stickers : [];
  const next = [...current, ...stickers].slice(-200);
  await db.query(
    `UPDATE wa_account_settings SET stickers = $3::jsonb, updated_at = NOW() WHERE tenant_id = $1 AND phone_number_id = $2`,
    [Number(tenantId) || 0, account.phoneNumberId, JSON.stringify(next)]
  );
  return getAccountSettings({ tenantId, account });
};

export const removeSticker = async ({ tenantId, account, stickerId }) => {
  const row = await readRow({ tenantId, phoneNumberId: account.phoneNumberId });
  const current = Array.isArray(row?.stickers) ? row.stickers : [];
  const removed = current.find((item) => text(item?.id) === text(stickerId)) || null;
  if (!removed) throw httpError("Sticker not found", 404, "STICKER_NOT_FOUND");
  await db.query(
    `UPDATE wa_account_settings SET stickers = $3::jsonb, updated_at = NOW() WHERE tenant_id = $1 AND phone_number_id = $2`,
    [Number(tenantId) || 0, account.phoneNumberId, JSON.stringify(current.filter((item) => item !== removed))]
  );
  return { removed, result: await getAccountSettings({ tenantId, account }) };
};

/* ── runtime read for the inbound path (cached 30s) ─────────────────────────────────────────── */

const RUNTIME_TTL_MS = 30 * 1000;
const runtimeCache = new Map();

export const forgetRuntimeSettings = (phoneNumberId = "") => {
  const id = text(phoneNumberId);
  for (const key of runtimeCache.keys()) if (key.endsWith(`|${id}`)) runtimeCache.delete(key);
};

/*
 * The webhook resolves its tenant on its own, which may not be the tenant the integrations row was
 * saved under (env-number installs use 0). A phone_number_id is unique at Meta, so the tenant's row
 * wins and any row for that number is the fallback.
 */
export const getRuntimeSettings = async ({ tenantId = 0, phoneNumberId = "" } = {}) => {
  const id = text(phoneNumberId);
  if (!id) return null;
  const key = `${Number(tenantId) || 0}|${id}`;
  const cached = runtimeCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  await ensureWaAccountSettingsSchema();
  const { rows } = await db.query(
    `SELECT tenant_id, phone_number_id, status, handled_by_ai, auto_reply_active, auto_reply_message,
            auto_reply_start, auto_reply_end
       FROM wa_account_settings WHERE phone_number_id = $1
      ORDER BY (tenant_id = $2) DESC, updated_at DESC LIMIT 1`,
    [id, Number(tenantId) || 0]
  );
  const value = rows[0] || null;
  runtimeCache.set(key, { value, expiresAt: Date.now() + RUNTIME_TTL_MS });
  return value;
};
