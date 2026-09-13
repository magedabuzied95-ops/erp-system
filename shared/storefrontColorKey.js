// One colour, one chip.
//
// Colour names are typed by hand in the ERP, so the storefront facet listed the
// same colour under several spellings: grey / gray, beige / bige / baige / biege,
// "black&white" / "black & white" / "white & black", "dark & gray" / "d.gray".
// Every key the storefront filters or counts colours by goes through here, so a
// chip gathers all of its spellings and clicking it finds all of them.
// Pure ESM: read by the server controller, the listing page and the tests.

const WORD_ALIASES = new Map([
  ["gray", "grey"],
  ["bige", "beige"],
  ["baige", "beige"],
  ["biege", "beige"],
  ["blak", "black"],
  ["balck", "black"],
  ["whie", "white"],
  ["whtite", "white"],
  ["mouve", "mauve"],
  ["move", "mauve"],
  ["burgandy", "burgundy"],
  ["orang", "orange"],
  ["purpple", "purple"],
  ["pinke", "pink"],
]);

// A lone modifier written as its own part ("dark & gray", "light & grey") or
// abbreviated ("d.gray", "l beige") belongs to the colour that follows it.
const MODIFIER_ALIASES = new Map([
  ["dark", "dark"],
  ["d", "dark"],
  ["light", "light"],
  ["l", "light"],
]);

const baseText = (value = "") =>
  String(value ?? "")
    .normalize("NFKD")
    .replace(/[ـ‌‍‎‏]/g, "")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .trim();

const canonicalWords = (part = "") =>
  part
    .replace(/\./g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => WORD_ALIASES.get(word) || MODIFIER_ALIASES.get(word) || word);

export const storefrontColorKey = (value = "") => {
  const text = baseText(value);
  if (!text) return "";
  // Only a plain Latin colour description is rewritten; anything else (Arabic
  // names, "gucci custom (black)") keeps its normalized text so it never collides.
  if (!/^[a-z0-9\s&/*,+.-]+$/.test(text)) return text.replace(/\s+/g, " ");
  const rawParts = text.split(/\s*[&/*,+]\s*|\s+-\s+|(?<=[a-z])-(?=[a-z])/).map((part) => part.trim()).filter(Boolean);
  const parts = [];
  for (let index = 0; index < rawParts.length; index += 1) {
    const words = canonicalWords(rawParts[index]);
    if (words.length === 1 && MODIFIER_ALIASES.has(rawParts[index].replace(/\./g, "")) && index + 1 < rawParts.length) {
      // "dark & grey" -> "dark grey"
      rawParts[index + 1] = `${words[0]} ${rawParts[index + 1]}`;
      continue;
    }
    parts.push(words.join(" "));
  }
  // "black & white" and "white & black" are the same two-tone pair.
  return [...new Set(parts)].sort().join(" & ");
};

/** A display label for a canonical key: "dark grey & white" -> "Dark Grey & White". */
export const storefrontColorLabel = (key = "") =>
  /^[a-z0-9\s&]+$/.test(key) ? key.replace(/\b[a-z]/g, (letter) => letter.toUpperCase()) : key;
