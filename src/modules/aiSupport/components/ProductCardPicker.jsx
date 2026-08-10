import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, Eye, EyeOff, Loader2, Search, ShoppingBag, SlidersHorizontal, Square, X } from "lucide-react";

import { buildAvailableProductsMessage, buildAvailableProductsUrl } from "../utils/availableProductsLink";
import { formatCurrency } from "../../../shared/lib/currency";
import { getProductAudienceValues } from "../../../shared/lib/productAudiences";
import { loadCustomerProductCatalog } from "../services/customerProductCatalog";
import SmartPosFilters from "../../pos/components/SmartPosFilters";
import { PosProductCard } from "../../pos/components/ProductGrid";
import { useProductClassifications } from "../../products/hooks/useProductClassifications";
import { classificationGroupsToFieldOptions, normalizeCanonicalProductType } from "../../products/lib/productClassifications";
import { matchesQuickFilterGroups, moveWinterCollectionToEnd, normalizeMultiFilterValue, toggleMultiFilterValue } from "../../pos/lib/posQuickFilterLogic";
import "../../pos/pages/POSPro.m1.css";
import { useTheme } from "../../../theme/useTheme";

const asArray = (value) => (Array.isArray(value) ? value : []);
const clean = (value = "") => String(value || "").trim();
const lower = (value = "") => clean(value).toLowerCase();
const money = (value) => formatCurrency(value);

const uniqueTextValues = (values = []) =>
  [...new Set(values.map((item) => clean(item)).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ar"));

const uniqueSizeValues = (values = []) =>
  [...new Set(values.map((item) => clean(item)).filter(Boolean))].sort((a, b) => {
    const left = Number(a);
    const right = Number(b);
    if (Number.isFinite(left) && Number.isFinite(right)) return left - right;
    return a.localeCompare(b, "ar");
  });

const firstText = (...values) => {
  for (const value of values) {
    const text = clean(value);
    if (text) return text;
  }
  return "";
};

const resolveStorefrontUrl = (product = {}, variant = null, color = "", size = "") => {
  const rawUrl = clean(product.storefront_url || product.product_url || product.url || "");
  const productId = product.product_id || product.id || "";
  const baseUrl = rawUrl || (productId
    ? (typeof window !== "undefined" && window.location?.origin
      ? (() => {
          try {
            return new URL(`/shop/product/${encodeURIComponent(productId)}`, window.location.origin).toString();
          } catch {
            return `/shop/product/${encodeURIComponent(productId)}`;
          }
        })()
      : `/shop/product/${encodeURIComponent(productId)}`)
    : "");
  if (!baseUrl) return "";
  try {
    const url = new URL(baseUrl, typeof window !== "undefined" && window.location?.origin ? window.location.origin : "http://localhost");
    const variantId = clean(variant?.variant_id || variant?.id || "");
    const normalizedColor = clean(color || variant?.color || variant?.color_name || variant?.variant_color || "");
    const normalizedSize = clean(size || variant?.size || variant?.size_name || variant?.variant_size || "");
    if (variantId) url.searchParams.set("variant", variantId);
    if (normalizedColor) url.searchParams.set("color", normalizedColor);
    if (normalizedSize) url.searchParams.set("size", normalizedSize);
    return url.toString();
  } catch {
    return baseUrl;
  }
};

const productImage = (product = {}, variant = null) =>
  clean(
    variant?.image_url ||
      variant?.color_image_url ||
      variant?.variant_image_url ||
      variant?.primary_image_url ||
      variant?.color_image ||
      product.product_image_url ||
      product.image_url ||
      product.image ||
      product.thumbnail_url ||
      ""
  );

const productBarcode = (product = {}) =>
  clean(product.barcode || product.product_barcode || "");

const variantBarcode = (variant = {}) =>
  clean(variant.barcode || variant.variant_barcode || "");

const productColors = (product = {}) =>
  uniqueTextValues(asArray(product.variants).map((variant) => variant.color || variant.color_name || variant.variant_color));

const productSizes = (product = {}, color = "") => {
  const normalizedColor = lower(color);
  const variants = asArray(product.variants).filter((variant) => {
    if (Number(variant.stock ?? variant.stock_quantity ?? variant.available_quantity ?? variant.quantity ?? 0) <= 0) return false;
    if (!normalizedColor) return true;
    return lower(variant.color || variant.color_name || variant.variant_color) === normalizedColor;
  });
  return uniqueSizeValues(variants.map((variant) => variant.size || variant.size_name || variant.variant_size));
};

const productGenderValues = (product = {}) => getProductAudienceValues(product);

const productTypeValues = (product = {}) =>
  uniqueTextValues([
    product.category,
    product.category_name,
    product.categoryName,
    product.product_type,
    product.productType,
    product.type,
    product.product_type_name,
    ...asArray(product.variants).flatMap((variant) => [
      variant.category,
      variant.category_name,
      variant.product_type,
      variant.type,
      variant.product_type_name,
    ]),
  ]);

const productStock = (product = {}) => asArray(product.variants).reduce((sum, variant) => sum + Math.max(0, Number(variant.stock ?? variant.stock_quantity ?? variant.available_quantity ?? 0) || 0), 0) || Math.max(0, Number(product.total_stock ?? product.stock ?? product.available_stock ?? 0) || 0);
const normalizeSmartText = (value = "") => String(value ?? "").normalize("NFKD").toLowerCase().trim();
const normalizeFilterValue = (value = "") => String(value || "").trim().toLowerCase().replace(/&/g, "and").replace(/[\s-]+/g, "_");
const normalizeAudienceValue = (value = "") => {
  const normalized = normalizeFilterValue(value);
  if (["men", "man", "male"].includes(normalized)) return "men";
  if (["women", "woman", "female", "ladies"].includes(normalized)) return "women";
  if (["kids", "kid", "children", "child", "boys", "girls"].includes(normalized)) return "kids";
  return normalized;
};

const resolveSmartFilterMatch = (value, options = []) => {
  const normalized = normalizeFilterValue(value);
  if (!normalized) return "";
  const match = asArray(options).find((option) =>
    [option?.value, option?.id, option?.name, option?.label, option?.label_ar, option?.label_en]
      .map(normalizeFilterValue)
      .filter(Boolean)
      .includes(normalized)
  );
  return normalizeFilterValue(match?.value || match?.id || normalized);
};

const getProductSmartFilterValue = (product = {}, field, options = []) => {
  const firstVariant = asArray(product.variants)[0] || {};
  if (field === "gender") return productGenderValues(product)[0] || resolveSmartFilterMatch(product.gender || firstVariant.gender, options);
  const values = field === "productType"
    ? [product.product_type, product.productType, product.type, firstVariant.product_type, firstVariant.productType, firstVariant.type]
    : [product.grade, product.product_grade, product.quality_grade, firstVariant.grade, firstVariant.product_grade];
  const rawValue = values.find((value) => clean(value));
  return field === "productType" ? normalizeCanonicalProductType(rawValue) : resolveSmartFilterMatch(rawValue, options);
};

const productBrandKey = (product = {}) => product.brand_id
  ? String(product.brand_id)
  : clean(product.brand || product.brand_name)
    ? `name:${normalizeSmartText(product.brand || product.brand_name)}`
    : "";

const productManufacturerMeta = (product = {}) => {
  const variants = asArray(product.variants);
  const ids = new Set([
    product.manufacturer_id,
    product.variant_manufacturer_id,
    ...variants.flatMap((variant) => [variant.manufacturer_id, variant.variant_manufacturer_id]),
  ].map((value) => clean(value)).filter(Boolean));
  const names = uniqueTextValues([
    product.manufacturer,
    product.manufacturer_name,
    ...variants.flatMap((variant) => [variant.manufacturer, variant.manufacturer_name]),
  ]).map(normalizeSmartText);
  return { ids, names };
};

const productTypeIcon = (value = "") => {
  const key = lower(value);
  if (key.includes("bag") || key.includes("شنط")) return "🎒";
  if (key.includes("crocs") || key.includes("slipper") || key.includes("شبشب")) return "🩴";
  if (key.includes("sneaker") || key.includes("shoe") || key.includes("حذاء")) return "👟";
  if (key.includes("boot")) return "🥾";
  return "📦";
};

const buildAvailableBySizeUrl = ({
  sizes = [],
  gender = "",
  type = "",
  brand = "",
  minPrice = "",
  maxPrice = "",
} = {}) => {
  const params = new URLSearchParams();
  uniqueSizeValues(Array.isArray(sizes) ? sizes : [sizes]).forEach((size) => params.append("size", size));
  if (clean(gender) && lower(gender) !== "all") params.set("gender", clean(gender));
  if (clean(type) && lower(type) !== "all") params.set("type", clean(type));
  if (clean(brand) && lower(brand) !== "all") params.set("brand", clean(brand));
  if (clean(minPrice)) params.set("min_price", clean(minPrice));
  if (clean(maxPrice)) params.set("max_price", clean(maxPrice));
  params.set("inStock", "1");
  const path = `/shop/products${params.toString() ? `?${params.toString()}` : ""}`;
  if (typeof window === "undefined") return path;
  return `${window.location.origin}${path}`;
};

const buildAvailableBySizeMessage = ({
  sizes = [],
  gender = "",
  type = "",
  brand = "",
  minPrice = "",
  maxPrice = "",
  url = "",
} = {}) => {
  const selectedSizes = uniqueSizeValues(Array.isArray(sizes) ? sizes : [sizes]);
  const sizeText = selectedSizes.length > 1 ? `المقاسات ${selectedSizes.join("، ")}` : `المقاس ${selectedSizes[0] || ""}`;
  const filters = [gender, type, brand, clean(minPrice) ? `أقل سعر ${clean(minPrice)}` : "", clean(maxPrice) ? `أعلى سعر ${clean(maxPrice)}` : ""]
    .map((value) => clean(value))
    .filter(Boolean);
  return [
    `دي كل الموديلات المتاحة بالمقاس${selectedSizes.length > 1 ? "ات" : ""} ${sizeText.replace(/^المقاسات?\s*/, "")}`.trim(),
    filters.length ? `الفلاتر: ${filters.join(" / ")}` : "",
    url,
  ]
    .filter(Boolean)
    .join("\n");
};

const findMatchingVariant = (product = {}, color = "", size = "") => {
  const variants = asArray(product.variants);
  if (!variants.length) return null;
  const normalizedColor = lower(color);
  const normalizedSize = lower(size);
  const availableVariants = variants.filter((variant) => Number(variant.stock ?? variant.stock_quantity ?? variant.available_quantity ?? variant.quantity ?? 0) > 0);
  const searchVariants = availableVariants.length ? availableVariants : variants;
  const exactMatch = searchVariants.find((variant) => {
    const variantColor = lower(variant.color || variant.color_name || variant.variant_color);
    const variantSize = lower(variant.size || variant.size_name || variant.variant_size);
    const colorMatches = !normalizedColor || variantColor === normalizedColor;
    const sizeMatches = !normalizedSize || variantSize === normalizedSize;
    return colorMatches && sizeMatches;
  });
  if (exactMatch) return exactMatch;
  const colorMatch = normalizedColor ? searchVariants.find((variant) => lower(variant.color || variant.color_name || variant.variant_color) === normalizedColor) : null;
  if (colorMatch) return colorMatch;
  const sizeMatch = normalizedSize ? searchVariants.find((variant) => lower(variant.size || variant.size_name || variant.variant_size) === normalizedSize) : null;
  if (sizeMatch) return sizeMatch;
  return searchVariants[0] || variants[0] || null;
};

const findMatchingColorVariant = (product = {}, color = "") => {
  const variants = asArray(product.variants);
  if (!variants.length) return null;
  const normalizedColor = lower(color);
  if (!normalizedColor) return null;
  const availableVariants = variants.filter((variant) => Number(variant.stock ?? variant.stock_quantity ?? variant.available_quantity ?? variant.quantity ?? 0) > 0);
  const searchVariants = availableVariants.length ? availableVariants : variants;
  return (
    searchVariants.find((variant) => lower(variant.color || variant.color_name || variant.variant_color) === normalizedColor) ||
    variants.find((variant) => lower(variant.color || variant.color_name || variant.variant_color) === normalizedColor) ||
    null
  );
};

const buildProductCardPayload = (product = {}, variant = null) => {
  const activeImage = productImage(product, variant);
  const activeVariantId = variant?.variant_id ?? variant?.id ?? null;
  const activeProductId = product.product_id ?? product.id ?? variant?.product_id ?? null;
  const productName = clean(product.name || product.product_name || product.title || "");
  const color = clean(variant?.color || variant?.color_name || variant?.variant_color || "");
  const size = clean(variant?.size || variant?.size_name || variant?.variant_size || "");
  const priceValue = Number(variant?.price ?? variant?.final_price ?? variant?.regular_price ?? product.final_price ?? product.price ?? 0);
  const storefrontUrl = resolveStorefrontUrl(product, variant, color, size);
  return {
    id: activeProductId,
    product_id: activeProductId,
    variant_id: activeVariantId,
    product_name: productName,
    name: productName,
    title: productName,
    display_name: productName,
    image_url: activeImage,
    image: activeImage,
    thumbnail_url: activeImage,
    media_url: clean(product.media_url || product.mediaUrl || ""),
    price: Number.isFinite(priceValue) ? priceValue : 0,
    sale_mode_applied: Boolean(variant?.sale_mode_applied || product.sale_mode_applied),
    stock: Number(variant?.stock ?? variant?.stock_quantity ?? variant?.available_quantity ?? product.total_stock ?? product.stock ?? 0) || 0,
    color,
    size,
    storefront_url: storefrontUrl,
    product_url: storefrontUrl,
    url: storefrontUrl,
    share_url: clean(product.share_url || product.shareUrl || ""),
  };
};

const sizeModeCardKey = (product = {}, variant = {}) =>
  [
    product.product_id ?? product.id ?? "",
    variant.variant_id ?? variant.id ?? "",
    variant.color || variant.color_name || variant.variant_color || "",
    variant.size || variant.size_name || variant.variant_size || "",
  ]
    .map((value) => clean(value))
    .filter(Boolean)
    .join(":");

const productHasAvailableSize = (product = {}, size = "") => {
  const normalizedSize = lower(size);
  if (!normalizedSize) return false;
  return asArray(product.variants).some((variant) => {
    const variantSize = lower(variant.size || variant.size_name || variant.variant_size);
    const stock = Number(variant.stock ?? variant.stock_quantity ?? variant.available_quantity ?? variant.quantity ?? 0);
    return stock > 0 && variantSize === normalizedSize;
  });
};

const availableSizesForProducts = (products = []) =>
  uniqueSizeValues(
    asArray(products).flatMap((product) =>
      asArray(product.variants)
        .filter((variant) => Number(variant.stock ?? variant.stock_quantity ?? variant.available_quantity ?? variant.quantity ?? 0) > 0)
        .map((variant) => variant.size || variant.size_name || variant.variant_size)
        .filter(Boolean)
    )
  );

const matchesQuery = (product = {}, query = "") => {
  const normalized = lower(query);
  if (!normalized) return true;
  const searchable = [
    product.name,
    product.product_name,
    product.title,
    product.sku,
    product.barcode,
    product.product_barcode,
    product.brand,
    product.brand_name,
    product.category,
    product.category_name,
    product.category_path,
    product.manufacturer,
    product.manufacturer_name,
    ...asArray(product.variants).flatMap((variant) => [
      variant.name,
      variant.color,
      variant.size,
      variant.sku,
      variant.barcode,
      variant.variant_barcode,
      variant.article_code,
      variant.variant_article_code,
    ]),
  ];
  return searchable.some((item) => lower(item).includes(normalized));
};

export default function ProductCardPicker({ open, onClose, onSubmit, onSubmitLink, sizeMode = false, allowMultiple = false, mode = "" }) {
  const { theme } = useTheme();
  const { groups: classificationGroups } = useProductClassifications({ includeInactive: false });
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [brand, setBrand] = useState([]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [draftPosFilters, setDraftPosFilters] = useState(null);
  const [gender, setGender] = useState([]);
  const [productType, setProductType] = useState("all");
  const [grade, setGrade] = useState("all");
  const [manufacturer, setManufacturer] = useState([]);
  const filterColor = "all";
  const filterSize = "all";
  const stockFilter = "in_stock";
  const [selectedProductId, setSelectedProductId] = useState("");
  const [selectedColor, setSelectedColor] = useState("");
  const [selectedSize, setSelectedSize] = useState("");
  const [selectedProductIds, setSelectedProductIds] = useState([]);
  const [selectedSizeCards, setSelectedSizeCards] = useState([]);
  const [selectedLinkSizes, setSelectedLinkSizes] = useState([]);
  const [selectedLinkGender, setSelectedLinkGender] = useState("all");
  const [selectedLinkTypes, setSelectedLinkTypes] = useState([]);
  const [selectedLinkBrand, setSelectedLinkBrand] = useState("all");
  const [selectedLinkMinPrice, setSelectedLinkMinPrice] = useState("");
  const [selectedLinkMaxPrice, setSelectedLinkMaxPrice] = useState("");
  const [previewCollapsed, setPreviewCollapsed] = useState(true);
  const previousOpenRef = useRef(false);
  const isDesktopViewport = typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(min-width: 768px)").matches : true;
  // The order composer uses the same dark product surface as POS, including the
  // shared SmartPosFilters drawer, instead of the lightweight PWA list.
  const posPickerMode = mode === "pos";
  const inlineFullscreenMode = mode === "inlineFullscreen" || (!isDesktopViewport && !posPickerMode);
  const darkMode = theme === "dark";

  // Load the product catalog only when the picker actually opens. Previously this
  // ran on mount, so the multi-second full-catalog fetch fired on every AI Inbox
  // open (competing with conversation/message loading) even when the picker was
  // never used. The on-open effect below still warms the module-level cache, so
  // repeat opens stay instant.
  useEffect(() => {
    if (!open) return undefined;
    let active = true;
    setLoading(true);
    setError("");
    Promise.resolve()
      .then(() => loadCustomerProductCatalog())
      .then(({ products: data }) => {
        if (!active) return;
        setProducts(asArray(data));
      })
      .catch((err) => {
        if (!active) return;
        setError(err?.message || "تعذر تحميل كتالوج المنتجات");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open]);

  const smartClassificationOptions = useMemo(
    () => classificationGroupsToFieldOptions(classificationGroups, {}, { includeInactive: false, includeCurrentValue: false }),
    [classificationGroups]
  );

  const smartProductRows = useMemo(() => products.map((product) => {
    const manufacturerMeta = productManufacturerMeta(product);
    return {
      product,
      audienceKeys: productGenderValues(product),
      productType: getProductSmartFilterValue(product, "productType", smartClassificationOptions.productType),
      grade: getProductSmartFilterValue(product, "grade", smartClassificationOptions.grade),
      brandKey: productBrandKey(product),
      manufacturerIds: manufacturerMeta.ids,
      manufacturerNames: manufacturerMeta.names,
    };
  }), [products, smartClassificationOptions]);

  const smartFilterSource = useMemo(() => smartProductRows.filter(({ product }) => {
    if (stockFilter === "in_stock" && productStock(product) <= 0) return false;
    if (stockFilter === "out_of_stock" && productStock(product) > 0) return false;
    return matchesQuery(product, search);
  }), [search, smartProductRows, stockFilter]);

  const filteredProducts = useMemo(() => smartFilterSource.filter((row) => {
    const matchesQuickFilters = matchesQuickFilterGroups(
      {
        audienceKeys: row.audienceKeys,
        brandKey: row.brandKey,
        manufacturerIds: row.manufacturerIds,
        manufacturerNames: row.manufacturerNames,
      },
      {
        genders: normalizeMultiFilterValue(gender).map(normalizeAudienceValue),
        brands: brand,
        manufacturers: manufacturer,
      },
      normalizeSmartText
    );
    const matchesProductType = productType === "all" || row.productType === normalizeFilterValue(productType);
    const matchesGrade = grade === "all" || row.grade === normalizeFilterValue(grade);
    if (filterColor !== "all" && !productColors(row.product).map(lower).includes(lower(filterColor))) return false;
    if (filterSize !== "all" && !productSizes(row.product).map(lower).includes(lower(filterSize))) return false;
    return matchesQuickFilters && matchesProductType && matchesGrade;
  }).map(({ product }) => product), [brand, filterColor, filterSize, gender, grade, manufacturer, productType, smartFilterSource]);

  const sizeLinkFilteredProducts = useMemo(() => {
    if (!sizeMode) return [];
    const searchValue = clean(search);
    const selectedBrandValue = lower(selectedLinkBrand);
    const selectedTypeValues = selectedLinkTypes.map(lower);
    const selectedGenderValue = lower(selectedLinkGender);
    const minPriceValue = clean(selectedLinkMinPrice) ? Number(selectedLinkMinPrice) : null;
    const maxPriceValue = clean(selectedLinkMaxPrice) ? Number(selectedLinkMaxPrice) : null;
    return products.filter((product) => {
      if (selectedBrandValue !== "all" && lower(product.brand || product.brand_name) !== selectedBrandValue) return false;
      if (selectedTypeValues.length && !selectedTypeValues.some((value) => productTypeValues(product).map(lower).includes(value))) return false;
      if (selectedGenderValue !== "all" && !productGenderValues(product).map(lower).includes(selectedGenderValue)) return false;
      if (!matchesQuery(product, searchValue)) return false;
      const price = Number(product?.price ?? product?.final_price ?? product?.sale_price ?? product?.selling_price ?? 0) || 0;
      if (minPriceValue !== null && Number.isFinite(minPriceValue) && price < minPriceValue) return false;
      if (maxPriceValue !== null && Number.isFinite(maxPriceValue) && price > maxPriceValue) return false;
      return true;
    });
  }, [products, search, selectedLinkBrand, selectedLinkGender, selectedLinkMaxPrice, selectedLinkMinPrice, selectedLinkTypes, sizeMode]);

  const availableSizes = useMemo(() => availableSizesForProducts(sizeMode ? sizeLinkFilteredProducts : filteredProducts), [filteredProducts, sizeLinkFilteredProducts, sizeMode]);
  const isSizeSelectionStep = Boolean(sizeMode && !selectedSize);
  const visibleProducts = useMemo(() => {
    if (!sizeMode || !selectedSize) return filteredProducts;
    return filteredProducts.filter((product) => productHasAvailableSize(product, selectedSize));
  }, [filteredProducts, selectedSize, sizeMode]);
  const visibleSizeCards = useMemo(() => {
    if (!sizeMode || !selectedSize) return [];
    const normalizedSize = lower(selectedSize);
    return filteredProducts.flatMap((product) =>
      asArray(product.variants)
        .filter((variant) => {
          const stock = Number(variant.stock ?? variant.stock_quantity ?? variant.available_quantity ?? variant.quantity ?? 0);
          const variantSize = lower(variant.size || variant.size_name || variant.variant_size);
          return stock > 0 && variantSize === normalizedSize;
        })
        .map((variant) => {
          const payload = buildProductCardPayload(product, variant);
          return {
            key: sizeModeCardKey(product, variant),
            product,
            variant,
            payload,
            productId: payload.product_id,
            variantId: payload.variant_id,
            productName: payload.product_name,
            color: payload.color,
            size: payload.size,
            image: payload.image_url,
            price: payload.price,
            storefrontUrl: payload.storefront_url,
          };
        })
    );
  }, [filteredProducts, selectedSize, sizeMode]);
  const visibleSizeCardKeySet = useMemo(() => new Set(visibleSizeCards.map((card) => card.key)), [visibleSizeCards]);
  const selectedSizeCardKeySet = useMemo(() => new Set(selectedSizeCards.map((card) => card.key)), [selectedSizeCards]);

  const posGenderOptions = useMemo(() => smartClassificationOptions.gender.map((option) => {
    const id = normalizeAudienceValue(option.value || option.id);
    return { ...option, id, name: option.label_ar || option.label_en || option.label || option.value, count: smartFilterSource.filter((row) => row.audienceKeys.includes(id)).length };
  }), [smartClassificationOptions.gender, smartFilterSource]);
  const posTypeOptions = useMemo(() => moveWinterCollectionToEnd(smartClassificationOptions.productType.map((option) => {
    const id = normalizeFilterValue(option.value || option.id);
    return { ...option, id, name: option.label_ar || option.label_en || option.label || option.value, count: smartFilterSource.filter((row) => row.productType === id).length };
  })), [smartClassificationOptions.productType, smartFilterSource]);
  const posGradeOptions = useMemo(() => smartClassificationOptions.grade.map((option) => {
    const id = normalizeFilterValue(option.value || option.id);
    return { ...option, id, name: option.label_ar || option.label_en || option.label || option.value, count: smartFilterSource.filter((row) => row.grade === id).length };
  }), [smartClassificationOptions.grade, smartFilterSource]);
  const posBrandOptions = useMemo(() => {
    const map = new Map();
    smartFilterSource.forEach(({ product, brandKey }) => {
      const name = clean(product.brand_name || product.brand);
      if (!name || lower(name) === "unbranded") return;
      const current = map.get(brandKey) || { id: brandKey, name, count: 0 };
      current.count += 1;
      map.set(brandKey, current);
    });
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, "ar"));
  }, [smartFilterSource]);
  const posManufacturerOptions = useMemo(() => {
    const map = new Map();
    smartFilterSource.forEach((row) => {
      row.manufacturerIds.forEach((id) => {
        const name = clean(row.product.manufacturer_name || row.product.manufacturer || id);
        if (!map.has(id)) map.set(id, { id, name });
      });
      row.manufacturerNames.forEach((normalizedName) => {
        const id = `name:${normalizedName}`;
        if (!map.has(id)) map.set(id, { id, name: clean(row.product.manufacturer_name || row.product.manufacturer || normalizedName) });
      });
    });
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, "ar"));
  }, [smartFilterSource]);
  const brandOptions = useMemo(() => uniqueTextValues(products.map((product) => product.brand || product.brand_name)), [products]);
  const activeFilterCount = brand.length + gender.length + manufacturer.length + [productType, grade].filter((value) => value !== "all").length;
  const openPosFilters = useCallback(() => {
    setDraftPosFilters({ gender: [...gender], productType, grade, brands: [...brand], manufacturers: [...manufacturer] });
    setFiltersOpen(true);
  }, [brand, gender, grade, manufacturer, productType]);
  const updateDraftMultiFilter = useCallback((field, value) => {
    setDraftPosFilters((current) => ({ ...(current || {}), [field]: toggleMultiFilterValue(current?.[field] || [], value) }));
  }, []);
  const updateDraftSingleFilter = useCallback((field, value) => {
    setDraftPosFilters((current) => ({ ...(current || {}), [field]: value }));
  }, []);
  const resetPosFilters = useCallback(() => {
    setDraftPosFilters({ gender: [], productType: "all", grade: "all", brands: [], manufacturers: [] });
  }, []);
  const applyPosFilters = useCallback(() => {
    if (draftPosFilters) {
      setGender(normalizeMultiFilterValue(draftPosFilters.gender));
      setProductType(draftPosFilters.productType || "all");
      setGrade(draftPosFilters.grade || "all");
      setBrand(normalizeMultiFilterValue(draftPosFilters.brands));
      setManufacturer(normalizeMultiFilterValue(draftPosFilters.manufacturers));
    }
    setFiltersOpen(false);
  }, [draftPosFilters]);
  const typeOptions = useMemo(() => uniqueTextValues(products.flatMap((product) => productTypeValues(product))), [products]);
  const genderOptions = useMemo(() => ["all", "men", "women", "kids"], []);

  useEffect(() => {
    const openedNow = open && !previousOpenRef.current;
    previousOpenRef.current = open;
    if (!openedNow) return;
    setPreviewCollapsed(true);
    if (sizeMode) {
      setSelectedProductId("");
      setSelectedProductIds([]);
      setSelectedColor("");
      setSelectedSize("");
      setSelectedSizeCards([]);
      setSelectedLinkSizes([]);
      setSelectedLinkGender("all");
      setSelectedLinkTypes([]);
      setSelectedLinkBrand("all");
      setSelectedLinkMinPrice("");
      setSelectedLinkMaxPrice("");
      return;
    }
    if (!visibleProducts.length) {
      setSelectedProductId("");
      return;
    }
    const selectedExists = visibleProducts.some((product) => String(product.product_id || product.id || "") === String(selectedProductId || ""));
    if (!selectedProductId || !selectedExists) {
      setSelectedProductId(String(visibleProducts[0].product_id || visibleProducts[0].id || ""));
    }
  }, [open, selectedProductId, sizeMode, visibleProducts]);

  const selectedProduct = useMemo(() => {
    if (!visibleProducts.length) return null;
    if (sizeMode && !selectedProductId) return null;
    const selected = visibleProducts.find((product) => String(product.product_id || product.id || "") === String(selectedProductId || ""));
    return selected || (sizeMode ? null : visibleProducts[0] || null);
  }, [selectedProductId, sizeMode, visibleProducts]);

  useEffect(() => {
    if (!selectedProduct) return;
    const colors = productColors(selectedProduct);
    const initialColor = colors.includes(selectedColor) ? selectedColor : colors[0] || "";
    if (initialColor !== selectedColor) setSelectedColor(initialColor);
    const sizes = productSizes(selectedProduct, initialColor);
    const initialSize = sizes.includes(selectedSize) ? selectedSize : sizes[0] || "";
    if (initialSize !== selectedSize) setSelectedSize(initialSize);
    if (!colors.length && selectedColor) setSelectedColor("");
    if (!sizes.length && selectedSize) setSelectedSize("");
  }, [selectedProduct, selectedColor, selectedSize]);

  const activeVariant = useMemo(() => findMatchingVariant(selectedProduct || {}, selectedColor, selectedSize), [selectedColor, selectedProduct, selectedSize]);
  const activeColorVariant = useMemo(() => findMatchingColorVariant(selectedProduct || {}, selectedColor), [selectedColor, selectedProduct]);
  const activeCard = useMemo(() => (selectedProduct ? buildProductCardPayload(selectedProduct, activeVariant) : null), [activeVariant, selectedProduct]);
  const activeImage = useMemo(() => {
    const selectedImage = firstText(
      activeColorVariant?.color_image_url,
      activeColorVariant?.colorImageUrl,
      activeColorVariant?.variant_image_url,
      activeColorVariant?.variantImageUrl,
      activeColorVariant?.primary_image_url,
      activeColorVariant?.image_url,
      activeColorVariant?.image,
      activeVariant?.color_image_url,
      activeVariant?.colorImageUrl,
      activeVariant?.variant_image_url,
      activeVariant?.variantImageUrl,
      activeVariant?.primary_image_url,
      activeVariant?.image_url,
      activeVariant?.image,
      selectedProduct?.color_image_url,
      selectedProduct?.colorImageUrl,
      selectedProduct?.variant_image_url,
      selectedProduct?.variantImageUrl,
      selectedProduct?.product_image_url,
      selectedProduct?.image_url,
      selectedProduct?.image,
      selectedProduct?.thumbnail_url
    );
    return selectedImage || productImage(selectedProduct || {}, activeVariant);
  }, [activeColorVariant, activeVariant, selectedProduct]);
  const activeColors = useMemo(() => productColors(selectedProduct || {}), [selectedProduct]);
  const activeSizes = useMemo(() => productSizes(selectedProduct || {}, selectedColor), [selectedColor, selectedProduct]);
  const activePrice = Number(activeCard?.price || 0);
  const selectedProducts = useMemo(() => {
    if (allowMultiple && selectedProductIds.length) {
      return selectedProductIds
        .map((id) => visibleProducts.find((product) => String(product.product_id || product.id || "") === String(id)))
        .filter(Boolean);
    }
    return selectedProduct ? [selectedProduct] : [];
  }, [allowMultiple, selectedProduct, selectedProductIds, visibleProducts]);

  useEffect(() => {
    if (!open || !sizeMode) return;
    if (availableSizes.length === 1 && !selectedSize) {
      setSelectedSize(availableSizes[0]);
    }
  }, [availableSizes, open, selectedSize, sizeMode]);

  useEffect(() => {
    if (!open || !sizeMode) return;
    if (availableSizes.length === 1 && !selectedLinkSizes.length) {
      setSelectedLinkSizes([availableSizes[0]]);
    }
  }, [availableSizes, open, selectedLinkSizes.length, sizeMode]);

  useEffect(() => {
    if (!open) return;
    setSelectedProductIds((current) => current.filter((id) => visibleProducts.some((product) => String(product.product_id || product.id || "") === String(id))));
  }, [open, visibleProducts]);

  useEffect(() => {
    if (!sizeMode || !selectedSize) return;
    setSelectedSizeCards([]);
  }, [selectedSize, sizeMode]);

  const toggleProductSelection = useCallback((product) => {
    const productId = String(product.product_id || product.id || "");
    setSelectedProductId(productId);
    if (!allowMultiple) {
      setSelectedProductIds([]);
      return;
    }
    setSelectedProductIds((current) => (
      current.includes(productId)
        ? current.filter((id) => id !== productId)
        : [...current, productId]
    ));
  }, [allowMultiple]);

  const toggleSizeCardSelection = useCallback((card) => {
    setSelectedSizeCards((current) => {
      const exists = current.some((item) => item.key === card.key);
      if (exists) return current.filter((item) => item.key !== card.key);
      if (!allowMultiple) return [card];
      return [...current, card];
    });
  }, [allowMultiple]);

  const selectAllVisibleSizeCards = useCallback(() => {
    if (!visibleSizeCards.length) return;
    setSelectedSizeCards((current) => {
      const next = new Map(current.map((card) => [card.key, card]));
      visibleSizeCards.forEach((card) => {
        next.set(card.key, card);
      });
      return Array.from(next.values());
    });
  }, [visibleSizeCards]);

  const clearAllVisibleSizeCards = useCallback(() => {
    if (!visibleSizeCards.length) return;
    setSelectedSizeCards((current) => current.filter((card) => !visibleSizeCardKeySet.has(card.key)));
  }, [visibleSizeCardKeySet]);

  const submitSelection = useCallback(async () => {
    console.info("[ProductCardPicker] submit started");
    if (!activeCard || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      await onSubmit?.([activeCard]);
    } catch (err) {
      setError(err?.message || "تعذر إرسال المنتج");
    } finally {
      setSubmitting(false);
    }
  }, [activeCard, onSubmit, submitting]);

  const submitSelectionWithSizeMode = useCallback(async () => {
    console.info("[ProductCardPicker] submit started");
    const sizes = uniqueSizeValues(selectedLinkSizes);
    if (!sizes.length || submitting) return;
    const url = buildAvailableProductsUrl({
      sizes,
      gender: selectedLinkGender,
      type: selectedLinkTypes,
      brand: selectedLinkBrand,
      minPrice: selectedLinkMinPrice,
      maxPrice: selectedLinkMaxPrice,
    });
    const message = buildAvailableProductsMessage({
      sizes,
      gender: selectedLinkGender !== "all" ? selectedLinkGender : "",
      type: selectedLinkTypes,
      brand: selectedLinkBrand !== "all" ? selectedLinkBrand : "",
      minPrice: selectedLinkMinPrice,
      maxPrice: selectedLinkMaxPrice,
      url,
    });
    console.log("availableBySizeUrl", url);
    console.log("availableBySizeMessage", message);
    setSubmitting(true);
    setError("");
    try {
      if (onSubmitLink) await onSubmitLink({ url, message, sizes, gender: selectedLinkGender, type: selectedLinkTypes, brand: selectedLinkBrand, minPrice: selectedLinkMinPrice, maxPrice: selectedLinkMaxPrice });
      else await onSubmit?.([{ url, storefront_url: url, product_url: url, share_url: url, name: message, product_name: message }]);
    } catch (err) {
      setError(err?.message || "تعذر إرسال الرابط");
    } finally {
      setSubmitting(false);
    }
  }, [onSubmit, onSubmitLink, selectedLinkBrand, selectedLinkGender, selectedLinkMaxPrice, selectedLinkMinPrice, selectedLinkSizes, selectedLinkTypes, submitting]);

  if (!open || typeof document === "undefined") return null;

  if (sizeMode) {
    const normalizedSelectedSizes = uniqueSizeValues(selectedLinkSizes);
    const selectedLinkUrl = buildAvailableProductsUrl({
      sizes: normalizedSelectedSizes,
      gender: selectedLinkGender,
      type: selectedLinkTypes,
      brand: selectedLinkBrand,
      minPrice: selectedLinkMinPrice,
      maxPrice: selectedLinkMaxPrice,
    });
    const selectedLinkMessage = buildAvailableProductsMessage({
      sizes: normalizedSelectedSizes,
      gender: selectedLinkGender !== "all" ? selectedLinkGender : "",
      type: selectedLinkTypes,
      brand: selectedLinkBrand !== "all" ? selectedLinkBrand : "",
      minPrice: selectedLinkMinPrice,
      maxPrice: selectedLinkMaxPrice,
      url: selectedLinkUrl,
    });
    const matchingCount = sizeLinkFilteredProducts.filter((product) =>
      normalizedSelectedSizes.length ? normalizedSelectedSizes.some((size) => productHasAvailableSize(product, size)) : false
    ).length;

    const sizeContent = (
      <div
        className={inlineFullscreenMode ? "fixed inset-x-0 bottom-0 top-0 z-[99999] isolate overflow-hidden bg-[#111310]" : "fixed inset-0 z-[99999] isolate overflow-hidden bg-black/75 backdrop-blur-sm sm:flex sm:items-center sm:justify-center sm:p-4"}
        style={{ position: "fixed", inset: 0, top: 0, left: 0, right: 0, bottom: 0, width: "100vw", height: "100dvh", zIndex: 2147483647, isolation: "isolate" }}
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) onClose?.();
        }}
      >
        <div className="absolute inset-0 bg-black/75" aria-hidden="true" />
        <section
          data-testid="available-by-size-dialog"
          className={inlineFullscreenMode ? "relative z-10 flex h-[100dvh] max-h-[100dvh] w-full min-w-0 flex-col overflow-hidden rounded-none bg-[#111310] text-white" : "relative z-10 flex h-[100dvh] max-h-[100dvh] w-full max-w-[760px] min-w-0 flex-col overflow-hidden rounded-none border border-amber-300/20 bg-[#151714] shadow-[0_30px_90px_rgba(0,0,0,0.68)] sm:mx-auto sm:h-auto sm:max-h-[82dvh] sm:rounded-[1.35rem]"}
          style={{ position: "relative", inset: "auto", width: "100%", height: "auto", maxHeight: inlineFullscreenMode ? "100dvh" : "82dvh", margin: 0, borderRadius: inlineFullscreenMode ? 0 : "1.35rem" }}
          onMouseDown={(event) => event.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-labelledby="ai-product-card-picker-title"
          dir="rtl"
        >
          <div className="sticky top-0 z-20 flex items-start justify-between gap-3 border-b border-amber-300/15 bg-[#191b17]/95 px-4 py-3 backdrop-blur">
            <div className="min-w-0">
              <div className="text-[10px] font-black uppercase tracking-[0.22em] text-amber-300">AI INBOX</div>
              <h3 id="ai-product-card-picker-title" className="mt-1 text-lg font-black text-white">المتاح بالمقاس</h3>
              <p className="mt-1 text-xs font-semibold text-slate-400">اختر المقاس أو المقاسات ثم فلتر بالبراند أو النوع أو الجنس أو السعر، وسنرسل رابطًا واحدًا للمتجر.</p>
            </div>
            <button
              data-testid="available-by-size-close"
              type="button"
              onClick={onClose}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-white transition hover:border-amber-300/30 hover:bg-amber-300/10"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto bg-[#111310] p-4">
            <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-4">
              <div className="text-[10px] font-black uppercase tracking-[0.22em] text-amber-300">نوع المنتج</div>
              <div className="mt-2 text-lg font-black text-white">اختر نوعًا أو أكثر</div>
              <div className="mt-1 text-xs font-semibold text-slate-400">يمكنك الجمع بين أكثر من نوع في نفس الرابط.</div>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedLinkTypes([])}
                  className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-4 py-2 text-sm font-black transition ${!selectedLinkTypes.length ? "border-amber-300 bg-amber-300 text-slate-950" : "border-white/10 bg-transparent text-white hover:border-amber-300/35"}`}
                >
                  <span aria-hidden="true">✨</span>
                  الكل
                </button>
                {typeOptions.map((item) => {
                  const active = selectedLinkTypes.includes(item);
                  return (
                    <button
                      key={item}
                      type="button"
                      onClick={() => setSelectedLinkTypes((current) => current.includes(item) ? current.filter((value) => value !== item) : [...current, item])}
                      className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-4 py-2 text-sm font-black transition ${active ? "border-amber-300 bg-amber-300 text-slate-950" : "border-white/10 bg-transparent text-white hover:border-amber-300/35"}`}
                    >
                      <span className="text-base" aria-hidden="true">{productTypeIcon(item)}</span>
                      {item}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-4">
              <div className="text-[10px] font-black uppercase tracking-[0.22em] text-amber-300">المقاسات</div>
              <div className="mt-2 text-lg font-black text-white">اختر المقاس أو المقاسات</div>
              <div className="mt-1 text-xs font-semibold text-slate-400">المتجر سيُفتح مع الفلاتر المحددة تلقائيًا.</div>
              <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
                {availableSizes.length ? availableSizes.map((size) => {
                  const active = normalizedSelectedSizes.includes(size);
                  return (
                    <button
                      key={size}
                      type="button"
                      onClick={() => {
                        setSelectedLinkSizes((current) => (
                          current.includes(size) ? current.filter((item) => item !== size) : [...current, size]
                        ));
                      }}
                      className={`min-h-12 rounded-2xl border px-3 py-2 text-sm font-black transition ${active ? "border-amber-300 bg-amber-300 text-slate-950 shadow-[0_8px_22px_rgba(252,211,77,0.16)]" : "border-white/10 bg-black/25 text-white hover:border-amber-300/35 hover:bg-amber-300/10"}`}
                    >
                      {size}
                    </button>
                  );
                }) : (
                  <div className="col-span-full rounded-2xl border border-dashed border-white/10 bg-black/20 p-4 text-sm font-semibold text-slate-500">
                    لا توجد مقاسات متاحة حاليًا
                  </div>
                )}
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <label className="flex min-h-11 items-center gap-2 rounded-2xl border border-white/10 bg-transparent px-3 focus-within:border-amber-300/30">
                <span className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">Gender</span>
                <select value={selectedLinkGender} onChange={(event) => setSelectedLinkGender(event.target.value)} style={{ background: "transparent", border: 0, boxShadow: "none", backgroundImage: "none" }} className="min-w-0 flex-1 appearance-none !bg-transparent text-xs font-black text-white outline-none">
                  {genderOptions.map((option) => <option key={option} value={option}>{option === "all" ? "الكل" : option}</option>)}
                </select>
              </label>
              <label className="flex min-h-11 items-center gap-2 rounded-2xl border border-white/10 bg-transparent px-3 focus-within:border-amber-300/30">
                <span className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">Brand</span>
                <select value={selectedLinkBrand} onChange={(event) => setSelectedLinkBrand(event.target.value)} style={{ background: "transparent", border: 0, boxShadow: "none", backgroundImage: "none" }} className="min-w-0 flex-1 appearance-none !bg-transparent text-xs font-black text-white outline-none">
                  <option value="all">الكل</option>
                  {brandOptions.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="flex min-h-11 items-center gap-2 rounded-2xl border border-white/10 bg-transparent px-3 focus-within:border-amber-300/30">
                  <span className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">Min</span>
                  <input value={selectedLinkMinPrice} onChange={(event) => setSelectedLinkMinPrice(event.target.value)} inputMode="numeric" placeholder="0" style={{ background: "transparent", border: 0, boxShadow: "none" }} className="min-w-0 flex-1 !bg-transparent text-xs font-black text-white outline-none" />
                </label>
                <label className="flex min-h-11 items-center gap-2 rounded-2xl border border-white/10 bg-transparent px-3 focus-within:border-amber-300/30">
                  <span className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">Max</span>
                  <input value={selectedLinkMaxPrice} onChange={(event) => setSelectedLinkMaxPrice(event.target.value)} inputMode="numeric" placeholder="0" style={{ background: "transparent", border: 0, boxShadow: "none" }} className="min-w-0 flex-1 !bg-transparent text-xs font-black text-white outline-none" />
                </label>
              </div>
            </div>

            <div className="rounded-3xl border border-amber-300/15 bg-amber-300/[0.055] p-4">
              <div className="text-[10px] font-black uppercase tracking-[0.22em] text-amber-300">المعاينة</div>
              <div className="mt-2 text-base font-black text-white">{normalizedSelectedSizes.length ? `سيتم البحث عن ${normalizedSelectedSizes.join("، ")}` : "اختر المقاس أولًا"}</div>
              <div className="mt-1 text-xs font-semibold text-slate-400">النتائج المطابقة: {matchingCount}</div>
            </div>
          </div>

          <div className="sticky bottom-0 z-20 shrink-0 border-t border-amber-300/15 bg-[#191b17]/95 px-4 pb-[max(0.85rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur">
            <button
              data-testid="available-by-size-send"
              type="button"
              onClick={() => void submitSelectionWithSizeMode()}
              disabled={submitting || !normalizedSelectedSizes.length}
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-amber-300 text-sm font-black text-slate-950 transition hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              إرسال الرابط
            </button>
            {!normalizedSelectedSizes.length ? <div className="mt-2 text-xs text-slate-500">اختر المقاس أولًا.</div> : null}
          </div>
        </section>
      </div>
    );

    return inlineFullscreenMode ? sizeContent : createPortal(sizeContent, document.body);
  }

  const content = (
    <div
      className={`ai-pwa-product-picker ${posPickerMode ? "pos-pro-shell" : ""} ${darkMode ? "ai-pwa-product-picker--dark" : "ai-pwa-product-picker--light"} ${inlineFullscreenMode ? "fixed inset-x-0 bottom-0 top-0 z-[99999] isolate overflow-hidden bg-white" : "fixed inset-0 z-[99999] isolate overflow-hidden bg-black/70 backdrop-blur-sm sm:flex sm:items-center sm:justify-center sm:p-4"}`}
      style={{ position: "fixed", inset: 0, top: 0, left: 0, right: 0, bottom: 0, width: "100vw", height: "100dvh", zIndex: 2147482000, isolation: "isolate" }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <div className="absolute inset-0 bg-black/70" aria-hidden="true" />
      <section
        className={inlineFullscreenMode ? "relative z-10 flex h-[100dvh] max-h-[100dvh] w-full min-w-0 flex-col overflow-hidden rounded-none bg-white text-slate-900" : posPickerMode ? "relative z-10 flex h-[100dvh] max-h-[100dvh] w-full min-w-0 flex-col overflow-hidden rounded-none bg-[#171714] text-white" : "relative z-10 flex h-[100dvh] max-h-[100dvh] w-full max-w-[640px] min-w-0 flex-col overflow-hidden rounded-none border border-white/10 bg-slate-950 shadow-[0_30px_90px_rgba(0,0,0,0.65)] sm:mx-auto sm:h-auto sm:max-h-[85dvh] sm:rounded-[1.35rem]"}
        style={{ position: "relative", inset: "auto", width: "100%", height: "auto", maxHeight: posPickerMode ? "100dvh" : "85dvh", margin: 0, borderRadius: posPickerMode ? 0 : "1.35rem" }}
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-product-card-picker-title"
        dir="rtl"
      >
        <div className={inlineFullscreenMode ? "flex items-start justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3" : `sticky top-0 z-20 flex items-start justify-between gap-3 border-b border-white/10 px-4 py-3 backdrop-blur ${posPickerMode ? "bg-[#171714]/95" : "bg-slate-950/95"}`}>
          <div className="min-w-0">
            <div className={inlineFullscreenMode ? "text-[10px] font-black uppercase tracking-[0.22em] text-slate-500" : `text-[10px] font-black uppercase tracking-[0.22em] ${posPickerMode ? "text-[#d4af37]" : "text-cyan-200"}`}>AI INBOX</div>
            <h3 id="ai-product-card-picker-title" className={inlineFullscreenMode ? "mt-1 text-lg font-black text-slate-900" : "mt-1 text-lg font-black text-white"}>إرسال منتج</h3>
            <p className={inlineFullscreenMode ? "mt-1 text-xs font-semibold text-slate-600" : "mt-1 text-xs font-semibold text-zinc-500"}>ابحث بالاسم أو الباركود، ثم اختر اللون والمقاس قبل الإرسال.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={inlineFullscreenMode ? "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-900" : "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-white"}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {isSizeSelectionStep ? (
          <div className={inlineFullscreenMode ? "flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto bg-white p-4" : "absolute inset-x-0 bottom-0 top-[57px] z-20 flex min-h-0 flex-col gap-3 overflow-y-auto bg-slate-950 p-4"}>
            <div className={inlineFullscreenMode ? "rounded-3xl border border-slate-200 bg-slate-50 p-4" : "rounded-3xl border border-white/10 bg-white/[0.04] p-4"}>
              <div className={inlineFullscreenMode ? "text-[10px] font-black uppercase tracking-[0.22em] text-slate-500" : "text-[10px] font-black uppercase tracking-[0.22em] text-cyan-200"}>Size filter</div>
              <div className={inlineFullscreenMode ? "mt-2 text-lg font-black text-slate-900" : "mt-2 text-lg font-black text-white"}>اختر المقاس المتاح</div>
              <div className={inlineFullscreenMode ? "mt-1 text-xs font-semibold text-slate-600" : "mt-1 text-xs font-semibold text-slate-400"}>سيتم إظهار المنتجات التي لديها stock فعلي لهذا المقاس فقط.</div>
              <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
                {availableSizes.length ? availableSizes.map((size) => (
                  <button
                    key={size}
                    type="button"
                    onClick={() => setSelectedSize(size)}
                    className={inlineFullscreenMode ? "min-h-12 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-black text-slate-900 transition hover:border-cyan-300/30 hover:bg-cyan-50" : "min-h-12 rounded-2xl border border-white/10 bg-black/30 px-3 py-2 text-sm font-black text-white transition hover:border-cyan-300/30 hover:bg-cyan-300/10"}
                  >
                    {size}
                  </button>
                )) : (
                  <div className={inlineFullscreenMode ? "col-span-full rounded-2xl border border-dashed border-slate-200 bg-white p-4 text-sm font-semibold text-slate-500" : "col-span-full rounded-2xl border border-dashed border-white/10 bg-black/20 p-4 text-sm font-semibold text-slate-500"}>
                    لا توجد مقاسات متاحة حالياً
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : null}

        <div className={inlineFullscreenMode ? "flex min-h-0 flex-1 flex-col overflow-hidden bg-white" : "grid min-h-0 flex-1 gap-3 overflow-hidden p-3 sm:p-4 lg:grid-cols-[1.05fr_0.95fr]"}>
          <div className={inlineFullscreenMode ? "flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-4" : "flex min-h-0 flex-col gap-3 overflow-hidden"}>
            <label className="relative min-w-0">
              <Search className={`pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 ${inlineFullscreenMode ? "text-slate-400" : "text-slate-500"}`} />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="ابحث باسم المنتج أو الباركود"
                className={inlineFullscreenMode ? "h-11 w-full rounded-2xl border border-slate-200 bg-white pl-3 pr-9 text-sm font-bold text-slate-900 outline-none placeholder:text-slate-400 focus:border-cyan-300/40" : "h-11 w-full rounded-2xl border border-white/10 bg-slate-950/70 pl-3 pr-9 text-sm font-bold text-white outline-none placeholder:text-slate-600 focus:border-cyan-300/40"}
              />
            </label>

            <button type="button" onClick={openPosFilters} className="ai-pwa-pos-filter-trigger inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl border px-4 text-sm font-black transition">
              <SlidersHorizontal className="h-4 w-4" />
              فلاتر POS الذكية
              {activeFilterCount ? <span className="rounded-full bg-emerald-400 px-2 py-0.5 text-[10px] text-emerald-950">{activeFilterCount}</span> : null}
            </button>

            <div className={inlineFullscreenMode ? "min-h-0 flex-1 overflow-y-auto pr-1 pb-24" : "min-h-0 flex-1 overflow-y-auto pr-1"}>
              {loading ? (
                <div className={inlineFullscreenMode ? "grid min-h-48 place-items-center rounded-2xl border border-dashed border-slate-200 bg-white text-sm font-bold text-slate-500" : "grid min-h-48 place-items-center rounded-2xl border border-dashed border-white/10 bg-white/[0.03] text-sm font-bold text-slate-500"}>
                  <Loader2 className="ml-2 h-4 w-4 animate-spin" />
                  جاري تحميل كتالوج المنتجات...
                </div>
              ) : error ? (
                <div className="rounded-2xl border border-rose-300/20 bg-rose-400/10 p-4 text-sm font-bold text-rose-100">{error}</div>
              ) : sizeMode && selectedSize ? (
                visibleSizeCards.length ? (
                  <div className="grid gap-2">
                    {visibleSizeCards.slice(0, 80).map((card) => {
                      const isSelected = selectedSizeCardKeySet.has(card.key);
                      return (
                        <button
                          key={card.key}
                          type="button"
                          onClick={() => toggleSizeCardSelection(card)}
                          className={`relative flex items-start gap-3 rounded-2xl border p-2.5 text-right transition ${
                            isSelected ? "border-cyan-300/40 bg-cyan-300/10" : inlineFullscreenMode ? "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50" : "border-white/10 bg-slate-950/60 hover:border-white/20 hover:bg-white/[0.04]"
                          }`}
                        >
                          <span className={`absolute left-2 top-2 inline-flex h-5 w-5 items-center justify-center rounded-full border ${isSelected ? "border-cyan-300 bg-cyan-300 text-slate-950" : inlineFullscreenMode ? "border-slate-200 bg-white text-slate-400" : "border-white/20 bg-black/40 text-white/60"}`}>
                            {isSelected ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
                          </span>
                          {card.image ? (
                            <img src={card.image} alt={card.productName || "منتج"} className="h-16 w-16 shrink-0 rounded-xl object-cover" loading="lazy" />
                          ) : (
                            <span className={inlineFullscreenMode ? "grid h-16 w-16 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-400" : "grid h-16 w-16 shrink-0 place-items-center rounded-xl bg-white/[0.05] text-slate-500"}>
                              <ShoppingBag className="h-5 w-5" />
                            </span>
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className={`truncate text-sm font-black ${inlineFullscreenMode ? "text-slate-900" : "text-white"}`}>{card.productName || "منتج"}</div>
                                <div className={`mt-1 flex flex-wrap gap-1.5 text-[11px] font-bold ${inlineFullscreenMode ? "text-slate-600" : "text-slate-400"}`}>
                                  {card.color ? <span>{card.color}</span> : null}
                                  {card.size ? <span>المقاس: {card.size}</span> : null}
                                </div>
                              </div>
                              {isSelected ? <CheckCircle2 className="h-4 w-4 shrink-0 text-cyan-200" /> : null}
                            </div>
                            <div className={`mt-2 flex flex-wrap items-center gap-2 text-[11px] font-bold ${inlineFullscreenMode ? "text-slate-600" : "text-slate-400"}`}>
                              {Number.isFinite(card.price) && card.price > 0 ? <span className={`font-black ${inlineFullscreenMode ? "text-emerald-700" : "text-emerald-100"}`}>{money(card.price)}</span> : null}
                              {card.variantId ? <span>Variant: {card.variantId}</span> : null}
                            </div>
                            {card.storefrontUrl ? <div className="mt-2 truncate text-[10px] font-semibold text-slate-500">{card.storefrontUrl}</div> : null}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className={inlineFullscreenMode ? "grid min-h-48 place-items-center rounded-2xl border border-dashed border-slate-200 bg-white text-sm font-bold text-slate-500" : "grid min-h-48 place-items-center rounded-2xl border border-dashed border-white/10 bg-white/[0.03] text-sm font-bold text-slate-500"}>
                    لا توجد بطاقات متاحة لهذا المقاس
                  </div>
                )
              ) : visibleProducts.length ? (
                <div className={posPickerMode ? "grid grid-cols-2 gap-2" : "grid gap-2"}>
                  {visibleProducts.slice(0, 80).map((product) => {
                    const isActive = String(product.product_id || product.id || "") === String(selectedProduct?.product_id || selectedProduct?.id || "");
                    const isSelected = selectedProductIds.includes(String(product.product_id || product.id || ""));
                    const previewVariant = findMatchingVariant(product, isActive ? selectedColor : "", isActive ? selectedSize : "") || asArray(product.variants)[0] || null;
                    const previewImage = productImage(product, previewVariant);
                    const previewPrice = Number(previewVariant?.price ?? product.final_price ?? product.price ?? 0);
                    const previewColors = productColors(product).slice(0, 3);
                    const previewSizes = productSizes(product, previewColors[0] || "").slice(0, 3);
                    if (posPickerMode) {
                      return (
                        <div
                          key={`${product.product_id || product.id}`}
                          className={`rounded-[1.15rem] border p-0.5 transition ${isActive ? "border-[#d4af37] bg-[#d4af37]/10 shadow-[0_0_0_2px_rgba(212,175,55,0.15)]" : "border-transparent"}`}
                        >
                          <PosProductCard product={product} onSelectProduct={toggleProductSelection} />
                        </div>
                      );
                    }
                    return (
                      <button
                        key={`${product.product_id || product.id}`}
                        type="button"
                        onClick={() => toggleProductSelection(product)}
                        className={`relative flex items-start gap-3 rounded-2xl border p-2.5 text-right transition ${
                          isActive ? "border-cyan-300/40 bg-cyan-300/10" : "border-white/10 bg-slate-950/60 hover:border-white/20 hover:bg-white/[0.04]"
                        }`}
                      >
                        {allowMultiple ? (
                          <span className={`absolute left-2 top-2 inline-flex h-5 w-5 items-center justify-center rounded-full border ${isSelected ? "border-cyan-300 bg-cyan-300 text-slate-950" : inlineFullscreenMode ? "border-slate-200 bg-white text-slate-400" : "border-white/20 bg-black/40 text-white/60"}`}>
                            {isSelected ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
                          </span>
                        ) : null}
                        {previewImage ? (
                          <img src={previewImage} alt={product.name || "منتج"} className="h-16 w-16 shrink-0 rounded-xl object-cover" loading="lazy" />
                        ) : (
                          <span className={inlineFullscreenMode ? "grid h-16 w-16 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-400" : "grid h-16 w-16 shrink-0 place-items-center rounded-xl bg-white/[0.05] text-slate-500"}>
                            <ShoppingBag className="h-5 w-5" />
                          </span>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className={`truncate text-sm font-black ${inlineFullscreenMode ? "text-slate-900" : "text-white"}`}>{product.name || product.product_name || "منتج"}</div>
                              <div className={`mt-1 flex flex-wrap gap-1.5 text-[11px] font-bold ${inlineFullscreenMode ? "text-slate-600" : "text-slate-400"}`}>
                                {product.brand || product.brand_name ? <span>{product.brand || product.brand_name}</span> : null}
                                {product.category || product.category_name ? <span>{product.category || product.category_name}</span> : null}
                              </div>
                            </div>
                            {isActive ? <CheckCircle2 className="h-4 w-4 shrink-0 text-cyan-200" /> : null}
                          </div>
                          <div className={`mt-2 flex flex-wrap items-center gap-2 text-[11px] font-bold ${inlineFullscreenMode ? "text-slate-600" : "text-slate-400"}`}>
                            {Number.isFinite(previewPrice) && previewPrice > 0 ? <span className={`font-black ${inlineFullscreenMode ? "text-emerald-700" : "text-emerald-100"}`}>{money(previewPrice)}</span> : null}
                            {productBarcode(product) ? <span>باركود: {productBarcode(product)}</span> : null}
                          </div>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {previewColors.map((item) => (
                              <span key={item} className={inlineFullscreenMode ? "rounded-full border border-slate-200 bg-white px-2 py-1 text-[10px] font-bold text-slate-700" : "rounded-full border border-white/10 bg-white/[0.04] px-2 py-1 text-[10px] font-bold text-slate-300"}>{item}</span>
                            ))}
                            {previewSizes.map((item) => (
                              <span key={item} className={inlineFullscreenMode ? "rounded-full border border-slate-200 bg-white px-2 py-1 text-[10px] font-bold text-slate-700" : "rounded-full border border-white/10 bg-white/[0.04] px-2 py-1 text-[10px] font-bold text-slate-300"}>{item}</span>
                            ))}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className={inlineFullscreenMode ? "grid min-h-48 place-items-center rounded-2xl border border-dashed border-slate-200 bg-white text-sm font-bold text-slate-500" : "grid min-h-48 place-items-center rounded-2xl border border-dashed border-white/10 bg-white/[0.03] text-sm font-bold text-slate-500"}>
                  لا توجد منتجات مطابقة للبحث الحالي
                </div>
              )}
            </div>
          </div>

          <div className="min-h-0 overflow-y-auto rounded-3xl border border-white/10 bg-white/[0.035] p-3">
            {sizeMode && selectedSize ? (
              <div className="space-y-3">
                <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-4">
                  <div className={inlineFullscreenMode ? "text-[10px] font-black uppercase tracking-[0.22em] text-slate-500" : "text-[10px] font-black uppercase tracking-[0.22em] text-cyan-200"}>Size mode</div>
                  <div className={inlineFullscreenMode ? "mt-1 text-lg font-black text-slate-900" : "mt-1 text-lg font-black text-white"}>المقاس المختار: {selectedSize}</div>
                  <div className="mt-2 text-sm font-semibold text-slate-400">اختر المنتجات التي تريد إرسالها من القائمة.</div>
                  <div className="mt-3 inline-flex rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-xs font-black text-cyan-100">
                    عدد المنتجات المحددة: {selectedSizeCards.length}
                </div>
                  </div>

                <div className="rounded-2xl border border-white/10 bg-[#22221e] p-3">
                  <div className="text-sm font-black text-white">إرسال محددات المقاس</div>
                  <div className="mt-2 text-xs font-semibold leading-6 text-slate-400">
                    المنتجات الظاهرة في القائمة هي فقط التي لديها stock فعلي لهذا المقاس. لا حاجة لاختيار لون أو مقاس لكل منتج.
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={selectAllVisibleSizeCards}
                    disabled={!visibleSizeCards.length}
                    className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-cyan-300/25 bg-cyan-300/10 px-3 py-2 text-sm font-black text-cyan-100 transition hover:bg-cyan-300/15 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    تحديد الكل
                  </button>
                  <button
                    type="button"
                    onClick={clearAllVisibleSizeCards}
                    disabled={!visibleSizeCards.length}
                    className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-white/10 bg-black/30 px-3 py-2 text-sm font-black text-white transition hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    إلغاء تحديد الكل
                  </button>
                </div>

                <button
                  type="button"
                  onClick={submitSelectionWithSizeMode}
                  disabled={submitting || !selectedSizeCards.length}
                  className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-emerald-300 px-4 py-3 text-sm font-black text-slate-950 transition hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  إرسال المنتجات المحددة
                </button>

                {error ? <div className="rounded-2xl border border-rose-300/20 bg-rose-400/10 p-3 text-sm font-bold text-rose-100">{error}</div> : null}
              </div>
            ) : selectedProduct ? (
              <div className="space-y-3">
                <button
                  type="button"
                  onClick={() => setPreviewCollapsed((current) => !current)}
                  className="sticky top-0 z-10 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl border border-[#d4af37]/30 bg-[#27251f] px-4 py-2 text-sm font-black text-[#f4df9a] shadow-lg"
                >
                  {previewCollapsed ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                  {previewCollapsed ? "إظهار معاينة المنتج" : "إخفاء معاينة المنتج"}
                </button>
                <div className={previewCollapsed ? "hidden" : "space-y-3"}>
                <div className="flex items-center gap-3 overflow-hidden rounded-2xl border border-white/10 bg-[#1d1d1a] p-3">
                  {activeImage ? (
                    <img src={activeImage} alt={selectedProduct.name || "منتج"} className="h-24 w-24 shrink-0 rounded-2xl border border-white/10 bg-white object-cover" loading="lazy" />
                  ) : (
                    <div className="grid h-24 w-24 shrink-0 place-items-center rounded-2xl bg-white/[0.05]">
                      <ShoppingBag className="h-8 w-8 text-stone-500" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1 py-1">
                    <div className={inlineFullscreenMode ? "text-[10px] font-black uppercase tracking-[0.22em] text-stone-500" : "text-[10px] font-black uppercase tracking-[0.22em] text-[#d4af37]"}>Selected product</div>
                    <div className={inlineFullscreenMode ? "mt-1 truncate text-base font-black text-stone-900" : "mt-1 truncate text-base font-black text-white"}>{selectedProduct.name || selectedProduct.product_name || "منتج"}</div>
                    <div className="mt-1.5 flex flex-wrap gap-1.5 text-[10px] font-bold text-stone-400">
                      {selectedProduct.brand || selectedProduct.brand_name ? <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-1">{selectedProduct.brand || selectedProduct.brand_name}</span> : null}
                      {selectedProduct.category || selectedProduct.category_name ? <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-1">{selectedProduct.category || selectedProduct.category_name}</span> : null}
                      {productBarcode(selectedProduct) ? <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-1">باركود: {productBarcode(selectedProduct)}</span> : null}
                    </div>
                    {activePrice > 0 ? <div className="mt-2 text-sm font-black text-emerald-200">{money(activePrice)}</div> : null}
                  </div>
                </div>

                <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-3">
                  <div className="text-sm font-black text-white">اللون</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {activeColors.length ? (
                      activeColors.map((color) => {
                        const active = lower(selectedColor) === lower(color);
                        return (
                          <button
                            key={color}
                            type="button"
                            onClick={() => {
                              setSelectedColor(color);
                              const nextSizes = productSizes(selectedProduct, color);
                              if (nextSizes.length) {
                                setSelectedSize((current) => (nextSizes.some((item) => lower(item) === lower(current)) ? current : nextSizes[0]));
                              } else {
                                setSelectedSize("");
                              }
                            }}
                            className={`min-h-10 rounded-full border px-4 py-2 text-sm font-black transition ${
                              active ? "border-[#d4af37] bg-[#d4af37] text-[#171714]" : "border-white/10 bg-black/30 text-white hover:border-[#d4af37]/40 hover:bg-[#d4af37]/10"
                            }`}
                          >
                            {color}
                          </button>
                        );
                      })
                    ) : (
                      <span className="text-sm font-semibold text-slate-500">لا يوجد لون محدد</span>
                    )}
                  </div>
                </div>

                <div className="rounded-2xl border border-white/10 bg-[#22221e] p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-black text-white">المقاس</div>
                    <div className="text-[11px] font-bold text-slate-500">المقاسات المتاحة فقط</div>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {activeSizes.length ? (
                      activeSizes.map((size) => {
                        const active = lower(selectedSize) === lower(size);
                        return (
                          <button
                            key={size}
                            type="button"
                            onClick={() => setSelectedSize(size)}
                            className={`min-h-12 rounded-2xl border px-3 py-2 text-right transition ${
                              active ? "border-[#d4af37] bg-[#d4af37] text-[#171714]" : "border-white/10 bg-black/30 text-white hover:border-[#d4af37]/40 hover:bg-[#d4af37]/10"
                            }`}
                          >
                            <div className="text-xl font-black leading-none">{size}</div>
                          </button>
                        );
                      })
                    ) : (
                      <div className="col-span-full text-sm font-semibold text-slate-500">لا توجد مقاسات متاحة لهذا اللون</div>
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    console.info("[ProductCardPicker] button clicked");
                    submitSelection();
                  }}
                  disabled={submitting || (!allowMultiple ? !activeCard : !(selectedProducts.length || activeCard))}
                  className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-emerald-300 px-4 py-3 text-sm font-black text-slate-950 transition hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  إرسال المنتج
                </button>

                {error ? <div className="rounded-2xl border border-rose-300/20 bg-rose-400/10 p-3 text-sm font-bold text-rose-100">{error}</div> : null}
                </div>
              </div>
            ) : (
              <div className="grid min-h-[24rem] place-items-center rounded-2xl border border-dashed border-white/10 bg-white/[0.03] text-sm font-bold text-slate-500">
                اختر منتجًا لعرض اللون والمقاس
              </div>
            )}
          </div>
        </div>
      </section>
      <SmartPosFilters
        open={filtersOpen}
        smartFilterOptions={{ gender: posGenderOptions, productType: posTypeOptions, grade: posGradeOptions }}
        selectedGender={draftPosFilters?.gender ?? gender}
        onGenderChange={(value) => updateDraftMultiFilter("gender", value)}
        selectedProductType={draftPosFilters?.productType ?? productType}
        onProductTypeChange={(value) => updateDraftSingleFilter("productType", value)}
        selectedGrade={draftPosFilters?.grade ?? grade}
        onGradeChange={(value) => updateDraftSingleFilter("grade", value)}
        brandOptions={posBrandOptions}
        selectedBrandId={draftPosFilters?.brands ?? brand}
        onBrandChange={(value) => updateDraftMultiFilter("brands", value)}
        manufacturerOptions={posManufacturerOptions}
        selectedManufacturerId={draftPosFilters?.manufacturers ?? manufacturer}
        onManufacturerChange={(value) => updateDraftMultiFilter("manufacturers", value)}
        activeSmartFilterCount={activeFilterCount}
        onApply={applyPosFilters}
        onReset={resetPosFilters}
        onClose={() => setFiltersOpen(false)}
      />
    </div>
  );
  return inlineFullscreenMode ? content : createPortal(content, document.body);
}
