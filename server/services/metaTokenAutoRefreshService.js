import db from "../database/db.js";
import { ensureMarketingSchema } from "../utils/marketingSchema.js";
import { refreshLongLivedMetaToken } from "./metaTokenService.js";

const REFRESH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

const trimString = (value) => String(value || "").trim();

const getMetaAppConfig = () => ({
  appId: trimString(process.env.META_APP_ID || process.env.FACEBOOK_APP_ID),
  appSecret: trimString(process.env.META_APP_SECRET || process.env.FACEBOOK_APP_SECRET),
});

const toDate = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const formatDateTime = (value) => {
  const date = toDate(value);
  return date ? date.toISOString() : null;
};

const buildNextCheckAt = (fromDate = new Date()) => new Date(fromDate.getTime() + CHECK_INTERVAL_MS);

const withNextCheck = (updates = {}) => ({
  ...updates,
  next_refresh_check_at: buildNextCheckAt(),
});

const getSettingsRow = async (tenantId) => {
  const result = await db.query(
    `
    SELECT *
    FROM marketing_settings
    WHERE tenant_id = $1::bigint
    LIMIT 1
    `,
    [tenantId]
  );
  return result.rows[0] || null;
};

const persistSettingsState = async (tenantId, updates = {}) => {
  const result = await db.query(
    `
    UPDATE marketing_settings
    SET
      long_lived_user_token = COALESCE($1::text, long_lived_user_token),
      page_access_token = COALESCE($2::text, page_access_token),
      token_expires_at = COALESCE($3::timestamp, token_expires_at),
      token_status = COALESCE($4::varchar, token_status),
      token_last_validated_at = COALESCE($5::timestamp, token_last_validated_at),
      token_error_message = $6::text,
      is_connected = COALESCE($7::boolean, is_connected),
      last_auto_refresh_at = COALESCE($8::timestamp, last_auto_refresh_at),
      next_refresh_check_at = COALESCE($9::timestamp, next_refresh_check_at),
      updated_at = CURRENT_TIMESTAMP
    WHERE tenant_id = $10::bigint
    RETURNING *
    `,
    [
      updates.long_lived_user_token ?? null,
      updates.page_access_token ?? null,
      updates.token_expires_at ?? null,
      updates.token_status ?? null,
      updates.token_last_validated_at ?? null,
      updates.token_error_message ?? null,
      updates.is_connected ?? null,
      updates.last_auto_refresh_at ?? null,
      updates.next_refresh_check_at ?? null,
      tenantId,
    ]
  );

  return result.rows[0] || null;
};

const hasRefreshPrerequisites = () => {
  const { appId, appSecret } = getMetaAppConfig();
  return Boolean(appId && appSecret);
};

const isRefreshDueSoon = (expiresAt) => {
  const parsed = toDate(expiresAt);
  if (!parsed) return false;
  return parsed.getTime() - Date.now() <= REFRESH_WINDOW_MS;
};

export const refreshMarketingTenantMetaToken = async ({ tenantId, force = false, source = "scheduler" } = {}) => {
  await ensureMarketingSchema();

  const settings = await getSettingsRow(tenantId);
  if (!settings) {
    console.log("[meta-refresh] skipped", { source, tenantId, reason: "settings row missing" });
    return { skipped: true, reason: "Marketing settings row not found" };
  }

  const currentToken = trimString(settings.long_lived_user_token);
  if (!currentToken) {
    console.log("[meta-refresh] skipped", { source, tenantId, reason: "missing long-lived token" });
    const updated = await persistSettingsState(tenantId, withNextCheck({
      token_last_validated_at: new Date(),
    }));
    return { skipped: true, reason: "Missing long-lived token", settings: updated };
  }

  if (!hasRefreshPrerequisites()) {
    console.log("[meta-refresh] skipped", { source, tenantId, reason: "missing Meta app credentials" });
    const updated = await persistSettingsState(tenantId, withNextCheck({
      token_last_validated_at: new Date(),
    }));
    return { skipped: true, reason: "Missing Meta app credentials", settings: updated };
  }

  if (!force && !isRefreshDueSoon(settings.token_expires_at)) {
    console.log("[meta-refresh] skipped", {
      source,
      tenantId,
      reason: "token not expiring within 7 days",
      expires_at: formatDateTime(settings.token_expires_at),
    });
    const updated = await persistSettingsState(tenantId, withNextCheck({
      token_last_validated_at: new Date(),
    }));
    return { skipped: true, reason: "Token not expiring within 7 days", settings: updated };
  }

  console.log("[meta-refresh] token refresh started", {
    source,
    tenantId,
    expires_at: formatDateTime(settings.token_expires_at),
    page_id: settings.page_id || null,
  });

  try {
    const refreshed = await refreshLongLivedMetaToken({
      longLivedUserToken: settings.long_lived_user_token,
      pageId: settings.page_id || undefined,
    });

    const updated = await persistSettingsState(tenantId, withNextCheck({
      long_lived_user_token: refreshed.longLivedUserToken,
      page_access_token: refreshed.pageAccessToken,
      token_expires_at: refreshed.tokenExpiresAt || null,
      token_status: "active",
      token_last_validated_at: new Date(),
      token_error_message: null,
      is_connected: true,
      last_auto_refresh_at: new Date(),
    }));

    console.log("[meta-refresh] token refresh success", {
      source,
      tenantId,
      new_expiry: formatDateTime(refreshed.tokenExpiresAt),
    });

    return {
      refreshed: true,
      reason: null,
      settings: updated,
      tokenExpiresAt: refreshed.tokenExpiresAt || null,
    };
  } catch (error) {
    console.error("[meta-refresh] token refresh failure", {
      source,
      tenantId,
      reason: error?.message || "Unknown refresh failure",
      status: error?.status || null,
      metaResponse: error?.metaResponse || null,
    });

    await persistSettingsState(tenantId, withNextCheck({
      token_status: "error",
      token_last_validated_at: new Date(),
      token_error_message: error?.message || "Meta token refresh failed",
    }));

    throw error;
  }
};

export const runMetaTokenAutoRefreshScan = async () => {
  await ensureMarketingSchema();
  const result = await db.query(
    `
    SELECT tenant_id
    FROM marketing_settings
    WHERE long_lived_user_token IS NOT NULL
    ORDER BY tenant_id ASC
    `
  );

  for (const row of result.rows || []) {
    try {
      await refreshMarketingTenantMetaToken({
        tenantId: row.tenant_id,
        force: false,
        source: "scheduler",
      });
    } catch (error) {
      console.error("[meta-refresh] scheduler tenant error", {
        tenantId: row.tenant_id,
        reason: error?.message || "Unknown refresh failure",
      });
    }
  }
};

let schedulerStarted = false;
let schedulerTimer = null;
let schedulerRunning = false;

export const startMetaTokenRefreshScheduler = () => {
  if (schedulerStarted) return;
  schedulerStarted = true;

  const runOnce = async () => {
    if (schedulerRunning) return;
    schedulerRunning = true;
    try {
      await runMetaTokenAutoRefreshScan();
    } catch (error) {
      console.error("[meta-refresh] scheduler scan error", error);
    } finally {
      schedulerRunning = false;
    }
  };

  console.log("[meta-refresh] scheduler started", { intervalMs: CHECK_INTERVAL_MS });
  void runOnce();
  schedulerTimer = setInterval(() => {
    void runOnce();
  }, CHECK_INTERVAL_MS);
};

export const stopMetaTokenRefreshScheduler = () => {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
  schedulerStarted = false;
  schedulerRunning = false;
};
