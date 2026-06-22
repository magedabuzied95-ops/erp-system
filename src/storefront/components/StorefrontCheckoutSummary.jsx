import { useTranslation } from "react-i18next";

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
const hasVariantIndicators = (item = {}) =>
  Boolean(
    item.variant_id ||
      item.selected_variant_id ||
      item.selectedVariant ||
      item.selectedColor ||
      item.selectedSize ||
      item.color ||
      item.color_name ||
      item.size ||
      item.size_name ||
      Number(item.variant_count || item.variants_count || item.variantsCount || 0) > 1 ||
      item.requires_variants === true ||
      item.has_variants === true
  );
const variantDisplayValue = (value, shouldFallback) => {
  const text = normalizeSummaryText(value);
  if (text) return text;
  return shouldFallback ? "غير محدد" : "";
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
const cartItemName = (item = {}) => firstSummaryValue(item.name, item.product_name, item.title, "المنتج");
const cartItemSku = (item = {}) => firstSummaryValue(item.sku, item.barcode);
const cartItemColor = (item = {}) => firstSummaryValue(item.color, item.color_name, item.selectedColor);
const cartItemSize = (item = {}) => firstSummaryValue(item.size, item.size_name, item.selectedSize);
const cartItemQuantity = (item = {}) => firstSummaryNumber(item.quantity, item.qty) || 1;
const cartItemUnitPrice = (item = {}) => firstSummaryNumber(item.price, item.unit_price, item.selling_price);

function SummaryMeta({ label, value, variant = "muted" }) {
  const variantClass =
    variant === "accent"
      ? "border-[#d4af37]/20 bg-[#d4af37]/12 text-[#f3d77a]"
      : "border-white/10 bg-white/[0.055] text-white/68";

  return (
    <span className={`inline-flex max-w-full items-center rounded-full border px-2 py-1 text-[10px] font-black ${variantClass}`}>
      {label}: {value}
    </span>
  );
}

export default function StorefrontCheckoutSummary({
  cart,
  subtotal,
  discount,
  deliveryFee,
  total,
  codAmount,
  governorate,
  paymentMethod,
  shippingQuote = {},
  open,
  setOpen,
  submitting,
  submitDisabled,
  actionLabel,
  helpers,
  components,
}) {
  const { t } = useTranslation();
  const {
    displayCartItemComparePrice,
    fallbackProductImage,
    imageFor,
    money,
  } = helpers;
  const {
    SummaryRow,
    SubmitButton,
    TrustPills,
  } = components;
  const shippingText = governorate
    ? shippingQuote.loading
      ? t("common.loading", "جاري التحميل...")
      : money(deliveryFee)
    : t("storefront.checkout.chooseGovernorate", "اختر المحافظة");
  const deliveryText = shippingQuote.estimated_delivery_text || t("storefront.checkout.expectedDeliveryNotice", "٢–٥ أيام عمل");
  const cartCount = Array.isArray(cart) ? cart.length : 0;

  return (
    <aside className="sf-checkout-summary h-max rounded-[1.7rem] border border-white/10 bg-[linear-gradient(145deg,rgba(255,255,255,0.075),rgba(255,255,255,0.035)_42%,rgba(7,10,20,0.9))] p-4 text-white shadow-[0_24px_70px_rgba(0,0,0,0.34),inset_0_1px_0_rgba(255,255,255,0.06)] ring-1 ring-white/[0.04] backdrop-blur-2xl lg:sticky lg:top-[calc(env(safe-area-inset-top)+1rem)] lg:self-start md:p-5">
      <button type="button" onClick={() => setOpen((value) => !value)} className="flex min-h-10 w-full items-center justify-between md:pointer-events-none">
        <span className="text-xl font-black text-white">{t("storefront.checkout.orderSummary", "ملخص الطلب")}</span>
        <span className="rounded-full border border-white/10 bg-white/[0.055] px-3 py-1 text-xs font-black text-white/70 md:hidden">{open ? t("common.hide", "إخفاء") : t("common.show", "إظهار")}</span>
      </button>
      <div className={`${open ? "block" : "hidden"} mt-3 space-y-2.5 md:block`}>
        <section className="rounded-2xl border border-white/10 bg-black/16 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-sm font-black text-white">{t("storefront.checkout.products", "المنتجات")}</h3>
            <span className="rounded-full border border-white/10 bg-white/[0.055] px-2.5 py-1 text-[10px] font-black text-white/65">{cartCount}</span>
          </div>
          <div className="grid gap-2.5">
            {cart.map((item) => {
              const quantity = cartItemQuantity(item);
              const unitPrice = cartItemUnitPrice(item);
              const lineTotal = unitPrice * quantity;
              const comparePrice = displayCartItemComparePrice(item);
              const variantRequired = hasVariantIndicators(item);
              const color = variantDisplayValue(cartItemColor(item), variantRequired);
              const size = variantDisplayValue(cartItemSize(item), variantRequired);
              const sku = cartItemSku(item);
              const name = cartItemName(item);
              const imageUrl = cartItemImageUrl(item);

              return (
                <article key={item.lineId} className="sf-checkout-summary-item sf-reveal rounded-2xl bg-white/[0.045] p-2.5 ring-1 ring-white/10">
                  <div className="flex min-w-0 gap-3">
                    <img
                      src={imageUrl ? imageFor(imageUrl) : imageFor(item.image_url)}
                      onError={fallbackProductImage}
                      alt=""
                      className="h-18 w-18 shrink-0 rounded-2xl object-cover shadow-sm"
                      loading="lazy"
                      decoding="async"
                      width="72"
                      height="72"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="sf-order-item-name line-clamp-2 break-words text-sm font-black leading-5 text-white">{name}</div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {sku ? <SummaryMeta label="SKU" value={sku} /> : null}
                        {color ? <SummaryMeta label={t("storefront.products.color", "اللون")} value={color} /> : null}
                        {size ? <SummaryMeta label={t("storefront.products.size", "المقاس")} value={size} /> : null}
                        <SummaryMeta label={t("storefront.checkout.quantity", "الكمية")} value={quantity} variant="accent" />
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] font-black">
                        <div className="rounded-2xl border border-white/10 bg-black/14 px-2.5 py-2">
                          <div className="text-white/46">{t("storefront.checkout.unitPrice", "السعر")}</div>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-white">
                            <span>{money(unitPrice)}</span>
                            {comparePrice ? <span className="text-[10px] text-white/36 line-through">{money(comparePrice)}</span> : null}
                          </div>
                        </div>
                        <div className="rounded-2xl border border-[#d4af37]/20 bg-[rgba(212,175,55,0.14)] px-2.5 py-2 text-right">
                          <div className="text-[#f3d77a]/80">{t("storefront.checkout.lineTotal", "الإجمالي")}</div>
                          <div className="mt-1 text-white">{money(lineTotal)}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
        <div className="sf-checkout-summary-totals rounded-2xl border border-white/10 bg-black/20 p-4 shadow-inner shadow-black/30">
          <SummaryRow dark label={t("storefront.checkout.products", "المنتجات")} value={money(subtotal)} />
          <SummaryRow dark label={t("storefront.checkout.discount", "الخصم")} value={discount ? `-${money(discount)}` : money(0)} />
          <SummaryRow dark label={t("storefront.checkout.shipping", "الشحن")} value={shippingText} />
          <SummaryRow dark label={t("storefront.checkout.total", "الإجمالي")} value={money(total)} strong />
          {codAmount ? <SummaryRow dark label={paymentMethod === "cod" ? t("storefront.checkout.codOnDelivery", "المتبقي عند الاستلام") : t("storefront.checkout.remainingOnDelivery", "المتبقي عند الاستلام")} value={money(codAmount)} /> : null}
        </div>
      </div>
      <div className="sf-checkout-summary-notes mt-3 grid gap-2 text-xs font-bold text-white/58">
        {import.meta.env.DEV && governorate ? (
          <span className="rounded-2xl border border-sky-300/20 bg-sky-400/10 px-3 py-2 text-sky-100">
            شحن dev: {shippingQuote.match_level || "default"} {shippingQuote.zone?.governorate ? `- ${[shippingQuote.zone.governorate, shippingQuote.zone.city, shippingQuote.zone.area].filter(Boolean).join(" / ")}` : ""}
          </span>
        ) : null}
        <span className="rounded-2xl border border-emerald-300/20 bg-emerald-400/10 px-3 py-2 text-emerald-100">{deliveryText}</span>
        {governorate && shippingQuote.cod_allowed === false ? <span className="rounded-2xl border border-amber-300/20 bg-amber-400/10 px-3 py-2 text-amber-100">{t("storefront.checkout.codUnavailableForAddress", "الدفع عند الاستلام غير متاح لهذا العنوان.")}</span> : null}
        <span className="rounded-2xl border border-[#d4af37]/20 bg-[rgba(212,175,55,0.12)] px-3 py-2 text-[#f3d77a]">{t("storefront.checkout.shippingProvidersReady", "بيانات الشحن جاهزة لـ Bosta / Mylerz / ShipBlu / التسليم داخل المتجر عند تفعيل شركة الشحن.")}</span>
      </div>
      <div className="mt-4 hidden md:block">
        <SubmitButton submitting={submitting} paymentMethod={paymentMethod} disabled={submitDisabled} label={actionLabel} />
        <div className="mt-3">
          <TrustPills />
        </div>
      </div>
    </aside>
  );
}
