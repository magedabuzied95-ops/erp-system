import { memo } from "react";
import { Users } from "lucide-react";

export const ActiveVisitorsCard = memo(function ActiveVisitorsCard({ metrics }) {
  const rows = [
    ["Visitors online", metrics.activeCustomers],
    ["Active carts", metrics.activeCarts],
    ["Active checkouts", metrics.activeCheckouts],
    ["Abandoned carts", metrics.abandonedCarts],
  ];
  return <MiniCommandCard title="Storefront Live" icon={Users} rows={rows} />;
});

function MiniCommandCard({ title, icon: Icon, rows }) {
  return (
    <section className="rounded-2xl border border-white/[0.07] bg-zinc-950/58 p-4 shadow-2xl shadow-black/20 backdrop-blur-2xl">
      <div className="mb-3 flex items-center gap-2 text-sm font-black text-white"><Icon className="h-4 w-4 text-emerald-300" />{title}</div>
      <div className="grid grid-cols-2 gap-2">
        {rows.map(([label, value]) => (
          <div key={label} className="rounded-xl bg-white/[0.035] px-3 py-2">
            <div className="text-[10px] font-black uppercase tracking-[0.14em] text-zinc-500">{label}</div>
            <div className="mt-1 text-lg font-black text-white">{Number(value || 0).toLocaleString()}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

export default ActiveVisitorsCard;
