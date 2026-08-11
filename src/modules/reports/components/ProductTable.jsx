import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight, Package, Search } from "lucide-react";

import { formatDeltaPercent, formatPercentValue, resolveSentiment, SENTIMENT_CLASS } from "../lib/metricFormat";
import { formatCurrency, formatNumber } from "../../../shared/lib/currency";

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
      <label className="mb-3 flex h-9 max-w-xs items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] px-2.5">
        <Search className="h-3.5 w-3.5 shrink-0 text-[var(--text-tertiary)]" aria-hidden="true" />
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={t("salesAnalytics.table.search")}
          className="min-w-0 flex-1 bg-transparent text-[12px] text-[var(--text)] outline-none placeholder:text-[var(--text-tertiary)]"
        />
      </label>

      {!rows.length ? (
        <p className="rounded-xl border border-dashed border-[var(--border)] px-4 py-8 text-center text-[13px] text-[var(--text-tertiary)]">
          {t("salesAnalytics.table.empty")}
        </p>
      ) : (
        <div className="-mx-1 overflow-x-auto">
          <table className="w-full min-w-[640px] text-[12px]">
            <thead>
              <tr className="border-b border-[var(--border)]">
                {columns.map((column) => (
                  <th
                    key={column.key}
                    scope="col"
                    className={`px-2 py-2 font-semibold text-[var(--text-tertiary)] ${column.align === "end" ? "text-end" : "text-start"}`}
                  >
                    {column.sortable ? (
                      <button
                        type="button"
                        onClick={() => onSort(column.key, sort.key === column.key && sort.direction === "desc" ? "asc" : "desc")}
                        className="inline-flex items-center gap-1 transition hover:text-[var(--text)]"
                      >
                        {column.label}
                        {sort.key === column.key ? <span aria-hidden="true">{sort.direction === "asc" ? "↑" : "↓"}</span> : null}
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
                    <td className="px-2 py-2">
                      <span className="flex items-center gap-2">
                        <Thumb url={row.imageUrl} />
                        <span className="min-w-0">
                          <span className="block max-w-[220px] truncate font-semibold text-[var(--text)]" title={row.productName}>
                            {row.productName}
                          </span>
                          <span className="block max-w-[220px] truncate text-[10px] text-[var(--text-tertiary)]">
                            {[row.brand, row.productType].filter(Boolean).join(" · ")}
                          </span>
                        </span>
                      </span>
                    </td>
                    <td className="px-2 py-2 text-end tabular-nums text-[var(--text-secondary)]">{formatNumber(row.units, language)}</td>
                    <td className="px-2 py-2 text-end font-bold tabular-nums text-[var(--text)]">{formatCurrency(row.netSales, language)}</td>
                    {showProfit ? (
                      <>
                        <td className="px-2 py-2 text-end tabular-nums text-[var(--text-secondary)]">
                          {row.grossProfit === null ? "—" : formatCurrency(row.grossProfit, language)}
                        </td>
                        <td className="px-2 py-2 text-end tabular-nums text-[var(--text-secondary)]">
                          {formatPercentValue(row.grossMargin, language) || "—"}
                        </td>
                      </>
                    ) : null}
                    <td className="px-2 py-2 text-end tabular-nums text-[var(--text-tertiary)]">
                      {formatPercentValue(row.discountRate, language) || "—"}
                    </td>
                    {showCost ? (
                      <td className="px-2 py-2 text-end tabular-nums text-[var(--text-tertiary)]">
                        {row.currentStock === null ? "—" : formatNumber(row.currentStock, language)}
                      </td>
                    ) : null}
                    <td className={`px-2 py-2 text-end font-semibold tabular-nums ${SENTIMENT_CLASS[sentiment]}`}>
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
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--surface-soft)]">
        <Package className="h-3 w-3 text-[var(--text-tertiary)]" aria-hidden="true" />
      </span>
    );
  }
  return (
    <img
      src={url}
      alt=""
      loading="lazy"
      width={28}
      height={28}
      className="h-7 w-7 shrink-0 rounded-md border border-[var(--border)] object-cover"
      onError={(event) => { event.currentTarget.style.display = "none"; }}
    />
  );
}
