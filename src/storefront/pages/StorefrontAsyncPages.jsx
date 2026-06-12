import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import toast from "react-hot-toast";
import i18n from "../../i18n/i18n";
import { api } from "../../shared/api/api";
import { VirtualList } from "../../shared/components/VirtualList";
import {
  Bell,
  Crown,
  Gem,
  MessageCircle,
  Minus,
  PackageSearch,
  Trash2,
} from "lucide-react";

const storefrontAsyncDebugLog = (label, payload = {}) => {
  if (!import.meta.env.DEV) return;
  console.log(label, payload);
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

function TrackingResult({ data, helpers, components }) {
  const { sfText, displayOrderNumber, statusCopy, formatDate, money, paymentCopy, shippingProviderCopy, supportHref, getStatusLabels } = helpers;
  const { InfoBox, OrderTimeline, OrderNumberBadge } = components;
  const order = data.order || {};
  const items = data.items || [];
  const timeline = data.timeline || getStatusLabels().map((label, index) => ({ label, done: index === 0 }));
  const total = order.total_amount || order.total || order.total_price || 0;
  const address = [order.governorate, order.city_area, order.customer_address, order.landmark].filter(Boolean).join(" - ");
  const publicNumber = displayOrderNumber(order);
  return (
    <div className="sf-storefront-card sf-tracking-result mt-5 overflow-hidden rounded-[2rem] border border-stone-200 bg-white shadow-[0_18px_50px_rgba(39,20,75,0.07)]">
      <div className="sf-card-section border-b border-stone-100 p-5 md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="sf-muted-text text-sm font-bold text-stone-500">{sfText("storefront.orders.orderNumber", "رقم الطلب")}</div>
            <OrderNumberBadge value={publicNumber} className="mt-2 border-[#7c3aed]/20 bg-[#7c3aed]/10 text-[#5b21b6]" />
          </div>
          <span className="rounded-full bg-stone-950 px-4 py-2 text-sm font-black text-white">{statusCopy(order.status || order.shipping_status || "pending")}</span>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <InfoBox label={sfText("storefront.customer.customer", "Customer")} value={order.customer_name || sfText("storefront.customer.dearCustomer", "Dear customer")} />
          <InfoBox label={sfText("storefront.orders.orderDate", "Order date")} value={formatDate(order.created_at)} />
          <InfoBox label={sfText("storefront.checkout.total", "Total")} value={money(total)} />
          <InfoBox label={sfText("storefront.checkout.paymentMethod", "Payment")} value={`${paymentCopy(order.payment_method)} - ${statusCopy(order.payment_status || "pending")}`} />
          <InfoBox label={sfText("storefront.shipping.provider", "Shipping provider")} value={shippingProviderCopy(order.shipping_provider)} />
          <InfoBox label={sfText("storefront.shipping.trackingNumber", "Tracking number")} value={order.tracking_number || sfText("storefront.common.soon", "Soon")} />
          <InfoBox label={sfText("storefront.shipping.status", "Shipping status")} value={statusCopy(order.shipping_status || "pending")} />
          <InfoBox label={sfText("storefront.checkout.deliveryAddress", "Address")} value={address || sfText("storefront.orders.addressSaved", "Address saved with order")} />
        </div>
      </div>
      <div className="p-5 md:p-6">
        <h2 className="sf-section-heading text-xl font-black">{sfText("storefront.orders.tracking", "Order tracking")}</h2>
        <OrderTimeline timeline={timeline} />
        <OrderItemsSummaryLocal items={items} helpers={helpers} />
        <a href={supportHref(publicNumber)} className="mt-5 inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-emerald-600 px-5 py-3 font-black text-white">
          <MessageCircle className="h-5 w-5" />
          {sfText("storefront.support.needHelpWhatsapp", "Need help? Contact us on WhatsApp")}
        </a>
      </div>
    </div>
  );
}

export function TrackOrderPage({ helpers, components }) {
  const { sfText, displayOrderNumber, supportHref, deferReactState } = helpers;
  const { Field, EmptyState } = components;
  const [params] = useSearchParams();
  const [form, setForm] = useState({ order_number: displayOrderNumber(params.get("order_number") || params.get("order") || ""), phone: params.get("phone") || "" });
  const [state, setState] = useState({ loading: false, data: null, error: "" });
  const hasOrderFromQuery = Boolean(params.get("order") || params.get("order_number"));

  const submit = useCallback(async (event) => {
    event?.preventDefault();
    if (!form.order_number.trim()) {
      setState({ loading: false, data: null, error: sfText("storefront.tracking.validation.orderNumberRequired", "Enter the order number first") });
      return;
    }
    setState({ loading: true, data: null, error: "" });
    try {
      const data = await api.get(`/storefront/track?order_number=${encodeURIComponent(form.order_number)}&phone=${encodeURIComponent(form.phone)}`);
      setState({ loading: false, data, error: "" });
    } catch (error) {
      setState({ loading: false, data: null, error: error.message });
    }
  }, [form.order_number, form.phone, sfText]);

  useEffect(() => {
    if (!form.order_number || (!form.phone && !hasOrderFromQuery)) return undefined;
    let cancelled = false;
    deferReactState(() => {
      if (!cancelled) submit();
    });
    return () => {
      cancelled = true;
    };
  }, [deferReactState, form.order_number, form.phone, hasOrderFromQuery, submit]);

  return (
    <section className="mx-auto max-w-6xl px-4 py-5 md:py-8">
      <div className="rounded-[2rem] bg-stone-950 p-5 text-white shadow-[0_24px_70px_rgba(39,20,75,0.18)] md:p-8">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-black text-emerald-200">{sfText("storefront.tracking.eyebrow", "Your order is on the way")}</p>
            <h1 className="mt-2 text-3xl font-black md:text-5xl">{sfText("storefront.tracking.title", "Track order")}</h1>
            <p className="mt-2 max-w-2xl text-sm font-bold leading-7 text-stone-300">{sfText("storefront.tracking.subtitle", "Enter your order number and mobile number, or open the direct tracking link from your confirmation message.")}</p>
          </div>
          <a href={supportHref(form.order_number)} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-white/15 bg-white/10 px-5 py-3 text-sm font-black text-white">
            <MessageCircle className="h-5 w-5" />
            {sfText("storefront.support.needHelpWhatsapp", "Need help? Contact us on WhatsApp")}
          </a>
        </div>
      </div>
      <form onSubmit={submit} className="sf-storefront-card sf-track-search-form mt-5 grid gap-3 rounded-[1.7rem] border border-stone-200 bg-white p-4 shadow-[0_18px_50px_rgba(39,20,75,0.07)] md:grid-cols-[1fr_1fr_auto] md:p-5">
        <Field label={sfText("storefront.orders.orderNumber", "Order number")} value={form.order_number} onChange={(value) => setForm((prev) => ({ ...prev, order_number: value }))} required />
        <Field label={sfText("storefront.form.mobileNumber", "Mobile number")} value={form.phone} onChange={(value) => setForm((prev) => ({ ...prev, phone: value }))} inputMode="tel" />
        <button disabled={state.loading} className="min-h-13 self-end rounded-full bg-stone-950 px-7 py-4 font-black text-white transition hover:bg-[#6d28d9] disabled:bg-stone-300">{sfText("storefront.orders.trackOrder", "Track order")}</button>
      </form>
      {state.loading ? <div className="sf-storefront-card mt-5 h-32 animate-pulse rounded-3xl bg-white" /> : null}
      {!state.loading && !state.data && !state.error ? <EmptyState title={sfText("storefront.tracking.readyTitle", "Ready to check")} text={sfText("storefront.tracking.readyText", "Order number and shipping status will appear here after searching.")} /> : null}
      {state.error ? <EmptyState title={sfText("storefront.tracking.notFoundTitle", "We could not find the order")} text={state.error || sfText("storefront.tracking.notFoundText", "Check the order number and mobile number, or contact us on WhatsApp.")} /> : null}
      {state.data ? <TrackingResult data={state.data} helpers={helpers} components={components} /> : null}
    </section>
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
        <button onClick={open} className="sf-soft-pill min-h-11 rounded-full border border-stone-300 bg-white px-4 py-2 text-sm font-black">{sfText("storefront.orders.orderDetails", "Order details")}</button>
        <Link to={`/shop/track?order=${encodeURIComponent(publicNumber)}&phone=${encodeURIComponent(phone)}`} className="min-h-11 rounded-full bg-stone-950 px-4 py-2 text-center text-sm font-black text-white">{sfText("storefront.orders.trackOrder", "Track order")}</Link>
        <button onClick={reorderOrder} className="min-h-11 rounded-full border border-[#7c3aed]/30 bg-[#f5f3ff] px-4 py-2 text-sm font-black text-[#6d28d9]">{sfText("storefront.orders.reorder", "Reorder")}</button>
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
    <Panel title={sfText("storefront.orders.orderDetails", "Order details")}>
      <OrderNumberBadge value={publicNumber} className="mb-1 border-[#7c3aed]/20 bg-[#7c3aed]/10 text-[#5b21b6]" />
      <div className="grid gap-3 md:grid-cols-3">
        <InfoBox label={sfText("storefront.orders.orderStatus", "Order status")} value={statusCopy(order.status)} />
        <InfoBox label={sfText("storefront.checkout.paymentMethod", "Payment")} value={`${paymentCopy(order.payment_method)} - ${statusCopy(order.payment_status)}`} />
        <InfoBox label={sfText("storefront.checkout.shipping", "Shipping")} value={`${shippingProviderCopy(order.shipping_provider)} - ${statusCopy(order.shipping_status)}`} />
      </div>
      <OrderTimeline timeline={data.timeline || []} />
      <OrderItemsSummaryLocal items={data.items || []} helpers={helpers} />
      <div className="grid gap-2 sm:grid-cols-3">
        <Link to={`/shop/track?order=${encodeURIComponent(publicNumber)}&phone=${encodeURIComponent(phone)}`} className="min-h-12 rounded-full bg-stone-950 px-5 py-3 text-center font-black text-white">{sfText("storefront.orders.trackOrder", "Track order")}</Link>
        <button onClick={() => onReorder({ ...order, items: data.items || [] })} className="min-h-12 rounded-full border border-[#7c3aed]/30 bg-[#f5f3ff] px-5 py-3 font-black text-[#6d28d9]">{sfText("storefront.orders.reorder", "Reorder")}</button>
        <a href={supportHref(publicNumber)} className="min-h-12 rounded-full border border-emerald-200 bg-emerald-50 px-5 py-3 text-center font-black text-emerald-700">{sfText("storefront.support.whatsapp", "WhatsApp")}</a>
      </div>
    </Panel>
  );
}

export function AccountPageRoute({ profile, setProfile, wishlist, recent, onAddToCart, helpers, components }) {
  const { sfText, displayOrderNumber } = helpers;
  const { Field, Panel, InfoBox, SmallProductList } = components;
  const [phone, setPhone] = useState(profile.primary_phone || "");
  const [account, setAccount] = useState(null);
  const [loading, setLoading] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const accountRefreshIntervalMs = selectedOrder ? 10 * 1000 : 30 * 1000;

  const load = async () => {
    if (!phone) return;
    setLoading(true);
    try {
      const data = await api.get(`/storefront/account?phone=${encodeURIComponent(phone)}`);
      setAccount(data);
      setProfile((prev) => ({ ...prev, primary_phone: phone, full_name: data.customer?.name || prev.full_name || "" }));
    } catch (error) {
      toast.error(error.message || sfText("storefront.toasts.accountUnavailable", "We cannot open the account right now."));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!account || !phone) return undefined;
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return undefined;
    const id = window.setInterval(() => {
      api.get(`/storefront/account?phone=${encodeURIComponent(phone)}`)
        .then((data) => setAccount(data))
        .catch(() => undefined);
    }, accountRefreshIntervalMs);
    return () => window.clearInterval(id);
  }, [account, accountRefreshIntervalMs, phone]);

  useEffect(() => {
    if (!account || !phone || typeof document === "undefined") return undefined;
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      api.get(`/storefront/account?phone=${encodeURIComponent(phone)}`)
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

  const openOrder = async (order) => {
    setSelectedOrder({ loading: true, order, items: [], timeline: [] });
    try {
      const data = await api.get(`/storefront/track?order_number=${encodeURIComponent(displayOrderNumber(order))}&phone=${encodeURIComponent(phone)}`);
      setSelectedOrder(data);
    } catch {
      setSelectedOrder({ order, items: [], timeline: [] });
    }
  };

  const reorder = async (order) => {
    const sourceItems = order.items || selectedOrder?.items || [];
    let items = sourceItems;
    if (!items.length) {
      const data = await api.get(`/storefront/track?order_number=${encodeURIComponent(displayOrderNumber(order))}&phone=${encodeURIComponent(phone)}`);
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
      toast.error(sfText("storefront.toasts.reorderUnavailable", "These products are currently unavailable. Try different choices."));
    }
  };

  const orders = account?.orders || [];
  const addresses = account?.addresses || [];
  const backendWishlist = account?.wishlist_products || [];
  const backendRecent = account?.recent_products || [];

  return (
    <section className="mx-auto max-w-7xl px-4 py-5 md:py-8">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-black text-[#6d28d9]">{sfText("storefront.account.eyebrow", "Light account by mobile")}</p>
          <h1 className="text-3xl font-black md:text-5xl">{sfText("storefront.account.title", "My account")}</h1>
        </div>
        <Link to="/shop/track" className="sf-soft-pill inline-flex min-h-12 items-center justify-center rounded-full border border-stone-300 bg-white px-5 py-3 font-black">{sfText("storefront.orders.trackOrder", "Track order")}</Link>
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-[340px_1fr]">
        <div className="sf-storefront-card h-max rounded-[1.7rem] border border-stone-200 bg-white p-5 shadow-[0_18px_50px_rgba(39,20,75,0.07)] lg:sticky lg:top-24">
          <Field label={sfText("storefront.form.mobileNumber", "Mobile number")} value={phone} onChange={setPhone} inputMode="tel" />
          <button onClick={load} disabled={loading} className="mt-3 min-h-12 w-full rounded-full bg-stone-950 px-5 py-3 font-black text-white disabled:bg-stone-300">{loading ? sfText("storefront.common.loading", "Loading...") : sfText("storefront.account.showMyData", "Show my details")}</button>
          <InfoBox label={sfText("storefront.account.myData", "My details")} value={account?.customer?.name || profile.full_name || sfText("storefront.account.enterPhoneHint", "Enter your phone to view the account")} />
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
          <Panel title={sfText("storefront.account.myAddresses", "My addresses")}>
            {addresses.length ? addresses.map((address) => <div key={address} className="sf-account-address-row rounded-2xl bg-stone-50 p-3 font-bold text-stone-700">{address}</div>) : <p className="sf-muted-empty font-bold text-stone-500">{sfText("storefront.account.addressesEmpty", "Addresses used in orders will appear here")}</p>}
          </Panel>
          <Panel title={sfText("storefront.header.wishlist", "Wishlist")}>
            <SmallProductList items={backendWishlist.length ? backendWishlist : wishlist} empty={sfText("storefront.account.wishlistEmpty", "Save products you like here")} />
          </Panel>
          <Panel title={sfText("storefront.account.recentlyViewed", "Recently viewed")}>
            <SmallProductList items={backendRecent.length ? backendRecent : recent} empty={sfText("storefront.account.recentEmpty", "Recently viewed products will appear here")} />
          </Panel>
        </div>
      </div>
    </section>
  );
}

export function WishlistPageRoute({ wishlist, toggleWishlist, onAddToCart, helpers, components }) {
  const { sfText } = helpers;
  const { EmptyState, SmallProductGrid } = components;
  const wishlistCount = Array.isArray(wishlist) ? wishlist.length : 0;
  return (
    <section className="mx-auto w-full max-w-7xl px-3 py-6 sm:px-4 md:px-6 md:py-10">
      <div className="rounded-[2rem] border border-white/[0.08] bg-[linear-gradient(145deg,rgba(15,23,42,0.82),rgba(3,7,18,0.94))] p-4 shadow-[0_28px_90px_rgba(0,0,0,0.34)] backdrop-blur-xl md:p-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-black text-[#a78bfa]">{sfText("storefront.wishlist.subtitle", "Your favorite picks are saved here")}</p>
            <h1 className="mt-1 text-3xl font-black text-white md:text-5xl">{sfText("storefront.header.wishlist", "Wishlist")}</h1>
          </div>
          <div className="w-fit rounded-full border border-white/[0.1] bg-white/[0.07] px-4 py-2 text-sm font-black text-white/80 shadow-[0_12px_32px_rgba(0,0,0,0.2)]">
            {sfText("storefront.products.productCount", "{{count}} product", { count: wishlistCount })}
          </div>
        </div>

        {wishlistCount ? (
          <>
            <SmallProductGrid items={wishlist} action={toggleWishlist} onAddToCart={onAddToCart} />
            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <div className="flex items-start gap-4 rounded-[1.5rem] border border-white/[0.08] bg-white/[0.055] p-5 text-start shadow-[0_18px_50px_rgba(0,0,0,0.22)] ring-1 ring-white/[0.025] backdrop-blur-xl">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-[#a78bfa]/20 bg-[#7c3aed]/15 text-[#c4b5fd]">
                  <Bell className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <div className="font-black text-white">{sfText("storefront.wishlist.priceDropAlert", "Price drop alert")}</div>
                  <p className="mt-1 text-sm font-bold leading-6 text-white/60">{sfText("storefront.wishlist.priceDropSoon", "Soon we will notify you when a wishlist product price drops.")}</p>
                </div>
              </div>
              <div className="flex items-start gap-4 rounded-[1.5rem] border border-white/[0.08] bg-white/[0.055] p-5 text-start shadow-[0_18px_50px_rgba(0,0,0,0.22)] ring-1 ring-white/[0.025] backdrop-blur-xl">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-emerald-300/20 bg-emerald-400/10 text-emerald-200">
                  <PackageSearch className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <div className="font-black text-white">{sfText("storefront.wishlist.backInStockAlert", "Back in stock alert")}</div>
                  <p className="mt-1 text-sm font-bold leading-6 text-white/60">{sfText("storefront.wishlist.backInStockSoon", "Soon we will notify you when your size returns.")}</p>
                </div>
              </div>
            </div>
          </>
        ) : <EmptyState title={sfText("storefront.wishlist.emptyTitle", "Your wishlist is empty")} text={sfText("storefront.wishlist.emptyText", "Save products you like here")} />}
      </div>
    </section>
  );
}

export function RecentPageRoute({ recent, helpers, components }) {
  const { sfText } = helpers;
  const { EmptyState, SmallProductGrid } = components;
  return (
    <section className="mx-auto max-w-7xl px-4 py-5 md:py-8">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-black text-[#6d28d9]">{sfText("storefront.recent.lastTwenty", "Last 20 products")}</p>
          <h1 className="text-3xl font-black md:text-5xl">{sfText("storefront.account.recentlyViewed", "Recently viewed")}</h1>
        </div>
        <Link to="/shop/products" className="inline-flex min-h-12 items-center justify-center rounded-full bg-stone-950 px-5 py-3 font-black text-white">{sfText("storefront.common.continueShopping", "Continue shopping")}</Link>
      </div>
      {recent.length ? <SmallProductGrid items={recent.slice(0, 20)} /> : <EmptyState title={sfText("storefront.recent.emptyTitle", "No products here yet")} text={sfText("storefront.account.recentEmpty", "Recently viewed products will appear here")} />}
    </section>
  );
}

function CartContent({ cart, updateCart, removeFromCart, helpers, components }) {
  const { sfText, money, displayCartItemPrice, displayCartItemComparePrice, imageFor, fallbackProductImage } = helpers;
  const { EmptyState, SummaryRow } = components;
  const subtotal = cart.reduce((sum, item) => sum + displayCartItemPrice(item) * item.quantity, 0);
  if (!cart.length) return <EmptyState title={sfText("storefront.cart.emptyTitle", "Your cart is waiting")} text={sfText("storefront.cart.emptyText", "Start from products and check the latest drops")} />;
  return (
    <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_320px]">
      <div className="space-y-3">
        {cart.map((item) => (
        <div key={item.lineId} className="sf-order-item-row flex gap-3 rounded-3xl border border-stone-200 bg-white p-3">
            <img src={imageFor(item.image_url)} onError={fallbackProductImage} alt="" className="h-24 w-24 rounded-2xl object-cover" loading="lazy" decoding="async" width="96" height="96" />
            <div className="min-w-0 flex-1">
              <div className="font-black">{item.name}</div>
              <div className="mt-1 text-xs font-bold text-stone-500">{item.color || sfText("storefront.products.color", "Color")} / {item.size || sfText("storefront.products.size", "Size")}</div>
              <div className="mt-2 flex flex-wrap items-center gap-2 font-black">
                {displayCartItemComparePrice(item) ? <span className="text-sm text-stone-400 line-through">{money(displayCartItemComparePrice(item))}</span> : null}
                <span>{money(displayCartItemPrice(item))}</span>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <button onClick={() => updateCart(item.lineId, item.quantity - 1)} className="rounded-full border border-stone-200 p-2"><Minus className="h-4 w-4" /></button>
                <span className="w-7 text-center font-black">{item.quantity}</span>
                <button onClick={() => updateCart(item.lineId, item.quantity + 1)} className="rounded-full border border-stone-200 px-3 py-1.5">+</button>
                <button onClick={() => removeFromCart(item.lineId)} className="ms-auto rounded-full p-2 text-rose-600" aria-label={sfText("storefront.cart.removeItem", "Remove item")}><Trash2 className="h-5 w-5" /></button>
              </div>
            </div>
          </div>
        ))}
      </div>
      <aside className="sf-storefront-card h-max rounded-3xl border border-stone-200 bg-white p-5">
        <h2 className="text-xl font-black">{sfText("storefront.checkout.orderSummary", "Order summary")}</h2>
        <SummaryRow label={sfText("storefront.checkout.products", "Products")} value={money(subtotal)} />
        <SummaryRow label={sfText("storefront.checkout.estimatedShipping", "Estimated shipping")} value={money(0)} />
        <SummaryRow label={sfText("storefront.checkout.total", "Total")} value={money(subtotal)} strong />
        <Link to="/shop/checkout" className="mt-5 block rounded-full bg-stone-950 px-5 py-4 text-center font-black text-white">{sfText("storefront.checkout.actions.completePurchase", "Complete purchase")}</Link>
        <p className="mt-3 text-xs font-bold text-stone-500">{sfText("storefront.checkout.finalCostNote", "The final cost appears on the checkout page based on governorate.")}</p>
      </aside>
    </div>
  );
}

export function CartPageRoute({ cart, updateCart, removeFromCart, helpers, components }) {
  const { sfText } = helpers;
  return (
    <section className="mx-auto max-w-5xl px-4 py-6">
      <h1 className="text-3xl font-black">{sfText("storefront.cart.title", "Cart")}</h1>
      <CartContent cart={cart} updateCart={updateCart} removeFromCart={removeFromCart} helpers={helpers} components={components} />
    </section>
  );
}
