import { useEffect, useState } from "react";
import { SlidersHorizontal } from "lucide-react";

import { MobileBottomSheet } from "../../../shared/components/mobile/ResponsiveMobile";

const PHONE_QUERY = "(max-width: 767px)";

const readPhone = () =>
  typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(PHONE_QUERY).matches;

/** True below md (768px). Follows rotation / window resizes. */
export function usePhoneLayout() {
  const [isPhone, setIsPhone] = useState(readPhone);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined;
    const query = window.matchMedia(PHONE_QUERY);
    const update = () => setIsPhone(query.matches);
    update();
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);
  return isPhone;
}

/**
 * Filters that sit inline on tablet/desktop and fold behind one button on a phone, so the
 * first screen shows data instead of a stack of inputs.
 *
 * - `md` and up: renders `children` exactly as before (no wrapper element).
 * - below `md`: one full-width button (label + active-count badge) that opens a
 *   MobileBottomSheet holding the same controls.
 *
 * `children` may be a function receiving `{ close }`, for filters applied by a button.
 * A form submitted inside the sheet closes it.
 */
export default function PhoneFilterSheet({ label, activeCount = 0, children, className = "" }) {
  const isPhone = usePhoneLayout();
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const content = typeof children === "function" ? children({ close }) : children;

  if (!isPhone) return content;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--card)] px-4 text-sm font-bold text-[var(--text)] ${className}`}
      >
        <SlidersHorizontal className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="truncate">{label}</span>
        {activeCount ? (
          <span className="grid h-5 min-w-5 place-items-center rounded-full bg-[var(--primary)] px-1.5 text-[11px] font-black text-[var(--primary-contrast,#fff)]">
            {activeCount}
          </span>
        ) : null}
      </button>
      <MobileBottomSheet open={open} title={label} onClose={close}>
        <div onSubmit={close} className="space-y-3">
          {content}
        </div>
      </MobileBottomSheet>
    </>
  );
}
