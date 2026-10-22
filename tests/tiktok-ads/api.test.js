import test from "node:test";
import assert from "node:assert/strict";

import {
  REPORT_METRICS,
  TIKTOK_ADS_PATHS,
  TikTokAdsApiError,
  classifyTikTokAdsFailure,
  encodeQuery,
  fetchDailyReport,
  parseLosslessJson,
  topLevelScopes,
  exchangeAuthCode,
} from "../../server/modules/tiktokAds/tiktokAdsApi.js";

// Authored as a raw string on purpose: building it with JSON.stringify would round the
// ids in the test itself, which is exactly the corruption under test.
const RAW_WITH_BARE_IDS = '{"code":0,"data":{"advertiser_ids":[7697374127748923413, 7697374127748923999],"list":[{"campaign_id":1834189283112962771,"budget":50.5,"campaign_name":"id 1834189283112962771 in text"}]}}';

test("19-digit ids survive parsing even when TikTok sends them as bare numbers", () => {
  const parsed = parseLosslessJson(RAW_WITH_BARE_IDS);
  assert.deepEqual(parsed.data.advertiser_ids, ["7697374127748923413", "7697374127748923999"]);
  assert.equal(parsed.data.list[0].campaign_id, "1834189283112962771");
  assert.equal(parsed.data.list[0].budget, 50.5);
  assert.equal(parsed.data.list[0].campaign_name, "id 1834189283112962771 in text");
  // The control: plain JSON.parse really does corrupt it.
  assert.notEqual(String(JSON.parse(RAW_WITH_BARE_IDS).data.list[0].campaign_id), "1834189283112962771");
});

test("scope ids map to their first-level permission (doc 1753986142651394)", () => {
  // 100 Ad Account Information, 200 Read Campaigns, 44 Consolidated Report, 920 Get Catalog Set, 5 Measurement.
  assert.deepEqual(topLevelScopes([100, "200", 44, 920, 5]), [1, 2, 4, 5, 9]);
  // Ids outside the 1-3 digit tree (TikTok Accounts 18000000, CRM events) are not guessed at.
  assert.deepEqual(topLevelScopes([18000000, 7294180478502830081n.toString(), "abc"]), []);
  assert.deepEqual(topLevelScopes(undefined), []);
});

test("40100 is throttling on the Marketing API, never a reconnect", () => {
  assert.equal(classifyTikTokAdsFailure(40100, "Too many requests"), "rate_limit");
  assert.equal(classifyTikTokAdsFailure(40105, "Access token is incorrect"), "reauth");
  assert.equal(classifyTikTokAdsFailure(40001, "No permission"), "permission");
  assert.equal(classifyTikTokAdsFailure(40002, "The app has no permission for this scope"), "permission");
  assert.equal(classifyTikTokAdsFailure(40002, "start_date: invalid"), "api");
});

test("array and object query values go out as JSON literals", () => {
  const query = encodeQuery({ advertiser_ids: ["1"], dimensions: ["campaign_id", "stat_time_day"], page: 2, empty: "", none: null });
  const params = new URLSearchParams(query.slice(1));
  assert.equal(params.get("advertiser_ids"), '["1"]');
  assert.equal(params.get("dimensions"), '["campaign_id","stat_time_day"]');
  assert.equal(params.get("page"), "2");
  assert.equal(params.has("empty"), false);
  assert.equal(params.has("none"), false);
});

test("website purchase value is total_complete_payment_rate, not the app metric", () => {
  assert.ok(REPORT_METRICS.includes("complete_payment"));
  assert.ok(REPORT_METRICS.includes("total_complete_payment_rate"));
  assert.ok(!REPORT_METRICS.includes("total_purchase_value"));
  assert.ok(!REPORT_METRICS.includes("complete_payment_value"));
});

test("paths are the documented v1.3 advertiser endpoints", () => {
  assert.equal(TIKTOK_ADS_PATHS.TOKEN, "/oauth2/access_token/");
  assert.equal(TIKTOK_ADS_PATHS.ADVERTISERS, "/oauth2/advertiser/get/");
  assert.equal(TIKTOK_ADS_PATHS.ADVERTISER_INFO, "/advertiser/info/");
  assert.equal(TIKTOK_ADS_PATHS.REPORT, "/report/integrated/get/");
  // Never the TikTok-account (tt_user) token endpoint of the comments integration.
  assert.ok(!Object.values(TIKTOK_ADS_PATHS).some((path) => path.includes("tt_user")));
});

// ------------------------------------------------------------------ transport (stubbed fetch)

const withFetch = async (handler, fn) => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const { status = 200, body } = await handler(String(url), init, calls.length);
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  };
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = original;
  }
};

test("the daily report walks every page with one id dimension plus the day", async () => {
  await withFetch(
    (url) => {
      const page = Number(new URL(url).searchParams.get("page"));
      return {
        body: {
          code: 0,
          data: {
            list: [{ dimensions: { campaign_id: `1${page}`, stat_time_day: "2026-10-21 00:00:00" }, metrics: { spend: "1.00" } }],
            page_info: { page, total_page: 2 },
          },
        },
      };
    },
    async (calls) => {
      const rows = await fetchDailyReport({ accessToken: "tok", advertiserId: "7697374127748923413", level: "campaign", startDate: "2026-10-01", endDate: "2026-10-22" });
      assert.equal(rows.length, 2);
      assert.equal(calls.length, 2);
      const params = new URL(calls[0].url).searchParams;
      assert.equal(new URL(calls[0].url).pathname, "/open_api/v1.3/report/integrated/get/");
      assert.equal(params.get("report_type"), "BASIC");
      assert.equal(params.get("data_level"), "AUCTION_CAMPAIGN");
      assert.equal(params.get("dimensions"), '["campaign_id","stat_time_day"]');
      assert.equal(params.get("page_size"), "1000");
      assert.equal(calls[0].init.headers["Access-Token"], "tok");
    },
  );
});

test("the token exchange posts app credentials in the body and no Access-Token header", async () => {
  await withFetch(
    () => ({ body: { code: 0, data: { access_token: "x", advertiser_ids: ["7697374127748923413"], scope: [100] } } }),
    async (calls) => {
      const data = await exchangeAuthCode({ appId: "app", appSecret: "sec", authCode: "code" });
      assert.equal(data.access_token, "x");
      assert.equal(calls[0].init.method, "POST");
      assert.deepEqual(JSON.parse(calls[0].init.body), { app_id: "app", secret: "sec", auth_code: "code" });
      assert.equal(calls[0].init.headers["Access-Token"], undefined);
    },
  );
});

test("the transport itself keeps bare 19-digit advertiser ids intact", async () => {
  await withFetch(
    () => ({ body: '{"code":0,"data":{"access_token":"x","advertiser_ids":[7697374127748923413],"scope":[100]}}' }),
    async () => {
      const data = await exchangeAuthCode({ appId: "app", appSecret: "sec", authCode: "code" });
      assert.deepEqual(data.advertiser_ids, ["7697374127748923413"]);
    },
  );
});

test("a refused scope surfaces as a typed permission error, with the secret redacted", async () => {
  await withFetch(
    () => ({ body: { code: 40001, message: "No permission to operate. secret=abc123", request_id: "r1" } }),
    async () => {
      await assert.rejects(
        fetchDailyReport({ accessToken: "tok", advertiserId: "1", level: "ad", startDate: "2026-10-22", endDate: "2026-10-22" }),
        (error) => error instanceof TikTokAdsApiError && error.kind === "permission" && error.status === 403 && !error.message.includes("abc123"),
      );
    },
  );
});
