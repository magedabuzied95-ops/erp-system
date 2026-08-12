import { useCallback, useEffect, useState } from "react";
import { Wrench, Loader2, RefreshCw, ShieldAlert, ShieldCheck, Eye } from "lucide-react";
import AiStudioNav from "../components/AiStudioNav";
import { useStudioHeaders } from "../lib/studioRequest";
import { listTools } from "../services/aiStudioApi";

const GROUPS = [
  { key: "READ", label: "Read", icon: Eye, tone: "border-emerald-300/25 text-emerald-100", note: "Safe reads — may run automatically." },
  { key: "WRITE", label: "Write", icon: ShieldCheck, tone: "border-amber-300/25 text-amber-100", note: "Non-destructive writes — require approval." },
  { key: "SENSITIVE", label: "Sensitive", icon: ShieldAlert, tone: "border-rose-300/25 text-rose-100", note: "Destructive / customer-facing / financial — always require human approval." },
];

export default function AiStudioTools() {
  const { headers } = useStudioHeaders();
  const [grouped, setGrouped] = useState({ READ: [], WRITE: [], SENSITIVE: [] });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try { const res = await listTools(headers); setGrouped(res?.grouped || { READ: [], WRITE: [], SENSITIVE: [] }); } catch { setGrouped({ READ: [], WRITE: [], SENSITIVE: [] }); }
    setLoading(false);
  }, [headers]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div dir="ltr" className="space-y-4 p-4 text-white md:p-6">
      <section className="rounded-3xl border border-white/10 bg-white/[0.055] px-5 py-4 shadow-[0_18px_60px_rgba(0,0,0,0.16)] backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.18em] text-primary"><Wrench className="h-4 w-4" />AI Studio</div>
            <h1 className="m1-page-title mt-1">Tools</h1>
            <p className="mt-1 text-sm text-slate-400">Read-only view of the server-side tool registry. The server registry is authoritative — tools cannot be pointed at arbitrary code from the browser.</p>
          </div>
          <button type="button" onClick={() => void load()} className="inline-flex h-[var(--control-height-md)] items-center gap-2 rounded-full border border-white/10 bg-white/[0.055] px-3 text-[11px] font-black hover:border-white/20"><RefreshCw className="h-3.5 w-3.5" />Refresh</button>
        </div>
        <div className="mt-3"><AiStudioNav /></div>
      </section>

      {loading ? (
        <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" />Loading…</div>
      ) : (
        GROUPS.map(({ key, label, icon: Icon, tone, note }) => (
          <section key={key}>
            <div className="mb-2 flex items-center gap-2 px-1">
              <Icon className={`h-4 w-4 ${tone.split(" ").find((c) => c.startsWith("text-"))}`} />
              <h2 className="m1-section-title text-[12px] uppercase tracking-[0.16em] text-slate-300">{label}</h2>
              <span className="text-[11px] font-medium text-slate-500">{note}</span>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {(grouped[key] || []).map((t) => (
                <div key={t.id} className={`rounded-2xl border bg-white/[0.045] p-4 shadow-[0_10px_30px_rgba(0,0,0,0.15)] ${tone.split(" ").find((c) => c.startsWith("border-"))}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-black text-white">{t.name}</span>
                    <span className="rounded-full border border-white/10 bg-white/[0.05] px-2 py-0.5 text-[10px] font-black text-slate-300">{t.riskLevel}</span>
                  </div>
                  <div className="mt-1 text-[12px] font-medium leading-5 text-slate-400">{t.description}</div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] font-black uppercase tracking-[0.1em]">
                    <span className="rounded-full border border-white/10 bg-slate-950/50 px-2 py-0.5 text-slate-400">perm: {t.requiredPermission}</span>
                    <span className={`rounded-full border px-2 py-0.5 ${t.hasHandler && t.executable !== false ? "border-emerald-300/25 text-emerald-100" : "border-white/10 text-slate-500"}`}>{t.hasHandler && t.executable !== false ? "executable" : "described only"}</span>
                    <span className={`rounded-full border px-2 py-0.5 ${t.requiresApproval || t.riskLevel === "SENSITIVE" ? "border-amber-300/25 text-amber-100" : "border-white/10 text-slate-500"}`}>{t.requiresApproval || t.riskLevel === "SENSITIVE" ? "approval required" : "auto"}</span>
                  </div>
                </div>
              ))}
              {(grouped[key] || []).length === 0 ? <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-[12px] text-slate-500">None.</div> : null}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
