import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { buildInClause, normalizeAdminListFilterValues } from "../server/lib/productFilterValues.js";
import { MULTI_SELECT_FILTER_KEYS, buildPickerParams, pickerQueryKey } from "../src/modules/aiSupport/services/pickerQuery.js";

// Completes the picker's filter parity. be9308f pushed filters server-side but
// only a SINGLE brand/manufacturer, because the endpoint took one value —
// selecting two brands fell back to filtering the current 24-row page.
// Semantics: OR within one filter, AND between filters.

const picker = fs.readFileSync(new URL("../src/modules/aiSupport/components/ProductCardPicker.jsx", import.meta.url), "utf8");
const controller = fs.readFileSync(new URL("../server/controllers/productsController.js", import.meta.url), "utf8");

// ---- value normalisation -------------------------------------------------

test("a multi-selection survives as a list instead of stringifying to \"A,B\"", () => {
  assert.deepEqual(normalizeAdminListFilterValues(["Nike", "Adidas"]), ["Nike", "Adidas"]);
  // the old single-value path did String(["Nike","Adidas"]) === "Nike,Adidas"
  assert.notEqual(normalizeAdminListFilterValues(["Nike", "Adidas"])[0], "Nike,Adidas");
});

test("a single value and a one-element array behave identically", () => {
  assert.deepEqual(normalizeAdminListFilterValues("Nike"), ["Nike"]);
  assert.deepEqual(normalizeAdminListFilterValues(["Nike"]), ["Nike"]);
});

test('blanks and the "all" sentinel are dropped', () => {
  assert.deepEqual(normalizeAdminListFilterValues(["Nike", "", "  ", "all", "ALL"]), ["Nike"]);
  assert.deepEqual(normalizeAdminListFilterValues([]), []);
  assert.deepEqual(normalizeAdminListFilterValues(undefined), []);
});

test("duplicates collapse case-insensitively but keep the original casing", () => {
  assert.deepEqual(normalizeAdminListFilterValues(["Nike", "nike", "NIKE", "Adidas"]), ["Nike", "Adidas"]);
});

// ---- SQL shape -----------------------------------------------------------

test("one value still produces the exact single-value SQL (no behaviour change)", () => {
  const values = [];
  const sql = buildInClause("expr", ["Nike"], values);
  assert.equal(sql, "expr = $1");
  assert.deepEqual(values, ["Nike"]);
});

test("several values produce an IN list — OR within the filter", () => {
  const values = [];
  const sql = buildInClause("expr", ["Nike", "Adidas", "Puma"], values);
  assert.equal(sql, "expr IN ($1, $2, $3)");
  assert.deepEqual(values, ["Nike", "Adidas", "Puma"]);
});

test("placeholders continue from existing bound values", () => {
  const values = ["already", "bound"];
  assert.equal(buildInClause("expr", ["Nike", "Adidas"], values), "expr IN ($3, $4)");
  assert.deepEqual(values, ["already", "bound", "Nike", "Adidas"]);
});

test("an empty selection contributes no SQL at all", () => {
  const values = [];
  assert.equal(buildInClause("expr", [], values), "");
  assert.deepEqual(values, []);
});

test("values are always bound as parameters, never interpolated", () => {
  const values = [];
  const sql = buildInClause("expr", ["Nike'; DROP TABLE products;--", "Adidas"], values);
  assert.equal(sql, "expr IN ($1, $2)");
  assert.ok(!sql.includes("DROP TABLE"));
  assert.equal(values[0], "Nike'; DROP TABLE products;--");
});

// ---- AND between filter groups ------------------------------------------

test("filter groups are ANDed while each group ORs internally", () => {
  const values = [];
  const brand = buildInClause("brand_expr", normalizeAdminListFilterValues(["Nike", "Adidas"]), values);
  const manufacturer = buildInClause("mfr_expr", normalizeAdminListFilterValues(["Acme"]), values);
  assert.equal(brand, "brand_expr IN ($1, $2)");
  assert.equal(manufacturer, "mfr_expr = $3");
  // the controller joins parts with AND
  assert.match(controller, /sql: parts\.join\("\\nAND "\)/);
});

test("the controller wires brand, manufacturer and category through the list helper", () => {
  for (const [key, expr] of [["brand", "b.name"], ["manufacturer", "m.name"], ["category", "c.name"]]) {
    assert.match(controller, new RegExp(`const ${key}Values = normalizeAdminListFilterValues\\(filters\\.${key}\\)`));
    assert.ok(controller.includes(`buildInClause(\`COALESCE(NULLIF(TRIM(${expr}), '')`), `${key} must use the IN helper`);
  }
});

test("the endpoint also reads the bracketed key so a parser change cannot drop it", () => {
  assert.match(controller, /brand: req\.query\.brand \?\? req\.query\["brand\[\]"\]/);
  assert.match(controller, /manufacturer: req\.query\.manufacturer \?\? req\.query\["manufacturer\[\]"\]/);
});

// ---- request params ------------------------------------------------------

test("multiple brands are sent as an array", () => {
  const params = buildPickerParams({ filters: { brand: ["Nike", "Adidas"] } });
  assert.deepEqual(params.brand, ["Nike", "Adidas"]);
});

test("multiple manufacturers are sent as an array", () => {
  const params = buildPickerParams({ filters: { manufacturer: ["Acme", "Globex"] } });
  assert.deepEqual(params.manufacturer, ["Acme", "Globex"]);
});

test("a single selection is still a scalar — unchanged request shape", () => {
  assert.equal(buildPickerParams({ filters: { brand: ["Nike"] } }).brand, "Nike");
  assert.equal(buildPickerParams({ filters: { brand: "Nike" } }).brand, "Nike");
});

test("brand + manufacturer multi-selects combine in ONE request", () => {
  const params = buildPickerParams({ filters: { brand: ["Nike", "Adidas"], manufacturer: ["Acme", "Globex"] } });
  assert.deepEqual(params.brand, ["Nike", "Adidas"]);
  assert.deepEqual(params.manufacturer, ["Acme", "Globex"]);
});

test("multi-selects combine with size, colour, gender, type, grade and search", () => {
  const params = buildPickerParams({
    search: "runner",
    filters: {
      brand: ["Nike", "Adidas"],
      manufacturer: ["Acme", "Globex"],
      size: "42",
      color: "Black",
      gender: "men",
      product_type: "shoes",
      grade: "A",
      inStockOnly: true,
    },
  });
  assert.deepEqual(params.brand, ["Nike", "Adidas"]);
  assert.deepEqual(params.manufacturer, ["Acme", "Globex"]);
  assert.equal(params.size, "42");
  assert.equal(params.color, "Black");
  assert.equal(params.gender, "men");
  assert.equal(params.product_type, "shoes");
  assert.equal(params.grade, "A");
  assert.equal(params.search, "runner");
  assert.equal(params.inStockOnly, 1);
  assert.equal(params.limit, 24, "pagination is untouched");
  assert.equal(params.page, 1);
});

test("only brand and manufacturer are multi-valued", () => {
  assert.deepEqual(MULTI_SELECT_FILTER_KEYS, ["brand", "manufacturer"]);
  // a stray array on a single-valued filter collapses to its first value
  assert.equal(buildPickerParams({ filters: { size: ["42", "43"] } }).size, "42");
});

test("duplicate selections do not bloat the query", () => {
  assert.deepEqual(buildPickerParams({ filters: { brand: ["Nike", "nike", "Adidas"] } }).brand, ["Nike", "Adidas"]);
});

// ---- cache isolation -----------------------------------------------------

test("different multi-selections never share a cache entry", () => {
  const nike = pickerQueryKey(buildPickerParams({ filters: { brand: ["Nike"] } }));
  const both = pickerQueryKey(buildPickerParams({ filters: { brand: ["Nike", "Adidas"] } }));
  const other = pickerQueryKey(buildPickerParams({ filters: { brand: ["Puma", "Adidas"] } }));
  assert.notEqual(nike, both);
  assert.notEqual(both, other);
});

test("a multi-select page is never served as unfiltered", () => {
  assert.notEqual(
    pickerQueryKey(buildPickerParams({})),
    pickerQueryKey(buildPickerParams({ filters: { brand: ["Nike", "Adidas"] } }))
  );
});

// ---- picker wiring + untouched guarantees --------------------------------

test("the picker sends the whole brand/manufacturer selection", () => {
  assert.match(picker, /brand: selectedList\(brand\)/);
  assert.match(picker, /manufacturer: selectedList\(manufacturer\)/);
  assert.doesNotMatch(picker, /brand: singleValue\(brand\)/);
  assert.doesNotMatch(picker, /manufacturer: singleValue\(manufacturer\)/);
});

test("pagination, page size and the load-more guard are unchanged", () => {
  assert.match(picker, /searchCustomerProducts\(\{ search: term, filters: serverFilters, page: 1, limit: PICKER_PAGE_SIZE/);
  assert.match(picker, /if \(sizeMode \|\| loadingMore \|\| !hasMoreResults\) return;/);
});

test("the pricing/stock pipeline is still the shared one", () => {
  const service = fs.readFileSync(new URL("../src/modules/aiSupport/services/customerProductCatalog.js", import.meta.url), "utf8");
  assert.match(service, /normalizePosSellableProducts\(rows, saleModeSettings\)\.map\(\(product\) => normalizePosCatalogProduct\(product\)\)/);
});
