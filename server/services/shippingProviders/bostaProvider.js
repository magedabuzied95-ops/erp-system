import { normalizeProviderResponse } from "./response.js";
import { syncBostaLocations } from "../../modules/shipping/shipping.service.js";

const hasCredentials = () =>
  Boolean(String(process.env.BOSTA_API_KEY || "").trim()) &&
  Boolean(String(process.env.BOSTA_BASE_URL || "").trim());

const bostaProvider = {
  key: "bosta",
  name: "Bosta",
  isConfigured: hasCredentials,
  syncLocations: syncBostaLocations,
  async createShipment() {
    // TODO: Add Bosta shipment API request mapping, credentials validation, and webhook handlers.
    if (!hasCredentials()) {
      return normalizeProviderResponse({
        success: false,
        provider: "bosta",
        provider_id: "bosta",
        status: "failed",
        error: "Bosta credentials are missing. Use manual shipping for this order.",
      });
    }

    return normalizeProviderResponse({
      success: false,
      provider: "bosta",
      provider_id: "bosta",
      status: "failed",
      error: "Bosta API adapter is ready for credentials and endpoint mapping.",
    });
  },
  async trackShipment(order = {}) {
    // TODO: Replace this with Bosta tracking API polling plus webhook-driven updates.
    if (!hasCredentials()) {
      return normalizeProviderResponse({
        success: false,
        provider: "bosta",
        provider_id: "bosta",
        status: order.shipment_status || order.shipping_status || "pending",
        error: "Bosta credentials are missing. Manual tracking is available.",
      });
    }

    return normalizeProviderResponse({
      success: true,
      provider: "bosta",
      provider_id: "bosta",
      status: order.shipment_status || order.shipping_status || "pending",
      shipment_id: order.shipment_id || null,
      tracking_number: order.tracking_number || "",
      tracking_url: order.tracking_url || "",
    });
  },
  async refreshStatus(order = {}) {
    return this.trackShipment(order);
  },
  async cancelShipment(order = {}) {
    return normalizeProviderResponse({
      success: false,
      provider: "bosta",
      provider_id: "bosta",
      status: order.shipment_status || order.shipping_status || "pending",
      shipment_id: order.shipment_id || order.shipping_provider_delivery_id || null,
      tracking_number: order.tracking_number || order.shipping_tracking_number || "",
      error: "Use the Bosta shipment cancellation endpoint once the delivery exists.",
    });
  },
  async printLabel(order = {}) {
    return normalizeProviderResponse({
      success: Boolean(order.shipping_label_url),
      provider: "bosta",
      provider_id: "bosta",
      status: order.shipment_status || order.shipping_status || "pending",
      shipment_id: order.shipment_id || order.shipping_provider_delivery_id || null,
      tracking_number: order.tracking_number || order.shipping_tracking_number || "",
      label_url: order.shipping_label_url || "",
      error: order.shipping_label_url ? "" : "No Bosta label URL is stored for this order yet.",
    });
  },
};

export default bostaProvider;
