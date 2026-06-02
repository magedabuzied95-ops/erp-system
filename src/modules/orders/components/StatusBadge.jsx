import { useTranslation } from "react-i18next";

const statusClasses = {
  Pending: "border-amber-400/25 bg-amber-400/10 text-amber-200",
  "Pending Confirmation": "border-amber-400/25 bg-amber-400/10 text-amber-200",
  Confirmed: "border-blue-400/25 bg-blue-400/10 text-blue-200",
  Completed: "border-blue-400/25 bg-blue-400/10 text-blue-200",
  Paid: "border-emerald-400/25 bg-emerald-400/10 text-emerald-200",
  "Partially Paid": "border-amber-400/25 bg-amber-400/10 text-amber-200",
  Shipped: "border-blue-400/25 bg-blue-400/10 text-blue-200",
  Created: "border-cyan-400/25 bg-cyan-400/10 text-cyan-200",
  "Shipment Created": "border-cyan-400/25 bg-cyan-400/10 text-cyan-200",
  "Picked Up": "border-blue-400/25 bg-blue-400/10 text-blue-200",
  "In Transit": "border-sky-400/25 bg-sky-400/10 text-sky-200",
  "Out For Delivery": "border-indigo-400/25 bg-indigo-400/10 text-indigo-200",
  Delivered: "border-blue-400/25 bg-blue-400/10 text-blue-200",
  Cancelled: "border-rose-400/25 bg-rose-400/10 text-rose-200",
  Returned: "border-purple-400/25 bg-purple-400/10 text-purple-200",
  "Failed Delivery": "border-rose-400/25 bg-rose-400/10 text-rose-200",
  Failed: "border-rose-400/25 bg-rose-400/10 text-rose-200",
  Refunded: "border-purple-400/25 bg-purple-400/10 text-purple-200",
  Unpaid: "border-slate-400/20 bg-slate-400/10 text-slate-300",
  Draft: "border-slate-400/20 bg-slate-400/10 text-slate-300",
  Submitted: "border-blue-400/25 bg-blue-400/10 text-blue-200",
  Approved: "border-emerald-400/25 bg-emerald-400/10 text-emerald-200",
  Rejected: "border-rose-400/25 bg-rose-400/10 text-rose-200",
  "Awaiting Verification": "border-amber-400/25 bg-amber-400/10 text-amber-200",
  COD: "border-slate-400/20 bg-slate-400/10 text-slate-300",
};

const fallbackLabel = (value) => {
  const normalized = String(value || "Pending").trim().toLowerCase();
  if (["partially_paid", "partially paid", "partial"].includes(normalized)) return "Partially Paid";
  if (normalized === "awaiting_verification") return "Awaiting Verification";
  if (normalized === "pending_confirmation") return "Pending Confirmation";
  return String(value || "Pending")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
};

function StatusBadge({ value = "Pending" }) {
  const { t } = useTranslation();
  const normalized = String(value || "Pending").trim().toLowerCase().replace(/\s+/g, "_");
  const fallback = fallbackLabel(value);
  const label = t(`orders.statusLabels.${normalized}`, fallback);
  const className = statusClasses[fallback] || statusClasses[value] || statusClasses.Pending;
  return (
    <span className={`inline-flex max-w-full items-center truncate rounded-full border px-2 py-0.5 text-[10px] font-bold leading-4 ${className}`}>
      {label}
    </span>
  );
}

export default StatusBadge;
