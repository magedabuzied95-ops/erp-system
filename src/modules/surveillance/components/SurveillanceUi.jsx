import { useTranslation } from "react-i18next";
import { AlertTriangle, Loader2 } from "lucide-react";

/**
 * Shared primitives for the Surveillance pages.
 *
 * THE ONE RULE THEY ALL ENFORCE
 * -----------------------------
 * A missing value renders as an em dash, never as 0, "—" is not a style choice.
 * Every page here shows readings taken from a recorder over a LAN, and a
 * recorder that did not answer is a fact the operator needs. A tile that shows
 * "0 GB free" when it means "we could not ask" is how somebody decides the disk
 * is fine, or that it is failing, on no evidence at all.
 */

/** A value that may legitimately be unknown. */
export const Value = ({ value, suffix = "", format }) => {
  if (value === null || value === undefined || value === "") {
    return <span className="text-slate-600">&mdash;</span>;
  }
  return (
    <>
      {format ? format(value) : String(value)}
      {suffix}
    </>
  );
};

/** A boolean the device may not have reported. Three states, not two. */
export const BoolValue = ({ value, yes, no }) => {
  const { t } = useTranslation();
  if (value === null || value === undefined) return <span className="text-slate-600">&mdash;</span>;
  return (
    <span className={value ? "text-emerald-300" : "text-slate-400"}>
      {value ? yes ?? t("surveillance.yes") : no ?? t("surveillance.no")}
    </span>
  );
};

export const Section = ({ title, subtitle, right, children }) => (
  <section className="rounded-[var(--radius-card)] border border-white/10 bg-white/[0.04] p-4">
    <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
      <div>
        <h2 className="text-[13px] font-black uppercase tracking-[0.12em] text-slate-300">{title}</h2>
        {subtitle && <p className="mt-0.5 text-[11px] text-slate-500">{subtitle}</p>}
      </div>
      {right}
    </div>
    {children}
  </section>
);

/** Label/value rows. Responsive without a table, so it works in RTL too. */
export const Facts = ({ rows }) => (
  <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-[12px] sm:grid-cols-2 lg:grid-cols-3">
    {rows.map(({ label, value }) => (
      <div key={label} className="flex items-baseline justify-between gap-3 border-b border-white/[0.06] pb-1.5">
        <dt className="shrink-0 text-slate-500">{label}</dt>
        <dd className="min-w-0 truncate text-end font-bold tabular-nums text-slate-200">{value}</dd>
      </div>
    ))}
  </dl>
);

export const Pill = ({ tone = "neutral", children }) => {
  const tones = {
    ok: "border-emerald-300/25 bg-emerald-300/10 text-emerald-100",
    warn: "border-amber-300/25 bg-amber-300/10 text-amber-100",
    bad: "border-rose-300/25 bg-rose-300/10 text-rose-100",
    info: "border-sky-300/25 bg-sky-300/10 text-sky-100",
    neutral: "border-white/15 bg-white/[0.06] text-slate-300",
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-wider ${tones[tone] || tones.neutral}`}>
      {children}
    </span>
  );
};

export const Loading = () => {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2 rounded-[var(--radius-card)] border border-white/10 bg-white/[0.03] p-6 text-sm text-slate-400">
      <Loader2 className="h-4 w-4 animate-spin" />
      {t("surveillance.loading")}
    </div>
  );
};

export const Failed = ({ messageKey }) => {
  const { t } = useTranslation();
  return (
    <div className="rounded-[var(--radius-card)] border border-rose-300/25 bg-rose-300/10 p-6 text-sm text-rose-100">
      {t(messageKey)}
    </div>
  );
};

/**
 * A control the device cannot do.
 *
 * Capability has FOUR states and `unknown` hides the control rather than
 * showing it disabled — offering a button that will certainly fail is worse
 * than not offering it, because the operator will keep pressing it.
 */
export const Unsupported = ({ reason }) => {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-[12px] text-slate-500">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      {t(reason || "surveillance.unsupportedOnDevice")}
    </div>
  );
};

/** Read-only banner for pages whose writes are prepared but deliberately off. */
export const ReadOnlyNotice = ({ messageKey }) => {
  const { t } = useTranslation();
  return (
    <div className="flex items-start gap-2 rounded-[var(--radius-card)] border border-sky-300/25 bg-sky-300/10 px-4 py-3 text-[12px] text-sky-100">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{t(messageKey)}</span>
    </div>
  );
};

export const PageHeader = ({ eyebrowIcon: Icon, title, subtitle, actions }) => {
  const { t } = useTranslation();
  return (
    <section className="rounded-[var(--radius-card)] border border-white/10 bg-white/[0.055] px-5 py-4 backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="inline-flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.18em] text-primary">
            {Icon && <Icon className="h-4 w-4" />}
            {t("surveillance.eyebrow")}
          </div>
          <h1 className="m1-page-title mt-1">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-slate-400">{subtitle}</p>}
        </div>
        {actions}
      </div>
    </section>
  );
};
