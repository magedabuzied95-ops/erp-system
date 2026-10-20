// WhatsApp Template Analytics — inbox top bar → WhatsApp → Template Analytics.
//
// Sent, delivered, read, clicks and cost per template, from Meta. The page reads the cached daily
// rows; "Sync now" pulls the chosen range from Meta first. When Meta fails the "Couldn't update
// statistics" banner shows (with the technical details folded), and when template insights are
// off for the WABA it offers to switch them on.
// Server: server/modules/whatsappOfficial/analytics/analytics.routes.js (/api/whatsapp-official/analytics).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronDown, Download, RefreshCw } from "lucide-react";

import { api } from "../../../../shared/api/api";
import ThemedSelect from "../../../../shared/ui/ThemedSelect";
import { ActionButton, PanelSkeleton, formatDateTime } from "../integrations/integrationsUi.jsx";
import { StatCard, SyncErrorBanner, TemplateStatsBlock, cardClass, integer, percent } from "./whatsappTemplateAnalytics/AnalyticsBlocks.jsx";

const SUPPRESSED = { suppressErrorStatuses: [400, 403, 404, 409, 500, 502, 504] };

// One Cairo clock for the default range (never toISOString for a calendar date).
const cairoDay = (date = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
const defaultRange = () => {
  const to = cairoDay();
  const start = new Date(`${to}T12:00:00Z`);
  start.setUTCDate(start.getUTCDate() - 30);
  return { from: start.toISOString().slice(0, 10), to };
};

const labelClass = "mb-1 block text-[11px] font-bold text-slate-400";
const controlClass = "h-10 w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 text-sm font-bold text-white outline-none focus:border-cyan-300/40";

function CampaignPicker({ campaigns, value, onChange }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => { if (!boxRef.current?.contains(event.target)) setOpen(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  const toggle = (id) => onChange(value.includes(id) ? value.filter((item) => item !== id) : [...value, id]);
  const summary = !value.length
    ? t("waOfficialAnalytics.filters.campaignsPlaceholder")
    : value.length === 1
      ? campaigns.find((item) => item.id === value[0])?.name || t("waOfficialAnalytics.filters.campaignsCount", { n: 1 })
      : t("waOfficialAnalytics.filters.campaignsCount", { n: value.length });

  return (
    <div ref={boxRef} className="relative">
      <button type="button" onClick={() => setOpen((current) => !current)} className={`${controlClass} flex items-center justify-between gap-2 text-start`} aria-expanded={open}>
        <span className={`truncate ${value.length ? "" : "text-slate-500"}`}>{summary}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
      </button>
      {open ? (
        <div className="absolute start-0 z-30 mt-1 max-h-72 w-full min-w-[220px] overflow-auto rounded-xl border border-white/10 bg-slate-900 p-1 shadow-2xl">
          {campaigns.length ? (
            <>
              {value.length ? (
                <button type="button" onClick={() => onChange([])} className="w-full rounded-lg px-2.5 py-2 text-start text-[11px] font-black text-cyan-200 hover:bg-white/[0.06]">
                  {t("waOfficialAnalytics.filters.clearCampaigns")}
                </button>
              ) : null}
              {campaigns.map((campaign) => {
                const checked = value.includes(campaign.id);
                return (
                  <button
                    key={campaign.id}
                    type="button"
                    onClick={() => toggle(campaign.id)}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-start text-xs font-bold text-slate-200 hover:bg-white/[0.06]"
                  >
                    <span className={`grid h-4 w-4 shrink-0 place-items-center rounded border ${checked ? "border-cyan-300 bg-cyan-400/30" : "border-white/20"}`}>
                      {checked ? <Check className="h-3 w-3 text-cyan-100" aria-hidden="true" /> : null}
                    </span>
                    <span className="truncate" dir="auto">{campaign.name}</span>
                  </button>
                );
              })}
            </>
          ) : (
            <p className="px-2.5 py-3 text-xs text-slate-500">{t("waOfficialAnalytics.filters.noCampaigns")}</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function AccountActivity({ activity, showAccount }) {
  const { t } = useTranslation();
  const totals = activity?.totals || {};
  const daily = activity?.daily || [];
  return (
    <section className={cardClass}>
      <h3 className="text-sm font-black text-white">{t("waOfficialAnalytics.activity.title")}</h3>
      <p className="mt-1 text-[11px] leading-5 text-slate-500">{t("waOfficialAnalytics.activity.subtitle")}</p>
      <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-5">
        <StatCard label={t("waOfficialAnalytics.kpi.sent")} value={integer(totals.sent)} />
        <StatCard label={t("waOfficialAnalytics.kpi.delivered")} value={integer(totals.delivered)} />
        <StatCard label={t("waOfficialAnalytics.activity.marketing")} value={integer(totals.marketing)} />
        <StatCard label={t("waOfficialAnalytics.activity.utility")} value={integer(totals.utility)} />
        <StatCard label={t("waOfficialAnalytics.activity.authentication")} value={integer(totals.authentication)} />
      </div>
      <div className="mt-3 max-h-80 overflow-auto">
        <table className="w-full min-w-[560px] text-xs">
          <thead className="sticky top-0 bg-slate-950/90 text-[10.5px] uppercase tracking-[0.12em] text-slate-500">
            <tr>
              <th className="px-2 py-2 text-start">{t("waOfficialAnalytics.activity.date")}</th>
              {showAccount ? <th className="px-2 py-2 text-start">{t("waOfficialAnalytics.activity.account")}</th> : null}
              <th className="px-2 py-2 text-end">{t("waOfficialAnalytics.kpi.sent")}</th>
              <th className="px-2 py-2 text-end">{t("waOfficialAnalytics.kpi.delivered")}</th>
              <th className="px-2 py-2 text-end">{t("waOfficialAnalytics.activity.marketing")}</th>
              <th className="px-2 py-2 text-end">{t("waOfficialAnalytics.activity.utility")}</th>
              <th className="px-2 py-2 text-end">{t("waOfficialAnalytics.activity.authentication")}</th>
            </tr>
          </thead>
          <tbody>
            {daily.map((row) => (
              <tr key={`${row.date}|${row.phone_number_id}`} className="border-t border-white/5 text-slate-200">
                <td className="px-2 py-2" dir="ltr">{row.date}</td>
                {showAccount ? <td className="px-2 py-2 text-slate-400" dir="auto">{row.account_label}</td> : null}
                <td className="px-2 py-2 text-end" dir="ltr">{integer(row.sent)}</td>
                <td className="px-2 py-2 text-end" dir="ltr">{integer(row.delivered)}</td>
                <td className="px-2 py-2 text-end" dir="ltr">{integer(row.marketing)}</td>
                <td className="px-2 py-2 text-end" dir="ltr">{integer(row.utility)}</td>
                <td className="px-2 py-2 text-end" dir="ltr">{integer(row.authentication)}</td>
              </tr>
            ))}
            {!daily.length ? (
              <tr><td colSpan={showAccount ? 7 : 6} className="px-2 py-8 text-center text-slate-500">{t("waOfficialAnalytics.activity.empty")}</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Comparison({ rows = [] }) {
  const { t } = useTranslation();
  return (
    <section className={cardClass}>
      <h3 className="text-sm font-black text-white">{t("waOfficialAnalytics.comparison.title")}</h3>
      <div className="mt-3 overflow-auto">
        <table className="w-full min-w-[640px] text-xs">
          <thead className="text-[10.5px] uppercase tracking-[0.12em] text-slate-500">
            <tr>
              <th className="px-2 py-2 text-start">{t("waOfficialAnalytics.comparison.template")}</th>
              <th className="px-2 py-2 text-end">{t("waOfficialAnalytics.kpi.sent")}</th>
              <th className="px-2 py-2 text-end">{t("waOfficialAnalytics.kpi.delivered")}</th>
              <th className="px-2 py-2 text-end">{t("waOfficialAnalytics.kpi.read")}</th>
              <th className="px-2 py-2 text-end">{t("waOfficialAnalytics.comparison.deliveryPct")}</th>
              <th className="px-2 py-2 text-end">{t("waOfficialAnalytics.comparison.readPct")}</th>
              <th className="px-2 py-2 text-end">{t("waOfficialAnalytics.trend.clicks")}</th>
              <th className="px-2 py-2 text-end">{t("waOfficialAnalytics.comparison.ctr")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-white/5 text-slate-200">
                <td className="px-2 py-2">
                  <span className="font-black" dir="ltr">{row.name}</span>
                  <span className="ms-1.5 text-[10.5px] text-slate-500" dir="ltr">{row.language}</span>
                </td>
                <td className="px-2 py-2 text-end" dir="ltr">{integer(row.sent)}</td>
                <td className="px-2 py-2 text-end" dir="ltr">{integer(row.delivered)}</td>
                <td className="px-2 py-2 text-end" dir="ltr">{integer(row.read)}</td>
                <td className="px-2 py-2 text-end" dir="ltr">{percent(row.delivery_rate)}</td>
                <td className="px-2 py-2 text-end" dir="ltr">{percent(row.read_rate)}</td>
                <td className="px-2 py-2 text-end" dir="ltr">{integer(row.clicks)}</td>
                <td className="px-2 py-2 text-end" dir="ltr">{percent(row.ctr)}</td>
              </tr>
            ))}
            {!rows.length ? (
              <tr><td colSpan={8} className="px-2 py-8 text-center text-slate-500">{t("waOfficialAnalytics.comparison.empty")}</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function WhatsAppTemplateAnalyticsPanel({ headers }) {
  const { t } = useTranslation();
  const initial = useMemo(defaultRange, []);
  const [filters, setFilters] = useState({ account: "", campaigns: [], from: initial.from, to: initial.to });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const params = useMemo(() => ({
    account: filters.account,
    campaigns: filters.campaigns.join(","),
    from: filters.from,
    to: filters.to,
  }), [filters]);

  const load = useCallback(async () => {
    try {
      const payload = await api.get("/whatsapp-official/analytics/templates", { headers, params, ...SUPPRESSED });
      if (mountedRef.current) setData(payload);
    } catch (error) {
      if (mountedRef.current) setNotice({ ok: false, text: error?.message || t("waOfficialAnalytics.loadFailed") });
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [headers, params, t]);

  useEffect(() => { void load(); }, [load]);

  const sync = async () => {
    setBusy("sync");
    setNotice(null);
    try {
      const payload = await api.post("/whatsapp-official/analytics/sync", params, { headers, ...SUPPRESSED, timeoutMs: 120000 });
      if (!mountedRef.current) return;
      setData(payload);
      if (!payload?.summary?.errors?.length) setNotice({ ok: true, text: t("waOfficialAnalytics.synced") });
    } catch (error) {
      if (mountedRef.current) setNotice({ ok: false, text: error?.message || t("waOfficialAnalytics.syncFailed") });
    } finally {
      if (mountedRef.current) setBusy("");
    }
  };

  const enable = async () => {
    setBusy("enable");
    setNotice(null);
    try {
      await api.post("/whatsapp-official/analytics/enable", { account: filters.account }, { headers, ...SUPPRESSED });
      if (mountedRef.current) setNotice({ ok: true, text: t("waOfficialAnalytics.enabled") });
      await load();
    } catch (error) {
      if (mountedRef.current) setNotice({ ok: false, text: error?.message || t("waOfficialAnalytics.enableFailed") });
    } finally {
      if (mountedRef.current) setBusy("");
    }
  };

  const exportCsv = async () => {
    setBusy("export");
    try {
      const payload = await api.get("/whatsapp-official/analytics/export", { headers, params: { ...params, as: "json" }, ...SUPPRESSED });
      const blob = new Blob([payload?.csv || ""], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = payload?.filename || "whatsapp-template-analytics.csv";
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      if (mountedRef.current) setNotice({ ok: false, text: error?.message || t("waOfficialAnalytics.exportFailed") });
    } finally {
      if (mountedRef.current) setBusy("");
    }
  };

  if (loading && !data) return <PanelSkeleton rows={4} />;

  const accounts = data?.accounts || [];
  const accountOptions = [{ value: "", label: t("waOfficialAnalytics.filters.allAccounts") }, ...accounts.map((item) => ({ value: item.id, label: item.label }))];
  const patch = (changes) => setFilters((current) => ({ ...current, ...changes }));

  return (
    <div className="space-y-4">
      {/* The section header already names the page ("Template Analytics"); only the explainer here. */}
      <p className="text-xs text-slate-400">{t("waOfficialAnalytics.subtitle")}</p>

      <div className="flex flex-wrap items-end gap-2">
        <div className="w-full sm:w-56">
          <span className={labelClass}>{t("waOfficialAnalytics.filters.account")}</span>
          <ThemedSelect value={filters.account} onChange={(value) => patch({ account: value })} options={accountOptions} triggerClassName={controlClass} />
        </div>
        <div className="w-full sm:w-56">
          <span className={labelClass}>{t("waOfficialAnalytics.filters.campaigns")}</span>
          <CampaignPicker campaigns={data?.campaigns || []} value={filters.campaigns} onChange={(campaigns) => patch({ campaigns })} />
        </div>
        <label className="w-[calc(50%-4px)] sm:w-40">
          <span className={labelClass}>{t("waOfficialAnalytics.filters.from")}</span>
          <input type="date" dir="ltr" value={filters.from} max={filters.to} onChange={(event) => event.target.value && patch({ from: event.target.value })} className={`${controlClass} min-w-0`} />
        </label>
        <label className="w-[calc(50%-4px)] sm:w-40">
          <span className={labelClass}>{t("waOfficialAnalytics.filters.to")}</span>
          <input type="date" dir="ltr" value={filters.to} min={filters.from} onChange={(event) => event.target.value && patch({ to: event.target.value })} className={`${controlClass} min-w-0`} />
        </label>
        <ActionButton tone="emerald" icon={RefreshCw} loading={busy === "sync"} onClick={sync} className="h-10">{t("waOfficialAnalytics.syncNow")}</ActionButton>
        <ActionButton icon={Download} loading={busy === "export"} onClick={exportCsv} className="h-10">{t("waOfficialAnalytics.export")}</ActionButton>
      </div>

      <p className="text-[11px] text-slate-500">{t("waOfficialAnalytics.lastSynced")}: {formatDateTime(data?.sync?.last_synced_at)}</p>

      {data && !data.connected ? (
        <p className="rounded-xl border border-white/10 bg-white/[0.04] p-3 text-xs font-bold text-slate-300">{t("waOfficialAnalytics.notConnected")}</p>
      ) : null}
      {notice ? (
        <p className={`rounded-xl border p-2.5 text-xs font-bold ${notice.ok ? "border-emerald-300/20 bg-emerald-400/10 text-emerald-100" : "border-rose-300/20 bg-rose-400/10 text-rose-100"}`}>{notice.text}</p>
      ) : null}
      <SyncErrorBanner error={data?.sync?.error} analyticsDisabled={data?.sync?.analytics_disabled} onEnable={enable} enabling={busy === "enable"} />

      <AccountActivity activity={data?.activity} showAccount={!filters.account && accounts.length > 1} />
      <TemplateStatsBlock data={data} />
      <Comparison rows={data?.comparison || []} />
    </div>
  );
}
