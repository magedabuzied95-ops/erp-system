import test from "node:test";
import assert from "node:assert/strict";

// The publisher imports the wizard model through a relative path that also resolves under Node.
import { adsetParams, usesAdvantageAudience } from "../../server/modules/metaAds/manager/wizard/metaAdsPublisher.js";

const campaign = { meta_id: "1", campaign_budget_optimization: true, bid_strategy: "LOWEST_COST_WITHOUT_CAP" };
const account = { currency: "EGP", page_name: "M1 Store" };
const targeting = (advantage) => ({
  geo_locations: { countries: ["EG"] },
  custom_audiences: [{ id: "120250933290690549" }],
  targeting_automation: { advantage_audience: advantage ? 1 : 0 },
});

// Re-publishing the shop's expansion ad set (Advantage+ audience) failed with "لا يمكن تعطيل
// خيارات Advantage" because the update resent its targeting.
test("an Advantage+ audience ad set is updated without its targeting", () => {
  const row = { name: "توسّع", targeting: targeting(true), optimization_goal: "OFFSITE_CONVERSIONS" };
  assert.equal(usesAdvantageAudience(row), true);
  const update = adsetParams(row, { campaign, account, currency: "EGP", forCreate: false });
  assert.equal(update.targeting, undefined);
  assert.equal(update.name, "توسّع");
});

test("it is still created with its targeting, and a manual-audience ad set keeps sending it", () => {
  const advantage = { name: "توسّع", targeting: targeting(true), optimization_goal: "OFFSITE_CONVERSIONS" };
  assert.deepEqual(adsetParams(advantage, { campaign, account, currency: "EGP", forCreate: true }).targeting, targeting(true));
  const manual = { name: "ريتارجتنج", targeting: targeting(false), optimization_goal: "OFFSITE_CONVERSIONS" };
  assert.equal(usesAdvantageAudience(manual), false);
  assert.deepEqual(adsetParams(manual, { campaign, account, currency: "EGP", forCreate: false }).targeting, targeting(false));
});

test("a row synced from Meta is read from its raw targeting", () => {
  assert.equal(usesAdvantageAudience({ raw: { targeting: { targeting_automation: { advantage_audience: 1 } } } }), true);
  assert.equal(usesAdvantageAudience({}), false);
});
