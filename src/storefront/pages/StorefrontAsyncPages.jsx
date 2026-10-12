import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../../shared/api/api";
import { readStorefrontCustomerAuth, storefrontCustomerRequest } from "../lib/storefrontCustomerAuth";
import i18n from "../../i18n/i18n";
import { localizeColorName, localizeSizeLabel } from "../lib/displayCopy";
import { journeyStepKey, trackingStageKey } from "../lib/serverCopy";
import { orderDueOnDelivery } from "../lib/checkoutGuards";
import {
  AlertTriangle,
  CalendarDays,
  Check,
  Copy,
  ExternalLink,
  Loader2,
  MessageCircle,
  PackageSearch,
  PackageX,
  Phone,
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

// The shop runs on one Cairo clock: a step stamped 23:30 UTC happened the next morning here.
// Latin digits in Arabic too, like the order date and the money on the same page.
const journeyLocale = () => (String(i18n.language || "ar").startsWith("ar") ? "ar-EG-u-nu-latn" : "en-GB");
const formatJourneyTime = (value) => {
  if (!value) return "";
  try {
    return new Intl.DateTimeFormat(journeyLocale(), {
      timeZone: "Africa/Cairo", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return "";
  }
};
// The promise is a calendar day with no clock; read at noon UTC so no timezone moves it.
const formatPromiseDay = (day) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day || ""))) return "";
  try {
    return new Intl.DateTimeFormat(journeyLocale(), { timeZone: "Africa/Cairo", weekday: "long", day: "numeric", month: "long" })
      .format(new Date(`${day}T12:00:00Z`));
  } catch {
    return day;
  }
};

/*
 * Where the parcel is, step by step, the way Bosta's own messages tell it — newest on top.
 * Everything here comes from the server's `shipment` block (publicShipmentJourney.js),
 * already trimmed to what a customer may read.
 */
function ShipmentJourney({ shipment, sfText, supportHref, publicNumber }) {
  const events = Array.isArray(shipment?.events) ? shipment.events : [];
  const arabic = String(i18n.language || "ar").startsWith("ar");
  const promise = formatPromiseDay(shipment?.promise_date);
  const alert = shipment?.alert;
  const courier = shipment?.courier;
  return (
    <div className="sft-journey">
      {promise ? (
        <div className="sft-promise sfx-notice sfx-notice--accent">
          <CalendarDays className="h-5 w-5 shrink-0" aria-hidden="true" />
          <span>{sfText("storefront.tracking.promiseDate", "متوقع توصل يوم {{date}}", { date: promise })}</span>
        </div>
      ) : null}

      {alert ? (
        <div className={`sft-alert sfx-notice ${alert.key === "failed_attempt" ? "sfx-notice--accent" : "sfx-notice--danger"}`} role="status">
          <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden="true" />
          <div className="sft-alert__body">
            <p className="sft-alert__text">{sfText(`storefront.tracking.alerts.${alert.key}`)}</p>
            {/* Bosta's reason exists only in Arabic, worded for the customer. */}
            {alert.reason && arabic ? <p className="sft-muted">{alert.reason}</p> : null}
            <a href={supportHref(publicNumber)} target="_blank" rel="noopener noreferrer" className="sft-btn sfx-btn sfx-btn--whatsapp sfx-btn--sm">
              <MessageCircle className="h-4 w-4" aria-hidden="true" />
              {sfText("storefront.tracking.chatOnWhatsapp", "كلّمنا على واتساب")}
            </a>
          </div>
        </div>
      ) : null}

      {courier ? (
        <div className="sft-courier">
          <div className="min-w-0">
            <div className="sft-label">
              {shipment?.stage === "delivered"
                ? sfText("storefront.tracking.deliveredBy", "المندوب اللي سلّمك")
                : sfText("storefront.tracking.courier", "المندوب")}
            </div>
            {courier.name ? <div className="sft-value sft-courier__name">{courier.name}</div> : null}
          </div>
          {courier.phone ? (
            <a href={`tel:${courier.phone}`} className="sft-btn sfx-btn sfx-btn--outline sfx-btn--sm">
              <Phone className="h-4 w-4" aria-hidden="true" />
              {sfText("storefront.tracking.callCourier", "كلّم المندوب")}
            </a>
          ) : null}
        </div>
      ) : null}

      <div className="sft-journey__head">
        <h3 className="sft-journey__title">{sfText("storefront.tracking.journeyTitle", "رحلة الشحنة")}</h3>
        {shipment?.attempts > 1 ? <span className="sft-muted">{sfText("storefront.tracking.attempts", "عدد محاولات التسليم: {{count}}", { count: shipment.attempts })}</span> : null}
      </div>
      {events.length ? (
        <ol className="sft-events">
          {events.map((event, index) => {
            const time = formatJourneyTime(event.at);
            const copyKey = journeyStepKey(event);
            return (
              <li key={`${event.key}-${event.at || index}`} className={`sft-event${index === 0 ? " sft-event--latest" : ""}${event.key === "failed_attempt" || event.key === "problem" ? " sft-event--bad" : ""}`}>
                <span className="sft-event__dot" aria-hidden="true" />
                <div className="min-w-0">
                  <div className="sft-event__label">{copyKey ? sfText(copyKey, event.label) : event.label}</div>
                  {event.reason && arabic ? <div className="sft-muted">{event.reason}</div> : null}
                  {time ? <time className="sft-event__time" dateTime={event.at}>{time}</time> : null}
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="sft-muted sft-note">{sfText("storefront.tracking.journeyEmpty", "أول ما بوسطة تبدأ تحرّك الشحنة هتلاقي كل خطوة هنا بميعادها.")}</p>
      )}
      {shipment?.synced_at ? (
        <p className="sft-muted sft-note">{sfText("storefront.tracking.updatedAt", "آخر تحديث من بوسطة: {{time}}", { time: formatJourneyTime(shipment.synced_at) })}</p>
      ) : null}
    </div>
  );
}

function TrackingResult({ data, helpers, onSearchAnother }) {
  const { sfText, displayOrderNumber, statusCopy, formatDate, money, paymentCopy, shippingProviderCopy, supportHref, imageFor, fallbackProductImage, getStatusLabels } = helpers;
  const [copied, setCopied] = useState(false);
  const order = data.order || {};
  const items = Array.isArray(data.items) ? data.items : [];
  // The server's stage labels are Arabic; each known stage reads from the shopper's language by key.
  const timeline = Array.isArray(data.timeline) && data.timeline.length
    ? data.timeline.map((step) => (trackingStageKey(step) ? { ...step, label: sfText(trackingStageKey(step), step.label) } : step))
    : getStatusLabels().map((label, index) => ({ key: String(index), label, done: index === 0 }));
  const lang = i18n.language;
  const derailedKey = trackingDerailedKey(order);
  // One failed visit that Bosta will retry is not "delivery did not go through" — the pill
  // says what happened, in the warning tone, and the shipment card explains the retry.
  const retrying = derailedKey === "failedTitle" && data.shipment?.alert?.key === "failed_attempt";
  // The stage the parcel is at: the last one lit. Everything before it is done.
  const currentIndex = timeline.reduce((last, step, index) => (step.done ? index : last), 0);
  const publicNumber = displayOrderNumber(order);
  const trackingNumber = trackingNumberOf(order);
  const bosta = isBostaOrder(order);
  const total = Number(order.total_amount || order.total || order.total_price || 0);
  const shippingFee = Number(order.shipping_fee || order.delivery_fee || 0);
  const remaining = orderDueOnDelivery(order);
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
          <span className={`sft-pill sfx-badge ${retrying ? "sfx-badge--accent" : derailedKey ? "sft-pill--bad sfx-badge--danger" : currentIndex === timeline.length - 1 ? "sft-pill--good sfx-badge--success" : "sfx-badge--accent"}`}>
            {retrying
              ? sfText("storefront.tracking.journey.failed_attempt")
              : derailedKey ? sfText(`storefront.tracking.${derailedKey}`) : timeline[currentIndex]?.label || statusCopy(order.status || "pending")}
          </span>
        </div>

        {derailedKey ? (
          <div className={`sft-derailed sfx-notice ${retrying ? "sfx-notice--accent" : "sfx-notice--danger"}`}>
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
        {data.shipment ? <ShipmentJourney shipment={data.shipment} sfText={sfText} supportHref={supportHref} publicNumber={publicNumber} /> : null}
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
              const options = [localizeColorName(item.color, lang), localizeSizeLabel(item.size, lang)].filter(Boolean).join(" / ");
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

