import { useState } from "react";
import { X, Play, Loader2, ExternalLink, ShieldAlert, ChevronRight } from "lucide-react";
import { STATUS_TONE, fmtTime, fmtMs } from "./nodeKit";

// Compact run/execution panel launched from the builder. Reuses the server's redacted
// step data; it does NOT reconstruct secrets or duplicate the full Executions page.
export default function ExecutionDrawer({ open, run, steps = [], running, inputText, onInputChange, onRun, onClose, onViewFull, onFocusNode }) {
  const [expanded, setExpanded] = useState(null);
  if (!open) return null;
  const awaiting = run?.status === "awaiting_approval";

  return (
    <div className="flex h-full w-[340px] flex-col border-l border-white/10 bg-slate-950/70 backdrop-blur">
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-2.5">
        <div className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-300">Run / Test</div>
        <button type="button" onClick={onClose} className="inline-flex h-[var(--control-height-sm)] w-7 items-center justify-center rounded-[var(--radius-control)] border border-white/10 text-slate-400 hover:text-white"><X className="h-3.5 w-3.5" /></button>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        <div>
          <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Trigger input (JSON)</div>
          <textarea value={inputText} onChange={(e) => onInputChange(e.target.value)} rows={3} dir="ltr" spellCheck={false} placeholder='{ "query": "nike" }' className="mt-1 w-full rounded-[var(--radius-control)] border border-white/10 bg-slate-950/60 px-2.5 py-2 font-mono text-[11px] text-slate-200 focus:border-primary/40 focus:outline-none" />
          <button type="button" onClick={onRun} disabled={running} className="mt-2 inline-flex h-[var(--control-height-md)] w-full items-center justify-center gap-2 rounded-[var(--radius-control)] border border-primary/40 bg-primary/15 text-[12px] font-black text-primary hover:bg-primary/25 disabled:opacity-50">
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} {running ? "Running…" : "Run test"}
          </button>
          <p className="mt-1 text-[10px] text-slate-500">Runs on the server using real ERP data. Nothing executes in the browser.</p>
        </div>

        {run ? (
          <div className="rounded-[var(--radius-card)] border border-white/10 bg-white/[0.03] p-2.5 text-[11px]">
            <div className="flex items-center justify-between">
              <span className="text-slate-500">Run #{run.id}</span>
              <span className={`font-black uppercase ${STATUS_TONE(run.status)}`}>{run.status}</span>
            </div>
            <div className="mt-1 grid grid-cols-2 gap-1 text-slate-400">
              <div>Trigger: <span className="text-slate-200">{run.trigger}</span></div>
              <div>Started: <span className="text-slate-200">{fmtTime(run.started_at)}</span></div>
              <div>Steps: <span className="text-slate-200">{steps.length}</span></div>
              <div>Total: <span className="text-slate-200">{fmtMs(steps.reduce((a, s) => a + (s.duration_ms || 0), 0))}</span></div>
            </div>
            {run.error ? <div className="mt-1 rounded bg-rose-500/10 px-2 py-1 text-rose-200">{run.error}</div> : null}
            {awaiting ? (
              <div className="mt-2 flex items-center gap-1.5 rounded-lg border border-amber-300/40 bg-amber-300/10 px-2 py-1.5 text-[10px] font-bold text-amber-100">
                <ShieldAlert className="h-3.5 w-3.5" /> Waiting for human approval.
              </div>
            ) : null}
            <button type="button" onClick={onViewFull} className="mt-2 inline-flex items-center gap-1 text-[10px] font-black text-primary hover:text-primary">
              View full execution <ExternalLink className="h-3 w-3" />
            </button>
          </div>
        ) : null}

        {steps.length ? (
          <div>
            <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Steps</div>
            <div className="mt-1 space-y-1">
              {steps.map((s) => (
                <div key={s.seq} className="rounded-[var(--radius-card)] border border-white/10 bg-white/[0.02]">
                  <button type="button" onClick={() => { setExpanded(expanded === s.seq ? null : s.seq); onFocusNode?.(s.node_id); }} className="flex w-full items-center gap-2 px-2 py-1.5 text-left">
                    <ChevronRight className={`h-3 w-3 shrink-0 text-slate-500 transition ${expanded === s.seq ? "rotate-90" : ""}`} />
                    <span className="text-[10px] font-black text-slate-500">{s.seq}</span>
                    <span className="min-w-0 flex-1 truncate text-[11px] font-bold text-white">{s.node_id}<span className="ml-1 text-[9px] font-normal text-slate-500">{s.node_type}</span></span>
                    <span className={`text-[9px] font-black uppercase ${STATUS_TONE(s.status === "ok" ? "completed" : s.status)}`}>{s.status}</span>
                    {s.duration_ms != null ? <span className="text-[9px] text-slate-500">{fmtMs(s.duration_ms)}</span> : null}
                  </button>
                  {expanded === s.seq ? (
                    <div className="space-y-1 border-t border-white/10 p-2 text-[10px]">
                      {s.error ? <div className="rounded bg-rose-500/10 px-1.5 py-1 text-rose-200">{s.error}</div> : null}
                      <div className="text-slate-500">Input</div>
                      <pre dir="ltr" className="max-h-28 overflow-auto rounded bg-slate-950/60 p-1.5 font-mono text-[10px] text-slate-300">{JSON.stringify(s.input, null, 1)}</pre>
                      <div className="text-slate-500">Output</div>
                      <pre dir="ltr" className="max-h-28 overflow-auto rounded bg-slate-950/60 p-1.5 font-mono text-[10px] text-slate-300">{JSON.stringify(s.output, null, 1)}</pre>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
