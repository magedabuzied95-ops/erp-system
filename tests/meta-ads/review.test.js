import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { adReviewUrl, rejectionSummary, reviewReasons } from "../../server/modules/metaAds/metaAdsReview.js";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

// ad_review_feedback as Graph returned it for the catalog ad Meta rejected on 2026-10-21.
const feedback = {
  global: { UNACCEPTABLE_BUSINESS_PRACTICES: "يبدو أن إعلانك يحتوي على رابط خادع." },
  placement_specific: {
    facebook: { UNACCEPTABLE_BUSINESS_PRACTICES: "يبدو أن إعلانك يحتوي على رابط خادع." },
    instagram: { ADULT_CONTENT: "العُري والنشاط الجنسي للبالغين" },
  },
};

test("the verdict reads as one sentence, with every distinct policy behind it", () => {
  const summary = rejectionSummary({ effective_status: "DISAPPROVED", review_feedback: feedback, issues: [] });
  assert.equal(summary.status, "DISAPPROVED");
  assert.equal(summary.headline, "يبدو أن إعلانك يحتوي على رابط خادع.");
  assert.deepEqual(summary.reasons.map((reason) => reason.policy), ["UNACCEPTABLE_BUSINESS_PRACTICES", "ADULT_CONTENT"]);
  assert.equal(summary.reasons[0].policy_label, "Unacceptable Business Practices");
  assert.equal(summary.reasons[1].placement, "instagram");
});

test("issues_info alone still explains a WITH_ISSUES ad", () => {
  const summary = rejectionSummary({
    effective_status: "WITH_ISSUES",
    review_feedback: null,
    issues: [{ level: "AD", error_code: 1815869, error_summary: "Ad set has no pixel", error_message: "The ad set's conversion event needs a pixel." }],
  });
  assert.equal(summary.headline, "Ad set has no pixel");
  assert.equal(summary.issues[0].code, "1815869");
});

test("a clean ad carries nothing", () => {
  assert.equal(rejectionSummary({ effective_status: "ACTIVE", review_feedback: null, issues: [] }), null);
  assert.deepEqual(reviewReasons(undefined), []);
  assert.deepEqual(reviewReasons({ global: {} }), []);
});

test("the review link opens the ad's Ads Manager panel without the act_ prefix", () => {
  assert.equal(
    adReviewUrl("act_3019158711657715", "120249891032720549"),
    "https://adsmanager.facebook.com/adsmanager/manage/ads/edit?act=3019158711657715&selected_ad_ids=120249891032720549",
  );
  assert.equal(adReviewUrl("", "1"), "");
});

// Mutation guards: the sync must ask for the two fields and store them; the list must hand the
// row its summary and strip the raw feedback.
test("the sync asks Meta for the verdict and the list summarises it", () => {
  const core = read("../../server/modules/metaAds/metaAdsCore.js");
  assert.match(core, /const AD_FIELDS = "[^"]*ad_review_feedback,issues_info[^"]*"/);
  assert.match(core, /review_feedback = EXCLUDED\.review_feedback/);
  assert.match(core, /issues = EXCLUDED\.issues/);
  const data = read("../../server/modules/metaAds/manager/list/managerData.js");
  assert.match(data, /row\.rejection = rejectionSummary\(row\)/);
  assert.match(data, /delete row\.review_feedback/);
  const schema = read("../../server/modules/metaAds/metaAdsSchema.js");
  assert.match(schema, /ALTER TABLE meta_ads_ads ADD COLUMN IF NOT EXISTS review_feedback JSONB NULL/);
});
