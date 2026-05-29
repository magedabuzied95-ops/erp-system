import express from "express";

import {
  closeCashDrawerShiftController,
  createManualMoneyAdjustmentController,
  createFinancialAccountController,
  createJournalEntryController,
  createPaymentMethodMappingController,
  deletePaymentMethodMappingController,
  getAccountingDashboardController,
  getAccountingAuditLogsController,
  getAccountingSummary,
  getBalanceSheetReportController,
  getCashDrawerShiftHistoryController,
  getCurrentCashDrawerShiftController,
  getFinancialAccountEntriesController,
  getFinancialAccountTransfersController,
  getFinancialAccountsController,
  getMoneyAccountsController,
  getMoneyReconciliationController,
  getMoneyTransactionsController,
  getFinancialReportsSummaryController,
  getJournalEntriesController,
  getJournalEntryDetailController,
  getMissingCostItemsController,
  getPaymentAccountStatusController,
  getPaymentMethodMappingsController,
  getLedgersReportController,
  getProfitLossReportController,
  getTreasuryDashboardController,
  getTrialBalanceReportController,
  logAccountingExportController,
  openCashDrawerShiftController,
  recordCashDrawerEventController,
  rebuildLedgerEntriesController,
  transferFinancialAccountsController,
  transferMoneyAccountsController,
  updateFinancialAccountController,
  updateMissingItemCostsController,
  updateOrderLineCostOverridesController,
  updatePaymentMethodMappingController,
} from "../controllers/accountingController.js";

import { protect } from "../middleware/authMiddleware.js";

import permit from "../middleware/permissionMiddleware.js";

const router = express.Router();

/* ======================================================
   ACCOUNTING SUMMARY
====================================================== */

router.get(
  "/summary",

  protect,
  permit("accounting", "view"),
  getAccountingSummary
);

router.get(
  "/dashboard",
  protect,
  permit("accounting", "view"),
  getAccountingDashboardController
);

router.get(
  "/treasury",
  protect,
  permit("treasury.dashboard", "view"),
  getTreasuryDashboardController
);

router.get(
  "/money-accounts",
  protect,
  permit("money_accounts", "view"),
  getMoneyAccountsController
);

router.get(
  "/money-transactions",
  protect,
  permit("money_transactions", "view"),
  getMoneyTransactionsController
);

router.get(
  "/money-reconciliation",
  protect,
  permit("money_transactions", "view"),
  getMoneyReconciliationController
);

router.get(
  "/payment-account-status",
  protect,
  permit("treasury.dashboard", "view"),
  getPaymentAccountStatusController
);

router.post(
  "/money-transfers",
  protect,
  permit("money_transfers", "create"),
  transferMoneyAccountsController
);

router.post(
  "/money-adjustments",
  protect,
  permit("money_transactions", "adjust"),
  createManualMoneyAdjustmentController
);

router.get(
  "/financial-reports/summary",
  protect,
  permit("accounting", "view"),
  getFinancialReportsSummaryController
);

router.get(
  "/financial-reports/profit-loss",
  protect,
  permit("accounting", "view"),
  getProfitLossReportController
);

router.get(
  "/financial-reports/ledgers",
  protect,
  permit("accounting", "view"),
  getLedgersReportController
);

router.get(
  "/financial-reports/trial-balance",
  protect,
  permit("accounting", "view"),
  getTrialBalanceReportController
);

router.get(
  "/financial-reports/balance-sheet",
  protect,
  permit("accounting", "view"),
  getBalanceSheetReportController
);

router.get(
  "/journal-entries",
  protect,
  permit("accounting", "view"),
  getJournalEntriesController
);

router.get(
  "/journal-entries/:id",
  protect,
  permit("accounting", "view"),
  getJournalEntryDetailController
);

router.get(
  "/audit-logs",
  protect,
  permit("accounting", "edit"),
  getAccountingAuditLogsController
);

router.post(
  "/audit-logs/export-generated",
  protect,
  permit("accounting", "view"),
  logAccountingExportController
);

router.post(
  "/journal-entries",
  protect,
  permit("accounting", "create"),
  createJournalEntryController
);

router.get(
  "/financial-accounts",
  protect,
  permit("accounting", "view"),
  getFinancialAccountsController
);

router.post(
  "/financial-accounts",
  protect,
  permit("accounting", "create"),
  createFinancialAccountController
);

router.post(
  "/financial-accounts/transfer",
  protect,
  permit("accounting", "create"),
  transferFinancialAccountsController
);

router.get(
  "/financial-accounts/transfers",
  protect,
  permit("accounting", "view"),
  getFinancialAccountTransfersController
);

router.get(
  "/financial-accounts/:id/transactions",
  protect,
  permit("accounting", "view"),
  getFinancialAccountEntriesController
);

router.patch(
  "/financial-accounts/:id",
  protect,
  permit("accounting", "edit"),
  updateFinancialAccountController
);

router.get(
  "/payment-method-mappings",
  protect,
  permit("accounting", "view"),
  getPaymentMethodMappingsController
);

router.post(
  "/payment-method-mappings",
  protect,
  permit("accounting", "create"),
  createPaymentMethodMappingController
);

router.patch(
  "/payment-method-mappings/:id",
  protect,
  permit("accounting", "edit"),
  updatePaymentMethodMappingController
);

router.delete(
  "/payment-method-mappings/:id",
  protect,
  permit("accounting", "edit"),
  deletePaymentMethodMappingController
);

router.post(
  "/cash-drawer/open",
  protect,
  permit("accounting", "create"),
  openCashDrawerShiftController
);

router.post(
  "/cash-drawer/:id/close",
  protect,
  permit("accounting", "edit"),
  closeCashDrawerShiftController
);

router.post(
  "/cash-drawer/:id/events",
  protect,
  permit("accounting", "create"),
  recordCashDrawerEventController
);

router.get(
  "/cash-drawer/current",
  protect,
  permit("accounting", "view"),
  getCurrentCashDrawerShiftController
);

router.get(
  "/cash-drawer/history",
  protect,
  permit("accounting", "view"),
  getCashDrawerShiftHistoryController
);

router.post(
  "/rebuild-ledger-entries",
  protect,
  permit("accounting", "edit"),
  rebuildLedgerEntriesController
);

router.get(
  "/cost-fix/missing-cost-items",
  protect,
  permit("accounting", "edit"),
  getMissingCostItemsController
);

router.post(
  "/cost-fix/update-costs",
  protect,
  permit("accounting", "edit"),
  updateMissingItemCostsController
);

router.post(
  "/cost-fix/update-order-line-costs",
  protect,
  permit("accounting", "edit"),
  updateOrderLineCostOverridesController
);

export default router;
