import pool from "../database/db.js";
import XLSX from "xlsx";
import { getTenantId, isSuperAdminUser } from "../utils/requestScope.js";
import { getPhoneSearchVariants, normalizePhone, phoneSqlDigits } from "../utils/phoneSearch.js";
import { ensureWalletSchema, recordWalletTransaction } from "../services/walletService.js";
import { calculateTier, ensureLoyaltySchema, getCustomerLoyaltySummary } from "../services/loyaltyService.js";
import { createJournalEntry, recordFinancialAccountActivity } from "../services/accountingService.js";

let customerColumnsPromise = null;

const normalizePhoneValue = normalizePhone;

const quoteIdentifier = (value) => `"${String(value).replaceAll('"', '""')}"`;

const normalizePointsMode = (value = "replace") => {
  const mode = String(value || "").trim().toLowerCase();
  return mode === "add" ? "add" : "replace";
};

const normalizeEgyptImportPhone = (value = "") => {
  let digits = normalizePhoneValue(value).replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("0020")) digits = digits.slice(2);
  if (digits.startsWith("20") && digits.length >= 12) digits = `0${digits.slice(2)}`;
  if (digits.startsWith("1") && digits.length === 10) digits = `0${digits}`;
  return digits;
};

const isValidEgyptImportPhone = (value = "") => /^01\d{9}$/.test(String(value || ""));

const resetCustomerColumnsCache = () => {
  customerColumnsPromise = null;
};

const tableExists = async (tableName) => {
  const result = await pool.query(`SELECT to_regclass($1) AS regclass`, [`public.${tableName}`]);
  return Boolean(result.rows[0]?.regclass);
};

const columnExists = async (tableName, columnName) => {
  const result = await pool.query(
    `
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = $1
      AND column_name = $2
    LIMIT 1
    `,
    [tableName, columnName]
  );
  return result.rows.length > 0;
};

const normalizeCustomerRow = (row = {}) => ({
  id: row.id ?? null,
  tenant_id: row.tenant_id ?? null,
  name: row.name ?? "",
  phone: row.phone ?? "",
  mobile: row.mobile ?? "",
  whatsapp: row.whatsapp ?? "",
  email: row.email ?? "",
  address: row.address ?? "",
  balance: Number(row.balance ?? row.wallet_balance ?? row.credit_balance ?? 0),
  notes: row.notes ?? "",
  source: row.source ?? row.customer_source ?? row.lead_source ?? row.registration_source ?? "",
  customer_source: row.customer_source ?? row.source ?? row.lead_source ?? row.registration_source ?? "",
  lead_source: row.lead_source ?? row.customer_source ?? row.source ?? row.registration_source ?? "",
  registration_source: row.registration_source ?? row.customer_source ?? row.lead_source ?? row.source ?? "",
  marketing_source: row.marketing_source ?? "",
  marketing_platform: row.marketing_platform ?? "",
  attribution_type: row.attribution_type ?? "",
  created_at: row.created_at ?? null,
  wallet_balance: Number(row.wallet_balance ?? row.balance ?? row.credit_balance ?? 0),
  credit_balance: Number(row.credit_balance ?? row.wallet_balance ?? row.balance ?? 0),
  loyalty_points: Number(row.loyalty_points ?? 0),
  loyalty_tier: row.loyalty_tier ?? row.tier ?? "Bronze",
  purchase_preferences:
    row.purchase_preferences && typeof row.purchase_preferences === "object"
      ? row.purchase_preferences
      : {},
  allow_personal_transactions: Boolean(row.allow_personal_transactions ?? row.allowPersonalTransactions ?? false),
  total_orders: Number(row.total_orders ?? row.orders_count ?? row.invoices_count ?? 0),
  orders_count: Number(row.orders_count ?? row.total_orders ?? row.invoices_count ?? 0),
  invoices_count: Number(row.invoices_count ?? row.orders_count ?? row.total_orders ?? 0),
  orders_count_query_source: row.orders_count_query_source || "customers.total_orders",
  status: row.status ?? "active",
  updated_at: row.updated_at ?? row.created_at ?? null,
});

const normalizeRoleValue = (value = "") =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ");

const isAdminOrManagerUser = (user = {}) => {
  if (isSuperAdminUser(user)) return true;
  const role = normalizeRoleValue(user.role_name || user.role || "");
  return ["admin", "super admin", "superadmin", "manager"].includes(role);
};

const WALLET_TYPE_LABELS_AR = {
  order_payment: "دفع من المحفظة",
  refund: "استرداد إلى المحفظة",
  exchange_credit: "رصيد استبدال",
  loyalty_conversion: "رصيد ولاء",
  manual_add: "إضافة يدوية",
  manual_deduct: "خصم يدوي",
  customer_payment: "دفعة من العميل",
};

const normalizeWalletTransactionRow = (row = {}) => ({
  id: row.id,
  order_id: row.order_id || (row.reference_type === "order" ? row.reference_id : null),
  transaction_type: row.transaction_type,
  transaction_type_label: WALLET_TYPE_LABELS_AR[row.transaction_type] || row.transaction_type || "حركة محفظة",
  amount: Number(row.amount || 0),
  before_balance: Number(row.before_balance || 0),
  after_balance: Number(row.after_balance ?? row.balance_after ?? 0),
  reference_type: row.reference_type || null,
  reference_id: row.reference_id || null,
  invoice_number: row.invoice_number || null,
  return_number: row.return_number || null,
  created_by: row.created_by || null,
  created_by_name: row.created_by_name || "",
  created_at: row.created_at,
  notes: row.notes || row.description || "",
});

const getCustomerColumns = async () => {
  if (!customerColumnsPromise) {
    customerColumnsPromise = (async () => {
      try {
        const result = await pool.query(
          `
          SELECT column_name, is_nullable, data_type, column_default
          FROM information_schema.columns
          WHERE table_schema = current_schema()
            AND table_name = 'customers'
          ORDER BY ordinal_position
          `
        );
        const columns = result.rows.map((row) => row.column_name);
        const columnInfo = Object.fromEntries(result.rows.map((row) => [row.column_name, row]));
        const schema = {
          columns,
          tenantIdColumn: columns.includes("tenant_id") ? "tenant_id" : null,
          nameColumn: columns.includes("name") ? "name" : columns.includes("customer_name") ? "customer_name" : null,
          phoneColumn: columns.includes("phone") ? "phone" : columns.includes("phone_number") ? "phone_number" : null,
          mobileColumn: columns.includes("mobile") ? "mobile" : columns.includes("mobile_number") ? "mobile_number" : null,
          whatsappColumn: columns.includes("whatsapp") ? "whatsapp" : columns.includes("whatsapp_number") ? "whatsapp_number" : null,
          emailColumn: columns.includes("email") ? "email" : columns.includes("customer_email") ? "customer_email" : null,
          addressColumn: columns.includes("address") ? "address" : columns.includes("customer_address") ? "customer_address" : null,
          balanceColumn: columns.includes("balance") ? "balance" : null,
          notesColumn: columns.includes("notes") ? "notes" : null,
          sourceColumn: columns.includes("source") ? "source" : null,
          customerSourceColumn: columns.includes("customer_source") ? "customer_source" : null,
          leadSourceColumn: columns.includes("lead_source") ? "lead_source" : null,
          registrationSourceColumn: columns.includes("registration_source") ? "registration_source" : null,
          registrationSourceHasDefault: Boolean(columnInfo.registration_source?.column_default),
          marketingSourceColumn: columns.includes("marketing_source") ? "marketing_source" : null,
          marketingPlatformColumn: columns.includes("marketing_platform") ? "marketing_platform" : null,
          attributionTypeColumn: columns.includes("attribution_type") ? "attribution_type" : null,
          allowPersonalTransactionsColumn: columns.includes("allow_personal_transactions") ? "allow_personal_transactions" : null,
          walletBalanceColumn: columns.includes("wallet_balance") ? "wallet_balance" : null,
          loyaltyPointsColumn: columns.includes("loyalty_points") ? "loyalty_points" : null,
          purchasePreferencesColumn: columns.includes("purchase_preferences") ? "purchase_preferences" : null,
          statusColumn: columns.includes("status") ? "status" : null,
          createdAtColumn: columns.includes("created_at") ? "created_at" : null,
          updatedAtColumn: columns.includes("updated_at") ? "updated_at" : null,
        };
        return schema;
      } catch (error) {
        resetCustomerColumnsCache();
        throw error;
      }
    })();
  }

  try {
    return await customerColumnsPromise;
  } catch (error) {
    resetCustomerColumnsCache();
    throw error;
  }
};

const buildSelectSql = (columns) => {
  if (!columns.nameColumn || !columns.phoneColumn) return null;

  const balanceExpr = columns.walletBalanceColumn
    ? columns.walletBalanceColumn
    : columns.balanceColumn
      ? columns.balanceColumn
      : "0";
  const notesExpr = columns.notesColumn ? columns.notesColumn : "NULL::text";
  const loyaltyExpr = columns.loyaltyPointsColumn ? columns.loyaltyPointsColumn : "0";
  const loyaltyTierExpr = columns.allColumns?.has?.("loyalty_tier") ? "loyalty_tier" : "'Bronze'";
  const totalOrdersExpr = columns.allColumns?.has?.("total_orders") ? "total_orders" : "0";
  const statusExpr = columns.statusColumn ? columns.statusColumn : "'active'";
  const updatedAtExpr = columns.updatedAtColumn ? columns.updatedAtColumn : "created_at";
  const sourceExpr = columns.sourceColumn || columns.customerSourceColumn || columns.leadSourceColumn || columns.registrationSourceColumn || "''";
  const customerSourceExpr = columns.customerSourceColumn || columns.sourceColumn || columns.leadSourceColumn || columns.registrationSourceColumn || "''";
  const leadSourceExpr = columns.leadSourceColumn || columns.customerSourceColumn || columns.sourceColumn || columns.registrationSourceColumn || "''";
  const registrationSourceExpr = columns.registrationSourceColumn || columns.customerSourceColumn || columns.leadSourceColumn || columns.sourceColumn || "''";
  const marketingSourceExpr = columns.marketingSourceColumn || "''";
  const marketingPlatformExpr = columns.marketingPlatformColumn || "''";
  const attributionTypeExpr = columns.attributionTypeColumn || "''";
  const purchasePreferencesExpr = columns.purchasePreferencesColumn || "'{}'::jsonb";

  return `
    SELECT
      id,
      ${columns.tenantIdColumn ? "tenant_id," : "NULL::bigint AS tenant_id,"}
      ${columns.nameColumn} AS name,
      ${columns.phoneColumn} AS phone,
      ${columns.mobileColumn ? `${columns.mobileColumn} AS mobile` : "NULL::text AS mobile"},
      ${columns.whatsappColumn ? `${columns.whatsappColumn} AS whatsapp` : "NULL::text AS whatsapp"},
      ${columns.emailColumn ? `${columns.emailColumn} AS email` : "NULL::text AS email"},
      ${columns.addressColumn ? `${columns.addressColumn} AS address` : "NULL::text AS address"},
      ${balanceExpr} AS balance,
      ${notesExpr} AS notes,
      ${balanceExpr} AS wallet_balance,
      ${balanceExpr} AS credit_balance,
      ${loyaltyExpr} AS loyalty_points,
      ${purchasePreferencesExpr} AS purchase_preferences,
      ${loyaltyTierExpr} AS loyalty_tier,
      ${totalOrdersExpr} AS total_orders,
      ${statusExpr} AS status,
      ${sourceExpr} AS source,
      ${customerSourceExpr} AS customer_source,
      ${leadSourceExpr} AS lead_source,
      ${registrationSourceExpr} AS registration_source,
      ${marketingSourceExpr} AS marketing_source,
      ${marketingPlatformExpr} AS marketing_platform,
      ${attributionTypeExpr} AS attribution_type,
      ${columns.allowPersonalTransactionsColumn ? `${columns.allowPersonalTransactionsColumn}` : "FALSE"} AS allow_personal_transactions,
      created_at,
      ${updatedAtExpr} AS updated_at
    FROM customers
  `;
};

const buildCustomerSearch = (columns, search, params) => {
  const searchTerm = String(search || "").trim().toLowerCase();
  const likeSearch = `%${searchTerm}%`;
  const phoneColumns = [columns.phoneColumn, columns.mobileColumn, columns.whatsappColumn].filter(Boolean);
  const phoneVariants = getPhoneSearchVariants(searchTerm);

  params.push(searchTerm);
  const rawParam = `CAST($${params.length} AS TEXT)`;
  params.push(likeSearch);
  const textParam = `CAST($${params.length} AS TEXT)`;
  const clauses = [
    `LOWER(COALESCE(${columns.nameColumn}::text, '')) = ${rawParam}`,
    `LOWER(COALESCE(${columns.nameColumn}::text, '')) LIKE ${textParam}`,
  ];

  for (const column of phoneColumns) {
    clauses.push(`LOWER(COALESCE(${column}::text, '')) LIKE ${textParam}`);
  }

  const relevance = [
    `WHEN LOWER(COALESCE(${columns.nameColumn}::text, '')) = ${rawParam} THEN 0`,
    `WHEN LOWER(COALESCE(${columns.nameColumn}::text, '')) LIKE ${rawParam} || '%' THEN 3`,
  ];

  if (phoneVariants.length > 0 && phoneColumns.length > 0) {
    params.push(phoneVariants);
    const variantsParam = `$${params.length}`;
    const phoneDigitsExprs = phoneColumns.map((column) => phoneSqlDigits(column));
    const exactPhone = phoneDigitsExprs.map((expr) => `${expr} = ANY(${variantsParam}::text[])`).join(" OR ");
    const prefixPhone = phoneDigitsExprs
      .map((expr) => `EXISTS (SELECT 1 FROM unnest(${variantsParam}::text[]) AS q(value) WHERE ${expr} LIKE q.value || '%' OR q.value LIKE ${expr} || '%')`)
      .join(" OR ");
    const containsPhone = phoneDigitsExprs
      .map((expr) => `EXISTS (SELECT 1 FROM unnest(${variantsParam}::text[]) AS q(value) WHERE ${expr} LIKE '%' || q.value || '%')`)
      .join(" OR ");

    clauses.push(exactPhone, prefixPhone, containsPhone);
    relevance.unshift(`WHEN ${exactPhone} THEN 1`);
    relevance.push(`WHEN ${prefixPhone} THEN 2`, `WHEN ${containsPhone} THEN 4`);
  }

  relevance.push(`WHEN LOWER(COALESCE(${columns.nameColumn}::text, '')) LIKE ${textParam} THEN 5`);

  return {
    clause: `(${clauses.join(" OR ")})`,
    orderSql: `CASE ${relevance.join(" ")} ELSE 9 END`,
  };
};

const ensureCustomerSchema = async () => {
  const columns = await getCustomerColumns();
  const missingStatements = [];

  if (!columns.nameColumn) {
    missingStatements.push(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS name VARCHAR(255) NOT NULL DEFAULT ''`);
  }
  if (!columns.phoneColumn) {
    missingStatements.push(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS phone VARCHAR(50)`);
  }
  if (!columns.emailColumn) {
    missingStatements.push(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS email VARCHAR(255)`);
  }
  if (!columns.columns?.includes("password_hash")) {
    missingStatements.push(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS password_hash TEXT`);
  }
  if (!columns.columns?.includes("password_changed_at")) {
    missingStatements.push(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMP NULL`);
  }
  if (!columns.columns?.includes("password_reset_token_hash")) {
    missingStatements.push(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS password_reset_token_hash TEXT`);
  }
  if (!columns.columns?.includes("password_reset_token_expires_at")) {
    missingStatements.push(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS password_reset_token_expires_at TIMESTAMP NULL`);
  }
  if (!columns.columns?.includes("password_reset_requested_at")) {
    missingStatements.push(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS password_reset_requested_at TIMESTAMP NULL`);
  }
  if (!columns.columns?.includes("email_verified_at")) {
    missingStatements.push(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMP NULL`);
  }
  if (!columns.addressColumn) {
    missingStatements.push(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS address TEXT`);
  }
  if (!columns.createdAtColumn) {
    missingStatements.push(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP`);
  }
  if (!columns.customerSourceColumn) {
    missingStatements.push(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS customer_source VARCHAR(80)`);
  }
  if (!columns.leadSourceColumn) {
    missingStatements.push(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS lead_source VARCHAR(80)`);
  }
  if (!columns.registrationSourceColumn) {
    missingStatements.push(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS registration_source VARCHAR(80)`);
  } else if (!columns.registrationSourceHasDefault) {
    missingStatements.push(`ALTER TABLE customers ALTER COLUMN registration_source SET DEFAULT 'MANUAL'`);
  }
  if (!columns.marketingSourceColumn) {
    missingStatements.push(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS marketing_source VARCHAR(80)`);
  }
  if (!columns.marketingPlatformColumn) {
    missingStatements.push(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS marketing_platform VARCHAR(80)`);
  }
  if (!columns.attributionTypeColumn) {
    missingStatements.push(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS attribution_type VARCHAR(80)`);
  }
  if (!columns.allowPersonalTransactionsColumn) {
    missingStatements.push(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS allow_personal_transactions BOOLEAN NOT NULL DEFAULT FALSE`);
  }
  if (!columns.purchasePreferencesColumn) {
    missingStatements.push(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS purchase_preferences JSONB NOT NULL DEFAULT '{}'::jsonb`);
  }

  if (missingStatements.length > 0) {
    for (const statement of missingStatements) {
      await pool.query(statement);
    }
    resetCustomerColumnsCache();
    return getCustomerColumns();
  }

  return columns;
};

const ensureCustomerImportSchema = async (clientOrPool = pool) => {
  await ensureCustomerSchema();
  await ensureLoyaltySchema(clientOrPool);
  await ensureWalletSchema(clientOrPool);
  await clientOrPool.query(`
    CREATE TABLE IF NOT EXISTS customer_import_audit_logs (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT,
      file_name TEXT NOT NULL,
      imported_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
      created_count INTEGER NOT NULL DEFAULT 0,
      updated_count INTEGER NOT NULL DEFAULT 0,
      skipped_count INTEGER NOT NULL DEFAULT 0,
      invalid_count INTEGER NOT NULL DEFAULT 0,
      duplicate_phone_count INTEGER NOT NULL DEFAULT 0,
      total_rows INTEGER NOT NULL DEFAULT 0,
      total_points_imported NUMERIC(12,2) NOT NULL DEFAULT 0,
      points_mode VARCHAR(20) NOT NULL DEFAULT 'replace',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await clientOrPool.query(`ALTER TABLE IF EXISTS customer_import_audit_logs ADD COLUMN IF NOT EXISTS points_mode VARCHAR(20) NOT NULL DEFAULT 'replace'`);
  await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_customer_import_audit_tenant_created ON customer_import_audit_logs (tenant_id, created_at DESC)`);
};

const normalizeImportHeader = (value = "") =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ");

const importColumnAliases = {
  name: new Set(["customer name", "name", "customer", "client name", "اسم العميل", "العميل", "الاسم"]),
  phone: new Set(["phone", "mobile", "mobile number", "phone number", "whatsapp", "رقم الهاتف", "الموبايل", "الهاتف", "رقم العميل"]),
  email: new Set(["email", "e mail", "customer email", "البريد", "البريد الالكتروني", "الايميل"]),
  address: new Set(["address", "customer address", "location", "العنوان", "عنوان العميل"]),
  points: new Set([
    "old loyalty points",
    "legacy loyalty points",
    "loyalty points",
    "old points",
    "points",
    "old loyalty balance",
    "loyalty balance",
    "balance",
    "old balance",
    "رصيد النقاط",
    "النقاط",
    "نقاط الولاء",
    "رصيد الولاء",
    "الرصيد القديم",
    "الرصيد",
  ]),
};

const resolveImportColumns = (headers = []) => {
  const resolved = {};
  headers.forEach((header) => {
    const normalized = normalizeImportHeader(header);
    for (const [key, aliases] of Object.entries(importColumnAliases)) {
      if (!resolved[key] && aliases.has(normalized)) {
        resolved[key] = header;
      }
    }
  });
  return resolved;
};

const parseImportMoney = (value) => {
  const normalized = String(value ?? "")
    .trim()
    .replace(/[,\s]/g, "")
    .replace(/[^\d.-]/g, "");
  if (!normalized) return 0;
  if (!/^\d+(\.\d+)?$/.test(normalized)) return NaN;
  const number = Number(normalized);
  return Number.isFinite(number) ? Number(number.toFixed(2)) : NaN;
};

const parseCustomersImportFile = (file) => {
  if (!file?.buffer?.length) {
    const error = new Error("Import file is required");
    error.status = 400;
    throw error;
  }

  const workbook = XLSX.read(file.buffer, { type: "buffer", raw: false });
  const sheetName = workbook.SheetNames[0];
  const sheet = sheetName ? workbook.Sheets[sheetName] : null;
  if (!sheet) {
    const error = new Error("Import file has no readable sheets");
    error.status = 400;
    throw error;
  }

  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "", blankrows: false });
  const headers = rows.length ? Object.keys(rows[0]) : [];
  const columns = resolveImportColumns(headers);
  if (!columns.name || !columns.phone || !columns.points) {
    const error = new Error("Required columns are missing: customer name, phone, old loyalty points / balance");
    error.status = 400;
    error.details = { headers, recognized_columns: columns };
    throw error;
  }

  return rows.map((row, index) => {
    const name = String(row[columns.name] ?? "").trim();
    const phone = normalizeEgyptImportPhone(row[columns.phone]);
    const email = columns.email ? String(row[columns.email] ?? "").trim() : "";
    const address = columns.address ? String(row[columns.address] ?? "").trim() : "";
    const points = parseImportMoney(row[columns.points]);
    const phoneVariants = getPhoneSearchVariants(phone);
    return {
      row_number: index + 2,
      name,
      phone,
      normalized_phone: phone,
      phone_variants: phone ? [...new Set([phone, ...phoneVariants.map(normalizeEgyptImportPhone).filter(Boolean)])] : [],
      email,
      address,
      points,
      raw: row,
    };
  });
};

const buildImportErrorReport = (invalidRows = []) => {
  const header = ["row_number", "name", "phone", "email", "address", "points", "reason"];
  const escapeCsv = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  return [
    header.join(","),
    ...invalidRows.map((row) =>
      [
        row.row_number,
        row.name,
        row.phone,
        row.email,
        row.address,
        row.points,
        row.reason,
      ].map(escapeCsv).join(",")
    ),
  ].join("\n");
};

const loadCustomersByPhoneVariants = async (clientOrPool, columns, tenantId, phoneVariants = []) => {
  const selectSql = buildSelectSql(columns);
  const params = [phoneVariants];
  const where = [`${phoneSqlDigits(columns.phoneColumn)} = ANY($1::text[])`];
  if (columns.tenantIdColumn) {
    params.push(tenantId);
    where.push(`($${params.length}::bigint IS NULL OR tenant_id = $${params.length}::bigint)`);
  }
  const result = await clientOrPool.query(
    `
    ${selectSql}
    WHERE ${where.join(" AND ")}
    `,
    params
  );
  return result.rows.map(normalizeCustomerRow);
};

const analyzeCustomerImportRows = async (clientOrPool, rows, tenantId) => {
  const columns = await ensureCustomerSchema();
  const invalidRows = [];
  const validRows = [];
  const seenPhones = new Set();
  const duplicatePhones = new Set();

  for (const row of rows) {
    const reasons = [];
    if (!row.name) reasons.push("missing_customer_name");
    if (!isValidEgyptImportPhone(row.normalized_phone)) reasons.push("invalid_phone");
    if (!Number.isFinite(row.points) || row.points < 0 || row.points > 100000) reasons.push("Invalid points value");
    if (row.normalized_phone && seenPhones.has(row.normalized_phone)) {
      reasons.push("duplicate_phone_in_file");
      duplicatePhones.add(row.normalized_phone);
    }
    if (row.normalized_phone) seenPhones.add(row.normalized_phone);

    if (reasons.length) {
      invalidRows.push({ ...row, reason: reasons.join("|") });
    } else {
      validRows.push(row);
    }
  }

  const allVariants = [...new Set(validRows.flatMap((row) => row.phone_variants || []).filter(Boolean))];
  const existingCustomers = allVariants.length ? await loadCustomersByPhoneVariants(clientOrPool, columns, tenantId, allVariants) : [];
  const byPhoneVariant = new Map();
  for (const customer of existingCustomers) {
    const normalizedCustomerPhone = normalizeEgyptImportPhone(customer.phone);
    const variants = [...new Set([normalizedCustomerPhone, ...getPhoneSearchVariants(customer.phone).map(normalizeEgyptImportPhone)].filter(Boolean))];
    for (const variant of variants) {
      if (!byPhoneVariant.has(variant)) byPhoneVariant.set(variant, customer);
    }
  }

  const enrichedRows = validRows.map((row) => {
    const existing = (row.phone_variants || []).map((variant) => byPhoneVariant.get(variant)).find(Boolean) || null;
    return { ...row, existing_customer: existing };
  });

  const newRows = enrichedRows.filter((row) => !row.existing_customer);
  const matchedRows = enrichedRows.filter((row) => row.existing_customer);
  const totalPoints = enrichedRows.reduce((sum, row) => sum + Number(row.points || 0), 0);

  return {
    rows: enrichedRows,
    invalid_rows: invalidRows,
    error_report_csv: buildImportErrorReport(invalidRows),
    summary: {
      total_rows: rows.length,
      new_customers: newRows.length,
      existing_customers_matched: matchedRows.length,
      invalid_rows: invalidRows.length,
      duplicate_phones: duplicatePhones.size,
      total_points_to_import: Number(totalPoints.toFixed(2)),
    },
  };
};

const resolveImportTenantId = async (req, columns = null) => {
  const resolvedColumns = columns || await ensureCustomerSchema();
  const tenantId = getTenantId(req, req.user?.tenant_id);

  if (resolvedColumns.tenantIdColumn && tenantId === null) {
    const error = new Error("Tenant context is required for customer import");
    error.status = req.user ? 400 : 401;
    throw error;
  }

  return tenantId;
};

const insertImportedCustomer = async (client, columns, tenantId, row) => {
  const insertColumns = [];
  const insertValues = [];
  const placeholders = [];
  const add = (column, value) => {
    insertColumns.push(quoteIdentifier(column));
    insertValues.push(value);
    placeholders.push(`$${insertValues.length}`);
  };

  if (columns.tenantIdColumn && tenantId === null) {
    const error = new Error("Tenant context is required for imported customer creation");
    error.status = 400;
    throw error;
  }

  if (columns.tenantIdColumn) add(columns.tenantIdColumn, tenantId);
  add(columns.nameColumn, row.name);
  add(columns.phoneColumn, row.phone);
  if (columns.emailColumn) add(columns.emailColumn, row.email || null);
  if (columns.addressColumn) add(columns.addressColumn, row.address || null);
  if (columns.customerSourceColumn) add(columns.customerSourceColumn, "legacy_import");
  if (columns.leadSourceColumn) add(columns.leadSourceColumn, "legacy_import");
  if (columns.registrationSourceColumn) add(columns.registrationSourceColumn, "legacy_import");
  if (columns.statusColumn) add(columns.statusColumn, "active");

  const result = await client.query(
    `
    INSERT INTO customers (${insertColumns.join(", ")})
    VALUES (${placeholders.join(", ")})
    RETURNING id
    `,
    insertValues
  );
  return Number(result.rows[0]?.id);
};

const updateImportedCustomer = async (client, columns, tenantId, row) => {
  const customer = row.existing_customer;
  const setClauses = [];
  const params = [];
  const addSet = (column, value) => {
    params.push(value);
    setClauses.push(`${quoteIdentifier(column)} = CASE WHEN NULLIF(TRIM(COALESCE(${quoteIdentifier(column)}::text, '')), '') IS NULL THEN $${params.length} ELSE ${quoteIdentifier(column)} END`);
  };

  if (columns.nameColumn) addSet(columns.nameColumn, row.name);
  if (columns.emailColumn && row.email) addSet(columns.emailColumn, row.email);
  if (columns.addressColumn && row.address) addSet(columns.addressColumn, row.address);
  if (columns.updatedAtColumn) setClauses.push(`${quoteIdentifier(columns.updatedAtColumn)} = NOW()`);

  if (setClauses.length) {
    params.push(customer.id);
    if (columns.tenantIdColumn) params.push(tenantId);
    await client.query(
      `
      UPDATE customers
      SET ${setClauses.join(", ")}
      WHERE id = $${columns.tenantIdColumn ? params.length - 1 : params.length}
        ${columns.tenantIdColumn ? `AND ($${params.length}::bigint IS NULL OR tenant_id = $${params.length}::bigint)` : ""}
      `,
      params
    );
  }

  return Number(customer.id);
};

const applyImportedLegacyPoints = async (client, { tenantId, customerId, points, pointsMode = "replace", userId, fileName }) => {
  const amount = Number(Number(points || 0).toFixed(2));
  if (!customerId || amount < 0) return { before: 0, after: 0, delta: 0 };
  const mode = normalizePointsMode(pointsMode);
  const current = await client.query(
    `
    SELECT COALESCE(loyalty_points, 0) AS loyalty_points
    FROM customers
    WHERE id = $1
      AND ($2::bigint IS NULL OR tenant_id = $2::bigint OR tenant_id IS NULL)
    FOR UPDATE
    `,
    [customerId, tenantId]
  );
  const before = Number(current.rows[0]?.loyalty_points || 0);
  const after = mode === "add" ? Number((before + amount).toFixed(2)) : amount;
  const delta = Number((after - before).toFixed(2));
  const tier = calculateTier(after);
  const description = `Legacy points import - ${mode}: ${fileName}`;

  await client.query(
    `
    UPDATE customers
    SET loyalty_points = $1,
        loyalty_tier = $2,
        loyalty_updated_at = NOW(),
        updated_at = NOW()
    WHERE id = $3
      AND ($4::bigint IS NULL OR tenant_id = $4::bigint OR tenant_id IS NULL)
    `,
    [after, tier, customerId, tenantId]
  );

  await client.query(
    `
    INSERT INTO customer_loyalty (
      tenant_id, customer_id, tier, total_points_earned, total_points_redeemed,
      available_points, lifetime_points, lifetime_spent, updated_at
    )
    VALUES ($1,$2,$3,$4,0,$4,$4,0,NOW())
    ON CONFLICT (tenant_id, customer_id)
    DO UPDATE SET
      tier = EXCLUDED.tier,
      total_points_earned = CASE
        WHEN $6 = 'add' THEN customer_loyalty.total_points_earned + GREATEST($5::numeric, 0)
        ELSE GREATEST(customer_loyalty.total_points_earned, $4::numeric)
      END,
      available_points = $4::numeric,
      lifetime_points = CASE
        WHEN $6 = 'add' THEN customer_loyalty.lifetime_points + GREATEST($5::numeric, 0)
        ELSE GREATEST(customer_loyalty.lifetime_points, $4::numeric)
      END,
      updated_at = NOW()
    `,
    [tenantId, customerId, tier, after, delta, mode]
  );

  await client.query(
    `
    INSERT INTO customer_loyalty_history (tenant_id, customer_id, source, points_change, balance_after, reason)
    VALUES ($1,$2,'legacy_import',$3,$4,$5)
    `,
    [tenantId, customerId, delta, after, description]
  );

  await client.query(
    `
    INSERT INTO loyalty_transactions (tenant_id, customer_id, transaction_type, points, amount_value, description, created_by)
    VALUES ($1,$2,'legacy_import',$3,0,$4,$5)
    `,
    [tenantId, customerId, delta, description, userId || null]
  );

  return { before, after, delta };
};

const getCustomerById = async (id, tenantId) => {
  const columns = await ensureCustomerSchema();
  const selectSql = buildSelectSql(columns);
  const params = [id];

  if (columns.tenantIdColumn) {
    params.push(tenantId);
  }

  const result = await pool.query(
    `
    ${selectSql}
    WHERE id = $1
      ${columns.tenantIdColumn ? "AND ($2::bigint IS NULL OR tenant_id = $2::bigint)" : ""}
    LIMIT 1
    `,
    params
  );

  return result.rows[0] ? normalizeCustomerRow(result.rows[0]) : null;
};

const getCustomerByIdentifier = async (identifier, tenantId) => {
  const rawIdentifier = String(identifier || "").trim();
  const directCustomer = /^\d+$/.test(rawIdentifier) ? await getCustomerById(rawIdentifier, tenantId) : null;
  if (directCustomer) return directCustomer;

  const columns = await ensureCustomerSchema();
  const selectSql = buildSelectSql(columns);
  const phoneColumns = [columns.phoneColumn, columns.mobileColumn, columns.whatsappColumn].filter(Boolean);
  const phoneVariants = getPhoneSearchVariants(identifier);
  if (!selectSql || phoneColumns.length === 0 || phoneVariants.length === 0) return null;

  const params = [phoneVariants];
  const phoneMatch = phoneColumns.map((column) => `${phoneSqlDigits(column)} = ANY($1::text[])`).join(" OR ");
  if (columns.tenantIdColumn) params.push(tenantId);
  const result = await pool.query(
    `
    ${selectSql}
    WHERE (${phoneMatch})
      ${columns.tenantIdColumn ? "AND ($2::bigint IS NULL OR tenant_id = $2::bigint)" : ""}
    ORDER BY updated_at DESC NULLS LAST, id DESC
    LIMIT 1
    `,
    params
  );
  return result.rows[0] ? normalizeCustomerRow(result.rows[0]) : null;
};

const getUsableCustomerOrderCounts = async ({ customerIds = [], tenantId = null } = {}) => {
  const ids = [...new Set((Array.isArray(customerIds) ? customerIds : []).map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0))];
  if (ids.length === 0 || !(await tableExists("orders"))) {
    return { counts: new Map(), source: "orders.live_usable_completed_v1" };
  }

  const hasTenantId = await columnExists("orders", "tenant_id");
  const hasDeletedAt = await columnExists("orders", "deleted_at");
  const hasCancelledAt = await columnExists("orders", "cancelled_at");
  const hasStatus = await columnExists("orders", "status");
  const hasPaymentStatus = await columnExists("orders", "payment_status");
  const hasPaidAmount = await columnExists("orders", "paid_amount");
  const hasTotalAmount = await columnExists("orders", "total_amount");
  const hasTotal = await columnExists("orders", "total");

  const params = [ids];
  const where = ["customer_id = ANY($1::bigint[])"];

  if (hasTenantId) {
    params.push(tenantId);
    where.push(`($${params.length}::bigint IS NULL OR tenant_id = $${params.length}::bigint OR tenant_id IS NULL)`);
  }
  if (hasDeletedAt) where.push("deleted_at IS NULL");
  if (hasCancelledAt) where.push("cancelled_at IS NULL");
  if (hasStatus) {
    where.push(`LOWER(COALESCE(status, '')) NOT IN ('cancelled','canceled','void','refunded','returned','deleted','archived')`);
  }
  if (hasPaymentStatus) {
    where.push(`LOWER(COALESCE(payment_status, '')) NOT IN ('cancelled','canceled','void','refunded','returned','rejected','failed')`);
  }

  const statusPaidClause = hasStatus ? "LOWER(COALESCE(status, '')) IN ('completed','complete','delivered','done','paid')" : "FALSE";
  const paymentPaidClause = hasPaymentStatus ? "LOWER(COALESCE(payment_status, '')) IN ('paid','completed','complete','settled')" : "FALSE";
  const totalExpr = hasTotalAmount ? "COALESCE(total_amount, 0)" : hasTotal ? "COALESCE(total, 0)" : "0";
  const paidExpr = hasPaidAmount ? "COALESCE(paid_amount, 0)" : "0";
  const paidAmountClause = hasPaidAmount && (hasTotalAmount || hasTotal) ? `(${totalExpr}) > 0 AND (${paidExpr}) >= (${totalExpr})` : "FALSE";

  where.push(`(${statusPaidClause} OR ${paymentPaidClause} OR ${paidAmountClause})`);

  const result = await pool.query(
    `
    SELECT customer_id, COUNT(*)::int AS usable_orders_count
    FROM orders
    WHERE ${where.join(" AND ")}
    GROUP BY customer_id
    `,
    params
  );

  return {
    counts: new Map(result.rows.map((row) => [String(row.customer_id), Number(row.usable_orders_count || 0)])),
    source: "orders.live_usable_completed_v1",
  };
};

const getCustomerOrdersData = async (customerId, tenantId) => {
  if (!(await tableExists("orders"))) {
    return {
      metrics: { totalOrders: 0, totalSpend: 0, averageOrder: 0, lastVisit: null },
      orders: [],
      favorites: { topCategory: "Not enough data", productType: "Not enough data", sizes: [], colors: [] },
    };
  }

  const hasTenantId = await columnExists("orders", "tenant_id");
  const hasStatus = await columnExists("orders", "status");
  const hasItems = await tableExists("order_items");
  const where = ["o.customer_id = $1"];
  const params = [customerId];

  if (hasTenantId) {
    params.push(tenantId);
    where.push(`($${params.length}::bigint IS NULL OR o.tenant_id = $${params.length}::bigint)`);
  }

  const metricsResult = await pool.query(
    `
    SELECT
      COUNT(*)::int AS total_orders,
      ${hasStatus ? "COUNT(*) FILTER (WHERE LOWER(COALESCE(o.status, '')) IN ('completed','complete','delivered','done','paid'))::int" : "0::int"} AS completed_orders,
      ${hasStatus ? "COUNT(*) FILTER (WHERE LOWER(COALESCE(o.status, '')) IN ('cancelled','canceled','void','refunded','returned'))::int" : "0::int"} AS cancelled_orders,
      COALESCE(SUM(COALESCE(o.total_amount, 0)), 0) AS total_spend,
      COALESCE(AVG(COALESCE(o.total_amount, 0)), 0) AS average_order,
      MAX(o.created_at) AS last_visit
    FROM orders o
    WHERE ${where.join(" AND ")}
    `,
    params
  );

  const ordersResult = await pool.query(
    `
    SELECT
      o.id,
      COALESCE(o.invoice_number, CONCAT('ORD-', o.id::text)) AS invoice_number,
      o.created_at,
      COALESCE(o.total_amount, 0) AS total,
      ${hasItems ? "COALESCE(SUM(oi.quantity), COUNT(oi.id), 0)::int" : "0"} AS items_count
    FROM orders o
    ${hasItems ? "LEFT JOIN order_items oi ON oi.order_id = o.id" : ""}
    WHERE ${where.join(" AND ")}
    GROUP BY o.id
    ORDER BY o.created_at DESC
    LIMIT 8
    `,
    params
  );

  let favorites = {
    topCategory: "Not enough data",
    productType: "Not enough data",
    sizes: [],
    colors: [],
    departments: [],
    categories: [],
    productTypes: [],
    sizeBreakdown: [],
    colorBreakdown: [],
  };
  if (hasItems) {
    try {
      const preferencesResult = await pool.query(
        `
        WITH purchased AS (
          SELECT
            GREATEST(COALESCE(oi.quantity, 1) - COALESCE(oi.returned_quantity, 0), 0)::int AS quantity,
            NULLIF(TRIM(COALESCE(c.name, '')), '') AS category,
            NULLIF(TRIM(COALESCE(p.grade, '')), '') AS department,
            NULLIF(TRIM(COALESCE(p.product_type, '')), '') AS product_type,
            NULLIF(TRIM(COALESCE(pv.size, '')), '') AS size,
            NULLIF(TRIM(COALESCE(pv.color, '')), '') AS color
          FROM orders o
          JOIN order_items oi ON oi.order_id = o.id
          LEFT JOIN products p ON p.id = oi.product_id
          LEFT JOIN categories c ON c.id = p.category_id
          LEFT JOIN product_variants pv ON pv.id = oi.variant_id
          WHERE ${where.join(" AND ")}
            ${hasStatus ? "AND LOWER(COALESCE(o.status, '')) NOT IN ('cancelled','canceled','void','refunded')" : ""}
        ), preference_rows AS (
          SELECT 'department'::text AS kind, department AS value, SUM(quantity)::int AS purchase_count FROM purchased WHERE department IS NOT NULL AND quantity > 0 GROUP BY department
          UNION ALL
          SELECT 'category', category, SUM(quantity)::int FROM purchased WHERE category IS NOT NULL AND quantity > 0 GROUP BY category
          UNION ALL
          SELECT 'product_type', product_type, SUM(quantity)::int FROM purchased WHERE product_type IS NOT NULL AND quantity > 0 GROUP BY product_type
          UNION ALL
          SELECT 'size', size, SUM(quantity)::int FROM purchased WHERE size IS NOT NULL AND quantity > 0 GROUP BY size
          UNION ALL
          SELECT 'color', color, SUM(quantity)::int FROM purchased WHERE color IS NOT NULL AND quantity > 0 GROUP BY color
        )
        SELECT kind, value, purchase_count
        FROM preference_rows
        ORDER BY kind, purchase_count DESC, value ASC
        `,
        params
      );
      const byKind = (kind) => preferencesResult.rows
        .filter((row) => row.kind === kind && row.value)
        .map((row) => ({ value: row.value, count: Number(row.purchase_count || 0) }))
        .slice(0, 8);
      const departments = byKind("department");
      const categories = byKind("category");
      const productTypes = byKind("product_type");
      const sizeBreakdown = byKind("size");
      const colorBreakdown = byKind("color");
      favorites = {
        topCategory: categories[0]?.value || departments[0]?.value || productTypes[0]?.value || "Not enough data",
        productType: productTypes[0]?.value || "Not enough data",
        sizes: sizeBreakdown.map((item) => item.value).slice(0, 5),
        colors: colorBreakdown.map((item) => item.value).slice(0, 5),
        departments,
        categories,
        productTypes,
        sizeBreakdown,
        colorBreakdown,
        updatedAt: new Date().toISOString(),
        source: "completed_customer_orders",
      };

      await pool.query(
        `UPDATE customers
         SET purchase_preferences = $2::jsonb,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [customerId, JSON.stringify(favorites)]
      );

      const topSize = sizeBreakdown[0]?.value || "";
      if (topSize && await tableExists("ai_customer_profiles")) {
        const customerPhoneResult = await pool.query(`SELECT phone FROM customers WHERE id = $1 LIMIT 1`, [customerId]);
        const customerPhone = normalizePhoneValue(customerPhoneResult.rows[0]?.phone || "");
        if (customerPhone) {
          const phoneVariants = getPhoneSearchVariants(customerPhone);
          await pool.query(
            `UPDATE ai_customer_profiles
             SET preferred_size = $3, updated_at = CURRENT_TIMESTAMP
             WHERE ($1::bigint IS NULL OR tenant_id = $1::bigint)
               AND regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g') = ANY($2::text[])`,
            [tenantId, phoneVariants, topSize]
          );
        }
      }
    } catch (error) {
      console.warn("[customers] purchase preference refresh failed", error?.message || error);
    }
  }

  const metrics = metricsResult.rows[0] || {};
  return {
    metrics: {
      totalOrders: Number(metrics.total_orders || 0),
      completedOrders: Number(metrics.completed_orders || 0),
      cancelledOrders: Number(metrics.cancelled_orders || 0),
      totalSpend: Number(metrics.total_spend || 0),
      averageOrder: Number(metrics.average_order || 0),
      lastVisit: metrics.last_visit || null,
      lastOrderAt: metrics.last_visit || null,
    },
    orders: ordersResult.rows.map((order) => ({
      id: order.id,
      invoice_number: order.invoice_number,
      date: order.created_at,
      total: Number(order.total || 0),
      items_count: Number(order.items_count || 0),
    })),
    favorites,
  };
};

const getCustomerLoyaltyData = async (customerId, tenantId, customer = {}) => {
  const fallback = {
    tier: "Bronze",
    total_points_earned: 0,
    total_points_redeemed: 0,
    available_points: Number(customer.loyalty_points || 0),
    wallet_balance: Number(customer.wallet_balance ?? customer.balance ?? 0),
    lifetime_spent: 0,
    last_order_at: null,
    redeem_value: 0,
    points_per_currency_amount: 0,
    next_tier: "Silver",
    points_to_next_tier: 500,
    progress: 0,
    transactions: [],
  };

  const hasCustomerLoyalty = await tableExists("customer_loyalty");
  const hasTransactions = await tableExists("loyalty_transactions");
  const hasWallet = await tableExists("customer_wallets");
  const hasWalletTransactions = await tableExists("wallet_transactions");
  const hasRules = await tableExists("loyalty_rules");

  let loyalty = fallback;
  if (hasCustomerLoyalty) {
    const loyaltyResult = await pool.query(
      `
      SELECT *
      FROM customer_loyalty
      WHERE customer_id = $1
        AND ($2::bigint IS NULL OR tenant_id = $2::bigint)
      LIMIT 1
      `,
      [customerId, tenantId]
    );

    if (loyaltyResult.rows[0]) {
      loyalty = {
        ...loyalty,
        ...loyaltyResult.rows[0],
        tier: loyaltyResult.rows[0].tier || "Bronze",
        available_points: Number(loyaltyResult.rows[0].available_points || 0),
        total_points_earned: Number(loyaltyResult.rows[0].total_points_earned || 0),
        total_points_redeemed: Number(loyaltyResult.rows[0].total_points_redeemed || 0),
        lifetime_spent: Number(loyaltyResult.rows[0].lifetime_spent || 0),
      };
    }
  }

  let rule = null;
  if (hasRules) {
    const ruleResult = await pool.query(
      `
      SELECT *
      FROM loyalty_rules
      WHERE ($1::bigint IS NULL OR tenant_id = $1::bigint)
        AND is_active = TRUE
      ORDER BY updated_at DESC, id DESC
      LIMIT 1
      `,
      [tenantId]
    );
    rule = ruleResult.rows[0] || null;
  }

  const thresholds = [
    ["Bronze", Number(rule?.bronze_threshold ?? 0)],
    ["Silver", Number(rule?.silver_threshold ?? 500)],
    ["Gold", Number(rule?.gold_threshold ?? 1500)],
    ["Platinum", Number(rule?.platinum_threshold ?? 3000)],
  ];
  const earned = Number(loyalty.total_points_earned || loyalty.available_points || 0);
  const currentIndex = Math.max(0, thresholds.findLastIndex(([, threshold]) => earned >= threshold));
  const next = thresholds[Math.min(currentIndex + 1, thresholds.length - 1)];
  const current = thresholds[currentIndex];
  const span = Math.max(1, next[1] - current[1]);
  const progress = next[0] === current[0] ? 100 : Math.min(100, Math.max(0, ((earned - current[1]) / span) * 100));

  const transactions = hasTransactions
    ? await pool.query(
        `
        SELECT *
        FROM loyalty_transactions
        WHERE customer_id = $1
          AND ($2::bigint IS NULL OR tenant_id = $2::bigint)
        ORDER BY created_at DESC
        LIMIT 8
        `,
        [customerId, tenantId]
      )
    : { rows: [] };

  const walletResult = hasWallet
    ? await pool.query(
        `
        SELECT *
        FROM customer_wallets
        WHERE customer_id = $1
          AND ($2::bigint IS NULL OR tenant_id = $2::bigint)
        LIMIT 1
        `,
        [customerId, tenantId]
      )
    : { rows: [] };

  const walletTransactions = hasWalletTransactions
    ? await pool.query(
        `
        SELECT *
        FROM wallet_transactions
        WHERE customer_id = $1
          AND ($2::bigint IS NULL OR tenant_id = $2::bigint)
        ORDER BY created_at DESC
        LIMIT 8
        `,
        [customerId, tenantId]
      )
    : { rows: [] };

  const walletBalance = Number(walletResult.rows[0]?.balance ?? customer.wallet_balance ?? customer.balance ?? 0);

  return {
    ...loyalty,
    wallet_balance: walletBalance,
    redeem_value: Number(rule?.redeem_value || 0),
    points_per_currency_amount: Number(rule?.points_per_currency_amount || 0),
    next_tier: next[0],
    points_to_next_tier: Math.max(0, next[1] - earned),
    progress,
    transactions: transactions.rows,
    wallet_transactions: walletTransactions.rows,
  };
};

const getCustomerWalletTransactions = async (customerId, tenantId, filters = {}, options = {}) => {
  await ensureWalletSchema(pool);
  const hasReturns = await tableExists("returns");
  const where = ["wt.customer_id = $1", "($2::bigint IS NULL OR wt.tenant_id = $2::bigint)"];
  const params = [customerId, tenantId];

  const addParam = (value) => {
    params.push(value);
    return `$${params.length}`;
  };

  if (filters.date_from) {
    where.push(`wt.created_at >= ${addParam(filters.date_from)}::timestamp`);
  }
  if (filters.date_to) {
    where.push(`wt.created_at < (${addParam(filters.date_to)}::date + INTERVAL '1 day')`);
  }
  if (filters.transaction_type) {
    where.push(`wt.transaction_type = ${addParam(filters.transaction_type)}`);
  }
  if (filters.invoice_number) {
    where.push(`LOWER(COALESCE(o.invoice_number, wt.reference_id::text, wt.order_id::text, '')) LIKE ${addParam(`%${String(filters.invoice_number).toLowerCase()}%`)}`);
  }
  if (filters.amount_min !== undefined && filters.amount_min !== "") {
    where.push(`ABS(wt.amount) >= ${addParam(Number(filters.amount_min) || 0)}::numeric`);
  }
  if (filters.amount_max !== undefined && filters.amount_max !== "") {
    where.push(`ABS(wt.amount) <= ${addParam(Number(filters.amount_max) || 0)}::numeric`);
  }

  const limitSql = options.limit ? `LIMIT ${Number(options.limit) || 50}` : "";
  const result = await pool.query(
    `
    SELECT
      wt.*,
      o.invoice_number,
      ${hasReturns ? "r.return_number" : "NULL::text AS return_number"},
      COALESCE(u.name, u.email, '') AS created_by_name
    FROM wallet_transactions wt
    LEFT JOIN orders o ON o.id = wt.order_id OR (wt.reference_type = 'order' AND o.id = wt.reference_id)
    ${hasReturns ? "LEFT JOIN returns r ON r.id = wt.reference_id AND wt.reference_type IN ('return', 'exchange')" : ""}
    LEFT JOIN users u ON u.id = wt.created_by
    WHERE ${where.join(" AND ")}
    ORDER BY wt.created_at DESC, wt.id DESC
    ${limitSql}
    `,
    params
  );

  return result.rows.map(normalizeWalletTransactionRow);
};

const ensureCustomerPaymentsSchema = async (clientOrPool = pool) => {
  await clientOrPool.query(`
    CREATE TABLE IF NOT EXISTS customer_payments (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
      payment_method VARCHAR(50) NOT NULL DEFAULT 'cash',
      reference VARCHAR(160),
      notes TEXT,
      payment_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_customer_payments_statement ON customer_payments (tenant_id, customer_id, payment_date DESC, id DESC)`);
  await clientOrPool.query(`
    CREATE TABLE IF NOT EXISTS customer_payment_allocations (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      payment_id BIGINT NOT NULL REFERENCES customer_payments(id) ON DELETE CASCADE,
      order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (payment_id, order_id)
    )
  `);
  await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_customer_payment_allocations_order ON customer_payment_allocations (tenant_id, customer_id, order_id)`);
};

const reconcileCustomerInvoicePayments = async (clientOrPool, { tenantId, customerId }) => {
  await ensureCustomerPaymentsSchema(clientOrPool);
  const ordersResult = await clientOrPool.query(
    `
    SELECT id, COALESCE(total_amount, total, 0)::numeric AS total_amount
    FROM orders
    WHERE tenant_id = $1
      AND customer_id = $2
      AND LOWER(COALESCE(payment_method, '')) = 'credit_sale'
      AND LOWER(COALESCE(status, '')) NOT IN ('cancelled', 'canceled', 'refunded', 'returned')
    ORDER BY created_at ASC, id ASC
    FOR UPDATE
    `,
    [tenantId, customerId]
  );
  const paymentsResult = await clientOrPool.query(
    `
    SELECT id, amount
    FROM customer_payments
    WHERE tenant_id = $1 AND customer_id = $2
    ORDER BY payment_date ASC, id ASC
    FOR UPDATE
    `,
    [tenantId, customerId]
  );

  await clientOrPool.query(
    `DELETE FROM customer_payment_allocations WHERE tenant_id = $1 AND customer_id = $2`,
    [tenantId, customerId]
  );

  let orderIndex = 0;
  let orderRemaining = Number(ordersResult.rows[0]?.total_amount || 0);
  for (const paymentRow of paymentsResult.rows) {
    let paymentRemaining = Number(paymentRow.amount || 0);
    while (paymentRemaining > 0.009 && orderIndex < ordersResult.rows.length) {
      if (orderRemaining <= 0.009) {
        orderIndex += 1;
        orderRemaining = Number(ordersResult.rows[orderIndex]?.total_amount || 0);
        continue;
      }
      const allocatedAmount = Number(Math.min(paymentRemaining, orderRemaining).toFixed(2));
      await clientOrPool.query(
        `
        INSERT INTO customer_payment_allocations (tenant_id, customer_id, payment_id, order_id, amount)
        VALUES ($1,$2,$3,$4,$5)
        `,
        [tenantId, customerId, paymentRow.id, ordersResult.rows[orderIndex].id, allocatedAmount]
      );
      paymentRemaining = Number((paymentRemaining - allocatedAmount).toFixed(2));
      orderRemaining = Number((orderRemaining - allocatedAmount).toFixed(2));
    }
  }

  await clientOrPool.query(
    `
    UPDATE orders o
    SET paid_amount = allocation.paid_amount,
        payment_status = CASE
          WHEN allocation.paid_amount >= COALESCE(o.total_amount, o.total, 0) - 0.009 THEN 'paid'
          WHEN allocation.paid_amount > 0.009 THEN 'partially_paid'
          ELSE 'unpaid'
        END
    FROM (
      SELECT target.id AS order_id, COALESCE(SUM(cpa.amount), 0)::numeric AS paid_amount
      FROM orders target
      LEFT JOIN customer_payment_allocations cpa ON cpa.order_id = target.id
      WHERE target.tenant_id = $1
        AND target.customer_id = $2
        AND LOWER(COALESCE(target.payment_method, '')) = 'credit_sale'
        AND LOWER(COALESCE(target.status, '')) NOT IN ('cancelled', 'canceled', 'refunded', 'returned')
      GROUP BY target.id
    ) allocation
    WHERE o.id = allocation.order_id
    `,
    [tenantId, customerId]
  );
};

const reconcileCustomerInvoicePaymentsInTransaction = async ({ tenantId, customerId }) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await reconcileCustomerInvoicePayments(client, { tenantId, customerId });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

const getCustomerPaymentTransactions = async (customerId, tenantId, filters = {}) => {
  await ensureCustomerPaymentsSchema(pool);
  const where = ["cp.customer_id = $1", "($2::bigint IS NULL OR cp.tenant_id = $2::bigint)"];
  const params = [customerId, tenantId];
  const addParam = (value) => {
    params.push(value);
    return `$${params.length}`;
  };
  if (filters.transaction_type && filters.transaction_type !== "customer_payment") return [];
  if (filters.date_from) where.push(`cp.payment_date >= ${addParam(filters.date_from)}::timestamp`);
  if (filters.date_to) where.push(`cp.payment_date < (${addParam(filters.date_to)}::date + INTERVAL '1 day')`);
  if (filters.invoice_number) where.push(`LOWER(COALESCE(cp.reference, cp.id::text, '')) LIKE ${addParam(`%${String(filters.invoice_number).toLowerCase()}%`)}`);
  if (filters.amount_min !== undefined && filters.amount_min !== "") where.push(`cp.amount >= ${addParam(Number(filters.amount_min) || 0)}::numeric`);
  if (filters.amount_max !== undefined && filters.amount_max !== "") where.push(`cp.amount <= ${addParam(Number(filters.amount_max) || 0)}::numeric`);
  const result = await pool.query(
    `
    SELECT
      cp.*,
      COALESCE(u.name, u.email, '') AS created_by_name,
      STRING_AGG(DISTINCT o.invoice_number, ', ' ORDER BY o.invoice_number) AS allocated_invoice_numbers,
      MIN(o.id) AS allocated_order_id,
      COUNT(DISTINCT o.id)::int AS allocated_orders_count
    FROM customer_payments cp
    LEFT JOIN users u ON u.id = cp.created_by
    LEFT JOIN customer_payment_allocations cpa ON cpa.payment_id = cp.id
    LEFT JOIN orders o ON o.id = cpa.order_id
    WHERE ${where.join(" AND ")}
    GROUP BY cp.id, u.name, u.email
    ORDER BY cp.payment_date DESC, cp.id DESC
    `,
    params
  );
  return result.rows.map((row) => ({
    id: `customer-payment-${row.id}`,
    payment_id: Number(row.id),
    transaction_type: "customer_payment",
    transaction_type_label: "دفعة من العميل",
    amount: Number(row.amount || 0) * -1,
    payment_method: row.payment_method || "cash",
    reference_type: "customer_payment",
    reference_id: row.reference || row.id,
    order_id: Number(row.allocated_orders_count || 0) === 1 ? Number(row.allocated_order_id) : null,
    invoice_number: row.allocated_invoice_numbers || null,
    created_by: row.created_by,
    created_by_name: row.created_by_name || "",
    created_at: row.payment_date || row.created_at,
    notes: row.notes || "",
  }));
};

const PERSONAL_SETTLEMENT_LABELS = {
  GIFT: "هدية / مصروف",
  EMPLOYEE_ADVANCE: "سلفة موظف",
  OWNER_USE: "استخدام شخصي للمالك",
};

const normalizePersonalSettlementType = (value = "") => {
  const normalized = String(value || "").trim().toUpperCase();
  return ["GIFT", "EMPLOYEE_ADVANCE", "OWNER_USE"].includes(normalized) ? normalized : "";
};

const getCustomerPersonalTransactions = async (customerId, tenantId, filters = {}, options = {}) => {
  const hasOrders = await tableExists("orders");
  if (!hasOrders) return [];

  const hasTenantId = await columnExists("orders", "tenant_id");
  const hasPersonalFlag = await columnExists("orders", "is_personal_transaction");
  const hasSettlementType = await columnExists("orders", "personal_settlement_type");
  const hasPersonalNote = await columnExists("orders", "personal_note");
  const hasPaymentMethod = await columnExists("orders", "payment_method");
  const hasItems = await tableExists("order_items");
  const where = ["o.customer_id = $1"];
  const params = [customerId];

  const addParam = (value) => {
    params.push(value);
    return `$${params.length}`;
  };

  if (hasTenantId) {
    params.push(tenantId);
    where.push(`($${params.length}::bigint IS NULL OR o.tenant_id = $${params.length}::bigint)`);
  }
  if (hasPersonalFlag) {
    where.push("COALESCE(o.is_personal_transaction, FALSE) = TRUE");
  } else if (hasPaymentMethod) {
    where.push("LOWER(COALESCE(o.payment_method, '')) = 'personal'");
  }
  if (filters.date_from) {
    where.push(`o.created_at >= ${addParam(filters.date_from)}::timestamp`);
  }
  if (filters.date_to) {
    where.push(`o.created_at < (${addParam(filters.date_to)}::date + INTERVAL '1 day')`);
  }
  if (filters.invoice_number) {
    where.push(`LOWER(COALESCE(o.invoice_number, '')) LIKE ${addParam(`%${String(filters.invoice_number).toLowerCase()}%`)}`);
  }
  if (filters.transaction_type) {
    const normalizedFilter = normalizePersonalSettlementType(filters.transaction_type);
    if (normalizedFilter) {
      if (hasSettlementType) {
        where.push(`UPPER(COALESCE(o.personal_settlement_type, '')) = ${addParam(normalizedFilter)}`);
      } else {
        where.push("1 = 0");
      }
    } else {
      where.push("1 = 0");
    }
  }

  const limitSql = options.limit ? `LIMIT ${Number(options.limit) || 50}` : "";
  const result = await pool.query(
    `
    SELECT
      o.id,
      o.created_at,
      COALESCE(o.invoice_number, CONCAT('ORD-', o.id::text)) AS invoice_number,
      COALESCE(o.total_amount, o.total, 0) AS total_amount,
      COALESCE(o.personal_settlement_type, '') AS personal_settlement_type,
      COALESCE(o.personal_note, o.notes, '') AS personal_note,
      STRING_AGG(
        DISTINCT NULLIF(TRIM(CONCAT(COALESCE(oi.product_name, oi.variant_name, oi.sku, 'Item'), ' x', COALESCE(oi.quantity, 1))), ''),
        ' | '
        ORDER BY NULLIF(TRIM(CONCAT(COALESCE(oi.product_name, oi.variant_name, oi.sku, 'Item'), ' x', COALESCE(oi.quantity, 1))), '')
      ) AS products_text
    FROM orders o
    ${hasItems ? "LEFT JOIN order_items oi ON oi.order_id = o.id" : ""}
    WHERE ${where.join(" AND ")}
    GROUP BY o.id
    ORDER BY o.created_at DESC, o.id DESC
    ${limitSql}
    `,
    params
  );

  return result.rows.map((row) => {
    const settlementType = normalizePersonalSettlementType(row.personal_settlement_type);
    const label = PERSONAL_SETTLEMENT_LABELS[settlementType] || "عملية شخصية";
    const value = Number(row.total_amount || 0);
    const effectAmount = settlementType === "EMPLOYEE_ADVANCE" ? value : 0;
    return {
      id: `personal-${row.id}`,
      order_id: row.id,
      reference_type: "personal_order",
      reference_id: row.id,
      invoice_number: row.invoice_number || `ORD-${row.id}`,
      return_number: null,
      transaction_type: settlementType ? `personal_${settlementType.toLowerCase()}` : "personal",
      transaction_type_label: label,
      personal_operation_type: settlementType,
      personal_operation_type_label: label,
      personal_value: value,
      products: row.products_text || "",
      amount: effectAmount,
      before_balance: 0,
      after_balance: 0,
      created_by: null,
      created_by_name: "",
      created_at: row.created_at,
      notes: row.personal_note || "",
      description: row.personal_note || row.products_text || label,
    };
  });
};

const getCustomerCreditSaleTransactions = async (customerId, tenantId, filters = {}, options = {}) => {
  const hasOrders = await tableExists("orders");
  if (!hasOrders) return [];

  const hasTenantId = await columnExists("orders", "tenant_id");
  const hasPaymentMethod = await columnExists("orders", "payment_method");
  const hasPaymentStatus = await columnExists("orders", "payment_status");
  const hasPaidAmount = await columnExists("orders", "paid_amount");
  const hasItems = await tableExists("order_items");
  const where = ["o.customer_id = $1"];
  const params = [customerId];

  const addParam = (value) => {
    params.push(value);
    return `$${params.length}`;
  };

  if (hasTenantId) {
    params.push(tenantId);
    where.push(`($${params.length}::bigint IS NULL OR o.tenant_id = $${params.length}::bigint)`);
  }
  if (hasPaymentMethod) {
    where.push(`LOWER(COALESCE(o.payment_method, '')) = 'credit_sale'`);
  }
  if (filters.date_from) {
    where.push(`o.created_at >= ${addParam(filters.date_from)}::timestamp`);
  }
  if (filters.date_to) {
    where.push(`o.created_at < (${addParam(filters.date_to)}::date + INTERVAL '1 day')`);
  }
  if (filters.invoice_number) {
    where.push(`LOWER(COALESCE(o.invoice_number, '')) LIKE ${addParam(`%${String(filters.invoice_number).toLowerCase()}%`)}`);
  }
  if (filters.transaction_type && filters.transaction_type !== "order_payment") {
    where.push("1 = 0");
  }
  if (filters.amount_min !== undefined && filters.amount_min !== "") {
    where.push(`COALESCE(o.total_amount, o.total, 0) >= ${addParam(Number(filters.amount_min) || 0)}::numeric`);
  }
  if (filters.amount_max !== undefined && filters.amount_max !== "") {
    where.push(`COALESCE(o.total_amount, o.total, 0) <= ${addParam(Number(filters.amount_max) || 0)}::numeric`);
  }

  const limitSql = options.limit ? `LIMIT ${Number(options.limit) || 50}` : "";
  const result = await pool.query(
    `
    SELECT
      o.id,
      o.created_at,
      COALESCE(o.invoice_number, CONCAT('ORD-', o.id::text)) AS invoice_number,
      COALESCE(o.total_amount, o.total, 0) AS total_amount,
      ${hasPaidAmount ? "COALESCE(o.paid_amount, 0)" : "0"} AS paid_amount,
      ${hasPaymentStatus ? "COALESCE(o.payment_status, 'unpaid')" : "'unpaid'"} AS payment_status,
      COALESCE(o.notes, '') AS order_note,
      STRING_AGG(
        DISTINCT NULLIF(TRIM(CONCAT(COALESCE(oi.product_name, oi.variant_name, oi.sku, 'Item'), ' x', COALESCE(oi.quantity, 1))), ''),
        ' | '
        ORDER BY NULLIF(TRIM(CONCAT(COALESCE(oi.product_name, oi.variant_name, oi.sku, 'Item'), ' x', COALESCE(oi.quantity, 1))), '')
      ) AS products_text
    FROM orders o
    ${hasItems ? "LEFT JOIN order_items oi ON oi.order_id = o.id" : ""}
    WHERE ${where.join(" AND ")}
    GROUP BY o.id
    ORDER BY o.created_at DESC, o.id DESC
    ${limitSql}
    `,
    params
  );

  return result.rows.map((row) => {
    const value = Number(row.total_amount || 0);
    return {
      id: `credit-sale-${row.id}`,
      order_id: row.id,
      reference_type: "order",
      reference_id: row.id,
      invoice_number: row.invoice_number || `ORD-${row.id}`,
      return_number: null,
      transaction_type: "order_payment",
      transaction_type_label: "آجل",
      payment_method: "credit_sale",
      payment_status: row.payment_status || "unpaid",
      paid_amount: Number(row.paid_amount || 0),
      remaining_amount: Math.max(0, value - Number(row.paid_amount || 0)),
      personal_operation_type: null,
      personal_operation_type_label: "",
      personal_value: 0,
      products: row.products_text || "",
      amount: value,
      before_balance: 0,
      after_balance: 0,
      created_by: null,
      created_by_name: "",
      created_at: row.created_at,
      notes: row.order_note || "",
      description: row.order_note || row.products_text || "آجل",
    };
  });
};

const getStatementOpeningBalance = async (customerId, tenantId, dateFrom) => {
  await ensureWalletSchema(pool);
  if (!dateFrom) {
    const first = await pool.query(
      `
      SELECT before_balance
      FROM wallet_transactions
      WHERE customer_id = $1
        AND ($2::bigint IS NULL OR tenant_id = $2::bigint)
      ORDER BY created_at ASC, id ASC
      LIMIT 1
      `,
      [customerId, tenantId]
    );
    return Number(first.rows[0]?.before_balance || 0);
  }
  const fromDate = new Date(`${String(dateFrom).slice(0, 10)}T00:00:00.000Z`);
  fromDate.setUTCDate(fromDate.getUTCDate() - 1);
  const priorFilters = { date_to: fromDate.toISOString().slice(0, 10) };
  const [walletRows, personalRows, creditRows, paymentRows] = await Promise.all([
    getCustomerWalletTransactions(customerId, tenantId, priorFilters),
    getCustomerPersonalTransactions(customerId, tenantId, priorFilters),
    getCustomerCreditSaleTransactions(customerId, tenantId, priorFilters),
    getCustomerPaymentTransactions(customerId, tenantId, priorFilters),
  ]);
  return Number(
    [...walletRows, ...personalRows, ...creditRows, ...paymentRows]
      .reduce((sum, item) => sum + Number(item.amount || 0), 0)
      .toFixed(2)
  );
};

export const getCustomerWalletAudit = async (req, res) => {
  try {
    const tenantId = isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id);
    const customerId = Number(req.params.id);
    const customer = await getCustomerById(customerId, tenantId);
    if (!customer) {
      return res.status(404).json({ success: false, message: "Customer not found" });
    }

    const transactions = await getCustomerWalletTransactions(customerId, tenantId, req.query, { limit: 200 });
    return res.status(200).json({ success: true, data: transactions });
  } catch (error) {
    console.error("[customers] wallet audit error", error);
    return res.status(500).json({ success: false, message: "Failed to load wallet audit", error: error.message });
  }
};

export const getCustomerStatement = async (req, res) => {
  try {
    if (!isAdminOrManagerUser(req.user)) {
      return res.status(403).json({ success: false, message: "Admin or manager permission required" });
    }

    const tenantId = isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id);
    const customerId = Number(req.params.id);
    const customer = await getCustomerById(customerId, tenantId);
    if (!customer) {
      return res.status(404).json({ success: false, message: "Customer not found" });
    }

    await reconcileCustomerInvoicePaymentsInTransaction({ tenantId: Number(customer.tenant_id || tenantId), customerId });

    const [walletTransactions, personalTransactions, creditSaleTransactions, customerPaymentTransactions] = await Promise.all([
      getCustomerWalletTransactions(customerId, tenantId, req.query),
      getCustomerPersonalTransactions(customerId, tenantId, req.query),
      getCustomerCreditSaleTransactions(customerId, tenantId, req.query),
      getCustomerPaymentTransactions(customerId, tenantId, req.query),
    ]);
    const chronological = [...walletTransactions, ...personalTransactions, ...customerPaymentTransactions]
      .concat(Array.isArray(creditSaleTransactions) ? creditSaleTransactions : [])
      .filter(Boolean)
      .sort((a, b) => {
        const byDate = new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime();
        if (byDate) return byDate;
        return Number(a.id || 0) - Number(b.id || 0);
      });
    const openingBalance = await getStatementOpeningBalance(customerId, tenantId, req.query.date_from);
    let runningBalance = Number(openingBalance || 0);
    const statementRows = chronological.map((item) => {
      const amount = Number(item.amount || 0);
      const beforeBalance = runningBalance;
      runningBalance = Number((runningBalance + amount).toFixed(2));
      return {
        ...item,
        before_balance: beforeBalance,
        after_balance: runningBalance,
      };
    });
    const finalBalance = statementRows.length ? Number(statementRows[statementRows.length - 1].after_balance || 0) : Number(openingBalance || 0);
    const totals = chronological.reduce(
      (acc, item) => {
        const amount = Number(item.amount || 0);
        if (item.transaction_type === "order_payment" || item.payment_method === "credit_sale") acc.orders += Math.abs(amount);
        if (["refund", "exchange_credit"].includes(item.transaction_type)) acc.returns += Math.abs(amount);
        if (["loyalty_conversion", "manual_add"].includes(item.transaction_type)) acc.wallet_credits += Math.abs(amount);
        if ((item.transaction_type === "order_payment" && item.payment_method !== "credit_sale") || item.transaction_type === "customer_payment") acc.wallet_payments += Math.abs(amount);
        if (["manual_add", "manual_deduct"].includes(item.transaction_type)) acc.manual_adjustments += amount;
        if (String(item.transaction_type || "").startsWith("personal_")) acc.personal += Math.abs(Number(item.personal_value || amount || 0));
        acc.net += amount;
        return acc;
      },
      { orders: 0, returns: 0, wallet_credits: 0, wallet_payments: 0, manual_adjustments: 0, personal: 0, net: 0 }
    );

    return res.status(200).json({
      success: true,
      data: {
        customer,
        filters: req.query,
        opening_balance: openingBalance,
        final_balance: finalBalance,
        current_balance: Number(finalBalance),
        totals,
        rows: statementRows,
      },
    });
  } catch (error) {
    console.error("[customers] statement error", error);
    return res.status(500).json({ success: false, message: "Failed to build customer statement", error: error.message });
  }
};

export const adjustCustomerWallet = async (req, res) => {
  const client = await pool.connect();
  try {
    const role = String(req.user?.role || req.user?.role_name || "").toLowerCase();
    const isAdmin = isSuperAdminUser(req.user) || ["admin", "super admin", "superadmin", "super_admin"].includes(role);
    if (!isAdmin) {
      return res.status(403).json({ success: false, message: "Admin permission required" });
    }

    const requestedTenantId = isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id);
    const customerId = Number(req.params.id);
    const customer = await getCustomerById(customerId, requestedTenantId);
    if (!customer) {
      return res.status(404).json({ success: false, message: "Customer not found" });
    }
    const tenantId = Number(customer.tenant_id || requestedTenantId || 0) || null;
    if (!tenantId) {
      return res.status(422).json({
        success: false,
        message: "لا يمكن تسجيل الدفعة لأن العميل غير مرتبط بوحدة تشغيل",
      });
    }
    const type = String(req.body.transaction_type || req.body.type || "").trim();
    const amount = Math.abs(Number(req.body.amount || 0));
    const notes = String(req.body.notes || req.body.reason || "").trim();
    const isCustomerPayment = type === "customer_payment";
    if (!customerId || !amount || !["manual_add", "manual_deduct", "customer_payment"].includes(type)) {
      return res.status(400).json({ success: false, message: "Valid wallet type and amount are required" });
    }
    if (!notes && !isCustomerPayment) {
      return res.status(400).json({ success: false, message: "Manual wallet adjustment requires notes" });
    }
    const paymentMethod = String(req.body.payment_method || "cash").trim().toLowerCase();
    const allowedPaymentMethods = new Set(["cash", "card", "bank_transfer", "vodafone_cash", "instapay", "wallet"]);
    if (isCustomerPayment && !allowedPaymentMethods.has(paymentMethod)) {
      return res.status(400).json({ success: false, message: "طريقة الدفع غير صحيحة" });
    }

    let outstandingBalance = 0;
    if (isCustomerPayment) {
      const [walletRows, personalRows, creditRows, paymentRows] = await Promise.all([
        getCustomerWalletTransactions(customerId, tenantId),
        getCustomerPersonalTransactions(customerId, tenantId),
        getCustomerCreditSaleTransactions(customerId, tenantId),
        getCustomerPaymentTransactions(customerId, tenantId),
      ]);
      outstandingBalance = [...walletRows, ...personalRows, ...creditRows, ...paymentRows]
        .reduce((sum, item) => sum + Number(item.amount || 0), 0);
      if (amount > outstandingBalance + 0.009) {
        return res.status(400).json({
          success: false,
          message: "قيمة الدفعة أكبر من المبلغ المستحق على العميل",
          outstanding_balance: Number(outstandingBalance.toFixed(2)),
        });
      }
    }

    await client.query("BEGIN");
    let wallet = null;
    let customerPayment = null;
    if (isCustomerPayment) {
      await ensureCustomerPaymentsSchema(client);
      const paymentDate = req.body.payment_date ? new Date(req.body.payment_date) : new Date();
      if (Number.isNaN(paymentDate.getTime())) {
        const error = new Error("تاريخ الدفعة غير صحيح");
        error.status = 400;
        throw error;
      }
      const inserted = await client.query(
        `
        INSERT INTO customer_payments (
          tenant_id, customer_id, amount, payment_method, reference, notes, payment_date, created_by, created_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
        RETURNING *
        `,
        [
          tenantId,
          customerId,
          amount,
          paymentMethod,
          String(req.body.reference || "").trim() || null,
          notes,
          paymentDate,
          req.user?.id || null,
        ]
      );
      customerPayment = inserted.rows[0];
      await reconcileCustomerInvoicePayments(client, { tenantId, customerId });
      wallet = {
        amount: -amount,
        beforeBalance: Number(outstandingBalance.toFixed(2)),
        afterBalance: Number((outstandingBalance - amount).toFixed(2)),
        balance: Number((outstandingBalance - amount).toFixed(2)),
      };
    } else {
      wallet = await recordWalletTransaction(client, {
        tenantId,
        customerId,
        type,
        amount: type === "manual_deduct" ? -amount : amount,
        referenceType: "manual",
        referenceId: customerId,
        notes,
        userId: req.user?.id || null,
      });
    }
    if (isCustomerPayment) {
      const cashAccountCode = ["card", "bank_transfer"].includes(paymentMethod)
        ? "1010"
        : ["vodafone_cash", "instapay", "wallet"].includes(paymentMethod)
          ? "1011"
          : "1000";
      await recordFinancialAccountActivity(client, {
        tenantId,
        paymentMethod,
        entryType: "in",
        sourceType: "customer_payment",
        sourceId: customerPayment.id,
        amount,
        notes: notes || `دفعة من العميل ${customer.name}`,
        createdBy: req.user?.id || null,
        idempotent: false,
      });
      await createJournalEntry(client, {
        tenantId,
        entryNumber: `CP-${customerId}-${Date.now()}`,
        description: `دفعة من العميل ${customer.name}`,
        referenceType: "customer_payment",
        referenceId: customerPayment.id,
        createdBy: req.user?.id || null,
        notes: notes || `دفعة عميل - ${paymentMethod}`,
        lines: [
          { account_code: cashAccountCode, debit: amount, credit: 0, notes },
          { account_code: "1100", debit: 0, credit: amount, notes },
        ],
      });
    }
    await client.query("COMMIT");
    return res.status(200).json({ success: true, wallet, payment: customerPayment, transaction_type: type });
  } catch (error) {
    await client.query("ROLLBACK");
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to update wallet" });
  } finally {
    client.release();
  }
};

export const previewCustomerImport = async (req, res) => {
  try {
    const pointsMode = normalizePointsMode(req.body?.pointsMode || req.body?.points_mode);
    await ensureCustomerImportSchema(pool);
    const columns = await getCustomerColumns();
    const tenantId = await resolveImportTenantId(req, columns);
    const rows = parseCustomersImportFile(req.file);
    const analysis = await analyzeCustomerImportRows(pool, rows, tenantId);
    return res.status(200).json({
      success: true,
      dry_run: true,
      file_name: req.file?.originalname || "",
      points_mode: pointsMode,
      summary: analysis.summary,
      invalid_rows: analysis.invalid_rows.slice(0, 100),
      error_report_csv: analysis.error_report_csv,
    });
  } catch (error) {
    console.error("[customers-import:preview-error]", {
      message: error?.message || String(error),
      details: error?.details || null,
    });
    return res.status(error.status || 500).json({
      success: false,
      message: error.message || "Failed to preview customer import",
      details: error.details || null,
    });
  }
};

export const importCustomers = async (req, res) => {
  const client = await pool.connect();
  try {
    const fileName = req.file?.originalname || "customers-import";
    const pointsMode = normalizePointsMode(req.body?.pointsMode || req.body?.points_mode);
    await ensureCustomerImportSchema(client);
    const columns = await getCustomerColumns();
    const tenantId = await resolveImportTenantId(req, columns);
    const rows = parseCustomersImportFile(req.file);
    const analysis = await analyzeCustomerImportRows(client, rows, tenantId);

    let createdCount = 0;
    let updatedCount = 0;
    let importedPoints = 0;

    await client.query("BEGIN");
    for (const row of analysis.rows) {
      let customerId = null;
      if (row.existing_customer) {
        customerId = await updateImportedCustomer(client, columns, tenantId, row);
        updatedCount += 1;
      } else {
        customerId = await insertImportedCustomer(client, columns, tenantId, row);
        createdCount += 1;
      }

      const pointResult = await applyImportedLegacyPoints(client, {
        tenantId,
        customerId,
        points: row.points,
        pointsMode,
        userId: req.user?.id || null,
        fileName,
      });
      importedPoints += Number(pointResult?.delta || 0);
    }

    const audit = await client.query(
      `
      INSERT INTO customer_import_audit_logs (
        tenant_id, file_name, imported_by, created_count, updated_count,
        skipped_count, invalid_count, duplicate_phone_count, total_rows, total_points_imported, points_mode
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      RETURNING *
      `,
      [
        tenantId,
        fileName,
        req.user?.id || null,
        createdCount,
        updatedCount,
        analysis.invalid_rows.length,
        analysis.invalid_rows.length,
        analysis.summary.duplicate_phones,
        analysis.summary.total_rows,
        Number(importedPoints.toFixed(2)),
        pointsMode,
      ]
    );

    await client.query("COMMIT");
    return res.status(200).json({
      success: true,
      dry_run: false,
      file_name: fileName,
      points_mode: pointsMode,
      summary: {
        ...analysis.summary,
        created_count: createdCount,
        updated_count: updatedCount,
        skipped_invalid_count: analysis.invalid_rows.length,
        total_points_imported: Number(importedPoints.toFixed(2)),
      },
      audit_log: audit.rows[0] || null,
      invalid_rows: analysis.invalid_rows.slice(0, 100),
      error_report_csv: analysis.error_report_csv,
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => null);
    console.error("[customers-import:import-error]", {
      message: error?.message || String(error),
      details: error?.details || null,
      code: error?.code || null,
    });
    return res.status(error.status || 500).json({
      success: false,
      message: error.message || "Failed to import customers",
      details: error.details || null,
      code: error.code || null,
    });
  } finally {
    client.release();
  }
};

export const listCustomers = async (req, res) => {
  try {
    await ensureCustomerSchema();
    const tenantId = isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id);
    const rawPage = Number(req.query.page);
    const rawLimit = Number(req.query.limit);
    const page = Number.isFinite(rawPage) && rawPage > 0 ? Math.floor(rawPage) : 1;
    const limit = Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(200, Math.floor(rawLimit))
      : 50;
    const search = String(req.query.search || "").trim();
    const offset = (page - 1) * limit;
    const columns = await getCustomerColumns();
    const selectSql = buildSelectSql(columns);

    if (!selectSql) {
      return res.status(500).json({
        success: false,
        message: "Customers table columns are not configured correctly",
      });
    }

    const where = [];
    const params = [];
    const searchFilter = search ? buildCustomerSearch(columns, search, params) : null;
    if (search) {
      where.push(searchFilter.clause);
    }
    if (columns.tenantIdColumn && tenantId !== null) {
      where.push(`tenant_id = $${params.length + 1}::bigint`);
      params.push(tenantId);
    }
    const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    if (search) {
      console.log("[customers-search]", {
        tenant_id: tenantId,
        search,
        page,
        limit,
        where: whereSql,
        param_count: params.length,
      });
    }

    const customers = await pool.query(
      `
      ${selectSql}
      ${whereSql}
      ORDER BY ${searchFilter ? `${searchFilter.orderSql},` : ""} id DESC
      LIMIT $${params.length + 1}::int
      OFFSET $${params.length + 2}::int
      `,
      [...params, limit, offset]
    );

    const total = await pool.query(
      `
      SELECT COUNT(*)
      FROM customers
      ${whereSql}
      `,
      params
    );

    const normalizedRows = customers.rows.map(normalizeCustomerRow);
    const { counts: usableOrderCounts, source: ordersCountSource } = await getUsableCustomerOrderCounts({
      customerIds: normalizedRows.map((customer) => customer.id),
      tenantId,
    });
    const data = normalizedRows.map((customer) => {
      const invoicesCount = usableOrderCounts.get(String(customer.id)) ?? 0;
      return {
        ...customer,
        total_orders: invoicesCount,
        orders_count: invoicesCount,
        invoices_count: invoicesCount,
        orders_count_query_source: ordersCountSource,
      };
    });

    if (search || data.some((customer) => Number(customer.loyalty_points || 0) > 0 && Number(customer.invoices_count || 0) === 0)) {
      data.forEach((customer) => {
        console.log("[pos-customer-summary]", {
          customer_id: customer.id,
          wallet_balance: customer.wallet_balance,
          loyalty_points: customer.loyalty_points,
          loyalty_tier: customer.loyalty_tier,
          invoices_count: customer.invoices_count,
          orders_count_query_source: customer.orders_count_query_source,
          tenant_id: tenantId,
          branch_id: req.query.branch_id || null,
        });
      });
    }

    res.status(200).json({
      success: true,
      customers: data,
      total: Number(total.rows[0].count),
      page,
      limit,
      hasMore: offset + data.length < Number(total.rows[0].count),
      data,
      pagination: {
        total: Number(total.rows[0].count),
        page,
        limit,
        totalPages: Math.ceil(Number(total.rows[0].count) / limit),
        hasMore: offset + data.length < Number(total.rows[0].count),
      },
    });
  } catch (error) {
    console.error("[customers] list error", error);
    res.status(500).json({
      success: false,
      message: "Failed To Fetch Customers",
      error: error.message,
    });
  }
};

export const createCustomer = async (req, res) => {
  try {
    const tenantId = getTenantId(req, req.user?.tenant_id);
    const columns = await ensureCustomerSchema();
    const selectSql = buildSelectSql(columns);
    const {
      name,
      phone,
      email,
      address,
      notes,
      source,
      customer_source,
      lead_source,
      registration_source,
      marketing_source,
      marketing_platform,
      attribution_type,
      allow_personal_transactions,
      allowPersonalTransactions,
    } = req.body || {};

    const cleanName = String(name || "").trim();
    const cleanPhone = normalizePhoneValue(phone);
    const cleanEmail = String(email || "").trim();
    const cleanAddress = String(address || "").trim();
    const cleanSource = String(customer_source || lead_source || registration_source || source || "").trim();
    const cleanRegistrationSource = String(registration_source || "MANUAL").trim() || "MANUAL";
    const cleanMarketingSource = String(marketing_source || "").trim();
    const cleanMarketingPlatform = String(marketing_platform || "").trim();
    const cleanAttributionType = String(attribution_type || cleanSource || "").trim();
    const allowPersonalTransactionsValue = Boolean(allow_personal_transactions ?? allowPersonalTransactions);

    if (!cleanName) {
      return res.status(400).json({ success: false, message: "Customer name is required" });
    }

    if (!cleanPhone) {
      return res.status(400).json({ success: false, message: "Customer phone is required" });
    }

    if (columns.tenantIdColumn && tenantId === null) {
      return res.status(400).json({ success: false, message: "Tenant context is required" });
    }

    if (!columns.nameColumn || !columns.phoneColumn) {
      return res.status(500).json({
        success: false,
        message: "Customers table columns are not configured correctly",
      });
    }

    const normalizedPhoneDigits = cleanPhone.replace(/\D/g, "");
    const existingClauses = [];
    const existingParams = [];
    if (columns.tenantIdColumn) {
      existingParams.push(tenantId);
      existingClauses.push(`tenant_id = $${existingParams.length}`);
    }
    existingParams.push(normalizedPhoneDigits);
    existingClauses.push(`regexp_replace(COALESCE(${columns.phoneColumn}, ''), '\\D', '', 'g') = $${existingParams.length}`);
    const existingSql = `
      ${selectSql}
      WHERE ${existingClauses.join(" AND ")}
      LIMIT 1
    `;
    const existing = await pool.query(existingSql, existingParams);

    if (existing.rows.length > 0) {
      return res.status(200).json({
        success: true,
        message: "Customer already exists",
        data: normalizeCustomerRow(existing.rows[0]),
      });
    }

    const insertColumns = [];
    const insertValues = [];
    const placeholders = [];

    if (columns.tenantIdColumn) {
      insertColumns.push("tenant_id");
      insertValues.push(tenantId);
      placeholders.push(`$${insertValues.length}`);
    }

    insertColumns.push(columns.nameColumn, columns.phoneColumn);
    insertValues.push(cleanName, cleanPhone);
    placeholders.push(`$${insertValues.length - 1}`, `$${insertValues.length}`);

    if (columns.emailColumn) {
      insertColumns.push(columns.emailColumn);
      insertValues.push(cleanEmail || null);
      placeholders.push(`$${insertValues.length}`);
    }

    if (columns.addressColumn) {
      insertColumns.push(columns.addressColumn);
      insertValues.push(cleanAddress || null);
      placeholders.push(`$${insertValues.length}`);
    }

    if (columns.notesColumn) {
      insertColumns.push(columns.notesColumn);
      insertValues.push(String(notes || "").trim() || null);
      placeholders.push(`$${insertValues.length}`);
    }

    if (columns.customerSourceColumn) {
      insertColumns.push(columns.customerSourceColumn);
      insertValues.push(cleanSource || null);
      placeholders.push(`$${insertValues.length}`);
    }

    if (columns.leadSourceColumn) {
      insertColumns.push(columns.leadSourceColumn);
      insertValues.push(cleanSource || null);
      placeholders.push(`$${insertValues.length}`);
    }

    if (columns.registrationSourceColumn) {
      insertColumns.push(columns.registrationSourceColumn);
      insertValues.push(cleanRegistrationSource);
      placeholders.push(`$${insertValues.length}`);
    }

    if (columns.marketingSourceColumn) {
      insertColumns.push(columns.marketingSourceColumn);
      insertValues.push(cleanMarketingSource || cleanSource || null);
      placeholders.push(`$${insertValues.length}`);
    }

    if (columns.marketingPlatformColumn) {
      insertColumns.push(columns.marketingPlatformColumn);
      insertValues.push(cleanMarketingPlatform || null);
      placeholders.push(`$${insertValues.length}`);
    }

    if (columns.attributionTypeColumn) {
      insertColumns.push(columns.attributionTypeColumn);
      insertValues.push(cleanAttributionType || null);
      placeholders.push(`$${insertValues.length}`);
    }

    if (columns.allowPersonalTransactionsColumn) {
      insertColumns.push(columns.allowPersonalTransactionsColumn);
      insertValues.push(allowPersonalTransactionsValue);
      placeholders.push(`$${insertValues.length}`);
    }

    const insertSql = `
      INSERT INTO customers (${insertColumns.join(", ")})
      VALUES (${placeholders.join(", ")})
      RETURNING id
    `;
    const customer = await pool.query(insertSql, insertValues);

    const createSelectSql = `
      ${selectSql}
      WHERE id = $1
    `;
    const created = await pool.query(createSelectSql, [customer.rows[0].id]);

    return res.status(200).json({
      success: true,
      message: "Customer created successfully",
      data: normalizeCustomerRow(created.rows[0]),
    });
  } catch (error) {
    console.error("[customers] create caught error", error);

    if (String(error?.code || "") === "23505") {
      const columns = await getCustomerColumns();
      const selectSql = buildSelectSql(columns);
      const cleanPhone = normalizePhoneValue(req.body?.phone);
      const normalizedPhoneDigits = cleanPhone.replace(/\D/g, "");

      if (selectSql && columns.phoneColumn && normalizedPhoneDigits) {
        const duplicateClauses = [];
        const duplicateParams = [];
        const tenantId = getTenantId(req, req.user?.tenant_id);

        if (columns.tenantIdColumn) {
          duplicateParams.push(tenantId);
          duplicateClauses.push(`tenant_id = $${duplicateParams.length}`);
        }

        duplicateParams.push(normalizedPhoneDigits);
        duplicateClauses.push(`regexp_replace(COALESCE(${columns.phoneColumn}, ''), '\\D', '', 'g') = $${duplicateParams.length}`);

        const duplicate = await pool.query(
          `
          ${selectSql}
          WHERE ${duplicateClauses.join(" AND ")}
          LIMIT 1
          `,
          duplicateParams
        );

        if (duplicate.rows.length > 0) {
          return res.status(200).json({
            success: true,
            message: "Customer already exists",
            data: normalizeCustomerRow(duplicate.rows[0]),
          });
        }
      }

      return res.status(500).json({
        success: false,
        message: error.message,
        detail: error.detail || null,
        code: error.code || null,
      });
    }

    return res.status(500).json({
      success: false,
      message: error.message,
      detail: error.detail || null,
      code: error.code || null,
      stack: globalThis.process?.env?.NODE_ENV === "development" ? error.stack : undefined,
    });
  }
};

export const updateCustomer = async (req, res) => {
  try {
    await ensureCustomerSchema();
    const tenantId = isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id);
    const { id } = req.params;
    const { name, phone, email, address, allow_personal_transactions, allowPersonalTransactions } = req.body || {};
    const columns = await getCustomerColumns();
    const selectSql = buildSelectSql(columns);
    const cleanName = String(name || "").trim();
    const cleanPhone = normalizePhoneValue(phone);
    const allowPersonalTransactionsValue = Boolean(allow_personal_transactions ?? allowPersonalTransactions);

    if (!cleanName) {
      return res.status(400).json({ success: false, message: "Customer name is required" });
    }

    if (!cleanPhone) {
      return res.status(400).json({ success: false, message: "Customer phone is required" });
    }

    const setClauses = [`${columns.nameColumn} = $1`, `${columns.phoneColumn} = $2`];
    const params = [cleanName, cleanPhone];

    if (columns.emailColumn) {
      params.push(String(email || "").trim() || null);
      setClauses.push(`${columns.emailColumn} = $${params.length}`);
    }

    if (columns.addressColumn) {
      params.push(String(address || "").trim() || null);
      setClauses.push(`${columns.addressColumn} = $${params.length}`);
    }

    if (columns.allowPersonalTransactionsColumn) {
      params.push(allowPersonalTransactionsValue);
      setClauses.push(`${columns.allowPersonalTransactionsColumn} = $${params.length}`);
    }

    if (columns.updatedAtColumn) {
      setClauses.push(`updated_at = CURRENT_TIMESTAMP`);
    }

    params.push(id);
    if (columns.tenantIdColumn) {
      params.push(tenantId);
    }

    const updatedSql = `
      UPDATE customers
      SET ${setClauses.join(", ")}
      WHERE id = $${columns.tenantIdColumn ? params.length - 1 : params.length}
        ${columns.tenantIdColumn ? `AND ($${params.length}::bigint IS NULL OR tenant_id = $${params.length}::bigint)` : ""}
      RETURNING id
    `;

    const updated = await pool.query(updatedSql, params);

    if (updated.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Customer not found" });
    }

    const refreshed = await pool.query(
      `
      ${selectSql}
      WHERE id = $1
      `,
      [id]
    );

    return res.status(200).json({
      success: true,
      message: "Customer updated successfully",
      data: normalizeCustomerRow(refreshed.rows[0]),
    });
  } catch (error) {
    console.error("[customers] update error", error);
    return res.status(500).json({
      success: false,
      message: "Failed To Update Customer",
      error: error.message,
    });
  }
};

export const getCustomerOrders = async (req, res) => {
  try {
    const tenantId = isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id);
    const { id } = req.params;
    const customer = await getCustomerByIdentifier(id, tenantId);

    if (!customer) {
      return res.status(404).json({ success: false, message: "Customer not found" });
    }

    const ordersData = await getCustomerOrdersData(customer.id, tenantId);
    return res.status(200).json({
      success: true,
      data: ordersData.orders,
      metrics: ordersData.metrics,
      favorites: ordersData.favorites,
    });
  } catch (error) {
    console.error("[customers] orders error", error);
    return res.status(200).json({
      success: true,
      data: [],
      metrics: { totalOrders: 0, totalSpend: 0, averageOrder: 0, lastVisit: null },
      favorites: { topCategory: "Not enough data", productType: "Not enough data", sizes: [], colors: [] },
    });
  }
};

export const getCustomerLoyalty = async (req, res) => {
  try {
    const tenantId = isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id);
    const { id } = req.params;
    const customer = await getCustomerById(id, tenantId);

    if (!customer) {
      return res.status(404).json({ success: false, message: "Customer not found" });
    }

    const loyalty = await getCustomerLoyaltySummary(pool, id, tenantId, 8);
    return res.status(200).json({ success: true, data: loyalty, loyalty });
  } catch (error) {
    console.error("[customers] loyalty error", error);
    return res.status(200).json({
      success: true,
      data: {
        tier: "Bronze",
        available_points: 0,
        wallet_balance: 0,
        points_to_next_tier: 500,
        progress: 0,
        transactions: [],
      },
    });
  }
};

export const getCustomerLoyaltyHistory = async (req, res) => {
  try {
    const tenantId = isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id);
    const { id } = req.params;
    const customer = await getCustomerById(id, tenantId);
    if (!customer) {
      return res.status(404).json({ success: false, message: "Customer not found" });
    }

    const loyalty = await getCustomerLoyaltySummary(pool, id, tenantId, 50);
    return res.status(200).json({ success: true, history: loyalty.recent_history, data: loyalty.recent_history });
  } catch (error) {
    console.error("[customers] loyalty history error", error);
    return res.status(500).json({ success: false, message: "Failed to load loyalty history" });
  }
};

export const getCustomerProfile = async (req, res) => {
  try {
    const tenantId = isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id);
    const { id } = req.params;
    const customer = await getCustomerByIdentifier(id, tenantId);

    if (!customer) {
      return res.status(404).json({ success: false, message: "Customer not found" });
    }

    const [ordersData, loyalty] = await Promise.all([
      getCustomerOrdersData(customer.id, tenantId),
      getCustomerLoyaltyData(customer.id, tenantId, customer),
    ]);

    const notes = [
      customer.notes
        ? {
            id: "customer-note",
            type: "Manual note",
            text: customer.notes,
            created_at: customer.created_at,
          }
        : null,
      Number(ordersData.metrics.totalSpend || 0) >= 5000
        ? {
            id: "vip-note",
            type: "VIP note",
            text: "High-value customer. Review loyalty benefits before checkout.",
            created_at: ordersData.metrics.lastVisit,
          }
        : null,
      {
        id: "preference-note",
        type: "Preference",
        text: ordersData.favorites.topCategory === "Not enough data"
          ? "No preferences detected yet."
          : `Usually buys ${ordersData.favorites.topCategory}.`,
        created_at: ordersData.metrics.lastVisit || customer.created_at,
      },
      ...(Array.isArray(loyalty.transactions) ? loyalty.transactions.slice(0, 4).map((item) => ({
        id: `loyalty-${item.id}`,
        type: "Loyalty",
        text: item.description || `${item.transaction_type} ${Number(item.points || 0)} points`,
        created_at: item.created_at,
      })) : []),
      ...(Array.isArray(loyalty.wallet_transactions) ? loyalty.wallet_transactions.slice(0, 4).map((item) => ({
        id: `wallet-${item.id}`,
        type: "Wallet",
        text: item.description || `${item.transaction_type} ${Number(item.amount || 0)}`,
        created_at: item.created_at,
      })) : []),
    ].filter(Boolean);

    return res.status(200).json({
      success: true,
      data: {
        customer: { ...customer, purchase_preferences: ordersData.favorites },
        metrics: ordersData.metrics,
        orders: ordersData.orders,
        favorites: ordersData.favorites,
        loyalty,
        notes,
      },
    });
  } catch (error) {
    console.error("[customers] profile error", error);
    return res.status(500).json({
      success: false,
      message: "Failed to load customer profile",
      error: error.message,
    });
  }
};

export const deleteCustomer = async (req, res) => {
  try {
    const columns = await ensureCustomerSchema();
    const tenantId = isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id);
    const { id } = req.params;
    const params = [id];

    if (columns.tenantIdColumn) {
      params.push(tenantId);
    }

    const deleted = await pool.query(
      `
      DELETE FROM customers
      WHERE id = $1
        ${columns.tenantIdColumn ? "AND ($2::bigint IS NULL OR tenant_id = $2::bigint)" : ""}
      RETURNING id
      `,
      params
    );

    if (deleted.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Customer Not Found" });
    }

    return res.status(200).json({ success: true, message: "Customer Deleted Successfully" });
  } catch (error) {
    console.error("[customers] delete error", error);
    return res.status(500).json({
      success: false,
      message: "Failed To Delete Customer",
      error: error.message,
    });
  }
};
