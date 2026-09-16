// Amazon orders projected into `orders` are owned by Amazon: M1 must not cancel, edit, return,
// exchange, ship (Bosta) or re-stock them - none of those actions reach Amazon, and the projection
// never deducted stock, so restoring stock on cancel/return would invent inventory.

import db from "../../database/db.js";
import { EXTERNAL_MARKETPLACE_ORIGINS } from "../shipping/onlineOrderSql.js";

const lower = (value) => String(value ?? "").trim().toLowerCase();

export const isExternalMarketplaceOrder = (order = {}) =>
  EXTERNAL_MARKETPLACE_ORIGINS.includes(lower(order?.source)) || EXTERNAL_MARKETPLACE_ORIGINS.includes(lower(order?.channel));

export const marketplaceOrderLockedError = () => {
  const error = new Error("This order belongs to Amazon and is managed in Amazon Seller Central. It cannot be changed from M1.");
  error.status = 409;
  error.statusCode = 409;
  error.code = "MARKETPLACE_ORDER_LOCKED";
  return error;
};

export const lookupOrderOrigin = async (orderId, { database = db } = {}) => {
  const id = Number(orderId);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const result = await database.query("SELECT id, source, channel FROM orders WHERE id = $1 LIMIT 1", [id]);
  return result.rows[0] || null;
};

// Paths under /api/orders/:id that stay allowed for an Amazon order (read-only or harmless).
const ALLOWED_SUBPATHS = new Set(["/reprint-log"]);

// router.use("/:id", ...) in routes/orders.js. GET/HEAD always pass.
export const blockMarketplaceOrderMutations = ({ database = db } = {}) => async (req, res, next) => {
  try {
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
    if (!/^\d+$/.test(String(req.params?.id || ""))) return next();
    // Unauthenticated calls are left to the route's own protect(); no lookup for them.
    if (!req.headers?.authorization) return next();
    const subPath = String(req.path || "").replace(/\/+$/, "");
    if (ALLOWED_SUBPATHS.has(subPath)) return next();
    const order = await lookupOrderOrigin(req.params.id, { database });
    if (order && isExternalMarketplaceOrder(order)) {
      const error = marketplaceOrderLockedError();
      return res.status(409).json({ success: false, code: error.code, message: error.message });
    }
    return next();
  } catch (error) {
    return next(error);
  }
};

export const assertNotMarketplaceOrder = async (orderId, { database = db } = {}) => {
  const order = await lookupOrderOrigin(orderId, { database });
  if (order && isExternalMarketplaceOrder(order)) throw marketplaceOrderLockedError();
};
