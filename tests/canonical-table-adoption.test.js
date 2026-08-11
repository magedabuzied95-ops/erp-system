import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Canonical table adoption.
//
// These do not re-test the table system itself (tests/canonical-table.test.js
// does that). They protect the two properties that made a 45-table migration
// safe enough to do in one pass:
//
//   1. it is PRESENTATION ONLY — no query, handler, colSpan or calculation was
//      touched, so the only thing that may appear in a migrated file's diff is a
//      class attribute;
//   2. the migration is CONSISTENT — a canonical table never keeps a conflicting
//      layout utility, and every canonical container really wraps a table.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

// Every file migrated in Checkpoints B and C.
const MIGRATED = [
  // B — accounting / financial
  "src/modules/accounting/pages/Accounts.jsx",
  "src/modules/accounting/pages/AuditTrail.jsx",
  "src/modules/accounting/pages/CashRegisters.jsx",
  "src/modules/accounting/pages/CostFixCenter.jsx",
  "src/modules/accounting/pages/Expenses.jsx",
  "src/modules/accounting/pages/FinancialAccounts.jsx",
  "src/modules/accounting/pages/GeneralLedger.jsx",
  "src/modules/accounting/pages/PaymentMethodMappings.jsx",
  "src/modules/accounting/pages/Treasury.jsx",
  "src/modules/accounting/pages/TrialBalance.jsx",
  // C — inventory / HR / orders / workflow
  "src/modules/inventory/pages/StockMovements.jsx",
  "src/modules/reports/components/InventoryTable.jsx",
  "src/modules/reports/components/ProductTable.jsx",
  "src/modules/attendance/components/AttendanceCenter.jsx",
  "src/modules/attendance/pages/AttendanceDashboard.jsx",
  "src/modules/attendance/pages/AttendanceReports.jsx",
  "src/modules/employees/components/users/UsersTable.jsx",
  "src/modules/employees/components/EmployeeAnalyticsWorkspace.jsx",
  "src/modules/sales/pages/SalesEmployees.jsx",
  "src/modules/sales/pages/InvoicesLegacy.jsx",
  "src/modules/purchases/pages/SupplierStatement.jsx",
  "src/modules/loyalty/pages/LoyaltyDashboard.jsx",
  "src/modules/loyalty/pages/CustomerLoyaltyProfile.jsx",
  "src/modules/aiStudio/pages/AiStudioRestockRecovery.jsx",
  "src/modules/aiStudio/pages/AiStudioWorkflows.jsx",
  "src/modules/aiSupport/pages/AiChannels.jsx",
  "src/modules/marketing/pages/Campaigns.jsx",
  "src/modules/marketing/pages/MarketingAttribution.jsx",
  "src/modules/marketing/pages/MarketingDashboard.jsx",
  "src/modules/marketing/pages/SocialCalendar.jsx",
  "src/modules/website/pages/WebsiteSettings.jsx",
  "src/modules/analytics/pages/AnalyticsDashboard.jsx",
  // Batch 2 — priority targets, previously-conflicted pages, spaced-row tables
  "src/modules/purchases/pages/PurchaseDetails.jsx",
  "src/modules/aiSupport/pages/AiAgentAnalytics.jsx",
  "src/modules/accounting/pages/FinancialReports.jsx",
  "src/modules/reports/pages/Reports.jsx",
  "src/modules/accounting/pages/JournalEntries.jsx",
  "src/modules/sales/pages/Customers.jsx",
  "src/modules/settings/pages/SettingsCenter.jsx",
  "src/modules/products/pages/ProductDetails.jsx",
  "src/modules/employees/pages/Branches.jsx",
  "src/modules/managerPortal/pages/InventoryApprovals.jsx",
  "src/modules/products/pages/Manufacturers.jsx",
  "src/modules/products/pages/Variants.jsx",
  "src/modules/products/components/ProductVariants.jsx",
  "src/modules/marketing/components/MarketingCampaignAnalyticsPanel.jsx",
  "src/modules/inventory/pages/InventoryHistory.jsx",
  "src/modules/products/pages/Units.jsx",
  "src/modules/products/pages/ProductsList.jsx",
];

// Deliberately NOT migrated, with the reason. A table lands here because
// converting it would change what the user sees or what the browser prints —
// never because it was merely awkward.
const SKIPPED = {
  // The three border-spacing-y-3 tables skipped in Batch 1 are now MIGRATED:
  // m1-table--separate expresses "row as card" canonically, so they no longer
  // have to choose between their design and the design system.
  "src/pages/Reports.jsx": "dead duplicate — zero importers; superseded by modules/reports/pages/Reports.jsx",
  "src/pages/Sales.jsx": "dead duplicate — zero importers anywhere under src/",
  "src/components/Table.jsx": "dead duplicate — zero importers; migrating it would imply it is live",
  "src/shared/components/Table.jsx": "dead duplicate — zero importers; migrating it would imply it is live",
  "src/components/users/UsersTable.jsx": "dead duplicate — zero importers; superseded by modules/employees/components",
  "src/components/ProductVariants.jsx": "dead duplicate — zero importers; superseded by modules/products/components",
  "src/pages/DashboardPrototype.jsx": "self-contained prototype owning DashboardPrototype.css; canonical rules would fight it for no user benefit",
  "src/pages/ThemeFoundation.jsx": "design-system showcase owning ThemeFoundation.css; same reason",
  "src/modules/employees/pages/EmployeePayrollPortal.jsx": "its only table is inside a print-HTML payslip string, not application UI",
  "src/modules/pos/components/CartSidebar.jsx": "POS cart — one transaction, must stay whole",
  "src/modules/pos/pages/POSPro.jsx": "POS transaction surface — owns its own theme layer via POSPro.m1.css",
  "src/modules/shipping/pages/ShippingCenter.jsx": "viewport virtualization — a second layout owner would fight the scroll window",
  "src/modules/purchases/pages/PurchaseOrder.jsx": "perf-critical bounded catalog path",
  "src/shared/utils/invoicePdf.js": "PDF template — the browser prints this, app theming would follow it onto paper",
  "src/modules/accounting/lib/financialReportExport.js": "export template — generates HTML for download, not interactive UI",
  "src/modules/analytics/lib/analyticsExport.js": "export template — generates HTML for download, not interactive UI",
  "src/modules/employees/lib/employeeAnalyticsExport.js": "export template — generates HTML for download, not interactive UI",
  "src/storefront/pages/StorefrontSizeGuidePage.jsx": "storefront owns its own theme; not ERP application UI",
};

// A migrated page may still legitimately build print/export markup in a template
// string. Those tables carry no `className` (they are HTML text, not JSX), which
// is exactly how they are excluded here. They must never gain app styling — it
// would follow them onto paper.
const tablesIn = (src) => src.match(/<table[\s>]/g) ?? [];
const uiTablesIn = (src) => src.match(/<table[\s\n]+className/g) ?? [];
const canonicalTablesIn = (src) => src.match(/<table[\s\n]+className=\{?["`][^"`]*m1-table\b/g) ?? [];

// ---- adoption -------------------------------------------------------------

test("every migrated file exists and still renders tables", () => {
  for (const file of MIGRATED) {
    const src = read(file);
    assert.ok(tablesIn(src).length > 0, `${file} no longer renders a table`);
  }
});

test("every UI table in a migrated file is canonical — no half-migrated page", () => {
  for (const file of MIGRATED) {
    const src = read(file);
    assert.equal(
      canonicalTablesIn(src).length,
      uiTablesIn(src).length,
      `${file} still has a JSX table without m1-table`,
    );
  }
});

test("print and export tables inside migrated pages stayed untouched", () => {
  // Customers, FinancialReports, reports/Reports and PurchasesDashboard each
  // build a print table in a template string alongside their real UI table.
  let printTables = 0;
  for (const file of MIGRATED) {
    const src = read(file);
    printTables += tablesIn(src).length - uiTablesIn(src).length;
    for (const tag of src.match(/<table(?![\s\n]+className)[^>]*>/g) ?? []) {
      assert.doesNotMatch(tag, /m1-table/, `${file} styled a print table with app CSS`);
    }
  }
  // Customers, FinancialReports and reports/Reports each keep exactly one.
  assert.ok(printTables >= 3, `expected the known print tables to survive, found ${printTables}`);
});

test("adoption is broad, not a token gesture", () => {
  const total = MIGRATED.reduce((sum, file) => sum + canonicalTablesIn(read(file)).length, 0);
  assert.ok(total >= 65, `expected a meaningful migration, found ${total} canonical tables`);
});

// ---- consistency ----------------------------------------------------------

test("no canonical table keeps divide-y, which fights the canonical row border", () => {
  // divide-y paints border-TOP on each row; the canonical layer paints
  // border-BOTTOM. Different edges, so both would render as a double rule.
  //
  // Scoped to TABLE markup on purpose. divide-y on a <div> list — Customers has
  // one — is an unrelated component and none of this system's business.
  for (const file of MIGRATED) {
    const src = read(file);
    for (const tag of src.match(/<(?:table|thead|tbody|tfoot|tr)[\s\n][^>]*>/g) ?? []) {
      assert.doesNotMatch(tag, /\bdivide-y\b/, `${file} still carries divide-y on table markup`);
    }
  }
});

test("border-separate survives only on the spaced-row variant, where it is real", () => {
  // m1-table.css is unlayered and Tailwind utilities live in @layer utilities,
  // so the canonical `border-collapse: collapse` wins regardless of order — on a
  // normal table a leftover border-separate is a silent no-op that misleads the
  // next reader. Under m1-table--separate the canonical rule sets `separate`
  // itself, so the utility agrees with it rather than fighting it.
  for (const file of MIGRATED) {
    const src = read(file);
    for (const match of src.match(/<table[\s\S]{0,400}?>/g) ?? []) {
      if (!/border-separate/.test(match)) continue;
      assert.match(match, /m1-table--separate/, `${file} keeps border-separate on a collapsed table`);
    }
  }
});

test("the spaced-row tables became canonical instead of staying skipped", () => {
  // These three were skipped in Batch 1 because border-collapse would have
  // deleted the gap that IS their design. The variant removed that trade-off.
  for (const file of [
    "src/modules/products/pages/Variants.jsx",
    "src/modules/products/components/ProductVariants.jsx",
    "src/modules/marketing/components/MarketingCampaignAnalyticsPanel.jsx",
    "src/modules/inventory/pages/InventoryHistory.jsx",
    "src/modules/products/pages/Units.jsx",
    "src/modules/products/pages/ProductsList.jsx",
  ]) {
    assert.match(read(file), /m1-table--separate/, `${file} lost its spaced-row treatment`);
  }
});

test("the canonical gap replaced the utility that used to provide it", () => {
  // border-spacing-y-* is a no-op once the variant sets border-spacing itself;
  // leaving it would suggest the page still controls its own row rhythm.
  for (const file of MIGRATED) {
    const src = read(file);
    for (const match of src.match(/<table[\s\S]{0,400}?>/g) ?? []) {
      if (!/m1-table--separate/.test(match)) continue;
      assert.doesNotMatch(match, /border-spacing-y-/, `${file} still sets its own row gap`);
    }
  }
});

test("every canonical container actually wraps a table", () => {
  // `overflow-x-auto` is also worn by tab strips and bar charts. Giving one of
  // those a card border is a visible regression in something that is not a
  // table, and it happened on the first pass.
  for (const file of MIGRATED) {
    const src = read(file);
    let index = src.indexOf("m1-table-container");
    while (index > -1) {
      const window = src.slice(index, index + 600);
      assert.match(window, /<table[\s>]/, `${file} has an m1-table-container with no table inside it`);
      index = src.indexOf("m1-table-container", index + 1);
    }
  }
});

// ---- exclusions -----------------------------------------------------------

test("the excluded tables are still excluded and still explain why", () => {
  for (const [file, reason] of Object.entries(SKIPPED)) {
    const src = read(file);
    assert.ok(reason.length > 20, `${file} needs a real reason, not a label`);
    assert.doesNotMatch(src, /\bm1-table\b/, `${file} was migrated despite being excluded: ${reason}`);
  }
});

test("print, PDF and export templates were never touched", () => {
  for (const file of [
    "src/shared/utils/invoicePdf.js",
    "src/modules/accounting/lib/financialReportExport.js",
    "src/modules/analytics/lib/analyticsExport.js",
    "src/modules/employees/lib/employeeAnalyticsExport.js",
  ]) {
    const src = read(file);
    assert.ok(tablesIn(src).length > 0, `${file} should still build its own table markup`);
    assert.doesNotMatch(src, /m1-table/, `${file} is not application UI and must not inherit app styling`);
  }
});

// ---- presentation only ----------------------------------------------------

test("only genuinely spaced tables got the variant", () => {
  // MarketingCampaignAnalyticsPanel has two tables: one spaced-row card list and
  // one ordinary ruled grid (border-spacing-0). Giving the second one card
  // styling would have invented a gap it never had.
  const panel = read("src/modules/marketing/components/MarketingCampaignAnalyticsPanel.jsx");
  assert.equal((panel.match(/m1-table--separate/g) ?? []).length, 1, "only one of its two tables is spaced");
  assert.equal((panel.match(/<table[\s\n]+className/g) ?? []).length, 2);
});

test("migrated accounting pages still own their financial rendering", () => {
  // The local Th/Td helpers are what the canonical layer overrides by
  // specificity; deleting them would have been a rewrite, not a migration.
  for (const file of [
    "src/modules/accounting/pages/Accounts.jsx",
    "src/modules/accounting/pages/GeneralLedger.jsx",
    "src/modules/accounting/pages/TrialBalance.jsx",
  ]) {
    const src = read(file);
    assert.match(src, /function Th\(/, `${file} lost its local Th helper`);
    assert.match(src, /function Td\(/, `${file} lost its local Td helper`);
  }
});
