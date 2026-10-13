import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { AlertTriangle, CalendarDays, ChevronDown, Clock, Eye, EyeOff, Loader2, Lock, RefreshCw, X } from "lucide-react";

import { managerPortalApi } from "../services/managerPortalApi";
import { formatMetricValue, formatMoney, formatPercentValue } from "../../reports/lib/metricFormat";
import { formatNumber } from "../../../shared/lib/currency";
import { paymentMethodLabel } from "../../../../shared/paymentMethods";

/**
 * The Reporting Center, on the manager's phone.
 *
 * Six sections, one request each, every figure from the same service the matching
 * desktop screen calls. Nothing is recomputed here — this file decides what fits on a
 * phone and nothing about what the numbers mean.
 *
 * The KPI tiles are driven by whatever the server sent rather than a hardcoded list, so
 * a metric added to a report appears here without a second edit, and a metric the
 * caller may not see never arrives to be rendered.
 *
 * Labels are deliberately borrowed from the `overview.*`, `inventory.*` and
 * `customerAnalytics.*` dictionaries rather than re-translated under `managerPortal.*`:
 * "صافي المبيعات" must read identically on both screens, and two dictionaries for one
 * metric is how they stop matching.
 *
 * PERIOD. The portal's اليوم tab counts the shop's night (a shift window that crosses
 * midnight); a preset here counts calendar days. So there is no "today" preset and the
 * screen says which clock it is on — one word covering two different numbers on one phone
 * is worse than not offering it.
 *
 * The فترة مخصصة preset is the way out of that: two dates and, optionally, a time on each
 * end. A shop whose night runs 2pm to 2am asks for exactly that, and the note about
 * calendar days steps aside because it no longer describes the window on screen.
 */

const PRESETS = ["last7", "last30", "thisMonth", "lastMonth", "custom"];
const SECTIONS = ["overview", "sales", "inventory", "purchasing", "customers", "employees", "shifts"];

/** Only after the password unlock; the server masks them until then. */
const PROFIT_METRICS = ["grossProfit", "grossMargin", "inventoryValue"];

/** A row's enum code, in the dictionary its own screen already uses. */
const rowLabel = (section, row, t) => {
  if (section === "inventory" && row.code) return t(`inventory.health.${row.code}`, { defaultValue: row.code });
  if (section === "customers" && row.code) return t(`customerAnalytics.segment.${row.code}`, { defaultValue: row.code });
  if (section === "employees" && row.code === "unattributed") return t("managerPortal.reports.unattributed");
  return row.label || row.code || "—";
};

/**
 * Which field each report's trend carries, and what to call it.
 *
 * Every report returns a `trend`, but they do not return the same series: purchasing
 * charts spend, customers and sellers chart revenue, sales charts net sales. Reading
 * `netSales` off all of them drew a flat line at zero with "٠ ج.م" at both ends on three
 * of the six screens — a chart that says nothing while looking like it measured
 * something. `fallback` covers the series that is a cost figure and therefore null until
 * the profit unlock.
 */
const TREND_SPEC = {
  overview: { field: "netSales", kind: "money", titleKey: "overview.trend.title" },
  sales: { field: "netSales", kind: "money", titleKey: "overview.trend.title" },
  customers: { field: "revenue", kind: "money", titleKey: "overview.kpi.customerRevenue" },
  employees: { field: "revenue", kind: "money", titleKey: "overview.kpi.sellerNetSales" },
  purchasing: {
    field: "spend",
    kind: "money",
    titleKey: "overview.kpi.purchaseSpend",
    fallback: { field: "units", kind: "count", titleKey: "overview.kpi.purchaseUnits" },
  },
  inventory: null,
  // A till session is a record, not a point on a curve: the shifts arrive as cards with
  // their own clocks, and a line drawn through them would imply a series they are not.
  shifts: null,
};

/** Local calendar day as YYYY-MM-DD — never toISOString, which shifts the date at night. */
const isoDay = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

/**
 * A clock reading the manager can read, in two pieces.
 *
 * Returned split rather than joined, and rendered inside `<bdi>` elements, because a
 * single `25/09، 12:57 ص` string dropped into an Arabic sentence comes out reordered:
 * the bidirectional algorithm resolves the leading digits against the paragraph, and the
 * day jumps to the far end — the shift cards really did read `فتحت: /09، 12:57 ص25`.
 * Two isolated runs, each labelled, cannot be reordered into nonsense.
 */
const formatStamp = (value, language) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const locale = language || "ar-EG";
  return {
    // The year is spelled out, and `calendar: "gregory"` pins it: a manager reading a
    // closed month wants the date that is on the invoice, and an Arabic locale left to
    // its own default can resolve to a Hijri year — a number nothing else in the system
    // counts in.
    date: new Intl.DateTimeFormat(locale, {
      calendar: "gregory",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(date),
    time: new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(date),
  };
};

/** The series to draw, or null when there is nothing truthful to draw. */
const resolveTrend = (section, trend = []) => {
  const spec = TREND_SPEC[section];
  if (!spec || trend.length < 2) return null;
  for (const candidate of [spec, spec.fallback].filter(Boolean)) {
    const points = trend.map((point) => Number(point?.[candidate.field]));
    if (points.some((value) => Number.isFinite(value) && value !== 0)) {
      return { points: points.map((value) => (Number.isFinite(value) ? value : 0)), ...candidate };
    }
  }
  return null;
};

/** What the small muted number beside a row counts, per section. */
const SECONDARY_LABEL = {
  sales: "overview.categories.units",
  inventory: "overview.categories.units",
  purchasing: "overview.categories.units",
  customers: "customerAnalytics.segments.customers",
  employees: "overview.kpi.orders",
};

export default function PortalReports({ token, canViewProfit = false }) {
  // Subscribing to `i18n` keeps this re-rendering when the manager switches the portal
  // language, which a component that only captured `t` once would not do.
  const { t, i18n } = useTranslation();
  const language = i18n.language;

  const [section, setSection] = useState("overview");
  const [preset, setPreset] = useState("last30");
  // Two custom windows, on purpose: `draft` is what the manager is typing, `custom` is
  // what the server was asked for. Fetching on every keystroke would send half-typed
  // dates, and a half-typed date is a different period.
  const [draft, setDraft] = useState(null);
  const [custom, setCustom] = useState(null);
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
      // A custom period with nothing filled in yet is not a request. Asking anyway would
      // answer with the default month under the "فترة مخصصة" heading.
      if (preset === "custom" && !custom) return;
      setStatus(silent ? "refreshing" : "loading");
      try {
        const params = preset === "custom"
          ? {
              section,
              preset,
              from: custom.from,
              to: custom.to,
              // Omitted rather than sent empty: an absent time means "the whole day",
              // which is a different window from "00:00".
              ...(custom.fromTime ? { fromTime: custom.fromTime } : {}),
              ...(custom.toTime ? { toTime: custom.toTime } : {}),
            }
          : { section, preset };
        const res = await managerPortalApi.reports(token, params, { profitToken: withProfit });
        setPayload(res || null);
        setStatus("ready");
      } catch {
        setStatus("error");
      }
    },
    [token, section, preset, custom, profitToken]
  );

  useEffect(() => { void load(); }, [load]);
  useEffect(() => () => { if (relockTimer.current) clearTimeout(relockTimer.current); }, []);

  // Switching report drops the old payload on purpose. Keeping it renders one report's
  // numbers under another report's heading for as long as the fetch takes, which is a
  // wrong answer rather than a slow one.
  const switchSection = useCallback((next) => {
    setSection(next);
    setPayload(null);
  }, []);

  /**
   * Picking فترة مخصصة opens the panel on the last seven whole days rather than on empty
   * boxes: a manager who only wants to change the end time should not have to type both
   * dates first. Nothing is fetched until they apply it.
   */
  const switchPreset = useCallback((next) => {
    if (next !== "custom") {
      setPreset(next);
      return;
    }
    setDraft((current) => {
      if (current) return current;
      const today = new Date();
      const weekAgo = new Date(today.getTime() - 6 * 86_400_000);
      return { from: isoDay(weekAgo), to: isoDay(today), fromTime: "", toTime: "" };
    });
    setPreset("custom");
  }, []);

  const customValid = Boolean(
    draft?.from && draft?.to && `${draft.from} ${draft.fromTime || "00:00"}` < `${draft.to} ${draft.toTime || "23:59"}`
  );

  const applyCustom = useCallback(() => {
    if (!customValid) return;
    setPayload(null);
    setCustom({ ...draft });
  }, [customValid, draft]);

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
  const profitShown = Boolean(payload?.profit_unlocked);
  const warnings = Array.isArray(payload?.warnings) ? payload.warnings : [];
  const range = payload?.range || null;
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  const series = useMemo(() => resolveTrend(section, Array.isArray(data?.trend) ? data.trend : []), [section, data]);

  // Whatever the server sent, in its order, minus what it masked. A tile for a metric
  // the caller may not see would be a blank card with a label explaining nothing.
  const metrics = useMemo(() => {
    const kpis = data?.kpis || {};
    return Object.keys(kpis).filter((metric) => {
      const kpi = kpis[metric];
      if (!kpi || kpi.restricted) return false;
      if (PROFIT_METRICS.includes(metric) && !profitShown) return false;
      return true;
    });
  }, [data, profitShown]);

  // The chips and the custom panel sit above every state: a manager who lands on an
  // unanswered custom period must be able to fix the dates, and one looking at an error
  // must be able to change the period rather than only retry the one that failed.
  const controls = (
    <>
      <SectionChips section={section} onChange={switchSection} t={t} />
      <PeriodChips preset={preset} onChange={switchPreset} t={t} busy={status === "refreshing"} />
      {preset === "custom" ? (
        <CustomRange
          draft={draft}
          onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
          onApply={applyCustom}
          valid={customValid}
          t={t}
        />
      ) : null}
    </>
  );

  if (status === "loading" && !data) {
    return (
      <div className="manager-portal-tab manager-portal-tab--reports space-y-3">
        {controls}
        {preset === "custom" && !custom ? null : (
          <div className="flex min-h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-text-muted" /></div>
        )}
      </div>
    );
  }

  if (status === "error" && !data) {
    return (
      <div className="manager-portal-tab manager-portal-tab--reports space-y-3">
        {controls}
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
      {controls}

      <p className="px-1 text-[11px] font-bold leading-5 text-text-muted">
        {range ? `${rangeLabel(range)} · ` : ""}
        {payload?.branch?.name ? `${payload.branch.name} · ` : ""}
        {/* The note describes midnight-to-midnight days. With a time on either end it
            describes a different window than the one on screen, so it steps aside. */}
        {range?.fromTime || range?.toTime ? "" : t("managerPortal.reports.calendarNote")}
      </p>

      {metrics.length ? (
        <section className="grid grid-cols-2 gap-2">
          {metrics.map((metric) => (
            <MetricTile
              key={metric}
              label={t(`overview.kpi.${metric}`, { defaultValue: metric })}
              value={formatMetricValue(metric, data.kpis[metric]?.current, language) ?? "—"}
              tone={PROFIT_METRICS.includes(metric) ? "profit" : "base"}
            />
          ))}
        </section>
      ) : null}

      {canViewProfit ? (
        profitShown ? (
          <button type="button" onClick={relock} className="flex w-full items-center justify-center gap-2 rounded-[var(--radius-control)] border border-border bg-surface-soft px-3 py-2 text-xs font-black text-text-muted">
            <EyeOff className="h-4 w-4" />
            {t("managerPortal.common.hide")}
          </button>
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

      {series ? (
        <PortalCard title={t(series.titleKey)}>
          <Sparkline points={series.points} />
          <div className="mt-2 flex items-center justify-between text-[11px] font-bold text-text-muted">
            {[Math.min(...series.points), Math.max(...series.points)].map((bound, index) => (
              <span key={index}>
                {series.kind === "money" ? formatMoney(bound, language) : formatNumber(bound, language)}
              </span>
            ))}
          </div>
        </PortalCard>
      ) : null}

      {section === "overview" ? (
        <>
          <PortalCard title={t("overview.paymentMix.title")}>
            <PaymentMixList paymentMix={data?.paymentMix} language={language} t={t} />
          </PortalCard>
          <PortalCard title={t("overview.categories.title")}>
            <CategoryList categories={data?.categories} language={language} t={t} />
          </PortalCard>
        </>
      ) : section === "shifts" ? (
        <ShiftList
          shifts={payload?.shifts}
          totals={data?.totals}
          summary={data?.summary}
          truncated={Boolean(payload?.meta?.truncated)}
          language={language}
          t={t}
        />
      ) : (
        <PortalCard title={t(`managerPortal.reports.lists.${section}`)}>
          <RankedList
            rows={rows}
            section={section}
            valueKind={payload?.value_kind || "money"}
            language={language}
            t={t}
          />
        </PortalCard>
      )}

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

/** Horizontally scrollable: six reports do not fit across a phone, and wrapping them
 *  pushes the first numbers below the fold. */
function SectionChips({ section, onChange, t }) {
  return (
    <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {SECTIONS.map((key) => {
        const active = section === key;
        return (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            className={`shrink-0 rounded-full px-3 py-2 text-xs font-black transition ${active ? "bg-text text-surface" : "border border-border bg-surface text-text-muted"}`}
          >
            {t(`managerPortal.reports.sections.${key}`)}
          </button>
        );
      })}
    </div>
  );
}

/**
 * What the screen says the window was.
 *
 * The server echoes the window it actually used, and this prints that back rather than
 * what the manager typed — if the two ever differ, the one that produced the numbers is
 * the one worth showing.
 */
function rangeLabel(range) {
  const start = range.fromTime ? `${range.from} ${range.fromTime}` : range.from;
  const end = range.toTime ? `${range.to} ${range.toTime}` : range.to;
  return `${start} → ${end}`;
}

/**
 * The custom window: two dates, and a time on each end that may be left empty.
 *
 * Native date and time inputs on purpose — a phone opens its own wheel picker for these,
 * which beats anything this file could draw, and the value is already the `YYYY-MM-DD` /
 * `HH:MM` the API wants.
 *
 * Applying is an explicit tap rather than a fetch per keystroke: a half-typed date is a
 * different period, and answering it would flash numbers for a window nobody asked for.
 */
function CustomRange({ draft, onChange, onApply, valid, t }) {
  if (!draft) return null;

  /*
   * One end of the window: its name on its own line, the date and the time side by side
   * underneath.
   *
   * The name used to sit in a fixed column beside the two inputs, which left the date
   * box about 120px wide on a phone — narrower than the `24 Sep 2026` a native picker
   * writes into it, so the value was clipped and the row spilled past the card. Stacking
   * the name gives each box half the card's full width, which fits with room to spare.
   *
   * The tracks are `minmax(0, …)` because a bare `1fr` grid track refuses to shrink below
   * its child's min-content width, and a native date input's min-content is wide. With a
   * plain `1fr` the row would overflow again on a narrow phone rather than sharing what
   * space there is.
   */
  /*
   * One box. The overlay is the point: an EMPTY native time input draws nothing at all
   * on this phone — the box was a blank grey rectangle with no hint that a time could go
   * in it, and no hint that leaving it blank means the whole day. So when the field has
   * no value the box says what blank MEANS, over an opaque panel that also covers the
   * `--:--` other browsers draw there. `pointer-events-none` keeps the tap on the input,
   * so the native picker still opens from anywhere in the box.
   *
   * THE INPUT IS OUT OF FLOW, and that is load-bearing rather than tidy. A native date
   * input carries an intrinsic width — "5 Oct 2026" plus the browser's own picker glyph —
   * and as a grid item it refuses to go below it: the track shrinks, the control does
   * not, and it spills over the gap and sits ON TOP of the box beside it. That is exactly
   * what the date box was doing to the time box. `position: absolute` takes the control
   * out of the grid's sizing entirely, so its width comes from this wrapper and nothing
   * else; the wrapper is the visible box, and `overflow-hidden` on it means that even a
   * control that somehow grew would be clipped rather than painted over its neighbour.
   */
  const box = (type, field, { aria, empty, icon: Icon }) => {
    const value = draft[field] || "";
    return (
      <div className="relative h-11 min-w-0 overflow-hidden rounded-[var(--radius-control)] border border-border bg-surface-soft focus-within:border-[var(--primary)]">
        <input
          type={type}
          value={value}
          onChange={(event) => onChange({ [field]: event.target.value })}
          aria-label={aria}
          className="manager-portal-period-field absolute inset-0 h-full w-full border-0 bg-transparent px-2 text-center text-[13px] font-black text-text outline-none"
        />
        {value ? null : (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center gap-1 bg-surface-soft px-1.5 text-[11px] font-bold text-text-muted">
            <Icon className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{empty}</span>
          </span>
        )}
      </div>
    );
  };

  const end = (key, label) => {
    const timeKey = `${key}Time`;
    const time = draft[timeKey] || "";

    return (
      <div>
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <span className="text-[12px] font-black text-text">{label}</span>
          {time ? (
            // A native time picker has no obvious way back to "no time", and "no time"
            // is a different window from midnight — so the way back is spelled out.
            <button
              type="button"
              onClick={() => onChange({ [timeKey]: "" })}
              className="flex shrink-0 items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[10px] font-black text-text-muted"
            >
              <X className="h-3 w-3" />
              {t("managerPortal.reports.custom.clearTime")}
            </button>
          ) : null}
        </div>
        <div className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] gap-2">
          {box("date", key, {
            aria: `${label} — ${t("managerPortal.reports.custom.date")}`,
            empty: t("managerPortal.reports.custom.date"),
            icon: CalendarDays,
          })}
          {box("time", timeKey, {
            aria: `${label} — ${t("managerPortal.reports.custom.time")}`,
            empty: t(`managerPortal.reports.custom.${key === "from" ? "anyTime" : "anyTimeEnd"}`),
            icon: Clock,
          })}
        </div>
      </div>
    );
  };

  return (
    <section className="rounded-[var(--radius-card)] border border-border bg-surface p-3 shadow-[var(--shadow-card)]">
      <div className="mb-2.5 text-xs font-black text-text">{t("managerPortal.reports.custom.title")}</div>

      <div className="space-y-3">
        {end("from", t("managerPortal.reports.custom.from"))}
        {end("to", t("managerPortal.reports.custom.to"))}
      </div>

      <p className="mt-2.5 text-[10px] font-bold leading-4 text-text-muted">{t("managerPortal.reports.custom.hint")}</p>
      {valid ? null : (
        <p className="mt-1 text-[10px] font-black leading-4 text-rose-500">{t("managerPortal.reports.custom.invalid")}</p>
      )}

      {/* The portal repaints raw Tailwind colour utilities onto its own palette, and a
          `bg-amber-500` here came out as the card's own background — a primary action
          that was nothing but floating text. The class below is painted from the theme
          tokens in ManagerPortal.m1.css, which no remap can take away. */}
      <button
        type="button"
        disabled={!valid}
        onClick={onApply}
        className="manager-portal-apply-period mt-2.5 w-full rounded-[var(--radius-control)] px-3 py-2.5 text-sm font-black disabled:opacity-60"
      >
        {t("managerPortal.reports.custom.apply")}
      </button>
    </section>
  );
}

/**
 * One card per till session: when the drawer opened and closed, who had it, what was rung
 * through it and what paid for it.
 *
 * Every figure is the server's. The methods are the ones that actually paid — a split
 * invoice contributes to each of them — and the total is the server's own, not these rows
 * added up on the phone, so the card can never disagree with the report it came from.
 */
function ShiftList({ shifts, totals, summary, truncated = false, language, t }) {
  const rows = Array.isArray(shifts) ? shifts : [];
  if (!rows.length) return <Empty label={t("managerPortal.reports.shifts.empty")} />;

  return (
    <div className="space-y-2">
      <p className="px-1 text-[10px] font-bold leading-4 text-text-muted">{t("managerPortal.reports.shifts.note")}</p>

      {rows.map((shift) => (
        <section key={shift.id} className="rounded-[var(--radius-card)] border border-border bg-surface p-4 shadow-[var(--shadow-card)]">
          <div className="flex items-baseline justify-between gap-2">
            <span className="min-w-0 truncate text-[13px] font-black text-text">{shift.cashier || "—"}</span>
            <span
              className={`shrink-0 rounded-full px-2 py-px text-[9px] font-black ${
                shift.status === "open" ? "bg-amber-500/15 text-amber-500" : "border border-border text-text-muted"
              }`}
            >
              {shift.status === "open" ? t("managerPortal.reports.shifts.stillOpen") : t("managerPortal.reports.shifts.closed")}
            </span>
          </div>

          {shift.branchName ? (
            <div className="mt-0.5 truncate text-[11px] font-bold text-text-muted">{shift.branchName}</div>
          ) : null}

          {/* One clock per line. Crammed onto one wrapping line the two stamps ran into
              each other and the digits re-ordered against the Arabic around them. */}
          <div className="mt-2 space-y-1">
            <Stamp label={t("managerPortal.reports.shifts.opened")} stamp={formatStamp(shift.openedAt, language)} />
            <Stamp
              label={t("managerPortal.reports.shifts.closed")}
              stamp={formatStamp(shift.closedAt, language)}
              fallback={t("managerPortal.reports.shifts.stillOpen")}
            />
          </div>

          <ul className="mt-3 space-y-1.5 border-t border-border pt-2.5">
            {(shift.payments?.rows || []).map((row) => (
              <li key={row.method} className="flex items-baseline justify-between gap-2 text-[12px]">
                <span className="flex min-w-0 items-baseline gap-1.5">
                  <span className="truncate font-bold text-text">{paymentMethodLabel(row.method, language)}</span>
                  {row.settlement !== "collected" ? (
                    <span className="shrink-0 rounded-full border border-border px-1.5 py-px text-[9px] font-black text-text-muted">
                      {t(`overview.paymentMix.chip.${row.settlement}`)}
                    </span>
                  ) : null}
                </span>
                <span className="shrink-0 font-black tabular-nums text-text">{formatMoney(row.amount, language)}</span>
              </li>
            ))}
            {(shift.payments?.rows || []).length ? null : (
              <li className="text-[11px] font-bold text-text-muted">{t("managerPortal.reports.shifts.noSales")}</li>
            )}
          </ul>

          <div className="mt-2 flex items-baseline justify-between gap-2 border-t border-border pt-2 text-[12px]">
            <span className="flex items-baseline gap-1.5">
              <span className="font-black text-text">{t("managerPortal.reports.shifts.total")}</span>
              {shift.share ? (
                <span className="text-[10px] font-black tabular-nums text-text-muted">{formatPercentValue(shift.share, language)}</span>
              ) : null}
            </span>
            <span className="text-[15px] font-black tabular-nums text-text">
              {formatMoney(shift.payments?.totals?.all, language) ?? "—"}
            </span>
          </div>

          <div className="mt-2 space-y-1 text-[10px] font-bold text-text-muted">
            <Line label={t("managerPortal.reports.shifts.orders")} value={formatNumber(shift.orders, language)} />
            <Line label={t("managerPortal.reports.shifts.openingCash")} value={formatMoney(shift.openingCash, language)} />
            <Line label={t("managerPortal.reports.shifts.expectedCash")} value={formatMoney(shift.expectedCash, language)} />
            {shift.closingCash === null ? null : (
              <Line label={t("managerPortal.reports.shifts.countedCash")} value={formatMoney(shift.closingCash, language)} />
            )}
            {shift.cashDifference === null || shift.cashDifference === 0 ? null : (
              <Line
                label={t("managerPortal.reports.shifts.difference")}
                value={formatMoney(shift.cashDifference, language)}
                tone={shift.cashDifference < 0 ? "bad" : "good"}
              />
            )}
          </div>

          <ShiftExpenses expenses={shift.expenses} language={language} t={t} />
        </section>
      ))}

      {/* The window added up, under the sessions it is made of — the last thing read on a
          screen that is scrolled downwards. With one shift on screen it would only repeat
          the card above it, so it waits for a second. */}
      {rows.length > 1 && (totals?.rows?.length || summary) ? (
        <PortalCard title={t("managerPortal.reports.shifts.grandTotal")}>
          {totals?.rows?.length ? <PaymentMixList paymentMix={totals} language={language} t={t} /> : null}
          <div className={`space-y-1 text-[11px] font-bold text-text-muted ${totals?.rows?.length ? "mt-3 border-t border-border pt-2.5" : ""}`}>
            <Line label={t("managerPortal.reports.shifts.shiftCount")} value={formatNumber(summary?.shiftCount ?? rows.length, language)} />
            <Line label={t("managerPortal.reports.shifts.orders")} value={formatNumber(summary?.orders, language)} />
            <Line label={t("managerPortal.reports.shifts.openingCash")} value={formatMoney(summary?.openingCash, language)} />
            <Line label={t("managerPortal.reports.shifts.expectedCash")} value={formatMoney(summary?.expectedCash, language)} />
            {summary?.countedCash === null || summary?.countedCash === undefined ? null : (
              <Line label={t("managerPortal.reports.shifts.countedCash")} value={formatMoney(summary.countedCash, language)} />
            )}
            {summary?.cashDifference ? (
              <Line
                label={t("managerPortal.reports.shifts.difference")}
                value={formatMoney(summary.cashDifference, language)}
                tone={summary.cashDifference < 0 ? "bad" : "good"}
              />
            ) : null}
            {summary?.expenseCount ? (
              <Line
                label={t("managerPortal.reports.shifts.expenses")}
                value={formatMoney(summary.expenses, language)}
                tone="bad"
              />
            ) : null}
          </div>
          {/* Said out loud when some drawer is still open: the counted line and the
              difference cover the closed sessions only, and a total that silently left a
              shift out is how a manager stops trusting the screen. */}
          {summary && summary.countedShifts < summary.shiftCount ? (
            <p className="mt-2 text-[10px] font-bold leading-4 text-amber-500">
              {t("managerPortal.reports.shifts.countedNote", { closed: summary.countedShifts })}
            </p>
          ) : null}
        </PortalCard>
      ) : null}

      {truncated ? (
        <p className="px-1 text-[10px] font-black leading-4 text-amber-500">{t("managerPortal.reports.shifts.truncated")}</p>
      ) : null}
    </div>
  );
}

/**
 * What an expense is called.
 *
 * The stored `expense_type` is already the enum the expenses screen is keyed on, so the
 * label comes from THAT screen's dictionary rather than a second one under
 * `managerPortal.*` — "سلفة موظف" has to read identically wherever it appears. The
 * category is tried next for the older rows that carried only that, and the title the
 * till wrote is the last resort: an expense type nobody has translated still has to say
 * something, and "أخرى" for all of them would hide which was which.
 */
const expenseLabel = (row, t) => {
  const byType = row.type ? t(`expenses.centerOptions.type.${row.type}`, { defaultValue: "" }) : "";
  if (byType) return byType;
  const byCategory = row.category ? t(`expenses.centerOptions.category.${row.category}`, { defaultValue: "" }) : "";
  if (byCategory) return byCategory;
  return row.title || row.type || row.category || "—";
};

/**
 * What left the drawer on this shift, and what each line of it was.
 *
 * Employee advances are in the total on purpose: a سلفة paid in cash left the till like
 * any other payment, and a manager counting the drawer needs it in the figure. Each line
 * still names itself, so an advance reads as an advance with the employee beside it.
 *
 * The cash part is spelled out only when it differs from the total — that is the part the
 * drawer ever held, so it is the one that reconciles against the expected cash above, and
 * a card-paid expense never touched the till.
 */
function ShiftExpenses({ expenses, language, t }) {
  const rows = expenses?.rows || [];
  if (!rows.length) return null;

  return (
    <div className="mt-2 border-t border-border pt-2">
      <div className="flex items-baseline justify-between gap-2 text-[12px]">
        <span className="font-black text-text">{t("managerPortal.reports.shifts.expenses")}</span>
        <span className="font-black tabular-nums text-rose-500">{formatMoney(expenses.total, language) ?? "—"}</span>
      </div>

      <ul className="mt-1.5 space-y-1">
        {rows.map((row) => (
          <li key={row.id} className="flex items-baseline justify-between gap-2 text-[10px] font-bold text-text-muted">
            <span className="min-w-0 truncate">
              {expenseLabel(row, t)}
              {row.employee ? <span className="text-text-muted"> · {row.employee}</span> : null}
            </span>
            <span className="shrink-0 tabular-nums text-text">{formatMoney(row.amount, language)}</span>
          </li>
        ))}
      </ul>

      {expenses.cash === expenses.total ? null : (
        <div className="mt-1.5 text-[10px] font-bold text-text-muted">
          <Line label={t("managerPortal.reports.shifts.expensesCashPart")} value={formatMoney(expenses.cash, language)} />
        </div>
      )}
    </div>
  );
}

/**
 * A labelled clock reading. The date and the time are separate `<bdi>` runs so neither
 * can be re-ordered against the Arabic label beside them.
 */
function Stamp({ label, stamp, fallback = "—" }) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-[11px] font-bold text-text-muted">
      <span className="shrink-0">{label}</span>
      {stamp ? (
        // Date first, time second: in a flex row the first child sits where the reader
        // starts, so this reads "25/09, 12:57 am" in Arabic and in English alike.
        <span className="flex items-baseline gap-2 tabular-nums text-text">
          <bdi>{stamp.date}</bdi>
          <bdi className="font-black">{stamp.time}</bdi>
        </span>
      ) : (
        <span className="text-text">{fallback}</span>
      )}
    </div>
  );
}

function Line({ label, value, tone = "base" }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span>{label}</span>
      <span className={`tabular-nums font-black ${tone === "bad" ? "text-rose-500" : tone === "good" ? "text-emerald-500" : "text-text"}`}>
        {value ?? "—"}
      </span>
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

/** The one list each report contributes: top products, stock health, suppliers,
 *  customer segments, sellers. One component, because they are one shape. */
function RankedList({ rows = [], section, valueKind, language, t }) {
  if (!rows.length) return <Empty label={t("managerPortal.reports.emptySection")} />;
  const max = Math.max(...rows.map((row) => Math.abs(Number(row.value) || 0)), 1);
  const secondaryKey = SECONDARY_LABEL[section];

  return (
    <ul className="space-y-2.5">
      {rows.map((row) => {
        const value = Number(row.value);
        const formatted = Number.isFinite(value)
          ? valueKind === "money"
            ? formatMoney(value, language)
            : formatNumber(value, language)
          : "—";
        return (
          <li key={row.key}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-[13px] font-black text-text" title={rowLabel(section, row, t)}>
                {rowLabel(section, row, t)}
              </span>
              <span className="shrink-0 text-[13px] font-black tabular-nums text-text">{formatted}</span>
            </div>
            <div className="mt-1 flex items-center gap-2">
              <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-soft">
                <div className="h-full rounded-full bg-[var(--primary)]" style={{ width: `${Math.max((Math.abs(value || 0) / max) * 100, 1.5)}%` }} />
              </div>
              {row.share !== null && row.share !== undefined ? (
                <span className="w-10 shrink-0 text-end text-[10px] font-black tabular-nums text-text-muted">{formatPercentValue(row.share, language)}</span>
              ) : null}
            </div>
            {row.secondary !== null && row.secondary !== undefined && secondaryKey ? (
              <div className="mt-1 text-[10px] font-bold text-text-muted">
                {t(secondaryKey)}: <span className="tabular-nums">{formatNumber(row.secondary, language)}</span>
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
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
