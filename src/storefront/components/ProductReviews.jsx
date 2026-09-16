/*
 * The reviews under a product.
 *
 * Nothing here is decorative. The average and the count are the two numbers a shopper checks
 * before anything else; the bars are there because a rating's shape says more than its mean;
 * every review carries the badge that says it came from a delivered order, and the size the
 * reviewer actually bought, because "it runs small" is only useful next to a size.
 *
 * A product with no reviews yet renders a plain, honest empty state rather than a zero — a
 * greyed-out five stars reads as a bad product, which is the opposite of the truth.
 */

import { useCallback, useEffect, useState } from "react";
import { BadgeCheck, Loader2, Star } from "lucide-react";

import { api } from "../../shared/api/api";
import { sfText } from "../Storefront";
import {
  EMPTY_RATING_SUMMARY,
  REVIEW_STARS,
  formatRatingAverage,
  normalizeRatingSummary,
  ratingBars,
  reviewPhotoUrls,
  starFill,
} from "../lib/productReviews";
import "./productReviews.css";

const REVIEWS_PAGE = 10;

/* One row of stars. `fill` per star rather than per row: a 4.5 has to show a half. */
export const StarRow = ({ value = 0, size = 16, label = "" }) => (
  <span className="sfr-stars" role="img" aria-label={label || `${value}`}>
    {[1, 2, 3, 4, 5].map((position) => {
      const fill = starFill(value, position);
      return (
        <span key={position} className="sfr-stars__slot" style={{ width: size, height: size }}>
          <Star className="sfr-stars__ghost" style={{ width: size, height: size }} aria-hidden="true" />
          {fill > 0 ? (
            <span className="sfr-stars__fill" style={{ width: `${fill * 100}%` }}>
              <Star className="sfr-stars__on" style={{ width: size, height: size }} aria-hidden="true" />
            </span>
          ) : null}
        </span>
      );
    })}
  </span>
);

/*
 * The one-line rating that sits next to the price, above the fold. It is a link to the section
 * below rather than a number on its own: a shopper who cares about the rating wants the words.
 */
export const ProductRatingBadge = ({ summary, onOpen }) => {
  const rating = normalizeRatingSummary(summary);
  if (!rating.review_count) return null;
  const average = formatRatingAverage(rating.rating_average);
  return (
    <button type="button" className="sfr-badge" onClick={onOpen}>
      <StarRow value={rating.rating_average} size={14} label={average} />
      <span className="sfr-badge__average">{average}</span>
      <span className="sfr-badge__count">
        ({rating.review_count} {sfText("storefront.reviews.countShort", "تقييم")})
      </span>
    </button>
  );
};

const ReviewCard = ({ review }) => {
  const photos = reviewPhotoUrls(review);
  const bought = [review.color, review.size].map((value) => String(value || "").trim()).filter(Boolean).join(" · ");
  return (
    <article className="sfr-card">
      <header className="sfr-card__head">
        <StarRow value={review.rating} size={14} label={`${review.rating}`} />
        <span className="sfr-card__name">{review.customer_name}</span>
        {/* The badge is not a claim we decorate the page with: the row exists only because a
            delivered order line matched this phone. */}
        <span className="sfr-card__verified">
          <BadgeCheck className="sfr-card__verified-icon" aria-hidden="true" />
          {sfText("storefront.reviews.verifiedPurchase", "مشترى موثّق")}
        </span>
      </header>
      {bought ? (
        <p className="sfr-card__bought">
          {sfText("storefront.reviews.bought", "اشترى")}: {bought}
        </p>
      ) : null}
      {/* dir="auto": the customer's own language decides the direction, so an English review
          on the Arabic page (or the reverse) keeps its punctuation where it belongs. */}
      {review.body ? <p dir="auto" className="sfr-card__body">{review.body}</p> : null}
      {photos.length ? (
        <div className="sfr-card__photos">
          {photos.map((photo) => (
            <a key={photo} href={photo} target="_blank" rel="noreferrer" className="sfr-card__photo">
              <img src={photo} alt="" loading="lazy" decoding="async" />
            </a>
          ))}
        </div>
      ) : null}
      {review.reply_body ? (
        <div className="sfr-card__reply">
          <strong>{sfText("storefront.reviews.replyFrom", "رد المتجر")}</strong>
          <p dir="auto">{review.reply_body}</p>
        </div>
      ) : null}
    </article>
  );
};

const ProductReviews = ({ productId, summary: summaryFromParent = null, sectionId = "sf-product-reviews" }) => {
  const [summary, setSummary] = useState(() => normalizeRatingSummary(summaryFromParent));
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadedAll, setLoadedAll] = useState(false);

  const load = useCallback(
    async (offset = 0) => {
      if (!productId) return;
      setLoading(true);
      try {
        const data = await api.get(`/storefront/products/${productId}/reviews`, {
          params: { limit: REVIEWS_PAGE, offset },
          debugLabel: "storefront-product-reviews",
        });
        const page = Array.isArray(data?.reviews) ? data.reviews : [];
        setSummary(normalizeRatingSummary(data?.summary));
        setReviews((current) => (offset ? [...current, ...page] : page));
        if (page.length < REVIEWS_PAGE) setLoadedAll(true);
      } catch {
        // A product page is not worth breaking over its reviews: the section simply stays empty.
        setLoadedAll(true);
      } finally {
        setLoading(false);
      }
    },
    [productId]
  );

  useEffect(() => {
    setReviews([]);
    setLoadedAll(false);
    setSummary(normalizeRatingSummary(summaryFromParent));
    void load(0);
    // summaryFromParent is a seed for the first paint only; the fetch is the authority.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId, load]);

  const average = formatRatingAverage(summary.rating_average);
  const bars = ratingBars(summary.distribution, summary.review_count);

  return (
    <section id={sectionId} aria-labelledby={`${sectionId}-title`} className="sfr">
      <h2 id={`${sectionId}-title`} className="sfx-pdp-h2">
        {sfText("storefront.reviews.title", "تقييمات العملاء")}
      </h2>

      {summary.review_count ? (
        <div className="sfr-summary">
          <div className="sfr-summary__score">
            <span className="sfr-summary__average">{average}</span>
            <StarRow value={summary.rating_average} size={18} label={average} />
            <span className="sfr-summary__count">
              {summary.review_count} {sfText("storefront.reviews.countShort", "تقييم")}
            </span>
          </div>
          <ul className="sfr-summary__bars">
            {bars.map((bar) => (
              <li key={bar.stars} className="sfr-bar">
                <span className="sfr-bar__label">
                  {bar.stars} <Star className="sfr-bar__star" aria-hidden="true" />
                </span>
                <span className="sfr-bar__track">
                  <span className="sfr-bar__fill" style={{ width: `${bar.percent}%` }} />
                </span>
                <span className="sfr-bar__count">{bar.count}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="sfr-empty">
          {sfText("storefront.reviews.empty", "لسه مفيش تقييمات على المنتج ده. أول تقييم هيكون من أول عميل يستلمه.")}
        </p>
      )}

      {reviews.length ? (
        <div className="sfr-list">
          {reviews.map((review) => (
            <ReviewCard key={review.id} review={review} />
          ))}
        </div>
      ) : null}

      {loading ? (
        <p className="sfr-loading">
          <Loader2 className="sfr-loading__icon" aria-hidden="true" />
          {sfText("storefront.reviews.loading", "بنحمّل التقييمات...")}
        </p>
      ) : null}

      {!loadedAll && !loading && reviews.length ? (
        <button type="button" className="sfr-more" onClick={() => load(reviews.length)}>
          {sfText("storefront.reviews.more", "شوف تقييمات أكتر")}
        </button>
      ) : null}
    </section>
  );
};

export { REVIEW_STARS, EMPTY_RATING_SUMMARY };
export default ProductReviews;
