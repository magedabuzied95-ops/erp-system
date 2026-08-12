import { memo } from "react";
import { Store } from "lucide-react";
import { useTranslation } from "react-i18next";

export const RealtimeBranchStatusCard = memo(function RealtimeBranchStatusCard({ branches = [] }) {
  const { t } = useTranslation();
  const rows = branches.slice(0, 5);
  return (
    <section className="rounded-2xl border border-white/[0.07] bg-zinc-950/58 p-4 shadow-2xl shadow-black/20 backdrop-blur-2xl">
      <div className="mb-3 flex items-center gap-2 text-sm font-black text-white"><Store className="h-4 w-4 text-sky-300" />{t("dashboard.realtime.branchStatus.title")}</div>
      <div className="space-y-2">
        {rows.length ? rows.map((branch) => (
          <div key={branch.branch || branch.name || branch.id} className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.035] px-3 py-2">
            <span className="truncate text-xs font-black text-white">{branch.branch || branch.name}</span>
            <span className="text-xs font-black text-emerald-100">{Number(branch.sales || 0).toLocaleString()} · {Number(branch.orders || 0)} {t("dashboard.realtime.branchStatus.orders")}</span>
          </div>
        )) : <div className="rounded-[var(--radius-card)] border border-dashed border-white/[0.08] bg-white/[0.02] p-4 text-center text-xs text-zinc-500">{t("dashboard.realtime.branchStatus.empty")}</div>}
      </div>
    </section>
  );
});

export default RealtimeBranchStatusCard;
