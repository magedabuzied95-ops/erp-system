/**
 * "Pairs well with" — the product page's two-product bundle.
 *
 * Two small tables of their own rather than new columns on `products` and
 * `orders`: runtime DDL on those hot tables is what starved the pool once, and
 * a table here is metadata-only to create.
 *
 *   product_pairings        the pair the owner pinned for a product in the ERP.
 *                           No row means the storefront picks one automatically.
 *   order_bundle_discounts  what each bundle on an order was discounted, for the
 *                           record. The money itself goes into orders.discount_amount
 *                           like every other discount, so invoices, reports and
 *                           return proration already account for it.
 */

import db from "../database/db.js";
import { getSetting } from "./settingsService.js";
import { normalizeBundleDiscountPercent } from "../../shared/bundleDiscount.js";

let schemaReadyPromise = null;

export const ensureProductBundleSchema = async (executor = db) => {
  if (!schemaReadyPromise) {
    schemaReadyPromise = (async () => {
      await executor.query(`
        CREATE TABLE IF NOT EXISTS product_pairings (
          product_id BIGINT PRIMARY KEY,
          tenant_id BIGINT,
          pair_product_id BIGINT NOT NULL,
          updated_by BIGINT,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await executor.query(`
        CREATE TABLE IF NOT EXISTS order_bundle_discounts (
          id BIGSERIAL PRIMARY KEY,
          order_id BIGINT NOT NULL,
          tenant_id BIGINT,
          bundle_id TEXT NOT NULL,
          product_ids BIGINT[] NOT NULL,
          sets INTEGER NOT NULL DEFAULT 1,
          base_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
          discount_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
          discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await executor.query(`CREATE INDEX IF NOT EXISTS idx_order_bundle_discounts_order ON order_bundle_discounts (order_id)`);
    })().catch((error) => {
      schemaReadyPromise = null;
      throw error;
    });
  }
  return schemaReadyPromise;
};

const toId = (value) => {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
};

/** The owner's settings, read on the server. A disabled feature discounts nothing. */
export const loadBundleSettings = async () => {
  const enabled = Boolean(await getSetting("storefront.bundle.enabled", false));
  const percent = normalizeBundleDiscountPercent(await getSetting("storefront.bundle.discount_percent", 5));
  return { enabled, percent: enabled ? percent : 0 };
};

export const getPinnedPairProductId = async (productId, executor = db) => {
  const id = toId(productId);
  if (!id) return null;
  await ensureProductBundleSchema();
  const result = await executor.query(`SELECT pair_product_id FROM product_pairings WHERE product_id = $1`, [id]);
  return toId(result.rows[0]?.pair_product_id);
};

/** Pin a pair, or pass null to go back to the automatic pick. */
export const setPinnedPairProductId = async ({ productId, pairProductId, tenantId = null, userId = null }, executor = db) => {
  const id = toId(productId);
  if (!id) throw new Error("A valid product id is required");
  const pairId = toId(pairProductId);
  if (pairId && pairId === id) throw new Error("A product cannot be paired with itself");
  await ensureProductBundleSchema();
  if (!pairId) {
    await executor.query(`DELETE FROM product_pairings WHERE product_id = $1`, [id]);
    return null;
  }
  await executor.query(
    `INSERT INTO product_pairings (product_id, tenant_id, pair_product_id, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (product_id) DO UPDATE
       SET pair_product_id = EXCLUDED.pair_product_id,
           tenant_id = EXCLUDED.tenant_id,
           updated_by = EXCLUDED.updated_by,
           updated_at = NOW()`,
    [id, toId(tenantId), pairId, toId(userId)]
  );
  return pairId;
};

const loadPinnedPairs = async (productIds = [], executor = db) => {
  const ids = [...new Set(productIds.map(toId).filter(Boolean))];
  if (!ids.length) return new Map();
  await ensureProductBundleSchema();
  const result = await executor.query(
    `SELECT product_id, pair_product_id FROM product_pairings WHERE product_id = ANY($1::bigint[])`,
    [ids]
  );
  return new Map(result.rows.map((row) => [String(row.product_id), String(row.pair_product_id)]));
};

const audiencesOf = (product = {}) => {
  const values = [product.audiences, product.product_audiences]
    .flatMap((value) => (Array.isArray(value) ? value : []))
    .map((value) => String(value || "").trim().toLowerCase())
    .filter(Boolean);
  return new Set(values);
};

/**
 * Builds the checkout's eligibility check for the products in one cart.
 *
 * A pair qualifies when the owner pinned it (either direction), or when the two
 * products are for the same audience — which is exactly what the automatic pick
 * on the product page offers. A product with no audience recorded is treated as
 * for everyone, rather than silently refusing a bundle the page just offered.
 */
export const buildBundlePairEligibility = async (productsById = new Map(), executor = db) => {
  // A checkout must never fail over a suggestion. If the pins cannot be read,
  // the audience rule still decides, which covers every automatic pick.
  let pinned = new Map();
  try {
    pinned = await loadPinnedPairs([...productsById.keys()], executor);
  } catch (error) {
    console.error("[bundle] pinned pairs unavailable at checkout", error?.message || error);
  }
  return (productIdA, productIdB) => {
    const a = productsById.get(String(productIdA));
    const b = productsById.get(String(productIdB));
    if (!a || !b) return false;
    if (pinned.get(String(productIdA)) === String(productIdB) || pinned.get(String(productIdB)) === String(productIdA)) return true;
    const audienceA = audiencesOf(a);
    const audienceB = audiencesOf(b);
    if (!audienceA.size || !audienceB.size) return true;
    return [...audienceA].some((audience) => audienceB.has(audience));
  };
};

export const recordOrderBundleDiscounts = async ({ orderId, tenantId = null, bundles = [], percent = 0 }, executor = db) => {
  const id = toId(orderId);
  if (!id || !Array.isArray(bundles) || !bundles.length) return;
  for (const bundle of bundles) {
    await executor.query(
      `INSERT INTO order_bundle_discounts (order_id, tenant_id, bundle_id, product_ids, sets, base_amount, discount_percent, discount_amount)
       VALUES ($1, $2, $3, $4::bigint[], $5, $6, $7, $8)`,
      [id, toId(tenantId), bundle.bundle_id, bundle.product_ids.map(toId).filter(Boolean), bundle.sets, bundle.base, percent, bundle.amount]
    );
  }
};
