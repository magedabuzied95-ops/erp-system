import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { AlertTriangle, ChevronDown, Eye, EyeOff, Loader2, Lock, RefreshCw } from "lucide-react";

import { managerPortalApi } from "../services/managerPortalApi";
import { formatMoney, formatPercentValue } from "../../reports/lib/metricFormat";
import { formatNumber } from "../../../shared/lib/currency";
import { paymentMethodLabel } from "../../../../shared/paymentMethods";

/**
 * The Reporting Center's executive overview, on the manager's phone.
 *
 * Every figure arrives from /manager-portal/:token/reports, which calls the same
 * service the desktop screen calls. Nothing is recomputed here — this file decides
 * what fits on a phone and nothing about what the numbers mean.
 *
 * Labels are deliberately borrowed from the `overview.*` dictionary rather than
 * re-translated under `managerPortal.*`: "صافي المبيعات" must read identically on both
 * screens, and two dictionaries for one metric is how they stop matching.
 *
 * PERIOD. The portal's اليوم tab counts the shop's night (a shift window that crosses
 * midnight); every number here counts calendar days. So there is no "today" preset and
 * the screen says which clock it is on — one word covering two different numbers on one
 * phone is worse than not offering it.
 */

const PRESETS = ["last7", "last30", "thisMonth", "lastMonth"];

/** Shown without a profit unlock. */
const BASE_METRICS = ["netSales", "orders", "averageOrderValue", "itemsSold", "discountRate", "returns", "returnRate", "newCustomers"];
/** Only after the password unlock; the server masks them until then. */
const PROFIT_METRICS = ["grossProfit", "grossMargin", "inventoryValue"];

const METRIC_KIND = {
  netSales: "money", grossProfit: "money", averageOrderValue: "money", returns: "money", inventoryValue: "money",
  grossMargin: "percent", discountRate: "percent", returnRate: "percent",
  orders: "count", itemsSold: "count", newCustomers: "count",
};

const formatMetric = (metric, value, language) => {
  if (value === null || value === undefined) return "—";
  if (METRIC_KIND[metric] === "money") return formatMoney(value, language) ?? "—";
  if (METRIC_KIND[metric] === "percent") return formatPercentValue(value, language) ?? "—";
  return formatNumber(value, language);
};

export default function PortalReports({ token, canViewProfit = false }) {
  // Subscribing to `i18n` keeps this re-rendering when the manager switches the portal
  // language, which a component that only captured `t` once would not do.
  const { t, i18n } = useTranslation();
  const language = i18n.language;

  const [preset, setPreset] = useState("last30");
  const [payload, setPayload] = useState(null);
  const [status, setStatus] = useState("loading");
  const [profitToken, setProfitToken] = useState("");
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [unlockError, setUnlockError] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const relockTimer = useRef(null);

  const load = useCallback(
    async ({ silent = false, withProfit = profitToken } = {}) => {
      if (!token) return;
      setStatus(silent ? "refreshing" : "loading");
      try {
        const res = await managerPortalApi.reports(token, { preset }, { profitToken: withProfit });
        setPayload(res || null);
        setStatus("ready");
      } catch {
        setStatus("error");
      }
    },
    [token, preset, profitToken]
  );

  useEffect(() => { void load(); }, [load]);
  useEffect(() => () => { if (relockTimer.current) clearTimeout(relockTimer.current); }, []);

  const relock = useCallback(() => {
    if (relockTimer.current) { clearTimeout(relockTimer.current); relockTimer.current = null; }
    setProfitToken("");
    void load({ silent: true, withProfit: "" });
  }, [load]);

  const unlock = async () => {
    if (!password || unlocking) return;
    setUnlocking(true);
    setUnlockError("");
    try {
      const res = await managerPortalApi.unlockProfit(token, password);
      const granted = res?.profit_token;
      if (!granted) throw new Error("unlock_failed");
      setProfitToken(granted);
      setUnlockOpen(false);
      setPassword("");
      await load({ silent: true, withProfit: granted });
      // The unlock expires server-side; drop it here at the same moment so the screen
      // cannot keep showing profit it would no longer be served.
      if (relockTimer.current) clearTimeout(relockTimer.current);
      relockTimer.current = setTimeout(relock, Math.max(1, Number(res?.expires_in || 900)) * 1000);
    } catch (error) {
      setUnlockError(
        Number(error?.status || 0) === 429 ? t("managerPortal.profit.tooManyAttempts") : t("managerPortal.profit.wrongPassword")
      );
    } finally {
      setUnlocking(false);
    }
  };

  const data = payload?.data || null;
  const kpis = data?.kpis || {};
  const profitShown = Boolean(payload?.profit_unlocked);
  const warnings = Array.isArray(payload?.warnings) ? payload.warnings : [];
  const range = payload?.range || null;

  const trend = useMemo(() => (Array.isArray(data?.trend) ? data.trend : []), [data]);

  if (status === "loading" && !data) {
    return (
      <div className="manager-portal-tab manager-portal-tab--reports flex min-h-48 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-text-muted" />
      </div>
    );
  }

  if (status === "error" && !data) {
    return (
      <div className="manager-portal-tab manager-portal-tab--reports space-y-3">
        <PeriodChips preset={preset} onChange={setPreset} t={t} />
        <div className="rounded-[var(--radius-card)] border border-dashed border-border bg-surface px-4 py-6 text-center text-sm font-bold text-text-muted">
          {t("managerPortal.reports.failed")}
          <button type="button" onClick={() => void load()} className="mt-3 flex w-full items-center justify-center gap-2 rounded-[var(--radius-control)] border border-border bg-surface-soft px-3 py-2 text-sm font-black text-text">
            <RefreshCw className="h-4 w-4" />
            {t("managerPortal.settings.refreshData")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="manager-portal-tab manager-portal-tab--reports space-y-3">
      <PeriodChips preset={preset} onChange={setPreset} t={t} busy={status === "refreshing"} />

      <p className="px-1 text-[11px] font-bold leading-5 text-text-muted">
        {range ? `${range.from} → ${range.to} · ` : ""}
        {payload?.branch?.name ? `${payload.branch.name} · ` : ""}
        {t("managerPortal.reports.calendarNote")}
      </p>

      <section className="grid grid-cols-2 gap-2">
        {BASE_METRICS.map((metric) => (
          <MetricTile key={metric} label={t(`overview.kpi.${metric}`)} value={formatMetric(metric, kpis[metric]?.current, language)} />
        ))}
      </section>

      {canViewProfit ? (
        profitShown ? (
          <section className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              {PROFIT_METRICS.map((metric) => (
                <MetricTile key={metric} label={t(`overview.kpi.${metric}`)} value={formatMetric(metric, kpis[metric]?.current, language)} tone="profit" />
              ))}
            </div>
            <button type="button" onClick={relock} className="flex w-full items-center justify-center gap-2 rounded-[var(--radius-control)] border border-border bg-surface-soft px-3 py-2 text-xs font-black text-text-muted">
              <EyeOff className="h-4 w-4" />
              {t("managerPortal.common.hide")}
            </button>
          </section>
        ) : (
          <button
            type="button"
            onClick={() => setUnlockOpen(true)}
            className="flex w-full items-center justify-between gap-3 rounded-[var(--radius-card)] border border-border bg-surface px-4 py-3 text-start shadow-[var(--shadow-card)]"
          >
            <span className="min-w-0">
              <span className="block text-sm font-black leading-5 text-text">{t("managerPortal.reports.profitLocked")}</span>
              <span className="block text-[11px] font-bold leading-4 text-text-muted">{t("managerPortal.reports.profitLockedHint")}</span>
            </span>
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-amber-500/15 text-amber-500"><Lock className="h-5 w-5" /></span>
          </button>
        )
      ) : null}

      {trend.length > 1 ? (
        <PortalCard title={t("overview.trend.title")}>
          <Sparkline points={trend.map((point) => Number(point.netSales || 0))} />
          <div className="mt-2 flex items-center justify-between text-[11px] font-bold text-text-muted">
            <span>{formatMoney(Math.min(...trend.map((point) => Number(point.netSales || 0))), language)}</span>
            <span>{formatMoney(Math.max(...trend.map((point) => Number(point.netSales || 0))), language)}</span>
          </div>
        </PortalCard>
      ) : null}

      <PortalCard title={t("overview.paymentMix.title")}>
        <PaymentMixList paymentMix={data?.paymentMix} language={language} t={t} />
      </PortalCard>

      <PortalCard title={t("overview.categories.title")}>
        <CategoryList categories={data?.categories} language={language} t={t} />
      </PortalCard>

      {warnings.length ? (
        <section className="rounded-[var(--radius-card)] border border-border bg-surface shadow-[var(--shadow-card)]">
          <button type="button" onClick={() => setNotesOpen((open) => !open)} className="flex w-full items-center justify-between gap-2 px-4 py-3">
            <span className="flex items-center gap-2 text-xs font-black text-text">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              {t("overview.warnings.count", { count: warnings.length })}
            </span>
            <ChevronDown className={`h-4 w-4 text-text-muted transition ${notesOpen ? "rotate-180" : ""}`} />
          </button>
          {notesOpen ? (
            <ul className="space-y-2 border-t border-border px-4 py-3">
              {warnings.map((warning) => (
                <li key={warning.code} className="text-[11px] font-bold leading-5 text-text-muted">
                  {t(`overview.warnings.${warning.code}`, { ...warning, defaultValue: warning.message || warning.code })}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {unlockOpen ? (
        <div className="fixed inset-0 z-[120] grid place-items-center bg-black/60 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-sm rounded-[var(--radius-card)] border border-border bg-surface p-4 shadow-[var(--shadow-card)]">
            <div className="text-base font-black text-text">{t("managerPortal.profit.show")}</div>
            <div className="mt-1 text-[11px] font-bold leading-5 text-text-muted">{t("managerPortal.reports.profitLockedHint")}</div>
            <input
              type="password"
              value={password}
              autoComplete="current-password"
              onChange={(event) => setPassword(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") void unlock(); }}
              className="mt-3 w-full rounded-[var(--radius-control)] border border-border bg-surface-soft px-3 py-2.5 text-sm font-bold text-text outline-none"
              placeholder={t("managerPortal.profit.enterPassword")}
            />
            {unlockError ? <div className="mt-2 text-[11px] font-black text-rose-500">{unlockError}</div> : null}
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => { setUnlockOpen(false); setPassword(""); setUnlockError(""); }} className="rounded-[var(--radius-control)] border border-border bg-surface-soft px-3 py-2.5 text-sm font-black text-text">
                {t("managerPortal.common.cancel")}
              </button>
              <button type="button" disabled={!password || unlocking} onClick={() => void unlock()} className="flex items-center justify-center gap-2 rounded-[var(--radius-control)] bg-amber-500 px-3 py-2.5 text-sm font-black text-slate-950 disabled:opacity-60">
                {unlocking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
                {t("managerPortal.profit.show")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PeriodChips({ preset, onChange, t, busy = false }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {PRESETS.map((key) => {
        const active = preset === key;
        return (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            className={`rounded-full px-3 py-1.5 text-xs font-black transition ${active ? "bg-amber-500 text-slate-950" : "border border-border bg-surface text-text-muted"}`}
          >
            {t(`managerPortal.reports.presets.${key}`)}
          </button>
        );
      })}
      {busy ? <Loader2 className="h-4 w-4 animate-spin text-text-muted" /> : null}
    </div>
  );
}

function PortalCard({ title, children }) {
  return (
    <section className="rounded-[var(--radius-card)] border border-border bg-surface p-4 shadow-[var(--shadow-card)]">
      <div className="mb-3 text-sm font-black leading-5 text-text">{title}</div>
      {children}
    </section>
  );
}

function MetricTile({ label, value, tone = "base" }) {
  return (
    <div className={`rounded-[var(--radius-control)] border p-3 ${tone === "profit" ? "border-emerald-500/30 bg-emerald-500/5" : "border-border bg-surface"}`}>
      <div className="text-[10px] font-black leading-4 text-text-muted">{label}</div>
      <div className="mt-1 text-[17px] font-black leading-6 text-text">{value}</div>
    </div>
  );
}

/** A period's shape, not a chart library: one path, no axes, readable at 375px. */
function Sparkline({ points = [] }) {
  if (points.length < 2) return null;
  const max = Math.max(...points, 1);
  const min = Math.min(...points, 0);
  const span = max - min || 1;
  const step = 100 / (points.length - 1);
  const path = points.map((value, index) => `${index === 0 ? "M" : "L"}${(index * step).toFixed(2)},${(32 - ((value - min) / span) * 30).toFixed(2)}`).join(" ");
  return (
    <svg viewBox="0 0 100 34" preserveAspectRatio="none" className="h-16 w-full" role="img" aria-hidden="true">
      <path d={path} fill="none" stroke="var(--primary)" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

const SETTLEMENT_BAR = {
  collected: "bg-[var(--primary)]",
  pending: "bg-amber-500",
  credit: "bg-slate-400",
  unattributed: "bg-rose-500",
};

function PaymentMixList({ paymentMix, language, t }) {
  const rows = paymentMix?.rows || [];
  const totals = paymentMix?.totals || {};
  if (!rows.length) return <Empty label={t("overview.paymentMix.empty")} />;
  const max = Math.max(...rows.map((row) => Math.abs(row.amount || 0)), 1);

  return (
    <div>
      <ul className="space-y-2.5">
        {rows.map((row) => (
          <li key={row.method}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="flex min-w-0 items-baseline gap-1.5">
                <span className="truncate text-[13px] font-black text-text">{paymentMethodLabel(row.method, language)}</span>
                {row.settlement !== "collected" ? (
                  <span className="shrink-0 rounded-full border border-border px-1.5 py-px text-[9px] font-black text-text-muted">
                    {t(`overview.paymentMix.chip.${row.settlement}`)}
                  </span>
                ) : null}
              </span>
              <span className="shrink-0 text-[13px] font-black tabular-nums text-text">{formatMoney(row.amount, language)}</span>
            </div>
            <div className="mt-1 flex items-center gap-2">
              <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-soft">
                <div className={`h-full rounded-full ${SETTLEMENT_BAR[row.settlement] || SETTLEMENT_BAR.collected}`} style={{ width: `${Math.max((Math.abs(row.amount || 0) / max) * 100, 1.5)}%` }} />
              </div>
              <span className="w-10 shrink-0 text-end text-[10px] font-black tabular-nums text-text-muted">{formatPercentValue(row.share, language) || "—"}</span>
            </div>
          </li>
        ))}
      </ul>

      <div className="mt-3 space-y-1 border-t border-border pt-2.5">
        {["collected", "pending", "credit", "unattributed"].filter((key) => Number(totals[key] || 0) !== 0).map((key) => (
          <div key={key} className="flex items-baseline justify-between gap-2 text-[11px]">
            <span className="font-bold text-text-muted">{t(`overview.paymentMix.settlement.${key}`)}</span>
            <span className="font-black tabular-nums text-text">{formatMoney(totals[key], language)}</span>
          </div>
        ))}
        <div className="flex items-baseline justify-between gap-2 pt-1 text-[12px]">
          <span className="font-black text-text">{t("overview.paymentMix.total")}</span>
          <span className="text-[14px] font-black tabular-nums text-text">{formatMoney(totals.all, language)}</span>
        </div>
      </div>
    </div>
  );
}

function CategoryList({ categories, language, t }) {
  const rows = (categories?.rows || []).slice(0, 5);
  const other = categories?.other || null;
  if (!rows.length && !other) return <Empty label={t("overview.categories.empty")} />;
  const max = Math.max(...rows.map((row) => row.netSales || 0), other?.netSales || 0, 1);

  const line = (key, name, value, share, muted = false) => (
    <li key={key}>
      <div className="flex items-baseline justify-between gap-2">
        <span className={`truncate text-[13px] font-black ${muted ? "text-text-muted" : "text-text"}`}>{name}</span>
        <span className="shrink-0 text-[13px] font-black tabular-nums text-text">{formatMoney(value, language)}</span>
      </div>
      <div className="mt-1 flex items-center gap-2">
        <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-soft">
          <div className={`h-full rounded-full ${muted ? "bg-slate-400" : "bg-[var(--primary)]"}`} style={{ width: `${Math.max(((value || 0) / max) * 100, 1.5)}%` }} />
        </div>
        <span className="w-10 shrink-0 text-end text-[10px] font-black tabular-nums text-text-muted">{formatPercentValue(share, language) || "—"}</span>
      </div>
    </li>
  );

  return (
    <ul className="space-y-2.5">
      {rows.map((row) => line(row.category, row.category, row.netSales, row.contribution))}
      {other ? line("__other", t("overview.categories.other"), other.netSales, other.contribution, true) : null}
    </ul>
  );
}

function Empty({ label }) {
  return (
    <div className="rounded-[var(--radius-control)] border border-dashed border-border px-3 py-6 text-center text-xs font-bold text-text-muted">
      {label}
    </div>
  );
}
