import db from "../database/db.js";

const text = (value = "") => String(value ?? "").trim();
const lower = (value = "") => text(value).toLowerCase();
const numeric = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const numberOrNull = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const columnCache = new Map();
const tableColumns = async (tableName) => {
  if (columnCache.has(tableName)) return columnCache.get(tableName);
  const result = await db.query(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = $1
    `,
    [tableName]
  );
  const columns = new Set(result.rows.map((row) => row.column_name));
  columnCache.set(tableName, columns);
  return columns;
};

const jsonExpr = (tableAlias, columns, columnName, fallback = "'[]'::jsonb") =>
  columns.has(columnName) ? `COALESCE(${tableAlias}.${columnName}, ${fallback})` : fallback;

const tagsExpr = (columns) =>
  columns.has("tags")
    ? `CASE
        WHEN p.tags IS NULL THEN '[]'::jsonb
        WHEN jsonb_typeof(to_jsonb(p.tags)) = 'array' THEN to_jsonb(p.tags)
        ELSE to_jsonb(string_to_array(p.tags::text, ','))
      END`
    : "'[]'::jsonb";

const textExpr = (tableAlias, columns, columnName, fallback = "''") =>
  columns.has(columnName) ? `COALESCE(${tableAlias}.${columnName}::text, ${fallback})` : fallback;

const priceExpr = (columns) => {
  const parts = ["sale_price", "regular_price", "selling_price", "price"]
    .filter((column) => columns.has(column))
    .map((column) => `NULLIF(p.${column}, 0)`);
  return parts.length ? `COALESCE(${parts.join(", ")}, 0)` : "0";
};

const variantPriceExpr = (columns, productPriceSql) => {
  const parts = ["sale_price", "regular_price", "selling_price", "price"]
    .filter((column) => columns.has(column))
    .map((column) => `NULLIF(pv.${column}, 0)`);
  return parts.length ? `COALESCE(${parts.join(", ")}, ${productPriceSql}, 0)` : productPriceSql;
};

const splitWords = (value = "") =>
  lower(value)
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .split(/\s+/)
    .map(text)
    .filter((word) => word.length >= 2);

const normalizeNumberWords = (value = "") =>
  lower(value)
    .replace(/\bfour\b/g, "4")
    .replace(/\biv\b/g, "4")
    .replace(/٤/g, "4")
    .replace(/\bone\b/g, "1")
    .replace(/١/g, "1");

const productHaystack = (product = {}) =>
  normalizeNumberWords([
    product.name,
    product.brand,
    product.model,
    product.category,
    product.product_type,
    product.style,
    product.grade,
    product.gender,
    product.seo_keywords,
    ...(Array.isArray(product.tags) ? product.tags : []),
  ].filter(Boolean).join(" "));

const inferJordanModel = (value = "") => {
  const source = normalizeNumberWords(value);
  const match = source.match(/\b(?:air\s+)?jordan\s*([0-9]{1,2})\b/) ||
    source.match(/\bj\s*([0-9]{1,2})\b/) ||
    source.match(/جوردن\s*([0-9]{1,2})/);
  return match ? `jordan ${match[1]}` : "";
};

const inferBrand = (product = {}) => {
  const explicit = lower(product.brand || product.brand_name);
  if (explicit) return explicit;
  const haystack = productHaystack(product);
  if (haystack.includes("jordan")) return "jordan";
  if (haystack.includes("nike")) return "nike";
  if (haystack.includes("adidas")) return "adidas";
  if (haystack.includes("north face") || haystack.includes("northface")) return "north face";
  return "";
};

const normalizeGender = (value = "") => {
  const safe = lower(value);
  if (["men", "man", "male", "mens", "رجالي", "رجال"].some((item) => safe.includes(item))) return "men";
  if (["women", "woman", "female", "ladies", "حريمي", "نسائي", "نساء"].some((item) => safe.includes(item))) return "women";
  if (["kids", "kid", "children", "child", "اطفال", "أطفال"].some((item) => safe.includes(item))) return "kids";
  return safe;
};

const availableSizes = (product = {}) =>
  [...new Set((Array.isArray(product.variants) ? product.variants : [])
    .filter((variant) => numeric(variant.stock, 0) > 0)
    .map((variant) => text(variant.size))
    .filter(Boolean))];

const hasRequestedSize = (product = {}, requestedSize = "") => {
  const safe = text(requestedSize);
  if (!safe) return true;
  return availableSizes(product).some((size) => text(size) === safe || text(size).replace(/\D/g, "") === safe.replace(/\D/g, ""));
};

const tokenOverlap = (left = [], right = []) => {
  const leftSet = new Set(left);
  return right.filter((token) => leftSet.has(token)).length;
};

const scoreCandidate = ({ active = {}, candidate = {}, activeVariantId = null, activeColor = "", requestedSize = "" } = {}) => {
  const activeId = String(active.id || active.product_id || "");
  const candidateId = String(candidate.id || candidate.product_id || "");
  const sameProduct = activeId && candidateId && activeId === candidateId;
  const activeBrand = inferBrand(active);
  const candidateBrand = inferBrand(candidate);
  const activeFamily = inferJordanModel(productHaystack(active)) || lower(active.model);
  const candidateFamily = inferJordanModel(productHaystack(candidate)) || lower(candidate.model);
  const activeCategory = lower(active.product_type || active.category || active.main_category || "");
  const candidateCategory = lower(candidate.product_type || candidate.category || candidate.main_category || "");
  const activeGender = normalizeGender(active.gender);
  const candidateGender = normalizeGender(candidate.gender);
  const activePrice = numeric(active.product_price || active.price || active.sale_price || active.regular_price, 0);
  const candidatePrice = numeric(candidate.product_price || candidate.price || candidate.sale_price || candidate.regular_price, 0);
  const activeTokens = splitWords(`${active.style || ""} ${active.product_type || ""} ${active.category || ""} ${active.seo_keywords || ""}`);
  const candidateTokens = splitWords(`${candidate.style || ""} ${candidate.product_type || ""} ${candidate.category || ""} ${candidate.seo_keywords || ""}`);
  const stock = numeric(candidate.total_stock, 0);
  const sizeOk = hasRequestedSize(candidate, requestedSize);
  const priceDelta = activePrice > 0 && candidatePrice > 0 ? Math.abs(candidatePrice - activePrice) / activePrice : 0;

  let score = 0;
  const reasons = [];
  if (sameProduct) {
    score += 220;
    reasons.push("same_model_other_color");
  }
  if (activeFamily && candidateFamily && activeFamily === candidateFamily) {
    score += 170;
    reasons.push("same_model_family");
  }
  if (activeBrand && candidateBrand && activeBrand === candidateBrand) {
    score += 90;
    reasons.push("same_brand");
  } else if (activeBrand && candidateBrand) {
    score -= 80;
    reasons.push("different_brand_penalty");
  }
  if (activeCategory && candidateCategory && activeCategory === candidateCategory) {
    score += 65;
    reasons.push("same_category");
  } else if (activeCategory && candidateCategory) {
    score -= 55;
    reasons.push("different_category_penalty");
  }
  if (activeGender && candidateGender && activeGender === candidateGender) {
    score += 35;
    reasons.push("same_gender");
  } else if (activeGender && candidateGender) {
    score -= 85;
    reasons.push("gender_mismatch_penalty");
  }
  const overlap = tokenOverlap(activeTokens, candidateTokens);
  if (overlap) {
    score += Math.min(45, overlap * 12);
    reasons.push("style_keyword_overlap");
  }
  if (priceDelta > 0 && priceDelta <= 0.2) {
    score += 35;
    reasons.push("price_within_20_percent");
  } else if (priceDelta > 0.45) {
    score -= 35;
    reasons.push("price_far_penalty");
  }
  if (stock > 0) {
    score += 45;
    reasons.push("has_stock");
  } else {
    score -= 110;
    reasons.push("no_stock_penalty");
  }
  if (requestedSize) {
    if (sizeOk) {
      score += 45;
      reasons.push("requested_size_available");
    } else {
      score -= 70;
      reasons.push("requested_size_missing_penalty");
    }
  }
  if (activeBrand === "jordan" && candidateBrand === "adidas") {
    score -= 120;
    reasons.push("jordan_to_adidas_penalty");
  }
  if (sameProduct && activeVariantId) {
    const hasDifferentVariant = (candidate.variants || []).some((variant) => String(variant.id || "") !== String(activeVariantId));
    if (!hasDifferentVariant) score -= 250;
  }
  if (sameProduct && activeColor) {
    const hasDifferentColor = (candidate.variants || []).some((variant) => lower(variant.color) && lower(variant.color) !== lower(activeColor));
    if (!hasDifferentColor) score -= 250;
  }
  return { score, reasons, stock, sizeOk, sameProduct, sameFamily: Boolean(activeFamily && candidateFamily && activeFamily === candidateFamily) };
};

const filterActiveProductVariants = (product = {}, { activeVariantId = null, activeColor = "" } = {}) => {
  const activeVariant = text(activeVariantId);
  const activeColorSafe = lower(activeColor);
  const variants = (Array.isArray(product.variants) ? product.variants : []).filter((variant) => {
    if (activeVariant && String(variant.id || "") === activeVariant) return false;
    if (activeColorSafe && lower(variant.color) === activeColorSafe) return false;
    return numeric(variant.stock, 0) > 0;
  });
  return { ...product, variants, total_stock: variants.reduce((sum, variant) => sum + Math.max(0, numeric(variant.stock, 0)), 0) };
};

export const findSimilarProductsForAi = async ({
  tenantId,
  activeProductId,
  activeVariantId = null,
  activeColor = "",
  customerSize = "",
  limit = 4,
} = {}) => {
  const scopedTenantId = numberOrNull(tenantId);
  const activeId = numberOrNull(activeProductId);
  if (!scopedTenantId || !activeId) return { activeProduct: null, products: [], scoredCandidates: [] };

  const [productColumns, variantColumns] = await Promise.all([tableColumns("products"), tableColumns("product_variants")]);
  const productPriceSql = priceExpr(productColumns);
  const variantPriceSql = variantPriceExpr(variantColumns, productPriceSql);
  const productActiveSql = productColumns.has("status") ? "AND COALESCE(NULLIF(LOWER(TRIM(p.status)), ''), 'active') NOT IN ('inactive','disabled','archived','deleted')" : "";
  const productIsActiveSql = productColumns.has("is_active") ? "AND p.is_active IS DISTINCT FROM FALSE" : "";
  const variantActiveSql = variantColumns.has("is_active") ? "AND pv.is_active IS DISTINCT FROM FALSE" : "";
  const variantDeletedSql = variantColumns.has("deleted_at") ? "AND pv.deleted_at IS NULL" : "";

  const rows = await db.query(
    `
    SELECT
      p.id,
      ${textExpr("p", productColumns, "name")} AS name,
      ${textExpr("p", productColumns, "slug")} AS slug,
      ${textExpr("p", productColumns, "canonical_slug")} AS canonical_slug,
      ${textExpr("p", productColumns, "image_url")} AS image_url,
      ${textExpr("p", productColumns, "main_image")} AS main_image,
      ${textExpr("p", productColumns, "thumbnail")} AS thumbnail,
      COALESCE(NULLIF(${textExpr("p", productColumns, "brand")}, ''), COALESCE(b.name, '')) AS brand,
      ${textExpr("p", productColumns, "category")} AS category,
      ${textExpr("p", productColumns, "main_category")} AS main_category,
      ${textExpr("p", productColumns, "product_type")} AS product_type,
      ${textExpr("p", productColumns, "style")} AS style,
      ${textExpr("p", productColumns, "gender")} AS gender,
      ${textExpr("p", productColumns, "grade")} AS grade,
      ${textExpr("p", productColumns, "model")} AS model,
      ${textExpr("p", productColumns, "seo_keywords")} AS seo_keywords,
      ${tagsExpr(productColumns)} AS tags,
      ${jsonExpr("p", productColumns, "gallery_images")} AS gallery_images,
      ${productPriceSql} AS product_price,
      COALESCE(SUM(GREATEST(COALESCE(pv.stock, 0), 0)), 0)::int AS total_stock,
      COALESCE(
        jsonb_agg(
          DISTINCT jsonb_build_object(
            'id', pv.id,
            'product_id', pv.product_id,
            'name', ${textExpr("pv", variantColumns, "edition_name")},
            'size', ${textExpr("pv", variantColumns, "size")},
            'color', ${textExpr("pv", variantColumns, "color")},
            'sku', ${textExpr("pv", variantColumns, "sku")},
            'barcode', ${textExpr("pv", variantColumns, "barcode")},
            'image_url', ${textExpr("pv", variantColumns, "image_url")},
            'price', ${variantPriceSql},
            'stock', COALESCE(pv.stock, 0)
          )
        ) FILTER (WHERE pv.id IS NOT NULL),
        '[]'::jsonb
      ) AS variants
    FROM products p
    LEFT JOIN brands b ON b.id = p.brand_id
    LEFT JOIN product_variants pv ON pv.product_id = p.id
      AND pv.tenant_id = p.tenant_id
      ${variantActiveSql}
      ${variantDeletedSql}
    WHERE p.tenant_id = $1
      ${productActiveSql}
      ${productIsActiveSql}
    GROUP BY p.id, b.name
    ORDER BY CASE WHEN p.id = $2 THEN 0 ELSE 1 END, p.updated_at DESC NULLS LAST, p.id DESC
    LIMIT 220
    `,
    [scopedTenantId, activeId]
  );

  const products = rows.rows.map((row) => ({
    ...row,
    product_price: numeric(row.product_price, 0),
    total_stock: numeric(row.total_stock, 0),
    variants: Array.isArray(row.variants) ? row.variants : [],
    tags: Array.isArray(row.tags) ? row.tags : [],
  }));
  const activeProduct = products.find((product) => Number(product.id) === activeId) || null;
  console.log("[ai-alternatives] active product loaded", {
    tenant_id: scopedTenantId,
    active_product_id: activeId,
    active_variant_id: activeVariantId || null,
    active_color: activeColor || "",
    customer_size: customerSize || "",
    found: Boolean(activeProduct),
    name: activeProduct?.name || "",
    brand: activeProduct?.brand || "",
    category: activeProduct?.category || activeProduct?.product_type || "",
  });
  if (!activeProduct) return { activeProduct: null, products: [], scoredCandidates: [] };

  const scoredCandidates = products
    .map((candidate) => {
      const sameProduct = Number(candidate.id) === activeId;
      const productForScoring = sameProduct ? filterActiveProductVariants(candidate, { activeVariantId, activeColor }) : candidate;
      if (sameProduct && !productForScoring.variants.length) return null;
      const score = scoreCandidate({ active: activeProduct, candidate: productForScoring, activeVariantId, activeColor, requestedSize: customerSize });
      return { ...productForScoring, similarity_score: score.score, similarity_reasons: score.reasons, requested_size_available: score.sizeOk };
    })
    .filter(Boolean)
    .filter((candidate) => Number(candidate.id) !== activeId || candidate.variants.length > 0)
    .sort((left, right) => numeric(right.similarity_score, 0) - numeric(left.similarity_score, 0) || numeric(right.total_stock, 0) - numeric(left.total_stock, 0));

  console.log("[ai-alternatives] scored candidates", {
    tenant_id: scopedTenantId,
    active_product_id: activeId,
    count: scoredCandidates.length,
    top: scoredCandidates.slice(0, 12).map((candidate) => ({
      product_id: candidate.id,
      name: candidate.name,
      brand: candidate.brand,
      score: candidate.similarity_score,
      reasons: candidate.similarity_reasons,
      total_stock: candidate.total_stock,
    })),
  });

  const minScore = scoredCandidates.some((candidate) => numeric(candidate.similarity_score, 0) >= 180) ? 120 : 70;
  const selected = scoredCandidates
    .filter((candidate) => numeric(candidate.similarity_score, 0) >= minScore && numeric(candidate.total_stock, 0) > 0)
    .slice(0, Math.max(1, Number(limit) || 4));

  if (!selected.length) {
    console.log("[ai-alternatives] no close matches", {
      tenant_id: scopedTenantId,
      active_product_id: activeId,
      highest_score: scoredCandidates[0]?.similarity_score || 0,
    });
  } else {
    console.log("[ai-alternatives] selected products", {
      tenant_id: scopedTenantId,
      active_product_id: activeId,
      selected: selected.map((product) => ({
        product_id: product.id,
        name: product.name,
        brand: product.brand,
        score: product.similarity_score,
        reasons: product.similarity_reasons,
      })),
    });
  }

  return { activeProduct, products: selected, scoredCandidates };
};
