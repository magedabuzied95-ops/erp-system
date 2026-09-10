// Which buttons أوردرات الشحن offers for an order: the next step(s) of the flow, in
// order — confirm → ready to ship → create the Bosta parcel → print its airway bill.
// The server enforces the same order (shipping.portal.actions.js); this only decides
// what to show.

const text = (value = "") => String(value ?? "").trim();
const lower = (value = "") => text(value).toLowerCase();

// Couriers the ERP treats as "none booked yet" — the set the server's
// canCreateBostaShipmentFor accepts; anything else is another courier's parcel.
const BOSTA_BOOKABLE_PROVIDERS = new Set(["", "bosta", "manual", "in_store_delivery", "in-store-delivery", "store_pickup", "none", "null"]);

export const PORTAL_ORDER_ACTIONS = ["confirm", "ready_to_ship", "create_shipment", "print_awb"];

export const portalOrderActionsFor = (order = {}) => {
  const status = lower(order.status);
  const provider = lower(order.shipment?.provider);
  const hasParcel = Boolean(text(order.shipment?.tracking_number) || text(order.shipment?.delivery_id));
  const actions = [];
  if (order.group === "new") actions.push("confirm");
  if (order.group === "confirmed") {
    if (status !== "ready_to_ship") actions.push("ready_to_ship");
    if (!hasParcel && BOSTA_BOOKABLE_PROVIDERS.has(provider)) actions.push("create_shipment");
  }
  if (hasParcel && provider === "bosta") actions.push("print_awb");
  return actions;
};

// The server answers a refused action with a code; each has its own sentence.
export const PORTAL_ACTION_ERROR_CODES = [
  "ORDER_NOT_CONFIRMABLE",
  "ORDER_NOT_CONFIRMED",
  "ORDER_PAST_READY",
  "BOSTA_SHIPMENT_EXISTS",
  "OTHER_COURIER",
  "BOSTA_DISABLED",
  "BOSTA_NOT_CONFIGURED",
  "BOSTA_ADDRESS_INCOMPLETE",
  "BOSTA_ADDRESS_TOO_SHORT",
  "BOSTA_ZERO_COLLECTION",
  "BOSTA_NO_PRINTABLE_LABEL",
  "BOSTA_AWB_EMPTY",
  "ONLINE_ORDERS_ACTIONS_DISABLED",
  "NO_ORDERS_SELECTED",
  "TOO_MANY_ORDERS",
];

export const pdfUrlFromBase64 = (base64) => {
  const binary = window.atob(String(base64 || ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
};
