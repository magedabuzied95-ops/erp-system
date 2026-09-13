import { useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { MessageCircle, Minus, Plus, RefreshCcw, ShieldCheck, ShoppingBag, Tag, Trash2, Truck } from "lucide-react";
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
import FreeShippingProgress, { usePublicFreeShippingThreshold } from "../components/FreeShippingProgress";
import { trackGa4ViewCart } from "../lib/ga4Events";
import { ROOT_PATHS } from "../lib/paths";
import "./cart.css";

/*
 * The cart page (/cart) in the homepage look. It reads the same numbers the side bag does — the
 * bundle discount comes from cartDrawerBundleShares (the function checkout charges with), the
 * free-shipping bar from the store threshold — so the page, the bag and the invoice agree.
 * Colours are `--m1h-*` tokens (site-skin.css); class names are `sfk-*`, clear of the legacy
 * `sf-cart-*` hooks that index.css and storefront-light.css still paint with !important.
 */

// Literal keys, so the missing-key guard can see every one of them.
const TRUST_POINTS = [
  { key: "safe", Icon: ShieldCheck, label: () => sfText("storefront.checkout.trust.safeData", "بياناتك آمنة") },
  { key: "shipping", Icon: Truck, label: () => sfText("storefront.checkout.trust.fastShipping", "شحن سريع") },
  { key: "exchange", Icon: RefreshCcw, label: () => sfText("storefront.checkout.trust.exchange", "استبدال خلال 14 يومًا") },
  { key: "whatsapp", Icon: MessageCircle, label: () => sfText("storefront.checkout.trust.whatsapp", "دعم واتساب") },
];

function CartLine({ item, bundleShare, bundlePercent, updateCart, removeFromCart }) {
  const price = displayCartItemPrice(item);
  const compare = displayCartItemComparePrice(item);
  const hasDiscount = compare > price;
  const quantity = Math.max(1, Number(item.quantity) || 1);
  const href = item.slug || item.product_id ? productUrl({ id: item.product_id, slug: item.slug, selected_variant_id: item.variant_id }) : "";
  const variantText = [item.color, item.display_size || item.size].filter(Boolean).join(" · ");
  const showBrand = Boolean(item.brand) && !String(item.name || "").toLowerCase().includes(String(item.brand).toLowerCase());
  const image = <img src={imageFor(item.image_url)} onError={fallbackProductImage} alt="" loading="lazy" decoding="async" width="120" height="120" />;

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
            {hasDiscount ? <span className="sfk-price__was">{money(compare)}</span> : null}
            <span className={`sfk-price__now${hasDiscount ? " is-sale" : ""}`}>{money(price)}</span>
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
          <div className="sfk-stepper">
            <button
              type="button"
              onClick={() => (quantity > 1 ? updateCart(item.lineId, quantity - 1) : removeFromCart(item.lineId))}
              aria-label={quantity > 1 ? sfText("storefront.cart.decreaseQuantity", "تقليل الكمية") : sfText("storefront.cart.removeItem", "حذف المنتج")}
            >
              {quantity > 1 ? <Minus aria-hidden="true" /> : <Trash2 aria-hidden="true" />}
            </button>
            <span className="sfk-stepper__qty" aria-live="polite">{quantity}</span>
            <button type="button" onClick={() => updateCart(item.lineId, quantity + 1)} aria-label={sfText("storefront.cart.increaseQuantity", "زيادة الكمية")}>
              <Plus aria-hidden="true" />
            </button>
          </div>
          <div className="sfk-line__end">
            {quantity > 1 ? <span className="sfk-line__total">{money(price * quantity)}</span> : null}
            <button type="button" className="sfk-remove" onClick={() => removeFromCart(item.lineId)}>
              <Trash2 aria-hidden="true" />
              {sfText("storefront.cartDrawer.remove", "حذف")}
            </button>
          </div>
        </div>
      </div>
    </li>
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
  const saleSaving = Math.max(0, compareTotal - subtotal);
  const bundleAmount = Math.min(subtotal, bundle.amount);
  const total = Math.max(0, subtotal - bundleAmount);
  const saved = saleSaving + bundleAmount;
  const checkoutPath = ROOT_PATHS.checkout || "/checkout";
  const productsPath = ROOT_PATHS.products || "/products";

  const recentRail = recent.length ? (
    <RecentProductsSection recent={recent} wishlist={wishlist} toggleWishlist={toggleWishlist} onAddToCart={onAddToCart} saleModeEnabled={saleModeEnabled} />
  ) : null;

  if (!lines.length) {
    return (
      <section className="sfk">
        <div className="sfk-wrap">
          <div className="sfk-empty">
            <span className="sfk-empty__icon" aria-hidden="true"><ShoppingBag /></span>
            <h1 className="sfk-empty__title">{sfText("storefront.cart.emptyTitle", "السلة فارغة")}</h1>
            <p className="sfk-empty__text">{sfText("storefront.cart.emptyPageText", "اختر منتجًا أولًا ثم أكمل الدفع")}</p>
            <Link to={productsPath} className="sfk-btn sfk-btn--ink">{sfText("storefront.common.shopNow", "تسوق الآن")}</Link>
          </div>
        </div>
        {recentRail}
      </section>
    );
  }

  return (
    <section className="sfk">
      <div className="sfk-wrap">
        <header className="sfk-head">
          <div className="sfk-head__title">
            <h1 className="sfk-title">{sfText("storefront.cart.title", "السلة")}</h1>
            <span className="sfk-count">{sfText("storefront.products.productCount", "{{count}} منتج", { count: itemCount })}</span>
          </div>
          <Link to={productsPath} className="sfk-btn sfk-btn--outline sfk-btn--sm">
            {sfText("storefront.common.continueShopping", "متابعة التسوق")}
          </Link>
        </header>

        <div className="sfk-grid">
          <div className="sfk-main">
            {freeShippingThreshold ? (
              <div className="sfk-card sfk-card--tight">
                {/* The server compares the goods subtotal before the bundle saving, so the bar does too. */}
                <FreeShippingProgress subtotal={subtotal} threshold={freeShippingThreshold} money={money} className="sfk-fsp" />
              </div>
            ) : null}
            <ul className="sfk-card sfk-lines">
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
          </div>

          <aside className="sfk-side">
            <div className="sfk-card sfk-summary">
              <h2 className="sfk-summary__title">{sfText("storefront.checkout.orderSummary", "ملخص الطلب")}</h2>
              <dl className="sfk-rows">
                <div className="sfk-row">
                  <dt>{sfText("storefront.checkout.products", "المنتجات")}</dt>
                  <dd>{money(saleSaving > 0 ? compareTotal : subtotal)}</dd>
                </div>
                {saleSaving > 0 ? (
                  <div className="sfk-row sfk-row--saving">
                    <dt>{sfText("storefront.cart.discount", "الخصم")}</dt>
                    <dd dir="ltr">-{money(saleSaving)}</dd>
                  </div>
                ) : null}
                {bundleAmount > 0 ? (
                  <div className="sfk-row sfk-row--saving">
                    <dt>{sfText("storefront.bundle.discountLabel", "خصم الباقة")}</dt>
                    <dd dir="ltr">-{money(bundleAmount)}</dd>
                  </div>
                ) : null}
                <div className="sfk-row">
                  <dt>{sfText("storefront.checkout.shipping", "الشحن")}</dt>
                  <dd className="sfk-row__muted">{sfText("storefront.cart.shippingAtCheckout", "بيتحسب في صفحة الدفع")}</dd>
                </div>
                <div className="sfk-row sfk-row--total">
                  <dt>{sfText("storefront.checkout.total", "الإجمالي")}</dt>
                  <dd>{money(total)}</dd>
                </div>
              </dl>
              {saved > 0 ? <p className="sfk-saved">{sfText("storefront.cartDrawer.saved", "وفّرت {{amount}}", { amount: money(saved) })}</p> : null}
              <Link to={checkoutPath} className="sfk-btn sfk-btn--ink sfk-btn--block">
                {sfText("storefront.cart.proceedToCheckout", "إتمام الشراء")}
              </Link>
              <ul className="sfk-trust">
                {TRUST_POINTS.map(({ key, Icon, label }) => (
                  <li key={key}>
                    <Icon aria-hidden="true" />
                    {label()}
                  </li>
                ))}
              </ul>
            </div>
          </aside>
        </div>
      </div>

      {/* Phones: the total and the way to checkout stay in reach while the lines scroll. */}
      <div className="sfk-bar">
        <div className="sfk-bar__total">
          <span className="sfk-bar__label">{sfText("storefront.checkout.total", "الإجمالي")}</span>
          <strong>{money(total)}</strong>
        </div>
        <Link to={checkoutPath} className="sfk-btn sfk-btn--ink">
          {sfText("storefront.cart.proceedToCheckout", "إتمام الشراء")}
        </Link>
      </div>

      {recentRail}
    </section>
  );
}
