import { productPath, storefrontPathFromLink } from "../../storefront/lib/paths.js";

const PUBLIC_STOREFRONT_ORIGIN = "https://m1store-egy.com";

const isAbsoluteHttpUrl = (value = "") => /^https?:\/\//i.test(String(value || "").trim());

const isShareProductUrl = (value = "") => {
  try {
    const url = new URL(String(value || "").trim());
    return url.pathname.startsWith("/share/product/");
  } catch {
    return String(value || "").trim().startsWith("/share/product/");
  }
};

export const getPublicStorefrontOrigin = () => PUBLIC_STOREFRONT_ORIGIN;

export const publicStorefrontUrl = (path = "/") => {
  const raw = String(path || "").trim();
  if (isShareProductUrl(raw)) return raw;
  if (isAbsoluteHttpUrl(raw)) {
    const url = new URL(raw);
    const normalizedPath = storefrontPathFromLink(`${url.pathname}${url.search}${url.hash}`) || "/";
    return new URL(normalizedPath, PUBLIC_STOREFRONT_ORIGIN).toString();
  }
  const normalizedPath = storefrontPathFromLink(raw || "/") || "/";
  return new URL(normalizedPath, PUBLIC_STOREFRONT_ORIGIN).toString();
};

export const publicProductUrl = (slug = "", query = "") => publicStorefrontUrl(productPath(slug, query));
