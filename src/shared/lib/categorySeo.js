export const STOREFRONT_ORIGIN = "https://m1store-egy.com";

export const SEO_CATEGORY_DEFINITIONS = [
  {
    key: "men", path: "/men", apiFilters: { gender: "men" },
    title: "أحذية رجالي أصلية | M1 Store",
    h1: "أحذية رجالي",
    description: "تسوق أحدث الأحذية والسنيكرز الرجالي المتاحة من M1 Store في مصر، بمقاسات وألوان متنوعة.",
    intro: "اختيارات رجالي متاحة فعليًا من الكتالوج، مع إمكانية التصفية حسب الماركة والمقاس والسعر.",
    en: {
      title: "Original men's shoes | M1 Store",
      h1: "Men's shoes",
      description: "Shop the latest men's shoes and sneakers available from M1 Store in Egypt, in a range of sizes and colours.",
      intro: "Men's picks that are actually in the catalogue, with filters for brand, size and price.",
    },
    related: ["/men/large-sizes", "/slippers", "/offers"],
  },
  {
    key: "women", path: "/women", apiFilters: { gender: "women" },
    title: "أحذية حريمي وسنيكرز | M1 Store",
    h1: "أحذية حريمي",
    description: "اكتشفي الأحذية والسنيكرز الحريمي المتاحة في M1 Store بمصر، مع مقاسات وألوان تناسب كل يوم.",
    intro: "تشكيلة حريمي من المنتجات المتاحة حاليًا، ويمكن تضييق النتائج بالمقاس والماركة والنوع.",
    en: {
      title: "Women's shoes and sneakers | M1 Store",
      h1: "Women's shoes",
      description: "Discover the women's shoes and sneakers available at M1 Store in Egypt, with sizes and colours for every day.",
      intro: "A women's selection from the products available right now. Narrow the results by size, brand and type.",
    },
    related: ["/bags", "/slippers", "/offers"],
  },
  {
    key: "kids", path: "/kids", apiFilters: { gender: "kids" },
    title: "أحذية أطفال وسنيكرز | M1 Store",
    h1: "أحذية أطفال",
    description: "تسوق أحذية وسنيكرز الأطفال المتاحة في M1 Store بمقاسات عملية وخيارات مناسبة للاستخدام اليومي.",
    intro: "منتجات الأطفال المتاحة في المخزون مع فلاتر تساعدك على الوصول للمقاس والنوع المناسبين.",
    en: {
      title: "Kids' shoes and sneakers | M1 Store",
      h1: "Kids' shoes",
      description: "Shop the kids' shoes and sneakers available at M1 Store in practical sizes and options for everyday use.",
      intro: "Kids' products in stock, with filters that help you reach the right size and type.",
    },
    related: ["/men", "/women", "/offers"],
  },
  {
    key: "bags", path: "/bags", apiFilters: { product_type: "bags" },
    title: "شنط وحقائب | M1 Store",
    h1: "الشنط والحقائب",
    description: "تسوق الشنط والحقائب المتاحة في M1 Store بمصر واستخدم الفلاتر لاختيار الموديل والسعر المناسب.",
    intro: "الشنط والحقائب المعروضة هنا تأتي مباشرة من كتالوج المتجر الحالي.",
    en: {
      title: "Bags | M1 Store",
      h1: "Bags",
      description: "Shop the bags available at M1 Store in Egypt and use the filters to pick the right model and price.",
      intro: "The bags shown here come straight from the store's current catalogue.",
    },
    related: ["/women", "/offers", "/men"],
  },
  {
    key: "crocs", path: "/crocs", apiFilters: { product_type: "crocs" },
    title: "كروكس متوفر بمقاسات متنوعة | M1 Store",
    h1: "كروكس",
    description: "تسوق موديلات كروكس المتاحة حاليًا في M1 Store بمصر بمقاسات وألوان متعددة.",
    intro: "موديلات كروكس المتاحة من نفس مخزون المتجر، مع فلترة مباشرة حسب المقاس واللون.",
    en: {
      title: "Crocs in a range of sizes | M1 Store",
      h1: "Crocs",
      description: "Shop the Crocs models currently available at M1 Store in Egypt, in many sizes and colours.",
      intro: "Crocs models from the store's own stock, with direct filtering by size and colour.",
    },
    related: ["/slippers", "/men", "/women"],
  },
  {
    key: "slippers", path: "/slippers", apiFilters: { product_type: "slippers" },
    title: "سليبر وشباشب | M1 Store",
    h1: "سليبر وشباشب",
    description: "تسوق السليبر والشباشب المتاحة في M1 Store بمصر واختر من المقاسات والموديلات الحالية.",
    intro: "كل المنتجات هنا مرتبطة بتصنيف السليبر الفعلي في كتالوج المتجر.",
    en: {
      title: "Slippers and slides | M1 Store",
      h1: "Slippers and slides",
      description: "Shop the slippers and slides available at M1 Store in Egypt and choose from the current sizes and models.",
      intro: "Every product here belongs to the store catalogue's actual slippers category.",
    },
    related: ["/crocs", "/men", "/women"],
  },
  {
    key: "offers", path: "/offers", apiFilters: { offer_story: 1 },
    title: "عروض الأحذية والشنط | M1 Store",
    h1: "العروض",
    description: "اكتشف عروض M1 Store الحالية على الأحذية والسنيكرز والشنط المتاحة للشراء في مصر.",
    intro: "العروض الظاهرة مرتبطة بالمنتجات المحددة كعروض فعلية داخل نظام المتجر.",
    en: {
      title: "Shoe and bag offers | M1 Store",
      h1: "Offers",
      description: "Discover M1 Store's current offers on the shoes, sneakers and bags available to buy in Egypt.",
      intro: "The offers shown are the products marked as live offers inside the store system.",
    },
    related: ["/men", "/women", "/kids"],
  },
  {
    key: "men-large-sizes", path: "/men/large-sizes", apiFilters: { gender: "men", large_sizes: 1, inStock: 1 },
    largeSizes: { min: 47, max: 50 },
    title: "أحذية رجالي مقاسات كبيرة 47 إلى 50 في مصر | M1 Store",
    h1: "أحذية رجالي مقاسات كبيرة",
    description: "تسوق أحذية رجالي بمقاسات كبيرة من 47 إلى 50 والمتاحة فعليًا في مخزون M1 Store داخل مصر.",
    intro: "نعرض فقط الموديلات الرجالي التي يوجد منها حاليًا مقاس متاح من 47 إلى 50.",
    en: {
      title: "Men's shoes in large sizes 47 to 50 in Egypt | M1 Store",
      h1: "Men's shoes in large sizes",
      description: "Shop men's shoes in large sizes from 47 to 50 that are actually in M1 Store's stock in Egypt.",
      intro: "We only show the men's models that currently have a size from 47 to 50 available.",
    },
    related: ["/men", "/offers", "/slippers"],
  },
];

export const seoCategoryByPath = (pathname = "") =>
  SEO_CATEGORY_DEFINITIONS.find((item) => item.path === String(pathname || "").replace(/\/+$/, "") || (item.path === "/" && pathname === "/")) || null;

/**
 * The definitions carry Arabic copy at the top level (the original, SEO-indexed
 * wording) and an `en` block. This returns the definition with the page-facing
 * fields (title, h1, description, intro) in the requested language, so callers
 * never read the Arabic fields directly on an English page.
 */
export const localizeSeoCategory = (definition, language = "ar") => {
  if (!definition) return definition;
  const isEnglish = String(language || "").toLowerCase().startsWith("en");
  if (!isEnglish || !definition.en) return definition;
  return { ...definition, ...definition.en };
};

export const seoCategoryByKey = (key = "") =>
  SEO_CATEGORY_DEFINITIONS.find((item) => item.key === String(key || "")) || null;

/*
 * A section page pins some filters in its path: /men IS gender=men, /crocs IS
 * product_type=crocs. The listing reads the pinned value ahead of the URL, so
 * writing ?gender=women onto /men changed nothing but the chip -- the grid stayed
 * men. Changing or removing a pinned field therefore has to leave the path: to the
 * section that pins the new value when there is one, otherwise to /products with
 * the new value in the query. Each entry names the pin in apiFilters, the query
 * parameter the listing reads it from, and every alias that must go with it.
 */
const SEO_PINNED_URL_FIELDS = {
  gender: { pin: "gender", param: "gender", aliases: ["gender"] },
  type: { pin: "product_type", param: "type", aliases: ["type", "product_type", "category"] },
};

const seoSectionPinning = (pin, value) =>
  SEO_CATEGORY_DEFINITIONS.find((item) => {
    const keys = Object.keys(item.apiFilters || {});
    return keys.length === 1 && keys[0] === pin && String(item.apiFilters[pin]) === value;
  }) || null;

/**
 * The URL a gender/type change should open on a section page, or null when the
 * section does not pin that field (the caller then writes the query as usual).
 * `value` is expected already normalized ("women", "bags"); "" or "all" removes it.
 * `search` is the current query string; page is dropped like any filter change.
 */
export const seoPinnedFilterUrl = (definition, field, value, search = "") => {
  const spec = SEO_PINNED_URL_FIELDS[field === "productType" ? "type" : field];
  if (!spec || !definition?.apiFilters?.[spec.pin]) return null;

  const rawValue = String(value ?? "").trim().toLowerCase();
  const nextValue = rawValue === "all" ? "" : rawValue;
  const next = new URLSearchParams(search);
  next.delete("page");
  spec.aliases.forEach((key) => next.delete(key));

  const target = nextValue ? seoSectionPinning(spec.pin, nextValue) : null;
  if (!target && nextValue) next.set(spec.param, nextValue);

  // Whatever else this section pinned still applies -- but it lived in the path,
  // so it has to move into the query or it is silently dropped on the way out.
  Object.values(SEO_PINNED_URL_FIELDS).forEach((other) => {
    if (other === spec) return;
    const pinned = definition.apiFilters[other.pin];
    if (!pinned || target?.apiFilters?.[other.pin]) return;
    next.delete(other.pin);
    next.set(other.param, String(pinned));
  });

  const query = next.toString();
  return `${target ? target.path : "/products"}${query ? `?${query}` : ""}`;
};

export const categoryCanonical =(definition, page = 1) =>
  `${STOREFRONT_ORIGIN}${definition.path}${Number(page) > 1 ? `?page=${Number(page)}` : ""}`;

/*
 * The head tags a crawler indexes speak Arabic whatever language the visitor's app
 * is in. The server renders the Arabic copy (the crawler never runs the language
 * code), and a render that swapped it for the `en` block handed Googlebot -- which
 * has no stored language and an en-US browser -- "Original men's shoes" in place of
 * "أحذية رجالي أصلية". The visible h1 and intro still follow the reader.
 */
export const categorySeoHeadCopy = (definition) =>
  (definition && seoCategoryByKey(definition.key)) || definition;

/*
 * canonical + robots for any product listing: a section (/men) or the open
 * listings (/products, /sale). Only ?page= describes a distinct indexable page;
 * every other parameter (a facet, a sort, a page size, a search) is a view of the
 * same listing, so it is noindex and canonicalises to the bare path. A page past
 * the last one is the API's copy of the last page, never a page of its own.
 */
export const listingSeoHead = ({ path = "/products", params = [], page = 1, totalPages = 0 } = {}) => {
  const keys = Array.from(params instanceof URLSearchParams ? params.keys() : Object.keys(params || {}));
  const hasNonPageParams = keys.some((key) => key !== "page");
  const safePage = Math.max(1, Number.parseInt(String(page), 10) || 1);
  const pastLastPage = Number(totalPages) > 0 && safePage > Number(totalPages);
  const indexable = !hasNonPageParams && !pastLastPage;
  const canonicalPage = indexable ? safePage : 1;
  return {
    canonical: `${STOREFRONT_ORIGIN}${path}${canonicalPage > 1 ? `?page=${canonicalPage}` : ""}`,
    robots: indexable ? "index,follow" : "noindex,follow",
    indexable,
    pastLastPage,
  };
};

const seoMediaUrl = (entry) => {
  if (typeof entry === "string") return entry.trim();
  if (!entry || typeof entry !== "object") return "";
  return String(entry.url || entry.image_url || entry.src || "").trim();
};

// The listing's lean projection carries image_url / product_image_url / gallery_images;
// the old cover_image / image / images[] fields are never on a card, so og:image and the
// crawlable <img> were always empty. The result may be a relative /uploads path: the
// caller makes it absolute against the API origin (relative /uploads on the shop origin
// answers the app's HTML).
export const categoryProductImage = (product = {}) =>
  [
    product?.image_url,
    product?.product_image_url,
    Array.isArray(product?.gallery_images) ? product.gallery_images[0] : "",
    product?.cover_image,
    product?.coverImage,
    product?.image,
    Array.isArray(product?.images) ? product.images[0] : "",
  ].map(seoMediaUrl).find(Boolean) || "";

// The listing returns one card per colour, all sharing the product's slug. A list of
// products names each product once: four colours were four identical ListItems,
// links and headings.
export const uniqueCategoryProducts = (products = []) => {
  const seen = new Set();
  return (Array.isArray(products) ? products : []).filter((product) => {
    if (!product) return false;
    const key = String(product.parent_product_id || product.id || product.slug || product.canonical_slug || "");
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export const productHasLargeAvailableSize = (product = {}, range = {}) =>
  (Array.isArray(product.variants) ? product.variants : []).some((variant) => {
    const size = Number(variant.size ?? variant.size_value);
    const stock = Number(variant.stock ?? variant.quantity ?? variant.available_stock ?? 0);
    return Number.isFinite(size) && size >= Number(range.min) && size <= Number(range.max) && stock > 0;
  });

export const buildCategoryBreadcrumb = (definition, homeLabel = "الرئيسية") => ({
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [
    { "@type": "ListItem", position: 1, name: homeLabel, item: `${STOREFRONT_ORIGIN}/` },
    { "@type": "ListItem", position: 2, name: definition.h1, item: `${STOREFRONT_ORIGIN}${definition.path}` },
  ],
});

export const buildCategoryItemList = (definition, cards = [], page = 1, pageSize = 24) => {
  const products = uniqueCategoryProducts(cards);
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: definition.h1,
    numberOfItems: products.length,
    itemListElement: products.map((product, index) => ({
      "@type": "ListItem",
      position: (Math.max(1, Number(page)) - 1) * pageSize + index + 1,
      url: `${STOREFRONT_ORIGIN}/product/${encodeURIComponent(product.slug || product.canonical_slug || product.id)}`,
      name: String(product.name || product.title || "").trim(),
    })),
  };
};
