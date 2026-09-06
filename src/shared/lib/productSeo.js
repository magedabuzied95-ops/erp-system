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

export const buildProductSeo = (product = {}) => {
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
  const images = unique([
    product.og_image_url,
    product.image_url,
    ...(Array.isArray(product.gallery_images) ? product.gallery_images : []),
  ].map(text));
  const variants = (Array.isArray(product.variants) ? product.variants : []).filter(Boolean);
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
    url,
  };
  // Google merchant listings require Offer. AggregateOffer is supported only
  // for product snippets, so keep the schema price aligned with the initial
  // price displayed on this product page.
  const offers = {
    "@type": "Offer",
    ...offerBase,
    price: Number(fallbackPrice || prices[0] || 0).toFixed(2),
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
