import bostaProvider from "./bostaProvider.js";
import inStoreDeliveryProvider from "./inStoreDeliveryProvider.js";

const placeholderProvider = (key, name) => ({
  key,
  name,
  isConfigured: () => false,
  async createShipment() {
    return {
      success: false,
      provider: key,
      provider_id: key,
      message: `${name} credentials are not configured yet. Use In Store Delivery for now.`,
    };
  },
  async trackShipment(order = {}) {
    return {
      success: false,
      provider: key,
      provider_id: key,
      shipping_status: order.shipping_status || "pending",
      tracking_number: order.tracking_number || "",
      tracking_url: order.tracking_url || "",
      message: `${name} tracking is not configured yet.`,
    };
  },
});

export const shippingProviderCatalog = [
  bostaProvider,
  placeholderProvider("mylerz", "Mylerz"),
  placeholderProvider("shipblu", "ShipBlu"),
  inStoreDeliveryProvider,
];

export const shippingProviders = {
  bosta: bostaProvider,
  mylerz: shippingProviderCatalog.find((provider) => provider.key === "mylerz"),
  shipblu: shippingProviderCatalog.find((provider) => provider.key === "shipblu"),
  in_store_delivery: inStoreDeliveryProvider,
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
