import { useId, useState } from "react";
import { Info } from "lucide-react";

/**
 * Explains a KPI on hover/focus. Keyboard reachable, and dismissible with Escape.
 * Shows the business definition and the formula concept — never SQL.
 */
export default function MetricTooltip({ title, definition, formula, extra, align = "start" }) {
  const [open, setOpen] = useState(false);
  const id = useId();

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        aria-describedby={open ? id : undefined}
        aria-label={title}
        className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[var(--text-tertiary)] outline-none transition hover:bg-[var(--surface-soft)] hover:text-[var(--text-secondary)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
        }}
      >
        <Info className="h-3.5 w-3.5" aria-hidden="true" />
      </button>

      {open ? (
        <span
          id={id}
          role="tooltip"
          className={`absolute top-6 z-30 w-64 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-3 text-start shadow-[var(--shadow-overlay)] ${
            align === "end" ? "end-0" : "start-0"
          }`}
        >
          <span className="block text-[13px] font-bold text-[var(--text)]">{title}</span>
          {definition ? (
            <span className="mt-1.5 block text-xs leading-5 text-[var(--text-secondary)]">{definition}</span>
          ) : null}
          {formula ? (
            <span className="mt-2 block rounded-lg bg-[var(--surface-soft)] px-2 py-1.5 text-[11px] leading-4 text-[var(--text-tertiary)]">
              {formula}
            </span>
          ) : null}
          {extra ? <span className="mt-2 block text-[11px] leading-4 text-[var(--text-secondary)]">{extra}</span> : null}
        </span>
      ) : null}
    </span>
  );
}
