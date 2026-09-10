export const STOREFRONT_ORIGIN = "https://m1store-egy.com";
export const STORE_NAME = "M1 Store";
export const PRODUCT_SEO_LOCALE = "ar_EG";
export const PRODUCT_SEO_LOCALE_ALTERNATE = "en_US";
export const PRODUCT_TITLE_MAX = 70;

const text = (value = "") => String(value ?? "").replace(/\s+/g, " ").trim();
const number = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};
const unique = (values = []) => [...new Set(values.filter(Boolean))];

// Some gallery rows are stored as objects rather than plain urls, and String({})
// put "https://m1store-egy.com/[object Object]" in the image array Google reads.
const mediaUrl = (entry) => {
  if (typeof entry === "string") return text(entry);
  if (!entry || typeof entry !== "object") return "";
  return text(entry.url || entry.image_url || entry.imageUrl || entry.secure_url || entry.src || entry.path);
};

export const productCanonicalUrl = (product = {}) => {
  const slug = text(product.slug || product.canonical_slug || product.id);
  return slug ? `${STOREFRONT_ORIGIN}/product/${encodeURIComponent(slug)}` : STOREFRONT_ORIGIN;
};

export const productHasCompleteMerchantPolicies = (product = {}) => {
  const policies = product.merchant_policies || product.merchantPolicies || {};
  return Array.isArray(policies.shippingDetails)
    && policies.shippingDetails.length > 0
    && Boolean(policies.returnPolicy);
};

const liveVariantPrice = (variant = {}, product = {}) =>
  number(variant.final_price) ||
  number(variant.current_selling_price) ||
  number(variant.selling_price) ||
  number(variant.price) ||
  number(product.final_price) ||
  number(product.current_selling_price) ||
  number(product.selling_price) ||
  number(product.price);

const hasStoreName = (value = "") => new RegExp(`\\b${STORE_NAME.replace(/\s+/g, "\\s*")}\\b`, "i").test(value);

/* The <title> the crawler receives.
 *
 * A merchant-written (or AI-written) meta_title wins; it already carries the
 * search phrase the merchant wants ("كوتشي Nike Air Force 1 رجالي"). The store
 * name is appended once, unless the title is already long enough that the
 * suffix would push it past what Google renders. Without a meta_title the
 * title falls back to name | brand | store, as before. */
export const buildProductSeoTitle = (product = {}) => {
  const name = text(product.name || product.title);
  const brand = text(product.brand_name || product.brand || product.product_brand);
  const metaTitle = text(product.meta_title);
  if (metaTitle) {
    if (hasStoreName(metaTitle)) return metaTitle;
    const withSuffix = `${metaTitle} | ${STORE_NAME}`;
    return withSuffix.length <= PRODUCT_TITLE_MAX ? withSuffix : metaTitle;
  }
  const titleParts = unique([name, brand && !name.toLowerCase().includes(brand.toLowerCase()) ? brand : "", STORE_NAME]);
  return titleParts.join(" | ");
};

export const splitProductKeywords = (value = "") => {
  const source = Array.isArray(value) ? value : String(value ?? "").split(/[,،\n]/);
  return unique(source.map(text)).slice(0, 15);
};

// The ad feeds are per colourway and link with ?color=. Nine products price their colourways
// differently on purpose (Air Force 1 runs 900–1,850 by quality), so a Product schema that quotes
// one product-wide price disagrees with the ad that brought the crawler there. When the link names
// a colour this product has, the offer speaks for that colour: its price, its stock, its photo.
// An unknown colour is ignored rather than trusted, and the canonical stays the bare product url.
const variantsForColor = (variants = [], color = "") => {
  const wanted = text(color).toLowerCase();
  if (!wanted) return null;
  const matching = variants.filter((variant) => text(variant.color || variant.color_name).toLowerCase() === wanted);
  return matching.length ? matching : null;
};

export const buildProductSeo = (product = {}, { color = "" } = {}) => {
  const name = text(product.name || product.title);
  const brand = text(product.brand_name || product.brand || product.product_brand);
  const category = text(product.category || product.category_name || product.product_type);
  const description = text(
    product.seo_description ||
    product.description_ar ||
    product.description_en ||
    product.description ||
    `${name}${brand ? ` من ${brand}` : ""} متوفر لدى ${STORE_NAME}.`
  );
  const title = buildProductSeoTitle(product);
  const url = productCanonicalUrl(product);
  const allVariants = (Array.isArray(product.variants) ? product.variants : []).filter(Boolean);
  const colorVariants = variantsForColor(allVariants, color);
  const selectedColor = colorVariants ? text(colorVariants[0].color || colorVariants[0].color_name) : "";
  const variants = colorVariants || allVariants;
  const images = unique([
    ...(colorVariants ? colorVariants.map((variant) => mediaUrl(variant.image_url || variant.image)) : []),
    product.og_image_url,
    product.image_url,
    ...(Array.isArray(product.gallery_images) ? product.gallery_images : []),
  ].map(mediaUrl));
  const sellableVariants = variants.filter((variant) => Number(variant.stock || 0) > 0);
  const available = variants.length
    ? sellableVariants.length > 0
    : Number(product.available_stock ?? product.total_stock ?? product.current_stock ?? product.stock ?? 0) > 0;
  const priceVariants = sellableVariants.length ? sellableVariants : variants;
  const prices = unique(
    (priceVariants.length ? priceVariants : [{}])
      .map((variant) => liveVariantPrice(variant, product))
      .filter((price) => price > 0)
      .map((price) => price.toFixed(2))
  ).map(Number);
  const fallbackPrice = liveVariantPrice({}, product);
  if (!prices.length && fallbackPrice) prices.push(fallbackPrice);
  const availability = `https://schema.org/${available ? "InStock" : "OutOfStock"}`;
  const offerBase = {
    priceCurrency: "EGP",
    availability,
    itemCondition: "https://schema.org/NewCondition",
    url: selectedColor ? `${url}?color=${encodeURIComponent(selectedColor)}` : url,
  };
  // Google merchant listings require Offer. AggregateOffer is supported only
  // for product snippets, so keep the schema price aligned with the initial
  // price displayed on this product page. A named colour's own price wins over the
  // product-wide one: that is the price its page shows and the ad quoted.
  const offers = {
    "@type": "Offer",
    ...offerBase,
    price: Number((colorVariants ? prices[0] || fallbackPrice : fallbackPrice || prices[0]) || 0).toFixed(2),
  };
  const merchantPolicies = product.merchant_policies || product.merchantPolicies || {};
  const shippingDetails = Array.isArray(merchantPolicies.shippingDetails) ? merchantPolicies.shippingDetails : [];
  if (shippingDetails.length) offers.shippingDetails = shippingDetails;
  if (merchantPolicies.returnPolicy) offers.hasMerchantReturnPolicy = merchantPolicies.returnPolicy;
  const colors = unique(variants.map((variant) => text(variant.color || variant.color_name)));
  const sku = text(product.sku || product.product_code || product.id);
  const keywords = splitProductKeywords(product.seo_keywords);

  const productJsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name,
    description,
    image: images,
    ...(sku ? { sku } : {}),
    ...(brand ? { brand: { "@type": "Brand", name: brand } } : {}),
    url,
    ...(colors.length ? { color: colors.join(", ") } : {}),
    ...(category ? { category } : {}),
    ...(keywords.length ? { keywords: keywords.join(", ") } : {}),
    offers,
  };
  const categoryName = category || "المنتجات";
  const categoryUrl = `${STOREFRONT_ORIGIN}/products${product.category_id ? `?category=${encodeURIComponent(product.category_id)}` : ""}`;
  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "الرئيسية", item: STOREFRONT_ORIGIN },
      { "@type": "ListItem", position: 2, name: categoryName, item: categoryUrl },
      { "@type": "ListItem", position: 3, name, item: url },
    ],
  };

  return {
    title,
    description,
    canonical: url,
    image: images[0] || "",
    imageAlt: name,
    url,
    locale: PRODUCT_SEO_LOCALE,
    localeAlternate: PRODUCT_SEO_LOCALE_ALTERNATE,
    keywords,
    robots: "index,follow,max-image-preview:large",
    productJsonLd,
    breadcrumbJsonLd,
  };
};
