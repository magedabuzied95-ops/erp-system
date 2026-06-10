import { useEffect, useMemo, useState } from "react";

import { Link, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";

import {
  ArrowLeft,
  Barcode,
  Clock3,
  Copy,
  Image as ImageIcon,
  Loader2,
  Package2,
  Pencil,
  QrCode,
  RotateCcw,
} from "lucide-react";
import toast from "react-hot-toast";

import { api } from "../../../shared/api/api";
import { hasPermission } from "../../../shared/auth/authStorage";
import ProductsShell from "../components/ProductsShell";
import { createProduct, getProductsWithVariants, normalizeVariantPayload } from "../services/productsApi";
import { formatCurrency } from "../../../shared/lib/currency";
import { cleanupProductCache } from "../lib/catalog";

const isQuotaExceeded = (error) =>
  error?.name === "QuotaExceededError" ||
  error?.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
  error?.code === 22 ||
  error?.code === 1014 ||
  /quota/i.test(String(error?.message || ""));

const duplicateVariantPayload = (variant = {}, group = {}) =>
  normalizeVariantPayload({
    color: variant.color || group.color || "",
    size: variant.size || "",
    sku: "",
    article_code: "",
    barcode: "",
    stock: variant.stock,
    sale_price: variant.sale_price ?? variant.price,
    price: variant.price ?? variant.sale_price,
    cost_price: variant.cost_price,
    manufacturer_id: variant.manufacturer_id || group.manufacturer_id || null,
    image_url: variantPrimaryImage(variant) || group.image_url || "",
    variant_image_url: variantPrimaryImage(variant) || group.image_url || "",
    color_image_url: group.image_url || variantPrimaryImage(variant) || "",
    images: Array.isArray(variant.images) ? variant.images : [],
  });

const placeholderImage = (label = "Product image") =>
  `data:image/svg+xml;utf8,${encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 360" role="img" aria-label="${label}">
      <rect width="480" height="360" rx="28" fill="#0f172a"/>
      <rect x="20" y="20" width="440" height="320" rx="22" fill="#111827" stroke="#334155"/>
      <g fill="none" stroke="#64748b" stroke-width="10" stroke-linecap="round" stroke-linejoin="round">
        <path d="M128 242c22-8 42-18 64-38 29-27 57-61 95-81 12-6 27-7 39-2 17 6 35 20 55 44 19 23 39 41 60 50 21 10 40 20 50 37 6 10 4 22-4 30-8 7-19 11-31 11H180c-20 0-42-7-55-17-11-8-14-24 3-34z"/>
        <path d="M150 240c22 12 41 18 60 18h196"/>
        <path d="M192 202h108"/>
        <path d="M218 172h104"/>
        <path d="M244 142h88"/>
      </g>
      <text x="240" y="308" text-anchor="middle" fill="#94a3b8" font-family="Arial, sans-serif" font-size="24" font-weight="700">${label}</text>
    </svg>
  `)}`;

const resolveImageUrl = (value) => {
  const imageUrl = String(value || "").trim();
  if (!imageUrl) return "";
  if (imageUrl.startsWith("data:") || imageUrl.startsWith("blob:")) return imageUrl;
  if (/^https?:\/\//i.test(imageUrl)) {
    try {
      const parsed = new URL(imageUrl);
      if (/^(localhost|127\.0\.0\.1)$/i.test(parsed.hostname)) {
        return `${parsed.pathname}${parsed.search}${parsed.hash}`;
      }
    } catch {
      return imageUrl;
    }
    return imageUrl;
  }
  if (imageUrl.startsWith("/uploads/")) return imageUrl;
  if (imageUrl.startsWith("uploads/")) return `/${imageUrl}`;
  if (imageUrl.startsWith("/")) return imageUrl;
  return `/uploads/products/${imageUrl}`;
};

const normalizeGallery = (value) => {
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") return item.trim();
        if (item && typeof item === "object") {
          return String(item.url || item.image_url || item.image || item.path || "").trim();
        }
        return String(item || "").trim();
      })
      .filter(Boolean);
  }
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? normalizeGallery(parsed) : [value.trim()];
    } catch {
      return [value.trim()];
    }
  }
  return [];
};

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

const toFiniteNumber = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const firstFiniteNumber = (...values) => {
  for (const value of values) {
    const parsed = toFiniteNumber(value);
    if (parsed !== null) return parsed;
  }
  return null;
};

const firstPositiveNumber = (...values) => {
  for (const value of values) {
    const parsed = toFiniteNumber(value);
    if (parsed !== null && parsed > 0) return parsed;
  }
  return null;
};

const truthyFlag = (value) => value === true || value === 1 || String(value || "").toLowerCase() === "true";

const displayMoneyOrEmpty = (value) => {
  const parsed = toFiniteNumber(value);
  return parsed === null ? "n/a" : formatCurrency(parsed);
};

const audienceLabel = (value) => ({
  men: "Men",
  women: "Women",
  kids: "Kids",
}[value] || value);

const sanitizeAudienceDescription = (description = "", audiences = []) => {
  const text = String(description || "");
  if (audiences.length <= 1) return text;
  return text
    .replace(/\s*,?\s*(and\s+)?for\s+men\b\.?/gi, ".")
    .replace(/\s*,?\s*(and\s+)?for\s+women\b\.?/gi, ".")
    .replace(/\s*,?\s*(and\s+)?for\s+kids\b\.?/gi, ".")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+\./g, ".")
    .trim();
};

const normalizeRowVariant = (row = {}) => {
  const source = row.variant || row;
  const regularPrice = firstPositiveNumber(
    source.selling_price,
    source.sellingPrice,
    source.regular_price,
    source.regularPrice,
    source.price,
    source.variant_price,
    source.variant_sale_price,
    source.sale_price,
    source.salePrice
  ) ?? 0;
  return {
    id: source.id ?? source.variant_id ?? source.variantId ?? null,
    variant_id: source.variant_id ?? source.variantId ?? source.id ?? null,
    color: String(source.color || source.color_name || source.colorName || "").trim(),
    size: String(source.size || source.size_name || source.sizeName || "").trim(),
    sku: String(source.sku || source.variant_sku || "").trim(),
    article_code: String(source.article_code || source.variant_article_code || "").trim(),
    barcode: String(source.barcode || source.variant_barcode || "").trim(),
    stock: Number(source.stock ?? source.variant_stock ?? source.quantity ?? source.qty ?? 0),
    regular_price: regularPrice,
    selling_price: regularPrice,
    price: regularPrice,
    sale_price: firstFiniteNumber(source.sale_price, source.salePrice),
    sale_price_enabled: truthyFlag(source.sale_price_enabled || source.salePriceEnabled),
    compare_at_price: firstFiniteNumber(source.compare_at_price, source.compareAtPrice),
    original_price: firstFiniteNumber(source.original_price, source.originalPrice),
    list_price: firstFiniteNumber(source.list_price, source.listPrice),
    compare_base_price: firstFiniteNumber(source.compare_base_price, source.compareBasePrice),
    sale_reason: source.sale_reason || "",
    cost_price: firstFiniteNumber(source.cost_price, source.purchase_price, source.variant_cost_price, source.last_purchase_price, source.last_purchase_cost),
    wholesale_price: firstFiniteNumber(source.wholesale_price, source.wholesalePrice, source.variant_wholesale_price),
    last_purchase_price: firstFiniteNumber(source.last_purchase_price, source.lastPurchasePrice, source.last_purchase_cost, source.lastPurchaseCost, source.purchase_price),
    manufacturer_id: source.manufacturer_id ?? source.manufacturerId ?? source.variant_manufacturer_id ?? null,
    manufacturer_name: source.manufacturer_name || source.manufacturerName || source.manufacturer || "",
    images: Array.isArray(source.images) ? source.images : Array.isArray(source.color_images) ? source.color_images : [],
    image_url: resolveImageUrl(
      source.variant_image_url ||
        source.color_image_url ||
        source.image_url ||
        source.image ||
        source.photo_url ||
        source.thumbnail_url ||
        row.variant_image_url ||
        row.color_image_url ||
        row.image_url ||
        row.product_image_url
    ),
    product_image_url: resolveImageUrl(source.product_image_url || row.product_image_url || row.image_url),
  };
};

const normalizeProductRow = (row = {}) => {
  const productSource = row.product || row;
  const audiences = normalizeProductAudiences(productSource.audiences, productSource.product_audiences, productSource.gender, row.audiences, row.product_audiences, row.gender);
  const regularPrice = firstPositiveNumber(
    productSource.selling_price,
    productSource.sellingPrice,
    productSource.price,
    productSource.regular_price,
    productSource.regularPrice,
    row.selling_price,
    row.price,
    row.regular_price,
    row.product_regular_price,
    row.sale_price,
    row.product_sale_price
  ) ?? 0;
  return {
    ...productSource,
    id: productSource.id ?? row.product_id ?? row.id ?? null,
    product_id: row.product_id ?? productSource.id ?? row.id ?? null,
    name: productSource.name || row.product_name || "Unnamed product",
    description: sanitizeAudienceDescription(productSource.description || "", audiences),
    status: productSource.status || row.status || "active",
    category_name: productSource.category_name || productSource.category?.name || row.category_name || row.category?.name || "",
    brand_name: productSource.brand_name || productSource.brand?.name || row.brand_name || row.brand?.name || "",
    unit_name: productSource.unit_name || productSource.unit?.name || row.unit_name || row.unit?.name || "",
    unit_abbreviation: productSource.unit_abbreviation || productSource.unit?.abbreviation || row.unit_abbreviation || row.unit?.abbreviation || "",
    category: productSource.category_name || productSource.category?.name || productSource.category || row.category_name || row.category?.name || row.category || "Uncategorized",
    brand: productSource.brand_name || productSource.brand?.name || productSource.brand || row.brand_name || row.brand?.name || row.brand || "Unbranded",
    gender: productSource.gender || row.gender || audiences[0] || "",
    audiences,
    product_audiences: audiences,
    product_type: productSource.product_type || row.product_type || "",
    grade: productSource.grade || row.grade || "",
    variation_mode: productSource.variation_mode || row.variation_mode || "full_variations",
    fixed_size_label: productSource.fixed_size_label || row.fixed_size_label || "",
    category_id: productSource.category_id ?? row.category_id ?? "",
    brand_id: productSource.brand_id ?? row.brand_id ?? "",
    unit_id: productSource.unit_id ?? row.unit_id ?? "",
    selling_price: regularPrice,
    regular_price: regularPrice,
    price: regularPrice,
    sale_price: firstFiniteNumber(productSource.sale_price, row.sale_price, row.product_sale_price),
    sale_price_enabled: truthyFlag(productSource.sale_price_enabled || row.sale_price_enabled),
    use_custom_compare_price: truthyFlag(productSource.use_custom_compare_price || row.use_custom_compare_price),
    custom_compare_price: firstFiniteNumber(productSource.custom_compare_price, row.custom_compare_price),
    compare_at_price: firstFiniteNumber(productSource.compare_at_price, row.compare_at_price),
    original_price: firstFiniteNumber(productSource.original_price, row.original_price),
    list_price: firstFiniteNumber(productSource.list_price, row.list_price),
    compare_base_price: firstFiniteNumber(productSource.compare_base_price, row.compare_base_price),
    cost_price: firstFiniteNumber(productSource.cost_price, row.cost_price, row.product_cost_price, row.last_purchase_price, row.last_purchase_cost, row.purchase_price),
    wholesale_price: firstFiniteNumber(productSource.wholesale_price, row.wholesale_price, row.product_wholesale_price),
    last_purchase_price: firstFiniteNumber(productSource.last_purchase_price, row.last_purchase_price, row.last_purchase_cost, row.purchase_price),
    stock: Number(productSource.stock ?? row.stock ?? row.product_stock ?? 0),
    image_url: resolveImageUrl(
      productSource.image_url ||
        productSource.product_image_url ||
        row.product_image_url ||
        row.image_url ||
        row.image ||
        row.photo_url ||
        row.thumbnail_url
    ),
    gallery_images: normalizeGallery(productSource.gallery_images ?? row.gallery_images),
    qr_token: productSource.qr_token || row.qr_token || "",
  };
};

const getVariantKey = (variant, index) =>
  [
    variant.variant_id || variant.id || "variant",
    variant.color || "color",
    variant.size || "size",
    variant.sku || "sku",
    index,
  ].join("-");

const groupVariantsByColor = (variants = []) => {
  const groups = variants.reduce((acc, variant, index) => {
    const color = String(variant.color || "Default").trim() || "Default";
    const key = color.toLowerCase();
    if (!acc[key]) {
      const primaryImage = Array.isArray(variant.images) && variant.images.length
        ? variant.images.find((image) => image.is_primary) || variant.images[0]
        : null;
      acc[key] = {
        color,
        image_url: primaryImage?.image_url || variant.image_url || variant.product_image_url || "",
        images: Array.isArray(variant.images) ? variant.images : [],
        manufacturer_id: variant.manufacturer_id || "",
        manufacturer_name: variant.manufacturer_name || "",
        rows: [],
      };
    }

    if (Array.isArray(variant.images) && variant.images.length > 0) {
      const merged = [...acc[key].images, ...variant.images];
      acc[key].images = merged.filter((item, itemIndex, array) => array.findIndex((candidate) => String(candidate.image_url || candidate.preview || "") === String(item.image_url || item.preview || "")) === itemIndex);
      const primary = acc[key].images.find((image) => image.is_primary) || acc[key].images[0];
      if (primary?.image_url) {
        acc[key].image_url = primary.image_url;
      }
    }

    if (!acc[key].image_url && (variant.image_url || variant.product_image_url)) {
      acc[key].image_url = variant.image_url || variant.product_image_url || "";
    }
    if (!acc[key].manufacturer_name && variant.manufacturer_name) {
      acc[key].manufacturer_name = variant.manufacturer_name;
    }
    if (!acc[key].manufacturer_id && variant.manufacturer_id !== null && variant.manufacturer_id !== undefined && variant.manufacturer_id !== "") {
      acc[key].manufacturer_id = variant.manufacturer_id;
    }

    acc[key].rows.push({
      ...variant,
      _key: getVariantKey(variant, index),
    });
    return acc;
  }, {});

  return Object.values(groups);
};

const pickDefaultVariant = (variants = []) =>
  variants.find((variant) => Number(variant.stock || 0) > 0) || variants[0] || {};

const resolveProductDetailsPricing = (product = {}, variants = []) => {
  const defaultVariant = pickDefaultVariant(variants);
  const resolvedRegularPrice = firstPositiveNumber(
    product.selling_price,
    product.price,
    product.regular_price,
    defaultVariant.selling_price,
    defaultVariant.price,
    defaultVariant.regular_price,
    product.sale_price,
    defaultVariant.sale_price
  ) ?? 0;
  const storedSalePrice = firstPositiveNumber(product.sale_price, defaultVariant.sale_price);
  const resolvedComparePrice = firstPositiveNumber(
    truthyFlag(product.use_custom_compare_price) ? product.custom_compare_price : null,
    product.compare_at_price,
    product.original_price,
    product.list_price,
    product.compare_base_price,
    defaultVariant.compare_at_price,
    defaultVariant.original_price,
    defaultVariant.list_price,
    defaultVariant.compare_base_price
  );
  const saleEnabled = Boolean(
    truthyFlag(product.sale_price_enabled) ||
      truthyFlag(defaultVariant.sale_price_enabled) ||
      (storedSalePrice !== null && storedSalePrice > 0 && resolvedRegularPrice > 0 && storedSalePrice < resolvedRegularPrice) ||
      (resolvedComparePrice !== null && resolvedComparePrice > resolvedRegularPrice && resolvedRegularPrice > 0)
  );
  const resolvedSalePrice = saleEnabled ? (storedSalePrice || resolvedRegularPrice) : null;
  const resolvedCostPrice = firstFiniteNumber(
    product.cost_price,
    defaultVariant.cost_price,
    product.last_purchase_price,
    defaultVariant.last_purchase_price,
    product.purchase_price,
    defaultVariant.purchase_price
  );
  const resolvedWholesalePrice = firstFiniteNumber(
    product.wholesale_price,
    defaultVariant.wholesale_price
  );

  console.log("[product-details-price-debug]", {
    product_id: product.id ?? product.product_id ?? null,
    product_fields: {
      selling_price: product.selling_price,
      price: product.price,
      regular_price: product.regular_price,
      sale_price: product.sale_price,
      sale_price_enabled: product.sale_price_enabled,
      use_custom_compare_price: product.use_custom_compare_price,
      custom_compare_price: product.custom_compare_price,
      compare_at_price: product.compare_at_price,
      original_price: product.original_price,
      list_price: product.list_price,
      compare_base_price: product.compare_base_price,
      cost_price: product.cost_price,
      wholesale_price: product.wholesale_price,
      last_purchase_price: product.last_purchase_price,
    },
    default_variant_fields: {
      id: defaultVariant.id ?? defaultVariant.variant_id ?? null,
      selling_price: defaultVariant.selling_price,
      price: defaultVariant.price,
      regular_price: defaultVariant.regular_price,
      sale_price: defaultVariant.sale_price,
      sale_price_enabled: defaultVariant.sale_price_enabled,
      cost_price: defaultVariant.cost_price,
      wholesale_price: defaultVariant.wholesale_price,
      last_purchase_price: defaultVariant.last_purchase_price,
    },
    resolved_regular_price: resolvedRegularPrice,
    resolved_sale_price: resolvedSalePrice,
    resolved_compare_price: resolvedComparePrice,
    audiences: product.audiences || [],
  });

  return {
    resolved_regular_price: resolvedRegularPrice,
    resolved_sale_price: resolvedSalePrice,
    resolved_compare_price: resolvedComparePrice,
    resolved_cost_price: resolvedCostPrice,
    resolved_wholesale_price: resolvedWholesalePrice,
    sale_display_enabled: saleEnabled,
  };
};

const variantPrimaryImage = (variant = {}) => {
  const images = Array.isArray(variant.images) ? variant.images : [];
  const primary = images.find((image) => image.is_primary) || images[0] || null;
  return primary?.image_url || variant.image_url || variant.variant_image_url || variant.color_image_url || "";
};

const UNDOABLE_STOCK_MOVEMENT_TYPES = new Set(["product_stock_edit", "manual_adjustment"]);

const movementTypeLabel = (value) => {
  const type = String(value || "").trim();
  if (type === "purchase" || type === "purchase_receive" || type === "purchase_receiving") return "Purchase receiving";
  if (type === "transfer_in") return "Transfer in";
  if (type === "transfer_out") return "Transfer out";
  if (type === "transfer") return "Transfer";
  if (type === "sale" || type === "website_order") return "Sale";
  if (type === "return" || type === "return_in") return "Return";
  if (type === "manual_adjustment" || type === "product_stock_edit" || type === "inventory_count" || type === "inventory_adjustment") return "Adjustment";
  if (type === "undo_adjustment") return "Undo adjustment";
  if (type === "order_cancel") return "Order cancel";
  if (type === "order_edit") return "Order edit";
  return type || "Movement";
};

const formatDateTime = (value) => {
  if (!value) return "n/a";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
};

function ProductDetails() {
  const { t } = useTranslation();
  const { id } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [product, setProduct] = useState(null);
  const [stockMovements, setStockMovements] = useState([]);
  const [stockReconciliation, setStockReconciliation] = useState(null);
  const [stockMovementsLoading, setStockMovementsLoading] = useState(false);
  const [undoingMovementId, setUndoingMovementId] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        setLoading(true);
        setError("");

        const routeProductId = Number(id);
        console.log("[product-details] route productId", routeProductId);

        const rows = await getProductsWithVariants({ params: { productId: routeProductId, refresh: Date.now() } });
        const safeRows = Array.isArray(rows) ? rows : [];

        const matchedRow =
          safeRows.find((row) => Number(row.product_id ?? row.id ?? row.product?.id) === routeProductId) ||
          safeRows.find((row) => Number(row.id ?? row.product?.id) === routeProductId);

        console.log("[product-details] matched product", matchedRow || null);

        if (!active) return;

        if (!matchedRow) {
          setProduct(null);
          setError(t("products.details.notFound", "Product not found"));
          return;
        }

        const productBase = normalizeProductRow(matchedRow);
        const nestedVariants = Array.isArray(matchedRow.product?.variants)
          ? matchedRow.product.variants
          : Array.isArray(matchedRow.variants)
            ? matchedRow.variants
            : [];

        const flatVariants = safeRows.filter((row) => Number(row.product_id ?? row.id ?? row.product?.id) === routeProductId && (row.variant_id || Number(row.id) !== routeProductId));
        const rawVariants = nestedVariants.length > 0 ? nestedVariants : flatVariants;
        const normalizedVariants = rawVariants
          .map((variant) => normalizeRowVariant({ ...matchedRow, ...variant }))
          .filter((variant) => variant.variant_id || variant.color || variant.size || variant.sku || variant.barcode);
        console.log("[product-details] refetched product variants", {
          product_id: routeProductId,
          raw_variants_count: rawVariants.length,
          visible_variants_count: normalizedVariants.length,
          visible_color_names: Array.from(new Set(normalizedVariants.map((variant) => variant.color).filter(Boolean))),
          visible_variant_ids: normalizedVariants.map((variant) => variant.variant_id || variant.id).filter(Boolean),
        });

        if (productBase.variation_mode === "simple") {
          const pricing = resolveProductDetailsPricing(productBase, []);
          setProduct({
            ...productBase,
            ...pricing,
            variants: [],
            groupedVariants: [],
          });
          return;
        }

        console.log("[product-details] matched variants count", normalizedVariants.length);

        const groupedVariants = groupVariantsByColor(normalizedVariants);
        console.log("[product-details] grouped variants", groupedVariants);
        const fallbackImage =
          groupedVariants.find((group) => group.image_url)?.image_url ||
          normalizedVariants.find((variant) => variantPrimaryImage(variant))?.image_url ||
          productBase.image_url ||
          productBase.public_image_url ||
          "";

        setProduct({
          ...productBase,
          ...resolveProductDetailsPricing(productBase, normalizedVariants),
          image_url: fallbackImage || productBase.image_url || "",
          public_image_url: fallbackImage || productBase.public_image_url || "",
          variants: normalizedVariants,
          groupedVariants,
        });
      } catch (err) {
        console.log(err);
        if (!active) return;
        setError(err?.message || t("products.details.loadFailed", "Failed to load product details"));
        toast.error(err?.message || t("products.details.loadFailed", "Failed to load product details"));
      } finally {
        if (active) setLoading(false);
      }
    };

    load();

    return () => {
      active = false;
    };
  }, [id, refreshKey]);

  useEffect(() => {
    let active = true;

    const loadStockMovements = async () => {
      try {
        setStockMovementsLoading(true);
        const params = new URLSearchParams({
          product_id: String(id || ""),
          limit: "25",
          page: "1",
        });
        const response = await api.get(`/inventory/movements?${params.toString()}`);
        if (!active) return;
        setStockMovements(Array.isArray(response?.movements) ? response.movements : []);
        setStockReconciliation(response?.reconciliation || null);
      } catch (err) {
        console.log(err);
        if (!active) return;
        setStockMovements([]);
        setStockReconciliation(null);
      } finally {
        if (active) setStockMovementsLoading(false);
      }
    };

    if (id) {
      loadStockMovements();
    }

    return () => {
      active = false;
    };
  }, [id, refreshKey]);

  const totalStock = useMemo(
    () => Number(product?.variants?.reduce((sum, variant) => sum + Number(variant.stock || 0), 0) || product?.stock || 0),
    [product]
  );

  const productGallery = useMemo(() => product?.gallery_images || [], [product]);
  const reconciliationByVariant = useMemo(() => {
    const map = new Map();
    for (const row of stockReconciliation?.rows || []) {
      map.set(String(row.variant_id), row);
    }
    return map;
  }, [stockReconciliation]);
  const reconciledProduct = useMemo(() => {
    if (!product || !reconciliationByVariant.size) return product;
    const variants = (product.variants || []).map((variant) => {
      const reconciliation = reconciliationByVariant.get(String(variant.variant_id || variant.id));
      if (!reconciliation) return variant;
      return {
        ...variant,
        stored_stock: reconciliation.stored_stock,
        movement_stock: reconciliation.movement_stock,
        stock: reconciliation.movement_stock,
        stock_mismatched: reconciliation.mismatched,
        stock_mismatch_delta: reconciliation.mismatch_delta,
      };
    });
    return {
      ...product,
      variants,
      groupedVariants: groupVariantsByColor(variants),
    };
  }, [product, reconciliationByVariant]);
  const displayProduct = reconciledProduct || product;
  const displayTotalStock = useMemo(
    () => Number(displayProduct?.variants?.reduce((sum, variant) => sum + Number(variant.stock || 0), 0) || displayProduct?.stock || 0),
    [displayProduct]
  );
  const stockSummary = stockReconciliation?.summary || null;
  const latestMovementIdByVariant = useMemo(() => {
    const latest = new Map();
    for (const movement of stockMovements) {
      const variantId = movement.variant_id;
      if (variantId === null || variantId === undefined || latest.has(String(variantId))) continue;
      latest.set(String(variantId), movement.id);
    }
    return latest;
  }, [stockMovements]);

  const handleDuplicate = async () => {
    if (!product) return;

    try {
      const payload = {
        name: `${product.name} Copy`,
        description: product.description || "",
        category: product.category || t("products.records.uncategorized", "Uncategorized"),
        category_id: product.category_id || null,
        brand: product.brand || t("products.records.unbranded", "Unbranded"),
        brand_id: product.brand_id || null,
        gender: product.audiences?.[0] || product.gender || "",
        audiences: product.audiences || [],
        product_audiences: product.audiences || [],
        product_type: product.product_type || "",
        grade: product.grade || "",
        variation_mode: product.variation_mode || "full_variations",
        fixed_size_label: product.fixed_size_label || "",
        purchase_alerts_enabled: Boolean(product.purchase_alerts_enabled),
        purchase_alert_by_color: Boolean(product.purchase_alert_by_color),
        unit_id: product.unit_id || null,
        sale_price: Number(product.sale_price || 0),
        cost_price: Number(product.cost_price || 0),
        wholesale_price: Number(product.wholesale_price || 0),
        price: Number(product.sale_price || 0),
        stock: Number(product.stock || 0),
        image_url: "",
        gallery: [],
        colorImages:
          product.variation_mode === "simple"
            ? []
            : (product.groupedVariants || []).map((group) => ({
                color_name: group.color,
                color_value: group.color,
                images: Array.isArray(group.images) ? group.images : [],
                image_url: group.image_url || "",
              })),
        variants:
          product.variation_mode === "simple"
            ? []
            : (product.groupedVariants || []).flatMap((group) =>
                (group.rows || []).map((variant) =>
                  duplicateVariantPayload(variant, group)
                )
              ),
      };

      const created = await createProduct(payload);
      toast.success(t("products.toasts.productDuplicated"));
      navigate(`/products/${created?.id || created?.product?.id || ""}/edit`);
    } catch (err) {
      console.log(err);
      if (isQuotaExceeded(err)) {
        cleanupProductCache();
        toast.error(t("products.toasts.duplicateQuotaFailed"));
      } else {
        toast.error(err?.message || t("products.toasts.duplicateFailed", "Failed to duplicate product"));
      }
    }
  };

  const handleUndoMovement = async (movement) => {
    if (!movement?.id || undoingMovementId) return;

    const confirmed = window.confirm(t("products.stock.confirmUndoAdjustment", "Undo this stock adjustment? This will reverse the stock change and record an undo movement."));
    if (!confirmed) return;

    try {
      setUndoingMovementId(movement.id);
      await api.post(`/inventory/movements/${movement.id}/undo`, {});
      toast.success(t("products.stock.adjustmentUndone", "Stock adjustment undone"));
      setRefreshKey((value) => value + 1);
      window.dispatchEvent(new CustomEvent("inventory:stock-updated", { detail: { productId: product?.id, movementId: movement.id } }));
    } catch (err) {
      console.log(err);
      toast.error(err?.message || t("products.stock.undoFailed", "Failed to undo stock adjustment"));
    } finally {
      setUndoingMovementId(null);
    }
  };

  return (
    <ProductsShell
      title={t("products.details.title", "Product Details")}
      description={t("products.details.description", "Complete product view with grouped variants, stock, pricing, gallery media, and quick actions.")}
      actions={
        <Link
          to="/products"
          className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-5 py-3 font-semibold text-white transition hover:bg-white/10"
        >
          <ArrowLeft size={18} />
          {t("products.details.backToProducts", "Back to products")}
        </Link>
      }
    >
      {loading ? (
        <div className="rounded-[34px] border border-white/8 bg-zinc-950/80 p-10 text-center text-zinc-400">
          <Loader2 className="mx-auto h-10 w-10 animate-spin text-emerald-400" />
          <p className="mt-4 text-sm font-semibold text-white">{t("products.details.loading", "Loading product details...")}</p>
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
            {t("common.back", "Back")}
          </button>
        </div>
      ) : product ? (
        <div className="space-y-6">
          <section className="rounded-[34px] border border-white/8 bg-zinc-950/80 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.22)]">
            <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
              <div className="space-y-3">
                <div className="overflow-hidden rounded-[28px] border border-white/10 bg-white/5">
                  <img
                    src={product.image_url || product.public_image_url || placeholderImage(product.name)}
                    alt={product.name}
                    className="h-[320px] w-full object-contain p-4"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <ActionButton icon={Pencil} label={t("products.actionsMenu.edit", "Edit product")} onClick={() => navigate(`/products/${product.id}/edit`)} />
                  <ActionButton icon={Barcode} label={t("products.actionsMenu.printBarcode", "Print barcode")} onClick={() => navigate(`/products/barcode-labels?productId=${encodeURIComponent(product.id)}&availableOnly=true`)} />
                  <ActionButton icon={QrCode} label={t("products.actionsMenu.barcodeShop", "Barcode shop QR")} onClick={() => navigate(`/products/labels?mode=barcode-shop&productId=${encodeURIComponent(product.id)}`)} />
                  <ActionButton icon={Copy} label={t("products.actionsMenu.duplicate", "Duplicate")} onClick={handleDuplicate} />
                </div>
              </div>

              <div className="space-y-5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300">
                    {String(product.status || "active")}
                  </span>
                  <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-300">
                    {product.category || t("products.records.uncategorized", "Uncategorized")}
                  </span>
                  <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-300">
                    {product.brand || t("products.records.unbranded", "Unbranded")}
                  </span>
                  {(product.audiences || []).map((audience) => (
                    <span key={audience} className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200">
                      {audienceLabel(audience)}
                    </span>
                  ))}
                </div>

                <div>
                  <h1 className="text-4xl font-black tracking-tight text-white">{product.name}</h1>
                  <p className="mt-3 max-w-4xl text-sm leading-7 text-zinc-400">
                    {product.description || t("products.empty.firstDescription", "No description available.")}
                  </p>
                </div>

                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                  <InfoCard label={t("products.fields.regularPrice", "Regular price")} value={displayMoneyOrEmpty(product.resolved_regular_price)} />
                  <InfoCard label={t("products.fields.comparePrice", "Compare price")} value={displayMoneyOrEmpty(product.resolved_compare_price)} />
                  <InfoCard label={t("products.fields.salePrice", "Sale price")} value={product.sale_display_enabled && product.resolved_sale_price !== null ? formatCurrency(product.resolved_sale_price) : t("products.status.disabled", "Disabled")} />
                  <InfoCard label={t("products.fields.costPrice", "Cost price")} value={displayMoneyOrEmpty(product.resolved_cost_price)} />
                  <InfoCard label={t("products.fields.wholesalePrice", "Wholesale price")} value={displayMoneyOrEmpty(product.resolved_wholesale_price)} />
                  <InfoCard label={t("products.fields.lastPurchasePriceUpdate", "Last purchase price update")} value={product.last_purchase_pricing_at ? String(product.last_purchase_pricing_at).slice(0, 16).replace("T", " ") : t("products.records.notYet", "Not yet")} />
                  <InfoCard label={t("products.fields.totalStock", "Total stock")} value={Number(displayTotalStock || totalStock || 0).toLocaleString()} />
                </div>

                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <DetailCard label={t("products.fields.category", "Category")} value={product.category_name || product.category || t("products.records.notAvailable", "n/a")} />
                  <DetailCard label={t("products.fields.brand", "Brand")} value={product.brand_name || product.brand || t("products.records.notAvailable", "n/a")} />
                  <DetailCard label={t("products.fields.unit", "Unit")} value={product.unit_name || product.unit_abbreviation || t("products.records.notAvailable", "n/a")} />
                  <DetailCard label={t("products.fields.audience", "Audience")} value={(product.audiences || []).map(audienceLabel).join(", ") || t("products.records.notAvailable", "n/a")} />
                  <DetailCard label={t("products.details.qrToken", "QR token")} value={product.qr_token || t("products.records.notAvailable", "n/a")} />
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-[34px] border border-white/8 bg-zinc-950/80 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.22)]">
            <div className="flex items-center gap-3">
              <Package2 className="text-emerald-400" />
              <div>
                <h2 className="text-2xl font-black text-white">{t("products.details.variantGroups", "Variant groups")}</h2>
                <p className="mt-1 text-sm text-zinc-400">{t("products.details.variantGroupsDescription", "Grouped by color with size-level stock, SKU, article code, barcode, and price details.")}</p>
              </div>
            </div>

            {(displayProduct?.groupedVariants || []).length > 0 ? (
              <div className="mt-5 space-y-4">
                {displayProduct.groupedVariants.map((group) => (
                  <div key={group.color.toLowerCase()} className="rounded-[28px] border border-white/10 bg-white/5 p-4">
                    <div className="grid gap-4 xl:grid-cols-[180px_minmax(0,1fr)]">
                      <div className="overflow-hidden rounded-[24px] border border-white/10 bg-zinc-950/70">
                        <img
                          src={group.image_url || group.images?.find((image) => image.is_primary)?.image_url || product.image_url || placeholderImage(group.color)}
                          alt={`${product.name} ${group.color}`}
                          className="h-[180px] w-full object-contain p-3"
                        />
                      </div>

                      <div className="space-y-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <h3 className="text-xl font-black text-white">{group.color}</h3>
                            <p className="mt-1 text-sm text-zinc-400">
                              {t("products.fields.manufacturer", "Manufacturer")}: {group.manufacturer_name || (group.manufacturer_id ? `#${group.manufacturer_id}` : t("products.records.notAvailable", "n/a"))}
                            </p>
                          </div>
                          <div className="text-sm text-zinc-400">
                            {t("products.details.sizeCount", "{{count}} size", { count: group.rows.length })}
                          </div>
                        </div>

                        {Array.isArray(group.images) && group.images.length > 1 ? (
                          <div className="flex flex-wrap gap-2">
                            {group.images.slice(0, 6).map((image, imageIndex) => (
                              <div
                                key={image.id || `${group.color}-${imageIndex}`}
                                className={`h-14 w-14 overflow-hidden rounded-2xl border ${
                                  image.is_primary ? "border-emerald-400/60" : "border-white/10"
                                } bg-zinc-950/70`}
                              >
                                <img src={image.image_url || image.preview} alt={image.name || group.color} className="h-full w-full object-cover" />
                              </div>
                            ))}
                          </div>
                        ) : null}

                        <div className="overflow-x-auto rounded-3xl border border-white/10">
                          <table className="min-w-full border-separate border-spacing-0 text-sm">
                            <thead className="bg-white/5 text-zinc-400">
                              <tr>
                                <th className="px-4 py-3 text-left">{t("products.fields.size", "Size")}</th>
                                <th className="px-4 py-3 text-left">{t("products.table.stock", "Stock")}</th>
                                <th className="px-4 py-3 text-left">SKU</th>
                                <th className="px-4 py-3 text-left">{t("products.fields.articleCode", "Article Code")}</th>
                                <th className="px-4 py-3 text-left">{t("products.selected.barcode", "Barcode")}</th>
                                <th className="px-4 py-3 text-left">{t("products.fields.price", "Price")}</th>
                                <th className="px-4 py-3 text-left">{t("products.fields.history", "History")}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {group.rows.map((variant) => (
                                <tr key={variant._key} className="border-t border-white/10">
                                  <td className="px-4 py-3 font-semibold text-white">{variant.size || t("products.products.oneSize", "One size")}</td>
                                  <td className="px-4 py-3 text-zinc-300 tabular-nums">
                                    <div className="font-semibold text-white">{Number(variant.stock || 0)}</div>
                                    {variant.stock_mismatched ? (
                                      <div className="mt-1 text-[11px] font-semibold text-amber-300">
                                        {t("products.stock.storedValue", "Stored {{value}}", { value: Number(variant.stored_stock || 0) })}
                                      </div>
                                    ) : null}
                                  </td>
                                  <td className="px-4 py-3 text-zinc-300">{variant.sku || t("products.records.notAvailable", "n/a")}</td>
                                  <td className="px-4 py-3 text-zinc-300">{variant.article_code || t("products.records.notAvailable", "n/a")}</td>
                                  <td className="px-4 py-3 text-zinc-300">{variant.barcode || t("products.records.notAvailable", "n/a")}</td>
                                  <td className="px-4 py-3 font-semibold text-emerald-300">{formatCurrency(variant.price || variant.sale_price)}</td>
                                  <td className="px-4 py-3">
                                    <Link
                                      to={`/inventory/variant/${variant.variant_id || variant.id}/history?productId=${product.id}`}
                                      className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
                                    >
                                      <Clock3 className="h-4 w-4" />
                                      {t("products.fields.history", "History")}
                                    </Link>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-5 rounded-[28px] border border-dashed border-white/10 bg-white/5 p-8 text-center">
                <p className="text-lg font-black text-white">{t("products.details.noVariants", "No variants found. Add variants from Edit Product.")}</p>
                <button
                  type="button"
                  onClick={() => navigate(`/products/${product.id}/edit`)}
                  className="mt-4 inline-flex items-center gap-2 rounded-2xl bg-emerald-500 px-4 py-2 text-sm font-black text-black transition hover:bg-emerald-400"
                >
                  <Pencil className="h-4 w-4" />
                  {t("products.actionsMenu.edit", "Edit product")}
                </button>
              </div>
            )}
          </section>

          <section className="rounded-[34px] border border-white/8 bg-zinc-950/80 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.22)]">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <Clock3 className="text-cyan-400" />
                <div>
                  <h2 className="text-2xl font-black text-white">{t("products.stock.historyTitle", "Stock History")}</h2>
                  <p className="mt-1 text-sm text-zinc-400">{t("products.stock.historyDescription", "Recent inventory movements recorded for this product.")}</p>
                </div>
              </div>
              <Link
                to={`/inventory/history?productId=${encodeURIComponent(product.id)}`}
                className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
              >
                {t("products.stock.fullHistory", "Full history")}
              </Link>
            </div>

            {stockSummary ? (
              <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <InfoCard label={t("products.stock.movementStock", "Movement stock")} value={Number(stockSummary.movement_stock_total || 0).toLocaleString()} />
                <InfoCard label={t("products.stock.storedStock", "Stored stock")} value={Number(stockSummary.stored_stock_total || 0).toLocaleString()} />
                <InfoCard label={t("products.stock.purchaseReceiving", "Purchase receiving")} value={`+${Number(stockSummary.purchase_receiving_total || 0).toLocaleString()}`} />
                <InfoCard label={t("products.stock.sales", "Sales")} value={Number(stockSummary.sale_total || 0).toLocaleString()} />
              </div>
            ) : null}

            {stockSummary?.mismatch_count || stockSummary?.duplicate_purchase_movement_count ? (
              <div className="mt-4 rounded-2xl border border-amber-400/25 bg-amber-500/10 px-4 py-3 text-sm font-semibold text-amber-100">
                {stockSummary.mismatch_count
                  ? `${t("products.stock.mismatchDetected", "{{count}} variant stock mismatch detected.", { count: stockSummary.mismatch_count })} `
                  : ""}
                {stockSummary.duplicate_purchase_movement_count
                  ? `${t("products.stock.duplicatePurchaseRows", "{{count}} duplicate purchase movement row detected.", { count: stockSummary.duplicate_purchase_movement_count })} `
                  : ""}
                {t("products.stock.usingMovementStock", "The variant grid is using movement-derived stock on this page.")}
              </div>
            ) : null}

            <div className="mt-5 overflow-x-auto rounded-3xl border border-white/10">
              <table className="min-w-full border-separate border-spacing-0 text-sm">
                <thead className="bg-white/5 text-zinc-400">
                  <tr>
                    <th className="px-4 py-3 text-left">{t("products.stock.date", "Date")}</th>
                    <th className="px-4 py-3 text-left">{t("products.stock.group", "Group")}</th>
                    <th className="px-4 py-3 text-left">{t("products.table.product", "Product")}</th>
                    <th className="px-4 py-3 text-left">{t("products.products.color", "Color")}</th>
                    <th className="px-4 py-3 text-left">{t("products.fields.size", "Size")}</th>
                    <th className="px-4 py-3 text-left">{t("products.stock.before", "Before")}</th>
                    <th className="px-4 py-3 text-left">{t("products.stock.change", "Change")}</th>
                    <th className="px-4 py-3 text-left">{t("products.stock.after", "After")}</th>
                    <th className="px-4 py-3 text-left">{t("products.stock.reason", "Reason")}</th>
                    <th className="px-4 py-3 text-left">{t("products.stock.user", "User")}</th>
                    <th className="px-4 py-3 text-left">{t("products.table.actions", "Actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {stockMovementsLoading ? (
                    <tr>
                      <td colSpan={11} className="px-4 py-8 text-center text-zinc-400">
                        <Loader2 className="mr-2 inline h-4 w-4 animate-spin text-emerald-400" />
                        {t("products.stock.loadingHistory", "Loading stock history...")}
                      </td>
                    </tr>
                  ) : stockMovements.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="px-4 py-8 text-center text-zinc-400">
                        {t("products.stock.noMovements", "No stock movements recorded yet.")}
                      </td>
                    </tr>
                  ) : (
                    stockMovements.map((movement) => {
                      const change = Number(movement.quantity_change || movement.quantity || 0);
                      const undoAllowed =
                        hasPermission("inventory.movements:undo") &&
                        UNDOABLE_STOCK_MOVEMENT_TYPES.has(String(movement.movement_type || "")) &&
                        !movement.undone_at &&
                        latestMovementIdByVariant.get(String(movement.variant_id)) === movement.id;
                      return (
                        <tr key={movement.id} className="border-t border-white/10">
                          <td className="px-4 py-3 text-zinc-300">{formatDateTime(movement.created_at)}</td>
                          <td className="px-4 py-3 text-zinc-300">{movementTypeLabel(movement.movement_type)}</td>
                          <td className="px-4 py-3 font-semibold text-white">{movement.product_name || product.name}</td>
                          <td className="px-4 py-3 text-zinc-300">{movement.variant_color || t("products.records.default", "Default")}</td>
                          <td className="px-4 py-3 text-zinc-300">{movement.variant_size || t("products.records.notAvailable", "n/a")}</td>
                          <td className="px-4 py-3 text-zinc-300">{Number(movement.quantity_before || 0)}</td>
                          <td className={`px-4 py-3 font-semibold ${change >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                            {change >= 0 ? "+" : ""}
                            {change}
                          </td>
                          <td className="px-4 py-3 text-zinc-300">{Number(movement.quantity_after || 0)}</td>
                          <td className="px-4 py-3 text-zinc-300">{movement.reason || movement.notes || t("products.records.notAvailable", "n/a")}</td>
                          <td className="px-4 py-3 text-zinc-300">{movement.created_by_name || t("products.records.notAvailable", "n/a")}</td>
                          <td className="px-4 py-3">
                            {movement.undone_at ? (
                              <span className="inline-flex items-center rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-zinc-400">
                                {t("products.stock.undone", "Undone")}
                              </span>
                            ) : undoAllowed ? (
                              <button
                                type="button"
                                onClick={() => handleUndoMovement(movement)}
                                disabled={undoingMovementId === movement.id}
                                className="inline-flex items-center gap-2 rounded-2xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-sm font-semibold text-amber-200 transition hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {undoingMovementId === movement.id ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <RotateCcw className="h-4 w-4" />
                                )}
                                {t("products.stock.undo", "Undo")}
                              </button>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-[34px] border border-white/8 bg-zinc-950/80 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.22)]">
            <div className="flex items-center gap-3">
              <ImageIcon className="text-cyan-400" />
              <div>
                <h2 className="text-2xl font-black text-white">{t("products.images.gallery", "Gallery")}</h2>
                <p className="mt-1 text-sm text-zinc-400">{t("products.images.galleryDescription", "Product gallery images available on the product record.")}</p>
              </div>
            </div>

            {(productGallery || []).length > 0 ? (
              <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {productGallery.map((image, index) => (
                  <div key={`${image}-${index}`} className="overflow-hidden rounded-[24px] border border-white/10 bg-white/5">
                    <img src={resolveImageUrl(image)} alt={`${product.name} gallery ${index + 1}`} className="h-48 w-full object-contain p-3" />
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-5 rounded-[28px] border border-dashed border-white/10 bg-white/5 p-8 text-sm text-zinc-400">
                {t("products.images.noGallery", "No gallery images available.")}
              </div>
            )}
          </section>
        </div>
      ) : null}
    </ProductsShell>
  );
}

function ActionButton({ icon: Icon, label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}

function InfoCard({ label, value }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-white/5 p-4">
      <p className="text-xs uppercase tracking-[0.28em] text-zinc-500">{label}</p>
      <p className="mt-2 text-lg font-semibold text-white">{value}</p>
    </div>
  );
}

function DetailCard({ label, value }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-white/5 p-4">
      <p className="text-[10px] uppercase tracking-[0.24em] text-zinc-500">{label}</p>
      <p className="mt-2 break-all text-sm font-semibold text-white">{value}</p>
    </div>
  );
}

export default ProductDetails;
