import db from "../../database/db.js";
import { normalizeShippingProviderKey } from "../../services/shippingProviders/index.js";
import {
  createBostaShipmentForOrder,
  ensureShippingSchema,
  fetchBostaShipmentLabels,
  orderCodAmount,
  orderOwedAmount,
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
  // "COD" is any parcel the courier still has to bring money back from, not only the
  // ones whose payment_method happens to spell it out — that spelling is exactly what
  // shipments created from the AI inbox and the POS never carried.
  const COLLECTED_ON_DELIVERY = "(LOWER(COALESCE(o.payment_method, '')) IN ('cod', 'cash_on_delivery') OR COALESCE(o.cod_amount, 0) > 0 OR (COALESCE(o.total_amount, o.total, o.total_price, 0) - COALESCE(o.paid_amount, 0)) > 0)";
  if (query.paymentType === "cod") filters.push(COLLECTED_ON_DELIVERY);
  if (query.paymentType === "prepaid") filters.push(`NOT ${COLLECTED_ON_DELIVERY}`);
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
    sc.name_en AS shipping_city_name_en,
    sc.name_ar AS shipping_city_name_ar,
    sz.name_en AS shipping_zone_name_en,
    sz.name_ar AS shipping_zone_name_ar,
    sd.name_en AS shipping_district_name_en,
    sd.name_ar AS shipping_district_name_ar,
    COALESCE(o.shipping_provider_id, o.shipping_provider, 'in_store_delivery') AS shipping_provider_id,
    COALESCE(o.shipping_provider, o.shipping_provider_id, 'in_store_delivery') AS shipping_provider,
    COALESCE(o.shipping_tracking_number, o.tracking_number, '') AS tracking_number,
    COALESCE(o.shipping_provider_delivery_id, o.shipment_id, '') AS delivery_id,
    COALESCE(o.shipment_status, o.shipping_status, 'ready_to_ship') AS shipment_status,
    COALESCE(o.cod_amount, 0)::numeric AS cod_amount,
    COALESCE(o.total_amount, o.total, o.total_price, 0)::numeric AS order_total,
    COALESCE(o.paid_amount, 0)::numeric AS paid_amount,
    o.remaining_amount,
    o.allow_open_package,
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
  LEFT JOIN shipping_zones sz
    ON sz.id::text = o.shipping_zone_id OR sz.provider_zone_id = o.shipping_zone_id
  LEFT JOIN shipping_districts sd
    ON sd.id::text = o.shipping_district_id OR sd.provider_district_id = o.shipping_district_id
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
  return {
    // `cod_amount` is only what the column happens to hold; a shipment that has not
    // been created yet quotes the courier from the same rule the create call uses,
    // so the screen and the parcel can never disagree about the money.
    orders: data.rows.map((row) => ({
      ...row,
      shipment_status: normalizeStatus(row.shipment_status),
      collectible_amount: orderCodAmount({ ...row, total_amount: row.order_total }),
      amount_owed: orderOwedAmount({ ...row, total_amount: row.order_total }),
    })),
    total: count.rows[0]?.total || 0,
  };
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

/*
 * Where the printed airway bills are sent automatically.
 *
 * A number, not a conversation id: the operations line the labels go to has
 * usually never written to us, so there is no thread to look up. The outbound
 * write creates the canonical `whatsapp:<phone>` session the inbound webhook
 * would have created, which is what makes a reply from that number land on the
 * same thread instead of opening a second one.
 */
const DEFAULT_LABEL_INBOX_PHONE = "01019719986";

const labelInboxPhone = (override = "") =>
  text(override) || text(process.env.SHIPPING_LABEL_INBOX_PHONE) || DEFAULT_LABEL_INBOX_PHONE;

const labelPdfFileName = (printed = []) => {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const first = printed[0]?.order_number ? String(printed[0].order_number).replace(/[^a-zA-Z0-9_-]+/g, "") : "";
  if (printed.length === 1 && first) return `bosta-awb-${first}.pdf`;
  return `bosta-awb-${printed.length || 0}-${stamp}.pdf`;
};

const labelCaption = (printed = []) => {
  const codes = printed.map((row) => text(row.order_number) || `#${row.order_id}`).filter(Boolean);
  const head = printed.length === 1
    ? `بوليصة شحن بوسطة للطلب ${codes[0] || ""}`.trim()
    : `بوالص شحن بوسطة لعدد ${printed.length} طلب`;
  const list = codes.slice(0, 20).join("، ");
  const more = codes.length > 20 ? ` +${codes.length - 20}` : "";
  return list ? `${head}\n${list}${more}` : head;
};

/**
 * Store the AWB PDF where the channels can fetch it, push it to the operations
 * number as a WhatsApp document, and write the bubble into the AI Inbox thread.
 *
 * The transcript row is written whether or not WhatsApp accepted the file, for
 * the same reason the operator attachment path does it: a send that failed has
 * to be visible in the thread instead of disappearing into a log line.
 */
const deliverLabelsToInbox = async ({ pdfBase64 = "", printed = [], phone = "", tenantId = null, staffUserId = null, staffUserName = "" } = {}) => {
  if (!text(pdfBase64)) return { sent: false, error: "No label PDF to send" };
  const [{ default: fs }, { INBOX_ATTACHMENT_DIR, INBOX_ATTACHMENT_URL_PREFIX }] = await Promise.all([
    import("node:fs/promises"),
    import("../../config/inboxAttachmentUpload.js"),
  ]);
  const { normalizeWhatsappPhone, normalizeWhatsappSessionId } = await import("../../utils/whatsappIdentity.js");
  const { sendDocumentMessage } = await import("../../services/whatsappGatewayService.js");
  const { appendChannelOutboundSupportReply } = await import("../../services/aiSupportLogService.js");
  const { upsertChannelConversationMapping } = await import("../../services/aiChannelAdapterService.js");
  const { emitToRooms } = await import("../../utils/socket.js");

  const rawPhone = labelInboxPhone(phone);
  const canonicalPhone = normalizeWhatsappPhone(rawPhone) || rawPhone;
  const sessionId = normalizeWhatsappSessionId(rawPhone, canonicalPhone) || `whatsapp:${canonicalPhone}`;
  const safeTenantId = Number(tenantId) > 0 ? Number(tenantId) : 1;

  const fileName = labelPdfFileName(printed);
  const storedName = `${Date.now()}-${fileName}`;
  const buffer = Buffer.from(pdfBase64, "base64");
  await fs.mkdir(INBOX_ATTACHMENT_DIR, { recursive: true });
  await fs.writeFile(`${INBOX_ATTACHMENT_DIR}/${storedName}`, buffer);
  const relativeUrl = `${INBOX_ATTACHMENT_URL_PREFIX}/${storedName}`;
  const caption = labelCaption(printed);

  let sendResult = null;
  let deliveryStatus = "sent";
  let deliveryError = "";
  try {
    sendResult = await sendDocumentMessage({
      phone: canonicalPhone,
      documentUrl: relativeUrl,
      fileName,
      caption,
      mimetype: "application/pdf",
    });
  } catch (error) {
    deliveryStatus = "failed";
    deliveryError = error?.message || "WhatsApp did not accept the labels";
    console.error("[bosta-awb-inbox] whatsapp send failed", { phoneSuffix: canonicalPhone.slice(-4), message: deliveryError });
  }

  const providerMessageId = sendResult?.message_id || sendResult?.result?.key?.id || "";
  const message = await appendChannelOutboundSupportReply({
    tenantId: safeTenantId,
    channel: "whatsapp",
    sessionId,
    resolvedPhone: canonicalPhone,
    remoteJid: canonicalPhone,
    resolvedReplyJid: canonicalPhone,
    message: caption,
    messageType: "document",
    senderType: "staff",
    staffUserId,
    staffUserName,
    source: "shipping_label_dispatch",
    sessionSource: "shipping_label_dispatch",
    sourcePath: "shipping_label_dispatch",
    insertSource: "shipping_label_dispatch",
    deliveryStatus,
    deliveryError,
    providerMessageId,
    externalMessageId: providerMessageId,
    visualAttachments: [{
      type: "document",
      url: relativeUrl,
      mime_type: "application/pdf",
      file_name: fileName,
      file_size: buffer.length,
    }],
  }).catch((error) => {
    console.error("[bosta-awb-inbox] transcript write failed", { message: error?.message || String(error) });
    return null;
  });

  await upsertChannelConversationMapping({
    tenantId: safeTenantId,
    channel: "whatsapp",
    externalConversationId: sessionId,
    externalCustomerId: canonicalPhone,
    lastMessageAt: new Date(),
  }).catch(() => {});

  if (message) {
    emitToRooms([`tenant:${safeTenantId}`], "ai_inbox:message", { tenant_id: safeTenantId, session_id: sessionId, message, at: new Date().toISOString() });
    emitToRooms([`tenant:${safeTenantId}`], "ai_inbox:refresh", { tenant_id: safeTenantId, session_id: sessionId, at: new Date().toISOString() });
  }

  return {
    sent: deliveryStatus === "sent",
    phone: canonicalPhone,
    session_id: sessionId,
    file_name: fileName,
    url: relativeUrl,
    label_count: printed.length,
    delivery_status: deliveryStatus,
    error: deliveryError,
  };
};

/*
 * Which stored provider a "create it on Bosta" request is allowed to overwrite.
 *
 * The Shipping Center only ever ships what the order already says it ships with,
 * and that is right for a queue built out of courier orders. The Orders page is
 * the other case: a shop order carries the default provider (`manual` /
 * `in_store_delivery`, i.e. nobody has chosen a courier yet), and the operator
 * selecting rows and pressing "create shipment" IS the choice. What must never be
 * silently overwritten is a DIFFERENT courier — an order already booked with
 * Mylerz would end up with two parcels out for the same box.
 */
const PROVIDERLESS_KEYS = new Set(["", "manual", "in_store_delivery", "in-store-delivery", "store_pickup", "none", "null"]);

export const canCreateBostaShipmentFor = (rawProvider = "", requestedProvider = "") => {
  const stored = text(rawProvider).toLowerCase();
  if (normalizeShippingProviderKey(stored) === "bosta") return true;
  if (text(requestedProvider).toLowerCase() !== "bosta") return false;
  return PROVIDERLESS_KEYS.has(stored);
};

export const bulkShippingCenterAction = async ({ action, orderIds = [], provider = "", sendToInbox = false, inboxPhone = "", tenantId = null, staffUserId = null, staffUserName = "" } = {}) => {
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

  // Reading `shipping_label_url` here was the whole bug: Bosta's create-delivery reply
  // carries no label, so the column was empty on every order and the print returned rows
  // the client then filtered down to nothing — a success toast over a no-op. The label
  // has to be pulled from Bosta's AWB endpoint at print time.
  if (action === "print_labels") {
    const labels = await fetchBostaShipmentLabels(ids);
    if (!sendToInbox) return labels;
    // The same PDF the operator is about to print also has to reach whoever hands
    // the parcels over, so it goes out on the AI Inbox in the same round trip —
    // regenerating it in a second request would print one bill and send another.
    const inbox = await deliverLabelsToInbox({
      pdfBase64: labels.pdf_base64,
      printed: labels.printed,
      phone: inboxPhone,
      tenantId,
      staffUserId,
      staffUserName,
    }).catch((error) => ({
      sent: false,
      error: error?.message || "Failed to send the labels to the inbox",
    }));
    return { ...labels, inbox_delivery: inbox };
  }

  const results = [];
  for (const id of ids) {
    try {
      if (action === "create_shipments") {
        const providerResult = await db.query("SELECT COALESCE(NULLIF(shipping_provider_id, ''), NULLIF(shipping_provider, ''), '') AS provider FROM orders WHERE id = $1", [id]);
        const storedProvider = providerResult.rows[0]?.provider || "";
        if (!canCreateBostaShipmentFor(storedProvider, provider)) {
          throw new Error(`Create shipment is currently implemented for Bosta orders only. Provider: ${normalizeShippingProviderKey(storedProvider) || "unknown"}`);
        }
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
