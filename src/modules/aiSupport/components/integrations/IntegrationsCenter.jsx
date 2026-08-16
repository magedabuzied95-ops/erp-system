// The AI Inbox integrations center.
//
// One place for every social/messaging connection the inbox depends on. It
// replaces two older surfaces: /admin/ai-channels (deleted) and the Meta
// connection half of /marketing/settings (deleted). Both are gone, not
// duplicated — a connection that can be edited from two screens is a connection
// nobody can tell the true state of.
//
// Each platform panel owns its own loading and its own writes; this shell only
// owns the nav, and a lightweight status read so the rail can show where the
// attention is needed before you click into anything.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { LayoutGrid, Music2, Plug, RefreshCw, X } from "lucide-react";
import { FaFacebookF, FaInstagram, FaWhatsapp } from "react-icons/fa";

import { api } from "../../../../shared/api/api";
import MetaIntegrationPanel from "./MetaIntegrationPanel.jsx";
import TikTokIntegrationPanel from "./TikTokIntegrationPanel.jsx";
import WhatsAppIntegrationPanel from "./WhatsAppIntegrationPanel.jsx";
import { ActionButton, PanelSection, StatusPill, clean, stateLabel } from "./integrationsUi.jsx";

// Literal keys, not an interpolated nav.<key> lookup — see stateLabel.
const navLabel = (t, key) => {
  if (key === "meta") return t("aiSupport.integrations.nav.meta");
  if (key === "whatsapp") return t("aiSupport.integrations.nav.whatsapp");
  if (key === "tiktok") return t("aiSupport.integrations.nav.tiktok");
  return t("aiSupport.integrations.nav.overview");
};

const SUPPRESSED = { suppressErrorStatuses: [400, 403, 404, 409, 500] };

// Keep in sync with INTEGRATION_TAB_KEYS in AiInbox.jsx, which validates the
// `?integrations=` deep link before this component is even loaded.
const INTEGRATION_TABS = ["overview", "meta", "whatsapp", "tiktok"];

const MetaGlyph = () => (
  <span className="relative inline-flex h-4 w-5 items-center" aria-hidden="true">
    <FaFacebookF className="h-4 w-4 text-blue-300" />
    <FaInstagram className="absolute -right-1 bottom-0 h-3 w-3 text-pink-300" />
  </span>
);

const TAB_ICON = {
  overview: () => <LayoutGrid className="h-4 w-4" aria-hidden="true" />,
  meta: MetaGlyph,
  whatsapp: () => <FaWhatsapp className="h-4 w-4 text-emerald-300" aria-hidden="true" />,
  tiktok: () => <Music2 className="h-4 w-4 text-slate-200" aria-hidden="true" />,
};

// Deliberately coarse. The panels compute the exact, actionable state; the rail
// only needs to say "healthy / needs attention / not set up".
const summarizeMeta = (status) => {
  const config = status?.config || {};
  const facebook = status?.channels?.facebook || {};
  const instagram = status?.channels?.instagram || {};
  const anyConnected = facebook.messenger_connected === true || instagram.dm_connected === true;
  const anyConfigured = Boolean(config.page_access_token_configured || config.facebook_page_id || config.instagram_business_account_id);
  if (anyConnected && facebook.webhook_healthy !== false) return "connected";
  if (anyConnected || anyConfigured) return "partial";
  return "off";
};

const summarizeWhatsapp = (gateway, cloud = {}) => {
  const cloudConfigured = cloud.env_enabled === true && cloud.access_token_configured === true && cloud.phone_number_id_configured === true;
  if (gateway?.connected === true || (cloudConfigured && cloud.effective_enabled === true)) return "connected";
  if (gateway?.configured === true || cloudConfigured || cloud.env_enabled === true) return "partial";
  return "off";
};

const summarizeTiktok = (status) => {
  if (status?.connected === true) return "connected";
  if (status?.reconnect_required === true || clean(status?.status) === "error") return "partial";
  return "off";
};

export default function IntegrationsCenter({ open, onClose, headers, initialTab = "overview" }) {
  const { t } = useTranslation();

  const [tab, setTab] = useState(INTEGRATION_TABS.includes(initialTab) ? initialTab : "overview");
  const [states, setStates] = useState({ meta: "off", whatsapp: "off", tiktok: "off" });
  const [summaryLoading, setSummaryLoading] = useState(true);

  useEffect(() => {
    if (open && INTEGRATION_TABS.includes(initialTab)) setTab(initialTab);
  }, [initialTab, open]);

  const loadSummary = useCallback(async () => {
    setSummaryLoading(true);
    const [metaResult, gatewayResult, channelsResult, tiktokResult] = await Promise.allSettled([
      api.get("/integrations/meta/status", { headers, ...SUPPRESSED }),
      api.get("/whatsapp/status", { headers, ...SUPPRESSED }),
      api.get("/ai-agent/channels/status", { headers, ...SUPPRESSED }),
      api.get("/tiktok/status", { headers, ...SUPPRESSED }),
    ]);
    setStates({
      meta: metaResult.status === "fulfilled" ? summarizeMeta(metaResult.value) : "off",
      whatsapp: summarizeWhatsapp(
        gatewayResult.status === "fulfilled" ? gatewayResult.value?.status : null,
        channelsResult.status === "fulfilled" ? channelsResult.value?.channels?.whatsapp || {} : {}
      ),
      tiktok: tiktokResult.status === "fulfilled" ? summarizeTiktok(tiktokResult.value?.data) : "off",
    });
    setSummaryLoading(false);
  }, [headers]);

  useEffect(() => {
    if (!open) return;
    void loadSummary();
  }, [loadSummary, open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => { if (event.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  // A panel that finishes loading knows more than the coarse summary read did,
  // so let it correct the rail rather than leaving two answers on screen.
  const patchState = useMemo(() => {
    const make = (key) => (value) => setStates((current) => (current[key] === value ? current : { ...current, [key]: value }));
    return { meta: make("meta"), whatsapp: make("whatsapp") };
  }, []);

  if (!open) return null;

  const rows = [
    { key: "meta", label: t("aiSupport.integrations.nav.meta"), hint: t("aiSupport.integrations.overview.metaHint") },
    { key: "whatsapp", label: t("aiSupport.integrations.nav.whatsapp"), hint: t("aiSupport.integrations.overview.whatsappHint") },
    { key: "tiktok", label: t("aiSupport.integrations.nav.tiktok"), hint: t("aiSupport.integrations.overview.tiktokHint") },
  ];

  return (
    <div
      dir="rtl"
      className="fixed inset-0 z-[260] flex items-end justify-center bg-[#050810]/75 p-2 backdrop-blur-sm md:items-center md:p-4"
      onMouseDown={(event) => event.target === event.currentTarget && onClose?.()}
    >
      <section className="flex h-[92dvh] w-full max-w-6xl flex-col overflow-hidden rounded-[26px] border border-white/10 bg-[#0b1120] text-white shadow-[0_30px_100px_rgba(0,0,0,0.55)]">
        <header className="flex items-center justify-between gap-3 border-b border-white/10 bg-white/[0.03] px-4 py-3.5">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-cyan-300/20 bg-cyan-400/10 text-cyan-200">
              <Plug className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <div className="truncate text-lg font-black">{t("aiSupport.integrations.title")}</div>
              <div className="truncate text-xs text-slate-400">{t("aiSupport.integrations.subtitle")}</div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <ActionButton tone="ghost" icon={RefreshCw} loading={summaryLoading} onClick={loadSummary}>
              {t("aiSupport.integrations.common.refresh")}
            </ActionButton>
            <button
              type="button"
              onClick={onClose}
              aria-label={t("aiSupport.integrations.common.close")}
              className="grid h-10 w-10 place-items-center rounded-xl bg-white/[0.06] text-slate-300 transition hover:bg-white/10 hover:text-white"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
        </header>

        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <nav className="flex shrink-0 gap-1.5 overflow-x-auto border-b border-white/10 bg-white/[0.02] p-2 md:w-56 md:flex-col md:overflow-y-auto md:border-b-0 md:border-s md:border-white/10">
            {INTEGRATION_TABS.map((key) => {
              const Icon = TAB_ICON[key];
              const active = tab === key;
              const state = states[key];
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTab(key)}
                  aria-current={active ? "page" : undefined}
                  className={`flex shrink-0 items-center gap-2.5 rounded-xl px-3 py-2.5 text-start text-xs font-black transition md:w-full ${
                    active ? "bg-cyan-400/10 text-cyan-100 ring-1 ring-cyan-300/25" : "text-slate-300 hover:bg-white/[0.05] hover:text-white"
                  }`}
                >
                  <Icon />
                  <span className="min-w-0 flex-1 truncate">{navLabel(t, key)}</span>
                  {state ? <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${state === "connected" ? "bg-emerald-300" : state === "partial" ? "bg-amber-300" : "bg-slate-600"}`} /> : null}
                </button>
              );
            })}
          </nav>

          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-3 md:p-4">
            {tab === "overview" ? (
              <div className="space-y-4">
                <PanelSection icon={LayoutGrid} title={t("aiSupport.integrations.overview.title")} subtitle={t("aiSupport.integrations.overview.subtitle")}>
                  <div className="grid gap-2">
                    {rows.map((row) => {
                      const Icon = TAB_ICON[row.key];
                      return (
                        <button
                          key={row.key}
                          type="button"
                          onClick={() => setTab(row.key)}
                          className="flex items-center gap-3 rounded-xl border border-white/10 bg-slate-950/40 p-3 text-start transition hover:border-cyan-300/25 hover:bg-white/[0.05]"
                        >
                          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/[0.06]"><Icon /></span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-black text-white">{row.label}</span>
                            <span className="block truncate text-[11px] text-slate-400">{row.hint}</span>
                          </span>
                          <StatusPill state={states[row.key]}>{stateLabel(t, states[row.key])}</StatusPill>
                        </button>
                      );
                    })}
                  </div>
                </PanelSection>
                <p className="rounded-2xl border border-white/10 bg-white/[0.02] p-3 text-[11px] leading-5 text-slate-500">{t("aiSupport.integrations.overview.note")}</p>
              </div>
            ) : null}
            {tab === "meta" ? <MetaIntegrationPanel onStatusChange={patchState.meta} /> : null}
            {tab === "whatsapp" ? <WhatsAppIntegrationPanel headers={headers} onStatusChange={patchState.whatsapp} /> : null}
            {tab === "tiktok" ? <TikTokIntegrationPanel /> : null}
          </div>
        </div>
      </section>
    </div>
  );
}
