import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import i18n from "../../../i18n/i18n";
import toast from "react-hot-toast";
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
  Percent,
  Plus,
  Printer,
  ReceiptText,
  Search,
  ShieldCheck,
  ShoppingBag,
  Smartphone,
  Star,
  Trash2,
  User,
  UserPlus,
  Wallet,
  X,
} from "lucide-react";

import { formatCurrency } from "../lib/posUtils";
import { POS_ARABIC_TEXT, safeArabicText } from "../lib/arabicText";
import { CurrencyText } from "../../../shared/components/CurrencyAmount";
import { matchesPhoneSearch, normalizePhone } from "../lib/phoneSearch";
import { resolveProductImageUrl } from "../../../shared/lib/imageUrls";
import { resolveInvoiceItemImageValue } from "../../../shared/lib/invoiceItemImages";
import { getCurrentTenant } from "../../../shared/auth/authStorage";

const QRCodeSVG = lazy(() => import("qrcode.react").then((module) => ({ default: module.QRCodeSVG })));
import { getBarcodeSvg } from "../../products/lib/barcodeLabels";
import { accountingApi } from "../../accounting/services/accountingApi";

const failedCartImageUrls = new Set();

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

const getInvoiceItemImage = (item = {}) => resolveInvoiceItemImageValue(item);

const formatReceiptPrice = (value) => {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) && numeric > 0 ? formatCurrency(numeric) : i18n.t("pos.receipt.unavailable");
};

const receiptPrintLabel = (key, fallback, options = {}) =>
  i18n.t(`print.invoice.${key}`, { defaultValue: fallback, ...options });
const posLabel = (key, fallback, options = {}) =>
  i18n.t(`pos.${key}`, { defaultValue: fallback, ...options });

const getReturnPolicyText = () => receiptPrintLabel("returnPolicy", "Exchange and return are allowed within 14 days if the item is unused and the invoice is kept.");

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
  const candidates = [
    import.meta.env.VITE_PUBLIC_APP_URL,
    import.meta.env.PUBLIC_APP_URL,
    import.meta.env.FRONTEND_URL,
  ]
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
  { key: "google", label: POS_ARABIC_TEXT.rateGoogle, url: store.googleReviewUrl, icon: Star },
  { key: "facebook", label: POS_ARABIC_TEXT.rateFacebook, url: store.facebookReviewUrl, icon: MessageCircle },
  { key: "instagram", label: POS_ARABIC_TEXT.followInstagram, url: store.instagramUrl, icon: ExternalLink },
].filter((link) => link.url && !/localhost|127\.0\.0\.1/i.test(link.url));

const getInvoiceSocialLinks = (store = {}) => [
  { key: "google", label: POS_ARABIC_TEXT.rateGoogle, url: store.googleReviewUrl || DEFAULT_SOCIAL_LINKS.googleReviewUrl, icon: Star },
  { key: "facebook", label: POS_ARABIC_TEXT.rateFacebook, url: store.facebookReviewUrl || DEFAULT_SOCIAL_LINKS.facebookReviewUrl, icon: MessageCircle },
  { key: "instagram", label: POS_ARABIC_TEXT.followInstagram, url: store.instagramUrl || DEFAULT_SOCIAL_LINKS.instagramUrl, icon: ExternalLink },
].filter((link) => link.url && !/localhost|127\.0\.0\.1/i.test(link.url));

const getLocalizedInvoiceSocialLinks = (store = {}) => {
  const labelByKey = {
    google: receiptPrintLabel("rateGoogle", "Rate us on Google"),
    facebook: receiptPrintLabel("rateFacebook", "Rate us on Facebook"),
    instagram: receiptPrintLabel("followInstagram", "Follow us on Instagram"),
  };
  return getInvoiceSocialLinks(store).map((link) => ({ ...link, label: labelByKey[link.key] || link.label }));
};

const getLocalizedPaymentLabel = (mode, paymentSummary = {}) => {
  const raw = String(mode || paymentSummary.method || paymentSummary.payment_method || "").toLowerCase();
  const legacyLabel = getPaymentLabel(mode, paymentSummary);
  const labels = {
    cash: "CASH",
    card: "VISA",
    visa: "VISA",
    wallet: "INSTAPAY",
    instapay: "INSTAPAY",
    vodafone_cash: "V.CASH",
    customer_wallet: receiptPrintLabel("customerWallet", "Customer wallet"),
    split: "SPLIT",
    transfer: receiptPrintLabel("transfer", "Transfer"),
    bank_transfer: receiptPrintLabel("transfer", "Transfer"),
  };
  return labels[raw] || (raw ? raw : legacyLabel || receiptPrintLabel("cash", "Cash"));
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
  const productionLabels = {
    cash: "CASH",
    card: "VISA",
    visa: "VISA",
    wallet: "INSTAPAY",
    instapay: "INSTAPAY",
    vodafone_cash: "V.CASH",
    split: "SPLIT",
  };
  if (productionLabels[raw]) return productionLabels[raw];
  const labels = {
    cash: "نقداً",
    card: "فيزا",
    visa: "فيزا",
    wallet: "محفظة",
    split: "متعدد",
    transfer: POS_ARABIC_TEXT.transfer,
    bank_transfer: POS_ARABIC_TEXT.transfer,
  };
  return labels[raw] || (raw ? raw : "نقداً");
};

const getSellerName = (customer = {}) => {
  const seller = customer?.sales_name || customer?.seller_name || customer?.salesman_name || customer?.salesName || customer?.sellerName;
  if (!seller || /cashieradmin/i.test(String(seller))) return "";
  return seller;
};

const salespersonAlias = (employee = {}) => {
  const alias = String(employee.pos_alias || employee.posAlias || "").trim();
  if (alias) return alias.slice(0, 10);
  const name = String(employee.name || employee.full_name || "").trim();
  return name || "?";
};

const salespersonAccent = (employee = {}) => {
  const accents = [
    "border-emerald-300/40 bg-emerald-400/10 text-emerald-100 hover:bg-emerald-400/15",
    "border-violet-300/40 bg-violet-400/10 text-violet-100 hover:bg-violet-400/15",
    "border-cyan-300/40 bg-cyan-400/10 text-cyan-100 hover:bg-cyan-400/15",
    "border-amber-300/40 bg-amber-400/10 text-amber-100 hover:bg-amber-400/15",
  ];
  const id = Number(employee.id || 0);
  return accents[Math.abs(id) % accents.length];
};

function CartSidebar({
  cart,
  onIncrease,
  onDecrease,
  onRemove,
  onClear,
  catalogProducts = [],
  onVariantChange,
  customer,
  customerCreditBalance = 0,
  canUseCustomerCredit = false,
  paymentMode,
  setPaymentMode,
  activeSplitMethod = "cash",
  setActiveSplitMethod,
  cashAmount,
  setCashAmount,
  cardAmount,
  setCardAmount,
  walletAmount,
  setWalletAmount,
  vodafoneCashAmount = 0,
  setVodafoneCashAmount,
  customerWalletAmount = 0,
  setCustomerWalletAmount,
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
  exchangeState = null,
  paymentDueAmount,
  editPaymentSummary = null,
  isEditingOrder = false,
  onLookupExchangeOrder,
  onApplyExchangeCredit,
  onClearExchangeCredit,
  paymentAccountStatus,
  paymentAccountLoading = false,
  onPaymentAccountAdjusted,
  invoiceNumber,
  onCheckout,
  onPaymobTerminal,
  paymobTerminalLoading = false,
  checkoutLoading,
  checkoutLabel = "Create order",
  canUsePaymobTerminal = false,
  onItemDiscountChange,
  invoiceDiscountType = "fixed",
  setInvoiceDiscountType,
  invoiceDiscountValue = 0,
  setInvoiceDiscountValue,
  invoiceDiscountReason = "",
  setInvoiceDiscountReason,
  invoiceDiscount = 0,
  couponCode = "",
  setCouponCode,
  couponValidation,
  couponLoading = false,
  onApplyCoupon,
  onRemoveCoupon,
  salesEmployees = [],
  sellersLoading = false,
  sellerLoadError = "",
  selectedSalespersonId = "",
  setSelectedSalespersonId,
  onRefreshSellers,
  allowSaleWithoutSalesperson = true,
  canChangeSalesperson = true,
  customerSearch = "",
  setCustomerSearch,
  customers = [],
  selectedCustomerId,
  onSelectCustomer,
  onClearCustomer,
  onCreateCustomerClick,
  filtersModalOpen = false,
}) {
  const [discountLoyaltyOpen, setDiscountLoyaltyOpen] = useState(false);
  const [invoiceDiscountOpen, setInvoiceDiscountOpen] = useState(false);
  const [splitPaymentOpen, setSplitPaymentOpen] = useState(false);
  const [paymentDetailsOpen, setPaymentDetailsOpen] = useState(false);
  const [exchangeOpen, setExchangeOpen] = useState(false);
  const customerWalletBalance = Number(customerCreditBalance || 0);
  const newOrderTotal = Math.max(0, Number(totals?.total || 0));
  const exchangeCreditAmount = Math.max(0, Number(exchangeState?.creditAmount || 0));
  const exchangeAppliedCredit = Math.min(exchangeCreditAmount, newOrderTotal);
  const exchangeCustomerCredit = Math.max(0, exchangeCreditAmount - newOrderTotal);
  const exchangeActive = Boolean(exchangeState?.active && exchangeCreditAmount > 0);
  const totalAmount = Math.max(0, Number(paymentDueAmount ?? Math.max(0, newOrderTotal - exchangeAppliedCredit)));
  const editActive = Boolean(isEditingOrder && editPaymentSummary);
  const hasSelectedCustomer = Boolean(selectedCustomerId || customer?.id || customer?.customer_id);
  const showReturnCreditControl = !editActive && (hasSelectedCustomer || exchangeActive);
  const editRefundOrCreditDue = Math.max(0, Number(editPaymentSummary?.refundOrCreditDue || 0));
  const walletApplicable = Math.max(0, Math.min(customerWalletBalance, totalAmount));
  const customerCreditHelpText = POS_ARABIC_TEXT.customerCreditHelp;
  const appliedCredit = Math.min(Math.max(0, Number(customerWalletAmount || 0)), walletApplicable);
  const methodAmounts = {
    cash: Math.max(0, Number(cashAmount || 0)),
    card: Math.max(0, Number(cardAmount || 0)),
    wallet: Math.max(0, Number(walletAmount || 0)),
    vodafone_cash: Math.max(0, Number(vodafoneCashAmount || 0)),
  };
  const methodTotal = methodAmounts.cash + methodAmounts.card + methodAmounts.wallet + methodAmounts.vodafone_cash;
  const totalPaid = appliedCredit + methodTotal;
  const remainingAmount = Math.max(0, totalAmount - totalPaid);
  const hasPaymentBreakdown = appliedCredit > 0 || methodTotal > 0;
  const paymentMismatch = Math.abs(totalAmount - totalPaid) > 0.009;
  const normalizedPaymentMode = String(paymentMode || "").toLowerCase();
  const selectedMethod = normalizedPaymentMode === "split"
    ? (["cash", "card", "wallet", "vodafone_cash"].includes(activeSplitMethod) ? activeSplitMethod : "cash")
    : normalizedPaymentMode === "instapay"
      ? "wallet"
      : ["cash", "card", "wallet", "vodafone_cash"].includes(normalizedPaymentMode)
        ? normalizedPaymentMode
        : "cash";
  const paymentMethods = [
    { key: "cash", label: "CASH", fullLabel: "CASH", tone: "green", icon: <Banknote className="h-4 w-4" />, setter: setCashAmount },
    { key: "card", label: "VISA", fullLabel: "VISA", tone: "blue", icon: <CreditCard className="h-4 w-4" />, setter: setCardAmount },
    { key: "wallet", paymentMode: "instapay", label: "INSTAPAY", fullLabel: "INSTAPAY", tone: "purple", icon: <Wallet className="h-4 w-4" />, setter: setWalletAmount },
    { key: "vodafone_cash", label: "V.CASH", fullLabel: "V.CASH", tone: "red", icon: <Smartphone className="h-4 w-4" />, setter: setVodafoneCashAmount },
  ];
  const cartHasItems = cart.length > 0;
  const subtotalAmount = Math.max(0, Number(totals?.subtotal || 0));
  const totalDiscountAmount = Number(totals?.itemDiscountTotal || 0) + Number(totals?.invoiceDiscount || 0) + Number(totals?.loyaltyDiscount || 0) + Number(totals?.couponDiscount || 0);
  const activeMethodCount = paymentMethods.filter((method) => methodAmounts[method.key] > 0.009).length;
  const activePaymentMethodCount = activeMethodCount + (appliedCredit > 0.009 ? 1 : 0);
  const walletPaymentUsed = methodAmounts.wallet > 0.009;
  const showOrderSummary = appliedCredit > 0.009 || activeMethodCount > 1 || walletPaymentUsed || remainingAmount > 0.009 || paymentMismatch;
  const hasAccountWarning = Number(paymentAccountStatus?.shortage_amount || 0) > 0 || paymentAccountStatus?.allow_negative_balance === true;
  const shouldShowPaymentDetails = paymentDetailsOpen || activePaymentMethodCount > 1 || (hasPaymentBreakdown && remainingAmount > 0.009) || (hasPaymentBreakdown && paymentMismatch) || hasAccountWarning;
  const clearMethod = (method) => {
    if (method === "cash") setCashAmount(0);
    if (method === "card") setCardAmount(0);
    if (method === "wallet") setWalletAmount(0);
    if (method === "vodafone_cash") setVodafoneCashAmount?.(0);
  };
  const clearPaymentMethods = () => {
    setCashAmount(0);
    setCardAmount(0);
    setWalletAmount(0);
    setVodafoneCashAmount?.(0);
  };
  const setMethodAmount = (method, value, options = {}) => {
    const parsed = Math.max(0, Number(value || 0));
    const otherTotal = Object.entries(methodAmounts)
      .filter(([key]) => key !== method)
      .reduce((sum, [, amount]) => sum + Number(amount || 0), 0);
    const capped = Math.min(parsed, Math.max(0, totalAmount - appliedCredit - otherTotal));
    const setter = paymentMethods.find((item) => item.key === method)?.setter;
    const selected = paymentMethods.find((item) => item.key === method);
    setter?.(Number(capped.toFixed(2)));
    if (options.manual) setPaymentMode?.(appliedCredit > 0 || otherTotal > 0 ? "split" : selected?.paymentMode || method);
  };
  const selectPaymentMethod = (method) => {
    setActiveSplitMethod?.(method);
    const selected = paymentMethods.find((item) => item.key === method);
    const otherTotal = Object.entries(methodAmounts)
      .filter(([key]) => key !== method)
      .reduce((sum, [, amount]) => sum + Number(amount || 0), 0);
    if (appliedCredit <= 0 && methodAmounts[method] <= 0 && otherTotal >= totalAmount - 0.009) {
      paymentMethods.forEach((item) => {
        if (item.key !== method) item.setter(0);
      });
      setMethodAmount(method, totalAmount);
      setPaymentMode?.(selected?.paymentMode || method);
      return;
    }
    const fillAmount = Math.max(0, totalAmount - appliedCredit - otherTotal);
    setMethodAmount(method, fillAmount);
    setPaymentMode?.(appliedCredit > 0 || otherTotal > 0 ? "split" : selected?.paymentMode || method);
  };
  const selectFullPayment = (method) => {
    setActiveSplitMethod?.(method);
    const fullAmount = Number(Math.max(0, totalAmount - appliedCredit).toFixed(2));
    setCashAmount(method === "cash" ? fullAmount : 0);
    setCardAmount(method === "card" ? fullAmount : 0);
    setWalletAmount(method === "wallet" ? fullAmount : 0);
    setVodafoneCashAmount?.(method === "vodafone_cash" ? fullAmount : 0);
    const selected = paymentMethods.find((item) => item.key === method);
    setPaymentMode?.(appliedCredit > 0 ? "split" : selected?.paymentMode || method);
  };
  const openSplitPayment = () => {
    setCustomerWalletAmount?.(0);
    setPaymentMode?.("split");
    setSplitPaymentOpen(true);
  };
  const applyCustomerCredit = () => {
    const credit = Math.min(customerWalletBalance, totalAmount);
    setCustomerWalletAmount?.(credit);
    setCashAmount(0);
    setCardAmount(0);
    setWalletAmount(0);
    setVodafoneCashAmount?.(0);
    setPaymentMode?.(credit >= totalAmount ? "customer_wallet" : "split");
  };

  return (
    <>
    <aside className="pos-cart-panel flex h-full min-w-0 flex-col gap-3 overflow-y-auto overflow-x-hidden xl:min-h-0" dir="auto">
      <InvoiceCustomerPicker
        customerSearch={customerSearch}
        setCustomerSearch={setCustomerSearch}
        customers={customers}
        selectedCustomer={customer}
        selectedCustomerId={selectedCustomerId}
        loyaltyProfile={loyaltyProfile}
        onSelectCustomer={onSelectCustomer}
        onClearCustomer={onClearCustomer}
        onCreateCustomerClick={onCreateCustomerClick}
        onOpenDiscountLoyalty={() => setDiscountLoyaltyOpen(true)}
        salesEmployees={salesEmployees}
        sellersLoading={sellersLoading}
        sellerLoadError={sellerLoadError}
        selectedSalespersonId={selectedSalespersonId}
        setSelectedSalespersonId={setSelectedSalespersonId}
        onRefreshSellers={onRefreshSellers}
        allowSaleWithoutSalesperson={allowSaleWithoutSalesperson}
        canChangeSalesperson={canChangeSalesperson}
        filtersModalOpen={filtersModalOpen}
      />

      <div className="theme-card pos-cart-panel flex min-h-0 flex-1 flex-col overflow-hidden p-3 shadow-xl shadow-[var(--shadow)]">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">Invoice</div>
            <h2 className="text-lg font-black text-white">{cart.length} items</h2>
          </div>
          <button
            type="button"
            onClick={onClear}
            className="theme-button-soft px-3 py-2 text-xs"
          >
            <Trash2 className="h-4 w-4" />
            Clear
          </button>
        </div>

        <div className="mt-2 min-h-[11rem] flex-1 space-y-1.5 overflow-auto pr-1">
          {cart.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface)] p-6 text-center">
              <ReceiptText className="mx-auto h-10 w-10 text-[var(--muted)]" />
              <p className="mt-3 text-sm font-semibold text-[var(--text)]">Cart is empty</p>
              <p className="mt-2 text-xs text-[var(--muted)]">Search products or scan a barcode to start selling.</p>
            </div>
          ) : (
            cart.map((item) => {
              const variantOptions = getCartVariantOptions(item, catalogProducts);
              const colorOptions = getCartColorOptions(variantOptions);
              const sizeOptions = getCartSizeOptions(variantOptions, item.color);
              const currentVariantId = String(item.variant_id ?? item.key ?? "");
              return (
              <div key={String(item.key || item.variant_id)} className="pos-cart-item rounded-xl border border-[var(--border)] bg-[var(--card)] p-1.5" title={item.sku ? `${posLabel("labels.sku", "SKU")} ${item.sku}` : undefined}>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-[var(--surface)] sm:h-12 sm:w-12">
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

                  <div className="min-w-[8rem] flex-[1_1_10rem]">
                    <div className="truncate text-xs font-black leading-5 text-[var(--text)]">{item.name}</div>
                    <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-1">
                      <CartVariantSelect
                        label={posLabel("labels.color", "Color")}
                        value={item.color || ""}
                        disabled={!onVariantChange || colorOptions.length <= 1}
                        options={colorOptions.map((color) => ({
                          value: color.value,
                          label: color.value || posLabel("labels.default", "Default"),
                          disabled: color.stock <= 0,
                          suffix: color.stock <= 0 ? posLabel("labels.outOfStock", "Out") : "",
                        }))}
                        onChange={(color) => {
                          const nextVariant = pickVariantForColor(variantOptions, color, item.size);
                          if (nextVariant) onVariantChange?.(item.key, nextVariant.variant_id ?? nextVariant.id);
                        }}
                      />
                      <span className="text-[var(--muted)]">•</span>
                      <CartVariantSelect
                        label={posLabel("labels.size", "Size")}
                        value={currentVariantId}
                        disabled={!onVariantChange || sizeOptions.length <= 1}
                        options={sizeOptions.map((variant) => {
                          const stock = getVariantStock(variant);
                          return {
                            value: String(variant.variant_id ?? variant.id ?? ""),
                            label: `${variant.size || posLabel("labels.oneSize", "One size")} (${stock})`,
                            disabled: stock <= 0,
                          };
                        })}
                        onChange={(variantId) => onVariantChange?.(item.key, variantId)}
                      />
                    </div>
                  </div>

                  <div className="inline-flex h-8 shrink-0 items-center overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)]">
                    <button
                      type="button"
                      onClick={() => onDecrease(item.key)}
                      className="inline-flex h-8 w-8 items-center justify-center text-[var(--muted)] transition hover:bg-black/20 hover:text-[var(--text)]"
                      aria-label={posLabel("cart.decreaseQuantity", "Decrease quantity")}
                    >
                      <Minus className="h-3.5 w-3.5" />
                    </button>
                    <div className="min-w-8 border-x border-[var(--border)] px-2 text-center text-xs font-black text-[var(--text)]">
                      {item.quantity}
                    </div>
                    <button
                      type="button"
                      onClick={() => onIncrease(item.key)}
                      className="inline-flex h-8 w-8 items-center justify-center text-[var(--muted)] transition hover:bg-black/20 hover:text-[var(--text)]"
                      aria-label={posLabel("cart.increaseQuantity", "Increase quantity")}
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  <label className="inline-flex h-8 w-24 shrink-0 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 text-[var(--text)]">
                    <span className="shrink-0 text-[9px] font-black uppercase tracking-[0.1em] text-[var(--muted)]">
                      {posLabel("cart.discountShort", "Disc")}
                    </span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={item.lineDiscount}
                      onChange={(e) => onItemDiscountChange(item.key, e.target.value)}
                      className="min-w-0 flex-1 bg-transparent text-right text-xs font-black text-[var(--text)] outline-none"
                    />
                  </label>

                  {Number(item.original_price || 0) > Number(item.price || 0) ? (
                    <div className="hidden h-7 shrink-0 items-center gap-1.5 rounded-lg border border-amber-300/20 bg-amber-300/10 px-2 text-[10px] font-black text-[var(--text)] xl:inline-flex">
                      <span className="uppercase tracking-[0.08em] text-amber-200">{item.sale_badge || posLabel("cart.sale", "Sale")}</span>
                      <span className="text-[var(--muted)] line-through">{formatCurrency(item.original_price)}</span>
                    </div>
                  ) : null}

                  <div className="ms-auto inline-flex h-8 shrink-0 items-center rounded-lg border border-[var(--primary)]/20 bg-[var(--primary-soft)] px-2.5 text-xs font-black text-[var(--text)]">
                    {formatCurrency(
                      Math.max(0, item.price * item.quantity - item.lineDiscount * item.quantity)
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => onRemove(item.key)}
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] transition hover:text-[var(--text)]"
                    aria-label={posLabel("cart.removeItem", "Remove item")}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              );
            })
          )}
        </div>

        <div className="sticky bottom-0 mt-2 rounded-xl border border-emerald-300/25 bg-zinc-950/95 px-3 py-2 shadow-[0_-12px_30px_rgba(0,0,0,0.28)] backdrop-blur">
          <div className="space-y-1 text-[11px] font-bold text-zinc-400">
            <div className="flex items-center justify-between gap-3">
              <span>{posLabel("cart.subtotal", "Subtotal")}</span>
              <span className="text-zinc-200 tabular-nums">{formatCurrency(subtotalAmount)}</span>
            </div>
            {totalDiscountAmount > 0 ? (
              <div className="flex items-center justify-between gap-3 text-amber-100">
                <span>{posLabel("cart.discount", "Discount")}</span>
                <span className="tabular-nums">- {formatCurrency(totalDiscountAmount)}</span>
              </div>
            ) : null}
          </div>
          <div className="mt-1.5 flex items-center justify-between gap-3 border-t border-white/10 pt-1.5" dir="auto">
            <span className="text-xs font-black uppercase tracking-[0.18em] text-zinc-400">
              {posLabel("cart.totalAfterDiscount", "Total after discount")}
            </span>
            <span className="text-lg font-black leading-none text-emerald-300 tabular-nums">
              {formatCurrency(totals.total)}
            </span>
          </div>
        </div>

        {editActive ? (
          <EditPaymentDifferenceCard
            alreadyPaid={editPaymentSummary.originalPaidAmount}
            newTotal={editPaymentSummary.newTotal}
            amountDue={editPaymentSummary.amountDueNow}
            refundOrCreditDue={editRefundOrCreditDue}
            invoiceNumber={editPaymentSummary.originalInvoiceNumber}
          />
        ) : null}

        {showOrderSummary ? (
          <OrderSummaryCard
            appliedCredit={appliedCredit}
            methodAmounts={methodAmounts}
            paymentMethods={paymentMethods}
            remainingAmount={remainingAmount}
          />
        ) : null}
      </div>

      <div className="flex min-h-0 flex-col rounded-2xl border border-white/10 bg-zinc-950/90 p-2.5 shadow-xl shadow-black/10 xl:max-h-[calc(100vh-13rem)]">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <div className="text-xs font-black text-white">{posLabel("cart.payment", "Payment")}</div>
            <span className="hidden text-[10px] font-semibold text-zinc-500 sm:inline">{posLabel("cart.checkout", "Checkout")}</span>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {showReturnCreditControl ? (
              <>
                {exchangeActive ? (
                  <button
                    type="button"
                    onClick={onClearExchangeCredit}
                    title={`${exchangeState?.invoiceNumber || exchangeState?.originalOrderId || posLabel("cart.returnCredit", "Return credit")} - ${formatCurrency(exchangeCreditAmount)}`}
                    className="h-7 rounded-lg border border-white/10 bg-black/25 px-2 text-[10px] font-black text-zinc-200 transition hover:bg-white/[0.08]"
                  >
                    {posLabel("actions.clear", "Clear")}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => setExchangeOpen(true)}
                  title={
                    exchangeActive
                      ? `${exchangeState?.invoiceNumber || exchangeState?.originalOrderId || posLabel("cart.returnCredit", "Return credit")} - ${formatCurrency(exchangeCreditAmount)}`
                      : posLabel("cart.exchangeReturnCreditHint", "Scan or select an old invoice to apply return credit.")
                  }
                  className="h-7 rounded-lg border border-amber-300/35 bg-amber-300/10 px-2.5 text-[10px] font-black text-amber-50 transition hover:border-amber-200/60 hover:bg-amber-300/15 hover:shadow-[0_0_16px_rgba(251,191,36,0.18)]"
                >
                  {posLabel("cart.applyReturnCredit", "Apply Return Credit")}
                </button>
              </>
            ) : null}
            <div
              className={`rounded-full px-2 py-1 text-[10px] font-black ${
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
        </div>

        {canUseCustomerCredit ? (
          <div className="mt-2 rounded-xl border border-emerald-400/15 bg-emerald-500/10 px-2.5 py-2">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-[9px] font-black uppercase tracking-[0.12em] text-emerald-200/70">{posLabel("cart.customerWalletBalance", "Customer credit")}</div>
                <div className="text-xs font-black text-emerald-50">{formatCurrency(customerWalletBalance, "ar")}</div>
                <div className="mt-1 grid grid-cols-2 gap-2 text-[10px] font-semibold text-emerald-100/80">
                  <span>{posLabel("cart.creditUsed", "Credit Used")}: {formatCurrency(appliedCredit)}</span>
                  <span>{posLabel("cart.remainingAmount", "Remaining")}: {formatCurrency(remainingAmount)}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={applyCustomerCredit}
                title={customerCreditHelpText}
                className="h-9 shrink-0 rounded-xl border border-emerald-300/25 bg-emerald-400/15 px-3 text-[10px] font-black text-emerald-50"
              >
                {posLabel("cart.applyBalance", "Apply balance")}
              </button>
            </div>
          </div>
        ) : null}

        <div className="mt-2 min-h-0 flex-1 space-y-2 overflow-auto pr-1">
          {exchangeActive ? (
            <ExchangeSummaryCard
              compact
              oldCredit={exchangeCreditAmount}
              newTotal={newOrderTotal}
              amountDue={totalAmount}
              remainingCredit={exchangeCustomerCredit}
              invoiceNumber={exchangeState?.invoiceNumber}
            />
          ) : null}
          {editActive ? (
            <EditPaymentDifferenceCard
              compact
              alreadyPaid={editPaymentSummary.originalPaidAmount}
              newTotal={editPaymentSummary.newTotal}
              amountDue={editPaymentSummary.amountDueNow}
              refundOrCreditDue={editRefundOrCreditDue}
              invoiceNumber={editPaymentSummary.originalInvoiceNumber}
            />
          ) : null}
          <div className="rounded-xl border border-white/10 bg-white/[0.04] p-2">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <div className="text-[10px] font-black uppercase tracking-[0.16em] text-zinc-500">{posLabel("cart.paymentMethods", "Payment Methods")}</div>
              <div className="flex shrink-0 items-center gap-1.5">
                {cartHasItems ? (
                  <button
                    type="button"
                    onClick={() => setInvoiceDiscountOpen(true)}
                    className={`inline-flex h-7 items-center gap-1.5 rounded-lg border px-2 text-[10px] font-black transition ${
                      Number(invoiceDiscount || 0) > 0
                        ? "border-amber-300/35 bg-amber-300/10 text-amber-50 hover:bg-amber-300/15"
                        : "border-white/10 bg-black/20 text-zinc-300 hover:bg-white/[0.08] hover:text-white"
                    }`}
                  >
                    <Percent className="h-3 w-3" />
                    {posLabel("cart.discount", "Discount")}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => setPaymentDetailsOpen((open) => !open)}
                  className="h-7 rounded-lg border border-white/10 bg-black/20 px-2 text-[10px] font-black text-zinc-300 transition hover:bg-white/[0.08] hover:text-white"
                >
                  {posLabel("cart.paymentDetails", "Payment details")}
                </button>
              </div>
            </div>
            <div
              className="pos-payment-method-grid grid w-full min-w-0 gap-2"
              style={{ gridTemplateColumns: "repeat(5, minmax(0, 1fr))" }}
            >
              {paymentMethods.map((method) => (
                <ModeButton
                  key={method.key}
                  active={selectedMethod === method.key}
                  onClick={() => selectFullPayment(method.key)}
                  icon={method.icon}
                  label={method.fullLabel || method.label}
                  tone={method.tone}
                />
              ))}
              <ModeButton
                active={splitPaymentOpen || String(paymentMode || "").toLowerCase() === "split"}
                onClick={openSplitPayment}
                icon={<ReceiptText className="h-4 w-4" />}
                label="SPLIT"
                tone="gold"
              />
            </div>
          </div>

          {shouldShowPaymentDetails ? (
          <div className="rounded-xl border border-white/10 bg-white/[0.04] p-2">
            <div className="mb-2 text-[10px] font-black uppercase tracking-[0.16em] text-zinc-500">{posLabel("cart.paymentBreakdown", "Payment Breakdown")}</div>
            <div className="space-y-1">
              {appliedCredit > 0 ? <BreakdownRow label={posLabel("cart.customerWallet", "Customer credit")} value={appliedCredit} onClear={() => setCustomerWalletAmount?.(0)} /> : null}
              {paymentMethods.map((method) => (
                methodAmounts[method.key] > 0 ? <BreakdownRow key={method.key} label={method.label} value={methodAmounts[method.key]} onClear={() => clearMethod(method.key)} /> : null
              ))}
            </div>
            {paymentMismatch ? (
              <div className="mt-2 rounded-lg border border-amber-300/20 bg-amber-400/10 px-2 py-1.5 text-[10px] font-bold text-amber-100">
                {posLabel("cart.paymentMismatch", "Payment total must equal the invoice total.")} {posLabel("cart.remainingAmount", "Remaining")}: {formatCurrency(remainingAmount)}
              </div>
            ) : (
              <div className="mt-2 rounded-lg border border-emerald-300/15 bg-emerald-400/10 px-2 py-1.5 text-[10px] font-bold text-emerald-100">
                {posLabel("cart.paymentMatched", "Payment matched")}
              </div>
            )}
          </div>
          ) : null}

          {shouldShowPaymentDetails && paymentAccountStatus?.account ? (
            <PaymentAccountPanel status={paymentAccountStatus} loading={paymentAccountLoading} onAdjusted={onPaymentAccountAdjusted} />
          ) : shouldShowPaymentDetails && paymentAccountLoading ? (
            <div className="rounded-lg bg-white/[0.04] px-2 py-1.5 text-[10px] font-bold text-zinc-500">
              Loading mapped account...
            </div>
          ) : null}
        </div>

        <div className="sticky bottom-0 -mx-2.5 -mb-2.5 mt-2 grid grid-cols-2 gap-1.5 border-t border-white/10 bg-zinc-950/95 p-2.5 backdrop-blur">
          <button
            type="button"
            onClick={onPaymobTerminal}
            disabled={!canUsePaymobTerminal || paymobTerminalLoading}
            title={canUsePaymobTerminal ? "Send payment request to Paymob terminal" : "Paymob terminal payment is not ready"}
            className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl border border-cyan-300/20 bg-cyan-400/10 px-3 py-2 text-xs font-black text-cyan-100 transition hover:bg-cyan-400/15 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Smartphone className="h-4 w-4" />
            {paymobTerminalLoading ? "Processing..." : "Paymob Terminal"}
          </button>
          <button
            type="button"
            onClick={onCheckout}
            disabled={checkoutLoading || cart.length === 0 || paymentMismatch}
            title={paymentMismatch ? posLabel("cart.completePaymentFirst", "Remaining must be zero before creating the order.") : undefined}
            className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl bg-emerald-500 px-3 py-2 text-xs font-black text-black transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {checkoutLoading ? posLabel("cart.savingInvoice", "جارٍ حفظ الفاتورة...") : `${checkoutLabel} • ${formatCurrency(totalAmount)}`}
          </button>
        </div>

      </div>
    </aside>
    {discountLoyaltyOpen ? (
      <DiscountLoyaltyModal
        customer={customer}
        couponCode={couponCode}
        setCouponCode={setCouponCode}
        couponValidation={couponValidation}
        couponLoading={couponLoading}
        onApplyCoupon={onApplyCoupon}
        onRemoveCoupon={onRemoveCoupon}
        loyaltyUnavailable={loyaltyUnavailable}
        loyaltyProfile={loyaltyProfile}
        loyaltyRedeemPoints={loyaltyRedeemPoints}
        setLoyaltyRedeemPoints={setLoyaltyRedeemPoints}
        loyaltyDiscount={loyaltyDiscount}
        loyaltyPointsToEarn={loyaltyPointsToEarn}
        loyaltyValidation={loyaltyValidation}
        onClose={() => setDiscountLoyaltyOpen(false)}
      />
    ) : null}
    {invoiceDiscountOpen ? (
      <InvoiceDiscountModal
        subtotal={subtotalAmount}
        type={invoiceDiscountType}
        value={invoiceDiscountValue}
        reason={invoiceDiscountReason}
        amount={Number(totals?.invoiceDiscount || 0)}
        onTypeChange={setInvoiceDiscountType}
        onValueChange={setInvoiceDiscountValue}
        onReasonChange={setInvoiceDiscountReason}
        onClose={() => setInvoiceDiscountOpen(false)}
        onClear={() => {
          setInvoiceDiscountType?.("fixed");
          setInvoiceDiscountValue?.(0);
          setInvoiceDiscountReason?.("");
        }}
      />
    ) : null}
    {splitPaymentOpen && typeof document !== "undefined" ? (
      <SplitPaymentSheet
        totalAmount={totalAmount}
        appliedCredit={appliedCredit}
        methodAmounts={methodAmounts}
        paymentMethods={paymentMethods}
        onClose={() => setSplitPaymentOpen(false)}
        onSetMethodAmount={(method, value) => setMethodAmount(method, value, { manual: true })}
        onFillMethod={selectPaymentMethod}
        onClear={clearPaymentMethods}
      />
    ) : null}
    {exchangeOpen ? (
      <ExchangeCreditModal
        currentTotal={newOrderTotal}
        onClose={() => setExchangeOpen(false)}
        onLookup={onLookupExchangeOrder}
        onApply={(payload) => {
          onApplyExchangeCredit?.(payload);
          setExchangeOpen(false);
        }}
      />
    ) : null}
    </>
  );
}

function InvoiceDiscountModal({
  subtotal = 0,
  type = "fixed",
  value = 0,
  reason = "",
  amount = 0,
  onTypeChange,
  onValueChange,
  onReasonChange,
  onClose,
  onClear,
}) {
  const [draftType, setDraftType] = useState(() => (String(type || "").toLowerCase() === "percentage" ? "percentage" : "fixed"));
  const [draftValue, setDraftValue] = useState(() => Math.max(0, Number(value || 0)));
  const [draftReason, setDraftReason] = useState(() => String(reason || ""));
  const normalizedType = String(draftType || "").toLowerCase() === "percentage" ? "percentage" : "fixed";
  const safeSubtotal = Math.max(0, Number(subtotal || 0));
  const safeValue = Math.max(0, Number(draftValue || 0));
  const previewAmount = Number(Math.min(
    safeSubtotal,
    normalizedType === "percentage" ? safeSubtotal * (Math.min(100, safeValue) / 100) : safeValue
  ).toFixed(2));
  const exceedsSubtotal = normalizedType === "fixed" && safeValue > safeSubtotal + 0.009;
  const exceedsPercentage = normalizedType === "percentage" && safeValue > 100;
  const invalid = exceedsSubtotal || exceedsPercentage;

  const applyDiscount = () => {
    if (invalid) return;
    onTypeChange?.(normalizedType);
    onValueChange?.(safeValue);
    onReasonChange?.(draftReason);
    onClose?.();
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/70 px-3 py-3 backdrop-blur-sm sm:items-center"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-white/10 bg-zinc-950 p-4 text-white shadow-2xl shadow-black/60"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-amber-200">{posLabel("cart.invoiceDiscount", "Invoice Discount")}</div>
            <div className="mt-1 text-xs font-semibold text-zinc-400">{posLabel("cart.subtotal", "Subtotal")}: {formatCurrency(safeSubtotal)}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-zinc-300 transition hover:bg-white/[0.08] hover:text-white"
            aria-label={posLabel("common.close", "Close")}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          {[
            ["fixed", posLabel("cart.fixedAmount", "Fixed amount")],
            ["percentage", posLabel("cart.percentage", "Percentage")],
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                setDraftType(key);
                setDraftValue(key === "percentage" ? Math.min(100, safeValue) : Math.min(safeSubtotal, safeValue));
              }}
              className={`min-h-10 rounded-xl border px-3 text-xs font-black transition ${
                normalizedType === key
                  ? "border-amber-300/50 bg-amber-300/15 text-amber-50 shadow-[0_0_20px_rgba(251,191,36,0.16)]"
                  : "border-white/10 bg-white/[0.04] text-zinc-300 hover:bg-white/[0.08] hover:text-white"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <label className="mt-4 block">
          <span className="text-[10px] font-black uppercase tracking-[0.16em] text-zinc-500">{posLabel("cart.discountValue", "Discount value")}</span>
          <input
            type="number"
            inputMode="decimal"
            min="0"
            max={normalizedType === "percentage" ? 100 : safeSubtotal}
            step="0.01"
            value={draftValue || 0}
            onChange={(event) => {
              const nextValue = Math.max(0, Number(event.target.value || 0));
              setDraftValue(normalizedType === "percentage" ? Math.min(100, nextValue) : Math.min(safeSubtotal, nextValue));
            }}
            className="mt-2 h-12 w-full rounded-xl border border-white/10 bg-black/40 px-3 text-right text-lg font-black text-white outline-none transition focus:border-amber-300/50"
          />
        </label>

        <label className="mt-3 block">
          <span className="text-[10px] font-black uppercase tracking-[0.16em] text-zinc-500">{posLabel("cart.discountReason", "Reason / note")}</span>
          <textarea
            value={draftReason || ""}
            onChange={(event) => setDraftReason(event.target.value)}
            rows={3}
            className="mt-2 w-full resize-none rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm font-semibold text-white outline-none transition placeholder:text-zinc-600 focus:border-amber-300/50"
            placeholder={posLabel("cart.optional", "Optional")}
          />
        </label>

        <div className="mt-4 rounded-2xl border border-white/10 bg-black/25 p-3">
          <BreakdownTotalRow label={posLabel("cart.discount", "Discount")} value={invalid ? amount : previewAmount} tone={invalid ? "amber" : "emerald"} />
          <BreakdownTotalRow label={posLabel("cart.totalAfterDiscount", "Total after discount")} value={Math.max(0, safeSubtotal - (invalid ? amount : previewAmount))} />
          {invalid ? (
            <div className="mt-2 rounded-xl border border-amber-300/20 bg-amber-400/10 px-3 py-2 text-xs font-bold text-amber-100">
              {normalizedType === "percentage"
                ? posLabel("cart.discountPercentLimit", "Percentage discount cannot exceed 100%.")
                : posLabel("cart.discountSubtotalLimit", "Discount cannot exceed subtotal.")}
            </div>
          ) : null}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => {
              setDraftType("fixed");
              setDraftValue(0);
              setDraftReason("");
              onClear?.();
            }}
            className="min-h-12 rounded-2xl border border-white/10 bg-white/[0.04] text-sm font-black text-zinc-200 transition hover:bg-white/[0.08]"
          >
            {posLabel("cart.clearDiscount", "Clear discount")}
          </button>
          <button
            type="button"
            onClick={applyDiscount}
            disabled={invalid}
            className="min-h-12 rounded-2xl bg-amber-400 text-sm font-black text-black transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {posLabel("cart.apply", "Apply")}
          </button>
        </div>
      </div>
    </div>
  );
}

function DiscountLoyaltyModal({
  customer,
  couponCode,
  setCouponCode,
  couponValidation,
  couponLoading,
  onApplyCoupon,
  onRemoveCoupon,
  loyaltyUnavailable,
  loyaltyProfile,
  loyaltyRedeemPoints,
  setLoyaltyRedeemPoints,
  loyaltyDiscount,
  loyaltyPointsToEarn,
  loyaltyValidation,
  onClose,
}) {
  const availablePoints = Number(loyaltyValidation?.available_points ?? loyaltyProfile?.available_points ?? loyaltyProfile?.points ?? customer?.loyalty_points ?? 0);
  const redeemableValue = Number(loyaltyValidation?.redeemable_amount ?? loyaltyValidation?.applied_amount ?? loyaltyDiscount ?? 0);
  const maxRedeemablePoints = Number(loyaltyValidation?.max_redeemable_points ?? availablePoints);
  return (
    <div
      className="fixed inset-0 z-[95] flex items-end justify-center bg-black/70 px-3 py-3 backdrop-blur-sm sm:items-center"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-white/10 bg-zinc-950 p-4 shadow-2xl shadow-black/60"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-violet-200">
              {posLabel("cart.discountsAndLoyalty", "Discounts & Loyalty")}
            </div>
            <div className="mt-1 text-xs font-semibold text-zinc-400">
              {posLabel("cart.couponPlaceholder", "Scan or enter code")}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-zinc-300 transition hover:bg-white/[0.08] hover:text-white"
            aria-label={posLabel("common.close", "Close")}
            title={posLabel("common.close", "Close")}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="mt-4 space-y-3">
          <div className="rounded-2xl border border-violet-400/20 bg-violet-500/10 p-3">
            <div className="text-[10px] uppercase tracking-[0.18em] text-violet-200/75">{posLabel("cart.coupon", "Coupon")}</div>
            <div className="mt-2 flex gap-2">
              <input
                value={couponCode}
                onChange={(event) => setCouponCode?.(event.target.value.toUpperCase())}
                onKeyDown={(event) => {
                  if (event.key === "Enter") onApplyCoupon?.();
                }}
                placeholder={posLabel("cart.couponPlaceholder", "Scan or enter code")}
                className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm font-black uppercase tracking-[0.08em] text-white outline-none placeholder:normal-case placeholder:tracking-normal placeholder:text-zinc-500"
              />
              {couponValidation?.valid ? (
                <button type="button" onClick={onRemoveCoupon} className="rounded-xl border border-rose-300/30 bg-rose-500/15 px-3 text-xs font-black text-rose-100">
                  {posLabel("cart.remove", "Remove")}
                </button>
              ) : (
                <button type="button" disabled={couponLoading || !couponCode} onClick={onApplyCoupon} className="rounded-xl border border-violet-300/30 bg-violet-400/20 px-3 text-xs font-black text-violet-50 disabled:opacity-40">
                  {couponLoading ? "..." : posLabel("cart.apply", "Apply")}
                </button>
              )}
            </div>
            {couponValidation?.valid ? (
              <div className="mt-2 text-xs font-semibold text-violet-100">
                {posLabel("cart.appliedDiscount", "Applied {{amount}} discount.", { amount: formatCurrency(couponValidation.discount_amount || 0) })}
              </div>
            ) : couponValidation?.reason ? (
              <div className="mt-2 text-xs font-semibold text-amber-200">{couponValidation.reason}</div>
            ) : null}
          </div>

          <label className="block space-y-2 rounded-2xl border border-cyan-500/20 bg-cyan-500/10 px-3 py-3 text-sm text-cyan-50">
            <span className="block text-[10px] uppercase tracking-[0.18em] text-cyan-200/70">{posLabel("cart.redeemLoyaltyPoints", "Redeem loyalty points")}</span>
            <div className="grid grid-cols-2 gap-2">
              <PaymentMetric label={posLabel("cart.availablePoints", "Available points")} value={`${availablePoints.toLocaleString()} pts`} tone="white" />
              <PaymentMetric label={posLabel("cart.redeemableValue", "Redeemable value")} value={redeemableValue} tone="emerald" />
            </div>
            <input
              type="number"
              min="0"
              step="1"
              value={loyaltyRedeemPoints}
              onChange={(event) => setLoyaltyRedeemPoints(Math.max(0, Number(event.target.value || 0)))}
              disabled={!customer || loyaltyUnavailable}
              className="w-full bg-transparent text-lg font-black text-white outline-none placeholder:text-cyan-100/60 disabled:opacity-60"
              placeholder="0"
            />
            <button
              type="button"
              onClick={() => setLoyaltyRedeemPoints(Math.max(0, maxRedeemablePoints))}
              disabled={!customer || loyaltyUnavailable || maxRedeemablePoints <= 0}
              className="h-10 rounded-xl border border-cyan-200/25 bg-cyan-300/15 px-3 text-xs font-black text-cyan-50 transition hover:bg-cyan-300/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {posLabel("cart.usePoints", "Use points")}
            </button>
            <div className="mt-1 text-xs text-cyan-100/80">
              {loyaltyUnavailable
                ? posLabel("cart.loyaltyUnavailable", "Loyalty unavailable for this cashier")
                : posLabel("cart.loyaltyEarnPreview", "Discount {{discount}} | Earn {{points}} pts", { discount: formatCurrency(loyaltyDiscount), points: Number(loyaltyPointsToEarn || 0).toLocaleString() })}
            </div>
            {loyaltyValidation && loyaltyValidation.valid === false && Number(loyaltyRedeemPoints || 0) > 0 ? (
              <div className="text-xs font-semibold text-amber-200">
                {posLabel("cart.loyaltyPointsExceeded", "Requested points exceed the current allowed balance.")}
              </div>
            ) : null}
          </label>
        </div>
      </div>
    </div>
  );
}

export function ReceiptPreview({ invoiceNumber, customer, cart, totals, paymentSummary, paymentMode, loyaltyProfile, loyaltyValidation, walletCashbackToEarn = 0, compact = false }) {
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
  const premiumPayment = getLocalizedPaymentLabel(paymentMode, paymentSummary);
  const premiumSocialLinks = useMemo(() => getLocalizedInvoiceSocialLinks(premiumStore), [premiumStore]);
  const premiumDiscount = Number(totals.itemDiscountTotal || 0) + Number(totals.invoiceDiscount || 0) + Number(totals.loyaltyDiscount || 0) + Number(totals.couponDiscount || 0);
  const premiumService = Number(totals.serviceFee || 0);
  const premiumTotalQuantity = cart.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const exchangeMode = Boolean(paymentSummary?.exchangeMode || paymentSummary?.exchangeCreditAmount > 0);
  const exchangeInvoiceNumber = paymentSummary?.exchangeInvoiceNumber || "";
  const exchangeCreditAmount = Math.max(0, Number(paymentSummary?.exchangeCreditAmount || 0));
  const exchangeCustomerCredit = Math.max(0, Number(paymentSummary?.remainingExchangeCustomerCredit || 0));
  const amountPaidNow = Number(paymentSummary?.paidAmount ?? paymentSummary?.amountDueNow ?? 0);
  const walletPaid = Number(paymentSummary?.customerWalletAmount || 0);
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
          <div className="text-xl font-black text-emerald-700">{POS_ARABIC_TEXT.receiptTitle}</div>
          <InvoiceMeta icon={FileText} text={`${POS_ARABIC_TEXT.invoiceNumber}: ${premiumReceiptNumber}`} />
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
        {premiumSeller ? <CustomerLine icon={ShoppingBag}>{POS_ARABIC_TEXT.seller}: {safeArabicText(premiumSeller, premiumSeller)}</CustomerLine> : null}
        <div className="my-1.5 border-t border-dashed border-zinc-300" />
        <CustomerLine icon={CreditCard}>{POS_ARABIC_TEXT.paymentMethod}: {premiumPayment}</CustomerLine>
      </section>

      <section className="mt-2 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm shadow-zinc-100/70">
        <div className="grid grid-cols-[minmax(0,1.5fr)_74px_40px_64px_70px] gap-1 border-b border-zinc-200 bg-zinc-50 px-2 py-1.5 text-[10px] font-black text-zinc-600">
          <div>{POS_ARABIC_TEXT.item}</div>
          <div>{POS_ARABIC_TEXT.sizeColor}</div>
          <div className="text-center">{POS_ARABIC_TEXT.quantity}</div>
          <div className="text-left">السعر</div>
          <div className="text-left">{POS_ARABIC_TEXT.total}</div>
        </div>
        {cart.length === 0 ? (
          <div className="px-2 py-4 text-center text-xs font-semibold text-zinc-500">{POS_ARABIC_TEXT.noItems}</div>
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
                    <div className="truncate font-black text-zinc-950">{safeArabicText(item.name, POS_ARABIC_TEXT.product)}</div>
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
          <SummaryLine label={POS_ARABIC_TEXT.subtotal} value={formatCurrency(totals.subtotal || 0)} />
          {premiumDiscount > 0 ? <SummaryLine label="الخصم" value={`- ${formatCurrency(premiumDiscount)}`} /> : null}
          {premiumService > 0 ? <SummaryLine label={POS_ARABIC_TEXT.service} value={formatCurrency(premiumService)} /> : null}
          <div className="flex items-center justify-between border-t border-zinc-200 pt-2 text-lg font-black text-emerald-700">
            <span>{POS_ARABIC_TEXT.finalTotal}</span>
            <span>{formatCurrency(totals.total || 0)}</span>
          </div>
          {exchangeMode ? (
            <div className="mt-2 space-y-1 rounded-lg border border-amber-200 bg-amber-50 p-2 text-[11px] font-bold text-zinc-800">
              <SummaryLine label="New items total" value={formatCurrency(totals.total || 0)} />
              <SummaryLine label={`Exchange credit from invoice ${exchangeInvoiceNumber || ""}`} value={`- ${formatCurrency(exchangeCreditAmount)}`} />
              <SummaryLine label="Amount paid now" value={formatCurrency(amountPaidNow)} />
              {exchangeCustomerCredit > 0 ? <SummaryLine label="Remaining customer credit / wallet balance" value={formatCurrency(exchangeCustomerCredit)} /> : null}
            </div>
          ) : null}
        </div>
        <div className="space-y-1.5 text-[12px]">
          <MetricLine icon={Package} label="عدد المنتجات" value={cart.length} />
          <MetricLine icon={ShoppingBag} label={POS_ARABIC_TEXT.totalQuantity} value={premiumTotalQuantity} />
        </div>
      </section>

      {walletPaid > 0 ? (
        <section className="mt-2 rounded-xl border border-emerald-200 bg-emerald-50/70 p-3 text-[12px] font-bold text-zinc-800">
          <SummaryLine label={POS_ARABIC_TEXT.walletPaid} value={formatCurrency(walletPaid)} />
          <SummaryLine label={POS_ARABIC_TEXT.walletRemaining} value={formatCurrency(paymentSummary?.remainingCashOrCard || Math.max(0, Number(totals.total || 0) - walletPaid))} />
          <SummaryLine label={POS_ARABIC_TEXT.walletBalanceAfter} value={formatCurrency(walletBalanceAfter)} />
        </section>
      ) : null}

      <section className="mt-2 rounded-xl border border-zinc-200 bg-white p-2 text-center">
        <div className="flex items-center justify-center gap-1.5 text-[10.5px] font-bold leading-relaxed text-zinc-700">
          <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
          <span>{getReturnPolicyText()}</span>
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
            {POS_ARABIC_TEXT.customerService} - {premiumStore.phone}
          </span>
          {premiumPublicUrl ? (
            <span className="ms-1 inline-flex items-center justify-center rounded border border-zinc-200 bg-white p-0.5 align-middle">
              <Suspense fallback={null}>
                <QRCodeSVG value={premiumPublicUrl} size={compact ? 20 : 24} level="M" />
              </Suspense>
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
    "عميل";
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
          {receiptLabel("thankYou", POS_ARABIC_TEXT.thankYou)}
        </div>
        <div className="mt-3 h-px bg-emerald-500" />
      </div>

      <div className={`mt-3 grid gap-x-4 gap-y-1.5 text-[12px] ${compact ? "grid-cols-1" : "grid-cols-2"}`}>
        <div className="space-y-1.5">
          <ReceiptInfo icon={FileText} label={receiptLabel("invoice", POS_ARABIC_TEXT.invoice)} value={invoiceNumber} />
          <ReceiptInfo icon={User} label={receiptLabel("seller", POS_ARABIC_TEXT.seller)} value={sellerName} />
          <ReceiptInfo icon={User} label={receiptLabel("customer", "العميل")} value={customer?.name || receiptLabel("walkIn", "Walk-in Customer")} />
        </div>
        <div className="space-y-1.5">
          <ReceiptInfo icon={Star} label={receiptLabel("tier", "العضوية")} value={tier} />
          <ReceiptInfo icon={CreditCard} label={receiptLabel("payment", POS_ARABIC_TEXT.paymentMethod)} value={paymentSummary.paymentStatus} />
          <ReceiptInfo icon={CalendarDays} label={receiptLabel("date", "التاريخ")} value={receiptDate} />
        </div>
      </div>

      <div className="mt-3 border-y border-dashed border-emerald-300 py-2.5">
        <div className="grid grid-cols-[1fr_38px_66px_72px] gap-2 text-[10px] font-black uppercase tracking-[0.12em] text-emerald-700">
          <div>{receiptLabel("item", POS_ARABIC_TEXT.item)}</div>
          <div className="text-center">{receiptLabel("qty", POS_ARABIC_TEXT.quantity)}</div>
          <div className="text-right">{receiptLabel("price", "السعر")}</div>
          <div className="text-right">{receiptLabel("total", POS_ARABIC_TEXT.total)}</div>
        </div>
        <div className="mt-1.5 space-y-1.5">
        {cart.length === 0 ? (
          <div className="text-sm text-zinc-500">{receiptLabel("noItems", POS_ARABIC_TEXT.noItems)}</div>
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
                      {item.color || receiptLabel("default", POS_ARABIC_TEXT.defaultVariant)} / {item.size || receiptLabel("oneSize", POS_ARABIC_TEXT.oneSize)}
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
          <span>{POS_ARABIC_TEXT.earnedPoints}: {earnedPoints.toLocaleString()}</span>
          <span className="text-emerald-600">|</span>
          <span>{POS_ARABIC_TEXT.usedPoints}: {redeemedPoints.toLocaleString()}</span>
          <span className="text-emerald-600">|</span>
          <span>{POS_ARABIC_TEXT.remainingPoints}: {remainingPoints.toLocaleString()}</span>
          <span className="text-emerald-600">|</span>
          <span>{POS_ARABIC_TEXT.wallet}: {formatCurrency(walletCashback)}</span>
        </div>
      ) : null}

      <div className="mt-3 space-y-1.5 text-[13px]">
        <ReceiptTotalRow label={receiptLabel("subtotal", POS_ARABIC_TEXT.subtotal)} value={formatCurrency(totals.subtotal)} />
        <ReceiptTotalRow label={receiptLabel("discounts", POS_ARABIC_TEXT.discounts)} value={`- ${formatCurrency(totals.itemDiscountTotal + totals.invoiceDiscount)}`} />
        <ReceiptTotalRow label={receiptLabel("loyaltyDiscount", "خصم الولاء")} value={`- ${formatCurrency(totals.loyaltyDiscount || 0)}`} />
        {Number(totals.couponDiscount || 0) > 0 ? <ReceiptTotalRow label="Coupon Discount" value={`- ${formatCurrency(totals.couponDiscount || 0)}`} /> : null}
        <ReceiptTotalRow label={receiptLabel("serviceFee", POS_ARABIC_TEXT.serviceFee)} value={formatCurrency(totals.serviceFee)} />
        <div className="h-px bg-emerald-500" />
        <div className="flex items-end justify-between gap-4 pt-1">
          <span className="text-sm font-black tracking-[0.08em] text-zinc-950">{receiptLabel("total", POS_ARABIC_TEXT.total)}</span>
          <span className="text-xl font-black text-emerald-600">{formatCurrency(totals.total)}</span>
        </div>
      </div>

      <div className="mt-2.5 border-t border-dashed border-emerald-300 pt-2 text-center">
        <div className="text-[11px] font-bold text-zinc-500">{receiptLabel("scanToView", POS_ARABIC_TEXT.scanToView)}</div>
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
          <span className="inline-flex items-center gap-1">
            <Smartphone className="h-3 w-3 text-emerald-600" />
            <span>{POS_ARABIC_TEXT.customerService}</span>
            <span>{store.phone}</span>
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
      <span className="font-black text-zinc-950"><CurrencyText value={value} /></span>
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
      <span className="font-black text-zinc-950"><CurrencyText value={value} /></span>
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
      decoding="async"
      width="64"
      height="64"
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

function InvoiceCustomerPicker({
  customerSearch = "",
  setCustomerSearch,
  customers = [],
  selectedCustomer,
  selectedCustomerId,
  loyaltyProfile,
  onSelectCustomer,
  onClearCustomer,
  onCreateCustomerClick,
  onOpenDiscountLoyalty,
  salesEmployees = [],
  sellersLoading = false,
  sellerLoadError = "",
  selectedSalespersonId = "",
  setSelectedSalespersonId,
  onRefreshSellers,
  allowSaleWithoutSalesperson = true,
  canChangeSalesperson = true,
  filtersModalOpen = false,
}) {
  const [customerSearchActive, setCustomerSearchActive] = useState(false);
  const [activeCustomerIndex, setActiveCustomerIndex] = useState(-1);
  const customerSearchRef = useRef(null);
  const customerSearchWrapRef = useRef(null);
  const safeCustomers = useMemo(() => (Array.isArray(customers) ? customers : []), [customers]);
  const selectedCustomerName = selectedCustomer?.name || selectedCustomer?.customer_name || "";
  const selectedCustomerTier = selectedCustomer?.loyalty_tier || selectedCustomer?.tier || loyaltyProfile?.tier || "";
  const points = Number(loyaltyProfile?.available_points ?? selectedCustomer?.loyalty_points ?? 0);
  const walletBalance = Number(loyaltyProfile?.wallet_balance ?? selectedCustomer?.wallet_balance ?? selectedCustomer?.balance ?? 0);
  const totalOrders = Number(
    loyaltyProfile?.invoices_count ??
      loyaltyProfile?.orders_count ??
      loyaltyProfile?.total_orders ??
      selectedCustomer?.invoices_count ??
      selectedCustomer?.orders_count ??
      selectedCustomer?.total_orders ??
      0
  );
  const normalizedCustomerSearch = String(customerSearch || "").trim().toLowerCase();
  const customerPhoneSearch = normalizePhone(customerSearch);
  const customerMatches = useMemo(
    () =>
      safeCustomers.filter((item) => {
        if (!normalizedCustomerSearch) return true;
        const text = `${item?.name || ""} ${item?.phone || ""} ${item?.mobile || ""} ${item?.whatsapp || ""}`.toLowerCase();
        if (text.includes(normalizedCustomerSearch)) return true;
        if (!customerPhoneSearch.replace(/\D/g, "")) return false;
        return [item?.phone, item?.mobile, item?.whatsapp].some((value) => matchesPhoneSearch(value, customerSearch));
      }),
    [customerPhoneSearch, customerSearch, normalizedCustomerSearch, safeCustomers]
  );
  const showCustomerSuggestions =
    customerSearchActive &&
    !selectedCustomer &&
    String(customerSearch || "").trim().length > 0;

  useEffect(() => {
    const handlePointerDown = (event) => {
      if (customerSearchWrapRef.current?.contains(event.target)) return;
      setCustomerSearchActive(false);
      setActiveCustomerIndex(-1);
    };

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setCustomerSearchActive(false);
        setActiveCustomerIndex(-1);
        customerSearchRef.current?.blur();
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  return (
    <div
      ref={customerSearchWrapRef}
      aria-hidden={filtersModalOpen ? "true" : undefined}
      className={[
        "sticky top-0 z-40 shrink-0 rounded-2xl border border-white/10 bg-zinc-950/95 p-2 shadow-xl shadow-black/30 backdrop-blur-xl",
        filtersModalOpen ? "invisible pointer-events-none opacity-0" : "",
      ].join(" ")}
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div className="text-[10px] font-black uppercase tracking-[0.16em] text-zinc-500">
          {posLabel("cart.customer", "Customer")}
        </div>
        {selectedCustomer ? (
          <div className="flex min-w-0 items-center gap-1.5 text-[10px] font-bold text-emerald-100">
            <Wallet className="h-3 w-3 shrink-0" />
            <span className="truncate">{formatCurrency(walletBalance)}</span>
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-2">
        <div className="relative min-w-0">
          {selectedCustomer ? (
            <div className="flex h-10 w-full min-w-0 items-center gap-2 rounded-xl border border-white/10 bg-black/30 px-2.5 text-xs font-semibold text-white">
              <User className="h-3.5 w-3.5 shrink-0 text-emerald-200" />
              <button
                type="button"
                onClick={() => {
                  onClearCustomer?.();
                  setCustomerSearch?.(selectedCustomerName);
                  setCustomerSearchActive(true);
                  setActiveCustomerIndex(-1);
                  window.setTimeout(() => customerSearchRef.current?.focus(), 0);
                }}
                className="flex min-w-0 flex-1 items-center gap-2 text-left outline-none"
                title={selectedCustomerName}
              >
                <span className="min-w-0 flex-1 truncate" dir="auto">{selectedCustomerName}</span>
                {selectedCustomerTier ? (
                  <span className="hidden max-w-[5rem] shrink-0 truncate rounded-full border border-emerald-300/20 bg-emerald-400/10 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-[0.08em] text-emerald-100 sm:inline">
                    {selectedCustomerTier}
                  </span>
                ) : null}
              </button>
              <button
                type="button"
                onClick={() => {
                  onClearCustomer?.();
                  setCustomerSearch?.("");
                  setCustomerSearchActive(true);
                  setActiveCustomerIndex(-1);
                  window.setTimeout(() => customerSearchRef.current?.focus(), 0);
                }}
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-zinc-400 transition hover:bg-white/10 hover:text-white"
                aria-label={posLabel("customer.change", "Change customer")}
                title={posLabel("customer.change", "Change customer")}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
              <input
                ref={customerSearchRef}
                value={customerSearch}
                onChange={(event) => {
                  setCustomerSearchActive(true);
                  setActiveCustomerIndex(-1);
                  setCustomerSearch?.(event.target.value);
                }}
                onFocus={() => setCustomerSearchActive(true)}
                placeholder={posLabel("customer.searchPlaceholder", "Search customer by name or phone")}
                className="h-10 w-full rounded-xl border border-white/10 bg-black/30 px-9 text-xs font-semibold text-white outline-none transition placeholder:text-zinc-500 focus:border-emerald-400/50 focus:shadow-[0_0_0_3px_rgba(16,185,129,0.12)]"
              />
              {customerSearch ? (
                <button
                  type="button"
                  onClick={() => {
                    onClearCustomer?.();
                    setCustomerSearch?.("");
                    setCustomerSearchActive(true);
                    setActiveCustomerIndex(-1);
                    window.setTimeout(() => customerSearchRef.current?.focus(), 0);
                  }}
                  className="absolute right-2 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-zinc-400 transition hover:bg-white/10 hover:text-white"
                  aria-label={posLabel("customer.change", "Change customer")}
                  title={posLabel("customer.change", "Change customer")}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </>
          )}
        </div>
        <button
          type="button"
          onClick={onOpenDiscountLoyalty}
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-violet-300/25 bg-violet-400/10 text-violet-100 transition hover:border-violet-300/50 hover:bg-violet-400/15"
          aria-label={posLabel("cart.discountsAndLoyalty", "Discounts & Loyalty")}
          title={posLabel("cart.discountsAndLoyalty", "Discounts & Loyalty")}
        >
          <Star className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onCreateCustomerClick}
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-emerald-300/25 bg-emerald-400/10 text-emerald-100 transition hover:border-emerald-300/50 hover:bg-emerald-400/15"
          aria-label={posLabel("customer.add", "Add customer")}
          title={posLabel("customer.add", "Add customer")}
        >
          <UserPlus className="h-4 w-4" />
        </button>
      </div>

      {showCustomerSuggestions ? (
        <div className="absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-2xl border border-white/10 bg-zinc-950 shadow-2xl shadow-black/50 backdrop-blur-xl">
          <div className="max-h-56 overflow-auto p-2">
            {customerMatches.length > 0 ? (
              customerMatches.slice(0, 6).map((item, index) => {
                const itemId = item?.id || item?.customer_id;
                const active = String(selectedCustomerId) === String(itemId);
                const phone = item.phone || item.mobile || item.whatsapp || "No phone";
                return (
                  <button
                    key={String(itemId || `${item.name}-${phone}-${index}`)}
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setActiveCustomerIndex(index)}
                    onClick={(event) => {
                      onSelectCustomer?.(item);
                      setCustomerSearchActive(false);
                      setActiveCustomerIndex(-1);
                      customerSearchRef.current?.blur();
                      event.currentTarget.blur();
                    }}
                    className={`mb-1 w-full rounded-xl border px-3 py-2 text-left transition ${
                      active || activeCustomerIndex === index
                        ? "border-emerald-300/30 bg-emerald-400/10 text-emerald-100"
                        : "border-white/10 bg-white/[0.04] text-white hover:bg-white/[0.08]"
                    }`}
                  >
                    <div className="truncate text-xs font-black" dir="auto">{item.name}</div>
                    <div className="mt-0.5 truncate text-[10px] text-zinc-400">{phone}</div>
                  </button>
                );
              })
            ) : (
              <div className="px-3 py-4 text-xs font-semibold text-zinc-400">{posLabel("customer.noMatch", "No matching customers")}</div>
            )}
          </div>
        </div>
      ) : null}

      {selectedCustomer ? (
        <div className="mt-2 grid grid-cols-3 gap-1.5">
          <CustomerMiniStat label={posLabel("statsCard.wallet", "Wallet")} value={formatCurrency(walletBalance)} />
          <CustomerMiniStat label={posLabel("statsCard.loyalty", "Loyalty")} value={`${points.toLocaleString()} ${posLabel("statsCard.pts", "pts")}`} accent />
          <CustomerMiniStat label={posLabel("statsCard.invoices", "Invoices")} value={totalOrders.toLocaleString()} />
        </div>
      ) : null}

      <div className="mt-1.5 border-t border-white/10 pt-1.5">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
          <div className="inline-flex h-7 shrink-0 items-center gap-1 text-[10px] font-black text-emerald-200/75">
            <span>{posLabel("cart.seller", "Seller")}:</span>
            {!allowSaleWithoutSalesperson && !selectedSalespersonId ? (
              <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[8px] font-black text-amber-100">{posLabel("cart.required", "Required")}</span>
            ) : null}
          </div>
          {allowSaleWithoutSalesperson ? (
            <button
              type="button"
              onClick={() => canChangeSalesperson && setSelectedSalespersonId?.("")}
              disabled={!canChangeSalesperson}
              title={posLabel("cart.noSalesperson", "No salesperson")}
              className={[
                "inline-flex h-7 min-w-10 shrink-0 items-center justify-center rounded-lg border px-2 text-[10px] font-black transition",
                !selectedSalespersonId
                  ? "border-white/20 bg-white text-zinc-950 shadow-[0_8px_18px_rgba(255,255,255,0.1)]"
                  : "border-white/10 bg-black/20 text-zinc-300 hover:bg-white/10",
                !canChangeSalesperson ? "cursor-not-allowed opacity-50" : "",
              ].join(" ")}
            >
              {posLabel("cart.none", "None")}
            </button>
          ) : null}
          {salesEmployees.map((employee) => {
            const active = String(selectedSalespersonId || "") === String(employee.id);
            const disabled = employee.is_active === false;
            const alias = salespersonAlias(employee);
            return (
              <button
                key={employee.id}
                type="button"
                onClick={() => !disabled && canChangeSalesperson && setSelectedSalespersonId?.(String(employee.id))}
                disabled={disabled || !canChangeSalesperson}
                title={`${employee.name || alias}${disabled ? ` - ${posLabel("cart.inactive", "Inactive")}` : ""}`}
                className={[
                  "inline-flex h-7 min-w-10 shrink-0 items-center justify-center rounded-lg border px-2 text-[11px] font-black transition",
                  disabled || !canChangeSalesperson ? "cursor-not-allowed border-white/5 bg-white/[0.03] text-zinc-500 opacity-45" : salespersonAccent(employee),
                  active
                    ? "border-emerald-200/80 bg-emerald-400 text-zinc-950 shadow-[0_8px_18px_rgba(52,211,153,0.2)]"
                    : "",
                ].join(" ")}
              >
                <span dir="auto">{alias || <User className="h-3.5 w-3.5" />}</span>
              </button>
            );
          })}
          {sellersLoading && salesEmployees.length === 0 ? (
            <>
              {[1, 2, 3].map((item) => (
                <div key={item} className="h-7 min-w-10 shrink-0 animate-pulse rounded-lg border border-white/5 bg-white/[0.06]" />
              ))}
            </>
          ) : null}
          {salesEmployees.length === 0 ? (
            <div className="h-7 shrink-0 rounded-lg border border-white/10 bg-black/20 px-2 py-1.5 text-[10px] font-semibold text-zinc-500">
              {sellersLoading
                ? posLabel("cart.loadingSellers", "Loading sellers...")
                : sellerLoadError
                  ? posLabel("cart.sellersRefreshPending", "Seller refresh pending")
                  : posLabel("cart.noActiveSellers", "No active sellers yet")}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function CustomerMiniStat({ label, value, accent = false }) {
  return (
    <div className={`min-w-0 rounded-xl border px-2 py-1.5 ${accent ? "border-emerald-300/20 bg-emerald-400/10" : "border-white/10 bg-black/20"}`}>
      <div className="truncate text-[8px] font-black uppercase tracking-[0.1em] text-zinc-500">{label}</div>
      <div className={`mt-0.5 truncate text-[10px] font-black ${accent ? "text-emerald-100" : "text-white"}`}>{value}</div>
    </div>
  );
}

const normalizeVariantId = (variant = {}) => String(variant.variant_id ?? variant.variantId ?? variant.id ?? "");

const getVariantStock = (variant = {}) => Math.max(0, Number(variant.stock_quantity ?? variant.stock ?? variant.available_quantity ?? 0) || 0);

const variantColor = (variant = {}) => String(variant.color ?? variant.variant_color ?? "").trim();
const variantSize = (variant = {}) => String(variant.size ?? variant.variant_size ?? "").trim();

function getCartVariantOptions(item = {}, catalogProducts = []) {
  const productId = String(item.product_id ?? item.product?.product_id ?? item.product?.id ?? "");
  const catalogProduct = (Array.isArray(catalogProducts) ? catalogProducts : []).find(
    (product) => String(product.product_id ?? product.id ?? "") === productId
  );
  const variants = [
    ...(Array.isArray(item.product?.variants) ? item.product.variants : []),
    ...(Array.isArray(catalogProduct?.variants) ? catalogProduct.variants : []),
    ...(Array.isArray(item.variant_options) ? item.variant_options : []),
  ];
  const seen = new Set();
  return variants
    .filter((variant) => normalizeVariantId(variant))
    .filter((variant) => {
      const id = normalizeVariantId(variant);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
}

function getCartColorOptions(variants = []) {
  const grouped = new Map();
  variants.forEach((variant) => {
    const color = variantColor(variant);
    const current = grouped.get(color) || { value: color, stock: 0 };
    current.stock += getVariantStock(variant);
    grouped.set(color, current);
  });
  return Array.from(grouped.values());
}

function getCartSizeOptions(variants = [], color = "") {
  const colorKey = String(color || "").trim();
  return variants.filter((variant) => variantColor(variant) === colorKey);
}

function pickVariantForColor(variants = [], color = "", preferredSize = "") {
  const colorVariants = getCartSizeOptions(variants, color);
  const preferred = colorVariants.find((variant) => variantSize(variant) === String(preferredSize || "").trim() && getVariantStock(variant) > 0);
  if (preferred) return preferred;
  const numericPreferred = Number(preferredSize);
  const inStock = colorVariants.filter((variant) => getVariantStock(variant) > 0);
  if (!inStock.length) return null;
  if (Number.isFinite(numericPreferred)) {
    return [...inStock].sort((a, b) => Math.abs(Number(variantSize(a)) - numericPreferred) - Math.abs(Number(variantSize(b)) - numericPreferred))[0];
  }
  return inStock[0];
}

function CartVariantSelect({ label, value, options = [], onChange, disabled = false }) {
  return (
    <label className="inline-flex h-6 max-w-[8rem] items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--surface)] px-1.5 text-[10px] font-black text-[var(--text)]">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange?.(event.target.value)}
        disabled={disabled}
        className="min-w-0 max-w-full bg-transparent text-[10px] font-black text-[var(--text)] outline-none disabled:opacity-70"
        title={label}
      >
        {options.map((option) => (
          <option key={option.value || option.label} value={option.value} disabled={option.disabled}>
            {option.suffix ? `${option.label} - ${option.suffix}` : option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function OrderSummaryCard({ appliedCredit, methodAmounts = {}, paymentMethods = [], remainingAmount }) {
  const activeMethods = paymentMethods.filter((method) => Number(methodAmounts[method.key] || 0) > 0.009);
  const paidByMethods = activeMethods.reduce((sum, method) => sum + Number(methodAmounts[method.key] || 0), 0);
  const showMethodLines = appliedCredit > 0.009 || activeMethods.length > 1 || Number(methodAmounts.wallet || 0) > 0.009;
  return (
    <div className="mt-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2">
      <div className="mb-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-zinc-500">{posLabel("cart.orderSummary", "Order Summary")}</div>
      <div className="space-y-1">
        {appliedCredit > 0.009 ? <OrderSummaryRow label={posLabel("cart.creditUsed", "Credit Used")} value={appliedCredit} tone="emerald" /> : null}
        {showMethodLines ? (
          activeMethods.map((method) => (
            <OrderSummaryRow key={method.key} label={method.label} value={methodAmounts[method.key]} tone={method.key === "wallet" ? "emerald" : "white"} />
          ))
        ) : (
          <OrderSummaryRow label={posLabel("cart.paid", "Paid")} value={paidByMethods} tone={paidByMethods > 0 ? "emerald" : "white"} />
        )}
        {remainingAmount > 0.009 ? (
          <OrderSummaryRow label={posLabel("cart.remainingAmount", "Remaining")} value={remainingAmount} tone="amber" />
        ) : null}
      </div>
    </div>
  );
}

function OrderSummaryRow({ label, value, tone = "white" }) {
  const toneClass = tone === "emerald" ? "text-emerald-200" : tone === "amber" ? "text-amber-200" : "text-white";
  return (
    <div className="flex items-center justify-between gap-3 text-xs">
      <span className="min-w-0 truncate font-semibold text-zinc-400">{label}</span>
      <span className={`shrink-0 font-black tabular-nums ${toneClass}`}>{formatCurrency(value)}</span>
    </div>
  );
}

function QuickPaymentButton({ icon, label, onClick, accent = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border px-2 text-xs font-black transition ${
        accent
          ? "border-emerald-300/30 bg-emerald-400/15 text-emerald-50 hover:bg-emerald-400/20"
          : "border-white/10 bg-black/25 text-white hover:bg-white/[0.08]"
      }`}
    >
      {icon}
      <span className="min-w-0 truncate">{label}</span>
    </button>
  );
}

function ExchangeSummaryCard({ oldCredit, newTotal, amountDue, remainingCredit = 0, invoiceNumber = "", compact = false }) {
  return (
    <div className={`mt-2 rounded-xl border border-amber-300/20 bg-amber-400/10 ${compact ? "p-2" : "p-3"}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] font-black uppercase tracking-[0.16em] text-amber-200">
          {posLabel("cart.exchangeSummary", "Exchange Summary")}
        </div>
        {invoiceNumber ? <div className="truncate text-[10px] font-black text-amber-100">{invoiceNumber}</div> : null}
      </div>
      <div className="mt-2 space-y-1 text-xs">
        <BreakdownTotalRow label={posLabel("cart.oldInvoiceCredit", "Old invoice credit")} value={oldCredit} tone="amber" />
        <BreakdownTotalRow label={posLabel("cart.newOrderTotal", "New order total")} value={newTotal} />
        <BreakdownTotalRow label={posLabel("cart.customerPaysNow", "Customer pays now")} value={amountDue} tone={amountDue > 0 ? "emerald" : "white"} />
        {remainingCredit > 0 ? (
          <BreakdownTotalRow label={posLabel("cart.remainingCustomerCredit", "Remaining customer credit / wallet balance")} value={remainingCredit} tone="amber" />
        ) : null}
      </div>
    </div>
  );
}

function EditPaymentDifferenceCard({ alreadyPaid, newTotal, amountDue, refundOrCreditDue = 0, invoiceNumber = "", compact = false }) {
  const noExtraPayment = Number(amountDue || 0) <= 0.009 && Number(refundOrCreditDue || 0) <= 0.009;
  return (
    <div className={`rounded-xl border border-cyan-300/20 bg-cyan-400/10 ${compact ? "p-2" : "mt-2 p-3"}`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-[10px] font-black uppercase tracking-[0.16em] text-cyan-100">
          {posLabel("cart.invoiceEditSummary", "Invoice Edit Summary")}
        </div>
        {invoiceNumber ? <div className="truncate text-[10px] font-black text-cyan-100">{invoiceNumber}</div> : null}
      </div>
      <div className="space-y-1">
        <BreakdownTotalRow label={posLabel("cart.alreadyPaid", "Already paid")} value={alreadyPaid} tone="emerald" />
        <BreakdownTotalRow label={posLabel("cart.newInvoiceTotal", "New invoice total")} value={newTotal} />
        <BreakdownTotalRow label={posLabel("cart.customerPaysNow", "Customer pays now")} value={amountDue} tone={amountDue > 0 ? "amber" : "emerald"} />
        {noExtraPayment ? (
          <div className="rounded-lg border border-emerald-300/20 bg-emerald-400/10 px-2 py-1.5 text-[10px] font-black text-emerald-100">
            {posLabel("cart.noExtraPaymentRequired", "No extra payment required")}
          </div>
        ) : null}
        {refundOrCreditDue > 0 ? (
          <div className="rounded-lg border border-amber-300/20 bg-amber-400/10 px-2 py-1.5 text-[10px] font-black text-amber-100">
            {posLabel("cart.refundCustomerCreditDue", "Refund / customer credit due")}: {formatCurrency(refundOrCreditDue)}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ExchangeCreditModal({ currentTotal, onClose, onLookup, onApply }) {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [order, setOrder] = useState(null);
  const [error, setError] = useState("");
  const credit = Math.max(0, Number(order?.total_amount ?? order?.total ?? order?.total_price ?? 0));
  const amountDue = Math.max(0, Number(currentTotal || 0) - credit);
  const remainingCredit = Math.max(0, credit - Number(currentTotal || 0));

  const lookup = async () => {
    const text = query.trim();
    if (!text) return;
    try {
      setLoading(true);
      setError("");
      const found = onLookup ? await onLookup(text) : null;
      if (!found) {
        setOrder(null);
        setError(posLabel("cart.invoiceNotFound", "Invoice not found or not eligible."));
        return;
      }
      setOrder(found);
    } catch (err) {
      setOrder(null);
      setError(err?.message || posLabel("cart.invoiceLookupFailed", "Unable to load invoice."));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-end justify-center bg-black/70 p-3 backdrop-blur-sm sm:items-center">
      <section className="w-full max-w-md rounded-3xl border border-white/10 bg-zinc-950 p-4 text-white shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-amber-200">{posLabel("cart.exchangeReturnCredit", "Exchange / Return Credit")}</div>
            <h3 className="mt-1 text-xl font-black">{posLabel("cart.scanOriginalInvoice", "Scan original invoice")}</h3>
          </div>
          <button type="button" onClick={onClose} className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04]">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-4 flex gap-2">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") lookup();
            }}
            autoFocus
            placeholder="INV-123"
            className="h-12 min-w-0 flex-1 rounded-2xl border border-white/10 bg-black/40 px-3 text-sm font-black text-white outline-none focus:border-amber-300/50"
          />
          <button type="button" onClick={lookup} disabled={loading} className="h-12 rounded-2xl bg-amber-300 px-4 text-sm font-black text-black disabled:opacity-50">
            {loading ? posLabel("actions.loading", "Loading") : posLabel("actions.lookup", "Lookup")}
          </button>
        </div>
        {error ? <div className="mt-3 rounded-xl border border-rose-300/20 bg-rose-400/10 px-3 py-2 text-xs font-bold text-rose-100">{error}</div> : null}
        {order ? (
          <div className="mt-4">
            <ExchangeSummaryCard
              oldCredit={credit}
              newTotal={currentTotal}
              amountDue={amountDue}
              remainingCredit={remainingCredit}
              invoiceNumber={order.invoice_number || order.public_order_number || order.id}
            />
            <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.04] p-3">
              <div className="text-[10px] font-black uppercase tracking-[0.16em] text-zinc-500">{posLabel("cart.eligibleReturnedItems", "Eligible returned items")}</div>
              <div className="mt-2 max-h-36 space-y-1 overflow-auto">
                {(order.items || []).map((item) => (
                  <div key={item.id || item.product_name} className="flex justify-between gap-3 rounded-lg bg-black/20 px-2 py-1.5 text-xs">
                    <span className="truncate text-zinc-200">{item.product_name || item.name}</span>
                    <span className="shrink-0 font-black text-white">{Number(item.quantity || 0).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>
            <button
              type="button"
              onClick={() => onApply?.({
                active: true,
                originalOrderId: order.id,
                invoiceNumber: order.invoice_number || order.public_order_number || String(order.id),
                creditAmount: credit,
              })}
              className="mt-4 h-12 w-full rounded-2xl bg-emerald-500 text-sm font-black text-black"
            >
              {posLabel("cart.applyExchangeCredit", "Apply exchange credit")}
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function SplitPaymentSheet({
  totalAmount,
  appliedCredit,
  methodAmounts,
  paymentMethods,
  onClose,
  onSetMethodAmount,
  onFillMethod,
  onClear,
}) {
  const methodsTotal = paymentMethods.reduce((sum, method) => sum + Number(methodAmounts[method.key] || 0), 0);
  const splitTotalPaid = Number(methodsTotal.toFixed(2));
  const splitRemaining = Math.max(0, Number(totalAmount || 0) - splitTotalPaid);
  const splitOverpaid = Math.max(0, splitTotalPaid - Number(totalAmount || 0));
  const isMatched = splitRemaining <= 0.009 && splitOverpaid <= 0.009 && Math.abs(splitTotalPaid - Number(totalAmount || 0)) <= 0.009;
  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-4">
      <section className="flex max-h-[92vh] w-full max-w-lg flex-col rounded-t-3xl border border-white/10 bg-zinc-950 p-4 text-white shadow-2xl shadow-black/60 sm:rounded-3xl" dir="auto">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-emerald-200">{posLabel("cart.splitPayment", "Split Payment")}</div>
            <h3 className="mt-1 text-xl font-black">{posLabel("cart.orderTotal", "Order Total")}: {formatCurrency(totalAmount)}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-zinc-300 transition hover:bg-white/[0.08] hover:text-white"
            aria-label={posLabel("actions.close", "Close")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2">
          <PaymentMetric label={posLabel("cart.total", "Total")} value={totalAmount} />
          <PaymentMetric label={posLabel("cart.paid", "Paid")} value={splitTotalPaid} tone={splitTotalPaid > 0 ? "emerald" : "white"} />
          <PaymentMetric label={posLabel("cart.remainingAmount", "Remaining")} value={splitOverpaid > 0 ? splitOverpaid : splitRemaining} tone={splitOverpaid > 0 || splitRemaining > 0 ? "amber" : "emerald"} />
        </div>

        <div className="mt-4 min-h-0 flex-1 space-y-2 overflow-auto pr-1">
          {paymentMethods.map((method) => {
            const otherTotal = paymentMethods
              .filter((item) => item.key !== method.key)
              .reduce((sum, item) => sum + Number(methodAmounts[item.key] || 0), 0);
            const maxValue = Math.max(0, Number(totalAmount || 0) - Number(appliedCredit || 0) - otherTotal);
            return (
              <div key={method.key} className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)_auto] items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] p-2">
                <div className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-white/10 bg-black/25 px-3 text-sm font-black text-white">
                  <span className={PAYMENT_TONE_CLASSES[method.tone]?.icon || PAYMENT_TONE_CLASSES.green.icon}>{method.icon}</span>
                  <span className="truncate">{method.label}</span>
                </div>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  max={maxValue}
                  step="0.01"
                  value={methodAmounts[method.key] || 0}
                  onChange={(event) => onSetMethodAmount(method.key, event.target.value)}
                  className="h-12 min-w-0 rounded-xl border border-white/10 bg-black/40 px-3 text-right text-base font-black text-white outline-none transition focus:border-emerald-300/50"
                />
                <button
                  type="button"
                  onClick={() => onFillMethod(method.key)}
                  className="h-12 rounded-xl border border-emerald-300/20 bg-emerald-400/10 px-3 text-xs font-black text-emerald-50 transition hover:bg-emerald-400/15"
                >
                  {posLabel("cart.fill", "Fill")}
                </button>
              </div>
            );
          })}
        </div>

        <div className="mt-4 rounded-2xl border border-white/10 bg-black/25 p-3">
          <BreakdownTotalRow label={posLabel("cart.totalPaid", "Total Paid")} value={splitTotalPaid} />
          <BreakdownTotalRow label={posLabel("cart.remainingAmount", "Remaining")} value={splitOverpaid > 0 ? splitOverpaid : splitRemaining} tone={splitOverpaid > 0 || splitRemaining > 0 ? "amber" : "emerald"} />
          {!isMatched ? (
            <div className="mt-2 rounded-xl border border-amber-300/20 bg-amber-400/10 px-3 py-2 text-xs font-bold text-amber-100">
              {splitOverpaid > 0
                ? posLabel("cart.splitOverpaidWarning", "Total paid cannot exceed the order total.")
                : posLabel("cart.emptySplitWarning", "Complete the split so remaining reaches zero before creating the order.")}
            </div>
          ) : null}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onClear}
            className="min-h-12 rounded-2xl border border-white/10 bg-white/[0.04] text-sm font-black text-zinc-200 transition hover:bg-white/[0.08]"
          >
            {posLabel("actions.clear", "Clear")}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={!isMatched}
            className="min-h-12 rounded-2xl bg-emerald-500 text-sm font-black text-black transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isMatched ? posLabel("cart.done", "Done") : posLabel("cart.remainingAmount", "Remaining")}
          </button>
        </div>
      </section>
    </div>,
    document.body
  );
}

const PAYMENT_TONE_CLASSES = {
  green: {
    button: "border-emerald-400/40 text-emerald-50 hover:border-emerald-300/70 hover:bg-emerald-400/10 hover:shadow-[0_0_18px_rgba(52,211,153,0.22)]",
    active: "border-emerald-300/90 bg-emerald-400/15 text-emerald-50 shadow-[0_0_24px_rgba(52,211,153,0.32)] scale-[1.02]",
    icon: "text-emerald-300",
    check: "bg-emerald-300 text-black",
  },
  blue: {
    button: "border-blue-400/40 text-blue-50 hover:border-blue-300/70 hover:bg-blue-400/10 hover:shadow-[0_0_18px_rgba(96,165,250,0.22)]",
    active: "border-blue-300/90 bg-blue-400/15 text-blue-50 shadow-[0_0_24px_rgba(96,165,250,0.32)] scale-[1.02]",
    icon: "text-blue-300",
    check: "bg-blue-300 text-black",
  },
  purple: {
    button: "border-purple-400/40 text-purple-50 hover:border-purple-300/70 hover:bg-purple-400/10 hover:shadow-[0_0_18px_rgba(192,132,252,0.22)]",
    active: "border-purple-300/90 bg-purple-400/15 text-purple-50 shadow-[0_0_24px_rgba(192,132,252,0.32)] scale-[1.02]",
    icon: "text-purple-300",
    check: "bg-purple-300 text-black",
  },
  red: {
    button: "border-red-500/40 text-red-50 hover:border-red-400/75 hover:bg-red-500/10 hover:shadow-[0_0_18px_rgba(220,38,38,0.24)]",
    active: "border-red-400/90 bg-red-500/15 text-red-50 shadow-[0_0_24px_rgba(220,38,38,0.34)] scale-[1.02]",
    icon: "text-red-400",
    check: "bg-red-400 text-black",
  },
  gold: {
    button: "border-amber-400/40 text-amber-50 hover:border-amber-300/70 hover:bg-amber-400/10 hover:shadow-[0_0_18px_rgba(251,191,36,0.22)]",
    active: "border-amber-300/90 bg-amber-400/15 text-amber-50 shadow-[0_0_24px_rgba(251,191,36,0.32)] scale-[1.02]",
    icon: "text-amber-300",
    check: "bg-amber-300 text-black",
  },
};

function ModeButton({ active, onClick, icon, label, tone = "green", title = "" }) {
  const toneClasses = PAYMENT_TONE_CLASSES[tone] || PAYMENT_TONE_CLASSES.green;
  return (
    <button
      type="button"
      onClick={onClick}
      title={title || undefined}
      className={`relative inline-flex h-7 w-full min-w-0 items-center justify-center gap-1 rounded-lg border bg-black/25 px-2 text-xs font-black transition duration-200 ${active ? toneClasses.active : toneClasses.button}`}
    >
      {active ? (
        <span className={`absolute right-0.5 top-0.5 inline-flex h-3 w-3 items-center justify-center rounded-full ${toneClasses.check}`}>
          <CheckCircle2 className="h-2 w-2" />
        </span>
      ) : null}
      <span className={`${toneClasses.icon} [&>svg]:h-3 [&>svg]:w-3`}>{icon}</span>
      <span className="min-w-0 overflow-hidden truncate whitespace-nowrap">{label}</span>
    </button>
  );
}

function PaymentMetric({ label, value, tone = "white" }) {
  const toneClass = tone === "emerald" ? "text-emerald-200" : tone === "amber" ? "text-amber-200" : "text-white";
  const displayValue = typeof value === "string" ? value : formatCurrency(value);
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-white/[0.04] px-2 py-1.5">
      <span className="text-[10px] font-black uppercase tracking-[0.12em] text-zinc-500">{label}</span>
      <span className={`text-sm font-black tabular-nums ${toneClass}`}>{displayValue}</span>
    </div>
  );
}

function BreakdownRow({ label, value, onClear }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg bg-black/20 px-2 py-1.5 text-xs">
      <span className="min-w-0 truncate font-bold text-zinc-200">{label}</span>
      <span className="ms-auto shrink-0 font-black text-white tabular-nums">{formatCurrency(value)}</span>
      {onClear ? (
        <button
          type="button"
          onClick={onClear}
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-white/10 bg-white/[0.04] text-zinc-400 transition hover:bg-white/[0.08] hover:text-white"
          aria-label="Clear payment amount"
        >
          <X className="h-3 w-3" />
        </button>
      ) : null}
    </div>
  );
}

function BreakdownTotalRow({ label, value, tone = "white" }) {
  const toneClass = tone === "emerald" ? "text-emerald-200" : tone === "amber" ? "text-amber-200" : "text-white";
  return (
    <div className="flex items-center justify-between gap-3 px-1 py-1 text-xs">
      <span className="font-black text-zinc-400">{label}</span>
      <span className={`font-black tabular-nums ${toneClass}`}>{formatCurrency(value)}</span>
    </div>
  );
}

function PaymentAccountPanel({ status, loading = false, onAdjusted }) {
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustAmount, setAdjustAmount] = useState("");
  const [adjustNotes, setAdjustNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const account = status?.account || {};
  const balance = Number(status?.available_balance ?? account.current_balance ?? 0);
  const isIncoming = status?.direction === "in" || status?.requires_balance === false;
  const shortage = isIncoming ? 0 : Number(status?.shortage_amount || 0);
  const isInsufficient = shortage > 0 && status?.allow_negative_balance !== true;
  const isNegative = balance < 0;
  const isLow = !isIncoming && !isNegative && !isInsufficient && balance > 0 && balance < Number(status?.amount || 0) * 1.25;
  const tone = isIncoming || (!isInsufficient && !isNegative && !isLow) ? "emerald" : isLow ? "amber" : "rose";
  const toneClasses = {
    emerald: "bg-emerald-500/10 text-emerald-100 ring-emerald-400/15",
    amber: "bg-amber-400/10 text-amber-100 ring-amber-300/20",
    rose: "bg-rose-400/10 text-rose-100 ring-rose-300/25",
  };
  const dotClasses = {
    emerald: "bg-emerald-300",
    amber: "bg-amber-300",
    rose: "bg-rose-300",
  };
  const fallback = Array.isArray(status?.fallback_accounts) ? status.fallback_accounts[0] : null;
  const requiredAmount = Number(status?.amount || 0);
  const accountName = safeArabicText(account.name, POS_ARABIC_TEXT.accountSelected) || "-";
  const fallbackName = safeArabicText(fallback?.name, POS_ARABIC_TEXT.account) || "";
  if (isIncoming) {
    return (
      <div className={`mt-2 rounded-xl border px-2.5 py-2 ${toneClasses.emerald}`}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-[9px] font-black uppercase tracking-[0.12em] opacity-70">
              {loading ? "Checking account" : "Destination treasury account"}
            </div>
            <div className="mt-0.5 truncate text-xs font-black">
              {status.payment_method?.replaceAll("_", " ") || "Payment"} -&gt; {accountName}
            </div>
          </div>
          <div className="shrink-0 text-right text-xs font-black tabular-nums">
            {formatCurrency(balance)}
          </div>
        </div>
      </div>
    );
  }
  const statusText = shortage > 0
    ? `الرصيد غير كاف (العجز: ${formatCurrency(shortage, "ar")})`
    : `${accountName} • ${formatCurrency(balance, "ar")}`;

  const submitAdjustment = async (event) => {
    event.preventDefault();
    if (!account.id || Number(adjustAmount) <= 0) {
      toast.error("Enter a positive recharge amount");
      return;
    }
    try {
      setSaving(true);
      await accountingApi.createManualMoneyAdjustment({
        account_id: account.id,
        direction: "in",
        amount: adjustAmount,
        notes: adjustNotes || `POS recharge for ${accountName}`,
      });
      toast.success("Treasury adjustment recorded");
      setAdjustAmount("");
      setAdjustNotes("");
      setAdjustOpen(false);
      onAdjusted?.();
    } catch (error) {
      toast.error(error?.message || "Failed to record adjustment");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <details className="group relative mt-1.5">
        <summary
          className={`flex min-h-8 cursor-pointer list-none items-center gap-2 rounded-lg px-2 py-1 text-[11px] font-black ring-1 transition marker:hidden hover:bg-white/[0.07] ${toneClasses[tone]}`}
          title={loading ? "Checking account" : "Mapped treasury account"}
        >
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClasses[tone]}`} />
          <span className="min-w-0 flex-1 truncate">{loading ? "Checking account..." : statusText}</span>
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setAdjustOpen(true);
            }}
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-white/8 text-white transition hover:bg-white/15"
            aria-label="Recharge treasury account"
            title="Recharge / adjustment"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </summary>
        <div className="hidden rounded-b-lg bg-black/25 px-2.5 py-2 text-[10px] font-bold leading-5 text-zinc-200 ring-1 ring-white/10 group-open:grid sm:absolute sm:inset-x-0 sm:top-[calc(100%+0.25rem)] sm:z-30 sm:rounded-lg sm:shadow-xl sm:shadow-black/30 sm:group-hover:grid">
          <div className="flex justify-between gap-2">
            <span className="text-zinc-500">{POS_ARABIC_TEXT.required}</span>
            <span className="tabular-nums">{formatCurrency(requiredAmount, "ar")}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-zinc-500">{POS_ARABIC_TEXT.available}</span>
            <span className="tabular-nums">{formatCurrency(balance, "ar")}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-zinc-500">{POS_ARABIC_TEXT.shortage}</span>
            <span className={shortage > 0 ? "tabular-nums text-rose-200" : "tabular-nums"}>{formatCurrency(shortage, "ar")}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-zinc-500">{POS_ARABIC_TEXT.account}</span>
            <span className="truncate text-right">{accountName}</span>
          </div>
          {status.allow_negative_balance && shortage > 0 ? <div className="text-amber-100">مسموح بالسالب لهذا الحساب.</div> : null}
          {!status.allow_negative_balance && fallback ? <div className="text-emerald-100">يوجد رصيد كاف في {fallbackName}</div> : null}
        </div>
      </details>

      {adjustOpen ? (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/70 px-3 py-3 sm:items-center">
          <form onSubmit={submitAdjustment} className="w-full max-w-sm rounded-2xl border border-white/10 bg-zinc-950 p-4 shadow-2xl shadow-black/50">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[10px] font-black uppercase tracking-[0.14em] text-zinc-500">Treasury adjustment</div>
                <div className="mt-1 truncate text-sm font-black text-white">{accountName}</div>
              </div>
              <button
                type="button"
                onClick={() => setAdjustOpen(false)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-white transition hover:bg-white/10"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-4 grid gap-2">
              <input
                className="h-10 rounded-xl border border-white/10 bg-white/5 px-3 text-sm font-bold text-white outline-none placeholder:text-zinc-500 focus:border-emerald-300/60"
                type="number"
                min="0"
                step="0.01"
                value={adjustAmount}
                onChange={(event) => setAdjustAmount(event.target.value)}
                placeholder="Recharge amount"
              />
              <input
                className="h-10 rounded-xl border border-white/10 bg-white/5 px-3 text-sm font-bold text-white outline-none placeholder:text-zinc-500 focus:border-emerald-300/60"
                value={adjustNotes}
                onChange={(event) => setAdjustNotes(event.target.value)}
                placeholder="Audit note"
              />
              <button
                type="submit"
                disabled={saving}
                className="mt-1 h-10 rounded-xl bg-emerald-400 px-3 text-sm font-black text-emerald-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? "Saving..." : "Record recharge"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}

function AmountField({ label, value, onChange, max, title = "", helper = "", placeholder = "" }) {
  const hasMax = Number.isFinite(Number(max));
  return (
    <label className="block rounded-xl border border-white/10 bg-white/5 px-2 py-1.5" title={title || undefined}>
      <div className="text-[9px] font-black uppercase tracking-[0.12em] text-zinc-500">{label}</div>
      <input
        type="number"
        min="0"
        max={hasMax ? Number(max) : undefined}
        step="0.01"
        value={value}
        placeholder={placeholder === "" ? undefined : String(placeholder)}
        onChange={(e) => {
          const parsed = Number(e.target.value || 0);
          onChange(hasMax ? Math.min(Math.max(0, parsed), Number(max)) : parsed);
        }}
        className="mt-0.5 w-full bg-transparent text-sm font-black text-white outline-none"
      />
      {helper ? <div className="mt-0.5 truncate text-[9px] font-semibold text-zinc-500">{helper}</div> : null}
    </label>
  );
}

export default CartSidebar;
