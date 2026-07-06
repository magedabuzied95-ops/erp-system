import { useEffect, useMemo, useRef, useState } from "react";

import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";

import {
  ArrowLeft,
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Clock3,
  GripVertical,
  ImagePlus,
  Loader2,
  Plus,
  Save,
  Search,
  Share2,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";

import toast from "react-hot-toast";

import ProductsShell from "../components/ProductsShell";
import ProductForm from "../components/ProductForm";
import ImageThumbnailActions from "../components/ImageThumbnailActions";
import MultiVersionGenerator from "../components/MultiVersionGenerator";
import {
  buildSmartSkuPrefix,
  buildVariantSku,
  collectSkuValues,
  makeUniqueSku,
  resolveBrandPayload,
  resolveBrandSelection,
  resolveCategoryPayload,
  resolveCategorySelection,
  resolveUnitPayload,
  resolveUnitSelection,
  cleanupProductCache,
  seedBrands,
  seedCategories,
  seedUnits,
  upsertProductMeta,
} from "../lib/catalog";
import {
  applyBulkSizesToGroups,
  applyBulkStockToGroups,
  CROCS_SIZE_LIBRARY_OPTIONS,
  createVariantRow,
  getCrocsSizeInputDisplayLabel,
  getCrocsSizeLibraryItems,
  isPlaceholderVariantRow,
  isCrocsProductType,
  parseBulkSizes,
  parseBulkStock,
  sortProductSizes,
} from "../lib/variantBulkSizes";
import { dedupeImages } from "../lib/dedupeImages";
import colorNameFromImage, { colorNameFromImagePoint, debugColorDetection } from "../../../shared/utils/colorNameFromImage";
import {
  generateProductDescription,
  generateAiProductData,
  regenerateAiShoeCover,
  generateThermalArtwork,
  getManufacturers,
  getProductsWithVariants,
  normalizeVariantPayload,
  suggestMirrorEditionName,
  updateProduct,
  uploadProductImageValue,
  uploadProductImage,
} from "../services/productsApi";
import { isMirrorProduct, slugifyEdition } from "../../../shared/lib/mirrorProduct";
import { isInvalidEditionName } from "../../../shared/lib/editionNameGenerator";
import { safeGenerateProductDescriptions } from "../../../shared/lib/generateProductDescriptions";
import { formatCurrency } from "../../../shared/lib/currency";
import { isAdminUser } from "../../../shared/auth/authStorage";

const emptyProduct = {
  name: "",
  brand: "",
  category: "",
  description: "",
  description_ar: "",
  description_en: "",
  meta_title: "",
  seo_description: "",
  seo_keywords: "",
  canonical_slug: "",
  sku: "",
  barcode: "",
  regular_price: "",
  price: "",
  cost_price: "",
  sale_price: "",
  sale_price_enabled: false,
  wholesale_price: "",
  last_purchase_pricing_at: "",
  sale_reason: "",
  sale_start_at: "",
  sale_end_at: "",
  purchase_alerts_enabled: true,
  purchase_alert_by_color: false,
  carton_size: "",
  suggested_purchase_cartons: 1,
  use_custom_compare_price: false,
  custom_compare_price: "",
  thermal_image_url: "",
  status: "active",
  gender: "",
  audiences: [],
  product_audiences: [],
  product_type: "",
  style: "",
  grade: "",
  is_offer_story: false,
  variation_mode: "full_variations",
  fixed_size_label: "One Size",
  low_stock_threshold: "",
  low_stock_alert: "",
};

const resolveAssetUrl = (url) => {
  const value = String(url || "").trim();
  if (!value) return "";
  if (value.startsWith("data:") || value.startsWith("blob:")) return value;
  if (/^https?:\/\//i.test(value)) {
    try {
      const parsed = new URL(value);
      if (/^(localhost|127\.0\.0\.1)$/i.test(parsed.hostname)) {
        return `${parsed.pathname}${parsed.search}${parsed.hash}`;
      }
    } catch {
      return value;
    }
    return value;
  }
  if (value.startsWith("/uploads/")) return value;
  if (value.startsWith("uploads/")) return `/${value}`;
  if (value.startsWith("/")) return value;
  return `/uploads/products/${value}`;
};

const firstPreviewText = (...values) => {
  for (const value of values) {
    if (value && typeof value === "object") {
      const nested = firstPreviewText(
        value.image_url,
        value.secure_url,
        value.original_url,
        value.thumbnail_url,
        value.url,
        value.preview,
        value.image,
        value.photo_url
      );
      if (nested) return nested;
      continue;
    }

    const text = String(value || "").trim();
    if (text) return text;
  }
  return "";
};

const resolveMainPreviewImageValue = (value = "") => firstPreviewText(value);

const resolveMainPreviewImageUrl = (value = "") => resolveAssetUrl(resolveMainPreviewImageValue(value));

const makeId = () =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const formatFieldValue = (value) => (value === null || value === undefined ? "" : String(value));

const createEmptySizeRow = (defaults = {}) => createVariantRow(defaults);

const createEmptyColorGroup = (defaults = {}) => ({
  id: makeId(),
  color: formatFieldValue(defaults.color),
  manufacturer_id: formatFieldValue(defaults.manufacturer_id),
  manufacturer_override: Boolean(defaults.manufacturer_override),
  article_code: formatFieldValue(defaults.article_code ?? defaults.articleCode ?? defaults.variant_article_code),
  planned_qty: formatFieldValue(
    defaults.default_purchase_qty ??
      defaults.purchase_qty ??
      defaults.purchase_quantity ??
      defaults.planned_qty ??
      defaults.planned_quantity ??
      defaults.stock_qty ??
      defaults.stockQty ??
      defaults.quantity ??
      defaults.bulk_purchase_qty
  ),
  edition_name: formatFieldValue(defaults.edition_name),
  edition_slug: formatFieldValue(defaults.edition_slug || slugifyEdition(defaults.edition_name || "")),
  imagePreview: formatFieldValue(defaults.imagePreview),
  image_url: formatFieldValue(defaults.image_url),
  thermal_image_url: formatFieldValue(defaults.thermal_image_url),
  ai_cover: defaults.ai_cover || null,
  ai_cover_status: formatFieldValue(defaults.ai_cover_status),
  images: Array.isArray(defaults.images) ? defaults.images : [],
  sizes: Array.isArray(defaults.sizes) ? defaults.sizes : [createEmptySizeRow()],
});

const createColorImageItem = (value = {}, index = 0) => {
  const preview =
    typeof value === "string"
      ? value
      : value?.preview || value?.url || value?.image_url || value?.image || "";
  const imageUrl =
    typeof value === "string"
      ? value
      : value?.image_url || value?.url || value?.preview || value?.image || "";
  const finalPreview = String(preview || imageUrl || "").trim();
  const finalUrl = String(imageUrl || finalPreview || "").trim();
  if (!finalPreview && !finalUrl) return null;
  return {
    id: value?.id || makeId(),
    preview: finalPreview,
    image_url: finalUrl,
    is_primary: Boolean(value?.is_primary ?? value?.isPrimary ?? index === 0),
    generated_by_ai: Boolean(value?.generated_by_ai ?? value?.generatedByAi),
    name: value?.name || finalPreview.split("/").pop() || `Color image ${index + 1}`,
  };
};

const normalizeColorImages = (images = []) => {
  const normalized = dedupeImages(Array.isArray(images) ? images : [])
    .map((image, index) => createColorImageItem(image, index))
    .filter(Boolean);
  const primaryIndex = normalized.findIndex((item) => item.is_primary);
  if (primaryIndex > 0) {
    const [primary] = normalized.splice(primaryIndex, 1);
    normalized.unshift({ ...primary, is_primary: true });
  } else if (primaryIndex === -1 && normalized.length > 0) {
    normalized[0] = { ...normalized[0], is_primary: true };
  }
  return normalized;
};

const resolveHydratedColorImage = (group = {}) =>
  String(
    group.variant_color_thermal_image_url ||
      group.variantColorThermalImageUrl ||
      group.color_thermal_image_url ||
      group.colorThermalImageUrl ||
      group.thermal_image_url ||
      group.thermalImageUrl ||
      group.image_url ||
      group.imagePreview ||
      ""
  ).trim();

const getPrimaryColorImage = (group = {}) => {
  const thermalImage = resolveHydratedColorImage(group);
  if (thermalImage) return thermalImage;
  const images = normalizeColorImages(group.images);
  const primary = images.find((item) => item.is_primary) || images[0] || null;
  return primary?.image_url || group.image_url || group.imagePreview || "";
};

const getResolvedThermalImageUrl = ({ product = {}, groups = [], variants = [] } = {}) => {
  const firstText = (...values) => {
    for (const value of values) {
      const text = String(value || "").trim();
      if (text) return text;
    }
    return "";
  };

  const productThermal = firstText(
    product.thermal_image_url,
    product.thermalImageUrl,
    product.product_thermal_image_url,
    product.productThermalImageUrl
  );
  if (productThermal) return productThermal;

  for (const group of Array.isArray(groups) ? groups : []) {
    const groupThermal = firstText(
      group?.thermal_image_url,
      group?.thermalImageUrl,
      group?.color_thermal_image_url,
      group?.colorThermalImageUrl,
      group?.variant_color_thermal_image_url,
      group?.variantColorThermalImageUrl
    );
    if (groupThermal) return groupThermal;
  }

  for (const variant of Array.isArray(variants) ? variants : []) {
    const variantThermal = firstText(
      variant?.thermal_image_url,
      variant?.thermalImageUrl,
      variant?.color_thermal_image_url,
      variant?.colorThermalImageUrl,
      variant?.variant_color_thermal_image_url,
      variant?.variantColorThermalImageUrl
    );
    if (variantThermal) return variantThermal;
  }

  return "";
};

const getThermalArtworkSourceImage = (fallbackImage = "", colorGroup = null, groups = []) => {
  const selectedGroup = colorGroup || groups.find((group) => String(group?.color || "").trim()) || null;
  const groupImage = selectedGroup ? getPrimaryColorImage(selectedGroup) : "";
  const firstGroupImage = Array.isArray(groups) ? getPrimaryColorImage(groups.find((group) => getPrimaryColorImage(group)) || {}) : "";
  return String(groupImage || firstGroupImage || fallbackImage || "").trim();
};

const getGroupSizeCount = (group) => {
  if (!group) return 0;

  const sizes =
    group.sizes ||
    group.sizeVariants ||
    group.variants ||
    [];

  if (!Array.isArray(sizes)) return 0;

  return sizes.filter((size) => {
    const qty = Number(
      size?.quantity ??
      size?.stock ??
      size?.stock_quantity ??
      size?.inventory_quantity ??
      0
    );

    return size && (size.size || size.size_name || size.label || qty > 0);
  }).length;
};

const normalizeColorKey = (value = "") => String(value || "default").trim().toLowerCase() || "default";

const normalizeManufacturerId = (value = "") => String(value || "").trim();

const getDefaultManufacturerName = (manufacturers = [], defaultManufacturerId = "") =>
  manufacturers.find((item) => String(item.id) === String(defaultManufacturerId))?.name || "";

const SEO_PANEL_STATE_KEY = "erp.products.seoPanelOpen";

const normalizeAudienceValue = (value = "") => {
  const normalized = String(value || "").trim().toLowerCase();
  if (["men", "man", "male"].includes(normalized)) return "men";
  if (["women", "woman", "female", "ladies"].includes(normalized)) return "women";
  if (["kids", "kid", "children", "child", "boys", "girls"].includes(normalized)) return "kids";
  return "";
};

const normalizeProductAudiences = (...sources) => {
  const seen = new Set();
  const visit = (value) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (value === null || value === undefined) return;
    String(value)
      .split(/[,\n|]+/)
      .map(normalizeAudienceValue)
      .filter(Boolean)
      .forEach((audience) => seen.add(audience));
  };
  sources.forEach(visit);
  return ["men", "women", "kids"].filter((audience) => seen.has(audience));
};

const normalizeProductForm = (row = {}) => ({
  name: row.name || "",
  brand: row.brand || "",
  brand_id: row.brand_id ?? "",
  category: row.category || "",
  category_id: row.category_id ?? "",
  unit: row.unit || "",
  unit_id: row.unit_id ?? "",
  description: row.description || "",
  description_ar: row.description_ar || "",
  description_en: row.description_en || "",
  meta_title: row.meta_title || row.seo_title || "",
  seo_description: row.seo_description || "",
  seo_keywords: row.seo_keywords || "",
  canonical_slug: row.canonical_slug || row.slug || "",
  sku: row.product_sku || row.sku || "",
  barcode: row.product_barcode || row.barcode || "",
  regular_price: String(row.regular_price ?? row.product_price ?? row.price ?? ""),
  price: String(row.regular_price ?? row.product_price ?? row.price ?? ""),
  cost_price: String(row.cost_price ?? row.purchase_price ?? row.last_purchase_cost ?? ""),
  sale_price: String(row.sale_price ?? ""),
  sale_price_enabled: row.sale_price_enabled === true || String(row.sale_price_enabled || "").toLowerCase() === "true",
  wholesale_price: String(row.wholesale_price ?? ""),
  last_purchase_pricing_at: row.last_purchase_pricing_at || row.stock_applied_at || row.updated_at || "",
  sale_reason: row.sale_reason || "",
  sale_start_at: row.sale_start_at ? String(row.sale_start_at).slice(0, 16) : "",
  sale_end_at: row.sale_end_at ? String(row.sale_end_at).slice(0, 16) : "",
  use_custom_compare_price: row.use_custom_compare_price === true || String(row.use_custom_compare_price || "").toLowerCase() === "true",
  custom_compare_price: String(row.custom_compare_price ?? ""),
  thermal_image_url: row.thermal_image_url || "",
  status: String(row.status || "active").toLowerCase(),
  gender: row.gender || (Array.isArray(row.audiences) ? row.audiences[0] : "") || "",
  audiences: normalizeProductAudiences(row.audiences, row.product_audiences, row.gender),
  product_audiences: normalizeProductAudiences(row.audiences, row.product_audiences, row.gender),
  product_type: row.product_type || "",
  style: row.style || "",
  grade: row.grade || "",
  is_offer_story: row.is_offer_story === true || String(row.is_offer_story || "").toLowerCase() === "true",
  ai_cover: row.ai_cover || null,
  ai_cover_status: row.ai_cover_status || row.ai_cover?.status || "",
  variation_mode: row.variation_mode || "full_variations",
  fixed_size_label: row.fixed_size_label || "One Size",
  purchase_alerts_enabled: row.purchase_alerts_enabled === true || String(row.purchase_alerts_enabled || "").toLowerCase() === "true",
  purchase_alert_by_color: row.purchase_alert_by_color === true || String(row.purchase_alert_by_color || "").toLowerCase() === "true",
  carton_size: row.carton_size === null || row.carton_size === undefined ? "" : String(row.carton_size),
  suggested_purchase_cartons: String(row.suggested_purchase_cartons ?? 1),
  low_stock_threshold: String(row.low_stock_threshold ?? row.low_stock_alert ?? ""),
  low_stock_alert: String(row.low_stock_alert ?? row.low_stock_threshold ?? ""),
});

const normalizeGalleryImages = (value) => {
  let source = value;

  if (typeof source === "string") {
    try {
      source = JSON.parse(source);
    } catch {
      source = source.trim() ? [source] : [];
    }
  }

  if (!Array.isArray(source)) return [];

  return source
    .map((item) => {
      const imageValue =
        typeof item === "string"
          ? item
          : item?.preview || item?.url || item?.image_url || item?.product_image_url || "";
      const preview = String(imageValue || "").trim();
      if (!preview) return null;

      return {
        id: makeId(),
        name: typeof item === "string" ? preview.split("/").pop() || "Gallery image" : item?.name || "Gallery image",
        preview,
        image_url: typeof item === "string" ? preview : item?.image_url || item?.url || item?.product_image_url || preview,
      };
    })
    .filter(Boolean);
};

const hasValue = (value) => value !== null && value !== undefined && String(value).trim() !== "";

const normalizeIdValue = (value) => {
  if (!hasValue(value)) return "";
  const numeric = Number(value);
  return Number.isFinite(numeric) ? String(numeric) : String(value).trim();
};

const idsMatch = (left, right) => {
  const leftId = normalizeIdValue(left);
  const rightId = normalizeIdValue(right);
  return Boolean(leftId && rightId && leftId === rightId);
};

const getProductRowId = (row = {}) => row.product_id ?? row.productId ?? row.product?.id ?? row.id;

const getVariantRowId = (row = {}) =>
  row.variant_id ?? row.variantId ?? row.variant?.id ?? row.id_variant ?? (row.product_id || row.productId ? row.id : row.id);

const isVariantLikeRow = (row = {}) =>
  hasValue(row.variant_id) ||
  hasValue(row.variantId) ||
  hasValue(row.variant?.id) ||
  hasValue(row.id_variant) ||
  hasValue(row.color) ||
  hasValue(row.size) ||
  hasValue(row.variant_stock) ||
  hasValue(row.variant_sku) ||
  hasValue(row.variant_article_code) ||
  hasValue(row.article_code) ||
  hasValue(row.variant_barcode) ||
  hasValue(row.variant_image_url) ||
  hasValue(row.color_image_url);

const normalizeVariantForm = (row = {}) => ({
  variantId: getVariantRowId(row),
  color: row.color || "Default",
  size: row.size || "One size",
  stock: String(
    row.default_purchase_qty ??
      row.purchase_qty ??
      row.purchase_quantity ??
      row.planned_qty ??
      row.planned_quantity ??
      row.stock_qty ??
      row.stockQty ??
      row.quantity ??
      row.bulk_purchase_qty ??
      ""
  ),
  available_stock: String(row.stock ?? row.variant_stock ?? 0),
  price: String(row.price ?? row.sale_price ?? row.variant_sale_price ?? 0),
  sale_price: String(row.sale_price ?? row.variant_sale_price ?? 0),
  sale_price_enabled: row.sale_price_enabled === true || String(row.sale_price_enabled || "").toLowerCase() === "true",
  wholesale_price: String(row.wholesale_price ?? row.variant_wholesale_price ?? 0),
  cost_price: String(row.cost_price ?? row.purchase_price ?? row.last_purchase_cost ?? 0),
  sku: row.sku || row.variant_sku || "",
  article_code: row.article_code || row.variant_article_code || "",
  barcode: row.barcode || row.variant_barcode || "",
  thermal_image_url: row.thermal_image_url || row.thermalImageUrl || row.variant_thermal_image_url || row.color_thermal_image_url || row.variant_color_thermal_image_url || row.product_thermal_image_url || "",
  thermalImageUrl: row.thermalImageUrl || row.thermal_image_url || row.variant_thermal_image_url || row.color_thermal_image_url || row.variant_color_thermal_image_url || row.product_thermal_image_url || "",
  product_thermal_image_url: row.product_thermal_image_url || row.productThermalImageUrl || "",
  productThermalImageUrl: row.productThermalImageUrl || row.product_thermal_image_url || "",
  color_thermal_image_url: row.color_thermal_image_url || row.colorThermalImageUrl || row.variant_color_thermal_image_url || row.variantColorThermalImageUrl || row.thermal_image_url || "",
  colorThermalImageUrl: row.colorThermalImageUrl || row.color_thermal_image_url || row.variant_color_thermal_image_url || row.variantColorThermalImageUrl || row.thermal_image_url || "",
  variant_color_thermal_image_url: row.variant_color_thermal_image_url || row.variantColorThermalImageUrl || row.color_thermal_image_url || row.colorThermalImageUrl || row.thermal_image_url || "",
  variantColorThermalImageUrl: row.variantColorThermalImageUrl || row.variant_color_thermal_image_url || row.color_thermal_image_url || row.colorThermalImageUrl || row.thermal_image_url || "",
  image_url: row.variant_image_url || row.color_image_url || row.image_url || "",
  variant_image_url: row.variant_image_url || "",
  color_image_url: row.color_image_url || "",
  edition_name: row.edition_name || row.variant_edition_name || "",
  edition_slug: row.edition_slug || row.variant_edition_slug || "",
  manufacturer_id: row.manufacturer_id ?? row.variant_manufacturer_id ?? "",
  images: Array.isArray(row.images) ? row.images : Array.isArray(row.color_images) ? row.color_images : [],
});

const isHydrationPlaceholderRow = (row = {}) => {
  const size = String(row.size || "").trim();
  const stock = Number(row.stock || 0);
  const price = Number(row.price || 0);
  const sku = String(row.sku || "").trim();

  return (
    !row.variantId &&
    row.isStarter !== false &&
    (size === "" || size === "40") &&
    stock === 0 &&
    price === 0 &&
    !sku
  );
};

const removeHydrationPlaceholders = (groups = []) =>
  groups.map((group) => {
    const hasSavedVariants = group.sizes.some((row) => row.variantId);
    if (!hasSavedVariants) {
      return {
        ...group,
        sizes: group.sizes.length > 0 ? group.sizes : [createEmptySizeRow()],
      };
    }

    return {
      ...group,
      sizes: group.sizes.filter((row) => !isHydrationPlaceholderRow(row)),
    };
  });

const getNestedVariants = (row = {}) => {
  const variants = row.product?.variants ?? row.variants ?? row.product_variants ?? row.productVariants ?? row.variantRows ?? [];
  return Array.isArray(variants) ? variants : [];
};

const collectProductVariants = (productRows = [], firstRow = {}) => {
  const flatRows = productRows.filter((row) => isVariantLikeRow(row) && hasValue(getVariantRowId(row)));
  const nestedRows = productRows.flatMap((row) =>
    getNestedVariants(row).length > 0
      ? getNestedVariants(row).map((variant) => ({
          ...variant,
          product_id: getProductRowId(row),
          product_name: row.product_name || row.name,
          brand: row.brand,
          category: row.category,
        }))
      : []
  );
  const rows = nestedRows.length > 0 ? nestedRows : flatRows;
  const uniqueRows = new Map();

  rows.forEach((row, index) => {
    const variantId = getVariantRowId(row);
    const key = variantId
      ? `id:${variantId}`
      : `new:${row.color || "Default"}:${row.size || "One size"}:${row.sku || ""}:${index}`;
    uniqueRows.set(key, {
      ...firstRow,
      ...row,
      variant_id: variantId,
    });
  });

  return Array.from(uniqueRows.values());
};

const buildColorGroupsFromVariants = (rows = [], defaultManufacturerId = "") => {
  if (!Array.isArray(rows) || rows.length === 0) {
    return [];
  }

  const groups = [];
  const groupedByColor = new Map();

  rows.forEach((row) => {
    const key = normalizeColorKey(row.color);
    if (!groupedByColor.has(key)) {
      const groupImages = normalizeColorImages(row.images || row.color_images || []);
      const groupImage = groupImages.find((image) => image.is_primary)?.image_url || row.image_url || row.variant_image_url || row.color_image_url || "";
        const group = createEmptyColorGroup({
          color: row.color || "Default",
          article_code: row.article_code || row.variant_article_code || "",
          thermal_image_url: row.thermal_image_url || row.thermalImageUrl || row.variant_thermal_image_url || row.color_thermal_image_url || row.variant_color_thermal_image_url || "",
          manufacturer_id: normalizeManufacturerId(row.manufacturer_id) || normalizeManufacturerId(defaultManufacturerId),
          manufacturer_override:
            normalizeManufacturerId(row.manufacturer_id) !== normalizeManufacturerId(defaultManufacturerId),
        planned_qty:
          row.default_purchase_qty ??
          row.purchase_qty ??
          row.purchase_quantity ??
          row.planned_qty ??
          row.planned_quantity ??
          row.stock_qty ??
          row.stockQty ??
          row.quantity ??
          row.bulk_purchase_qty ??
          "",
        imagePreview: resolveAssetUrl(groupImage),
        image_url: groupImage,
        ai_cover: row.ai_cover || null,
        ai_cover_status: row.ai_cover_status || "",
        images: groupImages.length > 0 ? groupImages : groupImage ? [{ preview: resolveAssetUrl(groupImage), image_url: groupImage, is_primary: true }] : [],
        edition_name: row.edition_name || "",
        edition_slug: row.edition_slug || slugifyEdition(row.edition_name || ""),
        sizes: [],
      });
      groupedByColor.set(key, group);
      groups.push(group);
    }

    const group = groupedByColor.get(key);
    if (!String(group.article_code || "").trim() && String(row.article_code || row.variant_article_code || "").trim()) {
      group.article_code = String(row.article_code || row.variant_article_code || "").trim();
    }
    if (!String(group.thermal_image_url || "").trim() && String(row.thermal_image_url || row.thermalImageUrl || row.variant_thermal_image_url || row.color_thermal_image_url || row.variant_color_thermal_image_url || "").trim()) {
      group.thermal_image_url = String(row.thermal_image_url || row.thermalImageUrl || row.variant_thermal_image_url || row.color_thermal_image_url || row.variant_color_thermal_image_url || "").trim();
    }
    if (!String(group.edition_name || "").trim() && String(row.edition_name || "").trim()) {
      group.edition_name = row.edition_name || "";
      group.edition_slug = row.edition_slug || slugifyEdition(row.edition_name || "");
    }
    if (!group.ai_cover && row.ai_cover) {
      group.ai_cover = row.ai_cover;
      group.ai_cover_status = row.ai_cover_status || row.ai_cover?.status || "";
    }
    const rowImages = normalizeColorImages(row.images || row.color_images || []);
    if (rowImages.length > 0) {
      group.images = normalizeColorImages(dedupeImages([...(group.images || []), ...rowImages]));
      const primary = group.images.find((image) => image.is_primary) || group.images[0];
      if (primary) {
        group.imagePreview = resolveAssetUrl(primary.image_url || primary.preview || group.imagePreview);
        group.image_url = primary.image_url || group.image_url || "";
      }
    }
    const resolvedHydratedImage = resolveHydratedColorImage(group);
    if (resolvedHydratedImage) {
      group.imagePreview = resolveAssetUrl(resolvedHydratedImage);
    }
    group.sizes.push(
      createEmptySizeRow({
        variantId: row.variantId,
        isStarter: false,
        size: row.size,
        stock: row.stock,
        available_stock: row.available_stock,
        sku: row.sku,
        article_code: row.article_code,
        thermal_image_url: row.thermal_image_url || row.thermalImageUrl || row.color_thermal_image_url || row.variant_color_thermal_image_url || group.thermal_image_url || "",
        barcode: row.barcode,
        price: row.price,
        image_url: row.image_url || row.variant_image_url || row.color_image_url || getPrimaryColorImage(group) || "",
        manufacturer_id: row.manufacturer_id || group.manufacturer_id || "",
      })
    );
  });

  return groups.map((group) => ({
    ...group,
    manufacturer_id: normalizeManufacturerId(group.manufacturer_id) || normalizeManufacturerId(defaultManufacturerId),
    images: normalizeColorImages(group.images),
    article_code: formatFieldValue(group.article_code),
    thermal_image_url: formatFieldValue(group.thermal_image_url),
    planned_qty: formatFieldValue(
      group.default_purchase_qty ??
        group.purchase_qty ??
        group.purchase_quantity ??
        group.planned_qty ??
        group.planned_quantity ??
        group.stock_qty ??
        group.stockQty ??
        group.quantity ??
        group.bulk_purchase_qty
    ),
    sizes: group.sizes.length > 0 ? group.sizes : [createEmptySizeRow()],
  }));
};

function ProductEdit() {
  const { t } = useTranslation();
  const { id } = useParams();
  const navigate = useNavigate();
  const categories = useMemo(() => seedCategories(), []);
  const brands = useMemo(() => seedBrands(), []);
  const units = useMemo(() => seedUnits(), []);
  const pendingColorUploadsRef = useRef(new Map());
  const colorImageUrlsRef = useRef(new Map());
  const [manufacturers, setManufacturers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [product, setProduct] = useState(emptyProduct);
  const [skuTouched, setSkuTouched] = useState(false);
  const [existingSkuValues, setExistingSkuValues] = useState(() => new Set());
  const [descriptionTouched, setDescriptionTouched] = useState({ ar: false, en: false });
  const [descriptionGenerating, setDescriptionGenerating] = useState({ ar: false, en: false });
  const [descriptionTone, setDescriptionTone] = useState("");
  const [seoTouched, setSeoTouched] = useState({ title: false, description: false, keywords: false, slug: false });
  const [seoGenerating, setSeoGenerating] = useState(false);
  const [seoOpen, setSeoOpen] = useState(() => {
    if (typeof window === "undefined") return true;
    const saved = window.localStorage.getItem(SEO_PANEL_STATE_KEY);
    return saved ? saved === "open" : true;
  });
  const [mainCategory, setMainCategory] = useState("");
  const [subCategory, setSubCategory] = useState("");
  const [childCategory, setChildCategory] = useState("");
  const [brand, setBrand] = useState("");
  const [unit, setUnit] = useState("");
  const [coverImage, setCoverImage] = useState("");
  const [thermalImageUrl, setThermalImageUrl] = useState("");
  const [thermalImageGenerating, setThermalImageGenerating] = useState(false);
  const [coverLabel, setCoverLabel] = useState("");
  const [gallery, setGallery] = useState([]);
  const [defaultManufacturerId, setDefaultManufacturerId] = useState("");
  const [colorGroups, setColorGroups] = useState([]);
  const [expandedGroupId, setExpandedGroupId] = useState("");
  const [crocsLibraryGroupId, setCrocsLibraryGroupId] = useState("");
  const [removedVariantIds, setRemovedVariantIds] = useState([]);
  const [variantStructureEdited, setVariantStructureEdited] = useState(false);
  const [bulkSizesInput, setBulkSizesInput] = useState("");
  const [bulkStockInput, setBulkStockInput] = useState("");
  const [bulkArticleCodeInput, setBulkArticleCodeInput] = useState("");
  const [savedVariantsCount, setSavedVariantsCount] = useState(0);
  const [variantsHydrationFailed, setVariantsHydrationFailed] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [colorDetecting, setColorDetecting] = useState({});
  const [editionSuggestions, setEditionSuggestions] = useState({});
  const [aiProductData, setAiProductData] = useState(null);
  const [aiProductLoading, setAiProductLoading] = useState(false);
  const [aiProductProgress, setAiProductProgress] = useState(AI_PROGRESS_STEPS[0]);
  const [aiCoverRegeneratingKey, setAiCoverRegeneratingKey] = useState("");
  const [colorPickTarget, setColorPickTarget] = useState(null);
  const [searchParams] = useSearchParams();
  const productId = String(id || "").trim();
  const variationMode = product.variation_mode || "full_variations";
  const isFullVariationMode = variationMode === "full_variations";
  const isColorOnlyMode = variationMode === "color_only";
  const isSimpleMode = variationMode === "simple";
  const copyModeParam = String(searchParams.get("copy") || searchParams.get("duplicate") || searchParams.get("mode") || "").trim().toLowerCase();
  const isCopyMode = Boolean(
    ["1", "true", "copy", "duplicate"].includes(copyModeParam) ||
      product?.duplicate_of ||
      product?.copied_from ||
      product?.duplicate_source_id ||
      product?.source_product_id ||
      product?.is_copy ||
      product?.isDuplicate
  );
  const mirrorEditionEnabled = isMirrorProduct(product);
  const canRegenerateAiCover = isAdminUser();
  const descriptionContext = useMemo(
    () => ({
      name: product.name,
      brand,
      manufacturer: getDefaultManufacturerName(manufacturers, defaultManufacturerId),
      category: childCategory || subCategory || mainCategory || product.category,
      gender: product.audiences?.[0] || product.gender,
      audiences: product.audiences || [],
      productType: product.product_type,
      grade: product.grade,
      colors: colorGroups.map((group) => group.color),
      sizes: isColorOnlyMode ? [product.fixed_size_label || "One Size"] : colorGroups.flatMap((group) => group.sizes || []).map((row) => row.size),
    }),
    [product, brand, manufacturers, defaultManufacturerId, childCategory, subCategory, mainCategory, colorGroups, isColorOnlyMode]
  );
  const generatedDescriptions = useMemo(() => safeGenerateProductDescriptions(descriptionContext), [descriptionContext]);
  const generatedDescriptionAr = generatedDescriptions.description_ar;
  const generatedDescriptionEn = generatedDescriptions.description_en;
  const seoPreviewTitle = product.meta_title || generatedDescriptions.meta_title || product.name || "Product";
  const seoPreviewDescription = product.seo_description || generatedDescriptions.seo_description || product.description_en || product.description_ar || "";
  const seoPreviewSlug = product.canonical_slug || generatedDescriptions.canonical_slug || productId || "product";
  const seoPreviewUrl = `store.example/products/${seoPreviewSlug}`;
  const aiSuggestions = aiProductData?.suggestions || {};
  const smartSkuPrefix = useMemo(
    () =>
      buildSmartSkuPrefix({
        name: product.name,
        brand,
        manufacturer: getDefaultManufacturerName(manufacturers, defaultManufacturerId),
        productType: product.product_type,
        category: childCategory || subCategory || mainCategory || product.category,
        gender: product.audiences?.[0] || product.gender,
        grade: product.grade,
        detectedModel: aiSuggestions.detected_model || aiSuggestions.model,
        aiText: [
          aiSuggestions.name_en,
          aiSuggestions.meta_title_en,
          aiSuggestions.seo_description_en,
          aiSuggestions.brand_resemblance,
          aiSuggestions.classification,
        ].filter(Boolean).join(" "),
      }),
    [
      product.name,
      product.product_type,
      product.category,
      product.gender,
      product.grade,
      brand,
      manufacturers,
      defaultManufacturerId,
      childCategory,
      subCategory,
      mainCategory,
      aiSuggestions.detected_model,
      aiSuggestions.model,
      aiSuggestions.name_en,
      aiSuggestions.meta_title_en,
      aiSuggestions.seo_description_en,
      aiSuggestions.brand_resemblance,
      aiSuggestions.classification,
    ]
  );
  const uniqueSmartSkuPrefix = useMemo(
    () => makeUniqueSku(smartSkuPrefix, new Set(existingSkuValues)),
    [existingSkuValues, smartSkuPrefix]
  );
  useEffect(() => {
    if (!loading && !skuTouched) {
      setProduct((current) => (current.sku === uniqueSmartSkuPrefix ? current : { ...current, sku: uniqueSmartSkuPrefix }));
    }
  }, [loading, skuTouched, uniqueSmartSkuPrefix]);
  const regenerateSkuPrefix = () => {
    setProduct((current) => ({ ...current, sku: uniqueSmartSkuPrefix }));
    setSkuTouched(false);
  };
  const handleRegenerateAiCover = async ({ colorGroup = null } = {}) => {
    if (!productId) return;
    const targetType = colorGroup ? "color" : "product";
    const targetKey = targetType === "color" ? normalizeColorKey(colorGroup?.color) : "product";
    if (targetType === "color" && (!targetKey || targetKey === "default")) {
      toast.error("Select a color target before regenerating the AI cover.");
      return;
    }

    const busyKey = `${targetType}:${targetKey}`;
    setAiCoverRegeneratingKey(busyKey);
    try {
      const result = await regenerateAiShoeCover({
        productId,
        targetType,
        color: colorGroup?.color || "",
      });
      const aiCover = result?.ai_cover || null;
      const nextSourceImageUrl = String(aiCover?.source_image_url || "").trim();

      if (targetType === "product") {
        setProduct((current) => ({
          ...current,
          ai_cover: aiCover,
          ai_cover_status: aiCover?.status || "",
        }));
        if (nextSourceImageUrl) {
          setCoverImage(nextSourceImageUrl);
        }
      } else {
        setColorGroups((current) =>
          current.map((group) => {
            if (normalizeColorKey(group.color) !== targetKey) return group;
            const filteredImages = normalizeColorImages(group.images).filter((image) => !image.generated_by_ai);
            const nextImages =
              filteredImages.length > 0
                ? filteredImages.map((image, index) => ({ ...image, is_primary: index === 0 }))
                : nextSourceImageUrl
                  ? [{
                      id: makeId(),
                      preview: nextSourceImageUrl,
                      image_url: nextSourceImageUrl,
                      is_primary: true,
                      generated_by_ai: false,
                      name: nextSourceImageUrl.split("/").pop() || "Original image",
                    }]
                  : [];
            const primary = nextImages.find((image) => image.is_primary) || nextImages[0] || null;
            return {
              ...group,
              ai_cover: aiCover,
              ai_cover_status: aiCover?.status || "",
              images: nextImages,
              image_url: primary?.image_url || group.image_url || "",
              imagePreview: primary?.preview || primary?.image_url || group.imagePreview || "",
            };
          })
        );
      }

      toast.success("AI cover regeneration queued.");
    } catch (error) {
      toast.error(error?.message || "Failed to regenerate AI cover");
    } finally {
      setAiCoverRegeneratingKey("");
    }
  };
  const regenerateDescriptions = async (target = "all") => {
    setDescriptionGenerating({ ar: target === "all" || target === "ar", en: target === "all" || target === "en" });
    try {
      const result = await generateProductDescription({
        target,
        prompt_customization: descriptionTone,
        current: {
          ...descriptionContext,
          product_name: product.name,
          description_ar: product.description_ar,
          description_en: product.description_en,
          selling_vibe: descriptionTone,
        },
      });
      const next = {
        description_ar: result?.arabic_description || "",
        description_en: result?.english_description || "",
      };
      setProduct((prev) => {
        const nextDescriptionAr = target === "all" || target === "ar" ? next.description_ar : prev.description_ar;
        const nextDescriptionEn = target === "all" || target === "en" ? next.description_en : prev.description_en;
        return {
          ...prev,
          description_ar: nextDescriptionAr,
          description_en: nextDescriptionEn,
          description: nextDescriptionEn || nextDescriptionAr || prev.description,
          seo_description: prev.seo_description || nextDescriptionEn || nextDescriptionAr,
        };
      });
      if (target === "all") setDescriptionTouched({ ar: false, en: false });
      else setDescriptionTouched((current) => ({ ...current, [target]: false }));
      if (result?.source === "OPENAI") {
        toast.success(t("products.editor.aiDescriptionsGenerated"));
      } else {
        toast("OpenAI unavailable. Local description fallback applied.");
      }
    } catch (error) {
      console.error(error);
      const next = safeGenerateProductDescriptions(descriptionContext);
      setProduct((prev) => {
        const nextDescriptionAr = target === "all" || target === "ar" ? next.description_ar : prev.description_ar;
        const nextDescriptionEn = target === "all" || target === "en" ? next.description_en : prev.description_en;
        return {
          ...prev,
          description_ar: nextDescriptionAr,
          description_en: nextDescriptionEn,
          description: nextDescriptionEn || nextDescriptionAr || prev.description,
          seo_description: prev.seo_description || next.seo_description,
        };
      });
      if (target === "all") setDescriptionTouched({ ar: false, en: false });
      else setDescriptionTouched((current) => ({ ...current, [target]: false }));
      toast.error(error?.message || "Description generation failed");
    } finally {
      setDescriptionGenerating({ ar: false, en: false });
    }
  };
  const applyGeneratedVersion = (version = {}) => {
    const nextAr = String(version?.arabic_description || "").trim();
    const nextEn = String(version?.english_description || "").trim();

    if (nextAr) {
      setProduct((current) => ({ ...current, description_ar: nextAr }));
      setDescriptionTouched((current) => ({ ...current, ar: false }));
    }

    if (nextEn) {
      setProduct((current) => ({
        ...current,
        description_en: nextEn,
        description: nextEn || current.description || nextAr,
      }));
      setDescriptionTouched((current) => ({ ...current, en: false }));
    } else if (nextAr) {
      setProduct((current) => ({ ...current, description: nextAr }));
    }

    if (nextAr || nextEn) {
      toast.success(t("products.editor.versionApplied", "Description version applied"));
    }
  };
  const regenerateSeoMetadata = () => {
    setSeoGenerating(true);
    window.setTimeout(() => {
      const next = safeGenerateProductDescriptions(descriptionContext);
      setProduct((prev) => ({
        ...prev,
        meta_title: next.meta_title,
        seo_description: next.seo_description,
        seo_keywords: next.seo_keywords,
        canonical_slug: next.canonical_slug,
      }));
      setSeoTouched({ title: false, description: false, keywords: false, slug: false });
      setSeoGenerating(false);
    }, 180);
  };
  const editorSignature = useMemo(
    () =>
      JSON.stringify({
        product,
        mainCategory,
        subCategory,
        childCategory,
        brand,
        unit,
        coverImage,
        thermalImageUrl,
        gallery,
        defaultManufacturerId,
        colorGroups,
      }),
    [product, mainCategory, subCategory, childCategory, brand, unit, coverImage, thermalImageUrl, gallery, defaultManufacturerId, colorGroups]
  );
  const initialEditorSignatureRef = useRef(null);
  const hasUnsavedChanges = Boolean(initialEditorSignatureRef.current && initialEditorSignatureRef.current !== editorSignature);

  useEffect(() => {
    if (!loading && !error && !initialEditorSignatureRef.current) {
      initialEditorSignatureRef.current = editorSignature;
    }
  }, [editorSignature, error, loading]);

  useEffect(() => {
    const handleBeforeUnload = (event) => {
      if (!hasUnsavedChanges || saving) return;
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasUnsavedChanges, saving]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(SEO_PANEL_STATE_KEY, seoOpen ? "open" : "closed");
    }
  }, [seoOpen]);

  useEffect(() => {
    if (!loading && !descriptionTouched.ar && !String(product.description_ar || "").trim()) {
      setProduct((prev) => ({ ...prev, description_ar: generatedDescriptions.description_ar }));
    }
  }, [descriptionTouched.ar, generatedDescriptions.description_ar, loading, product.description_ar]);

  useEffect(() => {
    if (!loading && !descriptionTouched.en && !String(product.description_en || "").trim()) {
      setProduct((prev) => ({
        ...prev,
        description_en: generatedDescriptions.description_en,
        description: generatedDescriptions.description_en || prev.description || generatedDescriptions.description_ar,
        seo_description: prev.seo_description || generatedDescriptions.seo_description,
      }));
    }
  }, [descriptionTouched.en, generatedDescriptions.description_ar, generatedDescriptions.description_en, generatedDescriptions.seo_description, loading, product.description_en]);

  useEffect(() => {
    if (!loading && !seoTouched.title && !String(product.meta_title || "").trim()) {
      setProduct((prev) => ({ ...prev, meta_title: generatedDescriptions.meta_title }));
    }
  }, [generatedDescriptions.meta_title, loading, product.meta_title, seoTouched.title]);

  useEffect(() => {
    if (!loading && !seoTouched.description && !String(product.seo_description || "").trim()) {
      setProduct((prev) => ({ ...prev, seo_description: generatedDescriptions.seo_description }));
    }
  }, [generatedDescriptions.seo_description, loading, product.seo_description, seoTouched.description]);

  useEffect(() => {
    if (!loading && !seoTouched.keywords && !String(product.seo_keywords || "").trim()) {
      setProduct((prev) => ({ ...prev, seo_keywords: generatedDescriptions.seo_keywords }));
    }
  }, [generatedDescriptions.seo_keywords, loading, product.seo_keywords, seoTouched.keywords]);

  useEffect(() => {
    if (!loading && !seoTouched.slug && !String(product.canonical_slug || "").trim()) {
      setProduct((prev) => ({ ...prev, canonical_slug: generatedDescriptions.canonical_slug }));
    }
  }, [generatedDescriptions.canonical_slug, loading, product.canonical_slug, seoTouched.slug]);

  const confirmLeaveIfDirty = (event) => {
    if (!hasUnsavedChanges || saving) return;
    const shouldLeave = window.confirm(t("products.editor.confirmLeaveUnsaved"));
    if (!shouldLeave) {
      event.preventDefault();
    }
  };

  useEffect(() => {
    let active = true;

    const loadManufacturers = async () => {
      try {
        const rows = await getManufacturers();
        if (!active) return;
        const list = Array.isArray(rows) ? rows : [];
        setManufacturers(list);
      } catch (error) {
        console.log(error);
      }
    };

    loadManufacturers();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;

    const loadProduct = async () => {
      try {
        setLoading(true);
        setError("");
        setRemovedVariantIds([]);
        setDescriptionTouched({ ar: false, en: false });
        setDescriptionGenerating({ ar: false, en: false });
        setVariantsHydrationFailed(false);
        setSavedVariantsCount(0);
        pendingColorUploadsRef.current.clear();
        colorImageUrlsRef.current.clear();
        console.log("[edit-product] route productId", productId);

        const rows = await getProductsWithVariants();
        const allRows = Array.isArray(rows) ? rows : [];
        const loadedExistingSkus = collectSkuValues(allRows, { excludeProductId: productId });
        if (active) setExistingSkuValues(loadedExistingSkus);

        const productRows = allRows.filter((row) => {
          const hasProductReference = hasValue(row?.product_id) || hasValue(row?.productId) || hasValue(row?.product?.id);
          if (hasProductReference) {
            return idsMatch(row.product_id, productId) || idsMatch(row.productId, productId) || idsMatch(row.product?.id, productId);
          }
          return idsMatch(row?.id, productId);
        });
        const firstRow = productRows[0];
        const rawSavedVariants = collectProductVariants(productRows, firstRow);
        console.log("[edit-product] raw product payload", firstRow || null);
        console.log("[edit-product] raw variants count", rawSavedVariants.length);
        console.log("[edit-product] with-variants product match", {
          productId,
          rows: productRows.length,
          firstRow,
        });

        if (!active) return;

        if (!firstRow) {
          setError(t("products.editor.productNotFound"));
          setProduct(emptyProduct);
          setMainCategory("");
          setSubCategory("");
          setChildCategory("");
          setBrand("");
          setUnit("");
          setCoverImage("");
          setThermalImageUrl("");
          setCoverLabel("");
          setGallery([]);
          setDefaultManufacturerId("");
          setVariantsHydrationFailed(true);
          setColorGroups([]);
          return;
        }

        const hydratedCategory = resolveCategorySelection(categories, firstRow);
        const hydratedBrand = resolveBrandSelection(brands, firstRow);
        const hydratedUnit = resolveUnitSelection(units, firstRow);
        console.log("[edit-product] hydrated category", hydratedCategory);
        console.log("[edit-product] hydrated brand", hydratedBrand);
        setMainCategory(hydratedCategory.mainCategory || "");
        setSubCategory(hydratedCategory.subCategory || "");
        setChildCategory(hydratedCategory.childCategory || "");
        setBrand(hydratedBrand.brand || "");
        setUnit(hydratedUnit.unit || "");

        console.log("[edit-product] raw saved variants count", rawSavedVariants.length);
        const normalizedProduct = normalizeProductForm(firstRow);
        const loadedSmartSkuPrefix = buildSmartSkuPrefix({
          name: normalizedProduct.name,
          brand: hydratedBrand.brand || firstRow.brand,
          productType: normalizedProduct.product_type,
          category: hydratedCategory.childCategory || hydratedCategory.subCategory || hydratedCategory.mainCategory || normalizedProduct.category,
          gender: normalizedProduct.audiences?.[0] || normalizedProduct.gender,
          grade: normalizedProduct.grade,
        });
        const loadedUniqueSkuPrefix = makeUniqueSku(loadedSmartSkuPrefix, new Set(loadedExistingSkus));
        const loadedProductSku = String(normalizedProduct.sku || "").trim().toUpperCase();
        const loadedSkuIsAuto =
          !loadedProductSku ||
          loadedProductSku === loadedSmartSkuPrefix ||
          loadedProductSku === loadedUniqueSkuPrefix ||
          /^-[0-9]+$/.test(loadedProductSku.slice(loadedSmartSkuPrefix.length));
        setSkuTouched(!loadedSkuIsAuto);
        normalizedProduct.sku = loadedProductSku || loadedUniqueSkuPrefix;
        const loadedVariantRows = rawSavedVariants;
        const variantRows = loadedVariantRows.map(normalizeVariantForm).filter((row) => row.variantId);
        setSavedVariantsCount(variantRows.length);

        if (normalizedProduct.variation_mode === "simple") {
          console.log("[edit-product] simple product mode detected, skipping variant hydration");
          setProduct({
            ...normalizedProduct,
            category: hydratedCategory.childCategory || hydratedCategory.subCategory || hydratedCategory.mainCategory || firstRow.category || "",
            brand: hydratedBrand.brand || firstRow.brand || "",
            unit: hydratedUnit.unit || firstRow.unit || "",
          });
          setCoverImage(resolveMainPreviewImageUrl(firstRow));
          setThermalImageUrl(resolveAssetUrl(getResolvedThermalImageUrl({ product: firstRow, variants: variantRows }) || firstRow.thermal_image_url || ""));
          setCoverLabel(resolveMainPreviewImageValue(firstRow) ? t("products.editor.currentProductImage") : "");
          setGallery(normalizeGalleryImages(firstRow.gallery_images));
          setDefaultManufacturerId("");
          setColorGroups([]);
          return;
        }

        if (rawSavedVariants.length === 0 || variantRows.length === 0) {
          setVariantsHydrationFailed(true);
          setError(t("products.editor.variantsFailed"));
          setProduct(normalizedProduct);
          setCoverImage(resolveMainPreviewImageUrl(firstRow));
          setThermalImageUrl(resolveAssetUrl(getResolvedThermalImageUrl({ product: firstRow, variants: variantRows }) || firstRow.thermal_image_url || ""));
          setCoverLabel(resolveMainPreviewImageValue(firstRow) ? t("products.editor.currentProductImage") : "");
          setGallery(normalizeGalleryImages(firstRow.gallery_images));
          setColorGroups([]);
          return;
        }

        if (rawSavedVariants.length > 0 && variantRows.length === 0) {
          console.error("[edit-product] hydration failed", {
            productId,
            rawSavedVariants,
            variantRows,
          });
          setVariantsHydrationFailed(true);
          setError(t("products.editor.variantsFailed"));
          setColorGroups([]);
          return;
        }

        const resolvedDefaultManufacturerId = "";
        const mappedColorGroups = removeHydrationPlaceholders(
          buildColorGroupsFromVariants(variantRows, resolvedDefaultManufacturerId)
        );
        const variantSkuSeeds = new Set(loadedExistingSkus);
        const skuAwareColorGroups = mappedColorGroups.map((group) => ({
          ...group,
          sizes: group.sizes.map((row) => {
            const expectedSku = buildVariantSku({
              prefix: loadedProductSku || loadedUniqueSkuPrefix,
              color: group.color,
              size: normalizedProduct.variation_mode === "color_only" ? normalizedProduct.fixed_size_label || "One Size" : row.size,
              usedSkus: variantSkuSeeds,
            });
            const rowSku = String(row.sku || "").trim().toUpperCase();
            return {
              ...row,
              sku: rowSku || expectedSku,
              skuManualOverride: Boolean(rowSku && rowSku !== expectedSku),
            };
          }),
        }));
        const hydratedRows = skuAwareColorGroups.reduce((sum, group) => sum + group.sizes.filter((row) => row.variantId).length, 0);
        console.log("[edit-product] hydrated color groups", skuAwareColorGroups);
        console.log("[edit-product] hydrated size rows count", hydratedRows);

        if (variantRows.length > 0 && hydratedRows !== variantRows.length) {
          console.error("[edit-product] hydration failed", {
            productId,
            expected: variantRows.length,
            hydratedRows,
            mappedColorGroups: skuAwareColorGroups,
          });
          setVariantsHydrationFailed(true);
        setError(t("products.editor.variantsFailed"));
          setColorGroups([]);
          return;
        }

        console.log("[edit-product] loaded product", firstRow);
        console.log("[edit-product] loaded variants", variantRows);
        console.log("[edit-product] hydrated color image", skuAwareColorGroups.map((group) => ({
          color: group.color,
          image_url: group.image_url,
          rowImages: group.sizes.map((row) => ({ size: row.size, image_url: row.image_url })),
        })));
        const hydratedSelectedColor = skuAwareColorGroups[0] || null;
        console.log("PRODUCT_EDIT_HYDRATED_THERMAL", {
          selectedColor: hydratedSelectedColor?.color || "",
          image_url: hydratedSelectedColor?.image_url || "",
          thermal_image_url: hydratedSelectedColor?.thermal_image_url || "",
          color_thermal_image_url: hydratedSelectedColor?.color_thermal_image_url || "",
          variant_color_thermal_image_url: hydratedSelectedColor?.variant_color_thermal_image_url || "",
          resolvedImage: getPrimaryColorImage(hydratedSelectedColor),
        });
        console.log("[edit-product] hydrated groups", skuAwareColorGroups);
        console.log("[edit-product] mapped color groups", skuAwareColorGroups);
        skuAwareColorGroups.forEach((group) => {
          const primaryImage = getPrimaryColorImage(group);
          if (primaryImage) {
            colorImageUrlsRef.current.set(group.id, primaryImage);
          }
        });
        const hydratedThermalImageUrl = getResolvedThermalImageUrl({
          product: firstRow,
          groups: skuAwareColorGroups,
          variants: variantRows,
        });

        setProduct({
          ...normalizedProduct,
          category: hydratedCategory.childCategory || hydratedCategory.subCategory || hydratedCategory.mainCategory || firstRow.category || "",
          brand: hydratedBrand.brand || firstRow.brand || "",
          unit: hydratedUnit.unit || firstRow.unit || "",
        });
        setCoverImage(resolveMainPreviewImageUrl(firstRow));
        setThermalImageUrl(resolveAssetUrl(hydratedThermalImageUrl || firstRow.thermal_image_url || ""));
        setCoverLabel(resolveMainPreviewImageValue(firstRow) ? t("products.editor.currentProductImage") : "");
        setGallery(normalizeGalleryImages(firstRow.gallery_images));
        setDefaultManufacturerId(resolvedDefaultManufacturerId);
        setColorGroups(skuAwareColorGroups);
        setExpandedGroupId(skuAwareColorGroups[0]?.id || "");
        setVariantStructureEdited(false);
      } catch (err) {
        console.log(err);
        if (!active) return;
        console.error("[edit-product] hydration failed", err);
        setVariantsHydrationFailed(true);
        setError(err?.message || "Failed to load product");
        toast.error(err?.message || "Failed to load product");
      } finally {
        if (active) setLoading(false);
      }
    };

    loadProduct();

    return () => {
      active = false;
    };
  }, [productId]);

  const summary = useMemo(() => {
    const realRows = colorGroups.flatMap((group) =>
      group.sizes.filter((row) => !isPlaceholderVariantRow(row, product.price) && !isHydrationPlaceholderRow(row))
    );
    const totalRows = realRows.length;
    const existingRows = colorGroups.reduce(
      (sum, group) => sum + group.sizes.filter((row) => Boolean(row.variantId) && !isHydrationPlaceholderRow(row)).length,
      0
    );
    return {
      colors: colorGroups.length,
      rows: totalRows,
      existingRows,
      newRows: totalRows - existingRows,
      removedRows: removedVariantIds.length,
    };
  }, [colorGroups, removedVariantIds]);
  const currentVariantRowsCount = summary.rows;

  const updateProductField = (field, value) => {
    setProduct((prev) => ({ ...prev, [field]: value }));
  };

  const getEditionSuggestionInput = (group = {}) => ({
    image_url: (normalizeColorImages(group.images)
      .map((image) => image.image_url || image.preview)
      .filter((image) => /^https?:\/\//i.test(String(image || "")))
      .at(0)) || "",
    product_name: product.name,
    brand,
    manufacturer: getManufacturerPayload(group.manufacturer_id).manufacturer_name || "",
    color_name: group.color,
    color: group.color,
    images: normalizeColorImages(group.images)
      .map((image) => image.image_url || image.preview)
      .filter(Boolean)
      .slice(0, 3),
    style: product.style,
    gender: product.gender,
    product_type: product.product_type,
  });

  const getManufacturerName = (manufacturerId) =>
    manufacturers.find((item) => String(item.id) === String(manufacturerId))?.name || "No manufacturer selected";

  const getManufacturerPayload = (manufacturerId) => {
    const normalized = normalizeManufacturerId(manufacturerId);
    const manufacturerName = normalized
      ? manufacturers.find((item) => String(item.id) === String(normalized))?.name || null
      : null;
    return {
      manufacturer_id: normalized || null,
      manufacturer: manufacturerName,
      manufacturer_name: manufacturerName,
    };
  };

  const getGroupPlannedQty = (group) => {
    const values = [
      group?.default_purchase_qty,
      group?.purchase_qty,
      group?.purchase_quantity,
      group?.planned_qty,
      group?.planned_quantity,
      group?.stock_qty,
      group?.stockQty,
      group?.quantity,
      group?.bulk_purchase_qty,
    ];
    let sawZero = false;
    for (const value of values) {
      const text = String(value ?? "").trim();
      if (!text) continue;
      const parsed = Number(text);
      if (Number.isFinite(parsed) && parsed > 0) return String(parsed);
      if (Number.isFinite(parsed) && parsed === 0) sawZero = true;
    }
    return sawZero ? "0" : "";
  };

  const getVariantPurchaseQty = (row = {}, group = {}) => {
    const values = [
      row.default_purchase_qty,
      row.purchase_qty,
      row.purchase_quantity,
      row.planned_qty,
      row.planned_quantity,
      row.stock_qty,
      row.stockQty,
      row.quantity,
      row.bulk_purchase_qty,
      row.stock,
    ];
    for (const value of values) {
      const parsed = Number(value || 0);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
    return 0;
  };

  const buildAutoVariantGroups = (groups, prefix = product.sku || uniqueSmartSkuPrefix) => {
    if (isSimpleMode) return groups;
    const usedSkus = new Set(existingSkuValues);
    return groups.map((group) => {
      const groupColor = String(group.color || "").trim();
      return {
        ...group,
        sizes: sortProductSizes(Array.isArray(group.sizes) ? group.sizes : []).map((row) => {
          if (row.skuManualOverride) {
            if (String(row.sku || "").trim()) makeUniqueSku(String(row.sku || "").trim().toUpperCase(), usedSkus);
            return row;
          }
          const size = isColorOnlyMode
            ? String(product.fixed_size_label || "One Size").trim() || "One Size"
            : String(row.size || "").trim();
          const sku = groupColor && size ? buildVariantSku({ prefix, color: groupColor, size, usedSkus }) : "";
          return row.sku === sku && row.skuManualOverride === false ? row : { ...row, sku, skuManualOverride: false };
        }),
      };
    });
  };

  useEffect(() => {
    if (loading) return;
    setColorGroups((prev) => {
      const next = buildAutoVariantGroups(prev);
      return JSON.stringify(next.map((group) => group.sizes.map((row) => [row.id, row.sku, row.skuManualOverride]))) ===
        JSON.stringify(prev.map((group) => group.sizes.map((row) => [row.id, row.sku, row.skuManualOverride])))
        ? prev
        : next;
    });
  }, [existingSkuValues, isColorOnlyMode, isSimpleMode, loading, product.fixed_size_label, product.sku, uniqueSmartSkuPrefix]);

  const getGroupManufacturerSummary = (group) => {
    const manufacturerId = normalizeManufacturerId(group?.manufacturer_id);
    if (!manufacturerId) return "No manufacturer selected";
    const label = getManufacturerName(manufacturerId);
    return group?.manufacturer_override ? `${label} Custom` : `${label} Default`;
  };

  const updateColorGroup = (groupId, field, value) => {
    setColorGroups((prev) =>
      buildAutoVariantGroups(
        prev.map((group) =>
        group.id === groupId
            ? {
                ...group,
                [field]: value,
                ...(field === "edition_name"
                  ? {
                      edition_slug: slugifyEdition(value),
                    }
                  : {}),
                ...(field === "manufacturer_id"
                  ? {
                      manufacturer_override:
                        normalizeManufacturerId(value) !== normalizeManufacturerId(defaultManufacturerId),
                    }
                  : {}),
              }
            : group
        )
      )
    );
  };

  const requestEditionSuggestion = async (group, { retry = false } = {}) => {
    if (!mirrorEditionEnabled || !group?.id) return;
    setEditionSuggestions((prev) => ({
      ...prev,
      [group.id]: {
        ...(prev[group.id] || {}),
        status: "loading",
        error: "",
        retry,
      },
    }));

    try {
      const suggestion = await suggestMirrorEditionName(getEditionSuggestionInput(group));
      const source = suggestion?.source || "NO_TRUSTED_MATCH";
      const rawEditionName = source === "NO_TRUSTED_MATCH" ? "" : String(suggestion?.edition_name || "").trim();
      const editionName = rawEditionName && !isInvalidEditionName(rawEditionName, group.color) ? rawEditionName : "";
      const candidates = Array.isArray(suggestion?.candidates)
        ? suggestion.candidates.map((candidate) => {
          const candidateName = String(candidate.name || candidate.edition_name || "").trim();
          return {
            ...candidate,
            name: candidateName,
            edition_name: candidateName,
            confidence: Number(candidate.confidence || 0),
            source: candidate.source || source,
            source_url: candidate.source_url || "",
            title: candidate.title || candidate.source_title || "",
          };
        }).filter((candidate) => candidate.edition_name && !isInvalidEditionName(candidate.edition_name, group.color))
        : [];
      setEditionSuggestions((prev) => ({
        ...prev,
        [group.id]: {
          status: "ready",
          suggestion: {
            edition_name: editionName,
            aliases: Array.isArray(suggestion?.aliases) ? suggestion.aliases : [],
            tags: Array.isArray(suggestion?.tags) ? suggestion.tags : [],
            confidence: Number(suggestion?.confidence || 0),
            source,
            source_url: suggestion?.source_url || "",
            source_title: suggestion?.source_title || "",
            candidates,
          },
          error: "",
        },
      }));
    } catch (error) {
      setEditionSuggestions((prev) => ({
        ...prev,
        [group.id]: {
          status: "error",
          suggestion: null,
          error: error?.message || t("products.editor.noTrustedMatch"),
        },
      }));
    }
  };

  const setColorDetectingState = (groupId, detecting) => {
    setColorDetecting((prev) => {
      if (detecting) return { ...prev, [groupId]: true };
      const next = { ...prev };
      delete next[groupId];
      return next;
    });
  };

  const detectColorNameForGroup = async (groupId, source, { overwrite = false } = {}) => {
    if (!source) return;
    setColorDetectingState(groupId, true);
    try {
      const debug = await debugColorDetection(source);
      console.table({
        nearWhiteRatio: debug.nearWhiteRatio,
        greyRatio: debug.greyRatio,
        blackRatio: debug.blackRatio,
        primaryRatio: debug.primaryRatio,
        secondaryRatio: debug.secondaryRatio,
        backgroundRatio: debug.backgroundRatio,
        avgRgb: JSON.stringify(debug.avgRgb),
        avgHsl: JSON.stringify(debug.avgHsl),
        dominantHex: debug.dominantHex,
        label: debug.label,
      });
      const result = await colorNameFromImage(source);
      const label = String(result?.label || result?.name || "").trim();
      if (!label) return;
      setColorGroups((prev) =>
        prev.map((group) => {
          if (group.id !== groupId) return group;
          if (!overwrite && String(group.color || "").trim()) return group;
          return { ...group, color: label };
        })
      );
    } catch (detectError) {
      console.warn("[products:edit] color detection failed:", detectError);
    } finally {
      setColorDetectingState(groupId, false);
    }
  };

  const pickColorNameForGroup = async (groupId, source, point) => {
    if (!source) return;
    setColorDetectingState(groupId, true);
    try {
      const result = await colorNameFromImagePoint(source, point);
      const label = String(result?.label || result?.name || "").trim();
      if (label) updateColorGroup(groupId, "color", label);
    } catch (detectError) {
      console.warn("[products:edit] color point detection failed:", detectError);
    } finally {
      setColorDetectingState(groupId, false);
    }
  };

  const applyDefaultManufacturer = (manufacturerId) => {
    const normalized = normalizeManufacturerId(manufacturerId);
    setDefaultManufacturerId(normalized);
    setColorGroups((prev) =>
      prev.map((group) =>
        group.manufacturer_override
          ? group
          : {
              ...group,
              manufacturer_id: normalized,
              manufacturer_override: false,
            }
      )
    );
  };

  const updateColorGroupImages = (groupId, updater) => {
    setColorGroups((prev) =>
      prev.map((group) => {
        if (group.id !== groupId) return group;
        const nextImages = normalizeColorImages(dedupeImages(updater(Array.isArray(group.images) ? group.images : [])));
        const primary = nextImages.find((item) => item.is_primary) || nextImages[0] || null;
        return {
          ...group,
          images: nextImages,
          image_url: primary?.image_url || "",
          imagePreview: primary?.preview || primary?.image_url || "",
          sizes: group.sizes.map((row) => ({
            ...row,
            image_url: primary?.image_url || row.image_url || "",
          })),
        };
      })
    );
  };

  const setPrimaryColorImage = (groupId, imageId) => {
    updateColorGroupImages(groupId, (images) =>
      images.map((item) => ({
        ...item,
        is_primary: String(item.id) === String(imageId),
      }))
    );
  };

  const removeColorImage = (groupId, imageId) => {
    updateColorGroupImages(groupId, (images) => {
      if (images.some((item) => String(item.id) === String(imageId) && item.uploading)) return images;
      const next = images.filter((item) => String(item.id) !== String(imageId));
      if (!next.some((item) => item.is_primary) && next.length > 0) {
        next[0] = { ...next[0], is_primary: true };
      }
      return next;
    });
    toast.success(t("products.images.removed"));
  };

  const moveColorImage = (groupId, imageId, direction) => {
    updateColorGroupImages(groupId, (images) => {
      const index = images.findIndex((item) => String(item.id) === String(imageId));
      if (index < 0) return images;
      const targetIndex = direction === "up" ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= images.length) return images;
      const next = [...images];
      const [item] = next.splice(index, 1);
      next.splice(targetIndex, 0, item);
      return next;
    });
  };

  const handleColorImages = async (groupId, files) => {
    const list = Array.from(files || []);
    if (!list.length) return;
    const targetGroup = colorGroups.find((group) => group.id === groupId);
    if (!String(targetGroup?.color || "").trim()) {
      void detectColorNameForGroup(groupId, list[0], { overwrite: false });
    }

    const uploads = list.map(async (file, index) => {
      const preview = await readFileAsDataUrl(file);
      const uploadPromise = uploadProductImage(file)
        .then((response) => {
          const uploadedUrl =
            response?.url ||
            response?.imageUrl ||
            response?.data?.url ||
            response?.data?.imageUrl ||
            "";
          if (uploadedUrl) {
            colorImageUrlsRef.current.set(groupId, uploadedUrl);
          }
          return { preview, image_url: uploadedUrl || "", name: file?.name || `Color image ${index + 1}` };
        })
        .catch((uploadError) => {
          console.warn("[products:edit] color image upload failed, keeping preview only:", {
            groupId,
            message: uploadError?.message,
            status: uploadError?.status,
            responseBody: uploadError?.responseBody,
          });
          toast.error(t("products.editor.colorImageUploadFailed"));
          return { preview, image_url: "", name: file?.name || `Color image ${index + 1}` };
        });

      pendingColorUploadsRef.current.set(`${groupId}:${index}`, uploadPromise);
      try {
        return await uploadPromise;
      } finally {
        pendingColorUploadsRef.current.delete(`${groupId}:${index}`);
      }
    });

    const items = await Promise.all(uploads);
    updateColorGroupImages(groupId, (images) => {
      const normalized = dedupeImages([...images, ...items.map((item, index) => createColorImageItem({ ...item, is_primary: images.length === 0 && index === 0 }, index + images.length)).filter(Boolean)]);
      if (!normalized.some((item) => item.is_primary) && normalized.length > 0) {
        normalized[0] = { ...normalized[0], is_primary: true };
      }
      return normalized;
    });
  };

  const addColorGroup = () => {
    setColorGroups((prev) => [
      ...prev,
      createEmptyColorGroup({
        manufacturer_id: defaultManufacturerId,
      }),
    ]);
  };

  const queueRemovedVariantIds = (ids = []) => {
    const nextIds = ids.map(String).filter(Boolean);
    if (nextIds.length === 0) return;
    setRemovedVariantIds((prev) => Array.from(new Set([...prev, ...nextIds])));
  };

  const removeColorGroup = (groupId) => {
    const target = colorGroups.find((group) => group.id === groupId);
    if (target) {
      queueRemovedVariantIds(target.sizes.map((row) => row.variantId).filter(Boolean));
    }

    setColorGroups((prev) => {
      if (prev.length <= 1)
        return [
          createEmptyColorGroup({
            manufacturer_id: defaultManufacturerId,
          }),
        ];
      return prev.filter((group) => group.id !== groupId);
    });
  };

  const addSizeRow = (groupId) => {
    setColorGroups((prev) =>
      prev.map((group) =>
        group.id === groupId
            ? {
                  ...group,
                  sizes: sortProductSizes([
                    ...group.sizes,
                    createEmptySizeRow({
                    image_url: getPrimaryColorImage(group) || colorImageUrlsRef.current.get(group.id) || "",
                    manufacturer_id: group.manufacturer_id || "",
                    price: product.price || "",
                    }),
                  ]),
              }
          : group
      )
    );
    setVariantStructureEdited(true);
  };

  const applyCrocsSizeLibrary = (groupId, libraryId) => {
    const library = CROCS_SIZE_LIBRARY_OPTIONS.find((item) => item.id === libraryId);
    if (!library) return;

    const { groups: updatedGroups, addedCount } = applyBulkSizesToGroups({
      groups: colorGroups,
      sizes: library.sizes.map((size) => size.eu),
      targetGroupId: groupId,
      price: product.price || 0,
    });

    if (addedCount === 0) {
      toast("المقاسات موجودة بالفعل");
    } else {
      setColorGroups(buildAutoVariantGroups(updatedGroups));
      setVariantStructureEdited(true);
      toast.success(t("products.editor.sizesAdded", "تمت إضافة المقاسات"));
    }

    setCrocsLibraryGroupId("");
  };

  const applyBulkSizes = (targetGroupId = null) => {
    const sizes = parseBulkSizes(bulkSizesInput);
    console.log("[bulk-sizes] raw input", bulkSizesInput);
    console.log("[bulk-sizes] parsed sizes", sizes);
    console.log("[bulk-sizes] target", targetGroupId ? { groupId: targetGroupId } : "all colors");

    if (!String(bulkSizesInput || "").trim()) {
      toast.error(t("products.editor.enterSizesFirst"));
      return;
    }

    if (sizes.length === 0) {
      toast.error(t("products.editor.noValidSizes"));
      return;
    }

    const hasTargetColor = (group) =>
      (!targetGroupId || group.id === targetGroupId) && String(group.color || "").trim();
    if (!colorGroups.some(hasTargetColor)) {
      toast.error(t("products.editor.addColorBeforeBulkSizes"));
      return;
    }

    const { groups: updatedGroups, addedCount, removedPlaceholderCount } = applyBulkSizesToGroups({
      groups: colorGroups.map((group) => (hasTargetColor(group) ? group : { ...group, __skipBulkSizes: true })),
      sizes,
      targetGroupId,
      price: product.price || 0,
    });

    console.log("[bulk-sizes] updated groups", updatedGroups);

    if (addedCount === 0 && removedPlaceholderCount === 0) {
      toast("All sizes already exist");
      return;
    }

    setColorGroups(buildAutoVariantGroups(updatedGroups));
    setVariantStructureEdited(true);
    if (addedCount === 0) {
      toast("All sizes already exist");
      return;
    }

    toast.success(t("products.editor.sizesAdded"));
  };

  const applyBulkStock = (targetGroupId = null) => {
    const parsedStock = parseBulkStock(bulkStockInput);
    console.log("[bulk-stock] raw input", bulkStockInput);
    console.log("[bulk-stock] parsed stock", parsedStock);
    console.log("[bulk-stock] target", targetGroupId ? { groupId: targetGroupId } : "all colors");

    if (!String(bulkStockInput || "").trim()) {
      toast.error(t("products.editor.enterStock"));
      return;
    }

    if (parsedStock === null) {
      toast.error(t("products.editor.enterValidStock"));
      return;
    }

    const hasTargetColor = (group) =>
      (!targetGroupId || group.id === targetGroupId) && String(group.color || "").trim();
    if (!colorGroups.some(hasTargetColor)) {
      toast.error(t("products.editor.addColorBeforeBulkStock"));
      return;
    }

    const { groups: updatedGroups, changedCount } = applyBulkStockToGroups({
      groups: colorGroups.map((group) => (hasTargetColor(group) ? group : { ...group, __skipBulkStock: true })),
      stock: parsedStock,
      targetGroupId,
    });

    console.log("[bulk-stock] updated groups", updatedGroups);
    setColorGroups(updatedGroups);
    toast.success(changedCount > 0 ? `Stock applied to ${changedCount} row(s)` : "No size rows to update");
  };

  const applyBulkArticleCode = (targetGroupId = null, overwrite = false) => {
    const articleCode = String(bulkArticleCodeInput || "").trim();
    if (!articleCode) {
      toast.error(t("products.editor.enterArticleCode", "Enter an article code first"));
      return;
    }

    const hasTargetColor = (group) =>
      (!targetGroupId || group.id === targetGroupId) && String(group.color || "").trim();
    const targetGroups = colorGroups.filter(hasTargetColor);
    if (targetGroups.length === 0) {
      toast.error(t("products.editor.addColorBeforeBulkArticle", "Add a color before applying article codes"));
      return;
    }

    const hasExistingArticle = targetGroups.some((group) =>
      String(group.article_code || "").trim() ||
      (group.sizes || []).some((row) => String(row.article_code || "").trim())
    );
    if (hasExistingArticle && !overwrite) {
      const confirmed = window.confirm(t("products.editor.confirmOverwriteArticleCodes", "Some variants already have article codes. Overwrite them?"));
      if (!confirmed) return;
    }

    let changedCount = 0;
    setColorGroups((prev) =>
      prev.map((group) => {
        if (!hasTargetColor(group)) return group;
        const shouldSetGroup = overwrite || !String(group.article_code || "").trim();
        const nextSizes = (group.sizes || []).map((row) => {
          const shouldSetRow = overwrite || !String(row.article_code || "").trim();
          if (!shouldSetRow) return row;
          changedCount += 1;
          return { ...row, article_code: articleCode };
        });
        if (shouldSetGroup) changedCount += 1;
        return {
          ...group,
          article_code: shouldSetGroup ? articleCode : group.article_code,
          sizes: nextSizes,
        };
      })
    );
    toast.success(changedCount > 0 ? t("products.editor.articleCodeApplied", "Article code applied") : t("products.editor.noArticleCodesUpdated", "No article codes updated"));
  };

  const handleCover = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const preview = await readFileAsDataUrl(file);
    setCoverImage(preview);
    setCoverLabel(file.name);
    setThermalImageUrl("");
    event.target.value = "";
  };

  const buildAiProductPayload = () => ({
    ...getAiImagePayload(coverImage),
    color_name: colorGroups.map((group) => group.color).filter(Boolean).join(", "),
    product_name: product.name,
    brand,
    manufacturer: getDefaultManufacturerName(manufacturers, defaultManufacturerId),
    current: {
      ...descriptionContext,
      product_name: product.name,
      description_ar: product.description_ar,
      description_en: product.description_en,
      meta_title: product.meta_title,
      seo_description: product.seo_description,
      seo_keywords: product.seo_keywords,
      canonical_slug: product.canonical_slug,
    },
  });

  const handleGenerateAiProductData = async () => {
    if (!coverImage) {
      toast.error(t("products.editor.uploadMainImageFirst"));
      return;
    }

    setAiProductLoading(true);
    setAiProductData(null);
    setAiProductProgress(AI_PROGRESS_STEPS[0]);
    const timers = AI_PROGRESS_STEPS.slice(1).map((step, index) =>
      window.setTimeout(() => setAiProductProgress(step), (index + 1) * 900)
    );

    try {
      const result = await generateAiProductData(buildAiProductPayload());
      setAiProductData(result);
      if (result?.source === "TEXT_FALLBACK") {
        toast("Vision AI unavailable. Text generator suggestions are ready.");
      } else {
        toast.success(t("products.editor.aiProductSuggestionsReady"));
      }
    } catch (error) {
      console.error(error);
      const fallback = safeGenerateProductDescriptions(descriptionContext);
      setAiProductData({
        source: "LOCAL_TEXT_FALLBACK",
        confidence: 25,
        suggestions: {
          name_en: product.name,
          name_ar: product.name,
          description_ar: fallback.description_ar,
          description_en: fallback.description_en,
          meta_title_en: fallback.meta_title,
          seo_description_en: fallback.seo_description,
          seo_keywords: fallback.seo_keywords,
          canonical_slug: fallback.canonical_slug,
          suggested_category: childCategory || subCategory || mainCategory || product.category,
          suggested_product_type: product.product_type,
          gender: product.audiences?.[0] || product.gender,
          grade: product.grade,
          dominant_colors: colorGroups.map((group) => group.color).filter(Boolean),
          detection_confidence: {
            colors: colorGroups.some((group) => String(group.color || "").trim()) ? 45 : 15,
            product_type: product.product_type ? 40 : 15,
          },
        },
      });
      toast.error(t("products.editor.aiFailedFallback"));
    } finally {
      timers.forEach((timer) => window.clearTimeout(timer));
      setAiProductProgress(AI_PROGRESS_STEPS[0]);
      setAiProductLoading(false);
    }
  };

  const handleGenerateThermalImage = async ({ colorGroup = null } = {}) => {
    const thermalSourceImage = getThermalArtworkSourceImage(coverImage, colorGroup, colorGroups);
    if (!thermalSourceImage) {
      toast.error(t("products.editor.uploadMainImageFirst"));
      return;
    }

    try {
      setThermalImageGenerating(true);
      const result = await generateThermalArtwork({
        productId: product.id,
        image_url: thermalSourceImage,
        thermal_image_url: colorGroup?.thermal_image_url || thermalImageUrl,
        regenerate: Boolean(colorGroup?.thermal_image_url || thermalImageUrl),
        product_name: product.name,
      });
      const thermalUrl = String(result?.thermal_image_url || "").trim();
      if (!thermalUrl) throw new Error("Thermal image generation failed");
      if (colorGroup?.id) {
        setColorGroups((prev) =>
          prev.map((group) =>
            group.id === colorGroup.id
              ? {
                  ...group,
                  thermal_image_url: thermalUrl,
                }
              : group
          )
        );
      }
      setProduct((current) => ({ ...current, thermal_image_url: thermalUrl }));
      setThermalImageUrl(thermalUrl);
      toast.success("AI thermal artwork generated");
    } catch (error) {
      console.warn("[products:edit] thermal artwork generation failed", error);
      toast.error(error?.message || "Thermal artwork generation failed");
    } finally {
      setThermalImageGenerating(false);
    }
  };

  const applyAiProductSuggestion = (field) => {
    const suggestions = aiProductData?.suggestions || {};
    const value = getSuggestionValue(suggestions, field);
    if (!value && !["dominant_colors"].includes(field)) return;

    if (field === "name_en") updateProductField("name", value);
    if (field === "description_ar") {
      setProduct((current) => ({ ...current, description_ar: value, description: current.description_en || value }));
      setDescriptionTouched((current) => ({ ...current, ar: true }));
    }
    if (field === "description_en") {
      setProduct((current) => ({ ...current, description_en: value, description: value || current.description_ar || "" }));
      setDescriptionTouched((current) => ({ ...current, en: true }));
    }
    if (field === "meta_title_en") {
      updateProductField("meta_title", value);
      setSeoTouched((current) => ({ ...current, title: true }));
    }
    if (field === "seo_description_en") {
      updateProductField("seo_description", value);
      setSeoTouched((current) => ({ ...current, description: true }));
    }
    if (field === "seo_keywords") {
      updateProductField("seo_keywords", value);
      setSeoTouched((current) => ({ ...current, keywords: true }));
    }
    if (field === "canonical_slug") {
      updateProductField("canonical_slug", value);
      setSeoTouched((current) => ({ ...current, slug: true }));
    }
    if (field === "suggested_category") setMainCategory(value);
    if (field === "suggested_product_type") updateProductField("product_type", value);
    if (field === "gender") {
      const nextAudience = normalizeAudienceValue(value);
      setProduct((current) => ({
        ...current,
        gender: nextAudience || value,
        audiences: nextAudience ? [nextAudience] : current.audiences || [],
        product_audiences: nextAudience ? [nextAudience] : current.product_audiences || [],
      }));
    }
    if (field === "grade") updateProductField("grade", value);
  };

  const applyAllAiProductSuggestions = () => {
    const suggestions = aiProductData?.suggestions || {};
    const overwrites = [
      product.name,
      product.description_ar,
      product.description_en,
      product.meta_title,
      product.seo_description,
      product.seo_keywords,
      product.canonical_slug,
      mainCategory,
      product.product_type,
      product.gender,
      product.grade,
    ].some((value) => String(value || "").trim());

    if (overwrites && !window.confirm(t("products.editor.confirmApplyAiSuggestions"))) return;

    [
      "name_en",
      "description_ar",
      "description_en",
      "meta_title_en",
      "seo_description_en",
      "seo_keywords",
      "canonical_slug",
      "suggested_category",
      "suggested_product_type",
      "gender",
      "grade",
    ].forEach((field) => {
      if (getSuggestionValue(suggestions, field)) applyAiProductSuggestion(field);
    });
  };

  const removeCover = () => {
    setCoverImage("");
    setCoverLabel("");
  };

  const handleGallery = async (event) => {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;
    const items = await Promise.all(
      files.map(async (file) => ({
        id: makeId(),
        name: file.name,
        size: file.size,
        preview: await readFileAsDataUrl(file),
      }))
    );
    setGallery((prev) => dedupeImages([...prev, ...items]));
    event.target.value = "";
  };

  const removeGalleryItem = (galleryId) => {
    const target = gallery.find((item) => String(item.id || item.name) === String(galleryId));
    const next = gallery.filter((item) => String(item.id || item.name) !== String(galleryId));
    const targetSrc = target?.preview || target?.image_url || target?.url || "";
    const removedPrimary = targetSrc && coverImage && targetSrc === coverImage;
    setGallery(next);
    if (removedPrimary) {
      const nextPrimary = next[0] || null;
      setCoverImage(resolveMainPreviewImageUrl(nextPrimary));
      setCoverLabel(nextPrimary?.name || "");
      setThermalImageUrl("");
    }
    toast.success(t("products.images.removed"));
  };

  const setGalleryItemAsPrimary = (item) => {
    const src = resolveMainPreviewImageUrl(item);
    if (!src) return;
    setCoverImage(src);
    setCoverLabel(item?.name || "Gallery image");
    setThermalImageUrl("");
    toast.success(t("products.editor.primaryProductImageUpdated"));
  };

  const removeSizeRow = (groupId, rowId) => {
    const targetGroup = colorGroups.find((group) => group.id === groupId);
    const targetRow = targetGroup?.sizes?.find((row) => row.id === rowId);
    if (targetRow?.variantId) {
      queueRemovedVariantIds([targetRow.variantId]);
    }

    setColorGroups((prev) =>
      prev.map((group) => {
        if (group.id !== groupId) return group;
        const nextSizes = group.sizes.filter((row) => row.id !== rowId);
        return {
          ...group,
          sizes:
            nextSizes.length > 0
              ? nextSizes
              : [createEmptySizeRow()],
        };
      })
    );
    setVariantStructureEdited(true);
  };

  const updateSizeRow = (groupId, rowId, field, value) => {
    setColorGroups((prev) =>
      buildAutoVariantGroups(
        prev.map((group) =>
          group.id === groupId
            ? {
                ...group,
                sizes: group.sizes.map((row) =>
                  row.id === rowId
                    ? {
                        ...row,
                        [field]: field === "barcode" ? String(value || "") : field === "sku" ? String(value || "").toUpperCase().replace(/[^A-Z0-9-]/g, "") : value,
                        ...(field === "sku" ? { skuManualOverride: true } : {}),
                        isStarter: false,
                      }
                    : row
                ),
              }
            : group
        )
      )
    );
    if (field === "size") {
      setVariantStructureEdited(true);
    }
  };

  const handleSave = async () => {
    console.log("[edit-product] save diagnostics", {
      savedVariantsCount,
      currentVariantRowsCount,
      removedVariantIds,
      isCopyMode,
      variantStructureEdited,
      variantsHydrationFailed,
    });

    const missingVariantsBlocked =
      !isSimpleMode &&
      (
        variantsHydrationFailed ||
        (savedVariantsCount > 0 && summary.existingRows === 0 && !variantStructureEdited && !isCopyMode)
      );

    if (missingVariantsBlocked) {
      console.error("[edit-product] save blocked due to missing variants", {
        productId,
        savedVariantsCount,
        currentVariantRowsCount,
        existingRows: summary.existingRows,
        removedVariantIds,
        isCopyMode,
        variantStructureEdited,
        variantsHydrationFailed,
      });
      toast.error(t("products.editor.variantsFailed"));
      return;
    }

    if (!product.name.trim()) {
      toast.error(t("products.editor.productNameRequired"));
      return;
    }

    const normalizedGroups = isSimpleMode
      ? []
      : colorGroups
          .map((group) => ({
            ...group,
            color: String(group.color || "").trim(),
            article_code: String(group.article_code || "").trim(),
            image_url: String(getPrimaryColorImage(group) || group.image_url || "").trim(),
            images: normalizeColorImages(group.images),
            sizes: Array.isArray(group.sizes) ? group.sizes : [],
          }))
          .filter((group) => {
            const hasAnyContent =
              Boolean(group.color) ||
              Boolean(group.article_code) ||
              Boolean(group.edition_name) ||
              Boolean(group.image_url) ||
              (Array.isArray(group.images) && group.images.length > 0) ||
              group.sizes.some((row) => [row.size, row.sku, row.price, row.variantId].some((value) => String(value || "").trim()));
            return hasAnyContent;
          });

    if (!isSimpleMode && normalizedGroups.length > 0) {
      const invalidGroup = normalizedGroups.find((group) => !group.color);
      if (invalidGroup) {
      toast.error(t("products.editor.eachColorNeedsName"));
        return;
      }

      const invalidRow = normalizedGroups.find((group) =>
        group.sizes.some((row) => {
          const rowHasContent = [row.sku, row.barcode, row.price, row.variantId].some((value) =>
            String(value || "").trim()
          );
          return rowHasContent && !String(row.size || "").trim();
        })
      );

      if (invalidRow) {
        toast.error(`Each size row for "${invalidRow.color}" needs a size value`);
        return;
      }
    }

    const variantPayloads = [];
    const colorImagesPayload = normalizedGroups
      .map((group) => {
        const groupColor = String(group.color || "").trim();
        if (!groupColor) return null;
        const images = normalizeColorImages(group.images);
        const primaryImageUrl = String(getPrimaryColorImage(group) || colorImageUrlsRef.current.get(group.id) || "").trim();
        const groupImages = dedupeImages(images.length
          ? images
          : primaryImageUrl
            ? [{ id: makeId(), preview: primaryImageUrl, image_url: primaryImageUrl, is_primary: true, name: `${groupColor} image` }]
            : []);
        const thermalImageUrl = String(group.thermal_image_url || "").trim();
        return {
          color_name: groupColor,
          color_value: groupColor,
          article_code: String(group.article_code || "").trim(),
          thermal_image_url: thermalImageUrl,
          thermalImageUrl: thermalImageUrl,
          product_thermal_image_url: thermalImageUrl,
          productThermalImageUrl: thermalImageUrl,
          color_thermal_image_url: thermalImageUrl,
          colorThermalImageUrl: thermalImageUrl,
          variant_color_thermal_image_url: thermalImageUrl,
          variantColorThermalImageUrl: thermalImageUrl,
          images: dedupeImages(groupImages).map((image, index) => ({
            id: image.id || makeId(),
            preview: image.image_url || "",
            image_url: image.image_url || "",
            is_primary: image.is_primary ?? index === 0,
            generated_by_ai: Boolean(image.generated_by_ai),
            name: image.name || `${groupColor} image ${index + 1}`,
          })),
        };
      })
      .filter(Boolean);
    const resolvedThermalImageUrl = getResolvedThermalImageUrl({
      product: {
        thermal_image_url: thermalImageUrl,
        thermalImageUrl: thermalImageUrl,
        product_thermal_image_url: product.thermal_image_url || product.product_thermal_image_url || "",
        productThermalImageUrl: product.thermal_image_url || product.product_thermal_image_url || "",
      },
      groups: normalizedGroups,
      variants: variantPayloads,
    }) || String(thermalImageUrl || product.thermal_image_url || product.product_thermal_image_url || "").trim();

    const usedVariantSkus = new Set(existingSkuValues);
    normalizedGroups.forEach((group) => {
      const groupImageUrl = String(getPrimaryColorImage(group) || colorImageUrlsRef.current.get(group.id) || "").trim();
      const groupEditionName = mirrorEditionEnabled ? String(group.edition_name || "").trim() : "";
      const groupEditionSlug = groupEditionName ? slugifyEdition(group.edition_slug || groupEditionName) : "";
      const groupArticleCode = String(group.article_code || "").trim();
      const groupThermalImageUrl = String(group.thermal_image_url || "").trim();
      const groupManufacturerPayload = getManufacturerPayload(group.manufacturer_id);
      if (isColorOnlyMode) {
        const sourceRow = (Array.isArray(group.sizes) ? group.sizes : [])[0] || {};
        const purchaseQty = getVariantPurchaseQty(sourceRow, group);
        const payload = {
          id: sourceRow.variantId || undefined,
          variant_id: sourceRow.variantId || undefined,
          color: group.color,
          size: String(product.fixed_size_label || "One Size").trim() || "One Size",
          default_purchase_qty: purchaseQty,
          purchase_qty: purchaseQty,
          purchase_quantity: purchaseQty,
          planned_qty: purchaseQty,
          planned_quantity: purchaseQty,
          stock_qty: purchaseQty,
          bulk_purchase_qty: purchaseQty,
          sku: sourceRow.skuManualOverride && String(sourceRow.sku || "").trim()
            ? makeUniqueSku(String(sourceRow.sku || "").trim().toUpperCase(), usedVariantSkus)
            : buildVariantSku({
                prefix: product.sku || uniqueSmartSkuPrefix,
                color: group.color,
                size: String(product.fixed_size_label || "One Size").trim() || "One Size",
                usedSkus: usedVariantSkus,
          }),
          barcode: String(sourceRow.barcode || "").trim(),
          article_code: groupArticleCode,
          ...(sourceRow.variantId ? {
            purchase_price: Number(sourceRow.cost_price || 0),
            regular_price: Number(sourceRow.price || 0),
            price: Number(sourceRow.price || 0),
            sale_price: Number(sourceRow.sale_price || 0),
            sale_price_enabled: Boolean(sourceRow.sale_price_enabled),
            wholesale_price: Number(sourceRow.wholesale_price || 0),
          } : {}),
          image_url: sourceRow.image_url || groupImageUrl || "",
          variant_image_url: sourceRow.image_url || groupImageUrl || "",
          color_image_url: groupImageUrl,
          thermal_image_url: groupThermalImageUrl,
          thermalImageUrl: groupThermalImageUrl,
          product_thermal_image_url: groupThermalImageUrl,
          productThermalImageUrl: groupThermalImageUrl,
          color_thermal_image_url: groupThermalImageUrl,
          colorThermalImageUrl: groupThermalImageUrl,
          variant_color_thermal_image_url: groupThermalImageUrl,
          variantColorThermalImageUrl: groupThermalImageUrl,
          ...groupManufacturerPayload,
          edition_name: groupEditionName,
          edition_slug: groupEditionSlug,
        };
        variantPayloads.push(normalizeVariantPayload(payload));
        return;
      }

      if (isSimpleMode) return;

      group.sizes.forEach((row) => {
        if (isPlaceholderVariantRow(row, product.price) || isHydrationPlaceholderRow(row)) return;
        const size = String(row.size || "").trim();
        const rowHasContent = size || row.variantId || [row.sku, row.barcode].some((value) => String(value || "").trim());
        if (!rowHasContent || !size) return;
        const purchaseQty = getVariantPurchaseQty(row, group);

        const payload = {
          id: row.variantId || undefined,
          variant_id: row.variantId || undefined,
          color: group.color,
          size,
          default_purchase_qty: purchaseQty,
          purchase_qty: purchaseQty,
          purchase_quantity: purchaseQty,
          planned_qty: purchaseQty,
          planned_quantity: purchaseQty,
          stock_qty: purchaseQty,
          bulk_purchase_qty: purchaseQty,
          sku: row.skuManualOverride && String(row.sku || "").trim()
            ? makeUniqueSku(String(row.sku || "").trim().toUpperCase(), usedVariantSkus)
            : buildVariantSku({
                prefix: product.sku || uniqueSmartSkuPrefix,
                color: group.color,
                size,
                usedSkus: usedVariantSkus,
          }),
          barcode: String(row.barcode || "").trim(),
          article_code: groupArticleCode,
          ...(row.variantId ? {
            purchase_price: Number(row.cost_price || 0),
            regular_price: Number(row.price || 0),
            price: Number(row.price || 0),
            sale_price: Number(row.sale_price || 0),
            sale_price_enabled: Boolean(row.sale_price_enabled),
            wholesale_price: Number(row.wholesale_price || 0),
          } : {}),
          image_url: row.image_url || groupImageUrl || "",
          variant_image_url: row.image_url || groupImageUrl || "",
          color_image_url: groupImageUrl,
          thermal_image_url: String(row.thermal_image_url || row.thermalImageUrl || groupThermalImageUrl || "").trim(),
          thermalImageUrl: String(row.thermalImageUrl || row.thermal_image_url || groupThermalImageUrl || "").trim(),
          product_thermal_image_url: String(groupThermalImageUrl || "").trim(),
          productThermalImageUrl: String(groupThermalImageUrl || "").trim(),
          color_thermal_image_url: String(row.thermal_image_url || row.thermalImageUrl || groupThermalImageUrl || "").trim(),
          colorThermalImageUrl: String(row.thermalImageUrl || row.thermal_image_url || groupThermalImageUrl || "").trim(),
          variant_color_thermal_image_url: String(row.thermal_image_url || row.thermalImageUrl || groupThermalImageUrl || "").trim(),
          variantColorThermalImageUrl: String(row.thermalImageUrl || row.thermal_image_url || groupThermalImageUrl || "").trim(),
          ...groupManufacturerPayload,
          edition_name: groupEditionName,
          edition_slug: groupEditionSlug,
        };

        console.log("[edit-product] save row", {
          variantId: row.variantId || null,
          color: payload.color,
          size: payload.size,
          sku: payload.sku,
        });
        variantPayloads.push(normalizeVariantPayload(payload));
      });
    });

    console.log(
      "[product-save] variant image payload",
      variantPayloads.map((variant) => ({
        id: variant.id,
        variant_id: variant.variant_id,
        color: variant.color,
        size: variant.size,
        image_url: variant.image_url,
        variant_image_url: variant.variant_image_url,
        color_image_url: variant.color_image_url,
      }))
    );
    console.log("[edit-product] save payload product id", productId);
    console.log("[edit-product] save payload color groups count", normalizedGroups.length);
    console.log("[edit-product] save payload size rows count", variantPayloads.length);
    console.log("[edit-product] save payload variants", variantPayloads);
    console.log("PRODUCT_EDIT_THERMAL_SAVE_PAYLOAD", {
      productThermalImageUrl: resolvedThermalImageUrl,
      colorGroups: colorGroups.map((group) => ({
        color: group.color,
        thermal_image_url: group.thermal_image_url,
        color_thermal_image_url: group.color_thermal_image_url,
        variant_color_thermal_image_url: group.variant_color_thermal_image_url,
      })),
      variants: variantPayloads.map((variant) => ({
        id: variant.id,
        color: variant.color,
        size: variant.size,
        thermal_image_url: variant.thermal_image_url,
        color_thermal_image_url: variant.color_thermal_image_url,
        variant_color_thermal_image_url: variant.variant_color_thermal_image_url,
      })),
    });
    console.log("[edit-product] submit variant sync payload", {
      product_id: productId,
      submitted_colors_count: normalizedGroups.length,
      submitted_variants_count: variantPayloads.length,
      submitted_variant_ids: variantPayloads.map((variant) => variant.id || variant.variant_id || null).filter(Boolean),
      submitted_color_names: normalizedGroups.map((group) => group.color).filter(Boolean),
      removed_variant_ids: removedVariantIds,
    });

    const categoryPayload = resolveCategoryPayload(categories, {
      mainCategory,
      subCategory,
      childCategory,
      fallbackCategory: product.category,
    });
    const brandPayload = resolveBrandPayload(brands, {
      brand,
      fallbackBrandId: product.brand_id || "",
    });
    const unitPayload = resolveUnitPayload(units, {
      unit,
      fallbackUnitId: product.unit_id || "",
    });
    console.log("[edit-product] save category/brand payload", {
      category: categoryPayload.category,
      category_id: categoryPayload.category_id,
      brand: brandPayload.brand,
      brand_id: brandPayload.brand_id,
      unit: unitPayload.unit,
      unit_id: unitPayload.unit_id,
    });

    try {
      setSaving(true);

      const pendingUploads = Array.from(pendingColorUploadsRef.current.values());
      if (pendingUploads.length > 0) {
        await Promise.allSettled(pendingUploads);
      }

      const { coverImageUrl, galleryPayload } = await resolvePersistedProductImages({
        coverImage,
        gallery,
      });

      const savedProduct = await updateProduct(productId, {
        name: product.name,
        ...categoryPayload,
        ...brandPayload,
        ...unitPayload,
        description: product.description,
        description_ar: product.description_ar,
        description_en: product.description_en,
        meta_title: product.meta_title,
        seo_description: product.seo_description || product.description_en || product.description_ar || product.description,
        seo_keywords: product.seo_keywords,
        canonical_slug: product.canonical_slug,
        use_custom_compare_price: Boolean(product.use_custom_compare_price),
        custom_compare_price: Number(product.custom_compare_price || 0),
        gender: product.audiences?.[0] || product.gender || "",
        audiences: product.audiences || [],
        product_audiences: product.audiences || [],
        product_type: product.product_type || "",
        style: product.style || "",
        grade: product.grade || "",
        is_offer_story: Boolean(product.is_offer_story),
        variation_mode: product.variation_mode || "full_variations",
        fixed_size_label: isColorOnlyMode ? product.fixed_size_label || "One Size" : "",
        purchase_alerts_enabled: Boolean(product.purchase_alerts_enabled),
        purchase_alert_by_color: Boolean(product.purchase_alert_by_color),
        carton_size: product.carton_size === "" || product.carton_size === null || product.carton_size === undefined ? null : Number(product.carton_size),
        suggested_purchase_cartons: Number(product.suggested_purchase_cartons || 1),
        planned_quantities: [],
        low_stock_threshold: Number(product.low_stock_threshold || product.low_stock_alert || 0),
        low_stock_alert: Number(product.low_stock_alert || product.low_stock_threshold || 0),
        low_stock_tracking_mode: null,
        product_low_stock_threshold: null,
        minimum_distinct_sizes_required: null,
        sku: product.sku || uniqueSmartSkuPrefix,
        barcode: product.barcode || "",
        status: product.status || "active",
        image_url: coverImageUrl,
        thermal_image_url: resolvedThermalImageUrl,
        gallery_images: galleryPayload,
        variants: isSimpleMode ? [] : variantPayloads,
        colorImages: isSimpleMode ? [] : colorImagesPayload.map((group) => ({
          ...group,
          images: dedupeImages(group.images),
        })),
        ...getManufacturerPayload(defaultManufacturerId),
        deleted_variant_ids: removedVariantIds,
      });
      console.log("[edit-product] backend variant sync result", {
        product_id: productId,
        variant_sync: savedProduct?.variant_sync,
        returned_variants_count: Array.isArray(savedProduct?.variants) ? savedProduct.variants.length : 0,
        returned_variant_ids: Array.isArray(savedProduct?.variants)
          ? savedProduct.variants.map((variant) => variant.id || variant.variant_id).filter(Boolean)
          : [],
      });
      setSavedVariantsCount(variantPayloads.length);
      setRemovedVariantIds([]);
      setVariantStructureEdited(false);
      initialEditorSignatureRef.current = editorSignature;
      cleanupProductCache();

      if (savedProduct?.color_images?.length) {
        setColorGroups((prev) =>
          prev.map((group) => {
            const savedGroup = savedProduct.color_images.find(
              (item) => normalizeColorKey(item.color_name || item.color) === normalizeColorKey(group.color)
            );
            if (!savedGroup) return group;
            const images = normalizeColorImages(savedGroup.images);
            const primary = images.find((item) => item.is_primary) || images[0] || null;
            return {
              ...group,
              ai_cover: savedGroup.ai_cover || group.ai_cover || null,
              ai_cover_status: savedGroup.ai_cover_status || savedGroup.ai_cover?.status || group.ai_cover_status || "",
              images,
              image_url: primary?.image_url || group.image_url || "",
              imagePreview: primary?.preview || primary?.image_url || group.imagePreview || "",
            };
          })
        );
      }

      upsertProductMeta({
        id: productId,
        name: product.name,
        brand: brandPayload.brand || product.brand,
        category: categoryPayload.category || product.category,
        main_category: mainCategory,
        sub_category: subCategory,
        child_category: childCategory,
        unit: unitPayload.unit || product.unit,
        description: product.description,
        description_ar: product.description_ar,
        description_en: product.description_en,
        meta_title: product.meta_title,
        seo_description: product.seo_description || product.description_en || product.description_ar || product.description,
        seo_keywords: product.seo_keywords,
        canonical_slug: product.canonical_slug,
        use_custom_compare_price: Boolean(product.use_custom_compare_price),
        custom_compare_price: Number(product.custom_compare_price || 0),
        gender: product.audiences?.[0] || product.gender || "",
        audiences: product.audiences || [],
        product_audiences: product.audiences || [],
        product_type: product.product_type || "",
        style: product.style || "",
        grade: product.grade || "",
        is_offer_story: Boolean(product.is_offer_story),
        variation_mode: product.variation_mode || "full_variations",
        fixed_size_label: isColorOnlyMode ? product.fixed_size_label || "One Size" : "",
        purchase_alerts_enabled: Boolean(product.purchase_alerts_enabled),
        purchase_alert_by_color: Boolean(product.purchase_alert_by_color),
        carton_size: product.carton_size === "" || product.carton_size === null || product.carton_size === undefined ? null : Number(product.carton_size),
        suggested_purchase_cartons: Number(product.suggested_purchase_cartons || 1),
        status: product.status || "active",
        active: product.status !== "inactive" && product.status !== "archived",
        image_url: coverImageUrl,
        thermal_image_url: resolvedThermalImageUrl,
        gallery: galleryPayload,
        gallery_images: galleryPayload,
      });

      toast.success(t("products.editor.productUpdated"));

      navigate("/products");
    } catch (err) {
      console.log(err);
      toast.error(err?.message || "Failed to save product");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ProductsShell
      title={t("products.editor.editTitle", "Edit Product")}
      description={t("products.editor.editDescription", "Update product details and manage colors, sizes, images, and variant records from one editor.")}
      actions={
        <Link
          to="/products"
          onClick={confirmLeaveIfDirty}
          className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-5 py-3 font-semibold text-white transition hover:bg-white/10"
        >
          <ArrowLeft size={18} />
          Back to products
        </Link>
      }
    >
      {loading ? (
        <div className="rounded-[34px] border border-white/8 bg-zinc-950/80 p-10 text-center text-zinc-400">
          <Loader2 className="mx-auto h-10 w-10 animate-spin text-emerald-400" />
          <p className="mt-4 text-sm font-semibold text-white">{t("products.editor.loading")}</p>
        </div>
      ) : error ? (
        <div className="rounded-[34px] border border-red-500/20 bg-red-500/10 p-8 text-red-100">
          <p className="text-lg font-black text-white">{error}</p>
          <button
            type="button"
            onClick={() => navigate("/products")}
            className="mt-4 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white"
          >
            <ArrowLeft size={16} />
            Back
          </button>
        </div>
      ) : (
        <div className="space-y-6 pb-28 lg:pb-24">
          <ProductActionBar
            mode="edit"
            saving={saving}
            hasUnsavedChanges={hasUnsavedChanges}
            onSave={handleSave}
          />
          <section className="rounded-[30px] border border-white/8 bg-zinc-950/80 p-5 shadow-[0_24px_80px_rgba(0,0,0,0.22)]">
            <div className="flex items-center gap-3">
              <Sparkles className="h-5 w-5 text-emerald-400" />
              <h2 className="text-xl font-black text-white">{t("products.editor.basicInformation", "Basic information")}</h2>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4">
              <div>
                <label className="text-sm font-semibold text-zinc-200">{t("products.form.productName", "Product name")}</label>
                <input
                  value={product.name}
                  onChange={(event) => updateProductField("name", event.target.value)}
                  className="mt-1.5 h-11 w-full rounded-[14px] border border-white/10 bg-zinc-900/80 px-3.5 font-semibold text-white shadow-inner shadow-black/20 outline-none ring-1 ring-inset ring-white/[0.03] transition focus:border-emerald-300/35 focus:bg-zinc-900"
                />
              </div>

              <div className="rounded-[18px] border border-white/8 bg-white/[0.028] p-3">
                <label className="text-sm font-semibold text-zinc-200">{t("products.editor.skuPrefix", "SKU prefix")}</label>
                <div className="mt-1.5 flex gap-2">
                  <input
                    value={product.sku || ""}
                    onChange={(event) => {
                      updateProductField("sku", event.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ""));
                      setSkuTouched(true);
                    }}
                    className="h-10 min-w-0 flex-1 rounded-[13px] border border-white/8 bg-white/[0.045] px-3.5 font-semibold text-white shadow-inner shadow-black/20 outline-none ring-1 ring-inset ring-white/[0.045] transition focus:border-emerald-300/35 focus:bg-white/[0.06]"
                  />
                  <button
                    type="button"
                    onClick={regenerateSkuPrefix}
                    className="inline-flex h-10 items-center gap-1.5 rounded-[13px] border border-white/10 bg-white/[0.045] px-3 text-xs font-bold text-zinc-100 transition hover:border-emerald-300/30 hover:bg-emerald-300/10 hover:text-emerald-100"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    Regenerate from product name
                  </button>
                </div>
                <p className="mt-1 text-[11px] text-zinc-500">
                  Auto: {uniqueSmartSkuPrefix}{skuTouched ? " (manual override)" : ""}
                </p>
              </div>

              <div className="rounded-[18px] border border-white/8 bg-white/[0.028] p-3">
                <div>
                  <p className="text-[11px] font-black uppercase tracking-[0.18em] text-zinc-200">{t("products.editor.pricingSummary", "Pricing summary")}</p>
                  <p className="mt-0.5 text-xs text-zinc-500">{t("products.editor.pricingSummaryHelp", "Read-only. Active pricing is updated when purchase invoice stock is received.")}</p>
                </div>
                <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-4">
                  <div className="rounded-[16px] border border-white/8 bg-white/[0.035] p-3">
                    <p className="text-[11px] font-black uppercase tracking-[0.14em] text-zinc-500">{t("products.editor.currentRegularPrice", "Current regular price")}</p>
                    <p className="mt-2 text-sm font-black text-zinc-100">{Number(product.regular_price || product.price || 0) > 0 ? formatCurrency(product.regular_price || product.price) : "Not set"}</p>
                  </div>
                  <div className="rounded-[16px] border border-white/8 bg-white/[0.035] p-3">
                    <p className="text-[11px] font-black uppercase tracking-[0.14em] text-zinc-500">{t("products.editor.currentSalePrice", "Current sale price")}</p>
                    <p className="mt-2 text-sm font-black text-zinc-100">{product.sale_price_enabled && Number(product.sale_price || 0) > 0 ? formatCurrency(product.sale_price) : "Not active"}</p>
                  </div>
                  <div className="rounded-[16px] border border-white/8 bg-white/[0.035] p-3">
                    <p className="text-[11px] font-black uppercase tracking-[0.14em] text-zinc-500">{t("products.editor.currentCost", "Current cost")}</p>
                    <p className="mt-2 text-sm font-black text-zinc-100">{Number(product.cost_price || 0) > 0 ? formatCurrency(product.cost_price) : "Not set"}</p>
                  </div>
                  <div className="rounded-[16px] border border-white/8 bg-white/[0.035] p-3">
                    <p className="text-[11px] font-black uppercase tracking-[0.14em] text-zinc-500">{t("products.editor.lastUpdatedFromPurchase", "Last updated from purchase invoice")}</p>
                    <p className="mt-2 text-sm font-black text-zinc-100">{product.last_purchase_pricing_at ? String(product.last_purchase_pricing_at).slice(0, 16).replace("T", " ") : "Not yet"}</p>
                  </div>
                </div>
              </div>

              <div className="rounded-[18px] border border-white/8 bg-white/[0.028] p-3">
                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={Boolean(product.use_custom_compare_price)}
                    onChange={(event) => updateProductField("use_custom_compare_price", event.target.checked)}
                    className="mt-1 h-4 w-4 rounded border-white/20 bg-zinc-900"
                  />
                  <span>
                    <span className="block text-sm font-black text-zinc-100">{t("products.editor.customComparePrice", "Custom storefront compare price")}</span>
                    <span className="mt-1 block text-xs text-zinc-500">{t("products.editor.customComparePriceHelp", "Marketing-only old price. It does not affect POS, invoices, cost, valuation, or profit.")}</span>
                  </span>
                </label>
                {product.use_custom_compare_price ? (
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={product.custom_compare_price || ""}
                    onChange={(event) => updateProductField("custom_compare_price", event.target.value)}
                    placeholder={t("products.editor.oldPricePlaceholder", "Old price shown on storefront")}
                    className="mt-3 h-10 w-full rounded-[13px] border border-white/8 bg-white/[0.045] px-3.5 font-semibold text-white shadow-inner shadow-black/20 outline-none ring-1 ring-inset ring-white/[0.045] transition placeholder:text-zinc-600 hover:border-emerald-300/35 focus:border-emerald-300/50 focus:bg-white/[0.06]"
                  />
                ) : null}
              </div>

              <div className="rounded-[28px] border border-emerald-300/15 bg-gradient-to-br from-emerald-400/10 via-white/[0.055] to-cyan-400/10 p-5 shadow-[0_18px_60px_rgba(0,0,0,0.18)] transition duration-200 hover:border-emerald-300/25 hover:bg-white/[0.07]">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-base font-black text-white">{t("products.editor.customerDescriptionTitle", "Product Description (Customer-facing)")}</p>
                    <p className="mt-1 text-xs leading-5 text-zinc-400">{t("products.editor.customerDescriptionHelp", "Primary storefront content for catalog pages, product pages, reports, and customer-facing previews.")}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => regenerateDescriptions("ar")}
                      disabled={descriptionGenerating.ar}
                      className="inline-flex h-9 items-center rounded-[12px] border border-white/10 bg-white/5 px-3 text-xs font-semibold text-zinc-100 transition hover:border-emerald-300/30 hover:bg-emerald-400/10 hover:text-emerald-100"
                    >
                      {descriptionGenerating.ar ? t("products.editor.generatingArabic", "Generating Arabic...") : t("products.editor.regenerateArabic", "Regenerate Arabic")}
                    </button>
                    <button
                      type="button"
                      onClick={() => regenerateDescriptions("en")}
                      disabled={descriptionGenerating.en}
                      className="inline-flex h-9 items-center rounded-[12px] border border-white/10 bg-white/5 px-3 text-xs font-semibold text-zinc-100 transition hover:border-sky-300/30 hover:bg-sky-400/10 hover:text-sky-100"
                    >
                      {descriptionGenerating.en ? t("products.editor.generatingEnglish", "Generating English...") : t("products.editor.regenerateEnglish", "Regenerate English")}
                    </button>
                    <button
                      type="button"
                      onClick={() => regenerateDescriptions("all")}
                      disabled={descriptionGenerating.ar || descriptionGenerating.en}
                      className="inline-flex h-9 items-center rounded-[12px] border border-amber-300/20 bg-amber-300/10 px-3 text-xs font-semibold text-amber-100 transition hover:border-amber-300/40 hover:bg-amber-300/15"
                    >
                      {descriptionGenerating.ar && descriptionGenerating.en ? t("products.editor.generating", "Generating...") : t("products.editor.regenerateAll", "Regenerate All")}
                    </button>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
                  <div className="lg:col-span-2">
                    <label className="text-sm font-semibold text-zinc-200">{t("products.editor.promptCustomization", "Prompt customization")}</label>
                    <input
                      value={descriptionTone}
                      onChange={(event) => setDescriptionTone(event.target.value)}
                      placeholder={t("products.editor.promptPlaceholder", "premium tone, concise tone, friendly tone")}
                      className="mt-1.5 h-11 w-full rounded-[16px] border border-white/10 bg-zinc-900/80 px-4 text-sm text-white shadow-inner shadow-black/20 outline-none ring-1 ring-inset ring-white/[0.03] placeholder:text-zinc-500 transition focus:border-amber-300/35 focus:bg-zinc-900"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-semibold text-zinc-200">{t("products.editor.arabicDescription", "Arabic description")}</label>
                    <textarea
                      value={product.description_ar || ""}
                      onChange={(event) => {
                        const value = event.target.value;
                        setProduct((current) => ({
                          ...current,
                          description_ar: value,
                          description: current.description_en || value,
                          seo_description: current.description_en || value,
                        }));
                        setDescriptionTouched((current) => ({ ...current, ar: true }));
                      }}
                      rows={6}
                      dir="rtl"
                      placeholder={generatedDescriptions.description_ar}
                      className="mt-1.5 w-full rounded-[16px] border border-white/10 bg-zinc-900/80 px-4 py-3 text-sm leading-6 text-white shadow-inner shadow-black/20 outline-none ring-1 ring-inset ring-white/[0.03] placeholder:text-zinc-500 transition focus:border-emerald-300/35 focus:bg-zinc-900"
                    />
                  </div>

                  <div>
                    <label className="text-sm font-semibold text-zinc-200">{t("products.editor.englishDescription", "English description")}</label>
                    <textarea
                      value={product.description_en || ""}
                      onChange={(event) => {
                        const value = event.target.value;
                        setProduct((current) => ({
                          ...current,
                          description_en: value,
                          description: value || current.description_ar || "",
                          seo_description: value || current.description_ar || "",
                        }));
                        setDescriptionTouched((current) => ({ ...current, en: true }));
                      }}
                      rows={6}
                      placeholder={generatedDescriptions.description_en}
                      className="mt-1.5 w-full rounded-[16px] border border-white/10 bg-zinc-900/80 px-4 py-3 text-sm leading-6 text-white shadow-inner shadow-black/20 outline-none ring-1 ring-inset ring-white/[0.03] placeholder:text-zinc-500 transition focus:border-sky-300/35 focus:bg-zinc-900"
                    />
                  </div>
              </div>
              </div>

              <div className="mt-4">
                <MultiVersionGenerator
                  context={descriptionContext}
                  onApplyVersion={applyGeneratedVersion}
                  t={t}
                />
              </div>

              <div className={`rounded-[22px] border p-3 shadow-[0_16px_45px_rgba(0,0,0,0.18)] transition ${seoOpen ? "border-amber-300/28 bg-amber-300/[0.075]" : "border-sky-300/20 bg-sky-400/[0.06] hover:border-sky-300/32 hover:bg-sky-400/[0.09]"}`}>
                <button type="button" onClick={() => setSeoOpen((current) => !current)} className="flex w-full items-center justify-between gap-3 text-left">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] border border-amber-200/20 bg-amber-300/10 text-amber-100">
                      <Search size={17} />
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-black text-white">{t("products.editor.seoMetadata", "SEO metadata")}</p>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.14em] ${seoOpen ? "bg-amber-300/20 text-amber-100" : "bg-sky-300/15 text-sky-100"}`}>
                          {seoOpen ? t("products.editor.expanded", "Expanded") : t("products.editor.collapsed", "Collapsed")}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs font-semibold text-zinc-300">{t("products.editor.googleFacebookPreview", "Google / Facebook Preview")}</p>
                      <p className="mt-0.5 text-xs text-zinc-500">{t("products.editor.advancedPreviewHelp", "Advanced preview fields generated separately from product descriptions.")}</p>
                    </div>
                  </div>
                  <ChevronDown className={`h-5 w-5 shrink-0 text-amber-100 transition ${seoOpen ? "rotate-180" : ""}`} />
                </button>

                {seoOpen ? (
                  <div className="mt-3 border-t border-white/10 pt-3">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs font-black uppercase tracking-[0.18em] text-zinc-500">{t("products.editor.advancedSeo", "Advanced SEO")}</p>
                      <button
                        type="button"
                        onClick={regenerateSeoMetadata}
                        disabled={seoGenerating}
                        className="inline-flex h-9 items-center rounded-[12px] border border-white/10 bg-white/5 px-3 text-xs font-semibold text-zinc-100 transition hover:border-amber-300/30 hover:bg-amber-300/10 hover:text-amber-100"
                      >
                        {seoGenerating ? t("products.editor.generatingSeo", "Generating SEO...") : t("products.editor.regenerateSeoMetadata", "Regenerate SEO Metadata")}
                      </button>
                    </div>
                    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                      <div className="rounded-[18px] border border-white/10 bg-zinc-950/75 p-4 lg:col-span-2">
                        <div className="mb-3 flex items-center gap-2 text-xs font-black uppercase tracking-[0.16em] text-zinc-500">
                          <Search size={14} />
                          Google search result preview
                        </div>
                        <div className="rounded-[16px] border border-white/8 bg-white/[0.03] p-3">
                          <p className="truncate text-[13px] text-zinc-400">{seoPreviewUrl}</p>
                          <p className="mt-1 line-clamp-1 text-lg font-semibold text-sky-300">{seoPreviewTitle}</p>
                          <p className="mt-1 line-clamp-2 text-sm leading-5 text-zinc-300">{seoPreviewDescription}</p>
                        </div>
                      </div>
                      <div className="rounded-[18px] border border-white/10 bg-zinc-950/75 p-4 lg:col-span-2">
                        <div className="mb-3 flex items-center gap-2 text-xs font-black uppercase tracking-[0.16em] text-zinc-500">
                          <Share2 size={14} />
                          Facebook / WhatsApp preview
                        </div>
                        <div className="overflow-hidden rounded-[16px] border border-white/10 bg-white/[0.04]">
                          <div className="relative w-full aspect-[1.91/1] overflow-hidden rounded-t-2xl bg-white">
                            {coverImage ? (
                              <img
                                src={resolveAssetUrl(coverImage)}
                                alt="Open Graph preview"
                                className="h-full w-full object-contain bg-white"
                              />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center bg-zinc-900/90">
                                <Share2 className="text-zinc-600" size={28} />
                              </div>
                            )}
                          </div>
                          <div className="p-3">
                            <p className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">{t("products.editor.previewDomain")}</p>
                            <p className="mt-1 line-clamp-1 text-sm font-black text-white">{seoPreviewTitle}</p>
                            <p className="mt-1 line-clamp-2 text-xs leading-5 text-zinc-400">{seoPreviewDescription}</p>
                          </div>
                        </div>
                      </div>
                      <div>
                        <label className="text-sm font-semibold text-zinc-300">{t("products.editor.metaTitle", "Meta title")}</label>
                        <input
                          value={product.meta_title || ""}
                          onChange={(event) => {
                            updateProductField("meta_title", event.target.value);
                            setSeoTouched((current) => ({ ...current, title: true }));
                          }}
                          className="mt-1.5 h-10 w-full rounded-[14px] border border-white/10 bg-zinc-900/80 px-3 text-sm font-semibold text-white shadow-inner shadow-black/20 outline-none"
                        />
                      </div>
                      <div>
                        <label className="text-sm font-semibold text-zinc-300">{t("products.editor.canonicalSlug")}</label>
                        <input
                          value={product.canonical_slug || ""}
                          onChange={(event) => {
                            updateProductField("canonical_slug", event.target.value);
                            setSeoTouched((current) => ({ ...current, slug: true }));
                          }}
                          className="mt-1.5 h-10 w-full rounded-[14px] border border-white/10 bg-zinc-900/80 px-3 text-sm font-semibold text-white shadow-inner shadow-black/20 outline-none"
                        />
                      </div>
                      <div className="lg:col-span-2">
                        <label className="text-sm font-semibold text-zinc-300">{t("products.editor.seoMetaDescriptionPreview")}</label>
                        <textarea
                          value={product.seo_description || ""}
                          onChange={(event) => {
                            updateProductField("seo_description", event.target.value);
                            setSeoTouched((current) => ({ ...current, description: true }));
                          }}
                          rows={3}
                          className="mt-1.5 w-full rounded-[14px] border border-white/10 bg-zinc-900/80 px-3 py-2 text-sm leading-5 text-white shadow-inner shadow-black/20 outline-none"
                        />
                        <p className="mt-1 text-[11px] text-zinc-500">{String(product.seo_description || "").length}/160 characters</p>
                      </div>
                      <div className="lg:col-span-2">
                        <label className="text-sm font-semibold text-zinc-300">{t("products.editor.seoKeywords", "SEO keywords")}</label>
                        <input
                          value={product.seo_keywords || ""}
                          onChange={(event) => {
                            updateProductField("seo_keywords", event.target.value);
                            setSeoTouched((current) => ({ ...current, keywords: true }));
                          }}
                          className="mt-1.5 h-10 w-full rounded-[14px] border border-white/10 bg-zinc-900/80 px-3 text-sm text-white shadow-inner shadow-black/20 outline-none"
                        />
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            <ProductForm
              categories={categories}
              brands={brands}
              units={units}
              variationMode={product.variation_mode}
              mainCategory={mainCategory}
              subCategory={subCategory}
              childCategory={childCategory}
              brand={brand}
              unit={unit}
              gender={product.gender}
              audiences={product.audiences || []}
              productType={product.product_type}
              grade={product.grade}
              isOfferStory={product.is_offer_story}
              onMainCategoryChange={setMainCategory}
              onSubCategoryChange={setSubCategory}
              onChildCategoryChange={setChildCategory}
              onBrandChange={setBrand}
              onUnitChange={setUnit}
              onVariationModeChange={(value) => updateProductField("variation_mode", value)}
              onGenderChange={(value) => updateProductField("gender", value)}
              onAudiencesChange={(next) => {
                setProduct((current) => ({
                  ...current,
                  audiences: next,
                  product_audiences: next,
                  gender: next[0] || "",
                }));
              }}
              onProductTypeChange={(value) => updateProductField("product_type", value)}
              onGradeChange={(value) => updateProductField("grade", value)}
              onIsOfferStoryChange={(value) => updateProductField("is_offer_story", value)}
              purchaseAlertsEnabled={product.purchase_alerts_enabled}
              purchaseAlertByColor={product.purchase_alert_by_color}
              cartonSize={product.carton_size}
              suggestedPurchaseCartons={product.suggested_purchase_cartons}
              onPurchaseAlertsEnabledChange={(value) => updateProductField("purchase_alerts_enabled", value)}
              onPurchaseAlertByColorChange={(value) => updateProductField("purchase_alert_by_color", value)}
              onCartonSizeChange={(value) => updateProductField("carton_size", value)}
              onSuggestedPurchaseCartonsChange={(value) => updateProductField("suggested_purchase_cartons", value)}
            />
          </section>
          <section className="rounded-[34px] border border-white/8 bg-zinc-950/80 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.22)]">
            <div className="flex flex-col gap-5 xl:flex-row xl:items-start">
              <div className="flex-1">
                <label className="flex min-h-[260px] cursor-pointer items-center justify-center overflow-hidden rounded-[28px] border border-white/10 bg-white/5 text-center">
                  {coverImage ? (
                    <img src={resolveAssetUrl(coverImage)} alt="Product cover" className="h-full max-h-[320px] w-full object-contain p-4" />
                  ) : (
                    <div>
                      <ImagePlus className="mx-auto text-zinc-400" size={42} />
                      <p className="mt-4 text-sm font-semibold text-white">{t("products.editor.addProductCoverImage", "Add product cover image")}</p>
                      <p className="mt-2 text-xs text-zinc-500">{t("products.editor.imageFileTypes")}</p>
                    </div>
                  )}
                  <input type="file" hidden accept="image/*" onChange={handleCover} />
                </label>
                <div className="mt-3 grid gap-2">
                  <AiCoverStatusBadge state={product.ai_cover} />
                  {canRegenerateAiCover ? (
                    <button
                      type="button"
                      onClick={() => handleRegenerateAiCover()}
                      disabled={aiCoverRegeneratingKey === "product:product" || !productId || !coverImage}
                      className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-[16px] border border-emerald-300/25 bg-emerald-400/10 px-4 text-sm font-black text-emerald-100 transition hover:border-emerald-300/45 hover:bg-emerald-400/15 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {aiCoverRegeneratingKey === "product:product" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                      {aiCoverRegeneratingKey === "product:product" ? "Queueing AI Cover..." : "Regenerate AI Cover"}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={handleGenerateAiProductData}
                    disabled={aiProductLoading || !coverImage}
                    className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-[16px] border border-blue-300/25 bg-blue-400/10 px-4 text-sm font-black text-blue-100 transition hover:border-blue-300/45 hover:bg-blue-400/15 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {aiProductLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                    {aiProductLoading ? aiProductProgress : "Generate AI Product Data"}
                  </button>
                  <button
                    type="button"
                    onClick={handleGenerateThermalImage}
                    disabled={thermalImageGenerating || !getThermalArtworkSourceImage(coverImage, null, colorGroups)}
                    className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-[16px] border border-amber-300/25 bg-amber-400/10 px-4 text-sm font-black text-amber-100 transition hover:border-amber-300/45 hover:bg-amber-400/15 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {thermalImageGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                    {thermalImageUrl ? "Regenerate AI Thermal Artwork" : "Generate AI Thermal Artwork"}
                  </button>
                </div>

                <div className="mt-4 rounded-[24px] border border-white/8 bg-white/5 p-4">
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-zinc-400">Original / AI Thermal</p>
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <div className="rounded-[18px] border border-white/8 bg-zinc-950/70 p-2">
                      <div className="flex h-28 items-center justify-center overflow-hidden rounded-[14px] bg-zinc-900">
                        {coverImage ? (
                          <img src={resolveAssetUrl(coverImage)} alt="Original product" className="h-full w-full object-contain" />
                        ) : (
                          <span className="text-[11px] font-semibold text-zinc-500">Original</span>
                        )}
                      </div>
                    </div>
                    <div className="rounded-[18px] border border-white/8 bg-zinc-950/70 p-2">
                      <div className="flex h-28 items-center justify-center overflow-hidden rounded-[14px] bg-zinc-900">
                        {thermalImageUrl ? (
                          <img src={resolveAssetUrl(thermalImageUrl)} alt="AI thermal artwork" className="h-full w-full object-contain" />
                        ) : (
                          <span className="text-[11px] font-semibold text-zinc-500">AI Thermal</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="w-full rounded-[28px] border border-white/8 bg-white/5 p-5 xl:w-[460px]">
                <p className="text-sm font-semibold text-zinc-300">{t("products.editor.productGallery", "Product gallery")}</p>
                <label className="mt-4 flex min-h-[120px] cursor-pointer items-center justify-center rounded-[24px] border-2 border-dashed border-white/10 bg-zinc-950/60 text-center">
                  <div>
                    <ImagePlus className="mx-auto text-zinc-400" size={30} />
                    <p className="mt-3 text-sm font-semibold text-white">{t("products.editor.addGalleryImages", "Add gallery images")}</p>
                    <p className="mt-1 text-xs text-zinc-500">{gallery.length} image(s)</p>
                  </div>
                  <input type="file" hidden accept="image/*" multiple onChange={handleGallery} />
                </label>

                {gallery.length > 0 ? (
                  <div className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(88px,96px))] gap-3">
                    {gallery.map((item) => (
                      <ImageThumbnailActions
                        key={item.id || item.name}
                        image={{ ...item, preview: resolveAssetUrl(item.preview || item.image_url) }}
                        alt={item.name || "Gallery image"}
                        isPrimary={Boolean(coverImage && resolveMainPreviewImageUrl(item) === resolveMainPreviewImageUrl(coverImage))}
                        onPrimary={() => setGalleryItemAsPrimary(item)}
                        deleteDisabled={Boolean(item.uploading)}
                        deleteDisabledReason="Image is still uploading"
                        onDelete={() => removeGalleryItem(item.id || item.name)}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="mt-4 rounded-2xl border border-dashed border-white/10 bg-zinc-950/60 px-4 py-5 text-center text-xs font-semibold text-zinc-500">
                    No gallery images.
                  </div>
                )}
              </div>
            </div>

            {aiProductData ? (
              <div className="mt-5 rounded-[24px] border border-blue-300/20 bg-blue-400/[0.07] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-black text-white">{t("products.editor.aiProductSuggestions", "AI product suggestions")}</p>
                    <p className="mt-1 text-xs text-zinc-400">
                      Source: {aiProductData.source || "AI"} · Confidence: {aiProductData.confidence ?? 0}%
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={applyAllAiProductSuggestions}
                    className="inline-flex h-9 items-center rounded-[12px] border border-blue-300/30 bg-blue-300/10 px-3 text-xs font-black text-blue-100 transition hover:bg-blue-300/15"
                  >
                    Apply all
                  </button>
                </div>
                <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
                  {[
                    ["name_en", "English name"],
                    ["name_ar", "Arabic name"],
                    ["description_en", "English description"],
                    ["description_ar", "Arabic description"],
                    ["meta_title_en", "SEO title"],
                    ["seo_description_en", "SEO description"],
                    ["seo_keywords", "SEO keywords"],
                    ["suggested_category", "Suggested category"],
                    ["suggested_product_type", "Suggested type"],
                    ["gender", "Gender"],
                    ["grade", "Grade"],
                  ].map(([field, label]) => {
                    const value = getSuggestionValue(aiProductData.suggestions, field);
                    if (!value) return null;
                    const canApply = field !== "name_ar";
                    return (
                      <div key={field} className="rounded-[16px] border border-white/10 bg-zinc-950/70 p-3">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-[11px] font-black uppercase tracking-[0.16em] text-zinc-500">{label}</p>
                          {canApply ? (
                            <button
                              type="button"
                              onClick={() => applyAiProductSuggestion(field)}
                              className="shrink-0 rounded-[10px] border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-bold text-zinc-100 hover:border-blue-300/30 hover:text-blue-100"
                            >
                              Apply
                            </button>
                          ) : null}
                        </div>
                        <p className="mt-2 line-clamp-3 text-sm leading-5 text-zinc-200">{value}</p>
                      </div>
                    );
                  })}
                  {getSuggestionValue(aiProductData.suggestions, "dominant_colors") ? (
                    <div className="rounded-[16px] border border-white/10 bg-zinc-950/70 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-[11px] font-black uppercase tracking-[0.16em] text-zinc-500">{t("products.editor.detectedColors", "Detected colors")}</p>
                        {getDetectionConfidenceLabel(aiProductData.suggestions, "colors") ? (
                          <span className="shrink-0 rounded-full border border-emerald-300/20 bg-emerald-300/10 px-2 py-0.5 text-[10px] font-black text-emerald-100">
                            {getDetectionConfidenceLabel(aiProductData.suggestions, "colors")}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-2 text-sm leading-5 text-zinc-200">
                        {getSuggestionValue(aiProductData.suggestions, "dominant_colors")}
                      </p>
                    </div>
                  ) : null}
                  {getSuggestionValue(aiProductData.suggestions, "suggested_product_type", "silhouette", "fashion_category") ? (
                    <div className="rounded-[16px] border border-white/10 bg-zinc-950/70 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-[11px] font-black uppercase tracking-[0.16em] text-zinc-500">{t("products.editor.detectedProductType", "Detected product type")}</p>
                        {getDetectionConfidenceLabel(aiProductData.suggestions, "product_type") ? (
                          <span className="shrink-0 rounded-full border border-emerald-300/20 bg-emerald-300/10 px-2 py-0.5 text-[10px] font-black text-emerald-100">
                            {getDetectionConfidenceLabel(aiProductData.suggestions, "product_type")}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-2 text-sm leading-5 text-zinc-200">
                        {[getSuggestionValue(aiProductData.suggestions, "suggested_product_type"), getSuggestionValue(aiProductData.suggestions, "silhouette"), getSuggestionValue(aiProductData.suggestions, "fashion_category")].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                  ) : null}
                  {getSuggestionValue(aiProductData.suggestions, "brand_resemblance") ? (
                    <div className="rounded-[16px] border border-white/10 bg-zinc-950/70 p-3">
                      <p className="text-[11px] font-black uppercase tracking-[0.16em] text-zinc-500">{t("products.editor.brandResemblance", "Brand resemblance")}</p>
                      <p className="mt-2 text-sm leading-5 text-zinc-200">
                        {getSuggestionValue(aiProductData.suggestions, "brand_resemblance")}
                      </p>
                    </div>
                  ) : null}
                  {getSuggestionValue(aiProductData.suggestions, "classification") ? (
                    <div className="rounded-[16px] border border-white/10 bg-zinc-950/70 p-3">
                      <p className="text-[11px] font-black uppercase tracking-[0.16em] text-zinc-500">{t("products.editor.classification", "Classification")}</p>
                      <p className="mt-2 text-sm leading-5 text-zinc-200">
                        {getSuggestionValue(aiProductData.suggestions, "classification")}
                      </p>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
          </section>
          <section className={`${isSimpleMode ? "hidden" : ""} rounded-[28px] border border-white/8 bg-zinc-950/80 p-4 shadow-[0_24px_80px_rgba(0,0,0,0.22)] sm:p-5`}>
            <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
              <div className="min-w-0">
                <p className="text-[11px] uppercase tracking-[0.2em] text-emerald-300">{t("products.editor.bulkTools", "Bulk Tools")}</p>
                <h2 className="mt-1 text-xl font-black text-white">{t("products.editor.bulkToolsHelp", "Add sizes and setup stock faster")}</h2>
                <p className="mt-1 max-w-3xl text-sm leading-5 text-zinc-400">
                  Enter comma-separated sizes, ranges, and planning stock shortcuts. Existing saved variants keep their IDs.
                </p>
              </div>
            </div>

            <div className={`mt-4 grid gap-4 ${isFullVariationMode ? "xl:grid-cols-3" : "xl:grid-cols-2"}`}>
              {isFullVariationMode ? (
                <div className="rounded-[20px] border border-white/8 bg-white/5 p-3">
                  <p className="text-xs font-black uppercase tracking-[0.2em] text-emerald-300">{t("products.editor.bulkSizes", "Bulk Sizes")}</p>
                  <label className="mt-3 block">
                    <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
                      Size range
                    </div>
                    <input
                      value={bulkSizesInput}
                      onChange={(event) => setBulkSizesInput(event.target.value)}
                      placeholder={t("products.editor.sizeRangePlaceholder")}
                      className="h-10 w-full rounded-[14px] border border-white/8 bg-zinc-950 px-3 text-sm text-white outline-none placeholder:text-zinc-500"
                    />
                    <button
                      type="button"
                      onClick={() => applyBulkSizes()}
                      className="mt-2 inline-flex h-10 w-full items-center justify-center rounded-[14px] bg-emerald-500 px-4 text-sm font-semibold text-white transition hover:bg-emerald-400"
                    >
                      Apply to all colors
                    </button>
                  </label>
                </div>
              ) : null}
              <div className="rounded-[20px] border border-white/8 bg-white/5 p-3">
                <p className="text-xs font-black uppercase tracking-[0.2em] text-violet-300">{t("products.editor.bulkStockTools", "Bulk Stock Tools")}</p>
                <label className="mt-3 block">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
                    Stock Quantity
                  </div>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={bulkStockInput}
                    onChange={(event) => setBulkStockInput(event.target.value)}
                    placeholder={t("products.editor.stockQuantityPlaceholder")}
                    className="h-10 w-full rounded-[14px] border border-white/8 bg-zinc-950 px-3 text-sm text-white outline-none placeholder:text-zinc-500"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => applyBulkStock()}
                  className="mt-2 inline-flex h-10 w-full items-center justify-center rounded-[14px] border border-violet-500/20 bg-violet-500/10 px-4 text-sm font-semibold text-violet-200 transition hover:bg-violet-500/15"
                >
                  Apply stock to all sizes in all colors
                </button>
                <p className="mt-2 text-xs leading-5 text-zinc-500">
                  Planning/setup stock only. Real inventory is still received from purchase invoices.
                </p>
              </div>
              <div className="rounded-[20px] border border-white/8 bg-white/5 p-3">
                <p className="text-xs font-black uppercase tracking-[0.2em] text-cyan-300">{t("products.editor.bulkArticleTools", "Bulk Article Tools")}</p>
                <label className="mt-3 block">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
                    {t("products.fields.articleCode", "Article Code")}
                  </div>
                  <input
                    value={bulkArticleCodeInput}
                    onChange={(event) => setBulkArticleCodeInput(event.target.value)}
                    placeholder={t("products.editor.articleCodePlaceholder", "Example: L122")}
                    className="h-10 w-full rounded-[14px] border border-white/8 bg-zinc-950 px-3 text-sm text-white outline-none placeholder:text-zinc-500"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => applyBulkArticleCode()}
                  className="mt-2 inline-flex h-10 w-full items-center justify-center rounded-[14px] border border-cyan-500/20 bg-cyan-500/10 px-4 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-500/15"
                >
                  {t("products.editor.applyArticleAllColors", "Apply article to all colors")}
                </button>
                <p className="mt-2 text-xs leading-5 text-zinc-500">
                  {t("products.editor.bulkArticleHelp", "Existing article codes are protected unless you confirm overwrite. Manual article fields stay editable.")}
                </p>
              </div>
            </div>
          </section>

          <section className={`${isSimpleMode ? "hidden" : ""} rounded-[28px] border border-white/8 bg-zinc-950/80 p-4 shadow-[0_24px_80px_rgba(0,0,0,0.22)] sm:p-5`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-black text-white">{t("products.editor.variantColorGroups", "Variant color groups")}</h2>
                <p className="mt-1 text-sm text-zinc-400">
                  Each color owns one image. Every size row under that color becomes one variant.
                </p>
              </div>

              <button
                type="button"
                onClick={addColorGroup}
                className="inline-flex h-10 items-center gap-2 rounded-[14px] border border-white/10 bg-white/5 px-4 text-sm font-semibold text-white"
              >
                <Plus size={16} />
                Add color
              </button>
            </div>

            <div className="mt-4 rounded-[20px] border border-white/8 bg-white/5 p-3">
              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">{t("products.editor.defaultManufacturer")}</p>
                <p className="mt-1 text-sm text-zinc-400">
                  Applied to every color group until you override a color manually.
                </p>
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
                <label className="block">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
                    Manufacturer
                  </div>
                  <select
                    value={defaultManufacturerId}
                    onChange={(e) => applyDefaultManufacturer(e.target.value)}
                    className="h-10 w-full rounded-[14px] border border-white/8 bg-zinc-950 px-3 text-sm text-white outline-none"
                  >
                    <option value="">{t("products.editor.selectManufacturer", "Select manufacturer")}</option>
                    {manufacturers.map((manufacturer) => (
                      <option key={manufacturer.id} value={String(manufacturer.id)}>
                        {manufacturer.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="rounded-[14px] border border-white/8 bg-zinc-950/60 px-3 py-2">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">{t("products.editor.behavior")}</div>
                  <div className="mt-1 text-sm text-zinc-200">{t("products.editor.defaultColorsHelp")}</div>
                </div>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              {colorGroups.map((group, groupIndex) => {
                const isExpanded = expandedGroupId === group.id;

                return (
                <div key={group.id} className="overflow-visible rounded-[14px] border border-white/8 bg-white/5">
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => setExpandedGroupId((current) => (current === group.id ? "" : group.id))}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setExpandedGroupId((current) => (current === group.id ? "" : group.id));
                      }
                    }}
                    className="flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left transition hover:bg-white/[0.03]"
                    aria-expanded={isExpanded}
                  >
                    <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-[12px] border border-white/10 bg-zinc-950/70 sm:h-[72px] sm:w-[72px]">
                      {(getPrimaryColorImage(group) || group.imagePreview || group.image_url) ? (
                        <img
                          src={resolveAssetUrl(getPrimaryColorImage(group) || group.imagePreview || group.image_url)}
                          alt={group.color || `Color ${groupIndex + 1}`}
                          className="h-full w-full object-contain p-2"
                        />
                      ) : (
                        <ImagePlus className="text-zinc-400" size={22} />
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                        <h3 className="truncate text-base font-black text-white">{group.color || `Color group ${groupIndex + 1}`}</h3>
                        <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-300">
                          {getGroupManufacturerSummary(group)}
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-400">
                        <span>{getGroupSizeCount(group)} size(s)</span>
                        {getGroupPlannedQty(group) ? <span>{getGroupPlannedQty(group)} stock qty</span> : null}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          removeColorGroup(group.id);
                        }}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-[14px] border border-white/10 bg-zinc-950 text-red-300"
                        aria-label={`Remove color group ${group.color || groupIndex + 1}`}
                      >
                        <Trash2 size={16} />
                      </button>
                      {isExpanded ? <ChevronDown className="text-zinc-400" size={18} /> : <ChevronRight className="text-zinc-400" size={18} />}
                    </div>
                  </div>

                  {isExpanded ? (
                  <div className="border-t border-white/8 p-4">
                    <div className="grid gap-4 xl:grid-cols-[180px_minmax(0,1fr)] xl:items-start">
                    <div className="space-y-2">
                      <label className="relative flex h-20 w-20 cursor-pointer items-center justify-center overflow-hidden rounded-[12px] border border-white/10 bg-zinc-950/70">
                        <div className="absolute inset-0 flex items-center justify-center text-zinc-400">
                          <ImagePlus size={26} />
                        </div>
                        {(getPrimaryColorImage(group) || group.imagePreview || group.image_url) ? (
                          <img
                            src={resolveAssetUrl(getPrimaryColorImage(group) || group.imagePreview || group.image_url)}
                            alt={group.color || `Color ${groupIndex + 1}`}
                            className="relative z-10 h-full w-full object-contain p-2"
                            onError={(event) => {
                              event.currentTarget.style.display = "none";
                            }}
                          />
                        ) : null}
                        <input
                          type="file"
                          hidden
                          accept="image/*"
                          multiple
                          onChange={async (event) => {
                            await handleColorImages(group.id, event.target.files);
                            event.target.value = "";
                          }}
                        />
                      </label>
                      <label className="inline-flex h-9 w-20 cursor-pointer items-center justify-center gap-1.5 rounded-[12px] border border-white/10 bg-white/5 px-2 text-xs font-semibold text-white transition hover:bg-white/10">
                        <Upload size={14} />
                        Add
                        <input
                          type="file"
                          hidden
                          accept="image/*"
                          multiple
                          onChange={async (event) => {
                            await handleColorImages(group.id, event.target.files);
                            event.target.value = "";
                          }}
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => handleGenerateThermalImage({ colorGroup: group })}
                        disabled={thermalImageGenerating || !getPrimaryColorImage(group)}
                        className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-[12px] border border-amber-300/25 bg-amber-400/10 px-3 text-xs font-semibold text-amber-100 transition hover:border-amber-300/45 hover:bg-amber-400/15 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {thermalImageGenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                        {group.thermal_image_url ? "Regenerate AI Thermal Artwork" : "Generate AI Thermal Artwork"}
                      </button>
                      <AiCoverStatusBadge state={group.ai_cover} />
                      {canRegenerateAiCover ? (
                        <button
                          type="button"
                          onClick={() => handleRegenerateAiCover({ colorGroup: group })}
                          disabled={aiCoverRegeneratingKey === `color:${normalizeColorKey(group.color)}` || !getPrimaryColorImage(group)}
                          className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-[12px] border border-emerald-300/25 bg-emerald-400/10 px-3 text-xs font-semibold text-emerald-100 transition hover:border-emerald-300/45 hover:bg-emerald-400/15 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {aiCoverRegeneratingKey === `color:${normalizeColorKey(group.color)}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                          {aiCoverRegeneratingKey === `color:${normalizeColorKey(group.color)}` ? "Queueing AI Cover..." : "Regenerate AI Cover"}
                        </button>
                      ) : null}
                      <div className="grid w-full max-w-[520px] grid-cols-2 gap-2">
                        <div className="rounded-[12px] border border-white/10 bg-zinc-950/70 p-2">
                          <div className="flex h-20 items-center justify-center overflow-hidden rounded-[10px] bg-zinc-900">
                            {getPrimaryColorImage(group) ? (
                              <img
                                src={resolveAssetUrl(getPrimaryColorImage(group))}
                                alt={`${group.color || `Color ${groupIndex + 1}`} original`}
                                className="h-full w-full object-contain"
                              />
                            ) : (
                              <span className="text-[10px] font-semibold text-zinc-500">Original color image</span>
                            )}
                          </div>
                        </div>
                        <div className="rounded-[12px] border border-white/10 bg-zinc-950/70 p-2">
                          <div className="flex h-20 items-center justify-center overflow-hidden rounded-[10px] bg-zinc-900">
                            {group.thermal_image_url ? (
                              <img
                                src={resolveAssetUrl(group.thermal_image_url)}
                                alt={`${group.color || `Color ${groupIndex + 1}`} AI thermal artwork`}
                                className="h-full w-full object-contain"
                              />
                            ) : (
                              <span className="text-[10px] font-semibold text-zinc-500">AI Thermal Artwork</span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="grid w-full max-w-[520px] grid-cols-[repeat(auto-fill,minmax(88px,96px))] gap-2.5">
                        {normalizeColorImages(group.images).map((image, imageIndex) => (
                          <ImageThumbnailActions
                            key={image.id || `${group.id}-${imageIndex}`}
                            image={{ ...image, preview: resolveAssetUrl(image.image_url || image.preview) }}
                            alt={image.name || group.color || "Color image"}
                            isPrimary={Boolean(image.is_primary)}
                            onPrimary={() => setPrimaryColorImage(group.id, image.id)}
                            deleteDisabled={Boolean(image.uploading)}
                            deleteDisabledReason="Image is still uploading"
                            onDelete={() => removeColorImage(group.id, image.id)}
                            actions={(
                              <>
                                <GripVertical className="hidden h-3.5 w-3.5 text-zinc-300 sm:block" aria-hidden="true" />
                                <button
                                  type="button"
                                  onClick={() => moveColorImage(group.id, image.id, "up")}
                                  className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-white/15 bg-black/65 text-white shadow-lg backdrop-blur-md transition hover:bg-black/80 disabled:cursor-not-allowed disabled:opacity-30"
                                  disabled={imageIndex === 0}
                                  aria-label={t("products.images.moveUp", "Move image up")}
                                >
                                  <ArrowUp className="h-3 w-3" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => moveColorImage(group.id, image.id, "down")}
                                  className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-white/15 bg-black/65 text-white shadow-lg backdrop-blur-md transition hover:bg-black/80 disabled:cursor-not-allowed disabled:opacity-30"
                                  disabled={imageIndex === normalizeColorImages(group.images).length - 1}
                                  aria-label={t("products.images.moveDown", "Move image down")}
                                >
                                  <ArrowDown className="h-3 w-3" />
                                </button>
                              </>
                            )}
                          />
                        ))}
                        {normalizeColorImages(group.images).length === 0 ? (
                          <div className="col-span-full rounded-[14px] border border-dashed border-white/10 bg-zinc-950/60 px-3 py-4 text-center text-[11px] font-semibold text-zinc-500">
                            No images
                          </div>
                        ) : null}
                      </div>
                    </div>

                    <div className="min-w-0 space-y-3">
                        <div className={`grid gap-3 ${mirrorEditionEnabled ? "xl:grid-cols-4" : "xl:grid-cols-3"}`}>
                          <div>
                            <label className="text-sm font-semibold text-zinc-300">{t("products.editor.colorName")}</label>
                              <input
                                value={group.color}
                                onChange={(e) => updateColorGroup(group.id, "color", e.target.value)}
                                placeholder={t("products.placeholders.colorExample")}
                                className="mt-1.5 h-10 w-full rounded-[14px] border border-white/8 bg-zinc-950 px-3 text-sm text-white outline-none placeholder:text-zinc-500"
                              />
                            <p className="mt-1 text-xs text-zinc-500">{t("products.editor.pickColorHelp")}</p>
                            {colorDetecting[group.id] ? (
                              <p className="mt-1 text-xs font-semibold text-cyan-200">{t("products.editor.detectingColor")}</p>
                            ) : null}
                          </div>
                          <div>
                            <label className="text-sm font-semibold text-zinc-300">{t("products.fields.articleCode", "Article Code")}</label>
                            <input
                              value={group.article_code || ""}
                              onChange={(e) => updateColorGroup(group.id, "article_code", e.target.value)}
                              placeholder="L122"
                              className="mt-1.5 h-10 w-full rounded-[14px] border border-white/8 bg-zinc-950 px-3 text-sm text-white outline-none placeholder:text-zinc-500"
                            />
                            <p className="mt-1 text-xs text-zinc-500">{t("products.editor.articleCodeColorHelp", "Article code applies to this color. Stock is managed per size row.")}</p>
                          </div>
                          {mirrorEditionEnabled ? (
                            <div className="relative">
                              <label className="text-sm font-semibold text-zinc-300">{t("products.editor.editionName")}</label>
                              <input
                                value={group.edition_name || ""}
                                onChange={(e) => updateColorGroup(group.id, "edition_name", e.target.value)}
                                placeholder={t("products.editor.editionNamePlaceholder")}
                                className="mt-1.5 h-10 w-full rounded-[14px] border border-white/8 bg-zinc-950 px-3 text-sm text-white outline-none placeholder:text-zinc-500"
                              />
                              {editionSuggestions[group.id]?.status === "loading" ? (
                                <div className="absolute left-0 top-[calc(100%+8px)] z-30 w-full rounded-[14px] border border-white/8 bg-zinc-950 px-3 py-2 text-xs font-semibold text-zinc-300 shadow-2xl shadow-black/40">
                                  Searching similar products...
                                </div>
                              ) : null}
                              {editionSuggestions[group.id]?.status === "ready" ? (
                                <div className="absolute left-0 top-[calc(100%+8px)] z-30 w-full rounded-[14px] border border-violet-400/20 bg-zinc-950 p-3 shadow-2xl shadow-black/40">
                                  {editionSuggestions[group.id].suggestion.source === "NO_TRUSTED_MATCH" ? (
                                    <div className="text-sm font-black text-white">{t("products.editor.noTrustedMatch")}</div>
                                  ) : (
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                      <div>
                                        <div className="text-sm font-black text-white">{editionSuggestions[group.id].suggestion.edition_name}</div>
                                        <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.14em] text-violet-200">
                                          {editionSuggestions[group.id].suggestion.source} · {Math.round(Number(editionSuggestions[group.id].suggestion.confidence || 0) * 100)}%
                                        </div>
                                        {editionSuggestions[group.id].suggestion.source_title ? (
                                          <div className="mt-1 line-clamp-2 text-xs text-zinc-400">{editionSuggestions[group.id].suggestion.source_title}</div>
                                        ) : null}
                                      </div>
                                      <button
                                        type="button"
                                        onClick={() => updateColorGroup(group.id, "edition_name", editionSuggestions[group.id].suggestion.edition_name)}
                                        className="h-10 rounded-[14px] bg-white px-3 text-xs font-black text-zinc-950"
                                      >
                                        Apply
                                      </button>
                                    </div>
                                  )}
                                  {editionSuggestions[group.id].suggestion.candidates?.length ? (
                                    <div className="mt-3 space-y-1.5 border-t border-white/10 pt-3">
                                      {editionSuggestions[group.id].suggestion.candidates.slice(0, 5).map((candidate) => (
                                        <div
                                          key={`${candidate.edition_name}-${candidate.source}-${candidate.source_url || ""}`}
                                          className="rounded-[12px] border border-white/8 bg-white/5 px-3 py-2"
                                        >
                                          <div className="flex items-start justify-between gap-2">
                                            <div className="min-w-0">
                                              <div className="text-xs font-black text-white">{candidate.edition_name}</div>
                                              <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-400">
                                                {candidate.source} · {Math.round(Number(candidate.confidence || 0) * 100)}%
                                              </div>
                                              {candidate.title ? <div className="mt-1 line-clamp-2 text-[11px] text-zinc-500">{candidate.title}</div> : null}
                                            </div>
                                            <button
                                              type="button"
                                              onClick={() => updateColorGroup(group.id, "edition_name", candidate.edition_name)}
                                              className="h-8 shrink-0 rounded-[10px] bg-white px-2 text-[10px] font-black text-zinc-950"
                                            >
                                              Apply
                                            </button>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  ) : null}
                                </div>
                              ) : null}
                              {editionSuggestions[group.id]?.status === "error" ? (
                                <div className="absolute left-0 top-[calc(100%+8px)] z-30 flex w-full items-center justify-between gap-2 rounded-[14px] border border-red-400/20 bg-zinc-950 p-3 text-xs text-red-100 shadow-2xl shadow-black/40">
                                  <span>{editionSuggestions[group.id].error}</span>
                                  <button
                                    type="button"
                                    onClick={() => requestEditionSuggestion(group, { retry: true })}
                                    className="h-10 rounded-[14px] border border-white/10 bg-white/10 px-3 font-black text-white"
                                  >
                                    Retry
                                  </button>
                                </div>
                              ) : null}
                            </div>
                          ) : null}
                          <div>
                            <div className="mb-2 flex items-center justify-between gap-2">
                              <label className="text-sm font-semibold text-zinc-300">{t("products.fields.manufacturer", "Manufacturer")}</label>
                              <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-300">
                                Color level
                              </span>
                            </div>
                            <select
                              value={group.manufacturer_id || ""}
                              onChange={(e) => updateColorGroup(group.id, "manufacturer_id", e.target.value)}
                              className="h-10 w-full rounded-[14px] border border-white/8 bg-zinc-950 px-3 text-sm text-white outline-none"
                            >
                              <option value="">{t("products.editor.selectManufacturer", "Select manufacturer")}</option>
                              {manufacturers.map((manufacturer) => (
                                <option key={manufacturer.id} value={String(manufacturer.id)}>
                                  {manufacturer.name}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              detectColorNameForGroup(group.id, resolveAssetUrl(getPrimaryColorImage(group) || group.imagePreview || group.image_url), {
                                overwrite: true,
                              })
                            }
                            disabled={Boolean(colorDetecting[group.id]) || !getPrimaryColorImage(group)}
                            className="inline-flex h-10 items-center justify-center gap-2 rounded-[14px] border border-cyan-400/20 bg-cyan-400/10 px-3 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-400/15 disabled:cursor-not-allowed disabled:opacity-45"
                          >
                            {colorDetecting[group.id] ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
                            AI Rename
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setColorPickTarget({
                                groupId: group.id,
                                source: resolveAssetUrl(getPrimaryColorImage(group) || group.imagePreview || group.image_url),
                                alt: group.color || `Color ${groupIndex + 1}`,
                              })
                            }
                            disabled={Boolean(colorDetecting[group.id]) || !getPrimaryColorImage(group)}
                            className="inline-flex h-10 items-center justify-center rounded-[14px] border border-white/10 bg-white/5 px-3 text-sm font-semibold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-45"
                          >
                            Pick color
                          </button>
                          {mirrorEditionEnabled ? (
                            <button
                              type="button"
                              onClick={() => requestEditionSuggestion(group)}
                              disabled={editionSuggestions[group.id]?.status === "loading"}
                              className="inline-flex h-10 items-center justify-center gap-1.5 rounded-[14px] border border-violet-400/20 bg-violet-400/10 px-3 text-sm font-semibold text-violet-100 transition hover:bg-violet-400/15 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {editionSuggestions[group.id]?.status === "loading" ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                              Suggest Edition
                            </button>
                          ) : null}
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            {isFullVariationMode ? (
                              <button
                                type="button"
                                onClick={() => applyBulkSizes(group.id)}
                                className="inline-flex h-10 items-center justify-center rounded-[14px] border border-emerald-500/20 bg-emerald-500/10 px-3 text-sm font-semibold text-emerald-200 transition hover:bg-emerald-500/15"
                              >
                                Apply bulk sizes
                              </button>
                            ) : null}
                            <button
                              type="button"
                              onClick={() => applyBulkArticleCode(group.id)}
                              className="inline-flex h-10 items-center justify-center rounded-[14px] border border-cyan-500/20 bg-cyan-500/10 px-3 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-500/15"
                            >
                              {t("products.editor.applyArticleThisColor", "Apply article to this color")}
                            </button>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            {isFullVariationMode ? (
                              <button
                                type="button"
                                onClick={() => addSizeRow(group.id)}
                                className="inline-flex h-10 items-center justify-center gap-2 rounded-[14px] border border-white/10 bg-white/5 px-3 text-sm font-semibold text-white"
                              >
                                <Plus size={16} />
                                Add size
                                </button>
                            ) : null}
                            {isCrocsProductType(product.product_type) ? (
                              <div className="relative">
                                <button
                                  type="button"
                                  onClick={() => setCrocsLibraryGroupId((current) => (current === group.id ? "" : group.id))}
                                  className="inline-flex h-10 items-center justify-center gap-2 rounded-[14px] border border-amber-400/20 bg-amber-400/10 px-3 text-sm font-semibold text-amber-100 transition hover:bg-amber-400/15"
                                >
                                  <Plus size={16} />
                                  + إضافة مقاسات كروكس
                                </button>
                                {crocsLibraryGroupId === group.id ? (
                                  <div className="absolute left-0 top-full z-30 mt-2 w-[280px] rounded-[16px] border border-white/10 bg-zinc-950 p-3 shadow-2xl shadow-black/40">
                                    <p className="text-xs font-black uppercase tracking-[0.18em] text-amber-200">{t("products.editor.crocsSizeLibrary", "مكتبة مقاسات كروكس")}</p>
                                    <p className="mt-2 text-[11px] leading-5 text-zinc-400">
                                      سيتم إضافة المقاس الأوروبي فقط إلى المنتج، وتظهر بيانات US/CM داخل دليل المقاسات في المتجر.
                                    </p>
                                    <div className="mt-3 grid gap-2">
                                      {CROCS_SIZE_LIBRARY_OPTIONS.map((option) => (
                                        <button
                                          key={option.id}
                                          type="button"
                                          onClick={() => applyCrocsSizeLibrary(group.id, option.id)}
                                          className="rounded-[14px] border border-white/10 bg-white/5 px-3 py-3 text-right transition hover:border-amber-300/30 hover:bg-amber-400/10"
                                        >
                                          <div className="text-sm font-black text-white">{option.label}</div>
                                          <div className="mt-2 flex flex-wrap gap-1.5">
                                            {getCrocsSizeLibraryItems(option.id).map((size) => (
                                              <span
                                                key={size.eu}
                                                className="inline-flex flex-col rounded-full border border-white/10 bg-black/20 px-2.5 py-1 text-[10px] font-semibold text-zinc-200"
                                              >
                                                <span className="text-[11px] font-black text-white">{size.eu}</span>
                                                <span className="text-[9px] leading-4 text-zinc-400">{size.us} - {size.cm} CM</span>
                                              </span>
                                            ))}
                                          </div>
                                        </button>
                                      ))}
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => setCrocsLibraryGroupId("")}
                                      className="mt-3 inline-flex h-9 items-center justify-center rounded-[12px] border border-white/10 bg-white/5 px-3 text-xs font-semibold text-zinc-300 transition hover:bg-white/10"
                                    >
                                      إغلاق
                                    </button>
                                  </div>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        </div>

                        <div className="rounded-[14px] border border-white/8 bg-zinc-950/60 p-3">
                          <div className="mb-3 flex items-center justify-between gap-3">
                            <div>
                              <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                                {isFullVariationMode ? t("products.editor.sizeRows", "Size rows") : t("products.editor.fixedSizeRow", "Fixed size row")}
                              </p>
                              <p className="mt-0.5 text-xs text-zinc-400">
                                {isFullVariationMode
                                        ? t("products.editor.oneRowBecomesVariant", "One row becomes one variant.")
                                        : t("products.editor.oneRowPerColor", "One row per color becomes the color-only variant.")}
                              </p>
                            </div>
                            <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-zinc-300">
                              {isColorOnlyMode ? 1 : group.sizes.length} row(s)
                            </div>
                          </div>

                          <div className="hidden rounded-[12px] border border-white/8 bg-white/5 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500 xl:grid xl:grid-cols-[minmax(0,1fr)_minmax(0,120px)_minmax(0,170px)_minmax(0,190px)_auto] xl:gap-2">
                            <div>{t("products.fields.size", "Size")}</div>
                            <div>{t("products.editor.stockQty", "Stock Qty")}</div>
                            <div>SKU</div>
                            <div>{t("products.selected.barcode", "Barcode")}</div>
                            <div>{t("products.table.actions", "Actions")}</div>
                          </div>

                          <div className="mt-2 space-y-2 overflow-x-auto">
                            {(isColorOnlyMode ? group.sizes.slice(0, 1) : group.sizes).map((row, rowIndex) => (
                              <div
                                key={row.id}
                                className="grid min-w-[680px] gap-2 rounded-[12px] border border-white/8 bg-white/5 p-3 xl:min-w-0 xl:grid-cols-[minmax(0,1fr)_minmax(0,120px)_minmax(0,170px)_minmax(0,190px)_auto]"
                              >
                                <div>
                                  <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                                    {isColorOnlyMode ? t("products.editor.fixedSize", "Fixed size") : t("products.fields.size", "Size")}
                                  </label>
                                  <input
                                    value={row.size}
                                    onChange={(e) => updateSizeRow(group.id, row.id, "size", e.target.value)}
                                    placeholder={isColorOnlyMode ? product.fixed_size_label || "One Size" : "40"}
                                    className="mt-1.5 h-10 w-full rounded-[12px] border border-white/8 bg-zinc-950 px-3 text-sm text-white outline-none placeholder:text-zinc-500"
                                  />
                                  {isCrocsProductType(product.product_type) ? (
                                    <p className="mt-1 text-[11px] font-semibold leading-4 text-cyan-200/90">
                                      {getCrocsSizeInputDisplayLabel(row.size)}
                                    </p>
                                  ) : null}
                                </div>
                                <div>
                                  <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">{t("products.editor.stockQty", "Stock Qty")}</label>
                                  <input
                                    type="number"
                                    min="0"
                                    step="1"
                                    value={row.stock ?? ""}
                                    onChange={(e) => updateSizeRow(group.id, row.id, "stock", e.target.value)}
                                    placeholder="0"
                                    className="mt-1.5 h-10 w-full rounded-[12px] border border-white/8 bg-zinc-950 px-3 text-sm text-white outline-none placeholder:text-zinc-500"
                                  />
                                  <p className="mt-1 text-[10px] leading-4 text-zinc-500">{t("products.editor.preparationOnlyStock", "Preparation only. Real stock is added from purchase invoices.")}</p>
                                </div>
                                <div>
                                  <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                                    SKU
                                  </label>
                                  <input
                                    value={row.sku}
                                    onChange={(e) => updateSizeRow(group.id, row.id, "sku", e.target.value)}
                                    placeholder=""
                                    className="mt-1.5 h-10 w-full rounded-[12px] border border-white/8 bg-zinc-950 px-3 text-sm text-white outline-none placeholder:text-zinc-500"
                                  />
                                </div>
                                <div>
                                  <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">{t("products.selected.barcode", "Barcode")}</label>
                                  <input
                                    value={row.barcode}
                                    onChange={(e) => updateSizeRow(group.id, row.id, "barcode", e.target.value)}
                                    placeholder={t("products.editor.scanOrEnterBarcode", "Scan or enter barcode")}
                                    className="mt-1.5 h-10 w-full rounded-[12px] border border-white/8 bg-zinc-950 px-3 text-sm text-white outline-none placeholder:text-zinc-500"
                                  />
                                </div>
                                <div className="flex items-end">
                                  <div className="flex w-full flex-col gap-2">
                                    {row.variantId ? (
                                      <Link
                                        to={`/inventory/variant/${row.variantId}/history?productId=${id}`}
                                        className="inline-flex h-10 items-center justify-center gap-2 rounded-[12px] border border-white/10 bg-white/5 px-3 text-sm font-semibold text-white transition hover:bg-white/10"
                                      >
                                        <Clock3 size={16} />
                                        History
                                      </Link>
                                    ) : null}
                                    <button
                                      type="button"
                                      onClick={() => removeSizeRow(group.id, row.id)}
                                      disabled={isColorOnlyMode || (group.sizes.length === 1 && rowIndex === 0)}
                                      className="inline-flex h-10 w-full items-center justify-center rounded-[12px] border border-white/10 bg-zinc-950 px-3 text-sm font-semibold text-red-300 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                      Remove
                                    </button>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                  ) : null}
                </div>
                );
              })}
            </div>
          </section>
        </div>
      )}
      {colorPickTarget ? (
        <ColorPickModal
          target={colorPickTarget}
          onClose={() => setColorPickTarget(null)}
          onPick={async (point) => {
            await pickColorNameForGroup(colorPickTarget.groupId, colorPickTarget.source, point);
            setColorPickTarget(null);
          }}
        />
      ) : null}
    </ProductsShell>
  );
}

function ColorPickModal({ target, onClose, onPick }) {
  const { t } = useTranslation();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
      <div className="w-full max-w-2xl rounded-[28px] border border-white/10 bg-zinc-950 p-4 shadow-2xl">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-black text-white">{t("products.editor.pickColor", "Pick color")}</p>
            <p className="mt-1 text-xs text-zinc-400">{t("products.editor.pickColorHelp", "Click the real shoe material color, not the sole or background.")}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-2xl border border-white/10 px-3 py-2 text-sm font-semibold text-white">
            {t("common.close", "Close")}
          </button>
        </div>
        <div className="flex max-h-[70vh] items-center justify-center overflow-auto rounded-2xl bg-zinc-900">
          <img
            src={target.source}
            alt={target.alt || t("products.editor.pickColor", "Pick color")}
            className="max-h-[68vh] w-auto max-w-full cursor-crosshair object-contain"
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              onPick({
                xRatio: (event.clientX - rect.left) / rect.width,
                yRatio: (event.clientY - rect.top) / rect.height,
              });
            }}
          />
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = "text" }) {
  return (
    <div>
      <label className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-2 w-full rounded-2xl border border-white/8 bg-white/5 px-4 py-3 text-white outline-none placeholder:text-zinc-500"
      />
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
      <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">{label}</div>
      <div className="mt-1 text-lg font-black text-white">{value}</div>
    </div>
  );
}

function AiCoverStatusBadge({ state = null }) {
  const status = String(state?.status || "").trim().toUpperCase();
  if (!status) return null;

  const tone =
    status === "COMPLETED"
      ? "border-emerald-300/30 bg-emerald-400/10 text-emerald-100"
      : status === "FAILED"
        ? "border-red-300/30 bg-red-400/10 text-red-100"
        : status === "PROCESSING"
          ? "border-amber-300/30 bg-amber-400/10 text-amber-100"
          : "border-blue-300/30 bg-blue-400/10 text-blue-100";

  const label =
    status === "COMPLETED"
      ? "Completed"
      : status === "FAILED"
        ? "Failed"
        : status === "PROCESSING"
          ? "Generating..."
          : "Pending";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.16em] ${tone}`}>
        AI Cover {label}
      </span>
      {status === "FAILED" && state?.last_error ? (
        <span className="text-[11px] text-red-200/80">{String(state.last_error)}</span>
      ) : null}
    </div>
  );
}

const readFileAsDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

const AI_PROGRESS_STEPS = ["Analyzing image...", "Generating SEO...", "Generating descriptions..."];

const getSuggestionValue = (suggestions = {}, ...keys) => {
  for (const key of keys) {
    const value = suggestions?.[key];
    if (Array.isArray(value)) {
      const text = value.filter(Boolean).join(", ");
      if (text.trim()) return text;
    }
    if (String(value || "").trim()) return String(value).trim();
  }
  return "";
};

const getDetectionConfidenceLabel = (suggestions = {}, key) => {
  const value = suggestions?.detection_confidence?.[key];
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "";
  return `${Math.max(0, Math.min(100, Math.round(numeric)))}% confidence`;
};

const getAiImagePayload = (image = "") => {
  const value = String(image || "").trim();
  if (!value) return {};
  if (value.startsWith("data:image/")) return { image_base64_optional: value };
  return { image_url: value };
};

const isDataImageUrl = (value) => typeof value === "string" && value.trim().startsWith("data:image/");

const resolvePersistedProductImages = async ({ coverImage = "", gallery = [] } = {}) => {
  const uploadedByPreview = new Map();
  const galleryPayload = [];

  for (const item of dedupeImages(gallery)) {
    const preview = item.preview || "";
    const source = item.image_url || item.url || preview || "";
    const shouldUpload =
      isDataImageUrl(source) ||
      (typeof File !== "undefined" && item.file instanceof File) ||
      (typeof Blob !== "undefined" && item.file instanceof Blob);
    const imageUrl = shouldUpload
      ? await uploadProductImageValue(item.file || source, { filename: item.name || "product-gallery.png" })
      : String(source || "").trim();

    if (preview && imageUrl) uploadedByPreview.set(preview, imageUrl);
    if (source && imageUrl) uploadedByPreview.set(source, imageUrl);

    galleryPayload.push({
      ...item,
      image_url: imageUrl,
      preview: imageUrl || preview,
    });
  }

  const coverSource = coverImage || "";
  const coverImageUrl =
    uploadedByPreview.get(coverSource) ||
    (isDataImageUrl(coverSource)
      ? await uploadProductImageValue(coverSource, { filename: "product-cover.png" })
      : String(coverSource || "").trim());

  return { coverImageUrl, galleryPayload };
};

export default ProductEdit;

function ProductActionBar({ mode = "edit", saving = false, hasUnsavedChanges = false, onSave }) {
  const { t } = useTranslation();
  const label =
    mode === "create"
      ? t("products.editor.saveProduct", "Save Product")
      : t("products.editor.updateProduct", "Update Product");

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-zinc-950/95 px-4 py-3 shadow-[0_-18px_60px_rgba(0,0,0,0.45)] backdrop-blur md:left-auto md:right-6 md:bottom-6 md:w-auto md:min-w-[360px] md:rounded-[28px] md:border">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-zinc-500">{t("products.editor.productEditor", "Product Editor")}</p>
          <p className={`mt-1 text-sm font-semibold ${hasUnsavedChanges ? "text-amber-200" : "text-emerald-200"}`}>
            {hasUnsavedChanges
              ? t("products.editor.unsavedChanges", "Unsaved changes")
              : t("products.editor.allChangesSaved", "All changes saved")}
          </p>
        </div>
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-5 text-sm font-black text-white shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
        >
          {saving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
          {saving ? t("common.saving", "Saving...") : label}
        </button>
      </div>
    </div>
  );
}

