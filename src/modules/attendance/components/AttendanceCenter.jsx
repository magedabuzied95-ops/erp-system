import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  Plus,
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
  generateAttendanceOpeningSchedule,
  getAttendanceCenterReports,
  getAttendanceDashboard,
  getAttendanceEmployees,
  getAttendanceHrSettings,
  getAttendanceLeaves,
  getAttendanceList,
  getAttendanceLive,
  getAttendanceOvertimeApprovals,
  getAttendancePayrollImpact,
  getAttendanceQrSessions,
  getAttendanceSchedules,
  getBranches,
  saveManualAttendance,
  updateAttendanceHrSettings,
  updateAttendanceOvertimeApproval,
} from "../attendanceApi";

const todayValue = () => new Date().toISOString().slice(0, 10);
const nextDayValue = (value) => {
  const date = new Date(`${value || todayValue()}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
};
const monthStartValue = () => {
  const date = new Date();
  date.setDate(1);
  return date.toISOString().slice(0, 10);
};
const formatDayFirstDate = (value) => {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : "";
};
const parseDayFirstDate = (value) => {
  const match = String(value || "").trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return "";
  const [, day, month, year] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (date.getUTCFullYear() !== Number(year) || date.getUTCMonth() + 1 !== Number(month) || date.getUTCDate() !== Number(day)) return "";
  return `${year}-${month}-${day}`;
};
const dayFirstDraft = (value) => {
  const digits = String(value || "").replace(/\D/g, "").slice(0, 8);
  return [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 8)].filter(Boolean).join("/");
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
const manualAttendanceForm = (employeeId = "") => ({
  editMode: "both",
  employeeId,
  attendanceDate: todayValue(),
  checkInHour: "",
  checkInMinute: "00",
  checkInPeriod: "PM",
  checkOutDate: nextDayValue(todayValue()),
  checkOutHour: "",
  checkOutMinute: "00",
  checkOutPeriod: "AM",
  reason: "",
});
const twelveHourTime = (hour, minute, period) => {
  const hourNumber = Number(hour);
  const minuteNumber = Number(minute);
  if (!Number.isInteger(hourNumber) || hourNumber < 1 || hourNumber > 12 || !Number.isInteger(minuteNumber) || minuteNumber < 0 || minuteNumber > 59) return "";
  const hour24 = period === "PM" ? (hourNumber % 12) + 12 : hourNumber % 12;
  return `${String(hour24).padStart(2, "0")}:${String(minuteNumber).padStart(2, "0")}`;
};

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
      paidLeaves: "Paid Leaves",
      deductedLeaves: "Deducted Leaves",
      leaveDeduction: "Leave Deduction",
      approvedOvertime: "Approved Overtime",
      overtimePay: "Overtime Pay",
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
      paidLeaves: "إجازات مدفوعة",
      deductedLeaves: "إجازات مخصومة",
      leaveDeduction: "خصم الإجازات",
      approvedOvertime: "إضافي معتمد",
      overtimePay: "قيمة الإضافي",
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
  // Three distinguishable groups, as before the accent converged: blue was
  // approved leave, sky was scheduled time off, cyan was an in-progress shift.
  // Flattening all five to one token would have merged states an operator
  // reads at a glance.
  on_leave: "border-primary/20 bg-primary/10 text-primary",
  holiday: "border-primary/20 bg-primary/10 text-primary",
  weekly_off: "border-border bg-surface-soft text-text-muted",
  monthly_off: "border-border bg-surface-soft text-text-muted",
  still_working: "border-info/25 bg-info/10 text-info",
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
    cyan: "bg-primary/10 text-primary",
    blue: "bg-primary/10 text-primary",
  }[tone] || "bg-[var(--surface)] text-[var(--muted)]";
  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] p-4">
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
  return <input {...props} className={`h-[var(--control-height-md)] rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-semibold text-[var(--text)] outline-none focus:border-[var(--primary)] ${props.className || ""}`} />;
}

function ManualTimeInput({ hour, minute, period, onChange, isArabic, periodDefault }) {
  const hours = Array.from({ length: 12 }, (_, index) => String(index + 1));
  const minutes = Array.from({ length: 60 }, (_, index) => String(index).padStart(2, "0"));
  return (
    <div className="grid grid-cols-[1fr_1fr_auto] gap-2" dir="ltr">
      <NativeSelect value={hour} onChange={(event) => onChange({ hour: event.target.value })} aria-label={isArabic ? "الساعة" : "Hour"}>
        <option value="">{isArabic ? "الساعة" : "Hour"}</option>
        {hours.map((value) => <option key={value} value={value}>{value}</option>)}
      </NativeSelect>
      <NativeSelect value={minute} onChange={(event) => onChange({ minute: event.target.value })} aria-label={isArabic ? "الدقيقة" : "Minute"}>
        {minutes.map((value) => <option key={value} value={value}>{value}</option>)}
      </NativeSelect>
      <div className="flex rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-1">
        {["AM", "PM"].map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => onChange({ period: value })}
            className={`min-w-11 rounded-[var(--radius-control)] px-2 text-xs font-black transition ${period === value ? "bg-primary text-[var(--primary-contrast)]" : "text-[var(--muted)]"}`}
            aria-pressed={period === value}
            title={value === periodDefault ? (isArabic ? "الافتراضي" : "Default") : undefined}
          >
            {value}
          </button>
        ))}
      </div>
    </div>
  );
}

function DayFirstDateInput({ value, onChange, min, max, required = false }) {
  const [draft, setDraft] = useState(() => formatDayFirstDate(value));
  const pickerRef = useRef(null);

  useEffect(() => setDraft(formatDayFirstDate(value)), [value]);

  const emit = (nextValue) => onChange?.({ target: { value: nextValue } });
  const commitDraft = (nextDraft) => {
    if (!nextDraft) {
      emit("");
      return;
    }
    const parsed = parseDayFirstDate(nextDraft);
    if (parsed && (!min || parsed >= min) && (!max || parsed <= max)) emit(parsed);
  };

  return (
    <div className="relative" dir="ltr">
      <input
        type="text"
        inputMode="numeric"
        value={draft}
        required={required}
        placeholder="DD/MM/YYYY"
        aria-label="DD/MM/YYYY"
        onChange={(event) => {
          const nextDraft = dayFirstDraft(event.target.value);
          setDraft(nextDraft);
          commitDraft(nextDraft);
        }}
        onBlur={() => setDraft(formatDayFirstDate(value))}
        className="h-[var(--control-height-md)] w-full rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-3 pe-11 text-center text-sm font-semibold text-[var(--text)] outline-none focus:border-[var(--primary)]"
      />
      <button
        type="button"
        onClick={() => {
          const picker = pickerRef.current;
          if (!picker) return;
          try {
            if (typeof picker.showPicker === "function") picker.showPicker();
            else picker.click();
          } catch {
            picker.click();
          }
        }}
        className="absolute end-1 top-1 grid h-[var(--control-height-sm)] w-8 place-items-center rounded-[var(--radius-control)] text-[var(--muted)] hover:bg-[var(--card)]"
        aria-label="Open calendar"
      >
        <CalendarDays className="h-4 w-4" />
      </button>
      <input
        ref={pickerRef}
        type="date"
        value={value || ""}
        min={min}
        max={max}
        onChange={(event) => emit(event.target.value)}
        tabIndex={-1}
        aria-hidden="true"
        className="pointer-events-none absolute h-px w-px opacity-0"
      />
    </div>
  );
}

function NativeSelect(props) {
  return <select {...props} className={`h-[var(--control-height-md)] rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-semibold text-[var(--text)] outline-none focus:border-[var(--primary)] ${props.className || ""}`} />;
}

function HrSettingsPanel({ settings, isArabic, saving, onChange, onSave }) {
  const values = settings || {
    require_next_opening_on_pos_close: true,
    grace_minutes: 10,
    monthly_paid_leave_days: 3,
    forbidden_leave_weekdays: [4, 5, 6],
  };
  const weekdayLabels = isArabic
    ? ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"]
    : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const blockedDays = Array.isArray(values.forbidden_leave_weekdays) ? values.forbidden_leave_weekdays.map(Number) : [];
  const toggleWeekday = (day) => {
    const next = blockedDays.includes(day) ? blockedDays.filter((item) => item !== day) : [...blockedDays, day];
    onChange("forbidden_leave_weekdays", next.sort((a, b) => a - b));
  };

  return (
    <section className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.16em] text-[var(--muted)]">
            {isArabic ? "قواعد الحضور والمرتبات" : "Attendance payroll rules"}
          </div>
          <h3 className="m1-section-title mt-1 text-[var(--text)]">
            {isArabic ? "إعدادات الاحتساب الأساسية" : "Core calculation settings"}
          </h3>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {isArabic ? "القواعد دي بتأثر على الإجازات المدفوعة، التأخير، وفاتح الفرع عند قفل نقطة البيع." : "These rules affect paid leave, late grace, and next opener selection on POS close."}
          </p>
        </div>
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="inline-flex h-[var(--control-height-md)] items-center justify-center rounded-[var(--radius-control)] bg-[var(--primary)] px-4 text-sm font-black text-black disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving ? (isArabic ? "جاري الحفظ..." : "Saving...") : (isArabic ? "حفظ الإعدادات" : "Save settings")}
        </button>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Field label={isArabic ? "سماحية التأخير بالدقائق" : "Late grace minutes"}>
          <NativeInput type="number" min="0" value={values.grace_minutes ?? 10} onChange={(event) => onChange("grace_minutes", Number(event.target.value || 0))} />
        </Field>
        <Field label={isArabic ? "الإجازات المدفوعة شهريًا" : "Monthly paid leave days"}>
          <NativeInput type="number" min="0" value={values.monthly_paid_leave_days ?? 3} onChange={(event) => onChange("monthly_paid_leave_days", Number(event.target.value || 0))} />
        </Field>
        <label className="flex items-center gap-2 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm font-black text-[var(--text)] xl:col-span-2">
          <input
            type="checkbox"
            checked={values.require_next_opening_on_pos_close !== false}
            onChange={(event) => onChange("require_next_opening_on_pos_close", event.target.checked)}
          />
          {isArabic ? "إلزام اختيار فاتح الفرع عند قفل شيفت POS" : "Require next opener when closing POS shift"}
        </label>
      </div>

      <div className="mt-4">
        <div className="mb-2 text-xs font-black text-[var(--muted)]">
          {isArabic ? "أيام ممنوع طلب إجازة فيها بدون موافقة خاصة" : "Weekdays blocked for leave without override"}
        </div>
        <div className="flex flex-wrap gap-2">
          {weekdayLabels.map((label, index) => (
            <button
              key={label}
              type="button"
              onClick={() => toggleWeekday(index)}
              className={`rounded-full border px-3 py-1.5 text-xs font-black ${blockedDays.includes(index) ? "border-rose-400/30 bg-rose-500/15 text-rose-200" : "border-[var(--border)] bg-[var(--surface)] text-[var(--muted)]"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
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
  const [overtimeRows, setOvertimeRows] = useState([]);
  const [leaveRows, setLeaveRows] = useState([]);
  const [scheduleRows, setScheduleRows] = useState([]);
  const [qrRows, setQrRows] = useState([]);
  const [reportPayload, setReportPayload] = useState(null);
  const [hrSettings, setHrSettings] = useState(null);
  const [savingHrSettings, setSavingHrSettings] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualSaving, setManualSaving] = useState(false);
  const [manualError, setManualError] = useState("");
  const [manualForm, setManualForm] = useState(() => manualAttendanceForm());
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
      const requests = [
        ["branches", getBranches({ active: true })],
        ["employees", getAttendanceEmployees({ active: true, branch_id: filters.branchId })],
        ["dashboard", getAttendanceDashboard(params)],
        ["list", getAttendanceList(params)],
        ["live", getAttendanceLive(params)],
        ["payroll", getAttendancePayrollImpact(params)],
        ["overtime", getAttendanceOvertimeApprovals(params)],
        ["leaves", getAttendanceLeaves(params)],
        ["schedules", getAttendanceSchedules(params)],
        ["qr", getAttendanceQrSessions(params)],
        ["reports", getAttendanceCenterReports(params)],
        ["hrSettings", getAttendanceHrSettings()],
      ];
      const settled = await Promise.allSettled(requests.map(([, request]) => request));
      const fulfilled = {};

      settled.forEach((result, index) => {
        const key = requests[index][0];
        if (result.status === "fulfilled") {
          fulfilled[key] = result.value;
          return;
        }
        console.error(`[attendance-center] ${key} request failed`, result.reason);
      });

      if (Object.hasOwn(fulfilled, "branches")) setBranches(safeArray(fulfilled.branches));
      if (Object.hasOwn(fulfilled, "employees")) setEmployees(safeArray(fulfilled.employees));
      if (Object.hasOwn(fulfilled, "dashboard")) setDashboard(fulfilled.dashboard || null);
      if (Object.hasOwn(fulfilled, "list")) setRows(safeArray(fulfilled.list?.rows || fulfilled.list?.attendance || fulfilled.list));
      if (Object.hasOwn(fulfilled, "live")) setLiveRows(safeArray(fulfilled.live?.rows || fulfilled.live));
      if (Object.hasOwn(fulfilled, "payroll")) setPayrollRows(safeArray(fulfilled.payroll?.rows || fulfilled.payroll));
      if (Object.hasOwn(fulfilled, "overtime")) setOvertimeRows(safeArray(fulfilled.overtime?.rows || fulfilled.overtime));
      if (Object.hasOwn(fulfilled, "leaves")) setLeaveRows(safeArray(fulfilled.leaves?.rows || fulfilled.leaves));
      if (Object.hasOwn(fulfilled, "schedules")) setScheduleRows(safeArray(fulfilled.schedules?.rows || fulfilled.schedules?.schedules || fulfilled.schedules));
      if (Object.hasOwn(fulfilled, "qr")) setQrRows(safeArray(fulfilled.qr?.rows || fulfilled.qr));
      if (Object.hasOwn(fulfilled, "reports")) setReportPayload(fulfilled.reports || null);
      if (Object.hasOwn(fulfilled, "hrSettings")) setHrSettings(fulfilled.hrSettings || null);
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
  const openingSchedules = useMemo(
    () => scheduleRows.filter((row) => String(row.shift_type || "").toLowerCase() === "opening").slice(0, 5),
    [scheduleRows]
  );

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

  const handleOvertimeApproval = async (row, status) => {
    await updateAttendanceOvertimeApproval(row.id, { status });
    setRefreshIndex((value) => value + 1);
  };

  const handleGenerateOpeningSchedule = async () => {
    if (!filters.branchId) {
      window.alert(isArabic ? "اختر الفرع أولًا لتوليد جدول فاتح الفرع." : "Select a branch first to generate opening schedule.");
      return;
    }
    await generateAttendanceOpeningSchedule({
      branch_id: filters.branchId,
      start_date: filters.startDate,
      end_date: filters.endDate,
      overwrite: false,
    });
    setRefreshIndex((value) => value + 1);
  };

  const handleHrSettingsChange = (key, value) => {
    setHrSettings((prev) => ({
      ...(prev || {
        require_next_opening_on_pos_close: true,
        grace_minutes: 10,
        monthly_paid_leave_days: 3,
        forbidden_leave_weekdays: [4, 5, 6],
      }),
      [key]: value,
    }));
  };

  const handleSaveHrSettings = async () => {
    if (!hrSettings) return;
    setSavingHrSettings(true);
    try {
      const response = await updateAttendanceHrSettings(hrSettings);
      setHrSettings(response?.data || response?.settings || response || hrSettings);
      setRefreshIndex((value) => value + 1);
    } finally {
      setSavingHrSettings(false);
    }
  };

  const printPage = () => window.print();

  const openManualAttendance = () => {
    setManualForm(manualAttendanceForm(filters.employeeId || ""));
    setManualError("");
    setManualOpen(true);
  };

  const handleManualAttendanceSubmit = async (event) => {
    event.preventDefault();
    const editsCheckIn = manualForm.editMode !== "check_out";
    const editsCheckOut = manualForm.editMode !== "check_in";
    const checkInTime = editsCheckIn ? twelveHourTime(manualForm.checkInHour, manualForm.checkInMinute, manualForm.checkInPeriod) : "";
    const checkOutTime = editsCheckOut ? twelveHourTime(manualForm.checkOutHour, manualForm.checkOutMinute, manualForm.checkOutPeriod) : "";
    if (!manualForm.employeeId || !manualForm.attendanceDate || !manualForm.reason.trim() || (editsCheckIn && !checkInTime) || (editsCheckOut && !checkOutTime)) {
      setManualError(isArabic ? "اختر الموظف والتاريخ وأدخل الوقت المطلوب ثم اكتب سبب التصحيح." : "Select the employee and date, enter the required time, then add the correction reason.");
      return;
    }
    setManualSaving(true);
    setManualError("");
    try {
      await saveManualAttendance({
        employee_id: Number(manualForm.employeeId),
        attendance_date: manualForm.attendanceDate,
        correction_scope: manualForm.editMode,
        check_in_time: editsCheckIn ? checkInTime : null,
        check_out_date: editsCheckOut ? manualForm.checkOutDate : null,
        check_out_time: editsCheckOut ? checkOutTime : null,
        reason: manualForm.reason.trim(),
      });
      setManualOpen(false);
      setActiveTab("daily");
      setFilters((prev) => ({
        ...prev,
        employeeId: String(manualForm.employeeId),
        startDate: !prev.startDate || manualForm.attendanceDate < prev.startDate ? manualForm.attendanceDate : prev.startDate,
        endDate: !prev.endDate || manualForm.attendanceDate > prev.endDate ? manualForm.attendanceDate : prev.endDate,
      }));
      setRefreshIndex((value) => value + 1);
    } catch (error) {
      setManualError(error?.responseBody?.message || error?.message || (isArabic ? "تعذر حفظ التصحيح." : "Failed to save the correction."));
    } finally {
      setManualSaving(false);
    }
  };

  return (
    <div className="space-y-4" dir={isArabic ? "rtl" : "ltr"}>
      <section className="theme-card p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="text-xs font-black text-[var(--muted)]">{pageEyebrow}</div>
            <h2 className="m1-section-title mt-1 text-[var(--text)]">{pageTitle}</h2>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-[var(--muted)]">{pageSubtitle}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={openManualAttendance} className="inline-flex h-[var(--control-height-md)] items-center gap-2 rounded-[var(--radius-control)] border border-emerald-500/30 bg-emerald-500/15 px-3 text-sm font-black text-emerald-300">
              <Plus className="h-4 w-4" />
              {isArabic ? "إضافة حضور / انصراف" : "Add attendance"}
            </button>
            <button type="button" onClick={() => setRefreshIndex((value) => value + 1)} className="inline-flex h-[var(--control-height-md)] items-center gap-2 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-black text-[var(--text)]">
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              {text.refresh}
            </button>
            <button type="button" onClick={() => exportRows("attendance-center", filteredRows)} className="inline-flex h-[var(--control-height-md)] items-center gap-2 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-black text-[var(--text)]"><Download className="h-4 w-4" />{text.excel}</button>
            <button type="button" onClick={printPage} className="inline-flex h-[var(--control-height-md)] items-center gap-2 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-black text-[var(--text)]"><FileText className="h-4 w-4" />{text.pdf}</button>
            <button type="button" onClick={printPage} className="inline-flex h-[var(--control-height-md)] items-center gap-2 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-black text-[var(--text)]"><Printer className="h-4 w-4" />{text.print}</button>
          </div>
        </div>
      </section>

      <section className="sticky top-0 z-20 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] p-3 shadow-sm">
        <div className="mb-3 flex items-center gap-2 text-sm font-black text-[var(--text)]"><Filter className="h-4 w-4" />{text.filters}</div>
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-7">
          <Field label={text.search}><div className="relative"><Search className="pointer-events-none absolute start-3 top-3 h-4 w-4 text-[var(--muted)]" /><NativeInput value={filters.search} onChange={(event) => updateFilter("search", event.target.value)} className="w-full ps-9" /></div></Field>
          <Field label={text.branch}><NativeSelect value={filters.branchId} onChange={(event) => updateFilter("branchId", event.target.value)}><option value="">{text.allBranches}</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name || branch.branch_name}</option>)}</NativeSelect></Field>
          <Field label={text.employee}><NativeSelect value={filters.employeeId} onChange={(event) => updateFilter("employeeId", event.target.value)}><option value="">{text.allEmployees}</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.full_name || employee.name}</option>)}</NativeSelect></Field>
          <Field label={text.startDate}><DayFirstDateInput value={filters.startDate} max={filters.endDate} onChange={(event) => updateFilter("startDate", event.target.value)} /></Field>
          <Field label={text.endDate}><DayFirstDateInput value={filters.endDate} min={filters.startDate} onChange={(event) => updateFilter("endDate", event.target.value)} /></Field>
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
          <button key={key} type="button" onClick={() => setActiveTab(key)} className={`h-[var(--control-height-md)] shrink-0 rounded-[var(--radius-control)] border px-3 text-sm font-black ${activeTab === key ? "border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--text)]" : "border-[var(--border)] bg-[var(--card)] text-[var(--muted)]"}`}>
            {text.tabs[index]}
          </button>
        ))}
      </div>

      {activeTab === "overview" ? (
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {kpis.map(([label, value, Icon, tone]) => <KpiCard key={label} label={label} value={value} icon={Icon} tone={tone} />)}
          </div>
          <HrSettingsPanel settings={hrSettings} isArabic={isArabic} saving={savingHrSettings} onChange={handleHrSettingsChange} onSave={handleSaveHrSettings} />
          <OpeningSchedulePanel rows={openingSchedules} isArabic={isArabic} onGenerate={handleGenerateOpeningSchedule} canGenerate={Boolean(filters.branchId)} />
          <div className="grid gap-4 xl:grid-cols-2">
            <ChartPanel title="Attendance trend" data={dashboard?.trends?.attendance || []} type="line" lines={["present", "absent"]} />
            <ChartPanel title="Late arrivals trend" data={dashboard?.trends?.late_arrivals || []} type="bar" bars={["late"]} />
            <ChartPanel title="Branch attendance comparison" data={dashboard?.branches || []} xKey="branch_name" type="bar" bars={["present", "absent", "late"]} />
            <ChartPanel title="Employee attendance ranking" data={dashboard?.employee_ranking || []} xKey="employee_name" type="bar" bars={["present", "absent"]} />
          </div>
        </div>
      ) : null}

      {activeTab === "live" ? <LiveAttendance rows={liveRows} text={text} /> : null}
      {["daily", "late", "missing", "absences"].includes(activeTab) ? <AttendanceTable rows={filteredRows} text={text} dense={dense} onSelect={setSelectedRow} isArabic={isArabic} /> : null}
      {activeTab === "leaves" ? <LeavesTable rows={leaveRows} text={text} /> : null}
      {activeTab === "qr" ? <QrSessionsTable rows={qrRows} text={text} /> : null}
      {activeTab === "payroll" ? (
        <div className="space-y-4">
          <OvertimeApprovalsPanel rows={overtimeRows} isArabic={isArabic} onUpdate={handleOvertimeApproval} />
          <PayrollImpact rows={payrollRows} text={text} onSelect={setSelectedRow} />
        </div>
      ) : null}
      {activeTab === "reports" ? <ReportsView payload={reportPayload} rows={rows} text={text} onExport={exportRows} /> : null}

      {selectedRow ? <DetailsDrawer row={selectedRow} text={text} onClose={() => setSelectedRow(null)} /> : null}
      {manualOpen ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onMouseDown={() => !manualSaving && setManualOpen(false)}>
          <form onSubmit={handleManualAttendanceSubmit} onMouseDown={(event) => event.stopPropagation()} className="w-full max-w-2xl rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xs font-black uppercase tracking-[0.16em] text-emerald-300">{isArabic ? "تصحيح إداري" : "Admin correction"}</div>
                <h3 className="m1-section-title mt-1 text-[var(--text)]">{isArabic ? "إضافة حضور وانصراف" : "Add attendance and checkout"}</h3>
                <p className="mt-1 text-sm text-[var(--muted)]">{isArabic ? "يتم إنشاء سجل اليوم أو تصحيح السجل الموجود مع حفظ السبب واسم المسؤول." : "Creates the daily record or corrects the existing one with a full audit trail."}</p>
              </div>
              <button type="button" disabled={manualSaving} onClick={() => setManualOpen(false)} className="grid h-[var(--control-height-md)] w-10 place-items-center rounded-full border border-[var(--border)] text-[var(--muted)]"><XCircle className="h-5 w-5" /></button>
            </div>
            <div className="mt-5 grid grid-cols-3 gap-2 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-1.5">
              {[
                ["check_in", isArabic ? "الحضور فقط" : "Check-in only"],
                ["check_out", isArabic ? "الانصراف فقط" : "Checkout only"],
                ["both", isArabic ? "الحضور والانصراف" : "Both"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setManualForm((prev) => ({ ...prev, editMode: value }))}
                  className={`min-h-[var(--control-height-md)] rounded-[var(--radius-control)] px-2 text-xs font-black transition ${manualForm.editMode === value ? "bg-primary text-[var(--primary-contrast)]" : "text-[var(--muted)] hover:bg-[var(--card)]"}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs font-bold text-[var(--muted)]">
              {isArabic ? "عند اختيار الحضور فقط أو الانصراف فقط، لن تتغير القيمة الأخرى المسجلة." : "Choosing check-in only or checkout only keeps the other saved timestamp unchanged."}
            </p>
            <div className="mt-5 grid gap-3 md:grid-cols-2">
              <Field label={isArabic ? "الموظف" : "Employee"}><NativeSelect value={manualForm.employeeId} onChange={(event) => setManualForm((prev) => ({ ...prev, employeeId: event.target.value }))} required><option value="">{isArabic ? "اختر الموظف" : "Select employee"}</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.full_name || employee.name}</option>)}</NativeSelect></Field>
              <Field label={isArabic ? "تاريخ سجل الحضور" : "Attendance record date"}><DayFirstDateInput value={manualForm.attendanceDate} onChange={(event) => setManualForm((prev) => ({ ...prev, attendanceDate: event.target.value, checkOutDate: [prev.attendanceDate, nextDayValue(prev.attendanceDate)].includes(prev.checkOutDate) ? nextDayValue(event.target.value) : prev.checkOutDate }))} required /></Field>
              {manualForm.editMode !== "check_out" ? (
                <Field label={isArabic ? "وقت الحضور — الافتراضي PM" : "Check-in time — PM default"}>
                  <ManualTimeInput
                    hour={manualForm.checkInHour}
                    minute={manualForm.checkInMinute}
                    period={manualForm.checkInPeriod}
                    periodDefault="PM"
                    isArabic={isArabic}
                    onChange={(change) => setManualForm((prev) => ({
                      ...prev,
                      checkInHour: change.hour ?? prev.checkInHour,
                      checkInMinute: change.minute ?? prev.checkInMinute,
                      checkInPeriod: change.period ?? prev.checkInPeriod,
                    }))}
                  />
                </Field>
              ) : null}
              {manualForm.editMode !== "check_in" ? (
                <>
                  <Field label={isArabic ? "تاريخ الانصراف" : "Checkout date"}><DayFirstDateInput value={manualForm.checkOutDate} min={manualForm.attendanceDate} onChange={(event) => setManualForm((prev) => ({ ...prev, checkOutDate: event.target.value }))} required /></Field>
                  <Field label={isArabic ? "وقت الانصراف — الافتراضي AM" : "Checkout time — AM default"}>
                    <ManualTimeInput
                      hour={manualForm.checkOutHour}
                      minute={manualForm.checkOutMinute}
                      period={manualForm.checkOutPeriod}
                      periodDefault="AM"
                      isArabic={isArabic}
                      onChange={(change) => setManualForm((prev) => ({
                        ...prev,
                        checkOutHour: change.hour ?? prev.checkOutHour,
                        checkOutMinute: change.minute ?? prev.checkOutMinute,
                        checkOutPeriod: change.period ?? prev.checkOutPeriod,
                      }))}
                    />
                  </Field>
                </>
              ) : null}
              <div className="md:col-span-2"><Field label={isArabic ? "سبب الإضافة أو التصحيح" : "Correction reason"}><textarea value={manualForm.reason} onChange={(event) => setManualForm((prev) => ({ ...prev, reason: event.target.value }))} required rows={3} className="w-full rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm font-bold text-[var(--text)] outline-none focus:border-emerald-500" placeholder={isArabic ? "مثال: تعذر تسجيل الانصراف من بوابة الموظف" : "Example: employee portal checkout failed"} /></Field></div>
            </div>
            {manualError ? <div className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm font-bold text-rose-300">{manualError}</div> : null}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" disabled={manualSaving} onClick={() => setManualOpen(false)} className="h-[var(--control-height-lg)] rounded-[var(--radius-control)] border border-[var(--border)] px-5 text-sm font-black text-[var(--muted)]">{isArabic ? "إلغاء" : "Cancel"}</button>
              <button type="submit" disabled={manualSaving} className="h-[var(--control-height-lg)] rounded-[var(--radius-control)] bg-primary px-6 text-sm font-black text-[var(--primary-contrast)] disabled:opacity-60">{manualSaving ? (isArabic ? "جارٍ الحفظ..." : "Saving...") : (isArabic ? "حفظ التصحيح" : "Save correction")}</button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}

function OpeningSchedulePanel({ rows = [], isArabic, onGenerate, canGenerate }) {
  const title = isArabic ? "فاتح الفرع القادم" : "Upcoming opening shifts";
  const subtitle = isArabic ? "أقرب موظفين محددين لفتح الفروع من إغلاق نقطة البيع أو جدول الشيفتات." : "Nearest employees assigned to open branches from POS shift closing or schedules.";
  const empty = isArabic ? "لا توجد شيفتات فتح فرع محددة حاليًا." : "No opening shifts are scheduled yet.";
  const dateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

  return (
    <section className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-300">{isArabic ? "تنبيه تشغيل" : "Operations alert"}</p>
          <h3 className="m1-section-title mt-1 text-[var(--text)]">{title}</h3>
          <p className="mt-1 text-sm text-[var(--muted)]">{subtitle}</p>
        </div>
        <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-xs font-black text-emerald-300">
          {rows.length} {isArabic ? "شيفت" : "shifts"}
        </span>
        <button
          type="button"
          onClick={onGenerate}
          className="rounded-full border border-emerald-400/30 bg-primary px-3 py-1.5 text-xs font-black text-black disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!canGenerate}
          title={canGenerate ? "" : (isArabic ? "اختر الفرع أولًا" : "Select branch first")}
        >
          {isArabic ? "توليد للفترة" : "Generate range"}
        </button>
      </div>
      {rows.length ? (
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((row) => {
            const workDate = safeDate(row.work_date);
            return (
              <article key={row.id || `${row.employee_id}-${row.work_date}-${row.branch_id}`} className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-base font-black text-[var(--text)]">{row.employee_name || row.full_name || (isArabic ? "موظف غير محدد" : "Unassigned employee")}</p>
                    <p className="mt-1 text-sm font-bold text-[var(--muted)]">{row.branch_name || row.branch || (isArabic ? "بدون فرع" : "No branch")}</p>
                  </div>
                  <CalendarDays className="h-5 w-5 text-emerald-300" />
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-xs font-black">
                  <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-emerald-300">{workDate ? dateFormatter.format(workDate) : row.work_date || "-"}</span>
                  <span className="rounded-full bg-[var(--surface)] px-2.5 py-1 text-[var(--text)]">{row.start_time || "--:--"} → {row.end_time || "--:--"}</span>
                </div>
                {row.assigned_by_name ? <p className="mt-2 text-xs font-bold text-[var(--muted)]">{isArabic ? "تم التحديد بواسطة: " : "Assigned by: "}{row.assigned_by_name}</p> : null}
              </article>
            );
          })}
        </div>
      ) : (
        <div className="mt-4 rounded-[var(--radius-card)] border border-dashed border-[var(--border)] bg-[var(--surface)] p-4 text-sm font-bold text-[var(--muted)]">{empty}</div>
      )}
    </section>
  );
}

function ChartPanel({ title, data, xKey = "date", type = "line", lines = [], bars = [] }) {
  return (
    <section className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] p-4">
      <h3 className="m1-section-title text-[var(--text)]">{title}</h3>
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

function AttendanceTable({ rows, text, dense, onSelect, isArabic }) {
  const headers = [text.columns.employee, text.columns.branch, text.columns.date, text.columns.checkIn, text.columns.checkOut, text.columns.workedHours, text.columns.status, text.columns.lateDuration, text.columns.missingHours, text.columns.overtime, text.columns.source, text.columns.payrollImpact, text.columns.notes];
  const groupedRows = useMemo(() => {
    const groups = new Map();
    rows.forEach((row) => {
      const key = String(row.attendance_date || "-").slice(0, 10);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    });
    return [...groups.entries()].sort(([a], [b]) => b.localeCompare(a));
  }, [rows]);
  const totals = useMemo(() => rows.reduce((result, row) => {
    const hasCheckIn = Boolean(row.check_in_time);
    result.present += hasCheckIn ? 1 : 0;
    result.absent += row.status === "absent" ? 1 : 0;
    result.workedHours += numberValue(row.worked_hours);
    result.lateMinutes += numberValue(row.late_minutes);
    result.missingHours += numberValue(row.missing_hours);
    result.overtimeHours += numberValue(row.overtime_hours);
    result.payrollImpact += numberValue(row.payroll_impact);
    return result;
  }, { present: 0, absent: 0, workedHours: 0, lateMinutes: 0, missingHours: 0, overtimeHours: 0, payrollImpact: 0 }), [rows]);
  const renderRows = (sourceRows) => sourceRows.map((row) => (
    <tr key={`${row.employee_id}-${row.attendance_date}-${row.status}`} onClick={() => onSelect(row)} className="cursor-pointer hover:bg-[var(--surface)]">
      <td className={`px-3 ${dense ? "py-2" : "py-4"}`}><div className="table-cell-stack"><div className="font-black text-[var(--text)]">{row.employee_name}</div><div className="text-xs text-[var(--muted)]">{row.employee_code}</div></div></td>
      <td className="px-3 py-2">{row.branch_name || "-"}</td>
      <td className="px-3 py-2" dir="ltr">{formatDayFirstDate(String(row.attendance_date || "").slice(0, 10)) || row.attendance_date}</td>
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
  ));
  return (
    <section className="space-y-3">
      {groupedRows.length ? groupedRows.map(([date, dateRows]) => (
        <div key={date} className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)]">
          <div className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface)] px-4 py-3">
            <div className="inline-flex items-center gap-2 font-black text-[var(--text)]" dir="ltr"><CalendarDays className="h-4 w-4 text-[var(--primary)]" />{formatDayFirstDate(date) || date}</div>
            <span className="rounded-full bg-[var(--card)] px-3 py-1 text-xs font-black text-[var(--muted)]">{dateRows.length} {isArabic ? "موظف" : "employees"}</span>
          </div>
          <div className="overflow-auto">
            <table className="m1-table m1-table--compact min-w-[1280px] w-full text-sm">
              <thead className="bg-[var(--surface)] text-xs font-black text-[var(--muted)]"><tr>{headers.map((header) => <th key={header} className="px-3 py-3 text-start">{header}</th>)}</tr></thead>
              <tbody className="divide-[var(--border)]">{renderRows(dateRows)}</tbody>
            </table>
          </div>
        </div>
      )) : <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] p-8 text-center text-[var(--muted)]">{text.noRows}</div>}
      <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] p-4">
        <h3 className="m1-section-title mb-3 text-[var(--text)]">{isArabic ? "إجماليات النتائج الحالية" : "Current results totals"}</h3>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
          {[
            [isArabic ? "الحضور" : "Present", totals.present],
            [isArabic ? "الغياب" : "Absent", totals.absent],
            [isArabic ? "ساعات العمل" : "Worked hours", totals.workedHours.toFixed(2)],
            [isArabic ? "دقائق التأخير" : "Late minutes", Math.round(totals.lateMinutes)],
            [isArabic ? "ساعات النقص" : "Missing hours", totals.missingHours.toFixed(2)],
            [isArabic ? "الساعات الإضافية" : "Overtime", totals.overtimeHours.toFixed(2)],
            [isArabic ? "تأثير الرواتب" : "Payroll impact", formatMoney(totals.payrollImpact)],
          ].map(([label, value]) => <div key={label} className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-3"><div className="text-xs font-black text-[var(--muted)]">{label}</div><div className="mt-1 text-lg font-black text-[var(--text)]" dir="ltr">{value}</div></div>)}
        </div>
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
        <div key={row.id} className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] p-4">
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

function OvertimeApprovalsPanel({ rows = [], isArabic, onUpdate }) {
  const pendingRows = rows.filter((row) => String(row.status || "pending").toLowerCase() === "pending");
  const visibleRows = pendingRows.length ? pendingRows : rows.slice(0, 5);
  const statusTone = (status) => {
    const value = String(status || "pending").toLowerCase();
    if (value === "approved") return "text-emerald-300 bg-emerald-500/10 border-emerald-500/20";
    if (value === "rejected") return "text-rose-300 bg-rose-500/10 border-rose-500/20";
    return "text-amber-300 bg-amber-500/10 border-amber-500/20";
  };

  return (
    <section className="rounded-lg border border-primary/20 bg-primary/5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-primary">{isArabic ? "اعتماد المرتب" : "Payroll approval"}</p>
          <h3 className="m1-section-title mt-1 text-[var(--text)]">{isArabic ? "طلبات الأوفر تايم" : "Overtime approvals"}</h3>
          <p className="mt-1 text-sm text-[var(--muted)]">{isArabic ? "الأوفر تايم لا يدخل في المرتب إلا بعد الاعتماد." : "Overtime is included in payroll only after approval."}</p>
        </div>
        <span className="rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-black text-primary">
          {pendingRows.length} {isArabic ? "قيد المراجعة" : "pending"}
        </span>
      </div>
      {visibleRows.length ? (
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {visibleRows.map((row) => (
            <article key={row.id} className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-black text-[var(--text)]">{row.employee_name || row.employee_code || `#${row.employee_id}`}</p>
                  <p className="mt-1 text-xs font-bold text-[var(--muted)]">{row.branch_name || "-"} · {String(row.attendance_date || "").slice(0, 10)} · {Math.round(Number(row.overtime_minutes || 0))} min</p>
                </div>
                <span className={`rounded-full border px-2.5 py-1 text-xs font-black ${statusTone(row.status)}`}>{row.status || "pending"}</span>
              </div>
              {String(row.status || "pending").toLowerCase() === "pending" ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" onClick={() => onUpdate(row, "approved")} className="inline-flex h-[var(--control-height-md)] items-center gap-2 rounded-[var(--radius-control)] bg-primary px-3 text-xs font-black text-black">
                    <CheckCircle2 className="h-4 w-4" />{isArabic ? "اعتماد" : "Approve"}
                  </button>
                  <button type="button" onClick={() => onUpdate(row, "rejected")} className="inline-flex h-[var(--control-height-md)] items-center gap-2 rounded-[var(--radius-control)] bg-rose-500 px-3 text-xs font-black text-white">
                    <XCircle className="h-4 w-4" />{isArabic ? "رفض" : "Reject"}
                  </button>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      ) : (
        <div className="mt-4 rounded-[var(--radius-card)] border border-dashed border-[var(--border)] bg-[var(--surface)] p-4 text-sm font-bold text-[var(--muted)]">
          {isArabic ? "لا توجد طلبات أوفر تايم حاليًا." : "No overtime requests yet."}
        </div>
      )}
    </section>
  );
}

function PayrollImpact({ rows, text, onSelect }) {
  return (
    <section className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)]">
      <div className="overflow-auto">
        <table className="m1-table m1-table--compact min-w-[1360px] w-full text-sm">
          <thead className="bg-[var(--surface)] text-xs font-black text-[var(--muted)]">
            <tr>{[text.columns.employee, text.columns.presentDays, text.columns.absenceDays, text.columns.missingHours, text.columns.lateCount, text.columns.paidLeaves, text.columns.deductedLeaves, text.columns.leaveDeduction, text.columns.approvedOvertime, text.columns.overtimePay, text.columns.deduction, text.columns.penalties, text.columns.netImpact].map((header) => <th key={header} className="px-3 py-3 text-start">{header}</th>)}</tr>
          </thead>
          <tbody className="divide-[var(--border)]">
            {rows.map((row) => (
              <tr key={row.employee_id} className="cursor-pointer hover:bg-[var(--surface)]" onClick={() => onSelect(row)}>
                <td className="px-3 py-3"><div className="table-cell-stack"><div className="font-black text-[var(--text)]">{row.employee_name}</div><div className="text-xs text-[var(--muted)]">{row.explanation}</div></div></td>
                <td className="px-3 py-3" dir="ltr">{row.present_days}</td>
                <td className="px-3 py-3" dir="ltr">{row.absence_days}</td>
                <td className="px-3 py-3" dir="ltr">{row.missing_hours}</td>
                <td className="px-3 py-3" dir="ltr">{row.late_count}</td>
                <td className="px-3 py-3 font-black text-emerald-400" dir="ltr">{row.paid_leave_days || 0}/{row.monthly_paid_leave_days || 3}</td>
                <td className="px-3 py-3 font-black text-amber-300" dir="ltr">{row.deducted_leave_days || 0}</td>
                <td className="px-3 py-3 font-black text-rose-400" dir="ltr">{formatMoney(row.leave_deduction)}</td>
                <td className="px-3 py-3 font-black text-primary" dir="ltr">{row.approved_overtime_hours || 0}</td>
                <td className="px-3 py-3 font-black text-emerald-400" dir="ltr">{formatMoney(row.approved_overtime_pay)}</td>
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
          <div><h3 className="m1-section-title text-[var(--text)]">{text.tabs[9]}</h3><p className="mt-1 text-sm text-[var(--muted)]" dir="ltr">{payload?.generated_at || ""}</p></div>
          <button type="button" onClick={() => onExport("attendance-report", rows)} className="inline-flex h-[var(--control-height-md)] items-center gap-2 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-black text-[var(--text)]"><Download className="h-4 w-4" />{text.excel}</button>
        </div>
      </div>
    </section>
  );
}

function SimpleTable({ headers, rows, empty }) {
  return (
    <section className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)]">
      <div className="overflow-auto">
        <table className="m1-table m1-table--compact min-w-[900px] w-full text-sm">
          <thead className="bg-[var(--surface)] text-xs font-black text-[var(--muted)]"><tr>{headers.map((header) => <th key={header} className="px-3 py-3 text-start">{header}</th>)}</tr></thead>
          <tbody className="divide-[var(--border)]">
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
          <div><h3 className="m1-section-title text-[var(--text)]">{text.details}</h3><p className="mt-1 text-sm text-[var(--muted)]">{row.employee_name}</p></div>
          <button type="button" onClick={onClose} className="rounded-[var(--radius-control)] border border-[var(--border)] px-3 py-2 text-sm font-black text-[var(--text)]">{text.close}</button>
        </div>
        <div className="mt-5 grid gap-3">
          {Object.entries(row).map(([key, value]) => (
            <div key={key} className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-3">
              <div className="text-xs font-black uppercase text-[var(--muted)]">{key}</div>
              <div className="mt-1 break-words text-sm font-semibold text-[var(--text)]" dir={typeof value === "number" ? "ltr" : undefined}>{String(value ?? "-")}</div>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}
