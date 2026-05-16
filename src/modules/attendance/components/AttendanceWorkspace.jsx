import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, CheckCircle2, Clock3, Download, Edit3, Filter, Loader2, Plus, RefreshCw, ScanBarcode, ShieldCheck, UserCheck, Warehouse } from "lucide-react";
import toast from "react-hot-toast";

import { getCurrentUser, hasAnyPermission, hasPermission } from "../../../shared/auth/authStorage";
import AttendanceMetricCard from "./AttendanceMetricCard";
import {
  checkInEmployee,
  checkOutEmployee,
  createAttendanceEmployee,
  createAttendanceEmployeeShift,
  getBranches,
  getAttendanceEmployeeShifts,
  getAttendanceEmployees,
  getAttendanceKioskSnapshot,
  getBranchAttendanceReport,
  getDailyAttendanceReport,
  getEmployeeAttendanceReport,
  updateAttendanceEmployee,
  updateAttendanceShift,
} from "../attendanceApi";

const todayValue = () => new Date().toISOString().slice(0, 10);
const rangeStartValue = () => {
  const d = new Date();
  d.setDate(d.getDate() - 6);
  return d.toISOString().slice(0, 10);
};
const safeArray = (value) => (Array.isArray(value) ? value : Array.isArray(value?.data) ? value.data : []);
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

function AttendanceWorkspace({ defaultTab = "dashboard" }) {
  const currentUserRef = useRef(getCurrentUser());
  const [selectedTab, setSelectedTab] = useState(defaultTab);
  const [employees, setEmployees] = useState([]);
  const [branches, setBranches] = useState([]);
  const [employeeShifts, setEmployeeShifts] = useState([]);
  const [dailyReport, setDailyReport] = useState({ summary: {}, logs: [] });
  const [employeeReport, setEmployeeReport] = useState({ summary: {}, logs: [], employee: null });
  const [branchReport, setBranchReport] = useState({ summary: {}, branches: [] });
  const [kioskSnapshot, setKioskSnapshot] = useState(null);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [employeeForm, setEmployeeForm] = useState({
    id: "",
    branch_id: "",
    branch_name: "",
    employee_code: "",
    full_name: "",
    phone: "",
    email: "",
    national_id: "",
    role: "",
    salary: "",
    hire_date: todayValue(),
    status: "active",
  });
  const [shiftForm, setShiftForm] = useState({
    id: "",
    shift_name: "",
    start_time: "09:00",
    end_time: "17:00",
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
  const activeBranches = branches.filter((branch) => isBranchActive(branch.is_active));
  console.log("[employees] dropdown render branches", activeBranches);

  const branchSelectOptions = branchesLoading
    ? [{ id: "", label: "Loading branches..." }]
    : !activeBranches.length
      ? [{ id: "", label: "No branches found. Create a branch first." }]
      : [
          { id: "", label: "Select branch" },
          ...activeBranches.map((branch) => {
            const { id: branchId, name: branchName, code: branchCode } = normalizeBranch(branch);
            return {
              id: branchId,
              label: branchCode ? `${branchName} (${branchCode})` : branchName,
            };
          }),
        ];

  const selectedEmployee = useMemo(
    () => employees.find((item) => String(item.id) === String(selectedEmployeeId)) || null,
    [employees, selectedEmployeeId]
  );

  const isEditable = hasAnyPermission(["attendance.edit", "attendance.update"]);
  const canCreateAttendance = hasPermission("attendance.create");

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
      setBranchesLoading(false);
      setDailyReport(nextDailyReport);
      if (dailyResult.status === "rejected") {
        const message = dailyResult.reason?.message || "Failed to fetch daily attendance report";
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
                branch_id: selectedMatch.branch_id || "",
                branch_name: selectedMatch.branch_name || "",
              }
        );
      }
    } catch (err) {
      console.log(err);
      setError(err?.message || "Failed to load attendance data");
      toast.error(err?.message || "Failed to load attendance data");
      setBranchesLoading(false);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filters.branchId, filters.date]);

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
      toast.error("Employee name is required");
      return;
    }

    try {
      setSaving(true);
      const payload = {
        ...employeeForm,
        salary: Number(employeeForm.salary || 0),
      };

      const response = employeeForm.id
        ? await updateAttendanceEmployee(employeeForm.id, payload)
        : await createAttendanceEmployee(payload);

      const row = response?.data || response?.employee || response;
      setEmployees((prev) => {
        const next = prev.filter((item) => String(item.id) !== String(row.id));
        return [row, ...next];
      });
      setEmployeeForm((prev) => ({
        ...prev,
        id: "",
        branch_name: "",
        employee_code: "",
        full_name: "",
        phone: "",
        email: "",
        national_id: "",
        role: "",
        salary: "",
      }));
      toast.success(employeeForm.id ? "Employee updated" : "Employee created");
      await loadBaseData({ silent: true });
    } catch (err) {
      console.log(err);
      toast.error(err?.message || "Failed to save employee");
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
      phone: employee.phone || "",
      email: employee.email || "",
      national_id: employee.national_id || "",
      role: employee.role || "",
      salary: employee.salary || "",
      hire_date: employee.hire_date || todayValue(),
      status: employee.status || "active",
    });
    setSelectedEmployeeId(String(employee.id));
    setSelectedTab("employees");
  };

  const handleSaveShift = async () => {
    if (!selectedEmployeeId) {
      toast.error("Select an employee first");
      return;
    }
    if (!shiftForm.shift_name.trim()) {
      toast.error("Shift name is required");
      return;
    }

    try {
      setSaving(true);
      const payload = {
        shift_name: shiftForm.shift_name,
        start_time: shiftForm.start_time,
        end_time: shiftForm.end_time,
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
        allowed_late_minutes: 15,
        overtime_after_minutes: 0,
        working_days: "Sun,Mon,Tue,Wed,Thu",
      });
      toast.success("Shift saved");
      await loadEmployeeRelatedData(selectedEmployeeId);
    } catch (err) {
      console.log(err);
      toast.error(err?.message || "Failed to save shift");
    } finally {
      setSaving(false);
    }
  };

  const handleOpenShift = async () => {
    if (!selectedEmployeeId) {
      toast.error("Select an employee first");
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
      toast.success("Shift opened");
      await loadEmployeeRelatedData(selectedEmployeeId);
      await loadBaseData({ silent: true });
    } catch (err) {
      console.log(err);
      toast.error(err?.message || "Failed to open shift");
    } finally {
      setSaving(false);
    }
  };

  const handleCloseShift = async () => {
    if (!selectedEmployeeId) {
      toast.error("Select an employee first");
      return;
    }
    try {
      setSaving(true);
      await checkOutEmployee({
        employee_id: selectedEmployeeId,
        attendance_log_id: kioskSnapshot?.today_attendance?.id || selectedEmployee?.today_attendance?.id || null,
        notes: "Closed from POS / Attendance kiosk",
      });
      toast.success("Shift closed");
      await loadEmployeeRelatedData(selectedEmployeeId);
      await loadBaseData({ silent: true });
    } catch (err) {
      console.log(err);
      toast.error(err?.message || "Failed to close shift");
    } finally {
      setSaving(false);
    }
  };

  const tabs = [
    { key: "dashboard", label: "Dashboard" },
    { key: "employees", label: "Employees" },
    { key: "reports", label: "Reports" },
    { key: "kiosk", label: "Kiosk" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 rounded-[34px] border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">HR / Attendance</div>
          <h1 className="mt-2 text-3xl font-black text-white">Attendance & Shift Management</h1>
          <p className="mt-2 max-w-3xl text-sm text-zinc-400">
            Production attendance, shifts, POS-linked check-in/out, branch analytics, and employee time tracking.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => loadBaseData()}
            className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
          >
            {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Refresh
          </button>
          {hasPermission("attendance.export") ? (
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-2 rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-black text-black transition hover:bg-emerald-400"
            >
              <Download className="h-4 w-4" />
              Print / Export
            </button>
          ) : null}
        </div>
      </div>

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

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <AttendanceMetricCard label="Present today" value={dashboardSummary.present} tone="emerald" />
        <AttendanceMetricCard label="Absent today" value={dashboardSummary.absent} tone="rose" />
        <AttendanceMetricCard label="Late employees" value={dashboardSummary.late} tone="amber" />
        <AttendanceMetricCard label="Overtime employees" value={dashboardSummary.overtime} tone="blue" />
        <AttendanceMetricCard label="Total worked hours" value={dashboardSummary.workedHours} tone="zinc" />
      </div>

      {error ? (
        <div className="rounded-3xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-100">
          <AlertTriangle className="mr-2 inline h-4 w-4" />
          {error}
        </div>
      ) : null}

      {reportError && (selectedTab === "dashboard" || selectedTab === "reports") ? (
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
                <div className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">Today's chart</div>
                <h2 className="text-2xl font-black text-white">Branch attendance mix</h2>
              </div>
              <div className="text-xs text-zinc-500">Present / Late / Overtime</div>
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
                <div className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">Status</div>
                <h2 className="text-2xl font-black text-white">Daily summary</h2>
              </div>
              <ShieldCheck className="h-5 w-5 text-emerald-400" />
            </div>

            <div className="mt-4 grid gap-3">
              <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
                <div className="flex items-center justify-between text-sm text-zinc-300">
                  <span>Total employees</span>
                  <span className="font-semibold text-white">{dashboardSummary.present + dashboardSummary.absent}</span>
                </div>
                <div className="mt-2 flex items-center justify-between text-sm text-zinc-300">
                  <span>Worked hours</span>
                  <span className="font-semibold text-white">{dashboardSummary.workedHours}</span>
                </div>
              </div>
              <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
                <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">Today</div>
                <div className="mt-2 text-lg font-black text-white">{filters.date}</div>
                <div className="mt-2 text-sm text-zinc-400">Attendance logs automatically link to POS when shifts are opened from the kiosk.</div>
              </div>
            </div>
          </section>

          <section className="rounded-[34px] border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10 xl:col-span-12">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">Recent logs</div>
                <h2 className="text-2xl font-black text-white">Attendance list</h2>
              </div>
              <div className="flex items-center gap-2 text-sm text-zinc-400">
                <Filter className="h-4 w-4" />
                Branch/date filters apply automatically
              </div>
            </div>
            <div className="mt-4 overflow-hidden rounded-[28px] border border-white/10">
              <div className="grid grid-cols-8 bg-white/5 px-4 py-3 text-[11px] uppercase tracking-[0.2em] text-zinc-500">
                <span className="col-span-2">Employee</span>
                <span>Branch</span>
                <span>Shift</span>
                <span>Check-in</span>
                <span>Check-out</span>
                <span>Status</span>
                <span>Worked</span>
              </div>
              <div className="divide-y divide-white/5">
                {recentLogs.length === 0 ? (
                  <div className="p-8 text-center text-zinc-400">No attendance logs for the selected day.</div>
                ) : (
                  recentLogs.map((row) => {
                    const status = row.check_out ? (Number(row.late_minutes || 0) > 0 ? "Late" : Number(row.overtime_minutes || 0) > 0 ? "Overtime" : "Present") : "Checked in";
                    return (
                      <div key={row.id} className="grid grid-cols-8 items-center px-4 py-4 text-sm">
                        <div className="col-span-2">
                          <div className="font-semibold text-white">{row.full_name || row.employee_name}</div>
                          <div className="text-xs text-zinc-500">{row.employee_code || "n/a"} • {row.role || "Employee"}</div>
                        </div>
                        <div className="text-zinc-300">{row.branch_name || "n/a"}</div>
                        <div className="text-zinc-300">{row.shift_name || "n/a"}</div>
                        <div className="text-zinc-300">{row.check_in ? new Date(row.check_in).toLocaleTimeString() : "n/a"}</div>
                        <div className="text-zinc-300">{row.check_out ? new Date(row.check_out).toLocaleTimeString() : "Open"}</div>
                        <div>
                          <StatusPill tone={statusTone(status)} label={status} />
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
                <div className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">Employee list</div>
                <h2 className="text-2xl font-black text-white">Employees & shifts</h2>
              </div>
              <button
                type="button"
                onClick={() => {
                  setEmployeeForm({
                    id: "",
                    branch_id: "",
                    branch_name: "",
                    employee_code: "",
                    full_name: "",
                    phone: "",
                    email: "",
                    national_id: "",
                    role: "",
                    salary: "",
                    hire_date: todayValue(),
                    status: "active",
                  });
                  setShiftForm({
                    id: "",
                    shift_name: "",
                    start_time: "09:00",
                    end_time: "17:00",
                    allowed_late_minutes: 15,
                    overtime_after_minutes: 0,
                    working_days: "Sun,Mon,Tue,Wed,Thu",
                  });
                }}
                className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
              >
                <Plus className="h-4 w-4" />
                New employee
              </button>
            </div>

            <div className="mt-4 overflow-hidden rounded-[28px] border border-white/10">
              <div className="grid grid-cols-10 bg-white/5 px-4 py-3 text-[11px] uppercase tracking-[0.2em] text-zinc-500">
                <span className="col-span-2">Name</span>
                <span>Code</span>
                <span>Branch</span>
                <span>Role</span>
                <span>Status</span>
                <span>Shift</span>
                <span>Check-in</span>
                <span>Actions</span>
              </div>
              <div className="divide-y divide-white/5">
                {employees.length === 0 ? (
                  <div className="p-8 text-center text-zinc-400">No employees found.</div>
                ) : (
                  employees.map((employee) => (
                    <div key={employee.id} className="grid grid-cols-10 items-center px-4 py-4 text-sm">
                      <div className="col-span-2">
                        <div className="font-semibold text-white">{employee.full_name}</div>
                        <div className="text-xs text-zinc-500">{employee.email || "n/a"}</div>
                      </div>
                      <div className="text-zinc-300">{employee.employee_code}</div>
                      <div className="text-zinc-300">{employee.branch_name || "n/a"}</div>
                      <div className="text-zinc-300">{employee.role || "n/a"}</div>
                      <div><StatusPill tone={employee.status === "active" ? "emerald" : "rose"} label={employee.status || "active"} /></div>
                      <div className="text-zinc-300">{employee.current_shift?.shift_name || "n/a"}</div>
                      <div className="text-zinc-300">{employee.today_attendance?.check_in ? new Date(employee.today_attendance.check_in).toLocaleTimeString() : "n/a"}</div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => handleEditEmployee(employee)}
                          className="inline-flex items-center gap-1 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white"
                        >
                          <Edit3 className="h-3.5 w-3.5" />
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedEmployeeId(String(employee.id));
                            setSelectedTab("kiosk");
                          }}
                          className="inline-flex items-center gap-1 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white"
                        >
                          <ScanBarcode className="h-3.5 w-3.5" />
                          Kiosk
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </section>

          <section className="space-y-5 xl:col-span-5">
            {isEditable ? (
              <div className="rounded-[34px] border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10">
                <div className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">
                  {employeeForm.id ? "Edit employee" : "Create employee"}
                </div>
                <h3 className="mt-2 text-2xl font-black text-white">Employee profile</h3>

                <div className="mt-4 grid gap-3">
                  <SelectField
                    label="Branch"
                    value={employeeForm.branch_id}
                    onChange={(value) => setEmployeeForm((prev) => ({ ...prev, branch_id: value }))}
                    options={branchSelectOptions}
                    disabled={branchesLoading}
                  />
                  {!branchesLoading && !activeBranches.length ? (
                    <div className="rounded-2xl border border-dashed border-white/10 bg-white/5 p-4 text-sm font-semibold text-zinc-400">
                      No branches found. Create a branch first.
                    </div>
                  ) : null}
                  <InputField label="Employee code" value={employeeForm.employee_code} onChange={(value) => setEmployeeForm((prev) => ({ ...prev, employee_code: value }))} />
                  <InputField label="Full name" value={employeeForm.full_name} onChange={(value) => setEmployeeForm((prev) => ({ ...prev, full_name: value }))} />
                  <div className="grid grid-cols-2 gap-3">
                    <InputField label="Phone" value={employeeForm.phone} onChange={(value) => setEmployeeForm((prev) => ({ ...prev, phone: value }))} />
                    <InputField label="Email" value={employeeForm.email} onChange={(value) => setEmployeeForm((prev) => ({ ...prev, email: value }))} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <InputField label="National ID" value={employeeForm.national_id} onChange={(value) => setEmployeeForm((prev) => ({ ...prev, national_id: value }))} />
                    <InputField label="Role" value={employeeForm.role} onChange={(value) => setEmployeeForm((prev) => ({ ...prev, role: value }))} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <InputField label="Salary" type="number" value={employeeForm.salary} onChange={(value) => setEmployeeForm((prev) => ({ ...prev, salary: value }))} />
                    <InputField label="Hire date" type="date" value={employeeForm.hire_date} onChange={(value) => setEmployeeForm((prev) => ({ ...prev, hire_date: value }))} />
                  </div>
                  <SelectField
                    label="Status"
                    value={employeeForm.status}
                    onChange={(value) => setEmployeeForm((prev) => ({ ...prev, status: value }))}
                    options={[
                      { id: "active", label: "Active" },
                      { id: "inactive", label: "Inactive" },
                    ]}
                  />
                  <button
                    type="button"
                    onClick={handleSaveEmployee}
                    disabled={saving}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-black text-black transition hover:bg-emerald-400 disabled:opacity-50"
                  >
                    {saving ? "Saving..." : employeeForm.id ? "Update employee" : "Create employee"}
                  </button>
                </div>
              </div>
            ) : null}

            {isEditable ? (
              <div className="rounded-[34px] border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10">
                <div className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">Shift assignment</div>
                <h3 className="mt-2 text-2xl font-black text-white">{selectedEmployee ? selectedEmployee.full_name : "Select an employee"}</h3>
                <div className="mt-4 grid gap-3">
                  <InputField label="Shift name" value={shiftForm.shift_name} onChange={(value) => setShiftForm((prev) => ({ ...prev, shift_name: value }))} />
                  <div className="grid grid-cols-2 gap-3">
                    <InputField label="Start time" type="time" value={shiftForm.start_time} onChange={(value) => setShiftForm((prev) => ({ ...prev, start_time: value }))} />
                    <InputField label="End time" type="time" value={shiftForm.end_time} onChange={(value) => setShiftForm((prev) => ({ ...prev, end_time: value }))} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <InputField label="Allowed late minutes" type="number" value={shiftForm.allowed_late_minutes} onChange={(value) => setShiftForm((prev) => ({ ...prev, allowed_late_minutes: value }))} />
                    <InputField label="Overtime after minutes" type="number" value={shiftForm.overtime_after_minutes} onChange={(value) => setShiftForm((prev) => ({ ...prev, overtime_after_minutes: value }))} />
                  </div>
                  <InputField
                    label="Working days"
                    value={shiftForm.working_days}
                    onChange={(value) => setShiftForm((prev) => ({ ...prev, working_days: value }))}
                    helper="Comma separated: Sun,Mon,Tue,Wed,Thu"
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
                    {saving ? "Saving..." : shiftForm.id ? "Update shift" : "Assign shift"}
                  </button>
                </div>
              </div>
            ) : null}
          </section>
        </div>
      ) : null}

      {selectedTab === "reports" ? (
        <div className="grid gap-6 xl:grid-cols-12">
          <section className="rounded-[34px] border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10 xl:col-span-12">
            <div className="flex flex-wrap items-end gap-3">
              <InputField label="Daily date" type="date" value={filters.date} onChange={(value) => setFilters((prev) => ({ ...prev, date: value }))} />
              <InputField label="Start date" type="date" value={filters.startDate} onChange={(value) => setFilters((prev) => ({ ...prev, startDate: value }))} />
              <InputField label="End date" type="date" value={filters.endDate} onChange={(value) => setFilters((prev) => ({ ...prev, endDate: value }))} />
              <SelectField
                label="Branch"
                value={filters.branchId}
                onChange={(value) => setFilters((prev) => ({ ...prev, branchId: value }))}
                options={[
                  { id: "", label: "All branches" },
                  ...activeBranches.map((branch) => {
                    const { id: branchId, name: branchName, code: branchCode } = normalizeBranch(branch);
                    return {
                      id: branchId,
                      label: branchCode ? `${branchName} (${branchCode})` : branchName,
                    };
                  }),
                ]}
              />
              <SelectField
                label="Employee"
                value={selectedEmployeeId}
                onChange={setSelectedEmployeeId}
                options={[{ id: "", label: "Select employee" }, ...employees.map((employee) => ({ id: employee.id, label: employee.full_name }))]}
              />
            </div>
          </section>

          <section className="rounded-[34px] border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10 xl:col-span-7">
            <div className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">Employee trend</div>
            <h2 className="text-2xl font-black text-white">Worked minutes by day</h2>
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
            <div className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">Branch totals</div>
            <h2 className="text-2xl font-black text-white">Branch report</h2>
            <div className="mt-4 space-y-3">
              {(branchReport?.branches || []).length === 0 ? (
                <div className="rounded-3xl border border-dashed border-white/10 bg-white/5 p-8 text-center text-zinc-400">
                  No branch attendance data for the selected range.
                </div>
              ) : (
                branchReport.branches.map((row) => (
                  <div key={String(row.branch_id || row.branch_name)} className="rounded-3xl border border-white/10 bg-white/5 p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-semibold text-white">{row.branch_name}</div>
                        <div className="text-xs text-zinc-500">{row.total_work_hours} worked</div>
                      </div>
                      <Warehouse className="h-5 w-5 text-emerald-400" />
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
                      <MiniStat label="Present" value={row.present_count} tone="emerald" />
                      <MiniStat label="Late" value={row.late_count} tone="amber" />
                      <MiniStat label="Overtime" value={row.overtime_count} tone="blue" />
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="rounded-[34px] border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10 xl:col-span-12">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">Employee report</div>
                <h2 className="text-2xl font-black text-white">{employeeReport?.employee?.full_name || "Select an employee"}</h2>
              </div>
              <div className="text-sm text-zinc-400">
                {filters.startDate} to {filters.endDate}
              </div>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-4">
              <AttendanceMetricCard label="Days present" value={employeeReport?.summary?.daysPresent || 0} tone="emerald" />
              <AttendanceMetricCard label="Late days" value={employeeReport?.summary?.lateDays || 0} tone="amber" />
              <AttendanceMetricCard label="Overtime days" value={employeeReport?.summary?.overtimeDays || 0} tone="blue" />
              <AttendanceMetricCard label="Worked hours" value={employeeReport?.summary?.totalWorkedHours || "00:00"} tone="zinc" />
            </div>
            <div className="mt-5 overflow-hidden rounded-[28px] border border-white/10">
              <div className="grid grid-cols-7 bg-white/5 px-4 py-3 text-[11px] uppercase tracking-[0.2em] text-zinc-500">
                <span>Date</span>
                <span>Check-in</span>
                <span>Check-out</span>
                <span>Branch</span>
                <span>Shift</span>
                <span>Status</span>
                <span>Worked</span>
              </div>
              <div className="divide-y divide-white/5">
                {(employeeReport?.logs || []).length === 0 ? (
                  <div className="p-8 text-center text-zinc-400">No employee report data for the selected range.</div>
                ) : (
                  employeeReport.logs.map((row) => (
                    <div key={row.id} className="grid grid-cols-7 items-center px-4 py-4 text-sm">
                      <span className="text-white">{row.attendance_date}</span>
                      <span className="text-zinc-300">{row.check_in ? new Date(row.check_in).toLocaleTimeString() : "n/a"}</span>
                      <span className="text-zinc-300">{row.check_out ? new Date(row.check_out).toLocaleTimeString() : "Open"}</span>
                      <span className="text-zinc-300">{row.branch_name || "n/a"}</span>
                      <span className="text-zinc-300">{row.shift_name || "n/a"}</span>
                      <StatusPill tone={statusTone(Number(row.late_minutes || 0) > 0 ? "late" : Number(row.overtime_minutes || 0) > 0 ? "overtime" : "present")} label={Number(row.late_minutes || 0) > 0 ? "Late" : Number(row.overtime_minutes || 0) > 0 ? "Overtime" : "Present"} />
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
            <div className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">Kiosk mode</div>
            <h2 className="text-2xl font-black text-white">Open and close shift</h2>
            <p className="mt-2 text-sm text-zinc-400">
              POS-ready attendance controls. The open/close actions can be reused by the checkout flow and linked to orders.
            </p>

            <div className="mt-5 grid gap-3">
              <SelectField
                label="Employee"
                value={selectedEmployeeId}
                onChange={setSelectedEmployeeId}
                options={[{ id: "", label: "Select employee" }, ...employees.map((employee) => ({ id: employee.id, label: employee.full_name }))]}
              />
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={handleOpenShift}
                  disabled={!canCreateAttendance || saving}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-black text-black transition hover:bg-emerald-400 disabled:opacity-50"
                >
                  <UserCheck className="h-4 w-4" />
                  Open shift
                </button>
                <button
                  type="button"
                  onClick={handleCloseShift}
                  disabled={!canCreateAttendance || saving}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10 disabled:opacity-50"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  Close shift
                </button>
              </div>
            </div>

            <div className="mt-5 rounded-[28px] border border-white/10 bg-white/5 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs uppercase tracking-[0.18em] text-zinc-500">Current employee</div>
                  <div className="mt-1 text-lg font-black text-white">{selectedEmployee?.full_name || "n/a"}</div>
                </div>
                <Clock3 className="h-5 w-5 text-emerald-400" />
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <MiniStat label="Shift" value={kioskSnapshot?.current_shift?.shift_name || selectedEmployee?.current_shift?.shift_name || "n/a"} tone="emerald" />
                <MiniStat label="Branch" value={kioskSnapshot?.branch_name || selectedEmployee?.branch_name || "n/a"} tone="blue" />
                <MiniStat label="Check-in" value={kioskSnapshot?.today_attendance?.check_in ? new Date(kioskSnapshot.today_attendance.check_in).toLocaleTimeString() : "n/a"} tone="amber" />
                <MiniStat label="Status" value={kioskSnapshot?.today_attendance?.check_out ? "Closed" : kioskSnapshot?.today_attendance?.check_in ? "Open" : "Off"} tone="zinc" />
              </div>
            </div>
          </section>

          <section className="rounded-[34px] border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10 xl:col-span-7">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">Linked to POS</div>
                <h2 className="text-2xl font-black text-white">Shift snapshot</h2>
              </div>
              <ScanBarcode className="h-5 w-5 text-emerald-400" />
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-4">
              <AttendanceMetricCard label="Work minutes" value={kioskSnapshot?.today_attendance?.work_minutes ? minutesLabel(kioskSnapshot.today_attendance.work_minutes) : "00:00"} tone="emerald" />
              <AttendanceMetricCard label="Late minutes" value={kioskSnapshot?.today_attendance?.late_minutes || 0} tone="amber" />
              <AttendanceMetricCard label="Early leave" value={kioskSnapshot?.today_attendance?.early_leave_minutes || 0} tone="rose" />
              <AttendanceMetricCard label="Overtime" value={kioskSnapshot?.today_attendance?.overtime_minutes || 0} tone="blue" />
            </div>
            <div className="mt-5 overflow-hidden rounded-[28px] border border-white/10">
              <div className="grid grid-cols-5 bg-white/5 px-4 py-3 text-[11px] uppercase tracking-[0.2em] text-zinc-500">
                <span>Employee</span>
                <span>Branch</span>
                <span>Shift</span>
                <span>Check-in</span>
                <span>Status</span>
              </div>
              <div className="divide-y divide-white/5">
                {selectedEmployee ? (
                  <div className="grid grid-cols-5 items-center px-4 py-4 text-sm">
                    <span className="font-semibold text-white">{selectedEmployee.full_name}</span>
                    <span className="text-zinc-300">{selectedEmployee.branch_name || "n/a"}</span>
                    <span className="text-zinc-300">{kioskSnapshot?.current_shift?.shift_name || selectedEmployee?.current_shift?.shift_name || "n/a"}</span>
                    <span className="text-zinc-300">{kioskSnapshot?.today_attendance?.check_in ? new Date(kioskSnapshot.today_attendance.check_in).toLocaleTimeString() : "n/a"}</span>
                    <StatusPill tone={kioskSnapshot?.today_attendance?.check_out ? "zinc" : kioskSnapshot?.today_attendance?.check_in ? "emerald" : "rose"} label={kioskSnapshot?.today_attendance?.check_out ? "Closed" : kioskSnapshot?.today_attendance?.check_in ? "Open" : "Off"} />
                  </div>
                ) : (
                  <div className="p-8 text-center text-zinc-400">Select an employee to manage kiosk attendance.</div>
                )}
              </div>
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
      <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">{label}</div>
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
      <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">{label}</div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="mt-2 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none disabled:cursor-not-allowed disabled:opacity-60"
      >
        {options.map((option) => (
          <option key={String(option.id)} value={option.id} disabled={option.id === "" && /loading branches|no branches/i.test(option.label)}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function MiniStat({ label, value, tone = "zinc" }) {
  const tones = {
    emerald: "border-emerald-500/20 bg-emerald-500/10 text-emerald-100",
    amber: "border-amber-500/20 bg-amber-500/10 text-amber-100",
    blue: "border-blue-500/20 bg-blue-500/10 text-blue-100",
    rose: "border-rose-500/20 bg-rose-500/10 text-rose-100",
    zinc: "border-white/10 bg-white/5 text-white",
  };

  return (
    <div className={`rounded-2xl border px-3 py-3 ${tones[tone] || tones.zinc}`}>
      <div className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">{label}</div>
      <div className="mt-1 text-sm font-semibold text-white">{value}</div>
    </div>
  );
}

export default AttendanceWorkspace;
