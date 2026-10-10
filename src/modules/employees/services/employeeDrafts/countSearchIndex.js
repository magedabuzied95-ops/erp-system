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
import {
  facetMatches,
  normalizeFilterValue,
  resolveConfiguredFilterValue,
  selectedFilterValues,
} from "./classificationMatch.js";
import { classificationGroupsToFieldOptions } from "../../../products/lib/productClassifications.js";

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
        // Every factory the COLOUR is made in, as ids: a colour can be made in
        // two, and the legacy single id only ever holds the first.
        manufacturerIds: new Set(),
        audiences: [],
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
    for (const id of Array.isArray(row.manufacturer_ids) ? row.manufacturer_ids : []) {
      const manufacturerId = str(id);
      if (manufacturerId) group.manufacturerIds.add(manufacturerId);
    }
    for (const field of CODE_FIELDS) {
      const code = foldSearchText(row[field]);
      if (code) group.codes.add(code);
    }
  }

  const list = [...groups.values()];
  for (const group of list) {
    group.manufacturerIds = [...group.manufacturerIds];
    // A product made "for men and women" carries both, comma separated.
    group.audiences = group.gender.split(/[,|/]+/).map((part) => part.trim()).filter(Boolean);
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
    ].join("  ");
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

// ---- Filtering ---------------------------------------------------------------
// A count filters on exactly what the cashier filters on, or the two screens
// disagree about what a product IS. Two things that costs:
//
// 1. The CONFIGURED classification, never the product's own words. The rows say
//    "mirror_original", "Uncategorized", "local"; the filter the owner set up
//    says something else entirely, which is why this filter used to offer five
//    spellings of the same thing and match none of them.
// 2. Factory IDS, per colour. Factories live on the colour
//    (product_variants.manufacturer_ids) and a colour can carry two, while the
//    legacy single id only ever holds the first — matching the one name hid
//    every product whose factory sits only on its colours. An id the dictionary
//    has no name for is still matchable under a "name:" key, so a phone holding
//    a snapshot older than the ids keeps filtering instead of filtering nothing.

const NAME_KEY_PREFIX = "name:";
const manufacturerNameKey = (name) => NAME_KEY_PREFIX + foldSearchText(name);

/** The configured option lists this index is filtered against. */
const filterOptionsOf = (classifications) => {
  const fields = classificationGroupsToFieldOptions(
    Array.isArray(classifications) ? classifications : [],
    {},
    { includeInactive: false }
  );
  return { gender: fields.gender || [], type: fields.productType || [], grade: fields.grade || [] };
};

const dictionarySignature = ({ classifications = [], manufacturers = [] } = {}) =>
  [
    (Array.isArray(classifications) ? classifications : [])
      .map((group) => [group?.key, (group?.options || []).map((option) => option?.value).join("|")].join(":"))
      .join(";"),
    (Array.isArray(manufacturers) ? manufacturers : []).map((row) => row?.id).join("|"),
  ].join("##");

// Mapping ~2k colours onto the configured options costs a pass over the index,
// so it is done once per (index, dictionary) and reused for every keystroke.
const tagCache = new WeakMap();

const tagGroup = (group, options) => ({
  gender: [...new Set(group.audiences.map((value) => resolveConfiguredFilterValue(value, options.gender)).filter(Boolean))],
  type: [...new Set([group.type, group.style].map((value) => resolveConfiguredFilterValue(value, options.type)).filter(Boolean))],
  grade: [...new Set([group.grade, group.category].map((value) => resolveConfiguredFilterValue(value, options.grade)).filter(Boolean))],
  brand: foldSearchText(group.brand),
  manufacturer: [
    ...group.manufacturerIds,
    ...(group.manufacturer_name ? [manufacturerNameKey(group.manufacturer_name)] : []),
  ],
  sizes: group.sizes.map((size) => foldSearchText(size)),
});

/** The index with its filter tags, mapped once per dictionary. */
export const tagCountIndex = (index, dictionaries = {}) => {
  const list = Array.isArray(index) ? index : [];
  const signature = dictionarySignature(dictionaries);
  const cached = tagCache.get(list);
  if (cached && cached.signature === signature) return cached;
  const options = filterOptionsOf(dictionaries.classifications);
  const tags = new Map(list.map((group) => [group, tagGroup(group, options)]));
  const entry = { signature, options, tags };
  tagCache.set(list, entry);
  return entry;
};

// A brand or a factory is a NAME or an id, never a classification value: the
// classification normaliser would turn "Factory Z" into "factory_z" and eat the
// colon off a "name:" key, so those two keep their own, plainer reading.
const pickedValues = (selected) =>
  (Array.isArray(selected) ? selected : [selected])
    .map((value) => String(value ?? "").trim())
    .filter((value) => value && !isAll(value));

/** What the filter panel handed over, as the index matches it. */
export const wantedCountFilters = ({ filters = {}, size = "all" } = {}) => ({
  brand: pickedValues(filters.brand).map((value) => foldSearchText(value)),
  manufacturer: pickedValues(filters.manufacturer),
  gender: isAll(filters.gender) ? [] : selectedFilterValues(filters.gender),
  type: isAll(filters.type) ? [] : selectedFilterValues(filters.type),
  grade: isAll(filters.category) ? [] : selectedFilterValues(filters.category),
  size: isAll(size) ? "" : foldSearchText(size),
  inStockOnly: Boolean(filters.inStockOnly),
});

/** Whether anything is actually narrowing the catalogue. */
export const hasWantedCountFilters = (wanted = {}) =>
  Boolean(
    wanted.brand?.length ||
    wanted.manufacturer?.length ||
    wanted.gender?.length ||
    wanted.type?.length ||
    wanted.grade?.length ||
    wanted.size ||
    wanted.inStockOnly
  );

const EMPTY_OPTIONS = { gender: [], type: [], grade: [] };

const passesFilters = (group, wanted, tags) => {
  const tag = tags.get(group) || tagGroup(group, EMPTY_OPTIONS);
  if (wanted.brand.length && !wanted.brand.includes(tag.brand)) return false;
  // A factory is picked by id; the "name:" key is the fallback for a snapshot
  // taken before the ids, and for a factory the dictionary has no row for.
  if (wanted.manufacturer.length) {
    const picked = wanted.manufacturer.map((value) => {
      const text = String(value);
      return text.startsWith(NAME_KEY_PREFIX) ? manufacturerNameKey(text.slice(NAME_KEY_PREFIX.length)) : text;
    });
    if (!picked.some((value) => tag.manufacturer.includes(value))) return false;
  }
  if (!facetMatches(wanted.gender, tag.gender)) return false;
  if (!facetMatches(wanted.type, tag.type)) return false;
  if (!facetMatches(wanted.grade, tag.grade)) return false;
  if (wanted.size && !tag.sizes.includes(wanted.size)) return false;
  if (wanted.inStockOnly && group.stock <= 0) return false;
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
 *
 * With no query at all, the FILTER is the question: picked chips alone list the
 * colours they match, so "count everything from this factory" is a few taps
 * rather than a word the employee has to guess. Nothing picked lists nothing —
 * the whole catalogue is not an answer.
 *
 * `groups` is the capped page the list shows; `all` is every match in order.
 * "Add every colour of this model" has to work off `all`, or it would silently
 * add only the colours that happened to fit on the visible page.
 */
export const searchCountIndex = (index, rawQuery, { filters = {}, size = "all", limit = 30, dictionaries = {} } = {}) => {
  const query = foldSearchText(rawQuery);
  const list = Array.isArray(index) ? index : [];
  const { tags } = tagCountIndex(list, dictionaries);
  const wanted = wantedCountFilters({ filters, size });
  const byName = (a, b) => a.product_name.localeCompare(b.product_name, "ar") || a.color.localeCompare(b.color, "ar");
  const nothing = { groups: [], all: [], total: 0, exact: false, browsing: false };

  if (!query) {
    if (!list.length || !hasWantedCountFilters(wanted)) return nothing;
    const matched = list.filter((group) => passesFilters(group, wanted, tags)).sort(byName);
    return { groups: matched.slice(0, limit), all: matched, total: matched.length, exact: false, browsing: true };
  }
  if (!list.length) return nothing;

  const tokens = query.split(" ").filter(Boolean);
  const exact = [];
  const ranked = [];
  for (const group of list) {
    const rank = rankGroup(group, query, tokens);
    if (rank < 0) continue;
    if (rank === 0) { exact.push(group); continue; }
    if (!passesFilters(group, wanted, tags)) continue;
    ranked.push({ group, rank });
  }
  if (exact.length) return { groups: exact.slice(0, limit), all: exact, total: exact.length, exact: true, browsing: false };

  ranked.sort((a, b) =>
    (a.rank - b.rank) ||
    (b.group.updated_at - a.group.updated_at) ||
    byName(a.group, b.group)
  );
  const all = ranked.map((entry) => entry.group);
  return { groups: all.slice(0, limit), all, total: all.length, exact: false, browsing: false };
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

/**
 * Filter-panel options with how many colours each one holds, from the phone.
 *
 * The classification options are the OWNER'S, in the owner's words and order,
 * and an option the catalogue has nothing under is left out rather than offered
 * as a dead end. Factories are keyed by id — a colour can be made in two — and
 * named from the snapshot's dictionary.
 */
export const countIndexFacets = (index, dictionaries = {}) => {
  const list = Array.isArray(index) ? index : [];
  const { options, tags } = tagCountIndex(list, dictionaries);
  const tally = { gender: new Map(), type: new Map(), grade: new Map(), brand: new Map(), manufacturer: new Map(), size: new Map() };
  const bump = (map, key, name) => {
    if (!key) return;
    const entry = map.get(key) || { id: key, name: name || key, count: 0 };
    entry.count += 1;
    map.set(key, entry);
  };
  const manufacturerNames = new Map(
    (Array.isArray(dictionaries.manufacturers) ? dictionaries.manufacturers : [])
      .map((row) => [str(row?.id), str(row?.name)])
      .filter(([id, name]) => id && name)
  );

  for (const group of list) {
    const tag = tags.get(group);
    if (!tag) continue;
    for (const value of tag.gender) bump(tally.gender, value);
    for (const value of tag.type) bump(tally.type, value);
    for (const value of tag.grade) bump(tally.grade, value);
    if (group.brand) bump(tally.brand, str(group.brand));
    // One chip per factory the colour is made in. An id with no name falls back
    // to the legacy name on the row, which is all a pre-ids snapshot has.
    const factories = group.manufacturerIds.length
      ? group.manufacturerIds.map((id) => [id, manufacturerNames.get(id) || str(group.manufacturer_name) || id])
      : group.manufacturer_name
        ? [[manufacturerNameKey(group.manufacturer_name), str(group.manufacturer_name)]]
        : [];
    for (const [id, name] of factories) bump(tally.manufacturer, id, name);
    for (const size of group.sizes) bump(tally.size, str(size));
  }

  const plain = (map, sorter = (a, b) => a.name.localeCompare(b.name, "ar")) => [...map.values()].sort(sorter);
  // The owner's options, in the owner's order. A value the classification does
  // not cover gets NO chip of its own — the cashier's filter does not offer one
  // either, and a count that disagrees with the cashier about what a product is
  // is worse than one chip short. Only a field the owner has not configured at
  // all falls back to the raw words, so the sheet is never empty.
  const configured = (field) => {
    if (!(options[field] || []).length) return plain(tally[field]);
    const seen = new Set();
    const ordered = [];
    for (const option of options[field] || []) {
      const id = normalizeFilterValue(option.value || option.id || option.name || option.label);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const entry = tally[field].get(id);
      if (!entry) continue; // nothing on the shelf is filed under it: no dead chip
      ordered.push({
        id,
        name: option.label_ar || option.label || option.label_en || option.value || id,
        count: entry.count,
        ...(option.icon ? { icon: option.icon } : {}),
        ...(option.color ? { color: option.color } : {}),
      });
    }
    return ordered;
  };

  return {
    gender: configured("gender"),
    type: configured("type"),
    grade: configured("grade"),
    brand: plain(tally.brand),
    manufacturer: plain(tally.manufacturer),
    size: plain(tally.size, (a, b) => sizeSort(a.name, b.name)),
  };
};

/** The dictionaries a snapshot carries for the filter, with safe defaults. */
export const countFilterDictionaries = (snapshot) => ({
  classifications: Array.isArray(snapshot?.classifications) ? snapshot.classifications : [],
  manufacturers: Array.isArray(snapshot?.manufacturers) ? snapshot.manufacturers : [],
});

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
