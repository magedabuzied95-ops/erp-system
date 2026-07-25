import db from "../database/db.js";
import { getTenantId, isSuperAdminUser } from "../utils/requestScope.js";
import {
  createManualMoneyAdjustment,
  closeCashDrawerShift,
  createFinancialAccount,
  createPaymentMethodMapping,
  deletePaymentMethodMapping,
  getAccountingDashboard,
  getFinancialReportsSummary,
  getJournalEntries,
  getJournalEntryDetail,
  getTreasuryDashboard,
  getMoneyAccountsReconciliation,
  getAccountingAuditLogs,
  getCashDrawerShiftEvents,
  getCashDrawerShiftHistory,
  getCurrentCashDrawerShift,
  getFinancialAccountEntries,
  getFinancialAccountTransfers,
  getFinancialAccounts,
  listMoneyAccounts,
  listMoneyTransactions,
  getMissingCostItems,
  getPaymentMethodMappings,
  getPaymentAccountStatus,
  getBalanceSheetReport,
  getLedgersReport,
  getProfitLossReport,
  getTrialBalanceReport,
  rebuildLedgerEntries,
  logAccountingAudit,
  openCashDrawerShift,
  recordCashDrawerEvent,
  transferFinancialAccounts,
  transferMoneyAccounts,
  updateFinancialAccount,
  updateMissingItemCosts,
  updateOrderLineCostOverrides,
  updatePaymentMethodMapping,
} from "../services/accountingService.js";
import {
  getAccountingReportsV2CashAccounts,
  getAccountingReportsV2Dashboard,
  getAccountingReportsV2IncomeStatement,
  getAccountingReportsV2Inventory,
  getAccountingReportsV2Payables,
  getAccountingReportsV2Receivables,
  getAccountingReportsV2SpecialTransactions,
} from "../services/accountingReportsV2Service.js";
import {
  createJournalEntry as createFoundationJournalEntry,
  getGeneralLedger,
  getTrialBalance,
  listGeneralLedgerAccounts,
  getBackfillPreview,
  listFoundationAccounts,
} from "../services/accountingJournalService.js";
import { getAccountingAnalyticsEmbed } from "../services/accountingAnalyticsService.js";

const isAdminUser = (user = {}) => {
  if (isSuperAdminUser(user)) return true;
  const role = String(user.role_name || user.role || "").trim().toLowerCase().replace(/[_-]+/g, " ");
  return ["admin", "super admin", "superadmin"].includes(role);
};

const treasuryTenantId = (req, source = {}) =>
  isSuperAdminUser(req.user)
    ? getTenantId(req, source.tenant_id || source.tenantId || req.query?.tenant_id || req.body?.tenant_id || req.user?.tenant_id)
    : getTenantId(req, req.user?.tenant_id);

export const getAccountingSummary = async (req, res) => {
  try {
    const tenantId = treasuryTenantId(req, req.query);
    const summary = await getAccountingDashboard(db, { tenantId });

    const cashbox = await db.query(
      `
      SELECT balance
      FROM cashbox
      ${tenantId === null ? "" : "WHERE tenant_id = $1"}
      ORDER BY id DESC
      LIMIT 1
      `,
      tenantId === null ? [] : [tenantId]
    );

    return res.status(200).json({
      success: true,
      summary: {
        sales: summary.salesTotal,
        purchases: summary.purchasesTotal,
        expenses: summary.expenses,
        profit: summary.grossProfit,
        balance: cashbox.rows.length > 0 ? Number(cashbox.rows[0].balance || 0) : 0,
        revenue: summary.revenue,
        cogs: summary.cogs,
        inventoryValue: summary.inventoryValue,
        grossProfit: summary.grossProfit,
      },
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      success: false,
      message: "Failed To Fetch Accounting Summary",
      error: error.message,
    });
  }
};

export const getAccountingAnalyticsEmbedController = async (req, res) => {
  try {
    const tenantId = treasuryTenantId(req, req.query);
    const result = getAccountingAnalyticsEmbed({ tenantId, user: req.user });
    return res.json(result);
  } catch (error) {
    console.error("[accounting-analytics] failed to create embed session:", error);
    return res.status(500).json({
      enabled: false,
      reason: "embed_failed",
      message: "Unable to open accounting analytics",
    });
  }
};

export const getAccountingDashboardController = async (req, res) => {
  try {
    const tenantId = treasuryTenantId(req, req.query);
    const dashboard = await getAccountingDashboard(db, { tenantId });
    return res.status(200).json({ success: true, dashboard });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch accounting dashboard",
      error: error.message,
    });
  }
};

export const getTreasuryDashboardController = async (req, res) => {
  try {
    const tenantId = treasuryTenantId(req, req.query);
    const dashboard = await getTreasuryDashboard(db, {
      tenantId,
      limit: req.query.limit || 100,
    });
    return res.status(200).json({ success: true, dashboard });
  } catch (error) {
    console.log(error);
    return res.status(error.status || 500).json({
      success: false,
      message: "Failed to fetch treasury dashboard",
      error: error.message,
    });
  }
};

export const getMoneyAccountsController = async (req, res) => {
  try {
    const tenantId = treasuryTenantId(req, req.body);
    const accounts = await listMoneyAccounts(db, {
      tenantId,
      type: req.query.type,
      branchId: req.query.branch_id || req.query.branchId,
      includeInactive: req.query.include_inactive === "true" || req.query.includeInactive === "true",
    });
    return res.status(200).json({ success: true, accounts });
  } catch (error) {
    console.log(error);
    return res.status(error.status || 500).json({ success: false, message: "Failed to fetch money accounts", error: error.message });
  }
};

export const getMoneyTransactionsController = async (req, res) => {
  try {
    const tenantId = treasuryTenantId(req, req.body);
    const transactions = await listMoneyTransactions(db, {
      tenantId,
      accountId: req.query.account_id || req.query.accountId,
      transactionType: req.query.transaction_type || req.query.transactionType,
      referenceType: req.query.reference_type || req.query.referenceType,
      branchId: req.query.branch_id || req.query.branchId,
      fromDate: req.query.from_date || req.query.from,
      toDate: req.query.to_date || req.query.to,
      limit: req.query.limit || 200,
    });
    return res.status(200).json({ success: true, transactions });
  } catch (error) {
    console.log(error);
    return res.status(error.status || 500).json({ success: false, message: "Failed to fetch money transactions", error: error.message });
  }
};

export const getMoneyReconciliationController = async (req, res) => {
  try {
    const tenantId = treasuryTenantId(req, req.query);
    const reconciliation = await getMoneyAccountsReconciliation(db, { tenantId });
    return res.status(200).json({ success: true, reconciliation });
  } catch (error) {
    console.log(error);
    return res.status(error.status || 500).json({ success: false, message: "Failed to reconcile money accounts", error: error.message });
  }
};

export const getPaymentAccountStatusController = async (req, res) => {
  try {
    const tenantId = treasuryTenantId(req, req.query);
    const status = await getPaymentAccountStatus(db, {
      tenantId,
      paymentMethod: req.query.payment_method || req.query.paymentMethod,
      branchId: req.query.branch_id || req.query.branchId,
      amount: req.query.amount || 0,
      direction: req.query.direction || req.query.transaction_direction || req.query.transactionDirection || "out",
    });
    return res.status(200).json({ success: true, status });
  } catch (error) {
    console.log(error);
    return res.status(error.status || 500).json({ success: false, message: "Failed to fetch payment account status", error: error.message });
  }
};

export const transferMoneyAccountsController = async (req, res) => {
  try {
    const tenantId = treasuryTenantId(req, req.body);
    const transfer = await transferMoneyAccounts(db, {
      tenantId,
      fromAccountId: req.body.from_account_id || req.body.fromAccountId,
      toAccountId: req.body.to_account_id || req.body.toAccountId,
      amount: req.body.amount,
      notes: req.body.notes || "",
      createdBy: req.user?.id || null,
    });
    return res.status(201).json({ success: true, transfer });
  } catch (error) {
    console.log(error);
    return res.status(error.status || 500).json({ success: false, message: "Failed to transfer money", error: error.message });
  }
};

export const createManualMoneyAdjustmentController = async (req, res) => {
  try {
    const tenantId = treasuryTenantId(req, req.body);
    const transaction = await createManualMoneyAdjustment(db, {
      tenantId,
      accountId: req.body.account_id || req.body.accountId,
      direction: req.body.direction,
      amount: req.body.amount,
      paymentMethod: req.body.payment_method || req.body.paymentMethod || "manual",
      notes: req.body.notes || "",
      branchId: req.body.branch_id || req.body.branchId || null,
      createdBy: req.user?.id || null,
      metadata: { source: "manual_adjustment" },
    });
    return res.status(201).json({ success: true, transaction });
  } catch (error) {
    console.log(error);
    return res.status(error.status || 500).json({ success: false, message: "Failed to create manual adjustment", error: error.message });
  }
};

export const getFinancialReportsSummaryController = async (req, res) => {
  try {
    const tenantId = isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id);
    const summary = await getFinancialReportsSummary(db, {
      tenantId,
      fromDate: req.query.from_date || req.query.from || req.query.startDate || null,
      toDate: req.query.to_date || req.query.to || req.query.endDate || null,
      branchId: req.query.branch_id || req.query.branchId || null,
    });

    return res.status(200).json({
      success: true,
      ...summary,
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch financial reports summary",
      error: error.message,
    });
  }
};

const getReportsV2TenantId = (req) =>
  isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id);

const getReportsV2Filters = (req) => ({
  tenantId: getReportsV2TenantId(req),
  fromDate: req.query.from_date || req.query.from || req.query.startDate || null,
  toDate: req.query.to_date || req.query.to || req.query.endDate || null,
  branchId: req.query.branch_id || req.query.branchId || null,
});

export const getAccountingReportsV2DashboardController = async (req, res) => {
  try {
    const payload = await getAccountingReportsV2Dashboard(db, getReportsV2Filters(req));
    return res.status(200).json({ success: true, ...payload });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch accounting reports dashboard",
      error: error.message,
    });
  }
};

export const getAccountingReportsV2IncomeStatementController = async (req, res) => {
  try {
    const payload = await getAccountingReportsV2IncomeStatement(db, getReportsV2Filters(req));
    return res.status(200).json({ success: true, ...payload });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch accounting income statement",
      error: error.message,
    });
  }
};

export const getAccountingReportsV2CashAccountsController = async (req, res) => {
  try {
    const payload = await getAccountingReportsV2CashAccounts(db, getReportsV2Filters(req));
    return res.status(200).json({ success: true, ...payload });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch accounting cash accounts report",
      error: error.message,
    });
  }
};

export const getAccountingReportsV2ReceivablesController = async (req, res) => {
  try {
    const payload = await getAccountingReportsV2Receivables(db, getReportsV2Filters(req));
    return res.status(200).json({ success: true, ...payload });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch receivables report",
      error: error.message,
    });
  }
};

export const getAccountingReportsV2PayablesController = async (req, res) => {
  try {
    const payload = await getAccountingReportsV2Payables(db, getReportsV2Filters(req));
    return res.status(200).json({ success: true, ...payload });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch payables report",
      error: error.message,
    });
  }
};

export const getAccountingReportsV2InventoryController = async (req, res) => {
  try {
    const payload = await getAccountingReportsV2Inventory(db, getReportsV2Filters(req));
    return res.status(200).json({ success: true, ...payload });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch inventory value report",
      error: error.message,
    });
  }
};

export const getAccountingReportsV2SpecialTransactionsController = async (req, res) => {
  try {
    const payload = await getAccountingReportsV2SpecialTransactions(db, getReportsV2Filters(req));
    return res.status(200).json({ success: true, ...payload });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch special transactions report",
      error: error.message,
    });
  }
};

export const getProfitLossReportController = async (req, res) => {
  try {
    const tenantId = isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id);
    const report = await getProfitLossReport(db, {
      tenantId,
      fromDate: req.query.from_date || req.query.from || req.query.startDate || null,
      toDate: req.query.to_date || req.query.to || req.query.endDate || null,
      branchId: req.query.branch_id || req.query.branchId || null,
    });

    return res.status(200).json({
      success: true,
      ...report,
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch profit and loss report",
      error: error.message,
    });
  }
};

export const getLedgersReportController = async (req, res) => {
  try {
    const tenantId = isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id);
    const report = await getLedgersReport(db, {
      tenantId,
      fromDate: req.query.from_date || req.query.from || req.query.startDate || null,
      toDate: req.query.to_date || req.query.to || req.query.endDate || null,
      branchId: req.query.branch_id || req.query.branchId || null,
      accountType: req.query.account_type || req.query.accountType || null,
    });

    return res.status(200).json({
      success: true,
      ...report,
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch ledgers report",
      error: error.message,
    });
  }
};

export const getTrialBalanceReportController = async (req, res) => {
  try {
    const tenantId = isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id);
    const report = await getTrialBalanceReport(db, {
      tenantId,
      fromDate: req.query.from_date || req.query.from || req.query.startDate || null,
      toDate: req.query.to_date || req.query.to || req.query.endDate || null,
      branchId: req.query.branch_id || req.query.branchId || null,
    });

    return res.status(200).json({
      success: true,
      ...report,
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch trial balance report",
      error: error.message,
    });
  }
};

export const getBalanceSheetReportController = async (req, res) => {
  try {
    const tenantId = isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id);
    const report = await getBalanceSheetReport(db, {
      tenantId,
      fromDate: req.query.from_date || req.query.from || req.query.startDate || null,
      toDate: req.query.to_date || req.query.to || req.query.endDate || null,
      branchId: req.query.branch_id || req.query.branchId || null,
    });

    return res.status(200).json({
      success: true,
      ...report,
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch balance sheet report",
      error: error.message,
    });
  }
};

export const getJournalEntriesController = async (req, res) => {
  try {
    const tenantId = isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id);
    const result = await getJournalEntries(db, {
      tenantId,
      search: req.query.search || "",
      referenceType: req.query.referenceType || req.query.reference_type || "",
      dateFrom: req.query.dateFrom || req.query.from || null,
      dateTo: req.query.dateTo || req.query.to || null,
      limit: req.query.limit || 50,
      offset: req.query.offset || 0,
    });

    return res.status(200).json({
      success: true,
      entries: result.rows,
      pagination: {
        total: result.total,
        limit: result.limit,
        offset: result.offset,
      },
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch journal entries",
      error: error.message,
    });
  }
};

export const getJournalEntryDetailController = async (req, res) => {
  try {
    const tenantId = isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id);
    const entry = await getJournalEntryDetail(db, {
      tenantId,
      journalEntryId: req.params.id,
    });

    if (!entry) {
      return res.status(404).json({
        success: false,
        message: "Journal entry not found",
      });
    }

    return res.status(200).json({
      success: true,
      entry,
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch journal entry",
      error: error.message,
    });
  }
};

export const createJournalEntryController = async (req, res) => {
  try {
    const tenantId = isSuperAdminUser(req.user)
      ? getTenantId(req, req.body?.tenant_id || req.query?.tenant_id || req.user?.tenant_id)
      : getTenantId(req, req.user?.tenant_id);
    if (!tenantId) {
      return res.status(400).json({
        success: false,
        message: "tenant_id is required to create a journal entry",
      });
    }

    const entry = await createFoundationJournalEntry({
      tenantId,
      branchId: req.body?.branch_id || req.body?.branchId || null,
      sourceType: req.body?.source_type || req.body?.sourceType || "manual",
      sourceId: req.body?.source_id || req.body?.sourceId || null,
      entryDate: req.body?.entry_date || req.body?.entryDate || null,
      description: req.body?.description || "",
      notes: req.body?.notes || "",
      lines: req.body?.lines || [],
      entryNumber: req.body?.entry_number || req.body?.entryNumber || null,
      createdBy: req.user?.id || null,
      status: req.body?.status || "posted",
      isGenerated: Boolean(req.body?.is_generated || req.body?.isGenerated || false),
      entryType: req.body?.entry_type || req.body?.entryType || "manual",
      sourceKey: req.body?.source_key || req.body?.sourceKey || null,
    });
    return res.status(201).json({
      success: true,
      entry,
    });
  } catch (error) {
    console.log(error);
    return res.status(error.status || 500).json({
      success: false,
      message: "Failed to create journal entry",
      error: error.message,
    });
  }
};

export const getAccountingFoundationAccountsController = async (req, res) => {
  try {
    const tenantId = isSuperAdminUser(req.user)
      ? getTenantId(req, req.query?.tenant_id || req.user?.tenant_id)
      : getTenantId(req, req.user?.tenant_id);

    if (!tenantId) {
      return res.status(400).json({
        success: false,
        message: "tenant_id is required to fetch chart of accounts",
      });
    }

    const accounts = await listFoundationAccounts(db, {
      tenantId,
      includeInactive: req.query.include_inactive === "true" || req.query.includeInactive === "true",
    });

    return res.status(200).json({
      success: true,
      accounts: accounts.rows,
      summary: accounts.summary,
    });
  } catch (error) {
    console.log(error);
    return res.status(error.status || 500).json({
      success: false,
      message: "Failed to fetch chart of accounts",
      error: error.message,
    });
  }
};

export const getJournalEntriesBackfillPreviewController = async (req, res) => {
  try {
    const tenantId = isSuperAdminUser(req.user)
      ? getTenantId(req, req.body?.tenant_id || req.query?.tenant_id || req.user?.tenant_id)
      : getTenantId(req, req.user?.tenant_id);

    if (!tenantId) {
      return res.status(400).json({
        success: false,
        message: "tenant_id is required to preview journal backfill",
      });
    }

    const preview = await getBackfillPreview({
      tenantId,
      sourceType: req.body?.source_type || req.body?.sourceType || "",
      fromDate: req.body?.from_date || req.body?.fromDate || null,
      toDate: req.body?.to_date || req.body?.toDate || null,
      limit: req.body?.limit || 25,
    });

    return res.status(200).json({
      success: true,
      ...preview,
    });
  } catch (error) {
    console.log(error);
    return res.status(error.status || 500).json({
      success: false,
      message: "Failed to preview journal backfill",
      error: error.message,
    });
  }
};

export const getGeneralLedgerAccountsController = async (req, res) => {
  try {
    const tenantId = isSuperAdminUser(req.user)
      ? getTenantId(req, req.query?.tenant_id || req.user?.tenant_id)
      : getTenantId(req, req.user?.tenant_id);

    if (!tenantId) {
      return res.status(400).json({
        success: false,
        message: "tenant_id is required to fetch general ledger accounts",
      });
    }

    const accounts = await listGeneralLedgerAccounts({ tenantId });
    return res.status(200).json({
      success: true,
      accounts,
    });
  } catch (error) {
    console.log(error);
    return res.status(error.status || 500).json({
      success: false,
      message: "Failed to fetch general ledger accounts",
      error: error.message,
    });
  }
};

export const getGeneralLedgerController = async (req, res) => {
  try {
    const tenantId = isSuperAdminUser(req.user)
      ? getTenantId(req, req.query?.tenant_id || req.user?.tenant_id)
      : getTenantId(req, req.user?.tenant_id);

    if (!tenantId) {
      return res.status(400).json({
        success: false,
        message: "tenant_id is required to fetch general ledger",
      });
    }

    const payload = await getGeneralLedger({
      tenantId,
      accountId: req.query.account_id || req.query.accountId,
      fromDate: req.query.from_date || req.query.fromDate || null,
      toDate: req.query.to_date || req.query.toDate || null,
      branchId: req.query.branch_id || req.query.branchId || null,
    });

    return res.status(200).json({
      success: true,
      ...payload,
    });
  } catch (error) {
    console.log(error);
    return res.status(error.status || 500).json({
      success: false,
      message: "Failed to fetch general ledger",
      error: error.message,
    });
  }
};

export const getTrialBalanceController = async (req, res) => {
  try {
    const tenantId = isSuperAdminUser(req.user)
      ? getTenantId(req, req.query?.tenant_id || req.user?.tenant_id)
      : getTenantId(req, req.user?.tenant_id);

    if (!tenantId) {
      return res.status(400).json({
        success: false,
        message: "tenant_id is required to fetch trial balance",
      });
    }

    const payload = await getTrialBalance({
      tenantId,
      fromDate: req.query.from_date || req.query.fromDate || null,
      toDate: req.query.to_date || req.query.toDate || null,
      branchId: req.query.branch_id || req.query.branchId || null,
    });

    return res.status(200).json({
      success: true,
      ...payload,
    });
  } catch (error) {
    console.log(error);
    return res.status(error.status || 500).json({
      success: false,
      message: "Failed to fetch trial balance",
      error: error.message,
    });
  }
};

export const rebuildLedgerEntriesController = async (req, res) => {
  const client = await db.connect();
  try {
    if (!isAdminUser(req.user)) {
      return res.status(403).json({
        success: false,
        message: "Admin access is required to rebuild accounting entries",
      });
    }

    const tenantId = isSuperAdminUser(req.user)
      ? getTenantId(req, req.body?.tenant_id || req.query?.tenant_id || req.user?.tenant_id)
      : getTenantId(req, req.user?.tenant_id);

    if (!tenantId) {
      return res.status(400).json({
        success: false,
        message: "tenant_id is required to rebuild accounting entries",
      });
    }

    await logAccountingAudit(db, {
      tenantId,
      userId: req.user?.id || null,
      action: "accounting_sync_started",
      entityType: "accounting_sync",
      metadata: {
        request_id: req.id || null,
      },
    });

    await client.query("BEGIN");
    const result = await rebuildLedgerEntries(client, {
      tenantId,
      createdBy: req.user?.id || null,
    });
    await client.query("COMMIT");

    await logAccountingAudit(db, {
      tenantId,
      userId: req.user?.id || null,
      action: "accounting_sync_completed",
      entityType: "accounting_sync",
      afterData: result,
      metadata: {
        created: result?.created || 0,
        skipped: result?.skipped || 0,
        deleted_old_generated_entries: result?.deleted_old_generated_entries || 0,
        warnings: result?.warnings || [],
      },
    });

    return res.status(200).json(result);
  } catch (error) {
    await client.query("ROLLBACK");
    const tenantId = isSuperAdminUser(req.user)
      ? getTenantId(req, req.body?.tenant_id || req.query?.tenant_id || req.user?.tenant_id)
      : getTenantId(req, req.user?.tenant_id);
    if (tenantId) {
      await logAccountingAudit(db, {
        tenantId,
        userId: req.user?.id || null,
        action: "accounting_sync_failed",
        entityType: "accounting_sync",
        metadata: {
          message: error.message,
          code: error.code || null,
        },
      }).catch((auditError) => console.error("[accounting:audit] sync failure log failed", auditError.message));
    }
    console.log(error);
    return res.status(500).json({
      success: false,
      message: "Failed to rebuild accounting entries",
      error: error.message,
    });
  } finally {
    client.release();
  }
};

export const getMissingCostItemsController = async (req, res) => {
  try {
    if (!isAdminUser(req.user)) {
      return res.status(403).json({
        success: false,
        message: "Admin access is required to inspect missing cost items",
      });
    }

    const tenantId = isSuperAdminUser(req.user)
      ? getTenantId(req, req.query?.tenant_id || req.user?.tenant_id)
      : getTenantId(req, req.user?.tenant_id);

    if (!tenantId) {
      return res.status(400).json({
        success: false,
        message: "tenant_id is required to inspect missing cost items",
      });
    }

    const result = await getMissingCostItems(db, { tenantId });
    return res.status(200).json(result);
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch missing cost items",
      error: error.message,
    });
  }
};

export const getAccountingAuditLogsController = async (req, res) => {
  try {
    const tenantId = isSuperAdminUser(req.user)
      ? getTenantId(req, req.query?.tenant_id || req.user?.tenant_id)
      : getTenantId(req, req.user?.tenant_id);

    if (!tenantId) {
      return res.status(400).json({
        success: false,
        message: "tenant_id is required to fetch accounting audit logs",
      });
    }

    const result = await getAccountingAuditLogs(db, {
      tenantId,
      fromDate: req.query.from_date || req.query.from || null,
      toDate: req.query.to_date || req.query.to || null,
      action: req.query.action || "",
      userId: req.query.user_id || req.query.userId || null,
      entityType: req.query.entity_type || req.query.entityType || "",
      search: req.query.search || "",
      limit: req.query.limit || 100,
      offset: req.query.offset || 0,
    });

    return res.status(200).json({
      success: true,
      rows: result.rows,
      pagination: {
        total: result.total,
        limit: result.limit,
        offset: result.offset,
      },
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch accounting audit logs",
      error: error.message,
    });
  }
};

export const logAccountingExportController = async (req, res) => {
  try {
    const tenantId = isSuperAdminUser(req.user)
      ? getTenantId(req, req.body?.tenant_id || req.query?.tenant_id || req.user?.tenant_id)
      : getTenantId(req, req.user?.tenant_id);

    if (!tenantId) {
      return res.status(400).json({
        success: false,
        message: "tenant_id is required to log accounting export",
      });
    }

    const audit = await logAccountingAudit(db, {
      tenantId,
      userId: req.user?.id || null,
      action: "export_generated",
      entityType: "accounting_export",
      metadata: {
        report_type: req.body?.report_type || req.body?.reportType || "accounting",
        format: req.body?.format || "",
        filters: req.body?.filters || {},
      },
    });

    return res.status(201).json({ success: true, audit });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      success: false,
      message: "Failed to log accounting export",
      error: error.message,
    });
  }
};

export const openCashDrawerShiftController = async (req, res) => {
  const client = await db.connect();
  try {
    const tenantId = isSuperAdminUser(req.user)
      ? getTenantId(req, req.body?.tenant_id || req.query?.tenant_id || req.user?.tenant_id)
      : getTenantId(req, req.user?.tenant_id);

    if (!tenantId) {
      return res.status(400).json({ success: false, message: "tenant_id is required to open a cash drawer shift" });
    }

    await client.query("BEGIN");
    const shift = await openCashDrawerShift(client, {
      tenantId,
      branchId: req.body?.branch_id || req.body?.branchId,
      financialAccountId: req.body?.financial_account_id || req.body?.financialAccountId || null,
      openingCash: req.body?.opening_cash ?? req.body?.openingCash ?? 0,
      notes: req.body?.notes || "",
      openedBy: req.user?.id || null,
    });
    const events = await getCashDrawerShiftEvents(client, { tenantId, shiftId: shift.id });
    await client.query("COMMIT");
    return res.status(201).json({ success: true, shift, events });
  } catch (error) {
    await client.query("ROLLBACK");
    console.log(error);
    return res.status(error.status || 500).json({
      success: false,
      message: error.message || "Failed to open cash drawer shift",
    });
  } finally {
    client.release();
  }
};

export const closeCashDrawerShiftController = async (req, res) => {
  const client = await db.connect();
  try {
    const tenantId = isSuperAdminUser(req.user)
      ? getTenantId(req, req.body?.tenant_id || req.query?.tenant_id || req.user?.tenant_id)
      : getTenantId(req, req.user?.tenant_id);

    if (!tenantId) {
      return res.status(400).json({ success: false, message: "tenant_id is required to close a cash drawer shift" });
    }

    await client.query("BEGIN");
    const shift = await closeCashDrawerShift(client, {
      tenantId,
      shiftId: req.params.id,
      actualCash: req.body?.actual_cash ?? req.body?.actualCash ?? 0,
      notes: req.body?.notes || "",
      closedBy: req.user?.id || null,
    });
    const events = await getCashDrawerShiftEvents(client, { tenantId, shiftId: shift.id });
    await client.query("COMMIT");
    return res.status(200).json({ success: true, shift, events });
  } catch (error) {
    await client.query("ROLLBACK");
    console.log(error);
    return res.status(error.status || 500).json({
      success: false,
      message: error.message || "Failed to close cash drawer shift",
    });
  } finally {
    client.release();
  }
};

export const getCurrentCashDrawerShiftController = async (req, res) => {
  try {
    const tenantId = isSuperAdminUser(req.user)
      ? getTenantId(req, req.query?.tenant_id || req.user?.tenant_id)
      : getTenantId(req, req.user?.tenant_id);
    if (!tenantId) {
      return res.status(400).json({ success: false, message: "tenant_id is required to fetch cash drawer shift" });
    }

    const shift = await getCurrentCashDrawerShift(db, {
      tenantId,
      userId: req.query.user_id || req.query.userId || req.user?.id,
      branchId: req.query.branch_id || req.query.branchId || null,
    });
    const events = shift ? await getCashDrawerShiftEvents(db, { tenantId, shiftId: shift.id }) : [];
    return res.status(200).json({ success: true, shift, events });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch current cash drawer shift",
      error: error.message,
    });
  }
};

export const getCashDrawerShiftHistoryController = async (req, res) => {
  try {
    const tenantId = isSuperAdminUser(req.user)
      ? getTenantId(req, req.query?.tenant_id || req.user?.tenant_id)
      : getTenantId(req, req.user?.tenant_id);
    if (!tenantId) {
      return res.status(400).json({ success: false, message: "tenant_id is required to fetch cash drawer history" });
    }

    const result = await getCashDrawerShiftHistory(db, {
      tenantId,
      branchId: req.query.branch_id || req.query.branchId || null,
      userId: req.query.user_id || req.query.userId || null,
      status: req.query.status || "",
      fromDate: req.query.from_date || req.query.from || null,
      toDate: req.query.to_date || req.query.to || null,
      limit: req.query.limit || 100,
      offset: req.query.offset || 0,
    });
    return res.status(200).json({ success: true, rows: result.rows, pagination: { limit: result.limit, offset: result.offset } });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch cash drawer history",
      error: error.message,
    });
  }
};

export const recordCashDrawerEventController = async (req, res) => {
  const client = await db.connect();
  try {
    const tenantId = isSuperAdminUser(req.user)
      ? getTenantId(req, req.body?.tenant_id || req.query?.tenant_id || req.user?.tenant_id)
      : getTenantId(req, req.user?.tenant_id);
    if (!tenantId) {
      return res.status(400).json({ success: false, message: "tenant_id is required to record a cash drawer event" });
    }

    await client.query("BEGIN");
    const event = await recordCashDrawerEvent(client, {
      tenantId,
      shiftId: req.params.id,
      branchId: req.body?.branch_id || req.body?.branchId,
      eventType: req.body?.event_type || req.body?.eventType,
      sourceType: req.body?.source_type || req.body?.sourceType || "manual",
      sourceId: req.body?.source_id || req.body?.sourceId || null,
      amount: req.body?.amount,
      createdBy: req.user?.id || null,
      requireOpenShift: true,
    });
    const shift = await getCurrentCashDrawerShift(client, {
      tenantId,
      userId: req.user?.id,
      branchId: req.body?.branch_id || req.body?.branchId,
    });
    const events = shift ? await getCashDrawerShiftEvents(client, { tenantId, shiftId: shift.id }) : [];
    await client.query("COMMIT");
    return res.status(201).json({ success: true, event, shift, events });
  } catch (error) {
    await client.query("ROLLBACK");
    console.log(error);
    return res.status(error.status || 500).json({
      success: false,
      message: error.message || "Failed to record cash drawer event",
    });
  } finally {
    client.release();
  }
};

export const getFinancialAccountsController = async (req, res) => {
  try {
    const tenantId = isSuperAdminUser(req.user)
      ? getTenantId(req, req.query?.tenant_id || req.user?.tenant_id)
      : getTenantId(req, req.user?.tenant_id);
    if (!tenantId) return res.status(400).json({ success: false, message: "tenant_id is required" });
    const rows = await getFinancialAccounts(db, {
      tenantId,
      accountType: req.query.account_type || req.query.accountType || "",
      branchId: req.query.branch_id || req.query.branchId || null,
      includeInactive: req.query.include_inactive === "true",
    });
    return res.status(200).json({ success: true, rows });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ success: false, message: "Failed to fetch financial accounts", error: error.message });
  }
};

export const createFinancialAccountController = async (req, res) => {
  const client = await db.connect();
  try {
    const tenantId = isSuperAdminUser(req.user)
      ? getTenantId(req, req.body?.tenant_id || req.query?.tenant_id || req.user?.tenant_id)
      : getTenantId(req, req.user?.tenant_id);
    if (!tenantId) return res.status(400).json({ success: false, message: "tenant_id is required" });
    await client.query("BEGIN");
    const account = await createFinancialAccount(client, {
      tenantId,
      ...req.body,
      createdBy: req.user?.id || null,
    });
    await client.query("COMMIT");
    return res.status(201).json({ success: true, account });
  } catch (error) {
    await client.query("ROLLBACK");
    console.log(error);
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to create financial account" });
  } finally {
    client.release();
  }
};

export const updateFinancialAccountController = async (req, res) => {
  const client = await db.connect();
  try {
    const tenantId = isSuperAdminUser(req.user)
      ? getTenantId(req, req.body?.tenant_id || req.query?.tenant_id || req.user?.tenant_id)
      : getTenantId(req, req.user?.tenant_id);
    if (!tenantId) return res.status(400).json({ success: false, message: "tenant_id is required" });
    await client.query("BEGIN");
    const account = await updateFinancialAccount(client, {
      tenantId,
      id: req.params.id,
      ...req.body,
      updatedBy: req.user?.id || null,
    });
    await client.query("COMMIT");
    return res.status(200).json({ success: true, account });
  } catch (error) {
    await client.query("ROLLBACK");
    console.log(error);
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to update financial account" });
  } finally {
    client.release();
  }
};

export const transferFinancialAccountsController = async (req, res) => {
  const client = await db.connect();
  try {
    const tenantId = isSuperAdminUser(req.user)
      ? getTenantId(req, req.body?.tenant_id || req.query?.tenant_id || req.user?.tenant_id)
      : getTenantId(req, req.user?.tenant_id);
    if (!tenantId) return res.status(400).json({ success: false, message: "tenant_id is required" });
    await client.query("BEGIN");
    const transfer = await transferFinancialAccounts(client, {
      tenantId,
      ...req.body,
      createdBy: req.user?.id || null,
    });
    await client.query("COMMIT");
    return res.status(201).json({ success: true, transfer });
  } catch (error) {
    await client.query("ROLLBACK");
    console.log(error);
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to transfer funds" });
  } finally {
    client.release();
  }
};

export const getFinancialAccountTransfersController = async (req, res) => {
  try {
    const tenantId = isSuperAdminUser(req.user)
      ? getTenantId(req, req.query?.tenant_id || req.user?.tenant_id)
      : getTenantId(req, req.user?.tenant_id);
    if (!tenantId) return res.status(400).json({ success: false, message: "tenant_id is required" });
    const rows = await getFinancialAccountTransfers(db, { tenantId });
    return res.status(200).json({ success: true, rows });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ success: false, message: "Failed to fetch financial account transfers", error: error.message });
  }
};

export const getFinancialAccountEntriesController = async (req, res) => {
  try {
    const tenantId = isSuperAdminUser(req.user)
      ? getTenantId(req, req.query?.tenant_id || req.user?.tenant_id)
      : getTenantId(req, req.user?.tenant_id);
    if (!tenantId) return res.status(400).json({ success: false, message: "tenant_id is required" });
    const rows = await getFinancialAccountEntries(db, { tenantId, accountId: req.params.id });
    return res.status(200).json({ success: true, rows });
  } catch (error) {
    console.log(error);
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to fetch financial account entries" });
  }
};

export const getPaymentMethodMappingsController = async (req, res) => {
  try {
    const tenantId = isSuperAdminUser(req.user)
      ? getTenantId(req, req.query?.tenant_id || req.user?.tenant_id)
      : getTenantId(req, req.user?.tenant_id);
    if (!tenantId) return res.status(400).json({ success: false, message: "tenant_id is required" });
    const rows = await getPaymentMethodMappings(db, { tenantId });
    return res.status(200).json({ success: true, rows });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ success: false, message: "Failed to fetch payment method mappings", error: error.message });
  }
};

export const createPaymentMethodMappingController = async (req, res) => {
  const client = await db.connect();
  try {
    const tenantId = isSuperAdminUser(req.user)
      ? getTenantId(req, req.body?.tenant_id || req.query?.tenant_id || req.user?.tenant_id)
      : getTenantId(req, req.user?.tenant_id);
    if (!tenantId) return res.status(400).json({ success: false, message: "tenant_id is required" });
    await client.query("BEGIN");
    const mapping = await createPaymentMethodMapping(client, {
      tenantId,
      ...req.body,
      createdBy: req.user?.id || null,
    });
    await client.query("COMMIT");
    return res.status(201).json({ success: true, mapping });
  } catch (error) {
    await client.query("ROLLBACK");
    console.log(error);
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to create payment method mapping" });
  } finally {
    client.release();
  }
};

export const updatePaymentMethodMappingController = async (req, res) => {
  const client = await db.connect();
  try {
    const tenantId = isSuperAdminUser(req.user)
      ? getTenantId(req, req.body?.tenant_id || req.query?.tenant_id || req.user?.tenant_id)
      : getTenantId(req, req.user?.tenant_id);
    if (!tenantId) return res.status(400).json({ success: false, message: "tenant_id is required" });
    await client.query("BEGIN");
    const mapping = await updatePaymentMethodMapping(client, {
      tenantId,
      id: req.params.id,
      ...req.body,
      updatedBy: req.user?.id || null,
    });
    await client.query("COMMIT");
    return res.status(200).json({ success: true, mapping });
  } catch (error) {
    await client.query("ROLLBACK");
    console.log(error);
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to update payment method mapping" });
  } finally {
    client.release();
  }
};

export const deletePaymentMethodMappingController = async (req, res) => {
  const client = await db.connect();
  try {
    const tenantId = isSuperAdminUser(req.user)
      ? getTenantId(req, req.query?.tenant_id || req.user?.tenant_id)
      : getTenantId(req, req.user?.tenant_id);
    if (!tenantId) return res.status(400).json({ success: false, message: "tenant_id is required" });
    await client.query("BEGIN");
    const result = await deletePaymentMethodMapping(client, {
      tenantId,
      id: req.params.id,
      deletedBy: req.user?.id || null,
    });
    await client.query("COMMIT");
    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    await client.query("ROLLBACK");
    console.log(error);
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to delete payment method mapping" });
  } finally {
    client.release();
  }
};

export const updateMissingItemCostsController = async (req, res) => {
  const client = await db.connect();
  try {
    if (!isAdminUser(req.user)) {
      return res.status(403).json({
        success: false,
        message: "Admin access is required to update product costs",
      });
    }

    const tenantId = isSuperAdminUser(req.user)
      ? getTenantId(req, req.body?.tenant_id || req.query?.tenant_id || req.user?.tenant_id)
      : getTenantId(req, req.user?.tenant_id);

    if (!tenantId) {
      return res.status(400).json({
        success: false,
        message: "tenant_id is required to update product costs",
      });
    }

    await client.query("BEGIN");
    const result = await updateMissingItemCosts(client, {
      tenantId,
      updates: req.body?.updates,
      createdBy: req.user?.id || null,
    });
    await client.query("COMMIT");
    return res.status(200).json(result);
  } catch (error) {
    await client.query("ROLLBACK");
    console.log(error);
    return res.status(500).json({
      success: false,
      message: "Failed to update product costs",
      error: error.message,
    });
  } finally {
    client.release();
  }
};

export const updateOrderLineCostOverridesController = async (req, res) => {
  const client = await db.connect();
  try {
    if (!isAdminUser(req.user)) {
      return res.status(403).json({
        success: false,
        message: "Admin access is required to update historical order line costs",
      });
    }

    const tenantId = isSuperAdminUser(req.user)
      ? getTenantId(req, req.body?.tenant_id || req.query?.tenant_id || req.user?.tenant_id)
      : getTenantId(req, req.user?.tenant_id);

    if (!tenantId) {
      return res.status(400).json({
        success: false,
        message: "tenant_id is required to update historical order line costs",
      });
    }

    await client.query("BEGIN");
    const result = await updateOrderLineCostOverrides(client, {
      tenantId,
      updates: req.body?.updates,
      createdBy: req.user?.id || null,
    });
    await client.query("COMMIT");
    return res.status(200).json(result);
  } catch (error) {
    await client.query("ROLLBACK");
    console.log(error);
    return res.status(500).json({
      success: false,
      message: "Failed to update historical order line costs",
      error: error.message,
    });
  } finally {
    client.release();
  }
};

export default getAccountingSummary;
