import { useState } from "react";
import { Plus, Sparkles, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { CharCount, MoreToggle, RadioCard, ToggleCard, WzCard, WzField, WzInput, WzSelect, WzTextarea } from "../parts";
import {
  LIMITS,
  MAX_CAROUSEL_CARDS,
  MIN_CAROUSEL_CARDS,
  ctaOptionsFor,
  destinationFor,
  emptyCard,
  isCatalogAd,
  isMessagingDestination,
  resolveCta,
  usesInstantForm,
} from "../wizardModel";
import MediaTile from "./MediaTile";

export function FacebookBadge({ size = 28 }) {
  return (
    <span className="wz-brand wz-brand--fb" style={{ width: size, height: size }} aria-hidden="true">
      <svg viewBox="0 0 24 24" width={size * 0.6} height={size * 0.6}><path fill="currentColor" d="M14 8h2V4.5h-2.6C10.6 4.5 10 6.4 10 8.3V10H8v3.4h2V20h3.4v-6.6h2.3l.4-3.4h-2.7V8.6c0-.4.2-.6.6-.6z" /></svg>
    </span>
  );
}

export function InstagramBadge({ size = 28 }) {
  return (
    <span className="wz-brand wz-brand--ig" style={{ width: size, height: size }} aria-hidden="true">
      <svg viewBox="0 0 24 24" width={size * 0.6} height={size * 0.6} fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="4" y="4" width="16" height="16" rx="5" />
        <circle cx="12" cy="12" r="3.6" />
        <circle cx="17" cy="7" r="0.6" fill="currentColor" />
      </svg>
    </span>
  );
}

export default function AdStep({ spec, update, campaignSpec, adsetSpec, account, catalog, fieldError }) {
  const { t } = useTranslation();
  const [more, setMore] = useState(Boolean(spec.display_link || spec.url_tags));
  const objective = campaignSpec.objective;
  const destination = destinationFor(objective, adsetSpec, catalog);
  const messaging = isMessagingDestination(destination);
  const cta = resolveCta({ adSpec: spec, objective, destination, catalog });
  const ctaOptions = (messaging ? [cta] : ctaOptionsFor(objective, catalog)).map((code) => ({ value: code, label: t(`metaAds.cta.${code}`) }));
  const instantForm = usesInstantForm(objective, adsetSpec);
  const leadForms = Array.isArray(account?.lead_forms) ? account.lead_forms : [];
  const hasIg = Boolean(account?.instagram_user_id);
  const accountId = account?.id;
  const phone = destination === "PHONE_CALL";
  // Under a catalog ad set the format is Meta's: one card per product, no media of our own.
  const catalogAd = isCatalogAd(spec, adsetSpec);
  const productSet = catalogAd
    ? (Array.isArray(account?.product_sets) ? account.product_sets : []).find((set) => String(set.meta_id) === String(adsetSpec?.product_set_id))
    : null;

  const setCard = (index, patch) => update({ cards: spec.cards.map((card, i) => (i === index ? { ...card, ...patch } : card)) });
  const setOption = (index, value) => update({ primary_text_options: spec.primary_text_options.map((row, i) => (i === index ? value : row)) });

  return (
    <>
      <WzCard title={t("metaAdsWizard.ad.nameTitle")} field="name">
        <WzField error={fieldError("name")}>
          <WzInput value={spec.name} onChange={(event) => update({ name: event.target.value })} placeholder={t("metaAdsWizard.ad.namePlaceholder")} invalid={Boolean(fieldError("name"))} maxLength={400} />
        </WzField>
      </WzCard>

      <WzCard title={t("metaAdsWizard.ad.identityTitle")} subtitle={t("metaAdsWizard.ad.identitySubtitle")} field="identity">
        <div className="wz-two">
          <WzField label={t("metaAdsWizard.ad.facebookPage")} error={fieldError("identity")}>
            <div className="wz-identity">
              <FacebookBadge />
              <span className="wz-identity__name">{account?.page_name || account?.page_id || t("metaAdsWizard.ad.noPage")}</span>
            </div>
          </WzField>
          <WzField label={t("metaAdsWizard.ad.instagramAccount")}>
            <div className="wz-identity">
              <InstagramBadge />
              <span className="wz-identity__name">
                {hasIg && spec.use_instagram ? `@${account.instagram_username || account.instagram_user_id}` : t("metaAdsWizard.ad.useFacebookPage")}
              </span>
              <label className="wz-check wz-identity__use">
                <input type="checkbox" disabled={!hasIg} checked={hasIg && spec.use_instagram} onChange={(event) => update({ use_instagram: event.target.checked })} />
                <span>{t("metaAdsWizard.ad.use")}</span>
              </label>
            </div>
          </WzField>
        </div>
      </WzCard>

      <WzCard title={t("metaAdsWizard.ad.setupTitle")} field="format">
        <WzField label={t("metaAdsWizard.ad.format")} error={catalogAd ? fieldError("media") : ""}>
          {catalogAd ? (
            <div className="wz-two" role="radiogroup" aria-label={t("metaAdsWizard.ad.format")}>
              <RadioCard
                checked
                onSelect={() => update({ format: "catalog" })}
                title={t("metaAdsWizard.ad.formatCatalog")}
                description={productSet ? t("metaAdsWizard.ad.formatCatalogSet", { name: productSet.name, count: productSet.product_count || 0 }) : t("metaAdsWizard.ad.formatCatalogBody")}
              />
            </div>
          ) : (
            <div className="wz-two" role="radiogroup" aria-label={t("metaAdsWizard.ad.format")}>
              <RadioCard checked={spec.format !== "carousel"} onSelect={() => update({ format: "single" })} title={t("metaAdsWizard.ad.formatSingle")} description={t("metaAdsWizard.ad.formatSingleBody")} />
              <RadioCard checked={spec.format === "carousel"} onSelect={() => update({ format: "carousel" })} title={t("metaAdsWizard.ad.formatCarousel")} description={t("metaAdsWizard.ad.formatCarouselBody")} />
            </div>
          )}
        </WzField>
        {instantForm ? (
          <WzField label={t("metaAdsWizard.ad.leadForm")} error={fieldError("lead_form_id")} field="lead_form_id" hint={leadForms.length ? "" : t("metaAdsWizard.ad.noLeadForms")}>
            <WzSelect
              value={spec.lead_form_id}
              onChange={(value) => update({ lead_form_id: value })}
              options={leadForms.map((row) => ({ value: String(row.meta_id), label: row.name || row.meta_id }))}
              placeholder={t("metaAdsWizard.ad.leadFormPlaceholder")}
              ariaLabel={t("metaAdsWizard.ad.leadForm")}
              disabled={!leadForms.length}
            />
          </WzField>
        ) : null}
      </WzCard>

      <WzCard title={t("metaAdsWizard.ad.creativeTitle")} subtitle={catalogAd ? t("metaAdsWizard.ad.catalogCreativeSubtitle") : t("metaAdsWizard.ad.creativeSubtitle")} field="media">
        {catalogAd ? null : spec.format === "carousel" ? (
          <WzField label={t("metaAdsWizard.ad.carouselCards")} error={fieldError("media")}>
            <div className="wz-stack-sm">
              {spec.cards.map((card, index) => (
                <div key={index} className="wz-carousel-card">
                  <MediaTile media={card.media} kind="any" accountId={accountId} compact onChange={(media) => setCard(index, { media })} />
                  <div className="wz-carousel-card__fields">
                    <WzInput value={card.headline} onChange={(event) => setCard(index, { headline: event.target.value })} placeholder={t("metaAdsWizard.ad.cardHeadline")} maxLength={255} />
                    <WzInput value={card.link} onChange={(event) => setCard(index, { link: event.target.value })} placeholder={t("metaAdsWizard.ad.cardLink")} dir="ltr" />
                  </div>
                  {spec.cards.length > MIN_CAROUSEL_CARDS ? (
                    <button type="button" className="wz-icon-btn" aria-label={t("metaAdsWizard.ad.removeCard")} title={t("metaAdsWizard.ad.removeCard")} onClick={() => update({ cards: spec.cards.filter((_, i) => i !== index) })}>
                      <Trash2 size={15} />
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
            {spec.cards.length < MAX_CAROUSEL_CARDS ? (
              <button type="button" className="wz-link" onClick={() => update({ cards: [...spec.cards, emptyCard()] })}>
                <Plus size={15} aria-hidden="true" />
                <span>{t("metaAdsWizard.ad.addCard")}</span>
              </button>
            ) : null}
          </WzField>
        ) : (
          <WzField label={t("metaAdsWizard.ad.media")} error={fieldError("media")} hint={t("metaAdsWizard.ad.mediaHint")}>
            {spec.media ? (
              <div className="wz-media-row">
                <MediaTile media={spec.media} kind={spec.media.type} accountId={accountId} onChange={(media) => update({ media })} />
              </div>
            ) : (
              <div className="wz-media-row">
                <MediaTile media={null} kind="image" accountId={accountId} label={t("metaAdsWizard.ad.addImage")} onChange={(media) => update({ media })} />
                <MediaTile media={null} kind="video" accountId={accountId} label={t("metaAdsWizard.ad.addVideo")} onChange={(media) => update({ media })} />
              </div>
            )}
          </WzField>
        )}

        <WzField label={t("metaAdsWizard.ad.primaryText")} error={fieldError("primary_text")} field="primary_text">
          <WzTextarea rows={4} value={spec.primary_text} onChange={(event) => update({ primary_text: event.target.value })} placeholder={t("metaAdsWizard.ad.primaryTextPlaceholder")} invalid={Boolean(fieldError("primary_text"))} />
          <CharCount value={spec.primary_text} max={LIMITS.primaryText} />
        </WzField>
        {spec.primary_text_options.map((value, index) => (
          <div key={index} className="wz-option-row">
            <WzTextarea rows={3} value={value} onChange={(event) => setOption(index, event.target.value)} placeholder={t("metaAdsWizard.ad.textOption", { n: index + 2 })} />
            <button type="button" className="wz-icon-btn" aria-label={t("metaAdsWizard.common.remove")} onClick={() => update({ primary_text_options: spec.primary_text_options.filter((_, i) => i !== index) })}>
              <Trash2 size={15} />
            </button>
          </div>
        ))}
        <div>
          {spec.primary_text_options.length < 4 ? (
            <button type="button" className="wz-link" onClick={() => update({ primary_text_options: [...spec.primary_text_options, ""] })}>
              <Plus size={15} aria-hidden="true" />
              <span>{t("metaAdsWizard.ad.addTextOption")}</span>
            </button>
          ) : null}
          <div className="wz-hint">{t("metaAdsWizard.ad.textOptionsHint")}</div>
        </div>

        <div className="wz-two">
          <WzField label={t("metaAdsWizard.ad.headline")} error={fieldError("headline")} field="headline" hint={catalogAd ? t("metaAdsWizard.ad.catalogHeadlineHint") : ""}>
            <WzInput value={spec.headline} onChange={(event) => update({ headline: event.target.value })} placeholder={catalogAd ? "{{product.name}}" : t("metaAdsWizard.ad.headlinePlaceholder")} dir={catalogAd ? "ltr" : undefined} />
            {catalogAd ? null : <CharCount value={spec.headline} max={LIMITS.headline} />}
          </WzField>
          <WzField label={t("metaAdsWizard.ad.description")} hint={catalogAd ? t("metaAdsWizard.ad.catalogDescriptionHint") : ""}>
            <WzInput value={spec.description} onChange={(event) => update({ description: event.target.value })} placeholder={catalogAd ? "{{product.current_price}}" : t("metaAdsWizard.ad.descriptionPlaceholder")} dir={catalogAd ? "ltr" : undefined} />
            {catalogAd ? null : <CharCount value={spec.description} max={LIMITS.description} />}
          </WzField>
        </div>

        <div className="wz-two">
          <WzField label={t("metaAdsWizard.ad.cta")} hint={messaging ? t("metaAdsWizard.ad.ctaForced") : ""}>
            <WzSelect value={cta} onChange={(value) => update({ cta: value })} options={ctaOptions} ariaLabel={t("metaAdsWizard.ad.cta")} disabled={messaging} />
          </WzField>
          <WzField
            label={phone ? t("metaAdsWizard.ad.phoneLink") : t("metaAdsWizard.ad.website")}
            error={fieldError("link")}
            field="link"
            hint={messaging ? t("metaAdsWizard.ad.websiteOptional") : ""}
          >
            <WzInput
              type={phone ? "tel" : "url"}
              dir="ltr"
              value={spec.link}
              onChange={(event) => update({ link: event.target.value })}
              placeholder={phone ? "tel:+201000000000" : "https://example.com/landing"}
              invalid={Boolean(fieldError("link"))}
            />
          </WzField>
        </div>

        <MoreToggle open={more} onToggle={() => setMore((value) => !value)} label={t("metaAdsWizard.common.moreOptions")} />
        {more ? (
          <div className="wz-stack">
            <WzField label={t("metaAdsWizard.ad.displayLink")}>
              <WzInput dir="ltr" value={spec.display_link} onChange={(event) => update({ display_link: event.target.value })} placeholder={t("metaAdsWizard.ad.displayLinkPlaceholder")} />
            </WzField>
            <WzField label={t("metaAdsWizard.ad.urlParams")} hint={t("metaAdsWizard.ad.urlParamsHint")}>
              <WzInput dir="ltr" value={spec.url_tags} onChange={(event) => update({ url_tags: event.target.value })} placeholder="utm_source=facebook&utm_medium=paid&utm_campaign={{campaign.name}}" />
            </WzField>
          </div>
        ) : null}
      </WzCard>

      <WzCard field="advantage_creative">
        <ToggleCard
          icon={Sparkles}
          title={t("metaAdsWizard.ad.advantageTitle")}
          description={t("metaAdsWizard.ad.advantageBody")}
          checked={spec.advantage_creative}
          onChange={(value) => update({ advantage_creative: value })}
        />
      </WzCard>

      <WzCard title={t("metaAdsWizard.tracking.title")} subtitle={t("metaAdsWizard.tracking.subtitle")} field="tracking">
        <div className="wz-label">{t("metaAdsWizard.tracking.websiteEvents")}</div>
        {account?.pixel_id ? (
          <label className="wz-check">
            <input type="checkbox" checked={spec.track_pixel} onChange={(event) => update({ track_pixel: event.target.checked })} />
            <span>{t("metaAdsWizard.tracking.pixel", { id: account.pixel_id })}</span>
          </label>
        ) : (
          <div className="wz-hint">{t("metaAdsWizard.tracking.noPixel")}</div>
        )}
      </WzCard>
    </>
  );
}
