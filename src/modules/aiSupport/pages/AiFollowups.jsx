import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Loader2,
  PauseCircle,
  RefreshCw,
  Send,
  ShieldAlert,
  UserCheck,
  XCircle,
} from "lucide-react";

import { api } from "../../../shared/api/api";
import { getCurrentTenant, getCurrentUser } from "../../../shared/auth/authStorage";
import { useTenant } from "../../saas/context/TenantContext";

const asArray = (value) => (Array.isArray(value) ? value : []);

const tenantIdFrom = (tenantApi) => {
  const currentTenant = tenantApi?.currentTenant || getCurrentTenant?.() || {};
  const currentUser = getCurrentUser?.() || {};
  return String(currentTenant.id || currentTenant.tenant_id || currentUser.tenant_id || currentUser.tenantId || "1");
};

const dateTime = (value) => {
  if (!value) return "-";
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return "-";
  return parsed.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
};

const statusTone = {
  due: "border-amber-300/20 bg-amber-400/10 text-amber-100",
  scheduled: "border-cyan-300/20 bg-cyan-400/10 text-cyan-100",
  completed: "border-emerald-300/20 bg-emerald-400/10 text-emerald-100",
  stopped: "border-rose-300/20 bg-rose-400/10 text-rose-100",
};

const tabs = [
  { key: "due", label: "Due" },
  { key: "scheduled", label: "Scheduled" },
  { key: "completed", label: "Completed" },
  { key: "stopped", label: "Stopped" },
  { key: "all", label: "All" },
];

function EmptyState({ text = "No follow-ups found." }) {
  return <div className="rounded-2xl border border-dashed border-white/10 p-8 text-center text-sm text-slate-500">{text}</div>;
}

function Kpi({ icon: Icon, label, value, tone = "text-cyan-200" }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-4">
      <Icon className={`h-5 w-5 ${tone}`} />
      <div className="mt-3 text-2xl font-black text-white">{value}</div>
      <div className="mt-1 text-sm text-slate-400">{label}</div>
    </div>
  );
}

export default function AiFollowups() {
  const navigate = useNavigate();
  const tenantApi = useTenant();
  const tenantId = useMemo(() => tenantIdFrom(tenantApi), [tenantApi]);
  const headers = useMemo(() => ({ "x-tenant-id": tenantId }), [tenantId]);
  const [activeTab, setActiveTab] = useState("due");
  const [followups, setFollowups] = useState([]);
  const [counts, setCounts] = useState({});
  const [drafts, setDrafts] = useState({});
  const [forceClosed, setForceClosed] = useState({});
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadFollowups = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const payload = await api.get("/ai-agent/followups", {
        params: { tenant_id: tenantId, status: activeTab, limit: 120 },
        headers,
      });
      const rows = asArray(payload.followups);
      setFollowups(rows);
      setCounts(payload.counts || {});
      setDrafts((current) => {
        const next = { ...current };
        rows.forEach((row) => {
          if (!next[row.id]) next[row.id] = row.suggested_message || "";
        });
        return next;
      });
    } catch (err) {
      setError(err?.message || "Failed to load AI follow-ups");
    } finally {
      setLoading(false);
    }
  }, [activeTab, headers, tenantId]);

  useEffect(() => {
    Promise.resolve().then(loadFollowups);
  }, [loadFollowups]);

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

  return (
    <div dir="ltr" className="min-h-full bg-[linear-gradient(180deg,#020617,#0f172a)] p-3 text-white md:p-6">
      <div className="mx-auto flex max-w-[96rem] flex-col gap-5">
        <section className="rounded-2xl border border-white/10 bg-white/[0.055] p-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 text-sm font-black uppercase tracking-[0.16em] text-cyan-100">
                <Clock3 className="h-4 w-4" />
                AI Follow-up Execution Center
              </div>
              <h1 className="mt-3 text-3xl font-black md:text-4xl">Follow-ups ready for staff action</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
                Send internal follow-up notes, snooze cooling conversations, cancel rejected leads, and jump back to the AI inbox without pretending an external WhatsApp or social message was sent.
              </p>
            </div>
            <button type="button" onClick={loadFollowups} disabled={loading} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-cyan-300 px-4 text-sm font-black text-slate-950 disabled:opacity-50">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Refresh
            </button>
          </div>
          {error ? <div className="mt-4 flex items-center gap-2 rounded-xl border border-rose-300/20 bg-rose-400/10 p-3 text-sm font-bold text-rose-100"><AlertTriangle className="h-4 w-4" />{error}</div> : null}
          {notice ? <div className="mt-4 flex items-center gap-2 rounded-xl border border-emerald-300/20 bg-emerald-400/10 p-3 text-sm font-bold text-emerald-100"><CheckCircle2 className="h-4 w-4" />{notice}</div> : null}
        </section>

        <section className="grid gap-3 md:grid-cols-4">
          <Kpi icon={ShieldAlert} label="Due follow-ups" value={counts.due || 0} tone="text-amber-200" />
          <Kpi icon={Clock3} label="Scheduled" value={counts.scheduled || 0} />
          <Kpi icon={CheckCircle2} label="Completed" value={counts.completed || 0} tone="text-emerald-200" />
          <Kpi icon={XCircle} label="Stopped / rejected" value={counts.stopped || 0} tone="text-rose-200" />
        </section>

        <section className="flex flex-wrap gap-2">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`h-10 rounded-xl px-4 text-sm font-black ${activeTab === tab.key ? "bg-white text-slate-950" : "border border-white/10 bg-white/[0.045] text-slate-300 hover:bg-white/10"}`}
            >
              {tab.label}
            </button>
          ))}
        </section>

        {loading && !followups.length ? <EmptyState text="Loading follow-ups..." /> : null}
        {!loading && !followups.length ? <EmptyState /> : null}

        <section className="space-y-3">
          {followups.map((row) => {
            const closed = row.conversation?.status === "closed";
            const sendDisabled = ["completed", "stopped"].includes(row.bucket) && row.status !== "manual_ready";
            return (
              <article key={row.id} className="rounded-2xl border border-white/10 bg-white/[0.045] p-4">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-black ${statusTone[row.bucket] || statusTone.scheduled}`}>
                        {row.bucket === "due" ? "Due now" : row.bucket}
                      </span>
                      <span className="inline-flex rounded-full border border-white/10 bg-slate-950/50 px-3 py-1 text-xs font-black text-slate-300">{row.source_channel || "web_chat"}</span>
                      {closed ? <span className="inline-flex items-center gap-1 rounded-full border border-rose-300/20 bg-rose-400/10 px-3 py-1 text-xs font-black text-rose-100"><PauseCircle className="h-3.5 w-3.5" />Closed</span> : null}
                      {row.status === "sent_internal" ? <span className="inline-flex rounded-full border border-emerald-300/20 bg-emerald-400/10 px-3 py-1 text-xs font-black text-emerald-100">Internal note sent</span> : <span className="inline-flex rounded-full border border-amber-300/20 bg-amber-400/10 px-3 py-1 text-xs font-black text-amber-100">Ready to send manually</span>}
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-400">
                      <span className="font-black text-white">{row.customer?.name || "Customer"}</span>
                      {row.customer?.phone ? <span>{row.customer.phone}</span> : null}
                      <span>Trigger: {row.trigger_type || "-"}</span>
                      <span>Due: {dateTime(row.scheduled_at)}</span>
                      <span>Cooldown: {row.cooldown_until ? dateTime(row.cooldown_until) : "clear"}</span>
                    </div>
                    <div className="mt-3 rounded-xl border border-white/10 bg-slate-950/50 p-3 text-sm leading-6 text-slate-200" dir="auto">
                      {row.suggested_message || "No suggested message stored for this follow-up."}
                    </div>
                    <textarea
                      value={drafts[row.id] || ""}
                      onChange={(event) => setDrafts((current) => ({ ...current, [row.id]: event.target.value }))}
                      rows={3}
                      className="mt-3 w-full resize-none rounded-xl border border-white/10 bg-slate-950/70 p-3 text-sm leading-6 text-white outline-none focus:border-cyan-300/40"
                      placeholder="Edit the internal follow-up note before sending..."
                      dir="auto"
                    />
                    {closed ? (
                      <label className="mt-3 inline-flex items-center gap-2 text-xs font-bold text-rose-100">
                        <input
                          type="checkbox"
                          checked={forceClosed[row.id] === true}
                          onChange={(event) => setForceClosed((current) => ({ ...current, [row.id]: event.target.checked }))}
                          className="h-4 w-4 rounded border-white/20 bg-slate-950"
                        />
                        Force internal note for closed conversation
                      </label>
                    ) : null}
                  </div>

                  <div className="grid shrink-0 gap-2 sm:grid-cols-2 xl:w-80">
                    <button type="button" disabled={sendDisabled || busyId === `Internal note sent:${row.id}`} onClick={() => sendManual(row)} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-cyan-300 px-3 text-sm font-black text-slate-950 disabled:opacity-45">
                      {busyId === `Internal note sent:${row.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                      Send manually
                    </button>
                    <button type="button" onClick={() => done(row)} disabled={busyId === `Follow-up marked done:${row.id}`} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.06] px-3 text-sm font-black text-slate-100 disabled:opacity-45">
                      <CheckCircle2 className="h-4 w-4" />
                      Mark done
                    </button>
                    <button type="button" onClick={() => snooze(row, 60)} disabled={busyId === `Follow-up snoozed:${row.id}`} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.06] px-3 text-sm font-black text-slate-100 disabled:opacity-45">
                      <Clock3 className="h-4 w-4" />
                      Snooze 1h
                    </button>
                    <button type="button" onClick={() => snooze(row, 1440)} disabled={busyId === `Follow-up snoozed:${row.id}`} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.06] px-3 text-sm font-black text-slate-100 disabled:opacity-45">
                      <Clock3 className="h-4 w-4" />
                      Snooze 1d
                    </button>
                    <button type="button" onClick={() => cancel(row)} disabled={busyId === `Follow-up cancelled:${row.id}`} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-rose-300/20 bg-rose-400/10 px-3 text-sm font-black text-rose-100 disabled:opacity-45">
                      <XCircle className="h-4 w-4" />
                      Cancel
                    </button>
                    <button type="button" onClick={() => takeover(row)} disabled={closed || busyId === `Conversation taken over:${row.id}`} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-amber-300/20 bg-amber-400/10 px-3 text-sm font-black text-amber-100 disabled:opacity-45">
                      <UserCheck className="h-4 w-4" />
                      Take over
                    </button>
                    <button type="button" onClick={() => navigate(`/admin/ai-inbox?conversation=${encodeURIComponent(row.session_id)}`)} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.06] px-3 text-sm font-black text-slate-100 sm:col-span-2">
                      <ExternalLink className="h-4 w-4" />
                      Open conversation
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </section>
      </div>
    </div>
  );
}
