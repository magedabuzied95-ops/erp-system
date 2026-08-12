import { memo } from "react";
import { Link } from "react-router-dom";
import { Siren } from "lucide-react";
import { useTranslation } from "react-i18next";

const tone = {
  critical: "border-rose-300/20 bg-rose-400/10 text-rose-100",
  high: "border-amber-300/20 bg-amber-400/10 text-amber-100",
  normal: "border-emerald-300/18 bg-emerald-400/8 text-emerald-100",
};

export const RealtimeAlertsCard = memo(function RealtimeAlertsCard({ alerts = [] }) {
  const { t } = useTranslation();

  return (
    <section className="rounded-2xl border border-white/[0.07] bg-zinc-950/58 p-4 shadow-2xl shadow-black/20 backdrop-blur-2xl">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-black text-white"><Siren className="h-4 w-4 text-rose-300" />{t("dashboard.realtime.alerts.title")}</div>
        <span className="rounded-full bg-white/[0.05] px-2 py-1 text-[10px] font-black text-zinc-300">{alerts.length}</span>
      </div>
      <div className="space-y-2">
        {alerts.length ? alerts.map((alert) => {
          const content = <AlertContent alert={alert} />;
          return alert.href ? <Link key={alert.id} to={alert.href} className="block">{content}</Link> : <div key={alert.id}>{content}</div>;
        }) : <div className="rounded-[var(--radius-card)] border border-dashed border-white/[0.08] bg-white/[0.02] p-4 text-center text-xs text-zinc-500">{t("dashboard.realtime.alerts.empty")}</div>}
      </div>
    </section>
  );
});

function AlertContent({ alert }) {
  return (
    <div className={`rounded-[var(--radius-card)] border px-3 py-2 transition hover:bg-white/[0.07] ${tone[alert.priority] || tone.normal}`}>
      <div className="truncate text-xs font-black text-white">{alert.title}</div>
      <div className="mt-1 line-clamp-2 text-xs text-zinc-400">{alert.description}</div>
    </div>
  );
}

export default RealtimeAlertsCard;
