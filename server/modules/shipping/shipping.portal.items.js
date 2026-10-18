import db from "../../database/db.js";
import { loadColumns, tableExists } from "./onlineOrderSql.js";

// What is inside an online order — its lines, discount and shipping fee — edited from
// the manager portal's ⋮ → تعديل (owner request 2026-10-19). The edit itself runs
// through editOrder's line path (shipping.portal.manage.js), exactly what the POS edit
// runs, so stock moves back and forth, the coupon is re-priced, the employee-advance /
// loyalty rules apply and cod_amount follows the new total. This file only:
//   - finds products to add (searchPortalOrderProducts), priced by the one customer-price
//     authority (priceOrderLineVariant), never by a figure the phone sends;
//   - turns the phone's lines into the body editOrder expects (planPortalOrderItems),
//     refusing what editOrder would get wrong for an online order.

const text = (value = "") => String(value ?? "").trim();
const number = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const money = (value) => Math.round(Math.max(0, number(value)) * 100) / 100;
const MAX_LINES = 30;
const MAX_QUANTITY = 99;

export const itemsError = (status, code, message, extra = {}) =>
  Object.assign(new Error(message), { status, code, ...extra });

// The shipping fee the order's total already carries. Inbox orders keep it in
// shipping_cost / shipping_fee (service_fee 0), website orders in both, the till in
// service_fee — the first one set is the fee.
export const orderShippingFee = (raw = {}) =>
  money(number(raw.shipping_fee) || number(raw.shipping_cost) || number(raw.delivery_fee) || number(raw.service_fee));

// The seller's own invoice discount, coupon excluded (the coupon is re-priced by editOrder).
const currentInvoiceDiscount = (raw = {}) => {
  const type = ["percent", "percentage"].includes(text(raw.invoice_discount_type).toLowerCase()) ? "percentage" : "fixed";
  const amount = money(raw.invoice_discount_amount);
  return { type, value: number(raw.invoice_discount_value), amount };
};

/*
 * Pure: the phone's lines → editOrder's body. `order` is the shaped portal order
 * (its items carry id / variant_id / unit_price / quantity), `raw` the order's money
 * columns, `variantsById` loadOrderLineVariants rows for every variant the lines name,
 * `priceOf(row)` the customer-price authority.
 */
export const planPortalOrderItems = ({
  order = {},
  raw = {},
  lines = [],
  variantsById = new Map(),
  priceOf = () => 0,
  lineDiscountByItemId = new Map(),
  discountAmount,
  shippingFee,
} = {}) => {
  if (!Array.isArray(lines)) throw itemsError(400, "ITEMS_INVALID", "Items must be a list");
  const oldItems = Array.isArray(order.items) ? order.items : [];
  if (oldItems.some((item) => number(item.returned_quantity) > 0)) {
    throw itemsError(409, "ORDER_HAS_RETURNS", "الأوردر عليه مرتجع، عدّل المنتجات بالاستبدال أو المرتجع");
  }
  const wanted = lines
    .map((line) => ({
      order_item_id: text(line?.order_item_id),
      variant_id: Number(line?.variant_id),
      quantity: Math.trunc(number(line?.quantity)),
      unit_price: line?.unit_price,
    }))
    .filter((line) => line.quantity > 0);
  if (!wanted.length) throw itemsError(400, "ITEMS_EMPTY", "لازم يفضل في الأوردر منتج واحد على الأقل");
  if (wanted.length > MAX_LINES) throw itemsError(400, "ITEMS_TOO_MANY", "Too many lines");

  const oldById = new Map(oldItems.map((item) => [text(item.id), item]));
  const oldQuantityByVariant = new Map();
  for (const item of oldItems) {
    const key = String(Number(item.variant_id) || "");
    if (key) oldQuantityByVariant.set(key, (oldQuantityByVariant.get(key) || 0) + number(item.quantity));
  }

  const items = [];
  const neededByVariant = new Map();
  for (const line of wanted) {
    if (line.quantity > MAX_QUANTITY) throw itemsError(400, "QUANTITY_TOO_HIGH", `Quantity cannot exceed ${MAX_QUANTITY}`);
    const variantId = Number.isInteger(line.variant_id) && line.variant_id > 0 ? line.variant_id : null;
    // A line stays "the same line" only while it keeps its variant: a size swap is a
    // new line and is priced as one. An old line with no variant at all (a product
    // without sizes) may stay exactly as it is.
    const old = line.order_item_id ? oldById.get(line.order_item_id) : null;
    const kept = old && (Number(old.variant_id) || null) === variantId ? old : null;
    if (!variantId && !kept) throw itemsError(400, "VARIANT_REQUIRED", "اختار اللون والمقاس لكل منتج");
    const row = variantId ? variantsById.get(variantId) || null : null;
    if (!kept && !row) throw itemsError(409, "VARIANT_NOT_FOUND", "مقاس أو لون من اللي اخترتهم مبقاش موجود");
    const basePrice = kept ? money(kept.unit_price) : money(priceOf(row));
    const requestedPrice = line.unit_price === undefined || line.unit_price === null || line.unit_price === "" ? NaN : number(line.unit_price, NaN);
    const price = Number.isFinite(requestedPrice) && requestedPrice > 0 ? money(requestedPrice) : basePrice;
    // A line that was already on the invoice keeps whatever it was sold at, even 0.
    if (!kept && !(price > 0)) throw itemsError(409, "PRICE_MISSING", `${text(row?.product_name)}: مالوش سعر بيع`);
    // A line discount the till gave rides along per unit.
    const oldDiscount = kept ? number(lineDiscountByItemId.get(text(kept.id))) : 0;
    const perUnitDiscount = kept && number(kept.quantity) > 0 ? oldDiscount / number(kept.quantity) : 0;
    items.push({
      product_id: row?.product_id ?? kept?.product_id ?? null,
      variant_id: variantId,
      product_name: text(row?.product_name || kept?.product_name),
      color: text(row?.color ?? kept?.color),
      size: text(row?.size ?? kept?.size),
      sku: text(row?.sku || kept?.sku),
      barcode: text(row?.barcode),
      quantity: line.quantity,
      price,
      discount_amount: money(perUnitDiscount * line.quantity),
    });
    if (variantId) neededByVariant.set(String(variantId), (neededByVariant.get(String(variantId)) || 0) + line.quantity);
  }

  // Stock: what the order already holds comes back first, so keeping a line never
  // needs fresh stock; only what goes beyond it does.
  const short = [];
  for (const [key, needed] of neededByVariant) {
    const held = oldQuantityByVariant.get(key) || 0;
    if (needed <= held) continue;
    const row = variantsById.get(Number(key));
    const available = Math.max(0, number(row?.stock)) + held;
    if (needed > available) {
      short.push({ variant_id: Number(key), product_name: text(row?.product_name), color: text(row?.color), size: text(row?.size), requested: needed, available });
    }
  }
  if (short.length) {
    const first = short[0];
    throw itemsError(409, "OUT_OF_STOCK", `${[first.product_name, first.color, first.size].filter(Boolean).join(" - ")}: المتاح ${first.available} بس`, { out_of_stock: short });
  }

  const subtotal = money(items.reduce((sum, item) => sum + item.price * item.quantity, 0));
  const lineDiscount = money(items.reduce((sum, item) => sum + Math.min(item.discount_amount, item.price * item.quantity), 0));
  const current = currentInvoiceDiscount(raw);
  const requestedDiscount = discountAmount === undefined || discountAmount === null || discountAmount === "" ? null : money(discountAmount);
  // Untouched, a percent discount stays a percent of the new goods (how the inbox
  // composer saved it); a typed amount is that amount.
  const keepCurrent = requestedDiscount === null || Math.abs(requestedDiscount - current.amount) <= 0.009;
  const invoiceDiscount = keepCurrent
    ? current.type === "percentage" && current.value > 0
      ? { type: "percentage", value: Math.min(100, current.value), amount: money((Math.max(0, subtotal - lineDiscount) * Math.min(100, current.value)) / 100) }
      : { type: "fixed", value: Math.min(current.amount, subtotal - lineDiscount), amount: money(Math.min(current.amount, subtotal - lineDiscount)) }
    : { type: "fixed", value: requestedDiscount, amount: requestedDiscount };
  if (invoiceDiscount.amount - (subtotal - lineDiscount) > 0.009) {
    throw itemsError(400, "DISCOUNT_TOO_HIGH", "الخصم أكبر من سعر المنتجات");
  }

  const currentFee = orderShippingFee(raw);
  const fee = shippingFee === undefined || shippingFee === null || shippingFee === "" ? currentFee : money(shippingFee);
  const tax = money(raw.tax_amount);
  const coupon = money(raw.coupon_discount_amount);
  const estimatedTotal = money(Math.max(0, subtotal - lineDiscount - invoiceDiscount.amount - coupon + fee + tax));
  const paid = money(raw.paid_amount);
  // editOrder would book the difference as a refund out of a till drawer — not
  // something a manager's phone can hand back.
  if (paid > 0.009 && estimatedTotal + 0.009 < paid) {
    throw itemsError(409, "REFUND_NEEDED", `العميل دافع ${paid} والإجمالي الجديد ${estimatedTotal} — رجّع الفرق من الكاشير`);
  }

  const sameLines = items.length === oldItems.length && items.every((item, index) => {
    const old = oldItems[index];
    return (Number(old.variant_id) || null) === item.variant_id && number(old.quantity) === item.quantity && Math.abs(money(old.unit_price) - item.price) <= 0.009;
  });
  const changed = !sameLines || !keepCurrent || Math.abs(fee - currentFee) > 0.009;

  return {
    changed,
    shipping_fee_changed: Math.abs(fee - currentFee) > 0.009,
    shipping_fee: fee,
    estimated_total: estimatedTotal,
    body: {
      items,
      invoice_discount_type: invoiceDiscount.type,
      invoice_discount_value: invoiceDiscount.value,
      invoice_discount_amount: invoiceDiscount.type === "fixed" ? invoiceDiscount.amount : 0,
      invoice_discount_reason: text(raw.invoice_discount_reason),
      // item + invoice discount, coupon excluded — the contract editOrder documents.
      discount_amount: money(lineDiscount + invoiceDiscount.amount),
      service_fee: fee,
      tax_amount: tax,
      // Nothing is collected on the phone: the courier collects the balance. A credit
      // word makes editOrder keep the order's own (COD / transfer) method and recompute
      // its payment status instead of leaving "paid" on a raised total.
      paid_amount: 0,
      additional_payment_breakdown: [],
      payment_method: "deferred",
    },
  };
};

// The order's money columns + any line discounts, read once for the plan.
export const loadOrderMoneyRow = async ({ orderId, client = db }) => {
  const result = await client.query(
    `SELECT id, subtotal, discount_amount, coupon_discount_amount, invoice_discount_type, invoice_discount_value,
            invoice_discount_amount, invoice_discount_reason, tax_amount, service_fee, shipping_cost, shipping_fee,
            delivery_fee, paid_amount, total_amount
     FROM orders WHERE id = $1`,
    [orderId]
  );
  const itemColumns = await loadColumns("order_items", client);
  const discounts = new Map();
  if (itemColumns.has("discount_amount")) {
    const lines = await client.query(`SELECT id, COALESCE(discount_amount, 0)::numeric AS discount_amount FROM order_items WHERE order_id = $1`, [orderId]);
    for (const line of lines.rows) discounts.set(String(line.id), number(line.discount_amount));
  }
  return { raw: result.rows[0] || {}, lineDiscountByItemId: discounts };
};

/*
 * Products to add to an order: name, article code, SKU or barcode. One entry per
 * product with every active colour/size, its stock, photo and the price the customer
 * pays. Staff-facing, so stock 0 is listed (greyed on the phone) rather than hidden.
 */
export const searchPortalOrderProducts = async ({ tenantId = null, query = "", productId = null, client = db, loadVariants, priceOf, saleModeEnabled = false } = {}) => {
  const term = text(query).slice(0, 80);
  const wantedProductId = Number(productId);
  // One product's colours and sizes: the "change size / colour" on a line already in the order.
  const byId = Number.isInteger(wantedProductId) && wantedProductId > 0;
  if (!byId && term.length < 2) return [];
  const [productColumns, variantColumns, hasVariantImages] = await Promise.all([
    loadColumns("products", client),
    loadColumns("product_variants", client),
    tableExists("product_variant_images", client),
  ]);
  const like = `%${term.toLowerCase()}%`;
  const matchers = ["LOWER(COALESCE(p.name, '')) LIKE $2"];
  for (const column of ["sku", "barcode", "article_code"]) {
    if (variantColumns.has(column)) matchers.push(`LOWER(COALESCE(pv.${column}, '')) LIKE $2`);
  }
  for (const column of ["sku", "barcode", "article_code", "model"]) {
    if (productColumns.has(column)) matchers.push(`LOWER(COALESCE(p.${column}::text, '')) LIKE $2`);
  }
  const productActive = productColumns.has("status")
    ? "AND COALESCE(NULLIF(LOWER(TRIM(p.status)), ''), 'active') NOT IN ('inactive','disabled','archived','deleted')"
    : "";
  const productNotDeleted = productColumns.has("deleted_at") ? "AND p.deleted_at IS NULL" : "";
  const found = await client.query(
    `
    SELECT p.id
    FROM products p
    JOIN product_variants pv ON pv.product_id = p.id
      AND pv.is_active IS DISTINCT FROM FALSE
      AND pv.deleted_at IS NULL
    WHERE ($1::bigint IS NULL OR p.tenant_id = $1::bigint)
      ${productActive}
      ${productNotDeleted}
      AND (${byId ? "p.id = $2::bigint" : matchers.join(" OR ")})
    GROUP BY p.id
    ORDER BY SUM(GREATEST(COALESCE(pv.stock, 0), 0)) > 0 DESC${byId ? "" : ", MAX(CASE WHEN LOWER(COALESCE(p.name, '')) LIKE $3 THEN 1 ELSE 0 END) DESC"}, p.id DESC
    LIMIT 12
    `,
    // Every $n named in the text is bound, and only those (an unreferenced one has no type).
    byId ? [tenantId, wantedProductId] : [tenantId, like, `${term.toLowerCase()}%`]
  );
  const productIds = found.rows.map((row) => Number(row.id));
  if (!productIds.length) return [];
  const variants = await client.query(
    `
    SELECT
      pv.id AS variant_id,
      pv.product_id,
      COALESCE(
        NULLIF(pv.image_url, ''),
        ${hasVariantImages ? "NULLIF(colour_image.image_url, '')," : ""}
        NULLIF(p.image_url, ''),
        ''
      ) AS image_url
    FROM product_variants pv
    JOIN products p ON p.id = pv.product_id
    ${hasVariantImages ? `
    LEFT JOIN LATERAL (
      SELECT pvi.image_url
      FROM product_variant_images pvi
      WHERE pvi.product_id = p.id
        AND NULLIF(pvi.image_url, '') IS NOT NULL
        AND (NULLIF(pvi.color_name, '') IS NULL OR LOWER(pvi.color_name) = LOWER(COALESCE(pv.color, '')))
      ORDER BY (LOWER(COALESCE(pvi.color_name, '')) = LOWER(COALESCE(pv.color, ''))) DESC, pvi.is_primary DESC, pvi.sort_order ASC, pvi.id ASC
      LIMIT 1
    ) colour_image ON TRUE` : ""}
    WHERE pv.product_id = ANY($1::bigint[])
      AND pv.is_active IS DISTINCT FROM FALSE
      AND pv.deleted_at IS NULL
    ORDER BY pv.product_id, pv.color, pv.id
    `,
    [productIds]
  );
  const imageByVariant = new Map(variants.rows.map((row) => [Number(row.variant_id), text(row.image_url)]));
  const rows = await loadVariants({ tenantId, variantIds: [...imageByVariant.keys()] });
  const byProduct = new Map(productIds.map((id) => [id, null]));
  for (const row of rows.values()) {
    const productId = Number(row.product_id);
    if (!byProduct.has(productId)) continue;
    if (!byProduct.get(productId)) {
      byProduct.set(productId, { product_id: productId, name: text(row.product_name), image_url: imageByVariant.get(Number(row.variant_id)) || "", variants: [] });
    }
    byProduct.get(productId).variants.push({
      variant_id: Number(row.variant_id),
      color: text(row.color),
      size: text(row.size),
      sku: text(row.sku),
      stock: Math.max(0, number(row.stock)),
      price: money(priceOf(row, { saleModeEnabled })),
      image_url: imageByVariant.get(Number(row.variant_id)) || "",
    });
  }
  // Colour by colour, sizes in their natural order (33 before 38, "M" before "XL" is not
  // promised — text sizes keep the alphabet).
  const sizeOrder = (a, b) => a.color.localeCompare(b.color) || a.size.localeCompare(b.size, undefined, { numeric: true });
  return [...byProduct.values()].filter(Boolean).map((product) => ({ ...product, variants: product.variants.sort(sizeOrder) }));
};
