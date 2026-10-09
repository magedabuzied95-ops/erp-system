import { useTranslation } from "react-i18next";

import { formatMoney, formatPercentValue } from "../lib/metricFormat";
import { formatNumber } from "../../../shared/lib/currency";
import { paymentMethodLabel } from "../../../../shared/paymentMethods";

/**
 * What paid for the period — cash against card against InstaPay, each with its own total.
 *
 * The three settlement classes are kept visually apart rather than summed into one
 * headline, because they are three different facts: money in hand, money a courier is
 * still carrying, and money nobody has paid at all. One "total collected" covering all
 * three would be the kind of number a manager closes a month on and cannot reconcile.
 *
 * The footnote is not decoration either: this card counts what was PAID on the period's
 * invoices, while net sales deducts returns and ignores deposits, so the two legitimately
 * differ. Saying so is cheaper than a manager discovering the gap and trusting neither.
 */
const SETTLEMENT_BAR = {
  collected: "bg-[var(--primary)]",
  pending: "bg-[var(--warning)]",
  credit: "bg-[var(--border-strong)]",
  unattributed: "bg-[var(--danger)]",
};

const SETTLEMENT_CHIP = {
  pending: "border-[var(--warning)]/30 bg-[var(--warning-soft)] text-[var(--text-secondary)]",
  credit: "border-[var(--border)] bg-[var(--surface-soft)] text-[var(--text-tertiary)]",
  unattributed: "border-[var(--danger)]/30 bg-[var(--danger-soft)] text-[var(--text-secondary)]",
};

const TOTAL_KEYS = ["collected", "pending", "credit", "unattributed"];

export default function PaymentMix({ paymentMix }) {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const rows = paymentMix?.rows || [];
  const totals = paymentMix?.totals || {};
  const netSales = paymentMix?.netSales ?? null;

  if (!rows.length) {
    return (
      <div className="flex h-[180px] items-center justify-center rounded-xl border border-dashed border-[var(--border)] text-[13px] text-[var(--text-tertiary)]">
        {t("overview.paymentMix.empty")}
      </div>
    );
  }

  const max = Math.max(...rows.map((row) => Math.abs(row.amount || 0)), 1);

  return (
    <div className="min-w-0">
      <ul className="space-y-2.5">
        {rows.map((row) => (
          <PaymentRow key={row.method} row={row} max={max} language={language} t={t} />
        ))}
      </ul>

      <div className="mt-4 space-y-1.5 border-t border-[var(--border)] pt-3">
        {TOTAL_KEYS.filter((key) => Number(totals[key] || 0) !== 0).map((key) => (
          <div key={key} className="flex items-baseline justify-between gap-3 text-[12px]">
            <span className="text-[var(--text-secondary)]">{t(`overview.paymentMix.settlement.${key}`)}</span>
            <span className="shrink-0 font-semibold tabular-nums text-[var(--text)]">
              {formatMoney(totals[key], language)}
            </span>
          </div>
        ))}

        <div className="flex items-baseline justify-between gap-3 pt-1 text-[13px]">
          <span className="font-semibold text-[var(--text)]">{t("overview.paymentMix.total")}</span>
          <span className="shrink-0 text-[15px] font-bold tabular-nums text-[var(--text)]">
            {formatMoney(totals.all, language)}
          </span>
        </div>
      </div>

      <p className="mt-3 text-[11px] leading-4 text-[var(--text-tertiary)]">
        {netSales === null || netSales === undefined
          ? t("overview.paymentMix.footnote")
          : t("overview.paymentMix.footnoteWithNet", { netSales: formatMoney(netSales, language) })}
      </p>
    </div>
  );
}

function PaymentRow({ row, max, language, t }) {
  const width = Math.max((Math.abs(row.amount || 0) / max) * 100, 1.5);
  const chip = SETTLEMENT_CHIP[row.settlement];
  const label = paymentMethodLabel(row.method, language);

  return (
    <li>
      <div className="flex items-baseline justify-between gap-3">
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span className="truncate text-[14px] font-semibold text-[var(--text)] 2xl:text-[15px]" title={label}>
            {label}
          </span>
          {chip ? (
            <span className={`shrink-0 rounded-full border px-1.5 py-px text-[10px] font-semibold ${chip}`}>
              {t(`overview.paymentMix.chip.${row.settlement}`)}
            </span>
          ) : null}
        </span>
        <span className="shrink-0 text-[14px] font-bold tabular-nums text-[var(--text)] 2xl:text-[15px]">
          {formatMoney(row.amount, language)}
        </span>
      </div>

      <div className="mt-1.5 flex items-center gap-2.5">
        <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--surface-soft)]">
          <div
            className={`h-full rounded-full ${SETTLEMENT_BAR[row.settlement] || SETTLEMENT_BAR.collected}`}
            style={{ width: `${width}%` }}
          />
        </div>
        <span className="w-10 shrink-0 text-end text-[11px] font-semibold tabular-nums text-[var(--text-tertiary)]">
          {formatPercentValue(row.share, language) || "—"}
        </span>
      </div>

      {row.orders ? (
        <div className="mt-1 text-[11px] text-[var(--text-tertiary)]">
          {t("overview.paymentMix.orders")}: <span className="tabular-nums">{formatNumber(row.orders, language)}</span>
        </div>
      ) : null}
    </li>
  );
}
