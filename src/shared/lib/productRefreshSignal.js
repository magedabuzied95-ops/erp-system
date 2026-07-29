export const PRODUCT_REFRESH_EVENT = "products:refetch";
export const PRODUCT_REFRESH_STORAGE_KEY = "erp.products.refetch";
export const PRODUCT_REFRESH_CHANNEL = "erp-products-refetch";

export const notifyProductRefresh = (source = "product-update", detail = {}) => {
  if (typeof window === "undefined") return null;
  const payload = {
    source: String(source || "product-update"),
    productId: detail?.productId ?? detail?.product_id ?? null,
    variantId: detail?.variantId ?? detail?.variant_id ?? null,
    timestamp: Date.now(),
  };

  window.dispatchEvent(new CustomEvent(PRODUCT_REFRESH_EVENT, { detail: payload }));

  try {
    window.localStorage.setItem(PRODUCT_REFRESH_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // The same-tab event still works when persistent storage is unavailable.
  }

  if (typeof BroadcastChannel !== "undefined") {
    const channel = new BroadcastChannel(PRODUCT_REFRESH_CHANNEL);
    channel.postMessage(payload);
    channel.close();
  }

  return payload;
};
