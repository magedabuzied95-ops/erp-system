import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowRight, Camera, Filter, Loader2, Package2, Search, Store } from "lucide-react";
import toast from "react-hot-toast";

import BarcodeScanner, { barcodeScannerMessages } from "../../../components/BarcodeScanner";
import { productMatchesAudience } from "../../../shared/lib/productAudiences";
import EmployeePortalNavControls, { buildEmployeePortalHomePath, canNavigateEmployeePortalBack } from "../components/EmployeePortalNavControls";
import { getEmployeePortalProducts, getEmployeePortalCompactProducts, requestEmployeeWarehousePick } from "../services/employeePortalProductsApi";
import { saveWarehouseDraft, loadWarehouseDraft, clearWarehouseDraft, sweepExpiredDrafts } from "../services/employeeDrafts/employeeDraftStore.js";
import ProductGrid from "../../pos/components/ProductGrid";
import SmartPosFilters from "../../pos/components/SmartPosFilters";
import { normalizePosCatalogProduct, normalizePosSellableProducts } from "../../pos/services/posProductsApi";
import { moveWinterCollectionToEnd } from "../../pos/lib/posQuickFilterLogic";
import { useProductClassifications } from "../../products/hooks/useProductClassifications";
import {
  classificationGroupsToFieldOptions,
  normalizeClassificationValue,
} from "../../products/lib/productClassifications";
import usePageTitle from "../../../shared/hooks/usePageTitle";
import "./EmployeePortalWorkspaces.m1.css";

const text = (value = "") => String(value || "").trim();
const lower = (value = "") => text(value).toLowerCase();
const uniqueValues = (values = []) => [...new Set(values.map((value) => text(value)).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ar"));
const normalizeFilterValue = (value = "") => normalizeClassificationValue(value);

const resolveConfiguredFilterValue = (value, options = []) => {
  const normalized = normalizeFilterValue(value);
  if (!normalized) return "";
  const match = (Array.isArray(options) ? options : []).find((option) =>
    [option?.value, option?.id, option?.name, option?.label, option?.label_ar, option?.label_en]
      .map(normalizeFilterValue)
      .filter(Boolean)
      .includes(normalized)
  );
  return normalizeFilterValue(match?.value || match?.id || normalized);
};

const getEmployeeSmartFilterValue = (product = {}, field, options = []) => {
  const firstVariant = Array.isArray(product?.variants) ? product.variants[0] || {} : {};
  const candidates = field === "productType"
    ? [product.product_type, product.productType, product.type, firstVariant.product_type, firstVariant.productType, firstVariant.type]
    : [product.grade, product.product_grade, firstVariant.grade, firstVariant.product_grade];
  return resolveConfiguredFilterValue(candidates.find((value) => text(value)), options);
};
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const isActiveSizeFilter = (value) => {
  const normalized = String(value ?? "").trim().toLowerCase();
  return Boolean(normalized && normalized !== "all" && normalized !== "الكل");
};
const sizeSort = (a, b) => {
  const left = Number(a);
  const right = Number(b);
  if (Number.isFinite(left) && Number.isFinite(right)) return left - right;
  return String(a).localeCompare(String(b), "ar");
};
const sortSizes = (sizes = []) => [...sizes].sort(sizeSort);
const isDevBuild = Boolean(import.meta.env?.DEV);
const formatScanDebugValue = (value = "") => {
  const raw = text(value);
  if (!raw) return "—";
  return raw.length > 96 ? `${raw.slice(0, 96)}…` : raw;
};

const extractImageUrl = (value = {}) =>
  text(
    value?.image_url ||
    value?.variant_image_url ||
    value?.color_image_url ||
    value?.preview ||
    value?.url ||
    value?.src ||
    value?.image ||
    value?.photo_url ||
    value?.thumbnail_url
  );

const variantSizeValue = (variant = {}) => text(variant.size || variant.size_value || variant.sizeLabel || "");
const variantStockValue = (variant = {}) => Math.max(0, Number(variant.stock ?? variant.stock_quantity ?? variant.available_quantity ?? variant.quantity ?? 0));

const normalizeVariant = (variant = {}) => ({
  id: variant.variant_id ?? variant.id ?? null,
  variant_id: variant.variant_id ?? variant.id ?? null,
  color_id: variant.color_id ?? variant.colorId ?? null,
  product_id: variant.product_id ?? null,
  color: text(variant.color || ""),
  size: variantSizeValue(variant),
  audience: text(variant.audience || variant.variant_audience || variant.gender || ""),
  variant_audience: text(variant.variant_audience || variant.audience || variant.gender || ""),
  sku: text(variant.sku || ""),
  barcode: text(variant.barcode || ""),
  article_code: text(variant.article_code || variant.product_code || ""),
  color_article_code: text(variant.color_article_code || variant.colorArticleCode || ""),
  manufacturer_name: text(variant.manufacturer_name || ""),
  stock: variantStockValue(variant),
  price: Number(variant.price || 0),
  image_url: text(variant.image_url || variant.variant_image_url || ""),
});

const normalizeProduct = (product = {}) => {
  const mappedProduct = normalizePosCatalogProduct(product);
  const variants = Array.isArray(mappedProduct.variants) ? mappedProduct.variants.map(normalizeVariant) : [];
  const colors = uniqueValues(variants.map((variant) => variant.color));
  const sizes = sortSizes(uniqueValues(variants.map((variant) => variant.size)));
  const totalStock = variants.reduce((sum, variant) => sum + Math.max(0, Number(variant.stock || 0)), 0);
  const variantAudiences = uniqueValues(variants.flatMap((variant) =>
    String(variant.audience || "").split(/[,|]+/).map(text).filter(Boolean)
  ));
  const imageUrl =
    text(mappedProduct.product_image_url) ||
    text(mappedProduct.image_url) ||
    text(mappedProduct.photo_url) ||
    text(mappedProduct.thumbnail_url) ||
    text(mappedProduct.image) ||
    text(variants.find((variant) => variant.image_url)?.image_url || "");

  return {
    ...mappedProduct,
    id: mappedProduct.id ?? mappedProduct.product_id ?? null,
    product_id: mappedProduct.product_id ?? mappedProduct.id ?? null,
    name: text(mappedProduct.name || mappedProduct.product_name || ""),
    product_name: text(mappedProduct.product_name || mappedProduct.name || ""),
    article_code: text(mappedProduct.article_code || mappedProduct.product_code || ""),
    manufacturer_name: text(mappedProduct.manufacturer_name || mappedProduct.manufacturer || ""),
    category: text(mappedProduct.category || mappedProduct.category_name || ""),
    type: text(mappedProduct.type || mappedProduct.product_type || mappedProduct.style || ""),
    product_type: text(mappedProduct.product_type || mappedProduct.productType || mappedProduct.type || ""),
    productType: text(mappedProduct.productType || mappedProduct.product_type || mappedProduct.type || ""),
    grade: text(mappedProduct.grade || mappedProduct.product_grade || ""),
    brand: text(mappedProduct.brand || mappedProduct.brand_name || ""),
    gender: text(variantAudiences[0] || mappedProduct.gender || ""),
    audiences: variantAudiences.length ? variantAudiences : mappedProduct.audiences || [],
    product_audiences: variantAudiences.length ? variantAudiences : mappedProduct.product_audiences || [],
    style: text(mappedProduct.style || ""),
    sku: text(mappedProduct.sku || ""),
    barcode: text(mappedProduct.barcode || ""),
    image_url: imageUrl,
    product_image_url: imageUrl,
    total_stock: totalStock,
    stock: totalStock,
    colors,
    sizes,
    variants,
  };
};

const normalizeEmployeePosCatalog = (payload) =>
  normalizePosSellableProducts(Array.isArray(payload) ? payload : [])
    .map((product) => normalizePosCatalogProduct(product))
    .map(normalizeProduct);

// Map a COMPACT product (already lean, with lean variants) directly to the
// component's product shape — bypassing the heavy POS normalizer pipeline. The
// lean variants are run through the same local normalizeVariant so all
// downstream logic (card-by-color/size expansion, selection, barcode match)
// works unchanged.
const mapCompactProduct = (product = {}) => {
  const variants = (Array.isArray(product.variants) ? product.variants : []).map(normalizeVariant);
  const colors = uniqueValues(variants.map((variant) => variant.color));
  const sizes = sortSizes(uniqueValues(variants.map((variant) => variant.size)));
  const totalStock = variants.reduce((sum, variant) => sum + Math.max(0, Number(variant.stock || 0)), 0);
  const gender = text(product.gender);
  const productType = text(product.product_type || product.type || "");
  const imageUrl = text(product.product_image_url) || text(product.image_url) || text(variants.find((variant) => variant.image_url)?.image_url || "");
  return {
    id: product.id ?? product.product_id ?? null,
    product_id: product.product_id ?? product.id ?? null,
    name: text(product.name || ""),
    product_name: text(product.name || ""),
    article_code: text(product.article_code || ""),
    manufacturer_name: text(product.manufacturer_name || ""),
    category: text(product.category || ""),
    type: productType,
    product_type: productType,
    productType,
    grade: text(product.grade || ""),
    brand: text(product.brand || ""),
    gender,
    audiences: gender ? [gender] : [],
    product_audiences: gender ? [gender] : [],
    style: text(product.style || ""),
    sku: text(product.sku || ""),
    barcode: text(product.barcode || ""),
    qr_token: text(product.qr_token || ""),
    image_url: imageUrl,
    product_image_url: imageUrl,
    total_stock: totalStock,
    stock: totalStock,
    colors,
    sizes,
    variants,
  };
};

const mapCompactCatalog = (payload) => (Array.isArray(payload) ? payload : []).map(mapCompactProduct);

// Stable identity for appended pages. Falls back through the id fields the
// compact payload can carry so a product is never appended twice.
const stableProductKey = (product = {}) =>
  text(product?.product_id ?? product?.id ?? product?.productId ?? product?.sku ?? product?.barcode ?? "");

const scanFieldMatches = (value = "", candidate = "") => {
  const left = text(value);
  const right = text(candidate);
  if (!left || !right) return false;
  return left === right || lower(left) === lower(right);
};

const scanValueVariants = (value = "") => {
  const raw = text(value);
  if (!raw) return [];
  const compact = raw.replace(/\s+/g, "");
  const normalized = lower(raw);
  return [...new Set([raw, compact, normalized, lower(compact)].filter(Boolean))];
};

const variantsForColor = (product = {}, color = "") =>
  (Array.isArray(product.variants) ? product.variants : []).filter((variant) =>
    lower(variant.color) === lower(color)
  );

const firstVariantForColor = (product = {}, color = "") =>
  variantsForColor(product, color)[0] || null;

const findVariant = (product = {}, variantId = null, color = "", size = "", colorId = null) => {
  const allVariants = Array.isArray(product.variants) ? product.variants : [];
  const variants = color ? variantsForColor(product, color) : allVariants;
  if (variantId) {
    const byId = variants.find((variant) => String(variant.variant_id ?? variant.id ?? "") === String(variantId));
    if (byId) return byId;
  }
  if (colorId) {
    const byColorId = variants.find((variant) => String(variant.color_id ?? "") === String(colorId));
    if (byColorId) return byColorId;
  }
  if (color && size) {
    return variants.find((variant) => lower(variant.color) === lower(color) && variantSizeValue(variant) === text(size)) || null;
  }
  if (size) {
    return variants.find((variant) => variantSizeValue(variant) === text(size)) || null;
  }
  return variants.find((variant) => Number(variant.stock || 0) > 0) || variants[0] || null;
};

const stockByColor = (product = {}, color = "") =>
  (Array.isArray(product.variants) ? product.variants : [])
    .filter((variant) => !color || lower(variant.color) === lower(color))
    .reduce((sum, variant) => sum + Math.max(0, Number(variant.stock || 0)), 0);

const firstAvailableColor = (product = {}) => product.colors.find((color) => stockByColor(product, color) > 0) || product.colors[0] || "";

const sizeOptionsForProduct = (product = {}, color = "") => {
  const variants = Array.isArray(product.variants) ? product.variants : [];
  const filtered = color ? variants.filter((variant) => lower(variant.color) === lower(color)) : variants;
  const bySize = new Map();

  for (const variant of filtered) {
    const size = text(variant.size);
    if (!size) continue;
    const stock = Math.max(0, Number(variant.stock || 0));
    bySize.set(size, (bySize.get(size) || 0) + stock);
  }

  return [...bySize.entries()]
    .map(([size, stock]) => ({ size, stock }))
    .sort((a, b) => sizeSort(a.size, b.size));
};

const pickVariantForColor = (product = {}, color = "", preferredSize = "") => {
  const scopedVariants = variantsForColor(product, color);
  if (!scopedVariants.length) return null;

  const exactSize = preferredSize
    ? scopedVariants.find((variant) => variantSizeValue(variant) === text(preferredSize) && variantStockValue(variant) > 0)
    : null;
  if (exactSize) return exactSize;

  return scopedVariants.find((variant) => Number(variant.stock || 0) > 0) || scopedVariants[0] || null;
};

const resolveColorSelection = (product = {}, color = "", preferredSize = "") => {
  const nextVariant = pickVariantForColor(product, color, preferredSize);
  return {
    activeVariant: nextVariant,
    selectedSize: nextVariant?.size || "",
  };
};

const resolveColorEntryImage = (product = {}, color = "") => {
  const normalizedColor = lower(color);
  if (!normalizedColor) return "";

  const collections = [
    ...(Array.isArray(product.color_images) ? product.color_images : []),
    ...(Array.isArray(product.images) ? product.images : []),
  ];

  const matchingEntry = collections.find((entry) => {
    const entryColor = lower(
      entry?.color ||
      entry?.color_name ||
      entry?.name ||
      entry?.label ||
      entry?.title
    );
    return entryColor && entryColor === normalizedColor;
  });

  if (!matchingEntry) return "";

  const nestedImages = Array.isArray(matchingEntry.images)
    ? matchingEntry.images
    : Array.isArray(matchingEntry.color_images)
      ? matchingEntry.color_images
      : [];
  const nestedPrimary = nestedImages.find((item) => item?.is_primary) || nestedImages[0] || null;

  return (
    extractImageUrl(matchingEntry) ||
    extractImageUrl(nestedPrimary)
  );
};

const resolveProductMainImage = (product = {}) =>
  extractImageUrl({
    image_url: product.product_image_url || product.image_url,
    photo_url: product.photo_url,
    thumbnail_url: product.thumbnail_url,
    image: product.image,
  });

const resolveProductPreviewImage = (product = {}, { color = "", size = "", variantId = null } = {}) => {
  const currentVariant = findVariant(product, variantId, color, size);
  const scopedVariants = color ? variantsForColor(product, color) : [];
  const colorVariantWithImage =
    scopedVariants.find((variant) => Number(variant.stock || 0) > 0 && extractImageUrl(variant)) ||
    scopedVariants.find((variant) => extractImageUrl(variant)) ||
    null;

  return (
    extractImageUrl(currentVariant) ||
    resolveColorEntryImage(product, color) ||
    extractImageUrl(colorVariantWithImage) ||
    resolveProductMainImage(product)
  );
};

const getAvailableVariantsForEmployeeFilters = (product = {}, filters = {}) => {
  const selectedSize = text(filters.selectedSize || "");
  const selectedColor = text(filters.selectedColor || "");
  const variants = Array.isArray(product.variants) ? product.variants : [];
  return variants.filter((variant) => {
    if (variantStockValue(variant) <= 0) return false;
    if (isActiveSizeFilter(selectedSize) && variantSizeValue(variant) !== selectedSize) return false;
    if (selectedColor && lower(variant.color) !== lower(selectedColor)) return false;
    return true;
  });
};

const buildEmployeeScopedProductCard = (product = {}, variants = [], { color = "", size = "" } = {}) => {
  const scopedColor = text(color);
  const scopedSize = text(size);
  const scopedVariants = Array.isArray(variants) ? variants : [];
  const scopedStock = scopedVariants.reduce((sum, variant) => sum + variantStockValue(variant), 0);
  const previewVariant = scopedVariants.find((variant) => extractImageUrl(variant)) || scopedVariants[0] || null;
  const productMainImage = resolveProductMainImage(product);
  const exactColorImage = resolveColorEntryImage(product, scopedColor);
  const exactVariantImage = extractImageUrl(previewVariant);
  const candidateImageUrl = exactColorImage || (exactVariantImage && exactVariantImage !== productMainImage ? exactVariantImage : "");
  const imageOwnerColors = uniqueValues(
    (Array.isArray(product.variants) ? product.variants : [])
      .filter((variant) => candidateImageUrl && extractImageUrl(variant) === candidateImageUrl)
      .map((variant) => variant.color)
  );
  const previewImageUrl = imageOwnerColors.length > 1 ? "" : candidateImageUrl;

  return {
    ...product,
    id: `${product.id ?? product.product_id ?? "product"}:${scopedColor || "default"}:${scopedSize || "all"}`,
    product_id: `${product.product_id ?? product.id ?? "product"}:${scopedColor || "default"}:${scopedSize || "all"}`,
    employee_source_product_id: product.id ?? product.product_id ?? null,
    employee_source_product: product,
    employee_card_color: scopedColor,
    employee_card_size: scopedSize,
    employee_card_sizes: scopedSize ? [scopedSize] : [],
    employee_card_variant_id: previewVariant?.variant_id ?? previewVariant?.id ?? null,
    employee_exact_variant_image: true,
    employee_ambiguous_color_image: Boolean(candidateImageUrl && imageOwnerColors.length > 1),
    image_url: previewImageUrl,
    product_image_url: previewImageUrl,
    variant_image_url: previewImageUrl,
    article_code: text(previewVariant?.color_article_code || previewVariant?.article_code || product.article_code || ""),
    total_stock: scopedStock,
    stock: scopedStock,
    colors: scopedColor ? [scopedColor] : uniqueValues(scopedVariants.map((variant) => variant.color)),
    sizes: sortSizes(uniqueValues(scopedVariants.map((variant) => variant.size))),
    variants: scopedVariants,
  };
};

const expandEmployeeProductCardsByColorAndSize = (products = [], filters = {}) => {
  if (!Array.isArray(products)) return [];

  const sizeFilterValue = filters?.size || filters?.selectedSize || filters?.sizes;
  const selectedSize = text(sizeFilterValue || "");
  const hasActiveSizeFilter = isActiveSizeFilter(sizeFilterValue);
  if (!hasActiveSizeFilter) return products;

  const cards = [];
  const seen = new Set();
  for (const product of products) {
    const productVariants = Array.isArray(product?.variants) ? product.variants : [];
    if (!productVariants.length) continue;

    const availableVariants = getAvailableVariantsForEmployeeFilters(product, { selectedSize });
    const colors = uniqueValues(availableVariants.map((variant) => variant.color));
    for (const color of colors) {
      const scopedVariants = availableVariants.filter((variant) => lower(variant.color) === lower(color));
      if (!scopedVariants.length) continue;
      const key = `${product.id ?? product.product_id ?? "product"}:${color}:${selectedSize}`;
      if (seen.has(key)) continue;
      seen.add(key);
      cards.push(buildEmployeeScopedProductCard(product, scopedVariants, { color, size: selectedSize }));
    }
  }
  return cards;
};

export const EMPLOYEE_PRODUCTS_PAGE_SIZE = 48;

export const buildListParams = ({ search, filters, selectedSize = "all", page = 1 }) => {
  const hasSizeFilter = isActiveSizeFilter(selectedSize);
  // One bounded page, always. This used to be `hasSizeFilter ? 500 : 48` with no
  // `page` at all, so the list was hard-capped: when more products matched than
  // the cap, everything past it was unreachable — there was no way to page to it.
  // The endpoint already supports page/offset/has_more, so pagination now covers
  // the size case too and the 500-row request is gone.
  const params = { limit: EMPLOYEE_PRODUCTS_PAGE_SIZE, page, inStockOnly: 1 };
  const q = text(search);
  if (q) params.q = q;
  if (filters.category !== "all") params.category = filters.category;
  if (filters.type !== "all") params.type = filters.type;
  if (filters.brand !== "all") params.brand = filters.brand;
  if (filters.manufacturer !== "all") params.manufacturer = filters.manufacturer;
  if (filters.gender !== "all") params.gender = filters.gender;
  if (hasSizeFilter) params.size = text(selectedSize);
  // The endpoint also supports `color`. The list UI has no colour control today
  // (colour is picked per product inside the detail sheet), so this only fires if
  // one is ever added — and when it is, it must go to the server rather than be
  // applied to the already-loaded page.
  const color = text(filters.color);
  if (color && color !== "all") params.color = color;
  return params;
};

const buildLookupParams = (directLookup) => {
  const params = { limit: 20, inStockOnly: 1 };
  if (directLookup.productId) params.productId = directLookup.productId;
  if (directLookup.qrToken) params.qr_token = directLookup.qrToken;
  if (directLookup.barcode) params.barcode = directLookup.barcode;
  if (directLookup.sku) params.sku = directLookup.sku;
  if (directLookup.article) params.article = directLookup.article;
  return params;
};

const parseSmartQrScan = (value = "") => {
  const raw = text(value);
  if (!raw) return null;

  try {
    const parsedUrl = new URL(raw, typeof window !== "undefined" ? window.location.origin : "http://localhost");
    const match = parsedUrl.pathname.match(/\/qr\/product\/([^/?#]+)/i);
    if (!match?.[1]) return null;
    return {
      productId: decodeURIComponent(match[1]),
      variantId: text(parsedUrl.searchParams.get("variantId") || parsedUrl.searchParams.get("variant")),
      colorId: text(parsedUrl.searchParams.get("colorId") || parsedUrl.searchParams.get("color")),
      color: text(parsedUrl.searchParams.get("color") || ""),
      size: text(parsedUrl.searchParams.get("size") || ""),
      action: text(parsedUrl.searchParams.get("action")) || "warehouse-request",
    };
  } catch {
    return null;
  }
};

const productMatchesDirectLookup = (product = {}, directLookup = {}) => {
  const requestedProductId = text(directLookup.productId);
  const requestedVariantId = text(directLookup.variantId);
  const requestedColorId = text(directLookup.colorId);
  const requestedColor = text(directLookup.color);
  const requestedSize = text(directLookup.size);
  const requestedQrToken = text(directLookup.qrToken);
  const productIds = [
    product.id,
    product.product_id,
    product.employee_source_product_id,
  ].map((value) => text(value)).filter(Boolean);

  const variants = Array.isArray(product.variants) ? product.variants : [];
  const productQrTokens = [product.qr_token, product.qrToken].map((value) => text(value)).filter(Boolean);
  const variantProductIds = variants
    .map((variant) => text(variant.product_id))
    .filter(Boolean);
  const variantIds = variants
    .map((variant) => text(variant.variant_id ?? variant.id))
    .filter(Boolean);
  const variantQrTokens = variants
    .map((variant) => text(variant.qr_token ?? variant.qrToken))
    .filter(Boolean);
  const colorIds = variants
    .map((variant) => text(variant.color_id))
    .filter(Boolean);
  const colors = variants
    .map((variant) => text(variant.color))
    .filter(Boolean);
  const sizes = variants
    .map((variant) => text(variant.size))
    .filter(Boolean);

  const matchByProductId = requestedProductId
    ? productIds.includes(requestedProductId) || variantProductIds.includes(requestedProductId)
    : false;
  const matchByQrToken = requestedQrToken
    ? productQrTokens.includes(requestedQrToken) || variantQrTokens.includes(requestedQrToken)
    : false;
  const matchByVariantId = requestedVariantId ? variantIds.includes(requestedVariantId) : false;
  const matchByColorId = requestedColorId ? colorIds.includes(requestedColorId) : false;
  const matchByColor = requestedColor ? colors.includes(requestedColor) : false;
  const matchBySize = requestedSize ? sizes.includes(requestedSize) : false;

  return {
    matched: Boolean(matchByQrToken || matchByProductId || matchByVariantId || matchByColorId || matchByColor || matchBySize),
    matchByQrToken,
    matchByProductId,
    matchByVariantId,
    matchByColorId,
    matchByColor,
    matchBySize,
  };
};

function ProductCard({ product, active, onOpen }) {
  const colors = product.colors.slice(0, 4);
  const sizes = product.sizes.slice(0, 4);
  const previewColor = firstAvailableColor(product);
  const previewImageUrl = resolveProductPreviewImage(product, { color: previewColor });

  return (
    <button
      type="button"
      onClick={() => onOpen(product)}
      className={`flex w-full flex-row-reverse gap-3 rounded-[1.35rem] border p-3 text-right shadow-[0_20px_50px_rgba(0,0,0,0.22)] transition active:scale-[0.99] ${
        active
          ? "border-emerald-300/40 bg-gradient-to-br from-emerald-500/10 via-zinc-950 to-black ring-1 ring-emerald-400/20"
          : "border-white/10 bg-zinc-950 hover:border-emerald-300/30 hover:bg-zinc-900"
      }`}
    >
      <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-black/30">
        {previewImageUrl ? (
          <img
            src={previewImageUrl}
            alt={product.name}
            className="h-full w-full object-contain p-2"
            loading="lazy"
            onError={(event) => {
              event.currentTarget.style.display = "none";
            }}
          />
        ) : (
          <Package2 className="h-10 w-10 text-zinc-500" />
        )}
      </div>

      <div className="min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-black text-white">{product.name || "Product"}</h3>
            <div className="mt-1 truncate text-[11px] font-semibold text-zinc-400">
              {product.article_code ? `SKU / Article: ${product.article_code}` : "SKU / Article: -"}
            </div>
            <div className="mt-0.5 truncate text-[11px] font-semibold text-zinc-500">
              {product.manufacturer_name ? `Brand: ${product.manufacturer_name}` : "Brand: -"}
            </div>
          </div>
          <div className="rounded-2xl border border-emerald-400/20 bg-emerald-500/10 px-2.5 py-1 text-center">
            <div className="text-[10px] font-black uppercase tracking-[0.16em] text-emerald-200">Stock</div>
            <div className="text-base font-black text-emerald-100">{Number(product.total_stock || 0)}</div>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {colors.map((color) => (
            <span key={color} className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-bold text-zinc-200">
              {color}
            </span>
          ))}
          {product.colors.length > colors.length ? (
            <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-bold text-zinc-400">
              +{product.colors.length - colors.length}
            </span>
          ) : null}
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {sizes.map((size) => {
            const stock = product.variants
              .filter((variant) => text(variant.size) === text(size))
              .reduce((sum, variant) => sum + Math.max(0, Number(variant.stock || 0)), 0);
            return (
              <span key={size} className="rounded-full border border-white/10 bg-black/30 px-2.5 py-1 text-[11px] font-black text-white">
                {Number(stock || 0)} × {size}
              </span>
            );
          })}
          {!sizes.length ? (
            <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-bold text-zinc-500">No sizes</span>
          ) : null}
        </div>
      </div>
    </button>
  );
}

function ProductPickerSheet({
  product,
  selectedColor,
  selectedSize,
  onBack,
  onHome,
  onClose,
  onSelectColor,
  onSelectSize,
  onSubmit,
  loadingSubmit,
}) {
  if (!product) return null;

  const sizeOptions = sizeOptionsForProduct(product, selectedColor);
  const activeVariant = findVariant(product, null, selectedColor, selectedSize);
  const activeStock = Number(activeVariant?.stock || 0);
  const canSubmit = Boolean(activeVariant && activeStock > 0);
  const previewImageUrl = resolveProductPreviewImage(product, {
    color: selectedColor,
    size: selectedSize,
    variantId: activeVariant?.variant_id ?? activeVariant?.id ?? null,
  });

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 px-2 py-2 sm:items-center sm:px-4 sm:py-6">
      <div className="flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-[1.35rem] border border-white/10 bg-zinc-950 shadow-[0_30px_90px_rgba(0,0,0,0.65)]">
        <EmployeePortalNavControls onBack={onBack} onHome={onHome} tone="dark" className="mb-0 px-3 pt-2 sm:px-4 sm:pt-3" />
        <div className="flex items-start justify-between gap-3 border-b border-white/10 px-4 py-3">
          <div className="min-w-0">
            <div className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-200">Variant selection</div>
            <h3 className="truncate text-base font-black text-white">{product.name || "Product"}</h3>
            <div className="mt-1 flex flex-wrap gap-2 text-[11px] font-semibold text-zinc-400">
              <span>SKU / Article: {product.article_code || "-"}</span>
              <span>Brand: {product.manufacturer_name || "-"}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-white"
          >
            <ArrowRight className="h-4 w-4" />
            <span>رجوع</span>
          </button>
        </div>

        <div className="grid flex-1 gap-3 overflow-y-auto px-4 py-3 lg:grid-cols-[1.05fr_0.95fr] lg:gap-4 lg:py-4">
          <div className="rounded-[1.25rem] border border-white/10 bg-white/[0.03] p-2.5 sm:p-3">
            <div className="flex min-h-[10rem] items-center justify-center overflow-hidden rounded-[1rem] bg-black/25 sm:min-h-[12rem]">
              {previewImageUrl ? (
                <img
                  src={previewImageUrl}
                  alt={product.name}
                  className="max-h-[11rem] w-full object-contain p-2 sm:max-h-[14rem] sm:p-3"
                  loading="eager"
                  onError={(event) => {
                    event.currentTarget.style.display = "none";
                  }}
                />
              ) : (
                <Package2 className="h-20 w-20 text-zinc-600" />
              )}
            </div>

          </div>

          <div className="space-y-4">
            <div className="rounded-[1.25rem] border border-white/10 bg-white/[0.03] p-3">
              <div className="text-sm font-black text-white">Colors</div>
              <div className="mt-3 flex flex-wrap gap-2">
                {product.colors.length ? (
                  product.colors.map((color) => {
                    const colorStock = stockByColor(product, color);
                    const active = text(selectedColor) === text(color);
                    return (
                      <button
                        key={color || "default"}
                        type="button"
                        onClick={() => onSelectColor(color)}
                        className={`min-h-11 rounded-full border px-4 py-2 text-sm font-black transition ${
                          active ? "border-emerald-400/30 bg-emerald-500 text-zinc-950" : "border-white/10 bg-black/30 text-white hover:bg-white/[0.08]"
                        }`}
                      >
                        {color}
                        <span className={`mr-2 text-[11px] font-bold ${active ? "text-zinc-950/70" : "text-zinc-400"}`}>({colorStock})</span>
                      </button>
                    );
                  })
                ) : (
                  <span className="text-sm font-semibold text-zinc-500">No colors</span>
                )}
              </div>
            </div>

            <div className="rounded-[1.25rem] border border-white/10 bg-white/[0.03] p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-black text-white">Sizes</div>
                <div className="text-[11px] font-bold text-zinc-500">Only available sizes appear</div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {sizeOptions.length ? (
                  sizeOptions.map(({ size, stock }) => {
                    const active = text(selectedSize) === text(size);
                    return (
                      <button
                        key={size}
                        type="button"
                        onClick={() => onSelectSize(size)}
                        disabled={Number(stock || 0) <= 0}
                        className={`min-h-16 rounded-2xl border px-3 py-2 text-right transition ${
                          active
                            ? "border-emerald-400/30 bg-emerald-500 text-zinc-950"
                            : Number(stock || 0) <= 0
                              ? "cursor-not-allowed border-white/5 bg-black/20 text-zinc-600"
                              : "border-white/10 bg-black/30 text-white hover:bg-white/[0.08]"
                        }`}
                      >
                        <div className="text-2xl font-black leading-none">{size}</div>
                        <div className={`mt-1 text-[11px] font-semibold leading-none ${active ? "text-zinc-950/70" : "text-zinc-400"}`}>Stock: {Number(stock || 0)}</div>
                      </button>
                    );
                  })
                ) : (
                  <div className="col-span-full text-sm font-semibold text-zinc-500">No available sizes for this color</div>
                )}
              </div>
            </div>

            <button
              type="button"
              onClick={onSubmit}
              disabled={!canSubmit || loadingSubmit}
              className="inline-flex min-h-12 w-full items-center justify-center rounded-2xl bg-emerald-400 px-4 py-3 text-sm font-black text-zinc-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loadingSubmit ? <Loader2 className="ml-2 h-4 w-4 animate-spin" /> : null}
              اطلب من المخزن
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function EmployeePortalCameraScannerModal({
  onClose,
  onScan,
  onPermissionDenied,
  onUnsupported,
  onError,
  onDebugChange,
  scanDebug,
  resolvingScan,
  manualBarcodeValue,
  onManualBarcodeChange,
  onManualBarcodeSubmit,
}) {
  if (typeof document === "undefined") return null;

  const scannerStatusMessage = resolvingScan
    ? "جاري البحث..."
    : scanDebug?.resolverResult === "found"
      ? "تم العثور على المنتج"
      : scanDebug?.resolverResult === "not found"
        ? "لم يتم العثور على المنتج"
        : scanDebug?.resolverResult === "error"
          ? "لم نتمكن من قراءة الباركود، جرّب الإدخال اليدوي"
          : "وجّه الباركود داخل الإطار";

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/80 px-2 py-2 backdrop-blur-sm sm:items-center sm:px-4 sm:py-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="flex w-full max-w-md min-w-0 flex-col overflow-hidden rounded-t-3xl border border-emerald-400/20 bg-slate-950 shadow-2xl shadow-black/70 sm:rounded-3xl"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="employee-portal-camera-scanner-title"
        dir="rtl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-white/10 px-4 py-4">
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-black uppercase tracking-[0.22em] text-emerald-200">EMPLOYEE SCANNER</div>
            <h3 id="employee-portal-camera-scanner-title" className="mt-1 text-lg font-black text-white">امسح الباركود أو QR بالكاميرا</h3>
            <p className="mt-1 text-xs font-semibold text-zinc-500">وجّه الباركود داخل الإطار.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-3 text-sm font-black text-zinc-100 transition hover:bg-white/[0.08]"
            aria-label="إغلاق ماسح الكاميرا"
          >
            <ArrowRight className="h-4 w-4" />
            <span>رجوع</span>
          </button>
        </div>

        <div className="p-4">
          <div className="overflow-hidden rounded-3xl border border-white/10 bg-black/60 p-3">
            <BarcodeScanner
              onScan={onScan}
              onPermissionDenied={onPermissionDenied}
              onUnsupported={onUnsupported}
              onError={onError}
              onDebugChange={onDebugChange}
              enable1dFallback
              className="overflow-hidden rounded-[1.35rem] bg-black"
              scannerClassName="min-h-[320px]"
            />
          </div>
          <div className="mt-3 rounded-2xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-center text-sm font-black text-emerald-100">
            قرّب الكاميرا وخلي الكيو آر داخل الإطار
          </div>
          {isDevBuild ? (
            <div className="mt-3 grid gap-3 rounded-3xl border border-cyan-400/20 bg-cyan-400/10 p-3 text-left">
            <div className="flex items-center justify-between gap-3">
              <div className="text-[10px] font-black uppercase tracking-[0.22em] text-cyan-200">Scanner Debug</div>
              <div className="text-[11px] font-bold text-cyan-100">{scanDebug?.stage ? text(scanDebug.stage).replace(/_/g, " ") : "idle"}</div>
            </div>
            <div className="grid gap-2 text-[11px] font-semibold text-cyan-50 sm:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-black/25 px-3 py-2">
                <div className="text-[10px] uppercase tracking-[0.2em] text-cyan-200/80">Last raw value</div>
                <div className="mt-1 break-all text-sm text-white">{formatScanDebugValue(scanDebug?.rawValue || "")}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/25 px-3 py-2">
                <div className="text-[10px] uppercase tracking-[0.2em] text-cyan-200/80">Detected format</div>
                <div className="mt-1 break-all text-sm text-white">{formatScanDebugValue(scanDebug?.detectedFormat || "")}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/25 px-3 py-2">
                <div className="text-[10px] uppercase tracking-[0.2em] text-cyan-200/80">Resolver called</div>
                <div className="mt-1 text-sm text-white">{scanDebug?.resolverCalled ? "yes" : "no"}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/25 px-3 py-2">
                <div className="text-[10px] uppercase tracking-[0.2em] text-cyan-200/80">Resolver result</div>
                <div className="mt-1 text-sm text-white">{formatScanDebugValue(scanDebug?.resolverResult || "idle")}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/25 px-3 py-2 sm:col-span-2">
                <div className="text-[10px] uppercase tracking-[0.2em] text-cyan-200/80">Source</div>
                <div className="mt-1 break-all text-sm text-white">{formatScanDebugValue(scanDebug?.source || "")}</div>
              </div>
            </div>
            </div>
          ) : null}
          <div className="mt-3 rounded-3xl border border-white/10 bg-white/[0.04] p-3">
            <div className="text-[10px] font-black uppercase tracking-[0.22em] text-emerald-200">الإدخال اليدوي</div>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <input
                value={manualBarcodeValue}
                onChange={(event) => onManualBarcodeChange?.(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    onManualBarcodeSubmit?.();
                  }
                }}
                placeholder="أدخل الباركود يدويًا"
                className="min-h-11 flex-1 rounded-2xl border border-white/10 bg-black/30 px-3 text-sm font-semibold text-white outline-none placeholder:text-zinc-500"
              />
              <button
                type="button"
                onClick={onManualBarcodeSubmit}
                className="inline-flex min-h-11 items-center justify-center rounded-2xl bg-emerald-400 px-4 text-sm font-black text-zinc-950 transition hover:bg-emerald-300"
              >
                بحث
              </button>
            </div>
          </div>
          <div className="mt-3 text-center text-xs font-semibold text-zinc-500">
            يدعم باركود المنتجات وأكواد QR للبحث السريع داخل الكتالوج.
          </div>
        </div>
      </section>
    </div>,
    document.body
  );
}

export default function EmployeePortalProducts() {
  usePageTitle("Employee Product Catalog");
  const { token } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { groups: classificationGroups } = useProductClassifications({ includeInactive: false });
  const queryKey = searchParams.toString();

  const directLookup = useMemo(
    () => ({
      productId: text(searchParams.get("productId") || searchParams.get("product_id") || ""),
      variantId: text(searchParams.get("variantId") || searchParams.get("variant_id") || ""),
      colorId: text(searchParams.get("colorId") || searchParams.get("color_id") || ""),
      color: text(searchParams.get("color") || ""),
      size: text(searchParams.get("size") || ""),
      qrToken: text(searchParams.get("qr_token") || searchParams.get("qrToken") || searchParams.get("qr") || ""),
      barcode: text(searchParams.get("barcode") || ""),
      sku: text(searchParams.get("sku") || ""),
      article: text(searchParams.get("article") || searchParams.get("article_code") || searchParams.get("articleCode") || ""),
      action: text(searchParams.get("action") || ""),
    }),
    [queryKey]
  );
  const directLookupActive = Boolean(directLookup.productId || directLookup.variantId || directLookup.colorId || directLookup.color || directLookup.size || directLookup.qrToken || directLookup.barcode || directLookup.sku || directLookup.article);

  const [employee, setEmployee] = useState(null);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [filters, setFilters] = useState({
    category: "all",
    type: "all",
    brand: "all",
    manufacturer: "all",
    gender: "all",
    inStockOnly: true,
  });
  const [productsPage, setProductsPage] = useState(1);
  const [hasMoreProducts, setHasMoreProducts] = useState(false);
  const [loadingMoreProducts, setLoadingMoreProducts] = useState(false);
  // Newest-query-wins guard shared by page 1 and "تحميل المزيد".
  const productsRequestIdRef = useRef(0);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [selectedColor, setSelectedColor] = useState("");
  const [selectedSize, setSelectedSize] = useState("");
  const [selectedFilterSize, setSelectedFilterSize] = useState("all");
  const [selectedQuantity, setSelectedQuantity] = useState(1);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [loadingSubmit, setLoadingSubmit] = useState(false);
  const [resolvingScan, setResolvingScan] = useState(false);
  const [cameraScannerOpen, setCameraScannerOpen] = useState(false);
  const [scannerDebug, setScannerDebug] = useState({
    stage: "idle",
    rawValue: "",
    detectedFormat: "",
    resolverCalled: false,
    resolverResult: "idle",
    source: "",
  });
  const [manualBarcodeValue, setManualBarcodeValue] = useState("");
  const lookupDoneRef = useRef(false);
  const firstProductLoadRef = useRef(true);
  const draftRestoredRef = useRef(false);
  // Token-free draft namespace identity (server-supplied employee identity).
  const warehouseIdentity = useMemo(() => ({
    tenantId: employee?.tenant_id ?? null,
    employeeId: employee?.id ?? null,
    branchId: employee?.branch_id ?? null,
  }), [employee]);
  const filtersPanelRef = useRef(null);
  const searchInputRef = useRef(null);
  const homePath = useMemo(() => buildEmployeePortalHomePath({ pathname: location.pathname, token }), [location.pathname, token]);
  const openedFromDeepLink = directLookupActive;

  useEffect(() => {
    console.info("[SMART_QR_EMPLOYEE_PARAMS]", {
      href: typeof window !== "undefined" ? window.location.href : "",
      searchParams: Array.from(searchParams.entries()),
      productId: directLookup.productId,
      variantId: directLookup.variantId,
      colorId: directLookup.colorId,
      color: directLookup.color,
      size: directLookup.size,
      action: directLookup.action,
    });
  }, [directLookup.action, directLookup.color, directLookup.colorId, directLookup.productId, directLookup.size, directLookup.variantId, searchParams]);

  useEffect(() => {
    let cancelled = false;
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const loadProducts = async () => {
      try {
        setLoading(true);
        setError("");
        // Any query change starts a new sequence, so a slow page-1 response from
        // the PREVIOUS filter can never land on top of the new one, and an
        // in-flight "load more" from the old filter is discarded on arrival.
        const requestId = productsRequestIdRef.current + 1;
        productsRequestIdRef.current = requestId;
        const response = await getEmployeePortalCompactProducts(
          token,
          buildListParams({ search: deferredSearch, filters, selectedSize: selectedFilterSize, page: 1 }),
          { signal: controller?.signal }
        );
        if (cancelled || requestId !== productsRequestIdRef.current) return;
        setProducts(mapCompactCatalog(response?.products));
        setProductsPage(1);
        setHasMoreProducts(Boolean(response?.has_more));
        setEmployee(response?.employee || null);
      } catch (err) {
        if (cancelled || err?.name === "AbortError" || err?.name === "CanceledError") return;
        setError(err?.responseBody?.message_ar || err?.responseBody?.message || err?.message || "تعذر تحميل المنتجات");
        setProducts([]);
        setHasMoreProducts(false);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    // First open loads immediately (no artificial startup delay). Subsequent
    // search/filter changes are debounced ~300ms with the previous in-flight
    // request aborted, so a fast "n->ni->nik->nike" produces ONE render.
    if (firstProductLoadRef.current) {
      firstProductLoadRef.current = false;
      void loadProducts();
      return () => {
        cancelled = true;
        controller?.abort();
      };
    }

    const timer = window.setTimeout(() => { void loadProducts(); }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      controller?.abort();
    };
  }, [token, deferredSearch, filters.category, filters.type, filters.brand, filters.manufacturer, filters.gender, filters.inStockOnly, filters.color, selectedFilterSize]);

  // "تحميل المزيد": fetch the NEXT page of matches with the exact same filters and
  // append. Products are deduped by stable identity so a double click or an
  // overlapping request cannot repeat rows, and the sequence guard drops a page
  // that arrives after the filters changed.
  const loadMoreProducts = useCallback(async () => {
    if (loadingMoreProducts || !hasMoreProducts) return;
    const requestId = productsRequestIdRef.current;
    const nextPage = productsPage + 1;
    setLoadingMoreProducts(true);
    try {
      const response = await getEmployeePortalCompactProducts(
        token,
        buildListParams({ search: deferredSearch, filters, selectedSize: selectedFilterSize, page: nextPage })
      );
      if (requestId !== productsRequestIdRef.current) return;
      const incoming = mapCompactCatalog(response?.products);
      setProducts((current) => {
        const seen = new Set((Array.isArray(current) ? current : []).map(stableProductKey));
        return [...(Array.isArray(current) ? current : []), ...incoming.filter((item) => !seen.has(stableProductKey(item)))];
      });
      setProductsPage(nextPage);
      setHasMoreProducts(Boolean(response?.has_more));
    } catch (err) {
      if (err?.name === "AbortError" || err?.name === "CanceledError") return;
      toast.error(err?.responseBody?.message_ar || err?.message || "تعذر تحميل المزيد من المنتجات");
    } finally {
      setLoadingMoreProducts(false);
    }
  }, [loadingMoreProducts, hasMoreProducts, productsPage, token, deferredSearch, filters, selectedFilterSize]);

  useEffect(() => {
    lookupDoneRef.current = false;
    setSelectedProduct(null);
    setSelectedColor("");
    setSelectedSize("");
    setSelectedQuantity(1);
    setSheetOpen(false);
    if (openedFromDeepLink) setSearch("");
  }, [openedFromDeepLink, token, queryKey]);

  useEffect(() => {
    if (lookupDoneRef.current) return;
    if (!directLookup.productId && !directLookup.qrToken && !directLookup.barcode && !directLookup.sku && !directLookup.article) return;

    let cancelled = false;
    (async () => {
      try {
        const response = await getEmployeePortalProducts(token, buildLookupParams(directLookup));
        if (cancelled) return;

        const lookupProducts = normalizeEmployeePosCatalog(response?.products);
        const byProductId = lookupProducts.find((product) => productMatchesDirectLookup(product, directLookup).matchByProductId) || null;
        const byVariantProductId = lookupProducts.find((product) => {
          const variants = Array.isArray(product.variants) ? product.variants : [];
          return variants.some((variant) => String(variant.product_id ?? "") === String(directLookup.productId ?? ""));
        }) || null;
        if (!lookupProducts.length) return;

        const selection = response?.selection || {};
        const matched =
          lookupProducts.find((product) => String(product.id) === String(selection.product_id || "") || String(product.product_id) === String(selection.product_id || "")) ||
          byProductId ||
          byVariantProductId ||
          lookupProducts[0] ||
          null;

        console.info("[SMART_QR_PRODUCT_MATCH]", {
          source: "lookup",
          loadedProductsCount: lookupProducts.length,
          firstMatchingProduct: matched ? {
            id: matched.id,
            product_id: matched.product_id,
            name: matched.name || matched.product_name,
          } : null,
          lookupByProductId: byProductId ? {
            id: byProductId.id,
            product_id: byProductId.product_id,
          } : null,
          lookupByVariantProductId: byVariantProductId ? {
            id: byVariantProductId.id,
            product_id: byVariantProductId.product_id,
          } : null,
        });

        if (matched) {
          const variant = findVariant(
            matched,
            directLookup.variantId || selection.variant_id,
            directLookup.color || selection.color,
            directLookup.size || selection.size,
            directLookup.colorId
          );
          const nextColor = variant?.color || directLookup.color || selection.color || firstAvailableColor(matched);
          const nextSelection = resolveColorSelection(matched, nextColor, variant?.size || selection.size || "");
          setProducts(lookupProducts);
          setSelectedProduct(matched);
          setSelectedColor(nextColor);
          setSelectedSize(nextSelection.selectedSize);
          setSelectedQuantity(1);
          setSheetOpen(directLookup.action === "warehouse-request" || Boolean(directLookup.productId));
          setSearch("");
        }
      } finally {
        lookupDoneRef.current = true;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token, directLookup.productId, directLookup.variantId, directLookup.colorId, directLookup.color, directLookup.size, directLookup.qrToken, directLookup.barcode, directLookup.sku, directLookup.article, directLookup.action]);

  const normalizedProducts = useMemo(() => (Array.isArray(products) ? products : []).map(normalizeProduct), [products]);

  const resolveScannedProductFromCatalog = useCallback((scannedValue) => {
    const lookupValues = scanValueVariants(scannedValue);
    if (!lookupValues.length || !normalizedProducts.length) return null;

    const matchesCandidate = (candidate) => lookupValues.some((lookup) => scanFieldMatches(lookup, candidate));

    for (const product of normalizedProducts) {
      if (!product) continue;
      const variants = Array.isArray(product.variants) ? product.variants : [];
      const productCandidates = [
        product.qr_token,
        product.qrToken,
        product.barcode,
        product.sku,
        product.article_code,
        product.product_code,
        product.product_barcode,
      ];
      if (productCandidates.some(matchesCandidate)) {
        const selectedVariant = findVariant(product);
        return {
          product,
          variant: selectedVariant,
          selection: {
            product_id: product.id ?? product.product_id ?? null,
            variant_id: selectedVariant?.variant_id ?? selectedVariant?.id ?? null,
            color: selectedVariant?.color || "",
            size: selectedVariant?.size || "",
            source: "product",
          },
        };
      }

      const matchedVariant = variants.find((variant) => {
        const variantCandidates = [
          variant.qr_token,
          variant.qrToken,
          variant.barcode,
          variant.sku,
          variant.article_code,
          variant.variant_barcode,
          variant.variant_sku,
          variant.product_barcode,
          variant.product_sku,
        ];
        return variantCandidates.some(matchesCandidate);
      });

      if (matchedVariant) {
        return {
          product,
          variant: matchedVariant,
          selection: {
            product_id: product.id ?? product.product_id ?? null,
            variant_id: matchedVariant.variant_id ?? matchedVariant.id ?? null,
            color: matchedVariant.color || "",
            size: matchedVariant.size || "",
            source: "variant",
          },
        };
      }
    }

    return null;
  }, [normalizedProducts]);

  useEffect(() => {
    if (!directLookupActive) return;
    if (!normalizedProducts.length) return;

    const matches = normalizedProducts
      .map((product) => ({ product, result: productMatchesDirectLookup(product, directLookup) }))
      .filter(({ result }) => result.matched);
    const byProductId = matches.find(({ result }) => result.matchByProductId)?.product || null;
    const byVariantProductId = normalizedProducts.find((product) => {
      const variants = Array.isArray(product.variants) ? product.variants : [];
      return variants.some((variant) => String(variant.product_id ?? "") === String(directLookup.productId ?? ""));
    }) || null;
    const exactVariantProduct = matches.find(({ result }) => result.matchByVariantId || result.matchByColorId || result.matchByColor || result.matchBySize)?.product || null;
    const matchedProduct = byProductId || exactVariantProduct || byVariantProductId || null;

    console.info("[SMART_QR_PRODUCT_MATCH]", {
      source: "loaded-products",
      loadedProductsCount: normalizedProducts.length,
      firstMatchingProduct: matchedProduct ? {
        id: matchedProduct.id,
        product_id: matchedProduct.product_id,
        name: matchedProduct.name || matchedProduct.product_name,
      } : null,
      lookupByProductId: byProductId ? {
        id: byProductId.id,
        product_id: byProductId.product_id,
      } : null,
      lookupByVariantProductId: byVariantProductId ? {
        id: byVariantProductId.id,
        product_id: byVariantProductId.product_id,
      } : null,
    });

    if (!matchedProduct) return;

    const nextVariant = findVariant(
      matchedProduct,
      directLookup.variantId || null,
      directLookup.color || "",
      directLookup.size || "",
      directLookup.colorId || null
    );
    const nextColor = nextVariant?.color || directLookup.color || firstAvailableColor(matchedProduct);
    const nextSelection = resolveColorSelection(matchedProduct, nextColor, nextVariant?.size || "");

    setSearch("");
    setSelectedProduct(matchedProduct);
    setSelectedColor(nextColor);
    setSelectedSize(nextSelection.selectedSize);
    setSelectedQuantity(1);

    if (directLookup.action === "warehouse-request" || Boolean(directLookup.productId)) {
      console.info("[SMART_QR_OPEN_REQUEST]", {
        productId: matchedProduct.id ?? matchedProduct.product_id ?? null,
        variantId: nextVariant?.variant_id ?? nextVariant?.id ?? null,
        colorId: nextVariant?.color_id ?? directLookup.colorId ?? null,
        color: nextColor,
        size: nextSelection.selectedSize,
      });
      setSheetOpen(true);
    }
  }, [directLookup, directLookupActive, normalizedProducts]);

  const smartClassificationOptions = useMemo(
    () => classificationGroupsToFieldOptions(classificationGroups, {}, { includeInactive: false }),
    [classificationGroups]
  );

  const smartFilterOptions = useMemo(() => {
    const configuredWithCounts = (options, field) => (Array.isArray(options) ? options : []).map((option) => {
      const id = normalizeFilterValue(option.value || option.id || option.name || option.label);
      return {
        ...option,
        id,
        name: option.label_ar || option.label || option.label_en || option.value || option.id || "",
        count: normalizedProducts.filter((product) =>
          field === "gender"
            ? productMatchesAudience(product, id)
            : getEmployeeSmartFilterValue(product, field, options) === id
        ).length,
      };
    });

    const fallbackWithCounts = (values = []) => {
      const grouped = new Map();
      values.forEach((rawValue) => {
        const id = normalizeFilterValue(rawValue);
        if (!id) return;
        const current = grouped.get(id) || { id, name: text(rawValue), count: 0 };
        current.count += 1;
        grouped.set(id, current);
      });
      return [...grouped.values()];
    };

    const gender = smartClassificationOptions.gender?.length
      ? configuredWithCounts(smartClassificationOptions.gender, "gender")
      : fallbackWithCounts(normalizedProducts.map((product) => product.gender));
    const productType = smartClassificationOptions.productType?.length
      ? configuredWithCounts(smartClassificationOptions.productType, "productType")
      : fallbackWithCounts(normalizedProducts.map((product) => product.product_type || product.type));
    const grade = smartClassificationOptions.grade?.length
      ? configuredWithCounts(smartClassificationOptions.grade, "grade")
      : fallbackWithCounts(normalizedProducts.map((product) => product.grade));

    return {
      gender,
      productType: moveWinterCollectionToEnd(productType),
      grade,
    };
  }, [normalizedProducts, smartClassificationOptions]);

  const productsMatchingClassificationFilters = useMemo(() => normalizedProducts.filter((product) => {
    const matchesCategory =
      filters.category === "all" ||
      getEmployeeSmartFilterValue(product, "grade", smartClassificationOptions.grade) === normalizeFilterValue(filters.category);
    const matchesType =
      filters.type === "all" ||
      getEmployeeSmartFilterValue(product, "productType", smartClassificationOptions.productType) === normalizeFilterValue(filters.type);
    return matchesCategory && matchesType;
  }), [filters.category, filters.type, normalizedProducts, smartClassificationOptions]);

  const brandOptions = useMemo(
    () => uniqueValues(productsMatchingClassificationFilters.map((product) => product.brand))
      .map((brand) => ({ id: brand, name: brand })),
    [productsMatchingClassificationFilters]
  );

  const manufacturerOptions = useMemo(
    () => uniqueValues(productsMatchingClassificationFilters.map((product) => product.manufacturer_name))
      .map((manufacturer) => ({ id: manufacturer, name: manufacturer })),
    [productsMatchingClassificationFilters]
  );

  const activeFilterCount = useMemo(
    () =>
      ["category", "type", "brand", "manufacturer", "gender"].reduce(
        (count, key) => count + (filters[key] !== "all" ? 1 : 0),
        (filters.inStockOnly ? 0 : 1) + (selectedFilterSize !== "all" ? 1 : 0)
      ),
    [filters, selectedFilterSize]
  );

  const resetFilters = () => {
    setFilters({
      category: "all",
      type: "all",
      brand: "all",
      manufacturer: "all",
      gender: "all",
      inStockOnly: true,
    });
    setSelectedFilterSize("all");
  };

  const updateFilter = (key, value) => {
    setFilters((current) => ({ ...current, [key]: value }));
  };

  const activeVariant = useMemo(() => {
    if (!selectedProduct) return null;
    return findVariant(selectedProduct, null, selectedColor, selectedSize);
  }, [selectedProduct, selectedColor, selectedSize]);

  const matchesEmployeeBaseFilters = useCallback((product) => {
    const matchesCategory =
      filters.category === "all" ||
      getEmployeeSmartFilterValue(product, "grade", smartClassificationOptions.grade) === normalizeFilterValue(filters.category);
    const matchesType =
      filters.type === "all" ||
      getEmployeeSmartFilterValue(product, "productType", smartClassificationOptions.productType) === normalizeFilterValue(filters.type);
    const matchesBrand = filters.brand === "all" || text(product.brand) === text(filters.brand);
    const matchesManufacturer = filters.manufacturer === "all" || text(product.manufacturer_name) === text(filters.manufacturer);
    const matchesGender = filters.gender === "all" || productMatchesAudience(product, filters.gender);
    const matchesStock = !filters.inStockOnly || Number(product.total_stock || product.stock || 0) > 0;
    return matchesCategory && matchesType && matchesBrand && matchesManufacturer && matchesGender && matchesStock;
  }, [filters, smartClassificationOptions]);

  const productsMatchingBaseFilters = useMemo(
    () => normalizedProducts.filter(matchesEmployeeBaseFilters),
    [matchesEmployeeBaseFilters, normalizedProducts]
  );

  const availableSizes = useMemo(() => {
    const sizes = new Set();
    for (const product of productsMatchingClassificationFilters) {
      for (const variant of Array.isArray(product.variants) ? product.variants : []) {
        const size = variantSizeValue(variant);
        if (!size || variantStockValue(variant) <= 0) continue;
        sizes.add(size);
      }
    }
    return sortSizes([...sizes]).map((size) => ({
      id: size,
      name: size,
      count: productsMatchingClassificationFilters.filter((product) =>
        (Array.isArray(product.variants) ? product.variants : []).some((variant) =>
          variantSizeValue(variant) === size && variantStockValue(variant) > 0
        )
      ).length,
    }));
  }, [productsMatchingClassificationFilters]);

  useEffect(() => {
    if (filters.brand === "all") return;
    if (!brandOptions.some((option) => option.id === filters.brand)) {
      setFilters((current) => ({ ...current, brand: "all" }));
    }
  }, [brandOptions, filters.brand]);

  useEffect(() => {
    if (filters.manufacturer === "all") return;
    if (!manufacturerOptions.some((option) => option.id === filters.manufacturer)) {
      setFilters((current) => ({ ...current, manufacturer: "all" }));
    }
  }, [filters.manufacturer, manufacturerOptions]);

  useEffect(() => {
    if (selectedFilterSize === "all") return;
    if (!availableSizes.some((option) => option.id === selectedFilterSize)) {
      setSelectedFilterSize("all");
    }
  }, [availableSizes, selectedFilterSize]);

  const visibleProducts = useMemo(() => {
    const hasActiveSizeFilter = isActiveSizeFilter(selectedFilterSize);
    const matchedProducts = productsMatchingBaseFilters.filter((product) => {
      if (!hasActiveSizeFilter) return true;
      return (Array.isArray(product.variants) ? product.variants : []).some((variant) =>
        variantSizeValue(variant) === selectedFilterSize && variantStockValue(variant) > 0
      );
    });
    const expandedProducts = expandEmployeeProductCardsByColorAndSize(matchedProducts, { selectedSize: selectedFilterSize });
    if (!hasActiveSizeFilter) return Array.isArray(expandedProducts) && expandedProducts.length ? expandedProducts : matchedProducts;
    return expandedProducts;
  }, [productsMatchingBaseFilters, selectedFilterSize]);

  const openProduct = (product) => {
    const sourceProduct = product.employee_source_product || product;
    const preferredColor = text(product.employee_card_color) || firstAvailableColor(sourceProduct);
    const preferredSize = text(product.employee_card_size);
    const nextSelection = resolveColorSelection(sourceProduct, preferredColor, preferredSize);
    setSelectedProduct(sourceProduct);
    setSelectedColor(preferredColor);
    setSelectedSize(nextSelection.selectedSize);
    setSelectedQuantity(1);
    setSheetOpen(true);
  };

  const handleSelectColor = (color) => {
    if (!selectedProduct) return;
    const previousColor = selectedColor;
    const nextSelection = resolveColorSelection(selectedProduct, color, selectedSize);
    const resolvedImageUrl = resolveProductPreviewImage(selectedProduct, {
      color,
      size: nextSelection.selectedSize,
      variantId: nextSelection.activeVariant?.variant_id ?? nextSelection.activeVariant?.id ?? null,
    });
    setSelectedColor(color);
    setSelectedSize(nextSelection.selectedSize);
    setSelectedQuantity(1);
    if (isDevBuild) {
      console.debug("[employee-portal:variant-image-switch]", {
        productId: selectedProduct.id ?? selectedProduct.product_id ?? null,
        previousColor,
        nextColor: color,
        selectedSize: nextSelection.selectedSize,
        activeVariantId: nextSelection.activeVariant?.variant_id ?? nextSelection.activeVariant?.id ?? null,
        resolvedImageUrl,
      });
    }
  };

  const handleSelectSize = (size) => {
    const nextVariant = findVariant(selectedProduct, null, selectedColor, size);
    setSelectedSize(size);
    if (nextVariant?.color) setSelectedColor(nextVariant.color);
    setSelectedQuantity((current) => clamp(Number(current || 1), 1, Number(nextVariant?.stock || 1)));
  };

  const handleSubmit = async () => {
    if (loadingSubmit) return; // rapid double-click must not submit twice
    if (!selectedProduct || !activeVariant || Number(activeVariant.stock || 0) <= 0) return;
    setLoadingSubmit(true);
    try {
      await requestEmployeeWarehousePick(token, {
        productId: selectedProduct.id ?? selectedProduct.product_id ?? null,
        variantId: activeVariant.variant_id ?? activeVariant.id ?? null,
        color: activeVariant.color || selectedColor || "",
        size: activeVariant.size || selectedSize || "",
        quantity: 1,
      });
      toast.success("تم إرسال الطلب للمخزن");
      // Authoritative success only: drop the local working draft.
      clearWarehouseDraft(warehouseIdentity);
      draftRestoredRef.current = true;
      setSheetOpen(false);
      setSelectedQuantity(1);
      setSelectedProduct(null);
    } catch (err) {
      // Keep the draft on failure — a network error must never erase the work.
      toast.error(err?.message || "تعذر إرسال الطلب للمخزن");
    } finally {
      setLoadingSubmit(false);
    }
  };

  // ---- Warehouse Request working-draft persistence (token-free namespace) ----
  useEffect(() => { sweepExpiredDrafts(); }, []);

  // Persist the in-progress selection (product + color + size + quantity) so a
  // reload/close reopens where the employee stopped. Debounced + async in the
  // store; never authoritative — the server revalidates at submit.
  useEffect(() => {
    if (!warehouseIdentity.employeeId || !warehouseIdentity.branchId) return;
    if (!selectedProduct || !sheetOpen) return;
    saveWarehouseDraft(warehouseIdentity, {
      productId: selectedProduct.id ?? selectedProduct.product_id ?? null,
      color: selectedColor || "",
      size: selectedSize || "",
      quantity: selectedQuantity || 1,
      name: selectedProduct.name || selectedProduct.product_name || "",
      image_url: selectedProduct.image_url || selectedProduct.product_image_url || "",
      savedAt: Date.now(),
    });
  }, [warehouseIdentity, selectedProduct, selectedColor, selectedSize, selectedQuantity, sheetOpen]);

  // Restore the saved selection once identity + a product list are available.
  // Deep-link scans take precedence. Never blocks initial render.
  useEffect(() => {
    if (draftRestoredRef.current) return;
    if (!warehouseIdentity.employeeId || !warehouseIdentity.branchId) return;
    if (openedFromDeepLink) { draftRestoredRef.current = true; return; }
    if (!normalizedProducts.length) return;
    let active = true;
    loadWarehouseDraft(warehouseIdentity).then((draft) => {
      if (!active || draftRestoredRef.current) return;
      draftRestoredRef.current = true;
      if (!draft || !draft.productId) return;
      const product = normalizedProducts.find((p) => String(p.id ?? p.product_id) === String(draft.productId));
      if (!product) {
        // Referenced product not in the current view — surface, keep the draft.
        toast("لم يتم فتح المسودة تلقائيًا — العنصر غير ظاهر حاليًا", { icon: "⚠️" });
        return;
      }
      openProduct({ ...product, employee_card_color: draft.color, employee_card_size: draft.size });
      if (draft.quantity) setSelectedQuantity(draft.quantity);
    });
    return () => { active = false; };
  }, [warehouseIdentity, normalizedProducts, openedFromDeepLink]);

  const handleScannerDebugChange = useCallback((payload = {}) => {
    setScannerDebug((current) => ({
      ...current,
      ...payload,
    }));
  }, []);

  const resetScannerDebug = useCallback(() => {
    setScannerDebug({
      stage: "idle",
      rawValue: "",
      detectedFormat: "",
      resolverCalled: false,
      resolverResult: "idle",
      source: "",
    });
    setManualBarcodeValue("");
  }, []);

  const resolveScannedProductLookup = useCallback(async (scannedValue) => {
    const lookupValue = String(scannedValue || "").trim();
    if (!lookupValue) return null;

    const localMatch = resolveScannedProductFromCatalog(lookupValue);
    if (localMatch) {
      console.info("[employee-scanner:catalog-match]", {
        scannedValue: lookupValue,
        productId: localMatch.product?.id ?? localMatch.product?.product_id ?? null,
        variantId: localMatch.variant?.variant_id ?? localMatch.variant?.id ?? null,
        matchSource: localMatch.selection?.source || "catalog",
      });
      return localMatch;
    }

    const response = await getEmployeePortalProducts(token, {
      search: lookupValue,
      qr_token: lookupValue,
      barcode: lookupValue,
      sku: lookupValue,
      article: lookupValue,
      limit: 20,
      inStockOnly: 1,
    });

    const lookupProducts = normalizeEmployeePosCatalog(response?.products);
    const selection = response?.selection || {};
    const selectedProductId = text(selection.product_id);
    const matchedProduct =
      lookupProducts.find((product) => String(product.id ?? product.product_id ?? "") === selectedProductId) ||
      lookupProducts[0] ||
      null;

    if (!matchedProduct) return null;

    const matchedVariant = findVariant(
      matchedProduct,
      selection.variant_id || null,
      selection.color || "",
      selection.size || ""
    );

    return {
      product: matchedProduct,
      variant: matchedVariant,
      selection: {
        ...selection,
        source: "api",
      },
    };
  }, [resolveScannedProductFromCatalog, token]);

  const applyResolvedWarehouseRequestProduct = useCallback((result, resolutionMeta = {}) => {
    if (!result?.product) return false;

    const nextParams = new URLSearchParams();
    const resolvedProductId = String(result.product.id ?? result.product.product_id ?? "");
    nextParams.set("productId", resolvedProductId);
    if (result.variant?.variant_id ?? result.variant?.id) nextParams.set("variantId", String(result.variant.variant_id ?? result.variant.id));
    if (result.variant?.color_id ?? result.selection?.color_id) nextParams.set("colorId", String(result.variant?.color_id ?? result.selection?.color_id));
    if (result.variant?.color || result.selection?.color) nextParams.set("color", String(result.variant?.color || result.selection?.color));
    if (result.variant?.size || result.selection?.size) nextParams.set("size", String(result.variant?.size || result.selection?.size));
    nextParams.set("action", "warehouse-request");

    setScannerDebug((current) => ({
      ...current,
      resolverCalled: true,
      resolverResult: "found",
      source: resolutionMeta.source || current.source || "camera",
      rawValue: resolutionMeta.rawValue || current.rawValue || "",
      detectedFormat: resolutionMeta.detectedFormat || current.detectedFormat || "",
    }));
    setCameraScannerOpen(false);
    const finalRedirectUrl = `/employee-portal/${encodeURIComponent(token)}/products?${nextParams.toString()}`;
    navigate(finalRedirectUrl, { replace: true });
    return true;
  }, [navigate, token]);

  const resolveWarehouseRequestScan = useCallback(async (decodedValue, metadata = {}) => {
    const scannedValue = String(decodedValue || "").trim();
    if (!scannedValue) return false;

    const detectedFormat = text(metadata.formatName || metadata.detectedFormat || "");
    const decoderSource = text(metadata.source || "camera");
    console.info("[employee-scanner]", scannedValue);
    setScannerDebug({
      stage: "received",
      rawValue: scannedValue,
      detectedFormat,
      resolverCalled: true,
      resolverResult: "pending",
      source: decoderSource,
    });

    const smartQrParams = parseSmartQrScan(scannedValue);
    if (smartQrParams) {
      const nextParams = new URLSearchParams();
      nextParams.set("productId", smartQrParams.productId);
      if (smartQrParams.variantId) nextParams.set("variantId", smartQrParams.variantId);
      if (smartQrParams.colorId) nextParams.set("colorId", smartQrParams.colorId);
      if (smartQrParams.action) nextParams.set("action", smartQrParams.action);
      setScannerDebug((current) => ({
        ...current,
        resolverCalled: true,
        resolverResult: "found",
        source: `${decoderSource}:smart-qr`,
      }));
      const finalRedirectUrl = `/employee-portal/${encodeURIComponent(token)}/products?${nextParams.toString()}`;
      console.info("[SMART_QR_REDIRECT]", {
        productId: smartQrParams.productId,
        variantId: smartQrParams.variantId,
        colorId: smartQrParams.colorId,
        finalRedirectUrl,
      });
      setCameraScannerOpen(false);
      navigate(finalRedirectUrl, { replace: true });
      return true;
    }

    const localMatch = resolveScannedProductFromCatalog(scannedValue);
    if (localMatch && applyResolvedWarehouseRequestProduct(localMatch, { source: decoderSource, detectedFormat, rawValue: scannedValue })) {
      return true;
    }

    setResolvingScan(true);
    try {
      const result = await resolveScannedProductLookup(scannedValue);
      if (applyResolvedWarehouseRequestProduct(result, { source: decoderSource, detectedFormat, rawValue: scannedValue })) {
        return true;
      }
      setScannerDebug((current) => ({
        ...current,
        resolverCalled: true,
        resolverResult: "not found",
        source: decoderSource,
      }));
      setSearch(scannedValue);
      window.setTimeout(() => searchInputRef.current?.focus(), 0);
      return false;
    } catch (error) {
      console.warn("[employee-portal:scan-resolve-failed]", {
        scannedValue,
        message: error?.message || String(error || ""),
      });
      setScannerDebug((current) => ({
        ...current,
        resolverCalled: true,
        resolverResult: "error",
        source: decoderSource,
      }));
      setSearch(scannedValue);
      window.setTimeout(() => searchInputRef.current?.focus(), 0);
      return false;
    } finally {
      setResolvingScan(false);
    }
  }, [applyResolvedWarehouseRequestProduct, resolveScannedProductFromCatalog, resolveScannedProductLookup, token]);

  const handleCameraScannerResult = useCallback((decodedValue, metadata = {}) => resolveWarehouseRequestScan(decodedValue, metadata), [resolveWarehouseRequestScan]);

  const handleManualBarcodeSubmit = useCallback(() => {
    resolveWarehouseRequestScan(manualBarcodeValue, {
      source: "manual",
      formatName: "MANUAL_INPUT",
    });
  }, [manualBarcodeValue, resolveWarehouseRequestScan]);

  const handleCameraScannerPermissionDenied = useCallback((message = barcodeScannerMessages.permissionDenied) => {
    setCameraScannerOpen(false);
    toast.error(message || barcodeScannerMessages.permissionDenied);
  }, []);

  const handleCameraScannerUnsupported = useCallback((message = barcodeScannerMessages.unsupported) => {
    setCameraScannerOpen(false);
    toast.error(message || barcodeScannerMessages.unsupported);
  }, []);

  const handleCameraScannerError = useCallback((message = barcodeScannerMessages.startFailed) => {
    toast.error(message || barcodeScannerMessages.startFailed);
  }, []);

  const handleGoHome = useCallback(() => {
    navigate(homePath, { replace: !canNavigateEmployeePortalBack() });
  }, [homePath, navigate]);

  const handleCatalogBack = useCallback(() => {
    if (openedFromDeepLink || !canNavigateEmployeePortalBack()) {
      navigate(homePath, { replace: true });
      return;
    }
    navigate(-1);
  }, [homePath, navigate, openedFromDeepLink]);

  const handleProductDetailsBack = useCallback(() => {
    if (openedFromDeepLink) {
      navigate(homePath, { replace: true });
      return;
    }
    setSheetOpen(false);
  }, [homePath, navigate, openedFromDeepLink]);

  if (loading && !normalizedProducts.length) {
    return (
      <main dir="rtl" className="employee-portal-min-screen employee-portal-safe-top flex items-center justify-center bg-zinc-950 px-4 text-white">
        <div className="w-full max-w-7xl">
          <EmployeePortalNavControls onBack={handleCatalogBack} onHome={handleGoHome} tone="dark" className="px-0" />
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-7 w-7 animate-spin text-emerald-400" />
          </div>
        </div>
      </main>
    );
  }

  if (error && !normalizedProducts.length) {
    return (
      <main dir="rtl" className="employee-portal-min-screen employee-portal-safe-top bg-zinc-950 px-4 py-6 text-right text-white">
        <div className="mx-auto max-w-xl">
          <EmployeePortalNavControls onBack={handleCatalogBack} onHome={handleGoHome} tone="dark" />
          <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 shadow-[0_20px_50px_rgba(0,0,0,0.25)]">
            <div className="flex items-center gap-2 text-amber-300">
              <Store className="h-5 w-5" />
              <h1 className="text-xl font-black">Employee Portal Products</h1>
            </div>
            <p className="mt-3 text-sm font-semibold leading-6 text-zinc-300">{error}</p>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main dir="rtl" className="employee-portal-products employee-portal-min-screen overflow-x-hidden bg-[radial-gradient(circle_at_top,_rgba(16,185,129,0.12),_transparent_30%),linear-gradient(180deg,#09090b_0%,#111827_100%)] px-3 py-3 text-right text-white sm:px-4 sm:py-4">
      <div className="mx-auto max-w-7xl">
        {!sheetOpen ? <EmployeePortalNavControls onBack={handleCatalogBack} onHome={handleGoHome} tone="dark" /> : null}
        <section className="employee-portal-safe-top mt-3 rounded-[1.5rem] border border-white/10 bg-white/[0.03] p-3 shadow-[0_20px_50px_rgba(0,0,0,0.2)] backdrop-blur">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={() => {
                resetScannerDebug();
                setResolvingScan(false);
                setCameraScannerOpen(true);
              }}
              disabled={resolvingScan}
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-zinc-200 transition hover:border-emerald-300/30 hover:bg-emerald-400/10 disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="فتح ماسح الكاميرا"
              title="فتح ماسح الكاميرا"
            >
              {resolvingScan ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
            </button>
            <label className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-2xl border border-white/10 bg-black/30 px-3">
              <Search className="h-4 w-4 shrink-0 text-zinc-500" />
              <input
                ref={searchInputRef}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="ابحث بالاسم أو الموديل أو الباركود أو الكود"
                className="w-full bg-transparent text-sm font-semibold text-white outline-none placeholder:text-zinc-500"
              />
            </label>
            <button
              type="button"
              onClick={() => setFiltersOpen(true)}
              aria-expanded={filtersOpen}
              className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border transition ${
                filtersOpen || activeFilterCount > 0
                  ? "border-emerald-400/40 bg-emerald-400/15 text-emerald-100 shadow-[0_0_18px_rgba(16,185,129,0.14)]"
                  : "border-white/10 bg-white/[0.04] text-zinc-200 hover:border-emerald-300/30 hover:bg-emerald-400/10"
              }`}
              aria-label="الفلاتر"
              title="الفلاتر"
            >
              <span className="relative inline-flex">
                <Filter className="h-4 w-4" />
                {activeFilterCount > 0 ? (
                  <span className="absolute -right-2 -top-2 inline-flex min-h-4 min-w-4 items-center justify-center rounded-full bg-emerald-400 px-1 text-[10px] font-black text-zinc-950">
                    {activeFilterCount > 99 ? "99+" : activeFilterCount}
                  </span>
                ) : null}
              </span>
              <span className="sr-only">الفلاتر</span>
            </button>
          </div>
        </section>

        <section className="mt-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-sm font-black text-zinc-300">النتائج</h2>
            <div className="text-xs font-semibold text-zinc-500">{visibleProducts.length.toLocaleString("ar-EG")} منتج</div>
          </div>
          <ProductGrid
            loading={loading && !visibleProducts.length}
            error={error}
            products={visibleProducts}
            search={search}
            onSelectProduct={openProduct}
          />
          {/* Reaches matches beyond the first bounded page. Without this the list
              was hard-capped and any product past the cap was unreachable. */}
          {hasMoreProducts && !loading ? (
            <button
              type="button"
              onClick={loadMoreProducts}
              disabled={loadingMoreProducts}
              className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-2xl border border-emerald-400/30 bg-emerald-500/10 px-4 text-sm font-black text-emerald-100 transition hover:bg-emerald-500/20 disabled:opacity-50"
            >
              {loadingMoreProducts ? "جاري التحميل..." : "تحميل المزيد"}
            </button>
          ) : null}
        </section>

        {sheetOpen && selectedProduct ? (
          <ProductPickerSheet
            product={selectedProduct}
            selectedColor={selectedColor}
            selectedSize={selectedSize}
            quantity={selectedQuantity}
            onBack={handleProductDetailsBack}
            onHome={handleGoHome}
            onSelectColor={handleSelectColor}
            onSelectSize={handleSelectSize}
            onChangeQuantity={setSelectedQuantity}
            onClose={() => setSheetOpen(false)}
            onSubmit={handleSubmit}
            loadingSubmit={loadingSubmit}
          />
        ) : null}

        {cameraScannerOpen ? (
          <EmployeePortalCameraScannerModal
            onClose={() => {
              setCameraScannerOpen(false);
              setResolvingScan(false);
              resetScannerDebug();
            }}
            onScan={handleCameraScannerResult}
            onPermissionDenied={handleCameraScannerPermissionDenied}
            onUnsupported={handleCameraScannerUnsupported}
            onError={handleCameraScannerError}
            onDebugChange={handleScannerDebugChange}
            scanDebug={scannerDebug}
            resolvingScan={resolvingScan}
            manualBarcodeValue={manualBarcodeValue}
            onManualBarcodeChange={setManualBarcodeValue}
            onManualBarcodeSubmit={handleManualBarcodeSubmit}
          />
        ) : null}

        <SmartPosFilters
          open={filtersOpen}
          panelRef={filtersPanelRef}
          smartFilterOptions={smartFilterOptions}
          selectedGender={filters.gender}
          onGenderChange={(value) => updateFilter("gender", value)}
          selectedProductType={filters.type}
          onProductTypeChange={(value) => updateFilter("type", value)}
          selectedGrade={filters.category}
          onGradeChange={(value) => updateFilter("category", value)}
          brandOptions={brandOptions}
          selectedBrandId={filters.brand}
          onBrandChange={(value) => updateFilter("brand", value)}
          manufacturerOptions={manufacturerOptions}
          selectedManufacturerId={filters.manufacturer}
          onManufacturerChange={(value) => updateFilter("manufacturer", value)}
          sizeOptions={availableSizes}
          selectedSize={selectedFilterSize}
          onSizeChange={setSelectedFilterSize}
          activeSmartFilterCount={activeFilterCount}
          onReset={resetFilters}
          onClose={() => setFiltersOpen(false)}
        />
      </div>
    </main>
  );
}
