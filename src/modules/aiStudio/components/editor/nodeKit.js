// Shared visual helpers for the workflow editor. Static Tailwind class strings only
// (v4 JIT cannot see dynamically-built class names), plus lucide icon resolvers.
import {
  Zap, Bot, GitBranch, Wrench, Bolt, ShieldCheck, ShieldAlert, Flag, Eye, Pencil,
  Clock, Loader2, CheckCircle2, XCircle, Ban, Unlink,
} from "lucide-react";

export const NODE_ICON = { Zap, Bot, GitBranch, Wrench, Bolt, ShieldCheck, Flag };
export const RISK_ICON = { Eye, Pencil, ShieldAlert };

// accent -> full static class strings for node chrome
export const ACCENT = {
  cyan: { border: "border-primary/40", chip: "bg-primary/15 text-primary", dot: "bg-primary" },
  violet: { border: "border-violet-300/40", chip: "bg-violet-300/15 text-violet-100", dot: "bg-violet-300" },
  amber: { border: "border-amber-300/40", chip: "bg-amber-300/15 text-amber-100", dot: "bg-amber-300" },
  sky: { border: "border-primary/40", chip: "bg-primary/15 text-primary", dot: "bg-primary" },
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

// short human descriptors for risk (icon + label + line) — never colour alone
// Keys are the RAW riskLevel enum. label/line stay as English fallbacks; the
// *Key fields are resolved by the UI layer (nodeKit stays framework-free).
export const RISK_INFO = {
  READ: { label: "Read only", labelKey: "aiStudio.workflow.risk.READ.label", icon: "Eye", line: "No ERP changes.", lineKey: "aiStudio.workflow.risk.READ.line" },
  WRITE: { label: "Writes data", labelKey: "aiStudio.workflow.risk.WRITE.label", icon: "Pencil", line: "Changes ERP data; may need permission.", lineKey: "aiStudio.workflow.risk.WRITE.line" },
  SENSITIVE: { label: "Human approval required", labelKey: "aiStudio.workflow.risk.SENSITIVE.label", icon: "ShieldAlert", line: "Sensitive action — never runs without approval.", lineKey: "aiStudio.workflow.risk.SENSITIVE.line" },
};

// execution state -> ring styling on the node
export const EXEC_RING = {
  waiting: "ring-1 ring-slate-400/40",
  running: "ring-2 ring-primary",
  completed: "ring-1 ring-emerald-400/60",
  failed: "ring-2 ring-rose-500",
  awaiting_approval: "ring-2 ring-amber-400",
  rejected: "ring-2 ring-rose-400/70",
  skipped: "opacity-60",
};

export const EXEC_LABEL = {
  waiting: "Waiting",
  running: "Running",
  completed: "Done",
  failed: "Failed",
  awaiting_approval: "Approval",
  rejected: "Rejected",
  skipped: "Skipped",
};

export const EXEC_ICON = {
  waiting: Clock,
  running: Loader2,
  completed: CheckCircle2,
  failed: XCircle,
  awaiting_approval: ShieldAlert,
  rejected: Ban,
  skipped: Ban,
};

// exec badge chip classes (icon+text; colour is a reinforcement, not the only signal)
export const EXEC_BADGE = {
  waiting: "bg-slate-500/20 text-slate-200",
  running: "bg-primary/20 text-primary",
  completed: "bg-emerald-400/20 text-emerald-100",
  failed: "bg-rose-500/25 text-rose-100",
  awaiting_approval: "bg-amber-400/20 text-amber-100",
  rejected: "bg-rose-500/20 text-rose-100",
  skipped: "bg-slate-600/20 text-slate-300",
};

export const DisconnectedIcon = Unlink;

export const STATUS_TONE = (s) =>
  s === "completed"
    ? "text-emerald-200"
    : s === "failed" || s === "rejected"
    ? "text-rose-200"
    : s === "awaiting_approval"
    ? "text-amber-200"
    : s === "running"
    ? "text-primary"
    : "text-slate-300";

export const fmtTime = (v) => (v ? new Date(v).toLocaleString() : "—");
export const fmtMs = (v) => (v == null ? "" : v < 1000 ? `${v}ms` : `${(v / 1000).toFixed(2)}s`);
