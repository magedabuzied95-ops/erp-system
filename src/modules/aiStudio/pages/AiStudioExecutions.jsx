import { useCallback, useEffect, useState } from "react";
import { Activity, Loader2, RefreshCw } from "lucide-react";
import AiStudioNav from "../components/AiStudioNav";
import { useStudioHeaders } from "../lib/studioRequest";
import { listRuns, getRun } from "../services/aiStudioApi";

const fmt = (v) => (v ? new Date(v).toLocaleString() : "—");
const statusTone = (s) =>
  s === "completed" || s === "ok" ? "text-emerald-200" : s === "failed" || s === "rejected" ? "text-rose-200" : s === "awaiting_approval" ? "text-amber-200" : "text-slate-300";

export default function AiStudioExecutions() {
  const { headers } = useStudioHeaders();
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { const res = await listRuns(headers, { limit: 100 }); setRuns(Array.isArray(res?.runs) ? res.runs : []); } catch { setRuns([]); }
    setLoading(false);
  }, [headers]);

  useEffect(() => { void load(); }, [load]);

  const openRun = async (id) => {
    setSelected(id); setDetail(null);
    try { const res = await getRun(id, headers); setDetail(res || null); } catch { setDetail(null); }
  };

  return (
    <div dir="ltr" className="space-y-4 p-4 text-white md:p-6">
      <section className="rounded-3xl border border-white/10 bg-white/[0.055] px-5 py-4 shadow-[0_18px_60px_rgba(0,0,0,0.16)] backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.18em] text-cyan-100"><Activity className="h-4 w-4" />AI Studio</div>
            <h1 className="mt-1 text-xl font-black">Executions</h1>
            <p className="mt-1 text-sm text-slate-400">Real workflow runs and their steps. Secrets are redacted server-side.</p>
          </div>
          <button type="button" onClick={() => void load()} className="inline-flex h-9 items-center gap-2 rounded-full border border-white/10 bg-white/[0.055] px-3 text-[11px] font-black hover:border-white/20"><RefreshCw className="h-3.5 w-3.5" />Refresh</button>
        </div>
        <div className="mt-3"><AiStudioNav /></div>
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
          {loading ? (
            <div className="flex items-center gap-2 p-6 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" />Loading…</div>
          ) : runs.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">No runs yet. Run a workflow from the Workflows tab.</div>
          ) : (
            <div className="max-h-[70vh] overflow-y-auto">
              {runs.map((r) => (
                <button key={r.id} type="button" onClick={() => openRun(r.id)} className={`flex w-full items-center justify-between gap-3 border-b border-white/5 px-4 py-3 text-left hover:bg-white/[0.05] ${selected === r.id ? "bg-white/[0.06]" : ""}`}>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-black text-white">{r.workflow_name || `Workflow #${r.workflow_id}`}</span>
                    <span className="block text-[11px] text-slate-500">#{r.id} · {r.trigger} · {fmt(r.started_at || r.created_at)}</span>
                  </span>
                  <span className={`shrink-0 text-[11px] font-black ${statusTone(r.status)}`}>{r.status}{r.pending_node_id ? ` @${r.pending_node_id}` : ""}</span>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
          {!selected ? (
            <div className="p-8 text-center text-sm text-slate-500">Select a run to inspect its steps.</div>
          ) : !detail ? (
            <div className="flex items-center gap-2 p-6 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" />Loading run…</div>
          ) : (
            <div className="p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="text-sm font-black text-white">Run #{detail.run?.id} · <span className={statusTone(detail.run?.status)}>{detail.run?.status}</span></div>
                <div className="text-[11px] text-slate-500">{fmt(detail.run?.started_at)} → {fmt(detail.run?.finished_at)}</div>
              </div>
              {detail.run?.error ? <div className="mb-3 rounded-lg border border-rose-300/20 bg-rose-400/10 px-3 py-2 text-[12px] text-rose-100">{detail.run.error}</div> : null}
              <ol className="space-y-2">
                {(detail.steps || []).map((s) => (
                  <li key={s.id} className="rounded-xl border border-white/10 bg-slate-950/40 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[12px] font-black text-white">{s.seq}. {s.node_type}{s.tool_id ? ` · ${s.tool_id}` : ""}{s.risk_level ? ` · ${s.risk_level}` : ""}</span>
                      <span className={`text-[11px] font-black ${statusTone(s.status)}`}>{s.status}{typeof s.duration_ms === "number" ? ` · ${s.duration_ms}ms` : ""}</span>
                    </div>
                    {s.error ? <div className="mt-1 text-[11px] text-rose-200">{s.error}</div> : null}
                    {s.output && Object.keys(s.output).length ? <pre className="mt-2 max-h-40 overflow-auto rounded-lg bg-black/30 p-2 text-[11px] text-slate-300">{JSON.stringify(s.output, null, 1)}</pre> : null}
                  </li>
                ))}
              </ol>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
