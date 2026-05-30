const hasCredentials = () =>
  Boolean(String(process.env.BOSTA_API_KEY || "").trim()) &&
  Boolean(String(process.env.BOSTA_BASE_URL || "").trim());

const bostaProvider = {
  key: "bosta",
  name: "Bosta",
  isConfigured: hasCredentials,
  async createShipment() {
    if (!hasCredentials()) {
      return {
        success: false,
        provider: "bosta",
        provider_id: "bosta",
        message: "Bosta credentials are missing. Use manual shipping for this order.",
      };
    }

    return {
      success: false,
      provider: "bosta",
      provider_id: "bosta",
      message: "Bosta API adapter is ready for credentials and endpoint mapping.",
    };
  },
  async trackShipment(order = {}) {
    if (!hasCredentials()) {
      return {
        success: false,
        provider: "bosta",
        provider_id: "bosta",
        message: "Bosta credentials are missing. Manual tracking is available.",
      };
    }

    return {
      success: true,
      provider: "bosta",
      provider_id: "bosta",
      shipping_status: order.shipping_status || "pending",
      tracking_number: order.tracking_number || "",
      tracking_url: order.tracking_url || "",
    };
  },
};

export default bostaProvider;
