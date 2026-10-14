import db from "../../database/db.js";
import { ensureWholesaleSchema } from "./wholesale.schema.js";
import {
  EMPTY_SETTINGS,
  explodeLine,
  groupVariantsByColor,
  normalizeSettings,
  piecePriceFor,
  roundMoney,
  stockByColor,
  sumByVariant,
  unitLabel,
  WHOLESALE_TIERS,
} from "./wholesale.units.js";

const text = (value) => String(value ?? "").trim();
const fail = (message, status = 400, code = "WHOLESALE_INVALID") => Object.assign(new Error(message), { status, code });
const idOf = (value) => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
};
const tierOf = (value) => (WHOLESALE_TIERS.includes(value) ? value : "wholesale");
const TIER_LABEL = { wholesale: "جملة", half_wholesale: "نص جملة" };
const numOrNull = (value) => (value === null || value === undefined ? null : Number(value));

/* ------------------------------- products ------------------------------- */

const loadVariants = async (client, { tenantId, productId }) => {
  const { rows } = await client.query(
    `SELECT id, color, size, stock
       FROM product_variants
      WHERE tenant_id = $1 AND product_id = $2
        AND COALESCE(is_active, TRUE) = TRUE AND deleted_at IS NULL
      ORDER BY color_sort_order, color, id`,
    [tenantId, productId]
  );
  return rows.map((row) => ({ ...row, stock: Number(row.stock || 0) }));
};

const loadSettings = async (client, { tenantId, productId }) => {
  const { rows: [row] } = await client.query(
    `SELECT sell_piece, sell_series, series_pieces, sell_carton, carton_pieces, sell_dozen,
            price_wholesale, price_half_wholesale
       FROM wholesale_product_packs WHERE tenant_id = $1 AND product_id = $2`,
    [tenantId, productId]
  );
  if (!row) return null;
  return {
    ...row,
    series_pieces: numOrNull(row.series_pieces),
    carton_pieces: numOrNull(row.carton_pieces),
    price_wholesale: numOrNull(row.price_wholesale),
    price_half_wholesale: numOrNull(row.price_half_wholesale),
  };
};

/** For the invoice product search: models with wholesale prices first. */
export const listWholesaleProducts = async ({ tenantId, search = "", limit = 60 }) => {
  await ensureWholesaleSchema();
  const term = text(search);
  const { rows } = await db.query(
    `SELECT p.id, p.name, p.image_url,
            pk.price_wholesale, pk.price_half_wholesale,
            (SELECT COALESCE(SUM(v.stock), 0) FROM product_variants v
              WHERE v.product_id = p.id AND v.deleted_at IS NULL AND COALESCE(v.is_active, TRUE)) AS stock
       FROM products p
       LEFT JOIN wholesale_product_packs pk ON pk.tenant_id = p.tenant_id AND pk.product_id = p.id
      WHERE p.tenant_id = $1 AND COALESCE(p.is_active, TRUE) AND p.status = 'active'
        AND ($2 = '' OR p.name ILIKE '%' || $2 || '%' OR p.sku ILIKE '%' || $2 || '%' OR p.barcode = $2)
      ORDER BY (pk.price_wholesale IS NULL), p.name
      LIMIT $3`,
    [tenantId, term, Math.min(Math.max(Number(limit) || 60, 1), 200)]
  );
  return rows.map((row) => ({
    ...row,
    price_wholesale: numOrNull(row.price_wholesale),
    price_half_wholesale: numOrNull(row.price_half_wholesale),
    stock: Number(row.stock),
  }));
};

export const getWholesaleProduct = async ({ tenantId, productId }) => {
  await ensureWholesaleSchema();
  const id = idOf(productId);
  const { rows: [product] } = await db.query("SELECT id, name, image_url FROM products WHERE tenant_id = $1 AND id = $2", [tenantId, id]);
  if (!product) throw fail("المنتج مش موجود", 404);
  const [variants, settings] = await Promise.all([loadVariants(db, { tenantId, productId: id }), loadSettings(db, { tenantId, productId: id })]);
  const colors = [...new Set(variants.map((v) => text(v.color)).filter(Boolean))];
  const byColor = groupVariantsByColor(variants);
  const sizesByColor = Object.fromEntries(colors.map((color) => [color, (byColor.get(color.toLowerCase()) || []).map((v) => text(v.size)).filter(Boolean)]));
  return {
    product,
    colors,
    sizes_by_color: sizesByColor,
    stock_by_color: stockByColor(variants),
    settings: settings || { ...EMPTY_SETTINGS },
    configured: Boolean(settings),
  };
};

/** Saved from the product page right after the product itself. */
export const saveWholesaleProduct = async ({ tenantId, productId, settings }) => {
  await ensureWholesaleSchema();
  const id = idOf(productId);
  const { rows: [product] } = await db.query("SELECT id FROM products WHERE tenant_id = $1 AND id = $2", [tenantId, id]);
  if (!product) throw fail("المنتج مش موجود", 404);
  const clean = normalizeSettings(settings || {});
  await db.query(
    `INSERT INTO wholesale_product_packs
       (tenant_id, product_id, sell_piece, sell_series, series_pieces, sell_carton, carton_pieces, sell_dozen,
        price_wholesale, price_half_wholesale, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
     ON CONFLICT (tenant_id, product_id) DO UPDATE SET
       sell_piece = EXCLUDED.sell_piece, sell_series = EXCLUDED.sell_series, series_pieces = EXCLUDED.series_pieces,
       sell_carton = EXCLUDED.sell_carton, carton_pieces = EXCLUDED.carton_pieces, sell_dozen = EXCLUDED.sell_dozen,
       price_wholesale = EXCLUDED.price_wholesale, price_half_wholesale = EXCLUDED.price_half_wholesale, updated_at = NOW()`,
    [tenantId, id, clean.sell_piece, clean.sell_series, clean.series_pieces, clean.sell_carton, clean.carton_pieces,
      clean.sell_dozen, clean.price_wholesale, clean.price_half_wholesale]
  );
  return getWholesaleProduct({ tenantId, productId: id });
};

/** For the purchases import button: the wholesale prices of many models at once. */
export const getWholesalePrices = async ({ tenantId, productIds = [] }) => {
  await ensureWholesaleSchema();
  const ids = [...new Set((Array.isArray(productIds) ? productIds : []).map(idOf).filter(Boolean))];
  if (!ids.length) return {};
  const { rows } = await db.query(
    `SELECT product_id, price_wholesale, price_half_wholesale FROM wholesale_product_packs
      WHERE tenant_id = $1 AND product_id = ANY($2::bigint[])`,
    [tenantId, ids]
  );
  return Object.fromEntries(rows.map((row) => [row.product_id, {
    price_wholesale: numOrNull(row.price_wholesale),
    price_half_wholesale: numOrNull(row.price_half_wholesale),
  }]));
};

/** The POS in the wholesale copy: every model's tier piece prices, loaded once. */
export const listAllWholesalePrices = async ({ tenantId }) => {
  await ensureWholesaleSchema();
  const { rows } = await db.query(
    `SELECT product_id, price_wholesale, price_half_wholesale FROM wholesale_product_packs
      WHERE tenant_id = $1 AND (price_wholesale IS NOT NULL OR price_half_wholesale IS NOT NULL)`,
    [tenantId]
  );
  return Object.fromEntries(rows.map((row) => [row.product_id, {
    price_wholesale: numOrNull(row.price_wholesale),
    price_half_wholesale: numOrNull(row.price_half_wholesale),
  }]));
};

/** Purchases save: only the two prices, keeping the units the product page set. */
export const setWholesalePrices = async ({ tenantId, prices = [] }) => {
  await ensureWholesaleSchema();
  let saved = 0;
  for (const row of Array.isArray(prices) ? prices : []) {
    const id = idOf(row?.product_id);
    if (!id) continue;
    const clean = normalizeSettings({ price_wholesale: row.price_wholesale, price_half_wholesale: row.price_half_wholesale });
    if (clean.price_wholesale === null && clean.price_half_wholesale === null) continue;
    const { rowCount } = await db.query(
      `INSERT INTO wholesale_product_packs (tenant_id, product_id, price_wholesale, price_half_wholesale, updated_at)
       SELECT $1::bigint, $2::bigint, $3::numeric, $4::numeric, NOW()
        WHERE EXISTS (SELECT 1 FROM products WHERE tenant_id = $1::bigint AND id = $2::bigint)
       ON CONFLICT (tenant_id, product_id) DO UPDATE SET
         price_wholesale = COALESCE(EXCLUDED.price_wholesale, wholesale_product_packs.price_wholesale),
         price_half_wholesale = COALESCE(EXCLUDED.price_half_wholesale, wholesale_product_packs.price_half_wholesale),
         updated_at = NOW()`,
      [tenantId, id, clean.price_wholesale, clean.price_half_wholesale]
    );
    saved += rowCount;
  }
  return { saved };
};

/* ------------------------------- customers ------------------------------- */

export const getCustomerTerms = async ({ tenantId, customerId }) => {
  await ensureWholesaleSchema();
  const { rows: [row] } = await db.query(
    "SELECT tier, credit_limit, due_days FROM wholesale_customer_terms WHERE tenant_id = $1 AND customer_id = $2",
    [tenantId, idOf(customerId)]
  );
  return {
    tier: tierOf(row?.tier),
    credit_limit: Number(row?.credit_limit || 0),
    due_days: Number(row?.due_days || 0),
  };
};

export const listWholesaleCustomers = async ({ tenantId, search = "", limit = 40 }) => {
  await ensureWholesaleSchema();
  const term = text(search);
  const { rows } = await db.query(
    `SELECT c.id, c.name, c.phone, COALESCE(t.tier, 'wholesale') AS tier,
            COALESCE(t.credit_limit, 0) AS credit_limit, COALESCE(t.due_days, 0) AS due_days
       FROM customers c
       LEFT JOIN wholesale_customer_terms t ON t.tenant_id = c.tenant_id AND t.customer_id = c.id
      WHERE c.tenant_id = $1 AND COALESCE(c.status, 'active') <> 'deleted'
        AND ($2 = '' OR c.name ILIKE '%' || $2 || '%' OR c.phone ILIKE '%' || $2 || '%')
      ORDER BY c.name
      LIMIT $3`,
    [tenantId, term, Math.min(Math.max(Number(limit) || 40, 1), 200)]
  );
  return rows.map((row) => ({ ...row, tier: tierOf(row.tier), credit_limit: Number(row.credit_limit), due_days: Number(row.due_days) }));
};

export const saveCustomerTerms = async ({ tenantId, customerId, tier = "wholesale", credit_limit = 0, due_days = 0 }) => {
  await ensureWholesaleSchema();
  const id = idOf(customerId);
  const { rows: [customer] } = await db.query("SELECT id FROM customers WHERE tenant_id = $1 AND id = $2", [tenantId, id]);
  if (!customer) throw fail("العميل مش موجود", 404);
  const limit = Number(credit_limit) || 0;
  const days = Math.trunc(Number(due_days) || 0);
  if (limit < 0 || days < 0) throw fail("حد الآجل ومدة السداد لازم يكونوا أرقام موجبة");
  await db.query(
    `INSERT INTO wholesale_customer_terms (tenant_id, customer_id, tier, credit_limit, due_days, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (tenant_id, customer_id) DO UPDATE
       SET tier = EXCLUDED.tier, credit_limit = EXCLUDED.credit_limit, due_days = EXCLUDED.due_days, updated_at = NOW()`,
    [tenantId, id, tierOf(tier), roundMoney(limit), days]
  );
  return getCustomerTerms({ tenantId, customerId: id });
};

/* -------------------------------- invoice -------------------------------- */

/**
 * Prices and splits an invoice without saving anything. The piece price comes only from
 * the product's tier price -- a body price is never read.
 */
export const previewWholesaleInvoice = async ({ tenantId, customerId = null, tier = null, lines = [] }) => {
  await ensureWholesaleSchema();
  if (!Array.isArray(lines) || !lines.length) throw fail("الفاتورة فاضية");
  if (lines.some((line) => !idOf(line?.product_id))) throw fail("كل سطر لازم يكون عليه منتج");

  const resolvedTier = WHOLESALE_TIERS.includes(tier)
    ? tier
    : idOf(customerId) ? (await getCustomerTerms({ tenantId, customerId })).tier : "wholesale";

  const productIds = [...new Set(lines.map((line) => idOf(line.product_id)))];
  const { rows: products } = await db.query("SELECT id, name FROM products WHERE tenant_id = $1 AND id = ANY($2::bigint[])", [tenantId, productIds]);
  const productById = new Map(products.map((p) => [Number(p.id), p]));

  const cache = new Map();
  const productData = async (productId) => {
    if (!cache.has(productId)) {
      const [variants, settings] = await Promise.all([loadVariants(db, { tenantId, productId }), loadSettings(db, { tenantId, productId })]);
      cache.set(productId, { variants, byColor: groupVariantsByColor(variants), settings: settings || { ...EMPTY_SETTINGS } });
    }
    return cache.get(productId);
  };

  const out = [];
  for (const [index, line] of lines.entries()) {
    const productId = idOf(line.product_id);
    const product = productById.get(productId);
    if (!product) throw fail(`السطر ${index + 1}: المنتج مش موجود`);
    const data = await productData(productId);
    let exploded;
    try {
      exploded = explodeLine(line, data.settings, data.byColor);
    } catch (error) {
      throw fail(`${product.name}: ${error.message}`, error.status || 400, error.code);
    }
    const piecePrice = piecePriceFor(data.settings, resolvedTier);
    if (piecePrice === null) {
      throw fail(`${product.name}: مفيش سعر قطعة ${TIER_LABEL[resolvedTier]} — حطه من صفحة المنتج`, 400, "WHOLESALE_PRICE_MISSING");
    }
    out.push({
      product_id: productId,
      product_name: product.name,
      unit: exploded.unit,
      unit_label: unitLabel(exploded.unit, data.settings),
      unit_qty: exploded.qty,
      colors: [...new Set(exploded.composition.map((part) => text(part.color)))],
      size: exploded.unit === "piece" ? text(line.size) || null : null,
      pieces: exploded.pieces,
      piece_price: piecePrice,
      line_total: roundMoney(exploded.pieces * piecePrice),
      composition: exploded.composition,
    });
  }

  const need = sumByVariant(out);
  const shortages = [];
  for (const data of cache.values()) {
    for (const variant of data.variants) {
      const wanted = need.get(variant.id) || 0;
      if (wanted > variant.stock) shortages.push({ variant_id: variant.id, color: variant.color, size: variant.size, wanted, stock: variant.stock });
    }
  }

  return {
    tier: resolvedTier,
    tier_label: TIER_LABEL[resolvedTier],
    lines: out,
    pieces: out.reduce((sum, line) => sum + line.pieces, 0),
    total: roundMoney(out.reduce((sum, line) => sum + line.line_total, 0)),
    shortages,
  };
};
