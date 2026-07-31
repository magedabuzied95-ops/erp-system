import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { isChunkLoadError } from "../src/shared/utils/chunkLoadRecovery.js";

test("chunk recovery only classifies dynamic import failures", () => {
  assert.equal(isChunkLoadError(new Error("Failed to fetch dynamically imported module")), true);
  assert.equal(isChunkLoadError(new Error("Loading chunk 123 failed")), true);
  assert.equal(isChunkLoadError(new Error("Request failed with status 500")), false);
  assert.equal(isChunkLoadError(new Error("Cannot read properties of undefined")), false);
});

test("automatic chunk recovery stays quiet before exposing a manual reload", async () => {
  const boundary = await readFile(new URL("../src/shared/components/DebugErrorBoundary.jsx", import.meta.url), "utf8");
  const recovery = await readFile(new URL("../src/shared/utils/chunkLoadRecovery.js", import.meta.url), "utf8");

  assert.match(boundary, /showChunkAction: false/);
  assert.match(boundary, /<ChunkReloadFallback showAction=\{hasChunkReloadAttempted\(\) && this\.state\.showChunkAction\}/);
  assert.match(boundary, /\}, 8_000\)/);
  assert.match(recovery, /const healthyBootTimer = window\.setTimeout/);
  assert.match(recovery, /clearChunkReloadAttempt\(\)/);
  assert.match(recovery, /\}, 10_000\)/);
});

test("deployment cache policy keeps the application shell fresh and hashed assets immutable", async () => {
  const config = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));
  const indexRule = config.headers.find((rule) => rule.source === "/index.html");
  const assetRule = config.headers.find((rule) => rule.source === "/assets/(.*)");

  assert.equal(indexRule.headers[0].value, "no-store, no-cache, must-revalidate, max-age=0");
  assert.equal(assetRule.headers[0].value, "public, max-age=31536000, immutable");
});
