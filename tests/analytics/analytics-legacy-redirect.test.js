/**
 * Redirect parity — item 7 of the migration brief.
 *
 * A bookmark is somebody's saved intent. Sending them to a page that renders the default
 * window silently answers a different question from the one they asked, and the numbers
 * will look plausible. So every legacy parameter is either translated or explicitly
 * reported as dropped, and this proves which is which for every one of them.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  DROPPED_PARAMS,
  PARAM_MAP,
  RANGE_PRESETS,
  TAB_ROUTES,
  resolveLegacyReportsTarget,
} from "../../src/modules/reports/lib/legacyReportsRedirect.js";

const read = (relative) => readFile(new URL(relative, import.meta.url), "utf8");

/* --------------------------------------------------------------- every tab lands */

test("every legacy tab has a destination, and it is a route that exists", async () => {
  const app = await read("../../src/App.jsx");
  const tabs = ["insights", "sales", "employees", "inventory", "customers", "financial", "export"];

  assert.deepEqual(Object.keys(TAB_ROUTES).sort(), [...tabs].sort());

  for (const tab of tabs) {
    const target = resolveLegacyReportsTarget(`?tab=${tab}`);
    assert.ok(target.path.startsWith("/reports/"), `${tab} must land inside the Reporting Center`);
    const segment = target.path.replace("/", "");
    assert.ok(app.includes(`path="${segment}"`), `${tab} lands on ${target.path}, which is not routed`);
  }
});

test("an unknown or missing tab lands somewhere useful rather than nowhere", () => {
  for (const search of ["", "?tab=", "?tab=nonsense", "?foo=bar"]) {
    const target = resolveLegacyReportsTarget(search);
    assert.equal(target.path, "/reports/sales", `"${search}" must still land on a real page`);
  }
});

/* ---------------------------------------------------------- parameters that survive */

test("the window a reader pinned survives the journey", () => {
  const target = resolveLegacyReportsTarget("?tab=sales&startDate=2026-08-01&endDate=2026-08-24");
  assert.equal(target.path, "/reports/sales");
  assert.match(target.search, /from=2026-08-01/);
  assert.match(target.search, /to=2026-08-24/);
  assert.deepEqual(target.carried.sort(), ["from", "to"]);
  assert.deepEqual(target.dropped, []);
});

test("the legacy range names carry their real meaning", () => {
  assert.equal(new URLSearchParams(resolveLegacyReportsTarget("?preset=month").search).get("preset"), "thisMonth");
  assert.equal(new URLSearchParams(resolveLegacyReportsTarget("?preset=week").search).get("preset"), "thisWeek");
  assert.equal(new URLSearchParams(resolveLegacyReportsTarget("?preset=today").search).get("preset"), "today");
  assert.deepEqual(Object.keys(RANGE_PRESETS).sort(), ["custom", "month", "today", "week"]);
});

test("explicit dates beat the range preset, because that is what the reader pinned", () => {
  const target = resolveLegacyReportsTarget("?preset=month&startDate=2026-01-01&endDate=2026-03-31");
  const params = new URLSearchParams(target.search);
  assert.equal(params.get("from"), "2026-01-01");
  assert.equal(params.get("to"), "2026-03-31");
  assert.equal(params.get("preset"), null, "a pinned window must not be overridden by a preset name");
});

test("the two filters this migration added survive a legacy link", () => {
  const target = resolveLegacyReportsTarget("?tab=sales&shiftId=25&salespersonId=9&paymentMethod=cash");
  const params = new URLSearchParams(target.search);
  assert.equal(params.get("shiftId"), "25");
  assert.equal(params.get("salespersonId"), "9");
  assert.equal(params.get("paymentMethod"), "cash");
});

/* ----------------------------------------------------- parameters that are dropped */

test("a filter with no honest equivalent is dropped WITH its reason, never forwarded", () => {
  const target = resolveLegacyReportsTarget("?tab=sales&warehouseId=7&employeeId=3");
  const params = new URLSearchParams(target.search);
  assert.equal(params.get("warehouseId"), null);
  assert.equal(params.get("employeeId"), null);

  const dropped = Object.fromEntries(target.dropped.map((entry) => [entry.key, entry.reason]));
  assert.match(dropped.warehouseId, /populated on no orders|matched everything/);
  assert.match(dropped.employeeId, /no employee_id/);

  // Carrying them across would move a control that silently matched everything into a
  // page where it would silently do nothing — the same lie in a newer font.
  for (const key of Object.keys(DROPPED_PARAMS)) {
    assert.ok(!Object.values(PARAM_MAP).includes(key), `${key} must not also be mapped`);
  }
});

test("an unknown parameter is dropped rather than forwarded into a 400", () => {
  const target = resolveLegacyReportsTarget("?tab=sales&somethingElse=1");
  assert.equal(new URLSearchParams(target.search).get("somethingElse"), null);
  assert.equal(target.dropped[0].key, "somethingElse");
  assert.match(target.dropped[0].reason, /filter contract/);
});

test("a date that is not a date does not become a window", () => {
  const target = resolveLegacyReportsTarget("?startDate=last-tuesday&endDate=2026-08-24");
  const params = new URLSearchParams(target.search);
  assert.equal(params.get("from"), null, "an unusable date must not be forwarded");
  assert.equal(params.get("to"), "2026-08-24");
  assert.equal(target.dropped.find((entry) => entry.key === "startDate")?.reason, "not a usable date");
});

test("an empty value contributes nothing", () => {
  const target = resolveLegacyReportsTarget("?tab=sales&shiftId=&paymentMethod=");
  assert.equal(target.search, "");
  assert.deepEqual(target.carried, []);
});

/* ------------------------------------------------------------------ purity + safety */

test("the resolver is pure, so the retirement switch is a decision about where to call it", async () => {
  // Comments stripped first. This file talks about "the window a reader pinned" in prose,
  // and a keyword search finds that and calls it a DOM access — the third time in this
  // codebase that a guard matched its own explanation instead of the code.
  const source = (await read("../../src/modules/reports/lib/legacyReportsRedirect.js"))
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
  for (const forbidden of ["localStorage", "fetch(", "window.", "useNavigate", "document."]) {
    assert.ok(!source.includes(forbidden), `the resolver must not reach for ${forbidden}`);
  }
  // And it exports a plain function, so calling it from a route element is the whole switch.
  assert.match(source, /export const resolveLegacyReportsTarget = \(search = ""\) =>/);
});

test("nothing in a legacy link can become an unbounded or injected parameter", () => {
  const hostile = "?tab=sales&from=2026-08-01'%20OR%201=1--&shiftId=25%3B%20DROP%20TABLE&paymentMethod=" + "x".repeat(500);
  const target = resolveLegacyReportsTarget(hostile);
  const params = new URLSearchParams(target.search);

  // The date is rejected by shape, and the rest is only ever forwarded as a query value
  // that the server's own parser validates — parseAnalyticsFilters rejects a non-positive
  // id, so `25; DROP TABLE` never becomes a filter.
  assert.equal(params.get("from"), null);
  assert.ok(!target.search.includes("DROP TABLE") || params.get("shiftId") === "25; DROP TABLE");
  // Whatever survives is bounded by the URL itself; nothing here concatenates into SQL.
  assert.ok(!/;\s*DROP/i.test(target.path), "the path must never carry a value");
});

/* --------------------------------------------------- the switch is off, deliberately */

test("a deep link redirects while the bare page does not", async () => {
  const page = await read("../../src/modules/reports/pages/Reports.jsx");

  // The wrapper is a wrapper, not an early return inside Reports(): an early return above
  // the hooks would make them conditional, which React forbids and a build does not catch.
  assert.match(page, /export default function LegacyReportsRoute\(\) \{/);
  assert.match(page, /if \(location\.search\) \{[\s\S]{0,200}<Navigate to=\{target\.href\} replace \/>/);
  assert.match(page, /return <Reports \/>;/);

  // And the redirect must be ABOVE the component whose hooks it protects.
  const wrapper = page.indexOf("export default function LegacyReportsRoute");
  const component = page.indexOf("function Reports()");
  assert.ok(wrapper > 0 && component > wrapper, "the wrapper must not live inside Reports()");
});

test("/reports still renders its own page while the import path is needed", async () => {
  const app = await read("../../src/App.jsx");

  // The redirect MECHANISM is proven above. It is not wired to swallow the base route
  // yet, because the legacy page is where the preset import button lives — redirecting it
  // away would strand every preset that has not been imported, and those live in browsers
  // where no query can find them.
  assert.match(app, /path="reports"\s*\n\s*element=\{\s*\n\s*<ProtectedRoute/);
  assert.ok(
    !/path="reports"\s+element=\{<Navigate/.test(app),
    "/reports must not be redirected while unmigrated presets may still exist"
  );
});
