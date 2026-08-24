/**
 * The retirement verdict must not drift from the evidence.
 *
 * `docs/reports-retirement-readiness.md` says NOT_READY_FOR_RETIREMENT, and names four
 * blocking gaps: the legacy page has eleven filter controls where the Reporting Center has
 * one, two of its filters are not in the v2 allowlist at all, it saves presets to
 * localStorage that nothing else can read, and it has a column chooser.
 *
 * A verdict in a document is worth nothing if the code can change underneath it. These
 * tests read the CODE and require the document to agree: flipping the recommendation to
 * READY while any gap is still real fails here, and so does quietly deleting a gap from
 * the document while it still exists.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (relative) => readFile(new URL(relative, import.meta.url), "utf8");

const readiness = () => read("../docs/reports-retirement-readiness.md");

/** Each gap, and the check that decides whether it is still real. */
const GAPS = [
  {
    id: "B-1",
    what: "the Reporting Center UI still exposes only a period selector",
    stillOpen: async () => {
      const legacy = await read("../src/modules/reports/pages/Reports.jsx");
      const legacyControls = [...legacy.matchAll(/updateFilter\("(\w+)"/g)].map((m) => m[1]);
      const distinct = new Set(legacyControls);

      // Any filter control anywhere in the Reporting Center's own components.
      const layout = await read("../src/modules/reports/components/ReportsLayout.jsx");
      const period = await read("../src/modules/reports/components/PeriodSelector.jsx");
      const hasFilterBar = /warehouseId|categoryId|paymentMethod|customerId/.test(layout + period);

      return { open: distinct.size >= 8 && !hasFilterBar, detail: `${distinct.size} legacy controls, filter bar: ${hasFilterBar}` };
    },
  },
  {
    id: "B-2",
    what: "shiftId and salespersonId are not in the v2 filter allowlist",
    stillOpen: async () => {
      const filters = await read("../server/services/analytics/analyticsFilters.js");
      const missing = ["shiftId", "salespersonId"].filter((key) => !filters.includes(key));
      return { open: missing.length > 0, detail: `missing from parseAnalyticsFilters: ${missing.join(", ") || "none"}` };
    },
  },
  {
    id: "B-3",
    what: "saved presets exist only on the legacy page, in localStorage",
    stillOpen: async () => {
      const legacy = await read("../src/modules/reports/pages/Reports.jsx");
      const hasPresets = /PRESETS_KEY\s*=\s*"erp\.reports\.presets\.v1"/.test(legacy);
      const layout = await read("../src/modules/reports/components/ReportsLayout.jsx");
      const rebuilt = /preset/i.test(layout);
      return { open: hasPresets && !rebuilt, detail: `legacy presets: ${hasPresets}, rebuilt: ${rebuilt}` };
    },
  },
  {
    id: "B-4",
    what: "the column chooser exists only on the legacy page",
    stillOpen: async () => {
      const legacy = await read("../src/modules/reports/pages/Reports.jsx");
      const table = await read("../src/modules/reports/components/AnalyticsTable.jsx");
      return {
        open: /visibleColumns/.test(legacy) && !/visibleColumns|columnChooser/.test(table),
        detail: "AnalyticsTable has no column-visibility control",
      };
    },
  },
];

test("the recommendation is one of the two permitted values, stated once", async () => {
  const document = await readiness();
  const ready = /^#\s*READY_FOR_RETIREMENT\s*$/m.test(document);
  const notReady = /^#\s*NOT_READY_FOR_RETIREMENT\s*$/m.test(document);
  assert.ok(ready !== notReady, "exactly one recommendation heading must be present");
});

test("the verdict matches what the code actually still lacks", async () => {
  const document = await readiness();
  const notReady = /^#\s*NOT_READY_FOR_RETIREMENT\s*$/m.test(document);

  const open = [];
  for (const gap of GAPS) {
    const result = await gap.stillOpen();
    if (result.open) open.push(`${gap.id} (${result.detail})`);
  }

  if (open.length) {
    assert.ok(
      notReady,
      `the document says READY, but these gaps are still real in the code: ${open.join("; ")}`
    );
  } else {
    assert.ok(
      !notReady,
      "every blocking gap has been closed in the code — the document must be re-assessed and the verdict updated"
    );
  }
});

test("every gap the document names is still described where it can be checked", async () => {
  const document = await readiness();
  for (const gap of GAPS) {
    const result = await gap.stillOpen();
    if (!result.open) continue;
    assert.ok(
      document.includes(gap.id),
      `${gap.id} is still real in the code (${result.detail}) but no longer appears in the readiness document`
    );
  }
});

test("data, export and permission parity are recorded as settled, not as gaps", async () => {
  const document = await readiness();
  for (const tab of ["Insights", "Sales", "Employees", "Inventory", "Customers", "Financial", "Export"]) {
    assert.ok(document.includes(tab), `the tab table must account for ${tab}`);
  }
  for (const format of ["CSV", "Excel", "PDF", "Print"]) {
    assert.ok(document.includes(format), `export parity must name ${format}`);
  }
  assert.match(document, /NOT blocking/, "what is settled must be recorded so it is not re-litigated");
});

test("the legacy route is still live while the verdict stands", async () => {
  const app = await read("../src/App.jsx");
  const document = await readiness();
  if (/^#\s*NOT_READY_FOR_RETIREMENT\s*$/m.test(document)) {
    assert.match(app, /path="reports"\s*\n\s*element=\{\s*\n\s*<ProtectedRoute/, "/reports must remain routed");
    assert.ok(
      !/path="reports"\s+element=\{<Navigate/.test(app),
      "/reports must not be redirected while the assessment says it is not ready"
    );
  }
});
