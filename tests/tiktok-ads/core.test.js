import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAuthorizeUrl,
  capabilitiesOf,
  dateChunks,
  insightFromReportRow,
  isTikTokAdsState,
  localDate,
  tiktokAdsRedirectUri,
  tiktokTime,
} from "../../server/modules/tiktokAds/tiktokAdsCore.js";
import { parseDays, parseLevel, withRatios } from "../../server/modules/tiktokAds/tiktokAdsRead.js";

test("a 90-day pull is split into closed ranges of at most 30 days with no gap or overlap", () => {
  const chunks = dateChunks("2026-10-22", 90);
  assert.deepEqual(chunks, [
    { start: "2026-09-23", end: "2026-10-22" },
    { start: "2026-08-24", end: "2026-09-22" },
    { start: "2026-07-25", end: "2026-08-23" },
  ]);
  assert.deepEqual(dateChunks("2026-10-22", 3), [{ start: "2026-10-20", end: "2026-10-22" }]);
  assert.deepEqual(dateChunks("2026-03-01", 1), [{ start: "2026-03-01", end: "2026-03-01" }]);
});

test("report days follow the advertiser's own calendar", () => {
  const lateUtc = new Date("2026-10-22T22:30:00Z"); // already the 23rd in Cairo
  assert.equal(localDate("Africa/Cairo", lateUtc), "2026-10-23");
  assert.equal(localDate("Etc/GMT", lateUtc), "2026-10-22");
  assert.equal(localDate("Not/AZone", lateUtc), "2026-10-23"); // falls back to Cairo
});

test("TikTok's space-separated times are UTC", () => {
  assert.equal(tiktokTime("2026-10-22 10:00:00").toISOString(), "2026-10-22T10:00:00.000Z");
  assert.equal(tiktokTime(""), null);
  assert.equal(tiktokTime("garbage"), null);
});

test("string metrics become numbers in the right columns", () => {
  const row = insightFromReportRow({
    dimensions: { campaign_id: "1", stat_time_day: "2026-10-21 00:00:00" },
    metrics: { spend: "12.34", impressions: "1000", clicks: "25", conversion: "3", complete_payment: "2", total_complete_payment_rate: "1500.00", web_event_add_to_cart: "7", initiate_checkout: "4", reach: "800" },
  });
  assert.deepEqual(row, { spend: 12.34, impressions: 1000, clicks: 25, reach: 800, conversions: 3, purchases: 2, purchase_value: 1500, add_to_cart: 7, initiate_checkout: 4 });
  assert.equal(insightFromReportRow({ metrics: { spend: "-" } }).spend, 0);
});

test("capabilities come from the granted scopes; an empty list assumes nothing is missing", () => {
  const today = capabilitiesOf([100, 5, 18000000]); // what the app holds before the new review
  assert.equal(today.ads_management, false);
  assert.equal(today.reporting, false);
  assert.deepEqual(today.granted, ["Ad Account Management", "Measurement"]);
  const approved = capabilitiesOf([100, 200, 201, 44]);
  assert.equal(approved.ads_management, true);
  assert.equal(approved.reporting, true);
  const unknown = capabilitiesOf([]);
  assert.equal(unknown.ads_management, true);
  assert.equal(unknown.reporting, true);
});

test("the authorize URL rides the app's one registered advertiser redirect", () => {
  const saved = { ...process.env };
  try {
    delete process.env.TIKTOK_ADS_AUTHORIZE_URL;
    delete process.env.TIKTOK_ADS_REDIRECT_URI;
    process.env.TIKTOK_BUSINESS_APP_ID = "7678378836345487380";
    const url = new URL(buildAuthorizeUrl("tta_abc"));
    assert.equal(url.origin + url.pathname, "https://business-api.tiktok.com/portal/auth");
    assert.equal(url.searchParams.get("app_id"), "7678378836345487380");
    assert.equal(url.searchParams.get("state"), "tta_abc");
    assert.match(url.searchParams.get("redirect_uri"), /\/api\/tiktok-business\/oauth\/callback$/);
    assert.equal(url.searchParams.get("redirect_uri"), tiktokAdsRedirectUri());

    // A URL copied from the portal is used as is; only its state placeholder is replaced.
    process.env.TIKTOK_ADS_AUTHORIZE_URL = "https://business-api.tiktok.com/portal/auth?app_id=1&state=your_custom_params&redirect_uri=https%3A%2F%2Fx.test%2Fcb";
    const copied = new URL(buildAuthorizeUrl("tta_xyz"));
    assert.equal(copied.searchParams.get("state"), "tta_xyz");
    assert.equal(copied.searchParams.get("redirect_uri"), "https://x.test/cb");
    assert.equal(copied.searchParams.get("app_id"), "1");
  } finally {
    process.env = saved;
  }
});

test("only TikTok Ads states are claimed from the shared callback", () => {
  assert.equal(isTikTokAdsState("tta_0123"), true);
  assert.equal(isTikTokAdsState("0123abcd"), false);
  assert.equal(isTikTokAdsState(undefined), false);
});

test("ratios come from the window's sums", () => {
  const row = withRatios({ spend: "100", impressions: "20000", clicks: "200", purchases: "4", purchase_value: "2400" });
  assert.equal(row.ctr, 1);
  assert.equal(row.cpc, 0.5);
  assert.equal(row.cpm, 5);
  assert.equal(row.roas, 24);
  assert.equal(row.cost_per_purchase, 25);
  const empty = withRatios({ spend: 0, impressions: 0, clicks: 0, purchases: 0, purchase_value: 0 });
  assert.equal(empty.ctr, null);
  assert.equal(empty.roas, null);
});

test("list parameters accept only known values", () => {
  assert.equal(parseLevel("adgroup"), "adgroup");
  assert.throws(() => parseLevel("adset"));
  assert.equal(parseDays("30"), 30);
  assert.equal(parseDays("all"), 0);
  assert.equal(parseDays("45"), 0);
});
