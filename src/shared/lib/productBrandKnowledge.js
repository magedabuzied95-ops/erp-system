/* What each brand — and a few of its best-known lines — is known for, written
 * as design language rather than lab claims. The description writer hands the
 * matching entries to the model as reference ("use only what fits this
 * model"), and the local template builds its features from them when no model
 * answers. A line matches on the product name; a brand matches on the brand
 * field or the name. Add a brand by adding one object. */

const feature = (titleAr, detailAr, titleEn, detailEn) => ({ ar: { title: titleAr, detail: detailAr }, en: { title: titleEn, detail: detailEn } });

export const BRAND_KNOWLEDGE = [
  {
    brand: "Skechers",
    match: /skechers|سكيتشرز|سكتشرز/i,
    summary: {
      ar: "Skechers معروفة بالراحة قبل أي حاجة: نعل داخلي Memory Foam، وزن خفيف، وأوجه قماش شبكي بتهوّي الرجل، وموديلات Slip-ins اللي بتتلبس من غير إيد.",
      en: "Skechers is known for comfort first: Memory Foam insoles, lightweight builds, breathable mesh and knit uppers, and hands-free Slip-ins models.",
    },
    features: [
      feature("نعل Memory Foam", "نعل داخلي بيتشكل على رجلك ويديك إحساس مريح طول اليوم.", "Memory Foam Insole", "A cushioned insole that moulds to your foot for all-day comfort."),
      feature("وزن خفيف", "خفيف في الرجل فمش هتحس بتقل حتى مع المشي الكتير.", "Lightweight Build", "Light on the foot, so long walks never feel heavy."),
      feature("وش بيهوّي", "قماش شبكي بيسمح للهوا يدخل ويحافظ على رجلك مرتاحة.", "Breathable Upper", "A mesh upper that lets air through and keeps feet cool."),
    ],
    lines: [
      {
        match: /slip[\s-]?ins?/i,
        summary: {
          ar: "Slip-ins: كعب مصمم بيخليك تلبسه وتقلعه من غير ما توطي أو تستخدم إيدك.",
          en: "Slip-ins: a moulded heel that lets you step in and out without bending down or using your hands.",
        },
        features: [feature("تصميم Slip-ins", "تلبسه وتقلعه في ثانية من غير رباط ومن غير ما تستخدم إيدك.", "Slip-ins Design", "Step in and go in seconds, no laces and no hands needed.")],
      },
      {
        match: /go\s?walk/i,
        summary: { ar: "GOwalk: خط المشي عند Skechers، نعل مرن وخفيف جدًا.", en: "GOwalk: Skechers' walking line, with a very light, flexible sole." },
        features: [feature("نعل مرن", "نعل بيتني مع حركة رجلك فالمشي يبقى طبيعي وسهل.", "Flexible Sole", "A sole that bends with every step for a natural stride.")],
      },
    ],
  },
  {
    brand: "Nike",
    match: /\bnike\b|نايكي|نايك/i,
    summary: {
      ar: "Nike معروفة بشعار Swoosh وتصميمات أيقونية بتجمع بين الستايل الرياضي والشارع، ووسادات Air في النعل في أغلب موديلاتها.",
      en: "Nike is known for the Swoosh and iconic designs that bridge sport and street style, with Air cushioning across many of its models.",
    },
    features: [
      feature("تصميم أيقوني", "شكل Nike المعروف بشعار Swoosh اللي بيبان من أول نظرة.", "Iconic Design", "Nike's recognisable look with the Swoosh front and centre."),
      feature("نعل مريح", "نعل مبطن بيمتص الخبطات ويريّح الرجل في المشي.", "Cushioned Sole", "A cushioned sole that softens every step."),
      feature("ستايل شارع", "بيجمع بين روح الرياضة وشكل الشارع فيمشي مع لبس كتير.", "Street-Ready Style", "Sport heritage with a street look that suits many outfits."),
    ],
    lines: [
      {
        match: /air\s?force|af\s?1\b/i,
        summary: {
          ar: "Air Force 1: كلاسيك من 1982، وش جلد، نعل سميك بخط مميز، ووسادة Air مخفية في النعل.",
          en: "Air Force 1: a 1982 classic with a leather upper, a bold cupsole and hidden Air cushioning.",
        },
        features: [
          feature("وش جلد كلاسيك", "وش جلد بشكل نضيف بيفضل شيك مع أي لبس.", "Classic Leather Upper", "A clean leather upper that stays sharp with any outfit."),
          feature("نعل Air Force المميز", "نعل سميك بخط أيقوني ووسادة Air مخفية بتريّح الخطوة.", "Signature Cupsole", "A bold cupsole with hidden Air cushioning for a softer step."),
        ],
      },
      {
        match: /air\s?max/i,
        summary: { ar: "Air Max: وحدة Air ظاهرة في الكعب بتدي راحة وشكل مميز.", en: "Air Max: a visible Air unit in the heel for cushioning and a signature look." },
        features: [feature("وحدة Air ظاهرة", "وسادة Air باينة في الكعب بتدي خطوة ناعمة وشكل مميز.", "Visible Air Unit", "A visible heel Air unit for a soft step and a signature look.")],
      },
      {
        match: /jordan/i,
        summary: { ar: "Jordan: خط مايكل جوردان، تصميم باسكت أيقوني بخامات بريميوم.", en: "Jordan: Michael Jordan's line, iconic basketball design in premium materials." },
        features: [feature("روح الباسكت", "تصميم مستوحى من ملاعب الباسكت بشكل جريء ومميز.", "Basketball Heritage", "Court-inspired design with a bold, unmistakable profile.")],
      },
    ],
  },
  {
    brand: "Adidas",
    match: /adidas|اديداس|أديداس/i,
    summary: {
      ar: "Adidas معروفة بالتلات خطوط، وتصميمات كلاسيك زي Samba وStan Smith وGazelle، ونعل Cloudfoam وBoost المريح في الموديلات الحديثة.",
      en: "Adidas is known for the Three Stripes, classics such as Samba, Stan Smith and Gazelle, and comfortable Cloudfoam and Boost midsoles on modern models.",
    },
    features: [
      feature("التلات خطوط", "علامة Adidas المعروفة اللي بتدي الكوتشي شخصيته.", "Three Stripes", "Adidas' signature stripes that give the shoe its character."),
      feature("نعل مريح", "نعل ناعم بيمتص الخطوة ويريّحك في اللبس اليومي.", "Soft Midsole", "A soft midsole that cushions each step in daily wear."),
      feature("ستايل متعدد", "بيمشي مع اللبس الرياضي والكاجوال بنفس السهولة.", "Versatile Style", "Pairs as easily with sportswear as with casual looks."),
    ],
    lines: [
      {
        match: /samba|gazelle|campus|spezial/i,
        summary: { ar: "Samba / Gazelle / Campus: كلاسيك بوش شامواه أو جلد ونعل كاوتش.", en: "Samba / Gazelle / Campus: terrace classics in suede or leather with a gum rubber sole." },
        features: [feature("تصميم تيراس كلاسيك", "وش شامواه أو جلد بشكل ريترو رجع بقوة في الموضة.", "Terrace Classic", "A retro suede or leather silhouette that is back at the top of fashion.")],
      },
      {
        match: /stan\s?smith|superstar/i,
        summary: { ar: "Stan Smith / Superstar: وش جلد أبيض نضيف، تصميم تنس وباسكت كلاسيك.", en: "Stan Smith / Superstar: a clean white leather upper from tennis and basketball heritage." },
        features: [feature("جلد أبيض نضيف", "وش جلد بسيط بيفضل موضة مع كل ستايل.", "Clean Leather Upper", "A minimal leather upper that stays in style with everything.")],
      },
      {
        match: /ultra\s?boost|\bboost\b/i,
        summary: { ar: "Ultraboost: نعل Boost بيرجّع الطاقة مع كل خطوة ووش Primeknit مرن.", en: "Ultraboost: an energy-returning Boost midsole and a flexible Primeknit upper." },
        features: [feature("نعل Boost", "نعل بيرجّع جزء من طاقة الخطوة فالمشي يبقى أخف.", "Boost Midsole", "An energy-returning midsole that makes every step feel lighter.")],
      },
    ],
  },
  {
    brand: "Puma",
    match: /\bpuma\b|بوما/i,
    summary: { ar: "Puma معروفة بتصميمات رياضية عصرية وخط Formstrip الجانبي ونعل SoftFoam+ المريح.", en: "Puma is known for modern sport designs, the side Formstrip and a comfortable SoftFoam+ sockliner." },
    features: [
      feature("تصميم رياضي عصري", "خطوط جريئة وشكل رياضي بيناسب اللبس اليومي.", "Modern Sport Design", "Bold lines and a sporty shape made for everyday wear."),
      feature("نعل داخلي مريح", "نعل داخلي طري بيريّح الرجل مع كل خطوة.", "Soft Sockliner", "A soft sockliner that keeps every step comfortable."),
    ],
    lines: [],
  },
  {
    brand: "New Balance",
    match: /new\s?balance|نيو\s?بالانس/i,
    summary: { ar: "New Balance معروفة بالراحة والتصميم الريترو، خامات شامواه وشبك، وحرف N على الجنب، وموديلات زي 530 و550 و574 و9060.", en: "New Balance is known for comfort and retro design, suede and mesh uppers, the side N, and models such as 530, 550, 574 and 9060." },
    features: [
      feature("تصميم ريترو", "شكل مستوحى من كوتشيات الجري الكلاسيك بلمسة عصرية.", "Retro Design", "A silhouette drawn from classic runners with a modern touch."),
      feature("راحة مشهورة", "نعل مبطن بيديك الراحة اللي New Balance معروفة بيها.", "Signature Comfort", "A cushioned sole with the comfort New Balance is known for."),
      feature("شامواه وشبك", "خامات متداخلة بتدي شكل غني وتهوية كويسة.", "Suede and Mesh", "Layered materials for a rich look and good breathability."),
    ],
    lines: [],
  },
  {
    brand: "Crocs",
    match: /crocs|كروكس/i,
    summary: { ar: "Crocs معروفة بخامة Croslite الخفيفة الطرية، فتحات التهوية، سهولة التنضيف، والرباط الخلفي، وإمكانية تزيينها بـ Jibbitz.", en: "Crocs is known for light, soft Croslite material, ventilation ports, easy cleaning, a pivoting heel strap and Jibbitz customisation." },
    features: [
      feature("خامة Croslite", "خامة خفيفة وطرية بتتشكل على الرجل ومريحة جدًا.", "Croslite Material", "Light, soft material that moulds to your foot."),
      feature("فتحات تهوية", "فتحات بتخلي الرجل تتنفس وتنشف بسرعة.", "Ventilation Ports", "Ports that let feet breathe and dry quickly."),
      feature("سهل التنضيف", "بيتغسل بمية وصابون ويرجع جديد في دقايق.", "Easy to Clean", "Rinse with soap and water and it looks new in minutes."),
      feature("رباط خلفي", "رباط كعب بيتقلب لقدام أو لورا حسب استخدامك.", "Pivoting Heel Strap", "A heel strap that flips forward or back as you need."),
    ],
    lines: [],
  },
  {
    brand: "Converse",
    match: /converse|كونفرس|كونفيرس/i,
    summary: { ar: "Converse معروفة بـ Chuck Taylor: وش كانفاس، مقدمة كاوتش، ونعل مطاطي كلاسيك.", en: "Converse is known for the Chuck Taylor: canvas upper, rubber toe cap and a classic vulcanised sole." },
    features: [
      feature("وش كانفاس", "قماش كانفاس خفيف بيدي الشكل الكلاسيك المعروف.", "Canvas Upper", "Light canvas for the classic look everyone knows."),
      feature("مقدمة كاوتش", "مقدمة مطاط بتحمي الكوتشي وتدي الشكل المميز.", "Rubber Toe Cap", "A rubber toe cap that protects and defines the look."),
    ],
    lines: [],
  },
  {
    brand: "Vans",
    match: /\bvans\b|فانز/i,
    summary: { ar: "Vans معروفة بجذور السكيت، النعل الوافل اللي بيمسك في الأرض، خامات كانفاس وشامواه، والخط الجانبي Sidestripe.", en: "Vans is known for skate roots, a grippy waffle outsole, canvas and suede uppers and the Sidestripe." },
    features: [
      feature("نعل وافل", "نعل بنقشة الوافل المعروفة بيمسك في الأرض كويس.", "Waffle Outsole", "The famous waffle pattern for dependable grip."),
      feature("روح السكيت", "تصميم طالع من ثقافة السكيت بشكل كاجوال مريح.", "Skate Heritage", "Born in skate culture, with an easy casual look."),
    ],
    lines: [],
  },
  {
    brand: "ASICS",
    match: /asics|اسيكس/i,
    summary: { ar: "ASICS معروفة بتقنية GEL في النعل لامتصاص الصدمات وثبات الخطوة.", en: "ASICS is known for GEL cushioning that absorbs impact and steadies each stride." },
    features: [feature("امتصاص صدمات", "نعل مبطن بيمتص الخبطة ويريّح المفاصل في المشي.", "Impact Cushioning", "A cushioned sole that absorbs impact and eases each step.")],
    lines: [],
  },
  {
    brand: "Alexander McQueen",
    match: /mc\s?queen|maqueen|ماكوين/i,
    summary: { ar: "Alexander McQueen معروفة بالكوتشي الأوفرسايز: نعل عريض مرتفع ووش جلد ناعم بلمسة فخمة.", en: "Alexander McQueen is known for the oversized sneaker: a raised, wide sole and smooth leather upper with a luxury feel." },
    features: [
      feature("نعل أوفرسايز", "نعل عريض ومرتفع بيدي طول وشكل فخم.", "Oversized Sole", "A raised, wide sole that adds height and presence."),
      feature("جلد ناعم", "وش جلد نضيف بلمسة فخمة.", "Smooth Leather", "A clean leather upper with a luxury finish."),
    ],
    lines: [],
  },
];

const text = (value = "") => String(value ?? "").trim();

/* The brand entry for a product and the lines its name mentions; null when the
 * brand is not in the list. */
export const brandKnowledgeFor = ({ brand = "", name = "" } = {}) => {
  const haystack = `${text(brand)} ${text(name)}`;
  const entry = BRAND_KNOWLEDGE.find((item) => item.match.test(text(brand))) || BRAND_KNOWLEDGE.find((item) => item.match.test(haystack));
  if (!entry) return null;
  const lines = (entry.lines || []).filter((line) => line.match.test(text(name)));
  return { brand: entry.brand, summary: entry.summary, features: entry.features, lines };
};

/* Reference text for the prompt, in the requested language. */
export const brandKnowledgeReference = (knowledge, language = "ar") => {
  if (!knowledge) return "";
  const lang = language === "en" ? "en" : "ar";
  return [knowledge.summary[lang], ...knowledge.lines.map((line) => line.summary[lang])].filter(Boolean).join("\n");
};

/* Features for the local template: the model line first, then the brand. */
export const brandKnowledgeFeatures = (knowledge, language = "ar") => {
  if (!knowledge) return [];
  const lang = language === "en" ? "en" : "ar";
  const seen = new Set();
  return [...knowledge.lines.flatMap((line) => line.features), ...knowledge.features]
    .map((item) => item[lang])
    .filter((item) => {
      if (seen.has(item.title)) return false;
      seen.add(item.title);
      return true;
    });
};
