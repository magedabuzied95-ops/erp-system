// Amazon events in the shared security audit log. recordSecurityEvent already drops any
// detail key that looks like a secret; values are additionally redacted here.

import { recordSecurityEvent } from "../security/securityAudit.js";
import { redactAmazonText } from "./amazonErrors.js";

export const AMAZON_AUDIT_EVENTS = Object.freeze({
  CONNECTION_TEST: "amazon.connection_test",
  ORDERS_SYNC: "amazon.orders_sync",
  ORDER_IMPORTED: "amazon.order_imported",
  ORDER_UPDATED: "amazon.order_updated",
  ORDER_PROJECTED: "amazon.order_projected",
  SKU_MAPPED: "amazon.sku_mapped",
  SKU_UNMAPPED: "amazon.sku_unmapped",
  LISTINGS_READ: "amazon.listings_read",
  INVENTORY_READ: "amazon.inventory_read",
  PRICING_READ: "amazon.pricing_read",
  SYNC_FAILED: "amazon.sync_failed",
  SETTINGS_CHANGED: "amazon.settings_changed",
  WRITE_BLOCKED: "amazon.write_blocked",
  // Reserved for the future write phase (never emitted while AMAZON_WRITE_SYNC_ENABLED=false):
  INVENTORY_UPDATED: "amazon.inventory_updated",
  PRICE_UPDATED: "amazon.price_updated",
  LISTING_CREATED: "amazon.listing_created",
  LISTING_UPDATED: "amazon.listing_updated",
});

const sanitizeDetails = (details = {}) => {
  const safe = {};
  for (const [key, value] of Object.entries(details || {})) {
    if (value === undefined) continue;
    if (typeof value === "string") safe[key] = redactAmazonText(value, 200);
    else if (typeof value === "number" || typeof value === "boolean" || value === null) safe[key] = value;
    else {
      const serialized = redactAmazonText(JSON.stringify(value), 100_000);
      safe[key] = serialized.length > 2000 ? "[omitted: too large]" : JSON.parse(serialized);
    }
  }
  return safe;
};

export const auditAmazon = async ({ req = null, eventType, outcome = "success", tenantId = null, userId = null, details = {} }) => {
  let safeDetails;
  try {
    safeDetails = sanitizeDetails(details);
  } catch {
    safeDetails = { note: "details omitted" };
  }
  return recordSecurityEvent({
    req,
    eventType,
    outcome,
    tenantId: tenantId ?? req?.user?.tenant_id ?? null,
    userId: userId ?? req?.user?.id ?? null,
    actorUserId: req?.user?.id ?? null,
    details: safeDetails,
  });
};
