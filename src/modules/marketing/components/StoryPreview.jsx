import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, ChevronUp, Maximize2, Pause, Play, RefreshCcw, RotateCcw, SkipBack, SkipForward } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { accentClasses, animationVariants, getStoryTemplate, normalizeAnimation, STORY_TEMPLATES } from "./storyTemplateEngine";
import StoryExportControls from "./StoryExportControls";

const formatCurrency = (value) => {
  const amount = Number(value || 0);
  if (!(amount > 0)) return "";
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(amount)} EGP`;
};

const truthyFlag = (value) => value === true || value === 1 || String(value || "").toLowerCase() === "true";
const numericPrice = (...values) => {
  for (const value of values) {
    const normalized = String(value ?? "")
      .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
      .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
      .replace(/[,\u066C\s]/g, "")
      .replace(/\u066B/g, ".")
      .replace(/[^\d.-]/g, "");
    const number = Number(normalized || 0);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return 0;
};

const storyPriceDebugForceEnabled = () => {
  try {
    return typeof window !== "undefined" && window.localStorage?.getItem("STORY_PRICE_DEBUG_FORCE") === "1";
  } catch {
    return false;
  }
};

const productSlug = (source = {}) => String(source.product_slug || source.slug || source.canonical_slug || source.product_id || source.id || "").trim();

const storyCtaUrl = (...sources) => {
  for (const source of sources) {
    const url = String(source?.cta_url || source?.product_url || source?.public_url || source?.url || source?.social_meta?.url || "").trim();
    if (url) return url;
    const slug = productSlug(source || {});
    if (slug) return `/shop/product/${slug}`;
  }
  return "";
};

const saleActive = (source = {}) => {
  const regular = Number(source?.regular_price ?? source?.price ?? 0);
  const sale = Number(source?.sale_price ?? source?.offer_price ?? 0);
  if (!truthyFlag(source?.sale_price_enabled) || !(sale > 0 && regular > 0 && sale < regular)) return false;
  const now = Date.now();
  const start = source?.sale_start_at ? new Date(source.sale_start_at).getTime() : 0;
  const end = source?.sale_end_at ? new Date(source.sale_end_at).getTime() : 0;
  if (Number.isFinite(start) && start > 0 && now < start) return false;
  if (Number.isFinite(end) && end > 0 && now > end) return false;
  return true;
};

const activeSellingPrice = (product = {}) => {
  const explicitlyResolved = numericPrice(
    product.current_price,
    product.currentPrice,
    product.active_price,
    product.activePrice
  );
  if (explicitlyResolved > 0) return explicitlyResolved;
  if (saleActive(product)) return numericPrice(product.sale_price, product.offer_price);
  const saleLikePrice = numericPrice(product.sale_price, product.offer_price, product.discount_price);
  const regular = numericPrice(product.regular_price, product.compare_at_price, product.old_price, product.price);
  if (saleLikePrice > 0 && (!regular || saleLikePrice < regular)) return saleLikePrice;
  return numericPrice(
    product.storefront_price,
    product.storefrontPrice,
    product.storefront_adjusted_price,
    product.storefrontAdjustedPrice,
    product.adjusted_price,
    product.adjustedPrice,
    product.final_price,
    product.finalPrice,
    product.selling_price,
    product.sellingPrice,
    product.price,
    product.regular_price
  );
};

const comparePrice = (product = {}) => {
  const selling = activeSellingPrice(product);
  const compare = saleActive(product)
    ? numericPrice(product.regular_price, product.price)
    : numericPrice(
      product.storefront_compare_price,
      product.storefrontComparePrice,
      product.old_crossed_price,
      product.oldCrossedPrice,
      product.compare_at_price,
      product.compareAtPrice,
      product.old_price,
      product.oldPrice,
      product.original_price,
      product.originalPrice,
      product.custom_compare_price,
      product.customComparePrice,
      product.regular_price
    );
  return compare > selling ? compare : 0;
};

const resolveStoryPricing = (product = {}) => {
  const forced = storyPriceDebugForceEnabled();
  const currentPrice = forced ? 1500 : activeSellingPrice(product);
  const rawComparePrice = forced ? 2200 : comparePrice(product);
  const safeCurrentPrice = Number.isFinite(Number(currentPrice)) ? Number(currentPrice) : 0;
  const safeComparePrice = Number.isFinite(Number(rawComparePrice)) && Number(rawComparePrice) > safeCurrentPrice ? Number(rawComparePrice) : 0;

  console.debug("[story-pricing-debug]", {
    product_id: product.id ?? product.product_id ?? null,
    product_name: product.name ?? product.product_name ?? "",
    currentPrice: safeCurrentPrice,
    comparePrice: safeComparePrice,
    rawComparePrice,
    forced,
    regular_price: product.regular_price,
    regularPrice: product.regularPrice,
    sale_price: product.sale_price,
    salePrice: product.salePrice,
    sale_price_enabled: product.sale_price_enabled,
    compare_at_price: product.compare_at_price,
    compareAtPrice: product.compareAtPrice,
    old_price: product.old_price,
    oldPrice: product.oldPrice,
    original_price: product.original_price,
    originalPrice: product.originalPrice,
    custom_compare_price: product.custom_compare_price,
    storefront_price: product.storefront_price,
    storefrontPrice: product.storefrontPrice,
    storefront_adjusted_price: product.storefront_adjusted_price,
    storefrontAdjustedPrice: product.storefrontAdjustedPrice,
    storefront_compare_price: product.storefront_compare_price,
    storefrontComparePrice: product.storefrontComparePrice,
    adjusted_price: product.adjusted_price,
    adjustedPrice: product.adjustedPrice,
    final_price: product.final_price,
    finalPrice: product.finalPrice,
    price: product.price,
  });

  return { currentPrice: safeCurrentPrice, comparePrice: safeComparePrice };
};

const arabicSlug = (value = "") =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 42);

const compactSlug = (value = "") =>
  arabicSlug(value)
    .replace(/\b(sneakers?|shoes?|running|casual|fashion|men|women|kids|for)\b/gi, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 14);

const shortProductUrl = (product = {}, campaign = {}) => {
  const rawSlug = String(product.slug || campaign.product_slug || "").trim();
  const sourceTitle = cleanProductTitle(product.name || campaign.product_name || campaign.title || "product");
  const slug = compactSlug(rawSlug) || compactSlug(sourceTitle) || String(product.id || campaign.product_id || "item").slice(0, 8);
  return `m1.ly/${slug}`.slice(0, 22);
};

const normalizeArabicCopy = (value = "", fallback = "") => {
  const copy = String(value || "").trim();
  if (!copy) return fallback;
  const replacements = [
    [/just landed/gi, "وصل حديثًا"],
    [/is almost gone/gi, "آخر القطع المتوفرة"],
    [/only 1 piece left/gi, "آخر قطعة متاحة"],
    [/only (\d+) left/gi, "متبقي $1 قطع فقط"],
    [/limited drop/gi, "كمية محدودة"],
    [/starts from/gi, "السعر يبدأ من"],
    [/customer favorite/gi, "الأكثر طلبًا"],
    [/ready to get it\?/gi, "جاهز تطلبه؟"],
    [/shop now/gi, "تسوق الآن"],
    [/order now/gi, "اطلب الآن"],
    [/dm now/gi, "اطلب عبر الرسائل"],
    [/hot/gi, "HOT"],
    [/new/gi, "جديد"],
    [/featured/gi, "مختار"],
    [/last piece/gi, "آخر قطعة"],
    [/low stock/gi, "كمية محدودة"],
  ];
  return replacements.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), copy);
};

const hasArabic = (value = "") => /[\u0600-\u06FF]/.test(String(value || ""));

const GENERIC_HOOK_PATTERNS = [
  /اختيار\s+(فاخر|مميز)?\s*يلفت\s+النظر/i,
  /منتج\s+فاخر\s+يلفت\s+النظر/i,
  /إطلالة\s+تخطف\s+الأنظار/i,
  /اختيار\s+لا\s+يفوت/i,
  /تفاصيل\s+أنيقة\s+بدون\s+مبالغة/i,
  /يلفت\s+النظر/i,
];

const USEFUL_HOOK_PATTERNS = [
  /آخر|المتوفرة|متبقي|محدودة|نفاد|وصل|حديث|عرض|خصم|وفر|الأكثر|طلب/i,
  /last|limited|new|sale|discount|hot|trending|stock|piece/i,
];

const isUsefulHook = (value = "") => {
  const text = normalizeArabicCopy(value, "").trim();
  if (!text || GENERIC_HOOK_PATTERNS.some((pattern) => pattern.test(text))) return false;
  return USEFUL_HOOK_PATTERNS.some((pattern) => pattern.test(text));
};

const cleanProductTitle = (value = "") => {
  const cleaned = String(value || "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\b(for\s+(men|women|kids|boys|girls|unisex|male|female)|mens|women'?s|kids'?|boys'?|girls'?)\b/gi, " ")
    .replace(/\b(sneakers?|shoes?|shoe|running|casual|fashion|original|premium|high\s*quality|new\s*arrival|latest|202\d|size\s*\d+)\b/gi, " ")
    // \b cannot match at the edge of an Arabic word, so this line stripped nothing and
    // Arabic product names kept the filler words the story title is meant to drop.
    .replace(/(?<![\p{L}\p{N}])(?:حذاء|كوتشي|رجالي|حريمي|اطفال|أطفال|اصلي|أصلي|جديد)(?![\p{L}\p{N}])/giu, " ")
    .replace(/[|/_,]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const compact = cleaned.split(" ").filter(Boolean).slice(0, 4).join(" ");
  return compact || String(value || "").trim() || "Featured Product";
};

const productTitleClass = (title = "", template = {}) => {
  const color = isLightTemplate(template) ? "text-slate-950" : "text-white";
  const length = String(title || "").length;
  if (length > 34) return `text-[1.48rem] leading-[1.04] font-black ${color}`;
  if (length > 24) return `text-[1.72rem] leading-[1.04] font-black ${color}`;
  return `${template.typography.headline} ${color}`;
};

const commercialHook = (story = {}, template = {}, product = {}) => {
  const generated = String(story?.headline || "").trim();
  const productName = String(product.name || "").trim();
  if (hasArabic(generated) && (!productName || !generated.includes(productName))) return isUsefulHook(generated) ? normalizeArabicCopy(generated, "") : "";
  if (story?.type === "cta") return "";
  if (hasArabic(generated) && (!productName || !generated.includes(productName))) {
    return normalizeArabicCopy(generated, template.commercial?.hook || "اختيار يلفت النظر");
  }
  if (story?.type === "urgency" || story?.type === "social_proof" || story?.type === "cta") return "";
  if (!isUsefulHook(template.commercial?.hook)) return "";
  return template.commercial?.hook || "اختيار يلفت النظر";
};

const storyBadgeText = () => {
  return "NEW COLLECTION";
};

const legacyStoryBadgeText = (story = {}, template = {}, product = {}) => {
  const lastPieceVariants = Array.isArray(product.lastPieceVariants) ? product.lastPieceVariants : [];
  if (lastPieceVariants.length === 1) return "Last piece";
  if (lastPieceVariants.length > 1) return `Last ${lastPieceVariants.length} pieces`;
  const stickers = Array.isArray(story.stickers) ? story.stickers : [];
  const first = stickers[0] || template.commercial?.badge;
  if (comparePrice(product) > activeSellingPrice(product)) return "عرض";
  return normalizeArabicCopy(first, template.commercial?.badge || "جديد");
};

const ctaText = () => "View details";

const benefitChips = (product = {}) => {
  const stock = Number(product.stock || product.total_stock || product.quantity || 0);
  const chips = [
    stock === 1 ? "آخر قطعة" : stock > 1 && stock <= 3 ? "قطع محدودة" : "",
    "خامة premium",
    "تصميم مميز",
    "راحة طوال اليوم",
    "الأكثر طلبًا",
  ].filter(Boolean);
  return [...new Set(chips)].slice(0, 4);
};

const isLightTemplate = (template = {}) => template.id === "minimal_fashion";

const StoryTemplateEngine = ({ template, children }) => (
  <div className={`relative h-full overflow-hidden rounded-[2rem] bg-gradient-to-br ${template.background.value}`}>
    <motion.div
      aria-hidden="true"
      className="absolute inset-0 opacity-55"
      animate={{ backgroundPosition: ["0% 0%", "100% 80%", "0% 0%"] }}
      transition={{ duration: 16, repeat: Infinity, ease: "easeInOut" }}
      style={{
        backgroundImage: "radial-gradient(circle at 24% 18%, rgba(255,255,255,.16), transparent 24%), radial-gradient(circle at 82% 64%, rgba(251,191,36,.16), transparent 26%)",
        backgroundSize: "145% 145%",
      }}
    />
    {template.effects.vignette ? <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_44%,rgba(0,0,0,.72))]" /> : null}
    {template.effects.glow ? <div className="absolute -right-20 top-32 h-64 w-64 rounded-full bg-white/10 blur-3xl" /> : null}
    <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/70 via-black/15 to-transparent" />
    {children}
  </div>
);

export function StoryBadge({ story, template, product }) {
  return (
    <motion.div
      className={`inline-flex max-w-full w-fit rounded-full border px-4 py-1.5 text-[12px] font-black leading-4 shadow-xl ${accentClasses[template.accent] || accentClasses.cyan}`}
      animate={{ scale: [1, 1.04, 1] }}
      transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
    >
      <span className="line-clamp-2 break-words [overflow-wrap:anywhere]">{storyBadgeText(story, template, product)}</span>
    </motion.div>
  );
}

export function StoryHero({ campaign, story, template, product }) {
  const light = isLightTemplate(template);
  const rawProductTitle = product.name || campaign?.product_name || campaign?.title || "Featured Product";
  const displayProductName = cleanProductTitle(rawProductTitle);
  const displayHook = commercialHook(story, template, { ...product, name: rawProductTitle });
  const safeHook = isUsefulHook(displayHook) ? displayHook : "";
  const productName = product.name || campaign?.product_name || campaign?.title || "منتج مختار";
  return (
    <div className="flex min-h-[142px] max-h-[166px] shrink-0 flex-col justify-start gap-3 overflow-hidden text-right">
      <StoryBadge story={story} template={template} product={product} />
      <div className="min-h-0 space-y-2">
        {safeHook ? <p className={`line-clamp-2 text-[13px] font-black leading-5 ${light ? "text-slate-700" : "text-white/78"}`}>{safeHook}</p> : null}
        <h3 className={`m1-section-title ${productTitleClass(displayProductName, template)} line-clamp-2 max-w-full text-left [overflow-wrap:anywhere]`} dir="ltr" title={productName}>
          {displayProductName}
        </h3>
      </div>
    </div>
  );
}

export function StoryProductVisual({ campaign, product, animationName }) {
  const productImage = product.image_url || campaign?.product_image || campaign?.image_url || "";
  return (
    <motion.div
      className="relative mx-auto flex min-h-0 w-full flex-[0_0_43%] items-center justify-center py-0"
      animate={animationName === "floating" ? { y: [0, -12, 0] } : animationName === "slow_zoom" ? { scale: [1, 1.035, 1] } : { y: [0, -7, 0] }}
      transition={{ duration: 4.5, repeat: Infinity, ease: "easeInOut" }}
    >
      <div aria-hidden="true" className="absolute h-64 w-64 rounded-full bg-white/12 blur-3xl" />
      <div aria-hidden="true" className="absolute h-72 w-72 rounded-full bg-amber-300/10 blur-[72px]" />
      <div aria-hidden="true" className="absolute bottom-2 h-10 w-60 rounded-full bg-black/55 blur-2xl" />
      <div aria-hidden="true" className="absolute bottom-5 h-20 w-72 rounded-[50%] bg-white/12 blur-xl [transform:perspective(380px)_rotateX(68deg)]" />
      {productImage ? (
        <img
          crossOrigin="anonymous"
          src={productImage}
          alt={product.name || campaign?.product_name || campaign?.title || "Product"}
          className="relative z-10 max-h-full max-w-[94%] rounded-[1.8rem] object-contain drop-shadow-[0_36px_34px_rgba(0,0,0,.68)]"
        />
      ) : (
        <div className="relative z-10 flex h-72 w-52 items-center justify-center rounded-[2rem] border border-dashed border-white/20 bg-white/10 text-sm font-black text-white/70 backdrop-blur">
          صورة المنتج
        </div>
      )}
    </motion.div>
  );
}

export function StoryPricing({ product, template }) {
  const { t } = useTranslation();
  const { currentPrice: selling, comparePrice: compare } = resolveStoryPricing(product);
  const saving = compare > selling ? compare - selling : 0;
  const percent = compare > selling ? Math.max(1, Math.round(((compare - selling) / compare) * 100)) : 0;
  const light = isLightTemplate(template);
  if (!selling) {
    return <div className={`text-lg font-black ${light ? "text-slate-950" : "text-white"}`}>{t("marketing.story.preview.priceOnRequest")}</div>;
  }
  return (
    <motion.div className="min-w-0 text-left" dir="ltr" animate={{ scale: [1, 1.018, 1] }} transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}>
      {compare ? <div className={`mb-1 text-[13px] font-black line-through ${light ? "text-slate-400" : "text-white/42"}`}>{formatCurrency(compare)}</div> : null}
      <div className={`text-[2.55rem] font-black leading-none tracking-normal ${light ? "text-slate-950" : "text-white"}`}>{formatCurrency(selling)}</div>
      {saving ? (
        <div dir="rtl" className={`mt-2 inline-flex rounded-full px-3.5 py-1.5 text-[11px] font-black shadow-lg ${light ? "bg-rose-600 text-white" : "bg-white text-slate-950"}`}>
          {percent ? `خصم ${percent}%` : `وفر ${formatCurrency(saving).replace("EGP", "جنيه")}`}
        </div>
      ) : null}
    </motion.div>
  );
}

export function StoryVariantChips({ product, template }) {
  const availableSizes = Array.isArray(product.available_sizes) ? product.available_sizes.map((item) => String(item || "").trim()).filter(Boolean) : [];
  const explicitSizesLabel = String(product.sizes_label || "").trim();
  const sizesLabel = explicitSizesLabel.replace(/^sizes\s*:/i, "AVAILABLE SIZES:") || (availableSizes.length ? `AVAILABLE SIZES: ${availableSizes.join(", ")}` : "");
  const light = isLightTemplate(template);
  if (sizesLabel) {
    return (
      <div className="flex max-h-12 flex-wrap justify-center gap-1.5 overflow-hidden">
        <span className={`max-w-full rounded-full border px-2.5 py-1 text-[10px] font-black leading-4 ${light ? "border-slate-950/10 bg-slate-950/5 text-slate-800" : "border-amber-200/20 bg-amber-300/12 text-amber-100"}`}>
          {sizesLabel}
        </span>
      </div>
    );
  }
  return null;
}

export function StoryCTA({ story, template, product, campaign }) {
  const ctaUrl = storyCtaUrl(story, product, campaign);
  return (
    <motion.a
      href={ctaUrl || undefined}
      target="_blank"
      rel="noreferrer"
      aria-disabled={!ctaUrl}
      onClick={(event) => {
        if (!ctaUrl) event.preventDefault();
      }}
      className="relative flex min-h-14 min-w-[154px] items-center justify-center overflow-hidden rounded-full border border-white/45 bg-gradient-to-br from-red-600 via-rose-600 to-red-800 px-8 py-4 text-center text-[16px] font-black text-white shadow-[0_0_26px_rgba(239,68,68,.32),0_18px_34px_rgba(69,10,10,.42)] ring-1 ring-white/25"
      animate={{ y: [0, -2, 0], boxShadow: ["0 18px 38px rgba(0,0,0,.28)", "0 22px 46px rgba(255,255,255,.18)", "0 18px 38px rgba(0,0,0,.28)"] }}
      transition={{ duration: 2.8, repeat: Infinity, ease: "easeInOut" }}
    >
      <motion.span aria-hidden="true" className="absolute inset-y-0 -left-10 w-8 rotate-12 bg-white/35 blur-sm" animate={{ x: ["0%", "780%"] }} transition={{ duration: 3.4, repeat: Infinity, ease: "easeInOut" }} />
      <span className="relative z-10">{ctaText(story, template)}</span>
    </motion.a>
  );
}

export function StoryFooterLink({ product, campaign, template }) {
  return (
    <div className={`truncate text-center text-[12px] font-black tracking-normal ${isLightTemplate(template) ? "text-slate-600" : "text-white/72"}`} dir="ltr">
      Available now
    </div>
  );
}

export function StoryRenderer({ campaign, story, template, activeKey, product: productProp }) {
  const product = {
    ...(campaign?.design_json || {}),
    ...(campaign || {}),
    ...(story || {}),
    ...(productProp || {}),
  };
  const animationName = normalizeAnimation(story?.animation_hint, template.animations.default);
  const variants = animationVariants[animationName] || animationVariants.fade_in;
  const light = isLightTemplate(template);
  const bullets = [];

  return (
    <StoryTemplateEngine template={template}>
      <AnimatePresence mode="wait">
        <motion.div
          key={activeKey}
          dir="rtl"
          className="relative z-10 flex h-full flex-col gap-2 px-5 pb-5 pt-8 text-right font-['Cairo','IBM_Plex_Sans_Arabic','Segoe_UI',sans-serif]"
          initial={variants.initial}
          animate={variants.animate}
          exit={variants.exit}
          transition={{ duration: animationName === "shake_urgency" ? 0.65 : 0.82, ease: "easeOut" }}
        >
          <StoryHero campaign={campaign} story={story} template={template} product={product} />
          <StoryProductVisual campaign={campaign} product={product} animationName={animationName} />
          <div className="flex min-h-0 flex-[0_0_31%] flex-col justify-end gap-2.5">
            {bullets.length ? (
              <div className="flex flex-wrap justify-center gap-2">
                {bullets.map((bullet) => (
                  <div key={bullet} className="flex items-center gap-1.5 rounded-full border border-white/10 bg-black/24 px-3 py-1.5 text-[11px] font-black leading-4 text-white/72 shadow-lg backdrop-blur-xl">
                    <span className="h-1 w-1 shrink-0 rounded-full bg-white/60" />
                    <span className="line-clamp-1">{bullet}</span>
                  </div>
                ))}
              </div>
            ) : null}
            <StoryVariantChips product={product} template={template} />
            <div className={`rounded-[1.6rem] border p-3.5 shadow-2xl backdrop-blur-xl ${light ? "border-slate-950/10 bg-white/82" : "border-white/10 bg-black/32"}`}>
              <div className="flex items-center justify-between gap-3">
                <StoryPricing product={product} template={template} />
                <StoryCTA story={story} template={template} product={product} campaign={campaign} />
              </div>
              <div className="mt-2">
                <StoryFooterLink product={product} campaign={campaign} template={template} />
              </div>
            </div>
          </div>
        </motion.div>
      </AnimatePresence>
    </StoryTemplateEngine>
  );
}

export function StoryControls({ playing, onTogglePlay, onPrevious, onNext, onRestart, onFullscreen }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      <button type="button" onClick={onPrevious} className="rounded-full border border-white/10 bg-white/5 p-3 text-white transition hover:bg-white/10" aria-label={t("marketing.story.preview.previous")}>
        <SkipBack className="h-4 w-4" />
      </button>
      <button type="button" onClick={onTogglePlay} className="rounded-full border border-primary/30 bg-primary/15 p-3 text-primary transition hover:bg-primary/25" aria-label={playing ? t("marketing.story.preview.pause") : t("marketing.story.preview.play")}>
        {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
      </button>
      <button type="button" onClick={onNext} className="rounded-full border border-white/10 bg-white/5 p-3 text-white transition hover:bg-white/10" aria-label={t("marketing.story.preview.next")}>
        <SkipForward className="h-4 w-4" />
      </button>
      <button type="button" onClick={onRestart} className="rounded-full border border-white/10 bg-white/5 p-3 text-white transition hover:bg-white/10" aria-label={t("marketing.story.preview.restart")}>
        <RotateCcw className="h-4 w-4" />
      </button>
      <button type="button" onClick={onFullscreen} className="rounded-full border border-white/10 bg-white/5 p-3 text-white transition hover:bg-white/10" aria-label={t("marketing.story.preview.fullscreen")}>
        <Maximize2 className="h-4 w-4" />
      </button>
    </div>
  );
}

export function StoryTimeline({ stories = [], currentIndex, onSelect }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
      {stories.map((story, index) => (
        <button
          key={`${story.position}-${story.type}`}
          type="button"
          onClick={() => onSelect(index)}
          className={`flex w-full items-center gap-3 rounded-[var(--radius-control)] border px-3 py-2 text-right transition ${ index === currentIndex ? "border-primary/35 bg-primary/10 text-primary" : "border-white/10 bg-white/[0.03] text-slate-300 hover:bg-white/[0.07]" }`}
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-black">{story.position || index + 1}</span>
          <span className="min-w-0">
            <span className="block text-xs font-black">{normalizeArabicCopy(story.type || "قصة", "قصة").replaceAll("_", " ")}</span>
            <span className="block truncate text-xs opacity-70" dir="rtl">{normalizeArabicCopy(story.headline)}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

export function StoryPlayer({
  campaign,
  templateId,
  onTemplateChange,
  onEditStory,
  onRegenerateStory,
  product,
  mode = "full",
  currentIndex: controlledCurrentIndex,
  onCurrentIndexChange,
  storyFrameRefs,
}) {
  const { t } = useTranslation();
  const stories = campaign?.stories_json || [];
  const [internalCurrentIndex, setInternalCurrentIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const internalExportFrameRefs = useRef([]);
  const exportFrameRefs = storyFrameRefs || internalExportFrameRefs;
  const template = useMemo(() => getStoryTemplate(templateId), [templateId]);
  const isControlled = controlledCurrentIndex !== undefined;
  const currentIndex = controlledCurrentIndex ?? internalCurrentIndex;
  const currentIndexRef = useRef(currentIndex);
  const currentStory = stories[currentIndex] || stories[0] || null;
  const resolvedProduct = product || campaign || {};
  const previewOnly = mode === "previewOnly";

  useEffect(() => {
    currentIndexRef.current = currentIndex;
  }, [currentIndex]);

  const setPlayerIndex = useCallback((nextValue) => {
    const maxIndex = Math.max(stories.length - 1, 0);
    const rawNext = typeof nextValue === "function" ? nextValue(currentIndexRef.current) : nextValue;
    const next = Math.max(0, Math.min(maxIndex, rawNext));
    if (!isControlled) setInternalCurrentIndex(next);
    onCurrentIndexChange?.(next);
  }, [isControlled, onCurrentIndexChange, stories.length]);

  useEffect(() => {
    setPlayerIndex(0);
    setPlaying(false);
    setTimelineOpen(false);
  }, [campaign?.id, setPlayerIndex]);

  useEffect(() => {
    if (!playing || stories.length <= 1) return undefined;
    const timer = setInterval(() => {
      setPlayerIndex((current) => (current + 1) % stories.length);
    }, 4200);
    return () => clearInterval(timer);
  }, [playing, setPlayerIndex, stories.length]);

  useEffect(() => {
    const handleKey = (event) => {
      if (!stories.length) return;
      if (event.key === "ArrowRight") setPlayerIndex((current) => (current + 1) % stories.length);
      if (event.key === "ArrowLeft") setPlayerIndex((current) => (current - 1 + stories.length) % stories.length);
      if (event.key === " ") {
        event.preventDefault();
        setPlaying((current) => !current);
      }
      if (event.key === "Escape") setFullscreen(false);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [setPlayerIndex, stories.length]);

  const goNext = () => setPlayerIndex((current) => (current + 1) % Math.max(stories.length, 1));
  const goPrevious = () => setPlayerIndex((current) => (current - 1 + Math.max(stories.length, 1)) % Math.max(stories.length, 1));
  const restart = () => {
    setPlayerIndex(0);
    setPlaying(true);
  };

  if (!campaign || !currentStory) {
    return (
      <div className="rounded-3xl border border-dashed border-white/10 bg-slate-950/50 p-6 text-center text-sm text-slate-400">
        {t("marketing.story.preview.empty")}
      </div>
    );
  }

  const storyViewport = (
    <div className="relative aspect-[9/16] overflow-hidden rounded-[2rem]">
      <div className="absolute left-4 right-4 top-3 z-20 flex gap-1.5">
        {stories.map((storyItem, index) => (
          <div key={`${storyItem.position}-${index}`} className="h-1 flex-1 overflow-hidden rounded-full bg-white/25">
            <motion.div
              className="h-full rounded-full bg-white"
              initial={false}
              animate={{ width: index < currentIndex ? "100%" : index === currentIndex && playing ? "100%" : index === currentIndex ? "35%" : "0%" }}
              transition={{ duration: index === currentIndex && playing ? 4.2 : 0.25, ease: "linear" }}
            />
          </div>
        ))}
      </div>
      <button type="button" className="absolute left-0 top-0 z-20 h-[58%] w-1/3" onClick={goPrevious} aria-label={t("marketing.story.preview.previous")} />
      <button type="button" className="absolute right-0 top-0 z-20 h-[58%] w-1/3" onClick={goNext} aria-label={t("marketing.story.preview.next")} />
      <StoryRenderer campaign={campaign} story={currentStory} template={template} activeKey={`${campaign.id}-${currentIndex}-${template.id}`} product={resolvedProduct} />
    </div>
  );

  const player = previewOnly ? (
    <div className="h-full w-full">
      {storyViewport}
    </div>
  ) : (
    <div className="mx-auto w-full max-w-[430px]">
      <div className={`${previewOnly ? "rounded-[3rem] p-3 shadow-[0_42px_120px_rgba(0,0,0,0.72)]" : "rounded-[2.4rem] p-2.5 shadow-2xl shadow-black/50"} border border-white/10 bg-black`}>
        {storyViewport}
      </div>
    </div>
  );

  const exportFrames = (
    <div className="pointer-events-none fixed -left-[10000px] top-0" aria-hidden="true">
      {stories.map((storyItem, index) => (
        <div key={`export-${storyItem.position}-${template.id}`} className="h-[960px] w-[540px] bg-slate-950">
          <div
            ref={(node) => {
              exportFrameRefs.current[index] = node;
            }}
            className="h-full w-full overflow-hidden bg-slate-950"
          >
            <StoryRenderer campaign={campaign} story={storyItem} template={template} activeKey={`export-${campaign.id}-${index}-${template.id}`} product={resolvedProduct} />
          </div>
        </div>
      ))}
    </div>
  );

  const fullscreenOverlay = (
    <AnimatePresence>
      {fullscreen ? (
        <motion.div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4 backdrop-blur-xl" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <button type="button" onClick={() => setFullscreen(false)} className="absolute right-5 top-5 rounded-full border border-white/10 bg-white/10 px-4 py-2 text-sm font-black text-white">
            {t("marketing.common.close")}
          </button>
          <div className="w-full max-w-[460px]">{player}</div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );

  if (previewOnly) {
    return (
      <div className="h-full">
        {player}
        {exportFrames}
        {fullscreenOverlay}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-4">
          <div className="flex flex-col gap-3 rounded-3xl border border-white/10 bg-slate-950/50 p-4 lg:flex-row lg:items-center lg:justify-between">
            <label className="space-y-2">
              <span className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">{t("marketing.story.preview.template")}</span>
              <select value={template.id} onChange={(event) => onTemplateChange(event.target.value)} className="w-full rounded-[var(--radius-control)] border border-white/10 bg-slate-950/80 px-4 py-3 text-sm text-white outline-none">
                {STORY_TEMPLATES.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
            <StoryControls playing={playing} onTogglePlay={() => setPlaying((current) => !current)} onPrevious={goPrevious} onNext={goNext} onRestart={restart} onFullscreen={() => setFullscreen(true)} />
          </div>
          {player}
          <div className="flex flex-wrap justify-center gap-2">
            <button type="button" onClick={() => onRegenerateStory(currentStory)} className="inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-white/10 bg-white/5 px-4 py-3 text-xs font-black text-white transition hover:bg-white/10">
              <RefreshCcw className="h-4 w-4" />
              {t("marketing.story.preview.regenerate")}
            </button>
            <button type="button" onClick={() => onEditStory(currentStory)} className="rounded-[var(--radius-control)] border border-white/10 bg-white/5 px-4 py-3 text-xs font-black text-white transition hover:bg-white/10">
              {t("marketing.story.preview.edit")}
            </button>
          </div>
        </div>
        <aside className="space-y-4">
          <div className="rounded-3xl border border-white/10 bg-slate-950/50 p-4">
            <button type="button" onClick={() => setTimelineOpen((value) => !value)} className="flex w-full items-center justify-between gap-3 text-left">
              <span>
                <span className="block text-sm font-black text-white">{t("marketing.story.preview.singleMode")}</span>
                <span className="mt-1 block text-xs text-slate-400">{t("marketing.story.preview.framesAvailable", { count: stories.length })}</span>
              </span>
              {timelineOpen ? <ChevronUp className="h-4 w-4 text-slate-300" /> : <ChevronDown className="h-4 w-4 text-slate-300" />}
            </button>
            {timelineOpen ? (
              <div className="mt-4">
                <StoryTimeline stories={stories} currentIndex={currentIndex} onSelect={setPlayerIndex} />
              </div>
            ) : null}
          </div>
          <StoryExportControls campaign={campaign} templateId={template.id} currentIndex={currentIndex} storyFrameRefs={exportFrameRefs} />
        </aside>
      </div>

      {exportFrames}
      {fullscreenOverlay}
    </div>
  );
}
