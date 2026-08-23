import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import useAnalyticsFilters from "../hooks/useAnalyticsFilters";
import useAnalyticsResource from "../hooks/useAnalyticsResource";
import { fetchCouponPerformance } from "../services/couponsReportApi";

import PeriodSelector from "../components/PeriodSelector";
import { Card, ReportsHeader, ReportsPage } from "../components/ReportsLayout";
import { formatMoney } from "../lib/metricFormat";

/**
 * Coupon performance.
 *
 * Every figure comes from coupon_redemptions with the reversed rows excluded, so a
 * cancelled or fully-returned order stops counting as a coupon success. The "with vs
 * without" pair is drawn over the SAME window for both sides — comparing a two-week
 * campaign against a year of baseline orders would flatter it.
 */
export default function CouponsPerformance() {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const isArabic = String(language || "").toLowerCase().startsWith("ar");
  const { filters, allowedComparisons, setPreset, setCompare } = useAnalyticsFilters();

  const params = useMemo(() => ({ from: filters.from, to: filters.to }), [filters.from, filters.to]);
  const { status, data, error, refresh } = useAnalyticsResource(fetchCouponPerformance, params);

  const rText = (key, fallback, options = {}) => t(`reports.coupons.${key}`, { defaultValue: fallback, ...options });
  const money = (value) => formatMoney(Number(value || 0), language);
  const pct = (value) => `${Number(value || 0).toFixed(2)}%`;
  const totals = data?.totals || null;
  const campaigns = Array.isArray(data?.campaigns) ? data.campaigns : [];
  const busy = status === "loading" || status === "refreshing";

  const forbidden = error?.status === 403;
  const uplift = totals && Number(totals.average_without_coupon || 0) > 0
    ? ((Number(totals.average_with_coupon || 0) - Number(totals.average_without_coupon)) / Number(totals.average_without_coupon)) * 100
    : null;

  const tiles = totals
    ? [
        { key: "redemptions", label: rText("tiles.redemptions", "مرات الاستخدام"), value: Number(totals.redemptions || 0).toLocaleString() },
        { key: "discount", label: rText("tiles.discount", "إجمالي الخصم"), value: money(totals.discount_total) },
        { key: "netSales", label: rText("tiles.netSales", "صافي المبيعات بعد الخصم"), value: money(totals.net_sales) },
        {
          key: "conversion",
          label: totals.conversion_basis === "sent"
            ? rText("tiles.conversionSent", "التحويل (من المُرسَل)")
            : rText("tiles.conversionGenerated", "التحويل (من المُولَّد)"),
          value: pct(totals.conversion_rate),
        },
        {
          key: "avgWith",
          label: rText("tiles.avgWith", "متوسط الطلب بكوبون"),
          value: money(totals.average_with_coupon),
          hint: uplift === null
            ? ""
            : rText("tiles.upliftHint", "{{pct}} مقارنة بالطلب بدون كوبون", { pct: `${uplift >= 0 ? "+" : ""}${uplift.toFixed(1)}%` }),
        },
        {
          key: "avgWithout",
          label: rText("tiles.avgWithout", "متوسط الطلب بدون كوبون"),
          value: money(totals.average_without_coupon),
          hint: rText("tiles.baselineHint", "من {{count}} طلب في نفس الفترة", { count: Number(totals.baseline_orders || 0).toLocaleString() }),
        },
      ]
    : [];

  return (
    <ReportsPage dir={isArabic ? "rtl" : "ltr"}>
      <ReportsHeader
        title={rText("title", "أداء الكوبونات")}
        subtitle={rText("subtitle", "كل الأرقام بتستبعد الاستخدامات الملغاة، والمقارنة بين الطلبات بكوبون وبدونه على نفس الفترة.")}
      >
        <PeriodSelector
          filters={filters}
          allowedComparisons={allowedComparisons}
          onPresetChange={setPreset}
          onCompareChange={setCompare}
          onRefresh={refresh}
          busy={busy}
        />
      </ReportsHeader>

      {forbidden ? (
        <Card>
          <p className="text-[13px] text-[var(--text-secondary)]">{rText("forbidden", "مالكش صلاحية على تقارير التسويق.")}</p>
        </Card>
      ) : error ? (
        <Card>
          <p className="text-[13px] text-[var(--text-secondary)]">{error.message || rText("failed", "تعذر تحميل التقرير.")}</p>
        </Card>
      ) : (
        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
            {(tiles.length ? tiles : Array.from({ length: 6 }, (_, index) => ({ key: `skeleton-${index}` }))).map((tile) => (
              <Card key={tile.key}>
                {tile.label ? (
                  <>
                    <div className="text-[11px] font-semibold text-[var(--text-tertiary)]">{tile.label}</div>
                    <div className="mt-1.5 text-[20px] font-black tabular-nums text-[var(--text)] 2xl:text-[22px]">{tile.value}</div>
                    {tile.hint ? <div className="mt-1 text-[11px] text-[var(--text-tertiary)]">{tile.hint}</div> : null}
                  </>
                ) : (
                  <div className="h-[52px] animate-pulse rounded-[var(--radius-control)] bg-[var(--border)]/40" />
                )}
              </Card>
            ))}
          </div>

          <Card
            title={rText("table.title", "الحملات")}
            subtitle={rText("table.subtitle", "مرتبة حسب إجمالي الخصم المصروف")}
            flush
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-[13px]">
                <thead>
                  <tr className="border-b border-[var(--border)] text-[11px] text-[var(--text-tertiary)]">
                    <th className="px-4 py-2.5 text-start font-semibold">{rText("table.campaign", "الحملة")}</th>
                    <th className="px-4 py-2.5 text-start font-semibold">{rText("table.discount", "الخصم")}</th>
                    <th className="px-4 py-2.5 text-end font-semibold">{rText("table.generated", "مولَّد")}</th>
                    <th className="px-4 py-2.5 text-end font-semibold">{rText("table.sent", "مُرسَل")}</th>
                    <th className="px-4 py-2.5 text-end font-semibold">{rText("table.redemptions", "مستخدم")}</th>
                    <th className="px-4 py-2.5 text-end font-semibold">{rText("table.conversion", "التحويل")}</th>
                    <th className="px-4 py-2.5 text-end font-semibold">{rText("table.discountTotal", "إجمالي الخصم")}</th>
                    <th className="px-4 py-2.5 text-end font-semibold">{rText("table.netSales", "صافي المبيعات")}</th>
                  </tr>
                </thead>
                <tbody>
                  {busy && !campaigns.length ? (
                    Array.from({ length: 4 }).map((_, index) => (
                      <tr key={index}><td colSpan={8} className="h-12 animate-pulse bg-[var(--border)]/20" /></tr>
                    ))
                  ) : campaigns.length ? (
                    campaigns.map((row) => (
                      <tr key={row.id} className="border-b border-[var(--border)] last:border-0">
                        <td className="px-4 py-2.5">
                          <div className="font-semibold text-[var(--text)]">{row.name}</div>
                          <div className="text-[11px] text-[var(--text-tertiary)]">
                            {row.code_mode === "shared" ? row.shared_code : rText("table.uniqueCodes", "أكواد فردية")}
                            {row.is_active ? "" : ` · ${rText("table.inactive", "متوقفة")}`}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-[var(--text-secondary)]">
                          {row.discount_type === "percentage"
                            ? `${row.discount_value}%`
                            : row.discount_type === "free_shipping"
                              ? rText("table.freeShipping", "شحن مجاني")
                              : money(row.discount_value)}
                        </td>
                        <td className="px-4 py-2.5 text-end tabular-nums text-[var(--text-secondary)]">{row.generated.toLocaleString()}</td>
                        <td className="px-4 py-2.5 text-end tabular-nums text-[var(--text-secondary)]">{row.sent.toLocaleString()}</td>
                        <td className="px-4 py-2.5 text-end tabular-nums text-[var(--text)]">{row.redemptions.toLocaleString()}</td>
                        <td className="px-4 py-2.5 text-end tabular-nums text-[var(--text-secondary)]">{pct(row.conversion_rate)}</td>
                        <td className="px-4 py-2.5 text-end tabular-nums text-[var(--text-secondary)]">{money(row.discount_total)}</td>
                        <td className="px-4 py-2.5 text-end tabular-nums text-[var(--text)]">{money(row.net_sales)}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={8} className="px-4 py-10 text-center text-[13px] text-[var(--text-secondary)]">
                        {rText("table.empty", "مفيش استخدام لأي كوبون في الفترة دي.")}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}
    </ReportsPage>
  );
}
