import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { AlertTriangle, Banknote, BriefcaseBusiness, CalendarDays, Calculator, CheckCircle2, Coins, CreditCard, ExternalLink, Gavel, Gift, Loader2, Plus, ReceiptText, RefreshCw, Save, Search, ShieldCheck, TrendingUp, WalletCards, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { featureFlags } from "../../../config/featureFlags";
import {
  finalizeSalesEmployeePayroll,
  cancelEmployeePenalty,
  createEmployeePenalty,
  getBranchEmployees,
  getEmployeePenalties,
  getSalesEmployeePayrollPreview,
  getSalesCommissionReport,
  getSalesEmployeeProfiles,
  updateEmployeePenalty,
  updateEmployeePayrollSettings,
  upsertSalesEmployeeProfile,
  updateSalesEmployeeSettings,
} from "../services/salesEmployeesApi";
import { api } from "../../../shared/api/api";
import { logPagePerf } from "../../../shared/lib/perfDebug";
import { useVirtualRows } from "../../../shared/components/VirtualList";
import { getProductsWithVariants } from "../../products/services/productsApi";
import { formatCurrency } from "../../pos/lib/posUtils";

const today = new Date().toISOString().slice(0, 10);
const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
const previousMonthStart = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1).toISOString().slice(0, 10);
const previousMonthEnd = new Date(new Date().getFullYear(), new Date().getMonth(), 0).toISOString().slice(0, 10);

const emptyForm = {
  id: null,
  name: "",
  code: "",
  pos_alias: "",
  phone: "",
  is_active: true,
  commission_type: "percent",
  commission_mode: "percent",
  fixed_commission_mode: "fixed_per_item",
  commission_value: 0,
  excluded_product_ids: [],
  excluded_category_ids: [],
  branch_id: "",
  salary: 0,
  profile_configured: false,
  configured: false,
};

const emptyPenaltyForm = {
  employee_id: "",
  penalty_date: today,
  payroll_period_start: monthStart,
  payroll_period_end: today,
  amount: "",
  reason: "",
  notes: "",
  deduct_from_payroll: true,
  status: "approved",
};

const numberValue = (value) => Number(value || 0);
const formatPayrollMoney = (value) => formatCurrency(value, "en");
const dateLabel = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return date.toISOString().slice(0, 10);
};
const normalizeCommissionMode = (employee = {}) => {
  if (employee.commission_mode) return employee.commission_mode;
  if (employee.commission_type === "none") return "none";
  if (employee.commission_type === "fixed") return employee.fixed_commission_mode === "fixed_per_invoice" ? "fixed_per_invoice" : "fixed_per_item";
  return "percent";
};
const commissionTypeFromMode = (mode) => {
  if (mode === "none") return "none";
  return mode === "percent" ? "percent" : "fixed";
};
const formatCommissionLabel = (employee = {}, t = (key, fallback, options = {}) => options.defaultValue || fallback || key) => {
  const amount = numberValue(employee.commission_value);
  const mode = normalizeCommissionMode(employee);
  if (mode === "none") return t("sales.commission.none", "No commission");
  if (mode === "percent") return t("sales.commission.percentage", "Percentage {{amount}}%", { amount });
  if (mode === "fixed_per_invoice") return t("sales.commission.fixedPerInvoice", "Fixed {{amount}} per invoice", { amount: formatCurrency(amount) });
  return t("sales.commission.fixedPerItem", "Fixed {{amount}} per item", { amount: formatCurrency(amount) });
};
const commissionValueLabel = (mode, t = (key, fallback) => fallback || key) => {
  if (mode === "none") return t("sales.commission.amount", "Commission amount");
  if (mode === "percent") return t("sales.commission.percent", "Commission percent");
  if (mode === "fixed_per_invoice") return t("sales.commission.amountPerInvoice", "Commission amount per invoice (EGP)");
  return t("sales.commission.amountPerItem", "Commission amount per sold item (EGP)");
};
const commissionZeroHint = (row = {}, t = (key, fallback) => fallback || key) => {
  const reason = String(row.zero_reason || "").trim();
  if (!reason) return "";
  if (reason === "Commission disabled") return t("sales.commission.disabled", "Commission disabled");
  if (reason === "No commission profile") return t("sales.commission.noRule", "No commission rule");
  return reason;
};
const normalizeEmployeeRow = (employee = {}) => ({
  ...employee,
  id: employee.id || employee.employee_id,
  name: employee.name || employee.full_name || employee.employee_name || "Employee",
  code: employee.code || employee.employee_code || "",
  base_salary: Number(employee.base_salary ?? employee.salary ?? 0),
  salary: Number(employee.salary ?? employee.base_salary ?? 0),
});
const mergeEmployeesWithProfiles = (branchEmployees = [], profiles = []) => {
  const profileByEmployeeId = new Map(profiles.map((profile) => [String(profile.employee_id || profile.id), profile]));
  return branchEmployees.map((row) => {
    const employee = normalizeEmployeeRow(row);
    const profile = profileByEmployeeId.get(String(employee.id)) || {};
    const configured = Boolean(profile.profile_configured || profile.configured || profile.employee_id || profile.migrated_sales_employee_id || profile.updated_at);
    return {
      ...employee,
      ...profile,
      id: employee.id,
      name: employee.name,
      code: employee.code,
      phone: employee.phone || profile.phone || "",
      branch_id: employee.branch_id || profile.branch_id || "",
      branch_name: employee.branch_name || profile.branch_name || "",
      salary: employee.salary,
      base_salary: employee.base_salary,
      profile_configured: configured,
      configured,
      active_for_pos: Boolean(profile.active_for_pos || profile.is_sales_active),
      is_sales_active: Boolean(profile.active_for_pos || profile.is_sales_active),
      is_active: String(employee.status || "active").toLowerCase() === "active",
      commission_type: profile.commission_type || "percent",
      fixed_commission_mode: profile.fixed_commission_mode || "fixed_per_item",
      commission_mode: configured ? normalizeCommissionMode(profile) : "percent",
      commission_value: Number(profile.commission_value || 0),
      excluded_product_ids: profile.excluded_product_ids || [],
      excluded_category_ids: profile.excluded_category_ids || [],
    };
  });
};
const branchRows = (payload) => {
  const rows = Array.isArray(payload) ? payload : payload?.branches || payload?.data || [];
  return rows.filter(Boolean);
};
const employeeRows = (payload) => {
  const rows = Array.isArray(payload) ? payload : payload?.employees || payload?.data || [];
  return rows.filter(Boolean);
};
const isActiveEmployeeRow = (employee = {}) => {
  if (employee.is_active === false || employee.active === false || employee.is_deleted === true) return false;
  const status = String(employee.status || "active").trim().toLowerCase();
  return !["inactive", "disabled", "deleted", "false", "0"].includes(status);
};
const buildEmployeeOptions = (rows = []) => {
  const seen = new Set();
  return rows
    .map(normalizeEmployeeRow)
    .filter((item) => item.id !== undefined && item.id !== null && item.id !== "")
    .filter((item) => {
      const key = String(item.id);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((item) => ({ value: String(item.id), label: item.name || "Employee" }));
};
const productCategoryId = (product = {}) => product.category_id || product.main_category_id || product.categoryId || product.mainCategoryId || null;
const productCategoryName = (product = {}) => product.category_name || product.main_category_name || product.category || product.main_category || "";
const logSalesStaffDebug = (...args) => {
  if (typeof import.meta !== "undefined" && import.meta.env?.DEV) console.debug(...args);
};
const rowEmployeeId = (row = {}) => row.sales_employee_id ?? row.employee_id ?? row.salesperson_id ?? row.id;
const matchEmployeeId = (left, right) => String(left || "") === String(right || "");
const numberFrom = (...values) => {
  const value = values.find((item) => item !== undefined && item !== null && item !== "");
  return Number(value || 0);
};
const payrollNumber = (value) => {
  if (value === undefined || value === null || value === "") return 0;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : NaN;
};
const monthRangeFromAnchor = (anchorValue, offset = 0) => {
  const anchor = new Date(`${String(anchorValue || today).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(anchor.getTime())) {
    const fallback = new Date(`${today}T00:00:00Z`);
    const start = new Date(Date.UTC(fallback.getUTCFullYear(), fallback.getUTCMonth() + offset, 1));
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
    return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10), period: start.toISOString().slice(0, 7) };
  }
  const start = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + offset, 1));
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10), period: start.toISOString().slice(0, 7) };
};
const payrollPeriodLabel = (start, end) => {
  const date = new Date(`${String(start || "").slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return `${String(start || "-")} - ${String(end || "-")}`;
  return date.toLocaleDateString(undefined, { month: "short", year: "numeric" });
};

const SalesEmployeeRow = memo(function SalesEmployeeRow({ employee, t, onConfigure }) {
  const mode = normalizeCommissionMode(employee);
  const activeForPos = Boolean(employee.active_for_pos || employee.is_sales_active);
  return (
    <tr className="border-t border-[var(--border)] transition hover:bg-white/[0.03]">
      <td className="px-4 py-3">
        <div className="table-cell-stack" dir="auto">
          <div className="font-black">{employee.name}</div>
          <div className="mt-0.5 text-xs text-[var(--muted)]">{employee.code || t("sales.staff.noCode", "No code")} - {employee.phone || t("sales.staff.noPhone", "No phone")}</div>
        </div>
      </td>
      <td className="px-4 py-3">
        {employee.pos_alias ? (
          <span className="inline-flex rounded-xl border border-[var(--primary)]/25 bg-[var(--primary-soft)] px-2.5 py-1 text-xs font-black text-[var(--primary)]" dir="auto">{employee.pos_alias}</span>
        ) : (
          <span className="text-[var(--muted)]">-</span>
        )}
      </td>
      <td className="px-4 py-3 font-semibold text-[var(--muted)]">{employee.configured ? formatCommissionLabel(employee, t) : t("sales.staff.noSettings", "No sales settings")}</td>
      <td className="px-4 py-3 text-end font-black tabular-nums">
        {mode === "none" ? "-" : mode === "percent" ? `${numberValue(employee.commission_value)}%` : formatCurrency(employee.commission_value || 0)}
      </td>
      <td className="px-4 py-3">
        <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-black ${activeForPos ? "bg-emerald-500/15 text-emerald-200" : "bg-amber-500/15 text-amber-100"}`}>
          {activeForPos ? t("sales.staff.activeForPos", "Active for POS") : t("sales.staff.posDisabled", "POS disabled")}
        </span>
        {!employee.configured ? <div className="mt-1 text-[10px] font-semibold text-[var(--muted)]">{t("sales.staff.notConfigured", "Not configured")}</div> : null}
      </td>
      <td className="px-4 py-3 text-end">
        <button type="button" onClick={() => onConfigure(employee)} className="theme-button-soft h-[36px] px-3 text-xs">
          {t("sales.staff.configure", "Configure")}
        </button>
      </td>
    </tr>
  );
});

const CommissionReportRow = memo(function CommissionReportRow({ row, t }) {
  return (
    <tr className="border-t border-[var(--border)] transition hover:bg-white/[0.03]">
      <td className="px-4 py-3 font-bold" dir="auto">{row.salesperson_name}</td>
      <td className="px-4 py-3 text-end tabular-nums">{formatCurrency(row.total_sales)}</td>
      <td className="px-4 py-3 text-end tabular-nums">{row.total_invoices}</td>
      <td className="px-4 py-3 text-end tabular-nums">{row.total_items_sold}</td>
      <td className="px-4 py-3 text-end tabular-nums">{row.returns_refunds}</td>
      <td className="px-4 py-3 text-end tabular-nums">{formatCurrency(row.net_sales)}</td>
      <td className="px-4 py-3 text-end font-black tabular-nums text-emerald-300">
        <div>{formatCurrency(row.earned_commissions)}</div>
        {row.net_sales > 0 && row.earned_commissions <= 0 && commissionZeroHint(row, t) ? (
          <div className="mt-1 text-[10px] font-semibold text-[var(--muted)]">{commissionZeroHint(row, t)}</div>
        ) : null}
      </td>
    </tr>
  );
});

const PenaltyRow = memo(function PenaltyRow({ penalty, t, onApprove, onCancel }) {
  return (
    <tr className="border-t border-[var(--border)] transition hover:bg-white/[0.03]">
      <td className="px-4 py-3 tabular-nums" dir="ltr">{String(penalty.penalty_date || "").slice(0, 10)}</td>
      <td className="px-4 py-3">
        <div className="table-cell-stack" dir="auto">
          <div className="font-bold">{penalty.reason}</div>
          {penalty.notes ? <div className="mt-0.5 text-xs text-[var(--muted)]">{penalty.notes}</div> : null}
        </div>
      </td>
      <td className="px-4 py-3 tabular-nums" dir="ltr">
        {String(penalty.payroll_period_start || "").slice(0, 10) || "-"} - {String(penalty.payroll_period_end || "").slice(0, 10) || "-"}
      </td>
      <td className="px-4 py-3 text-end font-black tabular-nums" dir="ltr">{formatPayrollMoney(penalty.amount || 0)}</td>
      <td className="px-4 py-3">{penalty.deduct_from_payroll ? t("sales.penalties.yes", "Yes") : t("sales.penalties.no", "No")}</td>
      <td className="px-4 py-3">
        <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-black ${penaltyStatusClass(penalty.status)}`}>
          {t(`sales.penalties.status.${penalty.status || "pending"}`, penalty.status || "pending")}
        </span>
      </td>
      <td className="px-4 py-3 text-end">
        <div className="flex justify-end gap-2">
          {penalty.status !== "approved" ? (
            <button type="button" onClick={() => onApprove(penalty)} className="theme-button-soft h-9 px-3 text-xs">
              {t("sales.penalties.status.approved", "\u0645\u0639\u062a\u0645\u062f")}
            </button>
          ) : null}
          {penalty.status !== "cancelled" ? (
            <button type="button" onClick={() => onCancel(penalty)} className="theme-button-soft h-9 px-3 text-xs text-rose-200">
              {t("sales.penalties.status.cancelled", "\u0645\u0644\u063a\u064a")}
            </button>
          ) : null}
        </div>
      </td>
    </tr>
  );
});

function SalesEmployees({ defaultTab = "staff", visibleTabs = null, embedded = false }) {
  const pageStartedAtRef = useRef(performance.now());
  const firstDataLoggedRef = useRef(false);
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const isRtl = String(i18n.language || "").toLowerCase().startsWith("ar");
  const direction = isRtl ? "rtl" : "ltr";
  const eyebrowClass = isRtl
    ? "text-xs font-black leading-6 text-[var(--primary)]"
    : "text-xs font-black uppercase tracking-[0.2em] text-[var(--primary)]";
  const mutedLabelClass = isRtl
    ? "text-xs font-bold leading-6 text-[var(--muted)]"
    : "text-xs font-bold uppercase tracking-[0.14em] text-[var(--muted)]";
  const tableHeadClass = isRtl
    ? "bg-[var(--surface)] text-right text-xs font-bold leading-6 text-[var(--muted)]"
    : "bg-[var(--surface)] text-left text-xs uppercase tracking-[0.14em] text-[var(--muted)]";
  const [employees, setEmployees] = useState([]);
  const [penaltyEmployees, setPenaltyEmployees] = useState([]);
  const [branches, setBranches] = useState([]);
  const [lastEmployeeFetchCount, setLastEmployeeFetchCount] = useState(0);
  const [activeTab, setActiveTab] = useState(defaultTab);
  const [isConfigDrawerOpen, setIsConfigDrawerOpen] = useState(false);
  const [settings, setSettings] = useState({ allow_sale_without_salesperson: true, fixed_commission_mode: "fixed_per_item" });
  const [products, setProducts] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [selectedBranchId, setSelectedBranchId] = useState("");
  const [rangeMode, setRangeMode] = useState("current");
  const [filters, setFilters] = useState({ start_date: monthStart, end_date: today, employee_id: "" });
  const [appliedReportFilters, setAppliedReportFilters] = useState({ start_date: monthStart, end_date: today, employee_id: "", branch_id: "" });
  const [payroll, setPayroll] = useState({ employee_id: "", base_salary: 0, bonuses: 0, deductions: 0 });
  const [payrollEmployeeAdjusted, setPayrollEmployeeAdjusted] = useState(false);
  const [report, setReport] = useState({ rows: [], summary: {} });
  const [payrollPreview, setPayrollPreview] = useState(null);
  const [payrollHistory, setPayrollHistory] = useState([]);
  const [payrollHistoryLoading, setPayrollHistoryLoading] = useState(false);
  const [payrollCalculating, setPayrollCalculating] = useState(false);
  const [payrollFinalizing, setPayrollFinalizing] = useState(false);
  const [payrollCalculateStatus, setPayrollCalculateStatus] = useState("");
  const [penalties, setPenalties] = useState([]);
  const [penaltyForm, setPenaltyForm] = useState(emptyPenaltyForm);
  const [penaltiesLoading, setPenaltiesLoading] = useState(false);
  const [penaltySaving, setPenaltySaving] = useState(false);
  const [payrollSettingsSaving, setPayrollSettingsSaving] = useState(false);
  const [gamificationSettings, setGamificationSettings] = useState({});
  const [gamificationSaving, setGamificationSaving] = useState(false);
  const [rewardForm, setRewardForm] = useState({ employee_id: "", title: "", points_cost: 0, admin_note: "" });
  const [walletQaChecks, setWalletQaChecks] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [productSearch, setProductSearch] = useState("");
  const lastSyncedReportEmployeeIdRef = useRef("");
  const payrollHistoryRequestRef = useRef(0);
  const staffTableRef = useRef(null);
  const reportTableRef = useRef(null);
  const penaltiesTableRef = useRef(null);

  const selectedBranchName = useMemo(
    () => branches.find((branch) => String(branch.id) === String(selectedBranchId))?.name || "",
    [branches, selectedBranchId]
  );
  const branchOptions = useMemo(
    () => branches.map((branch) => ({ value: String(branch.id), label: branch.name || branch.code || `الفرع ${branch.id}` })),
    [branches]
  );
  const employeeOptions = useMemo(() => {
    const options = buildEmployeeOptions(employees);
    if (lastEmployeeFetchCount > 0 && options.length === 0) {
      logSalesStaffDebug("[sales-staff] normalized employee selector options empty", {
        selectedBranchId,
        fetchedEmployeeCount: lastEmployeeFetchCount,
        normalizedOptions: options,
        normalizedEmployees: employees,
      });
    }
    return options;
  }, [employees, lastEmployeeFetchCount, selectedBranchId]);
  const penaltyEmployeeOptions = useMemo(() => buildEmployeeOptions(penaltyEmployees), [penaltyEmployees]);
  const selectedPenaltyEmployeeInList = useMemo(
    () => penaltyEmployeeOptions.some((option) => matchEmployeeId(option.value, penaltyForm.employee_id)),
    [penaltyEmployeeOptions, penaltyForm.employee_id]
  );

  const filteredProducts = useMemo(() => {
    const q = productSearch.trim().toLowerCase();
    return products
      .filter((item) => !q || `${item.name || item.product_name || ""} ${item.sku || ""}`.toLowerCase().includes(q))
      .slice(0, 12);
  }, [products, productSearch]);

  const payrollReportRow = useMemo(
    () => (report.rows || []).find((row) => matchEmployeeId(rowEmployeeId(row), payroll.employee_id)),
    [report.rows, payroll.employee_id]
  );
  const payrollEmployee = useMemo(
    () => employees.find((item) => matchEmployeeId(item.id, payroll.employee_id)) || null,
    [employees, payroll.employee_id]
  );
  const safePayrollPreview = payrollPreview ?? null;
  const payrollSnapshot = safePayrollPreview?.payroll || {};
  const payrollCurrentNet = numberValue(payrollSnapshot.net_pay ?? payrollSnapshot.final_salary);
  const payrollBaseSalary = numberValue(payrollSnapshot.base_salary ?? payroll.base_salary ?? payrollEmployee?.salary ?? payrollEmployee?.base_salary ?? 0);
  const payrollCommissions = numberValue(payrollSnapshot.sales_earnings ?? payrollSnapshot.commissions ?? 0);
  const payrollBonuses = numberValue(payrollSnapshot.bonuses ?? payroll.bonuses ?? 0);
  const payrollManualDeductions = numberValue(payrollSnapshot.manual_deductions ?? payroll.deductions ?? 0);
  const payrollAdvanceDeductions = numberValue(payrollSnapshot.advance_deductions ?? 0);
  const payrollPenaltyDeductions = numberValue(payrollSnapshot.penalty_deductions ?? payrollSnapshot.penalties_total ?? 0);
  const payrollAttendanceDeductions = numberValue(payrollSnapshot.attendance_deduction_total ?? payrollSnapshot.absence_deductions ?? 0);
  const payrollLateDeductions = numberValue(payrollSnapshot.late_deduction ?? 0);
  const payrollAttendanceOnlyDeductions = Math.max(0, payrollAttendanceDeductions - payrollLateDeductions);
  const payrollTotalDeductions = numberValue(payrollSnapshot.deductions ?? payrollManualDeductions + payrollAdvanceDeductions + payrollPenaltyDeductions + payrollAttendanceDeductions);
  const payrollSubtotal = payrollBaseSalary + payrollCommissions + payrollBonuses;
  const payrollStatusIssues = useMemo(() => {
    const issues = [];
    const hasEmployee = Boolean(payroll.employee_id);
    if (!hasEmployee) {
      issues.push({ key: "employee", label: t("sales.payroll.selectEmployee", "اختر الموظف") });
      return issues;
    }
    if (!payrollEmployee) {
      issues.push({ key: "employee_missing", label: t("sales.payroll.missingEmployee", "بيانات الموظف غير موجودة") });
    }
    if (!payrollBaseSalary) {
      issues.push({ key: "salary", label: t("sales.payroll.missingSalarySetup", "إعداد المرتب غير مكتمل") });
    }
    if (!safePayrollPreview) {
      issues.push({ key: "preview", label: t("sales.payroll.calculatePrompt", "احسب الراتب لمراجعة الإجماليات") });
      return issues;
    }
    if (numberValue(payrollSnapshot.expected_working_days) > 0 && numberValue(payrollSnapshot.attended_days) === 0) {
      issues.push({ key: "attendance", label: t("sales.payroll.missingAttendanceData", "بيانات حضور ناقصة") });
    }
    if (numberValue(payrollSnapshot.qr_records_count) === 0 && numberValue(payrollSnapshot.expected_working_days) > 0) {
      issues.push({ key: "attendance_records", label: t("sales.payroll.unresolvedAttendanceRecords", "سجلات حضور غير محسومة") });
    }
    if ((safePayrollPreview?.employee_advances || []).some((advance) => String(advance.status || advance.deduction_status || "").toLowerCase() !== "settled")) {
      issues.push({ key: "advance", label: t("sales.payroll.pendingAdvanceRequest", "طلبات سلفة معلقة") });
    }
    return issues;
  }, [payroll.employee_id, payrollBaseSalary, payrollEmployee, payrollSnapshot, safePayrollPreview, t]);
  const payrollStatus = useMemo(() => {
    if (!payroll.employee_id) {
      return { key: "BLOCKED", label: t("sales.payroll.blocked", "يوجد أخطاء تمنع الاعتماد"), tone: "rose" };
    }
    if (!payrollBaseSalary) {
      return { key: "BLOCKED", label: t("sales.payroll.blocked", "يوجد أخطاء تمنع الاعتماد"), tone: "rose" };
    }
    if (!safePayrollPreview) {
      return { key: "REQUIRES_REVIEW", label: t("sales.payroll.requiresReview", "يحتاج مراجعة"), tone: "amber" };
    }
    const blockedIssue = payrollStatusIssues.find((issue) =>
      ["salary", "attendance", "attendance_records", "employee_missing"].includes(issue.key)
    );
    if (blockedIssue) {
      return { key: "BLOCKED", label: t("sales.payroll.blocked", "يوجد أخطاء تمنع الاعتماد"), tone: "rose" };
    }
    if (payrollStatusIssues.length) {
      return { key: "REQUIRES_REVIEW", label: t("sales.payroll.requiresReview", "يحتاج مراجعة"), tone: "amber" };
    }
    return { key: "READY_FOR_APPROVAL", label: t("sales.payroll.readyForApproval", "جاهز للاعتماد"), tone: "emerald" };
  }, [payroll.employee_id, payrollBaseSalary, payrollStatusIssues, safePayrollPreview, t]);
  const payrollChangeIndicator = useMemo(() => {
    const previous = payrollHistory[1]?.payroll || null;
    const previousNet = numberValue(previous?.net_pay ?? previous?.final_salary);
    if (!previousNet) return null;
    const delta = payrollCurrentNet - previousNet;
    const percent = previousNet ? (delta / previousNet) * 100 : 0;
    return { delta, percent };
  }, [payrollCurrentNet, payrollHistory]);
  const payrollChecklist = useMemo(() => {
    const hasPreview = Boolean(safePayrollPreview);
    return [
      { label: t("sales.payroll.attendanceCalculated", "تم احتساب الحضور"), passed: Boolean(hasPreview && numberValue(payrollSnapshot.expected_working_days) >= 0) },
      { label: t("sales.payroll.commissionsCalculated", "تم احتساب العمولات"), passed: Boolean(hasPreview) },
      { label: t("sales.payroll.advancesApplied", "تم تطبيق السلف"), passed: Boolean(hasPreview) },
      { label: t("sales.payroll.deductionsApplied", "تم تطبيق الخصومات"), passed: Boolean(hasPreview) },
      { label: t("sales.payroll.noPendingIssues", "لا توجد مشكلات رواتب معلقة"), passed: payrollStatus.key === "READY_FOR_APPROVAL" },
    ];
  }, [payrollSnapshot.expected_working_days, payrollStatus.key, safePayrollPreview, t]);
  const payrollHistoryRows = useMemo(() => {
    const currentPeriod = String(filters.end_date || today).slice(0, 7);
    return payrollHistory.map((row) => ({
      ...row,
      isCurrent: row.period === currentPeriod,
    }));
  }, [filters.end_date, payrollHistory]);
  const payrollPortalUrl = useMemo(() => {
    const token = payrollEmployee?.employee_portal_token;
    if (!token) return "";
    const origin = String(import.meta.env.VITE_PUBLIC_APP_URL || import.meta.env.PUBLIC_APP_URL || window.location.origin || "").replace(/\/+$/, "");
    return `${origin}/employee-portal/${encodeURIComponent(token)}`;
  }, [payrollEmployee?.employee_portal_token]);
  const showEmployeeGamificationSettings = featureFlags.showEmployeeGamificationSettings;
  const employeeWalletQaItems = [];
  const completedWalletQaCount = 0;
  const effectivePayrollPortalUrl = payrollPortalUrl;
  const pendingPortalRequestCount = 0;
  const showEmployeeWalletQa = false;

  useEffect(() => {
    if (!payroll.employee_id || !selectedBranchId) {
      setPayrollHistory([]);
      return undefined;
    }
    const requestId = payrollHistoryRequestRef.current + 1;
    payrollHistoryRequestRef.current = requestId;
    let active = true;
    const employeeId = String(payroll.employee_id);
    const baseSalary = numberValue(payrollEmployee?.salary ?? payrollEmployee?.base_salary ?? 0);
    const periods = Array.from({ length: 6 }, (_, index) => monthRangeFromAnchor(filters.end_date || today, -index));
    setPayrollHistoryLoading(true);
    Promise.all(
      periods.map(async (period) => {
        try {
          const response = await getSalesEmployeePayrollPreview(employeeId, {
            branch_id: selectedBranchId,
            start: period.start,
            end: period.end,
            base_salary: baseSalary,
            bonuses: 0,
            deductions: 0,
            deduction_month: period.period,
          });
          const payrollData = response?.payroll || {};
          return {
            period: period.period,
            label: payrollPeriodLabel(period.start, period.end),
            start: period.start,
            end: period.end,
            payroll: payrollData,
            isCurrent: period.period === String(filters.end_date || today).slice(0, 7),
            finalized: Boolean(response?.payroll_run),
          };
        } catch (error) {
          return {
            period: period.period,
            label: payrollPeriodLabel(period.start, period.end),
            start: period.start,
            end: period.end,
            payroll: {
              base_salary: baseSalary,
              sales_earnings: 0,
              commissions: 0,
              bonuses: 0,
              deductions: 0,
              net_pay: baseSalary,
            },
            isCurrent: period.period === String(filters.end_date || today).slice(0, 7),
            finalized: false,
          };
        }
      })
    ).then((rows) => {
      if (!active || payrollHistoryRequestRef.current !== requestId) return;
      setPayrollHistory(rows.filter(Boolean));
    }).finally(() => {
      if (!active || payrollHistoryRequestRef.current !== requestId) return;
      setPayrollHistoryLoading(false);
    });
    return () => {
      active = false;
    };
  }, [filters.end_date, payroll.employee_id, payrollEmployee, selectedBranchId]);

  const categories = useMemo(() => {
    const byId = new Map();
    products.forEach((product) => {
      const id = Number(productCategoryId(product));
      if (!Number.isInteger(id) || id <= 0) return;
      if (!byId.has(id)) byId.set(id, { id, name: productCategoryName(product) || `Category ${id}` });
    });
    return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [products]);

  const loadAll = async (branchId = selectedBranchId, nextFilters = filters) => {
    try {
      setLoading(true);
      const effectiveBranchId = branchId || "";
      const effectiveEmployeeId = String(effectiveBranchId) === String(selectedBranchId) ? nextFilters.employee_id : "";
      logSalesStaffDebug("[sales-staff] selected branch id", effectiveBranchId);
      const [branchEmployeesRes, profilesRes, productsRes, reportRes] = await Promise.all([
        getBranchEmployees({ branch_id: effectiveBranchId, active: true }).catch((error) => {
          logSalesStaffDebug("[sales-staff] branch employee fetch failed", {
            selectedBranchId: effectiveBranchId,
            status: error?.status,
            message: error?.message,
            responseBody: error?.responseBody,
          });
          return null;
        }),
        getSalesEmployeeProfiles({ params: { include_inactive: true, branch_id: effectiveBranchId } }),
        getProductsWithVariants(),
        getSalesCommissionReport({ ...nextFilters, employee_id: effectiveEmployeeId, branch_id: effectiveBranchId }),
      ]);
      const profiles = profilesRes.profiles || profilesRes.employees || [];
      const fetchedEmployeeRows = employeeRows(branchEmployeesRes);
      const activeEmployeeRows = fetchedEmployeeRows.filter(isActiveEmployeeRow);
      logSalesStaffDebug("[sales-staff] branch employees response", {
        selectedBranchId: effectiveBranchId,
        fetchedEmployeeCount: fetchedEmployeeRows.length,
        rawResponsePayload: branchEmployeesRes,
      });
      setLastEmployeeFetchCount(fetchedEmployeeRows.length);
      setPenaltyEmployees(activeEmployeeRows.map(normalizeEmployeeRow));
      const branchEmployees = mergeEmployeesWithProfiles(activeEmployeeRows, profiles);
      setEmployees(branchEmployees);
      if (!firstDataLoggedRef.current) {
        firstDataLoggedRef.current = true;
        logPagePerf("employees.sales", pageStartedAtRef.current, { first_data_ms: Math.round(performance.now() - pageStartedAtRef.current), employees: branchEmployees.length });
      }
      setSettings(profilesRes.settings || settings);
      setProducts(Array.isArray(productsRes) ? productsRes : []);
      setReport({ rows: reportRes.rows || [], summary: reportRes.summary || {} });
      setAppliedReportFilters({ ...nextFilters, employee_id: effectiveEmployeeId, branch_id: effectiveBranchId });
      setFilters((prev) => (branchEmployees.some((employee) => String(employee.id) === String(prev.employee_id)) ? prev : { ...prev, employee_id: "" }));
      setPayroll((prev) => {
        if (branchEmployees.some((employee) => String(employee.id) === String(prev.employee_id))) return prev;
        return {
          ...prev,
          employee_id: branchEmployees[0]?.id ? String(branchEmployees[0].id) : "",
          base_salary: branchEmployees[0]?.salary ?? branchEmployees[0]?.base_salary ?? 0,
          deductions: 0,
        };
      });
      setPenaltyForm((prev) => {
        const payrollEmployeeId = payroll.employee_id ? String(payroll.employee_id) : "";
        const hasPrevious = activeEmployeeRows.some((employee) => matchEmployeeId(employee.id, prev.employee_id));
        const hasPayrollEmployee = activeEmployeeRows.some((employee) => matchEmployeeId(employee.id, payrollEmployeeId));
        return {
          ...prev,
          employee_id: hasPrevious ? prev.employee_id : hasPayrollEmployee ? payrollEmployeeId : "",
          payroll_period_start: nextFilters.start_date || prev.payroll_period_start || monthStart,
          payroll_period_end: nextFilters.end_date || prev.payroll_period_end || today,
        };
      });
      setPayrollPreview(null);
    } catch (error) {
      toast.error(error?.message || t("sales.errors.loadStaff", "Failed to load sales staff"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      logPagePerf("employees.sales", pageStartedAtRef.current, { page_mount_ms: Math.round(performance.now() - pageStartedAtRef.current) });
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const bootstrap = async () => {
      try {
        const branchesRes = await api.get("/branches");
        const rows = branchRows(branchesRes).filter((branch) => branch.is_active !== false);
        setBranches(rows);
        const initialBranchId = rows[0]?.id ? String(rows[0].id) : "";
        if (initialBranchId) {
          setSelectedBranchId(initialBranchId);
          setForm((prev) => ({ ...prev, branch_id: prev.branch_id || initialBranchId }));
        }
        await loadAll(initialBranchId);
    } catch (error) {
        toast.error(error?.message || t("sales.errors.loadBranches", "تعذر تحميل الفروع"));
        await loadAll("");
      }
    };
    bootstrap();
  }, []);

  useEffect(() => {
    if (loading) return undefined;
    const frame = window.requestAnimationFrame(() => {
      logPagePerf("employees.sales", pageStartedAtRef.current, { render_complete_ms: Math.round(performance.now() - pageStartedAtRef.current), employees: employees.length });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [loading, employees.length]);

  const refreshReport = async () => {
    const reportRes = await getSalesCommissionReport({ ...filters, branch_id: selectedBranchId });
    setReport({ rows: reportRes.rows || [], summary: reportRes.summary || {} });
    setAppliedReportFilters({ ...filters, branch_id: selectedBranchId });
  };

  const updatePayrollField = (field, value) => {
    setPayrollCalculateStatus("");
    setPayroll((prev) => ({ ...prev, [field]: value }));
  };

  const loadPenalties = async (employeeId = penaltyForm.employee_id || payroll.employee_id) => {
    if (!employeeId) {
      setPenalties([]);
      return;
    }
    try {
      setPenaltiesLoading(true);
      const data = await getEmployeePenalties(employeeId);
      setPenalties(data.penalties || []);
    } catch (error) {
      toast.error(error?.message || t("sales.penalties.loadError", "Unable to load penalties"));
    } finally {
      setPenaltiesLoading(false);
    }
  };

  const updatePenaltyForm = (field, value) => {
    setPenaltyForm((prev) => ({ ...prev, [field]: value }));
  };

  const updatePayrollEmployeeSetting = (field, value) => {
    setEmployees((prev) => prev.map((employee) => (
      matchEmployeeId(employee.id, payroll.employee_id) ? { ...employee, [field]: value } : employee
    )));
  };

  const savePenalty = async () => {
    const employeeId = penaltyForm.employee_id;
    const amount = payrollNumber(penaltyForm.amount);
    if (!employeeId) {
      toast.error(t("sales.penalties.employeeRequired", "Employee is required"));
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error(t("sales.penalties.amountRequired", "Penalty amount must be greater than zero"));
      return;
    }
    if (!String(penaltyForm.reason || "").trim()) {
      toast.error(t("sales.penalties.reasonRequired", "Reason is required"));
      return;
    }
    try {
      setPenaltySaving(true);
      await createEmployeePenalty(employeeId, {
        ...penaltyForm,
        amount,
      });
      toast.success(t("sales.penalties.createSuccess", "Penalty added"));
      setPenaltyForm((prev) => ({
        ...emptyPenaltyForm,
        employee_id: prev.employee_id,
        payroll_period_start: filters.start_date || monthStart,
        payroll_period_end: filters.end_date || today,
      }));
      await loadPenalties(employeeId);
      if (String(payroll.employee_id) === String(employeeId)) await previewPayroll();
    } catch (error) {
      toast.error(error?.message || t("sales.penalties.createError", "Unable to add penalty"));
    } finally {
      setPenaltySaving(false);
    }
  };

  const setPenaltyStatus = async (penalty, status) => {
    try {
      await updateEmployeePenalty(penalty.id, { status });
      await loadPenalties(penalty.employee_id || penaltyForm.employee_id);
      if (String(payroll.employee_id) === String(penalty.employee_id || penaltyForm.employee_id)) await previewPayroll();
    } catch (error) {
      toast.error(error?.message || t("sales.penalties.updateError", "Unable to update penalty"));
    }
  };

  const cancelPenalty = async (penalty) => {
    try {
      await cancelEmployeePenalty(penalty.id);
      await loadPenalties(penalty.employee_id || penaltyForm.employee_id);
      if (String(payroll.employee_id) === String(penalty.employee_id || penaltyForm.employee_id)) await previewPayroll();
    } catch (error) {
      toast.error(error?.message || t("sales.penalties.updateError", "Unable to update penalty"));
    }
  };

  const changeBranch = async (branchId) => {
    const nextBranchId = String(branchId || "");
    setSelectedBranchId(nextBranchId);
    setFilters((prev) => ({ ...prev, employee_id: "" }));
    setAppliedReportFilters((prev) => ({ ...prev, branch_id: nextBranchId, employee_id: "" }));
    setForm({ ...emptyForm, branch_id: nextBranchId });
    setPayroll((prev) => ({ ...prev, employee_id: "", deductions: 0 }));
    setPayrollEmployeeAdjusted(false);
    setPayrollPreview(null);
    setPayrollCalculateStatus("");
    setPenaltyForm({ ...emptyPenaltyForm, payroll_period_start: filters.start_date || monthStart, payroll_period_end: filters.end_date || today });
    setPenalties([]);
    await loadAll(nextBranchId);
  };

  const saveEmployee = async () => {
    try {
      if (!form.id) {
        toast.error("Select an employee before saving sales settings");
        return;
      }
      if (branches.length > 0 && !selectedBranchId) {
        toast.error("Select a branch for this employee");
        return;
      }
      const alias = String(form.pos_alias || "").trim();
      if (alias && (alias.length < 2 || alias.length > 10)) {
        toast.error("POS Alias should be 2 to 10 characters");
        return;
      }
      setSaving(true);
      const payload = {
        ...form,
        pos_alias: alias || null,
        branch_id: selectedBranchId || null,
        commission_type: commissionTypeFromMode(form.commission_mode),
        fixed_commission_mode: form.commission_mode === "fixed_per_invoice" ? "fixed_per_invoice" : "fixed_per_item",
        commission_value: numberValue(form.commission_value),
        excluded_product_ids: form.excluded_product_ids.map(Number),
        excluded_category_ids: form.excluded_category_ids.map(Number),
      };
      await upsertSalesEmployeeProfile(form.id, payload);
      toast.success("Sales settings saved");
      setForm({ ...emptyForm, branch_id: selectedBranchId });
      setIsConfigDrawerOpen(false);
      await loadAll(selectedBranchId, filters);
    } catch (error) {
      toast.error(error?.message || "Unable to save employee");
    } finally {
      setSaving(false);
    }
  };

  const saveSettings = async () => {
    const result = await updateSalesEmployeeSettings(settings);
    setSettings(result.settings || settings);
    toast.success("Sales settings saved");
  };

  const savePayrollAttendanceSettings = async (updates = {}) => {
    if (!payroll.employee_id) {
      toast.error(t("sales.payroll.selectError", "Select an employee for payroll preview"));
      return;
    }
    const current = payrollEmployee || {};
    const payload = {
      daily_work_hours: updates.daily_work_hours ?? current.daily_work_hours ?? 8,
      working_days_per_month: updates.working_days_per_month ?? current.working_days_per_month ?? 26,
      working_days_per_week: updates.working_days_per_week ?? current.working_days_per_week ?? 6,
      work_start_time: updates.work_start_time ?? current.work_start_time ?? "",
      work_end_time: updates.work_end_time ?? current.work_end_time ?? "",
      absence_deduction_enabled: updates.absence_deduction_enabled ?? current.absence_deduction_enabled ?? true,
      missing_hours_deduction_enabled: updates.missing_hours_deduction_enabled ?? current.missing_hours_deduction_enabled ?? true,
      late_deduction_enabled: updates.late_deduction_enabled ?? current.late_deduction_enabled ?? true,
      early_leave_deduction_enabled: updates.early_leave_deduction_enabled ?? current.early_leave_deduction_enabled ?? true,
    };
    try {
      setPayrollSettingsSaving(true);
      const result = await updateEmployeePayrollSettings(payroll.employee_id, payload);
      setEmployees((prev) => prev.map((employee) => (
        matchEmployeeId(employee.id, payroll.employee_id) ? { ...employee, ...(result.settings || payload) } : employee
      )));
      toast.success(t("sales.payroll.settingsSaved", "Payroll attendance settings saved"));
      await previewPayroll();
    } catch (error) {
      toast.error(error?.message || t("sales.payroll.settingsError", "Unable to save payroll attendance settings"));
    } finally {
      setPayrollSettingsSaving(false);
    }
  };

  const loadGamificationSettings = async () => {
    const response = await api.get("/employees/gamification/settings");
    setGamificationSettings(response.settings || {});
  };

  const saveGamificationSettings = async () => {
    try {
      setGamificationSaving(true);
      const response = await api.patch("/employees/gamification/settings", gamificationSettings);
      setGamificationSettings(response.settings || {});
      toast.success(t("sales.payroll.gamificationSaved", "Gamification settings saved"));
    } catch (error) {
      toast.error(error?.message || t("sales.payroll.gamificationError", "Unable to save gamification settings"));
    } finally {
      setGamificationSaving(false);
    }
  };

  const grantReward = async () => {
    try {
      if (!rewardForm.employee_id) return toast.error(t("sales.payroll.selectEmployee", "Select employee"));
      await api.post("/employees/gamification/rewards", rewardForm);
      setRewardForm({ employee_id: rewardForm.employee_id, title: "", points_cost: 0, admin_note: "" });
      toast.success(t("sales.payroll.rewardGranted", "Reward granted"));
    } catch (error) {
      toast.error(error?.message || t("sales.payroll.rewardError", "Unable to grant reward"));
    }
  };

  const openEmployeeProfile = () => {
    if (!payroll.employee_id) {
      toast.error(t("sales.payroll.selectError", "Select an employee for payroll preview"));
      return;
    }
    navigate("/employees/employees");
  };

  const openEmployeePortal = () => {
    if (!payrollPortalUrl) return;
    window.open(payrollPortalUrl, "_blank", "noopener,noreferrer");
  };

  const previewPayroll = async ({ manual = false } = {}) => {
    if (!payroll.employee_id) {
      toast.error(t("sales.payroll.selectError", "Select an employee for payroll preview"));
      return;
    }
    const baseSalaryInput = payrollNumber(payroll.base_salary);
    const bonusesInput = payrollNumber(payroll.bonuses);
    const deductionsInput = payrollNumber(payroll.deductions);
    if ([baseSalaryInput, bonusesInput, deductionsInput].some((value) => Number.isNaN(value))) {
      toast.error(t("sales.payroll.numericError", "Enter valid salary, bonus, and deduction amounts"));
      return;
    }
    if (manual) {
      setPayrollCalculating(true);
      setPayrollCalculateStatus("");
    }
    const data = await getSalesEmployeePayrollPreview(payroll.employee_id, {
      branch_id: selectedBranchId,
      start: filters.start_date,
      end: filters.end_date,
      bonuses: bonusesInput,
      deductions: deductionsInput,
      base_salary: baseSalaryInput,
      deduction_month: String(filters.end_date || today).slice(0, 7),
    });
    const sourcePayroll = data?.payroll || {};
    const salesEarnings = numberFrom(payrollReportRow?.earned_commissions, sourcePayroll.sales_earnings, sourcePayroll.commissions);
    const baseSalary = numberFrom(baseSalaryInput, sourcePayroll.base_salary);
    const bonuses = numberFrom(bonusesInput, sourcePayroll.bonuses);
    const manualDeductions = numberFrom(sourcePayroll.manual_deductions, deductionsInput);
    const advanceDeductions = numberFrom(sourcePayroll.advance_deductions);
    const penaltyDeductions = numberFrom(sourcePayroll.penalties_total, sourcePayroll.penalty_deductions);
    const absenceDeductions = numberFrom(sourcePayroll.attendance_deduction_total, sourcePayroll.absence_deductions, sourcePayroll.absence_penalties);
    const deductions = manualDeductions + advanceDeductions + penaltyDeductions + absenceDeductions;
    const eligibleItems = payrollReportRow
      ? Math.max(0, numberFrom(payrollReportRow.total_items_sold) - numberFrom(payrollReportRow.returns_refunds))
      : numberFrom(sourcePayroll.eligible_items_count);
    const normalizedPayroll = {
      ...sourcePayroll,
      base_salary: baseSalary,
      earned_sales_amount: numberFrom(payrollReportRow?.net_sales, sourcePayroll.earned_sales_amount),
      eligible_items_count: eligibleItems,
      sales_earnings: salesEarnings,
      commissions: salesEarnings,
      bonuses,
      manual_deductions: manualDeductions,
      advance_deductions: advanceDeductions,
      penalty_deductions: penaltyDeductions,
      penalties_total: penaltyDeductions,
      absence_deductions: absenceDeductions,
      attendance_deduction_total: absenceDeductions,
      absence_days: numberFrom(sourcePayroll.absence_days),
      absent_working_days: numberFrom(sourcePayroll.absent_working_days, sourcePayroll.absence_days),
      missing_hours: numberFrom(sourcePayroll.missing_hours),
      expected_working_days: numberFrom(sourcePayroll.expected_working_days),
      attended_days: numberFrom(sourcePayroll.attended_days),
      excluded_days_off: numberFrom(sourcePayroll.excluded_days_off, sourcePayroll.monthly_days_off_excluded),
      monthly_days_off_excluded: numberFrom(sourcePayroll.monthly_days_off_excluded, sourcePayroll.excluded_days_off),
      excluded_leave_days: numberFrom(sourcePayroll.excluded_leave_days),
      excluded_holiday_days: numberFrom(sourcePayroll.excluded_holiday_days),
      daily_rate: numberFrom(sourcePayroll.daily_rate),
      hourly_rate: numberFrom(sourcePayroll.hourly_rate),
      absence_deduction: numberFrom(sourcePayroll.absence_deduction),
      missing_hours_deduction: numberFrom(sourcePayroll.missing_hours_deduction),
      late_deduction: numberFrom(sourcePayroll.late_deduction),
      early_leave_deduction: numberFrom(sourcePayroll.early_leave_deduction),
      deductions,
      net_pay: baseSalary + salesEarnings + bonuses - deductions,
      final_salary: baseSalary + salesEarnings + bonuses - deductions,
    };
    logSalesStaffDebug("[payroll-calculate]", {
      employee_id: payroll.employee_id,
      base_salary: baseSalary,
      bonuses,
      deductions,
      sales_commission: salesEarnings,
      net_salary: normalizedPayroll.net_pay,
    });
    logSalesStaffDebug("[payroll-preview-sync]", {
      source: payrollReportRow ? "commission-report-row" : "payroll-preview-api",
      employeeId: payroll.employee_id,
      baseSalary,
      salesEarnings,
      netPay: normalizedPayroll.net_pay,
    });
    setPayrollPreview({ ...data, payroll: normalizedPayroll });
    if (manual) {
      setPayroll((prev) => ({ ...prev, base_salary: baseSalary, bonuses, deductions: manualDeductions }));
      setPayrollCalculateStatus("success");
      toast.success(t("sales.payroll.calculateSuccess", "Salary calculated"));
    }
  };

  const handleCalculatePayroll = async () => {
    try {
      await previewPayroll({ manual: true });
    } catch (error) {
      setPayrollCalculateStatus("error");
      toast.error(error?.message || t("sales.payroll.previewError", "Unable to preview payroll"));
    } finally {
      setPayrollCalculating(false);
    }
  };

  const finalizePayroll = async () => {
    if (!payroll.employee_id) {
      toast.error(t("sales.payroll.selectError", "Select an employee for payroll preview"));
      return;
    }
    setPayrollFinalizing(true);
    try {
      const data = await finalizeSalesEmployeePayroll(payroll.employee_id, {
        branch_id: selectedBranchId,
        start: filters.start_date,
        end: filters.end_date,
        bonuses: payrollNumber(payroll.bonuses),
        deductions: payrollNumber(payroll.deductions),
        base_salary: payrollNumber(payroll.base_salary),
        deduction_month: String(filters.end_date || today).slice(0, 7),
      });
      setPayrollPreview(data);
      toast.success(t("sales.payroll.finalizeSuccess", "Payroll finalized and advances settled"));
    } catch (error) {
      toast.error(error?.message || t("sales.payroll.finalizeError", "Unable to finalize payroll"));
    } finally {
      setPayrollFinalizing(false);
    }
  };

  const applyRangeMode = (mode) => {
    setRangeMode(mode);
    if (mode === "current") setFilters((prev) => ({ ...prev, start_date: monthStart, end_date: today }));
    if (mode === "previous") setFilters((prev) => ({ ...prev, start_date: previousMonthStart, end_date: previousMonthEnd }));
  };

  useEffect(() => {
    logSalesStaffDebug("[sales-commission-report-ui]", {
      selectedEmployeeId: filters.employee_id || null,
      payrollEmployeeId: payroll.employee_id || null,
      dateRange: { start: filters.start_date, end: filters.end_date },
      branchId: selectedBranchId || null,
    });
  }, [filters.employee_id, filters.start_date, filters.end_date, payroll.employee_id, selectedBranchId]);

  useEffect(() => {
    const selectedReportEmployeeId = String(filters.employee_id || "");
    if (!selectedReportEmployeeId) {
      lastSyncedReportEmployeeIdRef.current = "";
      return;
    }
    if (lastSyncedReportEmployeeIdRef.current === selectedReportEmployeeId) return;
    lastSyncedReportEmployeeIdRef.current = selectedReportEmployeeId;
    if (matchEmployeeId(payroll.employee_id, selectedReportEmployeeId)) return;
    const employee = employees.find((item) => matchEmployeeId(item.id, filters.employee_id));
    setPayroll((prev) => {
      const nextPayroll = {
        ...prev,
        employee_id: selectedReportEmployeeId,
        base_salary: employee ? employee.salary ?? employee.base_salary ?? prev.base_salary : prev.base_salary,
        deductions: 0,
      };
      const row = (report.rows || []).find((item) => matchEmployeeId(rowEmployeeId(item), filters.employee_id));
      const salesEarnings = numberFrom(row?.earned_commissions);
      const baseSalary = numberFrom(nextPayroll.base_salary);
      const bonuses = numberFrom(nextPayroll.bonuses);
      const deductions = numberFrom(nextPayroll.deductions);
      logSalesStaffDebug("[payroll-preview-sync]", {
        source: "commission-report-employee",
        employeeId: nextPayroll.employee_id,
        baseSalary,
        salesEarnings,
        netPay: baseSalary + salesEarnings + bonuses - deductions,
      });
      return nextPayroll;
    });
    setPayrollEmployeeAdjusted(false);
    setPayrollPreview(null);
  }, [filters.employee_id, employees, payroll.employee_id, report.rows]);

  useEffect(() => {
    if (!payroll.employee_id || !selectedBranchId) {
      setPayrollPreview(null);
      return undefined;
    }
    const timer = window.setTimeout(() => {
      previewPayroll().catch((error) => toast.error(error?.message || t("sales.payroll.previewError", "Unable to preview payroll")));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [payroll.employee_id, payroll.base_salary, payroll.bonuses, payroll.deductions, filters.start_date, filters.end_date, selectedBranchId, payrollReportRow]);

  useEffect(() => {
    setPenaltyForm((prev) => ({
      ...prev,
      payroll_period_start: filters.start_date || prev.payroll_period_start,
      payroll_period_end: filters.end_date || prev.payroll_period_end,
    }));
  }, [filters.start_date, filters.end_date]);

  useEffect(() => {
    if (activeTab !== "penalties") return;
    const payrollEmployeeId = payroll.employee_id ? String(payroll.employee_id) : "";
    const payrollEmployeeAvailable = penaltyEmployeeOptions.some((option) => matchEmployeeId(option.value, payrollEmployeeId));
    const currentEmployeeAvailable = penaltyEmployeeOptions.some((option) => matchEmployeeId(option.value, penaltyForm.employee_id));
    const employeeId = currentEmployeeAvailable ? penaltyForm.employee_id : payrollEmployeeAvailable ? payrollEmployeeId : "";
    if (!employeeId) {
      if (penaltyForm.employee_id) setPenaltyForm((prev) => ({ ...prev, employee_id: "" }));
      setPenalties([]);
      return;
    }
    if (!matchEmployeeId(penaltyForm.employee_id, employeeId)) setPenaltyForm((prev) => ({ ...prev, employee_id: employeeId }));
    loadPenalties(employeeId);
  }, [activeTab, penaltyForm.employee_id, payroll.employee_id, penaltyEmployeeOptions]);

  useEffect(() => {
    if (showEmployeeGamificationSettings) loadGamificationSettings().catch(() => null);
  }, [showEmployeeGamificationSettings]);

  const reportFiltersChanged =
    String(appliedReportFilters.start_date || "") !== String(filters.start_date || "") ||
    String(appliedReportFilters.end_date || "") !== String(filters.end_date || "") ||
    String(appliedReportFilters.employee_id || "") !== String(filters.employee_id || "") ||
    String(appliedReportFilters.branch_id || "") !== String(selectedBranchId || "");

  const toggleExcludedProduct = (productId) => {
    setForm((prev) => {
      const id = Number(productId);
      const set = new Set(prev.excluded_product_ids.map(Number));
      if (set.has(id)) set.delete(id);
      else set.add(id);
      return { ...prev, excluded_product_ids: Array.from(set) };
    });
  };

  const toggleExcludedCategory = (categoryId) => {
    setForm((prev) => {
      const id = Number(categoryId);
      const set = new Set((prev.excluded_category_ids || []).map(Number));
      if (set.has(id)) set.delete(id);
      else set.add(id);
      return { ...prev, excluded_category_ids: Array.from(set) };
    });
  };

  const openEmployeeConfig = (employee) => {
    setForm({
      ...emptyForm,
      ...employee,
      commission_mode: normalizeCommissionMode(employee),
      excluded_product_ids: employee.excluded_product_ids || [],
      excluded_category_ids: employee.excluded_category_ids || [],
    });
    setPayroll((prev) => ({ ...prev, employee_id: String(employee.id), base_salary: employee.salary ?? employee.base_salary ?? prev.base_salary, deductions: 0 }));
    setIsConfigDrawerOpen(true);
  };

  const closeEmployeeConfig = () => {
    setIsConfigDrawerOpen(false);
    setForm({ ...emptyForm, branch_id: selectedBranchId });
  };

  const reportRows = report.rows || [];
  const virtualStaff = useVirtualRows({ count: employees.length, estimateSize: 74, overscan: 8, scrollRef: staffTableRef, enabled: employees.length > 40 });
  const virtualReport = useVirtualRows({ count: reportRows.length, estimateSize: 58, overscan: 10, scrollRef: reportTableRef, enabled: reportRows.length > 40 });
  const virtualPenalties = useVirtualRows({ count: penalties.length, estimateSize: 74, overscan: 8, scrollRef: penaltiesTableRef, enabled: penalties.length > 40 });
  const staffIndexes = employees.length > 40 ? virtualStaff.items : employees.map((_, index) => index);
  const reportIndexes = reportRows.length > 40 ? virtualReport.items : reportRows.map((_, index) => index);
  const penaltyIndexes = penalties.length > 40 ? virtualPenalties.items : penalties.map((_, index) => index);

  const allTabs = [
    { id: "staff", label: t("sales.tabs.staff", "Sales Staff") },
    { id: "reports", label: t("sales.tabs.reports", "Commission Reports") },
    { id: "payroll", label: t("sales.tabs.payroll", "Payroll Calculator") },
    { id: "penalties", label: t("sales.tabs.penalties", "Penalties") },
  ];
  const tabs = Array.isArray(visibleTabs) && visibleTabs.length
    ? allTabs.filter((tab) => visibleTabs.includes(tab.id))
    : allTabs;

  useEffect(() => {
    const fallbackTab = tabs.some((tab) => tab.id === defaultTab) ? defaultTab : tabs[0]?.id || "staff";
    if (!tabs.some((tab) => tab.id === activeTab)) setActiveTab(fallbackTab);
  }, [activeTab, defaultTab, tabs]);

  return (
    <div dir={direction} className="min-h-screen bg-[var(--bg)] p-4 text-[var(--text)] md:p-6">
      {!embedded ? (
      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className={eyebrowClass}>{t("sales.eyebrow", "ملفات موظفي المبيعات")}</div>
          <h1 className="mt-2 text-3xl font-black leading-tight">{t("sales.title", "موظفو المبيعات والعمولات")}</h1>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{t("sales.subtitle", "قم بضبط موظفي المبيعات، وراجع العمولات، واستعرض الرواتب حسب الفرع.")}</p>
        </div>
        <button onClick={() => loadAll()} className="theme-button-soft px-4 py-3 text-sm">
          <RefreshCw className="h-4 w-4" />
          {t("sales.refresh", "تحديث")}
        </button>
      </div>
      ) : null}

      <section className="theme-card mb-4 p-4">
        <div className="grid gap-3 lg:grid-cols-[minmax(240px,340px)_minmax(0,1fr)] lg:items-center">
          <Select
            label={t("sales.branch", "الفرع")}
            value={selectedBranchId}
            onChange={changeBranch}
            options={branchOptions.length ? branchOptions : [{ value: "", label: t("sales.noBranches", "لا توجد فروع متاحة") }]}
            isRtl={isRtl}
          />
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--muted)]">
            {selectedBranchName ? (
            <span>{t("sales.branchContext", "عرض إعدادات الموظفين والتقارير والرواتب للفرع {{branch}}.", { branch: selectedBranchName })}</span>
            ) : (
                <span>{t("sales.branchMissing", "أنشئ فرعاً أولاً لتعيين موظفي المبيعات حسب الموقع.")}</span>
            )}
          </div>
        </div>
      </section>

      {tabs.length > 1 ? (
        <div className="mb-4 flex overflow-x-auto rounded-2xl border border-[var(--border)] bg-[var(--card)] p-1" dir={direction}>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`min-w-fit flex-1 rounded-xl px-4 py-2.5 text-sm font-black transition ${activeTab === tab.id ? "bg-[var(--primary-soft)] text-[var(--primary)]" : "text-[var(--muted)] hover:bg-white/[0.03] hover:text-[var(--text)]"}`}
            >
              <span className="inline-flex items-center justify-center gap-2">
                <span>{tab.label}</span>
                {tab.badge ? <span className="rounded-full bg-rose-500 px-2 py-0.5 text-[11px] font-black text-white">{tab.badge}</span> : null}
              </span>
            </button>
          ))}
        </div>
      ) : null}

      {activeTab === "staff" ? (
        <main className="space-y-4">
          <section className="theme-card p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-xl font-black leading-8">{t("sales.staff.settingsTitle", "POS commission settings")}</h2>
                <p className="mt-1 text-sm leading-6 text-[var(--muted)]">{t("sales.staff.settingsSubtitle", "Controls checkout blocking and default fixed commission behavior.")}</p>
              </div>
              <button onClick={saveSettings} className="theme-button-soft h-[42px] px-4 text-sm">{t("sales.staff.saveSettings", "Save settings")}</button>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <label className="flex items-center justify-between rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3 text-sm font-bold">
                {t("sales.staff.allowWithoutSalesperson", "Allow sale without salesperson")}
                <input type="checkbox" checked={settings.allow_sale_without_salesperson} onChange={(e) => setSettings((prev) => ({ ...prev, allow_sale_without_salesperson: e.target.checked }))} />
              </label>
              <label className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3">
                <span className={mutedLabelClass}>{t("sales.staff.legacyFixedDefault", "Legacy fixed commission default")}</span>
                <select value={settings.fixed_commission_mode} onChange={(e) => setSettings((prev) => ({ ...prev, fixed_commission_mode: e.target.value }))} className="mt-2 w-full bg-transparent font-bold outline-none">
                  <option value="fixed_per_item">{t("sales.staff.fixedPerItem", "Fixed amount per item")}</option>
                  <option value="fixed_per_invoice">{t("sales.staff.fixedPerInvoice", "Fixed amount per invoice")}</option>
                </select>
              </label>
            </div>
          </section>

          <section className="theme-card p-4">
            <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-xl font-black leading-8">{t("sales.staff.title", "Sales Staff")}</h2>
                <p className="mt-1 text-sm leading-6 text-[var(--muted)]">{t("sales.staff.subtitle", "Compact branch employee configuration. Open a row to edit POS alias, commission, and exclusions.")}</p>
              </div>
              <div className="text-xs font-bold text-[var(--muted)]">{t("sales.staff.employeesCount", "{{count}} employees", { count: employees.length })}</div>
            </div>
            {employees.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface)] p-8 text-center text-sm font-semibold text-[var(--muted)]">
                {t("sales.staff.empty", "لا يوجد موظفون لهذا الفرع.")}
              </div>
            ) : (
              <div ref={staffTableRef} className="max-h-[32rem] overflow-auto rounded-2xl border border-[var(--border)]">
                <table className="w-full min-w-[820px] text-sm">
                  <thead className={`sticky top-0 z-10 ${tableHeadClass}`}>
                    <tr>
                      <th className="px-4 py-3">{t("sales.staff.name", "Name")}</th>
                      <th className="px-4 py-3">{t("sales.staff.posAlias", "POS alias")}</th>
                      <th className="px-4 py-3">{t("sales.staff.commissionType", "Commission type")}</th>
                      <th className="px-4 py-3 text-end">{t("sales.staff.commissionValue", "Commission value")}</th>
                      <th className="px-4 py-3">{t("sales.staff.status", "Status")}</th>
                      <th className="px-4 py-3 text-end">{t("sales.staff.action", "Action")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {employees.length > 40 ? <tr aria-hidden="true"><td colSpan={6} style={{ height: virtualStaff.paddingTop }} /></tr> : null}
                    {staffIndexes.map((index) => {
                      const employee = employees[index];
                      return employee ? <SalesEmployeeRow key={employee.id} employee={employee} t={t} onConfigure={openEmployeeConfig} /> : null;
                    })}
                    {employees.length > 40 ? <tr aria-hidden="true"><td colSpan={6} style={{ height: virtualStaff.paddingBottom }} /></tr> : null}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </main>
      ) : null}

      {activeTab === "reports" ? (
        <main className="theme-card p-4">
          <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-xl font-black leading-8">{t("sales.reports.title", "Commission Reports")}</h2>
              <p className="mt-1 text-sm leading-6 text-[var(--muted)]">{t("sales.reports.subtitle", "Item-level net sales with returns and exclusions applied.")}</p>
            </div>
            <button type="button" disabled className="theme-button-soft h-[42px] px-4 text-sm opacity-60">{t("sales.reports.exportCsv", "Export CSV")}</button>
          </div>
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)]/70 p-3">
            <div className="mb-2.5 flex flex-wrap gap-1.5">
              {[
                ["current", t("sales.reports.currentMonth", "Current month")],
                ["previous", t("sales.reports.previousMonth", "الشهر السابق")],
                ["custom", t("sales.reports.customRange", "Custom range")],
              ].map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => applyRangeMode(mode)}
                  className={`rounded-full px-2.5 py-1.5 text-[11px] font-black transition ${rangeMode === mode ? "bg-[var(--primary-soft)] text-[var(--primary)] shadow-[0_0_14px_rgba(16,185,129,0.18)]" : "border border-[var(--border)] bg-black/10 text-[var(--muted)] hover:text-[var(--text)]"}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-1.5 xl:grid-cols-[minmax(220px,1.1fr)_minmax(180px,1fr)_minmax(170px,.85fr)_minmax(92px,auto)] xl:items-end">
              <div className="col-span-2 grid grid-cols-2 gap-1.5 xl:col-span-1">
                <CompactField type="date" label={t("sales.reports.start", "Start")} value={filters.start_date} onChange={(value) => { setRangeMode("custom"); setFilters((prev) => ({ ...prev, start_date: value })); }} isRtl={isRtl} />
                <CompactField type="date" label={t("sales.reports.end", "End")} value={filters.end_date} onChange={(value) => { setRangeMode("custom"); setFilters((prev) => ({ ...prev, end_date: value })); }} isRtl={isRtl} />
              </div>
              <CompactSelect label={t("sales.reports.employee", "Employee")} value={filters.employee_id} onChange={(value) => setFilters((prev) => ({ ...prev, employee_id: value }))} options={[{ value: "", label: t("sales.reports.allEmployees", "All employees") }, ...employeeOptions]} isRtl={isRtl} />
              <div className="h-11 rounded-xl border border-[var(--border)] bg-black/10 px-3 py-2">
                <span className={isRtl ? "block text-[10px] font-bold leading-4 text-[var(--muted)]" : "block text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--muted)]"}>{t("sales.branch", "الفرع")}</span>
                <div className="truncate text-[13px] font-semibold leading-5">{selectedBranchName || t("sales.reports.noBranchSelected", "لم يتم اختيار فرع")}</div>
              </div>
              <button
                onClick={refreshReport}
                className={`col-span-2 h-11 justify-center rounded-xl px-3 text-[13px] font-black transition xl:col-span-1 ${
                  reportFiltersChanged
                    ? "theme-button-primary shadow-[0_0_18px_rgba(16,185,129,0.22)]"
                    : "theme-button-soft"
                }`}
              >
                {t("sales.reports.apply", "Apply")}
              </button>
            </div>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-6">
            <Metric label={t("sales.reports.sales", "Sales")} value={formatCurrency(report.summary.total_sales || 0)} isRtl={isRtl} />
            <Metric label={t("sales.reports.invoices", "Invoices")} value={report.summary.total_invoices || 0} isRtl={isRtl} />
            <Metric label={t("sales.reports.items", "Items")} value={report.summary.total_items_sold || 0} isRtl={isRtl} />
            <Metric label={t("sales.reports.returns", "Returns")} value={report.summary.returns_refunds || 0} isRtl={isRtl} />
            <Metric label={t("sales.reports.netSales", "Net sales")} value={formatCurrency(report.summary.net_sales || 0)} emphasis isRtl={isRtl} />
            <Metric label={t("sales.reports.commissions", "Commissions")} value={formatCurrency(report.summary.earned_commissions || 0)} emphasis isRtl={isRtl} />
          </div>
          <div ref={reportTableRef} className="mt-4 max-h-[560px] overflow-auto rounded-2xl border border-[var(--border)]">
            <table className="w-full min-w-[780px] text-sm">
              <thead className={`sticky top-0 z-10 ${tableHeadClass}`}>
                <tr>
                  <th className="px-4 py-3">{t("sales.reports.employee", "Employee")}</th>
                  <th className="px-4 py-3 text-end">{t("sales.reports.sales", "Sales")}</th>
                  <th className="px-4 py-3 text-end">{t("sales.reports.invoices", "Invoices")}</th>
                  <th className="px-4 py-3 text-end">{t("sales.reports.items", "Items")}</th>
                  <th className="px-4 py-3 text-end">{t("sales.reports.returns", "Returns")}</th>
                  <th className="px-4 py-3 text-end">{t("sales.reports.net", "Net")}</th>
                  <th className="px-4 py-3 text-end">{t("sales.reports.commission", "Commission")}</th>
                </tr>
              </thead>
              <tbody>
                {reportRows.length > 40 ? <tr aria-hidden="true"><td colSpan={7} style={{ height: virtualReport.paddingTop }} /></tr> : null}
                {reportIndexes.map((index) => {
                  const row = reportRows[index];
                  return row ? <CommissionReportRow key={row.salesperson_id || rowEmployeeId(row) || index} row={row} t={t} /> : null;
                })}
                {reportRows.length > 40 ? <tr aria-hidden="true"><td colSpan={7} style={{ height: virtualReport.paddingBottom }} /></tr> : null}
              </tbody>
            </table>
          </div>
        </main>
      ) : null}

      {activeTab === "payroll" ? (
        <main className="space-y-2">
          <div>
            <PayrollFinancialSummary
              payroll={payrollSnapshot}
              payrollPreview={safePayrollPreview}
              historyRows={payrollHistoryRows}
              historyLoading={payrollHistoryLoading}
              currentPayrollFinalized={Boolean(safePayrollPreview?.payroll_run || safePayrollPreview?.finalized)}
              status={payrollStatus}
              issues={payrollStatusIssues}
              employeeId={payroll.employee_id}
              employeeOptions={employeeOptions}
              rangeMode={rangeMode}
              onEmployeeChange={(value) => {
                const employee = employees.find((item) => String(item.id) === String(value));
                setPayrollEmployeeAdjusted(true);
                setPayrollCalculateStatus("");
                setPayroll((prev) => ({ ...prev, employee_id: value, base_salary: employee ? employee.salary ?? employee.base_salary ?? 0 : prev.base_salary, deductions: 0 }));
              }}
              onRangeModeChange={applyRangeMode}
              selectedEmployeeName={payrollEmployee?.name || ""}
              isRtl={isRtl}
              t={t}
              onCalculate={handleCalculatePayroll}
              onFinalize={finalizePayroll}
              calculating={payrollCalculating}
              finalizing={payrollFinalizing}
            />
          </div>

        </main>
      ) : null}

      {activeTab === "penalties" ? (
        <main className="space-y-4">
          <section className="theme-card p-4">
            <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-center gap-3">
                <Gavel className="h-5 w-5 text-[var(--primary)]" />
                <div>
                  <h2 className="text-xl font-black leading-8">{t("sales.penalties.title", "Penalties")}</h2>
                  <p className="mt-1 text-sm leading-6 text-[var(--muted)]">{t("sales.penalties.subtitle", "Add approved employee penalties and deduct them from payroll.")}</p>
                </div>
              </div>
              <button type="button" onClick={savePenalty} disabled={penaltySaving || !penaltyForm.employee_id} className="theme-button-primary h-11 justify-center px-4 text-sm disabled:cursor-not-allowed disabled:opacity-60">
                <Plus className="h-4 w-4" />
                {penaltySaving ? t("sales.penalties.saving", "Saving...") : t("sales.penalties.addPenalty", "Add Penalty")}
              </button>
            </div>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <PayrollSelect
                label={t("sales.payroll.employee", "Employee")}
                value={selectedPenaltyEmployeeInList ? penaltyForm.employee_id : ""}
                onChange={(value) => {
                  updatePenaltyForm("employee_id", value);
                  setPayroll((prev) => ({ ...prev, employee_id: value || prev.employee_id }));
                  loadPenalties(value);
                }}
                options={[{ value: "", label: t("sales.payroll.selectEmployee", "Select employee") }, ...penaltyEmployeeOptions]}
                isRtl={isRtl}
              />
              {!loading && penaltyEmployeeOptions.length === 0 ? (
                <div className="md:col-span-2 xl:col-span-4 rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm font-bold text-[var(--muted)]">
                  {t("sales.penalties.noEmployeesInBranch", "لا يوجد موظفون في هذا الفرع")}
                </div>
              ) : null}
              <PayrollField type="date" label={t("sales.penalties.date", "Date")} value={penaltyForm.penalty_date} onChange={(value) => updatePenaltyForm("penalty_date", value)} isRtl={isRtl} />
              <PayrollField type="number" label={t("sales.penalties.penaltyAmount", "Penalty Amount")} value={penaltyForm.amount} onChange={(value) => updatePenaltyForm("amount", value)} isRtl={isRtl} />
              <PayrollSelect
                label={t("sales.penalties.statusLabel", "Status")}
                value={penaltyForm.status}
                onChange={(value) => updatePenaltyForm("status", value)}
                options={[
                  { value: "approved", label: t("sales.penalties.status.approved", "\u0645\u0639\u062a\u0645\u062f") },
                  { value: "pending", label: t("sales.penalties.status.pending", "\u0642\u064a\u062f \u0627\u0644\u0627\u0646\u062a\u0638\u0627\u0631") },
                  { value: "cancelled", label: t("sales.penalties.status.cancelled", "\u0645\u0644\u063a\u064a") },
                ]}
                isRtl={isRtl}
              />
              <PayrollField label={t("sales.penalties.reason", "Reason")} value={penaltyForm.reason} onChange={(value) => updatePenaltyForm("reason", value)} isRtl={isRtl} />
              <PayrollField label={t("sales.penalties.notes", "Notes")} value={penaltyForm.notes} onChange={(value) => updatePenaltyForm("notes", value)} isRtl={isRtl} />
              <PayrollField type="date" label={t("sales.penalties.payrollPeriodStart", "Payroll period start")} value={penaltyForm.payroll_period_start} onChange={(value) => updatePenaltyForm("payroll_period_start", value)} isRtl={isRtl} />
              <PayrollField type="date" label={t("sales.penalties.payrollPeriodEnd", "Payroll period end")} value={penaltyForm.payroll_period_end} onChange={(value) => updatePenaltyForm("payroll_period_end", value)} isRtl={isRtl} />
            </div>

            <label className="mt-3 flex min-h-11 items-center justify-between rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm font-bold">
              <span>{t("sales.penalties.deductFromPayroll", "Deduct from payroll")}</span>
              <input type="checkbox" checked={penaltyForm.deduct_from_payroll} onChange={(event) => updatePenaltyForm("deduct_from_payroll", event.target.checked)} />
            </label>
          </section>

          <section className="theme-card p-4">
            <div className="mb-4 flex flex-col gap-1">
              <h3 className="text-lg font-black leading-7">{t("sales.penalties.listTitle", "Employee Penalties")}</h3>
              <p className="text-sm leading-6 text-[var(--muted)]">{t("sales.penalties.listSubtitle", "تُدرج العقوبات المعتمدة القابلة للخصم من الراتب ضمن معاينة الرواتب للفترات المتداخلة.")}</p>
            </div>
            {penaltiesLoading ? (
              <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface)] p-8 text-center text-sm font-semibold text-[var(--muted)]">
                {t("sales.penalties.loading", "Loading penalties...")}
              </div>
            ) : penalties.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface)] p-8 text-center text-sm font-semibold text-[var(--muted)]">
                {t("sales.penalties.empty", "No penalties found for this employee.")}
              </div>
            ) : (
              <div ref={penaltiesTableRef} className="max-h-[32rem] overflow-auto rounded-2xl border border-[var(--border)]">
                <table className="w-full min-w-[920px] text-sm">
                  <thead className={`sticky top-0 z-10 ${tableHeadClass}`}>
                    <tr>
                      <th className="px-4 py-3">{t("sales.penalties.date", "Date")}</th>
                      <th className="px-4 py-3">{t("sales.penalties.reason", "Reason")}</th>
                      <th className="px-4 py-3">{t("sales.penalties.payrollPeriod", "Payroll period")}</th>
                      <th className="px-4 py-3 text-end">{t("sales.penalties.penaltyAmount", "Penalty Amount")}</th>
                      <th className="px-4 py-3">{t("sales.penalties.deductFromPayroll", "Deduct from payroll")}</th>
                      <th className="px-4 py-3">{t("sales.penalties.statusLabel", "Status")}</th>
                      <th className="px-4 py-3 text-end">{t("sales.staff.action", "Action")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {penalties.length > 40 ? <tr aria-hidden="true"><td colSpan={7} style={{ height: virtualPenalties.paddingTop }} /></tr> : null}
                    {penaltyIndexes.map((index) => {
                      const penalty = penalties[index];
                      return penalty ? (
                        <PenaltyRow
                          key={penalty.id}
                          penalty={penalty}
                          t={t}
                          onApprove={(item) => setPenaltyStatus(item, "approved")}
                          onCancel={cancelPenalty}
                        />
                      ) : null;
                    })}
                    {penalties.length > 40 ? <tr aria-hidden="true"><td colSpan={7} style={{ height: virtualPenalties.paddingBottom }} /></tr> : null}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </main>
      ) : null}

      {isConfigDrawerOpen ? (
        <div className="fixed inset-0 z-50 bg-black/60" onClick={closeEmployeeConfig}>
          <aside dir={direction} className={`${isRtl ? "mr-auto border-r" : "ml-auto border-l"} h-full w-full max-w-2xl overflow-y-auto border-[var(--border)] bg-[var(--card)] p-4 shadow-2xl md:p-5`} onClick={(event) => event.stopPropagation()}>
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <div className={eyebrowClass}>{t("sales.drawer.eyebrow", "Sales configuration")}</div>
                <h2 className="mt-1 text-2xl font-black leading-9" dir="auto">{form.name || t("sales.drawer.selectEmployee", "Select employee")}</h2>
                <p className="mt-1 text-sm leading-6 text-[var(--muted)]">{t("sales.drawer.subtitle", "POS alias, commission rules, and product/category exclusions.")}</p>
              </div>
              <button type="button" onClick={closeEmployeeConfig} className="theme-button-soft h-10 w-10 justify-center p-0" aria-label={t("sales.drawer.close", "Close configuration")}>
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid gap-3">
              <Select
                label={t("sales.drawer.employee", "Employee")}
                value={form.id || ""}
                onChange={(value) => {
                  const employee = employees.find((item) => String(item.id) === String(value));
                  if (employee) openEmployeeConfig(employee);
                }}
                options={[{ value: "", label: t("sales.drawer.selectEmployee", "Select employee") }, ...employeeOptions]}
                isRtl={isRtl}
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3">
                  <span className={mutedLabelClass}>{t("sales.drawer.branch", "الفرع")}</span>
                  <div className="mt-2 font-black">{selectedBranchName || t("sales.reports.noBranchSelected", "لم يتم اختيار فرع")}</div>
                </div>
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3">
                  <span className={mutedLabelClass}>{t("sales.drawer.employeeCode", "Employee code")}</span>
                  <div className="mt-2 font-bold">{form.code || "-"}</div>
                </div>
                <Field label={t("sales.drawer.posAlias", "POS alias")} value={form.pos_alias || ""} maxLength={10} placeholder="OM" onChange={(value) => setForm((prev) => ({ ...prev, pos_alias: value.slice(0, 10) }))} isRtl={isRtl} />
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3">
                  <span className={mutedLabelClass}>{t("sales.drawer.aliasPreview", "Alias preview")}</span>
                  <div className="mt-2 inline-flex min-h-9 min-w-14 items-center justify-center rounded-2xl border border-[var(--primary)]/30 bg-[var(--primary-soft)] px-3 text-sm font-black text-[var(--primary)]" dir="auto">
                    {form.pos_alias?.trim() || form.name || "OM"}
                  </div>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3">
                  <span className={mutedLabelClass}>{t("sales.drawer.commissionMode", "Commission mode")}</span>
                  <select
                    value={form.commission_mode || normalizeCommissionMode(form)}
                    onChange={(e) => setForm((prev) => ({ ...prev, commission_mode: e.target.value, commission_type: commissionTypeFromMode(e.target.value), fixed_commission_mode: e.target.value === "fixed_per_invoice" ? "fixed_per_invoice" : "fixed_per_item" }))}
                    className="mt-2 w-full bg-transparent font-bold outline-none"
                  >
                    <option value="fixed_per_item">{t("sales.staff.fixedPerItem", "Fixed amount per item")}</option>
                    <option value="fixed_per_invoice">{t("sales.staff.fixedPerInvoice", "Fixed amount per invoice")}</option>
                    <option value="percent">{t("sales.drawer.percentage", "Percentage")}</option>
                    <option value="none">{t("sales.drawer.none", "No commission")}</option>
                  </select>
                </label>
                <Field type="number" label={commissionValueLabel(form.commission_mode || normalizeCommissionMode(form), t)} value={form.commission_value} onChange={(value) => setForm((prev) => ({ ...prev, commission_value: value }))} isRtl={isRtl} />
              </div>

              <label className="flex items-center justify-between rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3 text-sm font-bold">
                {t("sales.drawer.activeForPos", "Active for POS sales")}
                <input type="checkbox" checked={Boolean(form.active_for_pos || form.is_sales_active)} onChange={(e) => setForm((prev) => ({ ...prev, active_for_pos: e.target.checked, is_sales_active: e.target.checked }))} />
              </label>

              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3">
                <div className={mutedLabelClass}>{t("sales.drawer.productsWithoutCommission", "Products without commission")}</div>
                <div className="mt-3 flex items-center gap-2 rounded-xl border border-[var(--border)] bg-black/10 px-3 py-2">
                  <Search className="h-4 w-4 text-[var(--muted)]" />
                  <input value={productSearch} onChange={(e) => setProductSearch(e.target.value)} placeholder={t("sales.drawer.searchProducts", "ابحث عن المنتجات بدون عمولة")} className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--muted)]" />
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {filteredProducts.map((product) => {
                    const productId = Number(product.id || product.product_id);
                    const active = form.excluded_product_ids.map(Number).includes(productId);
                    return (
                      <button
                        key={productId}
                        type="button"
                        onClick={() => toggleExcludedProduct(productId)}
                        className={`rounded-full border px-3 py-1.5 text-xs font-bold ${active ? "border-rose-300/40 bg-rose-500/20 text-rose-100" : "border-[var(--border)] bg-[var(--card)] text-[var(--muted)]"}`}
                      >
                        {product.name || product.product_name}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3">
                <div className={mutedLabelClass}>{t("sales.drawer.categoriesWithoutCommission", "Categories without commission")}</div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {categories.map((category) => {
                    const active = (form.excluded_category_ids || []).map(Number).includes(Number(category.id));
                    return (
                      <button
                        key={category.id}
                        type="button"
                        onClick={() => toggleExcludedCategory(category.id)}
                        className={`rounded-full border px-3 py-1.5 text-xs font-bold ${active ? "border-rose-300/40 bg-rose-500/20 text-rose-100" : "border-[var(--border)] bg-[var(--card)] text-[var(--muted)]"}`}
                      >
                        {category.name}
                      </button>
                    );
                  })}
                  {categories.length === 0 ? <span className="text-xs font-semibold text-[var(--muted)]">{t("sales.drawer.noCategories", "No categories found from current products.")}</span> : null}
                </div>
              </div>

              <div className="sticky bottom-0 -mx-4 mt-2 flex gap-2 border-t border-[var(--border)] bg-[var(--card)] p-4 md:-mx-5">
                <button type="button" onClick={closeEmployeeConfig} className="theme-button-soft h-[44px] flex-1 justify-center px-4 text-sm">{t("sales.drawer.cancel", "Cancel")}</button>
                <button disabled={saving || !form.id} onClick={saveEmployee} className="theme-button-primary h-[44px] flex-1 justify-center px-4 text-sm disabled:opacity-50">
                  <Save className="h-4 w-4" />
                  {saving ? t("sales.drawer.saving", "Saving...") : t("sales.drawer.saveSettings", "Save settings")}
                </button>
              </div>
            </div>
          </aside>
        </div>
      ) : null}

      {loading ? <div className="fixed inset-x-0 bottom-4 mx-auto w-fit rounded-full bg-black/80 px-4 py-2 text-sm font-bold text-white">{t("sales.loading", "جاري تحميل موظفي المبيعات...")}</div> : null}
    </div>
  );
}

function labelClass(isRtl, size = "text-xs") {
  return isRtl
    ? `${size} font-bold leading-5 text-[var(--muted)]`
    : `${size} font-bold uppercase tracking-[0.14em] text-[var(--muted)]`;
}

function Field({ label, value, onChange, type = "text", maxLength, placeholder = "", isRtl = false }) {
  return (
    <label className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3">
      <span className={labelClass(isRtl)}>{label}</span>
      <input dir={isRtl ? "rtl" : "ltr"} type={type} value={value} maxLength={maxLength} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className="mt-2 w-full bg-transparent text-start font-bold outline-none placeholder:text-[var(--muted)]" />
    </label>
  );
}

function Select({ label, value, onChange, options = [], isRtl = false }) {
  return (
    <label className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3">
      <span className={labelClass(isRtl)}>{label}</span>
      <select dir={isRtl ? "rtl" : "ltr"} value={value} onChange={(e) => onChange(e.target.value)} className="mt-2 w-full bg-transparent text-start font-bold outline-none">
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

function CompactField({ label, value, onChange, type = "text", isRtl = false }) {
  const dateInputClass = type === "date" ? "[&::-webkit-calendar-picker-indicator]:m-0 [&::-webkit-calendar-picker-indicator]:translate-x-0" : "";
  return (
    <label className="h-11 rounded-xl border border-[var(--border)] bg-black/10 px-2.5 py-1.5">
      <span className={`block ${labelClass(isRtl, "text-[10px]")}`}>{label}</span>
      <input dir={isRtl ? "rtl" : "ltr"} type={type} value={value} onChange={(e) => onChange(e.target.value)} className={`mt-0.5 h-5 w-full bg-transparent text-start text-[13px] font-semibold leading-5 tabular-nums outline-none ${dateInputClass}`} />
    </label>
  );
}

function CompactSelect({ label, value, onChange, options = [], isRtl = false }) {
  return (
    <label className="h-11 rounded-xl border border-[var(--border)] bg-black/10 px-3 py-2">
      <span className={`block ${labelClass(isRtl, "text-[10px]")}`}>{label}</span>
      <select dir={isRtl ? "rtl" : "ltr"} value={value} onChange={(e) => onChange(e.target.value)} className="mt-0.5 w-full bg-transparent text-start text-[13px] font-semibold leading-5 outline-none">
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

function PayrollField({ label, value, onChange, type = "text", isRtl = false }) {
  return (
    <label className="h-[64px] rounded-2xl border border-[var(--border)] bg-black/10 px-4 pt-3 pb-2.5">
      <span className={`block ${labelClass(isRtl, "text-[11px]")}`}>{label}</span>
      <input dir={isRtl ? "rtl" : "ltr"} type={type} value={value} onChange={(e) => onChange(e.target.value)} className="mt-2.5 w-full bg-transparent text-start text-base font-semibold tabular-nums outline-none md:text-lg" />
    </label>
  );
}

function PayrollSelect({ label, value, onChange, options = [], isRtl = false }) {
  return (
    <label className="h-[64px] rounded-2xl border border-[var(--border)] bg-black/10 px-4 pt-3 pb-2.5">
      <span className={`block ${labelClass(isRtl, "text-[11px]")}`}>{label}</span>
      <select dir={isRtl ? "rtl" : "ltr"} value={value} onChange={(e) => onChange(e.target.value)} className="mt-2.5 w-full bg-transparent text-start text-base font-semibold outline-none md:text-lg">
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

function Metric({ label, value, emphasis = false, isRtl = false }) {
  return (
    <div className={`flex h-full min-h-[92px] flex-col justify-between rounded-xl border p-4 ${emphasis ? "border-[var(--primary)]/35 bg-[var(--primary-soft)]/30" : "border-[var(--border)] bg-[var(--surface)]/80"}`}>
      <div className={labelClass(isRtl, "text-[10px]")}>{label}</div>
      <div dir="ltr" className={`mt-2 inline-flex max-w-full min-w-0 items-baseline whitespace-nowrap text-start font-black leading-7 tabular-nums [unicode-bidi:isolate] ${emphasis ? "text-lg text-[var(--text)]" : "text-base text-[var(--text)]"}`}>{value}</div>
    </div>
  );
}

function PayrollFinancialSummary({
  payroll,
  payrollPreview = null,
  historyRows = [],
  historyLoading = false,
  currentPayrollFinalized = false,
  status,
  issues = [],
  employeeId = "",
  employeeOptions = [],
  rangeMode = "",
  onEmployeeChange,
  onRangeModeChange,
  selectedEmployeeName = "",
  isRtl,
  t,
  onCalculate,
  onFinalize,
  calculating,
  finalizing,
}) {
  const safePayrollPreview = payrollPreview ?? null;
  const baseSalary = numberValue(payroll.base_salary);
  const commissions = numberValue(payroll.sales_earnings ?? payroll.commissions ?? 0);
  const bonuses = numberValue(payroll.bonuses);
  const manualDeductions = numberValue(payroll.manual_deductions);
  const advanceDeductions = numberValue(payroll.advance_deductions);
  const penaltyDeductions = numberValue(payroll.penalty_deductions ?? payroll.penalties_total ?? payroll.penalties);
  const attendanceDeductions = numberValue(payroll.attendance_deduction_total ?? payroll.absence_deductions ?? payroll.absence_penalties);
  const lateDeductions = numberValue(payroll.late_deduction);
  const attendanceOnlyDeductions = Math.max(0, attendanceDeductions - lateDeductions);
  const totalDeductions = numberValue(payroll.deductions ?? manualDeductions + advanceDeductions + penaltyDeductions + attendanceDeductions);
  const netPay = numberValue(payroll.net_pay ?? payroll.final_salary ?? baseSalary + commissions + bonuses - totalDeductions);
  const attendanceRows = [
    { label: t("sales.payroll.attendedDays", "أيام الحضور"), value: numberValue(payroll.attended_days) },
    { label: t("sales.payroll.absentDays", "أيام الغياب"), value: numberValue(payroll.absent_working_days ?? payroll.absence_days) },
    { label: t("sales.payroll.lateDays", "التأخير"), value: numberValue(payroll.late_hours ?? 0) },
    { label: t("sales.payroll.earlyLeaveCount", "الخروج المبكر"), value: numberValue(payroll.early_leave_hours ?? 0) },
    { label: t("sales.payroll.overtimeHours", "ساعات إضافية"), value: numberValue(payroll.overtime_hours ?? 0) },
    { label: t("sales.payroll.approvedLeaves", "الإجازات المعتمدة"), value: numberValue((payroll.excluded_leave_days ?? 0) + (payroll.excluded_holiday_days ?? 0)) },
  ];
  const advanceRows = Array.isArray(safePayrollPreview?.employee_advances) ? safePayrollPreview.employee_advances : [];
  const isReadyForApproval = status?.key === "READY_FOR_APPROVAL";
  const isBlocked = status?.key === "BLOCKED" || status?.key === "REQUIRES_REVIEW";
  const isPaid = Boolean(currentPayrollFinalized);
  const statusLabel = isPaid
    ? t("sales.payroll.paid", "مدفوع")
    : isBlocked
      ? t("sales.payroll.cannotApproveNow", "لا يمكن اعتماد الراتب الآن")
      : isReadyForApproval
        ? t("sales.payroll.readyToApprove", "الراتب جاهز للاعتماد")
        : t("sales.payroll.needsReview", "يحتاج مراجعة");
  const statusToneClass = isPaid
    ? "border-emerald-300/25 bg-emerald-400/10 text-emerald-100"
    : isBlocked
      ? "border-amber-300/25 bg-amber-400/10 text-amber-100"
      : "border-emerald-300/25 bg-emerald-400/10 text-emerald-100";
  const actionLabel = isPaid
    ? t("sales.payroll.markPaid", "تسجيل كمدفوع")
    : isReadyForApproval
      ? t("sales.payroll.approvePayroll", "اعتماد الراتب")
      : t("sales.payroll.calculate", "حساب الراتب");
  const actionHandler = isPaid
    ? null
    : isReadyForApproval
      ? onFinalize
      : onCalculate;
  const actionDisabled = isPaid ? true : calculating || finalizing;
  const hasPayrollDetails = Boolean(safePayrollPreview || payroll.employee_name || currentPayrollFinalized);
  const displayEmployeeName = selectedEmployeeName || payroll.employee_name || "";
  const payrollMonthLabel = payroll.current_payroll_period || payroll.payroll_period || safePayrollPreview?.current_payroll_period || safePayrollPreview?.payroll_period || "";
  const employeeMatches = Boolean(
    selectedEmployeeName &&
    String(selectedEmployeeName).trim() &&
    payroll.employee_name &&
    String(selectedEmployeeName).trim() === String(payroll.employee_name).trim()
  );

  return (
    <div dir={isRtl ? "rtl" : "ltr"} className="space-y-2.5">
      <section className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-2.5 shadow-sm">
        <div className="grid gap-1 xl:grid-cols-[minmax(280px,1.4fr)_minmax(220px,.8fr)]">
          <PayrollSelect
            label={t("sales.payroll.employee", "الموظف")}
            value={employeeId}
            onChange={onEmployeeChange || (() => {})}
            options={[{ value: "", label: t("sales.payroll.selectEmployee", "اختر الموظف") }, ...employeeOptions]}
            isRtl={isRtl}
          />
          <PayrollSelect
            label={t("sales.payroll.month", "الشهر")}
            value={rangeMode}
            onChange={onRangeModeChange || (() => {})}
            options={[
              { value: "current", label: t("sales.payroll.currentMonth", "الشهر الحالي") },
              { value: "previous", label: t("sales.payroll.previousMonth", "الشهر السابق") },
              { value: "custom", label: t("sales.payroll.customMonth", "شهر مخصص") },
            ]}
            isRtl={isRtl}
          />
        </div>

        <div className="mt-2 flex flex-col gap-1.5 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="text-[11px] font-black uppercase tracking-[0.16em] text-[var(--muted)]">
              {t("sales.payroll.summaryTitle", "ملخص الراتب")}
            </div>
            <h3 className="mt-1 text-xl font-black leading-7 text-[var(--text)]">
              {hasPayrollDetails ? (displayEmployeeName || payroll.employee_name || t("sales.payroll.employee", "اسم الموظف")) : t("sales.payroll.noPayrollForEmployee", "لا يوجد راتب محسوب لهذا الموظف.")}
            </h3>
            {hasPayrollDetails && payrollMonthLabel ? (
              <div className="mt-0.5 text-xs font-bold text-[var(--muted)]" dir="ltr">
                {payrollMonthLabel}
              </div>
            ) : null}
          </div>
          <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-black ${statusToneClass}`}>
            <ShieldCheck className="h-4 w-4" />
            {statusLabel}
          </div>
        </div>

        {selectedEmployeeName && payroll.employee_name && !employeeMatches ? (
          <div className="mt-2 rounded-2xl border border-amber-300/25 bg-amber-400/10 px-3 py-2 text-sm font-bold leading-5 text-amber-100">
            {t("sales.payroll.otherEmployeeWarning", "أنت تعرض راتب موظف آخر.")}
          </div>
        ) : null}

        <div className={`mt-2 rounded-2xl border px-3 py-2 ${isPaid ? "border-emerald-300/25 bg-emerald-400/10 text-emerald-100" : isBlocked ? "border-amber-300/25 bg-amber-400/10 text-amber-100" : "border-emerald-300/25 bg-emerald-400/10 text-emerald-100"}`}>
          {hasPayrollDetails ? (
            <div className="space-y-1">
              {[
                { label: t("sales.payroll.baseSalary", "الراتب الأساسي"), value: formatPayrollMoney(baseSalary), dir: "ltr" },
                { label: t("sales.payroll.bonusesAndCommissions", "العمولة / المكافآت"), value: formatPayrollMoney(commissions + bonuses), dir: "ltr" },
                { label: t("sales.payroll.advances", "السلف"), value: formatDeductions(advanceDeductions), dir: "ltr" },
                { label: t("sales.payroll.totalDeductions", "الخصومات"), value: formatDeductions(totalDeductions), dir: "ltr" },
                { label: t("sales.payroll.netSalary", "صافي الراتب"), value: formatPayrollMoney(netPay), dir: "ltr", featured: true },
              ].map((item) => (
                <div key={item.label} className={`flex items-center justify-between gap-3 rounded-2xl border px-3 py-1.5 ${item.featured ? "border-emerald-300/25 bg-emerald-400/10" : "border-[var(--border)] bg-[var(--surface)]/70"}`}>
                  <div className="text-sm font-bold text-[var(--muted)]">{item.label}</div>
                  <div dir={item.dir || "auto"} className={`text-sm font-black tabular-nums text-[var(--text)] ${item.featured ? "text-base" : ""}`}>{item.value}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-2 text-sm font-bold text-[var(--muted)]">
              {t("sales.payroll.noPayrollForEmployee", "لا يوجد راتب محسوب لهذا الموظف.")}
            </div>
          )}
        </div>

        {hasPayrollDetails && isBlocked ? (
          <div className="mt-2 rounded-2xl border px-3 py-2.5 text-amber-100 bg-amber-400/10 border-amber-300/25">
            <div className="text-sm font-black leading-5">{statusLabel}</div>
            <ul className="mt-1 space-y-0.5 text-xs font-bold leading-5">
              {(issues.length ? issues : [{ key: "generic", label: t("sales.payroll.blockedGeneric", "لا يمكن اعتماد الراتب الآن") }]).map((issue) => (
                <li key={issue.key} className="flex items-start gap-2">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
                  <span dir="auto">{issue.label}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="mt-2">
          {actionHandler ? (
            <button
              type="button"
              onClick={actionHandler}
              disabled={actionDisabled}
              className={`inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl px-4 text-sm font-black disabled:cursor-not-allowed disabled:opacity-60 ${isReadyForApproval ? "bg-emerald-500 text-slate-950" : "bg-[var(--primary)] text-white"}`}
            >
              {actionDisabled && !isPaid ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              {actionLabel}
            </button>
          ) : (
            <button
              type="button"
              disabled
              className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl border border-emerald-300/25 bg-emerald-400/10 px-4 text-sm font-black text-emerald-100 disabled:cursor-not-allowed disabled:opacity-100"
            >
              <CheckCircle2 className="h-4 w-4" />
              {actionLabel}
            </button>
          )}
        </div>
      </section>

      <details className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-2.5 shadow-sm">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-base font-black leading-7 text-[var(--text)]">
          <span>{t("sales.payroll.moreDetails", "تفاصيل إضافية")}</span>
        </summary>

        <div className="mt-2 space-y-2">
          <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)]/70 p-3">
            <div className="flex items-center justify-between gap-3">
              <h4 className="text-sm font-black text-[var(--text)]">{t("sales.payroll.historyTitle", "سجل الراتب")}</h4>
              <span className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-[11px] font-black text-[var(--muted)]">{historyRows.length}</span>
            </div>
            <div className="mt-2 space-y-2">
              {historyLoading ? <div className="text-xs font-bold text-[var(--muted)]">{t("sales.payroll.loadingHistory", "جاري تحميل السجل...")}</div> : null}
              {historyRows.length ? historyRows.map((row) => (
                <div key={row.period} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-black text-[var(--text)]">{row.label}</div>
                      <div className="text-xs text-[var(--muted)]" dir="ltr">{row.period}</div>
                    </div>
                    <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-black ${row.finalized || (row.isCurrent && currentPayrollFinalized) ? "bg-emerald-500/15 text-emerald-200" : row.isCurrent && isBlocked ? "bg-amber-500/15 text-amber-100" : "bg-white/5 text-white"}`}>
                      {row.finalized || (row.isCurrent && currentPayrollFinalized) ? t("sales.payroll.paid", "مدفوع") : row.isCurrent ? statusLabel : t("sales.payroll.calculated", "محسوب")}
                    </span>
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2 text-xs font-bold">
                    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)]/70 p-2">
                      <div className="text-[10px] text-[var(--muted)]">{t("sales.payroll.baseSalary", "الراتب الأساسي")}</div>
                      <div className="mt-1 tabular-nums" dir="ltr">{formatPayrollMoney(numberValue(row.payroll?.base_salary))}</div>
                    </div>
                    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)]/70 p-2">
                      <div className="text-[10px] text-[var(--muted)]">{t("sales.payroll.totalDeductions", "الخصومات")}</div>
                      <div className="mt-1 tabular-nums" dir="ltr">{formatDeductions(numberValue(row.payroll?.deductions))}</div>
                    </div>
                    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)]/70 p-2">
                      <div className="text-[10px] text-[var(--muted)]">{t("sales.payroll.netSalary", "صافي الراتب")}</div>
                      <div className="mt-1 tabular-nums font-black" dir="ltr">{formatPayrollMoney(numberValue(row.payroll?.net_pay ?? row.payroll?.final_salary))}</div>
                    </div>
                  </div>
                </div>
              )) : (
                <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface)] p-4 text-center text-sm font-semibold text-[var(--muted)]">{t("sales.payroll.noHistory", "لا يوجد سجل رواتب حتى الآن.")}</div>
              )}
            </div>
          </section>

          <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)]/70 p-3">
            <div className="flex items-center justify-between gap-3">
              <h4 className="text-sm font-black text-[var(--text)]">{t("sales.payroll.attendanceSnapshot", "تفاصيل الحضور")}</h4>
              <span className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-[11px] font-black text-[var(--muted)]">{attendanceRows.length}</span>
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {attendanceRows.map((item) => (
                <div key={item.label} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
                  <div className="text-[11px] font-black text-[var(--muted)]">{item.label}</div>
                  <div className="mt-1 text-lg font-black tabular-nums text-[var(--text)]" dir="ltr">{item.value}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)]/70 p-3">
            <div className="flex items-center justify-between gap-3">
              <h4 className="text-sm font-black text-[var(--text)]">{t("sales.payroll.linkedAdvances", "السلف المرتبطة")}</h4>
              <span className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-[11px] font-black text-[var(--muted)]">{advanceRows.length}</span>
            </div>
            <div className="mt-2 space-y-2">
              {advanceRows.length ? advanceRows.map((advance) => {
                const deductionStatus = String(advance.deduction_status || advance.status || "").toLowerCase();
                const settled = deductionStatus.includes("settled") || deductionStatus.includes("deducted") || deductionStatus.includes("paid");
                return (
                  <div key={advance.id} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-black text-[var(--text)]" dir="auto">{advance.deduction_month || t("sales.payroll.unassignedMonth", "غير محدد")}</div>
                        <div className="mt-1 text-xs font-bold text-[var(--muted)]" dir="ltr">{String(advance.created_at || advance.updated_at || "").slice(0, 10) || "-"}</div>
                      </div>
                      <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-black ${settled ? "bg-emerald-500/15 text-emerald-200" : "bg-amber-500/15 text-amber-100"}`}>
                        {settled ? t("sales.payroll.settled", "مُسوّاة") : t("sales.payroll.pending", "معلقة")}
                      </span>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-xs font-bold">
                      <div className="rounded-xl bg-black/10 px-2 py-2">
                        <div className="text-[10px] text-[var(--muted)]">{t("sales.payroll.amount", "القيمة")}</div>
                        <div className="mt-1 tabular-nums text-[var(--text)]" dir="ltr">{formatCurrency(advance.amount || 0)}</div>
                      </div>
                      <div className="rounded-xl bg-black/10 px-2 py-2">
                        <div className="text-[10px] text-[var(--muted)]">{t("sales.payroll.deductedAmount", "الخصم")}</div>
                        <div className="mt-1 tabular-nums text-[var(--text)]" dir="ltr">{formatDeductions(advance.payroll_deduction_amount ?? advance.outstanding_amount ?? advance.remaining_amount ?? 0)}</div>
                      </div>
                    </div>
                  </div>
                );
              }) : (
                <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface)] p-4 text-center text-sm font-semibold text-[var(--muted)]">{t("sales.payroll.noAdvancesLinked", "لا توجد سلف مرتبطة بهذه الفترة.")}</div>
              )}
            </div>
          </section>
        </div>
      </details>
    </div>
  );
}

function PayrollSalaryHero({ amount, periodLabel, isRtl, t, onFinalize, finalizing }) {
  return (
    <div dir={isRtl ? "rtl" : "ltr"} className={`relative overflow-hidden rounded-[1.6rem] border border-emerald-300/20 bg-[radial-gradient(circle_at_20%_0%,rgba(16,185,129,.28),transparent_34%),linear-gradient(145deg,rgba(6,78,59,.95),rgba(2,6,23,.98))] p-5 text-start text-white shadow-[0_24px_70px_rgba(16,185,129,.18)] transition hover:-translate-y-0.5 hover:border-emerald-200/35 ${isRtl ? "xl:[direction:rtl]" : ""}`}>
      <div className="absolute -right-16 -top-20 h-48 w-48 rounded-full bg-emerald-300/15 blur-3xl" />
      <div className="absolute -bottom-24 left-8 h-56 w-56 rounded-full bg-cyan-300/10 blur-3xl" />
      <div className="relative flex h-full min-h-[260px] flex-col justify-between gap-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.16em] text-emerald-100/80">{t("sales.payroll.netSalary", "Net Salary")}</div>
            <div className="mt-3 flex items-center gap-2 rounded-full border border-emerald-200/25 bg-white/10 px-3 py-1 text-xs font-black text-emerald-50 backdrop-blur">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {t("sales.payroll.readyForApproval", "Ready for approval")}
            </div>
          </div>
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-emerald-200/25 bg-emerald-300/15 text-emerald-50">
            <Banknote className="h-6 w-6" />
          </div>
        </div>

        <div>
          <div dir="ltr" className={`max-w-full text-4xl font-black leading-tight tracking-normal tabular-nums text-emerald-50 [unicode-bidi:isolate] md:text-5xl ${isRtl ? "text-right" : "text-left"}`}>
            {formatPayrollMoney(amount)}
          </div>
          <div className="mt-3 flex items-center gap-2 text-sm font-bold text-emerald-100/75">
            <CalendarDays className="h-4 w-4 shrink-0" />
            <span dir="ltr" className="tabular-nums [unicode-bidi:isolate]">{periodLabel}</span>
          </div>
        </div>

        <button type="button" onClick={onFinalize} disabled={finalizing} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-emerald-200/20 bg-emerald-300 px-4 text-sm font-black text-slate-950 shadow-[0_14px_34px_rgba(16,185,129,.28)] transition hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-60">
          <BriefcaseBusiness className={`h-4 w-4 ${finalizing ? "animate-pulse" : ""}`} />
          {finalizing ? t("sales.payroll.finalizing", "Finalizing...") : t("sales.payroll.approvePayroll", "Approve Payroll")}
        </button>
      </div>
    </div>
  );
}

function PayrollBreakdownCard({ label, value, tone = "neutral", icon: Icon, details, isRtl }) {
  const toneClass = {
    positive: "border-emerald-300/25 bg-emerald-400/10 text-emerald-100",
    negative: "border-rose-300/25 bg-rose-400/10 text-rose-100",
    warning: "border-amber-300/25 bg-amber-400/10 text-amber-100",
    analytics: "border-sky-300/20 bg-sky-400/10 text-sky-100",
    neutral: "border-white/10 bg-white/[0.04] text-[var(--text)]",
  }[tone];
  const iconClass = {
    positive: "bg-emerald-300/15 text-emerald-200",
    negative: "bg-rose-300/15 text-rose-200",
    warning: "bg-amber-300/15 text-amber-200",
    analytics: "bg-sky-300/15 text-sky-200",
    neutral: "bg-white/10 text-[var(--muted)]",
  }[tone];

  return (
    <div dir={isRtl ? "rtl" : "ltr"} className={`group min-h-[118px] rounded-2xl border p-3 text-start transition hover:-translate-y-0.5 hover:border-white/25 md:p-4 ${toneClass}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className={labelClass(isRtl, "text-[10px]")}>{label}</div>
          <div dir="ltr" className={`mt-2 max-w-full truncate text-xl font-black leading-7 tabular-nums [unicode-bidi:isolate] md:text-2xl ${isRtl ? "text-right" : "text-left"}`}>{value}</div>
        </div>
        {Icon ? (
          <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${iconClass}`}>
            <Icon className="h-4 w-4" />
          </div>
        ) : null}
      </div>
      {details?.length ? (
        <div className="mt-3 grid grid-cols-2 gap-1.5 text-[11px] font-bold leading-4 text-[var(--muted)]">
          {details.map((item) => (
            <div key={item.label} className="rounded-xl border border-white/10 bg-black/10 px-2 py-1">
              <div>{item.label}</div>
              <div dir="ltr" className={`mt-0.5 tabular-nums text-rose-100 [unicode-bidi:isolate] ${isRtl ? "text-right" : "text-left"}`}>
                {item.raw ? Number(item.value || 0).toLocaleString("en-US", { maximumFractionDigits: 2 }) : item.deduction ? formatDeductions(item.value) : formatPayrollMoney(item.value)}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function PayrollAdvancesActivity({ advances, isRtl, t }) {
  if (!advances.length) {
    return (
      <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface)] p-6 text-center text-sm font-semibold text-[var(--muted)]">
        {t("sales.payroll.noAdvances", "No active advances for this payroll period.")}
      </div>
    );
  }

  return (
    <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
      {advances.map((advance) => {
        const status = advance.deduction_status || advance.status || "-";
        const normalizedStatus = String(status || "").toLowerCase();
        const isSettled = normalizedStatus.includes("settled") || normalizedStatus.includes("deducted") || normalizedStatus.includes("paid");
        const deductionAmount = advance.payroll_deduction_amount ?? advance.outstanding_amount ?? advance.remaining_amount ?? 0;
        const statusTone = advanceStatusTone(status);
        return (
          <div key={advance.id} className="rounded-2xl border border-[var(--border)] bg-[linear-gradient(135deg,rgba(255,255,255,.055),rgba(255,255,255,.015))] p-3 transition hover:-translate-y-0.5 hover:border-amber-200/25">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-amber-200/20 bg-amber-300/10 text-amber-200">
                  <WalletCards className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-black text-[var(--text)]" dir="auto">{advance.deduction_month || t("sales.payroll.unassignedMonth", "Unassigned month")}</div>
                  <div className="mt-1 flex items-center gap-1.5 text-[11px] font-semibold text-[var(--muted)]">
                    <CalendarDays className="h-3.5 w-3.5" />
                    <span dir="ltr" className="tabular-nums [unicode-bidi:isolate]">{String(advance.created_at || advance.updated_at || "").slice(0, 10) || "-"}</span>
                  </div>
                </div>
              </div>
              <span className={`shrink-0 rounded-full border px-2 py-1 text-[10px] font-black ${statusTone}`}>{status}</span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <div className="rounded-xl bg-black/10 px-2.5 py-2">
                <div className={labelClass(isRtl, "text-[10px]")}>{t("sales.payroll.amount", "Amount")}</div>
                <div dir="ltr" className={`mt-1 text-sm font-black tabular-nums [unicode-bidi:isolate] ${isRtl ? "text-right" : "text-left"}`}>{formatCurrency(advance.amount || 0)}</div>
              </div>
              <div className="rounded-xl bg-rose-400/10 px-2.5 py-2">
                <div className={labelClass(isRtl, "text-[10px]")}>{isSettled ? t("sales.payroll.deductedInPayroll", "Deducted in payroll") : t("sales.payroll.outstanding", "Outstanding")}</div>
                <div dir="ltr" className={`mt-1 text-sm font-black tabular-nums text-rose-200 [unicode-bidi:isolate] ${isRtl ? "text-right" : "text-left"}`}>{formatDeductions(deductionAmount)}</div>
              </div>
            </div>
            {advance.notes ? <div className="mt-2 truncate text-xs font-semibold text-[var(--muted)]" dir="auto">{advance.notes}</div> : null}
          </div>
        );
      })}
    </div>
  );
}

function advanceStatusTone(status) {
  const normalized = String(status || "").toLowerCase();
  if (normalized.includes("paid") || normalized.includes("settled") || normalized.includes("complete")) return "border-emerald-300/25 bg-emerald-400/10 text-emerald-100";
  if (normalized.includes("overdue") || normalized.includes("rejected") || normalized.includes("failed")) return "border-rose-300/25 bg-rose-400/10 text-rose-100";
  return "border-amber-300/25 bg-amber-400/10 text-amber-100";
}

function penaltyStatusClass(status) {
  const normalized = String(status || "").toLowerCase();
  if (normalized === "approved") return "bg-emerald-500/15 text-emerald-200";
  if (normalized === "cancelled") return "bg-rose-500/15 text-rose-200";
  return "bg-amber-500/15 text-amber-100";
}

function formatDeductions(value) {
  const numeric = numberValue(value);
  if (numeric <= 0) return formatPayrollMoney(0);
  return `- ${formatPayrollMoney(numeric)}`;
}

export default SalesEmployees;

