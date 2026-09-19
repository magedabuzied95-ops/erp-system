// The connections at a glance.
//
// Lifted out of the old IntegrationsCenter shell so the control center can mount it as one section
// among many. Deliberately coarse: each platform panel computes the exact, actionable state, and this
// only needs to say healthy / needs attention / not set up before you click into one.

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { LayoutGrid, RefreshCw } from "lucide-react";
import { FaFacebookF, FaInstagram, FaWhatsapp } from "react-icons/fa";
import { Music2 } from "lucide-react";

import { api } from "../../../../shared/api/api";
import { ActionButton, PanelSection, StatusPill, clean, stateLabel } from "../integrations/integrationsUi.jsx";

const SUPPRESSED = { suppressErrorStatuses: [400, 403, 404, 409, 500] };

const MetaGlyph = () => (
  <span className="relative inline-flex h-4 w-5 items-center" aria-hidden="true">
    <FaFacebookF className="h-4 w-4 text-blue-300" />
    <FaInstagram className="absolute -right-1 bottom-0 h-3 w-3 text-pink-300" />
  </span>
);

const ICON = {
  meta: MetaGlyph,
  whatsapp: () => <FaWhatsapp className="h-4 w-4 text-emerald-300" aria-hidden="true" />,
  tiktok: () => <Music2 className="h-4 w-4 text-slate-200" aria-hidden="true" />,
};

const summarizeMeta = (status) => {
  const config = status?.config || {};
  const facebook = status?.channels?.facebook || {};
  const instagram = status?.channels?.instagram || {};
  const anyConnected = facebook.messenger_connected === true || instagram.dm_connected === true;
  const anyConfigured = Boolean(
    config.page_access_token_configured || config.facebook_page_id || config.instagram_business_account_id
  );
  if (anyConnected && facebook.webhook_healthy !== false) return "connected";
  if (anyConnected || anyConfigured) return "partial";
  return "off";
};

const summarizeWhatsapp = (gateway, cloud = {}) => {
  const cloudConfigured =
    cloud.env_enabled === true && cloud.access_token_configured === true && cloud.phone_number_id_configured === true;
  if (gateway?.connected === true || (cloudConfigured && cloud.effective_enabled === true)) return "connected";
  if (gateway?.configured === true || cloudConfigured || cloud.env_enabled === true) return "partial";
  return "off";
};

const summarizeTiktok = (status) => {
  if (status?.connected === true) return "connected";
  if (status?.reconnect_required === true || clean(status?.status) === "error") return "partial";
  return "off";
};

export default function IntegrationsOverviewPanel({ headers, onOpenSection }) {
  const { t } = useTranslation();
  const [states, setStates] = useState({ meta: "off", whatsapp: "off", tiktok: "off" });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
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
    setLoading(false);
  }, [headers]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = [
    { key: "meta", label: t("aiSupport.integrations.nav.meta"), hint: t("aiSupport.integrations.overview.metaHint") },
    { key: "whatsapp", label: t("aiSupport.integrations.nav.whatsapp"), hint: t("aiSupport.integrations.overview.whatsappHint") },
    { key: "tiktok", label: t("aiSupport.integrations.nav.tiktok"), hint: t("aiSupport.integrations.overview.tiktokHint") },
  ];

  return (
    <div className="space-y-4">
      <PanelSection
        icon={LayoutGrid}
        title={t("aiSupport.integrations.overview.title")}
        subtitle={t("aiSupport.integrations.overview.subtitle")}
        action={
          <ActionButton tone="ghost" icon={RefreshCw} loading={loading} onClick={load}>
            {t("aiSupport.integrations.common.refresh")}
          </ActionButton>
        }
      >
        <div className="grid gap-2">
          {rows.map((row) => {
            const Icon = ICON[row.key];
            return (
              <button
                key={row.key}
                type="button"
                onClick={() => onOpenSection?.(row.key)}
                className="flex items-center gap-3 rounded-xl border border-white/10 bg-slate-950/40 p-3 text-start transition hover:border-cyan-300/25 hover:bg-white/[0.05]"
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/[0.06]">
                  <Icon />
                </span>
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
      <p className="rounded-2xl border border-white/10 bg-white/[0.02] p-3 text-[11px] leading-5 text-slate-500">
        {t("aiSupport.integrations.overview.note")}
      </p>
    </div>
  );
}
