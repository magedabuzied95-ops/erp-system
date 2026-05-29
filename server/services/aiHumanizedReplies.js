const lastReplies = new Map();

function randomItem(items = [], avoidText = "") {
  const available = items.filter((item) => item && item !== avoidText);
  const list = available.length ? available : items.filter(Boolean);
  return list[Math.floor(Math.random() * list.length)] || "";
}

const cleanLines = (reply = "") =>
  String(reply || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 6)
    .join("\n");

const appendProductLink = (reply = "", productContext = null) => {
  const productUrl = String(productContext?.productUrl || "").trim();
  if (!productUrl || String(reply || "").includes(productUrl)) return reply;
  const lines = cleanLines(reply).split("\n").filter(Boolean);
  const lastLine = lines.at(-1) || "";
  const linkLines = ["شوفه من هنا:", productUrl];
  if (/[?؟]$|طں$/.test(lastLine) && lines.length > 1) {
    return cleanLines([...lines.slice(0, -1), ...linkLines, lastLine].join("\n"));
  }
  return cleanLines([...lines, ...linkLines].join("\n"));
};

export function buildHumanizedReply({
  intent,
  productContext,
  detectedSize,
  conversationId,
} = {}) {
  const productName = productContext?.name || "الموديل ده";
  const price = productContext?.salePrice || productContext?.price;
  const sizes = Array.isArray(productContext?.sizes)
    ? productContext.sizes.map((size) => String(size).trim()).filter(Boolean)
    : [];
  const hasProduct = Boolean(productContext?.name);
  const hasSizes = sizes.length > 0;
  const sizeAvailable = detectedSize && hasSizes
    ? sizes.map(String).includes(String(detectedSize))
    : null;

  const styles = {
    PRICE_INQUIRY: price
      ? [
          `لو بتحب الستايل ده فـ ${productName} هيعجبك جدًا\nسعره ${price} جنيه.\nمقاسك كام؟`,
          `${productName} من الموديلات المطلوبة جدًا\nسعره ${price} جنيه.\nتحب أشوفلك المقاسات المتاحة؟`,
          `الموديل ده خامته حلوة للاستخدام اليومي\nوسعره ${price} جنيه.\nتحب صور أكتر؟`,
        ]
      : [],

    SIZE_INQUIRY: hasSizes
      ? [
          detectedSize && sizeAvailable === true
            ? `أيوه مقاس ${detectedSize} متاح حاليًا في ${productName}.\nتحب أجهزهولك؟`
            : "",
          detectedSize && sizeAvailable === false
            ? `للأسف مقاس ${detectedSize} مش ظاهر متاح حاليًا في ${productName}.\nتحب أشوفلك بديل قريب؟`
            : "",
          `المقاسات المتاحة حاليًا: ${sizes.join(", ")}\nمقاسك المعتاد كام؟`,
          `أيوه متوفر\nوفيه مقاسات: ${sizes.join(", ")}\nتحب أساعدك تختار الأنسب؟`,
        ].filter(Boolean)
      : [],

    AVAILABILITY_INQUIRY: hasProduct
      ? [
          productContext?.inStock === false
            ? `للأسف ${productName} مش متوفر حاليًا.\nتحب أشوفلك بديل قريب؟`
            : `أيوه ${productName} متوفر حاليًا.\nتحب أشوفلك صور أو ألوان تانية؟`,
          productContext?.inStock === false
            ? `${productName} مش ظاهر في المخزون دلوقتي.\nممكن أرشحلك حاجة قريبة؟`
            : `${productName} متوفر\nوده من الحاجات اللي عليها طلب حاليًا.`,
        ]
      : [],

    GENERAL: [
      "أكيد ❤️\nقولي تحب تسأل عن إيه بالظبط؟",
      "ممكن تبعت صورة أو اسم الموديل وأنا أساعدك بسرعة.",
      "ابعتلي المقاس أو صورة الموديل وهظبطلك الاختيارات.",
    ],
  };

  const group = styles[intent]?.length ? styles[intent] : styles.GENERAL;
  const lastReplyText = conversationId ? lastReplies.get(conversationId) : "";
  const reply = appendProductLink(cleanLines(randomItem(group, lastReplyText)), productContext);

  if (conversationId && reply) {
    lastReplies.set(conversationId, reply);
  }

  return reply;
}
