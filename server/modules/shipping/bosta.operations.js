/*
 * Everything Bosta offers beyond "create, print, track": the details it sends with each
 * state (why an attempt failed, how many attempts, the promised day, fees, the courier),
 * the alerts those deserve, and the account-level calls — fee estimate, pickup requests,
 * the COD balance Bosta still holds, and pushing an address fix to a live parcel.
 *
 * Every route and field name here comes from Bosta's official spec
 * (docs.bosta.co/api/api.yaml) and was probed against app.bosta.co before use.
 */
import db from "../../database/db.js";
import { createNotification } from "../../services/notificationsService.js";
import { BOSTA_SEVERE_EXCEPTION_CODES } from "../../../shared/bostaDeliveryInsights.js";
import { createBostaClient } from "./providers/bosta.client.js";
import {
  extractBostaInsights,
  mapOrderToBostaDeliveryUpdatePayload,
  normalizeBostaFeeEstimate,
  normalizeBostaPickup,
  normalizeBostaPickupDates,
  normalizeBostaPickupLocations,
  normalizeBostaPickups,
} from "./providers/bosta.mapper.js";
import { bostaConfig, ensureShippingSchema } from "./shipping.service.js";

const text = (value = "") => String(value ?? "").trim();
const nowIso = () => new Date().toISOString();

const httpError = (message, status = 400, code = "") => {
  const error = new Error(message);
  error.status = status;
  if (code) error.code = code;
  return error;
};

const requireBostaKey = async () => {
  const config = await bostaConfig();
  if (!text(config.apiKey)) throw httpError("مفتاح بوسطة مش مضبوط في إعدادات الشحن.", 409, "BOSTA_NOT_CONFIGURED");
  return config;
};

// Bosta's error body carries the reason; a bare "Bosta request failed with 400" is useless
// to the person staring at the screen.
const rethrowBosta = (error, fallback) => {
  const message = text(error?.payload?.message) || text(error?.message) || fallback;
  const wrapped = httpError(message, error?.status >= 400 && error.status < 500 ? 400 : 502, text(error?.payload?.errorCode) || "BOSTA_REQUEST_FAILED");
  wrapped.payload = error?.payload;
  throw wrapped;
};

const invoiceOf = (order = {}) => text(order.invoice_number || order.public_order_number || order.display_order_number || order.id);

/*
 * Writes what a payload carried onto the order, never what it lacked: each column keeps
 * its value when the payload has nothing for it, so a bare webhook after a rich refresh
 * cannot erase the courier or the fees. Attempts only ever go up — a later event that
 * reports 0 must not make a twice-failed parcel look fresh.
 */
export const applyBostaInsights = async (client, orderId, insights = {}, { occurredAt = null } = {}) => {
  const hasException = insights.exception_code !== null && insights.exception_code !== undefined;
  const details = insights.is_delivery_view
    ? JSON.stringify({ masked_state: insights.masked_state, next_action: insights.next_action, history: insights.history, order_type: insights.order_type, state_code: insights.state_code })
    : null;
  const result = await client.query(
    `
    UPDATE orders SET
      bosta_exception_code = CASE WHEN $2::boolean THEN $3::integer ELSE bosta_exception_code END,
      bosta_exception_reason = CASE WHEN $2::boolean THEN NULLIF($4::text, '') ELSE bosta_exception_reason END,
      bosta_exception_at = CASE WHEN $2::boolean THEN COALESCE($5::timestamptz, NOW()) ELSE bosta_exception_at END,
      bosta_attempts = CASE WHEN $6::integer IS NULL THEN bosta_attempts ELSE GREATEST(COALESCE(bosta_attempts, 0), $6::integer) END,
      bosta_promise_date = COALESCE(NULLIF($7::text, '')::date, bosta_promise_date),
      bosta_confirmed_delivery = COALESCE($8::boolean, bosta_confirmed_delivery),
      bosta_reported_cod = COALESCE($9::numeric, bosta_reported_cod),
      bosta_shipment_fees = COALESCE($10::numeric, bosta_shipment_fees),
      bosta_courier_name = COALESCE(NULLIF($11::text, ''), bosta_courier_name),
      bosta_courier_phone = COALESCE(NULLIF($12::text, ''), bosta_courier_phone),
      bosta_details = CASE WHEN $13::jsonb IS NULL THEN bosta_details ELSE $13::jsonb END,
      bosta_details_synced_at = CASE WHEN $13::jsonb IS NULL THEN bosta_details_synced_at ELSE NOW() END
    WHERE id = $1
    RETURNING *
    `,
    [
      orderId,
      hasException,
      hasException ? insights.exception_code : null,
      text(insights.exception_reason),
      occurredAt,
      insights.attempts ?? null,
      text(insights.promise_date),
      insights.confirmed_delivery ?? null,
      insights.reported_cod ?? null,
      insights.shipment_fees ?? null,
      text(insights.courier_name),
      text(insights.courier_phone),
      details,
    ]
  );
  return result.rows[0] || null;
};

const trackingOf = (order = {}) => text(order.shipping_tracking_number || order.tracking_number || order.shipment_id);

/*
 * The business delivery view is the only place Bosta puts the fees, the full history and
 * (when assigned) the courier. Fetched after the events that change them, and on demand.
 */
export const syncBostaDeliveryDetails = async (orderId, { force = false } = {}) => {
  await ensureShippingSchema();
  const order = (await db.query("SELECT * FROM orders WHERE id = $1 LIMIT 1", [orderId])).rows[0];
  if (!order) throw httpError("Order not found", 404);
  const tracking = trackingOf(order);
  if (!tracking) throw httpError("الطلب ده مالوش رقم تتبع على بوسطة.", 400, "BOSTA_NO_TRACKING_NUMBER");
  const syncedAt = order.bosta_details_synced_at ? new Date(order.bosta_details_synced_at).getTime() : 0;
  if (!force && syncedAt && Date.now() - syncedAt < 60_000) return { order, skipped: "recently_synced" };
  const config = await requireBostaKey();
  let payload;
  try {
    payload = await createBostaClient(config).getDeliveryStatus(tracking);
  } catch (error) {
    rethrowBosta(error, "بوسطة مردتش بتفاصيل الشحنة.");
  }
  const insights = extractBostaInsights(payload);
  const updated = await applyBostaInsights(db, order.id, insights);
  return { order: updated || order, insights };
};

/*
 * One manager alert per failed attempt. The claim on bosta_alerted_attempt is what stops a
 * retried webhook or a refresh from alerting twice for the same day's failure.
 */
export const alertBostaException = async (order = {}) => {
  if (!order?.id || order.bosta_exception_code === null || order.bosta_exception_code === undefined) return { alerted: false, reason: "no_exception" };
  const attempt = Math.max(1, Number(order.bosta_attempts || 0) || 1);
  const claim = await db.query(
    "UPDATE orders SET bosta_alerted_attempt = $2::integer WHERE id = $1 AND COALESCE(bosta_alerted_attempt, 0) < $2::integer RETURNING id",
    [order.id, attempt]
  );
  if (!claim.rowCount) return { alerted: false, reason: "already_alerted" };
  const severe = BOSTA_SEVERE_EXCEPTION_CODES.has(Number(order.bosta_exception_code));
  const reason = text(order.bosta_exception_reason) || "سبب غير معروف";
  await createNotification({
    tenant_id: order.tenant_id || null,
    role_key: "manager",
    branch_id: order.branch_id || null,
    type: "bosta_delivery_exception",
    category: "shipping",
    priority: severe || attempt >= 2 ? "high" : "medium",
    title: severe ? "شحنة في خطر ترجع" : `محاولة تسليم فشلت (المحاولة ${attempt})`,
    message: `${invoiceOf(order)} — ${text(order.customer_name) || "عميل"}: ${reason}`,
    action_url: `/orders/${order.id}`,
    action_label: "افتح الطلب",
    entity_type: "order",
    entity_id: `${order.id}:attempt:${attempt}`,
    metadata: { order_id: order.id, exception_code: order.bosta_exception_code, attempts: attempt },
  }).catch((error) => console.warn("[bosta] exception alert skipped", { orderId: order.id, message: error?.message || String(error) }));
  return { alerted: true, attempt, severe };
};

/*
 * Bosta sends the COD it actually collected on the Delivered event. A difference from what
 * the ERP expected is money that will be missing from the settlement, so it is raised the
 * moment it is known rather than discovered at the bank.
 */
export const alertBostaCodMismatch = async (order = {}) => {
  const reported = order?.bosta_reported_cod;
  if (!order?.id || reported === null || reported === undefined) return { alerted: false };
  const expected = Number(order.courier_collected_amount ?? order.cod_amount ?? 0);
  if (Math.abs(Number(reported) - expected) < 1) return { alerted: false };
  await createNotification({
    tenant_id: order.tenant_id || null,
    role_key: "manager",
    branch_id: order.branch_id || null,
    type: "bosta_cod_mismatch",
    category: "shipping",
    priority: "high",
    title: "مبلغ التحصيل مختلف عند بوسطة",
    message: `${invoiceOf(order)}: بوسطة حصّلت ${Number(reported).toLocaleString("en-US")} والمتوقع ${expected.toLocaleString("en-US")}`,
    action_url: `/orders/${order.id}`,
    action_label: "افتح الطلب",
    entity_type: "order",
    entity_id: `${order.id}:cod`,
    metadata: { order_id: order.id, reported_cod: Number(reported), expected_cod: expected },
  }).catch((error) => console.warn("[bosta] COD mismatch alert skipped", { orderId: order.id, message: error?.message || String(error) }));
  return { alerted: true };
};

const DETAIL_WORTHY_STATUSES = new Set(["picked_up", "out_for_delivery", "failed_delivery", "delivered", "returned"]);

/*
 * What runs after a Bosta event has committed. Order matters: the details are fetched
 * first so the customer's "out for delivery" message can name the courier, then the
 * customer is told, then the managers are. Nothing here may fail the webhook — the
 * status write that settles COD has already happened.
 */
export const runAfterBostaEvent = async ({ orderId, status = "", hadException = false, detailsFresh = false, notifyCustomer = null } = {}) => {
  let order = null;
  try {
    if (!detailsFresh && (DETAIL_WORTHY_STATUSES.has(status) || hadException)) {
      order = (await syncBostaDeliveryDetails(orderId, { force: true })).order;
    }
  } catch (error) {
    console.warn("[bosta] delivery details sync skipped", { orderId, status, message: error?.message || String(error) });
  }
  if (!order) order = (await db.query("SELECT * FROM orders WHERE id = $1 LIMIT 1", [orderId])).rows[0] || null;
  if (!order) return;
  if (typeof notifyCustomer === "function") {
    await Promise.resolve(notifyCustomer(order)).catch((error) => {
      console.warn("[whatsapp:shipment-notification-skipped]", { orderId, status, message: error?.message || String(error) });
    });
  }
  if (hadException || status === "failed_delivery") await alertBostaException(order);
  if (status === "delivered") await alertBostaCodMismatch(order);
};

// ---------------------------------------------------------------------------------------
// Fee estimate
// ---------------------------------------------------------------------------------------

let pickupCityCache = { value: "", at: 0 };

// The pickup city is the default pickup location's city at Bosta, looked up once an hour.
const defaultPickupCity = async (client) => {
  if (pickupCityCache.value && Date.now() - pickupCityCache.at < 3_600_000) return pickupCityCache.value;
  try {
    const locations = normalizeBostaPickupLocations(await client.listPickupLocations());
    const city = (locations.find((row) => row.is_default) || locations[0])?.city || "";
    if (city) pickupCityCache = { value: city, at: Date.now() };
    return city || "Cairo";
  } catch {
    return pickupCityCache.value || "Cairo";
  }
};

export const estimateBostaShippingFees = async ({ orderId, codAmount = null } = {}) => {
  await ensureShippingSchema();
  const order = (await db.query("SELECT * FROM orders WHERE id = $1 LIMIT 1", [orderId])).rows[0];
  if (!order) throw httpError("Order not found", 404);
  const city = (await db.query("SELECT name_en FROM shipping_cities WHERE id::text = $1 OR provider_city_id = $1 LIMIT 1", [text(order.shipping_city_id || order.city_id)])).rows[0];
  if (!city?.name_en) throw httpError("اختار مدينة بوسطة للطلب الأول عشان نحسب تكلفة الشحن.", 400, "BOSTA_CITY_REQUIRED");
  const config = await requireBostaKey();
  const client = createBostaClient(config);
  const { orderCodAmount } = await import("./shipping.service.js");
  const cod = codAmount === null || codAmount === undefined || codAmount === "" ? orderCodAmount(order) : Math.max(0, Number(codAmount) || 0);
  const pickupCity = await defaultPickupCity(client);
  let payload;
  try {
    payload = await client.getShippingFeeEstimate({ dropOffCity: city.name_en, pickupCity, cod });
  } catch (error) {
    rethrowBosta(error, "بوسطة مردتش بتكلفة الشحن.");
  }
  const estimate = normalizeBostaFeeEstimate(payload);
  return { ...estimate, dropoff_city: city.name_en, pickup_city: pickupCity, cod };
};

// ---------------------------------------------------------------------------------------
// Pickup requests
// ---------------------------------------------------------------------------------------

// The business id rides on every pickup Bosta returns; kept on the provider row so the COD
// balance can be read later even when no pickup is listed.
const rememberBusinessId = async (businessId) => {
  const id = text(businessId);
  if (!id) return;
  await db.query("UPDATE shipping_providers SET business_id = $1, updated_at = CURRENT_TIMESTAMP WHERE code = 'bosta' AND COALESCE(business_id, '') <> $1", [id]).catch(() => {});
};

export const getBostaPickupOverview = async () => {
  await ensureShippingSchema();
  const client = createBostaClient(await requireBostaKey());
  const settled = await Promise.allSettled([client.listPickupLocations(), client.listPickups({ page: 1, limit: 20 }), client.availablePickupDates(7)]);
  const [locationsResult, pickupsResult, datesResult] = settled;
  const pickups = pickupsResult.status === "fulfilled" ? normalizeBostaPickups(pickupsResult.value) : [];
  await rememberBusinessId(pickups.find((row) => row.business_id)?.business_id);
  // Parcels created at Bosta that no courier has collected yet: the default count for a pickup.
  const ready = await db.query(
    `SELECT COUNT(*)::int AS count FROM orders
     WHERE LOWER(COALESCE(shipping_provider, '')) = 'bosta'
       AND COALESCE(shipment_status, shipping_status) = 'shipment_created'
       AND COALESCE(shipping_tracking_number, tracking_number, '') <> ''
       AND cancelled_at IS NULL`
  ).catch(() => ({ rows: [{ count: 0 }] }));
  return {
    locations: locationsResult.status === "fulfilled" ? normalizeBostaPickupLocations(locationsResult.value) : [],
    pickups,
    dates: datesResult.status === "fulfilled" ? normalizeBostaPickupDates(datesResult.value) : [],
    ready_parcels: ready.rows[0]?.count || 0,
    errors: settled.map((row, index) => (row.status === "rejected" ? { part: ["locations", "pickups", "dates"][index], message: text(row.reason?.payload?.message || row.reason?.message) } : null)).filter(Boolean),
  };
};

export const createBostaPickup = async ({ locationId, date, parcels = null, notes = "", contactName = "", contactPhone = "", actorName = "" } = {}) => {
  if (!text(locationId)) throw httpError("اختار مكان البيك أب.", 400, "BOSTA_PICKUP_LOCATION_REQUIRED");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text(date))) throw httpError("اختار يوم البيك أب.", 400, "BOSTA_PICKUP_DATE_REQUIRED");
  const client = createBostaClient(await requireBostaKey());
  const body = {
    businessLocationId: text(locationId),
    scheduledDate: text(date),
    ...(Number(parcels) > 0 ? { numberOfParcels: Math.round(Number(parcels)) } : {}),
    ...(text(notes) ? { notes: text(notes) } : {}),
    ...(text(contactName) && text(contactPhone) ? { contactPerson: { name: text(contactName), phone: text(contactPhone) } } : {}),
  };
  let payload;
  try {
    payload = await client.createPickup(body);
  } catch (error) {
    rethrowBosta(error, "بوسطة رفضت طلب البيك أب.");
  }
  const pickup = normalizeBostaPickup(payload?.data || payload?.message || {});
  await rememberBusinessId(pickup.business_id);
  console.log("[bosta] pickup requested", { date: body.scheduledDate, parcels: body.numberOfParcels || null, pickup_id: pickup.id, by: actorName || null });
  return { pickup, message: text(payload?.message) };
};

export const cancelBostaPickup = async (pickupId) => {
  if (!text(pickupId)) throw httpError("Pickup id is required", 400);
  const client = createBostaClient(await requireBostaKey());
  try {
    const payload = await client.deletePickup(text(pickupId));
    return { success: true, message: text(payload?.message) };
  } catch (error) {
    return rethrowBosta(error, "بوسطة رفضت إلغاء البيك أب.");
  }
};

// ---------------------------------------------------------------------------------------
// COD Bosta holds and has not transferred
// ---------------------------------------------------------------------------------------

export const getBostaUnpaidCod = async () => {
  await ensureShippingSchema();
  const config = await bostaConfig();
  if (!text(config.apiKey)) return { available: false, reason: "not_configured" };
  const client = createBostaClient(config);
  let businessId = text((await db.query("SELECT business_id FROM shipping_providers WHERE code = 'bosta' LIMIT 1")).rows[0]?.business_id);
  if (!businessId) {
    try {
      businessId = normalizeBostaPickups(await client.listPickups({ page: 1, limit: 5 })).find((row) => row.business_id)?.business_id || "";
      await rememberBusinessId(businessId);
    } catch {
      businessId = "";
    }
  }
  // No pickup has ever been requested through the API, so there is nothing to learn the id
  // from yet. Said plainly rather than shown as a zero balance.
  if (!businessId) return { available: false, reason: "business_id_unknown" };
  try {
    const payload = await client.getUnpaidCod(businessId);
    const amount = Number(payload?.data?.unpaidCodAmount);
    return Number.isFinite(amount) ? { available: true, unpaid_cod: amount, checked_at: nowIso() } : { available: false, reason: "unreadable_response" };
  } catch (error) {
    return { available: false, reason: "bosta_error", message: text(error?.payload?.message || error?.message) };
  }
};

// ---------------------------------------------------------------------------------------
// Pushing a fixed address / phone to a live parcel
// ---------------------------------------------------------------------------------------

// Bosta only accepts edits in these states (spec: PUT /deliveries/business/{trackingNumber}).
const EDITABLE_ERP_STATUSES = new Set(["shipment_created", "picked_up", "in_transit", "failed_delivery"]);

export const pushOrderUpdateToBosta = async (orderId, { actorName = "" } = {}) => {
  await ensureShippingSchema();
  const order = (await db.query("SELECT * FROM orders WHERE id = $1 LIMIT 1", [orderId])).rows[0];
  if (!order) throw httpError("Order not found", 404);
  const tracking = trackingOf(order);
  if (!tracking) throw httpError("الطلب ده مالوش شحنة على بوسطة.", 400, "BOSTA_NO_TRACKING_NUMBER");
  const status = text(order.shipment_status || order.shipping_status).toLowerCase();
  if (!EDITABLE_ERP_STATUSES.has(status)) {
    throw httpError("بوسطة مش بتسمح بتعديل الشحنة في حالتها الحالية (خرجت للتسليم أو اتقفلت).", 409, "BOSTA_NOT_EDITABLE");
  }
  const [city, zone, district] = await Promise.all([
    db.query("SELECT * FROM shipping_cities WHERE id::text = $1 OR provider_city_id = $1 LIMIT 1", [text(order.shipping_city_id || order.city_id)]),
    db.query("SELECT * FROM shipping_zones WHERE id::text = $1 OR provider_zone_id = $1 LIMIT 1", [text(order.shipping_zone_id)]),
    db.query("SELECT * FROM shipping_districts WHERE id::text = $1 OR provider_district_id = $1 LIMIT 1", [text(order.shipping_district_id || order.area_id)]),
  ]);
  if (!city.rows[0] || !district.rows[0]) throw httpError("كمّل مدينة ومنطقة بوسطة للطلب الأول.", 400, "BOSTA_LOCATION_REQUIRED");
  const body = mapOrderToBostaDeliveryUpdatePayload({ order, items: [], city: city.rows[0], zone: zone.rows[0] || {}, district: district.rows[0] });
  const client = createBostaClient(await requireBostaKey());
  try {
    await client.updateDelivery(tracking, body);
  } catch (error) {
    rethrowBosta(error, "بوسطة رفضت التعديل.");
  }
  const timelineEvent = { at: nowIso(), action: "bosta_update_delivery", provider: "bosta", status, by: actorName || null, phone: body.receiver?.phone || "", address: body.dropOffAddress?.firstLine || "" };
  const updated = await db.query(
    "UPDATE orders SET shipment_timeline = COALESCE(shipment_timeline, '[]'::jsonb) || $2::jsonb, updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *",
    [order.id, JSON.stringify([timelineEvent])]
  );
  console.log("[bosta] delivery updated", { orderId: order.id, tracking, by: actorName || null });
  return { success: true, order: updated.rows[0] };
};
