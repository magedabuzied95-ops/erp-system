import { isForcedOfferSale, resolveEffectiveCustomerPrice } from "../../src/shared/lib/effectiveCustomerPrice.js";
import { AD_FEED_PURCHASE_COLUMNS, AD_FEED_PURCHASE_CTES, AD_FEED_PURCHASE_JOINS } from "../services/adFeedPurchaseLinesSql.js";

/*
  A sale's unit price arrives from the till, and the till is right: it prices through
  getPosEffectivePrice over the catalog. But the same endpoint is an API, and a cashier who
  calls it directly could ring a 1,000 EGP pair at 1 — a "price" is never counted as a
  discount, so the store's manual-discount limit never saw it.

  So every line is measured against the LOWEST price the shop could legitimately be charging
  for it today, and anything below that is manual discount, held to pos.max_discount_percent
  like any other. Lowest, not canonical: the till resolves offers and purchase-invoice prices
  through more than one path, and a floor that sat above a real till price would refuse an
  honest sale. The candidates:
    - the canonical customer price (manual override → purchase price → legacy, offers, Sale Mode);
    - the newest purchase-invoice selling price for that size (the storefront's line);
    - while an offer or Sale Mode is live: the stored and purchase-line sale prices.
  A line whose product has no price at all has no floor and is left to the cashier.
*/

const money = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) / 100 : 0;
};

// Gaps under this per unit are rounding between two price paths, not a discount.
const UNIT_TOLERANCE = 0.5;

export const lowestLegitimateUnitPrice = ({ product = {}, variant = null, line = {}, saleModeSettings = {} } = {}) => {
  const canonical = money(resolveEffectiveCustomerPrice({ product, variant, saleModeSettings }).active_price);
  const saleLive = Boolean(saleModeSettings?.sale_mode_enabled) || isForcedOfferSale(product) || isForcedOfferSale(variant || {});
  const candidates = [
    canonical,
    money(line.variant_line_purchase_selling_price),
    ...(saleLive ? [money(line.variant_line_sale_price), money(variant?.sale_price), money(product?.sale_price)] : []),
  ].filter((value) => value > 0);
  return candidates.length ? Math.min(...candidates) : 0;
};

// `floorFor(item)` returns the line's floor (0 = none). The result is the money the lines were
// rung up below their floors — what has to count as manual discount.
export const belowFloorDiscount = (items = [], floorFor = () => 0) =>
  Math.round(
    items.reduce((sum, item) => {
      const floor = money(floorFor(item));
      const price = Math.max(0, Number(item.price || 0) || 0);
      const quantity = Math.max(0, Number(item.quantity || 0) || 0);
      if (!floor || floor - price <= UNIT_TOLERANCE) return sum;
      return sum + (floor - price) * quantity;
    }, 0) * 100
  ) / 100;

// Floors keyed `v:<variant id>` / `p:<product id>`, read on the caller's transaction client.
export const loadOrderLineFloors = async (client, { tenantId = null, items = [], saleModeSettings = {} } = {}) => {
  const variantIds = [...new Set(items.map((item) => Number(item.variant_id)).filter((id) => Number.isInteger(id) && id > 0))];
  const productIds = [...new Set(items.filter((item) => !(Number(item.variant_id) > 0)).map((item) => Number(item.product_id)).filter((id) => Number.isInteger(id) && id > 0))];
  const floors = new Map();
  if (variantIds.length) {
    const result = await client.query(
      `
      WITH ${AD_FEED_PURCHASE_CTES}
      SELECT pv.id AS variant_id, to_jsonb(pv) AS variant_row, to_jsonb(p) AS product_row, ${AD_FEED_PURCHASE_COLUMNS}
      FROM product_variants pv
      JOIN products p ON p.id = pv.product_id
      ${AD_FEED_PURCHASE_JOINS}
      WHERE pv.id = ANY($1::bigint[])
        AND ($2::bigint IS NULL OR p.tenant_id = $2::bigint OR p.tenant_id IS NULL)
      `,
      [variantIds, tenantId]
    );
    for (const row of result.rows) {
      floors.set(`v:${Number(row.variant_id)}`, lowestLegitimateUnitPrice({ product: row.product_row || {}, variant: row.variant_row || {}, line: row, saleModeSettings }));
    }
  }
  if (productIds.length) {
    const result = await client.query(
      `SELECT p.id, to_jsonb(p) AS product_row FROM products p WHERE p.id = ANY($1::bigint[]) AND ($2::bigint IS NULL OR p.tenant_id = $2::bigint OR p.tenant_id IS NULL)`,
      [productIds, tenantId]
    );
    for (const row of result.rows) {
      floors.set(`p:${Number(row.id)}`, lowestLegitimateUnitPrice({ product: row.product_row || {}, saleModeSettings }));
    }
  }
  return floors;
};

export const floorKeyForItem = (item = {}) =>
  Number(item.variant_id) > 0 ? `v:${Number(item.variant_id)}` : Number(item.product_id) > 0 ? `p:${Number(item.product_id)}` : "";
