import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Filter, X } from "lucide-react";

import { fetchFilterOptions } from "../services/analyticsV2Api";

/**
 * The filter controls the legacy page had and this one did not.
 *
 * Two decisions worth keeping:
 *
 * 1. **Dropdowns, not id boxes.** The legacy page asked the reader to type a numeric
 *    `shiftId` or `salespersonId` into a text field. Nobody knows their own shift id, and
 *    a typed id that matches nothing returns an empty report that looks exactly like a
 *    quiet week. Every option here comes from the server, scoped to the caller's tenant
 *    and the selected window, so picking one can never produce an empty result by
 *    accident.
 *
 * 2. **A control with no values is not rendered.** If the shop has one branch, there is
 *    nothing to choose between and a branch dropdown is noise. An empty dropdown is
 *    honest but useless; absence says the same thing more quietly.
 *
 * The two legacy controls with no honest equivalent — `warehouseId` and `employeeId`,
 * both filtering on columns nothing writes — are not rendered at all. The server sends
 * the reason with the options, and the "what happened to my filters" note surfaces it
 * rather than leaving the reader to wonder.
 */

/** Server key -> translation key. The order here is the order they render in. */
const CONTROLS = Object.freeze([
  { key: "branchId", options: "branches", label: "overview.filters.branch" },
  { key: "salespersonId", options: "salespeople", label: "overview.filters.salesperson" },
  { key: "shiftId", options: "shifts", label: "overview.filters.shift" },
  { key: "paymentMethod", options: "paymentMethods", label: "overview.filters.paymentMethod" },
  { key: "channel", options: "channels", label: "overview.filters.channel" },
]);

export const FILTER_KEYS = Object.freeze(CONTROLS.map((control) => control.key));

export default function ReportFilterBar({ filters, onChange, period }) {
  const { t, i18n } = useTranslation();
  const isArabic = String(i18n.language || "").toLowerCase().startsWith("ar");

  const [options, setOptions] = useState(null);
  const [unsupported, setUnsupported] = useState([]);
  const [failed, setFailed] = useState(false);
  const requestRef = useRef(0);

  useEffect(() => {
    if (!period?.from || !period?.to) return undefined;
    const ticket = ++requestRef.current;
    let cancelled = false;

    fetchFilterOptions({ from: period.from, to: period.to })
      .then((response) => {
        // A late response from a window the reader has already moved away from would
        // otherwise offer shifts that are no longer in range.
        if (cancelled || ticket !== requestRef.current) return;
        setOptions(response?.data || {});
        setUnsupported(response?.meta?.unsupported || []);
        setFailed(false);
      })
      .catch(() => {
        if (cancelled || ticket !== requestRef.current) return;
        // The report itself still works; only the choices are missing. Say so rather than
        // rendering empty dropdowns that look like "there is no data".
        setFailed(true);
      });

    return () => { cancelled = true; };
  }, [period?.from, period?.to]);

  const visible = useMemo(
    () => CONTROLS.filter((control) => (options?.[control.options]?.length || 0) > 1
      // A single option is worth showing only when it is already the active filter, so the
      // reader can see what is applied and clear it.
      || (options?.[control.options]?.length === 1 && filters?.[control.key])),
    [options, filters]
  );

  const active = FILTER_KEYS.filter((key) => filters?.[key]);

  if (failed) {
    return (
      <p className="mb-3 text-[12px] text-[var(--text-secondary)]">{t("overview.filters.optionsUnavailable")}</p>
    );
  }

  if (!options) return null;
  if (!visible.length && !active.length && !unsupported.length) return null;

  return (
    <section
      aria-label={t("overview.filters.label")}
      className="mb-4 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] px-3 py-2.5"
    >
      <div className="flex flex-wrap items-end gap-2.5">
        <span className="inline-flex h-[var(--control-height-sm)] items-center gap-1.5 text-[12px] font-semibold text-[var(--text-secondary)]">
          <Filter className="h-3.5 w-3.5" aria-hidden="true" />
          {t("overview.filters.label")}
        </span>

        {visible.map((control) => {
          const list = options[control.options] || [];
          const value = filters?.[control.key] ?? "";
          return (
            <label key={control.key} className="flex min-w-0 flex-col gap-1">
              <span className="text-[11px] font-medium text-[var(--text-secondary)]">{t(control.label)}</span>
              <select
                value={value}
                dir={isArabic ? "rtl" : "ltr"}
                onChange={(event) => onChange({ ...filters, [control.key]: event.target.value || undefined })}
                className="h-[var(--control-height-sm)] min-w-[9rem] max-w-[14rem] truncate rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--bg)] px-2 text-[12px] text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
              >
                <option value="">{t("overview.filters.all")}</option>
                {list.map((option) => (
                  <option key={option.value} value={option.value}>
                    {/* The count is the honest part: it says how much of the window this
                        choice actually covers before the reader commits to it. */}
                    {option.label} ({option.orders})
                  </option>
                ))}
              </select>
            </label>
          );
        })}

        {active.length ? (
          <button
            type="button"
            onClick={() => onChange(Object.fromEntries(FILTER_KEYS.map((key) => [key, undefined])))}
            className="inline-flex h-[var(--control-height-sm)] items-center gap-1 rounded-[var(--radius-control)] border border-[var(--border)] px-2.5 text-[12px] font-semibold text-[var(--text)] transition hover:border-[var(--border-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
            {t("overview.filters.clear")}
          </button>
        ) : null}
      </div>

      {/*
        Why two legacy controls are missing. Shown once, quietly, rather than leaving
        somebody who used them on the old page to conclude the new one is less capable.
      */}
      {unsupported.length ? (
        <p className="mt-2 max-w-[80ch] text-[11px] leading-4 text-[var(--text-muted,var(--text-secondary))]">
          {t("overview.filters.unsupportedNote", { names: unsupported.map((entry) => entry.key).join("، ") })}
        </p>
      ) : null}
    </section>
  );
}
