export default function AutomationSettingsPanel({ settings = {}, onChange }) {
  const toggles = [
    { key: "enabled", label: "Enable automation", note: "Master switch for this post." },
    { key: "likeComment", label: "Like comment", note: "Signal engagement and trust." },
    { key: "publicReply", label: "Public reply", note: "Reply publicly on the post thread." },
    { key: "privateReply", label: "Private reply", note: "Send a private follow-up message." },
    { key: "aiFollowUp", label: "AI follow-up", note: "Open an AI conversation when needed." },
    { key: "createLead", label: "Create lead", note: "Create a CRM opportunity from the comment." },
  ];

  return (
    <section className="rounded-[22px] border border-white/10 bg-slate-950/70 p-3">
      <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Automation Settings</div>
      <div className="mt-1 text-sm font-black text-white">Rules and execution toggles</div>

      <div className="mt-3 grid gap-2">
        {toggles.map((toggle) => {
          const active = Boolean(settings?.[toggle.key]);
          return (
            <button
              key={toggle.key}
              type="button"
              onClick={() => onChange?.({ [toggle.key]: !active })}
              className={`rounded-2xl border p-3 text-left transition ${ active ? "border-emerald-300/30 bg-emerald-300/10" : "border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.05]" }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-black text-white">{toggle.label}</div>
                  <div className="mt-1 text-xs leading-5 text-slate-400">{toggle.note}</div>
                </div>
                <span className={`inline-flex h-5 w-10 items-center rounded-full p-0.5 transition ${active ? "bg-emerald-300" : "bg-white/10"}`}>
                  <span className={`h-4 w-4 rounded-full bg-white transition ${active ? "translate-x-5" : "translate-x-0"}`} />
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}

