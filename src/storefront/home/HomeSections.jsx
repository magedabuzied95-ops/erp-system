/**
 * M1 Store — homepage presentation layer.
 *
 * Every component here is pure presentation: it receives finished view models
 * (built by buildHomeProductCard in ./homeModel.js) and renders them. No
 * fetching, no price maths, no routing rules -- those stay in Storefront.jsx
 * where they already live, so this file can be reviewed, restyled or reverted
 * without touching commerce behaviour.
 *
 * Scope is the homepage only. Nothing here is imported by the product, listing,
 * cart, checkout or account pages.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, ArrowRight, CreditCard, Headphones, Heart, RefreshCcw, Truck } from "lucide-react";

import "./home.css";

/* ==========================================================================
   Deferred mount
   ========================================================================== */

/**
 * Renders `children` only once the placeholder comes within 600px of the
 * viewport. Used to keep the one homepage block that needs its own request off
 * the boot waterfall: nothing it fetches competes with first paint.
 */
export function HomeDeferred({ minHeight = 320, children }) {
  const holderRef = useRef(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (shown) return undefined;
    const node = holderRef.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      setShown(true);
      return undefined;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setShown(true);
        observer.disconnect();
      },
      { rootMargin: "600px 0px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [shown]);

  if (shown) return children;
  return <div ref={holderRef} aria-hidden="true" style={{ minHeight }} />;
}

/* ==========================================================================
   Section header
   ========================================================================== */

/**
 * The one section header on the homepage: a title, an optional "view all", and
 * an optional slot on the same baseline for section-specific controls.
 */
export function HomeSectionHeader({ title, href, linkLabel, actions = null }) {
  return (
    <div className="m1h-sec">
      <h2 className="m1h-sec__title">{title}</h2>
      {actions || (href && linkLabel) ? (
        <div className="m1h-sec__end">
          {actions}
          {href && linkLabel ? (
            <Link to={href} className="m1h-sec__link">
              {linkLabel}
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/* ==========================================================================
   Product card
   ========================================================================== */

export const HomeProductCard = memo(function HomeProductCard({
  card,
  favorite = false,
  onToggleFavorite,
  onImageError,
  favoriteLabel = "",
  eager = false,
}) {
  const handleFavorite = useCallback(
    (event) => {
      event.preventDefault();
      event.stopPropagation();
      onToggleFavorite?.(card.product);
    },
    [card.product, onToggleFavorite]
  );

  return (
    <Link to={card.href} className="m1h-card" aria-label={card.alt}>
      <div className="m1h-card__plate">
        {card.discount ? (
          <span className="m1h-badge m1h-badge--sale">-{card.discount}%</span>
        ) : card.lastPiece ? (
          <span className="m1h-badge m1h-badge--last">{card.lastPieceLabel}</span>
        ) : null}
        {onToggleFavorite ? (
          <button
            type="button"
            className={`m1h-fav${favorite ? " is-on" : ""}`}
            onClick={handleFavorite}
            aria-label={favoriteLabel}
            aria-pressed={favorite}
          >
            <Heart size={15} strokeWidth={2} />
          </button>
        ) : null}
        {card.image ? (
          <img
            src={card.image}
            {...card.imageProps}
            alt={card.alt}
            className="m1h-card__img"
            onError={onImageError}
            loading={eager ? "eager" : "lazy"}
            decoding="async"
            width="360"
            height="360"
          />
        ) : null}
      </div>
      <div className="m1h-card__body">
        <p className="m1h-card__brand">{card.eyebrow}</p>
        <h3 className="m1h-card__name">{card.title}</h3>
        <div className="m1h-card__price">
          <span className={`m1h-card__price-now${card.compareText ? " m1h-card__price-now--sale" : ""}`}>
            {card.priceText}
          </span>
          {card.compareText ? <span className="m1h-card__price-was">{card.compareText}</span> : null}
        </div>
      </div>
    </Link>
  );
});

function ProductCardSkeleton() {
  return (
    <div className="m1h-card" aria-hidden="true">
      <div className="m1h-skel" style={{ aspectRatio: "1 / 1" }} />
      <div className="m1h-card__body">
        <div className="m1h-skel" style={{ height: 10, width: "40%", borderRadius: 999 }} />
        <div className="m1h-skel" style={{ height: 13, width: "84%", marginTop: 8, borderRadius: 999 }} />
        <div className="m1h-skel" style={{ height: 15, width: "46%", marginTop: 10, borderRadius: 999 }} />
      </div>
    </div>
  );
}

/* ==========================================================================
   Product collections — a rail and a grid, so two adjacent sections never read
   as the same component twice.
   ========================================================================== */

/**
 * Desktop-only paging arrows for a rail. Touch devices scroll the rail directly
 * and get a peeking card as the affordance; a mouse has neither, so on wide
 * screens the arrows appear -- and only while there is somewhere to go.
 */
function useRailPaging(railRef, itemCount) {
  const [state, setState] = useState({ start: true, end: true });

  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return undefined;
    const update = () => {
      const max = rail.scrollWidth - rail.clientWidth;
      // scrollLeft is negative in RTL, so compare on distance travelled.
      const travelled = Math.abs(rail.scrollLeft);
      setState({ start: travelled <= 2, end: travelled >= max - 2 });
    };
    update();
    rail.addEventListener("scroll", update, { passive: true });
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    observer?.observe(rail);
    return () => {
      rail.removeEventListener("scroll", update);
      observer?.disconnect();
    };
  }, [itemCount, railRef]);

  const page = useCallback(
    (direction) => {
      const rail = railRef.current;
      if (!rail) return;
      const step = rail.clientWidth * 0.8;
      const sign = getComputedStyle(rail).direction === "rtl" ? -1 : 1;
      rail.scrollBy({ left: direction * step * sign, behavior: "smooth" });
    },
    [railRef]
  );

  return { ...state, page };
}

function ProductCollection({
  variant,
  title,
  href,
  linkLabel,
  cards = [],
  loading = false,
  skeletonCount = 4,
  eagerFirst = false,
  isFavorite,
  onToggleFavorite,
  onImageError,
  favoriteLabel,
  prevLabel = "",
  nextLabel = "",
}) {
  const railRef = useRef(null);
  const { start, end, page } = useRailPaging(railRef, cards.length);
  const showSkeletons = loading && !cards.length;
  if (!showSkeletons && !cards.length) return null;

  return (
    <section className="m1h-block m1h-reveal">
      <div className="m1h-shell">
        <HomeSectionHeader
          title={title}
          href={href}
          linkLabel={linkLabel}
          actions={
            variant === "rail" && !(start && end) ? (
              <span className="m1h-railnav">
                <button type="button" className="m1h-railnav__btn" onClick={() => page(-1)} disabled={start} aria-label={prevLabel}>
                  <ArrowLeft size={16} strokeWidth={2} />
                </button>
                <button type="button" className="m1h-railnav__btn" onClick={() => page(1)} disabled={end} aria-label={nextLabel}>
                  <ArrowRight size={16} strokeWidth={2} />
                </button>
              </span>
            ) : null
          }
        />
        <div ref={railRef} className={variant === "rail" ? "m1h-rail m1h-rail--products" : "m1h-grid"}>
          {showSkeletons
            ? Array.from({ length: skeletonCount }).map((_, index) => <ProductCardSkeleton key={index} />)
            : cards.map((card, index) => (
                <HomeProductCard
                  key={card.key}
                  card={card}
                  eager={eagerFirst && index < 2}
                  favorite={Boolean(isFavorite?.(card.product))}
                  onToggleFavorite={onToggleFavorite}
                  onImageError={onImageError}
                  favoriteLabel={favoriteLabel}
                />
              ))}
        </div>
      </div>
    </section>
  );
}

export function HomeProductRail(props) {
  return <ProductCollection variant="rail" skeletonCount={3} {...props} />;
}

export function HomeProductGrid(props) {
  return <ProductCollection variant="grid" skeletonCount={4} {...props} />;
}

/* ==========================================================================
   Categories
   ========================================================================== */

export function HomeCategoryRail({ title, cards = [], links = [], loading = false, onImageError }) {
  const visible = cards.filter(Boolean);
  if (!visible.length && !loading) return null;

  return (
    <section className="m1h-block m1h-reveal">
      <div className="m1h-shell">
        <HomeSectionHeader title={title} />
        <div className="m1h-rail m1h-rail--categories">
          {(loading && !visible.length ? Array.from({ length: 3 }) : visible).map((card, index) =>
            card ? (
              <Link key={card.id} to={card.href} className="m1h-cat">
                {card.image ? (
                  <img
                    src={card.image}
                    alt=""
                    className="m1h-cat__img"
                    onError={onImageError}
                    loading={index < 2 ? "eager" : "lazy"}
                    decoding="async"
                    width="480"
                    height="640"
                  />
                ) : null}
                <span className="m1h-cat__scrim" />
                <span className="m1h-cat__label">{card.title}</span>
              </Link>
            ) : (
              <div key={index} className="m1h-skel" style={{ aspectRatio: "3 / 4" }} aria-hidden="true" />
            )
          )}
        </div>
        {/* The remaining product types have no campaign photography of their own.
            Rather than fill three tiles with cut-outs on white next to three
            lifestyle shots, they get a quiet row of links. */}
        {links.length ? (
          <div className="m1h-catlinks">
            {links.map((link) => (
              <Link key={link.href} to={link.href} className="m1h-catlinks__item">
                {link.label}
              </Link>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}

/* ==========================================================================
   Hero
   ========================================================================== */

const HERO_ROTATE_MS = 6000;

export function HomeHero({
  isRtl = true,
  loading = false,
  slides = [],
  copy = {},
  onImageError,
  onPreloadSlide,
}) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const Arrow = isRtl ? ArrowLeft : ArrowRight;

  useEffect(() => {
    setIndex(0);
  }, [slides.length]);

  useEffect(() => {
    if (slides.length < 2 || paused) return undefined;
    if (typeof window === "undefined") return undefined;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) return undefined;
    const next = (index + 1) % slides.length;
    onPreloadSlide?.(slides[next]);
    const timer = window.setTimeout(() => setIndex(next), HERO_ROTATE_MS);
    return () => window.clearTimeout(timer);
  }, [index, onPreloadSlide, paused, slides]);

  const slide = slides[index] || null;

  return (
    <section className="m1h-block--tight" style={{ paddingBottom: 0 }}>
      <div className="m1h-shell">
        <div className="grid items-center gap-6 lg:grid-cols-2 lg:gap-16">
          <div className="order-2 lg:order-1">
            <p className="m1h-hero__eyebrow">{copy.eyebrow}</p>
            <h1 className="m1h-hero__title">{copy.title}</h1>
            {copy.subtitle ? <p className="m1h-hero__sub">{copy.subtitle}</p> : null}
            <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3">
              <Link to={copy.primaryHref} className="m1h-btn m1h-btn--primary">
                {copy.primaryLabel}
                <Arrow size={16} strokeWidth={2.2} />
              </Link>
              {copy.secondaryHref ? (
                <Link to={copy.secondaryHref} className="m1h-sec__link" style={{ fontSize: "var(--m1h-t-base)" }}>
                  {copy.secondaryLabel}
                </Link>
              ) : null}
            </div>
            {slides.length > 1 ? (
              <div className="m1h-hero__bars" role="tablist" aria-label={copy.slidesLabel}>
                {slides.map((item, itemIndex) => (
                  <button
                    key={item.key || itemIndex}
                    type="button"
                    role="tab"
                    aria-selected={itemIndex === index}
                    aria-label={item.name || ""}
                    className={`m1h-hero__bar${itemIndex === index ? " is-on" : ""}`}
                    onClick={() => {
                      setPaused(true);
                      setIndex(itemIndex);
                    }}
                  />
                ))}
              </div>
            ) : null}
          </div>

          <div className="order-1 lg:order-2">
            {loading && !slide ? (
              <div className="m1h-skel" style={{ aspectRatio: "1 / 1", borderRadius: "var(--m1h-r-xl)" }} />
            ) : slide ? (
              <Link
                to={slide.href}
                className="m1h-hero__stage"
                onMouseEnter={() => setPaused(true)}
                onFocus={() => setPaused(true)}
              >
                {slide.image ? (
                  /* Deliberately not keyed on the image: reusing the element lets
                     the browser keep painting the previous shot until the next one
                     has decoded, so a slide change never flashes an empty plate. */
                  <img
                    src={slide.image}
                    {...slide.imageProps}
                    alt={slide.name}
                    className="m1h-hero__img"
                    onError={onImageError}
                    loading="eager"
                    fetchPriority="high"
                    decoding="async"
                    width="900"
                    height="900"
                  />
                ) : null}
                <span className="m1h-hero__caption">
                  <span className="m1h-hero__caption-name">{slide.name}</span>
                  {slide.priceText ? <span className="m1h-hero__caption-price">{slide.priceText}</span> : null}
                </span>
              </Link>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ==========================================================================
   Editorial promotional block
   ========================================================================== */

export function HomeEditorial({ eyebrow, title, text, ctaLabel, href, image, imageProps, isRtl, onImageError }) {
  const Arrow = isRtl ? ArrowLeft : ArrowRight;
  return (
    <section className="m1h-block m1h-reveal">
      <div className="m1h-shell">
        <div className="m1h-editorial">
          <div className="m1h-editorial__media">
            {image ? (
              <img src={image} {...imageProps} alt="" onError={onImageError} loading="lazy" decoding="async" width="720" height="540" />
            ) : null}
          </div>
          <div className="m1h-editorial__body">
            <p className="m1h-editorial__eyebrow">{eyebrow}</p>
            <h2 className="m1h-editorial__title">{title}</h2>
            {text ? <p className="m1h-editorial__text">{text}</p> : null}
            <div className="m1h-editorial__cta">
              <Link to={href} className="m1h-btn m1h-btn--onDark">
                {ctaLabel}
                <Arrow size={16} strokeWidth={2.2} />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ==========================================================================
   Trust / store benefits
   ========================================================================== */

export function HomeTrustStrip({ isRtl = true }) {
  const items = useMemo(
    () => [
      {
        icon: Truck,
        title: isRtl ? "شحن لكل المحافظات" : "Nationwide delivery",
        text: isRtl ? "من 1 إلى 5 أيام عمل حسب المحافظة." : "1–5 business days depending on the governorate.",
      },
      {
        icon: CreditCard,
        title: isRtl ? "دفع عند الاستلام" : "Cash on delivery",
        text: isRtl ? "وكمان فودافون كاش وإنستا باي." : "Vodafone Cash and InstaPay also accepted.",
      },
      {
        icon: RefreshCcw,
        title: isRtl ? "استبدال خلال 14 يوم" : "14-day exchange",
        text: isRtl ? "بشرط أن يكون المنتج بحالته الأصلية." : "While the item stays in its original condition.",
      },
      {
        icon: Headphones,
        title: isRtl ? "خدمة العملاء" : "Customer service",
        text: isRtl ? "كل يوم من 12 ظهرًا حتى 12 مساءً." : "Every day, 12 PM – 12 AM.",
      },
    ],
    [isRtl]
  );

  return (
    <section className="m1h-block m1h-reveal">
      <div className="m1h-shell">
        <div className="m1h-trust">
          {items.map(({ icon: Icon, title, text }) => (
            <div key={title} className="m1h-trust__item">
              <Icon className="m1h-trust__icon" size={20} strokeWidth={1.6} />
              <p className="m1h-trust__title">{title}</p>
              <p className="m1h-trust__text">{text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
