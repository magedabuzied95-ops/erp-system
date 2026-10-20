import { useTranslation } from "react-i18next";
import { ImageIcon, Video } from "lucide-react";

import { resolveChatMediaUrl as resolveMediaUrl } from "../../../../shared/lib/imageUrls";

// Creative form tabs: صورة / فيديو / بطاقات دائري.
export default function CreativeMedia({ kind, record, editable, onChange }) {
  const { t } = useTranslation();

  if (kind === "image") {
    const src = resolveMediaUrl(record.image_url || record.thumbnail_url);
    return (
      <div className="mar-media">
        <div className="mar-media__label">{t("metaAdsRecords.creative.image")}</div>
        <div className="mar-media__frame">
          {src ? <img src={src} alt={record.name || ""} loading="lazy" /> : <span className="mar-media__empty"><ImageIcon size={22} aria-hidden="true" />{t("metaAdsRecords.creative.noImage")}</span>}
        </div>
        {editable ? (
          <label className="mar-media__input">
            <span>{t("metaAdsRecords.creative.imageUrl")}</span>
            <input className="mar-input" dir="ltr" value={record.image_url || ""} onChange={(event) => onChange("image_url", event.target.value)} placeholder="https://" />
          </label>
        ) : null}
      </div>
    );
  }

  if (kind === "video") {
    const src = resolveMediaUrl(record.video_url);
    const poster = resolveMediaUrl(record.thumbnail_url);
    return (
      <div className="mar-media">
        <div className="mar-media__label">{t("metaAdsRecords.creative.video")}</div>
        <div className="mar-media__frame">
          {src ? (
            <video src={src} poster={poster || undefined} controls preload="metadata" />
          ) : record.video_id ? (
            <span className="mar-media__empty"><Video size={22} aria-hidden="true" />{t("metaAdsRecords.creative.videoOnMeta", { id: record.video_id })}</span>
          ) : (
            <span className="mar-media__empty"><Video size={22} aria-hidden="true" />{t("metaAdsRecords.creative.noVideo")}</span>
          )}
        </div>
        {editable ? (
          <label className="mar-media__input">
            <span>{t("metaAdsRecords.creative.videoUrl")}</span>
            <input className="mar-input" dir="ltr" value={record.video_url || ""} onChange={(event) => onChange("video_url", event.target.value)} placeholder="https://" />
          </label>
        ) : null}
      </div>
    );
  }

  const cards = Array.isArray(record.carousel_cards) ? record.carousel_cards : [];
  if (!cards.length) return <div className="mar-media__none">{t("metaAdsRecords.creative.noCards")}</div>;
  return (
    <div className="mar-cards">
      {cards.map((card, index) => {
        const src = resolveMediaUrl(card.image_url);
        return (
          <article className="mar-cards__card" key={index}>
            <div className="mar-cards__media">{src ? <img src={src} alt={card.headline || ""} loading="lazy" /> : <ImageIcon size={20} aria-hidden="true" />}</div>
            <div className="mar-cards__body">
              <strong>{card.headline || t("metaAdsRecords.creative.card", { n: index + 1 })}</strong>
              {card.description ? <span>{card.description}</span> : null}
              {card.link ? <a href={card.link} target="_blank" rel="noreferrer noopener" dir="ltr">{card.link}</a> : null}
            </div>
          </article>
        );
      })}
    </div>
  );
}
