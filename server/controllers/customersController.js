import pool from "../database/db.js";
import { getTenantId, isSuperAdminUser } from "../utils/requestScope.js";
import { getPhoneSearchVariants, normalizePhone, phoneSqlDigits } from "../utils/phoneSearch.js";
import { ensureWalletSchema, recordWalletTransaction } from "../services/walletService.js";
import { getCustomerLoyaltySummary } from "../services/loyaltyService.js";

let customerColumnsPromise = null;

const normalizePhoneValue = normalizePhone;

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
  name: row.name ?? "",
  phone: row.phone ?? "",
  mobile: row.mobile ?? "",
  whatsapp: row.whatsapp ?? "",
  email: row.email ?? "",
  address: row.address ?? "",
  balance: Number(row.balance ?? row.wallet_balance ?? 0),
  notes: row.notes ?? "",
  created_at: row.created_at ?? null,
  wallet_balance: Number(row.wallet_balance ?? row.balance ?? 0),
  loyalty_points: Number(row.loyalty_points ?? 0),
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
};

const normalizeWalletTransactionRow = (row = {}) => ({
  id: row.id,
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
          walletBalanceColumn: columns.includes("wallet_balance") ? "wallet_balance" : null,
          loyaltyPointsColumn: columns.includes("loyalty_points") ? "loyalty_points" : null,
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
  const statusExpr = columns.statusColumn ? columns.statusColumn : "'active'";
  const updatedAtExpr = columns.updatedAtColumn ? columns.updatedAtColumn : "created_at";

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
      ${loyaltyExpr} AS loyalty_points,
      ${statusExpr} AS status,
      created_at,
      ${updatedAtExpr} AS updated_at
    FROM customers
  `;
};

const buildCustomerSearch = (columns, search, params) => {
  const cleanSearch = String(search || "").trim();
  const searchPattern = `%${cleanSearch.toLowerCase()}%`;
  const phoneColumns = [columns.phoneColumn, columns.mobileColumn, columns.whatsappColumn].filter(Boolean);
  const phoneVariants = getPhoneSearchVariants(cleanSearch);

  params.push(cleanSearch.toLowerCase());
  const rawParam = `$${params.length}`;
  params.push(searchPattern);
  const textParam = `$${params.length}`;
  const clauses = [`LOWER(${columns.nameColumn}) LIKE ${textParam}`];

  for (const column of phoneColumns) {
    clauses.push(`LOWER(COALESCE(${column}, '')) LIKE ${textParam}`);
  }

  const relevance = [
    `WHEN LOWER(${columns.nameColumn}) = ${rawParam} THEN 0`,
    `WHEN LOWER(${columns.nameColumn}) LIKE ${rawParam} || '%' THEN 3`,
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

  relevance.push(`WHEN LOWER(${columns.nameColumn}) LIKE ${textParam} THEN 5`);

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
  if (!columns.addressColumn) {
    missingStatements.push(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS address TEXT`);
  }
  if (!columns.createdAtColumn) {
    missingStatements.push(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP`);
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

const getCustomerOrdersData = async (customerId, tenantId) => {
  if (!(await tableExists("orders"))) {
    return {
      metrics: { totalOrders: 0, totalSpend: 0, averageOrder: 0, lastVisit: null },
      orders: [],
      favorites: { topCategory: "Not enough data", productType: "Not enough data", sizes: [], colors: [] },
    };
  }

  const hasTenantId = await columnExists("orders", "tenant_id");
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

  let favorites = { topCategory: "Not enough data", productType: "Not enough data", sizes: [], colors: [] };
  if (hasItems) {
    try {
      const favoritesResult = await pool.query(
        `
        SELECT
          COALESCE(p.category, p.category_name, p.main_category_name, oi.category, 'Not enough data') AS top_category,
          COALESCE(p.product_type, p.type, oi.product_type, 'Not enough data') AS product_type,
          ARRAY_REMOVE(ARRAY_AGG(DISTINCT COALESCE(oi.size, pv.size)), NULL) AS sizes,
          ARRAY_REMOVE(ARRAY_AGG(DISTINCT COALESCE(oi.color, pv.color)), NULL) AS colors
        FROM orders o
        LEFT JOIN order_items oi ON oi.order_id = o.id
        LEFT JOIN products p ON p.id = oi.product_id
        LEFT JOIN product_variants pv ON pv.id = oi.variant_id
        WHERE ${where.join(" AND ")}
        GROUP BY top_category, product_type
        ORDER BY COUNT(*) DESC
        LIMIT 1
        `,
        params
      );
      const row = favoritesResult.rows[0];
      if (row) {
        favorites = {
          topCategory: row.top_category || "Not enough data",
          productType: row.product_type || "Not enough data",
          sizes: Array.isArray(row.sizes) ? row.sizes.filter(Boolean).slice(0, 5) : [],
          colors: Array.isArray(row.colors) ? row.colors.filter(Boolean).slice(0, 5) : [],
        };
      }
    } catch {
      favorites = { topCategory: "Not enough data", productType: "Not enough data", sizes: [], colors: [] };
    }
  }

  const metrics = metricsResult.rows[0] || {};
  return {
    metrics: {
      totalOrders: Number(metrics.total_orders || 0),
      totalSpend: Number(metrics.total_spend || 0),
      averageOrder: Number(metrics.average_order || 0),
      lastVisit: metrics.last_visit || null,
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

  const previous = await pool.query(
    `
    SELECT after_balance
    FROM wallet_transactions
    WHERE customer_id = $1
      AND ($2::bigint IS NULL OR tenant_id = $2::bigint)
      AND created_at < $3::timestamp
    ORDER BY created_at DESC, id DESC
    LIMIT 1
    `,
    [customerId, tenantId, dateFrom]
  );
  return Number(previous.rows[0]?.after_balance || 0);
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

    const transactions = await getCustomerWalletTransactions(customerId, tenantId, req.query);
    const chronological = [...transactions].reverse();
    const openingBalance = await getStatementOpeningBalance(customerId, tenantId, req.query.date_from);
    const finalBalance = chronological.length
      ? Number(chronological[chronological.length - 1].after_balance || 0)
      : Number(customer.wallet_balance ?? customer.balance ?? 0);
    const totals = chronological.reduce(
      (acc, item) => {
        const amount = Number(item.amount || 0);
        if (item.transaction_type === "order_payment") acc.orders += Math.abs(amount);
        if (["refund", "exchange_credit"].includes(item.transaction_type)) acc.returns += Math.abs(amount);
        if (["loyalty_conversion", "manual_add"].includes(item.transaction_type)) acc.wallet_credits += Math.abs(amount);
        if (item.transaction_type === "order_payment") acc.wallet_payments += Math.abs(amount);
        if (["manual_add", "manual_deduct"].includes(item.transaction_type)) acc.manual_adjustments += amount;
        acc.net += amount;
        return acc;
      },
      { orders: 0, returns: 0, wallet_credits: 0, wallet_payments: 0, manual_adjustments: 0, net: 0 }
    );

    return res.status(200).json({
      success: true,
      data: {
        customer,
        filters: req.query,
        opening_balance: openingBalance,
        final_balance: finalBalance,
        current_balance: Number(customer.wallet_balance ?? customer.balance ?? finalBalance),
        totals,
        rows: chronological,
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

    const tenantId = isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id);
    const customerId = Number(req.params.id);
    const type = String(req.body.transaction_type || req.body.type || "").trim();
    const amount = Math.abs(Number(req.body.amount || 0));
    const notes = String(req.body.notes || req.body.reason || "").trim();
    if (!customerId || !amount || !["manual_add", "manual_deduct"].includes(type)) {
      return res.status(400).json({ success: false, message: "Valid wallet type and amount are required" });
    }
    if (!notes) {
      return res.status(400).json({ success: false, message: "Manual wallet adjustment requires notes" });
    }

    await client.query("BEGIN");
    const wallet = await recordWalletTransaction(client, {
      tenantId,
      customerId,
      type,
      amount: type === "manual_deduct" ? -amount : amount,
      referenceType: "manual",
      referenceId: customerId,
      notes,
      userId: req.user?.id || null,
    });
    await client.query("COMMIT");
    return res.status(200).json({ success: true, wallet });
  } catch (error) {
    await client.query("ROLLBACK");
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to update wallet" });
  } finally {
    client.release();
  }
};

export const listCustomers = async (req, res) => {
  try {
    await ensureCustomerSchema();
    const tenantId = isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id);
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;
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
      where.push(`tenant_id = $${params.length + 1}`);
      params.push(tenantId);
    }
    const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

    const customers = await pool.query(
      `
      ${selectSql}
      ${whereSql}
      ORDER BY ${searchFilter ? `${searchFilter.orderSql},` : ""} id DESC
      LIMIT $${params.length + 1}
      OFFSET $${params.length + 2}
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

    res.status(200).json({
      success: true,
      data: customers.rows.map(normalizeCustomerRow),
      pagination: {
        total: Number(total.rows[0].count),
        page,
        limit,
        totalPages: Math.ceil(Number(total.rows[0].count) / limit),
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
    const { name, phone, email, address, notes } = req.body || {};

    const cleanName = String(name || "").trim();
    const cleanPhone = normalizePhoneValue(phone);
    const cleanEmail = String(email || "").trim();
    const cleanAddress = String(address || "").trim();

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

    return res.status(201).json({
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
    const { name, phone, email, address } = req.body || {};
    const columns = await getCustomerColumns();
    const selectSql = buildSelectSql(columns);
    const cleanName = String(name || "").trim();
    const cleanPhone = normalizePhoneValue(phone);

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
        ${columns.tenantIdColumn ? `AND tenant_id = $${params.length}::bigint` : ""}
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
    const customer = await getCustomerById(id, tenantId);

    if (!customer) {
      return res.status(404).json({ success: false, message: "Customer not found" });
    }

    const ordersData = await getCustomerOrdersData(id, tenantId);
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
    const customer = await getCustomerById(id, tenantId);

    if (!customer) {
      return res.status(404).json({ success: false, message: "Customer not found" });
    }

    const [ordersData, loyalty] = await Promise.all([
      getCustomerOrdersData(id, tenantId),
      getCustomerLoyaltyData(id, tenantId, customer),
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
        customer,
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
