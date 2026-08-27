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
    root.querySelectorAll(".m1h-reveal:not(.is-in)").forEach((element) => observer.observe(element));
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
};
