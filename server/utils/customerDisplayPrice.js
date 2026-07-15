import db from "../database/db.js";
import { getWebsiteSettings } from "../services/liveActivityService.js";

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
  const saleModeOn = [
    productOrVariant.sale_active,
    productOrVariant.is_sale_active,
    productOrVariant.on_sale,
    productOrVariant.sale_enabled,
    productOrVariant.discount_enabled,
    productOrVariant.has_sale,
    productOrVariant.use_sale_price,
    productOrVariant.sale_mode_enabled,
    productOrVariant.global_sale_enabled,
    productOrVariant.sale_prices_enabled,
    variant.sale_price_enabled,
    variant.sale_mode_enabled,
    variant.global_sale_enabled,
    variant.sale_prices_enabled,
    variant.sale_enabled,
    variant.on_sale,
    variant.is_sale_active,
    variant.discount_enabled,
    product.sale_price_enabled,
    product.sale_enabled,
    product.on_sale,
    product.is_sale_active,
    product.discount_enabled,
    product.has_sale,
    product.sale_mode_enabled,
    product.global_sale_enabled,
    product.sale_prices_enabled,
  ].some((value) => Boolean(truthy(value)));

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
  const saleActive = saleModeOn && sale_price > 0 && (selling_price <= 0 || sale_price < selling_price);
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

  let display_price = saleActive ? sale_price : selling_price;
  let price_source = saleActive ? "sale_price" : "selling_price";
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
  const old_price = saleActive && selling_price > sale_price ? selling_price : null;
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

const SOCIAL_PRICE_FIELDS = ["sale_price", "selling_price", "price"];
const normalizedSocialPriceCandidate = ({
  source = "",
  field = "",
  value = null,
  index = null,
  variantId = null,
} = {}) => {
  const normalizedValue = toPositiveMoney(value);
  return {
    source,
    field,
    value,
    normalized_value: normalizedValue,
    index: Number.isFinite(Number(index)) ? Number(index) : null,
    variant_id: Number(variantId || 0) || null,
  };
};

const collectObjectPriceCandidates = ({ source = "", entity = null } = {}) => {
  const safeEntity = entity && typeof entity === "object" ? entity : null;
  if (!safeEntity) return [];
  return SOCIAL_PRICE_FIELDS
    .filter((field) => safeEntity[field] !== undefined && safeEntity[field] !== null && String(safeEntity[field]).trim() !== "")
    .map((field) => normalizedSocialPriceCandidate({
      source,
      field,
      value: safeEntity[field],
      variantId: safeEntity.id,
    }));
};

const collectVariantPriceCandidates = ({ source = "", variants = [] } = {}) =>
  (Array.isArray(variants) ? variants : []).flatMap((variant, index) => {
    const safeVariant = variant && typeof variant === "object" ? variant : null;
    if (!safeVariant) return [];
    return SOCIAL_PRICE_FIELDS
      .filter((field) => safeVariant[field] !== undefined && safeVariant[field] !== null && String(safeVariant[field]).trim() !== "")
      .map((field) => normalizedSocialPriceCandidate({
        source,
        field,
        value: safeVariant[field],
        index,
        variantId: safeVariant.id,
      }));
  });

const traceCandidateList = (candidates = []) =>
  candidates.map((candidate) => ({
    field: candidate.field,
    value: candidate.value,
    normalized_value: candidate.normalized_value,
    index: candidate.index,
    variant_id: candidate.variant_id,
  }));

export const selectPreferredSocialPriceCandidate = ({ candidates = [], saleModeEnabled = false } = {}) => {
  const preferredFields = saleModeEnabled
    ? ["sale_price", "selling_price", "price"]
    : ["selling_price", "price"];
  for (const field of preferredFields) {
    const match = candidates.find(
      (candidate) => candidate?.field === field && candidate.normalized_value !== null
    );
    if (match) return match;
  }
  return null;
};

const formatSelectedSocialPriceField = (candidate = null) => {
  if (!candidate?.source || !candidate?.field) return "";
  if (candidate.index !== null) return `${candidate.source}[${candidate.index}].${candidate.field}`;
  return `${candidate.source}.${candidate.field}`;
};

const loadSocialProductPriceDbFallback = async ({ tenantId = null, productId = null } = {}) => {
  const safeProductId = Number(productId || 0);
  if (!Number.isFinite(safeProductId) || safeProductId <= 0) return { product: null, variants: [] };
  const safeTenantId = Number(tenantId || 0);
  const [productResult, variantResult] = await Promise.all([
    db.query(
      `
      SELECT id, sale_price, selling_price, price
      FROM products
      WHERE id = $1
        AND ($2::bigint <= 0 OR tenant_id = $2::bigint OR tenant_id IS NULL)
      LIMIT 1
      `,
      [safeProductId, safeTenantId]
    ).catch(() => ({ rows: [] })),
    db.query(
      `
      SELECT id, product_id, sale_price, selling_price, price
      FROM product_variants
      WHERE product_id = $1
        AND ($2::bigint <= 0 OR tenant_id = $2::bigint OR tenant_id IS NULL)
      ORDER BY id ASC
      `,
      [safeProductId, safeTenantId]
    ).catch(() => ({ rows: [] })),
  ]);
  return {
    product: productResult.rows?.[0] || null,
    variants: Array.isArray(variantResult.rows) ? variantResult.rows : [],
  };
};

export const resolveSocialProductDisplayPrice = async ({
  tenantId = null,
  product = {},
  productContext = {},
  linkedProduct = {},
  variants = [],
  availableVariants = [],
  context = {},
  callsite = "",
} = {}) => {
  const pricingSettings = await getWebsiteSettings({ tenantId }).catch(() => ({ sale_mode_enabled: false }));
  const saleModeEnabled = Boolean(truthy(pricingSettings?.sale_mode_enabled));
  const productName = String(
    context.product_name ||
    productContext.product_name ||
    product.name ||
    product.product_name ||
    linkedProduct.name ||
    linkedProduct.product_name ||
    ""
  ).trim();
  const productId = Number(
    context.product_id ||
    productContext.product_id ||
    product.id ||
    product.product_id ||
    linkedProduct.id ||
    linkedProduct.product_id ||
    0
  ) || null;

  const primarySourceCandidates = [
    ...collectObjectPriceCandidates({ source: "product", entity: product }),
    ...collectObjectPriceCandidates({ source: "productContext", entity: productContext }),
    ...collectObjectPriceCandidates({ source: "linkedProduct", entity: linkedProduct }),
  ];
  const variantSourceCandidates = [
    ...collectVariantPriceCandidates({ source: "variants", variants }),
    ...collectVariantPriceCandidates({ source: "available_variants", variants: availableVariants }),
  ];
  const selectCandidate = (candidates = []) => selectPreferredSocialPriceCandidate({
    candidates,
    saleModeEnabled,
  });
  let selectedCandidate = selectCandidate([
    ...primarySourceCandidates,
    ...variantSourceCandidates,
  ]);

  let dbFallback = { product: null, variants: [] };
  let dbProductCandidates = [];
  let dbVariantCandidates = [];

  if (!selectedCandidate && productId) {
    dbFallback = await loadSocialProductPriceDbFallback({ tenantId, productId });
    dbProductCandidates = collectObjectPriceCandidates({ source: "products", entity: dbFallback.product });
    dbVariantCandidates = collectVariantPriceCandidates({ source: "product_variants_db", variants: dbFallback.variants });
    selectedCandidate = selectCandidate([
      ...dbProductCandidates,
      ...dbVariantCandidates,
    ]);
    if (selectedCandidate) {
      console.log("SOCIAL_COMMENT_PRICE_DB_FALLBACK_USED", {
        product_id: productId,
        selected_field: formatSelectedSocialPriceField(selectedCandidate),
        selected_price: selectedCandidate.normalized_value,
      });
    }
  }

  const selectedPrice = selectedCandidate?.normalized_value ?? null;
  const selectedDisplayPrice = normalizePriceText(selectedPrice);
  const candidateFieldsFound = [
    ...primarySourceCandidates,
    ...variantSourceCandidates,
    ...dbProductCandidates,
    ...dbVariantCandidates,
  ]
    .filter((candidate) => candidate.normalized_value !== null)
    .map((candidate) => ({
      field: formatSelectedSocialPriceField(candidate),
      value: normalizePriceText(candidate.normalized_value),
    }));
  const result = {
    product_id: productId,
    product_name: productName,
    candidate_fields_found: candidateFieldsFound,
    selected_field: formatSelectedSocialPriceField(selectedCandidate),
    selected_price: selectedPrice,
    selected_display_price: selectedDisplayPrice,
    sale_mode_enabled: saleModeEnabled,
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
      source_candidates: {
        product: traceCandidateList(collectObjectPriceCandidates({ source: "product", entity: product })),
        productContext: traceCandidateList(collectObjectPriceCandidates({ source: "productContext", entity: productContext })),
        linkedProduct: traceCandidateList(collectObjectPriceCandidates({ source: "linkedProduct", entity: linkedProduct })),
        variants: traceCandidateList(collectVariantPriceCandidates({ source: "variants", variants })),
        available_variants: traceCandidateList(collectVariantPriceCandidates({ source: "available_variants", variants: availableVariants })),
        product_variants_db: {
          product: traceCandidateList(dbProductCandidates),
          variants: traceCandidateList(dbVariantCandidates),
        },
      },
    });
  }
  return result;
};
