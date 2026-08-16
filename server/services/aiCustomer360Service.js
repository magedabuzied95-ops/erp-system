/**
 * Customer 360 — what the ERP already knows about this person, in the shape the
 * reply engine can actually use.
 *
 * The gap this closes: `ai_customer_profiles` only ever held what was said inside the
 * chat (a preferred size someone mentioned, colours they browsed). Meanwhile the ERP
 * knew their real order history, the sizes they actually kept, what they returned and
 * why, and whether a shipment is out for delivery right now — and none of it reached
 * the assistant. So the AI would ask a seven-order regular for their size, or greet
 * someone whose delivery was late that morning as a fresh lead.
 *
 * Two rules hold everywhere in here:
 *   - Customer-safe fields only. No cost, margin, supplier or wholesale value ever
 *     enters this payload, because it is built to be summarised into a prompt.
 *   - Schema-drift tolerant. Every column is probed before use, matching the house
 *     style in aiBusinessToolsService, so a tenant on an older schema degrades to a
 *     thinner card instead of throwing.
 */
import db from "../database/db.js";
import { getPhoneSearchVariants, normalizePhone, phoneSqlDigits } from "../utils/phoneSearch.js";

const text = (value = "") => String(value ?? "").trim();
const asArray = (value) => (Array.isArray(value) ? value : []);
const numeric = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const RECENT_ORDER_LIMIT = 5;
const SIZE_SAMPLE_LIMIT = 40;

/** Digits of a phone VALUE. (`phoneSqlDigits` builds the SQL side, for a column.) */
const phoneDigits = (value = "") => normalizePhone(value).replace(/\D/g, "");
const phoneVariantDigits = (value = "") =>
  getPhoneSearchVariants(value)
    .map((variant) => String(variant).replace(/\D/g, ""))
    .filter(Boolean);

const tableColumnsCache = new Map();

const getTableColumns = async (tableName) => {
  if (tableColumnsCache.has(tableName)) return tableColumnsCache.get(tableName);
  try {
    const result = await db.query(
      `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = $1
      `,
      [tableName]
    );
    const columns = new Set(result.rows.map((row) => row.column_name));
    tableColumnsCache.set(tableName, columns);
    return columns;
  } catch {
    const empty = new Set();
    tableColumnsCache.set(tableName, empty);
    return empty;
  }
};

export const clearCustomer360SchemaCache = () => tableColumnsCache.clear();

const emptyProfile = () => ({
  found: false,
  customer_id: null,
  name: "",
  tenure_months: 0,
  total_orders: 0,
  total_spent: 0,
  loyalty_tier: "",
  is_trusted: false,
  cod_enabled: true,
  purchased_sizes: [],
  purchased_colors: [],
  purchased_brands: [],
  recent_orders: [],
  open_shipments: [],
  returns_count: 0,
  return_reasons: [],
  last_order_at: null,
});

const monthsBetween = (from, to = new Date()) => {
  if (!from) return 0;
  const start = new Date(from);
  if (Number.isNaN(start.getTime())) return 0;
  return Math.max(0, Math.round((to.getTime() - start.getTime()) / (1000 * 60 * 60 * 24 * 30)));
};

const rankByFrequency = (values = [], limit = 4) => {
  const counts = new Map();
  for (const value of values) {
    const key = text(value);
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([value]) => value);
};

const loadCustomerRow = async ({ tenantId, phone, customerId }) => {
  const columns = await getCustomerColumns();
  if (!columns.size) return null;

  const selectable = [
    "id",
    "name",
    "phone",
    "created_at",
    "total_orders",
    "total_spent",
    "loyalty_tier",
    "completed_orders",
    "is_trusted",
    "cod_enabled",
  ].filter((column) => columns.has(column));
  if (!selectable.includes("id")) return null;

  if (customerId) {
    const byId = await db.query(
      `SELECT ${selectable.join(", ")} FROM customers WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
      [tenantId, customerId]
    );
    if (byId.rows[0]) return byId.rows[0];
  }

  const digits = phoneDigits(phone);
  if (!digits || !columns.has("phone")) return null;

  // Reuse the same phone-variant matching the rest of the ERP uses, so a customer
  // saved as 01024960585 still matches an inbound +201024960585.
  const byPhone = await db.query(
    `
    SELECT ${selectable.join(", ")}
    FROM customers
    WHERE tenant_id = $1
      AND ${phoneSqlDigits("phone")} = ANY($2::text[])
    ORDER BY id DESC
    LIMIT 1
    `,
    [tenantId, [...new Set([digits, ...phoneVariantDigits(phone)])]]
  );
  return byPhone.rows[0] || null;
};

const getCustomerColumns = () => getTableColumns("customers");

const loadOrders = async ({ tenantId, customerId, phone }) => {
  const columns = await getTableColumns("orders");
  if (!columns.has("id") || !columns.has("tenant_id")) return [];

  const selectable = [
    "id",
    "created_at",
    "status",
    "payment_status",
    "shipping_status",
    "shipment_status",
    "tracking_number",
    "expected_delivery_at",
    "public_order_number",
    "display_order_number",
    "invoice_number",
    "total_amount",
    "total",
    "total_price",
    "returned_at",
  ].filter((column) => columns.has(column));

  const conditions = [];
  const params = [tenantId];
  if (customerId && columns.has("customer_id")) {
    params.push(customerId);
    conditions.push(`o.customer_id = $${params.length}`);
  }
  const digits = phoneDigits(phone);
  if (digits && columns.has("customer_phone")) {
    params.push([...new Set([digits, ...phoneVariantDigits(phone)])]);
    conditions.push(`${phoneSqlDigits("o.customer_phone")} = ANY($${params.length}::text[])`);
  }
  if (!conditions.length) return [];

  const notDeleted = columns.has("deleted_at") ? "AND o.deleted_at IS NULL" : "";
  const orderBy = columns.has("created_at") ? "ORDER BY o.created_at DESC" : "ORDER BY o.id DESC";

  const result = await db.query(
    `
    SELECT ${selectable.map((column) => `o.${column}`).join(", ")}
    FROM orders o
    WHERE o.tenant_id = $1
      AND (${conditions.join(" OR ")})
      ${notDeleted}
    ${orderBy}
    LIMIT 25
    `,
    params
  );
  return result.rows;
};

/**
 * What the customer actually kept. Sizes they merely asked about are noise; sizes on
 * a delivered order that was not returned are the strongest size signal the business
 * has, and using it is what stops the assistant asking a repeat buyer for their size.
 */
const loadPurchasedItems = async ({ tenantId, orderIds }) => {
  if (!orderIds.length) return [];
  const columns = await getTableColumns("order_items");
  if (!columns.has("order_id")) return [];

  const selectable = ["order_id", "product_name", "size", "color", "quantity", "returned_quantity"].filter((column) =>
    columns.has(column)
  );
  if (!selectable.length) return [];

  const result = await db.query(
    `
    SELECT ${selectable.join(", ")}
    FROM order_items
    WHERE tenant_id = $1
      AND order_id = ANY($2::bigint[])
    LIMIT ${SIZE_SAMPLE_LIMIT}
    `,
    [tenantId, orderIds]
  );
  return result.rows;
};

const loadReturns = async ({ tenantId, orderIds }) => {
  if (!orderIds.length) return [];
  const columns = await getTableColumns("returns");
  if (!columns.has("order_id")) return [];

  const selectable = ["order_id", "reason", "status", "created_at"].filter((column) => columns.has(column));
  if (!selectable.length) return [];

  const result = await db.query(
    `
    SELECT ${selectable.join(", ")}
    FROM returns
    WHERE tenant_id = $1
      AND order_id = ANY($2::bigint[])
    ORDER BY created_at DESC
    LIMIT 10
    `,
    [tenantId, orderIds]
  );
  return result.rows;
};

const OPEN_SHIPMENT_STATES = new Set([
  "pending",
  "processing",
  "confirmed",
  "picked_up",
  "in_transit",
  "out_for_delivery",
  "shipped",
]);

const orderTotal = (row = {}) => numeric(row.total_amount ?? row.total ?? row.total_price, 0);

const orderLabel = (row = {}) =>
  text(row.public_order_number || row.display_order_number || row.invoice_number || row.id);

/**
 * Loads the full picture for one customer. Never throws — a profile failure must not
 * take down a reply, so every error path degrades to the empty profile.
 */
export const loadCustomer360 = async ({ tenantId, phone = "", customerId = null } = {}) => {
  const safeTenantId = Number(tenantId);
  if (!Number.isFinite(safeTenantId) || safeTenantId <= 0) return emptyProfile();
  if (!text(phone) && !customerId) return emptyProfile();

  try {
    const customer = await loadCustomerRow({ tenantId: safeTenantId, phone, customerId });
    const resolvedCustomerId = customer?.id ?? customerId ?? null;

    const orders = await loadOrders({ tenantId: safeTenantId, customerId: resolvedCustomerId, phone });
    const orderIds = orders.map((row) => row.id).filter((id) => id !== null && id !== undefined);

    const [items, returns] = await Promise.all([
      loadPurchasedItems({ tenantId: safeTenantId, orderIds }).catch(() => []),
      loadReturns({ tenantId: safeTenantId, orderIds }).catch(() => []),
    ]);

    const returnedOrderIds = new Set(returns.map((row) => String(row.order_id)));
    // Only count items from orders that were NOT returned — a returned size is
    // evidence against that size, not for it.
    const keptItems = items.filter(
      (item) => !returnedOrderIds.has(String(item.order_id)) && numeric(item.returned_quantity, 0) <= 0
    );

    const openShipments = orders
      .filter((row) => OPEN_SHIPMENT_STATES.has(text(row.shipping_status || row.shipment_status).toLowerCase()))
      .slice(0, 3)
      .map((row) => ({
        order: orderLabel(row),
        status: text(row.shipping_status || row.shipment_status),
        tracking_number: text(row.tracking_number),
        expected_delivery_at: row.expected_delivery_at || null,
      }));

    const totalOrders = numeric(customer?.total_orders, 0) || orders.length;
    const totalSpent = numeric(customer?.total_spent, 0) || orders.reduce((sum, row) => sum + orderTotal(row), 0);

    return {
      found: Boolean(customer) || orders.length > 0,
      customer_id: resolvedCustomerId,
      name: text(customer?.name),
      tenure_months: monthsBetween(customer?.created_at || orders.at(-1)?.created_at),
      total_orders: totalOrders,
      total_spent: Math.round(totalSpent),
      loyalty_tier: text(customer?.loyalty_tier),
      is_trusted: customer?.is_trusted === true,
      cod_enabled: customer?.cod_enabled !== false,
      purchased_sizes: rankByFrequency(keptItems.map((item) => item.size)),
      purchased_colors: rankByFrequency(keptItems.map((item) => item.color)),
      purchased_brands: rankByFrequency(keptItems.map((item) => item.product_name), 3),
      recent_orders: orders.slice(0, RECENT_ORDER_LIMIT).map((row) => ({
        order: orderLabel(row),
        status: text(row.status),
        total: Math.round(orderTotal(row)),
        created_at: row.created_at || null,
      })),
      open_shipments: openShipments,
      returns_count: returns.length,
      return_reasons: rankByFrequency(returns.map((row) => row.reason), 2),
      last_order_at: orders[0]?.created_at || null,
    };
  } catch (error) {
    console.warn("[ai-customer-360] load failed", {
      tenant_id: safeTenantId,
      message: error?.message,
    });
    return emptyProfile();
  }
};

/**
 * Compact Arabic-labelled card for the prompt. Deliberately terse: this is injected on
 * every turn, so it earns its tokens by dropping any line the data does not support.
 */
export const summarizeCustomer360 = (profile = {}) => {
  if (!profile?.found) return "";

  const lines = [];
  const identity = [
    profile.total_orders ? `${profile.total_orders} طلب` : "",
    profile.total_spent ? `${profile.total_spent} ج` : "",
    profile.tenure_months ? `عميل من ${profile.tenure_months} شهر` : "",
    profile.loyalty_tier || "",
  ]
    .filter(Boolean)
    .join(" · ");
  if (identity) lines.push(identity);

  if (profile.purchased_sizes?.length) lines.push(`مقاسات اشتراها واحتفظ بيها: ${profile.purchased_sizes.join("، ")}`);
  if (profile.purchased_colors?.length) lines.push(`ألوان بيميل ليها: ${profile.purchased_colors.join("، ")}`);
  if (profile.returns_count) {
    const reasons = profile.return_reasons?.length ? ` (${profile.return_reasons.join("، ")})` : "";
    lines.push(`مرتجعات سابقة: ${profile.returns_count}${reasons}`);
  }
  for (const shipment of asArray(profile.open_shipments)) {
    lines.push(`شحنة جارية: ${shipment.order} — ${shipment.status}`);
  }
  if (!profile.cod_enabled) lines.push("الدفع عند الاستلام موقوف لهذا العميل");

  return lines.join("\n");
};

/**
 * A single sentence of guidance derived from the profile. Kept separate from the facts
 * above so the facts stay auditable and the advice stays clearly advisory.
 */
export const customer360SalesHint = (profile = {}) => {
  if (!profile?.found) return "";
  if (profile.open_shipments?.length) return "عنده شحنة جارية — اسأل عنها قبل ما تعرض حاجة جديدة.";
  if (profile.returns_count >= 2) return "عنده مرتجعات متكررة — أكّد المقاس واللون بوضوح قبل التأكيد.";
  if (profile.purchased_sizes?.length) return "متعرفش تسأله عن مقاسه من الأول — أكّد المقاس اللي اشتراه قبل كده.";
  if (profile.total_orders >= 5) return "عميل متكرر — تعامل معاه على إنه يعرف المتجر، من غير شرح من الأول.";
  return "";
};
