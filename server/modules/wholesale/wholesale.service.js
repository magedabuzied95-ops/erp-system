import db from "../../database/db.js";
import { createOrder } from "../../controllers/ordersController.js";
import { ensureWholesaleSchema } from "./wholesale.schema.js";
import {
  availableUnits,
  explodeLine,
  indexVariants,
  normalizePack,
  roundMoney,
  sumByVariant,
  unitLabel,
  WHOLESALE_UNITS,
} from "./wholesale.units.js";

const text = (value) => String(value ?? "").trim();
const fail = (message, status = 400, code = "WHOLESALE_INVALID") => Object.assign(new Error(message), { status, code });
const idOf = (value) => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/* ----------------------------- price lists ----------------------------- */

export const listPriceLists = async ({ tenantId }) => {
  await ensureWholesaleSchema();
  const { rows } = await db.query(
    `SELECT id, name, sort_order, is_default, is_active
       FROM wholesale_price_lists WHERE tenant_id = $1 ORDER BY sort_order, id`,
    [tenantId]
  );
  return rows;
};

export const savePriceList = async ({ tenantId, id = null, name, sort_order = 0, is_default = false, is_active = true }) => {
  await ensureWholesaleSchema();
  const cleanName = text(name);
  if (!cleanName) throw fail("اكتب اسم قائمة الأسعار");
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    if (is_default) await client.query("UPDATE wholesale_price_lists SET is_default = FALSE WHERE tenant_id = $1", [tenantId]);
    let row;
    if (idOf(id)) {
      ({ rows: [row] } = await client.query(
        `UPDATE wholesale_price_lists SET name = $3, sort_order = $4, is_default = $5, is_active = $6, updated_at = NOW()
          WHERE tenant_id = $1 AND id = $2 RETURNING *`,
        [tenantId, idOf(id), cleanName, Number(sort_order) || 0, Boolean(is_default), is_active !== false]
      ));
      if (!row) throw fail("قائمة الأسعار مش موجودة", 404);
    } else {
      ({ rows: [row] } = await client.query(
        `INSERT INTO wholesale_price_lists (tenant_id, name, sort_order, is_default, is_active)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [tenantId, cleanName, Number(sort_order) || 0, Boolean(is_default), is_active !== false]
      ));
    }
    await client.query("COMMIT");
    return row;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};

export const deletePriceList = async ({ tenantId, id }) => {
  await ensureWholesaleSchema();
  const { rowCount } = await db.query("DELETE FROM wholesale_price_lists WHERE tenant_id = $1 AND id = $2", [tenantId, idOf(id)]);
  if (!rowCount) throw fail("قائمة الأسعار مش موجودة", 404);
  return { deleted: true };
};

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

const loadPack = async (client, { tenantId, productId }) => {
  const { rows: [row] } = await client.query(
    "SELECT series_sizes, sell_piece, cartons FROM wholesale_product_packs WHERE tenant_id = $1 AND product_id = $2",
    [tenantId, productId]
  );
  return row ? normalizePack(row) : null;
};

export const listWholesaleProducts = async ({ tenantId, search = "", limit = 60 }) => {
  await ensureWholesaleSchema();
  const term = text(search);
  const { rows } = await db.query(
    `SELECT p.id, p.name, p.image_url,
            (pk.product_id IS NOT NULL) AS has_pack,
            COALESCE(jsonb_array_length(pk.series_sizes), 0) AS series_size,
            COALESCE(jsonb_array_length(pk.cartons), 0) AS carton_count,
            (SELECT COUNT(*) FROM wholesale_prices wp WHERE wp.tenant_id = p.tenant_id AND wp.product_id = p.id) AS price_count,
            (SELECT COALESCE(SUM(v.stock), 0) FROM product_variants v
              WHERE v.product_id = p.id AND v.deleted_at IS NULL AND COALESCE(v.is_active, TRUE)) AS stock
       FROM products p
       LEFT JOIN wholesale_product_packs pk ON pk.tenant_id = p.tenant_id AND pk.product_id = p.id
      WHERE p.tenant_id = $1 AND COALESCE(p.is_active, TRUE) AND p.status = 'active'
        AND ($2 = '' OR p.name ILIKE '%' || $2 || '%' OR p.sku ILIKE '%' || $2 || '%' OR p.barcode = $2)
      ORDER BY p.name
      LIMIT $3`,
    [tenantId, term, Math.min(Math.max(Number(limit) || 60, 1), 200)]
  );
  return rows.map((row) => ({ ...row, price_count: Number(row.price_count), stock: Number(row.stock) }));
};

export const getWholesaleProduct = async ({ tenantId, productId }) => {
  await ensureWholesaleSchema();
  const id = idOf(productId);
  const { rows: [product] } = await db.query(
    "SELECT id, name, image_url, cost_price, selling_price, wholesale_price FROM products WHERE tenant_id = $1 AND id = $2",
    [tenantId, id]
  );
  if (!product) throw fail("المنتج مش موجود", 404);
  const [variants, pack, prices] = await Promise.all([
    loadVariants(db, { tenantId, productId: id }),
    loadPack(db, { tenantId, productId: id }),
    db.query("SELECT price_list_id, unit, piece_price FROM wholesale_prices WHERE tenant_id = $1 AND product_id = $2", [tenantId, id]),
  ]);
  const colors = [...new Set(variants.map((v) => text(v.color)).filter(Boolean))];
  const sizes = [...new Set(variants.map((v) => text(v.size)).filter(Boolean))];
  const effectivePack = pack || { series_sizes: [], sell_piece: true, cartons: [] };
  return {
    product,
    colors,
    sizes,
    variants,
    pack: pack || null,
    prices: prices.rows.map((row) => ({ ...row, piece_price: Number(row.piece_price) })),
    available: availableUnits(effectivePack, indexVariants(variants), colors),
  };
};

export const saveWholesaleProduct = async ({ tenantId, productId, pack, prices = [] }) => {
  await ensureWholesaleSchema();
  const id = idOf(productId);
  const { rows: [product] } = await db.query("SELECT id FROM products WHERE tenant_id = $1 AND id = $2", [tenantId, id]);
  if (!product) throw fail("المنتج مش موجود", 404);
  const clean = normalizePack(pack || {});
  const sizes = new Set((await loadVariants(db, { tenantId, productId: id })).map((v) => text(v.size).toLowerCase()));
  const unknown = [...clean.series_sizes, ...clean.cartons.flatMap((c) => Object.keys(c.sizes))]
    .filter((size) => !sizes.has(size.toLowerCase()));
  if (unknown.length) throw fail(`مقاسات مش موجودة في المنتج: ${[...new Set(unknown)].join("، ")}`);

  const cleanPrices = (Array.isArray(prices) ? prices : [])
    .map((p) => ({ price_list_id: idOf(p.price_list_id), unit: text(p.unit).toLowerCase(), piece_price: p.piece_price }))
    .filter((p) => p.price_list_id && WHOLESALE_UNITS.includes(p.unit) && p.piece_price !== "" && p.piece_price !== null && p.piece_price !== undefined);
  for (const p of cleanPrices) {
    const value = Number(p.piece_price);
    if (!Number.isFinite(value) || value < 0) throw fail("سعر القطعة لازم يكون رقم موجب");
    p.piece_price = roundMoney(value);
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO wholesale_product_packs (tenant_id, product_id, series_sizes, sell_piece, cartons, updated_at)
       VALUES ($1, $2, $3::jsonb, $4, $5::jsonb, NOW())
       ON CONFLICT (tenant_id, product_id) DO UPDATE
         SET series_sizes = EXCLUDED.series_sizes, sell_piece = EXCLUDED.sell_piece, cartons = EXCLUDED.cartons, updated_at = NOW()`,
      [tenantId, id, JSON.stringify(clean.series_sizes), clean.sell_piece, JSON.stringify(clean.cartons)]
    );
    await client.query("DELETE FROM wholesale_prices WHERE tenant_id = $1 AND product_id = $2", [tenantId, id]);
    for (const p of cleanPrices) {
      await client.query(
        `INSERT INTO wholesale_prices (tenant_id, price_list_id, product_id, unit, piece_price)
         SELECT $1, $2, $3, $4, $5 WHERE EXISTS (SELECT 1 FROM wholesale_price_lists WHERE tenant_id = $1 AND id = $2)`,
        [tenantId, p.price_list_id, id, p.unit, p.piece_price]
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  return getWholesaleProduct({ tenantId, productId: id });
};

/* ------------------------------- customers ------------------------------- */

export const listWholesaleCustomers = async ({ tenantId, search = "", limit = 40 }) => {
  await ensureWholesaleSchema();
  const term = text(search);
  const { rows } = await db.query(
    `SELECT c.id, c.name, c.phone, t.price_list_id, pl.name AS price_list_name,
            COALESCE(t.credit_limit, 0) AS credit_limit, COALESCE(t.due_days, 0) AS due_days
       FROM customers c
       LEFT JOIN wholesale_customer_terms t ON t.tenant_id = c.tenant_id AND t.customer_id = c.id
       LEFT JOIN wholesale_price_lists pl ON pl.id = t.price_list_id
      WHERE c.tenant_id = $1 AND COALESCE(c.status, 'active') <> 'deleted'
        AND ($2 = '' OR c.name ILIKE '%' || $2 || '%' OR c.phone ILIKE '%' || $2 || '%')
      ORDER BY c.name
      LIMIT $3`,
    [tenantId, term, Math.min(Math.max(Number(limit) || 40, 1), 200)]
  );
  return rows.map((row) => ({ ...row, credit_limit: Number(row.credit_limit), due_days: Number(row.due_days) }));
};

export const saveCustomerTerms = async ({ tenantId, customerId, price_list_id = null, credit_limit = 0, due_days = 0, notes = "" }) => {
  await ensureWholesaleSchema();
  const id = idOf(customerId);
  const { rows: [customer] } = await db.query("SELECT id FROM customers WHERE tenant_id = $1 AND id = $2", [tenantId, id]);
  if (!customer) throw fail("العميل مش موجود", 404);
  const limit = Number(credit_limit) || 0;
  const days = Math.trunc(Number(due_days) || 0);
  if (limit < 0 || days < 0) throw fail("حد الائتمان ومدة السداد لازم يكونوا أرقام موجبة");
  const listId = idOf(price_list_id);
  if (listId) {
    const { rowCount } = await db.query("SELECT 1 FROM wholesale_price_lists WHERE tenant_id = $1 AND id = $2", [tenantId, listId]);
    if (!rowCount) throw fail("قائمة الأسعار مش موجودة", 404);
  }
  const { rows: [row] } = await db.query(
    `INSERT INTO wholesale_customer_terms (tenant_id, customer_id, price_list_id, credit_limit, due_days, notes, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (tenant_id, customer_id) DO UPDATE
       SET price_list_id = EXCLUDED.price_list_id, credit_limit = EXCLUDED.credit_limit,
           due_days = EXCLUDED.due_days, notes = EXCLUDED.notes, updated_at = NOW()
     RETURNING *`,
    [tenantId, id, listId, roundMoney(limit), days, text(notes)]
  );
  return { ...row, credit_limit: Number(row.credit_limit) };
};

/* -------------------------------- invoice -------------------------------- */

const resolvePriceList = async ({ tenantId, customerId, priceListId }) => {
  const explicit = idOf(priceListId);
  if (explicit) {
    const { rows: [row] } = await db.query("SELECT id, name FROM wholesale_price_lists WHERE tenant_id = $1 AND id = $2 AND is_active", [tenantId, explicit]);
    if (row) return row;
  }
  if (idOf(customerId)) {
    const { rows: [row] } = await db.query(
      `SELECT pl.id, pl.name FROM wholesale_customer_terms t
         JOIN wholesale_price_lists pl ON pl.id = t.price_list_id AND pl.is_active
        WHERE t.tenant_id = $1 AND t.customer_id = $2`,
      [tenantId, idOf(customerId)]
    );
    if (row) return row;
  }
  const { rows: [fallback] } = await db.query(
    "SELECT id, name FROM wholesale_price_lists WHERE tenant_id = $1 AND is_active ORDER BY is_default DESC, sort_order, id LIMIT 1",
    [tenantId]
  );
  if (!fallback) throw fail("اعمل قائمة أسعار واحدة على الأقل (جملة مثلاً)");
  return fallback;
};

/**
 * Prices and splits an invoice without saving anything. Prices come only from the
 * price list -- a body price is never read.
 */
export const previewWholesaleInvoice = async ({ tenantId, customerId = null, priceListId = null, lines = [] }) => {
  await ensureWholesaleSchema();
  if (!Array.isArray(lines) || !lines.length) throw fail("الفاتورة فاضية");
  const priceList = await resolvePriceList({ tenantId, customerId, priceListId });

  if (lines.some((line) => !idOf(line?.product_id))) throw fail("كل سطر لازم يكون عليه منتج");
  const productIds = [...new Set(lines.map((line) => idOf(line.product_id)))];
  const { rows: products } = await db.query("SELECT id, name FROM products WHERE tenant_id = $1 AND id = ANY($2::bigint[])", [tenantId, productIds]);
  const productById = new Map(products.map((p) => [Number(p.id), p]));
  const { rows: priceRows } = await db.query(
    "SELECT product_id, unit, piece_price FROM wholesale_prices WHERE tenant_id = $1 AND price_list_id = $2 AND product_id = ANY($3::bigint[])",
    [tenantId, priceList.id, productIds]
  );
  const priceOf = new Map(priceRows.map((r) => [`${r.product_id}|${r.unit}`, Number(r.piece_price)]));

  const cache = new Map();
  const productData = async (productId) => {
    if (!cache.has(productId)) {
      const [variants, pack] = await Promise.all([loadVariants(db, { tenantId, productId }), loadPack(db, { tenantId, productId })]);
      cache.set(productId, { variants, index: indexVariants(variants), pack: pack || { series_sizes: [], sell_piece: true, cartons: [] } });
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
      exploded = explodeLine(line, data.pack, data.index);
    } catch (error) {
      throw fail(`${product.name}: ${error.message}`, error.status || 400, error.code);
    }
    const piecePrice = priceOf.get(`${productId}|${exploded.unit}`);
    if (piecePrice === undefined) {
      throw fail(`${product.name}: مفيش سعر ${exploded.unit === "piece" ? "قطعة" : exploded.unit === "series" ? "سيرية" : "كرتونة"} في قائمة "${priceList.name}"`, 400, "WHOLESALE_PRICE_MISSING");
    }
    out.push({
      product_id: productId,
      product_name: product.name,
      unit: exploded.unit,
      unit_label: unitLabel(exploded.unit, data.pack, text(line.carton_key)),
      unit_qty: exploded.qty,
      carton_key: exploded.unit === "carton" ? text(line.carton_key) : null,
      colors: exploded.unit === "carton" ? line.colors.map(text) : [text(line.color)].filter(Boolean),
      size: exploded.unit === "piece" ? text(line.size) : null,
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
    price_list: priceList,
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
 * price-list piece price; this module only adds the wholesale view of the lines.
 *
 * payment: { mode: "cash" | "credit" | "partial", method, paid_amount }
 */
export const createWholesaleInvoice = async ({ req, tenantId, body = {} }) => {
  const preview = await previewWholesaleInvoice({
    tenantId,
    customerId: body.customer_id,
    priceListId: body.price_list_id,
    lines: body.lines,
  });
  if (preview.shortages.length) {
    const first = preview.shortages[0];
    throw Object.assign(fail(`المخزون مش كفاية: ${first.color} مقاس ${first.size} مطلوب ${first.wanted} والموجود ${first.stock}`, 409, "WHOLESALE_STOCK_SHORT"), { shortages: preview.shortages });
  }

  const customerId = idOf(body.customer_id);
  const payment = body.payment && typeof body.payment === "object" ? body.payment : {};
  const mode = ["cash", "credit", "partial"].includes(payment.mode) ? payment.mode : "cash";
  const method = PAYMENT_METHODS.has(payment.method) ? payment.method : "cash";
  const total = preview.total;
  if ((mode === "credit" || mode === "partial") && !customerId) throw fail("البيع الآجل محتاج عميل");
  let paid = mode === "cash" ? total : mode === "credit" ? 0 : roundMoney(Number(payment.paid_amount) || 0);
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
    amount_due_now: mode === "cash" ? total : roundMoney(total - paid) || total,
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
    notes: text(body.notes) || `فاتورة جملة — ${preview.price_list.name}`,
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
             (tenant_id, order_id, product_id, product_name, unit, unit_label, unit_qty, colors, pieces, piece_price, line_total, composition, price_list_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12::jsonb, $13)`,
          [tenantId, orderId, line.product_id, line.product_name, line.unit, line.unit_label, line.unit_qty,
            JSON.stringify(line.colors), line.pieces, line.piece_price, line.line_total, JSON.stringify(line.composition), preview.price_list.id]
        );
      }
    } catch (error) {
      // The sale itself is committed; only the wholesale summary is missing.
      console.error("[wholesale] invoice lines not stored", { order_id: orderId, message: error?.message });
    }
  }

  return { ...result.body, wholesale: { price_list: preview.price_list, lines: preview.lines, pieces: preview.pieces, total } };
};

export const getWholesaleInvoiceLines = async ({ tenantId, orderId }) => {
  await ensureWholesaleSchema();
  const { rows } = await db.query(
    `SELECT product_id, product_name, unit, unit_label, unit_qty, colors, pieces, piece_price, line_total
       FROM wholesale_invoice_lines WHERE tenant_id = $1 AND order_id = $2 ORDER BY id`,
    [tenantId, idOf(orderId)]
  );
  return rows.map((row) => ({ ...row, piece_price: Number(row.piece_price), line_total: Number(row.line_total) }));
};
