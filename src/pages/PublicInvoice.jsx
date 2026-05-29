import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";

import {
  ArrowLeft,
  Copy,
  Download,
  ExternalLink,
  Globe,
  Loader2,
  MessageCircle,
  Printer,
  ShieldCheck,
  Star,
  Smartphone,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import toast from "react-hot-toast";

import { api } from "../shared/api/api";
import { formatCurrency } from "../shared/lib/currency";
import { resolveInvoiceItemImageUrl } from "../shared/lib/invoiceItemImages";
import { buildWhatsappDeepLink } from "../shared/utils/whatsapp.js";
import OrderInvoiceCard from "../shared/components/invoices/OrderInvoiceCard";
import { buildOrderInvoiceWhatsappText, normalizeOrderInvoiceData } from "../shared/utils/orderInvoice";
import { getPrintDirection, normalizePrintLanguage, tPrint } from "../shared/utils/printLocalization";

const invoicePrintLabel = (key, fallback, options) => tPrint(`print.invoice.${key}`, fallback, options);
const DEFAULT_SOCIAL_LINKS = {
  googleReviewUrl: "https://www.google.com/maps/place//data=!4m3!3m2!1s0x14f9e3498b6a02f9:0xd576a0402361f8c8!12e1?source=g.page.m._&laa=merchant-review-solicitation",
  facebookReviewUrl: "https://www.facebook.com/MONESHOESSTORE/reviews",
  instagramUrl: "https://www.instagram.com/m1store_eg/",
};

const getPublicAppUrl = () => {
  const env = import.meta.env || {};
  const selected = [env.VITE_PUBLIC_APP_URL, env.PUBLIC_APP_URL, env.FRONTEND_URL]
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

const formatItemPrice = (value) => (Number(value || 0) > 0 ? formatCurrency(value) : invoicePrintLabel("notSpecified", "Not specified"));

const getPaymentLabel = (value) => {
  const raw = String(value || "").toLowerCase();
  const labels = {
    cash: invoicePrintLabel("cash", "Cash"),
    card: invoicePrintLabel("card", "Card"),
    visa: invoicePrintLabel("card", "Card"),
    wallet: invoicePrintLabel("wallet", "Wallet"),
    split: invoicePrintLabel("split", "Split"),
    transfer: invoicePrintLabel("transfer", "Transfer"),
    bank_transfer: invoicePrintLabel("transfer", "Transfer"),
  };
  return labels[raw] || (raw ? raw : invoicePrintLabel("cash", "Cash"));
};

const getSocialLinks = (invoice) => [
  { key: "google", label: invoicePrintLabel("rateGoogle", "Rate us on Google"), url: normalizePublicUrl(invoice?.google_review_url || DEFAULT_SOCIAL_LINKS.googleReviewUrl), icon: Star },
  { key: "facebook", label: invoicePrintLabel("rateFacebook", "Rate us on Facebook"), url: normalizePublicUrl(invoice?.facebook_review_url || DEFAULT_SOCIAL_LINKS.facebookReviewUrl), icon: MessageCircle },
  { key: "instagram", label: invoicePrintLabel("followInstagram", "Follow us on Instagram"), url: normalizePublicUrl(invoice?.instagram_url || DEFAULT_SOCIAL_LINKS.instagramUrl), icon: ExternalLink },
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

function PublicInvoice() {
  const { token } = useParams();
  const { i18n } = useTranslation();
  const printLanguage = normalizePrintLanguage(i18n.language);
  const printDir = getPrintDirection(printLanguage);
  const [invoice, setInvoice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const resolvedToken = useMemo(() => {
    const raw = String(token || "").trim();
    if (!raw) return "";
    try {
      return decodeURIComponent(raw).trim();
    } catch {
      return raw;
    }
  }, [token]);

  const loadInvoice = async () => {
    if (!resolvedToken) {
      setError(invoicePrintLabel("missingToken", "Missing invoice token"));
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError("");
      const response = await api.get(`/public/invoices/${encodeURIComponent(resolvedToken)}`);
      const payload = response?.invoice || response?.data?.invoice || response?.data || response;
      if (import.meta.env.DEV && Array.isArray(payload?.items)) {
        console.table(payload.items.map((item, index) => ({
          index,
          product_image: item.product_image || null,
          variant_image: item.variant_image || null,
          image: item.image || item.image_url || null,
          product_image_nested: item.product?.image || null,
          variant_image_nested: item.variant?.image || null,
          final_resolved_image_url: resolveInvoiceItemImageUrl(item, ""),
        })));
      }
      setInvoice({
        ...payload,
        public_invoice_url: normalizePublicUrl(payload?.public_invoice_url || `/invoice/${encodeURIComponent(resolvedToken)}`),
        google_review_url: normalizePublicUrl(payload?.google_review_url || DEFAULT_SOCIAL_LINKS.googleReviewUrl),
        facebook_review_url: normalizePublicUrl(payload?.facebook_review_url || DEFAULT_SOCIAL_LINKS.facebookReviewUrl),
        instagram_url: normalizePublicUrl(payload?.instagram_url || DEFAULT_SOCIAL_LINKS.instagramUrl),
      });
    } catch (err) {
      console.error("[public-invoice] failed to load invoice:", err);
      setError(err?.responseBody?.message || err?.message || invoicePrintLabel("notFound", "Invoice not found"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadInvoice();
  }, [resolvedToken]);

  const publicUrl = useMemo(
    () => normalizePublicUrl(invoice?.public_invoice_url || `/invoice/${encodeURIComponent(resolvedToken || "")}`),
    [invoice, resolvedToken]
  );
  const handlePrint = () => window.print();

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(publicUrl);
      toast.success(invoicePrintLabel("linkCopied", "Invoice link copied"));
    } catch {
      toast.error(invoicePrintLabel("copyFailed", "Unable to copy invoice link"));
    }
  };

  const handleDownloadPdf = async () => {
    const pdfIdentifier = invoice?.invoice_number || invoice?.order_number || invoice?.invoice_code || invoice?.public_code || invoice?.code || invoice?.public_token || resolvedToken;
    if (!pdfIdentifier) return;
    try {
      const response = await fetch(`/api/public/invoices/${encodeURIComponent(pdfIdentifier)}/pdf`);
      if (!response.ok) throw new Error(invoicePrintLabel("pdfDownloadError", "PDF download failed"));
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${String(invoice.invoice_number || "invoice").replace(/[^\w.-]+/g, "_")}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      toast.success(invoicePrintLabel("pdfDownloaded", "PDF downloaded"));
    } catch (err) {
      console.error("[public-invoice] pdf download failed:", err);
      toast.error(invoicePrintLabel("pdfDownloadFailed", "Unable to download invoice PDF"));
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
      <div className="public-invoice-shell min-h-screen text-white">
        <div className="mx-auto flex min-h-screen max-w-4xl items-center justify-center px-4">
          <div className="flex items-center gap-3 rounded-3xl border border-white/10 bg-white/[0.06] px-5 py-4 text-sm text-slate-300 shadow-2xl shadow-black/30 backdrop-blur-xl">
            <Loader2 className="h-4 w-4 animate-spin" />
            {invoicePrintLabel("loading", "Loading invoice...")}
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
            <div className="text-sm uppercase tracking-[0.2em] text-amber-300">{invoicePrintLabel("unavailable", "Invoice unavailable")}</div>
            <h1 className="mt-2 text-2xl font-black">{invoicePrintLabel("publicInvoiceLink", "Public invoice link")}</h1>
            <p className="mt-3 text-sm text-slate-300">{error || invoicePrintLabel("notFound", "Invoice not found")}</p>
            <div className="mt-6">
              <Link to="/" className="inline-flex items-center gap-2 rounded-2xl bg-emerald-500 px-4 py-2.5 text-sm font-black text-slate-950 shadow-lg shadow-emerald-950/30 transition hover:-translate-y-0.5 hover:bg-emerald-400 active:translate-y-0">
                <ArrowLeft className="h-4 w-4" />
                {invoicePrintLabel("back", "Back")}
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
    <div dir={printDir} lang={printLanguage} className="public-invoice-shell min-h-screen text-white print:bg-white print:text-black">
      <div className="mx-auto max-w-5xl px-3 py-4 sm:px-6 sm:py-6 lg:px-8">
        <div className="mb-5 flex flex-col gap-3 print:hidden sm:flex-row sm:items-center sm:justify-between">
          <Link
            to="/"
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-2.5 text-sm font-semibold text-slate-100 shadow-sm shadow-black/20 backdrop-blur-xl transition hover:-translate-y-0.5 hover:border-white/15 hover:bg-white/10 active:translate-y-0 sm:justify-start"
          >
            <ArrowLeft className="h-4 w-4" />
            {invoicePrintLabel("back", "Back")}
          </Link>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end">
            <button type="button" onClick={handleCopyLink} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-2.5 text-sm font-semibold text-slate-100 shadow-sm shadow-black/20 backdrop-blur-xl transition hover:-translate-y-0.5 hover:border-white/15 hover:bg-white/10 active:translate-y-0">
              <Copy className="h-4 w-4" />
              {invoicePrintLabel("copyLink", "Copy link")}
            </button>
            <button type="button" onClick={handleWhatsapp} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-emerald-300/20 bg-emerald-500 px-4 py-2.5 text-sm font-black text-slate-950 shadow-lg shadow-emerald-950/35 transition hover:-translate-y-0.5 hover:bg-emerald-400 active:translate-y-0">
              <MessageCircle className="h-4 w-4" />
              {invoicePrintLabel("whatsapp", "WhatsApp")}
            </button>
            <button type="button" onClick={handleDownloadPdf} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-violet-300/25 bg-transparent px-4 py-2.5 text-sm font-semibold text-violet-100 shadow-sm shadow-black/20 transition hover:-translate-y-0.5 hover:border-violet-200/45 hover:bg-violet-400/10 active:translate-y-0">
              <Download className="h-4 w-4" />
              {invoicePrintLabel("downloadPdf", "Download PDF")}
            </button>
            <button type="button" onClick={handlePrint} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-slate-200/10 px-4 py-2.5 text-sm font-semibold text-slate-100 shadow-sm shadow-black/20 backdrop-blur-xl transition hover:-translate-y-0.5 hover:border-white/15 hover:bg-slate-200/15 active:translate-y-0">
              <Printer className="h-4 w-4" />
              {invoicePrintLabel("print", "Print")}
            </button>
          </div>
        </div>

        <OrderInvoiceCard
          invoice={normalizeOrderInvoiceData({
            ...invoice,
            source: invoice.source || invoice.channel || "Website",
            public_invoice_url: publicUrl,
          })}
          luxury
          className="print:rounded-none print:border-0 print:shadow-none"
        />

        <div className="mt-4 rounded-2xl border border-slate-200/80 bg-[#FAFAF9] p-3 text-center text-xs font-bold text-slate-600 shadow-[0_18px_50px_rgba(2,6,23,0.22)] print:border-slate-200 print:bg-white print:text-slate-700 print:shadow-none">
            <div className="flex items-center justify-center gap-2"><ShieldCheck className="h-4 w-4 text-emerald-600" />{invoicePrintLabel("returnPolicy", "Exchange and return are allowed within 14 days if the item is unused and the invoice is kept.")}</div>
          </div>
          <div className="mx-auto mt-3 h-px max-w-3xl bg-gradient-to-r from-transparent via-emerald-700/55 to-transparent" />

          {socialLinks.length ? (
            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              {socialLinks.map(({ key, label, url, icon: Icon }) => (
                <a
                  key={label}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`inline-flex min-h-[44px] items-center justify-center gap-2 rounded-2xl border border-white/10 px-4 py-2 text-xs font-black text-white shadow-lg shadow-black/20 transition hover:-translate-y-0.5 hover:shadow-xl active:translate-y-0 ${
                    key === "google"
                      ? "bg-[linear-gradient(135deg,#1e293b,#334155)]"
                      : key === "facebook"
                        ? "bg-[#1452a4]"
                        : "bg-[linear-gradient(135deg,#3b0764,#7e22ce)]"
                  }`}
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/95 shadow-sm">
                    <BrandedSocialIcon type={key} className={`h-4 w-4 ${key === "facebook" ? "text-[#1877f2]" : key === "instagram" ? "text-white" : ""}`} />
                  </span>
                  {label}
                </a>
              ))}
            </div>
          ) : null}

          <footer className="mt-4 rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 text-center text-xs font-bold text-slate-300 shadow-lg shadow-black/20 backdrop-blur-xl print:border-slate-200 print:bg-white print:text-slate-700 print:shadow-none">
            <div className="flex flex-col items-center justify-center gap-3 sm:flex-row sm:flex-wrap sm:gap-4" dir="ltr">
              <span className="inline-flex items-center gap-1.5"><Globe className="h-3.5 w-3.5 text-emerald-400" />{invoice.store?.website || "www.workspace.com"}</span>
              <span className="hidden text-slate-500 sm:inline">/</span>
              <span className="inline-flex items-center gap-1.5" dir={printDir}><Smartphone className="h-3.5 w-3.5 text-emerald-400" />{invoicePrintLabel("customerService", "Customer service")} - {invoice.store?.phone || "01234567890"}</span>
              {publicUrl ? <span className="rounded-xl bg-white p-1.5"><QRCodeSVG value={publicUrl} size={34} level="M" /></span> : null}
            </div>
          </footer>

      </div>
    </div>
  );
}

export default PublicInvoice;


