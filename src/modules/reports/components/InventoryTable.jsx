import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown, Package, Search } from "lucide-react";

import { formatMoney } from "../lib/metricFormat";
import { dimensionLabel } from "../lib/dimensionLabels";
import { formatNumber } from "../../../shared/lib/currency";

/**
 * Server-side inventory grid. Same treatment as the R3 product table: sticky header,
 * server sorting/search/paging, permission-gated value columns removed rather than
 * blanked.
 *
 * "First receipt" is shown as history, never as an age: with no receipt-layer data the
 * remaining units cannot be attributed to a receipt, so a stock-age figure would be a
 * guess dressed as a measurement.
 */
const VELOCITY_TONE = {
  fast: "text-[var(--success)]",
  steady: "text-[var(--primary)]",
  slow: "text-[var(--warning)]",
  dead_candidate: "text-[var(--danger)]",
  evaluating: "text-[var(--text-secondary)]",
  too_new: "text-[var(--text-tertiary)]",
  unknown_age: "text-[var(--text-tertiary)]",
};

export default function InventoryTable({
  data, pagination, sort, showValue, search, onSearch, onSort, onPage, onSelectProduct,
}) {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const [draft, setDraft] = useState(search || "");

  useEffect(() => setDraft(search || ""), [search]);
  useEffect(() => {
    if (draft === (search || "")) return undefined;
    const timer = setTimeout(() => onSearch(draft), 350);
    return () => clearTimeout(timer);
  }, [draft, search, onSearch]);

  const columns = [
    { key: "product", label: t("inventory.table.product"), sortable: true, align: "start" },
    { key: "units", label: t("inventory.table.stock"), sortable: true, align: "end" },
    ...(showValue ? [{ key: "inventory_value", label: t("inventory.table.value"), sortable: true, align: "end" }] : []),
    { key: "units_sold", label: t("inventory.table.sold"), sortable: true, align: "end" },
    { key: "net_sales", label: t("inventory.table.netSales"), sortable: true, align: "end" },
    { key: "velocity", label: t("inventory.table.velocity"), sortable: false, align: "start" },
    { key: "last_sale", label: t("inventory.table.lastSale"), sortable: true, align: "end" },
    { key: "first_receipt", label: t("inventory.table.firstReceipt"), sortable: true, align: "end" },
  ];

  const rows = data || [];
  const date = (value) => (value ? new Date(value).toLocaleDateString(language.startsWith("ar") ? "ar-EG" : "en-GB", { day: "2-digit", month: "short" }) : "—");

  return (
    <div className="min-w-0">
      <label className="mb-3 flex h-10 max-w-sm items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] px-3 transition focus-within:border-[var(--primary)]">
        <Search className="h-3.5 w-3.5 shrink-0 text-[var(--text-tertiary)]" aria-hidden="true" />
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={t("inventory.table.search")}
          className="min-w-0 flex-1 bg-transparent text-[13px] text-[var(--text)] outline-none placeholder:text-[var(--text-tertiary)]"
        />
      </label>

      {!rows.length ? (
        <p className="rounded-xl border border-dashed border-[var(--border)] px-4 py-8 text-center text-[13px] text-[var(--text-tertiary)]">
          {t("inventory.table.empty")}
        </p>
      ) : (
        <div className="-mx-1 max-h-[640px] overflow-auto rounded-xl border border-[var(--border)]">
          <table className="m1-table m1-table--compact w-full min-w-[860px] text-[13px]">
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
                        className={`inline-flex items-center gap-1 rounded transition hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] ${ sort.key === column.key ? "text-[var(--primary)]" : "" }`}
                      >
                        {column.label}
                        {sort.key === column.key ? (
                          <ArrowUp className={`h-3 w-3 transition-transform ${sort.direction === "asc" ? "" : "rotate-180"}`} aria-hidden="true" />
                        ) : (
                          <ChevronsUpDown className="h-3 w-3 opacity-0 transition" aria-hidden="true" />
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
              {rows.map((row) => (
                <tr
                  key={row.productId}
                  onClick={() => onSelectProduct?.(row)}
                  className="cursor-pointer border-b border-[var(--border)] transition last:border-0 hover:bg-[var(--surface-soft)]"
                >
                  <td className="px-3 py-2.5">
                    <span className="flex items-center gap-2.5">
                      <Thumb url={row.imageUrl} />
                      <span className="min-w-0">
                        <span className="block max-w-[240px] truncate font-semibold text-[var(--text)] 2xl:max-w-[340px]" title={row.productName}>
                          {row.productName}
                        </span>
                        <span className="block max-w-[240px] truncate text-[11px] text-[var(--text-tertiary)] 2xl:max-w-[340px]">
                          {[row.brand, dimensionLabel("product_type", row.productType, language)].filter(Boolean).join(" · ")}
                          {row.missingSizes ? ` · ${t("inventory.table.missingSizes", { count: row.missingSizes })}` : ""}
                        </span>
                      </span>
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-end font-bold tabular-nums text-[var(--text)]">{formatNumber(row.unitsInStock, language)}</td>
                  {showValue ? (
                    <td className="px-3 py-2.5 text-end tabular-nums text-[var(--text-secondary)]">
                      {row.inventoryValue === null ? "—" : formatMoney(row.inventoryValue, language)}
                    </td>
                  ) : null}
                  <td className="px-3 py-2.5 text-end tabular-nums text-[var(--text-secondary)]">{formatNumber(row.unitsSoldPeriod, language)}</td>
                  <td className="px-3 py-2.5 text-end tabular-nums text-[var(--text-secondary)]">{formatMoney(row.netSalesPeriod, language)}</td>
                  <td className="px-3 py-2.5">
                    <span
                      className={`text-[12px] font-semibold ${VELOCITY_TONE[row.velocity] || "text-[var(--text-tertiary)]"}`}
                      title={row.unknownAge ? t("inventory.health.unknown_ageHint") : undefined}
                    >
                      {row.velocity ? t(`inventory.health.${row.velocity}`) : "—"}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-end tabular-nums text-[var(--text-tertiary)]">{date(row.lastSoldAt)}</td>
                  <td className="px-3 py-2.5 text-end tabular-nums text-[var(--text-tertiary)]">{date(row.firstReceivedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pagination && pagination.total > 0 ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] pt-2.5">
          <span className="text-[11px] text-[var(--text-tertiary)]">
            {t("inventory.table.showing", {
              from: (pagination.page - 1) * pagination.limit + 1,
              to: Math.min(pagination.page * pagination.limit, pagination.total),
              total: pagination.total,
            })}
          </span>
          <span className="flex items-center gap-1.5">
            <PageButton disabled={pagination.page <= 1} onClick={() => onPage(pagination.page - 1)} label={t("inventory.table.prev")}>
              <ChevronRight className="h-3.5 w-3.5 rtl:block ltr:hidden" aria-hidden="true" />
              <ChevronLeft className="h-3.5 w-3.5 ltr:block rtl:hidden" aria-hidden="true" />
            </PageButton>
            <span className="text-[11px] font-bold tabular-nums text-[var(--text-secondary)]">
              {pagination.page} / {pagination.pages}
            </span>
            <PageButton disabled={pagination.page >= pagination.pages} onClick={() => onPage(pagination.page + 1)} label={t("inventory.table.next")}>
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
      className="inline-flex h-[var(--control-height-sm)] w-7 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--text-secondary)] transition hover:bg-[var(--surface-soft)] disabled:opacity-40"
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
