import { getSetting } from "./settingsService.js";

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
  governorate: text(zone.governorate),
  city: text(zone.city || zone.markaz || zone.city_area),
  area: text(zone.area || zone.district),
  price: number(zone.price ?? zone.shipping_price),
  cod_allowed: bool(zone.cod_allowed ?? zone.codAllowed, true),
  requires_shipping_proof: bool(zone.requires_shipping_proof ?? zone.requiresShippingProof, true),
  estimated_delivery_text: text(zone.estimated_delivery_text || zone.estimatedDeliveryText || zone.eta),
  provider: text(zone.provider || "manual"),
  free_shipping_threshold: number(zone.free_shipping_threshold ?? zone.freeShippingThreshold, 0),
  minimum_order_for_cod: number(zone.minimum_order_for_cod ?? zone.minimumOrderForCod, 0),
  active: bool(zone.active, true),
});

export const loadShippingZones = async () => {
  const [defaultPrice, zones] = await Promise.all([
    getSetting("storefront.default_shipping_price", 60),
    getSetting("storefront.shipping_zones", []),
  ]);
  return {
    defaultPrice: number(defaultPrice, 0),
    zones: (Array.isArray(zones) ? zones : []).map(normalizeShippingZone).filter((zone) => zone.governorate && zone.active),
  };
};

export const resolveStorefrontShippingQuote = async ({ governorate = "", city = "", area = "", subtotal = 0, order_total = 0 } = {}) => {
  const { defaultPrice, zones } = await loadShippingZones();
  const target = {
    governorate: shippingKey(governorate),
    city: shippingKey(city),
    area: shippingKey(area),
  };
  const orderSubtotal = number(subtotal || order_total, 0);

  const zoneCity = (zone) => shippingKey(zone.city);
  const zoneArea = (zone) => shippingKey(zone.area);
  const matchesGovernorate = (zone) => shippingKey(zone.governorate) === target.governorate;
  const matchesCity = (zone) => matchesGovernorate(zone) && zoneCity(zone) && zoneCity(zone) === target.city;
  const matchesArea = (zone) =>
    matchesGovernorate(zone) &&
    zoneArea(zone) &&
    zoneArea(zone) === target.area &&
    (!zoneCity(zone) || !target.city || zoneCity(zone) === target.city);

  const match =
    zones.find(matchesArea) ||
    zones.find((zone) => matchesCity(zone) && !zoneArea(zone)) ||
    zones.find((zone) => matchesGovernorate(zone) && !zoneCity(zone) && !zoneArea(zone));
  const freeShippingThreshold = match ? number(match.free_shipping_threshold, 0) : 0;
  const matchedPrice = match ? number(match.price, defaultPrice) : defaultPrice;
  const price = freeShippingThreshold > 0 && orderSubtotal >= freeShippingThreshold ? 0 : matchedPrice;

  return {
    price,
    shipping_price: price,
    cod_allowed: match ? Boolean(match.cod_allowed) : true,
    requires_shipping_proof: match ? Boolean(match.requires_shipping_proof) : true,
    estimated_delivery_text: match?.estimated_delivery_text || "",
    provider: match?.provider || "manual",
    free_shipping_threshold: freeShippingThreshold,
    minimum_order_for_cod: match ? number(match.minimum_order_for_cod, 0) : 0,
    match_level: match ? (zoneArea(match) ? "area" : zoneCity(match) ? "city" : "governorate") : "default",
    zone: match || null,
    original_price: matchedPrice,
    free_shipping_applied: freeShippingThreshold > 0 && orderSubtotal >= freeShippingThreshold,
    default_shipping_price: defaultPrice,
  };
};
