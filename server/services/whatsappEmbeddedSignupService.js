/*
 * WhatsApp Embedded Signup — the server half.
 *
 * The browser never sees a token. It runs Meta's Embedded Signup dialog, gets back a short-lived
 * authorization CODE, and posts that here; everything from the exchange onwards happens on this
 * side with the app secret, and what goes back to the UI is the connection's identity — never the
 * token, not even a prefix of it.
 *
 * COEXISTENCE — WHAT THIS FILE DELIBERATELY DOES NOT DO
 * ----------------------------------------------------
 * The number being connected is already live in the WhatsApp Business app. Registering a number
 * on Cloud API (POST /{phone_number_id}/register) is what takes it OFF that app, and it is a
 * one-way door: the phone loses the account. So this file never calls register, never calls
 * deregister, and never calls migration. Whether the number ends up Cloud-API-only or running in
 * coexistence is Meta's decision during the dialog, and all we do is READ the result back and
 * record it, so the operator can see which of the two they got.
 *
 * Reading is done through platform_type on the phone number, which is the field that tells them
 * apart. It is stored verbatim alongside our own classification, because a field we do not
 * recognise is more useful kept than collapsed into "unknown".
 */

import crypto from "node:crypto";

import db from "../database/db.js";
import {
  describeWhatsappCloudEncryptionKey,
  encryptWhatsappCloudSecret,
  maskAccessToken,
  tryDecryptWhatsappCloudSecret,
} from "./whatsappCloudCryptoService.js";

const GRAPH_HOST = "https://graph.facebook.com";
const DEFAULT_GRAPH_VERSION = "v20.0";
const SIGNUP_STATE_TTL_MS = 10 * 60 * 1000;

const text = (value, fallback = "") => String(value ?? fallback).trim();

export class EmbeddedSignupError extends Error {
  constructor(code, message, status = 400, details = null) {
    super(message || code);
    this.name = "EmbeddedSignupError";
    this.code = code;
    this.status = status;
    if (details) this.details = details;
  }
}

export const embeddedSignupConfig = () => ({
  appId: text(process.env.META_APP_ID),
  appSecret: text(process.env.META_APP_SECRET),
  configId: text(process.env.META_WHATSAPP_CONFIG_ID),
  graphVersion: text(process.env.META_GRAPH_VERSION) || DEFAULT_GRAPH_VERSION,
});

/*
 * What the browser is allowed to know: the app id and the config id, both of which are public by
 * design (they travel in the dialog URL). The secret is never part of this shape, and a test
 * pins that.
 */
export const publicEmbeddedSignupConfig = () => {
  const config = embeddedSignupConfig();
  return {
    app_id: config.appId,
    config_id: config.configId,
    graph_version: config.graphVersion,
    configured: Boolean(config.appId && config.appSecret && config.configId),
    app_secret_configured: Boolean(config.appSecret),
    encryption: describeWhatsappCloudEncryptionKey(),
  };
};

let schemaReadyPromise = null;

/*
 * Lazy on purpose. DDL at import time is how a bad migration bricks the boot for every other
 * feature; nothing here runs until an operator actually opens the integration.
 */
export const ensureWhatsappCloudIntegrationSchema = async (clientOrPool = db) => {
  const run = async () => {
    await clientOrPool.query(`
      CREATE TABLE IF NOT EXISTS whatsapp_cloud_integrations (
        id BIGSERIAL PRIMARY KEY,
        tenant_id BIGINT NOT NULL DEFAULT 0,
        provider VARCHAR(32) NOT NULL DEFAULT 'whatsapp_cloud',
        waba_id VARCHAR(64) NOT NULL,
        phone_number_id VARCHAR(64) NOT NULL,
        display_phone_number VARCHAR(64),
        verified_name TEXT,
        business_id VARCHAR(64),
        access_token_encrypted TEXT,
        token_expires_at TIMESTAMPTZ NULL,
        status VARCHAR(32) NOT NULL DEFAULT 'connected',
        platform_type VARCHAR(48),
        coexistence_state VARCHAR(48),
        quality_rating VARCHAR(24),
        webhook_subscribed BOOLEAN NOT NULL DEFAULT FALSE,
        onboarding_result JSONB NOT NULL DEFAULT '{}'::jsonb,
        connected_by_user_id BIGINT NULL,
        connected_at TIMESTAMPTZ NULL,
        disconnected_at TIMESTAMPTZ NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_whatsapp_cloud_integration UNIQUE (tenant_id, waba_id, phone_number_id)
      )
    `);
    // Reconnecting the same number must find its row, and the webhook looks it up by phone id.
    await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_whatsapp_cloud_phone_number_id ON whatsapp_cloud_integrations (phone_number_id)`);
    await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_whatsapp_cloud_waba_id ON whatsapp_cloud_integrations (waba_id)`);
    await clientOrPool.query(`
      CREATE TABLE IF NOT EXISTS whatsapp_cloud_signup_states (
        state CHAR(64) PRIMARY KEY,
        tenant_id BIGINT NOT NULL DEFAULT 0,
        user_id BIGINT NULL,
        used_at TIMESTAMPTZ NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
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

/* ── CSRF: a one-time state the dialog run must echo back ──────────────────────────────────── */

export const issueSignupState = async ({ tenantId = 0, userId = null } = {}) => {
  await ensureWhatsappCloudIntegrationSchema();
  const state = crypto.randomBytes(32).toString("hex");
  await db.query(
    `INSERT INTO whatsapp_cloud_signup_states (state, tenant_id, user_id, expires_at) VALUES ($1, $2, $3, NOW() + make_interval(secs => $4))`,
    [state, Number(tenantId) || 0, userId ? Number(userId) : null, Math.round(SIGNUP_STATE_TTL_MS / 1000)]
  );
  return state;
};

/*
 * Single use, and consumed by the same UPDATE that checks it — two callbacks racing the same
 * state cannot both win.
 */
export const consumeSignupState = async ({ state = "", tenantId = 0 } = {}) => {
  await ensureWhatsappCloudIntegrationSchema();
  const safeState = text(state);
  if (!safeState) return false;
  const result = await db.query(
    `
    UPDATE whatsapp_cloud_signup_states
    SET used_at = NOW()
    WHERE state = $1
      AND tenant_id = $2
      AND used_at IS NULL
      AND expires_at > NOW()
    RETURNING state
    `,
    [safeState, Number(tenantId) || 0]
  );
  return result.rowCount > 0;
};

/* ── Graph ─────────────────────────────────────────────────────────────────────────────────── */

const graph = async ({ path, method = "GET", accessToken = "", body = null, timeoutMs = 15000 }) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  let payload;
  try {
    response = await fetch(`${GRAPH_HOST}${path}`, {
      method,
      headers: {
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal,
    });
    const raw = await response.text();
    try {
      payload = raw ? JSON.parse(raw) : {};
    } catch {
      payload = { raw };
    }
  } catch (networkError) {
    throw new EmbeddedSignupError(
      networkError?.name === "AbortError" ? "META_GRAPH_TIMEOUT" : "META_GRAPH_UNREACHABLE",
      networkError?.name === "AbortError" ? "Meta Graph API timed out" : "Meta Graph API is unreachable",
      504
    );
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    const graphError = payload?.error || {};
    throw new EmbeddedSignupError(
      "META_GRAPH_ERROR",
      text(graphError.message) || `Meta Graph API returned ${response.status}`,
      response.status >= 500 ? 502 : 400,
      {
        graph_code: graphError.code ?? null,
        graph_subcode: graphError.error_subcode ?? null,
        graph_type: text(graphError.type),
        fbtrace_id: text(graphError.fbtrace_id),
      }
    );
  }
  return payload;
};

/*
 * The exchange. Embedded Signup hands back a business token that does not expire, so an absent
 * expires_in is normal and is recorded as NULL rather than being turned into a fake deadline.
 */
export const exchangeAuthorizationCode = async (code = "") => {
  const config = embeddedSignupConfig();
  if (!config.appId) throw new EmbeddedSignupError("META_APP_ID_MISSING", "META_APP_ID is not configured", 409);
  if (!config.appSecret) throw new EmbeddedSignupError("META_APP_SECRET_MISSING", "META_APP_SECRET is not configured", 409);
  const safeCode = text(code);
  if (!safeCode) throw new EmbeddedSignupError("AUTH_CODE_REQUIRED", "The authorization code is required", 400);

  const params = new URLSearchParams({
    client_id: config.appId,
    client_secret: config.appSecret,
    code: safeCode,
  });
  const payload = await graph({ path: `/${config.graphVersion}/oauth/access_token?${params.toString()}` });
  const accessToken = text(payload?.access_token);
  if (!accessToken) throw new EmbeddedSignupError("META_TOKEN_MISSING", "Meta did not return an access token", 502);
  const expiresIn = Number(payload?.expires_in || 0);
  return {
    accessToken,
    tokenType: text(payload?.token_type) || "bearer",
    expiresAt: Number.isFinite(expiresIn) && expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000) : null,
  };
};

/*
 * Which of the two the operator actually got.
 *
 * platform_type is Meta's own answer. CLOUD_API alone means the number lives only on the
 * platform; a coexistence onboarding reports the number as still being on the Business app. An
 * unrecognised value is reported as-is rather than guessed at, because guessing here would tell
 * the operator their phone is safe when it might not be.
 */
export const classifyCoexistence = (phoneNumber = {}) => {
  const platformType = text(phoneNumber?.platform_type).toUpperCase();
  const onBusinessApp = phoneNumber?.is_on_biz_app === true || platformType === "SMB_APP" || platformType === "BUSINESS_APP";
  if (onBusinessApp) return "business_app_coexistence";
  if (platformType === "CLOUD_API") return "cloud_api_only";
  if (platformType === "ON_PREMISE") return "on_premise";
  if (!platformType) return "unknown";
  return `unrecognised:${platformType.toLowerCase()}`;
};

/*
 * Read back what the dialog connected. Read-only: every call here is a GET, so nothing about the
 * number's registration can change as a side effect of us looking at it.
 */
export const fetchConnectedAssets = async ({ accessToken = "", wabaId = "", phoneNumberId = "" } = {}) => {
  const config = embeddedSignupConfig();
  const safeWabaId = text(wabaId);
  if (!safeWabaId) throw new EmbeddedSignupError("WABA_ID_REQUIRED", "The WhatsApp Business Account id is required", 400);

  const waba = await graph({
    path: `/${config.graphVersion}/${safeWabaId}?fields=${encodeURIComponent("id,name,account_review_status,business_verification_status,owner_business_info,timezone_id,currency")}`,
    accessToken,
  });

  const numbers = await graph({
    path: `/${config.graphVersion}/${safeWabaId}/phone_numbers?fields=${encodeURIComponent("id,display_phone_number,verified_name,quality_rating,code_verification_status,platform_type,status,throughput")}`,
    accessToken,
  });
  const list = Array.isArray(numbers?.data) ? numbers.data : [];
  const wanted = text(phoneNumberId);
  // The dialog may report a number the token cannot see yet; falling back to the first keeps a
  // connection usable rather than failing the whole flow on a mismatch.
  const phoneNumber = (wanted && list.find((row) => text(row.id) === wanted)) || list[0] || null;

  return {
    waba: {
      id: text(waba?.id) || safeWabaId,
      name: text(waba?.name),
      account_review_status: text(waba?.account_review_status),
      business_verification_status: text(waba?.business_verification_status),
      business_id: text(waba?.owner_business_info?.id),
      business_name: text(waba?.owner_business_info?.name),
    },
    phoneNumber: phoneNumber
      ? {
        id: text(phoneNumber.id),
        display_phone_number: text(phoneNumber.display_phone_number),
        verified_name: text(phoneNumber.verified_name),
        quality_rating: text(phoneNumber.quality_rating),
        code_verification_status: text(phoneNumber.code_verification_status),
        platform_type: text(phoneNumber.platform_type),
        status: text(phoneNumber.status),
        throughput_level: text(phoneNumber?.throughput?.level),
      }
      : null,
    phoneNumbers: list.map((row) => ({ id: text(row.id), display_phone_number: text(row.display_phone_number), platform_type: text(row.platform_type) })),
    coexistence: classifyCoexistence(phoneNumber || {}),
    phone_number_mismatch: Boolean(wanted && phoneNumber && text(phoneNumber.id) !== wanted),
  };
};

/*
 * Subscribe the app to the WABA's webhooks. This is the one non-GET call in the flow, and it is
 * safe: it attaches our app to the account's event stream and touches nothing about how the
 * number is registered.
 */
export const subscribeWabaWebhooks = async ({ accessToken = "", wabaId = "" } = {}) => {
  const config = embeddedSignupConfig();
  const safeWabaId = text(wabaId);
  if (!safeWabaId) return { subscribed: false, reason: "waba_id_missing" };
  try {
    const result = await graph({
      path: `/${config.graphVersion}/${safeWabaId}/subscribed_apps`,
      method: "POST",
      accessToken,
    });
    return { subscribed: result?.success === true, raw: result };
  } catch (error) {
    // A failed subscription is not a failed connection: the operator can retry it, and the row
    // records that it did not happen rather than implying it did.
    console.warn("[whatsapp-cloud:subscribe-failed]", { waba_id: safeWabaId, code: error?.code || "", message: error?.message || String(error) });
    return { subscribed: false, reason: error?.code || "subscribe_failed", error: error?.message || String(error) };
  }
};

export const listWabaSubscriptions = async ({ accessToken = "", wabaId = "" } = {}) => {
  const config = embeddedSignupConfig();
  try {
    const result = await graph({ path: `/${config.graphVersion}/${text(wabaId)}/subscribed_apps`, accessToken });
    return Array.isArray(result?.data) ? result.data : [];
  } catch {
    return [];
  }
};

/* ── Storage ───────────────────────────────────────────────────────────────────────────────── */

/*
 * The shape the UI is allowed to see. The token column is not in it, in any form — a masked token
 * is still a token fragment, and the UI has no use for one.
 */
export const publicIntegrationShape = (row = null) => {
  if (!row) return null;
  return {
    id: String(row.id),
    provider: row.provider,
    waba_id: row.waba_id,
    phone_number_id: row.phone_number_id,
    display_phone_number: row.display_phone_number || "",
    verified_name: row.verified_name || "",
    business_id: row.business_id || "",
    status: row.status,
    platform_type: row.platform_type || "",
    coexistence_state: row.coexistence_state || "",
    quality_rating: row.quality_rating || "",
    webhook_subscribed: row.webhook_subscribed === true,
    token_present: Boolean(row.access_token_encrypted),
    token_expires_at: row.token_expires_at,
    connected_at: row.connected_at,
    disconnected_at: row.disconnected_at,
    updated_at: row.updated_at,
    onboarding_result: row.onboarding_result || {},
  };
};

/*
 * Reconnecting the same number updates its row rather than adding a second one, and nothing about
 * the conversation history is keyed on this table — threads are keyed by phone, so a reconnect
 * leaves every existing conversation exactly where it was.
 */
export const upsertIntegration = async ({
  tenantId = 0,
  wabaId,
  phoneNumberId,
  displayPhoneNumber = "",
  verifiedName = "",
  businessId = "",
  accessToken = "",
  tokenExpiresAt = null,
  platformType = "",
  coexistenceState = "",
  qualityRating = "",
  webhookSubscribed = false,
  onboardingResult = {},
  connectedByUserId = null,
} = {}) => {
  await ensureWhatsappCloudIntegrationSchema();
  const encrypted = accessToken ? encryptWhatsappCloudSecret(accessToken) : "";
  const result = await db.query(
    `
    INSERT INTO whatsapp_cloud_integrations (
      tenant_id, provider, waba_id, phone_number_id, display_phone_number, verified_name,
      business_id, access_token_encrypted, token_expires_at, status, platform_type,
      coexistence_state, quality_rating, webhook_subscribed, onboarding_result,
      connected_by_user_id, connected_at, disconnected_at, created_at, updated_at
    )
    VALUES ($1, 'whatsapp_cloud', $2, $3, $4, $5, $6, $7, $8, 'connected', $9, $10, $11, $12, $13::jsonb, $14, NOW(), NULL, NOW(), NOW())
    ON CONFLICT ON CONSTRAINT uq_whatsapp_cloud_integration DO UPDATE SET
      display_phone_number = EXCLUDED.display_phone_number,
      verified_name = EXCLUDED.verified_name,
      business_id = EXCLUDED.business_id,
      -- A reconnect that somehow produced no token must not wipe the working one.
      access_token_encrypted = COALESCE(NULLIF(EXCLUDED.access_token_encrypted, ''), whatsapp_cloud_integrations.access_token_encrypted),
      token_expires_at = EXCLUDED.token_expires_at,
      status = 'connected',
      platform_type = EXCLUDED.platform_type,
      coexistence_state = EXCLUDED.coexistence_state,
      quality_rating = EXCLUDED.quality_rating,
      webhook_subscribed = EXCLUDED.webhook_subscribed,
      onboarding_result = EXCLUDED.onboarding_result,
      connected_by_user_id = EXCLUDED.connected_by_user_id,
      connected_at = COALESCE(whatsapp_cloud_integrations.connected_at, NOW()),
      disconnected_at = NULL,
      updated_at = NOW()
    RETURNING *
    `,
    [
      Number(tenantId) || 0,
      text(wabaId),
      text(phoneNumberId),
      text(displayPhoneNumber),
      text(verifiedName),
      text(businessId),
      encrypted,
      tokenExpiresAt,
      text(platformType),
      text(coexistenceState),
      text(qualityRating),
      webhookSubscribed === true,
      JSON.stringify(onboardingResult || {}),
      connectedByUserId ? Number(connectedByUserId) : null,
    ]
  );
  return result.rows[0] || null;
};

export const listIntegrations = async ({ tenantId = 0 } = {}) => {
  await ensureWhatsappCloudIntegrationSchema();
  const result = await db.query(
    `SELECT * FROM whatsapp_cloud_integrations WHERE tenant_id = $1 ORDER BY updated_at DESC`,
    [Number(tenantId) || 0]
  );
  return result.rows;
};

export const findIntegrationByPhoneNumberId = async (phoneNumberId = "") => {
  await ensureWhatsappCloudIntegrationSchema();
  const safeId = text(phoneNumberId);
  if (!safeId) return null;
  const result = await db.query(
    `SELECT * FROM whatsapp_cloud_integrations WHERE phone_number_id = $1 AND status = 'connected' ORDER BY updated_at DESC LIMIT 1`,
    [safeId]
  );
  return result.rows[0] || null;
};

export const findIntegrationByWabaId = async (wabaId = "") => {
  await ensureWhatsappCloudIntegrationSchema();
  const safeId = text(wabaId);
  if (!safeId) return null;
  const result = await db.query(
    `SELECT * FROM whatsapp_cloud_integrations WHERE waba_id = $1 AND status = 'connected' ORDER BY updated_at DESC LIMIT 1`,
    [safeId]
  );
  return result.rows[0] || null;
};

export const integrationAccessToken = (row = null) =>
  row?.access_token_encrypted ? tryDecryptWhatsappCloudSecret(row.access_token_encrypted, { integration_id: row.id }) : "";

/*
 * Disconnect means: this ERP stops using the connection. It does NOT touch Meta.
 *
 * Nothing here calls deregister, and nothing deletes the WABA or the number — the operator's
 * WhatsApp account is untouched and can be reconnected by running the dialog again. The row is
 * kept (status flipped, token dropped) so the history of what was connected survives.
 */
export const disconnectIntegration = async ({ tenantId = 0, id = null } = {}) => {
  await ensureWhatsappCloudIntegrationSchema();
  const result = await db.query(
    `
    UPDATE whatsapp_cloud_integrations
    SET status = 'disconnected',
        access_token_encrypted = '',
        webhook_subscribed = FALSE,
        disconnected_at = NOW(),
        updated_at = NOW()
    WHERE tenant_id = $1 ${id ? "AND id = $2" : ""}
    RETURNING *
    `,
    id ? [Number(tenantId) || 0, Number(id)] : [Number(tenantId) || 0]
  );
  return result.rows;
};

/* ── The flow ──────────────────────────────────────────────────────────────────────────────── */

export const completeEmbeddedSignup = async ({
  code = "",
  wabaId = "",
  phoneNumberId = "",
  businessId = "",
  tenantId = 0,
  userId = null,
  signupEvent = null,
} = {}) => {
  const encryption = describeWhatsappCloudEncryptionKey();
  if (!encryption.ok) {
    // Refuse BEFORE the exchange: a token we cannot store safely must never be fetched at all.
    throw new EmbeddedSignupError(encryption.code, "The WhatsApp Cloud encryption key is not configured", 409);
  }

  const { accessToken, expiresAt } = await exchangeAuthorizationCode(code);
  console.info("[whatsapp-cloud:code-exchanged]", {
    tenant_id: tenantId,
    user_id: userId,
    token: maskAccessToken(accessToken),
    expires_at: expiresAt,
  });

  const assets = await fetchConnectedAssets({ accessToken, wabaId, phoneNumberId });
  const resolvedWabaId = assets.waba.id;
  const resolvedPhoneNumberId = assets.phoneNumber?.id || text(phoneNumberId);
  if (!resolvedPhoneNumberId) {
    throw new EmbeddedSignupError("PHONE_NUMBER_NOT_FOUND", "Meta returned no phone number for this WhatsApp Business Account", 400);
  }

  const subscription = await subscribeWabaWebhooks({ accessToken, wabaId: resolvedWabaId });

  const onboardingResult = {
    at: new Date().toISOString(),
    coexistence: assets.coexistence,
    platform_type: assets.phoneNumber?.platform_type || "",
    phone_number_status: assets.phoneNumber?.status || "",
    code_verification_status: assets.phoneNumber?.code_verification_status || "",
    account_review_status: assets.waba.account_review_status,
    business_verification_status: assets.waba.business_verification_status,
    phone_number_mismatch: assets.phone_number_mismatch,
    phone_numbers_on_waba: assets.phoneNumbers.length,
    webhook_subscription: { subscribed: subscription.subscribed === true, reason: subscription.reason || "" },
    // Whatever the dialog itself reported, kept verbatim — a field we do not recognise today is
    // more useful stored than dropped.
    signup_event: signupEvent && typeof signupEvent === "object" ? signupEvent : null,
  };

  const row = await upsertIntegration({
    tenantId,
    wabaId: resolvedWabaId,
    phoneNumberId: resolvedPhoneNumberId,
    displayPhoneNumber: assets.phoneNumber?.display_phone_number || "",
    verifiedName: assets.phoneNumber?.verified_name || "",
    businessId: text(businessId) || assets.waba.business_id,
    accessToken,
    tokenExpiresAt: expiresAt,
    platformType: assets.phoneNumber?.platform_type || "",
    coexistenceState: assets.coexistence,
    qualityRating: assets.phoneNumber?.quality_rating || "",
    webhookSubscribed: subscription.subscribed === true,
    onboardingResult,
    connectedByUserId: userId,
  });

  console.info("[whatsapp-cloud:connected]", {
    tenant_id: tenantId,
    waba_id: resolvedWabaId,
    phone_number_id: resolvedPhoneNumberId,
    coexistence: assets.coexistence,
    platform_type: assets.phoneNumber?.platform_type || "",
    webhook_subscribed: subscription.subscribed === true,
  });

  return { integration: publicIntegrationShape(row), onboarding: onboardingResult };
};

export default {
  embeddedSignupConfig,
  publicEmbeddedSignupConfig,
  ensureWhatsappCloudIntegrationSchema,
  issueSignupState,
  consumeSignupState,
  exchangeAuthorizationCode,
  fetchConnectedAssets,
  classifyCoexistence,
  subscribeWabaWebhooks,
  listWabaSubscriptions,
  upsertIntegration,
  listIntegrations,
  findIntegrationByPhoneNumberId,
  findIntegrationByWabaId,
  integrationAccessToken,
  disconnectIntegration,
  completeEmbeddedSignup,
  publicIntegrationShape,
  EmbeddedSignupError,
};
