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
    subtitle: "رابطك الآمن يفتح المرتب والحضور والطلبات مباشرة.",
    secure: "يتم التحقق من هذا الرابط بأمان.",
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
    invalid: "رابط بوابة الموظف غير صالح. يرجى طلب رابط جديد من الإدارة.",
    invalidLink: "رابط بوابة الموظف غير صالح. يرجى طلب رابط جديد من الإدارة.",
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
    title: "Employee Portal",
    subtitle: "Your secure employee link opens payroll, attendance, and requests.",
    secure: "This private link is validated securely.",
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
    emptyTitle: "Your salary has not been generated yet.",
    emptyBody: "Payslip and wallet transactions will appear after management generates or approves payroll.",
    timeline: "Wallet timeline",
    noTransactions: "No wallet activity yet.",
    attendanceImpact: "Attendance impact",
    expectedDays: "Expected days",
    absenceDays: "Absence days",
    missingHours: "Missing hours",
    downloadPayslip: "Download payslip",
    shareWhatsapp: "WhatsApp share",
    addHome: "Add to Home Screen",
    installHint: "Open from your browser menu and choose Add to Home Screen.",
    retry: "Try again",
    invalid: "Invalid employee portal link. Please request a new link from management.",
    invalidLink: "Invalid employee portal link. Please request a new link from management.",
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
  noTasks: "No tasks assigned today.",
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
  noRequests: "You have not submitted any requests.",
  requestHistory: "Notifications and request history",
  adminNote: "Admin note",
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  myShiftToday: "My Shift Today",
  shiftName: "Shift Name",
  startTime: "Start Time",
  endTime: "End Time",
  expectedHours: "Expected Hours",
  workingDays: "Working Days",
  beforeShift: "Before Shift",
  onShift: "On Shift",
  late: "Late",
  afterShift: "After Shift",
  attendanceActions: "Attendance Actions",
  earlyCheckoutTitle: "Early Checkout",
  earlyCheckoutMessage: "You are checking out before the end of your shift. Are you sure?",
  cancel: "Cancel",
  confirmCheckout: "Confirm Checkout",
  decisionDate: "Decision Date",
  decisionBy: "Approved/Rejected By",
  earlyLeaveMinutes: "Early Leave Minutes",
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

Object.assign(labels.ar, {
  homeTab: "الرئيسية",
  salaryTab: "الراتب",
  employeeDashboard: "بوابة الموظف",
  present: "حاضر",
  absent: "غائب",
  checkedOut: "تم الانصراف",
  checkedIn: "تم تسجيل الحضور",
  notCheckedIn: "لم يتم تسجيل الحضور",
  workedToday: "عملت اليوم",
  checkedInAt: "تم تسجيل حضورك في",
  attendancePercent: "نسبة الحضور",
  pendingTasks: "مهام معلقة",
  salaryNotGenerated: "لم يتم إنشاء راتبك بعد.",
  noTasksToday: "لا توجد مهام مسندة اليوم.",
  noRequestsSubmitted: "لم تقدم أي طلبات بعد.",
  noTimeline: "لا توجد حركات على المحفظة حتى الآن.",
  advanceRequest: "طلب سلفة",
  leaveRequest: "طلب إجازة",
  latePermission: "إذن تأخير",
  hrNote: "ملاحظة للموارد البشرية",
  pendingTasksTitle: "مهام معلقة",
  inProgressTasks: "قيد التنفيذ",
  completedTasks: "مكتملة",
  dueDate: "تاريخ الاستحقاق",
  priority: "الأولوية",
  uploadProof: "إرفاق إثبات",
  payrollBreakdown: "تفاصيل الراتب",
  salaryAndBonus: "راتب / مكافأة",
  deductionOrPenalty: "خصم / جزاء",
  advanceReceived: "سلفة مستلمة",
  reason: "السبب",
  currentNetSalary: "صافي الراتب الحالي",
});

Object.assign(labels.en, {
  homeTab: "Home",
  salaryTab: "Salary",
  employeeDashboard: "Employee Portal",
  present: "Present",
  absent: "Absent",
  checkedOut: "Checked out",
  checkedIn: "Checked In",
  notCheckedIn: "Not Checked In",
  workedToday: "Worked today",
  checkedInAt: "You checked in at",
  attendancePercent: "Attendance %",
  pendingTasks: "Pending Tasks",
  salaryNotGenerated: "Your salary has not been generated yet.",
  noTasksToday: "No tasks assigned today.",
  noRequestsSubmitted: "You have not submitted any requests.",
  noTimeline: "No wallet activity yet.",
  advanceRequest: "Advance Request",
  leaveRequest: "Leave Request",
  latePermission: "Late Permission",
  hrNote: "HR Note",
  pendingTasksTitle: "Pending Tasks",
  inProgressTasks: "In Progress",
  completedTasks: "Completed",
  dueDate: "Due Date",
  priority: "Priority",
  uploadProof: "Upload proof",
  payrollBreakdown: "Payroll breakdown",
  salaryAndBonus: "Salary / Bonus",
  deductionOrPenalty: "Deduction / Penalty",
  advanceReceived: "Advance Received",
  reason: "Reason",
  currentNetSalary: "Current Net Salary",
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

const shiftDateTimeToday = (timeValue) => {
  const text = String(timeValue || "").trim();
  const match = text.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const date = new Date();
  date.setHours(Number(match[1]), Number(match[2]), 0, 0);
  return date;
};

const getShiftStatus = (shift = {}, text = labels.en) => {
  const start = shiftDateTimeToday(shift.start_time || shift.startTime);
  const end = shiftDateTimeToday(shift.end_time || shift.endTime);
  if (!start || !end) return text.beforeShift || labels.en.beforeShift;
  const now = new Date();
  const lateLimit = new Date(start.getTime() + Number(shift.allowed_late_minutes || 0) * 60000);
  if (now < start) return text.beforeShift || labels.en.beforeShift;
  if (now > end) return text.afterShift || labels.en.afterShift;
  if (now > lateLimit) return text.late || labels.en.late;
  return text.onShift || labels.en.onShift;
};

const isBeforeShiftEnd = (shift = {}) => {
  const end = shiftDateTimeToday(shift.end_time || shift.endTime);
  return Boolean(end && new Date() < end);
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

const todayIsoLocal = (language = "en") => formatIsoDateLocal(new Date(), language);

const minutesBetween = (startValue, endValue = new Date()) => {
  const start = parseSafeDate(startValue);
  const end = parseSafeDate(endValue) || new Date();
  if (!start || !end) return 0;
  return Math.max(0, Math.floor((end.getTime() - start.getTime()) / 60000));
};

const formatMinutesShort = (minutes = 0) => {
  const total = Math.max(0, Math.floor(Number(minutes || 0)));
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  return `${hours}h ${mins}m`;
};

const taskStatusKey = (status = "") => String(status || "").trim().toLowerCase();

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
  const isAdvance = item.type === "advance";
  const label = isAdvance ? text.advanceReceived : credit ? text.salaryAndBonus : text.deductionOrPenalty;
  const tone = isAdvance
    ? "bg-amber-50 text-amber-700"
    : credit
      ? "bg-emerald-50 text-emerald-700"
      : "bg-red-50 text-red-700";
  return (
    <div className="grid grid-cols-[auto_1fr_auto] gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className={`mt-1 flex h-9 w-9 items-center justify-center rounded-xl ${tone}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <div className="text-sm font-black text-slate-950">{item.label || label}</div>
        <div className="mt-1 text-xs font-bold text-slate-500" dir="auto">{text.reason}: {item.description || item.status || "-"}</div>
        <div className="mt-1 text-xs font-bold text-slate-400" dir="ltr">{formatDateLocal(item.date, language)}</div>
      </div>
      <div className={`whitespace-nowrap text-sm font-black tabular-nums ${isAdvance ? "text-amber-700" : credit ? "text-emerald-700" : "text-red-700"}`} dir="ltr">
        {credit ? "+" : "-"} {money(item.amount)}
      </div>
    </div>
  );
}

export default function EmployeePayrollPortal() {
  const { token } = useParams();
  const [language, setLanguage] = useState("ar");
  const [portal, setPortal] = useState(null);
  const [loading, setLoading] = useState(true);
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
  const [activeTab, setActiveTab] = useState("home");
  const [taskSavingId, setTaskSavingId] = useState("");
  const [portalNotice, setPortalNotice] = useState("");
  const [optionalLoading, setOptionalLoading] = useState(false);
  const [optionalLoaded, setOptionalLoaded] = useState(false);
  const [earlyCheckoutOpen, setEarlyCheckoutOpen] = useState(false);
  const [nowTick, setNowTick] = useState(Date.now());
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

  useEffect(() => {
    const timer = window.setInterval(() => setNowTick(Date.now()), 60000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let active = true;
    const loadByToken = async () => {
      if (!token) {
        setLoading(false);
        setError(text.invalidLink || labels.en.invalidLink);
        return;
      }
      const startedAt = safeNow();
      try {
        setLoading(true);
        setError("");
        const response = await api.get(`/employee-portal/${encodeURIComponent(token)}`, {
          params: { timezone: browserTimeZone() },
          suppressErrorStatuses: [400, 404, 429],
        });
        if (!active) return;
        setPortal(response.portal || null);
        setOptionalLoaded(false);
        setPortalNotice("");
        logPagePerf("employee-wallet.token-load", startedAt, {
          payroll_generated: Boolean(response.portal?.payroll_generated),
        });
      } catch (err) {
        if (!active) return;
        setPortal(null);
        setError(err?.responseBody?.message || err?.message || text.invalidLink || labels.en.invalidLink);
        logPagePerf("employee-wallet.token-load", startedAt, {
          failed: true,
          status: err?.status || err?.responseBody?.status,
        });
      } finally {
        if (active) setLoading(false);
      }
    };
    loadByToken();
    return () => {
      active = false;
    };
  }, [token, language]);

  const wallet = portal?.wallet_summary || {};
  const profile = portal?.employee_profile || portal?.employee || {};
  const attendance = portal?.attendance?.summary || portal?.recent_attendance_summary || {};
  const attendanceRows = safeArray(portal?.attendance?.timeline);
  const employeeRequests = safeArray(portal?.employee_requests);
  const currentShift = portal?.currentShift || profile.currentShift || {};
  const ui = (key) => text[key] || labels.en[key] || key;
  const tasks = safeArray(portal?.tasks);
  const todayKey = todayIsoLocal(language);
  const todayAttendance = attendanceRows.find((row) => attendanceLocalDate(row, language) === todayKey) || attendanceRows[0] || {};
  const todayCheckIn = todayAttendance.check_in_at || todayAttendance.check_in;
  const todayCheckOut = todayAttendance.check_out_at || todayAttendance.check_out;
  const isCheckedIn = Boolean(todayCheckIn && !todayCheckOut);
  const isCheckedOut = Boolean(todayCheckOut);
  const employeeStatus = isCheckedOut ? ui("checkedOut") : isCheckedIn ? ui("present") : ui("absent");
  const workedMinutes = todayCheckIn ? minutesBetween(todayCheckIn, todayCheckOut || nowTick) : 0;
  const expectedDays = Number(attendance.expected_working_days || attendance.expected_days || 0);
  const presentDays = Number(attendance.attended_days || attendance.present_days || 0);
  const attendancePercent = expectedDays > 0 ? Math.min(100, Math.round((presentDays / expectedDays) * 100)) : 0;
  const pendingTasks = tasks.filter((task) => ["pending", "overdue", "reassigned"].includes(taskStatusKey(task.status)));
  const inProgressTasks = tasks.filter((task) => taskStatusKey(task.status) === "in_progress");
  const completedTasks = tasks.filter((task) => ["completed", "done"].includes(taskStatusKey(task.status)));
  const mobileTabs = [
    ["home", ui("homeTab"), Home],
    ["attendance", text.attendanceTab, CalendarDays],
    ["tasks", text.tasksTab, ClipboardList],
    ["requests", text.requestsTab, MessageCircle],
    ["salary", ui("salaryTab"), WalletCards],
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

  const loadOptionalSections = async () => {
    if (optionalLoading || optionalLoaded) return;
    const startedAt = safeNow();
    try {
      setOptionalLoading(true);
      const response = await api.get(`/employee-portal/${encodeURIComponent(token)}`, {
        params: {
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
    if (actionType === "check_out" && !earlyCheckoutOpen && isBeforeShiftEnd(currentShift)) {
      setEarlyCheckoutOpen(true);
      return;
    }
    setEarlyCheckoutOpen(false);
    const startedAt = safeNow();
    try {
      setAttendanceSaving(actionType);
      setPortalNotice("");
      const location = await getBrowserLocation();
      const response = await api.post(`/employee-portal/${encodeURIComponent(token)}/attendance/actions`, {
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
    const startedAt = safeNow();
    try {
      setRequestSaving(true);
      setPortalNotice("");
      const location = await getBrowserLocation().catch(() => null);
      const response = await api.post(`/employee-portal/${encodeURIComponent(token)}/requests`, {
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
    const startedAt = safeNow();
    try {
      setTaskSavingId(`${taskId}:${status}`);
      const location = await getBrowserLocation().catch(() => null);
      const response = await api.patch(`/employee-portal/${encodeURIComponent(token)}/tasks/${taskId}/status`, {
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

  const chooseRequestType = (value) => {
    if (value === "late_permission") {
      setRequestType("hr_note");
      setRequestMessage((current) => current || ui("latePermission"));
      return;
    }
    setRequestType(value);
  };

  return (
    <main dir={direction} className="min-h-[100dvh] bg-slate-100 px-3 py-4 pb-[calc(6rem+env(safe-area-inset-bottom))] text-slate-950">
      <div className="mx-auto max-w-md">
        <header className="flex items-center justify-between gap-3 py-1">
          <div className="flex items-center gap-2 text-sm font-black text-slate-700">
            <ShieldCheck className="h-4 w-4 text-emerald-600" />
            <span>{ui("employeeDashboard")}</span>
          </div>
          <button
            type="button"
            onClick={() => setLanguage((current) => current === "ar" ? "en" : "ar")}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 shadow-sm"
          >
            {text.language}
          </button>
        </header>

        {!portal && loading ? (
          <div className="mt-4 flex items-center justify-center gap-2 rounded-3xl border border-slate-200 bg-white p-6 text-sm font-black text-slate-600 shadow-sm">
            <Loader2 className="h-4 w-4 animate-spin" />
            {text.loading}
          </div>
        ) : !portal ? (
          <div className="mt-4 rounded-3xl border border-red-200 bg-white p-5 text-sm font-bold leading-6 text-red-800 shadow-sm">
            <AlertTriangle className="h-6 w-6" />
            <div className="mt-3">{error || text.invalidLink || labels.en.invalidLink}</div>
          </div>
        ) : (
          <section className="mt-4 space-y-4">
            <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-start gap-3">
                <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-slate-950 text-lg font-black text-white">
                  {profile.photo_url ? <img src={profile.photo_url} alt="" className="h-full w-full object-cover" /> : profile.avatar_initials || <UserRound className="h-7 w-7" />}
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="text-2xl font-black leading-8" dir="auto">{profile.name}</h2>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-sm font-bold text-slate-500">
                    <span>{profile.job_title || "-"}</span>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-black ${isCheckedIn ? "bg-emerald-100 text-emerald-800" : isCheckedOut ? "bg-slate-200 text-slate-700" : "bg-red-100 text-red-800"}`}>{employeeStatus}</span>
                  </div>
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

            {activeTab === "home" ? (
              <>
                <div className="grid grid-cols-4 gap-2">
                  {[
                    [text.netSalary, portal.payroll_generated ? money(wallet.current_net_salary ?? portal.net_salary) : "-", WalletCards],
                    [text.advances, money(wallet.total_advances ?? portal.advances), CreditCard],
                    [ui("attendancePercent"), `${attendancePercent}%`, CalendarDays],
                    [ui("pendingTasks"), pendingTasks.length, ClipboardList],
                  ].map(([label, value, Icon]) => (
                    <div key={label} className="min-h-20 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
                      <Icon className="h-4 w-4 text-slate-500" />
                      <div className="mt-2 truncate text-[10px] font-black text-slate-500">{label}</div>
                      <div className="mt-1 truncate text-sm font-black tabular-nums" dir="ltr">{value}</div>
                    </div>
                  ))}
                </div>

                <section className="rounded-3xl bg-slate-950 p-4 text-white shadow-xl shadow-slate-300">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-xs font-black text-slate-300">{text.attendanceTab}</div>
                      <h3 className="mt-1 text-2xl font-black">{isCheckedIn ? ui("checkedIn") : ui("notCheckedIn")}</h3>
                    </div>
                    <span className={`rounded-full px-3 py-1 text-xs font-black ${isCheckedIn ? "bg-emerald-400 text-emerald-950" : "bg-white/10 text-white"}`}>{employeeStatus}</span>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-2 text-xs font-bold">
                    <div className="rounded-2xl bg-white/10 p-3"><div className="text-slate-300">{text.checkIn}</div><div className="mt-1 text-sm font-black" dir="ltr">{formatTimeLocal(todayCheckIn, language)}</div></div>
                    <div className="rounded-2xl bg-white/10 p-3"><div className="text-slate-300">{ui("workedToday")}</div><div className="mt-1 text-sm font-black" dir="ltr">{formatMinutesShort(workedMinutes)}</div></div>
                    <div className="rounded-2xl bg-white/10 p-3"><div className="text-slate-300">{ui("startTime")}</div><div className="mt-1 text-sm font-black" dir="ltr">{formatShiftTimeLocal(currentShift.start_time || currentShift.startTime, language)}</div></div>
                    <div className="rounded-2xl bg-white/10 p-3"><div className="text-slate-300">{ui("endTime")}</div><div className="mt-1 text-sm font-black" dir="ltr">{formatShiftTimeLocal(currentShift.end_time || currentShift.endTime, language)}</div></div>
                  </div>
                  {todayCheckIn ? <div className="mt-3 text-xs font-bold text-slate-300">{ui("checkedInAt")} <span dir="ltr">{formatTimeLocal(todayCheckIn, language)}</span></div> : null}
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => submitAttendanceAction("check_in")} disabled={Boolean(attendanceSaving)} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-3 text-sm font-black text-emerald-950 disabled:opacity-50">
                      {attendanceSaving === "check_in" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                      {text.checkIn}
                    </button>
                    <button type="button" onClick={() => submitAttendanceAction("check_out")} disabled={Boolean(attendanceSaving)} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-white px-3 text-sm font-black text-slate-950 disabled:opacity-50">
                      {attendanceSaving === "check_out" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarDays className="h-4 w-4" />}
                      {text.checkOut}
                    </button>
                  </div>
                  {portalNotice ? <div className="mt-3 rounded-2xl bg-white/10 px-3 py-2 text-sm font-bold leading-6 text-white" dir="auto">{portalNotice}</div> : null}
                </section>
              </>
            ) : null}

            <nav className="fixed inset-x-3 bottom-3 z-40 mx-auto grid max-w-md grid-cols-5 gap-1 rounded-2xl border border-slate-200 bg-white/95 p-1 shadow-lg backdrop-blur">
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

            {activeTab === "salary" ? <div className="rounded-3xl bg-slate-950 p-4 text-white shadow-xl shadow-slate-300">
              <div className="text-xs font-black text-slate-300">{ui("currentNetSalary")}</div>
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

            {activeTab === "salary" && !portal.payroll_generated ? (
              <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-6 text-center shadow-sm">
                <FileText className="mx-auto h-8 w-8 text-slate-400" />
                <h2 className="mt-3 text-xl font-black">{ui("salaryNotGenerated")}</h2>
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

            {activeTab === "salary" ? <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
              <h3 className="text-base font-black">{ui("payrollBreakdown")}</h3>
              <div className="mt-3 grid gap-2 text-sm font-bold">
                {[
                  ["+", text.baseSalary, portal.base_salary],
                  ["+", text.commission, portal.sales_commission ?? portal.commissions],
                  ["+", text.bonuses, portal.bonuses],
                  ["-", text.advances, portal.advances],
                  ["-", text.penalties, portal.penalties],
                  ["-", text.deductions, portal.total_deductions],
                ].map(([sign, label, value]) => (
                  <div key={label} className="flex items-center justify-between rounded-2xl bg-slate-50 px-3 py-2">
                    <span>{sign} {label}</span>
                    <span className={sign === "+" ? "text-emerald-700" : "text-red-700"} dir="ltr">{money(value)}</span>
                  </div>
                ))}
                <div className="mt-1 flex items-center justify-between border-t border-slate-200 pt-3 text-base font-black">
                  <span>{text.netSalary}</span>
                  <span dir="ltr">{portal.payroll_generated ? money(wallet.current_net_salary ?? portal.net_salary) : "-"}</span>
                </div>
              </div>
              <button type="button" onClick={downloadPayslip} className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 px-3 text-sm font-black text-white">
                <Download className="h-4 w-4" />
                {text.downloadPayslip}
              </button>
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

            {activeTab === "tasks" ? (
              <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
                <h3 className="text-base font-black">{text.tasks}</h3>
                <div className="mt-3 grid gap-4">
                  {[
                    [ui("pendingTasksTitle"), pendingTasks],
                    [ui("inProgressTasks"), inProgressTasks],
                    [ui("completedTasks"), completedTasks],
                  ].map(([title, rows]) => (
                    <section key={title}>
                      <div className="mb-2 flex items-center justify-between text-xs font-black text-slate-500">
                        <span>{title}</span>
                        <span dir="ltr">{rows.length}</span>
                      </div>
                      <div className="grid gap-2">
                        {rows.length ? rows.map((task) => (
                          <div key={task.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="text-sm font-black text-slate-950" dir="auto">{task.task_title_ar || task.title_ar || task.title}</div>
                                <div className="mt-1 text-xs font-bold text-slate-500" dir="auto">{task.task_description_ar || task.description_ar || task.description || task.notes || "-"}</div>
                              </div>
                              <span className="rounded-full bg-white px-2.5 py-1 text-xs font-black text-slate-700">{task.status}</span>
                            </div>
                            <div className="mt-3 grid grid-cols-2 gap-2 text-xs font-bold text-slate-500">
                              <div>{ui("dueDate")}: <span dir="ltr">{formatDateLocal(task.due_at || task.due_date || task.deadline, language)}</span></div>
                              <div>{ui("priority")}: <span>{task.priority || "-"}</span></div>
                            </div>
                            <div className="mt-3 grid grid-cols-2 gap-2">
                              {["pending", "overdue", "reassigned"].includes(taskStatusKey(task.status)) ? (
                                <button type="button" disabled={Boolean(taskSavingId)} onClick={() => updateWalletTask(task.id, "in_progress")} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-3 text-sm font-black text-slate-800 disabled:opacity-50">
                                  {taskSavingId === `${task.id}:in_progress` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                                  {text.startTask}
                                </button>
                              ) : null}
                              {taskStatusKey(task.status) === "in_progress" ? (
                                <button type="button" disabled={Boolean(taskSavingId)} onClick={() => updateWalletTask(task.id, "completed")} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-3 text-sm font-black text-white disabled:opacity-50">
                                  {taskSavingId === `${task.id}:completed` ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                                  {text.completeTask}
                                </button>
                              ) : null}
                              <button type="button" className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-black text-slate-600">
                                <FileText className="h-4 w-4" />
                                {ui("uploadProof")}
                              </button>
                            </div>
                          </div>
                        )) : (
                          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-center text-sm font-bold text-slate-500">{ui("noTasksToday")}</div>
                        )}
                      </div>
                    </section>
                  ))}
                </div>
              </div>
            ) : null}

            {activeTab === "requests" ? <form onSubmit={submitRequest} className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
              <h3 className="text-base font-black">{text.requests}</h3>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {[
                  ["advance", ui("advanceRequest")],
                  ["vacation", ui("leaveRequest")],
                  ["late_permission", ui("latePermission")],
                  ["hr_note", ui("hrNote")],
                ].map(([value, label]) => (
                  <button key={value} type="button" onClick={() => chooseRequestType(value)} className={`min-h-11 rounded-2xl px-2 text-xs font-black ${(value === requestType || (value === "late_permission" && requestMessage === ui("latePermission"))) ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-700"}`}>
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
                    <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-500">
                      <div>{ui("decisionDate")}: <span dir="ltr">{formatDateLocal(item.decision_date || item.reviewed_at, language)}</span></div>
                      <div>{ui("decisionBy")}: <span dir="auto">{item.approved_rejected_by || item.decision_by || "-"}</span></div>
                    </div>
                    {item.amount ? <div className="mt-1 text-xs font-black text-slate-600" dir="ltr">{money(item.amount)}</div> : null}
                    {item.admin_note ? <div className="mt-2 rounded-xl bg-white px-3 py-2 text-xs leading-5 text-slate-700" dir="auto">{text.adminNote}: {item.admin_note}</div> : null}
                  </div>
                )) : (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-center text-sm font-bold text-slate-500">{ui("noRequestsSubmitted")}</div>
                )}
              </div>
            </form> : null}

            {activeTab === "salary" ? <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-base font-black">{text.timeline}</h3>
                <ArrowUpCircle className="h-5 w-5 text-slate-400" />
              </div>
              <div className="mt-3 grid gap-2">
                {walletTransactions.length ? walletTransactions.map((item) => (
                  <TimelineItem key={item.id} item={item} text={text} language={language} />
                )) : (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-3 py-5 text-center text-sm font-bold text-slate-500">{ui("noTimeline")}</div>
                )}
              </div>
            </div> : null}
          </section>
        )}
      </div>
      {earlyCheckoutOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-sm rounded-3xl bg-white p-5 shadow-2xl">
            <h2 className="text-xl font-black text-slate-950">{ui("earlyCheckoutTitle")}</h2>
            <p className="mt-2 text-sm font-bold leading-6 text-slate-600">{ui("earlyCheckoutMessage")}</p>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setEarlyCheckoutOpen(false)} className="min-h-12 rounded-2xl border border-slate-200 px-4 text-sm font-black text-slate-700">
                {ui("cancel")}
              </button>
              <button type="button" onClick={() => submitAttendanceAction("check_out")} className="min-h-12 rounded-2xl bg-slate-950 px-4 text-sm font-black text-white">
                {ui("confirmCheckout")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
