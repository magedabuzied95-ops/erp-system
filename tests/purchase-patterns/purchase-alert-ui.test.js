import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildPurchaseAlertDraftItems } from "../../server/controllers/inventoryController.js";
import {
  getGroupedPurchaseAlertPresentation,
  getUserFacingTriggerVariants,
  shouldShowSizeLevelAlertDetails,
} from "../../src/modules/inventory/lib/purchaseAlertPresentation.js";

const makeSuggestion = (unit, overrides = {}) => ({
  unit,
  mode_label_ar: unit === "FULL_CARTON" ? "شراء كرتونة كاملة" : "شراء لون كامل",
  color: unit === "FULL_CARTON" ? "" : "D.Gray",
  colors: unit === "FULL_CARTON" ? ["Black", "White", "Navy"] : ["D.Gray"],
  sizes: ["41", "42", "43", "44", "45"],
  total_units: unit === "FULL_CARTON" ? 15 : 10,
  lines: [],
  trigger_variants: [
    { variant_id: 1, color: "D.Gray", size: "41", reason_code: "out_of_stock" },
    { variant_id: 2, color: "D.Gray", size: "42", reason_code: "low_stock" },
  ],
  ...overrides,
});

test("FULL_COLOR_RUN exposes one compact purchase composition and no size-level alert details", () => {
  const alert = {
    purchase_mode: "FULL_COLOR_RUN",
    missing_sizes: ["41", "42", "43", "44", "45"],
    purchase_suggestion: makeSuggestion("FULL_COLOR_RUN"),
  };

  assert.equal(shouldShowSizeLevelAlertDetails(alert), false);
  assert.deepEqual(getUserFacingTriggerVariants(alert), []);
  assert.deepEqual(getGroupedPurchaseAlertPresentation(alert), {
    mode: "FULL_COLOR_RUN",
    modeLabel: "شراء لون كامل",
    color: "D.Gray",
    colorCount: 1,
    sizeRange: "41–45",
    totalUnits: 10,
    reasonKey: "fullColorRunSummary",
  });
});

test("FULL_CARTON exposes one model-level summary and no color/size trigger spam", () => {
  const alert = {
    purchase_mode: "FULL_CARTON",
    missing_sizes: ["41", "42", "43", "44", "45"],
    purchase_suggestion: makeSuggestion("FULL_CARTON"),
  };

  assert.equal(shouldShowSizeLevelAlertDetails(alert), false);
  assert.deepEqual(getUserFacingTriggerVariants(alert), []);
  assert.deepEqual(getGroupedPurchaseAlertPresentation(alert), {
    mode: "FULL_CARTON",
    modeLabel: "شراء كرتونة كاملة",
    color: "Black",
    colorCount: 3,
    sizeRange: "41–45",
    totalUnits: 15,
    reasonKey: "fullCartonSummary",
  });
});

test("Legacy NULL and INDIVIDUAL keep the existing size-level UX and trigger details", () => {
  for (const purchaseMode of [null, "INDIVIDUAL"]) {
    const alert = {
      purchase_mode: purchaseMode,
      missing_sizes: ["41"],
      purchase_suggestion: makeSuggestion("INDIVIDUAL_SIZE"),
    };
    assert.equal(shouldShowSizeLevelAlertDetails(alert), true);
    assert.deepEqual(getUserFacingTriggerVariants(alert), alert.purchase_suggestion.trigger_variants);
    assert.equal(getGroupedPurchaseAlertPresentation(alert), null);
  }
});

test("Inventory cards gate the old missing-size section through purchase_mode presentation", () => {
  const dashboardSource = fs.readFileSync("src/modules/inventory/pages/InventoryDashboard.jsx", "utf8");
  const summarySource = fs.readFileSync("src/modules/inventory/components/PurchaseAlertPatternSummary.jsx", "utf8");
  assert.match(dashboardSource, /shouldShowSizeLevelAlertDetails\(alert\).*alert\.missing_sizes/);
  assert.match(dashboardSource, /groupedPresentation\?\.modeLabel \|\| alert\.alert_title/);
  assert.match(dashboardSource, /!groupedPresentation \? <p[^>]*>\{alert\.alert_reason\}/);
  assert.match(summarySource, /getUserFacingTriggerVariants\(alert\)/);
  assert.match(summarySource, /groupedPresentation\.sizeRange/);
  assert.match(summarySource, /sizesPerColor/);
  assert.match(summarySource, /fullCartonSummary|reasonKey/);
});

test("presentation cleanup does not mutate purchase_suggestion.lines or draft composition", () => {
  const compositionLines = [
    { variant_id: 101, color: "D.Gray", size: "41", quantity: 2, last_purchase_cost: 100 },
    { variant_id: 102, color: "D.Gray", size: "42", quantity: 2, last_purchase_cost: 100 },
  ];
  const alert = {
    product_id: 7,
    product_name: "Run",
    purchase_mode: "FULL_COLOR_RUN",
    purchase_pattern_alert_aware: true,
    purchase_composition_valid: true,
    purchase_size_group: "MEN",
    pieces_per_size: 2,
    expected_total_pieces: 10,
    composition_lines: structuredClone(compositionLines),
    purchase_suggestion: makeSuggestion("FULL_COLOR_RUN", { lines: structuredClone(compositionLines) }),
  };
  const suggestionLinesBefore = structuredClone(alert.purchase_suggestion.lines);
  const draftBefore = buildPurchaseAlertDraftItems(alert);

  getGroupedPurchaseAlertPresentation(alert);
  getUserFacingTriggerVariants(alert);

  assert.deepEqual(alert.purchase_suggestion.lines, suggestionLinesBefore);
  assert.deepEqual(alert.composition_lines, compositionLines);
  assert.deepEqual(buildPurchaseAlertDraftItems(alert), draftBefore);
});
