import { getProductsWithVariants } from "../../products/services/productsApi";
import { resolveProductImageUrl as resolvePosImageUrl } from "../../../shared/lib/imageUrls";
import { resolveSaleModePrice } from "../../../shared/lib/saleMode";

const unwrapArray = (payload) => {
  const value =
    payload?.products ??
    payload?.data ??
    payload?.result ??
    payload?.payload ??
    payload ??
    [];
  return Array.isArray(value) ? value : [];
};

const normalizeNumber = (value) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeText = (value) => {
  if (value === null || value === undefined) return "";
  return String(value).trim();
};

export { resolvePosImageUrl };

const getProductId = (row = {}) =>
  row.product_id ?? row.productId ?? row.id ?? row.product?.id ?? null;

const getVariantId = (row = {}) =>
  row.variant_id ?? row.variantId ?? row.variant?.id ?? null;

const getProductName = (row = {}) =>
  normalizeText(row.product_name ?? row.productName ?? row.name ?? row.product?.name);

const pickFirstText = (...values) => {
  for (const value of values) {
    const text = normalizeText(value);
    if (text) return text;
  }
  return "";
};

const pickClassificationText = (row = {}, sourceProduct = {}, snakeKey, camelKey) =>
  pickFirstText(
    row[snakeKey],
    row[camelKey],
    row.product?.[snakeKey],
    row.product?.[camelKey],
    row.variant?.[snakeKey],
    row.variant?.[camelKey],
    sourceProduct[snakeKey],
    sourceProduct[camelKey],
    sourceProduct.product?.[snakeKey],
    sourceProduct.product?.[camelKey]
  );

const normalizeVariant = (row = {}, sourceProduct = row, saleModeSettings = {}) => {
  const productId = getProductId(sourceProduct) ?? getProductId(row);
  const variantId = getVariantId(row) ?? (sourceProduct !== row ? row.id : null);
  const productName = getProductName(sourceProduct) || getProductName(row);
  const color = normalizeText(row.color ?? row.variant_color ?? row.variant?.color);
  const size = normalizeText(row.size ?? row.variant_size ?? row.variant?.size);
  const sku = normalizeText(
    row.sku ??
      row.variant_sku ??
      row.variantSku ??
      row.product_sku ??
      sourceProduct.sku ??
      sourceProduct.product_sku
  );
  const barcode = normalizeText(
    row.barcode ??
      row.variant_barcode ??
      row.variantBarcode ??
      row.product_barcode ??
      sourceProduct.barcode ??
      sourceProduct.product_barcode
  );
  const articleCode = normalizeText(
    row.article_code ??
      row.articleCode ??
      row.variant_article_code ??
      row.variantArticleCode ??
      row.model_code ??
      row.modelCode ??
      row.factory_model ??
      row.factoryModel ??
      row.factory_code ??
      row.factoryCode
  );
  const qrToken = normalizeText(
    row.qr_token ??
      row.qrToken ??
      row.product_qr_token ??
      row.productQrToken ??
      sourceProduct.qr_token ??
      sourceProduct.qrToken ??
      sourceProduct.product_qr_token ??
      sourceProduct.productQrToken
  );
  const variantImageUrl = resolvePosImageUrl(
    row.variant_image_url ??
      row.variantImageUrl ??
      row.variant?.image_url ??
      row.variant?.image
  );
  const finalImageUrl = resolvePosImageUrl(row.image_url);
  const productImageUrl = resolvePosImageUrl(
    row.product_image_url ??
      sourceProduct.product_image_url ??
      sourceProduct.image_url ??
      sourceProduct.image ??
      sourceProduct.photo_url ??
      sourceProduct.thumbnail_url
  );
  const imageUrl = variantImageUrl || finalImageUrl || productImageUrl;
  const regularPrice = normalizeNumber(
    row.regular_price ??
      row.variant_regular_price ??
      row.variant_price ??
      row.price ??
      sourceProduct.regular_price ??
      sourceProduct.price
  );
  const storedSalePrice = normalizeNumber(row.sale_price ?? row.variant_sale_price ?? sourceProduct.sale_price);
  const resolvedPrice = resolveSaleModePrice(
    {
      ...sourceProduct,
      ...row,
      id: productId,
      product_id: productId,
      regular_price: regularPrice,
      price: regularPrice,
      sale_price: storedSalePrice,
      sale_price_enabled: row.sale_price_enabled ?? sourceProduct.sale_price_enabled,
      sale_start_at: row.sale_start_at ?? sourceProduct.sale_start_at,
      sale_end_at: row.sale_end_at ?? sourceProduct.sale_end_at,
      cost_price: row.cost_price ?? sourceProduct.cost_price,
    },
    saleModeSettings
  );
  const price = resolvedPrice.final_price || regularPrice;
  const stock = normalizeNumber(
    row.stock ??
      row.variant_stock ??
      row.quantity ??
      sourceProduct.stock
  );
  const stockQuantity = Math.max(0, stock);
  const manufacturerId =
    row.manufacturer_id ??
    row.variant_manufacturer_id ??
    row.manufacturerId ??
    sourceProduct.manufacturer_id ??
    sourceProduct.variant_manufacturer_id ??
    null;
  return {
    id: variantId ?? `product:${productId}`,
    product_id: productId,
    variant_id: variantId,
    name: productName,
    product_name: productName,
    color,
    size,
    sku,
    barcode,
    qr_token: qrToken,
    qrToken,
    article_code: articleCode,
    image_url: imageUrl,
    product_image_url: productImageUrl,
    variant_image_url: variantImageUrl,
    regular_price: regularPrice,
    original_price: regularPrice,
    price,
    sale_price: price,
    final_price: price,
    sale_source: resolvedPrice.sale_source,
    sale_badge: resolvedPrice.sale_badge,
    sale_mode_applied: resolvedPrice.sale_mode_applied,
    stock: stockQuantity,
    stock_quantity: stockQuantity,
    available: stockQuantity > 0,
    brand_id: row.brand_id ?? row.brandId ?? sourceProduct.brand_id ?? sourceProduct.brandId ?? null,
    brand_name: pickFirstText(row.brand_name, row.brandName, row.brand, sourceProduct.brand_name, sourceProduct.brandName, sourceProduct.brand),
    brand: pickFirstText(row.brand, row.brand_name, sourceProduct.brand, sourceProduct.brand_name) || "Unbranded",
    category_id: row.category_id ?? row.categoryId ?? sourceProduct.category_id ?? sourceProduct.categoryId ?? null,
    parent_category_id: row.parent_category_id ?? row.parentCategoryId ?? sourceProduct.parent_category_id ?? sourceProduct.parentCategoryId ?? null,
    category: pickFirstText(row.category, row.category_name, sourceProduct.category, sourceProduct.category_name) || "Uncategorized",
    category_name: pickFirstText(row.category_name, row.category, sourceProduct.category_name, sourceProduct.category),
    category_path: pickFirstText(row.category_path, row.categoryPath, sourceProduct.category_path, sourceProduct.categoryPath),
    audiences: Array.isArray(sourceProduct.audiences) ? sourceProduct.audiences : Array.isArray(sourceProduct.product_audiences) ? sourceProduct.product_audiences : [],
    product_audiences: Array.isArray(sourceProduct.product_audiences) ? sourceProduct.product_audiences : Array.isArray(sourceProduct.audiences) ? sourceProduct.audiences : [],
    gender: pickClassificationText(row, sourceProduct, "gender", "gender"),
    product_type: pickClassificationText(row, sourceProduct, "product_type", "productType"),
    productType: pickClassificationText(row, sourceProduct, "product_type", "productType"),
    grade: pickClassificationText(row, sourceProduct, "grade", "grade"),
    main_category_id: row.main_category_id ?? row.mainCategoryId ?? sourceProduct.main_category_id ?? sourceProduct.mainCategoryId ?? null,
    main_category_name: pickFirstText(row.main_category_name, row.mainCategoryName, row.main_category, sourceProduct.main_category_name, sourceProduct.mainCategoryName, sourceProduct.main_category),
    sub_category_id: row.sub_category_id ?? row.subCategoryId ?? sourceProduct.sub_category_id ?? sourceProduct.subCategoryId ?? null,
    sub_category_name: pickFirstText(row.sub_category_name, row.subCategoryName, row.sub_category, sourceProduct.sub_category_name, sourceProduct.subCategoryName, sourceProduct.sub_category),
    child_category_id: row.child_category_id ?? row.childCategoryId ?? sourceProduct.child_category_id ?? sourceProduct.childCategoryId ?? null,
    child_category_name: pickFirstText(row.child_category_name, row.childCategoryName, row.child_category, sourceProduct.child_category_name, sourceProduct.childCategoryName, sourceProduct.child_category),
    subcategory_name: pickFirstText(row.subcategory_name, row.subcategoryName, sourceProduct.subcategory_name, sourceProduct.subcategoryName),
    subcategory: pickFirstText(row.subcategory, sourceProduct.subcategory),
    manufacturer: pickFirstText(row.manufacturer, row.manufacturer_name, sourceProduct.manufacturer, sourceProduct.manufacturer_name),
    manufacturer_name: pickFirstText(row.manufacturer_name, row.manufacturer, sourceProduct.manufacturer_name, sourceProduct.manufacturer),
    manufacturer_id: manufacturerId,
    variant_manufacturer_id: manufacturerId,
    low_stock_threshold: normalizeNumber(row.low_stock_threshold ?? row.low_stock_alert ?? sourceProduct.low_stock_threshold ?? 10),
  };
};

const buildProductFromVariants = (productSeed, variants) => {
  const productId = getProductId(productSeed);
  const productName = getProductName(productSeed);
  const productImageUrl = resolvePosImageUrl(
    productSeed.product_image_url ??
      productSeed.image_url ??
      productSeed.image ??
      productSeed.photo_url ??
      productSeed.thumbnail_url
  );
  const firstVariantImage = variants.find((variant) => variant.image_url)?.image_url || "";
  const prices = variants.map((variant) => Number(variant.price || 0)).filter((price) => Number.isFinite(price));
  const regularPrices = variants.map((variant) => Number(variant.regular_price || variant.original_price || variant.price || 0)).filter((price) => Number.isFinite(price));
  const minPrice = prices.length ? Math.min(...prices) : 0;
  const maxPrice = prices.length ? Math.max(...prices) : minPrice;
  const minRegularPrice = regularPrices.length ? Math.min(...regularPrices) : minPrice;
  const maxRegularPrice = regularPrices.length ? Math.max(...regularPrices) : minRegularPrice;
  const manufacturerId =
    productSeed.manufacturer_id ??
    productSeed.variant_manufacturer_id ??
    variants.find((variant) => variant.manufacturer_id)?.manufacturer_id ??
    null;
  const manufacturer =
    normalizeText(productSeed.manufacturer ?? productSeed.manufacturer_name) ||
    variants.find((variant) => variant.manufacturer)?.manufacturer ||
    "";
  const matchedVariantId = productSeed.matched_variant_id ?? productSeed.matchedVariantId ?? null;
  const matchedColor = normalizeText(productSeed.matched_color ?? productSeed.matchedColor ?? "");
  const matchedColorId = productSeed.matched_color_id ?? productSeed.matchedColorId ?? null;
  const matchedArticle = normalizeText(productSeed.matched_article ?? productSeed.matchedArticle ?? "");
  const matchedSku = normalizeText(productSeed.matched_sku ?? productSeed.matchedSku ?? "");
  const searchMatchType = normalizeText(productSeed.search_match_type ?? productSeed.searchMatchType ?? "");

  return {
    id: productId,
    product_id: productId,
    name: productName,
    product_name: productName,
    variation_mode: productSeed.variation_mode || variants[0]?.variation_mode || "full_variations",
    fixed_size_label: productSeed.fixed_size_label || variants[0]?.fixed_size_label || "",
    brand_id: productSeed.brand_id ?? productSeed.brandId ?? variants.find((variant) => variant.brand_id)?.brand_id ?? null,
    brand_name: pickFirstText(productSeed.brand_name, productSeed.brandName, productSeed.brand, variants[0]?.brand_name, variants[0]?.brand),
    brand: pickFirstText(productSeed.brand, productSeed.brand_name, variants[0]?.brand, variants[0]?.brand_name) || "Unbranded",
    category_id: productSeed.category_id ?? productSeed.categoryId ?? variants[0]?.category_id ?? null,
    parent_category_id: productSeed.parent_category_id ?? productSeed.parentCategoryId ?? variants[0]?.parent_category_id ?? null,
    category: pickFirstText(productSeed.category, productSeed.category_name, variants[0]?.category, variants[0]?.category_name) || "Uncategorized",
    category_name: pickFirstText(productSeed.category_name, productSeed.category, variants[0]?.category_name, variants[0]?.category),
    category_path: pickFirstText(productSeed.category_path, productSeed.categoryPath, variants[0]?.category_path),
    audiences: Array.isArray(productSeed.audiences) ? productSeed.audiences : Array.isArray(productSeed.product_audiences) ? productSeed.product_audiences : [],
    product_audiences: Array.isArray(productSeed.product_audiences) ? productSeed.product_audiences : Array.isArray(productSeed.audiences) ? productSeed.audiences : [],
    gender: pickClassificationText(productSeed, variants[0] || {}, "gender", "gender"),
    product_type: pickClassificationText(productSeed, variants[0] || {}, "product_type", "productType"),
    productType: pickClassificationText(productSeed, variants[0] || {}, "product_type", "productType"),
    grade: pickClassificationText(productSeed, variants[0] || {}, "grade", "grade"),
    main_category_id: productSeed.main_category_id ?? productSeed.mainCategoryId ?? variants[0]?.main_category_id ?? null,
    main_category_name: pickFirstText(productSeed.main_category_name, productSeed.mainCategoryName, productSeed.main_category, variants[0]?.main_category_name, variants[0]?.main_category),
    sub_category_id: productSeed.sub_category_id ?? productSeed.subCategoryId ?? variants[0]?.sub_category_id ?? null,
    sub_category_name: pickFirstText(productSeed.sub_category_name, productSeed.subCategoryName, productSeed.sub_category, variants[0]?.sub_category_name, variants[0]?.sub_category),
    child_category_id: productSeed.child_category_id ?? productSeed.childCategoryId ?? variants[0]?.child_category_id ?? null,
    child_category_name: pickFirstText(productSeed.child_category_name, productSeed.childCategoryName, productSeed.child_category, variants[0]?.child_category_name, variants[0]?.child_category),
    subcategory_name: pickFirstText(productSeed.subcategory_name, productSeed.subcategoryName, variants[0]?.subcategory_name),
    subcategory: pickFirstText(productSeed.subcategory, variants[0]?.subcategory),
    manufacturer,
    manufacturer_name: manufacturer,
    manufacturer_id: manufacturerId,
    product_image_url: productImageUrl,
    image_url: productImageUrl || firstVariantImage,
    regular_price: minRegularPrice,
    original_price: minRegularPrice,
    base_price: minPrice,
    price: minPrice,
    sale_price: minPrice,
    final_price: minPrice,
    min_price: minPrice,
    max_price: maxPrice,
    min_regular_price: minRegularPrice,
    max_regular_price: maxRegularPrice,
    sale_mode_applied: variants.some((variant) => variant.sale_mode_applied),
    sale_source: variants.some((variant) => variant.sale_source === "product") ? "product" : variants.some((variant) => variant.sale_source === "global") ? "global" : "regular",
    sale_badge: variants.find((variant) => variant.sale_badge)?.sale_badge || "",
    total_stock: variants.reduce((sum, variant) => sum + Number(variant.stock_quantity ?? variant.stock ?? 0), 0),
    stock: variants.reduce((sum, variant) => sum + Number(variant.stock_quantity ?? variant.stock ?? 0), 0),
    sku: variants.find((variant) => variant.sku)?.sku || normalizeText(productSeed.sku ?? productSeed.product_sku),
    barcode: variants.find((variant) => variant.barcode)?.barcode || normalizeText(productSeed.barcode ?? productSeed.product_barcode),
    qr_token: normalizeText(productSeed.qr_token ?? productSeed.qrToken ?? productSeed.product_qr_token ?? productSeed.productQrToken),
    low_stock_threshold: normalizeNumber(productSeed.low_stock_threshold ?? productSeed.low_stock_alert ?? 10),
    matched_variant_id: matchedVariantId,
    matchedVariantId,
    matched_color: matchedColor,
    matchedColor,
    matched_color_id: matchedColorId,
    matchedColorId,
    matched_article: matchedArticle,
    matchedArticle,
    matched_sku: matchedSku,
    matchedSku,
    search_match_type: searchMatchType,
    searchMatchType,
    variants,
  };
};

const preserveClassificationFields = (item, productSeed = {}) => {
  const firstVariant = Array.isArray(item?.variants) ? item.variants[0] || {} : {};
  const audiences = Array.isArray(item?.audiences)
    ? item.audiences
    : Array.isArray(productSeed.audiences)
      ? productSeed.audiences
      : Array.isArray(productSeed.product_audiences)
        ? productSeed.product_audiences
        : [];
  const gender = pickFirstText(item?.gender, productSeed.gender, productSeed.product?.gender, firstVariant.gender);
  const productType = pickFirstText(
    item?.product_type,
    item?.productType,
    productSeed.product_type,
    productSeed.productType,
    productSeed.type,
    productSeed.product?.product_type,
    productSeed.product?.productType,
    firstVariant.product_type,
    firstVariant.productType,
    firstVariant.type
  );
  const grade = pickFirstText(
    item?.grade,
    productSeed.grade,
    productSeed.product_grade,
    productSeed.product?.grade,
    productSeed.product?.product_grade,
    firstVariant.grade,
    firstVariant.product_grade
  );

  return {
    ...item,
    audiences,
    product_audiences: audiences,
    gender,
    product_type: productType,
    productType,
    grade,
  };
};

export const normalizePosSellableProducts = (payload, saleModeSettings = {}) => {
  const rows = unwrapArray(payload);
  const grouped = new Map();

  rows.forEach((product) => {
    const mode = String(product?.variation_mode || product?.variationMode || "").trim().toLowerCase();
    const isSimpleProduct = mode === "simple";

    if (!isSimpleProduct && Array.isArray(product?.variants) && product.variants.length > 0) {
      product.variants.forEach((variant) => {
        const normalized = normalizeVariant(variant, product, saleModeSettings);
        const productId = String(normalized.product_id ?? getProductId(product));
        const current = grouped.get(productId) || { product, variants: [] };
        current.variants.push(normalized);
        grouped.set(productId, current);
      });
      return;
    }

    const normalized = normalizeVariant(product, product, saleModeSettings);
    const productId = String(normalized.product_id ?? getProductId(product));
    const current = grouped.get(productId) || { product, variants: [] };
    current.variants.push(normalized);
    grouped.set(productId, current);
  });

  return Array.from(grouped.values()).map(({ product, variants }) => {
    const item = preserveClassificationFields(buildProductFromVariants(product, variants), product);
    item.variants = item.variants.map((variant) => {
      const stockQuantity = Math.max(0, Number(variant.stock_quantity ?? variant.stock ?? 0));
      return {
        ...variant,
        stock: stockQuantity,
        stock_quantity: stockQuantity,
        available: stockQuantity > 0,
      };
    });
    item.total_stock = item.variants.reduce((sum, variant) => sum + Number(variant.stock_quantity ?? variant.stock ?? 0), 0);
    item.stock = item.total_stock;
    return item;
  });
};

export const normalizePosCatalogProduct = (product = {}) => {
  const variants = Array.isArray(product.variants)
    ? product.variants.map((variant) => {
        const stockQuantity = Math.max(0, Number(variant.stock_quantity ?? variant.stock ?? 0));
        return {
          ...variant,
          stock: stockQuantity,
          stock_quantity: stockQuantity,
          available: stockQuantity > 0,
        };
      })
    : [];
  const stock = variants.reduce((sum, variant) => sum + Number(variant.stock_quantity ?? variant.stock ?? 0), 0);
  return {
    ...product,
    variants,
    total_stock: stock,
    stock,
    matched_variant_id: product.matched_variant_id ?? product.matchedVariantId ?? null,
    matchedVariantId: product.matchedVariantId ?? product.matched_variant_id ?? null,
    matched_color: product.matched_color ?? product.matchedColor ?? null,
    matchedColor: product.matchedColor ?? product.matched_color ?? null,
    matched_color_id: product.matched_color_id ?? product.matchedColorId ?? null,
    matchedColorId: product.matchedColorId ?? product.matched_color_id ?? null,
    matched_article: product.matched_article ?? product.matchedArticle ?? null,
    matchedArticle: product.matchedArticle ?? product.matched_article ?? null,
    matched_sku: product.matched_sku ?? product.matchedSku ?? null,
    matchedSku: product.matchedSku ?? product.matched_sku ?? null,
    search_match_type: product.search_match_type ?? product.searchMatchType ?? null,
    searchMatchType: product.searchMatchType ?? product.search_match_type ?? null,
  };
};

export const getPosSellableProducts = async () => {
  return normalizePosSellableProducts(await getProductsWithVariants()).map((product) => normalizePosCatalogProduct(product));
};
