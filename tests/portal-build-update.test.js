import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { PORTAL_PATH_PATTERN, buildIdFromHtml, buildIdFromScriptSrc } from "../src/shared/lib/portalBuildUpdate.js";

// Installed portal apps are backgrounded, never reloaded, so a deployment did not
// reach them ("nothing appeared", 2026-09-10). The watcher compares the build in
// this page's entry script with the one in a freshly fetched /index.html.

test("the build id is the commit Vite stamps into every asset name", () => {
  assert.equal(buildIdFromScriptSrc("https://erp.m1store-egy.com/assets/app-CVUbezGw-0922e710b126.js"), "0922e710b126");
  // Vite's own hash can end in '-' — the commit is still the last segment.
  assert.equal(buildIdFromScriptSrc("/assets/App-ZFYTXdy--0922e710b126.js"), "0922e710b126");
  assert.equal(buildIdFromScriptSrc("/assets/app-x-0922e710b126.js?v=1"), "0922e710b126");
  // The dev server serves source modules with no stamp: no build, so no watcher.
  assert.equal(buildIdFromScriptSrc("/src/main.jsx"), null);
  assert.equal(buildIdFromScriptSrc(""), null);
});

test("the live build is read from the deployed index.html entry script", () => {
  const html = '<head><script type="module" crossorigin src="/assets/app-DdhqmI6v-24c845d5f34d.js"></script></head>';
  assert.deepEqual(buildIdFromHtml(html), { build: "24c845d5f34d", entry: "/assets/app-DdhqmI6v-24c845d5f34d.js" });
  assert.deepEqual(buildIdFromHtml("<html>maintenance</html>"), { build: null, entry: "" });
});

test("only portal routes are watched — never the storefront or the ERP", () => {
  for (const path of ["/manager-portal/abc", "/employee-portal/abc/online-orders", "/employee-app/abc", "/employee/portal/abc", "/manager/inventory-approvals"]) {
    assert.ok(PORTAL_PATH_PATTERN.test(path), path);
  }
  for (const path of ["/", "/products", "/orders", "/admin/ai-inbox", "/pos", "/managers"]) {
    assert.ok(!PORTAL_PATH_PATTERN.test(path), path);
  }
});

test("the watcher is mounted in both app shells", () => {
  const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  assert.equal(app.match(/<PortalUpdateWatcher \/>/g)?.length, 2, "employee-app branch and the main route tree");
});

test("an update found mid-use only raises the banner; a reload never loops on the same build", () => {
  const source = readFileSync(new URL("../src/shared/components/PortalUpdateWatcher.jsx", import.meta.url), "utf8");
  assert.match(source, /if \(allowAutoReload && readReloadedFor\(\) !== live\)/);
  assert.match(source, /if \(document\.visibilityState === "visible"\) void check\(\);/, "the periodic check must not auto-reload");
});

// 2026-09-11 "the first tap crashes, the second opens": the open-time check waited 4s, so
// the reload landed after the first tap and threw it away, with nothing on screen to say so.
test("the open-time check runs at once and the reload says it is updating", () => {
  const source = readFileSync(new URL("../src/shared/components/PortalUpdateWatcher.jsx", import.meta.url), "utf8");
  assert.match(source, /window\.setTimeout\(\(\) => void check\(\{ allowAutoReload: true \}\), 0\)/);
  assert.match(source, /if \(reloading\) \{/);
  assert.match(source, /t\("orders\.portalBoard\.update\.reloading"\)/);
  for (const language of ["ar", "en"]) {
    const orders = JSON.parse(readFileSync(new URL(`../src/locales/${language}/orders.json`, import.meta.url), "utf8"));
    assert.ok(orders.portalBoard.update.reloading, language);
  }
});

test("the manager portal prefetches the الشحن board on idle through one shared load", () => {
  const source = readFileSync(new URL("../src/modules/managerPortal/pages/ManagerPortal.jsx", import.meta.url), "utf8");
  assert.match(source, /const preloadOnlineOrdersBoard = createChunkPreloader\(\(\) => import\("\.\.\/\.\.\/\.\.\/shared\/components\/portalOnlineOrders\/PortalOnlineOrdersBoard"\)\);/);
  assert.match(source, /const PortalOnlineOrdersBoard = lazy\(\(\) => preloadOnlineOrdersBoard\(\)\);/);
  assert.match(source, /preloadOnlineOrdersBoard\(\{ quiet: true \}\)\.catch\(\(\) => \{\}\)/, "the idle prefetch never reloads the page");
});

test("board thumbnails ask for the small server variant, not the full photo", () => {
  const source = readFileSync(new URL("../src/shared/components/portalOnlineOrders/PortalOnlineOrdersBoard.jsx", import.meta.url), "utf8");
  assert.match(source, /buildStorefrontImageSrcSet\(url, THUMB_VARIANT_WIDTHS\)/);
  assert.match(source, /srcSet=\{srcSet \|\| undefined\}/);
  // a missing variant retries the original before the placeholder
  assert.match(source, /setStage\(\(current\) => \(current === 0 && srcSet \? 1 : 2\)\)/);
});
