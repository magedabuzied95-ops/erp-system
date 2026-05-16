import db from "../database/db.js";
import { getTenantId, isSuperAdminUser } from "../utils/requestScope.js";
import { getCommissionSnapshot, pickCommissionRule } from "../utils/employeeAnalytics.js";

const safeQuery = async (client, text, params = []) => {
  try {
    return await client.query(text, params);
  } catch (error) {
    console.warn("Employee analytics query failed:", error.message);
    return { rows: [] };
  }
};

const buildRangeClause = (alias, startDate, endDate, params) => {
  const parts = [];

  if (startDate) {
    params.push(startDate);
    parts.push(`${alias}.created_at >= $${params.length}::date`);
  }

  if (endDate) {
    params.push(endDate);
    parts.push(`${alias}.created_at < ($${params.length}::date + INTERVAL '1 day')`);
  }

  return parts.length ? `AND ${parts.join(" AND ")}` : "";
};

const buildBranchClause = (alias, branchId, params) => {
  if (!branchId) return "";
  params.push(branchId);
  return `AND ${alias}.branch_id = $${params.length}`;
};

const buildShiftClause = (alias, shiftId, params) => {
  if (!shiftId) return "";
  params.push(shiftId);
  return `AND ${alias}.shift_id = $${params.length}`;
};

const baseFilters = (req) => ({
  startDate: req.query.startDate || "",
  endDate: req.query.endDate || "",
  branchId: req.query.branchId || "",
  shiftId: req.query.shiftId || "",
});

const getTenantContext = (req) => ({
  tenantId: isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id),
  userId: req.user?.id || null,
});

const loadCommissionRules = async (client, tenantId) => {
  const result = await safeQuery(
    client,
    `
      SELECT *
      FROM commission_rules
      WHERE ($1::bigint IS NULL OR tenant_id = $1::bigint)
        AND is_active = TRUE
      ORDER BY priority DESC, id DESC
    `,
    [tenantId]
  );

  return result.rows || [];
};

const buildEmployeePerformance = async (client, tenantId, filters = {}) => {
  const params = [tenantId];
  const orderRangeClause = buildRangeClause("o", filters.startDate, filters.endDate, params);
  const orderBranchClause = buildBranchClause("o", filters.branchId, params);
  const orderShiftClause = buildShiftClause("o", filters.shiftId, params);
  const commissionRangeClause = buildRangeClause("ec", filters.startDate, filters.endDate, params);
  const commissionBranchClause = buildBranchClause("ec", filters.branchId, params);
  const commissionShiftClause = buildShiftClause("ec", filters.shiftId, params);

  const ordersResult = await safeQuery(
    client,
    `
      WITH order_rollup AS (
        SELECT
          COALESCE(o.sales_employee_id, o.cashier_id, o.created_by) AS employee_id,
          COUNT(*)::int AS total_orders,
          COALESCE(SUM(o.total), 0) AS total_sales,
          COALESCE(AVG(o.total), 0) AS average_order_value,
          COALESCE(SUM(CASE WHEN o.payment_status IN ('paid', 'completed', 'partial', 'partially_paid') THEN o.total ELSE 0 END), 0) AS paid_sales,
          COALESCE(SUM(CASE WHEN o.payment_status IN ('refunded', 'returned', 'cancelled') THEN o.total ELSE 0 END), 0) AS refunds_impact,
          MAX(o.created_at) AS last_order_at
        FROM orders o
        WHERE ($1::bigint IS NULL OR o.tenant_id = $1::bigint)
        ${orderRangeClause}
        ${orderBranchClause}
        ${orderShiftClause}
        GROUP BY COALESCE(o.sales_employee_id, o.cashier_id, o.created_by)
      ),
      commission_rollup AS (
        SELECT
          ec.employee_id,
          COALESCE(SUM(ec.commission_amount), 0) AS commission_earned,
          COUNT(*)::int AS commission_count
        FROM employee_commissions ec
        WHERE ($1::bigint IS NULL OR ec.tenant_id = $1::bigint)
        ${commissionRangeClause}
        ${commissionBranchClause}
        ${commissionShiftClause}
        GROUP BY ec.employee_id
      )
      SELECT
        COALESCE(u.id, order_rollup.employee_id) AS employee_id,
        COALESCE(u.name, 'Unknown Employee') AS employee_name,
        COALESCE(u.email, '') AS employee_email,
        COALESCE(u.phone, '') AS employee_phone,
        COALESCE(r.name, 'staff') AS role_name,
        order_rollup.total_sales,
        order_rollup.total_orders,
        order_rollup.average_order_value,
        order_rollup.paid_sales,
        order_rollup.refunds_impact,
        COALESCE(commission_rollup.commission_earned, 0) AS commission_earned,
        order_rollup.last_order_at
      FROM order_rollup
      LEFT JOIN users u ON u.id = order_rollup.employee_id
      LEFT JOIN roles r ON r.id = u.role_id
      LEFT JOIN commission_rollup ON commission_rollup.employee_id = order_rollup.employee_id
      ORDER BY order_rollup.total_sales DESC, commission_rollup.commission_earned DESC
    `,
    params
  );

  const employeeRows = ordersResult.rows || [];

  const shiftParams = [tenantId];
  const shiftRangeClause = buildRangeClause("o", filters.startDate, filters.endDate, shiftParams);
  const shiftBranchClause = buildBranchClause("o", filters.branchId, shiftParams);
  const shiftResult = await safeQuery(
    client,
    `
      SELECT
        COALESCE(o.shift_id, 0) AS shift_id,
        COALESCE(c.name, 'Unassigned Shift') AS shift_name,
        COUNT(*)::int AS total_orders,
        COALESCE(SUM(o.total), 0) AS total_sales,
        COALESCE(AVG(o.total), 0) AS average_order_value
      FROM orders o
      LEFT JOIN cashbox c ON c.id = o.shift_id
      WHERE ($1::bigint IS NULL OR o.tenant_id = $1::bigint)
      ${shiftRangeClause}
      ${shiftBranchClause}
      GROUP BY COALESCE(o.shift_id, 0), c.name
      ORDER BY total_sales DESC
    `,
    shiftParams
  );

  const branchParams = [tenantId];
  const branchRangeClause = buildRangeClause("o", filters.startDate, filters.endDate, branchParams);
  const branchResult = await safeQuery(
    client,
    `
      SELECT
        COALESCE(o.branch_id, 0) AS branch_id,
        COALESCE(w.name, 'Unassigned Branch') AS branch_name,
        COUNT(*)::int AS total_orders,
        COALESCE(SUM(o.total), 0) AS total_sales,
        COALESCE(AVG(o.total), 0) AS average_order_value
      FROM orders o
      LEFT JOIN warehouses w ON w.id = o.branch_id
      WHERE ($1::bigint IS NULL OR o.tenant_id = $1::bigint)
      ${branchRangeClause}
      GROUP BY COALESCE(o.branch_id, 0), w.name
      ORDER BY total_sales DESC
    `,
    branchParams
  );

  const totals = employeeRows.reduce(
    (acc, row) => {
      acc.totalSales += Number(row.total_sales || 0);
      acc.totalOrders += Number(row.total_orders || 0);
      acc.totalCommission += Number(row.commission_earned || 0);
      return acc;
    },
    { totalSales: 0, totalOrders: 0, totalCommission: 0 }
  );

  return {
    items: employeeRows,
    shiftPerformance: shiftResult.rows || [],
    branchPerformance: branchResult.rows || [],
    summary: {
      totalSales: totals.totalSales,
      totalOrders: totals.totalOrders,
      totalCommission: totals.totalCommission,
      bestCashier: employeeRows[0]?.employee_name || "n/a",
      highestAverageOrder:
        employeeRows.slice().sort((a, b) => Number(b.average_order_value || 0) - Number(a.average_order_value || 0))[0] || null,
    },
  };
};

export const getSalesPerformance = async (req, res) => {
  const client = await db.connect();

  try {
    const { tenantId } = getTenantContext(req);
    const filters = baseFilters(req);
    const performance = await buildEmployeePerformance(client, tenantId, filters);

    return res.json({
      success: true,
      salesPerformance: performance.items,
      shiftPerformance: performance.shiftPerformance,
      branchPerformance: performance.branchPerformance,
      summary: performance.summary,
    });
  } catch (error) {
    console.log("Employee sales performance error:", error);
    return res.status(500).json({ success: false, message: "Unable to load employee sales performance" });
  } finally {
    client.release();
  }
};

export const getCommissions = async (req, res) => {
  const client = await db.connect();

  try {
    const { tenantId } = getTenantContext(req);
    const filters = baseFilters(req);

    const params = [tenantId];
    const rules = await loadCommissionRules(client, tenantId);
    const commissionsResult = await safeQuery(
      client,
      `
        SELECT
          ec.*,
          COALESCE(u.name, 'Unknown Employee') AS employee_name,
          COALESCE(o.invoice_number, '') AS invoice_number
        FROM employee_commissions ec
        LEFT JOIN users u ON u.id = ec.employee_id
        LEFT JOIN orders o ON o.id = ec.order_id
        WHERE ($1::bigint IS NULL OR ec.tenant_id = $1::bigint)
        ${buildRangeClause("ec", filters.startDate, filters.endDate, params)}
        ${buildBranchClause("ec", filters.branchId, params)}
        ${buildShiftClause("ec", filters.shiftId, params)}
        ORDER BY ec.created_at DESC
      `,
      params
    );

    const totals = (commissionsResult.rows || []).reduce(
      (acc, row) => {
        acc.commissionEarned += Number(row.commission_amount || 0);
        acc.commissionCount += 1;
        return acc;
      },
      { commissionEarned: 0, commissionCount: 0 }
    );

    return res.json({
      success: true,
      rules,
      commissions: commissionsResult.rows || [],
      summary: {
        totalCommission: totals.commissionEarned,
        totalCommissionRows: totals.commissionCount,
      },
    });
  } catch (error) {
    console.log("Employee commissions error:", error);
    return res.status(500).json({ success: false, message: "Unable to load employee commissions" });
  } finally {
    client.release();
  }
};

export const getTopPerformers = async (req, res) => {
  const client = await db.connect();

  try {
    const { tenantId } = getTenantContext(req);
    const filters = baseFilters(req);
    const performance = await buildEmployeePerformance(client, tenantId, filters);
    const topPerformers = [...performance.items]
      .sort((a, b) => Number(b.total_sales || 0) - Number(a.total_sales || 0))
      .slice(0, 10);

    return res.json({
      success: true,
      topPerformers,
      summary: performance.summary,
      shiftPerformance: performance.shiftPerformance,
      branchPerformance: performance.branchPerformance,
    });
  } catch (error) {
    console.log("Employee top performers error:", error);
    return res.status(500).json({ success: false, message: "Unable to load top performers" });
  } finally {
    client.release();
  }
};

export const getCommissionRules = async (req, res) => {
  const client = await db.connect();

  try {
    const { tenantId } = getTenantContext(req);
    const result = await safeQuery(
      client,
      `
        SELECT *
        FROM commission_rules
        WHERE ($1::bigint IS NULL OR tenant_id = $1::bigint)
        ORDER BY priority DESC, id DESC
      `,
      [tenantId]
    );

    return res.json({ success: true, rules: result.rows || [] });
  } catch (error) {
    console.log("Commission rules error:", error);
    return res.status(500).json({ success: false, message: "Unable to load commission rules" });
  } finally {
    client.release();
  }
};

export const createCommissionRule = async (req, res) => {
  const client = await db.connect();

  try {
    const { tenantId, userId } = getTenantContext(req);
    const {
      name,
      scope_type = "global",
      scope_id = null,
      rule_type = "percentage",
      value = 0,
      apply_to = "sale",
      priority = 0,
      is_active = true,
    } = req.body || {};

    if (!name) {
      return res.status(400).json({ success: false, message: "Rule name is required" });
    }

    const result = await client.query(
      `
        INSERT INTO commission_rules (
          tenant_id,
          name,
          scope_type,
          scope_id,
          rule_type,
          value,
          apply_to,
          priority,
          is_active,
          created_by
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        RETURNING *
      `,
      [tenantId, name, scope_type, scope_id, rule_type, value, apply_to, priority, is_active, userId]
    );

    return res.status(201).json({ success: true, rule: result.rows[0] });
  } catch (error) {
    console.log("Create commission rule error:", error);
    return res.status(500).json({ success: false, message: "Unable to create commission rule" });
  } finally {
    client.release();
  }
};

export const updateCommissionRule = async (req, res) => {
  const client = await db.connect();

  try {
    const { tenantId } = getTenantContext(req);
    const { id } = req.params;
    const fields = req.body || {};

    const existing = await client.query(
      `
        SELECT *
        FROM commission_rules
        WHERE id = $1
          AND ($2::bigint IS NULL OR tenant_id = $2::bigint)
        LIMIT 1
      `,
      [id, tenantId]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Rule not found" });
    }

    const current = existing.rows[0];
    const next = {
      name: fields.name ?? current.name,
      scope_type: fields.scope_type ?? current.scope_type,
      scope_id: fields.scope_id ?? current.scope_id,
      rule_type: fields.rule_type ?? current.rule_type,
      value: fields.value ?? current.value,
      apply_to: fields.apply_to ?? current.apply_to,
      priority: fields.priority ?? current.priority,
      is_active: fields.is_active ?? current.is_active,
    };

    const result = await client.query(
      `
        UPDATE commission_rules
        SET name = $1,
            scope_type = $2,
            scope_id = $3,
            rule_type = $4,
            value = $5,
            apply_to = $6,
            priority = $7,
            is_active = $8,
            updated_at = NOW()
        WHERE id = $9
          AND ($10::bigint IS NULL OR tenant_id = $10::bigint)
        RETURNING *
      `,
      [
        next.name,
        next.scope_type,
        next.scope_id,
        next.rule_type,
        next.value,
        next.apply_to,
        next.priority,
        next.is_active,
        id,
        tenantId,
      ]
    );

    return res.json({ success: true, rule: result.rows[0] });
  } catch (error) {
    console.log("Update commission rule error:", error);
    return res.status(500).json({ success: false, message: "Unable to update commission rule" });
  } finally {
    client.release();
  }
};

export const recordEmployeeAnalytics = async (client, {
  tenantId,
  orderId,
  orderItems = [],
  cashierId = null,
  salesEmployeeId = null,
  shiftId = null,
  branchId = null,
  paymentStatus = "unpaid",
  userId = null,
}) => {
  const employeeId = salesEmployeeId || cashierId || null;
  if (!employeeId) {
    return { recorded: false, commissionRows: [] };
  }

  const rules = await loadCommissionRules(client, tenantId);
  let totalSales = 0;
  let totalCommission = 0;
  const commissionRows = [];

  for (const item of orderItems) {
    const saleAmount = Number(item.total_amount ?? Number(item.sale_price || 0) * Number(item.quantity || 0));
    totalSales += saleAmount;
    const rule = pickCommissionRule(rules, item);
    const commissionSnapshot = getCommissionSnapshot(rule, saleAmount, Number(item.quantity || 0));
    totalCommission += commissionSnapshot.commissionAmount;

    if (commissionSnapshot.commissionAmount > 0) {
      const commissionResult = await client.query(
        `
          INSERT INTO employee_commissions (
            tenant_id,
            employee_id,
            order_id,
            order_item_id,
            product_id,
            category_id,
            commission_rule_id,
            rule_type,
            scope_type,
            sale_amount,
            commission_amount,
            status,
            branch_id,
            shift_id,
            created_by
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
          RETURNING *
        `,
        [
          tenantId,
          employeeId,
          orderId,
          item.order_item_id || null,
          item.product_id || null,
          item.category_id || null,
          rule?.id || null,
          commissionSnapshot.ruleType,
          commissionSnapshot.scopeType,
          saleAmount,
          commissionSnapshot.commissionAmount,
          paymentStatus === "paid" || paymentStatus === "completed" || paymentStatus === "partial" || paymentStatus === "partially_paid" ? "earned" : "pending",
          branchId,
          shiftId,
          userId,
        ]
      );
      commissionRows.push(commissionResult.rows[0]);
    }
  }

  await client.query(
    `
      INSERT INTO employee_sales (
        tenant_id,
        order_id,
        cashier_id,
        sales_employee_id,
        shift_id,
        branch_id,
        total_sales,
        total_orders,
        commission_amount,
        refund_amount,
        status
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,1,$8,0,$9)
      ON CONFLICT (tenant_id, order_id) DO UPDATE
      SET cashier_id = EXCLUDED.cashier_id,
          sales_employee_id = EXCLUDED.sales_employee_id,
          shift_id = EXCLUDED.shift_id,
          branch_id = EXCLUDED.branch_id,
          total_sales = EXCLUDED.total_sales,
          commission_amount = EXCLUDED.commission_amount,
          status = EXCLUDED.status,
          updated_at = NOW()
    `,
    [
      tenantId,
      orderId,
      cashierId,
      salesEmployeeId || cashierId,
      shiftId,
      branchId,
      totalSales,
      totalCommission,
      paymentStatus === "paid" || paymentStatus === "completed" ? "earned" : "recorded",
    ]
  );

  return {
    recorded: true,
    totalSales,
    totalCommission,
    commissionRows,
  };
};
