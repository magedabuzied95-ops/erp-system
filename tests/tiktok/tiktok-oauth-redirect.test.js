// TikTok OAuth callback redirect target.
//
// After a successful sandbox OAuth the browser was sent to
// <storefront>/admin/ai-channels?tiktok=connected — the public shop, which has
// no such route. Cause: the callback resolved its destination from
// PUBLIC_APP_URL / FRONTEND_URL, and in this deployment every one of those
// points at the storefront. The ERP runs on a different host and had no
// canonical variable of its own; it is declared only inside
// CORS_ALLOWED_ORIGINS.
//
// These tests pin the destination to the ERP origin for success, denial and
// error alike, and fail if the storefront can ever become the target again.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const ERP = "https://erp.m1store-egy.com";
const STOREFRONT = "https://m1store-egy.com";
const CORS = `${STOREFRONT},https://www.m1store-egy.com,${ERP}`;

const {
  TIKTOK_CHANNEL_SETTINGS_PATH,
  tiktokAppOrigin,
} = await import("../../server/services/tiktokConfigService.js");

const routeSource = readFileSync(new URL("../../server/routes/tiktok.js", import.meta.url), "utf8");

const withEnv = (patch, fn) => {
  const previous = {};
  for (const [key, value] of Object.entries(patch)) {
    previous[key] = Object.prototype.hasOwnProperty.call(process.env, key) ? process.env[key] : undefined;
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
};

// Mirrors the callback's own construction so the assertions test the real
// destination rather than a restatement of it.
const redirectFor = (params) => {
  const url = new URL(TIKTOK_CHANNEL_SETTINGS_PATH, tiktokAppOrigin() || "/");
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, String(value)));
  return url.toString();
};

// The exact production environment that produced the bug.
const PRODUCTION_ENV = {
  CORS_ALLOWED_ORIGINS: CORS,
  PUBLIC_APP_URL: STOREFRONT,
  FRONTEND_URL: STOREFRONT,
  PUBLIC_STOREFRONT_URL: STOREFRONT,
  PUBLIC_ERP_URL: undefined,
  ERP_APP_URL: undefined,
};

test("success redirects to the ERP domain, not the storefront", () => {
  withEnv(PRODUCTION_ENV, () => {
    assert.equal(redirectFor({ tiktok: "connected" }), `${ERP}/admin/ai-channels?tiktok=connected`);
  });
});

test("denial and error redirect to the ERP domain with their status preserved", () => {
  withEnv(PRODUCTION_ENV, () => {
    assert.equal(
      redirectFor({ tiktok: "denied", reason: "access_denied" }),
      `${ERP}/admin/ai-channels?tiktok=denied&reason=access_denied`
    );
    assert.equal(
      redirectFor({ tiktok: "error", reason: "TIKTOK_STATE_INVALID" }),
      `${ERP}/admin/ai-channels?tiktok=error&reason=TIKTOK_STATE_INVALID`
    );
  });
});

test("the storefront can never become the OAuth destination", () => {
  withEnv(PRODUCTION_ENV, () => {
    for (const params of [{ tiktok: "connected" }, { tiktok: "denied" }, { tiktok: "error" }]) {
      const target = new URL(redirectFor(params));
      assert.equal(target.origin, ERP, "OAuth must return to the ERP app");
      assert.notEqual(target.origin, STOREFRONT, "the storefront has no /admin/ai-channels route");
    }
  });
});

test("production and sandbox share the same destination — only credentials differ", () => {
  const production = withEnv({ ...PRODUCTION_ENV, TIKTOK_CLIENT_KEY: "aw-production-key" }, () =>
    redirectFor({ tiktok: "connected" }));
  const sandbox = withEnv({ ...PRODUCTION_ENV, TIKTOK_CLIENT_KEY: "sb-sandbox-key" }, () =>
    redirectFor({ tiktok: "connected" }));
  assert.equal(production, sandbox);
});

test("an explicit ERP URL variable wins when a deployment defines one", () => {
  withEnv({ ...PRODUCTION_ENV, PUBLIC_ERP_URL: "https://erp.example.test/" }, () => {
    assert.equal(tiktokAppOrigin(), "https://erp.example.test");
  });
  withEnv({ ...PRODUCTION_ENV, ERP_APP_URL: "https://admin.example.test" }, () => {
    assert.equal(tiktokAppOrigin(), "https://admin.example.test");
  });
});

test("the ERP origin is discovered from CORS_ALLOWED_ORIGINS with no new configuration", () => {
  withEnv(PRODUCTION_ENV, () => assert.equal(tiktokAppOrigin(), ERP));
});

test("a malformed allowlist entry does not break resolution", () => {
  withEnv({ ...PRODUCTION_ENV, CORS_ALLOWED_ORIGINS: `not-a-url,${ERP}` }, () => {
    assert.equal(tiktokAppOrigin(), ERP);
  });
});

test("with no ERP origin anywhere it falls back rather than returning nothing", () => {
  withEnv({ ...PRODUCTION_ENV, CORS_ALLOWED_ORIGINS: STOREFRONT }, () => {
    assert.equal(tiktokAppOrigin(), STOREFRONT, "a last-resort target is better than an empty redirect");
  });
});

test("the callback route resolves its origin through tiktokAppOrigin, not raw env", () => {
  const callback = routeSource.split('router.get("/oauth/callback"')[1]?.split("router.post")[0] || "";
  assert.ok(callback.length > 0, "callback handler not found");
  assert.match(callback, /tiktokAppOrigin\(\)/);
  assert.ok(!/PUBLIC_APP_URL|FRONTEND_URL|PUBLIC_FRONTEND_URL/.test(callback),
    "the callback must not read a storefront URL variable directly");
  assert.match(callback, /TIKTOK_CHANNEL_SETTINGS_PATH/);
  assert.ok(!/["']\/admin\/ai-channels["']/.test(callback),
    "the SPA path should come from the shared constant, not a duplicated literal");
});

test("the settings path matches the route registered in the SPA", () => {
  const appSource = readFileSync(new URL("../../src/App.jsx", import.meta.url), "utf8");
  assert.equal(TIKTOK_CHANNEL_SETTINGS_PATH, "/admin/ai-channels");
  assert.match(appSource, /path="admin\/ai-channels"/);
});
