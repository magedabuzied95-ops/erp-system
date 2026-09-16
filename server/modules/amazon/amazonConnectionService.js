// Connection health: one Sellers API call. Returns and stores status only - never credentials.

import db from "../../database/db.js";
import {
  AMAZON_DEFAULTS,
  amazonCredentialPresence,
  amazonFlags,
  amazonMarketplaceId,
  amazonSellerIdFromEnv,
  isAmazonConfigured,
} from "./amazonConfig.js";
import { getMarketplaceParticipations } from "./amazonApi.js";
import { AMAZON_ERROR_CATEGORY, AmazonApiError, redactAmazonText, toSafeError } from "./amazonErrors.js";
import { getAmazonSpApiClient } from "./amazonSpApiClient.js";
import { latestRunsByJob } from "./amazonSyncRuns.js";

const upsertState = async (tenantId, fields, database = db) => {
  const columns = Object.keys(fields);
  const values = Object.values(fields);
  await database.query(
    `INSERT INTO amazon_connection_state (tenant_id, marketplace_id, ${columns.join(", ")}, updated_at)
     VALUES ($1, $2, ${columns.map((_, index) => `$${index + 3}`).join(", ")}, NOW())
     ON CONFLICT (tenant_id, marketplace_id)
     DO UPDATE SET ${columns.map((column) => `${column} = EXCLUDED.${column}`).join(", ")}, updated_at = NOW()`,
    [tenantId, amazonMarketplaceId(), ...values]
  );
};

export const readConnectionState = async ({ tenantId, database = db }) => {
  const result = await database.query(
    `SELECT status, marketplace_name, country_code, currency_code, store_name, seller_id,
            is_participating, has_suspended_listings, last_checked_at, last_success_at,
            last_error_at, last_error_category, last_error_code, last_error_message, updated_at
     FROM amazon_connection_state WHERE tenant_id = $1 AND marketplace_id = $2`,
    [tenantId, amazonMarketplaceId()]
  );
  return result.rows[0] || null;
};

export const resolveSellerId = async ({ tenantId, database = db }) =>
  amazonSellerIdFromEnv() || (await readConnectionState({ tenantId, database }))?.seller_id || "";

export const saveSellerId = async ({ tenantId, sellerId, database = db }) => {
  const clean = String(sellerId || "").trim().toUpperCase();
  if (clean && !/^[A-Z0-9]{8,20}$/.test(clean)) {
    throw new AmazonApiError("Seller ID must be 8-20 letters/digits (Seller Central → Settings → Account Info → Merchant Token)", {
      category: AMAZON_ERROR_CATEGORY.INVALID_REQUEST,
    });
  }
  await upsertState(tenantId, { seller_id: clean || null }, database);
  return clean;
};

export const testAmazonConnection = async ({ tenantId, spApi = null, database = db }) => {
  const checkedAt = new Date();
  if (!isAmazonConfigured()) {
    const error = new AmazonApiError("Amazon SP-API credentials are not configured on the server", { category: AMAZON_ERROR_CATEGORY.NOT_CONFIGURED });
    await upsertState(tenantId, {
      status: "not_configured",
      last_checked_at: checkedAt,
      last_error_at: checkedAt,
      last_error_category: error.category,
      last_error_code: null,
      last_error_message: error.message,
    }, database);
    return { ok: false, status: "not_configured", error: error.toSafeJSON() };
  }
  try {
    const participations = await getMarketplaceParticipations({ spApi });
    const match = participations.find((entry) => entry?.marketplace?.id === amazonMarketplaceId());
    if (!match) {
      throw new AmazonApiError(`the authorized seller does not participate in marketplace ${amazonMarketplaceId()}`, {
        category: AMAZON_ERROR_CATEGORY.AUTHORIZATION,
        operation: "getMarketplaceParticipations",
      });
    }
    const participating = match.participation?.isParticipating === true;
    const fields = {
      status: participating ? "connected" : "not_participating",
      marketplace_name: redactAmazonText(match.marketplace?.name || AMAZON_DEFAULTS.marketplaceName, 80),
      country_code: redactAmazonText(match.marketplace?.countryCode || AMAZON_DEFAULTS.countryCode, 8),
      currency_code: redactAmazonText(match.marketplace?.defaultCurrencyCode || AMAZON_DEFAULTS.currencyCode, 8),
      store_name: redactAmazonText(match.storeName || "", 120) || null,
      is_participating: participating,
      has_suspended_listings: match.participation?.hasSuspendedListings === true,
      last_checked_at: checkedAt,
      last_success_at: checkedAt,
    };
    await upsertState(tenantId, fields, database);
    return { ok: participating, status: fields.status, marketplace: { id: amazonMarketplaceId(), name: fields.marketplace_name, country_code: fields.country_code, currency_code: fields.currency_code }, is_participating: participating, has_suspended_listings: fields.has_suspended_listings };
  } catch (error) {
    const safe = toSafeError(error);
    const status = safe.category === AMAZON_ERROR_CATEGORY.AUTHENTICATION || safe.category === AMAZON_ERROR_CATEGORY.AUTHORIZATION ? "authorization_error" : "error";
    await upsertState(tenantId, {
      status,
      last_checked_at: checkedAt,
      last_error_at: checkedAt,
      last_error_category: safe.category,
      last_error_code: safe.code,
      last_error_message: safe.message,
    }, database);
    return { ok: false, status, error: safe };
  }
};

// Everything the Settings / Dashboard page needs, with no secret in it.
export const getAmazonStatus = async ({ tenantId, database = db, spApi = null }) => {
  const state = await readConnectionState({ tenantId, database });
  const client = spApi || getAmazonSpApiClient();
  const clientStatus = client.status();
  const flags = amazonFlags();
  return {
    configured: isAmazonConfigured(),
    credentials_present: amazonCredentialPresence(),
    marketplace: {
      id: amazonMarketplaceId(),
      name: state?.marketplace_name || AMAZON_DEFAULTS.marketplaceName,
      country_code: state?.country_code || AMAZON_DEFAULTS.countryCode,
      currency_code: state?.currency_code || AMAZON_DEFAULTS.currencyCode,
    },
    connection: {
      status: state?.status || "unknown",
      authorization_status: state?.status === "connected" ? "active" : state?.status === "authorization_error" ? "failed" : "unknown",
      store_name: state?.store_name || null,
      is_participating: state?.is_participating ?? null,
      has_suspended_listings: state?.has_suspended_listings ?? null,
      last_checked_at: state?.last_checked_at || null,
      last_success_at: state?.last_success_at || null,
      last_error_at: state?.last_error_at || null,
      last_error: state?.last_error_category
        ? { category: state.last_error_category, code: state.last_error_code, message: state.last_error_message }
        : null,
      last_successful_api_request_at: clientStatus.lastSuccessAt || state?.last_success_at || null,
    },
    seller_id_configured: Boolean(amazonSellerIdFromEnv() || state?.seller_id),
    seller_id: amazonSellerIdFromEnv() || state?.seller_id || null,
    flags: {
      order_auto_sync: flags.orderAutoSync,
      order_auto_sync_minutes: flags.orderAutoSyncMinutes,
      order_projection: flags.orderProjection,
      write_sync: flags.writeSync,
    },
    sync: await latestRunsByJob({ tenantId, database }),
  };
};
