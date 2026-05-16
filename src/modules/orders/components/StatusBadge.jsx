const statusClasses = {
  Pending: "border-amber-500/20 bg-amber-500/10 text-amber-300",
  Confirmed: "border-sky-500/20 bg-sky-500/10 text-sky-300",
  Paid: "border-emerald-500/20 bg-emerald-500/10 text-emerald-300",
  "Partially Paid": "border-orange-500/20 bg-orange-500/10 text-orange-300",
  Shipped: "border-blue-500/20 bg-blue-500/10 text-blue-300",
  Delivered: "border-cyan-500/20 bg-cyan-500/10 text-cyan-300",
  Cancelled: "border-rose-500/20 bg-rose-500/10 text-rose-300",
  Returned: "border-fuchsia-500/20 bg-fuchsia-500/10 text-fuchsia-300",
  Refunded: "border-purple-500/20 bg-purple-500/10 text-purple-300",
  Unpaid: "border-zinc-500/20 bg-zinc-500/10 text-zinc-300",
  Draft: "border-zinc-500/20 bg-zinc-500/10 text-zinc-300",
  Submitted: "border-blue-500/20 bg-blue-500/10 text-blue-300",
  Approved: "border-emerald-500/20 bg-emerald-500/10 text-emerald-300",
  Rejected: "border-rose-500/20 bg-rose-500/10 text-rose-300",
};

function StatusBadge({ value = "Pending" }) {
  return (
    <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${statusClasses[value] || statusClasses.Pending}`}>
      {value}
    </span>
  );
}

export default StatusBadge;
