/*
 * Same address, different person.
 *
 * A customer whose order was refused at the door can simply order again under another name and
 * another phone: every trust rule in the ERP is keyed on the phone, so the second order looks
 * like a brand-new customer. The address is what the two orders still share, so this file turns
 * an address into something two orders can be compared on.
 *
 * Pure functions only — the sweeper and the tests both use them.
 *
 * The same street is typed many ways («ش التحرير عمارة ٥ الدور ٣» / «شارع التحرير، عماره 5 - دور 3»),
 * so an address becomes a SET of normalised tokens: Arabic letter forms folded, digits made Latin,
 * filler words («شارع», «عمارة», «الدور», «شقة», "building") dropped. Order is thrown away on
 * purpose — the storefront stores street / building / floor / flat in separate columns while an
 * inbox order carries one free-text line, and both must land on the same set.
 */
import { canonicalPhoneKey } from "../../utils/phoneSearch.js";
import { normalizeOrderLifecycleStatus, normalizeShippingLifecycleStatus } from "../../../shared/orderStatus.js";

const DIGIT_MAP = { "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9", "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4", "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9" };

/** Folds the spellings of one Arabic word into one form and lower-cases Latin text. */
export const normalizeArabicText = (value = "") =>
  String(value ?? "")
    .toLowerCase()
    .replace(/[٠-٩۰-۹]/g, (digit) => DIGIT_MAP[digit] || digit)
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    // "ش15" and "5ب" are two tokens each.
    .replace(/(\d)([^\d\s])/g, "$1 $2")
    .replace(/([^\d\s])(\d)/g, "$1 $2")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

// Words that say what a number is, not where the house is. Already in normalised form.
const FILLER_WORDS = new Set([
  "شارع", "شارغ", "شوارع", "طريق", "حاره", "عطفه", "زقاق", "ممر",
  "عماره", "عمارات", "عمار", "برج", "ابراج", "مبني", "بيت", "منزل", "بلوك", "مجموعه", "فيلا", "قطعه",
  "رقم", "نمره", "الرقم", "دور", "الدور", "طابق", "الطابق", "شقه", "الشقه", "شقق", "مدخل", "المدخل",
  "بجوار", "جوار", "جنب", "امام", "قدام", "خلف", "ورا", "وراء", "بالقرب", "قريب", "من", "في", "علي", "عند",
  "الي", "و", "مع", "بعد", "قبل", "اخر", "ناصيه", "تقاطع", "محافظه", "مركز",
  "street", "st", "str", "rd", "road", "building", "bldg", "bld", "floor", "flr", "fl",
  "apartment", "apt", "flat", "no", "num", "number", "near", "beside", "behind", "in", "at", "the", "of",
  "and", "block", "entrance", "tower", "villa",
]);

const ORDINALS = {
  ارضي: "0", اول: "1", ثاني: "2", تاني: "2", ثالث: "3", تالت: "3", رابع: "4", خامس: "5",
  سادس: "6", سابع: "7", ثامن: "8", تامن: "8", تاسع: "9", عاشر: "10",
  ground: "0", first: "1", second: "2", third: "3", fourth: "4", fifth: "5",
};

const normalizeToken = (raw = "") => {
  let token = raw;
  if (/^\d+$/.test(token)) return String(Number(token));
  // «الاول» / «الدور التاني» — an ordinal floor is a number.
  const bare = token.startsWith("ال") ? token.slice(2) : token;
  if (ORDINALS[bare]) return ORDINALS[bare];
  if (FILLER_WORDS.has(token)) return "";
  // «التحرير» and «تحرير» are the same street; short words keep their article («الم»).
  if (token.startsWith("ال") && token.length > 4) token = token.slice(2);
  if (FILLER_WORDS.has(token)) return "";
  // A lone letter is an abbreviation («ش», «ع», «st»), never the address itself.
  if (token.length < 2) return "";
  return token;
};

export const tokenizeAddress = (...parts) => {
  const tokens = new Set();
  for (const part of parts) {
    for (const raw of normalizeArabicText(part).split(" ")) {
      if (!raw) continue;
      const token = normalizeToken(raw);
      if (token) tokens.add(token);
    }
  }
  return [...tokens].sort();
};

const isNumberToken = (token) => /^\d+$/.test(token);

/*
 * Governorates reach the orders table as Bosta ids («alex-city»), Arabic names («الإسكندرية») or
 * English names («Alexandria»). One key per governorate, so the candidate search is not split
 * three ways.
 */
const GOVERNORATE_ALIASES = {
  cairo: ["القاهره", "قاهره", "cairo"],
  giza: ["الجيزه", "جيزه", "giza", "gizeh"],
  alexandria: ["الاسكندريه", "اسكندريه", "alexandria", "alex", "alexandria city"],
  dakahlia: ["الدقهليه", "دقهليه", "dakahlia", "dakahleya", "daqahlia"],
  red_sea: ["البحر الاحمر", "red sea", "hurghada"],
  beheira: ["البحيره", "بحيره", "beheira", "behera", "el beheira"],
  fayoum: ["الفيوم", "فيوم", "fayoum", "faiyum", "fayum"],
  gharbia: ["الغربيه", "غربيه", "gharbia", "gharbeya", "gharbiya"],
  ismailia: ["الاسماعيليه", "اسماعيليه", "ismailia"],
  menofia: ["المنوفيه", "منوفيه", "menofia", "monufia", "menoufia"],
  minya: ["المنيا", "منيا", "minya", "menya", "el minya"],
  qalyubia: ["القليوبيه", "قليوبيه", "qalyubia", "qaliubiya", "kalyubia"],
  new_valley: ["الوادي الجديد", "new valley"],
  suez: ["السويس", "سويس", "suez"],
  aswan: ["اسوان", "aswan"],
  assiut: ["اسيوط", "assiut", "asyut"],
  beni_suef: ["بني سويف", "beni suef", "bani sweif"],
  port_said: ["بورسعيد", "بور سعيد", "port said", "portsaid"],
  damietta: ["دمياط", "damietta"],
  sharqia: ["الشرقيه", "شرقيه", "sharqia", "sharkia", "sharkeya", "el sharqia"],
  south_sinai: ["جنوب سيناء", "جنوب سينا", "south sinai"],
  kafr_el_sheikh: ["كفر الشيخ", "kafr el sheikh", "kafr elsheikh", "kafr alsheikh"],
  matrouh: ["مطروح", "مرسي مطروح", "matrouh", "marsa matrouh"],
  luxor: ["الاقصر", "اقصر", "luxor"],
  qena: ["قنا", "qena"],
  north_sinai: ["شمال سيناء", "شمال سينا", "north sinai"],
  sohag: ["سوهاج", "sohag", "suhag"],
};

const squash = (value) => normalizeArabicText(value).replace(/\s+/g, "");
const GOVERNORATE_LOOKUP = new Map();
for (const [key, aliases] of Object.entries(GOVERNORATE_ALIASES)) {
  GOVERNORATE_LOOKUP.set(squash(key), key);
  for (const alias of aliases) GOVERNORATE_LOOKUP.set(squash(alias), key);
}

export const resolveGovernorateKey = (...candidates) => {
  for (const candidate of candidates) {
    const raw = squash(String(candidate || "").replace(/[-_ ]?(city|gov|governorate)$/i, ""));
    if (!raw) continue;
    if (GOVERNORATE_LOOKUP.has(raw)) return GOVERNORATE_LOOKUP.get(raw);
    const withoutArticle = raw.replace(/^(el|al)/, "");
    if (GOVERNORATE_LOOKUP.has(withoutArticle)) return GOVERNORATE_LOOKUP.get(withoutArticle);
  }
  // An unknown governorate still separates orders — just under its own spelling.
  const fallback = candidates.map((value) => squash(value)).find(Boolean);
  return fallback || "";
};

/** What the sweeper stores on the order. Null tokens = nothing to compare on. */
export const buildAddressFingerprint = (order = {}) => {
  const tokens = tokenizeAddress(
    order.street_address,
    order.customer_address,
    order.building_number,
    order.floor_number,
    order.apartment_number
  );
  const region = resolveGovernorateKey(order.governorate_id, order.governorate);
  const words = tokens.filter((token) => !isNumberToken(token));
  const numbers = tokens.filter(isNumberToken);
  // «5 3 2» alone, or a single word, says nothing about which house it is.
  const usable = words.length >= 1 && tokens.length >= 2;
  return {
    region,
    tokens: usable ? tokens : null,
    key: usable ? `${region}|${tokens.join(" ")}` : null,
    words,
    numbers,
  };
};

const MIN_SIMILAR_SHARED_TOKENS = 3;
const MIN_CONTAINMENT = 0.85;

/*
 * exact: the same token set. A set without a number (a village line) needs three words to count,
 * a whole street is not one house.
 * similar: one address is (almost) inside the other — the storefront's split columns vs a
 * one-line inbox address. It must share a house number AND a word, and every number of the
 * shorter address must be in the longer one, so «التحرير 5» never matches «التحرير 7».
 */
export const compareAddressTokens = (left = [], right = []) => {
  if (!left?.length || !right?.length) return null;
  const a = new Set(left);
  const b = new Set(right);
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let shared = 0;
  let sharedWords = 0;
  let sharedNumbers = 0;
  for (const token of small) {
    if (!large.has(token)) continue;
    shared += 1;
    if (isNumberToken(token)) sharedNumbers += 1;
    else sharedWords += 1;
  }
  const smallNumbers = [...small].filter(isNumberToken);
  if (a.size === b.size && shared === a.size) {
    if (!smallNumbers.length && a.size < 3) return null;
    return { kind: "exact", score: 1 };
  }
  if (shared < MIN_SIMILAR_SHARED_TOKENS || !sharedWords || !sharedNumbers) return null;
  if (smallNumbers.some((token) => !large.has(token))) return null;
  const containment = shared / small.size;
  if (containment < MIN_CONTAINMENT) return null;
  return { kind: "similar", score: Math.round(containment * 100) / 100 };
};

export const normalizePersonName = (value = "") => normalizeArabicText(value).replace(/\s+/g, " ").trim();

/** «محمد احمد» and «محمد احمد علي» are one name; «محمد» vs «احمد» are two. */
export const namesLookDifferent = (left = "", right = "") => {
  const a = normalizePersonName(left);
  const b = normalizePersonName(right);
  if (!a || !b) return false;
  if (a === b) return false;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  if (shorter.length >= 3 && ` ${longer} `.includes(` ${shorter} `)) return false;
  return true;
};

export const orderPhoneKeys = (order = {}) =>
  [order.customer_phone, order.customer_secondary_phone].map((phone) => canonicalPhoneKey(phone)).filter(Boolean);

/** Both changed, as asked: another phone AND another name. A shared phone is the same buyer. */
export const isDifferentIdentity = (order = {}, other = {}) => {
  if (order.customer_id && other.customer_id && String(order.customer_id) === String(other.customer_id)) return false;
  const mine = orderPhoneKeys(order);
  const theirs = new Set(orderPhoneKeys(other));
  if (!mine.length || !theirs.size) return false;
  if (mine.some((key) => theirs.has(key))) return false;
  return namesLookDifferent(order.customer_name, other.customer_name);
};

/** Red = the earlier order was refused at the door or came back. */
export const isRefusedOrReturned = (order = {}) => {
  const status = normalizeOrderLifecycleStatus(order.status, "pending");
  if (status === "returned") return true;
  const shipping = normalizeShippingLifecycleStatus(order.shipping_status || order.shipment_status, "pending");
  if (["returned", "failed", "failed_delivery"].includes(shipping)) return true;
  const shipment = normalizeShippingLifecycleStatus(order.shipment_status, "pending");
  return ["returned", "failed", "failed_delivery"].includes(shipment);
};

export const alertSeverity = (matchedOrder = {}) => (isRefusedOrReturned(matchedOrder) ? "red" : "yellow");
