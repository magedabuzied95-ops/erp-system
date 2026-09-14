/**
 * One-page checkout — presentation pieces.
 *
 * Pure presentation: every value and handler comes from CheckoutPage in
 * ../Storefront.jsx, which still owns the form state, the Bosta cascade, the
 * saved-address restore, coupons, payment modes and the order request. Styles
 * live in ./checkout.css and read only homepage tokens; headings and the order
 * button also carry the site primitives (sfx-h2, sfx-btn) from ../site-skin.css.
 */

import { memo, useDeferredValue, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Loader2, Search, X } from "lucide-react";

import useDismissableLayer from "../../shared/hooks/useDismissableLayer";
import { VirtualList } from "../../shared/components/VirtualList";
import { normalizeCheckoutPickerText } from "../../shared/lib/shippingCheckout";
import "./checkout.css";

export function CheckoutBlock({ id, title, note, action = null, children }) {
  return (
    <section className="sfc-section" id={id} aria-labelledby={id ? `${id}-title` : undefined}>
      <div className="sfc-section__head">
        <h2 className="sfc-h2 sfx-h2" id={id ? `${id}-title` : undefined}>{title}</h2>
        {action}
      </div>
      {note ? <p className="sfc-note">{note}</p> : null}
      {children}
    </section>
  );
}

/** A text input whose label sits inside the box and lifts once there is a value. */
export function CheckoutInput({
  label,
  value,
  onChange,
  required = false,
  error = "",
  hint = "",
  name,
  type = "text",
  inputMode,
  autoComplete,
  dir,
  multiline = false,
  maxLength,
  onEnter,
}) {
  const id = useId();
  const Tag = multiline ? "textarea" : "input";
  return (
    <div className={`sfc-field${error ? " sfc-field--error" : ""}`} data-field={name}>
      <Tag
        id={id}
        name={name}
        type={multiline ? undefined : type}
        inputMode={inputMode}
        autoComplete={autoComplete}
        dir={dir}
        rows={multiline ? 3 : undefined}
        maxLength={maxLength}
        className={`sfc-input${multiline ? " sfc-textarea" : ""}`}
        placeholder=" "
        value={value ?? ""}
        required={required}
        aria-invalid={error ? "true" : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(event) => onChange(event.target.value)}
        // A field with its own action (the discount code) must not submit the order on Enter.
        onKeyDown={onEnter ? (event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          onEnter();
        } : undefined}
      />
      <label htmlFor={id} className="sfc-label">
        {label}
      </label>
      {error ? (
        <span id={`${id}-error`} className="sfc-error" role="alert">
          {error}
        </span>
      ) : hint ? (
        <span className="sfc-hint">{hint}</span>
      ) : null}
    </div>
  );
}

export function CheckoutNativeSelect({ label, value, onChange, options = [], name, error = "" }) {
  const id = useId();
  return (
    <div className={`sfc-field${error ? " sfc-field--error" : ""}`} data-field={name}>
      <select
        id={id}
        name={name}
        className="sfc-input sfc-native-select"
        value={value}
        aria-invalid={error ? "true" : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <label htmlFor={id} className="sfc-label sfc-label--pinned">
        {label}
      </label>
      <ChevronDown className="sfc-field__icon" size={16} aria-hidden="true" />
      {error ? (
        <span id={`${id}-error`} className="sfc-error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}

function useIsNarrowViewport() {
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(max-width: 767px)").matches);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined;
    const media = window.matchMedia("(max-width: 767px)");
    const update = () => setNarrow(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);
  return narrow;
}

/**
 * The searchable picker for the Bosta governorate → zone → district cascade.
 * A dropdown under the field on wide screens, a bottom sheet on phones (the
 * list is long and the keyboard needs the room).
 */
export const CheckoutLocationSelect = memo(function CheckoutLocationSelect({
  label,
  name,
  value,
  onChange,
  options = [],
  loading = false,
  disabled = false,
  error = "",
  placeholder = "",
  searchPlaceholder = "",
  emptyText = "",
  loadingText = "",
  closeLabel = "",
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef(null);
  const searchRef = useRef(null);
  const triggerRef = useRef(null);
  const narrow = useIsNarrowViewport();
  const selected = useMemo(() => options.find((option) => String(option.id) === String(value)) || null, [options, value]);
  const deferredQuery = useDeferredValue(query);
  const filtered = useMemo(() => {
    const search = normalizeCheckoutPickerText(deferredQuery);
    return search ? options.filter((option) => option.searchText.includes(search)) : options;
  }, [deferredQuery, options]);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const frame = window.requestAnimationFrame(() => searchRef.current?.focus({ preventScroll: true }));
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  // Lock the page behind the phone sheet so the list scrolls, not the checkout.
  useEffect(() => {
    if (!open || !narrow || typeof document === "undefined") return undefined;
    const { body } = document;
    const scrollY = window.scrollY || 0;
    const previous = { position: body.style.position, top: body.style.top, width: body.style.width, overflow: body.style.overflow };
    Object.assign(body.style, { position: "fixed", top: `-${scrollY}px`, width: "100%", overflow: "hidden" });
    return () => {
      Object.assign(body.style, previous);
      window.scrollTo(0, scrollY);
    };
  }, [narrow, open]);

  // Closing unmounts the focused search box or option, which drops focus on <body>
  // and sends the next Tab to the top of the page. Keyboard-driven closes hand it
  // back to the trigger; a pointer press elsewhere keeps wherever the shopper went.
  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) window.requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }));
  };

  useDismissableLayer({ enabled: open && !narrow, refs: [containerRef], onDismiss: (event) => close(event?.type === "keydown") });

  const choose = (option) => {
    if (!option || disabled) return;
    onChange(option.id);
    close();
  };

  const list = loading ? (
    <div className="sfc-picker-empty">
      <Loader2 size={16} className="animate-spin" aria-hidden="true" />
      {loadingText}
    </div>
  ) : filtered.length ? (
    <VirtualList
      items={filtered}
      estimateSize={46}
      className="sfc-picker-list"
      itemKey={(option) => option.id}
      renderItem={(option) => {
        const isSelected = String(option.id) === String(value);
        return (
          <button type="button" className={`sfc-option${isSelected ? " is-selected" : ""}`} onClick={() => choose(option)} role="option" aria-selected={isSelected}>
            <span className="sfc-option__text">
              <span className="sfc-option__label">{option.label}</span>
              {option.secondary ? <span className="sfc-option__secondary">{option.secondary}</span> : null}
            </span>
            {isSelected ? <Check size={16} className="sfc-option__check" aria-hidden="true" /> : null}
          </button>
        );
      }}
    />
  ) : (
    <div className="sfc-picker-empty">{emptyText}</div>
  );

  const search = (
    <label className="sfc-picker-search">
      <Search size={16} aria-hidden="true" />
      <input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={searchPlaceholder} aria-label={searchPlaceholder} />
      {query ? (
        <button type="button" className="sfc-icon-btn" style={{ width: 28, height: 28 }} onClick={() => setQuery("")} aria-label={closeLabel}>
          <X size={14} />
        </button>
      ) : null}
    </label>
  );

  const hasValue = Boolean(selected);
  return (
    <div ref={containerRef} className={`sfc-field${error ? " sfc-field--error" : ""}`} data-field={name}>
      <button
        ref={triggerRef}
        type="button"
        className={`sfc-select${hasValue ? "" : " is-empty"}`}
        onClick={() => !disabled && setOpen((current) => !current)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="sfc-select__label">{hasValue ? label : loading ? loadingText : placeholder || label}</span>
        {hasValue ? <span className="sfc-select__value">{selected.label}</span> : null}
        {loading ? <Loader2 size={16} className="sfc-select__icon animate-spin" aria-hidden="true" /> : <ChevronDown size={16} className="sfc-select__icon" aria-hidden="true" />}
      </button>
      {error ? <span className="sfc-error" role="alert">{error}</span> : null}
      {open && !narrow ? (
        <div className="sfc-picker-panel" role="listbox" aria-label={label}>
          {search}
          {list}
        </div>
      ) : null}
      {open && narrow && typeof document !== "undefined"
        ? createPortal(
            <div className="sfc-sheet-backdrop" role="presentation" onClick={() => close()}>
              <section
                className="sfc-sheet"
                role="dialog"
                aria-modal="true"
                aria-label={label}
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => {
                  if (event.key === "Escape") close();
                }}
                dir={document.documentElement.dir || undefined}
              >
                <div className="sfc-sheet__head">
                  <span className="sfx-drawer__title">{label}</span>
                  <button type="button" className="sfc-icon-btn" onClick={() => close()} aria-label={closeLabel}>
                    <X size={16} />
                  </button>
                </div>
                {search}
                <div role="listbox" style={{ display: "flex", minHeight: 0, flex: 1, flexDirection: "column" }}>
                  {list}
                </div>
              </section>
            </div>,
            document.body
          )
        : null}
    </div>
  );
});

/**
 * One row of a radio group drawn as a bordered list (shipping method, payment).
 * `children` is the panel that opens under the chosen row.
 */
export function CheckoutChoice({ active, onSelect, title, subtitle, meta = null, children = null, static: isStatic = false }) {
  const Head = isStatic ? "div" : "button";
  return (
    <div className={`sfc-choice${active ? " is-active" : ""}`}>
      <Head
        {...(isStatic ? {} : { type: "button", onClick: onSelect, role: "radio", "aria-checked": Boolean(active) })}
        className="sfc-choice__head"
      >
        <span className="sfc-radio" aria-hidden="true" />
        <span className="sfc-choice__text">
          <span className="sfc-choice__title">{title}</span>
          {subtitle ? <span className="sfc-choice__sub">{subtitle}</span> : null}
        </span>
        {meta}
      </Head>
      {active && children ? <div className="sfc-choice__body">{children}</div> : null}
    </div>
  );
}

export function CheckoutSubmit({ submitting, disabled, label, busyLabel }) {
  return (
    <button form="storefront-checkout-form" type="submit" className="sfc-btn-primary sfx-btn sfx-btn--primary sfx-btn--lg sfx-btn--block" disabled={disabled}>
      {submitting ? <span className="sfc-spinner" aria-hidden="true" /> : null}
      <span>{submitting ? busyLabel : label}</span>
    </button>
  );
}
