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

export const coloursNamedIn = (message = "") =>
  COLOUR_WORDS.filter(([pattern]) => pattern.test(String(message ?? "").trim())).flatMap(([, names]) => names);
