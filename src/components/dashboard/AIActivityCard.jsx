import { memo } from "react";
import { Bot } from "lucide-react";
import { useTranslation } from "react-i18next";

export const AIActivityCard = memo(function AIActivityCard({ metrics, events = [], insights = [] }) {
  const { t } = useTranslation();  const copy = {
    title: t("dashboard.realtime.aiActivity.title"),
    active: t("dashboard.realtime.aiActivity.active"),
    escalations: t("dashboard.realtime.aiActivity.escalations"),
    signals: t("dashboard.realtime.aiActivity.signals"),
    fallback: t("dashboard.realtime.aiActivity.fallback"),
    empty: t("dashboard.realtime.aiActivity.empty"),
  };
  const aiEvents = events.filter((event) => event.category === "ai").slice(0, 3);
  return (
    <section className="rounded-2xl border border-white/[0.07] bg-zinc-950/58 p-4 shadow-2xl shadow-black/20 backdrop-blur-2xl">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-black text-white"><Bot className="h-4 w-4 text-sky-300" />{copy.title}</div>
        <span className="rounded-full bg-sky-400/10 px-2 py-1 text-[10px] font-black text-sky-100">{metrics.activeAiConversations} {copy.active}</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Metric label={copy.escalations} value={metrics.aiEscalations} />
        <Metric label={copy.signals} value={aiEvents.length || insights.length} />
      </div>
      <div className="mt-3 space-y-2">
        {(aiEvents.length ? aiEvents : insights.slice(0, 3)).map((item, index) => (
          <div key={`${item.title}-${index}`} className="rounded-xl bg-white/[0.035] px-3 py-2">
            <div className="truncate text-xs font-black text-white">{item.title}</div>
            <div className="mt-1 line-clamp-2 text-xs text-zinc-500">{item.description || item.body || copy.fallback}</div>
          </div>
        ))}
        {!aiEvents.length && !insights.length ? <Empty text={copy.empty} /> : null}
      </div>
    </section>
  );
});

function Metric({ label, value }) {
  return <div className="rounded-xl bg-white/[0.035] px-3 py-2"><div className="text-[10px] font-black uppercase tracking-[0.14em] text-zinc-500">{label}</div><div className="mt-1 text-lg font-black text-white">{Number(value || 0).toLocaleString()}</div></div>;
}

function Empty({ text }) {
  return <div className="rounded-[var(--radius-card)] border border-dashed border-white/[0.08] bg-white/[0.02] p-4 text-center text-xs text-zinc-500">{text}</div>;
}

export default AIActivityCard;
