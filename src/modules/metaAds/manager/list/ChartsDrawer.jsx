import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Drawer, LoadingState, Select } from "../../../../shared/ui";
import { metaErrorMessage } from "../../shared/metaAdsApi";
import { formatMoney, localeFor } from "../../shared/metaAdsFormat";
import { managerApi } from "./managerApi";

const RESULTS_COLOR = "var(--success, #16a34a)";
const SPEND_COLOR = "var(--ma-blue, #1877f2)";
const AXIS_COLOR = "var(--muted, #6b7280)";
const GRID_COLOR = "var(--border, #e5e7eb)";
const BREAKDOWNS = ["age", "gender", "platform", "country"];

const tick = { fontSize: 11, fill: AXIS_COLOR };

// "عرض الرسوم البيانية": daily results/spend (dual axis) + a breakdown bar chart.
export default function ChartsDrawer({ target, accountId, days, currency, onClose }) {
  const { t, i18n } = useTranslation();
  const locale = localeFor(i18n.language);
  const [series, setSeries] = useState({ loading: true, points: [], error: "" });
  const [breakdown, setBreakdown] = useState("age");
  const [split, setSplit] = useState({ loading: true, rows: [], error: "" });
  const open = Boolean(target);
  const level = target?.level;
  const id = target?.row?.id;

  useEffect(() => {
    if (!open) return undefined;
    let alive = true;
    setSeries({ loading: true, points: [], error: "" });
    managerApi.series({ account_id: accountId, level, id, days })
      .then((data) => alive && setSeries({ loading: false, points: data?.points || [], error: "" }))
      .catch((error) => alive && setSeries({ loading: false, points: [], error: metaErrorMessage(error) }));
    return () => {
      alive = false;
    };
  }, [open, accountId, level, id, days]);

  useEffect(() => {
    if (!open) return undefined;
    let alive = true;
    setSplit({ loading: true, rows: [], error: "" });
    managerApi.breakdown({ account_id: accountId, level, id, breakdown, days })
      .then((data) => alive && setSplit({ loading: false, rows: data?.rows || [], error: data?.warning || "" }))
      .catch((error) => alive && setSplit({ loading: false, rows: [], error: metaErrorMessage(error) }));
    return () => {
      alive = false;
    };
  }, [open, accountId, level, id, breakdown, days]);

  const resultsLabel = t("metaAdsManager.charts.results");
  const spendLabel = t("metaAdsManager.charts.spend");
  const emptyText = t("metaAdsManager.charts.empty");
  const moneyTip = (value, name) => (name === spendLabel ? formatMoney(value, currency, locale) : Number(value).toLocaleString(locale));
  const points = series.points.map((point) => ({ ...point, label: String(point.date).slice(5) }));
  const splitRows = split.rows.map((row) => ({
    ...row,
    label: t(`metaAdsManager.charts.values.${row.key}`, { defaultValue: row.key }),
  }));

  return (
    <div className="ma-charts">
      <Drawer open={open} onClose={onClose} title={t("metaAdsManager.charts.title")} description={target?.row?.name || ""} placement="end">
        <section className="ma-charts__section">
          <h3 className="ma-charts__heading">{t("metaAdsManager.charts.daily")}</h3>
          {series.loading ? (
            <LoadingState />
          ) : points.length ? (
            <div className="ma-charts__plot">
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke={GRID_COLOR} strokeDasharray="3 3" />
                  <XAxis dataKey="label" tick={tick} stroke={AXIS_COLOR} />
                  <YAxis yAxisId="results" orientation="left" tick={tick} stroke={AXIS_COLOR} width={40} allowDecimals={false} />
                  <YAxis yAxisId="spend" orientation="right" tick={tick} stroke={AXIS_COLOR} width={48} />
                  <Tooltip formatter={moneyTip} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line yAxisId="results" type="monotone" dataKey="results" name={resultsLabel} stroke={RESULTS_COLOR} strokeWidth={2} dot={{ r: 2 }} />
                  <Line yAxisId="spend" type="monotone" dataKey="spend" name={spendLabel} stroke={SPEND_COLOR} strokeWidth={2} dot={{ r: 2 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="ma-charts__empty">{series.error || emptyText}</p>
          )}
        </section>

        <section className="ma-charts__section">
          <div className="ma-charts__split-head">
            <h3 className="ma-charts__heading">{t("metaAdsManager.charts.breakdown")}</h3>
            <Select
              aria-label={t("metaAdsManager.charts.breakdown")}
              className="ma-charts__select"
              value={breakdown}
              onChange={(event) => setBreakdown(event.target.value)}
            >
              {BREAKDOWNS.map((key) => (
                <option key={key} value={key}>{t(`metaAdsManager.charts.breakdowns.${key}`)}</option>
              ))}
            </Select>
          </div>
          {split.loading ? (
            <LoadingState />
          ) : splitRows.length ? (
            <div className="ma-charts__plot">
              <ResponsiveContainer width="100%" height={Math.max(220, splitRows.length * 34)}>
                <BarChart data={splitRows} layout="vertical" margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke={GRID_COLOR} strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" xAxisId="results" orientation="bottom" tick={tick} stroke={AXIS_COLOR} allowDecimals={false} />
                  <XAxis type="number" xAxisId="spend" orientation="top" tick={tick} stroke={AXIS_COLOR} />
                  <YAxis type="category" dataKey="label" tick={tick} stroke={AXIS_COLOR} width={90} />
                  <Tooltip formatter={moneyTip} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar xAxisId="results" dataKey="results" name={resultsLabel} fill={RESULTS_COLOR} radius={[0, 3, 3, 0]} />
                  <Bar xAxisId="spend" dataKey="spend" name={spendLabel} fill={SPEND_COLOR} radius={[0, 3, 3, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="ma-charts__empty">{split.error || emptyText}</p>
          )}
        </section>
      </Drawer>
    </div>
  );
}
