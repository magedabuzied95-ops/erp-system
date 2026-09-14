/*
 * Pure Price Drop Alert helpers, kept free of imports so node:test can load them directly.
 */

export const readPriceDropEnabled = (response = {}) => {
  const settings = response?.settings || {};
  const raw = settings["storefront.price_drop_alert.enabled"] ?? settings?.storefront?.["price_drop_alert.enabled"];
  // An older backend publishes no key: the button stays hidden rather than calling a missing route.
  return raw === true || raw === "true" || raw === 1 || raw === "1";
};

/*
 * Is this product followed? The detailed alert list is capped, so it is not the answer on its own:
 * the server also sends every followed id (`following_product_ids`). An older backend sends no ids
 * (null here), and the list is all there is.
 */
export const isPriceAlertFollowed = ({ alerts = [], followingIds = null } = {}, productId) => {
  const id = String(productId ?? "");
  if (!id) return false;
  if (Array.isArray(followingIds) && followingIds.some((followed) => String(followed) === id)) return true;
  return (Array.isArray(alerts) ? alerts : []).some((alert) => String(alert?.product_id) === id);
};

/* Followed products whose price is now below the price they were followed at, biggest drop first. */
export const droppedPriceAlerts = (alerts = []) =>
  (Array.isArray(alerts) ? alerts : [])
    .filter((alert) => alert?.dropped && alert.product && Number(alert.current_price) > 0 && Number(alert.followed_price) > Number(alert.current_price))
    .sort((a, b) => (b.followed_price - b.current_price) / b.followed_price - (a.followed_price - a.current_price) / a.followed_price);
