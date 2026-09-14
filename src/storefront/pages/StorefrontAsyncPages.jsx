import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../../shared/api/api";
import { readStorefrontCustomerAuth, storefrontCustomerRequest } from "../lib/storefrontCustomerAuth";
import {
  Check,
  Copy,
  ExternalLink,
  Loader2,
  MessageCircle,
  PackageSearch,
  PackageX,
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
      <div className="sft-card sft-head sfx-surface">
        <div className="sft-head__row">
          <div className="min-w-0">
            <div className="sft-label">{sfText("storefront.orders.orderNumber", "رقم الطلب")}</div>
            <div className="sft-order-number" dir="ltr">{publicNumber}</div>
            <div className="sft-muted">{formatDate(order.created_at)}</div>
          </div>
          <span className={`sft-pill sfx-badge ${derailedKey ? "sft-pill--bad sfx-badge--danger" : currentIndex === timeline.length - 1 ? "sft-pill--good sfx-badge--success" : "sfx-badge--accent"}`}>
            {derailedKey ? sfText(`storefront.tracking.${derailedKey}`) : timeline[currentIndex]?.label || statusCopy(order.status || "pending")}
          </span>
        </div>

        {derailedKey ? (
          <div className="sft-derailed sfx-notice sfx-notice--danger">
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
                  {state === "current" ? <span className="sft-step__now sfx-badge sfx-badge--accent">{sfText("storefront.tracking.now", "دلوقتي")}</span> : null}
                </li>
              );
            })}
          </ol>
        )}
      </div>

      <div className="sft-card sfx-surface">
        <h2 className="sft-h2 sfx-h3"><Truck className="h-4 w-4" aria-hidden="true" />{sfText("storefront.tracking.shipment", "الشحنة")}</h2>
        <div className="sft-rows sfx-summary">
          <div className="sft-row sfx-summary__row">
            <span className="sft-label">{sfText("storefront.shipping.provider", "شركة الشحن")}</span>
            <span className="sft-value">{shippingProviderCopy(order.shipping_provider || order.shipping_provider_id)}</span>
          </div>
          <div className="sft-row sfx-summary__row">
            <span className="sft-label">{sfText("storefront.shipping.trackingNumber", "رقم التتبع")}</span>
            {trackingNumber ? (
              <span className="sft-value sft-tracking">
                <span dir="ltr">{trackingNumber}</span>
                <button type="button" onClick={copyTracking} className="sft-icon-btn sfx-icon-btn" aria-label={sfText("storefront.tracking.copyTracking", "انسخ رقم التتبع")}>
                  {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
                </button>
              </span>
            ) : (
              <span className="sft-value sft-muted">{sfText("storefront.common.soon", "قريبًا")}</span>
            )}
          </div>
        </div>
        {trackingNumber && bosta ? (
          <a href={`https://bosta.co/tracking/${encodeURIComponent(trackingNumber)}`} target="_blank" rel="noopener noreferrer" className="sft-btn sfx-btn sfx-btn--outline sfx-btn--lg sfx-btn--block">
            {sfText("storefront.tracking.trackOnBosta", "تابع الشحنة على موقع بوسطة")}
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
          </a>
        ) : null}
        {!trackingNumber && !derailedKey ? <p className="sft-muted sft-note">{sfText("storefront.tracking.noTrackingYet", "رقم التتبع هيظهر أول ما الشحنة تتسلّم لشركة الشحن.")}</p> : null}
      </div>

      {items.length ? (
        <div className="sft-card sfx-surface">
          <h2 className="sft-h2 sfx-h3">{sfText("storefront.orders.itemsSummary", "ملخص المنتجات")}</h2>
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
          <div className="sft-rows sft-totals sfx-summary">
            {shippingFee > 0 ? (
              <div className="sft-row sfx-summary__row">
                <span className="sft-label">{sfText("storefront.checkout.shipping", "الشحن")}</span>
                <span className="sft-value">{money(shippingFee)}</span>
              </div>
            ) : null}
            <div className="sft-row sft-row--total sfx-summary__row sfx-summary__row--total">
              <span>{sfText("storefront.checkout.total", "الإجمالي")}</span>
              <span>{money(total)}</span>
            </div>
            <div className="sft-row sfx-summary__row">
              <span className="sft-label">{sfText("storefront.checkout.paymentMethod", "طريقة الدفع")}</span>
              <span className="sft-value">{paymentCopy(order.payment_method)}</span>
            </div>
            {remaining > 0 && !derailedKey ? (
              <div className="sft-row sfx-summary__row">
                <span className="sft-label">{sfText("storefront.checkout.remainingOnDelivery", "المتبقي عند الاستلام")}</span>
                <span className="sft-value">{money(remaining)}</span>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {address ? (
        <div className="sft-card sfx-surface">
          <h2 className="sft-h2 sfx-h3">{sfText("storefront.checkout.deliveryAddress", "عنوان التوصيل")}</h2>
          <p className="sft-address">{order.customer_name ? <strong>{order.customer_name}</strong> : null}{address}</p>
        </div>
      ) : null}

      <div className="sft-actions">
        <a href={supportHref(publicNumber)} target="_blank" rel="noopener noreferrer" className="sft-btn sfx-btn sfx-btn--whatsapp sfx-btn--lg sfx-btn--block">
          <MessageCircle className="h-5 w-5" aria-hidden="true" />
          {sfText("storefront.support.needHelpWhatsapp", "تحتاج مساعدة؟ تواصل معنا على واتساب")}
        </a>
        <button type="button" onClick={onSearchAnother} className="sft-btn sfx-btn sfx-btn--ghost sfx-btn--lg sfx-btn--block">
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
    <section className="sft sfx-wrap sfx-wrap--sm">
      <header className="sft-header">
        <span className="sft-header__icon" aria-hidden="true"><PackageSearch className="h-6 w-6" /></span>
        <h1 className="sft-title sfx-title">{sfText("storefront.tracking.title", "تتبع الطلب")}</h1>
        <p className="sft-subtitle sfx-subtitle">{sfText("storefront.tracking.subtitle", "اكتب رقم الطلب ورقم الموبايل، أو افتح رابط التتبع المباشر من رسالة التأكيد.")}</p>
      </header>

      {!state.data ? (
        <form onSubmit={submit} className="sft-card sft-form sfx-surface" noValidate>
          <label className="sft-field sfx-form-row">
            <span className="sft-field__label sfx-label">{sfText("storefront.orders.orderNumber", "رقم الطلب")}</span>
            <input
              ref={orderInputRef}
              value={form.order_number}
              onChange={(event) => setForm((prev) => ({ ...prev, order_number: event.target.value }))}
              className="sft-input sfx-input"
              dir="ltr"
              autoComplete="off"
              autoCapitalize="characters"
              enterKeyHint="next"
              placeholder="WEB-1234"
            />
            <span className="sft-field__hint sfx-help">{sfText("storefront.tracking.orderNumberHint", "موجود في رسالة تأكيد الطلب")}</span>
          </label>
          <label className="sft-field sfx-form-row">
            <span className="sft-field__label sfx-label">{sfText("storefront.form.mobileNumber", "رقم الموبايل")}</span>
            <input
              value={form.phone}
              onChange={(event) => setForm((prev) => ({ ...prev, phone: event.target.value }))}
              className="sft-input sfx-input"
              dir="ltr"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              enterKeyHint="search"
              placeholder="01xxxxxxxxx"
            />
            <span className="sft-field__hint sfx-help">{sfText("storefront.tracking.phoneHint", "نفس الرقم اللي كتبته وانت بتطلب")}</span>
          </label>
          {state.error ? <p role="alert" className="sft-error sfx-error">{state.error}</p> : null}
          <button type="submit" disabled={state.loading} className="sft-btn sfx-btn sfx-btn--primary sfx-btn--lg sfx-btn--block">
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

export function RecentPageRoute({ recent, helpers, components }) {
  const { sfText } = helpers;
  const { EmptyState, SmallProductGrid } = components;
  return (
    <section className="sfr sfx-wrap">
      <header className="sfx-page-head">
        <div className="sfx-page-head__text">
          <h1 className="sfx-title">{sfText("storefront.account.recentlyViewed", "شوهد مؤخرًا")}</h1>
          <p className="sfx-subtitle">{sfText("storefront.recent.lastTwenty", "آخر 20 منتجًا")}</p>
        </div>
        <div className="sfx-page-head__actions">
          <Link to="/products" className="sfx-btn sfx-btn--primary sfx-btn--lg">{sfText("storefront.common.continueShopping", "متابعة التسوق")}</Link>
        </div>
      </header>
      {recent.length ? <SmallProductGrid items={recent.slice(0, 20)} /> : <EmptyState title={sfText("storefront.recent.emptyTitle", "لا توجد منتجات هنا بعد")} text={sfText("storefront.account.recentEmpty", "ستظهر المنتجات التي شاهدتها مؤخرًا هنا")} />}
    </section>
  );
}

