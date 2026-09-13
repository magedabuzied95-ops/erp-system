import { useCallback, useEffect, useState } from "react";
import { getPublicSettingsResponse } from "../../shared/api/publicSettings";
import { readStorefrontCustomerAuth, storefrontCustomerRequest } from "./storefrontCustomerAuth";
import { readPriceDropEnabled } from "./priceDropAlertsModel.js";

export { droppedPriceAlerts, readPriceDropEnabled } from "./priceDropAlertsModel.js";

/*
 * Price Drop Alert on the storefront: which products this customer follows, and the two actions.
 *
 * One list for the whole tab. The product page button and the wishlist panel read the same
 * follows, and a wishlist toggle follows on the server too, so every change announces itself with
 * PRICE_ALERTS_CHANGED_EVENT and every mounted reader refetches.
 */

export const PRICE_ALERTS_CHANGED_EVENT = "storefront-price-alerts-changed";
const AUTH_CHANGED_EVENT = "storefront-customer-auth-changed";

export const announcePriceAlertsChanged = () => {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(PRICE_ALERTS_CHANGED_EVENT));
};

export const usePriceDropAlerts = () => {
  const [enabled, setEnabled] = useState(false);
  const [alerts, setAlerts] = useState([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getPublicSettingsResponse()
      .then((data) => { if (!cancelled) setEnabled(readPriceDropEnabled(data)); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const refresh = useCallback(async () => {
    const { token } = readStorefrontCustomerAuth();
    if (!token) {
      setAlerts([]);
      setLoaded(true);
      return;
    }
    try {
      const res = await storefrontCustomerRequest("/storefront/price-alerts", { method: "GET" });
      setAlerts(Array.isArray(res?.alerts) ? res.alerts : []);
    } catch {
      // A failed read leaves the last known follows; the button still works.
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    refresh();
    window.addEventListener(PRICE_ALERTS_CHANGED_EVENT, refresh);
    window.addEventListener(AUTH_CHANGED_EVENT, refresh);
    return () => {
      window.removeEventListener(PRICE_ALERTS_CHANGED_EVENT, refresh);
      window.removeEventListener(AUTH_CHANGED_EVENT, refresh);
    };
  }, [enabled, refresh]);

  const isFollowing = useCallback(
    (productId) => alerts.some((alert) => String(alert.product_id) === String(productId)),
    [alerts]
  );

  /* Resolves to "following" | "stopped" | "login". Throws on any other failure. */
  const setFollowing = useCallback(async (productId, following) => {
    const { token } = readStorefrontCustomerAuth();
    if (!token) return "login";
    try {
      if (following) {
        await storefrontCustomerRequest("/storefront/price-alerts", { method: "POST", body: { product_id: productId } });
      } else {
        await storefrontCustomerRequest(`/storefront/price-alerts/${encodeURIComponent(productId)}`, { method: "DELETE" });
      }
    } catch (error) {
      const status = Number(error?.status || error?.response?.status || 0);
      if (status === 401 || status === 403) return "login";
      throw error;
    }
    announcePriceAlertsChanged();
    return following ? "following" : "stopped";
  }, []);

  return { enabled, loaded, alerts, isFollowing, setFollowing, refresh };
};
