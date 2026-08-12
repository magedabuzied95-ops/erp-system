import { useCallback, useEffect, useState } from "react";
import { Wrench, Loader2, RefreshCw, ShieldAlert, ShieldCheck, Eye } from "lucide-react";
import { useTranslation } from "react-i18next";
import AiStudioNav from "../components/AiStudioNav";
import { useStudioHeaders } from "../lib/studioRequest";
import { listTools } from "../services/aiStudioApi";

/* `key` is the RAW risk enum used to index grouped[]; labelKey/noteKey are display. */
const GROUPS = [
  { key: "READ", labelKey: "aiStudio.pages.tools.groups.READ", icon: Eye, tone: "border-emerald-300/25 text-emerald-100", noteKey: "aiStudio.pages.tools.notes.READ" },
  { key: "WRITE", labelKey: "aiStudio.pages.tools.groups.WRITE", icon: ShieldCheck, tone: "border-amber-300/25 text-amber-100", noteKey: "aiStudio.pages.tools.notes.WRITE" },
  { key: "SENSITIVE", labelKey: "aiStudio.pages.tools.groups.SENSITIVE", icon: ShieldAlert, tone: "border-rose-300/25 text-rose-100", noteKey: "aiStudio.pages.tools.notes.SENSITIVE" },
];

export default function AiStudioTools() {
  const { t } = useTranslation();
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
      <section className="rounded-[var(--radius-card)] border border-white/10 bg-white/[0.055] px-5 py-4 shadow-[0_18px_60px_rgba(0,0,0,0.16)] backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.18em] text-primary"><Wrench className="h-4 w-4" />{t("aiStudio.pages.eyebrow")}</div>
            <h1 className="m1-page-title mt-1">{t("aiStudio.pages.tools.title")}</h1>
            <p className="mt-1 text-sm text-slate-400">{t("aiStudio.pages.tools.subtitle")}</p>
          </div>
          <button type="button" onClick={() => void load()} className="inline-flex h-[var(--control-height-md)] items-center gap-2 rounded-full border border-white/10 bg-white/[0.055] px-3 text-[11px] font-black hover:border-white/20"><RefreshCw className="h-3.5 w-3.5" />{t("aiStudio.pages.refresh")}</button>
        </div>
        <div className="mt-3"><AiStudioNav /></div>
      </section>

      {loading ? (
        <div className="flex items-center gap-2 rounded-[var(--radius-card)] border border-white/10 bg-white/[0.03] p-6 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" />{t("aiStudio.pages.loading")}</div>
      ) : (
        GROUPS.map(({ key, labelKey, icon: Icon, tone, noteKey }) => (
          <section key={key}>
            <div className="mb-2 flex items-center gap-2 px-1">
              <Icon className={`h-4 w-4 ${tone.split(" ").find((c) => c.startsWith("text-"))}`} />
              <h2 className="m1-section-title text-[12px] uppercase tracking-[0.16em] text-slate-300">{t(labelKey)}</h2>
              <span className="text-[11px] font-medium text-slate-500">{t(noteKey)}</span>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {(grouped[key] || []).map((tool) => (
                <div key={tool.id} className={`rounded-[var(--radius-card)] border bg-white/[0.045] p-4 shadow-[0_10px_30px_rgba(0,0,0,0.15)] ${tone.split(" ").find((c) => c.startsWith("border-"))}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-black text-white">{tool.name}</span>
                    <span className="rounded-full border border-white/10 bg-white/[0.05] px-2 py-0.5 text-[10px] font-black text-slate-300">{tool.riskLevel}</span>
                  </div>
                  <div className="mt-1 text-[12px] font-medium leading-5 text-slate-400">{tool.description}</div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] font-black uppercase tracking-[0.1em]">
                    <span className="rounded-full border border-white/10 bg-slate-950/50 px-2 py-0.5 text-slate-400">{t("aiStudio.pages.tools.permission", { value: tool.requiredPermission })}</span>
                    <span className={`rounded-full border px-2 py-0.5 ${tool.hasHandler && tool.executable !== false ? "border-emerald-300/25 text-emerald-100" : "border-white/10 text-slate-500"}`}>{tool.hasHandler && tool.executable !== false ? t("aiStudio.pages.tools.executable") : t("aiStudio.pages.tools.describedOnly")}</span>
                    <span className={`rounded-full border px-2 py-0.5 ${tool.requiresApproval || tool.riskLevel === "SENSITIVE" ? "border-amber-300/25 text-amber-100" : "border-white/10 text-slate-500"}`}>{tool.requiresApproval || tool.riskLevel === "SENSITIVE" ? t("aiStudio.pages.tools.approvalRequired") : t("aiStudio.pages.tools.auto")}</span>
                  </div>
                </div>
              ))}
              {(grouped[key] || []).length === 0 ? <div className="rounded-[var(--radius-card)] border border-white/10 bg-white/[0.03] p-4 text-[12px] text-slate-500">{t("aiStudio.pages.tools.none")}</div> : null}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
