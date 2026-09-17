import db from "../database/db.js";
import { getTenantId, isSuperAdminUser } from "../utils/requestScope.js";
import {
  loadProductLifecycleEvents,
  loadProductLifecycleHeader,
  loadProductLifecycleVariants,
  normalizeLifecycleQuery,
  summarizeLifecycleVariants,
} from "../lib/productLifecycle.js";

const parseProductId = (value) => {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
};

const resolveTenantId = (req) => (isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id));

// GET /products/:id/lifecycle - header, per colour/size rows and the first page
// of the timeline. Later pages come from /lifecycle/events.
export const getProductLifecycle = async (req, res) => {
  const productId = parseProductId(req.params.id);
  if (!productId) return res.status(400).json({ success: false, message: "Invalid product id" });
  try {
    const tenantId = resolveTenantId(req);
    const product = await loadProductLifecycleHeader(db, { productId, tenantId });
    if (!product) return res.status(404).json({ success: false, message: "Product not found" });
    const [variants, timeline] = await Promise.all([
      loadProductLifecycleVariants(db, { productId, tenantId }),
      loadProductLifecycleEvents(db, { productId, tenantId, ...normalizeLifecycleQuery(req.query) }),
    ]);
    const summary = summarizeLifecycleVariants(variants);
    if (!summary.first_seen_at && product.created_at) summary.first_seen_at = product.created_at;
    return res.json({ success: true, product, summary, variants, timeline });
  } catch (error) {
    console.error("[products:lifecycle] load failed", { productId, message: error?.message });
    return res.status(500).json({ success: false, message: "Failed to load the product history" });
  }
};

export const getProductLifecycleEvents = async (req, res) => {
  const productId = parseProductId(req.params.id);
  if (!productId) return res.status(400).json({ success: false, message: "Invalid product id" });
  try {
    const timeline = await loadProductLifecycleEvents(db, {
      productId,
      tenantId: resolveTenantId(req),
      ...normalizeLifecycleQuery(req.query),
    });
    return res.json({ success: true, timeline });
  } catch (error) {
    console.error("[products:lifecycle] events failed", { productId, message: error?.message });
    return res.status(500).json({ success: false, message: "Failed to load the product history" });
  }
};
