const freezeArray = (value = []) => Object.freeze([...value]);
const freezeEntry = (entry = {}) =>
  Object.freeze({
    aliases: freezeArray(entry.aliases || []),
    searchTerms: freezeArray(entry.searchTerms || entry.aliases || []),
  });

export const PRODUCT_ALIASES = Object.freeze({
  jordan4: freezeEntry({
    aliases: ["جوردن 4", "جوردن فور", "جوردن فورات", "aj4", "air jordan 4", "j4"],
    searchTerms: ["jordan 4", "air jordan 4", "aj4", "j4", "جوردن"],
  }),
  nike_shox: freezeEntry({
    aliases: ["شوكس", "شوكس نايك", "nike shox", "shox", "shox tl"],
    searchTerms: ["nike shox", "shox", "شوكس"],
  }),
  skechers: freezeEntry({
    aliases: ["اسكتشر", "اسكتشرز", "سكيتشر", "سكيتشرز", "سكتشر", "skechers", "skecher"],
    searchTerms: ["skechers", "skecher", "اسكتشر", "سكيتشر"],
  }),
});

export default PRODUCT_ALIASES;
