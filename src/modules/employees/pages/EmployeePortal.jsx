import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AlertTriangle, CheckCircle2, ClipboardList, Clock3, Loader2, Lock, Play, RefreshCw, Warehouse } from "lucide-react";
import { toast } from "react-hot-toast";

import { staffTasksApi } from "../services/staffTasksApi";
import usePageTitle from "../../../shared/hooks/usePageTitle";

const openStatuses = new Set(["pending", "in_progress", "overdue"]);
const portalCachePrefix = "employee.portal.cache.";
const portalQueuePrefix = "employee.portal.queue.";
const installDismissedKey = "employee.portal.install.dismissed";
const EMPLOYEE_PORTAL_LOAD_TIMEOUT_MS = 10000;

const statusLabel = {
  pending: "ظ‚ظٹط¯ ط§ظ„طھظ†ظپظٹط°",
  in_progress: "ظ‚ظٹط¯ ط§ظ„طھظ†ظپظٹط°",
  manager_review: "ظ…ط¹ظ„ظ‚ط©",
  overdue: "ظ…ط¹ظ„ظ‚ط©",
  reassigned: "ظ…ط¹ظ„ظ‚ط©",
  completed: "ظ…ظƒطھظ…ظ„ط©",
  cancelled: "ظ…ظ„ط؛ط§ط©",
};

const priorityLabel = {
  low: "ظ…ظ†ط®ظپط¶ط©",
  medium: "ظ…طھظˆط³ط·ط©",
  high: "ط¹ط§ظ„ظٹط©",
  critical: "ط¹ط§ظ„ظٹط© ط¬ط¯ط§",
};
const taskKindLabel = (task = {}) => {
  const kind = String(task.task_type || task.metadata?.task_kind || task.metadata?.template_kind || "").toLowerCase();
  if (kind === "opening_day") return "افتتاح اليوم";
  if (kind === "daily") return "يومية";
  if (kind === "weekly") return "أسبوعية";
  return "";
};

const priorityClass = {
  low: "border-slate-200 bg-slate-100 text-slate-700",
  medium: "border-sky-100 bg-sky-50 text-sky-700",
  high: "border-amber-100 bg-amber-50 text-amber-800",
  critical: "border-red-100 bg-red-50 text-red-700",
};

const formatTime = (value) => {
  if (!value) return "ط؛ظٹط± ظ…ط­ط¯ط¯";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "ط؛ظٹط± ظ…ط­ط¯ط¯";
  return new Intl.DateTimeFormat("ar-EG", { hour: "2-digit", minute: "2-digit" }).format(date);
};

const normalizeTasks = (tasks = []) => (Array.isArray(tasks) ? tasks : []);
const localizedTaskText = (task = {}, field) => {
  if (field === "title") return task.task_title_ar || task.title_ar || task.title || "";
  if (field === "description") return task.task_description_ar || task.description_ar || task.description || "";
  if (field === "notes") return task.task_notes_ar || task.notes_ar || task.notes || task.metadata?.notes_ar || task.metadata?.note_ar || task.metadata?.notes || task.metadata?.note || "";
  return "";
};

const taskCounts = (tasks = []) => ({
  today: tasks.length,
  pending: tasks.filter((task) => openStatuses.has(task.status)).length,
  completed: tasks.filter((task) => task.status === "completed").length,
});

const isBrowser = () => typeof window !== "undefined";
const isStandalone = () =>
  isBrowser() &&
  (window.matchMedia?.("(display-mode: standalone)")?.matches ||
    window.navigator?.standalone === true);
const isIos = () =>
  isBrowser() &&
  /iphone|ipad|ipod/i.test(window.navigator?.userAgent || "");

const readJson = (key, fallback) => {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
};

const writeJson = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage may be full or blocked in private browsing.
  }
};

function EmptyState({ children }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-5 text-sm font-bold leading-6 text-slate-500 shadow-sm">
      {children}
    </div>
  );
}

function InstallBanner({ ios, onInstall, onDismiss, canInstall }) {
  return (
    <section className="mt-4 rounded-3xl border border-white/10 bg-slate-950/95 p-4 text-right text-white shadow-xl shadow-slate-300">
      <div className="rounded-2xl border border-white/10 bg-white/10 p-4 backdrop-blur">
        <h2 className="text-lg font-black">ط«ط¨ظ‘طھ ط¨ظˆط§ط¨ط© ط§ظ„ظ…ظˆط¸ظپ ط¹ظ„ظ‰ ط§ظ„ظ…ظˆط¨ط§ظٹظ„</h2>
        <p className="mt-2 text-sm font-semibold leading-6 text-slate-300">ط§ظپطھط­ ط§ظ„طھط§ط³ظƒط§طھ ط¨ط³ط±ط¹ط© ظˆط§ط³طھظ‚ط¨ظ„ ط§ظ„طھظ†ط¨ظٹظ‡ط§طھ ط£ط«ظ†ط§ط، ط§ظ„ط´ظٹظپطھ.</p>
        {ios && !canInstall ? (
          <p className="mt-3 rounded-2xl bg-white/10 px-3 py-2 text-sm font-bold leading-6 text-slate-100">
            على iPhone: اضغط "مشاركة" ثم "إضافة إلى الشاشة الرئيسية"
          </p>
        ) : null}
        <div className="mt-4 grid grid-cols-[1fr_auto] gap-2">
          <button
            type="button"
            disabled={!canInstall}
            onClick={onInstall}
            className="rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-black text-slate-950 disabled:opacity-50"
          >
            طھط«ط¨ظٹطھ ط§ظ„طھط·ط¨ظٹظ‚
          </button>
          <button type="button" onClick={onDismiss} className="rounded-2xl border border-white/15 px-4 py-3 text-sm font-black text-white">
            ظ„ط§ط­ظ‚ظ‹ط§
          </button>
        </div>
      </div>
    </section>
  );
}

function OfflineNotice({ syncState }) {
  const label = syncState === "synced"
    ? "طھظ…طھ ط§ظ„ظ…ط²ط§ظ…ظ†ط©"
    : syncState === "syncing"
      ? "ط¬ط§ط±ظٹ ط§ظ„ظ…ط²ط§ظ…ظ†ط©"
      : "ظپظٹ ط§ظ†طھط¸ط§ط± ط§ظ„ظ…ط²ط§ظ…ظ†ط©";
  return (
    <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold leading-6 text-amber-900">
      ط£ظ†طھ ط؛ظٹط± ظ…طھطµظ„ ط¨ط§ظ„ط¥ظ†طھط±ظ†طھطŒ ط³ظٹطھظ… ط­ظپط¸ ط§ظ„طھط؛ظٹظٹط±ط§طھ ظ…ط¤ظ‚طھظ‹ط§.
      <div className="mt-1 text-xs font-black">{label}</div>
    </div>
  );
}

function TaskCard({ task, readOnly, saving, onStatus }) {
  const isCompleted = task.status === "completed";
  const isPending = task.status === "pending";
  const isInProgress = task.status === "in_progress";
  const isOverdue = task.status === "overdue";
  const isOpen = openStatuses.has(task.status);
  const title = localizedTaskText(task, "title");
  const description = localizedTaskText(task, "description");
  const notes = localizedTaskText(task, "notes") || description;

  return (
    <article className={`rounded-2xl border bg-white p-3 shadow-sm ${isCompleted ? "border-emerald-100" : isOverdue ? "border-orange-200 bg-orange-50" : "border-slate-200"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={`rounded-full border px-2.5 py-1 text-[11px] font-black ${priorityClass[task.priority] || priorityClass.medium}`}>
              {task.priority_label_ar || priorityLabel[task.priority] || priorityLabel.medium}
            </span>
            {taskKindLabel(task) ? (
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-black text-emerald-700">
                {taskKindLabel(task)}
              </span>
            ) : null}
            <span className={`rounded-full px-2.5 py-1 text-[11px] font-black ${isCompleted ? "bg-emerald-50 text-emerald-700" : isOverdue ? "bg-orange-100 text-orange-800" : "bg-slate-100 text-slate-700"}`}>
              {task.status_label_ar || statusLabel[task.status] || statusLabel.pending}
            </span>
            {isOverdue ? <span className="rounded-full bg-red-600 px-2.5 py-1 text-[11px] font-black text-white">طھطµط¹ظٹط¯</span> : null}
          </div>
          <h3 className="mt-2 text-base font-black leading-6 text-slate-950">{title}</h3>
        </div>
        {isCompleted ? <CheckCircle2 className="mt-1 h-5 w-5 flex-none text-emerald-600" /> : <ClipboardList className="mt-1 h-5 w-5 flex-none text-slate-400" />}
      </div>

      {description ? <p className="mt-2 line-clamp-2 text-sm font-semibold leading-6 text-slate-600">{description}</p> : null}

      <div className="mt-3 grid gap-1.5 rounded-2xl bg-slate-50 px-3 py-2 text-sm font-bold text-slate-700">
        <div className="flex items-center gap-2">
          <Clock3 className="h-4 w-4 text-slate-500" />
          <span>ط§ظ„ظ…ظˆط¹ط¯: {formatTime(task.due_at)}</span>
        </div>
        <div className="text-sm font-semibold leading-6 text-slate-600">ظ…ظ„ط§ط­ط¸ط§طھ: {notes || "ظ„ط§ طھظˆط¬ط¯ ظ…ظ„ط§ط­ط¸ط§طھ"}</div>
      </div>

      {isOpen ? (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={readOnly || saving || (!isPending && !isOverdue)}
            onClick={() => onStatus(task.id, "in_progress")}
            className={`${isPending || isOverdue ? "inline-flex" : "hidden"} min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 px-3 py-2.5 text-sm font-black text-slate-800 disabled:opacity-45`}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            ط¨ط¯ط،
          </button>
          <button
            type="button"
            disabled={readOnly || saving || !isInProgress}
            onClick={() => onStatus(task.id, "completed")}
            className={`${isInProgress ? "inline-flex" : "hidden"} min-h-11 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-3 py-2.5 text-sm font-black text-white disabled:opacity-45`}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            طھظ… ط§ظ„طھظ†ظپظٹط°
          </button>
        </div>
      ) : null}
    </article>
  );
}

export default function EmployeePortal() {
  usePageTitle("Employee Portal");
  const { token } = useParams();
  const navigate = useNavigate();
  const [portal, setPortal] = useState(null);
  const [loading, setLoading] = useState(true);
  const [savingTaskId, setSavingTaskId] = useState(null);
  const [error, setError] = useState("");
  const [isOnline, setIsOnline] = useState(() => !isBrowser() || window.navigator.onLine !== false);
  const [deferredInstallPrompt, setDeferredInstallPrompt] = useState(null);
  const [installDismissed, setInstallDismissed] = useState(() => isBrowser() && localStorage.getItem(installDismissedKey) === "1");
  const [syncState, setSyncState] = useState("");

  const tasks = normalizeTasks(portal?.tasks);
  const cacheKey = `${portalCachePrefix}${token || ""}`;
  const queueKey = `${portalQueuePrefix}${token || ""}`;
  const employeePortalSwVersion = "20260607";
  const summary = useMemo(() => taskCounts(tasks), [tasks]);
  const queuedActions = readJson(queueKey, []);
  const queuedTaskIds = useMemo(() => new Set(queuedActions.map((item) => String(item.taskId))), [queuedActions]);
  const showInstallBanner = !installDismissed && !isStandalone() && (Boolean(deferredInstallPrompt) || isIos());
  const grouped = useMemo(
    () => ({
      pending: tasks.filter((task) => openStatuses.has(task.status)),
      completed: tasks.filter((task) => task.status === "completed"),
    }),
    [tasks]
  );

  const persistPortal = useCallback((nextPortal) => {
    if (nextPortal) writeJson(cacheKey, { portal: nextPortal, savedAt: new Date().toISOString() });
  }, [cacheKey]);

  const loadCachedPortal = useCallback(() => {
    const cached = readJson(cacheKey, null);
    if (cached?.portal) {
      setPortal(cached.portal);
      setError("");
      return true;
    }
    return false;
  }, [cacheKey]);

  const loadPortal = useCallback(async ({ silent = false } = {}) => {
    try {
      if (!silent) setLoading(true);
      setError("");
      const payload = await staffTasksApi.employeePortal(token, { timeoutMs: EMPLOYEE_PORTAL_LOAD_TIMEOUT_MS });
      const nextPortal = payload.portal || null;
      setPortal(nextPortal);
      persistPortal(nextPortal);
      setSyncState("");
    } catch (err) {
      const hasCache = loadCachedPortal();
      if (hasCache) {
        setSyncState("offline");
        setError("");
      } else {
        setPortal(null);
        setError(err?.responseBody?.message_ar || err?.responseBody?.message || err?.message || "طھط¹ط°ط± طھط­ظ…ظٹظ„ ط¨ظˆط§ط¨ط© ط§ظ„ظ…ظˆط¸ظپ.");
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [isOnline, loadCachedPortal, persistPortal, token]);

  useEffect(() => {
    void loadPortal();
  }, [loadPortal]);

  useEffect(() => {
    console.log("[employee-portal-home-rendered]", import.meta.env.MODE, new Date().toISOString());
  }, []);

  useEffect(() => {
    if (!isBrowser()) return undefined;

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    if (!isBrowser() || !("serviceWorker" in navigator)) return undefined;
    const scope = "/employee/portal/";
    const scriptUrl = `/employee-portal-sw.js?v=${employeePortalSwVersion}`;
    const cleanupOldRegistrations = async () => {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map(async (registration) => {
        const activeScript = registration.active?.scriptURL || registration.waiting?.scriptURL || registration.installing?.scriptURL || "";
        const isEmployeeWorker = activeScript.includes("/employee-portal-sw.js");
        const isRootScoped = registration.scope === `${window.location.origin}/`;
        if (isEmployeeWorker && (isRootScoped || registration.scope !== `${window.location.origin}${scope}`)) {
          await registration.unregister().catch(() => null);
        }
      }));
    };
    cleanupOldRegistrations()
      .then(() => navigator.serviceWorker.register(scriptUrl, { scope }))
      .catch((err) => {
        console.warn("[employee-portal] service worker registration failed", err);
      });
    return undefined;
  }, []);

  useEffect(() => {
    if (!isBrowser()) return undefined;
    const handleBeforeInstallPrompt = (event) => {
      event.preventDefault();
      setDeferredInstallPrompt(event);
    };
    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    return () => window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
  }, []);

  const applyLocalStatus = useCallback((taskId, status) => {
    setPortal((current) => {
      if (!current) return current;
      const nextTasks = normalizeTasks(current.tasks).map((task) =>
        String(task.id) === String(taskId)
          ? {
              ...task,
              status,
              started_at: status === "in_progress" ? task.started_at || new Date().toISOString() : task.started_at,
              completed_at: status === "completed" ? new Date().toISOString() : task.completed_at,
            }
          : task
      );
      return { ...current, tasks: nextTasks, summary: taskCounts(nextTasks) };
    });
  }, []);

  const enqueueAction = useCallback((taskId, status) => {
    const currentQueue = readJson(queueKey, []);
    const nextQueue = [
      ...currentQueue.filter((item) => String(item.taskId) !== String(taskId)),
      { taskId, status, queuedAt: new Date().toISOString() },
    ];
    writeJson(queueKey, nextQueue);
    setSyncState("queued");
  }, [queueKey]);

  const flushQueuedActions = useCallback(async () => {
    const queue = readJson(queueKey, []);
    if (!queue.length || !isOnline) return;
    try {
      setSyncState("syncing");
      for (const item of queue) {
        if (item.status === "completed") {
          await staffTasksApi.completeEmployeePortalTask(token, item.taskId);
        } else {
          await staffTasksApi.updateEmployeePortalStatus(token, item.taskId, { status: item.status });
        }
      }
      writeJson(queueKey, []);
      setSyncState("synced");
      await loadPortal({ silent: true });
    } catch (err) {
      setSyncState("queued");
      toast.error(err?.responseBody?.message_ar || err?.message || "لم تتم مزامنة التغييرات بعد.");
    }
  }, [isOnline, loadPortal, queueKey, token]);

  useEffect(() => {
    if (isOnline) void flushQueuedActions();
  }, [flushQueuedActions, isOnline]);

  const updateStatus = useCallback(async (taskId, status) => {
    const previous = portal;
    try {
      setSavingTaskId(taskId);
      applyLocalStatus(taskId, status);
      persistPortal({
        ...(portal || {}),
        tasks: normalizeTasks(portal?.tasks).map((task) =>
          String(task.id) === String(taskId) ? { ...task, status } : task
        ),
      });
      if (!isOnline) {
        enqueueAction(taskId, status);
        return;
      }
      if (status === "completed") {
        await staffTasksApi.completeEmployeePortalTask(token, taskId);
      } else {
        await staffTasksApi.updateEmployeePortalStatus(token, taskId, { status });
      }
      await loadPortal({ silent: true });
    } catch (err) {
      setPortal(previous);
      toast.error(err?.responseBody?.message_ar || err?.responseBody?.message || err?.message || "لا يمكن تعديل المهمة الآن.");
    } finally {
      setSavingTaskId(null);
    }
  }, [applyLocalStatus, enqueueAction, isOnline, loadPortal, persistPortal, portal, token]);

  const dismissInstall = () => {
    localStorage.setItem(installDismissedKey, "1");
    setInstallDismissed(true);
  };

  const installApp = async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice.catch(() => null);
    setDeferredInstallPrompt(null);
    dismissInstall();
  };

  if (loading) {
    return (
      <main dir="rtl" className="employee-portal-min-screen bg-slate-100 px-3 py-4 pb-[calc(5rem+env(safe-area-inset-bottom))] font-sans text-slate-950">
        <div className="mx-auto max-w-md">
          <header className="employee-portal-safe-top rounded-3xl bg-slate-950 p-4 text-right text-white shadow-xl shadow-slate-300">
            <div className="text-xs font-black text-slate-300">بوابة الموظف</div>
            <div className="mt-2 h-7 w-40 rounded-2xl bg-white/10" />
            <div className="mt-1 h-4 w-28 rounded-full bg-white/10" />
            <div className="mt-4 grid grid-cols-3 gap-2">
              <div className="h-16 rounded-2xl bg-white/10" />
              <div className="h-16 rounded-2xl bg-white/10" />
              <div className="h-16 rounded-2xl bg-white/10" />
            </div>
          </header>
          <section className="mt-4 grid gap-3">
            <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="animate-pulse space-y-3">
                <div className="h-4 w-28 rounded-full bg-slate-200" />
                <div className="h-16 rounded-2xl bg-slate-100" />
                <div className="h-16 rounded-2xl bg-slate-100" />
              </div>
            </div>
            <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="animate-pulse space-y-3">
                <div className="h-4 w-24 rounded-full bg-slate-200" />
                <div className="grid gap-2">
                  <div className="h-14 rounded-2xl bg-slate-100" />
                  <div className="h-14 rounded-2xl bg-slate-100" />
                  <div className="h-14 rounded-2xl bg-slate-100" />
                </div>
              </div>
            </div>
          </section>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main dir="rtl" className="employee-portal-min-screen employee-portal-safe-top bg-slate-100 px-4 py-6 pb-[calc(2rem+env(safe-area-inset-bottom))] font-sans text-slate-950">
        <section className="mx-auto max-w-md rounded-3xl border border-amber-200 bg-white p-5 text-right shadow-sm">
          <AlertTriangle className="h-8 w-8 text-amber-600" />
          <h1 className="mt-4 text-2xl font-black">ط¨ظˆط§ط¨ط© ط§ظ„ظ…ظˆط¸ظپ ط؛ظٹط± ظ…طھط§ط­ط©</h1>
          <p className="mt-2 text-sm font-bold leading-6 text-slate-600">{error}</p>
          <button type="button" onClick={() => loadPortal()} className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 px-4 py-4 text-sm font-black text-white">
            <RefreshCw className="h-4 w-4" />
            ط¥ط¹ط§ط¯ط© ط§ظ„ظ…ط­ط§ظˆظ„ط©
          </button>
        </section>
      </main>
    );
  }

  return (
    <main dir="rtl" className="employee-portal-min-screen bg-slate-100 px-3 py-4 pb-[calc(5rem+env(safe-area-inset-bottom))] font-sans text-slate-950">
      <div className="mx-auto max-w-md">
        <header className="employee-portal-safe-top rounded-3xl bg-slate-950 p-4 text-right text-white shadow-xl shadow-slate-300">
          <div className="text-xs font-black text-slate-300">ط¨ظˆط§ط¨ط© ط§ظ„ظ…ظˆط¸ظپ</div>
          <h1 className="mt-2 text-2xl font-black leading-8">{portal?.employee?.name || "ظ…ظ‡ط§ظ…ظٹ"}</h1>
          <div className="mt-1 text-sm font-semibold leading-6 text-slate-300">{portal?.employee?.branch_name || portal?.employee?.employee_code}</div>
          <div className="mt-4 grid grid-cols-3 gap-2">
            <div className="rounded-2xl bg-white/10 p-3 text-center">
              <div className="text-2xl font-black">{summary.today}</div>
              <div className="text-[11px] font-bold text-slate-300">ظ…ظ‡ط§ظ… ط§ظ„ظٹظˆظ…</div>
            </div>
            <div className="rounded-2xl bg-white/10 p-3 text-center">
              <div className="text-2xl font-black">{summary.pending}</div>
              <div className="text-[11px] font-bold text-slate-300">ظ‚ظٹط¯ ط§ظ„طھظ†ظپظٹط°</div>
            </div>
            <div className="rounded-2xl bg-white/10 p-3 text-center">
              <div className="text-2xl font-black">{summary.completed}</div>
              <div className="text-[11px] font-bold text-slate-300">ظ…ظƒطھظ…ظ„ط©</div>
            </div>
          </div>
        </header>

        {portal?.read_only ? (
          <div className="mt-4 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold leading-6 text-amber-900">
            <Lock className="mt-0.5 h-4 w-4 flex-none" />
            طھظ… طھط³ط¬ظٹظ„ ط§ظ„ط®ط±ظˆط¬طŒ ظ„ط§ ظٹظ…ظƒظ†ظƒ طھط¹ط¯ظٹظ„ ط§ظ„ظ…ظ‡ط§ظ… ط§ظ„ط¢ظ†.
          </div>
        ) : null}

        {showInstallBanner ? (
          <InstallBanner
            ios={isIos()}
            canInstall={Boolean(deferredInstallPrompt)}
            onInstall={installApp}
            onDismiss={dismissInstall}
          />
        ) : null}

        {!isOnline || syncState === "queued" || syncState === "syncing" || syncState === "synced" ? (
          <OfflineNotice syncState={syncState} />
        ) : null}


        <section className="mt-4">
          <button
            type="button"
            onClick={() => navigate(`/employee/portal/${encodeURIComponent(token || "")}/products`)}
            className="flex w-full items-center gap-3 rounded-3xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-4 text-right shadow-sm transition hover:border-emerald-300 hover:shadow-md active:scale-[0.99]"
          >
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-500 text-white">
              <Warehouse className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-black text-slate-950">ط§ظ„ظ…ظ†طھط¬ط§طھ</div>
              <div className="mt-1 text-xs font-semibold leading-5 text-slate-500">ط§ظپطھط­ ط´ط§ط´ط© ط§ظ„ظ…ظ†طھط¬ط§طھ ط§ظ„ط³ط±ظٹط¹ط© ظˆظ†ط¯ط§ط، ط§ظ„ظ…ط®ط²ظ†</div>
            </div>
            <div className="rounded-full bg-emerald-600 px-3 py-1 text-[11px] font-black text-white">ظ†ط¯ط§ط، ط§ظ„ظ…ط®ط²ظ†</div>
          </button>
        </section>

        <section className="mt-5">
          <h2 className="text-sm font-black text-slate-500">ط§ظ„ظ…ظ‡ط§ظ… ط§ظ„ظ…ط·ظ„ظˆط¨ط©</h2>
          <div className="mt-3 grid gap-3">
            {grouped.pending.length ? (
              grouped.pending.map((task) => (
                <TaskCard key={task.id} task={task} readOnly={portal?.read_only} saving={savingTaskId === task.id || queuedTaskIds.has(String(task.id))} onStatus={updateStatus} />
              ))
            ) : (
              <EmptyState>ظ„ط§ طھظˆط¬ط¯ ظ…ظ‡ط§ظ… ظ…ط·ظ„ظˆط¨ط© ط§ظ„ط¢ظ†.</EmptyState>
            )}
          </div>
        </section>

        <section className="mt-6">
          <h2 className="text-sm font-black text-slate-500">ط§ظ„ظ…ظ‡ط§ظ… ط§ظ„ظ…ظƒطھظ…ظ„ط©</h2>
          <div className="mt-3 grid gap-3">
            {grouped.completed.length ? (
              grouped.completed.map((task) => <TaskCard key={task.id} task={task} readOnly saving={false} onStatus={updateStatus} />)
            ) : (
              <EmptyState>ظ„ظ… ظٹطھظ… ط¥ظƒظ…ط§ظ„ ط£ظٹ ظ…ظ‡ظ…ط© ط¨ط¹ط¯.</EmptyState>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}




