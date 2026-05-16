import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { Activity, AlertTriangle, CheckCircle2, Clock, ClipboardList, Play, RefreshCw, Route, UserCheck, Warehouse } from "lucide-react";
import { staffTasksApi } from "../services/staffTasksApi";
import { subscribeRealtime, useRealtimeConnection } from "../../../shared/realtime/socketStore";

const statusLabels = {
  pending: "Pending",
  in_progress: "In progress",
  manager_review: "Manager review",
  completed: "Completed",
  cancelled: "Cancelled",
  overdue: "Overdue",
  reassigned: "Reassigned",
};

const priorityClass = {
  low: "border-slate-300/40 bg-slate-500/10 text-slate-500",
  medium: "border-sky-300/40 bg-sky-500/10 text-sky-500",
  high: "border-amber-300/40 bg-amber-500/10 text-amber-600",
  critical: "border-red-300/50 bg-red-500/10 text-red-600",
};

const metricItems = [
  { key: "open", label: "Open", icon: ClipboardList },
  { key: "urgent", label: "Urgent", icon: AlertTriangle },
  { key: "overdue", label: "Overdue", icon: Clock },
  { key: "completed", label: "Completed", icon: CheckCircle2 },
];

const kanbanStatuses = ["pending", "in_progress", "manager_review", "overdue", "reassigned", "completed"];

const sameJson = (left, right) => {
  try {
    return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
  } catch {
    return false;
  }
};

function formatDate(value) {
  if (!value) return "No deadline";
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
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

function TaskRow({ task, onStart, onComplete }) {
  return (
    <div className="grid gap-3 border-b border-[var(--border)] px-4 py-4 last:border-b-0 lg:grid-cols-[1fr_auto]">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="truncate text-sm font-black text-[var(--text)]">{task.title}</h3>
          <Pill className={priorityClass[task.priority] || priorityClass.medium}>{task.priority}</Pill>
          <Pill className="border-[var(--border)] bg-[var(--surface-soft)] text-[var(--muted)]">{statusLabels[task.status] || task.status}</Pill>
        </div>
        <p className="mt-2 line-clamp-2 text-sm text-[var(--muted)]">{task.description || "No task notes"}</p>
        <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold text-[var(--muted)]">
          <span>{task.assignee_name || "Unassigned"}</span>
          <span>•</span>
          <span>{task.task_type}</span>
          <span>•</span>
          <span>{formatDate(task.due_at)}</span>
          {task.product_name ? (
            <>
              <span>•</span>
              <span>{task.product_name}</span>
            </>
          ) : null}
        </div>
      </div>
      <div className="flex items-center gap-2">
        {task.status === "pending" || task.status === "reassigned" || task.status === "overdue" ? (
          <button
            type="button"
            onClick={() => onStart(task)}
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 text-sm font-bold text-[var(--text)] hover:bg-[var(--surface-soft)]"
          >
            <Play className="h-4 w-4" />
            Start
          </button>
        ) : null}
        {task.status !== "completed" && task.status !== "cancelled" ? (
          <button
            type="button"
            onClick={() => onComplete(task)}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-[var(--primary)] px-3 text-sm font-black text-white"
          >
            <CheckCircle2 className="h-4 w-4" />
            Done
          </button>
        ) : null}
      </div>
    </div>
  );
}

function StaffTasks() {
  const [dashboard, setDashboard] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const realtime = useRealtimeConnection();
  const refreshTimerRef = useRef(null);

  const summary = dashboard?.summary || {};
  const byEmployee = dashboard?.byEmployee || [];
  const history = dashboard?.history || [];

  const filteredTasks = useMemo(() => {
    if (!status) return tasks;
    return tasks.filter((task) => task.status === status);
  }, [status, tasks]);

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
      const [dashboardRes, tasksRes] = await Promise.all([
        staffTasksApi.dashboard(),
        staffTasksApi.list({ limit: 80 }),
      ]);
      const nextDashboard = dashboardRes.dashboard || null;
      const nextTasks = tasksRes.tasks || [];
      setDashboard((current) => (sameJson(current, nextDashboard) ? current : nextDashboard));
      setTasks((current) => (sameJson(current, nextTasks) ? current : nextTasks));
    } catch (loadError) {
      setError(loadError?.message || "Failed to load tasks");
    } finally {
      setLoading((current) => (current ? false : current));
    }
  }, []);

  const debounceRefresh = useCallback(() => {
    if (refreshTimerRef.current) window.clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = window.setTimeout(() => {
      void refresh();
    }, 350);
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
      toast(event.message || "Staff task updated", { id: `staff-task-${event.event}-${event.task_id}` });
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
  }, [debounceRefresh]);

  const runAction = async (key, action) => {
    try {
      setBusy(key);
      setError("");
      await action();
      await refresh();
    } catch (actionError) {
      setError(actionError?.message || "Action failed");
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

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-[var(--text)]">Employee Tasks</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">Attendance-aware task assignment, redistribution, inventory counts, and performance tracking.</p>
          <div className="mt-2 inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-xs font-black text-[var(--muted)]">
            <Activity className={`h-3.5 w-3.5 ${realtime.connected ? "text-emerald-500" : "text-amber-500"}`} />
            {realtime.connected ? "Realtime live" : realtime.connecting ? "Realtime reconnecting" : "Realtime offline"}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy === "inventory"}
            onClick={() => runAction("inventory", () => staffTasksApi.assignInventoryCounts({ limit: 20 }))}
            className="inline-flex h-11 items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 text-sm font-black text-[var(--text)] hover:bg-[var(--surface-soft)] disabled:opacity-60"
          >
            <Warehouse className="h-4 w-4" />
            Daily counts
          </button>
          <button
            type="button"
            disabled={busy === "absence"}
            onClick={() => runAction("absence", () => staffTasksApi.redistributeAbsent({ reason: "manual_absence_review" }))}
            className="inline-flex h-11 items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 text-sm font-black text-[var(--text)] hover:bg-[var(--surface-soft)] disabled:opacity-60"
          >
            <Route className="h-4 w-4" />
            Redistribute
          </button>
          <button
            type="button"
            disabled={busy === "overdue"}
            onClick={() => runAction("overdue", () => staffTasksApi.reassignUnfinished())}
            className="inline-flex h-11 items-center gap-2 rounded-xl bg-[var(--primary)] px-4 text-sm font-black text-white disabled:opacity-60"
          >
            <RefreshCw className="h-4 w-4" />
            Reassign overdue
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-300/50 bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-600">{error}</div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {metricItems.map((item) => {
          const Icon = item.icon;
          return (
            <div key={item.key} className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-[var(--muted)]">{item.label}</span>
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
                  <h3 className="truncate text-xs font-black uppercase text-[var(--muted)]">{statusLabels[key]}</h3>
                  <span className="rounded-full bg-[var(--primary-soft)] px-2 py-0.5 text-xs font-black text-[var(--primary)]">{kanbanGroups[key]?.length || 0}</span>
                </div>
                <div className="mt-3 space-y-2">
                  {(kanbanGroups[key] || []).slice(0, 3).map((task) => (
                    <div key={task.id} className="truncate rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-xs font-bold text-[var(--text)]">
                      {task.title}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="flex flex-col gap-3 border-b border-[var(--border)] p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-black text-[var(--text)]">Task queue</h2>
              <p className="mt-1 text-sm text-[var(--muted)]">{loading ? "Loading tasks" : `${filteredTasks.length} visible tasks`}</p>
            </div>
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              className="h-10 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-semibold text-[var(--text)] outline-none"
            >
              <option value="">All statuses</option>
              {Object.entries(statusLabels).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </div>
          {filteredTasks.length ? (
            filteredTasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                onStart={startTask}
                onComplete={completeTask}
              />
            ))
          ) : (
            <div className="p-8 text-center text-sm font-semibold text-[var(--muted)]">
              {loading ? "Loading task queue..." : "No tasks match this view."}
            </div>
          )}
        </section>

        <aside className="space-y-5">
          <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
            <div className="mb-4 flex items-center gap-2">
              <UserCheck className="h-5 w-5 text-[var(--primary)]" />
              <h2 className="text-base font-black text-[var(--text)]">Performance</h2>
            </div>
            <div className="space-y-3">
              {byEmployee.slice(0, 8).map((employee) => (
                <div key={employee.employee_id} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-black text-[var(--text)]">{employee.employee_name}</div>
                      <div className="mt-1 text-xs text-[var(--muted)]">{employee.role || employee.department || "Staff"}</div>
                    </div>
                    <div className="text-right text-sm font-black text-[var(--primary)]">{Number(employee.completion_rate || 0)}%</div>
                  </div>
                  <div className="mt-2 h-2 rounded-full bg-[var(--surface-soft)]">
                    <div className="h-2 rounded-full bg-[var(--primary)]" style={{ width: `${Math.min(Number(employee.completion_rate || 0), 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
            <h2 className="text-base font-black text-[var(--text)]">Audit trail</h2>
            <div className="mt-4 space-y-3">
              {history.slice(0, 10).map((item) => (
                <div key={item.id} className="border-b border-[var(--border)] pb-3 last:border-b-0 last:pb-0">
                  <div className="text-sm font-black text-[var(--text)]">{item.action}</div>
                  <div className="mt-1 text-xs text-[var(--muted)]">
                    Task #{item.task_id} {item.employee_name ? `• ${item.employee_name}` : ""} • {formatDate(item.created_at)}
                  </div>
                </div>
              ))}
              {!history.length ? <div className="text-sm font-semibold text-[var(--muted)]">No task history yet.</div> : null}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

export default StaffTasks;
