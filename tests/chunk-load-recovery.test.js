import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { isChunkLoadError } from "../src/shared/utils/chunkLoadRecovery.js";

const recoverySource = await readFile(new URL("../src/shared/utils/chunkLoadRecovery.js", import.meta.url), "utf8");
const mainSource = await readFile(new URL("../src/main.jsx", import.meta.url), "utf8");

test("chunk recovery only classifies dynamic import failures", () => {
  assert.equal(isChunkLoadError(new Error("Failed to fetch dynamically imported module")), true);
  assert.equal(isChunkLoadError(new Error("Loading chunk 123 failed")), true);
  assert.equal(isChunkLoadError(new Error("Request failed with status 500")), false);
  assert.equal(isChunkLoadError(new Error("Cannot read properties of undefined")), false);
});

test("module MIME and script element failures trigger stale-build recovery", () => {
  assert.match(recoverySource, /failed to load module script/);
  assert.match(recoverySource, /expected a javascript-or-wasm module script/);
  assert.match(recoverySource, /error\.target\?\.src/);
  assert.match(recoverySource, /error\?\.target\?\.tagName === "SCRIPT"/);
});

test("the application entry import has an explicit recovery path", () => {
  assert.match(mainSource, /import\("\.\/App\.jsx"\)[\s\S]*\.catch\(\(error\) => \{[\s\S]*recoverFromChunkLoadError\(error\)/);
});

test("automatic chunk recovery stays quiet before exposing a manual reload", async () => {
  const boundary = await readFile(new URL("../src/shared/components/DebugErrorBoundary.jsx", import.meta.url), "utf8");
  assert.match(boundary, /showChunkAction: false/);
  assert.match(boundary, /<ChunkReloadFallback showAction=\{hasChunkReloadAttempted\(\) && this\.state\.showChunkAction\}/);
  assert.match(boundary, /\}, 8_000\)/);
  assert.match(recoverySource, /const healthyBootTimer = window\.setTimeout/);
  assert.match(recoverySource, /clearChunkReloadAttempt\(\)/);
  assert.match(recoverySource, /\}, 10_000\)/);
});

test("deployment cache policy keeps the application shell fresh and hashed assets immutable", async () => {
  const config = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));
  const indexRule = config.headers.find((rule) => rule.source === "/index.html");
  const assetRule = config.headers.find((rule) => rule.source === "/assets/(.*)");
  assert.equal(indexRule.headers[0].value, "no-store, no-cache, must-revalidate, max-age=0");
  assert.equal(assetRule.headers[0].value, "public, max-age=31536000, immutable");
});

test("boot recovery never hands the tab to a half-propagated deployment", async () => {
  const indexSource = await readFile(new URL("../index.html", import.meta.url), "utf8");
  // Reloading while the new build is still propagating is what turned one blank
  // flash into a page that never came back, because the 5-minute guard then
  // blocked every further attempt.
  assert.match(indexSource, /function freshBuildReady\(\)/);
  assert.match(indexSource, /fetch\("\/index\.html", \{ cache: "no-store"/);
  // A 200 proves nothing while the SPA rewrite can answer with HTML.
  assert.match(indexSource, /type\.indexOf\("javascript"\) !== -1/);
  assert.match(indexSource, /if \(ready\) return finish\(\);/);
  // The probe must never be able to strand the tab in place of reloading it.
  assert.match(indexSource, /setTimeout\(finish, 12000\)/);
});

test("a stranded boot shows a reload control instead of a blank page", async () => {
  const indexSource = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(indexSource, /function paintOverlay\(message, actionLabel, onAction\)/);
  // Recovery in progress is announced rather than shown as a black screen.
  assert.match(indexSource, /paintOverlay\("جارٍ تحديث نسخة النظام…"/);
  // Nothing mounted and no recovery running: the operator gets a way out.
  assert.match(indexSource, /if \(recovering\) return;/);
  assert.match(indexSource, /"تحديث الآن"/);
  // The manual path clears the guard, otherwise the button would do nothing.
  assert.match(indexSource, /sessionStorage\.removeItem\(GUARD_KEY\);[\s\S]{0,80}recover\(true\)/);
});
