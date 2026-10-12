import db from "../../database/db.js";
import {
  BOSTA_STATES,
  bostaCustomerFailureReason,
  describeDeliveryAlert,
} from "../../../shared/bostaDeliveryInsights.js";

/*
 * The parcel's journey as the CUSTOMER reads it on /track — the same steps Bosta's own
 * messages walk through (picked up, at the warehouse, out with the courier, delivered),
 * in our words, never Bosta's raw text: its history titles are English and one of them
 * ("Picked up") is reused for a parcel that is already heading to the customer.
 *
 * Three sources, merged, because none of them is complete on its own:
 *   - shipping_events: every webhook, with Bosta's numeric state and the moment it happened;
 *   - orders.shipment_timeline: our own create / refresh / webhook entries (ERP statuses);
 *   - orders.bosta_details.history: Bosta's delivery view, refreshed by تحديث الحالة and the
 *     reconcile tick — the only source when the webhook was never delivered.
 * A refresh stamps the moment it LEARNED a state, which is never earlier than the state
 * itself, so for each step the earliest time any source gives is the honest one.
 *
 * Only what the customer may see leaves this module: no payload, no staff wording, no
 * exception reason Bosta wrote for the shop. The courier is named only while the parcel
 * is with them.
 */

export const JOURNEY_LABELS = {
  created: "تم إنشاء الشحنة على بوسطة",
  picked_up: "بوسطة استلمت الشحنة",
  at_warehouse: "الشحنة وصلت مخزن بوسطة",
  in_transit: "الشحنة في الطريق لفرع بوسطة القريب منك",
  out_for_delivery: "الشحنة خرجت مع المندوب للتسليم",
  failed_attempt: "محاولة تسليم ما تمّتش",
  problem: "فيه مشكلة في الشحنة وفريقنا بيتابعها",
  delivered: "تم تسليم الشحنة",
  returned: "الشحنة رجعت لينا",
  cancelled: "الشحنة اتلغت",
};

// Bosta's numeric states → the step the customer sees. Return pickups (22/23), on hold,
// investigation and archived are left out: they are not a step of THIS customer's parcel.
const JOURNEY_BY_STATE_CODE = {
  10: "created", 11: "created", 20: "created",
  21: "picked_up",
  24: "at_warehouse", 25: "at_warehouse",
  30: "in_transit",
  40: "out_for_delivery", 41: "out_for_delivery",
  45: "delivered",
  46: "returned", 60: "returned",
  47: "failed_attempt",
  48: "cancelled", 49: "cancelled",
  100: "problem", 101: "problem", 103: "problem",
};

// The ERP's statuses carry less detail than Bosta's codes (24 and 30 are both in_transit).
const JOURNEY_BY_ERP_STATUS = {
  created: "created",
  shipment_created: "created",
  shipping_created: "created",
  picked: "picked_up",
  picked_up: "picked_up",
  in_transit: "in_transit",
  out_for_delivery: "out_for_delivery",
  delivered: "delivered",
  failed: "failed_attempt",
  failed_delivery: "failed_attempt",
  returned: "returned",
  cancelled: "cancelled",
  canceled: "cancelled",
};

const normalizeTitle = (value) => String(value ?? "").trim().toLowerCase().replace(/[^a-z]+/g, " ").trim();

// Bosta's history titles. Its state table's English names first, then the shorter
// spellings the delivery view uses.
const JOURNEY_BY_HISTORY_TITLE = {
  ...Object.fromEntries(
    Object.entries(BOSTA_STATES)
      .filter(([code]) => JOURNEY_BY_STATE_CODE[code])
      .map(([code, state]) => [normalizeTitle(state.en), JOURNEY_BY_STATE_CODE[code]])
  ),
  created: "created",
  new: "created",
  "package created": "created",
  "picked up": "picked_up",
  "in transit": "in_transit",
  "received at hub": "at_warehouse",
  "heading to customer": "out_for_delivery",
  "out for delivery": "out_for_delivery",
  exception: "failed_attempt",
  "delivery failed": "failed_attempt",
  returned: "returned",
  canceled: "cancelled",
  cancelled: "cancelled",
};

const STEP_ORDER = ["created", "picked_up", "at_warehouse", "in_transit", "out_for_delivery", "failed_attempt", "problem", "delivered", "returned", "cancelled"];
const FINISHED = new Set(["delivered", "returned", "cancelled"]);
const MAX_EVENTS = 20;

const key = (value) => String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
const text = (value) => String(value ?? "").trim();

const toIso = (value) => {
  if (value === null || value === undefined || value === "") return "";
  const asNumber = typeof value === "number" || /^\d{10,13}$/.test(String(value)) ? Number(value) : NaN;
  const date = Number.isFinite(asNumber)
    ? new Date(asNumber < 1e12 ? asNumber * 1000 : asNumber)
    : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
};

// bosta_promise_date is a DATE column. node-pg hands a DATE back as local midnight, so
// toISOString() on a Cairo-clock server would name the day before — read it with the
// local getters instead, and take a string's first ten characters as they are.
const calendarDay = (value) => {
  if (!value) return "";
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return "";
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  }
  const match = String(value).match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : "";
};

const asArray = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim().startsWith("[")) {
    try { return JSON.parse(value); } catch { return []; }
  }
  return [];
};

const asObject = (value) => {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim().startsWith("{")) {
    try { return JSON.parse(value); } catch { return {}; }
  }
  return {};
};

export const isBostaParcel = (order = {}) =>
  [order.shipping_provider, order.shipping_provider_id, order.shipping_method].some((value) => key(value).includes("bosta"));

export const trackingNumberOf = (order = {}) => text(order.shipping_tracking_number || order.tracking_number);

const stateCodeOf = (value) => {
  const raw = value && typeof value === "object" ? value.code : value;
  const code = Number(raw);
  return raw !== null && raw !== undefined && raw !== "" && Number.isFinite(code) ? code : null;
};

/** One webhook row → a step, from Bosta's code when it sent one, else the status we recorded. */
const stepFromShippingEvent = (row = {}) => {
  const payload = asObject(row.payload);
  const code = stateCodeOf(payload.state);
  const journey = (code !== null ? JOURNEY_BY_STATE_CODE[code] : "") || JOURNEY_BY_ERP_STATUS[key(row.status)] || "";
  if (!journey) return null;
  return {
    key: journey,
    at: toIso(payload.parsed?.occurredAt) || toIso(payload.timeStamp) || toIso(row.created_at),
    exceptionCode: journey === "failed_attempt" ? stateCodeOf(payload.exceptionCode) : null,
  };
};

const BOSTA_TIMELINE_ACTIONS = new Set(["bosta_create_delivery", "bosta_webhook", "bosta_refresh_status"]);

const stepsFromShipmentTimeline = (timeline) => asArray(timeline)
  .filter((entry) => entry && key(entry.provider) === "bosta" && BOSTA_TIMELINE_ACTIONS.has(text(entry.action)))
  .map((entry) => {
    const journey = JOURNEY_BY_ERP_STATUS[key(entry.status)] || "";
    // A failed attempt is counted from the sources that know WHICH attempt it was; a
    // refresh that keeps reading "failed" would otherwise add one per tick.
    if (!journey || journey === "failed_attempt") return null;
    return { key: journey, at: toIso(entry.at), exceptionCode: null };
  })
  .filter(Boolean);

const stepsFromBostaHistory = (details) => asArray(asObject(details).history)
  .map((entry) => {
    const journey = JOURNEY_BY_HISTORY_TITLE[normalizeTitle(entry?.title)] || "";
    if (!journey) return null;
    return { key: journey, at: toIso(entry?.date), exceptionCode: null };
  })
  .filter(Boolean);

/**
 * Merges the steps: one entry per step at its earliest time, except failed attempts,
 * which are each their own visit (to the minute, so one attempt seen twice stays one).
 * Newest first, like the courier's own app.
 */
export const mergeJourneySteps = (steps = []) => {
  const byKey = new Map();
  const attempts = new Map();
  for (const step of steps) {
    if (!step?.key) continue;
    if (step.key === "failed_attempt") {
      const slot = step.at ? step.at.slice(0, 16) : `undated-${attempts.size}`;
      const existing = attempts.get(slot);
      if (!existing || (step.exceptionCode !== null && existing.exceptionCode === null)) attempts.set(slot, step);
      continue;
    }
    const existing = byKey.get(step.key);
    if (!existing || (step.at && (!existing.at || step.at < existing.at))) byKey.set(step.key, step);
  }
  return [...byKey.values(), ...attempts.values()]
    .sort((a, b) => {
      if (a.at && b.at && a.at !== b.at) return a.at < b.at ? 1 : -1;
      return STEP_ORDER.indexOf(b.key) - STEP_ORDER.indexOf(a.key);
    })
    .slice(0, MAX_EVENTS)
    .map((step) => {
      const reason = step.key === "failed_attempt" ? bostaCustomerFailureReason(step.exceptionCode) : "";
      return { key: step.key, label: JOURNEY_LABELS[step.key], at: step.at || null, ...(reason ? { reason } : {}) };
    });
};

const currentStepOf = (order = {}) => {
  const details = asObject(order.bosta_details);
  const code = stateCodeOf(details.state_code);
  const fromStatus = JOURNEY_BY_ERP_STATUS[key(order.shipment_status || order.shipping_status)] || "";
  // The stored code is only as fresh as the last delivery view; the status column is
  // what every webhook writes. Trust the code only when the two agree on the stage family.
  const fromCode = code !== null ? JOURNEY_BY_STATE_CODE[code] || "" : "";
  if (fromCode && (!fromStatus || JOURNEY_BY_ERP_STATUS[BOSTA_STATES[code]?.erp] === fromStatus)) return fromCode;
  return fromStatus || fromCode || "";
};

/**
 * The `shipment` block of the public tracking response, or null for an order that has
 * no Bosta parcel yet. `events` are the shipping_events rows for this order.
 */
export const buildPublicShipment = (order = {}, { events = [] } = {}) => {
  const trackingNumber = trackingNumberOf(order);
  if (!isBostaParcel(order) || !trackingNumber) return null;
  const steps = mergeJourneySteps([
    ...events.map(stepFromShippingEvent).filter(Boolean),
    ...stepsFromShipmentTimeline(order.shipment_timeline),
    ...stepsFromBostaHistory(order.bosta_details),
  ]);
  const stage = currentStepOf(order) || steps[0]?.key || "created";
  const shippingStatus = key(order.shipment_status || order.shipping_status);
  const finished = FINISHED.has(stage);
  // bosta_exception_code is never cleared, so an attempt that failed last week would keep
  // alarming a parcel that is moving again — the alert is shown only while the parcel is
  // actually stuck on it.
  const alert = shippingStatus === "failed_delivery" || stage === "problem"
    ? describeDeliveryAlert({
      shippingStatus,
      stateCode: asObject(order.bosta_details).state_code ?? null,
      exceptionCode: order.bosta_exception_code ?? null,
      attempts: order.bosta_attempts ?? 0,
    })
    : null;
  const courierName = text(order.bosta_courier_name);
  const courierPhone = text(order.bosta_courier_phone).replace(/[^\d+]/g, "");
  // A promise date on a parcel that already arrived (or came back) reads as "still coming".
  const promiseDate = calendarDay(order.bosta_promise_date);
  const promise = !finished && promiseDate ? promiseDate : null;
  return {
    provider: "bosta",
    tracking_number: trackingNumber,
    stage,
    stage_label: JOURNEY_LABELS[stage] || "",
    promise_date: promise,
    attempts: Math.max(0, Number(order.bosta_attempts) || 0),
    alert: alert
      ? {
        key: alert.key === "failed_attempt" ? "failed_attempt" : "contact_us",
        attempts: alert.attempts,
        ...(bostaCustomerFailureReason(alert.code) ? { reason: bostaCustomerFailureReason(alert.code) } : {}),
      }
      : null,
    courier: stage === "out_for_delivery" && (courierName || courierPhone)
      ? { name: courierName, phone: courierPhone }
      : null,
    events: steps,
    synced_at: toIso(order.bosta_details_synced_at || order.shipping_last_synced_at) || null,
  };
};

export const loadShipmentEvents = async (orderId, client = db) => {
  if (!orderId) return [];
  const result = await client.query(
    `SELECT status, payload, created_at
     FROM shipping_events
     WHERE order_id = $1 AND provider = 'bosta'
     ORDER BY created_at DESC
     LIMIT 60`,
    [orderId]
  );
  return result.rows;
};

/*
 * Opening the page asks Bosta when what we hold is older than this — the webhook is the
 * fast path but has gone silent for months before, and the reconcile tick only looks at
 * parcels unheard of for 45 minutes. Throttled per order in memory so a customer
 * refreshing the page (or a link preview bot) cannot turn it into a Bosta API loop.
 */
const STALE_MS = 15 * 60 * 1000;
const REFRESH_TIMEOUT_MS = 3500;
const lastRefreshAt = new Map();
const IN_FLIGHT = new Set(["created", "shipment_created", "shipping_created", "picked", "picked_up", "in_transit", "out_for_delivery", "failed_delivery", "failed"]);

export const shouldRefreshForCustomer = (order = {}, now = Date.now()) => {
  if (!isBostaParcel(order) || !trackingNumberOf(order) || order.cancelled_at) return false;
  if (!IN_FLIGHT.has(key(order.shipment_status || order.shipping_status))) return false;
  const synced = Math.max(
    new Date(order.shipping_last_synced_at || 0).getTime() || 0,
    new Date(order.bosta_details_synced_at || 0).getTime() || 0,
  );
  if (synced && now - synced < STALE_MS) return false;
  const last = lastRefreshAt.get(String(order.id)) || 0;
  return now - last >= STALE_MS;
};

/**
 * Refreshes the parcel from Bosta when it is stale, waiting at most a few seconds: the
 * page must open on what we have rather than hang on a courier API. Returns true when a
 * refresh finished in time (the caller re-reads the order). It is the same call as
 * تحديث الحالة, so it is gated exactly like the reconcile tick — off outside production.
 */
export const refreshShipmentForCustomer = async (order = {}) => {
  if (!shouldRefreshForCustomer(order)) return false;
  const { bostaReconcileEnabled } = await import("./bosta.reconcile.js");
  if (!bostaReconcileEnabled()) return false;
  lastRefreshAt.set(String(order.id), Date.now());
  if (lastRefreshAt.size > 5000) lastRefreshAt.delete(lastRefreshAt.keys().next().value);
  const { refreshBostaShipmentForOrder } = await import("./shipping.service.js");
  const refresh = refreshBostaShipmentForOrder(order.id).then(() => true).catch((error) => {
    console.warn("[track] bosta refresh failed", { orderId: order.id, code: error?.code, message: error?.message || String(error) });
    return false;
  });
  let timer;
  const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(false), REFRESH_TIMEOUT_MS); });
  try {
    return await Promise.race([refresh, timeout]);
  } finally {
    clearTimeout(timer);
  }
};

export const __resetCustomerRefreshThrottle = () => lastRefreshAt.clear();
