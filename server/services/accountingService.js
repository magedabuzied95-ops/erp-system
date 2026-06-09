import db from "../database/db.js";

const DEFAULT_ACCOUNTS = [
  { code: "1200", name: "Inventory Asset", type: "asset" },
  { code: "1000", name: "Cash", type: "asset" },
  { code: "1100", name: "Accounts Receivable", type: "asset" },
  { code: "4000", name: "Sales Revenue", type: "revenue" },
  { code: "5000", name: "Cost Of Goods Sold", type: "expense" },
  { code: "2000", name: "Accounts Payable", type: "liability" },
  { code: "5200", name: "Operating Expenses", type: "expense" },
  { code: "5100", name: "Purchase Expense", type: "expense" },
  { code: "4010", name: "Returns Inward", type: "revenue" },
  { code: "4020", name: "Returns Outward", type: "expense" },
  { code: "5300", name: "Stock Adjustment Gain/Loss", type: "expense" },
];

const GENERATED_REFERENCE_TYPES = new Set([
  "order",
  "sale",
  "purchase",
  "expense",
  "return",
  "refund",
  "inventory",
  "manual_adjustment",
  "order_edit",
  "order_cancel",
  "wallet",
]);

let schemaReadyPromise = null;
let auditSchemaReadyPromise = null;

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const roundMoney = (value) => Math.round((toNumber(value, 0) + Number.EPSILON) * 100) / 100;

const moneyToCents = (value) => Math.round(roundMoney(value) * 100);

const centsToMoney = (value) => roundMoney((Number(value || 0) || 0) / 100);

const queryable = (clientOrPool = db) => clientOrPool || db;
const tableColumnCache = new Map();
const trimSlashes = (value = "") => String(value || "").trim().replace(/^\/+|\/+$/g, "");
const sanitizePublicOrigin = (value = "") => {
  const raw = String(value || "").trim().replace(/\/+$/g, "");
  if (!/^https?:\/\//i.test(raw)) return "";
  if (/localhost|127\.0\.0\.1/i.test(raw)) return "";
  return raw;
};
const getPublicBackendUrl = () =>
  [
    process.env.PUBLIC_BACKEND_URL,
    process.env.API_PUBLIC_URL,
    process.env.PUBLIC_APP_URL,
    process.env.FRONTEND_URL,
    process.env.VITE_API_URL,
  ]
    .map(sanitizePublicOrigin)
    .find(Boolean) || "";
const resolveReportImageUrl = (value = "") => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw.startsWith("data:") || raw.startsWith("blob:")) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/^\/\//.test(raw)) return `https:${raw}`;
  const publicBackendUrl = getPublicBackendUrl();
  const joinPublicUrl = (path) => `${publicBackendUrl}/${trimSlashes(path)}`;
  if (raw.startsWith("/uploads/")) return publicBackendUrl ? joinPublicUrl(raw) : raw;
  if (raw.startsWith("uploads/")) return publicBackendUrl ? joinPublicUrl(raw) : `/${trimSlashes(raw)}`;
  if (raw.startsWith("products/")) return publicBackendUrl ? joinPublicUrl(`/uploads/${raw}`) : `/uploads/${trimSlashes(raw)}`;
  if (raw.startsWith("/products/")) return publicBackendUrl ? joinPublicUrl(`/uploads${raw}`) : `/uploads${raw}`;
  if (raw.startsWith("/")) return publicBackendUrl ? joinPublicUrl(raw) : raw;
  return publicBackendUrl ? joinPublicUrl(`/uploads/products/${raw}`) : `/uploads/products/${trimSlashes(raw)}`;
};

const tableExists = async (clientOrPool, tableName) => {
  const dbClient = queryable(clientOrPool);
  const result = await dbClient.query(`SELECT to_regclass($1) AS table_name`, [`public.${tableName}`]);
  return Boolean(result.rows[0]?.table_name);
};

const getTableColumns = async (clientOrPool, tableName) => {
  const cacheKey = String(tableName || "");
  if (tableColumnCache.has(cacheKey)) return await tableColumnCache.get(cacheKey);
  const dbClient = queryable(clientOrPool);
  const columnsPromise = dbClient.query(
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
      tableColumnCache.delete(cacheKey);
      throw error;
    });
  tableColumnCache.set(cacheKey, columnsPromise);
  return await columnsPromise;
};

const getTableColumnsNow = async (clientOrPool, tableName) => {
  const dbClient = queryable(clientOrPool);
  const result = await dbClient.query(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = $1
    `,
    [String(tableName || "")]
  );
  return new Set(result.rows.map((row) => row.column_name));
};

export const reconcileMoneyAccountUniqueness = async (clientOrPool, options = {}) => {
  const dbClient = queryable(clientOrPool);
  if (!(await tableExists(dbClient, "money_accounts"))) return { merged: 0, normalized: 0 };
  const moneyAccountColumns = await getTableColumnsNow(dbClient, "money_accounts");
  const updatedAtSet = moneyAccountColumns.has("updated_at") ? ", updated_at = NOW()" : "";
  const normalizeBranchSet = moneyAccountColumns.has("updated_at") ? "branch_id = $1, updated_at = NOW()" : "branch_id = $1";

  const targetBranchId = numericFilter(options.branchId ?? options.branch_id);
  const targetBranchParam = targetBranchId || null;

  const duplicateResult = await dbClient.query(
    `
    WITH candidates AS (
      SELECT
        id,
        FIRST_VALUE(id) OVER (
          PARTITION BY tenant_id, LOWER(name), COALESCE(COALESCE($1::bigint, branch_id), 0)
          ORDER BY
            CASE WHEN is_active = TRUE THEN 0 ELSE 1 END,
            created_at ASC NULLS LAST,
            id ASC
        ) AS keeper_id
      FROM money_accounts
    )
    SELECT id, keeper_id
    FROM candidates
    WHERE id <> keeper_id
    `,
    [targetBranchParam]
  );

  if (duplicateResult.rows.length) {
    const mergeSql = `
      WITH candidates AS (
        SELECT
          id,
          FIRST_VALUE(id) OVER (
            PARTITION BY tenant_id, LOWER(name), COALESCE(COALESCE($1::bigint, branch_id), 0)
            ORDER BY
              CASE WHEN is_active = TRUE THEN 0 ELSE 1 END,
              created_at ASC NULLS LAST,
              id ASC
          ) AS keeper_id
        FROM money_accounts
      ),
      duplicate_map AS (
        SELECT id, keeper_id
        FROM candidates
        WHERE id <> keeper_id
      )
    `;

    if (await tableExists(dbClient, "money_transactions")) {
      await dbClient.query(
        `
        ${mergeSql}
        UPDATE money_transactions mt
        SET account_id = dm.keeper_id
        FROM duplicate_map dm
        WHERE mt.account_id = dm.id
        `,
        [targetBranchParam]
      );
    }

    const referenceUpdates = [
      ["expenses", "money_account_id"],
      ["employee_advances", "money_account_id"],
      ["purchases", "payment_account_id"],
      ["purchases", "money_account_id"],
    ];

    for (const [tableName, columnName] of referenceUpdates) {
      const columns = await getTableColumnsNow(dbClient, tableName);
      if (!columns.has(columnName)) continue;
      await dbClient.query(
        `
        ${mergeSql}
        UPDATE ${tableName} t
        SET ${columnName} = dm.keeper_id
        FROM duplicate_map dm
        WHERE t.${columnName} = dm.id
        `,
        [targetBranchParam]
      );
    }

    await dbClient.query(
      `
      WITH candidates AS (
        SELECT
          ma.*,
          FIRST_VALUE(id) OVER (
            PARTITION BY tenant_id, LOWER(name), COALESCE(COALESCE($1::bigint, branch_id), 0)
            ORDER BY
              CASE WHEN is_active = TRUE THEN 0 ELSE 1 END,
              created_at ASC NULLS LAST,
              id ASC
          ) AS keeper_id
        FROM money_accounts ma
      ),
      rollup AS (
        SELECT
          keeper_id,
          COUNT(*) AS row_count,
          SUM(COALESCE(opening_balance, 0)) AS opening_balance,
          SUM(COALESCE(current_balance, 0)) AS current_balance,
          BOOL_OR(is_active = TRUE) AS is_active,
          (ARRAY_AGG(financial_account_id ORDER BY CASE WHEN financial_account_id IS NULL THEN 1 ELSE 0 END, id ASC))[1] AS financial_account_id,
          (ARRAY_AGG(NULLIF(provider, '') ORDER BY CASE WHEN NULLIF(provider, '') IS NULL THEN 1 ELSE 0 END, id ASC))[1] AS provider
        FROM candidates
        GROUP BY keeper_id
        HAVING COUNT(*) > 1
      )
      UPDATE money_accounts ma
      SET
        financial_account_id = COALESCE(ma.financial_account_id, rollup.financial_account_id),
        provider = COALESCE(NULLIF(ma.provider, ''), rollup.provider, ''),
        opening_balance = rollup.opening_balance,
        current_balance = rollup.current_balance,
        is_active = rollup.is_active
        ${updatedAtSet}
      FROM rollup
      WHERE ma.id = rollup.keeper_id
      `,
      [targetBranchParam]
    );

    await dbClient.query(
      `
      ${mergeSql}
      DELETE FROM money_accounts ma
      USING duplicate_map dm
      WHERE ma.id = dm.id
      `,
      [targetBranchParam]
    );
  }

  let normalized = 0;
  if (targetBranchId) {
    const updateResult = await dbClient.query(
      `
      UPDATE money_accounts
      SET ${normalizeBranchSet}
      WHERE branch_id IS DISTINCT FROM $1
      `,
      [targetBranchId]
    );
    normalized = updateResult.rowCount || 0;
  }

  return { merged: duplicateResult.rows.length, normalized };
};

const firstColumn = (columns, names = []) => names.find((name) => columns.has(name)) || null;

const columnExpr = (alias, columns, names = [], fallback = "0") => {
  const column = firstColumn(columns, names);
  return column ? `${alias}.${column}` : fallback;
};

const coalesceColumnExpr = (alias, columns, names = [], fallback = "0") => {
  const expressions = names.filter((name) => columns.has(name)).map((name) => `${alias}.${name}`);
  return expressions.length ? `COALESCE(${[...expressions, fallback].join(", ")})` : fallback;
};

const positiveCoalesceColumnExpr = (alias, columns, names = [], fallback = "0") => {
  const expressions = names.filter((name) => columns.has(name)).map((name) => `NULLIF(${alias}.${name}, 0)`);
  return expressions.length ? `COALESCE(${[...expressions, fallback].join(", ")})` : fallback;
};

const parseDateFilter = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
};

const numericFilter = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const textFilter = (value) => {
  const parsed = String(value || "").trim().toLowerCase();
  return parsed || null;
};

const addScopedWhere = ({ clauses, params, alias, columns, tenantId, fromDate, toDate, branchId, dateColumns = ["created_at"] }) => {
  const add = (value) => {
    params.push(value);
    return `$${params.length}`;
  };
  if (tenantId !== null && columns.has("tenant_id")) clauses.push(`${alias}.tenant_id = ${add(tenantId)}`);
  const dateColumn = firstColumn(columns, dateColumns);
  if (dateColumn && fromDate) clauses.push(`DATE(${alias}.${dateColumn}) >= ${add(fromDate)}`);
  if (dateColumn && toDate) clauses.push(`DATE(${alias}.${dateColumn}) <= ${add(toDate)}`);
  if (branchId && columns.has("branch_id")) clauses.push(`${alias}.branch_id = ${add(branchId)}`);
  return { add };
};

const whereSql = (clauses) => (clauses.length ? `WHERE ${clauses.join(" AND ")}` : "");

const paidOrderClauses = (orderColumns) => {
  const statusExpr = orderColumns.has("status") ? "LOWER(COALESCE(o.status, ''))" : "''";
  const paymentStatusExpr = orderColumns.has("payment_status") ? "LOWER(COALESCE(o.payment_status, ''))" : "''";
  return [
    `${statusExpr} NOT IN ('cancelled', 'canceled', 'void', 'refunded', 'returned', 'draft', 'deleted')`,
    `(
      ${paymentStatusExpr} IN ('paid', 'completed', 'complete', 'partially_paid', 'partial')
      OR ${statusExpr} IN ('paid', 'completed', 'complete', 'delivered')
    )`,
  ];
};

const purchaseCostLookup = ({
  purchaseColumns,
  purchaseItemColumns,
  variantColumns,
  productIdExpr,
  variantIdExpr,
  tenantParam = "$1",
  alias = "pcost",
}) => {
  if (!purchaseColumns.size || !purchaseItemColumns.size) {
    return { join: "", expr: "0" };
  }

  const purchaseCostExpr = positiveCoalesceColumnExpr("pi", purchaseItemColumns, ["unit_cost", "cost_price", "purchase_price", "purchase_cost", "price"], "0");
  const purchaseProductIdExpr = purchaseItemColumns.has("product_id")
    ? `COALESCE(pi.product_id, ${variantColumns.size && purchaseItemColumns.has("variant_id") ? "ppv.product_id" : "NULL::bigint"})`
    : variantColumns.size && purchaseItemColumns.has("variant_id")
      ? "ppv.product_id"
      : "NULL::bigint";
  const purchaseVariantIdExpr = purchaseItemColumns.has("variant_id") ? "pi.variant_id" : "NULL::bigint";
  const purchaseDateExpr = columnExpr("pu", purchaseColumns, ["created_at", "purchase_date", "date"], "CURRENT_TIMESTAMP");
  const purchaseVariantJoin = variantColumns.size && purchaseItemColumns.has("variant_id") ? "LEFT JOIN product_variants ppv ON ppv.id = pi.variant_id AND ppv.tenant_id = pu.tenant_id" : "";
  const purchaseTenantClause = purchaseItemColumns.has("tenant_id") ? `AND pi.tenant_id = ${tenantParam}` : "";
  const purchaseStatusClause = purchaseColumns.has("status") ? "AND LOWER(COALESCE(pu.status, '')) NOT IN ('cancelled', 'canceled', 'void', 'deleted', 'draft')" : "";
  const matchClause = `
    ${purchaseProductIdExpr} = (${productIdExpr})
    AND (
      ((${variantIdExpr}) IS NOT NULL AND ${purchaseVariantIdExpr} = (${variantIdExpr}))
      OR ((${variantIdExpr}) IS NULL)
    )
  `;
  const baseFrom = `
    FROM purchase_items pi
    JOIN purchases pu ON pu.id = pi.purchase_id AND pu.tenant_id = ${tenantParam}
    ${purchaseVariantJoin}
    WHERE (${productIdExpr}) IS NOT NULL
      ${purchaseTenantClause}
      ${purchaseStatusClause}
      AND GREATEST(${purchaseCostExpr}, 0) > 0
      AND ${matchClause}
  `;

  return {
    join: `
      LEFT JOIN LATERAL (
        SELECT COALESCE(
          (
            SELECT GREATEST(${purchaseCostExpr}, 0)::numeric
            ${baseFrom}
            ORDER BY ${purchaseDateExpr} DESC, pi.id DESC
            LIMIT 1
          ),
          (
            SELECT AVG(GREATEST(${purchaseCostExpr}, 0))::numeric
            ${baseFrom}
          ),
          0
        ) AS unit_cost
      ) ${alias} ON TRUE
    `,
    expr: `${alias}.unit_cost`,
  };
};

const ensureColumns = async (client) => {
  await client.query(`ALTER TABLE IF EXISTS journal_entries ADD COLUMN IF NOT EXISTS reference_type VARCHAR(100)`);
  await client.query(`ALTER TABLE IF EXISTS journal_entries ADD COLUMN IF NOT EXISTS reference_id BIGINT`);
  await client.query(`ALTER TABLE IF EXISTS journal_entries ADD COLUMN IF NOT EXISTS description TEXT`);
  await client.query(`ALTER TABLE IF EXISTS journal_entries ADD COLUMN IF NOT EXISTS created_by BIGINT`);
  await client.query(`ALTER TABLE IF EXISTS journal_entries ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP`);
  await client.query(`ALTER TABLE IF EXISTS journal_entries ADD COLUMN IF NOT EXISTS notes TEXT`);
  await client.query(`ALTER TABLE IF EXISTS journal_entries ADD COLUMN IF NOT EXISTS is_generated BOOLEAN NOT NULL DEFAULT FALSE`);
  await client.query(`ALTER TABLE IF EXISTS journal_entries ADD COLUMN IF NOT EXISTS entry_type VARCHAR(100)`);
  await client.query(`ALTER TABLE IF EXISTS journal_entries ADD COLUMN IF NOT EXISTS source_key VARCHAR(255)`);

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

const ensureAccountingAuditSchema = async () => {
  if (!auditSchemaReadyPromise) {
    auditSchemaReadyPromise = (async () => {
      await db.query(`
        CREATE TABLE IF NOT EXISTS accounting_audit_logs (
          id BIGSERIAL PRIMARY KEY,
          tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          user_id BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
          action VARCHAR(120) NOT NULL,
          entity_type VARCHAR(120) NOT NULL,
          entity_id BIGINT NULL,
          before_data JSONB NULL,
          after_data JSONB NULL,
          metadata JSONB NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_accounting_audit_logs_tenant_created ON accounting_audit_logs (tenant_id, created_at DESC)`);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_accounting_audit_logs_filters ON accounting_audit_logs (tenant_id, action, entity_type, user_id)`);
    })().catch((error) => {
      auditSchemaReadyPromise = null;
      throw error;
    });
  }

  return auditSchemaReadyPromise;
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
        await client.query(`
          CREATE UNIQUE INDEX IF NOT EXISTS idx_journal_entries_generated_source
          ON journal_entries (tenant_id, reference_type, reference_id, entry_type)
          WHERE is_generated = TRUE
            AND reference_type IS NOT NULL
            AND reference_id IS NOT NULL
            AND entry_type IS NOT NULL
        `);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_journal_entry_lines_entry ON journal_entry_lines (journal_entry_id)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_journal_entry_lines_account ON journal_entry_lines (account_id)`);

        await client.query(`
          CREATE TABLE IF NOT EXISTS accounting_order_item_cost_overrides (
            id BIGSERIAL PRIMARY KEY,
            tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            order_item_id BIGINT NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
            product_id BIGINT NULL REFERENCES products(id) ON DELETE SET NULL,
            variant_id BIGINT NULL REFERENCES product_variants(id) ON DELETE SET NULL,
            unit_cost NUMERIC(12,2) NOT NULL,
            reason TEXT NOT NULL DEFAULT '',
            created_by BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE (tenant_id, order_item_id)
          )
        `);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_cost_overrides_tenant_item ON accounting_order_item_cost_overrides (tenant_id, order_item_id)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_cost_overrides_product_variant ON accounting_order_item_cost_overrides (tenant_id, product_id, variant_id)`);

        await client.query(`
          CREATE TABLE IF NOT EXISTS accounting_audit_logs (
            id BIGSERIAL PRIMARY KEY,
            tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            user_id BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
            action VARCHAR(120) NOT NULL,
            entity_type VARCHAR(120) NOT NULL,
            entity_id BIGINT NULL,
            before_data JSONB NULL,
            after_data JSONB NULL,
            metadata JSONB NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
          )
        `);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_accounting_audit_logs_tenant_created ON accounting_audit_logs (tenant_id, created_at DESC)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_accounting_audit_logs_filters ON accounting_audit_logs (tenant_id, action, entity_type, user_id)`);

        await client.query(`
          CREATE TABLE IF NOT EXISTS cash_drawer_shifts (
            id BIGSERIAL PRIMARY KEY,
            tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            branch_id BIGINT NULL REFERENCES branches(id) ON DELETE SET NULL,
            financial_account_id BIGINT NULL,
            opened_by BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
            closed_by BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
            opened_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            closed_at TIMESTAMP NULL,
            opening_cash NUMERIC(12,2) NOT NULL DEFAULT 0,
            expected_cash NUMERIC(12,2) NOT NULL DEFAULT 0,
            actual_cash NUMERIC(12,2) NULL,
            difference NUMERIC(12,2) NOT NULL DEFAULT 0,
            status VARCHAR(20) NOT NULL DEFAULT 'open',
            notes TEXT NOT NULL DEFAULT ''
          )
        `);
        await client.query(`ALTER TABLE IF EXISTS cash_drawer_shifts ADD COLUMN IF NOT EXISTS financial_account_id BIGINT NULL`);
        await client.query(`ALTER TABLE IF EXISTS cash_drawer_shifts ADD COLUMN IF NOT EXISTS opened_by_user_id BIGINT NULL REFERENCES users(id) ON DELETE RESTRICT`);
        await client.query(`ALTER TABLE IF EXISTS cash_drawer_shifts ADD COLUMN IF NOT EXISTS closed_by_user_id BIGINT NULL REFERENCES users(id) ON DELETE SET NULL`);
        await client.query(`ALTER TABLE IF EXISTS cash_drawer_shifts ADD COLUMN IF NOT EXISTS closing_cash NUMERIC(12,2) NULL`);
        await client.query(`ALTER TABLE IF EXISTS cash_drawer_shifts ADD COLUMN IF NOT EXISTS cash_difference NUMERIC(12,2) NOT NULL DEFAULT 0`);
        await client.query(`UPDATE cash_drawer_shifts SET opened_by_user_id = opened_by WHERE opened_by_user_id IS NULL`);
        await client.query(`UPDATE cash_drawer_shifts SET closed_by_user_id = closed_by WHERE closed_by_user_id IS NULL AND closed_by IS NOT NULL`);
        await client.query(`UPDATE cash_drawer_shifts SET closing_cash = actual_cash WHERE closing_cash IS NULL AND actual_cash IS NOT NULL`);
        await client.query(`UPDATE cash_drawer_shifts SET cash_difference = difference WHERE cash_difference IS DISTINCT FROM difference`);
        await client.query(`
          CREATE UNIQUE INDEX IF NOT EXISTS idx_cash_drawer_one_open_shift
          ON cash_drawer_shifts (tenant_id, branch_id, opened_by)
          WHERE status = 'open'
        `);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_pos_shifts_user_branch_status ON cash_drawer_shifts (opened_by_user_id, branch_id, status)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_cash_drawer_shifts_tenant_status ON cash_drawer_shifts (tenant_id, status, opened_at DESC)`);

        await client.query(`
          CREATE TABLE IF NOT EXISTS cash_drawer_shift_events (
            id BIGSERIAL PRIMARY KEY,
            tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            shift_id BIGINT NOT NULL REFERENCES cash_drawer_shifts(id) ON DELETE CASCADE,
            event_type VARCHAR(50) NOT NULL,
            source_type VARCHAR(100) NULL,
            source_id BIGINT NULL,
            amount NUMERIC(12,2) NOT NULL DEFAULT 0,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            created_by BIGINT NULL REFERENCES users(id) ON DELETE SET NULL
          )
        `);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_cash_drawer_events_shift ON cash_drawer_shift_events (tenant_id, shift_id, created_at DESC)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_cash_drawer_events_source ON cash_drawer_shift_events (tenant_id, source_type, source_id)`);

        await client.query(`
          CREATE TABLE IF NOT EXISTS financial_accounts (
            id BIGSERIAL PRIMARY KEY,
            tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            name VARCHAR(255) NOT NULL,
            account_type VARCHAR(50) NOT NULL,
            currency VARCHAR(10) NOT NULL DEFAULT 'EGP',
            branch_id BIGINT NULL REFERENCES branches(id) ON DELETE SET NULL,
            opening_balance NUMERIC(12,2) NOT NULL DEFAULT 0,
            current_balance NUMERIC(12,2) NOT NULL DEFAULT 0,
            allow_negative_balance BOOLEAN NOT NULL DEFAULT FALSE,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            notes TEXT NOT NULL DEFAULT '',
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
          )
        `);
        await client.query(`ALTER TABLE IF EXISTS financial_accounts ADD COLUMN IF NOT EXISTS allow_negative_balance BOOLEAN NOT NULL DEFAULT FALSE`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_financial_accounts_tenant_type ON financial_accounts (tenant_id, account_type, is_active)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_financial_accounts_branch ON financial_accounts (tenant_id, branch_id)`);

        await client.query(`
          CREATE TABLE IF NOT EXISTS financial_account_transfers (
            id BIGSERIAL PRIMARY KEY,
            tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            from_account_id BIGINT NOT NULL REFERENCES financial_accounts(id) ON DELETE RESTRICT,
            to_account_id BIGINT NOT NULL REFERENCES financial_accounts(id) ON DELETE RESTRICT,
            amount NUMERIC(12,2) NOT NULL,
            notes TEXT NOT NULL DEFAULT '',
            created_by BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
          )
        `);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_financial_account_transfers_tenant_created ON financial_account_transfers (tenant_id, created_at DESC)`);

        await client.query(`
          CREATE TABLE IF NOT EXISTS financial_account_entries (
            id BIGSERIAL PRIMARY KEY,
            tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            financial_account_id BIGINT NOT NULL REFERENCES financial_accounts(id) ON DELETE CASCADE,
            entry_type VARCHAR(50) NOT NULL,
            source_type VARCHAR(100) NULL,
            source_id BIGINT NULL,
            amount NUMERIC(12,2) NOT NULL,
            balance_after NUMERIC(12,2) NOT NULL,
            notes TEXT NOT NULL DEFAULT '',
            created_by BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
          )
        `);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_financial_account_entries_account ON financial_account_entries (tenant_id, financial_account_id, created_at DESC)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_financial_account_entries_source ON financial_account_entries (tenant_id, source_type, source_id)`);

        await client.query(`
          CREATE TABLE IF NOT EXISTS payment_method_account_mappings (
            id BIGSERIAL PRIMARY KEY,
            tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            branch_id BIGINT NULL REFERENCES branches(id) ON DELETE CASCADE,
            payment_method VARCHAR(50) NOT NULL,
            financial_account_id BIGINT NOT NULL REFERENCES financial_accounts(id) ON DELETE RESTRICT,
            is_default BOOLEAN NOT NULL DEFAULT FALSE,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
          )
        `);
        await client.query(`
          CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_method_mapping_unique
          ON payment_method_account_mappings (tenant_id, payment_method, COALESCE(branch_id, 0))
          WHERE is_active = TRUE
        `);
        await client.query(`
          CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_method_mapping_default
          ON payment_method_account_mappings (tenant_id, payment_method)
          WHERE is_active = TRUE AND is_default = TRUE AND branch_id IS NULL
        `);

        await client.query(`
          CREATE TABLE IF NOT EXISTS money_accounts (
            id BIGSERIAL PRIMARY KEY,
            tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            financial_account_id BIGINT NULL REFERENCES financial_accounts(id) ON DELETE SET NULL,
            name VARCHAR(255) NOT NULL,
            type VARCHAR(50) NOT NULL,
            provider VARCHAR(120) NULL,
            branch_id BIGINT NULL REFERENCES branches(id) ON DELETE SET NULL,
            opening_balance NUMERIC(12,2) NOT NULL DEFAULT 0,
            current_balance NUMERIC(12,2) NOT NULL DEFAULT 0,
            currency VARCHAR(10) NOT NULL DEFAULT 'EGP',
            allow_negative_balance BOOLEAN NOT NULL DEFAULT FALSE,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
          )
        `);
        await client.query(`ALTER TABLE IF EXISTS money_accounts ADD COLUMN IF NOT EXISTS financial_account_id BIGINT NULL REFERENCES financial_accounts(id) ON DELETE SET NULL`);
        await client.query(`ALTER TABLE IF EXISTS money_accounts ADD COLUMN IF NOT EXISTS provider VARCHAR(120) NULL`);
        await client.query(`ALTER TABLE IF EXISTS money_accounts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP`);
        await client.query(`ALTER TABLE IF EXISTS money_accounts ADD COLUMN IF NOT EXISTS allow_negative_balance BOOLEAN NOT NULL DEFAULT FALSE`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_money_accounts_tenant_type ON money_accounts (tenant_id, type, is_active)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_money_accounts_branch ON money_accounts (tenant_id, branch_id)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_money_accounts_financial_account ON money_accounts (tenant_id, financial_account_id)`);
        await reconcileMoneyAccountUniqueness(client);
        await client.query(`
          CREATE UNIQUE INDEX IF NOT EXISTS idx_money_accounts_tenant_name_branch_unique
          ON money_accounts (tenant_id, LOWER(name), COALESCE(branch_id, 0))
        `);

        await client.query(`
          CREATE TABLE IF NOT EXISTS money_transactions (
            id BIGSERIAL PRIMARY KEY,
            tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            account_id BIGINT NOT NULL REFERENCES money_accounts(id) ON DELETE RESTRICT,
            direction VARCHAR(10) NOT NULL CHECK (direction IN ('in', 'out')),
            amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
            transaction_type VARCHAR(80) NOT NULL,
            reference_type VARCHAR(80) NULL,
            reference_id BIGINT NULL,
            payment_method VARCHAR(50) NULL,
            notes TEXT,
            created_by BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
            branch_id BIGINT NULL REFERENCES branches(id) ON DELETE SET NULL,
            balance_after NUMERIC(12,2) NOT NULL DEFAULT 0,
            reversal_of BIGINT NULL REFERENCES money_transactions(id) ON DELETE RESTRICT,
            metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
          )
        `);
        await client.query(`ALTER TABLE IF EXISTS money_transactions ADD COLUMN IF NOT EXISTS tenant_id BIGINT`);
        await client.query(`ALTER TABLE IF EXISTS money_transactions ADD COLUMN IF NOT EXISTS balance_after NUMERIC(12,2) NOT NULL DEFAULT 0`);
        await client.query(`ALTER TABLE IF EXISTS money_transactions ADD COLUMN IF NOT EXISTS reversal_of BIGINT NULL REFERENCES money_transactions(id) ON DELETE RESTRICT`);
        await client.query(`ALTER TABLE IF EXISTS money_transactions ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_money_transactions_account_created ON money_transactions (tenant_id, account_id, created_at DESC)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_money_transactions_filters ON money_transactions (tenant_id, transaction_type, reference_type, branch_id, created_at DESC)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_money_transactions_reference ON money_transactions (tenant_id, reference_type, reference_id)`);
        await client.query(`DROP INDEX IF EXISTS idx_money_transactions_idempotent_reference`);
        await client.query(`
          CREATE INDEX IF NOT EXISTS idx_money_transactions_idempotent_reference
          ON money_transactions (tenant_id, account_id, reference_type, reference_id, transaction_type, direction)
          WHERE reference_type IS NOT NULL AND reference_id IS NOT NULL AND reversal_of IS NULL
        `);

        await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS payment_breakdown JSONB NOT NULL DEFAULT '[]'::jsonb`);
        await client.query(`ALTER TABLE IF EXISTS purchases ADD COLUMN IF NOT EXISTS remaining_amount NUMERIC(12,2) NOT NULL DEFAULT 0`);
        await client.query(`ALTER TABLE IF EXISTS purchases ADD COLUMN IF NOT EXISTS payment_account_id BIGINT NULL`);
        await client.query(`ALTER TABLE IF EXISTS purchases ADD COLUMN IF NOT EXISTS payment_method VARCHAR(80)`);
        await client.query(`ALTER TABLE IF EXISTS expenses ADD COLUMN IF NOT EXISTS money_account_id BIGINT NULL`);
        await client.query(`ALTER TABLE IF EXISTS employee_advances ADD COLUMN IF NOT EXISTS money_account_id BIGINT NULL`);

        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    })();
  }

  await schemaReadyPromise;
  await ensureAccountingAuditSchema();
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

  await seedDefaultMoneyAccounts(dbClient, { tenantId: scopeTenantId });

  return map;
};

export const logAccountingAudit = async (clientOrPool, data = {}) => {
  await ensureAccountingAuditSchema();
  const dbClient = queryable(clientOrPool);
  const tenantId = getTenantScope(data.tenantId ?? data.tenant_id);
  if (tenantId === null) throw new Error("tenantId is required");

  const action = String(data.action || "").trim();
  const entityType = String(data.entityType || data.entity_type || "accounting").trim();
  if (!action) throw new Error("Audit action is required");

  const result = await dbClient.query(
    `
    INSERT INTO accounting_audit_logs (
      tenant_id,
      user_id,
      action,
      entity_type,
      entity_id,
      before_data,
      after_data,
      metadata,
      created_at
    )
    VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,NOW())
    RETURNING *
    `,
    [
      tenantId,
      data.userId ?? data.user_id ?? null,
      action,
      entityType,
      data.entityId ?? data.entity_id ?? null,
      (data.beforeData ?? data.before_data) === undefined ? null : JSON.stringify(data.beforeData ?? data.before_data),
      (data.afterData ?? data.after_data) === undefined ? null : JSON.stringify(data.afterData ?? data.after_data),
      data.metadata === undefined ? null : JSON.stringify(data.metadata),
    ]
  );

  return result.rows[0] || null;
};

export const getAccountingAuditLogs = async (clientOrPool, data = {}) => {
  await ensureAccountingAuditSchema();
  const dbClient = queryable(clientOrPool);
  const tenantId = getTenantScope(data.tenantId ?? data.tenant_id);
  if (tenantId === null) throw new Error("tenantId is required");

  const clauses = ["aal.tenant_id = $1"];
  const params = [tenantId];
  const add = (value) => {
    params.push(value);
    return `$${params.length}`;
  };

  const fromDate = parseDateFilter(data.fromDate || data.from_date || data.from);
  const toDate = parseDateFilter(data.toDate || data.to_date || data.to);
  const action = textFilter(data.action);
  const entityType = textFilter(data.entityType || data.entity_type);
  const userId = numericFilter(data.userId || data.user_id);
  const search = textFilter(data.search);

  if (fromDate) clauses.push(`DATE(aal.created_at) >= ${add(fromDate)}`);
  if (toDate) clauses.push(`DATE(aal.created_at) <= ${add(toDate)}`);
  if (action) clauses.push(`LOWER(aal.action) = ${add(action)}`);
  if (entityType) clauses.push(`LOWER(aal.entity_type) = ${add(entityType)}`);
  if (userId) clauses.push(`aal.user_id = ${add(userId)}`);
  if (search) {
    const value = `%${search}%`;
    clauses.push(`(
      LOWER(aal.action) LIKE ${add(value)}
      OR LOWER(aal.entity_type) LIKE ${add(value)}
      OR LOWER(COALESCE(u.name, '')) LIKE ${add(value)}
      OR LOWER(COALESCE(u.email, '')) LIKE ${add(value)}
      OR LOWER(COALESCE(aal.metadata::text, '')) LIKE ${add(value)}
    )`);
  }

  const limit = Math.min(Math.max(Number(data.limit || 100), 1), 500);
  const offset = Math.max(Number(data.offset || 0), 0);

  const result = await dbClient.query(
    `
    SELECT
      aal.*,
      COALESCE(NULLIF(u.name, ''), NULLIF(u.email, ''), CASE WHEN aal.user_id IS NULL THEN 'System' ELSE 'User #' || aal.user_id END) AS user_name,
      u.email AS user_email,
      COUNT(*) OVER()::int AS total_count
    FROM accounting_audit_logs aal
    LEFT JOIN users u ON u.id = aal.user_id
    WHERE ${clauses.join(" AND ")}
    ORDER BY aal.created_at DESC, aal.id DESC
    LIMIT ${limit}
    OFFSET ${offset}
    `,
    params
  );

  return {
    rows: result.rows.map((row) => ({
      id: Number(row.id),
      tenant_id: Number(row.tenant_id),
      user_id: row.user_id === null || row.user_id === undefined ? null : Number(row.user_id),
      user_name: row.user_name || "System",
      user_email: row.user_email || "",
      action: row.action,
      entity_type: row.entity_type,
      entity_id: row.entity_id === null || row.entity_id === undefined ? null : Number(row.entity_id),
      before_data: row.before_data || null,
      after_data: row.after_data || null,
      metadata: row.metadata || null,
      created_at: row.created_at,
    })),
    total: Number(result.rows[0]?.total_count || 0),
    limit,
    offset,
  };
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

const cashDrawerEventDirection = (eventType) => {
  const normalized = String(eventType || "").trim().toLowerCase();
  if (["sale_cash", "cash_in", "opening"].includes(normalized)) return 1;
  if (["refund_cash", "expense_cash", "cash_out"].includes(normalized)) return -1;
  return 0;
};

const normalizeCashDrawerShift = (row = {}) => ({
  id: Number(row.id),
  tenant_id: Number(row.tenant_id),
  branch_id: row.branch_id === null || row.branch_id === undefined ? null : Number(row.branch_id),
  financial_account_id: row.financial_account_id === null || row.financial_account_id === undefined ? null : Number(row.financial_account_id),
  opened_by: row.opened_by === null || row.opened_by === undefined ? null : Number(row.opened_by),
  opened_by_user_id: row.opened_by_user_id === null || row.opened_by_user_id === undefined
    ? (row.opened_by === null || row.opened_by === undefined ? null : Number(row.opened_by))
    : Number(row.opened_by_user_id),
  closed_by: row.closed_by === null || row.closed_by === undefined ? null : Number(row.closed_by),
  closed_by_user_id: row.closed_by_user_id === null || row.closed_by_user_id === undefined
    ? (row.closed_by === null || row.closed_by === undefined ? null : Number(row.closed_by))
    : Number(row.closed_by_user_id),
  cashier_name: row.cashier_name || row.opened_by_name || "",
  branch_name: row.branch_name || "",
  opened_at: row.opened_at,
  closed_at: row.closed_at,
  opening_cash: roundMoney(row.opening_cash || 0),
  expected_cash: roundMoney(row.expected_cash || 0),
  actual_cash: row.actual_cash === null || row.actual_cash === undefined ? null : roundMoney(row.actual_cash),
  closing_cash: row.closing_cash === null || row.closing_cash === undefined
    ? (row.actual_cash === null || row.actual_cash === undefined ? null : roundMoney(row.actual_cash))
    : roundMoney(row.closing_cash),
  difference: roundMoney(row.difference || 0),
  cash_difference: roundMoney(row.cash_difference ?? row.difference ?? 0),
  status: row.status || "open",
  notes: row.notes || "",
  sales_cash: roundMoney(row.sales_cash || 0),
  refunds_cash: roundMoney(row.refunds_cash || 0),
  expenses_cash: roundMoney(row.expenses_cash || 0),
  cash_in: roundMoney(row.cash_in || 0),
  cash_out: roundMoney(row.cash_out || 0),
  event_count: Number(row.event_count || 0),
});

const cashDrawerShiftSelect = `
  SELECT
    s.*,
    COALESCE(NULLIF(u.name, ''), NULLIF(u.email, ''), 'User #' || s.opened_by) AS cashier_name,
    b.name AS branch_name,
    COALESCE(SUM(CASE WHEN e.event_type = 'sale_cash' THEN e.amount ELSE 0 END), 0)::numeric AS sales_cash,
    COALESCE(SUM(CASE WHEN e.event_type = 'refund_cash' THEN e.amount ELSE 0 END), 0)::numeric AS refunds_cash,
    COALESCE(SUM(CASE WHEN e.event_type = 'expense_cash' THEN e.amount ELSE 0 END), 0)::numeric AS expenses_cash,
    COALESCE(SUM(CASE WHEN e.event_type = 'cash_in' THEN e.amount ELSE 0 END), 0)::numeric AS cash_in,
    COALESCE(SUM(CASE WHEN e.event_type = 'cash_out' THEN e.amount ELSE 0 END), 0)::numeric AS cash_out,
    COUNT(e.id)::int AS event_count
  FROM cash_drawer_shifts s
  LEFT JOIN users u ON u.id = s.opened_by
  LEFT JOIN branches b ON b.id = s.branch_id
  LEFT JOIN cash_drawer_shift_events e ON e.shift_id = s.id AND e.tenant_id = s.tenant_id
`;

export const getCurrentCashDrawerShift = async (clientOrPool, data = {}) => {
  await ensureAccountingSchema();
  const dbClient = queryable(clientOrPool);
  const tenantId = getTenantScope(data.tenantId ?? data.tenant_id);
  const userId = numericFilter(data.userId ?? data.user_id ?? data.cashierId ?? data.cashier_id);
  const branchId = numericFilter(data.branchId ?? data.branch_id);
  if (tenantId === null) throw new Error("tenantId is required");
  if (!userId) throw new Error("userId is required");

  const params = [tenantId, userId];
  const clauses = ["s.tenant_id = $1", "s.opened_by = $2", "s.status = 'open'"];
  if (branchId) {
    params.push(branchId);
    clauses.push(`s.branch_id = $${params.length}`);
  }

  const result = await dbClient.query(
    `
    ${cashDrawerShiftSelect}
    WHERE ${clauses.join(" AND ")}
    GROUP BY s.id, u.name, u.email, b.name
    ORDER BY s.opened_at DESC
    LIMIT 1
    `,
    params
  );

  return result.rows[0] ? normalizeCashDrawerShift(result.rows[0]) : null;
};

export const getCashDrawerShiftHistory = async (clientOrPool, data = {}) => {
  await ensureAccountingSchema();
  const dbClient = queryable(clientOrPool);
  const tenantId = getTenantScope(data.tenantId ?? data.tenant_id);
  if (tenantId === null) throw new Error("tenantId is required");

  const params = [tenantId];
  const clauses = ["s.tenant_id = $1"];
  const branchId = numericFilter(data.branchId ?? data.branch_id);
  const userId = numericFilter(data.userId ?? data.user_id ?? data.cashierId ?? data.cashier_id);
  const status = String(data.status || "").trim().toLowerCase();
  const fromDate = parseDateFilter(data.fromDate || data.from_date || data.from);
  const toDate = parseDateFilter(data.toDate || data.to_date || data.to);

  if (branchId) {
    params.push(branchId);
    clauses.push(`s.branch_id = $${params.length}`);
  }
  if (userId) {
    params.push(userId);
    clauses.push(`s.opened_by = $${params.length}`);
  }
  if (["open", "closed"].includes(status)) {
    params.push(status);
    clauses.push(`s.status = $${params.length}`);
  }
  if (fromDate) {
    params.push(fromDate);
    clauses.push(`DATE(s.opened_at) >= $${params.length}`);
  }
  if (toDate) {
    params.push(toDate);
    clauses.push(`DATE(s.opened_at) <= $${params.length}`);
  }

  const limit = Math.min(Math.max(Number(data.limit || 100), 1), 500);
  const offset = Math.max(Number(data.offset || 0), 0);
  const result = await dbClient.query(
    `
    ${cashDrawerShiftSelect}
    WHERE ${clauses.join(" AND ")}
    GROUP BY s.id, u.name, u.email, b.name
    ORDER BY s.opened_at DESC, s.id DESC
    LIMIT ${limit}
    OFFSET ${offset}
    `,
    params
  );

  return {
    rows: result.rows.map(normalizeCashDrawerShift),
    limit,
    offset,
  };
};

export const openCashDrawerShift = async (clientOrPool, data = {}) => {
  await ensureAccountingSchema();
  const dbClient = queryable(clientOrPool);
  const tenantId = getTenantScope(data.tenantId ?? data.tenant_id);
  const openedBy = numericFilter(data.openedBy ?? data.opened_by ?? data.userId ?? data.user_id);
  const branchId = numericFilter(data.branchId ?? data.branch_id);
  const financialAccountId = numericFilter(data.financialAccountId ?? data.financial_account_id);
  const openingCash = roundMoney(data.openingCash ?? data.opening_cash ?? 0);
  const notes = String(data.notes || "").trim();
  if (tenantId === null) throw new Error("tenantId is required");
  if (!openedBy) throw new Error("opened_by is required");
  if (!branchId) throw new Error("branch_id is required");
  if (openingCash < 0) throw new Error("opening_cash must be zero or greater");

  const existing = await getCurrentCashDrawerShift(dbClient, { tenantId, userId: openedBy, branchId });
  if (existing) {
    const error = new Error("This cashier already has an open cash drawer shift for this branch");
    error.status = 409;
    throw error;
  }

  const result = await dbClient.query(
    `
    INSERT INTO cash_drawer_shifts (
      tenant_id, branch_id, financial_account_id, opened_by, opened_by_user_id, opened_at, opening_cash, expected_cash, difference, cash_difference, status, notes
    )
    VALUES ($1,$2,$3,$4,$4,NOW(),$5,$5,0,0,'open',$6)
    RETURNING *
    `,
    [tenantId, branchId, financialAccountId, openedBy, openingCash, notes]
  );
  const shift = result.rows[0];

  await dbClient.query(
    `
    INSERT INTO cash_drawer_shift_events (
      tenant_id, shift_id, event_type, source_type, source_id, amount, created_at, created_by
    )
    VALUES ($1,$2,'opening','cash_drawer_shift',$2,$3,NOW(),$4)
    `,
    [tenantId, shift.id, openingCash, openedBy]
  );

  await logAccountingAudit(dbClient, {
    tenantId,
    userId: openedBy,
    action: "cash_drawer_shift_opened",
    entityType: "cash_drawer_shift",
    entityId: shift.id,
    afterData: shift,
    metadata: { branch_id: branchId, opening_cash: openingCash },
  });

  return normalizeCashDrawerShift({ ...shift, event_count: 1 });
};

export const recordCashDrawerEvent = async (clientOrPool, data = {}) => {
  await ensureAccountingSchema();
  const dbClient = queryable(clientOrPool);
  const tenantId = getTenantScope(data.tenantId ?? data.tenant_id);
  const createdBy = numericFilter(data.createdBy ?? data.created_by ?? data.userId ?? data.user_id);
  const branchId = numericFilter(data.branchId ?? data.branch_id);
  const amount = roundMoney(data.amount || 0);
  const eventType = String(data.eventType || data.event_type || "").trim().toLowerCase();
  const sourceType = data.sourceType || data.source_type || null;
  const sourceId = numericFilter(data.sourceId ?? data.source_id);
  if (tenantId === null) throw new Error("tenantId is required");
  if (!createdBy) {
    if (data.requireOpenShift || data.require_open_shift) throw new Error("created_by is required");
    return null;
  }
  if (!branchId) {
    if (data.requireOpenShift || data.require_open_shift) throw new Error("branch_id is required");
    return null;
  }
  if (!eventType) throw new Error("event_type is required");
  if (amount <= 0) throw new Error("amount must be greater than zero");

  const direction = cashDrawerEventDirection(eventType);
  if (!direction) throw new Error(`Unsupported cash drawer event type: ${eventType}`);

  const shift = data.shiftId || data.shift_id
    ? (await dbClient.query(
        `
        SELECT *
        FROM cash_drawer_shifts
        WHERE id = $1
          AND tenant_id = $2
          AND status = 'open'
        LIMIT 1
        `,
        [data.shiftId || data.shift_id, tenantId]
      )).rows[0]
    : await getCurrentCashDrawerShift(dbClient, { tenantId, userId: createdBy, branchId });

  if (!shift) {
    if (data.requireOpenShift || data.require_open_shift) {
      const error = new Error("No open cash drawer shift for this cashier and branch");
      error.status = 409;
      throw error;
    }
    return null;
  }

  const shiftId = shift.id;
  const existing = sourceType && sourceId
    ? await dbClient.query(
        `
        SELECT id
        FROM cash_drawer_shift_events
        WHERE tenant_id = $1
          AND shift_id = $2
          AND event_type = $3
          AND source_type = $4
          AND source_id = $5
        LIMIT 1
        `,
        [tenantId, shiftId, eventType, sourceType, sourceId]
      )
    : { rowCount: 0 };
  if (existing.rowCount) return null;

  const eventResult = await dbClient.query(
    `
    INSERT INTO cash_drawer_shift_events (
      tenant_id, shift_id, event_type, source_type, source_id, amount, created_at, created_by
    )
    VALUES ($1,$2,$3,$4,$5,$6,NOW(),$7)
    RETURNING *
    `,
    [tenantId, shiftId, eventType, sourceType, sourceId, amount, createdBy]
  );

  const expectedDelta = roundMoney(amount * direction);
  await dbClient.query(
    `
    UPDATE cash_drawer_shifts
    SET expected_cash = expected_cash + $1,
        difference = COALESCE(actual_cash, expected_cash + $1) - (expected_cash + $1),
        cash_difference = COALESCE(actual_cash, expected_cash + $1) - (expected_cash + $1)
    WHERE id = $2
      AND tenant_id = $3
      AND status = 'open'
    `,
    [expectedDelta, shiftId, tenantId]
  );

  if (["cash_in", "cash_out"].includes(eventType)) {
    await recordFinancialAccountActivity(dbClient, {
      tenantId,
      branchId,
      financialAccountId: shift.financial_account_id || null,
      paymentMethod: "cash",
      entryType: eventType,
      direction: direction > 0 ? 1 : -1,
      sourceType: "cash_drawer_shift_event",
      sourceId: eventResult.rows[0]?.id || null,
      amount,
      notes: sourceType || "Manual cash movement",
      createdBy,
      idempotent: false,
    });
  }

  return eventResult.rows[0] || null;
};

export const closeCashDrawerShift = async (clientOrPool, data = {}) => {
  await ensureAccountingSchema();
  const dbClient = queryable(clientOrPool);
  const tenantId = getTenantScope(data.tenantId ?? data.tenant_id);
  const shiftId = numericFilter(data.shiftId ?? data.shift_id);
  const closedBy = numericFilter(data.closedBy ?? data.closed_by ?? data.userId ?? data.user_id);
  const actualCash = roundMoney(data.actualCash ?? data.actual_cash ?? 0);
  const notes = String(data.notes || "").trim();
  if (tenantId === null) throw new Error("tenantId is required");
  if (!shiftId) throw new Error("shift_id is required");
  if (!closedBy) throw new Error("closed_by is required");
  if (actualCash < 0) throw new Error("actual_cash must be zero or greater");

  const currentResult = await dbClient.query(
    `
    SELECT *
    FROM cash_drawer_shifts
    WHERE id = $1
      AND tenant_id = $2
      AND status = 'open'
    FOR UPDATE
    `,
    [shiftId, tenantId]
  );
  if (!currentResult.rowCount) {
    const error = new Error("Open cash drawer shift not found");
    error.status = 404;
    throw error;
  }

  const before = currentResult.rows[0];
  const expectedCash = roundMoney(before.expected_cash || 0);
  const difference = roundMoney(actualCash - expectedCash);

  await dbClient.query(
    `
    INSERT INTO cash_drawer_shift_events (
      tenant_id, shift_id, event_type, source_type, source_id, amount, created_at, created_by
    )
    VALUES ($1,$2,'closing','cash_drawer_shift',$2,$3,NOW(),$4)
    `,
    [tenantId, shiftId, actualCash, closedBy]
  );

  const result = await dbClient.query(
    `
    UPDATE cash_drawer_shifts
    SET closed_by = $1,
        closed_by_user_id = $1,
        closed_at = NOW(),
        actual_cash = $2,
        closing_cash = $2,
        difference = $3,
        cash_difference = $3,
        status = 'closed',
        notes = COALESCE(NULLIF($4, ''), notes)
    WHERE id = $5
      AND tenant_id = $6
    RETURNING *
    `,
    [closedBy, actualCash, difference, notes, shiftId, tenantId]
  );
  const after = result.rows[0];

  if (Math.abs(difference) > 0) {
    const cash = await resolveAccount(dbClient, tenantId, "1000");
    const gainLoss = await resolveAccount(dbClient, tenantId, "5300");
    await createJournalEntry(dbClient, {
      tenantId,
      referenceType: "cash_drawer_shift",
      referenceId: shiftId,
      entryType: "cash_drawer_difference",
      sourceKey: `cash-drawer-shift-${shiftId}-difference`,
      description: `Cash drawer ${difference > 0 ? "overage" : "shortage"} for shift #${shiftId}`,
      notes,
      createdBy: closedBy,
      isGenerated: true,
      lines: difference > 0
        ? [
            accountLine(cash, Math.abs(difference), "debit", "Cash drawer overage", after.branch_id),
            accountLine(gainLoss, Math.abs(difference), "credit", "Cash drawer overage", after.branch_id),
          ]
        : [
            accountLine(gainLoss, Math.abs(difference), "debit", "Cash drawer shortage", after.branch_id),
            accountLine(cash, Math.abs(difference), "credit", "Cash drawer shortage", after.branch_id),
          ],
    });
  }

  await logAccountingAudit(dbClient, {
    tenantId,
    userId: closedBy,
    action: "cash_drawer_shift_closed",
    entityType: "cash_drawer_shift",
    entityId: shiftId,
    beforeData: before,
    afterData: after,
    metadata: { expected_cash: expectedCash, actual_cash: actualCash, difference },
  });

  return normalizeCashDrawerShift(after);
};

export const getCashDrawerShiftEvents = async (clientOrPool, data = {}) => {
  await ensureAccountingSchema();
  const dbClient = queryable(clientOrPool);
  const tenantId = getTenantScope(data.tenantId ?? data.tenant_id);
  const shiftId = numericFilter(data.shiftId ?? data.shift_id);
  if (tenantId === null) throw new Error("tenantId is required");
  if (!shiftId) return [];

  const result = await dbClient.query(
    `
    SELECT e.*, COALESCE(NULLIF(u.name, ''), NULLIF(u.email, ''), 'System') AS created_by_name
    FROM cash_drawer_shift_events e
    LEFT JOIN users u ON u.id = e.created_by
    WHERE e.tenant_id = $1
      AND e.shift_id = $2
    ORDER BY e.created_at DESC, e.id DESC
    `,
    [tenantId, shiftId]
  );

  return result.rows.map((row) => ({
    id: Number(row.id),
    tenant_id: Number(row.tenant_id),
    shift_id: Number(row.shift_id),
    event_type: row.event_type,
    source_type: row.source_type || "",
    source_id: row.source_id === null || row.source_id === undefined ? null : Number(row.source_id),
    amount: roundMoney(row.amount || 0),
    created_at: row.created_at,
    created_by: row.created_by === null || row.created_by === undefined ? null : Number(row.created_by),
    created_by_name: row.created_by_name || "",
  }));
};

const FINANCIAL_ACCOUNT_TYPES = new Set([
  "cash_drawer",
  "safe",
  "bank",
  "wallet",
  "digital_wallet",
  "card_settlement",
]);
const SUPPORTED_PAYMENT_METHODS = new Set([
  "cash",
  "card",
  "bank_transfer",
  "vodafone_cash",
  "instapay",
  "wallet",
  "customer_wallet",
  "cod",
  "mixed",
  "online",
]);

const MONEY_ACCOUNT_TYPES = new Set([
  "cash",
  "bank",
  "card",
  "wallet",
  "payment_gateway",
  "employee_custody",
  "supplier_payable",
  "other",
]);

const MONEY_TRANSACTION_TYPES = new Set([
  "pos_sale_payment",
  "purchase_payment",
  "expense_payment",
  "employee_advance",
  "payroll_payment",
  "refund",
  "transfer_between_accounts",
  "manual_adjustment",
  "supplier_payment",
  "customer_payment",
]);

const DEFAULT_MONEY_ACCOUNTS = [
  { name: "Main Cash", type: "cash", provider: "" },
  { name: "Main Bank", type: "bank", provider: "" },
  { name: "Card Settlement", type: "card", provider: "" },
  { name: "Vodafone Cash", type: "wallet", provider: "Vodafone Cash" },
  { name: "Instapay", type: "wallet", provider: "Instapay" },
  { name: "Paymob / Online Payments", type: "payment_gateway", provider: "Paymob" },
  { name: "Supplier Payable", type: "supplier_payable", provider: "" },
];

const normalizePaymentMethodKey = (value) => {
  const key = String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (key === "visa") return "card";
  if (key === "bank" || key === "transfer") return "bank_transfer";
  if (key === "vodafone") return "vodafone_cash";
  if (key === "insta_pay") return "instapay";
  return key || "cash";
};

const moneyTypeForFinancialType = (type = "") => {
  const normalized = String(type || "").trim().toLowerCase();
  if (["cash_drawer", "safe"].includes(normalized)) return "cash";
  if (normalized === "card_settlement") return "card";
  if (["wallet", "digital_wallet"].includes(normalized)) return "wallet";
  if (normalized === "bank") return "bank";
  return "other";
};

const defaultMoneyTypeForPaymentMethod = (paymentMethod = "") => {
  const method = normalizePaymentMethodKey(paymentMethod);
  if (method === "cash" || method === "cod") return "cash";
  if (method === "card") return "card";
  if (method === "bank_transfer") return "bank";
  if (method === "vodafone_cash" || method === "instapay" || method === "wallet") return "wallet";
  if (method === "customer_wallet") return "other";
  if (method === "online" || method === "paymob") return "payment_gateway";
  return "other";
};

const defaultProviderForPaymentMethod = (paymentMethod = "") => {
  const method = normalizePaymentMethodKey(paymentMethod);
  if (method === "vodafone_cash") return "Vodafone Cash";
  if (method === "instapay") return "Instapay";
  if (method === "online" || method === "paymob") return "Paymob";
  return "";
};

const strictMappedPaymentMethods = new Set(["instapay", "vodafone_cash"]);

const normalizeMoneyAccount = (row = {}) => ({
  id: Number(row.id),
  tenant_id: Number(row.tenant_id),
  financial_account_id: row.financial_account_id === null || row.financial_account_id === undefined ? null : Number(row.financial_account_id),
  name: row.name || "",
  type: row.type || "",
  provider: row.provider || "",
  branch_id: row.branch_id === null || row.branch_id === undefined ? null : Number(row.branch_id),
  branch_name: row.branch_name || "",
  opening_balance: roundMoney(row.opening_balance || 0),
  current_balance: roundMoney(row.current_balance || 0),
  currency: row.currency || "EGP",
  allow_negative_balance: row.allow_negative_balance === true,
  is_active: row.is_active !== false,
  created_at: row.created_at,
  updated_at: row.updated_at,
});

const normalizeMoneyTransaction = (row = {}) => ({
  id: Number(row.id),
  tenant_id: Number(row.tenant_id),
  account_id: Number(row.account_id),
  account_name: row.account_name || "",
  account_type: row.account_type || row.type || "",
  direction: row.direction || "",
  amount: roundMoney(row.amount || 0),
  transaction_type: row.transaction_type || "",
  reference_type: row.reference_type || "",
  reference_id: row.reference_id === null || row.reference_id === undefined ? null : Number(row.reference_id),
  payment_method: row.payment_method || "",
  notes: row.notes || "",
  created_by: row.created_by === null || row.created_by === undefined ? null : Number(row.created_by),
  created_by_name: row.created_by_name || "",
  branch_id: row.branch_id === null || row.branch_id === undefined ? null : Number(row.branch_id),
  branch_name: row.branch_name || "",
  balance_after: roundMoney(row.balance_after || 0),
  reversal_of: row.reversal_of === null || row.reversal_of === undefined ? null : Number(row.reversal_of),
  metadata: row.metadata || {},
  created_at: row.created_at,
});

const moneyTransactionTypeForActivity = ({ entryType = "", direction = 1, sourceType = "" } = {}) => {
  const type = String(entryType || "").trim().toLowerCase();
  const source = String(sourceType || "").trim().toLowerCase();
  if (type.includes("transfer")) return "transfer_between_accounts";
  if (type.includes("refund") || source === "return") return "refund";
  if (source === "purchase" || type.includes("purchase")) return "purchase_payment";
  if (source === "expense" || type.includes("expense")) return "expense_payment";
  if (source === "employee_advance" || type.includes("advance")) return "employee_advance";
  if (source === "payroll" || type.includes("payroll")) return "payroll_payment";
  if (source === "customer_payment") return "customer_payment";
  if (source === "supplier_payment") return "supplier_payment";
  if (type.includes("sale") || source === "order") return "pos_sale_payment";
  if (type.includes("adjust")) return "manual_adjustment";
  return direction > 0 ? "customer_payment" : "manual_adjustment";
};

const normalizeFinancialAccount = (row = {}) => ({
  id: Number(row.id),
  tenant_id: Number(row.tenant_id),
  name: row.name || "",
  account_type: row.account_type || "",
  currency: row.currency || "EGP",
  branch_id: row.branch_id === null || row.branch_id === undefined ? null : Number(row.branch_id),
  branch_name: row.branch_name || "",
  opening_balance: roundMoney(row.opening_balance || 0),
  current_balance: roundMoney(row.current_balance || 0),
  allow_negative_balance: row.allow_negative_balance === true,
  is_active: row.is_active !== false,
  notes: row.notes || "",
  created_at: row.created_at,
  updated_at: row.updated_at,
});

const normalizeFinancialAccountEntry = (row = {}) => ({
  id: Number(row.id),
  tenant_id: Number(row.tenant_id),
  financial_account_id: Number(row.financial_account_id),
  account_name: row.account_name || "",
  entry_type: row.entry_type || "",
  source_type: row.source_type || "",
  source_id: row.source_id === null || row.source_id === undefined ? null : Number(row.source_id),
  amount: roundMoney(row.amount || 0),
  balance_after: roundMoney(row.balance_after || 0),
  notes: row.notes || "",
  created_by: row.created_by === null || row.created_by === undefined ? null : Number(row.created_by),
  created_by_name: row.created_by_name || "",
  created_at: row.created_at,
});

const normalizePaymentMethodMapping = (row = {}) => ({
  id: Number(row.id),
  tenant_id: Number(row.tenant_id),
  branch_id: row.branch_id === null || row.branch_id === undefined ? null : Number(row.branch_id),
  branch_name: row.branch_name || "",
  payment_method: row.payment_method || "",
  financial_account_id: Number(row.financial_account_id),
  financial_account_name: row.financial_account_name || "",
  account_type: row.account_type || "",
  is_default: row.is_default === true,
  is_active: row.is_active !== false,
  created_at: row.created_at,
  updated_at: row.updated_at,
});

const validateMappingFinancialAccount = async (dbClient, { tenantId, branchId, financialAccountId }) => {
  const result = await dbClient.query(
    `
    SELECT *
    FROM financial_accounts
    WHERE id = $1
      AND tenant_id = $2
      AND is_active = TRUE
      AND ($3::bigint IS NULL OR branch_id IS NULL OR branch_id = $3::bigint)
    LIMIT 1
    `,
    [financialAccountId, tenantId, branchId || null]
  );
  if (!result.rowCount) throw new Error("Mapped financial account must be active and belong to this tenant/branch");
  return result.rows[0];
};

export const getPaymentMethodMappings = async (clientOrPool, data = {}) => {
  await ensureAccountingSchema();
  const dbClient = queryable(clientOrPool);
  const tenantId = getTenantScope(data.tenantId ?? data.tenant_id);
  if (tenantId === null) throw new Error("tenantId is required");
  const result = await dbClient.query(
    `
    SELECT
      m.*,
      fa.name AS financial_account_name,
      fa.account_type,
      b.name AS branch_name
    FROM payment_method_account_mappings m
    JOIN financial_accounts fa ON fa.id = m.financial_account_id
    LEFT JOIN branches b ON b.id = m.branch_id
    WHERE m.tenant_id = $1
    ORDER BY m.payment_method ASC, m.branch_id NULLS FIRST, m.is_default DESC
    `,
    [tenantId]
  );
  return result.rows.map(normalizePaymentMethodMapping);
};

export const resolveFinancialAccountForPayment = async (clientOrPool, data = {}) => {
  await ensureAccountingSchema();
  const dbClient = queryable(clientOrPool);
  const tenantId = getTenantScope(data.tenantId ?? data.tenant_id);
  if (tenantId === null) throw new Error("tenantId is required");
  const branchId = numericFilter(data.branchId || data.branch_id);
  const paymentMethod = normalizePaymentMethodKey(data.paymentMethod || data.payment_method);

  const params = [tenantId, paymentMethod];
  const branchRank = branchId ? "CASE WHEN m.branch_id = $3 THEN 0 WHEN m.branch_id IS NULL AND m.is_default = TRUE THEN 1 ELSE 2 END" : "CASE WHEN m.branch_id IS NULL AND m.is_default = TRUE THEN 0 ELSE 1 END";
  if (branchId) params.push(branchId);
  const result = await dbClient.query(
    `
    SELECT m.*, fa.name AS financial_account_name, fa.account_type
    FROM payment_method_account_mappings m
    JOIN financial_accounts fa ON fa.id = m.financial_account_id
      AND fa.tenant_id = m.tenant_id
      AND fa.is_active = TRUE
    WHERE m.tenant_id = $1
      AND m.payment_method = $2
      AND m.is_active = TRUE
      AND (${branchId ? "m.branch_id = $3 OR " : ""}(m.branch_id IS NULL AND m.is_default = TRUE))
    ORDER BY ${branchRank}, m.id ASC
    LIMIT 1
    `,
    params
  );
  if (!result.rowCount) {
    console.warn("[accounting] missing payment method mapping", { tenantId, branchId, paymentMethod });
    return { financialAccountId: null, mapping: null, warning: `No financial account mapping for ${paymentMethod}` };
  }
  return {
    financialAccountId: Number(result.rows[0].financial_account_id),
    mapping: normalizePaymentMethodMapping(result.rows[0]),
    warning: "",
  };
};

export const createPaymentMethodMapping = async (clientOrPool, data = {}) => {
  await ensureAccountingSchema();
  const dbClient = queryable(clientOrPool);
  const tenantId = getTenantScope(data.tenantId ?? data.tenant_id);
  const branchId = numericFilter(data.branchId || data.branch_id);
  const paymentMethod = normalizePaymentMethodKey(data.paymentMethod || data.payment_method);
  const financialAccountId = numericFilter(data.financialAccountId || data.financial_account_id);
  const isDefault = Boolean(data.isDefault ?? data.is_default ?? !branchId);
  const isActive = data.isActive === undefined && data.is_active === undefined ? true : Boolean(data.isActive ?? data.is_active);
  const createdBy = data.createdBy ?? data.created_by ?? null;
  if (tenantId === null) throw new Error("tenantId is required");
  if (!SUPPORTED_PAYMENT_METHODS.has(paymentMethod)) throw new Error("Unsupported payment method");
  if (!financialAccountId) throw new Error("financial_account_id is required");
  await validateMappingFinancialAccount(dbClient, { tenantId, branchId, financialAccountId });

  if (isDefault && !branchId) {
    await dbClient.query(
      `
      UPDATE payment_method_account_mappings
      SET is_default = FALSE,
          updated_at = NOW()
      WHERE tenant_id = $1
        AND payment_method = $2
        AND branch_id IS NULL
        AND is_default = TRUE
      `,
      [tenantId, paymentMethod]
    );
  }

  const result = await dbClient.query(
    `
    INSERT INTO payment_method_account_mappings (
      tenant_id, branch_id, payment_method, financial_account_id, is_default, is_active, created_at, updated_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW())
    ON CONFLICT (tenant_id, payment_method, COALESCE(branch_id, 0)) WHERE is_active = TRUE
    DO UPDATE SET
      financial_account_id = EXCLUDED.financial_account_id,
      is_default = EXCLUDED.is_default,
      is_active = EXCLUDED.is_active,
      updated_at = NOW()
    RETURNING *
    `,
    [tenantId, branchId, paymentMethod, financialAccountId, isDefault && !branchId, isActive]
  );

  await logAccountingAudit(dbClient, {
    tenantId,
    userId: createdBy,
    action: "payment_method_mapping_saved",
    entityType: "payment_method_mapping",
    entityId: result.rows[0].id,
    afterData: result.rows[0],
  });

  return normalizePaymentMethodMapping(result.rows[0]);
};

export const updatePaymentMethodMapping = async (clientOrPool, data = {}) => {
  await ensureAccountingSchema();
  const dbClient = queryable(clientOrPool);
  const tenantId = getTenantScope(data.tenantId ?? data.tenant_id);
  const mappingId = numericFilter(data.mappingId ?? data.mapping_id ?? data.id);
  const updatedBy = data.updatedBy ?? data.updated_by ?? null;
  if (tenantId === null) throw new Error("tenantId is required");
  if (!mappingId) throw new Error("mapping_id is required");

  const beforeResult = await dbClient.query(
    `SELECT * FROM payment_method_account_mappings WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
    [mappingId, tenantId]
  );
  if (!beforeResult.rowCount) {
    const error = new Error("Payment method mapping not found");
    error.status = 404;
    throw error;
  }
  const before = beforeResult.rows[0];
  const branchId = data.branchId === undefined && data.branch_id === undefined ? before.branch_id : numericFilter(data.branchId || data.branch_id);
  const paymentMethod = data.paymentMethod || data.payment_method ? normalizePaymentMethodKey(data.paymentMethod || data.payment_method) : before.payment_method;
  const financialAccountId = numericFilter(data.financialAccountId || data.financial_account_id || before.financial_account_id);
  const isDefault = Boolean(data.isDefault ?? data.is_default ?? before.is_default);
  const isActive = data.isActive === undefined && data.is_active === undefined ? before.is_active : Boolean(data.isActive ?? data.is_active);
  if (!SUPPORTED_PAYMENT_METHODS.has(paymentMethod)) throw new Error("Unsupported payment method");
  await validateMappingFinancialAccount(dbClient, { tenantId, branchId, financialAccountId });
  if (isDefault && !branchId) {
    await dbClient.query(
      `
      UPDATE payment_method_account_mappings
      SET is_default = FALSE,
          updated_at = NOW()
      WHERE tenant_id = $1
        AND payment_method = $2
        AND branch_id IS NULL
        AND is_default = TRUE
        AND id <> $3
      `,
      [tenantId, paymentMethod, mappingId]
    );
  }

  const result = await dbClient.query(
    `
    UPDATE payment_method_account_mappings
    SET branch_id = $1,
        payment_method = $2,
        financial_account_id = $3,
        is_default = $4,
        is_active = $5,
        updated_at = NOW()
    WHERE id = $6
      AND tenant_id = $7
    RETURNING *
    `,
    [branchId, paymentMethod, financialAccountId, isDefault && !branchId, isActive, mappingId, tenantId]
  );
  await logAccountingAudit(dbClient, {
    tenantId,
    userId: updatedBy,
    action: "payment_method_mapping_updated",
    entityType: "payment_method_mapping",
    entityId: mappingId,
    beforeData: before,
    afterData: result.rows[0],
  });
  return normalizePaymentMethodMapping(result.rows[0]);
};

export const deletePaymentMethodMapping = async (clientOrPool, data = {}) => {
  await ensureAccountingSchema();
  const dbClient = queryable(clientOrPool);
  const tenantId = getTenantScope(data.tenantId ?? data.tenant_id);
  const mappingId = numericFilter(data.mappingId ?? data.mapping_id ?? data.id);
  if (tenantId === null) throw new Error("tenantId is required");
  if (!mappingId) throw new Error("mapping_id is required");
  const beforeResult = await dbClient.query(
    `SELECT * FROM payment_method_account_mappings WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
    [mappingId, tenantId]
  );
  if (!beforeResult.rowCount) {
    const error = new Error("Payment method mapping not found");
    error.status = 404;
    throw error;
  }
  const before = beforeResult.rows[0];
  if (before.is_active && before.is_default) {
    const replacement = await dbClient.query(
      `
      SELECT id
      FROM payment_method_account_mappings
      WHERE tenant_id = $1
        AND payment_method = $2
        AND branch_id IS NULL
        AND is_active = TRUE
        AND id <> $3
      LIMIT 1
      `,
      [tenantId, before.payment_method, mappingId]
    );
    if (!replacement.rowCount) {
      const error = new Error("Cannot delete the active default mapping until a replacement exists");
      error.status = 409;
      throw error;
    }
  }
  await dbClient.query(`DELETE FROM payment_method_account_mappings WHERE id = $1 AND tenant_id = $2`, [mappingId, tenantId]);
  await logAccountingAudit(dbClient, {
    tenantId,
    userId: data.deletedBy ?? data.deleted_by ?? null,
    action: "payment_method_mapping_deleted",
    entityType: "payment_method_mapping",
    entityId: mappingId,
    beforeData: before,
  });
  return { success: true, deleted: 1 };
};

export const getFinancialAccounts = async (clientOrPool, data = {}) => {
  await ensureAccountingSchema();
  const dbClient = queryable(clientOrPool);
  const tenantId = getTenantScope(data.tenantId ?? data.tenant_id);
  if (tenantId === null) throw new Error("tenantId is required");

  const params = [tenantId];
  const clauses = ["fa.tenant_id = $1"];
  const accountType = String(data.accountType || data.account_type || "").trim().toLowerCase();
  const branchId = numericFilter(data.branchId || data.branch_id);
  const includeInactive = Boolean(data.includeInactive || data.include_inactive);

  if (accountType && FINANCIAL_ACCOUNT_TYPES.has(accountType)) {
    params.push(accountType);
    clauses.push(`fa.account_type = $${params.length}`);
  }
  if (branchId) {
    params.push(branchId);
    clauses.push(`fa.branch_id = $${params.length}`);
  }
  if (!includeInactive) clauses.push("fa.is_active = TRUE");

  const result = await dbClient.query(
    `
    SELECT fa.*, b.name AS branch_name
    FROM financial_accounts fa
    LEFT JOIN branches b ON b.id = fa.branch_id
    WHERE ${clauses.join(" AND ")}
    ORDER BY fa.is_active DESC, fa.account_type ASC, fa.name ASC
    `,
    params
  );

  return result.rows.map(normalizeFinancialAccount);
};

export const createFinancialAccount = async (clientOrPool, data = {}) => {
  await ensureAccountingSchema();
  const dbClient = queryable(clientOrPool);
  const tenantId = getTenantScope(data.tenantId ?? data.tenant_id);
  const name = String(data.name || "").trim();
  const accountType = String(data.accountType || data.account_type || "").trim().toLowerCase();
  const currency = String(data.currency || "EGP").trim().toUpperCase().slice(0, 10) || "EGP";
  const branchId = numericFilter(data.branchId || data.branch_id);
  const openingBalance = roundMoney(data.openingBalance ?? data.opening_balance ?? 0);
  const allowNegativeBalance = Boolean(data.allowNegativeBalance ?? data.allow_negative_balance ?? false);
  const notes = String(data.notes || "").trim();
  const createdBy = numericFilter(data.createdBy ?? data.created_by);
  if (tenantId === null) throw new Error("tenantId is required");
  if (!name) throw new Error("Account name is required");
  if (!FINANCIAL_ACCOUNT_TYPES.has(accountType)) throw new Error("Invalid financial account type");

  const result = await dbClient.query(
    `
    INSERT INTO financial_accounts (
      tenant_id, name, account_type, currency, branch_id, opening_balance, current_balance, allow_negative_balance, is_active, notes, created_at, updated_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$6,$7,TRUE,$8,NOW(),NOW())
    RETURNING *
    `,
    [tenantId, name, accountType, currency, branchId, openingBalance, allowNegativeBalance, notes]
  );
  const account = result.rows[0];

  if (openingBalance !== 0) {
    await dbClient.query(
      `
      INSERT INTO financial_account_entries (
        tenant_id, financial_account_id, entry_type, source_type, source_id, amount, balance_after, notes, created_by, created_at
      )
      VALUES ($1,$2,'opening','financial_account',$2,$3,$3,$4,$5,NOW())
      `,
      [tenantId, account.id, openingBalance, "Opening balance", createdBy]
    );
  }

  await logAccountingAudit(dbClient, {
    tenantId,
    userId: createdBy || null,
    action: "financial_account_created",
    entityType: "financial_account",
    entityId: account.id,
    afterData: account,
  });

  return normalizeFinancialAccount(account);
};

export const updateFinancialAccount = async (clientOrPool, data = {}) => {
  await ensureAccountingSchema();
  const dbClient = queryable(clientOrPool);
  const tenantId = getTenantScope(data.tenantId ?? data.tenant_id);
  const accountId = numericFilter(data.accountId ?? data.account_id ?? data.id);
  if (tenantId === null) throw new Error("tenantId is required");
  if (!accountId) throw new Error("account_id is required");

  const beforeResult = await dbClient.query(
    `SELECT * FROM financial_accounts WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
    [accountId, tenantId]
  );
  if (!beforeResult.rowCount) {
    const error = new Error("Financial account not found");
    error.status = 404;
    throw error;
  }

  const name = data.name === undefined ? beforeResult.rows[0].name : String(data.name || "").trim();
  const accountType = data.accountType || data.account_type || beforeResult.rows[0].account_type;
  const normalizedType = String(accountType).trim().toLowerCase();
  if (!name) throw new Error("Account name is required");
  if (!FINANCIAL_ACCOUNT_TYPES.has(normalizedType)) throw new Error("Invalid financial account type");

  const result = await dbClient.query(
    `
    UPDATE financial_accounts
    SET name = $1,
        account_type = $2,
        currency = $3,
        branch_id = $4,
        allow_negative_balance = $5,
        is_active = $6,
        notes = $7,
        updated_at = NOW()
    WHERE id = $8
      AND tenant_id = $9
    RETURNING *
    `,
    [
      name,
      normalizedType,
      String(data.currency || beforeResult.rows[0].currency || "EGP").trim().toUpperCase().slice(0, 10),
      data.branchId === undefined && data.branch_id === undefined ? beforeResult.rows[0].branch_id : numericFilter(data.branchId || data.branch_id),
      data.allow_negative_balance === undefined && data.allowNegativeBalance === undefined ? beforeResult.rows[0].allow_negative_balance === true : Boolean(data.allow_negative_balance ?? data.allowNegativeBalance),
      data.is_active === undefined && data.isActive === undefined ? beforeResult.rows[0].is_active : Boolean(data.is_active ?? data.isActive),
      data.notes === undefined ? beforeResult.rows[0].notes : String(data.notes || "").trim(),
      accountId,
      tenantId,
    ]
  );

  await logAccountingAudit(dbClient, {
    tenantId,
    userId: data.updatedBy ?? data.updated_by ?? null,
    action: "financial_account_updated",
    entityType: "financial_account",
    entityId: accountId,
    beforeData: beforeResult.rows[0],
    afterData: result.rows[0],
  });

  return normalizeFinancialAccount(result.rows[0]);
};

export const seedDefaultMoneyAccounts = async (clientOrPool, data = {}) => {
  await ensureAccountingSchema();
  const dbClient = queryable(clientOrPool);
  const tenantId = getTenantScope(data.tenantId ?? data.tenant_id ?? data);
  if (tenantId === null) throw new Error("tenantId is required");

  for (const account of DEFAULT_MONEY_ACCOUNTS) {
    await dbClient.query(
      `
      WITH existing AS (
        SELECT id
        FROM money_accounts
        WHERE tenant_id = $1
          AND LOWER(name) = LOWER($2)
          AND COALESCE(branch_id, 0) = 0
        LIMIT 1
      )
      INSERT INTO money_accounts (
        tenant_id, name, type, provider, branch_id, opening_balance, current_balance, currency, allow_negative_balance, is_active, created_at, updated_at
      )
      SELECT $1,$2,$3,$4,NULL,0,0,'EGP',FALSE,TRUE,NOW(),NOW()
      WHERE NOT EXISTS (SELECT 1 FROM existing)
      ON CONFLICT (tenant_id, LOWER(name), COALESCE(branch_id, 0))
      DO UPDATE SET
        type = EXCLUDED.type,
        provider = COALESCE(NULLIF(money_accounts.provider, ''), EXCLUDED.provider),
        is_active = TRUE,
        updated_at = NOW()
      `,
      [tenantId, account.name, account.type, account.provider || ""]
    );
  }

  const financialAccounts = await dbClient.query(
    `
    SELECT *
    FROM financial_accounts
    WHERE tenant_id = $1
    `,
    [tenantId]
  );
  for (const account of financialAccounts.rows) {
    const type = moneyTypeForFinancialType(account.account_type);
    await dbClient.query(
      `
      WITH existing AS (
        SELECT id
        FROM money_accounts
        WHERE tenant_id = $1
          AND LOWER(name) = LOWER($3)
          AND COALESCE(branch_id, 0) = COALESCE($5::bigint, 0)
        LIMIT 1
      )
      INSERT INTO money_accounts (
        tenant_id, financial_account_id, name, type, provider, branch_id, opening_balance, current_balance, currency, allow_negative_balance, is_active, created_at, updated_at
      )
      SELECT $1,$2,$3,$4,'',$5,COALESCE($6::numeric,0),COALESCE($7::numeric,0),COALESCE(NULLIF($8::text,''),'EGP'),COALESCE($9::boolean,FALSE),COALESCE($10::boolean,TRUE),NOW(),NOW()
      WHERE NOT EXISTS (SELECT 1 FROM existing)
      ON CONFLICT (tenant_id, LOWER(name), COALESCE(branch_id, 0))
      DO UPDATE SET
        financial_account_id = COALESCE(money_accounts.financial_account_id, EXCLUDED.financial_account_id),
        type = EXCLUDED.type,
        currency = EXCLUDED.currency,
        allow_negative_balance = EXCLUDED.allow_negative_balance,
        is_active = EXCLUDED.is_active,
        updated_at = NOW()
      `,
      [
        tenantId,
        account.id,
        account.name,
        type,
        account.branch_id || null,
        account.opening_balance || 0,
        account.current_balance || 0,
        account.currency || "EGP",
        account.allow_negative_balance === true,
        account.is_active !== false,
      ]
    );
  }

  const result = await dbClient.query(
    `
    SELECT ma.*, b.name AS branch_name
    FROM money_accounts ma
    LEFT JOIN branches b ON b.id = ma.branch_id
    WHERE ma.tenant_id = $1
    ORDER BY ma.is_active DESC, ma.type ASC, ma.name ASC
    `,
    [tenantId]
  );
  return result.rows.map(normalizeMoneyAccount);
};

const resolveMoneyAccountId = async (dbClient, data = {}) => {
  const tenantId = getTenantScope(data.tenantId ?? data.tenant_id);
  if (tenantId === null) throw new Error("tenantId is required");
  await seedDefaultMoneyAccounts(dbClient, { tenantId });

  const explicit = numericFilter(data.moneyAccountId ?? data.money_account_id ?? data.accountId ?? data.account_id);
  if (explicit) {
    const result = await dbClient.query(
      `SELECT id FROM money_accounts WHERE id = $1 AND tenant_id = $2 AND is_active = TRUE LIMIT 1`,
      [explicit, tenantId]
    );
    if (result.rows[0]?.id) return Number(result.rows[0].id);
  }

  const financialAccountId = numericFilter(data.financialAccountId ?? data.financial_account_id);
  if (financialAccountId) {
    const linked = await dbClient.query(
      `
      SELECT id
      FROM money_accounts
      WHERE tenant_id = $1
        AND financial_account_id = $2
        AND is_active = TRUE
      ORDER BY id ASC
      LIMIT 1
      `,
      [tenantId, financialAccountId]
    );
    if (linked.rows[0]?.id) return Number(linked.rows[0].id);

    const financial = await dbClient.query(
      `SELECT * FROM financial_accounts WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
      [financialAccountId, tenantId]
    );
    const row = financial.rows[0];
    if (row) {
      const created = await dbClient.query(
        `
        INSERT INTO money_accounts (
          tenant_id, financial_account_id, name, type, provider, branch_id, opening_balance, current_balance, currency, allow_negative_balance, is_active, created_at, updated_at
        )
        VALUES ($1,$2,$3,$4,'',$5,COALESCE($6::numeric,0),COALESCE($7::numeric,0),COALESCE(NULLIF($8::text,''),'EGP'),COALESCE($9::boolean,FALSE),COALESCE($10::boolean,TRUE),NOW(),NOW())
        ON CONFLICT (tenant_id, LOWER(name), COALESCE(branch_id, 0))
        DO UPDATE SET financial_account_id = COALESCE(money_accounts.financial_account_id, EXCLUDED.financial_account_id), allow_negative_balance = EXCLUDED.allow_negative_balance, updated_at = NOW()
        RETURNING id
        `,
        [tenantId, row.id, row.name, moneyTypeForFinancialType(row.account_type), row.branch_id || null, row.opening_balance || 0, row.current_balance || 0, row.currency || "EGP", row.allow_negative_balance === true, row.is_active !== false]
      );
      if (created.rows[0]?.id) return Number(created.rows[0].id);
    }
  }

  const branchId = numericFilter(data.branchId ?? data.branch_id);
  const paymentMethod = normalizePaymentMethodKey(data.paymentMethod ?? data.payment_method ?? "cash");
  const type = data.type && MONEY_ACCOUNT_TYPES.has(String(data.type).toLowerCase())
    ? String(data.type).toLowerCase()
    : defaultMoneyTypeForPaymentMethod(paymentMethod);
  const provider = String(data.provider || defaultProviderForPaymentMethod(paymentMethod) || "").trim();
  const params = [tenantId, type];
  const providerClause = provider ? `AND LOWER(COALESCE(provider, '')) = LOWER($${params.push(provider)})` : "";
  const branchOrder = branchId ? `CASE WHEN branch_id = $${params.push(branchId)} THEN 0 WHEN branch_id IS NULL THEN 1 ELSE 2 END,` : "";
  const result = await dbClient.query(
    `
    SELECT id
    FROM money_accounts
    WHERE tenant_id = $1
      AND type = $2
      AND is_active = TRUE
      ${providerClause}
    ORDER BY ${branchOrder} id ASC
    LIMIT 1
    `,
    params
  );
  if (result.rows[0]?.id) return Number(result.rows[0].id);

  const fallbackName = provider || (type === "cash" ? "Main Cash" : type === "bank" ? "Main Bank" : type === "card" ? "Card Settlement" : "Money Account");
  const created = await dbClient.query(
    `
    INSERT INTO money_accounts (
      tenant_id, name, type, provider, branch_id, opening_balance, current_balance, currency, allow_negative_balance, is_active, created_at, updated_at
    )
    VALUES ($1,$2,$3,$4,$5,0,0,'EGP',FALSE,TRUE,NOW(),NOW())
    ON CONFLICT (tenant_id, LOWER(name), COALESCE(branch_id, 0))
    DO UPDATE SET is_active = TRUE, updated_at = NOW()
    RETURNING id
    `,
    [tenantId, fallbackName, type, provider, branchId || null]
  );
  return Number(created.rows[0].id);
};

export const postMoneyTransaction = async (clientOrPool, data = {}) => {
  const shouldOpenTransaction =
    clientOrPool?.connect &&
    typeof clientOrPool.release !== "function" &&
    !data.__inTransaction;

  if (shouldOpenTransaction) {
    const client = await clientOrPool.connect();
    try {
      await client.query("BEGIN");
      const result = await postMoneyTransaction(client, { ...data, __inTransaction: true });
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  await ensureAccountingSchema();
  const dbClient = queryable(clientOrPool);
  const tenantId = getTenantScope(data.tenantId ?? data.tenant_id);
  if (tenantId === null) throw new Error("tenantId is required");
  const amount = roundMoney(data.amount || 0);
  if (amount <= 0) return null;

  const direction = String(data.direction || "").toLowerCase() === "out" || Number(data.direction) < 0 ? "out" : "in";
  const transactionType = String(data.transactionType || data.transaction_type || "manual_adjustment").trim().toLowerCase();
  if (!MONEY_TRANSACTION_TYPES.has(transactionType)) throw new Error(`Invalid money transaction type: ${transactionType}`);
  const referenceType = data.referenceType || data.reference_type || null;
  const referenceId = numericFilter(data.referenceId ?? data.reference_id);
  const branchId = numericFilter(data.branchId ?? data.branch_id);
  const accountId = await resolveMoneyAccountId(dbClient, {
    tenantId,
    moneyAccountId: data.moneyAccountId ?? data.money_account_id ?? data.accountId ?? data.account_id,
    financialAccountId: data.financialAccountId ?? data.financial_account_id,
    paymentMethod: data.paymentMethod ?? data.payment_method,
    branchId,
    type: data.accountType ?? data.account_type,
    provider: data.provider,
  });
  if (!accountId) return null;

  if (referenceType && referenceId && data.idempotent !== false) {
    const existing = await dbClient.query(
      `
      SELECT mt.*, ma.name AS account_name, ma.type AS account_type
      FROM money_transactions mt
      JOIN money_accounts ma ON ma.id = mt.account_id
      WHERE mt.tenant_id = $1
        AND mt.account_id = $2
        AND mt.reference_type = $3
        AND mt.reference_id = $4
        AND mt.transaction_type = $5
        AND mt.direction = $6
        AND mt.reversal_of IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM money_transactions rev
          WHERE rev.tenant_id = mt.tenant_id
            AND rev.reversal_of = mt.id
        )
      LIMIT 1
      `,
      [tenantId, accountId, referenceType, referenceId, transactionType, direction]
    );
    if (existing.rows[0]) return normalizeMoneyTransaction(existing.rows[0]);
  }

  const delta = direction === "in" ? amount : amount * -1;
  const updated = await dbClient.query(
    `
    UPDATE money_accounts
    SET current_balance = current_balance + $1,
        updated_at = NOW()
    WHERE id = $2
      AND tenant_id = $3
      AND is_active = TRUE
      AND ($1 >= 0 OR allow_negative_balance = TRUE OR current_balance + $1 >= 0)
    RETURNING current_balance
    `,
    [delta, accountId, tenantId]
  );
  if (!updated.rowCount) {
    const accountResult = await dbClient.query(
      `SELECT id, name, type, provider, current_balance, allow_negative_balance FROM money_accounts WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
      [accountId, tenantId]
    );
    const account = accountResult.rows[0] || null;
    if (account && direction === "out" && account.allow_negative_balance !== true) {
      const error = new Error(`رصيد ${account.name || "الحساب"} غير كاف`);
      error.status = 400;
      error.code = "INSUFFICIENT_MONEY_ACCOUNT_BALANCE";
      error.account = normalizeMoneyAccount(account);
      error.attemptedAmount = amount;
      error.availableBalance = roundMoney(account.current_balance || 0);
      error.shortageAmount = roundMoney(amount - Number(account.current_balance || 0));
      throw error;
    }
    return null;
  }

  const result = await dbClient.query(
    `
    INSERT INTO money_transactions (
      tenant_id, account_id, direction, amount, transaction_type, reference_type, reference_id,
      payment_method, notes, created_by, branch_id, balance_after, reversal_of, metadata, created_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,NOW())
    RETURNING *
    `,
    [
      tenantId,
      accountId,
      direction,
      amount,
      transactionType,
      referenceType,
      referenceId,
      data.paymentMethod ?? data.payment_method ?? null,
      String(data.notes || "").trim(),
      data.createdBy ?? data.created_by ?? null,
      branchId,
      updated.rows[0].current_balance,
      data.reversalOf ?? data.reversal_of ?? null,
      JSON.stringify(data.metadata || {}),
    ]
  );

  return normalizeMoneyTransaction(result.rows[0]);
};

export const listMoneyAccounts = async (clientOrPool, data = {}) => {
  await ensureAccountingSchema();
  const dbClient = queryable(clientOrPool);
  const tenantId = getTenantScope(data.tenantId ?? data.tenant_id);
  if (tenantId === null) throw new Error("tenantId is required");
  await seedDefaultMoneyAccounts(dbClient, { tenantId });
  const params = [tenantId];
  const clauses = ["ma.tenant_id = $1"];
  const type = String(data.type || "").trim().toLowerCase();
  const branchId = numericFilter(data.branchId ?? data.branch_id);
  if (type && MONEY_ACCOUNT_TYPES.has(type)) clauses.push(`ma.type = $${params.push(type)}`);
  if (branchId) clauses.push(`ma.branch_id = $${params.push(branchId)}`);
  if (!(data.includeInactive || data.include_inactive)) clauses.push("ma.is_active = TRUE");

  const result = await dbClient.query(
    `
    SELECT ma.*, b.name AS branch_name
    FROM money_accounts ma
    LEFT JOIN branches b ON b.id = ma.branch_id
    WHERE ${clauses.join(" AND ")}
    ORDER BY ma.is_active DESC, ma.type ASC, ma.name ASC
    `,
    params
  );
  return result.rows.map(normalizeMoneyAccount);
};

export const getPaymentAccountStatus = async (clientOrPool, data = {}) => {
  await ensureAccountingSchema();
  const dbClient = queryable(clientOrPool);
  const tenantId = getTenantScope(data.tenantId ?? data.tenant_id);
  if (tenantId === null) throw new Error("tenantId is required");
  const branchId = numericFilter(data.branchId ?? data.branch_id);
  const paymentMethod = normalizePaymentMethodKey(data.paymentMethod ?? data.payment_method ?? "cash");
  const amount = roundMoney(data.amount || 0);
  const directionInput = data.direction ?? data.transactionDirection ?? data.transaction_direction ?? "out";
  const direction = String(directionInput).toLowerCase() === "in" || Number(directionInput) > 0
    ? "in"
    : "out";
  const requiresBalance = direction === "out";
  if (paymentMethod === "customer_wallet") {
    return {
      payment_method: paymentMethod,
      direction,
      requires_balance: false,
      branch_id: branchId,
      mapped_financial_account: null,
      account: null,
      amount,
      available_balance: 0,
      shortage_amount: 0,
      sufficient: true,
      allow_negative_balance: false,
      fallback_accounts: [],
      warning: "Customer wallet is validated against the customer balance, not treasury accounts",
      warning_ar: "رصيد العميل منفصل عن حسابات الخزينة ويتم التحقق منه من رصيد العميل فقط",
    };
  }
  await seedDefaultMoneyAccounts(dbClient, { tenantId });

  const mapped = await resolveFinancialAccountForPayment(dbClient, { tenantId, branchId, paymentMethod });
  const params = [tenantId];
  const clauses = ["ma.tenant_id = $1", "ma.is_active = TRUE"];
  if (mapped.financialAccountId) {
    params.push(mapped.financialAccountId);
    clauses.push(`ma.financial_account_id = $${params.length}`);
  } else {
    const type = defaultMoneyTypeForPaymentMethod(paymentMethod);
    params.push(type);
    clauses.push(`ma.type = $${params.length}`);
    const provider = defaultProviderForPaymentMethod(paymentMethod);
    if (provider) {
      params.push(provider);
      clauses.push(`LOWER(COALESCE(ma.provider, '')) = LOWER($${params.length})`);
    }
  }
  const branchOrder = branchId ? `CASE WHEN ma.branch_id = $${params.push(branchId)} THEN 0 WHEN ma.branch_id IS NULL THEN 1 ELSE 2 END,` : "";
  const result = await dbClient.query(
    `
    SELECT ma.*, b.name AS branch_name
    FROM money_accounts ma
    LEFT JOIN branches b ON b.id = ma.branch_id
    WHERE ${clauses.join(" AND ")}
    ORDER BY ${branchOrder} ma.id ASC
    LIMIT 1
    `,
    params
  );
  const account = result.rows[0] ? normalizeMoneyAccount(result.rows[0]) : null;
  const availableBalance = Number(account?.current_balance || 0);
  const shortageAmount = requiresBalance ? roundMoney(Math.max(0, amount - availableBalance)) : 0;
  const fallbackAccounts = requiresBalance && shortageAmount > 0
    ? await dbClient.query(
        `
        SELECT ma.*, b.name AS branch_name
        FROM money_accounts ma
        LEFT JOIN branches b ON b.id = ma.branch_id
        WHERE ma.tenant_id = $1
          AND ma.is_active = TRUE
          AND ma.current_balance >= $2
          AND ($3::bigint IS NULL OR ma.id <> $3::bigint)
        ORDER BY CASE WHEN ma.branch_id = $4::bigint THEN 0 WHEN ma.branch_id IS NULL THEN 1 ELSE 2 END, ma.current_balance DESC, ma.id ASC
        LIMIT 3
        `,
        [tenantId, amount, account?.id || null, branchId || null]
      )
    : { rows: [] };
  return {
    payment_method: paymentMethod,
    direction,
    requires_balance: requiresBalance,
    branch_id: branchId,
    mapped_financial_account: mapped.mapping || null,
    account,
    amount,
    available_balance: roundMoney(availableBalance),
    shortage_amount: shortageAmount,
    sufficient: !requiresBalance || !account || amount <= 0 || availableBalance >= amount || account.allow_negative_balance === true,
    allow_negative_balance: account?.allow_negative_balance === true,
    fallback_accounts: fallbackAccounts.rows.map(normalizeMoneyAccount),
    warning: mapped.warning || "",
  };
};

export const listMoneyTransactions = async (clientOrPool, data = {}) => {
  await ensureAccountingSchema();
  const dbClient = queryable(clientOrPool);
  const tenantId = getTenantScope(data.tenantId ?? data.tenant_id);
  if (tenantId === null) throw new Error("tenantId is required");
  const params = [tenantId];
  const clauses = ["mt.tenant_id = $1"];
  const add = (value) => {
    params.push(value);
    return `$${params.length}`;
  };
  const accountId = numericFilter(data.accountId ?? data.account_id);
  const branchId = numericFilter(data.branchId ?? data.branch_id);
  const type = String(data.transactionType || data.transaction_type || "").trim().toLowerCase();
  const refType = String(data.referenceType || data.reference_type || "").trim().toLowerCase();
  const fromDate = parseDateFilter(data.fromDate || data.from_date || data.from);
  const toDate = parseDateFilter(data.toDate || data.to_date || data.to);
  if (accountId) clauses.push(`mt.account_id = ${add(accountId)}`);
  if (branchId) clauses.push(`mt.branch_id = ${add(branchId)}`);
  if (type) clauses.push(`mt.transaction_type = ${add(type)}`);
  if (refType) clauses.push(`mt.reference_type = ${add(refType)}`);
  if (fromDate) clauses.push(`DATE(mt.created_at) >= ${add(fromDate)}`);
  if (toDate) clauses.push(`DATE(mt.created_at) <= ${add(toDate)}`);
  const limit = Math.min(Math.max(Number(data.limit || 200), 1), 500);

  const result = await dbClient.query(
    `
    SELECT
      mt.*,
      ma.name AS account_name,
      ma.type AS account_type,
      b.name AS branch_name,
      COALESCE(NULLIF(u.name, ''), NULLIF(u.email, ''), 'System') AS created_by_name
    FROM money_transactions mt
    JOIN money_accounts ma ON ma.id = mt.account_id
    LEFT JOIN branches b ON b.id = mt.branch_id
    LEFT JOIN users u ON u.id = mt.created_by
    WHERE ${clauses.join(" AND ")}
    ORDER BY mt.created_at DESC, mt.id DESC
    LIMIT ${limit}
    `,
    params
  );
  return result.rows.map(normalizeMoneyTransaction);
};

export const reverseMoneyTransactionsForReference = async (clientOrPool, data = {}) => {
  await ensureAccountingSchema();
  const dbClient = queryable(clientOrPool);
  const tenantId = getTenantScope(data.tenantId ?? data.tenant_id);
  if (tenantId === null) throw new Error("tenantId is required");
  const referenceType = String(data.referenceType || data.reference_type || "").trim();
  const referenceId = numericFilter(data.referenceId ?? data.reference_id);
  if (!referenceType || !referenceId) throw new Error("reference_type and reference_id are required");
  const transactionType = String(data.transactionType || data.transaction_type || "").trim().toLowerCase();
  const reversalReferenceType = String(data.reversalReferenceType || data.reversal_reference_type || `${referenceType}_reversal`).trim();
  const reversalReferenceId = numericFilter(data.reversalReferenceId ?? data.reversal_reference_id) || referenceId;
  const notes = String(data.notes || "").trim();
  const createdBy = data.createdBy ?? data.created_by ?? null;

  const params = [tenantId, referenceType, referenceId];
  const clauses = [
    "mt.tenant_id = $1",
    "mt.reference_type = $2",
    "mt.reference_id = $3",
    "mt.reversal_of IS NULL",
  ];
  if (transactionType) {
    params.push(transactionType);
    clauses.push(`mt.transaction_type = $${params.length}`);
  }

  const originals = await dbClient.query(
    `
    SELECT mt.*
    FROM money_transactions mt
    WHERE ${clauses.join(" AND ")}
      AND NOT EXISTS (
        SELECT 1
        FROM money_transactions rev
        WHERE rev.tenant_id = mt.tenant_id
          AND rev.reversal_of = mt.id
      )
    ORDER BY mt.id ASC
    FOR UPDATE
    `,
    params
  );

  const reversals = [];
  for (const original of originals.rows) {
    const reversal = await postMoneyTransaction(dbClient, {
      tenantId,
      accountId: original.account_id,
      direction: original.direction === "in" ? "out" : "in",
      amount: original.amount,
      transactionType: original.transaction_type,
      referenceType: reversalReferenceType,
      referenceId: reversalReferenceId,
      paymentMethod: original.payment_method,
      notes: notes || `Reversal of ${referenceType} #${referenceId}`,
      createdBy,
      branchId: original.branch_id || null,
      reversalOf: original.id,
      metadata: {
        ...(original.metadata && typeof original.metadata === "object" ? original.metadata : {}),
        reversal_reason: data.reason || notes || "",
        reversed_reference_type: referenceType,
        reversed_reference_id: referenceId,
      },
      idempotent: false,
    });
    if (reversal) reversals.push(reversal);
  }

  return reversals;
};

export const getMoneyAccountsReconciliation = async (clientOrPool, data = {}) => {
  await ensureAccountingSchema();
  const dbClient = queryable(clientOrPool);
  const tenantId = getTenantScope(data.tenantId ?? data.tenant_id);
  if (tenantId === null) throw new Error("tenantId is required");
  await seedDefaultMoneyAccounts(dbClient, { tenantId });
  const result = await dbClient.query(
    `
    SELECT
      ma.id,
      ma.name,
      ma.type,
      ma.provider,
      ma.branch_id,
      ma.opening_balance,
      ma.current_balance,
      COALESCE(SUM(CASE WHEN mt.direction = 'in' THEN mt.amount WHEN mt.direction = 'out' THEN -mt.amount ELSE 0 END), 0)::numeric AS transaction_delta,
      (COALESCE(ma.opening_balance, 0) + COALESCE(SUM(CASE WHEN mt.direction = 'in' THEN mt.amount WHEN mt.direction = 'out' THEN -mt.amount ELSE 0 END), 0))::numeric AS calculated_balance,
      (COALESCE(ma.current_balance, 0) - (COALESCE(ma.opening_balance, 0) + COALESCE(SUM(CASE WHEN mt.direction = 'in' THEN mt.amount WHEN mt.direction = 'out' THEN -mt.amount ELSE 0 END), 0)))::numeric AS difference,
      COUNT(mt.id)::integer AS transaction_count
    FROM money_accounts ma
    LEFT JOIN money_transactions mt ON mt.account_id = ma.id AND mt.tenant_id = ma.tenant_id
    WHERE ma.tenant_id = $1
    GROUP BY ma.id
    ORDER BY ABS(COALESCE(ma.current_balance, 0) - (COALESCE(ma.opening_balance, 0) + COALESCE(SUM(CASE WHEN mt.direction = 'in' THEN mt.amount WHEN mt.direction = 'out' THEN -mt.amount ELSE 0 END), 0))) DESC,
             ma.type ASC,
             ma.name ASC
    `,
    [tenantId]
  );
  const accounts = result.rows.map((row) => ({
    id: Number(row.id),
    name: row.name || "",
    type: row.type || "",
    provider: row.provider || "",
    branch_id: row.branch_id === null || row.branch_id === undefined ? null : Number(row.branch_id),
    opening_balance: roundMoney(row.opening_balance || 0),
    current_balance: roundMoney(row.current_balance || 0),
    transaction_delta: roundMoney(row.transaction_delta || 0),
    calculated_balance: roundMoney(row.calculated_balance || 0),
    difference: roundMoney(row.difference || 0),
    transaction_count: Number(row.transaction_count || 0),
    balanced: Math.abs(Number(row.difference || 0)) < 0.01,
  }));
  return {
    balanced: accounts.every((account) => account.balanced),
    out_of_balance_count: accounts.filter((account) => !account.balanced).length,
    accounts,
  };
};

export const transferMoneyAccounts = async (clientOrPool, data = {}) => {
  if (clientOrPool?.connect && !data.__inTransaction) {
    const client = await clientOrPool.connect();
    try {
      await client.query("BEGIN");
      const result = await transferMoneyAccounts(client, { ...data, __inTransaction: true });
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  await ensureAccountingSchema();
  const dbClient = queryable(clientOrPool);
  const tenantId = getTenantScope(data.tenantId ?? data.tenant_id);
  if (tenantId === null) throw new Error("tenantId is required");
  const fromAccountId = numericFilter(data.fromAccountId ?? data.from_account_id);
  const toAccountId = numericFilter(data.toAccountId ?? data.to_account_id);
  const amount = roundMoney(data.amount || 0);
  const createdBy = data.createdBy ?? data.created_by ?? null;
  const notes = String(data.notes || "").trim();
  if (!fromAccountId || !toAccountId) throw new Error("from_account_id and to_account_id are required");
  if (fromAccountId === toAccountId) throw new Error("Transfer accounts must be different");
  if (amount <= 0) throw new Error("Transfer amount must be greater than zero");

  const accounts = await dbClient.query(
    `
    SELECT id
    FROM money_accounts
    WHERE tenant_id = $1
      AND id = ANY($2::bigint[])
      AND is_active = TRUE
    FOR UPDATE
    `,
    [tenantId, [fromAccountId, toAccountId]]
  );
  if (accounts.rowCount !== 2) throw new Error("Both money accounts must exist and be active");

  const reference = await dbClient.query("SELECT nextval(pg_get_serial_sequence('money_transactions', 'id')) AS id");
  const transferId = reference.rows[0].id;

  const outTx = await postMoneyTransaction(dbClient, {
    tenantId,
    accountId: fromAccountId,
    direction: "out",
    amount,
    transactionType: "transfer_between_accounts",
    referenceType: "transfer",
    referenceId: transferId,
    paymentMethod: "mixed",
    notes,
    createdBy,
    idempotent: false,
  });
  const inTx = await postMoneyTransaction(dbClient, {
    tenantId,
    accountId: toAccountId,
    direction: "in",
    amount,
    transactionType: "transfer_between_accounts",
    referenceType: "transfer",
    referenceId: transferId,
    paymentMethod: "mixed",
    notes,
    createdBy,
    idempotent: false,
  });
  return { id: Number(transferId), out_transaction: outTx, in_transaction: inTx };
};

export const createManualMoneyAdjustment = async (clientOrPool, data = {}) => {
  const direction = String(data.direction || "").toLowerCase() === "out" ? "out" : "in";
  return postMoneyTransaction(clientOrPool, {
    ...data,
    direction,
    transactionType: "manual_adjustment",
    referenceType: "manual",
    referenceId: data.referenceId ?? data.reference_id ?? null,
    idempotent: false,
  });
};

export const getTreasuryDashboard = async (clientOrPool, data = {}) => {
  await ensureAccountingSchema();
  const dbClient = queryable(clientOrPool);
  const tenantId = getTenantScope(data.tenantId ?? data.tenant_id);
  if (tenantId === null) throw new Error("tenantId is required");
  const accounts = await listMoneyAccounts(dbClient, { tenantId });
  const summaryResult = await dbClient.query(
    `
    SELECT
      COALESCE(SUM(CASE WHEN direction = 'in' THEN amount ELSE 0 END), 0)::numeric AS money_in,
      COALESCE(SUM(CASE WHEN direction = 'out' THEN amount ELSE 0 END), 0)::numeric AS money_out
    FROM money_transactions
    WHERE tenant_id = $1
      AND DATE(created_at) = CURRENT_DATE
    `,
    [tenantId]
  );
  const totalsByType = accounts.reduce((acc, account) => {
    acc[account.type] = roundMoney((acc[account.type] || 0) + account.current_balance);
    return acc;
  }, {});
  const moneyIn = roundMoney(summaryResult.rows[0]?.money_in || 0);
  const moneyOut = roundMoney(summaryResult.rows[0]?.money_out || 0);
  const transactions = await listMoneyTransactions(dbClient, { tenantId, limit: data.limit || 100 });
  return {
    totals: {
      cash: totalsByType.cash || 0,
      bank: totalsByType.bank || 0,
      wallets: roundMoney((totalsByType.wallet || 0) + (totalsByType.payment_gateway || 0)),
      card_settlements: totalsByType.card || 0,
      today_money_in: moneyIn,
      today_money_out: moneyOut,
      net_movement: roundMoney(moneyIn - moneyOut),
    },
    accounts,
    transactions,
  };
};

const resolveFinancialAccountId = async (dbClient, { tenantId, accountId, accountTypes = [], branchId = null }) => {
  const explicit = numericFilter(accountId);
  if (explicit) {
    const result = await dbClient.query(
      `SELECT id FROM financial_accounts WHERE id = $1 AND tenant_id = $2 AND is_active = TRUE LIMIT 1`,
      [explicit, tenantId]
    );
    return result.rows[0]?.id || null;
  }
  if (!accountTypes.length) return null;
  const params = [tenantId, accountTypes];
  const branchClause = branchId ? "ORDER BY CASE WHEN branch_id = $3 THEN 0 WHEN branch_id IS NULL THEN 1 ELSE 2 END, id ASC" : "ORDER BY branch_id NULLS LAST, id ASC";
  if (branchId) params.push(branchId);
  const result = await dbClient.query(
    `
    SELECT id
    FROM financial_accounts
    WHERE tenant_id = $1
      AND account_type = ANY($2::varchar[])
      AND is_active = TRUE
    ${branchClause}
    LIMIT 1
    `,
    params
  );
  return result.rows[0]?.id || null;
};

export const recordFinancialAccountActivity = async (clientOrPool, data = {}) => {
  await ensureAccountingSchema();
  const dbClient = queryable(clientOrPool);
  const tenantId = getTenantScope(data.tenantId ?? data.tenant_id);
  if (tenantId === null) throw new Error("tenantId is required");
  const amount = roundMoney(data.amount || 0);
  if (amount <= 0) return null;

  const entryType = String(data.entryType || data.entry_type || "").trim().toLowerCase();
  const direction = ["in", "debit", "sale", "cash_in", "opening"].includes(entryType)
    ? 1
    : ["out", "credit", "refund", "expense", "purchase", "cash_out"].includes(entryType)
      ? -1
      : Number(data.direction || 0);
  if (![1, -1].includes(direction)) throw new Error("Financial account activity direction is required");

  const branchId = numericFilter(data.branchId || data.branch_id);
  const paymentMethod = normalizePaymentMethodKey(data.paymentMethod || data.payment_method || "cash");
  if (paymentMethod === "customer_wallet") return null;
  const sourceType = data.sourceType || data.source_type || null;
  const sourceId = numericFilter(data.sourceId ?? data.source_id);
  const fallbackTypes = strictMappedPaymentMethods.has(paymentMethod)
    ? []
    : paymentMethod === "card"
    ? ["card_settlement", "bank"]
    : paymentMethod === "wallet"
      ? ["wallet", "digital_wallet"]
      : paymentMethod === "bank_transfer"
        ? ["bank"]
        : ["cash_drawer", "safe"];
  const explicitAccountId = data.financialAccountId ?? data.financial_account_id ?? data.accountId ?? data.account_id;
  const mappedAccount = explicitAccountId
    ? null
    : await resolveFinancialAccountForPayment(dbClient, { tenantId, branchId, paymentMethod });
  const financialAccountId = await resolveFinancialAccountId(dbClient, {
    tenantId,
    accountId: explicitAccountId ?? mappedAccount?.financialAccountId,
    accountTypes: data.accountTypes || data.account_types || fallbackTypes,
    branchId,
  });
  const moneyTransactionFinancialAccountId = explicitAccountId ?? mappedAccount?.financialAccountId ?? null;
  const mappedAccountName = mappedAccount?.mapping?.financial_account_name || "";
  console.log("[accounting:payment-post]", {
    orderId: sourceId || null,
    invoiceNumber: data.invoiceNumber || data.invoice_number || "",
    rawMethod: data.paymentMethod || data.payment_method || "",
    normalizedMethod: paymentMethod,
    amount,
    mappedAccountId: financialAccountId ? Number(financialAccountId) : null,
    mappedAccountName,
  });
  if (!financialAccountId) {
    return postMoneyTransaction(dbClient, {
      tenantId,
      moneyAccountId: data.moneyAccountId ?? data.money_account_id ?? null,
      branchId,
      paymentMethod,
      direction: direction > 0 ? "in" : "out",
      amount,
      transactionType: moneyTransactionTypeForActivity({
        entryType,
        direction,
        sourceType,
      }),
      referenceType: sourceType,
      referenceId: sourceId,
      notes: data.notes || "",
      createdBy: data.createdBy ?? data.created_by ?? null,
      idempotent: data.idempotent,
    });
  }

  const idempotent = sourceType && sourceId && data.idempotent !== false;
  if (idempotent) {
    const existing = await dbClient.query(
      `
      SELECT id
      FROM financial_account_entries
      WHERE tenant_id = $1
        AND financial_account_id = $2
        AND source_type = $3
        AND source_id = $4
        AND entry_type = $5
      LIMIT 1
      `,
      [tenantId, financialAccountId, sourceType, sourceId, entryType || (direction > 0 ? "in" : "out")]
    );
    if (existing.rowCount) return null;
  }

  const delta = roundMoney(amount * direction);
  const updated = await dbClient.query(
    `
    UPDATE financial_accounts
    SET current_balance = current_balance + $1,
        updated_at = NOW()
    WHERE id = $2
      AND tenant_id = $3
      AND is_active = TRUE
    RETURNING current_balance
    `,
    [delta, financialAccountId, tenantId]
  );
  if (!updated.rowCount) return null;

  const entry = await dbClient.query(
    `
    INSERT INTO financial_account_entries (
      tenant_id, financial_account_id, entry_type, source_type, source_id, amount, balance_after, notes, created_by, created_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
    RETURNING *
    `,
    [
      tenantId,
      financialAccountId,
      entryType || (direction > 0 ? "in" : "out"),
      sourceType,
      sourceId,
      delta,
      updated.rows[0].current_balance,
      String(data.notes || "").trim(),
      data.createdBy ?? data.created_by ?? null,
    ]
  );

  await postMoneyTransaction(dbClient, {
    tenantId,
    moneyAccountId: data.moneyAccountId ?? data.money_account_id ?? null,
    branchId,
    financialAccountId: moneyTransactionFinancialAccountId,
    paymentMethod,
    direction: direction > 0 ? "in" : "out",
    amount,
    transactionType: moneyTransactionTypeForActivity({ entryType, direction, sourceType }),
    referenceType: sourceType,
    referenceId: sourceId,
    notes: data.notes || "",
    createdBy: data.createdBy ?? data.created_by ?? null,
    idempotent: data.idempotent,
  });

  return normalizeFinancialAccountEntry(entry.rows[0]);
};

export const transferFinancialAccounts = async (clientOrPool, data = {}) => {
  await ensureAccountingSchema();
  const dbClient = queryable(clientOrPool);
  const tenantId = getTenantScope(data.tenantId ?? data.tenant_id);
  const fromAccountId = numericFilter(data.fromAccountId ?? data.from_account_id);
  const toAccountId = numericFilter(data.toAccountId ?? data.to_account_id);
  const amount = roundMoney(data.amount || 0);
  const notes = String(data.notes || "").trim();
  const createdBy = data.createdBy ?? data.created_by ?? null;
  if (tenantId === null) throw new Error("tenantId is required");
  if (!fromAccountId || !toAccountId) throw new Error("from_account_id and to_account_id are required");
  if (fromAccountId === toAccountId) throw new Error("Transfer accounts must be different");
  if (amount <= 0) throw new Error("Transfer amount must be greater than zero");

  const accounts = await dbClient.query(
    `
    SELECT *
    FROM financial_accounts
    WHERE tenant_id = $1
      AND id = ANY($2::bigint[])
      AND is_active = TRUE
    FOR UPDATE
    `,
    [tenantId, [fromAccountId, toAccountId]]
  );
  if (accounts.rowCount !== 2) throw new Error("Both financial accounts must exist and be active");

  const transfer = await dbClient.query(
    `
    INSERT INTO financial_account_transfers (
      tenant_id, from_account_id, to_account_id, amount, notes, created_by, created_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,NOW())
    RETURNING *
    `,
    [tenantId, fromAccountId, toAccountId, amount, notes, createdBy]
  );
  const transferRow = transfer.rows[0];

  await recordFinancialAccountActivity(dbClient, {
    tenantId,
    financialAccountId: fromAccountId,
    entryType: "transfer_out",
    direction: -1,
    sourceType: "financial_account_transfer",
    sourceId: transferRow.id,
    amount,
    notes,
    createdBy,
    idempotent: false,
  });
  await recordFinancialAccountActivity(dbClient, {
    tenantId,
    financialAccountId: toAccountId,
    entryType: "transfer_in",
    direction: 1,
    sourceType: "financial_account_transfer",
    sourceId: transferRow.id,
    amount,
    notes,
    createdBy,
    idempotent: false,
  });

  const cash = await resolveAccount(dbClient, tenantId, "1000");
  await createJournalEntry(dbClient, {
    tenantId,
    referenceType: "financial_account_transfer",
    referenceId: transferRow.id,
    entryType: "financial_account_transfer",
    sourceKey: `financial-account-transfer-${transferRow.id}`,
    description: `Financial account transfer #${transferRow.id}`,
    notes,
    createdBy,
    isGenerated: true,
    lines: [
      accountLine(cash, amount, "debit", `Transfer to financial account #${toAccountId}`),
      accountLine(cash, amount, "credit", `Transfer from financial account #${fromAccountId}`),
    ],
  });

  await logAccountingAudit(dbClient, {
    tenantId,
    userId: createdBy,
    action: "financial_account_transfer_created",
    entityType: "financial_account_transfer",
    entityId: transferRow.id,
    afterData: transferRow,
  });

  return transferRow;
};

export const getFinancialAccountTransfers = async (clientOrPool, data = {}) => {
  await ensureAccountingSchema();
  const dbClient = queryable(clientOrPool);
  const tenantId = getTenantScope(data.tenantId ?? data.tenant_id);
  if (tenantId === null) throw new Error("tenantId is required");
  const result = await dbClient.query(
    `
    SELECT
      t.*,
      fa_from.name AS from_account_name,
      fa_to.name AS to_account_name,
      COALESCE(NULLIF(u.name, ''), NULLIF(u.email, ''), 'System') AS created_by_name
    FROM financial_account_transfers t
    JOIN financial_accounts fa_from ON fa_from.id = t.from_account_id
    JOIN financial_accounts fa_to ON fa_to.id = t.to_account_id
    LEFT JOIN users u ON u.id = t.created_by
    WHERE t.tenant_id = $1
    ORDER BY t.created_at DESC, t.id DESC
    LIMIT 200
    `,
    [tenantId]
  );
  return result.rows.map((row) => ({
    id: Number(row.id),
    tenant_id: Number(row.tenant_id),
    from_account_id: Number(row.from_account_id),
    from_account_name: row.from_account_name || "",
    to_account_id: Number(row.to_account_id),
    to_account_name: row.to_account_name || "",
    amount: roundMoney(row.amount || 0),
    notes: row.notes || "",
    created_by: row.created_by === null || row.created_by === undefined ? null : Number(row.created_by),
    created_by_name: row.created_by_name || "",
    created_at: row.created_at,
  }));
};

export const getFinancialAccountEntries = async (clientOrPool, data = {}) => {
  await ensureAccountingSchema();
  const dbClient = queryable(clientOrPool);
  const tenantId = getTenantScope(data.tenantId ?? data.tenant_id);
  const accountId = numericFilter(data.accountId ?? data.account_id);
  if (tenantId === null) throw new Error("tenantId is required");
  if (!accountId) throw new Error("account_id is required");
  const result = await dbClient.query(
    `
    SELECT
      e.*,
      fa.name AS account_name,
      COALESCE(NULLIF(u.name, ''), NULLIF(u.email, ''), 'System') AS created_by_name
    FROM financial_account_entries e
    JOIN financial_accounts fa ON fa.id = e.financial_account_id
    LEFT JOIN users u ON u.id = e.created_by
    WHERE e.tenant_id = $1
      AND e.financial_account_id = $2
    ORDER BY e.created_at DESC, e.id DESC
    LIMIT 200
    `,
    [tenantId, accountId]
  );
  return result.rows.map(normalizeFinancialAccountEntry);
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
      is_generated,
      entry_type,
      source_key,
      created_at,
      updated_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8, CURRENT_DATE),$9,$10,$11,$12,NOW(),NOW())
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
      Boolean(data.isGenerated ?? data.is_generated ?? false),
      data.entryType || data.entry_type || null,
      data.sourceKey || data.source_key || null,
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

const safeEntryNumber = (...parts) =>
  parts
    .filter((part) => part !== undefined && part !== null && String(part).trim() !== "")
    .map((part) => String(part).trim().replace(/[^a-zA-Z0-9_-]+/g, "-"))
    .join("-")
    .slice(0, 96);

const createGeneratedJournalEntry = async (clientOrPool, data = {}) => {
  const tenantId = getTenantScope(data.tenantId ?? data.tenant_id);
  const sourceType = String(data.sourceType || data.referenceType || data.reference_type || "").trim();
  const sourceId = data.sourceId ?? data.referenceId ?? data.reference_id ?? null;
  const entryType = String(data.entryType || data.entry_type || "main").trim();
  const sourceKey = `${sourceType}:${sourceId}:${entryType}`;

  return createJournalEntry(clientOrPool, {
    tenantId,
    entryNumber: data.entryNumber || safeEntryNumber("SYNC", tenantId, sourceType, sourceId, entryType),
    status: "posted",
    referenceType: sourceType,
    referenceId: sourceId,
    entryType,
    sourceKey,
    isGenerated: true,
    entryDate: data.entryDate || data.entry_date || null,
    description: data.description || "",
    createdBy: data.createdBy ?? data.created_by ?? null,
    notes: data.notes || "Generated by accounting rebuild",
    lines: (data.lines || []).filter((line) => roundMoney(line.debit || line.credit || 0) > 0),
  });
};

const hasGeneratedJournalEntries = async (clientOrPool, data = {}) => {
  await ensureAccountingSchema();
  const dbClient = queryable(clientOrPool);
  const tenantId = getTenantScope(data.tenantId ?? data.tenant_id);
  const fromDate = parseDateFilter(data.fromDate || data.from_date || data.from);
  const toDate = parseDateFilter(data.toDate || data.to_date || data.to);
  const branchId = numericFilter(data.branchId || data.branch_id);
  const clauses = ["COALESCE(je.is_generated, FALSE) = TRUE"];
  const params = [];
  const push = (value) => {
    params.push(value);
    return `$${params.length}`;
  };
  if (tenantId !== null) clauses.push(`je.tenant_id = ${push(tenantId)}`);
  if (fromDate) clauses.push(`je.entry_date >= ${push(fromDate)}`);
  if (toDate) clauses.push(`je.entry_date <= ${push(toDate)}`);
  if (branchId) clauses.push(`EXISTS (SELECT 1 FROM journal_entry_lines jel WHERE jel.journal_entry_id = je.id AND jel.branch_id = ${push(branchId)})`);

  const result = await dbClient.query(
    `
    SELECT EXISTS (
      SELECT 1
      FROM journal_entries je
      WHERE ${clauses.join(" AND ")}
      LIMIT 1
    ) AS exists
    `,
    params
  );
  return Boolean(result.rows[0]?.exists);
};

export const rebuildLedgerEntries = async (clientOrPool, data = {}) => {
  await ensureAccountingSchema();
  const dbClient = queryable(clientOrPool);
  const tenantId = getTenantScope(data.tenantId ?? data.tenant_id);
  if (tenantId === null) throw new Error("tenantId is required to rebuild accounting entries");

  const createdBy = data.createdBy ?? data.created_by ?? null;
  const warnings = [];
  let created = 0;
  let skipped = 0;
  let deletedOldGeneratedEntries = 0;

  const [
    orderColumns,
    itemColumns,
    productColumns,
    variantColumns,
    expenseColumns,
    purchaseColumns,
    purchaseItemColumns,
    returnColumns,
    returnItemColumns,
    inventoryMovementColumns,
    overrideColumns,
  ] = await Promise.all([
    getTableColumns(dbClient, "orders"),
    getTableColumns(dbClient, "order_items"),
    getTableColumns(dbClient, "products"),
    getTableColumns(dbClient, "product_variants"),
    getTableColumns(dbClient, "expenses"),
    getTableColumns(dbClient, "purchases"),
    getTableColumns(dbClient, "purchase_items"),
    getTableColumns(dbClient, "returns"),
    getTableColumns(dbClient, "return_items"),
    getTableColumns(dbClient, "inventory_movements"),
    getTableColumns(dbClient, "accounting_order_item_cost_overrides"),
  ]);

  await seedDefaultAccounts(dbClient, tenantId);
  const cash = await resolveAccount(dbClient, tenantId, "1000");
  const receivable = await resolveAccount(dbClient, tenantId, "1100");
  const revenue = await resolveAccount(dbClient, tenantId, "4000");
  const inventory = await resolveAccount(dbClient, tenantId, "1200");
  const cogs = await resolveAccount(dbClient, tenantId, "5000");
  const payable = await resolveAccount(dbClient, tenantId, "2000");
  const operatingExpense = await resolveAccount(dbClient, tenantId, "5200");
  const salesReturns = await resolveAccount(dbClient, tenantId, "4020");
  const adjustmentGainLoss = await resolveAccount(dbClient, tenantId, "5300");

  const runGenerated = async (entry) => {
    const lines = (entry.lines || []).filter((line) => roundMoney(line.debit || line.credit || 0) > 0);
    if (lines.length < 2) {
      skipped += 1;
      return null;
    }
    await createGeneratedJournalEntry(dbClient, { ...entry, tenantId, createdBy, lines });
    created += 1;
    return true;
  };

  const deletedResult = await dbClient.query(
    `
    DELETE FROM journal_entries
    WHERE tenant_id = $1
      AND COALESCE(is_generated, FALSE) = TRUE
    RETURNING id
    `,
    [tenantId]
  );
  deletedOldGeneratedEntries = deletedResult.rowCount || 0;

  if (orderColumns.size) {
    const totalExpr = coalesceColumnExpr("o", orderColumns, ["total_amount", "total", "total_price", "grand_total", "net_total"], "0");
    const paidExpr = coalesceColumnExpr("o", orderColumns, ["paid_amount", "amount_paid"], totalExpr);
    const referenceExpr = columnExpr("o", orderColumns, ["invoice_number", "order_number", "reference"], "('ORD-' || o.id)");
    const dateExpr = columnExpr("o", orderColumns, ["completed_at", "paid_at", "created_at"], "CURRENT_TIMESTAMP");
    const branchExpr = columnExpr("o", orderColumns, ["branch_id"], "NULL");
    const clauses = ["o.tenant_id = $1", ...paidOrderClauses(orderColumns)];
    const orderRows = await dbClient.query(
      `
      SELECT
        o.id,
        ${referenceExpr} AS reference,
        ${dateExpr} AS entry_date,
        ${branchExpr} AS branch_id,
        COALESCE(${totalExpr}, 0)::numeric AS total_amount,
        COALESCE(${paidExpr}, ${totalExpr}, 0)::numeric AS paid_amount
      FROM orders o
      WHERE ${clauses.join(" AND ")}
      ORDER BY ${dateExpr} ASC, o.id ASC
      `,
      [tenantId]
    );

    let cogsByOrder = new Map();
    let missingCostLines = 0;
    if (itemColumns.size) {
      const quantityExpr = coalesceColumnExpr("oi", itemColumns, ["quantity", "qty"], "0");
      const returnedExpr = columnExpr("oi", itemColumns, ["returned_quantity"], "0");
      const netQuantityExpr = `GREATEST((${quantityExpr}) - (${returnedExpr}), 0)`;
      const productIdExpr = itemColumns.has("product_id")
        ? `COALESCE(oi.product_id, ${variantColumns.size && itemColumns.has("variant_id") ? "pv.product_id" : "NULL::bigint"})`
        : variantColumns.size && itemColumns.has("variant_id")
          ? "pv.product_id"
          : "NULL::bigint";
      const variantIdExpr = itemColumns.has("variant_id") ? "oi.variant_id" : "NULL::bigint";
      const purchaseLookup = purchaseCostLookup({
        purchaseColumns,
        purchaseItemColumns,
        variantColumns,
        productIdExpr,
        variantIdExpr,
      });
      const itemCostExpr = positiveCoalesceColumnExpr(
        "aoc",
        overrideColumns,
        ["unit_cost"],
        positiveCoalesceColumnExpr("pv", variantColumns, ["last_purchase_cost", "purchase_cost", "cost_price", "unit_cost"], positiveCoalesceColumnExpr("p", productColumns, ["last_purchase_cost", "purchase_cost", "cost_price", "unit_cost"], purchaseLookup.expr))
      );
      const variantJoin = variantColumns.size && itemColumns.has("variant_id") ? "LEFT JOIN product_variants pv ON pv.id = oi.variant_id" : "";
      const productJoin = productColumns.size
        ? `LEFT JOIN products p ON p.id = ${productIdExpr}`
        : "";
      const overrideJoin = overrideColumns.size ? "LEFT JOIN accounting_order_item_cost_overrides aoc ON aoc.order_item_id = oi.id AND aoc.tenant_id = $1" : "";
      const cogsRows = await dbClient.query(
        `
        SELECT
          oi.order_id,
          COALESCE(SUM(${netQuantityExpr} * GREATEST(${itemCostExpr}, 0)), 0)::numeric AS cogs_amount,
          COUNT(*) FILTER (WHERE ${netQuantityExpr} > 0 AND GREATEST(${itemCostExpr}, 0) = 0)::int AS missing_cost_lines
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        ${variantJoin}
        ${productJoin}
        ${overrideJoin}
        ${purchaseLookup.join}
        WHERE o.tenant_id = $1
          AND ${paidOrderClauses(orderColumns).join(" AND ")}
        GROUP BY oi.order_id
        `,
        [tenantId]
      );
      cogsRows.rows.forEach((row) => {
        cogsByOrder.set(Number(row.order_id), roundMoney(row.cogs_amount || 0));
        missingCostLines += Number(row.missing_cost_lines || 0);
      });
    } else {
      warnings.push("order_items table is missing; sale COGS entries were skipped.");
    }

    if (missingCostLines > 0) {
      warnings.push(`${missingCostLines} sold item line(s) have no cost override, product cost, variant cost, or purchase cost; their COGS was posted as 0.`);
    }

    for (const order of orderRows.rows) {
      const amount = roundMoney(order.total_amount || 0);
      const paid = Math.min(roundMoney(order.paid_amount || amount), amount);
      const receivableAmount = roundMoney(Math.max(amount - paid, 0));
      const cogsAmount = roundMoney(cogsByOrder.get(Number(order.id)) || 0);
      if (amount > 0) {
        await runGenerated({
          sourceType: "order",
          sourceId: order.id,
          entryType: "sale",
          entryDate: order.entry_date,
          description: `Generated sale entry ${order.reference || order.id}`,
          notes: "Generated sale revenue from historical order",
          lines: [
            ...(paid > 0 ? [accountLine(cash, paid, "debit", "Cash or bank received", order.branch_id)] : []),
            ...(receivableAmount > 0 ? [accountLine(receivable, receivableAmount, "debit", "Accounts receivable", order.branch_id)] : []),
            accountLine(revenue, amount, "credit", "Sales revenue", order.branch_id),
          ],
        });
      } else {
        skipped += 1;
      }
      if (cogsAmount > 0) {
        await runGenerated({
          sourceType: "order",
          sourceId: order.id,
          entryType: "cogs",
          entryDate: order.entry_date,
          description: `Generated COGS entry ${order.reference || order.id}`,
          notes: "Generated cost of goods sold from historical order items",
          lines: [
            accountLine(cogs, cogsAmount, "debit", "Cost of goods sold", order.branch_id),
            accountLine(inventory, cogsAmount, "credit", "Inventory relieved", order.branch_id),
          ],
        });
      }
    }
  } else {
    warnings.push("orders table is missing; sales entries were skipped.");
  }

  if (expenseColumns.size) {
    const amountExpr = coalesceColumnExpr("e", expenseColumns, ["amount", "total", "total_amount"], "0");
    const categoryExpr = coalesceColumnExpr("e", expenseColumns, ["category", "category_name", "expense_type", "type"], "''");
    const titleExpr = coalesceColumnExpr("e", expenseColumns, ["title", "description", "note"], "''");
    const dateExpr = columnExpr("e", expenseColumns, ["expense_date", "date", "created_at"], "CURRENT_TIMESTAMP");
    const branchExpr = columnExpr("e", expenseColumns, ["branch_id"], "NULL");
    const clauses = ["e.tenant_id = $1"];
    if (expenseColumns.has("status")) clauses.push(`LOWER(COALESCE(e.status, '')) NOT IN ('cancelled', 'canceled', 'rejected', 'void', 'deleted')`);
    const expenseRows = await dbClient.query(
      `
      SELECT
        e.id,
        ${dateExpr} AS entry_date,
        ${branchExpr} AS branch_id,
        COALESCE(NULLIF(${categoryExpr}, ''), 'Operating Expense') AS category,
        COALESCE(NULLIF(${titleExpr}, ''), 'Expense') AS description,
        COALESCE(${amountExpr}, 0)::numeric AS amount
      FROM expenses e
      WHERE ${clauses.join(" AND ")}
      ORDER BY ${dateExpr} ASC, e.id ASC
      `,
      [tenantId]
    );

    for (const expense of expenseRows.rows) {
      const amount = roundMoney(expense.amount || 0);
      if (amount <= 0) {
        skipped += 1;
        continue;
      }
      await runGenerated({
        sourceType: "expense",
        sourceId: expense.id,
        entryType: "expense",
        entryDate: expense.entry_date,
        description: `Generated expense entry ${expense.description || expense.id}`,
        notes: expense.category || "Operating expense",
        lines: [
          accountLine(operatingExpense, amount, "debit", expense.category || "Operating expense", expense.branch_id),
          accountLine(cash, amount, "credit", "Expense paid", expense.branch_id),
        ],
      });
    }
  } else {
    warnings.push("expenses table is missing; expense entries were skipped.");
  }

  if (purchaseColumns.size) {
    const totalExpr = coalesceColumnExpr("p", purchaseColumns, ["total", "total_amount", "grand_total", "net_total"], "0");
    const paidExpr = coalesceColumnExpr("p", purchaseColumns, ["paid_amount", "amount_paid"], "0");
    const referenceExpr = columnExpr("p", purchaseColumns, ["purchase_number", "reference"], "('PUR-' || p.id)");
    const dateExpr = columnExpr("p", purchaseColumns, ["purchase_date", "date", "created_at"], "CURRENT_TIMESTAMP");
    const branchExpr = columnExpr("p", purchaseColumns, ["branch_id"], "NULL");
    const clauses = ["p.tenant_id = $1"];
    if (purchaseColumns.has("status")) clauses.push(`LOWER(COALESCE(p.status, '')) NOT IN ('cancelled', 'canceled', 'void', 'deleted', 'draft')`);
    const purchaseRows = await dbClient.query(
      `
      SELECT
        p.id,
        ${referenceExpr} AS reference,
        ${dateExpr} AS entry_date,
        ${branchExpr} AS branch_id,
        COALESCE(${totalExpr}, 0)::numeric AS amount,
        COALESCE(${paidExpr}, 0)::numeric AS paid_amount
      FROM purchases p
      WHERE ${clauses.join(" AND ")}
      ORDER BY ${dateExpr} ASC, p.id ASC
      `,
      [tenantId]
    );

    for (const purchase of purchaseRows.rows) {
      const amount = roundMoney(purchase.amount || 0);
      if (amount <= 0) {
        skipped += 1;
        continue;
      }
      const paid = Math.min(roundMoney(purchase.paid_amount || 0), amount);
      const unpaid = roundMoney(Math.max(amount - paid, 0));
      await runGenerated({
        sourceType: "purchase",
        sourceId: purchase.id,
        entryType: "purchase",
        entryDate: purchase.entry_date,
        description: `Generated purchase entry ${purchase.reference || purchase.id}`,
        notes: "Generated inventory purchase from historical purchase",
        lines: [
          accountLine(inventory, amount, "debit", "Inventory purchase", purchase.branch_id),
          ...(paid > 0 ? [accountLine(cash, paid, "credit", "Purchase paid", purchase.branch_id)] : []),
          ...(unpaid > 0 ? [accountLine(payable, unpaid, "credit", "Accounts payable", purchase.branch_id)] : []),
        ],
      });
    }
  } else {
    warnings.push("purchases table is missing; purchase entries were skipped.");
  }

  if (returnColumns.size) {
    const refundExpr = coalesceColumnExpr("r", returnColumns, ["refund_amount", "total", "total_amount"], "0");
    const referenceExpr = columnExpr("r", returnColumns, ["return_number", "reference"], "('RET-' || r.id)");
    const dateExpr = columnExpr("r", returnColumns, ["return_date", "date", "created_at"], "CURRENT_TIMESTAMP");
    const restockExpr = columnExpr("r", returnColumns, ["restock"], "FALSE");
    const branchExpr = orderColumns.has("branch_id") ? "o.branch_id" : "NULL";
    const orderJoin = orderColumns.size && returnColumns.has("order_id") ? "LEFT JOIN orders o ON o.id = r.order_id" : "";
    const clauses = ["r.tenant_id = $1"];
    if (returnColumns.has("status")) clauses.push(`LOWER(COALESCE(r.status, '')) NOT IN ('cancelled', 'canceled', 'rejected', 'void', 'deleted')`);
    const returnRows = await dbClient.query(
      `
      SELECT
        r.id,
        ${referenceExpr} AS reference,
        ${dateExpr} AS entry_date,
        ${branchExpr} AS branch_id,
        COALESCE(${refundExpr}, 0)::numeric AS amount,
        COALESCE(${restockExpr}, FALSE) AS restock
      FROM returns r
      ${orderJoin}
      WHERE ${clauses.join(" AND ")}
      ORDER BY ${dateExpr} ASC, r.id ASC
      `,
      [tenantId]
    );

    let returnCogs = new Map();
    if (returnItemColumns.size && itemColumns.size) {
      const quantityExpr = coalesceColumnExpr("ri", returnItemColumns, ["quantity", "qty"], "0");
      const productIdExpr = itemColumns.has("product_id")
        ? `COALESCE(oi.product_id, ${variantColumns.size && itemColumns.has("variant_id") ? "pv.product_id" : "NULL::bigint"})`
        : variantColumns.size && itemColumns.has("variant_id")
          ? "pv.product_id"
          : "NULL::bigint";
      const variantIdExpr = itemColumns.has("variant_id") ? "oi.variant_id" : "NULL::bigint";
      const purchaseLookup = purchaseCostLookup({
        purchaseColumns,
        purchaseItemColumns,
        variantColumns,
        productIdExpr,
        variantIdExpr,
      });
      const itemCostExpr = positiveCoalesceColumnExpr(
        "aoc",
        overrideColumns,
        ["unit_cost"],
        positiveCoalesceColumnExpr("pv", variantColumns, ["last_purchase_cost", "purchase_cost", "cost_price", "unit_cost"], positiveCoalesceColumnExpr("p", productColumns, ["last_purchase_cost", "purchase_cost", "cost_price", "unit_cost"], purchaseLookup.expr))
      );
      const variantJoin = variantColumns.size && itemColumns.has("variant_id") ? "LEFT JOIN product_variants pv ON pv.id = oi.variant_id" : "";
      const productJoin = productColumns.size
        ? `LEFT JOIN products p ON p.id = ${productIdExpr}`
        : "";
      const overrideJoin = overrideColumns.size ? "LEFT JOIN accounting_order_item_cost_overrides aoc ON aoc.order_item_id = oi.id AND aoc.tenant_id = $1" : "";
      const cogsRows = await dbClient.query(
        `
        SELECT
          ri.return_id,
          COALESCE(SUM(${quantityExpr} * GREATEST(${itemCostExpr}, 0)), 0)::numeric AS cogs_amount
        FROM return_items ri
        JOIN returns r ON r.id = ri.return_id
        JOIN order_items oi ON oi.id = ri.order_item_id
        ${variantJoin}
        ${productJoin}
        ${overrideJoin}
        ${purchaseLookup.join}
        WHERE r.tenant_id = $1
        GROUP BY ri.return_id
        `,
        [tenantId]
      );
      cogsRows.rows.forEach((row) => returnCogs.set(Number(row.return_id), roundMoney(row.cogs_amount || 0)));
    }

    for (const item of returnRows.rows) {
      const amount = roundMoney(item.amount || 0);
      if (amount > 0) {
        await runGenerated({
          sourceType: "return",
          sourceId: item.id,
          entryType: "refund",
          entryDate: item.entry_date,
          description: `Generated refund entry ${item.reference || item.id}`,
          notes: "Generated customer return or refund",
          lines: [
            accountLine(salesReturns, amount, "debit", "Sales returns", item.branch_id),
            accountLine(cash, amount, "credit", "Cash refunded", item.branch_id),
          ],
        });
      }
      const reversedCogs = roundMoney(returnCogs.get(Number(item.id)) || 0);
      if (item.restock && reversedCogs > 0) {
        await runGenerated({
          sourceType: "return",
          sourceId: item.id,
          entryType: "reverse_cogs",
          entryDate: item.entry_date,
          description: `Generated return inventory entry ${item.reference || item.id}`,
          notes: "Generated inventory return to stock",
          lines: [
            accountLine(inventory, reversedCogs, "debit", "Returned stock", item.branch_id),
            accountLine(cogs, reversedCogs, "credit", "Reverse COGS", item.branch_id),
          ],
        });
      }
    }
  }

  if (inventoryMovementColumns.size) {
    const quantityExpr = columnExpr("im", inventoryMovementColumns, ["quantity_change", "quantity"], "0");
    const amountExpr = coalesceColumnExpr("im", inventoryMovementColumns, ["total_cost"], `ABS(${quantityExpr}) * ${columnExpr("im", inventoryMovementColumns, ["unit_cost"], "0")}`);
    const movementTypeExpr = columnExpr("im", inventoryMovementColumns, ["movement_type", "reference_type"], "''");
    const referenceTypeExpr = columnExpr("im", inventoryMovementColumns, ["reference_type"], "''");
    const dateExpr = columnExpr("im", inventoryMovementColumns, ["movement_date", "date", "created_at"], "CURRENT_TIMESTAMP");
    const branchExpr = columnExpr("im", inventoryMovementColumns, ["branch_id"], "NULL");
    const clauses = ["im.tenant_id = $1"];
    if (inventoryMovementColumns.has("undone_at")) clauses.push("im.undone_at IS NULL");
    clauses.push(`LOWER(COALESCE(${movementTypeExpr}, '')) IN ('manual_adjustment', 'adjustment', 'stock_adjustment', 'inventory_adjustment')`);
    clauses.push(`LOWER(COALESCE(${referenceTypeExpr}, '')) NOT IN ('order', 'sale', 'purchase', 'return')`);
    const movementRows = await dbClient.query(
      `
      SELECT
        im.id,
        ${dateExpr} AS entry_date,
        ${branchExpr} AS branch_id,
        COALESCE(${movementTypeExpr}, 'inventory_adjustment') AS movement_type,
        COALESCE(${quantityExpr}, 0)::numeric AS quantity_change,
        COALESCE(${amountExpr}, 0)::numeric AS amount
      FROM inventory_movements im
      WHERE ${clauses.join(" AND ")}
      ORDER BY ${dateExpr} ASC, im.id ASC
      `,
      [tenantId]
    );
    for (const movement of movementRows.rows) {
      const amount = roundMoney(Math.abs(Number(movement.amount || 0)));
      if (amount <= 0) {
        skipped += 1;
        continue;
      }
      const isIncrease = Number(movement.quantity_change || 0) >= 0;
      await runGenerated({
        sourceType: "manual_adjustment",
        sourceId: movement.id,
        entryType: "inventory_adjustment",
        entryDate: movement.entry_date,
        description: `Generated inventory adjustment ${movement.id}`,
        notes: movement.movement_type || "Inventory adjustment",
        lines: isIncrease
          ? [
              accountLine(inventory, amount, "debit", "Inventory increase", movement.branch_id),
              accountLine(adjustmentGainLoss, amount, "credit", "Stock adjustment gain", movement.branch_id),
            ]
          : [
              accountLine(adjustmentGainLoss, amount, "debit", "Stock adjustment loss", movement.branch_id),
              accountLine(inventory, amount, "credit", "Inventory decrease", movement.branch_id),
            ],
      });
    }
  }

  return {
    success: true,
    created,
    skipped,
    deleted_old_generated_entries: deletedOldGeneratedEntries,
    warnings,
  };
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

export const getFinancialReportsSummary = async (clientOrPool, data = {}) => {
  const dbClient = queryable(clientOrPool);
  const tenantId = getTenantScope(data.tenantId ?? data.tenant_id);
  const fromDate = parseDateFilter(data.fromDate || data.from_date || data.from);
  const toDate = parseDateFilter(data.toDate || data.to_date || data.to);
  const branchId = numericFilter(data.branchId || data.branch_id);

  const [orderColumns, itemColumns, expenseColumns, productColumns, variantColumns, productVariantImagesColumns, customerColumns] = await Promise.all([
    getTableColumns(dbClient, "orders"),
    getTableColumns(dbClient, "order_items"),
    getTableColumns(dbClient, "expenses"),
    getTableColumns(dbClient, "products"),
    getTableColumns(dbClient, "product_variants"),
    getTableColumns(dbClient, "product_variant_images"),
    getTableColumns(dbClient, "customers"),
  ]);

  const orderTableExists = orderColumns.size > 0;
  const itemTableExists = itemColumns.size > 0;
  const expenseTableExists = expenseColumns.size > 0;
  const productTableExists = productColumns.size > 0;
  const variantTableExists = variantColumns.size > 0;
  const productVariantImagesTableExists = productVariantImagesColumns.size > 0;

  let revenue = 0;
  let ordersCount = 0;
  let topCustomers = [];
  let topProducts = [];

  if (orderTableExists) {
    const clauses = [];
    const params = [];
    addScopedWhere({ clauses, params, alias: "o", columns: orderColumns, tenantId, fromDate, toDate, branchId });
    clauses.push(...paidOrderClauses(orderColumns));
    const totalExpr = coalesceColumnExpr("o", orderColumns, ["total_amount", "total", "total_price", "grand_total", "net_total"], "0");
    const revenueResult = await dbClient.query(
      `
      SELECT
        COALESCE(SUM(${totalExpr}), 0)::numeric AS revenue,
        COUNT(*)::int AS orders_count
      FROM orders o
      ${whereSql(clauses)}
      `,
      params
    );
    revenue = roundMoney(revenueResult.rows[0]?.revenue || 0);
    ordersCount = Number(revenueResult.rows[0]?.orders_count || 0);

    const customerIdExpr = orderColumns.has("customer_id") ? "o.customer_id" : "NULL::bigint";
    const customerNameExpr = coalesceColumnExpr("o", orderColumns, ["customer_name", "customer"], "''");
    const customerJoin = customerColumns.size && orderColumns.has("customer_id")
      ? `LEFT JOIN customers c ON c.id = o.customer_id${tenantId !== null && customerColumns.has("tenant_id") ? " AND c.tenant_id = o.tenant_id" : ""}`
      : "";
    const displayNameExpr = customerJoin
      ? `COALESCE(NULLIF(${customerNameExpr}, ''), NULLIF(${columnExpr("c", customerColumns, ["name", "full_name", "customer_name"], "''")}, ''), 'Walk-in Customer')`
      : `COALESCE(NULLIF(${customerNameExpr}, ''), 'Walk-in Customer')`;
    const customerParams = [...params];
    const customerQuery = `
      SELECT
        ${customerIdExpr} AS customer_id,
        ${displayNameExpr} AS name,
        COUNT(*)::int AS orders_count,
        COALESCE(SUM(${totalExpr}), 0)::numeric AS total_revenue
      FROM orders o
      ${customerJoin}
      ${whereSql(clauses)}
      GROUP BY ${customerIdExpr}, ${displayNameExpr}
      ORDER BY total_revenue DESC, orders_count DESC
      LIMIT 5
    `;
    topCustomers = (await dbClient.query(customerQuery, customerParams)).rows.map((row) => ({
      customer_id: row.customer_id ?? null,
      name: row.name || "Walk-in Customer",
      orders_count: Number(row.orders_count || 0),
      total_revenue: roundMoney(row.total_revenue || 0),
    }));
  }

  if (orderTableExists && itemTableExists) {
    const clauses = [];
    const params = [];
    addScopedWhere({ clauses, params, alias: "o", columns: orderColumns, tenantId, fromDate, toDate, branchId });
    clauses.push(...paidOrderClauses(orderColumns));
    if (tenantId !== null && itemColumns.has("tenant_id")) {
      params.push(tenantId);
      clauses.push(`oi.tenant_id = $${params.length}`);
    }
    const quantityExpr = coalesceColumnExpr("oi", itemColumns, ["quantity", "qty"], "0");
    const returnedExpr = columnExpr("oi", itemColumns, ["returned_quantity"], "0");
    const netQuantityExpr = `GREATEST((${quantityExpr}) - (${returnedExpr}), 0)`;
    const salePriceExpr = coalesceColumnExpr("oi", itemColumns, ["sale_price", "price", "unit_price"], "0");
    const itemTotalExpr = coalesceColumnExpr("oi", itemColumns, ["total_amount", "total", "line_total", "subtotal"], `(${salePriceExpr}) * (${quantityExpr})`);
    const productIdExpr = itemColumns.has("product_id")
      ? "oi.product_id"
      : itemColumns.has("variant_id") && variantTableExists
        ? "pv.product_id"
        : "NULL::bigint";
    const productNameExpr = productTableExists
      ? `COALESCE(NULLIF(${columnExpr("p", productColumns, ["name", "title"], "''")}, ''), NULLIF(${columnExpr("oi", itemColumns, ["product_name", "name"], "''")}, ''), 'Unknown Product')`
      : `COALESCE(NULLIF(${columnExpr("oi", itemColumns, ["product_name", "name"], "''")}, ''), 'Unknown Product')`;
    const variantJoin = variantTableExists && itemColumns.has("variant_id") ? "LEFT JOIN product_variants pv ON pv.id = oi.variant_id" : "";
    const productJoin = productTableExists ? `LEFT JOIN products p ON p.id = ${productIdExpr}` : "";
    const productVariantImageJoin = productVariantImagesTableExists && productJoin
      ? `
        LEFT JOIN LATERAL (
          SELECT
            (array_agg(image_url ORDER BY is_primary DESC, sort_order ASC, id ASC))[1] AS image_url,
            COALESCE(jsonb_agg(image_url ORDER BY is_primary DESC, sort_order ASC, id ASC) FILTER (WHERE NULLIF(image_url, '') IS NOT NULL), '[]'::jsonb) AS images
          FROM product_variant_images pvi
          WHERE NULLIF(pvi.image_url, '') IS NOT NULL
            AND (
              ${variantJoin ? "pvi.variant_id = pv.id OR" : ""}
              (
                pvi.product_id = p.id
                AND (
                  NULLIF(pvi.color_name, '') IS NULL
                  ${variantJoin ? "OR LOWER(pvi.color_name) = LOWER(COALESCE(pv.color, ''))" : ""}
                )
              )
            )
        ) pvi ON TRUE
      `
      : "";
    const orderExpr = "o.created_at";
    const itemImageCandidates = [];
    const addImageCandidate = (expr) => {
      itemImageCandidates.push(`(ARRAY_AGG(NULLIF(${expr}, '') ORDER BY ${orderExpr} DESC, oi.id ASC) FILTER (WHERE NULLIF(${expr}, '') IS NOT NULL))[1]`);
    };
    if (itemColumns.has("image_url")) addImageCandidate("oi.image_url");
    if (itemColumns.has("image")) addImageCandidate("oi.image");
    if (itemColumns.has("main_image")) addImageCandidate("oi.main_image");
    if (itemColumns.has("product_image")) addImageCandidate("oi.product_image");
    if (itemColumns.has("product_image_url")) addImageCandidate("oi.product_image_url");
    if (itemColumns.has("variant_image")) addImageCandidate("oi.variant_image");
    if (itemColumns.has("variant_image_url")) addImageCandidate("oi.variant_image_url");
    if (variantTableExists && variantColumns.has("image_url")) addImageCandidate("pv.image_url");
    if (variantTableExists && variantColumns.has("image")) addImageCandidate("pv.image");
    if (variantTableExists && variantColumns.has("main_image")) addImageCandidate("pv.main_image");
    if (productTableExists && productColumns.has("image_url")) addImageCandidate("p.image_url");
    if (productTableExists && productColumns.has("image")) addImageCandidate("p.image");
    if (productTableExists && productColumns.has("main_image")) addImageCandidate("p.main_image");
    if (productVariantImageJoin) addImageCandidate("pvi.image_url");
    const topProductImageExpr = itemImageCandidates.length ? `COALESCE(${itemImageCandidates.join(", ")}, '')` : "''";
    const topProductsResult = await dbClient.query(
      `
      SELECT
        product_id,
        product_name,
        units_sold,
        total_revenue,
        image_url,
        image,
        product_image_url,
        product_image,
        variant_image_url,
        variant_image
      FROM (
        SELECT
          ${productIdExpr} AS product_id,
          ${productNameExpr} AS product_name,
          COALESCE(SUM(${netQuantityExpr}), 0)::numeric AS units_sold,
          COALESCE(SUM(
            CASE
              WHEN (${quantityExpr}) > 0 THEN (${itemTotalExpr}) * (${netQuantityExpr}) / NULLIF((${quantityExpr}), 0)
              ELSE 0
            END
          ), 0)::numeric AS total_revenue,
          ${topProductImageExpr} AS image_url,
          ${topProductImageExpr} AS image,
          ${topProductImageExpr} AS product_image_url,
          ${topProductImageExpr} AS product_image,
          ${topProductImageExpr} AS variant_image_url,
          ${topProductImageExpr} AS variant_image
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        ${variantJoin}
        ${productJoin}
        ${productVariantImageJoin}
        ${whereSql(clauses)}
        GROUP BY ${productIdExpr}, ${productNameExpr}
      ) top_products
      ORDER BY total_revenue DESC, units_sold DESC
      LIMIT 5
      `,
      params
    );
    topProducts = topProductsResult.rows.map((row) => ({
      product_id: row.product_id ?? null,
      product_name: row.product_name || "Unknown Product",
      name: row.product_name || "Unknown Product",
      quantity: Number(row.units_sold || 0),
      total: roundMoney(row.total_revenue || 0),
      image_url: resolveReportImageUrl(row.image_url || row.image || row.product_image_url || row.product_image || row.variant_image_url || row.variant_image),
      image: resolveReportImageUrl(row.image || row.image_url || row.product_image || row.product_image_url || row.variant_image || row.variant_image_url),
      product_image_url: resolveReportImageUrl(row.product_image_url || row.product_image || row.image_url || row.image),
      product_image: resolveReportImageUrl(row.product_image || row.product_image_url || row.image_url || row.image),
      variant_image_url: resolveReportImageUrl(row.variant_image_url || row.variant_image || row.image_url || row.image),
      variant_image: resolveReportImageUrl(row.variant_image || row.variant_image_url || row.image_url || row.image),
      units_sold: Number(row.units_sold || 0),
      total_revenue: roundMoney(row.total_revenue || 0),
    }));
  }

  let expenses = 0;
  if (expenseTableExists) {
    const clauses = [];
    const params = [];
    addScopedWhere({ clauses, params, alias: "e", columns: expenseColumns, tenantId, fromDate, toDate, branchId, dateColumns: ["created_at", "expense_date", "date"] });
    if (expenseColumns.has("status")) {
      clauses.push(`LOWER(COALESCE(e.status, '')) NOT IN ('cancelled', 'canceled', 'rejected', 'void', 'deleted')`);
    }
    const amountExpr = coalesceColumnExpr("e", expenseColumns, ["amount", "total", "total_amount"], "0");
    const expenseResult = await dbClient.query(
      `
      SELECT COALESCE(SUM(${amountExpr}), 0)::numeric AS expenses
      FROM expenses e
      ${whereSql(clauses)}
      `,
      params
    );
    expenses = roundMoney(expenseResult.rows[0]?.expenses || 0);
  }

  let inventoryValuation = 0;
  if (variantTableExists) {
    const clauses = [];
    const params = [];
    addScopedWhere({ clauses, params, alias: "pv", columns: variantColumns, tenantId, branchId });
    if (variantColumns.has("deleted_at")) clauses.push(`pv.deleted_at IS NULL`);
    if (variantColumns.has("is_active")) clauses.push(`COALESCE(pv.is_active, TRUE) = TRUE`);
    const variantStockExpr = coalesceColumnExpr("pv", variantColumns, ["stock", "quantity", "qty", "available_qty"], "0");
    const variantCostExpr = coalesceColumnExpr("pv", variantColumns, ["last_purchase_cost", "purchase_cost", "cost_price", "unit_cost"], productColumns.has("cost_price") ? "p.cost_price" : "0");
    const productJoin = productTableExists ? "LEFT JOIN products p ON p.id = pv.product_id" : "";
    const variantValueResult = await dbClient.query(
      `
      SELECT COALESCE(SUM(GREATEST(${variantStockExpr}, 0) * GREATEST(${variantCostExpr}, 0)), 0)::numeric AS value
      FROM product_variants pv
      ${productJoin}
      ${whereSql(clauses)}
      `,
      params
    );
    inventoryValuation += roundMoney(variantValueResult.rows[0]?.value || 0);
  }
  if (productTableExists) {
    const clauses = [];
    const params = [];
    addScopedWhere({ clauses, params, alias: "p", columns: productColumns, tenantId, branchId });
    if (productColumns.has("status")) clauses.push(`LOWER(COALESCE(p.status, '')) NOT IN ('deleted', 'archived', 'disabled', 'inactive')`);
    if (variantTableExists) clauses.push(`NOT EXISTS (SELECT 1 FROM product_variants pv WHERE pv.product_id = p.id)`);
    const productStockExpr = coalesceColumnExpr("p", productColumns, ["stock", "quantity", "qty", "available_qty"], "0");
    const productCostExpr = coalesceColumnExpr("p", productColumns, ["last_purchase_cost", "purchase_cost", "cost_price", "unit_cost"], "0");
    const productValueResult = await dbClient.query(
      `
      SELECT COALESCE(SUM(GREATEST(${productStockExpr}, 0) * GREATEST(${productCostExpr}, 0)), 0)::numeric AS value
      FROM products p
      ${whereSql(clauses)}
      `,
      params
    );
    inventoryValuation += roundMoney(productValueResult.rows[0]?.value || 0);
  }
  inventoryValuation = roundMoney(inventoryValuation);

  return {
    revenue_report: {
      total_revenue: revenue,
      orders_count: ordersCount,
      from_date: fromDate,
      to_date: toDate,
      branch_id: branchId,
    },
    expense_report: {
      total_expenses: expenses,
      from_date: fromDate,
      to_date: toDate,
      branch_id: branchId,
    },
    profit: roundMoney(revenue - expenses),
    inventory_valuation: inventoryValuation,
    top_customers: topCustomers,
    top_products: topProducts,
  };
};

export const getMissingCostItems = async (clientOrPool, data = {}) => {
  await ensureAccountingSchema();
  const dbClient = queryable(clientOrPool);
  const tenantId = getTenantScope(data.tenantId ?? data.tenant_id);
  if (tenantId === null) throw new Error("tenantId is required");

  const [
    orderColumns,
    itemColumns,
    productColumns,
    variantColumns,
    purchaseColumns,
    purchaseItemColumns,
    overrideColumns,
  ] = await Promise.all([
    getTableColumns(dbClient, "orders"),
    getTableColumns(dbClient, "order_items"),
    getTableColumns(dbClient, "products"),
    getTableColumns(dbClient, "product_variants"),
    getTableColumns(dbClient, "purchases"),
    getTableColumns(dbClient, "purchase_items"),
    getTableColumns(dbClient, "accounting_order_item_cost_overrides"),
  ]);

  if (!orderColumns.size || !itemColumns.size || !productColumns.size) {
    return { rows: [] };
  }

  const variantTableExists = variantColumns.size > 0;
  const quantityExpr = coalesceColumnExpr("oi", itemColumns, ["quantity", "qty"], "0");
  const returnedExpr = columnExpr("oi", itemColumns, ["returned_quantity"], "0");
  const netQuantityExpr = `GREATEST((${quantityExpr}) - (${returnedExpr}), 0)`;
  const productIdExpr = itemColumns.has("product_id")
    ? `COALESCE(oi.product_id, ${variantTableExists && itemColumns.has("variant_id") ? "pv.product_id" : "NULL::bigint"})`
    : variantTableExists && itemColumns.has("variant_id")
      ? "pv.product_id"
      : "NULL::bigint";
  const variantIdExpr = itemColumns.has("variant_id") ? "oi.variant_id" : "NULL::bigint";
  const productNameExpr = `COALESCE(NULLIF(${columnExpr("p", productColumns, ["name", "title"], "''")}, ''), NULLIF(${columnExpr("oi", itemColumns, ["product_name", "name"], "''")}, ''), 'Unknown Product')`;
  const variantLabelExpr = variantTableExists
    ? `NULLIF(TRIM(CONCAT_WS(' / ', NULLIF(${columnExpr("pv", variantColumns, ["color"], "''")}, ''), NULLIF(${columnExpr("pv", variantColumns, ["size"], "''")}, ''), NULLIF(${columnExpr("oi", itemColumns, ["variant_name"], "''")}, ''))), '')`
    : `NULLIF(${columnExpr("oi", itemColumns, ["variant_name"], "''")}, '')`;
  const skuExpr = `COALESCE(NULLIF(${variantTableExists ? columnExpr("pv", variantColumns, ["sku", "barcode"], "''") : "''"}, ''), NULLIF(${columnExpr("oi", itemColumns, ["sku", "barcode"], "''")}, ''), NULLIF(${columnExpr("p", productColumns, ["sku", "barcode"], "''")}, ''))`;
  const currentCostExpr = positiveCoalesceColumnExpr("pv", variantColumns, ["cost_price", "purchase_price", "last_purchase_cost", "purchase_cost", "unit_cost"], positiveCoalesceColumnExpr("p", productColumns, ["cost_price", "purchase_price", "last_purchase_cost", "purchase_cost", "unit_cost"], "0"));
  const effectiveCostExpr = positiveCoalesceColumnExpr("aoc", overrideColumns, ["unit_cost"], currentCostExpr);
  const variantJoin = variantTableExists && itemColumns.has("variant_id") ? "LEFT JOIN product_variants pv ON pv.id = oi.variant_id AND pv.tenant_id = $1" : "";
  const productJoin = `LEFT JOIN products p ON p.id = ${productIdExpr} AND p.tenant_id = $1`;
  const overrideJoin = overrideColumns.size ? "LEFT JOIN accounting_order_item_cost_overrides aoc ON aoc.order_item_id = oi.id AND aoc.tenant_id = $1" : "";
  const itemTenantClause = itemColumns.has("tenant_id") ? "AND oi.tenant_id = $1" : "";

  const purchaseCostExpr = positiveCoalesceColumnExpr("pi", purchaseItemColumns, ["unit_cost", "cost_price", "purchase_price", "purchase_cost", "price"], "0");
  const purchaseProductIdExpr = purchaseItemColumns.has("product_id")
    ? `COALESCE(pi.product_id, ${variantTableExists && purchaseItemColumns.has("variant_id") ? "ppv.product_id" : "NULL::bigint"})`
    : variantTableExists && purchaseItemColumns.has("variant_id")
      ? "ppv.product_id"
      : "NULL::bigint";
  const purchaseVariantIdExpr = purchaseItemColumns.has("variant_id") ? "pi.variant_id" : "NULL::bigint";
  const purchaseDateExpr = columnExpr("pu", purchaseColumns, ["created_at", "purchase_date", "date"], "CURRENT_TIMESTAMP");
  const purchaseVariantJoin = variantTableExists && purchaseItemColumns.has("variant_id") ? "LEFT JOIN product_variants ppv ON ppv.id = pi.variant_id AND ppv.tenant_id = $1" : "";
  const purchaseTenantClause = purchaseItemColumns.has("tenant_id") ? "AND pi.tenant_id = $1" : "";
  const purchaseStatusClause = purchaseColumns.has("status") ? "AND LOWER(COALESCE(pu.status, '')) NOT IN ('cancelled', 'canceled', 'void', 'deleted', 'draft')" : "";

  const hasPurchaseStats = purchaseColumns.size && purchaseItemColumns.size;
  const purchaseCtes = hasPurchaseStats
    ? `,
    purchase_costs AS (
      SELECT
        ${purchaseProductIdExpr} AS product_id,
        ${purchaseVariantIdExpr} AS variant_id,
        GREATEST(${purchaseCostExpr}, 0)::numeric AS unit_cost,
        ${purchaseDateExpr} AS purchased_at,
        pi.id AS purchase_item_id
      FROM purchase_items pi
      JOIN purchases pu ON pu.id = pi.purchase_id AND pu.tenant_id = $1
      ${purchaseVariantJoin}
      WHERE ${purchaseProductIdExpr} IS NOT NULL
        ${purchaseTenantClause}
        ${purchaseStatusClause}
        AND GREATEST(${purchaseCostExpr}, 0) > 0
    ),
    purchase_stats AS (
      SELECT
        product_id,
        variant_id,
        AVG(unit_cost)::numeric AS average_purchase_cost
      FROM purchase_costs
      GROUP BY product_id, variant_id
    ),
    latest_purchase AS (
      SELECT DISTINCT ON (product_id, variant_id)
        product_id,
        variant_id,
        unit_cost AS last_purchase_cost
      FROM purchase_costs
      ORDER BY product_id, variant_id, purchased_at DESC, purchase_item_id DESC
    )`
    : "";
  const purchaseSelects = hasPurchaseStats
    ? `
      COALESCE(lp.last_purchase_cost, 0)::numeric AS last_purchase_cost,
      COALESCE(ps.average_purchase_cost, 0)::numeric AS average_purchase_cost,
      COALESCE(NULLIF(lp.last_purchase_cost, 0), NULLIF(ps.average_purchase_cost, 0), 0)::numeric AS suggested_cost`
    : `
      0::numeric AS last_purchase_cost,
      0::numeric AS average_purchase_cost,
      0::numeric AS suggested_cost`;
  const purchaseJoins = hasPurchaseStats
    ? `
    LEFT JOIN latest_purchase lp
      ON lp.product_id = missing.product_id
     AND ((lp.variant_id = missing.variant_id) OR (lp.variant_id IS NULL AND missing.variant_id IS NULL))
    LEFT JOIN purchase_stats ps
      ON ps.product_id = missing.product_id
     AND ((ps.variant_id = missing.variant_id) OR (ps.variant_id IS NULL AND missing.variant_id IS NULL))`
    : "";

  const result = await dbClient.query(
    `
    WITH missing AS (
      SELECT
        ${productIdExpr} AS product_id,
        ${variantIdExpr} AS variant_id,
        ${productNameExpr} AS product_name,
        ${variantLabelExpr} AS variant_label,
        ${skuExpr} AS sku,
        oi.id AS order_item_id,
        o.id AS order_id,
        ${columnExpr("o", orderColumns, ["invoice_number", "order_number", "reference"], "('ORD-' || o.id)")} AS order_reference,
        CASE WHEN ${productIdExpr} IS NULL THEN oi.id ELSE NULL END AS unresolved_order_item_id,
        COALESCE(SUM(${netQuantityExpr}), 0)::numeric AS sold_quantity,
        COUNT(*)::int AS affected_order_lines,
        GREATEST(${currentCostExpr}, 0)::numeric AS current_cost,
        GREATEST(${effectiveCostExpr}, 0)::numeric AS effective_cost,
        COALESCE(aoc.unit_cost, 0)::numeric AS current_override_cost
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id AND o.tenant_id = $1
      ${variantJoin}
      ${productJoin}
      ${overrideJoin}
      WHERE ${paidOrderClauses(orderColumns).join(" AND ")}
        ${itemTenantClause}
        AND ${netQuantityExpr} > 0
      GROUP BY ${productIdExpr}, ${variantIdExpr}, ${productNameExpr}, ${variantLabelExpr}, ${skuExpr}, oi.id, o.id, ${columnExpr("o", orderColumns, ["invoice_number", "order_number", "reference"], "('ORD-' || o.id)")}, CASE WHEN ${productIdExpr} IS NULL THEN oi.id ELSE NULL END, ${currentCostExpr}, ${effectiveCostExpr}, aoc.unit_cost
      HAVING GREATEST(${effectiveCostExpr}, 0) = 0
    )
    ${purchaseCtes}
    SELECT
      missing.product_id,
      missing.variant_id,
      missing.order_item_id,
      missing.order_id,
      missing.order_reference,
      missing.unresolved_order_item_id,
      missing.product_name,
      missing.variant_label,
      missing.sku,
      missing.sold_quantity,
      missing.affected_order_lines,
      missing.current_cost,
      missing.current_override_cost,
      ${purchaseSelects}
    FROM missing
    ${purchaseJoins}
    ORDER BY missing.affected_order_lines DESC, missing.sold_quantity DESC, missing.product_name ASC, missing.variant_label ASC NULLS LAST
    `,
    [tenantId]
  );

  return {
    rows: result.rows.map((row) => ({
      product_id: row.product_id === null || row.product_id === undefined ? null : Number(row.product_id),
      variant_id: row.variant_id === null || row.variant_id === undefined ? null : Number(row.variant_id),
      order_item_id: row.order_item_id === null || row.order_item_id === undefined ? null : Number(row.order_item_id),
      order_id: row.order_id === null || row.order_id === undefined ? null : Number(row.order_id),
      order_reference: row.order_reference || "",
      unresolved_order_item_id: row.unresolved_order_item_id === null || row.unresolved_order_item_id === undefined ? null : Number(row.unresolved_order_item_id),
      product_name: row.product_name || "Unknown Product",
      product_name_snapshot: row.product_name || "Unknown Product",
      item_name: [row.product_name, row.variant_label].filter(Boolean).join(" / ") || "Unknown Product",
      variant_label: row.variant_label || "",
      sku: row.sku || "",
      sku_snapshot: row.sku || "",
      sold_quantity: Number(row.sold_quantity || 0),
      affected_order_lines: Number(row.affected_order_lines || 0),
      current_cost: roundMoney(row.current_cost || 0),
      current_override_cost: roundMoney(row.current_override_cost || 0),
      suggested_cost: roundMoney(row.suggested_cost || 0),
      last_purchase_cost: roundMoney(row.last_purchase_cost || 0),
      average_purchase_cost: roundMoney(row.average_purchase_cost || 0),
      resolution_type: row.product_id || row.variant_id ? "catalog_cost" : "order_line_override",
    })),
  };
};

export const updateMissingItemCosts = async (clientOrPool, data = {}) => {
  await ensureAccountingSchema();
  const dbClient = queryable(clientOrPool);
  const tenantId = getTenantScope(data.tenantId ?? data.tenant_id);
  if (tenantId === null) throw new Error("tenantId is required");

  const updates = Array.isArray(data.updates) ? data.updates : [];
  if (!updates.length) {
    return { success: true, updated: 0, rows: [] };
  }

  const productColumns = await getTableColumns(dbClient, "products");
  const variantColumns = await getTableColumns(dbClient, "product_variants");
  if (!productColumns.size) throw new Error("products table is missing");

  const rows = [];
  for (const update of updates) {
    const productId = numericFilter(update.product_id ?? update.productId);
    const variantId = numericFilter(update.variant_id ?? update.variantId);
    const cost = roundMoney(update.cost);

    if (!productId && !variantId) {
      throw new Error("Each update requires product_id or variant_id");
    }
    if (!Number.isFinite(cost) || cost <= 0) {
      throw new Error("Cost must be greater than zero");
    }

    if (variantId) {
      if (!variantColumns.size) throw new Error("product_variants table is missing");
      const beforeResult = await dbClient.query(
        `
        SELECT p.id AS product_id, pv.id AS variant_id, pv.cost_price
        FROM product_variants pv
        JOIN products p ON p.id = pv.product_id
        WHERE pv.id = $1
          AND pv.tenant_id = $2
          AND p.tenant_id = $2
          AND ($3::bigint IS NULL OR p.id = $3::bigint)
        LIMIT 1
        `,
        [variantId, tenantId, productId]
      );
      const variantSetSql = variantColumns.has("updated_at")
        ? "cost_price = $1, updated_at = NOW()"
        : "cost_price = $1";
      const result = await dbClient.query(
        `
        UPDATE product_variants pv
        SET ${variantSetSql}
        FROM products p
        WHERE pv.id = $2
          AND pv.tenant_id = $3
          AND p.id = pv.product_id
          AND p.tenant_id = $3
          AND ($4::bigint IS NULL OR p.id = $4::bigint)
        RETURNING p.id AS product_id, pv.id AS variant_id, pv.cost_price
        `,
        [cost, variantId, tenantId, productId]
      );
      if (!result.rowCount) {
        throw new Error(`Variant not found for tenant: ${variantId}`);
      }
      rows.push({
        product_id: Number(result.rows[0].product_id),
        variant_id: Number(result.rows[0].variant_id),
        cost: roundMoney(result.rows[0].cost_price),
      });
      await logAccountingAudit(dbClient, {
        tenantId,
        userId: data.createdBy ?? data.created_by ?? null,
        action: "catalog_cost_updated",
        entityType: "product_variant",
        entityId: variantId,
        beforeData: beforeResult.rows[0] || null,
        afterData: result.rows[0],
        metadata: { source: "cost_fix_center" },
      });
      continue;
    }

    const beforeResult = await dbClient.query(
      `
      SELECT id AS product_id, NULL::bigint AS variant_id, cost_price
      FROM products
      WHERE id = $1
        AND tenant_id = $2
      LIMIT 1
      `,
      [productId, tenantId]
    );
    const productSetSql = productColumns.has("updated_at")
      ? "cost_price = $1, updated_at = NOW()"
      : "cost_price = $1";
    const result = await dbClient.query(
      `
      UPDATE products
      SET ${productSetSql}
      WHERE id = $2
        AND tenant_id = $3
      RETURNING id AS product_id, NULL::bigint AS variant_id, cost_price
      `,
      [cost, productId, tenantId]
    );
    if (!result.rowCount) {
      throw new Error(`Product not found for tenant: ${productId}`);
    }
    rows.push({
      product_id: Number(result.rows[0].product_id),
      variant_id: null,
      cost: roundMoney(result.rows[0].cost_price),
    });
    await logAccountingAudit(dbClient, {
      tenantId,
      userId: data.createdBy ?? data.created_by ?? null,
      action: "catalog_cost_updated",
      entityType: "product",
      entityId: productId,
      beforeData: beforeResult.rows[0] || null,
      afterData: result.rows[0],
      metadata: { source: "cost_fix_center" },
    });
  }

  return {
    success: true,
    updated: rows.length,
    rows,
  };
};

export const updateOrderLineCostOverrides = async (clientOrPool, data = {}) => {
  await ensureAccountingSchema();
  const dbClient = queryable(clientOrPool);
  const tenantId = getTenantScope(data.tenantId ?? data.tenant_id);
  if (tenantId === null) throw new Error("tenantId is required");

  const updates = Array.isArray(data.updates) ? data.updates : [];
  if (!updates.length) {
    return { success: true, updated: 0, rows: [] };
  }

  const createdBy = data.createdBy ?? data.created_by ?? null;
  const rows = [];

  for (const update of updates) {
    const orderItemId = numericFilter(update.order_item_id ?? update.orderItemId);
    const unitCost = roundMoney(update.unit_cost ?? update.unitCost ?? update.cost);
    const reason = String(update.reason || "Historical missing catalog link").trim().slice(0, 500);

    if (!orderItemId) {
      throw new Error("Each update requires order_item_id");
    }
    if (!Number.isFinite(unitCost) || unitCost <= 0) {
      throw new Error("Unit cost must be greater than zero");
    }

    const orderItemResult = await dbClient.query(
      `
      SELECT
        oi.id,
        COALESCE(oi.product_id, pv.product_id) AS product_id,
        oi.variant_id
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id AND o.tenant_id = $1
      LEFT JOIN product_variants pv ON pv.id = oi.variant_id AND pv.tenant_id = $1
      WHERE oi.id = $2
        AND (oi.tenant_id IS NULL OR oi.tenant_id = $1)
      LIMIT 1
      `,
      [tenantId, orderItemId]
    );

    if (!orderItemResult.rowCount) {
      throw new Error(`Order item not found for tenant: ${orderItemId}`);
    }

    const orderItem = orderItemResult.rows[0];
    const beforeResult = await dbClient.query(
      `
      SELECT id, tenant_id, order_item_id, product_id, variant_id, unit_cost, reason
      FROM accounting_order_item_cost_overrides
      WHERE tenant_id = $1
        AND order_item_id = $2
      LIMIT 1
      `,
      [tenantId, orderItemId]
    );
    const existingOverride = beforeResult.rows[0] || null;
    const result = await dbClient.query(
      `
      INSERT INTO accounting_order_item_cost_overrides (
        tenant_id,
        order_item_id,
        product_id,
        variant_id,
        unit_cost,
        reason,
        created_by,
        created_at,
        updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),NOW())
      ON CONFLICT (tenant_id, order_item_id)
      DO UPDATE SET
        product_id = EXCLUDED.product_id,
        variant_id = EXCLUDED.variant_id,
        unit_cost = EXCLUDED.unit_cost,
        reason = EXCLUDED.reason,
        updated_at = NOW()
      RETURNING id, tenant_id, order_item_id, product_id, variant_id, unit_cost, reason
      `,
      [
        tenantId,
        orderItemId,
        orderItem.product_id || null,
        orderItem.variant_id || null,
        unitCost,
        reason || "Historical missing catalog link",
        createdBy,
      ]
    );

    rows.push({
      id: Number(result.rows[0].id),
      order_item_id: Number(result.rows[0].order_item_id),
      product_id: result.rows[0].product_id === null || result.rows[0].product_id === undefined ? null : Number(result.rows[0].product_id),
      variant_id: result.rows[0].variant_id === null || result.rows[0].variant_id === undefined ? null : Number(result.rows[0].variant_id),
      unit_cost: roundMoney(result.rows[0].unit_cost),
      reason: result.rows[0].reason || "",
    });
    await logAccountingAudit(dbClient, {
      tenantId,
      userId: createdBy,
      action: existingOverride ? "order_line_cost_override_updated" : "order_line_cost_override_created",
      entityType: "order_item",
      entityId: orderItemId,
      beforeData: existingOverride,
      afterData: result.rows[0],
      metadata: { source: "cost_fix_center" },
    });
  }

  return {
    success: true,
    updated: rows.length,
    rows,
  };
};

export const getProfitLossReport = async (clientOrPool, data = {}) => {
  await ensureAccountingSchema();
  const dbClient = queryable(clientOrPool);
  const tenantId = getTenantScope(data.tenantId ?? data.tenant_id);
  const fromDate = parseDateFilter(data.fromDate || data.from_date || data.from);
  const toDate = parseDateFilter(data.toDate || data.to_date || data.to);
  const branchId = numericFilter(data.branchId || data.branch_id);

  const [orderColumns, itemColumns, expenseColumns, productColumns, variantColumns, returnColumns, returnItemColumns, purchaseColumns, purchaseItemColumns, overrideColumns] = await Promise.all([
    getTableColumns(dbClient, "orders"),
    getTableColumns(dbClient, "order_items"),
    getTableColumns(dbClient, "expenses"),
    getTableColumns(dbClient, "products"),
    getTableColumns(dbClient, "product_variants"),
    getTableColumns(dbClient, "returns"),
    getTableColumns(dbClient, "return_items"),
    getTableColumns(dbClient, "purchases"),
    getTableColumns(dbClient, "purchase_items"),
    getTableColumns(dbClient, "accounting_order_item_cost_overrides"),
  ]);

  const orderTableExists = orderColumns.size > 0;
  const itemTableExists = itemColumns.size > 0;
  const productTableExists = productColumns.size > 0;
  const variantTableExists = variantColumns.size > 0;

  let grossSales = 0;
  let discounts = 0;
  let returnedOrderAmount = 0;
  let returnedItemAmount = 0;
  let totalCogs = 0;

  if (orderTableExists) {
    const clauses = [];
    const params = [];
    addScopedWhere({ clauses, params, alias: "o", columns: orderColumns, tenantId, fromDate, toDate, branchId });
    clauses.push(...paidOrderClauses(orderColumns));

    const totalExpr = coalesceColumnExpr("o", orderColumns, ["total_amount", "total", "total_price", "grand_total", "net_total"], "0");
    const discountColumns = ["discount_amount", "coupon_discount_amount", "total_discount", "discount"].filter((column) => orderColumns.has(column));
    const discountExpr = discountColumns.length
      ? discountColumns.map((column) => `COALESCE(o.${column}, 0)`).join(" + ")
      : "0";
    const grossCandidates = ["subtotal", "gross_total", "items_subtotal", "sub_total"]
      .filter((column) => orderColumns.has(column))
      .map((column) => `NULLIF(o.${column}, 0)`);
    const grossExpr = `COALESCE(${[...grossCandidates, `(${totalExpr}) + (${discountExpr})`].join(", ")})`;

    const revenueResult = await dbClient.query(
      `
      SELECT
        COALESCE(SUM(${grossExpr}), 0)::numeric AS gross_sales,
        COALESCE(SUM(${discountExpr}), 0)::numeric AS discounts
      FROM orders o
      ${whereSql(clauses)}
      `,
      params
    );
    grossSales = roundMoney(revenueResult.rows[0]?.gross_sales || 0);
    discounts = roundMoney(revenueResult.rows[0]?.discounts || 0);

    const returnClauses = [];
    const returnParams = [];
    addScopedWhere({ clauses: returnClauses, params: returnParams, alias: "o", columns: orderColumns, tenantId, fromDate, toDate, branchId });
    const returnStatusChecks = [];
    if (orderColumns.has("status")) returnStatusChecks.push(`LOWER(COALESCE(o.status, '')) IN ('returned', 'refunded')`);
    if (orderColumns.has("payment_status")) returnStatusChecks.push(`LOWER(COALESCE(o.payment_status, '')) IN ('returned', 'refunded')`);
    if (returnStatusChecks.length) {
      returnClauses.push(`(${returnStatusChecks.join(" OR ")})`);
      const returnedOrdersResult = await dbClient.query(
        `
        SELECT COALESCE(SUM(${totalExpr}), 0)::numeric AS returns
        FROM orders o
        ${whereSql(returnClauses)}
        `,
        returnParams
      );
      returnedOrderAmount = roundMoney(returnedOrdersResult.rows[0]?.returns || 0);
    }
  }

  if (orderTableExists && itemTableExists) {
    const clauses = [];
    const params = [];
    addScopedWhere({ clauses, params, alias: "o", columns: orderColumns, tenantId, fromDate, toDate, branchId });
    clauses.push(...paidOrderClauses(orderColumns));
    if (tenantId !== null && itemColumns.has("tenant_id")) {
      params.push(tenantId);
      clauses.push(`oi.tenant_id = $${params.length}`);
    }

    const quantityExpr = coalesceColumnExpr("oi", itemColumns, ["quantity", "qty"], "0");
    const returnedExpr = columnExpr("oi", itemColumns, ["returned_quantity"], "0");
    const netQuantityExpr = `GREATEST((${quantityExpr}) - (${returnedExpr}), 0)`;
    const productIdExpr = itemColumns.has("product_id")
      ? `COALESCE(oi.product_id, ${variantTableExists && itemColumns.has("variant_id") ? "pv.product_id" : "NULL::bigint"})`
      : variantTableExists && itemColumns.has("variant_id")
        ? "pv.product_id"
        : "NULL::bigint";
    const variantIdExpr = itemColumns.has("variant_id") ? "oi.variant_id" : "NULL::bigint";
    const purchaseLookup = purchaseCostLookup({
      purchaseColumns,
      purchaseItemColumns,
      variantColumns,
      productIdExpr,
      variantIdExpr,
      tenantParam: tenantId !== null ? "$1" : "o.tenant_id",
    });
    const itemCostExpr = positiveCoalesceColumnExpr(
      "aoc",
      overrideColumns,
      ["unit_cost"],
      positiveCoalesceColumnExpr("pv", variantColumns, ["last_purchase_cost", "purchase_cost", "cost_price", "unit_cost"], positiveCoalesceColumnExpr("p", productColumns, ["last_purchase_cost", "purchase_cost", "cost_price", "unit_cost"], purchaseLookup.expr))
    );
    const variantJoin = variantTableExists && itemColumns.has("variant_id") ? "LEFT JOIN product_variants pv ON pv.id = oi.variant_id" : "";
    const productJoin = productTableExists
      ? `LEFT JOIN products p ON p.id = ${productIdExpr}`
      : "";
    const overrideJoin = overrideColumns.size ? "LEFT JOIN accounting_order_item_cost_overrides aoc ON aoc.order_item_id = oi.id AND aoc.tenant_id = o.tenant_id" : "";

    const cogsResult = await dbClient.query(
      `
      SELECT COALESCE(SUM(${netQuantityExpr} * GREATEST(${itemCostExpr}, 0)), 0)::numeric AS total_cogs
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      ${variantJoin}
      ${productJoin}
      ${overrideJoin}
      ${purchaseLookup.join}
      ${whereSql(clauses)}
      `,
      params
    );
    totalCogs = roundMoney(cogsResult.rows[0]?.total_cogs || 0);

    if (returnColumns.size && returnItemColumns.size) {
      const returnClauses = [];
      const returnParams = [];
      addScopedWhere({
        clauses: returnClauses,
        params: returnParams,
        alias: "r",
        columns: returnColumns,
        tenantId,
        fromDate,
        toDate,
        branchId: null,
      });
      if (branchId && orderColumns.has("branch_id")) {
        returnParams.push(branchId);
        returnClauses.push(`o.branch_id = $${returnParams.length}`);
      }
      if (returnColumns.has("status")) {
        returnClauses.push(`LOWER(COALESCE(r.status, '')) NOT IN ('cancelled', 'canceled', 'rejected', 'void', 'deleted')`);
      }
      const refundExpr = coalesceColumnExpr("ri", returnItemColumns, ["refund_amount", "total", "total_amount"], "0");
      const returnItemsResult = await dbClient.query(
        `
        SELECT COALESCE(SUM(${refundExpr}), 0)::numeric AS returns
        FROM return_items ri
        JOIN returns r ON r.id = ri.return_id
        JOIN orders o ON o.id = r.order_id
        ${whereSql(returnClauses)}
        `,
        returnParams
      );
      returnedItemAmount = roundMoney(returnItemsResult.rows[0]?.returns || 0);
    }
  }

  let expenses = [];
  let totalExpenses = 0;
  if (expenseColumns.size) {
    const clauses = [];
    const params = [];
    addScopedWhere({
      clauses,
      params,
      alias: "e",
      columns: expenseColumns,
      tenantId,
      fromDate,
      toDate,
      branchId,
      dateColumns: ["created_at", "expense_date", "date"],
    });
    if (expenseColumns.has("status")) {
      clauses.push(`LOWER(COALESCE(e.status, '')) NOT IN ('cancelled', 'canceled', 'rejected', 'void', 'deleted')`);
    }
    const amountExpr = coalesceColumnExpr("e", expenseColumns, ["amount", "total", "total_amount"], "0");
    const categoryExpr = coalesceColumnExpr("e", expenseColumns, ["category", "category_name", "expense_type", "type"], "''");
    const expenseRows = await dbClient.query(
      `
      SELECT
        COALESCE(NULLIF(${categoryExpr}, ''), 'Uncategorized') AS category,
        COALESCE(SUM(${amountExpr}), 0)::numeric AS amount
      FROM expenses e
      ${whereSql(clauses)}
      GROUP BY COALESCE(NULLIF(${categoryExpr}, ''), 'Uncategorized')
      ORDER BY amount DESC, category ASC
      `,
      params
    );
    expenses = expenseRows.rows.map((row) => ({
      category: row.category || "Uncategorized",
      amount: roundMoney(row.amount || 0),
    }));
    totalExpenses = roundMoney(expenses.reduce((sum, row) => sum + row.amount, 0));
  }

  const returns = roundMoney(returnedItemAmount || returnedOrderAmount);
  const netSales = roundMoney(grossSales - discounts - returns);
  const grossProfit = roundMoney(netSales - totalCogs);

  return {
    revenue: {
      gross_sales: grossSales,
      discounts,
      returns,
      net_sales: netSales,
    },
    cogs: {
      total_cogs: totalCogs,
    },
    gross_profit: grossProfit,
    expenses,
    total_expenses: totalExpenses,
    net_profit: roundMoney(grossProfit - totalExpenses),
  };
};

const finalizeLedgerRows = (rows = []) => {
  rows.sort((a, b) => {
    const byDate = new Date(a.date).getTime() - new Date(b.date).getTime();
    if (byDate) return byDate;
    return String(a.reference).localeCompare(String(b.reference));
  });

  let runningBalance = 0;
  const outputRows = rows.slice(0, 1000).map((row) => {
    runningBalance = roundMoney(runningBalance + row.debit - row.credit);
    return {
      ...row,
      balance: runningBalance,
    };
  });

  const totals = outputRows.reduce(
    (acc, row) => {
      acc.debit = roundMoney(acc.debit + row.debit);
      acc.credit = roundMoney(acc.credit + row.credit);
      return acc;
    },
    { debit: 0, credit: 0 }
  );

  return {
    rows: outputRows,
    totals: {
      debit: totals.debit,
      credit: totals.credit,
      ending_balance: outputRows.length ? outputRows[outputRows.length - 1].balance : 0,
    },
  };
};

export const getLedgersReport = async (clientOrPool, data = {}) => {
  const dbClient = queryable(clientOrPool);
  const tenantId = getTenantScope(data.tenantId ?? data.tenant_id);
  const fromDate = parseDateFilter(data.fromDate || data.from_date || data.from);
  const toDate = parseDateFilter(data.toDate || data.to_date || data.to);
  const branchId = numericFilter(data.branchId || data.branch_id);
  const accountType = textFilter(data.accountType || data.account_type);

  const [
    orderColumns,
    expenseColumns,
    purchaseColumns,
    returnColumns,
    inventoryMovementColumns,
    ledgerEntryColumns,
  ] = await Promise.all([
    getTableColumns(dbClient, "orders"),
    getTableColumns(dbClient, "expenses"),
    getTableColumns(dbClient, "purchases"),
    getTableColumns(dbClient, "returns"),
    getTableColumns(dbClient, "inventory_movements"),
    getTableColumns(dbClient, "ledger_entries"),
  ]);

  const rows = [];
  const pushRow = (row) => {
    if (accountType && row.account_type !== accountType) return;
    rows.push({
      date: row.date,
      reference: row.reference || "",
      source_type: row.source_type || "",
      account_name: row.account_name || "",
      description: row.description || "",
      debit: roundMoney(row.debit || 0),
      credit: roundMoney(row.credit || 0),
      account_type: row.account_type || "",
    });
  };

  if (await hasGeneratedJournalEntries(dbClient, { tenantId, fromDate, toDate, branchId })) {
    const clauses = [
      "je.tenant_id = $1",
      `(
        COALESCE(je.is_generated, FALSE) = TRUE
        OR COALESCE(je.reference_type, '') = ''
        OR COALESCE(je.reference_type, '') NOT IN (${[...GENERATED_REFERENCE_TYPES].map((_, index) => `$${index + 2}`).join(", ")})
      )`,
    ];
    const params = [tenantId, ...GENERATED_REFERENCE_TYPES];
    const push = (value) => {
      params.push(value);
      return `$${params.length}`;
    };
    if (fromDate) clauses.push(`je.entry_date >= ${push(fromDate)}`);
    if (toDate) clauses.push(`je.entry_date <= ${push(toDate)}`);
    if (branchId) clauses.push(`jel.branch_id = ${push(branchId)}`);

    const journalRows = await dbClient.query(
      `
      SELECT
        COALESCE(je.entry_date::timestamp, je.created_at, jel.created_at) AS date,
        COALESCE(NULLIF(je.entry_number, ''), COALESCE(je.reference_type, 'JE') || '-' || je.reference_id, 'JE-' || je.id) AS reference,
        COALESCE(NULLIF(je.entry_type, ''), NULLIF(je.reference_type, ''), 'journal_entry') AS source_type,
        a.name AS account_name,
        COALESCE(NULLIF(jel.notes, ''), NULLIF(je.description, ''), 'Journal entry') AS description,
        COALESCE(jel.debit, 0)::numeric AS debit,
        COALESCE(jel.credit, 0)::numeric AS credit,
        COALESCE(NULLIF(a.type, ''), 'ledger') AS account_type
      FROM journal_entry_lines jel
      JOIN journal_entries je ON je.id = jel.journal_entry_id
      JOIN accounts a ON a.id = jel.account_id
      WHERE ${clauses.join(" AND ")}
      ORDER BY COALESCE(je.entry_date::timestamp, je.created_at, jel.created_at) ASC, je.id ASC, jel.id ASC
      LIMIT 1000
      `,
      params
    );
    journalRows.rows.forEach(pushRow);
    return finalizeLedgerRows(rows);
  }

  if (orderColumns.size) {
    const clauses = [];
    const params = [];
    addScopedWhere({ clauses, params, alias: "o", columns: orderColumns, tenantId, fromDate, toDate, branchId });
    clauses.push(...paidOrderClauses(orderColumns));
    const totalExpr = coalesceColumnExpr("o", orderColumns, ["total_amount", "total", "total_price", "grand_total", "net_total"], "0");
    const paidExpr = coalesceColumnExpr("o", orderColumns, ["paid_amount", "amount_paid"], totalExpr);
    const referenceExpr = columnExpr("o", orderColumns, ["invoice_number", "order_number", "reference"], "('ORD-' || o.id)");
    const dateExpr = columnExpr("o", orderColumns, ["created_at", "paid_at", "completed_at"], "CURRENT_TIMESTAMP");
    const orderRows = await dbClient.query(
      `
      SELECT
        ${dateExpr} AS date,
        ${referenceExpr} AS reference,
        COALESCE(NULLIF(o.customer_name, ''), 'Paid order') AS description,
        COALESCE(${totalExpr}, 0)::numeric AS sales_amount,
        COALESCE(${paidExpr}, ${totalExpr}, 0)::numeric AS paid_amount
      FROM orders o
      ${whereSql(clauses)}
      ORDER BY ${dateExpr} ASC, o.id ASC
      LIMIT 500
      `,
      params
    );
    orderRows.rows.forEach((row) => {
      pushRow({
        date: row.date,
        reference: row.reference,
        source_type: "sale",
        account_name: "Sales Revenue",
        description: row.description,
        debit: 0,
        credit: row.sales_amount,
        account_type: "revenue",
      });
      pushRow({
        date: row.date,
        reference: row.reference,
        source_type: "payment_received",
        account_name: "Cash / Bank",
        description: `Payment received for ${row.description || "order"}`,
        debit: row.paid_amount,
        credit: 0,
        account_type: "asset",
      });
    });
  }

  if (expenseColumns.size) {
    const clauses = [];
    const params = [];
    addScopedWhere({
      clauses,
      params,
      alias: "e",
      columns: expenseColumns,
      tenantId,
      fromDate,
      toDate,
      branchId,
      dateColumns: ["created_at", "expense_date", "date"],
    });
    if (expenseColumns.has("status")) {
      clauses.push(`LOWER(COALESCE(e.status, '')) NOT IN ('cancelled', 'canceled', 'rejected', 'void', 'deleted')`);
    }
    const amountExpr = coalesceColumnExpr("e", expenseColumns, ["amount", "total", "total_amount"], "0");
    const categoryExpr = coalesceColumnExpr("e", expenseColumns, ["category", "category_name", "expense_type", "type"], "''");
    const titleExpr = coalesceColumnExpr("e", expenseColumns, ["title", "description", "note"], "''");
    const dateExpr = columnExpr("e", expenseColumns, ["created_at", "expense_date", "date"], "CURRENT_TIMESTAMP");
    const expenseRows = await dbClient.query(
      `
      SELECT
        ${dateExpr} AS date,
        ('EXP-' || e.id) AS reference,
        COALESCE(NULLIF(${categoryExpr}, ''), 'Expense') AS account_name,
        COALESCE(NULLIF(${titleExpr}, ''), 'Expense') AS description,
        COALESCE(${amountExpr}, 0)::numeric AS amount
      FROM expenses e
      ${whereSql(clauses)}
      ORDER BY ${dateExpr} ASC, e.id ASC
      LIMIT 500
      `,
      params
    );
    expenseRows.rows.forEach((row) => {
      pushRow({
        date: row.date,
        reference: row.reference,
        source_type: "expense",
        account_name: row.account_name,
        description: row.description,
        debit: row.amount,
        credit: 0,
        account_type: "expense",
      });
    });
  }

  if (purchaseColumns.size) {
    const clauses = [];
    const params = [];
    addScopedWhere({ clauses, params, alias: "p", columns: purchaseColumns, tenantId, fromDate, toDate, branchId });
    if (purchaseColumns.has("status")) {
      clauses.push(`LOWER(COALESCE(p.status, '')) NOT IN ('cancelled', 'canceled', 'void', 'deleted', 'draft')`);
    }
    const totalExpr = coalesceColumnExpr("p", purchaseColumns, ["total", "total_amount", "grand_total", "net_total"], "0");
    const referenceExpr = columnExpr("p", purchaseColumns, ["purchase_number", "reference"], "('PUR-' || p.id)");
    const dateExpr = columnExpr("p", purchaseColumns, ["created_at", "purchase_date", "date"], "CURRENT_TIMESTAMP");
    const purchaseRows = await dbClient.query(
      `
      SELECT
        ${dateExpr} AS date,
        ${referenceExpr} AS reference,
        COALESCE(${totalExpr}, 0)::numeric AS amount
      FROM purchases p
      ${whereSql(clauses)}
      ORDER BY ${dateExpr} ASC, p.id ASC
      LIMIT 500
      `,
      params
    );
    purchaseRows.rows.forEach((row) => {
      pushRow({
        date: row.date,
        reference: row.reference,
        source_type: "purchase",
        account_name: "Inventory / Purchases",
        description: "Inventory purchase",
        debit: row.amount,
        credit: 0,
        account_type: "asset",
      });
    });
  }

  if (returnColumns.size) {
    const clauses = [];
    const params = [];
    addScopedWhere({ clauses, params, alias: "r", columns: returnColumns, tenantId, fromDate, toDate, branchId: null });
    if (branchId && orderColumns.has("branch_id") && returnColumns.has("order_id")) {
      params.push(branchId);
      clauses.push(`o.branch_id = $${params.length}`);
    }
    if (returnColumns.has("status")) {
      clauses.push(`LOWER(COALESCE(r.status, '')) NOT IN ('cancelled', 'canceled', 'rejected', 'void', 'deleted')`);
    }
    const refundExpr = coalesceColumnExpr("r", returnColumns, ["refund_amount", "total", "total_amount"], "0");
    const referenceExpr = columnExpr("r", returnColumns, ["return_number", "reference"], "('RET-' || r.id)");
    const dateExpr = columnExpr("r", returnColumns, ["created_at", "return_date", "date"], "CURRENT_TIMESTAMP");
    const orderJoin = orderColumns.size && returnColumns.has("order_id") ? "LEFT JOIN orders o ON o.id = r.order_id" : "";
    const returnRows = await dbClient.query(
      `
      SELECT
        ${dateExpr} AS date,
        ${referenceExpr} AS reference,
        COALESCE(${refundExpr}, 0)::numeric AS amount
      FROM returns r
      ${orderJoin}
      ${whereSql(clauses)}
      ORDER BY ${dateExpr} ASC, r.id ASC
      LIMIT 500
      `,
      params
    );
    returnRows.rows.forEach((row) => {
      pushRow({
        date: row.date,
        reference: row.reference,
        source_type: "return",
        account_name: "Sales Returns",
        description: "Customer refund / return",
        debit: row.amount,
        credit: 0,
        account_type: "revenue",
      });
      pushRow({
        date: row.date,
        reference: row.reference,
        source_type: "refund",
        account_name: "Cash / Bank",
        description: "Cash refunded to customer",
        debit: 0,
        credit: row.amount,
        account_type: "asset",
      });
    });
  }

  if (inventoryMovementColumns.size) {
    const clauses = [];
    const params = [];
    addScopedWhere({ clauses, params, alias: "im", columns: inventoryMovementColumns, tenantId, fromDate, toDate, branchId });
    if (inventoryMovementColumns.has("undone_at")) clauses.push("im.undone_at IS NULL");
    const quantityExpr = columnExpr("im", inventoryMovementColumns, ["quantity_change", "quantity"], "0");
    const amountExpr = coalesceColumnExpr("im", inventoryMovementColumns, ["total_cost"], `ABS(${quantityExpr}) * ${columnExpr("im", inventoryMovementColumns, ["unit_cost"], "0")}`);
    const movementTypeExpr = columnExpr("im", inventoryMovementColumns, ["movement_type", "reference_type"], "''");
    const dateExpr = columnExpr("im", inventoryMovementColumns, ["created_at", "movement_date", "date"], "CURRENT_TIMESTAMP");
    const movementRows = await dbClient.query(
      `
      SELECT
        ${dateExpr} AS date,
        ('INV-' || im.id) AS reference,
        COALESCE(${movementTypeExpr}, 'inventory_adjustment') AS description,
        COALESCE(${quantityExpr}, 0)::numeric AS quantity_change,
        COALESCE(${amountExpr}, 0)::numeric AS amount
      FROM inventory_movements im
      ${whereSql(clauses)}
      ORDER BY ${dateExpr} ASC, im.id ASC
      LIMIT 500
      `,
      params
    );
    movementRows.rows.forEach((row) => {
      const amount = Math.abs(Number(row.amount || 0));
      const isIncrease = Number(row.quantity_change || 0) >= 0;
      pushRow({
        date: row.date,
        reference: row.reference,
        source_type: "inventory_adjustment",
        account_name: "Inventory Adjustments",
        description: row.description || "Inventory adjustment",
        debit: isIncrease ? amount : 0,
        credit: isIncrease ? 0 : amount,
        account_type: "asset",
      });
    });
  }

  if (ledgerEntryColumns.size) {
    const clauses = [];
    const params = [];
    addScopedWhere({ clauses, params, alias: "le", columns: ledgerEntryColumns, tenantId, fromDate, toDate, branchId });
    const dateExpr = columnExpr("le", ledgerEntryColumns, ["created_at", "date"], "CURRENT_TIMESTAMP");
    const noteExpr = coalesceColumnExpr("le", ledgerEntryColumns, ["note", "description"], "''");
    const ledgerRows = await dbClient.query(
      `
      SELECT
        ${dateExpr} AS date,
        COALESCE(le.reference_type || '-' || le.reference_id, 'LED-' || le.id) AS reference,
        COALESCE(le.entry_type, 'ledger_entry') AS source_type,
        COALESCE(NULLIF(le.party_type, ''), 'Ledger Entry') AS account_name,
        COALESCE(NULLIF(${noteExpr}, ''), 'Ledger entry') AS description,
        COALESCE(le.debit, 0)::numeric AS debit,
        COALESCE(le.credit, 0)::numeric AS credit
      FROM ledger_entries le
      ${whereSql(clauses)}
      ORDER BY ${dateExpr} ASC, le.id ASC
      LIMIT 500
      `,
      params
    );
    ledgerRows.rows.forEach((row) => {
      pushRow({
        ...row,
        account_type: "ledger",
      });
    });
  }

  rows.sort((a, b) => {
    const byDate = new Date(a.date).getTime() - new Date(b.date).getTime();
    if (byDate) return byDate;
    return String(a.reference).localeCompare(String(b.reference));
  });

  let runningBalance = 0;
  const outputRows = rows.slice(0, 1000).map((row) => {
    runningBalance = roundMoney(runningBalance + row.debit - row.credit);
    return {
      ...row,
      balance: runningBalance,
    };
  });

  const totals = outputRows.reduce(
    (acc, row) => {
      acc.debit = roundMoney(acc.debit + row.debit);
      acc.credit = roundMoney(acc.credit + row.credit);
      return acc;
    },
    { debit: 0, credit: 0 }
  );

  return {
    rows: outputRows,
    totals: {
      debit: totals.debit,
      credit: totals.credit,
      ending_balance: outputRows.length ? outputRows[outputRows.length - 1].balance : 0,
    },
  };
};

export const getTrialBalanceReport = async (clientOrPool, data = {}) => {
  const accountTypes = ["asset", "liability", "equity", "revenue", "expense", "ledger"];
  const ledgers = await Promise.all(
    accountTypes.map(async (accountType) => ({
      accountType,
      report: await getLedgersReport(clientOrPool, { ...data, accountType }),
    }))
  );

  const grouped = new Map();
  ledgers.forEach(({ accountType, report }) => {
    (report.rows || []).forEach((row) => {
      const key = `${accountType}:${row.account_name || "Ledger Account"}`;
      const current = grouped.get(key) || {
        account_name: row.account_name || "Ledger Account",
        account_type: accountType,
        debit: 0,
        credit: 0,
      };
      current.debit = roundMoney(current.debit + Number(row.debit || 0));
      current.credit = roundMoney(current.credit + Number(row.credit || 0));
      grouped.set(key, current);
    });
  });

  const rows = Array.from(grouped.values())
    .map((row) => ({
      ...row,
      balance: roundMoney(row.debit - row.credit),
    }))
    .sort((a, b) => `${a.account_type}:${a.account_name}`.localeCompare(`${b.account_type}:${b.account_name}`));

  const totals = rows.reduce(
    (acc, row) => {
      acc.debit = roundMoney(acc.debit + row.debit);
      acc.credit = roundMoney(acc.credit + row.credit);
      return acc;
    },
    { debit: 0, credit: 0 }
  );

  return {
    rows,
    totals: {
      debit: totals.debit,
      credit: totals.credit,
      difference: roundMoney(totals.debit - totals.credit),
    },
  };
};

export const getBalanceSheetReport = async (clientOrPool, data = {}) => {
  const dbClient = queryable(clientOrPool);
  const tenantId = getTenantScope(data.tenantId ?? data.tenant_id);
  const fromDate = parseDateFilter(data.fromDate || data.from_date || data.from);
  const toDate = parseDateFilter(data.toDate || data.to_date || data.to);
  const branchId = numericFilter(data.branchId || data.branch_id);

  if (await hasGeneratedJournalEntries(dbClient, { tenantId, fromDate, toDate, branchId })) {
    const trialBalance = await getTrialBalanceReport(dbClient, { tenantId, fromDate, toDate, branchId });
    const rows = Array.isArray(trialBalance.rows) ? trialBalance.rows : [];
    const assets = rows
      .filter((row) => row.account_type === "asset" && roundMoney(row.balance || 0) !== 0)
      .map((row) => ({ name: row.account_name, amount: roundMoney(row.balance || 0) }));
    const liabilities = rows
      .filter((row) => row.account_type === "liability" && roundMoney(row.balance || 0) !== 0)
      .map((row) => ({ name: row.account_name, amount: roundMoney(-Number(row.balance || 0)) }));
    const formalEquity = rows
      .filter((row) => row.account_type === "equity" && roundMoney(row.balance || 0) !== 0)
      .map((row) => ({ name: row.account_name, amount: roundMoney(-Number(row.balance || 0)) }));
    const revenueTotal = roundMoney(
      rows
        .filter((row) => row.account_type === "revenue")
        .reduce((sum, row) => sum + Number(row.credit || 0) - Number(row.debit || 0), 0)
    );
    const expenseTotal = roundMoney(
      rows
        .filter((row) => row.account_type === "expense")
        .reduce((sum, row) => sum + Number(row.debit || 0) - Number(row.credit || 0), 0)
    );
    const retainedEarnings = roundMoney(revenueTotal - expenseTotal);
    const equity = [
      ...formalEquity,
      ...(retainedEarnings !== 0 ? [{ name: "Retained Earnings / Net Profit", amount: retainedEarnings }] : []),
    ];

    const totalAssets = roundMoney(assets.reduce((sum, row) => sum + row.amount, 0));
    const totalLiabilities = roundMoney(liabilities.reduce((sum, row) => sum + row.amount, 0));
    const totalEquity = roundMoney(equity.reduce((sum, row) => sum + row.amount, 0));
    const liabilitiesAndEquity = roundMoney(totalLiabilities + totalEquity);

    return {
      assets,
      liabilities,
      equity,
      totals: {
        assets: totalAssets,
        liabilities: totalLiabilities,
        equity: totalEquity,
        liabilities_and_equity: liabilitiesAndEquity,
        difference: roundMoney(totalAssets - liabilitiesAndEquity),
      },
    };
  }

  const [ledger, summary, profitLoss, orderColumns, purchaseColumns] = await Promise.all([
    getLedgersReport(dbClient, { tenantId, fromDate, toDate, branchId }),
    getFinancialReportsSummary(dbClient, { tenantId, fromDate, toDate, branchId }),
    getProfitLossReport(dbClient, { tenantId, fromDate, toDate, branchId }),
    getTableColumns(dbClient, "orders"),
    getTableColumns(dbClient, "purchases"),
  ]);

  const cashBalance = roundMoney(
    (ledger.rows || [])
      .filter((row) => String(row.account_name || "").toLowerCase().includes("cash"))
      .reduce((sum, row) => sum + Number(row.debit || 0) - Number(row.credit || 0), 0)
  );

  let receivables = 0;
  if (orderColumns.size) {
    const clauses = [];
    const params = [];
    addScopedWhere({ clauses, params, alias: "o", columns: orderColumns, tenantId, fromDate, toDate, branchId });
    if (orderColumns.has("status")) clauses.push(`LOWER(COALESCE(o.status, '')) NOT IN ('cancelled', 'canceled', 'void', 'refunded', 'returned', 'draft', 'deleted')`);
    if (orderColumns.has("payment_status")) clauses.push(`LOWER(COALESCE(o.payment_status, '')) NOT IN ('paid', 'completed', 'complete', 'refunded', 'returned')`);
    const totalExpr = coalesceColumnExpr("o", orderColumns, ["total_amount", "total", "total_price", "grand_total", "net_total"], "0");
    const paidExpr = coalesceColumnExpr("o", orderColumns, ["paid_amount", "amount_paid"], "0");
    const result = await dbClient.query(
      `
      SELECT COALESCE(SUM(GREATEST((${totalExpr}) - (${paidExpr}), 0)), 0)::numeric AS amount
      FROM orders o
      ${whereSql(clauses)}
      `,
      params
    );
    receivables = roundMoney(result.rows[0]?.amount || 0);
  }

  let payables = 0;
  if (purchaseColumns.size) {
    const clauses = [];
    const params = [];
    addScopedWhere({ clauses, params, alias: "p", columns: purchaseColumns, tenantId, fromDate, toDate, branchId });
    if (purchaseColumns.has("status")) clauses.push(`LOWER(COALESCE(p.status, '')) NOT IN ('cancelled', 'canceled', 'void', 'deleted', 'draft')`);
    const totalExpr = coalesceColumnExpr("p", purchaseColumns, ["total", "total_amount", "grand_total", "net_total"], "0");
    const paidExpr = coalesceColumnExpr("p", purchaseColumns, ["paid_amount", "amount_paid"], "0");
    const result = await dbClient.query(
      `
      SELECT COALESCE(SUM(GREATEST((${totalExpr}) - (${paidExpr}), 0)), 0)::numeric AS amount
      FROM purchases p
      ${whereSql(clauses)}
      `,
      params
    );
    payables = roundMoney(result.rows[0]?.amount || 0);
  }

  const hasFilteredActivity = Boolean((ledger.rows || []).length || receivables || payables || Number(profitLoss.net_profit || 0));
  const inventoryAmount = (fromDate || toDate) && !hasFilteredActivity ? 0 : roundMoney(summary.inventory_valuation || 0);

  const assets = [
    { name: "Cash / Bank", amount: cashBalance },
    { name: "Accounts Receivable", amount: receivables },
    { name: "Inventory", amount: inventoryAmount },
  ].filter((row) => row.amount !== 0);
  const liabilities = [{ name: "Accounts Payable", amount: payables }].filter((row) => row.amount !== 0);
  const equity = [{ name: "Retained Earnings / Net Profit", amount: roundMoney(profitLoss.net_profit || 0) }].filter((row) => row.amount !== 0);

  const totalAssets = roundMoney(assets.reduce((sum, row) => sum + row.amount, 0));
  const totalLiabilities = roundMoney(liabilities.reduce((sum, row) => sum + row.amount, 0));
  const totalEquity = roundMoney(equity.reduce((sum, row) => sum + row.amount, 0));
  const liabilitiesAndEquity = roundMoney(totalLiabilities + totalEquity);

  return {
    assets,
    liabilities,
    equity,
    totals: {
      assets: totalAssets,
      liabilities: totalLiabilities,
      equity: totalEquity,
      liabilities_and_equity: liabilitiesAndEquity,
      difference: roundMoney(totalAssets - liabilitiesAndEquity),
    },
  };
};
