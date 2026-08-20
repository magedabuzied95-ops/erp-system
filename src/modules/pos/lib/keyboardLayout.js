/**
 * Arabic 101 keyboard layout, so POS search stops caring which layout Windows is on.
 *
 * A browser cannot switch the operating system's keyboard layout - there is no API
 * for it - so the search box has to meet the cashier where they are. Someone who
 * leaves the layout on Arabic and types "vans" produces "\u0631\u0634\u0649\u0633",
 * and a barcode scanner firing into an Arabic layout emits Arabic letters for every
 * letter in the code. Both used to return zero results with nothing on screen to
 * explain why.
 *
 * Every Arabic character below is written as a \u escape on purpose. Arabic literals
 * in this repo have been corrupted into mojibake before - normalizeSmartText in
 * POSPro.jsx silently stopped folding hamza forms that way, and lib/arabicText.js is
 * still unreadable - and an ASCII-only source file cannot be damaged by an editor or
 * tool that guesses the wrong encoding.
 */

/** Physical key -> the character that key produces on the Arabic 101 layout. */
const LATIN_KEY_TO_ARABIC = {
  q: "\u0636", // d
  w: "\u0635", // s
  e: "\u062B", // th
  r: "\u0642", // q
  t: "\u0641", // f
  y: "\u063A", // gh
  u: "\u0639", // ain
  i: "\u0647", // h
  o: "\u062E", // kh
  p: "\u062D", // h
  "[": "\u062C", // j
  "]": "\u062F", // d
  a: "\u0634", // sh
  s: "\u0633", // s
  d: "\u064A", // y
  f: "\u0628", // b
  g: "\u0644", // l
  h: "\u0627", // alef
  j: "\u062A", // t
  k: "\u0646", // n
  l: "\u0645", // m
  ";": "\u0643", // k
  "'": "\u0637", // t
  z: "\u0626", // hamza on ya
  x: "\u0621", // hamza
  c: "\u0624", // hamza on waw
  v: "\u0631", // r
  b: "\u0644\u0627", // lam-alef: one key, two characters
  n: "\u0649", // alef maksura
  m: "\u0629", // ta marbuta
  ",": "\u0648", // w
  ".": "\u0632", // z
  "/": "\u0638", // dh
};

/**
 * Shifted keys worth recovering. A cashier reaching for a capital letter on an Arabic
 * layout lands on these instead, so they have to resolve back to the same latin key.
 */
const SHIFTED_ARABIC_TO_LATIN = {
  "\u0623": "h", // Shift+H
  "\u0625": "y", // Shift+Y
  "\u0622": "n", // Shift+N
  "\u0644\u0623": "g", // Shift+G
  "\u0644\u0625": "t", // Shift+T
  "\u0644\u0622": "b", // Shift+B
  "\u0640": "j", // tatweel, Shift+J
  "\u060C": "k", // arabic comma, Shift+K
  "\u061B": "p", // arabic semicolon, Shift+P
  "\u061F": "?", // arabic question mark, Shift+/
};

const ARABIC_TO_LATIN_KEY = new Map();
Object.entries(LATIN_KEY_TO_ARABIC).forEach(([key, arabic]) => {
  ARABIC_TO_LATIN_KEY.set(arabic, key);
});
Object.entries(SHIFTED_ARABIC_TO_LATIN).forEach(([arabic, key]) => {
  ARABIC_TO_LATIN_KEY.set(arabic, key);
});

/**
 * Read Arabic-layout keystrokes as the latin text the cashier meant to type.
 *
 * Returns "" when nothing mapped, which callers read as "no alternate spelling" -
 * that keeps a genuinely latin query from being handed back as its own alternate.
 */
export const arabicLayoutToLatin = (value = "") => {
  const text = String(value ?? "");
  let out = "";
  let mapped = false;

  for (let index = 0; index < text.length; index += 1) {
    // Two-character sequences first: lam-alef is one physical key (b), not lam
    // followed by alef (g then h).
    const pair = text.slice(index, index + 2);
    if (pair.length === 2 && ARABIC_TO_LATIN_KEY.has(pair)) {
      out += ARABIC_TO_LATIN_KEY.get(pair);
      mapped = true;
      index += 1;
      continue;
    }
    const single = ARABIC_TO_LATIN_KEY.get(text[index]);
    if (single !== undefined) {
      out += single;
      mapped = true;
      continue;
    }
    out += text[index];
  }

  return mapped ? out : "";
};

/** The mirror case: latin keystrokes meant to spell an Arabic word. */
export const latinLayoutToArabic = (value = "") => {
  const text = String(value ?? "");
  let out = "";
  let mapped = false;

  for (const char of text) {
    const arabic = LATIN_KEY_TO_ARABIC[char.toLowerCase()];
    if (arabic !== undefined) {
      out += arabic;
      mapped = true;
      continue;
    }
    out += char;
  }

  return mapped ? out : "";
};

/**
 * Minimum query length before an alternate reading is worth trying.
 *
 * A single character maps to a single very common letter - "d" becomes ya, which
 * appears in most Arabic product names - so a one-character miss would flood the
 * grid with unrelated products instead of showing the empty result it earned.
 */
const MIN_ALTERNATE_LENGTH = 2;

/**
 * Other layouts' readings of the same keystrokes, best first.
 *
 * Callers are expected to try these only after the literal query finds nothing, so a
 * real Arabic search ("aswad") is never overridden by its own latin gibberish.
 */
export const keyboardLayoutAlternates = (value = "") => {
  const text = String(value ?? "").trim();
  if (text.length < MIN_ALTERNATE_LENGTH) return [];

  const alternates = [];
  const asLatin = arabicLayoutToLatin(text);
  if (asLatin && asLatin !== text) alternates.push(asLatin);
  const asArabic = latinLayoutToArabic(text);
  if (asArabic && asArabic !== text) alternates.push(asArabic);

  return alternates;
};
