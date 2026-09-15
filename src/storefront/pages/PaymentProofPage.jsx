import { Component, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  CheckCircle2,
  Clock3,
  Copy,
  ExternalLink,
  ImagePlus,
  Loader2,
  MessageCircleWarning,
  Send,
  Smartphone,
  Wallet,
} from "lucide-react";

import { api } from "../../shared/api/api";
import { sfText } from "../lib/sfText";
import { releaseBootLoader } from "../lib/bootLoader";
import i18n, { normalizeLanguage } from "../../i18n/i18n";
import { releaseStorefrontColorScheme, setStorefrontColorScheme } from "../../theme/documentColorScheme";
// Renders outside the storefront shell (App.jsx), like /addr/:code and /c/:code, so the page brings
// the site's tokens and primitives itself.
import "../site-skin.css";
import "../catalog-skin.css";
import "./customerLinks.css";

/*
  The customer's side of the shipping-fee payment card (/pay/:code).

  The WhatsApp card has already offered "pay by InstaPay" and "copy the Vodafone Cash number"; this
  page repeats both (a customer may open the link first) and takes the transfer screenshot. The
  upload attaches it to the order and puts the order in payment review — the customer is told on
  WhatsApp that it arrived, and again when it is approved.
*/

const text = (value = "") => String(value ?? "").trim();
const formatMoney = (value) => {
  const amount = Number(value) || 0;
  const hasPiastres = Math.round(amount * 100) % 100 !== 0;
  return amount.toLocaleString("en-US", { minimumFractionDigits: hasPiastres ? 2 : 0, maximumFractionDigits: hasPiastres ? 2 : 0 });
};

const ACCEPTED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
// Phone photos can be 5-12MB and HEIC; the server takes PNG/JPG/WEBP up to 10MB. Anything else is
// redrawn as a JPEG no wider than this, which keeps a screenshot perfectly readable.
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const MAX_EDGE = 2000;

const prepareUpload = (file) => new Promise((resolve) => {
  if (!file) return resolve(null);
  if (ACCEPTED_TYPES.has(file.type) && file.size <= MAX_UPLOAD_BYTES) return resolve(file);
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.onload = () => {
    const scale = Math.min(1, MAX_EDGE / Math.max(image.naturalWidth || 1, image.naturalHeight || 1));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      URL.revokeObjectURL(url);
      resolve(blob ? new File([blob], "transfer.jpg", { type: "image/jpeg" }) : file);
    }, "image/jpeg", 0.85);
  };
  // Undecodable here: send it as it is and let the server say what is wrong with it.
  image.onerror = () => {
    URL.revokeObjectURL(url);
    resolve(file);
  };
  image.src = url;
});

const copyToClipboard = async (value) => {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    try {
      const area = document.createElement("textarea");
      area.value = value;
      area.setAttribute("readonly", "");
      area.style.position = "absolute";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(area);
      return ok;
    } catch {
      return false;
    }
  }
};

// Same key and JSON encoding as Storefront.jsx; the shop defaults to dark.
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

class PaymentProofPageErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error) {
    console.error("[payment-proof-page]", error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="sf-payment-proof-page sfx-scope sfl" data-theme={readStorefrontTheme()} dir="rtl">
          <div className="sfx-wrap sfx-wrap--sm sfx-section">
            <div className="sfx-empty">
              <span className="sfx-empty__icon">
                <MessageCircleWarning className="h-7 w-7" aria-hidden="true" />
              </span>
              <h1 className="sfx-empty__title">{sfText("storefront.paymentProof.errorTitle")}</h1>
              <p className="sfx-empty__text">{sfText("storefront.paymentProof.errorText")}</p>
            </div>
          </div>
        </main>
      );
    }
    return this.props.children;
  }
}

export function PaymentProofPage() {
  useEffect(() => {
    releaseBootLoader();
  }, []);

  return (
    <PaymentProofPageErrorBoundary>
      <PaymentProofPageInner />
    </PaymentProofPageErrorBoundary>
  );
}

function CopyRow({ label, value, dir = "ltr" }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return undefined;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);
  return (
    <div className="sfl-static-field">
      <span className="sfl-pay-copy">
        <span className="sfl-text sfl-text--sm sfl-text--muted">{label}</span>
        <span dir={dir} className="sfl-static-field__value">{value}</span>
      </span>
      <button
        type="button"
        onClick={async () => setCopied(await copyToClipboard(value))}
        className="sfx-btn sfx-btn--ghost sfx-btn--sm"
      >
        {copied ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
        {copied ? sfText("storefront.paymentProof.copied") : sfText("storefront.paymentProof.copy")}
      </button>
    </div>
  );
}

function PaymentProofPageInner() {
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

  const [linkState, setLinkState] = useState("loading"); // loading | ready | submitted | paid | not_required | closed | expired | error
  const [view, setView] = useState(null);
  const [error, setError] = useState("");
  const [method, setMethod] = useState("");
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState("");
  const [preparing, setPreparing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [fieldError, setFieldError] = useState("");
  const fileInputRef = useRef(null);

  useEffect(() => {
    let active = true;
    if (!resolvedCode) {
      setLinkState("error");
      setError(sfText("storefront.paymentProof.invalidLink"));
      return undefined;
    }
    api.get(`/public/payment-proof/${encodeURIComponent(resolvedCode)}`)
      .then((payload) => {
        if (!active) return;
        setView(payload);
        setLinkState(text(payload?.state) || "error");
        const methods = payload?.methods || {};
        const hasInstapay = Boolean(methods.instapay_url || methods.instapay_handle);
        // One method on offer is already chosen.
        if (hasInstapay && !methods.vodafone_cash) setMethod("instapay");
        if (!hasInstapay && methods.vodafone_cash) setMethod("vodafone_cash");
      })
      .catch((err) => {
        if (!active) return;
        const status = Number(err?.status || err?.response?.status || 0);
        setError(err?.responseBody?.message || err?.message || sfText("storefront.paymentProof.loadFailed"));
        setLinkState(status === 410 ? "expired" : "error");
      });
    return () => {
      active = false;
    };
  }, [resolvedCode]);

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  const pickFile = async (picked) => {
    setFieldError("");
    if (!picked) return;
    if (picked.type && !picked.type.startsWith("image/")) {
      setFieldError(sfText("storefront.paymentProof.imageOnly"));
      return;
    }
    setPreparing(true);
    const ready = await prepareUpload(picked);
    setPreparing(false);
    setFile(ready);
    setPreview((current) => {
      if (current) URL.revokeObjectURL(current);
      return ready ? URL.createObjectURL(ready) : "";
    });
  };

  const submit = async () => {
    if (!method) {
      setFieldError(sfText("storefront.paymentProof.chooseMethod"));
      return;
    }
    if (!file) {
      setFieldError(sfText("storefront.paymentProof.chooseImage"));
      return;
    }
    setFieldError("");
    setSubmitting(true);
    try {
      const body = new FormData();
      body.append("method", method);
      body.append("shipping_payment_screenshot", file, file.name || "transfer.jpg");
      const payload = await api.post(`/public/payment-proof/${encodeURIComponent(resolvedCode)}`, body);
      setView(payload);
      setLinkState("submitted");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      const status = Number(err?.status || err?.response?.status || 0);
      const message = err?.responseBody?.message || err?.message || sfText("storefront.paymentProof.submitFailed");
      const refusal = text(err?.responseBody?.code);
      if (status === 410) {
        setLinkState("expired");
        setError(message);
      } else if (refusal === "ALREADY_SUBMITTED") {
        setLinkState("submitted");
      } else if (refusal === "ALREADY_PAID") {
        setLinkState("paid");
      } else {
        setFieldError(message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const order = view?.order || {};
  const methods = view?.methods || {};
  const hasInstapay = Boolean(methods.instapay_url || methods.instapay_handle);
  const hasVodafone = Boolean(methods.vodafone_cash);
  const firstName = text(order.customer_first_name) || sfText("storefront.paymentProof.greetingFallbackName");
  const fee = formatMoney(order.shipping_fee);

  const heading = {
    submitted: sfText("storefront.paymentProof.submittedHeading"),
    paid: sfText("storefront.paymentProof.paidHeading"),
  }[linkState] || sfText("storefront.paymentProof.greeting", undefined, { name: firstName });
  const subtitle = {
    submitted: sfText("storefront.paymentProof.submittedSubtitle"),
    paid: sfText("storefront.paymentProof.paidSubtitle"),
  }[linkState] || sfText("storefront.paymentProof.introSubtitle", undefined, { amount: fee });

  const notice = {
    submitted: { tone: "success", Icon: Clock3, title: sfText("storefront.paymentProof.submittedTitle"), body: sfText("storefront.paymentProof.submittedText") },
    paid: { tone: "success", Icon: CheckCircle2, title: sfText("storefront.paymentProof.paidTitle"), body: sfText("storefront.paymentProof.paidText") },
    not_required: { tone: "accent", Icon: CheckCircle2, title: sfText("storefront.paymentProof.notRequiredTitle"), body: sfText("storefront.paymentProof.notRequiredText") },
    closed: { tone: "accent", Icon: MessageCircleWarning, title: sfText("storefront.paymentProof.closedTitle"), body: sfText("storefront.paymentProof.closedText") },
    expired: { tone: "accent", Icon: MessageCircleWarning, title: sfText("storefront.paymentProof.linkExpired"), body: error || sfText("storefront.paymentProof.askForNewLink") },
    error: { tone: "accent", Icon: MessageCircleWarning, title: sfText("storefront.paymentProof.linkUnavailable"), body: error || sfText("storefront.paymentProof.askForNewLink") },
  }[linkState];

  return (
    <main className="sf-payment-proof-page sfx-scope sfl" data-theme={theme} dir="rtl">
      <div className="sfx-wrap sfx-wrap--sm sfx-section sfl-page">
        <header className="sfl-head">
          <span className={`sfl-icon${linkState === "submitted" || linkState === "paid" ? " sfl-icon--success" : ""}`} aria-hidden="true">
            {linkState === "submitted" || linkState === "paid" ? <CheckCircle2 className="h-6 w-6" /> : <Wallet className="h-6 w-6" />}
          </span>
          <div className="sfx-page-head__text">
            <p className="sfx-kicker">{sfText("storefront.paymentProof.eyebrow")}</p>
            <h1 className="sfx-title">{heading}</h1>
            {linkState !== "loading" && linkState !== "error" && linkState !== "expired" ? <p className="sfx-subtitle">{subtitle}</p> : null}
          </div>
        </header>

        {linkState === "loading" ? (
          <div className="sfx-surface sfl-loading" role="status">
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
            {sfText("storefront.paymentProof.loading")}
          </div>
        ) : null}

        {notice ? (
          <div className={`sfx-notice sfx-notice--${notice.tone}`} role={notice.tone === "success" ? "status" : "alert"}>
            <notice.Icon aria-hidden="true" />
            <div className="sfl-notice-body">
              <h2 className="sfx-h3">{notice.title}</h2>
              <p className="sfl-text">{notice.body}</p>
            </div>
          </div>
        ) : null}

        {order.number && linkState !== "loading" && linkState !== "error" && linkState !== "expired" ? (
          <section className="sfx-surface">
            <dl className="sfl-pay-summary">
              <div>
                <dt className="sfl-text sfl-text--sm sfl-text--muted">{sfText("storefront.paymentProof.orderNumber")}</dt>
                <dd dir="ltr" className="sfl-text sfl-text--strong">{order.number}</dd>
              </div>
              <div>
                <dt className="sfl-text sfl-text--sm sfl-text--muted">{sfText("storefront.paymentProof.shippingFee")}</dt>
                <dd className="sfl-text sfl-text--strong">{sfText("storefront.paymentProof.amount", undefined, { amount: fee })}</dd>
              </div>
              {Number(order.remaining_on_delivery) > 0 ? (
                <div>
                  <dt className="sfl-text sfl-text--sm sfl-text--muted">{sfText("storefront.paymentProof.remainingOnDelivery")}</dt>
                  <dd className="sfl-text sfl-text--strong">{sfText("storefront.paymentProof.amount", undefined, { amount: formatMoney(order.remaining_on_delivery) })}</dd>
                </div>
              ) : null}
            </dl>
          </section>
        ) : null}

        {linkState === "ready" ? (
          <div className="sfx-stack">
            <section className="sfx-surface">
              <h2 className="sfx-h3 sfl-block-title">
                <Wallet aria-hidden="true" />
                {sfText("storefront.paymentProof.stepPay", undefined, { amount: fee })}
              </h2>
              <div className="sfl-fields">
                {hasInstapay || hasVodafone ? (
                  <div className="sfl-pay-methods" role="radiogroup" aria-label={sfText("storefront.paymentProof.methodLabel")}>
                    {hasInstapay ? (
                      <button
                        type="button"
                        role="radio"
                        aria-checked={method === "instapay"}
                        onClick={() => setMethod("instapay")}
                        className={`sfl-pay-method${method === "instapay" ? " is-selected" : ""}`}
                      >
                        <Wallet aria-hidden="true" />
                        {sfText("storefront.paymentProof.instapay")}
                      </button>
                    ) : null}
                    {hasVodafone ? (
                      <button
                        type="button"
                        role="radio"
                        aria-checked={method === "vodafone_cash"}
                        onClick={() => setMethod("vodafone_cash")}
                        className={`sfl-pay-method${method === "vodafone_cash" ? " is-selected" : ""}`}
                      >
                        <Smartphone aria-hidden="true" />
                        {sfText("storefront.paymentProof.vodafoneCash")}
                      </button>
                    ) : null}
                  </div>
                ) : (
                  <p className="sfl-text sfl-text--sm">{sfText("storefront.paymentProof.noMethods")}</p>
                )}

                {method === "instapay" ? (
                  <>
                    {methods.instapay_url ? (
                      <a href={methods.instapay_url} target="_blank" rel="noopener noreferrer" className="sfx-btn sfx-btn--secondary sfx-btn--lg sfx-btn--block">
                        <ExternalLink className="h-5 w-5" aria-hidden="true" />
                        {sfText("storefront.paymentProof.openInstapay")}
                      </a>
                    ) : null}
                    {methods.instapay_handle ? <CopyRow label={sfText("storefront.paymentProof.instapayHandle")} value={methods.instapay_handle} /> : null}
                  </>
                ) : null}
                {method === "vodafone_cash" ? (
                  <CopyRow label={sfText("storefront.paymentProof.vodafoneNumber")} value={methods.vodafone_cash} />
                ) : null}
              </div>
            </section>

            <section className="sfx-surface">
              <h2 className="sfx-h3 sfl-block-title">
                <ImagePlus aria-hidden="true" />
                {sfText("storefront.paymentProof.stepUpload")}
              </h2>
              <div className="sfl-fields">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="sfl-pay-file-input"
                  onChange={(event) => pickFile(event.target.files?.[0] || null)}
                />
                {preview ? (
                  <div className="sfl-pay-preview">
                    <img src={preview} alt={sfText("storefront.paymentProof.previewAlt")} />
                  </div>
                ) : null}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className={`sfx-btn ${preview ? "sfx-btn--ghost" : "sfx-btn--secondary"} sfx-btn--lg sfx-btn--block`}
                  disabled={preparing}
                >
                  {preparing ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : <ImagePlus className="h-5 w-5" aria-hidden="true" />}
                  {preview ? sfText("storefront.paymentProof.changeImage") : sfText("storefront.paymentProof.chooseImageButton")}
                </button>
              </div>
            </section>

            {fieldError ? (
              <div className="sfx-notice sfx-notice--danger" role="alert">
                <MessageCircleWarning aria-hidden="true" />
                <p className="sfl-text sfl-text--strong">{fieldError}</p>
              </div>
            ) : null}

            <button
              type="button"
              onClick={submit}
              disabled={submitting || preparing}
              className="sfx-btn sfx-btn--primary sfx-btn--lg sfx-btn--block"
            >
              {submitting ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : <Send className="h-5 w-5" aria-hidden="true" />}
              {sfText("storefront.paymentProof.submit")}
            </button>
            <p className="sfl-footnote">{sfText("storefront.paymentProof.footnote")}</p>
          </div>
        ) : null}
      </div>
    </main>
  );
}

export default PaymentProofPage;
