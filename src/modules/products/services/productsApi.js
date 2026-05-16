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
    default_purchase_qty: normalizeNumber(
      source.default_purchase_qty ??
        source.defaultPurchaseQty ??
        source.initial_display_qty ??
        source.initialDisplayQty ??
        source.stock ??
        source.quantity ??
        source.qty ??
        source.variant_stock
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
        source.cost_price ??
        source.costPrice ??
        source.variant_cost_price
    ),
    sale_price: normalizeNumber(
      source.sale_price ??
        source.salePrice ??
        source.price ??
        source.variant_price
    ),
    price: normalizeNumber(
      source.price ??
        source.sale_price ??
        source.salePrice ??
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

export const getProductsWithVariants = async (options = {}) => {
  const response = await api.get("/products/with-variants", options);
  return unwrapArray(response);
};

export const getProductByQrToken = async (token) => {
  return unwrapItem(await api.get(`/products/qr/${encodeURIComponent(token)}`), "product");
};

export const createProduct = async (body) => {
  return unwrapItem(await api.post("/products", body));
};

export const updateProduct = async (id, body) => unwrapItem(await api.put(`/products/${id}`, body));

export const suggestMirrorEditionName = async (body) => {
  const response = await api.post("/products/suggest-edition", body, { timeoutMs: 30000 });
  return response?.suggestion || response?.data || response || null;
};

export const generateAiProductData = async (body) => {
  const response = await api.post("/products/generate-ai-data", body, { timeoutMs: 90000 });
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

export const uploadProductImage = async (file) => {
  const formData = new FormData();
  formData.append("image", file);

  try {
    return await api.post("/uploads", formData);
  } catch (error) {
    if (Number(error?.status || error?.response?.status) === 404) {
      return api.post("/upload", formData);
    }
    throw error;
  }
};

export const updateVariant = async (id, body) =>
  unwrapItem(await api.put(`/products/variants/${id}`, normalizeVariantPayload(body)));

export const deleteVariant = async (id) => api.delete(`/products/variants/${id}`);

export const getManufacturers = async () => unwrapArray(await api.get("/manufacturers"));

export const createManufacturer = async (body) => unwrapItem(await api.post("/manufacturers", body));

export const updateManufacturer = async (id, body) => unwrapItem(await api.put(`/manufacturers/${id}`, body));

export const deleteManufacturer = async (id) => api.delete(`/manufacturers/${id}`);
