import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { io as createSocket } from "socket.io-client";
import {
  AlertTriangle,
  ArrowDownCircle,
  ArrowUpCircle,
  Banknote,
  Bell,
  CalendarDays,
  CheckCheck,
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
  Mic,
  Paperclip,
  Play,
  QrCode,
  RefreshCw,
  ReceiptText,
  Send,
  ShieldCheck,
  Smartphone,
  Star,
  Target,
  Trophy,
  UserRound,
  WalletCards,
  X,
} from "lucide-react";

import { api } from "../../../shared/api/api";
import { API_ORIGIN, SOCKET_URL } from "../../../shared/constants/app";
import { formatCurrency } from "../../../shared/lib/currency";
import { logPagePerf } from "../../../shared/lib/perfDebug";
import WhatsAppVoiceMessage from "../components/WhatsAppVoiceMessage";

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
    invalid: "رابط بوابة الموظف غير صحيح أو تم تغييره. اطلب رابط جديد من الإدارة.",
    invalidLink: "رابط بوابة الموظف غير صحيح أو تم تغييره. اطلب رابط جديد من الإدارة.",
    loading: "جار التحميل...",
    language: "English",
    employeeCode: "كود الموظف",
    branch: "الفرع",
    jobTitle: "الوظيفة",
    transactionTypes: {
      advance: "سلفة شخصية",
      penalty: "جزاء",
      bonus: "مكافأة",
      reward: "مكافأة",
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
    invalid: "رابط بوابة الموظف غير صحيح أو تم تغييره. اطلب رابط جديد من الإدارة.",
    invalidLink: "رابط بوابة الموظف غير صحيح أو تم تغييره. اطلب رابط جديد من الإدارة.",
    loading: "Loading...",
    language: "العربية",
    employeeCode: "Employee code",
    branch: "Branch",
    jobTitle: "Job title",
    transactionTypes: {
      advance: "Personal advance",
      penalty: "Penalty",
      bonus: "Bonus",
      reward: "Reward",
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
  attendedDays: "الحضور",
  attendedDaysSuffix: "يوم",
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
  requestHistory: "آخر الطلبات",
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
  attendedDays: "Attended",
  attendedDaysSuffix: "days",
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
  requestHistory: "Recent requests",
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
  walletOnlyTab: "المحفظة",
  notificationsTab: "التنبيهات",
  displayRefillTab: "نواقص العرض",
  talkToManagement: "كلم الإدارة",
  chatTitle: "محادثة الإدارة",
  chatSubtitle: "اكتب رسالتك وسيتم الرد عليك من الإدارة.",
  chatPlaceholder: "اكتب رسالتك هنا...",
  sendMessage: "إرسال",
  noChatMessages: "لا توجد رسائل حتى الآن.",
  chatLoadError: "تعذر تحميل المحادثة.",
  chatSendError: "تعذر إرسال الرسالة.",
  chatSecureNotice: "هذه المحادثة خاصة بينك وبين الإدارة",
  attachFile: "إرفاق ملف",
  removeAttachment: "حذف المرفق",
  imageAttachment: "صورة",
  fileAttachment: "ملف",
  unsupportedAttachment: "نوع الملف غير مدعوم.",
  management: "الإدارة",
  you: "أنت",
  employeeDashboard: "بوابة الموظف",
  present: "حاضر",
  absent: "غائب",
  checkedOut: "تم الانصراف",
  checkedIn: "تم تسجيل الحضور",
  notCheckedIn: "لم يتم تسجيل الحضور",
  workedToday: "عملت اليوم",
  checkedInAt: "تم تسجيل حضورك في",
  attendancePercent: "نسبة الحضور",
  attendanceDays: "أيام الحضور",
  daysUnit: "يوم",
  fromTotalDays: "من أصل",
  openTasksSubtitle: "مهام مفتوحة",
  totalAdvancesSubtitle: "إجمالي السلف",
  currentMonthSubtitle: "الشهر الحالي",
  notificationsShort: "تنبيهات",
  displayRefillShort: "عرض",
  tasksShort: "مهام",
  requestsShort: "طلبات",
  pendingTasks: "مهام معلقة",
  salaryNotGenerated: "لم يتم إنشاء راتب هذا الشهر بعد",
  noTasksToday: "لا توجد مهام اليوم",
  noTasksSubtitle: "كل شيء مكتمل حاليا.",
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
  displayRefillEmpty: "لا توجد نواقص عرض حالياً",
});

Object.assign(labels.en, {
  homeTab: "Home",
  salaryTab: "Salary",
  walletOnlyTab: "Wallet",
  notificationsTab: "Notifications",
  displayRefillTab: "Display refill",
  talkToManagement: "Talk to management",
  chatTitle: "Management chat",
  chatSubtitle: "Send a message and management will reply here.",
  chatPlaceholder: "Write your message...",
  sendMessage: "Send",
  noChatMessages: "No messages yet.",
  chatLoadError: "Unable to load chat.",
  chatSendError: "Unable to send message.",
  chatSecureNotice: "This conversation is private between you and management.",
  attachFile: "Attach file",
  removeAttachment: "Remove attachment",
  imageAttachment: "Image",
  fileAttachment: "File",
  unsupportedAttachment: "Unsupported file type.",
  management: "Management",
  you: "You",
  employeeDashboard: "Employee Portal",
  present: "Present",
  absent: "Absent",
  checkedOut: "Checked out",
  checkedIn: "Checked In",
  notCheckedIn: "Not Checked In",
  workedToday: "Worked today",
  checkedInAt: "You checked in at",
  attendancePercent: "Attendance %",
  attendanceDays: "Attendance Days",
  daysUnit: "days",
  fromTotalDays: "of",
  openTasksSubtitle: "Open tasks",
  totalAdvancesSubtitle: "Total advances",
  currentMonthSubtitle: "Current month",
  notificationsShort: "Alerts",
  displayRefillShort: "Display",
  tasksShort: "Tasks",
  requestsShort: "Requests",
  pendingTasks: "Pending Tasks",
  salaryNotGenerated: "This month salary has not been generated yet.",
  noTasksToday: "No tasks assigned today.",
  noTasksSubtitle: "Everything is clear right now.",
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
  displayRefillEmpty: "No display refill alerts right now.",
});

const money = (value) => {
  if (value === null || value === undefined || value === "") return "-";
  return formatCurrency(Number(value || 0));
};

const safeArray = (value) => (Array.isArray(value) ? value : []);
const chatAttachmentUrl = (value = "") => {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/^https?:\/\//i.test(text)) return text;
  return `${API_ORIGIN}${text.startsWith("/") ? text : `/${text}`}`;
};
const formatFileSize = (value = 0) => {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};
const allowedChatAttachment = (file) => {
  if (!file) return true;
  return new Set([
    "image/jpeg",
    "image/png",
    "image/webp",
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "audio/webm",
    "audio/mp4",
    "audio/mpeg",
    "audio/wav",
    "audio/x-wav",
  ]).has(file.type);
};

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
const EMPLOYEE_PORTAL_PWA_VERSION = "20260601";

const browserTimeZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Africa/Cairo";
  } catch {
    return "Africa/Cairo";
  }
};

const isBrowser = () => typeof window !== "undefined" && typeof navigator !== "undefined";

const isStandaloneApp = () => {
  if (!isBrowser()) return false;
  return window.matchMedia?.("(display-mode: standalone)")?.matches || window.navigator.standalone === true;
};

const isIosDevice = () => {
  if (!isBrowser()) return false;
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent || "");
};

const pushSupported = () => isBrowser() && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const appBadgeSupported = () => isBrowser() && typeof navigator.setAppBadge === "function" && typeof navigator.clearAppBadge === "function";

const setEmployeeAppBadge = (count = 0) => {
  if (!appBadgeSupported()) return;
  const safeCount = Math.max(0, Math.round(Number(count || 0)));
  const action = safeCount > 0 ? navigator.setAppBadge(safeCount) : navigator.clearAppBadge();
  Promise.resolve(action).catch(() => null);
};

const urlBase64ToUint8Array = (base64String = "") => {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = `${base64String}${padding}`.replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
};

const uint8ArrayToUrlBase64 = (value) => {
  if (!value) return "";
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return window.btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};

const pushSubscriptionUsesKey = (subscription, publicKey = "") => {
  const existingKey = subscription?.options?.applicationServerKey;
  if (!publicKey) return true;
  if (!existingKey) return false;
  return uint8ArrayToUrlBase64(existingKey) === String(publicKey).replace(/=+$/g, "");
};

const endpointHost = (endpoint = "") => {
  try {
    return new URL(String(endpoint || "")).host;
  } catch {
    return "";
  }
};

const badgeStorageKey = (token = "", scope = "") => `employee_portal_badge:${String(token || "").slice(-16)}:${scope}`;

const readBadgeSet = (token = "", scope = "") => {
  if (!isBrowser() || !token) return new Set();
  try {
    const rows = JSON.parse(window.localStorage.getItem(badgeStorageKey(token, scope)) || "[]");
    return new Set(Array.isArray(rows) ? rows.map(String) : []);
  } catch {
    return new Set();
  }
};

const writeBadgeSet = (token = "", scope = "", values = []) => {
  if (!isBrowser() || !token) return;
  try {
    window.localStorage.setItem(badgeStorageKey(token, scope), JSON.stringify([...new Set(values.map(String))]));
  } catch {
    // Badge persistence is best-effort only.
  }
};

const postEmployeeBadgeMessage = (message = {}) => {
  if (!isBrowser() || !navigator.serviceWorker?.controller) return;
  try {
    navigator.serviceWorker.controller.postMessage({ ...message, at: Date.now() });
  } catch {
    // Service worker badge sync is best-effort only.
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

const employeePortalDateTimeParts = (value, language = "ar", fallback = "-") => {
  const date = parseSafeDate(value);
  if (!date) return null;
  const locale = language === "ar" ? "ar-EG" : localeForLanguage(language);
  const formatParts = (timeZone) => {
    const dateParts = new Intl.DateTimeFormat(locale, {
      timeZone,
      day: "numeric",
      month: "long",
      year: "numeric",
    }).formatToParts(date);
    const timeParts = new Intl.DateTimeFormat(locale, {
      timeZone,
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).formatToParts(date);
    const part = (parts, type) => parts.find((item) => item.type === type)?.value || "";
    const dateText = language === "ar"
      ? `${part(dateParts, "day")} ${part(dateParts, "month")} ${part(dateParts, "year")}`
      : dateParts.map((item) => item.value).join("").trim();
    const dayPeriod = part(timeParts, "dayPeriod");
    const timeText = [
      `${part(timeParts, "hour")}:${part(timeParts, "minute")}`,
      dayPeriod,
    ].filter(Boolean).join(" ");
    return { dateText, timeText };
  };
  try {
    return formatParts(browserTimeZone());
  } catch {
    try {
      return formatParts("Africa/Cairo");
    } catch {
      return { dateText: fallback, timeText: "" };
    }
  }
};

const formatEmployeePortalDateTime = (value, language = "ar", fallback = "-") => {
  const parts = employeePortalDateTimeParts(value, language, fallback);
  if (!parts) return fallback;
  return [parts.dateText, parts.timeText].filter(Boolean).join(" - ");
};

const formatEmployeePortalDate = (value, language = "ar", fallback = "-") => (
  employeePortalDateTimeParts(value, language, fallback)?.dateText || fallback
);

function DateSafe({ children, className = "" }) {
  return (
    <span dir="auto" className={`date-safe${className ? ` ${className}` : ""}`}>
      {children}
    </span>
  );
}

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
  const key = String(status || "").trim().toLowerCase();
  if (key === "pending_payment") return text.pendingPayment;
  if (key === "not_generated" || key === "missing" || key === "not_generated_yet") return text.notGenerated;
  return text.generated;
};

const walletTransactionTypeLabel = (item = {}, text = labels.en, language = "en") => {
  const rawType = String(item.type || item.transaction_type || item.kind || "").trim();
  const normalizedType = rawType.toLowerCase();
  if (language === "ar") {
    const arTypes = {
      advance: "\u0633\u0644\u0641\u0629 \u0634\u062e\u0635\u064a\u0629",
      bonus: "\u0645\u0643\u0627\u0641\u0623\u0629",
      commission: "\u0639\u0645\u0648\u0644\u0629",
      penalty: "\u062c\u0632\u0627\u0621",
      deduction: "\u062e\u0635\u0645",
      attendance_deduction: "\u062e\u0635\u0645",
      salary: "\u0631\u0627\u062a\u0628",
      payroll: "\u0631\u0627\u062a\u0628",
      salary_approval: "\u0631\u0627\u062a\u0628",
      adjustment: "\u062a\u0639\u062f\u064a\u0644 \u0645\u062d\u0641\u0638\u0629",
    };
    return arTypes[normalizedType] || text.transactionTypes?.[normalizedType] || text.transactionTypes?.[rawType] || text.salaryAndBonus;
  }
  return item.label || text.transactionTypes?.[normalizedType] || text.transactionTypes?.[rawType] || text.salaryAndBonus;
};

const formatWalletDateLocal = (value, language = "en", fallback = "-") => {
  const date = parseSafeDate(value);
  if (!date) return fallback;
  const formatParts = (timeZone) => {
    const parts = new Intl.DateTimeFormat(localeForLanguage(language), {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const part = (type) => parts.find((item) => item.type === type)?.value || "";
    return `${part("day")}-${part("month")}-${part("year")}`;
  };
  try {
    return formatParts(browserTimeZone());
  } catch {
    try {
      return formatParts("Africa/Cairo");
    } catch {
      return fallback;
    }
  }
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

const requestTypeLabel = (item = {}, text = labels.en) => {
  const type = String(item.request_type || item.type || "").trim().toLowerCase();
  if (type === "advance") return text.requestAdvance;
  if (type === "hr_note") return text.sendHrNote;
  if (type === "late_permission") return text.latePermission;
  return text.requestVacation;
};

const requestStatusClass = (status = "") => {
  const normalized = String(status || "").trim().toLowerCase();
  if (normalized === "approved") return "bg-emerald-100 text-emerald-800";
  if (normalized === "rejected") return "bg-red-100 text-red-800";
  return "bg-amber-100 text-amber-800";
};

const renderTransactionIcon = (type, className = "") => {
  const key = String(type || "").trim().toLowerCase();
  if (key === "advance") return <CreditCard className={className} />;
  if (key === "penalty") return <AlertTriangle className={className} />;
  if (key === "bonus") return <Gift className={className} />;
  if (key === "commission") return <Coins className={className} />;
  if (key === "salary" || key === "payroll" || key === "salary_approval") return <CheckCircle2 className={className} />;
  if (key === "deduction" || key === "attendance_deduction") return <CalendarDays className={className} />;
  return <ReceiptText className={className} />;
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
  const type = String(item.type || item.transaction_type || item.kind || "").trim().toLowerCase();
  const credit = item.direction === "credit";
  const isAdvance = type === "advance";
  const label = walletTransactionTypeLabel(item, text, language);
  const tone = isAdvance
    ? "bg-amber-50 text-amber-700"
    : credit
      ? "bg-emerald-50 text-emerald-700"
      : "bg-red-50 text-red-700";
  return (
    <div className="grid grid-cols-[auto_1fr_auto] gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className={`mt-1 flex h-9 w-9 items-center justify-center rounded-xl ${tone}`}>
        {renderTransactionIcon(type, "h-4 w-4")}
      </div>
      <div className="min-w-0">
        <div className="text-sm font-black text-slate-950">{label}</div>
        <div className="mt-1 text-xs font-bold text-slate-500" dir="auto">{text.reason}: {item.description || item.status || "-"}</div>
        <div className="mt-1 text-xs font-bold text-slate-400"><DateSafe>{formatEmployeePortalDate(item.date, language)}</DateSafe></div>
      </div>
      <div className={`whitespace-nowrap text-sm font-black tabular-nums ${isAdvance ? "text-amber-700" : credit ? "text-emerald-700" : "text-red-700"}`} dir="ltr">
        {credit ? "+" : "-"} {money(item.amount)}
      </div>
    </div>
  );
}

function chatMessagePreview(message = {}, text = {}) {
  const body = String(message.body || message.reply_body || "").trim();
  if (body) return body.length > 80 ? `${body.slice(0, 77)}...` : body;
  const type = message.attachment_type || message.reply_attachment_type;
  if (type === "image") return text.imageAttachment || "صورة";
  if (type === "audio") return "رسالة صوتية";
  if (message.attachment_url || message.reply_attachment_name) return text.fileAttachment || "ملف";
  return "رسالة";
}

function ChatAttachment({ message, text, compact = false, outgoing = false, onImageClick }) {
  if (!message?.attachment_url) return null;
  const href = chatAttachmentUrl(message.attachment_url);
  const isImage = message.attachment_type === "image" || String(message.attachment_mime || "").startsWith("image/");
  const isAudio = message.attachment_type === "audio" || String(message.attachment_mime || "").startsWith("audio/");
  const name = message.attachment_name || (isImage ? text.imageAttachment : text.fileAttachment);
  if (isImage) {
    return (
      <button type="button" onClick={() => onImageClick?.(href)} className="mb-2 block overflow-hidden rounded-2xl border border-black/5 bg-black/5 text-start">
        <img src={href} alt={name} className={`${compact ? "max-h-56" : "max-h-64"} w-full object-cover`} />
      </button>
    );
  }
  if (isAudio) {
    return <WhatsAppVoiceMessage src={href} outgoing={outgoing} label={text.voiceAttachment || "Voice message"} />;
  }
  return (
    <a href={href} target="_blank" rel="noreferrer" download className="mb-2 flex items-center gap-3 rounded-2xl border border-black/10 bg-black/5 p-3 text-inherit no-underline">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/70 text-slate-700">
        <FileText className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-black" dir="auto">{name}</span>
        <span className="mt-0.5 block text-[10px] font-bold opacity-70" dir="ltr">{message.attachment_mime || text.fileAttachment} {formatFileSize(message.attachment_size)}</span>
      </span>
    </a>
  );
}

export default function EmployeePayrollPortal() {
  const { token } = useParams();
  const language = "ar";
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
  const [standalone, setStandalone] = useState(() => isStandaloneApp());
  const [notificationState, setNotificationState] = useState(() => {
    if (!pushSupported()) return "unsupported";
    return window.Notification.permission;
  });
  const [notificationSaving, setNotificationSaving] = useState(false);
  const [notificationMessage, setNotificationMessage] = useState("");
  const [chatOpen, setChatOpen] = useState(false);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatSaving, setChatSaving] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatError, setChatError] = useState("");
  const [chatBody, setChatBody] = useState("");
  const [chatAttachment, setChatAttachment] = useState(null);
  const [chatThread, setChatThread] = useState(null);
  const [replyToChat, setReplyToChat] = useState(null);
  const [chatImagePreview, setChatImagePreview] = useState("");
  const [chatTyping, setChatTyping] = useState(false);
  const [showChatJump, setShowChatJump] = useState(false);
  const [recordingState, setRecordingState] = useState({ active: false, seconds: 0, supported: false });
  const [chatSocketConnected, setChatSocketConnected] = useState(false);
  const [activeToast, setActiveToast] = useState(null);
  const [displayRefillAlerts, setDisplayRefillAlerts] = useState([]);
  const [displayRefillLoading, setDisplayRefillLoading] = useState(false);
  const [displayRefillSavingId, setDisplayRefillSavingId] = useState("");
  const [badgeCounts, setBadgeCounts] = useState({ unreadChats: 0, pendingNotifications: 0, newTasks: 0, unreadNotifications: 0, displayRefillAlerts: 0 });
  const [notificationSeenVersion, setNotificationSeenVersion] = useState(0);
  const chatSocketRef = useRef(null);
  const requestSocketRef = useRef(null);
  const toastTimerRef = useRef(null);
  const chatFileInputRef = useRef(null);
  const chatInputRef = useRef(null);
  const chatMessagesRef = useRef(null);
  const chatTypingTimerRef = useRef(null);
  const chatTypingStopRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const recordingChunksRef = useRef([]);
  const recordingTimerRef = useRef(null);
  const chatSwipeRef = useRef({ id: null, startX: 0, startY: 0, active: false });
  const text = labels[language];
  const isRtl = language === "ar";
  const direction = isRtl ? "rtl" : "ltr";

  useEffect(() => {
    setRecordingState((current) => ({ ...current, supported: isBrowser() && Boolean(window.MediaRecorder && navigator.mediaDevices?.getUserMedia) }));
  }, []);

  useEffect(() => {
    if (!isBrowser() || !("serviceWorker" in navigator)) return undefined;
    navigator.serviceWorker.register(`/employee-portal-sw.js?v=${EMPLOYEE_PORTAL_PWA_VERSION}`).catch((err) => {
      console.warn("[employee-payroll-portal] service worker registration failed", err);
    });
    return undefined;
  }, []);

  useEffect(() => {
    if (!isBrowser() || !token) return undefined;
    const previousManifests = Array.from(document.querySelectorAll('link[rel="manifest"]')).map((item) => ({
      href: item.getAttribute("href") || "",
    }));
    document.querySelectorAll('link[rel="manifest"]').forEach((item) => item.remove());
    const link = document.createElement("link");
    link.setAttribute("rel", "manifest");
    link.setAttribute("href", `/api/employee-portal/${encodeURIComponent(token)}/manifest.webmanifest?v=${encodeURIComponent(token)}`);
    link.setAttribute("data-employee-portal-manifest", "true");
    document.head.appendChild(link);

    const previousAppleTitle = document.querySelector('meta[name="apple-mobile-web-app-title"]')?.getAttribute("content") || "";
    let appleTitle = document.querySelector('meta[name="apple-mobile-web-app-title"]');
    if (!appleTitle) {
      appleTitle = document.createElement("meta");
      appleTitle.setAttribute("name", "apple-mobile-web-app-title");
      document.head.appendChild(appleTitle);
    }
    appleTitle.setAttribute("content", "الموظف");

    return () => {
      link.remove();
      if (!window.location.pathname.startsWith("/employee-app/") && !window.location.pathname.startsWith("/employee-portal/")) {
        previousManifests.forEach((item) => {
          if (!item.href) return;
          const restored = document.createElement("link");
          restored.setAttribute("rel", "manifest");
          restored.setAttribute("href", item.href);
          document.head.appendChild(restored);
        });
      }
      appleTitle?.setAttribute("content", previousAppleTitle || "الموظف");
    };
  }, [token]);

  useEffect(() => {
    if (!isBrowser()) return undefined;
    const media = window.matchMedia?.("(display-mode: standalone)");
    const updateStandalone = () => setStandalone(isStandaloneApp());
    updateStandalone();
    media?.addEventListener?.("change", updateStandalone);
    window.addEventListener("appinstalled", updateStandalone);
    return () => {
      media?.removeEventListener?.("change", updateStandalone);
      window.removeEventListener("appinstalled", updateStandalone);
    };
  }, []);

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
    if (!isBrowser()) return;
    const tab = new URLSearchParams(window.location.search).get("tab");
    if (tab === "chat") {
      setChatOpen(true);
      return;
    }
    if (["home", "attendance", "tasks", "requests", "salary", "wallet", "notifications", "display-refill"].includes(tab)) setActiveTab(tab);
  }, []);

  const loadDisplayRefillAlerts = useCallback(async ({ silent = false } = {}) => {
    if (!token) return;
    try {
      if (!silent) setDisplayRefillLoading(true);
      const response = await api.get(`/employee-portal/${encodeURIComponent(token)}/display-refill-alerts`, {
        params: { status: "pending" },
      });
      const alerts = safeArray(response.alerts);
      console.info("[employee-payroll-portal] display refill alerts loaded", {
        count: alerts.length,
        pending_unread_count: response.pending_unread_count ?? null,
      });
      setDisplayRefillAlerts(alerts);
    } catch (err) {
      console.warn("[employee-payroll-portal] display refill alerts load failed", err);
    } finally {
      if (!silent) setDisplayRefillLoading(false);
    }
  }, [token]);

  const loadPortalByToken = useCallback(
    async ({ silent = false, clearNotice = true, activeRef = null } = {}) => {
      if (!token) {
        if (!silent) setLoading(false);
        setError(text.invalidLink || labels.en.invalidLink);
        return;
      }
      const startedAt = safeNow();
      try {
        if (!silent) setLoading(true);
        setError("");
        const response = await api.get(`/employee-portal/${encodeURIComponent(token)}`, {
          params: { timezone: browserTimeZone() },
          suppressErrorStatuses: [400, 404, 429],
        });
        if (activeRef && !activeRef.current) return;
        setPortal(response.portal || null);
        loadDisplayRefillAlerts({ silent: true });
        if (response.portal && isBrowser()) {
          window.localStorage?.setItem("employee_portal_last_url", `/employee-app/${encodeURIComponent(token)}${window.location.search}`);
        }
        setOptionalLoaded(false);
        if (clearNotice) setPortalNotice("");
        logPagePerf("employee-wallet.token-load", startedAt, {
          payroll_generated: Boolean(response.portal?.payroll_generated),
          silent,
        });
      } catch (err) {
        if (activeRef && !activeRef.current) return;
        if (!silent) setPortal(null);
        setError(err?.responseBody?.message || err?.message || text.invalidLink || labels.en.invalidLink);
        logPagePerf("employee-wallet.token-load", startedAt, {
          failed: true,
          status: err?.status || err?.responseBody?.status,
          silent,
        });
      } finally {
        if (!silent && (!activeRef || activeRef.current)) setLoading(false);
      }
    },
    [token, text, loadDisplayRefillAlerts]
  );

  useEffect(() => {
    const activeRef = { current: true };
    loadPortalByToken({ activeRef });
    return () => {
      activeRef.current = false;
    };
  }, [loadPortalByToken]);

  const wallet = portal?.wallet_summary || {};
  const payrollExists = Boolean(
    wallet?.payroll_id ||
    wallet?.payroll_status === "generated" ||
    wallet?.payroll_status === "paid" ||
    portal?.payroll_id ||
    portal?.payroll_status === "generated" ||
    portal?.payroll_status === "paid"
  );
  const payrollStatusValue = payrollExists ? (wallet.payroll_status || portal?.payment_status) : "not_generated";
  const profile = portal?.employee_profile || portal?.employee || {};
  const attendance = portal?.attendance?.summary || portal?.recent_attendance_summary || {};
  const attendanceRows = safeArray(portal?.attendance?.timeline);
  const employeeRequests = safeArray(portal?.employee_requests);
  const employeeNotifications = safeArray(portal?.notifications);
  const pendingDisplayRefillAlerts = safeArray(displayRefillAlerts).filter((item) => String(item.status || "pending") === "pending");
  const currentShift = portal?.currentShift || profile.currentShift || {};
  const ui = (key) => text[key] || labels.en[key] || key;
  const showInstallCard = !standalone && (Boolean(installPrompt) || isIosDevice());
  const clearPortalToast = useCallback(() => {
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
    setActiveToast(null);
  }, []);
  const showPortalToast = useCallback((message, type = "success") => {
    const safeMessage = String(message || "").trim();
    if (!safeMessage) return;
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    setActiveToast({ message: safeMessage, type });
    toastTimerRef.current = window.setTimeout(() => {
      setActiveToast(null);
      toastTimerRef.current = null;
    }, 3500);
  }, []);
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
  const pendingTasks = tasks.filter((task) => ["pending", "overdue", "reassigned"].includes(taskStatusKey(task.status)));
  const inProgressTasks = tasks.filter((task) => taskStatusKey(task.status) === "in_progress");
  const completedTasks = tasks.filter((task) => ["completed", "done"].includes(taskStatusKey(task.status)));
  const mobileTabs = [
    ["home", ui("homeTab"), Home],
    ["tasks", text.tasksTab, ClipboardList],
    ["requests", text.requestsTab, MessageCircle],
    ["display-refill", ui("displayRefillTab"), AlertTriangle],
    ["attendance", text.attendanceTab, CalendarDays],
    ["wallet", ui("walletOnlyTab"), CreditCard],
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
  const requestBadgeIds = useMemo(
    () => employeeRequests
      .filter((item) => ["approved", "rejected"].includes(String(item.status || "").toLowerCase()))
      .map((item) => String(item.id)),
    [employeeRequests]
  );
  const taskBadgeIds = useMemo(
    () => tasks
      .filter((task) => ["pending", "overdue", "reassigned"].includes(taskStatusKey(task.status)))
      .map((task) => String(task.id)),
    [tasks]
  );
  const notificationBadgeIds = useMemo(
    () => employeeNotifications
      .map((item) => String(item.id || `${item.type || "notification"}-${item.order_id || item.created_at || item.title || item.body || ""}`))
      .filter(Boolean),
    [employeeNotifications]
  );
  const requestBadgeSignature = requestBadgeIds.join("|");
  const taskBadgeSignature = taskBadgeIds.join("|");
  const notificationBadgeSignature = notificationBadgeIds.join("|");
  const displayRefillBadgeIds = useMemo(
    () => pendingDisplayRefillAlerts.map((item) => String(item.id)).filter(Boolean),
    [pendingDisplayRefillAlerts]
  );
  const displayRefillBadgeSignature = displayRefillBadgeIds.join("|");
  const totalBadgeCount = badgeCounts.unreadChats + badgeCounts.pendingNotifications + badgeCounts.newTasks + badgeCounts.unreadNotifications + badgeCounts.displayRefillAlerts;
  const chatPanelStyle = useMemo(
    () => ({
      height: "100dvh",
      maxHeight: "100dvh",
    }),
    []
  );
  const chatMessagesStyle = useMemo(
    () => ({
      backgroundColor: "#0b141a",
      backgroundImage: "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.055) 1px, transparent 0), linear-gradient(135deg, rgba(20,184,166,0.035), transparent 35%, rgba(15,23,42,0.18))",
      backgroundSize: "18px 18px, 100% 100%",
    }),
    []
  );

  useEffect(() => () => {
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
  }, []);

  useEffect(() => {
    clearPortalToast();
  }, [activeTab, clearPortalToast]);

  useEffect(() => {
    if (!activeToast || !isBrowser()) return undefined;
    const dismissOnScroll = () => clearPortalToast();
    window.addEventListener("scroll", dismissOnScroll, { passive: true });
    return () => window.removeEventListener("scroll", dismissOnScroll);
  }, [activeToast, clearPortalToast]);

  useEffect(() => {
    setEmployeeAppBadge(totalBadgeCount);
    console.info("[employee-badge:update-total]", { total: totalBadgeCount, ...badgeCounts });
    postEmployeeBadgeMessage({ type: "employee-portal:badge-sync", counts: badgeCounts });
  }, [badgeCounts, totalBadgeCount]);

  useEffect(() => {
    if (!portal || !token) return undefined;
    const viewed = readBadgeSet(token, "requests");
    const nextCount = requestBadgeIds.filter((id) => !viewed.has(id)).length;
    setBadgeCounts((current) => ({ ...current, pendingNotifications: activeTab === "requests" ? 0 : nextCount }));
    return undefined;
  }, [activeTab, portal, requestBadgeSignature, token]);

  useEffect(() => {
    if (!portal || !token) return undefined;
    const viewed = readBadgeSet(token, "tasks");
    const nextCount = taskBadgeIds.filter((id) => !viewed.has(id)).length;
    setBadgeCounts((current) => ({ ...current, newTasks: activeTab === "tasks" ? 0 : nextCount }));
    return undefined;
  }, [activeTab, portal, taskBadgeSignature, token]);

  useEffect(() => {
    if (!portal || !token) return undefined;
    const viewed = readBadgeSet(token, "notifications");
    const nextCount = employeeNotifications.filter((item) => {
      const id = String(item.id || `${item.type || "notification"}-${item.order_id || item.created_at || item.title || item.body || ""}`);
      return !item.read_at && !viewed.has(id);
    }).length;
    setBadgeCounts((current) => ({ ...current, unreadNotifications: activeTab === "notifications" ? 0 : nextCount }));
    return undefined;
  }, [activeTab, employeeNotifications, notificationBadgeSignature, notificationSeenVersion, portal, token]);

  useEffect(() => {
    if (!portal || !token) return undefined;
    const viewed = readBadgeSet(token, "display-refill");
    const nextCount = pendingDisplayRefillAlerts.filter((item) => !item.is_read && !viewed.has(String(item.id))).length;
    setBadgeCounts((current) => ({ ...current, displayRefillAlerts: activeTab === "display-refill" ? 0 : nextCount }));
    return undefined;
  }, [activeTab, displayRefillBadgeSignature, pendingDisplayRefillAlerts, portal, token]);

  useEffect(() => {
    if (!token || activeTab !== "requests") return undefined;
    writeBadgeSet(token, "requests", requestBadgeIds);
    console.info("[employee-badge:clear-portion]", { portion: "requests" });
    postEmployeeBadgeMessage({ type: "EMPLOYEE_BADGE_CLEAR_PORTION", portion: "requests" });
    setBadgeCounts((current) => {
      const next = { ...current, pendingNotifications: 0 };
      setEmployeeAppBadge(next.unreadChats + next.pendingNotifications + next.newTasks + next.unreadNotifications + next.displayRefillAlerts);
      return next;
    });
    return undefined;
  }, [activeTab, requestBadgeSignature, token]);

  useEffect(() => {
    if (!token || activeTab !== "tasks") return undefined;
    writeBadgeSet(token, "tasks", taskBadgeIds);
    console.info("[employee-badge:clear-portion]", { portion: "tasks" });
    postEmployeeBadgeMessage({ type: "EMPLOYEE_BADGE_CLEAR_PORTION", portion: "tasks" });
    setBadgeCounts((current) => {
      const next = { ...current, newTasks: 0 };
      setEmployeeAppBadge(next.unreadChats + next.pendingNotifications + next.newTasks + next.unreadNotifications + next.displayRefillAlerts);
      return next;
    });
    return undefined;
  }, [activeTab, taskBadgeSignature, token]);

  useEffect(() => {
    if (!token || activeTab !== "notifications") return undefined;
    writeBadgeSet(token, "notifications", notificationBadgeIds);
    console.info("[employee-badge:clear-portion]", { portion: "notifications" });
    postEmployeeBadgeMessage({ type: "EMPLOYEE_BADGE_CLEAR_PORTION", portion: "notifications" });
    setPortal((current) => current ? {
      ...current,
      notifications: safeArray(current.notifications).map((item) => ({ ...item, read_at: item.read_at || new Date().toISOString() })),
      unread_notifications_count: 0,
    } : current);
    setBadgeCounts((current) => {
      const next = { ...current, unreadNotifications: 0 };
      setEmployeeAppBadge(next.unreadChats + next.pendingNotifications + next.newTasks + next.unreadNotifications + next.displayRefillAlerts);
      return next;
    });
    setNotificationSeenVersion((current) => current + 1);
    return undefined;
  }, [activeTab, notificationBadgeSignature, token]);

  useEffect(() => {
    if (!token || activeTab !== "display-refill") return undefined;
    writeBadgeSet(token, "display-refill", displayRefillBadgeIds);
    console.info("[employee-badge:clear-portion]", { portion: "display-refill" });
    postEmployeeBadgeMessage({ type: "EMPLOYEE_BADGE_CLEAR_PORTION", portion: "display-refill" });
    setBadgeCounts((current) => {
      const next = { ...current, displayRefillAlerts: 0 };
      setEmployeeAppBadge(next.unreadChats + next.pendingNotifications + next.newTasks + next.unreadNotifications + next.displayRefillAlerts);
      return next;
    });
    pendingDisplayRefillAlerts.filter((item) => !item.is_read).forEach((item) => {
      api.patch(`/employee-portal/${encodeURIComponent(token)}/display-refill-alerts/${encodeURIComponent(item.id)}/read`).catch(() => {});
    });
    setDisplayRefillAlerts((current) => safeArray(current).map((item) => ({ ...item, is_read: true })));
    return undefined;
  }, [activeTab, displayRefillBadgeSignature, token]);

  useEffect(() => {
    if (!chatOpen) return undefined;
    console.info("[employee-badge:clear-portion]", { portion: "chat" });
    postEmployeeBadgeMessage({ type: "EMPLOYEE_BADGE_CLEAR_PORTION", portion: "chat" });
    setBadgeCounts((current) => {
      const next = { ...current, unreadChats: 0 };
      setEmployeeAppBadge(next.unreadChats + next.pendingNotifications + next.newTasks + next.unreadNotifications + next.displayRefillAlerts);
      return next;
    });
    return undefined;
  }, [chatOpen]);

  useEffect(() => {
    if (!isBrowser() || !("serviceWorker" in navigator)) return undefined;
    const onServiceWorkerMessage = (event) => {
      if (event.data?.type !== "employee-portal:push-badge") return;
      const tag = String(event.data.tag || event.data.payload?.tag || event.data.payload?.data?.tag || "");
      const badgeType = tag === "employee-chat"
        ? "unreadChats"
        : ["task-assigned", "staff-task-update", "staff-task-overdue"].some((value) => tag.includes(value))
          ? "newTasks"
          : tag === "display_refill_alert"
            ? "displayRefillAlerts"
          : ["advance-approved", "advance-rejected", "leave-approved", "leave-rejected"].includes(tag)
            ? "pendingNotifications"
            : ["commission-earned", "commission_earned", "payroll-generated", "bonus-added", "penalty-added"].includes(tag)
              ? "unreadNotifications"
            : "";
      if (!badgeType) return;
      setBadgeCounts((current) => ({
        ...current,
        [badgeType]: badgeType === "unreadChats" && chatOpen
          ? 0
          : badgeType === "newTasks" && activeTab === "tasks"
            ? 0
            : badgeType === "pendingNotifications" && activeTab === "requests"
              ? 0
              : badgeType === "displayRefillAlerts" && activeTab === "display-refill"
                ? 0
              : badgeType === "unreadNotifications" && activeTab === "notifications"
                ? 0
                : Number(current[badgeType] || 0) + 1,
      }));
    };
    navigator.serviceWorker.addEventListener("message", onServiceWorkerMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onServiceWorkerMessage);
  }, [activeTab, chatOpen]);

  useEffect(() => {
    if (!portal || !token || !profile.id) return undefined;
    const requestSocket = createSocket(SOCKET_URL, {
      autoConnect: false,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      reconnectionDelayMax: 8000,
      transports: ["websocket", "polling"],
      auth: { employeePortalToken: token },
    });
    requestSocketRef.current = requestSocket;

    const onRequestUpdated = (event = {}) => {
      if (String(event.employee_id || "") !== String(profile.id || "")) return;
      const notice = event.status === "approved"
        ? "تمت الموافقة على طلبك"
        : event.status === "rejected"
          ? "تم رفض طلبك"
          : "تم تحديث طلبك";
      showPortalToast(notice);
      setPortalNotice(notice);
      loadPortalByToken({ silent: true, clearNotice: false });
    };
    const onPortalNotification = (event = {}) => {
      const notification = event.notification || event;
      if (String(notification.employee_id || "") !== String(profile.id || "")) return;
      const notice = notification.title || notification.body || "تنبيه جديد";
      showPortalToast(notification.body || notice);
      setPortalNotice(notification.body || notice);
      setBadgeCounts((current) => ({
        ...current,
        unreadNotifications: activeTab === "notifications" ? 0 : Number(current.unreadNotifications || 0) + 1,
      }));
      loadPortalByToken({ silent: true, clearNotice: false });
    };
    const onDisplayRefillAlert = (event = {}) => {
      const alert = event.alert || event;
      const alertEmployeeId = String(alert.employee_id || alert.employeeId || "");
      const profileEmployeeId = String(profile.id || "");
      const alertBranchId = String(alert.branch_id || alert.branchId || "");
      const profileBranchId = String(profile.branch_id || profile.branchId || "");
      const alertTenantId = String(alert.tenant_id || alert.tenantId || "");
      const profileTenantId = String(profile.tenant_id || profile.tenantId || "");
      const tenantMatches = !alertTenantId || !profileTenantId || alertTenantId === profileTenantId;
      const assignedToEmployee = tenantMatches && alertEmployeeId && alertEmployeeId === profileEmployeeId;
      const assignedToBranch = tenantMatches && !alertEmployeeId && alertBranchId && profileBranchId && alertBranchId === profileBranchId;
      if (!assignedToEmployee && !assignedToBranch) return;
      showPortalToast(alert.replacement_size ? `اعرض مقاس ${alert.replacement_size} بدل ${alert.sold_size}` : "لا يوجد مقاس بديل متاح", "success");
      setDisplayRefillAlerts((current) => [alert, ...safeArray(current).filter((item) => String(item.id) !== String(alert.id))]);
      setBadgeCounts((current) => ({
        ...current,
        displayRefillAlerts: activeTab === "display-refill" ? 0 : Number(current.displayRefillAlerts || 0) + 1,
      }));
    };

    requestSocket.on("employee_portal:request_updated", onRequestUpdated);
    requestSocket.on("employee_portal:notification", onPortalNotification);
    requestSocket.on("employee_portal:display_refill_alert", onDisplayRefillAlert);
    requestSocket.connect();

    return () => {
      requestSocket.off("employee_portal:request_updated", onRequestUpdated);
      requestSocket.off("employee_portal:notification", onPortalNotification);
      requestSocket.off("employee_portal:display_refill_alert", onDisplayRefillAlert);
      requestSocket.disconnect();
      if (requestSocketRef.current === requestSocket) requestSocketRef.current = null;
    };
  }, [activeTab, portal, token, profile.id, loadPortalByToken, showPortalToast]);

  const resolveDisplayRefill = useCallback(async (alertId) => {
    if (!token || !alertId) return;
    try {
      setDisplayRefillSavingId(String(alertId));
      const response = await api.patch(`/employee-portal/${encodeURIComponent(token)}/display-refill-alerts/${encodeURIComponent(alertId)}/resolve`);
      setDisplayRefillAlerts((current) => safeArray(current).map((item) => String(item.id) === String(alertId) ? { ...item, ...(response.alert || {}), status: "resolved", is_read: true } : item));
      showPortalToast("تم تحديث نواقص العرض");
    } catch (err) {
      showPortalToast(err?.message || "تعذر تحديث نواقص العرض", "error");
    } finally {
      setDisplayRefillSavingId("");
    }
  }, [showPortalToast, token]);

  const overviewCards = useMemo(() => {
    if (!portal) return [];
    return [
      { label: text.netSalary, value: payrollExists ? money(wallet.current_net_salary ?? portal.net_salary) : "-", icon: WalletCards, tone: "emerald" },
      { label: text.totalAdvances, value: money(wallet.total_advances ?? portal.advances), icon: CreditCard, tone: "amber" },
      { label: text.pendingCommissions, value: money(wallet.pending_commissions), icon: Coins, tone: "sky" },
      { label: text.totalDeductions, value: money(wallet.total_deductions ?? portal.total_deductions), icon: ReceiptText, tone: "red" },
    ];
  }, [payrollExists, portal, text, wallet]);

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

  const loadEmployeeChat = async ({ silent = false } = {}) => {
    if (!token) return;
    try {
      if (!silent) setChatLoading(true);
      setChatError("");
      const response = await api.get(`/employee-portal/${encodeURIComponent(token)}/chat`, {
        suppressErrorStatuses: [400, 404, 429],
      });
      setChatThread(response.thread || null);
      setChatMessages(safeArray(response.messages));
      if (chatOpen) {
        console.info("[employee-badge:clear-portion]", { portion: "chat", source: "chat-fetch" });
        postEmployeeBadgeMessage({ type: "EMPLOYEE_BADGE_CLEAR_PORTION", portion: "chat" });
        setBadgeCounts((current) => {
          const next = { ...current, unreadChats: 0 };
          setEmployeeAppBadge(next.unreadChats + next.pendingNotifications + next.newTasks + next.unreadNotifications + next.displayRefillAlerts);
          return next;
        });
      }
    } catch (err) {
      setChatError(err?.responseBody?.message || err?.message || ui("chatLoadError"));
    } finally {
      if (!silent) setChatLoading(false);
    }
  };

  useEffect(() => {
    if (!chatOpen || !portal) return undefined;
    loadEmployeeChat();
    return undefined;
  }, [chatOpen, portal, token]);

  useEffect(() => {
    if (!chatOpen || !portal || !token) return undefined;
    const chatSocket = createSocket(SOCKET_URL, {
      autoConnect: false,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      reconnectionDelayMax: 8000,
      transports: ["websocket", "polling"],
      auth: { employeePortalToken: token },
    });
    chatSocketRef.current = chatSocket;

    const onConnect = () => setChatSocketConnected(true);
    const onDisconnect = () => setChatSocketConnected(false);
    const onMessage = (payload = {}) => {
      const message = payload.message;
      if (!message?.id) return;
      setChatMessages((current) => {
        if (current.some((item) => String(item.id) === String(message.id))) return current;
        return [...current, message];
      });
    };
    const onRead = (payload = {}) => {
      if (!payload.thread_id) return;
      setChatMessages((current) =>
        current.map((message) =>
          message.sender_type === payload.read_sender_type && !message.read_at
            ? { ...message, read_at: payload.at || new Date().toISOString() }
            : message
        )
      );
    };
    const onTyping = (payload = {}) => {
      if (payload.sender_type !== "admin") return;
      setChatTyping(true);
      if (chatTypingTimerRef.current) window.clearTimeout(chatTypingTimerRef.current);
      chatTypingTimerRef.current = window.setTimeout(() => setChatTyping(false), 3000);
    };
    const onStopTyping = (payload = {}) => {
      if (payload.sender_type !== "admin") return;
      setChatTyping(false);
    };

    chatSocket.on("connect", onConnect);
    chatSocket.on("disconnect", onDisconnect);
    chatSocket.on("connect_error", onDisconnect);
    chatSocket.on("employee-chat:new-message", onMessage);
    chatSocket.on("employee-chat:read", onRead);
    chatSocket.on("employee-chat:typing", onTyping);
    chatSocket.on("employee-chat:stop-typing", onStopTyping);
    chatSocket.connect();

    return () => {
      chatSocket.off("connect", onConnect);
      chatSocket.off("disconnect", onDisconnect);
      chatSocket.off("connect_error", onDisconnect);
      chatSocket.off("employee-chat:new-message", onMessage);
      chatSocket.off("employee-chat:read", onRead);
      chatSocket.off("employee-chat:typing", onTyping);
      chatSocket.off("employee-chat:stop-typing", onStopTyping);
      chatSocket.disconnect();
      if (chatSocketRef.current === chatSocket) chatSocketRef.current = null;
      setChatSocketConnected(false);
    };
  }, [chatOpen, portal, token]);

  useEffect(() => {
    if (!chatOpen || !portal || chatSocketConnected) return undefined;
    const timer = window.setInterval(() => loadEmployeeChat({ silent: true }), 12000);
    return () => window.clearInterval(timer);
  }, [chatOpen, portal, chatSocketConnected, token]);

  useEffect(() => {
    if (!chatOpen) return undefined;
    const bodyOverflow = document.body.style.overflow;
    const htmlOverflow = document.documentElement.style.overflow;
    const bodyWidth = document.body.style.width;
    const bodyHeight = document.body.style.height;
    const htmlHeight = document.documentElement.style.height;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    document.body.style.width = "100%";
    return () => {
      document.activeElement?.blur?.();
      chatInputRef.current?.blur?.();
      document.body.style.overflow = bodyOverflow;
      document.documentElement.style.overflow = htmlOverflow;
      document.body.style.width = bodyWidth;
      document.body.style.height = bodyHeight;
      document.documentElement.style.height = htmlHeight;
      window.scrollTo(0, 0);
      window.dispatchEvent(new Event("resize"));
    };
  }, [chatOpen]);

  useEffect(() => {
    if (!chatOpen) return undefined;
    window.setTimeout(() => {
      if (chatMessagesRef.current) {
        chatMessagesRef.current.scrollTop = chatMessagesRef.current.scrollHeight;
      }
    }, 50);
    return undefined;
  }, [chatOpen, chatMessages.length]);

  const submitChatMessage = async (event) => {
    event.preventDefault();
    const message = chatBody.trim();
    if ((!message && !chatAttachment) || chatSaving) return;
    try {
      setChatSaving(true);
      setChatError("");
      const formData = new FormData();
      if (message) formData.append("body", message);
      if (chatAttachment) formData.append("attachment", chatAttachment);
      if (replyToChat?.id) formData.append("reply_to_message_id", replyToChat.id);
      await api.post(`/employee-portal/${encodeURIComponent(token)}/chat/messages`, formData, {
        suppressErrorStatuses: [400, 404, 429],
      });
      setChatBody("");
      setChatAttachment(null);
      setReplyToChat(null);
      if (chatFileInputRef.current) chatFileInputRef.current.value = "";
      await loadEmployeeChat({ silent: true });
    } catch (err) {
      setChatError(err?.responseBody?.message || err?.message || ui("chatSendError"));
    } finally {
      setChatSaving(false);
    }
  };

  const chooseChatAttachment = (event) => {
    const file = event.target.files?.[0] || null;
    if (!file) {
      setChatAttachment(null);
      return;
    }
    if (!allowedChatAttachment(file) || file.size > 10 * 1024 * 1024) {
      setChatError(ui("unsupportedAttachment"));
      event.target.value = "";
      setChatAttachment(null);
      return;
    }
    setChatError("");
    setChatAttachment(file);
  };

  const emitChatTyping = () => {
    const socket = chatSocketRef.current;
    if (!socket?.connected) return;
    if (!chatTypingStopRef.current) socket.emit("employee-chat:typing", { thread_id: chatThread?.id || null });
    if (chatTypingStopRef.current) window.clearTimeout(chatTypingStopRef.current);
    chatTypingStopRef.current = window.setTimeout(() => {
      socket.emit("employee-chat:stop-typing", { thread_id: chatThread?.id || null });
      chatTypingStopRef.current = null;
    }, 2500);
  };

  const scrollChatToBottom = () => {
    if (!chatMessagesRef.current) return;
    chatMessagesRef.current.scrollTop = chatMessagesRef.current.scrollHeight;
    setShowChatJump(false);
  };

  const resetAfterChatClose = useCallback(() => {
    document.activeElement?.blur?.();
    chatInputRef.current?.blur?.();
    document.body.style.height = "";
    document.documentElement.style.height = "";
    window.scrollTo(0, 0);
    window.dispatchEvent(new Event("resize"));
  }, []);

  const closeEmployeeChat = useCallback(() => {
    document.activeElement?.blur?.();
    chatInputRef.current?.blur?.();
    window.setTimeout(() => {
      setChatOpen(false);
      window.requestAnimationFrame?.(resetAfterChatClose);
      window.setTimeout(resetAfterChatClose, 50);
    }, 50);
  }, [resetAfterChatClose]);

  const handleChatScroll = () => {
    const node = chatMessagesRef.current;
    if (!node) return;
    setShowChatJump(node.scrollHeight - node.scrollTop - node.clientHeight > 140);
  };

  const scrollToChatMessage = (messageId) => {
    const node = document.getElementById(`employee-chat-message-${messageId}`);
    if (!node) return;
    node.scrollIntoView({ block: "center", behavior: "smooth" });
    node.classList.add("ring-2", "ring-emerald-300", "ring-offset-2", "ring-offset-[#0b141a]");
    window.setTimeout(() => {
      node.classList.remove("ring-2", "ring-emerald-300", "ring-offset-2", "ring-offset-[#0b141a]");
    }, 1200);
  };

  const beginChatSwipe = (event, message) => {
    const touch = event.touches?.[0];
    if (!touch) return;
    chatSwipeRef.current = { id: message.id, startX: touch.clientX, startY: touch.clientY, active: true };
  };

  const moveChatSwipe = (event, message) => {
    const touch = event.touches?.[0];
    const swipe = chatSwipeRef.current;
    if (!touch || !swipe.active || String(swipe.id) !== String(message.id)) return;
    const deltaX = touch.clientX - swipe.startX;
    const deltaY = touch.clientY - swipe.startY;
    if (Math.abs(deltaY) > 36 || deltaX > -52) return;
    setReplyToChat(message);
    chatSwipeRef.current = { id: null, startX: 0, startY: 0, active: false };
    if (navigator.vibrate) navigator.vibrate(10);
  };

  const endChatSwipe = () => {
    chatSwipeRef.current = { id: null, startX: 0, startY: 0, active: false };
  };

  const startVoiceRecording = async () => {
    if (!recordingState.supported || recordingState.active) return;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = MediaRecorder.isTypeSupported?.("audio/webm") ? "audio/webm" : "";
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    recordingChunksRef.current = [];
    recorder.ondataavailable = (event) => {
      if (event.data?.size) recordingChunksRef.current.push(event.data);
    };
    recorder.onstop = () => stream.getTracks().forEach((track) => track.stop());
    mediaRecorderRef.current = recorder;
    recorder.start();
    setRecordingState((current) => ({ ...current, active: true, seconds: 0 }));
    recordingTimerRef.current = window.setInterval(() => {
      setRecordingState((current) => ({ ...current, seconds: current.seconds + 1 }));
    }, 1000);
  };

  const cancelVoiceRecording = () => {
    mediaRecorderRef.current?.stop();
    recordingChunksRef.current = [];
    if (recordingTimerRef.current) window.clearInterval(recordingTimerRef.current);
    setRecordingState((current) => ({ ...current, active: false, seconds: 0 }));
  };

  const sendVoiceRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder) return;
    recorder.onstop = async () => {
      recorder.stream?.getTracks?.().forEach((track) => track.stop());
      if (recordingTimerRef.current) window.clearInterval(recordingTimerRef.current);
      const blob = new Blob(recordingChunksRef.current, { type: recorder.mimeType || "audio/webm" });
      recordingChunksRef.current = [];
      setRecordingState((current) => ({ ...current, active: false, seconds: 0 }));
      if (!blob.size) return;
      setChatAttachment(new File([blob], `voice-${Date.now()}.webm`, { type: blob.type || "audio/webm" }));
    };
    recorder.stop();
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
    setStandalone(isStandaloneApp());
  };

  const downloadPayslip = () => {
    const p = portal?.payslip;
    if (!payrollExists || !p) return;
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

  const enableNotifications = async ({ forceRefresh = false } = {}) => {
    if (!pushSupported()) {
      setNotificationState("unsupported");
      setNotificationMessage("الإشعارات غير مدعومة على هذا المتصفح.");
      return;
    }
    try {
      setNotificationSaving(true);
      setNotificationMessage("");
      const permission = window.Notification.permission === "default"
        ? await window.Notification.requestPermission()
        : window.Notification.permission;
      setNotificationState(permission);
      if (permission !== "granted") {
        setNotificationMessage("فعّل الإشعارات من إعدادات المتصفح لاستقبال التنبيهات.");
        return;
      }

      const keyResponse = await api.get(`/employee-portal/${encodeURIComponent(token)}/push/public-key`);
      const publicKey = keyResponse?.publicKey || "";
      if (!publicKey) {
        setNotificationMessage("الإشعارات جاهزة على الجهاز، لكن مفاتيح الإرسال غير مفعلة على الخادم.");
        return;
      }
      const registration = forceRefresh
        ? await navigator.serviceWorker.register(`/employee-portal-sw.js?v=${Date.now()}`)
        : await navigator.serviceWorker.ready;
      let existing = await registration.pushManager.getSubscription();
      if (existing && (forceRefresh || !pushSubscriptionUsesKey(existing, publicKey))) {
        await api.post(`/employee-portal/${encodeURIComponent(token)}/push/unsubscribe`, {
          subscription: existing.toJSON(),
          endpoint: existing.endpoint,
        }).catch(() => null);
        await existing.unsubscribe().catch(() => null);
        existing = null;
      }
      const subscription = existing || await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      const subscriptionJson = subscription.toJSON();
      const applicationServerKeyLength = urlBase64ToUint8Array(publicKey).length;
      console.info("[employee-push:subscribe-request]", {
        employee_id: profile.id || portal?.employee?.id || null,
        endpointHost: endpointHost(subscriptionJson.endpoint),
        p256dhLength: String(subscriptionJson.keys?.p256dh || "").length,
        authLength: String(subscriptionJson.keys?.auth || "").length,
        applicationServerKeyLength,
      });
      await api.post(`/employee-portal/${encodeURIComponent(token)}/push/subscribe`, {
        subscription: subscriptionJson,
        application_server_key_length: applicationServerKeyLength,
        portal_url: `${window.location.origin}/employee-app/${encodeURIComponent(token)}${window.location.search}`,
      });
      setNotificationState("granted");
      setNotificationMessage(forceRefresh ? "تم تحديث الإشعارات بنجاح" : "الإشعارات مفعلة");
    } catch (err) {
      console.warn("[employee-payroll-portal] push subscription failed", err);
      setNotificationMessage(err?.responseBody?.message || err?.message || "تعذر تفعيل الإشعارات الآن.");
    } finally {
      setNotificationSaving(false);
    }
  };

  const resetNotifications = async () => {
    if (!pushSupported()) {
      setNotificationState("unsupported");
      setNotificationMessage("الإشعارات غير مدعومة على هذا الجهاز.");
      return;
    }
    try {
      setNotificationSaving(true);
      setNotificationMessage("");
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (const registration of registrations) {
        const scriptUrl = registration.active?.scriptURL || registration.waiting?.scriptURL || registration.installing?.scriptURL || "";
        const subscription = await registration.pushManager?.getSubscription?.().catch(() => null);
        if (subscription?.endpoint) {
          await api.post(`/employee-portal/${encodeURIComponent(token)}/push/unsubscribe`, {
            subscription: subscription.toJSON(),
            endpoint: subscription.endpoint,
          }).catch(() => null);
          await subscription.unsubscribe().catch(() => null);
        }
        if (scriptUrl.includes("/employee-portal-sw.js") || registration.scope.includes("/employee-app") || registration.scope === `${window.location.origin}/`) {
          await registration.unregister().catch(() => null);
        }
      }
      const permission = window.Notification.permission === "default"
        ? await window.Notification.requestPermission()
        : window.Notification.permission;
      setNotificationState(permission);
      if (permission !== "granted") {
        setNotificationMessage("فعّل الإشعارات من إعدادات المتصفح لاستقبال التنبيهات.");
        return;
      }
      await navigator.serviceWorker.register(`/employee-portal-sw.js?v=${Date.now()}`);
      await navigator.serviceWorker.ready;
      await enableNotifications({ forceRefresh: true });
      setNotificationMessage("تمت إعادة ضبط الإشعارات بنجاح");
    } catch (err) {
      console.warn("[employee-payroll-portal] push reset failed", err);
      setNotificationMessage(err?.responseBody?.message || err?.message || "تعذر إعادة ضبط الإشعارات الآن.");
    } finally {
      setNotificationSaving(false);
    }
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
    <main dir={direction} className="min-h-[100dvh] overflow-x-hidden bg-slate-100 px-3 pb-[calc(110px+env(safe-area-inset-bottom))] pt-[env(safe-area-inset-top)] text-slate-950">
      <div className="mx-auto max-w-md">
        <header className="flex items-center justify-between gap-3 py-0.5">
          <div className="flex items-center gap-2 text-sm font-black text-slate-700">
            <ShieldCheck className="h-4 w-4 text-emerald-600" />
            <span>{ui("employeeDashboard")}</span>
          </div>
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
          <section className="mt-1 space-y-4 pb-4">
            <div className="sticky top-[calc(env(safe-area-inset-top)+8px)] z-30 flex min-h-[64px] items-center gap-2 rounded-2xl border border-slate-200 bg-white/95 px-2.5 py-2 shadow-sm backdrop-blur">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-slate-950 text-sm font-black text-white">
                {profile.photo_url ? <img src={profile.photo_url} alt="" className="h-full w-full object-cover" /> : profile.avatar_initials || <UserRound className="h-5 w-5" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-black leading-5" dir="auto">{profile.name}</div>
                <div className="mt-0.5 flex items-center gap-1.5 text-[11px] font-black text-slate-500">
                  <span className={`h-2 w-2 rounded-full ${isCheckedIn ? "bg-emerald-500" : isCheckedOut ? "bg-slate-400" : "bg-red-500"}`} />
                  <span className="truncate">{employeeStatus}</span>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {[
                  {
                    key: "notifications",
                    count: badgeCounts.unreadNotifications || 0,
                    label: ui("notificationsShort"),
                    Icon: Bell,
                    className: "bg-emerald-50 text-emerald-700",
                  },
                  {
                    key: "display-refill",
                    count: badgeCounts.displayRefillAlerts || 0,
                    label: ui("displayRefillShort"),
                    Icon: AlertTriangle,
                    className: "bg-amber-50 text-amber-700",
                  },
                  { key: "tasks", count: badgeCounts.newTasks || 0, label: ui("tasksShort"), Icon: ClipboardList, className: "bg-blue-50 text-blue-700" },
                  { key: "requests", count: badgeCounts.pendingNotifications || 0, label: ui("requestsShort"), Icon: MessageCircle, className: "bg-orange-50 text-orange-700" },
                ].filter((item) => Number(item.count || 0) > 0).map(({ key, count, label, Icon, className }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setActiveTab(key)}
                    title={`${label}: ${count}`}
                    aria-label={`${label}: ${count}`}
                    className={`flex min-w-[42px] flex-col items-center justify-center rounded-xl px-1.5 py-1 text-[9px] font-black leading-none ${className}`}
                  >
                    <span className="inline-flex items-center gap-0.5" dir="ltr">
                      <Icon className="h-3 w-3" />
                      <span>{count}</span>
                    </span>
                    <span className="mt-0.5 max-w-[42px] truncate">{label}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="h-6 shrink-0" aria-hidden="true" />

            {activeTab === "home" && showInstallCard ? (
              <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-950 shadow-sm">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white text-emerald-700 shadow-sm">
                    <Smartphone className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-black">بوابة الموظف كتطبيق</h3>
                    <p className="mt-1 text-xs font-bold leading-5 text-emerald-800">
                      {isIosDevice()
                        ? "على iPhone: اضغط مشاركة ثم Add to Home Screen ثم افتح التطبيق من الأيقونة وفعّل الإشعارات."
                        : "أضف بوابة الموظف إلى الشاشة الرئيسية لتعمل كتطبيق مستقل."}
                    </p>
                    {installPrompt ? (
                      <button type="button" onClick={installApp} className="mt-3 inline-flex min-h-10 items-center justify-center gap-2 rounded-2xl bg-emerald-700 px-4 text-xs font-black text-white">
                        <Download className="h-4 w-4" />
                        {text.addHome}
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}

            {activeTab === "notifications" ? <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-sm font-black text-slate-950">
                    {notificationState === "granted" ? "الإشعارات مفعلة" : "فعّل الإشعارات لاستقبال تنبيهات المهام والطلبات والراتب"}
                  </h3>
                  <p className="mt-1 text-xs font-bold leading-5 text-slate-500">
                    {isIosDevice() && !standalone
                      ? "على iPhone: اضغط مشاركة ثم Add to Home Screen ثم افتح التطبيق من الأيقونة وفعّل الإشعارات."
                      : notificationMessage || (notificationState === "unsupported" ? "الإشعارات غير مدعومة على هذا الجهاز." : "سنرسل تنبيهًا عند تعيين مهمة أو تحديث طلب أو إنشاء الراتب.")}
                  </p>
                </div>
                {notificationState !== "granted" && notificationState !== "unsupported" ? (
                  <button type="button" onClick={() => enableNotifications()} disabled={notificationSaving} className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-2xl bg-slate-950 px-3 text-xs font-black text-white disabled:opacity-50">
                    {notificationSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                    تفعيل الإشعارات
                  </button>
                ) : null}
              </div>
              {notificationState === "granted" ? (
                <button type="button" onClick={resetNotifications} disabled={notificationSaving} className="mt-3 inline-flex min-h-10 items-center justify-center gap-2 rounded-2xl bg-slate-950 px-3 text-xs font-black text-white disabled:opacity-50">
                  {notificationSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  <span className="text-xs">إعادة ضبط الإشعارات</span>
                </button>
              ) : null}
            </div> : null}

            {activeTab === "notifications" ? (
              <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-base font-black">{ui("notificationsTab")}</h3>
                  <button
                    type="button"
                    onClick={() => setPortal((current) => current ? { ...current, notifications: safeArray(current.notifications).map((item) => ({ ...item, read_at: item.read_at || new Date().toISOString() })), unread_notifications_count: 0 } : current)}
                    className="rounded-xl bg-slate-100 px-3 py-2 text-[11px] font-black text-slate-700"
                  >
                    تعليم الكل كمقروء
                  </button>
                </div>
                <div className="mt-3 grid gap-2">
                  {employeeNotifications.length ? employeeNotifications.map((item) => {
                    const isDisplayRefill = item.type === "display_refill_alert";
                    return (
                    <button
                      key={item.id || `${item.type}-${item.order_id}`}
                      type="button"
                      onClick={() => {
                        setPortal((current) => current ? { ...current, notifications: safeArray(current.notifications).map((row) => String(row.id) === String(item.id) ? { ...row, read_at: row.read_at || new Date().toISOString() } : row) } : current);
                        if (item.type === "commission_earned") setActiveTab("salary");
                        if (isDisplayRefill) setActiveTab("display-refill");
                      }}
                      className={`rounded-2xl border px-3 py-2 text-start ${isDisplayRefill ? "border-amber-200 bg-amber-50" : "border-slate-100 bg-slate-50"}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className={`truncate text-sm font-black ${isDisplayRefill ? "text-amber-950" : "text-slate-900"}`} dir="auto">{isDisplayRefill ? "نواقص العرض" : item.title}</div>
                          <div className="mt-1 text-xs font-bold leading-5 text-slate-600" dir="auto">{item.body}</div>
                        </div>
                        {!item.read_at ? <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${isDisplayRefill ? "bg-amber-500" : "bg-emerald-500"}`} /> : null}
                      </div>
                      <div className="mt-1 text-[11px] font-bold text-slate-400"><DateSafe>{formatEmployeePortalDateTime(item.created_at, language)}</DateSafe></div>
                    </button>
                  );}) : (
                    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-3 py-5 text-center text-sm font-bold text-slate-500">{text.noTransactions}</div>
                  )}
                </div>
              </div>
            ) : null}

            {activeTab === "display-refill" ? (
              <div className="rounded-3xl border border-amber-200 bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-base font-black text-slate-950">نواقص العرض</h3>
                    <p className="mt-1 text-xs font-bold text-slate-500">المقاسات اللي محتاجة تتعرض مكان المقاس المباع.</p>
                  </div>
                  <button type="button" onClick={() => loadDisplayRefillAlerts()} className="inline-flex min-h-10 items-center justify-center rounded-xl bg-slate-100 px-3 text-[11px] font-black text-slate-700">
                    {displayRefillLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  </button>
                </div>
                <div className="mt-3 grid gap-3">
                  {pendingDisplayRefillAlerts.length ? pendingDisplayRefillAlerts.map((alert) => {
                    const imageSrc = alert.image_url
                      ? (/^https?:\/\//i.test(alert.image_url) ? alert.image_url : `${API_ORIGIN}${String(alert.image_url).startsWith("/") ? "" : "/"}${alert.image_url}`)
                      : "";
                    return (
                      <article key={alert.id} className="rounded-2xl border border-amber-100 bg-amber-50/70 p-3">
                        <div className="flex items-start gap-3">
                          <div className="h-20 w-20 shrink-0 overflow-hidden rounded-2xl border border-amber-100 bg-white">
                            {imageSrc ? <img src={imageSrc} alt="" className="h-full w-full object-cover" loading="lazy" /> : <div className="flex h-full w-full items-center justify-center text-amber-700"><AlertTriangle className="h-7 w-7" /></div>}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="inline-flex rounded-full bg-amber-200 px-2 py-1 text-[10px] font-black text-amber-950">ناقص عرض</div>
                            <h4 className="mt-2 text-sm font-black leading-5 text-slate-950" dir="auto">{alert.product_name}</h4>
                            {alert.color_name ? <div className="mt-1 text-xs font-black text-slate-600">اللون: {alert.color_name}</div> : null}
                            <div className="mt-2 grid gap-1 text-xs font-bold leading-5 text-slate-700">
                              <div>اتبيع المقاس المعروض: <span className="font-black">{alert.sold_size}</span></div>
                              <div className={alert.replacement_size ? "text-emerald-700" : "text-red-700"}>
                                {alert.replacement_size ? <>اعرض المقاس التالي: <span className="font-black">{alert.replacement_size}</span></> : "لا يوجد مقاس بديل متاح"}
                              </div>
                              {Number(alert.remaining_stock || 0) > 0 ? <div>المتاح: {alert.remaining_stock} قطع</div> : null}
                              {alert.invoice_number ? <div className="text-slate-500">الفاتورة: {alert.invoice_number}</div> : null}
                              <div className="text-[11px] text-slate-400"><DateSafe>{formatEmployeePortalDateTime(alert.created_at, language)}</DateSafe></div>
                            </div>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => resolveDisplayRefill(alert.id)}
                          disabled={displayRefillSavingId === String(alert.id)}
                          className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 text-sm font-black text-white disabled:opacity-60"
                        >
                          {displayRefillSavingId === String(alert.id) ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCheck className="h-4 w-4" />}
                          تم العرض
                        </button>
                      </article>
                    );
                  }) : (
                    <div className="rounded-2xl border border-dashed border-amber-200 bg-amber-50 px-3 py-8 text-center text-sm font-bold text-amber-800">{ui("displayRefillEmpty")}</div>
                  )}
                </div>
              </div>
            ) : null}

            {activeTab === "home" ? (
              <>
                <div className="relative z-0 mt-0 grid grid-cols-2 gap-2 [transform:none]">
                  {[
                    {
                      label: ui("attendanceDays"),
                      value: `${presentDays} ${ui("daysUnit")}`,
                      subtitle: `${ui("fromTotalDays")} ${expectedDays} ${ui("daysUnit")}`,
                      Icon: CalendarDays,
                    },
                    {
                      label: ui("pendingTasks"),
                      value: pendingTasks.length,
                      subtitle: ui("openTasksSubtitle"),
                      Icon: ClipboardList,
                    },
                    {
                      label: text.advances,
                      value: money(wallet.total_advances ?? portal.advances),
                      subtitle: ui("totalAdvancesSubtitle"),
                      Icon: CreditCard,
                      numeric: true,
                    },
                    {
                      label: text.netSalary,
                      value: payrollExists ? money(wallet.current_net_salary ?? portal.net_salary) : "-",
                      subtitle: portal.current_payroll_period || ui("currentMonthSubtitle"),
                      Icon: WalletCards,
                      numeric: true,
                    },
                  ].map(({ label, value, subtitle, Icon, numeric }) => (
                    <div key={label} className="min-h-[104px] rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-[11px] font-black leading-4 text-slate-500">{label}</div>
                        <Icon className="h-4 w-4 shrink-0 text-slate-500" />
                      </div>
                      <div className={`mt-2 break-words text-[15px] font-black leading-5 tabular-nums text-slate-950 ${numeric ? "text-start" : ""}`} dir={numeric ? "ltr" : "auto"}>{value}</div>
                      <div className="mt-1 text-[11px] font-bold leading-4 text-slate-400">{subtitle}</div>
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <button type="button" onClick={() => submitAttendanceAction("check_in")} disabled={Boolean(attendanceSaving)} className="inline-flex min-h-12 flex-col items-center justify-center gap-1 rounded-2xl bg-emerald-600 px-2 text-[11px] font-black text-white disabled:opacity-50">
                    {attendanceSaving === "check_in" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                    {text.checkIn}
                  </button>
                  <button type="button" onClick={() => setActiveTab("requests")} className="inline-flex min-h-12 flex-col items-center justify-center gap-1 rounded-2xl bg-white px-2 text-[11px] font-black text-slate-800 shadow-sm">
                    <MessageCircle className="h-4 w-4" />
                    {ui("advanceRequest")}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setChatOpen(true);
                    }}
                    className="inline-flex min-h-12 flex-col items-center justify-center gap-1 rounded-2xl bg-slate-950 px-2 text-[11px] font-black text-white shadow-sm"
                  >
                    <MessageCircle className="h-4 w-4" />
                    {ui("talkToManagement")}
                  </button>
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
                    <div className="rounded-2xl bg-white/10 p-3"><div className="text-slate-300">{text.checkIn}</div><div className="mt-1 text-sm font-black"><DateSafe>{formatTimeLocal(todayCheckIn, language)}</DateSafe></div></div>
                    <div className="rounded-2xl bg-white/10 p-3"><div className="text-slate-300">{ui("workedToday")}</div><div className="mt-1 text-sm font-black" dir="ltr">{formatMinutesShort(workedMinutes)}</div></div>
                    <div className="rounded-2xl bg-white/10 p-3"><div className="text-slate-300">{ui("startTime")}</div><div className="mt-1 text-sm font-black"><DateSafe>{formatShiftTimeLocal(currentShift.start_time || currentShift.startTime, language)}</DateSafe></div></div>
                    <div className="rounded-2xl bg-white/10 p-3"><div className="text-slate-300">{ui("endTime")}</div><div className="mt-1 text-sm font-black"><DateSafe>{formatShiftTimeLocal(currentShift.end_time || currentShift.endTime, language)}</DateSafe></div></div>
                  </div>
                  {todayCheckIn ? <div className="mt-3 text-xs font-bold text-slate-300">{ui("checkedInAt")} <DateSafe>{formatTimeLocal(todayCheckIn, language)}</DateSafe></div> : null}
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

                {employeeNotifications.length ? (
                  <div className="rounded-3xl border border-emerald-100 bg-white p-4 shadow-sm">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="text-sm font-black text-slate-950">آخر التنبيهات</h3>
                      <button type="button" onClick={() => setActiveTab("notifications")} className="text-[11px] font-black text-emerald-700">{ui("notificationsTab")}</button>
                    </div>
                    <div className="mt-3 grid gap-2">
                      {employeeNotifications.slice(0, 3).map((item) => (
                        <button
                          key={item.id || `${item.type}-${item.order_id}`}
                          type="button"
                          onClick={() => item.type === "commission_earned" ? setActiveTab("salary") : setActiveTab("notifications")}
                          className="rounded-2xl border border-slate-100 bg-slate-50 px-3 py-2 text-start"
                        >
                          <div className="truncate text-sm font-black text-slate-900" dir="auto">{item.title}</div>
                          <div className="mt-1 line-clamp-2 text-xs font-bold leading-5 text-slate-600" dir="auto">{item.body}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </>
            ) : null}

            <nav className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+12px)] z-40 mx-auto grid max-w-md grid-cols-7 gap-1 rounded-2xl border border-slate-200 bg-white/95 p-1 shadow-lg backdrop-blur">
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

            {activeTab === "salary" && payrollExists ? <div className="rounded-3xl bg-slate-950 p-4 text-white shadow-xl shadow-slate-300">
              <div className="text-xs font-black text-slate-300">{ui("currentNetSalary")}</div>
              <div className="mt-2 text-4xl font-black tabular-nums" dir="ltr">{payrollExists ? money(wallet.current_net_salary ?? portal.net_salary) : "-"}</div>
              <div className="mt-4 grid grid-cols-2 gap-2 text-sm font-black">
                <div className="rounded-2xl bg-white/10 px-3 py-2">
                  <div className="text-xs text-slate-300">{text.payrollPeriod}</div>
                  <div className="mt-1 tabular-nums" dir="ltr">{portal.current_payroll_period}</div>
                </div>
                <div className="rounded-2xl bg-white/10 px-3 py-2">
                  <div className="text-xs text-slate-300">{text.payrollStatus}</div>
                  <div className="mt-1">{statusLabel(payrollStatusValue, text)}</div>
                </div>
              </div>
            </div> : null}

            {activeTab === "salary" && !payrollExists ? (
              <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-6 text-center shadow-sm">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100">
                  <FileText className="h-6 w-6 text-slate-500" />
                </div>
                <h2 className="mt-3 text-xl font-black">{ui("salaryNotGenerated")}</h2>
                <div className="mt-4 rounded-2xl bg-slate-50 px-3 py-3 text-sm font-black text-slate-700">
                  <div className="text-xs text-slate-500">{text.payrollPeriod}</div>
                  <div className="mt-1 tabular-nums" dir="ltr">{portal.current_payroll_period}</div>
                </div>
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

            {activeTab === "salary" && payrollExists ? <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
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
                  <span dir="ltr">{payrollExists ? money(wallet.current_net_salary ?? portal.net_salary) : "-"}</span>
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
                  <div className="text-slate-500">{ui("attendedDays")}</div>
                  <div className="mt-1 text-xl font-black tabular-nums" dir="ltr">{presentDays} / {expectedDays} {ui("attendedDaysSuffix")}</div>
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
                      <div className="font-black tabular-nums"><DateSafe>{formatEmployeePortalDate(row.attendance_date || row.date || row.check_in || row.check_out, language)}</DateSafe></div>
                      <span className="rounded-full bg-white px-2.5 py-1 text-xs font-black text-slate-700">{row.status || "-"}</span>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-600">
                      <div className="col-span-2"><span className="font-black text-slate-950">{text.shift}: </span><span dir="auto">{formatShiftLabelLocal(row, language)}</span></div>
                      <div><span className="font-black text-slate-950">{text.checkIn}: </span><DateSafe>{formatTimeLocal(row.check_in, language)}</DateSafe></div>
                      <div><span className="font-black text-slate-950">{text.checkOut}: </span><DateSafe>{formatTimeLocal(row.check_out, language)}</DateSafe></div>
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
                {!tasks.length ? (
                  <div className="mt-3 rounded-3xl border border-emerald-100 bg-emerald-50 px-4 py-6 text-center">
                    <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-emerald-600 shadow-sm">
                      <CheckCircle2 className="h-7 w-7" />
                    </div>
                    <div className="mt-3 text-xl font-black text-emerald-950">{ui("noTasksToday")}</div>
                    <div className="mt-1 text-sm font-bold text-emerald-700">{ui("noTasksSubtitle")}</div>
                  </div>
                ) : null}
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
                              <div>{ui("dueDate")}: <DateSafe>{formatEmployeePortalDate(task.due_at || task.due_date || task.deadline, language)}</DateSafe></div>
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
                          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-3 py-3 text-center text-xs font-black text-slate-400">0</div>
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
                      <span>{requestTypeLabel(item, text)}</span>
                      <span className={`rounded-full px-2.5 py-1 text-xs font-black ${requestStatusClass(item.status)}`}>
                        {text[item.status] || item.status}
                      </span>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-xs font-bold text-slate-500">
                      <div>{text.requestType}: <span>{requestTypeLabel(item, text)}</span></div>
                      <div>{text.requestDate}: <DateSafe>{formatEmployeePortalDate(item.request_date || item.created_at, language)}</DateSafe></div>
                    </div>
                    {item.amount ? <div className="mt-1 text-xs font-black text-slate-600" dir="ltr">{money(item.amount)}</div> : null}
                    {item.admin_note ? <div className="mt-2 rounded-xl bg-white px-3 py-2 text-xs leading-5 text-slate-700" dir="auto">{text.adminNote}: {item.admin_note}</div> : null}
                  </div>
                )) : (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-center text-sm font-bold text-slate-500">{ui("noRequestsSubmitted")}</div>
                )}
              </div>
            </form> : null}

            {activeTab === "wallet" ? <div className="rounded-3xl bg-slate-950 p-4 text-white shadow-xl shadow-slate-300">
              <div className="text-xs font-black text-slate-300">{ui("walletOnlyTab")}</div>
              <div className="mt-2 text-3xl font-black tabular-nums" dir="ltr">{money(wallet.current_balance ?? wallet.current_net_salary ?? portal.net_salary ?? 0)}</div>
              <div className="mt-4 grid grid-cols-2 gap-2 text-xs font-black">
                <div className="rounded-2xl bg-white/10 p-3">
                  <div className="text-slate-300">{text.pendingCommissions}</div>
                  <div className="mt-1 text-sm" dir="ltr">{money(wallet.pending_commissions || 0)}</div>
                </div>
                <div className="rounded-2xl bg-white/10 p-3">
                  <div className="text-slate-300">{text.totalAdvances}</div>
                  <div className="mt-1 text-sm" dir="ltr">{money(wallet.total_advances ?? portal.advances)}</div>
                </div>
              </div>
            </div> : null}

            {activeTab === "wallet" ? <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4 shadow-sm">
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
      {activeToast ? (
        <button
          type="button"
          onClick={clearPortalToast}
          className={`fixed inset-x-4 top-[calc(5rem+env(safe-area-inset-top))] z-50 mx-auto max-w-sm rounded-2xl border px-4 py-3 text-center text-sm font-black text-white shadow-2xl transition ${
            activeToast.type === "error"
              ? "border-red-300/50 bg-red-600"
              : activeToast.type === "warning"
                ? "border-amber-300/50 bg-amber-500 text-amber-950"
                : "border-emerald-300/40 bg-emerald-600"
          }`}
          dir="auto"
        >
          {activeToast.message}
        </button>
      ) : null}
      {chatOpen ? (
        <div className="fixed inset-0 z-50 flex h-[100dvh] max-h-[100dvh] flex-col overflow-hidden bg-slate-950/70 p-0">
          <section className="mx-auto flex h-[100dvh] max-h-[100dvh] w-full flex-col overflow-hidden border border-slate-800 bg-[#0b141a] text-white shadow-2xl sm:max-w-md" style={chatPanelStyle} dir={direction}>
            <div className="sticky top-0 z-30 flex-none bg-[#0b141a] pt-[env(safe-area-inset-top)]">
              <header className="flex min-h-14 items-center justify-between gap-2 border-b border-white/10 bg-[#1f2c33] px-3 py-2">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-200 ring-1 ring-white/10">
                  <UserRound className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-[15px] font-black leading-5">{ui("chatTitle")}</h2>
                  <p className="mt-0.5 truncate text-[11px] font-bold text-emerald-200">متصل الآن</p>
                </div>
                <button type="button" onClick={closeEmployeeChat} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-white">
                  <X className="h-4 w-4" />
                </button>
              </header>
              <div className="mx-auto mt-1.5 w-fit rounded-full bg-[#182229]/90 px-2.5 py-0.5 text-center text-[10px] font-bold leading-4 text-slate-300">
                {ui("chatSecureNotice")}
              </div>
              {chatError ? <div className="mx-4 my-2 rounded-2xl border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm font-bold text-red-100" dir="auto">{chatError}</div> : null}
            </div>
            <div
              ref={chatMessagesRef}
              className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain scroll-smooth px-3 py-2"
              style={chatMessagesStyle}
              onScroll={handleChatScroll}
            >
              <div className="mx-auto mb-3 w-fit rounded-full bg-[#182229]/90 px-3 py-1 text-[11px] font-black text-slate-300">اليوم</div>
              {chatLoading ? (
                <div className="flex items-center justify-center gap-2 rounded-2xl bg-white/10 px-3 py-5 text-sm font-bold text-slate-200">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {text.loading}
                </div>
              ) : chatMessages.length ? (
                chatMessages.map((message) => {
                  const employeeMessage = message.sender_type === "employee";
                  return (
                    <div id={`employee-chat-message-${message.id}`} key={message.id} className={`flex rounded-2xl transition-shadow duration-300 ${employeeMessage ? "justify-end" : "justify-start"}`}>
                      <div
                        onTouchStart={(event) => beginChatSwipe(event, message)}
                        onTouchMove={(event) => moveChatSwipe(event, message)}
                        onTouchEnd={endChatSwipe}
                        onTouchCancel={endChatSwipe}
                        className={`relative w-fit max-w-[78%] touch-pan-y select-none break-words rounded-[1.05rem] px-3 py-2 text-[15px] font-medium leading-5 shadow-sm ${employeeMessage ? "rounded-br-[0.25rem] bg-[#005c4b] text-white after:absolute after:bottom-0 after:-right-1 after:h-2.5 after:w-2.5 after:bg-[#005c4b] after:[clip-path:polygon(0_0,100%_100%,0_100%)]" : "rounded-bl-[0.25rem] bg-[#202c33] text-slate-50 after:absolute after:bottom-0 after:-left-1 after:h-2.5 after:w-2.5 after:bg-[#202c33] after:[clip-path:polygon(100%_0,100%_100%,0_100%)]"}`}
                      >
                        {message.reply_to_message_id ? (
                          <button type="button" onClick={() => scrollToChatMessage(message.reply_to_message_id)} className="mb-1.5 w-full rounded-xl border-r-2 border-emerald-300 bg-black/10 px-2 py-1 text-start text-[11px] leading-4 text-slate-200/80">
                            <div className="font-black">{message.reply_sender_type === "employee" ? ui("you") : ui("management")}</div>
                            <div className="truncate">{chatMessagePreview({ body: message.reply_body, attachment_type: message.reply_attachment_type, attachment_name: message.reply_attachment_name }, text)}</div>
                          </button>
                        ) : null}
                        <ChatAttachment message={message} text={text} compact outgoing={employeeMessage} onImageClick={setChatImagePreview} />
                        {message.body ? <div className="whitespace-pre-wrap break-words" dir="auto">{message.body}</div> : null}
                        <div className="mt-0.5 flex items-center justify-end gap-1 text-[11px] font-medium leading-4 text-slate-300/65" dir="ltr">
                          <DateSafe>{formatTimeLocal(message.created_at, language)}</DateSafe>
                          {employeeMessage ? <CheckCheck className={`h-3.5 w-3.5 ${message.read_at ? "text-sky-300" : "text-slate-300/70"}`} /> : null}
                        </div>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="rounded-3xl border border-dashed border-white/15 bg-white/5 px-4 py-8 text-center text-sm font-bold text-slate-300">
                  <MessageCircle className="mx-auto h-8 w-8" />
                  <div className="mt-2">{ui("noChatMessages")}</div>
                </div>
              )}
              {chatTyping ? <div className="w-fit rounded-2xl bg-[#202c33] px-3 py-1.5 text-[12px] font-bold text-emerald-200">الإدارة تكتب الآن...</div> : null}
              {showChatJump ? (
                <button type="button" onClick={scrollChatToBottom} className="sticky bottom-3 z-10 ms-auto flex h-9 w-9 items-center justify-center rounded-full bg-[#202c33] text-white shadow-lg">
                  <ArrowDownCircle className="h-5 w-5" />
                </button>
              ) : null}
            </div>
            <form onSubmit={submitChatMessage} className="relative z-30 flex-none border-t border-white/10 bg-[#1f2c33] px-2 pb-1 pt-1">
              {replyToChat ? (
                <div className="mb-1.5 flex items-center justify-between gap-2 rounded-xl bg-white/10 px-2.5 py-1.5 text-[11px] font-bold leading-4 text-white">
                  <button type="button" onClick={() => scrollToChatMessage(replyToChat.id)} className="min-w-0 flex-1 border-r-2 border-emerald-300 pr-2 text-start">
                    <div className="text-emerald-200">{replyToChat.sender_type === "employee" ? ui("you") : ui("management")}</div>
                    <div className="truncate opacity-80">{chatMessagePreview(replyToChat, text)}</div>
                  </button>
                  <button type="button" onClick={() => setReplyToChat(null)} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/10 text-red-200"><X className="h-3.5 w-3.5" /></button>
                </div>
              ) : null}
              {recordingState.active ? (
                <div className="mb-1.5 flex items-center justify-between rounded-xl bg-red-500/10 px-2.5 py-1.5 text-[11px] font-black text-red-100">
                  <span dir="ltr">{Math.floor(recordingState.seconds / 60)}:{String(recordingState.seconds % 60).padStart(2, "0")}</span>
                  <div className="flex gap-2">
                    <button type="button" onClick={cancelVoiceRecording}>إلغاء</button>
                    <button type="button" onClick={sendVoiceRecording} className="text-emerald-200">إرسال</button>
                  </div>
                </div>
              ) : null}
              {chatAttachment ? (
                <div className="mb-1.5 flex items-center justify-between gap-2 rounded-xl bg-white/10 px-2.5 py-1.5 text-[11px] font-bold text-white">
                  <span className="min-w-0 truncate" dir="auto">{chatAttachment.name}</span>
                  <button type="button" onClick={() => { setChatAttachment(null); if (chatFileInputRef.current) chatFileInputRef.current.value = ""; }} className="font-black text-red-200">
                    {ui("removeAttachment")}
                  </button>
                </div>
              ) : null}
              <div className="flex h-[44px] items-center gap-1.5">
                <input
                  ref={chatFileInputRef}
                  type="file"
                  className="hidden"
                  accept=".jpg,.jpeg,.png,.webp,.pdf,.doc,.docx,.xls,.xlsx,.webm,.m4a,.mp4,.mp3,.wav,image/jpeg,image/png,image/webp,audio/webm,audio/mp4,audio/mpeg,audio/wav,audio/x-wav,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  onChange={chooseChatAttachment}
                />
                <button type="button" onClick={() => chatFileInputRef.current?.click()} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10 text-slate-100" aria-label={ui("attachFile")}>
                  <Paperclip className="h-4 w-4" />
                </button>
                {recordingState.supported ? (
                  <button type="button" onClick={startVoiceRecording} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10 text-slate-100" aria-label="تسجيل صوتي">
                    <Mic className="h-4 w-4" />
                  </button>
                ) : null}
                <input
                  ref={chatInputRef}
                  type="text"
                  value={chatBody}
                  onChange={(event) => { setChatBody(event.target.value); emitChatTyping(); }}
                  placeholder={ui("chatPlaceholder")}
                  inputMode="text"
                  enterKeyHint="send"
                  autoCorrect="on"
                  autoComplete="off"
                  autoCapitalize="sentences"
                  spellCheck="true"
                  className="h-[42px] min-h-[42px] min-w-0 flex-1 rounded-[22px] border border-white/10 bg-white/10 px-3 py-0 !text-[16px] font-bold leading-5 text-white outline-none [transform:none] [zoom:1] placeholder:text-slate-400 focus:border-emerald-400"
                  dir="auto"
                />
                <button type="submit" disabled={chatSaving || (!chatBody.trim() && !chatAttachment)} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-emerald-950 disabled:opacity-50">
                  {chatSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
      {chatImagePreview ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 p-4">
          <button type="button" onClick={() => setChatImagePreview("")} className="absolute end-4 top-[calc(1rem+env(safe-area-inset-top))] flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white">
            <X className="h-5 w-5" />
          </button>
          <img src={chatImagePreview} alt="" className="max-h-full max-w-full object-contain" />
        </div>
      ) : null}
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

