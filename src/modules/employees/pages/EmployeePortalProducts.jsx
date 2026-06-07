import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Camera, Filter, Loader2, Package2, Search, Store, X } from "lucide-react";
import toast from "react-hot-toast";

import BarcodeScanner, { barcodeScannerMessages } from "../../../components/BarcodeScanner";
import EmployeePortalNavControls, { buildEmployeePortalHomePath, canNavigateEmployeePortalBack } from "../components/EmployeePortalNavControls";
import { getEmployeePortalProducts, requestEmployeeWarehousePick } from "../services/employeePortalProductsApi";
import ProductGrid from "../../pos/components/ProductGrid";
import SmartPosFilters from "../../pos/components/SmartPosFilters";
import { normalizePosCatalogProduct, normalizePosSellableProducts } from "../../pos/services/posProductsApi";

const text = (value = "") => String(value || "").trim();
const lower = (value = "") => text(value).toLowerCase();
const uniqueValues = (values = []) => [...new Set(values.map((value) => text(value)).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ar"));
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const sizeSort = (a, b) => {
  const left = Number(a);
  const right = Number(b);
  if (Number.isFinite(left) && Number.isFinite(right)) return left - right;
  return String(a).localeCompare(String(b), "ar");
};
const sortSizes = (sizes = []) => [...sizes].sort(sizeSort);
const isDevBuild = Boolean(import.meta.env?.DEV);

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
  product_id: variant.product_id ?? null,
  color: text(variant.color || ""),
  size: variantSizeValue(variant),
  sku: text(variant.sku || ""),
  barcode: text(variant.barcode || ""),
  article_code: text(variant.article_code || variant.product_code || ""),
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
    article_code: text(mappedProduct.article_code || mappedProduct.product_code || mappedProduct.barcode || ""),
    manufacturer_name: text(mappedProduct.manufacturer_name || mappedProduct.manufacturer || ""),
    category: text(mappedProduct.category || mappedProduct.category_name || ""),
    type: text(mappedProduct.type || mappedProduct.product_type || mappedProduct.style || ""),
    brand: text(mappedProduct.brand || mappedProduct.brand_name || ""),
    gender: text(mappedProduct.gender || ""),
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

const variantsForColor = (product = {}, color = "") =>
  (Array.isArray(product.variants) ? product.variants : []).filter((variant) =>
    text(variant.color) === text(color)
  );

const firstVariantForColor = (product = {}, color = "") =>
  variantsForColor(product, color)[0] || null;

const findVariant = (product = {}, variantId = null, color = "", size = "") => {
  const allVariants = Array.isArray(product.variants) ? product.variants : [];
  const variants = color ? variantsForColor(product, color) : allVariants;
  if (variantId) {
    const byId = variants.find((variant) => String(variant.variant_id ?? variant.id ?? "") === String(variantId));
    if (byId) return byId;
  }
  if (color || size) {
    const byCombo = variants.find((variant) => text(variant.color) === text(color) && text(variant.size) === text(size));
    if (byCombo) return byCombo;
  }
  return variants.find((variant) => Number(variant.stock || 0) > 0) || variants[0] || null;
};

const stockByColor = (product = {}, color = "") =>
  (Array.isArray(product.variants) ? product.variants : [])
    .filter((variant) => !color || text(variant.color) === text(color))
    .reduce((sum, variant) => sum + Math.max(0, Number(variant.stock || 0)), 0);

const firstAvailableColor = (product = {}) => product.colors.find((color) => stockByColor(product, color) > 0) || product.colors[0] || "";

const sizeOptionsForProduct = (product = {}, color = "") => {
  const variants = Array.isArray(product.variants) ? product.variants : [];
  const filtered = color ? variants.filter((variant) => text(variant.color) === text(color)) : variants;
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
    ? scopedVariants.find((variant) => text(variant.size) === text(preferredSize))
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
    if (selectedSize && variantSizeValue(variant) !== selectedSize) return false;
    if (selectedColor && text(variant.color) !== selectedColor) return false;
    return true;
  });
};

const buildEmployeeScopedProductCard = (product = {}, variants = [], { color = "", size = "" } = {}) => {
  const scopedColor = text(color);
  const scopedSize = text(size);
  const scopedVariants = Array.isArray(variants) ? variants : [];
  const scopedStock = scopedVariants.reduce((sum, variant) => sum + variantStockValue(variant), 0);
  const previewVariant = scopedVariants.find((variant) => extractImageUrl(variant)) || scopedVariants[0] || null;
  const previewImageUrl = resolveProductPreviewImage(product, {
    color: scopedColor,
    size: scopedSize,
    variantId: previewVariant?.variant_id ?? previewVariant?.id ?? null,
  });

  return {
    ...product,
    id: `${product.id ?? product.product_id ?? "product"}:${scopedColor || "default"}:${scopedSize || "all"}`,
    product_id: `${product.product_id ?? product.id ?? "product"}:${scopedColor || "default"}:${scopedSize || "all"}`,
    employee_source_product_id: product.id ?? product.product_id ?? null,
    employee_source_product: product,
    employee_card_color: scopedColor,
    employee_card_size: scopedSize,
    employee_card_variant_id: previewVariant?.variant_id ?? previewVariant?.id ?? null,
    image_url: previewImageUrl || product.image_url,
    product_image_url: previewImageUrl || product.product_image_url || product.image_url,
    variant_image_url: previewImageUrl || previewVariant?.image_url || "",
    total_stock: scopedStock,
    stock: scopedStock,
    colors: scopedColor ? [scopedColor] : uniqueValues(scopedVariants.map((variant) => variant.color)),
    sizes: sortSizes(uniqueValues(scopedVariants.map((variant) => variant.size))),
    variants: scopedVariants,
  };
};

const expandEmployeeProductCardsByColorAndSize = (products = [], filters = {}) => {
  const selectedSize = text(filters.selectedSize || "");
  if (!selectedSize) return products;

  const cards = [];
  const seen = new Set();
  for (const product of products) {
    const availableVariants = getAvailableVariantsForEmployeeFilters(product, { selectedSize });
    const colors = uniqueValues(availableVariants.map((variant) => variant.color));
    for (const color of colors) {
      const scopedVariants = availableVariants.filter((variant) => text(variant.color) === color);
      if (!scopedVariants.length) continue;
      const key = `${product.id ?? product.product_id ?? "product"}:${color}:${selectedSize}`;
      if (seen.has(key)) continue;
      seen.add(key);
      cards.push(buildEmployeeScopedProductCard(product, scopedVariants, { color, size: selectedSize }));
    }
  }
  return cards;
};

const buildListParams = ({ search, filters }) => {
  const params = { limit: 120, inStockOnly: 1 };
  const q = text(search);
  if (q) params.q = q;
  if (filters.category !== "all") params.category = filters.category;
  if (filters.type !== "all") params.type = filters.type;
  if (filters.brand !== "all") params.brand = filters.brand;
  if (filters.manufacturer !== "all") params.manufacturer = filters.manufacturer;
  if (filters.gender !== "all") params.gender = filters.gender;
  return params;
};

const buildLookupParams = (directLookup) => {
  const params = { limit: 20, inStockOnly: 1 };
  if (directLookup.productId) params.productId = directLookup.productId;
  if (directLookup.barcode) params.barcode = directLookup.barcode;
  if (directLookup.article) params.article = directLookup.article;
  return params;
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

      <div className="min-w-0 flex-1">
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
            <X className="h-4 w-4" />
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

function EmployeePortalCameraScannerModal({ onClose, onScan, onPermissionDenied, onUnsupported, onError }) {
  if (typeof document === "undefined") return null;

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
          <div className="min-w-0">
            <div className="text-[10px] font-black uppercase tracking-[0.22em] text-emerald-200">EMPLOYEE SCANNER</div>
            <h3 id="employee-portal-camera-scanner-title" className="mt-1 text-lg font-black text-white">امسح الباركود أو QR بالكاميرا</h3>
            <p className="mt-1 text-xs font-semibold text-zinc-500">وجّه الكاميرا نحو الكود وسيتم البحث مباشرة.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-zinc-300 transition hover:bg-white/[0.08]"
            aria-label="إغلاق ماسح الكاميرا"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-4">
          <div className="overflow-hidden rounded-3xl border border-white/10 bg-black/60 p-3">
            <BarcodeScanner
              onScan={onScan}
              onPermissionDenied={onPermissionDenied}
              onUnsupported={onUnsupported}
              onError={onError}
              className="overflow-hidden rounded-[1.35rem] bg-black"
              scannerClassName="min-h-[320px]"
            />
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
  const { token } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const queryKey = searchParams.toString();

  const directLookup = useMemo(
    () => ({
      productId: text(searchParams.get("productId") || searchParams.get("product_id") || ""),
      barcode: text(searchParams.get("barcode") || ""),
      article: text(searchParams.get("article") || searchParams.get("article_code") || searchParams.get("articleCode") || ""),
    }),
    [queryKey]
  );

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
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [selectedColor, setSelectedColor] = useState("");
  const [selectedSize, setSelectedSize] = useState("");
  const [selectedFilterSize, setSelectedFilterSize] = useState("all");
  const [selectedQuantity, setSelectedQuantity] = useState(1);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [loadingSubmit, setLoadingSubmit] = useState(false);
  const [cameraScannerOpen, setCameraScannerOpen] = useState(false);
  const lookupDoneRef = useRef(false);
  const filtersPanelRef = useRef(null);
  const searchInputRef = useRef(null);
  const homePath = useMemo(() => buildEmployeePortalHomePath({ pathname: location.pathname, token }), [location.pathname, token]);
  const openedFromDeepLink = Boolean(directLookup.productId || directLookup.barcode || directLookup.article);

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    document.title = "Employee Portal Products";
    return undefined;
  }, []);

  useEffect(() => {
    let cancelled = false;
    const timeoutId = window.setTimeout(async () => {
      try {
        setLoading(true);
        setError("");
        const response = await getEmployeePortalProducts(token, buildListParams({ search: deferredSearch, filters }));
        if (cancelled) return;
        setProducts(normalizeEmployeePosCatalog(response?.products));
        setEmployee(response?.employee || null);
      } catch (err) {
        if (cancelled) return;
        setError(err?.responseBody?.message_ar || err?.responseBody?.message || err?.message || "تعذر تحميل المنتجات");
        setProducts([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [token, deferredSearch, filters.category, filters.type, filters.brand, filters.manufacturer, filters.gender, filters.inStockOnly]);

  useEffect(() => {
    lookupDoneRef.current = false;
    setSelectedProduct(null);
    setSelectedColor("");
    setSelectedSize("");
    setSelectedQuantity(1);
    setSheetOpen(false);
  }, [token, queryKey]);

  useEffect(() => {
    if (lookupDoneRef.current) return;
    if (!directLookup.productId && !directLookup.barcode && !directLookup.article) return;

    let cancelled = false;
    (async () => {
      try {
        const response = await getEmployeePortalProducts(token, buildLookupParams(directLookup));
        if (cancelled) return;

        const lookupProducts = normalizeEmployeePosCatalog(response?.products);
        if (!lookupProducts.length) return;

        const selection = response?.selection || {};
        const matched =
          lookupProducts.find((product) => String(product.id) === String(selection.product_id || "")) ||
          lookupProducts[0] ||
          null;

        if (matched) {
          const variant = findVariant(matched, selection.variant_id, selection.color, selection.size);
          const nextColor = variant?.color || firstAvailableColor(matched);
          const nextSelection = resolveColorSelection(matched, nextColor, variant?.size || selection.size || "");
          setProducts(lookupProducts);
          setSelectedProduct(matched);
          setSelectedColor(nextColor);
          setSelectedSize(nextSelection.selectedSize);
          setSelectedQuantity(1);
          setSheetOpen(true);
        }
      } finally {
        lookupDoneRef.current = true;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token, directLookup.productId, directLookup.barcode, directLookup.article]);

  const normalizedProducts = useMemo(() => (Array.isArray(products) ? products : []).map(normalizeProduct), [products]);

  const filterOptions = useMemo(() => {
    const categories = uniqueValues(normalizedProducts.map((product) => product.category));
    const types = uniqueValues(normalizedProducts.map((product) => product.type));
    const brands = uniqueValues(normalizedProducts.map((product) => product.brand));
    const manufacturers = uniqueValues(normalizedProducts.map((product) => product.manufacturer_name));
    const genders = uniqueValues(normalizedProducts.map((product) => product.gender));
    return { categories, types, brands, manufacturers, genders };
  }, [normalizedProducts]);

  const optionWithCounts = (values, products, valueForProduct) =>
    values.map((value) => ({
      id: value,
      name: value,
      count: products.filter((product) => text(valueForProduct(product)) === text(value)).length,
    }));

  const smartFilterOptions = useMemo(
    () => ({
      gender: optionWithCounts(filterOptions.genders, normalizedProducts, (product) => product.gender),
      productType: optionWithCounts(filterOptions.types, normalizedProducts, (product) => product.type),
      grade: optionWithCounts(filterOptions.categories, normalizedProducts, (product) => product.category),
    }),
    [filterOptions, normalizedProducts]
  );

  const brandOptions = useMemo(
    () => filterOptions.brands.map((brand) => ({ id: brand, name: brand })),
    [filterOptions.brands]
  );

  const manufacturerOptions = useMemo(
    () => filterOptions.manufacturers.map((manufacturer) => ({ id: manufacturer, name: manufacturer })),
    [filterOptions.manufacturers]
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
    const matchesCategory = filters.category === "all" || text(product.category) === text(filters.category);
    const matchesType = filters.type === "all" || text(product.type) === text(filters.type);
    const matchesBrand = filters.brand === "all" || text(product.brand) === text(filters.brand);
    const matchesManufacturer = filters.manufacturer === "all" || text(product.manufacturer_name) === text(filters.manufacturer);
    const matchesGender = filters.gender === "all" || text(product.gender) === text(filters.gender);
    const matchesStock = !filters.inStockOnly || Number(product.total_stock || product.stock || 0) > 0;
    return matchesCategory && matchesType && matchesBrand && matchesManufacturer && matchesGender && matchesStock;
  }, [filters]);

  const productsMatchingBaseFilters = useMemo(
    () => normalizedProducts.filter(matchesEmployeeBaseFilters),
    [matchesEmployeeBaseFilters, normalizedProducts]
  );

  const availableSizes = useMemo(() => {
    const sizes = new Set();
    for (const product of productsMatchingBaseFilters) {
      for (const variant of Array.isArray(product.variants) ? product.variants : []) {
        const size = variantSizeValue(variant);
        if (!size || variantStockValue(variant) <= 0) continue;
        sizes.add(size);
      }
    }
    return sortSizes([...sizes]).map((size) => ({
      id: size,
      name: size,
      count: productsMatchingBaseFilters.filter((product) =>
        (Array.isArray(product.variants) ? product.variants : []).some((variant) =>
          variantSizeValue(variant) === size && variantStockValue(variant) > 0
        )
      ).length,
    }));
  }, [productsMatchingBaseFilters]);

  useEffect(() => {
    if (selectedFilterSize === "all") return;
    if (!availableSizes.some((option) => option.id === selectedFilterSize)) {
      setSelectedFilterSize("all");
    }
  }, [availableSizes, selectedFilterSize]);

  const visibleProducts = useMemo(() => {
    const matchedProducts = productsMatchingBaseFilters.filter((product) => {
      if (selectedFilterSize === "all") return true;
      return (Array.isArray(product.variants) ? product.variants : []).some((variant) =>
        variantSizeValue(variant) === selectedFilterSize && variantStockValue(variant) > 0
      );
    });
    return expandEmployeeProductCardsByColorAndSize(matchedProducts, { selectedSize: selectedFilterSize });
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
      setSheetOpen(false);
      setSelectedQuantity(1);
    } catch (err) {
      toast.error(err?.message || "تعذر إرسال الطلب للمخزن");
    } finally {
      setLoadingSubmit(false);
    }
  };

  const handleCameraScannerResult = useCallback((decodedValue) => {
    const scannedValue = String(decodedValue || "").trim();
    if (!scannedValue) return;
    setCameraScannerOpen(false);
    setSearch(scannedValue);
    window.setTimeout(() => searchInputRef.current?.focus(), 0);
  }, []);

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
    <main dir="rtl" className="employee-portal-min-screen overflow-x-hidden bg-[radial-gradient(circle_at_top,_rgba(16,185,129,0.12),_transparent_30%),linear-gradient(180deg,#09090b_0%,#111827_100%)] px-3 py-3 text-right text-white sm:px-4 sm:py-4">
      <div className="mx-auto max-w-7xl">
        {!sheetOpen ? <EmployeePortalNavControls onBack={handleCatalogBack} onHome={handleGoHome} tone="dark" /> : null}
        <header className="employee-portal-safe-top rounded-[1.5rem] border border-white/10 bg-white/[0.03] px-4 py-3 shadow-[0_20px_60px_rgba(0,0,0,0.35)] backdrop-blur">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="text-[10px] font-black uppercase tracking-[0.24em] text-emerald-300">Employee Portal</div>
              <h1 className="truncate text-lg font-black text-white">كتالوج المنتجات</h1>
              <div className="mt-0.5 text-xs font-semibold text-zinc-400">
                {employee?.full_name ? `الموظف: ${employee.full_name}` : "ابحث عن المنتج ثم اختر اللون والمقاس لطلبه من المخزن"}
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setSearch("");
                setFilters({
                  category: "all",
                  type: "all",
                  brand: "all",
                  manufacturer: "all",
                  gender: "all",
                  inStockOnly: true,
                });
                setSelectedProduct(null);
                setSelectedColor("");
                setSelectedSize("");
                setSelectedFilterSize("all");
                setSelectedQuantity(1);
                setSheetOpen(false);
              }}
              className="inline-flex min-h-10 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-black text-white self-start sm:self-auto"
            >
              إعادة الضبط
            </button>
          </div>
        </header>

        <section className="mt-3 rounded-[1.5rem] border border-white/10 bg-white/[0.03] p-3 shadow-[0_20px_50px_rgba(0,0,0,0.2)] backdrop-blur">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setCameraScannerOpen(true)}
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-zinc-200 transition hover:border-emerald-300/30 hover:bg-emerald-400/10"
              aria-label="فتح ماسح الكاميرا"
              title="فتح ماسح الكاميرا"
            >
              <Camera className="h-4 w-4" />
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
            onClose={() => setCameraScannerOpen(false)}
            onScan={handleCameraScannerResult}
            onPermissionDenied={handleCameraScannerPermissionDenied}
            onUnsupported={handleCameraScannerUnsupported}
            onError={handleCameraScannerError}
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
