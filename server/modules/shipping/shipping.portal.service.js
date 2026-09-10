import db from "../../database/db.js";
import { displayPublicOrderNumber } from "../../utils/publicOrderNumber.js";
import { orderCodAmount, orderOwedAmount } from "./shipping.service.js";
import { buildPortalOnlineSql, loadColumns, tableExists } from "./onlineOrderSql.js";

export { buildPortalOnlineSql };

// "أوردرات الشحن" for the employee and manager portals: every order that leaves the
// shop in a parcel, whichever door it came in through. There is no single column that
// says "online" — a website order, a till order raised in أوردر أونلاين mode, an AI
// inbox order and a POS sale that later got a Bosta parcel each mark themselves
// differently — so the filter is the union of those marks. Both portals read through
// this one module, so an employee and a manager can never disagree about which orders
// are on the list or which tab an order sits in.

const text = (value = "") => String(value ?? "").trim();
const lower = (value = "") => text(value).toLowerCase();
const number = (value, fallback = 0) => {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
};
const idOrNull = (value) => {
  const next = Number(value);
  return Number.isFinite(next) && next > 0 ? Math.trunc(next) : null;
};

export const PORTAL_ONLINE_GROUPS = ["new", "confirmed", "shipping", "delivered", "closed"];
export const PORTAL_ONLINE_RANGES = ["today", "7d", "30d", "90d", "all"];
const DEFAULT_RANGE = "30d";
const PAGE_SIZE = 30;

const rangeClause = (range) => {
  switch (range) {
    case "today":
      return "o.created_at >= date_trunc('day', NOW())";
    case "7d":
      return "o.created_at >= date_trunc('day', NOW()) - INTERVAL '6 days'";
    case "30d":
      return "o.created_at >= date_trunc('day', NOW()) - INTERVAL '29 days'";
    case "90d":
      return "o.created_at >= date_trunc('day', NOW()) - INTERVAL '89 days'";
    default:
      return "";
  }
};

// Phone numbers are typed as 010…, stored as +2010… or 2010…; match on the digits
// after the country code / trunk zero so all three forms find each other.
const phoneDigitsNeedle = (value = "") => {
  const digits = text(value).replace(/\D/g, "");
  if (digits.length < 6) return "";
  return digits.replace(/^(?:0020|20|0)/, "");
};

const buildSearch = (search, columns, params) => {
  const needle = text(search).slice(0, 80);
  if (!needle) return "";
  const has = (name) => columns.has(name);
  const parts = [];
  const orderNumber = needle.match(/^(?:[a-z]{2,4}-)?#?(\d{1,12})$/i);
  if (orderNumber) {
    params.push(Number(orderNumber[1]));
    parts.push(`o.id = $${params.length}::bigint`);
  }
  params.push(`%${needle}%`);
  const like = `$${params.length}`;
  ["invoice_number", "customer_name", "customer_phone", "shipping_tracking_number", "tracking_number"]
    .filter(has)
    .forEach((name) => parts.push(`COALESCE(o.${name}::text, '') ILIKE ${like}`));
  const phoneNeedle = phoneDigitsNeedle(needle);
  if (phoneNeedle && has("customer_phone")) {
    params.push(`%${phoneNeedle}%`);
    parts.push(`regexp_replace(COALESCE(o.customer_phone, ''), '\\D', '', 'g') LIKE $${params.length}`);
  }
  return parts.length ? `(${parts.join(" OR ")})` : "";
};

const buildBaseWhere = ({ columns, sql, tenantId, range, search }) => {
  const params = [];
  const filters = [];
  if (columns.has("tenant_id")) {
    if (tenantId) {
      params.push(tenantId);
      filters.push(`o.tenant_id = $${params.length}::bigint`);
    } else {
      filters.push("o.tenant_id IS NULL");
    }
  }
  filters.push(sql.liveExpr, sql.onlineExpr);
  const rangeSql = rangeClause(range);
  if (rangeSql) filters.push(rangeSql);
  const searchSql = buildSearch(search, columns, params);
  if (searchSql) filters.push(searchSql);
  return { where: filters.join("\n      AND "), params };
};

const itemsForOrders = async (orderIds, client = db) => {
  if (!orderIds.length || !(await tableExists("order_items", client))) return new Map();
  const [itemColumns, variantColumns, hasVariantImages, hasColorGroups] = await Promise.all([
    loadColumns("order_items", client),
    loadColumns("product_variants", client),
    tableExists("product_variant_images", client),
    tableExists("product_color_groups", client),
  ]);
  const itemCol = (name) => (itemColumns.has(name) ? `NULLIF(TRIM(oi.${name}::text), '')` : "NULL");
  // Article code has two levels: the size row's own code, else its colour's code (see
  // shared/articleCode.js) — the same resolution the product pages show.
  const variantArticleExpr = variantColumns.has("article_code") ? "NULLIF(TRIM(pv.article_code), '')" : "NULL";
  const colourArticleJoin = hasColorGroups && variantColumns.has("color_group_key")
    ? `
    LEFT JOIN LATERAL (
      SELECT NULLIF(TRIM(pcg.color_article_code), '') AS code
      FROM product_color_groups pcg
      WHERE pcg.product_id = pv.product_id
        AND pcg.color_group_key = pv.color_group_key
      LIMIT 1
    ) colour_article ON TRUE`
    : "";
  const colourArticleExpr = colourArticleJoin ? "colour_article.code" : "NULL";
  // Same image order as the POS order summary: the line's own snapshot, then the
  // variant, then the colour's gallery, then the product. Both LATERALs are equality
  // lookups, so a page of thirty orders stays one indexed query.
  const result = await client.query(
    `
    SELECT
      oi.id,
      oi.order_id,
      oi.product_id,
      oi.variant_id,
      COALESCE(NULLIF(p.name, ''), ${itemCol("product_name")}, '') AS product_name,
      COALESCE(${itemCol("color")}, NULLIF(pv.color, ''), '') AS color,
      COALESCE(${itemCol("size")}, NULLIF(pv.size, ''), '') AS size,
      COALESCE(${itemCol("sku")}, '') AS sku,
      COALESCE(${variantArticleExpr}, ${colourArticleExpr}, '') AS article_code,
      COALESCE(oi.quantity, 0)::numeric AS quantity,
      ${itemColumns.has("returned_quantity") ? "COALESCE(oi.returned_quantity, 0)::numeric" : "0::numeric"} AS returned_quantity,
      COALESCE(oi.sale_price, 0)::numeric AS unit_price,
      COALESCE(oi.total_amount, COALESCE(oi.sale_price, 0) * COALESCE(oi.quantity, 0), 0)::numeric AS line_total,
      COALESCE(
        ${itemCol("image_url")},
        ${itemCol("variant_image")},
        NULLIF(pv.image_url, ''),
        ${hasVariantImages ? "NULLIF(variant_image.image_url, '')," : ""}
        ${hasVariantImages ? "NULLIF(colour_image.image_url, '')," : ""}
        ${itemCol("product_image")},
        NULLIF(p.image_url, ''),
        ''
      ) AS image_url
    FROM order_items oi
    LEFT JOIN product_variants pv ON pv.id = oi.variant_id
    LEFT JOIN products p ON p.id = COALESCE(oi.product_id, pv.product_id)
    ${colourArticleJoin}
    ${hasVariantImages ? `
    LEFT JOIN LATERAL (
      SELECT pvi.image_url
      FROM product_variant_images pvi
      WHERE pvi.variant_id = pv.id
        AND NULLIF(pvi.image_url, '') IS NOT NULL
      ORDER BY pvi.is_primary DESC, pvi.sort_order ASC, pvi.id ASC
      LIMIT 1
    ) variant_image ON TRUE
    LEFT JOIN LATERAL (
      SELECT pvi.image_url
      FROM product_variant_images pvi
      WHERE pvi.product_id = p.id
        AND NULLIF(pvi.image_url, '') IS NOT NULL
        AND (
          NULLIF(pvi.color_name, '') IS NULL
          OR LOWER(pvi.color_name) = LOWER(COALESCE(pv.color, ''))
        )
      ORDER BY (LOWER(COALESCE(pvi.color_name, '')) = LOWER(COALESCE(pv.color, ''))) DESC, pvi.is_primary DESC, pvi.sort_order ASC, pvi.id ASC
      LIMIT 1
    ) colour_image ON TRUE` : ""}
    WHERE oi.order_id = ANY($1::bigint[])
    ORDER BY oi.order_id ASC, oi.id ASC
    `,
    [orderIds]
  );
  const byOrder = new Map();
  for (const row of result.rows) {
    const key = String(row.order_id);
    if (!byOrder.has(key)) byOrder.set(key, []);
    byOrder.get(key).push({
      id: row.id,
      product_id: row.product_id,
      variant_id: row.variant_id,
      product_name: row.product_name,
      color: row.color,
      size: row.size,
      sku: row.sku,
      article_code: row.article_code || "",
      quantity: number(row.quantity),
      returned_quantity: number(row.returned_quantity),
      unit_price: number(row.unit_price),
      line_total: number(row.line_total),
      image_url: row.image_url,
    });
  }
  return byOrder;
};

// "Which door did it come in through", said once here so both portals label the
// same order the same way.
export const portalOrderSourceKey = (order = {}) => {
  const origin = lower(order.origin_surface);
  if (origin === "pos") return "pos_online";
  const channel = lower(order.channel);
  const source = lower(order.source);
  for (const key of ["whatsapp", "instagram", "facebook", "tiktok"]) {
    if (channel === key || source === key) return key;
  }
  if (channel === "messenger" || source === "messenger") return "facebook";
  if (channel === "web_chat" || source === "web_chat") return "web_chat";
  if (["website", "storefront", "web", "online"].includes(channel) || ["website", "storefront", "web", "online"].includes(source)) return "website";
  if (order.ai_agent_conversation_id) return "web_chat";
  return "pos";
};

const joinAddress = (parts) => parts.map(text).filter(Boolean).join("، ");

const shapeOrder = (order = {}, items = []) => {
  const total = number(order.total_amount ?? order.total ?? order.total_price);
  const subtotal = number(order.subtotal) || items.reduce((sum, item) => sum + number(item.line_total), 0);
  const shippingFee = number(order.shipping_fee ?? order.delivery_fee ?? order.shipping_cost);
  const paid = number(order.paid_amount);
  const moneyBasis = { ...order, total_amount: total };
  return {
    id: order.id,
    order_number: displayPublicOrderNumber(order) || text(order.invoice_number) || `#${order.id}`,
    invoice_number: text(order.invoice_number),
    created_at: order.created_at,
    updated_at: order.updated_at || null,
    group: order.portal_group || "new",
    source: portalOrderSourceKey(order),
    status: text(order.status),
    shipping_status: text(order.shipment_status || order.shipping_status),
    whatsapp_confirmation_sent_at: order.whatsapp_confirmation_sent_at || null,
    whatsapp_confirmed_at: order.whatsapp_confirmed_at || null,
    whatsapp_cancelled_at: order.whatsapp_cancelled_at || null,
    customer: {
      name: text(order.customer_name),
      phone: text(order.customer_phone || order.customer_record_phone),
      email: text(order.customer_email),
    },
    address: {
      governorate: text(order.shipping_city_name_ar || order.governorate || order.shipping_city_name_en),
      city: text(order.shipping_zone_name_ar || order.city_area || order.shipping_zone_name_en),
      district: text(order.shipping_district_name_ar || order.shipping_district_name_en),
      street: text(order.street_address),
      building: text(order.building_number),
      floor: text(order.floor_number),
      apartment: text(order.apartment_number),
      landmark: text(order.landmark),
      full: text(order.customer_address) || text(order.shipping_address_line),
    },
    delivery_notes: text(order.delivery_notes),
    order_notes: text(order.order_notes || order.notes),
    money: {
      subtotal,
      discount: number(order.discount_amount),
      coupon_code: text(order.coupon_code),
      shipping_fee: shippingFee,
      total,
      paid,
      owed: orderOwedAmount(moneyBasis),
      collect_on_delivery: orderCodAmount(moneyBasis),
      payment_method: text(order.payment_method),
      payment_status: text(order.payment_status),
      transfer_proof_status: text(order.transfer_proof_status),
      payment_proof_url: text(order.shipping_payment_screenshot),
      courier_collected_amount: order.courier_collected_at ? number(order.courier_collected_amount) : null,
    },
    shipment: {
      provider: text(order.shipping_provider || order.shipping_provider_id),
      tracking_number: text(order.shipping_tracking_number || order.tracking_number),
      delivery_id: text(order.shipping_provider_delivery_id || order.shipment_id),
      tracking_url: text(order.tracking_url),
      label_url: text(order.shipping_label_url),
      last_synced_at: order.shipping_last_synced_at || order.last_shipping_sync_at || null,
      allow_open_package: order.allow_open_package ?? null,
    },
    people: {
      seller: text(order.seller_name || order.salesperson_name),
      cashier: text(order.cashier_name),
      created_by: text(order.created_by_name),
      branch: text(order.branch_name),
    },
    items_count: items.reduce((sum, item) => sum + number(item.quantity), 0),
    items,
  };
};

const withBranchName = async (client = db) => {
  const hasBranches = await tableExists("branches", client);
  return {
    select: hasBranches ? "COALESCE(b.name, '') AS branch_name" : "'' AS branch_name",
    join: hasBranches ? "LEFT JOIN branches b ON b.id = page.branch_id" : "",
  };
};

export const listPortalOnlineOrders = async ({ tenantId = null, query = {}, client = db } = {}) => {
  if (!(await tableExists("orders", client))) return { orders: [], counts: {}, has_more: false, page: 1 };
  const columns = await loadColumns("orders", client);
  const sql = buildPortalOnlineSql(columns);
  const range = PORTAL_ONLINE_RANGES.includes(query.range) ? query.range : DEFAULT_RANGE;
  const group = PORTAL_ONLINE_GROUPS.includes(query.group) ? query.group : "all";
  const page = Math.max(1, Math.min(200, Math.trunc(number(query.page, 1)) || 1));
  const { where, params } = buildBaseWhere({ columns, sql, tenantId: idOrNull(tenantId), range, search: query.search });

  const pageParams = [...params];
  let pageWhere = where;
  if (group !== "all") {
    pageParams.push(group);
    pageWhere += `\n      AND ${sql.groupExpr} = $${pageParams.length}`;
  }
  pageParams.push(PAGE_SIZE + 1, (page - 1) * PAGE_SIZE);
  const branch = await withBranchName(client);

  const [countsResult, pageResult] = await Promise.all([
    client.query(
      `
      SELECT ${sql.groupExpr} AS portal_group, COUNT(*)::int AS count
      FROM orders o
      WHERE ${where}
      GROUP BY 1
      `,
      params
    ),
    client.query(
      `
      WITH page AS (
        SELECT o.*, ${sql.groupExpr} AS portal_group
        FROM orders o
        WHERE ${pageWhere}
        ORDER BY o.created_at DESC, o.id DESC
        LIMIT $${pageParams.length - 1}
        OFFSET $${pageParams.length}
      )
      SELECT page.*, ${branch.select}
      FROM page
      ${branch.join}
      ORDER BY page.created_at DESC, page.id DESC
      `,
      pageParams
    ),
  ]);

  const counts = Object.fromEntries(PORTAL_ONLINE_GROUPS.map((key) => [key, 0]));
  for (const row of countsResult.rows) counts[row.portal_group] = number(row.count);
  counts.all = PORTAL_ONLINE_GROUPS.reduce((sum, key) => sum + counts[key], 0);

  const rows = pageResult.rows.slice(0, PAGE_SIZE);
  const itemsByOrder = await itemsForOrders(rows.map((row) => row.id), client);
  return {
    orders: rows.map((row) => shapeOrder(row, itemsByOrder.get(String(row.id)) || [])),
    counts,
    range,
    group,
    page,
    page_size: PAGE_SIZE,
    has_more: pageResult.rows.length > PAGE_SIZE,
  };
};

const shipmentTimeline = (order = {}) => {
  const raw = Array.isArray(order.shipment_timeline) ? order.shipment_timeline : [];
  return raw
    // Portal actions are told once, by staffTimeline below, with the person's name.
    .filter((entry) => entry && typeof entry === "object" && entry.at && !text(entry.action).startsWith("portal_"))
    .map((entry) => ({
      at: entry.at,
      kind: text(entry.action) === "courier_collected" ? "courier_collected" : text(entry.action) === "courier_settled" ? "courier_settled" : "shipment",
      status: text(entry.status),
      amount: entry.amount === undefined ? null : number(entry.amount),
    }));
};

// What staff did from the portals, with who did it. The confirmation engine writes a
// staff confirm under its own action name, the rest are the portal's own.
const PORTAL_SOURCES = new Set(["employee_portal", "manager_portal"]);
const STAFF_TIMELINE_KINDS = {
  customer_confirmed_order: "staff_confirmed",
  portal_confirmation_sent: "staff_confirmation_sent",
  portal_ready_to_ship: "staff_ready_to_ship",
  portal_bosta_created: "staff_shipment_created",
};

const staffTimeline = (order = {}) =>
  (Array.isArray(order.timeline) ? order.timeline : [])
    .filter((entry) => entry && typeof entry === "object" && entry.at && PORTAL_SOURCES.has(text(entry.source)) && STAFF_TIMELINE_KINDS[text(entry.action)])
    .map((entry) => ({ at: entry.at, kind: STAFF_TIMELINE_KINDS[text(entry.action)], actor: text(entry.actor) }));

const orderTimeline = (order = {}) => {
  const events = [{ at: order.created_at, kind: "created" }];
  const staff = staffTimeline(order);
  // A portal send stamps whatsapp_confirmation_sent_at too; tell it once, with the name.
  const staffSent = staff.some((event) => event.kind === "staff_confirmation_sent" && Math.abs(new Date(event.at) - new Date(order.whatsapp_confirmation_sent_at)) < 120000);
  if (order.whatsapp_confirmation_sent_at && !staffSent) events.push({ at: order.whatsapp_confirmation_sent_at, kind: "confirmation_sent" });
  // A staff confirm also stamps whatsapp_confirmed_at; do not tell it twice.
  const staffConfirmed = staff.some((event) => event.kind === "staff_confirmed" && Math.abs(new Date(event.at) - new Date(order.whatsapp_confirmed_at)) < 120000);
  if (order.whatsapp_confirmed_at && !staffConfirmed) events.push({ at: order.whatsapp_confirmed_at, kind: "customer_confirmed" });
  events.push(...staff);
  if (order.whatsapp_cancelled_at) events.push({ at: order.whatsapp_cancelled_at, kind: "customer_cancelled" });
  if (order.cancelled_at) events.push({ at: order.cancelled_at, kind: "cancelled" });
  events.push(...shipmentTimeline(order));
  const sorted = events
    .filter((event) => event.at && !Number.isNaN(new Date(event.at).getTime()))
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  // A status refresh and the courier's webhook often report the same state back to
  // back; the person reading the history wants each change once.
  return sorted.filter((event, index) => {
    const previous = sorted[index - 1];
    return !previous || previous.kind !== event.kind || previous.status !== event.status || event.kind !== "shipment";
  });
};

export const getPortalOnlineOrder = async ({ tenantId = null, orderId, client = db } = {}) => {
  const id = idOrNull(orderId);
  const notFound = () => {
    const error = new Error("Order not found");
    error.status = 404;
    error.code = "order_not_found";
    return error;
  };
  if (!id || !(await tableExists("orders", client))) throw notFound();
  const columns = await loadColumns("orders", client);
  const sql = buildPortalOnlineSql(columns);
  const params = [id];
  const filters = ["o.id = $1::bigint", sql.liveExpr, sql.onlineExpr];
  if (columns.has("tenant_id")) {
    const tenant = idOrNull(tenantId);
    if (tenant) {
      params.push(tenant);
      filters.push(`o.tenant_id = $${params.length}::bigint`);
    } else {
      filters.push("o.tenant_id IS NULL");
    }
  }

  const [hasBranches, hasUsers, hasCities, hasZones, hasDistricts] = await Promise.all([
    tableExists("branches", client),
    tableExists("users", client),
    tableExists("shipping_cities", client),
    tableExists("shipping_zones", client),
    tableExists("shipping_districts", client),
  ]);
  const has = (name) => columns.has(name);
  const creatorIdExpr = [has("cashier_id") ? "o.cashier_id" : "", has("created_by") ? "o.created_by" : ""].filter(Boolean);
  const selects = [
    "o.*",
    `${sql.groupExpr} AS portal_group`,
    hasBranches && has("branch_id") ? "COALESCE(b.name, '') AS branch_name" : "'' AS branch_name",
    hasUsers && creatorIdExpr.length ? "COALESCE(creator.name, '') AS created_by_name" : "'' AS created_by_name",
    hasCities && has("shipping_city_id") ? "sc.name_ar AS shipping_city_name_ar, sc.name_en AS shipping_city_name_en" : "NULL AS shipping_city_name_ar, NULL AS shipping_city_name_en",
    hasZones && has("shipping_zone_id") ? "sz.name_ar AS shipping_zone_name_ar, sz.name_en AS shipping_zone_name_en" : "NULL AS shipping_zone_name_ar, NULL AS shipping_zone_name_en",
    hasDistricts && has("shipping_district_id") ? "sd.name_ar AS shipping_district_name_ar, sd.name_en AS shipping_district_name_en" : "NULL AS shipping_district_name_ar, NULL AS shipping_district_name_en",
  ];
  // One row, so the text-cast lookups the admin details page uses cost nothing here.
  const joins = [
    hasBranches && has("branch_id") ? "LEFT JOIN branches b ON b.id = o.branch_id" : "",
    hasUsers && creatorIdExpr.length ? `LEFT JOIN users creator ON creator.id = COALESCE(${creatorIdExpr.join(", ")})` : "",
    hasCities && has("shipping_city_id")
      ? `LEFT JOIN LATERAL (SELECT name_ar, name_en FROM shipping_cities WHERE id::text = o.shipping_city_id::text OR provider_city_id::text = o.shipping_city_id::text LIMIT 1) sc ON TRUE`
      : "",
    hasZones && has("shipping_zone_id")
      ? `LEFT JOIN LATERAL (SELECT name_ar, name_en FROM shipping_zones WHERE id::text = o.shipping_zone_id::text OR provider_zone_id::text = o.shipping_zone_id::text LIMIT 1) sz ON TRUE`
      : "",
    hasDistricts && has("shipping_district_id")
      ? `LEFT JOIN LATERAL (SELECT name_ar, name_en FROM shipping_districts WHERE id::text = o.shipping_district_id::text OR provider_district_id::text = o.shipping_district_id::text LIMIT 1) sd ON TRUE`
      : "",
  ];

  const result = await client.query(
    `
    SELECT ${selects.join(",\n      ")}
    FROM orders o
    ${joins.filter(Boolean).join("\n    ")}
    WHERE ${filters.join("\n      AND ")}
    LIMIT 1
    `,
    params
  );
  const order = result.rows[0];
  if (!order) throw notFound();
  const itemsByOrder = await itemsForOrders([order.id], client);
  return {
    ...shapeOrder(order, itemsByOrder.get(String(order.id)) || []),
    timeline: orderTimeline(order),
  };
};
