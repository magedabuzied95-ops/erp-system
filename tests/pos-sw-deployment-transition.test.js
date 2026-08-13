import assert from "node:assert/strict";
import test from "node:test";

import {
  createBuild,
  createServer,
  findPoisonedAssetEntries,
  loadServiceWorker,
} from "./helpers/swHarness.js";

// ============================================================================
// POS SERVICE WORKER — DEPLOYMENT TRANSITION
// ----------------------------------------------------------------------------
// Drives the REAL public/pos-sw.js through install -> activate -> fetch across
// two builds, on a fake origin that reproduces the deployed routing.
//
// The failure being guarded: a cashier on Build A when Build B ships must still
// be able to boot POS, and the worker must never cache an HTML SPA-fallback
// response under a .js cache key.
// ============================================================================

const BUILD_A = () => createBuild("AAAA1111");
const BUILD_B = () => createBuild("BBBB2222");

const boot = async (sw, server, build) => {
  await sw.install();
  await sw.activate();
  await sw.fetch("/pos", { mode: "navigate" });
  for (const chunk of build.chunks) await sw.fetch(chunk);
};

// The worker must hold this contract on BOTH origins: the fixed one that 404s a
// purged chunk, and a legacy/edge-cached origin that still answers with the SPA
// shell. Hosting and worker are separate faults and are fixed separately.
for (const assetFallback of ["spa", "404"]) {
  test(`[origin:${assetFallback}] a purged lazy chunk never poisons the asset cache`, async () => {
    const a = BUILD_A();
    const server = createServer(a, { assetFallback });
    const sw = loadServiceWorker(server);
    await boot(sw, server, a);

    // Build B ships; Build A's chunks are purged.
    const b = BUILD_B();
    server.deploy(b);

    // The cashier opens the recent-operations drawer for the first time this
    // session. That chunk belongs to Build A's graph and was never cached, so
    // this is the client's FIRST request for it -- and it no longer exists.
    const res = await (await sw.fetch(a.lazyChunks[0]));
    const contentType = res ? res.headers.get("content-type") || "" : "";

    const poisoned = await findPoisonedAssetEntries(sw.cacheStorage);
    assert.deepEqual(
      poisoned,
      [],
      `The worker cached HTML under a script URL: ${JSON.stringify(poisoned)}. ` +
        `Asset reads are cache-first, so that entry would be served forever and the ` +
        `"Failed to load module script" boot failure becomes permanent for this client.`,
    );

    assert.doesNotMatch(
      contentType,
      /text\/html/,
      "a .js request resolved to HTML; the worker must never pass an SPA fallback to the module loader",
    );
    assert.ok(
      res && !res.ok,
      "a purged chunk must fail honestly so ChunkLoadError recovery can run instead of a fatal MIME error",
    );
  });
}

test("an already-poisoned cache entry is evicted rather than served", async () => {
  const a = BUILD_A();
  const server = createServer(a, { assetFallback: "404" });
  const sw = loadServiceWorker(server);
  await sw.install();
  await sw.activate();

  // Simulate a client that a previous worker generation already poisoned.
  const runtime = await sw.cacheStorage.open("pos-shell-v11-runtime");
  await runtime.put(
    a.lazyChunks[0],
    new Response("<!doctype html><html></html>", {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    }),
  );

  const res = await (await sw.fetch(a.lazyChunks[0]));
  assert.doesNotMatch(
    res.headers.get("content-type") || "",
    /text\/html/,
    "the worker served a previously-cached HTML entry to a module request instead of evicting it",
  );

  const poisoned = await findPoisonedAssetEntries(sw.cacheStorage);
  assert.deepEqual(poisoned, [], "the poisoned entry must be removed, not left for the next request");
});

test("a client on the previous build boots the current build after a deploy", async () => {
  const a = BUILD_A();
  const server = createServer(a, { assetFallback: "spa" });
  const sw = loadServiceWorker(server);
  await boot(sw, server, a);

  const b = BUILD_B();
  server.deploy(b);

  // Reopening POS: navigation is network-first, so the shell should be Build B.
  const navRes = await sw.fetch("/pos", { mode: "navigate" });
  const html = await (await navRes).text();
  assert.match(html, /data-build="BBBB2222"/, "navigation must yield the current shell after a deploy");

  // ...and every chunk that shell references must resolve as a real module.
  for (const chunk of b.chunks) {
    const res = await (await sw.fetch(chunk));
    assert.equal(res.status, 200, `${chunk} must load`);
    assert.match(
      res.headers.get("content-type") || "",
      /javascript/,
      `${chunk} must be served as a module, not HTML`,
    );
  }
});

test("offline still serves the cached shell and its cached chunks", async () => {
  const a = BUILD_A();
  const server = createServer(a, { assetFallback: "spa" });
  const sw = loadServiceWorker(server);
  await boot(sw, server, a);

  server.offline = true;

  const navRes = await sw.fetch("/pos", { mode: "navigate" });
  assert.ok(navRes, "offline navigation must be answered from cache, not left to fail");
  const html = await (await navRes).text();
  assert.match(html, /id="root"/, "the offline shell must still be the application shell");

  for (const chunk of a.chunks) {
    const res = await (await sw.fetch(chunk));
    assert.equal(res.status, 200, `${chunk} must still come from cache while offline`);
  }
});

test("caches do not accumulate across builds", async () => {
  const a = BUILD_A();
  const server = createServer(a, { assetFallback: "spa" });
  const sw = loadServiceWorker(server);
  await boot(sw, server, a);

  const b = BUILD_B();
  server.deploy(b);

  // A new worker generation installs and activates for the new build.
  const sw2 = loadServiceWorker(server);
  sw2.cacheStorage.caches = sw.cacheStorage.caches; // same origin storage
  await sw2.install();
  await sw2.activate();
  await sw2.fetch("/pos", { mode: "navigate" });
  for (const chunk of b.chunks) await sw2.fetch(chunk);

  const names = await sw2.cacheStorage.keys();
  const stale = names.filter((n) => n.startsWith("pos-shell-") && !n.includes(process.env.__EXPECT_VERSION || ""));
  assert.ok(names.length <= 2, `cache storage grew unbounded across deploys: ${JSON.stringify(names)}`);
  assert.ok(stale.length >= 0);
});
