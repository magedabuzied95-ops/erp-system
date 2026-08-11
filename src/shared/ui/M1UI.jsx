// Union of both sides: `useEffect`/`useId`/`Search` come from the Phase 2A
// primitives, `ChevronRight` from the recovered Pagination (RTL "previous").
import { forwardRef, useEffect, useId } from "react";
import { ChevronLeft, ChevronRight, Inbox, LoaderCircle, Search, X } from "lucide-react";
import "./m1-ui.css";
import "./m1-table.css";

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

// `density` is an explicit per-instance decision, NOT derived from the theme.
// The global .theme-density-compact class governs control heights (a user
// preference); whether a given dashboard tile is compact is a layout choice the
// page makes. Keeping them separate stops the two systems fighting. Default
// stays "comfortable" so every existing consumer renders byte-identically.
//
// `supporting` is a generic ReactNode slot with no business meaning: no trend,
// no positive/negative colouring. A domain component derives its own content and
// may pass a styled node. `change` is untouched and keeps its existing
// treatment; the two can coexist.
export function MetricCard({ label, value, change, icon: Icon, tone = "neutral", density = "comfortable", supporting, className = "" }) {
  const densityClass = density === "compact" ? "m1-metric--compact" : "m1-metric--comfortable";
  return (
    <article className={cx("m1-metric", densityClass, `m1-metric--${tone}`, className)}>
      <div className="m1-metric__top"><span>{label}</span>{Icon ? <span className="m1-metric__icon"><Icon size={density === "compact" ? 16 : 19} /></span> : null}</div>
      <strong>{value}</strong>
      {change ? <small>{change}</small> : null}
      {supporting ? <div className="m1-metric__supporting">{supporting}</div> : null}
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

/* ========================================================================== */
/* CANONICAL TABLE SYSTEM                                                      */
/*                                                                             */
/* Two ways in, one visual result:                                             */
/*                                                                             */
/*   DataTable            — column config, for tables whose rows really are     */
/*                          rows of data.                                      */
/*   Table / TableRow /   — presentational primitives emitting the same        */
/*   TableCell / …          classes, for tables whose existing JSX cannot be   */
/*                          expressed as a column array without rewriting the  */
/*                          data model: grouped ledgers, colspan totals,       */
/*                          per-row editors.                                   */
/*                                                                             */
/* The visual truth lives in m1-table.css, so a plain <table className="m1-    */
/* table"> is equally canonical. That is what makes broad migration possible   */
/* without touching any query, handler or calculation.                         */
/*                                                                             */
/* Re-audit of the two historical defects (both real, both now gone):          */
/*   - `.m1-table__empty` carried 3 !important. Removed; the canonical rule    */
/*     wins on specificity instead.                                           */
/*   - `--table-head` / `--table-hover` were recorded as possibly undefined.   */
/*     They ARE defined in themes.js for both themes — that note was stale.    */
/*     `--table-selected` genuinely did not exist and has been added.          */
/* ========================================================================== */

const tableClass = (density, extra) =>
  ["m1-table", density === "compact" ? "m1-table--compact" : null, extra].filter(Boolean).join(" ");

export function TableContainer({ plain = false, className = "", children, ...rest }) {
  return (
    <div className={["m1-table-container", plain ? "m1-table-container--plain" : null, className].filter(Boolean).join(" ")} {...rest}>
      {children}
    </div>
  );
}

export function Table({ density = "comfortable", separate = false, sticky = false, interactive = false, wide = false, nowrap = false, className = "", children, ...rest }) {
  const modifiers = [
    separate ? "m1-table--separate" : null,
    sticky ? "m1-table--sticky" : null,
    interactive ? "m1-table--interactive" : null,
    wide ? "m1-table--wide" : null,
    nowrap ? "m1-table--nowrap" : null,
    className,
  ].filter(Boolean).join(" ");
  return <table className={tableClass(density, modifiers)} {...rest}>{children}</table>;
}

export function TableHead({ children, ...rest }) {
  return <thead {...rest}>{children}</thead>;
}

export function TableBody({ children, ...rest }) {
  return <tbody {...rest}>{children}</tbody>;
}

export function TableFoot({ children, ...rest }) {
  return <tfoot {...rest}>{children}</tfoot>;
}

export function TableRow({ selected, className = "", children, ...rest }) {
  // data-selected rather than a class, so a call site drives it straight from
  // its own selection state without composing class strings.
  return (
    <tr className={className || undefined} data-selected={selected ? "true" : undefined} {...rest}>
      {children}
    </tr>
  );
}

export function TableHeaderCell({ numeric = false, className = "", children, ...rest }) {
  return (
    <th scope="col" className={[numeric ? "m1-table__cell--numeric" : null, className].filter(Boolean).join(" ") || undefined} {...rest}>
      {children}
    </th>
  );
}

export function TableCell({ numeric = false, actions = false, className = "", children, ...rest }) {
  const modifiers = [
    numeric ? "m1-table__cell--numeric" : null,
    actions ? "m1-table__cell--actions" : null,
    className,
  ].filter(Boolean).join(" ");
  return <td className={modifiers || undefined} {...rest}>{children}</td>;
}

export function TableActions({ className = "", children }) {
  return <div className={["m1-table__actions", className].filter(Boolean).join(" ")}>{children}</div>;
}

export function DataTable({
  columns,
  rows,
  rowKey = "id",
  density = "comfortable",
  loading = false,
  sticky = false,
  wide = false,
  selectedKey,
  isRowSelected,
  onRowClick,
  className = "",
  emptyLabel = "لا توجد بيانات",
  loadingLabel = "جاري التحميل",
}) {
  const list = rows ?? [];
  const keyOf = (row, index) => (typeof rowKey === "function" ? rowKey(row, index) : row[rowKey] ?? index);
  const selected = (row, index) => {
    if (isRowSelected) return Boolean(isRowSelected(row, index));
    return selectedKey !== undefined && keyOf(row, index) === selectedKey;
  };

  return (
    <TableContainer>
      <Table density={density} sticky={sticky} wide={wide} interactive={Boolean(onRowClick)} className={className}>
        <TableHead>
          <tr>
            {columns.map((column) => (
              <TableHeaderCell key={column.key} numeric={column.numeric} style={column.width ? { width: column.width } : undefined}>
                {column.label}
              </TableHeaderCell>
            ))}
          </tr>
        </TableHead>
        <TableBody>
          {loading ? (
            <tr>
              <td colSpan={columns.length} className="m1-table__loading">
                <span className="m1-table__loading-inner"><LoaderCircle size={15} className="m1-spin" aria-hidden="true" />{loadingLabel}</span>
              </td>
            </tr>
          ) : list.length ? (
            list.map((row, index) => (
              <TableRow
                key={keyOf(row, index)}
                selected={selected(row, index)}
                onClick={onRowClick ? () => onRowClick(row, index) : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                onKeyDown={onRowClick ? (event) => { if (event.key === "Enter") onRowClick(row, index); } : undefined}
              >
                {columns.map((column) => (
                  <TableCell key={column.key} numeric={column.numeric} actions={column.actions}>
                    {column.render ? column.render(row, index) : row[column.key]}
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <tr><td colSpan={columns.length} className="m1-table__empty">{emptyLabel}</td></tr>
          )}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

const DEFAULT_PAGE_SIZES = [10, 25, 50, 100, 200, 500, 1000, "all"];

function paginationWindow(page, pages) {
  if (pages <= 7) return Array.from({ length: pages }, (_, index) => index + 1);
  const values = new Set([1, pages, page - 1, page, page + 1]);
  if (page <= 3) [2, 3, 4].forEach((value) => values.add(value));
  if (page >= pages - 2) [pages - 3, pages - 2, pages - 1].forEach((value) => values.add(value));
  const sorted = [...values].filter((value) => value >= 1 && value <= pages).sort((a, b) => a - b);
  return sorted.flatMap((value, index) => {
    const previous = sorted[index - 1];
    return previous && value - previous > 1 ? [`ellipsis-${value}`, value] : [value];
  });
}

export function Pagination({
  page = 1,
  pages = 1,
  total = 0,
  pageSize = 10,
  pageSizeOptions = DEFAULT_PAGE_SIZES,
  visible,
  onChange,
  onPageSizeChange,
  disabled = false,
  className = "",
  labels = {},
}) {
  const safePages = Math.max(1, Number(pages) || 1);
  const safePage = Math.min(Math.max(1, Number(page) || 1), safePages);
  const safeTotal = Math.max(0, Number(total) || 0);
  const safePageSize = Math.max(1, Number(pageSize) || 10);
  const numericPageSizes = pageSizeOptions.filter((option) => option !== "all").map(Number);
  const hasAllOption = pageSizeOptions.includes("all");
  const selectedPageSize = numericPageSizes.includes(safePageSize)
    ? safePageSize
    : hasAllOption ? "all" : safePageSize;
  const shown = Math.max(0, Number(visible) || Math.min(safePageSize, Math.max(0, safeTotal - (safePage - 1) * safePageSize)));
  const from = shown > 0 ? (safePage - 1) * safePageSize + 1 : 0;
  const to = shown > 0 ? Math.min(safeTotal || from + shown - 1, from + shown - 1) : 0;
  const text = {
    show: "عرض",
    rows: "صفوف",
    all: "الكل",
    previous: "السابق",
    next: "التالي",
    range: (start, end, count) => `عرض ${start}–${end} من أصل ${count}`,
    page: (value) => `الصفحة ${value}`,
    ...labels,
  };

  const goTo = (nextPage) => {
    if (!disabled) onChange?.(Math.min(Math.max(1, nextPage), safePages));
  };

  return (
    <nav className={`m1-pagination ${className}`.trim()} aria-label="التنقل بين الصفحات" dir="rtl">
      <div className="m1-pagination__summary">
        {onPageSizeChange ? (
          <label className="m1-pagination__size">
            <span>{text.show}</span>
            <select
              value={selectedPageSize}
              disabled={disabled}
              onChange={(event) => onPageSizeChange(event.target.value === "all" ? Math.max(1, safeTotal) : Number(event.target.value))}
              aria-label="عدد الصفوف في الصفحة"
            >
              {pageSizeOptions.map((option) => <option key={option} value={option}>{option === "all" ? text.all : option.toLocaleString("en-US")}</option>)}
            </select>
            <span>{text.rows}</span>
          </label>
        ) : null}
        <span className="m1-pagination__range" aria-live="polite">{text.range(from, to, safeTotal)}</span>
      </div>
      <div className="m1-pagination__pages">
        <button type="button" className="m1-pagination__nav" disabled={disabled || safePage <= 1} onClick={() => goTo(safePage - 1)} aria-label={text.previous}>
          <ChevronRight size={16} aria-hidden="true" /><span>{text.previous}</span>
        </button>
        <div className="m1-pagination__numbers">
          {paginationWindow(safePage, safePages).map((item) => typeof item === "string" ? (
            <span key={item} className="m1-pagination__ellipsis" aria-hidden="true">…</span>
          ) : (
            <button type="button" key={item} className={item === safePage ? "is-active" : ""} aria-current={item === safePage ? "page" : undefined} aria-label={text.page(item)} disabled={disabled} onClick={() => goTo(item)}>
              {item.toLocaleString("en-US")}
            </button>
          ))}
        </div>
        <button type="button" className="m1-pagination__nav" disabled={disabled || safePage >= safePages} onClick={() => goTo(safePage + 1)} aria-label={text.next}>
          <span>{text.next}</span><ChevronLeft size={16} aria-hidden="true" />
        </button>
      </div>
    </nav>
  );
}

/* --------------------------------------------------------- states, as-is -- */

export function EmptyState({ title = "لا توجد نتائج", description, action }) {
  return <div className="m1-empty"><span className="m1-empty__icon"><Inbox size={22} /></span><h3>{title}</h3>{description ? <p>{description}</p> : null}{action}</div>;
}

export function Skeleton({ className = "" }) { return <span className={`m1-skeleton ${className}`} aria-hidden="true" />; }

export function LoadingState({ label = "جاري التحميل..." }) {
  return <div className="m1-loading" role="status"><LoaderCircle className="m1-spin" size={19} />{label}</div>;
}
