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
    .replace(/âœ¨/g, "")
    .replace(/â€¦/g, "...")
    .replace(/طŒ/g, "،")
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

export const productToSocialMeta = (product = {}) => ({
  title: cleanMetaText(product?.social_meta?.title || product?.meta_title || product?.seo_title || product?.name || ""),
  description: cleanMetaText(product?.social_meta?.description || product?.seo_description || product?.description_en || product?.description_ar || product?.description || ""),
  image: product?.social_meta?.image || product?.og_image_url || "",
  url: product?.social_meta?.url || "",
});
