import { useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { SlidersHorizontal } from "lucide-react";

import { MobileBottomSheet } from "../../../shared/components/mobile/ResponsiveMobile";
import "./catalogPhone.css";
import useIsPhone from "./useIsPhone";

/* Catalog phone filters (products / inventory / purchases / suppliers lists).

   At 375px these lists opened on a full screen of chrome: four or five
   full-width selects plus two date inputs stacked above the first row. On a
   phone the secondary filters move behind ONE button with an active-count
   badge that opens a bottom sheet; the search box stays on the page.

   At md and up `children` render in place with no wrapper element at all, so
   the desktop grid (xl:col-span-* on each child) is untouched. The sheet is
   portaled to <body>: iOS clips position:fixed inside a scrolling ancestor. */

export default function PhoneFilters({ activeCount = 0, onClear, children, className = "" }) {
  const { t } = useTranslation();
  const isPhone = useIsPhone();
  const [open, setOpen] = useState(false);

  if (!isPhone) return <>{children}</>;

  const label = t("common.filters", "Filters");
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`inline-flex h-11 min-w-0 shrink-0 items-center justify-center gap-2 rounded-[var(--radius-control)] border px-4 text-sm font-bold transition ${
          activeCount
            ? "border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--primary)]"
            : "border-[var(--border)] bg-[var(--surface)] text-[var(--text)]"
        } ${className}`}
      >
        <SlidersHorizontal className="h-4 w-4" />
        <span>{label}</span>
        {activeCount ? (
          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--primary)] px-1.5 text-[11px] font-black text-[var(--primary-contrast)]">
            {activeCount}
          </span>
        ) : null}
      </button>
      {typeof document === "undefined" ? null : createPortal(
      <MobileBottomSheet
        open={open}
        title={label}
        onClose={() => setOpen(false)}
        footer={
          <div className="flex gap-2">
            {onClear && activeCount ? (
              <button
                type="button"
                onClick={onClear}
                className="inline-flex h-11 flex-1 items-center justify-center rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] text-sm font-bold text-[var(--text)]"
              >
                {t("common.clear", "Clear")}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="inline-flex h-11 flex-1 items-center justify-center rounded-[var(--radius-control)] border border-[var(--primary)] bg-[var(--primary)] text-sm font-bold text-[var(--primary-contrast)]"
            >
              {t("common.done", "Done")}
            </button>
          </div>
        }
      >
        <div className="m1-phone-filters grid grid-cols-1 gap-3">{children}</div>
      </MobileBottomSheet>,
      document.body
      )}
    </>
  );
}
