import { useEffect, useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  Banknote,
  CalendarDays,
  CheckCircle2,
  Copy,
  Clock3,
  ExternalLink,
  CreditCard,
  FileText,
  Globe,
  ImageIcon,
  MessageCircle,
  Minus,
  Package,
  Plus,
  Printer,
  ReceiptText,
  ShieldCheck,
  ShoppingBag,
  Smartphone,
  Star,
  Trash2,
  User,
  Wallet,
} from "lucide-react";

import { formatCurrency } from "../lib/posUtils";
import { resolveProductImageUrl } from "../../../shared/lib/imageUrls";
import { getCurrentTenant } from "../../../shared/auth/authStorage";
import { getBarcodeSvg } from "../../products/lib/barcodeLabels";

const failedCartImageUrls = new Set();
const loggedInvoiceImageItems = new WeakSet();

const getStoreProfile = () => {
  const tenant = getCurrentTenant() || {};
  const settings = tenant.settings || {};
  return {
    name: tenant.companyName || tenant.company_name || tenant.name || settings.companyName || "YOUR STORE",
    website: settings.website || tenant.website || "www.workspace.com",
    phone: settings.phone || tenant.phone || "01234567890",
    address: settings.companyAddress || settings.address || tenant.address || "",
    logoUrl: settings.logoUrl || settings.logo_url || tenant.logoUrl || tenant.logo_url || "",
    tagline: settings.tagline || settings.companyTagline || tenant.tagline || "Premium Shoes",
    googleReviewUrl: settings.google_review_url || settings.googleReviewUrl || tenant.google_review_url || tenant.googleReviewUrl || "",
    facebookReviewUrl: settings.facebook_review_url || settings.facebookReviewUrl || tenant.facebook_review_url || tenant.facebookReviewUrl || "",
    instagramUrl: settings.instagram_url || settings.instagramUrl || tenant.instagram_url || tenant.instagramUrl || "",
  };
};

const getReceiptDate = () =>
  new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date());

const getReceiptItemUnitPrice = (item = {}) => {
  const quantity = Math.max(1, Number(item.quantity || 0));
  const candidates = [
    item.price,
    item.unit_price,
    item.sale_price,
    item.product_price,
    item.variant_price,
    item.total && Number(item.total) > 0 ? Number(item.total) / quantity : null,
    item.total_amount && Number(item.total_amount) > 0 ? Number(item.total_amount) / quantity : null,
  ];

  const price = candidates.map(Number).find((value) => Number.isFinite(value) && value > 0);
  return price || 0;
};

const getReceiptItemTotal = (item = {}) => {
  const explicitTotal = Number(item.total_amount || item.total || 0);
  if (Number.isFinite(explicitTotal) && explicitTotal > 0) return explicitTotal;

  const unitPrice = getReceiptItemUnitPrice(item);
  const quantity = Number(item.quantity || 0);
  const discount = Number(item.discount_amount ?? Number(item.lineDiscount || 0) * quantity);
  return Math.max(0, unitPrice * quantity - discount);
};

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

const formatReceiptPrice = (value) => {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) && numeric > 0 ? formatCurrency(numeric) : "غير محدد";
};

const RETURN_POLICY_TEXT = "يسمح بالاستبدال والاسترجاع خلال 14 يوم بشرط عدم الاستخدام والحفاظ على الفاتورة";

const DEFAULT_SOCIAL_LINKS = {
  googleReviewUrl: "https://www.google.com/maps/place//data=!4m3!3m2!1s0x14f9e3498b6a02f9:0xd576a0402361f8c8!12e1?source=g.page.m._&laa=merchant-review-solicitation",
  facebookReviewUrl: "https://www.facebook.com/MONESHOESSTORE/reviews",
  instagramUrl: "https://www.instagram.com/m1store_eg/",
};

const formatArabicDate = (value = new Date()) =>
  new Intl.DateTimeFormat("ar-EG", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(new Date(value));

const formatArabicTime = (value = new Date()) =>
  new Intl.DateTimeFormat("ar-EG", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(value));

const getPublicAppUrl = () => {
  const env = import.meta.env || {};
  const candidates = [env.VITE_PUBLIC_APP_URL, env.PUBLIC_APP_URL, env.FRONTEND_URL]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  const selected = candidates.find((value) => !/localhost|127\.0\.0\.1/i.test(value));
  if (selected) return selected.replace(/\/$/, "");
  if (typeof window !== "undefined" && !/localhost|127\.0\.0\.1/i.test(window.location.hostname)) {
    return window.location.origin.replace(/\/$/, "");
  }
  return "";
};

const getReceiptPublicUrl = (invoiceNumber) => {
  const baseUrl = getPublicAppUrl();
  return baseUrl ? `${baseUrl}/invoice/${encodeURIComponent(invoiceNumber || "")}` : "";
};

const getSocialLinks = (store = {}) => [
  { key: "google", label: "قيّمنا على جوجل", url: store.googleReviewUrl, icon: Star },
  { key: "facebook", label: "قيّمنا على فيسبوك", url: store.facebookReviewUrl, icon: MessageCircle },
  { key: "instagram", label: "تابعنا على إنستجرام", url: store.instagramUrl, icon: ExternalLink },
].filter((link) => link.url && !/localhost|127\.0\.0\.1/i.test(link.url));

const getInvoiceSocialLinks = (store = {}) => [
  { key: "google", label: "قيّمنا على جوجل", url: store.googleReviewUrl || DEFAULT_SOCIAL_LINKS.googleReviewUrl, icon: Star },
  { key: "facebook", label: "قيّمنا على فيسبوك", url: store.facebookReviewUrl || DEFAULT_SOCIAL_LINKS.facebookReviewUrl, icon: MessageCircle },
  { key: "instagram", label: "تابعنا على إنستجرام", url: store.instagramUrl || DEFAULT_SOCIAL_LINKS.instagramUrl, icon: ExternalLink },
].filter((link) => link.url && !/localhost|127\.0\.0\.1/i.test(link.url));

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
          <linearGradient id="invoice-instagram-gradient" x1="4" x2="20" y1="20" y2="4">
            <stop stopColor="#f58529" />
            <stop offset="0.45" stopColor="#dd2a7b" />
            <stop offset="1" stopColor="#515bd4" />
          </linearGradient>
        </defs>
        <rect width="17" height="17" x="3.5" y="3.5" fill="none" stroke="url(#invoice-instagram-gradient)" strokeWidth="2.2" rx="5" />
        <circle cx="12" cy="12" r="3.4" fill="none" stroke="url(#invoice-instagram-gradient)" strokeWidth="2" />
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

const getPaymentLabel = (mode, paymentSummary = {}) => {
  const raw = String(mode || paymentSummary.method || paymentSummary.payment_method || "").toLowerCase();
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

const getSellerName = (customer = {}) => {
  const seller = customer?.sales_name || customer?.seller_name || customer?.salesman_name || customer?.salesName || customer?.sellerName;
  if (!seller || /cashieradmin/i.test(String(seller))) return "";
  return seller;
};

function CartSidebar({
  cart,
  onIncrease,
  onDecrease,
  onRemove,
  onClear,
  customer,
  paymentMode,
  setPaymentMode,
  cashAmount,
  setCashAmount,
  cardAmount,
  setCardAmount,
  walletAmount,
  setWalletAmount,
  loyaltyProfile,
  loyaltyValidation,
  loyaltyUnavailable = false,
  loyaltyRedeemPoints,
  setLoyaltyRedeemPoints,
  loyaltyDiscount,
  loyaltyPointsToEarn,
  walletCashbackToEarn = 0,
  totals,
  paymentSummary,
  invoiceNumber,
  onCheckout,
  onPrint,
  onDownloadPdf,
  onShareWhatsapp,
  onCopyInvoiceLink,
  onOpenInvoice,
  checkoutLoading,
  checkoutLabel = "Create order",
  lastInvoiceUrl,
  lastInvoiceNumber,
  lastPublicToken,
  lastOrderExists,
  canUseOrderActions = false,
  marketingAttribution,
  setMarketingAttribution,
  invoiceRef,
  a4Ref,
  previewMode,
  setPreviewMode,
  onItemDiscountChange,
  invoiceDiscount,
  setInvoiceDiscount,
  serviceFee,
  setServiceFee,
  couponCode = "",
  setCouponCode,
  couponValidation,
  couponLoading = false,
  onApplyCoupon,
  onRemoveCoupon,
  salesEmployees = [],
  selectedSalespersonId = "",
  setSelectedSalespersonId,
  allowSaleWithoutSalesperson = true,
}) {
  const customerWalletBalance = Number(customer?.wallet_balance ?? customer?.balance ?? loyaltyProfile?.wallet_balance ?? 0);
  const walletApplicable = Math.max(0, Math.min(customerWalletBalance, Number(totals?.total || 0)));

  return (
    <aside className="pos-cart-panel flex h-full min-w-0 flex-col gap-4 overflow-x-hidden">
      <div className="theme-card pos-cart-panel p-4 shadow-2xl shadow-[var(--shadow)]">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">Cart</div>
            <h2 className="text-xl font-black text-white">{cart.length} items</h2>
          </div>
          <button
            type="button"
            onClick={onClear}
            className="theme-button-soft px-3 py-2 text-sm"
          >
            <Trash2 className="h-4 w-4" />
            Clear
          </button>
        </div>

        <div className="mt-4 max-h-[24rem] space-y-3 overflow-auto pr-1">
          {cart.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-[var(--border)] bg-[var(--surface)] p-8 text-center">
              <ReceiptText className="mx-auto h-10 w-10 text-[var(--muted)]" />
              <p className="mt-3 text-sm font-semibold text-[var(--text)]">Cart is empty</p>
              <p className="mt-2 text-xs text-[var(--muted)]">Search products or scan a barcode to start selling.</p>
            </div>
          ) : (
            cart.map((item) => (
              <div key={String(item.key || item.variant_id)} className="pos-cart-item rounded-3xl border border-[var(--border)] bg-[var(--card)] p-3">
                <div className="flex gap-3">
                  <div className="h-16 w-16 overflow-hidden rounded-2xl bg-[var(--surface)]">
                    {item.image_url ? (
                      <CartItemImage
                        src={item.image_url}
                        fallbackSrc={item.product_image_url}
                        alt={item.name}
                      />
                    ) : (
                      <ImagePlaceholder />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate font-semibold text-[var(--text)]">{item.name}</div>
                        <div className="mt-1 text-xs text-[var(--muted)]">
                          {item.color || "Default"} / {item.size || "One size"} / SKU {item.sku}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => onRemove(item.key)}
                        className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2 text-[var(--muted)] transition hover:text-[var(--text)]"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>

                    <div className="mt-3 grid grid-cols-3 gap-2">
                      <ControlButton onClick={() => onDecrease(item.key)} icon={<Minus className="h-3.5 w-3.5" />} />
                      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-center text-sm font-bold text-[var(--text)]">
                        {item.quantity}
                      </div>
                      <ControlButton onClick={() => onIncrease(item.key)} icon={<Plus className="h-3.5 w-3.5" />} />
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                      <label className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[var(--text)]">
                        <div className="mb-1 text-[10px] uppercase tracking-[0.16em] text-[var(--muted)]">Line discount</div>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={item.lineDiscount}
                          onChange={(e) => onItemDiscountChange(item.key, e.target.value)}
                          className="w-full bg-transparent text-sm font-semibold text-[var(--text)] outline-none"
                        />
                      </label>
                      <div className="rounded-2xl border border-[var(--primary)]/20 bg-[var(--primary-soft)] px-3 py-2 text-right">
                        <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--primary)]">Line total</div>
                        <div className="text-sm font-black text-[var(--text)]">
                          {formatCurrency(
                            Math.max(0, item.price * item.quantity - item.lineDiscount * item.quantity)
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="mt-4 grid gap-2 rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm">
          <SummaryRow label="Subtotal" value={formatCurrency(totals.subtotal)} />
          <SummaryRow label="Item discounts" value={`- ${formatCurrency(totals.itemDiscountTotal)}`} />
          <SummaryRow label="Invoice discount">
            <input
              type="number"
              min="0"
              step="0.01"
              value={invoiceDiscount}
              onChange={(e) => setInvoiceDiscount(Number(e.target.value || 0))}
              className="w-28 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-right text-sm font-semibold text-white outline-none"
            />
          </SummaryRow>
          <SummaryRow label="Loyalty discount" value={`- ${formatCurrency(loyaltyDiscount)}`} />
          {Number(totals.couponDiscount || 0) > 0 ? (
            <SummaryRow label={`Coupon ${couponValidation?.coupon?.code || couponCode}`} value={`- ${formatCurrency(totals.couponDiscount)}`} />
          ) : null}
          <SummaryRow label="Service fee">
            <input
              type="number"
              min="0"
              step="0.01"
              value={serviceFee}
              onChange={(e) => setServiceFee(Number(e.target.value || 0))}
              className="w-28 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-right text-sm font-semibold text-white outline-none"
            />
          </SummaryRow>
          <div className="mt-2 border-t border-white/10 pt-3">
            <SummaryRow label="Total" value={formatCurrency(totals.total)} strong />
          </div>
        </div>
      </div>

      <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-4 shadow-2xl shadow-black/10">
        <div className="mb-4 rounded-3xl border border-emerald-400/20 bg-emerald-500/10 p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[10px] uppercase tracking-[0.18em] text-emerald-200/75">Salesperson</div>
              <div className="mt-1 text-sm font-black text-white">Assign commission</div>
            </div>
            {!allowSaleWithoutSalesperson && !selectedSalespersonId ? (
              <div className="rounded-full bg-amber-500/15 px-3 py-1 text-[11px] font-black text-amber-100">Required</div>
            ) : null}
          </div>
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
            {allowSaleWithoutSalesperson ? (
              <button
                type="button"
                onClick={() => setSelectedSalespersonId?.("")}
                className={[
                  "inline-flex shrink-0 items-center gap-2 rounded-2xl border px-3 py-2 text-xs font-black transition",
                  !selectedSalespersonId
                    ? "border-white/20 bg-white text-zinc-950"
                    : "border-white/10 bg-black/20 text-zinc-300 hover:bg-white/10",
                ].join(" ")}
              >
                None
              </button>
            ) : null}
            {salesEmployees.map((employee) => {
              const active = String(selectedSalespersonId || "") === String(employee.id);
              const initials = String(employee.name || "?")
                .split(/\s+/)
                .filter(Boolean)
                .slice(0, 2)
                .map((part) => part[0])
                .join("")
                .toUpperCase();
              return (
                <button
                  key={employee.id}
                  type="button"
                  onClick={() => setSelectedSalespersonId?.(String(employee.id))}
                  className={[
                    "inline-flex shrink-0 items-center gap-2 rounded-2xl border px-3 py-2 text-xs font-black transition",
                    active
                      ? "border-emerald-200/60 bg-emerald-400 text-zinc-950"
                      : "border-white/10 bg-black/20 text-white hover:bg-white/10",
                  ].join(" ")}
                >
                  <span className="grid h-7 w-7 place-items-center rounded-full bg-black/20 text-[10px]">{initials || <User className="h-3.5 w-3.5" />}</span>
                  <span>{employee.name}</span>
                </button>
              );
            })}
            {salesEmployees.length === 0 ? (
              <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-xs font-semibold text-zinc-400">
                No active sales staff
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">Payment</div>
            <h2 className="text-xl font-black text-white">Checkout</h2>
          </div>
          <div
            className={`rounded-2xl px-3 py-2 text-xs font-semibold ${
              paymentSummary.paymentStatus === "Paid"
                ? "bg-emerald-500/10 text-emerald-300"
                : paymentSummary.paymentStatus === "Partial"
                  ? "bg-amber-500/10 text-amber-300"
                  : "bg-white/5 text-zinc-300"
            }`}
          >
            {paymentSummary.paymentStatus}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <ModeButton active={paymentMode === "cash"} onClick={() => setPaymentMode("cash")} icon={<Banknote className="h-4 w-4" />} label="Cash" />
          <ModeButton active={paymentMode === "card"} onClick={() => setPaymentMode("card")} icon={<CreditCard className="h-4 w-4" />} label="Card" />
          <ModeButton active={paymentMode === "wallet"} onClick={() => setPaymentMode("wallet")} icon={<Wallet className="h-4 w-4" />} label="Wallet" />
          <ModeButton active={paymentMode === "split"} onClick={() => setPaymentMode("split")} icon={<CheckCircle2 className="h-4 w-4" />} label="Split" />
        </div>

        {customer ? (
          <div className="mt-4 rounded-3xl border border-emerald-400/20 bg-emerald-500/10 p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[10px] uppercase tracking-[0.18em] text-emerald-200/70">رصيد المحفظة</div>
                <div className="mt-1 text-sm font-black text-emerald-50">{formatCurrency(customerWalletBalance, "ar")}</div>
              </div>
              <button
                type="button"
                disabled={walletApplicable <= 0}
                onClick={() => {
                  setPaymentMode("split");
                  setWalletAmount(walletApplicable);
                  setCashAmount(Math.max(0, Number(totals.total || 0) - walletApplicable));
                }}
                className="h-10 rounded-2xl border border-emerald-300/30 bg-emerald-400/15 px-3 text-xs font-black text-emerald-50 disabled:opacity-40"
              >
                تطبيق الرصيد
              </button>
            </div>
          </div>
        ) : null}

        <div className="mt-4 space-y-3">
          <div className="rounded-3xl border border-violet-400/20 bg-violet-500/10 p-3">
            <div className="text-[10px] uppercase tracking-[0.18em] text-violet-200/75">Coupon</div>
            <div className="mt-2 flex gap-2">
              <input
                value={couponCode}
                onChange={(e) => setCouponCode?.(e.target.value.toUpperCase())}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onApplyCoupon?.();
                }}
                placeholder="Scan or enter code"
                className="min-w-0 flex-1 rounded-2xl border border-white/10 bg-black/30 px-3 py-2 text-sm font-black uppercase tracking-[0.08em] text-white outline-none placeholder:normal-case placeholder:tracking-normal placeholder:text-zinc-500"
              />
              {couponValidation?.valid ? (
                <button type="button" onClick={onRemoveCoupon} className="rounded-2xl border border-rose-300/30 bg-rose-500/15 px-3 text-xs font-black text-rose-100">
                  Remove
                </button>
              ) : (
                <button type="button" disabled={couponLoading || !couponCode} onClick={onApplyCoupon} className="rounded-2xl border border-violet-300/30 bg-violet-400/20 px-3 text-xs font-black text-violet-50 disabled:opacity-40">
                  {couponLoading ? "..." : "Apply"}
                </button>
              )}
            </div>
            {couponValidation?.valid ? (
              <div className="mt-2 text-xs font-semibold text-violet-100">
                Applied {formatCurrency(couponValidation.discount_amount || 0)} discount.
              </div>
            ) : couponValidation?.reason ? (
              <div className="mt-2 text-xs font-semibold text-amber-200">{couponValidation.reason}</div>
            ) : null}
          </div>

          {paymentMode === "split" ? (
            <div className="grid grid-cols-3 gap-3">
              <AmountField label="Cash" value={cashAmount} onChange={setCashAmount} />
              <AmountField label="Card" value={cardAmount} onChange={setCardAmount} />
              <AmountField label="Wallet" value={walletAmount} onChange={setWalletAmount} />
            </div>
          ) : (
            <AmountField
              label="Paid amount"
              value={paymentMode === "cash" ? cashAmount : paymentMode === "card" ? cardAmount : walletAmount}
              onChange={(value) => {
                if (paymentMode === "cash") setCashAmount(value);
                if (paymentMode === "card") setCardAmount(value);
                if (paymentMode === "wallet") setWalletAmount(value);
              }}
            />
          )}

          <label className="block space-y-2 rounded-3xl border border-cyan-500/20 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-50">
            <span className="block text-[10px] uppercase tracking-[0.18em] text-cyan-200/70">Redeem loyalty points</span>
            <input
              type="number"
              min="0"
              step="1"
              value={loyaltyRedeemPoints}
              onChange={(e) => setLoyaltyRedeemPoints(Math.max(0, Number(e.target.value || 0)))}
              disabled={!customer || loyaltyUnavailable}
              className="w-full bg-transparent text-lg font-black text-white outline-none placeholder:text-cyan-100/60 disabled:opacity-60"
              placeholder="0"
            />
            <div className="mt-1 text-xs text-cyan-100/80">
              {loyaltyUnavailable
                ? "Loyalty unavailable for this cashier"
                : `Discount ${formatCurrency(loyaltyDiscount)} | Earn ${Number(loyaltyPointsToEarn || 0).toLocaleString()} pts`}
            </div>
            {loyaltyValidation && loyaltyValidation.valid === false && Number(loyaltyRedeemPoints || 0) > 0 ? (
              <div className="text-xs font-semibold text-amber-200">
                Requested points exceed the current allowed balance.
              </div>
            ) : null}
          </label>

          <div className="grid grid-cols-2 gap-3 rounded-3xl border border-white/10 bg-white/5 p-4 text-sm">
            <SummaryRow label="Paid" value={formatCurrency(paymentSummary.paidAmount)} />
            <SummaryRow label="Change" value={formatCurrency(paymentSummary.changeAmount)} />
            <SummaryRow label="Due" value={formatCurrency(paymentSummary.dueAmount)} />
            <SummaryRow label="Invoice" value={invoiceNumber} />
            <SummaryRow label="Loyalty discount" value={`- ${formatCurrency(loyaltyDiscount)}`} />
            <SummaryRow label="Points to earn" value={Number(loyaltyPointsToEarn || 0).toLocaleString()} />
            <SummaryRow label="Wallet cashback" value={formatCurrency(walletCashbackToEarn)} />
            <SummaryRow label="Current points" value={Number(loyaltyProfile?.available_points || 0).toLocaleString()} />
          </div>

          <label className="block space-y-2 rounded-3xl border border-cyan-500/20 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-50">
            <span className="block text-[10px] uppercase tracking-[0.18em] text-cyan-200/70">Customer came from</span>
            <select
              value={marketingAttribution?.source_key || marketingAttribution?.attribution_type || ""}
              onChange={(e) => {
                const sourceKey = e.target.value;
                if (!sourceKey) {
                  const next = {
                    source_key: "",
                    attribution_type: "",
                    marketing_source: "",
                    marketing_platform: "",
                    marketing_campaign: marketingAttribution?.marketing_campaign || "",
                    marketing_post_id: marketingAttribution?.marketing_post_id || "",
                    marketing_tracking_code: marketingAttribution?.marketing_tracking_code || "",
                    marketing_session_id: marketingAttribution?.marketing_session_id || "",
                  };
                  setMarketingAttribution?.(next);
                  try {
                    window.localStorage.setItem("erp.marketing.attribution", JSON.stringify(next));
                  } catch {
                    // best-effort only
                  }
                  return;
                }
                const next = {
                  source_key: sourceKey,
                  attribution_type: sourceKey,
                  marketing_source:
                    sourceKey === "facebook_post"
                      ? "facebook"
                      : sourceKey === "instagram_post"
                        ? "instagram"
                        : sourceKey === "instagram_story"
                          ? "story"
                          : sourceKey === "tiktok"
                            ? "tiktok"
                            : sourceKey === "whatsapp_campaign"
                              ? "whatsapp"
                              : "other",
                  marketing_platform:
                    sourceKey === "facebook_post"
                      ? "facebook"
                      : sourceKey === "instagram_post"
                        ? "instagram"
                        : sourceKey === "instagram_story"
                          ? "instagram"
                          : sourceKey === "tiktok"
                            ? "tiktok"
                            : sourceKey === "whatsapp_campaign"
                              ? "whatsapp"
                              : "other",
                  marketing_campaign: marketingAttribution?.marketing_campaign || "",
                  marketing_post_id: marketingAttribution?.marketing_post_id || "",
                  marketing_tracking_code: marketingAttribution?.marketing_tracking_code || "",
                  marketing_session_id: marketingAttribution?.marketing_session_id || "",
                };
                setMarketingAttribution?.(next);
                try {
                  window.localStorage.setItem("erp.marketing.attribution", JSON.stringify(next));
                } catch {
                  // best-effort only
                }
              }}
              className="w-full rounded-2xl border border-cyan-400/20 bg-zinc-950/80 px-4 py-3 text-sm font-semibold text-white outline-none"
            >
              <option value="">Not set</option>
              <option value="other">Other</option>
              <option value="facebook_post">Facebook</option>
              <option value="instagram_post">Instagram</option>
              <option value="instagram_story">Story</option>
              <option value="tiktok">TikTok</option>
              <option value="whatsapp_campaign">WhatsApp</option>
            </select>
          </label>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={onCheckout}
            disabled={checkoutLoading || cart.length === 0}
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-black text-black transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {checkoutLoading ? "Processing..." : checkoutLabel}
          </button>
          <button
            type="button"
            onClick={onPrint}
            disabled={!canUseOrderActions}
            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
          >
            <Printer className="h-4 w-4" />
            Thermal print
          </button>
          <button
            type="button"
            onClick={onDownloadPdf}
            disabled={!canUseOrderActions}
            title={!canUseOrderActions ? "قم بإنشاء الفاتورة أولاً" : "Download PDF"}
            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ReceiptText className="h-4 w-4" />
            Download PDF
          </button>
          <button
            type="button"
            onClick={onShareWhatsapp}
            disabled={!canUseOrderActions}
            title={!canUseOrderActions ? "قم بإنشاء الفاتورة أولاً" : "Share WhatsApp"}
            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <MessageCircle className="h-4 w-4" />
            Share WhatsApp
          </button>
        </div>

        {!canUseOrderActions ? (
          <div className="mt-3 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-xs font-medium text-amber-100">
            قم بإنشاء الفاتورة أولاً
          </div>
        ) : null}

        {lastInvoiceUrl ? (
          <div className="mt-4 rounded-3xl border border-emerald-500/20 bg-emerald-500/10 p-4">
            <div className="text-[11px] uppercase tracking-[0.2em] text-emerald-200">Recent invoice</div>
            <div className="mt-1 text-sm font-bold text-white">{lastInvoiceNumber || "Invoice"}</div>
            <div className="mt-2 break-all text-xs text-emerald-100/80">{lastInvoiceUrl}</div>
            <div className="mt-3 grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={onCopyInvoiceLink}
                disabled={!canUseOrderActions}
                title={!canUseOrderActions ? "قم بإنشاء الفاتورة أولاً" : "Copy invoice link"}
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Copy className="h-3.5 w-3.5" />
                Copy
              </button>
              <button
                type="button"
                onClick={onOpenInvoice}
                disabled={!canUseOrderActions}
                title={!canUseOrderActions ? "قم بإنشاء الفاتورة أولاً" : "Open invoice"}
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Open
              </button>
              <button
                type="button"
                onClick={onShareWhatsapp}
                disabled={!canUseOrderActions}
                title={!canUseOrderActions ? "قم بإنشاء الفاتورة أولاً" : "Share WhatsApp"}
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <MessageCircle className="h-3.5 w-3.5" />
                WhatsApp
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-4 shadow-2xl shadow-black/10">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">Receipt preview</div>
            <h2 className="text-xl font-black text-white">Thermal / A4</h2>
          </div>
          <div className="inline-flex rounded-2xl border border-white/10 bg-white/5 p-1 text-xs font-semibold">
            <button
              type="button"
              onClick={() => setPreviewMode("thermal")}
              className={`rounded-xl px-3 py-2 ${previewMode === "thermal" ? "bg-emerald-500 text-black" : "text-zinc-300"}`}
            >
              Thermal
            </button>
            <button
              type="button"
              onClick={() => setPreviewMode("a4")}
              className={`rounded-xl px-3 py-2 ${previewMode === "a4" ? "bg-emerald-500 text-black" : "text-zinc-300"}`}
            >
              A4
            </button>
          </div>
        </div>

        <div className="mt-4">
          {previewMode === "thermal" ? (
            <div ref={invoiceRef}>
              <ReceiptPreview
                invoiceNumber={invoiceNumber}
                customer={customer}
                cart={cart}
                totals={totals}
                paymentSummary={paymentSummary}
                paymentMode={paymentMode}
                loyaltyProfile={loyaltyProfile}
                loyaltyValidation={loyaltyValidation}
                walletCashbackToEarn={walletCashbackToEarn}
                compact
              />
            </div>
          ) : (
            <div ref={a4Ref}>
              <ReceiptPreview
                invoiceNumber={invoiceNumber}
                customer={customer}
                cart={cart}
                totals={totals}
                paymentSummary={paymentSummary}
                paymentMode={paymentMode}
                loyaltyProfile={loyaltyProfile}
                loyaltyValidation={loyaltyValidation}
                walletCashbackToEarn={walletCashbackToEarn}
              />
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}

function ReceiptPreview({ invoiceNumber, customer, cart, totals, paymentSummary, paymentMode, loyaltyProfile, loyaltyValidation, walletCashbackToEarn = 0, compact = false }) {
  const premiumStore = useMemo(() => getStoreProfile(), []);
  const premiumReceiptNumber = String(invoiceNumber || "DRAFT");
  const premiumPublicUrl = useMemo(() => getReceiptPublicUrl(premiumReceiptNumber), [premiumReceiptNumber]);
  const premiumBarcodeSvg = useMemo(
    () =>
      getBarcodeSvg(premiumReceiptNumber, {
        width: compact ? 172 : 224,
        height: compact ? 23 : 29,
        displayText: premiumReceiptNumber,
      }),
    [premiumReceiptNumber, compact]
  );
  const premiumDate = useMemo(
    () => formatArabicDate(),
    []
  );
  const premiumTime = useMemo(
    () => formatArabicTime(),
    []
  );
  const premiumSeller = getSellerName(customer);
  const premiumPayment = getPaymentLabel(paymentMode, paymentSummary);
  const premiumSocialLinks = useMemo(() => getInvoiceSocialLinks(premiumStore), [premiumStore]);
  const premiumDiscount = Number(totals.itemDiscountTotal || 0) + Number(totals.invoiceDiscount || 0) + Number(totals.loyaltyDiscount || 0) + Number(totals.couponDiscount || 0);
  const premiumService = Number(totals.serviceFee || 0);
  const premiumTotalQuantity = cart.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const walletPaid = Number(paymentSummary?.walletAmount || 0);
  const walletBalanceAfter = Number(
    paymentSummary?.walletBalanceAfter ??
      (Number(customer?.wallet_balance ?? customer?.balance ?? loyaltyProfile?.wallet_balance ?? 0) - walletPaid)
  );
  const premiumCustomerName = customer?.name || customer?.customer_name || "Walk-in Customer";
  const premiumCustomerPhone = customer?.phone || customer?.mobile || customer?.customer_phone || "";

  return (
    <div
      dir="rtl"
      className={`pos-receipt mx-auto bg-white text-right text-zinc-950 shadow-2xl shadow-black/20 ${
        compact
          ? "pos-receipt-thermal max-w-[320px] rounded-[18px] border border-zinc-200 p-2.5"
          : "pos-receipt-a4 max-w-[720px] rounded-[22px] border border-zinc-200 p-4"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50">
            {premiumStore.logoUrl ? (
              <img src={premiumStore.logoUrl} alt={premiumStore.name} className="h-full w-full object-contain p-1.5" />
            ) : (
              <ShoppingBag className="h-5 w-5 text-emerald-600" />
            )}
          </div>
          <div className="min-w-0">
            <div className="truncate text-base font-black text-zinc-950">{premiumStore.name}</div>
            {premiumStore.tagline ? <div className="mt-0.5 text-[10px] font-bold text-zinc-500">{premiumStore.tagline}</div> : null}
          </div>
        </div>
        <div className="min-w-[120px] text-left">
          <div className="text-xl font-black text-emerald-700">فاتورة بيع</div>
          <InvoiceMeta icon={FileText} text={`رقم الفاتورة: ${premiumReceiptNumber}`} />
          <InvoiceMeta icon={CalendarDays} text={premiumDate} />
          <InvoiceMeta icon={Clock3} text={premiumTime} />
        </div>
      </div>
      <div className="mt-2 h-px bg-emerald-500" />

      <section className="mt-2 rounded-xl border border-zinc-200 bg-white px-2.5 py-2 shadow-sm shadow-zinc-100/70">
        <CustomerLine icon={User}>
          <span className="font-black text-zinc-950">{premiumCustomerName}</span>
        </CustomerLine>
        {premiumCustomerPhone ? <CustomerLine icon={Smartphone}>{premiumCustomerPhone}</CustomerLine> : null}
        {premiumSeller ? <CustomerLine icon={ShoppingBag}>البائع: {premiumSeller}</CustomerLine> : null}
        <div className="my-1.5 border-t border-dashed border-zinc-300" />
        <CustomerLine icon={CreditCard}>طريقة الدفع: {premiumPayment}</CustomerLine>
      </section>

      <section className="mt-2 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm shadow-zinc-100/70">
        <div className="grid grid-cols-[minmax(0,1.5fr)_74px_40px_64px_70px] gap-1 border-b border-zinc-200 bg-zinc-50 px-2 py-1.5 text-[10px] font-black text-zinc-600">
          <div>المنتج</div>
          <div>المقاس / اللون</div>
          <div className="text-center">الكمية</div>
          <div className="text-left">السعر</div>
          <div className="text-left">الإجمالي</div>
        </div>
        {cart.length === 0 ? (
          <div className="px-2 py-4 text-center text-xs font-semibold text-zinc-500">لا توجد منتجات</div>
        ) : (
          cart.map((item) => {
            const unitPrice = getReceiptItemUnitPrice(item);
            const lineTotal = getReceiptItemTotal(item);
            const imageSrc = getInvoiceItemImage(item);
            const variant = [item.size, item.color].filter(Boolean).join(" / ") || "غير محدد";

            return (
              <div key={String(item.key || item.variant_id || item.name)} className="grid grid-cols-[minmax(0,1.5fr)_74px_40px_64px_70px] gap-1 border-b border-zinc-100 px-2 py-2.5 text-[11px] last:border-b-0">
                <div className="flex min-w-0 items-center gap-2">
                  <div className="h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-zinc-100 ring-1 ring-zinc-200">
                    {imageSrc ? <CartItemImage src={imageSrc} fallbackSrc={item.product_image_url || item.product?.image_url} alt={item.name} /> : <ImagePlaceholder />}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate font-black text-zinc-950">{item.name || "منتج"}</div>
                    <div className="mt-0.5 truncate text-[10px] text-zinc-500">{variant}</div>
                  </div>
                </div>
                <div className="self-center text-[10px] font-semibold text-zinc-500">{variant}</div>
                <div className="self-center text-center font-black">{Number(item.quantity || 0)}</div>
                <div className="self-center text-left font-black text-zinc-950">{formatReceiptPrice(unitPrice)}</div>
                <div className="self-center text-left font-black text-emerald-700">{formatReceiptPrice(lineTotal)}</div>
              </div>
            );
          })
        )}
      </section>

      <section className="mt-2 grid gap-2 rounded-xl border border-zinc-200 bg-white p-3 shadow-sm shadow-zinc-100/70 sm:grid-cols-[1.25fr_0.85fr]">
        <div className="space-y-1.5 text-[12px] sm:border-l sm:border-dashed sm:border-zinc-200 sm:pl-3">
          <SummaryLine label="المجموع الفرعي" value={formatCurrency(totals.subtotal || 0)} />
          {premiumDiscount > 0 ? <SummaryLine label="الخصم" value={`- ${formatCurrency(premiumDiscount)}`} /> : null}
          {premiumService > 0 ? <SummaryLine label="الخدمة" value={formatCurrency(premiumService)} /> : null}
          <div className="flex items-center justify-between border-t border-zinc-200 pt-2 text-lg font-black text-emerald-700">
            <span>الإجمالي النهائي</span>
            <span>{formatCurrency(totals.total || 0)}</span>
          </div>
        </div>
        <div className="space-y-1.5 text-[12px]">
          <MetricLine icon={Package} label="عدد المنتجات" value={cart.length} />
          <MetricLine icon={ShoppingBag} label="إجمالي الكمية" value={premiumTotalQuantity} />
        </div>
      </section>

      {walletPaid > 0 ? (
        <section className="mt-2 rounded-xl border border-emerald-200 bg-emerald-50/70 p-3 text-[12px] font-bold text-zinc-800">
          <SummaryLine label="المدفوع من المحفظة" value={formatCurrency(walletPaid)} />
          <SummaryLine label="المتبقي نقدي/بطاقة" value={formatCurrency(paymentSummary?.remainingCashOrCard || Math.max(0, Number(totals.total || 0) - walletPaid))} />
          <SummaryLine label="رصيد المحفظة بعد العملية" value={formatCurrency(walletBalanceAfter)} />
        </section>
      ) : null}

      <section className="mt-2 rounded-xl border border-zinc-200 bg-white p-2 text-center">
        <div className="flex items-center justify-center gap-1.5 text-[10.5px] font-bold leading-relaxed text-zinc-700">
          <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
          <span>{RETURN_POLICY_TEXT}</span>
        </div>
      </section>
      <div className="mt-1.5 h-px bg-emerald-500" />

      {premiumSocialLinks.length ? (
        <div className="mt-2 grid grid-cols-3 gap-1.5">
          {premiumSocialLinks.map(({ key, label, url, icon: Icon }) => (
            <a
              key={key}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
                className={`inline-flex min-h-[38px] min-w-0 items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-[10px] font-black text-white shadow-md transition hover:-translate-y-0.5 hover:shadow-lg ${
                  key === "google"
                    ? "bg-[linear-gradient(90deg,#4285F4,#34A853,#FBBC05,#EA4335)]"
                    : key === "facebook"
                      ? "bg-[#1877F2]"
                      : "bg-[linear-gradient(90deg,#833AB4,#E1306C,#FD1D1D,#FCAF45)]"
                }`}
            >
              <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${key === "instagram" ? "bg-white/15" : "bg-white"}`}>
                <BrandedSocialIcon type={key} className={`h-3.5 w-3.5 ${key === "facebook" ? "text-[#1877f2]" : key === "instagram" ? "text-white" : ""}`} />
              </span>
              <span className="truncate">{label}</span>
            </a>
          ))}
        </div>
      ) : null}

      <section className="mt-2 text-center">
        <div className={`pos-receipt-barcode mx-auto max-w-full bg-white ${compact ? "w-[172px]" : "w-[224px]"}`}>
          <div dangerouslySetInnerHTML={{ __html: premiumBarcodeSvg }} />
        </div>
        <div className="mt-0.5 text-[10px] font-black tracking-[0.08em] text-zinc-950">{premiumReceiptNumber}</div>
        <div className="mx-auto mt-1 h-px w-full max-w-[280px] bg-emerald-500" />
        <div className="mt-1 flex items-center justify-center gap-2 text-[10px] font-bold text-zinc-600" dir="ltr">
          <span className="inline-flex items-center gap-1">
            <Globe className="h-3 w-3 text-emerald-600" />
            {premiumStore.website}
          </span>
          <span className="text-emerald-600">|</span>
          <span className="inline-flex items-center gap-1" dir="rtl">
            <Smartphone className="h-3 w-3 text-emerald-600" />
            خدمة العملاء - {premiumStore.phone}
          </span>
          {premiumPublicUrl ? (
            <span className="ms-1 inline-flex items-center justify-center rounded border border-zinc-200 bg-white p-0.5 align-middle">
              <QRCodeSVG value={premiumPublicUrl} size={compact ? 20 : 24} level="M" />
            </span>
          ) : null}
        </div>
      </section>
    </div>
  );
  const store = useMemo(() => getStoreProfile(), []);
  const receiptDate = useMemo(() => getReceiptDate(), []);
  const receiptNumber = String(invoiceNumber || "DRAFT");
  const barcodeValue = receiptNumber || invoiceNumber || "RECEIPT";
  const barcodeSvg = useMemo(
    () =>
      getBarcodeSvg(barcodeValue, {
        width: compact ? 190 : 260,
        height: compact ? 32 : 38,
        displayText: barcodeValue,
      }),
    [barcodeValue, compact]
  );
  const earnedPoints = Number(Math.floor(Number(totals.total || 0) / 100) * 10);
  const redeemedPoints = Number(loyaltyValidation?.applied_points || 0);
  const remainingPoints = Number(loyaltyValidation?.available_points ?? loyaltyProfile?.available_points ?? 0);
  const tier = loyaltyProfile?.tier || customer?.loyalty_tier || customer?.tier || "Bronze";
  const walletCashback = Number(walletCashbackToEarn || 0);
  const showLoyaltyStrip = [earnedPoints, redeemedPoints, remainingPoints, walletCashback].some((value) => Number(value || 0) > 0);
  const sellerName =
    customer?.sales_name ||
    customer?.seller_name ||
    customer?.cashier_name ||
    customer?.salesName ||
    customer?.sellerName ||
    customer?.cashierName ||
    "عمر";
  const receiptLabel = (_key, fallback) => fallback;
  return (
    <div
      dir="rtl"
      className={`pos-receipt mx-auto border border-emerald-100 bg-white text-zinc-950 shadow-2xl shadow-black/20 ${
        compact ? "pos-receipt-thermal max-w-[340px] rounded-[22px] p-3" : "pos-receipt-a4 max-w-[720px] rounded-[24px] p-5"
      }`}
    >
      <div className="text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-emerald-200 bg-emerald-50 text-emerald-600">
          <ShoppingBag className="h-6 w-6" />
        </div>
        <div className="mt-2 text-xl font-black tracking-wide text-zinc-950">{store.name}</div>
        <div className="mt-1 text-[11px] font-black uppercase tracking-[0.22em] text-emerald-600">
          {receiptLabel("thankYou", "شكراً لثقتكم بنا")}
        </div>
        <div className="mt-3 h-px bg-emerald-500" />
      </div>

      <div className={`mt-3 grid gap-x-4 gap-y-1.5 text-[12px] ${compact ? "grid-cols-1" : "grid-cols-2"}`}>
        <div className="space-y-1.5">
          <ReceiptInfo icon={FileText} label={receiptLabel("invoice", "رقم الفاتورة")} value={invoiceNumber} />
          <ReceiptInfo icon={User} label={receiptLabel("seller", "البائع")} value={sellerName} />
          <ReceiptInfo icon={User} label={receiptLabel("customer", "العميل")} value={customer?.name || receiptLabel("walkIn", "Walk-in Customer")} />
        </div>
        <div className="space-y-1.5">
          <ReceiptInfo icon={Star} label={receiptLabel("tier", "العضوية")} value={tier} />
          <ReceiptInfo icon={CreditCard} label={receiptLabel("payment", "طريقة الدفع")} value={paymentSummary.paymentStatus} />
          <ReceiptInfo icon={CalendarDays} label={receiptLabel("date", "التاريخ")} value={receiptDate} />
        </div>
      </div>

      <div className="mt-3 border-y border-dashed border-emerald-300 py-2.5">
        <div className="grid grid-cols-[1fr_38px_66px_72px] gap-2 text-[10px] font-black uppercase tracking-[0.12em] text-emerald-700">
          <div>{receiptLabel("item", "المنتج")}</div>
          <div className="text-center">{receiptLabel("qty", "الكمية")}</div>
          <div className="text-right">{receiptLabel("price", "السعر")}</div>
          <div className="text-right">{receiptLabel("total", "الإجمالي")}</div>
        </div>
        <div className="mt-1.5 space-y-1.5">
        {cart.length === 0 ? (
          <div className="text-sm text-zinc-500">{receiptLabel("noItems", "لا توجد منتجات.")}</div>
        ) : (
          cart.map((item) => {
            const unitPrice = getReceiptItemUnitPrice(item);
            const lineTotal = getReceiptItemTotal(item);
            const imageSrc = item.image_url || item.product_image_url || item.image || item.photo_url || "";

            return (
              <div key={String(item.key)} className="grid grid-cols-[1fr_38px_66px_72px] gap-2 border-t border-dashed border-zinc-200 pt-1.5 text-[12px]">
                <div className="flex min-w-0 flex-row-reverse items-center gap-2">
                  <div className="h-11 w-11 shrink-0 overflow-hidden rounded-xl bg-zinc-100">
                    {imageSrc ? (
                      <CartItemImage src={imageSrc} fallbackSrc={item.product_image_url} alt={item.name} />
                    ) : (
                      <ImagePlaceholder />
                    )}
                  </div>
                  <div className="min-w-0 flex-1 text-right">
                    <div className="truncate font-black leading-tight text-zinc-950">{item.name}</div>
                    <div className="mt-0.5 text-[11px] leading-tight text-zinc-500">
                      {item.color || receiptLabel("default", "افتراضي")} / {item.size || receiptLabel("oneSize", "مقاس واحد")}
                    </div>
                  </div>
                </div>
                <div className="self-center text-center font-bold">{item.quantity}</div>
                <div className="self-center text-right font-black text-zinc-950">{formatReceiptPrice(unitPrice)}</div>
                <div className="self-center text-right font-black text-emerald-700">{formatReceiptPrice(lineTotal)}</div>
              </div>
            );
          })
        )}
        </div>
      </div>

      {showLoyaltyStrip ? (
        <div className="mt-2 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-xl border border-emerald-100 bg-emerald-50/60 px-2 py-1 text-[10px] font-bold text-zinc-700">
          <span>النقاط المكتسبة: {earnedPoints.toLocaleString()}</span>
          <span className="text-emerald-600">|</span>
          <span>المستخدمة: {redeemedPoints.toLocaleString()}</span>
          <span className="text-emerald-600">|</span>
          <span>المتبقية: {remainingPoints.toLocaleString()}</span>
          <span className="text-emerald-600">|</span>
          <span>المحفظة: {formatCurrency(walletCashback)}</span>
        </div>
      ) : null}

      <div className="mt-3 space-y-1.5 text-[13px]">
        <ReceiptTotalRow label={receiptLabel("subtotal", "الإجمالي الفرعي")} value={formatCurrency(totals.subtotal)} />
        <ReceiptTotalRow label={receiptLabel("discounts", "الخصومات")} value={`- ${formatCurrency(totals.itemDiscountTotal + totals.invoiceDiscount)}`} />
        <ReceiptTotalRow label={receiptLabel("loyaltyDiscount", "خصم الولاء")} value={`- ${formatCurrency(totals.loyaltyDiscount || 0)}`} />
        {Number(totals.couponDiscount || 0) > 0 ? <ReceiptTotalRow label="Coupon Discount" value={`- ${formatCurrency(totals.couponDiscount || 0)}`} /> : null}
        <ReceiptTotalRow label={receiptLabel("serviceFee", "رسوم الخدمة")} value={formatCurrency(totals.serviceFee)} />
        <div className="h-px bg-emerald-500" />
        <div className="flex items-end justify-between gap-4 pt-1">
          <span className="text-sm font-black tracking-[0.08em] text-zinc-950">{receiptLabel("total", "الإجمالي")}</span>
          <span className="text-xl font-black text-emerald-600">{formatCurrency(totals.total)}</span>
        </div>
      </div>

      <div className="mt-2.5 border-t border-dashed border-emerald-300 pt-2 text-center">
        <div className="text-[11px] font-bold text-zinc-500">{receiptLabel("scanToView", "امسح لعرض الفاتورة")}</div>
        <div className={`pos-receipt-barcode mx-auto mt-1 max-w-full rounded-lg bg-white px-1 py-0 ${compact ? "w-[190px]" : "w-[260px]"}`}>
          <div dangerouslySetInnerHTML={{ __html: barcodeSvg }} />
        </div>
        <div className="mt-0.5 text-[10px] font-black tracking-[0.12em] text-emerald-700">{receiptNumber}</div>
        <div className="mx-auto mt-1 h-px w-full max-w-[260px] bg-emerald-500" />
        <div className="mx-auto mt-1 flex max-w-[340px] items-center justify-center gap-2 text-[10px] font-bold text-zinc-600">
          <span className="inline-flex items-center gap-1">
            <Globe className="h-3 w-3 text-emerald-600" />
            {store.website}
          </span>
          <span className="text-emerald-600">|</span>
          <span className="inline-flex items-center gap-1 [&>span:nth-of-type(2)]:hidden [&>span:last-child]:hidden">
            <Smartphone className="h-3 w-3 text-emerald-600" />
            <span>{"\u062e\u062f\u0645\u0629 \u0627\u0644\u0639\u0645\u0644\u0627\u0621"}</span>
            <span>خدمة العملاء</span>
            <span>-</span>
            <span>{store.phone}</span>
            <span>خدمة العملاء</span>
          </span>
        </div>
      </div>

    </div>
  );
}

function InvoiceMeta({ icon: Icon, text }) {
  return (
    <div className="mt-0.5 flex items-center justify-end gap-1 text-[10px] font-bold text-zinc-500">
      <Icon className="h-3 w-3 shrink-0 text-emerald-600" />
      <span className="truncate">{text}</span>
    </div>
  );
}

function CustomerLine({ icon: Icon, children }) {
  return (
    <div className="flex items-center gap-2 text-[12px] leading-tight text-zinc-700">
      <Icon className="h-4 w-4 shrink-0 text-emerald-600" />
      <span className="min-w-0 truncate">{children}</span>
    </div>
  );
}

function SummaryLine({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-3 font-semibold text-zinc-600">
      <span>{label}</span>
      <span className="font-black text-zinc-950">{value}</span>
    </div>
  );
}

function MetricLine({ icon: Icon, label, value }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-zinc-50 px-2 py-1.5 font-semibold text-zinc-600">
      <span className="inline-flex items-center gap-1">
        <Icon className="h-3.5 w-3.5 text-emerald-600" />
        {label}
      </span>
      <span className="font-black text-zinc-950">{value}</span>
    </div>
  );
}

function ReceiptInfo({ icon: Icon, label, value }) {
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <Icon className="h-3 w-3 shrink-0 text-emerald-600" />
      <span className="shrink-0 font-black text-zinc-950">{label}</span>
      <span className="min-w-0 truncate font-semibold text-zinc-600">{value}</span>
    </div>
  );
}

function ReceiptTotalRow({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="font-semibold text-zinc-500">{label}</span>
      <span className="font-black text-zinc-950">{value}</span>
    </div>
  );
}

function CartItemImage({ src, fallbackSrc, alt }) {
  const resolvedSrc = useMemo(() => resolveProductImageUrl(src), [src]);
  const resolvedFallbackSrc = useMemo(() => resolveProductImageUrl(fallbackSrc), [fallbackSrc]);
  const initialSrc = failedCartImageUrls.has(resolvedSrc) ? "" : resolvedSrc;
  const [currentSrc, setCurrentSrc] = useState(initialSrc);
  const [failed, setFailed] = useState(!initialSrc && Boolean(resolvedSrc));

  useEffect(() => {
    const nextSrc = failedCartImageUrls.has(resolvedSrc) ? "" : resolvedSrc;
    setCurrentSrc(nextSrc);
    setFailed(!nextSrc && Boolean(resolvedSrc));
  }, [resolvedSrc]);

  if (!currentSrc || failed) return <ImagePlaceholder />;

  return (
    <img
      src={currentSrc}
      alt={alt}
      loading="lazy"
      className="h-full w-full object-cover"
      onError={() => {
        failedCartImageUrls.add(currentSrc);
        if (resolvedFallbackSrc && resolvedFallbackSrc !== currentSrc) {
          if (failedCartImageUrls.has(resolvedFallbackSrc)) {
            setFailed(true);
          } else {
            setCurrentSrc(resolvedFallbackSrc);
          }
          return;
        }
        setFailed(true);
      }}
    />
  );
}

function ImagePlaceholder() {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <ImageIcon className="h-6 w-6 text-[var(--muted)]" />
    </div>
  );
}

function ControlButton({ onClick, icon }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center justify-center rounded-2xl border border-white/10 bg-black/30 px-3 py-2 text-white transition hover:bg-black/50"
    >
      {icon}
    </button>
  );
}

function SummaryRow({ label, value, strong = false, children }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-zinc-400">{label}</span>
      {children || <span className={`font-semibold ${strong ? "text-emerald-300" : "text-white"}`}>{value}</span>}
    </div>
  );
}

function ModeButton({ active, onClick, icon, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-2xl px-3 py-2 text-sm font-semibold transition ${
        active
          ? "bg-emerald-500 text-black"
          : "border border-white/10 bg-white/5 text-white hover:bg-white/10"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function AmountField({ label, value, onChange }) {
  return (
    <label className="block rounded-3xl border border-white/10 bg-white/5 p-4">
      <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">{label}</div>
      <input
        type="number"
        min="0"
        step="0.01"
        value={value}
        onChange={(e) => onChange(Number(e.target.value || 0))}
        className="mt-2 w-full bg-transparent text-lg font-black text-white outline-none"
      />
    </label>
  );
}

export default CartSidebar;
