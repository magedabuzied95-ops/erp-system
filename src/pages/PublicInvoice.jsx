import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  Download,
  ExternalLink,
  Globe,
  Loader2,
  Printer,
  ShieldCheck,
  Star,
  Smartphone,
} from "lucide-react";

import { api } from "../shared/api/api";
import { getPublicSettings } from "../shared/api/publicSettings";
import OrderInvoiceCard from "../shared/components/invoices/OrderInvoiceCard";
import { normalizeOrderInvoiceData } from "../shared/utils/orderInvoice";
import { getPrintDirection, normalizePrintLanguage, tPrint } from "../shared/utils/printLocalization";

const invoicePrintLabel = (key, fallback, options) => tPrint(`print.invoice.${key}`, fallback, options);
const M1_STORE_WEBSITE_TEXT = "Www.m1store-egy.com";
const M1_STORE_WEBSITE_HREF = "https://www.m1store-egy.com";
const M1_STORE_PHONE = "01000659301";
const PUBLIC_RETURN_POLICY_LINES = [
  "يمكنك الاستبدال أو الاسترجاع خلال 14 يومًا من تاريخ الاستلام وفق الشروط التالية:",
  "• يجب أن تكون المنتجات غير مستخدمة وبحالتها الأصلية.",
  "• يجب وجود الفاتورة الأصلية.",
  "• في حالة وجود عيب مصنعي، تتحمل M1 Store تكلفة الشحن.",
  "• في حالة الاستبدال بسبب رغبة العميل مثل المقاس أو اللون، يتحمل العميل تكلفة الشحن ذهابًا وعودة.",
  "للاستفسارات، تواصل مع خدمة العملاء.",
];
const DEFAULT_SOCIAL_LINKS = {
  googleReviewUrl: "https://www.google.com/maps/place//data=!4m3!3m2!1s0x14f9e3498b6a02f9:0xd576a0402361f8c8!12e1?source=g.page.m._&laa=merchant-review-solicitation",
  facebookReviewUrl: "https://www.facebook.com/share/1DmN6zj29g/?mibextid=wwXIfr",
  instagramUrl: "https://www.instagram.com/m1store_egy?igsh=MWplb2d4cmJ4YmxhaQ%3D%3D&utm_source=qr",
};

const getPublicAppUrl = () => {
  const selected = [
    import.meta.env.VITE_PUBLIC_APP_URL,
    import.meta.env.PUBLIC_APP_URL,
    import.meta.env.FRONTEND_URL,
  ]
    .map((value) => String(value || "").trim())
    .find(Boolean);
  if (selected) return selected.replace(/\/$/, "");
  if (typeof window !== "undefined") return window.location.origin.replace(/\/$/, "");
  return "";
};

const normalizePublicUrl = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  const baseUrl = getPublicAppUrl();
  if (baseUrl) return new URL(raw, baseUrl).toString();
  return raw;
};

// Egypt local number -> international wa.me form. Derived from the number the
// footer already shows, so there is one source of truth for the phone.
const M1_STORE_WHATSAPP_HREF = `https://wa.me/2${M1_STORE_PHONE.replace(/^0+/, "")}`;

const getSocialLinks = (invoice) => [
  { key: "google", label: invoicePrintLabel("rateGoogle", "قيّمنا على Google"), url: normalizePublicUrl(invoice?.google_review_url || DEFAULT_SOCIAL_LINKS.googleReviewUrl), icon: Star },
  { key: "facebook", label: invoicePrintLabel("rateFacebook", "قيّمنا على Facebook"), url: normalizePublicUrl(invoice?.facebook_review_url || DEFAULT_SOCIAL_LINKS.facebookReviewUrl), icon: ExternalLink },
  { key: "instagram", label: invoicePrintLabel("followInstagram", "تابعنا على Instagram"), url: normalizePublicUrl(invoice?.instagram_url || DEFAULT_SOCIAL_LINKS.instagramUrl), icon: ExternalLink },
].filter((link) => link.url);

// Current official brand marks, drawn as full-colour glyphs so each sits in the
// white circle exactly like the platform renders it. Paths follow the vendors
// current logos (Facebook circle-f, Instagram glyph, WhatsApp bubble, Google G).
function BrandedSocialIcon({ type, className = "" }) {
  if (type === "whatsapp") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
        <path
          fill="#25D366"
          d="M20.52 3.45A11.82 11.82 0 0 0 12.05 0C5.5 0 .16 5.34.16 11.89c0 2.1.55 4.14 1.59 5.95L.06 24l6.3-1.65a11.88 11.88 0 0 0 5.69 1.45h.004c6.55 0 11.89-5.34 11.89-11.89a11.82 11.82 0 0 0-3.48-8.41Zm-8.47 18.29h-.004a9.87 9.87 0 0 1-5.03-1.38l-.36-.21-3.74.98 1-3.65-.24-.37a9.86 9.86 0 0 1-1.51-5.26c0-5.45 4.44-9.88 9.89-9.88 2.64 0 5.12 1.03 6.99 2.9a9.83 9.83 0 0 1 2.89 6.99c0 5.45-4.43 9.88-9.89 9.88Zm5.42-7.4c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.16-.17.2-.35.22-.64.08-.3-.15-1.26-.47-2.39-1.48-.89-.79-1.48-1.76-1.66-2.06-.17-.3-.02-.46.13-.6.13-.14.3-.35.45-.52.15-.18.2-.3.3-.5.1-.2.05-.37-.03-.52-.07-.15-.67-1.61-.92-2.21-.24-.58-.48-.5-.67-.51h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.48s1.07 2.88 1.21 3.07c.15.2 2.1 3.2 5.08 4.49.71.3 1.26.49 1.69.62.71.23 1.36.2 1.87.12.57-.09 1.76-.72 2-1.42.25-.69.25-1.29.18-1.41-.08-.13-.27-.2-.57-.35Z"
        />
      </svg>
    );
  }
  if (type === "facebook") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
        <path
          fill="#1877F2"
          d="M24 12.07C24 5.44 18.63.07 12 .07S0 5.44 0 12.07c0 5.99 4.39 10.95 10.13 11.85v-8.38H7.08v-3.47h3.05V9.42c0-3.01 1.79-4.67 4.53-4.67 1.31 0 2.69.24 2.69.24v2.95h-1.51c-1.49 0-1.96.93-1.96 1.87v2.25h3.33l-.53 3.47h-2.8v8.38C19.61 23.02 24 18.06 24 12.07Z"
        />
      </svg>
    );
  }
  if (type === "instagram") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
        <defs>
          <linearGradient id="public-invoice-ig" x1="2" y1="22" x2="22" y2="2">
            <stop stopColor="#FFDC80" />
            <stop offset="0.25" stopColor="#F77737" />
            <stop offset="0.5" stopColor="#F56040" />
            <stop offset="0.75" stopColor="#C13584" />
            <stop offset="1" stopColor="#833AB4" />
          </linearGradient>
        </defs>
        <path
          fill="url(#public-invoice-ig)"
          d="M12 0C8.74 0 8.33.02 7.05.07 5.78.13 4.9.33 4.14.63c-.79.31-1.46.72-2.13 1.38C1.35 2.68.94 3.35.63 4.14.33 4.9.13 5.78.07 7.05.02 8.33 0 8.74 0 12s.02 3.67.07 4.95c.06 1.28.26 2.15.56 2.91.31.79.72 1.46 1.38 2.13.67.67 1.34 1.08 2.13 1.38.76.3 1.64.5 2.91.56C8.33 23.98 8.74 24 12 24s3.67-.02 4.95-.07c1.28-.06 2.15-.26 2.91-.56.79-.31 1.46-.72 2.13-1.38.67-.67 1.08-1.34 1.38-2.13.3-.76.5-1.64.56-2.91.05-1.28.07-1.69.07-4.95s-.02-3.67-.07-4.95c-.06-1.28-.26-2.15-.56-2.91-.31-.79-.72-1.46-1.38-2.13C21.32 1.35 20.65.94 19.86.63c-.76-.3-1.64-.5-2.91-.56C15.67.02 15.26 0 12 0Zm0 2.16c3.2 0 3.58.02 4.85.07 1.17.06 1.8.25 2.23.42.56.22.96.48 1.38.9.42.42.68.82.9 1.38.17.42.36 1.06.41 2.23.06 1.27.07 1.65.07 4.85s-.01 3.58-.07 4.85c-.06 1.17-.25 1.8-.42 2.23-.22.56-.48.96-.9 1.38-.42.42-.82.68-1.38.9-.42.16-1.07.36-2.24.41-1.27.06-1.65.07-4.86.07s-3.59-.02-4.86-.07c-1.17-.06-1.82-.26-2.24-.42-.57-.22-.96-.48-1.38-.9-.42-.42-.69-.82-.9-1.38-.17-.42-.36-1.07-.42-2.24-.05-1.26-.06-1.65-.06-4.84 0-3.2.01-3.59.06-4.86.06-1.17.25-1.81.42-2.23.21-.57.48-.96.9-1.38.42-.42.81-.69 1.38-.9.42-.17 1.05-.36 2.22-.42 1.27-.05 1.65-.06 4.86-.06Zm0 3.68a6.16 6.16 0 1 0 0 12.32 6.16 6.16 0 0 0 0-12.32ZM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8Zm7.85-10.41a1.44 1.44 0 1 1-2.88 0 1.44 1.44 0 0 1 2.88 0Z"
        />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.3-.2-1.9H12v3.6h5.4c-.2 1.2-.9 2.2-2 2.9v2.4h3.1c1.8-1.7 3.1-4.1 3.1-7Z" />
      <path fill="#34A853" d="M12 22c2.7 0 5-.9 6.6-2.5l-3.1-2.4c-.9.6-2 .9-3.5.9-2.6 0-4.8-1.8-5.6-4.1H3.2v2.5C4.8 19.7 8.1 22 12 22Z" />
      <path fill="#FBBC05" d="M6.4 13.9a6 6 0 0 1 0-3.8V7.6H3.2a10 10 0 0 0 0 8.8l3.2-2.5Z" />
      <path fill="#EA4335" d="M12 6c1.5 0 2.8.5 3.8 1.5l2.8-2.8A9.8 9.8 0 0 0 12 2C8.1 2 4.8 4.3 3.2 7.6l3.2 2.5C7.2 7.8 9.4 6 12 6Z" />
    </svg>
  );
}

// Each card carries its own platform colours, using the vendors official brand
// values: Google blue, Facebook #1877F2, WhatsApp teal-to-green, and the
// Instagram gradient in its published stop order.
const SOCIAL_TONE = {
  google: "bg-[linear-gradient(135deg,#1a73e8,#4285f4)]",
  facebook: "bg-[linear-gradient(135deg,#0b5fce,#1877f2)]",
  facebookPage: "bg-[linear-gradient(135deg,#0b5fce,#1877f2)]",
  whatsapp: "bg-[linear-gradient(135deg,#075e54,#128c7e,#25d366)]",
  instagram: "bg-[linear-gradient(135deg,#feda75,#fa7e1e,#d62976,#962fbf,#4f5bd5)]",
};

// One renderer for every social/contact button so the mobile and desktop rows
// cannot drift apart in styling.
function SocialButton({ link, className = "" }) {
  const iconType = link.key === "facebookPage" ? "facebook" : link.key;
  return (
    <a
      href={link.url}
      target="_blank"
      rel="noopener noreferrer"
      className={`h-[52px] w-full items-center justify-center gap-2 rounded-2xl border border-white/10 px-4 text-xs font-black text-white shadow-lg shadow-black/20 transition hover:-translate-y-0.5 hover:shadow-xl active:translate-y-0 ${SOCIAL_TONE[link.key] || SOCIAL_TONE.google} ${className || "inline-flex"}`}
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white shadow-sm">
        <BrandedSocialIcon type={iconType} className="h-4 w-4" />
      </span>
      <span className="truncate">{link.label}</span>
    </a>
  );
}

export default function PublicInvoice() {
  const { token } = useParams();
  const { i18n } = useTranslation();
  const printLanguage = normalizePrintLanguage(i18n.language);
  const printDir = getPrintDirection(printLanguage);
  const [invoice, setInvoice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [publicSettings, setPublicSettings] = useState({});

  const resolvedToken = useMemo(() => {
    const raw = String(token || "").trim();
    if (!raw) return "";
    try {
      return decodeURIComponent(raw).trim();
    } catch {
      return raw;
    }
  }, [token]);

  useEffect(() => {
    let cancelled = false;

    const loadInvoice = async () => {
      if (!resolvedToken) {
        if (!cancelled) {
          setError(invoicePrintLabel("missingToken", "رابط الفاتورة غير صالح"));
          setLoading(false);
        }
        return;
      }

      try {
        if (!cancelled) {
          setLoading(true);
          setError("");
        }
        const response = await api.get(`/public/invoices/${encodeURIComponent(resolvedToken)}`);
        const payload = response?.invoice || response?.data?.invoice || response?.data || response;
        if (cancelled) return;
        setInvoice({
          ...payload,
          public_invoice_url: normalizePublicUrl(payload?.public_invoice_url || `/invoice/${encodeURIComponent(resolvedToken)}`),
          google_review_url: normalizePublicUrl(payload?.google_review_url || DEFAULT_SOCIAL_LINKS.googleReviewUrl),
          facebook_review_url: normalizePublicUrl(payload?.facebook_review_url || DEFAULT_SOCIAL_LINKS.facebookReviewUrl),
          instagram_url: normalizePublicUrl(payload?.instagram_url || DEFAULT_SOCIAL_LINKS.instagramUrl),
        });
      } catch (err) {
        if (cancelled) return;
        console.error("[public-invoice] failed to load invoice:", err);
        setError(err?.responseBody?.message || err?.message || invoicePrintLabel("notFound", "الفاتورة غير موجودة"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadInvoice();
    return () => {
      cancelled = true;
    };
  }, [resolvedToken]);

  useEffect(() => {
    let cancelled = false;

    // Shared with the App-level fetch. This page used to re-request the same
    // ~334 KB with cache: "no-store", costing a measured 456ms for data that was
    // already in flight.
    getPublicSettings()
      .then((settings) => {
        if (cancelled) return;
        setPublicSettings(settings || {});
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, []);

  const publicUrl = useMemo(
    () => normalizePublicUrl(invoice?.public_invoice_url || `/invoice/${encodeURIComponent(resolvedToken || "")}`),
    [invoice, resolvedToken]
  );
  const tenantBranding = useMemo(() => {
    return {
      storeName: String(publicSettings?.["general.company_name"] || publicSettings?.["storefront.store_name"] || "M1 Store").trim(),
      logoUrl: String(publicSettings?.["general.company_logo_url"] || publicSettings?.["storefront.store_logo_url"] || "").trim(),
    };
  }, [publicSettings]);
  const normalizedInvoice = useMemo(
    () => normalizeOrderInvoiceData({ ...(invoice || {}), public_invoice_url: publicUrl }, null, tenantBranding),
    [invoice, publicUrl, tenantBranding]
  );
  const socialLinks = useMemo(() => getSocialLinks(invoice), [invoice]);

  // "Rate us on Google / Facebook" — shown at the top on mobile, at the bottom
  // on desktop.
  const reviewLinks = useMemo(
    () => socialLinks.filter((link) => link.key === "google" || link.key === "facebook"),
    [socialLinks]
  );
  const instagramLink = useMemo(
    () => socialLinks.find((link) => link.key === "instagram") || null,
    [socialLinks]
  );
  // Mobile-only bottom row: the store's Facebook page and a direct WhatsApp
  // chat, which are what a customer on a phone actually wants after reading the
  // invoice. The Facebook URL is the store's own page link already used for the
  // review action — there is no separate page URL in the invoice payload.
  const mobileContactLinks = useMemo(() => {
    const facebookUrl = normalizePublicUrl(invoice?.facebook_review_url || DEFAULT_SOCIAL_LINKS.facebookReviewUrl);
    return [
      facebookUrl ? { key: "facebookPage", label: invoicePrintLabel("facebookPage", "صفحتنا على فيسبوك"), url: facebookUrl } : null,
      { key: "whatsapp", label: invoicePrintLabel("whatsapp", "تواصل واتساب"), url: M1_STORE_WHATSAPP_HREF },
    ].filter(Boolean);
  }, [invoice]);

  if (loading) {
    return (
      <div className="public-invoice-shell min-h-screen text-white">
        <div className="mx-auto flex min-h-screen max-w-4xl items-center justify-center px-4">
          <div className="flex items-center gap-3 rounded-[var(--radius-card)] border border-white/10 bg-white/[0.06] px-5 py-4 text-sm text-slate-300 shadow-2xl shadow-black/30 backdrop-blur-xl">
            <Loader2 className="h-4 w-4 animate-spin" />
            {invoicePrintLabel("loading", "جاري تحميل الفاتورة...")}
          </div>
        </div>
      </div>
    );
  }

  if (error || !invoice) {
    return (
      <div className="public-invoice-shell min-h-screen text-white">
        <div className="mx-auto flex min-h-screen max-w-3xl items-center justify-center px-4">
          <div className="w-full rounded-[2rem] border border-white/10 bg-white/[0.06] p-6 shadow-2xl shadow-black/30 backdrop-blur-xl">
            <div className="text-sm tracking-[0.2em] text-amber-300">{invoicePrintLabel("unavailable", "الفاتورة غير متاحة")}</div>
            <h1 className="m1-page-title mt-2">{invoicePrintLabel("publicInvoiceLink", "رابط الفاتورة العامة")}</h1>
            <p className="mt-3 text-sm text-slate-300">{error || invoicePrintLabel("notFound", "الفاتورة غير موجودة")}</p>
            <div className="mt-6">
              <Link to="/" className="inline-flex items-center gap-2 rounded-2xl bg-emerald-500 px-4 py-2.5 text-sm font-black text-slate-950 shadow-lg shadow-emerald-950/30 transition hover:-translate-y-0.5 hover:bg-emerald-400 active:translate-y-0">
                <ArrowLeft className="h-4 w-4" />
                {invoicePrintLabel("back", "عودة")}
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div dir={printDir} lang={printLanguage} className="public-invoice-shell min-h-screen text-white print:bg-white print:text-black">
      <div className="mx-auto max-w-5xl px-3 py-5 sm:px-6 sm:py-8 lg:px-8">
        <div className="mb-5 flex flex-col gap-3 print:hidden sm:flex-row sm:items-center sm:justify-between">
          <Link
            to="/"
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-card)] border border-white/10 bg-white/[0.06] px-4 py-2.5 text-sm font-semibold text-slate-100 shadow-sm shadow-black/20 backdrop-blur-xl transition hover:-translate-y-0.5 hover:border-white/15 hover:bg-white/10 active:translate-y-0 sm:justify-start"
          >
            <ArrowLeft className="h-4 w-4" />
            {invoicePrintLabel("back", "عودة")}
          </Link>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
            {/* Mobile puts the two review buttons here, where download/print used
                to sit: on a phone the customer is far more likely to rate the
                store than to print an invoice. Download and print stay on
                desktop, where printing actually happens. */}
            {reviewLinks.map((link) => (
              <SocialButton key={`top-${link.key}`} link={link} className="inline-flex sm:hidden" />
            ))}
            <a
              href={`${getPublicAppUrl()}/api/public/invoices/${encodeURIComponent(resolvedToken)}/pdf`}
              target="_blank"
              rel="noopener noreferrer"
              className="hidden min-h-11 items-center justify-center gap-2 rounded-2xl border border-amber-300/25 bg-amber-300/10 px-4 py-2.5 text-sm font-black text-amber-100 transition hover:-translate-y-0.5 hover:bg-amber-300/15 sm:inline-flex"
            >
              <Download className="h-4 w-4" />
              {invoicePrintLabel("download", "تحميل PDF")}
            </a>
            <button
              type="button"
              onClick={() => window.print()}
              className="hidden min-h-[var(--control-height-lg)] items-center justify-center gap-2 rounded-[var(--radius-control)] bg-amber-400 px-4 py-2.5 text-sm font-black text-slate-950 shadow-lg shadow-amber-950/20 transition hover:-translate-y-0.5 hover:bg-amber-300 sm:inline-flex"
            >
              <Printer className="h-4 w-4" />
              {invoicePrintLabel("print", "طباعة")}
            </button>
          </div>
        </div>

        <OrderInvoiceCard
          invoice={normalizedInvoice}
          luxury
          publicView
          className="print:rounded-none print:border-0 print:shadow-none"
        />

        <div className="mt-5 rounded-[1.5rem] border border-amber-200/80 bg-[#fffaf0] p-4 text-xs font-bold leading-6 text-slate-600 shadow-[0_18px_50px_rgba(2,6,23,0.22)] print:border-slate-200 print:bg-white print:text-slate-700 print:shadow-none sm:p-5">
          <div className="flex items-start gap-3 text-start">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            <div className="space-y-1">
              {PUBLIC_RETURN_POLICY_LINES.map((line) => (
                <div key={line}>{line}</div>
              ))}
            </div>
          </div>
        </div>
        <div className="mx-auto mt-3 h-px max-w-3xl bg-gradient-to-r from-transparent via-emerald-700/55 to-transparent" />

        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          {/* The two review buttons moved to the top on mobile, so this row now
              carries the follow/contact actions instead. Desktop keeps the
              original three. */}
          {mobileContactLinks.map((link) => (
            <SocialButton key={`bottom-${link.key}`} link={link} className="inline-flex sm:hidden" />
          ))}
          {reviewLinks.map((link) => (
            <SocialButton key={`bottom-desktop-${link.key}`} link={link} className="hidden sm:inline-flex" />
          ))}
          {instagramLink ? <SocialButton link={instagramLink} /> : null}
        </div>

        <footer className="mt-4 rounded-[var(--radius-card)] border border-white/10 bg-white/[0.06] px-4 py-3 text-center text-xs font-bold text-slate-300 shadow-lg shadow-black/20 backdrop-blur-xl print:border-slate-200 print:bg-white print:text-slate-700 print:shadow-none">
          <div className="flex flex-col items-center justify-center gap-3 sm:flex-row sm:flex-wrap sm:gap-4" dir="ltr">
            <a href={M1_STORE_WEBSITE_HREF} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 hover:text-emerald-300">
              <Globe className="h-3.5 w-3.5 text-emerald-400" />
              {M1_STORE_WEBSITE_TEXT}
            </a>
            <span className="hidden text-slate-500 sm:inline">/</span>
            <a href={`tel:${M1_STORE_PHONE}`} className="inline-flex items-center gap-1.5 hover:text-emerald-300" dir={printDir}>
              <Smartphone className="h-3.5 w-3.5 text-emerald-400" />
              {M1_STORE_PHONE} - خدمة العملاء
            </a>
          </div>
        </footer>
      </div>
    </div>
  );
}
