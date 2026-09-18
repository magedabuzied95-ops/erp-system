/*
 * Bosta's own vocabulary, taken from the official API spec (docs.bosta.co/api/api.yaml)
 * and the published webhook contract — never guessed from spellings.
 *
 * One module for the server (which stores and alerts on these) and the screens (which
 * explain them), so a failed attempt reads the same in the order, the Shipping Center,
 * the manager alert and the customer's WhatsApp message.
 */

/*
 * Exception (NDR) codes. A webhook carries them only on state 47. `customer` is the
 * wording the CUSTOMER reads; it exists only for the reasons the customer can actually
 * fix by replying — a cancellation the shop asked for, or a hub that lost the parcel, is
 * never something to message a customer about.
 */
export const BOSTA_EXCEPTION_REASONS = {
  1: { en: "Customer not at the address", ar: "العميل مش موجود في العنوان", customer: "المندوب وصل العنوان ومكنتش موجود" },
  2: { en: "Customer changed the address", ar: "العميل غيّر العنوان" },
  3: { en: "Customer postponed to another day", ar: "العميل أجّل الاستلام ليوم تاني" },
  4: { en: "Customer wants to open the parcel", ar: "العميل عايز يفتح الشحنة" },
  5: { en: "Address or phone unclear/wrong", ar: "العنوان أو الموبايل مش واضح أو غلط", customer: "المندوب مقدرش يوصل للعنوان أو الرقم" },
  6: { en: "Cancelled at the sender's request", ar: "اتلغت بطلب مننا" },
  7: { en: "Customer not answering", ar: "العميل مبيردش", customer: "المندوب اتصل بيك ومحدش رد" },
  8: { en: "Customer refused the parcel", ar: "العميل رفض الاستلام" },
  12: { en: "Address outside Bosta coverage", ar: "العنوان خارج تغطية بوسطة" },
  13: { en: "Address not clear", ar: "العنوان مش واضح", customer: "المندوب مقدرش يوصل للعنوان" },
  14: { en: "Wrong phone number", ar: "رقم الموبايل غلط", customer: "رقم الموبايل اللي معانا مش شغال" },
  20: { en: "Return: business changed the address", ar: "مرتجع: غيّرنا عنوان الاستلام" },
  21: { en: "Return: business postponed", ar: "مرتجع: أجّلنا الاستلام" },
  22: { en: "Return: address or phone wrong", ar: "مرتجع: عنواننا أو رقمنا غلط" },
  23: { en: "Return: business not answering", ar: "مرتجع: محدش رد عندنا" },
  24: { en: "Return: business refused the parcel", ar: "مرتجع: رفضنا استلام المرتجع" },
  25: { en: "Return: business not at the address", ar: "مرتجع: محدش كان موجود عندنا" },
  26: { en: "The parcel is damaged", ar: "الشحنة تالفة" },
  27: { en: "Empty parcel", ar: "الشحنة فاضية" },
  28: { en: "Parcel incomplete", ar: "الشحنة ناقصة" },
  29: { en: "Parcel does not belong to the business", ar: "الشحنة مش بتاعتنا" },
  30: { en: "Parcel was opened when it should not be", ar: "الشحنة اتفتحت من غير إذن" },
  100: { en: "Bad weather", ar: "سوء الأحوال الجوية" },
  101: { en: "Suspicious consignee", ar: "المستلم مشتبه فيه" },
};

// Reasons that mean the order is about to die rather than be retried: worth a louder alert.
export const BOSTA_SEVERE_EXCEPTION_CODES = new Set([4, 6, 8, 12, 26, 27, 28, 101]);

export const bostaExceptionReason = (code, fallback = "", lang = "ar") => {
  const entry = BOSTA_EXCEPTION_REASONS[Number(code)];
  if (entry) return lang === "en" ? entry.en : entry.ar;
  return String(fallback || "").trim();
};

// Only a reason with customer wording may reach the customer.
export const bostaCustomerFailureReason = (code) => BOSTA_EXCEPTION_REASONS[Number(code)]?.customer || "";

/*
 * The full delivery-state table. `erp` is the status the ERP tracks; a state without one
 * (on hold, investigation, archived) is recorded but must never move an order — guessing
 * what it means is how a wrong status becomes unfalsifiable from the UI.
 */
export const BOSTA_STATES = {
  10: { en: "Pickup requested", ar: "في انتظار البيك أب", erp: "shipment_created" },
  11: { en: "Waiting for route", ar: "في انتظار خط السير", erp: "shipment_created" },
  20: { en: "Route assigned", ar: "اتحدد خط السير", erp: "shipment_created" },
  21: { en: "Picked up from business", ar: "المندوب استلم من المحل", erp: "picked_up" },
  22: { en: "Picking up from consignee", ar: "في الطريق للعميل لاستلام مرتجع", erp: "in_transit" },
  23: { en: "Picked up from consignee", ar: "اتستلم من العميل", erp: "in_transit" },
  24: { en: "Received at warehouse", ar: "وصلت مخزن بوسطة", erp: "in_transit" },
  25: { en: "Fulfilled", ar: "اتجهزت", erp: "in_transit" },
  30: { en: "In transit between hubs", ar: "بتتنقل بين الفروع", erp: "in_transit" },
  // Dashboard name for both 40 and 41 is "Heading to customer".
  40: { en: "Picking up", ar: "المندوب في الطريق للعميل", erp: "out_for_delivery" },
  41: { en: "Out for delivery", ar: "خرجت للتسليم", erp: "out_for_delivery" },
  45: { en: "Delivered", ar: "اتسلمت", erp: "delivered" },
  46: { en: "Returned to business", ar: "رجعت لينا", erp: "returned" },
  47: { en: "Exception", ar: "محاولة تسليم فشلت", erp: "failed_delivery" },
  48: { en: "Terminated", ar: "اتقفلت بعد المحاولات", erp: "cancelled" },
  49: { en: "Cancelled", ar: "اتلغت", erp: "cancelled" },
  60: { en: "Returned to stock", ar: "رجعت للمخزون", erp: "returned" },
  100: { en: "Lost", ar: "ضاعت", erp: "failed_delivery" },
  101: { en: "Damaged", ar: "اتلفت", erp: "failed_delivery" },
  102: { en: "Investigation", ar: "تحت التحقيق", erp: "" },
  103: { en: "Awaiting your action", ar: "مستنية قرار مننا", erp: "failed_delivery" },
  104: { en: "Archived", ar: "اتأرشفت", erp: "" },
  105: { en: "On hold", ar: "متوقفة مؤقتاً", erp: "" },
};

export const bostaStateLabel = (code, lang = "ar") => {
  const entry = BOSTA_STATES[Number(code)];
  return entry ? (lang === "en" ? entry.en : entry.ar) : "";
};

// Bosta's promise date arrives as "13-07-2023" (day first). Returned as YYYY-MM-DD, or ""
// for anything that is not a real calendar day — never a guessed month/day swap.
export const parseBostaPromiseDate = (value) => {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const dayFirst = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  let year;
  let month;
  let day;
  if (dayFirst) [, day, month, year] = dayFirst.map(Number);
  else if (iso) [, year, month, day] = iso.map(Number);
  else return "";
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return "";
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
};

/*
 * ---------------------------------------------------------------------------
 * What the parcel needs from a human, said once for every screen that asks.
 *
 * The board, the order page and the manager alert all want the same three
 * answers: has this parcel left the shop, is it stuck, and did the customer
 * refuse it. Deriving them separately is how the same shipment ends up reading
 * "out for delivery" in one place and "لم يتم تأكيد الأوردر" in another.
 * ---------------------------------------------------------------------------
 */

const key = (value = "") => String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");

// The shipping statuses that mean the box is no longer in the shop's hands. The
// courier has it, or had it — either way, nothing about confirming or collecting
// the shipping fee is still an open question the staff can act on.
export const DISPATCHED_SHIPPING_STATUSES = new Set([
  "created",
  "shipment_created",
  "shipping_created",
  "picked",
  "picked_up",
  "pickup_done",
  "in_transit",
  "on_the_way",
  "out_for_delivery",
  "delivered",
  "failed",
  "failed_delivery",
  "delivery_failed",
  "returned",
  "return",
]);

const DISPATCHED_ORDER_STATUSES = new Set([
  "shipment_created",
  "shipping_created",
  "shipped",
  "in_transit",
  "out_for_delivery",
  "delivered",
  "completed",
  "complete",
  "returned",
  "partially_returned",
]);

/**
 * Has this order left the shop? True from the moment a real parcel exists — a
 * booked shipment IS the shop's decision to send it, whatever the confirmation
 * columns still say.
 */
export const orderLeftTheShop = ({ status = "", shippingStatus = "", trackingNumber = "" } = {}) =>
  Boolean(String(trackingNumber ?? "").trim())
  || DISPATCHED_SHIPPING_STATUSES.has(key(shippingStatus))
  || DISPATCHED_ORDER_STATUSES.has(key(status));

// A failed attempt, however the status was spelled on the way in.
const FAILED_SHIPPING_STATUSES = new Set(["failed", "failed_delivery", "delivery_failed"]);
const FINISHED_SHIPPING_STATUSES = new Set(["delivered", "returned", "return", "cancelled", "canceled"]);

// The customer turned the parcel away at the door. Its own alert because it is
// the one failure the shop answers with a phone call, not a retry.
export const BOSTA_REFUSED_EXCEPTION_CODES = new Set([8]);

// Reasons nobody at Bosta can fix: the parcel waits on a decision from us.
const BOSTA_BLOCKED_EXCEPTION_CODES = new Set([2, 4, 5, 12, 13, 14, 26, 27, 28, 29, 30, 101]);

// The states the ERP maps to failed_delivery that are not a doorstep attempt at
// all — the parcel is lost, damaged or parked waiting for our answer.
const BOSTA_BLOCKED_STATE_CODES = new Set([100, 101, 103]);

/**
 * One alert for a parcel that needs a person, or null when it is simply moving.
 * `key` is the message, `tone` how loudly to draw it, `code` the Bosta exception
 * behind it so the screen can print Bosta's own wording beside ours.
 *
 * Pure on purpose: the server decides nothing here, it only hands over the four
 * facts (status, state code, exception, attempts) it already stores.
 */
export const describeDeliveryAlert = ({
  shippingStatus = "",
  stateCode = null,
  exceptionCode = null,
  attempts = 0,
} = {}) => {
  const shipping = key(shippingStatus);
  const state = Number.isFinite(Number(stateCode)) && stateCode !== null ? Number(stateCode) : null;
  const exception = Number.isFinite(Number(exceptionCode)) && exceptionCode !== null ? Number(exceptionCode) : null;
  const tries = Math.max(0, Number(attempts) || 0);
  // A delivered or returned parcel is finished: whatever went wrong on the way is
  // history, and an alert on it is noise on a closed order.
  if (FINISHED_SHIPPING_STATUSES.has(shipping)) return null;
  const failed = FAILED_SHIPPING_STATUSES.has(shipping);
  if (!failed && exception === null && !BOSTA_BLOCKED_STATE_CODES.has(state)) return null;
  if (exception !== null && BOSTA_REFUSED_EXCEPTION_CODES.has(exception)) {
    return { key: "refused", tone: "danger", code: exception, attempts: tries };
  }
  if (BOSTA_BLOCKED_STATE_CODES.has(state) || (exception !== null && BOSTA_BLOCKED_EXCEPTION_CODES.has(exception))) {
    return { key: "action_needed", tone: "danger", code: exception, attempts: tries };
  }
  if (failed || exception !== null) {
    // Bosta gives up after three; the second failure is already worth a call.
    return { key: tries >= 2 ? "action_needed" : "failed_attempt", tone: tries >= 2 ? "danger" : "warning", code: exception, attempts: tries };
  }
  return null;
};
