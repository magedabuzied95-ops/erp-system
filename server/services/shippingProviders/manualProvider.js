import { normalizeProviderResponse } from "./response.js";

const manualProvider = {
  key: "manual",
  name: "Manual delivery",
  isConfigured: () => true,
  async createShipment(order = {}) {
    return normalizeProviderResponse({
      success: true,
      provider: "manual",
      provider_id: "manual",
      status: "created",
      shipment_id: order.shipment_id || `manual-${order.id || Date.now()}`,
      tracking_number: order.tracking_number || "",
      tracking_url: order.tracking_url || "",
      raw_response: { mode: "offline" },
      message: "Manual delivery is ready. Add tracking details when available.",
    });
  },
  async trackShipment(order = {}) {
    return normalizeProviderResponse({
      success: true,
      provider: "manual",
      provider_id: "manual",
      status: order.shipment_status || order.shipping_status || "created",
      shipment_id: order.shipment_id || null,
      tracking_number: order.tracking_number || "",
      tracking_url: order.tracking_url || "",
      raw_response: { mode: "offline" },
    });
  },
  async refreshStatus(order = {}) {
    return this.trackShipment(order);
  },
  async cancelShipment(order = {}) {
    return normalizeProviderResponse({
      success: true,
      provider: "manual",
      provider_id: "manual",
      status: "cancelled",
      shipment_id: order.shipment_id || null,
      tracking_number: order.tracking_number || "",
      raw_response: { mode: "offline" },
    });
  },
  async printLabel(order = {}) {
    return normalizeProviderResponse({
      success: Boolean(order.shipping_label_url),
      provider: "manual",
      provider_id: "manual",
      status: order.shipment_status || order.shipping_status || "created",
      shipment_id: order.shipment_id || null,
      tracking_number: order.tracking_number || "",
      label_url: order.shipping_label_url || "",
      raw_response: { mode: "offline" },
    });
  },
};

export default manualProvider;
