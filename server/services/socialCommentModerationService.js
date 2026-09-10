/* ══════════════════════════════════════════════════════════════════════════════════════════════
   COMMENT MODERATION — MATCHING ARABIC WITHOUT FLAGGING INNOCENT PEOPLE
   ──────────────────────────────────────────────────────────────────────────────────────────────
   A word filter that matches a substring anywhere is not a filter, it is a random insult
   generator pointed at customers. This repo has been bitten twice already:

     • `checkArabicWordBoundaries.js` exists because /\bكلمة\b/ matches NOTHING — JavaScript's \b
       is defined over ASCII word characters, so a boundary next to Arabic can never fire. It
       fails silently, in the direction that looks safe.
     • "مش مشكلة" cancelled a live order because a canonical signal matched a word ANYWHERE in the
       sentence.

   So every rule here is built around one idea: a banned word matches only as a WHOLE WORD, in
   text that both sides have been folded the same way, and an exception phrase can always pull a
   match back. The action on a match is HIDE, never delete — hiding is one click to undo and the
   person who wrote it still sees their own comment.
   ════════════════════════════════════════════════════════════════════════════════════════════ */

const text = (value = "") => String(value ?? "").trim();
const asArray = (value) => (Array.isArray(value) ? value : value == null ? [] : [value]);

// Every fold is a CODE POINT, never a literal Arabic character in a pattern. A normaliser is
// exactly the kind of string this repo has silently corrupted before — the POS search lost 348
// of them to mojibake and simply stopped matching, with no error anywhere. Half of these are
// invisible characters as well, which no reviewer could spot in a diff.
const isTashkeel = (code) =>
  (code >= 0x064B && code <= 0x0652) // harakat
  || code === 0x0670                 // dagger alef
  || code === 0x0640;                // tatweel, the "كــلمة" stretch

const isZeroWidth = (code) =>
  (code >= 0x200B && code <= 0x200F) // ZWSP … RLM
  || (code >= 0x202A && code <= 0x202E) // bidi embedding
  || (code >= 0x2066 && code <= 0x2069); // bidi isolates

// أ إ آ ٱ → ا, ة → ه, ى → ي, ؤ → و, ئ → ي
const LETTER_FOLDS = new Map([
  [0x0623, 0x0627], [0x0625, 0x0627], [0x0622, 0x0627], [0x0671, 0x0627],
  [0x0629, 0x0647],
  [0x0649, 0x064A],
  [0x0624, 0x0648],
  [0x0626, 0x064A],
]);

// "زفتتتت" is "زفت" said with feeling. Three or more of the same letter is always elongation;
// two is not — "مررت" must not fold into "مرت" and pick up a ban meant for another word.
const collapseElongation = (value = "") => value.replace(/(.)\1{2,}/gu, "$1");

export const normalizeArabicForModeration = (value = "") => {
  const folded = Array.from(String(value ?? "").toLowerCase())
    .map((character) => {
      const code = character.charCodeAt(0);
      if (isZeroWidth(code) || isTashkeel(code)) return "";
      const replacement = LETTER_FOLDS.get(code);
      return replacement === undefined ? character : String.fromCharCode(replacement);
    })
    .join("");
  return collapseElongation(folded).replace(/\s+/g, " ").trim();
};

const escapeRegExp = (value = "") => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// The Unicode-aware boundary the repo's own guard prescribes. \b would be dead here: it is
// defined over ASCII word characters, so between two Arabic letters the transition it needs does
// not exist and the pattern matches nothing, ever.
//
// Each word also tolerates a leading definite article, because Arabic glues it on: "انت الغبي" is
// the same insult as "انت غبي", and an exception written "لون زفت" has to survive the customer
// writing "اللون زفت". The article is OPTIONAL and never crosses a boundary, so "بالكلب" — where
// a letter precedes the article — still does not match, which is the safe direction to miss in.
const ARTICLE = "(?:\\u0627\\u0644)?"; // ال
const phrasePattern = (phrase = "") => {
  const words = String(phrase).split(/\s+/).filter(Boolean).map((word) => `${ARTICLE}${escapeRegExp(word)}`);
  if (!words.length) return null;
  return new RegExp(`(?<![\\p{L}\\p{N}])${words.join("\\s+")}(?![\\p{L}\\p{N}])`, "gu");
};

const collectRanges = (haystack = "", needles = []) => {
  const ranges = [];
  for (const needle of needles) {
    const pattern = needle ? phrasePattern(needle) : null;
    if (!pattern) continue;
    let match = pattern.exec(haystack);
    while (match) {
      ranges.push({ start: match.index, end: match.index + match[0].length, value: needle });
      match = pattern.exec(haystack);
    }
  }
  return ranges;
};

export const normalizeModerationWordList = (value = []) => {
  const raw = typeof value === "string" ? value.split(/\r?\n|,/) : asArray(value);
  return raw
    .map((item) => normalizeArabicForModeration(text(item)))
    .filter(Boolean)
    .filter((item, index, items) => items.indexOf(item) === index)
    .slice(0, 500);
};

/**
 * @returns {{matched: boolean, word: string, exception: string}}
 * `exception` is set when a banned word WAS found but every occurrence sat inside an allowed
 * phrase — the caller logs it, so a rule that keeps being cancelled is visible rather than silent.
 */
export const findBannedWord = ({ commentText = "", bannedWords = [], exceptions = [] } = {}) => {
  const haystack = normalizeArabicForModeration(commentText);
  const miss = { matched: false, word: "", exception: "" };
  if (!haystack) return miss;
  const words = normalizeModerationWordList(bannedWords);
  if (!words.length) return miss;

  const hits = collectRanges(haystack, words);
  if (!hits.length) return miss;

  const allowed = collectRanges(haystack, normalizeModerationWordList(exceptions));
  for (const hit of hits) {
    const cover = allowed.find((range) => range.start <= hit.start && range.end >= hit.end);
    if (!cover) return { matched: true, word: hit.value, exception: "" };
  }
  // Every hit was inside an exception phrase.
  return { matched: false, word: hits[0].value, exception: allowed[0]?.value || "" };
};

/* The list a tenant starts with. It is DATA, editable from Comments Settings without a deploy, so
   it only has to be a sane opening position — the owner adds what their own comments actually
   bring in. Kept to unambiguous abuse: words that are an insult in every context. Complaints
   ("نصب", "وحش", "مرجعليش فلوسي") are deliberately NOT here — hiding a real complaint is how a
   complaint becomes a post. */
export const DEFAULT_BANNED_WORDS = [
  "كس",
  "كسم",
  "كسمك",
  "كسختك",
  "متناك",
  "متناكة",
  "خول",
  "شرموط",
  "شرموطة",
  "عرص",
  "قحبة",
  "زبي",
  "زب",
  "طيز",
  "منيك",
  "منيوك",
  "ابن الوسخة",
  "ابن المتناكة",
  "يلعن",
  "العن",
  "حقير",
  "قذر",
  "وسخ",
  "خرا",
  "زفت",
  "غبي",
  "غبية",
  "احمق",
  "حمار",
  "كلب",
  "خنزير",
  "بهيمة",
  "معفن",
  "قرف",
  "تفو",
  "fuck",
  "fucking",
  "bitch",
  "shit",
  "asshole",
  "bastard",
  "idiot",
  "stupid",
];

/* Phrases that contain a banned word and are not abuse. "كلب" is in the list above and is also a
   pet; "زفت" is an insult and also asphalt. Without these, a filter aimed at insults starts
   hiding customers who are describing a product. */
export const DEFAULT_BANNED_WORD_EXCEPTIONS = [
  "لون زفت",
  "اسود زفت",
  "كلب حراسة",
  "عندي كلب",
  "شبشب كلب",
];
