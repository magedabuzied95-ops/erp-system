import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, CheckCircle2, Clock3, Download, Edit3, Filter, ImagePlus, Loader2, Plus, RefreshCw, RotateCcw, ScanBarcode, ShieldCheck, Smartphone, Trash2, UserCheck, Warehouse, XCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";

import { getCurrentUser, hasAnyPermission, hasPermission, isAdminUser } from "../../../shared/auth/authStorage";
import EmployeePortalAccessCard from "../../employees/components/EmployeePortalAccessCard";
import ManagerPortalAccessCard from "../../employees/components/ManagerPortalAccessCard";
import AttendanceMetricCard from "./AttendanceMetricCard";
import {
  checkInEmployee,
  checkOutEmployee,
  createAttendanceEmployee,
  createAttendanceEmployeeShift,
  deleteAttendanceEmployee,
  approveAttendanceDevice,
  getBranches,
  getAttendanceDevices,
  getAttendanceDeviceSettings,
  getAttendanceEmployeeShifts,
  getAttendanceEmployees,
  getAttendanceKioskSnapshot,
  getBranchAttendanceReport,
  getDailyAttendanceReport,
  getEmployeeAttendanceReport,
  updateAttendanceEmployee,
  updateAttendanceDeviceSettings,
  updateAttendanceShift,
  updateEmployeePayrollSettings,
  upsertSalesEmployeeProfile,
  rejectAttendanceDevice,
  resetEmployeeAttendanceDeviceBindings,
  resetEmployeeTodayAttendance,
  resetAttendanceDeviceBinding,
  resetAttendanceDeviceBindingByKey,
  resetAllAttendanceDeviceBindings,
  resetTodayAttendanceDeviceBindings,
} from "../attendanceApi";
import { uploadProductImage, resolveUploadedImageUrl } from "../../products/services/productsApi";
import { resolveEmployeeProfileImageUrl } from "../../../shared/lib/imageUrls";

const todayValue = () => new Date().toISOString().slice(0, 10);
const rangeStartValue = () => {
  const d = new Date();
  d.setDate(d.getDate() - 6);
  return d.toISOString().slice(0, 10);
};
const safeArray = (value) => (Array.isArray(value) ? value : Array.isArray(value?.data) ? value.data : []);
const safeDate = (value) => {
  if (!value) return null;
  try {
    const date = value instanceof Date ? value : new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
  } catch {
    return null;
  }
};
const formatSafeTime = (value, fallback = "-") => safeDate(value)?.toLocaleTimeString() || fallback;
const formatSafeDateTime = (value, fallback = "-") => safeDate(value)?.toLocaleString() || fallback;
const getDeletedCount = (response) =>
  Number(
    response?.deletedCount ??
      response?.deleted_count ??
      response?.data?.deletedCount ??
      response?.data?.deleted_count ??
      response?.reset_count ??
      response?.data?.reset_count ??
      0
  );
const showDeviceLockResetToast = (deletedCount, tr) => {
  if (deletedCount === 0) {
    throw new Error(tr("errors.noDeviceLocks"));
  }
  toast.success(tr("toasts.deviceLockReset", { count: deletedCount }));
};
const getDeletedRows = (response = {}) => response?.deleted_rows || response?.data?.deleted_rows || {};
const getRemainingTodayRows = (response = {}) => Number(response?.remaining_today_rows ?? response?.data?.remaining_today_rows ?? 0);
const getDeletedAttendanceRows = (response = {}, deletedRows = {}) =>
  Number(response?.deleted_attendance_rows ?? response?.data?.deleted_attendance_rows ?? deletedRows.attendance_logs ?? 0);
const isDeviceBindingRow = (device = {}) => device.record_type === "binding" || Boolean(device.device_key);
const dateKey = (value) => String(value || "").slice(0, 10);
const normalizeBranch = (branch = {}) => ({
  id: branch.id || branch.branch_id || "",
  name: branch.name || branch.branch_name || "",
  code: branch.code || branch.branch_code || "",
});
const isBranchActive = (value) =>
  value === true ||
  value === 1 ||
  value === "1" ||
  value === "true" ||
  value === "t";
const emptyDailyReport = {
  presentToday: 0,
  absentToday: 0,
  lateEmployees: 0,
  overtimeEmployees: 0,
  totalWorkedMinutes: 0,
  employees: [],
  summary: {
    present: 0,
    absent: 0,
    late: 0,
    overtime: 0,
    totalWorkedMinutes: 0,
    totalWorkedHours: "00:00",
  },
  logs: [],
};
const minutesLabel = (value) => {
  const mins = Math.max(0, Number(value || 0));
  const hours = Math.floor(mins / 60);
  const remain = mins % 60;
  return `${String(hours).padStart(2, "0")}:${String(remain).padStart(2, "0")}`;
};
const statusTone = (value) => {
  const normalized = String(value || "").toLowerCase();
  if (normalized.includes("late")) return "amber";
  if (normalized.includes("overtime")) return "blue";
  if (normalized.includes("present") || normalized.includes("checked")) return "emerald";
  if (normalized.includes("absent")) return "rose";
  return "zinc";
};
const normalizeRole = (value = "") => String(value || "").trim().toLowerCase().replace(/[_-]+/g, " ");
const normalizeEmployeeRoleCode = (value = "") => String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
const employeeRoleLabels = {
  sales: { en: "Sales", ar: "مبيعات" },
  pos_cashier: { en: "POS Cashier", ar: "كاشير POS" },
  cashier: { en: "Cashier", ar: "كاشير" },
  employee: { en: "Employee", ar: "موظف" },
  staff: { en: "Employee", ar: "موظف" },
};
const jobTitlePresets = [
  { id: "employee", title: { ar: "موظف", en: "Employee" }, role: "employee", canOpenBranch: false, salesActive: false, managerPortal: false },
  { id: "pos_cashier", title: { ar: "كاشير POS", en: "POS Cashier" }, role: "pos_cashier", canOpenBranch: true, salesActive: true, managerPortal: false },
  { id: "sales", title: { ar: "موظف مبيعات", en: "Sales Employee" }, role: "sales", canOpenBranch: false, salesActive: true, managerPortal: false },
  { id: "branch_manager", title: { ar: "مدير فرع", en: "Branch Manager" }, role: "branch_manager", canOpenBranch: true, salesActive: true, managerPortal: true },
  { id: "warehouse", title: { ar: "مسؤول مخزن", en: "Warehouse Officer" }, role: "warehouse", canOpenBranch: false, salesActive: false, managerPortal: false },
  { id: "accountant", title: { ar: "محاسب", en: "Accountant" }, role: "accountant", canOpenBranch: false, salesActive: false, managerPortal: false },
  { id: "hr", title: { ar: "موارد بشرية", en: "HR Officer" }, role: "hr", canOpenBranch: false, salesActive: false, managerPortal: true },
  { id: "custom", title: { ar: "مسمى مخصص", en: "Custom title" }, role: "", canOpenBranch: null, salesActive: null, managerPortal: null },
];
const jobTitlePresetLabel = (preset, isArabic) => preset.title[isArabic ? "ar" : "en"];
const findJobTitlePreset = (form = {}) => {
  const role = normalizeEmployeeRoleCode(form.role || "");
  const title = normalizeEmployeeRoleCode(form.job_title || form.position || "");
  return jobTitlePresets.find((preset) => preset.id !== "custom" && (
    preset.role === role ||
    normalizeEmployeeRoleCode(preset.title.en) === title ||
    normalizeEmployeeRoleCode(preset.title.ar) === title
  )) || null;
};
const isArabicLocale = (language = "") => String(language || "").toLowerCase().startsWith("ar");
const cleanPhotoUrl = (value = "") => String(value || "").trim();
const titleCaseRole = (value = "") =>
  String(value || "")
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
const formatEmployeeJobLabel = (employee = {}, language = "en") => {
  const localeKey = isArabicLocale(language) ? "ar" : "en";
  const explicitTitle = [employee.job_title, employee.jobTitle, employee.position, employee.title]
    .map((value) => String(value || "").trim())
    .find(Boolean);
  if (explicitTitle) return explicitTitle;

  const roleValue = String(employee.role || employee.role_key || employee.sales_role || employee.salesRole || "").trim();
  const mappedRole = employeeRoleLabels[normalizeEmployeeRoleCode(roleValue)];
  if (mappedRole) return mappedRole[localeKey];

  const departmentValue = String(employee.department || "").trim();
  const mappedDepartment = employeeRoleLabels[normalizeEmployeeRoleCode(departmentValue)];
  if (mappedDepartment) return mappedDepartment[localeKey];

  if (roleValue) return /[A-Z]/.test(roleValue) || /[\u0600-\u06FF]/.test(roleValue) ? roleValue : titleCaseRole(roleValue);
  if (departmentValue) return departmentValue;
  return employeeRoleLabels.employee[localeKey];
};
const resolveEmployeeRecordId = (employee = {}) => String(employee?.id || employee?.employee_id || employee?.employeeId || "");
const isAttendanceDeviceAdmin = (user = {}) =>
  Boolean(user) &&
  (
    isAdminUser(user) ||
    user?.is_super_admin === true ||
    ["admin", "super admin", "superadmin", "platform admin"].includes(normalizeRole(user?.role || user?.role_name))
  );

const readableTranslationFallback = (key = "") =>
  String(key || "")
    .split(".")
    .pop()
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());

const createEmptyEmployeeForm = (branchId = "") => ({
  id: "",
  branch_id: branchId,
  branch_name: "",
  employee_code: "",
  full_name: "",
  photo_url: "",
  phone: "",
  email: "",
  national_id: "",
  role: "",
  job_title: "",
  position: "",
  salary: "",
  daily_work_hours: 8,
  working_days_per_month: 26,
  working_days_per_week: 6,
  work_start_time: "",
  work_end_time: "",
  absence_deduction_enabled: true,
  missing_hours_deduction_enabled: true,
  late_deduction_enabled: true,
  early_leave_deduction_enabled: true,
  is_sales_active: false,
  pos_alias: "",
  commission_mode: "none",
  commission_value: 0,
  hire_date: todayValue(),
  status: "active",
  can_open_branch: true,
  manager_portal_enabled: false,
});

const createEmptyShiftForm = () => ({
  id: "",
  shift_name: "",
  start_time: "09:00",
  end_time: "17:00",
  check_in_window_start: "09:00",
  check_in_window_end: "10:00",
  allowed_late_minutes: 15,
  overtime_after_minutes: 0,
  working_days: "Sun,Mon,Tue,Wed,Thu",
});

const sameEmployeeRecord = (left = {}, right = {}) =>
  resolveEmployeeRecordId(left) === resolveEmployeeRecordId(right) &&
  String(left.full_name || "") === String(right.full_name || "") &&
  String(left.branch_id || "") === String(right.branch_id || "") &&
  String(left.employee_code || "") === String(right.employee_code || "") &&
  String(left.status || "") === String(right.status || "") &&
  Boolean(left.can_open_branch !== false) === Boolean(right.can_open_branch !== false) &&
  String(left.daily_work_hours || "") === String(right.daily_work_hours || "") &&
  String(left.working_days_per_month || "") === String(right.working_days_per_month || "") &&
  String(left.working_days_per_week || "") === String(right.working_days_per_week || "") &&
  Boolean(left.is_sales_active) === Boolean(right.is_sales_active) &&
  String(left.commission_mode || "") === String(right.commission_mode || "") &&
  String(left.commission_value || "") === String(right.commission_value || "") &&
  cleanPhotoUrl(left.photo_url || "") === cleanPhotoUrl(right.photo_url || "") &&
  String(left.job_title || left.position || "") === String(right.job_title || right.position || "") &&
  Boolean(left.manager_portal_enabled) === Boolean(right.manager_portal_enabled) &&
  String(left.manager_portal_token || "") === String(right.manager_portal_token || "");

const sameEmployeeList = (previous = [], next = []) =>
  previous.length === next.length && previous.every((employee, index) => sameEmployeeRecord(employee, next[index]));

function AttendanceWorkspace({
  defaultTab = "dashboard",
  visibleTabs = null,
  embedded = false,
  hideMetrics = false,
  selectedEmployeeId: externalSelectedEmployeeId = null,
  onSelectedEmployeeChange = null,
}) {
  const { t, i18n } = useTranslation();
  const language = i18n?.language || "en";
  const isArabic = isArabicLocale(language);
  const direction = isArabic ? "rtl" : "ltr";
  const tr = useCallback((key, options = {}) => {
    const fallback = readableTranslationFallback(key);
    return t(`common.employeeHub.attendance.${key}`, { defaultValue: fallback, ...options });
  }, [t]);
  const currentUserRef = useRef(getCurrentUser());
  const [selectedTab, setSelectedTab] = useState(defaultTab);
  const [employees, setEmployees] = useState([]);
  const [branches, setBranches] = useState([]);
  const [attendanceDevices, setAttendanceDevices] = useState([]);
  const [deviceSettings, setDeviceSettings] = useState({ new_device_policy: "pending" });
  const [employeeShifts, setEmployeeShifts] = useState([]);
  const [dailyReport, setDailyReport] = useState({ summary: {}, logs: [] });
  const [employeeReport, setEmployeeReport] = useState({ summary: {}, logs: [], employee: null });
  const [branchReport, setBranchReport] = useState({ summary: {}, branches: [] });
  const [kioskSnapshot, setKioskSnapshot] = useState(null);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deletingEmployeeId, setDeletingEmployeeId] = useState("");
  const [deviceBindingResetTarget, setDeviceBindingResetTarget] = useState(null);
  const [deviceBindingResetEmployeeId, setDeviceBindingResetEmployeeId] = useState("");
  const [resettingDeviceBindings, setResettingDeviceBindings] = useState(false);
  const [attendanceResetTarget, setAttendanceResetTarget] = useState(null);
  const [attendanceResetOptions, setAttendanceResetOptions] = useState({ clearDeviceLocks: false });
  const [resettingAttendanceId, setResettingAttendanceId] = useState("");
  const [uploadingEmployeePhoto, setUploadingEmployeePhoto] = useState(false);
  const [employeePhotoUploadError, setEmployeePhotoUploadError] = useState("");
  const [employeeForm, setEmployeeForm] = useState(() => createEmptyEmployeeForm());
  const [editingEmployee, setEditingEmployee] = useState(null);
  const [employeeEditorOpen, setEmployeeEditorOpen] = useState(false);
  const [shiftForm, setShiftForm] = useState(() => createEmptyShiftForm());
  const [filters, setFilters] = useState({
    date: todayValue(),
    startDate: rangeStartValue(),
    endDate: todayValue(),
    branchId: "",
  });
  const [loading, setLoading] = useState(true);
  const [branchesLoading, setBranchesLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [reportError, setReportError] = useState("");
  const hasShownReportError = useRef(false);
  const lastNotifiedSelectedEmployeeIdRef = useRef("");
  const lastNotifiedSelectedEmployeeSignatureRef = useRef("");
  const lastAutoLoadedEmployeeSignatureRef = useRef("");
  const employeePhotoInputRef = useRef(null);
  const activeBranches = branches.filter((branch) => isBranchActive(branch.is_active));
  const singleBranchId = activeBranches.length === 1 ? String(normalizeBranch(activeBranches[0]).id || "") : "";
  console.log("[employees] dropdown render branches", activeBranches);

  const branchSelectOptions = branchesLoading
    ? [{ id: "", label: tr("options.loadingBranches"), disabled: true }]
    : !activeBranches.length
      ? [{ id: "", label: tr("options.noBranches"), disabled: true }]
      : [
          { id: "", label: tr("options.selectBranch") },
          ...activeBranches.map((branch) => {
            const { id: branchId, name: branchName, code: branchCode } = normalizeBranch(branch);
            return {
              id: branchId,
              label: branchCode ? `${branchName} (${branchCode})` : branchName,
            };
          }),
        ];
  const deviceBindingEmployeeOptions = [
    { id: "", label: tr("options.selectEmployee") },
    ...employees.map((employee) => ({
      id: employee.id,
      label: `${employee.full_name || tr("fields.employee")}${employee.employee_code ? ` (${employee.employee_code})` : ""}`,
    })),
  ];

  const selectedEmployee = useMemo(
    () => employees.find((item) => resolveEmployeeRecordId(item) === String(selectedEmployeeId || "")) || null,
    [employees, selectedEmployeeId]
  );
  const activeEditingEmployeeName = String(employeeForm.full_name || "").trim() || editingEmployee?.full_name || "";
  const profileEmployee = useMemo(
    () => {
      const employeeId = String(employeeForm.id || editingEmployee?.id || "");
      if (!employeeId) return null;

      const baseEmployee =
        editingEmployee ||
        employees.find((item) => resolveEmployeeRecordId(item) === employeeId) ||
        null;

      const mergedEmployee = {
        ...(baseEmployee || {}),
        ...employeeForm,
        id: employeeId,
      };

      return {
        ...mergedEmployee,
        branch_id: employeeForm.branch_id || baseEmployee?.branch_id || "",
        branch_name: employeeForm.branch_name || baseEmployee?.branch_name || "",
        role: employeeForm.role || baseEmployee?.role || "",
        position: employeeForm.position || baseEmployee?.position || employeeForm.job_title || baseEmployee?.job_title || "",
        job_title: employeeForm.job_title || baseEmployee?.job_title || employeeForm.position || baseEmployee?.position || "",
        manager_portal_enabled:
          employeeForm.manager_portal_enabled !== undefined
            ? Boolean(employeeForm.manager_portal_enabled)
            : Boolean(baseEmployee?.manager_portal_enabled),
        manager_portal_token: employeeForm.manager_portal_token || baseEmployee?.manager_portal_token || "",
      };
    },
    [editingEmployee, employeeForm, employees]
  );
  const fallback = tr("fields.notAvailable");
  const employeeSelectOptions = useMemo(
    () => [{ id: "", label: tr("options.selectEmployee") }, ...employees.map((employee) => ({ id: employee.id, label: employee.full_name || tr("fields.employee") }))],
    [employees, tr]
  );
  const employeePhotoPreviewUrl = useMemo(
    () => resolveEmployeeProfileImageUrl(cleanPhotoUrl(employeeForm.photo_url) || cleanPhotoUrl(editingEmployee?.photo_url)),
    [editingEmployee?.photo_url, employeeForm.photo_url]
  );
  const selectedJobTitlePresetId = useMemo(
    () => findJobTitlePreset(employeeForm)?.id || (employeeForm.job_title || employeeForm.role ? "custom" : ""),
    [employeeForm]
  );
  const jobTitlePresetOptions = useMemo(
    () => [
      { id: "", label: isArabic ? "اختر المسمى الوظيفي" : "Select job title" },
      ...jobTitlePresets.map((preset) => ({
        id: preset.id,
        label: jobTitlePresetLabel(preset, isArabic),
      })),
    ],
    [isArabic]
  );
  const applyJobTitlePreset = useCallback((presetId) => {
    const preset = jobTitlePresets.find((item) => item.id === presetId);
    if (!preset) return;
    if (preset.id === "custom") {
      setEmployeeForm((prev) => ({
        ...prev,
        role: prev.role || "employee",
      }));
      return;
    }

    setEmployeeForm((prev) => ({
      ...prev,
      job_title: jobTitlePresetLabel(preset, isArabic),
      position: jobTitlePresetLabel(preset, isArabic),
      role: preset.role,
      can_open_branch: preset.canOpenBranch,
      is_sales_active: preset.salesActive,
      manager_portal_enabled: Boolean(preset.managerPortal),
      pos_alias: preset.salesActive && !prev.pos_alias ? prev.full_name || prev.employee_code || "" : prev.pos_alias,
    }));
  }, [isArabic]);
  const statusLabel = useCallback(
    (value) => {
      const normalized = String(value || "").toLowerCase().replace(/[\s-]+/g, "_");
      return t(`common.employeeHub.attendance.status.${normalized || "unknown"}`, { defaultValue: value || tr("status.unknown") });
    },
    [t, tr]
  );

  const isEditable = hasAnyPermission(["attendance.edit", "attendance.update"]);
  const canDeleteEmployee = hasAnyPermission(["attendance.delete", "attendance.edit"]);
  const canCreateAttendance = hasPermission("attendance.create");
  const canManageAttendanceDevices = isAttendanceDeviceAdmin(currentUserRef.current);

  const loadEmployeeRelatedData = useCallback(async (employeeId) => {
    if (!employeeId) return;

    try {
      const [shiftRows, employeeRes, branchRes, kioskRes] = await Promise.all([
        getAttendanceEmployeeShifts(employeeId),
        getEmployeeAttendanceReport(employeeId, {
          startDate: filters.startDate,
          endDate: filters.endDate,
        }),
        getBranchAttendanceReport({
          startDate: filters.startDate,
          endDate: filters.endDate,
          branchId: filters.branchId || "",
        }),
        getAttendanceKioskSnapshot({ employeeId }),
      ]);

      setEmployeeShifts(safeArray(shiftRows));
      setEmployeeReport(employeeRes?.data || employeeRes || { summary: {}, logs: [], employee: null });
      setBranchReport(branchRes?.data || branchRes || { summary: {}, branches: [] });
      setKioskSnapshot(kioskRes?.data || kioskRes || null);
    } catch (err) {
      console.log(err);
      setEmployeeShifts([]);
      setEmployeeReport({ summary: {}, logs: [], employee: null });
      setBranchReport({ summary: {}, branches: [] });
      setKioskSnapshot(null);
    }
  }, [filters.branchId, filters.endDate, filters.startDate]);

  const loadBaseData = useCallback(async ({ silent = false } = {}) => {
    try {
      if (silent) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setBranchesLoading(true);
      setError("");

      const [employeesResult, dailyResult, branchesResult] = await Promise.allSettled([
        getAttendanceEmployees({ search: "" }),
        getDailyAttendanceReport({ date: filters.date, branchId: filters.branchId || "" }),
        getBranches(),
      ]);

      const nextEmployees = employeesResult.status === "fulfilled" ? safeArray(employeesResult.value) : [];
      const nextBranches =
        branchesResult.status === "fulfilled"
          ? Array.isArray(branchesResult.value)
            ? branchesResult.value
            : Array.isArray(branchesResult.value?.branches)
              ? branchesResult.value.branches
              : Array.isArray(branchesResult.value?.data)
                ? branchesResult.value.data
                : []
          : [];
      const activeBranches = nextBranches.filter((branch) => isBranchActive(branch.is_active));
      const defaultBranchId = activeBranches.length === 1 ? String(normalizeBranch(activeBranches[0]).id || "") : "";
      console.log("[employees] raw branches", nextBranches);
      console.log("[employees] filtered active branches", activeBranches);
      console.log("[employees] branches loaded independently", activeBranches);

      const dailyValue = dailyResult.status === "fulfilled" ? dailyResult.value : null;
      const nextDailyReport = dailyValue?.data || dailyValue || emptyDailyReport;

      const selectedMatch =
        nextEmployees.find(
          (item) =>
            currentUserRef.current &&
            [
              currentUserRef.current.email,
              currentUserRef.current.name,
              currentUserRef.current.full_name,
            ]
              .filter(Boolean)
              .some((value) => String(item.email || item.full_name || "").toLowerCase() === String(value).toLowerCase())
        ) || nextEmployees[0] || null;

      setEmployees((prev) => {
        return sameEmployeeList(prev, nextEmployees) ? prev : nextEmployees;
      });
      setBranches(nextBranches);
      getAttendanceDevices().then((rows) => setAttendanceDevices(safeArray(rows))).catch(() => setAttendanceDevices([]));
      getAttendanceDeviceSettings().then((settings) => setDeviceSettings(settings?.data || settings || { new_device_policy: "pending" })).catch(() => {});
      if (defaultBranchId) {
        setFilters((prev) => {
          if (prev.branchId) return prev;
          const nextBranchId = String(defaultBranchId || "");
          if (String(prev.branchId || "") === nextBranchId) return prev;
          return { ...prev, branchId: nextBranchId };
        });
      }
      setBranchesLoading(false);
      setDailyReport(nextDailyReport);
      if (dailyResult.status === "rejected") {
        const message = dailyResult.reason?.message || tr("errors.dailyReport");
        setReportError(message);
        if (!hasShownReportError.current) {
          toast.error(message);
          hasShownReportError.current = true;
        }
      } else {
        setReportError("");
        hasShownReportError.current = false;
      }
      if (selectedMatch) {
        setSelectedEmployeeId((prev) => {
          const nextSelectedEmployeeId = String(prev || selectedMatch.id || "");
          return prev === nextSelectedEmployeeId ? prev : nextSelectedEmployeeId;
        });
        setEmployeeForm((prev) => {
          if (prev.id) return prev;
          const nextBranchId = selectedMatch.branch_id || defaultBranchId || "";
          const nextBranchName = selectedMatch.branch_name || "";
          if (String(prev.branch_id || "") === String(nextBranchId) && String(prev.branch_name || "") === String(nextBranchName)) {
            return prev;
          }
          return {
            ...prev,
            branch_id: nextBranchId,
            branch_name: nextBranchName,
          };
        });
      } else if (defaultBranchId) {
        setEmployeeForm((prev) => {
          if (prev.branch_id) return prev;
          if (String(prev.branch_id || "") === String(defaultBranchId || "")) return prev;
          return { ...prev, branch_id: defaultBranchId };
        });
      }
    } catch (err) {
      console.log(err);
      setError(err?.message || tr("errors.loadData"));
      toast.error(err?.message || tr("errors.loadData"));
      setBranchesLoading(false);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filters.branchId, filters.date, tr]);

  useEffect(() => {
    queueMicrotask(() => {
      void loadBaseData();
    });
  }, [loadBaseData]);

  useEffect(() => {
    const nextSelectedEmployeeId = String(externalSelectedEmployeeId || "");
    if (!nextSelectedEmployeeId || nextSelectedEmployeeId === String(selectedEmployeeId || "")) return;
    console.log("[hr-loop]", "sync_external_selected_employee", {
      employee_id: nextSelectedEmployeeId,
      selectedEmployeeId,
    });
    setSelectedEmployeeId((prev) => {
      return prev === nextSelectedEmployeeId ? prev : nextSelectedEmployeeId;
    });
  }, [externalSelectedEmployeeId, selectedEmployeeId]);

  useEffect(() => {
    if (typeof onSelectedEmployeeChange !== "function") return;
    const nextSelectedEmployeeId = String(selectedEmployee?.id || selectedEmployee?.employee_id || "");
    const nextSelectedEmployeeSignature = nextSelectedEmployeeId
      ? [
          nextSelectedEmployeeId,
          String(selectedEmployee?.full_name || ""),
          String(selectedEmployee?.employee_code || ""),
          String(selectedEmployee?.branch_id || ""),
          String(selectedEmployee?.status || ""),
          cleanPhotoUrl(selectedEmployee?.photo_url || ""),
        ].join("|")
      : "";
    if (!nextSelectedEmployeeSignature || lastNotifiedSelectedEmployeeSignatureRef.current === nextSelectedEmployeeSignature) return;
    lastNotifiedSelectedEmployeeSignatureRef.current = nextSelectedEmployeeSignature;
    lastNotifiedSelectedEmployeeIdRef.current = nextSelectedEmployeeId;
    console.count("[hr-loop] onSelectedEmployeeChange");
    console.log("[hr-loop]", "notify_parent_selected_employee", {
      employee_id: nextSelectedEmployeeId,
      signature: nextSelectedEmployeeSignature,
    });
    onSelectedEmployeeChange(selectedEmployee || null);
  }, [onSelectedEmployeeChange, selectedEmployee, selectedEmployee?.employee_id, selectedEmployee?.id]);

  useEffect(() => {
    const nextEmployeeId = String(selectedEmployeeId || "");
    if (!nextEmployeeId) return;
    const nextAutoLoadSignature = [
      nextEmployeeId,
      String(filters.startDate || ""),
      String(filters.endDate || ""),
      String(filters.branchId || ""),
    ].join("|");
    if (lastAutoLoadedEmployeeSignatureRef.current === nextAutoLoadSignature) return;
    lastAutoLoadedEmployeeSignatureRef.current = nextAutoLoadSignature;
    console.count("[hr-loop] loadEmployeeRelatedData");
    console.log("[hr-loop]", "load_employee_related_data", {
      employee_id: nextEmployeeId,
      signature: nextAutoLoadSignature,
    });
    queueMicrotask(() => {
      void loadEmployeeRelatedData(nextEmployeeId);
    });
  }, [filters.branchId, filters.endDate, filters.startDate, loadEmployeeRelatedData, selectedEmployeeId]);

  const dashboardSummary = useMemo(() => {
    const summary = dailyReport?.summary || dailyReport || {};
    return {
      present: Number(summary.present || summary.presentToday || 0),
      absent: Number(summary.absent || summary.absentToday || 0),
      late: Number(summary.late || summary.lateEmployees || 0),
      overtime: Number(summary.overtime || summary.overtimeEmployees || 0),
      worked: Number(summary.totalWorkedMinutes || 0),
      workedHours: summary.totalWorkedHours || minutesLabel(summary.totalWorkedMinutes || 0),
    };
  }, [dailyReport]);

  const recentLogs = dailyReport?.logs || [];

  const branchChartData = useMemo(
    () =>
      (branchReport?.branches || []).slice(0, 8).map((row) => ({
        name: row.branch_name || "Branch",
        present: row.present_count || 0,
        late: row.late_count || 0,
        overtime: row.overtime_count || 0,
      })),
    [branchReport]
  );

  const employeeChartData = useMemo(
    () =>
      (employeeReport?.logs || []).slice().reverse().map((row) => ({
        date: row.attendance_date,
        worked: Number(row.work_minutes || 0),
        late: Number(row.late_minutes || 0),
        overtime: Number(row.overtime_minutes || 0),
      })),
    [employeeReport]
  );

  const handleSaveEmployee = async () => {
    if (!employeeForm.full_name.trim()) {
      toast.error(tr("errors.employeeNameRequired"));
      return;
    }

    const saveMode = employeeForm.id ? "update" : "create";
    const employeeId = String(employeeForm.id || "");

    try {
      setSaving(true);
      const payload = {
        ...employeeForm,
        photo_url: cleanPhotoUrl(employeeForm.photo_url),
        salary: Number(employeeForm.salary || 0),
        daily_work_hours: Number(employeeForm.daily_work_hours || 8),
        working_days_per_month: Number(employeeForm.working_days_per_month || 26),
        working_days_per_week: Number(employeeForm.working_days_per_week || 6),
        commission_value: Number(employeeForm.commission_value || 0),
      };

      console.info("[employee-save:start]", {
        mode: saveMode,
        employee_id: employeeId || null,
        full_name: String(payload.full_name || "").trim(),
      });
      console.info("[employee-save:payload]", payload);

      const response = employeeForm.id
        ? await updateAttendanceEmployee(employeeForm.id, payload)
        : await createAttendanceEmployee(payload);

      console.info("[employee-save:response]", response);

      const row = {
        ...(response?.data || response?.employee || response || {}),
        daily_work_hours: payload.daily_work_hours,
        working_days_per_month: payload.working_days_per_month,
        working_days_per_week: payload.working_days_per_week,
        work_start_time: payload.work_start_time || "",
        work_end_time: payload.work_end_time || "",
        absence_deduction_enabled: payload.absence_deduction_enabled !== false,
        missing_hours_deduction_enabled: payload.missing_hours_deduction_enabled !== false,
        late_deduction_enabled: payload.late_deduction_enabled !== false,
        early_leave_deduction_enabled: payload.early_leave_deduction_enabled !== false,
        is_sales_active: Boolean(payload.is_sales_active),
        active_for_pos: Boolean(payload.is_sales_active),
        pos_alias: payload.pos_alias || "",
        commission_mode: payload.commission_mode || "none",
        commission_value: payload.commission_value,
        photo_url: cleanPhotoUrl(response?.data?.photo_url || response?.employee?.photo_url || response?.photo_url || payload.photo_url),
      };
      if (row.id) {
        const settingsResults = await Promise.allSettled([
          updateEmployeePayrollSettings(row.id, {
            salary: payload.salary,
            daily_work_hours: payload.daily_work_hours,
            working_days_per_month: payload.working_days_per_month,
            working_days_per_week: payload.working_days_per_week,
            work_start_time: payload.work_start_time || "",
            work_end_time: payload.work_end_time || "",
            absence_deduction_enabled: payload.absence_deduction_enabled !== false,
            missing_hours_deduction_enabled: payload.missing_hours_deduction_enabled !== false,
            late_deduction_enabled: payload.late_deduction_enabled !== false,
            early_leave_deduction_enabled: payload.early_leave_deduction_enabled !== false,
          }),
          upsertSalesEmployeeProfile(row.id, {
            employee_id: row.id,
            branch_id: payload.branch_id || row.branch_id || "",
            pos_alias: payload.pos_alias || "",
            is_sales_active: Boolean(payload.is_sales_active),
            active_for_pos: Boolean(payload.is_sales_active),
            commission_mode: payload.commission_mode || "none",
            commission_value: payload.commission_value,
          }),
        ]);
        if (settingsResults.some((result) => result.status === "rejected")) {
          toast.error(isArabic ? "تم حفظ الموظف، لكن بعض إعدادات الراتب أو العمولة لم تُحفظ." : "Employee saved, but some payroll or commission settings failed.");
        }
      }
      setEmployees((prev) => {
        const next = prev.filter((item) => String(item.id) !== String(row.id));
        return [row, ...next];
      });
      setEmployeeForm((prev) => ({
        ...prev,
        ...row,
        id: row.id,
        branch_id: row.branch_id || prev.branch_id || "",
        branch_name: row.branch_name || "",
        employee_code: row.employee_code || "",
        full_name: row.full_name || "",
        photo_url: row.photo_url || "",
        phone: row.phone || "",
        email: row.email || "",
        national_id: row.national_id || "",
        role: row.role || "",
        job_title: row.job_title || row.position || "",
        position: row.position || row.job_title || "",
        salary: row.salary || "",
        daily_work_hours: row.daily_work_hours || payload.daily_work_hours || 8,
        working_days_per_month: row.working_days_per_month || payload.working_days_per_month || 26,
        working_days_per_week: row.working_days_per_week || payload.working_days_per_week || 6,
        work_start_time: row.work_start_time || payload.work_start_time || "",
        work_end_time: row.work_end_time || payload.work_end_time || "",
        absence_deduction_enabled: row.absence_deduction_enabled !== false,
        missing_hours_deduction_enabled: row.missing_hours_deduction_enabled !== false,
        late_deduction_enabled: row.late_deduction_enabled !== false,
        early_leave_deduction_enabled: row.early_leave_deduction_enabled !== false,
        is_sales_active: Boolean(payload.is_sales_active),
        pos_alias: payload.pos_alias || "",
        commission_mode: payload.commission_mode || "none",
        commission_value: payload.commission_value || 0,
        hire_date: row.hire_date || todayValue(),
        status: row.status || "active",
        can_open_branch: row.can_open_branch !== false,
        manager_portal_enabled: Boolean(row.manager_portal_enabled),
        manager_portal_token: row.manager_portal_token || "",
      }));
      setEditingEmployee((prev) => (
        String(prev?.id || "") === String(row.id || "")
          ? {
              ...(prev || {}),
              ...row,
              photo_url: cleanPhotoUrl(row.photo_url || payload.photo_url),
            }
          : {
              ...row,
              photo_url: cleanPhotoUrl(row.photo_url || payload.photo_url),
            }
      ));
      setSelectedEmployeeId((current) => String(row.id || current || ""));
      toast.success(employeeForm.id ? tr("toasts.employeeUpdated") : tr("toasts.employeeCreated"));
      void loadBaseData({ silent: true });
      if (row.id) {
        void loadEmployeeRelatedData(String(row.id));
      }
    } catch (err) {
      console.error("[employee-save:error]", err);
      toast.error(err?.message || tr("errors.saveEmployee"));
    } finally {
      setSaving(false);
      console.info("[employee-save:finally]", {
        saving: false,
        employee_id: employeeId || null,
      });
    }
  };

  const handleStartNewEmployee = () => {
    setSelectedEmployeeId("");
    setEditingEmployee(null);
    setEmployeeForm(createEmptyEmployeeForm(singleBranchId));
    setShiftForm(createEmptyShiftForm());
    setEmployeeEditorOpen(true);
    if (typeof onSelectedEmployeeChange === "function") {
      onSelectedEmployeeChange(null);
    }
  };

  const setEmployeePortalToken = (employeeId, token) => {
    setEmployees((prev) => prev.map((employee) => (
      String(employee.id) === String(employeeId) ? { ...employee, employee_portal_token: token } : employee
    )));
    setEmployeeForm((prev) => (
      String(prev.id) === String(employeeId) ? { ...prev, employee_portal_token: token } : prev
    ));
    setEditingEmployee((prev) => (
      String(prev?.id || "") === String(employeeId) ? { ...prev, employee_portal_token: token } : prev
    ));
  };

  const setManagerPortalToken = (employeeId, token, portalUrl = "") => {
    setEmployees((prev) => prev.map((employee) => (
      String(employee.id) === String(employeeId)
        ? { ...employee, manager_portal_token: token, manager_portal_url: portalUrl || employee.manager_portal_url || "" }
        : employee
    )));
    setEmployeeForm((prev) => (
      String(prev.id) === String(employeeId)
        ? { ...prev, manager_portal_token: token, manager_portal_url: portalUrl || prev.manager_portal_url || "" }
        : prev
    ));
    setEditingEmployee((prev) => (
      String(prev?.id || "") === String(employeeId)
        ? { ...prev, manager_portal_token: token, manager_portal_url: portalUrl || prev?.manager_portal_url || "" }
        : prev
    ));
  };

  const handleEditEmployee = (employee) => {
    const nextEmployeeId = String(employee?.id || "");
    if (!nextEmployeeId) return;

    const snapshot = {
      id: employee.id,
      branch_id: employee.branch_id || "",
      branch_name: employee.branch_name || "",
      employee_code: employee.employee_code || "",
      full_name: employee.full_name || "",
      photo_url: cleanPhotoUrl(employee.photo_url || employee.avatar_url || employee.image_url || ""),
      phone: employee.phone || "",
      email: employee.email || "",
      national_id: employee.national_id || "",
      role: employee.role || "",
      job_title: employee.job_title || employee.position || "",
      position: employee.position || employee.job_title || "",
      salary: employee.salary || "",
      daily_work_hours: employee.daily_work_hours || 8,
      working_days_per_month: employee.working_days_per_month || 26,
      working_days_per_week: employee.working_days_per_week || 6,
      work_start_time: employee.work_start_time || "",
      work_end_time: employee.work_end_time || "",
      absence_deduction_enabled: employee.absence_deduction_enabled !== false,
      missing_hours_deduction_enabled: employee.missing_hours_deduction_enabled !== false,
      late_deduction_enabled: employee.late_deduction_enabled !== false,
      early_leave_deduction_enabled: employee.early_leave_deduction_enabled !== false,
      is_sales_active: Boolean(employee.is_sales_active || employee.active_for_pos),
      pos_alias: employee.pos_alias || "",
      commission_mode: employee.commission_mode || (employee.commission_type === "fixed" ? employee.fixed_commission_mode : employee.commission_type) || "none",
      commission_value: employee.commission_value || 0,
      hire_date: employee.hire_date || todayValue(),
      status: employee.status || "active",
      can_open_branch: employee.can_open_branch !== false,
      manager_portal_enabled: Boolean(employee.manager_portal_enabled),
      employee_portal_token: employee.employee_portal_token || "",
      manager_portal_token: employee.manager_portal_token || "",
    };

    setEditingEmployee(snapshot);
    setEmployeeForm({
      ...createEmptyEmployeeForm(singleBranchId),
      ...snapshot,
    });
    setShiftForm(createEmptyShiftForm());
    setSelectedEmployeeId(nextEmployeeId);
    setSelectedTab("employees");
    setEmployeeEditorOpen(true);
  };

  const handleEmployeePhotoUpload = async (event) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;

    try {
      setEmployeePhotoUploadError("");
      setUploadingEmployeePhoto(true);
      const response = await uploadProductImage(file, { timeoutMs: 45000 });
      const nextUrl = String(resolveUploadedImageUrl(response) || "").trim();
      if (!nextUrl) throw new Error(isArabic ? "ظپط´ظ„ ط±ظپط¹ طµظˆط±ط© ط§ظ„ظ…ظˆط¸ظپ." : "Employee photo upload failed.");
      setEmployeeForm((prev) => ({ ...prev, photo_url: cleanPhotoUrl(nextUrl) }));
      toast.success(isArabic ? "طھظ… ط±ظپط¹ طµظˆط±ط© ط§ظ„ظ…ظˆط¸ظپ." : "Employee photo uploaded.");
    } catch (err) {
      console.log(err);
      const errorMessage =
        err?.name === "TimeoutError" || String(err?.message || "").toLowerCase().includes("timed out")
          ? (isArabic ? "ط§ظ†طھظ‡ظ‰ ظˆظ‚طھ ط±ظپط¹ طµظˆط±ط© ط§ظ„ظ…ظˆط¸ظپ. ط­ط§ظˆظ„ ظ…ط±ط© ط£ط®ط±ظ‰." : "Employee photo upload timed out. Please try again.")
          : (err?.message || (isArabic ? "ظپط´ط„ ط±ظپط¹ طµظˆط±ط© ط§ظ„ظ…ظˆط¸ظپ." : "Employee photo upload failed."));
      setEmployeePhotoUploadError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setUploadingEmployeePhoto(false);
      if (input) {
        input.value = "";
      }
    }
  };

  const handleDeleteEmployee = async () => {
    if (!deleteTarget?.id) return;

    const employeeId = String(deleteTarget.id);
    const previousEmployees = employees;
    try {
      setDeletingEmployeeId(employeeId);
      setEmployees((prev) => prev.filter((item) => String(item.id) !== employeeId));
      setDeleteTarget(null);

      await deleteAttendanceEmployee(employeeId);

      if (String(selectedEmployeeId) === employeeId) {
        const nextEmployee = previousEmployees.find((item) => String(item.id) !== employeeId) || null;
        setSelectedEmployeeId(nextEmployee ? String(nextEmployee.id) : "");
        setEmployeeShifts([]);
        setEmployeeReport({ summary: {}, logs: [], employee: null });
        setKioskSnapshot(null);
      }
      if (String(employeeForm.id) === employeeId) {
        setEmployeeForm(createEmptyEmployeeForm(singleBranchId));
        setEditingEmployee(null);
      }
      toast.success(tr("toasts.employeeDeleted"));
    } catch (err) {
      setEmployees(previousEmployees);
      toast.error(err?.message || tr("errors.deleteEmployee"));
    } finally {
      setDeletingEmployeeId("");
    }
  };

  const handleSaveShift = async () => {
    if (!selectedEmployeeId) {
      toast.error(tr("errors.selectEmployee"));
      return;
    }
    if (!shiftForm.shift_name.trim()) {
      toast.error(tr("errors.shiftNameRequired"));
      return;
    }

    try {
      setSaving(true);
      const payload = {
        shift_name: shiftForm.shift_name,
        start_time: shiftForm.start_time,
        end_time: shiftForm.end_time,
        check_in_window_start: shiftForm.check_in_window_start || shiftForm.start_time,
        check_in_window_end: shiftForm.check_in_window_end,
        allowed_late_minutes: Number(shiftForm.allowed_late_minutes || 0),
        overtime_after_minutes: Number(shiftForm.overtime_after_minutes || 0),
        working_days: shiftForm.working_days,
      };

      const response = shiftForm.id
        ? await updateAttendanceShift(shiftForm.id, payload)
        : await createAttendanceEmployeeShift(selectedEmployeeId, payload);

      const row = response?.data || response?.shift || response;
      setEmployeeShifts((prev) => {
        const next = prev.filter((item) => String(item.id) !== String(row.id));
        return [row, ...next];
      });
      setShiftForm({
        id: "",
        shift_name: "",
        start_time: "09:00",
        end_time: "17:00",
        check_in_window_start: "09:00",
        check_in_window_end: "10:00",
        allowed_late_minutes: 15,
        overtime_after_minutes: 0,
        working_days: "Sun,Mon,Tue,Wed,Thu",
      });
      toast.success(tr("toasts.shiftSaved"));
      await loadEmployeeRelatedData(selectedEmployeeId);
    } catch (err) {
      console.log(err);
      toast.error(err?.message || tr("errors.saveShift"));
    } finally {
      setSaving(false);
    }
  };

  const handleOpenShift = async () => {
    if (!selectedEmployeeId) {
      toast.error(tr("errors.selectEmployee"));
      return;
    }
    try {
      setSaving(true);
      await checkInEmployee({
        employee_id: selectedEmployeeId,
        attendance_source: "pos",
        notes: "Opened from POS / Attendance kiosk",
        branch_id: selectedEmployee?.branch_id || filters.branchId || null,
        shift_id: employeeShifts[0]?.id || null,
      });
      toast.success(tr("toasts.shiftOpened"));
      await loadEmployeeRelatedData(selectedEmployeeId);
      await loadBaseData({ silent: true });
    } catch (err) {
      console.log(err);
      toast.error(err?.message || tr("errors.openShift"));
    } finally {
      setSaving(false);
    }
  };

  const handleCloseShift = async () => {
    if (!selectedEmployeeId) {
      toast.error(tr("errors.selectEmployee"));
      return;
    }
    try {
      setSaving(true);
      await checkOutEmployee({
        employee_id: selectedEmployeeId,
        attendance_log_id: kioskSnapshot?.today_attendance?.id || selectedEmployee?.today_attendance?.id || null,
        notes: "Closed from POS / Attendance kiosk",
      });
      toast.success(tr("toasts.shiftClosed"));
      await loadEmployeeRelatedData(selectedEmployeeId);
      await loadBaseData({ silent: true });
    } catch (err) {
      console.log(err);
      toast.error(err?.message || tr("errors.closeShift"));
    } finally {
      setSaving(false);
    }
  };

  const reloadAttendanceDevices = async () => {
    try {
      setAttendanceDevices(safeArray(await getAttendanceDevices()));
    } catch (err) {
      console.log(err);
      toast.error(err?.message || tr("errors.loadDevices"));
    }
  };

  const removeResetDeviceBindingRows = (target, response = {}) => {
    const businessDate = dateKey(response?.business_date || response?.data?.business_date || target?.businessDate || todayValue());
    setAttendanceDevices((prev) =>
      prev.filter((device) => {
        if (!isDeviceBindingRow(device)) {
          if (target.type === "employee") return String(device.employee_id || "") !== String(target.employeeId || "");
          return true;
        }
        if (target.type === "all") return false;
        if (target.type === "today") return dateKey(device.business_date) !== businessDate;
        if (target.type === "binding") return String(device.id || "") !== String(target.bindingId || "");
        if (target.type === "device") return String(device.device_key || "") !== String(target.deviceKey || "");
        if (target.type === "employee") {
          return String(device.employee_id || "") !== String(target.employeeId || "") || dateKey(device.business_date) !== businessDate;
        }
        return true;
      })
    );
  };

  const handleApproveDevice = async (deviceId) => {
    try {
      setSaving(true);
      await approveAttendanceDevice(deviceId);
      toast.success(tr("toasts.deviceApproved"));
      await reloadAttendanceDevices();
      await loadBaseData({ silent: true });
    } catch (err) {
      console.log(err);
      toast.error(err?.message || tr("errors.approveDevice"));
    } finally {
      setSaving(false);
    }
  };

  const handleRejectDevice = async (deviceId) => {
    try {
      setSaving(true);
      await rejectAttendanceDevice(deviceId);
      toast.success(tr("toasts.deviceRejected"));
      await reloadAttendanceDevices();
      await loadBaseData({ silent: true });
    } catch (err) {
      console.log(err);
      toast.error(err?.message || tr("errors.rejectDevice"));
    } finally {
      setSaving(false);
    }
  };

  const handleResetEmployeeDevice = async (employeeId) => {
    if (!employeeId) return;
    try {
      setSaving(true);
      setAttendanceDevices((prev) =>
        prev.filter((device) => !(device.record_type === "approval" && String(device.employee_id || "") === String(employeeId)))
      );
      const response = await resetEmployeeAttendanceDeviceBindings(employeeId, todayValue());
      const deletedCount = getDeletedCount(response);
      showDeviceLockResetToast(deletedCount, tr);
      await reloadAttendanceDevices();
      await loadBaseData({ silent: true });
    } catch (err) {
      console.log(err);
      toast.error(err?.message || tr("errors.resetEmployeeDevice"));
      await reloadAttendanceDevices();
    } finally {
      setSaving(false);
    }
  };

  const handleResetDeviceBindingRow = async (device) => {
    if (!device) return;
    const target = device.record_type === "binding" && (device.binding_id || device.id)
      ? { type: "binding", bindingId: device.binding_id || device.id }
      : device.device_key
      ? { type: "device", deviceKey: device.device_key }
      : { type: "employee", employeeId: device.employee_id, businessDate: dateKey(device.business_date) || todayValue() };
    if (target.type === "employee" && !target.employeeId) return;

    try {
      setResettingDeviceBindings(true);
      removeResetDeviceBindingRows(target);
      const response = target.type === "device"
        ? await resetAttendanceDeviceBindingByKey(target.deviceKey)
        : target.type === "binding"
          ? await resetAttendanceDeviceBinding(device)
        : await resetEmployeeAttendanceDeviceBindings(target.employeeId, target.businessDate);
      const deletedCount = getDeletedCount(response);
      showDeviceLockResetToast(deletedCount, tr);
      await reloadAttendanceDevices();
    } catch (err) {
      console.log(err);
      toast.error(err?.message || tr("errors.resetDeviceLock"));
      await reloadAttendanceDevices();
    } finally {
      setResettingDeviceBindings(false);
    }
  };

  const openTodayDeviceBindingReset = () => {
    setDeviceBindingResetTarget({
      type: "today",
      title: tr("dialogs.resetTodayDeviceLocksTitle"),
      body: tr("dialogs.resetTodayDeviceLocksBody"),
      detailLabel: tr("fields.scope"),
      detailValue: tr("dialogs.resetTodayDeviceLocksValue"),
    });
  };

  const openEmployeeDeviceBindingReset = () => {
    const employee = employees.find((item) => String(item.id) === String(deviceBindingResetEmployeeId));
    if (!employee) {
      toast.error(tr("errors.selectEmployee"));
      return;
    }

    setDeviceBindingResetTarget({
      type: "employee",
      employeeId: employee.id,
      businessDate: todayValue(),
      title: tr("dialogs.resetEmployeeDeviceLockTitle"),
      body: tr("dialogs.resetEmployeeDeviceLockBody"),
      detailLabel: employee.full_name || tr("fields.employee"),
      detailValue: employee.employee_code || tr("fields.noEmployeeCode"),
    });
  };

  const openAllDeviceBindingReset = () => {
    setDeviceBindingResetTarget({
      type: "all",
      title: tr("dialogs.resetAllDeviceLocksTitle"),
      body: tr("dialogs.resetAllDeviceLocksBody"),
      detailLabel: tr("fields.scope"),
      detailValue: tr("dialogs.resetAllDeviceLocksValue"),
    });
  };

  const handleConfirmDeviceBindingReset = async () => {
    if (!deviceBindingResetTarget) return;

    try {
      setResettingDeviceBindings(true);
      const response = deviceBindingResetTarget.type === "today"
        ? await resetTodayAttendanceDeviceBindings()
        : deviceBindingResetTarget.type === "all"
          ? await resetAllAttendanceDeviceBindings()
          : await resetEmployeeAttendanceDeviceBindings(deviceBindingResetTarget.employeeId, deviceBindingResetTarget.businessDate || todayValue());
      const deletedCount = getDeletedCount(response);
      removeResetDeviceBindingRows(deviceBindingResetTarget, response);
      showDeviceLockResetToast(deletedCount, tr);
      setDeviceBindingResetTarget(null);
      if (deviceBindingResetTarget.type === "employee") {
        setDeviceBindingResetEmployeeId("");
      }
      await reloadAttendanceDevices();
    } catch (err) {
      console.log(err);
      toast.error(err?.message || tr("errors.resetDeviceLocks"));
    } finally {
      setResettingDeviceBindings(false);
    }
  };

  const openTodayAttendanceReset = (employee) => {
    if (!employee?.id) return;
    setAttendanceResetOptions({ clearDeviceLocks: false });
    setAttendanceResetTarget(employee);
  };

  const handleConfirmTodayAttendanceReset = async () => {
    if (!attendanceResetTarget?.id) return;
    const employeeId = attendanceResetTarget.id;

    try {
      setResettingAttendanceId(String(employeeId));
      const response = await resetEmployeeTodayAttendance(employeeId, {
        clear_device_locks: Boolean(attendanceResetOptions.clearDeviceLocks),
      });
      const deletedRows = getDeletedRows(response);
      const deletedCount = getDeletedCount(response);
      const attendanceRows = getDeletedAttendanceRows(response, deletedRows);
      const remainingRows = getRemainingTodayRows(response);
      if (remainingRows > 0) {
        toast.error(tr("errors.resetRemainingRows", { count: remainingRows }));
        return;
      }
      if (attendanceRows === 0) {
        toast.error(tr("errors.noTodayAttendanceRows"));
      } else {
        toast.success(tr("toasts.todayAttendanceReset", { count: deletedCount }));
      }
      setAttendanceResetTarget(null);
      await loadBaseData({ silent: true });
      if (String(selectedEmployeeId) === String(employeeId)) {
        await loadEmployeeRelatedData(employeeId);
      }
      if (attendanceResetOptions.clearDeviceLocks) {
        await reloadAttendanceDevices();
      }
    } catch (err) {
      console.log(err);
      const status = err?.status || err?.response?.status;
      const code = err?.responseBody?.code || err?.code;
      const remainingRows = getRemainingTodayRows(err?.responseBody || {});
      if (remainingRows > 0) {
        toast.error(tr("errors.resetRemainingRows", { count: remainingRows }));
      } else if (status === 404 || code === "NO_TODAY_ATTENDANCE_ROWS") {
        toast.error(err?.message || tr("errors.noTodayAttendanceRows"));
      } else {
        toast.error(err?.message || tr("errors.resetTodayAttendance"));
      }
    } finally {
      setResettingAttendanceId("");
    }
  };

  const handleDevicePolicyChange = async (value) => {
    try {
      setSaving(true);
      const response = await updateAttendanceDeviceSettings({ new_device_policy: value });
      setDeviceSettings(response?.data || response?.settings || { new_device_policy: value });
      toast.success(tr("toasts.devicePolicyUpdated"));
    } catch (err) {
      console.log(err);
      toast.error(err?.message || tr("errors.updateDevicePolicy"));
    } finally {
      setSaving(false);
    }
  };

  const allTabs = useMemo(
    () => [
      { key: "dashboard", label: tr("tabs.dashboard") },
      { key: "employees", label: tr("tabs.employees") },
      { key: "devices", label: tr("tabs.devices") },
      { key: "reports", label: tr("tabs.reports") },
      { key: "kiosk", label: tr("tabs.kiosk") },
    ],
    [tr]
  );
  const visibleTabsKey = Array.isArray(visibleTabs) ? visibleTabs.join("|") : "";
  const tabs = useMemo(
    () => {
      const tabIds = visibleTabsKey ? visibleTabsKey.split("|").filter(Boolean) : [];
      const visibleTabsSet = new Set(tabIds);
      return visibleTabsSet.size ? allTabs.filter((tab) => visibleTabsSet.has(tab.key)) : allTabs;
    },
    [allTabs, visibleTabsKey]
  );

  useEffect(() => {
    const fallbackTab = tabs.some((tab) => tab.key === defaultTab) ? defaultTab : tabs[0]?.key || "dashboard";
    setSelectedTab((prev) => {
      if (tabs.some((tab) => tab.key === prev)) return prev;
      if (prev === fallbackTab) return prev;
      return fallbackTab;
    });
  }, [defaultTab, tabs]);

  return (
    <div className="space-y-6" dir={direction}>
      {!embedded ? (
      <div className="flex flex-col gap-4 rounded-[34px] border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <div className={isArabic ? "text-[11px] font-bold text-zinc-500" : "text-[11px] uppercase tracking-[0.24em] text-zinc-500"}>{tr("eyebrow")}</div>
          <h1 className="m1-page-title mt-2 text-white">{tr("title")}</h1>
          <p className="mt-2 max-w-3xl text-sm text-zinc-400">
            {tr("subtitle")}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => loadBaseData()}
            className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
          >
            {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {t("common.refresh")}
          </button>
          {hasPermission("attendance.export") ? (
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-2 rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-black text-black transition hover:bg-emerald-400"
            >
              <Download className="h-4 w-4" />
              {tr("actions.printExport")}
            </button>
          ) : null}
        </div>
      </div>
      ) : null}

      {!embedded && tabs.length > 1 ? (
      <div className="flex flex-wrap gap-2">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setSelectedTab(tab.key)}
            className={`rounded-2xl px-4 py-3 text-sm font-semibold transition ${ selectedTab === tab.key ? "bg-emerald-500 text-black" : "border border-white/10 bg-white/5 text-white hover:bg-white/10" }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      ) : null}

      {!embedded && !hideMetrics ? (
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <AttendanceMetricCard label={tr("metrics.presentToday")} value={dashboardSummary.present} tone="emerald" isRtl={isArabic} />
        <AttendanceMetricCard label={tr("metrics.absentToday")} value={dashboardSummary.absent} tone="rose" isRtl={isArabic} />
        <AttendanceMetricCard label={tr("metrics.lateEmployees")} value={dashboardSummary.late} tone="amber" isRtl={isArabic} />
        <AttendanceMetricCard label={tr("metrics.overtimeEmployees")} value={dashboardSummary.overtime} tone="blue" isRtl={isArabic} />
        <AttendanceMetricCard label={tr("metrics.totalWorkedHours")} value={dashboardSummary.workedHours} tone="zinc" isRtl={isArabic} />
      </div>
      ) : null}

      {!embedded && canManageAttendanceDevices ? (
        <section className="rounded-[34px] border border-amber-400/15 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div className="max-w-3xl">
              <div className={isArabic ? "text-[11px] font-bold text-amber-200" : "text-[11px] uppercase tracking-[0.2em] text-amber-200"}>{tr("admin.eyebrow")}</div>
              <h2 className="m1-section-title mt-1 text-white">{tr("admin.title")}</h2>
              <p className="mt-2 text-sm leading-6 text-zinc-400">
                {tr("admin.subtitle")}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSelectedTab("devices")}
              className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
            >
              <Smartphone className="h-4 w-4" />
              {tr("admin.viewDeviceApprovals")}
            </button>
          </div>

          <div className="mt-5 grid gap-3 lg:grid-cols-[minmax(240px,1fr)_auto] xl:grid-cols-[minmax(280px,1fr)_auto_auto_auto]">
            <SelectField
              label={tr("fields.employee")}
              value={deviceBindingResetEmployeeId}
              onChange={setDeviceBindingResetEmployeeId}
              options={deviceBindingEmployeeOptions}
              disabled={resettingDeviceBindings || employees.length === 0}
            />
            <button
              type="button"
              onClick={openEmployeeDeviceBindingReset}
              disabled={resettingDeviceBindings || !deviceBindingResetEmployeeId}
              className="inline-flex items-center justify-center gap-2 rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm font-black text-rose-100 transition hover:border-rose-300/60 hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-50 lg:self-end"
            >
              <Trash2 className="h-4 w-4" />
              {tr("actions.resetEmployeeDeviceLock")}
            </button>
            <button
              type="button"
              onClick={openTodayDeviceBindingReset}
              disabled={resettingDeviceBindings}
              className="inline-flex items-center justify-center gap-2 rounded-2xl border border-rose-400/30 bg-rose-600 px-4 py-3 text-sm font-black text-white transition hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-60 lg:self-end"
            >
              <AlertTriangle className="h-4 w-4" />
              {tr("actions.resetTodayDeviceLocks")}
            </button>
            <button
              type="button"
              onClick={openAllDeviceBindingReset}
              disabled={resettingDeviceBindings}
              className="inline-flex items-center justify-center gap-2 rounded-2xl border border-red-400/40 bg-red-700 px-4 py-3 text-sm font-black text-white transition hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-60 lg:self-end"
            >
              <Trash2 className="h-4 w-4" />
              {tr("actions.resetAllDeviceLocks")}
            </button>
          </div>
        </section>
      ) : null}

      {error ? (
        <div className="rounded-3xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-100">
          <AlertTriangle className="mr-2 inline h-4 w-4" />
          {error}
        </div>
      ) : null}

      {!embedded && reportError && (selectedTab === "dashboard" || selectedTab === "reports") ? (
        <div className="rounded-3xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-100">
          <AlertTriangle className="mr-2 inline h-4 w-4" />
          {reportError}
        </div>
      ) : null}

      {loading ? (
        <div className="grid gap-4 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="h-64 animate-pulse rounded-[30px] border border-white/10 bg-white/5" />
          ))}
        </div>
      ) : null}

      {selectedTab === "dashboard" ? (
        <div className="grid gap-6 xl:grid-cols-12">
          <section className="rounded-[34px] border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10 xl:col-span-8">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className={isArabic ? "text-[11px] font-bold text-zinc-500" : "text-[11px] uppercase tracking-[0.2em] text-zinc-500"}>{tr("dashboard.todayChart")}</div>
                <h2 className="m1-section-title text-white">{tr("dashboard.branchAttendanceMix")}</h2>
              </div>
              <div className="text-xs text-zinc-500">{tr("dashboard.presentLateOvertime")}</div>
            </div>
            <div className="mt-5 h-[320px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={branchChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                  <XAxis dataKey="name" stroke="#71717a" tick={{ fill: "#a1a1aa", fontSize: 12 }} />
                  <YAxis stroke="#71717a" tick={{ fill: "#a1a1aa", fontSize: 12 }} />
                  <Tooltip
                    contentStyle={{ background: "#09090b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 16 }}
                    labelStyle={{ color: "#fff" }}
                  />
                  <Bar dataKey="present" fill="#10b981" radius={[10, 10, 0, 0]} />
                  <Bar dataKey="late" fill="#f59e0b" radius={[10, 10, 0, 0]} />
                  <Bar dataKey="overtime" fill="#3b82f6" radius={[10, 10, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="rounded-[34px] border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10 xl:col-span-4">
            <div className="flex items-center justify-between">
              <div>
                <div className={isArabic ? "text-[11px] font-bold text-zinc-500" : "text-[11px] uppercase tracking-[0.2em] text-zinc-500"}>{t("common.status")}</div>
                <h2 className="m1-section-title text-white">{tr("dashboard.dailySummary")}</h2>
              </div>
              <ShieldCheck className="h-5 w-5 text-emerald-400" />
            </div>

            <div className="mt-4 grid gap-3">
              <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
                <div className="flex items-center justify-between text-sm text-zinc-300">
                  <span>{tr("fields.totalEmployees")}</span>
                  <span className="font-semibold text-white">{dashboardSummary.present + dashboardSummary.absent}</span>
                </div>
                <div className="mt-2 flex items-center justify-between text-sm text-zinc-300">
                  <span>{tr("fields.workedHours")}</span>
                  <span className="font-semibold text-white">{dashboardSummary.workedHours}</span>
                </div>
              </div>
              <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
                <div className={isArabic ? "text-xs font-bold text-zinc-500" : "text-xs uppercase tracking-[0.2em] text-zinc-500"}>{tr("fields.today")}</div>
                <div className="mt-2 text-lg font-black text-white">{filters.date}</div>
                <div className="mt-2 text-sm text-zinc-400">{tr("dashboard.posLinkHint")}</div>
              </div>
            </div>
          </section>

          <section className="rounded-[34px] border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10 xl:col-span-12">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className={isArabic ? "text-[11px] font-bold text-zinc-500" : "text-[11px] uppercase tracking-[0.2em] text-zinc-500"}>{tr("dashboard.recentLogs")}</div>
                <h2 className="m1-section-title text-white">{tr("dashboard.attendanceList")}</h2>
              </div>
              <div className="flex items-center gap-2 text-sm text-zinc-400">
                <Filter className="h-4 w-4" />
                {tr("dashboard.filtersAutoApply")}
              </div>
            </div>
            <div className="mt-4 overflow-hidden rounded-[28px] border border-white/10">
              <div className="grid grid-cols-8 bg-white/5 px-4 py-3 text-[11px] uppercase tracking-[0.2em] text-zinc-500">
                <span className="col-span-2">{tr("fields.employee")}</span>
                <span>{tr("fields.branch")}</span>
                <span>{tr("fields.shift")}</span>
                <span>{tr("fields.checkIn")}</span>
                <span>{tr("fields.checkOut")}</span>
                <span>{t("common.status")}</span>
                <span>{tr("fields.worked")}</span>
              </div>
              <div className="divide-y divide-white/5">
                {recentLogs.length === 0 ? (
                  <div className="p-8 text-center text-zinc-400">{tr("empty.noAttendanceLogs")}</div>
                ) : (
                  recentLogs.map((row) => {
                    const status = row.check_out ? (Number(row.late_minutes || 0) > 0 ? "late" : Number(row.overtime_minutes || 0) > 0 ? "overtime" : "present") : "checked_in";
                    return (
                      <div key={row.id} className="grid grid-cols-8 items-center px-4 py-4 text-sm">
                        <div className="col-span-2">
                          <div className="font-semibold text-white">{row.full_name || row.employee_name}</div>
                          <div className="text-xs text-zinc-500">{row.employee_code || fallback} - {formatEmployeeJobLabel(row, language)}</div>
                        </div>
                        <div className="text-zinc-300">{row.branch_name || fallback}</div>
                        <div className="text-zinc-300">{row.shift_name || fallback}</div>
                        <div className="text-zinc-300">{formatSafeTime(row.check_in, fallback)}</div>
                        <div className="text-zinc-300">{row.check_out ? formatSafeTime(row.check_out, tr("status.open")) : tr("status.open")}</div>
                        <div>
                          <StatusPill tone={statusTone(status)} label={statusLabel(status)} />
                        </div>
                        <div className="font-semibold text-white">{minutesLabel(row.work_minutes || 0)}</div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {selectedTab === "employees" ? (
        <div className="grid gap-6 xl:grid-cols-12">
          <section className={`rounded-[34px] border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10 ${employeeEditorOpen ? "hidden" : "xl:col-span-12"}`}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className={isArabic ? "text-[11px] font-bold text-zinc-500" : "text-[11px] uppercase tracking-[0.2em] text-zinc-500"}>{tr("employees.employeeList")}</div>
                <h2 className="m1-section-title text-white">{tr("employees.employeesAndShifts")}</h2>
                <p className="mt-2 text-sm leading-6 text-zinc-400">
                  {isArabic ? "اختار موظف للتعديل أو افتح ملف موظف جديد. بيانات الموظف الكاملة أصبحت في صفحة مستقلة بدل الفورم الجانبي." : "Select an employee to edit or open a new employee profile. Full employee settings now live in a dedicated page."}
                </p>
              </div>
              <button
                type="button"
                onClick={handleStartNewEmployee}
                className="inline-flex items-center justify-center rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-black text-black transition hover:bg-emerald-400"
              >
                {isArabic ? "+ إضافة موظف" : "+ Add Employee"}
              </button>
            </div>

            <div className="mt-4 overflow-x-auto rounded-[28px] border border-white/10">
              <div className="min-w-[920px]">
              <div className="grid grid-cols-12 bg-white/5 px-4 py-3 text-[11px] uppercase tracking-[0.2em] text-zinc-500">
                <span className="col-span-3">{tr("fields.name")}</span>
                <span>{tr("fields.code")}</span>
                <span>{tr("fields.branch")}</span>
                <span>{tr("fields.jobTitle")}</span>
                <span>{t("common.status")}</span>
                <span>{tr("fields.shift")}</span>
                <span>{tr("fields.checkIn")}</span>
                <span className="col-span-2">{tr("fields.actions")}</span>
              </div>
              <div className="divide-y divide-white/5">
                {employees.length === 0 ? (
                  <div className="p-8 text-center text-zinc-400">{tr("empty.noEmployees")}</div>
                ) : (
                  employees.map((employee) => (
                    <div key={employee.id} className="grid grid-cols-12 items-center px-4 py-4 text-sm">
                      <div className="col-span-3">
                        <div className="font-semibold text-white">{employee.full_name}</div>
                        <div className="text-xs text-zinc-500">{employee.email || fallback}</div>
                      </div>
                      <div className="text-zinc-300">{employee.employee_code}</div>
                      <div className="text-zinc-300">{employee.branch_name || fallback}</div>
                      <div className="text-zinc-300" dir="auto">{formatEmployeeJobLabel(employee, language)}</div>
                      <div><StatusPill tone={employee.status === "active" ? "emerald" : "rose"} label={statusLabel(employee.status || "active")} /></div>
                      <div className="text-zinc-300">{employee.current_shift?.shift_name || fallback}</div>
                      <div className="text-zinc-300">{formatSafeTime(employee.today_attendance?.check_in, fallback)}</div>
                      <div className="col-span-2 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => handleEditEmployee(employee)}
                          className="inline-flex items-center gap-1 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white transition hover:bg-white/10"
                        >
                          <Edit3 className="h-3.5 w-3.5" />
                          {tr("actions.edit")}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedEmployeeId(String(employee.id));
                            setSelectedTab("kiosk");
                          }}
                          className="inline-flex items-center gap-1 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white transition hover:bg-white/10"
                        >
                          <ScanBarcode className="h-3.5 w-3.5" />
                          {tr("tabs.kiosk")}
                        </button>
                        {canDeleteEmployee ? (
                          <button
                            type="button"
                            title={tr("actions.resetToday")}
                            aria-label={tr("actions.resetToday")}
                            onClick={() => openTodayAttendanceReset(employee)}
                            disabled={String(resettingAttendanceId) === String(employee.id)}
                            className="inline-flex items-center gap-1 rounded-2xl border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-100 transition hover:border-amber-300/60 hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {String(resettingAttendanceId) === String(employee.id) ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                            {tr("actions.resetToday")}
                          </button>
                        ) : null}
                        {canDeleteEmployee ? (
                          <button
                            type="button"
                            title={tr("actions.deleteEmployee")}
                            aria-label={tr("actions.deleteEmployee")}
                            onClick={() => setDeleteTarget(employee)}
                            disabled={String(deletingEmployeeId) === String(employee.id)}
                            className="inline-flex h-[var(--control-height-md)] w-9 items-center justify-center rounded-2xl border border-rose-400/30 bg-rose-500/10 text-rose-200 transition hover:border-rose-300/60 hover:bg-rose-500/20 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {String(deletingEmployeeId) === String(employee.id) ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ))
                )}
              </div>
              </div>
            </div>
          </section>

          <section className={employeeEditorOpen ? "space-y-5 xl:col-span-12" : "hidden"}>
            <div className="rounded-[34px] border border-amber-400/20 bg-gradient-to-br from-zinc-950 via-zinc-950 to-amber-950/20 p-5 shadow-2xl shadow-black/10">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <div className={isArabic ? "text-[11px] font-bold text-amber-300" : "text-[11px] uppercase tracking-[0.2em] text-amber-300"}>{isArabic ? "ملف الموظف" : "Employee profile"}</div>
                  <h2 className="m1-section-title mt-2 text-white">
                    {employeeForm.id ? (employeeForm.full_name || tr("employees.editEmployee")) : (isArabic ? "إضافة موظف جديد" : "Add new employee")}
                  </h2>
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">
                    {isArabic
                      ? "كل ما يخص الموظف في مكان واحد: البيانات الأساسية، بوابة الموظف، بوابة المدير، الراتب، العمولات، لوائح الخصم، صلاحية فتح الفرع والوردية."
                      : "Everything for the employee in one place: basics, employee portal, manager portal, salary, commissions, deduction rules, branch-opening eligibility, and shifts."}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setEmployeeEditorOpen(false)}
                    className="inline-flex items-center justify-center rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
                  >
                    {isArabic ? "رجوع لدليل الموظفين" : "Back to employees"}
                  </button>
                  {isEditable ? (
                    <button
                      type="button"
                      onClick={handleSaveEmployee}
                      disabled={saving}
                      className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-5 py-3 text-sm font-black text-black transition hover:bg-emerald-400 disabled:opacity-50"
                    >
                      {saving ? t("common.saving") : employeeForm.id ? tr("actions.updateEmployee") : tr("actions.createEmployee")}
                    </button>
                  ) : null}
                </div>
              </div>
            </div>

            {isEditable ? (
              <div className="rounded-[34px] border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10">
                <div className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">
                  {employeeForm.id ? tr("employees.editEmployee") : tr("employees.createEmployee")}
                </div>
                <h3 className="m1-section-title mt-2 text-white">{tr("employees.employeeProfile")}</h3>

                <div className="mt-4 grid gap-3">
                  <div className="rounded-[28px] border border-white/10 bg-white/5 p-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-3xl border border-white/10 bg-white/5 shadow-lg shadow-black/10">
                        {employeePhotoPreviewUrl ? (
                          <img src={employeePhotoPreviewUrl} alt={employeeForm.full_name || "Employee photo"} className="h-full w-full object-cover" />
                        ) : (
                          <span className="text-lg font-black text-white">
                            {String(employeeForm.full_name || "EM")
                              .trim()
                              .split(/\s+/)
                              .slice(0, 2)
                              .map((part) => part[0] || "")
                              .join("")
                              .toUpperCase() || "EM"}
                          </span>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[10px] font-bold text-zinc-500">{isArabic ? "صورة الموظف" : "Employee photo"}</div>
                        <div className="mt-1 text-xs text-zinc-500">
                          {isArabic ? "ارفع صورة أو الصق رابط الصورة الرسمي." : "Upload an image or paste the official employee photo URL."}
                        </div>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <input
                        ref={employeePhotoInputRef}
                        type="file"
                        accept="image/*"
                        onChange={handleEmployeePhotoUpload}
                        className="hidden"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setEmployeePhotoUploadError("");
                          employeePhotoInputRef.current?.click();
                        }}
                        disabled={uploadingEmployeePhoto}
                        className="inline-flex min-h-[var(--control-height-md)] items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {uploadingEmployeePhoto ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
                        {uploadingEmployeePhoto ? (isArabic ? "جارٍ الرفع..." : "Uploading...") : (isArabic ? "رفع صورة" : "Upload photo")}
                      </button>
                      {employeeForm.photo_url ? (
                        <button
                          type="button"
                          onClick={() => setEmployeeForm((prev) => ({ ...prev, photo_url: "" }))}
                          className="inline-flex min-h-[var(--control-height-md)] items-center justify-center rounded-2xl border border-white/10 bg-transparent px-4 py-2 text-sm font-semibold text-zinc-300 transition hover:bg-white/5 hover:text-white"
                        >
                          {isArabic ? "إزالة الصورة" : "Remove photo"}
                        </button>
                      ) : null}
                    </div>
                    {employeePhotoUploadError ? (
                      <p className="mt-2 text-sm font-semibold text-rose-400">
                        {employeePhotoUploadError}
                      </p>
                    ) : null}
                  </div>
                  {activeBranches.length > 1 ? (
                    <SelectField
                      label={tr("fields.branch")}
                      value={employeeForm.branch_id || singleBranchId}
                      onChange={(value) => setEmployeeForm((prev) => ({ ...prev, branch_id: value }))}
                      options={branchSelectOptions}
                      disabled={branchesLoading}
                    />
                  ) : null}
                  {!branchesLoading && !activeBranches.length ? (
                    <div className="rounded-2xl border border-dashed border-white/10 bg-white/5 p-4 text-sm font-semibold text-zinc-400">
                      {tr("options.noBranches")}
                    </div>
                  ) : null}
                  <InputField label={tr("fields.employeeCode")} value={employeeForm.employee_code} onChange={(value) => setEmployeeForm((prev) => ({ ...prev, employee_code: value }))} />
                  <InputField label={tr("fields.fullName")} value={employeeForm.full_name} onChange={(value) => setEmployeeForm((prev) => ({ ...prev, full_name: value }))} />
                  <InputField
                    label={isArabic ? "رابط الصورة" : "Photo URL"}
                    value={employeeForm.photo_url}
                    onChange={(value) => setEmployeeForm((prev) => ({ ...prev, photo_url: value }))}
                    helper={isArabic ? "يتم حفظ هذا الرابط في employees.photo_url ويُستخدم في صورة البوابة." : "Saved to employees.photo_url and used by the portal avatar."}
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <InputField label={tr("fields.phone")} value={employeeForm.phone} onChange={(value) => setEmployeeForm((prev) => ({ ...prev, phone: value }))} />
                    <InputField label={tr("fields.email")} value={employeeForm.email} onChange={(value) => setEmployeeForm((prev) => ({ ...prev, email: value }))} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <InputField label={tr("fields.nationalId")} value={employeeForm.national_id} onChange={(value) => setEmployeeForm((prev) => ({ ...prev, national_id: value }))} />
                    <InputField label={tr("fields.salary")} type="number" value={employeeForm.salary} onChange={(value) => setEmployeeForm((prev) => ({ ...prev, salary: value }))} />
                  </div>
                  <div className="rounded-[28px] border border-primary/20 bg-primary/10 p-4">
                    <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                      <div>
                        <div className="text-sm font-black text-primary">{isArabic ? "إعدادات المسمى الوظيفي" : "Job title settings"}</div>
                        <div className="mt-1 text-xs font-semibold leading-5 text-primary/65">
                          {isArabic ? "اختيار المسمى هنا يضبط الدور الداخلي وصلاحيات POS وفتح الفرع تلقائياً، ويمكنك استخدام مسمى مخصص عند الحاجة." : "Choosing a title here sets the internal role, POS seller access, and branch-opening eligibility automatically. Use custom when needed."}
                        </div>
                      </div>
                      <span className="w-fit rounded-full border border-primary/20 bg-black/20 px-3 py-1 text-[11px] font-black text-primary">
                        {employeeForm.job_title || (isArabic ? "غير محدد" : "Not set")}
                      </span>
                    </div>
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <SelectField
                        label={tr("fields.jobTitle")}
                        value={selectedJobTitlePresetId}
                        onChange={applyJobTitlePreset}
                        options={jobTitlePresetOptions}
                      />
                      <InputField
                        label={isArabic ? "المسمى الظاهر في الجدول والبوابة" : "Visible job title"}
                        value={employeeForm.job_title}
                        onChange={(value) => setEmployeeForm((prev) => ({ ...prev, job_title: value, position: value }))}
                      />
                      <InputField
                        label={tr("fields.internalRole")}
                        value={employeeForm.role}
                        onChange={(value) => setEmployeeForm((prev) => ({ ...prev, role: value }))}
                        helper={isArabic ? "الدور الداخلي يُستخدم في الصلاحيات والبوابات وتحديد نوع الموظف داخل النظام." : "Internal role is used for permissions, portals, and employee behavior inside the system."}
                      />
                      <div className="grid gap-2">
                        <label className="flex cursor-pointer items-center justify-between gap-3 rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-xs font-bold text-zinc-200">
                          <span>{isArabic ? "مؤهل لفتح الفرع في POS" : "Can open POS branch"}</span>
                          <input
                            type="checkbox"
                            checked={employeeForm.can_open_branch !== false}
                            onChange={(event) => setEmployeeForm((prev) => ({ ...prev, can_open_branch: event.target.checked }))}
                            className="h-4 w-4 accent-primary"
                          />
                        </label>
                        <label className="flex cursor-pointer items-center justify-between gap-3 rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-xs font-bold text-zinc-200">
                          <span>{isArabic ? "يظهر كبائع في POS" : "Show as POS salesperson"}</span>
                          <input
                            type="checkbox"
                            checked={Boolean(employeeForm.is_sales_active)}
                            onChange={(event) => setEmployeeForm((prev) => ({ ...prev, is_sales_active: event.target.checked }))}
                            className="h-4 w-4 accent-primary"
                          />
                        </label>
                        <label className="flex cursor-pointer items-center justify-between gap-3 rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-xs font-bold text-zinc-200">
                          <span>{isArabic ? "تفعيل بوابة المدير" : "Enable manager portal"}</span>
                          <input
                            type="checkbox"
                            checked={Boolean(employeeForm.manager_portal_enabled)}
                            onChange={(event) => setEmployeeForm((prev) => ({ ...prev, manager_portal_enabled: event.target.checked }))}
                            className="h-4 w-4 accent-primary"
                          />
                        </label>
                      </div>
                    </div>
                  </div>
                  <div className="rounded-[28px] border border-white/10 bg-black/20 p-4">
                    <div className="text-sm font-black text-white">{isArabic ? "إعدادات الراتب والحضور" : "Payroll & attendance settings"}</div>
                    <div className="mt-3 grid grid-cols-2 gap-3">
                      <InputField
                        label={isArabic ? "ساعات العمل اليومية" : "Daily work hours"}
                        type="number"
                        value={employeeForm.daily_work_hours}
                        onChange={(value) => setEmployeeForm((prev) => ({ ...prev, daily_work_hours: value }))}
                      />
                      <InputField
                        label={isArabic ? "أيام العمل شهريًا" : "Working days / month"}
                        type="number"
                        value={employeeForm.working_days_per_month}
                        onChange={(value) => setEmployeeForm((prev) => ({ ...prev, working_days_per_month: value }))}
                      />
                      <InputField
                        label={isArabic ? "أيام العمل أسبوعيًا" : "Working days / week"}
                        type="number"
                        value={employeeForm.working_days_per_week}
                        onChange={(value) => setEmployeeForm((prev) => ({ ...prev, working_days_per_week: value }))}
                      />
                      <InputField
                        label={isArabic ? "بداية العمل الافتراضية" : "Default start time"}
                        type="time"
                        value={employeeForm.work_start_time || ""}
                        onChange={(value) => setEmployeeForm((prev) => ({ ...prev, work_start_time: value }))}
                      />
                      <InputField
                        label={isArabic ? "نهاية العمل الافتراضية" : "Default end time"}
                        type="time"
                        value={employeeForm.work_end_time || ""}
                        onChange={(value) => setEmployeeForm((prev) => ({ ...prev, work_end_time: value }))}
                      />
                    </div>
                    <div className="mt-3 grid gap-2">
                      {[
                        ["absence_deduction_enabled", isArabic ? "احتساب خصم الغياب" : "Apply absence deduction"],
                        ["missing_hours_deduction_enabled", isArabic ? "احتساب خصم ساعات النقص" : "Apply missing-hours deduction"],
                        ["late_deduction_enabled", isArabic ? "احتساب خصم التأخير" : "Apply late deduction"],
                        ["early_leave_deduction_enabled", isArabic ? "احتساب خصم الانصراف المبكر" : "Apply early-leave deduction"],
                      ].map(([key, label]) => (
                        <label key={key} className="flex cursor-pointer items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-bold text-zinc-200">
                          <span>{label}</span>
                          <input
                            type="checkbox"
                            checked={employeeForm[key] !== false}
                            onChange={(event) => setEmployeeForm((prev) => ({ ...prev, [key]: event.target.checked }))}
                            className="h-4 w-4 accent-amber-400"
                          />
                        </label>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-[28px] border border-amber-400/20 bg-amber-500/10 p-4">
                    <div className="text-sm font-black text-amber-100">{isArabic ? "إعدادات البيع والعمولات POS" : "POS sales & commission settings"}</div>
                    <label className="mt-3 flex cursor-pointer items-center justify-between gap-3 rounded-2xl border border-amber-200/15 bg-black/20 px-3 py-2 text-xs font-bold text-amber-50">
                      <span>{isArabic ? "إظهار الموظف كبائع في POS" : "Show employee as POS salesperson"}</span>
                      <input
                        type="checkbox"
                        checked={Boolean(employeeForm.is_sales_active)}
                        onChange={(event) => setEmployeeForm((prev) => ({ ...prev, is_sales_active: event.target.checked }))}
                        className="h-4 w-4 accent-amber-400"
                      />
                    </label>
                    <div className="mt-3 grid grid-cols-2 gap-3">
                      <InputField
                        label={isArabic ? "اسم مختصر في POS" : "POS alias"}
                        value={employeeForm.pos_alias || ""}
                        onChange={(value) => setEmployeeForm((prev) => ({ ...prev, pos_alias: value }))}
                      />
                      <SelectField
                        label={isArabic ? "نوع العمولة" : "Commission type"}
                        value={employeeForm.commission_mode || "none"}
                        onChange={(value) => setEmployeeForm((prev) => ({ ...prev, commission_mode: value }))}
                        options={[
                          { id: "none", label: isArabic ? "بدون عمولة" : "No commission" },
                          { id: "percent", label: isArabic ? "نسبة %" : "Percentage %" },
                          { id: "fixed_per_item", label: isArabic ? "مبلغ على كل قطعة" : "Fixed per item" },
                          { id: "fixed_per_invoice", label: isArabic ? "مبلغ على كل فاتورة" : "Fixed per invoice" },
                        ]}
                      />
                      <InputField
                        label={employeeForm.commission_mode === "percent" ? (isArabic ? "نسبة العمولة %" : "Commission percent") : (isArabic ? "قيمة العمولة" : "Commission amount")}
                        type="number"
                        value={employeeForm.commission_value}
                        onChange={(value) => setEmployeeForm((prev) => ({ ...prev, commission_value: value }))}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <InputField label={tr("fields.hireDate")} type="date" value={employeeForm.hire_date} onChange={(value) => setEmployeeForm((prev) => ({ ...prev, hire_date: value }))} />
                    <div />
                  </div>
                  <SelectField
                    label={t("common.status")}
                    value={employeeForm.status}
                    onChange={(value) => setEmployeeForm((prev) => ({ ...prev, status: value }))}
                    options={[
                      { id: "active", label: statusLabel("active") },
                      { id: "inactive", label: statusLabel("inactive") },
                    ]}
                  />
                  <label className="flex cursor-pointer items-start justify-between gap-4 rounded-[28px] border border-emerald-400/20 bg-emerald-500/10 p-4">
                    <span className="min-w-0">
                      <span className="block text-sm font-black text-emerald-100">
                        {isArabic ? "مؤهل لفتح الفرع" : "Eligible to open branch"}
                      </span>
                      <span className="mt-1 block text-xs font-semibold leading-5 text-emerald-100/65">
                        {isArabic
                          ? "فعّلها للموظف الذي يمكن اختياره كفاتح الفرع القادم عند قفل شيفت POS."
                          : "Enable this employee in the POS next-opening selector."}
                      </span>
                    </span>
                    <input
                      type="checkbox"
                      checked={employeeForm.can_open_branch !== false}
                      onChange={(event) => setEmployeeForm((prev) => ({ ...prev, can_open_branch: event.target.checked }))}
                      className="mt-1 h-5 w-5 shrink-0 accent-emerald-500"
                    />
                  </label>
                  <div className="rounded-[28px] border border-white/10 bg-white/5 p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-zinc-500">
                          {isArabic ? "وصول بوابة المدير" : "Manager Portal Access"}
                        </div>
                        <div className="mt-2 text-sm font-semibold text-white">
                          {isArabic ? "تفعيل بوابة المدير لهذا الموظف" : "Enable manager portal for this employee"}
                        </div>
                        <div className="mt-1 text-xs leading-5 text-zinc-400">
                          {isArabic
                            ? "يمكن منح صلاحية بوابة المدير بدون تغيير الدور الرئيسي للموظف."
                            : "Manager portal access can be granted without changing the employee's main role."}
                        </div>
                        <div className="mt-2 text-xs font-bold text-zinc-400">
                          {isArabic ? "الفرع الحالي" : "Current branch"}: {employeeForm.branch_name || selectedEmployee?.branch_name || fallback}
                        </div>
                      </div>
                      <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-white/10 bg-black/20 px-3 py-2">
                        <span className="text-xs font-black text-white">{employeeForm.manager_portal_enabled ? (isArabic ? "مفعّل" : "Enabled") : (isArabic ? "غير مفعّل" : "Disabled")}</span>
                        <input
                          type="checkbox"
                          checked={Boolean(employeeForm.manager_portal_enabled)}
                          onChange={(event) => setEmployeeForm((prev) => ({ ...prev, manager_portal_enabled: event.target.checked }))}
                          className="h-5 w-5 accent-emerald-500"
                        />
                      </label>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleSaveEmployee}
                    disabled={saving}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-black text-black transition hover:bg-emerald-400 disabled:opacity-50"
                  >
                    {saving ? t("common.saving") : employeeForm.id ? tr("actions.updateEmployee") : tr("actions.createEmployee")}
                  </button>
                </div>
              </div>
            ) : null}

            {profileEmployee ? (
              <EmployeePortalAccessCard employee={profileEmployee} onEmployeeTokenChange={setEmployeePortalToken} />
            ) : null}

            {profileEmployee ? (
              <ManagerPortalAccessCard employee={profileEmployee} onEmployeeTokenChange={setManagerPortalToken} />
            ) : null}

            {isEditable ? (
              <div className="rounded-[34px] border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10">
                <div className={isArabic ? "text-[11px] font-bold text-zinc-500" : "text-[11px] uppercase tracking-[0.2em] text-zinc-500"}>{tr("employees.shiftAssignment")}</div>
                <h3 className="m1-section-title mt-2 text-white">{activeEditingEmployeeName || tr("options.selectEmployee")}</h3>
                <div className="mt-4 grid gap-3">
                  <InputField label={tr("fields.shiftName")} value={shiftForm.shift_name} onChange={(value) => setShiftForm((prev) => ({ ...prev, shift_name: value }))} />
                  <div className="grid grid-cols-2 gap-3">
                    <InputField label={tr("fields.startTime")} type="time" value={shiftForm.start_time} onChange={(value) => setShiftForm((prev) => ({ ...prev, start_time: value }))} />
                    <InputField label={tr("fields.endTime")} type="time" value={shiftForm.end_time} onChange={(value) => setShiftForm((prev) => ({ ...prev, end_time: value }))} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <InputField label={isArabic ? "بداية نافذة الحضور" : "Check-in window start"} type="time" value={shiftForm.check_in_window_start} onChange={(value) => setShiftForm((prev) => ({ ...prev, check_in_window_start: value }))} />
                    <InputField label={isArabic ? "نهاية نافذة الحضور" : "Check-in window end"} type="time" value={shiftForm.check_in_window_end} onChange={(value) => setShiftForm((prev) => ({ ...prev, check_in_window_end: value }))} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <InputField label={tr("fields.allowedLateMinutes")} type="number" value={shiftForm.allowed_late_minutes} onChange={(value) => setShiftForm((prev) => ({ ...prev, allowed_late_minutes: value }))} />
                    <InputField label={tr("fields.overtimeAfterMinutes")} type="number" value={shiftForm.overtime_after_minutes} onChange={(value) => setShiftForm((prev) => ({ ...prev, overtime_after_minutes: value }))} />
                  </div>
                  <InputField
                    label={tr("fields.workingDays")}
                    value={shiftForm.working_days}
                    onChange={(value) => setShiftForm((prev) => ({ ...prev, working_days: value }))}
                    helper={tr("fields.workingDaysHelper")}
                  />
                  <div className="flex flex-wrap gap-2">
                    {employeeShifts.map((shift) => (
                      <button
                        key={shift.id}
                        type="button"
                        onClick={() =>
                          setShiftForm({
                            id: shift.id,
                            shift_name: shift.shift_name || "",
                            start_time: String(shift.start_time || "09:00").slice(0, 5),
                            end_time: String(shift.end_time || "17:00").slice(0, 5),
                            check_in_window_start: String(shift.check_in_window_start || shift.start_time || "09:00").slice(0, 5),
                            check_in_window_end: String(shift.check_in_window_end || "").slice(0, 5),
                            allowed_late_minutes: shift.allowed_late_minutes || 0,
                            overtime_after_minutes: shift.overtime_after_minutes || 0,
                            working_days: Array.isArray(shift.working_days) ? shift.working_days.join(",") : String(shift.working_days || ""),
                          })
                        }
                        className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white"
                      >
                        {shift.shift_name}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={handleSaveShift}
                    disabled={saving}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-3 text-sm font-black text-black transition hover:bg-primary disabled:opacity-50"
                  >
                    <Plus className="h-4 w-4" />
                    {saving ? t("common.saving") : shiftForm.id ? tr("actions.updateShift") : tr("actions.assignShift")}
                  </button>
                </div>
              </div>
            ) : null}
          </section>
        </div>
      ) : null}

      {selectedTab === "devices" ? (
        <div className="grid gap-6 xl:grid-cols-12">
          <section className="rounded-[34px] border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10 xl:col-span-12">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <div className={isArabic ? "text-[11px] font-bold text-zinc-500" : "text-[11px] uppercase tracking-[0.2em] text-zinc-500"}>{tr("devices.security")}</div>
                <h2 className="m1-section-title text-white">{tr("devices.approvals")}</h2>
                <p className="mt-2 text-sm text-zinc-400">
                  {tr("devices.subtitle")}
                </p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <SelectField
                  label={tr("devices.newPhonePolicy")}
                  value={deviceSettings?.new_device_policy || "pending"}
                  onChange={handleDevicePolicyChange}
                  options={[
                    { id: "pending", label: tr("devices.pendingApproval") },
                    { id: "block", label: tr("devices.blockImmediately") },
                  ]}
                />
                <button
                  type="button"
                  onClick={reloadAttendanceDevices}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
                >
                  <RefreshCw className="h-4 w-4" />
                  {tr("actions.refreshDevices")}
                </button>
              </div>
            </div>

            <div className="mt-5 overflow-x-auto rounded-[28px] border border-white/10">
              <div className="min-w-[880px]">
                <div className="grid grid-cols-12 bg-white/5 px-4 py-3 text-[11px] uppercase tracking-[0.2em] text-zinc-500">
                  <span className="col-span-3">{tr("fields.employee")}</span>
                  <span className="col-span-2">{t("common.status")}</span>
                  <span className="col-span-2">{tr("fields.token")}</span>
                  <span className="col-span-2">{tr("fields.lastSeen")}</span>
                  <span className="col-span-3">{tr("fields.actions")}</span>
                </div>
                <div className="divide-y divide-white/5">
                  {attendanceDevices.length === 0 ? (
                    <div className="p-8 text-center text-zinc-400">{tr("empty.noDevices")}</div>
                  ) : (
                    attendanceDevices.map((device) => (
                      <div key={`${device.record_type || "approval"}-${device.id}`} className="grid grid-cols-12 items-center gap-2 px-4 py-4 text-sm">
                        <div className="col-span-3">
                          <div className="font-semibold text-white">{device.employee_name || tr("fields.employeeWithId", { id: device.employee_id })}</div>
                          <div className="text-xs text-zinc-500">
                            {device.employee_code || fallback} / {device.branch_name || tr("fields.noBranch")}
                            {isDeviceBindingRow(device) && device.business_date ? ` / ${dateKey(device.business_date)}` : ""}
                          </div>
                        </div>
                        <div className="col-span-2">
                          <StatusPill
                            tone={device.status === "approved" ? "emerald" : device.status === "pending" || device.status === "locked" ? "amber" : device.status === "rejected" ? "rose" : "zinc"}
                            label={isDeviceBindingRow(device) ? tr("status.deviceLock") : statusLabel(device.status || "unknown")}
                          />
                        </div>
                        <div className="col-span-2 font-mono text-xs text-zinc-300">...{device.device_token_tail || fallback}</div>
                        <div className="col-span-2 text-zinc-300">
                          {formatSafeDateTime(device.last_seen_at, fallback)}
                        </div>
                        <div className="col-span-3 flex flex-wrap gap-2">
                        {isDeviceBindingRow(device) ? (
                          <button
                            type="button"
                            onClick={() => handleResetDeviceBindingRow(device)}
                            disabled={!isEditable || resettingDeviceBindings}
                            className="inline-flex items-center gap-1 rounded-2xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-100 disabled:opacity-50"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            {tr("actions.resetLock")}
                          </button>
                        ) : null}
                        {!isDeviceBindingRow(device) && device.status === "pending" ? (
                          <>
                            <button
                              type="button"
                              onClick={() => handleApproveDevice(device.id)}
                              disabled={!isEditable || saving}
                              className="inline-flex items-center gap-1 rounded-2xl bg-emerald-500 px-3 py-2 text-xs font-black text-black disabled:opacity-50"
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              {tr("actions.approve")}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRejectDevice(device.id)}
                              disabled={!isEditable || saving}
                              className="inline-flex items-center gap-1 rounded-2xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-100 disabled:opacity-50"
                            >
                              <XCircle className="h-3.5 w-3.5" />
                              {tr("actions.reject")}
                            </button>
                          </>
                        ) : null}
                        {!isDeviceBindingRow(device) && device.status === "approved" ? (
                          <button
                            type="button"
                            onClick={() => handleResetEmployeeDevice(device.employee_id)}
                            disabled={!isEditable || saving}
                            className="inline-flex items-center gap-1 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                          >
                            <Smartphone className="h-3.5 w-3.5" />
                            {tr("actions.reset")}
                          </button>
                        ) : null}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {selectedTab === "reports" ? (
        <div className="grid gap-6 xl:grid-cols-12">
          <section className="rounded-[34px] border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10 xl:col-span-12">
            <div className="flex flex-wrap items-end gap-3">
              <InputField label={tr("fields.dailyDate")} type="date" value={filters.date} onChange={(value) => setFilters((prev) => ({ ...prev, date: value }))} />
              <InputField label={tr("fields.startDate")} type="date" value={filters.startDate} onChange={(value) => setFilters((prev) => ({ ...prev, startDate: value }))} />
              <InputField label={tr("fields.endDate")} type="date" value={filters.endDate} onChange={(value) => setFilters((prev) => ({ ...prev, endDate: value }))} />
              {activeBranches.length > 1 ? (
                <SelectField
                  label={tr("fields.branch")}
                  value={filters.branchId}
                  onChange={(value) => setFilters((prev) => ({ ...prev, branchId: value }))}
                  options={[
                    { id: "", label: tr("options.allBranches") },
                    ...activeBranches.map((branch) => {
                      const { id: branchId, name: branchName, code: branchCode } = normalizeBranch(branch);
                      return {
                        id: branchId,
                        label: branchCode ? `${branchName} (${branchCode})` : branchName,
                      };
                    }),
                  ]}
                />
              ) : null}
              <SelectField
                label={tr("fields.employee")}
                value={selectedEmployeeId}
                onChange={setSelectedEmployeeId}
                options={employeeSelectOptions}
              />
            </div>
          </section>

          <section className="rounded-[34px] border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10 xl:col-span-7">
            <div className={isArabic ? "text-[11px] font-bold text-zinc-500" : "text-[11px] uppercase tracking-[0.2em] text-zinc-500"}>{tr("reports.employeeTrend")}</div>
            <h2 className="m1-section-title text-white">{tr("reports.workedMinutesByDay")}</h2>
            <div className="mt-5 h-[320px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={employeeChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                  <XAxis dataKey="date" stroke="#71717a" tick={{ fill: "#a1a1aa", fontSize: 12 }} />
                  <YAxis stroke="#71717a" tick={{ fill: "#a1a1aa", fontSize: 12 }} />
                  <Tooltip
                    contentStyle={{ background: "#09090b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 16 }}
                    labelStyle={{ color: "#fff" }}
                  />
                  <Line type="monotone" dataKey="worked" stroke="#10b981" strokeWidth={3} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="late" stroke="#f59e0b" strokeWidth={2} dot={{ r: 2 }} />
                  <Line type="monotone" dataKey="overtime" stroke="#3b82f6" strokeWidth={2} dot={{ r: 2 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="rounded-[34px] border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10 xl:col-span-5">
            <div className={isArabic ? "text-[11px] font-bold text-zinc-500" : "text-[11px] uppercase tracking-[0.2em] text-zinc-500"}>{tr("reports.branchTotals")}</div>
            <h2 className="m1-section-title text-white">{tr("reports.branchReport")}</h2>
            <div className="mt-4 space-y-3">
              {(branchReport?.branches || []).length === 0 ? (
                <div className="rounded-3xl border border-dashed border-white/10 bg-white/5 p-8 text-center text-zinc-400">
                  {tr("empty.noBranchAttendance")}
                </div>
              ) : (
                branchReport.branches.map((row) => (
                  <div key={String(row.branch_id || row.branch_name)} className="rounded-3xl border border-white/10 bg-white/5 p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-semibold text-white">{row.branch_name}</div>
                        <div className="text-xs text-zinc-500">{tr("reports.workedValue", { value: row.total_work_hours })}</div>
                      </div>
                      <Warehouse className="h-5 w-5 text-emerald-400" />
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
                      <MiniStat label={statusLabel("present")} value={row.present_count} tone="emerald" isRtl={isArabic} />
                      <MiniStat label={statusLabel("late")} value={row.late_count} tone="amber" isRtl={isArabic} />
                      <MiniStat label={statusLabel("overtime")} value={row.overtime_count} tone="blue" isRtl={isArabic} />
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="rounded-[34px] border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10 xl:col-span-12">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className={isArabic ? "text-[11px] font-bold text-zinc-500" : "text-[11px] uppercase tracking-[0.2em] text-zinc-500"}>{tr("reports.employeeReport")}</div>
                <h2 className="m1-section-title text-white">{employeeReport?.employee?.full_name || tr("options.selectEmployee")}</h2>
              </div>
              <div className="text-sm text-zinc-400">
                {tr("reports.dateRange", { start: filters.startDate, end: filters.endDate })}
              </div>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-4">
              <AttendanceMetricCard label={tr("metrics.daysPresent")} value={employeeReport?.summary?.daysPresent || 0} tone="emerald" isRtl={isArabic} />
              <AttendanceMetricCard label={tr("metrics.lateDays")} value={employeeReport?.summary?.lateDays || 0} tone="amber" isRtl={isArabic} />
              <AttendanceMetricCard label={tr("metrics.overtimeDays")} value={employeeReport?.summary?.overtimeDays || 0} tone="blue" isRtl={isArabic} />
              <AttendanceMetricCard label={tr("metrics.workedHours")} value={employeeReport?.summary?.totalWorkedHours || "00:00"} tone="zinc" isRtl={isArabic} />
            </div>
            <div className="mt-5 overflow-hidden rounded-[28px] border border-white/10">
              <div className="grid grid-cols-7 bg-white/5 px-4 py-3 text-[11px] uppercase tracking-[0.2em] text-zinc-500">
                <span>{tr("fields.date")}</span>
                <span>{tr("fields.checkIn")}</span>
                <span>{tr("fields.checkOut")}</span>
                <span>{tr("fields.branch")}</span>
                <span>{tr("fields.shift")}</span>
                <span>{t("common.status")}</span>
                <span>{tr("fields.worked")}</span>
              </div>
              <div className="divide-y divide-white/5">
                {(employeeReport?.logs || []).length === 0 ? (
                  <div className="p-8 text-center text-zinc-400">{tr("empty.noEmployeeReport")}</div>
                ) : (
                  employeeReport.logs.map((row) => (
                    <div key={row.id} className="grid grid-cols-7 items-center px-4 py-4 text-sm">
                      <span className="text-white">{row.attendance_date}</span>
                      <span className="text-zinc-300">{formatSafeTime(row.check_in, fallback)}</span>
                      <span className="text-zinc-300">{row.check_out ? formatSafeTime(row.check_out, tr("status.open")) : tr("status.open")}</span>
                      <span className="text-zinc-300">{row.branch_name || fallback}</span>
                      <span className="text-zinc-300">{row.shift_name || fallback}</span>
                      <StatusPill tone={statusTone(Number(row.late_minutes || 0) > 0 ? "late" : Number(row.overtime_minutes || 0) > 0 ? "overtime" : "present")} label={statusLabel(Number(row.late_minutes || 0) > 0 ? "late" : Number(row.overtime_minutes || 0) > 0 ? "overtime" : "present")} />
                      <span className="font-semibold text-white">{minutesLabel(row.work_minutes || 0)}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {selectedTab === "kiosk" ? (
        <div className="grid gap-6 xl:grid-cols-12">
          <section className="rounded-[34px] border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10 xl:col-span-5">
            <div className={isArabic ? "text-[11px] font-bold text-zinc-500" : "text-[11px] uppercase tracking-[0.2em] text-zinc-500"}>{tr("kiosk.mode")}</div>
            <h2 className="m1-section-title text-white">{tr("kiosk.openCloseShift")}</h2>
            <p className="mt-2 text-sm text-zinc-400">
              {tr("kiosk.subtitle")}
            </p>

            <div className="mt-5 grid gap-3">
              <SelectField
                label={tr("fields.employee")}
                value={selectedEmployeeId}
                onChange={setSelectedEmployeeId}
                options={employeeSelectOptions}
              />
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={handleOpenShift}
                  disabled={!canCreateAttendance || saving}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-black text-black transition hover:bg-emerald-400 disabled:opacity-50"
                >
                  <UserCheck className="h-4 w-4" />
                  {tr("actions.openShift")}
                </button>
                <button
                  type="button"
                  onClick={handleCloseShift}
                  disabled={!canCreateAttendance || saving}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10 disabled:opacity-50"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  {tr("actions.closeShift")}
                </button>
              </div>
            </div>

            <div className="mt-5 rounded-[28px] border border-white/10 bg-white/5 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className={isArabic ? "text-xs font-bold text-zinc-500" : "text-xs uppercase tracking-[0.18em] text-zinc-500"}>{tr("kiosk.currentEmployee")}</div>
                  <div className="mt-1 text-lg font-black text-white">{selectedEmployee?.full_name || fallback}</div>
                </div>
                <Clock3 className="h-5 w-5 text-emerald-400" />
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <MiniStat label={tr("fields.shift")} value={kioskSnapshot?.current_shift?.shift_name || selectedEmployee?.current_shift?.shift_name || fallback} tone="emerald" isRtl={isArabic} />
                <MiniStat label={tr("fields.branch")} value={kioskSnapshot?.branch_name || selectedEmployee?.branch_name || fallback} tone="blue" isRtl={isArabic} />
                <MiniStat label={tr("fields.checkIn")} value={formatSafeTime(kioskSnapshot?.today_attendance?.check_in, fallback)} tone="amber" isRtl={isArabic} />
                <MiniStat label={t("common.status")} value={kioskSnapshot?.today_attendance?.check_out ? statusLabel("closed") : kioskSnapshot?.today_attendance?.check_in ? tr("status.open") : statusLabel("off")} tone="zinc" isRtl={isArabic} />
              </div>
              {canDeleteEmployee && selectedEmployee ? (
                <button
                  type="button"
                  onClick={() => openTodayAttendanceReset(selectedEmployee)}
                  disabled={String(resettingAttendanceId) === String(selectedEmployee.id)}
                  className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm font-black text-amber-100 transition hover:border-amber-300/60 hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {String(resettingAttendanceId) === String(selectedEmployee.id) ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                  {tr("actions.resetTodayAttendance")}
                </button>
              ) : null}
            </div>
          </section>

          <section className="rounded-[34px] border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10 xl:col-span-7">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className={isArabic ? "text-[11px] font-bold text-zinc-500" : "text-[11px] uppercase tracking-[0.2em] text-zinc-500"}>{tr("kiosk.linkedToPos")}</div>
                <h2 className="m1-section-title text-white">{tr("kiosk.shiftSnapshot")}</h2>
              </div>
              <ScanBarcode className="h-5 w-5 text-emerald-400" />
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-4">
              <AttendanceMetricCard label={tr("metrics.workMinutes")} value={kioskSnapshot?.today_attendance?.work_minutes ? minutesLabel(kioskSnapshot.today_attendance.work_minutes) : "00:00"} tone="emerald" isRtl={isArabic} />
              <AttendanceMetricCard label={tr("metrics.lateMinutes")} value={kioskSnapshot?.today_attendance?.late_minutes || 0} tone="amber" isRtl={isArabic} />
              <AttendanceMetricCard label={tr("metrics.earlyLeave")} value={kioskSnapshot?.today_attendance?.early_leave_minutes || 0} tone="rose" isRtl={isArabic} />
              <AttendanceMetricCard label={statusLabel("overtime")} value={kioskSnapshot?.today_attendance?.overtime_minutes || 0} tone="blue" isRtl={isArabic} />
            </div>
            <div className="mt-5 overflow-hidden rounded-[28px] border border-white/10">
              <div className="grid grid-cols-5 bg-white/5 px-4 py-3 text-[11px] uppercase tracking-[0.2em] text-zinc-500">
                <span>{tr("fields.employee")}</span>
                <span>{tr("fields.branch")}</span>
                <span>{tr("fields.shift")}</span>
                <span>{tr("fields.checkIn")}</span>
                <span>{t("common.status")}</span>
              </div>
              <div className="divide-y divide-white/5">
                {selectedEmployee ? (
                  <div className="grid grid-cols-5 items-center px-4 py-4 text-sm">
                    <span className="font-semibold text-white">{selectedEmployee.full_name}</span>
                    <span className="text-zinc-300">{selectedEmployee.branch_name || fallback}</span>
                    <span className="text-zinc-300">{kioskSnapshot?.current_shift?.shift_name || selectedEmployee?.current_shift?.shift_name || fallback}</span>
                    <span className="text-zinc-300">{formatSafeTime(kioskSnapshot?.today_attendance?.check_in, fallback)}</span>
                    <StatusPill tone={kioskSnapshot?.today_attendance?.check_out ? "zinc" : kioskSnapshot?.today_attendance?.check_in ? "emerald" : "rose"} label={kioskSnapshot?.today_attendance?.check_out ? statusLabel("closed") : kioskSnapshot?.today_attendance?.check_in ? tr("status.open") : statusLabel("off")} />
                  </div>
                ) : (
                  <div className="p-8 text-center text-zinc-400">{tr("empty.selectEmployeeKiosk")}</div>
                )}
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {deleteTarget ? (
        <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/75 px-3 py-4 backdrop-blur-sm sm:items-center sm:px-4 sm:py-6">
          <section className="w-full max-w-md rounded-[28px] border border-rose-400/20 bg-zinc-950 p-5 shadow-2xl shadow-black/40">
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-rose-400/30 bg-rose-500/10 text-rose-200">
                <Trash2 className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <div className={isArabic ? "text-[11px] font-bold text-rose-300" : "text-[11px] uppercase tracking-[0.2em] text-rose-300"}>{tr("dialogs.deleteEmployeeTitle")}</div>
                <h3 className="m1-section-title mt-1 text-white">{tr("dialogs.deleteEmployeeTitle")}</h3>
                <p className="mt-2 text-sm leading-6 text-zinc-300">{tr("dialogs.deleteEmployeeBody")}</p>
              </div>
            </div>

            <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
              <div className="text-sm font-bold text-white">{deleteTarget.full_name || tr("fields.employee")}</div>
              <div className="mt-1 text-xs font-semibold text-zinc-400">{deleteTarget.employee_code || fallback}</div>
            </div>

            <div className="mt-4 rounded-2xl border border-rose-400/20 bg-rose-500/10 p-4 text-sm font-semibold text-rose-100">
              {tr("dialogs.cannotBeUndone")}
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                disabled={Boolean(deletingEmployeeId)}
                className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-bold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                onClick={handleDeleteEmployee}
                disabled={Boolean(deletingEmployeeId)}
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-rose-400/30 bg-rose-600 px-4 py-3 text-sm font-black text-white transition hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {deletingEmployeeId ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                {tr("actions.deleteEmployee")}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {attendanceResetTarget ? (
        <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/75 px-3 py-4 backdrop-blur-sm sm:items-center sm:px-4 sm:py-6">
          <section className="w-full max-w-md rounded-[28px] border border-amber-400/20 bg-zinc-950 p-5 shadow-2xl shadow-black/40">
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-amber-400/30 bg-amber-500/10 text-amber-200">
                <RotateCcw className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <div className={isArabic ? "text-[11px] font-bold text-amber-200" : "text-[11px] uppercase tracking-[0.2em] text-amber-200"}>{tr("dialogs.resetTodayAttendanceTitle")}</div>
                <h3 className="m1-section-title mt-1 text-white">{tr("dialogs.resetTodayAttendanceTitle")}</h3>
                <p className="mt-2 text-sm leading-6 text-zinc-300">
                  {tr("dialogs.resetTodayAttendanceBody")}
                </p>
              </div>
            </div>

            <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
              <div className="text-sm font-bold text-white">{attendanceResetTarget.full_name || tr("fields.employee")}</div>
              <div className="mt-1 text-xs font-semibold text-zinc-400">{attendanceResetTarget.employee_code || fallback}</div>
            </div>

            <label className="mt-4 flex items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-sm font-semibold text-zinc-200">
              <input
                type="checkbox"
                checked={attendanceResetOptions.clearDeviceLocks}
                onChange={(event) => setAttendanceResetOptions((prev) => ({ ...prev, clearDeviceLocks: event.target.checked }))}
                className="mt-1 h-4 w-4"
              />
              <span>
                {tr("dialogs.clearDeviceLocks")}
                <span className="mt-1 block text-xs font-medium text-zinc-500">{tr("dialogs.clearDeviceLocksHelp")}</span>
              </span>
            </label>

            <div className="mt-4 rounded-2xl border border-amber-400/20 bg-amber-500/10 p-4 text-sm font-semibold text-amber-100">
              {tr("dialogs.historyUnaffected")}
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setAttendanceResetTarget(null)}
                disabled={Boolean(resettingAttendanceId)}
                className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-bold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                onClick={handleConfirmTodayAttendanceReset}
                disabled={Boolean(resettingAttendanceId)}
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-amber-400/30 bg-amber-500 px-4 py-3 text-sm font-black text-black transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {resettingAttendanceId ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                {tr("actions.resetTodayAttendance")}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {deviceBindingResetTarget ? (
        <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/75 px-3 py-4 backdrop-blur-sm sm:items-center sm:px-4 sm:py-6">
          <section className="w-full max-w-md rounded-[28px] border border-rose-400/20 bg-zinc-950 p-5 shadow-2xl shadow-black/40">
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-rose-400/30 bg-rose-500/10 text-rose-200">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <div className={isArabic ? "text-[11px] font-bold text-rose-300" : "text-[11px] uppercase tracking-[0.2em] text-rose-300"}>{tr("dialogs.deviceLocks")}</div>
                <h3 className="m1-section-title mt-1 text-white">{deviceBindingResetTarget.title}</h3>
                <p className="mt-2 text-sm leading-6 text-zinc-300">{deviceBindingResetTarget.body}</p>
              </div>
            </div>

            <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
              <div className="text-sm font-bold text-white">{deviceBindingResetTarget.detailLabel}</div>
              <div className="mt-1 text-xs font-semibold text-zinc-400">{deviceBindingResetTarget.detailValue}</div>
            </div>

            <div className="mt-4 rounded-2xl border border-rose-400/20 bg-rose-500/10 p-4 text-sm font-semibold text-rose-100">
              {tr("dialogs.deviceLocksWarning")}
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setDeviceBindingResetTarget(null)}
                disabled={resettingDeviceBindings}
                className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-bold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                onClick={handleConfirmDeviceBindingReset}
                disabled={resettingDeviceBindings}
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-rose-400/30 bg-rose-600 px-4 py-3 text-sm font-black text-white transition hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {resettingDeviceBindings ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                {tr("actions.resetDeviceLocks")}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function StatusPill({ tone = "zinc", label }) {
  const tones = {
    emerald: "border-emerald-500/20 bg-emerald-500/10 text-emerald-200",
    amber: "border-amber-500/20 bg-amber-500/10 text-amber-100",
    blue: "border-primary/20 bg-primary/10 text-primary",
    rose: "border-rose-500/20 bg-rose-500/10 text-rose-100",
    zinc: "border-white/10 bg-white/5 text-white",
  };

  return <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${tones[tone] || tones.zinc}`}>{label}</span>;
}

function InputField({ label, value, onChange, type = "text", helper }) {
  return (
    <label className="block">
      <div className="text-[10px] font-bold text-zinc-500">{label}</div>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-2 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none placeholder:text-zinc-500"
      />
      {helper ? <div className="mt-1 text-xs text-zinc-500">{helper}</div> : null}
    </label>
  );
}

function SelectField({ label, value, onChange, options = [], disabled = false }) {
  return (
    <label className="block">
      <div className="text-[10px] font-bold text-zinc-500">{label}</div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="mt-2 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none disabled:cursor-not-allowed disabled:opacity-60"
      >
        {options.map((option) => (
          <option key={String(option.id)} value={option.id} disabled={Boolean(option.disabled)}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function MiniStat({ label, value, tone = "zinc", isRtl = false }) {
  const tones = {
    emerald: "border-emerald-500/20 bg-emerald-500/10 text-emerald-100",
    amber: "border-amber-500/20 bg-amber-500/10 text-amber-100",
    blue: "border-primary/20 bg-primary/10 text-primary",
    rose: "border-rose-500/20 bg-rose-500/10 text-rose-100",
    zinc: "border-white/10 bg-white/5 text-white",
  };

  return (
    <div className={`rounded-2xl border px-3 py-3 ${tones[tone] || tones.zinc}`}>
      <div className={isRtl ? "text-[10px] font-bold leading-5 text-zinc-500" : "text-[10px] uppercase tracking-[0.16em] text-zinc-500"}>{label}</div>
      <div className="mt-1 text-sm font-semibold text-white">{value}</div>
    </div>
  );
}

export default AttendanceWorkspace;
