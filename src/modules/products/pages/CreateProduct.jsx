import { useEffect, useMemo, useRef, useState } from "react";

import { Link, useNavigate } from "react-router-dom";

import {
  Barcode,
  ChevronDown,
  ChevronRight,
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

import {
  generateBarcode,
  generateSku,
  buildSmartSkuPrefix,
  buildVariantSku,
  makeUniqueSku,
  resolveBrandPayload,
  resolveCategoryPayload,
  resolveUnitPayload,
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
  parseBulkPrice,
  parseBulkSizes,
  parseBulkStock,
} from "../lib/variantBulkSizes";
import { dedupeImages } from "../lib/dedupeImages";
import colorNameFromImage, { colorNameFromImagePoint, debugColorDetection } from "../../../shared/utils/colorNameFromImage";
import {
  createProduct,
  generateAiProductData,
  getManufacturers,
  normalizeVariantPayload,
  suggestMirrorEditionName,
  uploadProductImage,
} from "../services/productsApi";
import { isMirrorProduct, slugifyEdition } from "../../../shared/lib/mirrorProduct";
import { isInvalidEditionName } from "../../../shared/lib/editionNameGenerator";
import { safeGenerateProductDescriptions } from "../../../shared/lib/generateProductDescriptions";

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

const makeId = () =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const createEmptySizeRow = (defaults = {}) => createVariantRow(defaults);

const createEmptyColorGroup = (defaults = {}) => {
  const source = typeof defaults === "string" ? { manufacturer_id: defaults } : defaults || {};
  return {
    id: makeId(),
    color: String(source.color || "").trim(),
    manufacturer_id: String(source.manufacturer_id || "").trim(),
    manufacturer_override: Boolean(source.manufacturer_override),
    edition_name: String(source.edition_name || "").trim(),
    edition_slug: String(source.edition_slug || slugifyEdition(source.edition_name || "") || "").trim(),
    imagePreview: String(source.imagePreview || "").trim(),
    image_url: String(source.image_url || "").trim(),
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
  manufacturers.find((item) => String(item.id) === String(defaultManufacturerId))?.name || "";

const SEO_PANEL_STATE_KEY = "erp.products.seoPanelOpen";

function CreateProduct() {
  const navigate = useNavigate();

  const categories = useMemo(() => seedCategories(), []);
  const brands = useMemo(() => seedBrands(), []);
  const units = useMemo(() => seedUnits(), []);
  const [manufacturers, setManufacturers] = useState([]);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [descriptionAr, setDescriptionAr] = useState("");
  const [descriptionEn, setDescriptionEn] = useState("");
  const [descriptionTouched, setDescriptionTouched] = useState({ ar: false, en: false });
  const [descriptionGenerating, setDescriptionGenerating] = useState({ ar: false, en: false });
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
  const [productType, setProductType] = useState("");
  const [style, setStyle] = useState("");
  const [grade, setGrade] = useState("");
  const [variationMode, setVariationMode] = useState("full_variations");
  const [fixedSizeLabel, setFixedSizeLabel] = useState("One Size");
  const [brand, setBrand] = useState("");
  const [unit, setUnit] = useState("");
  const [barcode, setBarcode] = useState(generateBarcode());
  const [skuPrefix, setSkuPrefix] = useState("");
  const [skuPrefixTouched, setSkuPrefixTouched] = useState(false);
  const [costPrice, setCostPrice] = useState("");
  const [salePrice, setSalePrice] = useState("");
  const [wholesalePrice, setWholesalePrice] = useState("");
  const [stock, setStock] = useState("0");
  const [lowStockThreshold, setLowStockThreshold] = useState("10");
  const [active, setActive] = useState(true);
  const [trackStock, setTrackStock] = useState(true);
  const [coverImage, setCoverImage] = useState("");
  const [gallery, setGallery] = useState([]);
  const [saving, setSaving] = useState(false);
  const [defaultManufacturerId, setDefaultManufacturerId] = useState("");
  const [colorGroups, setColorGroups] = useState([createEmptyColorGroup()]);
  const [bulkSizesInput, setBulkSizesInput] = useState("");
  const [bulkPriceInput, setBulkPriceInput] = useState("");
  const [bulkStockInput, setBulkStockInput] = useState("");
  const [expandedGroupId, setExpandedGroupId] = useState(colorGroups[0]?.id || "");
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

  const isFullVariationMode = variationMode === "full_variations";
  const isColorOnlyMode = variationMode === "color_only";
  const isSimpleMode = variationMode === "simple";
  const mirrorEditionEnabled = isMirrorProduct({
    product_type: productType,
    category: childCategory || subCategory || mainCategory,
    style,
    grade,
  });
  const descriptionContext = useMemo(
    () => ({
      name,
      brand,
      manufacturer: getDefaultManufacturerName(manufacturers, defaultManufacturerId),
      category: childCategory || subCategory || mainCategory,
      gender,
      productType,
      style,
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
      gender,
      productType,
      style,
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
  const smartSkuPrefix = useMemo(
    () =>
      buildSmartSkuPrefix({
        name,
        brand,
        manufacturer: getDefaultManufacturerName(manufacturers, defaultManufacturerId),
        productType,
        category: childCategory || subCategory || mainCategory,
        gender,
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
  useEffect(() => {
    if (!skuPrefixTouched) setSkuPrefix(smartSkuPrefix);
  }, [skuPrefixTouched, smartSkuPrefix]);
  const regenerateSkuPrefix = () => {
    setSkuPrefix(smartSkuPrefix);
    setSkuPrefixTouched(false);
  };
  const regenerateDescriptions = (target = "all") => {
    setDescriptionGenerating({ ar: target === "all" || target === "ar", en: target === "all" || target === "en" });
    window.setTimeout(() => {
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
      setDescriptionGenerating({ ar: false, en: false });
    }, 180);
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
          productType ||
          style ||
          grade ||
          brand ||
          unit ||
          skuPrefix ||
          costPrice ||
          salePrice ||
          wholesalePrice ||
          coverImage ||
          gallery.length > 0 ||
          colorGroups.some((group) =>
            Boolean(
              String(group?.color || "").trim() ||
                String(group?.imagePreview || "").trim() ||
                String(group?.image_url || "").trim() ||
                (Array.isArray(group?.images) && group.images.length > 0) ||
                (Array.isArray(group?.sizes) &&
                  group.sizes.some((row) =>
                    [row?.size, row?.stock, row?.sku, row?.price].some((value) => String(value || "").trim())
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
      productType,
      style,
      grade,
      brand,
      unit,
      skuPrefix,
      costPrice,
      salePrice,
      wholesalePrice,
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

  const hasGroupContent = (group) =>
    Boolean(
      String(group?.color || "").trim() ||
        String(group?.edition_name || "").trim() ||
        String(group?.imagePreview || "").trim() ||
        String(group?.image_url || "").trim() ||
        (Array.isArray(group?.images) && group.images.length > 0) ||
        (Array.isArray(group?.sizes) &&
          group.sizes.some((row) =>
            [row?.size, row?.stock, row?.sku, row?.price].some((value) => String(value || "").trim())
          ))
    );

  const hasRowContent = (row) =>
    Boolean([row?.size, row?.stock, row?.sku, row?.barcode, row?.price].some((value) => String(value || "").trim()));

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

  const getGroupStockTotal = (group) =>
    (Array.isArray(group?.sizes) ? group.sizes : []).reduce((sum, row) => sum + Number(row.stock || 0), 0);

  const getEditionSuggestionInput = (group = {}) => ({
    image_url: normalizeColorImages(group.images)
      .map((image) => image.image_url || image.preview)
      .filter((image) => /^https?:\/\//i.test(String(image || "")))
      [0] || "",
    product_name: name,
    brand,
    manufacturer: getManufacturerPayload(group.manufacturer_id).manufacturer_name || "",
    color_name: group.color,
    color: group.color,
    images: normalizeColorImages(group.images)
      .map((image) => image.image_url || image.preview)
      .filter(Boolean)
      .slice(0, 3),
    style,
    gender,
    product_type: productType,
  });

  const pageNavSections = [
    { id: "basic-info", title: "Basic Info" },
    { id: "media-ai", title: "Media" },
    { id: "content-seo", title: "SEO" },
    { id: "pricing", title: "Pricing" },
    { id: "inventory", title: "Inventory" },
    { id: "variants", title: "Variants" },
  ];
  const productContentTabs = [
    { id: "description", title: "Customer Description" },
    { id: "metadata", title: "SEO Metadata" },
    { id: "preview", title: "Facebook/WhatsApp Preview" },
  ];
  const scrollToSection = (sectionId) => {
    document.getElementById(sectionId)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const variantMatrix = useMemo(() => {
    if (isSimpleMode) return [];
    const basePrice = Number(salePrice || 0);

    const previewSkus = new Set();
    if (isColorOnlyMode) {
      return colorGroups.flatMap((group, groupIndex) => {
        const groupColor = String(group.color || "").trim();
        if (!groupColor) return [];
        return [
          {
            previewKey: `${group.id || groupIndex}-${groupColor}-color-only`,
            color: groupColor,
            size: String(fixedSizeLabel || "One Size").trim() || "One Size",
            stock: Number(group.sizes?.[0]?.stock || 0),
            sku: String(group.sizes?.[0]?.sku || "").trim()
              ? makeUniqueSku(String(group.sizes?.[0]?.sku || "").trim().toUpperCase(), previewSkus)
              : buildVariantSku({ prefix: skuPrefix || smartSkuPrefix, color: groupColor, size: String(fixedSizeLabel || "One Size").trim() || "One Size", usedSkus: previewSkus }),
            barcode: String(group.sizes?.[0]?.barcode || "").trim(),
            price: Number(group.sizes?.[0]?.price || basePrice || 0),
            image_url: String(getPrimaryColorImage(group) || "").trim(),
            manufacturer_id: String(group.manufacturer_id || "").trim(),
          },
        ];
      });
    }

    return colorGroups.flatMap((group, groupIndex) => {
      const groupColor = String(group.color || "").trim();
      if (!groupColor) return [];

          return (Array.isArray(group.sizes) ? group.sizes : [])
        .filter((row) => groupColor && String(row.size || "").trim())
        .map((row, rowIndex) => ({
          previewKey: `${group.id || groupIndex}-${row.id || rowIndex}-${groupColor}-${String(row.size || "").trim()}`,
          color: groupColor,
          size: String(row.size || "").trim(),
          stock: Number(row.stock || 0),
          sku: String(row.sku || "").trim()
            ? makeUniqueSku(String(row.sku || "").trim().toUpperCase(), previewSkus)
            : buildVariantSku({ prefix: skuPrefix || smartSkuPrefix, color: groupColor, size: String(row.size || "").trim(), usedSkus: previewSkus }),
          barcode: String(row.barcode || "").trim(),
          price: Number(row.price || basePrice || 0),
          image_url: String(getPrimaryColorImage(group) || "").trim(),
          manufacturer_id: String(group.manufacturer_id || "").trim(),
        }));
    });
  }, [colorGroups, fixedSizeLabel, isColorOnlyMode, isSimpleMode, salePrice, skuPrefix, smartSkuPrefix]);

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
          if (!overwrite && String(group.color || "").trim()) return group;
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
    toast.success("Image removed");
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
            colorImageUrlsRef.current.set(colorGroupId, uploadedUrl);
          }
          return { preview, image_url: uploadedUrl || "", name: file?.name || `Color image ${index + 1}` };
        })
        .catch((error) => {
          console.warn("[products:add] color image upload failed, keeping preview only:", {
            colorGroupId,
            message: error?.message,
            status: error?.status,
            responseBody: error?.responseBody,
          });
          toast.error("Color image upload failed. Preview kept locally.");
          return { preview, image_url: "", name: file?.name || `Color image ${index + 1}` };
        });
      pendingColorUploadsRef.current.set(`${colorGroupId}:${index}`, uploadPromise);
      try {
        return await uploadPromise;
      } finally {
        pendingColorUploadsRef.current.delete(`${colorGroupId}:${index}`);
      }
    });

    const items = await Promise.all(uploads);
    updateColorGroupImages(colorGroupId, (images) => {
      const normalized = dedupeImages([...images, ...items.map((item, index) => createColorImageItem({ ...item, is_primary: images.length === 0 && index === 0 }, index + images.length)).filter(Boolean)]);
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
              sizes: [
                ...group.sizes,
                createEmptySizeRow({
                  image_url: getPrimaryColorImage(group) || colorImageUrlsRef.current.get(group.id) || "",
                  manufacturer_id: group.manufacturer_id || "",
                  price: salePrice || "",
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
      price: salePrice || 0,
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
      toast.error("Enter price first");
      return;
    }

    if (parsedPrice === null) {
      toast.error("Enter a valid price");
      return;
    }

    const { groups: updatedGroups } = applyBulkPriceToGroups({
      groups: colorGroups,
      price: parsedPrice,
      targetGroupId,
    });

    console.log("[bulk-price] updated groups", updatedGroups);
    setColorGroups(updatedGroups);
    toast.success("Price applied successfully");
  };

  const applyBulkStock = (targetGroupId = null) => {
    const parsedStock = parseBulkStock(bulkStockInput);
    console.log("[bulk-stock] raw input", bulkStockInput);
    console.log("[bulk-stock] parsed stock", parsedStock);
    console.log("[bulk-stock] target", targetGroupId ? { groupId: targetGroupId } : "all colors");

    if (!String(bulkStockInput || "").trim()) {
      toast.error("Enter stock first");
      return;
    }

    if (parsedStock === null) {
      toast.error("Enter a valid stock");
      return;
    }

    const { groups: updatedGroups } = applyBulkStockToGroups({
      groups: colorGroups,
      stock: parsedStock,
      targetGroupId,
    });

    console.log("[bulk-stock] updated groups", updatedGroups);
    setColorGroups(updatedGroups);
    setStock(String(updatedGroups.reduce((sum, group) => sum + getGroupStockTotal(group), 0)));
      toast.success("Default purchase quantity applied successfully");
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
      prev.map((group) =>
        group.id === colorGroupId
          ? {
              ...group,
              sizes: group.sizes.map((row) =>
                row.id === sizeRowId
                  ? {
                      ...row,
                      [field]: field === "barcode" ? String(value || "") : value,
                    }
                  : row
              ),
            }
          : group
      )
    );
  };

  const handleCover = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const preview = await readFileAsDataUrl(file);
    setCoverImage(preview);
    setCoverLabel(file.name);
  };

  const buildAiProductPayload = () => ({
    ...getAiImagePayload(coverImage),
    color_name: colorGroups.map((group) => group.color).filter(Boolean).join(", "),
    product_name: name,
    brand,
    manufacturer: getDefaultManufacturerName(manufacturers, defaultManufacturerId),
    current: {
      ...descriptionContext,
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
          name_en: name,
          name_ar: name,
          description_ar: fallback.description_ar,
          description_en: fallback.description_en,
          meta_title_en: fallback.meta_title,
          seo_description_en: fallback.seo_description,
          seo_keywords: fallback.seo_keywords,
          canonical_slug: fallback.canonical_slug,
          suggested_category: childCategory || subCategory || mainCategory,
          suggested_style: style,
          suggested_product_type: productType,
          gender,
          grade,
          dominant_colors: colorGroups.map((group) => group.color).filter(Boolean),
          detection_confidence: {
            colors: colorGroups.some((group) => String(group.color || "").trim()) ? 45 : 15,
            style: style ? 35 : 15,
            product_type: productType ? 40 : 15,
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
    if (field === "suggested_style") setStyle(value);
    if (field === "suggested_product_type") setProductType(value);
    if (field === "gender") setGender(value);
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
      style,
      productType,
      gender,
      grade,
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

  const generateNewBarcode = () => {
    const next = generateBarcode();
    setBarcode(next);
    setBarcodePreview(next);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setVariantNotice("");

    if (!name.trim()) {
      toast.error("Product name is required");
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

      const pendingUploads = Array.from(pendingColorUploadsRef.current.values());
      if (pendingUploads.length > 0) {
        await Promise.allSettled(pendingUploads);
      }

      const usedVariantSkus = new Set();
      const generatedVariants = filledGroups.flatMap((group) => {
        const groupColor = String(group.color || "").trim();
        const groupImageUrl = String(getPrimaryColorImage(group) || colorImageUrlsRef.current.get(group.id) || "").trim();
        const groupEditionName = mirrorEditionEnabled ? String(group.edition_name || "").trim() : "";
        const groupEditionSlug = groupEditionName ? slugifyEdition(group.edition_slug || groupEditionName) : "";
        const groupManufacturerPayload = getManufacturerPayload(group.manufacturer_id);
        if (!groupColor) return [];

        if (isColorOnlyMode) {
          const sourceRow = (Array.isArray(group.sizes) ? group.sizes : [])[0] || {};
          return [
            normalizeVariantPayload({
              color: groupColor,
              size: String(fixedSizeLabel || "One Size").trim() || "One Size",
              default_purchase_qty: Number(sourceRow.stock || 0),
              sku: String(sourceRow.sku || "").trim()
                ? makeUniqueSku(String(sourceRow.sku || "").trim().toUpperCase(), usedVariantSkus)
                : buildVariantSku({
                prefix: skuPrefix || smartSkuPrefix,
                color: groupColor,
                size: String(fixedSizeLabel || "One Size").trim() || "One Size",
                usedSkus: usedVariantSkus,
              }),
              barcode: String(sourceRow.barcode || "").trim() || "",
              purchase_price: Number(costPrice || 0),
              sale_price: Number(sourceRow.price || salePrice || 0),
              price: Number(sourceRow.price || salePrice || 0),
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
          .map((row, rowIndex) =>
            normalizeVariantPayload({
              color: groupColor,
              size: String(row.size || "").trim(),
              default_purchase_qty: Number(row.stock || 0),
              sku: String(row.sku || "").trim()
                ? makeUniqueSku(String(row.sku || "").trim().toUpperCase(), usedVariantSkus)
                : buildVariantSku({
                prefix: skuPrefix || smartSkuPrefix,
                color: groupColor,
                size: String(row.size || "").trim(),
                sequence: rowIndex > 0 ? "" : "",
                usedSkus: usedVariantSkus,
              }),
              barcode: String(row.barcode || "").trim() || "",
              purchase_price: Number(costPrice || 0),
              sale_price: Number(row.price || salePrice || 0),
              price: Number(row.price || salePrice || 0),
              image_url: String(row.image_url || groupImageUrl || "").trim() || "",
              variant_image_url: String(row.image_url || groupImageUrl || "").trim() || "",
              color_image_url: groupImageUrl,
              ...groupManufacturerPayload,
              edition_name: groupEditionName,
              edition_slug: groupEditionSlug,
            })
          );
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

      console.log("[create-product] generated variants", generatedVariants);
      console.log("[create-product] outgoing variants payload", generatedVariants);

      if (!isSimpleMode && filledGroups.length > 0 && generatedVariants.length === 0) {
        const message = "No variants provided";
        setVariantNotice(message);
        toast.error(message);
        return;
      }

      const galleryPayload = dedupeImages(gallery).map((item) => ({
        ...item,
        image_url: item.image_url || item.preview || "",
        preview: item.preview || item.image_url || "",
      }));

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
        ...resolveBrandPayload(brands, { brand }),
        ...resolveUnitPayload(units, { unit }),
        gender,
        product_type: productType,
        style,
        grade,
        variation_mode: variationMode,
        fixed_size_label: isColorOnlyMode ? fixedSizeLabel : "",
        sku: skuPrefix || smartSkuPrefix,
        barcode,
        cost_price: Number(costPrice || 0),
        purchase_price: Number(costPrice || 0),
        sale_price: Number(salePrice || 0),
        price: Number(salePrice || 0),
        wholesale_price: Number(wholesalePrice || 0),
        tax_rate: 0,
        default_purchase_qty: Number(stock || 0),
        low_stock_threshold: Number(lowStockThreshold || 10),
        active,
        status: active ? "active" : "inactive",
        track_stock: trackStock,
        image_url: coverImage,
        gallery: galleryPayload,
        variant_groups_count: filledGroups.length,
        variant_rows_count: generatedVariants.length,
        variants: generatedVariants,
        colorImages: colorImagesPayload,
        ...getManufacturerPayload(defaultManufacturerId),
      });
      console.log("[create-product] final payload", productPayload);
      console.log("[create-product] save category/brand payload", {
        category: productPayload.category,
        category_id: productPayload.category_id,
        brand: productPayload.brand,
        brand_id: productPayload.brand_id,
        unit: productPayload.unit,
        unit_id: productPayload.unit_id,
      });

      console.log(
        "[product-save] variant image payload",
        productPayload.variants.map((variant) => ({
          color: variant.color,
          size: variant.size,
          image_url: variant.image_url,
          variant_image_url: variant.variant_image_url,
          color_image_url: variant.color_image_url,
        }))
      );
      console.log("[product:create] payload variants", productPayload.variants);
      console.log("[products:add] POST /api/products payload:", productPayload);

      const product = await createProduct(productPayload);

      console.log("[products:add] POST /api/products response:", product);

      const productSku = product.sku || skuPrefix || smartSkuPrefix || generateSku(name, product.id).split("-")[0];
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
        gender,
        product_type: productType,
        style,
        grade,
        variation_mode: variationMode,
        fixed_size_label: isColorOnlyMode ? fixedSizeLabel : "",
        brand,
        unit,
        sku: productSku,
        barcode,
        cost_price: Number(costPrice || 0),
        sale_price: Number(salePrice || 0),
        wholesale_price: Number(wholesalePrice || 0),
        tax_rate: 0,
        stock: 0,
        default_purchase_qty: Number(stock || 0),
        low_stock_threshold: Number(lowStockThreshold || 10),
        active,
        status: active ? "active" : "inactive",
        track_stock: trackStock,
        image_url: coverImage,
        gallery: galleryPayload,
      };

      upsertProductMeta(meta);

      const createdCount = productPayload.variants.length;
      if (createdCount > 0) {
        setVariantNotice(`${createdCount} variant(s) created`);
      } else {
        setVariantNotice("Product saved without variants");
      }

      toast.success(createdCount > 0 ? `Product created with ${createdCount} variant(s)` : "Product created");
      navigate("/products");
    } catch (err) {
      console.log(err);
      console.error("[products:add] create error details:", {
        message: err?.message,
        stack: err?.stack,
      });
      toast.error(err?.message || "Failed to create product");
    } finally {
      setSaving(false);
    }
  };

  const productDescriptionPanel = (
    <div className="rounded-[18px] border border-white/8 bg-white/[0.035] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-black text-white">Customer-facing description</p>
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
            {descriptionGenerating.ar ? "Generating Arabic..." : "Regenerate Arabic"}
          </button>
          <button
            type="button"
            onClick={() => regenerateDescriptions("en")}
            disabled={descriptionGenerating.en}
            className="inline-flex h-9 items-center rounded-[12px] border border-white/10 bg-white/5 px-3 text-xs font-semibold text-zinc-100 transition hover:border-sky-300/30 hover:bg-sky-400/10 hover:text-sky-100"
          >
            {descriptionGenerating.en ? "Generating English..." : "Regenerate English"}
          </button>
          <button
            type="button"
            onClick={() => regenerateDescriptions("all")}
            disabled={descriptionGenerating.ar || descriptionGenerating.en}
            className="inline-flex h-9 items-center rounded-[12px] border border-amber-300/20 bg-amber-300/10 px-3 text-xs font-semibold text-amber-100 transition hover:border-amber-300/40 hover:bg-amber-300/15"
          >
            {descriptionGenerating.ar && descriptionGenerating.en ? "Generating..." : "Regenerate All"}
          </button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div>
          <label className="text-sm font-semibold text-zinc-200">Arabic description</label>
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
          <label className="text-sm font-semibold text-zinc-200">English description</label>
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
          <p className="text-sm font-black text-white">SEO metadata</p>
          <p className="mt-1 text-xs text-zinc-400">Search title, meta description, and keywords generated from product image and content.</p>
        </div>
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
        <div>
          <label className="text-sm font-semibold text-zinc-300">Meta title</label>
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
          <label className="text-sm font-semibold text-zinc-300">SEO keywords</label>
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
          <label className="text-sm font-semibold text-zinc-300">SEO meta description</label>
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
          Google search result preview
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
            <img src={coverImage} alt="Open Graph preview" className="h-full w-full bg-white object-contain" />
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
  );

  const aiVisionPanel = aiProductData ? (
    <div className="mt-5 rounded-[18px] border border-blue-300/20 bg-blue-400/[0.07] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-black text-white">AI Vision results</p>
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

  const inventoryDefaultsPanel = (
    <div className="rounded-[18px] border border-white/8 bg-white/[0.028] p-3">
      <div>
        <p className="text-[11px] font-black uppercase tracking-[0.18em] text-zinc-200">Inventory defaults</p>
        <p className="mt-0.5 text-xs text-zinc-500">Starting purchase quantities and alert thresholds.</p>
      </div>
      <div className="mt-2.5 grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,170px)_minmax(0,150px)_1fr]">
        <div className="max-w-[170px]">
          <label className="text-[13px] font-semibold text-zinc-100">Default purchase quantity</label>
          <input
            type="number"
            value={stock}
            onChange={(e) => setStock(e.target.value)}
            className="mt-1 h-10 w-full rounded-[13px] border border-white/8 bg-white/[0.045] px-3.5 font-semibold text-white shadow-inner shadow-black/20 outline-none"
          />
        </div>
        <div className="max-w-[150px]">
          <label className="text-[13px] font-semibold text-zinc-100">Low stock alert</label>
          <input
            type="number"
            value={lowStockThreshold}
            onChange={(e) => setLowStockThreshold(e.target.value)}
            className="mt-1 h-10 w-full rounded-[13px] border border-white/8 bg-white/[0.045] px-3.5 font-semibold text-white shadow-inner shadow-black/20 outline-none"
          />
        </div>
        <div className="flex items-end">
          <p className="rounded-[13px] border border-white/8 bg-zinc-950/35 px-3 py-2 text-xs leading-5 text-zinc-400">
            لا تؤثر على المخزون — المخزون يضاف من فاتورة المشتريات
          </p>
        </div>
      </div>
    </div>
  );

  return (
    <ProductsShell
      title="Create Product"
      description="Enterprise-grade product intake with catalog metadata, pricing, media, barcode generation, and variant generation."
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
      <form id="create-product-form" onSubmit={handleSubmit} className="w-full min-w-0 max-w-none space-y-8 overflow-x-hidden pb-28 lg:pb-24">
        <ProductActionBar
          mode="create"
          saving={saving}
          hasUnsavedChanges={hasUnsavedChanges}
          formId="create-product-form"
        />
        <div className="flex w-full min-w-0 max-w-none flex-col gap-5 px-4 sm:px-6 lg:px-8">
          <section className="rounded-[18px] border border-white/10 bg-[#10172a] p-4 shadow-[0_14px_42px_rgba(0,0,0,0.18)]">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h1 className="text-2xl font-semibold tracking-tight text-white">Create Product</h1>
                <p className="mt-1 max-w-3xl text-sm leading-6 text-zinc-400">
                  Professional single-page product workflow for catalog data, media intelligence, content, pricing, inventory, and variants.
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <Link
                  to="/products"
                  onClick={confirmLeaveIfDirty}
                  className="inline-flex h-9 items-center gap-2 rounded-[12px] border border-white/10 bg-white/5 px-4 text-sm font-semibold text-zinc-100 transition hover:border-white/20 hover:bg-white/10"
                >
                  Back to list
                </Link>
                <button
                  type="submit"
                  disabled={saving}
                  className={buttonClasses("primary", "h-9 rounded-[12px] px-4")}
                >
                  <Plus size={16} strokeWidth={2} />
                  {saving ? "Saving..." : "Save Product"}
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
                title="Basic Information"
                subtitle="Product naming, descriptions, catalog classification, and sales metadata."
                tone="emerald"
              />

              <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="md:col-span-2">
                  <label className="text-sm font-semibold text-zinc-300">Product name</label>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Example: Air Max Pro"
                    className="mt-2 w-full rounded-2xl border border-white/8 bg-white/5 px-4 py-3 text-white outline-none placeholder:text-zinc-500"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="text-sm font-semibold text-zinc-300">Slug</label>
                  <input
                    value={canonicalSlug}
                    onChange={(event) => {
                      setCanonicalSlug(event.target.value);
                      setSeoTouched((current) => ({ ...current, slug: true }));
                    }}
                    placeholder="air-max-pro"
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
                productType={productType}
                style={style}
                grade={grade}
                onMainCategoryChange={setMainCategory}
                onSubCategoryChange={setSubCategory}
                onChildCategoryChange={setChildCategory}
                onBrandChange={setBrand}
                onUnitChange={setUnit}
                onVariationModeChange={setVariationMode}
                onGenderChange={setGender}
                onProductTypeChange={setProductType}
                onStyleChange={setStyle}
                onGradeChange={setGrade}
              />

              {isColorOnlyMode ? (
                <div className="mt-5 rounded-[24px] border border-cyan-400/15 bg-cyan-400/10 p-4">
                  <label className="text-sm font-semibold text-cyan-100">Fixed size</label>
                  <input
                    value={fixedSizeLabel}
                    onChange={(event) => setFixedSizeLabel(event.target.value)}
                    placeholder="One Size"
                    className="mt-2 w-full rounded-2xl border border-cyan-400/15 bg-zinc-950 px-4 py-3 text-white outline-none placeholder:text-zinc-500"
                  />
                  <p className="mt-2 text-xs text-cyan-100/70">Used for every color variant. Shoes keep the current size matrix.</p>
                </div>
              ) : null}
            </SectionCard>

            <SectionCard id="media-ai">
              <SectionHeader
                icon={ImagePlus}
                title="Media + AI Vision"
                subtitle="Upload product imagery and run AI vision enrichment from the cover image."
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
                        <p className="mt-4 text-lg font-semibold text-white">Upload product image</p>
                        <p className="mt-2 text-sm text-zinc-400">{coverLabel || "PNG, JPG, WEBP"}</p>
                      </>
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

                <div className="rounded-[28px] border border-white/8 bg-white/5 p-5">
                  <p className="text-sm font-semibold text-zinc-300">Gallery upload</p>
                  <label className="mt-4 flex min-h-[220px] cursor-pointer items-center justify-center rounded-[24px] border-2 border-dashed border-white/10 bg-zinc-950/60 text-center">
                    <div>
                      <ImagePlus className="mx-auto text-zinc-400" size={38} />
                      <p className="mt-4 text-sm font-semibold text-white">Add multiple gallery images</p>
                      <p className="mt-2 text-xs text-zinc-500">{gallery.length} image(s) selected</p>
                    </div>
                    <input type="file" hidden accept="image/*" multiple onChange={handleGallery} />
                  </label>

                  {gallery.length > 0 ? (
                    <div className="mt-4 grid grid-cols-3 gap-3 overflow-visible sm:grid-cols-4">
                      {gallery.map((item) => (
                        <ImageThumbnailActions
                          key={item.id || item.name}
                          image={item}
                          alt={item.name || "Gallery image"}
                          className="h-20"
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
                title="Product Content & SEO"
                subtitle="Image upload, AI detection, product description, and SEO metadata stay in one connected workflow."
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
                {activeContentTab === "metadata" ? seoMetadataPanel : null}
                {activeContentTab === "preview" ? socialPreviewPanel : null}
              </div>
            </SectionCard>

            <SectionCard id="pricing">
              <SectionHeader
                icon={Barcode}
                title="Pricing"
                subtitle="SKU prefix, barcode, cost, shelf price, and wholesale references."
                tone="amber"
              />

              <div className="mt-5 space-y-4">
                <div className="hidden rounded-[18px] border border-white/8 bg-white/[0.028] p-3 transition duration-200 hover:-translate-y-0.5 hover:border-white/14 hover:bg-white/[0.045] hover:shadow-lg hover:shadow-black/10">
                  <div>
                    <p className="text-[11px] font-black uppercase tracking-[0.18em] text-zinc-200">Identifiers</p>
                    <p className="mt-0.5 text-xs text-zinc-500">Internal product codes and scannable labels.</p>
                  </div>
                  <div className="mt-2.5 grid grid-cols-1 gap-4 lg:grid-cols-2">
                    <div>
                      <label className="text-[13px] font-semibold text-zinc-100">SKU prefix</label>
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
                          Regenerate
                        </button>
                      </div>
                      <p className="mt-1 text-[11px] text-zinc-500">Auto: {smartSkuPrefix}</p>
                    </div>

                    <div>
                      <label className="text-[13px] font-semibold text-zinc-100">Barcode</label>
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
                          Generate
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="rounded-[18px] border border-white/8 bg-[#0f1725] p-4 transition duration-200 hover:-translate-y-0.5 hover:border-emerald-300/20 hover:shadow-lg hover:shadow-black/10">
                  <div>
                    <p className="text-[11px] font-black uppercase tracking-[0.18em] text-zinc-200">Pricing</p>
                    <p className="mt-0.5 text-xs text-zinc-500">Cost, shelf price, and wholesale references.</p>
                  </div>
                  <div className="mt-2.5 grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.15fr)_minmax(0,0.9fr)]">
                    <div>
                      <label className="text-[13px] font-semibold text-zinc-100">Cost price</label>
                      <input
                        type="number"
                        value={costPrice}
                        onChange={(e) => setCostPrice(e.target.value)}
                        className="mt-1 h-10 w-full rounded-[13px] border border-white/8 bg-white/[0.045] px-3.5 font-semibold text-white shadow-inner shadow-black/20 outline-none ring-1 ring-inset ring-white/[0.045] transition placeholder:text-zinc-600 hover:border-white/14 focus:border-amber-300/35 focus:bg-white/[0.06]"
                      />
                    </div>

                    <div className="rounded-[16px] border border-amber-300/28 bg-[radial-gradient(circle_at_top,rgba(251,191,36,0.12),rgba(251,191,36,0.035)_42%,rgba(255,255,255,0.025)_100%)] p-3 shadow-[0_0_28px_rgba(251,191,36,0.09)] transition duration-200 hover:-translate-y-0.5 hover:border-amber-300/45 hover:shadow-[0_0_34px_rgba(251,191,36,0.13)]">
                      <label className="text-[13px] font-black text-amber-100">Sale price</label>
                      <input
                        type="number"
                        value={salePrice}
                        onChange={(e) => setSalePrice(e.target.value)}
                        className="mt-1 h-11 w-full rounded-[13px] border border-amber-200/20 bg-white/[0.06] px-4 text-lg font-black text-white shadow-inner shadow-black/25 outline-none ring-1 ring-inset ring-amber-100/[0.06] transition placeholder:text-amber-100/30 hover:border-amber-200/30 focus:border-amber-200/50 focus:bg-white/[0.075]"
                      />
                    </div>

                    <div>
                      <label className="text-[13px] font-semibold text-zinc-100">Wholesale price</label>
                      <input
                        type="number"
                        value={wholesalePrice}
                        onChange={(e) => setWholesalePrice(e.target.value)}
                        className="mt-1 h-10 w-full rounded-[13px] border border-white/8 bg-white/[0.045] px-3.5 font-semibold text-white shadow-inner shadow-black/20 outline-none ring-1 ring-inset ring-white/[0.045] transition placeholder:text-zinc-600 hover:border-white/14 focus:border-amber-300/35 focus:bg-white/[0.06]"
                      />
                    </div>
                  </div>
                </div>

                <div className="rounded-[18px] border border-white/8 bg-white/[0.028] p-3 transition duration-200 hover:-translate-y-0.5 hover:border-white/14 hover:bg-white/[0.045] hover:shadow-lg hover:shadow-black/10">
                  <div>
                    <p className="text-[11px] font-black uppercase tracking-[0.18em] text-zinc-200">Inventory defaults</p>
                    <p className="mt-0.5 text-xs text-zinc-500">Starting quantities and alert thresholds.</p>
                  </div>
                  <div className="mt-2.5 grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,170px)_minmax(0,150px)_1fr]">
                    <div className="max-w-[170px]">
                      <label className="text-[13px] font-semibold text-zinc-100">Default purchase quantity</label>
                      <input
                        type="number"
                        value={stock}
                        onChange={(e) => setStock(e.target.value)}
                        className="mt-1 h-10 w-full rounded-[13px] border border-white/8 bg-white/[0.045] px-3.5 font-semibold text-white shadow-inner shadow-black/20 outline-none ring-1 ring-inset ring-white/[0.045] transition placeholder:text-zinc-600 hover:border-white/14 focus:border-amber-300/35 focus:bg-white/[0.06]"
                      />
                    </div>

                    <div className="max-w-[150px]">
                      <label className="text-[13px] font-semibold text-zinc-100">Low stock alert</label>
                      <input
                        type="number"
                        value={lowStockThreshold}
                        onChange={(e) => setLowStockThreshold(e.target.value)}
                        className="mt-1 h-10 w-full rounded-[13px] border border-white/8 bg-white/[0.045] px-3.5 font-semibold text-white shadow-inner shadow-black/20 outline-none ring-1 ring-inset ring-white/[0.045] transition placeholder:text-zinc-600 hover:border-white/14 focus:border-amber-300/35 focus:bg-white/[0.06]"
                      />
                    </div>

                    <div className="flex items-end">
                      <p className="rounded-[13px] border border-white/8 bg-zinc-950/35 px-3 py-2 text-xs leading-5 text-zinc-400">
                        لا تؤثر على المخزون — المخزون يضاف من فاتورة المشتريات
                      </p>
                    </div>
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
                                    src={coverImage}
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
                              value={metaTitle}
                              onChange={(event) => {
                                setMetaTitle(event.target.value);
                                setSeoTouched((current) => ({ ...current, title: true }));
                              }}
                              className="mt-1.5 h-10 w-full rounded-[14px] border border-white/10 bg-zinc-900/80 px-3 text-sm font-semibold text-white shadow-inner shadow-black/20 outline-none"
                            />
                          </div>
                          <div>
                            <label className="text-sm font-semibold text-zinc-300">Canonical/slug</label>
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
                            <label className="text-sm font-semibold text-zinc-300">SEO Meta Description (Google/Facebook preview)</label>
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
                            <label className="text-sm font-semibold text-zinc-300">SEO keywords</label>
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
            </SectionCard>
            <SectionCard id="inventory">
              <SectionHeader
                icon={Layers3}
                title="Catalog Controls"
                subtitle="Product status, stock behavior, barcode preview, and generated matrix summary."
                tone="violet"
              />

              <div className="mt-5 space-y-4">
                {inventoryDefaultsPanel}

                <label className="flex items-center justify-between rounded-2xl border border-white/8 bg-white/5 px-4 py-3">
                  <span className="text-sm font-semibold text-white">Active product</span>
                  <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
                </label>

                <label className="flex items-center justify-between rounded-2xl border border-white/8 bg-white/5 px-4 py-3">
                  <span className="text-sm font-semibold text-white">Track stock</span>
                  <input type="checkbox" checked={trackStock} onChange={(e) => setTrackStock(e.target.checked)} />
                </label>

                <div className={`${isSimpleMode ? "hidden" : ""} rounded-2xl border border-white/8 bg-white/5 p-4`}>
                  <button
                    type="button"
                    onClick={() => setAdvancedOpen((current) => !current)}
                    className="flex w-full items-center justify-between gap-3 rounded-2xl border border-white/8 bg-zinc-950/70 px-4 py-3 text-right transition hover:border-white/15"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-black text-white">إعدادات متقدمة</p>
                      <p className="mt-1 text-xs text-zinc-400">Barcode preview, matrix summary, and internal helpers.</p>
                    </div>
                    <ChevronDown className={`h-4 w-4 shrink-0 text-zinc-400 transition ${advancedOpen ? "rotate-180" : ""}`} />
                  </button>

                  {advancedOpen ? (
                    <div className="mt-4 space-y-4">
                      <div className="rounded-2xl border border-white/8 bg-zinc-950/80 p-4">
                        <p className="text-sm font-semibold text-zinc-300">Barcode preview</p>
                        <div className="mt-3 rounded-2xl border border-white/8 bg-zinc-950 px-4 py-4">
                          <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">SKU</p>
                          <p className="mt-2 text-xl font-black text-white">{skuPrefix || smartSkuPrefix || generateSku(name).split("-")[0]}</p>
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
                          <p className="text-sm font-semibold text-zinc-300">Variant matrix</p>
                          <p className="mt-2 text-sm text-zinc-400">
                            {isColorOnlyMode
                              ? "Generate one fixed-size variant per color."
                              : "Generate color and size combinations for the first product variants."}
                          </p>
                          <div className="mt-4 rounded-2xl border border-white/8 bg-zinc-950/70 p-4">
                            <p className="text-xs uppercase tracking-[0.28em] text-zinc-500">Combinations</p>
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
                title="Bulk Variant Tools"
                subtitle="Enter size ranges and price or quantity shortcuts. Missing sizes are added without touching existing rows."
                tone="emerald"
              />

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
            </SectionCard>

            <SectionCard hidden={isSimpleMode}>
              <div className="sticky top-3 z-20 -mx-1 mb-5 rounded-[18px] border border-white/10 bg-[#10172a]/95 p-3 shadow-[0_18px_50px_rgba(0,0,0,0.24)] backdrop-blur">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <SectionHeader
                    icon={Layers3}
                    title="Variant Color Groups"
                    subtitle="Each color gets one image. Every size row under that color becomes one variant."
                    tone="cyan"
                  />

                  <button
                    type="button"
                    onClick={addColorGroup}
                    className={buttonClasses("primary", "h-9 rounded-full px-4")}
                  >
                    <Plus size={16} strokeWidth={2} />
                    Add color
                  </button>
                </div>
              </div>

              <div className="mt-4 rounded-[20px] border border-white/8 bg-white/5 p-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Default manufacturer</p>
                  <p className="mt-1 text-sm text-zinc-400">
                    Applied to all color groups until a color is changed manually.
                  </p>
                </div>
                <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
                  <label className="block">
                    <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">Manufacturer</div>
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
                    <div className="mt-1 text-sm text-zinc-200">
                      Non-custom color cards inherit this default automatically.
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
                                    <span className="mt-2 block text-[11px] font-semibold text-zinc-500">Color images</span>
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
                                {(normalizeColorImages(group.images).length > 0 ? normalizeColorImages(group.images) : []).map((image, imageIndex) => (
                                  <div key={image.id || `${group.id}-${imageIndex}`} className="group relative z-0 aspect-square overflow-visible hover:z-20 focus-within:z-20">
                                    <ImageThumbnailActions
                                      image={image}
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

                                <div className="mt-2 max-w-full space-y-2 overflow-x-auto">
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
                                          placeholder={isColorOnlyMode ? fixedSizeLabel || "One Size" : "40"}
                                          className="mt-1.5 h-10 w-full rounded-[12px] border border-white/8 bg-zinc-950 px-3 text-sm text-white outline-none placeholder:text-zinc-500"
                                        />
                                      </div>
                                      <div>
                                        <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">Purchase Qty</label>
                                        <input
                                          type="number"
                                          value={row.stock}
                                          onChange={(e) => updateSizeRow(group.id, row.id, "stock", e.target.value)}
                                          placeholder="0"
                                          className="mt-1.5 h-10 w-full rounded-[12px] border border-white/8 bg-zinc-950 px-3 text-sm text-white outline-none placeholder:text-zinc-500"
                                        />
                                        <p className="mt-1 text-[10px] leading-4 text-zinc-500">لا تؤثر على المخزون — المخزون يضاف من فاتورة المشتريات</p>
                                      </div>
                                      <div>
                                        <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">SKU</label>
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
                                        <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">Price</label>
                                        <input
                                          type="number"
                                          value={row.price}
                                          onChange={(e) => updateSizeRow(group.id, row.id, "price", e.target.value)}
                                          placeholder={salePrice || "0"}
                                          className="mt-1.5 h-10 w-full rounded-[12px] border border-white/8 bg-zinc-950 px-3 text-sm text-white outline-none placeholder:text-zinc-500"
                                        />
                                      </div>
                                      <div className="flex items-end">
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
                title="Variant Preview"
                subtitle={isColorOnlyMode ? "Each color becomes a single fixed-size variant." : "The matrix below will be created after the product is saved."}
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
                      ? "Add a color name to preview fixed-size color variants."
                      : "Add a color name and at least one size row to generate combinations."}
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
                        <div className="text-right">
                          <span className="block text-sm text-emerald-300">{variant.stock} default purchase qty</span>
                          <span className="block text-xs text-zinc-500">{variant.image_url ? "Color image linked" : "No image linked"}</span>
                        </div>
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
            {saving ? "Saving..." : "Create Product"}
          </button>
          <button
            type="button"
            onClick={() => navigate("/products")}
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-6 py-3 font-semibold text-white"
          >
            Cancel
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
    <section id={id} className={`scroll-mt-24 rounded-[18px] border border-white/8 bg-[#10172a] p-4 shadow-[0_14px_42px_rgba(0,0,0,0.16)] transition duration-200 hover:border-white/12 sm:p-5 ${className}`}>
      {children}
    </section>
  );
}

function ProductActionBar({ mode = "create", saving = false, hasUnsavedChanges = false, formId }) {
  const label = mode === "create" ? "Save Product" : "Update Product";

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-[#0b1020]/95 px-4 py-3 shadow-[0_-18px_60px_rgba(0,0,0,0.38)] backdrop-blur md:left-auto md:right-6 md:bottom-6 md:w-auto md:min-w-[360px] md:rounded-[24px] md:border">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-zinc-500">Product Editor</p>
          <p className={`mt-1 text-sm font-semibold ${hasUnsavedChanges ? "text-amber-200" : "text-emerald-200"}`}>
            {hasUnsavedChanges ? "Unsaved changes" : "No changes yet"}
          </p>
        </div>
        <button
          type="submit"
          form={formId}
          disabled={saving}
          className={buttonClasses("primary", "h-11 w-full rounded-[14px] px-5 sm:w-auto")}
        >
          {saving ? <Loader2 size={16} strokeWidth={2} className="animate-spin" /> : <Save size={16} strokeWidth={2} />}
          {saving ? "Saving..." : label}
        </button>
      </div>
    </div>
  );
}
