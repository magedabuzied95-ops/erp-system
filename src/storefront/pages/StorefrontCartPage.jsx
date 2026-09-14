import { useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { Minus, PackageCheck, Plus, ShieldCheck, ShoppingBag, Tag, Trash2, Truck } from "lucide-react";
import {
  RecentProductsSection,
  cartDrawerBundleShares,
  displayCartItemComparePrice,
  displayCartItemPrice,
  fallbackProductImage,
  imageFor,
  money,
  productUrl,
  sfText,
  usePublicBundleConfig,
} from "../Storefront";
import { CheckoutTotals } from "../components/StorefrontCheckoutSummary";
import { usePublicFreeShippingThreshold } from "../components/FreeShippingProgress";
import { trackGa4ViewCart } from "../lib/ga4Events";
import { ROOT_PATHS } from "../lib/paths";
import { localizeColorName, localizeSizeLabel } from "../lib/displayCopy";
import i18n from "../../i18n/i18n";
import "./cart.css";

/*
 * The cart page (/cart), laid out like the one-page checkout it leads to: the lines on the page
 * ground, the order summary in the side panel (sfc-* from checkout/checkout.css, the same totals
 * block checkout renders). It reads the numbers the side bag reads — the bundle discount from
 * cartDrawerBundleShares, the function checkout charges with — so the cart, the bag and the
 * invoice agree. The editable line is `sfk-*`, clear of the legacy `sf-cart-*` hooks.
 */

function CartLine({ item, bundleShare, bundlePercent, updateCart, removeFromCart }) {
  const price = displayCartItemPrice(item);
  const compare = displayCartItemComparePrice(item);
  const hasDiscount = compare > price;
  const quantity = Math.max(1, Number(item.quantity) || 1);
  const href = item.slug || item.product_id ? productUrl({ id: item.product_id, slug: item.slug, selected_variant_id: item.variant_id }) : "";
  const variantText = [localizeColorName(item.color, i18n.language), localizeSizeLabel(item.display_size || item.size, i18n.language)].filter(Boolean).join(" / ");
  const showBrand = Boolean(item.brand) && !String(item.name || "").toLowerCase().includes(String(item.brand).toLowerCase());
  const image = <img src={imageFor(item.image_url)} onError={fallbackProductImage} alt="" loading="lazy" decoding="async" width="96" height="96" />;

  return (
    <li className="sfk-line">
      {href ? <Link to={href} className="sfk-line__media">{image}</Link> : <span className="sfk-line__media">{image}</span>}
      <div className="sfk-line__body">
        <div className="sfk-line__top">
          <div className="sfk-line__info">
            {showBrand ? <p className="sfk-line__brand">{item.brand}</p> : null}
            {href ? <Link to={href} className="sfk-line__name">{item.name}</Link> : <p className="sfk-line__name">{item.name}</p>}
            {variantText ? <p className="sfk-line__variant">{variantText}</p> : null}
          </div>
          <p className="sfk-price">
            <span className="sfk-price__now">{money(price * quantity)}</span>
            {hasDiscount ? <span className="sfk-price__was">{money(compare * quantity)}</span> : null}
          </p>
        </div>

        {bundleShare > 0 ? (
          <p className="sfk-bundle">
            <Tag aria-hidden="true" />
            <span>
              {sfText("storefront.bundle.discountLabel", "خصم الباقة")}: {bundlePercent}% <span dir="ltr">(-{money(bundleShare)})</span>
            </span>
          </p>
        ) : null}

        <div className="sfk-line__bottom">
          <div className="sfx-stepper sfk-stepper">
            <button
              type="button"
              onClick={() => (quantity > 1 ? updateCart(item.lineId, quantity - 1) : removeFromCart(item.lineId))}
              aria-label={quantity > 1 ? sfText("storefront.cart.decreaseQuantity", "تقليل الكمية") : sfText("storefront.cart.removeItem", "حذف المنتج")}
            >
              {quantity > 1 ? <Minus aria-hidden="true" /> : <Trash2 aria-hidden="true" />}
            </button>
            <span className="sfx-stepper__value sfk-stepper__qty" aria-live="polite">{quantity}</span>
            <button type="button" onClick={() => updateCart(item.lineId, quantity + 1)} aria-label={sfText("storefront.cart.increaseQuantity", "زيادة الكمية")}>
              <Plus aria-hidden="true" />
            </button>
          </div>
          {quantity > 1 ? <span className="sfk-line__each">{money(price)} × {quantity}</span> : null}
          <button type="button" className="sfk-remove" onClick={() => removeFromCart(item.lineId)}>
            {sfText("storefront.cartDrawer.remove", "حذف")}
          </button>
        </div>
      </div>
    </li>
  );
}

function CartTrust() {
  return (
    <div className="sfc-trust">
      <span><ShieldCheck size={15} aria-hidden="true" />{sfText("storefront.checkout.trust.safeData", "بياناتك آمنة")}</span>
      <span><Truck size={15} aria-hidden="true" />{sfText("storefront.checkout.trust.fastShipping", "شحن سريع")}</span>
      <span><PackageCheck size={15} aria-hidden="true" />{sfText("storefront.checkout.trust.exchange", "استبدال خلال 14 يومًا")}</span>
    </div>
  );
}

export default function StorefrontCartPage({
  cart = [],
  updateCart,
  removeFromCart,
  recent = [],
  wishlist = [],
  toggleWishlist,
  onAddToCart,
  saleModeEnabled,
  themeMode = "light",
}) {
  const lines = useMemo(() => (Array.isArray(cart) ? cart : []), [cart]);
  const bundleConfig = usePublicBundleConfig();
  const bundlePercent = bundleConfig.enabled ? bundleConfig.percent : 0;
  const bundle = useMemo(() => cartDrawerBundleShares(lines, bundlePercent), [bundlePercent, lines]);
  const freeShippingThreshold = usePublicFreeShippingThreshold();

  useEffect(() => {
    if (lines.length) trackGa4ViewCart(lines);
  }, [lines]);

  const itemCount = lines.reduce((sum, item) => sum + Math.max(1, Number(item.quantity) || 1), 0);
  const subtotal = lines.reduce((sum, item) => sum + displayCartItemPrice(item) * item.quantity, 0);
  const compareTotal = lines.reduce((sum, item) => {
    const compare = displayCartItemComparePrice(item);
    const price = displayCartItemPrice(item);
    return sum + (compare > price ? compare : price) * item.quantity;
  }, 0);
  const bundleAmount = Math.min(subtotal, bundle.amount);
  const total = Math.max(0, subtotal - bundleAmount);
  const saved = Math.max(0, compareTotal - subtotal) + bundleAmount;
  const checkoutPath = ROOT_PATHS.checkout || "/checkout";
  const productsPath = ROOT_PATHS.products || "/products";

  const recentRail = recent.length ? (
    <RecentProductsSection recent={recent} wishlist={wishlist} toggleWishlist={toggleWishlist} onAddToCart={onAddToCart} saleModeEnabled={saleModeEnabled} />
  ) : null;

  if (!lines.length) {
    return (
      <>
        <section className="sfc sfk" data-theme={themeMode}>
          <div className="sfx-wrap sfx-wrap--sm sfx-section">
            <div className="sfx-empty sfk-empty">
            <span className="sfx-empty__icon sfk-empty__icon" aria-hidden="true"><ShoppingBag /></span>
            <h1 className="sfx-empty__title">{sfText("storefront.cart.emptyTitle", "السلة فارغة")}</h1>
            <p className="sfx-empty__text">{sfText("storefront.cart.emptyPageText", "اختر منتجًا أولًا ثم أكمل الدفع")}</p>
            <Link to={productsPath} className="sfx-btn sfx-btn--primary sfx-btn--lg">{sfText("storefront.common.shopNow", "تسوق الآن")}</Link>
            </div>
          </div>
        </section>
        {recentRail}
      </>
    );
  }

  // Checkout's totals block, fed the cart's own numbers: no governorate yet, so shipping reads
  // "calculated after choosing the governorate" exactly as it does on the next page.
  const totals = (
    <CheckoutTotals
      subtotal={subtotal}
      discount={bundleAmount}
      bundleDiscount={bundleAmount}
      deliveryFee={0}
      total={total}
      governorate=""
      freeShippingThreshold={freeShippingThreshold}
      money={money}
    />
  );
  const checkoutButton = (
    <Link to={checkoutPath} className="sfx-btn sfx-btn--primary sfx-btn--lg sfx-btn--block sfk-checkout">
      {sfText("storefront.cart.proceedToCheckout", "إتمام الشراء")}
    </Link>
  );
  const savedNote = saved > 0 ? <p className="sfk-saved">{sfText("storefront.cartDrawer.saved", "وفّرت {{amount}}", { amount: money(saved) })}</p> : null;

  return (
    <>
      <section className="sfc sfk" data-theme={themeMode}>
        <div className="sfc-grid">
          <div className="sfc-main">
            <header className="sfx-page-head sfk-head">
              <div className="sfx-page-head__text">
                <h1 className="sfx-title" id="sfk-cart-title">
                  {sfText("storefront.cart.title", "السلة")}
                </h1>
                <p className="sfx-subtitle sfk-count">{sfText("storefront.products.productCount", "{{count}} منتج", { count: itemCount })}</p>
              </div>
              <div className="sfx-page-head__actions">
                <Link to={productsPath} className="sfx-link-btn sfk-continue">{sfText("storefront.common.continueShopping", "متابعة التسوق")}</Link>
              </div>
            </header>
            <section className="sfk-section" aria-labelledby="sfk-cart-title">
              <ul className="sfk-lines">
                {lines.map((item) => (
                  <CartLine
                    key={item.lineId}
                    item={item}
                    bundleShare={bundle.byLine.get(item.lineId) || 0}
                    bundlePercent={bundlePercent}
                    updateCart={updateCart}
                    removeFromCart={removeFromCart}
                  />
                ))}
              </ul>
            </section>

            {/* Phones: the side panel is not shown, so its totals and button close the page. */}
            <div className="sfc-mobile-totals">
              {totals}
              {savedNote}
              <div className="sfc-submit">
                {checkoutButton}
                <CartTrust />
              </div>
            </div>
          </div>

          <aside className="sfc-side sfk-side" aria-label={sfText("storefront.checkout.orderSummary", "ملخص الطلب")}>
            <div className="sfc-side__inner">
              <h2 className="sfc-summary-title sfx-h3 sfk-summary-title">{sfText("storefront.checkout.orderSummary", "ملخص الطلب")}</h2>
              {totals}
              {savedNote}
              <div className="sfc-submit">
                {checkoutButton}
                <CartTrust />
              </div>
              <div className="sfc-summary-notes">
                <span>{sfText("storefront.cart.finalShippingAtCheckout", "يُحتسب الشحن النهائي عند الدفع")}</span>
              </div>
            </div>
          </aside>
        </div>
      </section>
      {recentRail}
    </>
  );
}
