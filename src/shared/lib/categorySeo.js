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

export const categoryCanonical = (definition, page = 1) =>
  `${STOREFRONT_ORIGIN}${definition.path}${Number(page) > 1 ? `?page=${Number(page)}` : ""}`;

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

export const buildCategoryItemList = (definition, products = [], page = 1, pageSize = 24) => ({
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
});
