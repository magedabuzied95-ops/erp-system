import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { FUNNEL_COLUMNS, INSIGHT_ATTRIBUTION_WINDOWS, funnelFromInsightRow, funnelRatios } from "../../server/modules/metaAds/metaAdsFunnel.js";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

// A row the way Graph returns it with action_attribution_windows=["default","7d_click"]: every
// entry carries `value` (the account's window) and `7d_click`.
const row = {
  spend: "811.10",
  actions: [
    { action_type: "link_click", value: "1901", "7d_click": "1901" },
    { action_type: "landing_page_view", value: "1801", "7d_click": "1790" },
    { action_type: "omni_add_to_cart", value: "204", "7d_click": "200" },
    { action_type: "add_to_cart", value: "204", "7d_click": "200" },
    { action_type: "initiate_checkout", value: "156", "7d_click": "150" },
    { action_type: "offsite_conversion.fb_pixel_purchase", value: "15", "7d_click": "14" },
    { action_type: "purchase", value: "15", "7d_click": "14" },
  ],
  action_values: [
    { action_type: "purchase", value: "15776.00", "7d_click": "14900.00" },
  ],
};

test("the money and funnel numbers come out of actions and action_values", () => {
  assert.deepEqual(funnelFromInsightRow(row), {
    purchases: 15,
    purchase_value: 15776,
    purchases_7d_click: 14,
    purchase_value_7d_click: 14900,
    landing_page_views: 1801,
    add_to_cart: 204,
    initiate_checkout: 156,
    link_clicks: 1901,
  });
});

test("an account that only has the raw pixel events still reports purchases", () => {
  const pixelOnly = {
    actions: [{ action_type: "offsite_conversion.fb_pixel_purchase", value: "3" }],
    action_values: [{ action_type: "offsite_conversion.fb_pixel_purchase", value: "4200" }],
  };
  const funnel = funnelFromInsightRow(pixelOnly);
  assert.equal(funnel.purchases, 3);
  assert.equal(funnel.purchase_value, 4200);
  // No 7d_click key: Meta omits the window that equals the account's own, so it is `value`.
  assert.equal(funnel.purchases_7d_click, 3);
  assert.equal(funnel.purchase_value_7d_click, 4200);
});

test("a row without actions is all zeros, never NaN", () => {
  const funnel = funnelFromInsightRow({});
  for (const key of FUNNEL_COLUMNS) assert.equal(funnel[key], 0, key);
  assert.deepEqual(funnelRatios({ spend: 0 }), { roas: null, cost_per_purchase: null, roas_7d_click: null, cost_per_purchase_7d_click: null });
});

test("ratios divide the sums", () => {
  const ratios = funnelRatios({ spend: 811.1, purchases: 15, purchase_value: 15776, purchases_7d_click: 14, purchase_value_7d_click: 14900 });
  assert.ok(Math.abs(ratios.roas - 19.45) < 0.01);
  assert.ok(Math.abs(ratios.cost_per_purchase - 54.07) < 0.01);
  assert.ok(Math.abs(ratios.roas_7d_click - 18.37) < 0.01);
});

// Mutation guards: the sync must ask Graph for action_values and both windows, and must write
// every funnel column; the list must sum every one of them.
test("the insights sync requests and stores the funnel", () => {
  const core = read("../../server/modules/metaAds/metaAdsCore.js");
  assert.match(core, /const INSIGHT_FIELDS = "[^"]*actions,action_values[^"]*"/);
  assert.match(core, /action_attribution_windows: INSIGHT_ATTRIBUTION_WINDOWS/);
  assert.deepEqual([...INSIGHT_ATTRIBUTION_WINDOWS], ["default", "7d_click"]);
  for (const column of FUNNEL_COLUMNS) {
    assert.match(core, new RegExp(`${column} = EXCLUDED\\.${column}`), `sync upserts ${column}`);
  }
  const data = read("../../server/modules/metaAds/manager/list/managerData.js");
  for (const column of FUNNEL_COLUMNS) {
    assert.match(data, new RegExp(`SUM\\(i\\.${column}\\) AS ${column}`), `list sums ${column}`);
  }
  assert.match(data, /CASE WHEN ins\.spend > 0 THEN ins\.purchase_value \/ ins\.spend END AS roas/);
  assert.match(data, /erpOnlineOrders\(tenantId, accountId, days\)/);
  const schema = read("../../server/modules/metaAds/metaAdsSchema.js");
  for (const column of FUNNEL_COLUMNS) {
    assert.match(schema, new RegExp(`ALTER TABLE meta_ads_insights ADD COLUMN IF NOT EXISTS ${column} `), `schema adds ${column}`);
  }
});
