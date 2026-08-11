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
];

// Deliberately NOT migrated, with the reason. A table lands here because
// converting it would change what the user sees or what the browser prints —
// never because it was merely awkward.
const SKIPPED = {
  "src/modules/products/pages/Variants.jsx": "border-spacing-y-3 — rows are deliberately spaced cards, not a ruled grid",
  "src/modules/products/components/ProductVariants.jsx": "border-spacing-y-3 — same spaced-row design",
  "src/modules/marketing/components/MarketingCampaignAnalyticsPanel.jsx": "border-spacing-y-3 — same spaced-row design",
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

const tablesIn = (src) => src.match(/<table[\s>]/g) ?? [];
const canonicalTablesIn = (src) => src.match(/<table[^>]*m1-table\b/g) ?? [];

// ---- adoption -------------------------------------------------------------

test("every migrated file exists and still renders tables", () => {
  for (const file of MIGRATED) {
    const src = read(file);
    assert.ok(tablesIn(src).length > 0, `${file} no longer renders a table`);
  }
});

test("every table in a migrated file is canonical — no half-migrated page", () => {
  for (const file of MIGRATED) {
    const src = read(file);
    assert.equal(
      canonicalTablesIn(src).length,
      tablesIn(src).length,
      `${file} still has a table without m1-table`,
    );
  }
});

test("adoption is broad, not a token gesture", () => {
  const total = MIGRATED.reduce((sum, file) => sum + canonicalTablesIn(read(file)).length, 0);
  assert.ok(total >= 40, `expected a meaningful migration, found ${total} canonical tables`);
});

// ---- consistency ----------------------------------------------------------

test("no canonical table keeps divide-y, which fights the canonical row border", () => {
  // divide-y paints border-TOP on each row; the canonical layer paints
  // border-BOTTOM. Different edges, so both would render as a double rule.
  for (const file of MIGRATED) {
    const src = read(file);
    assert.doesNotMatch(src, /\bdivide-y\b/, `${file} still carries divide-y`);
  }
});

test("no canonical table keeps border-separate, which fights border-collapse", () => {
  // m1-table.css is unlayered and Tailwind utilities live in @layer utilities,
  // so the canonical `border-collapse: collapse` wins regardless of order. A
  // leftover border-separate would therefore be a silent no-op that misleads
  // the next reader.
  for (const file of MIGRATED) {
    const src = read(file);
    for (const match of src.match(/<table[^>]*>/g) ?? []) {
      assert.doesNotMatch(match, /border-separate/, `${file} has a canonical table still asking for border-separate`);
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

test("the spaced-row tables kept the spacing that is the point of their design", () => {
  for (const file of [
    "src/modules/products/pages/Variants.jsx",
    "src/modules/products/components/ProductVariants.jsx",
    "src/modules/marketing/components/MarketingCampaignAnalyticsPanel.jsx",
  ]) {
    assert.match(read(file), /border-spacing-y-/, `${file} lost its row spacing`);
  }
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
