import { memo } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  Bell,
  Bot,
  CheckCircle2,
  ClipboardList,
  CreditCard,
  Package,
  ReceiptText,
  RotateCcw,
  ScanBarcode,
  UserCheck,
} from "lucide-react";

const iconMap = {
  ai: Bot,
  aiWarning: AlertTriangle,
  attendance: UserCheck,
  inventory: AlertTriangle,
  order: ReceiptText,
  payment: CreditCard,
  pos: ScanBarcode,
  product: Package,
  refund: RotateCcw,
  system: Bell,
  task: ClipboardList,
};

const priorityClass = {
  critical: "border-rose-300/30 bg-rose-400/10 text-rose-100 shadow-rose-950/20",
  high: "border-amber-300/25 bg-amber-400/10 text-amber-100 shadow-amber-950/20",
  normal: "border-emerald-300/18 bg-emerald-400/8 text-emerald-100 shadow-emerald-950/10",
};

const dotClass = {
  critical: "bg-rose-300 shadow-[0_0_18px_rgba(253,164,175,0.45)]",
  high: "bg-amber-300 shadow-[0_0_18px_rgba(252,211,77,0.35)]",
  normal: "bg-emerald-300 shadow-[0_0_16px_rgba(110,231,183,0.3)]",
};

const formatRelativeTime = (timestamp, now) => {
  const time = new Date(timestamp).getTime();
  if (Number.isNaN(time)) return "";
  const diff = Math.max(0, Math.floor((now - time) / 1000));
  if (diff < 15) return "now";
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return new Date(timestamp).toLocaleDateString([], { month: "short", day: "numeric" });
};

const detailLabels = {
  branch: "Branch",
  user: "User",
  customer: "Customer",
  product: "Product",
  order: "Order",
};

export const LiveActivityItem = memo(function LiveActivityItem({ item, now }) {
  const Icon = iconMap[item.iconKey] || CheckCircle2;
  const fresh = Number(item.highlightUntil || 0) > now;
  const content = (
    <div
      className={[
        "group relative grid grid-cols-[2.25rem_minmax(0,1fr)] gap-3 rounded-2xl border p-3 text-left shadow-lg transition duration-300",
        priorityClass[item.priority] || priorityClass.normal,
        fresh ? "bg-white/[0.085] ring-1 ring-emerald-200/20 motion-safe:animate-[realtime-badge-pop_420ms_ease-out]" : "bg-white/[0.035]",
        item.href ? "hover:-translate-y-0.5 hover:border-white/18 hover:bg-white/[0.075]" : "",
      ].join(" ")}
    >
      <div className="relative flex justify-center">
        <span className={`mt-1 flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-zinc-950/45 ${fresh ? "text-white" : "text-zinc-200"}`}>
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
        <span className={`absolute -right-0.5 top-1 h-2.5 w-2.5 rounded-full ${dotClass[item.priority] || dotClass.normal}`} />
      </div>

      <div className="min-w-0">
        <div className="flex min-w-0 items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-sm font-black text-white">{item.title}</div>
            <p className="mt-1 line-clamp-2 text-xs leading-5 text-zinc-400">{item.description}</p>
          </div>
          <time className="shrink-0 rounded-lg bg-black/20 px-2 py-1 text-[10px] font-black text-zinc-300">
            {formatRelativeTime(item.timestamp, now)}
          </time>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="rounded-full border border-white/10 bg-white/[0.055] px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.12em] text-zinc-300">
            {item.label}
          </span>
          <span className="rounded-full border border-white/10 bg-black/20 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.12em] text-zinc-400">
            {item.priority}
          </span>
          {Object.entries(item.details || {}).filter(([, value]) => value).slice(0, 2).map(([key, value]) => (
            <span key={key} className="max-w-[11rem] truncate rounded-full bg-white/[0.04] px-2 py-0.5 text-[10px] font-semibold text-zinc-400">
              {detailLabels[key] || key}: {value}
            </span>
          ))}
          {item.href ? (
            <span className="ml-auto text-[11px] font-black text-emerald-200 opacity-0 transition group-hover:opacity-100">
              View related
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );

  if (!item.href) return content;
  return (
    <Link to={item.href} className="block focus:outline-none focus:ring-2 focus:ring-emerald-300/45 focus:ring-offset-2 focus:ring-offset-zinc-950">
      {content}
    </Link>
  );
});

export default LiveActivityItem;
