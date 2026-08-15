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

const getSocialLinks = (invoice) => [
  { key: "google", label: invoicePrintLabel("rateGoogle", "قيّمنا على Google"), url: normalizePublicUrl(invoice?.google_review_url || DEFAULT_SOCIAL_LINKS.googleReviewUrl), icon: Star },
  { key: "facebook", label: invoicePrintLabel("rateFacebook", "قيّمنا على Facebook"), url: normalizePublicUrl(invoice?.facebook_review_url || DEFAULT_SOCIAL_LINKS.facebookReviewUrl), icon: ExternalLink },
  { key: "instagram", label: invoicePrintLabel("followInstagram", "تابعنا على Instagram"), url: normalizePublicUrl(invoice?.instagram_url || DEFAULT_SOCIAL_LINKS.instagramUrl), icon: ExternalLink },
].filter((link) => link.url);

function BrandedSocialIcon({ type, className = "" }) {
  if (type === "facebook") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
        <path fill="currentColor" d="M14 8.3V6.9c0-.7.5-.9.9-.9h2.2V2.2L14 2c-3.5 0-4.3 2.1-4.3 4.2v2.1H7v4h2.7V22H14v-9.7h3.1l.5-4H14Z" />
      </svg>
    );
  }
  if (type === "instagram") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
        <defs>
          <linearGradient id="public-invoice-instagram-gradient" x1="4" x2="20" y1="20" y2="4">
            <stop stopColor="#f58529" />
            <stop offset="0.45" stopColor="#dd2a7b" />
            <stop offset="1" stopColor="#515bd4" />
          </linearGradient>
        </defs>
        <rect width="17" height="17" x="3.5" y="3.5" fill="none" stroke="url(#public-invoice-instagram-gradient)" strokeWidth="2.2" rx="5" />
        <circle cx="12" cy="12" r="3.4" fill="none" stroke="url(#public-invoice-instagram-gradient)" strokeWidth="2" />
        <circle cx="16.8" cy="7.2" r="1.1" fill="#dd2a7b" />
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
            <a
              href={`${getPublicAppUrl()}/api/public/invoices/${encodeURIComponent(resolvedToken)}/pdf`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-amber-300/25 bg-amber-300/10 px-4 py-2.5 text-sm font-black text-amber-100 transition hover:-translate-y-0.5 hover:bg-amber-300/15"
            >
              <Download className="h-4 w-4" />
              {invoicePrintLabel("download", "تحميل PDF")}
            </a>
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex min-h-[var(--control-height-lg)] items-center justify-center gap-2 rounded-[var(--radius-control)] bg-amber-400 px-4 py-2.5 text-sm font-black text-slate-950 shadow-lg shadow-amber-950/20 transition hover:-translate-y-0.5 hover:bg-amber-300"
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

        {socialLinks.length ? (
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            {socialLinks.map(({ key, label, url }) => (
              <a
                key={label}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className={`inline-flex min-h-[44px] items-center justify-center gap-2 rounded-2xl border border-white/10 px-4 py-2 text-xs font-black text-white shadow-lg shadow-black/20 transition hover:-translate-y-0.5 hover:shadow-xl active:translate-y-0 ${ key === "google" ? "bg-[linear-gradient(135deg,#1e293b,#334155)]" : key === "facebook" ? "bg-[#1452a4]" : "bg-[linear-gradient(135deg,#3b0764,#7e22ce)]" }`}
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/95 shadow-sm">
                  <BrandedSocialIcon type={key} className={`h-4 w-4 ${key === "facebook" ? "text-[#1877f2]" : key === "instagram" ? "text-white" : ""}`} />
                </span>
                {label}
              </a>
            ))}
          </div>
        ) : null}

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
