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

export const normalizeOrderLifecycleStatus = (value, fallback = "pending") => {
  const key = normalizeKey(value);
  if (ORDER_LIFECYCLE_STATUSES.includes(key)) return key;
  if (ORDER_STATUS_ALIASES[key]) return ORDER_STATUS_ALIASES[key];
  const fallbackKey = normalizeKey(fallback);
  return ORDER_LIFECYCLE_STATUSES.includes(fallbackKey) ? fallbackKey : "pending";
};

export const isOrderLifecycleStatus = (value) =>
  ORDER_LIFECYCLE_STATUSES.includes(normalizeKey(value));
