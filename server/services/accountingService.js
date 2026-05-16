import db from "../database/db.js";

const DEFAULT_ACCOUNTS = [
  { code: "1200", name: "Inventory Asset", type: "asset" },
  { code: "1000", name: "Cash", type: "asset" },
  { code: "4000", name: "Sales Revenue", type: "revenue" },
  { code: "5000", name: "Cost Of Goods Sold", type: "expense" },
  { code: "2000", name: "Accounts Payable", type: "liability" },
  { code: "5100", name: "Purchase Expense", type: "expense" },
  { code: "4010", name: "Returns Inward", type: "revenue" },
  { code: "4020", name: "Returns Outward", type: "expense" },
  { code: "5300", name: "Stock Adjustment Gain/Loss", type: "expense" },
];

let schemaReadyPromise = null;

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const roundMoney = (value) => Math.round((toNumber(value, 0) + Number.EPSILON) * 100) / 100;

const moneyToCents = (value) => Math.round(roundMoney(value) * 100);

const centsToMoney = (value) => roundMoney((Number(value || 0) || 0) / 100);

const queryable = (clientOrPool = db) => clientOrPool || db;

const ensureColumns = async (client) => {
  await client.query(`ALTER TABLE IF EXISTS journal_entries ADD COLUMN IF NOT EXISTS reference_type VARCHAR(100)`);
  await client.query(`ALTER TABLE IF EXISTS journal_entries ADD COLUMN IF NOT EXISTS reference_id BIGINT`);
  await client.query(`ALTER TABLE IF EXISTS journal_entries ADD COLUMN IF NOT EXISTS description TEXT`);
  await client.query(`ALTER TABLE IF EXISTS journal_entries ADD COLUMN IF NOT EXISTS created_by BIGINT`);
  await client.query(`ALTER TABLE IF EXISTS journal_entries ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP`);
  await client.query(`ALTER TABLE IF EXISTS journal_entries ADD COLUMN IF NOT EXISTS notes TEXT`);

  await client.query(`ALTER TABLE IF EXISTS journal_entry_lines ADD COLUMN IF NOT EXISTS branch_id BIGINT`);
  await client.query(`ALTER TABLE IF EXISTS journal_entry_lines ADD COLUMN IF NOT EXISTS notes TEXT`);
  await client.query(`ALTER TABLE IF EXISTS journal_entry_lines ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP`);

  await client.query(`ALTER TABLE IF EXISTS accounts ADD COLUMN IF NOT EXISTS tenant_id BIGINT`);
  await client.query(`ALTER TABLE IF EXISTS accounts ADD COLUMN IF NOT EXISTS code VARCHAR(50)`);
  await client.query(`ALTER TABLE IF EXISTS accounts ADD COLUMN IF NOT EXISTS name VARCHAR(255)`);
  await client.query(`ALTER TABLE IF EXISTS accounts ADD COLUMN IF NOT EXISTS type VARCHAR(50)`);
  await client.query(`ALTER TABLE IF EXISTS accounts ADD COLUMN IF NOT EXISTS parent_id BIGINT`);
  await client.query(`ALTER TABLE IF EXISTS accounts ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE`);
  await client.query(`ALTER TABLE IF EXISTS accounts ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP`);
};

export const ensureAccountingSchema = async () => {
  if (!schemaReadyPromise) {
    schemaReadyPromise = (async () => {
      const client = await db.connect();
      try {
        await client.query("BEGIN");

        await client.query(`
          CREATE TABLE IF NOT EXISTS accounts (
            id BIGSERIAL PRIMARY KEY,
            tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            code VARCHAR(50) NOT NULL,
            name VARCHAR(255) NOT NULL,
            type VARCHAR(50) NOT NULL,
            parent_id BIGINT NULL REFERENCES accounts(id) ON DELETE SET NULL,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE (tenant_id, code)
          )
        `);

        await client.query(`
          CREATE TABLE IF NOT EXISTS journal_entries (
            id BIGSERIAL PRIMARY KEY,
            tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            entry_number VARCHAR(100) NOT NULL,
            status VARCHAR(50) NOT NULL DEFAULT 'posted',
            reference_type VARCHAR(100),
            reference_id BIGINT,
            description TEXT,
            notes TEXT,
            entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
            created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE (tenant_id, entry_number)
          )
        `);

        await client.query(`
          CREATE TABLE IF NOT EXISTS journal_entry_lines (
            id BIGSERIAL PRIMARY KEY,
            tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            journal_entry_id BIGINT NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
            account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
            debit NUMERIC(12,2) NOT NULL DEFAULT 0,
            credit NUMERIC(12,2) NOT NULL DEFAULT 0,
            branch_id BIGINT NULL REFERENCES branches(id) ON DELETE SET NULL,
            notes TEXT,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
          )
        `);

        await ensureColumns(client);

        await client.query(`CREATE INDEX IF NOT EXISTS idx_accounts_tenant_code ON accounts (tenant_id, code)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_accounts_tenant_type ON accounts (tenant_id, type)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_journal_entries_tenant_created_at ON journal_entries (tenant_id, created_at)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_journal_entries_reference ON journal_entries (tenant_id, reference_type, reference_id)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_journal_entry_lines_entry ON journal_entry_lines (journal_entry_id)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_journal_entry_lines_account ON journal_entry_lines (account_id)`);

        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    })();
  }

  return schemaReadyPromise;
};

const getTenantScope = (tenantId) => (tenantId === null || tenantId === undefined ? null : Number(tenantId));

export const seedDefaultAccounts = async (clientOrPool, tenantId) => {
  await ensureAccountingSchema();
  const dbClient = queryable(clientOrPool);
  const scopeTenantId = getTenantScope(tenantId);
  if (scopeTenantId === null) {
    throw new Error("tenantId is required");
  }

  const existing = await dbClient.query(
    `
    SELECT code, id
    FROM accounts
    WHERE tenant_id = $1
    `,
    [scopeTenantId]
  );

  const existingCodes = new Set(existing.rows.map((row) => String(row.code)));
  for (const account of DEFAULT_ACCOUNTS) {
    if (existingCodes.has(account.code)) continue;
    await dbClient.query(
      `
      INSERT INTO accounts (tenant_id, code, name, type, is_active)
      VALUES ($1,$2,$3,$4,true)
      `,
      [scopeTenantId, account.code, account.name, account.type]
    );
  }

  const accountRows = await dbClient.query(
    `
    SELECT id, code, name, type
    FROM accounts
    WHERE tenant_id = $1
    `,
    [scopeTenantId]
  );

  const map = new Map();
  accountRows.rows.forEach((row) => {
    map.set(String(row.code), row);
    map.set(String(row.name).toLowerCase(), row);
  });

  return map;
};

const resolveAccount = async (clientOrPool, tenantId, accountRef) => {
  const accounts = await seedDefaultAccounts(clientOrPool, tenantId);
  if (typeof accountRef === "number") {
    return { id: accountRef };
  }
  const key = String(accountRef || "").trim();
  const account = accounts.get(key) || accounts.get(key.toLowerCase()) || null;
  if (account) {
    return account;
  }
  if (/^\d+$/.test(key)) {
    return { id: Number(key) };
  }
  return null;
};

export const createJournalEntry = async (clientOrPool, data = {}) => {
  await ensureAccountingSchema();
  const dbClient = queryable(clientOrPool);
  const tenantId = getTenantScope(data.tenantId ?? data.tenant_id);
  if (tenantId === null) {
    throw new Error("tenantId is required");
  }

  const lines = Array.isArray(data.lines) ? data.lines : [];
  if (!lines.length) {
    throw new Error("At least one journal line is required");
  }

  const balanced = createBalancedEntry(lines);
  const entryNumber = String(data.entryNumber || data.entry_number || `JE-${Date.now()}`);
  const description = String(data.description || "").trim();
  const notes = String(data.notes || "").trim();
  const referenceType = data.referenceType || data.reference_type || null;
  const referenceId = data.referenceId || data.reference_id || null;

  const entryResult = await dbClient.query(
    `
    INSERT INTO journal_entries (
      tenant_id,
      entry_number,
      status,
      reference_type,
      reference_id,
      description,
      notes,
      entry_date,
      created_by,
      created_at,
      updated_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8, CURRENT_DATE),$9,NOW(),NOW())
    RETURNING *
    `,
    [
      tenantId,
      entryNumber,
      data.status || "posted",
      referenceType,
      referenceId,
      description,
      notes,
      data.entryDate || data.entry_date || null,
      data.createdBy ?? data.created_by ?? null,
    ]
  );

  const journalEntry = entryResult.rows[0];

  for (const line of balanced.lines) {
    const account = await resolveAccount(dbClient, tenantId, line.account_id ?? line.accountId ?? line.account_code ?? line.accountCode ?? line.account_name ?? line.accountName);
    if (!account?.id) {
      throw new Error(`Account not found for line ${line.account_name || line.accountCode || line.account_id}`);
    }

    await dbClient.query(
      `
      INSERT INTO journal_entry_lines (
        tenant_id,
        journal_entry_id,
        account_id,
        debit,
        credit,
        branch_id,
        notes,
        created_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
      `,
      [
        tenantId,
        journalEntry.id,
        account.id,
        line.debit,
        line.credit,
        line.branchId ?? line.branch_id ?? null,
        line.notes ?? line.note ?? "",
      ]
    );
  }

  return {
    ...journalEntry,
    lines: balanced.lines,
  };
};

export const createBalancedEntry = (lines = []) => {
  const normalized = lines.map((line) => ({
    ...line,
    debit: roundMoney(line.debit || 0),
    credit: roundMoney(line.credit || 0),
  }));

  const debitTotal = normalized.reduce((sum, line) => sum + moneyToCents(line.debit), 0);
  const creditTotal = normalized.reduce((sum, line) => sum + moneyToCents(line.credit), 0);

  if (debitTotal !== creditTotal) {
    throw new Error(`Journal entry is not balanced: debits ${centsToMoney(debitTotal)} credits ${centsToMoney(creditTotal)}`);
  }

  return {
    lines: normalized,
    debitTotal: centsToMoney(debitTotal),
    creditTotal: centsToMoney(creditTotal),
  };
};

const accountLine = (account, amount, side = "debit", notes = "", branchId = null) => ({
  account_id: account?.id || account?.account_id || account,
  debit: side === "debit" ? roundMoney(amount) : 0,
  credit: side === "credit" ? roundMoney(amount) : 0,
  notes,
  branchId,
});

export const postInventoryAdjustment = async (clientOrPool, data = {}) => {
  const tenantId = getTenantScope(data.tenantId ?? data.tenant_id);
  const dbClient = queryable(clientOrPool);
  const amount = roundMoney(data.amount ?? data.totalAmount ?? data.quantityChangeAmount ?? 0);
  if (amount === 0) return null;

  const inventory = await resolveAccount(dbClient, tenantId, "1200");
  const gainLoss = await resolveAccount(dbClient, tenantId, "5300");

  const isPositive = Number(data.quantityChange || data.quantity_change || 0) > 0;
  const lines = isPositive
    ? [
        accountLine(inventory, amount, "debit", data.notes, data.branchId || data.branch_id || null),
        accountLine(gainLoss, amount, "credit", data.notes, data.branchId || data.branch_id || null),
      ]
    : [
        accountLine(gainLoss, amount, "debit", data.notes, data.branchId || data.branch_id || null),
        accountLine(inventory, amount, "credit", data.notes, data.branchId || data.branch_id || null),
      ];

  return createJournalEntry(dbClient, {
    tenantId,
    entryNumber: data.entryNumber || data.entry_number,
    description: data.description || "Inventory adjustment",
    referenceType: data.referenceType || data.reference_type || "inventory",
    referenceId: data.referenceId || data.reference_id || null,
    createdBy: data.createdBy ?? data.created_by ?? null,
    branchId: data.branchId ?? data.branch_id ?? null,
    notes: data.notes || "",
    lines,
  });
};

export const postPurchaseEntry = async (clientOrPool, data = {}) => {
  const tenantId = getTenantScope(data.tenantId ?? data.tenant_id);
  const dbClient = queryable(clientOrPool);
  const amount = roundMoney(data.amount || data.total || 0);
  if (amount === 0) return null;

  const inventory = await resolveAccount(dbClient, tenantId, "1200");
  const payable = await resolveAccount(dbClient, tenantId, data.paymentType === "cash" ? "1000" : "2000");

  return createJournalEntry(dbClient, {
    tenantId,
    entryNumber: data.entryNumber || data.entry_number,
    description: data.description || "Purchase receipt",
    referenceType: data.referenceType || data.reference_type || "purchase",
    referenceId: data.referenceId || data.reference_id || null,
    createdBy: data.createdBy ?? data.created_by ?? null,
    branchId: data.branchId ?? data.branch_id ?? null,
    notes: data.notes || "",
    lines: [
      accountLine(inventory, amount, "debit", data.notes, data.branchId || data.branch_id || null),
      accountLine(payable, amount, "credit", data.notes, data.branchId || data.branch_id || null),
    ],
  });
};

export const postSaleEntry = async (clientOrPool, data = {}) => {
  const tenantId = getTenantScope(data.tenantId ?? data.tenant_id);
  const dbClient = queryable(clientOrPool);
  const saleAmount = roundMoney(data.saleAmount || data.amount || data.total || 0);
  const cogsAmount = roundMoney(data.cogsAmount || data.cogs || 0);
  if (saleAmount === 0 && cogsAmount === 0) return null;

  const cash = await resolveAccount(dbClient, tenantId, "1000");
  const revenue = await resolveAccount(dbClient, tenantId, "4000");
  const cogs = await resolveAccount(dbClient, tenantId, "5000");
  const inventory = await resolveAccount(dbClient, tenantId, "1200");

  return createJournalEntry(dbClient, {
    tenantId,
    entryNumber: data.entryNumber || data.entry_number,
    description: data.description || "POS sale",
    referenceType: data.referenceType || data.reference_type || "order",
    referenceId: data.referenceId || data.reference_id || null,
    createdBy: data.createdBy ?? data.created_by ?? null,
    branchId: data.branchId ?? data.branch_id ?? null,
    notes: data.notes || "",
    lines: [
      accountLine(cash, saleAmount, "debit", data.notes, data.branchId || data.branch_id || null),
      accountLine(revenue, saleAmount, "credit", data.notes, data.branchId || data.branch_id || null),
      ...(cogsAmount > 0
        ? [
            accountLine(cogs, cogsAmount, "debit", data.notes, data.branchId || data.branch_id || null),
            accountLine(inventory, cogsAmount, "credit", data.notes, data.branchId || data.branch_id || null),
          ]
        : []),
    ],
  });
};

export const postReturnEntry = async (clientOrPool, data = {}) => {
  const tenantId = getTenantScope(data.tenantId ?? data.tenant_id);
  const dbClient = queryable(clientOrPool);
  const amount = roundMoney(data.amount || data.refundAmount || 0);
  if (amount === 0) return null;

  const inventory = await resolveAccount(dbClient, tenantId, "1200");
  const returnsInward = await resolveAccount(dbClient, tenantId, "4010");
  const returnsOutward = await resolveAccount(dbClient, tenantId, "4020");
  const cash = await resolveAccount(dbClient, tenantId, "1000");
  const isIn = String(data.direction || data.returnType || "").toLowerCase() === "in";

  return createJournalEntry(dbClient, {
    tenantId,
    entryNumber: data.entryNumber || data.entry_number,
    description: data.description || "Return posting",
    referenceType: data.referenceType || data.reference_type || "return",
    referenceId: data.referenceId || data.reference_id || null,
    createdBy: data.createdBy ?? data.created_by ?? null,
    branchId: data.branchId ?? data.branch_id ?? null,
    notes: data.notes || "",
    lines: isIn
      ? [
          accountLine(inventory, amount, "debit", data.notes, data.branchId || data.branch_id || null),
          accountLine(returnsInward, amount, "credit", data.notes, data.branchId || data.branch_id || null),
        ]
      : [
          accountLine(returnsOutward, amount, "debit", data.notes, data.branchId || data.branch_id || null),
          accountLine(cash, amount, "credit", data.notes, data.branchId || data.branch_id || null),
        ],
  });
};

export const postWalletLiabilityEntry = async (clientOrPool, data = {}) => {
  const tenantId = getTenantScope(data.tenantId ?? data.tenant_id);
  const dbClient = queryable(clientOrPool);
  const amount = roundMoney(data.amount || 0);
  if (amount === 0) return null;

  const cash = await resolveAccount(dbClient, tenantId, "1000");
  const walletLiability = await resolveAccount(dbClient, tenantId, "2000");
  const returnsOutward = await resolveAccount(dbClient, tenantId, "4020");
  const direction = String(data.direction || "").toLowerCase();
  const isCredit = direction === "credit";

  return createJournalEntry(dbClient, {
    tenantId,
    entryNumber: data.entryNumber || data.entry_number,
    description: data.description || (isCredit ? "Wallet credit liability" : "Wallet payment liability usage"),
    referenceType: data.referenceType || data.reference_type || "wallet",
    referenceId: data.referenceId || data.reference_id || null,
    createdBy: data.createdBy ?? data.created_by ?? null,
    branchId: data.branchId ?? data.branch_id ?? null,
    notes: data.notes || "",
    lines: isCredit
      ? [
          accountLine(returnsOutward, amount, "debit", data.notes, data.branchId || data.branch_id || null),
          accountLine(walletLiability, amount, "credit", data.notes, data.branchId || data.branch_id || null),
        ]
      : [
          accountLine(walletLiability, amount, "debit", data.notes, data.branchId || data.branch_id || null),
          accountLine(cash, amount, "credit", data.notes, data.branchId || data.branch_id || null),
        ],
  });
};

export const getJournalEntries = async (clientOrPool, data = {}) => {
  await ensureAccountingSchema();
  const dbClient = queryable(clientOrPool);
  const tenantId = getTenantScope(data.tenantId ?? data.tenant_id);
  const search = String(data.search || "").trim();
  const referenceType = String(data.referenceType || data.reference_type || "").trim();
  const limit = Math.min(Math.max(toNumber(data.limit ?? 50, 50), 1), 200);
  const offset = Math.max(toNumber(data.offset ?? 0, 0), 0);
  const dateFrom = data.dateFrom || data.date_from || null;
  const dateTo = data.dateTo || data.date_to || null;

  const clauses = [];
  const params = [];
  const push = (value) => {
    params.push(value);
    return `$${params.length}`;
  };

  if (tenantId !== null) clauses.push(`je.tenant_id = ${push(tenantId)}`);
  if (search) {
    clauses.push(
      `(
        je.entry_number ILIKE ${push(`%${search}%`)} OR
        COALESCE(je.reference_type, '') ILIKE ${push(`%${search}%`)} OR
        COALESCE(je.description, '') ILIKE ${push(`%${search}%`)} OR
        EXISTS (
          SELECT 1
          FROM journal_entry_lines jel
          JOIN accounts a ON a.id = jel.account_id
          WHERE jel.journal_entry_id = je.id
            AND (a.name ILIKE ${push(`%${search}%`)} OR a.code ILIKE ${push(`%${search}%`)})
        )
      )`
    );
  }
  if (referenceType) clauses.push(`COALESCE(je.reference_type, '') = ${push(referenceType)}`);
  if (dateFrom) clauses.push(`je.entry_date >= ${push(dateFrom)}`);
  if (dateTo) clauses.push(`je.entry_date <= ${push(dateTo)}`);

  const whereClause = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";

  const [countResult, rowsResult] = await Promise.all([
    dbClient.query(
      `
      SELECT COUNT(*)::int AS count
      FROM journal_entries je
      ${whereClause}
      `,
      params
    ),
    dbClient.query(
      `
      SELECT
        je.*,
        COALESCE(SUM(jel.debit), 0) AS total_debit,
        COALESCE(SUM(jel.credit), 0) AS total_credit,
        COUNT(jel.id)::int AS line_count
      FROM journal_entries je
      LEFT JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
      ${whereClause}
      GROUP BY je.id
      ORDER BY je.created_at DESC, je.id DESC
      LIMIT $${params.length + 1}
      OFFSET $${params.length + 2}
      `,
      [...params, limit, offset]
    ),
  ]);

  return {
    rows: rowsResult.rows,
    total: Number(countResult.rows[0]?.count || 0),
    limit,
    offset,
  };
};

export const getJournalEntryDetail = async (clientOrPool, data = {}) => {
  await ensureAccountingSchema();
  const dbClient = queryable(clientOrPool);
  const tenantId = getTenantScope(data.tenantId ?? data.tenant_id);
  const journalEntryId = data.journalEntryId ?? data.journal_entry_id ?? data.id;
  if (!journalEntryId) throw new Error("journalEntryId is required");

  const entryResult = await dbClient.query(
    `
    SELECT *
    FROM journal_entries
    WHERE id = $1
      AND ($2::bigint IS NULL OR tenant_id = $2::bigint)
    `,
    [journalEntryId, tenantId]
  );

  if (!entryResult.rows[0]) return null;

  const linesResult = await dbClient.query(
    `
    SELECT
      jel.*,
      a.code AS account_code,
      a.name AS account_name,
      a.type AS account_type
    FROM journal_entry_lines jel
    JOIN accounts a ON a.id = jel.account_id
    WHERE jel.journal_entry_id = $1
      AND ($2::bigint IS NULL OR jel.tenant_id = $2::bigint)
    ORDER BY jel.id ASC
    `,
    [journalEntryId, tenantId]
  );

  return {
    ...entryResult.rows[0],
    lines: linesResult.rows,
  };
};

export const getAccountingDashboard = async (clientOrPool, data = {}) => {
  await ensureAccountingSchema();
  const dbClient = queryable(clientOrPool);
  const tenantId = getTenantScope(data.tenantId ?? data.tenant_id);

  const journalScopeClause = tenantId === null ? "" : "WHERE je.tenant_id = $1";
  const tableScopeClause = tenantId === null ? "" : "WHERE tenant_id = $1";
  const params = tenantId === null ? [] : [tenantId];

  const [revenueRows, expenseRows, inventoryRows, cogsRows, purchaseRows, orderRows, journalRows] = await Promise.all([
    dbClient.query(
      `
      SELECT COALESCE(SUM(credit - debit), 0) AS total
      FROM journal_entry_lines jel
      JOIN journal_entries je ON je.id = jel.journal_entry_id
      JOIN accounts a ON a.id = jel.account_id
      ${journalScopeClause}${journalScopeClause ? " AND" : " WHERE"} a.code = '4000'
      `,
      params
    ),
    dbClient.query(
      `
      SELECT COALESCE(SUM(debit - credit), 0) AS total
      FROM journal_entry_lines jel
      JOIN journal_entries je ON je.id = jel.journal_entry_id
      JOIN accounts a ON a.id = jel.account_id
      ${journalScopeClause}${journalScopeClause ? " AND" : " WHERE"} a.type = 'expense'
      `,
      params
    ),
    dbClient.query(
      `
      SELECT COALESCE(SUM(debit - credit), 0) AS total
      FROM journal_entry_lines jel
      JOIN journal_entries je ON je.id = jel.journal_entry_id
      JOIN accounts a ON a.id = jel.account_id
      ${journalScopeClause}${journalScopeClause ? " AND" : " WHERE"} a.code = '1200'
      `,
      params
    ),
    dbClient.query(
      `
      SELECT COALESCE(SUM(debit - credit), 0) AS total
      FROM journal_entry_lines jel
      JOIN journal_entries je ON je.id = jel.journal_entry_id
      JOIN accounts a ON a.id = jel.account_id
      ${journalScopeClause}${journalScopeClause ? " AND" : " WHERE"} a.code = '5000'
      `,
      params
    ),
    dbClient.query(
      `
      SELECT COALESCE(SUM(total), 0) AS total
      FROM purchases
      ${tableScopeClause}
      `,
      params
    ),
    dbClient.query(
      `
      SELECT COALESCE(SUM(total), 0) AS total
      FROM orders
      ${tableScopeClause}
      `,
      params
    ),
    dbClient.query(
      `
      SELECT COUNT(*)::int AS total
      FROM journal_entries
      ${tenantId === null ? "" : "WHERE tenant_id = $1"}
      `,
      params
    ),
  ]);

  const revenue = roundMoney(revenueRows.rows[0]?.total || 0);
  const expenses = roundMoney(expenseRows.rows[0]?.total || 0);
  const inventoryValue = roundMoney(inventoryRows.rows[0]?.total || 0);
  const cogs = roundMoney(cogsRows.rows[0]?.total || 0);
  const grossProfit = roundMoney(revenue - cogs);

  return {
    revenue,
    expenses,
    inventoryValue,
    cogs,
    grossProfit,
    totalJournalEntries: Number(journalRows.rows[0]?.total || 0),
    purchasesTotal: roundMoney(purchaseRows.rows[0]?.total || 0),
    salesTotal: roundMoney(orderRows.rows[0]?.total || 0),
  };
};
