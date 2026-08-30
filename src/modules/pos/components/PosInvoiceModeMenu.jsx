import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, ReceiptText, Truck } from "lucide-react";

const MENU_MIN_WIDTH = 208;
const MENU_GAP = 6;
const VIEWPORT_MARGIN = 8;

/**
 * Invoice-type picker for the POS toolbar.
 *
 * A native <select> was tried here first and looked wrong: Windows draws the option list as a
 * bare OS rectangle that ignores the POS theme entirely. Options cannot be styled beyond their
 * own background and colour, so the list is drawn here instead.
 *
 * It portals rather than nesting, because the toolbar row is `overflow-x-hidden` inside an
 * `overflow-hidden` shell — an absolutely positioned panel would be clipped or would grow a
 * scrollbar. The target follows `document.fullscreenElement` since the till often runs
 * fullscreen, where a body-mounted panel renders behind the fullscreen element.
 */
export default function PosInvoiceModeMenu({
  value = "counter",
  onChange,
  label = "Invoice type",
  counterLabel = "Counter invoice",
  onlineLabel = "Online order",
  blockedReason = "",
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const isOnline = value === "online";

  const measure = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.max(rect.width, MENU_MIN_WIDTH);
    const maxLeft = window.innerWidth - width - VIEWPORT_MARGIN;
    setPosition({
      top: rect.bottom + MENU_GAP,
      left: Math.max(VIEWPORT_MARGIN, Math.min(rect.left, maxLeft)),
      width,
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) return undefined;
    measure();
    // The toolbar scrolls with the page on short screens, so a menu pinned at open time would
    // drift away from its button.
    const onViewportChange = () => measure();
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);
    return () => {
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
    };
  }, [open, measure]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (triggerRef.current?.contains(event.target)) return;
      if (menuRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const options = [
    { key: "counter", label: counterLabel, icon: <ReceiptText className="h-4 w-4 shrink-0" />, blocked: "" },
    { key: "online", label: onlineLabel, icon: <Truck className="h-4 w-4 shrink-0" />, blocked: blockedReason },
  ];

  const select = (option) => {
    if (option.blocked) return;
    setOpen(false);
    if (option.key !== value) onChange?.(option.key);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        title={blockedReason || label}
        onClick={() => setOpen((current) => !current)}
        className={`pos-toolbar-action pos-action-invoice-mode inline-flex h-[var(--control-height-md)] shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-black shadow-[0_0_18px_rgba(0,0,0,0.18)] transition ${
          isOnline
            ? "border-sky-300/45 bg-sky-400/15 text-sky-50 hover:bg-sky-400/25"
            : "border-emerald-300/35 bg-emerald-400/10 text-emerald-50 hover:bg-emerald-400/20"
        }`}
      >
        {isOnline ? <Truck className="h-4 w-4 shrink-0" /> : <ReceiptText className="h-4 w-4 shrink-0" />}
        <span className="whitespace-nowrap">{isOnline ? onlineLabel : counterLabel}</span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 opacity-70 transition ${open ? "rotate-180" : ""}`} />
      </button>

      {open && position && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={menuRef}
              role="listbox"
              aria-label={label}
              style={{ position: "fixed", top: position.top, left: position.left, width: position.width }}
              className="z-[90] overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-1 shadow-[0_24px_60px_rgba(0,0,0,0.55)] backdrop-blur"
            >
              {options.map((option) => {
                const active = option.key === value;
                return (
                  <button
                    key={option.key}
                    type="button"
                    role="option"
                    aria-selected={active}
                    disabled={Boolean(option.blocked)}
                    title={option.blocked || undefined}
                    onClick={() => select(option)}
                    className={`flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-start text-xs font-black transition disabled:cursor-not-allowed ${
                      option.blocked
                        ? "text-[var(--muted)] opacity-60"
                        : active
                          ? option.key === "online"
                            ? "bg-sky-400/20 text-sky-100"
                            : "bg-emerald-400/15 text-emerald-100"
                          : "text-[var(--text)] hover:bg-white/[0.07]"
                    }`}
                  >
                    {option.icon}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{option.label}</span>
                      {/* The blocked option stays listed with its reason rather than vanishing —
                          an option that disappears reads as a bug, not as an explanation. */}
                      {option.blocked ? (
                        <span className="mt-0.5 block truncate text-[10px] font-bold text-[var(--muted)]">{option.blocked}</span>
                      ) : null}
                    </span>
                    {active ? <Check className="h-3.5 w-3.5 shrink-0" /> : null}
                  </button>
                );
              })}
            </div>,
            document.fullscreenElement || document.body
          )
        : null}
    </>
  );
}
