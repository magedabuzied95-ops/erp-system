import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PackageCheck, Loader2, RefreshCw, Plus, ShieldAlert, CheckCircle2, ExternalLink, Users } from "lucide-react";
import AiStudioNav from "../components/AiStudioNav";
import { useStudioHeaders } from "../lib/studioRequest";
import { getRestockRecovery, seedRestockRecoveryTemplate } from "../services/aiStudioApi";

const fmt = (v) => (v ? new Date(v).toLocaleString() : "—");
const statusTone = (s) =>
  s === "followup_created" ? "text-emerald-200"
  : s === "failed" ? "text-rose-200"
  : s?.startsWith?.("skipped") ? "text-amber-200"
  : "text-slate-300";
const statusLabel = (s) => ({ followup_created: "Follow-up created", skipped_duplicate: "Skipped (duplicate)", skipped_no_stock: "Skipped (no stock)", skipped_inactive: "Skipped (inactive)", failed: "Failed", candidate: "Candidate" }[s] || s);

export default function AiStudioRestockRecovery() {
  const { headers } = useStudioHeaders();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try { const r = await getRestockRecovery(headers); setData(r || null); } catch { setData(null); }
    setLoading(false);
  }, [headers]);
  useEffect(() => { void load(); }, [load]);

  const doSeed = async () => {
    setBusy("seed"); setMsg("");
    try { const r = await seedRestockRecoveryTemplate(headers); const wid = r?.workflow?.id; if (wid) navigate(`/ai-studio/workflows/${wid}/edit`); else await load(); }
    catch (e) { setMsg(e?.responseBody?.message || e?.message || "Failed"); }
    setBusy("");
  };

  const a = data?.automation || {};
  const wf = data?.workflow || null;
  const counts = data?.counts || {};
  const recoveries = data?.recoveries || [];

  // Why automation is (in)active — explicit, never misleading.
  const reasons = [];
  if (!a.global_enabled) reasons.push("Global automation is OFF.");
  if (!a.tenant_enabled) reasons.push("Tenant automation is OFF.");
  if (!wf) reasons.push("No Restock Recovery workflow configured.");
  else { if (!wf.enabled) reasons.push("The Restock Recovery workflow is disabled."); if (!wf.granted) reasons.push("restock.recover is not granted (automatic follow-ups blocked)."); }
  const fullyActive = a.global_enabled && a.tenant_enabled && wf?.enabled && wf?.granted;

  return (
    <div dir="ltr" className="space-y-4 p-4 text-white md:p-6">
      <section className="rounded-3xl border border-white/10 bg-white/[0.055] px-5 py-4 shadow-[0_18px_60px_rgba(0,0,0,0.16)] backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.18em] text-cyan-100"><PackageCheck className="h-4 w-4" />AI Studio</div>
            <h1 className="mt-1 text-xl font-black">Restock Recovery</h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-400">When a product comes back in stock, find customers who asked to be notified and create <b>internal</b> sales follow-ups. No customer message is ever sent automatically — employees do the outreach.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {!wf ? (
              <button type="button" onClick={doSeed} disabled={busy === "seed"} className="inline-flex h-9 items-center gap-2 rounded-full border border-cyan-300/40 bg-cyan-300/15 px-3 text-[11px] font-black text-cyan-50 hover:bg-cyan-300/25 disabled:opacity-50">
                {busy === "seed" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}Create from template
              </button>
            ) : (
              <button type="button" onClick={() => navigate(`/ai-studio/workflows/${wf.id}/edit`)} className="inline-flex h-9 items-center gap-2 rounded-full border border-white/10 bg-white/[0.055] px-3 text-[11px] font-black hover:border-white/20">Open workflow</button>
            )}
            <button type="button" onClick={() => void load()} className="inline-flex h-9 items-center gap-2 rounded-full border border-white/10 bg-white/[0.055] px-3 text-[11px] font-black hover:border-white/20"><RefreshCw className="h-3.5 w-3.5" />Refresh</button>
          </div>
        </div>
        <div className="mt-3"><AiStudioNav /></div>
      </section>

      {msg ? <div className="rounded-xl border border-rose-300/20 bg-rose-500/10 px-3 py-2 text-[12px] font-bold text-rose-100">{msg}</div> : null}

      {/* Automation status — never misleading */}
      <section className={`rounded-2xl border px-4 py-3 ${fullyActive ? "border-emerald-300/30 bg-emerald-400/[0.06]" : "border-amber-300/30 bg-amber-300/[0.06]"}`}>
        <div className="flex items-center gap-2 text-[12px] font-black uppercase tracking-wide">
          {fullyActive ? <CheckCircle2 className="h-4 w-4 text-emerald-200" /> : <ShieldAlert className="h-4 w-4 text-amber-200" />}
          <span className={fullyActive ? "text-emerald-100" : "text-amber-100"}>Automatic recovery: {fullyActive ? "Active" : "Inactive"}</span>
        </div>
        {!fullyActive ? <ul className="mt-1.5 list-disc pl-6 text-[12px] text-slate-300">{reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
          : <p className="mt-1 text-[12px] text-slate-300">Restock events will create internal recovery follow-ups for waiting customers.</p>}
        <p className="mt-1.5 text-[11px] text-slate-500">Recovery follow-ups are internal only — creating one does <b>not</b> mark the customer as notified.</p>
      </section>

      {/* Counts (real data) */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[["Total", counts.total, "text-slate-200"], ["Follow-ups created", counts.followups_created, "text-emerald-200"], ["Skipped (dupe)", counts.skipped_duplicate, "text-amber-200"], ["Skipped (no stock)", counts.skipped_no_stock, "text-amber-200"], ["Failed", counts.failed, "text-rose-200"]].map(([label, val, tone]) => (
          <div key={label} className="rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-3">
            <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">{label}</div>
            <div className={`mt-1 text-2xl font-black ${tone}`}>{Number(val || 0)}</div>
          </div>
        ))}
      </section>

      {/* Recovery table */}
      <section className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
        {loading ? (
          <div className="flex items-center gap-2 p-6 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" />Loading…</div>
        ) : recoveries.length === 0 ? (
          <div className="flex flex-col items-center gap-2 p-10 text-center text-sm text-slate-500"><Users className="h-6 w-6 opacity-60" />No recovery records yet. When a restocked product has waiting customers and the workflow is active, recovery follow-ups appear here.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">
                <tr className="border-b border-white/10">
                  <th className="px-4 py-3">Customer</th><th className="px-4 py-3">Product</th><th className="px-4 py-3">Priority</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Follow-up</th><th className="px-4 py-3">When</th><th className="px-4 py-3">Reason</th>
                </tr>
              </thead>
              <tbody>
                {recoveries.map((r) => (
                  <tr key={r.id} className="border-b border-white/5">
                    <td className="px-4 py-3"><div className="font-bold text-white">{r.customer_name || r.phone || "—"}</div><div className="text-[11px] text-slate-500">{r.customer_id ? `#${r.customer_id}` : "guest"}</div></td>
                    <td className="px-4 py-3 text-slate-300">{r.product_name || `Product #${r.product_id}`}</td>
                    <td className="px-4 py-3 text-slate-300">{r.priority}</td>
                    <td className="px-4 py-3"><span className={`font-black ${statusTone(r.status)}`}>{statusLabel(r.status)}</span></td>
                    <td className="px-4 py-3 text-slate-400">{r.followup_task_id ? `Task #${r.followup_task_id}` : "—"}</td>
                    <td className="px-4 py-3 text-[11px] text-slate-500">{fmt(r.created_at)}</td>
                    <td className="px-4 py-3 max-w-[240px] truncate text-[11px] text-slate-500" title={r.reason || ""}>{r.reason || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="text-[11px] text-slate-600">
        <button type="button" onClick={() => navigate("/ai-studio/executions")} className="inline-flex items-center gap-1 font-black text-cyan-200 hover:text-cyan-100">View workflow executions <ExternalLink className="h-3 w-3" /></button>
      </div>
    </div>
  );
}
