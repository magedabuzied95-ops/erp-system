import { Component, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { CheckCircle2, Clock3, ImagePlus, Loader2, MessageCircleWarning, Send, Star, X } from "lucide-react";

import { api } from "../../shared/api/api";
import { resolveProductImageUrl } from "../../shared/lib/imageUrls";
import { sfText } from "../lib/sfText";
import { releaseBootLoader } from "../lib/bootLoader";
import { prepareImageUpload } from "../lib/prepareImageUpload";
import { REVIEW_BODY_MAX, REVIEW_PHOTOS_MAX, canSubmitReview, rejectPhotoReason } from "../lib/productReviews";
import i18n, { normalizeLanguage } from "../../i18n/i18n";
import { releaseStorefrontColorScheme, setStorefrontColorScheme } from "../../theme/documentColorScheme";
// Outside the storefront shell (App.jsx), like /pay/:code, so the page brings the site's tokens.
import "../site-skin.css";
import "../catalog-skin.css";
import "./customerLinks.css";
import "./reviewLink.css";

/*
  The review link (/review/:code) — where every review is written.

  The customer reaches it from the WhatsApp message after delivery, or from "rate your purchases"
  in their account. No sign-in: the code is the credential and belongs to one order, so the page
  lists that order's products and nothing else. Each product is rated on its own card; a product
  already rated shows the stars given and can be corrected (a correction goes back to moderation,
  and the page says so). Photos are shrunk on the phone before they are sent.
*/

const text = (value = "") => String(value ?? "").trim();

const STOREFRONT_THEME_KEY = "storefront.theme";
const readStorefrontTheme = () => {
  if (typeof window === "undefined") return "dark";
  try {
    const raw = window.localStorage.getItem(STOREFRONT_THEME_KEY);
    return raw && JSON.parse(raw) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
};

class ReviewLinkErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error) {
    console.error("[review-link-page]", error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="sfx-scope sfl" data-theme={readStorefrontTheme()} dir="rtl">
          <div className="sfx-wrap sfx-wrap--sm sfx-section">
            <div className="sfx-empty">
              <span className="sfx-empty__icon">
                <MessageCircleWarning className="h-7 w-7" aria-hidden="true" />
              </span>
              <h1 className="sfx-empty__title">{sfText("storefront.reviewLink.errorTitle")}</h1>
              <p className="sfx-empty__text">{sfText("storefront.reviewLink.errorText")}</p>
            </div>
          </div>
        </main>
      );
    }
    return this.props.children;
  }
}

export function ProductReviewLinkPage() {
  useEffect(() => {
    releaseBootLoader();
  }, []);
  return (
    <ReviewLinkErrorBoundary>
      <ReviewLinkPageInner />
    </ReviewLinkErrorBoundary>
  );
}

/* Five 44px targets: a thumb on a phone has to hit the star it means. */
function StarPicker({ value, onChange, disabled }) {
  return (
    <div className="sfrl-stars" role="radiogroup" aria-label={sfText("storefront.reviewLink.ratingLabel")}>
      {[1, 2, 3, 4, 5].map((stars) => (
        <button
          key={stars}
          type="button"
          role="radio"
          aria-checked={value === stars}
          aria-label={sfText("storefront.reviewLink.starsAria", undefined, { stars })}
          disabled={disabled}
          onClick={() => onChange(stars)}
          className={`sfrl-star${stars <= value ? " is-on" : ""}`}
        >
          <Star aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}

const PHOTO_REASON_KEYS = {
  too_many: "storefront.reviewLink.photoTooMany",
  type: "storefront.reviewLink.photoType",
  size: "storefront.reviewLink.photoSize",
};

function ReviewCard({ item, code, onSaved }) {
  const existing = item.review;
  const [editing, setEditing] = useState(!existing);
  const [rating, setRating] = useState(existing?.rating || 0);
  // An edit starts from what the customer wrote; the server would otherwise save it blank.
  const [body, setBody] = useState(existing?.body || "");
  const [photos, setPhotos] = useState([]); // { file, url }
  const [preparing, setPreparing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [imageFailed, setImageFailed] = useState(false);
  const fileInputRef = useRef(null);
  // Preview urls are released when a photo is removed, sent, or the card goes away — never on
  // every change of the list, which would blank the previews still on screen.
  const photosRef = useRef(photos);
  photosRef.current = photos;
  useEffect(() => () => photosRef.current.forEach((photo) => URL.revokeObjectURL(photo.url)), []);

  const addPhotos = async (files) => {
    setError("");
    const picked = Array.from(files || []);
    const next = [];
    setPreparing(true);
    for (const file of picked) {
      // HEIC and big photos are redrawn first; the type/size check runs on what will be sent.
      const ready = await prepareImageUpload(file, { fileName: "review.jpg" });
      const reason = rejectPhotoReason(ready, { alreadyChosen: photos.length + next.length });
      if (reason) {
        setError(sfText(PHOTO_REASON_KEYS[reason] || "storefront.reviewLink.photoType"));
        break;
      }
      next.push({ file: ready, url: URL.createObjectURL(ready) });
    }
    setPreparing(false);
    if (next.length) setPhotos((current) => [...current, ...next]);
  };

  const removePhoto = (url) => {
    URL.revokeObjectURL(url);
    setPhotos((current) => current.filter((photo) => photo.url !== url));
  };

  const submit = async () => {
    if (!canSubmitReview({ rating })) {
      setError(sfText("storefront.reviewLink.chooseRating"));
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      const form = new FormData();
      form.append("product_id", String(item.product_id));
      form.append("rating", String(rating));
      form.append("body", body);
      photos.forEach((photo) => form.append("photos", photo.file, photo.file.name || "review.jpg"));
      const payload = await api.post(`/public/product-review/${encodeURIComponent(code)}`, form);
      onSaved(item.product_id, {
        ...(payload?.review || { rating, status: "pending" }),
        body,
        photo_count: photos.length || existing?.photo_count || 0,
      });
      setEditing(false);
      photos.forEach((photo) => URL.revokeObjectURL(photo.url));
      setPhotos([]);
    } catch (err) {
      const refusal = text(err?.responseBody?.code);
      // The photo refusals come back already in Arabic; the rest are worded here.
      const message = {
        NOT_ELIGIBLE: sfText("storefront.reviewLink.notEligible"),
        REVIEW_LINK_EXPIRED: sfText("storefront.reviewLink.expiredTitle"),
        RATING_RANGE: sfText("storefront.reviewLink.chooseRating"),
      }[refusal] || (refusal.startsWith("REVIEW_PHOTO") ? err?.responseBody?.message : "") || sfText("storefront.reviewLink.submitFailed");
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const image = resolveProductImageUrl(item.product_image);
  const bought = [item.color, item.size].map(text).filter(Boolean).join(" · ");

  return (
    <section className="sfx-surface sfrl-card">
      <div className="sfrl-product">
        {image && !imageFailed ? (
          <img className="sfrl-product__image" src={image} alt="" loading="lazy" onError={() => setImageFailed(true)} />
        ) : (
          // A missing photo is a quiet tile, not the browser's broken-image icon.
          <span className="sfrl-product__image" aria-hidden="true" />
        )}
        <div className="sfrl-product__text">
          <h2 className="sfx-h3" dir="auto">{item.product_name}</h2>
          {bought ? <p className="sfl-text sfl-text--sm sfl-text--muted" dir="auto">{bought}</p> : null}
        </div>
      </div>

      {existing && !editing ? (
        <div className={`sfx-notice sfx-notice--${existing.status === "published" ? "success" : "accent"}`} role="status">
          {existing.status === "published" ? <CheckCircle2 aria-hidden="true" /> : <Clock3 aria-hidden="true" />}
          <div className="sfl-notice-body">
            <p className="sfl-text sfl-text--strong">
              {sfText("storefront.reviewLink.youRated", undefined, { stars: existing.rating })}
            </p>
            <p className="sfl-text sfl-text--sm">
              {existing.status === "published"
                ? sfText("storefront.reviewLink.statusPublished")
                : existing.status === "rejected"
                  ? sfText("storefront.reviewLink.statusRejected")
                  : sfText("storefront.reviewLink.statusPending")}
            </p>
            <button type="button" className="sfx-link-btn sfrl-edit" onClick={() => setEditing(true)}>
              {sfText("storefront.reviewLink.edit")}
            </button>
          </div>
        </div>
      ) : (
        <div className="sfl-fields">
          <StarPicker value={rating} onChange={setRating} disabled={submitting} />
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            maxLength={REVIEW_BODY_MAX}
            rows={4}
            dir="auto"
            className="sfrl-textarea"
            placeholder={sfText("storefront.reviewLink.bodyPlaceholder")}
            disabled={submitting}
          />

          {photos.length ? (
            <div className="sfrl-photos">
              {photos.map((photo) => (
                <span key={photo.url} className="sfrl-photo">
                  <img src={photo.url} alt="" />
                  <button
                    type="button"
                    className="sfrl-photo__remove"
                    aria-label={sfText("storefront.reviewLink.removePhoto")}
                    onClick={() => removePhoto(photo.url)}
                    disabled={submitting}
                  >
                    <X aria-hidden="true" />
                  </button>
                </span>
              ))}
            </div>
          ) : null}

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="sfl-pay-file-input"
            onChange={(event) => {
              void addPhotos(event.target.files);
              event.target.value = "";
            }}
          />
          {photos.length < REVIEW_PHOTOS_MAX ? (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="sfx-btn sfx-btn--ghost sfx-btn--block"
              disabled={preparing || submitting}
            >
              {preparing ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : <ImagePlus className="h-5 w-5" aria-hidden="true" />}
              {sfText("storefront.reviewLink.addPhotos", undefined, { max: REVIEW_PHOTOS_MAX })}
            </button>
          ) : null}

          {error ? (
            <div className="sfx-notice sfx-notice--danger" role="alert">
              <MessageCircleWarning aria-hidden="true" />
              <p className="sfl-text sfl-text--strong">{error}</p>
            </div>
          ) : null}

          <button
            type="button"
            onClick={submit}
            disabled={submitting || preparing}
            className="sfx-btn sfx-btn--primary sfx-btn--lg sfx-btn--block"
          >
            {submitting ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : <Send className="h-5 w-5" aria-hidden="true" />}
            {existing ? sfText("storefront.reviewLink.saveEdit") : sfText("storefront.reviewLink.submit")}
          </button>
          {existing ? (
            <p className="sfl-footnote">
              {sfText("storefront.reviewLink.editNote")}
              {existing.photo_count ? ` ${sfText("storefront.reviewLink.photosKeptNote", undefined, { photos: existing.photo_count })}` : ""}
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}

function ReviewLinkPageInner() {
  useTranslation();
  const { code } = useParams();
  const [theme] = useState(readStorefrontTheme);

  useEffect(() => {
    if (typeof document !== "undefined" && document.body?.classList?.contains("storefront-shell")) return undefined;
    setStorefrontColorScheme(theme, theme === "dark" ? "#070707" : "#f3f3f1");
    return () => releaseStorefrontColorScheme();
  }, [theme]);

  // Reached from an Arabic WhatsApp message: Arabic, whatever the phone's browser locale says.
  useEffect(() => {
    if (normalizeLanguage(i18n.language) === "ar") return;
    i18n.changeLanguage("ar").catch(() => {});
  }, []);

  const resolvedCode = useMemo(() => {
    try {
      return decodeURIComponent(text(code));
    } catch {
      return text(code);
    }
  }, [code]);

  const [state, setState] = useState("loading"); // loading | ready | expired | error
  const [view, setView] = useState(null);

  useEffect(() => {
    let active = true;
    if (!/^[A-Za-z0-9]{16}$/.test(resolvedCode)) {
      setState("error");
      return undefined;
    }
    api.get(`/public/product-review/${encodeURIComponent(resolvedCode)}`)
      .then((payload) => {
        if (!active) return;
        setView(payload);
        setState("ready");
      })
      .catch((err) => {
        if (!active) return;
        // The page words the refusal itself; the server's message is for logs.
        const status = Number(err?.status || err?.response?.status || 0);
        setState(status === 410 ? "expired" : "error");
      });
    return () => {
      active = false;
    };
  }, [resolvedCode]);

  const saveReview = (productId, review) =>
    setView((current) => ({
      ...current,
      items: (current?.items || []).map((item) =>
        item.product_id === productId ? { ...item, review: { ...item.review, ...review } } : item
      ),
    }));

  const items = Array.isArray(view?.items) ? view.items : [];
  const allRated = items.length > 0 && items.every((item) => item.review);
  const name = text(view?.customer_first_name);

  return (
    <main className="sf-review-link-page sfx-scope sfl" data-theme={theme} dir="rtl">
      <div className="sfx-wrap sfx-wrap--sm sfx-section sfl-page">
        <header className="sfl-head">
          <span className={`sfl-icon${allRated ? " sfl-icon--success" : ""}`} aria-hidden="true">
            {allRated ? <CheckCircle2 className="h-6 w-6" /> : <Star className="h-6 w-6" />}
          </span>
          <div className="sfx-page-head__text">
            <p className="sfx-kicker">
              {view?.order_number
                ? sfText("storefront.reviewLink.eyebrowOrder", undefined, { number: view.order_number })
                : sfText("storefront.reviewLink.eyebrow")}
            </p>
            <h1 className="sfx-title">
              {allRated
                ? sfText("storefront.reviewLink.thanksHeading")
                : name
                  ? sfText("storefront.reviewLink.greeting", undefined, { name })
                  : sfText("storefront.reviewLink.greetingNoName")}
            </h1>
            {state === "ready" ? (
              <p className="sfx-subtitle">
                {allRated ? sfText("storefront.reviewLink.thanksSubtitle") : sfText("storefront.reviewLink.subtitle")}
              </p>
            ) : null}
          </div>
        </header>

        {state === "loading" ? (
          <div className="sfx-surface sfl-loading" role="status">
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
            {sfText("storefront.reviewLink.loading")}
          </div>
        ) : null}

        {state === "expired" || state === "error" ? (
          <div className="sfx-notice sfx-notice--accent" role="alert">
            <MessageCircleWarning aria-hidden="true" />
            <div className="sfl-notice-body">
              <h2 className="sfx-h3">
                {state === "expired" ? sfText("storefront.reviewLink.expiredTitle") : sfText("storefront.reviewLink.unavailableTitle")}
              </h2>
              <p className="sfl-text">{sfText("storefront.reviewLink.askForNewLink")}</p>
            </div>
          </div>
        ) : null}

        {state === "ready" && !items.length ? (
          <div className="sfx-notice sfx-notice--accent" role="status">
            <MessageCircleWarning aria-hidden="true" />
            <div className="sfl-notice-body">
              <h2 className="sfx-h3">{sfText("storefront.reviewLink.nothingTitle")}</h2>
              <p className="sfl-text">{sfText("storefront.reviewLink.nothingText")}</p>
            </div>
          </div>
        ) : null}

        {state === "ready" && items.length ? (
          <div className="sfx-stack">
            {items.map((item) => (
              <ReviewCard key={item.product_id} item={item} code={resolvedCode} onSaved={saveReview} />
            ))}
            <p className="sfl-footnote">{sfText("storefront.reviewLink.footnote")}</p>
          </div>
        ) : null}

      </div>
    </main>
  );
}

export default ProductReviewLinkPage;
