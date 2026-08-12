const ARABIC_TO_ENGLISH_KEYS = [
  ["لا", "b"],
  ["ض", "q"], ["ص", "w"], ["ث", "e"], ["ق", "r"], ["ف", "t"],
  ["غ", "y"], ["ع", "u"], ["ه", "i"], ["خ", "o"], ["ح", "p"],
  ["ج", "["], ["د", "]"], ["ش", "a"], ["س", "s"], ["ي", "d"],
  ["ب", "f"], ["ل", "g"], ["ا", "h"], ["ت", "j"], ["ن", "k"],
  ["م", "l"], ["ك", ";"], ["ط", "'"], ["ئ", "z"], ["ء", "x"],
  ["ؤ", "c"], ["ر", "v"], ["ى", "n"], ["ة", "m"], ["و", ","],
  ["ز", "."], ["ظ", "/"],
];

const ENGLISH_TO_ARABIC_KEYS = new Map(
  ARABIC_TO_ENGLISH_KEYS.map(([arabic, english]) => [english, arabic])
);

const cleanSearchText = (value = "") =>
  String(value ?? "").normalize("NFKC").trim().toLowerCase();

export const convertArabicKeyboardToEnglish = (value = "") => {
  const input = cleanSearchText(value);
  let output = "";

  for (let index = 0; index < input.length;) {
    const match = ARABIC_TO_ENGLISH_KEYS.find(([arabic]) => input.startsWith(arabic, index));
    if (match) {
      output += match[1];
      index += match[0].length;
    } else {
      output += input[index];
      index += 1;
    }
  }

  return output;
};

export const convertEnglishKeyboardToArabic = (value = "") =>
  [...cleanSearchText(value)]
    .map((character) => ENGLISH_TO_ARABIC_KEYS.get(character) || character)
    .join("");

export const getKeyboardLayoutSearchVariants = (value = "") => {
  const original = cleanSearchText(value);
  if (!original) return [];

  return [...new Set([
    original,
    convertArabicKeyboardToEnglish(original),
    convertEnglishKeyboardToArabic(original),
  ].filter(Boolean))];
};

export const keyboardLayoutIncludes = (candidate = "", query = "") => {
  const queryVariants = getKeyboardLayoutSearchVariants(query);
  if (!queryVariants.length) return true;

  const candidateVariants = getKeyboardLayoutSearchVariants(candidate);
  return candidateVariants.some((candidateValue) =>
    queryVariants.some((queryValue) => candidateValue.includes(queryValue))
  );
};

