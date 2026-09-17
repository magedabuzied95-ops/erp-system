import { useEffect } from "react";
import { CheckCircle2, ClipboardList, ScrollText, X } from "lucide-react";

import i18n from "../../../i18n/i18n";
import { buildAttendanceRules } from "../lib/attendanceRules";

function RuleList({ items, Icon, iconClassName }) {
  return (
    <ul className="grid gap-2">
      {items.map((item) => (
        <li key={item.text} className="flex items-start gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5">
          <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${iconClassName}`} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold leading-6 text-slate-800">{item.text}</p>
            {item.balance ? (
              <span className="mt-1 inline-flex rounded-full bg-primary-subtle px-2.5 py-0.5 text-[11px] font-black text-primary">
                {item.balance}
              </span>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function AttendanceRulesPanel({ open, onClose, policy, isArabic = true, direction = "rtl" }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  const { rights, duties } = buildAttendanceRules(policy, isArabic);
  const tr = (key) => i18n.t(`employeePortal.rules.${key}`, { lng: isArabic ? "ar" : "en" });
  const title = tr("title");
  const sideClassName = direction === "rtl" ? "right-0" : "left-0";

  return (
    <div className="fixed inset-0 z-50" dir={direction} data-testid="attendance-rules-panel">
      <button type="button" aria-label={tr("close")} onClick={onClose} className="absolute inset-0 bg-black/50" />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`absolute inset-y-0 ${sideClassName} flex w-full max-w-sm flex-col bg-white shadow-2xl`}
      >
        <header className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))]">
          <div className="flex min-w-0 items-center gap-2">
            <ScrollText className="h-5 w-5 shrink-0 text-primary" />
            <h2 className="m1-section-title truncate text-slate-950">{title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={tr("close")}
            className="inline-flex h-[var(--control-height-md)] w-10 shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-slate-200 bg-slate-50 text-slate-700"
          >
            <X className="h-5 w-5" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-4">
          <section>
            <h3 className="mb-2 text-sm font-black text-emerald-700">{tr("rights")}</h3>
            <RuleList items={rights} Icon={CheckCircle2} iconClassName="text-emerald-600" />
          </section>
          <section className="mt-5">
            <h3 className="mb-2 text-sm font-black text-amber-700">{tr("duties")}</h3>
            <RuleList items={duties} Icon={ClipboardList} iconClassName="text-amber-600" />
          </section>
        </div>
      </aside>
    </div>
  );
}
