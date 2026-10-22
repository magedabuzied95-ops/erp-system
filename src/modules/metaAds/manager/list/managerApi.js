import { metaAdsRequest } from "../../shared/metaAdsApi";

// Endpoints of the Ads Manager list screen (/api/meta-ads/manager/*).
export const managerApi = {
  bootstrap: () => metaAdsRequest.get("/manager/bootstrap"),
  data: (params) => metaAdsRequest.get("/manager/data", params),
  setStatus: (level, id, status) => metaAdsRequest.post("/manager/status", { level, id, status }),
  duplicate: (level, id, lang) => metaAdsRequest.post("/manager/duplicate", { level, id, lang }),
  deleteDraft: (level, id) => metaAdsRequest.post("/manager/wizard/drafts/delete", { level, id }),
  series: (params) => metaAdsRequest.get("/manager/insights/series", params),
  breakdown: (params) => metaAdsRequest.get("/manager/insights/breakdown", params),
  syncInsights: (accountId, days) => metaAdsRequest.post("/manager/insights/sync", { account_id: accountId, days }),
  sync: (accountId) => metaAdsRequest.post("/manager/sync", { account_id: accountId }),
  rules: (accountId) => metaAdsRequest.get("/manager/rules", { account_id: accountId }),
  saveRule: (rule) => metaAdsRequest.post("/manager/rules/save", rule),
  deleteRule: (id) => metaAdsRequest.post("/manager/rules/delete", { id }),
  toggleRule: (id, enabled) => metaAdsRequest.post("/manager/rules/toggle", { id, enabled }),
  runRule: (id) => metaAdsRequest.post("/manager/rules/run-now", { id }),
};

// Column model per level. `key`s are the customizable columns (in display order).
// Money and funnel columns come from metaAdsFunnel.js on the server: purchases and their value
// under the account's own attribution window, the same two under 7-day click only, the funnel
// steps, and the ratios of the window's sums.
export const MONEY_COLUMNS = ["purchases", "purchase_value", "roas", "cost_per_purchase", "purchases_7d_click", "roas_7d_click"];
export const FUNNEL_COLUMNS = ["link_clicks", "landing_page_views", "add_to_cart", "initiate_checkout"];
// Meta's three rankings exist at the ad level only; frequency is impressions over reach.
export const RANKING_COLUMNS = ["quality_ranking", "engagement_rate_ranking", "conversion_rate_ranking"];

export const LEVEL_COLUMNS = {
  campaign: ["delivery", "objective", "budget", "results", "reach", "impressions", "frequency", "spend", ...MONEY_COLUMNS, ...FUNNEL_COLUMNS, "end"],
  adset: ["delivery", "goal", "budget", "results", "reach", "impressions", "frequency", "spend", ...MONEY_COLUMNS, ...FUNNEL_COLUMNS, "end"],
  ad: ["delivery", "creative", "results", "reach", "impressions", "frequency", "spend", ...MONEY_COLUMNS, ...FUNNEL_COLUMNS, ...RANKING_COLUMNS],
};

const PRESET_KEYS = {
  performance: ["delivery", "objective", "goal", "creative", "budget", "results", "reach", "impressions", "spend", "purchases", "roas", "end"],
  money: ["delivery", "spend", "purchases", "purchase_value", "roas", "cost_per_purchase", "purchases_7d_click", "roas_7d_click"],
  funnel: ["delivery", "impressions", "link_clicks", "landing_page_views", "add_to_cart", "initiate_checkout", "purchases"],
  quality: ["delivery", "reach", "impressions", "frequency", ...RANKING_COLUMNS],
  delivery: ["delivery", "objective", "goal", "creative", "budget", "end"],
  engagement: ["delivery", "results", "reach", "impressions"],
};

export const COLUMN_PRESETS = Object.fromEntries(
  Object.entries(PRESET_KEYS).map(([preset, keys]) => [preset, (level) => LEVEL_COLUMNS[level].filter((key) => keys.includes(key))]),
);

const columnsKey = (level) => `metaAds.manager.columns.${level}`;

// { preset: "performance" | "delivery" | "engagement" | "custom", visible: [...] }
export const readColumnChoice = (level) => {
  const fallback = { preset: "performance", visible: LEVEL_COLUMNS[level] };
  try {
    const raw = window.localStorage.getItem(columnsKey(level));
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    const visible = Array.isArray(parsed?.visible) ? parsed.visible.filter((key) => LEVEL_COLUMNS[level].includes(key)) : null;
    if (!visible) return fallback;
    return { preset: typeof parsed.preset === "string" ? parsed.preset : "custom", visible };
  } catch {
    return fallback;
  }
};

export const writeColumnChoice = (level, choice) => {
  try {
    window.localStorage.setItem(columnsKey(level), JSON.stringify(choice));
  } catch {
    // Storage blocked: the choice lasts for this visit only.
  }
};
