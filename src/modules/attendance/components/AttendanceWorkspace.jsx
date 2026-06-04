import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, CheckCircle2, Clock3, Download, Edit3, Filter, ImagePlus, Loader2, Plus, RefreshCw, RotateCcw, ScanBarcode, ShieldCheck, Smartphone, Trash2, UserCheck, Warehouse, XCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";

import { getCurrentUser, hasAnyPermission, hasPermission, isAdminUser } from "../../../shared/auth/authStorage";
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

function AttendanceWorkspace({ defaultTab = "dashboard", visibleTabs = null, embedded = false, hideMetrics = false }) {
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
  const [employeeForm, setEmployeeForm] = useState({
    id: "",
    branch_id: "",
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
    hire_date: todayValue(),
    status: "active",
  });
  const [shiftForm, setShiftForm] = useState({
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
    () => employees.find((item) => String(item.id) === String(selectedEmployeeId)) || null,
    [employees, selectedEmployeeId]
  );
  const fallback = tr("fields.notAvailable");
  const employeeSelectOptions = useMemo(
    () => [{ id: "", label: tr("options.selectEmployee") }, ...employees.map((employee) => ({ id: employee.id, label: employee.full_name || tr("fields.employee") }))],
    [employees, tr]
  );
  const editingEmployee = useMemo(
    () => employees.find((item) => String(item.id) === String(employeeForm.id)) || null,
    [employeeForm.id, employees]
  );
  const employeePhotoPreviewUrl = useMemo(
    () => resolveEmployeeProfileImageUrl(cleanPhotoUrl(employeeForm.photo_url) || cleanPhotoUrl(editingEmployee?.photo_url)),
    [editingEmployee?.photo_url, employeeForm.photo_url]
  );
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

      setEmployees(nextEmployees);
      setBranches(nextBranches);
      getAttendanceDevices().then((rows) => setAttendanceDevices(safeArray(rows))).catch(() => setAttendanceDevices([]));
      getAttendanceDeviceSettings().then((settings) => setDeviceSettings(settings?.data || settings || { new_device_policy: "pending" })).catch(() => {});
      if (defaultBranchId) {
        setFilters((prev) => (prev.branchId ? prev : { ...prev, branchId: defaultBranchId }));
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
        setSelectedEmployeeId((prev) => prev || String(selectedMatch.id));
        setEmployeeForm((prev) =>
          prev.id
            ? prev
            : {
                ...prev,
                branch_id: selectedMatch.branch_id || defaultBranchId || "",
                branch_name: selectedMatch.branch_name || "",
              }
        );
      } else if (defaultBranchId) {
        setEmployeeForm((prev) => (prev.branch_id ? prev : { ...prev, branch_id: defaultBranchId }));
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
    if (selectedEmployeeId) {
      queueMicrotask(() => {
        void loadEmployeeRelatedData(selectedEmployeeId);
      });
    }
  }, [loadEmployeeRelatedData, selectedEmployeeId]);

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

    try {
      setSaving(true);
      const payload = {
        ...employeeForm,
        photo_url: cleanPhotoUrl(employeeForm.photo_url),
        salary: Number(employeeForm.salary || 0),
      };

      const response = employeeForm.id
        ? await updateAttendanceEmployee(employeeForm.id, payload)
        : await createAttendanceEmployee(payload);

      const row = {
        ...(response?.data || response?.employee || response || {}),
        photo_url: cleanPhotoUrl(response?.data?.photo_url || response?.employee?.photo_url || response?.photo_url || payload.photo_url),
      };
      setEmployees((prev) => {
        const next = prev.filter((item) => String(item.id) !== String(row.id));
        return [row, ...next];
      });
      if (employeeForm.id) {
        setEmployeeForm((prev) => ({
          ...prev,
          ...row,
          id: row.id,
          branch_id: row.branch_id || "",
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
          hire_date: row.hire_date || todayValue(),
          status: row.status || "active",
        }));
      } else {
        setEmployeeForm((prev) => ({
          ...prev,
          id: "",
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
        }));
      }
      setSelectedEmployeeId((current) => String(row.id || current || ""));
      toast.success(employeeForm.id ? tr("toasts.employeeUpdated") : tr("toasts.employeeCreated"));
      await loadBaseData({ silent: true });
      if (row.id) {
        await loadEmployeeRelatedData(String(row.id));
      }
    } catch (err) {
      console.log(err);
      toast.error(err?.message || tr("errors.saveEmployee"));
    } finally {
      setSaving(false);
    }
  };

  const handleEditEmployee = (employee) => {
    setEmployeeForm({
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
      hire_date: employee.hire_date || todayValue(),
      status: employee.status || "active",
    });
    setSelectedEmployeeId(String(employee.id));
    setSelectedTab("employees");
  };

  const handleEmployeePhotoUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      setUploadingEmployeePhoto(true);
      const response = await uploadProductImage(file);
      const nextUrl = String(resolveUploadedImageUrl(response) || "").trim();
      if (!nextUrl) throw new Error(isArabic ? "فشل رفع صورة الموظف." : "Employee photo upload failed.");
      setEmployeeForm((prev) => ({ ...prev, photo_url: cleanPhotoUrl(nextUrl) }));
      toast.success(isArabic ? "تم رفع صورة الموظف." : "Employee photo uploaded.");
    } catch (err) {
      console.log(err);
      toast.error(err?.message || (isArabic ? "فشل رفع صورة الموظف." : "Employee photo upload failed."));
    } finally {
      setUploadingEmployeePhoto(false);
      if (event.target) {
        event.target.value = "";
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
        setEmployeeForm({
          id: "",
          branch_id: "",
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
          hire_date: todayValue(),
          status: "active",
        });
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

  const allTabs = [
    { key: "dashboard", label: tr("tabs.dashboard") },
    { key: "employees", label: tr("tabs.employees") },
    { key: "devices", label: tr("tabs.devices") },
    { key: "reports", label: tr("tabs.reports") },
    { key: "kiosk", label: tr("tabs.kiosk") },
  ];
  const tabs = Array.isArray(visibleTabs) && visibleTabs.length
    ? allTabs.filter((tab) => visibleTabs.includes(tab.key))
    : allTabs;

  useEffect(() => {
    const fallbackTab = tabs.some((tab) => tab.key === defaultTab) ? defaultTab : tabs[0]?.key || "dashboard";
    if (!tabs.some((tab) => tab.key === selectedTab)) setSelectedTab(fallbackTab);
  }, [defaultTab, selectedTab, tabs]);

  return (
    <div className="space-y-6" dir={direction}>
      {!embedded ? (
      <div className="flex flex-col gap-4 rounded-[34px] border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <div className={isArabic ? "text-[11px] font-bold text-zinc-500" : "text-[11px] uppercase tracking-[0.24em] text-zinc-500"}>{tr("eyebrow")}</div>
          <h1 className="mt-2 text-3xl font-black text-white">{tr("title")}</h1>
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
            className={`rounded-2xl px-4 py-3 text-sm font-semibold transition ${
              selectedTab === tab.key
                ? "bg-emerald-500 text-black"
                : "border border-white/10 bg-white/5 text-white hover:bg-white/10"
            }`}
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
              <h2 className="mt-1 text-2xl font-black text-white">{tr("admin.title")}</h2>
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
                <h2 className="text-2xl font-black text-white">{tr("dashboard.branchAttendanceMix")}</h2>
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
                <h2 className="text-2xl font-black text-white">{tr("dashboard.dailySummary")}</h2>
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
                <h2 className="text-2xl font-black text-white">{tr("dashboard.attendanceList")}</h2>
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
          <section className="rounded-[34px] border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10 xl:col-span-7">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className={isArabic ? "text-[11px] font-bold text-zinc-500" : "text-[11px] uppercase tracking-[0.2em] text-zinc-500"}>{tr("employees.employeeList")}</div>
                <h2 className="text-2xl font-black text-white">{tr("employees.employeesAndShifts")}</h2>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedEmployeeId("");
                  setEmployeeForm({
                    id: "",
                    branch_id: "",
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
                    hire_date: todayValue(),
                    status: "active",
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
                }}
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
                            className="inline-flex h-9 w-9 items-center justify-center rounded-2xl border border-rose-400/30 bg-rose-500/10 text-rose-200 transition hover:border-rose-300/60 hover:bg-rose-500/20 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
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

          <section className="space-y-5 xl:col-span-5">
            {isEditable ? (
              <div className="rounded-[34px] border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10">
                <div className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">
                  {employeeForm.id ? tr("employees.editEmployee") : tr("employees.createEmployee")}
                </div>
                <h3 className="mt-2 text-2xl font-black text-white">{tr("employees.employeeProfile")}</h3>

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
                        onClick={() => employeePhotoInputRef.current?.click()}
                        disabled={uploadingEmployeePhoto}
                        className="inline-flex min-h-10 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {uploadingEmployeePhoto ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
                        {uploadingEmployeePhoto ? (isArabic ? "جارٍ الرفع..." : "Uploading...") : (isArabic ? "رفع صورة" : "Upload photo")}
                      </button>
                      {employeeForm.photo_url ? (
                        <button
                          type="button"
                          onClick={() => setEmployeeForm((prev) => ({ ...prev, photo_url: "" }))}
                          className="inline-flex min-h-10 items-center justify-center rounded-2xl border border-white/10 bg-transparent px-4 py-2 text-sm font-semibold text-zinc-300 transition hover:bg-white/5 hover:text-white"
                        >
                          {isArabic ? "إزالة الصورة" : "Remove photo"}
                        </button>
                      ) : null}
                    </div>
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
                    <InputField label={tr("fields.jobTitle")} value={employeeForm.job_title} onChange={(value) => setEmployeeForm((prev) => ({ ...prev, job_title: value, position: value }))} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <InputField label={tr("fields.internalRole")} value={employeeForm.role} onChange={(value) => setEmployeeForm((prev) => ({ ...prev, role: value }))} />
                    <InputField label={tr("fields.salary")} type="number" value={employeeForm.salary} onChange={(value) => setEmployeeForm((prev) => ({ ...prev, salary: value }))} />
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

            {isEditable ? (
              <div className="rounded-[34px] border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10">
                <div className={isArabic ? "text-[11px] font-bold text-zinc-500" : "text-[11px] uppercase tracking-[0.2em] text-zinc-500"}>{tr("employees.shiftAssignment")}</div>
                <h3 className="mt-2 text-2xl font-black text-white">{selectedEmployee ? selectedEmployee.full_name : tr("options.selectEmployee")}</h3>
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
                    className="inline-flex items-center justify-center gap-2 rounded-2xl bg-blue-500 px-4 py-3 text-sm font-black text-black transition hover:bg-blue-400 disabled:opacity-50"
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
                <h2 className="text-2xl font-black text-white">{tr("devices.approvals")}</h2>
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
            <h2 className="text-2xl font-black text-white">{tr("reports.workedMinutesByDay")}</h2>
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
            <h2 className="text-2xl font-black text-white">{tr("reports.branchReport")}</h2>
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
                <h2 className="text-2xl font-black text-white">{employeeReport?.employee?.full_name || tr("options.selectEmployee")}</h2>
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
            <h2 className="text-2xl font-black text-white">{tr("kiosk.openCloseShift")}</h2>
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
                <h2 className="text-2xl font-black text-white">{tr("kiosk.shiftSnapshot")}</h2>
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
                <h3 className="mt-1 text-2xl font-black text-white">{tr("dialogs.deleteEmployeeTitle")}</h3>
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
                <h3 className="mt-1 text-2xl font-black text-white">{tr("dialogs.resetTodayAttendanceTitle")}</h3>
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
                <h3 className="mt-1 text-2xl font-black text-white">{deviceBindingResetTarget.title}</h3>
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
    blue: "border-blue-500/20 bg-blue-500/10 text-blue-100",
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
    blue: "border-blue-500/20 bg-blue-500/10 text-blue-100",
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
