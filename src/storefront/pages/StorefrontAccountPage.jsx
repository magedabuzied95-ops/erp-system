import { Component, useCallback, useEffect, useId, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import toast from "react-hot-toast";
import i18n from "../../i18n/i18n";
import { sfText } from "../lib/sfText";
import { orderDueOnDelivery } from "../lib/checkoutGuards";
import { api } from "../../shared/api/api";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  Crown,
  Eye,
  EyeOff,
  Gem,
  Heart,
  Loader2,
  LogOut,
  MapPin,
  MessageCircle,
  PackageCheck,
  PackageSearch,
  PackageX,
  RefreshCcw,
  Ruler,
  ShieldCheck,
  ShoppingBag,
  Truck,
  UserRound,
} from "lucide-react";
import { RecentProductsSection } from "../Storefront";
import { ROOT_PATHS, productPath } from "../lib/paths";
import {
  clearStorefrontCustomerAuth,
  normalizeStorefrontCustomerPhone,
  readStorefrontCustomerAuth,
  storeStorefrontCustomerAuth,
  storefrontCustomerRequest,
} from "../lib/storefrontCustomerAuth";
import { storefrontAuthErrorCopy, trackingStageKey } from "../lib/serverCopy";
import { localizeColorName, localizeSizeLabel } from "../lib/displayCopy";
import "./account.css";

// A failed auth request in the shopper's language: the server's code picks the copy, never its message.
const toastAuthError = (error, fallbackKey) => {
  const { key, options } = storefrontAuthErrorCopy(error, fallbackKey);
  toast.error(sfText(key, undefined, options));
};

/*
 * The account page (/account) in the homepage look: every colour is a `--m1h-*` token
 * (site-skin.css) and the shared `sfx-*` primitives (site-skin.css, catalog-skin.css) do the look;
 * `sfa-*` classes only lay the page out, clear of the legacy `sf-account-*` hooks that
 * index.css and storefront-light.css still paint gold-on-black with !important.
 */

const STOREFRONT_PROFILE_KEY = "storefront.profile";
// The checkout fills itself from the last order placed on this device. Signing out has to
// take that with it, or the next person to use the browser is handed someone's home address.
const STOREFRONT_LAST_CHECKOUT_KEY = "storefront.checkout.lastDetails";
const ORDERS_PREVIEW_COUNT = 5;
const WISHLIST_PREVIEW_COUNT = 4;

// Orders that left the happy path read red; a finished one reads green.
const DERAILED_STATUSES = new Set(["cancelled", "canceled", "cancelled_by_customer", "returned", "failed_delivery", "rejected"]);
const FINISHED_STATUSES = new Set(["delivered", "completed"]);

const orderTone = (order = {}) => {
  const values = [order.status, order.shipping_status, order.shipment_status].map((value) => String(value || "").trim().toLowerCase());
  if (values.some((value) => DERAILED_STATUSES.has(value))) return "bad";
  if (values.some((value) => FINISHED_STATUSES.has(value))) return "good";
  return "";
};

// Literal keys, so the missing-key guard can see every one of them.
const SIZE_FIELDS = [
  { key: "men", label: () => sfText("storefront.account.sizeMen", "رجالي") },
  { key: "women", label: () => sfText("storefront.account.sizeWomen", "حريمي") },
  { key: "kids", label: () => sfText("storefront.account.sizeKids", "أطفال") },
  { key: "crocs", label: () => sfText("storefront.account.sizeCrocs", "كروكس") },
];

const GUEST_PERKS = [
  { key: "orders", Icon: Truck, label: () => sfText("storefront.account.perkOrders", "تابع طلباتك وأعد طلبها بضغطة") },
  { key: "wishlist", Icon: Heart, label: () => sfText("storefront.account.perkWishlist", "مفضلتك محفوظة على أي جهاز") },
  { key: "points", Icon: Gem, label: () => sfText("storefront.account.perkPoints", "اجمع نقاط مع كل طلب") },
];

const storefrontAsyncDebugLog = (label, payload = {}) => {
  if (!import.meta.env.DEV) return;
  console.log(label, payload);
};

const normalizePhoneDigits = (value = "") => String(value ?? "").replace(/\D/g, "");

const normalizeAccountIdentity = (value = {}) => ({
  full_name: String(value?.full_name || "").trim(),
  primary_phone: normalizePhoneDigits(value?.primary_phone || value?.phone || value?.customer_phone || ""),
  phone: normalizePhoneDigits(value?.phone || value?.primary_phone || value?.customer_phone || ""),
  customer_id: String(value?.customer_id || value?.id || "").trim(),
});

const normalizeStorefrontProfile = (value = {}) => {
  const profile = value && typeof value === "object" ? value : {};
  const primaryPhone = String(profile.primary_phone || profile.phone || profile.customer_phone || "").trim();
  const customerId = String(profile.customer_id || profile.id || "").trim();
  return {
    ...profile,
    full_name: String(profile.full_name || "").trim(),
    primary_phone: primaryPhone,
    phone: String(profile.phone || primaryPhone || "").trim(),
    customer_id: customerId,
  };
};

const defaultPreferredSizes = () => ({
  men: "",
  women: "",
  kids: "",
  crocs: "",
});

const normalizePreferredSizes = (value = {}) => {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    men: String(source.men || source.male || source["رجالي"] || source.man || source.men_size || source.size_men || "").trim(),
    women: String(source.women || source.female || source["حريمي"] || source.women_size || source.size_women || "").trim(),
    kids: String(source.kids || source.children || source["أطفال"] || source["اطفال"] || source.kids_size || source.size_kids || "").trim(),
    crocs: String(source.crocs || source.crocs_size || source.size_crocs || "").trim(),
  };
};

const clearAccountIdentityStorage = () => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STOREFRONT_PROFILE_KEY);
    window.localStorage.removeItem(STOREFRONT_LAST_CHECKOUT_KEY);
  } catch {
    // Ignore storage errors.
  }
};

const initialOf = (name = "") => {
  const letter = String(name || "").trim().charAt(0);
  return letter ? letter.toLocaleUpperCase(i18n.language || "ar") : "";
};

const scrollToSection = (id) => {
  if (typeof document === "undefined") return;
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
};

function AccountField({ label, value, onChange, type = "text", inputMode, autoComplete, ltr = false, hint = "" }) {
  const id = useId();
  const [revealed, setRevealed] = useState(false);
  const isPassword = type === "password";
  return (
    <div className="sfx-form-row sfa-field">
      <label htmlFor={id} className="sfx-label">{label}</label>
      <div className="sfa-field__control">
        <input
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          type={isPassword && revealed ? "text" : type}
          inputMode={inputMode}
          autoComplete={autoComplete}
          dir={ltr ? "ltr" : undefined}
          className={`sfx-input${isPassword ? " sfa-input--with-toggle" : ""}`}
        />
        {isPassword ? (
          <button
            type="button"
            onClick={() => setRevealed((current) => !current)}
            className="sfa-field__toggle"
            aria-label={revealed ? sfText("storefront.account.hidePassword", "إخفاء كلمة المرور") : sfText("storefront.account.showPassword", "إظهار كلمة المرور")}
            aria-pressed={revealed}
          >
            {revealed ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
          </button>
        ) : null}
      </div>
      {hint ? <p className="sfx-help">{hint}</p> : null}
    </div>
  );
}

// The header's logo, drawn in ink for the light page: the M1 mark keeps its turning M,
// another brand shows its own logo, and a store without one keeps the person icon.
function BrandMark({ brandName = "", brandLogoUrl = "", imageFor = (value) => value }) {
  const [failed, setFailed] = useState(false);
  const isMOne = /(?:^|\s)m\s*(?:1|one)(?:\s|$)/i.test(String(brandName || "").trim()) || /\/branding\/m-one-/.test(String(brandLogoUrl || ""));
  if (isMOne) {
    return (
      <span className="sfa-brand sfa-brand--mone">
        <img src="/branding/m-one-logo-dark-fixed.png?v=20260716" alt={brandName || "M1 Store"} className="sfa-brand__layer" decoding="async" width="120" height="125" />
        <img src="/branding/m-one-logo-dark-m.png?v=20260716" alt="" aria-hidden="true" className="sfa-brand__layer sf-header-logo-moving-m" decoding="async" width="120" height="125" />
      </span>
    );
  }
  if (brandLogoUrl && !failed) {
    return (
      <span className="sfa-brand">
        <img src={imageFor(brandLogoUrl)} alt={brandName} className="sfa-brand__img" decoding="async" onError={() => setFailed(true)} />
      </span>
    );
  }
  return <span className="sfa-guest__icon" aria-hidden="true"><UserRound className="h-6 w-6" /></span>;
}

function SubmitButton({ onClick, disabled, busy, busyLabel, children, variant = "primary" }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={`sfx-btn sfx-btn--${variant} sfx-btn--lg sfx-btn--block`}>
      {busy ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          {busyLabel}
        </>
      ) : children}
    </button>
  );
}

function AnimatedPoints({ value }) {
  const [display, setDisplay] = useState(Number(value || 0));
  const displayRef = useRef(Number(value || 0));

  useEffect(() => {
    const start = Number(displayRef.current || 0);
    const end = Number(value || 0);
    if (start === end) return undefined;
    const startedAt = performance.now();
    const duration = 700;
    let frame = 0;
    const tick = (now) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      const nextDisplay = Math.round(start + (end - start) * eased);
      displayRef.current = nextDisplay;
      setDisplay(nextDisplay);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);

  return Number(display || 0).toLocaleString(i18n.language || "en");
}

function MembershipCard({ loyalty, loading }) {
  if (loading && !loyalty) {
    return <div id="sfa-membership" className="sfx-invert sfa-member sfa-member--loading" aria-busy="true" />;
  }
  const points = Number(loyalty?.points ?? loyalty?.available_points ?? 0);
  const tier = loyalty?.tier || "Bronze";
  const nextTier = loyalty?.next_tier || "Platinum";
  const remaining = Number(loyalty?.points_to_next_tier || 0);
  const progress = Math.max(0, Math.min(100, Number(loyalty?.progress || 0)));

  return (
    <section id="sfa-membership" className="sfx-invert sfa-member">
      <div className="sfa-member__top">
        <div className="sfa-member__title">
          <Gem className="h-4 w-4" aria-hidden="true" />
          {sfText("storefront.account.membershipTitle", "عضوية M1")}
        </div>
        <span className="sfa-member__tier">
          <Crown className="h-3.5 w-3.5" aria-hidden="true" />
          {tier}
        </span>
      </div>
      <div className="sfa-member__points">
        <span className="sfa-member__value"><AnimatedPoints value={points} /></span>
        <span className="sfa-member__unit">{sfText("storefront.account.points", "نقطة")}</span>
      </div>
      <div
        className="sfa-member__bar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress)}
        aria-label={sfText("storefront.account.loyaltyBalance", "رصيد الولاء")}
      >
        <span style={{ width: `${progress}%` }} />
      </div>
      <p className="sfa-member__note">
        {remaining > 0
          ? sfText("storefront.account.pointsToNextTier", "{{count}} نقطة للترقية إلى {{tier}}", {
              count: remaining.toLocaleString(i18n.language || "en"),
              tier: nextTier,
            })
          : sfText("storefront.account.topTierReached", "وصلت لأعلى مستوى")}
      </p>
    </section>
  );
}

function OrderDetails({ data, helpers }) {
  const { money, imageFor, fallbackProductImage, paymentCopy, shippingProviderCopy, statusCopy, supportHref, displayOrderNumber } = helpers;
  if (data.loading) {
    return (
      <div className="sfa-order__details" aria-busy="true">
        <div className="sfx-skel sfa-skeleton" style={{ height: 120 }} />
      </div>
    );
  }
  const order = data.order || {};
  const items = Array.isArray(data.items) ? data.items : [];
  const timeline = Array.isArray(data.timeline) ? data.timeline : [];
  const derailed = orderTone(order) === "bad";
  const currentIndex = timeline.reduce((last, step, index) => (step.done ? index : last), 0);
  const remaining = orderDueOnDelivery(order);

  return (
    <div className="sfa-order__details">
      {derailed ? (
        <div className="sfx-notice sfx-notice--danger">
          <PackageX className="h-5 w-5 shrink-0" aria-hidden="true" />
          <p>{sfText("storefront.tracking.derailedText", "لو عندك أي استفسار كلّمنا على واتساب وهنساعدك.")}</p>
        </div>
      ) : timeline.length ? (
        <ol className="sfa-steps" aria-label={sfText("storefront.orders.tracking", "تتبع الطلب")}>
          {timeline.map((step, index) => {
            const state = index < currentIndex ? "done" : index === currentIndex ? "current" : "todo";
            return (
              <li key={step.key || step.label} className={`sfa-step sfa-step--${state}`} aria-current={state === "current" ? "step" : undefined}>
                <span className="sfa-step__dot" aria-hidden="true">
                  {state === "done" ? <Check className="h-3 w-3" /> : null}
                </span>
                <span className="sfa-step__label">{trackingStageKey(step) ? sfText(trackingStageKey(step), step.label) : step.label}</span>
              </li>
            );
          })}
        </ol>
      ) : null}

      <dl className="sfa-facts">
        <div>
          <dt>{sfText("storefront.checkout.paymentMethod", "طريقة الدفع")}</dt>
          <dd>{paymentCopy(order.payment_method)}</dd>
        </div>
        <div>
          <dt>{sfText("storefront.checkout.shipping", "الشحن")}</dt>
          <dd>{`${shippingProviderCopy(order.shipping_provider)} - ${statusCopy(order.shipping_status)}`}</dd>
        </div>
        {remaining > 0 ? (
          <div>
            <dt>{sfText("storefront.account.remainingOnDelivery", "المطلوب عند الاستلام")}</dt>
            <dd>{money(remaining)}</dd>
          </div>
        ) : null}
      </dl>

      {items.length ? (
        <ul className="sfa-items">
          {items.map((item) => (
            <li key={item.id || `${item.product_id}-${item.variant_id}`} className="sfa-item">
              <img src={imageFor(item.product_image || item.image_url)} onError={fallbackProductImage} alt="" className="sfa-item__img" loading="lazy" decoding="async" width="52" height="52" />
              <div className="min-w-0 flex-1">
                <div className="sfa-item__name">{item.product_name || item.name}</div>
                <div className="sfa-item__meta">
                  {[localizeColorName(item.color, i18n.language), localizeSizeLabel(item.size, i18n.language)].filter(Boolean).join(" / ")} × {item.quantity}
                </div>
              </div>
              <div className="sfa-item__price">{money(item.total_amount || Number(item.price || item.sale_price || 0) * Number(item.quantity || 1))}</div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="sfx-muted">{sfText("storefront.orders.itemsLoading", "سيظهر ملخص المنتجات هنا بعد تحميل تفاصيل الطلب.")}</p>
      )}

      <a href={supportHref(displayOrderNumber(order))} className="sfa-link" target="_blank" rel="noreferrer">
        <MessageCircle className="h-4 w-4" aria-hidden="true" />
        {sfText("storefront.support.needHelpWhatsapp", "تحتاج مساعدة؟ تواصل معنا على واتساب")}
      </a>
    </div>
  );
}

function OrderRow({ order, phone, open, details, onToggle, onReorder, helpers }) {
  const { displayOrderNumber, formatDate, statusCopy, money } = helpers;
  const publicNumber = displayOrderNumber(order);
  const tone = orderTone(order);
  const [reordering, setReordering] = useState(false);
  const reorder = async () => {
    setReordering(true);
    try {
      await onReorder(open && details?.items?.length ? { ...order, items: details.items } : order);
    } catch {
      toast.error(sfText("storefront.toasts.reorderUnavailable", "هذه المنتجات غير متاحة حاليًا. جرّب اختيارات أخرى."));
    } finally {
      setReordering(false);
    }
  };

  return (
    <li className={`sfa-order${open ? " is-open" : ""}`}>
      <div className="sfa-order__head">
        <div className="min-w-0">
          <div className="sfa-order__number" dir="ltr">{publicNumber}</div>
          <div className="sfa-order__date">{formatDate(order.created_at)}</div>
        </div>
        <span className={`sfx-badge sfx-badge--${tone === "good" ? "success" : tone === "bad" ? "danger" : "accent"}`}>{statusCopy(order.status)}</span>
      </div>
      <div className="sfa-order__foot">
        <div className="sfa-order__total">{money(order.total_amount || order.total || order.total_price)}</div>
        <div className="sfa-order__actions">
          <button type="button" onClick={() => onToggle(order)} className="sfx-btn sfx-btn--ghost sfx-btn--sm" aria-expanded={open}>
            {open ? sfText("storefront.account.hideDetails", "إخفاء التفاصيل") : sfText("storefront.orders.orderDetails", "تفاصيل الطلب")}
            <ChevronDown className={`h-4 w-4 sfa-chevron${open ? " is-open" : ""}`} aria-hidden="true" />
          </button>
          <Link to={`/track?order=${encodeURIComponent(publicNumber)}&phone=${encodeURIComponent(phone)}`} className="sfx-btn sfx-btn--secondary sfx-btn--sm">
            {sfText("storefront.orders.trackOrder", "تتبع الطلب")}
          </Link>
          <button type="button" onClick={reorder} disabled={reordering} className="sfx-btn sfx-btn--primary sfx-btn--sm">
            {reordering ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCcw className="h-3.5 w-3.5" aria-hidden="true" />}
            {sfText("storefront.orders.reorder", "إعادة الطلب")}
          </button>
        </div>
      </div>
      {open && details ? <OrderDetails data={details} helpers={helpers} /> : null}
    </li>
  );
}

function SectionHead({ Icon, title, subtitle, action = null, count = null }) {
  return (
    <div className="sfa-card__head">
      <span className="sfa-card__icon" aria-hidden="true"><Icon className="h-[18px] w-[18px]" /></span>
      <div className="min-w-0 flex-1">
        <h2 className="sfx-h2 sfa-card__title">
          {title}
          {count !== null ? <span className="sfx-badge" dir="ltr">{count}</span> : null}
        </h2>
        {subtitle ? <p className="sfa-card__subtitle">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

function StorefrontAccountPageContent({
  profile = {},
  setProfile = () => {},
  wishlist = [],
  recent = [],
  onAddToCart = () => {},
  toggleWishlist,
  saleModeEnabled,
  helpers = {},
  initialAuthMode = "login",
}) {
  const {
    sfText = (_key, fallback = "") => fallback,
    displayOrderNumber = (value) => String(value?.id || value?.order_number || ""),
  } = helpers;
  const safeProfile = profile && typeof profile === "object" ? profile : {};
  const savedIdentity = normalizeAccountIdentity(safeProfile);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [customerAuth, setCustomerAuth] = useState(() => readStorefrontCustomerAuth());
  const [phone, setPhone] = useState(customerAuth.phone || savedIdentity.primary_phone || "");
  const [authMode, setAuthMode] = useState(() => (initialAuthMode === "reset" ? "reset" : "login"));
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authConfirmPassword, setAuthConfirmPassword] = useState("");
  const [authFullName, setAuthFullName] = useState(savedIdentity.full_name || "");
  const [resetToken, setResetToken] = useState(() => searchParams.get("token") || "");
  const [resetPassword, setResetPassword] = useState("");
  const [resetPasswordConfirm, setResetPasswordConfirm] = useState("");
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const [account, setAccount] = useState(null);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [loading, setLoading] = useState(false);
  const [requestingOtp, setRequestingOtp] = useState(false);
  const [verifyingOtp, setVerifyingOtp] = useState(false);
  const [savingPreferences, setSavingPreferences] = useState(false);
  const [otpRequestedAt, setOtpRequestedAt] = useState(0);
  const [resendCountdown, setResendCountdown] = useState(0);
  const [otpPanelOpen, setOtpPanelOpen] = useState(false);
  const [preferredSizes, setPreferredSizes] = useState(() => defaultPreferredSizes());
  const accountRefreshIntervalMs = selectedOrder ? 10 * 1000 : 30 * 1000;
  const hasCustomerToken = Boolean(customerAuth.token);
  const normalizedLoginPhone = normalizePhoneDigits(phone);
  const resetTokenFromQuery = searchParams.get("token") || "";
  const isResetMode = initialAuthMode === "reset" || Boolean(resetTokenFromQuery) || authMode === "reset";
  const hasResetToken = Boolean(String(resetToken || resetTokenFromQuery || "").trim());

  useEffect(() => {
    if (initialAuthMode === "reset" || resetTokenFromQuery) {
      setAuthMode("reset");
    }
    if (resetTokenFromQuery) {
      setResetToken(resetTokenFromQuery);
    }
  }, [initialAuthMode, resetTokenFromQuery]);

  useEffect(() => {
    if (hasCustomerToken) {
      setOtpPanelOpen(false);
    }
  }, [hasCustomerToken]);

  useEffect(() => {
    if (customerAuth.phone || !savedIdentity.primary_phone) return;
    setPhone(savedIdentity.primary_phone);
  }, [customerAuth.phone, savedIdentity.primary_phone]);

  useEffect(() => {
    if (savedIdentity.full_name && !authFullName) {
      setAuthFullName(savedIdentity.full_name);
    }
  }, [authFullName, savedIdentity.full_name]);

  useEffect(() => {
    if (!otpRequestedAt) {
      setResendCountdown(0);
      return undefined;
    }
    const tick = () => {
      const elapsed = Math.floor((Date.now() - otpRequestedAt) / 1000);
      setResendCountdown(Math.max(0, 60 - elapsed));
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [otpRequestedAt]);

  const clearCustomerIdentity = useCallback(() => {
    clearStorefrontCustomerAuth();
    clearAccountIdentityStorage();
    setCustomerAuth({ token: "", phone: "" });
    setPhone("");
    setAuthEmail("");
    setAuthPassword("");
    setAuthConfirmPassword("");
    setAuthFullName("");
    setResetToken("");
    setResetPassword("");
    setResetPasswordConfirm("");
    setAuthMode("login");
    setOtpCode("");
    setOtpRequestedAt(0);
    setResendCountdown(0);
    setAccount(null);
    setSelectedOrder(null);
    setLoading(false);
    setRequestingOtp(false);
    setVerifyingOtp(false);
    setSavingPreferences(false);
    setPreferredSizes(defaultPreferredSizes());
    setProfile((prev) => ({
      ...prev,
      full_name: "",
      primary_phone: "",
      phone: "",
      customer_id: "",
    }));
  }, [setProfile]);

  const invalidateCustomerIdentity = useCallback(() => {
    clearCustomerIdentity();
    toast.error(sfText("storefront.auth.sessionExpired"));
  }, [clearCustomerIdentity]);

  const load = useCallback(async ({ silent = false } = {}) => {
    const { token, phone: storedPhone } = readStorefrontCustomerAuth();
    if (!token) return null;
    const requestPhone = normalizePhoneDigits(storedPhone || phone);
    setLoading(true);
    try {
      const data = await storefrontCustomerRequest("/storefront/account");
      let preferencesPayload = null;
      try {
        preferencesPayload = await storefrontCustomerRequest("/storefront/customer/preferences");
      } catch (preferencesError) {
        if (!import.meta.env.DEV) {
          preferencesPayload = null;
        } else {
          console.log("[storefront-account] preferences load failed", {
            message: preferencesError?.message || String(preferencesError),
            status: Number(preferencesError?.status || preferencesError?.response?.status || 0),
          });
        }
      }
      setAccount(data);
      setProfile((prev) => ({
        ...prev,
        primary_phone: requestPhone || prev.primary_phone || "",
        phone: requestPhone || prev.phone || "",
        customer_id: data.customer?.id || prev.customer_id || prev.id || "",
        full_name: data.customer?.name || prev.full_name || "",
      }));
      setPreferredSizes(
        normalizePreferredSizes(
          preferencesPayload?.preferences ||
            data.preferences ||
            data.customer?.preferred_sizes ||
            defaultPreferredSizes()
        )
      );
      setCustomerAuth({ token, phone: requestPhone || storedPhone || "" });
      return data;
    } catch (error) {
      const status = Number(error?.status || error?.response?.status || 0);
      if (status === 401 || status === 403) {
        invalidateCustomerIdentity();
      }
      if (!silent) {
        toast.error(sfText("storefront.toasts.accountUnavailable", "لا يمكن فتح الحساب الآن."));
      }
      return null;
    } finally {
      setLoading(false);
    }
  }, [invalidateCustomerIdentity, phone, setProfile, sfText]);

  useEffect(() => {
    if (!customerAuth.token) {
      setAccount(null);
      setSelectedOrder(null);
      return undefined;
    }
    if (account || loading) return undefined;
    load({ silent: true });
    return undefined;
  }, [account, customerAuth.token, load, loading]);

  useEffect(() => {
    if (!account || !hasCustomerToken) return undefined;
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return undefined;
    const id = window.setInterval(() => {
      storefrontCustomerRequest("/storefront/account")
        .then((data) => setAccount(data))
        .catch((error) => {
          const status = Number(error?.status || error?.response?.status || 0);
          if (status === 401 || status === 403) {
            invalidateCustomerIdentity();
          }
        });
    }, accountRefreshIntervalMs);
    return () => window.clearInterval(id);
  }, [account, accountRefreshIntervalMs, hasCustomerToken, invalidateCustomerIdentity]);

  useEffect(() => {
    if (!account || !hasCustomerToken || typeof document === "undefined") return undefined;
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      storefrontCustomerRequest("/storefront/account")
        .then((data) => setAccount(data))
        .catch((error) => {
          const status = Number(error?.status || error?.response?.status || 0);
          if (status === 401 || status === 403) {
            invalidateCustomerIdentity();
          }
        });
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [account, hasCustomerToken, invalidateCustomerIdentity]);

  const requestOtp = useCallback(async () => {
    const normalizedPhone = normalizeStorefrontCustomerPhone(phone);
    if (normalizedPhone.length < 10) {
      toast.error(sfText("storefront.auth.invalidPhone"));
      return;
    }
    setRequestingOtp(true);
    try {
      await storefrontCustomerRequest("/storefront/auth/request-otp", {
        method: "POST",
        body: { phone: normalizedPhone },
      });
      setOtpRequestedAt(Date.now());
      setOtpCode("");
      toast.success(sfText("storefront.auth.otpSent"));
    } catch (error) {
      toastAuthError(error, "storefront.auth.otpSendFailed");
    } finally {
      setRequestingOtp(false);
    }
  }, [phone]);

  const verifyOtp = useCallback(async () => {
    const normalizedPhone = normalizeStorefrontCustomerPhone(phone);
    const otp = String(otpCode || "").replace(/\D/g, "").slice(0, 6);
    if (normalizedPhone.length < 10) {
      toast.error(sfText("storefront.auth.invalidPhone"));
      return;
    }
    if (otp.length !== 6) {
      toast.error(sfText("storefront.auth.otpLengthHint"));
      return;
    }
    setVerifyingOtp(true);
    try {
      const data = await storefrontCustomerRequest("/storefront/auth/verify-otp", {
        method: "POST",
        body: { phone: normalizedPhone, otp },
      });
      const token = String(data?.token || "").trim();
      const customerPhone = normalizeStorefrontCustomerPhone(data?.customer?.phone || normalizedPhone);
      if (token) {
        storeStorefrontCustomerAuth({ token, phone: customerPhone || normalizedPhone });
      }
      setCustomerAuth(readStorefrontCustomerAuth());
      setOtpRequestedAt(0);
      setResendCountdown(0);
      setOtpCode("");
      setAccount(null);
      toast.success(sfText("storefront.auth.loginSuccess"));
      await load({ silent: true });
    } catch (error) {
      toastAuthError(error, "storefront.auth.otpInvalid");
    } finally {
      setVerifyingOtp(false);
    }
  }, [load, otpCode, phone]);

  const syncEmailAuthResponse = useCallback((data, fallbackPhone = "") => {
    const token = String(data?.token || "").trim();
    const customer = data?.customer || {};
    const customerPhone = normalizeStorefrontCustomerPhone(customer?.phone || fallbackPhone || phone || "");
    if (token) {
      storeStorefrontCustomerAuth({ token, phone: customerPhone || fallbackPhone || phone || "" });
    }
    setCustomerAuth(readStorefrontCustomerAuth());
    if (customer && typeof customer === "object") {
      setProfile((prev) =>
        normalizeStorefrontProfile({
          ...prev,
          full_name: String(customer.name || prev.full_name || authFullName || "").trim(),
          primary_phone: customerPhone || prev.primary_phone || phone || "",
          phone: customerPhone || prev.phone || phone || "",
          customer_id: String(customer.id || customer.customer_id || prev.customer_id || "").trim(),
        })
      );
    }
    setPhone(customerPhone || fallbackPhone || phone || "");
    return { token, customerPhone };
  }, [authFullName, phone, setProfile]);

  const submitEmailAuthRegister = useCallback(async () => {
    const email = String(authEmail || "").trim();
    const name = String(authFullName || "").trim();
    const normalizedPhone = normalizeStorefrontCustomerPhone(phone);
    const password = String(authPassword || "");
    const confirm = String(authConfirmPassword || "");
    if (!name || !email || !normalizedPhone || !password) {
      toast.error(sfText("storefront.auth.registerFieldsRequired"));
      return;
    }
    if (password.length < 8) {
      toast.error(sfText("storefront.auth.passwordTooShort"));
      return;
    }
    if (password !== confirm) {
      toast.error(sfText("storefront.auth.passwordMismatch"));
      return;
    }
    setAuthSubmitting(true);
    try {
      const data = await storefrontCustomerRequest("/storefront/auth/register", {
        method: "POST",
        body: {
          name,
          email,
          phone: normalizedPhone,
          password,
        },
      });
      syncEmailAuthResponse(data, normalizedPhone);
      setAuthMode("login");
      setAuthPassword("");
      setAuthConfirmPassword("");
      setResetToken("");
      setResetPassword("");
      setResetPasswordConfirm("");
      setSearchParams({});
      setAccount(null);
      toast.success(sfText("storefront.auth.registerSuccess"));
      await load({ silent: true });
    } catch (error) {
      toastAuthError(error, "storefront.auth.registerFailed");
    } finally {
      setAuthSubmitting(false);
    }
  }, [authConfirmPassword, authEmail, authFullName, authPassword, load, phone, setSearchParams, syncEmailAuthResponse]);

  const submitEmailAuthLogin = useCallback(async () => {
    const email = String(authEmail || "").trim();
    const password = String(authPassword || "");
    if (!email || !password) {
      toast.error(sfText("storefront.auth.loginFieldsRequired"));
      return;
    }
    setAuthSubmitting(true);
    try {
      const data = await storefrontCustomerRequest("/storefront/auth/login", {
        method: "POST",
        body: {
          email,
          password,
        },
      });
      syncEmailAuthResponse(data);
      setAuthMode("login");
      setAccount(null);
      setAuthPassword("");
      toast.success(sfText("storefront.auth.loginSuccess"));
      await load({ silent: true });
    } catch (error) {
      toastAuthError(error, "storefront.auth.loginInvalid");
    } finally {
      setAuthSubmitting(false);
    }
  }, [authEmail, authPassword, load, syncEmailAuthResponse]);

  const requestPasswordReset = useCallback(async () => {
    const email = String(authEmail || "").trim();
    if (!email) {
      toast.error(sfText("storefront.auth.emailRequired"));
      return;
    }
    setAuthSubmitting(true);
    try {
      await storefrontCustomerRequest("/storefront/auth/request-reset", {
        method: "POST",
        body: { email },
      });
      setAuthMode("forgot");
      toast.success(sfText("storefront.auth.resetLinkSent"));
    } catch (error) {
      toastAuthError(error, "storefront.auth.resetSendFailed");
    } finally {
      setAuthSubmitting(false);
    }
  }, [authEmail]);

  const submitPasswordReset = useCallback(async () => {
    const token = String(resetToken || resetTokenFromQuery || "").trim();
    const password = String(resetPassword || "");
    const confirm = String(resetPasswordConfirm || "");
    if (!token) {
      toast.error(sfText("storefront.auth.resetLinkInvalid"));
      return;
    }
    if (!password || password.length < 8) {
      toast.error(sfText("storefront.auth.passwordTooShort"));
      return;
    }
    if (password !== confirm) {
      toast.error(sfText("storefront.auth.passwordMismatch"));
      return;
    }
    setAuthSubmitting(true);
    try {
      await storefrontCustomerRequest("/storefront/auth/reset-password", {
        method: "POST",
        body: { token, password },
      });
      toast.success(sfText("storefront.auth.passwordUpdated"));
      setAuthMode("login");
      setResetPassword("");
      setResetPasswordConfirm("");
      setResetToken("");
      setSearchParams({});
      navigate("/account", { replace: true });
    } catch (error) {
      toastAuthError(error, "storefront.auth.passwordUpdateFailed");
    } finally {
      setAuthSubmitting(false);
    }
  }, [navigate, resetPassword, resetPasswordConfirm, resetToken, resetTokenFromQuery, setSearchParams]);

  const updatePreferredSize = useCallback((key, value) => {
    setPreferredSizes((prev) => ({
      ...prev,
      [key]: String(value || "").trim(),
    }));
  }, []);

  const savePreferredSizes = useCallback(async () => {
    if (!hasCustomerToken) {
      toast.error(sfText("storefront.auth.loginToSaveSizes"));
      return;
    }
    setSavingPreferences(true);
    try {
      const response = await storefrontCustomerRequest("/storefront/customer/preferences", {
        method: "PUT",
        body: { preferred_sizes: preferredSizes },
      });
      setPreferredSizes(normalizePreferredSizes(response?.preferences || preferredSizes));
      toast.success(sfText("storefront.account.sizesSaved"));
    } catch (error) {
      if (Number(error?.status || error?.response?.status || 0) === 401) {
        toast.error(sfText("storefront.auth.signInAgain"));
        return;
      }
      toast.error(sfText("storefront.account.sizesSaveFailed"));
    } finally {
      setSavingPreferences(false);
    }
  }, [hasCustomerToken, preferredSizes]);

  const loadProductsForReorder = useCallback(async (items = []) => {
    const uniqueProductIds = [...new Set(
      (Array.isArray(items) ? items : [])
        .map((item) => String(item?.product_id || "").trim())
        .filter(Boolean)
    )];
    storefrontAsyncDebugLog("[storefront-reorder-batch-count]", { count: uniqueProductIds.length });
    if (!uniqueProductIds.length) return new Map();
    const responses = await Promise.allSettled(
      uniqueProductIds.map((productId) => api.get(`/storefront/products/${encodeURIComponent(productId)}`))
    );
    return responses.reduce((map, response, index) => {
      if (response.status !== "fulfilled") return map;
      const product = response.value?.product;
      if (product) map.set(uniqueProductIds[index], product);
      return map;
    }, new Map());
  }, []);

  const openOrder = useCallback(async (order) => {
    setSelectedOrder({ loading: true, order, items: [], timeline: [] });
    try {
      const data = await storefrontCustomerRequest("/storefront/track", {
        params: {
          order_number: displayOrderNumber(order),
          ...(customerAuth.phone ? { phone: customerAuth.phone } : {}),
        },
      });
      setSelectedOrder(data);
    } catch {
      setSelectedOrder({ order, items: [], timeline: [] });
    }
  }, [customerAuth.phone, displayOrderNumber]);

  const reorder = useCallback(async (order) => {
    const sourceItems = order.items || selectedOrder?.items || [];
    let items = sourceItems;
    if (!items.length) {
      const data = await storefrontCustomerRequest("/storefront/track", {
        params: {
          order_number: displayOrderNumber(order),
          ...(customerAuth.phone ? { phone: customerAuth.phone } : {}),
        },
      });
      items = data.items || [];
    }
    const productMap = await loadProductsForReorder(items);
    let added = 0;
    let skipped = 0;
    for (const item of items) {
      const product = productMap.get(String(item?.product_id || "").trim());
      const variant = (product?.variants || []).find((candidate) => String(candidate.id) === String(item.variant_id) && Number(candidate.stock || 0) > 0);
      if (!product || !variant) {
        skipped += 1;
        continue;
      }
      onAddToCart(product, variant, Math.min(Number(item.quantity || 1), Number(variant.stock || 1)));
      added += 1;
    }
    if (added) {
      toast.success(skipped ? sfText("storefront.toasts.reorderPartial", "Available items were added to cart. Some choices are currently unavailable.") : sfText("storefront.toasts.reorderAdded", "The order was added to cart again."));
    } else {
      toast.error(sfText("storefront.toasts.reorderUnavailable", "هذه المنتجات غير متاحة حاليًا. جرّب اختيارات أخرى."));
    }
  }, [customerAuth.phone, displayOrderNumber, loadProductsForReorder, onAddToCart, selectedOrder?.items, sfText]);

  const orders = account?.orders || [];
  const addresses = account?.addresses || [];
  const backendWishlist = account?.wishlist_products || [];
  const backendRecent = account?.recent_products || [];
  const customerName = account?.customer?.name || safeProfile.full_name || "";
  const showOtpLogin = !hasCustomerToken && !isResetMode;
  const showResetView = authMode === "reset";
  const showForgotView = authMode === "forgot";
  const activePrimaryTab = authMode === "register" ? "register" : "login";
  const wishlistItems = backendWishlist.length ? backendWishlist : wishlist;
  const recentItems = backendRecent.length ? backendRecent : recent;
  const customerPhone = customerAuth.phone || phone;
  const [showAllOrders, setShowAllOrders] = useState(false);
  const visibleOrders = showAllOrders ? orders : orders.slice(0, ORDERS_PREVIEW_COUNT);
  const openOrderKey = selectedOrder?.order ? String(selectedOrder.order.id || displayOrderNumber(selectedOrder.order)) : "";
  const points = Number(account?.loyalty?.points ?? account?.loyalty?.available_points ?? 0);

  const toggleOrder = useCallback((order) => {
    const key = String(order.id || displayOrderNumber(order));
    if (key === openOrderKey) {
      setSelectedOrder(null);
      return;
    }
    openOrder(order);
  }, [displayOrderNumber, openOrder, openOrderKey]);

  if (!hasCustomerToken) {
    return (
      <section className="sfa sfa--guest">
        <div className="sfx-wrap sfa-guest">
          <header className="sfa-guest__head">
            <BrandMark brandName={helpers.brandName} brandLogoUrl={helpers.brandLogoUrl} imageFor={helpers.imageFor} />
            <h1 className="sfx-title">{showResetView ? sfText("storefront.auth.recoverAccount") : sfText("storefront.auth.welcomeTitle")}</h1>
            <p className="sfx-subtitle">{showResetView ? sfText("storefront.auth.resetIntro") : sfText("storefront.auth.welcomeIntro")}</p>
          </header>

          <div className="sfx-surface sfa-card sfa-auth">
            {!showForgotView && !showResetView ? (
              <div className="sfx-tabs sfx-tabs--block" role="tablist">
                <button type="button" role="tab" aria-selected={activePrimaryTab === "login"} onClick={() => setAuthMode("login")} className={`sfx-tab${activePrimaryTab === "login" ? " is-active" : ""}`}>
                  {sfText("storefront.auth.signIn")}
                </button>
                <button type="button" role="tab" aria-selected={activePrimaryTab === "register"} onClick={() => setAuthMode("register")} className={`sfx-tab${activePrimaryTab === "register" ? " is-active" : ""}`}>
                  {sfText("storefront.auth.createAccount")}
                </button>
              </div>
            ) : null}

            {authMode === "login" ? (
              <div className="sfa-form">
                <AccountField label={sfText("storefront.auth.email")} value={authEmail} onChange={setAuthEmail} type="email" inputMode="email" autoComplete="email" ltr />
                <div className="sfa-form__stack">
                  <AccountField label={sfText("storefront.auth.password")} value={authPassword} onChange={setAuthPassword} type="password" autoComplete="current-password" ltr />
                  <button type="button" onClick={() => setAuthMode("forgot")} className="sfa-text-btn sfa-text-btn--end">{sfText("storefront.auth.forgotPassword")}</button>
                </div>
                <SubmitButton onClick={submitEmailAuthLogin} disabled={authSubmitting} busy={authSubmitting} busyLabel={sfText("storefront.auth.signingIn")}>
                  {sfText("storefront.auth.signIn")}
                </SubmitButton>

                {showOtpLogin ? (
                  <>
                    <div className="sfa-divider"><span>{sfText("storefront.auth.or")}</span></div>
                    {!otpPanelOpen ? (
                      <SubmitButton onClick={() => setOtpPanelOpen(true)} variant="secondary">
                        <MessageCircle className="h-4 w-4" aria-hidden="true" />
                        {sfText("storefront.auth.phoneLoginButton")}
                      </SubmitButton>
                    ) : (
                      <div className="sfa-otp">
                        <div className="sfa-otp__head">
                          <div className="min-w-0">
                            <p className="sfa-otp__title">{sfText("storefront.auth.phoneLoginTitle")}</p>
                            <p className="sfx-muted">{sfText("storefront.auth.phoneLoginHint")}</p>
                          </div>
                          <button type="button" onClick={() => { setOtpPanelOpen(false); setOtpRequestedAt(0); setOtpCode(""); }} className="sfa-text-btn">
                            {sfText("storefront.common.close")}
                          </button>
                        </div>
                        <AccountField label={sfText("storefront.form.mobileNumber", "رقم الموبايل")} value={phone} onChange={setPhone} type="tel" inputMode="tel" autoComplete="tel" ltr />
                        {!otpRequestedAt ? (
                          <SubmitButton onClick={requestOtp} disabled={requestingOtp || !normalizedLoginPhone} busy={requestingOtp} busyLabel={sfText("storefront.auth.sendingCode")}>
                            {sfText("storefront.auth.sendWhatsappCode")}
                          </SubmitButton>
                        ) : (
                          <>
                            <AccountField
                              label={sfText("storefront.auth.otpCode")}
                              value={otpCode}
                              onChange={(value) => setOtpCode(String(value || "").replace(/\D/g, "").slice(0, 6))}
                              inputMode="numeric"
                              autoComplete="one-time-code"
                              ltr
                              hint={sfText("storefront.auth.otpSentHint")}
                            />
                            <SubmitButton onClick={verifyOtp} disabled={verifyingOtp || String(otpCode || "").replace(/\D/g, "").length !== 6} busy={verifyingOtp} busyLabel={sfText("storefront.auth.verifying")}>
                              {sfText("storefront.auth.confirmLogin")}
                            </SubmitButton>
                            <button type="button" onClick={requestOtp} disabled={requestingOtp || resendCountdown > 0} className="sfa-text-btn sfa-text-btn--center">
                              <RefreshCcw className="h-3.5 w-3.5" aria-hidden="true" />
                              {resendCountdown > 0 ? sfText("storefront.auth.resendIn", undefined, { seconds: resendCountdown }) : sfText("storefront.auth.resendCode")}
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </>
                ) : null}
              </div>
            ) : null}

            {authMode === "register" ? (
              <div className="sfa-form">
                <AccountField label={sfText("storefront.form.name")} value={authFullName} onChange={setAuthFullName} autoComplete="name" />
                <AccountField label={sfText("storefront.auth.email")} value={authEmail} onChange={setAuthEmail} type="email" inputMode="email" autoComplete="email" ltr />
                <AccountField label={sfText("storefront.form.mobileNumber", "رقم الموبايل")} value={phone} onChange={setPhone} type="tel" inputMode="tel" autoComplete="tel" ltr />
                <AccountField label={sfText("storefront.auth.password")} value={authPassword} onChange={setAuthPassword} type="password" autoComplete="new-password" ltr />
                <AccountField label={sfText("storefront.auth.confirmPassword")} value={authConfirmPassword} onChange={setAuthConfirmPassword} type="password" autoComplete="new-password" ltr />
                <SubmitButton onClick={submitEmailAuthRegister} disabled={authSubmitting} busy={authSubmitting} busyLabel={sfText("storefront.auth.creatingAccount")}>
                  {sfText("storefront.auth.createAccount")}
                </SubmitButton>
              </div>
            ) : null}

            {authMode === "forgot" ? (
              <div className="sfa-form">
                <div>
                  <h2 className="sfx-h2">{sfText("storefront.auth.recoverPassword")}</h2>
                  <p className="sfx-muted">{sfText("storefront.auth.recoverHint")}</p>
                </div>
                <AccountField label={sfText("storefront.auth.email")} value={authEmail} onChange={setAuthEmail} type="email" inputMode="email" autoComplete="email" ltr />
                <SubmitButton onClick={requestPasswordReset} disabled={authSubmitting} busy={authSubmitting} busyLabel={sfText("storefront.auth.sending")}>
                  {sfText("storefront.auth.sendRecoveryLink")}
                </SubmitButton>
                <button type="button" onClick={() => setAuthMode("login")} className="sfa-text-btn sfa-text-btn--center">{sfText("storefront.auth.backToSignIn")}</button>
              </div>
            ) : null}

            {authMode === "reset" ? (
              <div className="sfa-form">
                {!hasResetToken ? <div className="sfx-notice sfx-notice--accent">{sfText("storefront.auth.resetLinkIncomplete")}</div> : null}
                <AccountField label={sfText("storefront.auth.newPassword")} value={resetPassword} onChange={setResetPassword} type="password" autoComplete="new-password" ltr />
                <AccountField label={sfText("storefront.auth.confirmNewPassword")} value={resetPasswordConfirm} onChange={setResetPasswordConfirm} type="password" autoComplete="new-password" ltr />
                <SubmitButton onClick={submitPasswordReset} disabled={authSubmitting || !hasResetToken} busy={authSubmitting} busyLabel={sfText("storefront.auth.updating")}>
                  {sfText("storefront.auth.updatePassword")}
                </SubmitButton>
                {!hasResetToken ? <button type="button" onClick={() => setAuthMode("forgot")} className="sfa-text-btn sfa-text-btn--center">{sfText("storefront.auth.requestNewLink")}</button> : null}
              </div>
            ) : null}
          </div>

          {!showResetView && !showForgotView ? (
            <ul className="sfa-perks">
              {GUEST_PERKS.map(({ key, Icon, label }) => (
                <li key={key} className="sfa-perk">
                  <span className="sfa-perk__icon" aria-hidden="true"><Icon className="h-4 w-4" /></span>
                  {label()}
                </li>
              ))}
            </ul>
          ) : null}

          <p className="sfa-secure">
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            {sfText("storefront.auth.secureLogin")}
          </p>
        </div>
      </section>
    );
  }

  const stats = [
    { key: "orders", Icon: PackageCheck, value: orders.length, label: sfText("storefront.account.stats.orders"), onClick: () => scrollToSection("sfa-orders") },
    { key: "wishlist", Icon: Heart, value: wishlistItems.length, label: sfText("storefront.header.wishlist", "المفضلة"), to: ROOT_PATHS.wishlist || "/wishlist" },
    { key: "addresses", Icon: MapPin, value: addresses.length, label: sfText("storefront.account.stats.addresses"), onClick: () => scrollToSection("sfa-addresses") },
    { key: "points", Icon: Gem, value: points.toLocaleString(i18n.language || "en"), label: sfText("storefront.account.stats.points"), onClick: () => scrollToSection("sfa-membership") },
  ];

  return (
    <section className="sfa">
      <div className="sfx-wrap sfa-wrap">
        <header className="sfa-head">
          <div className="sfa-head__who">
            <span className="sfa-avatar" aria-hidden="true">
              {initialOf(customerName) || <UserRound className="h-6 w-6" />}
            </span>
            <div className="min-w-0">
              <p className="sfx-muted">{sfText("storefront.account.welcomeBack", "أهلًا بيك")}</p>
              <h1 className="sfx-title sfa-title--name">{customerName || sfText("storefront.account.title", "حسابي")}</h1>
              {customerPhone ? <p className="sfa-head__phone" dir="ltr">{customerPhone}</p> : null}
            </div>
          </div>
          <div className="sfa-head__actions">
            <button type="button" onClick={() => load()} disabled={loading} className="sfx-btn sfx-btn--secondary">
              <RefreshCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />
              {sfText("storefront.account.refreshData")}
            </button>
            <button type="button" onClick={clearCustomerIdentity} className="sfx-btn sfx-btn--ghost sfa-signout">
              <LogOut className="h-4 w-4" aria-hidden="true" />
              {sfText("storefront.account.signOut")}
            </button>
          </div>
        </header>

        <nav className="sfa-stats" aria-label={sfText("storefront.account.title", "حسابي")}>
          {stats.map(({ key, Icon, value, label, to, onClick }) => {
            const body = (
              <>
                <span className="sfa-stat__icon" aria-hidden="true"><Icon className="h-[18px] w-[18px]" /></span>
                <span className="sfa-stat__value" dir="ltr">{value}</span>
                <span className="sfa-stat__label">{label}</span>
              </>
            );
            return to ? (
              <Link key={key} to={to} className="sfa-stat">{body}</Link>
            ) : (
              <button key={key} type="button" onClick={onClick} className="sfa-stat">{body}</button>
            );
          })}
        </nav>

        <div className="sfa-grid">
          <div className="sfa-main">
            <section id="sfa-orders" className="sfx-surface sfa-card">
              <SectionHead Icon={ShoppingBag} title={sfText("storefront.account.myOrders", "طلباتي")} subtitle={sfText("storefront.account.ordersHint")} count={orders.length || null} />
              {!account && loading ? (
                <div className="sfa-skeleton-list" aria-busy="true">
                  {[0, 1, 2].map((index) => <div key={index} className="sfx-skel sfa-skeleton" />)}
                </div>
              ) : orders.length ? (
                <>
                  <ul className="sfa-orders">
                    {visibleOrders.map((order) => {
                      const key = String(order.id || displayOrderNumber(order));
                      const open = key === openOrderKey;
                      return (
                        <OrderRow
                          key={key}
                          order={order}
                          phone={customerPhone}
                          open={open}
                          details={open ? selectedOrder : null}
                          onToggle={toggleOrder}
                          onReorder={reorder}
                          helpers={helpers}
                        />
                      );
                    })}
                  </ul>
                  {orders.length > ORDERS_PREVIEW_COUNT ? (
                    <button type="button" onClick={() => setShowAllOrders((current) => !current)} className="sfx-btn sfx-btn--secondary sfx-btn--lg sfx-btn--block sfa-more">
                      {showAllOrders
                        ? sfText("storefront.account.showFewerOrders", "عرض أقل")
                        : sfText("storefront.account.showAllOrders", "عرض كل الطلبات ({{count}})", { count: orders.length })}
                    </button>
                  ) : null}
                </>
              ) : (
                <div className="sfx-empty sfx-empty--compact sfa-card-empty">
                  <span className="sfx-empty__icon" aria-hidden="true"><ShoppingBag className="h-6 w-6" /></span>
                  <h3 className="sfx-empty__title">{sfText("storefront.account.noOrders", "لا توجد طلبات بعد")}</h3>
                  <p className="sfx-empty__text">{sfText("storefront.account.noOrdersText")}</p>
                  <Link to={ROOT_PATHS.products || "/products"} className="sfx-btn sfx-btn--primary sfx-btn--lg">
                    {sfText("storefront.common.shopNow")}
                    <ChevronLeft className="h-4 w-4 ltr:rotate-180" aria-hidden="true" />
                  </Link>
                </div>
              )}
            </section>

            <section className="sfx-surface sfa-card">
              <SectionHead
                Icon={Heart}
                title={sfText("storefront.header.wishlist", "المفضلة")}
                subtitle={sfText("storefront.account.wishlistSubtitle", "كل اللي عجبك في مكان واحد")}
                count={wishlistItems.length || null}
                action={wishlistItems.length ? (
                  <Link to={ROOT_PATHS.wishlist || "/wishlist"} className="sfx-btn sfx-btn--secondary sfx-btn--sm">
                    {sfText("storefront.common.viewAll", "عرض الكل")}
                  </Link>
                ) : null}
              />
              {wishlistItems.length ? (
                <ul className="sfa-thumbs">
                  {wishlistItems.slice(0, WISHLIST_PREVIEW_COUNT).map((item, index) => (
                    <li key={item.key || `${item.id}-${index}`}>
                      <Link to={productPath(item.slug || item.id, item.color_key ? { color: item.color_key } : "")} className="sfa-thumb">
                        <span className="sfa-thumb__plate">
                          <img src={helpers.imageFor(item.image_url || item.image)} onError={helpers.fallbackProductImage} alt="" loading="lazy" decoding="async" />
                        </span>
                        <span className="sfa-thumb__name">{item.name}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="sfx-muted sfa-inline-empty">{sfText("storefront.account.wishlistEmpty", "احفظ المنتجات التي تعجبك هنا")}</p>
              )}
            </section>
          </div>

          <aside className="sfa-side">
            <MembershipCard loyalty={account?.loyalty} loading={loading} />

            <section className="sfx-surface sfa-card">
              <SectionHead Icon={Ruler} title={sfText("storefront.account.sizesTitle", "مقاساتي")} subtitle={sfText("storefront.account.sizesSubtitle", "بنرشّحلك المقاس المناسب أسرع")} />
              <div className="sfa-sizes">
                {SIZE_FIELDS.map(({ key, label }) => (
                  <label key={key} className="sfx-form-row">
                    <span className="sfx-label">{label()}</span>
                    <input
                      value={preferredSizes[key]}
                      onChange={(event) => updatePreferredSize(key, event.target.value)}
                      inputMode="text"
                      maxLength={12}
                      dir="ltr"
                      className="sfx-input sfx-input--sm sfa-size-input"
                      placeholder="—"
                    />
                  </label>
                ))}
              </div>
              <SubmitButton onClick={savePreferredSizes} disabled={savingPreferences} busy={savingPreferences} busyLabel={sfText("storefront.account.savingSizes", "بنحفظ...")} variant="secondary">
                {sfText("storefront.account.saveSizes", "حفظ المقاسات")}
              </SubmitButton>
            </section>

            <section id="sfa-addresses" className="sfx-surface sfa-card">
              <SectionHead Icon={MapPin} title={sfText("storefront.account.myAddresses", "عناويني")} subtitle={sfText("storefront.account.savedAddressesSubtitle")} />
              {addresses.length ? (
                <ul className="sfa-addresses">
                  {addresses.map((address) => (
                    <li key={address} className="sfa-address">
                      <MapPin className="h-4 w-4 shrink-0" aria-hidden="true" />
                      <span>{address}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="sfx-muted sfa-inline-empty">{sfText("storefront.account.addressesEmpty", "ستظهر هنا العناوين المستخدمة في الطلبات")}</p>
              )}
            </section>

            <section className="sfx-surface sfa-card sfa-help">
              <SectionHead Icon={PackageSearch} title={sfText("storefront.account.helpTitle", "محتاج مساعدة؟")} subtitle={sfText("storefront.account.helpText", "تابع أي طلب أو كلّمنا على واتساب")} />
              <div className="sfa-help__actions">
                <Link to={ROOT_PATHS.track || "/track"} className="sfx-btn sfx-btn--secondary sfx-btn--lg sfx-btn--block">
                  <Truck className="h-4 w-4" aria-hidden="true" />
                  {sfText("storefront.orders.trackOrder", "تتبع الطلب")}
                </Link>
                <a href={helpers.supportHref ? helpers.supportHref("") : "#"} target="_blank" rel="noreferrer" className="sfx-btn sfx-btn--whatsapp sfx-btn--lg sfx-btn--block">
                  <MessageCircle className="h-4 w-4" aria-hidden="true" />
                  {sfText("storefront.support.whatsapp", "واتساب")}
                </a>
              </div>
            </section>
          </aside>
        </div>
      </div>

      {recentItems.length ? (
        <RecentProductsSection
          recent={recentItems}
          wishlist={wishlist}
          toggleWishlist={toggleWishlist}
          onAddToCart={onAddToCart}
          saleModeEnabled={saleModeEnabled}
        />
      ) : null}
    </section>
  );
}

class StorefrontAccountPageBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error) {
    console.error("[storefront-account] render error", error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <section className="sfa sfa--guest">
          <div className="sfx-wrap sfa-guest">
            <div className="sfx-empty">
              <span className="sfx-empty__icon" aria-hidden="true"><UserRound className="h-6 w-6" /></span>
              <h1 className="sfx-empty__title">{sfText("storefront.account.errorTitle")}</h1>
              <p className="sfx-empty__text">{sfText("storefront.account.errorText")}</p>
              <button type="button" onClick={() => window.location.reload()} className="sfx-btn sfx-btn--primary sfx-btn--lg">
                {sfText("storefront.common.refreshPage")}
              </button>
            </div>
          </div>
        </section>
      );
    }
    return this.props.children;
  }
}

export function StorefrontAccountPage(props) {
  return (
    <StorefrontAccountPageBoundary>
      <StorefrontAccountPageContent {...props} />
    </StorefrontAccountPageBoundary>
  );
}
