import bostaProvider from "./bostaProvider.js";
import inStoreDeliveryProvider from "./inStoreDeliveryProvider.js";
import { normalizeProviderResponse } from "./response.js";

export { normalizeProviderResponse } from "./response.js";

const placeholderProvider = (key, name) => ({
  key,
  name,
  isConfigured: () => false,
  async createShipment() {
    // TODO: Add ${name} API credentials, endpoint mapping, label creation, and webhook handlers.
    return normalizeProviderResponse({
      success: false,
      provider: key,
      provider_id: key,
      status: "failed",
      error: `${name} credentials are not configured yet. Use In Store Delivery for now.`,
    });
  },
  async refreshStatus(order = {}) {
    return this.trackShipment(order);
  },
  async cancelShipment(order = {}) {
    return normalizeProviderResponse({
      success: false,
      provider: key,
      provider_id: key,
      status: order.shipment_status || order.shipping_status || "pending",
      error: `${name} cancellation is not configured yet.`,
    });
  },
  async printLabel(order = {}) {
    return normalizeProviderResponse({
      success: false,
      provider: key,
      provider_id: key,
      status: order.shipment_status || order.shipping_status || "pending",
      tracking_number: order.tracking_number || order.shipping_tracking_number || "",
      label_url: order.shipping_label_url || "",
      error: `${name} label printing is not configured yet.`,
    });
  },
  async trackShipment(order = {}) {
    // TODO: Replace this placeholder with ${name} tracking API and webhook status sync.
    return normalizeProviderResponse({
      success: false,
      provider: key,
      provider_id: key,
      status: order.shipment_status || order.shipping_status || "pending",
      tracking_number: order.tracking_number || "",
      tracking_url: order.tracking_url || "",
      error: `${name} tracking is not configured yet.`,
    });
  },
});

// The shop's own motorcycle courier (modules/shipping/localCourier.js): offline like in-store
// delivery, but a key of its own so its parcels and the cash they bring back stay apart.
const localCourierProvider = { ...inStoreDeliveryProvider, key: "local_courier", name: "Local Courier" };

export const shippingProviderCatalog = [
  bostaProvider,
  placeholderProvider("mylerz", "Mylerz"),
  placeholderProvider("aramex", "Aramex"),
  placeholderProvider("shipblu", "ShipBlu"),
  inStoreDeliveryProvider,
  localCourierProvider,
];

export const shippingProviders = {
  bosta: bostaProvider,
  mylerz: shippingProviderCatalog.find((provider) => provider.key === "mylerz"),
  aramex: shippingProviderCatalog.find((provider) => provider.key === "aramex"),
  shipblu: shippingProviderCatalog.find((provider) => provider.key === "shipblu"),
  in_store_delivery: inStoreDeliveryProvider,
  local_courier: localCourierProvider,
  manual: inStoreDeliveryProvider,
  store_pickup: inStoreDeliveryProvider,
};

export const normalizeShippingProviderKey = (key = "in_store_delivery") => {
  const normalized = String(key || "in_store_delivery").trim().toLowerCase();
  if (normalized === "manual" || normalized === "store_pickup" || normalized === "in-store-delivery") return "in_store_delivery";
  return shippingProviders[normalized] ? normalized : "in_store_delivery";
};

export const getShippingProvider = (key = "manual") =>
  shippingProviders[normalizeShippingProviderKey(key)] || inStoreDeliveryProvider;

export default shippingProviders;
