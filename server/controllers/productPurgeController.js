/**
 * Admin-only hard delete: remove a product from the database instead of
 * archiving it. `deleteProduct` intentionally falls back to
 * `archiveProductForDelete` the moment any history row exists, so this is the
 * only path that actually drops the row.
 *
 * Two endpoints, one engine: the preview runs the whole plan inside a
 * transaction it rolls back, so the confirmation dialog shows exactly what the
 * real run will do - including the recomputed total of every purchase invoice
 * the product appears on.
 */
import db from "../database/db.js";
import logActivity from "../utils/logActivity.js";
import { buildCacheKey, invalidateCachePattern } from "../services/cacheService.js";
import { getTenantId, isSuperAdminUser } from "../utils/requestScope.js";
import {
  executeProductPurge,
  loadPurgeTarget,
  planProductPurge,
  purgeProductImageFiles,
} from "../lib/productPurgeEngine.js";

const invalidateProductStorefrontCache = async (tenantId) => {
  const scopes = new Set([tenantId || "public", "public"]);
  await Promise.all(
    Array.from(scopes).map((scope) => invalidateCachePattern(buildCacheKey("storefront", `tenant:${scope}`, "*")))
  );
};

const parseProductId = (value) => {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
};

const productIdentity = (product = {}) => ({
  id: Number(product.id),
  name: product.name || "",
  sku: product.sku || "",
  product_code: product.product_code || "",
  barcode: product.barcode || "",
  status: product.status || "",
  image_url: product.image_url || "",
});

/**
 * The word the operator has to type to confirm. Prefer the SKU because it is
 * short and unambiguous; fall back to the name, then the id, so a product with
 * no SKU is still confirmable.
 */
const confirmationPhrase = (product = {}) =>
  String(product.sku || product.product_code || product.name || product.id || "").trim();

const normalizeConfirmation = (value = "") => String(value || "").trim().toLowerCase();

export const previewProductPurge = async (req, res) => {
  const productId = parseProductId(req.params.id);
  if (!productId) return res.status(400).json({ success: false, message: "Invalid product id" });

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const tenantId = isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id);
    const target = await loadPurgeTarget(client, { productId, tenantId });
    if (!target) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    const plan = await planProductPurge(client, target);
    await client.query("ROLLBACK");

    return res.json({
      success: true,
      product: productIdentity(target.product),
      confirmation_phrase: confirmationPhrase(target.product),
      summary: plan.summary,
      purchases: plan.purchaseImpact,
      deletes: plan.willDelete.map(({ table, column, count }) => ({ table, column, rows: count })),
      detaches: plan.willDetach.map(({ table, column, count }) => ({ table, column, rows: count })),
      unclassified: plan.unknown.map(({ table, column, count }) => ({ table, column, rows: count })),
      blocked: plan.unknown.length > 0,
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[product-purge-preview-failed]", { productId, message: error.message, code: error.code });
    return res.status(500).json({ success: false, message: "Failed to build purge preview", error: error.message });
  } finally {
    client.release();
  }
};

export const purgeProduct = async (req, res) => {
  const productId = parseProductId(req.params.id);
  if (!productId) return res.status(400).json({ success: false, message: "Invalid product id" });

  const client = await db.connect();
  let imageBasenames = new Set();
  try {
    await client.query("BEGIN");
    const tenantId = isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id);
    const target = await loadPurgeTarget(client, { productId, tenantId });
    if (!target) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    const expected = confirmationPhrase(target.product);
    const provided = req.body?.confirm ?? req.body?.confirmation ?? "";
    if (normalizeConfirmation(provided) !== normalizeConfirmation(expected)) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        success: false,
        code: "PURGE_CONFIRMATION_MISMATCH",
        message: "Confirmation text does not match the product.",
        confirmation_phrase: expected,
      });
    }

    const plan = await planProductPurge(client, target);
    if (plan.unknown.length) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        success: false,
        code: "PRODUCT_PURGE_UNCLASSIFIED",
        message: "Unclassified tables reference this product. Purge refused.",
        unclassified: plan.unknown.map(({ table, column, count }) => ({ table, column, rows: count })),
      });
    }

    const identity = productIdentity(target.product);
    const report = await executeProductPurge(client, target, plan, { actorId: req.user?.id });
    imageBasenames = report.imageBasenames || new Set();

    await client.query("COMMIT");

    // Files are unlinked only after the row is really gone, so a rolled-back
    // transaction can never leave the catalogue pointing at a deleted image.
    let files = { deleted: [], kept: [] };
    if (imageBasenames.size) {
      files = await purgeProductImageFiles(client, imageBasenames).catch((error) => {
        console.error("[product-purge-image-cleanup-failed]", { productId, message: error.message });
        return { deleted: [], kept: [] };
      });
    }

    await invalidateProductStorefrontCache(tenantId).catch((error) => {
      console.error("[product-purge-cache-invalidate-failed]", { productId, message: error.message });
    });

    await logActivity(
      db,
      req.user?.id || null,
      "product.purge",
      "products",
      productId,
      JSON.stringify({
        product: identity,
        summary: plan.summary,
        purchases: plan.purchaseImpact.map((entry) => ({
          purchase_id: entry.purchase_id,
          purchase_number: entry.purchase_number,
          removed_lines: entry.removed_lines,
          total_before: entry.before.total,
          total_after: entry.after.total,
        })),
      })
    );

    return res.json({
      success: true,
      status: "purged",
      message: "Product permanently removed from the database.",
      product: identity,
      summary: plan.summary,
      deleted: report.deleted,
      detached: report.detached,
      purchases: plan.purchaseImpact,
      purchases_updated: report.purchases_updated,
      sales_lines: report.sales_lines,
      json_cleanups: report.json_cleanups,
      files: { deleted: files.deleted.length, kept: files.kept.length },
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[product-purge-failed]", {
      productId,
      message: error.message,
      detail: error.detail,
      code: error.code,
      constraint: error.constraint,
    });
    if (
      error.code === "PRODUCT_PURGE_UNCLASSIFIED" ||
      error.code === "PRODUCT_PURGE_DANGLING" ||
      error.code === "PRODUCT_PURGE_NOT_NULL_DETACH"
    ) {
      return res.status(409).json({
        success: false,
        code: error.code,
        message: error.message,
        unclassified: error.details || [],
      });
    }
    return res.status(500).json({ success: false, message: "Failed to purge product", error: error.message });
  } finally {
    client.release();
  }
};
