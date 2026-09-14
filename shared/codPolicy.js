import { egyptShippingLocationTree } from "./egyptShippingLocations.js";

// How an order is closed.
//   "open"       — every governorate may pay on delivery; a transfer pays the whole order.
//   "restricted" — only the listed governorates may pay on delivery; everyone else
//                  transfers the shipping fee before we ship, the goods are collected on delivery.
// One rule for the storefront quote, the checkout that charges it, and the
// staff screens that create orders by hand.
export const COD_POLICY_MODES = ["open", "restricted"];
export const DEFAULT_COD_GOVERNORATES = ["damietta"];

export const governorateOptions = egyptShippingLocationTree.map((governorate) => ({
  value: governorate.id,
  en: governorate.name_en,
  ar: governorate.name_ar,
}));

const normalizeArabic = (value) => String(value ?? "")
  .trim()
  .toLowerCase()
  .replace(/[ً-ْـ]/g, "")
  .replace(/[أإآ]/g, "ا")
  .replace(/ة/g, "ه")
  .replace(/ى/g, "ي")
  .replace(/^محافظه\s+/, "")
  .replace(/\s+governorate$/, "")
  .replace(/[^a-z0-9؀-ۿ]+/g, "")
  .replace(/^ال/, "");

// Bosta's city list (what the checkout picker sends) spells several of them its own way.
const BOSTA_SPELLINGS = {
  assiut: ["Assuit"],
  "beni-suef": ["Bani Suif"],
  beheira: ["Behira"],
  qalyubia: ["El Kalioubia", "Kalioubia"],
  "kafr-el-sheikh": ["Kafr Alsheikh"],
  minya: ["Menya"],
  matrouh: ["مرسي مطروح", "Marsa Matrouh"],
  sharqia: ["Sharkia"],
};

const governorateKeys = new Map();
for (const governorate of egyptShippingLocationTree) {
  for (const name of [governorate.id, governorate.name_en, governorate.name_ar, ...(BOSTA_SPELLINGS[governorate.id] || [])]) {
    governorateKeys.set(normalizeArabic(name), governorate.id);
  }
}

// Checkout sends a name in either language (the Bosta picker, the local catalog,
// a saved address) and sometimes an id; all of them land on the catalog id.
export const resolveGovernorateId = (...candidates) => {
  for (const candidate of candidates) {
    const key = normalizeArabic(candidate);
    if (key && governorateKeys.has(key)) return governorateKeys.get(key);
  }
  return "";
};

export const normalizeCodPolicy = ({ mode, governorates } = {}) => {
  const normalizedMode = COD_POLICY_MODES.includes(String(mode || "").trim()) ? String(mode).trim() : "open";
  const list = Array.isArray(governorates) ? governorates : DEFAULT_COD_GOVERNORATES;
  return {
    mode: normalizedMode,
    governorates: [...new Set(list.map((item) => resolveGovernorateId(item)).filter(Boolean))],
  };
};

// `shippingFee` is what the customer actually owes for delivery (0 after a
// free-shipping threshold or coupon). Nothing to prepay means nothing to force.
export const resolveCodPolicy = ({ policy, governorate = "", governorateId = "", shippingFee = 0, orderTotal = 0 } = {}) => {
  const { mode, governorates } = normalizeCodPolicy(policy);
  const fee = Math.max(0, Number(shippingFee) || 0);
  const total = Math.max(0, Number(orderTotal) || 0);
  if (mode !== "restricted") {
    return { mode, cod_allowed: true, advance: "order_total", advance_amount: total };
  }
  // The address text first: it is what the courier delivers to. An id is only a fallback,
  // so sending another governorate's id cannot buy cash on delivery.
  const id = resolveGovernorateId(governorate, governorateId);
  const advanceAmount = Math.min(fee, total);
  // An unknown governorate is not a listed one: the restriction fails closed.
  const listed = Boolean(id) && governorates.includes(id);
  return {
    mode,
    cod_allowed: listed || advanceAmount <= 0,
    advance: "shipping_fee",
    advance_amount: advanceAmount,
    governorate_id: id,
  };
};
