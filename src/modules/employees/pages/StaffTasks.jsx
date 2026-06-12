import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { Activity, AlertTriangle, CheckCircle2, Clock, ClipboardList, Pause, Play, Plus, RefreshCw, Route, Save, Settings2, Trash2, UserCheck, Warehouse, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { staffTasksApi } from "../services/staffTasksApi";
import { subscribeRealtime, useRealtimeConnection } from "../../../shared/realtime/socketStore";
import { getAttendanceEmployees, getBranches } from "../../attendance/attendanceApi";

const statusLabels = {
  pending: "قيد الانتظار",
  in_progress: "قيد التنفيذ",
  completed: "مكتملة",
  cancelled: "ملغاة",
  overdue: "متأخرة",
  rejected: "مرفوضة",
};

const priorityClass = {
  low: "border-slate-300/40 bg-slate-500/10 text-slate-500",
  medium: "border-sky-300/40 bg-sky-500/10 text-sky-500",
  high: "border-amber-300/40 bg-amber-500/10 text-amber-600",
  critical: "border-red-300/50 bg-red-500/10 text-red-600",
};

const metricItems = [
  { key: "open", labelKey: "open", icon: ClipboardList },
  { key: "urgent", labelKey: "urgent", icon: AlertTriangle },
  { key: "overdue", labelKey: "overdue", icon: Clock },
  { key: "completed", labelKey: "completed", icon: CheckCircle2 },
];

const kanbanStatuses = ["pending", "in_progress", "overdue", "completed", "cancelled", "rejected"];
const frequencyOptions = ["one_time", "daily", "weekly", "monthly"];
const assignmentStrategies = ["first_checked_in", "round_robin", "least_tasks_today", "fixed_employee"];
const weekdayOptions = [
  { value: 0, label: "الأحد" },
  { value: 1, label: "الاثنين" },
  { value: 2, label: "الثلاثاء" },
  { value: 3, label: "الأربعاء" },
  { value: 4, label: "الخميس" },
  { value: 5, label: "الجمعة" },
  { value: 6, label: "السبت" },
];
const emptyForm = {
  id: "",
  title: "",
  description: "",
  employee_id: "",
  branch_id: "",
  priority: "medium",
  due_at: "",
  frequency: "one_time",
  weekdays: [],
  day_of_month: "",
  requires_checkin: false,
  auto_assign_enabled: false,
  assignment_strategy: "least_tasks_today",
  fixed_employee_id: "",
  checklist_items: "",
  photo_required: false,
  qr_required: false,
  gps_required: false,
};

const sameJson = (left, right) => {
  try {
    return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
  } catch {
    return false;
  }
};

function formatDate(value, language = "en") {
  if (!value) return taskLabel(language, "noDeadline");
  try {
    return new Intl.DateTimeFormat(isArabicLocale(language) ? "ar-EG" : "en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  } catch {
    return String(value);
  }
}

function Pill({ children, className = "" }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-black ${className}`}>
      {children}
    </span>
  );
}

function AttendanceBadge({ employee, language }) {
  const isOnline = employee?.is_online === true || employee?.attendance_status === "online";
  const checkedIn = isOnline || employee?.checked_in_today === true || employee?.attendance_status === "checked_in";
  const label = isOnline
    ? taskLabel(language, "online")
    : checkedIn
      ? taskLabel(language, "checkedIn")
      : taskLabel(language, "absentNotCheckedIn");
  const className = isOnline
    ? "border-sky-300/40 bg-sky-500/10 text-sky-700"
    : checkedIn
      ? "border-emerald-300/40 bg-emerald-500/10 text-emerald-700"
      : "border-slate-300/40 bg-slate-500/10 text-slate-500";
  const dotClassName = isOnline ? "bg-sky-500" : checkedIn ? "bg-emerald-500" : "bg-red-500";
  const checkInTime = employee?.check_in_time || employee?.check_in_at || employee?.check_in || "";
  const title = isOnline
    ? taskLabel(language, "onlineNow")
    : checkInTime
      ? `${taskLabel(language, "checkedInAt")} ${formatDate(checkInTime, language)}`
      : label;

  return (
    <span title={title} className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-black ${className}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dotClassName}`} />
      {label}
    </span>
  );
}

const isArabicLocale = (language = "") => String(language || "").toLowerCase().startsWith("ar");
const normalizeEmployeeRoleCode = (value = "") => String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
const employeeRoleLabels = {
  sales: { en: "Sales", ar: "مبيعات" },
  pos_cashier: { en: "POS Cashier", ar: "كاشير POS" },
  cashier: { en: "Cashier", ar: "كاشير" },
  employee: { en: "Employee", ar: "موظف" },
  staff: { en: "Employee", ar: "موظف" },
};
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
const STAFF_TASK_COPY = {
  en: {
    pageTitle: "Employee Tasks", pageDescription: "Attendance-aware task assignment, redistribution, inventory counts, and performance tracking.",
    realtimeLive: "Realtime live", realtimeReconnecting: "Realtime reconnecting", realtimeOffline: "Realtime offline",
    newTask: "New task", dailyCounts: "Daily counts", redistribute: "Redistribute", reassignOverdue: "Reassign overdue",
    editOperationalTask: "Edit operational task", createOperationalTask: "Create operational task", panelDescription: "Admin-controlled assignment, due time, proof rules, and recurring metadata.",
    taskTitle: "Task title", autoAssignEmployee: "Auto assign employee", anyBranch: "Any branch", photoProof: "Photo proof", qrVerification: "QR verification", gpsValidation: "GPS validation",
    recurringRule: "Recurring task rule", frequency: "Frequency", one_time: "One time", daily: "Daily", weekly: "Weekly", monthly: "Monthly", weekdays: "Weekdays", dayOfMonth: "Day of month", requiresCheckin: "Requires check-in", autoAssignEnabled: "Auto assign", assignmentStrategy: "Assignment strategy", first_checked_in: "First checked-in", round_robin: "Round robin", least_tasks_today: "Least tasks today", fixed_employee: "Fixed employee", waitingEligible: "Waiting for eligible employee", dailyAutoTask: "Daily auto task", weeklyAutoTask: "Weekly auto task", monthlyAutoTask: "Monthly auto task", autoAssign: "Auto assign",
    taskDetails: "Task details", checklistItems: "Checklist items, one per line", saveTask: "Save task",
    employeePortalSettings: "Employee portal settings", portalDescription: "Controls QR check-in redirect and task visibility enforcement.", requireCheckIn: "Require check-in", autoRedirect: "Auto redirect",
    taskQueue: "Task queue", loadingTasks: "Loading tasks", visibleTasks: "visible tasks", allStatuses: "All statuses", allEmployees: "All employees", allBranches: "All branches", allPriorities: "All priorities", today: "Today",
    loadingTaskQueue: "Loading task queue...", noTasksMatch: "No tasks match this view.", performance: "Performance", auditTrail: "Audit trail", noTaskHistory: "No task history yet.",
    online: "Online", checkedIn: "Checked in", absentNotCheckedIn: "Absent / Not checked in", checkedInAt: "Checked in at", onlineNow: "Active online",
    noDeadline: "No deadline", noTaskNotes: "No task notes", unassigned: "Unassigned", staff: "Staff", edit: "Edit", start: "Start", done: "Done", pauseAvailable: "Pause available", escalated: "Escalated",
    taskUpdated: "Task updated", taskCreated: "Task created", taskDeleted: "Task deleted", actionFailed: "Action failed", failedToLoad: "Failed to load tasks",
    open: "Open", urgent: "Urgent", overdue: "Overdue", completed: "Completed", pending: "Pending", in_progress: "In progress", cancelled: "Cancelled", rejected: "Rejected",
    low: "Low", medium: "Medium", high: "High", critical: "Critical",
  },
  ar: {
    pageTitle: "مهام الموظفين", pageDescription: "إسناد المهام حسب الحضور، إعادة التوزيع، جرد المخزون، ومتابعة الأداء.",
    realtimeLive: "التحديث المباشر يعمل", realtimeReconnecting: "إعادة الاتصال بالتحديث المباشر", realtimeOffline: "التحديث المباشر غير متصل",
    newTask: "مهمة جديدة", dailyCounts: "الجرد اليومي", redistribute: "إعادة التوزيع", reassignOverdue: "إعادة إسناد المتأخر",
    editOperationalTask: "تعديل مهمة تشغيلية", createOperationalTask: "إنشاء مهمة تشغيلية", panelDescription: "تحكم إداري في الإسناد، موعد التسليم، قواعد الإثبات، والتكرار.",
    taskTitle: "عنوان المهمة", autoAssignEmployee: "إسناد تلقائي للموظف", anyBranch: "أي فرع", photoProof: "إثبات بصورة", qrVerification: "تحقق QR", gpsValidation: "تحقق GPS",
    taskDetails: "تفاصيل المهمة", checklistItems: "عناصر التحقق، عنصر في كل سطر", saveTask: "حفظ المهمة",
    employeePortalSettings: "إعدادات بوابة الموظفين", portalDescription: "التحكم في تحويل تسجيل الحضور وإلزام عرض المهام.", requireCheckIn: "يتطلب تسجيل حضور", autoRedirect: "تحويل تلقائي",
    taskQueue: "قائمة المهام", loadingTasks: "جاري تحميل المهام", visibleTasks: "مهام ظاهرة", allStatuses: "كل الحالات", allEmployees: "كل الموظفين", allBranches: "كل الفروع", allPriorities: "كل الأولويات", today: "اليوم",
    loadingTaskQueue: "جاري تحميل قائمة المهام...", noTasksMatch: "لا توجد مهام مطابقة لهذا العرض.", performance: "الأداء", auditTrail: "سجل التدقيق", noTaskHistory: "لا يوجد سجل مهام حتى الآن.",
    noDeadline: "لا يوجد موعد نهائي", noTaskNotes: "لا توجد ملاحظات للمهمة", unassigned: "غير مسند", staff: "موظف", edit: "تعديل", start: "بدء", done: "تم", pauseAvailable: "الإيقاف المؤقت متاح", escalated: "تم التصعيد",
    taskUpdated: "تم تحديث المهمة", taskCreated: "تم إنشاء المهمة", taskDeleted: "تم حذف المهمة", actionFailed: "فشل الإجراء", failedToLoad: "فشل تحميل المهام",
    open: "مفتوحة", urgent: "عاجلة", overdue: "متأخرة", completed: "مكتملة", pending: "قيد الانتظار", in_progress: "قيد التنفيذ", cancelled: "ملغاة", rejected: "مرفوضة",
    low: "منخفضة", medium: "متوسطة", high: "مرتفعة", critical: "حرجة",
  },
};
const STAFF_TASK_AR_EXTRA = {
  online: "متصل",
  checkedIn: "حاضر",
  absentNotCheckedIn: "غائب / لم يسجل حضور",
  checkedInAt: "سجل الحضور في",
  onlineNow: "نشط الآن",
  recurringRule: "قاعدة مهمة متكررة",
  frequency: "التكرار",
  one_time: "مرة واحدة",
  daily: "يومي",
  weekly: "أسبوعي",
  monthly: "شهري",
  weekdays: "أيام الأسبوع",
  dayOfMonth: "يوم الشهر",
  requiresCheckin: "يتطلب تسجيل حضور",
  autoAssignEnabled: "إسناد تلقائي",
  assignmentStrategy: "طريقة الإسناد",
  first_checked_in: "أول موظف يسجل حضور",
  round_robin: "توزيع بالتناوب",
  least_tasks_today: "الأقل مهاما اليوم",
  fixed_employee: "موظف محدد",
  waitingEligible: "في انتظار موظف مؤهل",
  dailyAutoTask: "مهمة يومية تلقائية",
  weeklyAutoTask: "مهمة أسبوعية تلقائية",
  monthlyAutoTask: "مهمة شهرية تلقائية",
  autoAssign: "إسناد تلقائي",
};
const taskLabel = (language, key) => (isArabicLocale(language) ? STAFF_TASK_AR_EXTRA[key] : "") || STAFF_TASK_COPY[isArabicLocale(language) ? "ar" : "en"]?.[key] || STAFF_TASK_COPY.en[key] || key;
const statusLabel = (status, language) => taskLabel(language, status) || statusLabels[status] || status;
const priorityLabel = (priority, language) => taskLabel(language, priority) || priority;
const recurringBadgeLabel = (task = {}, language = "en") => {
  const frequency = task.recurring_rule?.frequency || task.metadata?.recurring_rule?.frequency || task.metadata?.frequency || "";
  if (frequency === "daily") return taskLabel(language, "dailyAutoTask");
  if (frequency === "weekly") return taskLabel(language, "weeklyAutoTask");
  if (frequency === "monthly") return taskLabel(language, "monthlyAutoTask");
  return "";
};
const localizedTaskText = (task = {}, field, language = "en") => {
  const useArabic = isArabicLocale(language);
  if (field === "title") return useArabic ? task.task_title_ar || task.title_ar || task.title || "" : task.title || "";
  if (field === "description") return useArabic ? task.task_description_ar || task.description_ar || task.description || "" : task.description || "";
  if (field === "notes") {
    return useArabic
      ? task.task_notes_ar || task.notes_ar || task.notes || task.metadata?.notes_ar || task.metadata?.note_ar || task.metadata?.notes || task.metadata?.note || ""
      : task.notes || task.metadata?.notes || task.metadata?.note || "";
  }
  return "";
};

function TaskRow({ task, onStart, onComplete, onEdit, onDelete, language }) {
  const title = localizedTaskText(task, "title", language);
  const description = localizedTaskText(task, "description", language) || localizedTaskText(task, "notes", language);
  const assigneeLabel = task.current_assignee_id ? task.assignee_name || taskLabel(language, "staff") : taskLabel(language, "unassigned");
  return (
    <div className="grid gap-3 border-b border-[var(--border)] px-4 py-4 text-start last:border-b-0 lg:grid-cols-[1fr_auto]">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="min-w-0 max-w-full truncate text-sm font-black text-[var(--text)]" dir="auto">{title}</h3>
          <Pill className={priorityClass[task.priority] || priorityClass.medium}>{priorityLabel(task.priority, language)}</Pill>
          <Pill className="border-[var(--border)] bg-[var(--surface-soft)] text-[var(--muted)]">{statusLabel(task.status, language)}</Pill>
          {recurringBadgeLabel(task, language) ? (
            <Pill className="border-cyan-300/40 bg-cyan-500/10 text-cyan-700">{recurringBadgeLabel(task, language)}</Pill>
          ) : null}
          {task.metadata?.assignment_state === "waiting_for_eligible_employee" ? (
            <Pill className="border-amber-300/40 bg-amber-500/10 text-amber-700">{taskLabel(language, "waitingEligible")}</Pill>
          ) : null}
          {task.metadata?.assignment_strategy ? (
            <Pill className="border-emerald-300/40 bg-emerald-500/10 text-emerald-700">{taskLabel(language, "autoAssign")}: {taskLabel(language, task.metadata.assignment_strategy)}</Pill>
          ) : null}
        </div>
        <p className="mt-2 line-clamp-2 text-sm text-[var(--muted)]" dir="auto">{description || taskLabel(language, "noTaskNotes")}</p>
        <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold text-[var(--muted)]">
          <span className="max-w-[180px] truncate" dir="auto">{assigneeLabel}</span>
          <span>•</span>
          <span>{task.task_type}</span>
          <span>•</span>
          <span dir="auto">{formatDate(task.due_at, language)}</span>
          {task.product_name ? (
            <>
              <span>•</span>
              <span className="max-w-[180px] truncate" dir="auto">{task.product_name}</span>
            </>
          ) : null}
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2 rtl:justify-start">
        <button
          type="button"
          onClick={() => onEdit(task)}
          className="inline-flex h-10 items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 text-sm font-bold text-[var(--text)] hover:bg-[var(--surface-soft)]"
        >
          {taskLabel(language, "edit")}
        </button>
        <button
          type="button"
          onClick={() => onDelete(task)}
          className="inline-flex h-10 items-center gap-2 rounded-xl border border-red-300/40 bg-red-500/10 px-3 text-sm font-bold text-red-700"
        >
          <Trash2 className="h-4 w-4" />
        </button>
        {task.status === "pending" || task.status === "overdue" ? (
          <button
            type="button"
            onClick={() => onStart(task)}
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 text-sm font-bold text-[var(--text)] hover:bg-[var(--surface-soft)]"
          >
            <Play className="h-4 w-4" />
            {taskLabel(language, "start")}
          </button>
        ) : null}
        {task.status === "in_progress" ? (
          <button
            type="button"
            onClick={() => onComplete(task)}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-[var(--primary)] px-3 text-sm font-black text-white"
          >
            <CheckCircle2 className="h-4 w-4" />
            {taskLabel(language, "done")}
          </button>
        ) : null}
        {task.status === "in_progress" ? (
          <Pill className="border-amber-300/40 bg-amber-500/10 text-amber-700">
            <Pause className="me-1 h-3 w-3" />
            {taskLabel(language, "pauseAvailable")}
          </Pill>
        ) : null}
        {task.status === "completed" ? (
          <Pill className="border-emerald-300/40 bg-emerald-500/10 text-emerald-700">{taskLabel(language, "completed")}</Pill>
        ) : null}
        {task.status === "overdue" ? (
          <Pill className="border-red-300/50 bg-red-500/10 text-red-700">{taskLabel(language, "escalated")}</Pill>
        ) : null}
      </div>
    </div>
  );
}

function StaffTasks() {
  const { i18n } = useTranslation();
  const language = i18n.language || "en";
  const isRtl = isArabicLocale(language);
  const tr = (key) => taskLabel(language, key);
  const [dashboard, setDashboard] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [status, setStatus] = useState("");
  const [employeeFilter, setEmployeeFilter] = useState("");
  const [branchFilter, setBranchFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [todayOnly, setTodayOnly] = useState(true);
  const [employees, setEmployees] = useState([]);
  const [branches, setBranches] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [panelOpen, setPanelOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [portalSettings, setPortalSettings] = useState(null);
  const realtime = useRealtimeConnection();
  const refreshTimerRef = useRef(null);

  const summary = dashboard?.summary || {};
  const byEmployee = dashboard?.byEmployee || [];
  const history = dashboard?.history || [];

  const filteredTasks = useMemo(() => {
    return tasks.filter((task) => {
      if (status && task.status !== status) return false;
      if (employeeFilter && String(task.current_assignee_id || "") !== String(employeeFilter)) return false;
      if (branchFilter && String(task.branch_id || "") !== String(branchFilter)) return false;
      if (priorityFilter && task.priority !== priorityFilter) return false;
      return true;
    });
  }, [branchFilter, employeeFilter, priorityFilter, status, tasks]);

  const kanbanGroups = useMemo(() => {
    const groups = Object.fromEntries(kanbanStatuses.map((key) => [key, []]));
    tasks.forEach((task) => {
      if (groups[task.status]) groups[task.status].push(task);
    });
    return groups;
  }, [tasks]);

  const refresh = useCallback(async () => {
    try {
      setError("");
      setLoading((current) => (current ? current : true));
      const [dashboardRes, tasksRes, settingsRes] = await Promise.all([
        staffTasksApi.dashboard({ branch_id: branchFilter }),
        staffTasksApi.list({ limit: 120, today: todayOnly ? "true" : "", branch_id: branchFilter }),
        staffTasksApi.getPortalSettings().catch(() => null),
      ]);
      const nextDashboard = dashboardRes.dashboard || null;
      const nextTasks = tasksRes.tasks || [];
      setDashboard((current) => (sameJson(current, nextDashboard) ? current : nextDashboard));
      setTasks((current) => (sameJson(current, nextTasks) ? current : nextTasks));
      if (settingsRes?.settings) {
        setPortalSettings((current) => (sameJson(current, settingsRes.settings) ? current : settingsRes.settings));
      }
    } catch (loadError) {
      setError(loadError?.message || tr("failedToLoad"));
    } finally {
      setLoading((current) => (current ? false : current));
    }
  }, [branchFilter, todayOnly, language]);

  useEffect(() => {
    Promise.all([getAttendanceEmployees().catch(() => []), getBranches().catch(() => [])]).then(([nextEmployees, nextBranches]) => {
      setEmployees(Array.isArray(nextEmployees) ? nextEmployees : []);
      setBranches(Array.isArray(nextBranches) ? nextBranches : []);
    });
  }, []);

  const debounceRefresh = useCallback(() => {
    if (refreshTimerRef.current) window.clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = window.setTimeout(() => {
      void refresh();
    }, 0);
  }, [refresh]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refresh();
    }, 0);
    return () => {
      window.clearTimeout(timer);
      if (refreshTimerRef.current) window.clearTimeout(refreshTimerRef.current);
    };
  }, [refresh]);

  useEffect(() => {
    const handleTaskEvent = (event) => {
      if (!event?.task_id) return;
      toast(event.message || tr("taskUpdated"), { id: `staff-task-${event.event}-${event.task_id}` });
      setTasks((current) => {
        if (event.event === "task_deleted") {
          const next = current.filter((task) => String(task.id) !== String(event.task_id));
          return next.length === current.length ? current : next;
        }
        let changed = false;
        const next = current.map((task) => {
          if (String(task.id) !== String(event.task_id)) return task;
          const updated = {
            ...task,
            status: event.status || task.status,
            priority: event.priority || task.priority,
            updated_at: event.at || task.updated_at,
          };
          changed = changed || !sameJson(task, updated);
          return changed ? updated : task;
        });
        return changed ? next : current;
      });
      debounceRefresh();
    };
    return subscribeRealtime("staff_tasks:event", handleTaskEvent);
  }, [debounceRefresh, language]);

  const runAction = async (key, action) => {
    try {
      setBusy(key);
      setError("");
      await action();
      await refresh();
    } catch (actionError) {
      setError(actionError?.message || tr("actionFailed"));
    } finally {
      setBusy("");
    }
  };

  const updateTaskOptimistic = (taskId, patch) => {
    setTasks((current) => {
      let changed = false;
      const next = current.map((task) => {
        if (String(task.id) !== String(taskId)) return task;
        const updated = { ...task, ...patch };
        changed = changed || !sameJson(task, updated);
        return changed ? updated : task;
      });
      return changed ? next : current;
    });
  };

  const startTask = (task) => runAction(`start-${task.id}`, async () => {
    const previous = task.status;
    updateTaskOptimistic(task.id, { status: "in_progress" });
    try {
      await staffTasksApi.updateStatus(task.id, { status: "in_progress" });
    } catch (error) {
      updateTaskOptimistic(task.id, { status: previous });
      throw error;
    }
  });

  const completeTask = (task) => runAction(`done-${task.id}`, async () => {
    const previous = task.status;
    updateTaskOptimistic(task.id, { status: "completed" });
    try {
      await staffTasksApi.complete(task.id);
    } catch (error) {
      updateTaskOptimistic(task.id, { status: previous });
      throw error;
    }
  });

  const editTask = (task) => {
    setForm({
      id: task.id,
      title: task.title || "",
      description: task.description || "",
      employee_id: task.current_assignee_id || "",
      branch_id: task.branch_id || "",
      priority: task.priority || "medium",
      due_at: task.due_at ? new Date(task.due_at).toISOString().slice(0, 16) : "",
      frequency: task.recurring_rule?.frequency || task.metadata?.recurring_rule?.frequency || "one_time",
      weekdays: task.recurring_rule?.weekdays || task.metadata?.recurring_rule?.weekdays || [],
      day_of_month: task.recurring_rule?.day_of_month || task.metadata?.recurring_rule?.day_of_month || "",
      requires_checkin: Boolean(task.metadata?.requires_checkin),
      auto_assign_enabled: Boolean(task.metadata?.assignment_strategy),
      assignment_strategy: task.metadata?.assignment_strategy || "least_tasks_today",
      fixed_employee_id: task.metadata?.fixed_employee_id || "",
      checklist_items: (task.checklist_items || task.metadata?.checklist_items || []).join("\n"),
      photo_required: Boolean(task.photo_required || task.metadata?.photo_required),
      qr_required: Boolean(task.qr_required || task.metadata?.qr_required),
      gps_required: Boolean(task.gps_required || task.metadata?.gps_required),
    });
    setPanelOpen(true);
  };

  const saveTask = () => runAction("save-task", async () => {
    const payload = {
      title: form.title,
      description: form.description,
      employee_id: form.employee_id || null,
      branch_id: form.branch_id || null,
      priority: form.priority,
      due_at: form.due_at ? new Date(form.due_at).toISOString() : null,
      frequency: form.frequency,
      weekdays: form.weekdays,
      day_of_month: form.day_of_month || null,
      requires_checkin: form.requires_checkin,
      requires_photo: form.photo_required,
      requires_qr: form.qr_required,
      requires_gps: form.gps_required,
      auto_assign_enabled: form.auto_assign_enabled,
      assignment_strategy: form.assignment_strategy,
      fixed_employee_id: form.assignment_strategy === "fixed_employee" ? form.fixed_employee_id || form.employee_id || null : null,
      save_as_template: form.frequency !== "one_time",
      checklist_items: form.checklist_items.split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
      photo_required: form.photo_required,
      qr_required: form.qr_required,
      gps_required: form.gps_required,
      recurring_rule: { frequency: form.frequency || "one_time", weekdays: form.weekdays, day_of_month: form.day_of_month || null },
      metadata: { recurring_rule: { frequency: form.frequency || "one_time", weekdays: form.weekdays, day_of_month: form.day_of_month || null }, assignment_strategy: form.auto_assign_enabled ? form.assignment_strategy : null },
    };
    if (form.id) {
      await staffTasksApi.update(form.id, payload);
      toast.success(tr("taskUpdated"));
    } else {
      await staffTasksApi.create(payload);
      toast.success(tr("taskCreated"));
    }
    setForm(emptyForm);
    setPanelOpen(false);
  });

  const removeTask = (task) => runAction(`delete-${task.id}`, async () => {
    await staffTasksApi.delete(task.id);
    setTasks((current) => current.filter((item) => String(item.id) !== String(task.id)));
    toast.success(tr("taskDeleted"));
  });

  const updatePortalSetting = (key, value) => runAction(`portal-${key}`, async () => {
    const next = { ...(portalSettings || {}), [key]: value };
    setPortalSettings(next);
    const response = await staffTasksApi.updatePortalSettings(next);
    setPortalSettings(response.settings || next);
  });

  return (
    <div className="space-y-5 text-start" dir={isRtl ? "rtl" : "ltr"}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-[var(--text)]">{tr("pageTitle")}</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">{tr("pageDescription")}</p>
          <div className="mt-2 inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-xs font-black text-[var(--muted)]">
            <Activity className={`h-3.5 w-3.5 ${realtime.connected ? "text-emerald-500" : "text-amber-500"}`} />
            {realtime.connected ? tr("realtimeLive") : realtime.connecting ? tr("realtimeReconnecting") : tr("realtimeOffline")}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              setForm(emptyForm);
              setPanelOpen(true);
            }}
            className="inline-flex h-11 items-center gap-2 rounded-xl bg-emerald-600 px-4 text-sm font-black text-white"
          >
            <Plus className="h-4 w-4" />
            {tr("newTask")}
          </button>
          <button
            type="button"
            disabled={busy === "inventory"}
            onClick={() => runAction("inventory", async () => {
              await staffTasksApi.generateRecurring();
              await staffTasksApi.assignInventoryCounts({ limit: 20 });
            })}
            className="inline-flex h-11 items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 text-sm font-black text-[var(--text)] hover:bg-[var(--surface-soft)] disabled:opacity-60"
          >
            <Warehouse className="h-4 w-4" />
            {tr("dailyCounts")}
          </button>
          <button
            type="button"
            disabled={busy === "absence"}
            onClick={() => runAction("absence", () => staffTasksApi.redistributeAbsent({ reason: "manual_absence_review" }))}
            className="inline-flex h-11 items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 text-sm font-black text-[var(--text)] hover:bg-[var(--surface-soft)] disabled:opacity-60"
          >
            <Route className="h-4 w-4" />
            {tr("redistribute")}
          </button>
          <button
            type="button"
            disabled={busy === "overdue"}
            onClick={() => runAction("overdue", () => staffTasksApi.reassignUnfinished())}
            className="inline-flex h-11 items-center gap-2 rounded-xl bg-[var(--primary)] px-4 text-sm font-black text-white disabled:opacity-60"
          >
            <RefreshCw className="h-4 w-4" />
            {tr("reassignOverdue")}
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-300/50 bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-600">{error}</div>
      ) : null}

      {panelOpen ? (
        <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-black text-[var(--text)]">{form.id ? tr("editOperationalTask") : tr("createOperationalTask")}</h2>
              <p className="mt-1 text-sm text-[var(--muted)]">{tr("panelDescription")}</p>
            </div>
            <button type="button" onClick={() => setPanelOpen(false)} className="rounded-xl border border-[var(--border)] p-2 text-[var(--muted)]">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <input value={form.title} onChange={(e) => setForm((v) => ({ ...v, title: e.target.value }))} placeholder={tr("taskTitle")} className="h-11 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-start text-sm font-semibold text-[var(--text)] outline-none" />
            <select value={form.employee_id} onChange={(e) => setForm((v) => ({ ...v, employee_id: e.target.value }))} className="h-11 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-semibold text-[var(--text)] outline-none">
              <option value="">{tr("unassigned")}</option>
              {employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.full_name || employee.employee_code}</option>)}
            </select>
            <select value={form.branch_id} onChange={(e) => setForm((v) => ({ ...v, branch_id: e.target.value }))} className="h-11 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-semibold text-[var(--text)] outline-none">
              <option value="">{tr("anyBranch")}</option>
              {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name || branch.branch_name}</option>)}
            </select>
            <select value={form.priority} onChange={(e) => setForm((v) => ({ ...v, priority: e.target.value }))} className="h-11 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-semibold text-[var(--text)] outline-none">
              {["low", "medium", "high", "critical"].map((item) => <option key={item} value={item}>{priorityLabel(item, language)}</option>)}
            </select>
            <input type="datetime-local" value={form.due_at} onChange={(e) => setForm((v) => ({ ...v, due_at: e.target.value }))} className="h-11 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-semibold text-[var(--text)] outline-none" />
            <select value={form.frequency} onChange={(e) => setForm((v) => ({ ...v, frequency: e.target.value }))} className="h-11 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-semibold text-[var(--text)] outline-none">
              {frequencyOptions.map((item) => <option key={item} value={item}>{tr(item)}</option>)}
            </select>
            <select value={form.assignment_strategy} onChange={(e) => setForm((v) => ({ ...v, assignment_strategy: e.target.value }))} className="h-11 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-semibold text-[var(--text)] outline-none">
              {assignmentStrategies.map((item) => <option key={item} value={item}>{tr(item)}</option>)}
            </select>
            {form.frequency === "monthly" ? (
              <input type="number" min="1" max="31" value={form.day_of_month} onChange={(e) => setForm((v) => ({ ...v, day_of_month: e.target.value }))} placeholder={tr("dayOfMonth")} className="h-11 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-semibold text-[var(--text)] outline-none" />
            ) : null}
            <label className="flex h-11 items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-bold text-[var(--text)]"><input type="checkbox" checked={form.auto_assign_enabled} onChange={(e) => setForm((v) => ({ ...v, auto_assign_enabled: e.target.checked }))} /> {tr("autoAssignEnabled")}</label>
            <label className="flex h-11 items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-bold text-[var(--text)]"><input type="checkbox" checked={form.requires_checkin} onChange={(e) => setForm((v) => ({ ...v, requires_checkin: e.target.checked }))} /> {tr("requiresCheckin")}</label>
            <label className="flex h-11 items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-bold text-[var(--text)]"><input type="checkbox" checked={form.photo_required} onChange={(e) => setForm((v) => ({ ...v, photo_required: e.target.checked }))} /> {tr("photoProof")}</label>
            <label className="flex h-11 items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-bold text-[var(--text)]"><input type="checkbox" checked={form.qr_required} onChange={(e) => setForm((v) => ({ ...v, qr_required: e.target.checked }))} /> {tr("qrVerification")}</label>
            <label className="flex h-11 items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-bold text-[var(--text)]"><input type="checkbox" checked={form.gps_required} onChange={(e) => setForm((v) => ({ ...v, gps_required: e.target.checked }))} /> {tr("gpsValidation")}</label>
            {form.frequency === "weekly" ? (
              <div className="flex min-h-11 flex-wrap items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 md:col-span-2">
                <span className="me-1 text-xs font-black text-[var(--muted)]">{tr("weekdays")}</span>
                {weekdayOptions.map((day) => (
                  <label key={day.value} className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)] px-2 py-1 text-xs font-bold">
                    <input
                      type="checkbox"
                      checked={form.weekdays.includes(day.value)}
                      onChange={(event) => setForm((value) => ({
                        ...value,
                        weekdays: event.target.checked ? [...value.weekdays, day.value].sort() : value.weekdays.filter((item) => item !== day.value),
                      }))}
                    />
                    {day.label}
                  </label>
                ))}
              </div>
            ) : null}
            <textarea value={form.description} onChange={(e) => setForm((v) => ({ ...v, description: e.target.value }))} placeholder={tr("taskDetails")} className="min-h-24 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-3 text-start text-sm font-semibold text-[var(--text)] outline-none md:col-span-2" />
            <textarea value={form.checklist_items} onChange={(e) => setForm((v) => ({ ...v, checklist_items: e.target.value }))} placeholder={tr("checklistItems")} className="min-h-24 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-3 text-start text-sm font-semibold text-[var(--text)] outline-none md:col-span-2" />
          </div>
          <div className="mt-4 flex justify-end">
            <button type="button" disabled={busy === "save-task" || !form.title.trim()} onClick={saveTask} className="inline-flex h-11 items-center gap-2 rounded-xl bg-[var(--primary)] px-4 text-sm font-black text-white disabled:opacity-60">
              <Save className="h-4 w-4" />
              {tr("saveTask")}
            </button>
          </div>
        </section>
      ) : null}

      {portalSettings ? (
        <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex items-start gap-3">
              <Settings2 className="mt-1 h-5 w-5 text-[var(--primary)]" />
              <div>
                <h2 className="text-base font-black text-[var(--text)]">{tr("employeePortalSettings")}</h2>
                <p className="mt-1 text-sm text-[var(--muted)]">{tr("portalDescription")}</p>
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm font-bold text-[var(--text)]">
                <input
                  type="checkbox"
                  checked={portalSettings.require_checkin_to_view_tasks !== false}
                  disabled={busy === "portal-require_checkin_to_view_tasks"}
                  onChange={(event) => updatePortalSetting("require_checkin_to_view_tasks", event.target.checked)}
                  className="h-4 w-4"
                />
                {tr("requireCheckIn")}
              </label>
              <label className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm font-bold text-[var(--text)]">
                <input
                  type="checkbox"
                  checked={portalSettings.auto_redirect_after_checkin !== false}
                  disabled={busy === "portal-auto_redirect_after_checkin"}
                  onChange={(event) => updatePortalSetting("auto_redirect_after_checkin", event.target.checked)}
                  className="h-4 w-4"
                />
                {tr("autoRedirect")}
              </label>
            </div>
          </div>
        </section>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {metricItems.map((item) => {
          const Icon = item.icon;
          return (
            <div key={item.key} className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-[var(--muted)]">{tr(item.labelKey)}</span>
                <Icon className="h-5 w-5 text-[var(--primary)]" />
              </div>
              <div className="mt-3 text-3xl font-black text-[var(--text)]">{Number(summary[item.key] || 0)}</div>
            </div>
          );
        })}
      </div>

      <div className="grid gap-5 xl:grid-cols-[1fr_22rem]">
        <section className="min-w-0 rounded-2xl border border-[var(--border)] bg-[var(--card)]">
          <div className="grid gap-3 border-b border-[var(--border)] p-4 md:grid-cols-3 xl:grid-cols-6">
            {kanbanStatuses.map((key) => (
              <div key={key} className="min-h-24 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="truncate text-xs font-black uppercase text-[var(--muted)]">{statusLabel(key, language)}</h3>
                  <span className="rounded-full bg-[var(--primary-soft)] px-2 py-0.5 text-xs font-black text-[var(--primary)]">{kanbanGroups[key]?.length || 0}</span>
                </div>
                <div className="mt-3 space-y-2">
                  {(kanbanGroups[key] || []).slice(0, 3).map((task) => (
                    <div key={task.id} className="truncate rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-xs font-bold text-[var(--text)]">
                      <span dir="auto">{localizedTaskText(task, "title", language)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="flex flex-col gap-3 border-b border-[var(--border)] p-4">
            <div>
              <h2 className="text-base font-black text-[var(--text)]">{tr("taskQueue")}</h2>
              <p className="mt-1 text-sm text-[var(--muted)]">{loading ? tr("loadingTasks") : `${filteredTasks.length} ${tr("visibleTasks")}`}</p>
            </div>
            <div className="grid gap-2 md:grid-cols-5">
              <select value={status} onChange={(event) => setStatus(event.target.value)} className="h-10 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-semibold text-[var(--text)] outline-none">
                <option value="">{tr("allStatuses")}</option>
                {Object.keys(statusLabels).map((key) => <option key={key} value={key}>{statusLabel(key, language)}</option>)}
              </select>
              <select value={employeeFilter} onChange={(event) => setEmployeeFilter(event.target.value)} className="h-10 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-semibold text-[var(--text)] outline-none">
                <option value="">{tr("allEmployees")}</option>
                {employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.full_name || employee.employee_code}</option>)}
              </select>
              <select value={branchFilter} onChange={(event) => setBranchFilter(event.target.value)} className="h-10 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-semibold text-[var(--text)] outline-none">
                <option value="">{tr("allBranches")}</option>
                {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name || branch.branch_name}</option>)}
              </select>
              <select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)} className="h-10 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-semibold text-[var(--text)] outline-none">
                <option value="">{tr("allPriorities")}</option>
                {["low", "medium", "high", "critical"].map((item) => <option key={item} value={item}>{priorityLabel(item, language)}</option>)}
              </select>
              <label className="flex h-10 items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-bold text-[var(--text)]">
                <input type="checkbox" checked={todayOnly} onChange={(event) => setTodayOnly(event.target.checked)} />
                {tr("today")}
              </label>
            </div>
          </div>
          {filteredTasks.length ? (
            filteredTasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                language={language}
                onStart={startTask}
                onComplete={completeTask}
                onEdit={editTask}
                onDelete={removeTask}
              />
            ))
          ) : (
            <div className="p-8 text-center text-sm font-semibold text-[var(--muted)]">
              {loading ? tr("loadingTaskQueue") : tr("noTasksMatch")}
            </div>
          )}
        </section>

        <aside className="space-y-5">
          <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
            <div className="mb-4 flex items-center gap-2">
              <UserCheck className="h-5 w-5 text-[var(--primary)]" />
              <h2 className="text-base font-black text-[var(--text)]">{tr("performance")}</h2>
            </div>
            <div className="space-y-3">
              {byEmployee.slice(0, 8).map((employee) => (
                <div key={employee.employee_id} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-black text-[var(--text)]" dir="auto">{employee.employee_name}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <span className="min-w-0 truncate text-xs text-[var(--muted)]" dir="auto">{formatEmployeeJobLabel(employee, language)}</span>
                        <AttendanceBadge employee={employee} language={language} />
                      </div>
                      {employee.check_in_time ? (
                        <div className="mt-1 text-[11px] font-semibold text-[var(--muted)]" dir="auto">
                          {tr("checkedInAt")} <span dir="ltr">{formatDate(employee.check_in_time, language)}</span>
                        </div>
                      ) : null}
                    </div>
                    <div className="text-end text-sm font-black text-[var(--primary)]" dir="ltr">{Number(employee.completion_rate || 0)}%</div>
                  </div>
                  <div className="mt-2 h-2 rounded-full bg-[var(--surface-soft)]">
                    <div className="h-2 rounded-full bg-[var(--primary)]" style={{ width: `${Math.min(Number(employee.completion_rate || 0), 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
            <h2 className="text-base font-black text-[var(--text)]">{tr("auditTrail")}</h2>
            <div className="mt-4 space-y-3">
              {history.slice(0, 10).map((item) => (
                <div key={item.id} className="border-b border-[var(--border)] pb-3 last:border-b-0 last:pb-0">
                  <div className="text-sm font-black text-[var(--text)]" dir="auto">{item.action}</div>
                  <div className="mt-1 text-xs text-[var(--muted)]">
                    <span dir="ltr">Task #{item.task_id}</span> {item.employee_name ? <span dir="auto">• {item.employee_name}</span> : null} <span aria-hidden="true">•</span> <span dir="auto">{formatDate(item.created_at, language)}</span>
                  </div>
                </div>
              ))}
              {!history.length ? <div className="text-center text-sm font-semibold text-[var(--muted)]">{tr("noTaskHistory")}</div> : null}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

export default StaffTasks;
