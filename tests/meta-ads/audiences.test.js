import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";

import { e164Digits, engagementRule, hashedPhoneRows, recommendedAudiencePlan, websiteRule } from "../../server/modules/metaAds/metaAdsAudiences.js";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const sha = (value) => crypto.createHash("sha256").update(value).digest("hex");

test("every spelling of an Egyptian mobile hashes to the same E.164 number, once", () => {
  const rows = hashedPhoneRows(["01068005338", "+20 106 800 5338", "00201068005338", "1068005338", "٠١٠٦٨٠٠٥٣٣٨", "", "12345"]);
  assert.deepEqual(rows, [[sha("201068005338")]]);
  assert.equal(e164Digits("+966501234567"), "966501234567");
  assert.equal(e164Digits("abc"), "");
});

test("the pixel rules say which event, how long, and what to leave out", () => {
  const abandoners = websiteRule({ pixelId: "99", event: "AddToCart", days: 30, excludeEvent: "Purchase" });
  assert.equal(abandoners.inclusions.rules[0].event_sources[0].id, "99");
  assert.equal(abandoners.inclusions.rules[0].retention_seconds, 30 * 86400);
  assert.equal(abandoners.inclusions.rules[0].filter.filters[0].value, "AddToCart");
  assert.equal(abandoners.exclusions.rules[0].filter.filters[0].value, "Purchase");
  assert.equal(websiteRule({ pixelId: "99" }).exclusions, undefined);
  const ig = engagementRule({ sourceId: "200", sourceType: "ig_business", event: "ig_business_profile_all", days: 90 });
  assert.equal(ig.inclusions.rules[0].event_sources[0].type, "ig_business");
  assert.equal(ig.inclusions.rules[0].retention_seconds, 90 * 86400);
});

test("the plan follows what the account has, buyers first and lookalikes last", () => {
  const full = recommendedAudiencePlan({ pixel_id: "99", instagram_user_id: "200", page_id: "100" });
  assert.deepEqual(full.map((item) => item.key), [
    "buyers", "visitors_30", "visitors_90", "cart_abandoners", "site_buyers_180", "ig_engagers", "fb_engagers", "lookalike_1", "lookalike_3",
  ]);
  assert.ok(full.every((item) => item.name.startsWith("M1 — ")));
  assert.equal(full.at(-1).origin, "buyers");
  const bare = recommendedAudiencePlan({});
  assert.deepEqual(bare.map((item) => item.key), ["buyers", "lookalike_1", "lookalike_3"]);
});

// Mutation guards: the route exists behind the manage permission and the button calls it.
test("the Ads Manager exposes the build behind the manage permission", () => {
  const routes = read("../../server/modules/metaAds/manager/list/list.routes.js");
  assert.match(routes, /router\.post\("\/audiences\/build", metaAdsManage/);
  const page = read("../../src/modules/metaAds/manager/AdsManagerPage.jsx");
  assert.match(page, /managerApi\.buildAudiences\(account\.id\)/);
  assert.match(page, /\{canManage \? \(\s*<button type="button" className="ma-plain-btn" onClick=\{buildAudiences\}/);
  const builder = read("../../server/modules/metaAds/metaAdsAudiences.js");
  assert.match(builder, /customer_file_source: "USER_PROVIDED_ONLY"/);
  assert.match(builder, /schema: \["PHONE"\]/);
  assert.match(builder, /NOT IN \('cancelled', 'canceled', 'rejected', 'void', 'deleted'\)/);
});

// Graph refused `subtype` on the first production build ("not supported in the current API
// version"): a rule-based audience carries only name + rule (+ prefill for the pixel ones).
test("rule-based audiences are created without a subtype", () => {
  const builder = read("../../server/modules/metaAds/metaAdsAudiences.js");
  assert.match(builder, /const params = \{ name: item\.name, rule: item\.rule \};/);
  assert.doesNotMatch(builder, /subtype: item\.kind === "website"/);
});
