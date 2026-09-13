// One definition of "these two shipping addresses are the same place".
//
// A customer who orders five times from the same flat produces five order rows
// whose address text differs only by spacing, أ/ا, ة/ه, Arabic-Indic digits or a
// trailing comma. Listing those as five saved addresses is noise, so every list
// of a customer's past addresses is collapsed through this fingerprint, newest
// row first. Pure ESM: the server and the tests read the same function.

const ARABIC_INDIC_DIGITS = /[٠-٩]/g;
const EASTERN_ARABIC_DIGITS = /[۰-۹]/g;
const ARABIC_DIACRITICS = /[ً-ٰٟـ]/g;

export const normalizeAddressPart = (value) =>
  String(value ?? "")
    .replace(ARABIC_INDIC_DIGITS, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(EASTERN_ARABIC_DIGITS, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace(ARABIC_DIACRITICS, "")
    .replace(/[آأإٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/**
 * The fingerprint of one address row. The courier's district id identifies the
 * area when it exists; the typed governorate/area names stand in for it on rows
 * that predate the Bosta picker. The street line falls back to the free-text
 * address for the same reason.
 */
export const customerAddressFingerprint = (address = {}) => {
  const area = String(address.shipping_district_id || "").trim()
    || [address.governorate, address.city_area].map(normalizeAddressPart).join("|");
  const street = normalizeAddressPart(address.street_address) || normalizeAddressPart(address.detailed_address || address.customer_address);
  return [
    area,
    street,
    normalizeAddressPart(address.building_number),
    normalizeAddressPart(address.floor_number),
    normalizeAddressPart(address.apartment_number),
  ].join("#");
};

/** Keep the first (newest) row of every distinct address, up to `limit`. */
export const dedupeCustomerAddresses = (rows = [], limit = 5) => {
  const seen = new Set();
  const unique = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row) continue;
    const fingerprint = customerAddressFingerprint(row);
    if (fingerprint.replace(/[#|]/g, "").trim() === "" || seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    unique.push(row);
    if (unique.length >= limit) break;
  }
  return unique;
};
