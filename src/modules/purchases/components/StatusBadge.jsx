import { useTranslation } from "react-i18next";

const statusClasses = {
  Draft: "border-zinc-500/20 bg-zinc-500/10 text-zinc-300",
  Ordered: "border-sky-500/20 bg-sky-500/10 text-sky-300",
  Received: "border-emerald-500/20 bg-emerald-500/10 text-emerald-300",
  Cancelled: "border-rose-500/20 bg-rose-500/10 text-rose-300",
  Active: "border-emerald-500/20 bg-emerald-500/10 text-emerald-300",
  Inactive: "border-zinc-500/20 bg-zinc-500/10 text-zinc-300",
  Pending: "border-amber-500/20 bg-amber-500/10 text-amber-300",
  Paid: "border-emerald-500/20 bg-emerald-500/10 text-emerald-300",
  PartiallyPaid: "border-orange-500/20 bg-orange-500/10 text-orange-300",
  Low: "border-amber-500/20 bg-amber-500/10 text-amber-300",
  Inbound: "border-blue-500/20 bg-blue-500/10 text-blue-300",
  Outbound: "border-rose-500/20 bg-rose-500/10 text-rose-300",
};

function StatusBadge({ value = "Draft" }) {
  const { t } = useTranslation();
  const key = String(value).replace(/\s+/g, "");
  const normalized = String(value || "Draft").trim().toLowerCase().replace(/[\s-]+/g, "_");
  const label = t(`purchases.statusLabels.${normalized}`, value);
  return (
    <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${statusClasses[key] || statusClasses[value] || statusClasses.Draft}`}>
      {label}
    </span>
  );
}

export default StatusBadge;
