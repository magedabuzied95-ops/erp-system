// "مين يبعت إيه" — inbox top bar → WhatsApp → Sending routes.
//
// One row per automatic message: does it leave from Evolution (free), the official number (Meta
// bills every template) or the number the customer last wrote to. Plus which official number the
// marketing leaves from, and the daily / monthly cap on paid templates (past it the server sends
// nothing through Meta). Setting whatsapp.send_routes — shared/whatsappSendRoutes.js; read by
// routeAutomationInstance (server/services/whatsappQueue/index.js) and templateBudget.js.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { RefreshCw, Save } from "lucide-react";

import { api } from "../../../../shared/api/api";
import ThemedSelect from "../../../../shared/ui/ThemedSelect";
import { ActionButton, PanelSkeleton } from "../integrations/integrationsUi.jsx";
import { TemplatePreview } from "./WhatsAppTemplatesPanel.jsx";
import { WHATSAPP_AUTOMATION_LABELS } from "../../../../../shared/whatsappQueueDefaults.js";
import {
  WHATSAPP_SEND_ROUTE_SETTING_KEY,
  isMarketingAutomation,
  normalizeWhatsappSendRoutes,
} from "../../../../../shared/whatsappSendRoutes.js";

const SETTINGS_CATEGORY = "ai_channels";
const SUPPRESSED = { suppressErrorStatuses: [400, 403, 404, 409, 500, 502] };
const selectTrigger = "h-9 w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 text-xs font-bold text-white";
const inputClass = "h-9 w-28 rounded-xl border border-white/10 bg-slate-950/70 px-3 text-sm font-black text-white outline-none focus:border-cyan-300/40";

// What one message costs on each route (Meta's Egypt rates from 2026-10-01, ≈ 48 EGP/USD, +14% VAT).
const costLabel = (t, type, route) => {
  if (route === "evolution") return t("aiSupport.waSendRoutes.cost.free");
  const marketing = isMarketingAutomation(type);
  if (route === "official") return marketing ? t("aiSupport.waSendRoutes.cost.marketing") : t("aiSupport.waSendRoutes.cost.utility");
  return t("aiSupport.waSendRoutes.cost.depends");
};

export default function WhatsAppSendRoutesPanel({ headers }) {
  const { t, i18n } = useTranslation();
  const isArabic = String(i18n.language || "").startsWith("ar");
  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState(() => normalizeWhatsappSendRoutes(null));
  const [accounts, setAccounts] = useState([]);
  const [budget, setBudget] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [selected, setSelected] = useState("order_confirmation");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setNotice(null);
    try {
      const [settings, numbers, templates] = await Promise.all([
        api.get(`/settings/${SETTINGS_CATEGORY}`, { headers, ...SUPPRESSED }),
        api.get("/whatsapp/developer/accounts", { headers, ...SUPPRESSED }).catch(() => null),
        api.get("/whatsapp/templates/automation", { headers, ...SUPPRESSED }).catch(() => null),
      ]);
      const row = (Array.isArray(settings?.settings) ? settings.settings : []).find((item) => item?.key === WHATSAPP_SEND_ROUTE_SETTING_KEY);
      setConfig(normalizeWhatsappSendRoutes(row?.value));
      setAccounts(Array.isArray(numbers?.accounts) ? numbers.accounts : []);
      setBudget(templates?.budget || null);
      setTemplates(Array.isArray(templates?.templates) ? templates.templates : []);
      setDirty(false);
    } catch (error) {
      setNotice({ ok: false, text: error?.message || t("aiSupport.waSendRoutes.loadFailed") });
    } finally {
      setLoading(false);
    }
  }, [headers, t]);

  useEffect(() => { void load(); }, [load]);

  const patch = (changes) => {
    setConfig((current) => normalizeWhatsappSendRoutes({ ...current, ...changes }));
    setDirty(true);
    setNotice(null);
  };
  const setRoute = (type, route) => patch({ routes: { ...config.routes, [type]: route } });

  const save = async () => {
    setSaving(true);
    setNotice(null);
    try {
      await api.put(`/settings/${SETTINGS_CATEGORY}`, { settings: { [WHATSAPP_SEND_ROUTE_SETTING_KEY]: config } }, { headers, ...SUPPRESSED });
      setDirty(false);
      setNotice({ ok: true, text: t("aiSupport.waSendRoutes.saved") });
    } catch (error) {
      setNotice({ ok: false, text: error?.message || t("aiSupport.waSendRoutes.saveFailed") });
    } finally {
      setSaving(false);
    }
  };

  const routeOptions = useMemo(() => [
    { value: "evolution", label: t("aiSupport.waSendRoutes.route.evolution") },
    { value: "official", label: t("aiSupport.waSendRoutes.route.official") },
    { value: "conversation", label: t("aiSupport.waSendRoutes.route.conversation") },
  ], [t]);
  const numberOptions = useMemo(() => [
    { value: "", label: t("aiSupport.waSendRoutes.officialNone") },
    ...accounts.map((account) => ({
      value: String(account.phone_number_id),
      label: [account.verified_name, account.display_phone_number, account.phone_number_id].filter(Boolean).join(" · "),
    })),
  ], [accounts, t]);

  // The template a row sends from the official number, drawn on a phone like the Templates page.
  const previewed = templates.find((item) => item.automation_type === selected) || null;
  const selectedLabel = WHATSAPP_AUTOMATION_LABELS[selected] || {};

  if (loading) return <PanelSkeleton rows={4} />;

  const officialMissing = !config.official_phone_number_id && Object.values(config.routes).includes("official");

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="max-w-3xl text-xs leading-5 text-slate-400">{t("aiSupport.waSendRoutes.subtitle")}</p>
        <div className="flex gap-2">
          <ActionButton icon={RefreshCw} onClick={load}>{t("aiSupport.waSendRoutes.reload")}</ActionButton>
          <ActionButton tone="primary" icon={Save} loading={saving} disabled={!dirty} onClick={save}>{t("aiSupport.waSendRoutes.save")}</ActionButton>
        </div>
      </div>
      {notice ? <p className={`rounded-xl border p-2.5 text-xs font-bold ${notice.ok ? "border-emerald-300/20 bg-emerald-400/10 text-emerald-100" : "border-rose-300/20 bg-rose-400/10 text-rose-100"}`}>{notice.text}</p> : null}

      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
          <div className="text-xs font-black text-white">{t("aiSupport.waSendRoutes.officialNumber")}</div>
          <p className="mt-0.5 text-[11px] leading-5 text-slate-400">{t("aiSupport.waSendRoutes.officialNumberHint")}</p>
          <div className="mt-2">
            <ThemedSelect
              value={config.official_phone_number_id}
              onChange={(value) => patch({ official_phone_number_id: value })}
              options={numberOptions}
              triggerClassName={selectTrigger}
            />
          </div>
          {officialMissing ? <p className="mt-2 text-[11px] font-bold text-amber-200">{t("aiSupport.waSendRoutes.officialMissing")}</p> : null}
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
          <div className="text-xs font-black text-white">{t("aiSupport.waSendRoutes.caps")}</div>
          <p className="mt-0.5 text-[11px] leading-5 text-slate-400">{t("aiSupport.waSendRoutes.capsHint")}</p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <label className="text-[11px] font-bold text-slate-300">
              {t("aiSupport.waSendRoutes.dailyCap")}
              <input type="number" min="0" inputMode="numeric" className={`${inputClass} mt-1 block`} value={config.template_daily_cap} onChange={(event) => patch({ template_daily_cap: event.target.value })} />
            </label>
            <label className="text-[11px] font-bold text-slate-300">
              {t("aiSupport.waSendRoutes.monthlyCap")}
              <input type="number" min="0" inputMode="numeric" className={`${inputClass} mt-1 block`} value={config.template_monthly_cap} onChange={(event) => patch({ template_monthly_cap: event.target.value })} />
            </label>
          </div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
          <div className="text-xs font-black text-white">{t("aiSupport.waSendRoutes.usage")}</div>
          {budget ? (
            <div className="mt-2 space-y-1 text-[12px] font-bold text-slate-200">
              <div>{t("aiSupport.waSendRoutes.usageToday", { count: budget.today, cap: budget.daily_cap })}</div>
              <div>{t("aiSupport.waSendRoutes.usageMonth", { count: budget.month, cap: budget.monthly_cap })}</div>
              <div className="text-[11px] text-slate-400">{t("aiSupport.waSendRoutes.usageSplit", { marketing: budget.month_marketing, utility: budget.month_utility })}</div>
            </div>
          ) : <p className="mt-2 text-[11px] text-slate-500">—</p>}
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 overflow-x-auto rounded-2xl border border-white/10">
        <table className="w-full text-start text-xs">
          <thead className="bg-white/[0.04] text-[10.5px] text-slate-500">
            <tr>
              <th className="px-3 py-2 text-start">{t("aiSupport.waSendRoutes.columns.message")}</th>
              <th className="px-3 py-2 text-start">{t("aiSupport.waSendRoutes.columns.kind")}</th>
              <th className="w-56 px-3 py-2 text-start">{t("aiSupport.waSendRoutes.columns.route")}</th>
              <th className="px-3 py-2 text-start">{t("aiSupport.waSendRoutes.columns.cost")}</th>
            </tr>
          </thead>
          <tbody>
            {Object.keys(config.routes).map((type) => {
              const label = WHATSAPP_AUTOMATION_LABELS[type] || {};
              const marketing = isMarketingAutomation(type);
              return (
                <tr
                  key={type}
                  onClick={() => setSelected(type)}
                  className={`cursor-pointer border-t border-white/5 text-slate-200 hover:bg-white/[0.04] ${selected === type ? "bg-cyan-400/[0.08]" : ""}`}
                >
                  <td className="px-3 py-2 font-bold">{(isArabic ? label.ar : label.en) || type}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-flex h-6 items-center rounded-full border px-2.5 text-[10.5px] font-black ${marketing ? "border-amber-300/25 bg-amber-400/10 text-amber-100" : "border-cyan-300/25 bg-cyan-400/10 text-cyan-100"}`}>
                      {marketing ? t("aiSupport.waSendRoutes.kind.marketing") : t("aiSupport.waSendRoutes.kind.order")}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <ThemedSelect value={config.routes[type]} onChange={(value) => setRoute(type, value)} options={routeOptions} triggerClassName={selectTrigger} />
                  </td>
                  <td className={`px-3 py-2 font-bold ${config.routes[type] === "evolution" ? "text-emerald-200" : "text-amber-100"}`}>{costLabel(t, type, config.routes[type])}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="lg:sticky lg:top-2 lg:self-start">
        <div className="mb-2 text-center text-xs font-black text-white">{(isArabic ? selectedLabel.ar : selectedLabel.en) || selected}</div>
        {previewed?.preview ? (
          <>
            <TemplatePreview draft={previewed.preview} />
            <p className="mt-2 text-center text-[11px] leading-5 text-slate-400">
              {config.routes[selected] === "evolution" ? t("aiSupport.waSendRoutes.previewEvolution") : t("aiSupport.waSendRoutes.previewOfficial")}
            </p>
          </>
        ) : (
          <p className="rounded-xl border border-dashed border-white/10 p-4 text-center text-xs text-slate-400">
            {selected === "marketing_broadcast" ? t("aiSupport.waSendRoutes.previewCampaign") : t("aiSupport.waSendRoutes.previewHint")}
          </p>
        )}
      </div>
      </div>
      <p className="text-[11px] leading-5 text-slate-500">{t("aiSupport.waSendRoutes.footnote")}</p>
    </div>
  );
}
