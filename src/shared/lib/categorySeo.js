export const STOREFRONT_ORIGIN = "https://m1store-egy.com";

export const SEO_CATEGORY_DEFINITIONS = [
  {
    key: "men", path: "/men", apiFilters: { gender: "men" },
    title: "أحذية رجالي أصلية | M1 Store",
    h1: "أحذية رجالي",
    description: "تسوق أحدث الأحذية والسنيكرز الرجالي المتاحة من M1 Store في مصر، بمقاسات وألوان متنوعة.",
    intro: "اختيارات رجالي متاحة فعليًا من الكتالوج، مع إمكانية التصفية حسب الماركة والمقاس والسعر.",
    related: ["/men/large-sizes", "/slippers", "/offers"],
  },
  {
    key: "women", path: "/women", apiFilters: { gender: "women" },
    title: "أحذية حريمي وسنيكرز | M1 Store",
    h1: "أحذية حريمي",
    description: "اكتشفي الأحذية والسنيكرز الحريمي المتاحة في M1 Store بمصر، مع مقاسات وألوان تناسب كل يوم.",
    intro: "تشكيلة حريمي من المنتجات المتاحة حاليًا، ويمكن تضييق النتائج بالمقاس والماركة والنوع.",
    related: ["/bags", "/slippers", "/offers"],
  },
  {
    key: "kids", path: "/kids", apiFilters: { gender: "kids" },
    title: "أحذية أطفال وسنيكرز | M1 Store",
    h1: "أحذية أطفال",
    description: "تسوق أحذية وسنيكرز الأطفال المتاحة في M1 Store بمقاسات عملية وخيارات مناسبة للاستخدام اليومي.",
    intro: "منتجات الأطفال المتاحة في المخزون مع فلاتر تساعدك على الوصول للمقاس والنوع المناسبين.",
    related: ["/men", "/women", "/offers"],
  },
  {
    key: "bags", path: "/bags", apiFilters: { product_type: "bags" },
    title: "شنط وحقائب | M1 Store",
    h1: "الشنط والحقائب",
    description: "تسوق الشنط والحقائب المتاحة في M1 Store بمصر واستخدم الفلاتر لاختيار الموديل والسعر المناسب.",
    intro: "الشنط والحقائب المعروضة هنا تأتي مباشرة من كتالوج المتجر الحالي.",
    related: ["/women", "/offers", "/men"],
  },
  {
    key: "crocs", path: "/crocs", apiFilters: { product_type: "crocs" },
    title: "كروكس متوفر بمقاسات متنوعة | M1 Store",
    h1: "كروكس",
    description: "تسوق موديلات كروكس المتاحة حاليًا في M1 Store بمصر بمقاسات وألوان متعددة.",
    intro: "موديلات كروكس المتاحة من نفس مخزون المتجر، مع فلترة مباشرة حسب المقاس واللون.",
    related: ["/slippers", "/men", "/women"],
  },
  {
    key: "slippers", path: "/slippers", apiFilters: { product_type: "slippers" },
    title: "سليبر وشباشب | M1 Store",
    h1: "سليبر وشباشب",
    description: "تسوق السليبر والشباشب المتاحة في M1 Store بمصر واختر من المقاسات والموديلات الحالية.",
    intro: "كل المنتجات هنا مرتبطة بتصنيف السليبر الفعلي في كتالوج المتجر.",
    related: ["/crocs", "/men", "/women"],
  },
  {
    key: "offers", path: "/offers", apiFilters: { offer_story: 1 },
    title: "عروض الأحذية والشنط | M1 Store",
    h1: "العروض",
    description: "اكتشف عروض M1 Store الحالية على الأحذية والسنيكرز والشنط المتاحة للشراء في مصر.",
    intro: "العروض الظاهرة مرتبطة بالمنتجات المحددة كعروض فعلية داخل نظام المتجر.",
    related: ["/men", "/women", "/kids"],
  },
  {
    key: "men-large-sizes", path: "/men/large-sizes", apiFilters: { gender: "men", large_sizes: 1, inStock: 1 },
    largeSizes: { min: 47, max: 50 },
    title: "أحذية رجالي مقاسات كبيرة 47 إلى 50 في مصر | M1 Store",
    h1: "أحذية رجالي مقاسات كبيرة",
    description: "تسوق أحذية رجالي بمقاسات كبيرة من 47 إلى 50 والمتاحة فعليًا في مخزون M1 Store داخل مصر.",
    intro: "نعرض فقط الموديلات الرجالي التي يوجد منها حاليًا مقاس متاح من 47 إلى 50.",
    related: ["/men", "/offers", "/slippers"],
  },
];

export const seoCategoryByPath = (pathname = "") =>
  SEO_CATEGORY_DEFINITIONS.find((item) => item.path === String(pathname || "").replace(/\/+$/, "") || (item.path === "/" && pathname === "/")) || null;

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

export const buildCategoryBreadcrumb = (definition) => ({
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [
    { "@type": "ListItem", position: 1, name: "الرئيسية", item: `${STOREFRONT_ORIGIN}/` },
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
