/*
 * WhatsApp → Connect Account: what happens AFTER Meta's Embedded Signup dialog has stored the
 * integration row (server/services/whatsappEmbeddedSignupService.js → completeEmbeddedSignup).
 *
 * Two different endings, and mixing them up is the one thing this file must never do:
 *
 *   - A NEW number (Cloud API only) has to be registered: POST /{phone_number_id}/register with
 *     the two-step-verification PIN the owner picks. Until that call succeeds the number cannot
 *     send or receive on Cloud API.
 *
 *   - A COEXISTENCE number (kept on the WhatsApp Business app) must NOT be registered — that is
 *     what would take it off the phone. Instead Meta's coexistence onboarding asks for two syncs
 *     within the first 24 hours: POST /{phone_number_id}/smb_app_data with sync_type
 *     "smb_app_state_sync" (contacts) and then "history" (chat history). Both are best-effort:
 *     their result is logged and stored, and a failure never fails the connection.
 *
 * Register lives here, not in the signup service, on purpose: the signup service is pinned by a
 * test to make no write call other than subscribed_apps, so the dialog itself can never register.
 * Registration only happens when the owner explicitly types a PIN for a number that is not on the
 * Business app.
 */

import db from "../../../database/db.js";
import {
  embeddedSignupConfig,
  ensureWhatsappCloudIntegrationSchema,
  fetchLiveNumberStatus,
  integrationAccessToken,
  listIntegrations,
  publicEmbeddedSignupConfig,
  publicIntegrationShape,
} from "../../../services/whatsappEmbeddedSignupService.js";

const GRAPH_HOST = "https://graph.facebook.com";
const COEXISTENCE_SYNC_WINDOW_MS = 24 * 60 * 60 * 1000;

const text = (value) => String(value ?? "").trim();

export const maxWhatsappNumbers = () => {
  const parsed = Number(process.env.WHATSAPP_MAX_NUMBERS || 20);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 20;
};

/* ── Schema: columns the connect page and the WABA webhooks keep up to date ───────────────── */

let connectSchemaPromise = null;
export const ensureWaConnectSchema = async () => {
  if (!connectSchemaPromise) {
    connectSchemaPromise = (async () => {
      await ensureWhatsappCloudIntegrationSchema();
      const columns = [
        "name_status VARCHAR(48)",
        "new_name_status VARCHAR(48)",
        "requested_verified_name TEXT",
        "name_rejection_reason TEXT",
        "messaging_limit_tier VARCHAR(48)",
        "quality_event VARCHAR(48)",
        "account_review_status VARCHAR(48)",
        "business_verification_status VARCHAR(48)",
        "is_official_business_account BOOLEAN",
        "last_account_event VARCHAR(64)",
        "last_account_event_at TIMESTAMPTZ NULL",
        "last_account_event_detail JSONB NOT NULL DEFAULT '{}'::jsonb",
        "disconnect_reason TEXT",
        "business_capabilities JSONB NOT NULL DEFAULT '{}'::jsonb",
        "registration_status VARCHAR(32)",
        "registration_error TEXT",
        "registered_at TIMESTAMPTZ NULL",
        "coexistence_sync JSONB NOT NULL DEFAULT '{}'::jsonb",
        "live_checked_at TIMESTAMPTZ NULL",
      ];
      for (const column of columns) {
        await db.query(`ALTER TABLE whatsapp_cloud_integrations ADD COLUMN IF NOT EXISTS ${column}`);
      }
    })().catch((error) => {
      connectSchemaPromise = null;
      throw error;
    });
  }
  return connectSchemaPromise;
};

/* ── Graph (write calls of the connect flow) ──────────────────────────────────────────────── */

export class ConnectError extends Error {
  constructor(code, message, status = 400, details = null) {
    super(message || code);
    this.code = code;
    this.status = status;
    if (details) this.details = details;
  }
}

const graphPost = async ({ path, accessToken, body, timeoutMs = 15000 }) => {
  const { graphVersion } = embeddedSignupConfig();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  let payload;
  try {
    response = await fetch(`${GRAPH_HOST}/${graphVersion}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
      signal: controller.signal,
    });
    const raw = await response.text();
    try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = { raw }; }
  } catch (error) {
    throw new ConnectError(error?.name === "AbortError" ? "META_GRAPH_TIMEOUT" : "META_GRAPH_UNREACHABLE", "Meta Graph API did not answer", 504);
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    const graphError = payload?.error || {};
    throw new ConnectError(
      "META_GRAPH_ERROR",
      text(graphError.error_user_msg) || text(graphError.message) || `Meta Graph API returned ${response.status}`,
      400,
      { graph_code: graphError.code ?? null, graph_subcode: graphError.error_subcode ?? null, fbtrace_id: text(graphError.fbtrace_id) }
    );
  }
  return payload;
};

/* ── Lookups ──────────────────────────────────────────────────────────────────────────────── */

export const findTenantIntegration = async ({ tenantId = 0, id = null } = {}) => {
  await ensureWaConnectSchema();
  const result = await db.query(
    `SELECT * FROM whatsapp_cloud_integrations WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
    [Number(tenantId) || 0, Number(id) || 0]
  );
  return result.rows[0] || null;
};

/*
 * Coexistence is decided by every signal we have, and ANY of them is enough: Meta's platform
 * classification, the dialog's own FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING event, or the owner
 * having picked the coexistence button. Wrongly treating a Business-app number as new would
 * register it — the irreversible mistake — so the test leans towards "coexistence".
 */
export const isCoexistenceIntegration = (row = {}, requestedMode = "") => {
  if (text(requestedMode) === "coexistence") return true;
  if (text(row?.coexistence_state) === "business_app_coexistence") return true;
  const event = text(row?.onboarding_result?.signup_event?.event);
  if (event === "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING") return true;
  const platform = text(row?.platform_type).toUpperCase();
  return platform === "SMB_APP" || platform === "BUSINESS_APP";
};

export const connectIntegrationShape = (row = null) => {
  if (!row) return null;
  return {
    ...publicIntegrationShape(row),
    name_status: row.name_status || "",
    new_name_status: row.new_name_status || "",
    requested_verified_name: row.requested_verified_name || "",
    name_rejection_reason: row.name_rejection_reason || "",
    messaging_limit_tier: row.messaging_limit_tier || "",
    quality_event: row.quality_event || "",
    account_review_status: row.account_review_status || "",
    business_verification_status: row.business_verification_status || "",
    is_official_business_account: row.is_official_business_account === true,
    last_account_event: row.last_account_event || "",
    last_account_event_at: row.last_account_event_at || null,
    disconnect_reason: row.disconnect_reason || "",
    business_capabilities: row.business_capabilities || {},
    registration_status: row.registration_status || "",
    registration_error: row.registration_error || "",
    registered_at: row.registered_at || null,
    coexistence_sync: row.coexistence_sync || {},
    live_checked_at: row.live_checked_at || null,
    coexistence: isCoexistenceIntegration(row),
  };
};

/* ── Live status → row ────────────────────────────────────────────────────────────────────── */

export const refreshIntegrationLiveStatus = async (row) => {
  await ensureWaConnectSchema();
  const accessToken = integrationAccessToken(row);
  if (!accessToken) return { ok: false, row, error: "token_missing" };
  try {
    const live = await fetchLiveNumberStatus({ accessToken, wabaId: row.waba_id, phoneNumberId: row.phone_number_id });
    const result = await db.query(
      `
      UPDATE whatsapp_cloud_integrations SET
        verified_name = COALESCE(NULLIF($3::text, ''), verified_name),
        display_phone_number = COALESCE(NULLIF($4::text, ''), display_phone_number),
        quality_rating = COALESCE(NULLIF($5::text, ''), quality_rating),
        name_status = NULLIF($6::text, ''),
        new_name_status = NULLIF($7::text, ''),
        messaging_limit_tier = COALESCE(NULLIF($8::text, ''), messaging_limit_tier),
        account_review_status = NULLIF($9::text, ''),
        business_verification_status = NULLIF($10::text, ''),
        is_official_business_account = $11::boolean,
        platform_type = COALESCE(NULLIF($12::text, ''), platform_type),
        webhook_subscribed = $13::boolean,
        live_checked_at = NOW(),
        updated_at = NOW()
      WHERE tenant_id = $1 AND id = $2
      RETURNING *
      `,
      [
        Number(row.tenant_id) || 0,
        Number(row.id),
        live.verified_name,
        live.display_phone_number,
        live.quality_rating,
        live.name_status,
        live.new_name_status,
        live.messaging_limit_tier,
        live.account_review_status,
        live.business_verification_status,
        live.is_official_business_account === true,
        live.platform_type,
        live.webhook_subscribed === true,
      ]
    );
    return { ok: true, row: result.rows[0] || row, live };
  } catch (error) {
    console.warn("[wa-connect:live-status-failed]", { integration_id: row.id, message: error?.message || String(error) });
    return { ok: false, row, error: error?.message || String(error) };
  }
};

/* ── Registration (new numbers only) ──────────────────────────────────────────────────────── */

// Meta answers a second register for a number that is already on Cloud API with an error whose
// text says so; that is the outcome the owner wanted, so it is reported as success.
const alreadyRegistered = (message = "") => /already\s+registered/i.test(message);

export const registerIntegrationNumber = async ({ row, pin = "" }) => {
  await ensureWaConnectSchema();
  if (isCoexistenceIntegration(row)) {
    throw new ConnectError("COEXISTENCE_NUMBER_NOT_REGISTERED", "This number runs on the WhatsApp Business app (coexistence) and must not be registered", 409);
  }
  const safePin = text(pin);
  if (!/^\d{6}$/.test(safePin)) throw new ConnectError("PIN_INVALID", "The PIN must be exactly 6 digits", 400);
  const accessToken = integrationAccessToken(row);
  if (!accessToken) throw new ConnectError("WHATSAPP_CLOUD_NOT_CONNECTED", "The number has no stored access token", 409);

  let status = "registered";
  let errorText = "";
  try {
    await graphPost({
      path: `/${encodeURIComponent(row.phone_number_id)}/register`,
      accessToken,
      body: { messaging_product: "whatsapp", pin: safePin },
    });
  } catch (error) {
    errorText = error?.message || String(error);
    status = alreadyRegistered(errorText) ? "registered" : "failed";
  }
  const result = await db.query(
    `
    UPDATE whatsapp_cloud_integrations SET
      registration_status = $3::text,
      registration_error = NULLIF($4::text, ''),
      registered_at = CASE WHEN $3::text = 'registered' THEN COALESCE(registered_at, NOW()) ELSE registered_at END,
      updated_at = NOW()
    WHERE tenant_id = $1 AND id = $2
    RETURNING *
    `,
    [Number(row.tenant_id) || 0, Number(row.id), status, errorText]
  );
  console.info("[wa-connect:register]", { integration_id: row.id, phone_number_id: row.phone_number_id, status, error: errorText.slice(0, 200) });
  return { ok: status === "registered", status, error: errorText, row: result.rows[0] || row };
};

/* ── Coexistence sync (Business-app numbers only) ─────────────────────────────────────────── */

export const requestCoexistenceSync = async ({ row }) => {
  await ensureWaConnectSchema();
  const accessToken = integrationAccessToken(row);
  const connectedAt = row.connected_at ? new Date(row.connected_at).getTime() : Date.now();
  const outcome = { requested_at: new Date().toISOString(), steps: {} };
  if (!accessToken) {
    outcome.skipped = "token_missing";
  } else if (Date.now() - connectedAt > COEXISTENCE_SYNC_WINDOW_MS) {
    // Meta only accepts these within 24h of onboarding; past that a call is pointless noise.
    outcome.skipped = "outside_24h_window";
  } else {
    for (const syncType of ["smb_app_state_sync", "history"]) {
      try {
        const payload = await graphPost({
          path: `/${encodeURIComponent(row.phone_number_id)}/smb_app_data`,
          accessToken,
          body: { messaging_product: "whatsapp", sync_type: syncType },
        });
        outcome.steps[syncType] = { ok: true, request_id: text(payload?.request_id) };
      } catch (error) {
        outcome.steps[syncType] = { ok: false, error: error?.message || String(error) };
      }
    }
  }
  console.info("[wa-connect:coexistence-sync]", { integration_id: row.id, phone_number_id: row.phone_number_id, ...outcome });
  const result = await db.query(
    `UPDATE whatsapp_cloud_integrations SET coexistence_sync = $3::jsonb, updated_at = NOW() WHERE tenant_id = $1 AND id = $2 RETURNING *`,
    [Number(row.tenant_id) || 0, Number(row.id), JSON.stringify(outcome)]
  ).catch((error) => {
    console.warn("[wa-connect:coexistence-sync-store-failed]", { integration_id: row.id, message: error?.message || String(error) });
    return { rows: [] };
  });
  return { outcome, row: result.rows[0] || row };
};

/* ── Overview for the page ────────────────────────────────────────────────────────────────── */

export const connectOverview = async ({ tenantId = 0 } = {}) => {
  await ensureWaConnectSchema();
  const rows = await listIntegrations({ tenantId });
  const numbers = rows.map(connectIntegrationShape);
  return {
    config: publicEmbeddedSignupConfig(),
    quota: { connected: rows.filter((row) => row.status === "connected").length, max: maxWhatsappNumbers() },
    numbers,
  };
};
