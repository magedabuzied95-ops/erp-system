import { useTranslation } from "react-i18next";
import { Ruler } from "lucide-react";

import { formatMoney } from "../lib/metricFormat";
import { dimensionLabel } from "../lib/dimensionLabels";
import { formatNumber } from "../../../shared/lib/currency";

/**
 * Stock against demand, size by size, for one product type.
 *
 * Two bars on one row — what is on the shelf and what sold — because a size selling well
 * off a thin shelf and a size sitting untouched on a deep one are the two facts a buyer
 * needs, and they only mean something side by side.
 *
 * A "missing size" here is an existing size variant currently at zero stock. No ideal run
 * is inferred: the variants a product already has ARE its declared run.
 */
export default function InventorySizes({ data, productTypes, selectedType, onSelectType, showValue }) {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const rows = data?.rows || [];

  if (!selectedType) {
    return (
      <div className="min-w-0">
        <TypePicker types={productTypes} selected={selectedType} onSelect={onSelectType} language={language} />
        <EmptyState title={t("inventory.sizes.pickType")} body={t("inventory.sizes.pickTypeWhy")} />
      </div>
    );
  }

  if (data && data.applicable === false) {
    return (
      <div className="min-w-0">
        <TypePicker types={productTypes} selected={selectedType} onSelect={onSelectType} language={language} />
        <EmptyState
          title={t("inventory.sizes.notApplicableFor", { productType: dimensionLabel("product_type", selectedType, language) })}
          body={t("inventory.sizes.notApplicableWhy")}
        />
      </div>
    );
  }

  if (!rows.length) {
    return (
      <div className="min-w-0">
        <TypePicker types={productTypes} selected={selectedType} onSelect={onSelectType} language={language} />
        <EmptyState title={t("inventory.sizes.empty")} body={t("inventory.sizes.emptyWhy")} />
      </div>
    );
  }

  const maxStock = Math.max(...rows.map((row) => row.unitsInStock), 1);
  const maxSold = Math.max(...rows.map((row) => row.unitsSoldPeriod), 1);

  return (
    <div className="min-w-0">
      <TypePicker types={productTypes} selected={selectedType} onSelect={onSelectType} language={language} />

      <p className="mt-3 rounded-lg bg-[var(--surface-soft)] px-3 py-2 text-[11px] leading-4 text-[var(--text-secondary)] 2xl:text-[12px]">
        {t("inventory.sizes.scopeNote", { productType: dimensionLabel("product_type", selectedType, language) })}
      </p>

      <div className="mt-3 flex items-center gap-3 px-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--text-tertiary)] 2xl:text-[11px]">
        <span className="w-12 shrink-0">{t("inventory.sizes.size")}</span>
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          <span className="h-1.5 w-3 rounded-full bg-[var(--border-strong)]" aria-hidden="true" />
          {t("inventory.sizes.stock")}
        </span>
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          <span className="h-1.5 w-3 rounded-full bg-[var(--primary)]" aria-hidden="true" />
          {t("inventory.sizes.sold")}
        </span>
        {showValue ? <span className="hidden w-24 shrink-0 text-end sm:block">{t("inventory.sizes.value")}</span> : null}
        <span className="w-24 shrink-0 text-end">{t("inventory.sizes.signal")}</span>
      </div>

      <ul className="mt-1.5 divide-y divide-[var(--border)]">
        {rows.map((row) => {
          const outOfStock = row.unitsInStock === 0;
          return (
            <li key={row.size} className="flex items-center gap-3 py-2">
              <span className="w-12 shrink-0 text-[14px] font-bold tabular-nums text-[var(--text)] 2xl:text-[15px]">
                {dimensionLabel("size", row.size, language)}
              </span>

              <span className="flex min-w-0 flex-1 items-center gap-2">
                <span className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--surface-soft)]">
                  <span
                    className={`block h-full rounded-full ${outOfStock ? "bg-[var(--danger)]" : "bg-[var(--border-strong)]"}`}
                    style={{ width: `${Math.max((row.unitsInStock / maxStock) * 100, row.unitsInStock > 0 ? 3 : 0)}%` }}
                  />
                </span>
                <span className={`w-10 shrink-0 text-end text-[12px] tabular-nums ${outOfStock ? "font-bold text-[var(--danger)]" : "text-[var(--text-secondary)]"}`}>
                  {formatNumber(row.unitsInStock, language)}
                </span>
              </span>

              <span className="flex min-w-0 flex-1 items-center gap-2">
                <span className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--surface-soft)]">
                  <span
                    className="block h-full rounded-full bg-[var(--primary)]"
                    style={{ width: `${Math.max((row.unitsSoldPeriod / maxSold) * 100, row.unitsSoldPeriod > 0 ? 3 : 0)}%` }}
                  />
                </span>
                <span className="w-10 shrink-0 text-end text-[12px] font-bold tabular-nums text-[var(--text)]">
                  {formatNumber(row.unitsSoldPeriod, language)}
                </span>
              </span>

              {showValue ? (
                <span className="hidden w-24 shrink-0 text-end text-[11px] tabular-nums text-[var(--text-tertiary)] sm:block 2xl:text-[12px]">
                  {row.inventoryValue === null ? "—" : formatMoney(row.inventoryValue, language)}
                </span>
              ) : null}

              <span className="w-24 shrink-0 text-end">
                {outOfStock ? (
                  <Badge tone="danger">{t("inventory.sizes.missing")}</Badge>
                ) : row.flag === "high_demand_low_stock" ? (
                  <Badge tone="warning">{t("inventory.sizes.replenish")}</Badge>
                ) : row.flag === "high_stock_low_demand" ? (
                  <Badge tone="muted">{t("inventory.sizes.overstock")}</Badge>
                ) : (
                  <span className="text-[11px] text-[var(--text-tertiary)]">—</span>
                )}
              </span>
            </li>
          );
        })}
      </ul>

      {data?.totals ? (
        <p className="mt-3 border-t border-[var(--border)] pt-2 text-[11px] text-[var(--text-tertiary)] 2xl:text-[12px]">
          {t("inventory.sizes.summary", {
            stock: data.totals.sizesWithStock,
            missing: data.totals.missingSizes,
          })}
        </p>
      ) : null}
    </div>
  );
}

function Badge({ tone, children }) {
  const toneClass =
    tone === "danger"
      ? "bg-[var(--danger-soft)] text-[var(--danger)]"
      : tone === "warning"
        ? "bg-[var(--warning-soft)] text-[var(--warning)]"
        : "bg-[var(--surface-soft)] text-[var(--text-tertiary)]";
  return <span className={`inline-block rounded-md px-1.5 py-0.5 text-[11px] font-bold ${toneClass}`}>{children}</span>;
}

function EmptyState({ title, body }) {
  return (
    <div className="mt-3 flex flex-col items-center gap-1.5 rounded-xl border border-dashed border-[var(--border)] px-5 py-9 text-center">
      <Ruler className="h-5 w-5 text-[var(--text-tertiary)]" aria-hidden="true" />
      <p className="text-[14px] font-semibold text-[var(--text-secondary)]">{title}</p>
      <p className="max-w-md text-[12px] leading-5 text-[var(--text-tertiary)]">{body}</p>
    </div>
  );
}

function TypePicker({ types = [], selected, onSelect, language }) {
  if (!types.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {types.map((type) => (
        <button
          key={type}
          type="button"
          onClick={() => onSelect(type === selected ? "" : type)}
          aria-pressed={selected === type}
          className={`rounded-lg px-3 py-1.5 text-[12px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] 2xl:text-[13px] ${
            selected === type
              ? "bg-[var(--primary)] text-white"
              : "text-[var(--text-secondary)] hover:bg-[var(--surface-soft)] hover:text-[var(--text)]"
          }`}
        >
          {dimensionLabel("product_type", type, language)}
        </button>
      ))}
    </div>
  );
}
