import { useEffect, useMemo, useRef, useState } from "react";

import { Link, useNavigate } from "react-router-dom";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";

import {
  Barcode,
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  GripVertical,
  ImagePlus,
  Layers3,
  Loader2,
  Plus,
  Save,
  ScanLine,
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
import "./CreateProduct.m1.css";

import {
  generateBarcode,
  generateSku,
  buildSmartSkuPrefix,
  buildVariantSku,
  collectSkuValues,
  makeUniqueSku,
  resolveBrandPayload,
  resolveCategoryPayload,
  getPreferredUnitId,
  resolveUnitPayload,
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
  isCrocsProductType,
  parseBulkSizes,
  parseBulkStock,
  sortProductSizes,
} from "../lib/variantBulkSizes";
import { dedupeImages } from "../lib/dedupeImages";
import colorNameFromImage, { colorNameFromImagePoint, debugColorDetection } from "../../../shared/utils/colorNameFromImage";
import {
  createProduct,
  generateAiProductData,
  generateProductDescription,
  getBrands,
  getManufacturers,
  getProductsWithVariants,
  normalizeVariantPayload,
  suggestMirrorEditionName,
  uploadProductImageValue,
} from "../services/productsApi";
import { isMirrorProduct, slugifyEdition } from "../../../shared/lib/mirrorProduct";
import { isInvalidEditionName } from "../../../shared/lib/editionNameGenerator";
import { safeGenerateProductDescriptions } from "../../../shared/lib/generateProductDescriptions";

const resolveAssetUrl = (url) => {
  const value = String(url || "").trim();
  if (!value) return "";
  if (value.startsWith("data:") || value.startsWith("blob:")) return value;
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("/uploads/")) return value;
  if (value.startsWith("uploads/")) return `/${value}`;
  if (value.startsWith("/")) return value;
  return `/uploads/products/${value}`;
};

const AI_PROGRESS_STEPS = ["جاري تحليل الصورة...", "جاري توليد تحسينات البحث...", "جاري توليد الأوصاف..."];

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
  return `ثقة ${Math.max(0, Math.min(100, Math.round(numeric)))}%`;
};

const getAiImagePayload = (image = "") => {
  const value = String(image || "").trim();
  if (!value) return {};
  if (value.startsWith("data:image/")) return { image_base64_optional: value };
  if (value.startsWith("blob:")) return {};
  return { image_url: value };
};

const readFileAsDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

const isDataImageUrl = (value) => typeof value === "string" && value.trim().startsWith("data:image/");

const MAX_IMAGE_UPLOAD_CONCURRENCY = 4;

const isBlobPreviewUrl = (value = "") => typeof value === "string" && value.startsWith("blob:");

const createObjectPreviewUrl = (file) => {
  if (!file || typeof URL === "undefined" || typeof URL.createObjectURL !== "function") return "";
  return URL.createObjectURL(file);
};

const revokeObjectPreviewUrl = (value = "") => {
  if (!isBlobPreviewUrl(value) || typeof URL === "undefined" || typeof URL.revokeObjectURL !== "function") return;
  URL.revokeObjectURL(value);
};

const mapWithConcurrency = async (items = [], limit = MAX_IMAGE_UPLOAD_CONCURRENCY, worker) => {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return [];

  const results = new Array(list.length);
  let cursor = 0;
  const runNext = async () => {
    while (cursor < list.length) {
      const currentIndex = cursor;
      cursor += 1;
      results[currentIndex] = await worker(list[currentIndex], currentIndex);
    }
  };

  const workerCount = Math.max(1, Math.min(limit, list.length));
  await Promise.all(Array.from({ length: workerCount }, runNext));
  return results;
};

const resolvePersistedProductImages = async ({ coverImage = "", coverImageFile = null, gallery = [] } = {}) => {
  const uploadedByPreview = new Map();
  const galleryPayload = await mapWithConcurrency(dedupeImages(gallery), MAX_IMAGE_UPLOAD_CONCURRENCY, async (item) => {
    const preview = item.preview || "";
    const source = item.image_url || item.url || preview || "";
    const file = item.file || null;
    const shouldUpload =
      (typeof File !== "undefined" && file instanceof File) ||
      (typeof Blob !== "undefined" && file instanceof Blob) ||
      isDataImageUrl(source);
    const imageUrl = shouldUpload
      ? await uploadProductImageValue(file || source, { filename: item.name || "product-gallery.png" })
      : String(source || "").trim();

    if (preview && imageUrl) uploadedByPreview.set(preview, imageUrl);
    if (source && imageUrl) uploadedByPreview.set(source, imageUrl);

    return {
      ...item,
      file: undefined,
      image_url: imageUrl,
      preview: imageUrl || preview,
    };
  });

  const coverSource = coverImage || "";
  const coverImageUrl =
    uploadedByPreview.get(coverSource) ||
    (coverImageFile && (((typeof File !== "undefined" && coverImageFile instanceof File) || (typeof Blob !== "undefined" && coverImageFile instanceof Blob)))
      ? await uploadProductImageValue(coverImageFile, { filename: coverImageFile?.name || "product-cover.png" })
      : isDataImageUrl(coverSource)
        ? await uploadProductImageValue(coverSource, { filename: "product-cover.png" })
        : String(coverSource || "").trim());

  return { coverImageUrl, galleryPayload };
};

const makeId = () =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const createEmptySizeRow = (defaults = {}) => createVariantRow(defaults);

const getColorGroupName = (group = {}) =>
  [group.color, group.color_name, group.colorName, group.name, group.label]
    .map((value) => String(value ?? "").trim())
    .find(Boolean) || "";

const createEmptyColorGroup = (defaults = {}) => {
  const source = typeof defaults === "string" ? { manufacturer_id: defaults } : defaults || {};
  return {
    id: makeId(),
    color: getColorGroupName(source),
    manufacturer_id: String(source.manufacturer_id || "").trim(),
    manufacturer_override: Boolean(source.manufacturer_override),
    planned_qty: String(
      source.default_purchase_qty ??
        source.purchase_qty ??
        source.purchase_quantity ??
        source.planned_qty ??
        source.planned_quantity ??
        source.stock_qty ??
        source.stockQty ??
        source.quantity ??
        source.bulk_purchase_qty ??
        ""
    ).trim(),
    color_article_code: String(source.color_article_code || source.colorArticleCode || "").trim(),
    edition_name: String(source.edition_name || "").trim(),
    edition_slug: String(source.edition_slug || slugifyEdition(source.edition_name || "") || "").trim(),
    imagePreview: String(source.imagePreview || "").trim(),
    image_url: String(source.image_url || "").trim(),
    thermal_image_url: String(source.thermal_image_url || "").trim(),
    images: normalizeColorImages(source.images),
    sizes: Array.isArray(source.sizes) ? source.sizes : [createEmptySizeRow()],
  };
};

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
    name: value?.name || finalPreview.split("/").pop() || `صورة لون ${index + 1}`,
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

const getThermalArtworkSourceImage = (fallbackImage = "", colorGroup = null, groups = []) => {
  const selectedGroup = colorGroup || groups.find((group) => getPrimaryColorImage(group)) || null;
  const groupImage = selectedGroup ? getPrimaryColorImage(selectedGroup) : "";
  const firstGroupImage = Array.isArray(groups) ? getPrimaryColorImage(groups.find((group) => getPrimaryColorImage(group)) || {}) : "";
  return String(groupImage || firstGroupImage || "").trim();
};

const getColorGroupThermalUrl = (group = {}) => String(group?.thermal_image_url || "").trim();
const getEligibleThermalColorGroups = (groups = []) => (Array.isArray(groups) ? groups : []).filter((group) => String(getPrimaryColorImage(group) || "").trim());

const OPTIONAL_RELATION_ID_KEYS = [
  "category_id",
  "sub_category_id",
  "child_category_id",
  "brand_id",
  "manufacturer_id",
  "unit_id",
];

const normalizeOptionalRelationId = (value) => {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text && text.toLowerCase() !== "null" && text.toLowerCase() !== "undefined" ? text : null;
};

const normalizeProductRelationIds = (payload = {}) =>
  OPTIONAL_RELATION_ID_KEYS.reduce(
    (nextPayload, key) => ({
      ...nextPayload,
      [key]: normalizeOptionalRelationId(nextPayload[key]),
    }),
    { ...payload }
  );

const getDefaultManufacturerName = (manufacturers = [], defaultManufacturerId = "") =>
  getManufacturerRecord(manufacturers, defaultManufacturerId)?.name ||
  getManufacturerRecord(manufacturers, defaultManufacturerId)?.manufacturer_name ||
  getManufacturerRecord(manufacturers, defaultManufacturerId)?.manufacturerName ||
  getManufacturerRecord(manufacturers, defaultManufacturerId)?.label ||
  "";

function getManufacturerRecord(manufacturers = [], manufacturerId = "") {
  const normalizedId = String(manufacturerId || "").trim();
  if (!normalizedId) return null;
  return (
    manufacturers.find((item) => String(item.id) === normalizedId) ||
    manufacturers.find((item) => String(item.manufacturer_id) === normalizedId) ||
    manufacturers.find((item) => String(item.manufacturerId) === normalizedId) ||
    manufacturers.find((item) => String(item.label) === normalizedId) ||
    manufacturers.find((item) => String(item.name) === normalizedId) ||
    null
  );
}

const normalizeManufacturerRows = (rows = []) =>
  rows
    .map((item) => {
      const id = String(item?.id ?? item?.manufacturer_id ?? item?.manufacturerId ?? "").trim();
      if (!id) return null;
      const name = String(item?.name ?? item?.manufacturer_name ?? item?.manufacturerName ?? item?.label ?? "").trim() || id;
      return {
        ...item,
        id,
        name,
        manufacturer_id: String(item?.manufacturer_id ?? id).trim(),
        manufacturer_name: name,
        manufacturerName: name,
        label: name,
      };
    })
    .filter((item) => item && item.active !== false && item.is_active !== false);

const unwrapBrandRows = (payload) => {
  if (Array.isArray(payload)) return payload;
  const directData = payload?.data;
  const candidates = [
    payload?.brands,
    payload?.items,
    payload?.results,
    payload?.result,
    directData,
    directData?.data,
    directData?.brands,
    directData?.items,
    directData?.results,
    payload,
  ];
  return candidates.find(Array.isArray) || [];
};

const normalizeBrandRows = (rows = []) =>
  unwrapBrandRows(rows)
    .map((item) => {
      const id = String(item?.id ?? item?.brand_id ?? item?.brandId ?? "").trim();
      const name = String(item?.name ?? item?.brand_name ?? item?.brandName ?? item?.label ?? "").trim();
      if (!id || !name) return null;
      return {
        ...item,
        id,
        brand_id: String(item?.brand_id ?? id).trim(),
        brandId: String(item?.brandId ?? id).trim(),
        name,
        brand_name: name,
        brandName: name,
        label: name,
      };
    })
    .filter((item) => item && item.active !== false && item.is_active !== false);

const SEO_PANEL_STATE_KEY = "erp.products.seoPanelOpen";

function CreateProduct() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const categories = useMemo(() => seedCategories(), []);
  const [brands, setBrands] = useState([]);
  const units = useMemo(() => seedUnits(), []);
  const [manufacturers, setManufacturers] = useState([]);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [descriptionAr, setDescriptionAr] = useState("");
  const [descriptionEn, setDescriptionEn] = useState("");
  const [descriptionTouched, setDescriptionTouched] = useState({ ar: false, en: false });
  const [descriptionGenerating, setDescriptionGenerating] = useState({ ar: false, en: false });
  const [descriptionTone, setDescriptionTone] = useState("");
  const [metaTitle, setMetaTitle] = useState("");
  const [seoDescription, setSeoDescription] = useState("");
  const [seoKeywords, setSeoKeywords] = useState("");
  const [canonicalSlug, setCanonicalSlug] = useState("");
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
  const [gender, setGender] = useState("");
  const [audiences, setAudiences] = useState([]);
  const [productType, setProductType] = useState("");
  const [grade, setGrade] = useState("");
  const [isOfferStory, setIsOfferStory] = useState(false);
  const [variationMode, setVariationMode] = useState("full_variations");
  const [fixedSizeLabel, setFixedSizeLabel] = useState("مقاس واحد");
  const [brand, setBrand] = useState("");
  const [brandId, setBrandId] = useState("");
  const [unit, setUnit] = useState(() => getPreferredUnitId(seedUnits()));
  const [barcode, setBarcode] = useState(generateBarcode());
  const [skuPrefix, setSkuPrefix] = useState("");
  const [skuPrefixTouched, setSkuPrefixTouched] = useState(false);
  const [existingSkuValues, setExistingSkuValues] = useState(() => new Set());
  const [costPrice, setCostPrice] = useState("");
  const [regularPrice, setRegularPrice] = useState("");
  const [salePrice, setSalePrice] = useState("");
  const [salePriceEnabled, setSalePriceEnabled] = useState(false);
  const [saleReason, setSaleReason] = useState("");
  const [saleStartAt, setSaleStartAt] = useState("");
  const [saleEndAt, setSaleEndAt] = useState("");
  const [wholesalePrice, setWholesalePrice] = useState("");
  const [useCustomComparePrice, setUseCustomComparePrice] = useState(false);
  const [customComparePrice, setCustomComparePrice] = useState("");
  const [purchaseAlertsEnabled, setPurchaseAlertsEnabled] = useState(true);
  const [purchaseAlertByColor, setPurchaseAlertByColor] = useState(false);
  const [cartonSize, setCartonSize] = useState("");
  const [suggestedPurchaseCartons, setSuggestedPurchaseCartons] = useState(1);
  const [active, setActive] = useState(true);
  const [trackStock, setTrackStock] = useState(true);
  const [coverImage, setCoverImage] = useState("");
  const [coverImageFile, setCoverImageFile] = useState(null);
  const [thermalImageUrl, setThermalImageUrl] = useState("");
  const [thermalImageGenerating, setThermalImageGenerating] = useState(false);
  const [gallery, setGallery] = useState([]);
  const [saving, setSaving] = useState(false);
  const [savingStep, setSavingStep] = useState("");
  const [defaultManufacturerId, setDefaultManufacturerId] = useState("");
  const [colorGroups, setColorGroups] = useState([createEmptyColorGroup()]);
  const [bulkSizesInput, setBulkSizesInput] = useState("");
  const [bulkStockInput, setBulkStockInput] = useState("");
  const [bulkArticleCodeInput, setBulkArticleCodeInput] = useState("");
  const [expandedGroupId, setExpandedGroupId] = useState(colorGroups[0]?.id || "");
  const [crocsLibraryGroupId, setCrocsLibraryGroupId] = useState("");
  const [barcodePreview, setBarcodePreview] = useState(barcode);
  const [coverLabel, setCoverLabel] = useState("");
  const [variantNotice, setVariantNotice] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [colorDetecting, setColorDetecting] = useState({});
  const [editionSuggestions, setEditionSuggestions] = useState({});
  const [aiProductData, setAiProductData] = useState(null);
  const [aiProductLoading, setAiProductLoading] = useState(false);
  const [aiProductProgress, setAiProductProgress] = useState(AI_PROGRESS_STEPS[0]);
  const [activeContentTab, setActiveContentTab] = useState("description");
  const [colorPickTarget, setColorPickTarget] = useState(null);
  const pendingColorUploadsRef = useRef(new Map());
  const colorImageUrlsRef = useRef(new Map());
  const coverObjectUrlRef = useRef("");
  const galleryObjectUrlsRef = useRef(new Set());

  const trackGalleryObjectUrl = useCallback((url) => {
    if (isBlobPreviewUrl(url)) galleryObjectUrlsRef.current.add(url);
  }, []);

  const releaseGalleryObjectUrl = useCallback((url) => {
    if (!isBlobPreviewUrl(url)) return;
    galleryObjectUrlsRef.current.delete(url);
    revokeObjectPreviewUrl(url);
  }, []);

  useEffect(() => {
    return () => {
      if (coverObjectUrlRef.current) {
        revokeObjectPreviewUrl(coverObjectUrlRef.current);
        coverObjectUrlRef.current = "";
      }
      for (const url of galleryObjectUrlsRef.current) revokeObjectPreviewUrl(url);
      galleryObjectUrlsRef.current.clear();
    };
  }, []);

  useEffect(() => {
    let active = true;

    const loadBrands = async () => {
      try {
        const rows = await getBrands();
        if (!active) return;
        const normalizedRows = normalizeBrandRows(rows);
        setBrands(normalizedRows.length > 0 ? normalizedRows : seedBrands());
      } catch (error) {
        if (!active) return;
        console.log(error);
        setBrands(seedBrands());
      }
    };

    loadBrands();

    return () => {
      active = false;
    };
  }, []);

  const isFullVariationMode = variationMode === "full_variations";
  const isColorOnlyMode = variationMode === "color_only";
  const isSimpleMode = variationMode === "simple";
  const mirrorEditionEnabled = isMirrorProduct({
    product_type: productType,
    category: childCategory || subCategory || mainCategory,
    grade,
  });
  const descriptionContext = useMemo(
    () => ({
      name,
      brand,
      manufacturer: getDefaultManufacturerName(manufacturers, defaultManufacturerId),
      category: childCategory || subCategory || mainCategory,
      gender: audiences[0] || gender,
      audiences,
      productType,
      grade,
      colors: colorGroups.map((group) => group.color),
      sizes: isColorOnlyMode ? [fixedSizeLabel] : colorGroups.flatMap((group) => group.sizes || []).map((row) => row.size),
    }),
    [
      name,
      brand,
      manufacturers,
      defaultManufacturerId,
      childCategory,
      subCategory,
      mainCategory,
      audiences,
      gender,
      productType,
      grade,
      colorGroups,
      isColorOnlyMode,
      fixedSizeLabel,
    ]
  );
  const generatedDescriptions = useMemo(() => safeGenerateProductDescriptions(descriptionContext), [descriptionContext]);
  const generatedDescriptionAr = generatedDescriptions.description_ar;
  const generatedDescriptionEn = generatedDescriptions.description_en;
  const seoPreviewTitle = metaTitle || generatedDescriptions.meta_title || name || "Product";
  const seoPreviewDescription = seoDescription || generatedDescriptions.seo_description || descriptionEn || descriptionAr || "";
  const seoPreviewSlug = canonicalSlug || generatedDescriptions.canonical_slug || "product";
  const seoPreviewUrl = `store.example/products/${seoPreviewSlug}`;
  const aiSuggestions = aiProductData?.suggestions || {};
  const selectedBrand = useMemo(() => {
    const byId = brands.find((item) => String(item.id) === String(brandId)) || null;
    if (byId) return byId;
    return brands.find((item) => String(item.name || "").trim() === String(brand || "").trim()) || null;
  }, [brand, brandId, brands]);
  const selectedBrandId = selectedBrand?.id ? String(selectedBrand.id) : brandId;
  const selectedBrandName = selectedBrand?.name || brand;
  const smartSkuPrefix = useMemo(
    () =>
      buildSmartSkuPrefix({
        name,
        brand,
        manufacturer: getDefaultManufacturerName(manufacturers, defaultManufacturerId),
        productType,
        category: childCategory || subCategory || mainCategory,
        gender: audiences[0] || gender,
        grade,
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
      name,
      brand,
      manufacturers,
      defaultManufacturerId,
      productType,
      childCategory,
      subCategory,
      mainCategory,
      audiences,
      gender,
      grade,
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
    if (!skuPrefixTouched) setSkuPrefix(uniqueSmartSkuPrefix);
  }, [skuPrefixTouched, uniqueSmartSkuPrefix]);
  const regenerateSkuPrefix = () => {
    setSkuPrefix(uniqueSmartSkuPrefix);
    setSkuPrefixTouched(false);
  };
  const regenerateDescriptions = async (target = "all") => {
    setDescriptionGenerating({ ar: target === "all" || target === "ar", en: target === "all" || target === "en" });
    try {
      const result = await generateProductDescription({
        target,
        prompt_customization: descriptionTone,
        current: {
          ...descriptionContext,
          product_name: name,
          description_ar: descriptionAr,
          description_en: descriptionEn,
          selling_vibe: descriptionTone,
        },
      });
      const next = {
        description_ar: result?.arabic_description || "",
        description_en: result?.english_description || "",
      };
      if (target === "all" || target === "ar") {
        setDescriptionAr(next.description_ar);
        setDescriptionTouched((current) => ({ ...current, ar: false }));
      }
      if (target === "all" || target === "en") {
        setDescriptionEn(next.description_en);
        setDescriptionTouched((current) => ({ ...current, en: false }));
      }
      setDescription(next.description_en || next.description_ar || descriptionEn || descriptionAr);
      if (result?.source === "OPENAI") {
        toast.success(t("products.editor.aiDescriptionsGenerated"));
      } else {
        toast(t("products.editor.openAiFallbackApplied"));
      }
    } catch (error) {
      console.error(error);
      const next = safeGenerateProductDescriptions(descriptionContext);
      if (target === "all" || target === "ar") {
        setDescriptionAr(next.description_ar);
        setDescriptionTouched((current) => ({ ...current, ar: false }));
      }
      if (target === "all" || target === "en") {
        setDescriptionEn(next.description_en);
        setDescriptionTouched((current) => ({ ...current, en: false }));
      }
      setDescription(next.description_en || next.description_ar);
      toast.error(error?.message || t("products.editor.descriptionGenerationFailed"));
    } finally {
      setDescriptionGenerating({ ar: false, en: false });
    }
  };
  const applyGeneratedVersion = (version = {}) => {
    const nextAr = String(version?.arabic_description || "").trim();
    const nextEn = String(version?.english_description || "").trim();
    if (nextAr) {
      setDescriptionAr(nextAr);
      setDescriptionTouched((current) => ({ ...current, ar: false }));
    }
    if (nextEn) {
      setDescriptionEn(nextEn);
      setDescriptionTouched((current) => ({ ...current, en: false }));
    }
    setDescription(nextEn || nextAr || "");
    if (nextAr || nextEn) {
      toast.success(t("products.editor.versionApplied", "Description version applied"));
    }
  };
  const regenerateSeoMetadata = () => {
    setSeoGenerating(true);
    window.setTimeout(() => {
      const next = safeGenerateProductDescriptions(descriptionContext);
      setMetaTitle(next.meta_title);
      setSeoDescription(next.seo_description);
      setSeoKeywords(next.seo_keywords);
      setCanonicalSlug(next.canonical_slug);
      setSeoTouched({ title: false, description: false, keywords: false, slug: false });
      setSeoGenerating(false);
    }, 180);
  };
  const hasUnsavedChanges = useMemo(
    () =>
      Boolean(
        name.trim() ||
          description.trim() ||
          descriptionAr.trim() ||
          descriptionEn.trim() ||
          metaTitle.trim() ||
          seoDescription.trim() ||
          seoKeywords.trim() ||
          canonicalSlug.trim() ||
          mainCategory ||
          subCategory ||
          childCategory ||
          gender ||
          audiences.length > 0 ||
          productType ||
          grade ||
          brand ||
          unit ||
          skuPrefix ||
          costPrice ||
          regularPrice ||
          salePrice ||
          salePriceEnabled ||
          saleReason ||
          saleStartAt ||
          saleEndAt ||
          wholesalePrice ||
          useCustomComparePrice ||
          customComparePrice ||
          purchaseAlertsEnabled !== true ||
          purchaseAlertByColor !== false ||
          String(cartonSize || "").trim() !== "" ||
          Number(suggestedPurchaseCartons || 1) !== 1 ||
          coverImage ||
          gallery.length > 0 ||
          colorGroups.some((group) =>
            Boolean(
              String(group?.color || "").trim() ||
                String(group?.article_code || "").trim() ||
                String(group?.imagePreview || "").trim() ||
                String(group?.image_url || "").trim() ||
                (Array.isArray(group?.images) && group.images.length > 0) ||
                (Array.isArray(group?.sizes) &&
                  group.sizes.some((row) =>
                    [row?.size, row?.sku, row?.price].some((value) => String(value || "").trim())
                  ))
            )
          )
      ),
    [
      name,
      description,
      descriptionAr,
      descriptionEn,
      metaTitle,
      seoDescription,
      seoKeywords,
      canonicalSlug,
      mainCategory,
      subCategory,
      childCategory,
      gender,
      audiences,
      productType,
      grade,
      brand,
      unit,
      skuPrefix,
      costPrice,
      regularPrice,
      salePrice,
      salePriceEnabled,
      saleReason,
      saleStartAt,
      saleEndAt,
      wholesalePrice,
      useCustomComparePrice,
      customComparePrice,
      purchaseAlertsEnabled,
      purchaseAlertByColor,
      cartonSize,
      suggestedPurchaseCartons,
      coverImage,
      gallery,
      colorGroups,
    ]
  );

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
    if (!descriptionTouched.ar || !descriptionAr.trim()) {
      setDescriptionAr(generatedDescriptionAr);
    }
  }, [descriptionAr, descriptionTouched.ar, generatedDescriptionAr]);

  useEffect(() => {
    if (!descriptionTouched.en || !descriptionEn.trim()) {
      setDescriptionEn(generatedDescriptionEn);
    }
  }, [descriptionEn, descriptionTouched.en, generatedDescriptionEn]);

  useEffect(() => {
    if ((!descriptionTouched.en && !descriptionTouched.ar) || !description.trim()) {
      setDescription(generatedDescriptionEn || generatedDescriptionAr);
    }
  }, [description, descriptionTouched.en, descriptionTouched.ar, generatedDescriptionEn, generatedDescriptionAr]);

  useEffect(() => {
    if (!seoTouched.title || !metaTitle.trim()) setMetaTitle(generatedDescriptions.meta_title);
  }, [generatedDescriptions.meta_title, metaTitle, seoTouched.title]);

  useEffect(() => {
    if (!seoTouched.description || !seoDescription.trim()) setSeoDescription(generatedDescriptions.seo_description);
  }, [generatedDescriptions.seo_description, seoDescription, seoTouched.description]);

  useEffect(() => {
    if (!seoTouched.keywords || !seoKeywords.trim()) setSeoKeywords(generatedDescriptions.seo_keywords);
  }, [generatedDescriptions.seo_keywords, seoKeywords, seoTouched.keywords]);

  useEffect(() => {
    if (!seoTouched.slug || !canonicalSlug.trim()) setCanonicalSlug(generatedDescriptions.canonical_slug);
  }, [canonicalSlug, generatedDescriptions.canonical_slug, seoTouched.slug]);

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
        const list = normalizeManufacturerRows(
          Array.isArray(rows)
            ? rows
            : Array.isArray(rows?.manufacturers)
              ? rows.manufacturers
              : Array.isArray(rows?.data)
                ? rows.data
                : Array.isArray(rows?.result)
                  ? rows.result
                  : Array.isArray(rows?.payload)
                    ? rows.payload
                    : []
        );
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

    const loadExistingSkus = async () => {
      try {
        const rows = await getProductsWithVariants();
        if (active) setExistingSkuValues(collectSkuValues(rows));
      } catch (error) {
        console.warn("[products:sku] failed to load existing SKUs", error?.message || error);
      }
    };

    loadExistingSkus();

    return () => {
      active = false;
    };
  }, []);

  const hasGroupContent = (group) =>
    Boolean(
      String(group?.color || "").trim() ||
              String(group?.article_code || "").trim() ||
              String(group?.edition_name || "").trim() ||
        String(group?.imagePreview || "").trim() ||
        String(group?.image_url || "").trim() ||
        (Array.isArray(group?.images) && group.images.length > 0) ||
        (Array.isArray(group?.sizes) &&
          group.sizes.some((row) =>
            [row?.size, row?.sku, row?.price].some((value) => String(value || "").trim())
          ))
    );

  const hasRowContent = (row) =>
    Boolean([row?.size, row?.sku, row?.barcode, row?.price].some((value) => String(value || "").trim()));

  const normalizeManufacturerId = (value) => {
    const next = String(value || "").trim();
    return next ? next : "";
  };

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

  const getGroupSizeCount = (group) =>
    (Array.isArray(group?.sizes) ? group.sizes : []).filter((row) => String(row.size || "").trim()).length;

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

  const getEditionSuggestionInput = (group = {}) => ({
    image_url: (normalizeColorImages(group.images)
      .map((image) => image.image_url || image.preview)
      .filter((image) => /^https?:\/\//i.test(String(image || "")))
      .at(0)) || "",
    product_name: name,
    brand,
    manufacturer: getManufacturerPayload(group.manufacturer_id).manufacturer_name || "",
    color_name: group.color,
    color: group.color,
    images: normalizeColorImages(group.images)
      .map((image) => image.image_url || image.preview)
      .filter(Boolean)
      .slice(0, 3),
    gender,
    product_type: productType,
  });

  const pageNavSections = [
    { id: "basic-info", title: t("products.editor.basicInfoNav") },
    { id: "media-ai", title: t("products.editor.mediaNav") },
    { id: "content-seo", title: t("products.editor.seoNav") },
    { id: "pricing", title: t("products.editor.pricing") },
    { id: "inventory", title: t("products.editor.inventory") },
    { id: "variants", title: t("products.stats.variants") },
  ];
  const productContentTabs = [
    { id: "description", title: t("products.editor.customerDescriptionShortTitle") },
    { id: "metadata", title: t("products.editor.seoMetadata") },
    { id: "preview", title: t("products.editor.facebookWhatsappPreview") },
  ];
  const scrollToSection = (sectionId) => {
    document.getElementById(sectionId)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const buildAutoVariantGroups = (groups, prefix = skuPrefix || uniqueSmartSkuPrefix) => {
    if (isSimpleMode) return groups;
    const usedSkus = new Set(existingSkuValues);
    return groups.map((group) => {
      const groupColor = getColorGroupName(group);
      return {
        ...group,
        color: groupColor || group.color || "",
        sizes: sortProductSizes(Array.isArray(group.sizes) ? group.sizes : []).map((row) => {
          if (row.skuManualOverride) {
            if (String(row.sku || "").trim()) makeUniqueSku(String(row.sku || "").trim().toUpperCase(), usedSkus);
            return row;
          }
          const size = isColorOnlyMode
            ? String(fixedSizeLabel || "One Size").trim() || "One Size"
            : String(row.size || "").trim();
          const sku = groupColor && size
            ? buildVariantSku({ prefix, color: groupColor, size, usedSkus })
            : "";
          return row.sku === sku && row.skuManualOverride === false ? row : { ...row, sku, skuManualOverride: false };
        }),
      };
    });
  };

  useEffect(() => {
    setColorGroups((prev) => {
      const next = buildAutoVariantGroups(prev);
      return next === prev || JSON.stringify(next.map((group) => group.sizes.map((row) => [row.id, row.sku, row.skuManualOverride]))) ===
        JSON.stringify(prev.map((group) => group.sizes.map((row) => [row.id, row.sku, row.skuManualOverride])))
        ? prev
        : next;
    });
  }, [existingSkuValues, fixedSizeLabel, isColorOnlyMode, isSimpleMode, skuPrefix, uniqueSmartSkuPrefix]);

  const variantMatrix = useMemo(() => {
    if (isSimpleMode) return [];
    const basePrice = Number(regularPrice || 0);

    const previewSkus = new Set(existingSkuValues);
    if (isColorOnlyMode) {
      return colorGroups.flatMap((group, groupIndex) => {
        const groupColor = getColorGroupName(group);
        const groupArticleCode = String(group.color_article_code || "").trim();
        if (!groupColor) return [];
        return [
          {
            previewKey: `${group.id || groupIndex}-${groupColor}-color-only`,
            color: groupColor,
            size: String(fixedSizeLabel || "One Size").trim() || "One Size",
            stock: 0,
            sku: group.sizes?.[0]?.skuManualOverride && String(group.sizes?.[0]?.sku || "").trim()
              ? makeUniqueSku(String(group.sizes?.[0]?.sku || "").trim().toUpperCase(), previewSkus)
              : buildVariantSku({ prefix: skuPrefix || uniqueSmartSkuPrefix, color: groupColor, size: String(fixedSizeLabel || "One Size").trim() || "One Size", usedSkus: previewSkus }),
            barcode: String(group.sizes?.[0]?.barcode || "").trim(),
            article_code: String(group.sizes?.[0]?.article_code || "").trim(),
            color_article_code: groupArticleCode,
            price: Number(group.sizes?.[0]?.price || basePrice || 0),
            image_url: String(getPrimaryColorImage(group) || "").trim(),
            manufacturer_id: String(group.manufacturer_id || "").trim(),
          },
        ];
      });
    }

    return colorGroups.flatMap((group, groupIndex) => {
      const groupColor = getColorGroupName(group);
      const groupArticleCode = String(group.color_article_code || "").trim();
      if (!groupColor) return [];

          return (Array.isArray(group.sizes) ? group.sizes : [])
        .filter((row) => groupColor && String(row.size || "").trim())
        .map((row, rowIndex) => ({
          previewKey: `${group.id || groupIndex}-${row.id || rowIndex}-${groupColor}-${String(row.size || "").trim()}`,
          color: groupColor,
          size: String(row.size || "").trim(),
          stock: 0,
          sku: row.skuManualOverride && String(row.sku || "").trim()
            ? makeUniqueSku(String(row.sku || "").trim().toUpperCase(), previewSkus)
            : buildVariantSku({ prefix: skuPrefix || uniqueSmartSkuPrefix, color: groupColor, size: String(row.size || "").trim(), usedSkus: previewSkus }),
          barcode: String(row.barcode || "").trim(),
          article_code: String(row.article_code || "").trim(),
          color_article_code: groupArticleCode,
          price: Number(row.price || basePrice || 0),
          image_url: String(getPrimaryColorImage(group) || "").trim(),
          manufacturer_id: String(group.manufacturer_id || "").trim(),
        }));
    });
  }, [colorGroups, existingSkuValues, fixedSizeLabel, isColorOnlyMode, isSimpleMode, regularPrice, skuPrefix, uniqueSmartSkuPrefix]);

  const addColorGroup = () => {
    const nextGroup = createEmptyColorGroup(defaultManufacturerId);
    setColorGroups((prev) => [...prev, nextGroup]);
    setExpandedGroupId(nextGroup.id);
  };

  const removeColorGroup = (colorGroupId) => {
    setColorGroups((prev) => {
      if (prev.length <= 1) {
        const nextGroup = createEmptyColorGroup(defaultManufacturerId);
        setExpandedGroupId(nextGroup.id);
        return [nextGroup];
      }

      const nextGroups = prev.filter((group) => group.id !== colorGroupId);
      if (expandedGroupId === colorGroupId) {
        setExpandedGroupId(nextGroups[0]?.id || "");
      }
      return nextGroups;
    });
  };

  const updateColorGroup = (colorGroupId, field, value) => {
    setColorGroups((prev) =>
      buildAutoVariantGroups(
        prev.map((group) =>
        group.id === colorGroupId
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

  const setColorDetectingState = (colorGroupId, detecting) => {
    setColorDetecting((prev) => {
      if (detecting) return { ...prev, [colorGroupId]: true };
      const next = { ...prev };
      delete next[colorGroupId];
      return next;
    });
  };

  const detectColorNameForGroup = async (colorGroupId, source, { overwrite = false } = {}) => {
    if (!source) return;
    setColorDetectingState(colorGroupId, true);
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
          if (group.id !== colorGroupId) return group;
          if (!overwrite && getColorGroupName(group)) return group;
          return { ...group, color: label };
        })
      );
    } catch (error) {
      console.warn("[products:add] color detection failed:", error);
    } finally {
      setColorDetectingState(colorGroupId, false);
    }
  };

  const pickColorNameForGroup = async (colorGroupId, source, point) => {
    if (!source) return;
    setColorDetectingState(colorGroupId, true);
    try {
      const result = await colorNameFromImagePoint(source, point);
      const label = String(result?.label || result?.name || "").trim();
      if (label) updateColorGroup(colorGroupId, "color", label);
    } catch (error) {
      console.warn("[products:add] color point detection failed:", error);
    } finally {
      setColorDetectingState(colorGroupId, false);
    }
  };

  const updateColorGroupImages = (colorGroupId, updater) => {
    setColorGroups((prev) =>
      prev.map((group) => {
        if (group.id !== colorGroupId) return group;
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

  const setPrimaryColorImage = (colorGroupId, imageId) => {
    updateColorGroupImages(colorGroupId, (images) =>
      images.map((item) => ({
        ...item,
        is_primary: String(item.id) === String(imageId),
      }))
    );
  };

  const removeColorImage = (colorGroupId, imageId) => {
    updateColorGroupImages(colorGroupId, (images) => {
      if (images.some((item) => String(item.id) === String(imageId) && item.uploading)) return images;
      const next = images.filter((item) => String(item.id) !== String(imageId));
      if (!next.some((item) => item.is_primary) && next.length > 0) {
        next[0] = { ...next[0], is_primary: true };
      }
      return next;
    });
    toast.success(t("products.images.removed"));
  };

  const moveColorImage = (colorGroupId, imageId, direction) => {
    updateColorGroupImages(colorGroupId, (images) => {
      const index = images.findIndex((item) => String(item.id) === String(imageId));
      if (index < 0) return images;
      const targetIndex = direction === "up" ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= images.length) return images;
      const next = [...images];
      const [item] = next.splice(index, 1);
      next.splice(targetIndex, 0, item);
      return next.map((entry, entryIndex) => ({
        ...entry,
        is_primary: entryIndex === 0 ? entry.is_primary || item.is_primary : entry.is_primary,
      }));
    });
  };

  const handleColorImages = async (colorGroupId, files) => {
    const list = Array.from(files || []);
    if (!list.length) return;
    const targetGroup = colorGroups.find((group) => group.id === colorGroupId);
    if (!String(targetGroup?.color || "").trim()) {
      void detectColorNameForGroup(colorGroupId, list[0], { overwrite: false });
    }
    const uploads = await mapWithConcurrency(list, MAX_IMAGE_UPLOAD_CONCURRENCY, async (file, index) => {
      const uploadKey = `${colorGroupId}:${index}:${file?.name || "file"}`;
      const uploadPromise = uploadProductImageValue(file, { filename: file?.name || `color-image-${index + 1}.png` })
        .then((uploadedUrl) => {
          if (uploadedUrl) colorImageUrlsRef.current.set(colorGroupId, uploadedUrl);
          return { preview: uploadedUrl || "", image_url: uploadedUrl || "", name: file?.name || `Color image ${index + 1}` };
        })
        .catch((error) => {
          console.warn("[products:add] color image upload failed:", {
            colorGroupId,
            message: error?.message,
            status: error?.status,
            responseBody: error?.responseBody,
          });
          toast.error(t("products.editor.colorImageUploadFailed"));
          return { preview: "", image_url: "", name: file?.name || `Color image ${index + 1}` };
        });
      pendingColorUploadsRef.current.set(uploadKey, uploadPromise);
      try {
        return await uploadPromise;
      } finally {
        pendingColorUploadsRef.current.delete(uploadKey);
      }
    });
    updateColorGroupImages(colorGroupId, (images) => {
      const normalized = dedupeImages([
        ...images,
        ...uploads.map((item, index) => createColorImageItem({ ...item, is_primary: images.length === 0 && index === 0 }, index + images.length)).filter(Boolean),
      ]);
      if (!normalized.some((item) => item.is_primary) && normalized.length > 0) {
        normalized[0] = { ...normalized[0], is_primary: true };
      }
      return normalized;
    });
  };

  const addSizeRow = (colorGroupId) => {
    setColorGroups((prev) =>
      prev.map((group) =>
        group.id === colorGroupId
          ? {
              ...group,
              sizes: sortProductSizes([
                ...group.sizes,
                createEmptySizeRow({
                  image_url: getPrimaryColorImage(group) || colorImageUrlsRef.current.get(group.id) || "",
                  manufacturer_id: group.manufacturer_id || "",
                  price: regularPrice || "",
                }),
              ]),
            }
          : group
      )
    );
  };

  const applyCrocsSizeLibrary = (colorGroupId, libraryId) => {
    const library = CROCS_SIZE_LIBRARY_OPTIONS.find((item) => item.id === libraryId);
    if (!library) return;

    const { groups: updatedGroups, addedCount } = applyBulkSizesToGroups({
      groups: colorGroups,
      sizes: library.sizes.map((size) => size.eu),
      targetGroupId: colorGroupId,
      price: regularPrice || 0,
    });

    if (addedCount === 0) {
      toast("المقاسات موجودة بالفعل");
    } else {
      setColorGroups(buildAutoVariantGroups(updatedGroups));
      toast.success(t("products.editor.sizesAdded", "تمت إضافة المقاسات"));
    }

    setCrocsLibraryGroupId("");
  };

  const applyBulkSizes = (targetGroupId = null) => {
    const sizes = parseBulkSizes(bulkSizesInput);
    console.log("[bulk-sizes] raw input", bulkSizesInput);
    console.log("[bulk-sizes] parsed sizes", sizes);
    console.log("[bulk-sizes] target", targetGroupId ? { groupId: targetGroupId } : "all colors");
    console.log("[bulk-sizes] color groups before apply", colorGroups);

    if (!String(bulkSizesInput || "").trim()) {
      toast.error(t("products.editor.enterSizesFirst"));
      return;
    }

    if (sizes.length === 0) {
      toast.error(t("products.editor.noValidSizes"));
      return;
    }

    const isTargetGroup = (group) => !targetGroupId || group.id === targetGroupId;
    const targetGroups = colorGroups.filter(isTargetGroup);
    if (targetGroups.length === 0) {
      toast.error(t("products.editor.addColorBeforeBulkSizes"));
      return;
    }

    const normalizedColorGroups = colorGroups.map((group) => ({
      ...group,
      color: getColorGroupName(group) || group.color || "",
    }));

    const { groups: updatedGroups, addedCount, removedPlaceholderCount } = applyBulkSizesToGroups({
      groups: normalizedColorGroups.map((group) => (isTargetGroup(group) ? group : { ...group, __skipBulkSizes: true })),
      sizes,
      targetGroupId,
      price: regularPrice || 0,
    });

    console.log("[bulk-sizes] updated groups", updatedGroups);

    if (addedCount === 0 && removedPlaceholderCount === 0) {
      toast("All sizes already exist");
      return;
    }

    setColorGroups(buildAutoVariantGroups(updatedGroups));
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

    const isTargetGroup = (group) => !targetGroupId || group.id === targetGroupId;
    const targetGroups = colorGroups.filter(isTargetGroup);
    if (targetGroups.length === 0) {
      toast.error(t("products.editor.addColorBeforeBulkStock"));
      return;
    }

    const { groups: updatedGroups, changedCount } = applyBulkStockToGroups({
      groups: colorGroups.map((group) => (isTargetGroup(group) ? group : { ...group, __skipBulkStock: true })),
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
      toast.error(t("products.editor.enterArticleCode", "أدخل كود المقال أولًا"));
      return;
    }

    const isTargetGroup = (group) => !targetGroupId || group.id === targetGroupId;
    const targetGroups = colorGroups.filter(isTargetGroup);
    if (targetGroups.length === 0) {
      toast.error(t("products.editor.addColorBeforeBulkArticle", "أضف لونًا قبل تطبيق أكواد المقال"));
      return;
    }

    const hasExistingArticle = targetGroups.some((group) =>
      String(group.color_article_code || "").trim() ||
      (group.sizes || []).some((row) => String(row.article_code || "").trim())
    );
    if (hasExistingArticle && !overwrite) {
      const confirmed = window.confirm(t("products.editor.confirmOverwriteArticleCodes", "بعض المتغيرات تحتوي بالفعل على أكواد مقال. هل تريد استبدالها؟"));
      if (!confirmed) return;
    }

    let changedCount = 0;
    setColorGroups((prev) =>
      prev.map((group) => {
        if (!isTargetGroup(group)) return group;
        const shouldSetGroup = overwrite || !String(group.color_article_code || "").trim();
        const nextSizes = (group.sizes || []).map((row) => {
          const shouldSetRow = overwrite || !String(row.article_code || "").trim();
          if (!shouldSetRow) return row;
          changedCount += 1;
          return { ...row, article_code: articleCode };
        });
        if (shouldSetGroup) changedCount += 1;
        return {
          ...group,
          color_article_code: shouldSetGroup ? articleCode : group.color_article_code,
          sizes: nextSizes,
        };
      })
    );
    toast.success(changedCount > 0 ? t("products.editor.articleCodeApplied", "تم تطبيق كود المقال") : t("products.editor.noArticleCodesUpdated", "لم يتم تحديث أي أكواد مقال"));
  };

  const removeSizeRow = (colorGroupId, sizeRowId) => {
    setColorGroups((prev) =>
      prev.map((group) => {
        if (group.id !== colorGroupId) return group;
        const nextSizes = group.sizes.filter((row) => row.id !== sizeRowId);
        return {
          ...group,
          sizes: nextSizes.length > 0 ? nextSizes : [createEmptySizeRow()],
        };
      })
    );
  };

  const updateSizeRow = (colorGroupId, sizeRowId, field, value) => {
    setColorGroups((prev) =>
      buildAutoVariantGroups(
        prev.map((group) =>
          group.id === colorGroupId
            ? {
                ...group,
                sizes: group.sizes.map((row) =>
                  row.id === sizeRowId
                    ? {
                        ...row,
                        [field]: field === "barcode" ? String(value || "") : field === "sku" ? String(value || "").toUpperCase().replace(/[^A-Z0-9-]/g, "") : value,
                        ...(field === "size" ? { sizeManualOverride: true } : {}),
                        ...(field === "sku" ? { skuManualOverride: true } : {}),
                        ...(field === "barcode" ? { barcodeManualOverride: true } : {}),
                      }
                    : row
                ),
              }
            : group
        )
      )
    );
  };

  const handleCover = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (coverObjectUrlRef.current) {
      revokeObjectPreviewUrl(coverObjectUrlRef.current);
      coverObjectUrlRef.current = "";
    }
    const preview = createObjectPreviewUrl(file);
    coverObjectUrlRef.current = preview;
    setCoverImage(preview);
    setCoverImageFile(file);
    setCoverLabel(file.name);
    setThermalImageUrl("");
  };

  const buildAiProductPayload = async () => ({
    ...(coverImageFile ? { image_base64_optional: await readFileAsDataUrl(coverImageFile) } : getAiImagePayload(coverImage)),
    brand_id: selectedBrandId || undefined,
    brand_name: selectedBrandName || undefined,
    color_name: colorGroups.map((group) => group.color).filter(Boolean).join(", "),
    product_name: name,
    brand: selectedBrandName || brand,
    manufacturer: getDefaultManufacturerName(manufacturers, defaultManufacturerId),
    current: {
      ...descriptionContext,
      brand_id: selectedBrandId || "",
      brand_name: selectedBrandName || "",
      brand: selectedBrandName || brand,
      product_name: name,
      description_ar: descriptionAr,
      description_en: descriptionEn,
      meta_title: metaTitle,
      seo_description: seoDescription,
      seo_keywords: seoKeywords,
      canonical_slug: canonicalSlug,
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
      const payload = await buildAiProductPayload();
      if (!payload.image_base64_optional && !payload.image_url) {
        toast.error(t("products.editor.uploadMainImageFirst"));
        return;
      }
      const result = await generateAiProductData(payload);
      setAiProductData(result);
      if (selectedBrandId || selectedBrandName) {
        setBrandId(selectedBrandId || "");
        setBrand(selectedBrandName || brand);
      }
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
          name_en: name,
          name_ar: name,
          description_ar: fallback.description_ar,
          description_en: fallback.description_en,
          meta_title_en: fallback.meta_title,
          seo_description_en: fallback.seo_description,
          seo_keywords: fallback.seo_keywords,
          canonical_slug: fallback.canonical_slug,
          suggested_category: childCategory || subCategory || mainCategory,
          suggested_product_type: productType,
          gender: audiences[0] || gender,
          audiences,
          grade,
          dominant_colors: colorGroups.map((group) => group.color).filter(Boolean),
          detection_confidence: {
            colors: colorGroups.some((group) => String(group.color || "").trim()) ? 45 : 15,
            product_type: productType ? 40 : 15,
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
      toast.error("Add a color image first. Product cover is not used for AI Thermal Artwork.");
      return;
    }
    toast("Save the product first, then generate AI Thermal Artwork per color from Edit Product.");
  };

  const applyAiProductSuggestion = (field) => {
    const suggestions = aiProductData?.suggestions || {};
    const value = getSuggestionValue(suggestions, field);
    if (!value && !["dominant_colors"].includes(field)) return;

    if (field === "name_en") setName(value);
    if (field === "description_ar") {
      setDescriptionAr(value);
      setDescription(value || descriptionEn);
      setDescriptionTouched((current) => ({ ...current, ar: true }));
    }
    if (field === "description_en") {
      setDescriptionEn(value);
      setDescription(value || descriptionAr);
      setDescriptionTouched((current) => ({ ...current, en: true }));
    }
    if (field === "meta_title_en") {
      setMetaTitle(value);
      setSeoTouched((current) => ({ ...current, title: true }));
    }
    if (field === "seo_description_en") {
      setSeoDescription(value);
      setSeoTouched((current) => ({ ...current, description: true }));
    }
    if (field === "seo_keywords") {
      setSeoKeywords(value);
      setSeoTouched((current) => ({ ...current, keywords: true }));
    }
    if (field === "canonical_slug") {
      setCanonicalSlug(value);
      setSeoTouched((current) => ({ ...current, slug: true }));
    }
    if (field === "suggested_category") setMainCategory(value);
    if (field === "suggested_product_type") setProductType(value);
    if (field === "gender") {
      const normalized = String(value || "").trim().toLowerCase();
      const nextAudience =
        ["men", "man", "male"].includes(normalized)
          ? "men"
          : ["women", "woman", "female", "ladies"].includes(normalized)
            ? "women"
            : ["kids", "kid", "children", "child", "boys", "girls"].includes(normalized)
              ? "kids"
              : "";
      setGender(nextAudience || value);
      if (nextAudience) setAudiences([nextAudience]);
    }
    if (field === "grade") setGrade(value);
  };

  const applyAllAiProductSuggestions = () => {
    const suggestions = aiProductData?.suggestions || {};
    const overwrites = [
      name,
      descriptionAr,
      descriptionEn,
      metaTitle,
      seoDescription,
      seoKeywords,
      canonicalSlug,
      mainCategory,
      productType,
      gender,
      grade,
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

  const handleGallery = async (event) => {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;
    const items = files.map((file) => {
      const preview = createObjectPreviewUrl(file);
      trackGalleryObjectUrl(preview);
      return {
        id: makeId(),
        name: file.name,
        size: file.size,
        file,
        preview,
      };
    });
    setGallery((prev) => dedupeImages([...prev, ...items]));
    event.target.value = "";
  };

  const removeGalleryItem = (galleryId) => {
    const target = gallery.find((item) => String(item.id || item.name) === String(galleryId));
    const next = gallery.filter((item) => String(item.id || item.name) !== String(galleryId));
    const targetSrc = target?.preview || target?.image_url || target?.url || "";
    const removedPrimary = targetSrc && coverImage && targetSrc === coverImage;
    if (target?.preview) releaseGalleryObjectUrl(target.preview);
    setGallery(next);
    if (removedPrimary) {
      const nextPrimary = next[0] || null;
      setCoverImage(nextPrimary?.preview || nextPrimary?.image_url || nextPrimary?.url || "");
      setCoverImageFile(nextPrimary?.file || null);
      setCoverLabel(nextPrimary?.name || "");
      setThermalImageUrl("");
      if (!nextPrimary && coverObjectUrlRef.current) {
        revokeObjectPreviewUrl(coverObjectUrlRef.current);
        coverObjectUrlRef.current = "";
      }
    }
    toast.success(t("products.images.removed"));
  };

  const setGalleryItemAsPrimary = (item) => {
    const src = item?.preview || item?.image_url || item?.url || "";
    if (!src) return;
    setCoverImage(src);
    setCoverImageFile(item?.file || null);
    setCoverLabel(item?.name || "Gallery image");
    setThermalImageUrl("");
    toast.success(t("products.editor.primaryProductImageUpdated"));
  };

  const generateNewBarcode = () => {
    const next = generateBarcode();
    setBarcode(next);
    setBarcodePreview(next);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (saving) return;
    setVariantNotice("");

    if (!name.trim()) {
      toast.error(t("products.editor.productNameRequired"));
      return;
    }

    const filledGroups = isSimpleMode ? [] : colorGroups.filter((group) => hasGroupContent(group));

    if (!isSimpleMode) {
      const extraBlankGroups = colorGroups.slice(1).filter((group) => !hasGroupContent(group));
      if (extraBlankGroups.length > 0) {
        const message = "Fill or remove empty color groups before saving";
        setVariantNotice(message);
        toast.error(message);
        return;
      }

      for (const group of filledGroups) {
        const colorValue = String(group.color || "").trim();
        if (!colorValue) {
          const message = "Each color group needs a color name before saving variants";
          setVariantNotice(message);
          toast.error(message);
          return;
        }

        if (isFullVariationMode) {
          const validRows = (Array.isArray(group.sizes) ? group.sizes : []).filter((row) => hasRowContent(row));
          if (validRows.length === 0) {
            const message = `Add at least one size for color "${colorValue}"`;
            setVariantNotice(message);
            toast.error(message);
            return;
          }

          for (const row of validRows) {
            if (!String(row.size || "").trim()) {
              const message = `Each size row for "${colorValue}" needs a size value`;
              setVariantNotice(message);
              toast.error(message);
              return;
            }
          }
        }
      }
    }

    try {
      setSaving(true);
      setSavingStep("Uploading images...");
      const perfStartedAt = Date.now();

      const pendingUploads = Array.from(pendingColorUploadsRef.current.values());
      if (pendingUploads.length > 0) {
        await Promise.allSettled(pendingUploads);
      }

      const usedVariantSkus = new Set(existingSkuValues);
      const generatedVariants = filledGroups.flatMap((group) => {
        const groupColor = String(group.color || "").trim();
        const groupImageUrl = String(getPrimaryColorImage(group) || colorImageUrlsRef.current.get(group.id) || "").trim();
        const groupEditionName = mirrorEditionEnabled ? String(group.edition_name || "").trim() : "";
        const groupEditionSlug = groupEditionName ? slugifyEdition(group.edition_slug || groupEditionName) : "";
        const groupArticleCode = String(group.color_article_code || "").trim();
        const groupManufacturerPayload = getManufacturerPayload(group.manufacturer_id);
        if (!groupColor) return [];

        if (isColorOnlyMode) {
          const sourceRow = (Array.isArray(group.sizes) ? group.sizes : [])[0] || {};
          const purchaseQty = getVariantPurchaseQty(sourceRow, group);
          return [
            normalizeVariantPayload({
              color: groupColor,
              size: String(fixedSizeLabel || "One Size").trim() || "One Size",
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
                prefix: skuPrefix || uniqueSmartSkuPrefix,
                color: groupColor,
                size: String(fixedSizeLabel || "One Size").trim() || "One Size",
                usedSkus: usedVariantSkus,
              }),
              barcode: String(sourceRow.barcode || "").trim() || "",
              article_code: String(sourceRow.article_code || "").trim(),
              color_article_code: groupArticleCode,
              purchase_price: 0,
              sale_price: 0,
              price: 0,
              image_url: String(sourceRow.image_url || groupImageUrl || "").trim() || "",
              variant_image_url: String(sourceRow.image_url || groupImageUrl || "").trim() || "",
              color_image_url: groupImageUrl,
              ...groupManufacturerPayload,
              edition_name: groupEditionName,
              edition_slug: groupEditionSlug,
            }),
          ];
        }

        if (isSimpleMode) {
          return [];
        }

        return (Array.isArray(group.sizes) ? group.sizes : [])
          .filter((row) => String(row.size || "").trim())
          .map((row, rowIndex) => {
            const purchaseQty = getVariantPurchaseQty(row, group);
            return normalizeVariantPayload({
              color: groupColor,
              size: String(row.size || "").trim(),
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
                prefix: skuPrefix || uniqueSmartSkuPrefix,
                color: groupColor,
                size: String(row.size || "").trim(),
                sequence: rowIndex > 0 ? "" : "",
                usedSkus: usedVariantSkus,
              }),
              barcode: String(row.barcode || "").trim() || "",
              article_code: String(row.article_code || "").trim(),
              color_article_code: groupArticleCode,
              purchase_price: 0,
              sale_price: 0,
              price: 0,
              image_url: String(row.image_url || groupImageUrl || "").trim() || "",
              variant_image_url: String(row.image_url || groupImageUrl || "").trim() || "",
              color_image_url: groupImageUrl,
              ...groupManufacturerPayload,
              edition_name: groupEditionName,
              edition_slug: groupEditionSlug,
            });
          });
      });

      const colorImagesPayload = filledGroups
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
            color_article_code: String(group.color_article_code || "").trim(),
          images: dedupeImages(groupImages).map((image, index) => ({
            id: image.id || makeId(),
            preview: image.image_url || "",
            image_url: image.image_url || "",
            is_primary: image.is_primary ?? index === 0,
            name: image.name || `${groupColor} image ${index + 1}`,
          })),
          };
        })
        .filter(Boolean);

      if (!isSimpleMode && filledGroups.length > 0 && generatedVariants.length === 0) {
        const message = "No variants provided";
        setVariantNotice(message);
        toast.error(message);
        return;
      }

      const { coverImageUrl, galleryPayload } = await resolvePersistedProductImages({
        coverImage,
        coverImageFile,
        gallery,
      });
      console.log("PRODUCT_CREATE_PERF_UPLOADS_DONE", {
        duration_ms: Date.now() - perfStartedAt,
        gallery_images_count: galleryPayload.length,
        color_groups_count: colorImagesPayload.length,
      });

      setSavingStep("Saving variants...");
      const productPayload = normalizeProductRelationIds({
        name: name.trim(),
        description: descriptionEn || descriptionAr || description,
        description_ar: descriptionAr,
        description_en: descriptionEn,
        meta_title: metaTitle,
        seo_description: seoDescription || descriptionEn || descriptionAr || description,
        seo_keywords: seoKeywords,
        canonical_slug: canonicalSlug,
        ...resolveCategoryPayload(categories, {
          mainCategory,
          subCategory,
          childCategory,
          fallbackCategory: "Uncategorized",
        }),
        ...resolveBrandPayload(brands, { brand: selectedBrandName || brand, fallbackBrandId: selectedBrandId || brandId }),
        ...resolveUnitPayload(units, { unitId: unit }),
        gender: audiences[0] || gender,
        audiences,
        product_audiences: audiences,
        product_type: productType,
        grade,
        is_offer_story: isOfferStory,
        variation_mode: variationMode,
        fixed_size_label: isColorOnlyMode ? fixedSizeLabel : "",
        purchase_alerts_enabled: purchaseAlertsEnabled,
        purchase_alert_by_color: purchaseAlertByColor,
        carton_size: cartonSize === "" ? null : Number(cartonSize),
        suggested_purchase_cartons: Number(suggestedPurchaseCartons || 1),
        planned_quantities: [],
        sku: skuPrefix || uniqueSmartSkuPrefix,
        barcode,
        use_custom_compare_price: useCustomComparePrice,
        custom_compare_price: Number(customComparePrice || 0),
        tax_rate: 0,
        default_purchase_qty: 0,
        low_stock_tracking_mode: null,
        product_low_stock_threshold: null,
        minimum_distinct_sizes_required: null,
        active,
        status: active ? "active" : "inactive",
        track_stock: trackStock,
        image_url: coverImageUrl,
        thermal_image_url: thermalImageUrl,
        gallery: galleryPayload,
        variant_groups_count: filledGroups.length,
        variant_rows_count: generatedVariants.length,
        variants: generatedVariants,
        colorImages: colorImagesPayload,
        ...getManufacturerPayload(defaultManufacturerId),
      });
      setSavingStep("Saving images...");
      const product = await createProduct(productPayload);
      console.log("PRODUCT_CREATE_PERF_VARIANTS_DONE", {
        duration_ms: Date.now() - perfStartedAt,
        variants_count: productPayload.variants.length,
      });
      console.log("PRODUCT_CREATE_PERF_IMAGES_DONE", {
        duration_ms: Date.now() - perfStartedAt,
        image_rows_count: colorImagesPayload.reduce((sum, group) => sum + (Array.isArray(group.images) ? group.images.length : 0), 0),
      });

      const productSku = product.sku || skuPrefix || uniqueSmartSkuPrefix || generateSku(name, product.id).split("-")[0];
      const meta = {
        id: product.id,
        name: product.name,
        description: descriptionEn || descriptionAr || description,
        description_ar: descriptionAr,
        description_en: descriptionEn,
        meta_title: metaTitle,
        seo_description: seoDescription || descriptionEn || descriptionAr || description,
        seo_keywords: seoKeywords,
        canonical_slug: canonicalSlug,
        category: childCategory || subCategory || mainCategory || "Uncategorized",
        main_category: mainCategory,
        sub_category: subCategory,
        child_category: childCategory,
        gender: audiences[0] || gender,
        audiences,
        product_audiences: audiences,
        product_type: productType,
        grade,
        is_offer_story: isOfferStory,
        variation_mode: variationMode,
        fixed_size_label: isColorOnlyMode ? fixedSizeLabel : "",
        purchase_alerts_enabled: purchaseAlertsEnabled,
        purchase_alert_by_color: purchaseAlertByColor,
        carton_size: cartonSize === "" ? null : Number(cartonSize),
        suggested_purchase_cartons: Number(suggestedPurchaseCartons || 1),
        planned_quantities: [],
        brand: selectedBrandName || brand,
        brand_id: selectedBrandId || brandId || "",
        unit,
        sku: productSku,
        barcode,
        use_custom_compare_price: useCustomComparePrice,
        custom_compare_price: Number(customComparePrice || 0),
        tax_rate: 0,
        stock: 0,
        default_purchase_qty: 0,
        low_stock_tracking_mode: null,
        product_low_stock_threshold: null,
        minimum_distinct_sizes_required: null,
        active,
        status: active ? "active" : "inactive",
        track_stock: trackStock,
        image_url: coverImageUrl,
        thermal_image_url: thermalImageUrl,
        gallery: galleryPayload,
      };

      upsertProductMeta(meta);

      const createdCount = productPayload.variants.length;
      if (createdCount > 0) {
        setVariantNotice(`${createdCount} variant(s) created`);
      } else {
        setVariantNotice("Product saved without variants");
      }

      setSavingStep("Finalizing...");
      toast.success(createdCount > 0 ? `Product created with ${createdCount} variant(s)` : "Product created");
      console.log("PRODUCT_CREATE_PERF_COMMIT_DONE", {
        duration_ms: Date.now() - perfStartedAt,
        variants_count: createdCount,
        image_rows_count: colorImagesPayload.reduce((sum, group) => sum + (Array.isArray(group.images) ? group.images.length : 0), 0),
      });
      navigate("/products");
    } catch (err) {
      console.log(err);
      console.error("[products:add] create error details:", {
        message: err?.message,
        stack: err?.stack,
      });
      toast.error(err?.message || "فشل إنشاء المنتج");
    } finally {
      setSavingStep("");
      setSaving(false);
    }
  };

  const productDescriptionPanel = (
    <div className="rounded-[18px] border border-white/8 bg-white/[0.035] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-black text-white">{t("products.editor.customerDescriptionShortTitle", "Customer-facing description")}</p>
          <p className="mt-1 text-xs leading-5 text-zinc-400">
            Generated after image analysis, then refined for storefront catalog and product detail pages.
          </p>
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
            className="mt-1.5 h-11 w-full rounded-[14px] border border-white/10 bg-zinc-900/80 px-4 text-sm text-white shadow-inner shadow-black/20 outline-none placeholder:text-zinc-500 transition focus:border-amber-300/35 focus:bg-zinc-900"
          />
        </div>
        <div>
          <label className="text-sm font-semibold text-zinc-200">{t("products.editor.arabicDescription", "Arabic description")}</label>
          <textarea
            value={descriptionAr}
            onChange={(e) => {
              setDescriptionAr(e.target.value);
              setDescriptionTouched((current) => ({ ...current, ar: true }));
              setDescription(descriptionEn || e.target.value);
            }}
            rows={6}
            dir="rtl"
            placeholder={generatedDescriptionAr}
            className="mt-1.5 w-full rounded-[14px] border border-white/10 bg-zinc-900/80 px-4 py-3 text-sm leading-6 text-white shadow-inner shadow-black/20 outline-none placeholder:text-zinc-500 transition focus:border-emerald-300/35 focus:bg-zinc-900"
          />
        </div>

        <div>
          <label className="text-sm font-semibold text-zinc-200">{t("products.editor.englishDescription", "English description")}</label>
          <textarea
            value={descriptionEn}
            onChange={(e) => {
              setDescriptionEn(e.target.value);
              setDescriptionTouched((current) => ({ ...current, en: true }));
              setDescription(e.target.value || descriptionAr);
            }}
            rows={6}
            placeholder={generatedDescriptionEn}
            className="mt-1.5 w-full rounded-[14px] border border-white/10 bg-zinc-900/80 px-4 py-3 text-sm leading-6 text-white shadow-inner shadow-black/20 outline-none placeholder:text-zinc-500 transition focus:border-sky-300/35 focus:bg-zinc-900"
          />
        </div>
      </div>
    </div>
  );

  const seoMetadataPanel = (
    <div className="rounded-[18px] border border-white/8 bg-white/[0.035] p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-black text-white">{t("products.editor.seoMetadata", "SEO metadata")}</p>
          <p className="mt-1 text-xs text-zinc-400">{t("products.editor.seoMetadataHelp", "يتم توليد عنوان البحث والوصف والكلمات المفتاحية من صورة المنتج ومحتواه.")}</p>
        </div>
        <button
          type="button"
          onClick={regenerateSeoMetadata}
          disabled={seoGenerating}
          className="inline-flex h-9 items-center rounded-[12px] border border-white/10 bg-white/5 px-3 text-xs font-semibold text-zinc-100 transition hover:border-amber-300/30 hover:bg-amber-300/10 hover:text-amber-100"
        >
          {seoGenerating ? t("products.editor.generatingSeo", "جاري توليد تحسينات البحث...") : t("products.editor.regenerateSeoMetadata", "إعادة توليد بيانات تحسين البحث")}
        </button>
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div>
          <label className="text-sm font-semibold text-zinc-300">{t("products.editor.metaTitle", "Meta title")}</label>
          <input
            value={metaTitle}
            onChange={(event) => {
              setMetaTitle(event.target.value);
              setSeoTouched((current) => ({ ...current, title: true }));
            }}
            className="mt-1.5 h-10 w-full rounded-[14px] border border-white/10 bg-zinc-900/80 px-3 text-sm font-semibold text-white shadow-inner shadow-black/20 outline-none"
          />
        </div>
        <div>
          <label className="text-sm font-semibold text-zinc-300">{t("products.editor.seoKeywords", "SEO keywords")}</label>
          <input
            value={seoKeywords}
            onChange={(event) => {
              setSeoKeywords(event.target.value);
              setSeoTouched((current) => ({ ...current, keywords: true }));
            }}
            className="mt-1.5 h-10 w-full rounded-[14px] border border-white/10 bg-zinc-900/80 px-3 text-sm text-white shadow-inner shadow-black/20 outline-none"
          />
        </div>
        <div className="lg:col-span-2">
          <label className="text-sm font-semibold text-zinc-300">{t("products.editor.seoMetaDescription", "SEO meta description")}</label>
          <textarea
            value={seoDescription}
            onChange={(event) => {
              setSeoDescription(event.target.value);
              setSeoTouched((current) => ({ ...current, description: true }));
            }}
            rows={3}
            className="mt-1.5 w-full rounded-[14px] border border-white/10 bg-zinc-900/80 px-3 py-2 text-sm leading-5 text-white shadow-inner shadow-black/20 outline-none"
          />
          <p className="mt-1 text-[11px] text-zinc-500">{seoDescription.length}/160 characters</p>
        </div>
      </div>
    </div>
  );

  const socialPreviewPanel = (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="rounded-[18px] border border-white/8 bg-white/[0.035] p-4">
        <div className="mb-3 flex items-center gap-2 text-xs font-black uppercase tracking-[0.16em] text-zinc-500">
          <Search size={14} />
          {t("products.editor.googlePreview")}
        </div>
        <div className="rounded-[16px] border border-white/8 bg-zinc-950/65 p-3">
          <p className="truncate text-[13px] text-zinc-400">{seoPreviewUrl}</p>
          <p className="mt-1 line-clamp-1 text-lg font-semibold text-sky-300">{seoPreviewTitle}</p>
          <p className="mt-1 line-clamp-2 text-sm leading-5 text-zinc-300">{seoPreviewDescription}</p>
        </div>
      </div>

      <div className="overflow-hidden rounded-[18px] border border-white/10 bg-white/[0.04]">
        <div className="relative aspect-[1.91/1] w-full overflow-hidden bg-white">
          {coverImage ? (
            <img src={coverImage} alt={t("products.editor.openGraphPreviewAlt")} className="h-full w-full bg-white object-contain" />
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
  );

  const aiVisionPanel = aiProductData ? (
    <div className="mt-5 rounded-[18px] border border-blue-300/20 bg-blue-400/[0.07] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-black text-white">{t("products.editor.aiVisionResults", "AI Vision results")}</p>
          <p className="mt-1 text-xs text-zinc-400">
            {t("products.editor.aiSourceConfidence", { source: aiProductData.source || "AI", confidence: aiProductData.confidence ?? 0 })}
          </p>
        </div>
        <button
          type="button"
          onClick={applyAllAiProductSuggestions}
          className="inline-flex h-9 items-center rounded-[12px] border border-blue-300/30 bg-blue-300/10 px-3 text-xs font-black text-blue-100 transition hover:bg-blue-300/15"
        >
          {t("products.editor.applyAll")}
        </button>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-3">
        {[
          ["suggested_product_type", "Detected model"],
          ["dominant_colors", "Detected colors"],
          ["name_en", "Suggested title"],
        ].map(([field, label]) => {
          const value = getSuggestionValue(aiProductData.suggestions, field, field === "suggested_product_type" ? "silhouette" : "");
          return (
            <div key={field} className="rounded-[14px] border border-white/10 bg-zinc-950/70 p-3">
              <p className="text-[11px] font-black uppercase tracking-[0.16em] text-zinc-500">{label}</p>
              <p className="mt-2 line-clamp-3 text-sm leading-5 text-zinc-200">{value || "Not detected yet"}</p>
            </div>
          );
        })}
      </div>
    </div>
  ) : null;

  return (
    <ProductsShell
      title={t("products.editor.createTitle", "إنشاء منتج")}
      description={t("products.editor.createDescription", "Enterprise-grade product intake with catalog metadata, pricing, media, barcode generation, and variant generation.")}
      actions={
        <Link
          to="/products"
          onClick={confirmLeaveIfDirty}
          className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-5 py-3 font-semibold text-white"
        >
          Back to list
        </Link>
      }
    >
      <form id="create-product-form" onSubmit={handleSubmit} className="m1-create-product w-full min-w-0 max-w-none space-y-6 overflow-x-hidden pb-28 lg:pb-24">
        <ProductActionBar
          mode="create"
          saving={saving}
          savingStep={savingStep}
          hasUnsavedChanges={hasUnsavedChanges}
          formId="create-product-form"
        />
        <div className="flex w-full min-w-0 max-w-none flex-col gap-5 px-4 sm:px-6 lg:px-8">
          <section className="rounded-[18px] border border-white/10 bg-[#10172a] p-4 shadow-[0_14px_42px_rgba(0,0,0,0.18)]">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h1 className="text-2xl font-semibold tracking-tight text-white">{t("products.editor.createTitle", "إنشاء منتج")}</h1>
                <p className="mt-1 max-w-3xl text-sm leading-6 text-zinc-400">
                  {t("products.editor.createWorkflowDescription")}
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <Link
                  to="/products"
                  onClick={confirmLeaveIfDirty}
                  className="inline-flex h-9 items-center gap-2 rounded-[12px] border border-white/10 bg-white/5 px-4 text-sm font-semibold text-zinc-100 transition hover:border-white/20 hover:bg-white/10"
                >
                  {t("products.editor.backToList")}
                </Link>
                <button
                  type="submit"
                  disabled={saving}
                  className={buttonClasses("primary", "h-9 rounded-[12px] px-4")}
                >
                  <Plus size={16} strokeWidth={2} />
                  {saving ? savingStep || t("products.shared.saving") : t("products.editor.saveProduct")}
                </button>
              </div>
            </div>
          </section>

          <nav className="sticky top-0 z-30 -mx-1 overflow-x-auto border-y border-white/10 bg-[#070b16]/92 px-1 py-2 shadow-[0_12px_34px_rgba(0,0,0,0.18)] backdrop-blur">
            <div className="flex min-w-max gap-2">
              {pageNavSections.map((section) => (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => scrollToSection(section.id)}
                  className="h-9 rounded-[12px] border border-white/10 bg-white/[0.04] px-3 text-xs font-bold text-zinc-300 transition hover:border-emerald-300/30 hover:bg-emerald-300/10 hover:text-emerald-100"
                >
                  {section.title}
                </button>
              ))}
            </div>
          </nav>

          <div className="space-y-6">
            <SectionCard id="basic-info">
              <SectionHeader
                icon={Sparkles}
                title={t("products.editor.basicInformation")}
                subtitle={t("products.editor.basicInformationHelp")}
                tone="emerald"
              />

              <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="md:col-span-2">
                  <label className="text-sm font-semibold text-zinc-300">{t("products.form.productName", "Product name")}</label>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t("products.editor.productNamePlaceholder")}
                    className="mt-2 w-full rounded-2xl border border-white/8 bg-white/5 px-4 py-3 text-white outline-none placeholder:text-zinc-500"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="text-sm font-semibold text-zinc-300">{t("products.editor.slug")}</label>
                  <input
                    value={canonicalSlug}
                    onChange={(event) => {
                      setCanonicalSlug(event.target.value);
                      setSeoTouched((current) => ({ ...current, slug: true }));
                    }}
                    placeholder={t("products.editor.slugPlaceholder")}
                    className="mt-2 w-full rounded-2xl border border-white/8 bg-white/5 px-4 py-3 font-mono text-sm text-white outline-none placeholder:text-zinc-500"
                  />
                </div>
              </div>

              <ProductForm
                categories={categories}
                brands={brands}
                units={units}
                variationMode={variationMode}
                mainCategory={mainCategory}
                subCategory={subCategory}
                childCategory={childCategory}
                brand={brand}
                unit={unit}
                gender={gender}
                audiences={audiences}
                productType={productType}
                grade={grade}
                isOfferStory={isOfferStory}
                onMainCategoryChange={setMainCategory}
                onSubCategoryChange={setSubCategory}
                onChildCategoryChange={setChildCategory}
                onBrandChange={(nextBrand, selected) => {
                  setBrand(nextBrand);
                  setBrandId(selected?.id ? String(selected.id) : "");
                }}
                onUnitChange={setUnit}
                onVariationModeChange={setVariationMode}
                onGenderChange={setGender}
                onAudiencesChange={(next) => {
                  setAudiences(next);
                  setGender(next[0] || "");
                }}
                onProductTypeChange={setProductType}
                onGradeChange={setGrade}
                onIsOfferStoryChange={setIsOfferStory}
                purchaseAlertsEnabled={purchaseAlertsEnabled}
                purchaseAlertByColor={purchaseAlertByColor}
                cartonSize={cartonSize}
                suggestedPurchaseCartons={suggestedPurchaseCartons}
                onPurchaseAlertsEnabledChange={setPurchaseAlertsEnabled}
                onPurchaseAlertByColorChange={setPurchaseAlertByColor}
                onCartonSizeChange={setCartonSize}
                onSuggestedPurchaseCartonsChange={setSuggestedPurchaseCartons}
            />

              {isColorOnlyMode ? (
                <div className="mt-5 rounded-[24px] border border-cyan-400/15 bg-cyan-400/10 p-4">
                  <label className="text-sm font-semibold text-cyan-100">{t("products.editor.fixedSize", "Fixed size")}</label>
                  <input
                    value={fixedSizeLabel}
                    onChange={(event) => setFixedSizeLabel(event.target.value)}
                    placeholder={t("products.editor.oneSize")}
                    className="mt-2 w-full rounded-2xl border border-cyan-400/15 bg-zinc-950 px-4 py-3 text-white outline-none placeholder:text-zinc-500"
                  />
                  <p className="mt-2 text-xs text-cyan-100/70">{t("products.editor.fixedSizeHelp")}</p>
                </div>
              ) : null}
            </SectionCard>

            <SectionCard id="media-ai">
              <SectionHeader
                icon={ImagePlus}
                title={t("products.editor.mediaAiVision")}
                subtitle={t("products.editor.mediaAiVisionHelp")}
                tone="blue"
              />

              <div className="mt-5 grid grid-cols-1 gap-6 xl:grid-cols-2">
                <div>
                  <label className="flex min-h-[260px] cursor-pointer flex-col items-center justify-center rounded-[28px] border-2 border-dashed border-white/10 bg-white/5 p-6 text-center hover:border-blue-400/60">
                    {coverImage ? (
                      <img src={coverImage} alt="cover" className="h-full max-h-[220px] w-full rounded-[24px] object-cover" />
                    ) : (
                      <>
                        <Upload className="text-blue-400" size={42} />
                        <p className="mt-4 text-lg font-semibold text-white">{t("products.editor.uploadProductImage", "رفع صورة المنتج")}</p>
                        <p className="mt-2 text-sm text-zinc-400">{coverLabel || "PNG, JPG, WEBP"}</p>
                      </>
                    )}
                    <input type="file" hidden accept="image/*" onChange={handleCover} />
                  </label>
                  {selectedBrandName ? (
                    <div className="mt-3 inline-flex max-w-full items-center gap-2 rounded-full border border-blue-300/20 bg-blue-400/10 px-3 py-1.5 text-xs font-black text-blue-100">
                      <span className="text-blue-200/70">{t("products.form.brand", "Brand")}</span>
                      <span className="truncate" dir="auto">{selectedBrandName}</span>
                    </div>
                  ) : null}
                  <div className="mt-3 grid gap-2">
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
                      disabled={thermalImageGenerating || !getEligibleThermalColorGroups(colorGroups).length}
                      className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-[16px] border border-amber-300/25 bg-amber-400/10 px-4 text-sm font-black text-amber-100 transition hover:border-amber-300/45 hover:bg-amber-400/15 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {thermalImageGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                      {"Generate AI Thermal Artwork"}
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

                <div className="rounded-[28px] border border-white/8 bg-white/5 p-5">
                  <p className="text-sm font-semibold text-zinc-300">{t("products.editor.galleryUpload", "Gallery upload")}</p>
                  <label className="mt-4 flex min-h-[220px] cursor-pointer items-center justify-center rounded-[24px] border-2 border-dashed border-white/10 bg-zinc-950/60 text-center">
                    <div>
                      <ImagePlus className="mx-auto text-zinc-400" size={38} />
                      <p className="mt-4 text-sm font-semibold text-white">{t("products.editor.addMultipleGalleryImages", "Add multiple gallery images")}</p>
                      <p className="mt-2 text-xs text-zinc-500">{gallery.length} image(s) selected</p>
                    </div>
                    <input type="file" hidden accept="image/*" multiple onChange={handleGallery} />
                  </label>

                  {gallery.length > 0 ? (
                    <div className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(88px,96px))] gap-3">
                      {gallery.map((item) => (
                        <ImageThumbnailActions
                          key={item.id || item.name}
                          image={item}
                          alt={item.name || "Gallery image"}
                          isPrimary={Boolean(coverImage && (coverImage === item.preview || coverImage === item.image_url))}
                          onPrimary={setGalleryItemAsPrimary}
                          deleteDisabled={Boolean(item.uploading)}
                          deleteDisabledReason="Image is still uploading"
                          onDelete={() => removeGalleryItem(item.id || item.name)}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="mt-4 rounded-2xl border border-dashed border-white/10 bg-zinc-950/60 px-4 py-5 text-center text-xs font-semibold text-zinc-500">
                      No gallery images yet.
                    </div>
                  )}
                </div>
              </div>
              {aiVisionPanel}
            </SectionCard>

            <SectionCard id="content-seo">
              <SectionHeader
                icon={Search}
                title={t("products.editor.productContentSeo")}
                subtitle={t("products.editor.productContentSeoHelp")}
                tone="sky"
              />

              <div className="mt-5 overflow-x-auto">
                <div className="flex min-w-max gap-2">
                  {productContentTabs.map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setActiveContentTab(tab.id)}
                      className={`h-9 rounded-[12px] border px-3 text-xs font-bold transition ${
                        activeContentTab === tab.id
                          ? "border-sky-300/40 bg-sky-300/15 text-sky-100"
                          : "border-white/10 bg-white/[0.035] text-zinc-300 hover:border-white/20 hover:bg-white/[0.06]"
                      }`}
                    >
                      {tab.title}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-4">
                {activeContentTab === "description" ? productDescriptionPanel : null}
                {activeContentTab === "description" ? (
                  <div className="mt-4">
                    <MultiVersionGenerator
                      context={descriptionContext}
                      onApplyVersion={applyGeneratedVersion}
                      t={t}
                    />
                  </div>
                ) : null}
                {activeContentTab === "metadata" ? seoMetadataPanel : null}
                {activeContentTab === "preview" ? socialPreviewPanel : null}
              </div>
            </SectionCard>

            <SectionCard id="pricing">
              <SectionHeader
                icon={Barcode}
                title={t("products.editor.pricing")}
                subtitle={t("products.editor.pricingHelp")}
                tone="amber"
              />

              <div className="mt-5 space-y-4">
                <div className="hidden rounded-[18px] border border-white/8 bg-white/[0.028] p-3 transition duration-200 hover:-translate-y-0.5 hover:border-white/14 hover:bg-white/[0.045] hover:shadow-lg hover:shadow-black/10">
                  <div>
                    <p className="text-[11px] font-black uppercase tracking-[0.18em] text-zinc-200">{t("products.editor.identifiers", "Identifiers")}</p>
                    <p className="mt-0.5 text-xs text-zinc-500">{t("products.editor.identifiersHelp", "Internal product codes and scannable labels.")}</p>
                  </div>
                  <div className="mt-2.5 grid grid-cols-1 gap-4 lg:grid-cols-2">
                    <div>
                      <label className="text-[13px] font-semibold text-zinc-100">{t("products.editor.skuPrefix", "SKU prefix")}</label>
                      <div className="mt-1 flex gap-2">
                        <input
                          value={skuPrefix}
                          onChange={(e) => {
                            setSkuPrefix(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ""));
                            setSkuPrefixTouched(true);
                          }}
                          className="h-10 min-w-0 flex-1 rounded-[13px] border border-white/8 bg-white/[0.045] px-3.5 font-semibold text-white shadow-inner shadow-black/20 outline-none ring-1 ring-inset ring-white/[0.045] transition placeholder:text-zinc-600 hover:border-white/14 focus:border-amber-300/35 focus:bg-white/[0.06]"
                        />
                        <button
                          type="button"
                          onClick={regenerateSkuPrefix}
                          className="inline-flex h-10 items-center gap-1.5 rounded-[13px] border border-white/10 bg-white/[0.045] px-2.5 text-xs font-bold text-zinc-100 transition hover:-translate-y-0.5 hover:border-amber-300/30 hover:bg-amber-300/10 hover:text-amber-100 active:translate-y-0"
                        >
                          <Sparkles className="h-3.5 w-3.5" />
                          {t("products.editor.regenerateFromProductName")}
                        </button>
                      </div>
                      <p className="mt-1 text-[11px] text-zinc-500">
                        {t("products.editor.autoSkuPrefix", { prefix: uniqueSmartSkuPrefix, suffix: skuPrefixTouched ? t("products.editor.manualOverrideSuffix") : "" })}
                      </p>
                    </div>

                    <div>
                      <label className="text-[13px] font-semibold text-zinc-100">{t("products.selected.barcode", "Barcode")}</label>
                      <div className="mt-1 flex gap-2">
                        <input
                          value={barcode}
                          onChange={(e) => {
                            setBarcode(e.target.value);
                            setBarcodePreview(e.target.value);
                          }}
                          className="h-10 min-w-0 flex-1 rounded-[13px] border border-white/8 bg-white/[0.045] px-3.5 font-semibold text-white shadow-inner shadow-black/20 outline-none ring-1 ring-inset ring-white/[0.045] transition placeholder:text-zinc-600 hover:border-white/14 focus:border-amber-300/35 focus:bg-white/[0.06]"
                        />
                        <button
                          type="button"
                          onClick={generateNewBarcode}
                          className="inline-flex h-10 items-center gap-1.5 rounded-[13px] border border-white/10 bg-white/[0.045] px-2.5 text-xs font-bold text-zinc-100 transition hover:-translate-y-0.5 hover:border-amber-300/30 hover:bg-amber-300/10 hover:text-amber-100 active:translate-y-0"
                        >
                          <ScanLine size={13} />
                          {t("products.editor.generate")}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="rounded-[18px] border border-white/8 bg-[#0f1725] p-4 transition duration-200 hover:-translate-y-0.5 hover:border-emerald-300/20 hover:shadow-lg hover:shadow-black/10">
                  <div>
                    <p className="text-[11px] font-black uppercase tracking-[0.18em] text-zinc-200">{t("products.editor.pricingSummary", "Pricing summary")}</p>
                    <p className="mt-0.5 text-xs text-zinc-500">{t("products.editor.pricingFilledFromPurchases", "Pricing is filled from purchase invoices after stock is received.")}</p>
                  </div>
                  <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-4">
                    {[
                      t("products.editor.currentRegularPrice"),
                      t("products.editor.currentSalePrice"),
                      t("products.editor.currentCost"),
                      t("products.editor.lastUpdatedFromPurchase"),
                    ].map((label) => (
                      <div key={label} className="rounded-[16px] border border-white/8 bg-white/[0.035] p-3">
                        <p className="text-[11px] font-black uppercase tracking-[0.14em] text-zinc-500">{label}</p>
                        <p className="mt-2 text-sm font-black text-zinc-100">{t("products.editor.notSet")}</p>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 rounded-[16px] border border-white/8 bg-white/[0.035] p-3">
                    <label className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={useCustomComparePrice}
                        onChange={(e) => setUseCustomComparePrice(e.target.checked)}
                        className="mt-1 h-4 w-4 rounded border-white/20 bg-zinc-900"
                      />
                      <span>
                        <span className="block text-[13px] font-black text-zinc-100">{t("products.editor.customComparePrice", "Custom storefront compare price")}</span>
                        <span className="mt-1 block text-xs text-zinc-500">{t("products.editor.customComparePriceCreateHelp", "Marketing-only old price. It does not change cost, POS price, invoices, or profit.")}</span>
                      </span>
                    </label>
                    {useCustomComparePrice ? (
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={customComparePrice}
                        onChange={(e) => setCustomComparePrice(e.target.value)}
                        placeholder={t("products.editor.oldPricePlaceholder", "Old price shown on storefront")}
                        className="mt-3 h-10 w-full rounded-[13px] border border-white/8 bg-white/[0.045] px-3.5 font-semibold text-white shadow-inner shadow-black/20 outline-none ring-1 ring-inset ring-white/[0.045] transition placeholder:text-zinc-600 hover:border-white/14 focus:border-amber-300/35 focus:bg-white/[0.06]"
                      />
                    ) : null}
                  </div>
                </div>

                </div>

                <div className="hidden rounded-[22px] border border-sky-300/18 bg-[#0f1725] p-4 shadow-[0_16px_45px_rgba(0,0,0,0.16)] transition">
                    <button
                      type="button"
                      onClick={() => setSeoOpen((current) => !current)}
                      className="flex w-full items-center justify-between gap-3 text-left"
                    >
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
                              {t("products.editor.googlePreview")}
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
                              {t("products.editor.facebookWhatsappPreview")}
                            </div>
                            <div className="overflow-hidden rounded-[16px] border border-white/10 bg-white/[0.04]">
                              <div className="relative w-full aspect-[1.91/1] overflow-hidden rounded-t-2xl bg-white">
                                {coverImage ? (
                                  <img
                                    src={coverImage}
                                    alt={t("products.editor.openGraphPreviewAlt")}
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
                              value={metaTitle}
                              onChange={(event) => {
                                setMetaTitle(event.target.value);
                                setSeoTouched((current) => ({ ...current, title: true }));
                              }}
                              className="mt-1.5 h-10 w-full rounded-[14px] border border-white/10 bg-zinc-900/80 px-3 text-sm font-semibold text-white shadow-inner shadow-black/20 outline-none"
                            />
                          </div>
                          <div>
                            <label className="text-sm font-semibold text-zinc-300">{t("products.editor.canonicalSlug")}</label>
                            <input
                              value={canonicalSlug}
                              onChange={(event) => {
                                setCanonicalSlug(event.target.value);
                                setSeoTouched((current) => ({ ...current, slug: true }));
                              }}
                              className="mt-1.5 h-10 w-full rounded-[14px] border border-white/10 bg-zinc-900/80 px-3 text-sm font-semibold text-white shadow-inner shadow-black/20 outline-none"
                            />
                          </div>
                          <div className="lg:col-span-2">
                            <label className="text-sm font-semibold text-zinc-300">{t("products.editor.seoMetaDescriptionPreview")}</label>
                            <textarea
                              value={seoDescription}
                              onChange={(event) => {
                                setSeoDescription(event.target.value);
                                setSeoTouched((current) => ({ ...current, description: true }));
                              }}
                              rows={3}
                              className="mt-1.5 w-full rounded-[14px] border border-white/10 bg-zinc-900/80 px-3 py-2 text-sm leading-5 text-white shadow-inner shadow-black/20 outline-none"
                            />
                            <p className="mt-1 text-[11px] text-zinc-500">{seoDescription.length}/160 characters</p>
                          </div>
                          <div className="lg:col-span-2">
                            <label className="text-sm font-semibold text-zinc-300">{t("products.editor.seoKeywords", "SEO keywords")}</label>
                            <input
                              value={seoKeywords}
                              onChange={(event) => {
                                setSeoKeywords(event.target.value);
                                setSeoTouched((current) => ({ ...current, keywords: true }));
                              }}
                              className="mt-1.5 h-10 w-full rounded-[14px] border border-white/10 bg-zinc-900/80 px-3 text-sm text-white shadow-inner shadow-black/20 outline-none"
                            />
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>

              {false && aiProductData ? (
                <div className="mt-5 rounded-[24px] border border-blue-300/20 bg-blue-400/[0.07] p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-black text-white">{t("products.editor.aiProductSuggestions", "AI product suggestions")}</p>
                      <p className="mt-1 text-xs text-zinc-400">
                        {t("products.editor.aiSourceConfidence", { source: aiProductData.source || "AI", confidence: aiProductData.confidence ?? 0 })}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={applyAllAiProductSuggestions}
                      className="inline-flex h-9 items-center rounded-[12px] border border-blue-300/30 bg-blue-300/10 px-3 text-xs font-black text-blue-100 transition hover:bg-blue-300/15"
                    >
                      {t("products.editor.applyAll")}
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
            </SectionCard>
            <SectionCard id="inventory">
              <SectionHeader
                icon={Layers3}
                title={t("products.editor.catalogControls")}
                subtitle={t("products.editor.advancedSettingsHelp")}
                tone="violet"
              />

              <div className="mt-5 space-y-4">
                <label className="flex items-center justify-between rounded-2xl border border-white/8 bg-white/5 px-4 py-3">
                  <span className="text-sm font-semibold text-white">{t("products.editor.activeProduct")}</span>
                  <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
                </label>

                <label className="flex items-center justify-between rounded-2xl border border-white/8 bg-white/5 px-4 py-3">
                  <span className="text-sm font-semibold text-white">{t("products.editor.trackStock")}</span>
                  <input type="checkbox" checked={trackStock} onChange={(e) => setTrackStock(e.target.checked)} />
                </label>

                <div className={`${isSimpleMode ? "hidden" : ""} rounded-2xl border border-white/8 bg-white/5 p-4`}>
                  <button
                    type="button"
                    onClick={() => setAdvancedOpen((current) => !current)}
                    className="flex w-full items-center justify-between gap-3 rounded-2xl border border-white/8 bg-zinc-950/70 px-4 py-3 text-right transition hover:border-white/15"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-black text-white">{t("products.editor.advancedSettings")}</p>
                      <p className="mt-1 text-xs text-zinc-400">{t("products.editor.barcodeMatrixHelp")}</p>
                    </div>
                    <ChevronDown className={`h-4 w-4 shrink-0 text-zinc-400 transition ${advancedOpen ? "rotate-180" : ""}`} />
                  </button>

                  {advancedOpen ? (
                    <div className="mt-4 space-y-4">
                      <div className="rounded-2xl border border-white/8 bg-zinc-950/80 p-4">
                        <p className="text-sm font-semibold text-zinc-300">{t("products.editor.barcodePreview")}</p>
                        <div className="mt-3 rounded-2xl border border-white/8 bg-zinc-950 px-4 py-4">
                          <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">SKU</p>
                          <p className="mt-2 text-xl font-black text-white">{skuPrefix || uniqueSmartSkuPrefix || generateSku(name).split("-")[0]}</p>
                          <div className="mt-4 h-14 rounded-2xl bg-white/5 p-3">
                            <div className="flex h-full items-end gap-1">
                              {Array.from({ length: 22 }).map((_, index) => (
                                <span
                                  key={index}
                                  className="block h-full flex-1 rounded-sm bg-white"
                                  style={{ opacity: index % 2 === 0 ? 0.9 : 0.4, height: `${40 + ((index * 7) % 55)}%` }}
                                />
                              ))}
                            </div>
                          </div>
                          <p className="mt-3 font-mono text-sm text-zinc-300">{barcodePreview}</p>
                        </div>
                      </div>

                      {variantMatrix.length > 0 ? (
                        <div className="rounded-2xl border border-white/8 bg-zinc-950/80 p-4">
                          <p className="text-sm font-semibold text-zinc-300">{t("products.editor.variantMatrix")}</p>
                          <p className="mt-2 text-sm text-zinc-400">
                            {isColorOnlyMode
                              ? t("products.editor.generateFixedSizePerColor")
                              : t("products.editor.generateColorSizeCombinations")}
                          </p>
                          <div className="mt-4 rounded-2xl border border-white/8 bg-zinc-950/70 p-4">
                            <p className="text-xs uppercase tracking-[0.28em] text-zinc-500">{t("products.editor.combinations")}</p>
                            <p className="mt-2 text-2xl font-black text-white">{variantMatrix.length}</p>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            </SectionCard>

            <SectionCard id="variants" hidden={isSimpleMode}>
              <SectionHeader
                icon={Sparkles}
                title={t("products.editor.bulkVariantTools")}
                subtitle={t("products.editor.bulkVariantToolsHelp")}
                tone="emerald"
              />

              <div className={`mt-4 grid gap-4 ${isFullVariationMode ? "xl:grid-cols-3" : "xl:grid-cols-2"}`}>
                {isFullVariationMode ? (
                  <div className="rounded-[20px] border border-white/8 bg-white/5 p-3">
                    <p className="text-xs font-black uppercase tracking-[0.2em] text-emerald-300">{t("products.editor.bulkSizes", "Bulk Sizes")}</p>
                    <label className="mt-3 block">
                      <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
                        {t("products.editor.sizeRange")}
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
                        {t("products.editor.applyToAllColors")}
                      </button>
                    </label>
                  </div>
                ) : null}
                <div className="rounded-[20px] border border-white/8 bg-white/5 p-3">
                  <p className="text-xs font-black uppercase tracking-[0.2em] text-violet-300">{t("products.editor.bulkStockTools", "Bulk Stock Tools")}</p>
                  <label className="mt-3 block">
                    <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
                      {t("products.editor.stockQuantity")}
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
                    {t("products.editor.applyStockAllSizes")}
                  </button>
                  <p className="mt-2 text-xs leading-5 text-zinc-500">
                    {t("products.editor.planningStockOnly")}
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
            </SectionCard>

            <SectionCard hidden={isSimpleMode}>
              <div className="sticky top-3 z-20 -mx-1 mb-5 rounded-[18px] border border-white/10 bg-[#10172a]/95 p-3 shadow-[0_18px_50px_rgba(0,0,0,0.24)] backdrop-blur">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <SectionHeader
                    icon={Layers3}
                    title={t("products.editor.variantColorGroups")}
                    subtitle={t("products.editor.variantColorGroupsHelp")}
                    tone="cyan"
                  />

                  <button
                    type="button"
                    onClick={addColorGroup}
                    className={buttonClasses("primary", "h-9 rounded-full px-4")}
                  >
                    <Plus size={16} strokeWidth={2} />
                    {t("products.editor.addColor")}
                  </button>
                </div>
              </div>

              <div className="mt-4 rounded-[20px] border border-white/8 bg-white/5 p-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">{t("products.editor.defaultManufacturer")}</p>
                  <p className="mt-1 text-sm text-zinc-400">
                    {t("products.editor.defaultManufacturerHelp")}
                  </p>
                </div>
                <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
                  <label className="block">
                    <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">{t("products.fields.manufacturer", "Manufacturer")}</div>
                    <select
                      value={defaultManufacturerId}
                      onChange={(e) => applyDefaultManufacturer(e.target.value)}
                      className="manufacturer-select-dropdown h-10 w-full rounded-[14px] border border-white/8 bg-zinc-950 px-3 text-sm text-white outline-none"
                    >
                      <option value="">{t("products.editor.selectManufacturer", "Select manufacturer")}</option>
                      {manufacturers.map((manufacturer) => (
                        <option
                          key={String(manufacturer.id || manufacturer.manufacturer_id || manufacturer.manufacturerId || manufacturer.label || manufacturer.name)}
                          value={String(manufacturer.id || manufacturer.manufacturer_id || manufacturer.manufacturerId || "")}
                          className="bg-zinc-950 text-white"
                          style={{ backgroundColor: "#09090b", color: "#fff" }}
                        >
                          {manufacturer.name || manufacturer.manufacturer_name || manufacturer.manufacturerName || manufacturer.label || String(manufacturer.id || manufacturer.manufacturer_id || "")}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="rounded-[14px] border border-white/8 bg-zinc-950/60 px-3 py-2">
                    <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">{t("products.editor.behavior")}</div>
                    <div className="mt-1 text-sm text-zinc-200">
                      {t("products.editor.defaultColorsHelp")}
                    </div>
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
                          {group.imagePreview ? (
                            <img
                              src={group.imagePreview}
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
                            {getColorGroupThermalUrl(group) ? (
                              <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-200">
                                Thermal Artwork جاهز
                              </span>
                            ) : null}
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
                            className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-zinc-950 text-red-300"
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
                              <label className="flex h-20 w-20 cursor-pointer items-center justify-center overflow-hidden rounded-[12px] border border-white/10 bg-zinc-950/70">
                                {getPrimaryColorImage(group) ? (
                                  <img
                                    src={getPrimaryColorImage(group)}
                                    alt={group.color || `Color ${groupIndex + 1}`}
                                    className="h-full w-full object-contain p-2"
                                  />
                                ) : (
                                  <div className="text-center">
                                    <ImagePlus className="mx-auto text-zinc-400" size={26} />
                                    <span className="mt-2 block text-[11px] font-semibold text-zinc-500">{t("products.editor.colorImages")}</span>
                                  </div>
                                )}
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
                                {t("products.shared.add")}
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
                              <div className="flex w-full max-w-[520px] flex-col gap-2">
                                <div className="rounded-[12px] border border-white/10 bg-zinc-950/70 p-2">
                                  <div className="flex h-20 items-center justify-center overflow-hidden rounded-[10px] bg-zinc-900">
                                    {getPrimaryColorImage(group) ? (
                                      <img
                                        src={getPrimaryColorImage(group)}
                                        alt={`${group.color || `Color ${groupIndex + 1}`} original`}
                                        className="h-full w-full object-contain"
                                      />
                                    ) : (
                                      <span className="text-[10px] font-semibold text-zinc-500">لا توجد صورة</span>
                                    )}
                                  </div>
                                </div>
                                {getColorGroupThermalUrl(group) ? (
                                  <div className="rounded-[12px] border border-emerald-400/20 bg-emerald-400/10 px-3 py-2 text-[11px] font-semibold text-emerald-100">
                                    Thermal Artwork جاهز
                                  </div>
                                ) : null}
                              </div>
                              <div className="grid w-full max-w-[520px] grid-cols-[repeat(auto-fill,minmax(88px,96px))] gap-2.5">
                                {(normalizeColorImages(group.images).length > 0 ? normalizeColorImages(group.images) : []).map((image, imageIndex) => (
                                  <ImageThumbnailActions
                                    key={image.id || `${group.id}-${imageIndex}`}
                                    image={image}
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
                                    {t("products.images.noImage")}
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
                                    value={group.color_article_code || ""}
                                    onChange={(e) => updateColorGroup(group.id, "color_article_code", e.target.value)}
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
                                          {t("products.editor.searchingSimilarProducts")}
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
                                    className="manufacturer-select-dropdown h-10 w-full rounded-[14px] border border-white/8 bg-zinc-950 px-3 text-sm text-white outline-none"
                                  >
                                    <option value="">{t("products.editor.selectManufacturer", "Select manufacturer")}</option>
                                    {manufacturers.map((manufacturer) => (
                                      <option
                                        key={String(manufacturer.id || manufacturer.manufacturer_id || manufacturer.manufacturerId || manufacturer.label || manufacturer.name)}
                                        value={String(manufacturer.id || manufacturer.manufacturer_id || manufacturer.manufacturerId || "")}
                                        className="bg-zinc-950 text-white"
                                        style={{ backgroundColor: "#09090b", color: "#fff" }}
                                      >
                                        {manufacturer.name || manufacturer.manufacturer_name || manufacturer.manufacturerName || manufacturer.label || String(manufacturer.id || manufacturer.manufacturer_id || "")}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              </div>

                              <div className="flex flex-wrap items-center gap-2">
                                <div className="flex flex-wrap items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => detectColorNameForGroup(group.id, getPrimaryColorImage(group) || group.imagePreview || group.image_url, { overwrite: true })}
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
                                      source: getPrimaryColorImage(group) || group.imagePreview || group.image_url,
                                      alt: group.color || `Color ${groupIndex + 1}`,
                                    })
                                  }
                                  disabled={Boolean(colorDetecting[group.id]) || !getPrimaryColorImage(group)}
                                  className="inline-flex h-10 items-center justify-center rounded-[14px] border border-white/10 bg-white/5 px-3 text-sm font-semibold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-45"
                                >
                                  اختيار اللون
                                </button>
                                {mirrorEditionEnabled ? (
                                  <button
                                    type="button"
                                    onClick={() => requestEditionSuggestion(group)}
                                    disabled={editionSuggestions[group.id]?.status === "loading"}
                                    className="inline-flex h-10 items-center justify-center gap-1.5 rounded-[14px] border border-violet-400/20 bg-violet-400/10 px-3 text-sm font-semibold text-violet-100 transition hover:bg-violet-400/15 disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    {editionSuggestions[group.id]?.status === "loading" ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                                      اقتراح الإصدار
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
                                      تطبيق الأحجام دفعة واحدة
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
                                      إضافة مقاس
                                    </button>
                                  ) : null}
                                  {isCrocsProductType(productType) ? (
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

                                <div className="hidden rounded-[12px] border border-white/8 bg-white/5 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500 xl:grid xl:grid-cols-[minmax(120px,1fr)_120px_minmax(130px,150px)_minmax(160px,185px)_minmax(130px,150px)_110px] xl:gap-2">
                                  <div>{t("products.fields.size", "Size")}</div>
                                  <div>{t("products.editor.stockQty", "Stock Qty")}</div>
                                  <div>SKU</div>
                                  <div>{t("products.selected.barcode", "Barcode")}</div>
                                  <div>{t("products.fields.articleCode", "Article Code")}</div>
                                  <div>{t("products.table.actions", "Actions")}</div>
                                </div>

                                <div className="mt-2 max-w-full space-y-2 overflow-x-auto">
                                  {(isColorOnlyMode ? group.sizes.slice(0, 1) : group.sizes).map((row, rowIndex) => (
                                  <div
                                    key={row.id}
                                    className="grid min-w-[820px] gap-2 rounded-[12px] border border-white/8 bg-white/5 p-3 xl:min-w-0 xl:grid-cols-[minmax(120px,1fr)_120px_minmax(130px,150px)_minmax(160px,185px)_minmax(130px,150px)_110px] xl:items-start xl:py-2"
                                  >
                                      <div>
                                        <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500 xl:sr-only">
                                          {isColorOnlyMode ? t("products.editor.fixedSize", "المقاس الثابت") : t("products.fields.size", "المقاس")}
                                        </label>
                                        <input
                                          value={row.size}
                                          onChange={(e) => updateSizeRow(group.id, row.id, "size", e.target.value)}
                                          placeholder={isColorOnlyMode ? fixedSizeLabel || t("products.editor.oneSize", "مقاس واحد") : "40"}
                                          className="mt-1.5 h-10 w-full rounded-[12px] border border-white/8 bg-zinc-950 px-3 text-sm text-white outline-none placeholder:text-zinc-500 xl:mt-0"
                                        />
                                        {isCrocsProductType(productType) ? (
                                          <p className="mt-1 text-[11px] font-semibold leading-4 text-cyan-200/90">
                                            {getCrocsSizeInputDisplayLabel(row.size)}
                                          </p>
                                        ) : null}
                                      </div>
                                      <div>
                                        <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500 xl:sr-only">{t("products.editor.stockQty", "الكمية المخزنة")}</label>
                                        <input
                                          type="number"
                                          min="0"
                                          step="1"
                                          value={row.stock ?? ""}
                                          onChange={(e) => updateSizeRow(group.id, row.id, "stock", e.target.value)}
                                          placeholder="0"
                                          className="mt-1.5 h-10 w-full rounded-[12px] border border-white/8 bg-zinc-950 px-3 text-sm text-white outline-none placeholder:text-zinc-500 xl:mt-0"
                                        />
                                        <p className="mt-1 text-[10px] leading-4 text-zinc-500 xl:hidden">{t("products.editor.preparationOnlyStock", "للتجهيز فقط. تتم إضافة المخزون الفعلي من فواتير الشراء.")}</p>
                                      </div>
                                      <div>
                                        <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500 xl:sr-only">SKU</label>
                                        <input
                                          value={row.sku}
                                          onChange={(e) => updateSizeRow(group.id, row.id, "sku", e.target.value)}
                                          placeholder=""
                                          className="mt-1.5 h-10 w-full rounded-[12px] border border-white/8 bg-zinc-950 px-3 text-sm text-white outline-none placeholder:text-zinc-500 xl:mt-0"
                                        />
                                      </div>
                                      <div>
                                        <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500 xl:sr-only">{t("products.selected.barcode", "Barcode")}</label>
                                        <input
                                          value={row.barcode}
                                          onChange={(e) => updateSizeRow(group.id, row.id, "barcode", e.target.value)}
                                          placeholder={t("products.editor.scanOrEnterBarcode", "امسح أو أدخل الباركود")}
                                          className="mt-1.5 h-10 w-full rounded-[12px] border border-white/8 bg-zinc-950 px-3 text-sm text-white outline-none placeholder:text-zinc-500 xl:mt-0"
                                        />
                                      </div>
                                      <div>
                                        <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500 xl:sr-only">{t("products.fields.articleCode", "Article Code")}</label>
                                        <input
                                          value={row.article_code || ""}
                                          onChange={(e) => updateSizeRow(group.id, row.id, "article_code", e.target.value)}
                                          placeholder="L122-40"
                                          className="mt-1.5 h-10 w-full rounded-[12px] border border-white/8 bg-zinc-950 px-3 text-sm text-white outline-none placeholder:text-zinc-500 xl:mt-0"
                                        />
                                      </div>
                                      <div className="flex items-start">
                                        <button
                                          type="button"
                                          onClick={() => removeSizeRow(group.id, row.id)}
                                          disabled={isColorOnlyMode || (group.sizes.length === 1 && rowIndex === 0)}
                                          className="inline-flex h-10 w-full items-center justify-center rounded-[12px] border border-white/10 bg-zinc-950 px-3 text-sm font-semibold text-red-300 disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                          إزالة
                                        </button>
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
            </SectionCard>

            <SectionCard hidden={isSimpleMode}>
              <SectionHeader
                icon={ScanLine}
                title={t("products.editor.variantPreview")}
                subtitle={isColorOnlyMode ? t("products.editor.colorOnlyPreviewHelp") : t("products.editor.variantPreviewAfterSave")}
                tone="emerald"
              />

              {variantNotice ? (
                <div className="mt-4 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                  {variantNotice}
                </div>
              ) : null}

              <div className="mt-5 space-y-3">
                {variantMatrix.length === 0 ? (
                  <div className="rounded-2xl border border-white/8 bg-white/5 p-5 text-sm text-zinc-400">
                    {isColorOnlyMode
                      ? t("products.editor.addColorToPreview", "أضف اسم لون لمعاينة المتغيرات ثابتة المقاس.")
                      : t("products.editor.addColorAndSizeToPreview", "أضف اسم لون وصفًا واحدًا على الأقل للمقاسات لتوليد التركيبات.")}
                  </div>
                ) : (
                  variantMatrix.slice(0, 8).map((variant, index) => (
                    <div key={`${variant.previewKey}-${index}`} className="rounded-2xl border border-white/8 bg-white/5 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="font-semibold text-white">
                            {variant.color} / {variant.size}
                          </p>
                          <p className="mt-1 text-xs font-mono text-zinc-500">{variant.sku}</p>
                        </div>
                        <span className="block text-xs text-zinc-500">{variant.image_url ? t("products.editor.colorImageLinked", "تم ربط صورة اللون") : t("products.editor.noImageLinked", "لا توجد صورة مرتبطة")}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </SectionCard>
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-full bg-emerald-500 px-6 py-3 font-semibold text-white disabled:opacity-60"
          >
            <Plus size={18} />
            {saving ? t("common.saving", "جارٍ الحفظ...") : t("products.editor.createTitle", "إنشاء منتج")}
          </button>
          <button
            type="button"
            onClick={() => navigate("/products")}
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-6 py-3 font-semibold text-white"
          >
            إلغاء
          </button>
        </div>
      </form>
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

export default CreateProduct;

function ColorPickModal({ target, onClose, onPick }) {
  const { t } = useTranslation();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
      <div className="w-full max-w-2xl rounded-[28px] border border-white/10 bg-zinc-950 p-4 shadow-2xl">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-black text-white">{t("products.editor.pickColor", "اختيار اللون")}</p>
            <p className="mt-1 text-xs text-zinc-400">{t("products.editor.pickColorHelp", "انقر على لون مادة الحذاء الحقيقي، وليس النعل أو الخلفية.")}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-2xl border border-white/10 px-3 py-2 text-sm font-semibold text-white">
            {t("common.close", "إغلاق")}
          </button>
        </div>
        <div className="flex max-h-[70vh] items-center justify-center overflow-auto rounded-2xl bg-zinc-900">
          <img
            src={target.source}
            alt={target.alt || t("products.editor.pickColor", "اختيار اللون")}
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

const toneClasses = {
  emerald: "border-emerald-400/20 bg-emerald-500/10 text-emerald-300 shadow-emerald-500/10",
  blue: "border-blue-400/20 bg-blue-500/10 text-blue-300 shadow-blue-500/10",
  amber: "border-amber-400/20 bg-amber-500/10 text-amber-300 shadow-amber-500/10",
  violet: "border-violet-400/20 bg-violet-500/10 text-violet-300 shadow-violet-500/10",
  cyan: "border-cyan-400/20 bg-cyan-500/10 text-cyan-300 shadow-cyan-500/10",
  sky: "border-sky-400/20 bg-sky-500/10 text-sky-300 shadow-sky-500/10",
};

const buttonClasses = (variant = "secondary", extra = "") => {
  const base = "inline-flex items-center justify-center gap-2 text-sm font-semibold transition duration-200 disabled:cursor-not-allowed disabled:opacity-50";
  const variants = {
    primary: "bg-gradient-to-r from-emerald-500 to-teal-400 text-white shadow-lg shadow-emerald-500/18 hover:-translate-y-0.5 hover:shadow-emerald-500/24",
    secondary: "border border-white/10 bg-white/[0.06] text-zinc-100 shadow-sm shadow-black/10 hover:-translate-y-0.5 hover:border-white/18 hover:bg-white/[0.09]",
    ghost: "text-zinc-300 hover:bg-white/[0.06] hover:text-white",
    danger: "border border-red-400/20 bg-red-500/10 text-red-200 hover:border-red-300/35 hover:bg-red-500/15",
  };
  return `${base} ${variants[variant] || variants.secondary} ${extra}`;
};

function SectionHeader({ icon: Icon, title, subtitle, tone = "emerald", action = null }) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl border shadow-[0_0_28px_var(--tw-shadow-color)] ${toneClasses[tone] || toneClasses.emerald}`}>
          <Icon size={18} strokeWidth={2} />
        </div>
        <div className="min-w-0">
          <h2 className="text-xl font-semibold tracking-tight text-white">{title}</h2>
          {subtitle ? <p className="mt-1 text-sm leading-5 text-zinc-400">{subtitle}</p> : null}
        </div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

function SectionCard({ children, hidden = false, className = "", id }) {
  if (hidden) return null;
  return (
    <section id={id} className={`m1-create-section scroll-mt-24 rounded-[18px] border border-white/8 bg-[#10172a] p-4 transition duration-200 sm:p-5 ${className}`}>
      {children}
    </section>
  );
}

function ProductActionBar({ mode = "create", saving = false, savingStep = "", hasUnsavedChanges = false, formId }) {
  const { t } = useTranslation();
  const label =
    mode === "create"
      ? t("products.editor.saveProduct", "حفظ المنتج")
      : t("products.editor.updateProduct", "تحديث المنتج");

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-[#0b1020]/95 px-4 py-3 shadow-[0_-18px_60px_rgba(0,0,0,0.38)] backdrop-blur md:left-auto md:right-6 md:bottom-6 md:w-auto md:min-w-[360px] md:rounded-[24px] md:border">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-zinc-500">{t("products.editor.productEditor", "محرر المنتج")}</p>
          <p className={`mt-1 text-sm font-semibold ${hasUnsavedChanges ? "text-amber-200" : "text-emerald-200"}`}>
            {saving && savingStep
              ? savingStep
              : hasUnsavedChanges
              ? t("products.editor.unsavedChanges", "توجد تغييرات غير محفوظة")
              : t("products.editor.noChangesYet", "لا توجد تغييرات بعد")}
          </p>
        </div>
        <button
          type="submit"
          form={formId}
          disabled={saving}
          className={buttonClasses("primary", "h-11 w-full rounded-[14px] px-5 sm:w-auto")}
        >
          {saving ? <Loader2 size={16} strokeWidth={2} className="animate-spin" /> : <Save size={16} strokeWidth={2} />}
          {saving ? savingStep || t("common.saving", "جارٍ الحفظ...") : label}
        </button>
      </div>
    </div>
  );
}
