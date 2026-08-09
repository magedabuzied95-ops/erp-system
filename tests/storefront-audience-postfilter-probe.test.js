import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

// One aggregate probe around the post-SQL audience filter inside
// queryProductsWithSql. It must be a pure no-op when diagnostics are off, must
// emit exactly one numeric field when on, must never be summed into
// accounted_ms (it is nested inside sql_main), and must not change filtering.

const controller = readFileSync(
  new URL("../server/controllers/storefrontController.js", import.meta.url),
  "utf8",
);

const fresh = (tag, on) => {
  process.env.STOREFRONT_PERF_DIAGNOSTICS = on ? "1" : "";
  return import(`../server/utils/storefrontPerf.js?audience=${tag}`);
};

const capture = async (fn) => {
  const logs = [];
  const real = console.info;
  console.info = (...a) => logs.push(a.join(" "));
  try { await fn(); } finally { console.info = real; }
  return logs;
};

const queryFn = (() => {
  const start = controller.indexOf("export const queryProductsWithSql = async (");
  assert.notEqual(start, -1);
  const end = controller.indexOf("export const queryProducts = async (", start);
  assert.notEqual(end, -1);
  return controller.slice(start, end);
})();

test("diagnostics OFF: the field is absent and nothing is emitted", async () => {
  const { createPerfTrace, STOREFRONT_PERF_ENABLED } = await fresh("off", false);
  assert.equal(STOREFRONT_PERF_ENABLED, false);
  const logs = await capture(async () => {
    const perf = createPerfTrace("products");
    assert.equal(perf.enabled, false);
    // The controller only allocates the diagnostics object when perf.enabled is
    // true, so with the trace disabled the probe is never even constructed.
    const audienceDiagnostics = perf.enabled ? {} : undefined;
    assert.equal(audienceDiagnostics, undefined);
    perf.count("sql_audience_postfilter", 12.3);
    perf.end({ cache: "miss" });
  });
  assert.deepEqual(logs, [], "no trace line may be emitted while diagnostics are off");
});

test("diagnostics ON: exactly one numeric field, and accounted_ms is unaffected", async () => {
  const { createPerfTrace } = await fresh("on", true);
  const logs = await capture(async () => {
    const perf = createPerfTrace("products");
    await perf.step("sql_main", async () => null);
    perf.count("sql_audience_postfilter", 317.4);
    perf.end({ cache: "miss" });
  });
  assert.equal(logs.length, 1);
  const t = JSON.parse(logs[0].replace("[storefront:perf] ", ""));

  assert.equal(typeof t.sql_audience_postfilter, "number");
  assert.equal(t.sql_audience_postfilter, 317.4);

  // Nested inside sql_main: adding it to accounted_ms would double-count and drive
  // unaccounted_ms negative. The count() channel keeps the invariant intact.
  assert.ok(t.accounted_ms < 10, `accounted_ms must exclude the probe, got ${t.accounted_ms}`);
  assert.ok(
    Math.abs(t.accounted_ms + t.unaccounted_ms - t.total_ms) < 0.5,
    "accounted_ms + unaccounted_ms must still equal total_ms",
  );
});

test("a zero measurement is still reported as a number, not omitted", async () => {
  const { createPerfTrace } = await fresh("zero", true);
  const logs = await capture(async () => {
    const perf = createPerfTrace("products");
    perf.count("sql_audience_postfilter", 0);
    perf.end({ cache: "hit" });
  });
  const t = JSON.parse(logs[0].replace("[storefront:perf] ", ""));
  assert.equal(t.sql_audience_postfilter, 0);
  assert.equal(typeof t.sql_audience_postfilter, "number");
});

test("the probe is metadata, never a timed stage", () => {
  assert.match(controller, /perf\.count\("sql_audience_postfilter", audienceDiagnostics\.audience_postfilter_ms \?\? 0\)/);
  assert.doesNotMatch(controller, /perf\.step\("sql_audience_postfilter"/);
  assert.doesNotMatch(controller, /perf\.sync\("sql_audience_postfilter"/);
  assert.doesNotMatch(controller, /perf\.set\("sql_audience_postfilter"/);
  assert.equal(
    (controller.match(/sql_audience_postfilter/g) || []).length,
    1,
    "the stage name may appear exactly once in the controller",
  );
});

test("the diagnostics object is optional and only allocated when the trace is enabled", () => {
  assert.match(controller, /const audienceDiagnostics = perf\.enabled \? \{\} : undefined;/);
  assert.match(controller, /if \(audienceDiagnostics\) perf\.count\("sql_audience_postfilter"/);
  assert.match(queryFn, /async \(sql, tenantId, q, category, filters, saleOnly, limit, offset, diagnostics\) =>/);
  assert.match(
    controller,
    /export const queryProducts = async \(tenantId, q, category, filters, saleOnly, limit, offset, diagnostics\) =>/,
  );
  // Every other caller keeps its existing arity, so their behaviour is untouched.
  assert.match(
    controller,
    /export const queryProductsWithoutVisibility = async \(tenantId, q, category, filters, saleOnly, limit, offset\) =>/,
  );
});

test("the timer brackets only the audience filter, and the filter itself is unchanged", () => {
  assert.match(queryFn, /const audienceStart = diagnostics \? process\.hrtime\.bigint\(\) : null;/);
  // The clock must start after the SQL await and stop after the row rebuild, so the
  // probe cannot absorb query, transfer or driver-parse time.
  const sqlAt = queryFn.indexOf("await db.query(sql, params)");
  const startAt = queryFn.indexOf("const audienceStart =");
  const mapAt = queryFn.indexOf("result.rows = result.rows.map(");
  const stopAt = queryFn.indexOf("diagnostics.audience_postfilter_ms = Number(");
  assert.ok(sqlAt > -1 && startAt > sqlAt, "the probe must start after the SQL call");
  assert.ok(mapAt > startAt, "the row rebuild must be inside the probe");
  assert.ok(stopAt > mapAt, "the probe must stop after the row rebuild");

  // Filtering semantics are byte-identical to the pre-probe implementation.
  assert.match(queryFn, /const selectedAudiences = Array\.isArray\(filters\.gender\) \? filters\.gender : \[\];/);
  assert.match(queryFn, /const variantAudiences = normalizeProductAudiences\(variant\?\.audiences, String\(variant\?\.audience \|\| ""\)\.split\(","\)\);/);
  assert.match(queryFn, /return variantAudiences\.length === 0 \|\| variantAudiences\.some\(\(audience\) => selectedAudiences\.includes\(audience\)\);/);
  assert.match(queryFn, /const matchedImage = scopedVariants\.find\(\(variant\) => String\(variant\?\.image_url \|\| ""\)\.trim\(\)\)\?\.image_url \|\| "";/);
  assert.match(queryFn, /\.\.\.\(matchedImage \? \{ public_image_url: matchedImage \} : \{\}\),/);
});

test("no per-row or per-variant logging, and no payload can leak", () => {
  assert.doesNotMatch(queryFn, /console\./, "the query helper must not log");
  // The only thing written to the diagnostics object is a single number.
  const writes = queryFn.match(/diagnostics\.[a-z_]+ = [^;]+;/g) || [];
  assert.equal(writes.length, 2, "exactly one initialisation and one measurement");
  for (const write of writes) {
    assert.match(write, /diagnostics\.audience_postfilter_ms = (0|Number\()/);
  }
  assert.doesNotMatch(queryFn, /diagnostics\.[a-z_]*(row|id|name|price|url|sql|param)/i);
});
