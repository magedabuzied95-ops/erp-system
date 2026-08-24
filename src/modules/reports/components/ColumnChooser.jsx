import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Columns3, Check } from "lucide-react";

/**
 * Hide columns you do not need — B-4 of the retirement assessment.
 *
 * The list it offers is the columns the SERVER sent. A column the reader's permissions
 * withheld was never in the payload, so it is not in this menu and cannot be turned on:
 * hiding is a preference, showing is a permission, and they are resolved in that order.
 * That is why this component takes `choosable` rather than a full column spec — there is
 * no code path here that could reveal something.
 *
 * Direction-aware by construction: the menu anchors with logical properties, so it opens
 * on the correct side in Arabic without a second layout.
 */
export default function ColumnChooser({ choosable = [], hidden = [], hiddenCount = 0, onToggle, onReset }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (!containerRef.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  if (!choosable.length) return null;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="true"
        className="inline-flex h-[var(--control-height-sm)] items-center gap-1.5 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--card)] px-2.5 text-[12px] font-semibold text-[var(--text)] transition hover:border-[var(--border-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
      >
        <Columns3 className="h-3.5 w-3.5" aria-hidden="true" />
        {t("overview.filters.columns")}
        {hiddenCount ? (
          <span className="rounded-full bg-[var(--bg)] px-1.5 text-[10px] font-bold text-[var(--text-secondary)]">
            {t("overview.filters.columnsHidden", { hidden: hiddenCount })}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          role="menu"
          /*
           * `end-0` rather than `right-0`: in Arabic the menu must hang off the other edge,
           * and a logical property does that without a mirrored stylesheet. max-h + scroll
           * so a wide table's column list stays usable on a phone.
           */
          className="absolute end-0 z-30 mt-1 max-h-[60vh] w-[15rem] overflow-y-auto rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] p-1.5 shadow-lg"
        >
          {choosable.map((column) => {
            const isHidden = hidden.includes(column.key);
            return (
              <button
                key={column.key}
                type="button"
                role="menuitemcheckbox"
                aria-checked={!isHidden}
                onClick={() => onToggle(column.key)}
                className="flex w-full items-center gap-2 rounded-[var(--radius-control)] px-2 py-1.5 text-start text-[12px] text-[var(--text)] transition hover:bg-[var(--bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
              >
                <span
                  aria-hidden="true"
                  className={`grid h-3.5 w-3.5 shrink-0 place-items-center rounded-[3px] border ${
                    isHidden ? "border-[var(--border)]" : "border-[var(--accent,var(--text))] bg-[var(--accent,var(--text))]"
                  }`}
                >
                  {isHidden ? null : <Check className="h-2.5 w-2.5 text-[var(--card)]" />}
                </span>
                <span className="min-w-0 flex-1 truncate">{column.label}</span>
              </button>
            );
          })}

          {hiddenCount ? (
            <button
              type="button"
              onClick={onReset}
              className="mt-1 w-full rounded-[var(--radius-control)] border-t border-[var(--border)] px-2 py-1.5 text-start text-[12px] font-semibold text-[var(--text-secondary)] transition hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
            >
              {t("overview.filters.columnsReset")}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
