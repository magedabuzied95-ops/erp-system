export const STORY_TEMPLATES = [
  {
    id: "luxury_dark",
    name: "Luxury",
    background: { type: "gradient", value: "from-[#050505] via-[#12100b] to-[#211707]" },
    typography: { headline: "text-[2.35rem] font-black leading-[1.05]", subtext: "text-[0.95rem] text-amber-50/82", cta: "glass button" },
    layout: { density: "cinematic", productScale: "large", pricingTone: "champagne" },
    effects: { glassmorphism: true, glow: true, vignette: true },
    animations: { default: "slow_zoom" },
    mood: "إعلان فاخر بلمعة شامبين وظلال سينمائية",
    accent: "amber",
    commercial: { badge: "جديد", hook: "اختيار فاخر يلفت النظر", cta: "View details" },
  },
  {
    id: "sale_commercial",
    name: "Sale",
    background: { type: "gradient", value: "from-[#230706] via-[#6f1212] to-[#0c0505]" },
    typography: { headline: "text-[2.45rem] font-black leading-[1.02]", subtext: "text-[0.95rem] text-red-50/85", cta: "high contrast button" },
    layout: { density: "urgent", productScale: "large", pricingTone: "sale" },
    effects: { glassmorphism: true, glow: true, vignette: true },
    animations: { default: "pulse" },
    mood: "عرض واضح بسعر قوي وحركة شراء سريعة",
    accent: "rose",
    commercial: { badge: "عرض", hook: "وفرها قبل انتهاء العرض", cta: "View details" },
  },
  {
    id: "last_piece",
    name: "Last Piece",
    background: { type: "gradient", value: "from-[#130f08] via-[#3b2107] to-black" },
    typography: { headline: "text-[2.3rem] font-black leading-[1.05]", subtext: "text-[0.95rem] text-orange-50/84", cta: "urgent button" },
    layout: { density: "urgent", productScale: "large", pricingTone: "amber" },
    effects: { glassmorphism: true, glow: true, vignette: true },
    animations: { default: "shake_urgency" },
    mood: "ندرة ومخزون محدود مع دعوة شراء مباشرة",
    accent: "amber",
    commercial: { badge: "آخر قطعة", hook: "اطلبه الآن قبل النفاد", cta: "View details" },
  },
  {
    id: "new_arrival",
    name: "New Arrival",
    background: { type: "gradient", value: "from-[#07150f] via-[#123728] to-[#030806]" },
    typography: { headline: "text-[2.35rem] font-black leading-[1.05]", subtext: "text-[0.95rem] text-emerald-50/85", cta: "fresh button" },
    layout: { density: "cinematic", productScale: "large", pricingTone: "emerald" },
    effects: { glassmorphism: true, glow: true, vignette: true },
    animations: { default: "slide_up" },
    mood: "وصول جديد بتقديم نظيف وسريع للبيع",
    accent: "emerald",
    commercial: { badge: "وصل حديثًا", hook: "أول ظهور في المتجر", cta: "View details" },
  },
  {
    id: "sneakers_streetwear",
    name: "Streetwear",
    background: { type: "gradient", value: "from-zinc-950 via-indigo-950 to-black" },
    typography: { headline: "text-[2.35rem] font-black leading-[1.04]", subtext: "text-[0.95rem] text-indigo-100/85", cta: "streetwear pill" },
    layout: { density: "kinetic", productScale: "large", pricingTone: "cyan" },
    effects: { glassmorphism: true, glow: true, vignette: true },
    animations: { default: "floating" },
    mood: "ستايل شارع وحركة خفيفة تبرز المنتج",
    accent: "cyan",
    commercial: { badge: "HOT", hook: "الأكثر طلبًا هذا الأسبوع", cta: "View details" },
  },
  {
    id: "minimal_fashion",
    name: "Minimal Fashion",
    background: { type: "gradient", value: "from-slate-100 via-white to-stone-200" },
    typography: { headline: "text-[2.2rem] font-black leading-[1.06]", subtext: "text-[0.95rem] text-slate-700", cta: "solid clean button" },
    layout: { density: "editorial", productScale: "large", pricingTone: "slate" },
    effects: { glassmorphism: false, glow: false, vignette: false },
    animations: { default: "fade_in" },
    mood: "موضة بسيطة بمساحات نظيفة وتركيز على السعر",
    accent: "slate",
    commercial: { badge: "مختار", hook: "تفاصيل أنيقة بدون مبالغة", cta: "View details" },
  },
];

export const accentClasses = {
  amber: "border-amber-300/30 bg-amber-300/15 text-amber-50 shadow-amber-500/30",
  slate: "border-slate-900/10 bg-slate-950 text-white shadow-slate-900/20",
  rose: "border-rose-300/30 bg-rose-400/20 text-rose-50 shadow-rose-500/30",
  cyan: "border-cyan-300/30 bg-cyan-300/15 text-cyan-50 shadow-cyan-500/30",
  fuchsia: "border-fuchsia-300/30 bg-fuchsia-300/15 text-fuchsia-50 shadow-fuchsia-500/30",
  emerald: "border-emerald-300/30 bg-emerald-300/15 text-emerald-50 shadow-emerald-500/30",
};

export const animationVariants = {
  slow_zoom: { initial: { opacity: 0, scale: 0.96 }, animate: { opacity: 1, scale: 1 }, exit: { opacity: 0, scale: 1.04 } },
  pulse: { initial: { opacity: 0, scale: 0.94 }, animate: { opacity: 1, scale: [1, 1.03, 1] }, exit: { opacity: 0, scale: 0.98 } },
  fade_in: { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } },
  slide_up: { initial: { opacity: 0, y: 36 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -24 } },
  floating: { initial: { opacity: 0, y: 18 }, animate: { opacity: 1, y: [0, -8, 0] }, exit: { opacity: 0, y: 18 } },
  shake_urgency: { initial: { opacity: 0, rotate: -1 }, animate: { opacity: 1, rotate: [0, -1, 1, 0] }, exit: { opacity: 0, rotate: 1 } },
};

export const normalizeAnimation = (hint, fallback) => {
  const normalized = String(hint || fallback || "fade_in").toLowerCase().replaceAll(" ", "_").replace("effect", "").trim();
  if (normalized.includes("pulse")) return "pulse";
  if (normalized.includes("slide")) return "slide_up";
  if (normalized.includes("float")) return "floating";
  if (normalized.includes("shake") || normalized.includes("urgency")) return "shake_urgency";
  if (normalized.includes("zoom")) return "slow_zoom";
  if (normalized.includes("fade")) return "fade_in";
  return fallback || "fade_in";
};

export const getStoryTemplate = (templateId) => STORY_TEMPLATES.find((template) => template.id === templateId) || STORY_TEMPLATES[0];
