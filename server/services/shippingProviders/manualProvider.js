const manualProvider = {
  key: "manual",
  name: "Manual delivery",
  isConfigured: () => true,
  async createShipment(order = {}) {
    return {
      success: true,
      provider: "manual",
      shipping_status: "shipment_created",
      shipment_id: order.shipment_id || `manual-${order.id || Date.now()}`,
      tracking_number: order.tracking_number || "",
      tracking_url: order.tracking_url || "",
      message: "Manual delivery is ready. Add tracking details when available.",
    };
  },
  async trackShipment(order = {}) {
    return {
      success: true,
      provider: "manual",
      shipping_status: order.shipping_status || "shipment_created",
      tracking_number: order.tracking_number || "",
      tracking_url: order.tracking_url || "",
    };
  },
};

export default manualProvider;
