// The employee/manager portal and AI Inbox workers, driven for real.
//
// All three PWAs shipped the same line -- `if (url.origin !== self.location.origin) return;`
// -- and photos come from the API origin, so none of them cached or served a
// single image. These tests fail against that behaviour and pass against the
// shared image cache.
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

import { createBuild, createServer, loadServiceWorker } from "./helpers/swHarness.js";

const API_ORIGIN = "https://api.erp.test";
const PHOTO = `${API_ORIGIN}/uploads/employees/avatar.png`;

const buildWithMedia = () =>
  createBuild("AAAA1111", {
    extraFiles: { "/uploads/employees/avatar.png": { body: "PNGDATA", type: "image/png" } },
  });

const swFile = (name) => path.join(process.cwd(), "public", name);
const readSource = (relativePath) => fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");

test("the inbox worker serves customer media offline, from the API origin", async () => {
  const build = buildWithMedia();
  const server = createServer(build, { assetFallback: "404" });
  const sw = loadServiceWorker(server, { swPath: swFile("inbox-sw.js") });
  await sw.install();
  await sw.activate();

  // Online: the media is fetched and the cache fills as a side effect.
  const online = await sw.fetch(PHOTO, { destination: "image" });
  assert.equal(online.status, 200);

  server.offline = true;

  const offline = await sw.fetch(PHOTO, { destination: "image" });
  assert.ok(offline, "an offline attachment must be answered from cache, not left to fail");
  assert.equal(await offline.text(), "PNGDATA");
});

test("the portal worker caches media for a portal page and ignores it for any other", async () => {
  const build = buildWithMedia();
  const server = createServer(build, { assetFallback: "404" });
  const sw = loadServiceWorker(server, {
    swPath: swFile("employee-portal-sw.js"),
    clients: {
      portal: "https://erp.test/employee-app/abc123",
      storefront: "https://erp.test/shop/product/9",
    },
  });
  await sw.install();
  await sw.activate();

  // This worker is registered at scope "/", so it sees every request the whole
  // browser profile makes. A photo asked for by the storefront must not land in
  // the portal's media cache.
  await sw.fetch(PHOTO, { destination: "image", clientId: "storefront" });
  const mediaCache = await sw.cacheStorage.open("portal-media-v1");
  assert.equal(await mediaCache.match(PHOTO), undefined, "a storefront photo must not be hoarded by the portal");

  await sw.fetch(PHOTO, { destination: "image", clientId: "portal" });
  assert.ok(await mediaCache.match(PHOTO), "a portal photo must be cached");

  server.offline = true;
  const offline = await sw.fetch(PHOTO, { destination: "image", clientId: "portal" });
  assert.equal(await offline.text(), "PNGDATA");
});

test("neither worker mistakes its own navigation for an image", async () => {
  for (const [name, route] of [
    ["inbox-sw.js", "/inbox"],
    ["employee-portal-sw.js", "/employee-app/abc123"],
  ]) {
    const build = buildWithMedia();
    const server = createServer(build, { assetFallback: "404" });
    const sw = loadServiceWorker(server, { swPath: swFile(name), clients: { c1: `https://erp.test${route}` } });
    await sw.install();
    await sw.activate();
    await sw.fetch(route, { mode: "navigate", destination: "document", clientId: "c1" });

    // Chrome's navigation Accept header contains image/avif and image/webp.
    const navRes = await sw.fetch(route, {
      mode: "navigate",
      destination: "document",
      clientId: "c1",
      headers: { accept: "text/html,application/xhtml+xml,image/avif,image/webp,*/*;q=0.8" },
    });
    assert.ok(navRes, `${name}: a navigation must still be handled as a navigation`);

    const names = await sw.cacheStorage.keys();
    for (const cacheName of names.filter((n) => n.includes("media"))) {
      const cache = await sw.cacheStorage.open(cacheName);
      const keys = await cache.keys();
      assert.ok(
        !keys.some((key) => String(key).includes(route)),
        `${name}: the page itself must never be stored in the media cache`,
      );
    }
  }
});

test("every worker shares one image-cache implementation", () => {
  const shared = readSource("public/sw-image-cache.js");
  assert.match(shared, /self\.createSwImageCache = /);

  for (const name of ["pos-sw.js", "inbox-sw.js", "employee-portal-sw.js"]) {
    const source = readSource(`public/${name}`);
    assert.ok(
      source.includes('importScripts("/sw-image-cache.js")'),
      `${name} must use the shared implementation`,
    );
    assert.ok(
      source.includes("self.createSwImageCache({"),
      `${name} must build its cache from the shared factory`,
    );
    // Three copies of the opaque-response rules are how the original bug
    // survived; a worker growing its own copy is the regression to catch.
    assert.ok(
      !/response\.type === "opaque"/.test(source),
      `${name} re-implemented the opaque-response rule instead of sharing it`,
    );
  }
});

test("each media cache is versioned outside the shell prefix its worker evicts", () => {
  const cases = [
    { file: "pos-sw.js", evicts: "pos-shell-", media: "pos-product-images-v1" },
    { file: "inbox-sw.js", evicts: "ai-inbox-", media: "inbox-media-v1" },
    { file: "employee-portal-sw.js", evicts: "employee-portal", media: "portal-media-v1" },
  ];
  for (const { file, evicts, media } of cases) {
    const source = readSource(`public/${file}`);
    assert.ok(source.includes(`"${media}"`), `${file} must name its media cache`);
    // A deploy must not cost the device its downloaded photos. Both new caches
    // were originally named inside their worker's own eviction prefix, which
    // would have wiped them on every single version bump.
    assert.ok(
      !media.startsWith(evicts),
      `${file}: "${media}" sits inside the "${evicts}" prefix its own activate handler deletes, ` +
        "so every version bump would throw away the downloaded photos",
    );
  }
});
