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
