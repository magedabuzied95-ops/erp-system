import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";

import {
  ArrowLeft,
  Copy,
  Download,
  ExternalLink,
  Globe,
  Loader2,
  MessageCircle,
  Package,
  Printer,
  ShieldCheck,
  Star,
  Smartphone,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import toast from "react-hot-toast";

import { api } from "../shared/api/api";
import { formatCurrency } from "../shared/lib/currency";
import { resolveProductImageUrl } from "../shared/lib/imageUrls";
import { buildWhatsappDeepLink } from "../shared/utils/whatsapp.js";
import OrderInvoiceCard from "../shared/components/invoices/OrderInvoiceCard";
import { buildOrderInvoiceWhatsappText, normalizeOrderInvoiceData } from "../shared/utils/orderInvoice";

const RETURN_POLICY_TEXT = "يسمح بالاستبدال والاسترجاع خلال 14 يوم بشرط عدم الاستخدام والحفاظ على الفاتورة";
const loggedInvoiceImageItems = new WeakSet();
const DEFAULT_SOCIAL_LINKS = {
  googleReviewUrl: "https://www.google.com/maps/place//data=!4m3!3m2!1s0x14f9e3498b6a02f9:0xd576a0402361f8c8!12e1?source=g.page.m._&laa=merchant-review-solicitation",
  facebookReviewUrl: "https://www.facebook.com/MONESHOESSTORE/reviews",
  instagramUrl: "https://www.instagram.com/m1store_eg/",
};

const getPublicAppUrl = () => {
  const env = import.meta.env || {};
  const selected = [env.VITE_PUBLIC_APP_URL, env.PUBLIC_APP_URL, env.FRONTEND_URL]
    .map((value) => String(value || "").trim())
    .find((value) => value && !/localhost|127\.0\.0\.1/i.test(value));
  if (selected) return selected.replace(/\/$/, "");
  if (typeof window !== "undefined" && !/localhost|127\.0\.0\.1/i.test(window.location.hostname)) {
    return window.location.origin.replace(/\/$/, "");
  }
  return "";
};

const normalizePublicUrl = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return /localhost|127\.0\.0\.1/i.test(raw) ? "" : raw;
  const baseUrl = getPublicAppUrl();
  if (baseUrl) {
    return new URL(raw, baseUrl).toString();
  }
  return raw;
};

const formatArabicDate = (value) => {
  if (!value) return "n/a";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("ar-EG", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(date);
};

const formatArabicTime = (value) => {
  if (!value) return "n/a";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("ar-EG", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(date);
};

const formatItemPrice = (value) => (Number(value || 0) > 0 ? formatCurrency(value) : "غير محدد");

const getPaymentLabel = (value) => {
  const raw = String(value || "").toLowerCase();
  const labels = {
    cash: "نقدًا",
    card: "فيزا",
    visa: "فيزا",
    wallet: "محفظة",
    split: "متعدد",
    transfer: "تحويل",
    bank_transfer: "تحويل",
  };
  return labels[raw] || (raw ? raw : "نقدًا");
};

const getSocialLinks = (invoice) => [
  { key: "google", label: "قيّمنا على جوجل", url: normalizePublicUrl(invoice?.google_review_url || DEFAULT_SOCIAL_LINKS.googleReviewUrl), icon: Star },
  { key: "facebook", label: "قيّمنا على فيسبوك", url: normalizePublicUrl(invoice?.facebook_review_url || DEFAULT_SOCIAL_LINKS.facebookReviewUrl), icon: MessageCircle },
  { key: "instagram", label: "تابعنا على إنستجرام", url: normalizePublicUrl(invoice?.instagram_url || DEFAULT_SOCIAL_LINKS.instagramUrl), icon: ExternalLink },
].filter((link) => link.url);

const unwrapInvoiceImageValue = (value) => {
  if (!value) return "";
  if (typeof value === "object") return value.url || value.path || value.image_url || value.secure_url || "";
  return value;
};

const getInvoiceItemImage = (item = {}) => {
  if (import.meta.env.DEV && item && typeof item === "object" && !loggedInvoiceImageItems.has(item)) {
    loggedInvoiceImageItems.add(item);
    console.log("[invoice item image debug]", item);
  }

  const candidates = [
    item.image_url,
    item.image,
    item.product_image,
    item.cover_image,
    item.thumbnail,
    item.variant_image,
    item.variant_image_url,
    item.product?.image_url,
    item.product?.image,
    item.product?.cover_image,
    item.product?.thumbnail,
    item.variant?.image_url,
    item.variant?.image,
    item.variant?.image_path,
    item.product_variant?.image_url,
    item.product_variant?.image,
    item.color?.image_url,
    item.color_image_url,
    item.images?.[0],
    item.gallery?.[0],
    item.product?.gallery?.[0],
    item.product?.images?.[0],
  ];

  return candidates.map(unwrapInvoiceImageValue).find(Boolean) || "";
};

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

function PublicInvoice() {
  const { token } = useParams();
  const [invoice, setInvoice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadInvoice = async () => {
    if (!token) {
      setError("Missing invoice token");
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError("");
      const response = await api.get(`/public/invoices/${token}`);
      const payload = response?.invoice || response?.data?.invoice || response?.data || response;
      setInvoice({
        ...payload,
        public_invoice_url: normalizePublicUrl(payload?.public_invoice_url || `/invoice/${token}`),
        google_review_url: normalizePublicUrl(payload?.google_review_url || DEFAULT_SOCIAL_LINKS.googleReviewUrl),
        facebook_review_url: normalizePublicUrl(payload?.facebook_review_url || DEFAULT_SOCIAL_LINKS.facebookReviewUrl),
        instagram_url: normalizePublicUrl(payload?.instagram_url || DEFAULT_SOCIAL_LINKS.instagramUrl),
      });
    } catch (err) {
      console.error("[public-invoice] failed to load invoice:", err);
      setError(err?.responseBody?.message || err?.message || "Invoice not found");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadInvoice();
  }, [token]);

  const publicUrl = useMemo(
    () => normalizePublicUrl(invoice?.public_invoice_url || `/invoice/${token || ""}`),
    [invoice, token]
  );
  const handlePrint = () => window.print();

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(publicUrl);
      toast.success("Invoice link copied");
    } catch {
      toast.error("Unable to copy invoice link");
    }
  };

  const handleDownloadPdf = async () => {
    if (!invoice?.public_token) return;
    try {
      const response = await fetch(`/api/public/invoices/${encodeURIComponent(invoice.public_token)}/pdf`);
      if (!response.ok) throw new Error("PDF download failed");
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${String(invoice.invoice_number || "invoice").replace(/[^\w.-]+/g, "_")}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      toast.success("PDF downloaded");
    } catch (err) {
      console.error("[public-invoice] pdf download failed:", err);
      toast.error("Unable to download invoice PDF");
    }
  };

  const handleWhatsapp = () => {
    const message = buildOrderInvoiceWhatsappText(normalizeOrderInvoiceData({
      ...invoice,
      source: invoice?.source || invoice?.channel || "Website",
      public_invoice_url: publicUrl,
    }));

    window.open(
      buildWhatsappDeepLink({ phone: invoice?.customer?.phone || "", message }),
      "_blank",
      "noopener,noreferrer"
    );
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 text-white">
        <div className="mx-auto flex min-h-screen max-w-4xl items-center justify-center px-4">
          <div className="flex items-center gap-3 rounded-3xl border border-white/10 bg-white/5 px-5 py-4 text-sm text-zinc-300">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading invoice...
          </div>
        </div>
      </div>
    );
  }

  if (error || !invoice) {
    return (
      <div className="min-h-screen bg-zinc-950 text-white">
        <div className="mx-auto flex min-h-screen max-w-3xl items-center justify-center px-4">
          <div className="w-full rounded-[2rem] border border-white/10 bg-white/5 p-6">
            <div className="text-sm uppercase tracking-[0.2em] text-amber-300">Invoice unavailable</div>
            <h1 className="mt-2 text-2xl font-black">Public invoice link</h1>
            <p className="mt-3 text-sm text-zinc-300">{error || "Invoice not found"}</p>
            <div className="mt-6">
              <Link to="/" className="inline-flex items-center gap-2 rounded-2xl bg-emerald-500 px-4 py-2.5 text-sm font-black text-black">
                <ArrowLeft className="h-4 w-4" />
                Back
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const items = Array.isArray(invoice.items) ? invoice.items : [];
  const socialLinks = getSocialLinks(invoice);
  const totalQuantity = items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const discount = Number(invoice.totals?.discount || 0);
  const service = Number(invoice.totals?.service || 0);
  const sellerName = invoice.salesman_name || invoice.sales_name || invoice.seller_name || "";
  const paymentLabel = getPaymentLabel(invoice.totals?.payment_method || invoice.payment_method);

  return (
    <div dir="rtl" className="min-h-screen bg-zinc-950 text-white print:bg-white print:text-black">
      <div className="mx-auto max-w-5xl px-4 py-4 sm:px-6 lg:px-8">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
          <Link
            to="/"
            className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white hover:bg-white/10"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Link>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={handleCopyLink} className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white hover:bg-white/10">
              <Copy className="h-4 w-4" />
              Copy link
            </button>
            <button type="button" onClick={handleWhatsapp} className="inline-flex items-center gap-2 rounded-2xl border border-emerald-500/20 bg-emerald-500/15 px-4 py-2.5 text-sm font-semibold text-emerald-100 hover:bg-emerald-500/20">
              <MessageCircle className="h-4 w-4" />
              WhatsApp
            </button>
            <button type="button" onClick={handleDownloadPdf} className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white hover:bg-white/10">
              <Download className="h-4 w-4" />
              Download PDF
            </button>
            <button type="button" onClick={handlePrint} className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white hover:bg-white/10">
              <Printer className="h-4 w-4" />
              Print
            </button>
          </div>
        </div>

        <OrderInvoiceCard
          invoice={normalizeOrderInvoiceData({
            ...invoice,
            source: invoice.source || invoice.channel || "Website",
            public_invoice_url: publicUrl,
          })}
          className="print:rounded-none print:border-0 print:shadow-none"
        />

        <div className="mt-3 rounded-xl border border-zinc-200 bg-white p-2 text-center text-xs font-bold text-zinc-700">
            <div className="flex items-center justify-center gap-2"><ShieldCheck className="h-4 w-4 text-emerald-600" />{RETURN_POLICY_TEXT}</div>
          </div>
          <div className="mt-2 h-px bg-emerald-600" />

          {socialLinks.length ? (
            <div className="mt-3 grid grid-cols-3 gap-2">
              {socialLinks.map(({ key, label, url, icon: Icon }) => (
                <a
                  key={label}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`inline-flex min-h-[40px] items-center justify-center gap-2 rounded-full px-4 py-2 text-xs font-black text-white shadow-md transition hover:-translate-y-0.5 hover:shadow-lg ${
                    key === "google"
                      ? "bg-[linear-gradient(90deg,#4285F4,#34A853,#FBBC05,#EA4335)]"
                      : key === "facebook"
                        ? "bg-[#1877F2]"
                        : "bg-[linear-gradient(90deg,#833AB4,#E1306C,#FD1D1D,#FCAF45)]"
                  }`}
                >
                  <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${key === "instagram" ? "bg-white/15" : "bg-white"}`}>
                    <BrandedSocialIcon type={key} className={`h-4 w-4 ${key === "facebook" ? "text-[#1877f2]" : key === "instagram" ? "text-white" : ""}`} />
                  </span>
                  {label}
                </a>
              ))}
            </div>
          ) : null}

          <footer className="mt-3 border-t border-emerald-600 bg-white pt-2 text-center text-xs font-bold text-zinc-600">
            <div className="flex flex-wrap items-center justify-center gap-2.5" dir="ltr">
              <span className="inline-flex items-center gap-1"><Globe className="h-3.5 w-3.5 text-emerald-600" />{invoice.store?.website || "www.workspace.com"}</span>
              <span>|</span>
              <span className="inline-flex items-center gap-1" dir="rtl"><Smartphone className="h-3.5 w-3.5 text-emerald-600" />خدمة العملاء - {invoice.store?.phone || "01234567890"}</span>
              {publicUrl ? <QRCodeSVG value={publicUrl} size={32} level="M" /> : null}
            </div>
          </footer>

      </div>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-zinc-500">{label}</span>
      <span className="font-semibold text-zinc-900">{value}</span>
    </div>
  );
}

function InvoiceItemImage({ item, alt }) {
  const [failed, setFailed] = useState(false);
  const rawImage = getInvoiceItemImage(item);
  const imageUrl = resolveProductImageUrl(rawImage);

  if (!imageUrl || failed) return <Package className="h-5 w-5 text-zinc-400" />;

  return (
    <img
      src={imageUrl}
      alt={alt}
      loading="lazy"
      className="h-full w-full object-cover"
      onError={() => setFailed(true)}
    />
  );
}

export default PublicInvoice;
