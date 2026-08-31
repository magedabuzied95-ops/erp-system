import db from "../database/db.js";
import {
  createJournalEntry as baseCreateJournalEntry,
  ensureAccountingSchema,
  getJournalEntryDetail,
  seedDefaultAccounts,
} from "./accountingService.js";

const FOUNDATION_ACCOUNTS = [
  { code: "1000", name: "Cash خزنة", type: "asset" },
  { code: "1010", name: "Bank بنك", type: "asset" },
  { code: "1020", name: "Vodafone Cash", type: "asset" },
  { code: "1030", name: "Instapay", type: "asset" },
  { code: "1100", name: "Accounts Receivable العملاء", type: "asset" },
  { code: "1200", name: "Inventory المخزون", type: "asset" },
  { code: "1300", name: "Employee Advances سلف الموظفين", type: "asset" },
  { code: "2000", name: "Accounts Payable الموردين", type: "liability" },
  { code: "3000", name: "Owner Equity رأس المال", type: "equity" },
  { code: "3300", name: "Owner Drawings مسحوبات", type: "equity" },
  { code: "4000", name: "Sales Revenue المبيعات", type: "revenue" },
  { code: "4010", name: "Sales Returns مردودات المبيعات", type: "revenue" },
  { code: "5000", name: "COGS تكلفة البضاعة", type: "expense" },
  { code: "6100", name: "Rent Expense إيجار", type: "expense" },
  { code: "6200", name: "Salaries Expense مرتبات", type: "expense" },
  { code: "6300", name: "Marketing Expense تسويق", type: "expense" },
  { code: "6400", name: "Shipping Expense شحن", type: "expense" },
  { code: "6900", name: "Misc Expense مصروفات أخرى", type: "expense" },
];

const FOUNDATION_SOURCE_PREFIX = "accounting_foundation_v1";
const tableColumnsCache = new Map();

const normalizeTenantId = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const toMoney = (value, fallback = 0) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.round((parsed + Number.EPSILON) * 100) / 100;
};

const toDateOnly = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
};

const cents = (value) => Math.round(toMoney(value, 0) * 100);

const queryable = (clientOrPool = db) => clientOrPool || db;

const getTableColumns = async (clientOrPool, tableName) => {
  const cacheKey = String(tableName || "").trim().toLowerCase();
  if (tableColumnsCache.has(cacheKey)) {
    return await tableColumnsCache.get(cacheKey);
  }
  const dbClient = queryable(clientOrPool);
  const promise = dbClient
    .query(
      `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
      `,
      [cacheKey]
    )
    .then((result) => new Set(result.rows.map((row) => row.column_name)))
    .catch((error) => {
      tableColumnsCache.delete(cacheKey);
      throw error;
    });
  tableColumnsCache.set(cacheKey, promise);
  return await promise;
};

const ensureAccountingFoundationSchema = async (clientOrPool = db) => {
  await ensureAccountingSchema();
  const dbClient = queryable(clientOrPool);
  await dbClient.query(`ALTER TABLE IF EXISTS accounts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP`);
  await dbClient.query(`ALTER TABLE IF EXISTS accounts ADD COLUMN IF NOT EXISTS branch_id BIGINT NULL`);
  await dbClient.query(`ALTER TABLE IF EXISTS journal_entries ADD COLUMN IF NOT EXISTS branch_id BIGINT NULL`);
};

const defaultAccountInsertSql = (columns) => {
  const insertColumns = ["tenant_id", "code", "name", "type", "is_active", "created_at"];
  const values = ["$1", "$2", "$3", "$4", "TRUE", "NOW()"];
  if (columns.has("updated_at")) {
    insertColumns.push("updated_at");
    values.push("NOW()");
  }
  if (columns.has("branch_id")) {
    insertColumns.push("branch_id");
    values.push("NULL");
  }
  return {
    sql: `INSERT INTO accounts (${insertColumns.join(", ")}) VALUES (${values.join(", ")})`,
  };
};

const normalizeAccountRow = (row = {}) => ({
  id: Number(row.id),
  tenant_id: Number(row.tenant_id),
  branch_id: row.branch_id === null || row.branch_id === undefined ? null : Number(row.branch_id),
  account_code: row.code || row.account_code || "",
  account_name: row.name || row.account_name || "",
  account_type: row.type || row.account_type || "",
  parent_account_id: row.parent_id === null || row.parent_id === undefined ? null : Number(row.parent_id),
  parent_account_code: row.parent_code || "",
  parent_account_name: row.parent_name || "",
  is_active: row.is_active !== false,
  created_at: row.created_at || null,
  updated_at: row.updated_at || row.created_at || null,
});

const selectAccounts = async (clientOrPool, tenantId, options = {}) => {
  const dbClient = queryable(clientOrPool);
  const includeInactive = options.includeInactive === true;
  const result = await dbClient.query(
    `
    SELECT
      a.*,
      parent.code AS parent_code,
      parent.name AS parent_name
    FROM accounts a
    LEFT JOIN accounts parent ON parent.id = a.parent_id
    WHERE a.tenant_id = $1
      AND ($2::boolean = TRUE OR a.is_active = TRUE)
    ORDER BY a.code ASC, a.name ASC, a.id ASC
    `,
    [tenantId, includeInactive]
  );
  return result.rows.map(normalizeAccountRow);
};

const ensureDefaultAccountsFor = async (clientOrPool, tenantId) => {
  await ensureAccountingFoundationSchema(clientOrPool);
  const normalizedTenantId = normalizeTenantId(tenantId);
  if (!normalizedTenantId) {
    throw new Error("tenantId is required");
  }

  const dbClient = queryable(clientOrPool);
  await seedDefaultAccounts(dbClient, normalizedTenantId);

  const columns = await getTableColumns(dbClient, "accounts");
  const existingResult = await dbClient.query(
    `
    SELECT id, code, name
    FROM accounts
    WHERE tenant_id = $1
    `,
    [normalizedTenantId]
  );

  const byCode = new Set(existingResult.rows.map((row) => String(row.code || "").trim()));
  const byName = new Set(existingResult.rows.map((row) => String(row.name || "").trim().toLowerCase()));
  const { sql } = defaultAccountInsertSql(columns);

  for (const account of FOUNDATION_ACCOUNTS) {
    const normalizedName = String(account.name).trim().toLowerCase();
    if (byCode.has(account.code) || byName.has(normalizedName)) continue;
    await dbClient.query(sql, [normalizedTenantId, account.code, account.name, account.type]);
    byCode.add(account.code);
    byName.add(normalizedName);
  }

  return await selectAccounts(dbClient, normalizedTenantId, { includeInactive: true });
};

const sourceKeyFor = (sourceType, sourceId, suffix = "post") =>
  `${FOUNDATION_SOURCE_PREFIX}:${String(sourceType || "manual").trim().toLowerCase()}:${String(sourceId || "").trim()}:${suffix}`;

const linePayload = ({ accountCode, debit = 0, credit = 0, notes = "", branchId = null }) => ({
  account_code: accountCode,
  debit: toMoney(debit, 0),
  credit: toMoney(credit, 0),
  notes: String(notes || "").trim(),
  branch_id: branchId || null,
});

const paymentAccountCodeFor = (paymentMethod = "", fallback = "1000") => {
  const normalized = String(paymentMethod || "").trim().toLowerCase();
  if (!normalized) return fallback;
  if (normalized.includes("insta")) return "1030";
  if (normalized.includes("vodafone")) return "1020";
  if (["bank", "card", "visa", "mastercard", "transfer", "bank_transfer", "bank-transfer"].includes(normalized)) return "1010";
  if (["cash", "cash_on_delivery", "cod"].includes(normalized)) return "1000";
  return fallback;
};

const expenseAccountCodeFor = (expense = {}) => {
  if (expense.is_employee_advance) return "1300";
  const content = [
    expense.expense_type,
    expense.category,
    expense.title,
    expense.description,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (content.includes("rent") || content.includes("ايجار") || content.includes("إيجار")) return "6100";
  if (content.includes("salary") || content.includes("payroll") || content.includes("مرت") || content.includes("راتب")) return "6200";
  if (content.includes("market") || content.includes("ads") || content.includes("ad ") || content.includes("marketing") || content.includes("تسويق")) return "6300";
  if (content.includes("ship") || content.includes("deliver") || content.includes("شحن")) return "6400";
  return "6900";
};

const paymentStatusLabel = (value = "") => String(value || "").trim().toLowerCase();

const validateSourceNotPosted = async (clientOrPool, { tenantId, sourceType, sourceId, suffix = "post" }) => {
  const dbClient = queryable(clientOrPool);
  const result = await dbClient.query(
    `
    SELECT id, entry_number
    FROM journal_entries
    WHERE tenant_id = $1
      AND source_key = $2
    LIMIT 1
    `,
    [tenantId, sourceKeyFor(sourceType, sourceId, suffix)]
  );
  if (result.rows[0]) {
    const error = new Error(`Journal already exists for ${sourceType} #${sourceId}`);
    error.status = 409;
    throw error;
  }
};

export const validateJournalBalanced = (lines = []) => {
  if (!Array.isArray(lines) || !lines.length) {
    throw new Error("At least one journal line is required");
  }

  const normalizedLines = lines.map((line, index) => {
    const debit = toMoney(line.debit || 0, 0);
    const credit = toMoney(line.credit || 0, 0);
    const accountRef =
      line.account_id ??
      line.accountId ??
      line.account_code ??
      line.accountCode ??
      line.account_name ??
      line.accountName;

    if (!accountRef) {
      throw new Error(`Account is required for line ${index + 1}`);
    }
    if ((debit > 0 && credit > 0) || (debit <= 0 && credit <= 0)) {
      throw new Error(`Line ${index + 1} must contain either debit or credit`);
    }
    return {
      ...line,
      debit,
      credit,
    };
  });

  const totalDebit = normalizedLines.reduce((sum, line) => sum + cents(line.debit), 0);
  const totalCredit = normalizedLines.reduce((sum, line) => sum + cents(line.credit), 0);

  if (totalDebit !== totalCredit) {
    const error = new Error(`Journal entry is not balanced: debits ${toMoney(totalDebit / 100)} credits ${toMoney(totalCredit / 100)}`);
    error.status = 400;
    throw error;
  }

  return {
    lines: normalizedLines,
    totalDebit: toMoney(totalDebit / 100),
    totalCredit: toMoney(totalCredit / 100),
  };
};

const appendHeaderBranchId = async (clientOrPool, journalEntryId, branchId) => {
  const normalizedBranchId = normalizeTenantId(branchId);
  if (!journalEntryId) return;
  const columns = await getTableColumns(clientOrPool, "journal_entries");
  if (!columns.has("branch_id")) return;
  await queryable(clientOrPool).query(`UPDATE journal_entries SET branch_id = $2, updated_at = NOW() WHERE id = $1`, [journalEntryId, normalizedBranchId]);
};

export const getOrCreateDefaultAccounts = async (tenantId) => await ensureDefaultAccountsFor(db, tenantId);

export const listFoundationAccounts = async (clientOrPool, { tenantId, includeInactive = false } = {}) => {
  const normalizedTenantId = normalizeTenantId(tenantId);
  if (!normalizedTenantId) throw new Error("tenantId is required");
  await ensureDefaultAccountsFor(clientOrPool, normalizedTenantId);
  const rows = await selectAccounts(clientOrPool, normalizedTenantId, { includeInactive });
  const summary = rows.reduce(
    (acc, row) => {
      acc.total += 1;
      acc.active += row.is_active ? 1 : 0;
      acc.by_type[row.account_type] = (acc.by_type[row.account_type] || 0) + 1;
      return acc;
    },
    { total: 0, active: 0, by_type: {} }
  );
  return { rows, summary };
};

export const createJournalEntry = async ({
  client: providedClient = null,
  tenantId,
  branchId = null,
  sourceType = null,
  sourceId = null,
  entryDate = null,
  description = "",
  notes = "",
  lines = [],
  entryNumber = null,
  status = "posted",
  createdBy = null,
  isGenerated = false,
  entryType = "manual",
  sourceKey = null,
} = {}) => {
  const normalizedTenantId = normalizeTenantId(tenantId);
  if (!normalizedTenantId) throw new Error("tenantId is required");
  const balanced = validateJournalBalanced(lines);

  const client = providedClient || (await db.connect());
  const manageTransaction = !providedClient;
  try {
    if (manageTransaction) await client.query("BEGIN");
    await ensureDefaultAccountsFor(client, normalizedTenantId);
    if (sourceKey) {
      const existingSource = await client.query(
        `SELECT id FROM journal_entries WHERE tenant_id = $1 AND source_key = $2 LIMIT 1`,
        [normalizedTenantId, sourceKey]
      );
      if (existingSource.rows[0]) {
        const error = new Error(`Journal already exists for source key ${sourceKey}`);
        error.status = 409;
        throw error;
      }
    }

    const entry = await baseCreateJournalEntry(client, {
      tenantId: normalizedTenantId,
      branchId: branchId || null,
      referenceType: sourceType || "manual",
      referenceId: sourceId || null,
      entryDate: entryDate || null,
      description,
      notes,
      lines: balanced.lines,
      entryNumber: entryNumber || null,
      status,
      createdBy,
      isGenerated,
      entryType,
      sourceKey: sourceKey || null,
    });

    await appendHeaderBranchId(client, entry.id, branchId);
    const detailedEntry = await getJournalEntryDetail(client, {
      tenantId: normalizedTenantId,
      journalEntryId: entry.id,
    });
    if (manageTransaction) await client.query("COMMIT");
    return detailedEntry || entry;
  } catch (error) {
    if (manageTransaction) await client.query("ROLLBACK");
    throw error;
  } finally {
    if (manageTransaction) client.release();
  }
};

const buildOrderPreview = async (clientOrPool, { tenantId, orderId }) => {
  const result = await queryable(clientOrPool).query(
    `
    SELECT
      id,
      tenant_id,
      branch_id,
      payment_method,
      payment_status,
      paid_amount,
      customer_id,
      total_amount,
      total,
      total_price,
      is_personal_transaction,
      personal_settlement_type,
      notes,
      created_at
    FROM orders
    WHERE tenant_id = $1
      AND id = $2
    LIMIT 1
    `,
    [tenantId, orderId]
  );

  const order = result.rows[0];
  if (!order) throw new Error(`Order ${orderId} not found`);

  const total = toMoney(order.total_amount ?? order.total ?? order.total_price ?? 0, 0);
  const paidAmount = Math.max(0, Math.min(total, toMoney(order.paid_amount ?? 0, 0)));
  const remainingAmount = toMoney(Math.max(0, total - paidAmount), 0);
  const branchId = order.branch_id || null;
  const entryDate = toDateOnly(order.created_at);
  const paymentAccount = paymentAccountCodeFor(order.payment_method, "1000");
  const sourceType = "order";
  const sourceId = Number(order.id);
  const notes = String(order.notes || "").trim();

  let description = `Sales order #${order.id}`;
  let lines = [];

  if (order.is_personal_transaction) {
    const personalType = String(order.personal_settlement_type || "").trim().toUpperCase();
    if (personalType === "OWNER_USE") {
      description = `Owner use order #${order.id}`;
      lines = [
        linePayload({ accountCode: "3300", debit: total, notes: "Owner use", branchId }),
        linePayload({ accountCode: "1200", credit: total, notes: "Inventory issue", branchId }),
      ];
    } else if (personalType === "EMPLOYEE_ADVANCE") {
      description = `Employee advance order #${order.id}`;
      lines = [
        linePayload({ accountCode: "1300", debit: total, notes: "Employee advance", branchId }),
        linePayload({ accountCode: paymentAccount, credit: total, notes: order.payment_method || "cash", branchId }),
      ];
    } else {
      description = `Gift order #${order.id}`;
      lines = [
        linePayload({ accountCode: "6300", debit: total, notes: "Gift / marketing use", branchId }),
        linePayload({ accountCode: "1200", credit: total, notes: "Inventory issue", branchId }),
      ];
    }
  } else {
    description = `Sales order #${order.id}`;
    if (paidAmount > 0) {
      lines.push(linePayload({ accountCode: paymentAccount, debit: paidAmount, notes: order.payment_method || "cash", branchId }));
    }
    if (remainingAmount > 0 || paidAmount === 0 || ["unpaid", "credit", "partial", "partially_paid"].includes(paymentStatusLabel(order.payment_status))) {
      const arAmount = remainingAmount > 0 ? remainingAmount : total;
      if (arAmount > 0) {
        lines.push(linePayload({ accountCode: "1100", debit: arAmount, notes: "Accounts receivable", branchId }));
      }
    }
    lines.push(linePayload({ accountCode: "4000", credit: total, notes: "Sales revenue", branchId }));
  }

  const balanced = validateJournalBalanced(lines);
  return {
    source_type: sourceType,
    source_id: sourceId,
    branch_id: branchId,
    entry_date: entryDate,
    description,
    notes,
    lines: balanced.lines,
    totals: {
      debit: balanced.totalDebit,
      credit: balanced.totalCredit,
    },
  };
};

const buildPurchasePreview = async (clientOrPool, { tenantId, purchaseId }) => {
  const result = await queryable(clientOrPool).query(
    `
    SELECT
      id,
      tenant_id,
      payment_method,
      payment_status,
      supplier_payment_status,
      paid_amount,
      supplier_paid_amount,
      total,
      total_amount,
      net_total,
      grand_total,
      notes,
      created_at
    FROM purchases
    WHERE tenant_id = $1
      AND id = $2
    LIMIT 1
    `,
    [tenantId, purchaseId]
  );

  const purchase = result.rows[0];
  if (!purchase) throw new Error(`Purchase ${purchaseId} not found`);

  const total = toMoney(purchase.total ?? purchase.total_amount ?? purchase.net_total ?? purchase.grand_total ?? 0, 0);
  const paidAmount = Math.max(0, Math.min(total, toMoney(purchase.paid_amount ?? purchase.supplier_paid_amount ?? 0, 0)));
  const remainingAmount = toMoney(Math.max(0, total - paidAmount), 0);
  const paymentAccount = paymentAccountCodeFor(purchase.payment_method, "1000");
  const entryDate = toDateOnly(purchase.created_at);

  const lines = [linePayload({ accountCode: "1200", debit: total, notes: "Inventory purchase" })];
  if (paidAmount > 0) {
    lines.push(linePayload({ accountCode: paymentAccount, credit: paidAmount, notes: purchase.payment_method || "cash" }));
  }
  if (remainingAmount > 0 || paidAmount === 0 || ["unpaid", "credit", "partial", "partially_paid"].includes(paymentStatusLabel(purchase.payment_status || purchase.supplier_payment_status))) {
    const payableAmount = remainingAmount > 0 ? remainingAmount : total;
    if (payableAmount > 0) {
      lines.push(linePayload({ accountCode: "2000", credit: payableAmount, notes: "Accounts payable" }));
    }
  }

  const balanced = validateJournalBalanced(lines);
  return {
    source_type: "purchase",
    source_id: Number(purchase.id),
    branch_id: null,
    entry_date: entryDate,
    description: `Purchase #${purchase.id}`,
    notes: String(purchase.notes || "").trim(),
    lines: balanced.lines,
    totals: {
      debit: balanced.totalDebit,
      credit: balanced.totalCredit,
    },
  };
};

const buildExpensePreview = async (clientOrPool, { tenantId, expenseId }) => {
  const result = await queryable(clientOrPool).query(
    `
    SELECT
      id,
      tenant_id,
      branch_id,
      title,
      description,
      amount,
      expense_type,
      category,
      payment_method,
      is_employee_advance,
      created_at
    FROM expenses
    WHERE tenant_id = $1
      AND id = $2
    LIMIT 1
    `,
    [tenantId, expenseId]
  );

  const expense = result.rows[0];
  if (!expense) throw new Error(`Expense ${expenseId} not found`);

  const amount = toMoney(expense.amount || 0, 0);
  const branchId = expense.branch_id || null;
  const paymentAccount = paymentAccountCodeFor(expense.payment_method, "1000");
  const expenseAccount = expenseAccountCodeFor(expense);
  const lines = [
    linePayload({ accountCode: expenseAccount, debit: amount, notes: expense.title || expense.expense_type || "Expense", branchId }),
    linePayload({ accountCode: paymentAccount, credit: amount, notes: expense.payment_method || "cash", branchId }),
  ];
  const balanced = validateJournalBalanced(lines);

  return {
    source_type: "expense",
    source_id: Number(expense.id),
    branch_id: branchId,
    entry_date: toDateOnly(expense.created_at),
    description: `Expense #${expense.id} - ${expense.title || expense.expense_type || "expense"}`,
    notes: String(expense.description || "").trim(),
    lines: balanced.lines,
    totals: {
      debit: balanced.totalDebit,
      credit: balanced.totalCredit,
    },
  };
};

export const postJournalForOrder = async (orderId, options = {}) => {
  const tenantId = normalizeTenantId(options.tenantId ?? options.tenant_id);
  if (!tenantId) throw new Error("tenantId is required");
  const normalizedOrderId = Number(orderId);
  if (!Number.isFinite(normalizedOrderId) || normalizedOrderId <= 0) throw new Error("orderId is required");

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await validateSourceNotPosted(client, { tenantId, sourceType: "order", sourceId: normalizedOrderId });
    const preview = await buildOrderPreview(client, { tenantId, orderId: normalizedOrderId });
    const entry = await createJournalEntry({
      client,
      tenantId,
      branchId: preview.branch_id,
      sourceType: preview.source_type,
      sourceId: preview.source_id,
      entryDate: preview.entry_date,
      description: preview.description,
      notes: preview.notes,
      lines: preview.lines,
      createdBy: options.createdBy ?? options.created_by ?? null,
      isGenerated: true,
      entryType: "foundation_order_v1",
      sourceKey: sourceKeyFor("order", normalizedOrderId),
      entryNumber: `AF-ORD-${normalizedOrderId}`,
    });
    await client.query("COMMIT");
    return entry;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

export const postJournalForPurchase = async (purchaseId, options = {}) => {
  const tenantId = normalizeTenantId(options.tenantId ?? options.tenant_id);
  if (!tenantId) throw new Error("tenantId is required");
  const normalizedPurchaseId = Number(purchaseId);
  if (!Number.isFinite(normalizedPurchaseId) || normalizedPurchaseId <= 0) throw new Error("purchaseId is required");

  const preview = await buildPurchasePreview(db, { tenantId, purchaseId: normalizedPurchaseId });
  return await createJournalEntry({
    tenantId,
    branchId: preview.branch_id,
    sourceType: preview.source_type,
    sourceId: preview.source_id,
    entryDate: preview.entry_date,
    description: preview.description,
    notes: preview.notes,
    lines: preview.lines,
    createdBy: options.createdBy ?? options.created_by ?? null,
    isGenerated: true,
    entryType: "foundation_purchase_v1",
    sourceKey: sourceKeyFor("purchase", normalizedPurchaseId),
    entryNumber: `AF-PUR-${normalizedPurchaseId}`,
  });
};

export const postJournalForExpense = async (expenseId, options = {}) => {
  const tenantId = normalizeTenantId(options.tenantId ?? options.tenant_id);
  if (!tenantId) throw new Error("tenantId is required");
  const normalizedExpenseId = Number(expenseId);
  if (!Number.isFinite(normalizedExpenseId) || normalizedExpenseId <= 0) throw new Error("expenseId is required");

  const preview = await buildExpensePreview(db, { tenantId, expenseId: normalizedExpenseId });
  return await createJournalEntry({
    tenantId,
    branchId: preview.branch_id,
    sourceType: preview.source_type,
    sourceId: preview.source_id,
    entryDate: preview.entry_date,
    description: preview.description,
    notes: preview.notes,
    lines: preview.lines,
    createdBy: options.createdBy ?? options.created_by ?? null,
    isGenerated: true,
    entryType: "foundation_expense_v1",
    sourceKey: sourceKeyFor("expense", normalizedExpenseId),
    entryNumber: `AF-EXP-${normalizedExpenseId}`,
  });
};

export const reverseJournalEntry = async (sourceType, sourceId, reason = "", options = {}) => {
  const tenantId = normalizeTenantId(options.tenantId ?? options.tenant_id);
  if (!tenantId) throw new Error("tenantId is required");

  const normalizedSourceType = String(sourceType || "").trim().toLowerCase();
  const normalizedSourceId = Number(sourceId);
  if (!normalizedSourceType || !Number.isFinite(normalizedSourceId) || normalizedSourceId <= 0) {
    throw new Error("sourceType and sourceId are required");
  }

  await ensureAccountingFoundationSchema(db);
  const existingEntryResult = await db.query(
    `
    SELECT id
    FROM journal_entries
    WHERE tenant_id = $1
      AND source_key = $2
    LIMIT 1
    `,
    [tenantId, sourceKeyFor(normalizedSourceType, normalizedSourceId)]
  );
  const existingEntryId = existingEntryResult.rows[0]?.id;
  if (!existingEntryId) {
    throw new Error(`Posted journal for ${normalizedSourceType} #${normalizedSourceId} not found`);
  }

  const existingEntry = await getJournalEntryDetail(db, {
    tenantId,
    journalEntryId: existingEntryId,
  });
  if (!existingEntry) {
    throw new Error(`Posted journal for ${normalizedSourceType} #${normalizedSourceId} not found`);
  }

  const reverseKey = sourceKeyFor(normalizedSourceType, normalizedSourceId, "reverse");
  const duplicateReverse = await db.query(
    `SELECT id FROM journal_entries WHERE tenant_id = $1 AND source_key = $2 LIMIT 1`,
    [tenantId, reverseKey]
  );
  if (duplicateReverse.rows[0]) {
    const error = new Error(`Reversal already exists for ${normalizedSourceType} #${normalizedSourceId}`);
    error.status = 409;
    throw error;
  }

  const reversalLines = (existingEntry.lines || []).map((line) => ({
    account_id: line.account_id,
    debit: toMoney(line.credit || 0, 0),
    credit: toMoney(line.debit || 0, 0),
    notes: reason || `Reversal of ${existingEntry.entry_number || existingEntry.id}`,
    branch_id: line.branch_id || null,
  }));

  return await createJournalEntry({
    tenantId,
    branchId: existingEntry.branch_id || existingEntry.lines?.[0]?.branch_id || null,
    sourceType: `${normalizedSourceType}_reversal`,
    sourceId: normalizedSourceId,
    entryDate: toDateOnly(new Date()),
    description: `Reversal for ${existingEntry.entry_number || normalizedSourceType + "-" + normalizedSourceId}`,
    notes: String(reason || "").trim(),
    lines: reversalLines,
    createdBy: options.createdBy ?? options.created_by ?? null,
    isGenerated: true,
    entryType: "foundation_reversal_v1",
    sourceKey: reverseKey,
    entryNumber: `AF-REV-${normalizedSourceType.toUpperCase()}-${normalizedSourceId}`,
  });
};

const loadPreviewIds = async (clientOrPool, { tenantId, sourceType, fromDate, toDate, limit }) => {
  const dbClient = queryable(clientOrPool);
  const safeLimit = Math.min(Math.max(Number(limit || 25), 1), 100);
  const sources = [];

  const addDateRange = (clauses, params, column) => {
    if (fromDate) {
      params.push(fromDate);
      clauses.push(`DATE(${column}) >= $${params.length}`);
    }
    if (toDate) {
      params.push(toDate);
      clauses.push(`DATE(${column}) <= $${params.length}`);
    }
  };

  if (!sourceType || sourceType === "order") {
    const params = [tenantId];
    const clauses = ["tenant_id = $1"];
    addDateRange(clauses, params, "created_at");
    const result = await dbClient.query(
      `
      SELECT id
      FROM orders
      WHERE ${clauses.join(" AND ")}
      ORDER BY created_at DESC, id DESC
      LIMIT ${safeLimit}
      `,
      params
    );
    sources.push(...result.rows.map((row) => ({ source_type: "order", id: Number(row.id) })));
  }

  if (!sourceType || sourceType === "purchase") {
    const params = [tenantId];
    const clauses = ["tenant_id = $1"];
    addDateRange(clauses, params, "created_at");
    const result = await dbClient.query(
      `
      SELECT id
      FROM purchases
      WHERE ${clauses.join(" AND ")}
      ORDER BY created_at DESC, id DESC
      LIMIT ${safeLimit}
      `,
      params
    );
    sources.push(...result.rows.map((row) => ({ source_type: "purchase", id: Number(row.id) })));
  }

  if (!sourceType || sourceType === "expense") {
    const params = [tenantId];
    const clauses = ["tenant_id = $1"];
    addDateRange(clauses, params, "created_at");
    const result = await dbClient.query(
      `
      SELECT id
      FROM expenses
      WHERE ${clauses.join(" AND ")}
      ORDER BY created_at DESC, id DESC
      LIMIT ${safeLimit}
      `,
      params
    );
    sources.push(...result.rows.map((row) => ({ source_type: "expense", id: Number(row.id) })));
  }

  return sources.slice(0, safeLimit);
};

export const getBackfillPreview = async ({
  tenantId,
  sourceType = "",
  fromDate = null,
  toDate = null,
  limit = 25,
} = {}) => {
  const normalizedTenantId = normalizeTenantId(tenantId);
  if (!normalizedTenantId) throw new Error("tenantId is required");
  await ensureDefaultAccountsFor(db, normalizedTenantId);

  const normalizedSourceType = String(sourceType || "").trim().toLowerCase();
  const previewIds = await loadPreviewIds(db, {
    tenantId: normalizedTenantId,
    sourceType: normalizedSourceType || "",
    fromDate: toDateOnly(fromDate),
    toDate: toDateOnly(toDate),
    limit,
  });

  const items = [];
  for (const item of previewIds) {
    try {
      const existingResult = await db.query(
        `SELECT id FROM journal_entries WHERE tenant_id = $1 AND source_key = $2 LIMIT 1`,
        [normalizedTenantId, sourceKeyFor(item.source_type, item.id)]
      );
      if (existingResult.rows[0]) {
        items.push({
          source_type: item.source_type,
          source_id: item.id,
          status: "already_posted",
          reason: "Existing generated journal entry was found",
          lines: [],
          totals: { debit: 0, credit: 0 },
        });
        continue;
      }

      const preview =
        item.source_type === "order"
          ? await buildOrderPreview(db, { tenantId: normalizedTenantId, orderId: item.id })
          : item.source_type === "purchase"
            ? await buildPurchasePreview(db, { tenantId: normalizedTenantId, purchaseId: item.id })
            : await buildExpensePreview(db, { tenantId: normalizedTenantId, expenseId: item.id });

      items.push({
        ...preview,
        status: "ready",
        reason: "",
      });
    } catch (error) {
      items.push({
        source_type: item.source_type,
        source_id: item.id,
        status: "skipped",
        reason: error.message,
        lines: [],
        totals: { debit: 0, credit: 0 },
      });
    }
  }

  return {
    items,
    summary: {
      total: items.length,
      ready: items.filter((item) => item.status === "ready").length,
      skipped: items.filter((item) => item.status === "skipped").length,
      already_posted: items.filter((item) => item.status === "already_posted").length,
    },
  };
};

export const listGeneralLedgerAccounts = async ({ tenantId } = {}) => {
  const normalizedTenantId = normalizeTenantId(tenantId);
  if (!normalizedTenantId) throw new Error("tenantId is required");
  const accounts = await listFoundationAccounts(db, { tenantId: normalizedTenantId, includeInactive: false });
  return accounts.rows.map((account) => ({
    id: account.id,
    account_id: account.id,
    account_code: account.account_code,
    account_name: account.account_name,
    account_type: account.account_type,
  }));
};

export const getGeneralLedger = async ({
  tenantId,
  accountId,
  fromDate = null,
  toDate = null,
  branchId = null,
} = {}) => {
  const normalizedTenantId = normalizeTenantId(tenantId);
  const normalizedAccountId = normalizeTenantId(accountId);
  const normalizedBranchId = normalizeTenantId(branchId);
  const safeFromDate = toDateOnly(fromDate);
  const safeToDate = toDateOnly(toDate);

  if (!normalizedTenantId) throw new Error("tenantId is required");
  if (!normalizedAccountId) throw new Error("account_id is required");

  await ensureDefaultAccountsFor(db, normalizedTenantId);
  const accountResult = await db.query(
    `
    SELECT id, code, name, type
    FROM accounts
    WHERE tenant_id = $1
      AND id = $2
    LIMIT 1
    `,
    [normalizedTenantId, normalizedAccountId]
  );
  const account = accountResult.rows[0];
  if (!account) {
    const error = new Error(`Account ${normalizedAccountId} not found`);
    error.status = 404;
    throw error;
  }

  const openingClauses = ["jel.tenant_id = $1", "jel.account_id = $2"];
  const openingParams = [normalizedTenantId, normalizedAccountId];
  if (safeFromDate) {
    openingParams.push(safeFromDate);
    openingClauses.push(`je.entry_date < $${openingParams.length}`);
  }
  if (normalizedBranchId) {
    openingParams.push(normalizedBranchId);
    openingClauses.push(`jel.branch_id = $${openingParams.length}`);
  }

  const openingResult = await db.query(
    `
    SELECT
      COALESCE(SUM(jel.debit), 0)::numeric AS total_debit,
      COALESCE(SUM(jel.credit), 0)::numeric AS total_credit
    FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.journal_entry_id
    WHERE ${openingClauses.join(" AND ")}
    `,
    openingParams
  );

  const rowsClauses = ["jel.tenant_id = $1", "jel.account_id = $2"];
  const rowsParams = [normalizedTenantId, normalizedAccountId];
  if (safeFromDate) {
    rowsParams.push(safeFromDate);
    rowsClauses.push(`je.entry_date >= $${rowsParams.length}`);
  }
  if (safeToDate) {
    rowsParams.push(safeToDate);
    rowsClauses.push(`je.entry_date <= $${rowsParams.length}`);
  }
  if (normalizedBranchId) {
    rowsParams.push(normalizedBranchId);
    rowsClauses.push(`jel.branch_id = $${rowsParams.length}`);
  }

  const rowsResult = await db.query(
    `
    SELECT
      je.entry_date,
      je.id AS journal_entry_id,
      COALESCE(NULLIF(je.reference_type, ''), NULLIF(je.entry_type, ''), 'manual') AS source_type,
      COALESCE(je.description, '') AS description,
      COALESCE(jel.debit, 0)::numeric AS debit,
      COALESCE(jel.credit, 0)::numeric AS credit,
      jel.branch_id,
      je.reference_id
    FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.journal_entry_id
    WHERE ${rowsClauses.join(" AND ")}
    ORDER BY je.entry_date ASC, je.id ASC, jel.id ASC
    `,
    rowsParams
  );

  const openingBalance = toMoney(
    Number(openingResult.rows[0]?.total_debit || 0) - Number(openingResult.rows[0]?.total_credit || 0),
    0
  );
  let runningBalance = openingBalance;

  const rows = rowsResult.rows.map((row) => {
    const debit = toMoney(row.debit || 0, 0);
    const credit = toMoney(row.credit || 0, 0);
    runningBalance = toMoney(runningBalance + debit - credit, 0);
    return {
      date: row.entry_date,
      journal_entry_id: Number(row.journal_entry_id),
      reference: row.source_type || "manual",
      source_type: row.source_type || "manual",
      description: row.description || "",
      debit,
      credit,
      branch_id: row.branch_id === null || row.branch_id === undefined ? null : Number(row.branch_id),
      reference_id: row.reference_id === null || row.reference_id === undefined ? null : Number(row.reference_id),
      running_balance: runningBalance,
    };
  });

  const totals = rows.reduce(
    (acc, row) => {
      acc.total_debit = toMoney(acc.total_debit + row.debit, 0);
      acc.total_credit = toMoney(acc.total_credit + row.credit, 0);
      return acc;
    },
    {
      opening_balance: openingBalance,
      total_debit: 0,
      total_credit: 0,
      closing_balance: openingBalance,
    }
  );
  totals.closing_balance = rows.length ? rows[rows.length - 1].running_balance : openingBalance;

  return {
    account: {
      account_id: Number(account.id),
      account_code: account.code || "",
      account_name: account.name || "",
      account_type: account.type || "",
    },
    rows,
    totals,
  };
};

export const getTrialBalance = async ({
  tenantId,
  fromDate = null,
  toDate = null,
  branchId = null,
} = {}) => {
  const normalizedTenantId = normalizeTenantId(tenantId);
  const normalizedBranchId = normalizeTenantId(branchId);
  const safeFromDate = toDateOnly(fromDate);
  const safeToDate = toDateOnly(toDate);
  if (!normalizedTenantId) throw new Error("tenantId is required");

  await ensureDefaultAccountsFor(db, normalizedTenantId);

  const filterClauses = ["jel.tenant_id = $1"];
  const params = [normalizedTenantId];
  if (safeFromDate) {
    params.push(safeFromDate);
    filterClauses.push(`je.entry_date >= $${params.length}`);
  }
  if (safeToDate) {
    params.push(safeToDate);
    filterClauses.push(`je.entry_date <= $${params.length}`);
  }
  if (normalizedBranchId) {
    params.push(normalizedBranchId);
    filterClauses.push(`jel.branch_id = $${params.length}`);
  }
  const matchSql = filterClauses.join(" AND ");

  const result = await db.query(
    `
    SELECT
      a.id AS account_id,
      a.code AS account_code,
      a.name AS account_name,
      a.type AS account_type,
      COALESCE(SUM(CASE WHEN ${matchSql} THEN jel.debit ELSE 0 END), 0)::numeric AS total_debit,
      COALESCE(SUM(CASE WHEN ${matchSql} THEN jel.credit ELSE 0 END), 0)::numeric AS total_credit
    FROM accounts a
    LEFT JOIN journal_entry_lines jel
      ON jel.account_id = a.id
      AND jel.tenant_id = a.tenant_id
    LEFT JOIN journal_entries je
      ON je.id = jel.journal_entry_id
    WHERE a.tenant_id = $1
      AND a.is_active = TRUE
    GROUP BY a.id, a.code, a.name, a.type
    ORDER BY a.code ASC, a.name ASC, a.id ASC
    `,
    params
  );

  const rows = result.rows.map((row) => ({
    account_id: Number(row.account_id),
    account_code: row.account_code || "",
    account_name: row.account_name || "",
    account_type: row.account_type || "",
    total_debit: toMoney(row.total_debit || 0, 0),
    total_credit: toMoney(row.total_credit || 0, 0),
  }));

  const totals = rows.reduce(
    (acc, row) => {
      acc.total_debits = toMoney(acc.total_debits + row.total_debit, 0);
      acc.total_credits = toMoney(acc.total_credits + row.total_credit, 0);
      return acc;
    },
    { total_debits: 0, total_credits: 0 }
  );

  const tolerance = 0.01;
  return {
    rows,
    totals: {
      total_debits: totals.total_debits,
      total_credits: totals.total_credits,
      is_balanced: Math.abs(totals.total_debits - totals.total_credits) <= tolerance,
    },
  };
};
