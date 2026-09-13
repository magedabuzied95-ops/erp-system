import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronUp, ShoppingBag } from "lucide-react";
import { sfText } from "../lib/sfText";
import FreeShippingProgress from "./FreeShippingProgress";
import { deliveryEstimateText } from "./DeliveryEstimate";

const normalizeSummaryText = (value = "") => String(value ?? "").trim();
const firstSummaryValue = (...values) => {
  for (const value of values) {
    const text = normalizeSummaryText(value);
    if (text) return text;
  }
  return "";
};
const firstSummaryNumber = (...values) => {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return 0;
};
const cartItemImageUrl = (item = {}) =>
  firstSummaryValue(
    item.image_url,
    item.image,
    item.thumbnail,
    item.product_image,
    item.product_image_url,
    item.media_url,
    item.main_image,
    item.mainImage
  );
const cartItemName = (item = {}) => firstSummaryValue(item.name, item.product_name, item.title, sfText("storefront.confirmLink.productFallback"));
const cartItemColor = (item = {}) => firstSummaryValue(item.color, item.color_name, item.selectedColor);
const cartItemSize = (item = {}) => firstSummaryValue(item.display_size, item.size, item.size_name, item.selectedSize);
const cartItemQuantity = (item = {}) => firstSummaryNumber(item.quantity, item.qty) || 1;
const cartItemUnitPrice = (item = {}) => firstSummaryNumber(item.price, item.unit_price, item.selling_price);

/**
 * The totals block. Rendered in the side panel and, on phones, once more right
 * above the "complete order" button so the customer sees what they are paying
 * without reopening the summary bar.
 */
export function CheckoutTotals({ subtotal, discount, bundleDiscount = 0, freeShipping = false, deliveryFee, total, governorate, shippingQuote = {}, freeShippingThreshold = 0, money }) {
  const { t } = useTranslation();
  const shippingWaived = Boolean(freeShipping) && Number(deliveryFee || 0) > 0;
  // Split the waiver out of the discount line so the two lines never read as a double discount.
  // The bundle saving gets its own line, so the customer sees what the bundle earned.
  const bundleSaving = Math.max(0, Number(bundleDiscount || 0));
  const goodsDiscount = Math.max(0, Number(discount || 0) - bundleSaving - (shippingWaived ? Number(deliveryFee || 0) : 0));
  const shippingText = governorate
    ? shippingQuote.loading
      ? t("common.loading", "جاري التحميل...")
      : money(deliveryFee)
    : t("storefront.checkout.onePage.shippingPending", "يُحسب بعد اختيار المحافظة");
  return (
    <div className="sfc-totals">
      <FreeShippingProgress subtotal={subtotal} threshold={freeShippingThreshold} money={money} />
      <div className="sfc-total-row">
        <span>{t("storefront.checkout.onePage.subtotal", "المجموع الفرعي")}</span>
        <span>{money(subtotal)}</span>
      </div>
      {bundleSaving ? (
        <div className="sfc-total-row">
          <span>{t("storefront.bundle.discountLabel", "خصم الباقة")}</span>
          <span className="sfc-total-row__free">-{money(bundleSaving)}</span>
        </div>
      ) : null}
      {goodsDiscount ? (
        <div className="sfc-total-row">
          <span>{t("storefront.checkout.discount", "الخصم")}</span>
          <span>-{money(goodsDiscount)}</span>
        </div>
      ) : null}
      <div className="sfc-total-row">
        <span>{t("storefront.checkout.shipping", "الشحن")}</span>
        {shippingWaived ? (
          <span>
            <span className="sfc-total-row__free">{t("storefront.checkout.freeShipping", "مجاني")}</span>
            <s className="sfc-total-row__strike">{money(deliveryFee)}</s>
          </span>
        ) : (
          <span>{shippingText}</span>
        )}
      </div>
      <div className="sfc-total-row sfc-total-row--grand">
        <span>{t("storefront.checkout.total", "الإجمالي")}</span>
        <span>{money(total)}</span>
      </div>
    </div>
  );
}

export default function StorefrontCheckoutSummary({
  cart,
  subtotal,
  discount,
  bundleDiscount = 0,
  freeShipping = false,
  deliveryFee,
  total,
  governorate,
  shippingQuote = {},
  freeShippingThreshold = 0,
  open,
  setOpen,
  helpers,
  couponSlot = null,
}) {
  const { t, i18n } = useTranslation();
  const { displayCartItemComparePrice, fallbackProductImage, imageFor, money } = helpers;
  const deliveryText = deliveryEstimateText(t, shippingQuote.delivery_estimate, i18n.language)
    || shippingQuote.estimated_delivery_text
    || t("storefront.checkout.expectedDeliveryNotice", "4-5 أيام عمل");

  return (
    <div className="sfc-side__inner">
      <button type="button" className="sfc-summary-toggle" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-controls="sfc-summary-body">
        <span className="sfc-summary-toggle__label">
          <ShoppingBag size={16} aria-hidden="true" />
          {open ? t("storefront.checkout.onePage.hideSummary", "إخفاء ملخص الطلب") : t("storefront.checkout.onePage.showSummary", "عرض ملخص الطلب")}
          {open ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
        </span>
        <span className="sfc-summary-toggle__total">{money(total)}</span>
      </button>
      <div id="sfc-summary-body" className={`sfc-summary-body${open ? " is-open" : ""}`}>
        <h2 className="sfc-summary-title">{t("storefront.checkout.orderSummary", "ملخص الطلب")}</h2>
        <div className="sfc-lines">
          {cart.map((item) => {
            const quantity = cartItemQuantity(item);
            const unitPrice = cartItemUnitPrice(item);
            const comparePrice = displayCartItemComparePrice(item);
            const variant = [cartItemColor(item), cartItemSize(item)].filter(Boolean).join(" / ");
            const imageUrl = cartItemImageUrl(item);
            return (
              <article key={item.lineId} className="sfc-line">
                <div className="sfc-thumb">
                  <img
                    src={imageUrl ? imageFor(imageUrl) : imageFor(item.image_url)}
                    onError={fallbackProductImage}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    width="64"
                    height="64"
                  />
                  <span className="sfc-qty" aria-label={`${t("storefront.checkout.quantity", "الكمية")}: ${quantity}`}>{quantity}</span>
                </div>
                <div style={{ minWidth: 0 }}>
                  <div className="sfc-line__name">{cartItemName(item)}</div>
                  {variant ? <div className="sfc-line__variant">{variant}</div> : null}
                </div>
                <div className="sfc-line__price">
                  <span>{money(unitPrice * quantity)}</span>
                  {comparePrice && comparePrice > unitPrice ? <span className="sfc-line__was">{money(comparePrice * quantity)}</span> : null}
                </div>
              </article>
            );
          })}
        </div>
        {couponSlot}
        <CheckoutTotals
          subtotal={subtotal}
          discount={discount}
          bundleDiscount={bundleDiscount}
          freeShipping={freeShipping}
          deliveryFee={deliveryFee}
          total={total}
          governorate={governorate}
          shippingQuote={shippingQuote}
          freeShippingThreshold={freeShippingThreshold}
          money={money}
        />
        <div className="sfc-summary-notes">
          <span>{deliveryText}</span>
          {shippingQuote.cod_allowed === false ? <span>{t("storefront.checkout.codUnavailable", "الدفع عند الاستلام غير متاح حالياً.")}</span> : null}
        </div>
      </div>
    </div>
  );
}
