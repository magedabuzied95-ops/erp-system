// Shared atoms for the AI Inbox integrations center.
//
// The integrations center lives inside the AI Inbox shell, which is a fixed
// dark surface — it does NOT follow the light/dark token theme the marketing
// pages use. So these atoms paint explicit slate/white-alpha colours instead of
// var(--card)/var(--text): a token-driven card would render light-on-light here.

import { CheckCircle2, Circle, Copy, Loader2 } from "lucide-react";
import toast from "react-hot-toast";

export const clean = (value, fallback = "") => String(value ?? fallback).trim();

export const formatDateTime = (value, fallback = "—") => {
  if (!value) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toLocaleString();
};

// Three states only. "partial" covers everything between reachable and healthy
// (token saved but webhook unverified, permissions pending review, and so on) —
// splitting it further just produces badges nobody can act on.
export const STATE_TONE = {
  connected: "border-emerald-300/25 bg-emerald-400/10 text-emerald-100",
  partial: "border-amber-300/25 bg-amber-400/10 text-amber-100",
  off: "border-white/10 bg-white/[0.05] text-slate-300",
  error: "border-rose-300/25 bg-rose-400/10 text-rose-100",
};

export const STATE_DOT = {
  connected: "bg-emerald-300",
  partial: "bg-amber-300",
  off: "bg-slate-500",
  error: "bg-rose-300",
};

// Written out as literal t() keys rather than an interpolated state.<value>:
// the missing-key guard can only verify keys it can read statically, and these
// four are the whole enum.
export const stateLabel = (t, state) => {
  if (state === "connected") return t("aiSupport.integrations.state.connected");
  if (state === "partial") return t("aiSupport.integrations.state.partial");
  if (state === "error") return t("aiSupport.integrations.state.error");
  return t("aiSupport.integrations.state.off");
};

export function StatusPill({ state = "off", children }) {
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-black ${STATE_TONE[state] || STATE_TONE.off}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${STATE_DOT[state] || STATE_DOT.off}`} />
      {children}
    </span>
  );
}

export function PanelSection({ icon: Icon, title, subtitle, action, tone = "slate", children }) {
  const ring = {
    slate: "border-white/10 bg-white/[0.035]",
    emerald: "border-emerald-300/20 bg-emerald-400/[0.05]",
    amber: "border-amber-300/20 bg-amber-400/[0.05]",
    rose: "border-rose-300/20 bg-rose-400/[0.05]",
  }[tone] || "border-white/10 bg-white/[0.035]";
  return (
    <section className={`rounded-2xl border p-4 ${ring}`}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          {Icon ? (
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/[0.06] text-slate-200">
              <Icon className="h-4 w-4" aria-hidden="true" />
            </span>
          ) : null}
          <div className="min-w-0">
            <h3 className="text-sm font-black text-white">{title}</h3>
            {subtitle ? <p className="mt-1 text-xs leading-5 text-slate-400">{subtitle}</p> : null}
          </div>
        </div>
        {action ? <div className="flex shrink-0 flex-wrap gap-2">{action}</div> : null}
      </header>
      {children ? <div className="mt-4">{children}</div> : null}
    </section>
  );
}

export function FieldRow({ label, value, fallback = "—" }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-xs">
      <span className="shrink-0 text-slate-400">{label}</span>
      <span dir="auto" className="min-w-0 truncate text-end font-black text-white">{value || fallback}</span>
    </div>
  );
}

export function CheckRow({ ok, label }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-xs text-slate-300">
      {ok ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-300" /> : <Circle className="h-3.5 w-3.5 shrink-0 text-slate-500" />}
      <span className="min-w-0 truncate">{label}</span>
    </div>
  );
}

export function CopyRow({ label, value, copyLabel = "Copy" }) {
  return (
    <div className="rounded-xl border border-white/10 bg-slate-950/40 p-3">
      <div className="text-[11px] font-black uppercase tracking-[0.12em] text-slate-500">{label}</div>
      <code dir="ltr" className="mt-2 block break-all text-xs text-slate-200">{value || "—"}</code>
      <button
        type="button"
        disabled={!value}
        onClick={() => {
          navigator.clipboard?.writeText(String(value || ""));
          toast.success(copyLabel);
        }}
        className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.05] px-2.5 text-[11px] font-black text-slate-200 transition hover:bg-white/10 disabled:opacity-40"
      >
        <Copy className="h-3 w-3" aria-hidden="true" />
        {copyLabel}
      </button>
    </div>
  );
}

const BUTTON_TONE = {
  primary: "bg-cyan-300 text-slate-950 hover:bg-cyan-200",
  meta: "bg-[#1877f2] text-white hover:bg-[#3b8bf5]",
  emerald: "border border-emerald-300/25 bg-emerald-400/10 text-emerald-100 hover:bg-emerald-400/15",
  amber: "border border-amber-300/25 bg-amber-400/10 text-amber-100 hover:bg-amber-400/15",
  rose: "border border-rose-300/25 bg-rose-400/10 text-rose-100 hover:bg-rose-400/15",
  ghost: "border border-white/10 bg-white/[0.05] text-slate-100 hover:bg-white/10",
};

export function ActionButton({ tone = "ghost", icon: Icon, loading = false, children, className = "", ...rest }) {
  return (
    <button
      type="button"
      {...rest}
      disabled={rest.disabled || loading}
      className={`inline-flex h-9 items-center justify-center gap-2 rounded-xl px-3 text-xs font-black transition disabled:opacity-50 ${BUTTON_TONE[tone] || BUTTON_TONE.ghost} ${className}`}
    >
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : Icon ? <Icon className="h-3.5 w-3.5" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

export function TextInput({ label, hint, className = "", ...rest }) {
  return (
    <label className={`block ${className}`}>
      {label ? <span className="text-[11px] font-black uppercase tracking-[0.12em] text-slate-500">{label}</span> : null}
      <input
        {...rest}
        className="mt-1 h-10 w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 text-sm font-bold text-white outline-none transition placeholder:text-slate-600 focus:border-cyan-300/40 disabled:opacity-60"
      />
      {hint ? <span className="mt-1 block text-[11px] leading-5 text-slate-500">{hint}</span> : null}
    </label>
  );
}

export function PanelSkeleton({ rows = 3 }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="h-24 animate-pulse rounded-2xl border border-white/10 bg-white/[0.035]" />
      ))}
    </div>
  );
}
