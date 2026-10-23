// How customers name a colour (Arabic, Franco, English) → the catalog's English colour words.
// The sales agent picks cards by it; restock watches resolve «الأسود» to the variant's "Black" by it.
export const COLOUR_WORDS = [
  [/(اسود|أسود|سودا|بلاك|black)/i, ["black"]],
  [/(ابيض|أبيض|بيضا|وايت|white)/i, ["white"]],
  [/(بيج|beige|biege)/i, ["beige", "biege"]],
  [/(كحلي|نيفي|navy)/i, ["navy"]],
  [/(رمادي|رصاصي|جراي|جري|grey|gray)/i, ["grey", "gray"]],
  [/(احمر|أحمر|ريد|red)/i, ["red"]],
  [/(اخضر|أخضر|جرين|green)/i, ["green"]],
  [/(بني|براون|brown)/i, ["brown"]],
  [/(بينك|وردي|روز|pink|rose)/i, ["pink", "rose"]],
  [/(ازرق|أزرق|بلو|blue)/i, ["blue"]],
  [/(نبيتي|برجندي|burgundy)/i, ["burgundy"]],
];

// The Arabic a reply uses for a catalog colour word («مقاس 47 الأسود»); "" when there is none.
const ARABIC_COLOUR = { black: "الأسود", white: "الأبيض", beige: "البيج", biege: "البيج", navy: "الكحلي", grey: "الرمادي", gray: "الرمادي", red: "الأحمر", green: "الأخضر", brown: "البني", pink: "البينك", rose: "البينك", blue: "الأزرق", burgundy: "النبيتي" };
export const arabicColourName = (colour = "") => ARABIC_COLOUR[String(colour ?? "").trim().toLowerCase()] || "";

export const coloursNamedIn = (message = "") =>
  COLOUR_WORDS.filter(([pattern]) => pattern.test(String(message ?? "").trim())).flatMap(([, names]) => names);
