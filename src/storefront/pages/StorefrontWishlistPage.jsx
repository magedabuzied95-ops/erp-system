import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";
import { Bell, Heart, Trash2 } from "lucide-react";
import {
  ProductCard,
  ProductSkeleton,
  RecentProductsSection,
  cleanDisplayText,
  firstDisplayVariant,
  imageFor,
  fallbackProductImage,
  money,
  productFromDetailsResponse,
  sfText,
  storefrontApi,
  variantColorKey,
  variantColorName,
  variantHasStock,
} from "../Storefront";
import { getDisplayPricing, parseSaleModeEnabled } from "../../shared/lib/storefrontPricing";
import { readStorefrontCustomerAuth } from "../lib/storefrontCustomerAuth";
import { entriesToToggleForClear, entriesToToggleForRestore, wishlistEntryMatches, wishlistIdOf } from "../lib/wishlistIdentity";
import { droppedPriceAlerts, usePriceDropAlerts } from "../lib/priceDropAlerts";
import { ROOT_PATHS, productPath } from "../lib/paths";
import "./wishlist.css";

/*
 * The wishlist page. Every saved product is drawn with the homepage card (ProductCard), from the
 * LIVE product rather than the snapshot taken when the heart was tapped, so the price, the sale
 * badge, the sizes and quick add are today's. The colour that was hearted stays the card's colour.
 * Colours are homepage tokens (site-skin.css); class names are `sfw-*`, clear of the legacy
 * `sf-wishlist-*` hooks that index.css and storefront-light.css still style with !important.
 */

const FETCH_CONCURRENCY = 4;
const FETCH_ATTEMPTS = 3;
// Literal keys, so the missing-key guard can see every one of them.
const FILTERS = [
  { key: "all", label: () => sfText("storefront.wishlist.filterAll", "الكل") },
  { key: "inStock", label: () => sfText("storefront.wishlist.filterInStock", "متوفر") },
  { key: "onSale", label: () => sfText("storefront.wishlist.filterOnSale", "عليه خصم") },
];
const SORTS = [
  { key: "newest", label: () => sfText("storefront.wishlist.sortNewest", "المضاف حديثًا") },
  { key: "priceLow", label: () => sfText("storefront.wishlist.sortPriceLow", "الأقل سعرًا") },
  { key: "priceHigh", label: () => sfText("storefront.wishlist.sortPriceHigh", "الأعلى سعرًا") },
];

/** Loads each saved product once; `missing` means the store no longer shows it. */
function useWishlistProducts(entries) {
  const [details, setDetails] = useState({});
  const requested = useRef(new Set());
  // Two hearted colours of one model are one request.
  const idsKey = [...new Set(entries.map((entry) => entry.id))].join("|");

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // A request outlives a change of the list (removing one product must not strand the others
  // in flight); only leaving the page drops the answers.
  useEffect(() => {
    const queue = (idsKey ? idsKey.split("|") : []).filter((id) => !requested.current.has(id));
    queue.forEach((id) => requested.current.add(id));
    const worker = async () => {
      while (queue.length && mounted.current) {
        const id = queue.shift();
        let next;
        for (let attempt = 1; attempt <= FETCH_ATTEMPTS && mounted.current; attempt += 1) {
          try {
            const product = productFromDetailsResponse(await storefrontApi.getProductDetails(id));
            next = product?.id ? { status: "ready", product } : { status: "missing" };
            break;
          } catch (error) {
            const status = Number(error?.status || error?.response?.status || 0);
            next = { status: status === 404 ? "missing" : "error" };
            if (status === 404) break;
            // A gateway blip is not a verdict: wait a moment and ask again.
            if (attempt < FETCH_ATTEMPTS) await new Promise((resolve) => window.setTimeout(resolve, 1200 * attempt));
          }
        }
        if (next?.status === "error") requested.current.delete(id);
        if (mounted.current) setDetails((current) => ({ ...current, [id]: next }));
      }
    };
    Array.from({ length: Math.min(FETCH_CONCURRENCY, queue.length) }, worker);
  }, [idsKey]);

  return details;
}

/** One row per saved product: the card-ready product, its price and whether it can be bought. */
const buildRows = (entries, details, saleModeEnabled) => {
  const saleMode = parseSaleModeEnabled(saleModeEnabled, false);
  return entries.map((entry, order) => {
    const state = details[entry.id];
    if (!state || state.status !== "ready") return { entry, order, status: state?.status || "loading" };
    const variants = Array.isArray(state.product.variants) ? state.product.variants : [];
    const colourVariants = entry.color_key ? variants.filter((variant) => variantColorKey(variant) === entry.color_key) : [];
    const shownVariants = colourVariants.length ? colourVariants : variants;
    // Named like its listing card ("SKECHERS - Navy"): two colours of one model are two tiles.
    const colourName = colourVariants.length ? cleanDisplayText(variantColorName(colourVariants[0])) : "";
    const product = colourVariants.length
      ? { ...state.product, color_key: entry.color_key, name: colourName ? `${state.product.name} - ${colourName}` : state.product.name }
      : state.product;
    const pricing = getDisplayPricing(state.product, saleMode, firstDisplayVariant(shownVariants) || {});
    return {
      entry,
      order,
      status: "ready",
      product,
      price: Number(pricing.price) || 0,
      onSale: Boolean(pricing.isOnSale),
      inStock: shownVariants.some(variantHasStock),
    };
  });
};

function WishlistEmpty() {
  return (
    <div className="sfx-empty sfw-empty">
      <span className="sfx-empty__icon" aria-hidden="true">
        <Heart size={26} strokeWidth={1.75} />
      </span>
      <h2 className="sfx-empty__title">{sfText("storefront.wishlist.emptyTitle", "المفضلة فاضية")}</h2>
      <p className="sfx-empty__text">{sfText("storefront.wishlist.emptyHint", "دوس على القلب اللي على أي منتج، وهتلاقيه هنا وقت ما تحب ترجع له.")}</p>
      <Link to={ROOT_PATHS.products || "/products"} className="sfx-btn sfx-btn--primary sfx-btn--lg">
        {sfText("storefront.common.shopNow", "تسوق الآن")}
      </Link>
    </div>
  );
}

function PriceDropNotice({ dropped }) {
  return (
    <div className="sfx-notice sfw-notice">
      <span className="sfw-notice__icon" aria-hidden="true">
        <Bell size={18} />
      </span>
      <div className="sfw-notice__body">
        <p className="sfx-h3 sfw-notice__title">{sfText("storefront.priceDrop.panelTitle", "تنبيه نزول السعر")}</p>
        <p className="sfw-notice__text">{sfText("storefront.priceDrop.panelText", "بنتابع أسعار المنتجات اللي في المفضلة واللي طلبت تتنبّه لها، وأول ما سعر أي منتج ينزل هنبلغك.")}</p>
        {dropped.length ? (
          <ul className="sfw-drops">
            {dropped.map((alert) => (
              <li key={alert.product_id}>
                <Link to={productPath(alert.product.slug || alert.product.id)} className="sfw-drop">
                  <img src={imageFor(alert.product.image_url)} onError={fallbackProductImage} alt="" className="sfw-drop__img" loading="lazy" decoding="async" width="44" height="44" />
                  <span className="sfw-drop__body">
                    <span className="sfw-drop__name">{alert.product.name}</span>
                    <span className="sfw-drop__price">
                      <span className="sfw-drop__now">{money(alert.current_price)}</span>
                      <span className="sfw-drop__was">{sfText("storefront.priceDrop.was", "كان {{price}}", { price: money(alert.followed_price) })}</span>
                    </span>
                  </span>
                  <span className="sfx-badge sfx-badge--sale sfw-drop__flag">{sfText("storefront.wishlist.priceDropped", "نزل سعرها")}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

function UnavailableTile({ entry, status, onRemove }) {
  const href = productPath(entry.slug || entry.id, entry.color_key ? { color: entry.color_key } : "");
  return (
    <article className="sfw-gone">
      <div className="sfw-gone__plate">
        {entry.image_url ? (
          <img src={imageFor(entry.image_url)} onError={fallbackProductImage} alt="" className="sfw-gone__img" loading="lazy" decoding="async" />
        ) : (
          <Heart size={22} aria-hidden="true" />
        )}
      </div>
      <div className="sfw-gone__body">
        {status === "missing" ? (
          <p className="sfw-gone__name">{entry.name || sfText("storefront.products.savedProduct", "منتج محفوظ")}</p>
        ) : (
          <Link to={href} className="sfw-gone__name">{entry.name || sfText("storefront.products.savedProduct", "منتج محفوظ")}</Link>
        )}
        {status === "missing" ? <p className="sfw-gone__note">{sfText("storefront.wishlist.unavailableTitle", "المنتج ده مش متاح دلوقتي")}</p> : null}
        <button type="button" onClick={() => onRemove(entry)} className="sfw-gone__remove">
          <Trash2 size={14} aria-hidden="true" />
          {sfText("storefront.wishlist.removeFromWishlist", "شيل من المفضلة")}
        </button>
      </div>
    </article>
  );
}

export default function StorefrontWishlistPage({ wishlist = [], toggleWishlist, onAddToCart, saleModeEnabled, recent = [] }) {
  const entries = useMemo(() => (Array.isArray(wishlist) ? wishlist.filter((entry) => entry?.key) : []), [wishlist]);
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const details = useWishlistProducts(entries);
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState("newest");
  const [confirmingClear, setConfirmingClear] = useState(false);
  const priceDrop = usePriceDropAlerts();
  const signedIn = Boolean(readStorefrontCustomerAuth().token);

  const rows = useMemo(() => buildRows(entries, details, saleModeEnabled), [details, entries, saleModeEnabled]);
  const counts = useMemo(() => ({
    all: rows.length,
    inStock: rows.filter((row) => row.inStock).length,
    onSale: rows.filter((row) => row.onSale).length,
  }), [rows]);
  const loading = rows.some((row) => row.status === "loading");

  const visibleRows = useMemo(() => {
    const filtered = rows.filter((row) => {
      if (filter === "inStock") return row.inStock;
      if (filter === "onSale") return row.onSale;
      return true;
    });
    if (sort === "newest") return filtered;
    // Rows without a live price keep their place at the end.
    const direction = sort === "priceLow" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      if (!a.price || !b.price) return (a.price ? -1 : 0) - (b.price ? -1 : 0) || a.order - b.order;
      return (a.price - b.price) * direction || a.order - b.order;
    });
  }, [filter, rows, sort]);

  useEffect(() => {
    if (filter !== "all" && !loading && counts[filter] === 0) setFilter("all");
  }, [counts, filter, loading]);

  useEffect(() => {
    if (!confirmingClear) return undefined;
    const timer = window.setTimeout(() => setConfirmingClear(false), 4000);
    return () => window.clearTimeout(timer);
  }, [confirmingClear]);

  const restore = useCallback((saved) => {
    entriesToToggleForRestore(entriesRef.current, saved).forEach((entry) => toggleWishlist(entry));
  }, [toggleWishlist]);

  const announceRemoval = useCallback((saved, message) => {
    toast((tt) => (
      <span className="sfw-toast">
        <span>{message}</span>
        <button
          type="button"
          className="sfw-toast__undo"
          onClick={() => {
            restore(saved);
            toast.dismiss(tt.id);
          }}
        >
          {sfText("storefront.wishlist.undo", "تراجع")}
        </button>
      </span>
    ), { id: "wishlist-removed", duration: 5000 });
  }, [restore]);

  // The card's heart removes from this page; the toast offers it back.
  const handleToggle = useCallback((product) => {
    const saved = entriesRef.current.filter((entry) => wishlistEntryMatches(entry, product));
    toggleWishlist(product);
    if (saved.length) announceRemoval(saved, sfText("storefront.wishlist.removed", "اتشال من المفضلة"));
  }, [announceRemoval, toggleWishlist]);

  const clearAll = useCallback(() => {
    if (!confirmingClear) {
      setConfirmingClear(true);
      return;
    }
    const saved = entriesRef.current;
    entriesToToggleForClear(saved).forEach((entry) => toggleWishlist(entry));
    setConfirmingClear(false);
    announceRemoval(saved, sfText("storefront.wishlist.cleared", "المفضلة اتمسحت"));
  }, [announceRemoval, confirmingClear, toggleWishlist]);

  const dropped = droppedPriceAlerts(priceDrop.alerts);
  const showPriceDrop = priceDrop.enabled && signedIn && (entries.length > 0 || dropped.length > 0);
  const wishlistIds = useMemo(() => new Set(entries.map((entry) => entry.id)), [entries]);
  const recentOutsideWishlist = useMemo(
    () => (Array.isArray(recent) ? recent : []).filter((item) => !wishlistIds.has(wishlistIdOf(item))),
    [recent, wishlistIds]
  );

  return (
    <section className="sfw">
      <div className="sfx-wrap sfw-wrap">
        <header className="sfw-head">
          <div className="sfx-page-head">
            <div className="sfx-page-head__text">
            <h1 className="sfx-title">{sfText("storefront.header.wishlist", "المفضلة")}</h1>
            {entries.length ? (
              <p className="sfx-subtitle sfw-count">{sfText("storefront.products.productCount", "{{count}} منتج", { count: entries.length })}</p>
            ) : null}
          </div>
          {entries.length ? (
            <div className="sfx-page-head__actions">
              <button
                type="button"
                onClick={clearAll}
                className={`sfx-btn ${confirmingClear ? "sfx-btn--danger is-confirming" : "sfx-btn--ghost"}`}
                aria-live="polite"
              >
                <Trash2 size={15} aria-hidden="true" />
                {confirmingClear ? sfText("storefront.wishlist.confirmClear", "تأكيد المسح") : sfText("storefront.wishlist.clearAll", "مسح الكل")}
              </button>
              <Link to={ROOT_PATHS.products || "/products"} className="sfx-btn sfx-btn--secondary">
                {sfText("storefront.common.continueShopping", "متابعة التسوق")}
              </Link>
            </div>
          ) : null}
          </div>
        </header>

        {!signedIn && entries.length ? (
          <div className="sfx-notice sfw-notice sfw-notice--quiet">
            <span className="sfw-notice__icon" aria-hidden="true">
              <Heart size={18} />
            </span>
            <p className="sfw-notice__text sfw-notice__text--inline">
              {sfText("storefront.wishlist.guestNote", "مفضلتك محفوظة على الجهاز ده بس. سجّل دخولك علشان تلاقيها على أي جهاز.")}
            </p>
            <Link to={ROOT_PATHS.account || "/account"} className="sfx-btn sfx-btn--primary sfx-btn--sm">
              {sfText("storefront.wishlist.signIn", "تسجيل الدخول")}
            </Link>
          </div>
        ) : null}

        {showPriceDrop ? <PriceDropNotice dropped={dropped} /> : null}

        {entries.length ? (
          <>
            <div className="sfw-toolbar">
              <div className="sfw-chips" role="group" aria-label={sfText("storefront.header.wishlist", "المفضلة")}>
                {FILTERS.map(({ key, label }) => {
                  const count = counts[key];
                  const disabled = key !== "all" && !loading && count === 0;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setFilter(key)}
                      aria-pressed={filter === key}
                      disabled={disabled}
                      className={`sfx-chip sfw-chip${filter === key ? " is-active" : ""}`}
                    >
                      {label()}
                      <span className="sfx-chip__count" dir="ltr">{count}</span>
                    </button>
                  );
                })}
              </div>
              <div className="sfx-tabs sfw-sort" role="group" aria-label={sfText("storefront.wishlist.sortLabel", "ترتيب")}>
                {SORTS.map(({ key, label }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setSort(key)}
                    aria-pressed={sort === key}
                    className={`sfx-tab${sort === key ? " is-active" : ""}`}
                  >
                    {label()}
                  </button>
                ))}
              </div>
            </div>

            {visibleRows.length ? (
              <div className="sfx-product-grid sfw-grid grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
                {visibleRows.map((row, index) => {
                  if (row.status === "loading") return <ProductSkeleton key={row.entry.key} count={1} className="sfw-skeleton" />;
                  if (row.status !== "ready") return <UnavailableTile key={row.entry.key} entry={row.entry} status={row.status} onRemove={handleToggle} />;
                  return (
                    <ProductCard
                      key={row.entry.key}
                      product={row.product}
                      wishlist={entries}
                      toggleWishlist={handleToggle}
                      onAddToCart={onAddToCart}
                      saleModeEnabled={saleModeEnabled}
                      sizeLimit={4}
                      eagerImage={index < 4}
                      priorityImage={index === 0}
                    />
                  );
                })}
              </div>
            ) : (
              <div className="sfx-empty sfx-empty--compact sfw-empty">
                <p className="sfx-empty__text">{sfText("storefront.wishlist.noMatches", "مفيش منتجات في المفضلة بالفلتر ده")}</p>
                <button type="button" onClick={() => setFilter("all")} className="sfx-btn sfx-btn--secondary">
                  {sfText("storefront.wishlist.showAll", "عرض الكل")}
                </button>
              </div>
            )}
          </>
        ) : (
          <WishlistEmpty />
        )}
      </div>

      {recentOutsideWishlist.length ? (
        <RecentProductsSection
          recent={recentOutsideWishlist}
          wishlist={entries}
          toggleWishlist={toggleWishlist}
          onAddToCart={onAddToCart}
          saleModeEnabled={saleModeEnabled}
        />
      ) : null}
    </section>
  );
}
