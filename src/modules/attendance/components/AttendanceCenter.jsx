import { useCallback, useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  Activity,
  AlertTriangle,
  BadgeDollarSign,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Download,
  FileText,
  Filter,
  Printer,
  QrCode,
  RefreshCw,
  Search,
  TimerOff,
  UserCheck,
  Users,
  XCircle,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatCurrency } from "../../../shared/lib/currency";

import {
  getAttendanceCenterReports,
  getAttendanceDashboard,
  getAttendanceEmployees,
  getAttendanceLeaves,
  getAttendanceList,
  getAttendanceLive,
  getAttendancePayrollImpact,
  getAttendanceQrSessions,
  getBranches,
} from "../attendanceApi";

const todayValue = () => new Date().toISOString().slice(0, 10);
const monthStartValue = () => {
  const date = new Date();
  date.setDate(1);
  return date.toISOString().slice(0, 10);
};
const safeArray = (value) => (Array.isArray(value) ? value : Array.isArray(value?.rows) ? value.rows : Array.isArray(value?.data) ? value.data : []);
const numberValue = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const formatMoney = (value) => formatCurrency(numberValue(value));
const safeDate = (value) => {
  if (!value) return null;
  try {
    const date = value instanceof Date ? value : new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
  } catch {
    return null;
  }
};
const formatTime = (value) => {
  const date = safeDate(value);
  if (!date) return "-";
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(date);
};
const formatDateTime = (value) => {
  const date = safeDate(value);
  if (!date) return "-";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
};
const csvEscape = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;

const labels = {
  en: {
    title: "Attendance Center",
    subtitle: "Live attendance, QR and GPS check-ins, absences, late arrivals, missing hours, and branch monitoring.",
    filters: "Filters",
    search: "Search employee",
    branch: "Branch",
    employee: "Employee",
    startDate: "Start date",
    endDate: "End date",
    status: "Status",
    source: "Source",
    allBranches: "All branches",
    allEmployees: "All employees",
    allStatuses: "All statuses",
    allSources: "All sources",
    lateOnly: "Late only",
    missingOnly: "Missing hours only",
    payrollAffectedOnly: "Payroll affected only",
    refresh: "Refresh",
    excel: "Export Excel",
    pdf: "Export PDF",
    print: "Print",
    dense: "Dense",
    stillWorking: "Still working",
    noRows: "No attendance records found",
    details: "Attendance details",
    close: "Close",
    suspicious: "Suspicious",
    duplicateScan: "Duplicate scan",
    missingCheckout: "Missing checkout",
    presentToday: "Present Today",
    absentToday: "Absent Today",
    lateEmployees: "Late Employees",
    missingHours: "Missing Hours",
    avgWorkHours: "Average Work Hours",
    attendanceRate: "Attendance Rate %",
    qrCheckins: "QR Check-ins Today",
    qrCheckouts: "QR Check-outs Today",
    tabs: ["Overview", "Live Attendance", "Daily Attendance", "Late Arrivals", "Missing Hours", "Absences", "Leaves", "QR Sessions", "Payroll Impact", "Reports"],
    columns: {
      employee: "Employee",
      branch: "Branch",
      date: "Date",
      checkIn: "Check-in",
      checkOut: "Check-out",
      workedHours: "Worked Hours",
      status: "Status",
      lateDuration: "Late Duration",
      missingHours: "Missing Hours",
      overtime: "Overtime",
      source: "Attendance Source",
      payrollImpact: "Payroll Impact",
      notes: "Notes",
      presentDays: "Present Days",
      absenceDays: "Absence Days",
      lateCount: "Late Count",
      deduction: "Attendance Deduction",
      penalties: "Penalties",
      netImpact: "Net Salary Impact",
      leaveType: "Leave type",
      start: "Start date",
      end: "End date",
      approval: "Approval status",
      qrType: "QR type",
      scanTime: "Scan time",
      device: "Device",
      duration: "Session duration",
    },
    statusLabels: {
      present: "Present",
      absent: "Absent",
      late: "Late",
      missing_hours: "Missing Hours",
      early_leave: "Early Leave",
      on_leave: "On Leave",
      holiday: "Holiday",
      weekly_off: "Weekly Off",
      monthly_off: "Monthly Off",
      still_working: "Still working",
    },
  },
  ar: {
    title: "مركز الحضور",
    subtitle: "حضور QR والغياب وساعات النقص وتأثير الرواتب والإجازات وتحليل الفروع.",
    filters: "الفلاتر",
    search: "بحث عن موظف",
    branch: "الفرع",
    employee: "الموظف",
    startDate: "من تاريخ",
    endDate: "إلى تاريخ",
    status: "الحالة",
    source: "المصدر",
    allBranches: "كل الفروع",
    allEmployees: "كل الموظفين",
    allStatuses: "كل الحالات",
    allSources: "كل المصادر",
    lateOnly: "المتأخرون فقط",
    missingOnly: "ساعات النقص فقط",
    payrollAffectedOnly: "المؤثر على الراتب فقط",
    refresh: "تحديث",
    excel: "تصدير Excel",
    pdf: "تصدير PDF",
    print: "طباعة",
    dense: "مضغوط",
    stillWorking: "ما زال يعمل",
    noRows: "لا توجد سجلات حضور",
    details: "تفاصيل الحضور",
    close: "إغلاق",
    suspicious: "نشاط مشبوه",
    duplicateScan: "مسح مكرر",
    missingCheckout: "خروج مفقود",
    presentToday: "الحاضرون اليوم",
    absentToday: "الغائبون اليوم",
    lateEmployees: "المتأخرون",
    missingHours: "ساعات النقص",
    avgWorkHours: "متوسط ساعات العمل",
    attendanceRate: "نسبة الحضور %",
    qrCheckins: "دخول QR اليوم",
    qrCheckouts: "خروج QR اليوم",
    tabs: ["نظرة عامة", "الحضور المباشر", "الحضور اليومي", "التأخير", "ساعات النقص", "الغياب", "الإجازات", "جلسات QR", "تأثير الرواتب", "التقارير"],
    columns: {
      employee: "الموظف",
      branch: "الفرع",
      date: "التاريخ",
      checkIn: "الدخول",
      checkOut: "الخروج",
      workedHours: "ساعات العمل",
      status: "الحالة",
      lateDuration: "مدة التأخير",
      missingHours: "ساعات النقص",
      overtime: "الإضافي",
      source: "مصدر الحضور",
      payrollImpact: "تأثير الراتب",
      notes: "ملاحظات",
      presentDays: "أيام الحضور",
      absenceDays: "أيام الغياب",
      lateCount: "عدد التأخير",
      deduction: "خصم الحضور",
      penalties: "الجزاءات",
      netImpact: "صافي التأثير",
      leaveType: "نوع الإجازة",
      start: "تاريخ البداية",
      end: "تاريخ النهاية",
      approval: "حالة الموافقة",
      qrType: "نوع QR",
      scanTime: "وقت المسح",
      device: "الجهاز",
      duration: "مدة الجلسة",
    },
    statusLabels: {
      present: "حاضر",
      absent: "غائب",
      late: "متأخر",
      missing_hours: "ساعات نقص",
      early_leave: "خروج مبكر",
      on_leave: "إجازة",
      holiday: "عطلة",
      weekly_off: "راحة أسبوعية",
      monthly_off: "راحة شهرية",
      still_working: "ما زال يعمل",
    },
  },
};

const tabKeys = ["overview", "live", "daily", "late", "missing", "absences", "leaves", "qr", "payroll", "reports"];

const statusClass = {
  present: "border-emerald-500/20 bg-emerald-500/10 text-emerald-300",
  absent: "border-rose-500/20 bg-rose-500/10 text-rose-300",
  late: "border-yellow-500/20 bg-yellow-500/10 text-yellow-300",
  missing_hours: "border-orange-500/20 bg-orange-500/10 text-orange-300",
  early_leave: "border-orange-500/20 bg-orange-500/10 text-orange-300",
  on_leave: "border-blue-500/20 bg-blue-500/10 text-blue-300",
  holiday: "border-blue-500/20 bg-blue-500/10 text-blue-300",
  weekly_off: "border-sky-500/20 bg-sky-500/10 text-sky-300",
  monthly_off: "border-sky-500/20 bg-sky-500/10 text-sky-300",
  still_working: "border-cyan-500/20 bg-cyan-500/10 text-cyan-300",
};

function Chip({ children, status }) {
  return (
    <span className={`inline-flex whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-black ${statusClass[status] || "border-[var(--border)] bg-[var(--card)] text-[var(--muted)]"}`}>
      {children}
    </span>
  );
}

function KpiCard({ label, value, icon: Icon, tone = "emerald", hint }) {
  const toneClass = {
    emerald: "bg-emerald-500/10 text-emerald-400",
    rose: "bg-rose-500/10 text-rose-400",
    yellow: "bg-yellow-500/10 text-yellow-400",
    orange: "bg-orange-500/10 text-orange-400",
    cyan: "bg-cyan-500/10 text-cyan-400",
    blue: "bg-blue-500/10 text-blue-400",
  }[tone] || "bg-[var(--surface)] text-[var(--muted)]";
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-black text-[var(--muted)]">{label}</div>
          <div className="mt-2 text-2xl font-black text-[var(--text)]" dir="ltr">{value}</div>
        </div>
        <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${toneClass}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
      {hint ? <div className="mt-2 text-xs text-[var(--muted)]">{hint}</div> : null}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-xs font-black text-[var(--muted)]">
      <span>{label}</span>
      {children}
    </label>
  );
}

function NativeInput(props) {
  return <input {...props} className={`h-10 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-semibold text-[var(--text)] outline-none focus:border-[var(--primary)] ${props.className || ""}`} />;
}

function NativeSelect(props) {
  return <select {...props} className={`h-10 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-semibold text-[var(--text)] outline-none focus:border-[var(--primary)] ${props.className || ""}`} />;
}

export default function AttendanceCenter() {
  const { t, i18n } = useTranslation();
  const isArabic = String(i18n.language || "").toLowerCase().startsWith("ar");
  const text = isArabic ? labels.ar : labels.en;
  const pageEyebrow = t("common.attendanceCenterPage.eyebrow", { defaultValue: isArabic ? "مركز الحضور" : "Attendance Center" });
  const pageTitle = t("common.attendanceCenterPage.title", { defaultValue: text.title });
  const pageSubtitle = t("common.attendanceCenterPage.subtitle", { defaultValue: text.subtitle });
  const [activeTab, setActiveTab] = useState("overview");
  const [dense, setDense] = useState(true);
  const [loading, setLoading] = useState(true);
  const [refreshIndex, setRefreshIndex] = useState(0);
  const [selectedRow, setSelectedRow] = useState(null);
  const [branches, setBranches] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [dashboard, setDashboard] = useState(null);
  const [rows, setRows] = useState([]);
  const [liveRows, setLiveRows] = useState([]);
  const [payrollRows, setPayrollRows] = useState([]);
  const [leaveRows, setLeaveRows] = useState([]);
  const [qrRows, setQrRows] = useState([]);
  const [reportPayload, setReportPayload] = useState(null);
  const [filters, setFilters] = useState({
    search: "",
    branchId: "",
    employeeId: "",
    startDate: monthStartValue(),
    endDate: todayValue(),
    status: "",
    source: "",
    lateOnly: false,
    missingOnly: false,
    payrollAffectedOnly: false,
  });

  const params = useMemo(() => ({
    search: filters.search,
    branchId: filters.branchId,
    employeeId: filters.employeeId,
    startDate: filters.startDate,
    endDate: filters.endDate,
    status: filters.status,
    source: filters.source,
    lateOnly: filters.lateOnly ? "true" : "",
    missingOnly: filters.missingOnly ? "true" : "",
    payrollAffectedOnly: filters.payrollAffectedOnly ? "true" : "",
  }), [filters]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [branchData, employeeData, dashboardData, listData, liveData, payrollData, leavesData, qrData, reportsData] = await Promise.all([
        getBranches({ active: true }),
        getAttendanceEmployees({ active: true, branch_id: filters.branchId }),
        getAttendanceDashboard(params),
        getAttendanceList(params),
        getAttendanceLive(params),
        getAttendancePayrollImpact(params),
        getAttendanceLeaves(params),
        getAttendanceQrSessions(params),
        getAttendanceCenterReports(params),
      ]);
      setBranches(safeArray(branchData));
      setEmployees(safeArray(employeeData));
      setDashboard(dashboardData || null);
      setRows(safeArray(listData?.rows || listData?.attendance || listData));
      setLiveRows(safeArray(liveData?.rows || liveData));
      setPayrollRows(safeArray(payrollData?.rows || payrollData));
      setLeaveRows(safeArray(leavesData?.rows || leavesData));
      setQrRows(safeArray(qrData?.rows || qrData));
      setReportPayload(reportsData || null);
    } finally {
      setLoading(false);
    }
  }, [filters.branchId, params]);

  useEffect(() => {
    load();
  }, [load, refreshIndex]);

  useEffect(() => {
    if (activeTab !== "live") return undefined;
    const timer = window.setInterval(() => setRefreshIndex((value) => value + 1), 8000);
    return () => window.clearInterval(timer);
  }, [activeTab]);

  const filteredRows = useMemo(() => {
    if (activeTab === "late") return rows.filter((row) => row.status === "late" || numberValue(row.late_minutes) > 0);
    if (activeTab === "missing") return rows.filter((row) => numberValue(row.missing_hours) > 0);
    if (activeTab === "absences") return rows.filter((row) => row.status === "absent");
    return rows;
  }, [activeTab, rows]);

  const summary = dashboard?.summary || {};
  const kpis = [
    [text.presentToday, summary.present_today || 0, UserCheck, "emerald"],
    [text.absentToday, summary.absent_today || 0, XCircle, "rose"],
    [text.lateEmployees, summary.late_employees || 0, Clock3, "yellow"],
    [text.missingHours, summary.missing_hours || 0, TimerOff, "orange"],
    [text.avgWorkHours, summary.average_work_hours || 0, Activity, "cyan"],
    [text.attendanceRate, `${summary.attendance_rate || 0}%`, CheckCircle2, "emerald"],
    [text.qrCheckins, summary.qr_checkins_today || 0, QrCode, "cyan"],
    [text.qrCheckouts, summary.qr_checkouts_today || 0, QrCode, "blue"],
  ];

  const updateFilter = (key, value) => setFilters((prev) => ({ ...prev, [key]: value }));

  const exportRows = (name, sourceRows) => {
    const tableRows = sourceRows.length ? sourceRows : filteredRows;
    const headers = [text.columns.employee, text.columns.branch, text.columns.date, text.columns.status, text.columns.workedHours, text.columns.missingHours, text.columns.payrollImpact];
    const csv = [headers, ...tableRows.map((row) => [row.employee_name, row.branch_name, row.attendance_date, text.statusLabels[row.status] || row.status, row.worked_hours, row.missing_hours, row.payroll_impact])]
      .map((line) => line.map(csvEscape).join(","))
      .join("\n");
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${name}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const printPage = () => window.print();

  return (
    <div className="space-y-4" dir={isArabic ? "rtl" : "ltr"}>
      <section className="theme-card p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="text-xs font-black text-[var(--muted)]">{pageEyebrow}</div>
            <h2 className="mt-1 text-3xl font-black text-[var(--text)]">{pageTitle}</h2>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-[var(--muted)]">{pageSubtitle}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setRefreshIndex((value) => value + 1)} className="inline-flex h-10 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-black text-[var(--text)]">
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              {text.refresh}
            </button>
            <button type="button" onClick={() => exportRows("attendance-center", filteredRows)} className="inline-flex h-10 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-black text-[var(--text)]"><Download className="h-4 w-4" />{text.excel}</button>
            <button type="button" onClick={printPage} className="inline-flex h-10 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-black text-[var(--text)]"><FileText className="h-4 w-4" />{text.pdf}</button>
            <button type="button" onClick={printPage} className="inline-flex h-10 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-black text-[var(--text)]"><Printer className="h-4 w-4" />{text.print}</button>
          </div>
        </div>
      </section>

      <section className="sticky top-0 z-20 rounded-lg border border-[var(--border)] bg-[var(--card)] p-3 shadow-sm">
        <div className="mb-3 flex items-center gap-2 text-sm font-black text-[var(--text)]"><Filter className="h-4 w-4" />{text.filters}</div>
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-7">
          <Field label={text.search}><div className="relative"><Search className="pointer-events-none absolute start-3 top-3 h-4 w-4 text-[var(--muted)]" /><NativeInput value={filters.search} onChange={(event) => updateFilter("search", event.target.value)} className="w-full ps-9" /></div></Field>
          <Field label={text.branch}><NativeSelect value={filters.branchId} onChange={(event) => updateFilter("branchId", event.target.value)}><option value="">{text.allBranches}</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name || branch.branch_name}</option>)}</NativeSelect></Field>
          <Field label={text.employee}><NativeSelect value={filters.employeeId} onChange={(event) => updateFilter("employeeId", event.target.value)}><option value="">{text.allEmployees}</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.full_name || employee.name}</option>)}</NativeSelect></Field>
          <Field label={text.startDate}><NativeInput type="date" value={filters.startDate} onChange={(event) => updateFilter("startDate", event.target.value)} /></Field>
          <Field label={text.endDate}><NativeInput type="date" value={filters.endDate} onChange={(event) => updateFilter("endDate", event.target.value)} /></Field>
          <Field label={text.status}><NativeSelect value={filters.status} onChange={(event) => updateFilter("status", event.target.value)}><option value="">{text.allStatuses}</option>{Object.entries(text.statusLabels).filter(([key]) => key !== "still_working").map(([key, label]) => <option key={key} value={key}>{label}</option>)}</NativeSelect></Field>
          <Field label={text.source}><NativeSelect value={filters.source} onChange={(event) => updateFilter("source", event.target.value)}><option value="">{text.allSources}</option><option value="qr">QR</option><option value="qr_branch">QR Branch</option><option value="manual">Manual</option><option value="imported">Imported</option></NativeSelect></Field>
        </div>
        <div className="mt-3 flex flex-wrap gap-3 text-xs font-black text-[var(--muted)]">
          {[["lateOnly", text.lateOnly], ["missingOnly", text.missingOnly], ["payrollAffectedOnly", text.payrollAffectedOnly]].map(([key, label]) => (
            <label key={key} className="inline-flex items-center gap-2"><input type="checkbox" checked={filters[key]} onChange={(event) => updateFilter(key, event.target.checked)} />{label}</label>
          ))}
          <label className="inline-flex items-center gap-2"><input type="checkbox" checked={dense} onChange={(event) => setDense(event.target.checked)} />{text.dense}</label>
        </div>
      </section>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {tabKeys.map((key, index) => (
          <button key={key} type="button" onClick={() => setActiveTab(key)} className={`h-10 shrink-0 rounded-lg border px-3 text-sm font-black ${activeTab === key ? "border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--text)]" : "border-[var(--border)] bg-[var(--card)] text-[var(--muted)]"}`}>
            {text.tabs[index]}
          </button>
        ))}
      </div>

      {activeTab === "overview" ? (
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {kpis.map(([label, value, Icon, tone]) => <KpiCard key={label} label={label} value={value} icon={Icon} tone={tone} />)}
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            <ChartPanel title="Attendance trend" data={dashboard?.trends?.attendance || []} type="line" lines={["present", "absent"]} />
            <ChartPanel title="Late arrivals trend" data={dashboard?.trends?.late_arrivals || []} type="bar" bars={["late"]} />
            <ChartPanel title="Branch attendance comparison" data={dashboard?.branches || []} xKey="branch_name" type="bar" bars={["present", "absent", "late"]} />
            <ChartPanel title="Employee attendance ranking" data={dashboard?.employee_ranking || []} xKey="employee_name" type="bar" bars={["present", "absent"]} />
          </div>
        </div>
      ) : null}

      {activeTab === "live" ? <LiveAttendance rows={liveRows} text={text} /> : null}
      {["daily", "late", "missing", "absences"].includes(activeTab) ? <AttendanceTable rows={filteredRows} text={text} dense={dense} onSelect={setSelectedRow} /> : null}
      {activeTab === "leaves" ? <LeavesTable rows={leaveRows} text={text} /> : null}
      {activeTab === "qr" ? <QrSessionsTable rows={qrRows} text={text} /> : null}
      {activeTab === "payroll" ? <PayrollImpact rows={payrollRows} text={text} onSelect={setSelectedRow} /> : null}
      {activeTab === "reports" ? <ReportsView payload={reportPayload} rows={rows} text={text} onExport={exportRows} /> : null}

      {selectedRow ? <DetailsDrawer row={selectedRow} text={text} onClose={() => setSelectedRow(null)} /> : null}
    </div>
  );
}

function ChartPanel({ title, data, xKey = "date", type = "line", lines = [], bars = [] }) {
  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
      <h3 className="text-base font-black text-[var(--text)]">{title}</h3>
      <div className="mt-4 h-72">
        <ResponsiveContainer width="100%" height="100%">
          {type === "line" ? (
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey={xKey} tick={{ fill: "var(--muted)", fontSize: 11 }} />
              <YAxis tick={{ fill: "var(--muted)", fontSize: 11 }} />
              <Tooltip />
              {lines.map((line, index) => <Line key={line} type="monotone" dataKey={line} stroke={index ? "#ef4444" : "#10b981"} strokeWidth={2} />)}
            </LineChart>
          ) : (
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey={xKey} tick={{ fill: "var(--muted)", fontSize: 11 }} />
              <YAxis tick={{ fill: "var(--muted)", fontSize: 11 }} />
              <Tooltip />
              {bars.map((bar, index) => <Bar key={bar} dataKey={bar} fill={["#10b981", "#ef4444", "#f59e0b"][index % 3]} radius={[4, 4, 0, 0]} />)}
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </section>
  );
}

function AttendanceTable({ rows, text, dense, onSelect }) {
  const headers = [text.columns.employee, text.columns.branch, text.columns.date, text.columns.checkIn, text.columns.checkOut, text.columns.workedHours, text.columns.status, text.columns.lateDuration, text.columns.missingHours, text.columns.overtime, text.columns.source, text.columns.payrollImpact, text.columns.notes];
  return (
    <section className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--card)]">
      <div className="overflow-auto">
        <table className="min-w-[1280px] w-full text-sm">
          <thead className="bg-[var(--surface)] text-xs font-black text-[var(--muted)]">
            <tr>{headers.map((header) => <th key={header} className="px-3 py-3 text-start">{header}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {rows.length ? rows.map((row) => (
              <tr key={`${row.employee_id}-${row.attendance_date}-${row.status}`} onClick={() => onSelect(row)} className="cursor-pointer hover:bg-[var(--surface)]">
                <td className={`px-3 ${dense ? "py-2" : "py-4"}`}><div className="font-black text-[var(--text)]">{row.employee_name}</div><div className="text-xs text-[var(--muted)]">{row.employee_code}</div></td>
                <td className="px-3 py-2">{row.branch_name || "-"}</td>
                <td className="px-3 py-2" dir="ltr">{row.attendance_date}</td>
                <td className="px-3 py-2" dir="ltr">{formatTime(row.check_in_time)}</td>
                <td className="px-3 py-2" dir="ltr">{formatTime(row.check_out_time)}</td>
                <td className="px-3 py-2" dir="ltr">{row.worked_hours}</td>
                <td className="px-3 py-2"><Chip status={row.status}>{text.statusLabels[row.status] || row.status}</Chip></td>
                <td className="px-3 py-2" dir="ltr">{row.late_minutes || 0}m</td>
                <td className="px-3 py-2" dir="ltr">{row.missing_hours || 0}</td>
                <td className="px-3 py-2" dir="ltr">{row.overtime_hours || 0}</td>
                <td className="px-3 py-2"><SourceBadge value={row.source_label} /></td>
                <td className="px-3 py-2 font-black text-rose-400" dir="ltr">{formatMoney(row.payroll_impact)}</td>
                <td className="max-w-[240px] truncate px-3 py-2" title={row.notes || ""}>{row.notes || "-"}</td>
              </tr>
            )) : <tr><td colSpan={headers.length} className="p-8 text-center text-[var(--muted)]">{text.noRows}</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SourceBadge({ value }) {
  const normalized = String(value || "").toLowerCase();
  const status = normalized.includes("qr") ? "still_working" : normalized.includes("manual") ? "weekly_off" : "present";
  return value ? <Chip status={status}>{value}</Chip> : <span className="text-[var(--muted)]">-</span>;
}

function LiveAttendance({ rows, text }) {
  return (
    <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {rows.length ? rows.map((row) => (
        <div key={row.id} className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-black text-[var(--text)]">{row.employee_name}</div>
              <div className="mt-1 text-sm text-[var(--muted)]">{row.branch_name}</div>
            </div>
            <Chip status="still_working">{text.stillWorking}</Chip>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div><div className="text-xs font-black text-[var(--muted)]">{text.columns.checkIn}</div><div className="mt-1 font-black" dir="ltr">{formatTime(row.check_in_time)}</div></div>
            <div><div className="text-xs font-black text-[var(--muted)]">{text.columns.workedHours}</div><div className="mt-1 font-black" dir="ltr">{row.current_worked_hours}</div></div>
          </div>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-[var(--surface)]"><div className="h-full bg-emerald-500" style={{ width: `${row.progress_percent || 0}%` }} /></div>
        </div>
      )) : <div className="theme-card col-span-full p-8 text-center text-[var(--muted)]">{text.noRows}</div>}
    </section>
  );
}

function PayrollImpact({ rows, text, onSelect }) {
  return (
    <section className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--card)]">
      <div className="overflow-auto">
        <table className="min-w-[960px] w-full text-sm">
          <thead className="bg-[var(--surface)] text-xs font-black text-[var(--muted)]">
            <tr>{[text.columns.employee, text.columns.presentDays, text.columns.absenceDays, text.columns.missingHours, text.columns.lateCount, text.columns.deduction, text.columns.penalties, text.columns.netImpact].map((header) => <th key={header} className="px-3 py-3 text-start">{header}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {rows.map((row) => (
              <tr key={row.employee_id} className="cursor-pointer hover:bg-[var(--surface)]" onClick={() => onSelect(row)}>
                <td className="px-3 py-3"><div className="font-black text-[var(--text)]">{row.employee_name}</div><div className="text-xs text-[var(--muted)]">{row.explanation}</div></td>
                <td className="px-3 py-3" dir="ltr">{row.present_days}</td>
                <td className="px-3 py-3" dir="ltr">{row.absence_days}</td>
                <td className="px-3 py-3" dir="ltr">{row.missing_hours}</td>
                <td className="px-3 py-3" dir="ltr">{row.late_count}</td>
                <td className="px-3 py-3 font-black text-rose-400" dir="ltr">{formatMoney(row.attendance_deduction)}</td>
                <td className="px-3 py-3" dir="ltr">{formatMoney(row.penalties)}</td>
                <td className="px-3 py-3 font-black text-rose-400" dir="ltr">{formatMoney(row.net_salary_impact)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function LeavesTable({ rows, text }) {
  return <SimpleTable headers={[text.columns.employee, text.columns.branch, text.columns.leaveType, text.columns.start, text.columns.end, text.columns.approval, text.columns.notes]} rows={rows.map((row) => [row.employee_name, row.branch_name, row.leave_type, row.leave_date || row.start_date, row.end_date || row.leave_date, row.status, row.notes])} empty={text.noRows} />;
}

function QrSessionsTable({ rows, text }) {
  return <SimpleTable headers={[text.columns.employee, text.columns.branch, text.columns.qrType, text.columns.scanTime, text.columns.device, text.columns.duration, text.suspicious]} rows={rows.map((row) => [row.employee_name, row.branch_name, row.qr_type, formatDateTime(row.scan_time), row.device, row.session_duration ?? "-", [row.duplicate_scan ? text.duplicateScan : "", row.missing_checkout ? text.missingCheckout : "", row.suspicious_count ? text.suspicious : ""].filter(Boolean).join(" / ") || "-"])} empty={text.noRows} />;
}

function ReportsView({ payload, rows, text, onExport }) {
  return (
    <section className="grid gap-4 xl:grid-cols-3">
      <KpiCard label={text.presentToday} value={payload?.summary?.present_today || 0} icon={UserCheck} />
      <KpiCard label={text.absentToday} value={payload?.summary?.absent_today || 0} icon={XCircle} tone="rose" />
      <KpiCard label={text.missingHours} value={payload?.summary?.missing_hours || 0} icon={TimerOff} tone="orange" />
      <div className="theme-card p-5 xl:col-span-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h3 className="text-xl font-black text-[var(--text)]">{text.tabs[9]}</h3><p className="mt-1 text-sm text-[var(--muted)]" dir="ltr">{payload?.generated_at || ""}</p></div>
          <button type="button" onClick={() => onExport("attendance-report", rows)} className="inline-flex h-10 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-black text-[var(--text)]"><Download className="h-4 w-4" />{text.excel}</button>
        </div>
      </div>
    </section>
  );
}

function SimpleTable({ headers, rows, empty }) {
  return (
    <section className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--card)]">
      <div className="overflow-auto">
        <table className="min-w-[900px] w-full text-sm">
          <thead className="bg-[var(--surface)] text-xs font-black text-[var(--muted)]"><tr>{headers.map((header) => <th key={header} className="px-3 py-3 text-start">{header}</th>)}</tr></thead>
          <tbody className="divide-y divide-[var(--border)]">
            {rows.length ? rows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex} className="px-3 py-3">{cell || "-"}</td>)}</tr>) : <tr><td colSpan={headers.length} className="p-8 text-center text-[var(--muted)]">{empty}</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function DetailsDrawer({ row, text, onClose }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/50" onClick={onClose}>
      <aside className="ms-auto h-full w-full max-w-xl overflow-auto bg-[var(--card)] p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <div><h3 className="text-xl font-black text-[var(--text)]">{text.details}</h3><p className="mt-1 text-sm text-[var(--muted)]">{row.employee_name}</p></div>
          <button type="button" onClick={onClose} className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-black text-[var(--text)]">{text.close}</button>
        </div>
        <div className="mt-5 grid gap-3">
          {Object.entries(row).map(([key, value]) => (
            <div key={key} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
              <div className="text-xs font-black uppercase text-[var(--muted)]">{key}</div>
              <div className="mt-1 break-words text-sm font-semibold text-[var(--text)]" dir={typeof value === "number" ? "ltr" : undefined}>{String(value ?? "-")}</div>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}
