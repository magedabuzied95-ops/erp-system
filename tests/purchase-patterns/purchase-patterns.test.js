import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { readFile } from "node:fs/promises";

import {
  SIZE_GROUPS,
  normalizeProductAudiences,
  resolveCanonicalSizeGroup,
  resolveSizeGroups,
} from "../../server/utils/sizeGroups.js";
import {
  buildPurchaseComposition,
  resolveProductPurchasePattern,
  validatePurchasePatternConfiguration,
} from "../../server/services/purchasePatternService.js";
import { buildReorderDraftLines, buildSuggestions } from "../../server/services/smartReorderService.js";
import { runRequiredPurchaseAccounting } from "../../server/services/purchaseTransactionService.js";
import { buildPurchaseAlertDraftItems, buildPurchaseAlertsFromRows } from "../../server/controllers/inventoryController.js";

const variantsFor = (productId, colors, sizes, { missing = null, stock = 0 } = {}) => {
  let id = productId * 1000;
  return colors.flatMap((color) => sizes
    .filter((size) => !(missing && missing.color === color && String(missing.size) === String(size)))
    .map((size) => ({
      id: ++id,
      variant_id: id,
      product_id: productId,
      color,
      size: String(size),
      stock,
      last_purchase_cost: 10,
    })));
};

const cartonProduct = (overrides = {}) => ({
  id: 1,
  product_id: 1,
  product_name: "MEN carton",
  name: "MEN carton",
  purchase_mode: "FULL_CARTON",
  purchase_size_group: "MEN",
  purchase_colors_per_carton: 3,
  purchase_pieces_per_size: 1,
  purchase_carton_colors: ["Black", "White", "Navy"],
  ...overrides,
});

const alertRows = (product, variants) => variants.map((variant) => ({
  ...product,
  ...variant,
  product_name: product.name,
  purchase_alerts_enabled: true,
  purchase_carton_colors: product.purchase_carton_colors || [],
}));

const withTriggerStock = (variants, triggerColor = "Black", triggerSize = "43", triggerStock = 0) => variants.map((variant) => ({
  ...variant,
  stock: variant.color === triggerColor && variant.size === triggerSize ? triggerStock : 3,
}));

const lineSignature = (lines = []) => lines
  .map((line) => `${line.variant_id}:${Number(line.quantity ?? line.suggested_qty ?? 0)}`)
  .sort();

test("all canonical size groups have the exact five-size source of truth", () => {
  assert.deepEqual(SIZE_GROUPS.WOMEN.sizes, ["37", "38", "39", "40", "41"]);
  assert.deepEqual(SIZE_GROUPS.MEN.sizes, ["41", "42", "43", "44", "45"]);
  assert.deepEqual(SIZE_GROUPS.KIDS_CLOG.sizes, ["22", "23", "24", "25", "26"]);
  assert.deepEqual(SIZE_GROUPS.BABY.sizes, ["27", "28", "29", "30", "31"]);
  assert.deepEqual(SIZE_GROUPS.BOYS.sizes, ["32", "33", "34", "35", "36"]);
});

test("multiple size groups merge, deduplicate overlaps and keep canonical numeric order", () => {
  assert.deepEqual(resolveSizeGroups(["KIDS_CLOG", "BABY"]).sizes, ["22", "23", "24", "25", "26", "27", "28", "29", "30", "31"]);
  assert.deepEqual(resolveSizeGroups(["KIDS_CLOG", "BABY", "BOYS"]).sizes, Array.from({ length: 15 }, (_, index) => String(index + 22)));
  const adults = resolveSizeGroups(["WOMEN", "MEN"]);
  assert.deepEqual(adults.sizes, ["37", "38", "39", "40", "41", "42", "43", "44", "45"]);
  assert.equal(adults.count, 9);
  assert.equal(adults.range, "37–45");
});

test("every single canonical group still resolves to exactly five sizes", () => {
  for (const key of Object.keys(SIZE_GROUPS)) {
    assert.deepEqual(resolveSizeGroups([key]).sizes, SIZE_GROUPS[key].sizes);
    assert.equal(resolveSizeGroups(key).count, 5);
  }
});

test("real UTF-8 Arabic classifications resolve correctly", () => {
  assert.deepEqual(normalizeProductAudiences("رجالي"), ["men"]);
  assert.deepEqual(normalizeProductAudiences("حريمي"), ["women"]);
  assert.equal(resolveCanonicalSizeGroup({ audience: "أطفال", category: "كلوك" }), "KIDS_CLOG");
  assert.equal(resolveCanonicalSizeGroup({ audience: "أطفال", category: "بيبي" }), "BABY");
  assert.equal(resolveCanonicalSizeGroup({ audience: "أولادي", category: "أحذية" }), "BOYS");
  assert.match(SIZE_GROUPS.MEN.label, /رجالي/);
});

test("size 41 alone never chooses MEN or WOMEN", () => {
  assert.equal(resolveCanonicalSizeGroup({ sizes: ["41"] }), null);
  assert.equal(resolveCanonicalSizeGroup({ audience: "رجالي", sizes: ["41"] }), "MEN");
  assert.equal(resolveCanonicalSizeGroup({ audience: "حريمي", sizes: ["41"] }), "WOMEN");
});

test("FULL_COLOR_RUN supports one and two pieces per size", () => {
  const variants = variantsFor(2, ["Black"], SIZE_GROUPS.WOMEN.sizes);
  for (const pieces of [1, 2]) {
    const result = buildPurchaseComposition({
      product: { id: 2, purchase_mode: "FULL_COLOR_RUN", purchase_size_group: "WOMEN", purchase_pieces_per_size: pieces },
      variants,
      triggerColor: "Black",
    });
    assert.equal(result.valid, true);
    assert.equal(result.lines.length, 5);
    assert.equal(result.total_pieces, 5 * pieces);
  }
});

test("FULL_COLOR_RUN composes 15 merged kids sizes at one or two pieces per size", () => {
  const sizes = resolveSizeGroups(["KIDS_CLOG", "BABY", "BOYS"]).sizes;
  const variants = variantsFor(52, ["Black"], sizes);
  for (const pieces of [1, 2]) {
    const result = buildPurchaseComposition({
      product: { id: 52, purchase_mode: "FULL_COLOR_RUN", purchase_size_groups: ["KIDS_CLOG", "BABY", "BOYS"], purchase_pieces_per_size: pieces },
      variants,
      triggerColor: "Black",
    });
    assert.equal(result.valid, true);
    assert.equal(result.lines.length, 15);
    assert.equal(result.total_pieces, 15 * pieces);
    assert.deepEqual(result.lines.map((line) => line.size), sizes);
  }
});

test("FULL_CARTON composes 3 colors by 15 merged sizes at one or two pieces per size", () => {
  const sizes = resolveSizeGroups(["KIDS_CLOG", "BABY", "BOYS"]).sizes;
  const variants = variantsFor(53, ["Black", "White", "Blue"], sizes);
  for (const pieces of [1, 2]) {
    const result = buildPurchaseComposition({
      product: cartonProduct({
        id: 53,
        product_id: 53,
        purchase_size_group: null,
        purchase_size_groups: ["KIDS_CLOG", "BABY", "BOYS"],
        purchase_pieces_per_size: pieces,
        purchase_carton_colors: ["Black", "White", "Blue"],
      }),
      variants,
    });
    assert.equal(result.valid, true);
    assert.equal(result.lines.length, 45);
    assert.equal(result.total_pieces, 45 * pieces);
  }
});

test("missing Blue / 29 rejects the complete multi-group carton without partial lines", () => {
  const sizes = resolveSizeGroups(["KIDS_CLOG", "BABY", "BOYS"]).sizes;
  const variants = variantsFor(54, ["Black", "White", "Blue"], sizes, { missing: { color: "Blue", size: "29" } });
  const result = buildPurchaseComposition({
    product: cartonProduct({
      id: 54,
      product_id: 54,
      purchase_size_group: null,
      purchase_size_groups: ["KIDS_CLOG", "BABY", "BOYS"],
      purchase_carton_colors: ["Black", "White", "Blue"],
    }),
    variants,
  });
  assert.equal(result.valid, false);
  assert.deepEqual(result.lines, []);
  assert.match(result.errors.map((item) => item.message).join("; "), /Missing variant: Blue \/ 29/);
});

test("legacy single purchase_size_group reloads as one canonical group", () => {
  const pattern = resolveProductPurchasePattern({ purchase_mode: "FULL_COLOR_RUN", purchase_size_group: "MEN", purchase_pieces_per_size: 1 });
  assert.deepEqual(pattern.size_groups, ["MEN"]);
  assert.deepEqual(pattern.sizes, SIZE_GROUPS.MEN.sizes);
});

test("multi-group save and reload preserves canonical selected groups", () => {
  const saved = validatePurchasePatternConfiguration({
    purchase_mode: "FULL_COLOR_RUN",
    purchase_size_groups: ["BOYS", "KIDS_CLOG", "BABY", "BABY"],
    purchase_pieces_per_size: 1,
  });
  assert.equal(saved.valid, true);
  const reloaded = resolveProductPurchasePattern(JSON.parse(JSON.stringify({
    purchase_mode: saved.mode,
    purchase_size_group: saved.size_group,
    purchase_size_groups: saved.size_groups,
    purchase_pieces_per_size: saved.pieces_per_size,
  })));
  assert.deepEqual(reloaded.size_groups, ["KIDS_CLOG", "BABY", "BOYS"]);
  assert.deepEqual(reloaded.sizes, Array.from({ length: 15 }, (_, index) => String(index + 22)));
});

test("multi-group alert suggestion exactly matches its generated purchase draft", () => {
  const product = {
    id: 55,
    name: "Kids carton",
    purchase_mode: "FULL_CARTON",
    purchase_size_groups: ["KIDS_CLOG", "BABY", "BOYS"],
    purchase_colors_per_carton: 3,
    purchase_pieces_per_size: 1,
    purchase_carton_colors: ["Black", "White", "Blue"],
    purchase_alerts_enabled: true,
    purchase_alert_by_color: true,
  };
  const sizes = resolveSizeGroups(product.purchase_size_groups).sizes;
  const variants = withTriggerStock(variantsFor(55, product.purchase_carton_colors, sizes), "Black", "29", 0);
  const [alert] = buildPurchaseAlertsFromRows(alertRows(product, variants));
  assert.deepEqual(alert.purchase_suggestion.sizes, sizes);
  assert.equal(alert.purchase_suggestion.total_units, 45);
  assert.deepEqual(lineSignature(buildPurchaseAlertDraftItems(alert)), lineSignature(alert.purchase_suggestion.lines));
});

test("each canonical group composes a complete five-line color run", () => {
  for (const [key, group] of Object.entries(SIZE_GROUPS)) {
    const productId = Object.keys(SIZE_GROUPS).indexOf(key) + 20;
    const variants = variantsFor(productId, ["Black"], group.sizes);
    const result = buildPurchaseComposition({
      product: { id: productId, purchase_mode: "FULL_COLOR_RUN", purchase_size_group: key, purchase_pieces_per_size: 1 },
      variants,
      triggerColor: "Black",
    });
    assert.equal(result.valid, true, key);
    assert.deepEqual(result.lines.map((line) => line.size), group.sizes, key);
  }
});

test("FULL_CARTON produces 15 or 30 actual variant pieces and round-trips unchanged", () => {
  const variants = variantsFor(1, ["Black", "White", "Navy"], SIZE_GROUPS.MEN.sizes);
  for (const pieces of [1, 2]) {
    const saved = cartonProduct({ purchase_pieces_per_size: pieces });
    const validated = validatePurchasePatternConfiguration(saved, variants);
    assert.equal(validated.valid, true);
    const databaseRow = JSON.parse(JSON.stringify({
      ...saved,
      purchase_mode: validated.mode,
      purchase_size_group: validated.size_group,
      purchase_colors_per_carton: validated.colors_per_carton,
      purchase_pieces_per_size: validated.pieces_per_size,
      purchase_carton_colors: validated.carton_colors,
    }));
    const reloaded = resolveProductPurchasePattern(databaseRow, variants);
    const composition = buildPurchaseComposition({ product: databaseRow, variants });
    assert.equal(reloaded.mode, "FULL_CARTON");
    assert.equal(reloaded.size_group, "MEN");
    assert.deepEqual(reloaded.carton_colors, ["Black", "White", "Navy"]);
    assert.equal(composition.lines.length, 15);
    assert.equal(composition.total_pieces, 3 * 5 * pieces);
    assert.ok(composition.lines.every((line) => line.variant_id && line.quantity === pieces));
  }
});

test("strict invalid configuration cases fail without silent correction", () => {
  const variants = variantsFor(1, ["Black", "White", "Navy"], SIZE_GROUPS.MEN.sizes);
  const cases = [
    cartonProduct({ purchase_carton_colors: [] }),
    cartonProduct({ purchase_carton_colors: ["Black", "Black", "White"] }),
    cartonProduct({ purchase_carton_colors: ["Black", "White"] }),
    cartonProduct({ purchase_carton_colors: ["Black", "White", "Purple"] }),
    cartonProduct({ purchase_pieces_per_size: 0 }),
    cartonProduct({ purchase_pieces_per_size: -1 }),
    cartonProduct({ purchase_size_group: "UNKNOWN" }),
    { purchase_mode: "FULL_COLOR_RUN", purchase_size_group: null, purchase_pieces_per_size: 1 },
  ];
  for (const product of cases) assert.equal(validatePurchasePatternConfiguration(product, variants).valid, false);
});

test("Purchase Alerts aggregate a valid carton into its 15 actual variant draft lines", () => {
  const product = cartonProduct({ purchase_alerts_enabled: true, purchase_alert_by_color: false, carton_size: 15, suggested_purchase_cartons: 1 });
  const variants = variantsFor(1, ["Black", "White", "Navy"], SIZE_GROUPS.MEN.sizes, { stock: 0 });
  const rows = variants.map((variant) => ({
    ...product,
    ...variant,
    name: product.name,
    purchase_alerts_enabled: true,
    purchase_alert_by_color: false,
    purchase_carton_colors: product.purchase_carton_colors,
  }));
  const alerts = buildPurchaseAlertsFromRows(rows);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].purchase_composition_valid, true);
  assert.equal(alerts[0].suggested_total_pieces, 15);
  const items = buildPurchaseAlertDraftItems(alerts[0]);
  assert.equal(items.length, 15);
  assert.ok(items.every((item) => item.variant_id && item.quantity === 1));
});

test("INDIVIDUAL keeps the legacy purchase-alert UX and draft behavior", () => {
  const product = { id: 31, name: "Individual MEN", purchase_mode: "INDIVIDUAL", purchase_size_group: "MEN", purchase_alerts_enabled: true, purchase_alert_by_color: true };
  const lowStockVariants = withTriggerStock(variantsFor(31, ["Black"], SIZE_GROUPS.MEN.sizes), "Black", "43", 2);
  assert.deepEqual(buildPurchaseAlertsFromRows(alertRows(product, lowStockVariants)), []);

  const variants = withTriggerStock(variantsFor(31, ["Black"], SIZE_GROUPS.MEN.sizes));
  const alerts = buildPurchaseAlertsFromRows(alertRows(product, variants));
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].purchase_pattern_alert_aware, false);
  assert.equal(alerts[0].scope_key, "31:color:black");
  assert.deepEqual(alerts[0].missing_sizes, ["43"]);
  const draftItems = buildPurchaseAlertDraftItems(alerts[0]);
  assert.equal(draftItems.length, 1);
  assert.equal(draftItems[0].variant_id, null);
  assert.equal(draftItems[0].quantity, 1);
  assert.equal(draftItems[0].size, "");
  assert.equal(draftItems[0].metadata.alert_scope, "product_color");
});

test("FULL_COLOR_RUN aggregates by product+color and displays the full run, never the trigger size only", () => {
  for (const pieces of [1, 2]) {
    const product = {
      id: 32,
      name: "Black run",
      purchase_mode: "FULL_COLOR_RUN",
      purchase_size_group: "MEN",
      purchase_pieces_per_size: pieces,
      purchase_alerts_enabled: true,
      purchase_alert_by_color: false,
    };
    const variants = withTriggerStock(variantsFor(32, ["Black"], SIZE_GROUPS.MEN.sizes));
    const alerts = buildPurchaseAlertsFromRows(alertRows(product, variants));
    assert.equal(alerts.length, 1);
    const alert = alerts[0];
    assert.equal(alert.scope_key, "32:color:black");
    assert.equal(alert.purchase_suggestion.unit, "FULL_COLOR_RUN");
    assert.deepEqual(alert.purchase_suggestion.sizes, SIZE_GROUPS.MEN.sizes);
    assert.equal(alert.purchase_suggestion.lines.length, 5);
    assert.equal(alert.purchase_suggestion.total_units, 5 * pieces);
    assert.deepEqual(alert.trigger_variants.map((row) => row.size), ["43"]);
    assert.notDeepEqual(alert.purchase_suggestion.sizes, alert.trigger_variants.map((row) => row.size));
  }
});

test("FULL_CARTON is one model alert for 3x5 and displayed composition exactly equals its draft", () => {
  for (const pieces of [1, 2]) {
    const product = cartonProduct({
      id: 33,
      product_id: 33,
      name: "Carton MEN",
      purchase_pieces_per_size: pieces,
      purchase_alerts_enabled: true,
      purchase_alert_by_color: true,
    });
    const variants = withTriggerStock(variantsFor(33, ["Black", "White", "Navy"], SIZE_GROUPS.MEN.sizes), "Black", "43", 2);
    const alerts = buildPurchaseAlertsFromRows(alertRows(product, variants));
    assert.equal(alerts.length, 1);
    const alert = alerts[0];
    assert.equal(alert.scope_key, "33:model");
    assert.equal(alert.purchase_suggestion.unit, "FULL_CARTON");
    assert.deepEqual(alert.purchase_suggestion.colors, ["Black", "White", "Navy"]);
    assert.deepEqual(alert.purchase_suggestion.sizes, SIZE_GROUPS.MEN.sizes);
    assert.equal(alert.purchase_suggestion.lines.length, 15);
    assert.equal(alert.purchase_suggestion.total_units, 15 * pieces);
    assert.deepEqual(alert.trigger_variants.map((row) => `${row.color}/${row.size}`), ["Black/43"]);
    assert.equal(alert.trigger_variants[0].reason_code, "low_stock");
    const draftItems = buildPurchaseAlertDraftItems(alert);
    assert.deepEqual(lineSignature(draftItems), lineSignature(alert.purchase_suggestion.lines));
    assert.equal(draftItems.reduce((sum, item) => sum + item.quantity, 0), alert.purchase_suggestion.total_units);
  }
});

test("missing Navy / 45 hard-fails the whole composition and Smart Reorder draft", () => {
  const product = cartonProduct();
  const variants = variantsFor(1, ["Black", "White", "Navy"], SIZE_GROUPS.MEN.sizes, { missing: { color: "Navy", size: "45" } })
    .map((variant) => ({ ...product, ...variant, product_name: product.name, purchase_pack_qty: 15, reorder_trigger_percent: 70 }));
  const composition = buildPurchaseComposition({ product, variants });
  assert.equal(composition.valid, false);
  assert.deepEqual(composition.lines, []);
  assert.match(composition.errors[0].message, /Missing variant: Navy \/ 45/);

  const salesRows = variants.map((variant) => ({ variant_id: variant.variant_id, sold_qty: 2 }));
  const suggestions = buildSuggestions({ variantsRows: variants, salesRows });
  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].purchase_pattern_valid, false);
  assert.deepEqual(suggestions[0].suggested_lines, []);
  assert.throws(() => buildReorderDraftLines(suggestions), (error) => error.status === 409 && /Navy \/ 45/.test(error.message));
});

test("legacy purchase_mode NULL keeps the pre-pattern fallback", () => {
  const variants = variantsFor(9, ["Black"], ["41", "42"], { stock: 0 }).map((variant) => ({
    ...variant,
    product_name: "Legacy",
    purchase_mode: null,
    purchase_pack_qty: 2,
    reorder_trigger_percent: 40,
  }));
  const suggestions = buildSuggestions({ variantsRows: variants, salesRows: variants.map((row) => ({ variant_id: row.variant_id, sold_qty: 3 })) });
  assert.equal(suggestions[0].purchase_pattern_configured, false);
  assert.ok(suggestions[0].suggested_lines.length > 0);
  assert.ok(buildReorderDraftLines(suggestions).length > 0);
});

test("legacy NULL purchase alerts preserve the exact pre-pattern trigger, scope, data and draft", () => {
  const product = {
    id: 34,
    name: "Legacy alert",
    purchase_mode: null,
    purchase_alerts_enabled: true,
    purchase_alert_by_color: false,
    suggested_purchase_cartons: 2,
  };
  const lowStockOnly = withTriggerStock(variantsFor(34, ["Black"], SIZE_GROUPS.MEN.sizes), "Black", "43", 2);
  assert.deepEqual(buildPurchaseAlertsFromRows(alertRows(product, lowStockOnly)), []);

  const variants = withTriggerStock(variantsFor(34, ["Black"], SIZE_GROUPS.MEN.sizes));
  const alerts = buildPurchaseAlertsFromRows(alertRows(product, variants));
  assert.equal(alerts.length, 1);
  const alert = alerts[0];
  assert.deepEqual({
    product_id: alert.product_id,
    product_name: alert.product_name,
    color: alert.color,
    purchase_alert_by_color: alert.purchase_alert_by_color,
    alert_type: alert.alert_type,
    alert_title: alert.alert_title,
    alert_reason: alert.alert_reason,
    missing_sizes: alert.missing_sizes,
    total_stock: alert.total_stock,
    carton_size: alert.carton_size,
    suggested_purchase_cartons: alert.suggested_purchase_cartons,
    scope_key: alert.scope_key,
    scope_label: alert.scope_label,
  }, {
    product_id: 34,
    product_name: "Legacy alert",
    color: "",
    purchase_alert_by_color: false,
    alert_type: "missing_sizes",
    alert_title: "مقاسات ناقصة",
    alert_reason: "بعض المقاسات غير مكتملة",
    missing_sizes: ["43"],
    total_stock: 12,
    carton_size: null,
    suggested_purchase_cartons: 2,
    scope_key: "34:model",
    scope_label: "Legacy alert",
  });
  assert.equal(alert.purchase_pattern_configured, false);
  assert.equal(alert.purchase_pattern_alert_aware, false);

  const draftItems = buildPurchaseAlertDraftItems(alert);
  assert.equal(draftItems.length, 1);
  assert.deepEqual({
    product_id: draftItems[0].product_id,
    variant_id: draftItems[0].variant_id,
    quantity: draftItems[0].quantity,
    color: draftItems[0].color,
    size: draftItems[0].size,
    alert_scope: draftItems[0].metadata.alert_scope,
    scope_key: draftItems[0].metadata.scope_key,
    missing_sizes: draftItems[0].metadata.missing_sizes,
  }, {
    product_id: 34,
    variant_id: null,
    quantity: 2,
    color: "",
    size: "",
    alert_scope: "product_model",
    scope_key: "34:model",
    missing_sizes: ["43"],
  });
});

test("receiving a carton updates 15 real variants and creates no synthetic carton variant", () => {
  const variants = variantsFor(1, ["Black", "White", "Navy"], SIZE_GROUPS.MEN.sizes);
  const composition = buildPurchaseComposition({ product: cartonProduct(), variants });
  const stock = new Map(variants.map((variant) => [variant.variant_id, 0]));
  for (const line of composition.lines) stock.set(line.variant_id, stock.get(line.variant_id) + line.quantity);
  assert.equal(stock.size, 15);
  assert.equal([...stock.values()].reduce((sum, value) => sum + value, 0), 15);
  assert.ok(composition.lines.every((line) => variants.some((variant) => variant.variant_id === line.variant_id)));
});

test("required accounting failure is rethrown after savepoint rollback", async () => {
  const queries = [];
  const client = { query: async (sql) => { queries.push(sql); return { rows: [] }; } };
  await assert.rejects(
    runRequiredPurchaseAccounting(client, async () => { throw new Error("injected accounting failure"); }),
    /injected accounting failure/
  );
  assert.deepEqual(queries, ["SAVEPOINT purchase_accounting_entry", "ROLLBACK TO SAVEPOINT purchase_accounting_entry"]);
});

test("Smart Reorder processing remains near-linear at 7,500 variants", () => {
  const variantsRows = [];
  const salesRows = [];
  for (let productId = 1; productId <= 1500; productId += 1) {
    for (let size = 41; size <= 45; size += 1) {
      const variant_id = productId * 100 + size;
      variantsRows.push({ variant_id, product_id: productId, color: "Black", size: String(size), stock: 0, purchase_pack_qty: 5, reorder_trigger_percent: 40 });
      salesRows.push({ variant_id, sold_qty: 1 });
    }
  }
  const started = performance.now();
  const suggestions = buildSuggestions({ variantsRows, salesRows });
  const durationMs = performance.now() - started;
  assert.equal(suggestions.length, 1500);
  assert.ok(durationMs < 1000, `7,500 variants took ${durationMs.toFixed(1)}ms`);
});

test("migration is additive and runtime Purchase Pattern schema mutation is absent", async () => {
  const migration = await readFile(new URL("../../SQL/product_purchase_patterns.sql", import.meta.url), "utf8");
  const multiGroupMigration = await readFile(new URL("../../SQL/product_purchase_multi_size_groups.sql", import.meta.url), "utf8");
  const runtimeSources = await Promise.all([
    "../../server/controllers/productsController.js",
    "../../server/controllers/inventoryController.js",
    "../../server/services/smartReorderService.js",
    "../../server/routes/purchases.js",
  ].map((path) => readFile(new URL(path, import.meta.url), "utf8")));
  assert.doesNotMatch(migration, /DROP\s+CONSTRAINT/i);
  assert.match(migration, /purchase_mode\s+VARCHAR\(30\)\s+NULL/i);
  assert.match(migration, /purchase_size_groups\s+JSONB\s+NULL/i);
  assert.match(multiGroupMigration, /ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+purchase_size_groups\s+JSONB\s+NULL/i);
  assert.doesNotMatch(multiGroupMigration, /UPDATE\s+public\.products|DROP\s+COLUMN|DROP\s+CONSTRAINT/i);
  assert.match(migration, /NOT VALID/i);
  for (const source of runtimeSources) {
    assert.doesNotMatch(source, /ALTER\s+TABLE[\s\S]{0,240}purchase_(?:mode|size_group|colors_per_carton|pieces_per_size|carton_colors)/i);
  }
  const inventorySource = runtimeSources[1];
  const purchasesSource = runtimeSources[3];
  assert.match(inventorySource, /pg_advisory_xact_lock\(hashtext\(\$1\)\)/);
  assert.match(inventorySource, /metadata->>'trigger_fingerprint'/);
  assert.match(purchasesSource, /const triggerFingerprint = `smart-reorder:/);
  assert.match(purchasesSource, /metadata->>'trigger_fingerprint'/);
  assert.match(purchasesSource, /await client\.query\("ROLLBACK"\)/);
  assert.match(purchasesSource, /runRequiredPurchaseAccounting/);
});
