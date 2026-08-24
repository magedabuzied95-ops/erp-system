/**
 * The retirement verdict must not drift from the evidence.
 *
 * `docs/reports-retirement-readiness.md` now says LEGACY_REPORTS_READY_FOR_RETIREMENT.
 * That is only true while the four blockers really are closed IN THE CODE, so these tests
 * read the code and require the document to agree — in both directions. A verdict that
 * outlives the thing it was based on is worse than no verdict, because somebody will act
 * on it.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (relative) => readFile(new URL(relative, import.meta.url), "utf8");
const readiness = () => read("../docs/reports-retirement-readiness.md");

/** Each blocker, and the check that decides whether it is still open in the code. */
const BLOCKERS = [
  {
    id: "B-1",
    what: "filter parity",
    stillOpen: async () => {
      const bar = await read("../src/modules/reports/components/ReportFilterBar.jsx").catch(() => "");
      const filters = await read("../server/services/analytics/analyticsOrderFilters.js").catch(() => "");
      // The bar must exist AND the shared builder must be what every service uses.
      const wired = ["ExecutiveOverview", "SalesIntelligence", "InventoryIntelligence",
        "PurchasingIntelligence", "CustomerIntelligence", "EmployeeIntelligence"];
      let mounted = 0;
      for (const page of wired) {
        const source = await read(`../src/modules/reports/pages/${page}.jsx`).catch(() => "");
        if (source.includes("ReportFilterBar")) mounted += 1;
      }
      const open = !bar || !filters.includes("ORDER_FILTERS") || mounted < wired.length;
      return { open, detail: `bar: ${Boolean(bar)}, builder: ${filters.includes("ORDER_FILTERS")}, mounted on ${mounted}/${wired.length}` };
    },
  },
  {
    id: "B-2",
    what: "shiftId and salespersonId",
    stillOpen: async () => {
      const parse = await read("../server/services/analytics/analyticsFilters.js");
      const builder = await read("../server/services/analytics/analyticsOrderFilters.js").catch(() => "");
      const missing = ["shiftId", "salespersonId"].filter((key) => !parse.includes(key) || !builder.includes(key));
      return { open: missing.length > 0, detail: `missing: ${missing.join(", ") || "none"}` };
    },
  },
  {
    id: "B-3",
    what: "saved presets",
    stillOpen: async () => {
      const service = await read("../server/services/analytics/analyticsPresetsService.js").catch(() => "");
      const bar = await read("../src/modules/reports/components/PresetBar.jsx").catch(() => "");
      const open = !service.includes("report_presets") || !service.includes("importLegacyPresets") || !bar;
      return { open, detail: `service: ${Boolean(service)}, import: ${service.includes("importLegacyPresets")}, ui: ${Boolean(bar)}` };
    },
  },
  {
    id: "B-4",
    what: "column chooser",
    stillOpen: async () => {
      const hook = await read("../src/modules/reports/hooks/useColumnPreferences.js").catch(() => "");
      const chooser = await read("../src/modules/reports/components/ColumnChooser.jsx").catch(() => "");
      return { open: !hook || !chooser, detail: `hook: ${Boolean(hook)}, chooser: ${Boolean(chooser)}` };
    },
  },
];

test("the recommendation is one of the permitted values, stated once", async () => {
  const document = await readiness();
  const ready = /^#\s*LEGACY_REPORTS_READY_FOR_RETIREMENT\s*$/m.test(document);
  const notReady = /^#\s*NOT_READY_FOR_RETIREMENT\s*$/m.test(document);
  assert.ok(ready !== notReady, "exactly one recommendation heading must be present");
});

test("the verdict matches what the code actually provides", async () => {
  const document = await readiness();
  const ready = /^#\s*LEGACY_REPORTS_READY_FOR_RETIREMENT\s*$/m.test(document);

  const open = [];
  for (const blocker of BLOCKERS) {
    const result = await blocker.stillOpen();
    if (result.open) open.push(`${blocker.id} ${blocker.what} (${result.detail})`);
  }

  if (open.length) {
    assert.ok(!ready, `the document says READY, but these blockers are still open: ${open.join("; ")}`);
  } else {
    assert.ok(ready, "every blocker is closed in the code — the document must say so");
  }
});

test("the two filters with no honest equivalent are still refused", async () => {
  // If either of these ever becomes a real control, the readiness reasoning changes and
  // this document has to be rewritten rather than quietly inherited.
  const { ORDER_FILTER_KEYS, UNSUPPORTED_LEGACY_FILTERS } =
    await import("../server/services/analytics/analyticsOrderFilters.js");

  for (const key of ["warehouseId", "employeeId"]) {
    assert.ok(!ORDER_FILTER_KEYS.includes(key), `${key} must not be offered as a filter`);
    assert.ok(
      UNSUPPORTED_LEGACY_FILTERS.some((entry) => entry.key === key),
      `${key} must be declared unsupported with its reason`
    );
  }

  const document = await readiness();
  assert.match(document, /warehouseId/, "the document must name what was not reproduced");
  assert.match(document, /employeeId/);
});

test("data, export and permission parity are recorded with figures, not adjectives", async () => {
  const document = await readiness();
  for (const tab of ["B-1", "B-2", "B-3", "B-4"]) {
    assert.ok(document.includes(tab), `the assessment must account for ${tab}`);
  }
  for (const format of ["CSV", "Excel", "PDF", "print"]) {
    assert.ok(document.includes(format), `export parity must name ${format}`);
  }
  // No "looks equivalent" claims: the data section must carry actual numbers.
  assert.match(document, /691 080|691080/, "the legacy figure must be stated");
  assert.match(document, /687 650|687650/, "the replacement figure must be stated");
});

test("the bare route stays live while the import path is still needed", async () => {
  const app = await read("../src/App.jsx");
  const document = await readiness();

  if (/import button|import path is needed|migration window/.test(document)) {
    assert.match(app, /path="reports"\s*\n\s*element=\{\s*\n\s*<ProtectedRoute/, "/reports must remain routed");
    assert.ok(
      !/path="reports"\s+element=\{<Navigate/.test(app),
      "the bare /reports must not redirect while unmigrated presets may still exist"
    );

    // Deep links, however, must already redirect — that half of item 7 is done.
    const page = await read("../src/modules/reports/pages/Reports.jsx");
    assert.match(page, /export default function LegacyReportsRoute/);
    assert.match(page, /if \(location\.search\)/);
  }
});
