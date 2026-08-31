import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(
  new URL("../src/modules/orders/pages/OrdersDashboard.jsx", import.meta.url),
  "utf8"
);

const dashboard = source.slice(
  source.indexOf("function OrdersDashboard"),
  source.indexOf("function BulkActions")
);

const filters = source.slice(
  source.indexOf("function Filters"),
  source.indexOf("function TableView")
);

test("the date filter is read on the shop clock, not on the UTC day", () => {
  // `String(order.created_at).slice(0, 10)` takes the UTC day, so an order placed
  // after Cairo midnight was filed under the previous day and "today" silently
  // lost the first hours of trading.
  assert.match(source, /instantToWallClock/);
  assert.match(source, /const orderDayKey[\s\S]{0,400}instantToWallClock\(raw\)/);
  assert.doesNotMatch(
    dashboard,
    /String\(order\.created_at[^)]*\)\.slice\(0,\s*10\)/,
    "the filter must not compare raw ISO days"
  );
});

test("a date range is filtered inclusively on both ends", () => {
  assert.match(source, /const matchesDateRange[\s\S]{0,400}if \(from && day < from\) return false;/);
  assert.match(source, /const matchesDateRange[\s\S]{0,400}if \(to && day > to\) return false;/);
  assert.match(dashboard, /matchesDateRange\(order, dateFrom, dateTo\)/);
});

test("every date preset resolves to a from/to pair", () => {
  const presets = source.slice(source.indexOf("const DATE_PRESETS"), source.indexOf("const activeDatePresetKey"));
  for (const key of ["today", "yesterday", "last7", "last30", "thisMonth"]) {
    assert.match(presets, new RegExp(`key: "${key}"[\\s\\S]{0,200}?resolve: \\(\\) => \\(\\{ from:[\\s\\S]{0,120}?to:`));
  }
});

test("applied filters are all reversible from one place", () => {
  // Every filter the page can apply must contribute a removable token, or a
  // filter can be on with nothing on screen saying so.
  for (const key of ["search", "status", "payment", "channel", "branch", "date"]) {
    assert.match(dashboard, new RegExp(`chips\\.push\\(\\{\\s*key: "${key}"`), `${key} has no active-filter chip`);
  }
  assert.match(dashboard, /const resetFilters = useCallback/);
  assert.match(filters, /onResetFilters/);
  assert.match(filters, /orders\.filters\.clearAll/);
});

test("resetFilters clears every filter the page owns", () => {
  const reset = dashboard.slice(dashboard.indexOf("const resetFilters"), dashboard.indexOf("const activeFilters"));
  for (const setter of ["setSearch", "setStatusFilter", "setPaymentFilter", "setChannelFilter", "setBranchFilter", "setDateFrom", "setDateTo"]) {
    assert.match(reset, new RegExp(`${setter}\\(`), `${setter} is not reset`);
  }
});

test("the branch filter only appears when there is more than one branch", () => {
  assert.match(filters, /branchOptions\.length > 2 \?/);
});

test("the header reports the filtered count against the whole list", () => {
  assert.match(dashboard, /orders\.header\.showing[\s\S]{0,160}filteredOrders\.length[\s\S]{0,60}orders\.length/);
});
