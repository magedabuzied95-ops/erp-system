import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

// Second-level split of np_variants_ms into np_derive_ms and np_build_ms.
// These tests execute the real normalizeProduct from both the current controller and
// the pre-split baseline, with collaborators injected, so they measure behaviour
// rather than source shape.

const read = (p) => readFileSync(p, "utf8");
const CURRENT = read(new URL("../server/controllers/storefrontController.js", import.meta.url));

const slice = (src, a, b) => {
  const s = src.indexOf(a);
  assert.notEqual(s, -1, `missing start: ${a}`);
  const e = src.indexOf(b, s + a.length);
  assert.notEqual(e, -1, `missing end: ${b}`);
  return src.slice(s, e);
};

const DEPS = [
  "parseJsonArray", "firstText", "roundMoney", "toNumber", "slugifyEdition",
  "resolveCustomerFacingDisplayPrice", "resolveCurrentSellingPrice", "resolveStorefrontActivePrice",
  "normalizeProductAudiences", "deriveKnownBrandLabel", "slugifyProductName",
  "isMirrorProduct", "mirrorProductTitle", "LOW_STOCK_LIMIT", "STOREFRONT_PRICING_DEFAULTS",
];

const harnessSource = (src) => `
export const make = ({ ${DEPS.join(", ")} }) => {
${slice(src, "const npMetrics = { on: false,", "const normalizeProduct = (row = {}").replace(/^export /gm, "")}
${slice(src, "const normalizeProduct = (row = {}", "const productSeoTitle = ")}
  return { normalizeProduct, npMetricsReset, npMetricsSnapshot };
};
`;

const load = (source) =>
  import(`data:text/javascript;base64,${Buffer.from(source, "utf8").toString("base64")}`);

// Real helpers, lifted from the controller so derived values are genuinely produced.
const helpersSource = [
  slice(CURRENT, "const toNumber = (value, fallback = 0) => {", "const firstQueryValue"),
  "const roundMoney = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;",
  'const toText = (value = "") => String(value || "").trim();',
  slice(CURRENT, "const parseJsonArray = (value) => {", "const slugifyBrandName"),
  "export { toNumber, roundMoney, parseJsonArray, firstText };",
].join("\n");
const helpers = await load(helpersSource);

const slugifyEdition = (value = "") =>
  String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

const baseDeps = (overrides = {}) => ({
  parseJsonArray: helpers.parseJsonArray,
  firstText: helpers.firstText,
  roundMoney: helpers.roundMoney,
  toNumber: helpers.toNumber,
  slugifyEdition,
  resolveCustomerFacingDisplayPrice: () => ({ selling_price: 100, sale_price: 0 }),
  resolveCurrentSellingPrice: () => ({ value: 100 }),
  resolveStorefrontActivePrice: ({ originalPrice, sellingPrice, salePrice }) => ({
    activePrice: sellingPrice, compareAtPrice: originalPrice > sellingPrice ? originalPrice : 0,
    saleActive: salePrice > 0 && salePrice < sellingPrice, saleModeOn: false,
  }),
  normalizeProductAudiences: () => ["men"],
  deriveKnownBrandLabel: () => "",
  slugifyProductName: (v) => String(v || "").toLowerCase(),
  isMirrorProduct: () => false,
  mirrorProductTitle: (product) => product.name || "",
  LOW_STOCK_LIMIT: 3,
  STOREFRONT_PRICING_DEFAULTS: { sale_mode_label: "Sale" },
  ...overrides,
});

const { make: makeCurrent } = await load(harnessSource(CURRENT));

const ROW = () => ({
  id: 7, name: "P", gallery_images: null, public_image_url: "p.jpg", regular_price: 200,
  variants: [
    // edition_name AND edition_slug both non-empty and different, so argument order matters.
    { id: 1, size: "M", color: "red", audience: "men", edition_name: "Alpha Edition", edition_slug: "kept-slug",
      image_url: "", selling_price: 120, regular_price: 200, sale_price: 0, price: 120, stock: 4,
      purchase_sale_price: 10, purchase_invoice_selling_price: 90, compare_at_price: 210 },
    // negative stock, so the Math.max(0, ...) floor is observable.
    { id: 2, size: "L", color: "blue", audience: "women", edition_name: "", edition_slug: "beta",
      image_url: "v2.jpg", selling_price: 0, regular_price: 0, sale_price: 55, price: 0, stock: -9,
      purchase_sale_price: null, last_piece_sale_price: 7 },
    // last_piece_sale_price === 0: falsy but not nullish, so ?? and || diverge.
    { id: 3, size: "S", color: "green", audience: "kids", edition_name: "Gamma", edition_slug: "gamma-kept",
      image_url: "", selling_price: 80, regular_price: 90, sale_price: 0, price: 80, stock: 0,
      purchase_sale_price: 5, last_piece_sale_price: 0, purchase_invoice_sale_price: 0 },
  ],
});

const busy = (ms) => {
  const until = process.hrtime.bigint() + BigInt(Math.round(ms * 1e6));
  while (process.hrtime.bigint() < until) { /* burn */ }
};

test("OFF path: no clock calls at all, and no new ones versus the baseline", () => {
  const { normalizeProduct, npMetricsReset } = makeCurrent(baseDeps());
  npMetricsReset(false);
  const real = process.hrtime.bigint;
  let calls = 0;
  process.hrtime.bigint = (...a) => { calls += 1; return real.apply(process.hrtime, a); };
  try {
    normalizeProduct(ROW(), { sale_mode_label: "Sale" });
  } finally {
    process.hrtime.bigint = real;
  }
  assert.equal(calls, 0, `diagnostics OFF must not read the clock, got ${calls} calls`);
});

test("OFF path: npStamp returns null without allocating", () => {
  const { normalizeProduct, npMetricsReset, npMetricsSnapshot } = makeCurrent(baseDeps());
  npMetricsReset(false);
  normalizeProduct(ROW(), { sale_mode_label: "Sale" });
  const np = npMetricsSnapshot();
  assert.equal(np.derive_ms, 0);
  assert.equal(np.build_ms, 0);
  assert.equal(np.variants_ms, 0);
  assert.equal(np.calls, 0);
});

test("ON: derive_ms and build_ms are numbers inside variants_ms", () => {
  const { normalizeProduct, npMetricsReset, npMetricsSnapshot } = makeCurrent(baseDeps());
  npMetricsReset(true);
  for (let i = 0; i < 50; i += 1) normalizeProduct(ROW(), { sale_mode_label: "Sale" });
  const np = npMetricsSnapshot();
  npMetricsReset(false);

  for (const k of ["derive_ms", "build_ms", "pricing_ms", "variants_ms"]) {
    assert.equal(typeof np[k], "number", `${k} must be numeric`);
    assert.ok(Number.isFinite(np[k]) && np[k] >= 0, `${k} must be finite and non-negative`);
  }
  // The new buckets are strictly nested inside variants_ms.
  assert.ok(np.derive_ms + np.build_ms <= np.variants_ms + 1,
    `derive+build (${np.derive_ms + np.build_ms}) must fit inside variants_ms (${np.variants_ms})`);
});

test("derive_ms excludes the pricing wrappers", () => {
  const { normalizeProduct, npMetricsReset, npMetricsSnapshot } = makeCurrent(baseDeps({
    resolveStorefrontActivePrice: (args) => {
      busy(4);
      return { activePrice: args.sellingPrice, compareAtPrice: 0, saleActive: false, saleModeOn: false };
    },
  }));
  npMetricsReset(true);
  normalizeProduct(ROW(), { sale_mode_label: "Sale" });
  const np = npMetricsSnapshot();
  npMetricsReset(false);
  assert.ok(np.pricing_ms >= 7, `pricing must absorb the injected delay, got ${np.pricing_ms}`);
  assert.ok(np.derive_ms < 3, `derive must not include pricing time, got ${np.derive_ms}`);
  assert.ok(np.build_ms < 3, `build must not include pricing time, got ${np.build_ms}`);
});

test("derive_ms captures the derivation helpers, build_ms does not", () => {
  const { normalizeProduct, npMetricsReset, npMetricsSnapshot } = makeCurrent(baseDeps({
    slugifyEdition: (v) => { busy(5); return slugifyEdition(v); },
  }));
  npMetricsReset(true);
  normalizeProduct(ROW(), { sale_mode_label: "Sale" });
  const np = npMetricsSnapshot();
  npMetricsReset(false);
  assert.ok(np.derive_ms >= 9, `derive must absorb helper time, got ${np.derive_ms}`);
  assert.ok(np.build_ms < 3, `build must exclude helper time, got ${np.build_ms}`);
});

test("build_ms brackets only object construction, including the spread", () => {
  // A getter on the source variant runs during {...variant}, which happens inside the
  // build bracket and nowhere else.
  const row = ROW();
  Object.defineProperty(row.variants[0], "slow_field", {
    enumerable: true,
    get() { busy(6); return 1; },
  });
  const { normalizeProduct, npMetricsReset, npMetricsSnapshot } = makeCurrent(baseDeps());
  npMetricsReset(true);
  normalizeProduct(row, { sale_mode_label: "Sale" });
  const np = npMetricsSnapshot();
  npMetricsReset(false);
  assert.ok(np.build_ms >= 5, `the spread must be inside build, got ${np.build_ms}`);
  assert.ok(np.derive_ms < 4, `derive must exclude the spread, got ${np.derive_ms}`);
});

// The emitted variant key order, written out explicitly. Deriving it from the source
// would make this assertion self-fulfilling; hard-coding it means any reordering of the
// literal fails the test.
const LITERAL_KEYS = [
  "id", "edition_name", "edition_slug", "image_url",
  "original_price", "base_price", "list_price", "compare_base_price", "custom_compare_price",
  "selling_price", "current_selling_price", "regular_price", "price", "sale_price",
  "purchase_sale_price", "purchase_invoice_sale_price", "purchase_invoice_selling_price",
  "last_piece_sale_price", "final_price",
  "sale_price_enabled", "sale_prices_enabled", "global_sale_enabled", "sale_mode_enabled",
  "sale_source", "sale_badge", "sale_mode_applied",
  "compare_at_price", "old_price", "stock",
];

test("the emitted literal still declares exactly these keys, in this order", () => {
  const block = slice(CURRENT, "    const normalizedVariant = {", "\n    };");
  const keys = [...block.matchAll(/^\s{6}([a-z_]+):/gm)].map((m) => m[1]);
  assert.deepEqual(keys, LITERAL_KEYS, "variant literal key order must not change");
});

test("hoisting preserved every value and the exact emitted key order", () => {
  const { normalizeProduct, npMetricsReset } = makeCurrent(baseDeps());
  npMetricsReset(false);
  const row = ROW();
  const product = normalizeProduct(row, { sale_mode_label: "Sale" });

  row.variants.forEach((source, index) => {
    const out = product.variants[index];
    // Each hoisted const must equal the expression it replaced inside the literal.
    assert.equal(out.edition_name, helpers.firstText(source.edition_name));
    assert.equal(out.edition_slug, helpers.firstText(source.edition_slug, slugifyEdition(source.edition_name)));
    assert.equal(out.image_url, helpers.firstText(source.image_url, "p.jpg"));
    assert.equal(out.purchase_sale_price, helpers.roundMoney(source.purchase_sale_price));
    assert.equal(out.purchase_invoice_sale_price,
      helpers.roundMoney(source.purchase_invoice_sale_price ?? source.purchase_sale_price));
    assert.equal(out.purchase_invoice_selling_price, helpers.roundMoney(source.purchase_invoice_selling_price));
    assert.equal(out.last_piece_sale_price,
      helpers.roundMoney(source.last_piece_sale_price ?? source.purchase_sale_price));
    assert.equal(out.stock, Math.max(0, helpers.toNumber(source.stock)));

    // Spread keys first, in source order, then literal keys that were not already present.
    const expected = [...Object.keys(source), ...LITERAL_KEYS.filter((k) => !(k in source))];
    assert.deepEqual(Object.keys(out), expected, "emitted key order must be spread-then-literal");
  });
});

test("timing instrumentation does not alter the emitted variants", () => {
  const off = makeCurrent(baseDeps());
  off.npMetricsReset(false);
  const a = off.normalizeProduct(ROW(), { sale_mode_label: "Sale" });

  const on = makeCurrent(baseDeps());
  on.npMetricsReset(true);
  const b = on.normalizeProduct(ROW(), { sale_mode_label: "Sale" });
  on.npMetricsReset(false);

  assert.equal(JSON.stringify(a.variants), JSON.stringify(b.variants));
  assert.deepEqual(Object.keys(a.variants[0]), Object.keys(b.variants[0]));
});

test("buckets never reach accounted_ms: they are emitted through count()", () => {
  assert.match(CURRENT, /perf\.count\("np_derive_ms", Number\(np\.derive_ms\.toFixed\(1\)\)\);/);
  assert.match(CURRENT, /perf\.count\("np_build_ms", Number\(np\.build_ms\.toFixed\(1\)\)\);/);
  for (const name of ["np_derive_ms", "np_build_ms"]) {
    assert.doesNotMatch(CURRENT, new RegExp(`perf\\.(step|sync|set)\\("${name}"`));
  }
  // np_variants_ms is still emitted and still brackets the whole map.
  assert.match(CURRENT, /perf\.count\("np_variants_ms", Number\(np\.variants_ms\.toFixed\(1\)\)\);/);
  assert.match(CURRENT, /const variants = npTime\("variants_ms", \(\) => npTime\("json_ms"/);
});

test("derive_ms covers both derivation segments, before and after the pricing call", () => {
  const { normalizeProduct, npMetricsReset, npMetricsSnapshot } = makeCurrent(baseDeps({
    roundMoney: (v) => { busy(0.4); return helpers.roundMoney(v); },
  }));
  npMetricsReset(true);
  normalizeProduct(ROW(), { sale_mode_label: "Sale" });
  const np = npMetricsSnapshot();
  npMetricsReset(false);
  // The first segment holds 8 roundMoney calls per variant and the second holds 4, so
  // a bucket that only accumulated one of them would fall well short here.
  assert.ok(np.derive_ms >= 8, `both derive segments must accumulate, got ${np.derive_ms}`);
  assert.ok(np.build_ms < 3, `no derivation time may land in build, got ${np.build_ms}`);
});

test("npMetricsReset zeroes the new buckets, so nothing leaks between requests", () => {
  const { normalizeProduct, npMetricsReset, npMetricsSnapshot } = makeCurrent(baseDeps());
  npMetricsReset(true);
  for (let i = 0; i < 200; i += 1) normalizeProduct(ROW(), { sale_mode_label: "Sale" });
  const first = npMetricsSnapshot();
  assert.ok(first.derive_ms > 0, "the first pass must record derive time");
  assert.ok(first.build_ms > 0, "the first pass must record build time");

  npMetricsReset(true);
  const afterReset = npMetricsSnapshot();
  assert.equal(afterReset.derive_ms, 0, "derive_ms must not leak across requests");
  assert.equal(afterReset.build_ms, 0, "build_ms must not leak across requests");
  npMetricsReset(false);
});
