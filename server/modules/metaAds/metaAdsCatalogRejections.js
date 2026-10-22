// Products Meta rejected in the shop's catalogue (counterfeit goods, prohibited items…) are kept
// out of the Meta feed. The feed is refetched every day, so a rejected item left in it is
// re-reviewed, re-rejected and re-emailed every day, and each rejection counts against the
// catalogue and the business. Pulling the rejected items here and dropping them from the feed
// makes Meta delete them on its next fetch.
//
// The exclusion is sticky on purpose: once Meta deletes an item it no longer reports it as
// rejected, and forgetting it then would put it back in the feed to be rejected again.
//
// Meta reports a rejection in more than one field, and which ones reach us depends on the token's
// permissions: on the shop's catalogue review_status came back empty for all 8,922 products while
// Commerce Manager listed 291 rejected (2026-10-22). So every signal is read, each is counted in
// the sync result, and any of them marks the item.

import db from "../../database/db.js";
import { MetaAdsGraphError, graphGetAll } from "./metaAdsGraph.js";
import { requireToken, text } from "./metaAdsCore.js";

export const REJECTED_REVIEW_STATUSES = Object.freeze(["rejected"]);

const BASE_FIELDS = "id,retailer_id,retailer_product_group_id,name,review_status";
// Richest first; a field the API version or token refuses ("(#100) nonexisting field") drops the
// set to the next one, so the sync never fails over a probe.
export const PRODUCT_FIELD_SETS = Object.freeze([
  `${BASE_FIELDS},review_rejection_reasons,capability_to_review_status,errors{title,description,severity}`,
  `${BASE_FIELDS},review_rejection_reasons,errors{title,description,severity}`,
  `${BASE_FIELDS},review_rejection_reasons`,
  BASE_FIELDS,
]);

const list = (value) => (Array.isArray(value) ? value : Array.isArray(value?.data) ? value.data : []);

// capability_to_review_status arrives as [{ key: "ADS", value: "REJECTED" }, …] (or a map).
const rejectedCapabilities = (product = {}) => {
  const raw = product.capability_to_review_status;
  const pairs = Array.isArray(raw) ? raw.map((row) => [row?.key, row?.value]) : raw && typeof raw === "object" ? Object.entries(raw) : [];
  return pairs.filter(([, value]) => text(value).toLowerCase() === "rejected").map(([key]) => text(key).toLowerCase());
};

export const rejectionSignals = (product = {}) => ({
  review_status: REJECTED_REVIEW_STATUSES.includes(text(product.review_status).toLowerCase()),
  rejection_reasons: list(product.review_rejection_reasons).length > 0,
  capability: rejectedCapabilities(product).length > 0,
});

export const isRejectedProduct = (product = {}) => Object.values(rejectionSignals(product)).some(Boolean);

export const rejectionRowsFromProducts = (products = []) =>
  (Array.isArray(products) ? products : [])
    .filter(isRejectedProduct)
    .map((product) => ({
      retailer_id: text(product.retailer_id),
      group_id: text(product.retailer_product_group_id),
      name: text(product.name).slice(0, 300),
    }))
    .filter((row) => row.retailer_id);

// What the sync result shows: per review status, how many carry each rejection signal, and the
// most common error titles (errors are only reported, never acted on: they include warnings).
export const reviewStatusCounts = (products = []) => {
  const counts = {};
  for (const product of Array.isArray(products) ? products : []) {
    const key = text(product?.review_status).toLowerCase() || "none";
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
};

export const rejectionDiagnostics = (products = []) => {
  const signals = { review_status: 0, rejection_reasons: 0, capability: 0 };
  const errorTitles = {};
  const reasons = {};
  for (const product of Array.isArray(products) ? products : []) {
    for (const [key, hit] of Object.entries(rejectionSignals(product))) if (hit) signals[key] += 1;
    for (const reason of list(product.review_rejection_reasons)) {
      const key = text(reason).slice(0, 80);
      reasons[key] = (reasons[key] || 0) + 1;
    }
    for (const error of list(product.errors)) {
      const key = `${text(error?.severity) || "?"}: ${text(error?.title).slice(0, 80)}`;
      errorTitles[key] = (errorTitles[key] || 0) + 1;
    }
  }
  const top = (map) => Object.fromEntries(Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 8));
  return { signals, reasons: top(reasons), errors: top(errorTitles) };
};

const catalogIdsOf = async (tenantId, accountId) => {
  const { rows } = await db.query(
    `SELECT DISTINCT catalog_id FROM meta_ads_product_sets WHERE tenant_id = $1 AND account_id = $2 AND catalog_id <> ''`,
    [tenantId, accountId],
  );
  return rows.map((row) => row.catalog_id);
};

const fetchProducts = async (catalogId, token) => {
  let lastError = null;
  for (const fields of PRODUCT_FIELD_SETS) {
    try {
      // Every product, filtered here: Graph's `filter` on review_status returned nothing.
      const products = await graphGetAll(`/${catalogId}/products`, token, { fields, limit: 500 }, { limit: 50000 });
      return { products, fields };
    } catch (error) {
      if (!(error instanceof MetaAdsGraphError) || Number(error.code) !== 100) throw error;
      lastError = error;
    }
  }
  throw lastError;
};

export const syncCatalogRejections = async (ctx) => {
  const token = requireToken(ctx);
  const tenantId = ctx.account.tenant_id;
  const catalogs = await catalogIdsOf(tenantId, ctx.account.id);
  let found = 0;
  const statuses = {};
  const diagnostics = [];
  for (const catalogId of catalogs) {
    const { products, fields } = await fetchProducts(catalogId, token);
    for (const [key, value] of Object.entries(reviewStatusCounts(products))) statuses[key] = (statuses[key] || 0) + value;
    diagnostics.push({ catalog_id: catalogId, products: products.length, fields, ...rejectionDiagnostics(products) });
    const rows = rejectionRowsFromProducts(products);
    for (const row of rows) {
      await db.query(
        `INSERT INTO meta_catalog_feed_exclusions (tenant_id, catalog_id, retailer_id, group_id, name, reason, first_seen_at, last_seen_at)
         VALUES ($1,$2,$3,NULLIF($4,''),$5,'rejected',NOW(),NOW())
         ON CONFLICT (tenant_id, catalog_id, retailer_id) DO UPDATE SET
           group_id = COALESCE(EXCLUDED.group_id, meta_catalog_feed_exclusions.group_id),
           name = EXCLUDED.name, last_seen_at = NOW()`,
        [tenantId, catalogId, row.retailer_id, row.group_id, row.name],
      );
    }
    found += rows.length;
  }
  if (found) {
    // The next fetch must already see the shorter feed.
    const { clearMetaCatalogFeedCache } = await import("../../services/metaCatalogFeedService.js");
    clearMetaCatalogFeedCache();
  }
  return { catalog_rejections: found, catalog_review_statuses: statuses, catalog_rejection_diagnostics: diagnostics };
};
