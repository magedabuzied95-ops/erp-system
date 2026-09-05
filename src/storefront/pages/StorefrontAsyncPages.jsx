import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../../shared/api/api";
import { sfText } from "../lib/sfText";
import { readStorefrontCustomerAuth, storefrontCustomerRequest } from "../lib/storefrontCustomerAuth";
import { trackGa4ViewCart } from "../lib/ga4Events";
import {
  Bell,
  MessageCircle,
  Minus,
  PackageSearch,
  Trash2,
} from "lucide-react";

const storefrontAsyncDebugLog = (label, payload = {}) => {
  if (!import.meta.env.DEV) return;
  console.log(label, payload);
};

const getBrandInitials = (value = "") => {
  const text = String(value || "").trim();
  if (!text) return "MONE";
  const parts = text.split(/\s+/).filter(Boolean);
  const initials = parts.length > 1 ? `${parts[0][0] || ""}${parts[parts.length - 1][0] || ""}` : text.slice(0, 2);
  return String(initials || "MONE").toUpperCase();
};

function OrderItemsSummaryLocal({ items = [], helpers }) {
  const { sfText, money, imageFor, fallbackProductImage } = helpers;
  if (!items.length) {
    return <p className="sf-muted-empty mt-4 rounded-2xl bg-stone-50 p-4 font-bold text-stone-500">{sfText("storefront.orders.itemsLoading", "سيظهر ملخص المنتجات هنا بعد تحميل تفاصيل الطلب.")}</p>;
  }
  return (
    <div className="sf-order-items mt-5 space-y-3">
      <h3 className="sf-section-heading text-lg font-black">{sfText("storefront.orders.itemsSummary", "ملخص المنتجات")}</h3>
      {items.map((item) => {
        const selectedVariantImage = item.variant_image
          || item.variant_image_url
          || item.color_image
          || item.color_image_url
          || item.image_url
          || item.product_image
          || item.product_image_url;
        return (
        <div key={item.id || `${item.product_id}-${item.variant_id}`} className="sf-order-item-row flex min-w-0 items-center gap-3 rounded-2xl bg-stone-50 p-3">
          <img src={imageFor(selectedVariantImage)} onError={fallbackProductImage} alt="" className="h-14 w-14 shrink-0 rounded-2xl object-cover" loading="lazy" decoding="async" width="56" height="56" />
          <div className="min-w-0 flex-1">
            <div className="sf-order-item-name truncate font-black">{item.product_name || item.name}</div>
            <div className="sf-order-item-meta text-xs font-bold text-stone-500">{item.color || sfText("storefront.products.color", "اللون")} / {item.size || sfText("storefront.products.size", "المقاس")} أ— {item.quantity}</div>
          </div>
          <div className="sf-order-item-price shrink-0 font-black">{money(item.total_amount || Number(item.price || item.sale_price || 0) * Number(item.quantity || 1))}</div>
        </div>
        );
      })}
    </div>
  );
}

function TrackingResult({ data, helpers, components }) {
  const { sfText, displayOrderNumber, statusCopy, formatDate, money, paymentCopy, shippingProviderCopy, supportHref, getStatusLabels } = helpers;
  const { InfoBox, OrderTimeline, OrderNumberBadge } = components;
  const brandName = String(helpers.brandName || "MONE").trim() || "MONE";
  const brandLogoUrl = String(helpers.brandLogoUrl || "").trim();
  const brandInitials = String(helpers.brandInitials || getBrandInitials(brandName)).trim() || getBrandInitials(brandName);
  const order = data.order || {};
  const items = data.items || [];
  const timeline = data.timeline || getStatusLabels().map((label, index) => ({ label, done: index === 0 }));
  const total = order.total_amount || order.total || order.total_price || 0;
  const address = [order.governorate, order.city_area, order.customer_address, order.landmark].filter(Boolean).join(" - ");
  const publicNumber = displayOrderNumber(order);
  return (
    <div className="sf-storefront-card sf-tracking-result mt-5 overflow-hidden rounded-[2rem] border border-stone-200 bg-white shadow-[0_18px_50px_rgba(39,20,75,0.07)]">
      <div className="sf-card-section border-b border-stone-100 p-5 md:p-6">
        <div className="mb-4 flex items-center gap-3">
          <div className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-2xl border border-stone-200 bg-white">
            {brandLogoUrl ? (
              <img src={brandLogoUrl} alt={brandName} className="h-full w-full object-contain p-2" loading="lazy" decoding="async" />
            ) : (
              <span className="text-xs font-black tracking-[0.18em] text-stone-700">{brandInitials}</span>
            )}
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-black text-stone-950">{brandName}</div>
            <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-stone-500">{sfText("storefront.tracking.brandLabel", "Order tracking")}</div>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="sf-muted-text text-sm font-bold text-stone-500">{sfText("storefront.orders.orderNumber", "رقم الطلب")}</div>
            <OrderNumberBadge value={publicNumber} className="mt-2 border-[#d4af37]/20 bg-[#d4af37]/10 text-[#d4af37]" />
          </div>
          <span className="rounded-full bg-stone-950 px-4 py-2 text-sm font-black text-white">{statusCopy(order.status || order.shipping_status || "pending")}</span>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <InfoBox label={sfText("storefront.customer.customer", "العميل")} value={order.customer_name || sfText("storefront.customer.dearCustomer", "عميلنا الكريم")} />
          <InfoBox label={sfText("storefront.orders.orderDate", "تاريخ الطلب")} value={formatDate(order.created_at)} />
          <InfoBox label={sfText("storefront.checkout.total", "الإجمالي")} value={money(total)} />
          <InfoBox label={sfText("storefront.checkout.paymentMethod", "طريقة الدفع")} value={`${paymentCopy(order.payment_method)} - ${statusCopy(order.payment_status || "pending")}`} />
          <InfoBox label={sfText("storefront.shipping.trackingNumber", "رقم التتبع")} value={order.tracking_number || sfText("storefront.common.soon", "قريبًا")} />
          <InfoBox label={sfText("storefront.shipping.status", "حالة الشحن")} value={statusCopy(order.shipping_status || "pending")} />
          <InfoBox label={sfText("storefront.checkout.deliveryAddress", "العنوان")} value={address || sfText("storefront.orders.addressSaved", "تم حفظ العنوان مع الطلب")} />
        </div>
      </div>
      <div className="p-5 md:p-6">
        <h2 className="sf-section-heading text-xl font-black">{sfText("storefront.orders.tracking", "Order tracking")}</h2>
        <OrderTimeline timeline={timeline} />
        <OrderItemsSummaryLocal items={items} helpers={helpers} />
        <a href={supportHref(publicNumber)} className="mt-5 inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-emerald-600 px-5 py-3 font-black text-white">
          <MessageCircle className="h-5 w-5" />
          {sfText("storefront.support.needHelpWhatsapp", "تحتاج مساعدة؟ تواصل معنا على واتساب")}
        </a>
      </div>
    </div>
  );
}

export function TrackOrderPage({ helpers, components }) {
  const { sfText, displayOrderNumber, supportHref, deferReactState } = helpers;
  const { Field, EmptyState } = components;
  const brandName = String(helpers.brandName || "MONE").trim() || "MONE";
  const brandLogoUrl = String(helpers.brandLogoUrl || "").trim();
  const brandInitials = String(helpers.brandInitials || getBrandInitials(brandName)).trim() || getBrandInitials(brandName);
  const [params] = useSearchParams();
  const [form, setForm] = useState({ order_number: displayOrderNumber(params.get("order_number") || params.get("order") || ""), phone: params.get("phone") || "" });
  const [state, setState] = useState({ loading: false, data: null, error: "" });
  const hasOrderFromQuery = Boolean(params.get("order") || params.get("order_number"));

  const submit = useCallback(async (event) => {
    event?.preventDefault();
    if (!form.order_number.trim()) {
      setState({ loading: false, data: null, error: sfText("storefront.tracking.validation.orderNumberRequired", "أدخل رقم الطلب أولًا") });
      return;
    }
    setState({ loading: true, data: null, error: "" });
    try {
      const { token, phone: storedPhone } = readStorefrontCustomerAuth();
      const params = {
        order_number: form.order_number,
        ...(token && storedPhone ? { phone: storedPhone } : form.phone ? { phone: form.phone } : {}),
      };
      const data = token
        ? await storefrontCustomerRequest("/storefront/track", { params })
        : await api.get(`/storefront/track?order_number=${encodeURIComponent(form.order_number)}&phone=${encodeURIComponent(form.phone)}`);
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
      <div className="sf-track-hero rounded-[2rem] border border-white/10 bg-[linear-gradient(180deg,#050505_0%,#101010_45%,#151515_100%)] p-5 text-white shadow-[0_24px_64px_rgba(0,0,0,0.32)] md:p-8">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="mb-3 flex items-center gap-3">
              <div className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-2xl border border-white/10 bg-white/10">
                {brandLogoUrl ? (
                  <img src={brandLogoUrl} alt={brandName} className="h-full w-full object-contain p-2" loading="lazy" decoding="async" />
                ) : (
                  <span className="text-xs font-black tracking-[0.18em] text-white">{brandInitials}</span>
                )}
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-black text-white">{brandName}</div>
                <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-stone-400">{sfText("storefront.tracking.brandLabel", "Order tracking")}</div>
              </div>
            </div>
            <p className="text-sm font-black text-emerald-200">{sfText("storefront.tracking.eyebrow", "Your order is on the way")}</p>
            <h1 className="mt-2 text-3xl font-black md:text-5xl">{sfText("storefront.tracking.title", "تتبع الطلب")}</h1>
            <p className="mt-2 max-w-2xl text-sm font-bold leading-7 text-stone-300">{sfText("storefront.tracking.subtitle", "Enter your order number and mobile number, or open the direct tracking link from your confirmation message.")}</p>
          </div>
          <a href={supportHref(form.order_number)} className="sf-track-hero-support inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-white/15 bg-white/10 px-5 py-3 text-sm font-black text-white">
            <MessageCircle className="h-5 w-5" />
            {sfText("storefront.support.needHelpWhatsapp", "تحتاج مساعدة؟ تواصل معنا على واتساب")}
          </a>
        </div>
      </div>
      <form onSubmit={submit} className="sf-storefront-card sf-track-search-form mt-5 grid gap-3 rounded-[1.7rem] border border-white/10 bg-[linear-gradient(180deg,#050505_0%,#101010_45%,#151515_100%)] p-4 shadow-[0_20px_54px_rgba(0,0,0,0.28)] md:grid-cols-[1fr_1fr_auto] md:p-5">
        <Field label={sfText("storefront.orders.orderNumber", "رقم الطلب")} value={form.order_number} onChange={(value) => setForm((prev) => ({ ...prev, order_number: value }))} required />
        <Field label={sfText("storefront.form.mobileNumber", "رقم الهاتف")} value={form.phone} onChange={(value) => setForm((prev) => ({ ...prev, phone: value }))} inputMode="tel" />
        <button disabled={state.loading} className="min-h-13 self-end rounded-full border border-white/10 bg-[linear-gradient(135deg,var(--sf-purple),var(--sf-purple-2))] px-7 py-4 font-black text-stone-950 shadow-[0_16px_36px_rgba(212,175,55,0.20)] transition hover:-translate-y-0.5 hover:shadow-[0_20px_44px_rgba(212,175,55,0.28)] disabled:border-white/10 disabled:bg-stone-300 disabled:text-stone-500 disabled:shadow-none">{sfText("storefront.orders.trackOrder", "تتبع الطلب")}</button>
      </form>
      {state.loading ? <div className="sf-storefront-card mt-5 h-32 animate-pulse rounded-3xl bg-white" /> : null}
      {!state.loading && !state.data && !state.error ? <EmptyState title={sfText("storefront.tracking.readyTitle", "جاهز للبحث")} text={sfText("storefront.tracking.readyText", "سيظهر رقم الطلب وحالة الشحن هنا بعد البحث.")} /> : null}
      {state.error ? <EmptyState title={sfText("storefront.tracking.notFoundTitle", "لم نعثر على الطلب")} text={state.error || sfText("storefront.tracking.notFoundText", "تحقق من رقم الطلب ورقم الهاتف، أو تواصل معنا على واتساب.")} /> : null}
      {state.data ? <TrackingResult data={state.data} helpers={helpers} components={components} /> : null}
    </section>
  );
}

export function WishlistPageRoute({ wishlist, toggleWishlist, onAddToCart, helpers, components }) {
  const { sfText } = helpers;
  const { EmptyState, SmallProductGrid } = components;
  const wishlistCount = Array.isArray(wishlist) ? wishlist.length : 0;
  return (
    <section className="sf-wishlist-page mx-auto w-full max-w-7xl px-3 py-6 sm:px-4 md:px-6 md:py-10">
      <div className="sf-wishlist-panel rounded-[2rem] border border-white/10 bg-[linear-gradient(180deg,#050505_0%,#101010_45%,#151515_100%)] p-4 shadow-[0_28px_72px_rgba(0,0,0,0.32)] backdrop-blur-xl md:p-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-black text-[#d4af37]">{sfText("storefront.wishlist.subtitle", "تُحفظ اختياراتك المفضلة هنا")}</p>
            <h1 className="mt-1 text-3xl font-black text-white md:text-5xl">{sfText("storefront.header.wishlist", "المفضلة")}</h1>
          </div>
          <div className="sf-wishlist-count w-fit rounded-full border border-white/10 bg-white/[0.06] px-4 py-2 text-sm font-black text-white/80 shadow-[0_12px_28px_rgba(0,0,0,0.18)]">
            {sfText("storefront.products.productCount", "{{count}} product", { count: wishlistCount })}
          </div>
        </div>

        {wishlistCount ? (
          <>
            <SmallProductGrid items={wishlist} action={toggleWishlist} onAddToCart={onAddToCart} />
            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <div className="sf-wishlist-alert flex items-start gap-4 rounded-[1.5rem] border border-white/10 bg-white/[0.05] p-5 text-start shadow-[0_18px_42px_rgba(0,0,0,0.20)] ring-1 ring-white/[0.025] backdrop-blur-xl">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-[#d4af37]/20 bg-[#d4af37]/15 text-[#d4af37]">
                  <Bell className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <div className="font-black text-white">{sfText("storefront.wishlist.priceDropAlert", "Price drop alert")}</div>
                  <p className="mt-1 text-sm font-bold leading-6 text-white/60">{sfText("storefront.wishlist.priceDropSoon", "Soon we will notify you when a wishlist product price drops.")}</p>
                </div>
              </div>
              <div className="sf-wishlist-alert flex items-start gap-4 rounded-[1.5rem] border border-white/10 bg-white/[0.05] p-5 text-start shadow-[0_18px_42px_rgba(0,0,0,0.20)] ring-1 ring-white/[0.025] backdrop-blur-xl">
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
        ) : <EmptyState title={sfText("storefront.wishlist.emptyTitle", "المفضلة فارغة")} text={sfText("storefront.wishlist.emptyText", "احفظ المنتجات التي تعجبك هنا")} />}
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
          <p className="text-sm font-black text-[#d4af37]">{sfText("storefront.recent.lastTwenty", "آخر 20 منتجًا")}</p>
          <h1 className="text-3xl font-black md:text-5xl">{sfText("storefront.account.recentlyViewed", "شوهد مؤخرًا")}</h1>
        </div>
        <Link to="/products" className="inline-flex min-h-12 items-center justify-center rounded-full border border-white/10 bg-[linear-gradient(135deg,var(--sf-purple),var(--sf-purple-2))] px-5 py-3 font-black text-stone-950 shadow-[0_16px_36px_rgba(212,175,55,0.20)] transition hover:-translate-y-0.5 hover:shadow-[0_20px_44px_rgba(212,175,55,0.28)]">{sfText("storefront.common.continueShopping", "متابعة التسوق")}</Link>
      </div>
      {recent.length ? <SmallProductGrid items={recent.slice(0, 20)} /> : <EmptyState title={sfText("storefront.recent.emptyTitle", "لا توجد منتجات هنا بعد")} text={sfText("storefront.account.recentEmpty", "ستظهر المنتجات التي شاهدتها مؤخرًا هنا")} />}
    </section>
  );
}

function CartContent({ cart, updateCart, removeFromCart, helpers, components }) {
  const { sfText, money, displayCartItemPrice, displayCartItemComparePrice, imageFor, fallbackProductImage } = helpers;
  const { EmptyState, SummaryRow } = components;
  const subtotal = cart.reduce((sum, item) => sum + displayCartItemPrice(item) * item.quantity, 0);
  if (!cart.length) return <EmptyState title={sfText("storefront.cart.emptyTitle")} text={sfText("storefront.cart.emptyPageText")} actionLabel={sfText("storefront.common.shopNow")} />;
  return (
    <div className="sf-cart-page mt-5 grid gap-5 lg:grid-cols-[1fr_320px]">
      <div className="space-y-3">
        {cart.map((item) => (
        <div key={item.lineId} className="sf-order-item-row sf-cart-row flex gap-3 rounded-3xl border border-white/8 p-3 text-start text-white shadow-[0_16px_42px_rgba(0,0,0,0.24),inset_0_1px_0_rgba(255,255,255,0.04)]">
            <img src={imageFor(item.image_url)} onError={fallbackProductImage} alt="" className="h-24 w-24 rounded-2xl object-cover" loading="lazy" decoding="async" width="96" height="96" />
            <div className="min-w-0 flex-1">
              <div className="font-black text-white">{item.name}</div>
              <div className="mt-1 text-xs font-bold text-white/54">{item.color || sfText("storefront.products.color")} / {item.display_size || item.size || sfText("storefront.products.size")}</div>
              <div className="mt-2 flex flex-wrap items-center gap-2 font-black">
                {displayCartItemComparePrice(item) ? <span className="text-sm text-white/38 line-through">{money(displayCartItemComparePrice(item))}</span> : null}
                <span>{money(displayCartItemPrice(item))}</span>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <button onClick={() => updateCart(item.lineId, item.quantity - 1)} className="rounded-full border border-white/10 bg-white/[0.05] p-2 text-white transition hover:bg-white/[0.08]"><Minus className="h-4 w-4" /></button>
                <span className="w-7 text-center font-black text-white">{item.quantity}</span>
                <button onClick={() => updateCart(item.lineId, item.quantity + 1)} className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5 text-white transition hover:bg-white/[0.08]">+</button>
                <button onClick={() => removeFromCart(item.lineId)} className="ms-auto rounded-full p-2 text-rose-600" aria-label={sfText("storefront.cart.removeItem", "حذف المنتج")}><Trash2 className="h-5 w-5" /></button>
              </div>
            </div>
          </div>
        ))}
      </div>
      <aside className="sf-storefront-card sf-cart-summary-card sf-checkout-summary h-max rounded-3xl border border-white/8 p-5 text-start text-white shadow-[0_18px_52px_rgba(0,0,0,0.32),inset_0_1px_0_rgba(255,255,255,0.04)]">
        <h2 className="text-xl font-black text-white">{sfText("storefront.checkout.orderSummary")}</h2>
        <SummaryRow dark label={sfText("storefront.checkout.products")} value={money(subtotal)} />
        <SummaryRow dark label={sfText("storefront.cart.estimatedShipping")} value={money(0)} />
        <SummaryRow dark label={sfText("storefront.checkout.total")} value={money(subtotal)} strong />
        <Link to="/checkout" className="mt-5 block rounded-full bg-[linear-gradient(135deg,#d4af37,#e5c158)] px-5 py-4 text-center font-black text-[#151515] shadow-[0_18px_42px_rgba(212,175,55,0.26)]">{sfText("storefront.cart.proceedToCheckout")}</Link>
        <p className="mt-3 text-xs font-bold text-white/54">{sfText("storefront.cart.finalShippingAtCheckout")}</p>
      </aside>
    </div>
  );
}

function PremiumCartContent({ cart, updateCart, removeFromCart, helpers, components }) {
  const { sfText, money, displayCartItemPrice, displayCartItemComparePrice, imageFor, fallbackProductImage } = helpers;
  const { EmptyState, SummaryRow } = components;
  const subtotal = cart.reduce((sum, item) => sum + displayCartItemPrice(item) * item.quantity, 0);
  const cartLines = Array.isArray(cart) ? cart.length : 0;
  const cartUnits = cart.reduce((sum, item) => sum + Math.max(1, Number(item.quantity || 0)), 0);

  if (!cart.length) {
    return (
      <section className="sf-cart-empty mt-5 rounded-[2rem] border border-white/10 bg-[radial-gradient(circle_at_top,rgba(212,175,55,0.12),transparent_42%),linear-gradient(180deg,#050505_0%,#0d0d0d_48%,#141414_100%)] p-5 text-center text-white shadow-[0_28px_80px_rgba(0,0,0,0.32)] md:p-8">
        <div className="mx-auto max-w-md">
          <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-[1.5rem] border border-[#d4af37]/20 bg-[#d4af37]/10 text-[#f3d77a] shadow-[0_18px_40px_rgba(212,175,55,0.16)]">
            <PackageSearch className="h-7 w-7" />
          </div>
          <EmptyState title={sfText("storefront.cart.emptyTitle")} text={sfText("storefront.cart.emptyPageText")} actionLabel={sfText("storefront.common.shopNow")} />
          <Link to="/products" className="mt-5 inline-flex min-h-12 items-center justify-center rounded-full bg-[linear-gradient(135deg,#d4af37,#e5c158)] px-6 py-3 text-sm font-black text-[#151515] shadow-[0_18px_42px_rgba(212,175,55,0.24)] transition hover:-translate-y-0.5">
            {sfText("storefront.common.continueShopping", sfText("storefront.common.shopNow"))}
          </Link>
        </div>
      </section>
    );
  }

  return (
    <div className="sf-cart-shell mt-5 space-y-5">
      <div className="sf-cart-hero rounded-[2rem] border border-white/10 bg-[radial-gradient(circle_at_top_right,rgba(212,175,55,0.16),transparent_38%),linear-gradient(180deg,#050505_0%,#0d0d0d_48%,#141414_100%)] p-4 text-white shadow-[0_28px_80px_rgba(0,0,0,0.32)] md:p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.22em] text-[#f3d77a]">{sfText("storefront.checkout.orderSummary", "ملخص الطلب")}</p>
            <h2 className="mt-2 text-2xl font-black md:text-3xl">{sfText("storefront.cart.title")}</h2>
            <p className="mt-2 text-sm font-bold leading-7 text-white/58">{sfText("storefront.cart.reviewBeforeCheckout")}</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="rounded-[1.35rem] border border-white/10 bg-white/[0.05] px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
              <div className="text-[11px] font-black text-white/50">{sfText("storefront.cart.itemCount")}</div>
              <div className="mt-1 text-xl font-black text-white">{cartLines}</div>
            </div>
            <div className="rounded-[1.35rem] border border-white/10 bg-white/[0.05] px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
              <div className="text-[11px] font-black text-white/50">{sfText("storefront.cart.pieceCount")}</div>
              <div className="mt-1 text-xl font-black text-white">{cartUnits}</div>
            </div>
            <div className="rounded-[1.35rem] border border-[#d4af37]/20 bg-[#d4af37]/10 px-4 py-3 shadow-[0_14px_32px_rgba(212,175,55,0.12)]">
              <div className="text-[11px] font-black text-[#f3d77a]/75">{sfText("storefront.cart.currentTotal")}</div>
              <div className="mt-1 text-xl font-black text-white">{money(subtotal)}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-3">
          {cart.map((item) => (
            <div key={item.lineId} className="sf-cart-item-card flex gap-3 rounded-[1.75rem] border border-white/8 bg-[radial-gradient(circle_at_top_right,rgba(212,175,55,0.08),transparent_28%),linear-gradient(180deg,#050505_0%,#101010_45%,#151515_100%)] p-3 text-start text-white shadow-[0_18px_50px_rgba(0,0,0,0.28),inset_0_1px_0_rgba(255,255,255,0.04)] md:p-4">
              <div className="rounded-[1.35rem] border border-white/10 bg-white/[0.04] p-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
                <img src={imageFor(item.image_url)} onError={fallbackProductImage} alt="" className="h-24 w-24 rounded-[1rem] object-cover md:h-28 md:w-28" loading="lazy" decoding="async" width="112" height="112" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="line-clamp-2 text-base font-black text-white">{item.name}</div>
                    <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-black">
                      <span className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1 text-white/70">{item.color || sfText("storefront.products.color")}</span>
                      <span className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1 text-white/70">{item.display_size || item.size || sfText("storefront.products.size")}</span>
                    </div>
                  </div>
                  <button onClick={() => removeFromCart(item.lineId)} className="sf-cart-remove-button rounded-full border border-rose-400/20 bg-rose-400/10 p-2.5 text-rose-200 transition hover:border-rose-300/35 hover:bg-rose-400/16" aria-label={sfText("storefront.cart.removeItem", "حذف المنتج")}><Trash2 className="h-4.5 w-4.5" /></button>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 font-black">
                  {displayCartItemComparePrice(item) ? <span className="text-sm text-white/38 line-through">{money(displayCartItemComparePrice(item))}</span> : null}
                  <span className="text-lg text-[#f3d77a]">{money(displayCartItemPrice(item))}</span>
                </div>
                <div className="mt-3 grid gap-3 md:grid-cols-[auto_1fr] md:items-end">
                  <div className="sf-cart-qty-control inline-flex w-fit items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] p-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
                    <button onClick={() => updateCart(item.lineId, item.quantity - 1)} className="sf-cart-quantity-button grid h-10 w-10 place-items-center rounded-full border border-white/10 bg-black/25 text-white transition hover:bg-white/[0.08]"><Minus className="h-4 w-4" /></button>
                    <span className="min-w-10 text-center text-base font-black text-white">{item.quantity}</span>
                    <button onClick={() => updateCart(item.lineId, item.quantity + 1)} className="sf-cart-quantity-button grid h-10 w-10 place-items-center rounded-full border border-white/10 bg-black/25 text-white transition hover:bg-white/[0.08]">+</button>
                  </div>
                  <div className="rounded-[1.2rem] border border-[#d4af37]/18 bg-[#d4af37]/10 px-4 py-3 text-start shadow-[0_14px_30px_rgba(212,175,55,0.10)]">
                    <div className="text-[11px] font-black text-[#f3d77a]/80">{sfText("storefront.cart.lineTotal")}</div>
                    <div className="mt-1 text-lg font-black text-white">{money(displayCartItemPrice(item) * item.quantity)}</div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        <aside className="sf-cart-summary-card sf-storefront-card sf-checkout-summary h-max rounded-[1.9rem] border border-white/8 bg-[radial-gradient(circle_at_top,rgba(212,175,55,0.14),transparent_38%),linear-gradient(180deg,#050505_0%,#101010_45%,#151515_100%)] p-5 text-start text-white shadow-[0_24px_70px_rgba(0,0,0,0.34),inset_0_1px_0_rgba(255,255,255,0.05)] lg:sticky lg:top-4">
          <div className="mb-4">
            <div className="text-xs font-black uppercase tracking-[0.2em] text-[#f3d77a]/80">{sfText("storefront.cart.totalsEyebrow")}</div>
            <h2 className="mt-2 text-2xl font-black text-white">{sfText("storefront.checkout.orderSummary")}</h2>
            <p className="mt-2 text-sm font-bold leading-7 text-white/54">{sfText("storefront.cart.summaryHint")}</p>
          </div>
          <SummaryRow dark label={sfText("storefront.checkout.products")} value={money(subtotal)} />
          <SummaryRow dark label={sfText("storefront.cart.estimatedShipping")} value={money(0)} />
          <SummaryRow dark label={sfText("storefront.checkout.total")} value={money(subtotal)} strong />
          <div className="mt-4 rounded-[1.25rem] border border-white/10 bg-white/[0.04] p-4 text-sm font-bold leading-7 text-white/62">
            {sfText("storefront.cart.shippingNote")}
          </div>
          <Link to="/checkout" className="mt-5 block rounded-full bg-[linear-gradient(135deg,#d4af37,#e5c158)] px-5 py-4 text-center font-black text-[#151515] shadow-[0_18px_42px_rgba(212,175,55,0.26)] transition hover:-translate-y-0.5 hover:shadow-[0_24px_54px_rgba(212,175,55,0.32)]">{sfText("storefront.cart.proceedToCheckout")}</Link>
          <div className="mt-4 grid gap-2 text-xs font-black text-white/56">
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-center">{sfText("storefront.cart.nextStepAddress")}</span>
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-center">{sfText("storefront.cart.editQuantityHint")}</span>
          </div>
        </aside>
      </div>
    </div>
  );
}

export function CartPageRoute({ cart, updateCart, removeFromCart, helpers, components }) {
  useEffect(() => {
    if (cart.length) trackGa4ViewCart(cart);
  }, [cart]);
  return (
    <section className="sf-cart-page mx-auto max-w-6xl px-4 py-6 text-white md:py-8">
      <h1 className="text-3xl font-black text-white">{sfText("storefront.cart.title")}</h1>
      <CartContent cart={cart} updateCart={updateCart} removeFromCart={removeFromCart} helpers={helpers} components={components} />
    </section>
  );
}

