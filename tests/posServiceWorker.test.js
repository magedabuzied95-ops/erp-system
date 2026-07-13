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
  assert.match(source, /POS_SERVICE_WORKER_VERSION = 6/);
  assert.match(source, /addEventListener\("controllerchange", handleControllerChange\)/);
});

test("POS service worker cache version is bumped with the thermal receipt release", () => {
  const swPath = path.join(process.cwd(), "public", "pos-sw.js");
  const source = fs.readFileSync(swPath, "utf8");
  assert.match(source, /VERSION = "pos-shell-v6"/);
});
