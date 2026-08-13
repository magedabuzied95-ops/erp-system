import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

test("pos service worker excludes sensitive API routes from caching", () => {
  const swPath = path.join(process.cwd(), "public", "pos-sw.js");
  const source = fs.readFileSync(swPath, "utf8");

  assert.match(source, /startsWith\("\/api\/"\)/);
  assert.match(source, /includes\("\/orders"\)/);
  assert.match(source, /includes\("\/checkout"\)/);
  assert.match(source, /includes\("\/payments"\)/);
  assert.match(source, /includes\("\/auth"\)/);
  assert.match(source, /includes\("\/stock"\)/);
  assert.match(source, /POS_SW_NAVIGATE_FALLBACK/);
  assert.match(source, /self\.skipWaiting\(\)/);
  assert.match(source, /self\.clients\.claim\(\)/);
});

test("POS registers a root service worker that can control the exact /pos route", () => {
  const pagePath = path.join(process.cwd(), "src", "modules", "pos", "pages", "POSPro.jsx");
  const source = fs.readFileSync(pagePath, "utf8");

  assert.match(source, /POS_SERVICE_WORKER_HREF = "\/pos-sw\.js"/);
  assert.match(source, /register\(scriptUrl, \{ scope: "\/pos" \}\)/);
  assert.match(source, /POS_SERVICE_WORKER_VERSION = 11/);
  assert.match(source, /addEventListener\("controllerchange", handleControllerChange\)/);
});

// Replaces a guard that pinned the cache name to one release ("...bumped with
// the thermal receipt release"). Pinning to a release name cannot catch the
// failure that actually happened: the three version numbers drifting apart.
// The `?v=` is what makes a browser fetch the new script, and the cache name is
// what `activate` cleans up -- if they disagree, a poisoned cache survives the
// release that was supposed to evict it.
test("the registered worker version matches the cache version it ships", () => {
  const sw = fs.readFileSync(path.join(process.cwd(), "public", "pos-sw.js"), "utf8");
  const page = fs.readFileSync(
    path.join(process.cwd(), "src", "modules", "pos", "pages", "POSPro.jsx"),
    "utf8",
  );
  const html = fs.readFileSync(path.join(process.cwd(), "index.html"), "utf8");

  const cacheVersion = sw.match(/VERSION = "pos-shell-v(\d+)"/)?.[1];
  const registeredVersion = page.match(/POS_SERVICE_WORKER_VERSION = (\d+)/)?.[1];
  const htmlVersions = [...html.matchAll(/\/pos-sw\.js\?v=(\d+)/g)].map((m) => m[1]);

  assert.ok(cacheVersion, "pos-sw.js must declare a numeric cache version");
  assert.equal(registeredVersion, cacheVersion, "POSPro registers a different version than the worker caches under");
  assert.ok(htmlVersions.length > 0, "index.html should still register the POS worker");
  for (const v of htmlVersions) {
    assert.equal(v, cacheVersion, "index.html registers a different pos-sw version than the worker ships");
  }
});

test("the worker refuses to cache or serve an HTML document as a module", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "public", "pos-sw.js"), "utf8");
  // The incident: a missing chunk answered 200 text/html, `response.ok` was
  // true, and the worker stored that HTML under a .js key in a cache-first
  // namespace -- permanently, for that browser profile.
  assert.match(source, /isUsableAssetResponse/);
  assert.match(source, /text\/html/);
  assert.match(source, /POS_SW_EVICT_POISONED/);
});

test("a service-worker update never reloads the page during an open sale", () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), "src", "modules", "pos", "pages", "POSPro.jsx"),
    "utf8",
  );
  // posUtils.omitCustomerState strips the selected customer from persisted
  // state, so an automatic mid-sale reload loses it with no way to restore it.
  assert.match(source, /saleInProgressRef/);
  assert.match(source, /if \(saleInProgressRef\.current\) return;/);
  assert.match(source, /pendingSwUpdateRef/);
});
