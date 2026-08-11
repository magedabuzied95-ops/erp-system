import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown, Package, Search } from "lucide-react";

import { formatDeltaPercent, formatMoney, formatPercentValue, resolveSentiment, SENTIMENT_CLASS } from "../lib/metricFormat";
import { formatNumber } from "../../../shared/lib/currency";
import { dimensionLabel } from "../lib/dimensionLabels";

/**
 * Server-side product table: sorting, search and paging all round-trip to the API,
 * so the full catalogue is never pulled into the browser.
 *
 * Profit and margin columns are omitted entirely when the caller lacks the permission —
 * the backend already withholds the values, and showing empty columns would imply zero.
 */
export default function ProductTable({ data, pagination, sort, showProfit, showCost, search, onSearch, onSort, onPage, onSelectProduct }) {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const [draft, setDraft] = useState(search || "");

  useEffect(() => setDraft(search || ""), [search]);

  // Debounce so typing does not create a request storm.
  useEffect(() => {
    if (draft === (search || "")) return undefined;
    const timer = setTimeout(() => onSearch(draft), 350);
    return () => clearTimeout(timer);
  }, [draft, search, onSearch]);

  const columns = [
    { key: "product", label: t("salesAnalytics.table.product"), sortable: true, align: "start" },
    { key: "units", label: t("salesAnalytics.table.units"), sortable: true, align: "end" },
    { key: "net_sales", label: t("salesAnalytics.table.netSales"), sortable: true, align: "end" },
    ...(showProfit ? [
      { key: "gross_profit", label: t("salesAnalytics.table.profit"), sortable: true, align: "end" },
      { key: "margin", label: t("salesAnalytics.table.margin"), sortable: true, align: "end" },
    ] : []),
    { key: "discount_rate", label: t("salesAnalytics.table.discount"), sortable: true, align: "end" },
    ...(showCost ? [{ key: "stock", label: t("salesAnalytics.table.stock"), sortable: false, align: "end" }] : []),
    { key: "growth", label: t("salesAnalytics.table.change"), sortable: true, align: "end" },
  ];

  const rows = data || [];

  return (
    <div className="min-w-0">
      <label className="mb-3 flex h-10 max-w-sm items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] px-3 transition focus-within:border-[var(--primary)]">
        <Search className="h-3.5 w-3.5 shrink-0 text-[var(--text-tertiary)]" aria-hidden="true" />
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={t("salesAnalytics.table.search")}
          className="min-w-0 flex-1 bg-transparent text-[13px] text-[var(--text)] outline-none placeholder:text-[var(--text-tertiary)]"
        />
      </label>

      {!rows.length ? (
        <p className="rounded-xl border border-dashed border-[var(--border)] px-4 py-8 text-center text-[13px] text-[var(--text-tertiary)]">
          {t("salesAnalytics.table.empty")}
        </p>
      ) : (
        <div className="-mx-1 max-h-[640px] overflow-auto rounded-xl border border-[var(--border)]">
          <table className="w-full min-w-[720px] text-[13px]">
            {/* Sticky header: the table can run to 25 rows, and a column heading that
                scrolls away turns a numeric grid into an unlabelled block of digits. */}
            <thead className="sticky top-0 z-10 bg-[var(--card)]">
              <tr className="border-b border-[var(--border)]">
                {columns.map((column) => (
                  <th
                    key={column.key}
                    scope="col"
                    className={`whitespace-nowrap bg-[var(--card)] px-3 py-2.5 text-[12px] font-bold text-[var(--text-tertiary)] 2xl:text-[13px] ${column.align === "end" ? "text-end" : "text-start"}`}
                  >
                    {column.sortable ? (
                      <button
                        type="button"
                        onClick={() => onSort(column.key, sort.key === column.key && sort.direction === "desc" ? "asc" : "desc")}
                        aria-label={column.label}
                        className={`inline-flex items-center gap-1 rounded transition hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] ${
                          sort.key === column.key ? "text-[var(--primary)]" : ""
                        }`}
                      >
                        {column.label}
                        {sort.key === column.key ? (
                          <ArrowUp className={`h-3 w-3 transition-transform ${sort.direction === "asc" ? "" : "rotate-180"}`} aria-hidden="true" />
                        ) : (
                          <ChevronsUpDown className="h-3 w-3 opacity-0 transition group-hover/th:opacity-60" aria-hidden="true" />
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
              {rows.map((row) => {
                const sentiment = resolveSentiment("higher", row.growth);
                return (
                  <tr
                    key={row.productId}
                    onClick={() => onSelectProduct?.(row)}
                    className="cursor-pointer border-b border-[var(--border)] transition last:border-0 hover:bg-[var(--surface-soft)]"
                  >
                    <td className="px-3 py-2.5">
                      <span className="flex items-center gap-2.5">
                        <Thumb url={row.imageUrl} />
                        <span className="min-w-0">
                          <span className="block max-w-[260px] truncate font-semibold text-[var(--text)] 2xl:max-w-[360px]" title={row.productName}>
                            {row.productName}
                          </span>
                          <span className="block max-w-[260px] truncate text-[11px] text-[var(--text-tertiary)] 2xl:max-w-[360px]">
                            {[row.brand, dimensionLabel("product_type", row.productType, language)].filter(Boolean).join(" · ")}
                          </span>
                        </span>
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-end tabular-nums text-[var(--text-secondary)]">{formatNumber(row.units, language)}</td>
                    <td className="px-3 py-2.5 text-end font-bold tabular-nums text-[var(--text)]">{formatMoney(row.netSales, language)}</td>
                    {showProfit ? (
                      <>
                        <td className="px-3 py-2.5 text-end tabular-nums text-[var(--text-secondary)]">
                          {row.grossProfit === null ? "—" : formatMoney(row.grossProfit, language)}
                        </td>
                        <td className="px-3 py-2.5 text-end tabular-nums text-[var(--text-secondary)]">
                          {formatPercentValue(row.grossMargin, language) || "—"}
                        </td>
                      </>
                    ) : null}
                    <td className="px-3 py-2.5 text-end tabular-nums text-[var(--text-tertiary)]">
                      {formatPercentValue(row.discountRate, language) || "—"}
                    </td>
                    {showCost ? (
                      <td className="px-3 py-2.5 text-end tabular-nums text-[var(--text-tertiary)]">
                        {row.currentStock === null ? "—" : formatNumber(row.currentStock, language)}
                      </td>
                    ) : null}
                    <td className={`px-3 py-2.5 text-end font-semibold tabular-nums ${SENTIMENT_CLASS[sentiment]}`}>
                      {formatDeltaPercent(row.growth, language) || "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {pagination && pagination.total > 0 ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] pt-2.5">
          <span className="text-[11px] text-[var(--text-tertiary)]">
            {t("salesAnalytics.table.showing", {
              from: (pagination.page - 1) * pagination.limit + 1,
              to: Math.min(pagination.page * pagination.limit, pagination.total),
              total: pagination.total,
            })}
          </span>
          <span className="flex items-center gap-1.5">
            <PageButton disabled={pagination.page <= 1} onClick={() => onPage(pagination.page - 1)} label={t("salesAnalytics.table.prev")}>
              <ChevronRight className="h-3.5 w-3.5 rtl:block ltr:hidden" aria-hidden="true" />
              <ChevronLeft className="h-3.5 w-3.5 ltr:block rtl:hidden" aria-hidden="true" />
            </PageButton>
            <span className="text-[11px] font-bold tabular-nums text-[var(--text-secondary)]">
              {pagination.page} / {pagination.pages}
            </span>
            <PageButton disabled={pagination.page >= pagination.pages} onClick={() => onPage(pagination.page + 1)} label={t("salesAnalytics.table.next")}>
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
      className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--text-secondary)] transition hover:bg-[var(--surface-soft)] disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function Thumb({ url }) {
  if (!url) {
    return (
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-soft)]">
        <Package className="h-4 w-4 text-[var(--text-tertiary)]" aria-hidden="true" />
      </span>
    );
  }
  return (
    <img
      src={url}
      alt=""
      loading="lazy"
      width={36}
      height={36}
      className="h-9 w-9 shrink-0 rounded-lg border border-[var(--border)] object-cover"
      onError={(event) => { event.currentTarget.style.display = "none"; }}
    />
  );
}
