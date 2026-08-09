import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

// These tests execute the ACTUAL shipped implementations rather than asserting on
// source shape. The audience helpers and queryProductsWithSql are module-private or
// depend on the full server graph, so each is lifted out of the controller source and
// loaded as a module with its collaborators injected. Any drift in the real code is
// therefore reflected here immediately.

const controller = readFileSync(
  new URL("../server/controllers/storefrontController.js", import.meta.url),
  "utf8",
);

const slice = (startMarker, endMarker) => {
  const start = controller.indexOf(startMarker);
  assert.notEqual(start, -1, `missing: ${startMarker}`);
  const end = controller.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing: ${endMarker}`);
  return controller.slice(start, end);
};

const loadModule = (source) =>
  import(`data:text/javascript;base64,${Buffer.from(source, "utf8").toString("base64")}`);

const audienceSource = [
  slice('const PRODUCT_AUDIENCES = ["men", "women", "kids"];', "const STOREFRONT_SORT_ALIASES"),
  slice("const PRODUCT_AUDIENCE_ALIASES = new Map([", "const normalizeClassificationToken"),
  "export { PRODUCT_AUDIENCES, normalizeAudienceValue, flattenAudienceInput, normalizeProductAudiences };",
].join("\n");

const audience = await loadModule(audienceSource);

// The implementation that shipped before C1, reproduced verbatim as the comparison
// baseline: an unguarded JSON.parse attempt on every non-empty string.
const flattenOld = (value) => {
  if (Array.isArray(value)) return value.flatMap(flattenOld);
  if (value === null || value === undefined) return [];
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return [];
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return flattenOld(parsed);
    } catch {
      // Accept comma-separated strings below.
    }
    return text.split(/[,\n|]+/);
  }
  return [value];
};

const normalizeOld = (...sources) => {
  const seen = new Set();
  for (const source of sources) {
    for (const value of flattenOld(source)) {
      const a = audience.normalizeAudienceValue(value);
      if (a) seen.add(a);
    }
  }
  return audience.PRODUCT_AUDIENCES.filter((a) => seen.has(a));
};

// Every shape named in the change brief, plus the production census values.
const CORPUS = [
  // plain canonical
  "men", "women", "kids", "MEN", "Women", "KIDS",
  // production census strings
  "men,women,kids", "men,women", "women,men", "women,kids", "women,men,kids",
  "women,kids,men", "kids,women,men", "men,kids,women", "kids,women", "kids,men,women", "men,kids",
  // Arabic / Unicode aliases, with and without diacritics
  "رجالي", "رجال", "حريمي", "اطفال", "رِجَالِي", "men,رجالي",
  // punctuation and whitespace
  "  men  ", "men's", "mens", "man", "male", "men - women", "men/women", "men_women", "\tmen\n",
  // separators
  "men,women", "men|women", "men\nwomen", "men, women", "men ,, women", ",men,", "|", ",",
  // valid JSON arrays
  '["men"]', '["men","women"]', '["رجالي"]', "[]", '[ "kids" ]', '["men","bogus"]', "[1,2]",
  // malformed JSON that begins with "["
  "[men]", "[men,women]", "[", "[,]", '["men"', "[men",
  // JSON scalars, strings, numbers, booleans, null, objects
  "null", "true", "false", "123", "0", '"men"', "{}", '{"a":1}', "NaN", "undefined",
  // empty / blank
  "", "   ", "\n", "\t",
  // unrecognized
  "unknown", "unisex", "adult", "xyz",
];

const NON_STRING = [null, undefined, [], ["men"], ["men", "women"], [["men"], "kids"], [null, "men"],
  ['["men"]'], 0, 1, true, false, { a: 1 }, [{ a: 1 }]];

test("C1: flattenAudienceInput is byte-identical to the pre-change implementation", () => {
  for (const input of [...CORPUS, ...NON_STRING]) {
    assert.deepEqual(
      audience.flattenAudienceInput(input),
      flattenOld(input),
      `flattenAudienceInput diverged for ${JSON.stringify(input)}`,
    );
  }
});

test("C1: the guard only skips parses that could not have produced an array", () => {
  // Anything that does not start with "[" cannot parse to a JSON array, so the old
  // code's parse attempt was always discarded. Pin that explicitly.
  for (const input of ["null", "true", "123", '"men"', "{}", '{"a":1}', "men", "unknown"]) {
    const parsedToArray = (() => { try { return Array.isArray(JSON.parse(input)); } catch { return false; } })();
    assert.equal(parsedToArray, false, `${input} must not parse to an array`);
    assert.deepEqual(audience.flattenAudienceInput(input), flattenOld(input));
  }
  // Strings that DO start with "[" still take the parse path, valid or malformed.
  assert.deepEqual(audience.flattenAudienceInput('["men","women"]'), ["men", "women"]);
  assert.deepEqual(audience.flattenAudienceInput("[men]"), flattenOld("[men]"));
});

test("C2/C1: normalizeProductAudiences is unchanged across every call shape", () => {
  const sqlAudiences = (raw) => String(raw ?? "").toLowerCase().replaceAll(" ", "").split(",");
  for (const input of [...CORPUS, ...NON_STRING]) {
    assert.deepEqual(audience.normalizeProductAudiences(input), normalizeOld(input),
      `single-source diverged for ${JSON.stringify(input)}`);
    const raw = typeof input === "string" ? input : "";
    assert.deepEqual(
      audience.normalizeProductAudiences(sqlAudiences(raw), String(raw || "").split(",")),
      normalizeOld(sqlAudiences(raw), String(raw || "").split(",")),
      `post-filter shape diverged for ${JSON.stringify(input)}`,
    );
  }
  // Canonical output order and dedup are part of the contract.
  assert.deepEqual(audience.normalizeProductAudiences("kids,women,men"), ["men", "women", "kids"]);
  assert.deepEqual(audience.normalizeProductAudiences("men,men,MEN,رجالي"), ["men"]);
  assert.deepEqual(audience.normalizeProductAudiences("unknown"), []);
});

// ---------------------------------------------------------------------------
// Behavioural harness for the real queryProductsWithSql.
// ---------------------------------------------------------------------------

const queryFactorySource = `
export const makeQueryProductsWithSql = (db, normalizeProductAudiences) => {
${slice("export const queryProductsWithSql = async (", "export const queryProducts = async (").replace("export const queryProductsWithSql", "const queryProductsWithSql")}
  return queryProductsWithSql;
};
`;
const { makeQueryProductsWithSql } = await loadModule(queryFactorySource);

const variant = (id, audienceValue, imageUrl = "") => ({
  id,
  audience: audienceValue,
  audiences: String(audienceValue ?? "").toLowerCase().replaceAll(" ", "").split(","),
  image_url: imageUrl,
});

const ROWS = () => [
  {
    id: 1, public_image_url: "product-1.jpg",
    variants: [variant(1, "women", ""), variant(2, "men", "v2.jpg"), variant(3, null, "v3.jpg"),
               variant(4, "kids", "v4.jpg"), variant(5, "unknown", "v5.jpg"), variant(6, "men,women", "v6.jpg")],
  },
  { id: 2, public_image_url: "product-2.jpg", variants: [variant(7, "women", "v7.jpg"), variant(8, "kids", "v8.jpg")] },
  { id: 3, public_image_url: "product-3.jpg", variants: [] },
];

const fakeDb = (rows) => ({ query: async () => ({ rows: rows.map((r) => ({ ...r })), rowCount: rows.length }) });
const run = async (rows, gender, { spy = audience.normalizeProductAudiences, diagnostics } = {}) => {
  const fn = makeQueryProductsWithSql(fakeDb(rows), spy);
  return fn("SQL", 1, "", "", { gender }, false, 1000, 0, diagnostics);
};

test("post-filter: same variants, same order, same public_image_url, same row count", async () => {
  const result = await run(ROWS(), ["men"]);
  assert.equal(result.rows.length, 3);
  // Variant 1 (women) and 4 (kids) drop; 3 (no audience) and 5 (unrecognized) are kept.
  assert.deepEqual(result.rows[0].variants.map((v) => v.id), [2, 3, 5, 6], "inclusion and ORDER must be preserved");
  assert.equal(result.rows[0].public_image_url, "v2.jpg", "first scoped variant with an image wins");
  // Product 2 keeps nothing; its SQL public_image_url must survive untouched.
  assert.deepEqual(result.rows[1].variants.map((v) => v.id), []);
  assert.equal(result.rows[1].public_image_url, "product-2.jpg");
  // Zero variants in, zero out, image untouched.
  assert.deepEqual(result.rows[2].variants, []);
  assert.equal(result.rows[2].public_image_url, "product-3.jpg");

  const women = await run(ROWS(), ["women"]);
  assert.deepEqual(women.rows[0].variants.map((v) => v.id), [1, 3, 5, 6]);
  assert.equal(women.rows[0].public_image_url, "v3.jpg");

  const kids = await run(ROWS(), ["kids"]);
  assert.deepEqual(kids.rows[0].variants.map((v) => v.id), [3, 4, 5]);
});

test("memoization: one normalization per distinct representation, fresh per invocation", async () => {
  let calls = 0;
  const spy = (...args) => { calls += 1; return audience.normalizeProductAudiences(...args); };

  const first = await run(ROWS(), ["men"], { spy });
  // 8 variants across the fixture, 6 distinct audience representations.
  const distinct = new Set(ROWS().flatMap((r) => r.variants).map((v) => `${v.audiences.join("|")}::${String(v.audience || "")}`));
  assert.equal(calls, distinct.size, `expected one call per distinct representation, got ${calls}`);
  assert.ok(calls < 8, "the memo must collapse repeated representations");

  const before = calls;
  const second = await run(ROWS(), ["men"], { spy });
  assert.equal(calls - before, distinct.size, "a second query must start with an empty memo");
  assert.deepEqual(second.rows[0].variants.map((v) => v.id), first.rows[0].variants.map((v) => v.id));
});

test("no-gender fast path: the memo is never allocated and nothing is normalized", async () => {
  let calls = 0;
  const spy = (...args) => { calls += 1; return audience.normalizeProductAudiences(...args); };
  const result = await run(ROWS(), [], { spy });
  assert.equal(calls, 0, "no audience work may run without a gender filter");
  assert.deepEqual(result.rows[0].variants.map((v) => v.id), [1, 2, 3, 4, 5, 6], "rows pass through untouched");
  assert.equal(result.rows[0].public_image_url, "product-1.jpg");

  // A non-array gender must also take the fast path, exactly as before.
  const notArray = await run(ROWS(), "men", { spy });
  assert.equal(calls, 0);
  assert.deepEqual(notArray.rows[0].variants.map((v) => v.id), [1, 2, 3, 4, 5, 6]);
});

test("row copying behaviour is unchanged: rows are replaced, inputs are not mutated", async () => {
  const rows = ROWS();
  const snapshot = JSON.stringify(rows);
  const result = await run(rows, ["men"]);
  assert.equal(JSON.stringify(rows), snapshot, "the caller's fixture must not be mutated");
  assert.notEqual(result.rows[0].variants.length, rows[0].variants.length);
  assert.equal(typeof result.rows[0], "object");
});

test("the probe still reports the complete post-filter duration, memo included", async () => {
  const diagnostics = {};
  const slowSpy = (...args) => {
    const until = process.hrtime.bigint() + 2000000n; // ~2 ms of busy work per distinct key
    while (process.hrtime.bigint() < until) { /* burn */ }
    return audience.normalizeProductAudiences(...args);
  };
  await run(ROWS(), ["men"], { spy: slowSpy, diagnostics });
  assert.equal(typeof diagnostics.audience_postfilter_ms, "number");
  assert.ok(diagnostics.audience_postfilter_ms >= 2, `probe must span the work, got ${diagnostics.audience_postfilter_ms}`);

  const skipped = {};
  await run(ROWS(), [], { diagnostics: skipped });
  assert.equal(skipped.audience_postfilter_ms, 0, "the skipped path still reports a number");
});

test("the memo key encodes both arguments, so it cannot collide across representations", async () => {
  // Two variants sharing a raw `audience` but carrying different `audiences` arrays
  // must not be conflated. This is what makes the memo safe for any caller, not just
  // queries whose SQL derives `audiences` from `audience`.
  const rows = [{
    id: 9, public_image_url: "p.jpg",
    variants: [
      { id: 10, audience: "men", audiences: ["men"], image_url: "a.jpg" },
      { id: 11, audience: "men", audiences: ["women"], image_url: "b.jpg" },
    ],
  }];
  let calls = 0;
  const spy = (...args) => { calls += 1; return audience.normalizeProductAudiences(...args); };
  const result = await run(rows, ["men"], { spy });
  assert.equal(calls, 2, "differing audiences arrays must not share a memo entry");
  assert.deepEqual(result.rows[0].variants.map((v) => v.id), [10, 11]);
});
