// The money and funnel numbers of one insights row, read out of Meta's `actions` and
// `action_values` lists. Pure: no database, no network, so the picker is unit-tested.
//
// Meta names the same event three ways depending on the account's event setup
// (`purchase` once the omni events are on, `omni_purchase`, or the raw pixel event), so each
// metric lists every spelling and the first one present wins. With
// `action_attribution_windows=["default","7d_click"]` every entry also carries a `7d_click`
// value next to `value` (the account's own window); the two purchase numbers keep both so the
// screen can show Meta's figure and the click-only figure side by side.

const FUNNEL_ACTIONS = Object.freeze({
  purchases: ["purchase", "omni_purchase", "offsite_conversion.fb_pixel_purchase", "onsite_web_purchase"],
  landing_page_views: ["landing_page_view"],
  add_to_cart: ["add_to_cart", "omni_add_to_cart", "offsite_conversion.fb_pixel_add_to_cart"],
  initiate_checkout: ["initiate_checkout", "omni_initiated_checkout", "offsite_conversion.fb_pixel_initiate_checkout"],
  link_clicks: ["link_click"],
});

export const INSIGHT_ATTRIBUTION_WINDOWS = Object.freeze(["default", "7d_click"]);

const number = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const firstEntry = (list, types) => {
  const entries = Array.isArray(list) ? list : [];
  for (const type of types) {
    const hit = entries.find((entry) => entry && entry.action_type === type);
    if (hit) return hit;
  }
  return null;
};

const defaultValue = (entry) => (entry ? number(entry.value) : 0);
// Meta omits the window key when the account's own window IS that window, so a missing
// `7d_click` on an entry that exists falls back to `value` rather than to zero.
const clickValue = (entry) => (entry ? (entry["7d_click"] === undefined ? number(entry.value) : number(entry["7d_click"])) : 0);

export const funnelFromInsightRow = (row = {}) => {
  const actions = row.actions;
  const values = row.action_values;
  const purchase = firstEntry(actions, FUNNEL_ACTIONS.purchases);
  const purchaseValue = firstEntry(values, FUNNEL_ACTIONS.purchases);
  return {
    purchases: defaultValue(purchase),
    purchase_value: defaultValue(purchaseValue),
    purchases_7d_click: clickValue(purchase),
    purchase_value_7d_click: clickValue(purchaseValue),
    landing_page_views: defaultValue(firstEntry(actions, FUNNEL_ACTIONS.landing_page_views)),
    add_to_cart: defaultValue(firstEntry(actions, FUNNEL_ACTIONS.add_to_cart)),
    initiate_checkout: defaultValue(firstEntry(actions, FUNNEL_ACTIONS.initiate_checkout)),
    link_clicks: defaultValue(firstEntry(actions, FUNNEL_ACTIONS.link_clicks)),
  };
};

// Ratios the table shows; computed from totals so a window of several days divides sums, not
// averages of ratios.
export const funnelRatios = ({ spend = 0, purchases = 0, purchase_value = 0, purchases_7d_click = 0, purchase_value_7d_click = 0 } = {}) => {
  const money = number(spend);
  return {
    roas: money > 0 ? number(purchase_value) / money : null,
    cost_per_purchase: number(purchases) > 0 ? money / number(purchases) : null,
    roas_7d_click: money > 0 ? number(purchase_value_7d_click) / money : null,
    cost_per_purchase_7d_click: number(purchases_7d_click) > 0 ? money / number(purchases_7d_click) : null,
  };
};

export const FUNNEL_COLUMNS = Object.freeze([
  "purchases", "purchase_value", "purchases_7d_click", "purchase_value_7d_click",
  "landing_page_views", "add_to_cart", "initiate_checkout", "link_clicks",
]);
