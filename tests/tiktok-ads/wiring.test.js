import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

// Source guards: the frontend imports Vite paths, so these read sources rather than import them.
const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const MODULE = "../../server/modules/tiktokAds/";
const serverSources = readdirSync(new URL(MODULE, import.meta.url)).filter((name) => name.endsWith(".js")).map((name) => [name, read(`${MODULE}${name}`)]);

test("the advertiser token is a tkb:v1 envelope and never touches the publishing app's crypto", () => {
  const core = read(`${MODULE}tiktokAdsCore.js`);
  assert.match(core, /encryptTikTokBusinessSecret\(accessToken\)/);
  assert.match(core, /decryptTikTokBusinessSecret\(encrypted\)/);
  for (const [name, source] of serverSources) {
    const code = source.replace(/^\s*\/\/.*$/gm, "");
    assert.doesNotMatch(code,/tiktokCryptoService|decryptTikTokSecret|encryptTikTokSecret|open\.tiktokapis\.com|client_key/, `${name} must not use the publishing app`);
  }
});

test("no read path selects the token column", () => {
  const read_ = read(`${MODULE}tiktokAdsRead.js`);
  assert.doesNotMatch(read_, /access_token_encrypted/);
  const core = read(`${MODULE}tiktokAdsCore.js`);
  const publicColumns = core.match(/const ACCOUNT_PUBLIC_COLUMNS = `([\s\S]*?)`;/)[1];
  assert.doesNotMatch(publicColumns.replace(/\(access_token_encrypted IS NOT NULL[^)]*\)/, ""), /access_token_encrypted/);
});

test("every TikTok Ads route is behind protect + tiktok_ads permission", () => {
  const routes = read(`${MODULE}tiktokAds.routes.js`);
  const declared = [...routes.matchAll(/router\.(get|post|put|patch|delete)\(\s*"([^"]+)",\s*([^,]+),/g)];
  assert.ok(declared.length >= 6);
  for (const [, method, path, guard] of declared) {
    assert.match(guard, /^\.\.\.(view|manage)$/, `${method.toUpperCase()} ${path} is unguarded`);
  }
  assert.match(routes, /const view = \[protect, permit\("tiktok_ads", "view"\)\]/);
  assert.match(routes, /const manage = \[protect, permit\("tiktok_ads", "manage"\)\]/);
  for (const path of ["/oauth/start", "/accounts/:id/sync", "/accounts/:id/disconnect"]) {
    assert.match(routes, new RegExp(`router\\.post\\("${path.replace(/[/:]/g, (c) => `\\${c}`)}", \\.\\.\\.manage,`));
  }
});

test("the shared TikTok Business callback hands advertiser logins over before its own flow", () => {
  const business = read("../../server/routes/tiktokBusiness.js");
  const handler = business.slice(business.indexOf("const oauthCallbackHandler"));
  const dispatch = handler.indexOf("if (isTikTokAdsState(req.query?.state)) return tiktokAdsOAuthCallback(req, res);");
  assert.ok(dispatch > 0, "dispatch missing");
  assert.ok(dispatch < handler.indexOf("handleTikTokBusinessOAuthCallback"), "dispatch must run before the tt_user exchange");
  // The callback reads auth_code first (the doc's redirect carries both code and auth_code).
  assert.match(read(`${MODULE}tiktokAds.routes.js`), /authCode: req\.query\?\.auth_code \|\| req\.query\?\.code/);
});

test("the OAuth state is single-use and expires", () => {
  const core = read(`${MODULE}tiktokAdsCore.js`);
  assert.match(core, /UPDATE tiktok_ads_oauth_states SET used_at = NOW\(\)\s+WHERE state = \$1 AND used_at IS NULL AND created_at > NOW\(\)/);
});

test("a missing permission is recorded as a state, not thrown as a failure", () => {
  const core = read(`${MODULE}tiktokAdsCore.js`);
  assert.equal((core.match(/markState\(ctx\.id, "(structure|report)_state", "missing_permission"/g) || []).length, 4);
});

test("server, permissions and navigation know the module", () => {
  const server = read("../../server/server.js");
  assert.match(server, /app\.use\("\/api\/tiktok-ads", tiktokAdsRoutes\)/);
  assert.match(server, /await ensureTikTokAdsSchema\(db\)/);
  assert.match(server, /startTikTokAdsScheduler\(/);
  const middleware = read("../../server/middleware/permissionMiddleware.js");
  assert.match(middleware, /\["tiktok_ads", "view"\],\s*\n\s*\["tiktok_ads", "manage"\]/);
  const rbac = read("../../src/modules/permissions/lib/rbacStore.js");
  assert.match(rbac, /tiktok_ads: \["view", "manage"\]/);
  assert.match(rbac, /to: "\/tiktok-ads", permission: "tiktok_ads\.view"/);
  const app = read("../../src/App.jsx");
  assert.match(app, /path="tiktok-ads\/\*"[\s\S]{0,120}requiredPermissions=\{\["tiktok_ads\.view"\]\}/);
});

test("every translation key the screens use exists in Arabic and English", () => {
  const en = JSON.parse(read("../../src/locales/en/tiktokAds.json"));
  const ar = JSON.parse(read("../../src/locales/ar/tiktokAds.json"));
  const lookup = (tree, key) => key.split(".").reduce((node, part) => (node && typeof node === "object" ? node[part] : undefined), tree);
  const files = ["TikTokAdsModule.jsx", "AdsPage.jsx", "ConnectPage.jsx"].map((name) => read(`../../src/modules/tiktokAds/${name}`));
  const keys = new Set();
  for (const source of files) {
    assert.doesNotMatch(source, /t\("tiktokAds:/, "single namespace: use tiktokAds.key, never tiktokAds:key");
    for (const [, key] of source.matchAll(/t\("tiktokAds\.([a-zA-Z0-9_.]+)"/g)) keys.add(key);
  }
  // Template keys used with a known set of values.
  for (const level of ["campaign", "adgroup", "ad"]) keys.add(`levels.${level}`);
  for (const preset of ["1", "7", "14", "30", "90", "all"]) keys.add(`ads.presets.${preset}`);
  for (const delivery of ["active", "paused", "inReview", "rejected", "unknown"]) keys.add(`delivery.${delivery}`);
  assert.ok(keys.size > 40);
  for (const key of keys) {
    assert.equal(typeof lookup(en, key), "string", `en missing ${key}`);
    assert.equal(typeof lookup(ar, key), "string", `ar missing ${key}`);
  }
  const manifest = read("../../src/i18n/localeManifest.js");
  assert.match(manifest, /\{ branch: "tiktokAds", file: "tiktokAds" \}/);
  assert.match(read("../../src/i18n/bundles/rest.ar.js"), /"tiktokAds": tiktokAds/);
});

test("the list screen shows review verdicts before on/off", async () => {
  const source = read("../../src/modules/tiktokAds/AdsPage.jsx");
  assert.match(source, /AUDIT_DENY\|ALL_REJECTED/);
  assert.ok(source.indexOf('"rejected"') < source.indexOf('"active"'));
});
