// Phase 1 pricing contract: manual override → current selling price → purchase-derived price → legacy fallback.
const money = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
};

const isActive = (value) => value === true || value === 1 || String(value || "").trim().toLowerCase() === "true";
const overridePrice = (record = {}) => isActive(record?.manual_price_override_active) ? money(record.manual_selling_price) : 0;

export const resolveCurrentSellingPrice = ({ product = {}, variant = {} } = {}) => {
  const variantManual = overridePrice(variant);
  if (variantManual) return { value: variantManual, source: "variant_manual_override" };
  const productManual = overridePrice(product);
  if (productManual) return { value: productManual, source: "product_manual_override" };
  const variantPurchase = money(variant.purchase_selling_price);
  if (variantPurchase) return { value: variantPurchase, source: "variant_purchase_selling_price" };
  const productPurchase = money(product.purchase_selling_price);
  if (productPurchase) return { value: productPurchase, source: "product_purchase_selling_price" };
  const variantLegacy = money(variant.selling_price) || money(variant.price) || money(variant.regular_price);
  if (variantLegacy) return { value: variantLegacy, source: "variant_legacy_price" };
  const productLegacy = money(product.selling_price) || money(product.price) || money(product.regular_price);
  if (productLegacy) return { value: productLegacy, source: "product_legacy_price" };
  return { value: 0, source: "fallback" };
};

export const applyCurrentSellingPrice = (product = {}, variant = null) => {
  const resolved = resolveCurrentSellingPrice({ product, variant: variant || {} });
  const annotate = (record = {}) => ({ ...record, current_selling_price: resolved.value, pricing_source: resolved.source });
  return { product: annotate(product), variant: variant ? annotate(variant) : null, ...resolved };
};
