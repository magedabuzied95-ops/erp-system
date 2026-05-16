import db from "../database/db.js";
import { getTenantId, isSuperAdminUser } from "../utils/requestScope.js";
import {
  createJournalEntry,
  getAccountingDashboard,
  getJournalEntries,
  getJournalEntryDetail,
  seedDefaultAccounts,
} from "../services/accountingService.js";

export const getAccountingSummary = async (req, res) => {
  try {
    const tenantId = isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id);
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

export const getAccountingDashboardController = async (req, res) => {
  try {
    const tenantId = isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id);
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
    const tenantId = isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id);
    await seedDefaultAccounts(db, tenantId);
    const entry = await createJournalEntry(db, {
      tenantId,
      ...req.body,
      createdBy: req.user?.id || null,
    });
    return res.status(201).json({
      success: true,
      entry,
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      success: false,
      message: "Failed to create journal entry",
      error: error.message,
    });
  }
};

export default getAccountingSummary;
