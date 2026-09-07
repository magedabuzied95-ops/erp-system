/**
 * Print the price EVERY colour card would carry, resolved exactly the way the
 * Messenger / Instagram / WhatsApp colour carousel now resolves it, next to the
 * tier that decided it.
 *
 * Why this exists: "the prices in the cards do not match the system" has two
 * possible causes and they need different fixes.
 *   1) CODE — the card read the product row's single price instead of the
 *      colour's own variant. That was the bug fixed alongside this script.
 *   2) DATA — the colour genuinely owns no price, so the canonical contract
 *      (variant manual -> product manual -> variant purchase_selling_price ->
 *      product purchase_selling_price -> variant legacy -> product legacy)
 *      falls back to a PRODUCT-level number. POS charges that same number, so
 *      the card is right and the catalogue is what needs fixing.
 * `normal_price_source` says which of the two you are looking at: any source
 * starting with `product_` means this colour is priced by the product row.
 *
 * Usage (inside the backend container):
 *   node server/scripts/auditColorCardPrices.js --product 764
 *   node server/scripts/auditColorCardPrices.js --name "air force"
 *   node server/scripts/auditColorCardPrices.js --disagreeing [--limit 50]
 *
 * --disagreeing lists every product whose colours are NOT all priced the same,
 * which is exactly the set the old single-price card was getting wrong.
 * Read-only: it never writes.
 */
import db from "../database/db.js";
import { resolveEffectiveCustomerPrice } from "../../src/shared/lib/effectiveCustomerPrice.js";
import { loadTenantSaleModeSettings } from "../utils/customerDisplayPrice.js";

const arg = (name, fallback = "") => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};

const productId = Number(arg("product", 0)) || null;
const nameQuery = arg("name", "").trim();
const tenantId = Number(arg("tenant", 1)) || 1;
const limit = Math.min(Math.max(Number(arg("limit", 25)) || 25, 1), 500);
const disagreeingOnly = process.argv.includes("--disagreeing");

if (!productId && !nameQuery && !disagreeingOnly) {
  console.error("Usage: --product <id> | --name <text> | --disagreeing [--limit N] [--tenant N]");
  process.exit(1);
}

const loadProducts = async () => {
  if (productId) {
    const result = await db.query("SELECT * FROM products WHERE id = $1", [productId]);
    return result.rows;
  }
  if (nameQuery) {
    const result = await db.query(
      "SELECT * FROM products WHERE tenant_id = $1 AND name ILIKE $2 ORDER BY id LIMIT $3",
      [tenantId, `%${nameQuery}%`, limit]
    );
    return result.rows;
  }
  const result = await db.query(
    `SELECT * FROM products p
     WHERE p.tenant_id = $1
       AND EXISTS (
         SELECT 1 FROM product_variants v
         WHERE v.product_id = p.id AND COALESCE(v.stock, 0) > 0 AND TRIM(COALESCE(v.color, '')) <> ''
         GROUP BY v.product_id
         HAVING COUNT(DISTINCT LOWER(TRIM(v.color))) >= 2
       )
     ORDER BY p.id
     LIMIT $2`,
    [tenantId, limit * 4]
  );
  return result.rows;
};

const run = async () => {
  const saleModeSettings = await loadTenantSaleModeSettings({ tenantId });
  const products = await loadProducts();
  let printed = 0;
  for (const product of products) {
    const variants = (
      await db.query(
        `SELECT * FROM product_variants
         WHERE product_id = $1 AND COALESCE(stock, 0) > 0 AND TRIM(COALESCE(color, '')) <> ''
         ORDER BY id`,
        [product.id]
      )
    ).rows;
    const byColor = new Map();
    for (const variant of variants) {
      const key = String(variant.color || "").trim().toLowerCase();
      if (!byColor.has(key)) byColor.set(key, []);
      byColor.get(key).push(variant);
    }
    const rows = [...byColor.entries()].map(([, group]) => {
      // The colour is represented by the first variant that owns a price, the same rule the card
      // builder uses; falling back to the first row keeps a priceless colour visible here.
      const priced =
        group.find((variant) => {
          const resolved = resolveEffectiveCustomerPrice({ product: {}, variant, saleModeSettings });
          return resolved.active_price > 0;
        }) || group[0];
      const resolved = resolveEffectiveCustomerPrice({ product, variant: priced, saleModeSettings });
      return {
        color: String(priced.color || "").trim(),
        variant_id: priced.id,
        card_price: resolved.active_price,
        normal_price_source: resolved.normal_price_source,
        priced_by: String(resolved.normal_price_source || "").startsWith("product_") ? "PRODUCT ROW" : "this colour",
        reason: resolved.reason,
      };
    });
    const distinct = new Set(rows.map((row) => row.card_price));
    if (disagreeingOnly && distinct.size < 2) continue;
    printed += 1;
    console.log(`\n#${product.id} ${product.name}`);
    console.log(
      `  product row: price=${product.price} selling=${product.selling_price} regular=${product.regular_price} ` +
        `purchase_selling=${product.purchase_selling_price} manual=${product.manual_price_override_active ? product.manual_selling_price : "-"}`
    );
    console.table(rows);
    if (disagreeingOnly && printed >= limit) break;
  }
  console.log(`\n${printed} product(s) printed. Sale mode: ${saleModeSettings?.sale_mode_enabled ? "ON" : "OFF"}.`);
  process.exit(0);
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
