import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Clock3,
  ExternalLink,
  Loader2,
  RefreshCw,
  Send,
  UserCheck,
  XCircle,
} from "lucide-react";

import { api } from "../../../shared/api/api";
import { formatCurrency } from "../../../shared/lib/currency";
import { getCurrentTenant, getCurrentUser } from "../../../shared/auth/authStorage";
import { useTenant } from "../../saas/context/TenantContext";

const asArray = (value) => (Array.isArray(value) ? value : []);
const text = (value = "") => String(value || "").trim();
const lower = (value = "") => text(value).toLowerCase();
const money = (value) => formatCurrency(Number(value || 0));
const tenantIdFrom = (tenantApi) => {
  const currentTenant = tenantApi?.currentTenant || getCurrentTenant?.() || {};
  const currentUser = getCurrentUser?.() || {};
  return String(currentTenant.id || currentTenant.tenant_id || currentUser.tenant_id || currentUser.tenantId || "1");
};
const formatDateTime = (value) => {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Unknown";
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
};
const formatRelative = (value) => {
  if (!value) return "Unknown";
  const date = new Date(value);
  const diff = Date.now() - date.getTime();
  if (!Number.isFinite(diff)) return "Unknown";
  const minutes = Math.max(0, Math.round(diff / 60000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
};
const isToday = (value) => {
  if (!value) return false;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return false;
  const now = new Date();
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
};
const channelLabel = (value = "") => {
  const channel = lower(value);
  if (channel.includes("whatsapp")) return "WhatsApp";
  if (channel.includes("messenger") || channel === "facebook") return "Messenger";
  if (channel.includes("instagram")) return "Instagram";
  if (channel.includes("web")) return "Website";
  return value || "Web";
};
const channelTone = (value = "") => {
  const channel = lower(value);
  if (channel.includes("whatsapp")) return "border-emerald-300/20 bg-emerald-400/10 text-emerald-100";
  if (channel.includes("messenger")) return "border-primary/20 bg-primary/10 text-primary";
  if (channel.includes("instagram")) return "border-fuchsia-300/20 bg-fuchsia-400/10 text-fuchsia-100";
  return "border-white/10 bg-slate-950/50 text-slate-300";
};
const priorityMeta = (value = "medium") => {
  const key = lower(value);
  if (key === "high") return { label: "High", tone: "border-rose-300/20 bg-rose-400/10 text-rose-100" };
  if (key === "low") return { label: "Low", tone: "border-white/10 bg-slate-950/45 text-slate-300" };
  return { label: "Medium", tone: "border-amber-300/20 bg-amber-400/10 text-amber-100" };
};
const taskTone = (value = "") => {
  const key = lower(value);
  if (key.includes("complaint") || key.includes("escalat") || key.includes("refund") || key.includes("manager")) {
    return "border-rose-300/20 bg-rose-400/10 text-rose-100";
  }
  if (key.includes("follow")) {
    return "border-primary/20 bg-primary/10 text-primary";
  }
  if (key.includes("reply") || key.includes("message")) {
    return "border-violet-300/20 bg-violet-400/10 text-violet-100";
  }
  return "border-white/10 bg-slate-950/45 text-slate-300";
};
const statusTabs = [
  { key: "all", label: "All" },
  { key: "needs_reply", label: "Needs Reply" },
  { key: "needs_follow_up", label: "Needs Follow-up" },
  { key: "needs_manager", label: "Needs Manager" },
  { key: "resolved", label: "Resolved" },
];
const quickFilters = [
  { key: "whatsapp", label: "WhatsApp" },
  { key: "messenger", label: "Messenger" },
  { key: "instagram", label: "Instagram" },
  { key: "website", label: "Website" },
  { key: "assigned_to_me", label: "Assigned to me" },
  { key: "unassigned", label: "Unassigned" },
  { key: "today", label: "Today" },
];

function EmptyState({ text = "No follow-ups need action right now." }) {
  return (
    <div className="rounded-3xl border border-dashed border-white/10 bg-white/[0.03] p-8 text-center text-sm text-slate-500">
      {text}
    </div>
  );
}

function KpiCard({ label, value, tone = "zinc" }) {
  const tones = {
    cyan: "border-primary/15 bg-primary/10 text-primary",
    emerald: "border-emerald-300/15 bg-emerald-400/10 text-emerald-100",
    amber: "border-amber-300/15 bg-amber-400/10 text-amber-100",
    rose: "border-rose-300/15 bg-rose-400/10 text-rose-100",
    zinc: "border-white/10 bg-white/[0.045] text-white",
  };
  return (
    <div className={`rounded-2xl border p-4 shadow-[0_12px_32px_rgba(0,0,0,0.12)] ${tones[tone] || tones.zinc}`}>
      <div className="text-[11px] font-black uppercase tracking-[0.16em] opacity-70">{label}</div>
      <div className="mt-2 text-2xl font-black">{value}</div>
    </div>
  );
}

function Badge({ children, tone = "zinc", className = "" }) {
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-black leading-none ${tone} ${className}`}>{children}</span>;
}

function FollowupCard({
  row,
  draft,
  forceClosed,
  busy,
  onDraftChange,
  onForceClosedChange,
  onSendManual,
  onSnooze,
  onCancel,
  onDone,
  onTakeover,
  onOpenInbox,
}) {
  const taskLabel = text(row.trigger_type || row.bucket || "follow-up");
  const priority = priorityMeta(row.priority || row.priority_level || row.priority_label || row.derived_priority || (row.category === "needs_manager" ? "high" : row.category === "resolved" ? "low" : row.bucket === "due" ? "high" : row.bucket === "scheduled" ? "medium" : "low"));
  const lastActivity = row.last_sent_at || row.manual_ready_at || row.updated_at || row.scheduled_at || row.conversation?.updated_at || row.conversation?.closed_at || row.created_at;
  const confidenceValue = row.confidence_score ?? row.payload?.confidence_score ?? row.payload?.confidence ?? row.payload?.ai_confidence ?? "";
  const revenueValue = row.expected_revenue ?? row.payload?.expected_revenue ?? row.payload?.estimated_revenue ?? row.payload?.revenue ?? row.payload?.expected_order_value ?? "";
  const detailsText = text(
      row.suggested_message ||
      row.payload?.followup_reason ||
      row.payload?.reason ||
      row.payload?.last_answer ||
      row.payload?.summary ||
      ""
  );
  const assignedName = text(row.conversation?.assigned_user_name || "");
  const assignedId = row.conversation?.assigned_user_id || null;
  const isAssigned = Boolean(assignedId || assignedName);
  const claimLabel = isAssigned ? "Assign / Claim" : "Claim";
  const snoozeDisabled = busy || row.status === "completed" || row.status === "done" || row.status === "cancelled" || row.status === "stopped";
  const showDetails = Boolean(detailsText || row.payload?.manual_message || row.payload?.followup_reason || row.payload?.reason);
  const isClosedConversation = lower(row.conversation?.status) === "closed";

  return (
    <article className="rounded-2xl border border-white/10 bg-white/[0.045] p-3 shadow-[0_16px_44px_rgba(0,0,0,0.18)] transition hover:border-white/20">
      <div className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <div className="min-w-0 truncate text-sm font-black text-white sm:text-[15px]">{row.customer?.name || "Customer"}</div>
              <Badge tone={channelTone(row.channel || row.source_channel)}>{channelLabel(row.channel || row.source_channel)}</Badge>
              <Badge tone={priority.tone}>{priority.label}</Badge>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
              <span>{formatRelative(lastActivity)}</span>
              <span className="text-slate-600">•</span>
              <span>Activity {formatDateTime(lastActivity)}</span>
              {assignedName ? (
                <>
                  <span className="text-slate-600">•</span>
                  <span>Assigned: {assignedName}</span>
                </>
              ) : null}
            </div>
          </div>
          <div className="shrink-0 text-right">
            <Badge tone={taskTone(taskLabel)} className="justify-center">{taskLabel}</Badge>
            {row.category ? <div className="mt-1 text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">{row.category.replace(/_/g, " ")}</div> : null}
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-3">
          {confidenceValue !== "" && confidenceValue !== null && confidenceValue !== undefined ? (
            <div className="rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2">
              <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">AI confidence</div>
              <div className="mt-1 text-sm font-black text-white">{Number(confidenceValue) > 1 ? `${Math.round(Number(confidenceValue))}%` : `${Math.round(Number(confidenceValue) * 100)}%`}</div>
            </div>
          ) : (
            <div className="rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2">
              <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">AI confidence</div>
              <div className="mt-1 text-sm font-black text-slate-500">Not available</div>
            </div>
          )}
          {revenueValue !== "" && revenueValue !== null && revenueValue !== undefined ? (
            <div className="rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2">
              <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">Expected revenue</div>
              <div className="mt-1 text-sm font-black text-white">{money(revenueValue)}</div>
            </div>
          ) : (
            <div className="rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2">
              <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">Expected revenue</div>
              <div className="mt-1 text-sm font-black text-slate-500">Not available</div>
            </div>
          )}
          <div className="rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2">
            <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">Conversation</div>
            <div className="mt-1 text-sm font-black text-white">{text(row.session_id || row.conversation?.session_id || "—")}</div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => onOpenInbox?.(row)} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-primary px-3 text-sm font-black text-slate-950">
            <ExternalLink className="h-4 w-4" />
            Open Inbox
          </button>
          <button
            type="button"
            onClick={() => onTakeover?.(row)}
            disabled={busy}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.06] px-3 text-sm font-black text-slate-100 disabled:opacity-45"
          >
            <UserCheck className="h-4 w-4" />
            {claimLabel}
          </button>
          <button
            type="button"
            onClick={() => onDone?.(row)}
            disabled={busy}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-emerald-300/20 bg-emerald-400/10 px-3 text-sm font-black text-emerald-100 disabled:opacity-45"
          >
            <CheckCircle2 className="h-4 w-4" />
            Resolve
          </button>
          <button
            type="button"
            onClick={() => onSnooze?.(row, 1440)}
            disabled={snoozeDisabled}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.06] px-3 text-sm font-black text-slate-100 disabled:opacity-45"
          >
            <Clock3 className="h-4 w-4" />
            Follow later
          </button>
        </div>

        {showDetails ? (
          <details className="rounded-2xl border border-white/10 bg-slate-950/50 p-3">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-black text-white">
              <span>View details</span>
              <ChevronDown className="h-4 w-4 text-slate-400" />
            </summary>
            <div className="mt-3 grid gap-3">
              <div className="rounded-xl border border-white/10 bg-white/[0.035] p-3 text-sm leading-6 text-slate-300" dir="auto">
                {detailsText || "No additional details available."}
              </div>
              <textarea
                value={draft}
                onChange={(event) => onDraftChange?.(event.target.value)}
                rows={3}
                className="w-full resize-none rounded-xl border border-white/10 bg-slate-950/70 p-3 text-sm leading-6 text-white outline-none focus:border-primary/40"
                placeholder="Internal note for staff..."
                dir="auto"
              />
              {isClosedConversation ? (
                <label className="inline-flex items-center gap-2 text-xs font-bold text-rose-100">
                  <input
                    type="checkbox"
                    checked={forceClosed}
                    onChange={(event) => onForceClosedChange?.(event.target.checked)}
                    className="h-4 w-4 rounded border-white/20 bg-slate-950"
                  />
                  Force internal note for closed conversation
                </label>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => onSendManual?.(row)}
                  disabled={busy || !text(draft)}
                  className="inline-flex h-9 items-center justify-center gap-2 rounded-xl bg-primary px-3 text-xs font-black text-slate-950 disabled:opacity-45"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  Send manual note
                </button>
                <button
                  type="button"
                  onClick={() => onSnooze?.(row, 60)}
                  disabled={snoozeDisabled}
                  className="inline-flex h-9 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.06] px-3 text-xs font-black text-slate-100 disabled:opacity-45"
                >
                  <Clock3 className="h-4 w-4" />
                  Snooze 1h
                </button>
                <button
                  type="button"
                  onClick={() => onCancel?.(row)}
                  disabled={busy}
                  className="inline-flex h-9 items-center justify-center gap-2 rounded-xl border border-rose-300/20 bg-rose-400/10 px-3 text-xs font-black text-rose-100 disabled:opacity-45"
                >
                  <XCircle className="h-4 w-4" />
                  Cancel
                </button>
              </div>
            </div>
          </details>
        ) : null}
      </div>
    </article>
  );
}

export default function AiFollowups() {
  const navigate = useNavigate();
  const tenantApi = useTenant();
  const tenantId = useMemo(() => tenantIdFrom(tenantApi), [tenantApi]);
  const headers = useMemo(() => ({ "x-tenant-id": tenantId }), [tenantId]);
  const currentUser = getCurrentUser?.() || {};
  const currentUserId = String(currentUser.id || currentUser.user_id || currentUser.userId || "");
  const [followups, setFollowups] = useState([]);
  const [counts, setCounts] = useState({});
  const [activeStatus, setActiveStatus] = useState("all");
  const [activeFilter, setActiveFilter] = useState("all");
  const [drafts, setDrafts] = useState({});
  const [forceClosed, setForceClosed] = useState({});
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [visibleCount, setVisibleCount] = useState(24);

  const loadFollowups = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const payload = await api.get("/ai-agent/followups", {
        params: { tenant_id: tenantId, status: "all", limit: 200 },
        headers,
      });
      const rows = asArray(payload.followups).map((row) => {
        const scheduledAt = row.scheduled_at || row.manual_ready_at || row.updated_at || row.created_at || "";
        const bucket = lower(row.bucket || "");
        const taskReason = lower(row.trigger_type || row.payload?.reason || row.payload?.followup_reason || "");
        const managerSignal =
          Boolean(row.payload?.needs_manager || row.payload?.manager_required || row.payload?.requires_manager) ||
          /complaint|refund|escalat|manager|angry|issue/.test(`${taskReason} ${text(row.payload?.summary || row.payload?.last_answer || row.suggested_message || "")}`.toLowerCase());
        const taskState = row.status === "completed" || row.status === "done" || bucket === "completed"
          ? "resolved"
          : managerSignal
            ? "needs_manager"
            : bucket === "due"
              ? "needs_reply"
              : bucket === "scheduled"
                ? "needs_follow_up"
                : "needs_reply";
        const priority =
          lower(row.priority || row.priority_level || row.payload?.priority || row.payload?.priority_level || "") ||
          (taskState === "needs_manager" ? "high" : bucket === "due" ? "high" : bucket === "scheduled" ? "medium" : "low");
        return {
          ...row,
          category: taskState,
          priority,
          channel: text(row.channel || row.source_channel || row.conversation?.channel || row.conversation?.source_channel || ""),
          scheduled_at: scheduledAt,
          is_today: isToday(scheduledAt),
          expected_revenue: row.expected_revenue ?? row.payload?.expected_revenue ?? row.payload?.estimated_revenue ?? row.payload?.revenue ?? row.payload?.expected_order_value ?? "",
          confidence_score: row.confidence_score ?? row.payload?.confidence_score ?? row.payload?.confidence ?? row.payload?.ai_confidence ?? "",
          task_reason: row.task_reason || row.trigger_type || row.payload?.followup_reason || row.payload?.reason || row.payload?.summary || "",
        };
      });
      setFollowups(rows);
      setCounts(payload.counts || {});
      setDrafts((current) => {
        const next = { ...current };
        rows.forEach((row) => {
          if (!next[row.id]) next[row.id] = row.manual_message || row.suggested_message || "";
        });
        return next;
      });
    } catch (err) {
      setError(err?.message || "Failed to load AI follow-ups");
    } finally {
      setLoading(false);
    }
  }, [headers, tenantId]);

  useEffect(() => {
    void loadFollowups();
  }, [loadFollowups]);

  useEffect(() => {
    setVisibleCount(24);
  }, [activeStatus, activeFilter]);

  const runAction = async (id, label, action) => {
    setBusyId(`${label}:${id}`);
    setError("");
    setNotice("");
    try {
      await action();
      setNotice(label);
      await loadFollowups();
    } catch (err) {
      setError(err?.message || "Action failed");
    } finally {
      setBusyId("");
    }
  };

  const sendManual = (row) =>
    runAction(row.id, "Internal note sent", () =>
      api.post(
        `/ai-agent/followups/${row.id}/send-manual`,
        { tenant_id: tenantId, message: drafts[row.id] || row.suggested_message || "", force: forceClosed[row.id] === true },
        { headers }
      )
    );

  const snooze = (row, minutes) =>
    runAction(row.id, "Follow-up snoozed", () =>
      api.patch(`/ai-agent/followups/${row.id}/snooze`, { tenant_id: tenantId, minutes }, { headers })
    );

  const cancel = (row) =>
    runAction(row.id, "Follow-up cancelled", () =>
      api.patch(`/ai-agent/followups/${row.id}/cancel`, { tenant_id: tenantId, reason: "cancelled_from_followup_center" }, { headers })
    );

  const done = (row) =>
    runAction(row.id, "Follow-up marked done", () =>
      api.patch(`/ai-agent/followups/${row.id}/done`, { tenant_id: tenantId }, { headers })
    );

  const takeover = (row) =>
    runAction(row.id, "Conversation taken over", () =>
      api.post(`/ai-agent/inbox/${encodeURIComponent(row.session_id)}/takeover`, { tenant_id: tenantId }, { headers })
    );

  const openInbox = useCallback(
    (row) => {
      const conversationId = text(row.session_id || row.conversation?.session_id || "");
      if (!conversationId) return;
      navigate(`/admin/ai-inbox?conversation=${encodeURIComponent(conversationId)}${row.channel ? `&channel=${encodeURIComponent(row.channel)}` : ""}`);
    },
    [navigate]
  );

  const filtered = useMemo(() => {
    let rows = [...followups];
    if (activeStatus !== "all") rows = rows.filter((row) => row.category === activeStatus);
    if (activeFilter === "assigned_to_me") rows = rows.filter((row) => String(row.conversation?.assigned_user_id || "") === currentUserId);
    if (activeFilter === "unassigned") rows = rows.filter((row) => !row.conversation?.assigned_user_id && !text(row.conversation?.assigned_user_name));
    if (activeFilter === "today") rows = rows.filter((row) => row.is_today);
    if (activeFilter === "whatsapp" || activeFilter === "messenger" || activeFilter === "instagram" || activeFilter === "website") {
      rows = rows.filter((row) => {
        const channel = lower(row.channel);
        if (activeFilter === "whatsapp") return channel.includes("whatsapp");
        if (activeFilter === "messenger") return channel.includes("messenger") || channel === "facebook";
        if (activeFilter === "instagram") return channel.includes("instagram");
        return channel.includes("web");
      });
    }
    rows.sort((left, right) => {
      const leftPriority = lower(left.priority) === "high" ? 0 : lower(left.priority) === "medium" ? 1 : 2;
      const rightPriority = lower(right.priority) === "high" ? 0 : lower(right.priority) === "medium" ? 1 : 2;
      return leftPriority - rightPriority || new Date(right.scheduled_at || right.updated_at || 0) - new Date(left.scheduled_at || left.updated_at || 0);
    });
    return rows;
  }, [activeFilter, activeStatus, currentUserId, followups]);

  const visibleFollowups = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount]);
  const stats = useMemo(() => {
    const total = followups.length;
    const needsReply = followups.filter((row) => row.category === "needs_reply").length;
    const needsFollowUp = followups.filter((row) => row.category === "needs_follow_up").length;
    const needsManager = followups.filter((row) => row.category === "needs_manager").length;
    const resolved = followups.filter((row) => row.category === "resolved").length;
    return { total, needsReply, needsFollowUp, needsManager, resolved };
  }, [followups]);

  return (
    <div dir="ltr" className="min-h-full bg-[linear-gradient(180deg,#020617,#0f172a)] p-3 text-white md:p-6">
      <div className="mx-auto flex max-w-[96rem] flex-col gap-4">
        <section className="rounded-3xl border border-white/10 bg-white/[0.055] p-4 md:p-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-2 text-sm font-black uppercase tracking-[0.16em] text-primary">
                <Clock3 className="h-4 w-4" />
                AI Follow-up Execution Center
              </div>
              <h1 className="mt-3 text-2xl font-black md:text-3xl">Follow-ups ready for staff action</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
                Compact task queue for follow-up handling. Staff can triage, claim, resolve, snooze, or jump back to the exact conversation in AI Inbox.
              </p>
            </div>
            <button
              type="button"
              onClick={loadFollowups}
              disabled={loading}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-black text-slate-950 disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Refresh
            </button>
          </div>
          {error ? (
            <div className="mt-4 flex items-center gap-2 rounded-xl border border-rose-300/20 bg-rose-400/10 p-3 text-sm font-bold text-rose-100">
              <AlertTriangle className="h-4 w-4" />
              {error}
            </div>
          ) : null}
          {notice ? (
            <div className="mt-4 flex items-center gap-2 rounded-xl border border-emerald-300/20 bg-emerald-400/10 p-3 text-sm font-bold text-emerald-100">
              <CheckCircle2 className="h-4 w-4" />
              {notice}
            </div>
          ) : null}
        </section>

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <KpiCard label="All" value={stats.total} tone="cyan" />
          <KpiCard label="Needs Reply" value={stats.needsReply} tone="amber" />
          <KpiCard label="Needs Follow-up" value={stats.needsFollowUp} tone="zinc" />
          <KpiCard label="Needs Manager" value={stats.needsManager} tone="rose" />
          <KpiCard label="Resolved" value={stats.resolved} tone="emerald" />
        </section>

        <section className="flex flex-wrap gap-2 rounded-3xl border border-white/10 bg-white/[0.035] p-2.5">
          {statusTabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveStatus(tab.key)}
              className={`h-10 rounded-xl px-4 text-sm font-black transition ${
                activeStatus === tab.key
                  ? "bg-white text-slate-950"
                  : "border border-white/10 bg-white/[0.045] text-slate-300 hover:bg-white/10"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </section>

        <section className="flex flex-wrap gap-2">
          {quickFilters.map((filter) => (
            <button
              key={filter.key}
              type="button"
              onClick={() => setActiveFilter(filter.key)}
              className={`h-9 rounded-full px-3 text-xs font-black transition ${
                activeFilter === filter.key
                  ? "bg-primary text-slate-950"
                  : "border border-white/10 bg-white/[0.045] text-slate-300 hover:bg-white/10"
              }`}
            >
              {filter.label}
            </button>
          ))}
        </section>

        {loading && !followups.length ? <EmptyState text="Loading follow-ups..." /> : null}
        {!loading && !filtered.length ? <EmptyState text="No follow-ups need action right now." /> : null}

        <section className="space-y-3">
          {visibleFollowups.map((row) => {
            const busy = busyId && busyId.endsWith(`:${row.id}`);
            return (
              <FollowupCard
                key={row.id}
                row={row}
                draft={drafts[row.id] || ""}
                forceClosed={forceClosed[row.id] === true}
                busy={busy}
                onDraftChange={(value) => setDrafts((current) => ({ ...current, [row.id]: value }))}
                onForceClosedChange={(value) => setForceClosed((current) => ({ ...current, [row.id]: value }))}
                onSendManual={sendManual}
                onSnooze={snooze}
                onCancel={cancel}
                onDone={done}
                onTakeover={takeover}
                onOpenInbox={openInbox}
              />
            );
          })}
        </section>

        {filtered.length > visibleCount ? (
          <div className="flex justify-center pb-4">
            <button
              type="button"
              onClick={() => setVisibleCount((current) => current + 24)}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.05] px-4 text-sm font-black text-slate-100 hover:bg-white/[0.08]"
            >
              Load more
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
