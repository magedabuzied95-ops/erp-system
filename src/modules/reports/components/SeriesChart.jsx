import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Area, Bar, CartesianGrid, ComposedChart, Line, Tooltip, XAxis, YAxis } from "recharts";

import { formatCompactNumber } from "../lib/metricFormat";

/**
 * A time series described by a series spec, for the reporting pages that need a trend
 * but not the Executive Overview's specific net-sales-and-profit shape.
 *
 * The measurement below is the same one OverviewTrendChart uses, and it is here for the
 * same reason: an SVG chart cannot size itself from CSS, ResponsiveContainer adds a
 * wrapper whose own width participates in the measurement, and neither a ResizeObserver
 * nor a window-resize listener fires in every environment on its own. Both are wired up;
 * whichever arrives first wins, and the setter ignores no-ops.
 *
 * A null point is left as null rather than coerced to 0, so recharts draws a GAP. A
 * metric that could not be computed must not appear as a drop to zero.
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

const heightForWidth = (width) => {
  if (!width) return 280;
  if (width >= 1100) return 360;
  if (width >= 820) return 320;
  if (width >= 560) return 290;
  return 230;
};

export const formatBucket = (bucket, granularity, language) => {
  const date = new Date(bucket);
  if (Number.isNaN(date.getTime())) return String(bucket ?? "");
  const locale = String(language || "").toLowerCase().startsWith("ar") ? "ar-EG" : "en-GB";
  if (granularity === "hour") return date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  if (granularity === "month") return date.toLocaleDateString(locale, { month: "short", year: "2-digit" });
  if (granularity === "week") return date.toLocaleDateString(locale, { day: "2-digit", month: "short" });
  return date.toLocaleDateString(locale, { day: "2-digit", month: "short" });
};

const PALETTE = ["var(--primary)", "var(--info)", "var(--success)"];

export default function SeriesChart({
  points = [],
  granularity = "day",
  series = [],
  emptyLabel,
  height,
  formatTooltipValue,
}) {
  const { i18n } = useTranslation();
  const language = i18n.language;
  const isArabic = String(language || "").toLowerCase().startsWith("ar");
  const hostRef = useRef(null);
  const observedWidth = useObservedWidth(hostRef);
  const chartHeight = height ?? heightForWidth(observedWidth);

  const data = useMemo(
    () => points.map((point) => ({ ...point, label: formatBucket(point.bucket, granularity, language) })),
    [points, granularity, language]
  );

  if (!data.length) {
    return (
      <div className="flex h-[200px] items-center justify-center rounded-xl border border-dashed border-[var(--border)] text-[13px] text-[var(--text-tertiary)]">
        {emptyLabel}
      </div>
    );
  }

  return (
    <div className="min-w-0">
      {/* Legend above the plot: recharts' own legend steals plot height and does not
          follow the RTL reading order. */}
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] font-semibold 2xl:text-[12px]">
        {series.map((entry, index) => (
          <span key={entry.key} className="inline-flex items-center gap-1.5 text-[var(--text-secondary)]">
            <span
              aria-hidden="true"
              className="inline-block h-2 w-3.5 rounded-sm"
              style={{ background: entry.color || PALETTE[index % PALETTE.length] }}
            />
            {entry.label}
          </span>
        ))}
      </div>

      <div ref={hostRef} className="w-full min-w-0 overflow-hidden">
        {observedWidth > 0 ? (
          <ComposedChart
            width={observedWidth}
            height={chartHeight}
            data={data}
            margin={{ top: 6, right: 8, bottom: 0, left: 8 }}
          >
            <CartesianGrid stroke="var(--border)" strokeOpacity={0.5} vertical={false} />
            <XAxis
              dataKey="label"
              reversed={isArabic}
              tick={{ fill: "var(--text-tertiary)", fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: "var(--border)" }}
              minTickGap={18}
            />
            <YAxis
              orientation={isArabic ? "right" : "left"}
              tick={{ fill: "var(--text-tertiary)", fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={52}
              tickFormatter={(value) => formatCompactNumber(value, language) ?? ""}
            />
            <Tooltip
              cursor={{ stroke: "var(--border-strong)", strokeWidth: 1 }}
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                return (
                  <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] px-2.5 py-2 shadow-[var(--shadow-card)]">
                    <p className="mb-1 text-[11px] font-bold text-[var(--text)]">{label}</p>
                    {payload.map((entry) => (
                      <p key={entry.dataKey} className="flex items-center gap-2 text-[11px] text-[var(--text-secondary)]">
                        <span className="inline-block h-2 w-2 rounded-sm" style={{ background: entry.color }} aria-hidden="true" />
                        <span>{entry.name}</span>
                        <span className="ms-auto font-bold tabular-nums text-[var(--text)]">
                          {formatTooltipValue
                            ? formatTooltipValue(entry.value, entry.dataKey, language)
                            : formatCompactNumber(entry.value, language) ?? "—"}
                        </span>
                      </p>
                    ))}
                  </div>
                );
              }}
            />
            {series.map((entry, index) => {
              const color = entry.color || PALETTE[index % PALETTE.length];
              if (entry.type === "bar") {
                return <Bar key={entry.key} dataKey={entry.key} name={entry.label} fill={color} fillOpacity={0.75} radius={[3, 3, 0, 0]} />;
              }
              if (entry.type === "line") {
                return (
                  <Line
                    key={entry.key}
                    type="monotone"
                    dataKey={entry.key}
                    name={entry.label}
                    stroke={color}
                    strokeWidth={2}
                    strokeDasharray={entry.dashed ? "5 4" : undefined}
                    dot={false}
                    connectNulls={false}
                  />
                );
              }
              return (
                <Area
                  key={entry.key}
                  type="monotone"
                  dataKey={entry.key}
                  name={entry.label}
                  stroke={color}
                  strokeWidth={2}
                  fill={color}
                  fillOpacity={0.14}
                  connectNulls={false}
                />
              );
            })}
          </ComposedChart>
        ) : (
          // Nothing renders before a real measurement, or the first paint is 0-wide and
          // the chart never recovers its true width.
          <div style={{ height: chartHeight }} />
        )}
      </div>
    </div>
  );
}
