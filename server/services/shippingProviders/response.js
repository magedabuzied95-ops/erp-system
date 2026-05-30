import { normalizeShippingLifecycleStatus } from "../../../shared/orderStatus.js";

export const normalizeProviderResponse = (response = {}, fallback = {}) => {
  const provider = response.provider || fallback.provider || fallback.provider_id || "in_store_delivery";
  const status = normalizeShippingLifecycleStatus(response.status || response.shipping_status || fallback.status || "pending", "pending");
  return {
    success: Boolean(response.success),
    provider,
    provider_id: response.provider_id || response.shipping_provider_id || fallback.provider_id || provider,
    shipment_id: response.shipment_id || fallback.shipment_id || null,
    tracking_number: response.tracking_number || fallback.tracking_number || null,
    tracking_url: response.tracking_url || fallback.tracking_url || null,
    status,
    shipping_status: status,
    raw_response: response.raw_response || null,
    error: response.error || response.message || null,
    message: response.message || response.error || "",
  };
};
