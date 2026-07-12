import { api } from "../../../shared/api/api";

const MAX_VARIANT_IMAGE_URL_LENGTH = 2048;

const unwrapArray = (payload, fallbackKey = "data") => {
  const value =
    payload?.[fallbackKey] ??
    payload?.products ??
    payload?.data ??
    payload?.result ??
    payload?.payload ??
    payload ??
    [];
  return Array.isArray(value) ? value : [];
};

const unwrapItem = (payload, fallbackKey = "data") =>
  payload?.[fallbackKey] ??
  payload?.product ??
  payload?.variant ??
  payload?.data ??
  payload?.result ??
  payload?.payload ??
  payload ??
  null;

const normalizeNumber = (value) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizePurchaseQuantity = (...values) => {
  for (const value of values) {
    const parsed = Number(value ?? 0);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 0;
};

const normalizeText = (value) => {
  if (value === null || value === undefined) return "";
  return String(value).trim();
};

const normalizeNullableText = (value) => {
  const text = normalizeText(value);
  return text ? text : null;
};

export const normalizeVariantPayload = (input = {}) => {
  const source = input?.variant || input;
  const rawImage =
    source.image_url ??
    source.variant_image_url ??
    source.color_image_url ??
    source.imageUrl ??
    source.image ??
    source.preview ??
    source.image_path ??
    source.variant_image ??
    "";

  const imageUrl =
    typeof rawImage === "string" &&
    rawImage.length > 0 &&
    rawImage.length <= MAX_VARIANT_IMAGE_URL_LENGTH &&
    !rawImage.startsWith("data:")
      ? rawImage
      : "";

  return {
    id: source.id ?? source.variant_id ?? source.variantId ?? null,
    variant_id: source.variant_id ?? source.variantId ?? source.id ?? null,
    variation_mode: source.variation_mode ?? source.variationMode ?? "",
    fixed_size_label: source.fixed_size_label ?? source.fixedSizeLabel ?? "",
    color: normalizeText(
      source.color ??
        source.colorName ??
        source.color_name ??
        source.name
    ),
    size: normalizeText(
      source.size ??
        source.sizeName ??
        source.size_name
    ),
    default_purchase_qty: normalizePurchaseQuantity(
      source.default_purchase_qty,
      source.purchase_qty,
      source.purchase_quantity,
      source.planned_qty,
      source.planned_quantity,
      source.stock_qty,
      source.stockQty,
      source.bulk_purchase_qty,
      source.defaultPurchaseQty,
      source.initial_display_qty,
      source.initialDisplayQty,
      source.stock,
      source.quantity,
      source.qty,
      source.variant_stock
    ),
    purchase_qty: normalizePurchaseQuantity(
      source.purchase_qty,
      source.default_purchase_qty,
      source.purchase_quantity,
      source.planned_qty,
      source.planned_quantity,
      source.stock_qty,
      source.stockQty,
      source.bulk_purchase_qty
    ),
    purchase_quantity: normalizePurchaseQuantity(
      source.purchase_quantity,
      source.purchase_qty,
      source.default_purchase_qty,
      source.planned_qty,
      source.planned_quantity,
      source.stock_qty,
      source.stockQty,
      source.bulk_purchase_qty
    ),
    stock_qty: normalizePurchaseQuantity(
      source.stock_qty,
      source.stockQty,
      source.default_purchase_qty,
      source.purchase_qty,
      source.purchase_quantity,
      source.planned_qty,
      source.planned_quantity,
      source.bulk_purchase_qty
    ),
    bulk_purchase_qty: normalizePurchaseQuantity(
      source.bulk_purchase_qty,
      source.stock_qty,
      source.stockQty,
      source.default_purchase_qty,
      source.purchase_qty,
      source.purchase_quantity,
      source.planned_qty,
      source.planned_quantity
    ),
    sku: normalizeText(
      source.sku ??
        source.variantSku ??
        source.variant_sku ??
        ""
    ),
    barcode: normalizeText(
      source.barcode ??
        source.variantBarcode ??
        source.variant_barcode ??
        ""
    ),
    article_code: normalizeText(
      source.variant_article_code ??
        source.variantArticleCode ??
        source.article_code ??
        source.articleCode ??
        source.model_code ??
        source.modelCode ??
        source.factory_model ??
        source.factoryModel ??
        source.factory_code ??
        source.factoryCode ??
        ""
    ),
    color_article_code: normalizeText(source.color_article_code ?? source.colorArticleCode ?? ""),
    colorArticleCode: normalizeText(source.colorArticleCode ?? source.color_article_code ?? ""),
    thermal_image_url: normalizeText(
      source.thermal_image_url ??
        source.thermalImageUrl ??
        source.variant_thermal_image_url ??
        source.variantThermalImageUrl ??
        source.color_thermal_image_url ??
        source.colorThermalImageUrl ??
        source.variant_color_thermal_image_url ??
        source.variantColorThermalImageUrl ??
        source.product_thermal_image_url ??
        source.productThermalImageUrl ??
        ""
    ),
    thermalImageUrl: normalizeText(
      source.thermalImageUrl ??
        source.thermal_image_url ??
        source.variant_thermal_image_url ??
        source.variantThermalImageUrl ??
        source.color_thermal_image_url ??
        source.colorThermalImageUrl ??
        source.variant_color_thermal_image_url ??
        source.variantColorThermalImageUrl ??
        source.product_thermal_image_url ??
        source.productThermalImageUrl ??
        ""
    ),
    product_thermal_image_url: normalizeText(source.product_thermal_image_url ?? source.productThermalImageUrl ?? ""),
    productThermalImageUrl: normalizeText(source.productThermalImageUrl ?? source.product_thermal_image_url ?? ""),
    color_thermal_image_url: normalizeText(
      source.color_thermal_image_url ??
        source.colorThermalImageUrl ??
        source.variant_color_thermal_image_url ??
        source.variantColorThermalImageUrl ??
        source.thermal_image_url ??
        source.thermalImageUrl ??
        ""
    ),
    colorThermalImageUrl: normalizeText(
      source.colorThermalImageUrl ??
        source.color_thermal_image_url ??
        source.variant_color_thermal_image_url ??
        source.variantColorThermalImageUrl ??
        source.thermal_image_url ??
        source.thermalImageUrl ??
        ""
    ),
    variant_color_thermal_image_url: normalizeText(
      source.variant_color_thermal_image_url ??
        source.variantColorThermalImageUrl ??
        source.color_thermal_image_url ??
        source.colorThermalImageUrl ??
        source.thermal_image_url ??
        source.thermalImageUrl ??
        ""
    ),
    variantColorThermalImageUrl: normalizeText(
      source.variantColorThermalImageUrl ??
        source.variant_color_thermal_image_url ??
        source.color_thermal_image_url ??
        source.colorThermalImageUrl ??
        source.thermal_image_url ??
        source.thermalImageUrl ??
        ""
    ),
    image_url: imageUrl,
    variant_image_url: imageUrl,
    color_image_url: imageUrl,
    images: Array.isArray(source.images)
      ? source.images
      : Array.isArray(source.color_images)
        ? source.color_images
        : [],
    color_images: Array.isArray(source.color_images)
      ? source.color_images
      : Array.isArray(source.images)
        ? source.images
        : [],
    edition_name: normalizeText(source.edition_name ?? source.editionName ?? ""),
    edition_slug: normalizeText(source.edition_slug ?? source.editionSlug ?? ""),
    manufacturer_id: normalizeNullableText(
      source.manufacturer_id ??
        source.manufacturerId ??
        source.variant_manufacturer_id
    ),
    manufacturer: normalizeNullableText(source.manufacturer),
    manufacturer_name: normalizeNullableText(source.manufacturer_name ?? source.manufacturerName ?? source.manufacturer),
    purchase_price: normalizeNumber(
      source.purchase_price ??
        source.purchasePrice ??
        source.last_purchase_price ??
        source.lastPurchasePrice ??
        source.last_purchase_cost ??
        source.lastPurchaseCost ??
        source.average_cost ??
        source.averageCost ??
        source.cost_price ??
        source.costPrice ??
        source.variant_cost_price
    ),
    cost_price: normalizeNumber(
      source.cost_price ??
        source.costPrice ??
        source.last_purchase_price ??
        source.lastPurchasePrice ??
        source.last_purchase_cost ??
        source.lastPurchaseCost ??
        source.average_cost ??
        source.averageCost ??
        source.purchase_price ??
        source.purchasePrice ??
        source.variant_cost_price
    ),
    last_purchase_price: normalizeNumber(source.last_purchase_price ?? source.lastPurchasePrice ?? source.last_purchase_cost ?? source.lastPurchaseCost),
    average_cost: normalizeNumber(source.average_cost ?? source.averageCost),
    regular_price: normalizeNumber(source.selling_price ?? source.sellingPrice ?? source.regular_price ?? source.regularPrice ?? source.price ?? source.variant_price),
    selling_price: normalizeNumber(source.selling_price ?? source.sellingPrice ?? source.regular_price ?? source.regularPrice ?? source.price ?? source.variant_price),
    sale_price: normalizeNumber(source.sale_price ?? source.salePrice),
    sale_price_enabled: Boolean(source.sale_price_enabled ?? source.salePriceEnabled ?? false),
    sale_reason: normalizeText(source.sale_reason ?? source.saleReason ?? ""),
    sale_start_at: source.sale_start_at ?? source.saleStartAt ?? null,
    sale_end_at: source.sale_end_at ?? source.saleEndAt ?? null,
    use_custom_compare_price: Boolean(source.use_custom_compare_price ?? source.useCustomComparePrice ?? false),
    custom_compare_price: normalizeNumber(source.custom_compare_price ?? source.customComparePrice),
    price: normalizeNumber(
      source.selling_price ??
        source.sellingPrice ??
        source.regular_price ??
        source.regularPrice ??
        source.price ??
        source.variant_price
    ),
    warehouse_id: source.warehouse_id ?? source.warehouseId ?? null,
    branch_id: source.branch_id ?? source.branchId ?? null,
    warehouse_stock: source.warehouse_stock ?? source.warehouseStock ?? source.warehouses ?? null,
  };
};

export const getProducts = async (options = {}) => {
  return unwrapArray(await api.get("/products", options));
};

export const getProductsAdminList = async (options = {}) => {
  const response = await api.get("/products/admin-list", options);
  const products = unwrapArray(response);
  return {
    products,
    pagination: response?.pagination || response?.meta || null,
    raw: response,
  };
};

export const getProductsWithVariants = async (options = {}) => {
  const response = await api.get("/products/with-variants", options);
  return unwrapArray(response);
};

export const getProductFull = async (id, options = {}) => {
  const response = await api.get(`/products/${encodeURIComponent(id)}/full`, options);
  return unwrapItem(response);
};

export const getProductByQrToken = async (token) => {
  return unwrapItem(await api.get(`/products/qr/${encodeURIComponent(token)}`), "product");
};

export const createProduct = async (body) => {
  return unwrapItem(await api.post("/products", body));
};

export const updateProduct = async (id, body) => {
  const payloadJson = JSON.stringify(body ?? {});
  console.log("[productsApi.updateProduct] request payload", {
    id,
    payload_size_bytes: payloadJson.length,
    variants_included: Array.isArray(body?.variants) && body.variants.length > 0,
    pricing_fields: {
      regular_price: body?.regular_price,
      price: body?.price,
      selling_price: body?.selling_price,
      sale_price: body?.sale_price,
      sale_price_enabled: body?.sale_price_enabled,
      sale_reason: body?.sale_reason,
      sale_start_at: body?.sale_start_at,
      sale_end_at: body?.sale_end_at,
      use_custom_compare_price: body?.use_custom_compare_price,
      custom_compare_price: body?.custom_compare_price,
      cost_price: body?.cost_price,
      purchase_price: body?.purchase_price,
      wholesale_price: body?.wholesale_price,
    },
    variants_count: Array.isArray(body?.variants) ? body.variants.length : 0,
    variant_images_count: Array.isArray(body?.variantImages) ? body.variantImages.length : 0,
    color_images_count: Array.isArray(body?.colorImages) ? body.colorImages.length : 0,
  });
  console.log("[productsApi.updateProduct] request payload json", JSON.stringify(body, null, 2));
  return unwrapItem(await api.put(`/products/${id}`, body));
};

export const updateProductStatus = async (id, body) => unwrapItem(await api.patch(`/products/${id}/status`, body));
export const toggleProductPosFavorite = async (id, isPosFavorite) =>
  unwrapItem(await api.patch(`/products/${id}/status`, { is_pos_favorite: Boolean(isPosFavorite) }));

export const updateProductPrices = async (id, body) => api.put(`/products/${id}/prices`, body);

export const suggestMirrorEditionName = async (body) => {
  const response = await api.post("/products/suggest-edition", body, { timeoutMs: 30000 });
  return response?.suggestion || response?.data || response || null;
};

export const generateAiProductData = async (body) => {
  const response = await api.post("/products/generate-ai-data", body, { timeoutMs: 90000 });
  return response?.data || response || null;
};

export const generateProductDescription = async (body) => {
  const response = await api.post("/products/generate-description", body, { timeoutMs: 45000 });
  return response?.data || response || null;
};

export const generateSocialPublisherCaption = async (body) => {
  const response = await api.post("/products/generate-social-caption", body, { timeoutMs: 45000 });
  return response?.data || response || null;
};

export const generateThermalArtwork = async ({ productId = null, ...body } = {}) => {
  const payload = {
    ...body,
    ...(productId ? { product_id: productId } : {}),
  };
  const response = productId
    ? await api.post(`/products/${encodeURIComponent(productId)}/generate-ai-thermal-artwork`, payload, { timeoutMs: 120000 })
    : await api.post("/products/generate-ai-thermal-artwork", payload, { timeoutMs: 120000 });
  return response?.data || response || null;
};

export const regenerateAiShoeCover = async ({ productId, targetType = "product", color = "" } = {}) => {
  const response = await api.post(
    `/products/${encodeURIComponent(productId)}/regenerate-ai-shoe-cover`,
    {
      target_type: targetType,
      color,
    },
    { timeoutMs: 30000 }
  );
  return response?.data || response || null;
};

export const deleteProduct = async (id) => api.delete(`/products/${id}`);

export const getBrands = async () => unwrapArray(await api.get("/brands"));

export const createBrand = async (body) => unwrapItem(await api.post("/brands", body));

export const updateBrand = async (id, body) => unwrapItem(await api.put(`/brands/${id}`, body));

export const deleteBrand = async (id) => api.delete(`/brands/${id}`);

export const createVariant = async (productId, body) => {
  const payload = normalizeVariantPayload(body);
  return unwrapItem(await api.post(`/products/${productId}/variants`, payload));
};

export const uploadProductImage = async (file, { timeoutMs = 45000 } = {}) => {
  const formData = new FormData();
  formData.append("image", file);

  try {
    return await api.post("/uploads", formData, { timeoutMs });
  } catch (error) {
    if (Number(error?.status || error?.response?.status) === 404) {
      return api.post("/upload", formData, { timeoutMs });
    }
    throw error;
  }
};

export const resolveUploadedImageUrl = (response = {}) =>
  response?.secure_url ||
  response?.secureUrl ||
  response?.url ||
  response?.imageUrl ||
  response?.data?.secure_url ||
  response?.data?.secureUrl ||
  response?.data?.url ||
  response?.data?.imageUrl ||
  response?.file?.secure_url ||
  response?.file?.url ||
  "";

const isDataImageUrl = (value) => typeof value === "string" && value.trim().startsWith("data:image/");

const dataUrlToFile = async (dataUrl, filename = "product-image.png") => {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  const extension = blob.type?.split("/")?.[1] || "png";
  const safeName = filename.includes(".") ? filename : `${filename}.${extension}`;
  return new File([blob], safeName, { type: blob.type || "image/png" });
};

export const uploadProductImageValue = async (value, { filename = "product-image.png" } = {}) => {
  if (!value) return "";
  const isFileLike =
    (typeof File !== "undefined" && value instanceof File) ||
    (typeof Blob !== "undefined" && value instanceof Blob);
  const file = isFileLike
    ? value
    : isDataImageUrl(value)
      ? await dataUrlToFile(value, filename)
      : null;

  if (!file) return String(value || "").trim();

  const response = await uploadProductImage(file);
  const uploadedUrl = resolveUploadedImageUrl(response);
  if (!uploadedUrl) {
    throw new Error("Image upload did not return a URL");
  }
  return uploadedUrl;
};

export const updateVariant = async (id, body) =>
  unwrapItem(await api.put(`/products/variants/${id}`, normalizeVariantPayload(body)));

export const deleteVariant = async (id) => api.delete(`/products/variants/${id}`);

export const getManufacturers = async () => unwrapArray(await api.get("/manufacturers"));

export const createManufacturer = async (body) => unwrapItem(await api.post("/manufacturers", body));

export const updateManufacturer = async (id, body) => unwrapItem(await api.put(`/manufacturers/${id}`, body));

export const deleteManufacturer = async (id) => api.delete(`/manufacturers/${id}`);

export const getBarcodePrintQueue = async (options = {}) => {
  const response = await api.get("/products/barcode-print-queue", options);
  return unwrapArray(response);
};

export const bulkAddBarcodePrintQueue = async (body) =>
  unwrapItem(await api.post("/products/barcode-print-queue/bulk-add", body, { timeoutMs: 120000 }));

export const markBarcodePrintQueuePrinted = async (id) =>
  unwrapItem(await api.post(`/products/barcode-print-queue/${id}/mark-printed`));

export const requeueBarcodePrintQueue = async (id) =>
  unwrapItem(await api.post(`/products/barcode-print-queue/${id}/requeue`));

export const deleteBarcodePrintQueue = async (id) => api.delete(`/products/barcode-print-queue/${id}`);
