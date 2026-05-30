import { normalizeProviderResponse } from "./response.js";

const inStoreDeliveryProvider = {
  key: "in_store_delivery",
  name: "In Store Delivery",
  isConfigured: () => true,
  async createShipment(order = {}) {
    return normalizeProviderResponse({
      success: true,
      provider: "in_store_delivery",
      provider_id: "in_store_delivery",
      status: "created",
      shipment_id: order.shipment_id || `in-store-${order.id || Date.now()}`,
      tracking_number: order.tracking_number || "",
      tracking_url: order.tracking_url || "",
      raw_response: { mode: "offline" },
      message: "In Store Delivery is ready. Add tracking details when available.",
    });
  },
  async trackShipment(order = {}) {
    return normalizeProviderResponse({
      success: true,
      provider: "in_store_delivery",
      provider_id: "in_store_delivery",
      status: order.shipment_status || order.shipping_status || "created",
      shipment_id: order.shipment_id || null,
      tracking_number: order.tracking_number || "",
      tracking_url: order.tracking_url || "",
      raw_response: { mode: "offline" },
    });
  },
};

export default inStoreDeliveryProvider;
