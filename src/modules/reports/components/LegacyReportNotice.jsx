import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ArrowLeft, ArrowRight, Scale, TriangleAlert } from "lucide-react";

import { formatMoney } from "../lib/metricFormat";

/**
 * The notice that sits at the top of a legacy reporting page.
 *
 * The audit confirmed eighteen calculation defects on these screens and corrected all of
 * them in the Reporting Center rather than in place, because changing the legacy numbers
 * would silently move figures a manager reads daily. That decision is only defensible if
 * the legacy page SAYS SO — a known-wrong number left unlabelled is worse than either
 * fixing it or removing it.
 *
 * So this names the specific defects rather than saying "legacy" and leaving the reader
 * to wonder which figure to distrust, and it links to the page that answers the same
 * question correctly. Nothing here is dismissible: a notice a reader can close is a
 * notice that is absent on the visit that mattered.
 */
/**
 * Where each legacy tab's question is answered correctly now.
 *
 * Keyed by the legacy tab so the notice offers the ONE page that replaces what the
 * reader is currently looking at, rather than a generic pair of links they have to
 * choose between. Parity for every entry is recorded in
 * docs/reporting-center-legacy-parity.md.
 */
export const CANONICAL_REPLACEMENT = Object.freeze({
  insights: [{ to: "/reports/overview", key: "overview" }],
  sales: [{ to: "/reports/sales", key: "sales" }],
  employees: [{ to: "/reports/employees", key: "employees" }],
  inventory: [{ to: "/reports/inventory", key: "inventory" }],
  customers: [{ to: "/reports/customers", key: "customers" }],
  financial: [{ to: "/accounting/reports", key: "financial" }, { to: "/reports/reconciliation", key: "reconciliation" }],
});

export default function LegacyReportNotice({ variant = "reports", activeTab = null, scopeCorrection = null }) {
  const { t, i18n } = useTranslation();
  const isArabic = String(i18n.language || "").toLowerCase().startsWith("ar");
  const Arrow = isArabic ? ArrowLeft : ArrowRight;

  // D-16 was corrected at the source on /reports, so it is no longer in this list — the
  // page announces the correction below instead. /analytics still carries it, and is
  // retired for other reasons.
  const defects =
    variant === "analytics"
      ? ["scope", "stock", "dates"]
      : ["profit", "errors"];

  // The tab the reader is on wins, so the link answers the question in front of them.
  const targets =
    (activeTab && CANONICAL_REPLACEMENT[activeTab]) ||
    (variant === "analytics"
      ? [
          { to: "/reports/inventory", key: "inventory" },
          { to: "/reports/overview", key: "overview" },
        ]
      : [
          { to: "/reports/overview", key: "overview" },
          { to: "/reports/sales", key: "sales" },
        ]);

  return (
    <section
      aria-label={t("overview.legacy.title")}
      className="mb-4 rounded-[var(--radius-card)] border border-[var(--warning)]/35 bg-[var(--warning-soft)] px-4 py-3"
    >
      <div className="flex items-start gap-2.5">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-[var(--warning)]" aria-hidden="true" />
        <div className="min-w-0">
          <h2 className="m1-section-title text-[13px] text-[var(--text)] 2xl:text-[14px]">
            {t("overview.legacy.title")}
          </h2>
          <p className="mt-1 max-w-[80ch] text-[12px] leading-5 text-[var(--text-secondary)] 2xl:text-[13px]">
            {t("overview.legacy.intro")}
          </p>
          <ul className="mt-1.5 space-y-0.5">
            {defects.map((defect) => (
              <li key={defect} className="text-[12px] leading-5 text-[var(--text-secondary)]">
                — {t(`overview.legacy.defect.${defect}`)}
              </li>
            ))}
          </ul>

          {/*
            The one defect that WAS corrected in place, announced rather than applied
            quietly. A manager reconciling against a figure they wrote down last week has
            to be able to find the gap, so the exact size of it is stated for the period
            they are looking at.
          */}
          {scopeCorrection?.applied ? (
            <div className="mt-2.5 flex items-start gap-2 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--card)] px-2.5 py-2">
              <Scale className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--text-secondary)]" aria-hidden="true" />
              <p className="max-w-[80ch] text-[12px] leading-5 text-[var(--text-secondary)]">
                <span className="font-semibold text-[var(--text)]">{t("overview.legacy.scopeFix.title")}</span>{" "}
                {t("overview.legacy.scopeFix.body")}{" "}
                {scopeCorrection.excludedOrders > 0
                  ? t("overview.legacy.scopeFix.removed", {
                      orders: scopeCorrection.excludedOrders,
                      value: formatMoney(scopeCorrection.excludedValue, i18n.language),
                    })
                  : t("overview.legacy.scopeFix.removedNothing")}
              </p>
            </div>
          ) : null}

          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            {targets.map((target) => (
              <Link
                key={target.to}
                to={target.to}
                className="inline-flex h-[var(--control-height-sm)] items-center gap-1.5 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--card)] px-2.5 text-[12px] font-semibold text-[var(--text)] transition hover:border-[var(--border-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
              >
                {t(`overview.legacy.goTo.${target.key}`)}
                <Arrow className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
