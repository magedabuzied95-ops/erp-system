// Products Meta rejected in the shop's catalogue (counterfeit goods, prohibited items…) are kept
// out of the Meta feed. The feed is refetched every day, so a rejected item left in it is
// re-reviewed, re-rejected and re-emailed every day, and each rejection counts against the
// catalogue and the business. Pulling the rejected items here and dropping them from the feed
// makes Meta delete them on its next fetch.
//
// The exclusion is sticky on purpose: once Meta deletes an item it no longer reports it as
// rejected, and forgetting it then would put it back in the feed to be rejected again.

import db from "../../database/db.js";
import { graphGetAll } from "./metaAdsGraph.js";
import { requireToken, text } from "./metaAdsCore.js";

export const REJECTED_REVIEW_STATUSES = Object.freeze(["rejected"]);

export const rejectionRowsFromProducts = (products = []) =>
  (Array.isArray(products) ? products : [])
    .filter((product) => REJECTED_REVIEW_STATUSES.includes(text(product?.review_status).toLowerCase()))
    .map((product) => ({
      retailer_id: text(product.retailer_id),
      group_id: text(product.retailer_product_group_id),
      name: text(product.name).slice(0, 300),
    }))
    .filter((row) => row.retailer_id);

const catalogIdsOf = async (tenantId, accountId) => {
  const { rows } = await db.query(
    `SELECT DISTINCT catalog_id FROM meta_ads_product_sets WHERE tenant_id = $1 AND account_id = $2 AND catalog_id <> ''`,
    [tenantId, accountId],
  );
  return rows.map((row) => row.catalog_id);
};

export const syncCatalogRejections = async (ctx) => {
  const token = requireToken(ctx);
  const tenantId = ctx.account.tenant_id;
  const catalogs = await catalogIdsOf(tenantId, ctx.account.id);
  let found = 0;
  for (const catalogId of catalogs) {
    const products = await graphGetAll(`/${catalogId}/products`, token, {
      fields: "id,retailer_id,retailer_product_group_id,name,review_status",
      filter: { review_status: { eq: "rejected" } },
    }, { limit: 20000 });
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
  return { catalog_rejections: found };
};
