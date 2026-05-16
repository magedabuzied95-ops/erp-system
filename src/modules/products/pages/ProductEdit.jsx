import { useEffect, useMemo, useRef, useState } from "react";

import { Link, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";

import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Clock3,
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
import {
  buildSmartSkuPrefix,
  buildVariantSku,
  makeUniqueSku,
  resolveBrandPayload,
  resolveBrandSelection,
  resolveCategoryPayload,
  resolveCategorySelection,
  resolveUnitPayload,
  resolveUnitSelection,
  seedBrands,
  seedCategories,
  seedUnits,
  upsertProductMeta,
} from "../lib/catalog";
import {
  applyBulkPriceToGroups,
  applyBulkSizesToGroups,
  applyBulkStockToGroups,
  createVariantRow,
  isPlaceholderVariantRow,
  parseBulkPrice,
  parseBulkSizes,
  parseBulkStock,
} from "../lib/variantBulkSizes";
import { dedupeImages } from "../lib/dedupeImages";
import colorNameFromImage, { colorNameFromImagePoint, debugColorDetection } from "../../../shared/utils/colorNameFromImage";
import {
  generateAiProductData,
  getManufacturers,
  getProductsWithVariants,
  normalizeVariantPayload,
  suggestMirrorEditionName,
  updateProduct,
  uploadProductImage,
} from "../services/productsApi";
import { isMirrorProduct, slugifyEdition } from "../../../shared/lib/mirrorProduct";
import { isInvalidEditionName } from "../../../shared/lib/editionNameGenerator";
import { safeGenerateProductDescriptions } from "../../../shared/lib/generateProductDescriptions";

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
  price: "",
  status: "active",
  gender: "",
  product_type: "",
  style: "",
  grade: "",
  variation_mode: "full_variations",
  fixed_size_label: "One Size",
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
  edition_name: formatFieldValue(defaults.edition_name),
  edition_slug: formatFieldValue(defaults.edition_slug || slugifyEdition(defaults.edition_name || "")),
  imagePreview: formatFieldValue(defaults.imagePreview),
  image_url: formatFieldValue(defaults.image_url),
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

const getPrimaryColorImage = (group = {}) => {
  const images = normalizeColorImages(group.images);
  const primary = images.find((item) => item.is_primary) || images[0] || null;
  return primary?.image_url || group.image_url || group.imagePreview || "";
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

const getGroupStockTotal = (group) => {
  if (!group) return 0;

  const sizes =
    group.sizes ||
    group.sizeVariants ||
    group.variants ||
    [];

  if (!Array.isArray(sizes)) return 0;

  return sizes.reduce((total, size) => {
    const qty = Number(
      size?.quantity ??
      size?.stock ??
      size?.stock_quantity ??
      size?.inventory_quantity ??
      0
    );

    return total + (Number.isFinite(qty) ? qty : 0);
  }, 0);
};

const normalizeColorKey = (value = "") => String(value || "default").trim().toLowerCase() || "default";

const normalizeManufacturerId = (value = "") => String(value || "").trim();

const getDefaultManufacturerName = (manufacturers = [], defaultManufacturerId = "") =>
  manufacturers.find((item) => String(item.id) === String(defaultManufacturerId))?.name || "";

const SEO_PANEL_STATE_KEY = "erp.products.seoPanelOpen";

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
  price: String(row.product_price ?? row.price ?? row.sale_price ?? ""),
  status: String(row.status || "active").toLowerCase(),
  gender: row.gender || "",
  product_type: row.product_type || "",
  style: row.style || "",
  grade: row.grade || "",
  variation_mode: row.variation_mode || "full_variations",
  fixed_size_label: row.fixed_size_label || "One Size",
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
  hasValue(row.variant_barcode) ||
  hasValue(row.variant_image_url) ||
  hasValue(row.color_image_url);

const normalizeVariantForm = (row = {}) => ({
  variantId: getVariantRowId(row),
  color: row.color || "Default",
  size: row.size || "One size",
  stock: String(row.default_purchase_qty ?? row.variant_default_purchase_qty ?? ""),
  available_stock: String(row.stock ?? row.variant_stock ?? 0),
  price: String(row.price ?? row.sale_price ?? row.variant_sale_price ?? 0),
  sku: row.sku || row.variant_sku || "",
  barcode: row.barcode || row.variant_barcode || "",
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
        manufacturer_id: normalizeManufacturerId(row.manufacturer_id) || normalizeManufacturerId(defaultManufacturerId),
        manufacturer_override:
          normalizeManufacturerId(row.manufacturer_id) !== normalizeManufacturerId(defaultManufacturerId),
        imagePreview: resolveAssetUrl(groupImage),
        image_url: groupImage,
        images: groupImages.length > 0 ? groupImages : groupImage ? [{ preview: resolveAssetUrl(groupImage), image_url: groupImage, is_primary: true }] : [],
        edition_name: row.edition_name || "",
        edition_slug: row.edition_slug || slugifyEdition(row.edition_name || ""),
        sizes: [],
      });
      groupedByColor.set(key, group);
      groups.push(group);
    }

    const group = groupedByColor.get(key);
    if (!String(group.edition_name || "").trim() && String(row.edition_name || "").trim()) {
      group.edition_name = row.edition_name || "";
      group.edition_slug = row.edition_slug || slugifyEdition(row.edition_name || "");
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
    group.sizes.push(
      createEmptySizeRow({
        variantId: row.variantId,
        isStarter: false,
        size: row.size,
        stock: row.stock,
        available_stock: row.available_stock,
        sku: row.sku,
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
  const [descriptionTouched, setDescriptionTouched] = useState({ ar: false, en: false });
  const [descriptionGenerating, setDescriptionGenerating] = useState({ ar: false, en: false });
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
  const [coverLabel, setCoverLabel] = useState("");
  const [gallery, setGallery] = useState([]);
  const [defaultManufacturerId, setDefaultManufacturerId] = useState("");
  const [colorGroups, setColorGroups] = useState([]);
  const [expandedGroupId, setExpandedGroupId] = useState("");
  const [removedVariantIds, setRemovedVariantIds] = useState([]);
  const [bulkSizesInput, setBulkSizesInput] = useState("");
  const [bulkPriceInput, setBulkPriceInput] = useState("");
  const [bulkStockInput, setBulkStockInput] = useState("");
  const [savedVariantsCount, setSavedVariantsCount] = useState(0);
  const [variantsHydrationFailed, setVariantsHydrationFailed] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [colorDetecting, setColorDetecting] = useState({});
  const [editionSuggestions, setEditionSuggestions] = useState({});
  const [aiProductData, setAiProductData] = useState(null);
  const [aiProductLoading, setAiProductLoading] = useState(false);
  const [aiProductProgress, setAiProductProgress] = useState(AI_PROGRESS_STEPS[0]);
  const [colorPickTarget, setColorPickTarget] = useState(null);
  const productId = String(id || "").trim();
  const variationMode = product.variation_mode || "full_variations";
  const isFullVariationMode = variationMode === "full_variations";
  const isColorOnlyMode = variationMode === "color_only";
  const isSimpleMode = variationMode === "simple";
  const mirrorEditionEnabled = isMirrorProduct(product);
  const descriptionContext = useMemo(
    () => ({
      name: product.name,
      brand,
      manufacturer: getDefaultManufacturerName(manufacturers, defaultManufacturerId),
      category: childCategory || subCategory || mainCategory || product.category,
      gender: product.gender,
      productType: product.product_type,
      style: product.style,
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
        gender: product.gender,
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
  useEffect(() => {
    if (!loading && !skuTouched && !String(product.sku || "").trim()) {
      setProduct((current) => ({ ...current, sku: smartSkuPrefix }));
    }
  }, [loading, product.sku, skuTouched, smartSkuPrefix]);
  const regenerateSkuPrefix = () => {
    setProduct((current) => ({ ...current, sku: smartSkuPrefix }));
    setSkuTouched(false);
  };
  const regenerateDescriptions = (target = "all") => {
    setDescriptionGenerating({ ar: target === "all" || target === "ar", en: target === "all" || target === "en" });
    window.setTimeout(() => {
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
      setDescriptionGenerating({ ar: false, en: false });
    }, 180);
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
        gallery,
        defaultManufacturerId,
        colorGroups,
      }),
    [product, mainCategory, subCategory, childCategory, brand, unit, coverImage, gallery, defaultManufacturerId, colorGroups]
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
    const shouldLeave = window.confirm("You have unsaved product changes. Leave without saving?");
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
          setCoverImage(resolveAssetUrl(firstRow.product_image_url || firstRow.image_url || ""));
          setCoverLabel(firstRow.product_image_url || firstRow.image_url ? t("products.editor.currentProductImage") : "");
          setGallery(normalizeGalleryImages(firstRow.gallery_images));
          setDefaultManufacturerId("");
          setColorGroups([]);
          return;
        }

        if (rawSavedVariants.length === 0 || variantRows.length === 0) {
          setVariantsHydrationFailed(true);
          setError(t("products.editor.variantsFailed"));
          setProduct(normalizedProduct);
          setCoverImage(resolveAssetUrl(firstRow.product_image_url || firstRow.image_url || ""));
          setCoverLabel(firstRow.product_image_url || firstRow.image_url ? t("products.editor.currentProductImage") : "");
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
        const hydratedRows = mappedColorGroups.reduce((sum, group) => sum + group.sizes.filter((row) => row.variantId).length, 0);
        console.log("[edit-product] hydrated color groups", mappedColorGroups);
        console.log("[edit-product] hydrated size rows count", hydratedRows);

        if (variantRows.length > 0 && hydratedRows !== variantRows.length) {
          console.error("[edit-product] hydration failed", {
            productId,
            expected: variantRows.length,
            hydratedRows,
            mappedColorGroups,
          });
          setVariantsHydrationFailed(true);
        setError(t("products.editor.variantsFailed"));
          setColorGroups([]);
          return;
        }

        console.log("[edit-product] loaded product", firstRow);
        console.log("[edit-product] loaded variants", variantRows);
        console.log("[edit-product] hydrated color image", mappedColorGroups.map((group) => ({
          color: group.color,
          image_url: group.image_url,
          rowImages: group.sizes.map((row) => ({ size: row.size, image_url: row.image_url })),
        })));
        console.log("[edit-product] hydrated groups", mappedColorGroups);
        console.log("[edit-product] mapped color groups", mappedColorGroups);
        mappedColorGroups.forEach((group) => {
          const primaryImage = getPrimaryColorImage(group);
          if (primaryImage) {
            colorImageUrlsRef.current.set(group.id, primaryImage);
          }
        });

        setProduct({
          ...normalizedProduct,
          category: hydratedCategory.childCategory || hydratedCategory.subCategory || hydratedCategory.mainCategory || firstRow.category || "",
          brand: hydratedBrand.brand || firstRow.brand || "",
          unit: hydratedUnit.unit || firstRow.unit || "",
        });
        setCoverImage(resolveAssetUrl(firstRow.product_image_url || firstRow.image_url || ""));
        setCoverLabel(firstRow.product_image_url || firstRow.image_url ? t("products.editor.currentProductImage") : "");
        setGallery(normalizeGalleryImages(firstRow.gallery_images));
        setDefaultManufacturerId(resolvedDefaultManufacturerId);
        setColorGroups(mappedColorGroups);
        setExpandedGroupId(mappedColorGroups[0]?.id || "");
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

  const updateProductField = (field, value) => {
    setProduct((prev) => ({ ...prev, [field]: value }));
  };

  const getEditionSuggestionInput = (group = {}) => ({
    image_url: normalizeColorImages(group.images)
      .map((image) => image.image_url || image.preview)
      .filter((image) => /^https?:\/\//i.test(String(image || "")))
      [0] || "",
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

  const getGroupManufacturerSummary = (group) => {
    const manufacturerId = normalizeManufacturerId(group?.manufacturer_id);
    if (!manufacturerId) return "No manufacturer selected";
    const label = getManufacturerName(manufacturerId);
    return group?.manufacturer_override ? `${label} Custom` : `${label} Default`;
  };

  const updateColorGroup = (groupId, field, value) => {
    setColorGroups((prev) =>
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
          error: error?.message || "No trusted match found",
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
    toast.success("Image removed");
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
          toast.error("Color image upload failed. Preview kept locally.");
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
                  sizes: [
                    ...group.sizes,
                    createEmptySizeRow({
                    image_url: getPrimaryColorImage(group) || colorImageUrlsRef.current.get(group.id) || "",
                    manufacturer_id: group.manufacturer_id || "",
                    price: product.price || "",
                  }),
                ],
              }
          : group
      )
    );
  };

  const applyBulkSizes = (targetGroupId = null) => {
    const sizes = parseBulkSizes(bulkSizesInput);
    console.log("[bulk-sizes] raw input", bulkSizesInput);
    console.log("[bulk-sizes] parsed sizes", sizes);
    console.log("[bulk-sizes] target", targetGroupId ? { groupId: targetGroupId } : "all colors");

    if (!String(bulkSizesInput || "").trim()) {
      toast.error("Enter sizes first");
      return;
    }

    if (sizes.length === 0) {
      toast.error("No valid sizes found");
      return;
    }

    const { groups: updatedGroups, addedCount, removedPlaceholderCount } = applyBulkSizesToGroups({
      groups: colorGroups,
      sizes,
      targetGroupId,
      price: product.price || 0,
    });

    console.log("[bulk-sizes] updated groups", updatedGroups);

    if (addedCount === 0 && removedPlaceholderCount === 0) {
      toast("All sizes already exist");
      return;
    }

    setColorGroups(updatedGroups);
    if (addedCount === 0) {
      toast("All sizes already exist");
      return;
    }

    toast.success("Sizes added successfully");
  };

  const applyBulkPrice = (targetGroupId = null) => {
    const parsedPrice = parseBulkPrice(bulkPriceInput);
    console.log("[bulk-price] raw input", bulkPriceInput);
    console.log("[bulk-price] parsed price", parsedPrice);
    console.log("[bulk-price] target", targetGroupId ? { groupId: targetGroupId } : "all colors");

    if (!String(bulkPriceInput || "").trim()) {
      toast.error(t("products.editor.enterPrice"));
      return;
    }

    if (parsedPrice === null) {
      toast.error(t("products.editor.enterValidPrice"));
      return;
    }

    const { groups: updatedGroups } = applyBulkPriceToGroups({
      groups: colorGroups,
      price: parsedPrice,
      targetGroupId,
    });

    console.log("[bulk-price] updated groups", updatedGroups);
    setColorGroups(updatedGroups);
    toast.success(t("products.editor.priceApplied"));
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

    const { groups: updatedGroups } = applyBulkStockToGroups({
      groups: colorGroups,
      stock: parsedStock,
      targetGroupId,
    });

    console.log("[bulk-stock] updated groups", updatedGroups);
    setColorGroups(updatedGroups);
    toast.success(t("products.editor.stockApplied"));
  };

  const handleCover = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const preview = await readFileAsDataUrl(file);
    setCoverImage(preview);
    setCoverLabel(file.name);
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
      toast.error("Upload the main product image first");
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
        toast.success("AI product suggestions are ready");
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
          suggested_style: product.style,
          suggested_product_type: product.product_type,
          gender: product.gender,
          grade: product.grade,
          dominant_colors: colorGroups.map((group) => group.color).filter(Boolean),
          detection_confidence: {
            colors: colorGroups.some((group) => String(group.color || "").trim()) ? 45 : 15,
            style: product.style ? 35 : 15,
            product_type: product.product_type ? 40 : 15,
          },
        },
      });
      toast.error("AI failed. Text generator fallback is available.");
    } finally {
      timers.forEach((timer) => window.clearTimeout(timer));
      setAiProductProgress(AI_PROGRESS_STEPS[0]);
      setAiProductLoading(false);
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
    if (field === "suggested_style") updateProductField("style", value);
    if (field === "suggested_product_type") updateProductField("product_type", value);
    if (field === "gender") updateProductField("gender", value);
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
      product.style,
      product.product_type,
      product.gender,
      product.grade,
    ].some((value) => String(value || "").trim());

    if (overwrites && !window.confirm("Apply AI suggestions and overwrite filled product fields?")) return;

    [
      "name_en",
      "description_ar",
      "description_en",
      "meta_title_en",
      "seo_description_en",
      "seo_keywords",
      "canonical_slug",
      "suggested_category",
      "suggested_style",
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
      setCoverImage(nextPrimary?.preview || nextPrimary?.image_url || nextPrimary?.url || "");
      setCoverLabel(nextPrimary?.name || "");
    }
    toast.success("Image removed");
  };

  const setGalleryItemAsPrimary = (item) => {
    const src = item?.preview || item?.image_url || item?.url || "";
    if (!src) return;
    setCoverImage(src);
    setCoverLabel(item?.name || "Gallery image");
    toast.success("Primary product image updated");
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
  };

  const updateSizeRow = (groupId, rowId, field, value) => {
    setColorGroups((prev) =>
      prev.map((group) =>
        group.id === groupId
          ? {
              ...group,
              sizes: group.sizes.map((row) =>
                row.id === rowId
                  ? {
                      ...row,
                      [field]: field === "barcode" ? String(value || "") : value,
                      isStarter: false,
                    }
                  : row
              ),
            }
          : group
      )
    );
  };

  const handleSave = async () => {
    if (!isSimpleMode && (variantsHydrationFailed || (savedVariantsCount > 0 && summary.existingRows === 0))) {
      console.error("[edit-product] save blocked due to missing variants", {
        productId,
        savedVariantsCount,
        existingRows: summary.existingRows,
        variantsHydrationFailed,
      });
      toast.error(t("products.editor.variantsFailed"));
      return;
    }

    if (!product.name.trim()) {
      toast.error("Product name is required");
      return;
    }

    const normalizedGroups = isSimpleMode
      ? []
      : colorGroups
          .map((group) => ({
            ...group,
            color: String(group.color || "").trim(),
            image_url: String(getPrimaryColorImage(group) || group.image_url || "").trim(),
            images: normalizeColorImages(group.images),
            sizes: Array.isArray(group.sizes) ? group.sizes : [],
          }))
          .filter((group) => {
            const hasAnyContent =
              Boolean(group.color) ||
              Boolean(group.edition_name) ||
              Boolean(group.image_url) ||
              (Array.isArray(group.images) && group.images.length > 0) ||
              group.sizes.some((row) => [row.size, row.stock, row.sku, row.price, row.variantId].some((value) => String(value || "").trim()));
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
          const rowHasContent = [row.stock, row.sku, row.barcode, row.price, row.variantId].some((value) =>
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
        return {
          color_name: groupColor,
          color_value: groupColor,
            images: dedupeImages(groupImages).map((image, index) => ({
            id: image.id || makeId(),
            preview: image.preview || image.image_url || "",
            image_url: image.image_url || image.preview || "",
            is_primary: image.is_primary ?? index === 0,
            name: image.name || `${groupColor} image ${index + 1}`,
          })),
        };
      })
      .filter(Boolean);

    const usedVariantSkus = new Set();
    normalizedGroups.forEach((group) => {
      const groupImageUrl = String(getPrimaryColorImage(group) || colorImageUrlsRef.current.get(group.id) || "").trim();
      const groupEditionName = mirrorEditionEnabled ? String(group.edition_name || "").trim() : "";
      const groupEditionSlug = groupEditionName ? slugifyEdition(group.edition_slug || groupEditionName) : "";
      const groupManufacturerPayload = getManufacturerPayload(group.manufacturer_id);
      if (isColorOnlyMode) {
        const sourceRow = (Array.isArray(group.sizes) ? group.sizes : [])[0] || {};
        const payload = {
          id: sourceRow.variantId || undefined,
          variant_id: sourceRow.variantId || undefined,
          color: group.color,
          size: String(product.fixed_size_label || "One Size").trim() || "One Size",
          default_purchase_qty: Number(sourceRow.stock || 0),
          sku: String(sourceRow.sku || "").trim()
            ? makeUniqueSku(String(sourceRow.sku || "").trim().toUpperCase(), usedVariantSkus)
            : buildVariantSku({
                prefix: product.sku || smartSkuPrefix,
                color: group.color,
                size: String(product.fixed_size_label || "One Size").trim() || "One Size",
                usedSkus: usedVariantSkus,
              }),
          barcode: String(sourceRow.barcode || "").trim(),
          sale_price: Number(sourceRow.price || product.price || 0),
          price: Number(sourceRow.price || product.price || 0),
          image_url: sourceRow.image_url || groupImageUrl || "",
          variant_image_url: sourceRow.image_url || groupImageUrl || "",
          color_image_url: groupImageUrl,
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
        const rowHasContent = size || row.variantId || [row.stock, row.sku, row.price].some((value) => String(value || "").trim());
        if (!rowHasContent || !size) return;

        const payload = {
          id: row.variantId || undefined,
          variant_id: row.variantId || undefined,
          color: group.color,
          size,
          default_purchase_qty: Number(row.stock || 0),
          sku: String(row.sku || "").trim()
            ? makeUniqueSku(String(row.sku || "").trim().toUpperCase(), usedVariantSkus)
            : buildVariantSku({
                prefix: product.sku || smartSkuPrefix,
                color: group.color,
                size,
                usedSkus: usedVariantSkus,
              }),
          barcode: String(row.barcode || "").trim(),
          sale_price: Number(row.price || 0),
          price: Number(row.price || 0),
          image_url: row.image_url || groupImageUrl || "",
          variant_image_url: row.image_url || groupImageUrl || "",
          color_image_url: groupImageUrl,
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

      const galleryPayload = dedupeImages(gallery).map((item) => ({
        ...item,
        image_url: item.image_url || item.preview || "",
        preview: item.preview || item.image_url || "",
      }));

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
        price: Number(product.price || 0),
        sale_price: Number(product.price || 0),
        gender: product.gender || "",
        product_type: product.product_type || "",
        style: product.style || "",
        grade: product.grade || "",
        variation_mode: product.variation_mode || "full_variations",
        fixed_size_label: isColorOnlyMode ? product.fixed_size_label || "One Size" : "",
        sku: product.sku || smartSkuPrefix,
        barcode: product.barcode || "",
        status: product.status || "active",
        image_url: coverImage,
        gallery_images: galleryPayload,
        variants: isSimpleMode ? [] : variantPayloads,
        colorImages: isSimpleMode ? [] : colorImagesPayload.map((group) => ({
          ...group,
          images: dedupeImages(group.images),
        })),
        ...getManufacturerPayload(defaultManufacturerId),
        deleted_variant_ids: [],
      });
      initialEditorSignatureRef.current = editorSignature;

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
        price: Number(product.price || 0),
        sale_price: Number(product.price || 0),
        gender: product.gender || "",
        product_type: product.product_type || "",
        style: product.style || "",
        grade: product.grade || "",
        variation_mode: product.variation_mode || "full_variations",
        fixed_size_label: isColorOnlyMode ? product.fixed_size_label || "One Size" : "",
        status: product.status || "active",
        active: product.status !== "inactive" && product.status !== "archived",
        image_url: coverImage,
        gallery: galleryPayload,
        gallery_images: galleryPayload,
      });

      toast.success("Product updated");

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
      title="Edit Product"
      description="Update product details and manage colors, sizes, images, and variant records from one editor."
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
          <p className="mt-4 text-sm font-semibold text-white">Loading product editor...</p>
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
              <h2 className="text-xl font-black text-white">Basic information</h2>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4">
              <div>
                <label className="text-sm font-semibold text-zinc-200">Product name</label>
                <input
                  value={product.name}
                  onChange={(event) => updateProductField("name", event.target.value)}
                  className="mt-1.5 h-11 w-full rounded-[14px] border border-white/10 bg-zinc-900/80 px-3.5 font-semibold text-white shadow-inner shadow-black/20 outline-none ring-1 ring-inset ring-white/[0.03] transition focus:border-emerald-300/35 focus:bg-zinc-900"
                />
              </div>

              <div className="rounded-[18px] border border-white/8 bg-white/[0.028] p-3">
                <label className="text-sm font-semibold text-zinc-200">SKU prefix</label>
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
                    Regenerate
                  </button>
                </div>
                <p className="mt-1 text-[11px] text-zinc-500">Auto: {smartSkuPrefix}</p>
              </div>

              <div className="rounded-[28px] border border-emerald-300/15 bg-gradient-to-br from-emerald-400/10 via-white/[0.055] to-cyan-400/10 p-5 shadow-[0_18px_60px_rgba(0,0,0,0.18)] transition duration-200 hover:border-emerald-300/25 hover:bg-white/[0.07]">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-base font-black text-white">Product Description (Customer-facing)</p>
                    <p className="mt-1 text-xs leading-5 text-zinc-400">Primary storefront content for catalog pages, product pages, reports, and customer-facing previews.</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => regenerateDescriptions("ar")}
                      disabled={descriptionGenerating.ar}
                      className="inline-flex h-9 items-center rounded-[12px] border border-white/10 bg-white/5 px-3 text-xs font-semibold text-zinc-100 transition hover:border-emerald-300/30 hover:bg-emerald-400/10 hover:text-emerald-100"
                    >
                      {descriptionGenerating.ar ? "Generating Arabic..." : "Regenerate Arabic Description"}
                    </button>
                    <button
                      type="button"
                      onClick={() => regenerateDescriptions("en")}
                      disabled={descriptionGenerating.en}
                      className="inline-flex h-9 items-center rounded-[12px] border border-white/10 bg-white/5 px-3 text-xs font-semibold text-zinc-100 transition hover:border-sky-300/30 hover:bg-sky-400/10 hover:text-sky-100"
                    >
                      {descriptionGenerating.en ? "Generating English..." : "Regenerate English Description"}
                    </button>
                    <button
                      type="button"
                      onClick={() => regenerateDescriptions("all")}
                      disabled={descriptionGenerating.ar || descriptionGenerating.en}
                      className="inline-flex h-9 items-center rounded-[12px] border border-amber-300/20 bg-amber-300/10 px-3 text-xs font-semibold text-amber-100 transition hover:border-amber-300/40 hover:bg-amber-300/15"
                    >
                      {descriptionGenerating.ar && descriptionGenerating.en ? "Generating..." : "Regenerate All Descriptions"}
                    </button>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
                  <div>
                    <label className="text-sm font-semibold text-zinc-200">Arabic description</label>
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
                    <label className="text-sm font-semibold text-zinc-200">English description</label>
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

              <div className={`rounded-[22px] border p-3 shadow-[0_16px_45px_rgba(0,0,0,0.18)] transition ${seoOpen ? "border-amber-300/28 bg-amber-300/[0.075]" : "border-sky-300/20 bg-sky-400/[0.06] hover:border-sky-300/32 hover:bg-sky-400/[0.09]"}`}>
                <button type="button" onClick={() => setSeoOpen((current) => !current)} className="flex w-full items-center justify-between gap-3 text-left">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] border border-amber-200/20 bg-amber-300/10 text-amber-100">
                      <Search size={17} />
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-black text-white">SEO metadata</p>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.14em] ${seoOpen ? "bg-amber-300/20 text-amber-100" : "bg-sky-300/15 text-sky-100"}`}>
                          {seoOpen ? "Expanded" : "Collapsed"}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs font-semibold text-zinc-300">Google / Facebook Preview</p>
                      <p className="mt-0.5 text-xs text-zinc-500">Advanced preview fields generated separately from product descriptions.</p>
                    </div>
                  </div>
                  <ChevronDown className={`h-5 w-5 shrink-0 text-amber-100 transition ${seoOpen ? "rotate-180" : ""}`} />
                </button>

                {seoOpen ? (
                  <div className="mt-3 border-t border-white/10 pt-3">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs font-black uppercase tracking-[0.18em] text-zinc-500">Advanced SEO</p>
                      <button
                        type="button"
                        onClick={regenerateSeoMetadata}
                        disabled={seoGenerating}
                        className="inline-flex h-9 items-center rounded-[12px] border border-white/10 bg-white/5 px-3 text-xs font-semibold text-zinc-100 transition hover:border-amber-300/30 hover:bg-amber-300/10 hover:text-amber-100"
                      >
                        {seoGenerating ? "Generating SEO..." : "Regenerate SEO Metadata"}
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
                            <p className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">store.example</p>
                            <p className="mt-1 line-clamp-1 text-sm font-black text-white">{seoPreviewTitle}</p>
                            <p className="mt-1 line-clamp-2 text-xs leading-5 text-zinc-400">{seoPreviewDescription}</p>
                          </div>
                        </div>
                      </div>
                      <div>
                        <label className="text-sm font-semibold text-zinc-300">Meta title</label>
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
                        <label className="text-sm font-semibold text-zinc-300">Canonical/slug</label>
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
                        <label className="text-sm font-semibold text-zinc-300">SEO Meta Description (Google/Facebook preview)</label>
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
                        <label className="text-sm font-semibold text-zinc-300">SEO keywords</label>
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
              productType={product.product_type}
              style={product.style}
              grade={product.grade}
              onMainCategoryChange={setMainCategory}
              onSubCategoryChange={setSubCategory}
              onChildCategoryChange={setChildCategory}
              onBrandChange={setBrand}
              onUnitChange={setUnit}
              onVariationModeChange={(value) => updateProductField("variation_mode", value)}
              onGenderChange={(value) => updateProductField("gender", value)}
              onProductTypeChange={(value) => updateProductField("product_type", value)}
              onStyleChange={(value) => updateProductField("style", value)}
              onGradeChange={(value) => updateProductField("grade", value)}
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
                      <p className="mt-4 text-sm font-semibold text-white">Add product cover image</p>
                      <p className="mt-2 text-xs text-zinc-500">PNG, JPG, WEBP</p>
                    </div>
                  )}
                  <input type="file" hidden accept="image/*" onChange={handleCover} />
                </label>
                <button
                  type="button"
                  onClick={handleGenerateAiProductData}
                  disabled={aiProductLoading || !coverImage}
                  className="mt-3 inline-flex h-11 w-full items-center justify-center gap-2 rounded-[16px] border border-blue-300/25 bg-blue-400/10 px-4 text-sm font-black text-blue-100 transition hover:border-blue-300/45 hover:bg-blue-400/15 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {aiProductLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  {aiProductLoading ? aiProductProgress : "Generate AI Product Data"}
                </button>
              </div>

              <div className="w-full rounded-[28px] border border-white/8 bg-white/5 p-5 xl:w-[380px]">
                <p className="text-sm font-semibold text-zinc-300">Product gallery</p>
                <label className="mt-4 flex min-h-[120px] cursor-pointer items-center justify-center rounded-[24px] border-2 border-dashed border-white/10 bg-zinc-950/60 text-center">
                  <div>
                    <ImagePlus className="mx-auto text-zinc-400" size={30} />
                    <p className="mt-3 text-sm font-semibold text-white">Add gallery images</p>
                    <p className="mt-1 text-xs text-zinc-500">{gallery.length} image(s)</p>
                  </div>
                  <input type="file" hidden accept="image/*" multiple onChange={handleGallery} />
                </label>

                {gallery.length > 0 ? (
                  <div className="mt-4 grid grid-cols-3 gap-3 overflow-visible">
                    {gallery.map((item) => (
                      <ImageThumbnailActions
                        key={item.id || item.name}
                        image={{ ...item, preview: resolveAssetUrl(item.preview || item.image_url) }}
                        alt={item.name || "Gallery image"}
                        className="h-20"
                        isPrimary={Boolean(coverImage && (coverImage === item.preview || coverImage === item.image_url))}
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
                    <p className="text-sm font-black text-white">AI product suggestions</p>
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
                    ["suggested_style", "Suggested style"],
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
                        <p className="text-[11px] font-black uppercase tracking-[0.16em] text-zinc-500">Detected colors</p>
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
                        <p className="text-[11px] font-black uppercase tracking-[0.16em] text-zinc-500">Detected product type</p>
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
                  {getSuggestionValue(aiProductData.suggestions, "suggested_style", "classification") ? (
                    <div className="rounded-[16px] border border-white/10 bg-zinc-950/70 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-[11px] font-black uppercase tracking-[0.16em] text-zinc-500">Detected style</p>
                        {getDetectionConfidenceLabel(aiProductData.suggestions, "style") ? (
                          <span className="shrink-0 rounded-full border border-emerald-300/20 bg-emerald-300/10 px-2 py-0.5 text-[10px] font-black text-emerald-100">
                            {getDetectionConfidenceLabel(aiProductData.suggestions, "style")}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-2 text-sm leading-5 text-zinc-200">
                        {[getSuggestionValue(aiProductData.suggestions, "suggested_style"), getSuggestionValue(aiProductData.suggestions, "classification")].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                  ) : null}
                  {getSuggestionValue(aiProductData.suggestions, "brand_resemblance") ? (
                    <div className="rounded-[16px] border border-white/10 bg-zinc-950/70 p-3">
                      <p className="text-[11px] font-black uppercase tracking-[0.16em] text-zinc-500">Brand style resemblance</p>
                      <p className="mt-2 text-sm leading-5 text-zinc-200">
                        {getSuggestionValue(aiProductData.suggestions, "brand_resemblance")}
                      </p>
                    </div>
                  ) : null}
                  {getSuggestionValue(aiProductData.suggestions, "classification") ? (
                    <div className="rounded-[16px] border border-white/10 bg-zinc-950/70 p-3">
                      <p className="text-[11px] font-black uppercase tracking-[0.16em] text-zinc-500">Classification</p>
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
                <p className="text-[11px] uppercase tracking-[0.2em] text-emerald-300">Bulk Tools</p>
                <h2 className="mt-1 text-xl font-black text-white">Add sizes and prices faster</h2>
                <p className="mt-1 max-w-3xl text-sm leading-5 text-zinc-400">
                  Enter comma-separated sizes, ranges, and one price shortcut. Existing saved variants keep their IDs.
                </p>
              </div>
            </div>

            <div className={`mt-4 grid gap-3 rounded-[20px] border border-white/8 bg-white/5 p-3 ${isFullVariationMode ? "xl:grid-cols-3" : "xl:grid-cols-2"}`}>
              {isFullVariationMode ? (
              <label className="block">
                <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
                  Bulk Sizes
                </div>
                <input
                  value={bulkSizesInput}
                  onChange={(event) => setBulkSizesInput(event.target.value)}
                  placeholder="Example: 40,41,42,43,44 or 40-45"
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
              ) : null}
              <label className="block">
                <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
                  Bulk Price
                </div>
                <input
                  type="number"
                  min="0"
                  value={bulkPriceInput}
                  onChange={(event) => setBulkPriceInput(event.target.value)}
                  placeholder="Example: 1250"
                  className="h-10 w-full rounded-[14px] border border-white/8 bg-zinc-950 px-3 text-sm text-white outline-none placeholder:text-zinc-500"
                />
                <button
                  type="button"
                  onClick={() => applyBulkPrice()}
                  className="mt-2 inline-flex h-10 w-full items-center justify-center rounded-[14px] border border-sky-500/20 bg-sky-500/10 px-4 text-sm font-semibold text-sky-200 transition hover:bg-sky-500/15"
                >
                  Apply price to all colors
                </button>
              </label>
              <label className="block">
                <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
                  Bulk default purchase quantity
                </div>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={bulkStockInput}
                  onChange={(event) => setBulkStockInput(event.target.value)}
                  placeholder="Example: 10"
                  className="h-10 w-full rounded-[14px] border border-white/8 bg-zinc-950 px-3 text-sm text-white outline-none placeholder:text-zinc-500"
                />
                <button
                  type="button"
                  onClick={() => applyBulkStock()}
                  className="mt-2 inline-flex h-10 w-full items-center justify-center rounded-[14px] border border-violet-500/20 bg-violet-500/10 px-4 text-sm font-semibold text-violet-200 transition hover:bg-violet-500/15"
                >
                  Apply default purchase quantity to all colors
                </button>
              </label>
            </div>
          </section>

          <section className={`${isSimpleMode ? "hidden" : ""} rounded-[28px] border border-white/8 bg-zinc-950/80 p-4 shadow-[0_24px_80px_rgba(0,0,0,0.22)] sm:p-5`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-black text-white">Variant color groups</h2>
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
                <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Default manufacturer</p>
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
                    <option value="">Select manufacturer</option>
                    {manufacturers.map((manufacturer) => (
                      <option key={manufacturer.id} value={String(manufacturer.id)}>
                        {manufacturer.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="rounded-[14px] border border-white/8 bg-zinc-950/60 px-3 py-2">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">Behavior</div>
                  <div className="mt-1 text-sm text-zinc-200">Default colors inherit this manufacturer automatically.</div>
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
                        <span>{getGroupStockTotal(group)} default purchase qty</span>
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
                      <div className="grid max-w-[180px] grid-cols-4 gap-1.5 overflow-visible">
                        {normalizeColorImages(group.images).map((image, imageIndex) => (
                          <div key={image.id || `${group.id}-${imageIndex}`} className="group relative z-0 aspect-square overflow-visible hover:z-20 focus-within:z-20">
                            <ImageThumbnailActions
                              image={{ ...image, preview: resolveAssetUrl(image.image_url || image.preview) }}
                              alt={image.name || group.color || "Color image"}
                              isPrimary={Boolean(image.is_primary)}
                              onPrimary={() => setPrimaryColorImage(group.id, image.id)}
                              deleteDisabled={Boolean(image.uploading)}
                              deleteDisabledReason="Image is still uploading"
                              onDelete={() => removeColorImage(group.id, image.id)}
                              className="h-full w-full rounded-[14px]"
                            />
                            <div className="absolute left-1 bottom-1 z-50 flex gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
                              <button
                                type="button"
                                onClick={() => moveColorImage(group.id, image.id, "up")}
                                className="rounded-full bg-black/70 px-1.5 py-0.5 text-[9px] font-semibold text-white disabled:opacity-30"
                                disabled={imageIndex === 0}
                              >
                                ↑
                              </button>
                              <button
                                type="button"
                                onClick={() => moveColorImage(group.id, image.id, "down")}
                                className="rounded-full bg-black/70 px-1.5 py-0.5 text-[9px] font-semibold text-white disabled:opacity-30"
                                disabled={imageIndex === normalizeColorImages(group.images).length - 1}
                              >
                                ↓
                              </button>
                            </div>
                          </div>
                        ))}
                        {normalizeColorImages(group.images).length === 0 ? (
                          <div className="col-span-4 rounded-[14px] border border-dashed border-white/10 bg-zinc-950/60 px-2 py-3 text-center text-[10px] font-semibold text-zinc-500">
                            No images
                          </div>
                        ) : null}
                      </div>
                    </div>

                    <div className="min-w-0 space-y-3">
                        <div className={`grid gap-3 ${mirrorEditionEnabled ? "xl:grid-cols-3" : "xl:grid-cols-2"}`}>
                          <div>
                            <label className="text-sm font-semibold text-zinc-300">Color name</label>
                              <input
                                value={group.color}
                                onChange={(e) => updateColorGroup(group.id, "color", e.target.value)}
                                placeholder="Black"
                                className="mt-1.5 h-10 w-full rounded-[14px] border border-white/8 bg-zinc-950 px-3 text-sm text-white outline-none placeholder:text-zinc-500"
                              />
                            <p className="mt-1 text-xs text-zinc-500">AI may confuse soles/background. Use Pick and click the real shoe color.</p>
                            {colorDetecting[group.id] ? (
                              <p className="mt-1 text-xs font-semibold text-cyan-200">Detecting color...</p>
                            ) : null}
                          </div>
                          {mirrorEditionEnabled ? (
                            <div className="relative">
                              <label className="text-sm font-semibold text-zinc-300">Edition Name</label>
                              <input
                                value={group.edition_name || ""}
                                onChange={(e) => updateColorGroup(group.id, "edition_name", e.target.value)}
                                placeholder="Example: Wolf Grey"
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
                                    <div className="text-sm font-black text-white">No trusted match found</div>
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
                              <label className="text-sm font-semibold text-zinc-300">Manufacturer</label>
                              <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-300">
                                Color level
                              </span>
                            </div>
                            <select
                              value={group.manufacturer_id || ""}
                              onChange={(e) => updateColorGroup(group.id, "manufacturer_id", e.target.value)}
                              className="h-10 w-full rounded-[14px] border border-white/8 bg-zinc-950 px-3 text-sm text-white outline-none"
                            >
                              <option value="">Select manufacturer</option>
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
                              onClick={() => applyBulkPrice(group.id)}
                              className="inline-flex h-10 items-center justify-center rounded-[14px] border border-sky-500/20 bg-sky-500/10 px-3 text-sm font-semibold text-sky-200 transition hover:bg-sky-500/15"
                            >
                              Apply price
                            </button>
                            <button
                              type="button"
                              onClick={() => applyBulkStock(group.id)}
                              className="inline-flex h-10 items-center justify-center rounded-[14px] border border-violet-500/20 bg-violet-500/10 px-3 text-sm font-semibold text-violet-200 transition hover:bg-violet-500/15"
                            >
                              Apply default quantity
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
                          </div>
                        </div>

                        <div className="rounded-[14px] border border-white/8 bg-zinc-950/60 p-3">
                          <div className="mb-3 flex items-center justify-between gap-3">
                            <div>
                              <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                                {isFullVariationMode ? "Size rows" : "Fixed size row"}
                              </p>
                              <p className="mt-0.5 text-xs text-zinc-400">
                                {isFullVariationMode
                                  ? "One row becomes one variant."
                                  : "One row per color becomes the color-only variant."}
                              </p>
                            </div>
                            <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-zinc-300">
                              {isColorOnlyMode ? 1 : group.sizes.length} row(s)
                            </div>
                          </div>

                          <div className="hidden rounded-[12px] border border-white/8 bg-white/5 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500 xl:grid xl:grid-cols-[minmax(0,1fr)_minmax(0,126px)_minmax(0,150px)_minmax(0,170px)_minmax(0,112px)_auto] xl:gap-2">
                            <div>Size</div>
                            <div>Purchase Qty</div>
                            <div>SKU</div>
                            <div>Barcode</div>
                            <div>Price</div>
                            <div>Actions</div>
                          </div>

                          <div className="mt-2 space-y-2 overflow-x-auto">
                            {(isColorOnlyMode ? group.sizes.slice(0, 1) : group.sizes).map((row, rowIndex) => (
                              <div
                                key={row.id}
                                className="grid min-w-[720px] gap-2 rounded-[12px] border border-white/8 bg-white/5 p-3 xl:min-w-0 xl:grid-cols-[minmax(0,1fr)_minmax(0,126px)_minmax(0,150px)_minmax(0,170px)_minmax(0,112px)_auto]"
                              >
                                <div>
                                  <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                                    {isColorOnlyMode ? "Fixed size" : "Size"}
                                  </label>
                                  <input
                                    value={row.size}
                                    onChange={(e) => updateSizeRow(group.id, row.id, "size", e.target.value)}
                                    placeholder={isColorOnlyMode ? product.fixed_size_label || "One Size" : "40"}
                                    className="mt-1.5 h-10 w-full rounded-[12px] border border-white/8 bg-zinc-950 px-3 text-sm text-white outline-none placeholder:text-zinc-500"
                                  />
                                </div>
                                <div>
                                  <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                                    Purchase Qty
                                  </label>
                                    <input
                                      type="number"
                                      value={row.stock}
                                      onChange={(e) => updateSizeRow(group.id, row.id, "stock", e.target.value)}
                                      placeholder="0"
                                      className="mt-1.5 h-10 w-full rounded-[12px] border border-white/8 bg-zinc-950 px-3 text-sm text-white outline-none placeholder:text-zinc-500"
                                    />
                                    <p className="mt-1 text-[10px] leading-4 text-zinc-500">لا تؤثر على المخزون — المخزون يضاف من فاتورة المشتريات</p>
                                    {row.variantId ? (
                                      <p className="mt-1 text-[11px] font-semibold text-emerald-300">
                                        Available Stock: {Number(row.available_stock || 0)}
                                      </p>
                                    ) : null}
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
                                  <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">Barcode</label>
                                  <input
                                    value={row.barcode}
                                    onChange={(e) => updateSizeRow(group.id, row.id, "barcode", e.target.value)}
                                    placeholder="Scan or enter barcode"
                                    className="mt-1.5 h-10 w-full rounded-[12px] border border-white/8 bg-zinc-950 px-3 text-sm text-white outline-none placeholder:text-zinc-500"
                                  />
                                </div>
                                <div>
                                  <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                                    Price
                                  </label>
                                  <input
                                    type="number"
                                    value={row.price}
                                    onChange={(e) => updateSizeRow(group.id, row.id, "price", e.target.value)}
                                    placeholder={product.price || "0"}
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
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
      <div className="w-full max-w-2xl rounded-[28px] border border-white/10 bg-zinc-950 p-4 shadow-2xl">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-black text-white">Pick color</p>
            <p className="mt-1 text-xs text-zinc-400">Click the real shoe material color, not the sole or background.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-2xl border border-white/10 px-3 py-2 text-sm font-semibold text-white">
            Close
          </button>
        </div>
        <div className="flex max-h-[70vh] items-center justify-center overflow-auto rounded-2xl bg-zinc-900">
          <img
            src={target.source}
            alt={target.alt || "Pick color"}
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

export default ProductEdit;

function ProductActionBar({ mode = "edit", saving = false, hasUnsavedChanges = false, onSave }) {
  const label = mode === "create" ? "Save Product" : "Update Product";

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-zinc-950/95 px-4 py-3 shadow-[0_-18px_60px_rgba(0,0,0,0.45)] backdrop-blur md:left-auto md:right-6 md:bottom-6 md:w-auto md:min-w-[360px] md:rounded-[28px] md:border">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-zinc-500">Product Editor</p>
          <p className={`mt-1 text-sm font-semibold ${hasUnsavedChanges ? "text-amber-200" : "text-emerald-200"}`}>
            {hasUnsavedChanges ? "Unsaved changes" : "All changes saved"}
          </p>
        </div>
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-5 text-sm font-black text-white shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
        >
          {saving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
          {saving ? "Saving..." : label}
        </button>
      </div>
    </div>
  );
}

