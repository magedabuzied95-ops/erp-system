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
  ["\u062f\u0645\u064a\u0627\u0637", "damietta"],
  ["damietta", "damietta"],
  ["\u062f\u0645\u064a\u0627\u0637 \u0627\u0644\u062c\u062f\u064a\u062f\u0647", "new damietta"],
  ["new damietta", "new damietta"],
  ["\u0627\u0644\u0642\u0627\u0647\u0631\u0647", "cairo"],
  ["cairo", "cairo"],
  ["\u0627\u0644\u062c\u064a\u0632\u0647", "giza"],
  ["giza", "giza"],
  ["\u0627\u0644\u0627\u0633\u0643\u0646\u062f\u0631\u064a\u0647", "alexandria"],
  ["\u0627\u0633\u0643\u0646\u062f\u0631\u064a\u0647", "alexandria"],
  ["alexandria", "alexandria"],
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

export const resolveStorefrontShippingQuote = async ({ governorate = "", city = "", area = "" } = {}) => {
  const { defaultPrice, zones } = await loadShippingZones();
  const target = {
    governorate: shippingKey(governorate),
    city: shippingKey(city),
    area: shippingKey(area),
  };

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
  const price = match ? number(match.price, defaultPrice) : defaultPrice;

  return {
    price,
    shipping_price: price,
    cod_allowed: match ? Boolean(match.cod_allowed) : true,
    requires_shipping_proof: match ? Boolean(match.requires_shipping_proof) : true,
    estimated_delivery_text: match?.estimated_delivery_text || "",
    match_level: match ? (zoneArea(match) ? "area" : zoneCity(match) ? "city" : "governorate") : "default",
    zone: match || null,
    default_shipping_price: defaultPrice,
  };
};
