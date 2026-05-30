import { normalizeProviderResponse } from "./response.js";

const hasCredentials = () =>
  Boolean(String(process.env.BOSTA_API_KEY || "").trim()) &&
  Boolean(String(process.env.BOSTA_BASE_URL || "").trim());

const bostaProvider = {
  key: "bosta",
  name: "Bosta",
  isConfigured: hasCredentials,
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
};

export default bostaProvider;
