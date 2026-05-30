import db from "../../database/db.js";
import { normalizeShippingProviderKey } from "../../services/shippingProviders/index.js";
import {
  createBostaShipmentForOrder,
  ensureShippingSchema,
  refreshBostaShipmentForOrder,
} from "./shipping.service.js";

const text = (value = "") => String(value ?? "").trim();
const number = (value, fallback = 0) => {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
};

const CENTER_STATUSES = [
  "ready_to_ship",
  "shipment_created",
  "picked_up",
  "in_transit",
  "out_for_delivery",
  "delivered",
  "returned",
  "failed_delivery",
];

const statusAliases = new Map([
  ["created", "shipment_created"],
  ["shipment_created", "shipment_created"],
  ["pending", "ready_to_ship"],
  ["ready_to_ship", "ready_to_ship"],
  ["picked_up", "picked_up"],
  ["in_transit", "in_transit"],
  ["out_for_delivery", "out_for_delivery"],
  ["delivered", "delivered"],
  ["returned", "returned"],
  ["return", "returned"],
  ["failed", "failed_delivery"],
  ["failed_delivery", "failed_delivery"],
]);

const normalizeStatus = (value = "") => {
  const key = text(value).toLowerCase().replace(/[\s-]+/g, "_");
  return statusAliases.get(key) || key || "ready_to_ship";
};

const addFilter = (filters, params, sql, value) => {
  params.push(value);
  filters.push(sql.replace("?", `$${params.length}`));
};

const buildWhere = (query = {}) => {
  const filters = [
    "COALESCE(o.deleted_at IS NULL, TRUE)",
    "LOWER(COALESCE(o.status, '')) <> 'cancelled'",
    "LOWER(COALESCE(o.shipment_status, o.shipping_status, '')) <> 'cancelled'",
    "COALESCE(o.shipping_provider, '') <> ''",
    "COALESCE(o.shipping_provider, 'manual') <> 'manual'",
  ];
  const params = [];

  if (query.provider) addFilter(filters, params, "COALESCE(o.shipping_provider_id, o.shipping_provider) = ?", text(query.provider));
  if (query.branchId) addFilter(filters, params, "o.branch_id::text = ?", text(query.branchId));
  if (query.shippingStatus) addFilter(filters, params, "COALESCE(o.shipment_status, o.shipping_status, 'ready_to_ship') = ?", normalizeStatus(query.shippingStatus));
  if (query.paymentStatus) addFilter(filters, params, "COALESCE(o.payment_status, '') = ?", text(query.paymentStatus));
  if (query.paymentType === "cod") filters.push("(LOWER(COALESCE(o.payment_method, '')) IN ('cod', 'cash_on_delivery') OR COALESCE(o.cod_amount, 0) > 0)");
  if (query.paymentType === "prepaid") filters.push("NOT (LOWER(COALESCE(o.payment_method, '')) IN ('cod', 'cash_on_delivery') OR COALESCE(o.cod_amount, 0) > 0)");
  if (query.dateFrom) addFilter(filters, params, "o.created_at >= ?::timestamp", text(query.dateFrom));
  if (query.dateTo) addFilter(filters, params, "o.created_at < (?::timestamp + INTERVAL '1 day')", text(query.dateTo));
  if (query.search) {
    params.push(`%${text(query.search)}%`);
    const index = params.length;
    filters.push(`(
      o.id::text ILIKE $${index}
      OR COALESCE(o.invoice_number, '') ILIKE $${index}
      OR COALESCE(o.public_order_number, '') ILIKE $${index}
      OR COALESCE(o.display_order_number, '') ILIKE $${index}
      OR COALESCE(o.customer_name, '') ILIKE $${index}
      OR COALESCE(o.customer_phone, '') ILIKE $${index}
      OR COALESCE(o.shipping_tracking_number, o.tracking_number, '') ILIKE $${index}
      OR COALESCE(o.shipping_provider_delivery_id, o.shipment_id, '') ILIKE $${index}
    )`);
  }

  return { where: filters.join(" AND "), params };
};

const selectSql = `
  SELECT
    o.id,
    COALESCE(o.public_order_number, o.display_order_number, o.invoice_number, 'ORD-' || o.id::text) AS order_number,
    o.invoice_number,
    o.customer_name,
    o.customer_phone,
    o.customer_address,
    o.governorate,
    o.city_area,
    o.landmark,
    o.shipping_address_line,
    o.street_address,
    o.building_number,
    o.floor_number,
    o.apartment_number,
    COALESCE(sc.name_en, o.city_area, o.governorate, '') AS city,
    COALESCE(o.shipping_provider_id, o.shipping_provider, 'in_store_delivery') AS shipping_provider_id,
    COALESCE(o.shipping_provider, o.shipping_provider_id, 'in_store_delivery') AS shipping_provider,
    COALESCE(o.shipping_tracking_number, o.tracking_number, '') AS tracking_number,
    COALESCE(o.shipping_provider_delivery_id, o.shipment_id, '') AS delivery_id,
    COALESCE(o.shipment_status, o.shipping_status, 'ready_to_ship') AS shipment_status,
    COALESCE(o.cod_amount, 0)::numeric AS cod_amount,
    COALESCE(o.total_amount, o.total, o.total_price, 0)::numeric AS order_total,
    COALESCE(o.payment_status, '') AS payment_status,
    COALESCE(o.payment_method, '') AS payment_method,
    o.created_at,
    COALESCE(o.shipping_last_synced_at, o.last_shipping_sync_at) AS last_sync,
    o.shipping_label_url,
    o.tracking_url,
    COALESCE(o.shipment_timeline, '[]'::jsonb) AS shipment_timeline,
    COALESCE(events.events, '[]'::jsonb) AS webhook_events
  FROM orders o
  LEFT JOIN shipping_cities sc
    ON sc.id::text = o.shipping_city_id OR sc.provider_city_id = o.shipping_city_id
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', se.id,
        'status', se.status,
        'provider', se.provider,
        'created_at', se.created_at,
        'payload', se.payload
      )
      ORDER BY se.created_at DESC, se.id DESC
    ) AS events
    FROM shipping_events se
    WHERE se.order_id = o.id
  ) events ON TRUE
`;

export const listShippingCenterOrders = async (query = {}) => {
  await ensureShippingSchema();
  const { where, params } = buildWhere(query);
  const limit = Math.max(1, Math.min(number(query.limit, 150), 500));
  const offset = Math.max(0, number(query.offset, 0));
  const dataParams = [...params, limit, offset];
  const data = await db.query(
    `
    ${selectSql}
    WHERE ${where}
    ORDER BY o.created_at DESC, o.id DESC
    LIMIT $${params.length + 1}
    OFFSET $${params.length + 2}
    `,
    dataParams
  );
  const count = await db.query(`SELECT COUNT(*)::int AS total FROM orders o WHERE ${where}`, params);
  return { orders: data.rows.map((row) => ({ ...row, shipment_status: normalizeStatus(row.shipment_status) })), total: count.rows[0]?.total || 0 };
};

export const getShippingCenterSummary = async (query = {}) => {
  await ensureShippingSchema();
  const { where, params } = buildWhere(query);
  const result = await db.query(
    `
    WITH base AS (
      SELECT *, COALESCE(shipment_status, shipping_status, 'ready_to_ship') AS normalized_status
      FROM orders o
      WHERE ${where}
    ),
    status_counts AS (
      SELECT normalized_status, COUNT(*)::int AS count FROM base GROUP BY normalized_status
    ),
    provider_counts AS (
      SELECT COALESCE(shipping_provider_id, shipping_provider, 'in_store_delivery') AS provider, COUNT(*)::int AS orders
      FROM base GROUP BY 1 ORDER BY orders DESC
    ),
    city_counts AS (
      SELECT COALESCE(city_area, governorate, 'Unknown') AS city, COUNT(*)::int AS orders
      FROM base GROUP BY 1 ORDER BY orders DESC LIMIT 12
    ),
    delivery_windows AS (
      SELECT delivered.order_id, EXTRACT(EPOCH FROM (delivered.created_at - created.created_at)) / 3600 AS hours
      FROM (
        SELECT DISTINCT ON (order_id) order_id, created_at FROM shipping_events WHERE status IN ('shipment_created', 'created') ORDER BY order_id, created_at ASC
      ) created
      JOIN (
        SELECT DISTINCT ON (order_id) order_id, created_at FROM shipping_events WHERE status = 'delivered' ORDER BY order_id, created_at DESC
      ) delivered ON delivered.order_id = created.order_id
    )
    SELECT
      COALESCE((SELECT jsonb_object_agg(normalized_status, count) FROM status_counts), '{}'::jsonb) AS kpis,
      COALESCE((SELECT COUNT(*)::int FROM base), 0) AS total_shipments,
      COALESCE((SELECT COUNT(*)::int FROM base WHERE normalized_status = 'delivered'), 0) AS delivered_count,
      COALESCE((SELECT COUNT(*)::int FROM base WHERE normalized_status = 'returned'), 0) AS returned_count,
      COALESCE((SELECT COUNT(*)::int FROM base WHERE normalized_status IN ('failed_delivery', 'failed')), 0) AS failed_count,
      COALESCE((SELECT AVG(hours)::numeric(12,2) FROM delivery_windows), 0) AS average_delivery_hours,
      COALESCE((SELECT jsonb_agg(provider_counts) FROM provider_counts), '[]'::jsonb) AS orders_per_provider,
      COALESCE((SELECT jsonb_agg(city_counts) FROM city_counts), '[]'::jsonb) AS orders_per_city
    `,
    params
  );
  const row = result.rows[0] || {};
  const kpis = Object.fromEntries(CENTER_STATUSES.map((status) => [status, 0]));
  Object.entries(row.kpis || {}).forEach(([key, value]) => {
    const normalized = normalizeStatus(key);
    if (normalized in kpis) kpis[normalized] += Number(value || 0);
  });
  const total = Number(row.total_shipments || 0);
  return {
    statuses: kpis,
    analytics: {
      delivery_success_rate: total ? Math.round((Number(row.delivered_count || 0) / total) * 1000) / 10 : 0,
      return_rate: total ? Math.round((Number(row.returned_count || 0) / total) * 1000) / 10 : 0,
      failed_rate: total ? Math.round((Number(row.failed_count || 0) / total) * 1000) / 10 : 0,
      average_delivery_hours: Number(row.average_delivery_hours || 0),
      orders_per_provider: row.orders_per_provider || [],
      orders_per_city: row.orders_per_city || [],
    },
  };
};

export const getShippingCenterMeta = async () => {
  await ensureShippingSchema();
  const [providers, branches] = await Promise.all([
    db.query("SELECT DISTINCT COALESCE(shipping_provider_id, shipping_provider, 'in_store_delivery') AS provider FROM orders WHERE COALESCE(shipping_provider, '') <> '' ORDER BY 1"),
    db.query("SELECT id, name FROM branches ORDER BY name").catch(() => ({ rows: [] })),
  ]);
  return {
    providers: [...new Set(["bosta", "mylerz", "aramex", "shipblu", "in_store_delivery", ...providers.rows.map((row) => row.provider).filter(Boolean)])],
    branches: branches.rows,
    statuses: CENTER_STATUSES,
  };
};

export const bulkShippingCenterAction = async ({ action, orderIds = [] } = {}) => {
  await ensureShippingSchema();
  const ids = [...new Set((Array.isArray(orderIds) ? orderIds : []).map((id) => Number(id)).filter(Number.isFinite))];
  if (!ids.length) {
    const error = new Error("Select at least one shipment");
    error.status = 400;
    throw error;
  }

  if (action === "mark_ready_to_ship") {
    const result = await db.query(
      `
      UPDATE orders
      SET shipping_status = 'ready_to_ship',
          shipment_status = 'ready_to_ship',
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ANY($1::int[])
      RETURNING id, shipping_status
      `,
      [ids]
    );
    return { updated: result.rows.length, results: result.rows };
  }

  if (action === "print_labels") {
    const result = await db.query(
      `
      SELECT id, COALESCE(shipping_label_url, '') AS label_url, COALESCE(shipping_tracking_number, tracking_number, '') AS tracking_number
      FROM orders
      WHERE id = ANY($1::int[])
      ORDER BY id
      `,
      [ids]
    );
    return { labels: result.rows, results: result.rows };
  }

  const results = [];
  for (const id of ids) {
    try {
      if (action === "create_shipments") {
        const providerResult = await db.query("SELECT COALESCE(shipping_provider_id, shipping_provider, '') AS provider FROM orders WHERE id = $1", [id]);
        const provider = normalizeShippingProviderKey(providerResult.rows[0]?.provider || "");
        if (provider !== "bosta") throw new Error(`Create shipment is currently implemented for Bosta orders only. Provider: ${provider || "unknown"}`);
        results.push({ order_id: id, success: true, result: await createBostaShipmentForOrder(id) });
      } else if (action === "refresh_status") {
        results.push({ order_id: id, success: true, result: await refreshBostaShipmentForOrder(id) });
      } else {
        const error = new Error("Unsupported shipping bulk action");
        error.status = 400;
        throw error;
      }
    } catch (error) {
      results.push({ order_id: id, success: false, message: error.message, code: error.code });
    }
  }
  return { results, failed: results.filter((row) => !row.success).length };
};

export const shippingCenterProviderInterface = {
  createShipment: "createShipment(order)",
  refreshStatus: "refreshStatus(order)",
  cancelShipment: "cancelShipment(order)",
  printLabel: "printLabel(order)",
  trackShipment: "trackShipment(order)",
};
