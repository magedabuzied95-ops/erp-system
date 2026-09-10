import test from "node:test";
import assert from "node:assert/strict";

import { createCachedShellLoader } from "../../server/services/storefrontProductSeoPageService.js";

// Every product page used to fetch index.html over the network on every request; under the
// re-crawl of 8,489 new ad links those round trips stalled into Cloudflare 524s.

test("within the TTL the shell is served from memory", async () => {
  let loads = 0;
  let clock = 0;
  const shell = createCachedShellLoader(async () => { loads += 1; return `<html>${loads}</html>`; }, { ttlMs: 30000, now: () => clock });
  assert.equal(await shell(), "<html>1</html>");
  clock = 29999;
  assert.equal(await shell(), "<html>1</html>");
  assert.equal(loads, 1);
  clock = 30000;
  assert.equal(await shell(), "<html>2</html>");
  assert.equal(loads, 2);
});

test("concurrent requests share one fetch", async () => {
  let loads = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const shell = createCachedShellLoader(async () => { loads += 1; await gate; return "<html>once</html>"; });
  const pending = Array.from({ length: 25 }, () => shell());
  release();
  const results = await Promise.all(pending);
  assert.equal(loads, 1);
  assert.ok(results.every((html) => html === "<html>once</html>"));
});

test("a failed refresh serves the last good shell instead of an error", async () => {
  let clock = 0;
  let fail = false;
  const shell = createCachedShellLoader(async () => {
    if (fail) throw new Error("storefront_shell_524");
    return "<html>good</html>";
  }, { ttlMs: 1000, now: () => clock });
  assert.equal(await shell(), "<html>good</html>");
  fail = true;
  clock = 5000;
  assert.equal(await shell(), "<html>good</html>");
});

test("with nothing cached yet, a failure still surfaces", async () => {
  const shell = createCachedShellLoader(async () => { throw new Error("storefront_shell_524"); });
  await assert.rejects(shell(), /storefront_shell_524/);
});

test("the network fetch is given a timeout signal", async () => {
  let signal = null;
  const shell = createCachedShellLoader(
    async (fetchImpl) => { await fetchImpl("https://example.test/index.html", {}); return "<html>x</html>"; },
    { timeoutMs: 8000, fetchImpl: async (url, options) => { signal = options.signal; return {}; } },
  );
  await shell();
  assert.ok(signal instanceof AbortSignal, "the shell fetch must carry an abort signal");
});

test("both page handlers default to the cached shell, never the raw fetch", async () => {
  const { readFileSync } = await import("node:fs");
  for (const [file, cached, raw] of [
    ["storefrontProductSeoPageService.js", "cachedStorefrontHtmlShell", "loadStorefrontHtmlShell"],
    ["storefrontCategorySeoPageService.js", "cachedCategoryHtmlShell", "loadStorefrontCategoryHtmlShell"],
  ]) {
    const source = readFileSync(new URL(`../../server/services/${file}`, import.meta.url), "utf8");
    assert.match(source, new RegExp(`loadShell = ${cached},`), `${file} handler must default to the cache`);
    assert.doesNotMatch(source, new RegExp(`loadShell = ${raw},`), `${file} handler must not fetch the shell per request`);
    assert.ok(source.includes(`const ${cached} = createCachedShellLoader(${raw});`), `${file} must build its cache from ${raw}`);
  }
});

test("a cold fetch uses short attempts; a warm refresh uses one longer attempt", async () => {
  const seen = [];
  let clock = 0;
  const shell = createCachedShellLoader(
    async (fetchImpl) => { await fetchImpl("https://example.test/index.html", {}); return "<html>x</html>"; },
    { ttlMs: 1000, timeoutMs: 8000, coldAttemptTimeoutMs: 5000, now: () => clock, fetchImpl: async () => ({}), signalFor: (ms) => { seen.push(ms); return AbortSignal.timeout(ms); } },
  );
  await shell();
  clock = 5000;
  await shell();
  assert.deepEqual(seen, [5000, 8000]);
});

test("a stuck first connection is retried on a fresh one, and every waiting request gets the shell", async () => {
  // Production, right after a deploy: one connection to the storefront hung, and every request
  // sharing that fetch failed together, while the next fresh fetch answered in ~0.5s.
  let attempts = 0;
  const shell = createCachedShellLoader(
    async (fetchImpl) => { await fetchImpl("https://example.test/index.html", {}); return "<html>retried</html>"; },
    {
      coldAttempts: 4,
      coldAttemptTimeoutMs: 20,
      signalFor: (ms) => AbortSignal.timeout(ms),
      fetchImpl: (url, { signal }) => {
        attempts += 1;
        if (attempts === 1) {
          return new Promise((resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))));
        }
        return Promise.resolve({});
      },
    },
  );
  const results = await Promise.all(Array.from({ length: 4 }, () => shell()));
  assert.ok(results.every((html) => html === "<html>retried</html>"));
  assert.equal(attempts, 2);
});

test("a cold fetch gives up after its attempts are spent", async () => {
  let attempts = 0;
  const shell = createCachedShellLoader(
    async () => { attempts += 1; throw new Error("storefront_shell_524"); },
    { coldAttempts: 3 },
  );
  await assert.rejects(shell(), /storefront_shell_524/);
  assert.equal(attempts, 3);
});

test("warm() fills the cache and never throws", async () => {
  let loads = 0;
  const ok = createCachedShellLoader(async () => { loads += 1; return "<html>w</html>"; });
  assert.equal(await ok.warm(), true);
  assert.equal(await ok(), "<html>w</html>");
  assert.equal(loads, 1);
  const failing = createCachedShellLoader(async () => { throw new Error("down"); });
  assert.equal(await failing.warm(), false);
});

test("a failed warm refresh falls back after ONE attempt, not after a retry budget", async () => {
  // Retrying here would make the waiting request sit through several timeouts before it got the
  // shell it could have been served immediately.
  let clock = 0;
  let attempts = 0;
  let fail = false;
  const shell = createCachedShellLoader(async () => {
    attempts += 1;
    if (fail) throw new Error("storefront_shell_524");
    return "<html>good</html>";
  }, { ttlMs: 1000, coldAttempts: 4, now: () => clock });
  await shell();
  attempts = 0;
  fail = true;
  clock = 5000;
  assert.equal(await shell(), "<html>good</html>");
  assert.equal(attempts, 1);
});
