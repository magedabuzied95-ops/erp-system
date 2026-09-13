import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../../shared/api/api";
import { sfText } from "../lib/sfText";
import { readStorefrontCustomerAuth, storefrontCustomerRequest } from "../lib/storefrontCustomerAuth";
import { trackGa4ViewCart } from "../lib/ga4Events";
import { droppedPriceAlerts, usePriceDropAlerts } from "../lib/priceDropAlerts";
import FreeShippingProgress, { usePublicFreeShippingThreshold } from "../components/FreeShippingProgress";
import {
  Bell,
  Check,
  Copy,
  ExternalLink,
  Loader2,
  MessageCircle,
  Minus,
  PackageSearch,
  PackageX,
  Trash2,
  Truck,
} from "lucide-react";
import "./trackOrder.css";

const storefrontAsyncDebugLog = (label, payload = {}) => {
  if (!import.meta.env.DEV) return;
  console.log(label, payload);
};

// Orders that left the happy path. The timeline stops lighting stages for them
// (buildOrderTimeline on the server), so the page says what happened instead.
const TRACKING_DERAILED = {
  cancelled: "cancelledTitle",
  canceled: "cancelledTitle",
  cancelled_by_customer: "cancelledTitle",
  returned: "returnedTitle",
  failed_delivery: "failedTitle",
};

const trackingDerailedKey = (order = {}) => {
  const values = [order.status, order.shipment_status, order.shipping_status].map((value) => String(value || "").trim().toLowerCase());
  for (const value of values) {
    if (TRACKING_DERAILED[value]) return TRACKING_DERAILED[value];
  }
  return "";
};

const trackingNumberOf = (order = {}) => String(order.shipping_tracking_number || order.tracking_number || "").trim();

const isBostaOrder = (order = {}) => [order.shipping_provider, order.shipping_provider_id, order.shipping_method]
  .some((value) => String(value || "").toLowerCase().includes("bosta"));

function TrackingResult({ data, helpers, onSearchAnother }) {
  const { sfText, displayOrderNumber, statusCopy, formatDate, money, paymentCopy, shippingProviderCopy, supportHref, imageFor, fallbackProductImage, getStatusLabels } = helpers;
  const [copied, setCopied] = useState(false);
  const order = data.order || {};
  const items = Array.isArray(data.items) ? data.items : [];
  const timeline = Array.isArray(data.timeline) && data.timeline.length
    ? data.timeline
    : getStatusLabels().map((label, index) => ({ key: String(index), label, done: index === 0 }));
  const derailedKey = trackingDerailedKey(order);
  // The stage the parcel is at: the last one lit. Everything before it is done.
  const currentIndex = timeline.reduce((last, step, index) => (step.done ? index : last), 0);
  const publicNumber = displayOrderNumber(order);
  const trackingNumber = trackingNumberOf(order);
  const bosta = isBostaOrder(order);
  const total = Number(order.total_amount || order.total || order.total_price || 0);
  const shippingFee = Number(order.shipping_fee || order.delivery_fee || 0);
  const remaining = Number(order.remaining_amount || 0);
  const address = [order.governorate, order.city_area, order.customer_address, order.landmark].filter(Boolean).join(" - ");

  const copyTracking = async () => {
    try {
      await navigator.clipboard?.writeText(trackingNumber);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard access can be refused; the number stays visible to copy by hand.
    }
  };

  return (
    <div className="sft-result">
      <div className="sft-card sft-head">
        <div className="sft-head__row">
          <div className="min-w-0">
            <div className="sft-label">{sfText("storefront.orders.orderNumber", "رقم الطلب")}</div>
            <div className="sft-order-number" dir="ltr">{publicNumber}</div>
            <div className="sft-muted">{formatDate(order.created_at)}</div>
          </div>
          <span className={`sft-pill${derailedKey ? " sft-pill--bad" : currentIndex === timeline.length - 1 ? " sft-pill--good" : ""}`}>
            {derailedKey ? sfText(`storefront.tracking.${derailedKey}`) : timeline[currentIndex]?.label || statusCopy(order.status || "pending")}
          </span>
        </div>

        {derailedKey ? (
          <div className="sft-derailed">
            <PackageX className="h-5 w-5 shrink-0" aria-hidden="true" />
            {/* The pill above already names what happened; this only says what to do. */}
            <p className="sft-muted">{sfText("storefront.tracking.derailedText", "لو عندك أي استفسار كلّمنا على واتساب وهنساعدك.")}</p>
          </div>
        ) : (
          <ol className="sft-steps" aria-label={sfText("storefront.orders.tracking", "تتبع الطلب")}>
            {timeline.map((step, index) => {
              const state = index < currentIndex ? "done" : index === currentIndex ? "current" : "todo";
              return (
                <li key={step.key || step.label} className={`sft-step sft-step--${state}`} aria-current={state === "current" ? "step" : undefined}>
                  <span className="sft-step__dot" aria-hidden="true">
                    {state === "done" ? <Check className="h-3.5 w-3.5" /> : null}
                  </span>
                  <span className="sft-step__label">{step.label}</span>
                  {state === "current" ? <span className="sft-step__now">{sfText("storefront.tracking.now", "دلوقتي")}</span> : null}
                </li>
              );
            })}
          </ol>
        )}
      </div>

      <div className="sft-card">
        <h2 className="sft-h2"><Truck className="h-4 w-4" aria-hidden="true" />{sfText("storefront.tracking.shipment", "الشحنة")}</h2>
        <div className="sft-rows">
          <div className="sft-row">
            <span className="sft-label">{sfText("storefront.shipping.provider", "شركة الشحن")}</span>
            <span className="sft-value">{shippingProviderCopy(order.shipping_provider || order.shipping_provider_id)}</span>
          </div>
          <div className="sft-row">
            <span className="sft-label">{sfText("storefront.shipping.trackingNumber", "رقم التتبع")}</span>
            {trackingNumber ? (
              <span className="sft-value sft-tracking">
                <span dir="ltr">{trackingNumber}</span>
                <button type="button" onClick={copyTracking} className="sft-icon-btn" aria-label={sfText("storefront.tracking.copyTracking", "انسخ رقم التتبع")}>
                  {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
                </button>
              </span>
            ) : (
              <span className="sft-value sft-muted">{sfText("storefront.common.soon", "قريبًا")}</span>
            )}
          </div>
        </div>
        {trackingNumber && bosta ? (
          <a href={`https://bosta.co/tracking/${encodeURIComponent(trackingNumber)}`} target="_blank" rel="noopener noreferrer" className="sft-btn sft-btn--outline">
            {sfText("storefront.tracking.trackOnBosta", "تابع الشحنة على موقع بوسطة")}
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
          </a>
        ) : null}
        {!trackingNumber && !derailedKey ? <p className="sft-muted sft-note">{sfText("storefront.tracking.noTrackingYet", "رقم التتبع هيظهر أول ما الشحنة تتسلّم لشركة الشحن.")}</p> : null}
      </div>

      {items.length ? (
        <div className="sft-card">
          <h2 className="sft-h2">{sfText("storefront.orders.itemsSummary", "ملخص المنتجات")}</h2>
          <ul className="sft-items">
            {items.map((item) => {
              const image = item.variant_image || item.variant_image_url || item.color_image || item.color_image_url || item.image_url || item.product_image || item.product_image_url;
              const quantity = Number(item.quantity || 1);
              const lineTotal = Number(item.total_amount || 0) || Number(item.price || item.sale_price || 0) * quantity;
              const options = [item.color, item.size].filter(Boolean).join(" / ");
              return (
                <li key={item.id || `${item.product_id}-${item.variant_id}`} className="sft-item">
                  <img src={imageFor(image)} onError={fallbackProductImage} alt="" className="sft-item__img" loading="lazy" decoding="async" width="56" height="56" />
                  <div className="min-w-0 flex-1">
                    <div className="sft-item__name">{item.product_name || item.name}</div>
                    <div className="sft-muted">{options ? `${options} · ` : ""}× {quantity}</div>
                  </div>
                  <div className="sft-value">{money(lineTotal)}</div>
                </li>
              );
            })}
          </ul>
          <div className="sft-rows sft-totals">
            {shippingFee > 0 ? (
              <div className="sft-row">
                <span className="sft-label">{sfText("storefront.checkout.shipping", "الشحن")}</span>
                <span className="sft-value">{money(shippingFee)}</span>
              </div>
            ) : null}
            <div className="sft-row sft-row--total">
              <span>{sfText("storefront.checkout.total", "الإجمالي")}</span>
              <span>{money(total)}</span>
            </div>
            <div className="sft-row">
              <span className="sft-label">{sfText("storefront.checkout.paymentMethod", "طريقة الدفع")}</span>
              <span className="sft-value">{paymentCopy(order.payment_method)}</span>
            </div>
            {remaining > 0 && !derailedKey ? (
              <div className="sft-row">
                <span className="sft-label">{sfText("storefront.checkout.remainingOnDelivery", "المتبقي عند الاستلام")}</span>
                <span className="sft-value">{money(remaining)}</span>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {address ? (
        <div className="sft-card">
          <h2 className="sft-h2">{sfText("storefront.checkout.deliveryAddress", "عنوان التوصيل")}</h2>
          <p className="sft-address">{order.customer_name ? <strong>{order.customer_name}</strong> : null}{address}</p>
        </div>
      ) : null}

      <div className="sft-actions">
        <a href={supportHref(publicNumber)} target="_blank" rel="noopener noreferrer" className="sft-btn sft-btn--whatsapp">
          <MessageCircle className="h-5 w-5" aria-hidden="true" />
          {sfText("storefront.support.needHelpWhatsapp", "تحتاج مساعدة؟ تواصل معنا على واتساب")}
        </a>
        <button type="button" onClick={onSearchAnother} className="sft-btn sft-btn--ghost">
          {sfText("storefront.tracking.searchAnother", "تتبع طلب تاني")}
        </button>
      </div>
    </div>
  );
}

export function TrackOrderPage({ helpers }) {
  const { sfText, displayOrderNumber, deferReactState } = helpers;
  const [params] = useSearchParams();
  const auth = readStorefrontCustomerAuth();
  const signedIn = Boolean(auth.token && auth.phone);
  const [form, setForm] = useState({
    order_number: displayOrderNumber(params.get("order_number") || params.get("order") || ""),
    phone: params.get("phone") || (signedIn ? auth.phone : ""),
  });
  const [state, setState] = useState({ loading: false, data: null, error: "" });
  const orderInputRef = useRef(null);

  const submit = useCallback(async (event) => {
    event?.preventDefault();
    const orderNumber = String(form.order_number || "").trim();
    const phone = String(form.phone || "").trim();
    if (!orderNumber) {
      setState({ loading: false, data: null, error: sfText("storefront.tracking.validation.orderNumberRequired", "اكتب رقم الطلب أولًا") });
      return;
    }
    // The server will not open an order on its number alone; a signed-in
    // shopper's phone travels in their token instead.
    if (!phone && !signedIn) {
      setState({ loading: false, data: null, error: sfText("storefront.tracking.validation.phoneRequired", "اكتب رقم الموبايل اللي طلبت بيه") });
      return;
    }
    setState({ loading: true, data: null, error: "" });
    try {
      const query = { order_number: orderNumber, phone };
      const data = signedIn
        ? await storefrontCustomerRequest("/storefront/track", { params: query })
        : await api.get(`/storefront/track?order_number=${encodeURIComponent(orderNumber)}&phone=${encodeURIComponent(phone)}`);
      setState({ loading: false, data, error: "" });
    } catch (error) {
      const status = Number(error?.status || error?.response?.status || 0);
      setState({
        loading: false,
        data: null,
        error: status === 404
          ? sfText("storefront.tracking.notFoundText", "راجع رقم الطلب ورقم الموبايل، أو تواصل معنا على واتساب.")
          : sfText("storefront.tracking.loadFailed", "حصلت مشكلة وإحنا بندوّر على الطلب، جرّب تاني بعد شوية."),
      });
    }
  }, [form.order_number, form.phone, sfText, signedIn]);

  // A link from the confirmation message or the account page carries both
  // values, so the order opens without the shopper typing anything.
  const autoOpenedRef = useRef(false);
  useEffect(() => {
    if (autoOpenedRef.current) return undefined;
    if (!form.order_number || (!form.phone && !signedIn)) return undefined;
    autoOpenedRef.current = true;
    let cancelled = false;
    deferReactState(() => {
      if (!cancelled) submit();
    });
    return () => {
      cancelled = true;
    };
  }, [deferReactState, form.order_number, form.phone, signedIn, submit]);

  const searchAnother = () => {
    setState({ loading: false, data: null, error: "" });
    setForm((prev) => ({ ...prev, order_number: "" }));
    window.scrollTo({ top: 0, behavior: "smooth" });
    window.setTimeout(() => orderInputRef.current?.focus({ preventScroll: true }), 300);
  };

  return (
    <section className="sft">
      <header className="sft-header">
        <span className="sft-header__icon" aria-hidden="true"><PackageSearch className="h-6 w-6" /></span>
        <h1 className="sft-title">{sfText("storefront.tracking.title", "تتبع الطلب")}</h1>
        <p className="sft-muted">{sfText("storefront.tracking.subtitle", "اكتب رقم الطلب ورقم الموبايل، أو افتح رابط التتبع المباشر من رسالة التأكيد.")}</p>
      </header>

      {!state.data ? (
        <form onSubmit={submit} className="sft-card sft-form" noValidate>
          <label className="sft-field">
            <span className="sft-field__label">{sfText("storefront.orders.orderNumber", "رقم الطلب")}</span>
            <input
              ref={orderInputRef}
              value={form.order_number}
              onChange={(event) => setForm((prev) => ({ ...prev, order_number: event.target.value }))}
              className="sft-input"
              dir="ltr"
              autoComplete="off"
              autoCapitalize="characters"
              enterKeyHint="next"
              placeholder="WEB-1234"
            />
            <span className="sft-field__hint">{sfText("storefront.tracking.orderNumberHint", "موجود في رسالة تأكيد الطلب")}</span>
          </label>
          <label className="sft-field">
            <span className="sft-field__label">{sfText("storefront.form.mobileNumber", "رقم الموبايل")}</span>
            <input
              value={form.phone}
              onChange={(event) => setForm((prev) => ({ ...prev, phone: event.target.value }))}
              className="sft-input"
              dir="ltr"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              enterKeyHint="search"
              placeholder="01xxxxxxxxx"
            />
            <span className="sft-field__hint">{sfText("storefront.tracking.phoneHint", "نفس الرقم اللي كتبته وانت بتطلب")}</span>
          </label>
          {state.error ? <p role="alert" className="sft-error">{state.error}</p> : null}
          <button type="submit" disabled={state.loading} className="sft-btn sft-btn--primary">
            {state.loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            {sfText("storefront.orders.trackOrder", "تتبع الطلب")}
          </button>
        </form>
      ) : (
        <TrackingResult data={state.data} helpers={helpers} onSearchAnother={searchAnother} />
      )}
    </section>
  );
}

export function WishlistPageRoute({ wishlist, toggleWishlist, onAddToCart, helpers, components }) {
  const { sfText, money, imageFor, fallbackProductImage } = helpers;
  const { EmptyState, SmallProductGrid } = components;
  const wishlistCount = Array.isArray(wishlist) ? wishlist.length : 0;
  const priceDrop = usePriceDropAlerts();
  const dropped = droppedPriceAlerts(priceDrop.alerts);
  // Shown with the wishlist, and on its own when the wishlist is empty but a followed price dropped.
  const priceDropCard = priceDrop.enabled && (wishlistCount || dropped.length) ? (
    <div className="sf-wishlist-alert flex items-start gap-4 rounded-[1.5rem] border border-white/10 bg-white/[0.05] p-5 text-start shadow-[0_18px_42px_rgba(0,0,0,0.20)] ring-1 ring-white/[0.025] backdrop-blur-xl">
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-[#d4af37]/20 bg-[#d4af37]/15 text-[#d4af37]">
        <Bell className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="font-black text-white">{sfText("storefront.priceDrop.panelTitle", "تنبيه نزول السعر")}</div>
        <p className="mt-1 text-sm font-bold leading-6 text-white/60">{sfText("storefront.priceDrop.panelText", "بنتابع أسعار المنتجات اللي في المفضلة واللي طلبت تتنبّه لها، وأول ما سعر أي منتج ينزل هنبلغك.")}</p>
        {dropped.length ? (
          <ul className="mt-3 grid gap-2">
            {dropped.map((alert) => (
              <li key={alert.product_id}>
                <Link to={`/product/${alert.product.slug || alert.product.id}`} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-2">
                  <img src={imageFor(alert.product.image_url) || fallbackProductImage} alt="" className="h-12 w-12 shrink-0 rounded-xl object-cover" loading="lazy" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-black text-white">{alert.product.name}</span>
                    <span className="mt-0.5 flex flex-wrap items-baseline gap-2 text-sm font-black">
                      <span className="text-[#f3d77a]">{money(alert.current_price)}</span>
                      <span className="text-xs text-white/45 line-through">{sfText("storefront.priceDrop.was", "كان {{price}}", { price: money(alert.followed_price) })}</span>
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  ) : null;
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
              {priceDropCard}
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
        ) : (
          <>
            <EmptyState title={sfText("storefront.wishlist.emptyTitle", "المفضلة فارغة")} text={sfText("storefront.wishlist.emptyText", "احفظ المنتجات التي تعجبك هنا")} />
            {priceDropCard ? <div className="mt-6">{priceDropCard}</div> : null}
          </>
        )}
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
  const freeShippingThreshold = usePublicFreeShippingThreshold();
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
        <FreeShippingProgress subtotal={subtotal} threshold={freeShippingThreshold} money={money} className="mt-4" />
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

