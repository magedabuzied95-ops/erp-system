// Phase 14 scaffolding: the single gate every future Amazon WRITE must pass
// (inventory → Amazon, price → Amazon, listing create/update).
// While AMAZON_WRITE_SYNC_ENABLED is not "true" nothing is sent - the call is refused and audited.
// No write operation is implemented yet; this file only defines the contract.

import { amazonFlags } from "./amazonConfig.js";
import { AMAZON_AUDIT_EVENTS, auditAmazon } from "./amazonAudit.js";
import { AMAZON_ERROR_CATEGORY, AmazonApiError } from "./amazonErrors.js";

export const AMAZON_WRITE_OPERATIONS = Object.freeze({
  INVENTORY_UPDATE: "inventory_update",
  PRICE_UPDATE: "price_update",
  LISTING_CREATE: "listing_create",
  LISTING_UPDATE: "listing_update",
});

export const isAmazonWriteSyncEnabled = () => amazonFlags().writeSync === true;

export const assertAmazonWriteAllowed = async ({ operation, req = null, tenantId = null, details = {} }) => {
  if (!Object.values(AMAZON_WRITE_OPERATIONS).includes(operation)) {
    throw new AmazonApiError(`unknown Amazon write operation ${operation}`, { category: AMAZON_ERROR_CATEGORY.INVALID_REQUEST, status: 400 });
  }
  if (!isAmazonWriteSyncEnabled()) {
    await auditAmazon({ req, tenantId, eventType: AMAZON_AUDIT_EVENTS.WRITE_BLOCKED, outcome: "denied", details: { operation, ...details } });
    throw new AmazonApiError("Amazon write synchronization is disabled (AMAZON_WRITE_SYNC_ENABLED=false)", {
      category: AMAZON_ERROR_CATEGORY.WRITE_DISABLED,
      status: 403,
      code: "AMAZON_WRITE_DISABLED",
      operation,
    });
  }
  return true;
};

// Express middleware for any future write endpoint.
export const requireAmazonWriteEnabled = (operation) => async (req, res, next) => {
  try {
    await assertAmazonWriteAllowed({ operation, req, tenantId: req.user?.tenant_id ?? null });
    return next();
  } catch (error) {
    return res.status(error.status || 403).json({ success: false, code: error.code || "AMAZON_WRITE_DISABLED", message: error.message });
  }
};
