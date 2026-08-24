import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown, Search } from "lucide-react";

/**
 * A server-driven analytical table, described by a column spec.
 *
 * R3 and R4 each grew their own table because their cells are genuinely different —
 * ProductTable renders a thumbnail, InventoryTable renders a velocity chip. R5 and R6
 * needed four more tables between them, and four more forks of the same sorting,
 * paging and search machinery would have been four more places for a pagination bug to
 * live. Those two stay as they are; everything from here on describes its columns.
 *
 * Sorting, searching and paging all round-trip to the API. Nothing is ever re-sorted in
 * the browser, because the browser only holds one page and re-sorting it would silently
 * reorder 25 rows out of 600 and look like it worked.
 *
 * A column whose `visible` is false is not rendered AT ALL rather than rendered empty.
 * That is the same rule the rest of the Reporting Center follows for restricted money:
 * an empty cell reads as zero, and zero is a claim the report has not earned.
 */
export default function AnalyticsTable({
  columns,
  rows = [],
  pagination,
  sort,
  onSort,
  onPage,
  onSearch,
  search,
  searchPlaceholder,
  emptyLabel,
  rowKey = (row, index) => row.id ?? index,
  onSelectRow,
  minWidth = 720,
  labels,
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(search || "");

  useEffect(() => setDraft(search || ""), [search]);

  // Debounce so typing does not create a request storm.
  useEffect(() => {
    if (!onSearch || draft === (search || "")) return undefined;
    const timer = setTimeout(() => onSearch(draft), 350);
    return () => clearTimeout(timer);
  }, [draft, search, onSearch]);

  const visible = columns.filter((column) => column.visible !== false);
  const showing = labels?.showing || "salesAnalytics.table.showing";
  const prev = labels?.prev || "salesAnalytics.table.prev";
  const next = labels?.next || "salesAnalytics.table.next";

  return (
    <div className="min-w-0">
      {onSearch ? (
        <label className="mb-3 flex h-10 max-w-sm items-center gap-2 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface-soft)] px-3 transition focus-within:border-[var(--primary)]">
          <Search className="h-3.5 w-3.5 shrink-0 text-[var(--text-tertiary)]" aria-hidden="true" />
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={searchPlaceholder}
            className="min-w-0 flex-1 bg-transparent text-[13px] text-[var(--text)] outline-none placeholder:text-[var(--text-tertiary)]"
          />
        </label>
      ) : null}

      {!rows.length ? (
        <p className="rounded-xl border border-dashed border-[var(--border)] px-4 py-8 text-center text-[13px] text-[var(--text-tertiary)]">
          {emptyLabel}
        </p>
      ) : (
        <div className="-mx-1 max-h-[640px] overflow-auto rounded-xl border border-[var(--border)]">
          <table className="m1-table m1-table--compact w-full text-[13px]" style={{ minWidth: `${minWidth}px` }}>
            {/* Sticky header: these tables run to 25 rows, and a heading that scrolls away
                turns a numeric grid into an unlabelled block of digits. */}
            <thead className="sticky top-0 z-10 bg-[var(--card)]">
              <tr className="border-b border-[var(--border)]">
                {visible.map((column) => (
                  <th
                    key={column.key}
                    scope="col"
                    className={`whitespace-nowrap bg-[var(--card)] px-3 py-2.5 text-[12px] font-bold text-[var(--text-tertiary)] 2xl:text-[13px] ${column.align === "end" ? "text-end" : "text-start"}`}
                  >
                    {column.sortable && onSort ? (
                      <button
                        type="button"
                        onClick={() => onSort(column.key, sort?.key === column.key && sort?.direction === "desc" ? "asc" : "desc")}
                        aria-label={column.label}
                        className={`inline-flex items-center gap-1 rounded transition hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] ${sort?.key === column.key ? "text-[var(--primary)]" : ""}`}
                      >
                        {column.label}
                        {sort?.key === column.key ? (
                          <ArrowUp className={`h-3 w-3 transition-transform ${sort?.direction === "asc" ? "" : "rotate-180"}`} aria-hidden="true" />
                        ) : (
                          <ChevronsUpDown className="h-3 w-3 opacity-40" aria-hidden="true" />
                        )}
                      </button>
                    ) : (
                      column.label
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr
                  key={rowKey(row, index)}
                  onClick={onSelectRow ? () => onSelectRow(row) : undefined}
                  className={`border-b border-[var(--border)] transition last:border-0 hover:bg-[var(--surface-soft)] ${onSelectRow ? "cursor-pointer" : ""}`}
                >
                  {visible.map((column) => (
                    <td
                      key={column.key}
                      className={`px-3 py-2.5 ${column.align === "end" ? "text-end tabular-nums" : ""} ${column.cellClassName || "text-[var(--text-secondary)]"}`}
                    >
                      {column.render(row, index)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pagination && pagination.total > 0 && pagination.pages > 1 ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] pt-2.5">
          <span className="text-[11px] text-[var(--text-tertiary)]">
            {t(showing, {
              from: (pagination.page - 1) * pagination.limit + 1,
              to: Math.min(pagination.page * pagination.limit, pagination.total),
              total: pagination.total,
            })}
          </span>
          <span className="flex items-center gap-1.5">
            <PageButton disabled={pagination.page <= 1} onClick={() => onPage(pagination.page - 1)} label={t(prev)}>
              <ChevronRight className="h-3.5 w-3.5 rtl:block ltr:hidden" aria-hidden="true" />
              <ChevronLeft className="h-3.5 w-3.5 ltr:block rtl:hidden" aria-hidden="true" />
            </PageButton>
            <span className="text-[11px] font-bold tabular-nums text-[var(--text-secondary)]">
              {pagination.page} / {pagination.pages}
            </span>
            <PageButton disabled={pagination.page >= pagination.pages} onClick={() => onPage(pagination.page + 1)} label={t(next)}>
              <ChevronLeft className="h-3.5 w-3.5 rtl:block ltr:hidden" aria-hidden="true" />
              <ChevronRight className="h-3.5 w-3.5 ltr:block rtl:hidden" aria-hidden="true" />
            </PageButton>
          </span>
        </div>
      ) : null}
    </div>
  );
}

function PageButton({ disabled, onClick, label, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="inline-flex h-[var(--control-height-sm)] w-7 items-center justify-center rounded-[var(--radius-control)] border border-[var(--border)] text-[var(--text-secondary)] transition hover:bg-[var(--surface-soft)] disabled:opacity-40"
    >
      {children}
    </button>
  );
}

/**
 * The one place a missing analytical value is rendered.
 *
 * null means "not computable" and renders as an em dash. It is deliberately NOT rendered
 * as 0, because a shop that sold nothing and a shop whose cost data is missing are
 * different facts, and a column of zeros hides which one you are looking at.
 */
export function Blank() {
  return <span className="text-[var(--text-tertiary)]">—</span>;
}
