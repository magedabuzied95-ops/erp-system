import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";
import {
  EmptyState,
  LazyProductDetailsVariantSheet,
  LazyStorefrontProductGallery,
  MobileBuyBar,
  ProductSkeleton,
  ProductGalleryFallback,
  RecentProductsSection,
  RelatedProducts,
  cleanDisplayText,
  displayComparePrice,
  displayImageForProduct,
  displaySellingPrice,
  fallbackProductImage,
  firstDisplayVariant,
  firstVariantImage,
  getSessionId,
  imageFor,
  isMirrorProduct,
  mirrorProductTitle,
  money,
  productFromDetailsResponse,
  productToSocialMeta,
  resolveStorefrontPrice,
  sfText,
  storefrontApi,
  variantColorKey,
  variantColorName,
  variantHasStock,
  variantImage,
  variantImages,
} from "../Storefront";
import { api } from "../../shared/api/api";
import { applyProductSocialMeta } from "../../shared/lib/socialMeta";
import { Heart, Share2, ShoppingCart } from "lucide-react";

export function StorefrontProductDetailPage({ onAddToCart, toggleWishlist, wishlist, rememberProduct, recent, profile }) {
  const { identifier } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const productQueryKey = searchParams.toString();
  const profilePhone = profile?.primary_phone || profile?.phone || "";
  const [state, setState] = useState({ loading: true, product: null, error: "" });
  const [selected, setSelected] = useState({ variantId: "", size: "", colorKey: "", colorName: "", image: "" });
  const [qty, setQty] = useState(1);
  const [showMobileBuyBar, setShowMobileBuyBar] = useState(false);
  const [variantSheetAction, setVariantSheetAction] = useState("");
  const [touchedOptions, setTouchedOptions] = useState({ color: false, size: false });
  const mainCtaRef = useRef(null);
  const recentlyViewedSentRef = useRef("");

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const routeValue = String(identifier || "");
    const decodedRouteValue = (() => {
      try {
        return decodeURIComponent(routeValue);
      } catch {
        return routeValue;
      }
    })();
    const unresolvedSearchUrl = `/shop/products?q=${encodeURIComponent(decodedRouteValue.replace(/-/g, " "))}`;
    if (import.meta.env.DEV) console.log("[storefront-product] useParams identifier", { identifier: routeValue });
    try {
      sessionStorage.removeItem(`storefront.product.${routeValue}`);
      localStorage.removeItem(`storefront.product.${routeValue}`);
    } catch {
      // Storage can be unavailable in restricted browser contexts.
    }
    storefrontApi.getProductDetails(routeValue, { signal: controller.signal }).then((data) => {
      const product = productFromDetailsResponse(data);
      if (import.meta.env.DEV) console.log("[storefront-product] resolver response", {
        routeIdentifier: routeValue,
        resolverStatus: data?.success === true ? "resolved" : "unresolved",
        resolvable: data?.resolvable,
        productIdLoaded: product?.id || null,
        notFoundReason: product ? "" : data?.message || "empty_product_payload",
      });
      if (import.meta.env.DEV) console.log("[storefront-product] final product object", product);
      if (!product) {
        if (!cancelled) {
          console.warn("[storefront-product] redirecting unresolved product", {
            routeIdentifier: routeValue,
            resolverStatus: data?.success === true ? "resolved_without_product" : "not_found",
            notFoundReason: data?.message || "empty_product_payload",
            redirectTo: unresolvedSearchUrl,
          });
          navigate(unresolvedSearchUrl, { replace: true });
        }
        return;
      }
      const productVariants = Array.isArray(product?.variants) ? product.variants : [];
      const routeSearchParams = new URLSearchParams(productQueryKey);
      const requestedVariantId = routeSearchParams.get("variant") || routeSearchParams.get("variantId") || "";
      const requestedSize = routeSearchParams.get("size") || "";
      const requestedColor = routeSearchParams.get("color") || "";
      const requestedColorId = routeSearchParams.get("colorId") || "";
      const requestedColorKey = String(requestedColor || "").trim().toLowerCase();
      const requested = productVariants.find((variant) => requestedVariantId && String(variant.id) === String(requestedVariantId) && variantHasStock(variant))
        || productVariants.find((variant) => requestedVariantId && String(variant.edition_slug || "") === String(requestedVariantId) && variantHasStock(variant))
        || productVariants.find((variant) => requestedColorId && String(variant.color_id || "") === String(requestedColorId) && variantHasStock(variant))
        || productVariants.find((variant) => requestedSize && String(variant.size) === requestedSize && (!requestedColor || variantColorKey(variant) === requestedColorKey || variantColorName(variant).toLowerCase() === requestedColorKey) && variantHasStock(variant))
        || productVariants.find((variant) => requestedColorId && String(variant.color_id || "") === String(requestedColorId))
        || productVariants.find((variant) => requestedSize && String(variant.size) === requestedSize && variantHasStock(variant));
      const first = requested || firstDisplayVariant(productVariants);
      if (!cancelled) {
        setState({ loading: false, product, error: "" });
        setSelected({
          variantId: first?.id || "",
          size: first?.size || "",
          colorKey: first ? variantColorKey(first) : "",
          colorName: first ? variantColorName(first) : "",
          image: variantImage(first) || displayImageForProduct(product, first) || "",
        });
        setTouchedOptions({ color: false, size: false });
        try {
          rememberProduct(product);
          const phone = profilePhone;
          const recentlyViewedKey = `${product.id}:${phone || getSessionId()}`;
          if (recentlyViewedSentRef.current !== recentlyViewedKey) {
            recentlyViewedSentRef.current = recentlyViewedKey;
            api.post("/storefront/recently-viewed", { product_id: product.id, session_id: getSessionId(), phone }).catch(() => undefined);
          }
        } catch (sideEffectError) {
          console.warn("[storefront-product] post-load side effect skipped", sideEffectError);
        }
      }
    }).catch((error) => {
      if (!cancelled && error?.cause?.name !== "AbortError") {
        console.warn("[storefront-product] resolver failed", {
          routeIdentifier: routeValue,
          resolverUrl: error?.url || "",
          resolverStatus: error?.status || "network_error",
          productIdLoaded: null,
          notFoundReason: error?.responseBody?.message || error.message || "resolver_failed",
          redirectTo: unresolvedSearchUrl,
        });
        if (error?.status === 404) {
          navigate(unresolvedSearchUrl, { replace: true });
          return;
        }
        setState({ loading: false, product: null, error: error.message });
      }
    });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [identifier, navigate, productQueryKey, profilePhone, rememberProduct]);

  const product = state.product;
  const variants = useMemo(() => product?.variants || [], [product]);
  const colorGroups = useMemo(() => {
    const groups = new Map();
    variants.forEach((item) => {
      const color = variantColorName(item);
      const key = variantColorKey(item);
      if (!groups.has(key)) {
        groups.set(key, { key, color, colorName: color, image_url: variantImage(item), images: [], variants: [] });
      }
      const group = groups.get(key);
      const images = Array.isArray(item.images) ? item.images : Array.isArray(item.color_images) ? item.color_images : [];
      const sourceImages = images.length
        ? images
        : variantImage(item)
          ? [{ image_url: variantImage(item), preview: variantImage(item), is_primary: true }]
          : [];
      group.images = [...group.images, ...sourceImages].reduce((acc, image) => {
        const keyImage = String(image?.image_url || image?.preview || "");
        if (!keyImage || acc.some((entry) => String(entry?.image_url || entry?.preview || "") === keyImage)) return acc;
        acc.push(image);
        return acc;
      }, []);
      if (!group.image_url) {
        group.image_url = variantImage(item);
      }
      group.variants.push(item);
    });
    return Array.from(groups.values()).map((group) => ({
      ...group,
      primaryImage: group.images.find((image) => image?.is_primary) || group.images[0] || null,
    }));
  }, [variants]);
  const selectedVariant = variants.find((item) => String(item.id) === String(selected.variantId));
  const selectedColorKey = selected.colorKey || (selectedVariant ? variantColorKey(selectedVariant) : "");
  const selectedColorGroup = colorGroups.find((group) => String(group.key || "") === String(selectedColorKey)) || colorGroups[0] || null;
  const variantGroup = selectedColorKey ? variants.filter((item) => variantColorKey(item) === selectedColorKey) : variants;
  const sizes = [...new Set(variantGroup.map((variant) => variant.size).filter(Boolean))];
  const colors = colorGroups;
  const activeVariant = variants.find((item) => String(item.id) === String(selected.variantId))
    || variants.find((item) => item.size === selected.size && (!selectedColorKey || variantColorKey(item) === selectedColorKey) && variantHasStock(item))
    || firstDisplayVariant(variants);
  const colorGalleryImages = (selectedColorGroup?.images || []).filter(Boolean);
  const thumbnailVariants = [...new Map(
    variants
      .filter((item) => variantImage(item))
      .sort((a, b) => Number(variantHasStock(b)) - Number(variantHasStock(a)))
      .map((item) => [`${variantImage(item)}:${item.color || ""}`, item])
  ).values()];
  const fallbackGalleryImages = !thumbnailVariants.length && product?.image_url ? [product.image_url] : [];
  const mainImage = selected.image || variantImage(activeVariant) || selectedColorGroup?.primaryImage?.image_url || selectedColorGroup?.primaryImage?.preview || firstVariantImage(variants) || product?.image_url || "";
  const galleryItems = [
    ...colorGalleryImages.map((image) => ({
      image: imageFor(image?.image_url || image?.preview || ""),
      variant: selectedColorGroup?.variants?.find((item) => variantImages(item).includes(String(image?.image_url || image?.preview || ""))) || null,
    })),
    ...thumbnailVariants.flatMap((item) => variantImages(item).map((image) => ({ image, variant: item }))),
    ...fallbackGalleryImages.map((image) => ({ image, variant: null })),
  ].filter((item) => item.image).reduce((acc, item) => (acc.some((entry) => entry.image === item.image) ? acc : [...acc, item]), []);
  const mirrorProduct = product ? isMirrorProduct(product) : false;
  const displayTitle = cleanDisplayText(product ? mirrorProductTitle(product, activeVariant) || product.name : "");
  const selectedPrice = resolveStorefrontPrice(product, activeVariant);
  const selectedSellingPrice = selectedPrice.activePrice || displaySellingPrice(product, activeVariant);
  const selectedComparePrice = selectedPrice.comparePrice || displayComparePrice(product, activeVariant);
  const selectedDiscountPercent = selectedComparePrice > selectedSellingPrice ? Math.max(1, Math.round(((selectedComparePrice - selectedSellingPrice) / selectedComparePrice) * 100)) : 0;
  const descriptionText = cleanDisplayText(product?.seo_description || product?.description_ar || product?.description_en || product?.description)
    || "تصميم عملي بخامة Premium مناسب للخروج اليومي وسهل التنسيق مع ستايلات مختلفة.";
  const inWishlist = product && wishlist.some((item) => String(item.id) === String(product.id));

  useEffect(() => {
    if (!product) return;
    document.title = mirrorProduct ? displayTitle : cleanDisplayText(product.name) || document.title;
    applyProductSocialMeta(productToSocialMeta(product));
  }, [product, mirrorProduct, displayTitle]);
  useEffect(() => {
    const node = mainCtaRef.current;
    if (!node || typeof window === "undefined") return undefined;
    if (!("IntersectionObserver" in window)) {
      let cancelled = false;
      setTimeout(() => {
        if (!cancelled) setShowMobileBuyBar(false);
      }, 0);
      return () => {
        cancelled = true;
      };
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        setShowMobileBuyBar(!entry.isIntersecting);
      },
      {
        threshold: 0.2,
        rootMargin: "0px 0px -112px 0px",
      }
    );

    observer.observe(node);
    return () => {
      observer.disconnect();
      setShowMobileBuyBar(false);
    };
  }, [product?.id]);
  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    document.documentElement.style.setProperty("--product-sticky-actions-height", showMobileBuyBar ? "74px" : "0px");
    return () => {
      document.documentElement.style.setProperty("--product-sticky-actions-height", "0px");
    };
  }, [showMobileBuyBar]);
  const selectVariant = (candidate, options = {}) => {
    if (!candidate) return;
    const candidateColorKey = variantColorKey(candidate);
    let nextVariant = candidate;
    if (options.preserveSize && selected.size) {
      const sameSize = variants.find((item) => variantColorKey(item) === candidateColorKey && String(item.size || "") === String(selected.size) && variantHasStock(item))
        || variants.find((item) => variantColorKey(item) === candidateColorKey && String(item.size || "") === String(selected.size));
      if (sameSize) nextVariant = sameSize;
    }
    const nextColorGroup = colorGroups.find((group) => group.key === candidateColorKey) || null;
    const nextImage = options.image || variantImage(nextVariant) || nextColorGroup?.primaryImage?.image_url || nextColorGroup?.primaryImage?.preview || displayImageForProduct(product, nextVariant) || "";
    setQty(1);
    setSelected({
      variantId: nextVariant.id || "",
      size: nextVariant.size || "",
      colorKey: variantColorKey(nextVariant),
      colorName: variantColorName(nextVariant),
      image: nextImage,
    });
  };
  const selectColor = (group) => {
    const colorKey = group?.key || "";
    const candidates = variants.filter((item) => variantColorKey(item) === colorKey);
    const candidate = candidates.find((item) => item.size === selected.size && variantHasStock(item))
      || candidates.find(variantHasStock)
      || candidates[0];
    if (!candidate) return;
    setTouchedOptions((prev) => ({ ...prev, color: true }));
    selectVariant(candidate, { preserveSize: true, image: variantImage(candidate) || group?.primaryImage?.image_url || group?.primaryImage?.preview || "" });
  };
  const selectSize = (size) => {
    const candidates = variants.filter((item) => String(item.size || "") === String(size) && (!selectedColorKey || variantColorKey(item) === selectedColorKey));
    const candidate = candidates.find(variantHasStock) || candidates[0];
    setTouchedOptions((prev) => ({ ...prev, size: true }));
    selectVariant(candidate);
  };
  const selectGalleryImage = (item) => {
    if (item?.variant) {
      selectVariant(item.variant, { image: item.image });
      return;
    }
    setSelected((prev) => ({ ...prev, image: item?.image || "" }));
  };
  const submitVariant = (candidate = activeVariant, quantity = qty, action = "cart") => {
    if (!product || !candidate || Number(candidate.stock || 0) <= 0) return;
    const result = onAddToCart(product, candidate, quantity, action === "buy" ? { intent: "buy" } : undefined);
    if (result === "capture_required") return;
    setVariantSheetAction("");
    if (action === "buy") navigate("/shop/checkout");
  };
  const buyNow = () => {
    submitVariant(activeVariant, qty, "buy");
  };
  const hasMultipleVariantOptions = colors.length > 1 || sizes.length > 1 || variants.length > 1;
  const colorSelectionReady = colors.length <= 1 || touchedOptions.color;
  const sizeSelectionReady = sizes.length <= 1 || touchedOptions.size;
  const canSubmitDirectly = !hasMultipleVariantOptions || (colorSelectionReady && sizeSelectionReady);
  const requestMobilePurchase = (action) => {
    if (!product || !activeVariant || Number(activeVariant.stock || 0) <= 0) return;
    if (hasMultipleVariantOptions && !canSubmitDirectly) {
      setVariantSheetAction(action);
      return;
    }
    submitVariant(activeVariant, qty, action);
  };
  const addFromStickyBar = () => {
    requestMobilePurchase("cart");
    setShowMobileBuyBar(false);
  };
  const buyFromStickyBar = () => {
    requestMobilePurchase("buy");
  };
  const shareProduct = async () => {
    const url = typeof window !== "undefined" ? window.location.href : "";
    try {
      if (navigator.share) {
        await navigator.share({ title: displayTitle, text: descriptionText, url });
        return;
      }
      await navigator.clipboard?.writeText(url);
      toast.success(sfText("storefront.toasts.productLinkCopied", "Product link copied."));
    } catch {
      // User cancelled native share.
    }
  };

  if (state.loading) return <section className="mx-auto max-w-7xl px-4 py-6"><ProductSkeleton count={2} /></section>;
  if (!product) return <EmptyState title={sfText("storefront.products.notFoundTitle", "Product not found")} text={sfText("storefront.products.notFoundText", "Go back to products and try another choice")} />;

  return (
    <section dir="rtl" className="sf-product-details-page mx-auto grid max-w-7xl gap-2 px-3 pb-28 pt-1 md:gap-5 md:px-4 md:pb-36 md:pt-5 lg:grid-cols-[minmax(0,55fr)_minmax(360px,45fr)] lg:items-start lg:pb-8">
      <Suspense fallback={<ProductGalleryFallback />}>
        <LazyStorefrontProductGallery
          mainImage={mainImage}
          displayTitle={displayTitle}
          galleryItems={galleryItems}
          selectedImage={selected.image}
          onSelectImage={selectGalleryImage}
          imageFor={imageFor}
          fallbackProductImage={fallbackProductImage}
        />
      </Suspense>
      <div className="sf-product-info-sticky min-w-0 lg:sticky lg:self-start">
        <div className="overflow-hidden rounded-[1rem] border border-white/[0.08] bg-[linear-gradient(180deg,#07111f_0%,#050b16_100%)] p-3.5 text-white shadow-[0_24px_70px_rgba(0,0,0,0.35)] md:rounded-[1.45rem] md:p-6">
          <div className="mb-2 flex items-start justify-between gap-3 md:mb-4">
            <div className="min-w-0">
              <div className="mt-1.5 hidden text-[11px] font-black text-[#c4b5fd] md:mt-3 md:block md:text-xs">{sfText("storefront.products.curatedDetails", "Carefully selected product details")}</div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button type="button" onClick={() => toggleWishlist(product)} className="grid h-10 w-10 place-items-center rounded-full border border-white/10 bg-white/[0.06] text-white/75 transition hover:border-white/20 hover:bg-white/[0.1] hover:text-white" aria-label={sfText("storefront.wishlist.toggleWishlist", "Toggle wishlist")}>
                <Heart className={`h-4 w-4 ${inWishlist ? "fill-current text-rose-400" : ""}`} />
              </button>
              <button type="button" onClick={shareProduct} className="grid h-10 w-10 place-items-center rounded-full border border-white/10 bg-white/[0.06] text-white/75 transition hover:border-white/20 hover:bg-white/[0.1] hover:text-white" aria-label={sfText("storefront.share.shareProduct", "Share product")}>
                <Share2 className="h-4 w-4" />
              </button>
            </div>
          </div>
          <div className="text-[11px] font-black uppercase tracking-[0.18em] text-[#d8b4fe]">{sfText("storefront.products.selectedProduct", "Selected product")}</div>
          <h1 className="mt-1 line-clamp-2 text-[1.75rem] font-black leading-[1.08] md:text-4xl">{displayTitle}</h1>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <div className="text-2xl font-black text-white md:text-4xl">{money(selectedSellingPrice)}</div>
            {selectedComparePrice > selectedSellingPrice ? <span className="rounded-full border border-white/10 bg-white/[0.06] px-3 py-1 text-sm font-black text-white/65 line-through">{money(selectedComparePrice)}</span> : null}
            {selectedDiscountPercent ? <span className="rounded-full bg-emerald-400/15 px-3 py-1 text-sm font-black text-emerald-200">{sfText("storefront.products.discountPercent", "-{{percent}}%", { percent: selectedDiscountPercent })}</span> : null}
            {activeVariant && Number(activeVariant.stock || 0) > 0 && Number(activeVariant.stock || 0) <= 3 ? (
              <span className="rounded-full bg-amber-400/15 px-3 py-1 text-sm font-black text-amber-100">
                {sfText("storefront.products.onlyLeft", "Only {{count}} left", { count: activeVariant.stock })}
              </span>
            ) : null}
          </div>
        </div>

        {colors.length > 1 ? (
          <div className="mt-4 rounded-[1.1rem] border border-white/[0.08] bg-[#07111f] p-3 text-white md:rounded-[1.45rem] md:p-4">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div>
                <div className="text-[10px] font-black uppercase tracking-[0.18em] text-white/35">{sfText("storefront.products.color", "Color")}</div>
                <h2 className="text-sm font-black">{sfText("storefront.products.chooseColor", "Choose color")}</h2>
              </div>
            </div>
            <div className="sf-scroll flex gap-2 overflow-x-auto pb-1">
              {colors.map((group) => {
                const active = String(group.key) === String(selectedColorKey);
                const hasStock = group.variants.some((item) => variantHasStock(item));
                return (
                  <button
                    key={group.key}
                    type="button"
                    onClick={() => selectColor(group)}
                    disabled={!hasStock}
                    className={`min-h-9 shrink-0 rounded-full border px-3 py-2 text-xs font-black transition ${active ? "border-[#d8b4fe]/70 bg-[#7c3aed] text-white shadow-[0_12px_28px_rgba(124,58,237,0.32)]" : "border-white/10 bg-white/6 text-white/70"} disabled:cursor-not-allowed disabled:opacity-35`}
                  >
                    {group.colorName || group.color}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        <div className="mt-4 rounded-[1.1rem] border border-white/[0.08] bg-[#07111f] p-3 text-white md:rounded-[1.45rem] md:p-4">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.18em] text-white/35">{sfText("storefront.products.size", "Size")}</div>
              <h2 className="text-sm font-black">{sfText("storefront.products.chooseSize", "Choose size")}</h2>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {sizes.map((size) => {
              const hasStock = Array.isArray(selectedColorGroup?.variants) && selectedColorGroup.variants.some((item) => String(item.size || "") === String(size) && variantHasStock(item));
              const active = String(selected.size) === String(size);
              return (
                <button
                  key={size}
                  type="button"
                  onClick={() => selectSize(size)}
                  disabled={!hasStock}
                  className={`relative min-w-11 overflow-hidden rounded-full border px-3 py-1.5 text-xs font-black transition ${active ? "border-white bg-white text-stone-950" : hasStock ? "border-white/10 bg-white/6 text-white/75" : "cursor-not-allowed border-white/[0.07] bg-white/[0.035] text-white/25 opacity-60"}`}
                >
                  {!hasStock ? <span className="pointer-events-none absolute left-1/2 top-1/2 h-px w-[120%] -translate-x-1/2 -translate-y-1/2 rotate-[-18deg] bg-white/35" /> : null}
                  <span className="relative z-10">{size || sfText("storefront.products.oneSize", "One size")}</span>
                </button>
              );
            })}
          </div>
        </div>

        {activeVariant && Number(activeVariant.stock || 0) > 0 && Number(activeVariant.stock || 0) <= 3 ? (
          <div className="mt-3 inline-flex rounded-full border border-amber-300/20 bg-amber-400/10 px-3 py-1.5 text-xs font-black text-amber-100">
            {sfText("storefront.products.onlyLeft", "Only {{count}} left", { count: activeVariant.stock })}
          </div>
        ) : null}

        <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.045] p-2">
          <button type="button" onClick={() => setQty((current) => Math.max(1, current - 1))} className="grid h-10 w-10 place-items-center rounded-full bg-white/8 text-lg font-black">-</button>
          <div className="text-center">
            <div className="text-[10px] font-black uppercase tracking-[0.16em] text-white/35">{sfText("storefront.cart.quantity", "Quantity")}</div>
            <div className="text-lg font-black">{qty}</div>
          </div>
          <button type="button" onClick={() => setQty((current) => Math.min(Number(activeVariant?.stock || 1), current + 1))} className="grid h-10 w-10 place-items-center rounded-full bg-white/8 text-lg font-black">+</button>
        </div>

        <button
          ref={mainCtaRef}
          type="button"
          onClick={() => activeVariant && onAddToCart(product, activeVariant, qty)}
          disabled={!activeVariant || !variantHasStock(activeVariant)}
          className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-white text-sm font-black text-stone-950 shadow-[0_14px_34px_rgba(255,255,255,0.16)] disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/35"
        >
          <ShoppingCart className="h-4 w-4" />
          {sfText("storefront.cart.addToCart", "Add to cart")}
        </button>
      </div>
      <Suspense fallback={<div className="h-40 animate-pulse rounded-[1.5rem] bg-white/50" />}>
        <LazyProductDetailsVariantSheet
          product={product}
          variant={activeVariant}
          colors={colors}
          sizes={sizes}
          selectedColorKey={selectedColorKey}
          selectedSize={selected.size}
          quantity={qty}
          action={variantSheetAction || "cart"}
          onClose={() => setVariantSheetAction("")}
          onColorSelect={selectColor}
          onSizeSelect={selectSize}
          onQuantityChange={setQty}
          onSubmit={(candidate, quantity, action) => {
            if (!candidate || !variantHasStock(candidate)) return;
            const result = onAddToCart(product, candidate, quantity, action === "buy" ? { intent: "buy" } : undefined);
            if (result === "capture_required") return;
            setVariantSheetAction("");
            if (action === "buy") navigate("/shop/checkout");
          }}
        />
      </Suspense>

      <div className="hidden md:block">
        <RelatedProducts currentId={product.id} wishlist={wishlist} toggleWishlist={toggleWishlist} onAddToCart={onAddToCart} />
        <RecentProductsSection currentId={product.id} recent={recent} />
      </div>

      <MobileBuyBar product={product} variant={activeVariant} visible={showMobileBuyBar} onAddToCart={addFromStickyBar} buyNow={buyFromStickyBar} />
    </section>
  );
}
