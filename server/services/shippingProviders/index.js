import bostaProvider from "./bostaProvider.js";
import manualProvider from "./manualProvider.js";

const placeholderProvider = (key, name) => ({
  key,
  name,
  isConfigured: () => false,
  async createShipment() {
    return {
      success: false,
      provider: key,
      message: `${name} credentials are not configured yet. Use manual shipping for now.`,
    };
  },
  async trackShipment(order = {}) {
    return {
      success: false,
      provider: key,
      shipping_status: order.shipping_status || "pending",
      tracking_number: order.tracking_number || "",
      tracking_url: order.tracking_url || "",
      message: `${name} tracking is not configured yet.`,
    };
  },
});

export const shippingProviders = {
  bosta: bostaProvider,
  mylerz: placeholderProvider("mylerz", "Mylerz"),
  aramex: placeholderProvider("aramex", "Aramex"),
  manual: manualProvider,
  store_pickup: placeholderProvider("store_pickup", "Store pickup"),
};

export const getShippingProvider = (key = "manual") =>
  shippingProviders[String(key || "manual").trim().toLowerCase()] || manualProvider;

export default shippingProviders;
