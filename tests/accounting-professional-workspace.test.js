import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("accounting navigation is centralized and excludes incomplete duplicate pages", () => {
  const navigation = source("src/modules/accounting/lib/accountingNavigation.js");
  const shell = source("src/modules/accounting/components/AccountingShell.jsx");
  const app = source("src/App.jsx");

  assert.match(shell, /getAccountingNavigation/);
  assert.doesNotMatch(navigation, /accounting\/taxes/);
  assert.doesNotMatch(navigation, /accounting\/analytics/);
  assert.match(app, /path="accounting\/analytics"[\s\S]*Navigate to="\/accounting\/reports"/);
  assert.match(app, /path="accounting\/taxes"[\s\S]*Navigate to="\/accounting\/reports"/);
  assert.match(app, /path="accounting\/cash-registers"[\s\S]*Navigate to="\/accounting\/cashbox"/);
});

test("accounting dashboard uses the unified reports-v2 calculation source", () => {
  const controller = source("server/controllers/accountingController.js");
  const dashboard = source("src/modules/accounting/pages/Accounting.jsx");

  assert.match(controller, /getAccountingReportsV2Dashboard/);
  assert.match(controller, /dataSource:\s*"reports_v2"/);
  assert.match(controller, /receivablesDue/);
  assert.match(controller, /payablesDue/);
  assert.match(dashboard, /summary\.netProfit/);
  assert.match(dashboard, /summary\.receivablesDue/);
  assert.match(dashboard, /summary\.payablesDue/);
});

test("executive accounting reports support filtered CSV export and professional printing", () => {
  const reports = source("src/modules/accounting/pages/FinancialReports.jsx");

  assert.match(reports, /exportCurrentReportCsv/);
  assert.match(reports, /printCurrentReport/);
  assert.match(reports, /@page\{size:A4 landscape/);
  assert.match(reports, /filters\.from_date/);
  assert.match(reports, /filters\.to_date/);
  assert.match(reports, /filters\.branch_id/);
});

test("profit and loss does not count COGS twice as an operating expense", () => {
  const accountingService = source("server/services/accountingService.js");

  assert.match(accountingService, /COALESCE\(a\.code, ''\) <> '5000'/);
  assert.match(accountingService, /const grossProfit = roundMoney\(netSales - totalCogs\)/);
  assert.match(accountingService, /net_profit: roundMoney\(grossProfit - totalExpenses\)/);
});
