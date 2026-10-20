// The KPI / trend / button clicks / cost blocks shared by the Template Analytics page and the
// Analytics tab of one template. Data shape: server/modules/whatsappOfficial/analytics/analytics.service.js
// (summarizeTemplateRows).

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle } from "lucide-react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export const integer = (value) => Number(value || 0).toLocaleString("en-US");
export const percent = (value) => (value === null || value === undefined ? "—" : `${Number(value).toLocaleString("en-US", { maximumFractionDigits: 1 })}%`);
export const money = (value) => Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 4 });

export const cardClass = "rounded-2xl border border-white/10 bg-white/[0.035] p-4";

// Series colours: fixed hex on purpose (the M1 theme remaps Tailwind colour utilities).
const SERIES = { sent: "#60a5fa", delivered: "#34d399", read: "#22d3ee", clicks: "#f59e0b" };

export function StatCard({ label, value, hint }) {
  return (
    <div className="rounded-xl border border-white/10 bg-slate-950/40 p-3">
      <div className="text-[11px] font-bold text-slate-400">{label}</div>
      <div className="mt-1 text-xl font-black text-white">
        <span dir="ltr">{value}</span>
      </div>
      {hint ? <div className="mt-0.5 text-[11px] text-slate-500">{hint}</div> : null}
    </div>
  );
}

export function KpiCards({ kpis = {} }) {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
      <StatCard label={t("waOfficialAnalytics.kpi.sent")} value={integer(kpis.sent)} />
      <StatCard label={t("waOfficialAnalytics.kpi.delivered")} value={integer(kpis.delivered)} hint={t("waOfficialAnalytics.kpi.ofSent", { value: percent(kpis.delivery_rate) })} />
      <StatCard label={t("waOfficialAnalytics.kpi.read")} value={integer(kpis.read)} hint={t("waOfficialAnalytics.kpi.ofDelivered", { value: percent(kpis.read_of_delivered) })} />
      <StatCard label={t("waOfficialAnalytics.kpi.readRate")} value={percent(kpis.read_rate)} hint={t("waOfficialAnalytics.kpi.readOverSent")} />
      <StatCard label={t("waOfficialAnalytics.kpi.clicks")} value={integer(kpis.clicks)} hint={t("waOfficialAnalytics.kpi.ctr", { value: percent(kpis.ctr) })} />
      <StatCard
        label={t("waOfficialAnalytics.kpi.uniqueClicks")}
        value={kpis.unique_clicks === null || kpis.unique_clicks === undefined ? "—" : integer(kpis.unique_clicks)}
        hint={kpis.unique_clicks === null || kpis.unique_clicks === undefined ? t("waOfficialAnalytics.kpi.uniqueUnavailable") : ""}
      />
      <StatCard label={t("waOfficialAnalytics.kpi.deliveryRate")} value={percent(kpis.delivery_rate)} hint={t("waOfficialAnalytics.kpi.deliveredOverSent")} />
      <StatCard label={t("waOfficialAnalytics.kpi.readRate")} value={percent(kpis.read_of_delivered)} hint={t("waOfficialAnalytics.kpi.readOverDelivered")} />
    </div>
  );
}

export function TrendChart({ trend = [] }) {
  const { t } = useTranslation();
  return (
    <div className={cardClass}>
      <h3 className="text-sm font-black text-white">{t("waOfficialAnalytics.trend.title")}</h3>
      <div className="mt-3 h-72 w-full" dir="ltr">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={trend} margin={{ top: 8, right: 12, bottom: 4, left: -12 }}>
            <CartesianGrid stroke="rgba(148,163,184,0.15)" strokeDasharray="3 3" />
            <XAxis dataKey="date" tick={{ fill: "#94a3b8", fontSize: 11 }} tickLine={false} axisLine={{ stroke: "rgba(148,163,184,0.25)" }} minTickGap={24} />
            <YAxis allowDecimals={false} tick={{ fill: "#94a3b8", fontSize: 11 }} tickLine={false} axisLine={{ stroke: "rgba(148,163,184,0.25)" }} />
            <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, fontSize: 12 }} labelStyle={{ color: "#e2e8f0", fontWeight: 800 }} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Line type="monotone" dataKey="sent" name={t("waOfficialAnalytics.kpi.sent")} stroke={SERIES.sent} strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="delivered" name={t("waOfficialAnalytics.kpi.delivered")} stroke={SERIES.delivered} strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="read" name={t("waOfficialAnalytics.kpi.read")} stroke={SERIES.read} strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="clicks" name={t("waOfficialAnalytics.trend.clicks")} stroke={SERIES.clicks} strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// Literal keys so a missing translation stays greppable.
const buttonTypeLabel = (t, type = "") => {
  const value = String(type).toLowerCase();
  if (value.includes("url")) return t("waOfficialAnalytics.buttons.url");
  if (value.includes("quick")) return t("waOfficialAnalytics.buttons.quickReply");
  if (value.includes("phone") || value.includes("call")) return t("waOfficialAnalytics.buttons.phone");
  if (value.includes("copy") || value.includes("code")) return t("waOfficialAnalytics.buttons.copyCode");
  return t("waOfficialAnalytics.buttons.other");
};

export function ButtonClicks({ buttons = [] }) {
  const { t } = useTranslation();
  return (
    <div className={cardClass}>
      <h3 className="text-sm font-black text-white">{t("waOfficialAnalytics.buttons.title")}</h3>
      {buttons.length ? (
        <table className="mt-3 w-full text-xs">
          <thead className="text-[10.5px] uppercase tracking-[0.12em] text-slate-500">
            <tr>
              <th className="py-1.5 text-start">{t("waOfficialAnalytics.buttons.button")}</th>
              <th className="py-1.5 text-start">{t("waOfficialAnalytics.buttons.type")}</th>
              <th className="py-1.5 text-end">{t("waOfficialAnalytics.buttons.clicks")}</th>
            </tr>
          </thead>
          <tbody>
            {buttons.map((button) => (
              <tr key={`${button.type}|${button.button_content}`} className="border-t border-white/5 text-slate-200">
                <td className="py-2 font-bold" dir="auto">{button.button_content || "—"}</td>
                <td className="py-2 text-slate-400">{buttonTypeLabel(t, button.type)}</td>
                <td className="py-2 text-end font-black" dir="ltr">{integer(button.count)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="py-8 text-center text-xs text-slate-500">{t("waOfficialAnalytics.buttons.empty")}</p>
      )}
    </div>
  );
}

export function CostCard({ cost = {} }) {
  const { t } = useTranslation();
  const rows = [
    [t("waOfficialAnalytics.cost.amountSpent"), money(cost.amount_spent)],
    [t("waOfficialAnalytics.cost.perDelivered"), money(cost.cost_per_delivered)],
    [t("waOfficialAnalytics.cost.perUrlClick"), money(cost.cost_per_url_click)],
  ];
  return (
    <div className={cardClass}>
      <h3 className="text-sm font-black text-white">{t("waOfficialAnalytics.cost.title")}</h3>
      <div className="mt-2">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between border-b border-white/5 py-2 text-xs last:border-b-0">
            <span className="text-slate-300">{label}</span>
            <span className="font-black text-white" dir="ltr">{value}</span>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-slate-500">{t("waOfficialAnalytics.cost.currencyNote")}</p>
    </div>
  );
}

/** KPI cards + daily trend + button clicks + cost — identical on the page and in the template tab. */
export function TemplateStatsBlock({ data }) {
  return (
    <div className="space-y-3">
      <KpiCards kpis={data?.kpis || {}} />
      <TrendChart trend={data?.trend || []} />
      <div className="grid gap-3 lg:grid-cols-2">
        <ButtonClicks buttons={data?.buttons || []} />
        <CostCard cost={data?.cost || {}} />
      </div>
    </div>
  );
}

/** "Couldn't update statistics" — Meta failed; the technical details fold open. */
export function SyncErrorBanner({ error, analyticsDisabled = false, onEnable, enabling = false }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  if (!error && !analyticsDisabled) return null;
  const details = Array.isArray(error?.details) ? error.details : [];
  return (
    <div className="rounded-2xl border border-amber-300/25 bg-amber-400/[0.08] p-4">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-200" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-black text-amber-100">{t("waOfficialAnalytics.error.title")}</div>
          <p className="mt-1 text-xs leading-6 text-amber-50/80">
            {analyticsDisabled ? t("waOfficialAnalytics.error.disabled") : t("waOfficialAnalytics.error.body")}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            {analyticsDisabled && onEnable ? (
              <button
                type="button"
                onClick={onEnable}
                disabled={enabling}
                className="h-8 rounded-lg border border-amber-300/30 bg-amber-400/15 px-3 text-[11px] font-black text-amber-50 transition hover:bg-amber-400/25 disabled:opacity-50"
              >
                {t("waOfficialAnalytics.error.enable")}
              </button>
            ) : null}
            {error ? (
              <button type="button" onClick={() => setOpen((value) => !value)} className="text-[11px] font-bold text-amber-100/70 underline underline-offset-2">
                {t("waOfficialAnalytics.error.technical")}
              </button>
            ) : null}
          </div>
          {open && error ? (
            <pre dir="ltr" className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-slate-950/60 p-2 text-start text-[11px] leading-5 text-slate-300">
              {[...(details.length ? [] : [error.message]), ...details.map((item) => `[${item.step}] ${item.message}${item.graph_code ? ` (code ${item.graph_code}${item.graph_subcode ? `/${item.graph_subcode}` : ""})` : ""}${item.fbtrace_id ? ` fbtrace_id=${item.fbtrace_id}` : ""}`)]
                .filter(Boolean)
                .join("\n")}
            </pre>
          ) : null}
        </div>
      </div>
    </div>
  );
}
