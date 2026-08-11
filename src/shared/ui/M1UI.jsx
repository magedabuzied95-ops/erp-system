import { forwardRef, useEffect, useId } from "react";
import { ChevronLeft, Inbox, LoaderCircle, Search, X } from "lucide-react";
import "./m1-ui.css";

// M1 canonical UI primitives.
//
// Rules for everything in this file:
//  - semantic tokens only. A primitive must never know the brand is currently
//    gold; it knows `primary`, `surface`, `danger`, and so on.
//  - native elements and native props. These are presentation primitives; they
//    do not own form state, validation or business logic.
//  - RTL by construction: logical properties (padding-inline, inset-inline,
//    text-align:start), never hardcoded left/right.
//  - forwardRef on anything a caller may need to focus or measure.

const cx = (...parts) => parts.filter(Boolean).join(" ");

/* ---------------------------------------------------------------- Button -- */

export const Button = forwardRef(function Button(
  {
    children,
    variant = "secondary",
    size = "md",
    icon: Icon,
    iconAfter: IconAfter,
    loading = false,
    disabled = false,
    type = "button",
    className = "",
    ...props
  },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      // A loading button must not be clickable, but it also must not vanish
      // from the tab order mid-interaction, so it stays focusable and announces
      // itself as busy.
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx("m1-button", `m1-button--${variant}`, `m1-button--${size}`, className)}
      {...props}
    >
      {loading ? <LoaderCircle className="m1-spin" size={16} aria-hidden="true" /> : Icon ? <Icon size={17} aria-hidden="true" /> : null}
      {children ? <span>{children}</span> : null}
      {IconAfter && !loading ? <IconAfter size={17} aria-hidden="true" /> : null}
    </button>
  );
});

export const IconButton = forwardRef(function IconButton(
  { icon: Icon, label, variant = "ghost", size = "md", disabled = false, type = "button", className = "", ...props },
  ref
) {
  // An icon-only control with no accessible name is invisible to screen
  // readers. Fail loudly in development rather than shipping it silently.
  if (import.meta.env?.DEV && !label && !props["aria-label"] && !props["aria-labelledby"]) {
    console.warn("[M1UI] IconButton requires a `label` (or aria-label) for its accessible name.");
  }
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cx("m1-icon-button", `m1-icon-button--${variant}`, `m1-icon-button--${size}`, className)}
      {...props}
    >
      {Icon ? <Icon size={17} aria-hidden="true" /> : null}
    </button>
  );
});

/* ------------------------------------------------------------ form controls */

// Shared wiring for the labelled controls below: it associates label, help text
// and error with the control, and exposes the invalid state to assistive tech.
const useControl = ({ id, invalid, error, hint }) => {
  const auto = useId();
  const controlId = id || auto;
  const helpId = error || hint ? `${controlId}-help` : undefined;
  return {
    controlId,
    helpId,
    controlProps: {
      id: controlId,
      "aria-invalid": invalid || Boolean(error) || undefined,
      "aria-describedby": helpId,
    },
  };
};

const ControlShell = ({ label, hint, error, invalid, controlId, helpId, className, children }) => (
  <div className={cx("m1-control", (invalid || error) && "m1-control--error", className)}>
    {label ? <label className="m1-control__label" htmlFor={controlId}>{label}</label> : null}
    {children}
    {error || hint ? <span className="m1-control__help" id={helpId}>{error || hint}</span> : null}
  </div>
);

export const Input = forwardRef(function Input(
  { label, hint, error, invalid, id, className = "", leading, trailing, ...props },
  ref
) {
  const { controlId, helpId, controlProps } = useControl({ id, invalid, error, hint });
  return (
    <ControlShell label={label} hint={hint} error={error} invalid={invalid} controlId={controlId} helpId={helpId} className={className}>
      <span className="m1-input">
        {leading ? <span className="m1-input__slot" aria-hidden="true">{leading}</span> : null}
        <input ref={ref} className="m1-input__control" {...controlProps} {...props} />
        {trailing ? <span className="m1-input__slot">{trailing}</span> : null}
      </span>
    </ControlShell>
  );
});

export const Textarea = forwardRef(function Textarea(
  { label, hint, error, invalid, id, rows = 4, className = "", ...props },
  ref
) {
  const { controlId, helpId, controlProps } = useControl({ id, invalid, error, hint });
  return (
    <ControlShell label={label} hint={hint} error={error} invalid={invalid} controlId={controlId} helpId={helpId} className={className}>
      <textarea ref={ref} rows={rows} className="m1-textarea" {...controlProps} {...props} />
    </ControlShell>
  );
});

export const Select = forwardRef(function Select(
  { label, hint, error, invalid, id, children, className = "", ...props },
  ref
) {
  // Native <select> on purpose: it gives correct keyboard behaviour, mobile
  // pickers and screen-reader support for free. No custom dropdown engine.
  const { controlId, helpId, controlProps } = useControl({ id, invalid, error, hint });
  return (
    <ControlShell label={label} hint={hint} error={error} invalid={invalid} controlId={controlId} helpId={helpId} className={className}>
      <select ref={ref} className="m1-select" {...controlProps} {...props}>{children}</select>
    </ControlShell>
  );
});

export const Checkbox = forwardRef(function Checkbox({ label, id, className = "", ...props }, ref) {
  const auto = useId();
  const controlId = id || auto;
  return (
    <div className={cx("m1-choice", className)}>
      <input ref={ref} id={controlId} type="checkbox" className="m1-choice__input" {...props} />
      {label ? <label className="m1-choice__label" htmlFor={controlId}>{label}</label> : null}
    </div>
  );
});

export const Radio = forwardRef(function Radio({ label, id, className = "", ...props }, ref) {
  const auto = useId();
  const controlId = id || auto;
  return (
    <div className={cx("m1-choice", className)}>
      <input ref={ref} id={controlId} type="radio" className="m1-choice__input" {...props} />
      {label ? <label className="m1-choice__label" htmlFor={controlId}>{label}</label> : null}
    </div>
  );
});

export const Switch = forwardRef(function Switch({ label, id, className = "", ...props }, ref) {
  // A real checkbox underneath, so it submits with forms and keeps native
  // keyboard behaviour; role="switch" gives it the right semantics.
  const auto = useId();
  const controlId = id || auto;
  return (
    <div className={cx("m1-switch", className)}>
      <input ref={ref} id={controlId} type="checkbox" role="switch" className="m1-switch__input" {...props} />
      <span className="m1-switch__track" aria-hidden="true"><span className="m1-switch__thumb" /></span>
      {label ? <label className="m1-switch__label" htmlFor={controlId}>{label}</label> : null}
    </div>
  );
});

export const SearchInput = forwardRef(function SearchInput(
  { onClear, value, clearLabel = "مسح البحث", ...props },
  ref
) {
  // Composes Input rather than restyling a second control.
  return (
    <Input
      ref={ref}
      type="search"
      value={value}
      leading={<Search size={16} />}
      trailing={onClear && value ? <IconButton icon={X} label={clearLabel} size="sm" onClick={onClear} /> : null}
      {...props}
    />
  );
});

/* ------------------------------------------------------------------- Field */

// Retained for backwards compatibility: ComponentsPreview and any future caller
// keep working. New code should use Input / Textarea / Select, which carry
// proper label + error associations.
export const Field = forwardRef(function Field(
  { label, hint, error, as = "input", className = "", children, ...props },
  ref
) {
  const Component = as;
  return (
    <label className={`m1-field ${error ? "m1-field--error" : ""} ${className}`.trim()}>
      {label ? <span className="m1-field__label">{label}</span> : null}
      <Component ref={ref} className="m1-field__control" {...props}>{children}</Component>
      {error || hint ? <span className="m1-field__help">{error || hint}</span> : null}
    </label>
  );
});

/* -------------------------------------------------------------------- Card */

export function Card({ title, subtitle, action, children, className = "" }) {
  return (
    <section className={`m1-card ${className}`.trim()}>
      {title || action ? (
        <header className="m1-card__header">
          <div><h2>{title}</h2>{subtitle ? <p>{subtitle}</p> : null}</div>
          {action}
        </header>
      ) : null}
      <div className="m1-card__body">{children}</div>
    </section>
  );
}

// Composable form, for cards that need more than title/subtitle/action.
export const CardHeader = ({ children, className = "" }) => <header className={cx("m1-card__header", className)}>{children}</header>;
export const CardTitle = ({ children, className = "" }) => <h2 className={cx("m1-card__title", className)}>{children}</h2>;
export const CardDescription = ({ children, className = "" }) => <p className={cx("m1-card__description", className)}>{children}</p>;
export const CardContent = ({ children, className = "" }) => <div className={cx("m1-card__body", className)}>{children}</div>;
export const CardFooter = ({ children, className = "" }) => <footer className={cx("m1-card__footer", className)}>{children}</footer>;

/* ------------------------------------------------------------------ Badge */

// Semantic only. Domain state (paid / cancelled / pending) is mapped to a
// variant by the calling page, so business meaning never leaks into the UI kit.
export function StatusBadge({ tone = "neutral", children, className = "" }) {
  // className APPENDS; the tone classes stay first so semantic colour remains
  // owned by the kit and a caller can only add to it, not silently replace it.
  return <span className={cx("m1-status", `m1-status--${tone}`, className)}><i aria-hidden="true" />{children}</span>;
}

export const Badge = StatusBadge;

export function MetricCard({ label, value, change, icon: Icon, tone = "neutral", className = "" }) {
  return (
    <article className={cx("m1-metric", `m1-metric--${tone}`, className)}>
      <div className="m1-metric__top"><span>{label}</span>{Icon ? <span className="m1-metric__icon"><Icon size={19} /></span> : null}</div>
      <strong>{value}</strong>
      {change ? <small>{change}</small> : null}
    </article>
  );
}

/* ------------------------------------------------- layout composition bits */

export function PageHeader({ title, description, breadcrumbs, actions, className = "" }) {
  return (
    <header className={cx("m1-page-header", className)}>
      {breadcrumbs ? <div className="m1-page-header__breadcrumbs">{breadcrumbs}</div> : null}
      <div className="m1-page-header__row">
        <div className="m1-page-header__titles">
          <h1 className="m1-page-header__title">{title}</h1>
          {description ? <p className="m1-page-header__description">{description}</p> : null}
        </div>
        {actions ? <div className="m1-page-header__actions">{actions}</div> : null}
      </div>
    </header>
  );
}

export const Toolbar = ({ children, className = "" }) => <div className={cx("m1-toolbar", className)} role="toolbar">{children}</div>;
export const ToolbarGroup = ({ children, className = "" }) => <div className={cx("m1-toolbar__group", className)}>{children}</div>;
export const ToolbarSpacer = () => <span className="m1-toolbar__spacer" aria-hidden="true" />;

export const FilterBar = ({ children, actions, className = "" }) => (
  <div className={cx("m1-filter-bar", className)}>
    <div className="m1-filter-bar__filters">{children}</div>
    {actions ? <div className="m1-filter-bar__actions">{actions}</div> : null}
  </div>
);

/* -------------------------------------------------------------------- Tabs */

// Presentation only: `value` and `onChange` are supplied by the caller, so the
// same primitive serves local state, URL routing or any external store. Routed
// tabs must never be converted to local state.
export function Tabs({ value, onChange, items = [], ariaLabel, className = "" }) {
  return (
    <div className={cx("m1-tabs", className)} role="tablist" aria-label={ariaLabel}>
      {items.map((item) => {
        const selected = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            id={`m1-tab-${item.value}`}
            aria-selected={selected}
            aria-controls={item.panelId}
            tabIndex={selected ? 0 : -1}
            disabled={item.disabled}
            onClick={() => onChange?.(item.value)}
            className={cx("m1-tab", selected && "m1-tab--active")}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

export const TabPanel = ({ id, tabValue, active, children }) => (
  <div id={id} role="tabpanel" aria-labelledby={`m1-tab-${tabValue}`} hidden={!active}>{active ? children : null}</div>
);

/* ------------------------------------------------------ overlays: dialog(s) */

// Closes on Escape. Focus trapping is deliberately NOT hand-rolled: a partial
// implementation is worse than none, and the platform gives us the important
// parts here. Revisit with <dialog> or a vetted helper if a workflow needs it.
const useEscapeToClose = (open, onClose) => {
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => { if (event.key === "Escape") onClose?.(); };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);
};

export function Modal({ open, title, description, children, footer, onClose, size = "md" }) {
  const titleId = useId();
  useEscapeToClose(open, onClose);
  if (!open) return null;
  return (
    <div className="m1-overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose?.()}>
      <section className={cx("m1-modal", `m1-modal--${size}`)} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header>
          <div><h2 id={titleId}>{title}</h2>{description ? <p>{description}</p> : null}</div>
          <button type="button" onClick={onClose} aria-label="إغلاق"><X size={19} /></button>
        </header>
        <div className="m1-modal__body">{children}</div>
        {footer ? <footer>{footer}</footer> : null}
      </section>
    </div>
  );
}

// `placement` uses logical directions so RTL is automatic: "end" is the right
// edge in LTR and the left edge in Arabic.
export function Drawer({ open, title, description, children, footer, onClose, placement = "end" }) {
  const titleId = useId();
  useEscapeToClose(open, onClose);
  if (!open) return null;
  return (
    <div className="m1-overlay m1-overlay--drawer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose?.()}>
      <section className={cx("m1-drawer", `m1-drawer--${placement}`)} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header>
          <div><h2 id={titleId}>{title}</h2>{description ? <p>{description}</p> : null}</div>
          <button type="button" onClick={onClose} aria-label="إغلاق"><X size={19} /></button>
        </header>
        <div className="m1-drawer__body">{children}</div>
        {footer ? <footer>{footer}</footer> : null}
      </section>
    </div>
  );
}

/* ------------------------------------------------------ FROZEN FOR PHASE 3 */
/* DataTable and Pagination are untouched: table unification is Phase 3.       */
/* Known issues recorded for that phase: 3 !important in .m1-table__empty and  */
/* references to --table-head / --table-hover which are not defined here.      */

export function DataTable({ columns, rows, rowKey = "id", emptyLabel = "لا توجد بيانات" }) {
  return (
    <div className="m1-table-wrap">
      <table className="m1-table">
        <thead><tr>{columns.map((column) => <th key={column.key}>{column.label}</th>)}</tr></thead>
        <tbody>
          {rows.length ? rows.map((row) => (
            <tr key={row[rowKey]}>{columns.map((column) => <td key={column.key}>{column.render ? column.render(row) : row[column.key]}</td>)}</tr>
          )) : <tr><td colSpan={columns.length} className="m1-table__empty">{emptyLabel}</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

export function Pagination({ page = 1, pages = 1, onChange }) {
  return <nav className="m1-pagination" aria-label="التنقل بين الصفحات"><span>صفحة {page} من {pages}</span><div><button disabled={page <= 1} onClick={() => onChange?.(page - 1)} aria-label="السابق"><ChevronLeft size={17} /></button><button disabled={page >= pages} onClick={() => onChange?.(page + 1)} aria-label="التالي"><ChevronLeft size={17} /></button></div></nav>;
}

/* --------------------------------------------------------- states, as-is -- */

export function EmptyState({ title = "لا توجد نتائج", description, action }) {
  return <div className="m1-empty"><span className="m1-empty__icon"><Inbox size={22} /></span><h3>{title}</h3>{description ? <p>{description}</p> : null}{action}</div>;
}

export function Skeleton({ className = "" }) { return <span className={`m1-skeleton ${className}`} aria-hidden="true" />; }

export function LoadingState({ label = "جاري التحميل..." }) {
  return <div className="m1-loading" role="status"><LoaderCircle className="m1-spin" size={19} />{label}</div>;
}
