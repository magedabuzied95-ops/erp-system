import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AlertTriangle, CheckCircle2, ClipboardList, Clock3, Loader2, Lock, Play, RefreshCw, Warehouse } from "lucide-react";
import { toast } from "react-hot-toast";

import { staffTasksApi } from "../services/staffTasksApi";

const openStatuses = new Set(["pending", "in_progress", "overdue"]);
const portalCachePrefix = "employee.portal.cache.";
const portalQueuePrefix = "employee.portal.queue.";
const installDismissedKey = "employee.portal.install.dismissed";

const statusLabel = {
  pending: "قيد التنفيذ",
  in_progress: "قيد التنفيذ",
  manager_review: "معلقة",
  overdue: "معلقة",
  reassigned: "معلقة",
  completed: "مكتملة",
  cancelled: "ملغاة",
};

const priorityLabel = {
  low: "منخفضة",
  medium: "متوسطة",
  high: "عالية",
  critical: "عالية جدا",
};

const priorityClass = {
  low: "border-slate-200 bg-slate-100 text-slate-700",
  medium: "border-sky-100 bg-sky-50 text-sky-700",
  high: "border-amber-100 bg-amber-50 text-amber-800",
  critical: "border-red-100 bg-red-50 text-red-700",
};

const formatTime = (value) => {
  if (!value) return "غير محدد";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "غير محدد";
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

const urlBase64ToUint8Array = (base64String = "") => {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = `${base64String}${padding}`.replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
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
        <h2 className="text-lg font-black">ثبّت بوابة الموظف على الموبايل</h2>
        <p className="mt-2 text-sm font-semibold leading-6 text-slate-300">افتح التاسكات بسرعة واستقبل التنبيهات أثناء الشيفت.</p>
        {ios && !canInstall ? (
          <p className="mt-3 rounded-2xl bg-white/10 px-3 py-2 text-sm font-bold leading-6 text-slate-100">
            على iPhone: اضغط مشاركة ثم Add to Home Screen
          </p>
        ) : null}
        <div className="mt-4 grid grid-cols-[1fr_auto] gap-2">
          <button
            type="button"
            disabled={!canInstall}
            onClick={onInstall}
            className="rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-black text-slate-950 disabled:opacity-50"
          >
            تثبيت التطبيق
          </button>
          <button type="button" onClick={onDismiss} className="rounded-2xl border border-white/15 px-4 py-3 text-sm font-black text-white">
            لاحقًا
          </button>
        </div>
      </div>
    </section>
  );
}

function OfflineNotice({ syncState }) {
  const label = syncState === "synced"
    ? "تمت المزامنة"
    : syncState === "syncing"
      ? "جاري المزامنة"
      : "في انتظار المزامنة";
  return (
    <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold leading-6 text-amber-900">
      أنت غير متصل بالإنترنت، سيتم حفظ التغييرات مؤقتًا.
      <div className="mt-1 text-xs font-black">{label}</div>
    </div>
  );
}

function NotificationCard({ state, hint, onEnable }) {
  const message = hint || (state === "granted"
    ? "تنبيهات التاسكات مفعلة على هذا الجهاز"
    : state === "denied"
      ? "تم رفض التنبيهات من إعدادات المتصفح"
      : state === "unsupported"
        ? "المتصفح لا يدعم تنبيهات التاسكات."
        : "استقبل تنبيه عند تحديث مهام الشيفت.");
  return (
    <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 text-right shadow-sm">
      <div className="text-sm font-black text-slate-950">تفعيل تنبيهات التاسكات</div>
      <p className="mt-1 text-sm font-semibold leading-6 text-slate-600">{message}</p>
      {state !== "granted" && state !== "unsupported" ? (
        <button type="button" onClick={onEnable} className="mt-3 w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-black text-white">
          تفعيل تنبيهات التاسكات
        </button>
      ) : null}
    </section>
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
            <span className={`rounded-full px-2.5 py-1 text-[11px] font-black ${isCompleted ? "bg-emerald-50 text-emerald-700" : isOverdue ? "bg-orange-100 text-orange-800" : "bg-slate-100 text-slate-700"}`}>
              {task.status_label_ar || statusLabel[task.status] || statusLabel.pending}
            </span>
            {isOverdue ? <span className="rounded-full bg-red-600 px-2.5 py-1 text-[11px] font-black text-white">تصعيد</span> : null}
          </div>
          <h3 className="mt-2 text-base font-black leading-6 text-slate-950">{title}</h3>
        </div>
        {isCompleted ? <CheckCircle2 className="mt-1 h-5 w-5 flex-none text-emerald-600" /> : <ClipboardList className="mt-1 h-5 w-5 flex-none text-slate-400" />}
      </div>

      {description ? <p className="mt-2 line-clamp-2 text-sm font-semibold leading-6 text-slate-600">{description}</p> : null}

      <div className="mt-3 grid gap-1.5 rounded-2xl bg-slate-50 px-3 py-2 text-sm font-bold text-slate-700">
        <div className="flex items-center gap-2">
          <Clock3 className="h-4 w-4 text-slate-500" />
          <span>الموعد: {formatTime(task.due_at)}</span>
        </div>
        <div className="text-sm font-semibold leading-6 text-slate-600">ملاحظات: {notes || "لا توجد ملاحظات"}</div>
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
            بدء
          </button>
          <button
            type="button"
            disabled={readOnly || saving || !isInProgress}
            onClick={() => onStatus(task.id, "completed")}
            className={`${isInProgress ? "inline-flex" : "hidden"} min-h-11 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-3 py-2.5 text-sm font-black text-white disabled:opacity-45`}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            تم التنفيذ
          </button>
        </div>
      ) : null}
    </article>
  );
}

export default function EmployeePortal() {
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
  const [notificationState, setNotificationState] = useState(() => {
    if (!isBrowser() || !("Notification" in window)) return "unsupported";
    return window.Notification.permission;
  });
  const [notificationHint, setNotificationHint] = useState("");

  const tasks = normalizeTasks(portal?.tasks);
  const cacheKey = `${portalCachePrefix}${token || ""}`;
  const queueKey = `${portalQueuePrefix}${token || ""}`;
  const summary = useMemo(() => taskCounts(tasks), [tasks]);
  const queuedActions = useMemo(() => readJson(queueKey, []), [queueKey, syncState]);
  const queuedTaskIds = useMemo(() => new Set(queuedActions.map((item) => String(item.taskId))), [queuedActions]);
  const showInstallBanner = !installDismissed && !isStandalone() && (Boolean(deferredInstallPrompt) || isIos());
  const grouped = useMemo(
    () => ({
      pending: tasks.filter((task) => openStatuses.has(task.status)),
      completed: tasks.filter((task) => task.status === "completed"),
    }),
    [tasks]
  );

  const persistPortal = (nextPortal) => {
    if (nextPortal) writeJson(cacheKey, { portal: nextPortal, savedAt: new Date().toISOString() });
  };

  const loadCachedPortal = () => {
    const cached = readJson(cacheKey, null);
    if (cached?.portal) {
      setPortal(cached.portal);
      setError("");
      return true;
    }
    return false;
  };

  const loadPortal = async ({ silent = false } = {}) => {
    try {
      if (!silent) setLoading(true);
      setError("");
      const payload = await staffTasksApi.employeePortal(token);
      const nextPortal = payload.portal || null;
      setPortal(nextPortal);
      persistPortal(nextPortal);
      setSyncState("");
    } catch (err) {
      const hasCache = loadCachedPortal();
      if (hasCache && !isOnline) {
        setSyncState("offline");
      } else {
        setPortal(null);
        setError(err?.responseBody?.message_ar || err?.responseBody?.message || err?.message || "تعذر تحميل بوابة الموظف.");
      }
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    void loadPortal();
  }, [token]);

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
    const scriptUrl = "/employee-portal-sw.js";
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

  const applyLocalStatus = (taskId, status) => {
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
  };

  const enqueueAction = (taskId, status) => {
    const currentQueue = readJson(queueKey, []);
    const nextQueue = [
      ...currentQueue.filter((item) => String(item.taskId) !== String(taskId)),
      { taskId, status, queuedAt: new Date().toISOString() },
    ];
    writeJson(queueKey, nextQueue);
    setSyncState("queued");
  };

  const flushQueuedActions = async () => {
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
  };

  useEffect(() => {
    if (isOnline) void flushQueuedActions();
  }, [isOnline, token]);

  const updateStatus = async (taskId, status) => {
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
  };

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

  const enableNotifications = async () => {
    if (!isBrowser() || !("Notification" in window)) {
      setNotificationState("unsupported");
      return;
    }
    const permission = window.Notification.permission === "default"
      ? await window.Notification.requestPermission()
      : window.Notification.permission;
    setNotificationState(permission);
    if (permission !== "granted") return;

    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
      const registration = await navigator.serviceWorker.ready;
      const keyResponse = await staffTasksApi.employeePortalPushKey(token);
      const publicKey = keyResponse?.publicKey || "";
      if (!publicKey) {
        if (import.meta.env.DEV) setNotificationHint("التنبيهات جاهزة لكن مفاتيح الإرسال غير مفعلة بعد.");
        return;
      }
      const existing = await registration.pushManager.getSubscription();
      const subscription = existing || await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      await staffTasksApi.subscribeEmployeePortalPush(token, {
        ...subscription.toJSON(),
        portal_url: window.location.href,
      });
      setNotificationHint("تنبيهات التاسكات مفعلة على هذا الجهاز");
    } catch (err) {
      console.warn("[employee-portal] push subscription skipped", err);
    }
  };

  if (loading) {
    return (
      <main dir="rtl" className="flex min-h-[100dvh] items-center justify-center bg-slate-100 p-5 font-sans text-slate-800">
        <Loader2 className="h-6 w-6 animate-spin" />
      </main>
    );
  }

  if (error) {
    return (
      <main dir="rtl" className="min-h-[100dvh] bg-slate-100 px-4 py-6 pb-[calc(2rem+env(safe-area-inset-bottom))] font-sans text-slate-950">
        <section className="mx-auto max-w-md rounded-3xl border border-amber-200 bg-white p-5 text-right shadow-sm">
          <AlertTriangle className="h-8 w-8 text-amber-600" />
          <h1 className="mt-4 text-2xl font-black">بوابة الموظف غير متاحة</h1>
          <p className="mt-2 text-sm font-bold leading-6 text-slate-600">{error}</p>
          <button type="button" onClick={() => loadPortal()} className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 px-4 py-4 text-sm font-black text-white">
            <RefreshCw className="h-4 w-4" />
            إعادة المحاولة
          </button>
        </section>
      </main>
    );
  }

  return (
    <main dir="rtl" className="min-h-[100dvh] bg-slate-100 px-3 py-4 pb-[calc(5rem+env(safe-area-inset-bottom))] font-sans text-slate-950">
      <div className="mx-auto max-w-md">
        <header className="rounded-3xl bg-slate-950 p-4 text-right text-white shadow-xl shadow-slate-300">
          <div className="text-xs font-black text-slate-300">بوابة الموظف</div>
          <h1 className="mt-2 text-2xl font-black leading-8">{portal?.employee?.name || "مهامي"}</h1>
          <div className="mt-1 text-sm font-semibold leading-6 text-slate-300">{portal?.employee?.branch_name || portal?.employee?.employee_code}</div>
          <div className="mt-4 grid grid-cols-3 gap-2">
            <div className="rounded-2xl bg-white/10 p-3 text-center">
              <div className="text-2xl font-black">{summary.today}</div>
              <div className="text-[11px] font-bold text-slate-300">مهام اليوم</div>
            </div>
            <div className="rounded-2xl bg-white/10 p-3 text-center">
              <div className="text-2xl font-black">{summary.pending}</div>
              <div className="text-[11px] font-bold text-slate-300">قيد التنفيذ</div>
            </div>
            <div className="rounded-2xl bg-white/10 p-3 text-center">
              <div className="text-2xl font-black">{summary.completed}</div>
              <div className="text-[11px] font-bold text-slate-300">مكتملة</div>
            </div>
          </div>
        </header>

        {portal?.read_only ? (
          <div className="mt-4 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold leading-6 text-amber-900">
            <Lock className="mt-0.5 h-4 w-4 flex-none" />
            تم تسجيل الخروج، لا يمكنك تعديل المهام الآن.
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

        <NotificationCard state={notificationState} hint={notificationHint} onEnable={enableNotifications} />

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
              <div className="text-sm font-black text-slate-950">المنتجات</div>
              <div className="mt-1 text-xs font-semibold leading-5 text-slate-500">افتح شاشة المنتجات السريعة ونداء المخزن</div>
            </div>
            <div className="rounded-full bg-emerald-600 px-3 py-1 text-[11px] font-black text-white">نداء المخزن</div>
          </button>
        </section>

        <section className="mt-5">
          <h2 className="text-sm font-black text-slate-500">المهام المطلوبة</h2>
          <div className="mt-3 grid gap-3">
            {grouped.pending.length ? (
              grouped.pending.map((task) => (
                <TaskCard key={task.id} task={task} readOnly={portal?.read_only} saving={savingTaskId === task.id || queuedTaskIds.has(String(task.id))} onStatus={updateStatus} />
              ))
            ) : (
              <EmptyState>لا توجد مهام مطلوبة الآن.</EmptyState>
            )}
          </div>
        </section>

        <section className="mt-6">
          <h2 className="text-sm font-black text-slate-500">المهام المكتملة</h2>
          <div className="mt-3 grid gap-3">
            {grouped.completed.length ? (
              grouped.completed.map((task) => <TaskCard key={task.id} task={task} readOnly saving={false} onStatus={updateStatus} />)
            ) : (
              <EmptyState>لم يتم إكمال أي مهمة بعد.</EmptyState>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
