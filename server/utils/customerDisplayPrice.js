const toMoney = (value = null) => {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
};

const truthy = (value) =>
  value === true ||
  value === 1 ||
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .match(/^(true|1|yes|on|sale_active|is_sale_active|on_sale|sale_enabled|discount_enabled|has_sale|use_sale_price)$/);

const trace = (payload) => {
  console.log("[ai-price-source]", payload);
  const selected = toMoney(payload.selected_display_price);
  const cardPrice = toMoney(payload.card_price);
  if (selected > 0 && cardPrice > 0 && selected !== cardPrice) {
    console.error("[ai-price-mismatch]", {
      product_id: payload.product_id || null,
      variant_id: payload.variant_id || null,
      selected_display_price: selected,
      card_price: cardPrice,
      selected_price_source: payload.price_source || "",
    });
  }
};

export const resolveCustomerDisplayPrice = (productOrVariant = {}) => {
  const product = productOrVariant?.product || productOrVariant?.parent_product || productOrVariant?.parent || productOrVariant;
  const variant = productOrVariant?.variant || productOrVariant?.selected_variant || productOrVariant?.matched_variant || productOrVariant;
  const saleActive = truthy(
    productOrVariant.sale_active ??
      productOrVariant.is_sale_active ??
      productOrVariant.on_sale ??
      productOrVariant.sale_enabled ??
      productOrVariant.discount_enabled ??
      productOrVariant.has_sale ??
      productOrVariant.use_sale_price ??
      variant.sale_price_enabled ??
      variant.sale_enabled ??
      variant.on_sale ??
      variant.is_sale_active ??
      variant.discount_enabled ??
      product.sale_price_enabled ??
      product.sale_enabled ??
      product.on_sale ??
      product.is_sale_active ??
      product.discount_enabled ??
      product.has_sale
  );

  const selling_price = toMoney(
    productOrVariant.selling_price ??
      productOrVariant.price ??
      productOrVariant.regular_price ??
      variant.selling_price ??
      variant.price ??
      variant.regular_price ??
      product.selling_price ??
      product.price ??
      product.regular_price
  );
  const sale_price = toMoney(productOrVariant.sale_price ?? variant.sale_price ?? product.sale_price);
  const wholesale_price = toMoney(
    productOrVariant.wholesale_price ??
      variant.wholesale_price ??
      product.wholesale_price ??
      productOrVariant.purchase_price ??
      variant.purchase_price ??
      product.purchase_price ??
      productOrVariant.supplier_price ??
      variant.supplier_price ??
      product.supplier_price ??
      productOrVariant.average_cost ??
      variant.average_cost ??
      product.average_cost ??
      productOrVariant.last_purchase_price ??
      variant.last_purchase_price ??
      product.last_purchase_price
  );
  const cost_price = toMoney(productOrVariant.cost_price ?? variant.cost_price ?? product.cost_price);

  let display_price = saleActive && sale_price > 0 ? sale_price : selling_price;
  let price_source = saleActive && sale_price > 0 ? "sale_price" : "selling_price";
  if (["wholesale_price", "cost_price", "purchase_price", "supplier_price"].includes(price_source)) {
    console.error("[ai-price-source]", {
      product_id: productOrVariant.product_id || product.id || null,
      variant_id: productOrVariant.variant_id || variant.id || null,
      selling_price,
      sale_price,
      wholesale_price,
      cost_price,
      sale_active: saleActive,
      selected_display_price: selling_price,
      selected_price_source: "selling_price",
      blocked_source: price_source,
    });
    display_price = selling_price;
    price_source = "selling_price";
  }
  const old_price = saleActive && sale_price > 0 && selling_price > sale_price ? selling_price : null;
  const result = {
    display_price,
    old_price,
    price_source,
    sale_active: saleActive && sale_price > 0,
    selling_price,
    sale_price,
    wholesale_price,
    cost_price,
    product_id: productOrVariant.product_id || product.id || null,
    variant_id: productOrVariant.variant_id || variant.id || null,
  };
  trace({
    product_id: result.product_id,
    variant_id: result.variant_id,
    selling_price,
    sale_price,
    wholesale_price,
    cost_price,
    sale_active: result.sale_active,
    selected_display_price: result.display_price,
    selected_price_source: result.price_source,
  });
  return result;
};

export const formatCustomerDisplayPrice = (value) => {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? `${Math.round(amount)} جنيه` : "";
};

const collectPriceCandidates = ({ product = {}, variants = [] } = {}) => {
  const safeVariants = Array.isArray(variants) ? variants : [];
  const candidates = [
    { field: "sale_price", source: "product", value: product.sale_price },
    { field: "selling_price", source: "product", value: product.selling_price },
    { field: "price", source: "product", value: product.price },
  ];
  for (let index = 0; index < safeVariants.length; index += 1) {
    const variant = safeVariants[index] && typeof safeVariants[index] === "object" ? safeVariants[index] : {};
    candidates.push(
      { field: "sale_price", source: `variant[${index}]`, value: variant.sale_price },
      { field: "selling_price", source: `variant[${index}]`, value: variant.selling_price },
      { field: "price", source: `variant[${index}]`, value: variant.price }
    );
  }
  return candidates;
};

const toPositiveMoney = (value = null) => {
  const normalized = String(value ?? "").replace(/[^\d.-]/g, "").trim();
  if (!normalized) return null;
  const amount = Number(normalized);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
};

const normalizePriceText = (value = null) => {
  const amount = toPositiveMoney(value);
  if (amount == null) return "";
  return Number.isInteger(amount) ? String(amount) : String(amount.toFixed(2)).replace(/\.?0+$/g, "");
};

export const resolveSocialProductDisplayPrice = ({
  product = {},
  variants = [],
  context = {},
  callsite = "",
} = {}) => {
  const productName = String(context.product_name || product.name || product.product_name || "").trim();
  const productId = Number(context.product_id || product.id || product.product_id || 0) || null;
  const candidates = collectPriceCandidates({ product, variants });
  const selectedCandidate = candidates.find((candidate) => toPositiveMoney(candidate.value) !== null) || null;
  const selectedPrice = selectedCandidate ? toPositiveMoney(selectedCandidate.value) : null;
  const selectedDisplayPrice = normalizePriceText(selectedPrice);
  const result = {
    product_id: productId,
    product_name: productName,
    candidate_fields_found: candidates
      .filter((candidate) => toPositiveMoney(candidate.value) !== null)
      .map((candidate) => ({
        field: `${candidate.source}.${candidate.field}`,
        value: normalizePriceText(candidate.value),
      })),
    selected_field: selectedCandidate ? `${selectedCandidate.source}.${selectedCandidate.field}` : "",
    selected_price: selectedPrice,
    selected_display_price: selectedDisplayPrice,
    has_valid_price: Boolean(selectedDisplayPrice),
  };
  if (callsite) {
    console.log("SOCIAL_COMMENT_PRICE_RESOLVE_TRACE", {
      callsite,
      product_id: result.product_id,
      product_name: result.product_name,
      candidate_fields_found: result.candidate_fields_found,
      selected_field: result.selected_field,
      selected_price: result.selected_price,
      has_valid_price: result.has_valid_price,
    });
  }
  return result;
};
