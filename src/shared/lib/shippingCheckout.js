import { normalizeLanguage } from "../../i18n/i18n";

// Shipping-address helpers shared by the storefront checkout and the POS online-invoice mode.
// Both surfaces talk to the same Bosta pickers and the same /storefront/shipping/quote endpoint,
// so a second copy of this normalization would drift the moment either side gained a field.

// Arabic city names arrive spelled a dozen ways (أ/إ/آ/ا, ة/ه, ى/ي, with and without harakat),
// so matching a saved address against a picker option needs them folded to one form first.
export const normalizeCheckoutPickerText = (value = "") =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\u0625\u0623\u0622\u0627]/g, "\u0627")
    .replace(/[\u0629]/g, "\u0647")
    .replace(/[\u0649]/g, "\u064a")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

export const buildBostaPickerOption = (item = {}, scope = "city", lang = "ar") => {
  const nameAr = String(item.name_ar || item.governorate_name_ar || item.city_name_ar || item.area_name_ar || "").trim();
  const nameEn = String(item.name_en || item.governorate_name_en || item.city_name_en || item.area_name_en || "").trim();
  const label = normalizeLanguage(lang) === "ar" ? (nameAr || nameEn) : (nameEn || nameAr);
  const secondary = [nameAr && nameAr !== label ? nameAr : "", nameEn && nameEn !== label ? nameEn : ""].filter(Boolean).join(" / ");
  const id = String(item.id || item.value || item.districtId || item.zoneId || item.cityId || item.governorateId || "").trim();
  const value = String(item.value || item.id || item.districtId || item.zoneId || item.cityId || item.governorateId || id || "").trim();
  const districtId = String(item.districtId || item.district_id || item.provider_district_id || item.providerDistrictId || item.district || "").trim();
  const name = label || id;
  const searchText = normalizeCheckoutPickerText([
    nameAr,
    nameEn,
    item.provider_city_id,
    item.provider_zone_id,
    item.provider_district_id,
    item.code,
    item.zone_code,
    item.governorate_name_en,
    item.governorate_name_ar,
    item.name,
    item.district,
    item.district_name,
    item.district_name_ar,
    item.district_name_en,
  ].filter(Boolean).join(" "));
  return {
    id,
    value,
    districtId,
    name,
    nameAr,
    nameEn,
    label: label || id,
    secondary,
    searchText,
    scope,
    raw: item,
  };
};

export const buildBostaPickerOptions = (items = [], scope = "city", lang = "ar") =>
  items.map((item) => buildBostaPickerOption(item, scope, lang)).filter((option) => option.id || option.label);

// The quote endpoint answers with a flat shape on some providers and a nested `zone` on others;
// every consumer wants the ids flattened, so it happens once here.
export const normalizeShippingQuote = (quote = {}) => ({
  loading: false,
  price: Number.isFinite(Number(quote.price ?? quote.shipping_price)) ? Number(quote.price ?? quote.shipping_price) : 0,
  cod_allowed: quote.cod_allowed !== false,
  requires_shipping_proof: quote.requires_shipping_proof !== false,
  estimated_delivery_text: String(quote.estimated_delivery_text || ""),
  match_level: String(quote.match_level || ""),
  provider: String(quote.provider || "manual"),
  provider_id: String(quote.provider_id || quote.provider || "in_store_delivery"),
  zone: quote.zone || null,
  governorate_id: String(quote.governorate_id || quote.zone?.governorate_id || ""),
  city_id: String(quote.city_id || quote.zone?.city_id || ""),
  area_id: String(quote.area_id || quote.zone?.area_id || quote.zone?.district_id || ""),
  district_id: String(quote.district_id || quote.zone?.district_id || quote.zone?.area_id || ""),
  zone_id: String(quote.zone_id || quote.zone?.zone_id || ""),
  free_shipping_threshold: Number.isFinite(Number(quote.free_shipping_threshold)) ? Number(quote.free_shipping_threshold) : 0,
  original_price: Number.isFinite(Number(quote.original_price)) ? Number(quote.original_price) : 0,
  free_shipping_applied: Boolean(quote.free_shipping_applied),
});

export const matchBostaPickerOption = (options = [], source = {}) => {
  const savedIds = [
    source.shipping_district_id,
    source.district_id,
    source.bosta_district_id,
    source.provider_district_id,
    source.id,
    source.value,
  ].map((value) => String(value || "").trim()).filter(Boolean);
  const savedNames = [
    source.district,
    source.district_name,
    source.district_name_ar,
    source.district_name_en,
    source.area,
    source.area_name,
    source.area_name_ar,
    source.area_name_en,
    source.city_area,
  ].map((value) => normalizeCheckoutPickerText(value)).filter(Boolean);
  return options.find((option) => {
    const optionIds = [
      option.id,
      option.value,
      option.districtId,
      option.raw?.district_id,
      option.raw?.provider_district_id,
      option.raw?.id,
    ].map((value) => String(value || "").trim()).filter(Boolean);
    if (savedIds.some((id) => optionIds.some((optionId) => String(optionId) === String(id)))) return true;
    if (!savedNames.length) return false;
    const optionNames = [
      option.name,
      option.nameAr,
      option.nameEn,
      option.label,
      option.raw?.name,
      option.raw?.name_ar,
      option.raw?.name_en,
      option.raw?.district,
      option.raw?.district_name,
      option.raw?.district_name_ar,
      option.raw?.district_name_en,
    ].map((value) => normalizeCheckoutPickerText(value)).filter(Boolean);
    return savedNames.some((savedName) => optionNames.some((optionName) => optionName === savedName));
  }) || null;
};

// Bosta answers with its own city/zone/district ids, but an order also has to carry the
// human-readable governorate/city/area the rest of the ERP reads. Picking a level therefore
// rewrites several form fields at once and clears every level below it — returned here as a
// patch so both checkouts apply the identical rule.
export const bostaCityPatch = (cities = [], value) => {
  const selected = cities.find((city) => {
    const cityIds = [
      city.id,
      city.value,
      city.city_id,
      city.provider_city_id,
      city.governorate_id,
      city.provider_governorate_id,
    ].map((item) => String(item || "").trim()).filter(Boolean);
    return cityIds.some((item) => String(item) === String(value));
  });
  return {
    governorate_id: selected?.provider_city_id || "",
    governorate: selected?.name_ar || selected?.name_en || "",
    city_id: selected?.provider_city_id || "",
    city: selected?.name_ar || selected?.name_en || "",
    city_area: selected?.name_ar || selected?.name_en || "",
    shipping_city_id: selected?.id ? String(selected.id) : "",
    zone_id: "",
    zone: "",
    shipping_zone_id: "",
    area_id: "",
    area: "",
    district_id: "",
    district: "",
    shipping_district_id: "",
  };
};

export const bostaZonePatch = (zones = [], value) => {
  const selected = zones.find((zone) => {
    const zoneIds = [
      zone.id,
      zone.value,
      zone.zoneId,
      zone.provider_zone_id,
      zone.provider_district_id,
      zone.district_id,
    ].map((item) => String(item || "").trim()).filter(Boolean);
    return zoneIds.some((item) => String(item) === String(value));
  });
  return {
    zone_id: selected?.provider_zone_id || "",
    zone: selected?.name_ar || selected?.name_en || "",
    shipping_zone_id: selected?.id ? String(selected.id) : "",
    area_id: "",
    area: "",
    district_id: "",
    district: "",
    shipping_district_id: "",
  };
};

// Unlike the other two levels this one keeps the previous city_area when nothing matched, so it
// needs the current value rather than replacing it blind.
export const bostaDistrictPatch = (districtOptions = [], value, previousCityArea = "") => {
  const selected = matchBostaPickerOption(districtOptions, {
    shipping_district_id: value,
    district_id: value,
    bosta_district_id: value,
  });
  const districtId = selected?.districtId || selected?.raw?.provider_district_id || selected?.raw?.district_id || selected?.id || "";
  const name = selected?.nameAr || selected?.nameEn || selected?.name || "";
  return {
    area_id: districtId,
    area: name,
    district_id: districtId,
    district: name,
    city_area: name || previousCityArea,
    shipping_district_id: selected?.id ? String(selected.id) : String(value || ""),
  };
};
