// Shared visual helpers for the workflow editor. Static Tailwind class strings only
// (v4 JIT cannot see dynamically-built class names), plus a lucide icon resolver.
import { Zap, Bot, GitBranch, Wrench, Bolt, ShieldCheck, ShieldAlert, Flag, Eye, Pencil } from "lucide-react";

export const NODE_ICON = { Zap, Bot, GitBranch, Wrench, Bolt, ShieldCheck, Flag };
export const RISK_ICON = { Eye, Pencil, ShieldAlert };

// accent -> full static class strings for node chrome
export const ACCENT = {
  cyan: { border: "border-cyan-300/40", chip: "bg-cyan-300/15 text-cyan-100", dot: "bg-cyan-300" },
  violet: { border: "border-violet-300/40", chip: "bg-violet-300/15 text-violet-100", dot: "bg-violet-300" },
  amber: { border: "border-amber-300/40", chip: "bg-amber-300/15 text-amber-100", dot: "bg-amber-300" },
  sky: { border: "border-sky-300/40", chip: "bg-sky-300/15 text-sky-100", dot: "bg-sky-300" },
  orange: { border: "border-orange-300/40", chip: "bg-orange-300/15 text-orange-100", dot: "bg-orange-300" },
  rose: { border: "border-rose-300/40", chip: "bg-rose-300/15 text-rose-100", dot: "bg-rose-300" },
  slate: { border: "border-slate-300/30", chip: "bg-slate-300/10 text-slate-200", dot: "bg-slate-300" },
  emerald: { border: "border-emerald-300/40", chip: "bg-emerald-300/15 text-emerald-100", dot: "bg-emerald-300" },
};

// risk tone -> static classes for the risk badge on tool/action nodes
export const RISK_BADGE = {
  READ: "border-emerald-300/40 bg-emerald-300/10 text-emerald-100",
  WRITE: "border-amber-300/40 bg-amber-300/10 text-amber-100",
  SENSITIVE: "border-rose-400/50 bg-rose-500/15 text-rose-100",
};

// execution state -> ring styling on the node
export const EXEC_RING = {
  running: "ring-2 ring-cyan-300 ring-offset-0",
  completed: "ring-2 ring-emerald-400/70",
  failed: "ring-2 ring-rose-500",
  awaiting_approval: "ring-2 ring-amber-400",
  rejected: "ring-2 ring-rose-400/70",
  skipped: "opacity-50",
};

export const EXEC_LABEL = {
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  awaiting_approval: "Awaiting approval",
  rejected: "Rejected",
  skipped: "Skipped",
};

export const STATUS_TONE = (s) =>
  s === "completed"
    ? "text-emerald-200"
    : s === "failed" || s === "rejected"
    ? "text-rose-200"
    : s === "awaiting_approval"
    ? "text-amber-200"
    : s === "running"
    ? "text-cyan-200"
    : "text-slate-300";

export const fmtTime = (v) => (v ? new Date(v).toLocaleString() : "—");
export const fmtMs = (v) => (v == null ? "" : v < 1000 ? `${v}ms` : `${(v / 1000).toFixed(2)}s`);
