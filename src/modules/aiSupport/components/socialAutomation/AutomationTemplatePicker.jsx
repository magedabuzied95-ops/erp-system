import { Sparkles } from "lucide-react";

export default function AutomationTemplatePicker({ templates = [], selectedTemplateId = "", onSelectTemplate }) {
  return (
    <section className="rounded-[22px] border border-white/10 bg-slate-950/70 p-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Automation Templates</div>
          <div className="mt-1 text-sm font-black text-white">Choose a workflow preset</div>
        </div>
        <span className="inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-400/10 px-2.5 py-1 text-[10px] font-black text-cyan-100">
          <Sparkles className="h-3.5 w-3.5" />
          Local draft
        </span>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {templates.map((template) => {
          const active = selectedTemplateId === template.id;
          return (
            <button
              key={template.id}
              type="button"
              onClick={() => onSelectTemplate?.(template.id)}
              className={`rounded-2xl border p-3 text-left transition ${
                active
                  ? "border-cyan-300/40 bg-cyan-300/10 ring-1 ring-cyan-300/15"
                  : "border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.05]"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-black text-white">{template.label}</div>
                  <div className="mt-1 text-xs leading-5 text-slate-400">{template.description}</div>
                </div>
                <span className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${active ? "border-cyan-300 bg-cyan-300 text-slate-950" : "border-white/10 bg-white/[0.04] text-slate-500"}`}>
                  {active ? "✓" : ""}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}

