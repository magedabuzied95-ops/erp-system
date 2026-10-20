/**
 * "Where did this customer come from" — GENI's Campaign Tracking tab, on an inbox conversation.
 *
 * GENI keeps it on a CRM lead: a megaphone line with the campaign on the card, a "Campaign
 * Tracking" tab (UTM source / medium / campaign, ad headline, ad body, ad source URL), a "Meta
 * Attribution" section (campaign, ad set, ad, channel, resolved or unknown ad, click count, first
 * and last click, ctwa_clid) and an "Ad Clicks" table. Our lead is the conversation, so the same
 * read comes from GET /ai-inbox/conversations/:id/attribution (server/modules/campaignAttribution).
 *
 *   <CampaignAttributionChip>  the header line: «من إعلان: …» / «من حملة واتساب: …». On the PWA
 *                              (`sheet`) a tap opens the card as a bottom sheet — the phone has no
 *                              side panel to put it in.
 *   <CampaignAttributionCard>  the side-panel card on /admin/ai-inbox.
 *
 * Both read one cached fetch per conversation and render nothing when there is no attribution.
 */
import { memo, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { ExternalLink, Megaphone, X } from "lucide-react";

import { api } from "../../../shared/api/api";
import { formatInAppTimezone } from "../../../shared/lib/appTimezone";
import { aiInboxConversationEndpoint } from "../lib/conversationHelpers";

const clean = (value) => String(value ?? "").trim();
const asArray = (value) => (Array.isArray(value) ? value : []);

/* ------------------------------------------------------------------ data */

const CACHE_TTL_MS = 60 * 1000;
const cache = new Map(); // sessionId -> { at, value, promise }
const listeners = new Map(); // sessionId -> Set(fn)

const conversationKey = (conversation = {}) => clean(conversation?.session_id || conversation?.external_conversation_id);

export const fetchConversationAttribution = (conversation = {}) => {
  const key = conversationKey(conversation);
  if (!key) return Promise.resolve(null);
  const hit = cache.get(key);
  if (hit?.promise) return hit.promise;
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return Promise.resolve(hit.value);
  const tenantId = clean(conversation?.tenant_id);
  const promise = api
    .get(aiInboxConversationEndpoint(key, "/attribution"), {
      params: tenantId ? { tenant_id: tenantId } : {},
      suppressErrorStatuses: [403, 404, 500, 502],
    })
    .then((payload) => payload?.attribution || null)
    .catch(() => null)
    .then((value) => {
      cache.set(key, { at: Date.now(), value });
      (listeners.get(key) || new Set()).forEach((fn) => fn(value));
      return value;
    });
  cache.set(key, { ...(hit || {}), promise });
  return promise;
};

export function useConversationAttribution(conversation) {
  const key = conversationKey(conversation || {});
  const [value, setValue] = useState(() => cache.get(key)?.value || null);
  useEffect(() => {
    if (!key) {
      setValue(null);
      return undefined;
    }
    setValue(cache.get(key)?.value || null);
    const set = listeners.get(key) || new Set();
    set.add(setValue);
    listeners.set(key, set);
    void fetchConversationAttribution(conversation || {});
    return () => set.delete(setValue);
    // The conversation object changes on every inbox poll; only its key decides the fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return value;
}

/* ------------------------------------------------------------------ labels */

export const attributionChipLabel = (t, attribution) => {
  if (!attribution) return "";
  const name = clean(attribution.campaign_name);
  if (attribution.source_type === "whatsapp_campaign") {
    return name ? t("aiSupport.attribution.chip.whatsappCampaign", { name }) : t("aiSupport.attribution.chip.whatsappCampaignUnnamed");
  }
  if (attribution.source_type === "meta_ad") {
    return name ? t("aiSupport.attribution.chip.metaAd", { name }) : t("aiSupport.attribution.chip.metaAdUnnamed");
  }
  return name ? t("aiSupport.attribution.chip.link", { name }) : t("aiSupport.attribution.chip.linkUnnamed");
};

const channelLabel = (t, channel) => {
  const value = clean(channel).toLowerCase();
  if (value.includes("whats")) return t("aiSupport.attribution.channel.whatsapp");
  if (value.includes("insta")) return t("aiSupport.attribution.channel.instagram");
  if (value.includes("messenger") || value.includes("facebook")) return t("aiSupport.attribution.channel.messenger");
  return value || "—";
};

const statusLabel = (t, status) =>
  clean(status) === "resolved" ? t("aiSupport.attribution.status.resolved") : t("aiSupport.attribution.status.unknownAd");

const viaLabel = (t, via) => {
  if (via === "quoted_reply") return t("aiSupport.attribution.via.quotedReply");
  if (via === "reply") return t("aiSupport.attribution.via.reply");
  return t("aiSupport.attribution.via.send");
};

/* ------------------------------------------------------------------ skins */

// Copied from OriginPostCard: the dark panel of /admin/ai-inbox and the white sheet of /inbox.
const SKINS = {
  desktop: {
    shell: "rounded-2xl border border-white/10 bg-white/[0.045] p-3",
    title: "text-white",
    label: "text-slate-500",
    value: "text-white",
    muted: "text-slate-400",
    section: "border-t border-white/10",
    row: "border-white/10 bg-slate-950/55",
    link: "border border-emerald-300/20 bg-emerald-400/10 text-emerald-100",
    chip: "border border-violet-300/20 bg-violet-400/10 text-violet-100",
    good: "text-emerald-200",
    warn: "text-amber-200",
  },
  pwa: {
    shell: "rounded-3xl border border-slate-200 bg-white p-3",
    title: "text-slate-900",
    label: "text-slate-500",
    value: "text-slate-900",
    muted: "text-slate-500",
    section: "border-t border-slate-200",
    row: "border-slate-200 bg-slate-50",
    link: "border border-emerald-200 bg-emerald-50 text-emerald-700",
    chip: "bg-violet-100 text-violet-600",
    good: "text-emerald-700",
    warn: "text-amber-700",
  },
};

/* ------------------------------------------------------------------ chip */

export const CampaignAttributionChip = memo(function CampaignAttributionChip({ conversation = null, variant = "desktop", sheet = false }) {
  const { t } = useTranslation();
  const attribution = useConversationAttribution(conversation);
  const [open, setOpen] = useState(false);
  if (!attribution) return null;
  const skin = SKINS[variant] || SKINS.desktop;
  const label = attributionChipLabel(t, attribution);
  const body = (
    <>
      <Megaphone className="h-3 w-3 shrink-0" aria-hidden="true" />
      <span dir="auto" className="truncate">{label}</span>
    </>
  );
  const chipClass = `inline-flex ${variant === "pwa" ? "h-5" : "h-6"} max-w-[16rem] min-w-0 items-center gap-1 rounded-md px-2 text-[10px] font-black ${skin.chip}`;
  if (!sheet) {
    return <span data-ai-inbox-attribution-chip={attribution.source_type} title={label} className={chipClass}>{body}</span>;
  }
  return (
    <>
      <button type="button" data-ai-inbox-attribution-chip={attribution.source_type} onClick={() => setOpen(true)} className={chipClass} aria-haspopup="dialog">
        {body}
      </button>
      {open && typeof document !== "undefined"
        ? createPortal(
          <div className="fixed inset-0 z-[99999] flex items-end justify-center bg-slate-950/40 px-2 pb-2 pt-14" onClick={() => setOpen(false)}>
            <div
              role="dialog"
              aria-label={t("aiSupport.attribution.title")}
              className="max-h-[80vh] w-full max-w-lg overflow-y-auto [padding-bottom:env(safe-area-inset-bottom)]"
              onClick={(event) => event.stopPropagation()}
            >
              <CampaignAttributionCard conversation={conversation} variant={variant} onClose={() => setOpen(false)} />
            </div>
          </div>,
          document.body
        )
        : null}
    </>
  );
});

/* ------------------------------------------------------------------ card */

function Field({ label, value, skin, ltr = false, href = "" }) {
  const shown = clean(value);
  if (!shown) return null;
  return (
    <div className={`flex items-start justify-between gap-3 rounded-xl border px-2.5 py-1.5 ${skin.row}`}>
      <div className={`shrink-0 text-[10.5px] font-black ${skin.label}`}>{label}</div>
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" dir="ltr" className={`min-w-0 truncate text-[11.5px] font-bold underline ${skin.value}`}>{shown}</a>
      ) : (
        <div dir={ltr ? "ltr" : "auto"} className={`min-w-0 break-words text-end text-[11.5px] font-bold ${skin.value}`}>{shown}</div>
      )}
    </div>
  );
}

export const CampaignAttributionCard = memo(function CampaignAttributionCard({ conversation = null, variant = "desktop", onClose = null }) {
  const { t, i18n } = useTranslation();
  const attribution = useConversationAttribution(conversation);
  if (!attribution) return null;
  const skin = SKINS[variant] || SKINS.desktop;
  const locale = String(i18n?.language || "ar").startsWith("ar") ? "ar-EG" : "en-GB";
  const when = (value) => (value ? formatInAppTimezone(value, { dateStyle: "medium", timeStyle: "short" }, locale) : "");
  const tracking = attribution.tracking || {};
  const meta = attribution.meta || null;
  const campaign = attribution.whatsapp_campaign || null;
  const clicks = asArray(attribution.clicks);
  return (
    <section data-ai-inbox-attribution-card="true" className={skin.shell}>
      <div className="flex items-center justify-between gap-2">
        <div className={`inline-flex min-w-0 items-center gap-1.5 text-[13px] font-black ${skin.title}`}>
          <Megaphone className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="truncate">{t("aiSupport.attribution.title")}</span>
        </div>
        {onClose ? (
          <button type="button" onClick={onClose} aria-label={t("aiSupport.attribution.close")} className={`grid h-7 w-7 place-items-center rounded-full ${skin.muted}`}>
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>
      <div dir="auto" className={`mt-1 text-[11.5px] font-bold ${skin.muted}`}>{attributionChipLabel(t, attribution)}</div>

      <div className="mt-2 space-y-1.5">
        <Field skin={skin} ltr label={t("aiSupport.attribution.fields.utmSource")} value={tracking.utm_source} />
        <Field skin={skin} ltr label={t("aiSupport.attribution.fields.utmMedium")} value={tracking.utm_medium} />
        <Field skin={skin} label={t("aiSupport.attribution.fields.utmCampaign")} value={tracking.utm_campaign} />
        <Field skin={skin} label={t("aiSupport.attribution.fields.adHeadline")} value={tracking.ad_headline} />
        <Field skin={skin} label={t("aiSupport.attribution.fields.adBody")} value={tracking.ad_body} />
        <Field skin={skin} label={t("aiSupport.attribution.fields.adSourceUrl")} value={tracking.ad_source_url} href={tracking.ad_source_url} />
      </div>

      {campaign ? (
        <div className={`mt-3 space-y-1.5 pt-2 ${skin.section}`}>
          <div className={`text-[11px] font-black ${skin.title}`}>{t("aiSupport.attribution.whatsappSection")}</div>
          <Field skin={skin} label={t("aiSupport.attribution.fields.campaign")} value={campaign.name} />
          <Field skin={skin} label={t("aiSupport.attribution.fields.via")} value={viaLabel(t, campaign.via)} />
          <Field skin={skin} label={t("aiSupport.attribution.fields.at")} value={when(campaign.at)} />
        </div>
      ) : null}

      {meta ? (
        <div className={`mt-3 space-y-1.5 pt-2 ${skin.section}`}>
          <div className={`text-[11px] font-black ${skin.title}`}>{t("aiSupport.attribution.metaSection")}</div>
          <Field skin={skin} label={t("aiSupport.attribution.fields.metaCampaign")} value={meta.campaign} />
          <Field skin={skin} label={t("aiSupport.attribution.fields.metaAdSet")} value={meta.adset} />
          <Field skin={skin} label={t("aiSupport.attribution.fields.metaAd")} value={meta.ad} />
          <Field skin={skin} label={t("aiSupport.attribution.fields.adChannel")} value={channelLabel(t, meta.channel)} />
          <Field skin={skin} label={t("aiSupport.attribution.fields.attribution")} value={statusLabel(t, meta.attribution_status)} />
          <Field skin={skin} label={t("aiSupport.attribution.fields.adClicks")} value={String(Number(meta.clicks_count) || 0)} />
          <Field skin={skin} label={t("aiSupport.attribution.fields.firstClick")} value={when(meta.first_click_at)} />
          <Field skin={skin} label={t("aiSupport.attribution.fields.lastClick")} value={when(meta.last_click_at)} />
          <Field skin={skin} ltr label={t("aiSupport.attribution.fields.clickId")} value={meta.ctwa_clid} />
        </div>
      ) : null}

      {clicks.length ? (
        <div className={`mt-3 pt-2 ${skin.section}`}>
          <div className={`mb-1.5 text-[11px] font-black ${skin.title}`}>{t("aiSupport.attribution.clicksSection", { count: clicks.length })}</div>
          <div className="space-y-1.5">
            {clicks.map((click) => (
              <div key={click.id || click.clicked_at} className={`rounded-xl border px-2.5 py-2 text-[11px] ${skin.row}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className={`font-black ${skin.value}`}>{when(click.clicked_at)}</span>
                  <span className={skin.muted}>{channelLabel(t, click.channel)}</span>
                </div>
                {click.headline ? <div dir="auto" className={`mt-1 font-bold ${skin.value}`}>{click.headline}</div> : null}
                <div dir="auto" className={`mt-1 ${skin.muted}`}>
                  {[click.campaign, click.ad].filter(Boolean).join(" · ") || "—"}
                </div>
                <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                  <span className={click.attribution_status === "resolved" ? skin.good : skin.warn}>{statusLabel(t, click.attribution_status)}</span>
                  {click.view_url ? (
                    <a href={click.view_url} target="_blank" rel="noreferrer" className={`inline-flex h-6 items-center gap-1 rounded-lg px-2 text-[10.5px] font-black ${skin.link}`}>
                      <ExternalLink className="h-3 w-3" />
                      {t("aiSupport.attribution.viewAd")}
                    </a>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
});

export default CampaignAttributionCard;
