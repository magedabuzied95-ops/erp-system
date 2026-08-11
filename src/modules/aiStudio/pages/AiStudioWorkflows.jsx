import { useCallback, useEffect, useState } from "react";
import { Workflow, Play, Loader2, RefreshCw, Plus, CheckCircle2, XCircle } from "lucide-react";
import AiStudioNav from "../components/AiStudioNav";
import { useStudioHeaders } from "../lib/studioRequest";
import { listWorkflows, runWorkflow, setWorkflowEnabled, seedExampleWorkflow } from "../services/aiStudioApi";

const fmt = (v) => (v ? new Date(v).toLocaleString() : "—");

const statusTone = (s) =>
  s === "completed" ? "text-emerald-200" : s === "failed" || s === "rejected" ? "text-rose-200" : s === "awaiting_approval" ? "text-amber-200" : "text-slate-300";

export default function AiStudioWorkflows() {
  const { headers } = useStudioHeaders();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listWorkflows(headers);
      setRows(Array.isArray(res?.workflows) ? res.workflows : []);
    } catch { setRows([]); }
    setLoading(false);
  }, [headers]);

  useEffect(() => { void load(); }, [load]);

  const doRun = async (id) => {
    setBusy(`run-${id}`); setMsg("");
    try {
      const res = await runWorkflow(id, {}, headers);
      setMsg(`Run ${res?.run?.id || ""} → ${res?.result?.status || "started"}`);
      await load();
    } catch (e) { setMsg(e?.message || "Run failed"); }
    setBusy("");
  };
  const doToggle = async (id, enabled) => {
    setBusy(`t-${id}`);
    try { await setWorkflowEnabled(id, enabled, headers); await load(); } catch (e) { setMsg(e?.message || "Failed"); }
    setBusy("");
  };
  const doSeed = async () => {
    setBusy("seed"); setMsg("");
    try { await seedExampleWorkflow(headers); setMsg("Example workflow created (disabled)."); await load(); } catch (e) { setMsg(e?.message || "Failed"); }
    setBusy("");
  };

  return (
    <div dir="ltr" className="space-y-4 p-4 text-white md:p-6">
      <section className="rounded-3xl border border-white/10 bg-white/[0.055] px-5 py-4 shadow-[0_18px_60px_rgba(0,0,0,0.16)] backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.18em] text-cyan-100"><Workflow className="h-4 w-4" />AI Studio</div>
            <h1 className="mt-1 text-xl font-black">Workflows</h1>
            <p className="mt-1 text-sm text-slate-400">Manage executable workflows. This phase is management-only — the visual builder comes later.</p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={doSeed} disabled={busy === "seed"} className="inline-flex h-9 items-center gap-2 rounded-full border border-white/10 bg-white/[0.055] px-3 text-[11px] font-black hover:border-white/20 disabled:opacity-50">
              {busy === "seed" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}Create example
            </button>
            <button type="button" onClick={() => void load()} className="inline-flex h-9 items-center gap-2 rounded-full border border-white/10 bg-white/[0.055] px-3 text-[11px] font-black hover:border-white/20">
              <RefreshCw className="h-3.5 w-3.5" />Refresh
            </button>
          </div>
        </div>
        <div className="mt-3"><AiStudioNav /></div>
      </section>

      {msg ? <div className="rounded-xl border border-cyan-300/20 bg-cyan-300/10 px-3 py-2 text-[12px] font-bold text-cyan-100">{msg}</div> : null}

      <section className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
        {loading ? (
          <div className="flex items-center gap-2 p-6 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" />Loading…</div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">No workflows yet. Use “Create example” to add a safe read-only proof workflow.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">
                <tr className="border-b border-white/10">
                  <th className="px-4 py-3">Name</th><th className="px-4 py-3">Trigger</th><th className="px-4 py-3">Version</th><th className="px-4 py-3">Last run</th><th className="px-4 py-3">Enabled</th><th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((w) => (
                  <tr key={w.id} className="border-b border-white/5">
                    <td className="px-4 py-3"><div className="font-black text-white">{w.name}</div><div className="text-[11px] text-slate-500">{w.description}</div></td>
                    <td className="px-4 py-3 text-slate-300">{w.trigger_type}</td>
                    <td className="px-4 py-3 text-slate-300">v{w.version}</td>
                    <td className="px-4 py-3"><span className={`font-black ${statusTone(w.last_run_status)}`}>{w.last_run_status || "—"}</span><div className="text-[11px] text-slate-500">{fmt(w.last_run_at)}</div></td>
                    <td className="px-4 py-3">
                      <button type="button" onClick={() => doToggle(w.id, !w.enabled)} disabled={busy === `t-${w.id}`} className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-black ${w.enabled ? "border-emerald-300/30 bg-emerald-400/10 text-emerald-100" : "border-white/10 bg-white/[0.05] text-slate-300"}`}>
                        {w.enabled ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}{w.enabled ? "Enabled" : "Disabled"}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button type="button" onClick={() => doRun(w.id)} disabled={busy === `run-${w.id}`} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-cyan-300/30 bg-cyan-300/10 px-3 text-[11px] font-black text-cyan-100 hover:bg-cyan-300/20 disabled:opacity-50">
                        {busy === `run-${w.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}Run now
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
