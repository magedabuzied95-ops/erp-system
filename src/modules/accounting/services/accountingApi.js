import { api } from "../../../shared/api/api";

const buildParams = (params = {}) =>
  Object.fromEntries(
    Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== "")
  );

export const accountingApi = {
  getAccounts: (params = {}) =>
    api.get("/accounting/accounts", {
      params: buildParams(params),
      timeoutMs: 30000,
    }),
  getJournalEntries: (params = {}) =>
    api.get("/accounting/journal-entries", {
      params: buildParams(params),
      timeoutMs: 30000,
    }),
  getJournalEntryDetail: (entryId) =>
    api.get(`/accounting/journal-entries/${entryId}`, {
      timeoutMs: 30000,
    }),
  createJournalEntry: (payload = {}) =>
    api.post("/accounting/journal-entries", payload, {
      timeoutMs: 30000,
    }),
  getJournalBackfillPreview: (payload = {}) =>
    api.post("/accounting/journal-entries/backfill-preview", payload, {
      timeoutMs: 30000,
    }),
  getFinancialReportsSummary: (params = {}) =>
    api.get("/accounting/financial-reports/summary", {
      params: buildParams(params),
      timeoutMs: 30000,
    }),
  getReportsV2Dashboard: (params = {}) =>
    api.get("/accounting/reports-v2/dashboard", {
      params: buildParams(params),
      timeoutMs: 30000,
    }),
  getReportsV2IncomeStatement: (params = {}) =>
    api.get("/accounting/reports-v2/income-statement", {
      params: buildParams(params),
      timeoutMs: 30000,
    }),
  getReportsV2CashAccounts: (params = {}) =>
    api.get("/accounting/reports-v2/cash-accounts", {
      params: buildParams(params),
      timeoutMs: 30000,
    }),
  getReportsV2Receivables: (params = {}) =>
    api.get("/accounting/reports-v2/receivables", {
      params: buildParams(params),
      timeoutMs: 30000,
    }),
  getReportsV2Payables: (params = {}) =>
    api.get("/accounting/reports-v2/payables", {
      params: buildParams(params),
      timeoutMs: 30000,
    }),
  getReportsV2Inventory: (params = {}) =>
    api.get("/accounting/reports-v2/inventory", {
      params: buildParams(params),
      timeoutMs: 30000,
    }),
  getReportsV2SpecialTransactions: (params = {}) =>
    api.get("/accounting/reports-v2/special-transactions", {
      params: buildParams(params),
      timeoutMs: 30000,
    }),
  getProfitLossReport: (params = {}) =>
    api.get("/accounting/financial-reports/profit-loss", {
      params: buildParams(params),
      timeoutMs: 30000,
    }),
  getLedgersReport: (params = {}) =>
    api.get("/accounting/financial-reports/ledgers", {
      params: buildParams(params),
      timeoutMs: 30000,
    }),
  getTrialBalanceReport: (params = {}) =>
    api.get("/accounting/financial-reports/trial-balance", {
      params: buildParams(params),
      timeoutMs: 30000,
    }),
  getBalanceSheetReport: (params = {}) =>
    api.get("/accounting/financial-reports/balance-sheet", {
      params: buildParams(params),
      timeoutMs: 30000,
    }),
  rebuildLedgerEntries: (payload = {}) =>
    api.post("/accounting/rebuild-ledger-entries", payload, {
      timeoutMs: 120000,
    }),
  getTreasuryDashboard: (params = {}) =>
    api.get("/accounting/treasury", {
      params: buildParams(params),
      timeoutMs: 30000,
    }),
  getMoneyAccounts: (params = {}) =>
    api.get("/accounting/money-accounts", {
      params: buildParams(params),
      timeoutMs: 30000,
    }),
  getMoneyTransactions: (params = {}) =>
    api.get("/accounting/money-transactions", {
      params: buildParams(params),
      timeoutMs: 30000,
    }),
  getMoneyReconciliation: (params = {}) =>
    api.get("/accounting/money-reconciliation", {
      params: buildParams(params),
      timeoutMs: 30000,
    }),
  transferMoneyAccounts: (payload = {}) =>
    api.post("/accounting/money-transfers", payload, {
      timeoutMs: 30000,
    }),
  createManualMoneyAdjustment: (payload = {}) =>
    api.post("/accounting/money-adjustments", payload, {
      timeoutMs: 30000,
    }),
  getCurrentCashDrawerShift: (params = {}) =>
    api.get("/accounting/cash-drawer/current", {
      params: buildParams(params),
      timeoutMs: 30000,
    }),
  getCashDrawerHistory: (params = {}) =>
    api.get("/accounting/cash-drawer/history", {
      params: buildParams(params),
      timeoutMs: 30000,
    }),
  openCashDrawerShift: (payload = {}) =>
    api.post("/accounting/cash-drawer/open", payload, {
      timeoutMs: 30000,
    }),
  closeCashDrawerShift: (shiftId, payload = {}) =>
    api.post(`/accounting/cash-drawer/${shiftId}/close`, payload, {
      timeoutMs: 30000,
    }),
  recordCashDrawerEvent: (shiftId, payload = {}) =>
    api.post(`/accounting/cash-drawer/${shiftId}/events`, payload, {
      timeoutMs: 30000,
    }),
  getFinancialAccounts: (params = {}) =>
    api.get("/accounting/financial-accounts", {
      params: buildParams(params),
      timeoutMs: 30000,
    }),
  createFinancialAccount: (payload = {}) =>
    api.post("/accounting/financial-accounts", payload, {
      timeoutMs: 30000,
    }),
  updateFinancialAccount: (accountId, payload = {}) =>
    api.patch(`/accounting/financial-accounts/${accountId}`, payload, {
      timeoutMs: 30000,
    }),
  transferFinancialAccounts: (payload = {}) =>
    api.post("/accounting/financial-accounts/transfer", payload, {
      timeoutMs: 30000,
    }),
  getFinancialAccountTransfers: (params = {}) =>
    api.get("/accounting/financial-accounts/transfers", {
      params: buildParams(params),
      timeoutMs: 30000,
    }),
  getFinancialAccountEntries: (accountId) =>
    api.get(`/accounting/financial-accounts/${accountId}/transactions`, {
      timeoutMs: 30000,
    }),
  getPaymentMethodMappings: (params = {}) =>
    api.get("/accounting/payment-method-mappings", {
      params: buildParams(params),
      timeoutMs: 30000,
    }),
  createPaymentMethodMapping: (payload = {}) =>
    api.post("/accounting/payment-method-mappings", payload, {
      timeoutMs: 30000,
    }),
  updatePaymentMethodMapping: (mappingId, payload = {}) =>
    api.patch(`/accounting/payment-method-mappings/${mappingId}`, payload, {
      timeoutMs: 30000,
    }),
  deletePaymentMethodMapping: (mappingId) =>
    api.delete(`/accounting/payment-method-mappings/${mappingId}`, {
      timeoutMs: 30000,
    }),
  getMissingCostItems: (params = {}) =>
    api.get("/accounting/cost-fix/missing-cost-items", {
      params: buildParams(params),
      timeoutMs: 30000,
    }),
  updateCosts: (payload = {}) =>
    api.post("/accounting/cost-fix/update-costs", payload, {
      timeoutMs: 60000,
    }),
  updateOrderLineCosts: (payload = {}) =>
    api.post("/accounting/cost-fix/update-order-line-costs", payload, {
      timeoutMs: 60000,
    }),
  getAuditLogs: (params = {}) =>
    api.get("/accounting/audit-logs", {
      params: buildParams(params),
      timeoutMs: 30000,
    }),
  logExportGenerated: (payload = {}) =>
    api.post("/accounting/audit-logs/export-generated", payload, {
      timeoutMs: 15000,
      suppressErrorStatuses: [403],
    }),
};
