/*
 * /products/reviews — the moderation queue.
 *
 * Nothing a customer writes reaches the product page until someone here publishes it. The page
 * is shaped around that one decision: each review shows everything needed to make it (the
 * product, the order it came from, the stars, the words, the photos, and — unlike the public
 * page — the customer's full name and phone, so a one-star can be answered with a call) and the
 * three buttons that make it. The tabs are the three states; the count on "pending" is the work
 * left.
 */

import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import { Check, ExternalLink, Loader2, MessageSquareReply, Phone, RotateCcw, Star, X } from "lucide-react";

import ProductsShell from "../components/ProductsShell";
import {
  getProductReviews,
  replyToProductReview,
  setProductReviewStatus,
} from "../services/productsApi";
import { resolveProductImageUrl } from "../../../shared/lib/imageUrls";
import { formatInAppTimezone } from "../../../shared/lib/appTimezone";

const STATUSES = ["pending", "published", "rejected"];

const errorMessage = (error, fallback) =>
  error?.responseBody?.message || error?.response?.data?.message || error?.message || fallback;

const Stars = ({ value }) => (
  <span className="inline-flex items-center gap-0.5" aria-label={`${value}/5`}>
    {[1, 2, 3, 4, 5].map((position) => (
      <Star
        key={position}
        size={15}
        strokeWidth={1.8}
        className={position <= value ? "fill-[var(--warning)] text-[var(--warning)]" : "text-[var(--border)]"}
        aria-hidden="true"
      />
    ))}
  </span>
);

function ReviewRow({ review, onStatus, onReply, busy }) {
  const { t, i18n } = useTranslation();
  // The date follows the screen's language; the helper's own default is Arabic.
  const dateLocale = String(i18n.language || "").startsWith("ar") ? "ar-EG" : "en-GB";
  const [replyOpen, setReplyOpen] = useState(false);
  const [reply, setReply] = useState(review.reply_body || "");
  const photos = (Array.isArray(review.images) ? review.images : [])
    .map((image) => resolveProductImageUrl(typeof image === "string" ? image : image?.url))
    .filter(Boolean);
  const bought = [review.color, review.size].filter(Boolean).join(" · ");
  const lowRating = Number(review.rating) <= 2;

  return (
    <article
      className={`grid gap-3 rounded-[var(--radius-card)] border bg-[var(--card)] p-4 ${
        lowRating && review.status === "pending" ? "border-[var(--danger)]" : "border-[var(--border)]"
      }`}
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Stars value={Number(review.rating) || 0} />
            <span className="text-sm font-semibold text-[var(--text)]">{review.customer_name || t("products.reviews.noName")}</span>
            {review.phone ? (
              <a
                href={`tel:${review.phone}`}
                className="inline-flex items-center gap-1 text-xs text-[var(--muted)] hover:text-[var(--primary)]"
                dir="ltr"
              >
                <Phone size={12} aria-hidden="true" />
                {review.phone}
              </a>
            ) : null}
          </div>
          <p className="text-xs text-[var(--muted)]">
            <Link to={`/products/${review.product_id}/edit`} className="font-medium text-[var(--text)] hover:text-[var(--primary)]">
              {review.product_name}
            </Link>
            {bought ? <> · {bought}</> : null}
            {" · "}
            {t("products.reviews.order")} {review.order_number}
            {" · "}
            {formatInAppTimezone(review.created_at, { dateStyle: "medium", timeStyle: "short" }, dateLocale)}
          </p>
        </div>
        {review.product_slug ? (
          <a
            href={`https://m1store-egy.com/product/${encodeURIComponent(review.product_slug)}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-[var(--muted)] hover:text-[var(--primary)]"
          >
            <ExternalLink size={13} aria-hidden="true" />
            {t("products.reviews.viewOnSite")}
          </a>
        ) : null}
      </header>

      {review.body ? (
        // dir="auto": a customer writes in whichever language they like, and an Arabic sentence
        // laid out left-to-right puts its full stop at the start.
        <p dir="auto" className="whitespace-pre-wrap break-words text-start text-sm leading-7 text-[var(--text)]">{review.body}</p>
      ) : (
        <p className="text-xs italic text-[var(--muted)]">{t("products.reviews.starsOnly")}</p>
      )}

      {photos.length ? (
        <div className="flex flex-wrap gap-2">
          {photos.map((photo) => (
            <a key={photo} href={photo} target="_blank" rel="noreferrer" className="block size-20 overflow-hidden rounded-xl border border-[var(--border)]">
              <img src={photo} alt="" className="size-full object-cover" loading="lazy" />
            </a>
          ))}
        </div>
      ) : null}

      {review.reply_body && !replyOpen ? (
        <div className="rounded-xl border-s-4 border-[var(--primary)] bg-[var(--surface-soft)] p-3 text-sm">
          <strong className="block text-xs text-[var(--muted)]">{t("products.reviews.yourReply")}</strong>
          <p className="whitespace-pre-wrap text-[var(--text)]">{review.reply_body}</p>
        </div>
      ) : null}

      {replyOpen ? (
        <div className="grid gap-2">
          <textarea
            value={reply}
            onChange={(event) => setReply(event.target.value)}
            rows={3}
            maxLength={2000}
            placeholder={t("products.reviews.replyPlaceholder")}
            className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-sm text-[var(--text)]"
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                if (await onReply(review, reply)) setReplyOpen(false);
              }}
              className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[var(--primary)] px-4 text-sm font-semibold text-[var(--primary-contrast)] disabled:opacity-60"
            >
              {t("products.reviews.saveReply")}
            </button>
            <button
              type="button"
              onClick={() => {
                setReply(review.reply_body || "");
                setReplyOpen(false);
              }}
              className="inline-flex h-9 items-center rounded-full border border-[var(--border)] px-4 text-sm text-[var(--muted)]"
            >
              {t("products.reviews.cancel")}
            </button>
          </div>
        </div>
      ) : null}

      <footer className="flex flex-wrap gap-2">
        {review.status !== "published" ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => onStatus(review, "published")}
            className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[var(--success)] px-4 text-sm font-semibold text-white disabled:opacity-60"
          >
            <Check size={15} aria-hidden="true" />
            {t("products.reviews.publish")}
          </button>
        ) : null}
        {review.status !== "rejected" ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => onStatus(review, "rejected")}
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[var(--danger)] px-4 text-sm font-semibold text-[var(--danger)] disabled:opacity-60"
          >
            <X size={15} aria-hidden="true" />
            {review.status === "published" ? t("products.reviews.unpublish") : t("products.reviews.reject")}
          </button>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => onStatus(review, "pending")}
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[var(--border)] px-4 text-sm text-[var(--muted)] disabled:opacity-60"
          >
            <RotateCcw size={15} aria-hidden="true" />
            {t("products.reviews.backToQueue")}
          </button>
        )}
        {!replyOpen ? (
          <button
            type="button"
            onClick={() => setReplyOpen(true)}
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[var(--border)] px-4 text-sm text-[var(--text)]"
          >
            <MessageSquareReply size={15} aria-hidden="true" />
            {review.reply_body ? t("products.reviews.editReply") : t("products.reviews.reply")}
          </button>
        ) : null}
      </footer>
    </article>
  );
}

export default function ProductReviews() {
  const { t } = useTranslation();
  const [status, setStatus] = useState("pending");
  const [reviews, setReviews] = useState([]);
  const [counts, setCounts] = useState({ pending: 0, published: 0, rejected: 0 });
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async (wanted) => {
    setLoading(true);
    try {
      const data = await getProductReviews({ status: wanted });
      setReviews(Array.isArray(data?.reviews) ? data.reviews : []);
      if (data?.counts) setCounts(data.counts);
    } catch (error) {
      toast.error(errorMessage(error, t("products.reviews.loadFailed")));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load(status);
  }, [load, status]);

  const changeStatus = async (review, next) => {
    setBusyId(review.id);
    try {
      await setProductReviewStatus(review.id, next);
      toast.success(t(`products.reviews.toast.${next}`));
      // The row has left this tab; the counts move with it.
      setReviews((current) => current.filter((row) => row.id !== review.id));
      setCounts((current) => ({
        ...current,
        [review.status]: Math.max(0, (current[review.status] || 0) - 1),
        [next]: (current[next] || 0) + 1,
      }));
    } catch (error) {
      toast.error(errorMessage(error, t("products.reviews.saveFailed")));
    } finally {
      setBusyId(null);
    }
  };

  const saveReply = async (review, body) => {
    setBusyId(review.id);
    try {
      const data = await replyToProductReview(review.id, body);
      setReviews((current) => current.map((row) => (row.id === review.id ? { ...row, ...data?.review } : row)));
      toast.success(t("products.reviews.toast.reply"));
      return true;
    } catch (error) {
      toast.error(errorMessage(error, t("products.reviews.saveFailed")));
      return false;
    } finally {
      setBusyId(null);
    }
  };

  return (
    <ProductsShell title={t("products.reviews.title")} description={t("products.reviews.description")}>
      <div className="flex flex-wrap gap-2" role="tablist">
        {STATUSES.map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={status === key}
            onClick={() => setStatus(key)}
            className={`inline-flex h-9 items-center gap-2 rounded-full border px-4 text-sm font-semibold ${
              status === key
                ? "border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--primary)]"
                : "border-[var(--border)] bg-[var(--card)] text-[var(--muted)]"
            }`}
          >
            {t(`products.reviews.status.${key}`)}
            <span className="rounded-full bg-[var(--surface-soft)] px-2 text-xs tabular-nums">{counts[key] || 0}</span>
          </button>
        ))}
      </div>

      {loading ? (
        <p className="flex items-center gap-2 text-sm text-[var(--muted)]">
          <Loader2 size={16} className="animate-spin" aria-hidden="true" />
          {t("products.reviews.loading")}
        </p>
      ) : reviews.length ? (
        <div className="grid gap-3">
          {reviews.map((review) => (
            <ReviewRow
              key={review.id}
              review={review}
              busy={busyId === review.id}
              onStatus={changeStatus}
              onReply={saveReply}
            />
          ))}
        </div>
      ) : (
        <p className="rounded-[var(--radius-card)] border border-dashed border-[var(--border)] p-8 text-center text-sm text-[var(--muted)]">
          {t(`products.reviews.empty.${status}`)}
        </p>
      )}
    </ProductsShell>
  );
}
