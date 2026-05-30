export const ORDER_LIFECYCLE_STATUSES = [
  "pending",
  "confirmed",
  "ready_to_ship",
  "shipment_created",
  "out_for_delivery",
  "delivered",
  "returned",
  "cancelled",
];

export const SHIPPING_LIFECYCLE_STATUSES = [
  "pending",
  "ready_to_ship",
  "created",
  "picked_up",
  "in_transit",
  "delivered",
  "failed",
  "cancelled",
];

export const ORDER_STATUS_LABELS = {
  pending: "Pending",
  confirmed: "Confirmed",
  ready_to_ship: "Ready to Ship",
  shipment_created: "Shipment Created",
  out_for_delivery: "Out for Delivery",
  delivered: "Delivered",
  returned: "Returned",
  cancelled: "Cancelled",
};

export const SHIPPING_STATUS_LABELS = {
  pending: "Pending",
  ready_to_ship: "Ready to Ship",
  created: "Created",
  picked_up: "Picked Up",
  in_transit: "In Transit",
  delivered: "Delivered",
  failed: "Failed",
  cancelled: "Cancelled",
};

const normalizeKey = (value = "") =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

export const ORDER_STATUS_ALIASES = {
  awaiting_verification: "pending",
  payment_pending: "pending",
  pending_payment: "pending",
  draft: "pending",
  new: "pending",
  open: "pending",
  paid: "confirmed",
  approved: "confirmed",
  processing: "ready_to_ship",
  packed: "ready_to_ship",
  ready: "ready_to_ship",
  ready_for_shipping: "ready_to_ship",
  ready_to_ship: "ready_to_ship",
  shipped: "shipment_created",
  shipping_created: "shipment_created",
  shipment_created: "shipment_created",
  in_transit: "out_for_delivery",
  out_for_delivery: "out_for_delivery",
  completed: "delivered",
  complete: "delivered",
  refunded: "returned",
  fully_refunded: "returned",
  partially_refunded: "returned",
  partial_refund: "returned",
  return_completed: "returned",
  canceled: "cancelled",
  payment_rejected: "cancelled",
  rejected: "cancelled",
};

export const SHIPPING_STATUS_ALIASES = {
  draft: "pending",
  open: "pending",
  ready: "ready_to_ship",
  ready_for_shipping: "ready_to_ship",
  ready_to_ship: "ready_to_ship",
  shipment_created: "created",
  shipping_created: "created",
  created: "created",
  shipped: "created",
  picked: "picked_up",
  picked_up: "picked_up",
  pickup_done: "picked_up",
  out_for_delivery: "in_transit",
  on_the_way: "in_transit",
  in_transit: "in_transit",
  delivered: "delivered",
  complete: "delivered",
  completed: "delivered",
  failed: "failed",
  delivery_failed: "failed",
  cancelled: "cancelled",
  canceled: "cancelled",
};

export const normalizeOrderLifecycleStatus = (value, fallback = "pending") => {
  const key = normalizeKey(value);
  if (ORDER_LIFECYCLE_STATUSES.includes(key)) return key;
  if (ORDER_STATUS_ALIASES[key]) return ORDER_STATUS_ALIASES[key];
  const fallbackKey = normalizeKey(fallback);
  return ORDER_LIFECYCLE_STATUSES.includes(fallbackKey) ? fallbackKey : "pending";
};

export const normalizeShippingLifecycleStatus = (value, fallback = "pending") => {
  const key = normalizeKey(value);
  if (SHIPPING_LIFECYCLE_STATUSES.includes(key)) return key;
  if (SHIPPING_STATUS_ALIASES[key]) return SHIPPING_STATUS_ALIASES[key];
  const fallbackKey = normalizeKey(fallback);
  if (SHIPPING_LIFECYCLE_STATUSES.includes(fallbackKey)) return fallbackKey;
  return SHIPPING_STATUS_ALIASES[fallbackKey] || "pending";
};

export const isOrderLifecycleStatus = (value) =>
  ORDER_LIFECYCLE_STATUSES.includes(normalizeKey(value));

export const isShippingLifecycleStatus = (value) =>
  SHIPPING_LIFECYCLE_STATUSES.includes(normalizeKey(value)) || Boolean(SHIPPING_STATUS_ALIASES[normalizeKey(value)]);
