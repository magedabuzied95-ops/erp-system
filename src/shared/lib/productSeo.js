import { SEO_CATEGORY_DEFINITIONS } from "./categorySeo.js";
import { toDateKeyInAppTimezone } from "./appTimezone.js";

export const STOREFRONT_ORIGIN = "https://m1store-egy.com";
export const STORE_NAME = "M1 Store";
export const PRODUCT_SEO_LOCALE = "ar_EG";
export const PRODUCT_SEO_LOCALE_ALTERNATE = "en_US";
export const PRODUCT_TITLE_MAX = 70;
// A product page that lists every photograph it owns published 25 urls for one sneaker.
// Google reads the first images; the rest are weight on every crawl of every product.
export const PRODUCT_SCHEMA_IMAGE_MAX = 10;
// 23 hand-typed colour names in one string is not a colour, it is a dump of the variant table.
export const PRODUCT_SCHEMA_COLOR_MAX = 12;

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

/*
 * Colour names are typed by hand in the catalogue, so one colourway reaches the schema as
 * "White & #Black", "Black & White* Warke" and "WHite & Colors". A shopper reading the page
 * skips the noise; Google stores the string. This strips the stray marks, repairs the
 * shift-key spellings (WHite -> White) and leaves the wording itself alone -- the merchant's
 * own colour names are not ours to rewrite.
 */
export const cleanColorLabel = (value = "") =>
  text(value)
    .replace(/[#*]+/g, " ")
    .replace(/\s*&\s*/g, " & ")
    .replace(/^[\s&]+|[\s&]+$/g, "")
    .replace(/\s+/g, " ")
    .split(" ")
    .map((word) => (/^[A-Z]{2,}[a-z]/.test(word) ? `${word[0]}${word.slice(1).toLowerCase()}` : word))
    .join(" ");

// "White & Black" and "WHite & Black" are one colour; the cleaned spelling that arrived first wins.
const uniqueColorLabels = (values = []) => {
  const byKey = new Map();
  values.map(cleanColorLabel).filter(Boolean).forEach((label) => {
    const key = label.toLowerCase();
    if (!byKey.has(key)) byKey.set(key, label);
  });
  return [...byKey.values()];
};

/*
 * The catalogue's barcodes are generated in house, so most of them are not GTINs at all --
 * 606577986623 on the Air Jordan fails its own check digit. A wrong gtin is worse than none:
 * it matches the page to somebody else's article in the Merchant Center. Only a barcode that
 * passes the GTIN-8/12/13/14 checksum is published.
 */
export const isValidGtin = (value = "") => {
  const digits = text(value);
  if (!/^\d+$/.test(digits) || ![8, 12, 13, 14].includes(digits.length)) return false;
  const values = [...digits].map(Number);
  const checkDigit = values.pop();
  const sum = values.reverse().reduce((total, digit, index) => total + digit * (index % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === checkDigit;
};

/*
 * priceValidUntil reads as "this price is guaranteed until". Validators ask for it and the
 * usual answer is a year from today, which is a promise the shop never made. Only a real sale
 * window sets one, on the store's calendar -- a UTC slice dates a Cairo evening a day early.
 */
const priceValidUntilFor = (product = {}) =>
  toDateKeyInAppTimezone(product.sale_end_at || product.saleEndAt || product.sale_ends_at || "") || "";

/*
 * The breadcrumb's middle step used to be /products?category=8: a facet url, and every facet
 * url on this storefront is noindex (listingSeoHead). A breadcrumb pointing at a page Google is
 * told not to index is a dead rung. Each product belongs to a real section page instead --
 * /bags, /crocs, /slippers by type, otherwise /men, /women, /kids by gender. The Arabic h1 is
 * the label, like the rest of the crawler-facing copy.
 */
export const seoCategoryForProduct = (product = {}) => {
  const productType = text(product.product_type || product.productType).toLowerCase();
  const gender = text(product.gender).toLowerCase();
  const byType = productType
    && SEO_CATEGORY_DEFINITIONS.find((item) => item.apiFilters?.product_type === productType);
  if (byType) return byType;
  return (gender
    && SEO_CATEGORY_DEFINITIONS.find((item) => item.apiFilters?.gender === gender && !item.largeSizes)) || null;
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

// The ad links name the exact size with ?variant=: within one colour, sizes can carry their own
// prices (Skechers Max Run 46-48 at 1,450 in a colour that opens on 1,350). A variant id this
// product has narrows the offer to that one size; an unknown id is ignored.
const variantById = (variants = [], variantId = "") => {
  const wanted = text(variantId);
  if (!wanted) return null;
  const match = variants.find((variant) => text(variant.id) === wanted);
  return match ? [match] : null;
};

/*
 * The stars Google may show under the link.
 *
 * Built only from published reviews (the caller passes what the product page itself shows) and
 * only when there is at least one: a Product schema claiming a rating the page does not display
 * is exactly what Google's review-snippet policy penalises. `review` carries the newest few,
 * which are the first ones the page lists, so every review in the schema is visible on the page.
 */
export const PRODUCT_SCHEMA_REVIEW_MAX = 5;

const ratingNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 1 && parsed <= 5 ? parsed : 0;
};

export const buildReviewSchema = ({ summary = null, reviews = [] } = {}) => {
  const reviewCount = Math.max(0, Math.round(Number(summary?.review_count) || 0));
  const average = ratingNumber(summary?.rating_average);
  if (!reviewCount || !average) return {};
  const items = (Array.isArray(reviews) ? reviews : [])
    .filter((review) => ratingNumber(review?.rating))
    .slice(0, PRODUCT_SCHEMA_REVIEW_MAX)
    .map((review) => {
      const published = toDateKeyInAppTimezone(review.created_at || "");
      const body = text(review.body);
      return {
        "@type": "Review",
        reviewRating: { "@type": "Rating", ratingValue: ratingNumber(review.rating), bestRating: 5, worstRating: 1 },
        // The masked name the page prints ("Maged A."), never the stored full name.
        author: { "@type": "Person", name: text(review.customer_name) || "عميل" },
        ...(published ? { datePublished: published } : {}),
        ...(body ? { reviewBody: body } : {}),
      };
    });
  return {
    aggregateRating: {
      "@type": "AggregateRating",
      ratingValue: Math.round(average * 10) / 10,
      reviewCount,
      bestRating: 5,
      worstRating: 1,
    },
    ...(items.length ? { review: items } : {}),
  };
};

export const buildProductSeo = (product = {}, { color = "", variant = "", reviews = null } = {}) => {
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
  const colorVariants = variantById(allVariants, variant) || variantsForColor(allVariants, color);
  const selectedColor = colorVariants ? text(colorVariants[0].color || colorVariants[0].color_name) : "";
  const selectedVariantId = colorVariants && colorVariants.length === 1 && text(variant) ? text(colorVariants[0].id) : "";
  const variants = colorVariants || allVariants;
  // The photographs the shop actually took, the named colour's first.
  const catalogImages = unique([
    ...(colorVariants ? colorVariants.map((variant) => variant.image_url || variant.image) : []),
    product.image_url,
    ...(Array.isArray(product.gallery_images) ? product.gallery_images : []),
  ].map(mediaUrl));
  /*
   * og_image_url is a drawn 1200x630 card: the photo with the price, the brand and the store
   * name rendered over it. That is the right picture for a link pasted into WhatsApp and the
   * wrong one for Product.image, which Google shows AS the product -- its own guidance rules
   * out images with overlaid text and logos. So the card leads the social meta below and the
   * schema lists the plain photographs, capped.
   */
  const images = unique([mediaUrl(product.og_image_url), ...catalogImages]);
  const schemaImages = (catalogImages.length ? catalogImages : images).slice(0, PRODUCT_SCHEMA_IMAGE_MAX);
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
    url: selectedColor
      ? `${url}?color=${encodeURIComponent(selectedColor)}${selectedVariantId ? `&variant=${encodeURIComponent(selectedVariantId)}` : ""}`
      : url,
  };
  // Google merchant listings require Offer. AggregateOffer is supported only
  // for product snippets, so keep the schema price aligned with the initial
  // price displayed on this product page. A named colour's own price wins over the
  // product-wide one: that is the price its page shows and the ad quoted.
  // Without a colour the page opens on the first in-stock size in the order the API
  // returns them (StorefrontProductDetailPage), so the offer quotes that size too.
  // product.final_price is the CHEAPEST in-stock size, which on a product priced by
  // colourway (Air Force 1 at 900-1,850) is not the price the canonical page shows.
  const offers = {
    "@type": "Offer",
    ...offerBase,
    price: Number((prices[0] || fallbackPrice) || 0).toFixed(2),
  };
  const priceValidUntil = priceValidUntilFor(product);
  if (priceValidUntil) offers.priceValidUntil = priceValidUntil;
  const merchantPolicies = product.merchant_policies || product.merchantPolicies || {};
  const shippingDetails = Array.isArray(merchantPolicies.shippingDetails) ? merchantPolicies.shippingDetails : [];
  if (shippingDetails.length) offers.shippingDetails = shippingDetails;
  if (merchantPolicies.returnPolicy) offers.hasMerchantReturnPolicy = merchantPolicies.returnPolicy;
  const colors = uniqueColorLabels(variants.map((variant) => variant.color || variant.color_name))
    .slice(0, PRODUCT_SCHEMA_COLOR_MAX);
  const sku = text(product.sku || product.product_code || product.id);
  // A colour's own barcode when the link named one, the product's otherwise; neither is
  // published unless it survives isValidGtin.
  const gtin = [
    ...(colorVariants ? colorVariants.map((variant) => variant.gtin || variant.barcode) : []),
    product.gtin,
    product.barcode,
  ].map(text).find(isValidGtin) || "";
  const keywords = splitProductKeywords(product.seo_keywords);

  const productJsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name,
    description,
    image: schemaImages,
    ...(sku ? { sku } : {}),
    ...(gtin ? { gtin } : {}),
    ...(brand ? { brand: { "@type": "Brand", name: brand } } : {}),
    url,
    ...(colors.length ? { color: colors.join(", ") } : {}),
    ...(category ? { category } : {}),
    ...(keywords.length ? { keywords: keywords.join(", ") } : {}),
    offers,
    ...buildReviewSchema(reviews || {}),
  };
  const breadcrumbCategory = seoCategoryForProduct(product);
  const categoryName = breadcrumbCategory?.h1 || category || "المنتجات";
  const categoryUrl = `${STOREFRONT_ORIGIN}${breadcrumbCategory ? breadcrumbCategory.path : "/products"}`;
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
