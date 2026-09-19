/**
 * The stock count's product search, as an index.
 *
 * The count is taken per COLOUR (a colour's whole size run goes on the sheet
 * together), so the unit of search is the colour group, not the size row. The
 * index is built once per catalogue snapshot: every group gets its text folded
 * and its codes collected up front, and a keystroke then costs one pass over
 * ~1-2k prebuilt strings — no normalising, grouping or allocating per key press.
 * That is the difference between a search box that keeps up with a thumb on a
 * mid-range phone and one that stutters.
 *
 * Pure and framework-free, so ranking and folding are testable on their own.
 */

const str = (value) => String(value ?? "").trim();
const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const ARABIC_INDIC_DIGITS = /[٠-٩۰-۹]/g;
const DIACRITICS = /[ً-ٰٟـ]/g; // tashkeel + tatweel

/**
 * Fold text the way a person searching would expect it to match: case, Arabic
 * letter variants (أ إ آ → ا, ة → ه, ى → ي), tashkeel, and Arabic-Indic digits.
 * "اسود" finds "أسود", "٤٢" finds "42".
 */
const NON_ASCII = /[^\t\n\r -~]/;
const foldMemo = new Map();

export const foldSearchText = (value) => {
  const text = str(value);
  if (!text) return "";
  // Codes (barcodes, SKUs, article codes) are nearly all plain ASCII and there
  // are tens of thousands of them: they skip the Arabic passes entirely.
  if (!NON_ASCII.test(text)) return text.toLowerCase().replace(/\s+/g, " ");
  // The same few colour / brand / product strings repeat on every size row.
  const known = foldMemo.get(text);
  if (known !== undefined) return known;
  const folded = text
    .toLowerCase()
    .replace(DIACRITICS, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(ARABIC_INDIC_DIGITS, (digit) => String(digit.charCodeAt(0) & 0xf))
    .replace(/\s+/g, " ");
  if (foldMemo.size > 20000) foldMemo.clear();
  foldMemo.set(text, folded);
  return folded;
};

const sizeSort = (a, b) => {
  const left = Number(a);
  const right = Number(b);
  if (Number.isFinite(left) && Number.isFinite(right)) return left - right;
  return String(a).localeCompare(String(b), "ar");
};

const CODE_FIELDS = ["barcode", "sku", "article_code", "product_barcode", "product_sku", "qr_token", "product_code"];

const indexCache = new WeakMap();

const buildIndex = (rows) => {
  const groups = new Map();
  for (const row of rows) {
    const productId = row.product_id ?? "";
    const key = `${productId}::${foldSearchText(row.color) || "default"}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        product_id: row.product_id,
        product_name: str(row.product_name),
        color: str(row.color),
        article_code: "",
        brand: str(row.brand),
        gender: str(row.gender),
        type: str(row.type),
        style: str(row.style),
        category: str(row.category),
        grade: str(row.grade),
        manufacturer_name: str(row.manufacturer_name),
        image_url: "",
        stock: 0,
        sizes: [],
        variants: [],
        variantIds: [],
        codes: new Set(),
        updated_at: toNumber(row.product_updated_at, 0),
        name: foldSearchText(row.product_name),
        text: "",
      };
      groups.set(key, group);
    }
    group.variants.push(row);
    group.variantIds.push(String(row.product_variant_id ?? ""));
    group.stock += Math.max(0, toNumber(row.stock, 0));
    if (row.size) group.sizes.push(str(row.size));
    if (!group.article_code && row.article_code) group.article_code = str(row.article_code);
    if (!group.image_url) group.image_url = str(row.image_url) || str(row.product_image_url);
    for (const field of CODE_FIELDS) {
      const code = foldSearchText(row[field]);
      if (code) group.codes.add(code);
    }
  }

  const list = [...groups.values()];
  for (const group of list) {
    group.sizes = [...new Set(group.sizes)].sort(sizeSort);
    group.variants.sort((a, b) => sizeSort(a.size, b.size));
    group.text = [
      group.name,
      foldSearchText(group.color),
      foldSearchText(group.brand),
      foldSearchText(group.type),
      foldSearchText(group.style),
      foldSearchText(group.grade || group.category),
      [...group.codes].join(" "),
    ].join("  ");
  }
  return list;
};

/** The colour-group index for a snapshot; built once, reused for every search. */
export const getCountSearchIndex = (snapshot) => {
  const rows = snapshot && Array.isArray(snapshot.variants) ? snapshot.variants : null;
  if (!rows || !rows.length) return [];
  let index = indexCache.get(snapshot);
  if (!index) {
    index = buildIndex(rows);
    indexCache.set(snapshot, index);
  }
  return index;
};

const isAll = (value) => {
  const folded = foldSearchText(value);
  return !folded || folded === "all" || folded === "الكل";
};

const passesFilters = (group, wanted) => {
  if (wanted.brand && foldSearchText(group.brand) !== wanted.brand) return false;
  if (wanted.manufacturer && foldSearchText(group.manufacturer_name) !== wanted.manufacturer) return false;
  if (wanted.gender && !foldSearchText(group.gender).split(/[,|]/).map((part) => part.trim()).includes(wanted.gender)) return false;
  if (wanted.type && foldSearchText(group.type) !== wanted.type && foldSearchText(group.style) !== wanted.type) return false;
  if (wanted.category && foldSearchText(group.grade) !== wanted.category && foldSearchText(group.category) !== wanted.category) return false;
  if (wanted.size && !group.sizes.some((size) => foldSearchText(size) === wanted.size)) return false;
  return true;
};

/**
 * How well a group answers the query. Lower is better; -1 is "does not match".
 * Every word of the query has to appear somewhere (so "adidas اسود" narrows
 * instead of widening), and the order reflects what the employee most likely
 * meant: a code they read off a box, then a name they started typing.
 */
const rankGroup = (group, query, tokens) => {
  if (group.codes.has(query)) return 0;
  for (const token of tokens) if (!group.text.includes(token)) return -1;
  if (group.name.startsWith(query)) return 1;
  if (tokens.every((token) => group.name.split(" ").some((word) => word.startsWith(token)))) return 2;
  if (group.name.includes(query)) return 3;
  for (const code of group.codes) if (code.startsWith(query)) return 4;
  return 5;
};

/**
 * Search the index. Filters narrow the result; an exact code is exempt from
 * them, because a code read off the box in the employee's hand names THE
 * product — hiding it behind a forgotten filter chip reads as "not found".
 */
export const searchCountIndex = (index, rawQuery, { filters = {}, size = "all", limit = 30 } = {}) => {
  const query = foldSearchText(rawQuery);
  if (!query || !Array.isArray(index) || !index.length) return { groups: [], total: 0, exact: false };
  const tokens = query.split(" ").filter(Boolean);
  const wanted = {
    brand: isAll(filters.brand) ? "" : foldSearchText(filters.brand),
    manufacturer: isAll(filters.manufacturer) ? "" : foldSearchText(filters.manufacturer),
    gender: isAll(filters.gender) ? "" : foldSearchText(filters.gender),
    type: isAll(filters.type) ? "" : foldSearchText(filters.type),
    category: isAll(filters.category) ? "" : foldSearchText(filters.category),
    size: isAll(size) ? "" : foldSearchText(size),
  };

  const exact = [];
  const ranked = [];
  for (const group of index) {
    const rank = rankGroup(group, query, tokens);
    if (rank < 0) continue;
    if (rank === 0) { exact.push(group); continue; }
    if (!passesFilters(group, wanted)) continue;
    ranked.push({ group, rank });
  }
  if (exact.length) return { groups: exact.slice(0, limit), total: exact.length, exact: true };

  ranked.sort((a, b) =>
    (a.rank - b.rank) ||
    (b.group.updated_at - a.group.updated_at) ||
    a.group.product_name.localeCompare(b.group.product_name, "ar") ||
    a.group.color.localeCompare(b.group.color, "ar")
  );
  return { groups: ranked.slice(0, limit).map((entry) => entry.group), total: ranked.length, exact: false };
};

/** The one group an exact code names — what a barcode scan resolves to. */
export const findCountGroupByCode = (index, rawCode) => {
  const code = foldSearchText(rawCode);
  if (!code || !Array.isArray(index)) return null;
  // A size row's own code wins over a product-level code shared by every colour.
  let shared = null;
  for (const group of index) {
    if (!group.codes.has(code)) continue;
    if (group.variants.some((row) => ["barcode", "sku", "article_code"].some((field) => foldSearchText(row[field]) === code))) return group;
    shared = shared || group;
  }
  return shared;
};

/** Filter-panel options with how many colours each one holds, from the phone. */
export const countIndexFacets = (index) => {
  const tally = () => new Map();
  const facets = { gender: tally(), type: tally(), grade: tally(), brand: tally(), manufacturer: tally(), size: tally() };
  const bump = (map, value) => {
    const label = str(value);
    if (label) map.set(label, (map.get(label) || 0) + 1);
  };
  for (const group of Array.isArray(index) ? index : []) {
    bump(facets.gender, group.gender);
    bump(facets.type, group.type);
    bump(facets.grade, group.grade || group.category);
    bump(facets.brand, group.brand);
    bump(facets.manufacturer, group.manufacturer_name);
    for (const size of group.sizes) bump(facets.size, size);
  }
  const toOptions = (map, sorter = (a, b) => a.name.localeCompare(b.name, "ar")) =>
    [...map.entries()].map(([name, count]) => ({ id: name, name, count })).sort(sorter);
  return {
    gender: toOptions(facets.gender),
    type: toOptions(facets.type),
    grade: toOptions(facets.grade),
    brand: toOptions(facets.brand),
    manufacturer: toOptions(facets.manufacturer),
    size: toOptions(facets.size, (a, b) => sizeSort(a.name, b.name)),
  };
};

/** Split `label` around the first place `rawQuery` matches, for highlighting. */
export const highlightParts = (label, rawQuery) => {
  const text = str(label);
  const token = foldSearchText(rawQuery).split(" ").filter(Boolean)[0];
  if (!text || !token) return [text, "", ""];
  // Folding keeps string length (every rule is 1 char → 1 char, and the
  // diacritics rule only runs on the needle side here), so indexes line up.
  const folded = text.toLowerCase().replace(/[أإآٱ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي");
  const at = folded.indexOf(token);
  if (at < 0) return [text, "", ""];
  return [text.slice(0, at), text.slice(at, at + token.length), text.slice(at + token.length)];
};
