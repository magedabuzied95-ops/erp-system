import { getLocalPurchases, normalizePurchase } from "../../purchases/lib/flowStore";
import { mockOrders, normalizeOrder, getReturns } from "../../orders/lib/ordersStore";
export { formatCurrency } from "../../../shared/lib/currency";

const STORAGE_KEYS = {
  cashMovements: "erp.accounting.cash.movements",
  cashShifts: "erp.accounting.cash.shifts",
  expenses: "erp.accounting.expenses",
  income: "erp.accounting.income",
  journalEntries: "erp.accounting.journal.entries",
};

const safeWindow = () => (typeof window !== "undefined" ? window : null);

const readJson = (key, fallback) => {
  const win = safeWindow();
  if (!win) return fallback;
  try {
    const raw = win.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
};

const writeJson = (key, value) => {
  const win = safeWindow();
  if (!win) return;
  win.localStorage.setItem(key, JSON.stringify(value));
};

export const formatDateTime = (value) => {
  if (!value) return "n/a";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
};

export const slugify = (value = "") =>
  String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export const generateCode = (prefix = "FIN") =>
  `${prefix}-${Date.now().toString(36).toUpperCase()}`;

export const seedCashMovements = () => [
  {
    id: "cash-1",
    type: "Cash in",
    amount: 2400,
    note: "POS opening float",
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 20).toISOString(),
  },
  {
    id: "cash-2",
    type: "Cash out",
    amount: 450,
    note: "Petty cash office supplies",
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 8).toISOString(),
  },
];

export const seedCashShifts = () => [
  {
    id: "shift-1",
    status: "Open",
    opened_by: "System",
    opened_at: new Date(Date.now() - 1000 * 60 * 60 * 9).toISOString(),
    opening_balance: 3000,
    expected_balance: 4950,
    counted_balance: null,
  },
];

export const seedExpenses = () => [
  {
    id: "exp-1",
    title: "Office rent",
    category: "Rent",
    amount: 1200,
    method: "Bank transfer",
    status: "Approved",
    note: "Monthly office lease",
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 36).toISOString(),
  },
  {
    id: "exp-2",
    title: "Courier and logistics",
    category: "Logistics",
    amount: 280,
    method: "Cash",
    status: "Pending",
    note: "Daily dispatch support",
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 12).toISOString(),
  },
];

export const seedIncomeEntries = () => [
  {
    id: "inc-1",
    title: "Delivery fee income",
    category: "Service income",
    amount: 180,
    method: "Card",
    note: "Customer charged delivery fee",
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 14).toISOString(),
  },
  {
    id: "inc-2",
    title: "Consulting fee",
    category: "Other income",
    amount: 600,
    method: "Bank transfer",
    note: "Support for partner rollout",
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 50).toISOString(),
  },
];

export const seedJournalEntries = () => [
  {
    id: "jnl-1",
    entry_no: "JE-1001",
    status: "Posted",
    note: "Record sales deposit",
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 18).toISOString(),
    lines: [
      { account: "Cashbox", debit: 1420, credit: 0 },
      { account: "Sales revenue", debit: 0, credit: 1420 },
    ],
  },
  {
    id: "jnl-2",
    entry_no: "JE-1002",
    status: "Draft",
    note: "Accrue supplier invoice",
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 9).toISOString(),
    lines: [
      { account: "Inventory", debit: 3200, credit: 0 },
      { account: "Accounts payable", debit: 0, credit: 3200 },
    ],
  },
];

export const normalizeExpense = (expense) => ({
  ...expense,
  title: expense.title || expense.name || "Expense",
  category: expense.category || "General",
  method: expense.method || "Cash",
  status: expense.status || "Pending",
  amount: Number(expense.amount || 0),
  note: expense.note || expense.notes || "",
  attachment: expense.attachment || "",
  created_at: expense.created_at || new Date().toISOString(),
});

export const normalizeIncomeEntry = (income) => ({
  ...income,
  title: income.title || income.name || "Income",
  category: income.category || "Other income",
  method: income.method || "Cash",
  amount: Number(income.amount || 0),
  note: income.note || income.notes || "",
  created_at: income.created_at || new Date().toISOString(),
});

export const normalizeJournalEntry = (entry) => ({
  ...entry,
  entry_no: entry.entry_no || generateCode("JE"),
  status: entry.status || "Draft",
  note: entry.note || "",
  created_at: entry.created_at || new Date().toISOString(),
  lines: Array.isArray(entry.lines) ? entry.lines : [],
});

export const normalizeCashMovement = (movement) => ({
  ...movement,
  type: movement.type || "Cash in",
  amount: Number(movement.amount || 0),
  note: movement.note || "",
  created_at: movement.created_at || new Date().toISOString(),
});

export const normalizeCashShift = (shift) => ({
  ...shift,
  status: shift.status || "Open",
  opened_at: shift.opened_at || new Date().toISOString(),
  opening_balance: Number(shift.opening_balance || 0),
  expected_balance: Number(shift.expected_balance || shift.opening_balance || 0),
  counted_balance: shift.counted_balance === null ? null : Number(shift.counted_balance || 0),
});

export const getCashMovements = () => readJson(STORAGE_KEYS.cashMovements, seedCashMovements()).map(normalizeCashMovement);
export const saveCashMovements = (items) => writeJson(STORAGE_KEYS.cashMovements, items);

export const getCashShifts = () => readJson(STORAGE_KEYS.cashShifts, seedCashShifts()).map(normalizeCashShift);
export const saveCashShifts = (items) => writeJson(STORAGE_KEYS.cashShifts, items);

export const getExpenses = () => readJson(STORAGE_KEYS.expenses, seedExpenses()).map(normalizeExpense);
export const saveExpenses = (items) => writeJson(STORAGE_KEYS.expenses, items);

export const getIncomeEntries = () => readJson(STORAGE_KEYS.income, seedIncomeEntries()).map(normalizeIncomeEntry);
export const saveIncomeEntries = (items) => writeJson(STORAGE_KEYS.income, items);

export const getJournalEntries = () => readJson(STORAGE_KEYS.journalEntries, seedJournalEntries()).map(normalizeJournalEntry);
export const saveJournalEntries = (items) => writeJson(STORAGE_KEYS.journalEntries, items);

const inRange = (dateValue, start, end) => {
  if (!dateValue) return false;
  const stamp = new Date(dateValue).getTime();
  if (Number.isNaN(stamp)) return false;
  if (start && stamp < start.getTime()) return false;
  if (end && stamp > end.getTime()) return false;
  return true;
};

export const getAccountingSources = () => {
  const orders = mockOrders().map(normalizeOrder);
  const purchases = getLocalPurchases().map(normalizePurchase);
  const expenses = getExpenses();
  const income = getIncomeEntries();
  const journalEntries = getJournalEntries();
  const cashMovements = getCashMovements();
  const cashShifts = getCashShifts();
  const returns = getReturns();
  return { orders, purchases, expenses, income, journalEntries, cashMovements, cashShifts, returns };
};

const groupByMonth = (records, field = "created_at", valueGetter = () => 0) => {
  const map = new Map();
  records.forEach((record) => {
    const date = new Date(record[field] || record.date || record.created_at || new Date().toISOString());
    if (Number.isNaN(date.getTime())) return;
    const key = date.toISOString().slice(0, 7);
    const current = map.get(key) || 0;
    map.set(key, current + Number(valueGetter(record) || 0));
  });
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => ({
      key,
      label: new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" }).format(new Date(`${key}-01T00:00:00Z`)),
      value,
    }));
};

export const buildFinancialSnapshot = (sources, range = "all") => {
  const { orders, purchases, expenses, income, cashMovements, cashShifts, journalEntries, returns } = sources;

  const end = new Date();
  const start = (() => {
    if (range === "7d") return new Date(Date.now() - 1000 * 60 * 60 * 24 * 7);
    if (range === "30d") return new Date(Date.now() - 1000 * 60 * 60 * 24 * 30);
    if (range === "90d") return new Date(Date.now() - 1000 * 60 * 60 * 24 * 90);
    if (range === "12m") return new Date(Date.now() - 1000 * 60 * 60 * 24 * 365);
    return null;
  })();

  const filteredOrders = start ? orders.filter((order) => inRange(order.created_at, start, end)) : orders;
  const filteredPurchases = start ? purchases.filter((purchase) => inRange(purchase.created_at, start, end)) : purchases;
  const filteredExpenses = start ? expenses.filter((expense) => inRange(expense.created_at, start, end)) : expenses;
  const filteredIncome = start ? income.filter((entry) => inRange(entry.created_at, start, end)) : income;
  const filteredCashMovements = start ? cashMovements.filter((movement) => inRange(movement.created_at, start, end)) : cashMovements;
  const filteredCashShifts = start ? cashShifts.filter((shift) => inRange(shift.opened_at || shift.closed_at || shift.created_at, start, end)) : cashShifts;
  const filteredJournalEntries = start ? journalEntries.filter((entry) => inRange(entry.created_at, start, end)) : journalEntries;
  const filteredReturns = start ? returns.filter((entry) => inRange(entry.created_at, start, end)) : returns;

  const revenue = filteredOrders.reduce((sum, order) => sum + Number(order.total || 0), 0);
  const purchaseSpend = filteredPurchases.reduce((sum, purchase) => sum + Number(purchase.total || 0), 0);
  const manualExpenses = filteredExpenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
  const otherIncome = filteredIncome.reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
  const expensesTotal = purchaseSpend + manualExpenses;
  const profit = revenue + otherIncome - expensesTotal;
  const pendingReceivables = filteredOrders
    .filter((order) => !["Paid", "Cancelled", "Refunded"].includes(order.paymentStatus || order.payment_status))
    .reduce((sum, order) => sum + Number(order.total || 0), 0);
  const pendingPayables = filteredPurchases
    .filter((purchase) => !["Paid", "Cancelled"].includes(purchase.payment_status))
    .reduce((sum, purchase) => sum + Number(purchase.total || 0), 0);

  const cashIn = filteredCashMovements
    .filter((movement) => String(movement.type).toLowerCase().includes("in"))
    .reduce((sum, movement) => sum + Number(movement.amount || 0), 0);
  const cashOut = filteredCashMovements
    .filter((movement) => String(movement.type).toLowerCase().includes("out"))
    .reduce((sum, movement) => sum + Number(movement.amount || 0), 0);
  const shift = filteredCashShifts[0] || cashShifts[0] || normalizeCashShift({ status: "Closed", opening_balance: 0, expected_balance: 0 });
  const cashBalance = Number(shift.opening_balance || 0) + cashIn - cashOut;

  const monthlyRevenue = groupByMonth(filteredOrders, "created_at", (order) => Number(order.total || 0));
  const monthlyExpenses = groupByMonth(
    [...filteredPurchases, ...filteredExpenses],
    "created_at",
    (record) => Number(record.total ?? record.amount ?? 0)
  );
  const monthlyIncome = groupByMonth(filteredIncome, "created_at", (entry) => Number(entry.amount || 0));

  const customerMap = new Map();
  filteredOrders.forEach((order) => {
    const key = order.customer_name || "Walk-in Customer";
    const current = customerMap.get(key) || { name: key, total: 0, count: 0 };
    current.total += Number(order.total || 0);
    current.count += 1;
    customerMap.set(key, current);
  });
  const topCustomers = Array.from(customerMap.values()).sort((a, b) => b.total - a.total).slice(0, 5);

  const productMap = new Map();
  filteredOrders.forEach((order) => {
    (order.items || []).forEach((item) => {
      const key = item.name || item.product_name || item.sku || "Product";
      const current = productMap.get(key) || { name: key, qty: 0, revenue: 0 };
      current.qty += Number(item.quantity || 0);
      current.revenue += Number(item.price || item.total || 0) * Number(item.quantity || 1);
      productMap.set(key, current);
    });
  });
  const topProducts = Array.from(productMap.values()).sort((a, b) => b.revenue - a.revenue).slice(0, 5);

  const inventoryValuation = filteredPurchases.reduce(
    (sum, purchase) =>
      sum +
      (Array.isArray(purchase.items)
        ? purchase.items.reduce((lineSum, item) => lineSum + Number(item.cost_price || 0) * Number(item.quantity || 0), 0)
        : 0),
    0
  );

  return {
    orders: filteredOrders,
    purchases: filteredPurchases,
    expenses: filteredExpenses,
    income: filteredIncome,
    cashMovements: filteredCashMovements,
    journalEntries: filteredJournalEntries,
    returns: filteredReturns,
    revenue,
    purchaseSpend,
    manualExpenses,
    expensesTotal,
    otherIncome,
    profit,
    cashBalance,
    cashIn,
    cashOut,
    pendingReceivables,
    pendingPayables,
    monthlyRevenue,
    monthlyExpenses,
    monthlyIncome,
    topCustomers,
    topProducts,
    inventoryValuation,
    cashShift: shift,
    approvalPending: filteredExpenses.filter((expense) => expense.status === "Pending").length,
    journalDrafts: filteredJournalEntries.filter((entry) => entry.status === "Draft").length,
    returnsCount: filteredReturns.length,
  };
};

export const buildLedgerRows = (rows, type = "customer") => {
  const sorted = [...rows].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  let running = 0;
  return sorted.map((row) => {
    const delta = type === "cash"
      ? Number(row.credit || 0) - Number(row.debit || 0)
      : Number(row.credit || 0) - Number(row.debit || 0);
    running += delta;
    return { ...row, runningBalance: running };
  });
};

export const buildCashLedger = (movements) =>
  buildLedgerRows(
    movements.map((movement) => ({
      ...movement,
      debit: String(movement.type).toLowerCase().includes("out") ? Number(movement.amount || 0) : 0,
      credit: String(movement.type).toLowerCase().includes("in") ? Number(movement.amount || 0) : 0,
    })),
    "cash"
  );

export const buildCustomerLedger = (orders) =>
  buildLedgerRows(
    orders.map((order) => ({
      ...order,
      account: order.customer_name || "Walk-in Customer",
      debit: Number(order.total || 0),
      credit: Number(order.paymentStatus === "Paid" ? order.total || 0 : 0),
    })),
    "customer"
  );

export const buildSupplierLedger = (purchases) =>
  buildLedgerRows(
    purchases.map((purchase) => ({
      ...purchase,
      account: purchase.supplier_name || "Supplier",
      debit: Number(purchase.total || 0),
      credit: Number(purchase.payment_status === "Paid" ? purchase.total || 0 : 0),
    })),
    "supplier"
  );

export const buildCategoryBreakdown = (items, keyField = "category", amountField = "amount") => {
  const map = new Map();
  items.forEach((item) => {
    const key = item[keyField] || "Uncategorized";
    map.set(key, (map.get(key) || 0) + Number(item[amountField] || 0));
  });
  return Array.from(map.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([label, value]) => ({ label, value }));
};

export const buildDateLabels = (series) =>
  series.map((item) => ({
    ...item,
    label: item.label || item.key,
  }));
