import { memo, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

import {
  AlertTriangle,
  BadgeDollarSign,
  ChevronDown,
  CheckCircle,
  Copy,
  Eye,
  EyeOff,
  Filter,
  ImageOff,
  MoreHorizontal,
  Package2,
  Pencil,
  Plus,
  Printer,
  Power,
  Search,
  Tag,
  Barcode,
  CalendarClock,
  Megaphone,
  PackageSearch,
  Trash2,
  X,
  Star,
  Zap,
} from "lucide-react";

import toast from "react-hot-toast";
import { isAdminUser } from "../../../shared/auth/authStorage";
import { Pagination } from "../../../shared/ui";

import useDismissableLayer from "../../../shared/hooks/useDismissableLayer";
import { canViewCostPrices, hasPermission } from "../../permissions/lib/rbacStore";

import ProductsShell from "../components/ProductsShell";
import { addProductsToPrintList } from "../lib/productPrintList";

import { useProductClassifications } from "../hooks/useProductClassifications";
import {
  cleanupProductCache,
  generateBarcode,
  generateSku,
  removeProductMeta,
  upsertProductMeta,
} from "../lib/catalog";
import {
  classificationGroupsToFieldOptions,
  normalizeClassificationValue,
} from "../lib/productClassifications";
import {
  bulkAddBarcodePrintQueue,
  createProduct,
  deleteProduct,
  getProductsAdminList,
  getProductsWithVariants,
  toggleProductPosFavorite,
  updateProductPrices,
  updateProductStatus,
} from "../services/productsApi";
import { resolveProductImageUrl } from "../../../shared/lib/imageUrls";
import { isSchoolBagType } from "../lib/schoolBagSizes";
import {
  DEFAULT_PRODUCTS_LIST_FILTERS,
  readProductsListFilters,
  removeStoredProductsListFilters,
  writeProductsListFilters,
} from "../lib/productListFilters";
import { keyboardLayoutIncludes } from "../../../../shared/keyboardLayoutSearch";

import PostEditorModal from "../../marketing/components/PostEditorModal";
import {
  createMarketingPost,
  generateProductMarketingPost,
  publishProductStoryEverywhere,
  publishMarketingPost,
  scheduleProductStoryEverywhere,
  scheduleMarketingPost,
  updateMarketingPost,
} from "../../marketing/services/marketingApi";

const pageSizeOptions = [10, 25, 50, 100, 200, 500, 1000, "all"];
const PRODUCTS_PAGE_SIZE_STORAGE_KEY = "erp.products.list.pageSize";
const DEFAULT_PRODUCTS_PAGE_SIZE = pageSizeOptions[0];
const REQUEST_TIMEOUT_MS = 15000;
const ACTION_MENU_WIDTH = 224;
const ACTION_MENU_ESTIMATED_HEIGHT = 480;
const PRODUCT_TABLE_COLUMNS = {
  select: "w-12",
  product: "w-[320px]",
  categoryBrand: "w-[250px]",
  stock: "w-[145px]",
  costSale: "w-[190px]",
  status: "w-[130px]",
  actions: "w-[310px]",
};
const ROW_ACTION_BREAKPOINTS = {
  lg: 1024,
  xl: 1280,
  "2xl": 1536,
};
const CLASSIFICATION_FILTER_FIELDS = [
  { key: "gender", field: "gender", labelKey: "products.filters.gender", fallbackLabel: "Gender" },
  { key: "productType", field: "product_type", labelKey: "products.filters.productType", fallbackLabel: "Product type" },
  { key: "grade", field: "grade", labelKey: "products.filters.sourceQuality", fallbackLabel: "Source / quality" },
];
const PRODUCT_AUDIENCE_OPTIONS = [
  { value: "men", label_en: "Men", label_ar: "رجالي", tone: "border-primary/20 bg-primary/15 text-primary" },
  { value: "women", label_en: "Women", label_ar: "حريمي", tone: "border-rose-400/20 bg-rose-500/15 text-rose-300" },
  { value: "kids", label_en: "Kids", label_ar: "أطفال", tone: "border-amber-400/20 bg-amber-500/15 text-amber-300" },
];

function BrandFilterCombobox({ value = "all", options = [], onChange, allLabel, searchPlaceholder }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const listboxId = useId();
  const wrapRef = useRef(null);
  const triggerRef = useRef(null);
  const searchRef = useRef(null);
  const brands = useMemo(
    () => [...new Set((Array.isArray(options) ? options : []).filter((brand) => brand && brand !== "all"))],
    [options]
  );
  const filteredBrands = useMemo(
    () => brands.filter((brand) => keyboardLayoutIncludes(brand, query)),
    [brands, query]
  );
  const visibleOptions = useMemo(() => ["all", ...filteredBrands], [filteredBrands]);

  useDismissableLayer({
    enabled: open,
    refs: [wrapRef, triggerRef],
    onDismiss: () => setOpen(false),
  });

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => searchRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  const selectBrand = (brand) => {
    onChange?.(brand);
    setQuery("");
    setOpen(false);
  };

  return (
    <div ref={wrapRef} className="relative min-w-0">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          setQuery("");
          setActiveIndex(event.key === "ArrowUp" ? Math.max(0, brands.length) : 0);
          setOpen(true);
        }}
        onClick={() => {
          setQuery("");
          setActiveIndex(0);
          setOpen((current) => !current);
        }}
        className="m1-dropdown-trigger flex h-full min-h-[46px] w-full min-w-0 items-center justify-between gap-2 rounded-[var(--radius-control)] border border-border bg-surface-soft px-4 py-3 text-text outline-none transition hover:border-border-strong"
      >
        <span className="truncate">{value === "all" ? allLabel : value}</span>
        <ChevronDown size={16} className={`shrink-0 transition ${open ? "rotate-180" : ""}`} />
      </button>

      {open ? (
        <div className="m1-dropdown-menu absolute inset-x-0 top-full z-[90] mt-2 min-w-[16rem] overflow-hidden border bg-surface">
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <Search size={16} className="shrink-0 text-text-muted" />
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              role="combobox"
              aria-autocomplete="list"
              aria-expanded="true"
              aria-controls={listboxId}
              aria-activedescendant={`${listboxId}-option-${activeIndex}`}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  const delta = event.key === "ArrowDown" ? 1 : -1;
                  setActiveIndex((current) => (current + delta + visibleOptions.length) % visibleOptions.length);
                }
                if (event.key === "Enter" && visibleOptions.length) {
                  event.preventDefault();
                  selectBrand(visibleOptions[activeIndex] || "all");
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  setOpen(false);
                  triggerRef.current?.focus();
                }
                if (event.key === "Tab") setOpen(false);
              }}
              placeholder={searchPlaceholder}
              className="w-full min-w-0 bg-transparent py-1.5 text-sm text-text outline-none placeholder:text-text-muted"
            />
          </div>
          <div id={listboxId} role="listbox" className="max-h-72 overflow-y-auto p-1">
            <button
              id={`${listboxId}-option-0`}
              type="button"
              role="option"
              aria-selected={value === "all"}
              tabIndex={-1}
              onMouseEnter={() => setActiveIndex(0)}
              onClick={() => selectBrand("all")}
              className={`m1-dropdown-option flex w-full rounded-[var(--radius-control)] px-3 py-2 text-start transition hover:bg-surface-hover ${value === "all" ? "bg-primary/15 text-primary" : activeIndex === 0 ? "bg-surface-hover text-text" : "text-text"}`}
            >
              {allLabel}
            </button>
            {filteredBrands.map((brand, index) => (
              <button
                key={brand}
                id={`${listboxId}-option-${index + 1}`}
                type="button"
                role="option"
                aria-selected={value === brand}
                tabIndex={-1}
                onMouseEnter={() => setActiveIndex(index + 1)}
                onClick={() => selectBrand(brand)}
                className={`m1-dropdown-option flex w-full rounded-[var(--radius-control)] px-3 py-2 text-start transition hover:bg-surface-hover ${value === brand ? "bg-primary/15 text-primary" : activeIndex === index + 1 ? "bg-surface-hover text-text" : "text-text"}`}
              >
                {brand}
              </button>
            ))}
            {!filteredBrands.length ? (
              <div className="px-3 py-4 text-center text-sm text-text-muted">
                {searchPlaceholder}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

const productStatusValue = (row = {}) => String(row.status || "").trim().toLowerCase();
const isOfferStoryValue = (row = {}) => row?.is_offer_story === true || String(row?.is_offer_story || "").trim().toLowerCase() === "true";
const isNonOfferStoryValue = (row = {}) => row?.is_offer_story === false || String(row?.is_offer_story || "").trim().toLowerCase() === "false";
const isStorefrontVisibleValue = (row = {}) =>
  row?.is_storefront_visible === true ||
  String(row?.is_storefront_visible ?? "").trim().toLowerCase() === "true" ||
  row?.is_storefront_visible === undefined ||
  row?.is_storefront_visible === null ||
  row?.is_storefront_visible === "";

const isInactiveProduct = (row = {}) =>
  row.active === false ||
  row.is_active === false ||
  ["inactive", "disabled", "unavailable"].includes(productStatusValue(row));

const isStatusToggleableProduct = (row = {}) =>
  !["archived", "deleted", "draft"].includes(productStatusValue(row));

const getProductTypeValue = (row = {}) =>
  String(row.product_type ?? row.productType ?? "").trim();

const isMeaningfulCategory = (value = "") => {
  const normalized = String(value || "").trim().toLowerCase();
  return Boolean(normalized) && !["uncategorized", "غير مصنف", "بدون تصنيف"].includes(normalized);
};

const getStoredProductsPageSize = () => {
  if (typeof window === "undefined") return DEFAULT_PRODUCTS_PAGE_SIZE;
  try {
    const storedValue = Number(window.localStorage.getItem(PRODUCTS_PAGE_SIZE_STORAGE_KEY));
    return pageSizeOptions.includes(storedValue) ? storedValue : DEFAULT_PRODUCTS_PAGE_SIZE;
  } catch {
    return DEFAULT_PRODUCTS_PAGE_SIZE;
  }
};

const storeProductsPageSize = (value) => {
  if (typeof window === "undefined" || !pageSizeOptions.includes(Number(value))) return;
  try {
    window.localStorage.setItem(PRODUCTS_PAGE_SIZE_STORAGE_KEY, String(value));
  } catch {
    // Keep pagination usable when browser storage is unavailable.
  }
};

const handleNavigableActionClick = (event, onClick) => {
  if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  onClick?.();
};

const isInlineRowActionVisible = (action = {}, viewportWidth = 0) => {
  const visibleFrom = action.visibleFrom || "lg";
  const minWidth = ROW_ACTION_BREAKPOINTS[visibleFrom] || ROW_ACTION_BREAKPOINTS.lg;
  return Number(viewportWidth || 0) >= minWidth;
};

const normalizeAudienceValue = (value = "") => {
  const normalized = String(value || "").trim().toLowerCase();
  if (["men", "man", "male"].includes(normalized)) return "men";
  if (["women", "woman", "female", "ladies"].includes(normalized)) return "women";
  if (["kids", "kid", "children", "child", "boys", "girls"].includes(normalized)) return "kids";
  return "";
};

const getProductAudiences = (row = {}) => {
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
  visit(row.audiences);
  visit(row.product_audiences);
  visit(row.gender);
  return PRODUCT_AUDIENCE_OPTIONS.map((option) => option.value).filter((value) => seen.has(value));
};

const getProductArticleCodes = (row = {}) => {
  const values = Array.isArray(row.article_codes)
    ? row.article_codes
    : Array.isArray(row.articleCodes)
      ? row.articleCodes
      : [];
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
};

const getSchoolBagSizeLabel = (row = {}) => {
  if (!isSchoolBagType(row.bag_type ?? row.bagType)) return "";
  const value = String(row.fixed_size_label ?? row.fixedSizeLabel ?? "").trim();
  if (!value) return "";
  const inchMatch = value.match(/^(\d{1,2})(?:[-_\s]*inch(?:es)?)?$/i);
  const inches = Number(inchMatch?.[1] || 0);
  return inches >= 12 && inches <= 22 ? `${inches} بوصة` : "";
};

const ProductArticleBadges = ({ row = {}, limit = 3 }) => {
  const articleCodes = getProductArticleCodes(row);
  const schoolBagSizeLabel = getSchoolBagSizeLabel(row);
  if (!articleCodes.length && !schoolBagSizeLabel) return null;
  const visibleCodes = articleCodes.slice(0, limit);
  const remainingCount = Math.max(0, articleCodes.length - visibleCodes.length);

  return (
    <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-1" title={articleCodes.join(" • ")}>
      {visibleCodes.map((articleCode) => (
        <span
          key={articleCode}
          dir="ltr"
          className="inline-flex max-w-[7rem] items-center rounded-[var(--radius-control)] border border-amber-300/20 bg-amber-400/10 px-1.5 py-0.5 text-[10px] font-black leading-4 text-amber-200"
        >
          <span className="truncate">{articleCode}</span>
        </span>
      ))}
      {remainingCount ? (
        <span className="inline-flex items-center rounded-[var(--radius-card)] border border-border bg-surface-soft px-1.5 py-0.5 text-[10px] font-black leading-4 text-text-muted">
          +{remainingCount}
        </span>
      ) : null}
      {schoolBagSizeLabel ? (
        <span className="inline-flex items-center rounded-[var(--radius-control)] border border-primary/20 bg-primary/10 px-1.5 py-0.5 text-[10px] font-black leading-4 text-primary">
          مقاس {schoolBagSizeLabel}
        </span>
      ) : null}
    </div>
  );
};

const ProductAudienceBadges = ({ row = {}, language = "ar" }) => {
  const audiences = getProductAudiences(row);
  const isArabic = String(language || "").toLowerCase().startsWith("ar");
  if (!audiences.length) {
    return (
      <span className="inline-flex items-center rounded-full border border-border bg-border-strong px-2.5 py-1 text-[10px] font-black text-text-muted">
        {isArabic ? "غير محدد" : "Not specified"}
      </span>
    );
  }
  return audiences.map((audience) => {
    const option = PRODUCT_AUDIENCE_OPTIONS.find((item) => item.value === audience);
    return option ? (
      <span key={audience} className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-black ${option.tone}`}>
        {isArabic ? option.label_ar : option.label_en}
      </span>
    ) : null;
  });
};

const getColorImageStatusDetails = (row = {}) => {
  const status = String(row.colorImageStatus || row.color_image_status || "none").trim().toLowerCase();
  const totalColors = Number(row.totalColors ?? row.total_colors ?? 0) || 0;
  const missingColors = Number(row.missingColors ?? row.missing_colors ?? 0) || 0;
  const missingColorNames = Array.isArray(row.missingColorNames)
    ? row.missingColorNames
    : Array.isArray(row.missing_color_names)
      ? row.missing_color_names
      : [];
  return {
    status,
    totalColors,
    missingColors,
    missingColorNames: missingColorNames.map((name) => String(name || "").trim()).filter(Boolean),
  };
};

const ProductColorImageBadge = ({ row = {}, onClick }) => {
  const { status, totalColors, missingColors, missingColorNames } = getColorImageStatusDetails(row);
  const isComplete = status === "complete";
  const isIncomplete = status === "incomplete" || status === "missing";
  const title = isIncomplete && missingColorNames.length ? missingColorNames.join(", ") : isComplete ? "كل الألوان لديها صور" : "لا توجد ألوان";
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-black transition ${ isComplete ? "border-emerald-300/25 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/20" : isIncomplete ? "border-red-300/25 bg-red-500/15 text-red-200 hover:bg-red-500/20" : "border-border bg-border-strong text-text-muted hover:bg-surface-hover" }`}
    >
      {isComplete ? <CheckCircle size={12} /> : isIncomplete ? <AlertTriangle size={12} /> : <Package2 size={12} />}
      <span>{isComplete ? "✓ الصور مكتملة" : isIncomplete ? `⚠ صور ناقصة (${missingColors}/${totalColors})` : "لا توجد ألوان"}</span>
    </button>
  );
};

const getThermalImageLevelDetails = (row = {}) => {
  const productThermalUrl = String(
    row.productThermalImageUrl ||
    row.product_thermal_image_url ||
    ""
  ).trim();
  const hasProductThermal = Boolean(productThermalUrl);
  const colorCount = Math.max(0, Number(row.thermalColorCount ?? row.thermal_color_count ?? 0) || 0);
  const colorNames = (
    Array.isArray(row.thermalColorNames)
      ? row.thermalColorNames
      : Array.isArray(row.thermal_color_names)
        ? row.thermal_color_names
        : []
  ).map((value) => String(value || "").trim()).filter(Boolean);
  return { hasProductThermal, colorCount, colorNames };
};

const ProductThermalLevelBadge = ({ row = {} }) => {
  const { hasProductThermal, colorCount, colorNames } = getThermalImageLevelDetails(row);
  const hasColorThermal = colorCount > 0;
  const label = hasProductThermal && hasColorThermal
    ? `Thermal المنتج + الألوان (${colorCount})`
    : hasColorThermal
      ? `Thermal الألوان (${colorCount})`
      : hasProductThermal
        ? "Thermal المنتج"
        : "لا توجد Thermal";
  const title = hasColorThermal && colorNames.length
    ? `ألوان Thermal: ${colorNames.join("، ")}${hasProductThermal ? " — ويوجد Thermal للمنتج" : ""}`
    : label;
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-black ${ hasProductThermal && hasColorThermal ? "border-violet-300/30 bg-violet-500/15 text-violet-200" : hasColorThermal ? "border-primary/30 bg-primary/15 text-primary" : hasProductThermal ? "border-amber-300/30 bg-amber-500/15 text-amber-200" : "border-border bg-border-strong text-text-muted" }`}
    >
      <Zap size={11} />
      {label}
    </span>
  );
};

const getActionMenuPosition = (rect, itemCount = 8) => {
  const fallback = { top: 12, left: 12, width: ACTION_MENU_WIDTH, maxHeight: ACTION_MENU_ESTIMATED_HEIGHT, placement: "bottom" };
  if (typeof window === "undefined") return fallback;
  const padding = 12;
  const gap = 8;
  const width = Math.min(ACTION_MENU_WIDTH, Math.max(180, window.innerWidth - padding * 2));
  const viewportMaxHeight = Math.max(180, window.innerHeight - padding * 2);
  const estimatedHeight = Math.min(
    ACTION_MENU_ESTIMATED_HEIGHT,
    Math.max(56, Number(itemCount || 0) * 44)
  );
  const safeRect = rect && Number.isFinite(rect.left) && Number.isFinite(rect.right) && Number.isFinite(rect.bottom) && Number.isFinite(rect.top)
    ? rect
    : {
        top: padding,
        left: window.innerWidth - padding - width,
        right: window.innerWidth - padding,
        bottom: padding,
      };

  const alignRightLeft = safeRect.right - width;
  const alignLeft = safeRect.left;
  const preferredLeft =
    alignRightLeft >= padding
      ? alignRightLeft
      : alignLeft + width <= window.innerWidth - padding
        ? alignLeft
        : alignRightLeft;
  const left = Math.min(Math.max(padding, preferredLeft), window.innerWidth - width - padding);
  const spaceBelow = window.innerHeight - safeRect.bottom - padding;
  const spaceAbove = safeRect.top - padding;
  const openBelow = spaceBelow >= Math.min(estimatedHeight, viewportMaxHeight) || spaceBelow >= spaceAbove;
  const availableHeight = Math.max(180, openBelow ? spaceBelow - gap : spaceAbove - gap);
  const maxHeight = Math.min(estimatedHeight, availableHeight, viewportMaxHeight);
  const top = openBelow
    ? Math.min(safeRect.bottom + gap, window.innerHeight - maxHeight - padding)
    : Math.max(padding, safeRect.top - maxHeight - gap);

  return {
    top,
    left,
    width,
    maxHeight,
    placement: openBelow ? "bottom" : "top",
  };
};

const isQuotaExceeded = (error) =>
  error?.name === "QuotaExceededError" ||
  error?.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
  error?.code === 22 ||
  error?.code === 1014 ||
  /quota/i.test(String(error?.message || ""));

const cleanSkuDisplay = (value) => {
  const sku = String(value || "").trim();
  if (!sku) return "";
  if (/^(not[\s_-]*generated|n\/a|na|null|undefined|-+)$/i.test(sku)) return "";
  return sku;
};

const duplicateVariantPayload = (variant = {}, index = 0) => ({
  color_group_key: variant.color_group_key || variant.colorGroupKey || "",
  colorGroupKey: variant.color_group_key || variant.colorGroupKey || "",
  color: variant.color || "",
  size: variant.size || "",
  sku: "",
  barcode: generateBarcode(),
  stock: Number(variant.stock || 0),
  sale_price: Number(variant.sale_price ?? variant.price ?? 0),
  price: Number(variant.price ?? variant.sale_price ?? 0),
  cost_price: Number(variant.cost_price ?? variant.purchase_price ?? 0),
  manufacturer_id: variant.manufacturer_id || null,
  image_url: "",
  variant_image_url: "",
  color_image_url: "",
  thermal_image_url: "",
  images: [],
  edition_name: variant.edition_name ? `${variant.edition_name} Copy ${index + 1}` : "",
  edition_slug: "",
});

const duplicateProductPayload = (row = {}) => ({
  name: `${row.name || "منتج"} نسخة`,
  description: "",
  category: row.category || "غير مصنف",
  category_id: row.category_id || null,
  brand: row.brand || "بدون علامة",
  brand_id: row.brand_id || null,
  gender: row.gender || "",
  audiences: Array.isArray(row.audiences) ? row.audiences : [],
  product_audiences: Array.isArray(row.product_audiences) ? row.product_audiences : Array.isArray(row.audiences) ? row.audiences : [],
  product_type: row.product_type || "",
  grade: row.grade || "",
  variation_mode: row.variation_mode || "full_variations",
  fixed_size_label: row.fixed_size_label || "",
  purchase_alerts_enabled: Boolean(row.purchase_alerts_enabled),
  purchase_alert_by_color: Boolean(row.purchase_alert_by_color),
  unit_id: row.unit_id || null,
  sale_price: Number(row.sale_price || row.price || 0),
  cost_price: Number(row.cost_price || 0),
  wholesale_price: Number(row.wholesale_price || 0),
  price: Number(row.price || row.sale_price || 0),
  stock: Number(row.stock || 0),
  barcode: generateBarcode(),
  image_url: "",
  gallery: [],
  colorImages: Array.isArray(row.color_images)
    ? row.color_images.map((group) => ({
        ...group,
        image_url: "",
        thermal_image_url: "",
        images: [],
        ai_cover: null,
        ai_cover_status: "",
      }))
    : Array.isArray(row.variants)
      ? Object.values(
          row.variants.reduce((groups, variant) => {
            const color = String(variant.color || "").trim();
            if (!color) return groups;
            const key = color.toLowerCase();
            if (!groups[key]) {
              groups[key] = {
                color_name: color,
                color_value: color,
                color_group_key: variant.color_group_key || variant.colorGroupKey || "",
                colorGroupKey: variant.color_group_key || variant.colorGroupKey || "",
                images: [],
                image_url: "",
              };
            }
            return groups;
          }, {})
        )
      : [],
  variants:
    row.variation_mode === "simple"
      ? []
      : Array.isArray(row.variants)
        ? row.variants.map(duplicateVariantPayload)
        : [],
});

const firstImageValue = (...values) => {
  for (const value of values) {
    if (Array.isArray(value)) {
      const nested = firstImageValue(...value);
      if (nested) return nested;
      continue;
    }

    if (value && typeof value === "object") {
      const nested = firstImageValue(value.image_url, value.url, value.image, value.preview, value.path, value.file_path);
      if (nested) return nested;
      continue;
    }

    const text = String(value || "").trim();
    if (text) return text;
  }
  return "";
};

const parseGalleryImages = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  const text = value.trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const getFirstGalleryImage = (row = {}) =>
  firstImageValue(
    row.gallery_images,
    row.gallery,
    parseGalleryImages(row.gallery_images),
    parseGalleryImages(row.gallery)
  );

const getFirstVariantFallbackImage = (row = {}) => {
  const variants = Array.isArray(row.variants) ? row.variants : [];
  return firstImageValue(
    variants.map((variant) =>
      firstImageValue(
        variant.image_url,
        variant.variant_image_url,
        variant.color_image_url,
        variant.image,
        variant.photo_url,
        variant.thumbnail_url,
        variant.images,
        variant.gallery_images,
        variant.color_images
      )
    )
  );
};

const getProductThumbnail = (row = {}) => {
  const imageValue = firstImageValue(
    row.cover_image_url,
    row.image_url,
    row.main_image_url,
    row.featured_image_url,
    row.product_image_url,
    row.photo_url,
    row.image,
    row.thumbnail_url,
    getFirstGalleryImage(row),
    getFirstVariantFallbackImage(row)
  );

  return resolveProductImageUrl(imageValue);
};

const getProductColorPreviews = (row = {}) => {
  const stockSummary = getProductColorStockSummary(row);
  const stockByColor = new Map(stockSummary.map((item) => [item.color.toLowerCase(), item]));
  const previews = Array.isArray(row.colorImagePreviews)
    ? row.colorImagePreviews
    : Array.isArray(row.color_image_previews)
      ? row.color_image_previews
      : [];
  const seen = new Set();
  const normalizedPreviews = previews.reduce((result, preview) => {
    const imageUrl = resolveProductImageUrl(firstImageValue(preview?.image_url, preview?.imageUrl, preview?.url));
    const color = String(preview?.color || preview?.color_name || preview?.colorName || "لون").trim();
    const key = `${color.toLowerCase()}|${imageUrl}`;
    if (!imageUrl || seen.has(key)) return result;
    seen.add(key);
    result.push({ color, imageUrl, ...(stockByColor.get(color.toLowerCase()) || { stock: 0, sizes: [] }) });
    return result;
  }, []);
  if (normalizedPreviews.length) return normalizedPreviews;

  const colorGroups = Array.isArray(row.color_images) ? row.color_images : [];
  const variants = Array.isArray(row.variants) ? row.variants : [];
  const sources = colorGroups.length ? colorGroups : variants;
  return sources.reduce((result, source) => {
    const color = String(
      source?.color ?? source?.color_name ?? source?.colorName ?? source?.color_value ?? source?.colorValue ?? "لون"
    ).trim();
    const imageUrl = resolveProductImageUrl(firstImageValue(
      source?.primary_image_url,
      source?.primaryImageUrl,
      source?.image_url,
      source?.color_image_url,
      source?.variant_image_url,
      source?.images,
      source?.gallery_images,
      Array.isArray(source?.sizes) ? source.sizes.map((size) => firstImageValue(size?.image_url, size?.variant_image_url, size?.color_image_url, size?.images)) : []
    ));
    const key = `${color.toLowerCase()}|${imageUrl}`;
    if (!imageUrl || seen.has(key)) return result;
    seen.add(key);
    result.push({ color, imageUrl, ...(stockByColor.get(color.toLowerCase()) || { stock: 0, sizes: [] }) });
    return result;
  }, []);
};

const productColorHoverCache = new Map();

function getProductColorStockSummary(row = {}) {
  const supplied = Array.isArray(row.colorStockSummary)
    ? row.colorStockSummary
    : Array.isArray(row.color_stock_summary)
      ? row.color_stock_summary
      : [];
  if (supplied.length) {
    return supplied.map((item) => ({
      color: String(item?.color || item?.color_name || "لون").trim(),
      stock: Math.max(0, Number(item?.stock || 0) || 0),
      sizes: (Array.isArray(item?.sizes) ? item.sizes : []).map((size) => ({
        size: String(size?.size || size?.size_name || "مقاس واحد").trim(),
        stock: Math.max(0, Number(size?.stock || 0) || 0),
      })),
    }));
  }

  const variants = Array.isArray(row.variants) ? row.variants : [];
  const colors = new Map();
  variants.forEach((variant) => {
    const color = String(variant?.color || "لون").trim();
    const colorKey = color.toLowerCase();
    const size = String(variant?.size || row.fixed_size_label || "مقاس واحد").trim();
    const stock = Math.max(0, Number(
      variant?.default_purchase_qty ??
      variant?.defaultPurchaseQty ??
      variant?.purchase_qty ??
      variant?.purchase_quantity ??
      variant?.planned_qty ??
      variant?.planned_quantity ??
      variant?.bulk_purchase_qty ??
      0
    ) || 0);
    if (!colors.has(colorKey)) colors.set(colorKey, { color, stock: 0, sizes: new Map() });
    const entry = colors.get(colorKey);
    entry.stock += stock;
    entry.sizes.set(size, (entry.sizes.get(size) || 0) + stock);
  });
  return [...colors.values()].map((item) => ({
    color: item.color,
    stock: item.stock,
    sizes: [...item.sizes.entries()].map(([size, stock]) => ({ size, stock })),
  }));
}

const normalizeQueueColorKey = (value = "") => String(value ?? "").trim().toLowerCase();

const getProductQueueColorGroups = (row = {}) => {
  const colorMap = new Map();
  const addGroup = (source = {}, fallbackVariant = null) => {
    const color = String(
      source?.color ??
        source?.color_name ??
        source?.colorName ??
        source?.color_value ??
        source?.colorValue ??
        fallbackVariant?.color ??
        ""
    ).trim();
    const colorKey = normalizeQueueColorKey(color || source?.color_key || source?.colorKey || "");
    const primaryImageUrl = String(
      source?.colorPrimaryImageUrl ??
        source?.primary_image_url ??
        source?.primaryImageUrl ??
        source?.image_url ??
        source?.color_image_url ??
        source?.colorImageUrl ??
        fallbackVariant?.color_image_url ??
        fallbackVariant?.variant_image_url ??
        fallbackVariant?.image_url ??
        row.product_image_url ??
        row.image_url ??
        ""
    ).trim();
    const thermalImageUrl = String(
      source?.variant_color_thermal_image_url ??
        source?.color_thermal_image_url ??
        source?.thermal_image_url ??
        source?.variantColorThermalImageUrl ??
        source?.colorThermalImageUrl ??
        fallbackVariant?.variant_color_thermal_image_url ??
        fallbackVariant?.color_thermal_image_url ??
        fallbackVariant?.thermal_image_url ??
        row.product_thermal_image_url ??
        row.thermal_image_url ??
        ""
    ).trim();
    const variantId = Number(
      source?.variant_id ??
        source?.variantId ??
        source?.id ??
        fallbackVariant?.id ??
        fallbackVariant?.variant_id ??
        0
    ) || null;

    const groupKey = colorKey || normalizeQueueColorKey(primaryImageUrl || color || row.id || "default");
    if (!colorMap.has(groupKey)) {
      colorMap.set(groupKey, {
        color: color || "Default",
        colorKey: groupKey,
        primaryImageUrl,
        thermalImageUrl,
        variantIds: [],
      });
    }
    const group = colorMap.get(groupKey);
    if (!group.primaryImageUrl) group.primaryImageUrl = primaryImageUrl;
    if (!group.thermalImageUrl) group.thermalImageUrl = thermalImageUrl;
    if (variantId) group.variantIds.push(variantId);
  };

  const colorImages = Array.isArray(row.color_images) ? row.color_images : [];
  const variants = Array.isArray(row.variants) ? row.variants : [];
  if (colorImages.length) {
    colorImages.forEach((group) => {
      const sizes = Array.isArray(group?.sizes) ? group.sizes : [];
      const fallbackVariant = sizes.find((size) => Number(size?.variant_id || size?.id || 0) > 0) || null;
      addGroup(group, fallbackVariant);
      if (sizes.length) {
        const normalized = colorMap.get(normalizeQueueColorKey(group?.color || group?.color_name || group?.color_value || group?.colorKey || ""));
        if (normalized) {
          normalized.variantIds = [...new Set([...normalized.variantIds, ...sizes.map((size) => Number(size?.variant_id || size?.id || 0)).filter(Boolean)])];
        }
      }
    });
  } else if (variants.length) {
    variants.forEach((variant) => addGroup(variant, variant));
  }

  if (!colorMap.size) {
    const productImageUrl = String(row.product_image_url || row.image_url || "").trim();
    if (productImageUrl) {
      colorMap.set("default", {
        color: "Default",
        colorKey: "default",
        primaryImageUrl: productImageUrl,
        thermalImageUrl: String(row.product_thermal_image_url || row.thermal_image_url || "").trim(),
        variantIds: [],
      });
    }
  }

  return Array.from(colorMap.values()).map((group) => ({
    ...group,
    variantIds: [...new Set(group.variantIds)].filter(Boolean),
  }));
};

const getErrorMessage = (error, fallback) =>
  error?.responseBody?.message ||
  error?.responseBody?.error ||
  error?.message ||
  fallback;

const priceNumber = (value) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const nullablePriceInput = (value) => {
  if (value === null || value === undefined || value === "") return "";
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? String(parsed) : "";
};

const productSalePriceValue = (row = {}) => priceNumber(row.selling_price ?? row.regular_price ?? row.price ?? 0);
const productDiscountPriceValue = (row = {}) => nullablePriceInput(row.discount_price ?? row.offer_price ?? row.sale_price);
const variantSalePriceValue = (variant = {}) => priceNumber(variant.selling_price ?? variant.regular_price ?? variant.price ?? variant.variant_price ?? 0);
const variantDiscountPriceValue = (variant = {}) => nullablePriceInput(variant.discount_price ?? variant.offer_price ?? variant.sale_price);
const productPurchasePriceValue = (row = {}) => priceNumber(row.purchase_price ?? row.last_purchase_price ?? row.cost_price ?? row.last_purchase_cost ?? 0);
const variantPurchasePriceValue = (variant = {}) => priceNumber(variant.purchase_price ?? variant.last_purchase_price ?? variant.cost_price ?? variant.last_purchase_cost ?? 0);
const isSimpleCatalogProduct = (row = {}) => {
  const mode = String(row?.variation_mode || "").trim().toLowerCase();
  const type = String(row?.product_type || row?.type || "").trim().toLowerCase();
  return mode === "simple" || type === "simple";
};
const getProductId = (row = {}) =>
  row?.product_id ?? row?.productId ?? row?.product?.id ?? row?.id ?? null;

const getProductTotalStock = (product) => {
  const variants = Array.isArray(product?.variants) ? product.variants : [];

  if (variants.length > 0) {
    return variants.reduce((sum, variant) => {
      return (
        sum +
        Number(
          variant.stock_quantity ??
            variant.stock ??
            variant.quantity ??
            variant.qty ??
            variant.available_quantity ??
            variant.inventory_quantity ??
            variant.current_stock ??
            0
        )
      );
    }, 0);
  }

  const aggregatedStock = Number(
    product?.total_variant_stock ??
      product?.total_stock ??
      product?.stock ??
      product?.quantity ??
      product?.qty ??
      product?.available_quantity ??
      product?.inventory_quantity ??
      product?.current_stock ??
      0
  );
  if (Number.isFinite(aggregatedStock)) {
    return aggregatedStock;
  }

  return Number(
    product?.stock ??
      product?.quantity ??
      product?.qty ??
      product?.available_quantity ??
      product?.inventory_quantity ??
      product?.current_stock ??
      0
  );
};

const getProductStockState = (product) => {
  const totalStock = getProductTotalStock(product);
  const lowStockAlert = Number(product?.low_stock_alert ?? product?.low_stock_threshold ?? 0);

  return {
    totalStock,
    lowStockAlert,
    isOutOfStock: totalStock <= 0,
    isLowStock: totalStock > 0 && lowStockAlert > 0 && totalStock <= lowStockAlert,
  };
};

const formatCardPrice = (value) => {
  const amount = Number(value || 0);
  return `ج.م ${new Intl.NumberFormat("ar-EG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(amount) ? amount : 0)}`;
};

const positivePrice = (...values) => {
  for (const value of values) {
    const parsed = Number(value ?? 0);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 0;
};

const activeSalePrice = (source = {}) => {
  const sale = positivePrice(source.discount_price, source.offer_price, source.sale_price);
  return sale > 0 ? sale : 0;
};

const uniquePriceValues = (values = []) => {
  const seen = new Set();
  return values
    .map((value) => Number(value || 0))
    .filter((value) => Number.isFinite(value) && value > 0)
    .filter((value) => {
      const key = value.toFixed(2);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a - b);
};

const formatPriceRange = (values = []) => {
  const prices = uniquePriceValues(values);
  if (!prices.length) return "غير متاح";
  if (prices.length === 1) return formatCardPrice(prices[0]);
  return `${formatCardPrice(prices[0])} - ${formatCardPrice(prices[prices.length - 1])}`;
};

const getCatalogPriceDisplay = (row = {}) => {
  const variants = Array.isArray(row.variants) ? row.variants : [];
  const useVariants = variants.length > 0 && !isSimpleCatalogProduct(row);

  const costValues = useVariants
    ? variants.map((variant) => positivePrice(
        variant.cost_price,
        variant.purchase_price,
        variant.last_purchase_cost,
        variant.average_cost
      ))
    : [positivePrice(row.cost_price, row.purchase_price, row.last_purchase_cost, row.average_cost)];

  const sellValues = useVariants
    ? variants.map((variant) => positivePrice(variant.selling_price, variant.regular_price, variant.price, variant.variant_sale_price))
    : [positivePrice(row.selling_price, row.regular_price, row.price)];

  const saleValues = useVariants
    ? variants.map(activeSalePrice)
    : [activeSalePrice(row)];

  const costUnique = uniquePriceValues(costValues);
  const sellUnique = uniquePriceValues(sellValues);
  const saleUnique = uniquePriceValues(saleValues);

  return {
    cost: formatPriceRange(costValues),
    sell: formatPriceRange(sellValues),
    sale: saleUnique.length ? formatPriceRange(saleValues) : "غير متاح",
    costVaries: costUnique.length > 1,
    sellVaries: sellUnique.length > 1,
    saleVaries: saleUnique.length > 1,
  };
};

function PriceLine({
  label,
  value,
  varies = false,
  variesLabel = "متنوع",
  tone = "muted",
  concealed = false,
  revealLabel = "Show value",
  hideLabel = "Hide value",
}) {
  const [revealed, setRevealed] = useState(false);
  const toneClass =
    tone === "sell"
      ? "text-emerald-200"
      : tone === "sale"
        ? "text-amber-200"
        : "text-text-muted";

  return (
    <div className="flex items-baseline justify-center gap-2">
      <span className="shrink-0 font-bold text-text-muted">{label}:</span>
      {concealed ? (
        <button
          type="button"
          onClick={() => setRevealed((current) => !current)}
          aria-label={revealed ? hideLabel : revealLabel}
          aria-pressed={revealed}
          title={revealed ? hideLabel : revealLabel}
          className={`group/cost inline-flex min-w-0 items-center gap-1.5 rounded-[var(--radius-control)] px-1.5 py-0.5 text-right font-black tabular-nums transition hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/50 ${toneClass}`}
        >
          <span className="min-w-0 truncate">
            {revealed && varies ? <span className="me-1 text-[10px] font-bold text-text-muted">{variesLabel}</span> : null}
            {revealed ? value : "••••••"}
          </span>
          {revealed ? <EyeOff size={13} className="shrink-0 text-text-muted" /> : <Eye size={13} className="shrink-0 text-text-muted transition group-hover/cost:text-text-muted" />}
        </button>
      ) : (
        <span className={`min-w-0 truncate text-right font-black tabular-nums ${toneClass}`} title={`${label}: ${value}`}>
          {varies ? <span className="me-1 text-[10px] font-bold text-text-muted">{variesLabel}</span> : null}
          {value}
        </span>
      )}
    </div>
  );
}

function ColorPreviewImage({ src, alt }) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (failed) {
    return (
      <div
        title={`الصورة غير موجودة على السيرفر: ${src}`}
        className="flex h-16 w-full flex-col items-center justify-center gap-1 rounded-[var(--radius-card)] border border-red-300/30 bg-red-500/10 text-red-200"
      >
        <ImageOff size={16} />
        <span className="text-[9px] font-black leading-none">صورة مفقودة</span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      onError={() => setFailed(true)}
      className="h-16 w-full rounded-[var(--radius-card)] border border-border bg-surface object-contain"
    />
  );
}

const ProductThumbnail = memo(function ProductThumbnail({ row }) {
  const src = getProductThumbnail(row);
  const [colorPreviews, setColorPreviews] = useState(() => getProductColorPreviews(row));
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewPosition, setPreviewPosition] = useState(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const imageRef = useRef(null);
  const hoverActiveRef = useRef(false);

  useEffect(() => {
    setColorPreviews(getProductColorPreviews(row));
  }, [row]);

  useEffect(() => {
    setLoadFailed(false);
  }, [src]);

  const positionColorPreview = (previewCount = colorPreviews.length) => {
    if (!imageRef.current || typeof window === "undefined") return;
    const rect = imageRef.current.getBoundingClientRect();
    const columns = Math.min(4, Math.max(1, previewCount));
    const width = Math.max(176, columns * 82 + 24);
    const estimatedHeight = 54 + Math.ceil(Math.max(1, previewCount) / 4) * 88;
    const left = Math.min(Math.max(12, rect.left), Math.max(12, window.innerWidth - width - 12));
    const roomBelow = window.innerHeight - rect.bottom;
    setPreviewPosition({
      left,
      top: roomBelow >= estimatedHeight + 12 ? rect.bottom + 8 : Math.max(12, rect.top - estimatedHeight - 8),
      width,
    });
  };

  const showColorPreviews = async () => {
    hoverActiveRef.current = true;
    positionColorPreview();
    if (colorPreviews.length || previewLoading || !row?.id) return;

    const cacheKey = String(row.id);
    if (productColorHoverCache.has(cacheKey)) {
      const cached = productColorHoverCache.get(cacheKey);
      setColorPreviews(cached);
      positionColorPreview(cached.length);
      return;
    }

    try {
      setPreviewLoading(true);
      const result = await getProductsWithVariants({
        timeoutMs: REQUEST_TIMEOUT_MS,
        params: { productId: row.id },
      });
      const details = Array.isArray(result) ? result[0] : null;
      const loadedPreviews = getProductColorPreviews(details || {});
      productColorHoverCache.set(cacheKey, loadedPreviews);
      setColorPreviews(loadedPreviews);
      if (hoverActiveRef.current) positionColorPreview(loadedPreviews.length);
    } catch (error) {
      console.error("[products:list] color preview load failed", { productId: row.id, message: error?.message || String(error) });
    } finally {
      setPreviewLoading(false);
    }
  };

  const hideColorPreviews = () => {
    hoverActiveRef.current = false;
    setPreviewPosition(null);
  };

  if (!src) {
    return (
      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[var(--radius-card)] border border-border bg-surface-soft text-text-muted">
        <Package2 size={20} />
      </div>
    );
  }

  // A stored URL is not the same as a stored file: 139 catalog images point at
  // files the 2026-08-11 Cloudinary migration never wrote. Without this the row
  // fell back to the browser's broken-image glyph plus the alt text, which read
  // like a rendering quirk instead of missing data.
  if (loadFailed) {
    return (
      <div
        title={`الصورة غير موجودة على السيرفر: ${src}`}
        className="flex h-14 w-14 shrink-0 flex-col items-center justify-center gap-0.5 rounded-[var(--radius-card)] border border-red-300/30 bg-red-500/10 text-red-200"
      >
        <ImageOff size={18} />
        <span className="text-[8px] font-black leading-none">مفقودة</span>
      </div>
    );
  }

  return (
    <>
      <img
        ref={imageRef}
        src={src}
        alt={row?.name || "Product"}
        loading="lazy"
        onError={() => setLoadFailed(true)}
        onMouseEnter={showColorPreviews}
        onMouseLeave={hideColorPreviews}
        className="h-14 w-14 shrink-0 cursor-zoom-in rounded-[var(--radius-card)] border border-border bg-surface-soft object-cover"
      />
      {previewPosition && typeof document !== "undefined" ? createPortal(
        <div
          role="tooltip"
          className="pointer-events-none fixed z-[300] rounded-[var(--radius-card)] border border-border bg-surface p-3 shadow-2xl shadow-black/60 backdrop-blur-xl"
          style={{ left: previewPosition.left, top: previewPosition.top, width: previewPosition.width }}
        >
          <p className="mb-2 text-right text-[11px] font-black text-text-muted">
            {previewLoading ? "جاري تحميل صور الألوان..." : colorPreviews.length ? "صور ألوان المنتج" : "لا توجد صور ألوان"}
          </p>
          {colorPreviews.length ? <div
            className="grid gap-2"
            dir="rtl"
            style={{ gridTemplateColumns: `repeat(${Math.min(4, colorPreviews.length)}, minmax(0, 1fr))` }}
          >
            {colorPreviews.map((preview) => (
              <div key={`${preview.color}-${preview.imageUrl}`} className="min-w-0">
                <ColorPreviewImage
                  src={preview.imageUrl}
                  alt={`${row?.name || "Product"} - ${preview.color}`}
                />
                <p className="mt-1 truncate text-center text-[10px] font-bold text-text-muted" title={preview.color}>{preview.color}</p>
                <p className={`mt-0.5 text-center text-[10px] font-black ${preview.stock <= 0 ? "text-red-300" : preview.stock <= 2 ? "text-amber-300" : "text-emerald-300"}`}>
                  {preview.stock <= 0 ? "لم تُحدد كمية" : `${preview.stock} قبل الشراء`}
                </p>
                {preview.sizes?.length ? (
                  <div className="mt-1 flex flex-wrap justify-center gap-1">
                    {preview.sizes.map((size) => (
                      <span key={size.size} className={`rounded-[var(--radius-control)] px-1 py-0.5 text-[8px] font-black ${size.stock > 0 ? "bg-surface-soft text-text" : "bg-red-500/10 text-red-300"}`}>
                        {size.size}×{size.stock}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div> : null}
        </div>,
        document.body
      ) : null}
    </>
  );
});

function PriceEditorModal({ product, onClose, onSave }) {
  const { t } = useTranslation();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState(() => ({
    variants: (Array.isArray(product?.variants) ? product.variants : []).map((variant) => ({
      id: variant.id ?? variant.variant_id ?? variant.variantId,
      name: [variant.color, variant.size, variant.sku || variant.barcode].filter(Boolean).join(" / ") || `Variant ${variant.id ?? variant.variant_id ?? ""}`,
      current_sale_price: variantSalePriceValue(variant),
      current_discount_price: variantDiscountPriceValue(variant),
      sale_price: String(variantSalePriceValue(variant)),
      discount_price: variantDiscountPriceValue(variant),
    })),
  }));

  const validate = () => {
    const values = [
      ...form.variants.flatMap((variant) => [
        [`${variant.name} ${t("products.priceEditor.salePrice", "سعر البيع")}`, variant.sale_price],
        [`${variant.name} ${t("products.priceEditor.discountPrice", "سعر السيل")}`, variant.discount_price],
      ]),
    ];
    for (const [label, value] of values) {
      if (value === "" || value === null || value === undefined) continue;
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed < 0) return `${label}: ${t("products.priceEditor.nonNegative", "must be non-negative")}`;
    }
    return "";
  };

  const setVariant = (index, patch) => {
    setForm((prev) => ({
      ...prev,
      variants: prev.variants.map((variant, variantIndex) => (variantIndex === index ? { ...variant, ...patch } : variant)),
    }));
  };

  const submit = async () => {
    if (saving) return;
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onSave(product.id, {
        variant_only: true,
        variants: form.variants.map((variant) => ({
          id: variant.id,
          variant_sale_price: Number(variant.sale_price || 0),
          variant_discount_price: variant.discount_price === "" ? null : Number(variant.discount_price),
        })),
      });
    } catch (err) {
      setError(getErrorMessage(err, t("products.priceEditor.saveFailed", "Failed to update prices")));
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[100001] grid place-items-center bg-black/70 p-4 backdrop-blur">
      <div className="w-full max-w-2xl overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface shadow-2xl shadow-black/60">
        <div className="flex items-start justify-between gap-4 border-b border-border p-5">
          <div className="min-w-0">
            <p className="text-xs font-black uppercase tracking-[0.22em] text-emerald-300">{t("products.priceEditor.eyebrow", "تحديث الأسعار فقط")}</p>
            <h2 className="m1-section-title mt-1 truncate text-text">{t("products.actionsMenu.editPrices", "تعديل الأسعار")}</h2>
            <p className="mt-1 truncate text-sm text-text-muted">{product.name || product.product_name || `المنتج رقم ${product.id}`}</p>
          </div>
          <button type="button" onClick={onClose} disabled={saving} className="rounded-full border border-border bg-surface-soft p-2 text-text disabled:opacity-50">
            ×
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto p-5">
          {error ? <div className="mb-4 rounded-[var(--radius-card)] border border-red-400/30 bg-red-500/10 p-3 text-sm font-semibold text-red-100">{error}</div> : null}
          {form.variants.length ? (
            <div className="rounded-[var(--radius-card)] border border-border bg-surface-soft p-4">
              <div className="mb-3 text-sm font-black text-text">{t("products.priceEditor.variantPrices", "Variant prices")}</div>
              <div className="space-y-2">
                {form.variants.map((variant, index) => (
                  <div key={variant.id || index} className="grid gap-2 rounded-[var(--radius-card)] border border-border bg-black/20 p-3 md:grid-cols-[minmax(0,1fr)_9rem_9rem]">
                    <div className="min-w-0 self-center">
                      <div className="truncate text-sm font-black text-text">{variant.name}</div>
                      <div className="mt-1 text-xs text-text-muted">
                        {t("products.priceEditor.current", "الحالي")}: {formatPrice(variant.current_sale_price)}
                        {variant.current_discount_price !== "" ? ` / ${formatPrice(variant.current_discount_price)}` : ""}
                      </div>
                    </div>
                    <PriceField compact label={t("products.priceEditor.salePrice", "سعر البيع")} value={variant.sale_price} onChange={(value) => setVariant(index, { sale_price: value })} />
                    <PriceField compact label={t("products.priceEditor.discountPrice", "سعر السيل")} value={variant.discount_price} onChange={(value) => setVariant(index, { discount_price: value })} placeholder={t("products.priceEditor.empty", "فارغ")} />
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
        <div className="flex justify-end gap-2 border-t border-border p-4">
          <button type="button" onClick={onClose} disabled={saving} className="rounded-[var(--radius-control)] border border-border bg-surface-soft px-4 py-2 text-sm font-bold text-text disabled:opacity-50">{t("common.cancel")}</button>
          <button type="button" onClick={submit} disabled={saving} className="rounded-[var(--radius-control)] bg-primary px-4 py-2 text-sm font-black text-[var(--primary-contrast)] disabled:opacity-60">
            {saving ? t("products.priceEditor.saving", "جارٍ الحفظ...") : t("common.save", "حفظ")}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function formatPrice(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "0";
}

function PriceField({ label, value, onChange, current, placeholder = "", compact = false }) {
  const { t } = useTranslation();
  return (
    <label className="block">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-[10px] font-black uppercase tracking-[0.14em] text-text-muted">{label}</span>
        {current !== undefined ? <span className="text-[10px] font-semibold text-text-muted">{t("products.priceEditor.current")}: {current}</span> : null}
      </div>
      <input
        type="number"
        min="0"
        step="0.01"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className={`w-full rounded-[var(--radius-control)] border border-border bg-surface px-3 text-sm font-semibold text-text outline-none placeholder:text-text-muted focus:border-emerald-300/40 ${compact ? "h-[var(--control-height-md)]" : "h-[var(--control-height-lg)]"}`}
      />
    </label>
  );
}

function formatEditorCurrency(value) {
  const parsed = Number(value || 0);
  return `EGP ${new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(parsed) ? parsed : 0)}`;
}

function AdvancedPriceField({ label, value, onChange, onBlur, current, placeholder = "", compact = false, changed = false }) {
  const { t } = useTranslation();
  return (
    <label className="block">
      <div className={compact ? "sr-only" : "mb-1 flex items-center justify-between gap-2"}>
        <span className="text-[10px] font-black uppercase tracking-[0.14em] text-text-muted">{label}</span>
        {current !== undefined ? <span className="text-[10px] font-semibold text-text-muted">{t("products.priceEditor.current")}: {current}</span> : null}
      </div>
      <input
        type="number"
        min="0"
        step="0.01"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        aria-label={label}
        className={`w-full rounded-[var(--radius-control)] border px-3 text-sm font-semibold text-text outline-none placeholder:text-text-muted ${ changed ? "border-emerald-300/50 bg-emerald-400/10" : "border-border bg-surface" } focus:border-emerald-300/70 focus:ring-2 focus:ring-emerald-300/10 ${compact ? "h-[var(--control-height-md)]" : "h-[var(--control-height-md)]"}`}
      />
    </label>
  );
}

function EnhancedPriceEditorModal({ product, onClose, onSave, canEditPurchasePrice = false }) {
  const { t } = useTranslation();
  const isSimpleProduct = String(product?.variation_mode || "").trim().toLowerCase() === "simple" || !Array.isArray(product?.variants) || product.variants.length === 0;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [expandedColorKeys, setExpandedColorKeys] = useState(() => new Set());
  const [bulkSellingPrice, setBulkSellingPrice] = useState("");
  const [bulkSalePrice, setBulkSalePrice] = useState("");
  const [bulkPurchasePrice, setBulkPurchasePrice] = useState("");
  const [form, setForm] = useState(() => ({
    product: {
      current_sale_price: productSalePriceValue(product),
      current_discount_price: productDiscountPriceValue(product),
      current_purchase_price: productPurchasePriceValue(product),
      sale_price: String(productSalePriceValue(product)),
      discount_price: productDiscountPriceValue(product),
      purchase_price: String(productPurchasePriceValue(product)),
    },
    variants: (Array.isArray(product?.variants) ? product.variants : []).map((variant) => ({
      id: variant.id ?? variant.variant_id ?? variant.variantId,
      color: variant.color || variant.variant_color || "-",
      size: variant.size || variant.variant_size || "-",
      image: resolveProductImageUrl(firstImageValue(
        variant.image_url,
        variant.variant_image_url,
        variant.color_image_url,
        variant.image,
        variant.photo_url,
        variant.thumbnail_url,
        variant.images,
        variant.gallery_images,
        variant.color_images
      )),
      name: [variant.color, variant.size, variant.sku || variant.barcode].filter(Boolean).join(" / ") || `Variant ${variant.id ?? variant.variant_id ?? ""}`,
      current_sale_price: variantSalePriceValue(variant),
      current_discount_price: variantDiscountPriceValue(variant),
      current_purchase_price: variantPurchasePriceValue(variant),
      sale_price: String(variantSalePriceValue(variant)),
      discount_price: variantDiscountPriceValue(variant),
      purchase_price: String(variantPurchasePriceValue(variant)),
    })),
  }));

  const normalizePriceInput = (value, { nullable = false } = {}) => {
    if (value === "" || value === null || value === undefined) return nullable ? "" : "0";
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) return nullable ? "" : "0";
    return parsed.toFixed(2).replace(/\.00$/, "");
  };

  const changedVariantIds = useMemo(() => {
    const ids = new Set();
    form.variants.forEach((variant) => {
      const nextSale = Number(normalizePriceInput(variant.sale_price));
      const nextDiscount = variant.discount_price === "" ? "" : normalizePriceInput(variant.discount_price, { nullable: true });
      const currentDiscount = variant.current_discount_price === "" ? "" : normalizePriceInput(variant.current_discount_price, { nullable: true });
      const purchaseChanged = canEditPurchasePrice && Number(normalizePriceInput(variant.purchase_price)) !== Number(variant.current_purchase_price);
      if (purchaseChanged || Number(nextSale) !== Number(variant.current_sale_price) || (nextDiscount === "" ? 0 : Number(nextDiscount)) !== (currentDiscount === "" ? 0 : Number(currentDiscount))) ids.add(String(variant.id));
    });
    return ids;
  }, [form.variants]);

  const productPriceChanged = useMemo(() => {
    if (!isSimpleProduct) return false;
    const nextSale = Number(normalizePriceInput(form.product.sale_price));
    const nextDiscount = form.product.discount_price === "" ? 0 : Number(normalizePriceInput(form.product.discount_price, { nullable: true }));
    const currentDiscount = form.product.current_discount_price === "" ? 0 : Number(normalizePriceInput(form.product.current_discount_price, { nullable: true }));
    const purchaseChanged = canEditPurchasePrice && Number(normalizePriceInput(form.product.purchase_price)) !== Number(form.product.current_purchase_price);
    return purchaseChanged || Number(nextSale) !== Number(form.product.current_sale_price) || Number(nextDiscount) !== Number(currentDiscount);
  }, [form.product, isSimpleProduct]);

  const changedCount = changedVariantIds.size + (productPriceChanged ? 1 : 0);
  const colorGroups = useMemo(() => {
    const groups = new Map();
    form.variants.forEach((variant, index) => {
      const label = String(variant.color || "-").trim() || "-";
      const key = label.toLocaleLowerCase();
      const group = groups.get(key) || { key, label, image: variant.image || getProductThumbnail(product), variants: [] };
      if (!group.image && variant.image) group.image = variant.image;
      group.variants.push({ variant, index });
      groups.set(key, group);
    });
    return Array.from(groups.values()).map((group) => {
      const sellingPrices = new Set(group.variants.map(({ variant }) => String(variant.sale_price ?? "")));
      const discountPrices = new Set(group.variants.map(({ variant }) => String(variant.discount_price ?? "")));
      const purchasePrices = new Set(group.variants.map(({ variant }) => String(variant.purchase_price ?? "")));
      return {
        ...group,
        salePrice: sellingPrices.size === 1 ? group.variants[0].variant.sale_price : "",
        discountPrice: discountPrices.size === 1 ? group.variants[0].variant.discount_price : "",
        purchasePrice: purchasePrices.size === 1 ? group.variants[0].variant.purchase_price : "",
        hasMixedSalePrice: sellingPrices.size > 1,
        hasMixedDiscountPrice: discountPrices.size > 1,
        hasMixedPurchasePrice: purchasePrices.size > 1,
        changed: group.variants.some(({ variant }) => changedVariantIds.has(String(variant.id))),
      };
    });
  }, [changedVariantIds, form.variants, product]);

  const validate = () => {
    const values = [
      [t("products.priceEditor.bulkSellingPrice", "Bulk Selling Price"), bulkSellingPrice],
      [t("products.priceEditor.bulkSalePrice", "Bulk Sale Price"), bulkSalePrice],
      ...(canEditPurchasePrice ? [["سعر الشراء الجماعي", bulkPurchasePrice]] : []),
      ...(isSimpleProduct
        ? [
            [`${product.name || product.product_name || t("products.fields.product", "Product")} ${t("products.priceEditor.salePrice", "سعر البيع")}`, form.product.sale_price],
            [`${product.name || product.product_name || t("products.fields.product", "Product")} ${t("products.priceEditor.discountPrice", "سعر السيل")}`, form.product.discount_price],
          ]
        : []),
      ...form.variants.flatMap((variant) => [
        [`${variant.name} ${t("products.priceEditor.salePrice", "سعر البيع")}`, variant.sale_price],
        [`${variant.name} ${t("products.priceEditor.discountPrice", "سعر السيل")}`, variant.discount_price],
      ]),
    ];
    for (const [label, value] of values) {
      if (value === "" || value === null || value === undefined) continue;
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed < 0) return `${label}: ${t("products.priceEditor.nonNegative", "must be non-negative")}`;
    }
    return "";
  };

  const setVariant = (index, patch) => {
    setForm((prev) => ({
      ...prev,
      variants: prev.variants.map((variant, variantIndex) => (variantIndex === index ? { ...variant, ...patch } : variant)),
    }));
  };

  const setProductPrice = (patch) => {
    setForm((prev) => ({
      ...prev,
      product: { ...prev.product, ...patch },
    }));
  };

  const normalizeFormInputs = () => {
    setForm((prev) => ({
      ...prev,
      product: {
        ...prev.product,
        sale_price: normalizePriceInput(prev.product.sale_price),
        discount_price: normalizePriceInput(prev.product.discount_price, { nullable: true }),
        purchase_price: normalizePriceInput(prev.product.purchase_price),
      },
      variants: prev.variants.map((variant) => ({
        ...variant,
        sale_price: normalizePriceInput(variant.sale_price),
        discount_price: normalizePriceInput(variant.discount_price, { nullable: true }),
        purchase_price: normalizePriceInput(variant.purchase_price),
      })),
    }));
    setBulkSellingPrice((value) => normalizePriceInput(value, { nullable: true }));
    setBulkSalePrice((value) => normalizePriceInput(value, { nullable: true }));
    setBulkPurchasePrice((value) => normalizePriceInput(value, { nullable: true }));
  };

  const applyBulkPricesToVariants = () => {
    const nextSellingPrice = bulkSellingPrice === "" ? null : normalizePriceInput(bulkSellingPrice);
    const nextSalePrice = bulkSalePrice === "" ? null : normalizePriceInput(bulkSalePrice, { nullable: true });
    const nextPurchasePrice = canEditPurchasePrice && bulkPurchasePrice !== "" ? normalizePriceInput(bulkPurchasePrice) : null;
    if (nextSellingPrice === null && nextSalePrice === null && nextPurchasePrice === null) {
      setError(t("products.priceEditor.enterBulkPrice", "Enter a bulk price first"));
      return;
    }
    setError("");
    setForm((prev) => {
      if (isSimpleProduct) {
        return {
          ...prev,
          product: {
            ...prev.product,
            sale_price: nextSellingPrice === null ? prev.product.sale_price : nextSellingPrice,
            discount_price: nextSalePrice === null ? prev.product.discount_price : nextSalePrice,
            purchase_price: nextPurchasePrice === null ? prev.product.purchase_price : nextPurchasePrice,
          },
        };
      }
      return {
        ...prev,
        variants: prev.variants.map((variant) => ({
          ...variant,
          sale_price: nextSellingPrice === null ? variant.sale_price : nextSellingPrice,
          discount_price: nextSalePrice === null ? variant.discount_price : nextSalePrice,
          purchase_price: nextPurchasePrice === null ? variant.purchase_price : nextPurchasePrice,
        })),
      };
    });
  };

  const copyFirstVariantPriceToAll = () => {
    setForm((prev) => {
      const first = prev.variants[0];
      if (!first) return prev;
      return {
        ...prev,
        variants: prev.variants.map((variant) => ({
          ...variant,
          sale_price: normalizePriceInput(first.sale_price),
          discount_price: normalizePriceInput(first.discount_price, { nullable: true }),
        })),
      };
    });
  };

  const clearAllDiscounts = () => {
    setForm((prev) => ({
      ...prev,
      product: isSimpleProduct ? { ...prev.product, discount_price: "" } : prev.product,
      variants: prev.variants.map((variant) => ({ ...variant, discount_price: "" })),
    }));
    setBulkSalePrice("");
  };

  const submit = async () => {
    if (saving) return;
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    setSaving(true);
    setError("");
    try {
      const changedVariants = form.variants.filter((variant) => changedVariantIds.has(String(variant.id)));
      if (isSimpleProduct) {
        await onSave(product.id, {
          variant_only: false,
          manual_selling_price: Number(form.product.sale_price || 0),
          manual_price_override_active: true,
          discount_price: form.product.discount_price === "" ? null : Number(form.product.discount_price),
          ...(canEditPurchasePrice ? { purchase_price: Number(form.product.purchase_price || 0) } : {}),
        });
      } else {
        await onSave(product.id, {
          variant_only: true,
          variants: changedVariants.map((variant) => ({
            id: variant.id,
            manual_selling_price: Number(variant.sale_price || 0),
            manual_price_override_active: true,
            variant_discount_price: variant.discount_price === "" ? null : Number(variant.discount_price),
            ...(canEditPurchasePrice ? { purchase_price: Number(variant.purchase_price || 0) } : {}),
          })),
        });
      }
    } catch (err) {
      setError(getErrorMessage(err, t("products.priceEditor.saveFailed", "Failed to update prices")));
    } finally {
      setSaving(false);
    }
  };

  const setColorGroupPrice = (groupKey, patch) => {
    setForm((prev) => ({
      ...prev,
      variants: prev.variants.map((variant) =>
        String(variant.color || "-").trim().toLocaleLowerCase() === groupKey ? { ...variant, ...patch } : variant
      ),
    }));
  };

  const toggleColorGroup = (groupKey) => {
    setExpandedColorKeys((current) => {
      const next = new Set(current);
      if (next.has(groupKey)) next.delete(groupKey);
      else next.add(groupKey);
      return next;
    });
  };

  const clearManualOverrides = async () => {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      await onSave(product.id, isSimpleProduct
        ? { variant_only: false, manual_price_override_active: false }
        : { variant_only: true, variants: form.variants.map((variant) => ({ id: variant.id, manual_price_override_active: false })) });
    } catch (err) {
      setError(getErrorMessage(err, t("products.priceEditor.saveFailed", "Failed to update prices")));
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[100001] grid place-items-center bg-black/70 p-3 backdrop-blur"
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
        if (event.key === "Enter" && event.target?.tagName === "INPUT") {
          event.preventDefault();
          submit();
        }
      }}
    >
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface shadow-2xl shadow-black/60">
        <div className="flex items-start justify-between gap-4 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <p className="text-xs font-black uppercase tracking-[0.22em] text-emerald-300">{t("products.priceEditor.eyebrow", "Price-only update")}</p>
            <h2 className="m1-section-title mt-0.5 truncate text-text">{t("products.actionsMenu.editPrices", "تعديل الأسعار")}</h2>
            <p className="truncate text-sm text-text-muted">{product.name || product.product_name || `المنتج رقم ${product.id}`}</p>
          </div>
          <button type="button" onClick={onClose} disabled={saving} className="rounded-full border border-border bg-surface-soft p-2 text-text outline-none transition hover:bg-surface-hover focus:border-emerald-300/50 disabled:opacity-50">
            <X size={18} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {error ? <div className="mb-3 rounded-[var(--radius-control)] border border-red-400/30 bg-red-500/10 p-3 text-sm font-semibold text-red-100">{error}</div> : null}
          <div className="mb-3 rounded-[var(--radius-card)] border border-border bg-surface-soft p-3">
            <div className={`grid gap-2 md:items-end ${canEditPurchasePrice ? "md:grid-cols-[1fr_1fr_1fr_auto_auto_auto]" : "md:grid-cols-[1fr_1fr_auto_auto_auto]"}`}>
              {canEditPurchasePrice ? <AdvancedPriceField label={t("products.priceEditor.bulkPurchasePrice")} value={bulkPurchasePrice} onBlur={normalizeFormInputs} onChange={setBulkPurchasePrice} placeholder={t("products.priceEditor.empty", "Empty")} /> : null}
              <AdvancedPriceField label={t("products.priceEditor.bulkSellingPrice", "Bulk Selling Price")} value={bulkSellingPrice} onBlur={normalizeFormInputs} onChange={setBulkSellingPrice} placeholder={t("products.priceEditor.empty", "Empty")} />
              <AdvancedPriceField label={t("products.priceEditor.bulkSalePrice", "Bulk Sale Price")} value={bulkSalePrice} onBlur={normalizeFormInputs} onChange={setBulkSalePrice} placeholder={t("products.priceEditor.empty", "Empty")} />
              <button type="button" onClick={applyBulkPricesToVariants} disabled={!isSimpleProduct && !form.variants.length} className="h-[var(--control-height-md)] rounded-[var(--radius-control)] border border-emerald-300/25 bg-emerald-400/10 px-3 text-xs font-black text-emerald-100 outline-none hover:bg-emerald-400/15 focus:border-emerald-300/60 disabled:opacity-50">
                {isSimpleProduct ? t("products.priceEditor.applyToProduct", "Apply to product") : t("products.priceEditor.applyToAllVariants", "Apply to all variants")}
              </button>
              <button type="button" onClick={copyFirstVariantPriceToAll} disabled={!form.variants.length} className="h-[var(--control-height-md)] rounded-[var(--radius-control)] border border-border bg-surface-soft px-3 text-xs font-black text-text outline-none hover:bg-surface-hover focus:border-emerald-300/50 disabled:opacity-50">
                {t("products.priceEditor.copyFirstVariant", "Copy first variant price to all")}
              </button>
              <button type="button" onClick={clearAllDiscounts} disabled={!isSimpleProduct && !form.variants.length} className="h-[var(--control-height-md)] rounded-[var(--radius-control)] border border-border bg-surface-soft px-3 text-xs font-black text-text outline-none hover:bg-surface-hover focus:border-emerald-300/50 disabled:opacity-50">
                {t("products.priceEditor.clearDiscounts", "Clear all discount prices")}
              </button>
            </div>
          </div>
          {isSimpleProduct ? (
            <div className="mt-3 rounded-[var(--radius-card)] border border-border bg-surface-soft p-3">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="text-sm font-black text-text">{t("products.priceEditor.productPrices", "Product prices")}</div>
                <div className="text-xs font-semibold text-text-muted">{productPriceChanged ? t("products.priceEditor.changed", "changed") : t("products.priceEditor.noChanges", "No price changes")}</div>
              </div>
              <div className={productPriceChanged ? "grid gap-3 rounded-[var(--radius-control)] border border-emerald-300/30 bg-emerald-400/[0.06] p-3 md:grid-cols-3" : "grid gap-3 rounded-[var(--radius-control)] border border-border bg-black/10 p-3 md:grid-cols-3"}>
                {canEditPurchasePrice ? <AdvancedPriceField label={t("products.priceEditor.purchasePrice")} value={form.product.purchase_price} changed={productPriceChanged} current={formatPrice(form.product.current_purchase_price)} onBlur={normalizeFormInputs} onChange={(value) => setProductPrice({ purchase_price: value })} /> : null}
                <AdvancedPriceField label={t("products.priceEditor.salePrice", "سعر البيع")} value={form.product.sale_price} changed={productPriceChanged} current={formatPrice(form.product.current_sale_price)} onBlur={normalizeFormInputs} onChange={(value) => setProductPrice({ sale_price: value })} />
                <AdvancedPriceField label={t("products.priceEditor.discountPrice", "سعر السيل")} value={form.product.discount_price} changed={productPriceChanged} current={form.product.current_discount_price === "" ? t("products.priceEditor.empty", "Empty") : formatPrice(form.product.current_discount_price)} onBlur={normalizeFormInputs} onChange={(value) => setProductPrice({ discount_price: value })} placeholder={t("products.priceEditor.empty", "Empty")} />
              </div>
            </div>
          ) : null}
          {form.variants.length ? (
            <div className="mt-3 overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface-soft">
              <div className="flex items-center justify-between border-b border-border px-3 py-2">
                <div className="text-sm font-black text-text">{t("products.priceEditor.variantPrices", "Variant prices")}</div>
                <div className="text-xs font-semibold text-text-muted">{changedVariantIds.size} {t("products.priceEditor.changed", "changed")}</div>
              </div>
              <div className="max-h-[46vh] space-y-2 overflow-auto p-2">
                <div className={`hidden items-center gap-2 px-2 pb-1 text-[11px] font-black text-text-muted md:grid ${canEditPurchasePrice ? "md:grid-cols-[minmax(180px,1fr)_repeat(3,minmax(130px,180px))_auto]" : "md:grid-cols-[minmax(180px,1fr)_minmax(150px,190px)_minmax(150px,190px)_auto]"}`}>
                  <span>{t("products.fields.color")}</span>
                  {canEditPurchasePrice ? <span className="text-center">{t("products.priceEditor.purchasePrice")}</span> : null}
                  <span className="text-center">{t("products.priceEditor.salePrice")}</span>
                  <span className="text-center">{t("products.priceEditor.discountPrice")}</span>
                  <span aria-hidden="true" />
                </div>
                {colorGroups.map((group) => {
                  const expanded = expandedColorKeys.has(group.key);
                  return (
                    <section key={group.key} className={`overflow-hidden rounded-[var(--radius-card)] border ${group.changed ? "border-emerald-300/35 bg-emerald-400/[0.05]" : "border-border bg-black/15"}`}>
                      <div className={`grid items-center gap-2 p-2 ${canEditPurchasePrice ? "md:grid-cols-[minmax(180px,1fr)_repeat(3,minmax(130px,180px))_auto]" : "md:grid-cols-[minmax(180px,1fr)_minmax(150px,190px)_minmax(150px,190px)_auto]"}`}>
                        <button type="button" onClick={() => toggleColorGroup(group.key)} className="flex min-w-0 items-center gap-3 rounded-[var(--radius-control)] p-1 text-start outline-none hover:bg-surface-hover">
                          {group.image ? <img src={group.image} alt={group.label} className="h-14 w-14 shrink-0 rounded-[var(--radius-card)] border border-border bg-surface object-cover" /> : <span className="grid h-14 w-14 shrink-0 place-items-center rounded-[var(--radius-card)] border border-border bg-surface-soft text-text-muted"><Package2 size={20} /></span>}
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-black text-text">{group.label}</span>
                            <span className="mt-1 block text-xs font-semibold text-text-muted">{t("products.priceEditor.sizesCount", { count: group.variants.length })}</span>
                          </span>
                        </button>
                        {canEditPurchasePrice ? <AdvancedPriceField compact label={t("products.priceEditor.purchasePrice")} value={group.purchasePrice} changed={group.changed} onBlur={normalizeFormInputs} onChange={(value) => setColorGroupPrice(group.key, { purchase_price: value })} placeholder={group.hasMixedPurchasePrice ? t("products.priceEditor.mixedPrices") : t("products.priceEditor.empty", "Empty")} /> : null}
                        <AdvancedPriceField compact label={t("products.priceEditor.salePrice", "سعر البيع")} value={group.salePrice} changed={group.changed} onBlur={normalizeFormInputs} onChange={(value) => setColorGroupPrice(group.key, { sale_price: value })} placeholder={group.hasMixedSalePrice ? t("products.priceEditor.mixedPrices") : t("products.priceEditor.empty", "Empty")} />
                        <AdvancedPriceField compact label={t("products.priceEditor.discountPrice", "سعر السيل")} value={group.discountPrice} changed={group.changed} onBlur={normalizeFormInputs} onChange={(value) => setColorGroupPrice(group.key, { discount_price: value })} placeholder={group.hasMixedDiscountPrice ? t("products.priceEditor.mixedPrices") : t("products.priceEditor.empty", "Empty")} />
                        <button type="button" onClick={() => toggleColorGroup(group.key)} aria-expanded={expanded} className="grid h-[var(--control-height-md)] w-10 place-items-center rounded-[var(--radius-control)] border border-border bg-surface-soft text-text-muted transition hover:bg-surface-hover">
                          <ChevronDown size={18} className={`transition-transform ${expanded ? "rotate-180" : ""}`} />
                        </button>
                      </div>
                      {expanded ? (
                        <div className="border-t border-border bg-black/20 p-2">
                          <div className={`mb-2 grid gap-2 px-2 text-[10px] font-black uppercase tracking-[0.12em] text-text-muted ${canEditPurchasePrice ? "grid-cols-[5rem_1fr_1fr_1fr]" : "grid-cols-[5rem_1fr_1fr]"}`}>
                            <span>{t("products.fields.size", "Size")}</span>
                            {canEditPurchasePrice ? <span>{t("products.priceEditor.purchasePrice")}</span> : null}
                            <span>{t("products.priceEditor.salePrice", "سعر البيع")}</span>
                            <span>{t("products.priceEditor.discountPrice", "سعر السيل")}</span>
                          </div>
                          <div className="space-y-1.5">
                            {group.variants.map(({ variant, index }) => {
                              const changed = changedVariantIds.has(String(variant.id));
                              return (
                                <div key={variant.id || index} className={`grid items-center gap-2 rounded-[var(--radius-control)] p-2 ${canEditPurchasePrice ? "grid-cols-[5rem_1fr_1fr_1fr]" : "grid-cols-[5rem_1fr_1fr]"} ${changed ? "bg-emerald-400/[0.06]" : "bg-surface-soft"}`}>
                                  <span className="font-black text-text">{variant.size}</span>
                                  {canEditPurchasePrice ? <AdvancedPriceField compact label={t("products.priceEditor.purchasePrice")} value={variant.purchase_price} changed={changed} onBlur={normalizeFormInputs} onChange={(value) => setVariant(index, { purchase_price: value })} /> : null}
                                  <AdvancedPriceField compact label={t("products.priceEditor.salePrice", "سعر البيع")} value={variant.sale_price} changed={changed} onBlur={normalizeFormInputs} onChange={(value) => setVariant(index, { sale_price: value })} />
                                  <AdvancedPriceField compact label={t("products.priceEditor.discountPrice", "سعر السيل")} value={variant.discount_price} changed={changed} onBlur={normalizeFormInputs} onChange={(value) => setVariant(index, { discount_price: value })} placeholder={t("products.priceEditor.empty", "Empty")} />
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ) : null}
                    </section>
                  );
                })}
              </div>
              <div className="hidden">
                <table className="m1-table m1-table--compact min-w-full table-fixed text-left text-sm">
                  <thead className="sticky top-0 z-10 bg-surface text-[10px] uppercase tracking-[0.14em] text-text-muted backdrop-blur">
                    <tr>
                      <th className="w-28 px-3 py-2">{t("products.fields.color", "Color")}</th>
                      <th className="w-24 px-3 py-2">{t("products.fields.size", "Size")}</th>
                      <th className="w-44 px-3 py-2">{t("products.priceEditor.salePrice", "سعر البيع")}</th>
                      <th className="w-44 px-3 py-2">{t("products.priceEditor.discountPrice", "سعر السيل")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {form.variants.map((variant, index) => {
                      const changed = changedVariantIds.has(String(variant.id));
                      return (
                        <tr key={variant.id || index} className={changed ? "bg-emerald-400/[0.06]" : "bg-black/10"}>
                          <td className="px-3 py-2 font-semibold text-text" title={variant.name}>{variant.color}</td>
                          <td className="px-3 py-2 font-semibold text-text-muted">{variant.size}</td>
                          <td className="px-3 py-2">
                            <AdvancedPriceField compact label={t("products.priceEditor.salePrice", "سعر البيع")} value={variant.sale_price} changed={changed} onBlur={normalizeFormInputs} onChange={(value) => setVariant(index, { sale_price: value })} />
                          </td>
                          <td className="px-3 py-2">
                            <AdvancedPriceField compact label={t("products.priceEditor.discountPrice", "سعر السيل")} value={variant.discount_price} changed={changed} onBlur={normalizeFormInputs} onChange={(value) => setVariant(index, { discount_price: value })} placeholder={t("products.priceEditor.empty", "Empty")} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </div>
        <div className="sticky bottom-0 flex items-center justify-between gap-3 border-t border-border bg-surface px-4 py-3 backdrop-blur">
          <div className="text-xs font-semibold text-text-muted">
            {changedCount ? `${changedCount} ${t("products.priceEditor.changedRows", "changed price rows")}` : t("products.priceEditor.noChanges", "No price changes")}
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={clearManualOverrides} disabled={saving} className="rounded-[var(--radius-control)] border border-amber-300/30 bg-amber-400/10 px-4 py-2 text-sm font-bold text-amber-100 outline-none hover:bg-amber-400/15 disabled:opacity-50">{t("products.priceEditor.clearManualOverride", "إلغاء التعديل اليدوي")}</button>
            <button type="button" onClick={onClose} disabled={saving} className="rounded-[var(--radius-control)] border border-border bg-surface-soft px-4 py-2 text-sm font-bold text-text outline-none hover:bg-surface-hover focus:border-emerald-300/50 disabled:opacity-50">{t("common.cancel")}</button>
            <button type="button" onClick={submit} disabled={saving || !changedCount} className="rounded-[var(--radius-control)] bg-primary px-4 py-2 text-sm font-black text-[var(--primary-contrast)] outline-none hover:bg-primary focus:ring-2 focus:ring-emerald-300/40 disabled:opacity-60">
              {saving ? t("products.priceEditor.saving", "جارٍ الحفظ...") : t("common.save", "حفظ")}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

function ProductsList() {
  const { t, i18n } = useTranslation();
  const canViewCostPrice = canViewCostPrices();
  const navigate = useNavigate();

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [initialFilters] = useState(readProductsListFilters);
  const [catalogTab, setCatalogTab] = useState(initialFilters.catalogTab);
  const [statusFilter, setStatusFilter] = useState(initialFilters.status);
  const [colorImageFilter, setColorImageFilter] = useState(initialFilters.colorImageStatus);
  const [storefrontVisibilityFilter, setStorefrontVisibilityFilter] = useState(initialFilters.storefrontVisibility);
  const [classificationFilters, setClassificationFilters] = useState(initialFilters.classifications);
  const [brandFilter, setBrandFilter] = useState(initialFilters.brand);
  const [manufacturerFilter, setManufacturerFilter] = useState(initialFilters.manufacturer);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(getStoredProductsPageSize);
  const [pagination, setPagination] = useState({ page: 1, limit: 8, offset: 0, total: 0, totalPages: 1 });
  const [brandOptions, setBrandOptions] = useState(["all"]);
  const [manufacturerOptions, setManufacturerOptions] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [openActionId, setOpenActionId] = useState(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [actionMenuPosition, setActionMenuPosition] = useState(null);
  const [viewportWidth, setViewportWidth] = useState(() => (typeof window === "undefined" ? 0 : window.innerWidth));
  const [priceEditorProduct, setPriceEditorProduct] = useState(null);
  const [statusActionProduct, setStatusActionProduct] = useState(null);
  const [marketingEditorOpen, setMarketingEditorOpen] = useState(false);
  const [marketingEditorPost, setMarketingEditorPost] = useState(null);
  const [marketingSaving, setMarketingSaving] = useState(false);
  const [barcodeQueueDialogOpen, setBarcodeQueueDialogOpen] = useState(false);
  const [barcodeQueueDialogMode, setBarcodeQueueDialogMode] = useState("all");
  const [barcodeQueueDialogRegenerateExisting, setBarcodeQueueDialogRegenerateExisting] = useState(false);
  const [barcodeQueueDialogSelection, setBarcodeQueueDialogSelection] = useState({});
  const [barcodeQueueSubmitting, setBarcodeQueueSubmitting] = useState(false);
  const [barcodeQueueRows, setBarcodeQueueRows] = useState([]);
  const [reloadNonce, setReloadNonce] = useState(0);
  const actionMenuRef = useRef(null);
  const actionMenuTriggerRef = useRef(null);
  const filtersRef = useRef(null);
  const filtersTriggerRef = useRef(null);
  const productDetailsCacheRef = useRef(new Map());
  const latestProductsRequestRef = useRef(0);
  const canCreateMarketingPost = hasPermission("marketing.create");
  const canUpdateMarketingPost = hasPermission("marketing.update");
  const canPublishMarketingPost = hasPermission("marketing.publish");
  const { groups: classificationGroups } = useProductClassifications({ includeInactive: false });

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const updateViewportWidth = () => setViewportWidth(window.innerWidth);
    updateViewportWidth();
    window.addEventListener("resize", updateViewportWidth);
    return () => window.removeEventListener("resize", updateViewportWidth);
  }, []);

  useEffect(() => {
    storeProductsPageSize(pageSize);
  }, [pageSize]);

  useEffect(() => {
    writeProductsListFilters({
      catalogTab,
      status: statusFilter,
      colorImageStatus: colorImageFilter,
      storefrontVisibility: storefrontVisibilityFilter,
      brand: brandFilter,
      manufacturer: manufacturerFilter,
      classifications: classificationFilters,
    });
  }, [brandFilter, manufacturerFilter, catalogTab, classificationFilters, colorImageFilter, statusFilter, storefrontVisibilityFilter]);

  useEffect(() => {
    if (!openActionId) return undefined;
    const closeMenu = () => {
      setOpenActionId(null);
      setActionMenuPosition(null);
    };
    window.addEventListener("resize", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    return () => {
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
    };
  }, [openActionId]);

  useDismissableLayer({
    enabled: Boolean(openActionId),
    refs: [actionMenuRef, actionMenuTriggerRef],
    onDismiss: () => {
      setOpenActionId(null);
      setActionMenuPosition(null);
    },
  });

  useDismissableLayer({
    enabled: filtersOpen,
    refs: [filtersRef, filtersTriggerRef],
    onDismiss: () => setFiltersOpen(false),
  });

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const loadProductDetails = async (productId) => {
    const key = String(productId || "");
    if (!key) return null;
    if (productDetailsCacheRef.current.has(key)) return productDetailsCacheRef.current.get(key);

    const result = await getProductsWithVariants({
      timeoutMs: REQUEST_TIMEOUT_MS,
      params: { productId, refresh: Date.now() },
    });
    const product = Array.isArray(result) ? result[0] || null : null;
    if (product) productDetailsCacheRef.current.set(key, product);
    return product;
  };

  const loadMultipleProductDetails = async (productIds = []) => {
    const ids = [...new Set((Array.isArray(productIds) ? productIds : []).map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0))];
    if (!ids.length) return [];
    const results = await Promise.all(ids.map((productId) => loadProductDetails(productId)));
    return results.filter(Boolean);
  };

  const refreshProducts = () => {
    setRows([]);
    setReloadNonce((prev) => prev + 1);
  };

  const openProductColorImages = (event, row = {}) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    const { missingColorNames } = getColorImageStatusDetails(row);
    const params = new URLSearchParams({ focus: "colors" });
    if (missingColorNames.length) params.set("missingColors", missingColorNames.join("|"));
    navigate(`/products/${row.id}/edit?${params.toString()}`);
  };

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const requestId = latestProductsRequestRef.current + 1;
    latestProductsRequestRef.current = requestId;

    const loadProducts = async () => {
      try {
        setLoading(true);
        setError("");

        const refreshToken = Date.now();
        const productsResult = await getProductsAdminList({
          timeoutMs: REQUEST_TIMEOUT_MS,
          signal: controller.signal,
          params: {
            refresh: refreshToken,
            page,
            limit: pageSize,
            search: debouncedSearch,
            status: statusFilter,
            colorImageStatus: colorImageFilter,
            brand: brandFilter,
            manufacturer: manufacturerFilter,
            storefrontVisibility: storefrontVisibilityFilter,
            catalogTab,
            gender: classificationFilters.gender,
            productType: classificationFilters.productType,
            grade: classificationFilters.grade,
          },
        });
        if (cancelled || latestProductsRequestRef.current !== requestId) return;
        const baseProducts = Array.isArray(productsResult?.products) ? productsResult.products : [];
        const nextPagination = productsResult?.pagination || {};
        const apiBrands = Array.isArray(productsResult?.raw?.filters?.brands) ? productsResult.raw.filters.brands : [];
        const apiManufacturers = Array.isArray(productsResult?.raw?.filters?.manufacturers) ? productsResult.raw.filters.manufacturers : [];
        productDetailsCacheRef.current.clear();
        setRows(baseProducts);
        setPagination({
          page: Number(nextPagination.page || page) || 1,
          limit: Number(nextPagination.limit || pageSize) || pageSize,
          offset: Number(nextPagination.offset || 0) || 0,
          total: Number(nextPagination.total || 0) || 0,
          totalPages: Number(nextPagination.totalPages || 1) || 1,
        });
        setBrandOptions(["all", ...apiBrands.filter(Boolean)]);
        setManufacturerOptions(apiManufacturers.filter(Boolean));
      } catch (err) {
        if (cancelled || latestProductsRequestRef.current !== requestId) return;
        if (err?.name === "AbortError" || err?.name === "CanceledError" || String(err?.code || "") === "ERR_CANCELED") return;
        console.error("[products:list] load error", err);
        const message =
          String(err?.message || "").toLowerCase().includes("session expired")
            ? "Session expired. Please login again."
            : Number(err?.status || err?.responseBody?.status) === 401
              ? "Session expired. Please login again."
              : getErrorMessage(err, "Failed to load products");
        setError(message);
        toast.error(message);
      } finally {
        if (!cancelled && latestProductsRequestRef.current === requestId) {
          setLoading(false);
        }
      }
    };

    loadProducts();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    page,
    pageSize,
    debouncedSearch,
    statusFilter,
    colorImageFilter,
    brandFilter,
    manufacturerFilter,
    storefrontVisibilityFilter,
    catalogTab,
    classificationFilters.gender,
    classificationFilters.productType,
    classificationFilters.grade,
    reloadNonce,
    t,
  ]);

  // Thermal-level badges (productThermalImageUrl / thermalColorCount / thermalColorNames)
  // now come authoritatively from GET /products/admin-list, so the list no longer fetches
  // the full /products/with-variants payload once PER visible row just to hydrate them
  // (that was 8–24 heavy ~100KB requests on every page load / pagination). The server
  // computes the identical value; see thermalColorSourcesSql in productsController.
  useEffect(() => {
    const refetchProducts = () => {
      refreshProducts();
    };
    window.addEventListener("products:refetch", refetchProducts);
    return () => window.removeEventListener("products:refetch", refetchProducts);
  }, []);

  useEffect(() => {
    setSelectedIds((prev) => prev.filter((id) => rows.some((row) => row.id === id)));
  }, [rows]);

  // The server narrows the factory list to the other active filters, so a
  // previously picked factory can drop out of it. Release the selection instead
  // of leaving a filter applied whose chip is no longer on screen — that reads
  // as "no products" with nothing to click to undo it. Skip while the list is
  // empty: that is the pre-first-response state, not a real "no longer valid".
  useEffect(() => {
    if (!manufacturerOptions.length) return;
    if (manufacturerFilter === "all") return;
    if (manufacturerOptions.includes(manufacturerFilter)) return;
    setManufacturerFilter("all");
    setPage(1);
  }, [manufacturerOptions, manufacturerFilter]);

  const classificationOptions = useMemo(
    () => classificationGroupsToFieldOptions(classificationGroups, {}, { includeInactive: false, includeCurrentValue: false }),
    [classificationGroups]
  );

  const classificationFilterGroups = useMemo(() => {
    const locale = String(i18n.language || "").startsWith("en") ? "en" : "ar";
    return CLASSIFICATION_FILTER_FIELDS.map((group) => {
      const seen = new Set();
      const sourceOptions = group.key === "gender" ? PRODUCT_AUDIENCE_OPTIONS : (classificationOptions[group.key] || []);
      const options = sourceOptions.map((option) => {
        const value = normalizeClassificationValue(option.value);
        if (!value || seen.has(value)) return null;
        seen.add(value);
        return {
          value,
          label:
            locale === "en"
              ? option.label_en || option.label || option.value
              : option.label_ar || option.label || option.value,
        };
      }).filter(Boolean);

      return {
        ...group,
        label: t(group.labelKey, group.fallbackLabel),
        options,
      };
    }).filter((group) => group.options.length > 0);
  }, [classificationOptions, i18n.language, t]);

  const activeClassificationCount = useMemo(
    () => Object.values(classificationFilters).filter((value) => value && value !== "all").length,
    [classificationFilters]
  );

  const setClassificationGroupFilter = (key, value) => {
    setClassificationFilters((prev) => ({ ...prev, [key]: value }));
    setPage(1);
  };

  const setManufacturerGroupFilter = (value) => {
    setManufacturerFilter(value);
    setPage(1);
  };

  const clearClassificationFilters = () => {
    setClassificationFilters({
      gender: "all",
      productType: "all",
      grade: "all",
    });
    setManufacturerFilter("all");
    setPage(1);
  };

  // Manufacturer is not a product classification: its options come from the
  // server (admin-list `filters.manufacturers`) and it has its own state, so it
  // joins the rendered groups here rather than via CLASSIFICATION_FILTER_FIELDS.
  const filterGroups = useMemo(() => {
    const groups = classificationFilterGroups.map((group) => ({
      key: group.key,
      label: group.label,
      options: group.options,
      value: classificationFilters[group.key] || "all",
      onSelect: (value) => setClassificationGroupFilter(group.key, value),
    }));
    if (manufacturerOptions.length) {
      groups.push({
        key: "manufacturer",
        label: t("products.filters.manufacturer", "Manufacturer"),
        options: manufacturerOptions.map((name) => ({ value: name, label: name })),
        value: manufacturerFilter || "all",
        onSelect: setManufacturerGroupFilter,
      });
    }
    return groups;
  }, [classificationFilterGroups, classificationFilters, manufacturerFilter, manufacturerOptions, t]);

  const activeFilterCount = activeClassificationCount + (manufacturerFilter && manufacturerFilter !== "all" ? 1 : 0);

  const hasAnyStoredFilter =
    catalogTab !== DEFAULT_PRODUCTS_LIST_FILTERS.catalogTab ||
    statusFilter !== "all" ||
    colorImageFilter !== "all" ||
    storefrontVisibilityFilter !== "all" ||
    brandFilter !== "all" ||
    activeFilterCount > 0;

  const clearAllProductFilters = () => {
    setCatalogTab(DEFAULT_PRODUCTS_LIST_FILTERS.catalogTab);
    setStatusFilter("all");
    setColorImageFilter("all");
    setStorefrontVisibilityFilter("all");
    setBrandFilter("all");
    setManufacturerFilter(DEFAULT_PRODUCTS_LIST_FILTERS.manufacturer);
    setClassificationFilters({ ...DEFAULT_PRODUCTS_LIST_FILTERS.classifications });
    removeStoredProductsListFilters();
    setPage(1);
  };

  const totalPages = Math.max(1, Number(pagination.totalPages || 1) || 1);
  const currentPage = Math.min(page, totalPages);
  const visibleRows = rows;

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  const selectedCount = selectedIds.length;
  const selectedRows = useMemo(
    () => rows.filter((row) => selectedIds.includes(row.id)),
    [rows, selectedIds]
  );

  const toggleSelected = (id) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const toggleAll = () => {
    const visibleIds = visibleRows.map((row) => row.id);
    const allSelected = visibleIds.every((id) => selectedIds.includes(id));
    setSelectedIds((prev) =>
      allSelected
        ? prev.filter((id) => !visibleIds.includes(id))
        : Array.from(new Set([...prev, ...visibleIds]))
    );
  };

  const updateLocalStatus = (id, active) => {
    const item = rows.find((row) => row.id === id);
    if (!item) return;
    const status = active ? "active" : "inactive";
    upsertProductMeta({ ...item, active, is_active: active, status });
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, active, is_active: active, status } : row)));
    setSelectedProduct((prev) => (prev?.id === id ? { ...prev, active, is_active: active, status } : prev));
  };

  const updateLocalOfferStory = (id, snapshotOrValue) => {
    const item = rows.find((row) => row.id === id);
    if (!item) return;
    const nextIsOfferStory =
      snapshotOrValue && typeof snapshotOrValue === "object"
        ? snapshotOrValue.is_offer_story === true || String(snapshotOrValue.is_offer_story || "").trim().toLowerCase() === "true"
        : Boolean(snapshotOrValue);
    const nextVisible =
      snapshotOrValue && typeof snapshotOrValue === "object"
        ? snapshotOrValue.is_storefront_visible === true ||
          String(snapshotOrValue.is_storefront_visible ?? "").trim().toLowerCase() === "true" ||
          snapshotOrValue.is_storefront_visible === undefined ||
          snapshotOrValue.is_storefront_visible === null ||
          snapshotOrValue.is_storefront_visible === ""
        : item.is_storefront_visible;
    const nextActive =
      snapshotOrValue && typeof snapshotOrValue === "object"
        ? snapshotOrValue.active === true || snapshotOrValue.is_active === true
        : item.active;
    const nextName = snapshotOrValue && typeof snapshotOrValue === "object" ? snapshotOrValue.name || item.name : item.name;
    const nextRow = {
      ...item,
      ...(snapshotOrValue && typeof snapshotOrValue === "object" ? snapshotOrValue : {}),
      name: nextName,
      is_offer_story: nextIsOfferStory,
      is_storefront_visible: nextVisible,
      active: nextActive,
      is_active: nextActive,
    };
    setRows((prev) => prev.map((row) => (row.id === id ? nextRow : row)));
    setSelectedProduct((prev) => (prev?.id === id ? { ...prev, ...nextRow } : prev));
  };

  const updateLocalStorefrontVisibility = (id, isStorefrontVisible) => {
    const item = rows.find((row) => row.id === id);
    if (!item) return;
    upsertProductMeta({ ...item, is_storefront_visible: isStorefrontVisible });
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, is_storefront_visible: isStorefrontVisible } : row)));
    setSelectedProduct((prev) => (prev?.id === id ? { ...prev, is_storefront_visible: isStorefrontVisible } : prev));
  };

  const updateLocalPosFavorite = (id, snapshotOrValue) => {
    const item = rows.find((row) => row.id === id);
    if (!item) return;
    const nextIsPosFavorite =
      snapshotOrValue && typeof snapshotOrValue === "object"
        ? snapshotOrValue.is_pos_favorite === true || String(snapshotOrValue.is_pos_favorite || "").trim().toLowerCase() === "true"
        : Boolean(snapshotOrValue);
    const nextRow = {
      ...item,
      ...(snapshotOrValue && typeof snapshotOrValue === "object" ? snapshotOrValue : {}),
      is_pos_favorite: nextIsPosFavorite,
    };
    upsertProductMeta(nextRow);
    setRows((prev) => prev.map((row) => (row.id === id ? nextRow : row)));
    setSelectedProduct((prev) => (prev?.id === id ? { ...prev, ...nextRow } : prev));
  };

  const requestProductStatusToggle = (row) => {
    setOpenActionId(null);
    setActionMenuPosition(null);
    if (!isStatusToggleableProduct(row)) {
      toast.error(t("products.toasts.statusToggleUnavailable", "Draft, archived, and deleted products keep their own status workflow."));
      return;
    }
    setStatusActionProduct(row);
  };

  const handleConfirmProductStatusToggle = async () => {
    const row = statusActionProduct;
    if (!row?.id) return;
    const nextActive = isInactiveProduct(row);
    const nextStatus = nextActive ? "active" : "inactive";

    try {
      await updateProductStatus(row.id, { status: nextStatus, is_active: nextActive });
      updateLocalStatus(row.id, nextActive);
      setStatusActionProduct(null);
      toast.success(
        nextActive
          ? t("products.toasts.productActivated", "Product activated")
          : t("products.toasts.productDeactivated", "Product deactivated")
      );
      refreshProducts();
    } catch (err) {
      console.error("[products:list] status toggle failed", err);
      toast.error(err?.responseBody?.message || err?.message || t("products.toasts.statusUpdateFailed", "Failed to update product status"));
      refreshProducts();
    }
  };

  const handleToggleOfferStory = async (row) => {
    if (!row?.id) return;
    const nextOfferStory = !row.is_offer_story;
    try {
      const response = await updateProductStatus(row.id, { is_offer_story: nextOfferStory });
      const snapshot = response?.db_snapshot || response?.product || response?.data || response || null;
      console.log("[products:list] offer story update response", { rowId: row.id, response, snapshot });
      updateLocalOfferStory(row.id, snapshot || nextOfferStory);
      toast.success(nextOfferStory ? t("products.toasts.addedToOffers", "Added to offers") : t("products.toasts.removedFromOffers", "Removed from offers"));
      refreshProducts();
    } catch (err) {
      console.error("[products:list] offer story toggle failed", err);
      toast.error(err?.responseBody?.message || err?.message || t("products.toasts.offerStoryUpdateFailed", "Failed to update offers"));
      refreshProducts();
    }
  };

  const handleTogglePosFavorite = async (row) => {
    if (!row?.id) return;
    const nextPosFavorite = !row.is_pos_favorite;
    try {
      const response = await toggleProductPosFavorite(row.id, nextPosFavorite);
      const snapshot = response?.db_snapshot || response?.product || response?.data || response || null;
      updateLocalPosFavorite(row.id, snapshot || nextPosFavorite);
      toast.success(nextPosFavorite ? "تمت الإضافة إلى مفضلة الـPOS" : "تمت الإزالة من مفضلة الـPOS");
      refreshProducts();
    } catch (err) {
      console.error("[products:list] pos favorite toggle failed", err);
      toast.error(err?.responseBody?.message || err?.message || "Failed to update POS favorites");
      refreshProducts();
    }
  };

  const handleBulkStorefrontVisibility = async (isStorefrontVisible) => {
    const selectedRows = rows.filter((row) => selectedIds.includes(row.id));
    if (!selectedRows.length) return;

    try {
      await Promise.all(selectedRows.map((row) => updateProductStatus(row.id, { is_storefront_visible: isStorefrontVisible })));
      selectedRows.forEach((row) => updateLocalStorefrontVisibility(row.id, isStorefrontVisible));
      toast.success(
        isStorefrontVisible
          ? t("products.toasts.storefrontVisible", "Shown on storefront")
          : t("products.toasts.storefrontHidden", "Hidden from storefront")
      );
      refreshProducts();
    } catch (err) {
      console.error("[products:list] storefront visibility bulk update failed", err);
      toast.error(err?.responseBody?.message || err?.message || t("products.toasts.storefrontVisibilityUpdateFailed", "Failed to update storefront visibility"));
      refreshProducts();
    }
  };

  const handleDuplicate = async (row) => {
    setOpenActionId(null);
    try {
      const detailedRow = await loadProductDetails(row.id);
      const sourceRow = detailedRow || row;
      const product = await createProduct(duplicateProductPayload(sourceRow));

      if (product?.id) {
        upsertProductMeta({
          id: product.id,
          name: product.name || `${row.name} Copy`,
          slug: product.slug || "",
          sku: generateSku(`${row.name} Copy`, product.id),
          category_id: row.category_id || "",
          brand_id: row.brand_id || "",
          main_image_url: "",
          updated_at: new Date().toISOString(),
          active: row.active,
          status: row.status,
        });
      }

      toast.success(t("products.toasts.productDuplicated", "Product duplicated successfully"));
      refreshProducts();
    } catch (err) {
      console.log(err);
      if (isQuotaExceeded(err)) {
        cleanupProductCache();
        toast.error(t("products.toasts.duplicateQuotaFailed", "Could not duplicate the product because temporary storage was full. Cache was cleaned; try again."));
      } else {
        toast.error(err?.message || t("common.noData"));
      }
    }
  };

  const handleOpenPriceEditor = async (row) => {
    setOpenActionId(null);
    setActionMenuPosition(null);
    try {
      const detailedRow = await loadProductDetails(row.id);
      setPriceEditorProduct(detailedRow || row);
    } catch (err) {
      toast.error(err?.message || t("products.priceEditor.loadFailed", "Failed to load product pricing details"));
    }
  };

  const handleOpenSelectedProduct = async (row) => {
    try {
      const detailedRow = await loadProductDetails(row.id);
      setSelectedProduct(detailedRow || row);
    } catch (err) {
      toast.error(err?.message || t("products.details.loadFailed", "Failed to load product details"));
    }
  };

  const handleOpenStock = (row) => {
    console.log("[products:list] action click", { action: "stock", productId: row.id });
    navigate(`/inventory/adjustments?productId=${encodeURIComponent(row.id)}`);
    setOpenActionId(null);
    setActionMenuPosition(null);
  };

  const handlePrintBarcode = (row) => {
    console.log("[products:list] action click", { action: "print-barcode", productId: row.id });
    navigate(`/products/barcode-labels?productId=${encodeURIComponent(row.id)}&availableOnly=true`);
    setOpenActionId(null);
    setActionMenuPosition(null);
  };

  const handleAddToProductPrintList = async (row) => {
    try {
      const detailedRow = await loadProductDetails(row.id);
      addProductsToPrintList([detailedRow || row]);
      toast.success(t("products.printList.added"));
      setOpenActionId(null);
      setActionMenuPosition(null);
    } catch (error) {
      toast.error(error?.message || "تعذر إضافة المنتج إلى قائمة الطباعة");
    }
  };

  const handleOpenBarcodeShop = (row) => {
    console.log("[products:list] action click", { action: "barcode-shop", productId: row.id });
    navigate(`/products/labels?mode=barcode-shop&productId=${encodeURIComponent(row.id)}`);
    setOpenActionId(null);
    setActionMenuPosition(null);
  };

  const handleQuickMarketingAction = (row) => {
    if (canCreateMarketingPost) {
      console.log("[products:list] action click", { action: "generate-marketing-post", productId: row.id });
      handleGenerateMarketingPost(row);
      setOpenActionId(null);
      return;
    }
    if (canPublishMarketingPost) {
      console.log("[products:list] action click", { action: "generate-fast-story", productId: row.id });
      handlePublishProductStory(row);
      setOpenActionId(null);
      return;
    }
    toast.error(t("products.marketing.noCreatePermission", "You do not have permission to create marketing posts."));
  };

  const getRowActions = (row, statusToggleLabel) => {
    const actions = [
      {
        key: "view",
        icon: Eye,
        label: t("products.actionsMenu.view", "عرض"),
        placement: "dropdown",
        href: `/products/${row.id}`,
        onClick: () => {
          console.log("[products:list] action click", { action: "view", productId: row.id });
          navigate(`/products/${row.id}`);
          setOpenActionId(null);
        },
      },
      {
        key: "edit",
        icon: Pencil,
        label: t("products.actionsMenu.edit", "تعديل"),
        placement: "primary",
        visibleFrom: "lg",
        href: `/products/${row.id}/edit`,
        onClick: () => {
          console.log("[products:list] action click", { action: "edit", productId: row.id });
          navigate(`/products/${row.id}/edit`);
          setOpenActionId(null);
        },
      },
      {
        key: "advanced-pricing",
        icon: BadgeDollarSign,
        label: t("products.actionsMenu.editPrices", "تعديل الأسعار"),
        inlineLabel: t("products.actionsMenu.prices", "الأسعار"),
        placement: "primary",
        visibleFrom: "lg",
        onClick: () => {
          console.log("[products:list] action click", { action: "edit-prices", productId: row.id });
          handleOpenPriceEditor(row);
        },
      },
      {
        key: "stock",
        icon: PackageSearch,
        label: t("products.actionsMenu.stock", "المخزون"),
        placement: "primary",
        visibleFrom: "lg",
        href: `/inventory/adjustments?productId=${encodeURIComponent(row.id)}`,
        onClick: () => handleOpenStock(row),
      },
      {
        key: "print-barcode",
        icon: Barcode,
        label: t("products.actionsMenu.printBarcode", "طباعة الباركود"),
        inlineLabel: t("products.actionsMenu.barcode", "الباركود"),
        placement: "primary",
        visibleFrom: "xl",
        className: "hidden xl:inline-flex",
        href: `/products/barcode-labels?productId=${encodeURIComponent(row.id)}&availableOnly=true`,
        onClick: () => handlePrintBarcode(row),
      },
      {
        key: "barcode-shop",
        icon: Barcode,
        label: t("products.actionsMenu.barcodeShop", "باركود المنتج"),
        placement: "dropdown",
        href: `/products/labels?mode=barcode-shop&productId=${encodeURIComponent(row.id)}`,
        onClick: () => handleOpenBarcodeShop(row),
      },
      {
        key: "add-to-print-list",
        icon: Printer,
        label: t("products.printList.addAction"),
        placement: "dropdown",
        onClick: () => handleAddToProductPrintList(row),
      },
      {
        key: canCreateMarketingPost ? "generate-marketing-post" : canPublishMarketingPost ? "generate-fast-story" : "marketing-story",
        icon: canCreateMarketingPost ? Megaphone : Zap,
        label: canCreateMarketingPost
          ? t("products.actionsMenu.generateMarketingPost", "إنشاء منشور تسويقي")
          : canPublishMarketingPost
            ? t("products.actionsMenu.generateFastStory", "إنشاء قصة سريعة")
            : t("products.actionsMenu.marketing", "التسويق"),
        placement: "primary",
        visibleFrom: "2xl",
        className: "hidden 2xl:inline-flex",
        disabled: !canCreateMarketingPost && !canPublishMarketingPost,
        onClick: () => handleQuickMarketingAction(row),
      },
      {
        key: "duplicate",
        icon: Copy,
        label: t("products.actionsMenu.duplicate", "نسخ"),
        placement: "dropdown",
        onClick: () => {
          console.log("[products:list] action click", { action: "duplicate", productId: row.id });
          handleDuplicate(row);
          setOpenActionId(null);
        },
      },
      {
        key: "toggle-pos-favorite",
        icon: Star,
        label: row.is_pos_favorite ? "إزالة من مفضلة الـPOS" : "إضافة إلى مفضلة الـPOS",
        placement: "dropdown",
        onClick: () => {
          console.log("[products:list] action click", { action: "toggle-pos-favorite", productId: row.id, is_pos_favorite: row.is_pos_favorite });
          setOpenActionId(null);
          setActionMenuPosition(null);
          handleTogglePosFavorite(row);
        },
      },
      {
        key: "toggle-status",
        icon: Power,
        label: statusToggleLabel,
        placement: "dropdown",
        onClick: () => requestProductStatusToggle(row),
      },
      {
        key: "toggle-offer-story",
        icon: Tag,
        label: isOfferStoryValue(row)
          ? t("products.actionsMenu.removeFromOffers", "إزالة من العروض")
          : t("products.actionsMenu.addToOffers", "إضافة للعروض"),
        placement: "dropdown",
        onClick: () => {
          console.log("[products:list] action click", { action: "toggle-offer-story", productId: row.id, is_offer_story: isOfferStoryValue(row) });
          setOpenActionId(null);
          setActionMenuPosition(null);
          handleToggleOfferStory(row);
        },
      },
      {
        key: "generate-marketing-post",
        icon: Megaphone,
        label: t("products.actionsMenu.generateMarketingPost", "إنشاء منشور تسويقي"),
        placement: "dropdown",
        hidden: !canCreateMarketingPost,
        onClick: () => {
          console.log("[products:list] action click", { action: "generate-marketing-post", productId: row.id });
          handleGenerateMarketingPost(row);
          setOpenActionId(null);
        },
      },
      {
        key: "generate-fast-story",
        icon: Zap,
        label: t("products.actionsMenu.generateFastStory", "إنشاء قصة سريعة"),
        placement: "dropdown",
        hidden: !canPublishMarketingPost,
        onClick: () => {
          console.log("[products:list] action click", { action: "generate-fast-story", productId: row.id });
          handlePublishProductStory(row);
          setOpenActionId(null);
        },
      },
      {
        key: "schedule-story",
        icon: CalendarClock,
        label: t("products.actionsMenu.scheduleStory", "جدولة القصة"),
        placement: "dropdown",
        hidden: !canUpdateMarketingPost,
        onClick: () => {
          console.log("[products:list] action click", { action: "schedule-story", productId: row.id });
          handleScheduleProductStory(row);
          setOpenActionId(null);
        },
      },
      {
        key: "delete",
        icon: Trash2,
        label: t("products.actionsMenu.delete", "حذف"),
        placement: "dropdown",
        tone: "danger",
        onClick: () => {
          console.log("[products:list] action click", { action: "delete", productId: row.id });
          handleDelete(row.id);
          setOpenActionId(null);
        },
      },
    ];

    const inlineActions = actions.filter((action) => action.placement === "primary" && !action.hidden);
    const visibleInlineKeys = new Set(
      inlineActions
        .filter((action) => isInlineRowActionVisible(action, viewportWidth))
        .map((action) => action.key)
    );
    const dropdownActions = actions.filter((action) => !action.hidden && !visibleInlineKeys.has(action.key));

    return { inlineActions, dropdownActions };
  };

  const handleSavePrices = async (productId, payload) => {
    await updateProductPrices(productId, payload);
    toast.success(t("products.priceEditor.saved", "Prices updated"));
    setPriceEditorProduct(null);
    refreshProducts();
  };

  const handleDelete = async (id) => {
    if (!window.confirm(t("products.actions.confirmDelete"))) return;

    try {
      const result = await deleteProduct(id);
      removeProductMeta(id);
      toast.success(result?.message || t("products.actionsMenu.delete", "حذف"));
      setSelectedIds((prev) => prev.filter((item) => item !== id));
      setSelectedProduct((prev) => (prev?.id === id ? null : prev));
      refreshProducts();
    } catch (err) {
      console.log(err);
      toast.error(err?.responseBody?.message || err?.message || t("products.toasts.deleteFailed", "Failed to delete product"));
      refreshProducts();
    }
  };

  const handleGenerateMarketingPost = async (product) => {
    if (!canCreateMarketingPost) {
      toast.error(t("products.marketing.noCreatePermission", "You do not have permission to create marketing posts."));
      return;
    }

    try {
      setMarketingSaving(true);
      const generated = await generateProductMarketingPost(product.id);
      setMarketingEditorPost(generated);
      setMarketingEditorOpen(true);
      toast.success(t("products.actionsMenu.generateMarketingPost", "إنشاء منشور تسويقي"));
    } catch (err) {
      console.error(err);
      const message = Number(err?.status || err?.responseBody?.status) === 403
        ? t("products.marketing.noCreatePermission", "You do not have permission to create marketing posts.")
        : err?.message || t("common.noData");
      toast.error(message);
    } finally {
      setMarketingSaving(false);
    }
  };

  const handlePublishProductStory = async (product) => {
    if (!canPublishMarketingPost) {
      toast.error(t("products.marketing.noPublishPermission", "You do not have permission to publish marketing posts."));
      return;
    }
    try {
      setMarketingSaving(true);
      const result = await publishProductStoryEverywhere(product.id);
      if (result?.story_status === "failed") toast.error(result.story_error_message || t("products.marketing.storyPublishFailed", "Story publish failed"));
      else toast.success(t("products.marketing.storyPublishCompleted", "Story publish completed"));
      refreshProducts();
    } catch (err) {
      toast.error(err?.message || t("common.noData"));
    } finally {
      setMarketingSaving(false);
    }
  };

  const handleScheduleProductStory = async (product) => {
    if (!canUpdateMarketingPost) {
      toast.error(t("products.marketing.noUpdatePermission", "You do not have permission to update marketing posts."));
      return;
    }
    const scheduledAt = window.prompt(t("products.marketing.schedulePrompt", "Schedule story date/time (YYYY-MM-DDTHH:mm)"), new Date(Date.now() + 2 * 60 * 1000).toISOString().slice(0, 16));
    if (!scheduledAt) return;
    try {
      setMarketingSaving(true);
      await scheduleProductStoryEverywhere(product.id, { scheduled_at: scheduledAt });
      toast.success(t("products.marketing.storyScheduled", "Story scheduled"));
      refreshProducts();
    } catch (err) {
      toast.error(err?.message || t("common.noData"));
    } finally {
      setMarketingSaving(false);
    }
  };

  const handleSaveMarketingDraft = async (payload) => {
    if (marketingEditorPost?.id ? !canUpdateMarketingPost : !canCreateMarketingPost) {
      toast.error(t("products.marketing.noCreatePermission", "You do not have permission to create marketing posts."));
      return;
    }

    try {
      setMarketingSaving(true);
      if (marketingEditorPost?.id) {
        await updateMarketingPost(marketingEditorPost.id, payload);
      } else {
        await createMarketingPost({ ...payload, status: "draft" });
      }
      toast.success(t("common.update"));
      setMarketingEditorOpen(false);
      refreshProducts();
    } catch (err) {
      toast.error(err?.message || t("common.noData"));
    } finally {
      setMarketingSaving(false);
    }
  };

  const handlePublishMarketingPost = async (payload) => {
    if (!canPublishMarketingPost) {
      toast.error(t("products.marketing.noPublishPermission", "You do not have permission to publish marketing posts."));
      return;
    }

    try {
      setMarketingSaving(true);
      const publishPayload = { ...payload, channel: "all" };
      const saved = marketingEditorPost?.id
        ? await updateMarketingPost(marketingEditorPost.id, publishPayload)
        : await createMarketingPost({ ...publishPayload, status: "draft" });
      const published = await publishMarketingPost(saved.id);
      if (published?.status === "failed") {
        toast.error(published.error_message || t("products.marketing.metaNotConnected", "Meta account is not connected yet."));
        return;
      }
      if (published?.status === "partial_success") {
        toast.error(published.error_message || "تم النشر على منصة واحدة وتعذر النشر على المنصة الأخرى.");
        setMarketingEditorOpen(false);
        refreshProducts();
        return;
      }
      toast.success(t("common.update"));
      setMarketingEditorOpen(false);
      refreshProducts();
    } catch (err) {
      toast.error(err?.message || t("common.noData"));
    } finally {
      setMarketingSaving(false);
    }
  };

  const handleScheduleMarketingPost = async (payload, scheduledAt) => {
    if (!canUpdateMarketingPost) {
      toast.error(t("products.marketing.noUpdatePermission", "You do not have permission to update marketing posts."));
      return;
    }

    try {
      setMarketingSaving(true);
      const saved = marketingEditorPost?.id
        ? await updateMarketingPost(marketingEditorPost.id, payload)
        : await createMarketingPost({ ...payload, status: "draft" });
      await scheduleMarketingPost(saved.id, { scheduled_at: scheduledAt });
      toast.success(t("common.update"));
      setMarketingEditorOpen(false);
      refreshProducts();
    } catch (err) {
      toast.error(err?.message || t("common.noData"));
    } finally {
      setMarketingSaving(false);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.length === 0) return;
    if (!window.confirm(t("products.actions.confirmDeleteMultiple"))) return;

    try {
      const results = await Promise.all(selectedIds.map((id) => deleteProduct(id)));
      selectedIds.forEach((id) => removeProductMeta(id));
      const archivedCount = results.filter((result) => result?.status === "soft_deleted" || result?.action === "soft_deleted").length;
      const deletedCount = results.length - archivedCount;
      toast.success(
        archivedCount && deletedCount
          ? `${deletedCount} deleted, ${archivedCount} archived`
          : archivedCount
            ? `${archivedCount} product${archivedCount === 1 ? "" : "s"} archived`
            : t("products.actionsMenu.delete", "حذف")
      );
      setSelectedIds([]);
      refreshProducts();
    } catch (err) {
      console.log(err);
      toast.error(err?.responseBody?.message || err?.message || t("products.toasts.deleteFailed", "Failed to delete product"));
      refreshProducts();
    }
  };

  const handleBulkStatus = async (active) => {
    const toggleableRows = selectedRows.filter(isStatusToggleableProduct);
    if (!toggleableRows.length) {
      toast.error(t("products.toasts.statusToggleUnavailable", "Draft, archived, and deleted products keep their own status workflow."));
      return;
    }

    try {
      const status = active ? "active" : "inactive";
      await Promise.all(toggleableRows.map((row) => updateProductStatus(row.id, { status, is_active: active })));
      toggleableRows.forEach((row) => updateLocalStatus(row.id, active));
      toast.success(
        active
          ? t("products.toasts.productsActivated", "Products activated")
          : t("products.toasts.productsDeactivated", "Products deactivated")
      );
      refreshProducts();
    } catch (err) {
      console.error("[products:list] bulk status failed", err);
      toast.error(err?.responseBody?.message || err?.message || t("products.toasts.statusUpdateFailed", "Failed to update product status"));
      refreshProducts();
    }
  };

  const openBarcodeQueueDialog = async () => {
    if (!selectedRows.length) return;
    const detailedRows = await loadMultipleProductDetails(selectedRows.map((row) => row.id));
    const resolvedRows = detailedRows.length ? detailedRows : selectedRows;
    const initialSelection = {};
    resolvedRows.forEach((row) => {
      initialSelection[String(row.id)] = getProductQueueColorGroups(row).map((group) => group.colorKey || normalizeQueueColorKey(group.primaryImageUrl)).filter(Boolean);
    });
    setBarcodeQueueRows(resolvedRows);
    setBarcodeQueueDialogMode("all");
    setBarcodeQueueDialogRegenerateExisting(false);
    setBarcodeQueueDialogSelection(initialSelection);
    setBarcodeQueueDialogOpen(true);
  };

  const handleBulkAddToProductPrintList = async () => {
    if (!selectedRows.length) return;
    try {
      const detailedRows = await loadMultipleProductDetails(selectedRows.map((row) => row.id));
      addProductsToPrintList(detailedRows.length ? detailedRows : selectedRows);
      toast.success(`تمت إضافة ${selectedRows.length} منتج إلى قائمة الطباعة`);
      setSelectedIds([]);
      navigate("/products/print-list");
    } catch (error) {
      toast.error(error?.message || "تعذر إضافة المنتجات إلى قائمة الطباعة");
    }
  };

  const closeBarcodeQueueDialog = () => {
    setBarcodeQueueDialogOpen(false);
    setBarcodeQueueSubmitting(false);
    setBarcodeQueueRows([]);
  };

  const handleConfirmBarcodeQueueAdd = async () => {
    if (!barcodeQueueRows.length || barcodeQueueSubmitting) return;

    try {
      setBarcodeQueueSubmitting(true);
      const payload = {
        regenerateExisting: barcodeQueueDialogRegenerateExisting,
        colorMode: barcodeQueueDialogMode,
        products: barcodeQueueRows.map((row) => {
          const colorGroups = getProductQueueColorGroups(row);
          const selectedColorKeys =
            barcodeQueueDialogMode === "selected"
              ? (barcodeQueueDialogSelection[String(row.id)] || [])
              : colorGroups.map((group) => group.colorKey || normalizeQueueColorKey(group.primaryImageUrl)).filter(Boolean);
          return {
            productId: row.id,
            productName: row.name || "",
            productImageUrl: row.product_image_url || row.image_url || "",
            colorImages: Array.isArray(row.color_images) ? row.color_images : [],
            variants: Array.isArray(row.variants) ? row.variants : [],
            selectedColorKeys,
          };
        }),
      };
      const result = await bulkAddBarcodePrintQueue(payload);
      const addedCount = Number(result?.data?.addedCount || 0);
      const regeneratedCount = Number(result?.data?.regeneratedCount || 0);
      const totalColors = addedCount + regeneratedCount;
      toast.success(t("products.barcodePrintQueue.addedToQueueToast", { count: totalColors, defaultValue: `تمت إضافة ${totalColors} لون إلى قائمة الملصقات` }));
      window.dispatchEvent(new Event("barcode-print-queue:refetch"));
      setBarcodeQueueDialogOpen(false);
      refreshProducts();
    } catch (err) {
      console.error("[products:list] barcode print queue bulk add failed", err);
      toast.error(err?.responseBody?.message || err?.message || t("common.noData"));
    } finally {
      setBarcodeQueueSubmitting(false);
    }
  };

  return (
    <ProductsShell
      title={t("products.title")}
      description={t("products.description")}
      actions={
        <>
          <button
            onClick={() => navigate("/products/add")}
            className="m1-products-primary-action inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold transition sm:px-5 sm:py-3 sm:text-base"
          >
            <Plus size={18} />
            {t("products.newProduct")}
          </button>
          <button
            onClick={() => setReloadNonce((prev) => prev + 1)}
            className="m1-products-secondary-action inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold transition sm:px-5 sm:py-3 sm:text-base"
          >
            <Filter size={18} />
            {t("products.refresh")}
          </button>
        </>
      }
    >
      <div className="m1-products-catalog w-full min-w-0 max-w-none rounded-[var(--radius-card)] border border-border bg-surface p-3 sm:p-5 xl:p-6">
        <div className="mb-4 flex items-center gap-2 rounded-[var(--radius-card)] border border-border bg-surface-soft p-1">
          <button
            type="button"
            onClick={() => {
              setCatalogTab("products");
              setPage(1);
            }}
            className={`flex-1 rounded-[var(--radius-control)] px-4 py-2 text-sm font-black transition ${ catalogTab === "products" ? "bg-primary text-[var(--primary-contrast)]" : "text-text-muted hover:bg-surface-hover hover:text-[var(--primary-contrast)]" }`}
          >
            {t("products.tabs.products", "المنتجات")}
          </button>
          <button
            type="button"
            onClick={() => {
              setCatalogTab("offers");
              setPage(1);
            }}
            className={`flex-1 rounded-[var(--radius-control)] px-4 py-2 text-sm font-black transition ${ catalogTab === "offers" ? "bg-primary text-[var(--primary-contrast)]" : "text-text-muted hover:bg-surface-hover hover:text-[var(--primary-contrast)]" }`}
          >
            {t("products.tabs.offers", "العروض")}
          </button>
        </div>
        <div className="grid min-w-0 grid-cols-1 gap-3 sm:gap-4 xl:grid-cols-[minmax(0,1.8fr)_repeat(5,minmax(0,1fr))]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-text-muted" size={18} />
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder={t("products.searchPlaceholder")}
              className="w-full rounded-[var(--radius-control)] border border-border bg-surface-soft py-3 pl-11 pr-4 text-text outline-none placeholder:text-text-muted"
            />
          </div>

          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
            className="rounded-[var(--radius-control)] border border-border bg-surface-soft px-4 py-3 text-text outline-none"
          >
            <option value="all">{t("products.filters.allStatus")}</option>
            <option value="active">{t("products.filters.active")}</option>
            <option value="low">{t("products.filters.lowStock")}</option>
            <option value="inactive">{t("products.filters.inactive")}</option>
          </select>

          <BrandFilterCombobox
            value={brandFilter}
            options={brandOptions}
            allLabel={t("products.filters.allBrands")}
            searchPlaceholder={t("products.form.searchBrand", "Search brands")}
            onChange={(nextBrand) => {
              setBrandFilter(nextBrand);
              setPage(1);
            }}
          />

          <select
            value={storefrontVisibilityFilter}
            onChange={(e) => {
              setStorefrontVisibilityFilter(e.target.value);
              setPage(1);
            }}
            className="rounded-[var(--radius-control)] border border-border bg-surface-soft px-4 py-3 text-text outline-none"
          >
            <option value="all">{t("products.filters.storefrontVisibilityAll", "حالة الظهور على الموقع: الكل")}</option>
            <option value="visible">{t("products.filters.storefrontVisibilityVisible", "ظاهر بالموقع")}</option>
            <option value="hidden">{t("products.filters.storefrontVisibilityHidden", "مخفي من الموقع")}</option>
          </select>

          <select
            value={colorImageFilter}
            onChange={(e) => {
              setColorImageFilter(e.target.value);
              setPage(1);
            }}
            className="rounded-[var(--radius-control)] border border-border bg-surface-soft px-4 py-3 text-text outline-none"
          >
            <option value="all">{t("products.images.filter.all")}</option>
            <option value="complete">{t("products.images.filter.complete")}</option>
            <option value="incomplete">{t("products.images.filter.incomplete")}</option>
            <option value="none">{t("products.images.filter.none")}</option>
          </select>

          <div className="relative" data-products-filter-popover>
            <div className="flex items-stretch gap-2">
              <button
                ref={filtersTriggerRef}
                type="button"
                onClick={() => setFiltersOpen((open) => !open)}
                disabled={!filterGroups.length}
                className={`flex min-w-0 flex-1 items-center justify-center gap-2 rounded-[var(--radius-control)] border px-4 py-3 text-sm font-black outline-none transition disabled:cursor-not-allowed disabled:opacity-50 ${ activeFilterCount ? "border-emerald-300/40 bg-emerald-400/15 text-emerald-100" : "border-border bg-surface-soft text-text hover:border-border-strong hover:bg-surface-hover" }`}
                aria-expanded={filtersOpen}
              >
                <Filter size={16} />
                <span>{t("products.filters.filters", "Filters")}{activeFilterCount ? ` (${activeFilterCount})` : ""}</span>
                <ChevronDown size={16} className={`transition ${filtersOpen ? "rotate-180" : ""}`} />
              </button>
              {hasAnyStoredFilter ? (
                <button
                  type="button"
                  onClick={clearAllProductFilters}
                  className="inline-flex h-auto w-10 shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-red-300/20 bg-red-500/10 text-red-200 transition hover:border-red-300/40 hover:bg-red-500/15"
                  title={t("products.filters.clearClassifications", "Clear")}
                  aria-label={t("products.filters.clearClassifications", "Clear")}
                >
                  <X size={15} />
                </button>
              ) : null}
            </div>

            {filtersOpen && filterGroups.length ? (
              <div ref={filtersRef} className="fixed inset-x-2 bottom-2 z-[80] max-h-[85dvh] overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface shadow-2xl shadow-black/60 sm:absolute sm:inset-x-auto sm:bottom-auto sm:left-0 sm:right-auto sm:top-full sm:mt-2 sm:w-[min(38rem,calc(100vw-2rem))]">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface-soft px-4 py-3">
                  <div className="inline-flex items-center gap-2 text-xs font-black uppercase tracking-[0.16em] text-text-muted">
                    <Filter size={14} />
                    {t("products.filters.classifications", "Product filters")}
                    <span className={`rounded-full border px-2 py-0.5 tracking-normal ${ activeFilterCount ? "border-emerald-300/30 bg-emerald-400/10 text-emerald-200" : "border-border bg-surface-soft text-text-muted" }`}>
                      {activeFilterCount}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {activeFilterCount ? (
                      <button
                        type="button"
                        onClick={clearClassificationFilters}
                        className="inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-border bg-surface-soft px-3 py-1.5 text-xs font-black text-text-muted transition hover:border-red-300/25 hover:bg-red-500/10 hover:text-red-100"
                      >
                        <X size={13} />
                        {t("products.filters.clearClassifications", "Clear")}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setFiltersOpen(false)}
                      className="inline-flex h-[var(--control-height-sm)] w-8 items-center justify-center rounded-[var(--radius-control)] border border-border bg-surface-soft text-text-muted transition hover:text-text"
                      aria-label={t("common.close", "Close")}
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>

                <div className="max-h-[min(28rem,70vh)] space-y-3 overflow-auto p-4">
                  {filterGroups.map((group) => (
                    <div key={group.key} className="grid min-w-0 gap-2 lg:grid-cols-[8.5rem_minmax(0,1fr)] lg:items-start">
                      <div className="pt-1 text-[11px] font-black uppercase tracking-[0.14em] text-text-muted">
                        {group.label}
                      </div>
                      <div className="flex min-w-0 flex-wrap gap-1.5">
                        <button
                          type="button"
                          onClick={() => group.onSelect("all")}
                          className={`rounded-[var(--radius-control)] border px-3 py-1.5 text-xs font-black transition ${ group.value === "all" ? "border-border bg-surface-soft text-text" : "border-border bg-surface-soft text-text-muted hover:border-border-strong hover:text-text" }`}
                        >
                          {t("products.filters.allClassifications", "All")}
                        </button>
                        {group.options.map((option) => {
                          const isActive = group.value === option.value;
                          return (
                            <button
                              key={`${group.key}-${option.value}`}
                              type="button"
                              onClick={() => group.onSelect(option.value)}
                              className={`rounded-[var(--radius-control)] border px-3 py-1.5 text-xs font-black transition ${ isActive ? "border-emerald-300/70 bg-primary text-[var(--primary-contrast)]" : "border-border bg-surface-soft text-text-muted hover:border-border-strong hover:bg-surface-hover hover:text-[var(--primary-contrast)]" }`}
                            >
                              {option.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>

        {selectedCount > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-[var(--radius-card)] border border-emerald-500/15 bg-emerald-500/8 px-4 py-3">
            <span className="text-sm font-semibold text-emerald-300">
              {selectedCount} {t("products.bulk.selected")}
            </span>
            <button
              onClick={handleBulkDelete}
              className="inline-flex items-center gap-2 rounded-full border border-red-500/20 bg-red-500/10 px-4 py-2 text-sm font-semibold text-red-300"
            >
              <Trash2 size={16} />
              {t("products.bulk.delete")}
            </button>
            <button
              onClick={openBarcodeQueueDialog}
              className="inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-200"
            >
              <Barcode size={16} />
              {t("products.bulk.addToBarcodePrintQueue", "إضافة إلى قائمة الملصقات")}
            </button>
            <button
              onClick={handleBulkAddToProductPrintList}
              className="inline-flex items-center gap-2 rounded-full border border-amber-400/25 bg-amber-400/10 px-4 py-2 text-sm font-semibold text-amber-200"
            >
              <Printer size={16} />
              إضافة إلى قائمة الطباعة
            </button>
            <button
              onClick={() => handleBulkStatus(true)}
              className="inline-flex items-center gap-2 rounded-full border border-border bg-surface-soft px-4 py-2 text-sm font-semibold text-text"
            >
              {t("products.bulk.markActive")}
            </button>
            <button
              onClick={() => handleBulkStatus(false)}
              className="inline-flex items-center gap-2 rounded-full border border-border bg-surface-soft px-4 py-2 text-sm font-semibold text-text"
            >
              {t("products.bulk.markInactive")}
            </button>
            <button
              onClick={() => handleBulkStorefrontVisibility(true)}
              className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-4 py-2 text-sm font-semibold text-primary"
            >
              {t("products.bulk.showOnStorefront", "إظهار بالموقع")}
            </button>
            <button
              onClick={() => handleBulkStorefrontVisibility(false)}
              className="inline-flex items-center gap-2 rounded-full border border-border bg-border-strong px-4 py-2 text-sm font-semibold text-text"
            >
              {t("products.bulk.hideFromStorefront", "إخفاء من الموقع")}
            </button>
          </div>
        )}

        {error ? (
          <div className="mt-6 rounded-[var(--radius-card)] border border-red-500/20 bg-red-500/10 p-5 text-red-200">
            {error}
          </div>
        ) : null}

        <div className="relative mt-6 w-full min-w-0 max-w-none overflow-visible">
          <div className="grid gap-3 lg:hidden">
            {loading ? (
              <div className="rounded-[var(--radius-card)] border border-border bg-surface-soft p-6 text-center text-sm font-semibold text-text-muted">
                {t("products.loading")}
              </div>
            ) : visibleRows.length === 0 ? (
              <div className="rounded-[var(--radius-card)] border border-border bg-surface-soft p-6 text-center">
                <Package2 className="mx-auto text-text-muted" size={36} />
                <h3 className="m1-section-title mt-3 text-text">{t("products.empty.title")}</h3>
                <p className="mt-2 text-sm text-text-muted">{t("products.empty.description")}</p>
              </div>
            ) : (
              visibleRows.map((row) => {
                const { totalStock, lowStockAlert, isLowStock, isOutOfStock } = getProductStockState(row);
                const displayCost = canViewCostPrice ? formatCardPrice(row.display_cost ?? 0) : "—";
                const sellingPrice = formatCardPrice(row.selling_price ?? 0);
                const salePrice = row.sale_price != null ? formatCardPrice(row.sale_price) : "غير متاح";
                const displaySku = cleanSkuDisplay(row.sku);
                const inactiveProduct = isInactiveProduct(row);
                const storefrontVisible = isStorefrontVisibleValue(row);
                const statusToggleLabel = inactiveProduct
          ? t("products.actionsMenu.activateProduct", "تفعيل المنتج")
          : t("products.actionsMenu.deactivateProduct", "إلغاء تفعيل المنتج");
                const { dropdownActions } = getRowActions(row, statusToggleLabel);
                const statusKey =
                  inactiveProduct
                    ? "inactive"
                    : isOutOfStock
                      ? "out"
                      : isLowStock
                        ? "low"
                        : "active";
                const status =
                  statusKey === "inactive"
                    ? t("products.filters.inactive")
                    : statusKey === "out"
                    ? "نفد المخزون"
                      : statusKey === "low"
                        ? t("products.filters.lowStock")
                        : t("products.filters.active");
                return (
                  <ProductMobileCard
                    key={row.id}
                    row={row}
                    selected={selectedIds.includes(row.id)}
                    onToggleSelected={() => toggleSelected(row.id)}
                    onOpen={() => handleOpenSelectedProduct(row)}
                    statusKey={statusKey}
                    status={status}
                    totalStock={totalStock}
                    lowStockAlert={lowStockAlert}
                    displayCost={displayCost}
                    concealCost={canViewCostPrice}
                    sellingPrice={sellingPrice}
                    salePrice={salePrice}
                    displaySku={displaySku}
                    storefrontVisible={storefrontVisible}
                    actions={dropdownActions}
                    onColorImagesClick={(event) => openProductColorImages(event, row)}
                    t={t}
                    language={i18n.language}
                  />
                );
              })
            )}
          </div>

          <div className="hidden w-full min-w-0 overflow-x-auto lg:block">
            <table className="m1-table m1-table--compact m1-table--separate w-full table-fixed border-separate">
              <colgroup>
                <col className={PRODUCT_TABLE_COLUMNS.select} />
                <col className={PRODUCT_TABLE_COLUMNS.product} />
                <col className={PRODUCT_TABLE_COLUMNS.categoryBrand} />
                <col className={PRODUCT_TABLE_COLUMNS.stock} />
                <col className={PRODUCT_TABLE_COLUMNS.costSale} />
                <col className={PRODUCT_TABLE_COLUMNS.status} />
                <col className={PRODUCT_TABLE_COLUMNS.actions} />
              </colgroup>
              <thead>
                <tr className="text-center text-xs uppercase tracking-[0.22em] text-text-muted">
                  <th className="px-4 py-2">
                    <input
                      type="checkbox"
                      checked={visibleRows.length > 0 && visibleRows.every((row) => selectedIds.includes(row.id))}
                      onChange={toggleAll}
                    />
                  </th>
                  <th className="px-4 py-2 text-right">{t("products.table.product")}</th>
                  <th className="m1-table__cell--center px-4 py-2">{t("products.table.typeCategoryBrand")}</th>
                  <th className="m1-table__cell--center px-4 py-2">{t("products.table.stock")}</th>
                  <th className="m1-table__cell--center px-4 py-2">{t("products.table.costSale", "التكلفة / البيع")}</th>
                  <th className="m1-table__cell--center px-4 py-2">{t("products.table.status")}</th>
                  <th className="m1-table__cell--center px-4 py-2">{t("products.table.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan="7" className="px-4 py-12 text-center text-text-muted">
                      {t("products.loading")}
                    </td>
                  </tr>
                ) : visibleRows.length === 0 ? (
                  <tr>
                    <td colSpan="7" className="px-4 py-12 text-center">
                      <div className="w-full rounded-[var(--radius-card)] border border-border bg-surface-soft p-8">
                        <Package2 className="mx-auto text-text-muted" size={42} />
                        <h3 className="m1-section-title mt-4 text-text">{t("products.empty.title")}</h3>
                        <p className="mt-2 text-sm text-text-muted">
                          {t("products.empty.description")}
                        </p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  visibleRows.map((row) => {
                    const { totalStock, lowStockAlert, isLowStock, isOutOfStock } = getProductStockState(row);
                    const displayCost = canViewCostPrice ? formatCardPrice(row.display_cost ?? 0) : "—";
                    const sellingPrice = formatCardPrice(row.selling_price ?? 0);
                    const salePrice = row.sale_price != null ? formatCardPrice(row.sale_price) : "غير متاح";
                    const displaySku = cleanSkuDisplay(row.sku);
                    const productType = getProductTypeValue(row);
                    const category = isMeaningfulCategory(row.category) ? String(row.category).trim() : "";
                    const barcodeTitle = cleanSkuDisplay(row.barcode) ? `${displaySku ? `${displaySku} / ` : ""}${row.barcode}` : displaySku;
                    const inactiveProduct = isInactiveProduct(row);
                    const storefrontVisible = isStorefrontVisibleValue(row);
                    const statusToggleLabel = inactiveProduct
                      ? t("products.actionsMenu.activateProduct", "تفعيل المنتج")
                      : t("products.actionsMenu.deactivateProduct", "إلغاء تفعيل المنتج");
                    const { inlineActions, dropdownActions } = getRowActions(row, statusToggleLabel);
                    const statusKey =
                      inactiveProduct
                        ? "inactive"
                        : isOutOfStock
                          ? "out"
                          : isLowStock
                            ? "low"
                            : "active";
                    const status =
                      statusKey === "inactive"
                        ? t("products.filters.inactive")
                        : statusKey === "out"
                          ? "نفد المخزون"
                          : statusKey === "low"
                            ? t("products.filters.lowStock")
                            : t("products.filters.active");
                    return (
                      <tr
                        key={row.id}
                        className={`group/product-row relative rounded-[var(--radius-card)] border border-border bg-surface-soft text-center ${openActionId === row.id ? "z-[100]" : "z-0"}`}
                      >
                        <td className="px-4 py-4 align-middle">
                          <input
                            type="checkbox"
                            checked={selectedIds.includes(row.id)}
                            onChange={() => toggleSelected(row.id)}
                          />
                        </td>
                        <td className="px-4 py-3 align-middle">
                          <button
                            type="button"
                            onClick={() => handleOpenSelectedProduct(row)}
                            className="flex w-full min-w-0 items-center justify-start gap-3 text-start"
                          >
                            <ProductThumbnail row={row} />
                            <div className="min-w-0 self-center">
                              <p className="truncate text-sm font-semibold leading-5 text-text">{row.name}</p>
                              {displaySku ? (
                                <p className="truncate text-xs font-semibold leading-4 text-text-muted" title={barcodeTitle || displaySku}>
                                  {displaySku}
                                </p>
                              ) : null}
                              <ProductArticleBadges row={row} />
                              <div className="mt-1.5">
                                <ProductColorImageBadge row={row} onClick={(event) => openProductColorImages(event, row)} />
                              </div>
                              <div className="mt-1.5">
                                <ProductThermalLevelBadge row={row} />
                              </div>
                            </div>
                          </button>
                        </td>
                        <td className="m1-table__cell--center px-4 py-4 align-middle">
                          <p className="truncate font-semibold text-text">
                            {productType || category || t("products.selected.category")}
                          </p>
                          {productType && category && category.toLowerCase() !== productType.toLowerCase() ? (
                            <p className="truncate text-xs font-semibold text-primary">{category}</p>
                          ) : null}
                          <p className="truncate text-sm text-text-muted">{row.brand || t("products.selected.brand")}</p>
                          <div className="mt-2 flex flex-wrap justify-center gap-1.5">
                            <ProductAudienceBadges row={row} language={i18n.language} />
                          </div>
                        </td>
                        <td className="m1-table__cell--center px-4 py-4 align-middle">
                          <p className="font-semibold text-text">{totalStock}</p>
                          <p className="text-sm text-text-muted">{t("products.stock.lowAlert")} {lowStockAlert}</p>
                        </td>
                        <td className="px-4 py-4 align-middle">
                          <div className="grid gap-1.5 text-xs leading-5">
                            <PriceLine
                              label={t("products.priceLabels.cost", "Cost")}
                              value={displayCost}
                              tone="muted"
                              concealed={canViewCostPrice}
                              revealLabel={t("products.priceLabels.showCost", "إظهار التكلفة")}
                              hideLabel={t("products.priceLabels.hideCost", "إخفاء التكلفة")}
                            />
                            <PriceLine label={t("products.priceLabels.sell", "Sell")} value={sellingPrice} tone="sell" />
                            <PriceLine label={t("products.priceLabels.sale", "Sale")} value={salePrice} tone="sale" />
                          </div>
                        </td>
                        <td className="px-4 py-4 align-middle">
                          <div className="flex flex-col items-center gap-2">
                            <span
                              className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${ statusKey === "active" ? "bg-emerald-500/15 text-emerald-300" : statusKey === "low" ? "bg-amber-500/15 text-amber-300" : statusKey === "out" ? "bg-red-500/15 text-red-300" : "bg-border-strong text-text-muted" }`}
                            >
                              {status}
                            </span>
                            <span
                              className={`inline-flex items-center rounded-full px-3 py-1 text-[11px] font-semibold ${ storefrontVisible ? "bg-primary/15 text-primary" : "bg-border-strong text-text-muted" }`}
                            >
                              {storefrontVisible
                                ? t("products.storefront.visible", "ظاهر بالموقع")
                                : t("products.storefront.hidden", "مخفي من الموقع")}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-4 align-middle">
                          <div className={`relative flex min-h-10 items-center justify-center gap-2 ${openActionId === row.id ? "z-[100]" : "z-0"}`}>
                            <div className="hidden items-center gap-1.5 lg:flex">
                              {inlineActions.map((action) => (
                                <QuickRowAction
                                  key={action.key}
                                  icon={action.icon}
                                  label={action.inlineLabel || action.label}
                                  href={action.href}
                                  onClick={action.onClick}
                                  disabled={action.disabled}
                                  className={action.className || ""}
                                />
                              ))}
                            </div>
                            <button
                              ref={(node) => {
                                if (openActionId === row.id) actionMenuTriggerRef.current = node;
                              }}
                              type="button"
                              onClick={(event) => {
                                const button = event.currentTarget;
                                if (!button) return;
                                const rect = typeof button.getBoundingClientRect === "function"
                                  ? button.getBoundingClientRect()
                                  : null;
                                setOpenActionId((current) => {
                                  const next = current === row.id ? null : row.id;
                                  setActionMenuPosition(next ? getActionMenuPosition(rect, dropdownActions.length) : null);
                                  console.log("[products:list] toggle action menu", { productId: row.id, nextOpenId: next });
                                  return next;
                                });
                              }}
                              className="group/action relative ml-1 inline-flex h-[var(--control-height-sm)] w-8 shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-border bg-surface-soft text-text-muted opacity-75 transition hover:border-emerald-300/25 hover:bg-emerald-400/10 hover:text-emerald-100 hover:opacity-100"
                              title={t("products.actionsMenu.moreActions", "المزيد من الإجراءات")}
                              aria-label={t("products.actionsMenu.moreActions", "المزيد من الإجراءات")}
                            >
                              <MoreHorizontal size={15} />
                              <span className="pointer-events-none absolute bottom-full left-1/2 z-[110] mb-2 -translate-x-1/2 whitespace-nowrap rounded-[var(--radius-control)] border border-border bg-surface px-2 py-1 text-[10px] font-bold text-text opacity-0 shadow-xl shadow-black/40 transition group-hover/action:opacity-100 group-focus-visible/action:opacity-100">
                                {t("products.actionsMenu.moreActions", "المزيد من الإجراءات")}
                              </span>
                            </button>

                            {openActionId === row.id && actionMenuPosition && typeof document !== "undefined" ? createPortal((
                              <div
                                ref={actionMenuRef}
                                className="fixed z-[100000] overflow-y-auto rounded-[var(--radius-card)] border border-border bg-surface shadow-2xl shadow-black/50 transition duration-100 ease-out animate-in fade-in-0 zoom-in-95"
                                style={{
                                  top: `${actionMenuPosition.top}px`,
                                  left: `${actionMenuPosition.left}px`,
                                  width: `${actionMenuPosition.width || ACTION_MENU_WIDTH}px`,
                                  maxHeight: `${actionMenuPosition.maxHeight}px`,
                                  transformOrigin: actionMenuPosition.placement === "top" ? "bottom right" : "top right",
                                }}
                                onClick={(event) => event.stopPropagation()}
                              >
                                {dropdownActions.map((action) => {
                                  const Icon = action.icon;
                                  const itemClassName = `flex w-full items-center gap-2 px-4 py-3 text-left text-sm disabled:cursor-not-allowed disabled:opacity-40 ${
                                    action.tone === "danger"
                                      ? "text-red-300 hover:bg-red-500/10"
                                      : "text-text hover:bg-surface-hover"
                                  }`;
                                  if (action.href && !action.disabled) {
                                    return (
                                      <Link
                                        key={action.key}
                                        to={action.href}
                                        onClick={(event) => handleNavigableActionClick(event, action.onClick)}
                                        className={itemClassName}
                                      >
                                        <Icon size={16} />
                                        {action.label}
                                      </Link>
                                    );
                                  }
                                  return (
                                    <button
                                      key={action.key}
                                      type="button"
                                      onClick={action.onClick}
                                      disabled={action.disabled}
                                      className={itemClassName}
                                    >
                                      <Icon size={16} />
                                      {action.label}
                                    </button>
                                  );
                                })}
                              </div>
                            ), document.body) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        <Pagination
          className="mt-6 border-t border-border pt-5"
          page={currentPage}
          pages={totalPages}
          total={Number(pagination.total || 0)}
          pageSize={pageSize}
          pageSizeOptions={pageSizeOptions}
          visible={visibleRows.length}
          disabled={loading}
          onChange={setPage}
          onPageSizeChange={(value) => {
            setPageSize(value);
            setPage(1);
          }}
        />
      </div>

      {statusActionProduct && typeof document !== "undefined" ? createPortal((
        <div className="fixed inset-0 z-[100100] flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-[var(--radius-card)] border border-border bg-surface p-6 shadow-2xl shadow-black/50">
            <div className="flex items-start gap-4">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-[var(--radius-card)] border border-amber-300/20 bg-amber-400/10 text-amber-200">
                <Power size={20} />
              </span>
              <div className="min-w-0">
                <h2 className="m1-section-title text-text">
                  {isInactiveProduct(statusActionProduct)
                    ? t("products.statusModal.activateTitle", "Activate product?")
                    : t("products.statusModal.deactivateTitle", "Deactivate product?")}
                </h2>
                <p className="mt-2 text-sm leading-6 text-text-muted">
                  {isInactiveProduct(statusActionProduct)
                    ? t("products.statusModal.activateDescription", "سيظهر هذا المنتج مرة أخرى في المتجر ونقاط البيع.")
                    : t("products.statusModal.deactivateDescription", "تظل المنتجات غير النشطة مرئية في الإدارة، لكنها تُخفى من المتجر والبحث ونتائج البيع في نقاط البيع.")}
                </p>
                <p className="mt-3 truncate text-sm font-semibold text-text">{statusActionProduct.name}</p>
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setStatusActionProduct(null)}
                className="rounded-[var(--radius-control)] border border-border px-4 py-2.5 text-sm font-bold text-text hover:bg-surface-hover"
              >
                {t("common.cancel", "Cancel")}
              </button>
              <button
                type="button"
                onClick={handleConfirmProductStatusToggle}
                className={`rounded-[var(--radius-control)] px-4 py-2.5 text-sm font-black text-[var(--primary-contrast)] ${ isInactiveProduct(statusActionProduct) ? "bg-primary hover:bg-primary" : "bg-amber-600 hover:bg-amber-500" }`}
              >
                {isInactiveProduct(statusActionProduct)
                  ? t("products.actionsMenu.activateProduct", "تفعيل المنتج")
                  : t("products.actionsMenu.deactivateProduct", "إلغاء تفعيل المنتج")}
              </button>
            </div>
          </div>
        </div>
      ), document.body) : null}

      {selectedProduct ? (
        <div className="rounded-[var(--radius-card)] border border-border bg-surface p-6">
          <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
            <div className="max-w-3xl">
              <p className="text-xs uppercase tracking-[0.28em] text-text-muted">{t("products.selected.title")}</p>
              <h2 className="m1-section-title mt-3 text-text">{selectedProduct.name}</h2>
              <p className="mt-3 text-text-muted">{selectedProduct.description || t("products.empty.firstDescription")}</p>
            </div>
            <Link
              to="/products/add"
              className="inline-flex items-center gap-2 rounded-full border border-border bg-surface-soft px-5 py-3 font-semibold text-text"
            >
              <Plus size={18} />
              {t("products.selected.createSimilar")}
            </Link>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            {[
              [t("products.selected.sku"), cleanSkuDisplay(selectedProduct.sku)],
              [t("products.selected.barcode"), cleanSkuDisplay(selectedProduct.barcode)],
              [t("products.selected.brand"), selectedProduct.brand || t("products.records.unbranded")],
              [t("products.selected.category"), selectedProduct.category || t("products.records.uncategorized")],
            ].filter(([, value]) => value).map(([label, value]) => (
              <div key={label} className="rounded-[var(--radius-card)] border border-border bg-surface-soft p-4">
                <p className="text-xs uppercase tracking-[0.28em] text-text-muted">{label}</p>
                <p className="mt-2 text-lg font-semibold text-text">{value}</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {!loading && !error && rows.length === 0 ? (
        <div className="rounded-[var(--radius-card)] border border-border bg-surface p-12 text-center">
          <AlertTriangle className="mx-auto text-amber-400" size={40} />
          <h3 className="m1-section-title mt-4 text-text">{t("products.empty.catalogTitle")}</h3>
          <p className="mt-2 text-text-muted">{t("products.empty.catalogDescription")}</p>
          <button
            onClick={() => navigate("/products/add")}
            className="mt-6 inline-flex items-center gap-2 rounded-full bg-primary px-5 py-3 font-semibold text-[var(--primary-contrast)]"
          >
            <Plus size={18} />
            {t("products.newProduct")}
          </button>
        </div>
      ) : null}

      {priceEditorProduct ? (
        <EnhancedPriceEditorModal
          product={priceEditorProduct}
          canEditPurchasePrice={isAdminUser()}
          onClose={() => setPriceEditorProduct(null)}
          onSave={handleSavePrices}
        />
      ) : null}

      {marketingEditorOpen ? (
        <PostEditorModal
          open={marketingEditorOpen}
          post={marketingEditorPost}
          onClose={() => setMarketingEditorOpen(false)}
          onSaveDraft={(marketingEditorPost?.id ? canUpdateMarketingPost : canCreateMarketingPost) ? handleSaveMarketingDraft : null}
          onPublish={canPublishMarketingPost ? handlePublishMarketingPost : null}
          onSchedule={canUpdateMarketingPost ? handleScheduleMarketingPost : null}
          saving={marketingSaving}
          title={t("products.actionsMenu.generateMarketingPost", "إنشاء منشور تسويقي")}
        />
      ) : null}
      <BarcodeQueueBulkModal
        open={barcodeQueueDialogOpen}
        selectedRows={barcodeQueueRows}
        mode={barcodeQueueDialogMode}
        regenerateExisting={barcodeQueueDialogRegenerateExisting}
        selection={barcodeQueueDialogSelection}
        submitting={barcodeQueueSubmitting}
        onClose={closeBarcodeQueueDialog}
        onModeChange={setBarcodeQueueDialogMode}
        onRegenerateExistingChange={setBarcodeQueueDialogRegenerateExisting}
        onSelectionChange={setBarcodeQueueDialogSelection}
        onSubmit={handleConfirmBarcodeQueueAdd}
        t={t}
      />
    </ProductsShell>
  );
}

function BarcodeQueueBulkModal({
  open,
  selectedRows = [],
  mode = "all",
  regenerateExisting = false,
  selection = {},
  submitting = false,
  onClose,
  onModeChange,
  onRegenerateExistingChange,
  onSelectionChange,
  onSubmit,
  t,
}) {
  const colorGroupsByProduct = useMemo(
    () => (Array.isArray(selectedRows) ? selectedRows : []).map((row) => ({ row, groups: getProductQueueColorGroups(row) })),
    [selectedRows]
  );

  const totalAvailableColors = useMemo(
    () => colorGroupsByProduct.reduce((total, entry) => total + entry.groups.length, 0),
    [colorGroupsByProduct]
  );

  const totalSelectedColors = useMemo(() => {
    if (mode !== "selected") return totalAvailableColors;
    return colorGroupsByProduct.reduce((total, entry) => {
      const selected = new Set(Array.isArray(selection[String(entry.row.id)]) ? selection[String(entry.row.id)] : []);
      return total + entry.groups.filter((group) => selected.has(normalizeQueueColorKey(group.colorKey || group.primaryImageUrl))).length;
    }, 0);
  }, [colorGroupsByProduct, mode, selection, totalAvailableColors]);

  if (!open || typeof document === "undefined") return null;

  const toggleGroupSelection = (productId, colorKey) => {
    const key = String(productId);
    const normalized = normalizeQueueColorKey(colorKey);
    onSelectionChange((prev) => {
      const current = Array.isArray(prev?.[key]) ? prev[key] : [];
      const next = current.includes(normalized) ? current.filter((item) => item !== normalized) : [...current, normalized];
      return { ...prev, [key]: next };
    });
  };

  const setAllForProduct = (productId, groups, checked) => {
    const key = String(productId);
    const values = checked ? groups.map((group) => normalizeQueueColorKey(group.colorKey || group.primaryImageUrl)).filter(Boolean) : [];
    onSelectionChange((prev) => ({ ...prev, [key]: values }));
  };

  return createPortal(
    <div className="fixed inset-0 z-[100150] flex items-center justify-center bg-black/75 px-4 py-6 backdrop-blur-sm" dir="ltr">
      <div className="w-full max-w-4xl overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface shadow-2xl shadow-black/60">
        <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
          <div className="min-w-0">
            <p className="text-[11px] font-black uppercase tracking-[0.22em] text-emerald-300">
              {t("products.bulk.addToBarcodePrintQueue", "إضافة إلى قائمة الملصقات")}
            </p>
            <h2 className="m1-section-title mt-2 text-text">
              {t("products.bulk.addToBarcodePrintQueue", "إضافة إلى قائمة الملصقات")}
            </h2>
            <p className="mt-2 text-sm leading-6 text-text-muted">
              {t(
                "products.bulk.addToBarcodePrintQueueDescription",
                "Choose whether to queue every color or only specific colors. Existing items are skipped unless regeneration is enabled."
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-[var(--control-height-md)] w-10 items-center justify-center rounded-[var(--radius-control)] border border-border bg-surface-soft text-text-muted transition hover:bg-surface-hover hover:text-text"
            aria-label={t("common.close", "Close")}
          >
            <X size={18} />
          </button>
        </div>

        <div className="grid gap-6 px-6 py-6 lg:grid-cols-[280px_minmax(0,1fr)]">
          <div className="space-y-4">
            <label className="flex cursor-pointer items-start gap-3 rounded-[var(--radius-card)] border border-border bg-surface-soft p-4">
              <input
                type="radio"
                name="barcode-queue-mode"
                checked={mode === "all"}
                onChange={() => onModeChange("all")}
                className="mt-1 h-4 w-4 border-border bg-transparent text-emerald-400"
              />
              <span>
                <span className="block text-sm font-black text-text">{t("products.bulk.allColors", "All colors")}</span>
                <span className="mt-1 block text-xs leading-5 text-text-muted">
                  {t("products.bulk.allColorsDescription", "Queue every color group for the selected products.")}
                </span>
              </span>
            </label>

            <label className="flex cursor-pointer items-start gap-3 rounded-[var(--radius-card)] border border-border bg-surface-soft p-4">
              <input
                type="radio"
                name="barcode-queue-mode"
                checked={mode === "selected"}
                onChange={() => onModeChange("selected")}
                className="mt-1 h-4 w-4 border-border bg-transparent text-emerald-400"
              />
              <span>
                <span className="block text-sm font-black text-text">{t("products.bulk.selectedColorsOnly", "Selected colors only")}</span>
                <span className="mt-1 block text-xs leading-5 text-text-muted">
                  {t("products.bulk.selectedColorsOnlyDescription", "Pick only the colors you want to add to the queue.")}
                </span>
              </span>
            </label>

            <label className="flex cursor-pointer items-start gap-3 rounded-[var(--radius-card)] border border-border bg-surface-soft p-4">
              <input
                type="checkbox"
                checked={regenerateExisting}
                onChange={(event) => onRegenerateExistingChange(event.target.checked)}
                className="mt-1 h-4 w-4 rounded border-border bg-transparent text-emerald-400"
              />
              <span>
                <span className="block text-sm font-black text-text">
                  {t("products.bulk.regenerateExisting", "Regenerate existing items")}
                </span>
                <span className="mt-1 block text-xs leading-5 text-text-muted">
                  {t("products.bulk.regenerateExistingDescription", "Create a fresh thermal job for colors already in the queue.")}
                </span>
              </span>
            </label>
          </div>

          <div className="space-y-4">
            <div className="rounded-[var(--radius-card)] border border-border bg-surface-soft p-4">
              <div className="flex items-center justify-between gap-3">
                <h3 className="m1-section-title uppercase tracking-[0.18em] text-text-muted">
                  {t("products.bulk.selectionSummary", "Selection")}
                </h3>
                <span className="rounded-full border border-border bg-surface-soft px-3 py-1 text-xs font-semibold text-text-muted">
                  {mode === "selected" ? `${totalSelectedColors}/${totalAvailableColors}` : totalAvailableColors}
                </span>
              </div>

              <div className="mt-4 max-h-[54vh] space-y-4 overflow-auto pr-1">
                {colorGroupsByProduct.map(({ row, groups }) => {
                  const productKey = String(row.id);
                  const selectedForProduct = Array.isArray(selection?.[productKey]) ? selection[productKey] : [];
                  const normalizedSelected = new Set(selectedForProduct.map(normalizeQueueColorKey));
                  return (
                    <div key={productKey} className="rounded-[var(--radius-card)] border border-border bg-surface p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-black text-text">{row.name || `Product #${row.id}`}</div>
                          <div className="mt-1 text-xs text-text-muted">
                            {groups.length} {t("products.bulk.colors", "colors")}
                          </div>
                        </div>
                        {mode === "selected" ? (
                          <button
                            type="button"
                            onClick={() => setAllForProduct(row.id, groups, normalizedSelected.size !== groups.length)}
                            className="rounded-full border border-border bg-surface-soft px-3 py-1.5 text-xs font-semibold text-text transition hover:bg-surface-hover"
                          >
                            {normalizedSelected.size === groups.length
                              ? t("products.bulk.clearSelection", "Clear")
                              : t("products.bulk.selectAll", "Select all")}
                          </button>
                        ) : null}
                      </div>

                      <div className="mt-4 flex flex-wrap gap-2">
                        {groups.length ? groups.map((group) => {
                          const colorKey = normalizeQueueColorKey(group.colorKey || group.primaryImageUrl);
                          const isChecked = mode !== "selected" || normalizedSelected.has(colorKey);
                          return (
                            <label
                              key={`${productKey}-${colorKey || group.color || "color"}`}
                              className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-2 text-sm font-semibold transition ${ isChecked ? "border-emerald-300/40 bg-emerald-500/15 text-emerald-100" : "border-border bg-surface-soft text-text-muted hover:bg-surface-hover" }`}
                            >
                              <input
                                type="checkbox"
                                checked={isChecked}
                                disabled={mode !== "selected"}
                                onChange={() => toggleGroupSelection(row.id, colorKey)}
                                className="h-4 w-4 rounded border-border bg-transparent text-emerald-400"
                              />
                              <span className="truncate">{group.color || t("products.bulk.defaultColor", "Default")}</span>
                            </label>
                          );
                        }) : (
                          <div className="text-sm text-text-muted">{t("products.bulk.noColors", "No colors found")}</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3 border-t border-border px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm text-text-muted">
            {mode === "selected"
              ? t("products.bulk.selectedColorsCount", { count: totalSelectedColors, defaultValue: `${totalSelectedColors} colors selected` })
              : t("products.bulk.allColorsCount", { count: totalAvailableColors, defaultValue: `${totalAvailableColors} colors will be queued` })}
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-[var(--radius-control)] border border-border bg-surface-soft px-4 py-2.5 text-sm font-semibold text-text transition hover:bg-surface-hover"
              disabled={submitting}
            >
              {t("common.cancel", "Cancel")}
            </button>
            <button
              type="button"
              onClick={onSubmit}
              disabled={submitting || !selectedRows.length || (mode === "selected" && totalSelectedColors === 0)}
              className="inline-flex items-center gap-2 rounded-[var(--radius-control)] bg-primary px-4 py-2.5 text-sm font-black text-[var(--primary-contrast)] transition hover:bg-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Barcode size={16} />
              {submitting
                ? t("common.loading", "Loading...")
                : t("products.bulk.addToBarcodePrintQueue", "إضافة إلى قائمة الملصقات")}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

const ProductMobileCard = memo(function ProductMobileCard({ row, selected, onToggleSelected, onOpen, statusKey, status, storefrontVisible, totalStock, lowStockAlert, displayCost, concealCost, sellingPrice, salePrice, displaySku, actions, onColorImagesClick, t, language }) {
  const visibleActions = (actions || []).slice(0, 4);
  const overflowActions = (actions || []).slice(4);
  const [moreOpen, setMoreOpen] = useState(false);
  const productType = getProductTypeValue(row);
  const category = isMeaningfulCategory(row.category) ? String(row.category).trim() : "";

  return (
    <article className="rounded-[var(--radius-card)] border border-border bg-surface-soft p-3 shadow-xl shadow-black/10">
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelected}
          className="mt-2 shrink-0"
          aria-label={t("products.bulk.selected")}
        />
        <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-start gap-3 text-start">
          <ProductThumbnail row={row} />
          <div className="min-w-0 flex-1">
            <div className="line-clamp-2 text-sm font-black leading-5 text-text">{row.name}</div>
            {displaySku ? <div className="mt-1 truncate text-xs font-semibold text-text-muted">SKU {displaySku}</div> : null}
            <ProductArticleBadges row={row} />
            <div className="mt-2 flex flex-wrap gap-1.5">
              <span
                className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-black ${ statusKey === "active" ? "bg-emerald-500/15 text-emerald-300" : statusKey === "low" ? "bg-amber-500/15 text-amber-300" : statusKey === "out" ? "bg-red-500/15 text-red-300" : "bg-border-strong text-text-muted" }`}
              >
                {status}
              </span>
              <span
                className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-black ${ storefrontVisible ? "bg-primary/15 text-primary" : "bg-border-strong text-text-muted" }`}
              >
                {storefrontVisible
                  ? t("products.storefront.visible", "ظاهر بالموقع")
                  : t("products.storefront.hidden", "مخفي من الموقع")}
              </span>
              <ProductAudienceBadges row={row} language={language} />
              <ProductColorImageBadge row={row} onClick={onColorImagesClick} />
            </div>
          </div>
        </button>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-[var(--radius-control)] border border-border bg-black/15 p-2">
          <div className="text-[10px] font-black uppercase tracking-[0.12em] text-text-muted">{t("products.table.stock")}</div>
          <div className="mt-1 text-sm font-black text-text">{totalStock}</div>
          <div className="mt-0.5 text-[11px] font-semibold text-text-muted">{t("products.stock.lowAlert")} {lowStockAlert}</div>
        </div>
        <div className="rounded-[var(--radius-control)] border border-border bg-black/15 p-2">
          <div className="text-[10px] font-black uppercase tracking-[0.12em] text-text-muted">{t("products.table.typeCategoryBrand")}</div>
          <div className="mt-1 truncate text-sm font-black text-text">{productType || category || t("products.selected.category")}</div>
          {productType && category && category.toLowerCase() !== productType.toLowerCase() ? (
            <div className="mt-0.5 truncate text-[11px] font-semibold text-primary">{category}</div>
          ) : null}
          <div className="mt-0.5 truncate text-[11px] font-semibold text-text-muted">{row.brand || t("products.selected.brand")}</div>
        </div>
      </div>

      <div className="mt-3 rounded-[var(--radius-control)] border border-border bg-black/15 p-2">
        <div className="grid grid-cols-3 gap-2 text-xs">
          <PriceLine
            label={t("products.priceLabels.cost", "Cost")}
            value={displayCost}
            tone="muted"
            concealed={concealCost}
            revealLabel={t("products.priceLabels.showCost", "إظهار التكلفة")}
            hideLabel={t("products.priceLabels.hideCost", "إخفاء التكلفة")}
          />
          <PriceLine label={t("products.priceLabels.sell", "Sell")} value={sellingPrice} tone="sell" />
          <PriceLine label={t("products.priceLabels.sale", "Sale")} value={salePrice} tone="sale" />
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        {visibleActions.map((action) => {
          const Icon = action.icon;
          const actionClassName = `inline-flex min-h-10 items-center justify-center gap-2 rounded-[var(--radius-control)] border px-3 text-xs font-black transition disabled:cursor-not-allowed disabled:opacity-40 ${
            action.tone === "danger"
              ? "border-red-300/20 bg-red-500/10 text-red-200"
              : "border-border bg-surface-soft text-text hover:bg-surface-hover"
          }`;
          const actionContent = (
            <>
              <Icon size={14} />
              <span className="truncate">{action.inlineLabel || action.label}</span>
            </>
          );
          if (action.href && !action.disabled) {
            return (
              <Link
                key={action.key}
                to={action.href}
                onClick={(event) => handleNavigableActionClick(event, action.onClick)}
                className={actionClassName}
              >
                {actionContent}
              </Link>
            );
          }
          return (
            <button
              key={action.key}
              type="button"
              onClick={action.onClick}
              disabled={action.disabled}
              className={actionClassName}
            >
              {actionContent}
            </button>
          );
        })}
        {overflowActions.length ? (
          <button
            type="button"
            onClick={() => setMoreOpen((current) => !current)}
            className={`inline-flex min-h-[var(--control-height-md)] items-center justify-center gap-2 rounded-[var(--radius-control)] border px-3 text-xs font-black transition ${ moreOpen ? "border-emerald-300/35 bg-emerald-400/10 text-emerald-100" : "border-border bg-surface-soft text-text hover:bg-surface-hover" }`}
            aria-expanded={moreOpen}
            aria-label={t("products.actionsMenu.moreActions", "المزيد من الإجراءات")}
          >
            <MoreHorizontal size={18} />
          </button>
        ) : null}
      </div>
      {moreOpen && overflowActions.length ? (
        <div className="mt-2 grid grid-cols-2 gap-2 rounded-[var(--radius-card)] border border-border bg-black/20 p-2">
          {overflowActions.map((action) => {
            const Icon = action.icon;
            const actionClassName = `inline-flex min-h-10 items-center justify-center gap-2 rounded-[var(--radius-control)] border px-3 text-xs font-black transition disabled:cursor-not-allowed disabled:opacity-40 ${
              action.tone === "danger"
                ? "border-red-300/20 bg-red-500/10 text-red-200"
                : "border-border bg-surface-soft text-text hover:bg-surface-hover"
            }`;
            const actionContent = <><Icon size={14} /><span className="truncate">{action.inlineLabel || action.label}</span></>;
            if (action.href && !action.disabled) {
              return (
                <Link
                  key={action.key}
                  to={action.href}
                  onClick={(event) => {
                    setMoreOpen(false);
                    handleNavigableActionClick(event, action.onClick);
                  }}
                  className={actionClassName}
                >
                  {actionContent}
                </Link>
              );
            }
            return (
              <button
                key={action.key}
                type="button"
                onClick={() => {
                  setMoreOpen(false);
                  action.onClick?.();
                }}
                disabled={action.disabled}
                className={actionClassName}
              >
                {actionContent}
              </button>
            );
          })}
        </div>
      ) : null}
    </article>
  );
});

function QuickRowAction({ icon: Icon, label, href = "", onClick, disabled = false, className = "" }) {
  const sharedClassName = `group/action relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-border bg-surface-soft text-text-muted opacity-75 transition hover:border-emerald-300/25 hover:bg-emerald-400/10 hover:text-emerald-100 hover:opacity-100 hover: disabled:cursor-not-allowed disabled:opacity-30 ${className}`;
  const content = (
    <>
      <Icon size={14} />
      <span className="pointer-events-none absolute bottom-full left-1/2 z-[110] mb-2 -translate-x-1/2 whitespace-nowrap rounded-[var(--radius-control)] border border-border bg-surface px-2 py-1 text-[10px] font-bold text-text opacity-0 shadow-xl shadow-black/40 transition group-hover/action:opacity-100 group-focus-visible/action:opacity-100">
        {label}
      </span>
    </>
  );

  if (href && !disabled) {
    return (
      <Link
        to={href}
        onClick={(event) => handleNavigableActionClick(event, onClick)}
        title={label}
        aria-label={label}
        className={sharedClassName}
      >
        {content}
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={sharedClassName}
    >
      {content}
    </button>
  );
}

export default ProductsList;
