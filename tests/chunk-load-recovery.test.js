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
