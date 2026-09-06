const setMetaTag = (selector, attributes) => {
  if (typeof document === "undefined") return null;
  let element = document.head.querySelector(selector);
  if (!element) {
    element = document.createElement("meta");
    document.head.appendChild(element);
  }
  Object.entries(attributes).forEach(([key, value]) => {
    element.setAttribute(key, String(value || ""));
  });
  return element;
};

const cleanMetaText = (value = "") =>
  String(value || "")
    .replace(/\uFFFD/g, "")
    .replace(/\u00e2\u0153\u00a8/g, "")
    .replace(/\u00e2\u20ac\u00a6/g, "...")
    .replace(/\u0637\u0152/g, "،")
    .replace(/\s+/g, " ")
    .trim();

export const applyProductSocialMeta = (meta = {}) => {
  if (typeof document === "undefined") return;
  const title = cleanMetaText(meta.title || "");
  const description = cleanMetaText(meta.description || "");
  const image = meta.image || "";
  const url = meta.url || (typeof window !== "undefined" ? window.location.href : "");

  if (title) document.title = title;
  if (description) {
    setMetaTag('meta[name="description"]', { name: "description", content: description });
  }

  setMetaTag('meta[property="og:title"]', { property: "og:title", content: title });
  setMetaTag('meta[property="og:description"]', { property: "og:description", content: description });
  setMetaTag('meta[property="og:image"]', { property: "og:image", content: image });
  setMetaTag('meta[property="og:image:width"]', { property: "og:image:width", content: "1200" });
  setMetaTag('meta[property="og:image:height"]', { property: "og:image:height", content: "630" });
  setMetaTag('meta[property="og:url"]', { property: "og:url", content: url });
  setMetaTag('meta[property="og:type"]', { property: "og:type", content: "product" });
  setMetaTag('meta[name="twitter:card"]', { name: "twitter:card", content: "summary_large_image" });
  setMetaTag('meta[name="twitter:title"]', { name: "twitter:title", content: title });
  setMetaTag('meta[name="twitter:description"]', { name: "twitter:description", content: description });
  setMetaTag('meta[name="twitter:image"]', { name: "twitter:image", content: image });
};

const setLinkTag = (selector, attributes) => {
  if (typeof document === "undefined") return null;
  let element = document.head.querySelector(selector);
  if (!element) {
    element = document.createElement("link");
    document.head.appendChild(element);
  }
  Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, String(value || "")));
  return element;
};

const setJsonLd = (kind, value) => {
  if (typeof document === "undefined") return;
  const selector = `script[type="application/ld+json"][data-m1-product-seo="${kind}"]`;
  document.head.querySelectorAll(selector).forEach((node, index) => {
    if (index > 0) node.remove();
  });
  let script = document.head.querySelector(selector);
  if (!script) {
    script = document.createElement("script");
    script.type = "application/ld+json";
    script.dataset.m1ProductSeo = kind;
    document.head.appendChild(script);
  }
  script.textContent = JSON.stringify(value).replace(/</g, "\\u003c");
};

export const clearProductSeo = () => {
  if (typeof document === "undefined") return;
  document.head
    .querySelectorAll('script[type="application/ld+json"][data-m1-product-seo]')
    .forEach((node) => node.remove());
};

export const applyProductSeo = (product = {}) => {
  if (typeof document === "undefined") return null;
  if (!productHasCompleteMerchantPolicies(product)) return null;
  const seo = buildProductSeo(product);
  document.title = seo.title;
  setMetaTag('meta[name="description"]', { name: "description", content: seo.description });
  setMetaTag('meta[name="robots"]', { name: "robots", content: seo.robots });
  setLinkTag('link[rel="canonical"]', { rel: "canonical", href: seo.canonical });
  setMetaTag('meta[property="og:type"]', { property: "og:type", content: "product" });
  setMetaTag('meta[property="og:locale"]', { property: "og:locale", content: seo.locale });
  setMetaTag('meta[property="og:title"]', { property: "og:title", content: seo.title });
  setMetaTag('meta[property="og:description"]', { property: "og:description", content: seo.description });
  setMetaTag('meta[property="og:image"]', { property: "og:image", content: seo.image });
  setMetaTag('meta[property="og:image:alt"]', { property: "og:image:alt", content: seo.imageAlt });
  setMetaTag('meta[property="og:url"]', { property: "og:url", content: seo.url });
  setMetaTag('meta[name="twitter:card"]', { name: "twitter:card", content: "summary_large_image" });
  setMetaTag('meta[name="twitter:title"]', { name: "twitter:title", content: seo.title });
  setMetaTag('meta[name="twitter:description"]', { name: "twitter:description", content: seo.description });
  setMetaTag('meta[name="twitter:image"]', { name: "twitter:image", content: seo.image });
  setJsonLd("product", seo.productJsonLd);
  setJsonLd("breadcrumb", seo.breadcrumbJsonLd);
  return seo;
};

export const productToSocialMeta = (product = {}) => ({
  title: cleanMetaText(product?.social_meta?.title || product?.meta_title || product?.seo_title || product?.name || ""),
  description: cleanMetaText(product?.social_meta?.description || product?.seo_description || product?.description_en || product?.description_ar || product?.description || ""),
  image: product?.social_meta?.image || product?.og_image_url || "",
  url: product?.social_meta?.url || "",
});
import { buildProductSeo, productHasCompleteMerchantPolicies } from "./productSeo.js";
