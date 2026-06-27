export default function AutomationMessageTemplates({ values = {}, onChange }) {
  return (
    <section className="rounded-[22px] border border-white/10 bg-slate-950/70 p-3">
      <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Message Templates</div>
      <div className="mt-1 text-sm font-black text-white">Editable replies and AI opening prompt</div>

      <div className="mt-3 grid gap-3">
        <label className="grid gap-2">
          <span className="text-[11px] font-black uppercase tracking-[0.12em] text-slate-400">publicReplyTemplate</span>
          <textarea
            value={values.publicReplyTemplate || ""}
            onChange={(event) => onChange?.({ publicReplyTemplate: event.target.value })}
            rows={3}
            className="w-full rounded-2xl border border-white/10 bg-slate-950/70 p-3 text-sm leading-6 text-white outline-none"
            placeholder="تم الرد على حضرتك في الخاص ✅"
          />
        </label>

        <label className="grid gap-2">
          <span className="text-[11px] font-black uppercase tracking-[0.12em] text-slate-400">privateReplyTemplate</span>
          <textarea
            value={values.privateReplyTemplate || ""}
            onChange={(event) => onChange?.({ privateReplyTemplate: event.target.value })}
            rows={5}
            className="w-full rounded-2xl border border-white/10 bg-slate-950/70 p-3 text-sm leading-6 text-white outline-none"
            placeholder="أهلًا بحضرتك..."
          />
        </label>

        <label className="grid gap-2">
          <span className="text-[11px] font-black uppercase tracking-[0.12em] text-slate-400">aiOpeningPrompt</span>
          <textarea
            value={values.aiOpeningPrompt || ""}
            onChange={(event) => onChange?.({ aiOpeningPrompt: event.target.value })}
            rows={4}
            className="w-full rounded-2xl border border-white/10 bg-slate-950/70 p-3 text-sm leading-6 text-white outline-none"
            placeholder="أنت مساعد مبيعات داخل AI Social Media Center..."
          />
        </label>
      </div>
    </section>
  );
}

