export const employeePerformanceMock = [
  {
    employee_id: "1",
    employee_name: "Ahmed Saleh",
    employee_email: "ahmed@erp.local",
    role_name: "Cashier",
    total_sales: 124500,
    total_orders: 168,
    average_order_value: 740,
    commission_earned: 3625,
    refunds_impact: 1200,
    shift_name: "Morning Shift",
    branch_name: "Downtown Branch",
  },
  {
    employee_id: "2",
    employee_name: "Mona Hassan",
    employee_email: "mona@erp.local",
    role_name: "Sales Agent",
    total_sales: 111200,
    total_orders: 142,
    average_order_value: 783,
    commission_earned: 2980,
    refunds_impact: 900,
    shift_name: "Evening Shift",
    branch_name: "Airport Branch",
  },
];

export const employeeCommissionMock = [
  {
    id: "c1",
    employee_id: "1",
    employee_name: "Ahmed Saleh",
    invoice_number: "INV-100120",
    sale_amount: 1200,
    commission_amount: 36,
    rule_type: "percentage",
    scope_type: "global",
    status: "earned",
  },
  {
    id: "c2",
    employee_id: "2",
    employee_name: "Mona Hassan",
    invoice_number: "INV-100118",
    sale_amount: 900,
    commission_amount: 27,
    rule_type: "percentage",
    scope_type: "global",
    status: "earned",
  },
];

export const employeeRuleMock = [
  {
    id: "r1",
    name: "Default Sales Commission",
    scope_type: "global",
    rule_type: "percentage",
    value: 3,
    apply_to: "sale",
    priority: 10,
    is_active: true,
  },
];

export const employeeSummaryMock = {
  totalSales: 235700,
  totalOrders: 310,
  totalCommission: 6605,
  bestCashier: "Ahmed Saleh",
  highestAverageOrder: {
    employee_name: "Mona Hassan",
    average_order_value: 783,
  },
};
