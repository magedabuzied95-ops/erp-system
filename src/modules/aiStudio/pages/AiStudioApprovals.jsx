import { useCallback, useEffect, useState } from "react";
import { ShieldCheck, Loader2, RefreshCw, Check, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import AiStudioNav from "../components/AiStudioNav";
import { useStudioHeaders } from "../lib/studioRequest";
import { listApprovals, approveApproval, rejectApproval } from "../services/aiStudioApi";

import i18n from "../../../i18n/i18n";

/* Literal keys only: a lookup table keeps these verifiable by the
   missing-key guard, unlike a template-literal key built from a value. */
const STATUS_KEY = {
  completed: "aiStudio.pages.status.completed",
  failed: "aiStudio.pages.status.failed",
  running: "aiStudio.pages.status.running",
  awaiting_approval: "aiStudio.pages.status.awaiting_approval",
  rejected: "aiStudio.pages.status.rejected",
  pending: "aiStudio.pages.status.pending",
  approved: "aiStudio.pages.status.approved",
  ok: "aiStudio.pages.status.ok",
  skipped: "aiStudio.pages.status.skipped",
};
/** Display only; an unknown status still falls back to the raw value. */
const statusLabel = (s) => (s ? (STATUS_KEY[s] ? i18n.t(STATUS_KEY[s], { defaultValue: s }) : s) : "—");

const fmt = (v) => (v ? new Date(v).toLocaleString() : "—");
const riskTone = (r) => (r === "SENSITIVE" ? "border-rose-300/30 bg-rose-400/10 text-rose-100" : r === "WRITE" ? "border-amber-300/30 bg-amber-400/10 text-amber-100" : "border-white/10 bg-white/[0.05] text-slate-300");

export default function AiStudioApprovals() {
  const { t } = useTranslation();
  const { headers } = useStudioHeaders();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [statusFilter, setStatusFilter] = useState("pending");

  const load = useCallback(async () => {
    setLoading(true);
    try { const res = await listApprovals(headers, statusFilter); setRows(Array.isArray(res?.approvals) ? res.approvals : []); } catch { setRows([]); }
    setLoading(false);
  }, [headers, statusFilter]);

  useEffect(() => { void load(); }, [load]);

  const decide = async (id, action) => {
    if (!window.confirm(action === "approve" ? t("aiStudio.pages.approvals.confirmApprove") : t("aiStudio.pages.approvals.confirmReject"))) return;
    setBusy(`${action}-${id}`); setMsg("");
    try {
      const res = action === "approve" ? await approveApproval(id, headers) : await rejectApproval(id, headers);
      setMsg(t(action === "approve" ? "aiStudio.pages.approvals.resultApprove" : "aiStudio.pages.approvals.resultReject", { result: statusLabel(res?.result?.status || res?.status) || t("aiStudio.pages.approvals.done") }));
      await load();
    } catch (e) { setMsg(e?.message || (action === "approve" ? t("aiStudio.pages.approvals.failedApprove") : t("aiStudio.pages.approvals.failedReject"))); }
    setBusy("");
  };

  return (
    <div dir="ltr" className="space-y-4 p-4 text-white md:p-6">
      <section className="rounded-[var(--radius-card)] border border-white/10 bg-white/[0.055] px-5 py-4 shadow-[0_18px_60px_rgba(0,0,0,0.16)] backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.18em] text-primary"><ShieldCheck className="h-4 w-4" />{t("aiStudio.pages.eyebrow")}</div>
            <h1 className="m1-page-title mt-1">{t("aiStudio.pages.approvals.title")}</h1>
            <p className="mt-1 text-sm text-slate-400">{t("aiStudio.pages.approvals.subtitle")}</p>
          </div>
          <div className="flex items-center gap-2">
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="h-[var(--control-height-md)] rounded-full border border-white/10 bg-slate-950/70 px-3 text-[12px] font-black text-white outline-none">
              <option value="pending">{t("aiStudio.pages.approvals.filters.pending")}</option><option value="approved">{t("aiStudio.pages.approvals.filters.approved")}</option><option value="rejected">{t("aiStudio.pages.approvals.filters.rejected")}</option><option value="all">{t("aiStudio.pages.approvals.filters.all")}</option>
            </select>
            <button type="button" onClick={() => void load()} className="inline-flex h-[var(--control-height-md)] items-center gap-2 rounded-full border border-white/10 bg-white/[0.055] px-3 text-[11px] font-black hover:border-white/20"><RefreshCw className="h-3.5 w-3.5" />{t("aiStudio.pages.refresh")}</button>
          </div>
        </div>
        <div className="mt-3"><AiStudioNav /></div>
      </section>

      {msg ? <div className="rounded-xl border border-primary/20 bg-primary/10 px-3 py-2 text-[12px] font-bold text-primary">{msg}</div> : null}

      <section className="space-y-3">
        {loading ? (
          <div className="flex items-center gap-2 rounded-[var(--radius-card)] border border-white/10 bg-white/[0.03] p-6 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" />{t("aiStudio.pages.loading")}</div>
        ) : rows.length === 0 ? (
          <div className="rounded-[var(--radius-card)] border border-white/10 bg-white/[0.03] p-8 text-center text-sm text-slate-500">{statusFilter === "all" ? t("aiStudio.pages.approvals.emptyAll") : t("aiStudio.pages.approvals.emptyFiltered", { status: statusLabel(statusFilter) })}</div>
        ) : (
          rows.map((a) => (
            <div key={a.id} className="rounded-[var(--radius-card)] border border-white/10 bg-white/[0.045] p-4 shadow-[0_10px_30px_rgba(0,0,0,0.15)]">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-black text-white">{a.requested_action}</span>
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black ${riskTone(a.risk_level)}`}>{a.risk_level || "—"}</span>
                    <span className="rounded-full border border-white/10 bg-white/[0.05] px-2 py-0.5 text-[10px] font-black text-slate-300">{statusLabel(a.status)}</span>
                  </div>
                  <div className="mt-1 text-[12px] text-slate-400">{a.workflow_name || t("aiStudio.pages.approvals.workflowNumber", { id: a.workflow_id })} · {t("aiStudio.pages.approvals.meta", { run: a.run_id, node: a.node_id })}{a.tool_id ? ` · ${a.tool_id}` : ""}</div>
                  <div className="mt-0.5 text-[11px] text-slate-500">{t("aiStudio.pages.approvals.requested", { at: fmt(a.requested_at || a.created_at) })}{a.decided_at ? ` · ${t("aiStudio.pages.approvals.decided", { at: fmt(a.decided_at) })}` : ""}</div>
                  {a.request_context?.input ? <pre className="mt-2 max-h-32 overflow-auto rounded-lg bg-black/30 p-2 text-[11px] text-slate-300">{JSON.stringify(a.request_context.input, null, 1)}</pre> : null}
                </div>
                {a.status === "pending" ? (
                  <div className="flex shrink-0 gap-2">
                    <button type="button" onClick={() => decide(a.id, "approve")} disabled={busy === `approve-${a.id}`} className="inline-flex h-[var(--control-height-md)] items-center gap-1.5 rounded-[var(--radius-control)] border border-emerald-300/30 bg-emerald-400/10 px-3 text-[12px] font-black text-emerald-100 hover:bg-emerald-400/20 disabled:opacity-50">
                      {busy === `approve-${a.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}{t("aiStudio.pages.approvals.approve")}
                    </button>
                    <button type="button" onClick={() => decide(a.id, "reject")} disabled={busy === `reject-${a.id}`} className="inline-flex h-[var(--control-height-md)] items-center gap-1.5 rounded-[var(--radius-control)] border border-rose-300/30 bg-rose-400/10 px-3 text-[12px] font-black text-rose-100 hover:bg-rose-400/20 disabled:opacity-50">
                      {busy === `reject-${a.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}{t("aiStudio.pages.approvals.reject")}
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
