import { forwardRef } from "react";
import { ChevronLeft, Inbox, LoaderCircle, X } from "lucide-react";
import "./m1-ui.css";

export const Button = forwardRef(function Button(
  { children, variant = "secondary", size = "md", icon: Icon, className = "", ...props },
  ref
) {
  return (
    <button ref={ref} className={`m1-button m1-button--${variant} m1-button--${size} ${className}`.trim()} {...props}>
      {Icon ? <Icon size={17} aria-hidden="true" /> : null}
      <span>{children}</span>
    </button>
  );
});

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

export function StatusBadge({ tone = "neutral", children }) {
  return <span className={`m1-status m1-status--${tone}`}><i aria-hidden="true" />{children}</span>;
}

export function MetricCard({ label, value, change, icon: Icon, tone = "neutral" }) {
  return (
    <article className={`m1-metric m1-metric--${tone}`}>
      <div className="m1-metric__top"><span>{label}</span>{Icon ? <span className="m1-metric__icon"><Icon size={19} /></span> : null}</div>
      <strong>{value}</strong>
      {change ? <small>{change}</small> : null}
    </article>
  );
}

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

export function EmptyState({ title = "لا توجد نتائج", description, action }) {
  return <div className="m1-empty"><span className="m1-empty__icon"><Inbox size={22} /></span><h3>{title}</h3>{description ? <p>{description}</p> : null}{action}</div>;
}

export function Skeleton({ className = "" }) { return <span className={`m1-skeleton ${className}`} aria-hidden="true" />; }

export function LoadingState({ label = "جاري التحميل..." }) {
  return <div className="m1-loading" role="status"><LoaderCircle className="m1-spin" size={19} />{label}</div>;
}

export function Modal({ open, title, description, children, footer, onClose }) {
  if (!open) return null;
  return <div className="m1-overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose?.()}>
    <section className="m1-modal" role="dialog" aria-modal="true" aria-labelledby="m1-modal-title">
      <header><div><h2 id="m1-modal-title">{title}</h2>{description ? <p>{description}</p> : null}</div><button onClick={onClose} aria-label="إغلاق"><X size={19} /></button></header>
      <div className="m1-modal__body">{children}</div>{footer ? <footer>{footer}</footer> : null}
    </section>
  </div>;
}

export function Pagination({ page = 1, pages = 1, onChange }) {
  return <nav className="m1-pagination" aria-label="التنقل بين الصفحات"><span>صفحة {page} من {pages}</span><div><button disabled={page <= 1} onClick={() => onChange?.(page - 1)} aria-label="السابق"><ChevronLeft size={17} /></button><button disabled={page >= pages} onClick={() => onChange?.(page + 1)} aria-label="التالي"><ChevronLeft size={17} /></button></div></nav>;
}
