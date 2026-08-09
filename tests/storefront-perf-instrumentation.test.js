import assert from "node:assert/strict";
import test from "node:test";

const fresh = (tag, on) => {
  process.env.STOREFRONT_PERF_DIAGNOSTICS = on ? "1" : "";
  return import(`../server/utils/storefrontPerf.js?perf=${tag}`);
};
const capture = async (fn) => {
  const logs = []; const real = console.info;
  console.info = (...a) => logs.push(a.join(" "));
  try { await fn(); } finally { console.info = real; }
  return logs;
};

test("default OFF: emits nothing and is a transparent pass-through", async () => {
  const { createPerfTrace, STOREFRONT_PERF_ENABLED } = await fresh("off", false);
  assert.equal(STOREFRONT_PERF_ENABLED, false);
  const logs = await capture(async () => {
    const perf = createPerfTrace("products");
    assert.equal(perf.enabled, false);
    assert.equal(await perf.step("sql_main", async () => 42), 42);
    assert.equal(perf.sync("sort_cards", () => "x"), "x");
    perf.set("cache_lookup", 5);
    perf.end({ cache: "miss" });
  });
  assert.deepEqual(logs, []);
});

test("enabled: one line, and accounted + unaccounted === total", async () => {
  const { createPerfTrace } = await fresh("math", true);
  const logs = await capture(async () => {
    const perf = createPerfTrace("products");
    await perf.step("sql_main", async () => null);
    perf.sync("sort_cards", () => null);
    perf.set("cache_lookup", 3.2);
    perf.set("cache_write", 1.1);
    perf.end({ cache: "miss" });
  });
  assert.equal(logs.length, 1);
  const t = JSON.parse(logs[0].replace("[storefront:perf] ", ""));
  assert.equal(t.trace, "products");
  assert.equal(t.cache, "miss");
  assert.equal(t.cache_lookup, 3.2);
  assert.equal(t.cache_write, 1.1);
  assert.ok(Math.abs(t.accounted_ms + t.unaccounted_ms - t.total_ms) < 0.5);
});

test("no payloads, SQL, parameters, PII, product names or URLs leak", async () => {
  const { createPerfTrace } = await fresh("safe", true);
  const logs = await capture(async () => {
    const perf = createPerfTrace("products");
    await perf.step("sql_main", async () => ({ sql: "SELECT p.* FROM products", email: "a@b.com" }));
    await perf.step("alias_gender", async () => ["men", "رجالي"]);
    await perf.step("hydrate_images", async () => ({ name: "Nike Air", url: "https://m1store-egy.com/x.webp" }));
    perf.end({ cache: "miss" });
  });
  const line = logs[0];
  for (const leak of ["SELECT", "a@b.com", "رجالي", "Nike Air", "https://", ".webp"]) {
    assert.ok(!line.includes(leak), `must not leak: ${leak}`);
  }
});

test("errors propagate, the stage is still timed, and end() stays idempotent", async () => {
  const { createPerfTrace } = await fresh("err", true);
  const logs = await capture(async () => {
    const perf = createPerfTrace("products");
    await assert.rejects(() => perf.step("sql_main", async () => { throw new Error("boom"); }), /boom/);
    perf.end({ cache: "miss" });
    perf.end({ cache: "miss" });
  });
  assert.equal(logs.length, 1);
  assert.match(logs[0], /"sql_main":/);
});

test("getOrSetCache: diagnostics optional, semantics unchanged", async () => {
  const { getOrSetCache } = await import("../server/services/cacheService.js?perf=cache");
  assert.equal(await getOrSetCache("", 120, async () => "v"), "v");
  const diag = {};
  assert.equal(await getOrSetCache("", 120, async () => "v", diag), "v");
  assert.equal(typeof diag.cache_lookup_ms, "number");
  assert.equal(diag.cache, "miss");
  assert.equal(typeof diag.cache_write_ms, "number");
});

test("count() records cardinality as metadata and never inflates accounted_ms", async () => {
  process.env.STOREFRONT_PERF_DIAGNOSTICS = "1";
  const { createPerfTrace } = await import("../server/utils/storefrontPerf.js?perf=count");
  const logs = []; const real = console.info;
  console.info = (...a) => logs.push(a.join(" "));
  try {
    const perf = createPerfTrace("products");
    perf.set("cache_lookup", 2.0);
    perf.count("np_result_rows", 213);
    perf.count("np_total_variants", 3447);
    perf.count("np_avg_variants_per_row", 16.2);
    perf.count("np_max_variants_per_row", 40);
    perf.end({ cache: "miss" });
  } finally { console.info = real; }
  const t = JSON.parse(logs[0].replace("[storefront:perf] ", ""));
  assert.equal(t.np_result_rows, 213);
  assert.equal(t.np_total_variants, 3447);
  assert.equal(t.np_max_variants_per_row, 40);
  // counters must NOT be summed into the timing arithmetic
  assert.ok(t.accounted_ms < 10, `accounted_ms must exclude counters, got ${t.accounted_ms}`);
  assert.ok(Math.abs(t.accounted_ms + t.unaccounted_ms - t.total_ms) < 0.5);
});
