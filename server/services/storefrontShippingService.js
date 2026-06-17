import { getSetting } from "./settingsService.js";
import { normalizeShippingProviderKey } from "./shippingProviders/index.js";

const text = (value = "") => String(value ?? "").trim();

const normalize = (value = "") =>
  text(value)
    .toLowerCase()
    .replace(/[\u0625\u0623\u0622\u0627]/g, "\u0627")
    .replace(/[\u0629]/g, "\u0647")
    .replace(/[\u0649]/g, "\u064a")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const aliases = new Map([
  ["\u0627\u0644\u0642\u0627\u0647\u0631\u0647", "cairo"],
  ["cairo", "cairo"],
  ["\u0627\u0644\u062c\u064a\u0632\u0647", "giza"],
  ["giza", "giza"],
  ["\u0627\u0644\u0627\u0633\u0643\u0646\u062f\u0631\u064a\u0647", "alexandria"],
  ["\u0627\u0633\u0643\u0646\u062f\u0631\u064a\u0647", "alexandria"],
  ["alexandria", "alexandria"],
  ["\u0627\u0644\u062f\u0642\u0647\u0644\u064a\u0647", "dakahlia"],
  ["dakahlia", "dakahlia"],
  ["\u0627\u0644\u0628\u062d\u0631 \u0627\u0644\u0627\u062d\u0645\u0631", "red sea"],
  ["red sea", "red sea"],
  ["\u0627\u0644\u0628\u062d\u064a\u0631\u0647", "beheira"],
  ["beheira", "beheira"],
  ["\u0627\u0644\u0641\u064a\u0648\u0645", "fayoum"],
  ["fayoum", "fayoum"],
  ["\u0627\u0644\u063a\u0631\u0628\u064a\u0647", "gharbia"],
  ["gharbia", "gharbia"],
  ["\u0627\u0644\u0627\u0633\u0645\u0627\u0639\u064a\u0644\u064a\u0647", "ismailia"],
  ["ismailia", "ismailia"],
  ["\u0627\u0644\u0645\u0646\u0648\u0641\u064a\u0647", "menofia"],
  ["menofia", "menofia"],
  ["menoufia", "menofia"],
  ["\u0627\u0644\u0645\u0646\u064a\u0627", "minya"],
  ["minya", "minya"],
  ["\u0627\u0644\u0642\u0644\u064a\u0648\u0628\u064a\u0647", "qalyubia"],
  ["qalyubia", "qalyubia"],
  ["qaliubiya", "qalyubia"],
  ["\u0627\u0644\u0648\u0627\u062f\u064a \u0627\u0644\u062c\u062f\u064a\u062f", "new valley"],
  ["new valley", "new valley"],
  ["\u0627\u0644\u0633\u0648\u064a\u0633", "suez"],
  ["suez", "suez"],
  ["\u0627\u0633\u0648\u0627\u0646", "aswan"],
  ["aswan", "aswan"],
  ["\u0627\u0633\u064a\u0648\u0637", "assiut"],
  ["assiut", "assiut"],
  ["asyut", "assiut"],
  ["\u0628\u0646\u064a \u0633\u0648\u064a\u0641", "beni suef"],
  ["beni suef", "beni suef"],
  ["\u0628\u0648\u0631\u0633\u0639\u064a\u062f", "port said"],
  ["port said", "port said"],
  ["\u062f\u0645\u064a\u0627\u0637", "damietta"],
  ["damietta", "damietta"],
  ["\u062f\u0645\u064a\u0627\u0637 \u0627\u0644\u062c\u062f\u064a\u062f\u0647", "new damietta"],
  ["new damietta", "new damietta"],
  ["\u0627\u0644\u0634\u0631\u0642\u064a\u0647", "sharqia"],
  ["sharqia", "sharqia"],
  ["sharkia", "sharqia"],
  ["\u062c\u0646\u0648\u0628 \u0633\u064a\u0646\u0627\u0621", "south sinai"],
  ["south sinai", "south sinai"],
  ["\u0643\u0641\u0631 \u0627\u0644\u0634\u064a\u062e", "kafr el sheikh"],
  ["kafr el sheikh", "kafr el sheikh"],
  ["kafr el-sheikh", "kafr el sheikh"],
  ["\u0645\u0637\u0631\u0648\u062d", "matrouh"],
  ["matrouh", "matrouh"],
  ["\u0627\u0644\u0627\u0642\u0635\u0631", "luxor"],
  ["luxor", "luxor"],
  ["\u0642\u0646\u0627", "qena"],
  ["qena", "qena"],
  ["\u0634\u0645\u0627\u0644 \u0633\u064a\u0646\u0627\u0621", "north sinai"],
  ["north sinai", "north sinai"],
  ["\u0633\u0648\u0647\u0627\u062c", "sohag"],
  ["sohag", "sohag"],
]);

const shippingKey = (value = "") => aliases.get(normalize(value)) || normalize(value);

const number = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

const bool = (value, fallback = false) => {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "string") return ["1", "true", "yes", "on"].includes(value.toLowerCase());
  return Boolean(value);
};

export const normalizeShippingZone = (zone = {}, index = 0) => ({
  id: text(zone.id) || `zone-${index + 1}`,
  governorate_id: text(zone.governorate_id || zone.governorateId),
  governorate: text(zone.governorate),
  city: text(zone.city || zone.markaz || zone.city_area),
  city_id: text(zone.city_id || zone.cityId),
  area: text(zone.area || zone.district || zone.zone),
  district: text(zone.district || zone.area),
  zone: text(zone.zone || zone.area),
  area_id: text(zone.area_id || zone.areaId || zone.location_id || zone.locationId || zone.district_id || zone.districtId),
  district_id: text(zone.district_id || zone.districtId || zone.area_id || zone.areaId || zone.location_id || zone.locationId),
  zone_id: text(zone.zone_id || zone.zoneId),
  provider_location_code: text(zone.provider_location_code || zone.zone_code || zone.providerLocationCode),
  provider_city_id: text(zone.provider_city_id || zone.providerCityId),
  provider_district_id: text(zone.provider_district_id || zone.providerDistrictId),
  provider_zone_id: text(zone.provider_zone_id || zone.providerZoneId),
  price: number(zone.price ?? zone.shipping_price),
  cod_allowed: bool(zone.cod_allowed ?? zone.codAllowed, true),
  requires_shipping_proof: bool(zone.requires_shipping_proof ?? zone.requiresShippingProof, true),
  estimated_delivery_text: text(zone.estimated_delivery_text || zone.estimatedDeliveryText || zone.eta),
  provider: normalizeShippingProviderKey(zone.provider || zone.shipping_provider || "in_store_delivery"),
  provider_id: normalizeShippingProviderKey(zone.provider_id || zone.shipping_provider_id || zone.provider || zone.shipping_provider || "in_store_delivery"),
  free_shipping_threshold: number(zone.free_shipping_threshold ?? zone.freeShippingThreshold, 0),
  minimum_order_for_cod: number(zone.minimum_order_for_cod ?? zone.minimumOrderForCod, 0),
  active: bool(zone.active, true),
});

export const loadShippingZones = async () => {
  const [defaultPrice, zones, defaultProvider, locations] = await Promise.all([
    getSetting("storefront.default_shipping_price", 60),
    getSetting("storefront.shipping_zones", []),
    getSetting("orders.shipping_provider", "in_store_delivery"),
    getSetting("storefront.shipping_locations", []),
  ]);
  const locationList = Array.isArray(locations) ? locations : [];
  const locationByNames = new Map(locationList.map((location) => [
    [
      shippingKey(location.governorate_name_en || location.governorate),
      shippingKey(location.city_name_en || location.city),
      shippingKey(location.district_name_en || location.area_name_en || location.district || location.area),
      shippingKey(location.zone_name_en || location.zone || location.area_name_en || location.area),
    ].join("|"),
    location,
  ]));
  const enrichZone = (zone, index) => {
    const normalized = normalizeShippingZone(zone, index);
    const matchedLocation = locationByNames.get([
      shippingKey(normalized.governorate),
      shippingKey(normalized.city),
      shippingKey(normalized.district || normalized.area),
      shippingKey(normalized.zone || normalized.area),
    ].join("|"));
    return normalizeShippingZone({
      ...normalized,
      governorate_id: normalized.governorate_id || matchedLocation?.governorate_id,
      city_id: normalized.city_id || matchedLocation?.city_id,
      district_id: normalized.district_id || matchedLocation?.district_id,
      area_id: normalized.area_id || matchedLocation?.area_id || matchedLocation?.district_id,
      zone_id: normalized.zone_id || matchedLocation?.zone_id,
      provider_city_id: normalized.provider_city_id || matchedLocation?.provider_city_id,
      provider_district_id: normalized.provider_district_id || matchedLocation?.provider_district_id,
      provider_zone_id: normalized.provider_zone_id || matchedLocation?.provider_zone_id,
    }, index);
  };
  return {
    defaultPrice: number(defaultPrice, 0),
    defaultProvider: normalizeShippingProviderKey(defaultProvider),
    zones: (Array.isArray(zones) ? zones : []).map(enrichZone).filter((zone) => zone.governorate && zone.active),
  };
};

export const resolveStorefrontShippingQuote = async ({ governorate = "", city = "", area = "", governorate_id = "", city_id = "", area_id = "", district_id = "", zone_id = "", location_id = "", subtotal = 0, order_total = 0 } = {}) => {
  const { defaultPrice, defaultProvider, zones } = await loadShippingZones();
  const ids = {
    governorate_id: text(governorate_id),
    city_id: text(city_id),
    area_id: text(area_id || district_id || location_id),
    district_id: text(district_id || area_id || location_id),
    zone_id: text(zone_id),
  };
  const target = {
    governorate: shippingKey(governorate),
    city: shippingKey(city),
    area: shippingKey(area),
  };
  const orderSubtotal = number(subtotal || order_total, 0);

  const zoneCity = (zone) => shippingKey(zone.city);
  const zoneArea = (zone) => shippingKey(zone.area);
  const zoneDistrict = (zone) => shippingKey(zone.district || zone.area);
  const zoneZone = (zone) => shippingKey(zone.zone || zone.area);
  const matchesZoneId = (zone) => ids.zone_id && zone.zone_id && zone.zone_id === ids.zone_id;
  const matchesDistrictId = (zone) => ids.district_id && zone.district_id && zone.district_id === ids.district_id;
  const matchesAreaId = (zone) => ids.area_id && zone.area_id && zone.area_id === ids.area_id;
  const matchesCityId = (zone) => ids.city_id && zone.city_id && zone.city_id === ids.city_id;
  const matchesGovernorateId = (zone) => ids.governorate_id && zone.governorate_id && zone.governorate_id === ids.governorate_id;
  const matchesGovernorate = (zone) => shippingKey(zone.governorate) === target.governorate;
  const matchesCity = (zone) => matchesGovernorate(zone) && zoneCity(zone) && zoneCity(zone) === target.city;
  const matchesArea = (zone) =>
    matchesGovernorate(zone) &&
    zoneArea(zone) &&
    zoneArea(zone) === target.area &&
    (!zoneCity(zone) || !target.city || zoneCity(zone) === target.city);

  const match =
    zones.find(matchesZoneId) ||
    zones.find((zone) => matchesDistrictId(zone) && !zone.zone_id && !zoneZone(zone)) ||
    zones.find(matchesAreaId) ||
    zones.find((zone) => matchesCityId(zone) && !zone.district_id && !zone.zone_id && !zone.area_id && !zoneDistrict(zone) && !zoneArea(zone)) ||
    zones.find((zone) => matchesGovernorateId(zone) && !zone.city_id && !zone.district_id && !zone.zone_id && !zone.area_id && !zoneCity(zone) && !zoneDistrict(zone) && !zoneArea(zone)) ||
    zones.find(matchesArea) ||
    zones.find((zone) => matchesCity(zone) && !zoneArea(zone)) ||
    zones.find((zone) => matchesGovernorate(zone) && !zoneCity(zone) && !zoneArea(zone));
  const freeShippingThreshold = match ? number(match.free_shipping_threshold, 0) : 0;
  const matchedPrice = match ? number(match.price, defaultPrice) : defaultPrice;
  const price = freeShippingThreshold > 0 && orderSubtotal >= freeShippingThreshold ? 0 : matchedPrice;

  return {
    price,
    shipping_price: price,
    cod_allowed: true,
    requires_shipping_proof: match ? Boolean(match.requires_shipping_proof) : true,
    estimated_delivery_text: match?.estimated_delivery_text || "",
    provider: match?.provider || defaultProvider,
    provider_id: match?.provider_id || match?.provider || defaultProvider,
    governorate_id: match?.governorate_id || "",
    city_id: match?.city_id || "",
    area_id: match?.area_id || match?.district_id || "",
    district_id: match?.district_id || match?.area_id || "",
    zone_id: match?.zone_id || "",
    provider_city_id: match?.provider_city_id || "",
    provider_district_id: match?.provider_district_id || "",
    provider_zone_id: match?.provider_zone_id || "",
    free_shipping_threshold: freeShippingThreshold,
    minimum_order_for_cod: match ? number(match.minimum_order_for_cod, 0) : 0,
    match_level: match ? (match.zone_id || zoneZone(match) ? "zone" : match.district_id || zoneDistrict(match) ? "district" : zoneCity(match) ? "city" : "governorate") : "default",
    zone: match || null,
    original_price: matchedPrice,
    free_shipping_applied: freeShippingThreshold > 0 && orderSubtotal >= freeShippingThreshold,
    default_shipping_price: defaultPrice,
  };
};
