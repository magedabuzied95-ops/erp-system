const LEGACY_PREFIX = "/shop";
const SEO_CATEGORY_PATHS = new Set(["/men", "/women", "/kids", "/bags", "/crocs", "/slippers", "/offers", "/men/large-sizes"]);

const ROOT_PATHS = {
  home: "/",
  products: "/products",
  product: "/product",
  account: "/account",
  cart: "/cart",
  checkout: "/checkout",
  track: "/track",
  wishlist: "/wishlist",
  recentlyViewed: "/recently-viewed",
  offers: "/offers",
  sale: "/sale",
  contact: "/contact",
  sizeGuide: "/size-guide",
  returns: "/returns",
  faq: "/faq",
  success: "/success",
  confirm: "/confirm",
};

const normalizePathname = (value = "") => {
  const raw = String(value || "").trim();
  if (!raw) return "/";
  const normalized = raw.startsWith("/") ? raw : `/${raw}`;
  if (normalized.length > 1) return normalized.replace(/\/+$/, "");
  return normalized;
};

const withQuery = (pathname = "/", query = "") => {
  const normalizedPath = normalizePathname(pathname);
  if (!query) return normalizedPath;
  if (typeof query === "string") {
    const cleaned = query.replace(/^\?/, "");
    return `${normalizedPath}${cleaned ? `?${cleaned}` : ""}`;
  }
  const params = new URLSearchParams();
  if (query instanceof URLSearchParams) {
    query.forEach((value, key) => {
      if (value !== undefined && value !== null && String(value).trim() !== "") params.append(key, value);
    });
  } else if (query && typeof query === "object") {
    Object.entries(query).forEach(([key, value]) => {
      if (Array.isArray(value)) {
        value.forEach((entry) => {
          if (entry !== undefined && entry !== null && String(entry).trim() !== "") params.append(key, String(entry));
        });
        return;
      }
      if (value !== undefined && value !== null && String(value).trim() !== "") params.set(key, String(value));
    });
  }
  const serialized = params.toString();
  return `${normalizedPath}${serialized ? `?${serialized}` : ""}`;
};

const storefrontPath = (pathname = ROOT_PATHS.home, query = "") => withQuery(pathname, query);
const productsPath = (query = "") => storefrontPath(ROOT_PATHS.products, query);
const productPath = (slug = "", query = "") =>
  slug ? storefrontPath(`${ROOT_PATHS.product}/${encodeURIComponent(String(slug).trim())}`, query) : productsPath(query);

const mapLegacyPathname = (pathname = "/shop") => {
  const normalized = normalizePathname(pathname);
  if (normalized === LEGACY_PREFIX) return ROOT_PATHS.home;
  if (normalized === `${LEGACY_PREFIX}/products`) return ROOT_PATHS.products;
  if (normalized.startsWith(`${LEGACY_PREFIX}/product/`)) return normalized.replace(`${LEGACY_PREFIX}/product/`, `${ROOT_PATHS.product}/`);
  if (normalized === `${LEGACY_PREFIX}/account`) return ROOT_PATHS.account;
  if (normalized === `${LEGACY_PREFIX}/account/reset-password`) return `${ROOT_PATHS.account}/reset-password`;
  if (normalized === `${LEGACY_PREFIX}/cart`) return ROOT_PATHS.cart;
  if (normalized === `${LEGACY_PREFIX}/checkout`) return ROOT_PATHS.checkout;
  if (normalized === `${LEGACY_PREFIX}/track`) return ROOT_PATHS.track;
  if (normalized === `${LEGACY_PREFIX}/wishlist`) return ROOT_PATHS.wishlist;
  if (normalized === `${LEGACY_PREFIX}/recently-viewed`) return ROOT_PATHS.recentlyViewed;
  if (normalized === `${LEGACY_PREFIX}/offers`) return ROOT_PATHS.offers;
  if (normalized === `${LEGACY_PREFIX}/sale`) return ROOT_PATHS.sale;
  if (normalized === `${LEGACY_PREFIX}/contact`) return ROOT_PATHS.contact;
  if (normalized === `${LEGACY_PREFIX}/size-guide`) return ROOT_PATHS.sizeGuide;
  if (normalized === `${LEGACY_PREFIX}/returns`) return ROOT_PATHS.returns;
  if (normalized === `${LEGACY_PREFIX}/faq`) return ROOT_PATHS.faq;
  if (normalized.startsWith(`${LEGACY_PREFIX}/success/`)) return normalized.replace(`${LEGACY_PREFIX}/success/`, `${ROOT_PATHS.success}/`);
  if (normalized.startsWith(`${LEGACY_PREFIX}/confirm/`)) return normalized.replace(`${LEGACY_PREFIX}/confirm/`, `${ROOT_PATHS.confirm}/`);
  return normalized;
};

const resolveStorefrontPathname = (pathname = "/") => {
  const normalized = normalizePathname(pathname);
  if (!normalized.startsWith(LEGACY_PREFIX)) return normalized;
  return normalizePathname(mapLegacyPathname(normalized));
};

const legacyShopToRootPath = (pathname = "/shop", search = "", hash = "") => {
  const targetPath = mapLegacyPathname(pathname);
  const query = String(search || "").replace(/^\?/, "");
  const suffix = query ? `?${query}` : "";
  const hashValue = String(hash || "");
  return `${targetPath}${suffix}${hashValue}`;
};

const storefrontPathFromLink = (value = "") => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const base = typeof window !== "undefined" ? window.location.origin : "https://storefront.local";
    const url = new URL(raw, base);
    const path = url.pathname.startsWith(LEGACY_PREFIX)
      ? legacyShopToRootPath(url.pathname, url.search, url.hash)
      : `${url.pathname}${url.search}${url.hash}`;
    return path;
  } catch {
    if (!raw.startsWith("/")) return "";
    return raw.startsWith(LEGACY_PREFIX) ? legacyShopToRootPath(raw) : raw;
  }
};

const matchesRootPath = (pathname = "", expected = "") => normalizePathname(pathname) === normalizePathname(expected);
const startsWithRootPath = (pathname = "", expected = "") => normalizePathname(pathname).startsWith(normalizePathname(expected));

const isStorefrontHomePath = (pathname = "") => {
  const normalized = normalizePathname(pathname);
  return normalized === ROOT_PATHS.home || normalized === LEGACY_PREFIX;
};

const isStorefrontProductsPath = (pathname = "") => {
  const normalized = normalizePathname(pathname);
  return normalized === ROOT_PATHS.products || normalized === `${LEGACY_PREFIX}/products` || SEO_CATEGORY_PATHS.has(normalized);
};

const isStorefrontProductPath = (pathname = "") => {
  const normalized = normalizePathname(pathname);
  return normalized.startsWith(`${ROOT_PATHS.product}/`) || normalized.startsWith(`${LEGACY_PREFIX}/product/`);
};

const isStorefrontCheckoutPath = (pathname = "") => {
  const normalized = normalizePathname(pathname);
  return normalized === ROOT_PATHS.checkout || normalized === `${LEGACY_PREFIX}/checkout`;
};

const isStorefrontOfferPath = (pathname = "") => {
  const normalized = normalizePathname(pathname);
  return normalized === ROOT_PATHS.sale || normalized === `${LEGACY_PREFIX}/sale`;
};

const isStorefrontCheckoutFlowPath = (pathname = "") => {
  const normalized = normalizePathname(pathname);
  if (/^\/c\/[^/]+$/.test(normalized)) return true;
  return [
    ROOT_PATHS.checkout,
    `${LEGACY_PREFIX}/checkout`,
  ].includes(normalized) || normalized.startsWith(`${ROOT_PATHS.success}/`) || normalized.startsWith(`${LEGACY_PREFIX}/success/`) || normalized.startsWith(`${ROOT_PATHS.confirm}/`) || normalized.startsWith(`${LEGACY_PREFIX}/confirm/`);
};

const isStorefrontPath = (pathname = "") => {
  const normalized = normalizePathname(pathname);
  if (/^\/c\/[^/]+$/.test(normalized)) return true;
  if (normalized === `${ROOT_PATHS.account}/reset-password` || normalized === `${LEGACY_PREFIX}/account/reset-password`) return true;
  return [
    ROOT_PATHS.home,
    ROOT_PATHS.products,
    ROOT_PATHS.account,
    ROOT_PATHS.cart,
    ROOT_PATHS.checkout,
    ROOT_PATHS.track,
    ROOT_PATHS.wishlist,
    ROOT_PATHS.recentlyViewed,
    ROOT_PATHS.offers,
    ROOT_PATHS.sale,
    ROOT_PATHS.contact,
    ROOT_PATHS.sizeGuide,
    ROOT_PATHS.returns,
    ROOT_PATHS.faq,
    LEGACY_PREFIX,
    `${LEGACY_PREFIX}/products`,
    `${LEGACY_PREFIX}/account`,
    `${LEGACY_PREFIX}/cart`,
    `${LEGACY_PREFIX}/checkout`,
    `${LEGACY_PREFIX}/track`,
    `${LEGACY_PREFIX}/wishlist`,
    `${LEGACY_PREFIX}/recently-viewed`,
    `${LEGACY_PREFIX}/offers`,
    `${LEGACY_PREFIX}/sale`,
    `${LEGACY_PREFIX}/contact`,
    `${LEGACY_PREFIX}/size-guide`,
    `${LEGACY_PREFIX}/returns`,
    `${LEGACY_PREFIX}/faq`,
  ].includes(normalized) || SEO_CATEGORY_PATHS.has(normalized) || isStorefrontProductPath(normalized) || normalized.startsWith(`${ROOT_PATHS.success}/`) || normalized.startsWith(`${LEGACY_PREFIX}/success/`) || normalized.startsWith(`${ROOT_PATHS.confirm}/`) || normalized.startsWith(`${LEGACY_PREFIX}/confirm/`);
};

export {
  LEGACY_PREFIX,
  SEO_CATEGORY_PATHS,
  ROOT_PATHS,
  isStorefrontCheckoutFlowPath,
  isStorefrontCheckoutPath,
  isStorefrontHomePath,
  isStorefrontOfferPath,
  isStorefrontPath,
  isStorefrontProductPath,
  isStorefrontProductsPath,
  legacyShopToRootPath,
  matchesRootPath,
  normalizePathname,
  productPath,
  productsPath,
  resolveStorefrontPathname,
  startsWithRootPath,
  storefrontPath,
  storefrontPathFromLink,
};
