import { Ellipsis, Globe, MessageCircle, Share2, ThumbsUp } from "lucide-react";
import { useTranslation } from "react-i18next";

import { localPreviewKind, previewUrlFor } from "../steps/mediaPreviews";

const domainOf = (displayLink, link) => {
  const shown = String(displayLink || "").trim();
  if (shown) return shown.replace(/^https?:\/\//i, "").toUpperCase();
  try {
    return new URL(link).hostname.replace(/^www\./, "").toUpperCase();
  } catch {
    return "EXAMPLE.COM";
  }
};

function MediaView({ media, emptyLabel }) {
  const url = previewUrlFor(media);
  if (!media || !url) {
    return <div className="wz-fb__media wz-fb__media--empty">{media ? <span className="wz-fb__processing">{emptyLabel}</span> : emptyLabel}</div>;
  }
  if (media.type === "video" && localPreviewKind(media) === "video") {
    return <video className="wz-fb__media" src={url} muted playsInline controls />;
  }
  return <img className="wz-fb__media" src={url} alt="" />;
}

// "معاينة الإعلان": a Facebook feed mock that follows the form live.
export default function AdPreview({ spec, account, ctaCode }) {
  const { t } = useTranslation();
  const pageName = account?.page_name || t("metaAdsWizard.preview.yourPage");
  const initial = (pageName || "P").trim().charAt(0).toUpperCase() || "P";
  const domain = domainOf(spec.display_link, spec.link);
  const ctaLabel = ctaCode && ctaCode !== "NO_BUTTON" ? t(`metaAds.cta.${ctaCode}`) : "";
  const carousel = spec.format === "carousel";
  // A catalog ad: Meta fills the cards from the product set, so the preview shows the shape.
  const catalogAd = spec.format === "catalog";
  const catalogCards = [1, 2, 3].map((n) => ({
    headline: spec.headline && !/\{\{/.test(spec.headline) ? spec.headline : t("metaAdsWizard.preview.catalogProduct", { n }),
    description: spec.description && !/\{\{/.test(spec.description) ? spec.description : t("metaAdsWizard.preview.catalogPrice"),
  }));

  return (
    <section className="wz-side-card">
      <h3 className="wz-side-card__title">{t("metaAdsWizard.preview.title")}</h3>
      <div className="wz-fb">
        <header className="wz-fb__head">
          <span className="wz-fb__avatar" aria-hidden="true">{initial}</span>
          <span className="wz-fb__who">
            <span className="wz-fb__page">{pageName}</span>
            <span className="wz-fb__sponsored">
              {t("metaAdsWizard.preview.sponsored")} · <Globe size={11} aria-hidden="true" />
            </span>
          </span>
          <Ellipsis size={18} className="wz-fb__more" aria-hidden="true" />
        </header>
        {spec.primary_text ? <p className="wz-fb__text">{spec.primary_text}</p> : null}

        {catalogAd ? (
          <div className="wz-fb__carousel">
            {catalogCards.map((card, index) => (
              <div key={index} className="wz-fb__card">
                <div className="wz-fb__media wz-fb__media--empty">{t("metaAdsWizard.preview.catalogMedia")}</div>
                <div className="wz-fb__card-foot">
                  <span className="wz-fb__headline">{card.headline}<br /><small>{card.description}</small></span>
                  {ctaLabel ? <span className="wz-fb__cta wz-fb__cta--sm">{ctaLabel}</span> : null}
                </div>
              </div>
            ))}
          </div>
        ) : carousel ? (
          <div className="wz-fb__carousel">
            {spec.cards.map((card, index) => (
              <div key={index} className="wz-fb__card">
                <MediaView media={card.media} emptyLabel="" />
                {card.headline || ctaLabel ? (
                  <div className="wz-fb__card-foot">
                    <span className="wz-fb__headline">{card.headline}</span>
                    {ctaLabel ? <span className="wz-fb__cta wz-fb__cta--sm">{ctaLabel}</span> : null}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <>
            <MediaView media={spec.media} emptyLabel={spec.media ? t("metaAdsWizard.preview.processing") : t("metaAdsWizard.preview.addMedia")} />
            <div className="wz-fb__link">
              <span className="wz-fb__link-text">
                <span className="wz-fb__domain">{domain}</span>
                {spec.headline ? <span className="wz-fb__headline">{spec.headline}</span> : null}
                {spec.description ? <span className="wz-fb__desc">{spec.description}</span> : null}
              </span>
              {ctaLabel ? <span className="wz-fb__cta">{ctaLabel}</span> : null}
            </div>
          </>
        )}

        <footer className="wz-fb__actions">
          <span><ThumbsUp size={15} aria-hidden="true" /> {t("metaAdsWizard.preview.like")}</span>
          <span><MessageCircle size={15} aria-hidden="true" /> {t("metaAdsWizard.preview.comment")}</span>
          <span><Share2 size={15} aria-hidden="true" /> {t("metaAdsWizard.preview.share")}</span>
        </footer>
      </div>
    </section>
  );
}
