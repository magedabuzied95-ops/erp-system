const unique = (items = []) => Array.from(new Set(items.map((item) => String(item || "").trim()).filter(Boolean)));

const cleanText = (value = "") => String(value || "").trim().replace(/\s+/g, " ");

const parseMoney = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const raw = String(value).replace(/[^\d.,-]/g, "").replace(/,/g, "");
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
};

const formatPrice = (value, currency = "EGP") => {
  const amount = parseMoney(value);
  if (amount === null) return "";
  const normalized = Number.isInteger(amount) ? String(amount) : amount.toFixed(2).replace(/\.00$/, "");
  return `${normalized} ${cleanText(currency) || "EGP"}`;
};

const firstNumber = (...values) => {
  for (const value of values) {
    const parsed = parseMoney(value);
    if (parsed !== null) return parsed;
  }
  return null;
};

const firstText = (...values) => values.map((value) => cleanText(value)).find(Boolean) || "";

const extractVariants = (variants = []) => {
  const active = Array.isArray(variants)
    ? variants.filter((variant) => {
        const quantity = Number(variant?.quantity ?? variant?.stock ?? variant?.stock_quantity ?? variant?.available_quantity ?? 0);
        const available = variant?.available === true || variant?.in_stock === true;
        return quantity > 0 || available;
      })
    : [];

  const sizes = unique(
    active.map((variant) =>
      firstText(
        variant?.size_name,
        variant?.size_label,
        variant?.size,
        variant?.variant_size,
        variant?.size_value,
        variant?.label
      )
    )
  );
  const colors = unique(
    active.map((variant) =>
      firstText(
        variant?.color_name,
        variant?.color_label,
        variant?.color,
        variant?.colour,
        variant?.variant_color
      )
    )
  );
  const stock = active.reduce((sum, variant) => {
    const quantity = Number(variant?.quantity ?? variant?.stock ?? variant?.stock_quantity ?? variant?.available_quantity ?? 0);
    return sum + (Number.isFinite(quantity) && quantity > 0 ? quantity : 1);
  }, 0);

  return { active, sizes, colors, stock };
};

const sectionLabelPattern = /^(hook|marketing body|erp info|cta|link|hashtags|new collection)\s*:?\s*$/i;

export const hasInternalSectionLabels = (value = "") => {
  const text = String(value || "");
  return /(^|\n)\s*(hook|marketing body|erp info|cta|link|hashtags)\s*:/i.test(text) || /\bnew collection\b/i.test(text);
};

export const stripInternalSectionLabels = (value = "") =>
  String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !sectionLabelPattern.test(line))
    .join("\n")
    .trim();

const toneBank = {
  premium: {
    label: "Premium",
    hooks: [
      "ستايل متوازن يعطي حضور أنيق من أول نظرة.",
      "اختيار هادي يطلع التفاصيل بشكل مرتب وواضح.",
      "لمسة premium تناسب اللوك اليومي من غير مبالغة.",
    ],
    bodies: [
      "تصميم نظيف وسهل يركب على أكتر من ستايل، ومناسب لو بتدور على شكل مرتب ومضمون.",
      "مظهر عملي بلمسة راقية يخلي القطعة سهلة في اللبس وسريعة في التوليف.",
      "التركيز هنا على البساطة الراقية والشكل اللي يفضل ثابت ومناسب لكل يوم.",
    ],
    ctas: [
      "لو عجبك اللوك، اطلبه الآن قبل ما يخلص.",
      "جاهز يضاف لخزانتك؟ اطلبه الآن.",
      "اختيارك لو بتحب الستايل الهادئ. اطلب الآن.",
    ],
    hashtagSets: [
      ["#premium", "#style", "#fashion", "#newcollection", "#shopnow"],
      ["#premiumlook", "#dailywear", "#style", "#newcollection", "#shopnow"],
    ],
  },
  luxury: {
    label: "Luxury",
    hooks: [
      "لمسة راقية بتطلع اللوك بشكل أنيق وموزون.",
      "تفاصيل هادئة بتدي إحساس luxury من أول نظرة.",
      "اختيار شيك بيوصل الفخامة بدون ضوضاء.",
    ],
    bodies: [
      "قطعة مناسبة لو بتحب الشكل المرتب واللمسة اللي تفضل راقية طول الوقت.",
      "تصميم هادي يوازن بين الفخامة والعملية في نفس الوقت.",
      "ستايل أنيق وسهل يكمّل أي إطلالة بشكل محسوب.",
    ],
    ctas: [
      "لو ذوقك راقي، اطلبه الآن.",
      "اختيار فخم من غير تعقيد. اطلب الآن.",
      "لو بتحب التفاصيل الهادية، دي فرصتك.",
    ],
    hashtagSets: [
      ["#luxury", "#elegant", "#style", "#fashion", "#newcollection"],
      ["#luxurystyle", "#elegance", "#fashion", "#shopnow", "#newcollection"],
    ],
  },
  sport: {
    label: "Sport",
    hooks: [
      "مريح ومتحرك معاك في اليوم الطويل.",
      "ستايل sport عملي وسهل يعتمد عليه.",
      "جاهز للحركة من غير ما يضيع شكل اللوك.",
    ],
    bodies: [
      "مصمم لليوم السريع، مع شكل واضح يديك راحة وحضور في نفس الوقت.",
      "اختيار عملي يناسب المشاوير الكتير والاستخدام اليومي.",
      "لو بتدور على شكل خفيف وسهل، ده اختيار مناسب.",
    ],
    ctas: [
      "جاهز للحركة؟ اطلبه الآن.",
      "لو المطلوب راحة وشكل حلو، اطلب الآن.",
      "اختيار عملي لليوم السريع. اطلب الآن.",
    ],
    hashtagSets: [
      ["#sport", "#activewear", "#style", "#shopnow", "#newcollection"],
      ["#sportstyle", "#dailycomfort", "#fashion", "#newcollection", "#shopnow"],
    ],
  },
  friendly: {
    label: "Friendly",
    hooks: [
      "اختيار سهل يليق على أكتر من مناسبة.",
      "شكل بسيط ومريح يخليك تعتمد عليه كل يوم.",
      "ستايل friendly وسهل في التنسيق.",
    ],
    bodies: [
      "مناسب لو بتحب القطع اللي تلبسها بسرعة وتكمل بيها يومك بدون تعقيد.",
      "تصميم عملي يخليك واثق في اللوك من غير تفاصيل زايدة.",
      "قطعة واضحة وسهلة ومناسبة للاستخدام اليومي.",
    ],
    ctas: [
      "لو حابب بساطة عملية، اطلب الآن.",
      "اختيار سهل ومرتب. اطلب الآن.",
      "مناسب ليك لو بتحب الستايل السهل.",
    ],
    hashtagSets: [
      ["#friendlystyle", "#everyday", "#fashion", "#newcollection", "#shopnow"],
      ["#casualwear", "#style", "#newcollection", "#shopnow", "#fashion"],
    ],
  },
  sales: {
    label: "Sales",
    hooks: [
      "فرصة سريعة قبل ما الكمية تتحرك.",
      "عرض واضح وسريع يستاهل الالتقاط الآن.",
      "لو مستني وقت مناسب، ده هو.",
    ],
    bodies: [
      "اختيار عملي بسعر أفضل، ومعه سبب واضح إنك تتحرك بسرعة قبل انتهاء العرض.",
      "المنتج حاضر بشكل ممتاز، والفرصة دلوقتي أحسن من الانتظار.",
      "عرض مرتب وسهل القرار، خصوصًا لو بتدور على قيمة واضحة مقابل السعر.",
    ],
    ctas: [
      "الفرصة محدودة، اطلب الآن.",
      "قبل ما العرض يخلص، اطلب الآن.",
      "لو السعر مناسب لك، احجزه الآن.",
    ],
    hashtagSets: [
      ["#sale", "#offer", "#deal", "#shopnow", "#newcollection"],
      ["#discount", "#sale", "#fashion", "#newcollection", "#shopnow"],
    ],
  },
};

const pickTone = (tone) => toneBank[String(tone || "").trim().toLowerCase()] || toneBank.premium;

const normalizeList = (value) => unique(Array.isArray(value) ? value : String(value || "").split(/[\s,•|/]+/));

const formatList = (items = []) => items.filter(Boolean).join(" • ");

const fallbackProductLabel = (productName = "") => cleanText(productName) || "الموديل";

export const resolveSocialPricing = ({ post = {}, design = {}, product = {} } = {}) => {
  const currency = firstText(design.currency, post.currency, product.currency) || "EGP";
  const current = firstNumber(
    post.current_price,
    design.current_price,
    product.current_price,
    post.sale_price,
    design.sale_price,
    product.sale_price,
    post.price,
    design.price,
    product.price
  );
  const original = firstNumber(
    post.original_price,
    design.original_price,
    product.original_price,
    post.compare_price,
    design.compare_price,
    product.compare_price,
    post.regular_price,
    design.regular_price,
    product.regular_price,
    post.list_price,
    design.list_price,
    product.list_price
  );
  const hasSale = Boolean(current && original && original > current);
  const discountPercent = hasSale ? Math.max(1, Math.round(((original - current) / original) * 100)) : 0;
  return {
    currency,
    current,
    original: hasSale ? original : null,
    hasSale,
    discountPercent,
    currentText: formatPrice(current, currency),
    originalText: hasSale ? formatPrice(original, currency) : "",
  };
};

export const collectSocialAvailability = ({ variants = [], product = {}, post = {}, design = {} } = {}) => {
  const variantLists = [variants, product.variants, post.variants, design.variants].filter(Array.isArray);
  const flatVariants = variantLists.flat();
  const { sizes, colors, stock } = extractVariants(flatVariants);
  const fallbackSizes = normalizeList(product.available_sizes || post.available_sizes || design.available_sizes || post.sizes_label || design.sizes_label)
    .map((item) => String(item || "").replace(/^available\s+sizes\s*:\s*/i, "").replace(/^sizes?\s*:\s*/i, "").trim())
    .filter(Boolean);
  const resolvedSizes = sizes.length ? sizes : fallbackSizes;
  const fallbackColors = normalizeList(product.available_colors || post.available_colors || design.available_colors || post.color_name || design.color_name)
    .map((item) => String(item || "").trim())
    .filter(Boolean);
  const resolvedColors = colors.length ? colors : fallbackColors;
  return {
    sizes: resolvedSizes,
    colors: resolvedColors,
    stock,
  };
};

export const buildSocialAICopy = ({
  tone = "premium",
  hookVariant = 0,
  ctaVariant = 0,
  hashtagVariant = 0,
  post = {},
  design = {},
  product = {},
  variants = [],
} = {}) => {
  const selectedTone = pickTone(tone);
  const pricing = resolveSocialPricing({ post, design, product });
  const availability = collectSocialAvailability({ variants, product, post, design });
  const productName = fallbackProductLabel(post.product_name || design.product_name || product.name || post.title || design.title);
  const brandName = cleanText(post.brand_name || design.brand_name || product.brand_name || product.brand);
  const hook = selectedTone.hooks[hookVariant % selectedTone.hooks.length] || selectedTone.hooks[0];
  const body = selectedTone.bodies[hookVariant % selectedTone.bodies.length] || selectedTone.bodies[0];
  const cta = selectedTone.ctas[ctaVariant % selectedTone.ctas.length] || selectedTone.ctas[0];
  const hashtagSet = selectedTone.hashtagSets[hashtagVariant % selectedTone.hashtagSets.length] || selectedTone.hashtagSets[0];
  const toneHint = selectedTone.label;

  const stockStatus =
    availability.stock > 0
      ? availability.stock < 5
        ? "⚠️ الكمية محدودة"
        : "متوفر الآن"
      : "❌ غير متوفر حالياً";
  const sizesLine = availability.sizes.length ? `المقاسات المتوفرة: ${formatList(availability.sizes)}` : "";
  const colorsLine = availability.colors.length ? `${availability.colors.length === 1 ? "اللون:" : "الألوان:"} ${formatList(availability.colors)}` : "";
  const saleLines = pricing.hasSale
    ? [
        `السعر الآن: ${pricing.currentText}`,
        pricing.originalText ? `قبل الخصم: ${pricing.originalText}` : "",
        pricing.discountPercent ? `وفر ${pricing.discountPercent}%` : "",
        "⏳ عرض لفترة محدودة.",
      ].filter(Boolean)
    : [`السعر: ${pricing.currentText}`];
  const link = firstText(post.product_url, design.product_url, product.url, product.product_url, post.cta_url, design.cta_url) || "";
  const hashtags = unique([
    ...hashtagSet,
    ...(toneVariantHashtags(productName, brandName)),
    ...normalizeList(post.hashtags || design.hashtags || design.tags),
  ]).slice(0, 8);
  const caption = [
    "NEW COLLECTION",
    hook,
    body,
    cta,
    ...saleLines,
    sizesLine,
    colorsLine,
    stockStatus,
    link ? `اطلب الآن:\n${link}` : "",
    hashtags.length ? hashtags.join(" ") : "",
  ]
    .filter(Boolean)
    .join("\n\n")
    .trim();

  return {
    tone: toneHint,
    hook,
    body,
    cta,
    hashtags,
    caption,
    pricing,
    availability,
    productName,
    brandName,
    link,
  };
};

const toneVariantHashtags = (productName, brandName) => {
  const brandSlug = cleanText(brandName).replace(/[^\p{L}\p{N}]+/gu, "").toLowerCase();
  return [brandSlug ? `#${brandSlug}` : ""].filter(Boolean);
};

export const defaultSocialTone = "premium";
export const socialToneOptions = Object.entries(toneBank).map(([id, value]) => ({ id, label: value.label }));
