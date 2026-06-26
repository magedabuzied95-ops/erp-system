import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
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
    return <p className="sf-muted-empty mt-4 rounded-2xl bg-stone-50 p-4 font-bold text-stone-500">{sfText("storefront.orders.itemsLoading", "ط³ظٹط¸ظ‡ط± ظ…ظ„ط®طµ ط§ظ„ظ…ظ†طھط¬ط§طھ ظ‡ظ†ط§ ط¨ط¹ط¯ طھط­ظ…ظٹظ„ طھظپط§طµظٹظ„ ط§ظ„ط·ظ„ط¨.")}</p>;
  }
  return (
    <div className="sf-order-items mt-5 space-y-3">
      <h3 className="sf-section-heading text-lg font-black">{sfText("storefront.orders.itemsSummary", "ظ…ظ„ط®طµ ط§ظ„ظ…ظ†طھط¬ط§طھ")}</h3>
      {items.map((item) => (
        <div key={item.id || `${item.product_id}-${item.variant_id}`} className="sf-order-item-row flex min-w-0 items-center gap-3 rounded-2xl bg-stone-50 p-3">
          <img src={imageFor(item.product_image || item.image_url)} onError={fallbackProductImage} alt="" className="h-14 w-14 shrink-0 rounded-2xl object-cover" loading="lazy" decoding="async" width="56" height="56" />
          <div className="min-w-0 flex-1">
            <div className="sf-order-item-name truncate font-black">{item.product_name || item.name}</div>
            <div className="sf-order-item-meta text-xs font-bold text-stone-500">{item.color || sfText("storefront.products.color", "ط§ظ„ظ„ظˆظ†")} / {item.size || sfText("storefront.products.size", "ط§ظ„ظ…ظ‚ط§ط³")} ط£â€” {item.quantity}</div>
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
      <div className="sf-loyalty-card mt-4 overflow-hidden rounded-[1.35rem] border border-stone-200 bg-stone-50 p-4">
        <div className="sf-skeleton h-4 w-24 animate-pulse rounded-full bg-stone-200" />
        <div className="sf-skeleton mt-4 h-10 w-36 animate-pulse rounded-xl bg-stone-200" />
        <div className="sf-skeleton mt-4 h-2 w-full animate-pulse rounded-full bg-stone-200" />
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
        <button onClick={open} className="sf-soft-pill min-h-11 rounded-full border border-stone-300 bg-white px-4 py-2 text-sm font-black">{sfText("storefront.orders.orderDetails", "طھظپط§طµظٹظ„ ط§ظ„ط·ظ„ط¨")}</button>
        <Link to={`/shop/track?order=${encodeURIComponent(publicNumber)}&phone=${encodeURIComponent(phone)}`} className="min-h-11 rounded-full bg-stone-950 px-4 py-2 text-center text-sm font-black text-white">{sfText("storefront.orders.trackOrder", "طھطھط¨ط¹ ط§ظ„ط·ظ„ط¨")}</Link>
        <button onClick={reorderOrder} className="min-h-11 rounded-full border border-[#d4af37]/30 bg-[#f8e7b3]/10 px-4 py-2 text-sm font-black text-[#d4af37]">{sfText("storefront.orders.reorder", "ط¥ط¹ط§ط¯ط© ط§ظ„ط·ظ„ط¨")}</button>
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
    <Panel title={sfText("storefront.orders.orderDetails", "طھظپط§طµظٹظ„ ط§ظ„ط·ظ„ط¨")}>
      <OrderNumberBadge value={publicNumber} className="mb-1 border-[#d4af37]/20 bg-[#d4af37]/10 text-[#d4af37]" />
      <div className="grid gap-3 md:grid-cols-3">
        <InfoBox label={sfText("storefront.orders.orderStatus", "ط­ط§ظ„ط© ط§ظ„ط·ظ„ط¨")} value={statusCopy(order.status)} />
        <InfoBox label={sfText("storefront.checkout.paymentMethod", "Payment")} value={`${paymentCopy(order.payment_method)} - ${statusCopy(order.payment_status)}`} />
        <InfoBox label={sfText("storefront.checkout.shipping", "Shipping")} value={`${shippingProviderCopy(order.shipping_provider)} - ${statusCopy(order.shipping_status)}`} />
      </div>
      <OrderTimeline timeline={data.timeline || []} />
      <OrderItemsSummaryLocal items={data.items || []} helpers={helpers} />
      <div className="grid gap-2 sm:grid-cols-3">
        <Link to={`/shop/track?order=${encodeURIComponent(publicNumber)}&phone=${encodeURIComponent(phone)}`} className="min-h-12 rounded-full bg-stone-950 px-5 py-3 text-center font-black text-white">{sfText("storefront.orders.trackOrder", "طھطھط¨ط¹ ط§ظ„ط·ظ„ط¨")}</Link>
        <button onClick={() => onReorder({ ...order, items: data.items || [] })} className="min-h-12 rounded-full border border-[#d4af37]/30 bg-[#f8e7b3]/10 px-5 py-3 font-black text-[#d4af37]">{sfText("storefront.orders.reorder", "ط¥ط¹ط§ط¯ط© ط§ظ„ط·ظ„ط¨")}</button>
        <a href={supportHref(publicNumber)} className="min-h-12 rounded-full border border-emerald-200 bg-emerald-50 px-5 py-3 text-center font-black text-emerald-700">{sfText("storefront.support.whatsapp", "ظˆط§طھط³ط§ط¨")}</a>
      </div>
    </Panel>
  );
}

export function StorefrontAccountPage({ profile, setProfile, wishlist, recent, onAddToCart, helpers, components }) {
  const { sfText, displayOrderNumber } = helpers;
  const { Field, Panel, InfoBox, SmallProductList } = components;
  const savedIdentity = normalizeAccountIdentity(profile);
  const [customerAuth, setCustomerAuth] = useState(() => readStorefrontCustomerAuth());
  const [phone, setPhone] = useState(customerAuth.phone || savedIdentity.primary_phone || "");
  const [otpCode, setOtpCode] = useState("");
  const [account, setAccount] = useState(null);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [loading, setLoading] = useState(false);
  const [requestingOtp, setRequestingOtp] = useState(false);
  const [verifyingOtp, setVerifyingOtp] = useState(false);
  const [otpRequestedAt, setOtpRequestedAt] = useState(0);
  const [resendCountdown, setResendCountdown] = useState(0);
  const accountRefreshIntervalMs = selectedOrder ? 10 * 1000 : 30 * 1000;
  const hasCustomerToken = Boolean(customerAuth.token);
  const normalizedLoginPhone = normalizePhoneDigits(phone);

  useEffect(() => {
    if (customerAuth.phone || !savedIdentity.primary_phone) return;
    setPhone(savedIdentity.primary_phone);
  }, [customerAuth.phone, savedIdentity.primary_phone]);

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
    setOtpCode("");
    setOtpRequestedAt(0);
    setResendCountdown(0);
    setAccount(null);
    setSelectedOrder(null);
    setLoading(false);
    setRequestingOtp(false);
    setVerifyingOtp(false);
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
    toast.error("انتهت صلاحية الدخول. سجّل دخولك مرة أخرى.");
  }, [clearCustomerIdentity]);

  const load = useCallback(async ({ silent = false } = {}) => {
    const { token, phone: storedPhone } = readStorefrontCustomerAuth();
    if (!token) return null;
    const requestPhone = normalizePhoneDigits(storedPhone || phone);
    setLoading(true);
    try {
      const data = await storefrontCustomerRequest("/storefront/account");
      setAccount(data);
      setProfile((prev) => ({
        ...prev,
        primary_phone: requestPhone || prev.primary_phone || "",
        phone: requestPhone || prev.phone || "",
        customer_id: data.customer?.id || prev.customer_id || prev.id || "",
        full_name: data.customer?.name || prev.full_name || "",
      }));
      setCustomerAuth({ token, phone: requestPhone || storedPhone || "" });
      return data;
    } catch (error) {
      const status = Number(error?.status || error?.response?.status || 0);
      if (status === 401 || status === 403) {
        invalidateCustomerIdentity();
      }
      if (!silent) {
        toast.error(error.message || sfText("storefront.toasts.accountUnavailable", "لا يمكن فتح الحساب الآن."));
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
      toast.success("أرسلنا كود الدخول على واتساب");
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
      toast.error("الكود غير صحيح أو انتهت صلاحيته");
    } finally {
      setVerifyingOtp(false);
    }
  }, [load, otpCode, phone]);

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
  const authSummary = account?.customer?.name || profile.full_name || sfText("storefront.account.enterPhoneHint", "أدخل رقم هاتفك لعرض الحساب");
  const isRestoringAccount = hasCustomerToken && !account;
  const showOtpLogin = !hasCustomerToken;

  return (
    <section className="mx-auto max-w-7xl px-4 py-5 md:py-8">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-black text-[#d4af37]">{sfText("storefront.account.eyebrow", "حساب سريع برقم الهاتف")}</p>
          <h1 className="text-3xl font-black md:text-5xl">{sfText("storefront.account.title", "حسابي")}</h1>
        </div>
        <Link to="/shop/track" className="sf-soft-pill inline-flex min-h-12 items-center justify-center rounded-full border border-stone-300 bg-white px-5 py-3 font-black">{sfText("storefront.orders.trackOrder", "تتبع الطلب")}</Link>
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-[340px_1fr]">
        <div className="sf-storefront-card h-max rounded-[1.7rem] border border-stone-200 bg-white p-5 shadow-[0_18px_50px_rgba(39,20,75,0.07)] lg:sticky lg:top-24">
          <div className="flex items-start gap-3 rounded-2xl bg-stone-50 p-4">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-stone-950 text-white">
              <ShieldCheck className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <div className="text-sm font-black text-stone-900">تسجيل الدخول عبر واتساب</div>
              <p className="mt-1 text-sm font-bold leading-6 text-stone-500">أدخل رقم الهاتف ثم اطلب كود الدخول لعرض الطلبات والعناوين والمفضلة.</p>
            </div>
          </div>
          <div className="mt-4 space-y-3">
            {showOtpLogin ? (
              <>
                <Field label={sfText("storefront.form.mobileNumber", "رقم الهاتف")} value={phone} onChange={setPhone} inputMode="tel" />
                {!otpRequestedAt ? (
                  <button
                    onClick={requestOtp}
                    disabled={requestingOtp || !normalizedLoginPhone}
                    className="min-h-12 w-full rounded-full bg-stone-950 px-5 py-3 font-black text-white disabled:bg-stone-300"
                  >
                    {requestingOtp ? (
                      <span className="inline-flex items-center justify-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        جارٍ الإرسال...
                      </span>
                    ) : (
                      "إرسال كود واتساب"
                    )}
                  </button>
                ) : (
                  <>
                    <Field
                      label="كود OTP"
                      value={otpCode}
                      onChange={(value) => setOtpCode(String(value || "").replace(/\D/g, "").slice(0, 6))}
                      inputMode="numeric"
                    />
                    <button
                      onClick={verifyOtp}
                      disabled={verifyingOtp || String(otpCode || "").replace(/\D/g, "").length !== 6}
                      className="min-h-12 w-full rounded-full bg-stone-950 px-5 py-3 font-black text-white disabled:bg-stone-300"
                    >
                      {verifyingOtp ? (
                        <span className="inline-flex items-center justify-center gap-2">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          جارٍ التحقق...
                        </span>
                      ) : (
                        "تأكيد الدخول"
                      )}
                    </button>
                    <button
                      onClick={requestOtp}
                      disabled={requestingOtp || resendCountdown > 0}
                      className="min-h-11 w-full rounded-full border border-stone-200 bg-white px-5 py-3 text-sm font-black text-stone-600 transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <span className="inline-flex items-center justify-center gap-2">
                        <RefreshCcw className="h-4 w-4" />
                        {resendCountdown > 0 ? `إعادة الإرسال بعد ${resendCountdown} ثانية` : "إعادة إرسال الكود"}
                      </span>
                    </button>
                    <p className="text-xs font-bold leading-6 text-stone-500">أرسلنا كود الدخول على واتساب. أدخل الكود المكوّن من 6 أرقام خلال 5 دقائق.</p>
                  </>
                )}
              </>
            ) : isRestoringAccount ? (
              <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-5">
                <div className="flex items-center gap-3">
                  <Loader2 className="h-5 w-5 animate-spin text-stone-500" />
                  <div>
                    <div className="text-sm font-black text-stone-900">جارٍ استعادة حسابك</div>
                    <p className="mt-1 text-sm font-bold leading-6 text-stone-500">نستخدم Remember Me لعرض بياناتك مباشرة.</p>
                  </div>
                </div>
              </div>
            ) : null}
            <button
              onClick={clearCustomerIdentity}
              type="button"
              className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full border border-stone-200 bg-white px-5 py-3 text-sm font-black text-stone-600 transition hover:bg-stone-50"
            >
              <LogOut className="h-4 w-4" />
              تسجيل الخروج
            </button>
          </div>
          <div className="mt-4">
            <InfoBox label={sfText("storefront.account.myData", "بياناتي")} value={hasCustomerToken ? authSummary : "أدخل رقم هاتفك ثم فعّل OTP لعرض الحساب"} />
            {hasCustomerToken ? <LoyaltyWidget loyalty={account?.loyalty} loading={loading} helpers={helpers} /> : null}
          </div>
        </div>
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
              <Panel title={sfText("storefront.account.recentlyViewed", "شاهد مؤخرًا")}>
                <SmallProductList items={backendRecent.length ? backendRecent : recent} empty={sfText("storefront.account.recentEmpty", "ستظهر المنتجات التي شاهدتها مؤخرًا هنا")} />
              </Panel>
            </>
          ) : (
            <Panel title="حسابك محمي">
              <div className="rounded-2xl bg-stone-50 p-4 font-bold leading-7 text-stone-600">
                سجّل الدخول عبر OTP لعرض الطلبات، العناوين، المفضلة، والمنتجات التي تمت مشاهدتها.
              </div>
            </Panel>
          )}
        </div>
      </div>
    </section>
  );
}
