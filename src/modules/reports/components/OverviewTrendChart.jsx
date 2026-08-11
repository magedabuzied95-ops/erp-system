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
const useObservedBox = (ref) => {
  const [box, setBox] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;

    const measure = () => {
      const rect = node.getBoundingClientRect();
      const next = { width: Math.round(rect.width), height: Math.round(rect.height) };
      setBox((current) =>
        Math.abs(current.width - next.width) > 1 || Math.abs(current.height - next.height) > 1 ? next : current
      );
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

  return box;
};

/**
 * Chart height follows the room available.
 *
 * A fixed 260px read as a strip on a 1080p monitor, and a month of daily buckets had
 * no vertical range to show shape in. Scaling with the measured width keeps a sensible
 * plot aspect from a phone up to a wide desktop.
 */
const heightForWidth = (width) => {
  if (!width) return 300;
  if (width >= 1100) return 400;
  if (width >= 820) return 360;
  if (width >= 560) return 320;
  return 250;
};

export default function OverviewTrendChart({ trend = [], granularity = "day", showProfit = true, height }) {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const isArabic = String(language || "").toLowerCase().startsWith("ar");
  const hostRef = useRef(null);
  const { width: observedWidth } = useObservedBox(hostRef);
  const chartHeight = height ?? heightForWidth(observedWidth);

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
    <div className="min-w-0">
      {/* Legend above the plot: two series need naming, and recharts' own legend
          steals plot height and does not follow the RTL reading order. */}
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] font-semibold 2xl:text-[12px]">
        <span className="flex items-center gap-1.5 text-[var(--text-secondary)]">
          <span className="h-2 w-4 rounded-full bg-[var(--primary)]" aria-hidden="true" />
          {t("overview.trend.netSales")}
        </span>
        {showProfit ? (
          <span className="flex items-center gap-1.5 text-[var(--text-secondary)]">
            <span className="h-0.5 w-4 rounded-full bg-[var(--info)]" aria-hidden="true" />
            {t("overview.trend.grossProfit")}
          </span>
        ) : null}
      </div>

      <div ref={hostRef} style={{ height: chartHeight }} className="w-full min-w-0 overflow-hidden">
      {observedWidth > 0 ? (
        <ComposedChart width={observedWidth} height={chartHeight} data={data} margin={{ top: 10, right: 10, bottom: 4, left: 10 }}>
          <defs>
            <linearGradient id="overviewNetSales" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.28} />
              <stop offset="100%" stopColor="var(--primary)" stopOpacity={0.01} />
            </linearGradient>
          </defs>
          {/* Horizontal rules only, and solid rather than dashed: dashes at this
              density read as texture and compete with the series. */}
          <CartesianGrid stroke="var(--border)" strokeOpacity={0.5} vertical={false} />
          <XAxis
            dataKey="label"
            reversed={isArabic}
            tick={{ fontSize: 12, fill: "var(--text-tertiary)" }}
            tickLine={false}
            axisLine={{ stroke: "var(--border)" }}
            minTickGap={28}
            tickMargin={8}
          />
          <YAxis
            orientation={isArabic ? "right" : "left"}
            tick={{ fontSize: 12, fill: "var(--text-tertiary)" }}
            tickLine={false}
            axisLine={false}
            width={68}
            tickMargin={6}
            tickFormatter={(value) => formatCompactNumber(value, language) || ""}
          />
          <Tooltip
            cursor={{ stroke: "var(--border-strong)", strokeWidth: 1, strokeDasharray: "4 4" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const point = payload[0].payload;
              return (
                <div
                  dir={isArabic ? "rtl" : "ltr"}
                  className="min-w-[190px] rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] px-3.5 py-3 text-start shadow-[var(--shadow-overlay)]"
                >
                  <div className="border-b border-[var(--border)] pb-1.5 text-[13px] font-bold text-[var(--text)]">
                    {point.label}
                  </div>
                  <dl className="mt-2 space-y-1.5 text-[12px]">
                    <Row
                      label={t("overview.trend.netSales")}
                      value={formatCurrency(point.netSales, language)}
                      swatch="bg-[var(--primary)]"
                    />
                    {showProfit ? (
                      <Row
                        label={t("overview.trend.grossProfit")}
                        value={
                          point.grossProfit === null
                            ? t("overview.trend.profitUnavailable")
                            : formatCurrency(point.grossProfit, language)
                        }
                        muted={point.grossProfit === null}
                        swatch="bg-[var(--info)]"
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
          {/* Filled area for sales, bare line for profit: the two series are told
              apart by shape as well as hue, so they stay readable for a colour-blind
              reader and in a printout. */}
          <Area
            type="monotone"
            dataKey="netSales"
            stroke="var(--primary)"
            strokeWidth={2.5}
            fill="url(#overviewNetSales)"
            activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }}
            name={t("overview.trend.netSales")}
          />
          {showProfit ? (
            <Line
              type="monotone"
              dataKey="grossProfit"
              stroke="var(--info)"
              strokeWidth={2}
              strokeDasharray="5 3"
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }}
              connectNulls={false}
              name={t("overview.trend.grossProfit")}
            />
          ) : null}
        </ComposedChart>
      ) : null}
      </div>
    </div>
  );
}

function Row({ label, value, muted = false, swatch = null }) {
  return (
    <div className="flex items-center justify-between gap-5">
      <dt className="flex items-center gap-1.5 text-[var(--text-tertiary)]">
        {swatch ? <span className={`h-1.5 w-2.5 rounded-full ${swatch}`} aria-hidden="true" /> : null}
        {label}
      </dt>
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
