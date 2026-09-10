import db from "../../database/db.js";

// The ONE definition of "an online / shipping order" — the أوردرات الشحن board, the
// actions on it, and the manager portal's اليوم tab (which must leave these orders
// out) all read it from here, so an order can never be counted in both places or in
// neither. No heavy imports on purpose: dashboardAnalyticsService pulls this in.

const ONLINE_ORIGINS = ["website", "storefront", "web", "online", "web_chat", "whatsapp", "instagram", "facebook", "messenger", "tiktok"];
// A courier value that means "no courier": the shop's own default, or a pickup.
const NO_COURIER_PROVIDERS = ["", "manual", "in_store_delivery", "none", "pickup", "store_pickup"];

const sqlList = (values) => values.map((value) => `'${value}'`).join(", ");
const normalizedSql = (expr) => `LOWER(REPLACE(REPLACE(TRIM(COALESCE(${expr}, '')), ' ', '_'), '-', '_'))`;

const COLUMN_CACHE_TTL_MS = 10 * 60 * 1000;
// Per client, so a test's fake client can never answer for the real pool.
const schemaCaches = new WeakMap();
const schemaCacheFor = (client) => {
  if (!schemaCaches.has(client)) schemaCaches.set(client, { columns: new Map(), tables: new Map() });
  return schemaCaches.get(client);
};

export const loadColumns = async (table, client = db) => {
  const cache = schemaCacheFor(client).columns;
  const cached = cache.get(table);
  if (cached && Date.now() - cached.at < COLUMN_CACHE_TTL_MS) return cached.columns;
  const result = await client.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1`,
    [table]
  );
  const columns = new Set(result.rows.map((row) => row.column_name));
  cache.set(table, { at: Date.now(), columns });
  return columns;
};

export const tableExists = async (table, client = db) => {
  const cache = schemaCacheFor(client).tables;
  const cached = cache.get(table);
  if (cached && Date.now() - cached.at < COLUMN_CACHE_TTL_MS) return cached.exists;
  const result = await client.query("SELECT to_regclass($1) AS regclass", [table]);
  const exists = Boolean(result.rows[0]?.regclass);
  cache.set(table, { at: Date.now(), exists });
  return exists;
};

// Every expression below is built against the columns this database actually has, so
// an install that predates a column (origin_surface, ai_agent_conversation_id, the
// Bosta block) still answers instead of failing the whole page.
export const buildPortalOnlineSql = (columns) => {
  const has = (name) => columns.has(name);
  const col = (name) => (has(name) ? `o.${name}` : "NULL");
  const firstCol = (...names) => {
    const present = names.filter(has).map((name) => `NULLIF(TRIM(o.${name}::text), '')`);
    return present.length ? `COALESCE(${present.join(", ")}, '')` : "''";
  };

  const trackingExpr = firstCol("shipping_tracking_number", "tracking_number");
  const shippingStatusExpr = normalizedSql(firstCol("shipment_status", "shipping_status"));
  const statusExpr = normalizedSql(col("status"));
  const paymentStatusExpr = normalizedSql(col("payment_status"));

  const originParts = [];
  if (has("source")) originParts.push(`LOWER(COALESCE(o.source, '')) IN (${sqlList(ONLINE_ORIGINS)})`);
  if (has("channel")) originParts.push(`LOWER(COALESCE(o.channel, '')) IN (${sqlList(ONLINE_ORIGINS)})`);
  if (has("origin_surface")) originParts.push(`o.origin_surface IS NOT NULL`);
  if (has("ai_agent_conversation_id")) originParts.push(`o.ai_agent_conversation_id IS NOT NULL`);
  if (has("shipping_provider")) originParts.push(`LOWER(COALESCE(o.shipping_provider, '')) NOT IN (${sqlList(NO_COURIER_PROVIDERS)})`);
  originParts.push(`${trackingExpr} <> ''`);
  const onlineExpr = `(${originParts.join(" OR ")})`;

  // Order of the branches is the order of precedence: an order that was shipped and
  // then returned is "closed", not "shipping", because that is where it is now.
  const groupExpr = `(CASE
    WHEN ${statusExpr} IN ('cancelled', 'canceled', 'cancelled_by_customer', 'customer_cancelled', 'rejected', 'payment_rejected', 'returned', 'refunded', 'fully_refunded', 'return_completed')
      OR ${shippingStatusExpr} IN ('returned', 'return', 'cancelled', 'canceled')
      OR ${paymentStatusExpr} = 'rejected'
      THEN 'closed'
    WHEN ${statusExpr} IN ('delivered', 'completed', 'complete')
      OR ${shippingStatusExpr} IN ('delivered', 'completed', 'complete')
      THEN 'delivered'
    WHEN ${statusExpr} IN ('shipment_created', 'shipped', 'shipping_created', 'out_for_delivery', 'in_transit')
      OR ${shippingStatusExpr} IN ('created', 'shipment_created', 'shipping_created', 'shipped', 'picked', 'picked_up', 'pickup_done', 'in_transit', 'on_the_way', 'out_for_delivery', 'failed', 'failed_delivery', 'delivery_failed')
      OR ${trackingExpr} <> ''
      THEN 'shipping'
    WHEN ${statusExpr} IN ('confirmed', 'paid', 'approved', 'ready_to_ship', 'processing', 'packed', 'ready', 'ready_for_shipping')
      THEN 'confirmed'
    ELSE 'new'
  END)`;

  const liveParts = [];
  if (has("deleted_at")) liveParts.push("o.deleted_at IS NULL");
  if (has("is_personal_transaction")) liveParts.push("o.is_personal_transaction IS DISTINCT FROM TRUE");
  // An AI draft is a conversation that might become an order, not an order.
  liveParts.push(`${statusExpr} <> 'ai_draft'`);

  return { onlineExpr, groupExpr, liveExpr: liveParts.join(" AND "), trackingExpr };
};

// For money views that must leave online orders out (the manager portal's اليوم tab).
// Only an online order that never went through a till is removed: a shop sale paid at
// the counter that is later handed to a courier keeps its cash in the drawer, so it
// stays in the day's accounts. Built on the server from the live column set — never
// from anything a request sends.
export const shopOnlyOrderClause = async ({ alias = "o", client = db } = {}) => {
  if (!/^[a-z_][a-z0-9_]*$/i.test(alias)) throw new Error("Invalid SQL alias");
  if (!(await tableExists("orders", client))) return "";
  const columns = await loadColumns("orders", client);
  const { onlineExpr } = buildPortalOnlineSql(columns);
  const aliased = alias === "o" ? onlineExpr : onlineExpr.replace(/\bo\./g, `${alias}.`);
  const tillFree = columns.has("shift_id") ? ` AND ${alias}.shift_id IS NULL` : "";
  return ` AND NOT (${aliased}${tillFree})`;
};
