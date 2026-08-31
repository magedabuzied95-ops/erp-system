import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

import { collectAncestorZIndexes, resolveMenuZIndex } from "./selectMenuLayer";

const MENU_GAP = 6;
const VIEWPORT_MARGIN = 8;
const MENU_MAX_HEIGHT = 320;

/**
 * One dropdown for the whole app.
 *
 * A native <select> cannot be themed past the closed control: the option list is drawn by the
 * operating system, so on this dark ERP it opens as a flat foreign rectangle with no radius, no
 * spacing and no tokens. That mismatch is what made the POS invoice-type picker look broken.
 *
 * The list is therefore drawn here — but only where drawing it is an improvement. On a coarse
 * pointer (phones, the tills' touch screens) the native control is deliberately kept: it hands
 * back the OS wheel picker, which beats any custom list on touch, and it is what the design
 * system's Select was written for. So the rule is: native where native is better, drawn where
 * the OS list looks foreign.
 *
 * The drawn list portals into `document.fullscreenElement || document.body` and positions itself
 * fixed from the trigger's rect, because callers sit inside `overflow-hidden` shells (the POS
 * toolbar, table cells, drawers) that would otherwise clip it — and the POS runs fullscreen,
 * where a body-mounted panel hides behind the fullscreen element. Leaving the caller's DOM
 * position behind costs the menu the caller's layer too, so it re-derives its z-index from the
 * trigger's ancestors on every open — see `selectMenuLayer.js`.
 */

const usePointerIsCoarse = () => {
  const [coarse, setCoarse] = useState(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia("(pointer: coarse)").matches;
  });
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return undefined;
    const query = window.matchMedia("(pointer: coarse)");
    const onChange = (event) => setCoarse(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return coarse;
};

const normalizeOptions = (options = []) =>
  options.map((option) => (
    typeof option === "string" || typeof option === "number"
      ? { value: String(option), label: String(option) }
      : { ...option, value: String(option.value ?? ""), label: option.label ?? String(option.value ?? "") }
  ));

export default function ThemedSelect({
  value,
  onChange,
  options = [],
  placeholder = "",
  disabled = false,
  ariaLabel = "",
  id,
  name,
  className = "",
  triggerClassName = "",
  menuClassName = "",
  renderValue,
  // Escape hatch for the rare caller that must have the OS picker (a very long list, say).
  forceNative = false,
}) {
  const generatedId = useId();
  const controlId = id || generatedId;
  const coarsePointer = usePointerIsCoarse();
  const items = useMemo(() => normalizeOptions(options), [options]);
  const selected = items.find((option) => option.value === String(value ?? "")) || null;

  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [position, setPosition] = useState(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);

  const firstEnabled = useCallback(
    (from = 0, step = 1) => {
      for (let i = from; i >= 0 && i < items.length; i += step) {
        if (!items[i].disabled) return i;
      }
      return -1;
    },
    [items]
  );

  const measure = useCallback(() => {
    const trigger = triggerRef.current;
    const rect = trigger?.getBoundingClientRect();
    if (!rect) return;
    const width = rect.width;
    const below = window.innerHeight - rect.bottom - MENU_GAP - VIEWPORT_MARGIN;
    const above = rect.top - MENU_GAP - VIEWPORT_MARGIN;
    // Flip above the trigger when the space under it cannot hold a usable list.
    const dropUp = below < Math.min(MENU_MAX_HEIGHT, 160) && above > below;
    setPosition({
      top: dropUp ? undefined : rect.bottom + MENU_GAP,
      bottom: dropUp ? window.innerHeight - rect.top + MENU_GAP : undefined,
      left: Math.max(VIEWPORT_MARGIN, Math.min(rect.left, window.innerWidth - width - VIEWPORT_MARGIN)),
      width,
      maxHeight: Math.max(120, Math.min(MENU_MAX_HEIGHT, dropUp ? above : below)),
      // Measured on open rather than at mount: the same select is opened both on a bare page and
      // inside a dialog that did not exist when it rendered.
      zIndex: resolveMenuZIndex(collectAncestorZIndexes(trigger, (node) => window.getComputedStyle(node).zIndex)),
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) return undefined;
    measure();
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
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const index = items.findIndex((option) => option.value === String(value ?? ""));
    setActiveIndex(index >= 0 && !items[index].disabled ? index : firstEnabled(0, 1));
  }, [open, items, value, firstEnabled]);

  useEffect(() => {
    if (!open || activeIndex < 0) return;
    menuRef.current?.querySelector(`[data-index="${activeIndex}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);

  const commit = (option) => {
    if (!option || option.disabled) return;
    setOpen(false);
    triggerRef.current?.focus();
    if (option.value !== String(value ?? "")) onChange?.(option.value, option);
  };

  const onTriggerKeyDown = (event) => {
    if (disabled) return;
    if (!open && ["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
      event.preventDefault();
      setOpen(true);
      return;
    }
    if (!open) return;
    if (event.key === "Escape" || event.key === "Tab") {
      setOpen(false);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      const next = firstEnabled(activeIndex + step, step);
      if (next >= 0) setActiveIndex(next);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(firstEnabled(0, 1));
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(firstEnabled(items.length - 1, -1));
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      commit(items[activeIndex]);
    }
  };

  // Appearance is either the caller's or ours, never both. Tailwind resolves conflicts by CSS
  // source order, not by the order classes appear in the attribute, so concatenating a caller's
  // `bg-white/5` onto our `bg-[var(--surface-soft)]` would leave which one wins to chance —
  // and the page would silently stop looking like itself.
  const triggerClasses = [
    "m1-themed-select__trigger inline-flex items-center justify-between gap-2 outline-none transition disabled:cursor-not-allowed disabled:opacity-50",
    triggerClassName
      || "h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] px-3 text-sm font-semibold text-[var(--text)] focus:border-[var(--primary)]",
  ].filter(Boolean).join(" ");

  // Touch devices keep the OS picker: it is genuinely the better control there, and it is what
  // the design system's native Select was chosen for in the first place.
  if (coarsePointer || forceNative) {
    return (
      <div className={`m1-themed-select ${className}`.trim()}>
        <select
          id={controlId}
          name={name}
          value={String(value ?? "")}
          disabled={disabled}
          aria-label={ariaLabel || undefined}
          onChange={(event) => {
            const option = items.find((item) => item.value === event.target.value);
            onChange?.(event.target.value, option || null);
          }}
          className={triggerClasses}
        >
          {placeholder ? <option value="">{placeholder}</option> : null}
          {items.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    );
  }

  return (
    <div className={`m1-themed-select relative ${className}`.trim()}>
      <button
        ref={triggerRef}
        id={controlId}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${controlId}-listbox`}
        aria-label={ariaLabel || undefined}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={onTriggerKeyDown}
        className={triggerClasses}
      >
        <span className="min-w-0 flex-1 truncate text-start">
          {renderValue ? renderValue(selected) : (selected?.label ?? <span className="text-[var(--muted)]">{placeholder}</span>)}
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-[var(--muted)] transition ${open ? "rotate-180" : ""}`} />
      </button>

      {open && position && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={menuRef}
              id={`${controlId}-listbox`}
              role="listbox"
              aria-label={ariaLabel || undefined}
              aria-activedescendant={activeIndex >= 0 ? `${controlId}-option-${activeIndex}` : undefined}
              style={{
                position: "fixed",
                top: position.top,
                bottom: position.bottom,
                left: position.left,
                width: position.width,
                maxHeight: position.maxHeight,
                zIndex: position.zIndex,
              }}
              className={`overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-1 shadow-[0_24px_60px_rgba(0,0,0,0.45)] ${menuClassName}`.trim()}
            >
              {items.length === 0 ? (
                <div className="px-3 py-2 text-xs font-bold text-[var(--muted)]">{placeholder}</div>
              ) : null}
              {items.map((option, index) => {
                const isSelected = option.value === String(value ?? "");
                const isActive = index === activeIndex;
                return (
                  <button
                    key={option.value}
                    id={`${controlId}-option-${index}`}
                    data-index={index}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    disabled={option.disabled}
                    onMouseEnter={() => !option.disabled && setActiveIndex(index)}
                    onClick={() => commit(option)}
                    className={`flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-start text-sm font-semibold transition disabled:cursor-not-allowed ${
                      option.disabled
                        ? "text-[var(--muted)] opacity-60"
                        : isSelected
                          ? "bg-[var(--primary-soft)] text-[var(--primary)]"
                          : isActive
                            ? "bg-white/[0.07] text-[var(--text)]"
                            : "text-[var(--text)]"
                    }`}
                  >
                    {option.icon ? <span className="shrink-0">{option.icon}</span> : null}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{option.label}</span>
                      {/* A disabled row keeps its reason rather than vanishing — an option that
                          disappears reads as a bug, not as an explanation. */}
                      {option.hint ? (
                        <span className="mt-0.5 block truncate text-[10px] font-bold text-[var(--muted)]">{option.hint}</span>
                      ) : null}
                    </span>
                    {isSelected ? <Check className="h-4 w-4 shrink-0" /> : null}
                  </button>
                );
              })}
            </div>,
            document.fullscreenElement || document.body
          )
        : null}
    </div>
  );
}
