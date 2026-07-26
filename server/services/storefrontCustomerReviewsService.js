import { parseLegacyDeliveryRange, normalizeShippingPolicyZone } from "../../src/shared/lib/merchantPolicies.js";
import { resolveZoneHandlingTime } from "../../src/shared/lib/shippingHandlingSettings.js";
import { getSetting } from "./settingsService.js";
import { loadShippingZones } from "./storefrontShippingService.js";

export const GOOGLE_CUSTOMER_REVIEWS_MERCHANT_ID = 5829421968;
export const GOOGLE_CUSTOMER_REVIEWS_DELIVERY_COUNTRY = "EG";

const text = (value = "") => String(value ?? "").trim();
const blockedOrderStatuses = new Set(["cancelled", "canceled", "failed", "payment_failed", "draft", "incomplete", "abandoned"]);
const weekdayByCode = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

export const isValidCustomerReviewEmail = (value = "") =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text(value).toLowerCase());

export const isValidGtin = (value = "") => {
  const raw = text(value);
  const digits = raw.replace(/\D/g, "");
  if (![8, 12, 13, 14].includes(digits.length) || digits !== raw) return false;
  const values = [...digits].map(Number);
  const checkDigit = values.pop();
  const sum = values.reverse().reduce((total, digit, index) => total + digit * (index % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === checkDigit;
};

const cairoDateParts = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const read = (type) => Number(parts.find((part) => part.type === type)?.value || 0);
  const year = read("year");
  const month = read("month");
  const day = read("day");
  return year && month && day ? { year, month, day } : null;
};

const formatUtcDate = (date) =>
  `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;

export const addConfiguredWorkingDays = ({ createdAt, days, workingDays = [] } = {}) => {
  const parts = cairoDateParts(createdAt);
  if (!parts) return "";
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12, 0, 0));
  const count = Math.max(0, Math.round(Number(days || 0)));
  const allowedDays = new Set(
    (Array.isArray(workingDays) ? workingDays : [])
      .map((code) => weekdayByCode[text(code).toLowerCase()])
      .filter((day) => Number.isInteger(day))
  );
  if (!allowedDays.size) {
    date.setUTCDate(date.getUTCDate() + count);
    return formatUtcDate(date);
  }
  let remaining = count;
  while (remaining > 0) {
    date.setUTCDate(date.getUTCDate() + 1);
    if (allowedDays.has(date.getUTCDay())) remaining -= 1;
  }
  return formatUtcDate(date);
};

const transitMaxDays = (zone = {}) => {
  const normalized = normalizeShippingPolicyZone(zone);
  const direct = normalized.transit_max_days;
  if (direct !== null && direct !== undefined && Number.isFinite(Number(direct)) && Number(direct) >= 0) {
    return Math.round(Number(direct));
  }
  const delivery = normalized.delivery_max_days;
  if (delivery !== null && delivery !== undefined && Number.isFinite(Number(delivery)) && Number(delivery) >= 0) {
    return Math.round(Number(delivery));
  }
  return parseLegacyDeliveryRange(zone.estimated_delivery_text || zone.estimatedDeliveryText || zone.eta)?.maxValue ?? null;
};

const maximumConfiguredTransit = (zones = []) => {
  const values = zones.map(transitMaxDays).filter((value) => Number.isInteger(value) && value >= 0);
  return values.length ? Math.max(...values) : null;
};

export const buildCustomerReviewsProducts = (items = []) => {
  const products = (Array.isArray(items) ? items : [])
    .map((item) => text(item.gtin || item.variant_gtin))
    .filter(isValidGtin)
    .map((gtin) => ({ gtin }));
  return [...new Map(products.map((item) => [item.gtin, item])).values()];
};

export const buildCustomerReviewOptInPayload = ({
  order = {},
  email = "",
  items = [],
  shippingZone = null,
  fallbackZones = [],
  handlingMinDays = 0,
  handlingMaxDays = 1,
  workingDays = [],
} = {}) => {
  const orderId = text(order.public_order_number || order.invoice_number || order.id);
  const normalizedEmail = text(email).toLowerCase();
  const status = text(order.status).toLowerCase();
  if (!orderId || !isValidCustomerReviewEmail(normalizedEmail) || blockedOrderStatuses.has(status)) return null;

  const resolvedHandling = resolveZoneHandlingTime(shippingZone || {}, handlingMinDays, handlingMaxDays);
  const maxHandling = resolvedHandling?.maxDays;
  const maxTransit = shippingZone ? transitMaxDays(shippingZone) : maximumConfiguredTransit(fallbackZones);
  if (!Number.isInteger(maxHandling) || !Number.isInteger(maxTransit)) return null;

  const estimatedDeliveryDate = addConfiguredWorkingDays({
    createdAt: order.created_at || order.createdAt,
    days: maxHandling + maxTransit,
    workingDays,
  });
  if (!estimatedDeliveryDate) return null;

  const products = buildCustomerReviewsProducts(items);
  return {
    merchant_id: GOOGLE_CUSTOMER_REVIEWS_MERCHANT_ID,
    order_id: orderId,
    email: normalizedEmail,
    delivery_country: GOOGLE_CUSTOMER_REVIEWS_DELIVERY_COUNTRY,
    estimated_delivery_date: estimatedDeliveryDate,
    ...(products.length ? { products } : {}),
  };
};

export const createStorefrontCustomerReviewData = async ({ order, email, items, shippingQuote } = {}) => {
  const [handlingMinDays, handlingMaxDays, workingDays, shipping] = await Promise.all([
    getSetting("storefront.shipping_handling_min_days", 0),
    getSetting("storefront.shipping_handling_max_days", 1),
    getSetting("general.business_working_days", ["sat", "sun", "mon", "tue", "wed", "thu"]),
    loadShippingZones(),
  ]);
  return buildCustomerReviewOptInPayload({
    order,
    email,
    items,
    shippingZone: shippingQuote?.zone || null,
    fallbackZones: shipping.zones,
    handlingMinDays,
    handlingMaxDays,
    workingDays,
  });
};
