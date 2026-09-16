/*
 * "Rate your purchases" on /account.
 *
 * Delivered purchases the customer has not reviewed yet, each with a button to its order's
 * review link (/review/:code) — the same page the WhatsApp message opens, so there is one place
 * a review is written. The card is absent, not empty, when there is nothing to rate: an account
 * page does not need a box saying there is nothing to do.
 */

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Star } from "lucide-react";

import { resolveProductImageUrl } from "../../shared/lib/imageUrls";
import { sfText } from "../lib/sfText";
import { storefrontCustomerRequest } from "../lib/storefrontCustomerAuth";

/* The server hands out an absolute link (it goes into WhatsApp too); on the site it is a route. */
const reviewRoute = (url = "") => {
  try {
    return new URL(String(url)).pathname;
  } catch {
    return String(url || "");
  }
};

export default function AccountReviewsCard({ signedIn = true }) {
  useTranslation();
  const [items, setItems] = useState([]);

  useEffect(() => {
    if (!signedIn) return undefined;
    let active = true;
    storefrontCustomerRequest("/storefront/reviewable")
      .then((data) => {
        if (active) setItems(Array.isArray(data?.items) ? data.items.filter((item) => item.review_url) : []);
      })
      // An account page is not worth breaking over this card.
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [signedIn]);

  if (!items.length) return null;

  return (
    <section id="sfa-reviews" className="sfx-surface sfa-card">
      <div className="sfa-card__head">
        <span className="sfa-card__icon" aria-hidden="true"><Star className="h-[18px] w-[18px]" /></span>
        <div className="min-w-0 flex-1">
          <h2 className="sfx-h2 sfa-card__title">
            {sfText("storefront.accountReviews.title")}
            <span className="sfx-badge" dir="ltr">{items.length}</span>
          </h2>
          <p className="sfa-card__subtitle">{sfText("storefront.accountReviews.subtitle")}</p>
        </div>
      </div>
      <ul className="sfa-review-list">
        {items.map((item) => {
          const image = resolveProductImageUrl(item.product_image);
          return (
            <li key={`${item.order_id}:${item.product_id}`} className="sfa-review-row">
              {image ? <img src={image} alt="" loading="lazy" className="sfa-review-row__image" /> : <span className="sfa-review-row__image" aria-hidden="true" />}
              <div className="sfa-review-row__text">
                <span className="sfa-review-row__name" dir="auto">{item.product_name}</span>
                <span className="sfa-review-row__meta">
                  {sfText("storefront.accountReviews.order", undefined, { number: item.order_number })}
                  {item.size ? ` · ${item.size}` : ""}
                </span>
              </div>
              <Link to={reviewRoute(item.review_url)} className="sfx-btn sfx-btn--secondary sfx-btn--sm">
                <Star className="h-4 w-4" aria-hidden="true" />
                {sfText("storefront.accountReviews.rate")}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
