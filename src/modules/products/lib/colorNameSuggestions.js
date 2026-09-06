import { STANDARD_COLOR_NAMES } from "../../../shared/utils/colorNameNormalization.js";

// The editor's colour dropdown used to be the 24 hard-coded single English
// colours only, so every compound name the catalogue actually wears
// ("White & Burgandy", an Arabic two-colour name) was missing from the list and
// had to be retyped by hand. The catalogue is the only honest source for those,
// so the dropdown is the tenant's own live colour names (most used first)
// followed by the standard singles that are not in use yet.
const cleanColorName = (value) => String(value ?? "").trim().replace(/\s+/g, " ");

export const dedupeColorNames = (names = []) => {
  const seen = new Set();
  const out = [];
  for (const value of names) {
    const clean = cleanColorName(value);
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
  }
  return out;
};

export const mergeColorNameSuggestions = (catalogNames = []) =>
  dedupeColorNames([...(Array.isArray(catalogNames) ? catalogNames : []), ...STANDARD_COLOR_NAMES]);

export default mergeColorNameSuggestions;
