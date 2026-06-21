import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";
import i18n from "../../i18n/i18n";
import { api } from "../../shared/api/api";
import { VirtualList } from "../../shared/components/VirtualList";
import {
  Crown,
  Gem,
} from "lucide-react";

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
            <div className="sf-order-item-meta text-xs font-bold text-stone-500">{item.color || sfText("storefront.products.color", "اللون")} / {item.size || sfText("storefront.products.size", "المقاس")} أ— {item.quantity}</div>
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
    <div className="sf-loyalty-card mt-4 overflow-hidden rounded-[1.35rem] border border-[#7c3aed]/20 bg-[#faf7ff] p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="sf-loyalty-icon grid h-10 w-10 place-items-center rounded-full bg-white text-[#6d28d9] shadow-sm">
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
        <div className="h-full rounded-full bg-[#7c3aed] transition-all duration-700" style={{ width: `${progress}%` }} />
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
          <OrderNumberBadge value={order} className="border-[#7c3aed]/20 bg-[#7c3aed]/10 text-[#5b21b6]" />
          <div className="sf-muted-text mt-1 text-xs font-bold text-stone-500">{formatDate(order.created_at)} - {statusCopy(order.status)}</div>
        </div>
        <div className="sf-primary-text font-black">{money(order.total_amount || order.total || order.total_price)}</div>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <button onClick={open} className="sf-soft-pill min-h-11 rounded-full border border-stone-300 bg-white px-4 py-2 text-sm font-black">{sfText("storefront.orders.orderDetails", "تفاصيل الطلب")}</button>
        <Link to={`/shop/track?order=${encodeURIComponent(publicNumber)}&phone=${encodeURIComponent(phone)}`} className="min-h-11 rounded-full bg-stone-950 px-4 py-2 text-center text-sm font-black text-white">{sfText("storefront.orders.trackOrder", "تتبع الطلب")}</Link>
        <button onClick={reorderOrder} className="min-h-11 rounded-full border border-[#7c3aed]/30 bg-[#f5f3ff] px-4 py-2 text-sm font-black text-[#6d28d9]">{sfText("storefront.orders.reorder", "إعادة الطلب")}</button>
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
      <OrderNumberBadge value={publicNumber} className="mb-1 border-[#7c3aed]/20 bg-[#7c3aed]/10 text-[#5b21b6]" />
      <div className="grid gap-3 md:grid-cols-3">
        <InfoBox label={sfText("storefront.orders.orderStatus", "حالة الطلب")} value={statusCopy(order.status)} />
        <InfoBox label={sfText("storefront.checkout.paymentMethod", "Payment")} value={`${paymentCopy(order.payment_method)} - ${statusCopy(order.payment_status)}`} />
        <InfoBox label={sfText("storefront.checkout.shipping", "Shipping")} value={`${shippingProviderCopy(order.shipping_provider)} - ${statusCopy(order.shipping_status)}`} />
      </div>
      <OrderTimeline timeline={data.timeline || []} />
      <OrderItemsSummaryLocal items={data.items || []} helpers={helpers} />
      <div className="grid gap-2 sm:grid-cols-3">
        <Link to={`/shop/track?order=${encodeURIComponent(publicNumber)}&phone=${encodeURIComponent(phone)}`} className="min-h-12 rounded-full bg-stone-950 px-5 py-3 text-center font-black text-white">{sfText("storefront.orders.trackOrder", "تتبع الطلب")}</Link>
        <button onClick={() => onReorder({ ...order, items: data.items || [] })} className="min-h-12 rounded-full border border-[#7c3aed]/30 bg-[#f5f3ff] px-5 py-3 font-black text-[#6d28d9]">{sfText("storefront.orders.reorder", "إعادة الطلب")}</button>
        <a href={supportHref(publicNumber)} className="min-h-12 rounded-full border border-emerald-200 bg-emerald-50 px-5 py-3 text-center font-black text-emerald-700">{sfText("storefront.support.whatsapp", "واتساب")}</a>
      </div>
    </Panel>
  );
}

export function StorefrontAccountPage({ profile, setProfile, wishlist, recent, onAddToCart, helpers, components }) {
  const { sfText, displayOrderNumber } = helpers;
  const { Field, Panel, InfoBox, SmallProductList } = components;
  const savedIdentity = normalizeAccountIdentity(profile);
  const [phone, setPhone] = useState(savedIdentity.primary_phone || "");
  const [account, setAccount] = useState(null);
  const [loading, setLoading] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const lastAutoLoadedPhoneRef = useRef("");
  const autoLoadTriggeredRef = useRef("");
  const accountRefreshIntervalMs = selectedOrder ? 10 * 1000 : 30 * 1000;

  useEffect(() => {
    if (!savedIdentity.primary_phone) return;
    if (phone) return;
    setPhone(savedIdentity.primary_phone);
  }, [phone, savedIdentity.primary_phone]);

  const clearCustomerIdentity = useCallback(() => {
    lastAutoLoadedPhoneRef.current = "";
    clearAccountIdentityStorage();
    setPhone("");
    setAccount(null);
    setSelectedOrder(null);
    setProfile((prev) => ({
      ...prev,
      full_name: "",
      primary_phone: "",
      phone: "",
      customer_id: "",
    }));
  }, [setProfile]);

  const load = useCallback(async ({ silent = false, source = "manual", phoneOverride = "" } = {}) => {
    const normalizedPhone = normalizePhoneDigits(phoneOverride || phone);
    if (!normalizedPhone) {
      clearCustomerIdentity();
      return null;
    }
    if (source === "auto" && lastAutoLoadedPhoneRef.current === normalizedPhone) {
      return null;
    }
    setLoading(true);
    try {
      const data = await api.get(`/storefront/account?phone=${encodeURIComponent(normalizedPhone)}`);
      lastAutoLoadedPhoneRef.current = normalizedPhone;
      setAccount(data);
      setProfile((prev) => ({
        ...prev,
        primary_phone: normalizedPhone,
        phone: normalizedPhone,
        customer_id: data.customer?.id || prev.customer_id || prev.id || "",
        full_name: data.customer?.name || prev.full_name || "",
      }));
    } catch (error) {
      const status = Number(error?.status || error?.response?.status || 0);
      const responseCode = String(error?.responseBody?.code || error?.responseBody?.error || error?.code || "").toUpperCase();
      const shouldClearIdentity =
        status === 400 ||
        status === 404 ||
        status === 410 ||
        responseCode.includes("INVALID") ||
        responseCode.includes("NOT_FOUND") ||
        responseCode.includes("EXPIRED");
      if (shouldClearIdentity) {
        clearCustomerIdentity();
      }
      if (!silent) {
        toast.error(error.message || sfText("storefront.toasts.accountUnavailable", "لا يمكن فتح الحساب الآن."));
      }
    } finally {
      setLoading(false);
    }
  }, [clearCustomerIdentity, phone, setProfile, sfText]);

  useEffect(() => {
    const normalizedPhone = normalizePhoneDigits(savedIdentity.primary_phone || "");
    if (!normalizedPhone) return;
    if (account || loading) return;
    if (autoLoadTriggeredRef.current === normalizedPhone) return;
    autoLoadTriggeredRef.current = normalizedPhone;
    if (normalizePhoneDigits(phone) !== normalizedPhone) {
      setPhone(normalizedPhone);
    }
    load({ silent: true, source: "auto", phoneOverride: normalizedPhone });
  }, [account, load, loading, phone, savedIdentity.primary_phone]);

  useEffect(() => {
    if (!account || !phone) return undefined;
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return undefined;
    const id = window.setInterval(() => {
      api.get(`/storefront/account?phone=${encodeURIComponent(normalizePhoneDigits(phone))}`)
        .then((data) => setAccount(data))
        .catch(() => undefined);
    }, accountRefreshIntervalMs);
    return () => window.clearInterval(id);
  }, [account, accountRefreshIntervalMs, phone]);

  useEffect(() => {
    if (!account || !phone || typeof document === "undefined") return undefined;
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      api.get(`/storefront/account?phone=${encodeURIComponent(normalizePhoneDigits(phone))}`)
        .then((data) => setAccount(data))
        .catch(() => undefined);
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [account, phone]);

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
      const data = await api.get(`/storefront/track?order_number=${encodeURIComponent(displayOrderNumber(order))}&phone=${encodeURIComponent(normalizePhoneDigits(phone))}`);
      setSelectedOrder(data);
    } catch {
      setSelectedOrder({ order, items: [], timeline: [] });
    }
  }, [displayOrderNumber, phone]);

  const reorder = useCallback(async (order) => {
    const sourceItems = order.items || selectedOrder?.items || [];
    let items = sourceItems;
    if (!items.length) {
      const data = await api.get(`/storefront/track?order_number=${encodeURIComponent(displayOrderNumber(order))}&phone=${encodeURIComponent(normalizePhoneDigits(phone))}`);
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
  }, [displayOrderNumber, loadProductsForReorder, onAddToCart, phone, selectedOrder?.items, sfText]);

  const orders = account?.orders || [];
  const addresses = account?.addresses || [];
  const backendWishlist = account?.wishlist_products || [];
  const backendRecent = account?.recent_products || [];

  return (
    <section className="mx-auto max-w-7xl px-4 py-5 md:py-8">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-black text-[#6d28d9]">{sfText("storefront.account.eyebrow", "حساب سريع برقم الهاتف")}</p>
          <h1 className="text-3xl font-black md:text-5xl">{sfText("storefront.account.title", "حسابي")}</h1>
        </div>
        <Link to="/shop/track" className="sf-soft-pill inline-flex min-h-12 items-center justify-center rounded-full border border-stone-300 bg-white px-5 py-3 font-black">{sfText("storefront.orders.trackOrder", "تتبع الطلب")}</Link>
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-[340px_1fr]">
        <div className="sf-storefront-card h-max rounded-[1.7rem] border border-stone-200 bg-white p-5 shadow-[0_18px_50px_rgba(39,20,75,0.07)] lg:sticky lg:top-24">
          <Field label={sfText("storefront.form.mobileNumber", "رقم الهاتف")} value={phone} onChange={setPhone} inputMode="tel" />
          <button onClick={() => load({ source: "manual" })} disabled={loading} className="mt-3 min-h-12 w-full rounded-full bg-stone-950 px-5 py-3 font-black text-white disabled:bg-stone-300">{loading ? sfText("storefront.common.loading", "جارٍ التحميل...") : sfText("storefront.account.showMyData", "عرض بياناتي")}</button>
          <button onClick={clearCustomerIdentity} type="button" className="mt-2 min-h-11 w-full rounded-full border border-stone-200 bg-white px-5 py-3 text-sm font-black text-stone-600 transition hover:bg-stone-50">{sfText("storefront.account.changePhone", "تغيير الرقم")}</button>
          <InfoBox label={sfText("storefront.account.myData", "بياناتي")} value={account?.customer?.name || profile.full_name || sfText("storefront.account.enterPhoneHint", "أدخل رقم هاتفك لعرض الحساب")} />
          <LoyaltyWidget loyalty={account?.loyalty} loading={loading} helpers={helpers} />
        </div>
        <div className="space-y-5">
          <Panel title={sfText("storefront.account.myOrders", "My orders")}>
            {orders.length ? (
              <VirtualList
                items={orders}
                estimateSize={152}
                className="max-h-[28rem] overflow-auto pr-1"
                itemKey={(order) => order.id || displayOrderNumber(order)}
                renderItem={(order) => <AccountOrderRow order={order} phone={phone} onOpen={openOrder} onReorder={reorder} helpers={helpers} components={components} />}
              />
            ) : <p className="sf-muted-empty font-bold text-stone-500">{sfText("storefront.account.noOrders", "No orders yet")}</p>}
          </Panel>
          {selectedOrder ? <CustomerOrderDetails data={selectedOrder} phone={phone} onReorder={reorder} helpers={helpers} components={components} /> : null}
          <Panel title={sfText("storefront.account.myAddresses", "عناويني")}>
            {addresses.length ? addresses.map((address) => <div key={address} className="sf-account-address-row rounded-2xl bg-stone-50 p-3 font-bold text-stone-700">{address}</div>) : <p className="sf-muted-empty font-bold text-stone-500">{sfText("storefront.account.addressesEmpty", "ستظهر العناوين المستخدمة في الطلبات هنا")}</p>}
          </Panel>
          <Panel title={sfText("storefront.header.wishlist", "المفضلة")}>
            <SmallProductList items={backendWishlist.length ? backendWishlist : wishlist} empty={sfText("storefront.account.wishlistEmpty", "احفظ المنتجات التي تعجبك هنا")} />
          </Panel>
          <Panel title={sfText("storefront.account.recentlyViewed", "شوهد مؤخرًا")}>
            <SmallProductList items={backendRecent.length ? backendRecent : recent} empty={sfText("storefront.account.recentEmpty", "ستظهر المنتجات التي شاهدتها مؤخرًا هنا")} />
          </Panel>
        </div>
      </div>
    </section>
  );
}
