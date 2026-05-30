const inStoreDeliveryProvider = {
  key: "in_store_delivery",
  name: "In Store Delivery",
  isConfigured: () => true,
  async createShipment(order = {}) {
    return {
      success: true,
      provider: "in_store_delivery",
      provider_id: "in_store_delivery",
      shipping_status: "shipment_created",
      shipment_id: order.shipment_id || `in-store-${order.id || Date.now()}`,
      tracking_number: order.tracking_number || "",
      tracking_url: order.tracking_url || "",
      message: "In Store Delivery is ready. Add tracking details when available.",
    };
  },
  async trackShipment(order = {}) {
    return {
      success: true,
      provider: "in_store_delivery",
      provider_id: "in_store_delivery",
      shipping_status: order.shipping_status || "shipment_created",
      tracking_number: order.tracking_number || "",
      tracking_url: order.tracking_url || "",
    };
  },
};

export default inStoreDeliveryProvider;
