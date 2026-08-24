import { useTranslation } from "react-i18next";
import { CircleAlert, CircleCheck, CircleMinus, Info } from "lucide-react";

import useAnalyticsFilters from "../hooks/useAnalyticsFilters";
import useAnalyticsResource from "../hooks/useAnalyticsResource";
import { fetchReconciliation } from "../services/reconciliationApi";
import PeriodSelector from "../components/PeriodSelector";
import SectionCard from "../components/SectionCard";
import SectionNav from "../components/SectionNav";
import AnalyticsTable, { Blank } from "../components/AnalyticsTable";
import ReportExportMenu from "../components/ReportExportMenu";
import { Card, PeriodFootnote, ReportsHeader, ReportsPage } from "../components/ReportsLayout";
import { OverviewForbidden, OverviewWarnings } from "../components/OverviewStates";
import { formatMoney, formatPercentValue } from "../lib/metricFormat";
import { formatNumber } from "../../../shared/lib/currency";

/**
 * R10 — Reconciliation.
 *
 * The page a manager opens to answer "can I trust these numbers". It renders exactly what
 * the reconciliation service returns and computes nothing: the same engine backs the CLI
 * script, so the screen and the script can never disagree about whether the books balance.
 *
 * The two kinds of check are kept visually and structurally apart, because they mean
 * opposite things. An internal difference is a defect. A difference against accounting is
 * the correction working, and a zero there would be the thing to worry about.
 */

const SECTIONS = [
  { id: "reconciliation-status", key: "status" },
  { id: "reconciliation-internal", key: "internal" },
  { id: "reconciliation-declared", key: "declared" },
  { id: "reconciliation-warnings", key: "warnings" },
];

const STATUS_STYLE = {
  pass: { Icon: CircleCheck, tone: "text-[var(--success)]", bg: "bg-[var(--success-soft,var(--surface-soft))]", border: "border-[var(--success)]/35" },
  fail: { Icon: CircleAlert, tone: "text-[var(--danger)]", bg: "bg-[var(--danger-soft,var(--surface-soft))]", border: "border-[var(--danger)]/35" },
  partial: { Icon: CircleMinus, tone: "text-[var(--warning)]", bg: "bg-[var(--warning-soft)]", border: "border-[var(--warning)]/35" },
};

const CHECK_STATUS_STYLE = {
  pass: "text-[var(--success)]",
  fail: "text-[var(--danger)]",
  unavailable: "text-[var(--text-tertiary)]",
  info: "text-[var(--text-tertiary)]",
};

export default function ReconciliationReport() {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const isArabic = String(language || "").toLowerCase().startsWith("ar");

  const { filters, requestParams, allowedComparisons, setPreset, setCompare } = useAnalyticsFilters();
  const report = useAnalyticsResource(fetchReconciliation, requestParams);

  const busy = report.status === "loading" || report.status === "refreshing";

  if (report.status === "forbidden") {
    return (
      <ReportsPage dir={isArabic ? "rtl" : "ltr"}>
        <ReportsHeader title={t("reconciliation.title")} subtitle={t("reconciliation.subtitle")} />
        <OverviewForbidden />
      </ReportsPage>
    );
  }

  const data = report.data;
  const meta = report.meta;
  const status = data?.status || "partial";
  const style = STATUS_STYLE[status] || STATUS_STYLE.partial;
  const StatusIcon = style.Icon;

  const internal = (data?.checks || []).filter((entry) => entry.kind === "internal");
  const declared = (data?.checks || []).filter((entry) => entry.kind === "declared");

  const checkLabel = (entry) => t(`reconciliation.check.${entry.group}.${entry.metric}`, { defaultValue: `${entry.group}.${entry.metric}` });
  const value = (entry, side) => {
    const raw = entry[side];
    if (raw === null || raw === undefined) return "—";
    if (entry.metric.toLowerCase().includes("margin") || entry.metric === "attributionCoverage") {
      return formatPercentValue(raw, language) || "—";
    }
    if (["orders", "itemsSold", "velocityBuckets"].includes(entry.metric)) return formatNumber(raw, language);
    return formatMoney(raw, language) || formatNumber(raw, language);
  };

  return (
    <ReportsPage dir={isArabic ? "rtl" : "ltr"}>
      <div className="space-y-5">
        <ReportsHeader title={t("reconciliation.title")} subtitle={t("reconciliation.subtitle")}>
          <div className="flex flex-wrap items-center gap-2">
            <PeriodSelector
              filters={filters}
              allowedComparisons={allowedComparisons}
              onPresetChange={setPreset}
              onCompareChange={setCompare}
              onRefresh={report.refresh}
              busy={busy}
            />
            <ReportExportMenu
              reportKey="reconciliation"
              title={t("reconciliation.title")}
              filters={filters}
              language={language}
              sheets={() => buildExportSheets({ t, language, data, meta, checkLabel })}
            />
          </div>
        </ReportsHeader>

        <SectionNav sections={SECTIONS} namespace="reconciliation" />

        <OverviewWarnings warnings={report.warnings || []} />

        <section id="reconciliation-status" className="scroll-mt-28">
          <div className={`rounded-[var(--radius-card)] border ${style.border} ${style.bg} px-5 py-4`}>
            <div className="flex flex-wrap items-start gap-3">
              <StatusIcon className={`mt-0.5 h-6 w-6 shrink-0 ${style.tone}`} aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <h2 className="m1-page-title text-[18px] text-[var(--text)] 2xl:text-[20px]">
                  {t(`reconciliation.status.${status}`)}
                </h2>
                <p className="mt-1 max-w-[74ch] text-[13px] leading-5 text-[var(--text-secondary)]">
                  {t(`reconciliation.status.${status}Hint`, { tolerance: meta?.tolerance ?? 0.01 })}
                </p>
                <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
                  <Stat label={t("reconciliation.status.passed")} value={data?.counts?.passed} tone="text-[var(--success)]" language={language} />
                  <Stat label={t("reconciliation.status.failed")} value={data?.counts?.failed} tone={data?.counts?.failed ? "text-[var(--danger)]" : undefined} language={language} />
                  <Stat label={t("reconciliation.status.unavailable")} value={data?.counts?.unavailable} language={language} />
                  <Stat label={t("reconciliation.status.declared")} value={data?.counts?.declared} language={language} />
                  <div className="min-w-0">
                    <dt className="text-[11px] font-semibold text-[var(--text-tertiary)]">{t("reconciliation.status.verifiedAt")}</dt>
                    <dd className="mt-0.5 text-[13px] font-bold tabular-nums text-[var(--text)]" dir="ltr">
                      {meta?.verifiedAt ? new Date(meta.verifiedAt).toLocaleString(isArabic ? "ar-EG" : "en-GB") : "—"}
                    </dd>
                  </div>
                </dl>
              </div>
            </div>
          </div>
        </section>

        <Card title={t("reconciliation.figures.title")}>
          <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {FIGURE_KEYS.map((key) => (
              <Figure
                key={key}
                label={t(`reconciliation.figures.${key}`)}
                value={formatFigure(key, data?.figures?.[key], language)}
              />
            ))}
          </dl>
        </Card>

        <SectionCard
          id="reconciliation-internal"
          title={t("reconciliation.internal.title")}
          subtitle={t("reconciliation.internal.subtitle")}
          status={report.status}
          error={report.error}
          onRetry={report.refresh}
          skeletonHeight={280}
        >
          <AnalyticsTable
            columns={[
              {
                key: "check", label: t("reconciliation.internal.columns.check"),
                cellClassName: "font-semibold text-[var(--text)]",
                render: (row) => (
                  <span className="min-w-0">
                    <span className="block">{checkLabel(row)}</span>
                    {row.note ? (
                      <span className="mt-0.5 block max-w-[46ch] text-[11px] font-normal leading-4 text-[var(--text-tertiary)]">
                        {t(`reconciliation.note.${row.note}`, { defaultValue: "" })}
                      </span>
                    ) : null}
                  </span>
                ),
              },
              { key: "left", label: t("reconciliation.internal.columns.left"), align: "end", render: (row) => <span title={row.leftLabel}>{value(row, "left")}</span> },
              { key: "right", label: t("reconciliation.internal.columns.right"), align: "end", render: (row) => <span title={row.rightLabel}>{value(row, "right")}</span> },
              {
                key: "delta", label: t("reconciliation.internal.columns.delta"), align: "end",
                render: (row) => (row.delta === null ? <Blank /> : <span className={row.status === "fail" ? "font-bold text-[var(--danger)]" : ""}>{formatNumber(row.delta, language)}</span>),
              },
              {
                key: "status", label: t("reconciliation.internal.columns.status"), align: "end",
                render: (row) => (
                  <span className={`font-semibold uppercase ${CHECK_STATUS_STYLE[row.status] || ""}`}>
                    {t(`reconciliation.status.${row.status === "pass" ? "passed" : row.status === "fail" ? "failed" : "unavailable"}`)}
                  </span>
                ),
              },
            ]}
            rows={internal}
            emptyLabel={t("reconciliation.internal.empty")}
            rowKey={(row) => `${row.group}.${row.metric}`}
            minWidth={820}
          />
        </SectionCard>

        <SectionCard
          id="reconciliation-declared"
          title={t("reconciliation.declared.title")}
          subtitle={t("reconciliation.declared.subtitle")}
          status={report.status}
          error={report.error}
          onRetry={report.refresh}
          skeletonHeight={240}
        >
          {meta?.accountingAvailable === false ? (
            <p className="rounded-xl border border-dashed border-[var(--warning)]/40 bg-[var(--warning-soft)] px-4 py-6 text-center text-[13px] text-[var(--text-secondary)]">
              {t("reconciliation.declared.unavailable")}
            </p>
          ) : (
            <>
              <AnalyticsTable
                columns={[
                  {
                    key: "check", label: t("reconciliation.declared.columns.check"),
                    cellClassName: "font-semibold text-[var(--text)]",
                    render: (row) => (
                      <span className="min-w-0">
                        <span className="block">{checkLabel(row)}</span>
                        {row.note ? (
                          <span className="mt-0.5 block max-w-[46ch] text-[11px] font-normal leading-4 text-[var(--text-tertiary)]">
                            {t(`reconciliation.note.${row.note}`, { defaultValue: "" })}
                          </span>
                        ) : null}
                      </span>
                    ),
                  },
                  { key: "reporting", label: t("reconciliation.declared.columns.reporting"), align: "end", render: (row) => value(row, "left") },
                  { key: "accounting", label: t("reconciliation.declared.columns.accounting"), align: "end", render: (row) => value(row, "right") },
                  {
                    key: "delta", label: t("reconciliation.declared.columns.delta"), align: "end",
                    render: (row) => (row.delta === null ? <Blank /> : formatNumber(row.delta, language)),
                  },
                ]}
                rows={declared}
                emptyLabel={t("reconciliation.declared.empty")}
                rowKey={(row) => `${row.group}.${row.metric}`}
                minWidth={720}
              />

              <div className="mt-4">
                <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.07em] text-[var(--text-tertiary)]">
                  {t("reconciliation.declared.corrections")}
                </h4>
                <ul className="space-y-1">
                  {(meta?.declaredDivergences || []).map((entry) => (
                    <li key={entry.id} className="flex items-start gap-2 text-[12px] leading-5 text-[var(--text-secondary)]">
                      <code className="shrink-0 text-[11px] text-[var(--text-tertiary)]">{entry.id}</code>
                      <span>{t(`reconciliation.correction.${entry.key}`, { defaultValue: entry.key })}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}
        </SectionCard>

        <SectionCard
          id="reconciliation-warnings"
          title={t("reconciliation.warnings.title")}
          subtitle={t("reconciliation.warnings.subtitle")}
          status={report.status}
          error={report.error}
          onRetry={report.refresh}
          collapsible
          openOnDesktop
          skeletonHeight={200}
        >
          {!data?.sourceWarnings?.length ? (
            <p className="text-[13px] text-[var(--text-tertiary)]">{t("reconciliation.warnings.empty")}</p>
          ) : (
            <ul className="space-y-2">
              {data.sourceWarnings.map((warning) => (
                <li key={warning.code} className="flex items-start gap-2.5 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] p-3">
                  <Info className="mt-px h-4 w-4 shrink-0 text-[var(--info)]" aria-hidden="true" />
                  <div className="min-w-0">
                    <code className="text-[11px] text-[var(--text-tertiary)]">{warning.code}</code>
                    <p className="mt-0.5 text-[13px] leading-5 text-[var(--text)]">
                      {t(`overview.warnings.${warning.code}`, { defaultValue: warning.message || warning.code })}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <PeriodFootnote period={{ from: filters.from, to: filters.to }} comparison={meta?.comparison} />
      </div>
    </ReportsPage>
  );
}

const FIGURE_KEYS = [
  "netSales", "returns", "grossProfit", "grossMargin",
  "orders", "itemsSold", "customerRevenue", "walkInRevenue",
  "inventoryValue", "unitsInStock", "stockedProducts", "purchaseSpend",
  "accountingNetSales", "accountingGrossProfit", "accountingCogs", "attributionCoverage",
];

const PERCENT_FIGURES = new Set(["grossMargin", "attributionCoverage"]);
const COUNT_FIGURES = new Set(["orders", "itemsSold", "unitsInStock", "stockedProducts"]);

const formatFigure = (key, value, language) => {
  if (value === null || value === undefined) return "—";
  if (PERCENT_FIGURES.has(key)) return formatPercentValue(value, language) || "—";
  if (COUNT_FIGURES.has(key)) return formatNumber(value, language);
  return formatMoney(value, language) || "—";
};

function Figure({ label, value }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-[11px] font-semibold text-[var(--text-tertiary)] 2xl:text-[12px]">{label}</dt>
      <dd className="mt-0.5 text-[16px] font-bold tabular-nums text-[var(--text)] 2xl:text-[18px]">{value}</dd>
    </div>
  );
}

function Stat({ label, value, tone, language }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold text-[var(--text-tertiary)]">{label}</dt>
      <dd className={`mt-0.5 text-[18px] font-black tabular-nums ${tone || "text-[var(--text)]"}`}>
        {value === null || value === undefined ? "—" : formatNumber(value, language)}
      </dd>
    </div>
  );
}

/* --------------------------------------------------------------------- export */

const buildExportSheets = ({ t, language, data, meta, checkLabel }) => {
  if (!data) return { sheets: [], language };
  const sheets = [];

  sheets.push({
    name: t("reconciliation.figures.title"),
    columns: [
      { key: "metric", label: t("reconciliation.internal.columns.check") },
      { key: "value", label: t("reconciliation.figures.netSales"), align: "end" },
    ],
    rows: [
      // The verdict and the timestamp travel with the file: a reconciliation export with
      // no "when" and no "did it pass" is a table of numbers with nothing to say.
      { metric: t("reconciliation.status.verifiedAt"), value: meta?.verifiedAt || "" },
      { metric: t(`reconciliation.status.${data.status}`), value: `${data.counts.passed}/${data.counts.total}` },
      ...FIGURE_KEYS.filter((key) => data.figures?.[key] !== null && data.figures?.[key] !== undefined)
        .map((key) => ({ metric: t(`reconciliation.figures.${key}`), value: data.figures[key] })),
    ],
  });

  const internal = (data.checks || []).filter((entry) => entry.kind === "internal");
  if (internal.length) {
    sheets.push({
      name: t("reconciliation.internal.title"),
      columns: [
        { key: "check", label: t("reconciliation.internal.columns.check") },
        { key: "left", label: t("reconciliation.internal.columns.left"), align: "end" },
        { key: "right", label: t("reconciliation.internal.columns.right"), align: "end" },
        { key: "delta", label: t("reconciliation.internal.columns.delta"), align: "end" },
        { key: "status", label: t("reconciliation.internal.columns.status"), kind: "text" },
      ],
      rows: internal.map((entry) => ({ ...entry, check: checkLabel(entry) })),
    });
  }

  const declared = (data.checks || []).filter((entry) => entry.kind === "declared");
  if (declared.length) {
    sheets.push({
      name: t("reconciliation.declared.title"),
      columns: [
        { key: "check", label: t("reconciliation.declared.columns.check") },
        { key: "left", label: t("reconciliation.declared.columns.reporting"), align: "end" },
        { key: "right", label: t("reconciliation.declared.columns.accounting"), align: "end" },
        { key: "delta", label: t("reconciliation.declared.columns.delta"), align: "end" },
      ],
      rows: declared.map((entry) => ({ ...entry, check: checkLabel(entry) })),
    });
  }

  if (data.sourceWarnings?.length) {
    sheets.push({
      name: t("reconciliation.warnings.title"),
      columns: [
        { key: "code", label: t("reconciliation.internal.columns.check"), kind: "text" },
        { key: "message", label: t("reconciliation.warnings.subtitle"), kind: "text" },
      ],
      rows: data.sourceWarnings.map((warning) => ({ code: warning.code, message: warning.message || "" })),
    });
  }

  return { sheets, language };
};
