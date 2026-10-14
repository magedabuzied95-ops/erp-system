import db from "../../database/db.js";
import { createOrder } from "../../controllers/ordersController.js";
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

const PAYMENT_METHODS = new Set(["cash", "instapay", "vodafone_cash", "card"]);

/** createOrder is an Express handler; run it in-process and read what it answered. */
const runCreateOrder = (req, body) =>
  new Promise((resolve, reject) => {
    const innerReq = Object.create(req);
    innerReq.body = body;
    const res = {
      statusCode: 200,
      headersSent: false,
      status(code) { this.statusCode = code; return this; },
      set() { return this; },
      setHeader() { return this; },
      json(payload) { this.headersSent = true; resolve({ status: this.statusCode, body: payload }); return this; },
      send(payload) { this.headersSent = true; resolve({ status: this.statusCode, body: payload }); return this; },
      end() { this.headersSent = true; resolve({ status: this.statusCode, body: null }); return this; },
    };
    Promise.resolve(createOrder(innerReq, res)).catch(reject);
  });

/**
 * Saves a wholesale invoice. The goods go through the SAME createOrder the shop uses
 * (stock, shift, salesperson, accounting, credit sale), as pieces per colour/size at the
 * tier piece price; this module only adds the wholesale view of the lines.
 *
 * payment: { mode: "cash" | "credit" | "partial", method, paid_amount }
 */
export const createWholesaleInvoice = async ({ req, tenantId, body = {} }) => {
  const preview = await previewWholesaleInvoice({ tenantId, customerId: body.customer_id, tier: body.tier, lines: body.lines });
  if (preview.shortages.length) {
    const first = preview.shortages[0];
    const where = first.size ? `${first.color} مقاس ${first.size}` : first.color;
    throw Object.assign(fail(`المخزون مش كفاية: ${where} مطلوب ${first.wanted} والموجود ${first.stock}`, 409, "WHOLESALE_STOCK_SHORT"), { shortages: preview.shortages });
  }

  const customerId = idOf(body.customer_id);
  const payment = body.payment && typeof body.payment === "object" ? body.payment : {};
  const mode = ["cash", "credit", "partial"].includes(payment.mode) ? payment.mode : "cash";
  const method = PAYMENT_METHODS.has(payment.method) ? payment.method : "cash";
  const total = preview.total;
  if ((mode === "credit" || mode === "partial") && !customerId) throw fail("البيع الآجل محتاج عميل");
  const paid = mode === "cash" ? total : mode === "credit" ? 0 : roundMoney(Number(payment.paid_amount) || 0);
  if (mode === "partial" && !(paid > 0 && paid < total)) throw fail("المدفوع لازم يكون أكبر من صفر وأقل من الإجمالي");

  // Same variant at the same piece price -> one order line.
  const merged = new Map();
  for (const line of preview.lines) {
    for (const part of line.composition) {
      const k = `${part.variant_id}|${line.piece_price}`;
      const row = merged.get(k) || { product_id: line.product_id, product_name: line.product_name, variant_id: part.variant_id, color: part.color, size: part.size, quantity: 0, price: line.piece_price };
      row.quantity += part.qty;
      merged.set(k, row);
    }
  }
  const items = [...merged.values()].map((row) => {
    const lineTotal = roundMoney(row.quantity * row.price);
    return {
      product_id: row.product_id,
      product_name: row.product_name,
      variant_id: row.variant_id,
      variant_name: [row.color, row.size].filter(Boolean).join(" / "),
      variation_mode: "full_variations",
      size: row.size, color: row.color,
      selected_size: row.size, selected_color: row.color,
      variant_size: row.size, variant_color: row.color,
      quantity: row.quantity,
      price: row.price, unit_price: row.price, sale_price: row.price, final_price: row.price, variant_price: row.price,
      discount_amount: 0, tax_amount: 0, tax_rate: 0,
      line_total: lineTotal, subtotal: lineTotal, total_amount: lineTotal,
    };
  });

  const breakdown = paid > 0 ? [{ method, amount: paid }] : [];
  const salesEmployeeId = body.sales_employee_id || null;
  const orderBody = {
    customer_id: customerId,
    customer_name: text(body.customer_name),
    customer_phone: text(body.customer_phone),
    payment_method: mode === "cash" ? method : "credit_sale",
    subtotal: total,
    discount_amount: 0,
    invoice_discount_amount: 0,
    tax_amount: 0,
    tax_rate: 0,
    service_fee: 0,
    total,
    paid_amount: paid,
    change_amount: 0,
    amount_due_now: mode === "cash" ? total : roundMoney(total - paid),
    status: mode === "cash" ? "paid" : mode === "credit" ? "unpaid" : "partially_paid",
    payment_status: mode === "cash" ? "paid" : mode === "credit" ? "unpaid" : "partially_paid",
    cash_amount: method === "cash" ? paid : 0,
    card_amount: method === "card" ? paid : 0,
    wallet_payment_amount: method === "instapay" || method === "vodafone_cash" ? paid : 0,
    payment_breakdown: breakdown,
    payments: breakdown,
    branch_id: body.branch_id || null,
    shift_id: body.shift_id || null,
    seller_user_id: body.seller_user_id || null,
    sales_employee_id: salesEmployeeId,
    salesperson_id: salesEmployeeId,
    assigned_seller_id: salesEmployeeId,
    seller_employee_id: salesEmployeeId,
    notes: text(body.notes) || `فاتورة ${preview.tier_label}`,
    idempotency_key: text(body.idempotency_key) || null,
    items,
  };

  const result = await runCreateOrder(req, orderBody);
  if (result.status >= 400 || !result.body?.success) {
    throw fail(result.body?.message || "تعذر حفظ الفاتورة", result.status >= 400 ? result.status : 500, result.body?.code || "WHOLESALE_ORDER_FAILED");
  }
  const orderId = Number(result.body.order_id || result.body.order?.id);

  // A replayed idempotency key returns the first order -- its lines are already stored.
  const { rowCount: already } = await db.query("SELECT 1 FROM wholesale_invoice_lines WHERE tenant_id = $1 AND order_id = $2 LIMIT 1", [tenantId, orderId]);
  if (!already) {
    try {
      for (const line of preview.lines) {
        await db.query(
          `INSERT INTO wholesale_invoice_lines
             (tenant_id, order_id, product_id, product_name, unit, unit_label, unit_qty, colors, pieces, piece_price, line_total, composition, tier)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12::jsonb, $13)`,
          [tenantId, orderId, line.product_id, line.product_name, line.unit, line.unit_label, line.unit_qty,
            JSON.stringify(line.colors), line.pieces, line.piece_price, line.line_total, JSON.stringify(line.composition), preview.tier]
        );
      }
    } catch (error) {
      // The sale itself is committed; only the wholesale summary is missing.
      console.error("[wholesale] invoice lines not stored", { order_id: orderId, message: error?.message });
    }
  }

  return { ...result.body, wholesale: { tier: preview.tier, lines: preview.lines, pieces: preview.pieces, total } };
};

export const getWholesaleInvoiceLines = async ({ tenantId, orderId }) => {
  await ensureWholesaleSchema();
  const { rows } = await db.query(
    `SELECT product_id, product_name, unit, unit_label, unit_qty, colors, pieces, piece_price, line_total, tier
       FROM wholesale_invoice_lines WHERE tenant_id = $1 AND order_id = $2 ORDER BY id`,
    [tenantId, idOf(orderId)]
  );
  return rows.map((row) => ({ ...row, piece_price: Number(row.piece_price), line_total: Number(row.line_total) }));
};
