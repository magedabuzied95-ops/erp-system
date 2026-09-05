/**
 * Homepage view-model helpers.
 *
 * Kept out of HomeSections.jsx so that file exports components only -- a mixed
 * module breaks React Fast Refresh for every component inside it.
 */

import { useEffect } from "react";

import { splitProductDisplayName } from "../lib/productDisplayName";

/**
 * Turns a catalogue product into everything a homepage card needs to paint.
 * Every formatter is injected, so this module stays free of routing, currency
 * and image-resolution concerns -- those live in Storefront.jsx and are passed
 * in once per render as `ctx`.
 *
 * @param {object} product
 * @param {object} ctx
 * @param {(value: string) => string} ctx.imageFor                 resolve an image path to a URL
 * @param {(value: string, preset: string) => object} ctx.responsiveImageProps
 * @param {(value: number) => string} ctx.money                    currency formatter
 * @param {(product: object) => string} ctx.productUrl             product detail href
 * @param {(product: object) => {price:number, comparePrice:number, image:string}} ctx.pricing
 * @param {string[]} ctx.knownBrands
 * @param {(product: object) => string} [ctx.fallbackEyebrow]      used when no brand is detected
 * @param {(product: object) => boolean} [ctx.isLastPiece]
 * @param {string} [ctx.lastPieceLabel]                            omit to suppress the badge
 * @returns {object} card view model
 */
export const buildHomeProductCard = (product = {}, ctx = {}) => {
  const {
    imageFor = (value) => value,
    responsiveImageProps = () => ({}),
    money = (value) => String(value),
    productUrl = () => "/products",
    pricing = () => ({ price: 0, comparePrice: 0, image: "" }),
    knownBrands = [],
    fallbackEyebrow = () => "",
    isLastPiece = () => false,
    lastPieceLabel = "",
    imagePreset = "grid",
  } = ctx;

  const slide = pricing(product) || {};
  const price = Number(slide.price || 0) || 0;
  const comparePrice = Number(slide.comparePrice || 0) || 0;
  const hasDiscount = price > 0 && comparePrice > price;
  const rawImage = slide.image || product.image_url || product.product_image_url || "";
  const { brand, title } = splitProductDisplayName(product, { knownBrands });

  return {
    key: product.card_id || product.id || title,
    product,
    href: productUrl(product),
    image: rawImage ? imageFor(rawImage) : "",
    imageProps: rawImage ? responsiveImageProps(rawImage, imagePreset) : {},
    eyebrow: brand || fallbackEyebrow(product) || "",
    title,
    priceText: price > 0 ? money(price) : "",
    compareText: hasDiscount ? money(comparePrice) : "",
    // One indicator per card. A discount always outranks a stock warning, so the
    // two can never stack into "SALE • -25% • Last pair" on the same tile.
    discount: hasDiscount ? Math.max(1, Math.round(((comparePrice - price) / comparePrice) * 100)) : 0,
    lastPiece: !hasDiscount && Boolean(lastPieceLabel) && Boolean(isLastPiece(product)),
    lastPieceLabel,
    alt: title || product.name || "",
  };
};

/**
 * One IntersectionObserver for the whole homepage. Skipped entirely under
 * reduced motion or Save-Data: the `m1h-motion` class is never added, and every
 * `.m1h-reveal` then paints at full opacity from the first frame.
 */
export const useHomeReveal = (rootRef, deps = []) => {
  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof window === "undefined") return undefined;
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    const saveData = Boolean(window.navigator?.connection?.saveData);
    if (reduceMotion || saveData || typeof IntersectionObserver === "undefined") {
      root.classList.remove("m1h-motion");
      return undefined;
    }

    root.classList.add("m1h-motion");
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-in");
          observer.unobserve(entry.target);
        });
      },
      { threshold: 0.05, rootMargin: "0px 0px -6% 0px" }
    );
    // The guaranteed path. This animation hides content until something says
    // "you are on screen", so every way that signal can fail to arrive is a way
    // for a whole section to occupy its full height and paint nothing — which is
    // exactly how the offers block shipped as ~900px of blank page. Measured on
    // the live site: a freshly created IntersectionObserver on an element sitting
    // at top:-27 in an 812px viewport produced no callback at all.
    //
    // So the observer is the fast path and this is the correctness path: any
    // reveal whose box is inside the viewport gets shown, checked on scroll and
    // resize and coalesced into a frame. Cheap — it only ever measures elements
    // that have not been revealed yet, and each one is measured once.
    const reveal = (element) => {
      element.classList.add("is-in");
      observer.unobserve(element);
    };
    const sweep = () => {
      const pending = root.querySelectorAll(".m1h-reveal:not(.is-in)");
      pending.forEach((element) => {
        const box = element.getBoundingClientRect();
        if (box.bottom > 0 && box.top < window.innerHeight) reveal(element);
        else observer.observe(element);
      });
    };

    let scheduled = 0;
    const schedule = () => {
      if (scheduled) return;
      scheduled = window.requestAnimationFrame(() => {
        scheduled = 0;
        sweep();
      });
    };

    sweep();

    // Sections that mount AFTER this effect ran have to be picked up too: the
    // offers block is deferred behind its own observer and then waits on its own
    // request, so it is always late and the initial sweep cannot see it.
    const mutations = new MutationObserver(schedule);
    mutations.observe(root, { childList: true, subtree: true });
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });

    return () => {
      observer.disconnect();
      mutations.disconnect();
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (scheduled) window.cancelAnimationFrame(scheduled);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
};
