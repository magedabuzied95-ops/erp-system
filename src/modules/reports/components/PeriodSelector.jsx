import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CalendarDays, ChevronDown, RefreshCw } from "lucide-react";

import { PERIOD_PRESETS, resolvePreset } from "../hooks/useAnalyticsFilters";

/**
 * Period + comparison control.
 *
 * Only comparison modes that are mathematically valid for the chosen window are
 * offered — a 200-day range has no meaningful "previous month".
 */
export default function PeriodSelector({ filters, allowedComparisons, onPresetChange, onCompareChange, onRefresh, busy }) {
  const { t, i18n } = useTranslation();
  const isArabic = String(i18n.language || "").toLowerCase().startsWith("ar");
  const [open, setOpen] = useState(false);
  const [customFrom, setCustomFrom] = useState(filters.from);
  const [customTo, setCustomTo] = useState(filters.to);
  const popoverRef = useRef(null);

  useEffect(() => {
    setCustomFrom(filters.from);
    setCustomTo(filters.to);
  }, [filters.from, filters.to]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (popoverRef.current && !popoverRef.current.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const activeLabel = t(`overview.period.${filters.preset}`);
  const rangeLabel = `${filters.from} → ${filters.to}`;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative" ref={popoverRef}>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-haspopup="dialog"
          className="inline-flex h-[var(--control-height-md)] items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 text-[13px] font-semibold text-[var(--text)] transition hover:border-[var(--border-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
        >
          <CalendarDays className="h-4 w-4 shrink-0 text-[var(--text-tertiary)]" aria-hidden="true" />
          <span className="truncate">{activeLabel}</span>
          <span className="hidden text-[11px] font-medium tabular-nums text-[var(--text-tertiary)] sm:inline">{rangeLabel}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[var(--text-tertiary)]" aria-hidden="true" />
        </button>

        {open ? (
          <div
            role="dialog"
            aria-label={t("overview.period.label")}
            className="absolute top-12 z-40 w-[min(92vw,340px)] rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-3 shadow-[var(--shadow-overlay)] start-0"
          >
            <div className="grid grid-cols-2 gap-1.5">
              {PERIOD_PRESETS.filter((preset) => preset !== "custom").map((preset) => {
                const range = resolvePreset(preset);
                const active = filters.preset === preset;
                return (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => {
                      onPresetChange(preset);
                      setOpen(false);
                    }}
                    className={`rounded-lg px-2.5 py-2 text-start text-[12px] font-semibold transition ${
                      active
                        ? "bg-[var(--primary)] text-white"
                        : "text-[var(--text-secondary)] hover:bg-[var(--surface-soft)] hover:text-[var(--text)]"
                    }`}
                    title={`${range.from} → ${range.to}`}
                  >
                    {t(`overview.period.${preset}`)}
                  </button>
                );
              })}
            </div>

            <div className="mt-3 border-t border-[var(--border)] pt-3">
              <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-[var(--text-tertiary)]">
                {t("overview.period.custom")}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="mb-1 block text-[11px] font-semibold text-[var(--text-tertiary)]">
                    {t("overview.period.from")}
                  </span>
                  <input
                    type="date"
                    value={customFrom}
                    max={customTo}
                    onChange={(event) => setCustomFrom(event.target.value)}
                    className="h-[var(--control-height-md)] w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 text-[12px] text-[var(--text)] outline-none focus:border-[var(--primary)]"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] font-semibold text-[var(--text-tertiary)]">
                    {t("overview.period.to")}
                  </span>
                  <input
                    type="date"
                    value={customTo}
                    min={customFrom}
                    onChange={(event) => setCustomTo(event.target.value)}
                    className="h-[var(--control-height-md)] w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 text-[12px] text-[var(--text)] outline-none focus:border-[var(--primary)]"
                  />
                </label>
              </div>
              <button
                type="button"
                disabled={!customFrom || !customTo || customFrom > customTo}
                onClick={() => {
                  onPresetChange("custom", { from: customFrom, to: customTo });
                  setOpen(false);
                }}
                className="mt-2.5 h-[var(--control-height-md)] w-full rounded-lg bg-[var(--primary)] text-[12px] font-bold text-white transition hover:brightness-110 disabled:opacity-45"
              >
                {t("overview.period.apply")}
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <label className="inline-flex h-10 items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] px-3">
        <span className="text-[11px] font-semibold text-[var(--text-tertiary)]">{t("overview.compare.label")}</span>
        <select
          value={filters.compare}
          onChange={(event) => onCompareChange(event.target.value)}
          dir={isArabic ? "rtl" : "ltr"}
          className="max-w-[150px] bg-transparent text-[13px] font-semibold text-[var(--text)] outline-none"
        >
          {allowedComparisons.map((mode) => (
            <option key={mode} value={mode}>
              {t(`overview.compare.${mode}`)}
            </option>
          ))}
        </select>
      </label>

      <button
        type="button"
        onClick={onRefresh}
        disabled={busy}
        aria-label={t("overview.actions.refresh")}
        className="inline-flex h-[var(--control-height-md)] w-10 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--card)] text-[var(--text-secondary)] transition hover:border-[var(--border-strong)] hover:text-[var(--text)] disabled:opacity-50"
      >
        <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} aria-hidden="true" />
      </button>
    </div>
  );
}
