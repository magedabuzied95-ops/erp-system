import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  Download,  Loader2,
  Printer,} from "lucide-react";

import { api } from "../shared/api/api";
import { getPublicSettings } from "../shared/api/publicSettings";
import OrderInvoiceCard from "../shared/components/invoices/OrderInvoiceCard";
import SocialBrandButton from "../shared/components/invoices/SocialBrandButton.jsx";
import { normalizeOrderInvoiceData } from "../shared/utils/orderInvoice";
import { getPrintDirection, normalizePrintLanguage, tPrint } from "../shared/utils/printLocalization";
import { useInvoiceTemplate } from "../shared/hooks/useInvoiceTemplate";

const invoicePrintLabel = (key, fallback, options) => tPrint(`print.invoice.${key}`, fallback, options);
// The store phone, website, return policy and review links used to live here as
// constants. They are now fields on the invoice template (shared/invoiceTemplate.js),
// whose defaults are these exact values — edited in the studio instead of in code.

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

const getSocialLinks = (invoice, tpl) => {
  if (!tpl?.social?.enabled) return [];
  return [
    { key: "google", label: invoicePrintLabel("rateGoogle", "قيّمنا على Google"), url: normalizePublicUrl(invoice?.google_review_url || tpl.social.google_review_url) },
    { key: "facebook", label: invoicePrintLabel("rateFacebook", "قيّمنا على Facebook"), url: normalizePublicUrl(invoice?.facebook_review_url || tpl.social.facebook_review_url) },
    { key: "instagram", label: invoicePrintLabel("followInstagram", "تابعنا على Instagram"), url: normalizePublicUrl(invoice?.instagram_url || tpl.social.instagram_url) },
  ].filter((link) => link.url);
};

export default function PublicInvoice() {
  const { token } = useParams();
  const { i18n } = useTranslation();
  const printLanguage = normalizePrintLanguage(i18n.language);
  const printDir = getPrintDirection(printLanguage);
  // The footer, the return policy and the review links used to be constants in this
  // file. They now come from the invoice template, whose defaults are those same
  // constants — so an unconfigured store still sees exactly this page.
  const tpl = useInvoiceTemplate();
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
          // Only what the payload actually carries. Filling a default in here would
          // make the invoice always win over the template, which is the opposite of
          // what an operator who typed a link into the studio expects.
          google_review_url: normalizePublicUrl(payload?.google_review_url || ""),
          facebook_review_url: normalizePublicUrl(payload?.facebook_review_url || ""),
          instagram_url: normalizePublicUrl(payload?.instagram_url || ""),
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
  // The voucher the till printed at the foot of the paper slip. Shown here so a customer who
  // kept only the link still has the code — a web page beats a barcode on a phone, so this
  // renders the code itself and a tap-through rather than a scannable image.
  const receiptCoupon = invoice?.receipt_coupon || null;
  const couponHeadline = useMemo(() => {
    if (!receiptCoupon) return "";
    if (receiptCoupon.discount_type === "percentage") return `${Number(receiptCoupon.discount_value || 0)}% خصم`;
    if (receiptCoupon.discount_type === "free_shipping") return "شحن مجاني";
    return `${Number(receiptCoupon.discount_value || 0)} ج.م خصم`;
  }, [receiptCoupon]);
  const couponExpiry = useMemo(() => {
    if (!receiptCoupon?.expires_at) return "";
    const date = new Date(receiptCoupon.expires_at);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("ar-EG", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  }, [receiptCoupon]);

  const normalizedInvoice = useMemo(
    () => normalizeOrderInvoiceData({ ...(invoice || {}), public_invoice_url: publicUrl }, null, tenantBranding),
    [invoice, publicUrl, tenantBranding]
  );
  const socialLinks = useMemo(() => getSocialLinks(invoice, tpl), [invoice, tpl]);

  // "Rate us on Google / Facebook" — shown at the top on mobile, at the bottom
  // on desktop.
  const reviewLinks = useMemo(
    () => socialLinks.filter((link) => link.key === "google" || link.key === "facebook"),
    [socialLinks]
  );
  // The Instagram button and the mobile contact row moved into the `social` block, so
  // the page no longer assembles its own copies of them.

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
              <SocialBrandButton key={`top-${link.key}`} link={link} className="inline-flex sm:hidden" />
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

        {/* The policy, the review buttons and the store footer used to be page-level
            JSX here. They are blocks now, so the card draws them in whatever order the
            studio put them in — which is the whole point of being able to move them. */}
        <OrderInvoiceCard
          invoice={normalizedInvoice}
          template={tpl}
          output="public"
          luxury
          publicView
          className="print:rounded-none print:border-0 print:shadow-none"
        />

        {receiptCoupon?.code ? (
          {/*
            Every colour here is written out, not inherited.

            The block first used theme utilities and translucent fills, and it rendered
            differently in the customer's in-app browser than on a desktop: the code came out pale
            green on a near-white plate and could not be read at all. A voucher is worth nothing if
            the code cannot be copied, so the panel now carries its own dark ground and the code
            sits on solid white in near-black — the same contrast the paper receipt has, and no
            page theme, colour scheme or opacity blending can weaken it.
          */}
          <div
            className="mt-4 rounded-[var(--radius-card)] border-2 border-dashed p-5 text-center"
            style={{ backgroundColor: "#0b2b21", borderColor: "#34d399" }}
          >
            <div className="text-[11px] font-black uppercase tracking-[0.28em]" style={{ color: "#6ee7b7" }}>
              {invoicePrintLabel("couponTitle", "كوبون خصم لزيارتك الجاية")}
            </div>
            <div className="mt-1.5 text-2xl font-black" style={{ color: "#ffffff" }}>{couponHeadline}</div>
            {Number(receiptCoupon.minimum_order_amount || 0) > 0 ? (
              <div className="mt-0.5 text-xs font-bold" style={{ color: "#d1fae5" }}>
                {invoicePrintLabel("couponMinimum", "على فاتورة {{amount}} أو أكثر", {
                  amount: `${Number(receiptCoupon.minimum_order_amount).toLocaleString()} ج.م`,
                })}
              </div>
            ) : null}
            <div
              className="mx-auto mt-3 inline-block rounded-[var(--radius-control)] px-6 py-3 font-mono text-2xl font-black tracking-[0.22em]"
              style={{ backgroundColor: "#ffffff", color: "#0b2b21", border: "2px solid #0b2b21" }}
              dir="ltr"
            >
              {receiptCoupon.code}
            </div>
            {couponExpiry ? (
              <div className="mt-2 text-xs font-bold" style={{ color: "#d1fae5" }}>
                {invoicePrintLabel("couponExpiry", "صالح حتى {{date}}", { date: couponExpiry })}
              </div>
            ) : null}
            {Array.isArray(receiptCoupon.terms) && receiptCoupon.terms.length ? (
              <ul className="mx-auto mt-3 max-w-sm list-none space-y-1 text-start text-xs font-semibold" style={{ color: "#d1fae5" }}>
                {receiptCoupon.terms.map((line, index) => (
                  <li key={index} className="flex gap-2"><span style={{ color: "#34d399" }}>•</span><span>{line}</span></li>
                ))}
              </ul>
            ) : null}
            {receiptCoupon.url ? (
              <a
                href={receiptCoupon.url}
                className="mt-3 inline-flex min-h-11 items-center justify-center rounded-full px-6 text-sm font-black"
                style={{ backgroundColor: "#34d399", color: "#052e1c" }}
              >
                {invoicePrintLabel("couponUse", "استخدمه دلوقتي")}
              </a>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
