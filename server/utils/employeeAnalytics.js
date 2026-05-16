export const pickCommissionRule = (rules = [], item = {}) => {
  const productId = Number(item.product_id || 0);
  const categoryId = Number(item.category_id || 0);
  const employeeId = Number(item.employee_id || item.sales_employee_id || item.cashier_id || 0);

  const matches = (rule) => {
    const scopeType = String(rule?.scope_type || "global").toLowerCase();
    const scopeId = Number(rule?.scope_id || 0);

    if (scopeType === "global") return true;
    if (scopeType === "product") return scopeId > 0 && scopeId === productId;
    if (scopeType === "category") return scopeId > 0 && scopeId === categoryId;
    if (scopeType === "employee") return scopeId > 0 && scopeId === employeeId;
    return true;
  };

  return [...rules]
    .filter((rule) => rule?.is_active !== false)
    .filter(matches)
    .sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0))[0] || null;
};

export const getCommissionSnapshot = (rule, saleAmount, quantity = 1) => {
  if (!rule) {
    return {
      commissionAmount: 0,
      ruleType: "percentage",
      scopeType: "global",
    };
  }

  const amount = Number(saleAmount || 0);
  const qty = Math.max(1, Number(quantity || 0));
  const ruleType = String(rule.rule_type || "percentage").toLowerCase();
  const scopeType = String(rule.scope_type || "global").toLowerCase();

  const commissionAmount =
    ruleType === "fixed"
      ? Math.max(0, Number(rule.value || 0) * qty)
      : Math.max(0, amount * Number(rule.value || 0) / 100);

  return {
    commissionAmount,
    ruleType,
    scopeType,
  };
};

const safeQuery = async (client, text, params = []) => {
  try {
    return await client.query(text, params);
  } catch (error) {
    console.warn("Employee analytics query failed:", error.message);
    return { rows: [] };
  }
};

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

export const recordEmployeeAnalytics = async (
  client,
  {
    tenantId,
    orderId,
    orderItems = [],
    cashierId = null,
    salesEmployeeId = null,
    shiftId = null,
    branchId = null,
    paymentStatus = "unpaid",
    userId = null,
  }
) => {
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
