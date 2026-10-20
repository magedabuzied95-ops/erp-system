// WhatsApp usage & cost — inbox top bar → WhatsApp → Usage & cost.
//
// One row per month per WhatsApp Business Account, the way Meta bills it: service messages,
// how many were free, the day the month passed its free allowance, billed service messages,
// marketing / utility / authentication templates and the total cost in USD. "Sync from Meta"
// pulls the last 12 months; the page itself reads the cached rows. Before Meta is connected it
// still shows our own outbound WhatsApp count (a local count, not a bill).
// Server: server/routes/whatsappUsage.js.

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, BellRing, DollarSign, MessageCircle, RefreshCw, Save } from "lucide-react";

import { api } from "../../../../shared/api/api";
import { ActionButton, PanelSkeleton, StatusPill, TextInput, clean, formatDateTime } from "../integrations/integrationsUi.jsx";

const SUPPRESSED = { suppressErrorStatuses: [400, 403, 404, 409, 500, 502, 504] };

const LEVEL_BAR = {
  ok: "bg-emerald-300",
  warning: "bg-amber-300",
  over: "bg-rose-300",
  none: "bg-slate-500",
};
const LEVEL_RING = {
  ok: "border-emerald-300/20 bg-emerald-400/[0.05]",
  warning: "border-amber-300/25 bg-amber-400/[0.07]",
  over: "border-rose-300/25 bg-rose-400/[0.08]",
  none: "border-white/10 bg-white/[0.035]",
};

const integer = (value) => Number(value || 0).toLocaleString("en-US");
const usd = (value) => `$${Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;

const monthLabel = (value, language) => {
  if (!value) return "—";
  const [year, month] = String(value).split("-").map(Number);
  if (!year || !month) return value;
  return new Date(Date.UTC(year, month - 1, 15)).toLocaleDateString(language === "ar" ? "ar-EG" : "en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
};
const dayLabel = (value, language) => {
  if (!value) return "—";
  const [year, month, day] = String(value).split("-").map(Number);
  if (!year || !month || !day) return value;
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString(language === "ar" ? "ar-EG" : "en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
};

// Literal keys so a missing translation stays greppable.
const sourceLabel = (t, source) => {
  if (source === "meta_pricing_analytics") return t("aiSupport.waUsage.source.pricing");
  if (source === "meta_conversation_analytics") return t("aiSupport.waUsage.source.conversation");
  return t("aiSupport.waUsage.source.local");
};
const levelLabel = (t, level) => {
  if (level === "over") return t("aiSupport.waUsage.alert.over");
  if (level === "warning") return t("aiSupport.waUsage.alert.warning");
  if (level === "ok") return t("aiSupport.waUsage.alert.ok");
  return t("aiSupport.waUsage.alert.none");
};

function SummaryCard({ icon: Icon, label, value, hint, className = "" }) {
  return (
    <div className={`rounded-2xl border border-white/10 bg-white/[0.035] p-4 ${className}`}>
      <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.12em] text-slate-500">
        {Icon ? <Icon className="h-3.5 w-3.5" aria-hidden="true" /> : null}
        <span>{label}</span>
      </div>
      <div className="mt-2 text-2xl font-black text-white">
        <span dir="ltr">{value}</span>
      </div>
      {hint ? <div className="mt-1 text-[11px] leading-5 text-slate-500">{hint}</div> : null}
    </div>
  );
}

export default function WhatsAppUsagePanel({ headers }) {
  const { t, i18n } = useTranslation();
  const language = i18n?.language || "ar";
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState(null);
  const [form, setForm] = useState({ monthly_budget_usd: 0, alert_percent: 80 });
  const mountedRef = useRef(true);

  useEffect(() => () => { mountedRef.current = false; }, []);

  const apply = useCallback((payload) => {
    if (!mountedRef.current || !payload) return;
    setData(payload);
    setForm({
      monthly_budget_usd: Number(payload?.alerts?.monthly_budget_usd ?? 0),
      alert_percent: Number(payload?.alerts?.alert_percent ?? 80),
    });
  }, []);

  const load = useCallback(async () => {
    try {
      apply(await api.get("/whatsapp/usage", { headers, ...SUPPRESSED }));
    } catch (error) {
      if (mountedRef.current) setNotice({ ok: false, text: error?.message || t("aiSupport.waUsage.loadFailed") });
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [apply, headers, t]);

  useEffect(() => { void load(); }, [load]);

  const run = useCallback(async (key, task, okText) => {
    setBusy(key);
    setNotice(null);
    try {
      const result = await task();
      apply(result);
      if (mountedRef.current && okText) setNotice({ ok: true, text: okText(result) });
    } catch (error) {
      if (mountedRef.current) setNotice({ ok: false, text: error?.message || t("aiSupport.waUsage.actionFailed") });
    } finally {
      if (mountedRef.current) setBusy("");
    }
  }, [apply, t]);

  const sync = () => run(
    "sync",
    () => api.post("/whatsapp/usage/sync", {}, { headers, ...SUPPRESSED }),
    (result) => t("aiSupport.waUsage.synced", { months: result?.summary?.months || 0 })
  );

  const saveAlerts = () => run(
    "alerts",
    () => api.put("/whatsapp/usage/alerts", {
      monthly_budget_usd: Number(form.monthly_budget_usd) || 0,
      alert_percent: Number(form.alert_percent) || 80,
    }, { headers, ...SUPPRESSED }),
    () => t("aiSupport.waUsage.alertsSaved")
  );

  if (loading) return <PanelSkeleton rows={3} />;

  const connection = data?.connection || {};
  const months = Array.isArray(data?.months) ? data.months : [];
  const localMonths = Array.isArray(data?.local_months) ? data.local_months : [];
  const current = data?.current || {};
  const alertState = data?.alert_state || { level: "none" };
  const level = alertState.level || "none";
  const percentUsed = Number(alertState.percent_used || 0);
  const lastSync = data?.alerts?.last_sync_at;
  const lastSyncError = clean(data?.alerts?.last_sync_error);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* The page header already names the section; only the explainer here. */}
        <p className="text-xs text-slate-400">{t("aiSupport.waUsage.subtitle")}</p>
        <div className="flex flex-wrap items-center gap-2">
          {connection.connected ? (
            <StatusPill state="connected">{t("aiSupport.waUsage.connected")}</StatusPill>
          ) : (
            <StatusPill state="off">{t("aiSupport.waUsage.notConnected")}</StatusPill>
          )}
          <ActionButton icon={RefreshCw} loading={busy === "sync"} disabled={!connection.connected} onClick={sync}>
            {t("aiSupport.waUsage.sync")}
          </ActionButton>
        </div>
      </div>

      {notice ? (
        <p className={`rounded-xl border p-2.5 text-xs font-bold ${notice.ok ? "border-emerald-300/20 bg-emerald-400/10 text-emerald-100" : "border-rose-300/20 bg-rose-400/10 text-rose-100"}`}>{notice.text}</p>
      ) : null}

      {!connection.connected ? (
        <div className="rounded-2xl border border-amber-300/25 bg-amber-400/[0.07] p-3 text-xs text-amber-100">
          <div className="flex items-center gap-2 font-black">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{t("aiSupport.waUsage.notConnectedTitle")}</span>
          </div>
          <p className="mt-1 leading-5">{t("aiSupport.waUsage.notConnectedHint")}</p>
          {connection.error ? <p dir="auto" className="mt-1 leading-5 text-amber-200/80">{connection.error}</p> : null}
        </div>
      ) : null}

      {lastSyncError ? (
        <div className="rounded-2xl border border-rose-300/25 bg-rose-400/[0.07] p-3 text-xs text-rose-100">
          <span className="font-black">{t("aiSupport.waUsage.lastSyncFailed")}</span>{" "}
          <span dir="auto">{lastSyncError}</span>
        </div>
      ) : null}

      {/* This month at a glance. */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          icon={MessageCircle}
          label={t("aiSupport.waUsage.cards.messages")}
          value={current.has_meta_data ? integer(current.messages) : "—"}
          hint={t("aiSupport.waUsage.cards.messagesHint")}
        />
        <SummaryCard
          icon={DollarSign}
          label={t("aiSupport.waUsage.cards.cost")}
          value={current.has_meta_data ? usd(current.cost_usd) : "—"}
          hint={t("aiSupport.waUsage.cards.costHint")}
        />
        <SummaryCard
          icon={MessageCircle}
          label={t("aiSupport.waUsage.cards.local")}
          value={integer(current.local_outbound)}
          hint={t("aiSupport.waUsage.cards.localHint")}
        />
        <div className={`rounded-2xl border p-4 ${LEVEL_RING[level] || LEVEL_RING.none}`}>
          <div className="flex items-center justify-between gap-2 text-[11px] font-black uppercase tracking-[0.12em] text-slate-500">
            <span className="flex items-center gap-2"><BellRing className="h-3.5 w-3.5" aria-hidden="true" />{t("aiSupport.waUsage.cards.budget")}</span>
            <span className="normal-case tracking-normal text-slate-300">{levelLabel(t, level)}</span>
          </div>
          {level === "none" ? (
            <div className="mt-2 text-xs leading-5 text-slate-400">{t("aiSupport.waUsage.cards.noBudget")}</div>
          ) : (
            <>
              <div className="mt-2 flex items-baseline justify-between gap-2 text-sm font-black text-white">
                <span dir="ltr">{usd(alertState.spent_usd)} / {usd(alertState.budget_usd)}</span>
                <span dir="ltr" className="text-xs text-slate-400">{percentUsed}%</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/[0.08]">
                <div className={`h-full rounded-full ${LEVEL_BAR[level] || LEVEL_BAR.none}`} style={{ width: `${Math.min(100, Math.max(0, percentUsed))}%` }} />
              </div>
            </>
          )}
        </div>
      </div>

      {/* Genie's monthly table. */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
        <span>{t("aiSupport.waUsage.sourceLabel")} {sourceLabel(t, months.length ? data?.source : "local")}</span>
        <span>{t("aiSupport.waUsage.lastSync")} {formatDateTime(lastSync, t("aiSupport.waUsage.never"))}</span>
      </div>
      <div className="overflow-x-auto rounded-2xl border border-white/10">
        <table className="w-full min-w-[900px] text-start text-xs">
          <thead className="bg-white/[0.04] text-[10.5px] uppercase tracking-[0.12em] text-slate-500">
            <tr>
              <th className="px-3 py-2 text-start">{t("aiSupport.waUsage.columns.month")}</th>
              <th className="px-3 py-2 text-start">{t("aiSupport.waUsage.columns.account")}</th>
              <th className="px-3 py-2 text-start">{t("aiSupport.waUsage.columns.service")}</th>
              <th className="px-3 py-2 text-start">{t("aiSupport.waUsage.columns.freeUsed")}</th>
              <th className="px-3 py-2 text-start">{t("aiSupport.waUsage.columns.passedFreeAt")}</th>
              <th className="px-3 py-2 text-start">{t("aiSupport.waUsage.columns.paidService")}</th>
              <th className="px-3 py-2 text-start">{t("aiSupport.waUsage.columns.marketing")}</th>
              <th className="px-3 py-2 text-start">{t("aiSupport.waUsage.columns.utility")}</th>
              <th className="px-3 py-2 text-start">{t("aiSupport.waUsage.columns.authentication")}</th>
              <th className="px-3 py-2 text-start">{t("aiSupport.waUsage.columns.cost")}</th>
              <th className="px-3 py-2 text-start">{t("aiSupport.waUsage.columns.closed")}</th>
            </tr>
          </thead>
          <tbody>
            {months.map((row) => (
              <tr key={`${row.month}-${row.waba_id}`} className="border-t border-white/5 text-slate-200">
                <td className="px-3 py-2.5 font-black">{monthLabel(row.month, language)}</td>
                <td className="px-3 py-2.5 text-slate-400" dir="ltr">{row.waba_id || "—"}</td>
                <td className="px-3 py-2.5" dir="ltr">{integer(row.service_messages)}</td>
                <td className="px-3 py-2.5" dir="ltr">{integer(row.free_used)}</td>
                <td className="px-3 py-2.5 text-slate-400">{dayLabel(row.passed_free_limit_at, language)}</td>
                <td className="px-3 py-2.5" dir="ltr">{integer(row.paid_service)}</td>
                <td className="px-3 py-2.5" dir="ltr">{integer(row.marketing)}</td>
                <td className="px-3 py-2.5" dir="ltr">{integer(row.utility)}</td>
                <td className="px-3 py-2.5" dir="ltr">{integer(row.authentication)}</td>
                <td className="px-3 py-2.5 font-black text-white" dir="ltr">{usd(row.cost_usd)}</td>
                <td className="px-3 py-2.5">
                  <span className={`inline-flex h-6 items-center rounded-full border px-2.5 text-[10.5px] font-black ${row.is_closed ? "border-white/10 bg-white/[0.06] text-slate-300" : "border-cyan-300/30 bg-cyan-400/10 text-cyan-100"}`}>
                    {row.is_closed ? t("aiSupport.waUsage.closed") : t("aiSupport.waUsage.open")}
                  </span>
                </td>
              </tr>
            ))}
            {!months.length ? (
              <tr><td colSpan={11} className="px-3 py-10 text-center text-slate-500">{t("aiSupport.waUsage.empty")}</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {/* Our own count — what the inbox sent, whether or not Meta is connected. */}
      {localMonths.length ? (
        <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
          <div className="text-[11px] font-black uppercase tracking-[0.12em] text-slate-500">{t("aiSupport.waUsage.localTitle")}</div>
          <p className="mt-1 text-[11px] leading-5 text-slate-500">{t("aiSupport.waUsage.localHint")}</p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {[...localMonths].reverse().map((row) => (
              <span key={row.month} className="inline-flex h-7 items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 text-[11px] font-black text-slate-300">
                <span>{monthLabel(row.month, language)}</span>
                <span dir="ltr" className="text-white">{integer(row.outbound)}</span>
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {/* Usage alert. */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
        <div className="flex items-center gap-2 text-sm font-black text-white">
          <BellRing className="h-4 w-4 text-slate-300" aria-hidden="true" />
          <span>{t("aiSupport.waUsage.alertsTitle")}</span>
        </div>
        <p className="mt-1 text-[11px] leading-5 text-slate-500">{t("aiSupport.waUsage.alertsHint")}</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <TextInput
            label={t("aiSupport.waUsage.budgetLabel")}
            type="number"
            min="0"
            step="1"
            dir="ltr"
            value={form.monthly_budget_usd}
            onChange={(event) => setForm((current) => ({ ...current, monthly_budget_usd: event.target.value }))}
          />
          <TextInput
            label={t("aiSupport.waUsage.percentLabel")}
            type="number"
            min="1"
            max="100"
            step="1"
            dir="ltr"
            value={form.alert_percent}
            onChange={(event) => setForm((current) => ({ ...current, alert_percent: event.target.value }))}
          />
          <ActionButton tone="primary" icon={Save} loading={busy === "alerts"} onClick={saveAlerts}>{t("aiSupport.waUsage.saveAlerts")}</ActionButton>
        </div>
      </div>
    </div>
  );
}
