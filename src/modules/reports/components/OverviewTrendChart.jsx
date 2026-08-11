import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatCompactNumber, formatPercentValue } from "../lib/metricFormat";
import { formatCurrency, formatNumber } from "../../../shared/lib/currency";

/**
 * Net sales (area) with gross profit (line).
 *
 * A bucket whose cost coverage is too thin returns null profit from the backend, and
 * recharts leaves a gap there — deliberately, so a missing profit reads as missing
 * rather than as a drop to zero.
 */

/**
 * Width of the chart host, measured directly and handed to recharts explicitly.
 *
 * An SVG chart cannot size itself from CSS, so something has to measure the column.
 * ResponsiveContainer would do it, but it adds a wrapper whose own width participates
 * in the measurement — and the wrapper only shrinks if every ancestor is min-w-0.
 * Measuring the host we control, and passing an explicit pixel width, keeps the
 * measurement and the layout in one place.
 *
 * Both signals are wired up because neither alone covers every case: a ResizeObserver
 * catches layout changes that leave the window alone (a sidebar opening, a panel
 * collapsing), and window.resize catches environments that reflow the layout without
 * notifying observers. Whichever fires first wins; the state setter ignores no-ops.
 */
const useObservedWidth = (ref) => {
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;

    const measure = () => {
      const next = Math.round(node.getBoundingClientRect().width);
      setWidth((current) => (Math.abs(current - next) > 1 ? next : current));
    };

    measure();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    observer?.observe(node);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [ref]);

  return width;
};

export default function OverviewTrendChart({ trend = [], granularity = "day", showProfit = true, height = 260 }) {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const isArabic = String(language || "").toLowerCase().startsWith("ar");
  const hostRef = useRef(null);
  const observedWidth = useObservedWidth(hostRef);

  const data = useMemo(
    () =>
      trend.map((point) => ({
        ...point,
        label: formatBucket(point.bucket, granularity, language),
      })),
    [trend, granularity, language]
  );

  if (!data.length) {
    return (
      <div className="flex h-[220px] items-center justify-center rounded-xl border border-dashed border-[var(--border)] text-[13px] text-[var(--text-tertiary)]">
        {t("overview.trend.empty")}
      </div>
    );
  }

  return (
    <div ref={hostRef} style={{ height }} className="w-full min-w-0 overflow-hidden">
      {observedWidth > 0 ? (
        <ComposedChart width={observedWidth} height={height} data={data} margin={{ top: 8, right: 8, bottom: 4, left: 8 }}>
          <defs>
            <linearGradient id="overviewNetSales" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.22} />
              <stop offset="100%" stopColor="var(--primary)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="label"
            reversed={isArabic}
            tick={{ fontSize: 11, fill: "var(--text-tertiary)" }}
            tickLine={false}
            axisLine={{ stroke: "var(--border)" }}
            minTickGap={16}
          />
          <YAxis
            orientation={isArabic ? "right" : "left"}
            tick={{ fontSize: 11, fill: "var(--text-tertiary)" }}
            tickLine={false}
            axisLine={false}
            width={64}
            tickFormatter={(value) => formatCompactNumber(value, language) || ""}
          />
          <Tooltip
            cursor={{ stroke: "var(--border-strong)", strokeWidth: 1 }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const point = payload[0].payload;
              return (
                <div
                  dir={isArabic ? "rtl" : "ltr"}
                  className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-3 text-start shadow-[var(--shadow-overlay)]"
                >
                  <div className="text-[12px] font-bold text-[var(--text)]">{point.label}</div>
                  <dl className="mt-2 space-y-1 text-[11px]">
                    <Row label={t("overview.trend.netSales")} value={formatCurrency(point.netSales, language)} />
                    {showProfit ? (
                      <Row
                        label={t("overview.trend.grossProfit")}
                        value={
                          point.grossProfit === null
                            ? t("overview.trend.profitUnavailable")
                            : formatCurrency(point.grossProfit, language)
                        }
                        muted={point.grossProfit === null}
                      />
                    ) : null}
                    {showProfit && point.grossMargin !== null ? (
                      <Row label={t("overview.trend.margin")} value={formatPercentValue(point.grossMargin, language)} />
                    ) : null}
                    <Row label={t("overview.trend.orders")} value={formatNumber(point.orders, language)} />
                  </dl>
                </div>
              );
            }}
          />
          <Area
            type="monotone"
            dataKey="netSales"
            stroke="var(--primary)"
            strokeWidth={2}
            fill="url(#overviewNetSales)"
            name={t("overview.trend.netSales")}
          />
          {showProfit ? (
            <Line
              type="monotone"
              dataKey="grossProfit"
              stroke="var(--info)"
              strokeWidth={2}
              dot={false}
              connectNulls={false}
              name={t("overview.trend.grossProfit")}
            />
          ) : null}
        </ComposedChart>
      ) : null}
    </div>
  );
}

function Row({ label, value, muted = false }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-[var(--text-tertiary)]">{label}</dt>
      <dd className={`font-bold tabular-nums ${muted ? "text-[var(--text-tertiary)]" : "text-[var(--text)]"}`}>{value}</dd>
    </div>
  );
}

function formatBucket(bucket, granularity, language) {
  if (!bucket) return "";
  const date = new Date(bucket);
  if (Number.isNaN(date.getTime())) return String(bucket);
  const locale = String(language || "").toLowerCase().startsWith("ar") ? "ar-EG" : "en-GB";
  if (granularity === "hour") return date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  if (granularity === "month") return date.toLocaleDateString(locale, { month: "short", year: "2-digit" });
  return date.toLocaleDateString(locale, { day: "2-digit", month: "short" });
}
