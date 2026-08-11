import { useCallback, useEffect, useState } from "react";
import { ShieldCheck, Loader2, RefreshCw, Check, X } from "lucide-react";
import AiStudioNav from "../components/AiStudioNav";
import { useStudioHeaders } from "../lib/studioRequest";
import { listApprovals, approveApproval, rejectApproval } from "../services/aiStudioApi";

const fmt = (v) => (v ? new Date(v).toLocaleString() : "—");
const riskTone = (r) => (r === "SENSITIVE" ? "border-rose-300/30 bg-rose-400/10 text-rose-100" : r === "WRITE" ? "border-amber-300/30 bg-amber-400/10 text-amber-100" : "border-white/10 bg-white/[0.05] text-slate-300");

export default function AiStudioApprovals() {
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

  const decide = async (id, action, actionLabel) => {
    if (!window.confirm(`${actionLabel} this AI action? It will ${action === "approve" ? "execute after an RBAC re-check" : "be cancelled"}.`)) return;
    setBusy(`${action}-${id}`); setMsg("");
    try {
      const res = action === "approve" ? await approveApproval(id, headers) : await rejectApproval(id, headers);
      setMsg(`${actionLabel} → ${res?.result?.status || res?.status || "done"}`);
      await load();
    } catch (e) { setMsg(e?.message || `${actionLabel} failed`); }
    setBusy("");
  };

  return (
    <div dir="ltr" className="space-y-4 p-4 text-white md:p-6">
      <section className="rounded-3xl border border-white/10 bg-white/[0.055] px-5 py-4 shadow-[0_18px_60px_rgba(0,0,0,0.16)] backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.18em] text-cyan-100"><ShieldCheck className="h-4 w-4" />AI Studio</div>
            <h1 className="mt-1 text-xl font-black">Approvals</h1>
            <p className="mt-1 text-sm text-slate-400">Human approval for sensitive AI actions. Approval never bypasses RBAC — permissions are re-checked before execution.</p>
          </div>
          <div className="flex items-center gap-2">
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="h-9 rounded-full border border-white/10 bg-slate-950/70 px-3 text-[12px] font-black text-white outline-none">
              <option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="all">All</option>
            </select>
            <button type="button" onClick={() => void load()} className="inline-flex h-9 items-center gap-2 rounded-full border border-white/10 bg-white/[0.055] px-3 text-[11px] font-black hover:border-white/20"><RefreshCw className="h-3.5 w-3.5" />Refresh</button>
          </div>
        </div>
        <div className="mt-3"><AiStudioNav /></div>
      </section>

      {msg ? <div className="rounded-xl border border-cyan-300/20 bg-cyan-300/10 px-3 py-2 text-[12px] font-bold text-cyan-100">{msg}</div> : null}

      <section className="space-y-3">
        {loading ? (
          <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" />Loading…</div>
        ) : rows.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center text-sm text-slate-500">No {statusFilter === "all" ? "" : statusFilter} approvals.</div>
        ) : (
          rows.map((a) => (
            <div key={a.id} className="rounded-2xl border border-white/10 bg-white/[0.045] p-4 shadow-[0_10px_30px_rgba(0,0,0,0.15)]">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-black text-white">{a.requested_action}</span>
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black ${riskTone(a.risk_level)}`}>{a.risk_level || "—"}</span>
                    <span className="rounded-full border border-white/10 bg-white/[0.05] px-2 py-0.5 text-[10px] font-black text-slate-300">{a.status}</span>
                  </div>
                  <div className="mt-1 text-[12px] text-slate-400">{a.workflow_name || `Workflow #${a.workflow_id}`} · run #{a.run_id} · node {a.node_id}{a.tool_id ? ` · ${a.tool_id}` : ""}</div>
                  <div className="mt-0.5 text-[11px] text-slate-500">Requested {fmt(a.requested_at || a.created_at)}{a.decided_at ? ` · decided ${fmt(a.decided_at)}` : ""}</div>
                  {a.request_context?.input ? <pre className="mt-2 max-h-32 overflow-auto rounded-lg bg-black/30 p-2 text-[11px] text-slate-300">{JSON.stringify(a.request_context.input, null, 1)}</pre> : null}
                </div>
                {a.status === "pending" ? (
                  <div className="flex shrink-0 gap-2">
                    <button type="button" onClick={() => decide(a.id, "approve", "Approve")} disabled={busy === `approve-${a.id}`} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-emerald-300/30 bg-emerald-400/10 px-3 text-[12px] font-black text-emerald-100 hover:bg-emerald-400/20 disabled:opacity-50">
                      {busy === `approve-${a.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Approve
                    </button>
                    <button type="button" onClick={() => decide(a.id, "reject", "Reject")} disabled={busy === `reject-${a.id}`} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-rose-300/30 bg-rose-400/10 px-3 text-[12px] font-black text-rose-100 hover:bg-rose-400/20 disabled:opacity-50">
                      {busy === `reject-${a.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}Reject
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
