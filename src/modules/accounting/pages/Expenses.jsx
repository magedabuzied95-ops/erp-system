import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  BarChart3,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  Droplets,
  FileText,
  Home,
  Landmark,
  Megaphone,
  Paperclip,
  Pencil,
  Plus,
  ReceiptText,
  Repeat,
  Search,
  ShieldCheck,
  ShoppingBasket,
  Trash2,
  Truck,
  UserRound,
  Wallet,
  Wifi,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import toast from "react-hot-toast";

import { api } from "../../../shared/api/api";
import { CurrencyText } from "../../../shared/components/CurrencyAmount";
import AccountingShell from "../components/AccountingShell";
import FinanceMetricCard from "../components/FinanceMetricCard";
import { formatCurrency } from "../lib/financeStore";

const EXPENSE_TYPES = [
  "electricity",
  "water",
  "rent",
  "salaries",
  "shipping",
  "maintenance",
  "groceries_supplies",
  "marketing",
  "supplier_related",
  "employee_advance",
  "other",
];

const PAYMENT_METHODS = ["cash", "card", "bank_transfer", "wallet", "instapay", "vodafone_cash"];
const STATUSES = ["draft", "pending_approval", "approved", "rejected", "paid"];
const FREQUENCIES = ["weekly", "monthly", "quarterly", "yearly"];
const QUICK_EXPENSE_CATEGORIES = [
  { type: "electricity", ar: "كهرباء", en: "Electricity", titleAr: "فاتورة كهرباء", titleEn: "Electricity bill", icon: Zap },
  { type: "water", ar: "مياه", en: "Water", titleAr: "فاتورة مياه", titleEn: "Water bill", icon: Droplets },
  { type: "salaries", ar: "مرتبات", en: "Salaries", titleAr: "مرتبات", titleEn: "Salaries", icon: Wallet },
  { type: "shipping", ar: "شحن", en: "Shipping", titleAr: "مصاريف شحن", titleEn: "Shipping expense", icon: Truck },
  { type: "groceries_supplies", ar: "بقالة", en: "Groceries", titleAr: "مشتريات بقالة", titleEn: "Groceries", icon: ShoppingBasket },
  { type: "other", category: "internet", ar: "إنترنت", en: "Internet", titleAr: "فاتورة إنترنت", titleEn: "Internet bill", icon: Wifi },
  { type: "rent", ar: "إيجار", en: "Rent", titleAr: "إيجار", titleEn: "Rent", icon: Home },
  { type: "maintenance", ar: "صيانة", en: "Maintenance", titleAr: "مصاريف صيانة", titleEn: "Maintenance expense", icon: Wrench },
  { type: "employee_advance", ar: "سلفة موظف", en: "Employee advance", titleAr: "سلفة موظف", titleEn: "Employee advance", icon: UserRound },
  { type: "marketing", ar: "تسويق", en: "Marketing", titleAr: "مصاريف تسويق", titleEn: "Marketing expense", icon: Megaphone },
];

const blankExpense = {
  title: "",
  amount: "",
  expense_type: "other",
  category_id: "",
  category: "",
  payment_method: "cash",
  branch_id: "",
  warehouse_id: "",
  employee_id: "",
  supplier_id: "",
  expense_date: new Date().toISOString().slice(0, 10),
  notes: "",
  attachment_name: "",
  attachment_url: "",
  attachment_file: null,
  financial_account_id: "",
  status: "draft",
};

const blankAdvance = {
  employee_id: "",
  amount: "",
  deduction_month: new Date().toISOString().slice(0, 7),
  payment_method: "cash",
  notes: "",
};

const blankRecurring = {
  title: "",
  expense_type: "rent",
  category_id: "",
  amount: "",
  payment_method: "cash",
  branch_id: "",
  frequency: "monthly",
  next_due_date: new Date().toISOString().slice(0, 10),
  auto_create: false,
  is_active: true,
  notes: "",
};

const labels = {
  en: {
    module: "Expenses Center",
    subtitle: "Operational expenses, approvals, recurring liabilities, employee advances, and profit impact.",
    dashboard: "Dashboard",
    expenses: "All Expenses",
    create: "Add / Edit",
    categories: "Categories",
    advances: "Employee Advances",
    recurring: "Recurring",
    approvals: "Approvals",
    reports: "Reports",
    totalToday: "Today",
    totalMonth: "This month",
    pendingApproval: "Pending approval",
    outstandingAdvances: "Outstanding advances",
    recurringDue: "Recurring due",
    profitImpact: "Profit impact",
    createExpense: "Save expense",
    updateExpense: "Update expense",
    markPaid: "Mark paid",
    approve: "Approve",
    reject: "Reject",
    delete: "Delete",
    refresh: "Refresh",
    noRows: "No records found",
    title: "Title",
    amount: "Amount",
    type: "Type",
    category: "Category",
    payment: "Payment",
    branch: "Branch ID",
    warehouse: "Warehouse ID",
    employee: "Employee",
    supplier: "Supplier ID",
    account: "Cashbox / account ID",
    date: "Date",
    status: "Status",
    notes: "Notes",
    attachment: "Attachment",
    search: "Search expenses",
    filterStatus: "Status",
    all: "All",
    deductionMonth: "Deduction month",
    deductionStatus: "Deduction status",
    frequency: "Frequency",
    nextDue: "Next due",
    autoCreate: "Auto-create",
    active: "Active",
    inactive: "Inactive",
    createAdvance: "Create employee advance",
    saveAdvance: "Save advance",
    deducted: "Deducted",
    month: "Month",
    actions: "Actions",
    deduct: "Deduct",
    createCategory: "Create category",
    save: "Save",
    createRecurring: "Create recurring expense",
    saveRecurring: "Save recurring",
    apply: "Apply",
    links: "Links",
    noData: "No data",
    monthlyTrend: "Monthly trend",
    byBranch: "By branch",
    byEmployee: "By employee",
    attachmentPreview: "Attachment preview",
    advanceDeducted: "Advance marked deducted",
  },
  ar: {
    module: "مركز المصاريف",
    subtitle: "المصاريف التشغيلية والاعتمادات والمصاريف المتكررة وسلف الموظفين وتأثير الربح.",
    dashboard: "لوحة التحكم",
    expenses: "كل المصاريف",
    create: "إضافة / تعديل",
    categories: "التصنيفات",
    advances: "سلف الموظفين",
    recurring: "متكرر",
    approvals: "الاعتمادات",
    reports: "التقارير",
    totalToday: "اليوم",
    totalMonth: "هذا الشهر",
    pendingApproval: "قيد الاعتماد",
    outstandingAdvances: "سلف معلقة",
    recurringDue: "متكرر مستحق",
    profitImpact: "تأثير الربح",
    createExpense: "حفظ المصروف",
    updateExpense: "تحديث المصروف",
    markPaid: "تسجيل دفع",
    approve: "اعتماد",
    reject: "رفض",
    delete: "حذف",
    refresh: "تحديث",
    noRows: "لا توجد سجلات",
    title: "العنوان",
    amount: "المبلغ",
    type: "النوع",
    category: "التصنيف",
    payment: "الدفع",
    branch: "معرف الفرع",
    warehouse: "معرف المخزن",
    employee: "الموظف",
    supplier: "معرف المورد",
    account: "معرف الخزنة / الحساب",
    date: "التاريخ",
    status: "الحالة",
    notes: "ملاحظات",
    attachment: "مرفق",
    search: "بحث المصاريف",
    filterStatus: "الحالة",
    all: "الكل",
    deductionMonth: "شهر الخصم",
    deductionStatus: "حالة الخصم",
    frequency: "التكرار",
    nextDue: "الاستحقاق القادم",
    autoCreate: "إنشاء تلقائي",
    active: "نشط",
    inactive: "غير نشط",
    createAdvance: "إنشاء سلفة موظف",
    saveAdvance: "حفظ السلفة",
    deducted: "المخصوم",
    month: "الشهر",
    actions: "الإجراءات",
    deduct: "خصم",
    createCategory: "إنشاء تصنيف",
    save: "حفظ",
    createRecurring: "إنشاء مصروف متكرر",
    saveRecurring: "حفظ المتكرر",
    apply: "تطبيق",
    links: "الروابط",
    noData: "لا توجد بيانات",
    monthlyTrend: "الاتجاه الشهري",
    byBranch: "حسب الفرع",
    byEmployee: "حسب الموظف",
    attachmentPreview: "معاينة المرفق",
    advanceDeducted: "تم تسجيل السلفة كمخصومة",
  },
};

const statusClass = (status = "") => {
  const value = String(status).toLowerCase();
  if (value === "paid" || value === "deducted" || value === "approved") return "border-emerald-300/25 bg-emerald-400/10 text-emerald-100";
  if (value === "pending_approval" || value === "pending" || value === "partial" || value === "partially_deducted") return "border-amber-300/25 bg-amber-400/10 text-amber-100";
  if (value === "rejected" || value === "cancelled") return "border-rose-300/25 bg-rose-400/10 text-rose-100";
  return "border-white/10 bg-white/[0.04] text-zinc-300";
};

const OPTION_LABELS = {
  en: {
    type: {
      electricity: "Electricity",
      water: "Water",
      rent: "Rent",
      salaries: "Salaries",
      shipping: "Shipping",
      maintenance: "Maintenance",
      groceries_supplies: "Groceries / supplies",
      marketing: "Marketing",
      supplier_related: "Supplier related",
      employee_advance: "Employee advance",
      other: "Other",
    },
    category: {
      electricity: "Utilities - Electricity",
      utilities_electricity: "Utilities - Electricity",
      water: "Utilities - Water",
      utilities_water: "Utilities - Water",
      rent: "Rent",
      salaries: "Salaries",
      shipping: "Shipping",
      maintenance: "Maintenance",
      groceries_supplies: "Groceries / Supplies",
      marketing: "Marketing",
      supplier_related: "Supplier Related",
      employee_advance: "Employee Advance",
      other: "Other",
    },
    payment: {
      cash: "Cash",
      card: "Card",
      bank_transfer: "Bank transfer",
      wallet: "Wallet",
      instapay: "Instapay",
      vodafone_cash: "Vodafone Cash",
    },
    status: {
      draft: "Draft",
      pending_approval: "Pending approval",
      approved: "Approved",
      rejected: "Rejected",
      paid: "Paid",
      pending: "Pending",
      partial: "Partial",
      partially_deducted: "Partially deducted",
      deducted: "Deducted",
      active: "Active",
      inactive: "Inactive",
    },
    frequency: {
      weekly: "Weekly",
      monthly: "Monthly",
      quarterly: "Quarterly",
      yearly: "Yearly",
    },
    boolean: {
      true: "Yes",
      false: "No",
    },
  },
  ar: {
    type: {
      electricity: "كهرباء",
      water: "مياه",
      rent: "إيجار",
      salaries: "رواتب",
      shipping: "شحن",
      maintenance: "صيانة",
      groceries_supplies: "مشتريات ومستلزمات",
      marketing: "تسويق",
      supplier_related: "متعلق بالموردين",
      employee_advance: "سلفة موظف",
      other: "أخرى",
    },
    category: {
      electricity: "مرافق - كهرباء",
      utilities_electricity: "مرافق - كهرباء",
      water: "مرافق - مياه",
      utilities_water: "مرافق - مياه",
      rent: "إيجار",
      salaries: "رواتب",
      shipping: "شحن",
      maintenance: "صيانة",
      groceries_supplies: "بقالة / مستلزمات",
      marketing: "تسويق",
      supplier_related: "متعلق بالموردين",
      employee_advance: "سلفة موظف",
      other: "أخرى",
    },
    payment: {
      cash: "نقدي",
      card: "بطاقة",
      bank_transfer: "تحويل بنكي",
      wallet: "محفظة",
      instapay: "إنستاباي",
      vodafone_cash: "فودافون كاش",
    },
    status: {
      draft: "مسودة",
      pending_approval: "قيد الاعتماد",
      approved: "معتمد",
      rejected: "مرفوض",
      paid: "مدفوع",
      pending: "معلق",
      partial: "مخصوم جزئياً",
      partially_deducted: "مخصوم جزئياً",
      deducted: "مخصوم",
      active: "نشط",
      inactive: "غير نشط",
    },
    frequency: {
      weekly: "أسبوعي",
      monthly: "شهري",
      quarterly: "ربع سنوي",
      yearly: "سنوي",
    },
    boolean: {
      true: "نعم",
      false: "لا",
    },
  },
};

const LEGACY_EXPENSE_OPTION_KEYS = {
  "employee advance": "employee_advance",
  "employee_advance": "employee_advance",
  "groceries / supplies": "groceries_supplies",
  "groceries supplies": "groceries_supplies",
  groceries_supplies: "groceries_supplies",
  maintenance: "maintenance",
  marketing: "marketing",
  other: "other",
  rent: "rent",
  salaries: "salaries",
  shipping: "shipping",
  "supplier related": "supplier_related",
  supplier_related: "supplier_related",
  "supplier-related": "supplier_related",
  "utilities - electricity": "electricity",
  "utilities electricity": "electricity",
  utilities_electricity: "electricity",
  electricity: "electricity",
  "utilities - water": "water",
  "utilities water": "water",
  utilities_water: "water",
  water: "water",
  "bank transfer": "bank_transfer",
  bank_transfer: "bank_transfer",
  "vodafone cash": "vodafone_cash",
  vodafone_cash: "vodafone_cash",
  "pending approval": "pending_approval",
  pending_approval: "pending_approval",
  "partially deducted": "partially_deducted",
  partially_deducted: "partially_deducted",
};

const normalizeExpenseOptionKey = (value = "") => {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return "";
  const normalized = text.replace(/\s+/g, " ").replace(/[_-]+/g, "_");
  return LEGACY_EXPENSE_OPTION_KEYS[text] || LEGACY_EXPENSE_OPTION_KEYS[normalized] || normalized.replace(/\s+/g, "_");
};

const expenseOptionLabel = (t, language, group, value, fallback = "") => {
  const key = normalizeExpenseOptionKey(value);
  const labelsForLanguage = OPTION_LABELS[language] || OPTION_LABELS.en;
  const fallbackLabel = labelsForLanguage[group]?.[key] || OPTION_LABELS.en[group]?.[key] || fallback || String(value || "").replace(/_/g, " ");
  return t(`expenses.centerOptions.${group}.${key}`, fallbackLabel);
};

const typeLabel = (t, language, type) => expenseOptionLabel(t, language, "type", type);
const categoryLabel = (t, language, category = {}) => {
  if (category && typeof category === "object") {
    const rawName = category.name || category.category_name || category.label || "";
    const nameKey = normalizeExpenseOptionKey(rawName);
    const typeKey = normalizeExpenseOptionKey(category.type_key || category.typeKey || "");
    if (OPTION_LABELS.en.category[nameKey] || OPTION_LABELS[language]?.category?.[nameKey]) {
      return expenseOptionLabel(t, language, "category", nameKey);
    }
    if (rawName && rawName !== typeKey) return rawName;
    if (OPTION_LABELS.en.category[typeKey] || OPTION_LABELS[language]?.category?.[typeKey]) {
      return expenseOptionLabel(t, language, "category", typeKey);
    }
    return rawName || expenseOptionLabel(t, language, "category", typeKey || "other");
  }
  return expenseOptionLabel(t, language, "category", category || "other");
};
const paymentLabel = (t, language, value) => expenseOptionLabel(t, language, "payment", value);
const statusLabel = (t, language, value) => expenseOptionLabel(t, language, "status", value);
const frequencyLabel = (t, language, value) => expenseOptionLabel(t, language, "frequency", value);
const booleanLabel = (t, language, value) => expenseOptionLabel(t, language, "boolean", String(Boolean(value)));

function Expenses({ defaultTab = "dashboard", visibleTabs = null }) {
  const { i18n, t } = useTranslation();
  const language = String(i18n.language || "").startsWith("ar") ? "ar" : "en";
  const copy = labels[language];
  const [activeTab, setActiveTab] = useState(defaultTab);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dashboard, setDashboard] = useState(null);
  const [expenses, setExpenses] = useState([]);
  const [categories, setCategories] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [advances, setAdvances] = useState([]);
  const [recurring, setRecurring] = useState([]);
  const [filters, setFilters] = useState({ search: "", status: "", from: "", to: "" });
  const [expenseForm, setExpenseForm] = useState(blankExpense);
  const [editingExpenseId, setEditingExpenseId] = useState(null);
  const [categoryForm, setCategoryForm] = useState({ name: "", type_key: "other", description: "" });
  const [advanceForm, setAdvanceForm] = useState(blankAdvance);
  const [recurringForm, setRecurringForm] = useState(blankRecurring);
  const [confirmAction, setConfirmAction] = useState(null);
  const [advancedExpenseOpen, setAdvancedExpenseOpen] = useState(false);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [dashboardRes, expensesRes, categoriesRes, advancesRes, recurringRes, employeesRes] = await Promise.all([
        api.get("/expenses/dashboard"),
        api.get("/expenses", { params: { ...filters, limit: 75 } }),
        api.get("/expenses/categories"),
        api.get("/expenses/employee-advances"),
        api.get("/expenses/recurring"),
        api.get("/employees", { params: { active: true, limit: 500 } }),
      ]);
      setDashboard(dashboardRes.dashboard || null);
      setExpenses(expensesRes.expenses || []);
      setCategories(categoriesRes.categories || []);
      setAdvances(advancesRes.advances || []);
      setRecurring(recurringRes.recurring_expenses || []);
      setEmployees(employeesRes.employees || employeesRes.data || []);
    } catch (error) {
      toast.error(error?.message || "Failed to load expenses");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const summary = dashboard?.summary || {};
  const pendingExpenses = useMemo(() => expenses.filter((item) => ["draft", "pending_approval"].includes(item.status)), [expenses]);
  const employeeOptions = useMemo(
    () => employees.map((employee) => {
      const label = employee.full_name || employee.name || employee.employee_name || employee.employee_code || `#${employee.id}`;
      return {
        value: employee.id,
        label,
        code: employee.employee_code || employee.code || "",
        jobTitle: employee.role || employee.job_title || employee.position || "",
        branch: employee.branch_name || employee.branch || "",
        initials: employeeInitials(label),
      };
    }),
    [employees]
  );
  const allWorkspaceTabs = useMemo(() => ([
    ["dashboard", copy.dashboard, BarChart3],
    ["expenses", copy.expenses, ReceiptText],
    ["create", copy.create, Plus],
    ["categories", copy.categories, ClipboardCheck],
    ["advances", copy.advances, UserRound],
    ["recurring", copy.recurring, CalendarClock],
    ["approvals", copy.approvals, ShieldCheck],
    ["reports", copy.reports, FileText],
  ]), [copy]);
  const workspaceTabs = Array.isArray(visibleTabs) && visibleTabs.length
    ? allWorkspaceTabs.filter(([id]) => visibleTabs.includes(id))
    : allWorkspaceTabs;

  useEffect(() => {
    const fallbackTab = workspaceTabs.some(([id]) => id === defaultTab) ? defaultTab : workspaceTabs[0]?.[0] || "dashboard";
    if (!workspaceTabs.some(([id]) => id === activeTab)) setActiveTab(fallbackTab);
  }, [activeTab, defaultTab, workspaceTabs]);

  const resetExpenseForm = () => {
    setEditingExpenseId(null);
    setExpenseForm(blankExpense);
    setAdvancedExpenseOpen(false);
  };

  const quickExpenseCopy = language === "ar"
    ? {
        mode: "إضافة مصروف سريع",
        helper: "اكتب العنوان والمبلغ، أو اختر نوع المصروف لتعبئة العنوان تلقائيا.",
        quickCategories: "اختصارات سريعة",
        useSuggestion: "استخدم الاقتراح",
        advanced: "خيارات متقدمة",
        advancedHint: "حقول الحسابات والفروع والموردين والموافقات عند الحاجة فقط.",
        type: "النوع",
        payment: "طريقة الدفع",
        notes: "ملاحظات",
        attachmentHint: "صورة فاتورة أو PDF اختياري",
        accountMapping: "ربط محاسبي / خزنة",
        businessLinks: "ربط بالموظف أو المورد أو المخزن",
        approvals: "الموافقات والحالة",
        recurring: "المصروفات المتكررة تدار من تبويب المتكرر عند الحاجة.",
      }
    : {
        mode: "Quick expense",
        helper: "Enter the title and amount, or pick a type to fill the title automatically.",
        quickCategories: "Quick categories",
        useSuggestion: "Use suggestion",
        advanced: "Advanced options",
        advancedHint: "Accounting, branch, supplier, approval, and ERP links only when needed.",
        type: "Type",
        payment: "Payment method",
        notes: "Notes",
        attachmentHint: "Optional invoice image or PDF",
        accountMapping: "Accounting / treasury mapping",
        businessLinks: "Employee, supplier, warehouse links",
        approvals: "Approvals and status",
        recurring: "Recurring expenses are managed from the Recurring tab when needed.",
      };

  const expenseTitleSuggestion = useMemo(() => {
    const quick = QUICK_EXPENSE_CATEGORIES.find((item) => item.type === expenseForm.expense_type && (!item.category || item.category === normalizeExpenseOptionKey(expenseForm.category)));
    return language === "ar" ? quick?.titleAr : quick?.titleEn;
  }, [expenseForm.category, expenseForm.expense_type, language]);

  const selectQuickExpenseCategory = (quickCategory) => {
    const label = language === "ar" ? quickCategory.ar : quickCategory.en;
    const title = language === "ar" ? quickCategory.titleAr : quickCategory.titleEn;
    const matchingCategory = categories.find((category) => {
      const key = normalizeExpenseOptionKey(category.type_key || category.name || category.category_name);
      return key === quickCategory.type || key === quickCategory.category;
    });
    setExpenseForm((previous) => ({
      ...previous,
      expense_type: quickCategory.type,
      category: quickCategory.category || label,
      category_id: matchingCategory?.id || "",
      employee_id: quickCategory.type === "employee_advance" ? previous.employee_id : "",
      title: previous.title.trim() ? previous.title : title,
    }));
  };

  const saveExpense = async () => {
    if (!expenseForm.title.trim() || Number(expenseForm.amount || 0) <= 0) {
      toast.error("مطلوب عنوان المصروف والمبلغ");
      return;
    }
    if (expenseForm.expense_type === "employee_advance" && !expenseForm.employee_id) {
      toast.error(language === "ar" ? "اختر الموظف لسلفة الموظف" : "Select an employee for the employee advance");
      return;
    }
    setSaving(true);
    try {
      const normalizedPayload = { ...expenseForm, amount: Number(expenseForm.amount || 0) };
      const payload = expenseForm.attachment_file ? new FormData() : normalizedPayload;
      if (payload instanceof FormData) {
        Object.entries(normalizedPayload).forEach(([key, value]) => {
          if (key === "attachment_file") return;
          payload.append(key, value ?? "");
        });
        payload.append("attachment", expenseForm.attachment_file);
      }
      if (editingExpenseId) await api.put(`/expenses/${editingExpenseId}`, payload);
      else await api.post("/expenses", payload);
      toast.success(editingExpenseId ? "تم تحديث المصروف" : "تم إنشاء المصروف");
      resetExpenseForm();
      await loadAll();
    } catch (error) {
      toast.error(error?.message || "تعذر حفظ المصروف");
    } finally {
      setSaving(false);
    }
  };

  const editExpense = (expense) => {
    setEditingExpenseId(expense.id);
    setAdvancedExpenseOpen(Boolean(expense.category_id || expense.branch_id || expense.warehouse_id || expense.employee_id || expense.supplier_id || expense.financial_account_id || expense.status));
    setExpenseForm({
      title: expense.title || "",
      amount: expense.amount || "",
      expense_type: expense.expense_type || "other",
      category_id: expense.category_id || "",
      category: expense.category || expense.category_name || "",
      payment_method: expense.payment_method || "cash",
      branch_id: expense.branch_id || "",
      warehouse_id: expense.warehouse_id || "",
      employee_id: expense.employee_id || "",
      supplier_id: expense.supplier_id || "",
      expense_date: String(expense.expense_date || "").slice(0, 10) || new Date().toISOString().slice(0, 10),
      notes: expense.notes || expense.note || "",
      attachment_name: expense.attachment_name || "",
      attachment_url: expense.attachment_url || "",
      attachment_file: null,
      financial_account_id: expense.financial_account_id || "",
      status: expense.status || "draft",
    });
    setActiveTab("create");
  };

  const runExpenseAction = async (action) => {
    if (!action) return;
    try {
      if (action.type === "delete") await api.delete(`/expenses/${action.id}`);
      if (action.type === "approve") await api.post(`/expenses/${action.id}/approve`, {});
      if (action.type === "reject") await api.post(`/expenses/${action.id}/reject`, { reason: action.reason || "مرفوض من مركز المصروفات" });
      if (action.type === "paid") await api.post(`/expenses/${action.id}/mark-paid`, {});
      toast.success("تم تنفيذ الإجراء");
      setConfirmAction(null);
      await loadAll();
    } catch (error) {
      toast.error(error?.message || "تعذر تنفيذ الإجراء");
    }
  };

  const saveCategory = async () => {
    if (!categoryForm.name.trim()) return toast.error("اسم الفئة مطلوب");
    await api.post("/expenses/categories", categoryForm);
    setCategoryForm({ name: "", type_key: "other", description: "" });
    toast.success("تم إنشاء الفئة");
    await loadAll();
  };

  const saveAdvance = async () => {
    if (!advanceForm.employee_id || Number(advanceForm.amount || 0) <= 0) return toast.error("الموظف والمبلغ مطلوبان");
    await api.post("/expenses/employee-advances", { ...advanceForm, amount: Number(advanceForm.amount || 0) });
    setAdvanceForm(blankAdvance);
    toast.success("تم إنشاء سلفة الموظف");
    await loadAll();
  };

  const deductAdvance = async (advance) => {
    await api.post(`/expenses/employee-advances/${advance.id}/deduct`, { payroll_reference: `manual-${Date.now()}` });
    toast.success(copy.advanceDeducted);
    await loadAll();
  };

  const saveRecurring = async () => {
    if (!recurringForm.title.trim() || Number(recurringForm.amount || 0) <= 0) return toast.error("عنوان المصروف المتكرر والمبلغ مطلوبان");
    await api.post("/expenses/recurring", { ...recurringForm, amount: Number(recurringForm.amount || 0) });
    setRecurringForm(blankRecurring);
    toast.success("تم إنشاء المصروف المتكرر");
    await loadAll();
  };

  return (
    <AccountingShell
      title={copy.module}
      subtitle={copy.subtitle}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={loadAll} className="theme-button-soft px-3 py-2 text-sm" disabled={loading}>
            <Repeat className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            {copy.refresh}
          </button>
          <Link to="/accounting/profit-loss" className="theme-button-soft px-3 py-2 text-sm">
            <BarChart3 className="h-4 w-4" />
            الأرباح والخسائر
          </Link>
        </div>
      }
      tabs={[
        { to: "/expenses", label: copy.module, end: true },
        { to: "/accounting/cashbox", label: "درج النقدية" },
        { to: "/accounting/financial-accounts", label: "الحسابات" },
        { to: "/accounting/journal-entries", label: "القيود اليومية" },
        { to: "/accounting/reports", label: copy.reports },
      ]}
    >
      {workspaceTabs.length > 1 ? (
        <div className="mb-4 flex gap-1.5 overflow-x-auto rounded-2xl border border-white/10 bg-zinc-950/70 p-1">
          {workspaceTabs.map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveTab(id)}
              className={`inline-flex h-[var(--control-height-md)] shrink-0 items-center gap-2 rounded-xl px-3 text-xs font-black transition ${activeTab === id ? "bg-emerald-400 text-zinc-950" : "text-zinc-400 hover:bg-white/[0.06] hover:text-white"}`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>
      ) : null}

      {activeTab === "dashboard" ? (
        <section className="space-y-4">
          <KpiGrid summary={summary} copy={copy} />
          <div className="grid gap-4 xl:grid-cols-3">
            <BreakdownCard title={copy.categories} rows={dashboard?.by_category || []} t={t} language={language} copy={copy} />
            <BreakdownCard title={copy.byBranch} rows={dashboard?.by_branch || []} t={t} language={language} copy={copy} />
            <BreakdownCard title={copy.byEmployee} rows={dashboard?.by_employee || []} t={t} language={language} copy={copy} />
          </div>
          <TrendCard rows={dashboard?.monthly_trend || []} />
        </section>
      ) : null}

      {activeTab === "expenses" ? (
        <section className="space-y-4">
          <Filters filters={filters} setFilters={setFilters} onApply={loadAll} copy={copy} t={t} language={language} />
          <ExpensesTable rows={expenses} copy={copy} onEdit={editExpense} onAction={setConfirmAction} t={t} language={language} />
        </section>
      ) : null}

      {activeTab === "create" ? (
        <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
          <Panel title={editingExpenseId ? copy.updateExpense : quickExpenseCopy.mode}>
            <div className="space-y-5">
              <div>
                <p className="text-sm font-semibold text-zinc-400">{quickExpenseCopy.helper}</p>
                <div className="mt-3 flex flex-wrap gap-2" aria-label={quickExpenseCopy.quickCategories}>
                  {QUICK_EXPENSE_CATEGORIES.map((item) => {
                    const Icon = item.icon;
                    const active = expenseForm.expense_type === item.type && (!item.category || normalizeExpenseOptionKey(expenseForm.category) === item.category);
                    return (
                      <button
                        key={`${item.type}-${item.category || item.en}`}
                        type="button"
                        onClick={() => selectQuickExpenseCategory(item)}
                        className={`inline-flex min-h-[var(--control-height-lg)] items-center gap-2 rounded-2xl border px-3 py-2 text-sm font-black transition ${ active ? "border-emerald-300/50 bg-emerald-400/15 text-emerald-100" : "border-white/10 bg-white/[0.04] text-zinc-200 hover:border-white/20 hover:bg-white/[0.07]" }`}
                      >
                        <Icon className="h-4 w-4" />
                        {language === "ar" ? item.ar : item.en}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <Field label={copy.title} value={expenseForm.title} onChange={(value) => setExpenseForm((p) => ({ ...p, title: value }))} autoFocus />
                <Field label={copy.amount} type="number" value={expenseForm.amount} onChange={(value) => setExpenseForm((p) => ({ ...p, amount: value }))} inputMode="decimal" />
                <Select label={quickExpenseCopy.type} value={expenseForm.expense_type} onChange={(value) => setExpenseForm((p) => ({ ...p, expense_type: value, employee_id: value === "employee_advance" ? p.employee_id : "" }))} options={EXPENSE_TYPES.map((item) => ({ value: item, label: typeLabel(t, language, item) }))} />
                <Select label={quickExpenseCopy.payment} value={expenseForm.payment_method} onChange={(value) => setExpenseForm((p) => ({ ...p, payment_method: value }))} options={PAYMENT_METHODS.map((item) => ({ value: item, label: paymentLabel(t, language, item) }))} />
                {expenseForm.expense_type === "employee_advance" ? (
                  <SearchableSelect
                    label={copy.employee}
                    value={expenseForm.employee_id}
                    onChange={(value) => setExpenseForm((p) => ({ ...p, employee_id: value }))}
                    options={employeeOptions}
                    placeholder={language === "ar" ? "ابحث عن موظف" : "Search employee"}
                  />
                ) : null}
                <Field label={copy.date} type="date" value={expenseForm.expense_date} onChange={(value) => setExpenseForm((p) => ({ ...p, expense_date: value }))} />
                <label className="block">
                  <span className="mb-2 block text-[10px] font-black uppercase tracking-[0.16em] text-zinc-500">{copy.attachment}</span>
                  <input type="file" onChange={(event) => {
                    const file = event.target.files?.[0];
                    setExpenseForm((p) => ({
                      ...p,
                      attachment_file: file || null,
                      attachment_name: file?.name || p.attachment_name,
                      attachment_url: file ? "" : p.attachment_url,
                    }));
                  }} className={inputClass} />
                  <span className="mt-1 block text-xs font-semibold text-zinc-500">{quickExpenseCopy.attachmentHint}</span>
                </label>
                {expenseTitleSuggestion && expenseTitleSuggestion !== expenseForm.title ? (
                  <button type="button" onClick={() => setExpenseForm((p) => ({ ...p, title: expenseTitleSuggestion }))} className="theme-button-soft justify-center px-4 py-3 text-sm md:col-span-2">
                    <ReceiptText className="h-4 w-4" />
                    {quickExpenseCopy.useSuggestion}: {expenseTitleSuggestion}
                  </button>
                ) : null}
                <label className="block md:col-span-2">
                  <span className="mb-2 block text-[10px] font-black uppercase tracking-[0.16em] text-zinc-500">{quickExpenseCopy.notes}</span>
                  <textarea rows={3} value={expenseForm.notes} onChange={(event) => setExpenseForm((p) => ({ ...p, notes: event.target.value }))} className={`${inputClass} min-h-24`} />
                </label>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/[0.03]">
                <button
                  type="button"
                  onClick={() => setAdvancedExpenseOpen((open) => !open)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                  aria-expanded={advancedExpenseOpen}
                >
                  <span>
                    <span className="block text-sm font-black text-white">{quickExpenseCopy.advanced}</span>
                    <span className="mt-1 block text-xs font-semibold text-zinc-500">{quickExpenseCopy.advancedHint}</span>
                  </span>
                  <ChevronDown className={`h-5 w-5 shrink-0 text-zinc-400 transition ${advancedExpenseOpen ? "rotate-180" : ""}`} />
                </button>
                {advancedExpenseOpen ? (
                  <div className="space-y-4 border-t border-white/10 p-4">
                    <div>
                      <h4 className="mb-3 text-xs font-black uppercase tracking-[0.16em] text-zinc-500">{quickExpenseCopy.accountMapping}</h4>
                      <div className="grid gap-3 md:grid-cols-2">
                        <Select label={copy.category} value={expenseForm.category_id} onChange={(value) => setExpenseForm((p) => ({ ...p, category_id: value }))} options={[{ value: "", label: copy.all }, ...categories.map((item) => ({ value: item.id, label: categoryLabel(t, language, item) }))]} />
                        <Field label={copy.account} type="number" value={expenseForm.financial_account_id} onChange={(value) => setExpenseForm((p) => ({ ...p, financial_account_id: value }))} inputMode="numeric" />
                      </div>
                    </div>
                    <div>
                      <h4 className="mb-3 text-xs font-black uppercase tracking-[0.16em] text-zinc-500">{quickExpenseCopy.businessLinks}</h4>
                      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                        <Field label={copy.branch} type="number" value={expenseForm.branch_id} onChange={(value) => setExpenseForm((p) => ({ ...p, branch_id: value }))} inputMode="numeric" />
                        <Field label={copy.warehouse} type="number" value={expenseForm.warehouse_id} onChange={(value) => setExpenseForm((p) => ({ ...p, warehouse_id: value }))} inputMode="numeric" />
                        <SearchableSelect label={copy.employee} value={expenseForm.employee_id} onChange={(value) => setExpenseForm((p) => ({ ...p, employee_id: value }))} options={employeeOptions} placeholder={language === "ar" ? "ابحث عن موظف" : "Search employee"} isRtl={language === "ar"} />
                        <Field label={copy.supplier} type="number" value={expenseForm.supplier_id} onChange={(value) => setExpenseForm((p) => ({ ...p, supplier_id: value }))} inputMode="numeric" />
                      </div>
                    </div>
                    <div>
                      <h4 className="mb-3 text-xs font-black uppercase tracking-[0.16em] text-zinc-500">{quickExpenseCopy.approvals}</h4>
                      <div className="grid gap-3 md:grid-cols-2">
                        <Select label={copy.status} value={expenseForm.status} onChange={(value) => setExpenseForm((p) => ({ ...p, status: value }))} options={STATUSES.map((item) => ({ value: item, label: statusLabel(t, language, item) }))} />
                        <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.03] p-4 text-sm font-semibold text-zinc-500">{quickExpenseCopy.recurring}</div>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              {editingExpenseId ? <button type="button" onClick={resetExpenseForm} className="theme-button-soft px-4 py-3 text-sm"><X className="h-4 w-4" />إلغاء</button> : null}
              <button type="button" onClick={saveExpense} disabled={saving} className="theme-button-primary min-h-[var(--control-height-lg)] px-5 py-3 text-sm disabled:opacity-50">
                <Plus className="h-4 w-4" />
                {saving ? "جارٍ الحفظ..." : editingExpenseId ? copy.updateExpense : copy.createExpense}
              </button>
            </div>
          </Panel>
          <Panel title={copy.attachmentPreview}>
            <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.03] p-5 text-sm text-zinc-400">
              <Paperclip className="mb-3 h-6 w-6 text-emerald-200" />
              {expenseForm.attachment_name || "سيظهر اسم الفاتورة أو الصورة أو PDF هنا بعد اختيار ملف."}
            </div>
          </Panel>
        </section>
      ) : null}

      {activeTab === "categories" ? (
        <section className="grid gap-4 xl:grid-cols-[24rem_minmax(0,1fr)]">
          <Panel title={copy.createCategory}>
            <div className="space-y-3">
              <Field label={copy.category} value={categoryForm.name} onChange={(value) => setCategoryForm((p) => ({ ...p, name: value }))} />
              <Select label={copy.type} value={categoryForm.type_key} onChange={(value) => setCategoryForm((p) => ({ ...p, type_key: value }))} options={EXPENSE_TYPES.map((item) => ({ value: item, label: typeLabel(t, language, item) }))} />
              <Field label={copy.notes} value={categoryForm.description} onChange={(value) => setCategoryForm((p) => ({ ...p, description: value }))} />
              <button type="button" onClick={saveCategory} className="theme-button-primary w-full justify-center px-4 py-2 text-sm"><Plus className="h-4 w-4" />{copy.save}</button>
            </div>
          </Panel>
          <Panel title={copy.categories}>
            <CompactTable rows={categories} columns={["name", "type_key", "is_active"]} empty={copy.noRows} copy={copy} t={t} language={language} />
          </Panel>
        </section>
      ) : null}

      {activeTab === "advances" ? (
        <section className="grid gap-4 xl:grid-cols-[24rem_minmax(0,1fr)]">
          <Panel title={copy.createAdvance}>
            <div className="space-y-3">
              <SearchableSelect label={copy.employee} value={advanceForm.employee_id} onChange={(value) => setAdvanceForm((p) => ({ ...p, employee_id: value }))} options={employeeOptions} placeholder={language === "ar" ? "ابحث عن موظف" : "Search employee"} isRtl={language === "ar"} />
              <Field label={copy.amount} type="number" value={advanceForm.amount} onChange={(value) => setAdvanceForm((p) => ({ ...p, amount: value }))} />
              <Field label={copy.deductionMonth} type="month" value={advanceForm.deduction_month} onChange={(value) => setAdvanceForm((p) => ({ ...p, deduction_month: value }))} />
              <Select label={copy.payment} value={advanceForm.payment_method} onChange={(value) => setAdvanceForm((p) => ({ ...p, payment_method: value }))} options={PAYMENT_METHODS.map((item) => ({ value: item, label: paymentLabel(t, language, item) }))} />
              <Field label={copy.notes} value={advanceForm.notes} onChange={(value) => setAdvanceForm((p) => ({ ...p, notes: value }))} />
              <button type="button" onClick={saveAdvance} className="theme-button-primary w-full justify-center px-4 py-2 text-sm"><UserRound className="h-4 w-4" />{copy.saveAdvance}</button>
            </div>
          </Panel>
          <Panel title={copy.advances}>
            <div className="m1-table-container overflow-x-auto">
              <table className="m1-table m1-table--compact w-full min-w-[760px] text-sm">
                <thead className="text-left text-[10px] uppercase tracking-[0.16em] text-zinc-500"><tr><Th>{copy.employee}</Th><Th>{copy.amount}</Th><Th>{copy.deducted}</Th><Th>{copy.month}</Th><Th>{copy.status}</Th><Th>{copy.actions}</Th></tr></thead>
                <tbody>
                  {advances.map((advance) => (
                    <tr key={advance.id} className="border-t border-white/5">
                      <Td>{advance.employee_name || `#${advance.employee_id}`}</Td>
                      <Td><CurrencyText value={formatCurrency(advance.amount)} /></Td>
                      <Td><CurrencyText value={formatCurrency(advance.deducted_amount)} /></Td>
                      <Td>{advance.deduction_month}</Td>
                      <Td><Status value={advance.deduction_status} t={t} language={language} /></Td>
                      <Td>{["pending", "partial", "partially_deducted"].includes(advance.deduction_status) ? <button type="button" onClick={() => deductAdvance(advance)} className="theme-button-soft px-3 py-1.5 text-xs">{copy.deduct}</button> : null}</Td>
                    </tr>
                  ))}
                  {!advances.length ? <tr><td colSpan={6} className="px-4 py-8 text-center text-zinc-500">{copy.noRows}</td></tr> : null}
                </tbody>
              </table>
            </div>
          </Panel>
        </section>
      ) : null}

      {activeTab === "recurring" ? (
        <section className="grid gap-4 xl:grid-cols-[24rem_minmax(0,1fr)]">
          <Panel title={copy.createRecurring}>
            <div className="space-y-3">
              <Field label={copy.title} value={recurringForm.title} onChange={(value) => setRecurringForm((p) => ({ ...p, title: value }))} />
              <Field label={copy.amount} type="number" value={recurringForm.amount} onChange={(value) => setRecurringForm((p) => ({ ...p, amount: value }))} />
              <Select label={copy.type} value={recurringForm.expense_type} onChange={(value) => setRecurringForm((p) => ({ ...p, expense_type: value }))} options={EXPENSE_TYPES.map((item) => ({ value: item, label: typeLabel(t, language, item) }))} />
              <Select label={copy.category} value={recurringForm.category_id} onChange={(value) => setRecurringForm((p) => ({ ...p, category_id: value }))} options={[{ value: "", label: copy.all }, ...categories.map((item) => ({ value: item.id, label: categoryLabel(t, language, item) }))]} />
              <Select label={copy.payment} value={recurringForm.payment_method} onChange={(value) => setRecurringForm((p) => ({ ...p, payment_method: value }))} options={PAYMENT_METHODS.map((item) => ({ value: item, label: paymentLabel(t, language, item) }))} />
              <Select label={copy.frequency} value={recurringForm.frequency} onChange={(value) => setRecurringForm((p) => ({ ...p, frequency: value }))} options={FREQUENCIES.map((item) => ({ value: item, label: frequencyLabel(t, language, item) }))} />
              <Field label={copy.nextDue} type="date" value={recurringForm.next_due_date} onChange={(value) => setRecurringForm((p) => ({ ...p, next_due_date: value }))} />
              <label className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-3 text-sm font-semibold text-white">
                <input type="checkbox" checked={recurringForm.auto_create} onChange={(event) => setRecurringForm((p) => ({ ...p, auto_create: event.target.checked }))} />
                {copy.autoCreate}
              </label>
              <button type="button" onClick={saveRecurring} className="theme-button-primary w-full justify-center px-4 py-2 text-sm"><Repeat className="h-4 w-4" />{copy.saveRecurring}</button>
            </div>
          </Panel>
          <Panel title={copy.recurring}>
            <CompactTable rows={recurring} columns={["title", "amount", "frequency", "next_due_date", "is_active"]} empty={copy.noRows} moneyColumns={["amount"]} copy={copy} t={t} language={language} />
          </Panel>
        </section>
      ) : null}

      {activeTab === "approvals" ? (
        <Panel title={copy.approvals}>
          <ExpensesTable rows={pendingExpenses} copy={copy} onEdit={editExpense} onAction={setConfirmAction} t={t} language={language} />
        </Panel>
      ) : null}

      {activeTab === "reports" ? (
        <section className="grid gap-4 xl:grid-cols-2">
          <Panel title={copy.reports}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Metric label={copy.totalToday} value={summary.today} />
              <Metric label={copy.totalMonth} value={summary.month} />
              <Metric label={copy.outstandingAdvances} value={summary.advances_outstanding} />
              <Metric label={copy.profitImpact} value={summary.profit_impact} />
            </div>
          </Panel>
          <BreakdownCard title={copy.categories} rows={dashboard?.by_category || []} t={t} language={language} copy={copy} />
          <BreakdownCard title={copy.monthlyTrend} rows={dashboard?.monthly_trend?.map((row) => ({ label: row.month, value: row.value })) || []} t={t} language={language} copy={copy} />
          <BreakdownCard title={copy.byBranch} rows={dashboard?.by_branch || []} t={t} language={language} copy={copy} />
        </section>
      ) : null}

      {confirmAction ? (
        <ConfirmModal action={confirmAction} copy={copy} t={t} language={language} onClose={() => setConfirmAction(null)} onConfirm={() => runExpenseAction(confirmAction)} />
      ) : null}
    </AccountingShell>
  );
}

function KpiGrid({ summary, copy }) {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
      <FinanceMetricCard label={copy.totalToday} value={formatCurrency(summary.today || 0)} tone="rose" icon={<ReceiptText className="h-5 w-5" />} />
      <FinanceMetricCard label={copy.totalMonth} value={formatCurrency(summary.month || 0)} tone="amber" icon={<Wallet className="h-5 w-5" />} />
      <FinanceMetricCard label={copy.pendingApproval} value={summary.pending_approval || 0} tone="cyan" icon={<ShieldCheck className="h-5 w-5" />} />
      <FinanceMetricCard label={copy.outstandingAdvances} value={formatCurrency(summary.advances_outstanding || 0)} tone="violet" icon={<UserRound className="h-5 w-5" />} />
      <FinanceMetricCard label={copy.recurringDue} value={summary.recurring_due || 0} tone="emerald" icon={<Repeat className="h-5 w-5" />} />
      <FinanceMetricCard label={copy.profitImpact} value={formatCurrency(summary.profit_impact || 0)} tone="cyan" icon={<Landmark className="h-5 w-5" />} />
    </div>
  );
}

const inputClass = "w-full rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-3 text-base font-semibold text-white outline-none transition placeholder:text-zinc-500 focus:border-emerald-300/50 focus:bg-white/[0.06] md:px-3 md:py-2.5 md:text-sm";

function Field({ label, value, onChange, type = "text", autoFocus = false, inputMode }) {
  return (
    <label className="block">
      <span className="mb-2 block text-[10px] font-black uppercase tracking-[0.16em] text-zinc-500">{label}</span>
      <input type={type} value={value ?? ""} onChange={(event) => onChange(event.target.value)} className={inputClass} autoFocus={autoFocus} inputMode={inputMode} />
    </label>
  );
}

function Select({ label, value, onChange, options }) {
  return (
    <label className="block">
      <span className="mb-2 block text-[10px] font-black uppercase tracking-[0.16em] text-zinc-500">{label}</span>
      <select value={value ?? ""} onChange={(event) => onChange(event.target.value)} className={inputClass}>
        {options.map((option) => <option key={option.value} value={option.value} className="bg-zinc-950 text-white">{option.label}</option>)}
      </select>
    </label>
  );
}

function employeeInitials(name = "") {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "؟";
  return parts
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function SearchableSelect({ label, value, onChange, options, placeholder, emptyText = "No employee found", isRtl }) {
  const generatedId = useId();
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const selected = options.find((option) => String(option.value) === String(value));
  const [query, setQuery] = useState(selected?.label || "");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const documentRtl = typeof document !== "undefined" && document.documentElement?.dir === "rtl";
  const rtl = Boolean(isRtl ?? (documentRtl || /[\u0600-\u06FF]/.test(`${label} ${placeholder} ${query} ${selected?.label || ""}`)));
  const listId = `employee-combobox-${generatedId.replace(/:/g, "")}`;

  const filteredOptions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery || selected?.label === query) return options;
    return options.filter((option) => {
      const haystack = [option.label, option.code, option.jobTitle, option.branch].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [options, query, selected?.label]);

  useEffect(() => {
    if (!open) setQuery(selected?.label || "");
  }, [open, selected?.label]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, open]);

  useEffect(() => {
    const handlePointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
    };
  }, []);

  const commitOption = (option) => {
    if (!option) return;
    onChange(option.value);
    setQuery(option.label);
    setOpen(false);
    inputRef.current?.focus();
  };

  const handleKeyDown = (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((current) => Math.min(current + 1, Math.max(filteredOptions.length - 1, 0)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((current) => Math.max(current - 1, 0));
    } else if (event.key === "Enter" && open) {
      event.preventDefault();
      commitOption(filteredOptions[activeIndex]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      setQuery(selected?.label || "");
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  };

  return (
    <label className="block" ref={rootRef} dir={rtl ? "rtl" : "ltr"}>
      <span className={`mb-2 block text-[10px] font-black uppercase tracking-[0.16em] text-zinc-500 ${rtl ? "text-right" : "text-left"}`}>{label}</span>
      <div className="relative">
        <Search className={`pointer-events-none absolute top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-emerald-200/70 ${rtl ? "right-3" : "left-3"}`} />
        <input
          ref={inputRef}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={open && filteredOptions[activeIndex] ? `${listId}-${filteredOptions[activeIndex].value}` : undefined}
          value={query}
          onFocus={(event) => {
            setOpen(true);
            setQuery(selected?.label || "");
            window.requestAnimationFrame(() => event.target.select());
          }}
          onChange={(event) => {
            const typed = event.target.value;
            setQuery(typed);
            setOpen(true);
            if (!typed.trim()) onChange("");
            else if (selected && typed !== selected.label) onChange("");
          }}
          onKeyDown={handleKeyDown}
          className={`${inputClass} h-[var(--control-height-lg)] rounded-2xl border-emerald-300/15 bg-slate-950/90 text-sm shadow-inner shadow-black/20 ${open ? "rounded-b-none border-emerald-300/35 ring-2 ring-emerald-300/10" : ""} ${rtl ? "pr-10 pl-9 text-right" : "pl-10 pr-9 text-left"}`}
          placeholder={placeholder}
          dir="auto"
        />
        {open ? (
          <div
            id={listId}
            role="listbox"
            className="absolute left-0 right-0 top-full z-50 max-h-56 origin-top overflow-y-auto rounded-b-2xl border border-t-0 border-emerald-300/20 bg-slate-950/98 p-1.5 shadow-2xl shadow-black/60 ring-1 ring-white/5 backdrop-blur animate-in fade-in zoom-in-95 duration-150"
          >
            {filteredOptions.map((option, index) => {
              const selectedOption = String(option.value) === String(value);
              const activeOption = index === activeIndex;
              return (
                <button
                  id={`${listId}-${option.value}`}
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={selectedOption}
                  onMouseEnter={() => setActiveIndex(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => commitOption(option)}
                  className={`flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-sm transition ${ selectedOption ? "border border-emerald-300/25 bg-emerald-400/15 text-emerald-50 shadow-[0_0_18px_rgba(52,211,153,0.10)]" : activeOption ? "bg-emerald-400/10 text-white" : "text-zinc-200 hover:bg-emerald-400/10 hover:text-white" } ${rtl ? "flex-row-reverse text-right" : "text-left"}`}
                >
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-emerald-300/20 bg-emerald-300/10 text-[11px] font-black text-emerald-100">
                    {option.initials || employeeInitials(option.label)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-black" dir="auto">{option.label}</span>
                    <span className={`mt-0.5 flex gap-1.5 text-[11px] font-semibold text-zinc-500 ${rtl ? "flex-row-reverse justify-start" : ""}`}>
                      {option.jobTitle ? <span className="truncate" dir="auto">{option.jobTitle}</span> : null}
                      {option.jobTitle && option.branch ? <span className="text-zinc-700">•</span> : null}
                      {option.branch ? <span className="truncate" dir="auto">{option.branch}</span> : null}
                      {!option.jobTitle && !option.branch && option.code ? <span dir="auto">{option.code}</span> : null}
                    </span>
                  </span>
                  {selectedOption ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-200" /> : null}
                </button>
              );
            })}
            {!filteredOptions.length ? (
              <div className={`px-3 py-4 text-sm font-semibold text-zinc-500 ${rtl ? "text-right" : "text-left"}`}>{emptyText}</div>
            ) : null}
          </div>
        ) : null}
        {value && !selected ? <span className={`mt-2 block text-xs font-semibold text-amber-200 ${rtl ? "text-right" : "text-left"}`}>#{value}</span> : null}
      </div>
    </label>
  );
}

function Panel({ title, children }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-zinc-950/90 p-4 shadow-2xl shadow-black/10">
      <h3 className="m1-section-title text-white">{title}</h3>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Filters({ filters, setFilters, onApply, copy, t, language }) {
  return (
    <div className="grid gap-2 rounded-2xl border border-white/10 bg-zinc-950/90 p-3 md:grid-cols-[minmax(0,1fr)_10rem_9rem_9rem_auto]">
      <label className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
        <input value={filters.search} onChange={(event) => setFilters((p) => ({ ...p, search: event.target.value }))} className={`${inputClass} ps-9`} placeholder={copy.search} />
      </label>
      <select value={filters.status} onChange={(event) => setFilters((p) => ({ ...p, status: event.target.value }))} className={inputClass}>
        <option value="" className="bg-zinc-950">{copy.all}</option>
        {STATUSES.map((status) => <option key={status} value={status} className="bg-zinc-950">{statusLabel(t, language, status)}</option>)}
      </select>
      <input type="date" value={filters.from} onChange={(event) => setFilters((p) => ({ ...p, from: event.target.value }))} className={inputClass} />
      <input type="date" value={filters.to} onChange={(event) => setFilters((p) => ({ ...p, to: event.target.value }))} className={inputClass} />
      <button type="button" onClick={onApply} className="theme-button-primary justify-center px-4 py-2 text-sm">{copy.apply}</button>
    </div>
  );
}

function ExpensesTable({ rows, copy, onEdit, onAction, t, language }) {
  return (
    <div className="m1-table-container m1-table-container--plain overflow-x-auto rounded-2xl border border-white/10 bg-zinc-950/90">
      <table className="m1-table m1-table--compact w-full min-w-[980px] text-sm">
        <thead className="bg-white/[0.03] text-left text-[10px] uppercase tracking-[0.16em] text-zinc-500">
          <tr><Th>{copy.title}</Th><Th>{copy.category}</Th><Th>{copy.date}</Th><Th>{copy.amount}</Th><Th>{copy.payment}</Th><Th>{copy.status}</Th><Th>{copy.links}</Th><Th>{copy.actions}</Th></tr>
        </thead>
        <tbody>
          {rows.map((expense) => (
            <tr key={expense.id} className="border-t border-white/5 align-top">
              <Td><div className="table-cell-stack"><div className="font-black text-white">{expense.title}</div><div className="mt-1 text-xs text-zinc-500">{expense.notes || expense.note || "-"}</div></div></Td>
              <Td><div className="table-cell-stack"><div>{categoryLabel(t, language, { name: expense.category_name || expense.category, type_key: expense.expense_type })}</div><div className="mt-1 text-xs text-zinc-500">{typeLabel(t, language, expense.expense_type)}</div></div></Td>
              <Td>{String(expense.expense_date || expense.created_at || "").slice(0, 10)}</Td>
              <Td className="font-black text-white"><CurrencyText value={formatCurrency(expense.amount || 0)} /></Td>
              <Td>{expense.payment_method ? paymentLabel(t, language, expense.payment_method) : "-"}</Td>
              <Td><Status value={expense.status} t={t} language={language} /></Td>
              <Td><div className="table-cell-stack text-xs text-zinc-500"><div>{expense.branch_name || (expense.branch_id ? `Branch #${expense.branch_id}` : "-")}</div><div>{expense.employee_name || (expense.employee_id ? `Employee #${expense.employee_id}` : "")}</div><div>{expense.supplier_name || (expense.supplier_id ? `Supplier #${expense.supplier_id}` : "")}</div></div></Td>
              <Td>
                <div className="flex flex-wrap gap-1.5">
                  <IconButton title="تعديل" onClick={() => onEdit(expense)}><Pencil className="h-3.5 w-3.5" /></IconButton>
                  {["draft", "pending_approval", "rejected"].includes(expense.status) ? <IconButton title={copy.approve} onClick={() => onAction({ type: "approve", id: expense.id })}><CheckCircle2 className="h-3.5 w-3.5" /></IconButton> : null}
                  {["draft", "pending_approval", "approved"].includes(expense.status) ? <IconButton title={copy.reject} onClick={() => onAction({ type: "reject", id: expense.id })}><X className="h-3.5 w-3.5" /></IconButton> : null}
                  {expense.status !== "paid" ? <IconButton title={copy.markPaid} onClick={() => onAction({ type: "paid", id: expense.id })}><Wallet className="h-3.5 w-3.5" /></IconButton> : null}
                  {expense.status !== "paid" ? <IconButton title={copy.delete} onClick={() => onAction({ type: "delete", id: expense.id })}><Trash2 className="h-3.5 w-3.5" /></IconButton> : null}
                </div>
              </Td>
            </tr>
          ))}
          {!rows.length ? <tr><td colSpan={8} className="px-4 py-10 text-center text-zinc-500">{copy.noRows}</td></tr> : null}
        </tbody>
      </table>
    </div>
  );
}

function BreakdownCard({ title, rows, t, language, copy }) {
  return (
    <Panel title={title}>
      <div className="space-y-2">
        {rows.map((row, index) => (
          <div key={`${row.label || row.month}-${index}`} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2">
            <span className="min-w-0 truncate text-sm font-semibold text-zinc-200">{row.month || categoryLabel(t, language, row.label || "other")}</span>
            <span className="shrink-0 text-sm font-black text-white"><CurrencyText value={formatCurrency(row.value || 0)} /></span>
          </div>
        ))}
        {!rows.length ? <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.03] p-5 text-sm text-zinc-500">{copy.noData}</div> : null}
      </div>
    </Panel>
  );
}

function TrendCard({ rows }) {
  const max = Math.max(1, ...rows.map((row) => Number(row.value || 0)));
  return (
    <Panel title="الاتجاه الشهري للمصروفات">
      <div className="flex h-48 items-end gap-2 overflow-x-auto">
        {rows.map((row) => (
          <div key={row.month} className="flex min-w-16 flex-1 flex-col items-center gap-2">
            <div className="w-full rounded-t-xl bg-rose-400/70" style={{ height: `${Math.max(8, (Number(row.value || 0) / max) * 160)}px` }} />
            <div className="text-[10px] font-bold text-zinc-500">{row.month}</div>
          </div>
        ))}
        {!rows.length ? <div className="w-full rounded-xl border border-dashed border-white/10 bg-white/[0.03] p-5 text-center text-sm text-zinc-500">لا توجد بيانات للاتجاه</div> : null}
      </div>
    </Panel>
  );
}

function CompactTable({ rows, columns, empty, moneyColumns = [], t, language }) {
  return (
    <div className="m1-table-container overflow-x-auto">
      <table className="m1-table m1-table--compact w-full min-w-[640px] text-sm">
        <thead className="text-left text-[10px] uppercase tracking-[0.16em] text-zinc-500"><tr>{columns.map((col) => <Th key={col}>{col.replace(/_/g, " ")}</Th>)}</tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-t border-white/5">
              {columns.map((col) => (
                <Td key={col}>{formatCompactCell(row, col, { moneyColumns, t, language })}</Td>
              ))}
            </tr>
          ))}
          {!rows.length ? <tr><td colSpan={columns.length} className="px-4 py-8 text-center text-zinc-500">{empty}</td></tr> : null}
        </tbody>
      </table>
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
      <div className="text-[10px] font-black uppercase tracking-[0.16em] text-zinc-500">{label}</div>
      <div className="mt-2 text-xl font-black text-white"><CurrencyText value={formatCurrency(value || 0)} /></div>
    </div>
  );
}

function formatCompactCell(row, col, { moneyColumns = [], t, language } = {}) {
  if (moneyColumns.includes(col)) return <CurrencyText value={formatCurrency(row[col] || 0)} />;
  if (col === "type_key" || col === "expense_type") return typeLabel(t, language, row[col]);
  if (col === "frequency") return frequencyLabel(t, language, row[col]);
  if (col === "is_active") return statusLabel(t, language, row[col] ? "active" : "inactive");
  if (typeof row[col] === "boolean") return booleanLabel(t, language, row[col]);
  return String(row[col] ?? "");
}

function Status({ value, t, language }) {
  return <span className={`inline-flex rounded-full border px-2 py-1 text-[10px] font-black uppercase tracking-[0.08em] ${statusClass(value)}`}>{statusLabel(t, language, value || "-")}</span>;
}

function Th({ children }) {
  return <th className="px-4 py-3 font-black">{children}</th>;
}

function Td({ children, className = "" }) {
  return <td className={`px-4 py-3 text-zinc-300 ${className}`}>{children}</td>;
}

function IconButton({ title, onClick, children }) {
  return (
    <button type="button" onClick={onClick} title={title} className="inline-flex h-[var(--control-height-sm)] w-8 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-zinc-300 transition hover:border-emerald-300/30 hover:bg-emerald-400/10 hover:text-emerald-100">
      {children}
    </button>
  );
}

function ConfirmModal({ action, copy, t, language, onClose, onConfirm }) {
  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <section className="w-full max-w-md rounded-2xl border border-white/10 bg-zinc-950 p-5 shadow-2xl shadow-black/60">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl border border-amber-300/20 bg-amber-400/10 text-amber-100"><AlertTriangle className="h-5 w-5" /></span>
          <div>
            <h3 className="m1-section-title text-white">تأكيد الإجراء</h3>
            <p className="mt-1 text-sm text-zinc-400">This will {statusLabel(t, language, action.type === "paid" ? "paid" : action.type)} expense #{action.id}.</p>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="theme-button-soft px-4 py-2 text-sm">إلغاء</button>
          <button type="button" onClick={onConfirm} className="theme-button-primary px-4 py-2 text-sm">{copy[ action.type === "paid" ? "markPaid" : action.type ] || "Confirm"}</button>
        </div>
      </section>
    </div>
  );
}

export default Expenses;
