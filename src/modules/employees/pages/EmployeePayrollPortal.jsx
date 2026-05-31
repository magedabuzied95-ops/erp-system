import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowDownCircle,
  ArrowUpCircle,
  Banknote,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Coins,
  CreditCard,
  Download,
  FileText,
  Gift,
  Home,
  Loader2,
  LockKeyhole,
  MessageCircle,
  Play,
  QrCode,
  RefreshCw,
  ReceiptText,
  ShieldCheck,
  Smartphone,
  Star,
  Target,
  Trophy,
  UserRound,
  WalletCards,
} from "lucide-react";

import { api } from "../../../shared/api/api";
import { formatCurrency } from "../../../shared/lib/currency";
import { logPagePerf } from "../../../shared/lib/perfDebug";

const labels = {
  ar: {
    title: "محفظة الموظف",
    subtitle: "ادخل رقم الهاتف أو كود الموظف لعرض المرتب والمحفظة بأمان.",
    unlock: "فتح المحفظة",
    secret: "رقم الهاتف أو كود الموظف",
    secretPlaceholder: "مثال: 010... أو EMP-001",
    secretHelp: "استخدم رقم الهاتف المسجل في النظام أو كود الموظف",
    secure: "الأرقام مخفية حتى يتم التحقق",
    netSalary: "صافي المرتب",
    totalAdvances: "إجمالي السلف",
    pendingCommissions: "عمولات معلقة",
    totalDeductions: "إجمالي الخصومات",
    payrollStatus: "حالة المرتب",
    baseSalary: "المرتب الأساسي",
    commission: "العمولة",
    bonuses: "المكافآت",
    advances: "السلف",
    deductions: "الخصومات",
    absenceDeductions: "خصم الغياب",
    penalties: "الجزاءات",
    otherDeductions: "خصومات أخرى",
    attendanceDays: "أيام الحضور",
    payrollPeriod: "فترة المرتب",
    paymentStatus: "حالة الصرف",
    generated: "تم إنشاء المرتب",
    notGenerated: "لم يتم إنشاء المرتب بعد",
    pendingPayment: "في انتظار الصرف",
    emptyTitle: "لا يوجد مرتب حتى الآن",
    emptyBody: "سيظهر كشف المرتب والمعاملات بعد إنشاء أو اعتماد المرتب من الإدارة.",
    timeline: "حركة المحفظة",
    noTransactions: "لا توجد معاملات حديثة.",
    attendanceImpact: "تأثير الحضور",
    expectedDays: "الأيام المتوقعة",
    absenceDays: "أيام الغياب",
    missingHours: "ساعات ناقصة",
    downloadPayslip: "تحميل كشف المرتب",
    shareWhatsapp: "مشاركة واتساب",
    addHome: "إضافة للشاشة الرئيسية",
    installHint: "افتح من المتصفح ثم اختر إضافة إلى الشاشة الرئيسية.",
    retry: "إعادة المحاولة",
    invalid: "تعذر فتح المحفظة. تأكد من الرابط أو بيانات التحقق.",
    loading: "جار التحميل...",
    language: "English",
    employeeCode: "كود الموظف",
    branch: "الفرع",
    jobTitle: "الوظيفة",
    transactionTypes: {
      advance: "سلفة",
      penalty: "جزاء",
      bonus: "مكافأة",
      commission: "عمولة",
      salary_approval: "اعتماد المرتب",
      attendance_deduction: "خصم حضور",
    },
  },
  en: {
    title: "Employee Wallet",
    subtitle: "Enter your phone number or employee code to securely view payroll and wallet.",
    unlock: "Unlock wallet",
    secret: "Phone number or employee code",
    secretPlaceholder: "Example: 010... or EMP-001",
    secretHelp: "Use the phone number registered in the system or the employee code",
    secure: "Numbers stay hidden until verification succeeds",
    netSalary: "Net salary",
    totalAdvances: "Total advances",
    pendingCommissions: "Pending commissions",
    totalDeductions: "Total deductions",
    payrollStatus: "Payroll status",
    baseSalary: "Base salary",
    commission: "Commission",
    bonuses: "Bonuses",
    advances: "Advances",
    deductions: "Deductions",
    absenceDeductions: "Absence deductions",
    penalties: "Penalties",
    otherDeductions: "Other deductions",
    attendanceDays: "Attendance days",
    payrollPeriod: "Payroll period",
    paymentStatus: "Payment status",
    generated: "Payroll generated",
    notGenerated: "Payroll not generated",
    pendingPayment: "Pending payment",
    emptyTitle: "No payroll yet",
    emptyBody: "Payslip and wallet transactions will appear after management generates or approves payroll.",
    timeline: "Wallet timeline",
    noTransactions: "No recent transactions.",
    attendanceImpact: "Attendance impact",
    expectedDays: "Expected days",
    absenceDays: "Absence days",
    missingHours: "Missing hours",
    downloadPayslip: "Download payslip",
    shareWhatsapp: "WhatsApp share",
    addHome: "Add to Home Screen",
    installHint: "Open from your browser menu and choose Add to Home Screen.",
    retry: "Try again",
    invalid: "Unable to unlock the wallet. Check the link or verification details.",
    loading: "Loading...",
    language: "العربية",
    employeeCode: "Employee code",
    branch: "Branch",
    jobTitle: "Job title",
    transactionTypes: {
      advance: "Advance",
      penalty: "Penalty",
      bonus: "Bonus",
      commission: "Commission",
      salary_approval: "Salary approval",
      attendance_deduction: "Attendance deduction",
    },
  },
};

Object.assign(labels.ar, {
  walletTab: "المحفظة",
  attendanceTab: "الحضور",
  tasksTab: "المهام",
  requestsTab: "الطلبات",
  performanceTab: "الأداء",
  tasks: "مهامي",
  noTasks: "لا توجد مهام مطلوبة الآن.",
  startTask: "بدء",
  completeTask: "تم التنفيذ",
  taskUpdated: "تم تحديث المهمة",
  attendanceSummary: "ملخص حضور الشهر",
  attendanceTimeline: "حركة الحضور اليومية",
  presentDays: "أيام الحضور",
  absentDays: "أيام الغياب",
  lateDays: "أيام التأخير",
  overtimeHours: "ساعات إضافية",
  deductedAbsenceAmount: "خصم الغياب",
  checkIn: "حضور",
  checkOut: "انصراف",
  shift: "الشيفت",
  dailyStatus: "الحالة",
  lateMinutes: "دقائق التأخير",
  notes: "ملاحظات",
  noAttendance: "لا توجد سجلات حضور لهذا الشهر.",
  myQrAttendance: "حضوري بالـ QR",
  branchToken: "كود أو رمز QR الفرع",
  branchTokenPlaceholder: "امسح QR أو أدخل كود الفرع",
  attendanceSaved: "تم تسجيل الحضور",
  checkoutSaved: "تم تسجيل الانصراف",
  attendanceError: "تعذر تسجيل الحضور",
  outsideBranchRadius: "أنت خارج نطاق الفرع",
  locationRequired: "يجب السماح بالموقع",
  requests: "طلبات الموظف",
  requestVacation: "طلب إجازة",
  requestAdvance: "طلب سلفة",
  sendHrNote: "رسالة للموارد البشرية",
  requestType: "نوع الطلب",
  amount: "المبلغ",
  requestDate: "تاريخ الطلب",
  endDate: "تاريخ النهاية",
  message: "الرسالة",
  sendRequest: "إرسال الطلب",
  requestSent: "تم إرسال الطلب",
  noRequests: "لا توجد طلبات حتى الآن.",
  requestHistory: "تنبيهات وسجل الطلبات",
  adminNote: "رد الإدارة",
  pending: "قيد المراجعة",
  approved: "مقبول",
  rejected: "مرفوض",
});

Object.assign(labels.en, {
  walletTab: "Wallet",
  attendanceTab: "Attendance",
  tasksTab: "Tasks",
  requestsTab: "Requests",
  performanceTab: "Performance",
  tasks: "My tasks",
  noTasks: "No tasks are due right now.",
  startTask: "Start",
  completeTask: "Complete",
  taskUpdated: "Task updated",
  attendanceSummary: "Current month attendance",
  attendanceTimeline: "Daily attendance timeline",
  presentDays: "Present days",
  absentDays: "Absent days",
  lateDays: "Late days",
  overtimeHours: "Overtime hours",
  deductedAbsenceAmount: "Deducted absence amount",
  checkIn: "Check in",
  checkOut: "Check out",
  shift: "Shift",
  dailyStatus: "Status",
  lateMinutes: "Late minutes",
  notes: "Notes",
  noAttendance: "No attendance records for this month.",
  myQrAttendance: "My QR Attendance",
  branchToken: "Branch QR/token",
  branchTokenPlaceholder: "Scan QR or enter branch code",
  attendanceSaved: "Attendance recorded",
  checkoutSaved: "Check-out recorded",
  attendanceError: "Unable to record attendance",
  outsideBranchRadius: "You are outside the branch radius",
  locationRequired: "Location permission is required",
  requests: "Employee requests",
  requestVacation: "Request vacation",
  requestAdvance: "Request advance",
  sendHrNote: "Send HR note",
  requestType: "Request type",
  amount: "Amount",
  requestDate: "Request date",
  endDate: "End date",
  message: "Message",
  sendRequest: "Send request",
  requestSent: "Request sent",
  noRequests: "No requests yet.",
  requestHistory: "Notifications and request history",
  adminNote: "Admin note",
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
});

Object.assign(labels.ar, {
  performance: "الأداء والنقاط",
  overallScore: "نقاط الأداء",
  attendanceScore: "الحضور",
  salesScore: "المبيعات",
  punctualityScore: "الالتزام",
  serviceScore: "خدمة العملاء",
  penaltiesImpact: "تأثير الجزاءات",
  rewardPoints: "نقاط المكافآت",
  achievements: "الشارات",
  goals: "الأهداف",
  leaderboard: "ترتيب الشهر",
  monthlySalesTarget: "هدف المبيعات",
  attendanceTarget: "هدف الحضور",
  branchKpi: "مؤشر الفرع",
  noBadges: "لم تحصل على شارات بعد.",
});

Object.assign(labels.en, {
  performance: "Performance and points",
  overallScore: "Performance score",
  attendanceScore: "Attendance",
  salesScore: "Sales",
  punctualityScore: "Punctuality",
  serviceScore: "Customer service",
  penaltiesImpact: "Penalties impact",
  rewardPoints: "Reward points",
  achievements: "Achievements",
  goals: "Goals",
  leaderboard: "Monthly ranking",
  monthlySalesTarget: "Sales target",
  attendanceTarget: "Attendance target",
  branchKpi: "Branch KPI",
  noBadges: "No badges yet.",
});

const money = (value) => {
  if (value === null || value === undefined || value === "") return "-";
  return formatCurrency(Number(value || 0));
};

const safeArray = (value) => (Array.isArray(value) ? value : []);

const safeNow = () => {
  try {
    return typeof window !== "undefined" && window.performance && typeof window.performance.now === "function"
      ? window.performance.now()
      : Date.now();
  } catch {
    return Date.now();
  }
};

const localeForLanguage = (language = "en") => (language === "ar" ? "ar-EG-u-nu-latn" : "en-US");

const browserTimeZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Africa/Cairo";
  } catch {
    return "Africa/Cairo";
  }
};

const parseSafeDate = (value) => {
  if (!value || value === "-") return null;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    const dateOnly = new Date(year, month - 1, day);
    return Number.isFinite(dateOnly.getTime()) ? dateOnly : null;
  }
  try {
    const date = value instanceof Date ? value : new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
  } catch {
    return null;
  }
};

const formatDateTimeLocal = (value, language = "en", fallback = "-") => {
  const date = parseSafeDate(value);
  if (!date) return fallback;
  const locale = localeForLanguage(language);
  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: browserTimeZone(),
    }).format(date);
  } catch {
    try {
      return new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Africa/Cairo",
      }).format(date);
    } catch {
      return fallback;
    }
  }
};

const formatDateLocal = (value, language = "en", fallback = "-") => {
  const date = parseSafeDate(value);
  if (!date) return fallback;
  try {
    return new Intl.DateTimeFormat(localeForLanguage(language), {
      dateStyle: "medium",
      timeZone: browserTimeZone(),
    }).format(date);
  } catch {
    try {
      return new Intl.DateTimeFormat(localeForLanguage(language), {
        dateStyle: "medium",
        timeZone: "Africa/Cairo",
      }).format(date);
    } catch {
      return fallback;
    }
  }
};

const formatTimeLocal = (value, language = "en", fallback = "-") => {
  const date = parseSafeDate(value);
  if (!date) return fallback;
  try {
    return new Intl.DateTimeFormat(localeForLanguage(language), {
      timeStyle: "short",
      timeZone: browserTimeZone(),
    }).format(date);
  } catch {
    try {
      return new Intl.DateTimeFormat(localeForLanguage(language), {
        timeStyle: "short",
        timeZone: "Africa/Cairo",
      }).format(date);
    } catch {
      return fallback;
    }
  }
};

const formatShiftTimeLocal = (value, language = "en", fallback = "-") => {
  const text = String(value || "").trim();
  if (!text || text === "-") return fallback;
  if (text.match(/^\d{1,2}:\d{2}/)) {
    return formatTimeLocal(`2000-01-01T${text.slice(0, 5)}:00`, language, fallback);
  }
  return formatTimeLocal(text, language, fallback);
};

const shiftNameLocal = (name = "", language = "en") => {
  const text = String(name || "").trim();
  if (!text) return "";
  if (language !== "ar") return text;
  const lower = text.toLowerCase();
  if (lower.includes("closing") || lower.includes("close")) return "قفل";
  if (lower.includes("opening") || lower.includes("open")) return "فتح";
  return text;
};

const formatShiftLabelLocal = (row = {}, language = "en", fallback = "-") => {
  const start = formatShiftTimeLocal(row.resolved_shift_start_time, language, "");
  const end = formatShiftTimeLocal(row.resolved_shift_end_time, language, "");
  const name = shiftNameLocal(row.shift_name || row.shift || "", language);
  const timeRange = start && end ? `${start} - ${end}` : start || end || "";
  return [name, timeRange].filter(Boolean).join(" ") || fallback;
};

const formatIsoDateLocal = (value, language = "en", fallback = "-") => {
  const date = parseSafeDate(value);
  if (!date) return fallback;
  try {
    const parts = new Intl.DateTimeFormat(localeForLanguage(language), {
      timeZone: browserTimeZone(),
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const part = (type) => parts.find((item) => item.type === type)?.value || "";
    return `${part("year")}-${part("month")}-${part("day")}`;
  } catch {
    try {
      const parts = new Intl.DateTimeFormat(localeForLanguage(language), {
      timeZone: "Africa/Cairo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
      const part = (type) => parts.find((item) => item.type === type)?.value || "";
      return `${part("year")}-${part("month")}-${part("day")}`;
    } catch {
      return fallback;
    }
  }
};

const attendanceLocalDate = (row, language = "en") => {
  const source = row?.attendance_date || row?.date || row?.check_in || row?.check_out;
  return formatIsoDateLocal(source, language);
};

const statusLabel = (status, text) => {
  if (status === "pending_payment") return text.pendingPayment;
  if (status === "not_generated") return text.notGenerated;
  return text.generated;
};

const getBrowserLocation = () =>
  new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new Error("GPS is not available on this device"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
      }),
      reject,
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
    );
  });

const transactionIcon = (type) => {
  if (type === "advance") return CreditCard;
  if (type === "penalty") return AlertTriangle;
  if (type === "bonus") return Gift;
  if (type === "commission") return Coins;
  if (type === "salary_approval") return CheckCircle2;
  if (type === "attendance_deduction") return CalendarDays;
  return ReceiptText;
};

function MetricCard({ label, value, icon: Icon, tone = "slate" }) {
  const tones = {
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-950",
    amber: "border-amber-200 bg-amber-50 text-amber-950",
    red: "border-red-200 bg-red-50 text-red-950",
    sky: "border-sky-200 bg-sky-50 text-sky-950",
    slate: "border-slate-200 bg-white text-slate-950",
  };
  return (
    <article className={`rounded-2xl border p-4 shadow-sm ${tones[tone] || tones.slate}`}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-black leading-6">{label}</span>
        <Icon className="h-5 w-5 opacity-75" />
      </div>
      <div className="mt-3 text-2xl font-black tabular-nums" dir="ltr">{value}</div>
    </article>
  );
}

function ProgressRow({ label, value, detail }) {
  const pct = Math.max(0, Math.min(100, Number(value || 0)));
  return (
    <div>
      <div className="flex items-center justify-between gap-3 text-xs font-black text-slate-600">
        <span>{label}</span>
        <span dir="ltr">{Math.round(pct)}%</span>
      </div>
      <div className="mt-1 h-2 rounded-full bg-slate-200">
        <div className="h-2 rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
      </div>
      {detail ? <div className="mt-1 text-xs font-bold text-slate-400" dir="auto">{detail}</div> : null}
    </div>
  );
}

function TimelineItem({ item, text, language }) {
  const Icon = transactionIcon(item.type);
  const credit = item.direction === "credit";
  return (
    <div className="grid grid-cols-[auto_1fr_auto] gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className={`mt-1 flex h-9 w-9 items-center justify-center rounded-xl ${credit ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <div className="text-sm font-black text-slate-950">{text.transactionTypes[item.type] || item.label || item.type}</div>
        <div className="mt-1 truncate text-xs font-bold text-slate-500" dir="auto">{item.description || item.status || "-"}</div>
        <div className="mt-1 text-xs font-bold text-slate-400" dir="ltr">{formatDateTimeLocal(item.date, language)}</div>
      </div>
      <div className={`whitespace-nowrap text-sm font-black tabular-nums ${credit ? "text-emerald-700" : "text-red-700"}`} dir="ltr">
        {credit ? "+" : "-"} {money(item.amount)}
      </div>
    </div>
  );
}

export default function EmployeePayrollPortal() {
  const { token } = useParams();
  const [language, setLanguage] = useState(() => (navigator.language || "").toLowerCase().startsWith("ar") ? "ar" : "en");
  const [verification, setVerification] = useState("");
  const [portal, setPortal] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [installPrompt, setInstallPrompt] = useState(null);
  const [branchToken, setBranchToken] = useState("");
  const [attendanceSaving, setAttendanceSaving] = useState("");
  const [requestType, setRequestType] = useState("vacation");
  const [requestAmount, setRequestAmount] = useState("");
  const [requestDate, setRequestDate] = useState("");
  const [requestEndDate, setRequestEndDate] = useState("");
  const [requestMessage, setRequestMessage] = useState("");
  const [requestSaving, setRequestSaving] = useState(false);
  const [activeTab, setActiveTab] = useState("wallet");
  const [taskSavingId, setTaskSavingId] = useState("");
  const [portalNotice, setPortalNotice] = useState("");
  const [optionalLoading, setOptionalLoading] = useState(false);
  const [optionalLoaded, setOptionalLoaded] = useState(false);
  const text = labels[language];
  const isRtl = language === "ar";
  const direction = isRtl ? "rtl" : "ltr";

  useEffect(() => {
    const onBeforeInstall = (event) => {
      event.preventDefault();
      setInstallPrompt(event);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    return () => window.removeEventListener("beforeinstallprompt", onBeforeInstall);
  }, []);

  const wallet = portal?.wallet_summary || {};
  const profile = portal?.employee_profile || portal?.employee || {};
  const attendance = portal?.attendance?.summary || portal?.recent_attendance_summary || {};
  const attendanceRows = safeArray(portal?.attendance?.timeline);
  const employeeRequests = safeArray(portal?.employee_requests);
  const tasks = safeArray(portal?.tasks);
  const mobileTabs = [
    ["wallet", text.walletTab, WalletCards],
    ["attendance", text.attendanceTab, CalendarDays],
    ["tasks", text.tasksTab, ClipboardList],
    ["requests", text.requestsTab, MessageCircle],
    ["performance", text.performanceTab, Star],
  ];
  const performanceData = portal?.performance || {};
  const score = performanceData.score || {};
  const goals = performanceData.goals || {};
  const rewardPoints = performanceData.reward_points || {};
  const badges = safeArray(performanceData.achievements || rewardPoints.badges);
  const leaderboard = safeArray(portal?.leaderboard);
  const walletTransactions = safeArray(portal?.recent_wallet_transactions);
  const lazyWarnings = safeArray(portal?.warnings);
  const leaderboardLazy = lazyWarnings.some((warning) => warning?.section === "leaderboard" && warning?.code === "lazy");

  const overviewCards = useMemo(() => {
    if (!portal) return [];
    return [
      { label: text.netSalary, value: portal.payroll_generated ? money(wallet.current_net_salary ?? portal.net_salary) : "-", icon: WalletCards, tone: "emerald" },
      { label: text.totalAdvances, value: money(wallet.total_advances ?? portal.advances), icon: CreditCard, tone: "amber" },
      { label: text.pendingCommissions, value: money(wallet.pending_commissions), icon: Coins, tone: "sky" },
      { label: text.totalDeductions, value: money(wallet.total_deductions ?? portal.total_deductions), icon: ReceiptText, tone: "red" },
    ];
  }, [portal, text, wallet]);

  const payslipCards = useMemo(() => {
    if (!portal) return [];
    return [
      { label: text.baseSalary, value: money(portal.base_salary), icon: Banknote },
      { label: text.commission, value: money(portal.sales_commission ?? portal.commissions), icon: Coins, tone: "sky" },
      { label: text.bonuses, value: money(portal.bonuses), icon: Gift, tone: "emerald" },
      { label: text.absenceDeductions, value: money(portal.absence_deduction), icon: CalendarDays, tone: "red" },
      { label: text.penalties, value: money(portal.penalties), icon: AlertTriangle, tone: "red" },
      { label: text.otherDeductions, value: money(portal.other_deductions), icon: ArrowDownCircle, tone: "amber" },
    ];
  }, [portal, text]);

  const unlock = async (event) => {
    event?.preventDefault?.();
    if (!verification.trim()) return;
    const startedAt = safeNow();
    try {
      setLoading(true);
      setError("");
      const location = await getBrowserLocation().catch(() => null);
      const response = await api.get(`/employee-portal/${encodeURIComponent(token)}`, {
        params: {
          verify: verification.trim(),
          latitude: location?.latitude,
          longitude: location?.longitude,
          accuracy: location?.accuracy,
          timezone: browserTimeZone(),
        },
        suppressErrorStatuses: [400, 429],
      });
      setPortal(response.portal || null);
      setOptionalLoaded(false);
      setPortalNotice("");
      logPagePerf("employee-wallet.unlock", startedAt, {
        payroll_generated: Boolean(response.portal?.payroll_generated),
        active_tab: activeTab,
      });
    } catch (err) {
      setPortal(null);
      setError(err?.responseBody?.message || err?.message || text.invalid);
      logPagePerf("employee-wallet.unlock", startedAt, {
        failed: true,
        status: err?.status || err?.responseBody?.status,
      });
    } finally {
      setLoading(false);
    }
  };

  const loadOptionalSections = async () => {
    if (!verification.trim() || optionalLoading || optionalLoaded) return;
    const startedAt = safeNow();
    try {
      setOptionalLoading(true);
      const response = await api.get(`/employee-portal/${encodeURIComponent(token)}`, {
        params: {
          verify: verification.trim(),
          include_optional: true,
          timezone: browserTimeZone(),
        },
      });
      setPortal(response.portal || null);
      setOptionalLoaded(true);
      logPagePerf("employee-wallet.optional-sections", startedAt, { active_tab: activeTab });
    } catch {
      setOptionalLoaded(true);
      logPagePerf("employee-wallet.optional-sections", startedAt, { active_tab: activeTab, failed: true });
    } finally {
      setOptionalLoading(false);
    }
  };

  useEffect(() => {
    if (portal && activeTab === "performance" && !optionalLoaded && !optionalLoading) {
      loadOptionalSections();
    }
  }, [portal, activeTab, optionalLoaded, optionalLoading]);

  const installApp = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice.catch(() => null);
    setInstallPrompt(null);
  };

  const downloadPayslip = () => {
    const p = portal?.payslip;
    if (!p) return;
    const rows = [
      [text.employeeCode, p.employee_code],
      [text.jobTitle, p.job_title || "-"],
      [text.branch, p.branch || "-"],
      [text.payrollPeriod, p.payroll_period],
      [text.baseSalary, money(p.base_salary)],
      [text.commission, money(p.commissions)],
      [text.bonuses, money(p.bonuses)],
      [text.advances, money(p.advances)],
      [text.penalties, money(p.penalties)],
      [text.absenceDeductions, money(p.absence_deduction)],
      [text.totalDeductions, money(p.total_deductions)],
      [text.netSalary, money(p.net_salary)],
    ];
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${text.title}</title></head><body dir="${direction}" style="font-family:Arial,sans-serif;line-height:1.7"><h1>${text.title}</h1><h2>${p.employee_name}</h2><table border="1" cellspacing="0" cellpadding="8">${rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join("")}</table></body></html>`;
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `payslip-${p.employee_code || "employee"}-${p.payroll_period || "current"}.html`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const shareWhatsapp = () => {
    const message = encodeURIComponent(`${text.title}\n${profile.name || ""}\n${window.location.href}`);
    window.open(`https://wa.me/?text=${message}`, "_blank", "noopener,noreferrer");
  };

  const submitAttendanceAction = async (actionType) => {
    if (!verification.trim()) return;
    const startedAt = safeNow();
    try {
      setAttendanceSaving(actionType);
      setPortalNotice("");
      const location = await getBrowserLocation();
      const response = await api.post(`/employee-portal/${encodeURIComponent(token)}/attendance/actions`, {
        identifier: verification.trim(),
        verification: verification.trim(),
        action: actionType,
        gps_lat: location.latitude,
        gps_lng: location.longitude,
        gps_accuracy: location.accuracy,
        timezone: browserTimeZone(),
        location,
      });
      if (response.portal) setPortal(response.portal);
      setPortalNotice(actionType === "check_out" ? text.checkoutSaved : text.attendanceSaved);
      logPagePerf("employee-wallet.attendance-action", startedAt, { action: actionType });
    } catch (err) {
      const code = err?.responseBody?.code;
      setPortalNotice(
        code === "outside_branch_radius"
          ? text.outsideBranchRadius
          : code === "location_required"
            ? text.locationRequired
            : err?.responseBody?.message_ar || err?.responseBody?.message || err?.message || text.attendanceError
      );
      logPagePerf("employee-wallet.attendance-action", startedAt, {
        action: actionType,
        failed: true,
        code,
      });
    } finally {
      setAttendanceSaving("");
    }
  };

  const submitRequest = async (event) => {
    event.preventDefault();
    if (!verification.trim()) return;
    const startedAt = safeNow();
    try {
      setRequestSaving(true);
      setPortalNotice("");
      const location = await getBrowserLocation().catch(() => null);
      const response = await api.post(`/employee-portal/${encodeURIComponent(token)}/requests`, {
        verification: verification.trim(),
        request_type: requestType,
        amount: requestType === "advance" ? requestAmount : undefined,
        request_date: requestDate || undefined,
        end_date: requestType === "vacation" ? requestEndDate || undefined : undefined,
        message: requestMessage,
        timezone: browserTimeZone(),
        location,
      });
      if (response.portal) setPortal(response.portal);
      setRequestAmount("");
      setRequestDate("");
      setRequestEndDate("");
      setRequestMessage("");
      setPortalNotice(text.requestSent);
      logPagePerf("employee-wallet.request-submit", startedAt, { request_type: requestType });
    } catch (err) {
      setPortalNotice(err?.responseBody?.message || err?.message || text.invalid);
      logPagePerf("employee-wallet.request-submit", startedAt, {
        request_type: requestType,
        failed: true,
      });
    } finally {
      setRequestSaving(false);
    }
  };

  const updateWalletTask = async (taskId, status) => {
    if (!verification.trim()) return;
    const startedAt = safeNow();
    try {
      setTaskSavingId(`${taskId}:${status}`);
      const location = await getBrowserLocation().catch(() => null);
      const response = await api.patch(`/employee-portal/${encodeURIComponent(token)}/tasks/${taskId}/status`, {
        verification: verification.trim(),
        status,
        timezone: browserTimeZone(),
        location,
      });
      if (response.portal) setPortal(response.portal);
      setPortalNotice(text.taskUpdated);
      logPagePerf("employee-wallet.task-update", startedAt, { status });
    } catch (err) {
      setPortalNotice(err?.responseBody?.message || err?.message || text.invalid);
      logPagePerf("employee-wallet.task-update", startedAt, { status, failed: true });
    } finally {
      setTaskSavingId("");
    }
  };

  return (
    <main dir={direction} className="min-h-[100dvh] bg-slate-100 px-3 py-4 pb-[calc(2rem+env(safe-area-inset-bottom))] text-slate-950">
      <div className="mx-auto max-w-md">
        <header className="rounded-3xl bg-slate-950 p-5 text-white shadow-xl shadow-slate-300">
          <div className="flex items-center justify-between gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10">
              <WalletCards className="h-6 w-6" />
            </div>
            <button
              type="button"
              onClick={() => setLanguage((current) => current === "ar" ? "en" : "ar")}
              className="rounded-xl border border-white/15 px-3 py-2 text-xs font-black text-white"
            >
              {text.language}
            </button>
          </div>
          <h1 className="mt-4 text-3xl font-black leading-10">{text.title}</h1>
          <p className="mt-2 text-sm font-semibold leading-6 text-slate-300">{text.subtitle}</p>
          <div className="mt-4 flex items-center gap-2 rounded-2xl bg-white/10 px-3 py-2 text-xs font-bold text-slate-200">
            <ShieldCheck className="h-4 w-4" />
            <span>{text.secure}</span>
          </div>
        </header>

        {!portal ? (
          <form onSubmit={unlock} className="mt-4 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
            <label className="block text-sm font-black text-slate-800" htmlFor="employee-secret">{text.secret}</label>
            <div className="mt-2 flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2">
              <LockKeyhole className="h-4 w-4 text-slate-500" />
              <input
                id="employee-secret"
                value={verification}
                onChange={(event) => setVerification(event.target.value)}
                placeholder={text.secretPlaceholder}
                className="min-h-11 flex-1 bg-transparent text-base font-bold outline-none"
                dir="auto"
                autoComplete="one-time-code"
              />
            </div>
            <p className="mt-2 text-xs font-bold leading-5 text-slate-500">{text.secretHelp}</p>
            {error ? <div className="mt-3 rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold leading-6 text-red-800">{error}</div> : null}
            <button type="submit" disabled={loading || !verification.trim()} className="mt-4 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-black text-white disabled:opacity-50">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <LockKeyhole className="h-4 w-4" />}
              {loading ? text.loading : text.unlock}
            </button>
          </form>
        ) : (
          <section className="mt-4 space-y-4">
            <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-start gap-3">
                <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-slate-950 text-lg font-black text-white">
                  {profile.photo_url ? <img src={profile.photo_url} alt="" className="h-full w-full object-cover" /> : profile.avatar_initials || <UserRound className="h-7 w-7" />}
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="text-2xl font-black leading-8" dir="auto">{profile.name}</h2>
                  <div className="mt-1 text-sm font-bold text-slate-500">{profile.job_title || "-"}</div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs font-black">
                    <div className="rounded-xl bg-slate-100 px-3 py-2">
                      <div className="text-slate-500">{text.employeeCode}</div>
                      <div className="mt-1 truncate" dir="auto">{profile.code || "-"}</div>
                    </div>
                    <div className="rounded-xl bg-slate-100 px-3 py-2">
                      <div className="text-slate-500">{text.branch}</div>
                      <div className="mt-1 truncate" dir="auto">{profile.branch || "-"}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={downloadPayslip} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-slate-950 px-3 text-sm font-black text-white">
                <Download className="h-4 w-4" />
                {text.downloadPayslip}
              </button>
              <button type="button" onClick={shareWhatsapp} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-3 text-sm font-black text-white">
                <MessageCircle className="h-4 w-4" />
                {text.shareWhatsapp}
              </button>
            </div>

            <button type="button" onClick={installApp} disabled={!installPrompt} className="flex w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 text-start text-sm font-bold text-slate-700 shadow-sm disabled:opacity-75">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-50 text-sky-700">
                {installPrompt ? <Home className="h-5 w-5" /> : <Smartphone className="h-5 w-5" />}
              </div>
              <div>
                <div className="font-black text-slate-950">{text.addHome}</div>
                <div className="mt-0.5 text-xs text-slate-500">{text.installHint}</div>
              </div>
            </button>

            <nav className="sticky top-2 z-10 grid grid-cols-5 gap-1 rounded-2xl border border-slate-200 bg-white/95 p-1 shadow-sm backdrop-blur">
              {mobileTabs.map(([key, label, Icon]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setActiveTab(key)}
                  className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl px-1 text-[10px] font-black ${activeTab === key ? "bg-slate-950 text-white" : "text-slate-500"}`}
                >
                  <Icon className="h-4 w-4" />
                  <span className="max-w-full truncate">{label}</span>
                </button>
              ))}
            </nav>

            {activeTab === "wallet" ? <div className="rounded-3xl bg-slate-950 p-4 text-white shadow-xl shadow-slate-300">
              <div className="text-xs font-black text-slate-300">{text.netSalary}</div>
              <div className="mt-2 text-4xl font-black tabular-nums" dir="ltr">{portal.payroll_generated ? money(wallet.current_net_salary ?? portal.net_salary) : "-"}</div>
              <div className="mt-4 grid grid-cols-2 gap-2 text-sm font-black">
                <div className="rounded-2xl bg-white/10 px-3 py-2">
                  <div className="text-xs text-slate-300">{text.payrollPeriod}</div>
                  <div className="mt-1 tabular-nums" dir="ltr">{portal.current_payroll_period}</div>
                </div>
                <div className="rounded-2xl bg-white/10 px-3 py-2">
                  <div className="text-xs text-slate-300">{text.payrollStatus}</div>
                  <div className="mt-1">{statusLabel(wallet.payroll_status || portal.payment_status, text)}</div>
                </div>
              </div>
            </div> : null}

            {activeTab === "wallet" && !portal.payroll_generated ? (
              <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-6 text-center shadow-sm">
                <FileText className="mx-auto h-8 w-8 text-slate-400" />
                <h2 className="mt-3 text-xl font-black">{text.emptyTitle}</h2>
                <p className="mt-2 text-sm font-semibold leading-6 text-slate-500">{text.emptyBody}</p>
              </div>
            ) : null}

            {activeTab === "performance" ? <div className="rounded-3xl border border-emerald-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-base font-black">{text.performance}</h3>
                  <div className="mt-1 text-xs font-bold text-slate-500">{text.rewardPoints}: <span dir="ltr">{rewardPoints.points_balance || 0}</span></div>
                </div>
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-600 text-xl font-black text-white" dir="ltr">
                  {score.overall || 0}
                </div>
              </div>
              <div className="mt-4 grid gap-3">
                <ProgressRow label={text.attendanceScore} value={score.attendance} />
                <ProgressRow label={text.salesScore} value={score.sales} />
                <ProgressRow label={text.punctualityScore} value={score.punctuality} />
                <ProgressRow label={text.serviceScore} value={score.customer_service} />
                <ProgressRow label={text.penaltiesImpact} value={score.penalties_impact} />
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs font-black">
                <div className="rounded-2xl bg-slate-50 p-2"><Target className="mx-auto h-4 w-4 text-slate-500" /><div className="mt-1">{text.monthlySalesTarget}</div><div dir="ltr">{money(goals.monthly_sales_target || 0)}</div></div>
                <div className="rounded-2xl bg-slate-50 p-2"><CalendarDays className="mx-auto h-4 w-4 text-slate-500" /><div className="mt-1">{text.attendanceTarget}</div><div dir="ltr">{goals.attendance_days || 0}/{goals.attendance_target_days || 0}</div></div>
                <div className="rounded-2xl bg-slate-50 p-2"><Star className="mx-auto h-4 w-4 text-slate-500" /><div className="mt-1">{text.branchKpi}</div><div dir="ltr">{Math.round(goals.branch_kpi_progress || 0)}%</div></div>
              </div>
              <div className="mt-4 grid gap-2">
                <h4 className="text-sm font-black">{text.achievements}</h4>
                {badges.length ? badges.map((badge) => (
                  <div key={`${badge.badge_code}-${badge.period}`} className="flex items-center justify-between rounded-2xl bg-amber-50 px-3 py-2 text-sm font-black text-amber-900">
                    <span className="inline-flex items-center gap-2"><Trophy className="h-4 w-4" />{badge.badge_label}</span>
                    <span dir="ltr">+{badge.points || 0}</span>
                  </div>
                )) : <div className="rounded-2xl border border-dashed border-slate-200 px-3 py-4 text-center text-sm font-bold text-slate-500">{text.noBadges}</div>}
              </div>
            </div> : null}

            {activeTab === "performance" ? <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
              <h3 className="text-base font-black">{text.leaderboard}</h3>
              <div className="mt-3 grid gap-2">
                {optionalLoading && leaderboardLazy ? (
                  <div className="flex items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-3 py-5 text-sm font-bold text-slate-500">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {text.loading}
                  </div>
                ) : leaderboard.length ? leaderboard.slice(0, 5).map((row) => (
                  <div key={row.employee_id} className={`grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-2xl px-3 py-2 text-sm font-black ${String(row.employee_id) === String(profile.id) ? "bg-emerald-50 text-emerald-900" : "bg-slate-50 text-slate-700"}`}>
                    <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-white" dir="ltr">#{row.rank}</span>
                    <span className="truncate" dir="auto">{row.employee_name}</span>
                    <span dir="ltr">{row.score}</span>
                  </div>
                )) : (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-3 py-5 text-center text-sm font-bold text-slate-500">{text.noTransactions}</div>
                )}
              </div>
            </div> : null}

            {activeTab === "wallet" ? <div className="grid gap-3">
              {overviewCards.map((card) => <MetricCard key={card.label} {...card} />)}
              {payslipCards.map((card) => <MetricCard key={card.label} {...card} />)}
            </div> : null}

            {activeTab === "attendance" ? <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
              <h3 className="text-base font-black">{text.attendanceSummary}</h3>
              <div className="mt-3 grid grid-cols-2 gap-2 text-sm font-bold">
                <div className="rounded-2xl bg-slate-50 p-3">
                  <div className="text-slate-500">{text.presentDays}</div>
                  <div className="mt-1 text-xl font-black tabular-nums">{attendance.attended_days || 0}</div>
                </div>
                <div className="rounded-2xl bg-slate-50 p-3">
                  <div className="text-slate-500">{text.absentDays}</div>
                  <div className="mt-1 text-xl font-black tabular-nums">{attendance.absence_days || 0}</div>
                </div>
                <div className="rounded-2xl bg-slate-50 p-3">
                  <div className="text-slate-500">{text.lateDays}</div>
                  <div className="mt-1 text-xl font-black tabular-nums">{attendance.late_days || 0}</div>
                </div>
                <div className="rounded-2xl bg-slate-50 p-3">
                  <div className="text-slate-500">{text.overtimeHours}</div>
                  <div className="mt-1 text-xl font-black tabular-nums">{attendance.overtime_hours || 0}</div>
                </div>
                <div className="rounded-2xl bg-slate-50 p-3">
                  <div className="text-slate-500">{text.expectedDays}</div>
                  <div className="mt-1 text-xl font-black tabular-nums">{attendance.expected_working_days || 0}</div>
                </div>
                <div className="rounded-2xl bg-red-50 p-3 text-red-950">
                  <div className="text-red-700">{text.deductedAbsenceAmount}</div>
                  <div className="mt-1 text-xl font-black tabular-nums" dir="ltr">{money(attendance.deducted_absence_amount || portal.absence_deduction || 0)}</div>
                </div>
              </div>
            </div> : null}

            {activeTab === "attendance" ? <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-base font-black">{text.attendanceTimeline}</h3>
                <CalendarDays className="h-5 w-5 text-slate-400" />
              </div>
              <div className="mt-3 grid gap-2">
                {attendanceRows.length ? attendanceRows.map((row) => (
                  <div key={`${row.date}-${row.check_in || ""}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm font-bold">
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-black tabular-nums" dir="ltr">{attendanceLocalDate(row, language)}</div>
                      <span className="rounded-full bg-white px-2.5 py-1 text-xs font-black text-slate-700">{row.status || "-"}</span>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-600">
                      <div className="col-span-2"><span className="font-black text-slate-950">{text.shift}: </span><span dir="auto">{formatShiftLabelLocal(row, language)}</span></div>
                      <div><span className="font-black text-slate-950">{text.checkIn}: </span><span dir="ltr">{formatTimeLocal(row.check_in, language)}</span></div>
                      <div><span className="font-black text-slate-950">{text.checkOut}: </span><span dir="ltr">{formatTimeLocal(row.check_out, language)}</span></div>
                      <div><span className="font-black text-slate-950">{text.lateMinutes}: </span><span dir="ltr">{row.late_minutes || 0}</span></div>
                      <div><span className="font-black text-slate-950">{text.overtimeHours}: </span><span dir="ltr">{row.overtime_hours || 0}</span></div>
                    </div>
                    {row.notes ? <div className="mt-2 text-xs leading-5 text-slate-500" dir="auto">{text.notes}: {row.notes}</div> : null}
                  </div>
                )) : (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-3 py-5 text-center text-sm font-bold text-slate-500">{text.noAttendance}</div>
                )}
              </div>
            </div> : null}

            {activeTab === "attendance" ? <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-950 text-white">
                  <QrCode className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-black">{text.myQrAttendance}</h3>
                  <p className="text-xs font-bold text-slate-500" dir="auto">{profile.branch || portal?.qr_attendance?.branch || "-"}</p>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button type="button" onClick={() => submitAttendanceAction("check_in")} disabled={!verification.trim() || attendanceSaving} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-3 text-sm font-black text-white disabled:opacity-50">
                  {attendanceSaving === "check_in" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  {text.checkIn}
                </button>
                <button type="button" onClick={() => submitAttendanceAction("check_out")} disabled={!verification.trim() || attendanceSaving} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-slate-950 px-3 text-sm font-black text-white disabled:opacity-50">
                  {attendanceSaving === "check_out" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarDays className="h-4 w-4" />}
                  {text.checkOut}
                </button>
              </div>
            </div> : null}

            {activeTab === "tasks" ? (
              <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
                <h3 className="text-base font-black">{text.tasks}</h3>
                <div className="mt-3 grid gap-2">
                  {tasks.length ? tasks.map((task) => (
                    <div key={task.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-black text-slate-950" dir="auto">{task.task_title_ar || task.title_ar || task.title}</div>
                          <div className="mt-1 text-xs font-bold text-slate-500" dir="auto">{task.task_description_ar || task.description_ar || task.description || task.notes || "-"}</div>
                        </div>
                        <span className="rounded-full bg-white px-2.5 py-1 text-xs font-black text-slate-700">{task.status}</span>
                      </div>
                      {["pending", "overdue", "reassigned"].includes(task.status) ? (
                        <button type="button" disabled={Boolean(taskSavingId)} onClick={() => updateWalletTask(task.id, "in_progress")} className="mt-3 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-3 text-sm font-black text-slate-800 disabled:opacity-50">
                          {taskSavingId === `${task.id}:in_progress` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                          {text.startTask}
                        </button>
                      ) : null}
                      {task.status === "in_progress" ? (
                        <button type="button" disabled={Boolean(taskSavingId)} onClick={() => updateWalletTask(task.id, "completed")} className="mt-3 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-3 text-sm font-black text-white disabled:opacity-50">
                          {taskSavingId === `${task.id}:completed` ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                          {text.completeTask}
                        </button>
                      ) : null}
                    </div>
                  )) : (
                    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-3 py-5 text-center text-sm font-bold text-slate-500">{text.noTasks}</div>
                  )}
                </div>
              </div>
            ) : null}

            {activeTab === "requests" ? <form onSubmit={submitRequest} className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
              <h3 className="text-base font-black">{text.requests}</h3>
              <div className="mt-3 grid grid-cols-3 gap-2">
                {[
                  ["vacation", text.requestVacation],
                  ["advance", text.requestAdvance],
                  ["hr_note", text.sendHrNote],
                ].map(([value, label]) => (
                  <button key={value} type="button" onClick={() => setRequestType(value)} className={`min-h-11 rounded-2xl px-2 text-xs font-black ${requestType === value ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-700"}`}>
                    {label}
                  </button>
                ))}
              </div>
              <div className="mt-3 grid gap-2">
                {requestType === "advance" ? (
                  <input value={requestAmount} onChange={(event) => setRequestAmount(event.target.value)} type="number" min="0" step="0.01" placeholder={text.amount} className="min-h-12 rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm font-bold outline-none" />
                ) : null}
                <div className="grid grid-cols-2 gap-2">
                  <input value={requestDate} onChange={(event) => setRequestDate(event.target.value)} type="date" aria-label={text.requestDate} className="min-h-12 rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm font-bold outline-none" />
                  {requestType === "vacation" ? (
                    <input value={requestEndDate} onChange={(event) => setRequestEndDate(event.target.value)} type="date" aria-label={text.endDate} className="min-h-12 rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm font-bold outline-none" />
                  ) : null}
                </div>
                <textarea value={requestMessage} onChange={(event) => setRequestMessage(event.target.value)} placeholder={text.message} className="min-h-24 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-bold outline-none" dir="auto" />
              </div>
              <button type="submit" disabled={requestSaving || (requestType === "advance" && !requestAmount)} className="mt-3 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 px-4 text-sm font-black text-white disabled:opacity-50">
                {requestSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />}
                {text.sendRequest}
              </button>
              {portalNotice ? <div className="mt-3 rounded-2xl bg-slate-100 px-3 py-2 text-sm font-bold leading-6 text-slate-700" dir="auto">{portalNotice}</div> : null}
              <h4 className="mt-4 text-sm font-black text-slate-700">{text.requestHistory}</h4>
              <div className="mt-3 grid gap-2">
                {employeeRequests.length ? employeeRequests.map((item) => (
                  <div key={item.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm font-bold">
                    <div className="flex items-center justify-between gap-3">
                      <span>{item.request_type === "advance" ? text.requestAdvance : item.request_type === "hr_note" ? text.sendHrNote : text.requestVacation}</span>
                      <span className={`rounded-full px-2.5 py-1 text-xs font-black ${item.status === "approved" ? "bg-emerald-100 text-emerald-800" : item.status === "rejected" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"}`}>
                        {text[item.status] || item.status}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-slate-500" dir="auto">{item.message || "-"}</div>
                    {item.amount ? <div className="mt-1 text-xs font-black text-slate-600" dir="ltr">{money(item.amount)}</div> : null}
                    {item.admin_note ? <div className="mt-2 rounded-xl bg-white px-3 py-2 text-xs leading-5 text-slate-700" dir="auto">{text.adminNote}: {item.admin_note}</div> : null}
                  </div>
                )) : (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-center text-sm font-bold text-slate-500">{text.noRequests}</div>
                )}
              </div>
            </form> : null}

            {activeTab === "wallet" ? <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-base font-black">{text.timeline}</h3>
                <ArrowUpCircle className="h-5 w-5 text-slate-400" />
              </div>
              <div className="mt-3 grid gap-2">
                {walletTransactions.length ? walletTransactions.map((item) => (
                  <TimelineItem key={item.id} item={item} text={text} language={language} />
                )) : (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-3 py-5 text-center text-sm font-bold text-slate-500">{text.noTransactions}</div>
                )}
              </div>
            </div> : null}
          </section>
        )}
      </div>
    </main>
  );
}
