import { Component, memo, useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import toast from "react-hot-toast";
import i18n from "../../i18n/i18n";
import { api } from "../../shared/api/api";
import { VirtualList } from "../../shared/components/VirtualList";
import {
  Crown,
  Gem,
  Loader2,
  LogOut,
  RefreshCcw,
  ShieldCheck,
} from "lucide-react";
import {
  clearStorefrontCustomerAuth,
  normalizeStorefrontCustomerPhone,
  readStorefrontCustomerAuth,
  storeStorefrontCustomerAuth,
  storefrontCustomerRequest,
} from "../lib/storefrontCustomerAuth";

const STOREFRONT_PROFILE_KEY = "storefront.profile";

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
  } catch {
    // Ignore storage errors.
  }
};

function OrderItemsSummaryLocal({ items = [], helpers }) {
  const { sfText, money, imageFor, fallbackProductImage } = helpers;
  if (!items.length) {
    return <p className="sf-muted-empty mt-4 rounded-2xl bg-stone-50 p-4 font-bold text-stone-500">{sfText("storefront.orders.itemsLoading", "سيظهر ملخص المنتجات هنا بعد تحميل تفاصيل الطلب.")}</p>;
  }
  return (
    <div className="sf-order-items mt-5 space-y-3">
      <h3 className="sf-section-heading text-lg font-black">{sfText("storefront.orders.itemsSummary", "ملخص المنتجات")}</h3>
      {items.map((item) => (
        <div key={item.id || `${item.product_id}-${item.variant_id}`} className="sf-order-item-row flex min-w-0 items-center gap-3 rounded-2xl bg-stone-50 p-3">
          <img src={imageFor(item.product_image || item.image_url)} onError={fallbackProductImage} alt="" className="h-14 w-14 shrink-0 rounded-2xl object-cover" loading="lazy" decoding="async" width="56" height="56" />
          <div className="min-w-0 flex-1">
            <div className="sf-order-item-name truncate font-black">{item.product_name || item.name}</div>
            <div className="sf-order-item-meta text-xs font-bold text-stone-500">{item.color || sfText("storefront.products.color", "اللون")} / {item.size || sfText("storefront.products.size", "المقاس")} × {item.quantity}</div>
          </div>
          <div className="sf-order-item-price shrink-0 font-black">{money(item.total_amount || Number(item.price || item.sale_price || 0) * Number(item.quantity || 1))}</div>
        </div>
      ))}
    </div>
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

function LoyaltyWidget({ loyalty, loading, helpers }) {
  const { sfText } = helpers;
  if (loading && !loyalty) {
    return (
      <div className="sf-loyalty-card mt-4 overflow-hidden rounded-[1.5rem] border border-stone-200/80 bg-white/96 p-4 shadow-[0_18px_42px_rgba(15,23,42,0.07)]">
        <div className="sf-skeleton h-4 w-24 animate-pulse rounded-full bg-stone-200/90" />
        <div className="sf-skeleton mt-4 h-10 w-36 animate-pulse rounded-[0.95rem] bg-stone-200/90" />
        <div className="sf-skeleton mt-4 h-2 w-full animate-pulse rounded-full bg-stone-200/90" />
      </div>
    );
  }

  const points = Number(loyalty?.points ?? loyalty?.available_points ?? 0);
  const tier = loyalty?.tier || "Bronze";
  const nextTier = loyalty?.next_tier || "Platinum";
  const remaining = Number(loyalty?.points_to_next_tier || 0);
  const progress = Math.max(0, Math.min(100, Number(loyalty?.progress || 0)));

  return (
    <div className="sf-loyalty-card mt-4 overflow-hidden rounded-[1.35rem] border border-[#d4af37]/20 bg-[#111111] p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="sf-loyalty-icon grid h-10 w-10 place-items-center rounded-full bg-white text-[#d4af37] shadow-sm">
            <Gem className="h-5 w-5" />
          </span>
          <div>
            <div className="sf-muted-text text-xs font-black text-stone-500">{sfText("storefront.account.loyaltyBalance", "Loyalty balance")}</div>
            <div className="sf-primary-text text-2xl font-black text-stone-950">
              <AnimatedPoints value={points} /> {sfText("storefront.account.points", "points")}
            </div>
          </div>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full bg-stone-950 px-3 py-1.5 text-xs font-black text-white">
          <Crown className="h-3.5 w-3.5 text-amber-300" />
          {tier}
        </span>
      </div>
      <div className="sf-loyalty-progress mt-4 h-2 overflow-hidden rounded-full bg-white">
        <div className="h-full rounded-full bg-[#d4af37] transition-all duration-700" style={{ width: `${progress}%` }} />
      </div>
      <div className="sf-secondary-text mt-3 flex flex-wrap items-center justify-between gap-2 text-xs font-black text-stone-600">
        <span>
          {remaining > 0
            ? sfText("storefront.account.pointsToNextTier", "{{count}} points to reach {{tier}}", {
                count: remaining.toLocaleString(i18n.language || "en"),
                tier: nextTier,
              })
            : sfText("storefront.account.topTierReached", "You reached the top tier")}
        </span>
        <span>{Math.round(progress)}%</span>
      </div>
    </div>
  );
}

const AccountOrderRow = memo(function AccountOrderRow({ order, phone, onOpen, onReorder, helpers, components }) {
  const { displayOrderNumber, formatDate, statusCopy, money, sfText } = helpers;
  const { OrderNumberBadge } = components;
  const open = useCallback(() => onOpen(order), [onOpen, order]);
  const reorderOrder = useCallback(() => onReorder(order), [onReorder, order]);
  const publicNumber = displayOrderNumber(order);
  return (
    <div className="sf-account-order-row rounded-2xl bg-stone-50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <OrderNumberBadge value={order} className="border-[#d4af37]/20 bg-[#d4af37]/10 text-[#d4af37]" />
          <div className="sf-muted-text mt-1 text-xs font-bold text-stone-500">{formatDate(order.created_at)} - {statusCopy(order.status)}</div>
        </div>
        <div className="sf-primary-text font-black">{money(order.total_amount || order.total || order.total_price)}</div>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <button onClick={open} className="sf-soft-pill min-h-11 rounded-full border border-stone-300 bg-white px-4 py-2 text-sm font-black">{sfText("storefront.orders.orderDetails", "تفاصيل الطلب")}</button>
        <Link to={`/track?order=${encodeURIComponent(publicNumber)}&phone=${encodeURIComponent(phone)}`} className="min-h-11 rounded-full bg-stone-950 px-4 py-2 text-center text-sm font-black text-white">{sfText("storefront.orders.trackOrder", "تتبع الطلب")}</Link>
        <button onClick={reorderOrder} className="min-h-11 rounded-full border border-[#d4af37]/30 bg-[#f8e7b3]/10 px-4 py-2 text-sm font-black text-[#d4af37]">{sfText("storefront.orders.reorder", "إعادة الطلب")}</button>
      </div>
    </div>
  );
});

function CustomerOrderDetails({ data, phone, onReorder, helpers, components }) {
  const { displayOrderNumber, sfText, statusCopy, paymentCopy, shippingProviderCopy, supportHref } = helpers;
  const { Panel, InfoBox, OrderTimeline, OrderNumberBadge } = components;
  const order = data.order || {};
  const publicNumber = displayOrderNumber(order);
  if (data.loading) return <div className="sf-storefront-card h-40 animate-pulse rounded-3xl bg-white" />;
  return (
    <Panel title={sfText("storefront.orders.orderDetails", "تفاصيل الطلب")}>
      <OrderNumberBadge value={publicNumber} className="mb-1 border-[#d4af37]/20 bg-[#d4af37]/10 text-[#d4af37]" />
      <div className="grid gap-3 md:grid-cols-3">
        <InfoBox label={sfText("storefront.orders.orderStatus", "حالة الطلب")} value={statusCopy(order.status)} />
        <InfoBox label={sfText("storefront.checkout.paymentMethod", "Payment")} value={`${paymentCopy(order.payment_method)} - ${statusCopy(order.payment_status)}`} />
        <InfoBox label={sfText("storefront.checkout.shipping", "Shipping")} value={`${shippingProviderCopy(order.shipping_provider)} - ${statusCopy(order.shipping_status)}`} />
      </div>
      <OrderTimeline timeline={data.timeline || []} />
      <OrderItemsSummaryLocal items={data.items || []} helpers={helpers} />
      <div className="grid gap-2 sm:grid-cols-3">
        <Link to={`/track?order=${encodeURIComponent(publicNumber)}&phone=${encodeURIComponent(phone)}`} className="min-h-12 rounded-full bg-stone-950 px-5 py-3 text-center font-black text-white">{sfText("storefront.orders.trackOrder", "تتبع الطلب")}</Link>
        <button onClick={() => onReorder({ ...order, items: data.items || [] })} className="min-h-12 rounded-full border border-[#d4af37]/30 bg-[#f8e7b3]/10 px-5 py-3 font-black text-[#d4af37]">{sfText("storefront.orders.reorder", "إعادة الطلب")}</button>
        <a href={supportHref(publicNumber)} className="min-h-12 rounded-full border border-emerald-200 bg-emerald-50 px-5 py-3 text-center font-black text-emerald-700">{sfText("storefront.support.whatsapp", "واتساب")}</a>
      </div>
    </Panel>
  );
}

function StorefrontAccountPageContent({
  profile = {},
  setProfile = () => {},
  wishlist = [],
  recent = [],
  onAddToCart = () => {},
  helpers = {},
  components = {},
  initialAuthMode = "login",
}) {
  const {
    sfText = (_key, fallback = "") => fallback,
    displayOrderNumber = (value) => String(value?.id || value?.order_number || ""),
  } = helpers;
  const { Field, Panel, InfoBox, SmallProductList } = components;
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
  const showEmailAuth = !hasCustomerToken;

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
    toast.error("ط·آ§ط¸â€ ط·ع¾ط¸â€،ط·ع¾ ط·آµط¸â€‍ط·آ§ط·آ­ط¸ظ¹ط·آ© ط·آ§ط¸â€‍ط·آ¯ط·آ®ط¸ث†ط¸â€‍. ط·آ³ط·آ¬ط¸â€کط¸â€‍ ط·آ¯ط·آ®ط¸ث†ط¸â€‍ط¸ئ’ ط¸â€¦ط·آ±ط·آ© ط·آ£ط·آ®ط·آ±ط¸â€°.");
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
        toast.error(error.message || sfText("storefront.toasts.accountUnavailable", "ط¸â€‍ط·آ§ ط¸ظ¹ط¸â€¦ط¸ئ’ط¸â€  ط¸ظ¾ط·ع¾ط·آ­ ط·آ§ط¸â€‍ط·آ­ط·آ³ط·آ§ط·آ¨ ط·آ§ط¸â€‍ط·آ¢ط¸â€ ."));
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
      toast.error("أدخل رقم موبايل صحيح");
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
      toast.success("تم إرسال كود الدخول على واتساب");
    } catch (error) {
      toast.error(error.message || "تعذر إرسال كود الدخول");
    } finally {
      setRequestingOtp(false);
    }
  }, [phone]);

  const verifyOtp = useCallback(async () => {
    const normalizedPhone = normalizeStorefrontCustomerPhone(phone);
    const otp = String(otpCode || "").replace(/\D/g, "").slice(0, 6);
    if (normalizedPhone.length < 10) {
      toast.error("أدخل رقم موبايل صحيح");
      return;
    }
    if (otp.length !== 6) {
      toast.error("أدخل كود OTP من 6 أرقام");
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
      toast.success("تم تسجيل الدخول بنجاح");
      await load({ silent: true });
    } catch (error) {
      toast.error(error?.message || "الكود غير صحيح أو انتهت صلاحيته");
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
      toast.error("أدخل الاسم والبريد ورقم الموبايل وكلمة المرور");
      return;
    }
    if (password.length < 8) {
      toast.error("كلمة المرور يجب ألا تقل عن 8 أحرف");
      return;
    }
    if (password !== confirm) {
      toast.error("كلمتا المرور غير متطابقتين");
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
      toast.success("تم إنشاء الحساب وتسجيل الدخول بنجاح");
      await load({ silent: true });
    } catch (error) {
      toast.error(error?.message || "تعذر إنشاء الحساب حاليًا");
    } finally {
      setAuthSubmitting(false);
    }
  }, [authConfirmPassword, authEmail, authFullName, authPassword, load, phone, setSearchParams, syncEmailAuthResponse]);

  const submitEmailAuthLogin = useCallback(async () => {
    const email = String(authEmail || "").trim();
    const password = String(authPassword || "");
    if (!email || !password) {
      toast.error("أدخل البريد الإلكتروني وكلمة المرور");
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
      toast.success("تم تسجيل الدخول بنجاح");
      await load({ silent: true });
    } catch (error) {
      toast.error(error?.message || "البريد أو كلمة المرور غير صحيحة");
    } finally {
      setAuthSubmitting(false);
    }
  }, [authEmail, authPassword, load, syncEmailAuthResponse]);

  const requestPasswordReset = useCallback(async () => {
    const email = String(authEmail || "").trim();
    if (!email) {
      toast.error("أدخل البريد الإلكتروني");
      return;
    }
    setAuthSubmitting(true);
    try {
      await storefrontCustomerRequest("/storefront/auth/request-reset", {
        method: "POST",
        body: { email },
      });
      setAuthMode("forgot");
      toast.success("إذا كان الحساب موجودًا فسيصلك رابط استعادة التعيين");
    } catch (error) {
      toast.error(error?.message || "تعذر إرسال رسالة إعادة التعيين");
    } finally {
      setAuthSubmitting(false);
    }
  }, [authEmail]);

  const submitPasswordReset = useCallback(async () => {
    const token = String(resetToken || resetTokenFromQuery || "").trim();
    const password = String(resetPassword || "");
    const confirm = String(resetPasswordConfirm || "");
    if (!token) {
      toast.error("رابط إعادة التعيين غير صالح");
      return;
    }
    if (!password || password.length < 8) {
      toast.error("كلمة المرور يجب ألا تقل عن 8 أحرف");
      return;
    }
    if (password !== confirm) {
      toast.error("كلمتا المرور غير متطابقتين");
      return;
    }
    setAuthSubmitting(true);
    try {
      await storefrontCustomerRequest("/storefront/auth/reset-password", {
        method: "POST",
        body: { token, password },
      });
      toast.success("تم تحديث كلمة المرور. يمكنك تسجيل الدخول الآن");
      setAuthMode("login");
      setResetPassword("");
      setResetPasswordConfirm("");
      setResetToken("");
      setSearchParams({});
      navigate("/account", { replace: true });
    } catch (error) {
      toast.error(error?.message || "تعذر تحديث كلمة المرور");
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
      toast.error("سجل دخولك أولًا حتى نحفظ مقاساتك");
      return;
    }
    setSavingPreferences(true);
    try {
      const response = await storefrontCustomerRequest("/storefront/customer/preferences", {
        method: "PUT",
        body: { preferred_sizes: preferredSizes },
      });
      setPreferredSizes(normalizePreferredSizes(response?.preferences || preferredSizes));
      toast.success("تم حفظ المقاسات");
    } catch (error) {
      if (Number(error?.status || error?.response?.status || 0) === 401) {
        toast.error("سجل الدخول مرة أخرى");
        return;
      }
      toast.error("تعذر حفظ المقاسات حاليًا");
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
      toast.error(sfText("storefront.toasts.reorderUnavailable", "ظ‡ط°ظ‡ ط§ظ„ظ…ظ†طھط¬ط§طھ ط؛ظٹط± ظ…طھط§ط­ط© ط­ط§ظ„ظٹظ‹ط§. ط¬ط±ظ‘ط¨ ط§ط®طھظٹط§ط±ط§طھ ط£ط®ط±ظ‰."));
    }
  }, [customerAuth.phone, displayOrderNumber, loadProductsForReorder, onAddToCart, selectedOrder?.items, sfText]);

  const orders = account?.orders || [];
  const addresses = account?.addresses || [];
  const backendWishlist = account?.wishlist_products || [];
  const backendRecent = account?.recent_products || [];
  const authSummary = account?.customer?.name || safeProfile.full_name || sfText("storefront.account.enterPhoneHint", "أدخل رقم هاتفك لعرض الحساب");
  const isRestoringAccount = hasCustomerToken && !account;
  const showOtpLogin = !hasCustomerToken && !isResetMode;
  const showResetView = authMode === "reset";
  const showForgotView = authMode === "forgot";
  const activePrimaryTab = authMode === "register" ? "register" : "login";
  const ltrInputClassName = "text-left [direction:ltr]";

  return (
    <section className="sf-account-page mx-auto max-w-6xl px-4 py-5 pb-28 md:py-8 md:pb-12" dir="rtl" lang="ar">
      <div className="mt-6 grid gap-6 lg:grid-cols-[420px_1fr]">
        <div className="space-y-5">
          {hasCustomerToken ? (
            <>
              <Panel title={sfText("storefront.account.myOrders", "My orders")}>
                {orders.length ? (
                  <VirtualList
                    items={orders}
                    estimateSize={152}
                    className="max-h-[28rem] overflow-auto pr-1"
                    itemKey={(order) => order.id || displayOrderNumber(order)}
                    renderItem={(order) => <AccountOrderRow order={order} phone={customerAuth.phone || phone} onOpen={openOrder} onReorder={reorder} helpers={helpers} components={components} />}
                  />
                ) : <p className="sf-muted-empty font-bold text-stone-500">{sfText("storefront.account.noOrders", "No orders yet")}</p>}
              </Panel>
              {selectedOrder ? <CustomerOrderDetails data={selectedOrder} phone={customerAuth.phone || phone} onReorder={reorder} helpers={helpers} components={components} /> : null}
              <Panel title={sfText("storefront.account.myAddresses", "عناويني")}>
                {addresses.length ? addresses.map((address) => <div key={address} className="sf-account-address-row rounded-2xl bg-stone-50 p-3 font-bold text-stone-700">{address}</div>) : <p className="sf-muted-empty font-bold text-stone-500">{sfText("storefront.account.addressesEmpty", "ستظهر العناوين المستخدمة في الطلبات هنا")}</p>}
              </Panel>
              <Panel title={sfText("storefront.header.wishlist", "المفضلة")}>
                <SmallProductList items={backendWishlist.length ? backendWishlist : wishlist} empty={sfText("storefront.account.wishlistEmpty", "احفظ المنتجات التي تعجبك هنا")} />
              </Panel>
              <Panel title={sfText("storefront.account.recentlyViewed", "شوهد مؤخرًا")}>
                <SmallProductList items={backendRecent.length ? backendRecent : recent} empty={sfText("storefront.account.recentEmpty", "ستظهر المنتجات التي شاهدتها مؤخرًا هنا")} />
              </Panel>
            </>
          ) : (
            <Panel title="حسابك محفوظ">
              <div className="space-y-4">
                <div className="sf-account-intro rounded-2xl border p-4">
                  <div className="flex items-start gap-3">
                    <span className="sf-account-intro-icon grid h-11 w-11 shrink-0 place-items-center rounded-full">
                      <ShieldCheck className="h-5 w-5" />
                    </span>
                    <div className="min-w-0">
                      <div className="sf-account-intro-title text-lg font-black">
                        {showResetView ? "استعادة الوصول" : "حسابك في M1 Store"}
                      </div>
                      <p className="sf-account-intro-copy mt-1 text-sm font-bold leading-6">
                        {showResetView
                          ? "أدخل كلمة المرور الجديدة ثم عد لتسجيل الدخول."
                          : "سجل دخولك لمتابعة طلباتك وعناوينك ونقاطك، أو أنشئ حسابًا جديدًا خلال ثوانٍ."}
                      </p>
                    </div>
                  </div>
                </div>
                {showEmailAuth ? (
                  <div className="sf-account-auth-card rounded-2xl border p-4">
                    {!showForgotView && !showResetView ? (
                      <div className="sf-account-tabs grid grid-cols-2 gap-2 rounded-full border p-1">
                        <button type="button" onClick={() => setAuthMode("login")} className={`sf-account-tab min-h-11 rounded-full px-4 text-sm font-black transition ${activePrimaryTab === "login" ? "is-active shadow-sm" : ""}`}>تسجيل الدخول</button>
                        <button type="button" onClick={() => setAuthMode("register")} className={`sf-account-tab min-h-11 rounded-full px-4 text-sm font-black transition ${activePrimaryTab === "register" ? "is-active shadow-sm" : ""}`}>إنشاء حساب</button>
                      </div>
                    ) : null}
                    <div className="mt-5 space-y-4">
                      {authMode === "login" ? (
                        <>
                          <Field label="البريد الإلكتروني" value={authEmail} onChange={setAuthEmail} inputMode="email" autoComplete="email" inputClassName={ltrInputClassName} />
                          <div className="space-y-2">
                            <Field label="كلمة المرور" value={authPassword} onChange={setAuthPassword} autoComplete="current-password" type="password" inputClassName={ltrInputClassName} />
                            <div className="flex justify-end">
                              <button type="button" onClick={() => setAuthMode("forgot")} className="text-xs font-black text-stone-500 underline decoration-stone-300 underline-offset-4 transition hover:text-[#b68c16]">نسيت كلمة المرور؟</button>
                            </div>
                          </div>
                          <button onClick={submitEmailAuthLogin} disabled={authSubmitting} className="sf-account-primary-button min-h-12 w-full rounded-full px-5 py-3 font-black transition">
                            {authSubmitting ? <span className="inline-flex items-center justify-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />جاري تسجيل الدخول...</span> : "تسجيل الدخول"}
                          </button>
                          {showOtpLogin ? (
                            <>
                              <div className="flex items-center gap-3 py-1">
                                <div className="h-px flex-1 bg-stone-200" />
                                <span className="text-xs font-black uppercase tracking-[0.28em] text-stone-400">أو</span>
                                <div className="h-px flex-1 bg-stone-200" />
                              </div>
                              {!otpPanelOpen ? (
                                <button type="button" onClick={() => setOtpPanelOpen(true)} className="sf-account-secondary-button min-h-12 w-full rounded-full border px-5 py-3 font-black transition">الدخول برقم الموبايل / واتساب</button>
                              ) : (
                                <div className="sf-account-otp-card rounded-[1.25rem] border p-4">
                                  <div className="flex items-start justify-between gap-3">
                                    <div>
                                      <div className="text-sm font-black text-stone-950">الدخول برقم الموبايل</div>
                                      <p className="mt-1 text-xs font-bold leading-6 text-stone-500">سنرسل كود واتساب لمرة واحدة على رقمك ثم نكمل تسجيل الدخول.</p>
                                    </div>
                                    <button type="button" onClick={() => { setOtpPanelOpen(false); setOtpRequestedAt(0); setOtpCode(""); }} className="text-xs font-black text-stone-500 underline decoration-stone-300 underline-offset-4">إغلاق</button>
                                  </div>
                                  <div className="mt-4 space-y-3">
                                    <Field label={sfText("storefront.form.mobileNumber", "رقم الموبايل")} value={phone} onChange={setPhone} inputMode="tel" autoComplete="tel" inputClassName={ltrInputClassName} />
                                    {!otpRequestedAt ? (
                                      <button onClick={requestOtp} disabled={requestingOtp || !normalizedLoginPhone} className="sf-account-primary-button min-h-12 w-full rounded-full px-5 py-3 font-black transition">
                                        {requestingOtp ? <span className="inline-flex items-center justify-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />جاري إرسال الكود...</span> : "إرسال كود واتساب"}
                                      </button>
                                    ) : (
                                      <>
                                        <Field label="كود OTP" value={otpCode} onChange={(value) => setOtpCode(String(value || "").replace(/\D/g, "").slice(0, 6))} inputMode="numeric" inputClassName={ltrInputClassName} />
                                        <button onClick={verifyOtp} disabled={verifyingOtp || String(otpCode || "").replace(/\D/g, "").length !== 6} className="sf-account-primary-button min-h-12 w-full rounded-full px-5 py-3 font-black transition">
                                          {verifyingOtp ? <span className="inline-flex items-center justify-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />جاري التحقق...</span> : "تأكيد الدخول"}
                                        </button>
                                        <button onClick={requestOtp} disabled={requestingOtp || resendCountdown > 0} className="min-h-11 w-full rounded-full border border-stone-200 bg-white px-5 py-3 text-sm font-black text-stone-700 transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-60">
                                          <span className="inline-flex items-center justify-center gap-2"><RefreshCcw className="h-4 w-4" />{resendCountdown > 0 ? `إعادة الإرسال بعد ${resendCountdown} ثانية` : "إعادة إرسال الكود"}</span>
                                        </button>
                                        <p className="text-xs font-bold leading-6 text-stone-500">أرسلنا كود الدخول عبر واتساب. أدخل الكود المكوّن من 6 أرقام خلال 5 دقائق.</p>
                                      </>
                                    )}
                                  </div>
                                </div>
                              )}
                            </>
                          ) : null}
                        </>
                      ) : null}
                      {authMode === "register" ? (
                        <>
                          <Field label="الاسم" value={authFullName} onChange={setAuthFullName} autoComplete="name" />
                          <Field label="البريد الإلكتروني" value={authEmail} onChange={setAuthEmail} inputMode="email" autoComplete="email" inputClassName={ltrInputClassName} />
                          <Field label={sfText("storefront.form.mobileNumber", "رقم الموبايل")} value={phone} onChange={setPhone} inputMode="tel" autoComplete="tel" inputClassName={ltrInputClassName} />
                          <Field label="كلمة المرور" value={authPassword} onChange={setAuthPassword} autoComplete="new-password" type="password" inputClassName={ltrInputClassName} />
                          <Field label="تأكيد كلمة المرور" value={authConfirmPassword} onChange={setAuthConfirmPassword} autoComplete="new-password" type="password" inputClassName={ltrInputClassName} />
                          <button onClick={submitEmailAuthRegister} disabled={authSubmitting} className="sf-account-primary-button min-h-12 w-full rounded-full px-5 py-3 font-black transition">
                            {authSubmitting ? <span className="inline-flex items-center justify-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />جاري إنشاء الحساب...</span> : "إنشاء حساب"}
                          </button>
                        </>
                      ) : null}
                      {authMode === "forgot" ? (
                        <>
                          <div>
                            <div className="text-base font-black text-stone-950">استعادة كلمة المرور</div>
                            <p className="mt-1 text-sm font-bold leading-6 text-stone-500">أدخل بريدك الإلكتروني وسنرسل لك رابط الاستعادة حسب نفس المنطق الحالي.</p>
                          </div>
                          <Field label="البريد الإلكتروني" value={authEmail} onChange={setAuthEmail} inputMode="email" autoComplete="email" inputClassName={ltrInputClassName} />
                          <button onClick={requestPasswordReset} disabled={authSubmitting} className="sf-account-primary-button min-h-12 w-full rounded-full px-5 py-3 font-black transition">
                            {authSubmitting ? <span className="inline-flex items-center justify-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />جاري الإرسال...</span> : "إرسال رابط الاستعادة"}
                          </button>
                          <button type="button" onClick={() => setAuthMode("login")} className="text-sm font-black text-stone-500 underline decoration-stone-300 underline-offset-4 transition hover:text-[#b68c16]">رجوع إلى تسجيل الدخول</button>
                        </>
                      ) : null}
                      {authMode === "reset" ? (
                        <>
                          {!hasResetToken ? <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold leading-6 text-amber-800">رابط إعادة التعيين غير مكتمل. تأكد من فتح الرابط الكامل من البريد الإلكتروني أو اطلب رابطًا جديدًا.</div> : null}
                          <Field label="كلمة المرور الجديدة" value={resetPassword} onChange={setResetPassword} autoComplete="new-password" type="password" inputClassName={ltrInputClassName} />
                          <Field label="تأكيد كلمة المرور الجديدة" value={resetPasswordConfirm} onChange={setResetPasswordConfirm} autoComplete="new-password" type="password" inputClassName={ltrInputClassName} />
                          <button onClick={submitPasswordReset} disabled={authSubmitting || !hasResetToken} className="sf-account-primary-button min-h-12 w-full rounded-full px-5 py-3 font-black transition">
                            {authSubmitting ? <span className="inline-flex items-center justify-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />جاري التحديث...</span> : "تحديث كلمة المرور"}
                          </button>
                          {!hasResetToken ? <button type="button" onClick={() => setAuthMode("forgot")} className="text-sm font-black text-stone-500 underline decoration-stone-300 underline-offset-4 transition hover:text-[#b68c16]">طلب رابط جديد</button> : null}
                        </>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
            </Panel>
          )}
        </div>
      </div>
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
        <section className="mx-auto max-w-3xl px-4 py-8" dir="rtl">
          <div className="rounded-[1.5rem] border border-stone-200 bg-white p-6 text-stone-950 shadow-[0_18px_50px_rgba(39,20,75,0.08)]">
            <div className="text-sm font-black text-[#d4af37]">حسابك</div>
            <h1 className="mt-2 text-2xl font-black">تعذر فتح صفحة الحساب الآن</h1>
            <p className="mt-2 text-sm font-bold leading-6 text-stone-600">
              حدث خطأ أثناء العرض. حاول تحديث الصفحة أو إعادة تعيين كلمة المرور ثم تسجيل الدخول. يمكنك تحديث الصفحة والمحاولة مرة أخرى.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-5 rounded-full bg-stone-950 px-5 py-3 text-sm font-black text-white"
            >
              تحديث الصفحة
            </button>
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
