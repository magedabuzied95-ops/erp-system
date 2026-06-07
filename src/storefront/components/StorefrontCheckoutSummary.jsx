import { useTranslation } from "react-i18next";

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
      ? t("common.loading", "Loading...")
      : money(deliveryFee)
    : t("storefront.checkout.chooseGovernorate", "Choose governorate");
  const deliveryText = shippingQuote.estimated_delivery_text || t("storefront.checkout.expectedDeliveryNotice", "Expected delivery is 2 to 5 business days depending on governorate.");

  return (
    <aside className="sf-checkout-summary h-max rounded-[1.7rem] border border-white/10 bg-[linear-gradient(145deg,rgba(255,255,255,0.075),rgba(255,255,255,0.035)_42%,rgba(7,10,20,0.9))] p-4 text-white shadow-[0_24px_70px_rgba(0,0,0,0.34),inset_0_1px_0_rgba(255,255,255,0.06)] ring-1 ring-white/[0.04] backdrop-blur-2xl lg:sticky lg:top-24 md:p-5">
      <button type="button" onClick={() => setOpen((value) => !value)} className="flex min-h-10 w-full items-center justify-between md:pointer-events-none">
        <span className="text-xl font-black text-white">{t("storefront.checkout.orderSummary", "Order summary")}</span>
        <span className="rounded-full border border-white/10 bg-white/[0.055] px-3 py-1 text-xs font-black text-white/70 md:hidden">{open ? t("common.hide", "Hide") : t("common.show", "Show")}</span>
      </button>
      <div className={`${open ? "block" : "hidden"} mt-3 space-y-2.5 md:block`}>
        {cart.map((item) => {
          const comparePrice = displayCartItemComparePrice(item);
          return (
            <div key={item.lineId} className="sf-checkout-summary-item sf-reveal flex min-w-0 items-center gap-3 rounded-2xl bg-white/[0.045] p-2.5 ring-1 ring-white/10">
              <img src={imageFor(item.image_url)} onError={fallbackProductImage} alt="" className="h-18 w-18 shrink-0 rounded-2xl object-cover shadow-sm" loading="lazy" decoding="async" width="72" height="72" />
              <div className="min-w-0 flex-1">
                <div className="sf-order-item-name truncate text-sm font-black leading-5 text-white">{item.name}</div>
                <div className="sf-order-item-meta mt-1 inline-flex rounded-full bg-white/[0.055] px-2 py-1 text-[11px] font-black text-white/60 ring-1 ring-white/10">{item.color || t("storefront.products.color", "Color")} / {item.size || t("storefront.products.size", "Size")} × {item.quantity}</div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] font-bold text-white/42">
                  <span>{t("storefront.checkout.unitPrice", "Unit price")} {money(item.price)}</span>
                  {comparePrice ? <span className="line-through">{money(comparePrice)}</span> : null}
                </div>
              </div>
              <div className="sf-order-item-price shrink-0 text-sm font-black text-white">{money(item.price * item.quantity)}</div>
            </div>
          );
        })}
      </div>
      <div className="sf-checkout-summary-totals mt-4 rounded-2xl border border-white/10 bg-black/20 p-4 shadow-inner shadow-black/30">
        <SummaryRow dark label={t("storefront.checkout.products", "Products")} value={money(subtotal)} />
        <SummaryRow dark label={t("storefront.checkout.discount", "Discount")} value={discount ? `-${money(discount)}` : money(0)} />
        <SummaryRow dark label={t("storefront.checkout.shipping", "Shipping")} value={shippingText} />
        <SummaryRow dark label={t("storefront.checkout.total", "Total")} value={money(total)} strong />
        {codAmount ? <SummaryRow dark label={paymentMethod === "cod" ? t("storefront.checkout.codOnDelivery", "COD on delivery") : t("storefront.checkout.remainingOnDelivery", "Remaining on delivery")} value={money(codAmount)} /> : null}
      </div>
      <div className="sf-checkout-summary-notes mt-3 grid gap-2 text-xs font-bold text-white/58">
        {import.meta.env.DEV && governorate ? (
          <span className="rounded-2xl border border-sky-300/20 bg-sky-400/10 px-3 py-2 text-sky-100">
            Shipping dev: {shippingQuote.match_level || "default"} {shippingQuote.zone?.governorate ? `- ${[shippingQuote.zone.governorate, shippingQuote.zone.city, shippingQuote.zone.area].filter(Boolean).join(" / ")}` : ""}
          </span>
        ) : null}
        <span className="rounded-2xl border border-emerald-300/20 bg-emerald-400/10 px-3 py-2 text-emerald-100">{deliveryText}</span>
        {governorate && shippingQuote.cod_allowed === false ? <span className="rounded-2xl border border-amber-300/20 bg-amber-400/10 px-3 py-2 text-amber-100">{t("storefront.checkout.codUnavailableForAddress", "Cash on delivery is not available for this address.")}</span> : null}
        <span className="rounded-2xl border border-[#a78bfa]/20 bg-[#7c3aed]/12 px-3 py-2 text-[#ddd6fe]">{t("storefront.checkout.shippingProvidersReady", "Shipping data is ready for Bosta / Mylerz / ShipBlu / In Store Delivery when the provider is enabled.")}</span>
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
