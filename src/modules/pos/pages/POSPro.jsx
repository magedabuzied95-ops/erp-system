import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

import toast from "react-hot-toast";
import {
  AlertTriangle,
  X,
  LogOut,
  ChevronRight,
  Loader2,
  MessageCircle,
  ScanBarcode,
  RotateCcw,
  Banknote,
  CheckCircle2,
  Clock3,
  History,
  ShieldCheck,
  UserCheck,
  Warehouse,
} from "lucide-react";

import { api } from "../../../shared/api/api";
import { getCurrentTenant, getCurrentUser } from "../../../shared/auth/authStorage";
import { useProductClassifications } from "../../products/hooks/useProductClassifications";
import {
  classificationGroupsToFieldOptions,
  normalizeClassificationValue,
} from "../../products/lib/productClassifications";
import {
  checkInEmployee,
  checkOutEmployee,
  getAttendanceEmployees,
  getAttendanceKioskSnapshot,
  getOpeningCandidates,
} from "../../attendance/attendanceApi";
import {
  getLoyaltyCustomerById,
  validateLoyaltyRedemption,
} from "../../loyalty/loyaltyApi";
import { getProductByQrToken, getProductsWithVariants } from "../../products/services/productsApi";
import {
  calcTotals,
  clearPosPersistedState,
  derivePaymentSummary,
  formatCurrency,
  generateInvoiceNumber,
  pickFirstVariant,
  readPosCart,
  readPosPersistedState,
  downloadInvoicePdf,
  writePosCart,
  writePosPersistedState,
} from "../lib/posUtils";
import { normalizePhone } from "../lib/phoneSearch";
import { normalizePosSellableProducts, resolvePosImageUrl } from "../services/posProductsApi";
import { buildLoyaltyReceiptWhatsappUrl, normalizeReceiptPhone } from "../lib/whatsappReceiptMessage.js";
import PosHeader from "../components/PosHeader";
import ProductGrid from "../components/ProductGrid";
import CartSidebar from "../components/CartSidebar";
import ProductAvailabilityModal from "../components/ProductAvailabilityModal";
import RecentOperationsDrawer from "../components/RecentOperationsDrawer";

const defaultState = {
  search: "",
  selectedMainCategoryId: "all",
  selectedSubCategoryId: "all",
  selectedChildCategoryId: "all",
  selectedBrandId: "all",
  selectedManufacturerId: "all",
  selectedGender: "all",
  selectedProductType: "all",
  selectedStyle: "all",
  selectedGrade: "all",
  customerSearch: "",
  paymentMode: "cash",
  cashAmount: 0,
  cardAmount: 0,
  walletAmount: 0,
  invoiceDiscount: 0,
  serviceFee: 0,
  previewMode: "thermal",
  quickCustomer: { name: "", phone: "" },
};

const WALK_IN_CUSTOMER = {
  id: null,
  name: "Walk-in Customer",
  type: "walk_in",
};

const getErrorMessage = (error, fallback) =>
  error?.response?.data?.detail ||
  error?.response?.data?.message ||
  error?.response?.data?.error ||
  error?.responseBody?.detail ||
  error?.responseBody?.message ||
  error?.responseBody?.error ||
  error?.message ||
  fallback;

const isForbiddenError = (error) => Number(error?.status || error?.response?.status || 0) === 403;

const normalizeCheckoutOrderResponse = (response = {}) => {
  const root = response?.data ?? response ?? {};
  const data = root?.data ?? root;
  const order = data?.order ?? root?.order ?? data?.invoice ?? root?.invoice ?? data;
  const orderObject = order && typeof order === "object" ? order : {};
  const invoiceNumber =
    orderObject.invoice_number ||
    orderObject.invoiceNumber ||
    data?.invoice_number ||
    data?.invoiceNumber ||
    root?.invoice_number ||
    root?.invoiceNumber ||
    (orderObject.id ? `INV-${String(orderObject.id).padStart(6, "0")}` : "");
  const orderId =
    orderObject.order_id ||
    orderObject.orderId ||
    orderObject.id ||
    data?.order_id ||
    data?.orderId ||
    data?.id ||
    root?.order_id ||
    root?.orderId ||
    root?.id ||
    null;
  const publicToken =
    orderObject.public_token ||
    orderObject.publicToken ||
    data?.public_token ||
    data?.publicToken ||
    root?.public_token ||
    root?.publicToken ||
    "";

  return {
    raw: root,
    data,
    order: orderObject,
    invoiceNumber,
    orderId,
    publicToken,
    loyalty: data?.loyalty ?? root?.loyalty ?? orderObject?.loyalty ?? {},
    wallet: data?.wallet ?? root?.wallet ?? orderObject?.wallet ?? {},
    publicInvoiceUrl:
      orderObject.public_invoice_url ||
      orderObject.publicInvoiceUrl ||
      orderObject.invoice_public_url ||
      data?.public_invoice_url ||
      data?.publicInvoiceUrl ||
      data?.invoice_public_url ||
      root?.public_invoice_url ||
      root?.publicInvoiceUrl ||
      root?.invoice_public_url ||
      "",
    publicInvoiceShortUrl:
      orderObject.public_invoice_short_url ||
      orderObject.shortInvoiceUrl ||
      orderObject.short_invoice_url ||
      data?.public_invoice_short_url ||
      data?.shortInvoiceUrl ||
      data?.short_invoice_url ||
      root?.public_invoice_short_url ||
      root?.shortInvoiceUrl ||
      root?.short_invoice_url ||
      "",
  };
};

const isFullVariationMode = (value) => String(value || "").trim().toLowerCase() === "full_variations";

const isRealVariantId = (value) =>
  value !== undefined && value !== null && value !== "" && !String(value).startsWith("product:");

const resolveCheckoutVariantId = (item = {}) => {
  const variantId = item.variant_id ?? item.variantId ?? null;
  if (!isRealVariantId(variantId)) return null;
  if (!isFullVariationMode(item.variation_mode) && String(variantId) === String(item.product_id || "")) return null;
  return variantId;
};

const resolvePublicInvoiceUrl = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  if (typeof window !== "undefined") {
    return new URL(raw, window.location.origin).toString();
  }
  return raw;
};

const resolveShortPublicInvoiceUrl = ({ shortInvoiceUrl, publicToken, publicInvoiceUrl, invoiceUrl } = {}) => {
  const resolvedCandidates = [invoiceUrl, publicInvoiceUrl, shortInvoiceUrl]
    .map((value) => resolvePublicInvoiceUrl(value))
    .filter(Boolean);

  const publicCandidate = resolvedCandidates.find((value) => /\/invoice\/[^/]+$/i.test(String(value)));
  if (publicCandidate) return publicCandidate;

  const token = String(publicToken || "").trim();
  if (token) {
    if (typeof window !== "undefined" && window.location?.origin) {
      return `${window.location.origin.replace(/\/$/, "")}/invoice/${encodeURIComponent(token)}`;
    }

    return `/invoice/${encodeURIComponent(token)}`;
  }

  return resolvedCandidates[0] || "";
};

const resolveReceiptInvoiceUrl = (context = {}) =>
  resolveShortPublicInvoiceUrl({
    invoiceUrl: context.invoiceUrl || context.public_invoice_url || context.publicInvoiceUrl,
    shortInvoiceUrl:
      context.shortInvoiceUrl ||
      context.public_invoice_short_url ||
      context.short_invoice_url ||
      context.publicInvoiceUrl,
    publicToken: context.publicToken || context.public_token,
    publicInvoiceUrl: context.publicInvoiceUrl || context.public_invoice_url,
  });

const MARKETING_ATTRIBUTION_KEY = "erp.marketing.attribution";

const MARKETING_ATTRIBUTION_OPTIONS = [
  { value: "facebook_post", label: "Facebook" },
  { value: "instagram_post", label: "Instagram" },
  { value: "instagram_story", label: "Story" },
  { value: "tiktok", label: "TikTok" },
  { value: "whatsapp_campaign", label: "WhatsApp" },
  { value: "other", label: "Other" },
];

const normalizeMarketingSourceKey = (value = "") => {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  if (["facebook", "fb", "facebook_post"].includes(raw)) return "facebook_post";
  if (["instagram", "ig", "instagram_post"].includes(raw)) return "instagram_post";
  if (["story", "instagram_story"].includes(raw)) return "instagram_story";
  if (["tiktok", "tk"].includes(raw)) return "tiktok";
  if (["whatsapp", "wa", "whatsapp_campaign"].includes(raw)) return "whatsapp_campaign";
  if (raw === "other") return "other";
  if (raw === "post") return "";
  return raw;
};

const readMarketingAttributionState = () => {
  if (typeof window === "undefined") {
    return {
      source_key: "",
      marketing_source: "",
      marketing_platform: "",
      marketing_campaign: "",
      marketing_post_id: "",
      marketing_tracking_code: "",
      marketing_session_id: "",
      attribution_type: "",
    };
  }

  try {
    const raw = window.localStorage.getItem(MARKETING_ATTRIBUTION_KEY);
    if (!raw) {
      return {
        source_key: "",
        marketing_source: "",
        marketing_platform: "",
        marketing_campaign: "",
        marketing_post_id: "",
        marketing_tracking_code: "",
        marketing_session_id: "",
        attribution_type: "",
      };
    }
    const parsed = JSON.parse(raw);
    return {
      source_key: normalizeMarketingSourceKey(parsed.source_key || parsed.attribution_type || parsed.marketing_source || parsed.marketing_platform || ""),
      marketing_source: String(parsed.marketing_source || ""),
      marketing_platform: String(parsed.marketing_platform || parsed.marketing_source || ""),
      marketing_campaign: String(parsed.marketing_campaign || ""),
      marketing_post_id: String(parsed.marketing_post_id || ""),
      marketing_tracking_code: String(parsed.marketing_tracking_code || ""),
      marketing_session_id: String(parsed.marketing_session_id || ""),
      attribution_type: String(parsed.attribution_type || parsed.source_key || ""),
    };
  } catch {
    return {
      source_key: "",
      marketing_source: "",
      marketing_platform: "",
      marketing_campaign: "",
      marketing_post_id: "",
      marketing_tracking_code: "",
      marketing_session_id: "",
      attribution_type: "",
    };
  }
};

const writeMarketingAttributionState = (value) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MARKETING_ATTRIBUTION_KEY, JSON.stringify(value || {}));
  } catch {
    // Attribution memory is a convenience only.
  }
};

const resolveMarketingAttributionFromSelection = (sourceKey = "", current = {}) => {
  const normalized = normalizeMarketingSourceKey(sourceKey);
  if (!normalized) {
    return {
      source_key: "",
      marketing_source: "",
      marketing_platform: "",
      marketing_campaign: String(current.marketing_campaign || ""),
      marketing_post_id: String(current.marketing_post_id || ""),
      marketing_tracking_code: String(current.marketing_tracking_code || ""),
      marketing_session_id: String(current.marketing_session_id || ""),
      attribution_type: "",
    };
  }
  const base = {
    source_key: normalized,
    marketing_source: "other",
    marketing_platform: "other",
    marketing_campaign: String(current.marketing_campaign || ""),
    marketing_post_id: String(current.marketing_post_id || ""),
    marketing_tracking_code: String(current.marketing_tracking_code || ""),
    marketing_session_id: String(current.marketing_session_id || ""),
    attribution_type: normalized,
  };

  if (normalized === "facebook_post") {
    return { ...base, marketing_source: "facebook", marketing_platform: "facebook", attribution_type: "facebook_post" };
  }
  if (normalized === "instagram_post") {
    return { ...base, marketing_source: "instagram", marketing_platform: "instagram", attribution_type: "instagram_post" };
  }
  if (normalized === "instagram_story") {
    return { ...base, marketing_source: "story", marketing_platform: "instagram", attribution_type: "story" };
  }
  if (normalized === "tiktok") {
    return { ...base, marketing_source: "tiktok", marketing_platform: "tiktok", attribution_type: "tiktok" };
  }
  if (normalized === "whatsapp_campaign") {
    return { ...base, marketing_source: "whatsapp", marketing_platform: "whatsapp", attribution_type: "whatsapp_campaign" };
  }

  return base;
};

const resolveMarketingAttributionPayload = (attribution = {}) => {
  const selection = resolveMarketingAttributionFromSelection(attribution.source_key || attribution.attribution_type || "other", attribution);
  return {
    marketing_source: selection.marketing_source || null,
    marketing_platform: selection.marketing_platform || null,
    marketing_post_id: selection.marketing_post_id || null,
    marketing_campaign: selection.marketing_campaign || null,
    attribution_type: selection.attribution_type || null,
    marketing_tracking_code: selection.marketing_tracking_code || null,
    marketing_session_id: selection.marketing_session_id || null,
  };
};

const normalizeCheckoutInvoiceData = (response = {}, createdOrder = {}) => {
  const publicToken =
    response?.public_token ||
    response?.order?.public_token ||
    response?.public_invoice_token ||
    response?.order?.public_invoice_token ||
    createdOrder?.public_token ||
    createdOrder?.public_invoice_token ||
    "";

  let invoiceUrl =
    response?.public_invoice_short_url ||
    response?.public_invoice_url ||
    response?.invoice_public_url ||
    response?.short_invoice_url ||
    response?.order?.public_invoice_short_url ||
    response?.order?.public_invoice_url ||
    response?.order?.invoice_public_url ||
    createdOrder?.public_invoice_short_url ||
    createdOrder?.public_invoice_url ||
    createdOrder?.invoice_public_url ||
    "";

  if (!invoiceUrl && publicToken) {
    if (typeof window !== "undefined" && window.location?.origin) {
      invoiceUrl = `${window.location.origin.replace(/\/$/, "")}/invoice/${encodeURIComponent(publicToken)}`;
    } else {
      invoiceUrl = `/invoice/${encodeURIComponent(publicToken)}`;
    }
  }

  if (import.meta.env.DEV && !invoiceUrl) {
    console.log("[checkout response]", response);
    console.log("[normalized invoice url]", invoiceUrl);
    console.log("[normalized public token]", publicToken);
  }

  return {
    invoiceUrl,
    publicToken,
  };
};

const normalizeStockQuantity = (value) => Math.max(0, Number(value ?? 0) || 0);

const getVariantStockQuantity = (variant = {}) =>
  normalizeStockQuantity(
    variant.stock_quantity ??
      variant.stock ??
      variant.quantity ??
      variant.qty ??
      variant.available_quantity ??
      variant.inventory_quantity ??
      variant.current_stock
  );

const getProductVisibleStock = (product = {}) => {
  const variants = Array.isArray(product.variants) ? product.variants : [];
  if (variants.length > 0) {
    return variants.reduce((sum, variant) => sum + getVariantStockQuantity(variant), 0);
  }

  return normalizeStockQuantity(
    product.total_stock ??
      product.stock ??
      product.quantity ??
      product.qty ??
      product.available_quantity ??
      product.inventory_quantity ??
      product.current_stock
  );
};

const isInactiveProductValue = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  return ["inactive", "disabled", "archived", "draft", "unavailable"].includes(normalized);
};

const isVisiblePosProduct = (product = {}) => {
  if (!product) return false;

  const status = String(product.status || product.state || product.availability_status || "").trim().toLowerCase();
  if (
    product.active === false ||
    product.enabled === false ||
    product.is_active === false ||
    product.disabled === true ||
    isInactiveProductValue(status)
  ) {
    return false;
  }

  return getProductVisibleStock(product) > 0;
};

const getCatalogProductId = (product = {}) => String(product?.product_id ?? product?.id ?? "");

const getCatalogVariantId = (variant = {}) => String(variant?.variant_id ?? variant?.variantId ?? variant?.id ?? "");

const normalizeCatalogVariant = (variant = {}) => {
  const stockQuantity = getVariantStockQuantity(variant);
  return {
    ...variant,
    stock: stockQuantity,
    stock_quantity: stockQuantity,
    available: stockQuantity > 0,
  };
};

const normalizeCatalogProduct = (product = {}) => {
  const variants = Array.isArray(product.variants) ? product.variants.map((variant) => normalizeCatalogVariant(variant)) : [];
  const stock = variants.reduce((sum, variant) => sum + Number(variant.stock_quantity ?? variant.stock ?? 0), 0);
  return {
    ...product,
    variants,
    total_stock: stock,
    stock,
  };
};

const getCatalogProductById = (products = [], productId) =>
  Array.isArray(products)
    ? products.find((item) => String(item?.product_id ?? item?.id ?? "") === String(productId ?? ""))
    : null;

const getCatalogVariantById = (product, variantId, color, size) => {
  const variants = Array.isArray(product?.variants) ? product.variants : [];
  const exact = variants.find((variant) => String(getCatalogVariantId(variant)) === String(variantId ?? ""));
  if (exact) return exact;

  const byColorSize = variants.find(
    (variant) =>
      String(variant.color || "").toLowerCase() === String(color || "").toLowerCase() &&
      String(variant.size || "").toLowerCase() === String(size || "").toLowerCase()
  );
  if (byColorSize) return byColorSize;

  return variants[0] || null;
};

const getCatalogItemStock = (products = [], item = {}) => {
  const productId = item.product_id ?? item.productId ?? null;
  const variantId = resolveCheckoutVariantId(item);
  const product = getCatalogProductById(products, productId);
  if (!product) return 0;

  if (isFullVariationMode(item.variation_mode) && variantId !== null) {
    const variant = getCatalogVariantById(product, variantId, item.color, item.size);
    return normalizeStockQuantity(variant?.stock_quantity ?? variant?.stock);
  }

  if (variantId !== null) {
    const variant = getCatalogVariantById(product, variantId, item.color, item.size);
    if (variant) {
      return normalizeStockQuantity(variant.stock_quantity ?? variant.stock);
    }
  }

  return normalizeStockQuantity(product.total_stock ?? product.stock);
};

const reconcileCartWithCatalog = (cart = [], products = []) => {
  const nextCart = [];
  const removedItems = [];
  let changed = false;

  for (const item of Array.isArray(cart) ? cart : []) {
    const liveStock = getCatalogItemStock(products, item);
    if (liveStock <= 0) {
      removedItems.push(item);
      changed = true;
      continue;
    }

    const nextQuantity = Math.min(Number(item.quantity || 0), liveStock);
    if (nextQuantity <= 0) {
      removedItems.push(item);
      changed = true;
      continue;
    }

    if (nextQuantity !== Number(item.quantity || 0) || Number(item.stock || 0) !== liveStock) {
      changed = true;
    }

    nextCart.push({
      ...item,
      stock: liveStock,
      stock_quantity: liveStock,
      quantity: nextQuantity,
    });
  }

  return { nextCart, removedItems, changed };
};

const applySoldItemsToCatalog = (products = [], soldItems = []) => {
  const nextProducts = Array.isArray(products)
    ? products.map((product) => normalizeCatalogProduct(product))
    : [];

  for (const soldItem of Array.isArray(soldItems) ? soldItems : []) {
    const productId = soldItem?.product_id ?? soldItem?.productId ?? null;
    const variantId = resolveCheckoutVariantId(soldItem);
    const quantity = normalizeStockQuantity(soldItem?.quantity);
    if (!productId || quantity <= 0) continue;

    const product = getCatalogProductById(nextProducts, productId);
    if (!product) continue;

    if (isFullVariationMode(soldItem?.variation_mode) && variantId !== null) {
      const variant = getCatalogVariantById(product, variantId, soldItem?.color, soldItem?.size);
      if (variant) {
        const nextStock = Math.max(0, normalizeStockQuantity(variant.stock_quantity ?? variant.stock) - quantity);
        variant.stock = nextStock;
        variant.stock_quantity = nextStock;
        variant.available = nextStock > 0;
      }
    } else if (variantId !== null) {
      const variant = getCatalogVariantById(product, variantId, soldItem?.color, soldItem?.size);
      if (variant) {
        const nextStock = Math.max(0, normalizeStockQuantity(variant.stock_quantity ?? variant.stock) - quantity);
        variant.stock = nextStock;
        variant.stock_quantity = nextStock;
        variant.available = nextStock > 0;
      }
    } else {
      const nextStock = Math.max(0, normalizeStockQuantity(product.stock) - quantity);
      product.stock = nextStock;
      product.total_stock = nextStock;
    }

    const totalStock = Array.isArray(product.variants) && product.variants.length > 0
      ? product.variants.reduce((sum, variant) => sum + normalizeStockQuantity(variant.stock_quantity ?? variant.stock), 0)
      : normalizeStockQuantity(product.stock);
    product.total_stock = totalStock;
    product.stock = totalStock;
  }

  return nextProducts;
};

const refreshCatalogProducts = async ({ setProducts, setLoading, manageLoading = true, isActive = () => true, signal } = {}) => {
  if (manageLoading && setLoading) {
    setLoading(true);
  }
  try {
    const rawProducts = await getProductsWithVariants({ signal });
    const catalog = normalizePosSellableProducts(rawProducts).map((product) => normalizeCatalogProduct(product));
    if (isActive()) {
      setProducts(catalog);
    }
    return catalog;
  } finally {
    if (manageLoading && setLoading) {
      setLoading(false);
    }
  }
};

const normalizeCustomersResponse = (response) => {
  const payload = response?.data ?? response;
  return Array.isArray(payload) ? payload :
    Array.isArray(payload?.data) ? payload.data :
    Array.isArray(payload?.customers) ? payload.customers :
    [];
};

const POS_SALE_STATS_KEY = "erp.pos.saleStats";

const normalizeSmartText = (value) =>
  String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .toLowerCase()
    .trim();

const normalizeSmartFilterKey = (value) =>
  normalizeSmartText(value)
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const normalizeFilterValue = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[\s-]+/g, "_");

const resolveSmartFilterMatch = (value, options = []) => {
  const normalized = normalizeFilterValue(value);
  if (!normalized) return "";
  const normalizedOptions = (Array.isArray(options) ? options : []).map((option) => ({
    ...option,
    value: normalizeFilterValue(option?.value || option?.id || option?.name || ""),
    aliases: [
      option?.value,
      option?.id,
      option?.name,
      option?.label,
      option?.label_ar,
      option?.label_en,
    ]
      .map(normalizeFilterValue)
      .filter(Boolean),
  }));
  const match = normalizedOptions.find((option) => option.aliases.includes(normalized));
  return match?.value || normalized;
};

const getProductSmartFilterValue = (product, field, options = []) => {
  const variants = Array.isArray(product?.variants) ? product.variants : [];
  const firstVariant = variants[0] || {};
  const aliases = {
    gender: [product?.gender, firstVariant.gender],
    productType: [
      product?.product_type,
      product?.productType,
      product?.type,
      firstVariant.product_type,
      firstVariant.productType,
      firstVariant.type,
    ],
    style: [product?.style, firstVariant.style],
    grade: [product?.grade, product?.product_grade, firstVariant.grade, firstVariant.product_grade],
  };

  return resolveSmartFilterMatch((aliases[field] || []).find((value) => String(value || "").trim()), options);
};

const makeCategoryOption = (id, name) => {
  const label = String(name || "").trim();
  if (!label) return null;
  return {
    id: id ? String(id) : `name:${normalizeSmartText(label)}`,
    name: label,
  };
};

const buildProductSearchText = (product, manufacturerLookup) => {
  const variants = Array.isArray(product?.variants) ? product.variants : [];
  return [
    product?.name,
    product?.product_name,
    product?.sku,
    product?.barcode,
    product?.category,
    product?.category_name,
    product?.category_path,
    product?.gender,
    product?.product_type,
    product?.productType,
    product?.style,
    product?.grade,
    product?.main_category_name,
    product?.sub_category_name,
    product?.child_category_name,
    product?.subcategory,
    product?.subcategory_name,
    product?.brand,
    product?.brand_name,
    product?.manufacturer,
    product?.manufacturer_name,
    manufacturerLookup.get(String(product?.manufacturer_id || product?.variant_manufacturer_id || "").trim()) || "",
    ...variants.flatMap((variant) => [
      variant.sku,
      variant.color,
      variant.size,
      variant.barcode,
      variant.brand,
      variant.brand_name,
      variant.manufacturer,
      variant.manufacturer_name,
      manufacturerLookup.get(String(variant.manufacturer_id || variant.variant_manufacturer_id || "").trim()) || "",
    ]),
  ]
    .filter(Boolean)
    .map(normalizeSmartText)
    .join(" ");
};

const buildSmartMeta = (product, manufacturerLookup, classificationOptions = {}) => {
  const variants = Array.isArray(product?.variants) ? product.variants : [];
  const manufacturerIds = new Set(
    [
      product?.manufacturer_id,
      product?.variant_manufacturer_id,
      ...variants.flatMap((variant) => [variant.manufacturer_id, variant.variant_manufacturer_id]),
    ]
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  );
  const manufacturerNames = [
    product?.manufacturer,
    product?.manufacturer_name,
    ...variants.flatMap((variant) => [variant.manufacturer, variant.manufacturer_name]),
    ...Array.from(manufacturerIds).map((id) => manufacturerLookup.get(id)),
  ]
    .filter(Boolean)
    .map(normalizeSmartText);
  const brandKey = product?.brand_id ? String(product.brand_id) : product?.brand || product?.brand_name ? `name:${normalizeSmartText(product.brand || product.brand_name)}` : "";
  const mainCategory = makeCategoryOption(product?.main_category_id, product?.main_category_name || product?.main_category || product?.category_name || product?.category);
  const subCategory = makeCategoryOption(product?.sub_category_id, product?.sub_category_name || product?.sub_category);
  const childCategory = makeCategoryOption(product?.child_category_id, product?.child_category_name || product?.child_category);
  const firstVariant = variants[0] || {};
  const gender = getProductSmartFilterValue(product, "gender", classificationOptions.gender) || normalizeSmartFilterKey(product?.gender || firstVariant.gender);
  const productType =
    getProductSmartFilterValue(product, "productType", classificationOptions.productType) ||
    normalizeSmartFilterKey(product?.product_type || product?.productType || firstVariant.product_type || firstVariant.productType);
  const style = getProductSmartFilterValue(product, "style", classificationOptions.style) || normalizeSmartFilterKey(product?.style || firstVariant.style);
  const grade = getProductSmartFilterValue(product, "grade", classificationOptions.grade) || normalizeSmartFilterKey(product?.grade || firstVariant.grade);

  return {
    mainCategory,
    subCategory,
    childCategory,
    brandKey,
    gender,
    productType,
    style,
    grade,
    manufacturerIds,
    manufacturerNames,
    searchText: buildProductSearchText(product, manufacturerLookup),
  };
};

const readPosSaleStats = () => {
  try {
    return JSON.parse(window.localStorage.getItem(POS_SALE_STATS_KEY) || "{}");
  } catch {
    return {};
  }
};

const writePosSaleStats = (cart) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const current = readPosSaleStats();
    const next = {
      date: current.date === today ? current.date : today,
      recent: current.date === today && Array.isArray(current.recent) ? current.recent : [],
      counts: current.date === today && current.counts ? current.counts : {},
    };

    cart.forEach((item) => {
      const productId = String(item.product_id || item.id || "").trim();
      if (!productId) return;
      next.recent = [productId, ...next.recent.filter((id) => id !== productId)].slice(0, 8);
      next.counts[productId] = Number(next.counts[productId] || 0) + Number(item.quantity || 1);
    });

    window.localStorage.setItem(POS_SALE_STATS_KEY, JSON.stringify(next));
  } catch {
    // Sale stats are a cashier shortcut only; checkout must never fail because localStorage is unavailable.
  }
};

function POSPro() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const persisted = useMemo(() => readPosPersistedState(), []);
  const { groups: classificationGroups } = useProductClassifications({ includeInactive: false });

  const [products, setProducts] = useState([]);
  const [manufacturers, setManufacturers] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [attendanceEmployees, setAttendanceEmployees] = useState([]);
  const [salesEmployees, setSalesEmployees] = useState([]);
  const [salesSettings, setSalesSettings] = useState({ allow_sale_without_salesperson: true, fixed_commission_mode: "fixed_per_invoice" });
  const [selectedSalespersonId, setSelectedSalespersonId] = useState("");
  const [cart, setCart] = useState(() => readPosCart());
  const [search, setSearch] = useState(() => persisted.search || defaultState.search);
  const [selectedMainCategoryId, setSelectedMainCategoryId] = useState(
    () => persisted.selectedMainCategoryId || defaultState.selectedMainCategoryId
  );
  const [selectedSubCategoryId, setSelectedSubCategoryId] = useState(
    () => persisted.selectedSubCategoryId || defaultState.selectedSubCategoryId
  );
  const [selectedChildCategoryId, setSelectedChildCategoryId] = useState(
    () => persisted.selectedChildCategoryId || defaultState.selectedChildCategoryId
  );
  const [selectedBrandId, setSelectedBrandId] = useState(() => persisted.selectedBrandId || defaultState.selectedBrandId);
  const [selectedManufacturerId, setSelectedManufacturerId] = useState(
    () => persisted.selectedManufacturerId || persisted.manufacturerFilter || defaultState.selectedManufacturerId
  );
  const [selectedGender, setSelectedGender] = useState(() => persisted.selectedGender || defaultState.selectedGender);
  const [selectedProductType, setSelectedProductType] = useState(() => persisted.selectedProductType || defaultState.selectedProductType);
  const [selectedStyle, setSelectedStyle] = useState(() => persisted.selectedStyle || defaultState.selectedStyle);
  const [selectedGrade, setSelectedGrade] = useState(() => persisted.selectedGrade || defaultState.selectedGrade);
  const [customerSearch, setCustomerSearch] = useState(defaultState.customerSearch);
  const [selectedCustomerId, setSelectedCustomerId] = useState(null);
  const [selectedAttendanceEmployeeId, setSelectedAttendanceEmployeeId] = useState("");
  const [quickCustomer, setQuickCustomer] = useState(defaultState.quickCustomer);
  const [loyaltyProfile, setLoyaltyProfile] = useState(null);
  const [loyaltyValidation, setLoyaltyValidation] = useState(null);
  const [loyaltyUnavailable, setLoyaltyUnavailable] = useState(false);
  const [loyaltyRedeemPoints, setLoyaltyRedeemPoints] = useState(0);
  const [, setLoyaltyLoading] = useState(false);
  const [paymentMode, setPaymentMode] = useState(defaultState.paymentMode);
  const [cashAmount, setCashAmount] = useState(defaultState.cashAmount);
  const [cardAmount, setCardAmount] = useState(defaultState.cardAmount);
  const [walletAmount, setWalletAmount] = useState(defaultState.walletAmount);
  const [invoiceDiscount, setInvoiceDiscount] = useState(defaultState.invoiceDiscount);
  const [serviceFee, setServiceFee] = useState(defaultState.serviceFee);
  const [couponCode, setCouponCode] = useState("");
  const [couponValidation, setCouponValidation] = useState(null);
  const [couponLoading, setCouponLoading] = useState(false);
  const [previewMode, setPreviewMode] = useState(defaultState.previewMode);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [selectedColor, setSelectedColor] = useState("");
  const [selectedSize, setSelectedSize] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState(generateInvoiceNumber());
  const [lastOrder, setLastOrder] = useState(null);
  const [lastShareContext, setLastShareContext] = useState(null);
  const [marketingAttribution, setMarketingAttribution] = useState(() => readMarketingAttributionState());
  const [attendanceSnapshot, setAttendanceSnapshot] = useState(null);
  const [attendanceLoading, setAttendanceLoading] = useState(false);
  const [shiftReport, setShiftReport] = useState(null);
  const [shiftReportOpen, setShiftReportOpen] = useState(false);
  const [shiftCloseOpen, setShiftCloseOpen] = useState(false);
  const [shiftCloseSubmitting, setShiftCloseSubmitting] = useState(false);
  const [shiftCloseReport, setShiftCloseReport] = useState(null);
  const [actualDrawerAmount, setActualDrawerAmount] = useState("");
  const [openingRotation, setOpeningRotation] = useState(null);
  const [openingCandidatesLoading, setOpeningCandidatesLoading] = useState(false);
  const [openingCandidatesError, setOpeningCandidatesError] = useState("");
  const [selectedNextOpeningEmployeeId, setSelectedNextOpeningEmployeeId] = useState("");
  const [barcodeShopProduct, setBarcodeShopProduct] = useState(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [customerCreateOpen, setCustomerCreateOpen] = useState(false);
  const [recentOperationsOpen, setRecentOperationsOpen] = useState(false);
  const [editingOrder, setEditingOrder] = useState(null);

  const searchRef = useRef(null);
  const filtersPanelRef = useRef(null);
  const filtersButtonRef = useRef(null);
  const invoiceRef = useRef(null);
  const a4Ref = useRef(null);
  const previousTotalRef = useRef(0);
  const selectedAttendanceEmployeeIdRef = useRef(selectedAttendanceEmployeeId);

  useEffect(() => {
    writePosCart(cart);
    writePosPersistedState({
      search,
      selectedMainCategoryId,
      selectedSubCategoryId,
      selectedChildCategoryId,
      selectedBrandId,
      selectedManufacturerId,
      selectedGender,
      selectedProductType,
      selectedStyle,
      selectedGrade,
      paymentMode,
      cashAmount,
      cardAmount,
      walletAmount,
      invoiceDiscount,
      serviceFee,
      previewMode,
    });
  }, [
    cart,
    search,
    selectedMainCategoryId,
    selectedSubCategoryId,
    selectedChildCategoryId,
    selectedBrandId,
    selectedManufacturerId,
    selectedGender,
    selectedProductType,
    selectedStyle,
    selectedGrade,
    paymentMode,
    cashAmount,
    cardAmount,
    walletAmount,
    invoiceDiscount,
    serviceFee,
    previewMode,
  ]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "F2") {
        event.preventDefault();
        searchRef.current?.focus();
      }

      if (event.ctrlKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }

      if (event.key === "Escape") {
        setFiltersOpen(false);
        setSelectedProduct(null);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    const handleStorage = (event) => {
      if (event.key !== MARKETING_ATTRIBUTION_KEY) return;
      setMarketingAttribution(readMarketingAttributionState());
    };

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  useEffect(() => {
    if (!filtersOpen) return undefined;

    const handlePointerDown = (event) => {
      const panel = filtersPanelRef.current;
      const button = filtersButtonRef.current;
      const target = event.target;
      if (panel?.contains(target) || button?.contains(target)) return;
      setFiltersOpen(false);
    };

    const handleEscape = (event) => {
      if (event.key === "Escape") {
        setFiltersOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [filtersOpen]);

  useEffect(() => {
    if (!customerCreateOpen) return undefined;

    const handleEscape = (event) => {
      if (event.key === "Escape") {
        setCustomerCreateOpen(false);
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [customerCreateOpen]);

  const loadCustomers = async (searchValue = "") => {
    try {
      const data = await api.get("/customers", {
        params: {
          limit: searchValue ? 30 : 200,
          page: 1,
          search: searchValue,
        },
      });
      setCustomers(normalizeCustomersResponse(data));
    } catch (err) {
      console.error("[pos] failed to load customers:", err);
    }
  };

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    (async () => {
      try {
        setLoading(true);
        setError("");

        const catalog = await refreshCatalogProducts({
          setProducts,
          setLoading,
          manageLoading: false,
          isActive: () => active,
          signal: controller.signal,
        });
        void catalog;

        if (!active) return;

        const [manufacturersResult, customersResult, attendanceResult, salesEmployeesResult] = await Promise.allSettled([
          api.get("/manufacturers", { signal: controller.signal }),
          api.get("/customers?limit=200&page=1", { signal: controller.signal }),
          getAttendanceEmployees(),
          api.get("/sales-employees", { signal: controller.signal }),
        ]);

        if (!active) return;

        if (manufacturersResult.status === "rejected") {
          console.error("[pos] failed to load manufacturers:", manufacturersResult.reason);
        }
        if (customersResult.status === "rejected") {
          console.error("[pos] failed to load customers:", customersResult.reason);
        }
        if (attendanceResult.status === "rejected") {
          console.error("[pos] failed to load attendance employees:", attendanceResult.reason);
        }
        if (salesEmployeesResult.status === "rejected") {
          console.error("[pos] failed to load sales employees:", salesEmployeesResult.reason);
        }

        const manufacturersRes = manufacturersResult.status === "fulfilled" ? manufacturersResult.value : null;
        const customersRes = customersResult.status === "fulfilled" ? customersResult.value : null;
        const attendanceRes = attendanceResult.status === "fulfilled" ? attendanceResult.value : null;
        const salesEmployeesRes = salesEmployeesResult.status === "fulfilled" ? salesEmployeesResult.value : null;

        const manufacturerRows = Array.isArray(manufacturersRes?.manufacturers)
          ? manufacturersRes.manufacturers
          : Array.isArray(manufacturersRes?.data)
            ? manufacturersRes.data
            : Array.isArray(manufacturersRes)
              ? manufacturersRes
              : [];
        setManufacturers(manufacturerRows);
        const manufacturerNameById = new Map(manufacturerRows.map((item) => [String(item.id), item.name]));
        setProducts((current) =>
          current.map((item) => {
            const manufacturerId = String(item.manufacturer_id || item.variant_manufacturer_id || "").trim();
            const manufacturer = item.manufacturer || manufacturerNameById.get(manufacturerId) || "";
            return {
              ...item,
              manufacturer,
              variants: Array.isArray(item.variants)
                ? item.variants.map((variant) => ({
                    ...variant,
                    manufacturer:
                      variant.manufacturer ||
                      manufacturerNameById.get(String(variant.manufacturer_id || variant.variant_manufacturer_id || "").trim()) ||
                      manufacturer,
                  }))
                : item.variants,
            };
          })
        );

        setCustomers(normalizeCustomersResponse(customersRes));

        const rows = Array.isArray(attendanceRes) ? attendanceRes : attendanceRes?.employees || attendanceRes?.data || [];
        setAttendanceEmployees(rows);
        setSalesEmployees(Array.isArray(salesEmployeesRes?.employees) ? salesEmployeesRes.employees : []);
        setSalesSettings({
          allow_sale_without_salesperson: salesEmployeesRes?.settings?.allow_sale_without_salesperson ?? true,
          fixed_commission_mode: salesEmployeesRes?.settings?.fixed_commission_mode || "fixed_per_invoice",
        });

        if (!selectedAttendanceEmployeeIdRef.current && rows.length > 0) {
          const current = getCurrentUser();
          const matched =
            rows.find((item) =>
              [
                current?.email,
                current?.name,
                current?.full_name,
              ]
                .filter(Boolean)
                .some((value) => String(item.email || item.full_name || "").toLowerCase() === String(value).toLowerCase())
            ) || rows[0];

          if (matched?.id) {
            setSelectedAttendanceEmployeeId(String(matched.id));
          }
        }
      } catch (err) {
        const message = getErrorMessage(err, "Failed to load products from /products/with-variants.");
        console.error("[pos] product feed load failed:", {
          message,
          status: err?.status,
          responseBody: err?.responseBody,
          url: err?.url,
        });
        if (!active) return;
        setError(message);
        toast.error(message);
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
      controller.abort();
    };
  }, []);

  useEffect(() => {
    const searchValue = String(customerSearch || "").trim();
    if (!searchValue || selectedCustomerId) return undefined;

    const controller = new AbortController();
    const timeoutId = window.setTimeout(async () => {
      try {
        const response = await api.get("/customers", {
          params: {
            limit: 30,
            page: 1,
            search: normalizePhone(searchValue).replace(/\D/g, "") ? normalizePhone(searchValue) : searchValue,
          },
          signal: controller.signal,
          suppressErrorStatuses: [401],
        });
        const rows = normalizeCustomersResponse(response);
        setCustomers((current) => {
          const existing = Array.isArray(current) ? current : [];
          const merged = new Map(existing.map((item) => [String(item?.id || item?.customer_id), item]));
          rows.forEach((item) => {
            const key = String(item?.id || item?.customer_id || "");
            if (key) merged.set(key, item);
          });
          return Array.from(merged.values());
        });
      } catch (err) {
        if (err?.name !== "AbortError") {
          console.error("[pos] failed to search customers:", err);
        }
      }
    }, 180);

    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [customerSearch, selectedCustomerId]);

  useEffect(() => {
    if (!Array.isArray(products) || products.length === 0 || !Array.isArray(cart) || cart.length === 0) {
      return;
    }

    const reconciliation = reconcileCartWithCatalog(cart, products);
    if (!reconciliation.changed) return;

    setCart(reconciliation.nextCart);
    if (reconciliation.removedItems.length > 0) {
      toast.error("Some cart items are no longer available and were removed.");
    } else {
      toast.error("Cart quantities were adjusted to live stock.");
    }
  }, [products, cart]);

  const loadAttendanceEmployees = async () => {
    try {
      const response = await getAttendanceEmployees();
      const rows = Array.isArray(response) ? response : response?.employees || response?.data || [];
      setAttendanceEmployees(rows);

      if (!selectedAttendanceEmployeeId && rows.length > 0) {
        const current = getCurrentUser();
        const matched =
          rows.find((item) =>
            [
              current?.email,
              current?.name,
              current?.full_name,
            ]
              .filter(Boolean)
              .some((value) => String(item.email || item.full_name || "").toLowerCase() === String(value).toLowerCase())
          ) || rows[0];

        if (matched?.id) {
          setSelectedAttendanceEmployeeId(String(matched.id));
        }
      }
    } catch (err) {
      console.error("[pos] failed to load attendance employees:", err);
    }
  };

  const loadOpeningRotation = async () => {
    try {
      setOpeningCandidatesLoading(true);
      setOpeningCandidatesError("");
      const response = await getOpeningCandidates();
      const payload = response?.data || response || {};
      setOpeningRotation(payload);
      return payload;
    } catch (err) {
      const message = err?.message || "Failed to load opening staff candidates";
      setOpeningCandidatesError(message);
      console.error("[pos] failed to load opening candidates:", err);
      return null;
    } finally {
      setOpeningCandidatesLoading(false);
    }
  };

  const manufacturerLookup = useMemo(
    () => new Map(manufacturers.map((item) => [String(item.id), item.name])),
    [manufacturers]
  );
  const smartClassificationOptions = useMemo(
    () => classificationGroupsToFieldOptions(classificationGroups, {}, { includeInactive: false }),
    [classificationGroups]
  );

  const customer = useMemo(
    () =>
      customers.find((item) => String(item?.id || item?.customer_id) === String(selectedCustomerId)) || null,
    [customers, selectedCustomerId]
  );

  const selectedAttendanceEmployee = useMemo(
    () => attendanceEmployees.find((item) => String(item.id) === String(selectedAttendanceEmployeeId)) || null,
    [attendanceEmployees, selectedAttendanceEmployeeId]
  );

  const openingCandidates = useMemo(() => {
    if (Array.isArray(openingRotation?.candidates)) return openingRotation.candidates;
    if (Array.isArray(openingRotation?.data?.candidates)) return openingRotation.data.candidates;
    return [];
  }, [openingRotation]);

  const selectedNextOpeningEmployee = useMemo(
    () => openingCandidates.find((item) => String(item.id || item.employee_id) === String(selectedNextOpeningEmployeeId)) || null,
    [openingCandidates, selectedNextOpeningEmployeeId]
  );

  const nextOpeningAssignment = openingRotation?.latest_assignment || openingRotation?.data?.latest_assignment || null;

  const isShiftActive = Boolean(
    selectedAttendanceEmployeeId &&
      attendanceSnapshot?.today_attendance?.check_in &&
      !attendanceSnapshot?.today_attendance?.check_out
  );

  useEffect(() => {
    if (!selectedAttendanceEmployeeId) return;
    loadOpeningRotation();
  }, [selectedAttendanceEmployeeId]);

  const handleSelectCustomer = (item) => {
    const customerId = item?.id || item?.customer_id;
    if (!customerId) {
      console.error("[pos] selected customer is missing id/customer_id:", item);
      toast.error("This customer cannot be selected because its ID is missing.");
      return;
    }

    setSelectedCustomerId(customerId);
    setCustomerSearch(item.name || item.phone || "");
    setLoyaltyRedeemPoints(0);
  };

  const handleClearSelectedCustomer = () => {
    setSelectedCustomerId(null);
    setCustomerSearch("");
    setLoyaltyProfile(null);
    setLoyaltyValidation(null);
    setLoyaltyRedeemPoints(0);
  };

  useEffect(() => {
    let active = true;

    const defaultLoyaltyProfile = {
      points: 0,
      tier: "Bronze",
      wallet: 0,
      available_points: 0,
      points_balance: 0,
      lifetime_points: 0,
      wallet_balance: 0,
      transactions: [],
    };

    const loadLoyalty = async () => {
      if (!selectedCustomerId) {
        setLoyaltyProfile(null);
        setLoyaltyValidation(null);
        setLoyaltyRedeemPoints(0);
        return;
      }

      try {
        setLoyaltyLoading(true);
        const response = await getLoyaltyCustomerById(selectedCustomerId);
        if (!active) return;
        setLoyaltyUnavailable(false);
        setLoyaltyProfile(response?.loyalty || null);
        setLoyaltyValidation(response?.loyalty ? { ...response.loyalty, customerId: selectedCustomerId } : null);
      } catch (error) {
        if (!isForbiddenError(error)) {
          console.error("[pos] failed to load loyalty customer:", error);
        }
        if (!active) return;
        if (isForbiddenError(error)) {
          setLoyaltyUnavailable(true);
        }
        setLoyaltyProfile(defaultLoyaltyProfile);
        setLoyaltyValidation({ ...defaultLoyaltyProfile, customerId: selectedCustomerId });
      } finally {
        if (active) setLoyaltyLoading(false);
      }
    };

    loadLoyalty();
    return () => {
      active = false;
    };
  }, [selectedCustomerId]);

  useEffect(() => {
    let active = true;
    const loadAttendanceSnapshot = async () => {
      if (!selectedAttendanceEmployeeId) {
        setAttendanceSnapshot(null);
        return;
      }

      try {
        setAttendanceLoading(true);
        const response = await getAttendanceKioskSnapshot({ employeeId: selectedAttendanceEmployeeId });
        if (!active) return;
        setAttendanceSnapshot(response?.data || response || null);
      } catch (error) {
        console.error("[pos] failed to load attendance snapshot:", error);
        if (!active) return;
        setAttendanceSnapshot(null);
      } finally {
        if (active) setAttendanceLoading(false);
      }
    };

    loadAttendanceSnapshot();
    return () => {
      active = false;
    };
  }, [selectedAttendanceEmployeeId]);

  const availableProducts = useMemo(
    () => products.filter((product) => isVisiblePosProduct(product)),
    [products]
  );

  const smartProducts = useMemo(
    () =>
      availableProducts.map((product) => ({
        product,
        meta: buildSmartMeta(product, manufacturerLookup, smartClassificationOptions),
      })),
    [availableProducts, manufacturerLookup, smartClassificationOptions]
  );

  const mainCategoryOptions = useMemo(() => {
    const map = new Map();
    smartProducts.forEach(({ meta }) => {
      if (!meta.mainCategory) return;
      const current = map.get(meta.mainCategory.id) || { ...meta.mainCategory, count: 0 };
      current.count += 1;
      map.set(meta.mainCategory.id, current);
    });
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [smartProducts]);

  const productsAfterMainCategory = useMemo(
    () =>
      smartProducts.filter(
        ({ meta }) => selectedMainCategoryId === "all" || meta.mainCategory?.id === selectedMainCategoryId
      ),
    [smartProducts, selectedMainCategoryId]
  );

  const subCategoryOptions = useMemo(() => {
    const map = new Map();
    productsAfterMainCategory.forEach(({ meta }) => {
      if (!meta.subCategory) return;
      const current = map.get(meta.subCategory.id) || { ...meta.subCategory, count: 0 };
      current.count += 1;
      map.set(meta.subCategory.id, current);
    });
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [productsAfterMainCategory]);

  const productsAfterSubCategory = useMemo(
    () =>
      productsAfterMainCategory.filter(
        ({ meta }) => selectedSubCategoryId === "all" || meta.subCategory?.id === selectedSubCategoryId
      ),
    [productsAfterMainCategory, selectedSubCategoryId]
  );

  const childCategoryOptions = useMemo(() => {
    const map = new Map();
    productsAfterSubCategory.forEach(({ meta }) => {
      if (!meta.childCategory) return;
      const current = map.get(meta.childCategory.id) || { ...meta.childCategory, count: 0 };
      current.count += 1;
      map.set(meta.childCategory.id, current);
    });
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [productsAfterSubCategory]);

  const productsAfterChildCategory = useMemo(
    () =>
      productsAfterSubCategory.filter(
        ({ meta }) => selectedChildCategoryId === "all" || meta.childCategory?.id === selectedChildCategoryId
      ),
    [productsAfterSubCategory, selectedChildCategoryId]
  );

  const productsAfterNonSmartFilters = useMemo(() => {
    const query = normalizeSmartText(search.trim());

    return productsAfterChildCategory.filter(({ meta }) => {
      const matchesBrand = selectedBrandId === "all" || meta.brandKey === selectedBrandId;
      const matchesManufacturer =
        selectedManufacturerId === "all" ||
        meta.manufacturerIds.has(String(selectedManufacturerId)) ||
        meta.manufacturerNames.includes(normalizeSmartText(String(selectedManufacturerId).replace(/^name:/, "")));
      const matchesText = !query || meta.searchText.includes(query);
      return matchesBrand && matchesManufacturer && matchesText;
    });
  }, [productsAfterChildCategory, search, selectedBrandId, selectedManufacturerId]);

  const smartFilterOptions = useMemo(() => {
    const renderedFilterSource = productsAfterNonSmartFilters.map(({ product }) => product);

    const withCounts = (items, field) =>
      items.map((item) => {
        const optionValue = normalizeFilterValue(item.value || item.id || item.name || item.label);
        return {
          ...item,
          id: optionValue,
          name: item.name || item.label || item.label_ar || item.label_en || item.value || item.id || "",
          icon: item.icon || "",
          color: item.color || "",
          count: renderedFilterSource.filter((product) => getProductSmartFilterValue(product, field, smartClassificationOptions[field]) === optionValue).length,
        };
      });

    const counts = {
      gender: withCounts(smartClassificationOptions.gender, "gender"),
      productType: withCounts(smartClassificationOptions.productType, "productType"),
      style: withCounts(smartClassificationOptions.style, "style"),
      grade: withCounts(smartClassificationOptions.grade, "grade"),
    };
    return counts;
  }, [productsAfterNonSmartFilters, smartClassificationOptions]);

  const smartFilterProductsSource = useMemo(
    () => productsAfterNonSmartFilters.map(({ product }) => product),
    [productsAfterNonSmartFilters]
  );

  const productsAfterSmartFilters = useMemo(
    () =>
      productsAfterNonSmartFilters.filter(({ product }) => {
        const matchesGender =
          selectedGender === "all" || getProductSmartFilterValue(product, "gender", smartClassificationOptions.gender) === normalizeFilterValue(selectedGender);
        const matchesProductType =
          selectedProductType === "all" ||
          getProductSmartFilterValue(product, "productType", smartClassificationOptions.productType) === normalizeFilterValue(selectedProductType);
        const matchesStyle =
          selectedStyle === "all" || getProductSmartFilterValue(product, "style", smartClassificationOptions.style) === normalizeFilterValue(selectedStyle);
        const matchesGrade =
          selectedGrade === "all" || getProductSmartFilterValue(product, "grade", smartClassificationOptions.grade) === normalizeFilterValue(selectedGrade);
        return matchesGender && matchesProductType && matchesStyle && matchesGrade;
      }),
    [productsAfterNonSmartFilters, selectedGender, selectedProductType, selectedStyle, selectedGrade, smartClassificationOptions]
  );

  const brandOptions = useMemo(() => {
    const map = new Map();
    productsAfterSmartFilters.forEach(({ product, meta }) => {
      const label = product.brand_name || product.brand;
      if (!label || label === "Unbranded") return;
      const key = meta.brandKey || `name:${normalizeSmartText(label)}`;
      if (!map.has(key)) map.set(key, { id: key, name: label });
    });
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [productsAfterSmartFilters]);

  const manufacturerOptions = useMemo(() => {
    const map = new Map();
    productsAfterSmartFilters.forEach(({ product, meta }) => {
      meta.manufacturerIds.forEach((id) => {
        const name = manufacturerLookup.get(id) || product.manufacturer_name || product.manufacturer;
        if (name) map.set(id, { id, name });
      });
      meta.manufacturerNames.forEach((name) => {
        if (!name) return;
        const existing = Array.from(map.values()).find((item) => normalizeSmartText(item.name) === name);
        if (!existing) map.set(`name:${name}`, { id: `name:${name}`, name });
      });
    });
    manufacturers.forEach((manufacturer) => {
      const id = String(manufacturer.id);
      if (!map.has(id)) map.set(id, { id, name: manufacturer.name });
    });
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [productsAfterSmartFilters, manufacturers, manufacturerLookup]);

  const visibleProducts = useMemo(() => {
    const query = normalizeSmartText(search.trim());

    return productsAfterSmartFilters
      .filter(({ meta }) => {
        const matchesBrand = selectedBrandId === "all" || meta.brandKey === selectedBrandId;
        const matchesManufacturer =
          selectedManufacturerId === "all" ||
          meta.manufacturerIds.has(String(selectedManufacturerId)) ||
          meta.manufacturerNames.includes(normalizeSmartText(String(selectedManufacturerId).replace(/^name:/, "")));
        const matchesText = !query || meta.searchText.includes(query);
        return matchesBrand && matchesManufacturer && matchesText;
      })
      .map(({ product }) => product);
  }, [productsAfterSmartFilters, search, selectedBrandId, selectedManufacturerId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (selectedMainCategoryId !== "all" && !mainCategoryOptions.some((option) => option.id === selectedMainCategoryId)) {
        setSelectedMainCategoryId("all");
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [mainCategoryOptions, selectedMainCategoryId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (selectedSubCategoryId !== "all" && !subCategoryOptions.some((option) => option.id === selectedSubCategoryId)) {
        setSelectedSubCategoryId("all");
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [subCategoryOptions, selectedSubCategoryId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (selectedChildCategoryId !== "all" && !childCategoryOptions.some((option) => option.id === selectedChildCategoryId)) {
        setSelectedChildCategoryId("all");
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [childCategoryOptions, selectedChildCategoryId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (selectedGender !== "all" && !smartFilterOptions.gender.some((option) => option.id === selectedGender)) {
        setSelectedGender("all");
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [smartFilterOptions.gender, selectedGender]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (selectedProductType !== "all" && !smartFilterOptions.productType.some((option) => option.id === selectedProductType)) {
        setSelectedProductType("all");
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [smartFilterOptions.productType, selectedProductType]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (selectedStyle !== "all" && !smartFilterOptions.style.some((option) => option.id === selectedStyle)) {
        setSelectedStyle("all");
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [smartFilterOptions.style, selectedStyle]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (selectedGrade !== "all" && !smartFilterOptions.grade.some((option) => option.id === selectedGrade)) {
        setSelectedGrade("all");
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [smartFilterOptions.grade, selectedGrade]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (selectedBrandId !== "all" && !brandOptions.some((option) => option.id === selectedBrandId)) {
        setSelectedBrandId("all");
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [brandOptions, selectedBrandId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (selectedManufacturerId !== "all" && !manufacturerOptions.some((option) => option.id === selectedManufacturerId)) {
        setSelectedManufacturerId("all");
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [manufacturerOptions, selectedManufacturerId]);

  const activeProduct = selectedProduct
    ? products.find((item) => String(item.product_id || item.id) === String(selectedProduct.product_id || selectedProduct.id)) || selectedProduct
    : null;

  const activeVariant = useMemo(() => {
    if (!activeProduct) return null;
    const variants = Array.isArray(activeProduct.variants) ? activeProduct.variants : [];
    if (variants.length <= 1) return variants[0] || null;
    return variants.find(
      (variant) =>
        String(variant.color || "") === String(selectedColor || "") &&
        String(variant.size || "") === String(selectedSize || "")
    ) || null;
  }, [activeProduct, selectedColor, selectedSize]);

  const liveBarcodeShopProduct = useMemo(() => {
    if (!barcodeShopProduct) return null;
    return products.find((item) => String(item.product_id || item.id) === String(barcodeShopProduct.product_id || barcodeShopProduct.id)) || barcodeShopProduct;
  }, [barcodeShopProduct, products]);

  const cartTotals = useMemo(
    () =>
      calcTotals({
        cart,
        invoiceDiscount,
        serviceFee,
        loyaltyDiscount: loyaltyValidation && loyaltyValidation.valid === false ? 0 : Number(loyaltyValidation?.applied_amount || 0),
        couponDiscount: couponValidation?.valid ? Number(couponValidation.discount_amount || 0) : 0,
      }),
    [cart, invoiceDiscount, serviceFee, loyaltyValidation, couponValidation]
  );

  const paymentSummary = useMemo(
    () =>
      derivePaymentSummary({
        total: cartTotals.total,
        paymentMode,
        cashAmount,
        cardAmount,
        walletAmount,
      }),
    [cartTotals.total, paymentMode, cashAmount, cardAmount, walletAmount]
  );

  const loyaltyPointsToEarn = useMemo(() => {
    const spendAmount = 100;
    const earnPoints = 10;
    return Math.max(0, Math.floor(Number(cartTotals.total || 0) / spendAmount) * earnPoints);
  }, [cartTotals.total]);

  const loyaltyDiscountAmount = loyaltyValidation && loyaltyValidation.valid === false ? 0 : Number(loyaltyValidation?.applied_amount || 0);
  const walletCashbackToEarn = useMemo(() => {
    const tier = String(loyaltyProfile?.tier || customer?.tier || "Bronze");
    const rates = { Bronze: 0, Silver: 0.02, Gold: 0.03, Platinum: 0.05 };
    return Number((Number(cartTotals.total || 0) * Number(rates[tier] || 0)).toFixed(2));
  }, [cartTotals.total, customer?.tier, loyaltyProfile?.tier]);
  const activeSmartFilters = useMemo(
    () =>
      [
        { key: "gender", label: "الجنس", value: selectedGender, setValue: setSelectedGender, options: smartFilterOptions.gender },
        { key: "type", label: "نوع المنتج", value: selectedProductType, setValue: setSelectedProductType, options: smartFilterOptions.productType },
        { key: "style", label: "الستايل", value: selectedStyle, setValue: setSelectedStyle, options: smartFilterOptions.style },
        { key: "grade", label: "الفئة", value: selectedGrade, setValue: setSelectedGrade, options: smartFilterOptions.grade },
      ]
        .filter((item) => item.value !== "all")
        .map((item) => ({
          ...item,
          name: item.options.find((option) => option.id === item.value)?.name || item.options.find((option) => option.value === item.value)?.name || item.value,
        })),
    [selectedGender, selectedProductType, selectedStyle, selectedGrade, smartFilterOptions]
  );
  const activeSmartFilterCount = activeSmartFilters.length;

  useEffect(() => {
    const previousTotal = Number(previousTotalRef.current || 0);
    if (paymentMode === "cash" && (Number(cashAmount || 0) === 0 || Number(cashAmount || 0) === previousTotal)) {
      setCashAmount(cartTotals.total);
    }
    if (paymentMode === "card" && (Number(cardAmount || 0) === 0 || Number(cardAmount || 0) === previousTotal)) {
      setCardAmount(cartTotals.total);
    }
    if (paymentMode === "wallet" && (Number(walletAmount || 0) === 0 || Number(walletAmount || 0) === previousTotal)) {
      setWalletAmount(cartTotals.total);
    }
    previousTotalRef.current = cartTotals.total;
  }, [paymentMode, cartTotals.total, cashAmount, cardAmount, walletAmount]);

  useEffect(() => {
    let active = true;

    const validate = async () => {
      if (!selectedCustomerId || loyaltyUnavailable) {
        setLoyaltyValidation(null);
        return;
      }

      try {
        const response = await validateLoyaltyRedemption({
          customerId: selectedCustomerId,
          points: loyaltyRedeemPoints,
          orderTotal: cartTotals.preLoyaltyTotal,
        });

        if (!active) return;
        setLoyaltyUnavailable(false);
        setLoyaltyValidation(response);
      } catch (error) {
        if (!isForbiddenError(error)) {
          console.error("[pos] failed to validate loyalty redemption:", error);
        }
        if (!active) return;
        if (isForbiddenError(error)) {
          setLoyaltyUnavailable(true);
        }
        setLoyaltyValidation(null);
      }
    };

    validate();
    return () => {
      active = false;
    };
  }, [selectedCustomerId, loyaltyRedeemPoints, cartTotals.preLoyaltyTotal, loyaltyUnavailable]);

  const normalizeQrProduct = (product) => ({
    ...product,
    image_url: resolvePosImageUrl(product?.image_url || product?.product_image_url || ""),
    product_image_url: resolvePosImageUrl(product?.product_image_url || product?.image_url || ""),
    colors: (Array.isArray(product?.colors) ? product.colors : []).map((color) => {
      const colorImages = Array.isArray(color.images) ? color.images : [];
      const primaryColorImage = colorImages.find((image) => image?.is_primary) || colorImages[0] || null;
      const sizes = (Array.isArray(color.sizes) ? color.sizes : []).map((size) => {
        const stockQuantity = normalizeStockQuantity(size.stock_quantity ?? size.stock);
        const sizeImages = Array.isArray(size.images) ? size.images : [];
        const primarySizeImage = sizeImages.find((image) => image?.is_primary) || sizeImages[0] || null;
        return {
          ...size,
          stock: stockQuantity,
          stock_quantity: stockQuantity,
          available: stockQuantity > 0,
          image_url: resolvePosImageUrl(size.image_url || size.variant_image_url || primarySizeImage?.image_url || primaryColorImage?.image_url || color.image_url || product?.image_url),
          variant_image_url: resolvePosImageUrl(size.variant_image_url),
          images: sizeImages,
        };
      });

      return {
        ...color,
        image_url: resolvePosImageUrl(color.image_url || primaryColorImage?.image_url),
        primary_image_url: resolvePosImageUrl(primaryColorImage?.image_url || color.image_url),
        images: colorImages,
        sizes,
      };
    }),
    total_stock: (Array.isArray(product?.colors) ? product.colors : []).reduce(
      (sum, color) =>
        sum +
        (Array.isArray(color.sizes)
          ? color.sizes.reduce((colorSum, size) => colorSum + normalizeStockQuantity(size.stock_quantity ?? size.stock), 0)
          : 0),
      0
    ),
    stock: (Array.isArray(product?.colors) ? product.colors : []).reduce(
      (sum, color) =>
        sum +
        (Array.isArray(color.sizes)
          ? color.sizes.reduce((colorSum, size) => colorSum + normalizeStockQuantity(size.stock_quantity ?? size.stock), 0)
          : 0),
      0
    ),
  });

  const handleBarcodeSubmit = async () => {
    const rawValue = String(search || "").trim();
    const normalized = rawValue.toLowerCase();
    if (!normalized) return;

    const exactVariant = products
      .flatMap((product) =>
        (product.variants || []).map((variant) => ({
          product,
          variant,
        }))
      )
      .find((entry) =>
        [entry.variant.sku, entry.variant.barcode, entry.product.sku, entry.product.barcode]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase() === normalized)
      );

    if (exactVariant) {
      addVariantToCart(exactVariant.product, exactVariant.variant);
      setSearch("");
      return;
    }

    const exactProduct = products.find((product) =>
      [product.sku, product.barcode].filter(Boolean).some((value) => String(value).toLowerCase() === normalized)
    );

    if (exactProduct) {
      quickAddProduct(exactProduct);
      setSearch("");
      return;
    }

    try {
      const qrProduct = await getProductByQrToken(rawValue);
      setBarcodeShopProduct(normalizeQrProduct(qrProduct));
      setSearch("");
    } catch (error) {
      console.error("[pos] product QR lookup failed:", error);
      toast.error("Product QR not found");
    }
  };

  const addVariantToCart = (product, variant) => {
    if (!variant) {
      toast.error("Variant not available");
      return;
    }

    const productId = product.product_id ?? product.id;
    const liveProduct = getCatalogProductById(products, productId) || normalizeCatalogProduct(product);
    const candidateVariantId = variant.variant_id ?? variant.variantId ?? variant.id ?? null;
    const variantId = isRealVariantId(candidateVariantId) ? candidateVariantId : null;
    const liveVariant =
      variantId !== null ? getCatalogVariantById(liveProduct, variantId, variant.color, variant.size) || normalizeCatalogVariant(variant) : null;
    const liveStock = normalizeStockQuantity(
      liveVariant?.stock_quantity ?? liveVariant?.stock ?? liveProduct.total_stock ?? liveProduct.stock
    );

    if (liveStock <= 0) {
      toast.error("Stock is empty");
      return;
    }

    const key = variantId ? String(variantId) : `product:${productId}`;

    setCart((prev) => {
      const existing = prev.find((item) => item.key === key);
      if (existing) {
        if (Number(existing.quantity || 0) >= liveStock) {
          toast.error("Stock limit reached");
          return prev;
        }

        return prev.map((item) =>
          item.key === key
            ? {
                ...item,
                stock: liveStock,
                stock_quantity: liveStock,
                quantity: Number(item.quantity || 0) + 1,
              }
            : item
        );
      }

      return [
        ...prev,
        {
          key,
          product_id: productId,
          variant_id: variantId,
          name: product.name || product.product_name,
          product_name: product.product_name || product.name,
          sku: variant.sku || product.sku,
          barcode: variant.barcode || product.barcode || variant.sku,
          color: variant.color || "",
          size: variant.size || product.fixed_size_label || "",
          stock: liveStock,
          stock_quantity: liveStock,
          image_url: variant.image_url || product.image_url || "",
          image: variant.image || product.image || "",
          product_image: variant.product_image || product.product_image || "",
          cover_image: variant.cover_image || product.cover_image || "",
          thumbnail: variant.thumbnail || product.thumbnail || "",
          variant_image: variant.variant_image || product.variant_image || "",
          product_image_url: variant.product_image_url || product.product_image_url || product.image_url || "",
          variant_image_url: variant.variant_image_url || product.variant_image_url || "",
          color_image_url: variant.color_image_url || product.color_image_url || "",
          images: variant.images || product.images || null,
          gallery: variant.gallery || product.gallery || null,
          product,
          variant,
          product_variant: variant.product_variant || variant,
          color_object: variant.color_object || product.color || null,
          price: Number(variant.price || product.sale_price || product.price || 0),
          brand: product.brand || variant.brand || "",
          category: product.category || variant.category || "",
          manufacturer: product.manufacturer || variant.manufacturer || "",
          variation_mode: product.variation_mode || "",
          fixed_size_label: product.fixed_size_label || "",
          lineDiscount: 0,
          quantity: 1,
        },
      ];
    });

    toast.success(`${product.name || product.product_name} added to cart`);
  };

  const quickAddProduct = (product) => {
    const variants = Array.isArray(product.variants) ? product.variants : [];
    if (variants.length === 1) {
      addVariantToCart(product, variants[0]);
      return;
    }

    if (variants.length > 1) {
      handleSelectProduct(product);
      return;
    }

    const variant = pickFirstVariant(product);
    if (variant) {
      addVariantToCart(product, variant);
      return;
    }

    toast.error("This product is not sellable");
  };

  const handleSelectProduct = (product) => {
    const variants = Array.isArray(product.variants) ? product.variants : [];
    if (variants.length <= 1) {
      quickAddProduct(product);
      return;
    }

    const firstVariant = variants.find((variant) => normalizeStockQuantity(variant.stock_quantity ?? variant.stock) > 0) || variants[0] || null;
    setSelectedColor(firstVariant?.color || "");
    const firstInStockForColor =
      variants.find(
        (variant) =>
          String(variant.color || "") === String(firstVariant?.color || "") &&
          normalizeStockQuantity(variant.stock_quantity ?? variant.stock) > 0
      ) || firstVariant;
    setSelectedSize(firstInStockForColor?.size || "");
    setSelectedProduct(product);
  };

  const handleRemoveCartItem = (key) => setCart((prev) => prev.filter((item) => item.key !== key));
  const handleIncrease = (key) =>
    setCart((prev) =>
      prev.map((item) =>
        item.key === key
          ? (() => {
              const liveStock = getCatalogItemStock(products, item);
              const nextQuantity = Math.min(Number(item.quantity || 0) + 1, liveStock);
              if (nextQuantity === Number(item.quantity || 0)) {
                toast.error("Stock limit reached");
                return item;
              }
              return {
                ...item,
                stock: liveStock,
                stock_quantity: liveStock,
                quantity: nextQuantity,
              };
            })()
          : item
      )
    );
  const handleDecrease = (key) =>
    setCart((prev) =>
      prev.map((item) =>
        item.key === key
          ? {
              ...item,
              quantity: Math.max(1, Number(item.quantity || 0) - 1),
            }
          : item
      )
    );
  const handleItemDiscount = (key, value) =>
    setCart((prev) =>
      prev.map((item) =>
        item.key === key
          ? {
              ...item,
              lineDiscount: Number(value || 0),
            }
          : item
      )
    );

  const handleApplyCoupon = async () => {
    const code = String(couponCode || "").trim().toUpperCase();
    if (!code) {
      toast.error("Enter a coupon code");
      return;
    }
    try {
      setCouponLoading(true);
      const orderTotal = Math.max(0, Number(cartTotals.preLoyaltyTotal || 0) - Number(loyaltyDiscountAmount || 0));
      const response = await api.post("/coupons/validate", {
        code,
        source: "pos",
        order_total: orderTotal,
        customer_id: selectedCustomerId || null,
      });
      if (!response.valid) {
        setCouponValidation(null);
        toast.error(response.reason || "Coupon is invalid");
        return;
      }
      setCouponCode(code);
      setCouponValidation(response);
      toast.success(`Coupon applied: ${formatCurrency(response.discount_amount || 0)}`);
    } catch (err) {
      setCouponValidation(null);
      toast.error(getErrorMessage(err, "Unable to validate coupon"));
    } finally {
      setCouponLoading(false);
    }
  };

  const handleRemoveCoupon = () => {
    setCouponCode("");
    setCouponValidation(null);
  };

  const mapOrderItemToCartItem = (item = {}) => {
    const variantId = resolveCheckoutVariantId(item);
    const productId = item.product_id || item.productId || null;
    const key = variantId ? String(variantId) : `product:${productId}`;
    const catalogProduct = getCatalogProductById(products, productId) || {};
    const catalogVariant = variantId ? getCatalogVariantById(catalogProduct, variantId, item.color, item.size) || {} : {};
    const quantity = Number(item.quantity || 0);
    const liveStock = getCatalogItemStock(products, {
      product_id: productId,
      variant_id: variantId,
      variation_mode: item.variation_mode || catalogProduct.variation_mode || "full_variations",
    });

    return {
      key,
      product_id: productId,
      variant_id: variantId,
      name: item.product_name || catalogProduct.name || "منتج",
      product_name: item.product_name || catalogProduct.name || "منتج",
      sku: item.sku || catalogVariant.sku || catalogProduct.sku || "",
      barcode: item.barcode || catalogVariant.barcode || catalogProduct.barcode || "",
      color: item.color || catalogVariant.color || "",
      size: item.size || catalogVariant.size || "",
      stock: liveStock + quantity,
      stock_quantity: liveStock + quantity,
      image_url: item.image_url || catalogVariant.image_url || catalogProduct.image_url || "",
      product_image_url: catalogProduct.product_image_url || catalogProduct.image_url || item.image_url || "",
      product: catalogProduct,
      variant: catalogVariant,
      product_variant: catalogVariant,
      price: Number(item.sale_price || item.price || 0),
      variation_mode: item.variation_mode || catalogProduct.variation_mode || "full_variations",
      fixed_size_label: catalogProduct.fixed_size_label || "",
      lineDiscount: Number(item.discount_amount || 0) / Math.max(1, quantity || 1),
      quantity,
    };
  };

  const handleEditRecentOrder = async (order) => {
    if (!order?.id) return;
    try {
      const response = await api.get(`/orders/${order.id}`);
      const loadedOrder = response.order || order;
      const loadedItems = Array.isArray(response.items) ? response.items : order.items || [];
      setEditingOrder({ ...loadedOrder, items: loadedItems });
      setCart(loadedItems.map(mapOrderItemToCartItem).filter((item) => item.quantity > 0));
      setInvoiceNumber(loadedOrder.invoice_number || order.invoice_number || invoiceNumber);
      setPaymentMode(loadedOrder.payment_method || order.payment_method || "cash");
      setCashAmount(Number(loadedOrder.cash_amount || 0));
      setCardAmount(Number(loadedOrder.card_amount || 0));
      setWalletAmount(Number(loadedOrder.wallet_payment_amount || 0));
      setInvoiceDiscount(Number(loadedOrder.discount_amount || 0));
      setServiceFee(Number(loadedOrder.service_fee || 0));
      setSelectedCustomerId(loadedOrder.customer_id || null);
      setCustomerSearch(loadedOrder.customer_name || "");
      setRecentOperationsOpen(false);
      toast.success(`أنت الآن تعدل فاتورة رقم ${loadedOrder.invoice_number || order.invoice_number}`);
    } catch (err) {
      toast.error(getErrorMessage(err, "تعذر تحميل الفاتورة للتعديل"));
    }
  };

  const handleResellRecentOrder = async (order) => {
    if (!order?.id) return;
    try {
      const response = await api.get(`/orders/${order.id}`);
      const loadedOrder = response.order || order;
      const loadedItems = Array.isArray(response.items) ? response.items : order.items || [];
      const nextCart = loadedItems
        .map(mapOrderItemToCartItem)
        .filter((item) => item.quantity > 0)
        .map((item) => {
          const liveStock = Math.max(0, Number(item.stock || 0) - Number(item.quantity || 0));
          return {
            ...item,
            stock: liveStock,
            stock_quantity: liveStock,
          };
        });

      if (nextCart.length === 0) {
        toast.error("لا توجد منتجات صالحة لإعادة البيع");
        return;
      }

      setEditingOrder(null);
      setCart(nextCart);
      setInvoiceNumber(generateInvoiceNumber());
      setPaymentMode("cash");
      setCashAmount(0);
      setCardAmount(0);
      setWalletAmount(0);
      setInvoiceDiscount(0);
      setServiceFee(0);
      handleClearSelectedCustomer();
      setRecentOperationsOpen(false);
      toast.success(`تم تحميل منتجات ${loadedOrder.invoice_number || order.invoice_number} كعملية بيع جديدة`);
    } catch (err) {
      toast.error(getErrorMessage(err, "تعذر تحميل الفاتورة لإعادة البيع"));
    }
  };

  const handleExchangeStarted = ({ order, returnTotal = 0 } = {}) => {
    setEditingOrder(null);
    setInvoiceNumber(generateInvoiceNumber());
    setPaymentMode("cash");
    setCashAmount(0);
    setCardAmount(0);
    setWalletAmount(0);
    setInvoiceDiscount(0);
    setServiceFee(0);
    handleClearSelectedCustomer();
    setRecentOperationsOpen(false);
    toast.success(`تم إنشاء الاستبدال للفاتورة ${order?.invoice_number || order?.id || ""}. أضف المنتج البديل إلى السلة كبيع جديد بقيمة مرتجع ${formatCurrency(returnTotal, "ar")}`);
  };

  const clearEditMode = () => {
    setEditingOrder(null);
    setInvoiceNumber(generateInvoiceNumber());
  };

  const handleCreateCustomer = async () => {
    const name = quickCustomer.name.trim();
    if (!name) {
      toast.error("Customer name is required");
      return false;
    }

    const normalizedPhone = normalizeReceiptPhone(quickCustomer.phone);
    if (quickCustomer.phone && !normalizedPhone) {
      toast.error("Enter a valid customer phone number");
      return false;
    }

    try {
      const result = await api.post("/customers", {
        name,
        phone: normalizedPhone,
      });

      const payload = result?.data ?? result;
      const createdCustomer = payload?.data ?? payload?.customer ?? payload;

      const createdCustomerId = createdCustomer?.id || createdCustomer?.customer_id;
      if (!createdCustomerId) {
        console.error("[pos] customer create response did not include an id:", result);
        toast.error("Customer was not returned by the server");
        await loadCustomers();
        return false;
      }

      setCustomers((prev) => {
        const safePrev = Array.isArray(prev) ? prev : [];
        const withoutDuplicate = safePrev.filter((item) => String(item?.id || item?.customer_id) !== String(createdCustomerId));
        return [createdCustomer, ...withoutDuplicate];
      });
      setSelectedCustomerId(createdCustomerId);
      setCustomerSearch(`${createdCustomer.name || ""} ${createdCustomer.phone || ""}`.trim());

      setQuickCustomer({ name: "", phone: "" });
      toast.success("Customer created");
      return true;
    } catch (err) {
      const message = getErrorMessage(err, "Unable to create customer");
      console.error("[pos] failed to create customer:", message, err);
      toast.error(message);
      return false;
    }
  };

  const handleOpenShift = async () => {
    if (!selectedAttendanceEmployeeId) {
      toast.error("Select an employee first");
      return;
    }

    if (!selectedAttendanceEmployee?.branch_id) {
      toast.error("Selected employee has no branch assigned");
      return;
    }

    if (!salesSettings.allow_sale_without_salesperson && !selectedSalespersonId) {
      toast.error("Select a salesperson before checkout");
      return;
    }

    try {
      setAttendanceLoading(true);
      const checkInResponse = await checkInEmployee({
        employee_id: selectedAttendanceEmployeeId,
        attendance_source: "pos",
        notes: "Opened from POS",
        shift_id: attendanceSnapshot?.current_shift?.id || null,
      });
      if (checkInResponse?.alreadyOpen) {
        const existingLog = checkInResponse?.data || checkInResponse?.attendance || null;
        setAttendanceSnapshot((prev) => ({
          ...(prev || {}),
          today_attendance: existingLog,
        }));
        toast.success("Shift already open");
      } else {
        toast.success("Shift opened");
      }
      const response = await getAttendanceKioskSnapshot({ employeeId: selectedAttendanceEmployeeId });
      setAttendanceSnapshot(response?.data || response || null);
      await loadAttendanceEmployees();
    } catch (err) {
      console.error("[pos] failed to open shift:", err);
      toast.error(err?.message || t("pos.shift.noBranchMessage"));
    } finally {
      setAttendanceLoading(false);
    }
  };

  const handleCloseShift = async () => {
    if (!selectedAttendanceEmployeeId) {
      toast.error("Select an employee first");
      return;
    }

    try {
      setAttendanceLoading(true);
      const attendanceLogId = attendanceSnapshot?.today_attendance?.id || null;
      let closeReport = null;
      if (attendanceLogId) {
        const reportResponse = await api.get(`/orders/shift-report/${attendanceLogId}`);
        closeReport = reportResponse?.report || reportResponse?.data?.report || null;
      }
      const rotation = await loadOpeningRotation();
      const candidates = Array.isArray(rotation?.candidates) ? rotation.candidates : rotation?.data?.candidates || [];
      const recommended = rotation?.recommended || rotation?.data?.recommended || candidates.find((item) => item.is_recommended) || candidates[0] || null;
      setShiftCloseReport(closeReport);
      setActualDrawerAmount(String(closeReport?.expectedDrawer ?? 0));
      setSelectedNextOpeningEmployeeId(recommended?.id || recommended?.employee_id ? String(recommended.id || recommended.employee_id) : "");
      setShiftCloseOpen(true);
    } catch (err) {
      console.error("[pos] failed to close shift:", err);
      toast.error(err?.message || "Failed to close shift");
    } finally {
      setAttendanceLoading(false);
    }
  };

  const handleConfirmCloseShift = async () => {
    if (shiftCloseSubmitting) return;

    if (openingCandidates.length > 0 && !selectedNextOpeningEmployeeId) {
      toast.error("Select who will open the next shift");
      return;
    }

    try {
      setShiftCloseSubmitting(true);
      const attendanceLogId = attendanceSnapshot?.today_attendance?.id || null;
      const actualDrawer = actualDrawerAmount === "" ? null : Number(actualDrawerAmount);
      await checkOutEmployee({
        employee_id: selectedAttendanceEmployeeId,
        attendance_log_id: attendanceLogId,
        next_opening_employee_id: selectedNextOpeningEmployeeId || null,
        next_opening_note: "Assigned during POS shift close",
        notes: selectedNextOpeningEmployee
          ? `Closed from POS\nNext opening staff: ${selectedNextOpeningEmployee.full_name}`
          : "Closed from POS",
      });

      if (shiftCloseReport) {
        setShiftReport({
          ...shiftCloseReport,
          actualDrawer,
          difference: actualDrawer === null || Number.isNaN(actualDrawer) ? null : actualDrawer - Number(shiftCloseReport.expectedDrawer || 0),
          nextOpeningEmployeeName: selectedNextOpeningEmployee?.full_name || "",
        });
        setShiftReportOpen(true);
      }

      toast.success(
        selectedNextOpeningEmployee
          ? `Shift closed. Next opening staff: ${selectedNextOpeningEmployee.full_name}`
          : "Shift closed"
      );
      setShiftCloseOpen(false);
      setShiftCloseReport(null);
      setActualDrawerAmount("");
      setSelectedNextOpeningEmployeeId("");
      const response = await getAttendanceKioskSnapshot({ employeeId: selectedAttendanceEmployeeId });
      setAttendanceSnapshot(response?.data || response || null);
      await loadAttendanceEmployees();
      await loadOpeningRotation();
    } catch (err) {
      console.error("[pos] failed to confirm shift close:", err);
      toast.error(err?.message || "Failed to close shift");
    } finally {
      setShiftCloseSubmitting(false);
    }
  };

  const handleCheckout = async () => {
    if (checkoutLoading) {
      return;
    }

    if (cart.length === 0) {
      toast.error("Cart is empty");
      return;
    }

    if (!loyaltyUnavailable && Number(loyaltyRedeemPoints || 0) > 0 && loyaltyValidation && loyaltyValidation.valid === false) {
      toast.error("Requested loyalty points exceed the allowed balance");
      return;
    }

    if (!isShiftActive) {
      toast.error("Open a POS shift before checkout");
      return;
    }

    if (!selectedAttendanceEmployee?.branch_id) {
      toast.error("Selected employee has no branch assigned");
      return;
    }

    const missingFullVariant = cart.find(
      (item) => isFullVariationMode(item.variation_mode) && !resolveCheckoutVariantId(item)
    );
    if (missingFullVariant) {
      toast.error("Please select color and size before checkout.");
      return;
    }

    const invalidCartItem = cart.find((item) => {
      const quantity = Number(item.quantity || 0);
      const price = Number(item.price ?? item.unit_price ?? 0);
      const productId = item.product_id || item.productId || null;
      const variantId = resolveCheckoutVariantId(item);
      return (!productId && !variantId) || quantity <= 0 || !Number.isFinite(price) || price < 0;
    });
    if (invalidCartItem) {
      console.error("[pos] invalid checkout cart item:", {
        product_id: invalidCartItem.product_id || invalidCartItem.productId || null,
        variant_id: resolveCheckoutVariantId(invalidCartItem),
        quantity: invalidCartItem.quantity,
        price: invalidCartItem.price,
      });
      toast.error("Cart has an invalid item. Check product, quantity, and price before checkout.");
      return;
    }

    try {
      setCheckoutLoading(true);
      const invoiceCustomer = customer || WALK_IN_CUSTOMER;
      const customerId = customer ? customer.id || customer.customer_id : null;

      if (customer && !customerId) {
        console.error("[pos] selected customer is missing id/customer_id at checkout:", customer);
        toast.error("Selected customer is missing an ID. Re-select the customer before checkout.");
        return;
      }

      const payload = {
        customer_name: invoiceCustomer.name,
        customer_id: customerId || null,
        customer_phone: customer?.phone || "",
        payment_method: paymentMode,
        invoice_number: invoiceNumber,
        subtotal: cartTotals.subtotal,
        discount_amount: cartTotals.itemDiscountTotal + cartTotals.invoiceDiscount,
        coupon_code: couponValidation?.valid ? couponValidation.coupon?.code || couponCode : null,
        coupon_discount_amount: couponValidation?.valid ? Number(couponValidation.discount_amount || 0) : 0,
        loyalty_points_redeemed: loyaltyUnavailable ? 0 : Number(loyaltyValidation?.applied_points || loyaltyRedeemPoints || 0),
        loyalty_discount_amount: loyaltyUnavailable ? 0 : Number(loyaltyValidation?.applied_amount || 0),
        wallet_amount: Number(walletAmount || 0),
        full_wallet_redemption_only: paymentMode === "wallet" && Number(walletAmount || 0) >= Number(cartTotals.total || 0),
        tax_amount: 0,
        tax_rate: 0,
        service_fee: cartTotals.serviceFee,
        total: cartTotals.total,
        paid_amount: paymentSummary.paidAmount,
        change_amount: paymentSummary.changeAmount,
        status: paymentSummary.paymentStatus,
        payment_status: paymentSummary.paymentStatus,
        branch_id: selectedAttendanceEmployee.branch_id,
        cash_amount: paymentMode === "cash" ? paymentSummary.paidAmount : Number(cashAmount || 0),
        card_amount: paymentMode === "card" ? paymentSummary.paidAmount : Number(cardAmount || 0),
        wallet_payment_amount: paymentMode === "wallet" ? paymentSummary.paidAmount : Number(walletAmount || 0),
        cashier_id: selectedAttendanceEmployeeId || null,
        sales_employee_id: selectedSalespersonId || null,
        salesperson_id: selectedSalespersonId || null,
        attendance_log_id: attendanceSnapshot?.today_attendance?.id || null,
        ...resolveMarketingAttributionPayload(marketingAttribution),
        items: cart.map((item) => ({
          product_id: item.product_id || null,
          product_name: item.product_name || item.name || "",
          variant_id: resolveCheckoutVariantId(item),
          variant_name: [item.color, item.size].filter(Boolean).join(" / "),
          variation_mode: item.variation_mode || "full_variations",
          sku: item.sku || "",
          barcode: item.barcode || "",
          quantity: Number(item.quantity || 0),
          price: Number(item.price || 0),
          discount_amount: Number(item.discount_amount ?? Number(item.lineDiscount || 0) * Number(item.quantity || 0)),
          tax_amount: 0,
          tax_rate: 0,
          total_amount: Math.max(
            0,
            Number(item.price || 0) * Number(item.quantity || 0) -
              Number(item.discount_amount ?? Number(item.lineDiscount || 0) * Number(item.quantity || 0))
          ),
        })),
      };

      if (import.meta.env.DEV) {
        console.log("[pos] final checkout payload", {
          ...payload,
          customer_phone: payload.customer_phone ? "[redacted]" : "",
        });
      }

      if (editingOrder?.id) {
        const response = await api.patch(`/orders/${editingOrder.id}/edit`, {
          ...payload,
          reason: `POS edit for invoice ${editingOrder.invoice_number || editingOrder.id}`,
        }, { timeoutMs: 30000 });
        const updatedOrder = response.order || {};
        setLastOrder({
          ...editingOrder,
          ...updatedOrder,
          items: response.items || payload.items,
          cart: [...cart],
          invoice_number: updatedOrder.invoice_number || editingOrder.invoice_number,
          invoiceNumber: updatedOrder.invoice_number || editingOrder.invoice_number,
        });
        setLastShareContext({
          ...editingOrder,
          ...updatedOrder,
          invoiceNumber: updatedOrder.invoice_number || editingOrder.invoice_number,
        });
        toast.success("تم حفظ تعديل الفاتورة بنجاح");
        setProducts((current) => applySoldItemsToCatalog(current, []));
        setCart([]);
        clearPosPersistedState();
        setCashAmount(0);
        setCardAmount(0);
        setWalletAmount(0);
        setInvoiceDiscount(0);
        setServiceFee(0);
        handleRemoveCoupon();
        handleClearSelectedCustomer();
        clearEditMode();
        await refreshCatalogProducts({ setProducts, setLoading, manageLoading: false });
        return;
      }

      const response = await api.post("/orders", payload, { timeoutMs: 30000 });
      const normalizedResponse = normalizeCheckoutOrderResponse(response);
      const loyaltyResult = normalizedResponse.loyalty || {};
      const walletResult = normalizedResponse.wallet || {};
      const soldItems = [...cart];
      const nextInvoice =
        normalizedResponse.invoiceNumber ||
        (normalizedResponse.orderId ? `INV-${String(normalizedResponse.orderId).padStart(6, "0")}` : generateInvoiceNumber());
      const normalizedOrder = {
        ...normalizedResponse.data,
        ...normalizedResponse.order,
        rawResponse: normalizedResponse.raw,
        id: normalizedResponse.orderId,
        order_id: normalizedResponse.orderId,
        orderId: normalizedResponse.orderId,
        public_token: normalizedResponse.publicToken || "",
        publicToken: normalizedResponse.publicToken || "",
        invoice_number: nextInvoice || "",
        invoiceNumber: nextInvoice || "",
        public_invoice_url: normalizedResponse.publicInvoiceUrl || "",
        public_invoice_short_url: normalizedResponse.publicInvoiceShortUrl || "",
        customerName: invoiceCustomer.name,
        customerPhone: normalizeReceiptPhone(customer?.phone || "") || customer?.phone || "",
        total: cartTotals.total,
        totals: cartTotals,
        coupon: normalizedResponse.raw?.coupon || normalizedResponse.data?.coupon || null,
        paymentStatus: paymentSummary.paymentStatus,
        payment: {
          method: paymentMode,
          paymentStatus: paymentSummary.paymentStatus,
          paidAmount: paymentSummary.paidAmount,
          dueAmount: paymentSummary.dueAmount,
          changeAmount: paymentSummary.changeAmount,
          walletAmount: Number(walletResult?.redeemedAmount || walletAmount || 0),
          remainingCashOrCard: Math.max(0, Number(cartTotals.total || 0) - Number(walletResult?.redeemedAmount || walletAmount || 0)),
          walletBalanceAfter: Number(loyaltyResult?.walletBalance ?? walletResult?.balance ?? 0),
          cashAmount: Number(cashAmount || 0),
          cardAmount: Number(cardAmount || 0),
        },
        cart: [...cart],
        items: [...cart],
        loyalty: {
          pointsRedeemed: Number(loyaltyResult?.pointsRedeemed || loyaltyValidation?.applied_points || loyaltyRedeemPoints || 0),
          pointsEarned: Number(loyaltyResult?.pointsEarned || 0),
          remainingPoints: Number(loyaltyResult?.availablePoints ?? loyaltyProfile?.available_points ?? 0),
          tier: loyaltyResult?.tier || loyaltyProfile?.tier || "Bronze",
          cashbackAmount: Number(loyaltyResult?.cashbackAmount || walletResult?.cashbackAmount || 0),
          walletBalance: Number(loyaltyResult?.walletBalance ?? walletResult?.balance ?? 0),
        },
      };
      if (!normalizedOrder.public_invoice_url && normalizedOrder.public_token && typeof window !== "undefined" && window.location?.origin) {
        normalizedOrder.public_invoice_url = `${window.location.origin.replace(/\/$/, "")}/invoice/${encodeURIComponent(normalizedOrder.public_token)}`;
      }
      if (!normalizedOrder.public_invoice_short_url) {
        normalizedOrder.public_invoice_short_url = normalizedOrder.public_invoice_url;
      }
      normalizedOrder.invoiceUrl = normalizedOrder.public_invoice_url;
      normalizedOrder.invoice_url = normalizedOrder.public_invoice_url;
      normalizedOrder.publicInvoiceUrl = normalizedOrder.public_invoice_url;
      normalizedOrder.shortInvoiceUrl = normalizedOrder.public_invoice_short_url;
      normalizedOrder.short_invoice_url = normalizedOrder.public_invoice_short_url;
      normalizedOrder.publicToken = normalizedOrder.public_token;
      setLastOrder(normalizedOrder);
      setLastShareContext(normalizedOrder);
      console.log("[saved normalized order]", normalizedOrder);
      setInvoiceNumber(nextInvoice);
      handleRemoveCoupon();

      toast.success("تم إنشاء الفاتورة بنجاح");
      if (Number(loyaltyResult?.pointsEarned || 0) > 0) {
        toast.success(`+${Number(loyaltyResult.pointsEarned).toLocaleString()} loyalty points earned`);
      }
      if (loyaltyResult?.tierUpgraded) {
        toast.success(`${loyaltyResult.tier} tier unlocked`);
      }
      if (Number(loyaltyResult?.cashbackAmount || walletResult?.cashbackAmount || 0) > 0) {
        toast.success(`${formatCurrency(Number(loyaltyResult?.cashbackAmount || walletResult?.cashbackAmount || 0))} cashback added`);
      }
      if (customerId) {
        const updatedCustomer = {
          ...customer,
          loyalty_points: Number(loyaltyResult?.availablePoints ?? customer.loyalty_points ?? 0),
          wallet_balance: Number(loyaltyResult?.walletBalance ?? walletResult?.balance ?? customer.wallet_balance ?? customer.balance ?? 0),
          tier: loyaltyResult?.tier || customer.tier || "Bronze",
        };
        setCustomers((current) =>
          (Array.isArray(current) ? current : []).map((item) =>
            String(item?.id || item?.customer_id) === String(customerId) ? { ...item, ...updatedCustomer } : item
          )
        );
        setLoyaltyProfile((current) => ({
          ...(current || {}),
          tier: loyaltyResult?.tier || current?.tier || "Bronze",
          available_points: Number(loyaltyResult?.availablePoints ?? current?.available_points ?? 0),
          total_points_earned: Number(current?.total_points_earned || 0) + Number(loyaltyResult?.pointsEarned || 0),
          total_points_redeemed: Number(current?.total_points_redeemed || 0) + Number(loyaltyResult?.pointsRedeemed || 0),
          wallet_balance: Number(loyaltyResult?.walletBalance ?? walletResult?.balance ?? current?.wallet_balance ?? 0),
        }));
        setLoyaltyValidation((current) => ({
          ...(current || {}),
          available_points: Number(loyaltyResult?.availablePoints ?? current?.available_points ?? 0),
        }));
      }
      setProducts((current) => applySoldItemsToCatalog(current, soldItems));
      writePosSaleStats(cart);
      setCart([]);
      clearPosPersistedState();
      setCashAmount(0);
      setCardAmount(0);
      setWalletAmount(0);
      setInvoiceDiscount(0);
      setServiceFee(0);
      setLoyaltyRedeemPoints(0);
      handleClearSelectedCustomer();
      await refreshCatalogProducts({ setProducts, setLoading, manageLoading: false });
      await loadAttendanceEmployees();
    } catch (err) {
      console.error("[pos] checkout failed:", {
        message: err?.message,
        status: err?.status || err?.response?.status,
        response: err?.response?.data || err?.responseBody,
        error: err,
      });
      const message = getErrorMessage(err, "Checkout failed. The order was not created. Please try again.");
      if (String(message).toLowerCase().includes("not enough stock")) {
        toast.error(message);
        try {
          const refreshedCatalog = await refreshCatalogProducts({ setProducts, setLoading, manageLoading: false });
          const reconciliation = reconcileCartWithCatalog(cart, refreshedCatalog);
          if (reconciliation.changed) {
            setCart(reconciliation.nextCart);
            if (reconciliation.removedItems.length > 0) {
              toast.error("Removed cart items that are no longer available.");
            }
          }
        } catch (refreshError) {
          console.error("[pos] failed to refresh catalog after stock error:", refreshError);
        }
      } else {
        toast.error(`Checkout failed: ${message}`);
      }
    } finally {
      setCheckoutLoading(false);
    }
  };

  const handlePrint = () => {
    const node = invoiceRef.current || a4Ref.current;
    if (!node) return;

    const printWindow = window.open("", "_blank", "width=420,height=720");
    if (!printWindow) {
      toast.error("Popup blocked");
      return;
    }

    const styles = Array.from(document.querySelectorAll('style, link[rel="stylesheet"]'))
      .map((element) => element.outerHTML)
      .join("\n");

    printWindow.document.write(`
      <html>
        <head>
          <title>POS Receipt</title>
          ${styles}
          <style>
            * { box-sizing: border-box; }
            body { margin: 0; padding: 14px; background: #fff; color: #111827; font-family: Arial, sans-serif; }
            .pos-receipt { width: 100%; margin: 0 auto; background: #fff !important; color: #111827 !important; border: 1px solid #bbf7d0 !important; box-shadow: none !important; page-break-inside: avoid; break-inside: avoid; }
            .pos-receipt-thermal { max-width: 80mm !important; border-radius: 0 !important; padding: 12px !important; }
            .pos-receipt-a4 { max-width: 720px !important; border-radius: 0 !important; padding: 24px !important; }
            .pos-receipt-barcode svg { display: block; width: 100%; max-width: 100%; height: auto; }
            .pos-receipt-barcode svg text { display: none; }
            .text-emerald-600, .text-emerald-700 { color: #059669 !important; }
            .bg-emerald-500, .bg-emerald-50, .bg-emerald-50\\/60 { background-color: #ecfdf5 !important; }
            .border-emerald-100, .border-emerald-200, .border-emerald-300 { border-color: #bbf7d0 !important; }
            .shadow-2xl, .shadow-black\\/20 { box-shadow: none !important; }
            svg { display: inline-block; vertical-align: middle; }
            @page { margin: 8mm; }
            @media print {
              body { padding: 0; }
              .pos-receipt { border-color: #bbf7d0 !important; }
            }
          </style>
        </head>
        <body>${node.innerHTML}</body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
    printWindow.close();
  };

  const handleDownloadPdf = async () => {
    const currentTenant = getCurrentTenant() || {};
    const currentSettings = currentTenant.settings || {};
    const storeName = currentTenant.companyName || currentTenant.company_name || currentTenant.name || "YOUR STORE";
    const snapshot = lastShareContext || {
      invoiceNumber,
      customerName: (customer || WALK_IN_CUSTOMER).name,
      customerPhone: customer?.phone || "",
      customerEmail: customer?.email || "",
      customerAddress: customer?.address || "",
      items: cart.map((item) => ({
        name: item.name,
        product_name: item.name,
        image_url: item.image_url,
        image: item.image,
        product_image: item.product_image,
        cover_image: item.cover_image,
        variant_image: item.variant_image || item.variant_image_url,
        variant_image_url: item.variant_image_url,
        thumbnail: item.thumbnail,
        color_image_url: item.color_image_url,
        images: item.images,
        gallery: item.gallery,
        product: item.product,
        variant: item.variant,
        product_variant: item.product_variant,
        color: item.color,
        product_image_url: item.product_image_url,
        color: item.color,
        size: item.size,
        sku: item.sku,
        barcode: item.barcode,
        quantity: item.quantity,
        price: item.price,
        discount_amount: item.lineDiscount * item.quantity,
        tax_amount: 0,
        total_amount: Math.max(0, item.price * item.quantity - item.lineDiscount * item.quantity),
      })),
      totals: cartTotals,
      payment: {
        paymentStatus: paymentSummary.paymentStatus,
        paidAmount: paymentSummary.paidAmount,
        dueAmount: paymentSummary.dueAmount,
        changeAmount: paymentSummary.changeAmount,
        method: paymentMode,
        walletAmount: Number(walletAmount || 0),
        remainingCashOrCard: Math.max(0, Number(cartTotals.total || 0) - Number(walletAmount || 0)),
        walletBalanceAfter: Number(loyaltyProfile?.wallet_balance || customer?.wallet_balance || customer?.balance || 0) - Number(walletAmount || 0),
        cashAmount: Number(cashAmount || 0),
        cardAmount: Number(cardAmount || 0),
      },
      loyalty: {
        tier: loyaltyProfile?.tier || "Bronze",
        pointsRedeemed: Number(loyaltyValidation?.applied_points || loyaltyRedeemPoints || 0),
        pointsEarned: loyaltyPointsToEarn,
        remainingPoints: Number(loyaltyValidation?.available_points ?? loyaltyProfile?.available_points ?? 0),
        redeemValue: Number(loyaltyValidation?.redeem_value || loyaltyProfile?.redeem_value || 0),
      },
      status: paymentSummary.paymentStatus,
      createdAt: new Date().toLocaleString(),
      companyName: storeName,
      companyTagline: currentSettings.tagline || currentSettings.companyTagline || currentTenant.tagline || "Premium Shoes",
      companyWebsite: currentSettings.website || currentTenant.website || "www.workspace.com",
      companyPhone: currentSettings.phone || currentTenant.phone || "01234567890",
      google_review_url: currentSettings.google_review_url || currentSettings.googleReviewUrl || currentTenant.google_review_url || currentTenant.googleReviewUrl || "https://www.google.com/maps/place//data=!4m3!3m2!1s0x14f9e3498b6a02f9:0xd576a0402361f8c8!12e1?source=g.page.m._&laa=merchant-review-solicitation",
      facebook_review_url: currentSettings.facebook_review_url || currentSettings.facebookReviewUrl || currentTenant.facebook_review_url || currentTenant.facebookReviewUrl || "https://www.facebook.com/MONESHOESSTORE/reviews",
      instagram_url: currentSettings.instagram_url || currentSettings.instagramUrl || currentTenant.instagram_url || currentTenant.instagramUrl || "https://www.instagram.com/m1store_eg/",
      publicInvoiceUrl: currentPublicInvoiceUrl,
      publicToken: lastOrder?.public_token || lastShareContext?.publicToken || lastShareContext?.public_token || "",
      qrValue: currentPublicInvoiceUrl || invoiceNumber,
      barcodeValue: invoiceNumber,
    };

    const result = await downloadInvoicePdf({
      format: previewMode === "thermal" ? "thermal" : "a4",
      invoice: snapshot,
      filename: `${invoiceNumber}.pdf`,
      onFallback: ({ html }) => {
        const popup = window.open("", "_blank", "width=980,height=1200");
        if (!popup) {
          toast.error("PDF preview blocked");
          return false;
        }
        popup.document.write(html);
        popup.document.close();
        popup.focus();
        popup.print();
        popup.close();
        return true;
      },
    });

    if (result?.ok) {
      toast.success("PDF generated");
    } else if (!result?.fallbackOpened) {
      toast.error("PDF export failed");
    }
  };

  const handleShareWhatsApp = () => {
    console.log("[share whatsapp clicked]");
    console.log("[share whatsapp lastOrder]", lastOrder);
    console.log("[lastOrder state]", lastOrder);
    console.log("[checkout state]", {
      invoiceNumber,
      selectedCustomerId,
      paymentMode,
      cartCount: cart.length,
      total: cartTotals.total,
      paymentStatus: paymentSummary.paymentStatus,
    });
    console.log("public_invoice_url", lastOrder?.public_invoice_url);
    console.log("public_invoice_short_url", lastOrder?.public_invoice_short_url);
    console.log("invoice_public_url", lastOrder?.invoice_public_url);
    console.log("public_token", lastOrder?.public_token);

    const currentTenant = getCurrentTenant() || {};
    const storeName = currentTenant.companyName || currentTenant.company_name || currentTenant.name || "YOUR STORE";
    const context = lastOrder;
    const normalizedPhone = normalizeReceiptPhone(context?.customerPhone);
    let invoiceUrl = resolveReceiptInvoiceUrl(context || {});

    if (!invoiceUrl) {
      const fallbackToken = String(context?.publicToken || context?.public_token || "").trim();
      if (fallbackToken && typeof window !== "undefined" && window.location?.origin) {
        invoiceUrl = `${window.location.origin.replace(/\/$/, "")}/invoice/${encodeURIComponent(fallbackToken)}`;
      } else if (fallbackToken) {
        invoiceUrl = `/invoice/${encodeURIComponent(fallbackToken)}`;
      }
    }

    if (!invoiceUrl) {
      toast.error("تعذر إنشاء رابط الفاتورة");
      return;
    }

    const message = [
      "شكراً لثقتكم بنا",
      "",
      "عرض الفاتورة:",
      invoiceUrl,
      "",
      "نتمنى لكم تجربة ممتعة",
    ].join("\n");

      const url = buildLoyaltyReceiptWhatsappUrl({
      phone: normalizedPhone || "",
      customerName: context?.customerName,
      invoiceNumber: context?.invoice_number || context?.invoiceNumber || invoiceNumber,
      totalPaid: paymentSummary.paidAmount || context?.total || cartTotals.total,
      invoiceUrl,
      paymentMethod: paymentMode,
      paymentStatus: paymentSummary.paymentStatus,
      pointsEarned: Number(context?.loyalty?.pointsEarned || 0),
      pointsRedeemed: Number(context?.loyalty?.pointsRedeemed || 0),
      remainingPoints: Number(context?.loyalty?.remainingPoints || 0),
      customerTier: context?.loyalty?.tier || "",
      companyName: storeName,
    });

    console.log("[final whatsapp message]", message);
    console.log("[final whatsapp url]", url);

    window.open(url, "_blank", "noopener,noreferrer");
  };

  const currentPublicInvoiceUrl = resolveReceiptInvoiceUrl(lastOrder || lastShareContext || {});

  const handleCopyInvoiceLink = async () => {
    if (!currentPublicInvoiceUrl) {
      toast.error("No invoice link available");
      return;
    }

    try {
      await navigator.clipboard.writeText(currentPublicInvoiceUrl);
      toast.success("Invoice link copied");
    } catch {
      toast.error("Unable to copy invoice link");
    }
  };

  const handleOpenInvoice = () => {
    if (!currentPublicInvoiceUrl) {
      toast.error("No invoice link available");
      return;
    }

    window.open(currentPublicInvoiceUrl, "_blank", "noopener,noreferrer");
  };

  const handleClearCart = () => {
    setCart([]);
    setInvoiceDiscount(0);
    setServiceFee(0);
    setCashAmount(0);
    setCardAmount(0);
    setWalletAmount(0);
    clearPosPersistedState();
    setSelectedCustomerId(null);
    setCustomerSearch("");
    setLoyaltyProfile(null);
    setLoyaltyValidation(null);
    setLoyaltyRedeemPoints(0);
    clearEditMode();
    toast.success("Cart cleared");
  };

  const handleClearSmartFilters = () => {
    setSelectedMainCategoryId("all");
    setSelectedSubCategoryId("all");
    setSelectedChildCategoryId("all");
    setSelectedBrandId("all");
    setSelectedManufacturerId("all");
    setSelectedGender("all");
    setSelectedProductType("all");
    setSelectedStyle("all");
    setSelectedGrade("all");
    setSearch("");
  };

  const handleToggleFilters = () => {
    setFiltersOpen((open) => !open);
  };

  const handleCreateCustomerFromToolbar = async () => {
    const created = await handleCreateCustomer();
    if (created) {
      setCustomerCreateOpen(false);
    }
  };

  const topSelectionInfo = useMemo(() => {
    if (!activeProduct) return null;
    const variants = Array.isArray(activeProduct.variants) ? activeProduct.variants : [];
    const colors = [...new Set(variants.map((variant) => variant.color || ""))];
    const sizes = [
      ...new Set(
        variants
          .filter((variant) => String(variant.color || "") === String(selectedColor || ""))
          .map((variant) => variant.size || "")
      ),
    ];
    return {
      colors,
      sizes,
    };
  }, [activeProduct, selectedColor]);

  if (!isShiftActive) {
    return (
      <div className="h-screen w-screen min-w-0 overflow-hidden bg-[radial-gradient(circle_at_top,_rgba(16,185,129,0.08),transparent_35%),linear-gradient(180deg,#09090b_0%,#111111_100%)] text-white">
        <div className="flex h-full w-full min-w-0 max-w-none flex-col gap-3 overflow-y-auto p-2 sm:p-3 lg:p-4">
          <div className="flex shrink-0 items-center justify-end">
            <button
              type="button"
              onClick={() => navigate("/dashboard")}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-full border border-rose-400/30 bg-rose-500/10 px-4 text-sm font-black text-rose-100 shadow-[0_0_20px_rgba(244,63,94,0.16)] transition hover:border-rose-300/50 hover:bg-rose-500/15"
            >
              <LogOut className="h-4 w-4" />
              Exit POS
            </button>
          </div>

          <ShiftGate
            employees={attendanceEmployees}
            selectedEmployeeId={selectedAttendanceEmployeeId}
            onSelectEmployee={setSelectedAttendanceEmployeeId}
            selectedEmployee={selectedAttendanceEmployee}
            attendanceSnapshot={attendanceSnapshot}
            attendanceLoading={attendanceLoading}
            onOpenShift={handleOpenShift}
          />

          {shiftReportOpen && shiftReport ? (
            <ShiftReportModal report={shiftReport} onClose={() => setShiftReportOpen(false)} />
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen min-w-0 overflow-hidden bg-[radial-gradient(circle_at_top,_rgba(16,185,129,0.08),transparent_35%),linear-gradient(180deg,#09090b_0%,#111111_100%)] text-white">
      <div className="flex h-full w-full min-w-0 max-w-none flex-col gap-3 overflow-y-auto p-2 sm:p-3 lg:p-4">
        <div className="flex shrink-0 items-center justify-end gap-2">
          <button
            type="button"
            onClick={handleCloseShift}
            disabled={attendanceLoading}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-500/10 px-4 text-sm font-black text-emerald-100 shadow-[0_0_20px_rgba(16,185,129,0.14)] transition hover:border-emerald-300/50 hover:bg-emerald-500/15 disabled:opacity-50"
          >
            <CheckCircle2 className="h-4 w-4" />
            Shift / Close Shift
          </button>
          <button
            type="button"
            onClick={() => navigate("/dashboard")}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-full border border-rose-400/30 bg-rose-500/10 px-4 text-sm font-black text-rose-100 shadow-[0_0_20px_rgba(244,63,94,0.16)] transition hover:border-rose-300/50 hover:bg-rose-500/15"
          >
            <LogOut className="h-4 w-4" />
            Exit POS
          </button>
        </div>

        <NextOpeningWidget assignment={nextOpeningAssignment} loading={openingCandidatesLoading} />

        <div className="relative z-30">
          <PosHeader
            search={search}
            setSearch={setSearch}
            searchRef={searchRef}
            filtersButtonRef={filtersButtonRef}
            filtersOpen={filtersOpen}
            activeSmartFilterCount={activeSmartFilterCount}
            onToggleFilters={handleToggleFilters}
            totals={cartTotals}
            customerSearch={customerSearch}
            setCustomerSearch={setCustomerSearch}
            customers={customers}
            selectedCustomer={
              customer
                ? {
                    ...customer,
                    loyalty_points: Number(loyaltyProfile?.available_points ?? customer.loyalty_points ?? 0),
                    loyalty_tier: loyaltyProfile?.tier || customer.loyalty_tier || customer.tier || "Bronze",
                    wallet_balance: Number(loyaltyProfile?.wallet_balance ?? customer.wallet_balance ?? customer.balance ?? 0),
                  }
                : null
            }
            selectedCustomerId={selectedCustomerId}
            onSelectCustomer={handleSelectCustomer}
            onClearCustomer={handleClearSelectedCustomer}
            onCreateCustomerClick={() => setCustomerCreateOpen(true)}
            onBarcodeSubmit={handleBarcodeSubmit}
          />

          {filtersOpen ? (
            <div
              className="fixed inset-0 z-[80] flex items-end justify-center bg-black/75 px-4 py-4 backdrop-blur-xl sm:items-center sm:py-6"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) setFiltersOpen(false);
              }}
            >
              <div
                ref={filtersPanelRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="smart-pos-filters-title"
                className="flex w-[min(1050px,calc(100vw-56px))] max-w-[calc(100vw-56px)] max-h-[84vh] flex-col overflow-hidden rounded-t-[2rem] rounded-b-[2rem] border border-white/10 bg-slate-950/95 shadow-2xl shadow-black/60 backdrop-blur-xl sm:rounded-3xl"
                onMouseDown={(event) => event.stopPropagation()}
              >
                <div className="flex items-start justify-between gap-3 border-b border-white/10 px-3 py-3 sm:px-4 sm:py-3.5">
                  <div className="min-w-0">
                    <div className="text-[10px] font-black uppercase tracking-[0.22em] text-emerald-200">SMART POS FILTERS</div>
                    <h2 id="smart-pos-filters-title" className="mt-0.5 text-lg font-black text-white sm:text-xl">
                      فلاتر POS الذكية
                    </h2>
                    <p className="mt-0.5 text-xs text-zinc-400 sm:text-sm">اختار من التصنيفات النشطة فقط.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setFiltersOpen(false)}
                    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-zinc-300 transition hover:bg-white/[0.08] hover:text-white"
                    aria-label="Close filters"
                    title="Close filters"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-3 sm:px-4 sm:py-4">
                  <div className="grid gap-2.5 xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
                    <div className="grid gap-2.5">
                    <SmartFilterRow
                      label="الجنس"
                      options={smartFilterOptions.gender}
                      value={selectedGender}
                      onChange={setSelectedGender}
                      filterKey="gender"
                      productsSource={smartFilterProductsSource}
                      smart
                    />
                    <SmartFilterRow
                      label="نوع المنتج"
                      options={smartFilterOptions.productType}
                      value={selectedProductType}
                      onChange={setSelectedProductType}
                      filterKey="productType"
                      productsSource={smartFilterProductsSource}
                      smart
                    />
                    <SmartFilterRow
                      label="الستايل"
                      options={smartFilterOptions.style}
                      value={selectedStyle}
                      onChange={setSelectedStyle}
                      filterKey="style"
                      productsSource={smartFilterProductsSource}
                      smart
                    />
                    <SmartFilterRow
                      label="الفئة"
                      options={smartFilterOptions.grade}
                      value={selectedGrade}
                      onChange={setSelectedGrade}
                      filterKey="grade"
                      productsSource={smartFilterProductsSource}
                      smart
                    />
                    </div>

                    <div className="grid gap-2.5">
                      <div className="rounded-[18px] border border-white/10 bg-white/[0.03] p-2.5">
                        <div className="mb-1.5 text-[10px] font-black uppercase tracking-[0.22em] text-zinc-500">Brand</div>
                        <select
                          value={selectedBrandId}
                          onChange={(e) => setSelectedBrandId(e.target.value)}
                          className="h-11 w-full rounded-2xl border border-white/10 bg-black/70 px-3.5 text-sm font-semibold text-white outline-none transition focus:border-emerald-400/50"
                        >
                          <option value="all">All brands</option>
                          {brandOptions.map((brand) => (
                            <option key={brand.id || brand.name} value={brand.id}>
                              {brand.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="rounded-[18px] border border-white/10 bg-white/[0.03] p-2.5">
                        <div className="mb-1.5 text-[10px] font-black uppercase tracking-[0.22em] text-zinc-500">Manufacturer</div>
                        <select
                          value={selectedManufacturerId}
                          onChange={(e) => setSelectedManufacturerId(e.target.value)}
                          className="h-11 w-full rounded-2xl border border-white/10 bg-black/70 px-3.5 text-sm font-semibold text-white outline-none transition focus:border-emerald-400/50"
                        >
                          <option value="all">All manufacturers</option>
                          {manufacturerOptions.map((manufacturer) => (
                            <option key={manufacturer.id || manufacturer.name} value={manufacturer.id}>
                              {manufacturer.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="sticky bottom-0 border-t border-white/10 bg-slate-950/95 px-3 py-3 backdrop-blur-xl sm:px-4 sm:py-3.5">
                  <div className="grid gap-2 sm:grid-cols-3">
                    <button
                      type="button"
                      onClick={() => setFiltersOpen(false)}
                      className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-4 text-sm font-black text-black transition hover:bg-emerald-400"
                    >
                      Apply Filters
                    </button>
                    <button
                      type="button"
                      onClick={handleClearSmartFilters}
                      className={`inline-flex h-11 items-center justify-center gap-2 rounded-2xl border px-4 text-sm font-black transition ${
                        activeSmartFilterCount > 0
                          ? "border-rose-400/40 bg-rose-500/15 text-rose-100 hover:bg-rose-500/25"
                          : "border-white/10 bg-white/[0.04] text-zinc-400"
                      }`}
                    >
                      <RotateCcw className="h-4 w-4" />
                      Reset
                    </button>
                    <button
                      type="button"
                      onClick={() => setFiltersOpen(false)}
                      className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-sm font-black text-zinc-200 transition hover:bg-white/[0.08] hover:text-white"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {customerCreateOpen ? (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 py-6 backdrop-blur-sm"
              onMouseDown={() => setCustomerCreateOpen(false)}
            >
              <div
                className="w-full max-w-md rounded-2xl border border-emerald-400/20 bg-slate-950/95 p-4 shadow-2xl shadow-black/50"
                onMouseDown={(event) => event.stopPropagation()}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[10px] font-black uppercase tracking-[0.22em] text-emerald-200">ADD CUSTOMER</div>
                    <h3 className="mt-1 text-lg font-black text-white">Quick customer creation</h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => setCustomerCreateOpen(false)}
                    className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-zinc-300 transition hover:bg-white/[0.08]"
                  >
                    {t("common.close")}
                  </button>
                </div>

                <div className="mt-4 space-y-3">
                  <label className="block">
                    <div className="mb-2 text-[11px] font-black uppercase tracking-[0.18em] text-zinc-500">Customer Name</div>
                    <input
                      value={quickCustomer.name}
                      onChange={(e) => setQuickCustomer((prev) => ({ ...prev, name: e.target.value }))}
                      className="h-12 w-full rounded-2xl border border-white/10 bg-black/70 px-4 text-sm text-white outline-none placeholder:text-zinc-500 focus:border-emerald-400/50"
                      placeholder="Enter customer name"
                    />
                  </label>

                  <label className="block">
                    <div className="mb-2 text-[11px] font-black uppercase tracking-[0.18em] text-zinc-500">Phone Number</div>
                    <input
                      value={quickCustomer.phone}
                      onChange={(e) => setQuickCustomer((prev) => ({ ...prev, phone: e.target.value }))}
                      className="h-12 w-full rounded-2xl border border-white/10 bg-black/70 px-4 text-sm text-white outline-none placeholder:text-zinc-500 focus:border-emerald-400/50"
                      placeholder="Enter phone number"
                    />
                  </label>

                  <div className="flex items-center justify-end gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setCustomerCreateOpen(false)}
                      className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-semibold text-zinc-300 transition hover:bg-white/[0.08]"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleCreateCustomerFromToolbar}
                      className="rounded-2xl border border-emerald-400/20 bg-emerald-400/15 px-4 py-2.5 text-sm font-semibold text-emerald-100 transition hover:bg-emerald-400/20"
                    >
                      Save customer
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        {shiftCloseOpen ? (
          <ShiftCloseModal
            report={shiftCloseReport}
            actualDrawerAmount={actualDrawerAmount}
            onActualDrawerChange={setActualDrawerAmount}
            candidates={openingCandidates}
            loading={openingCandidatesLoading}
            error={openingCandidatesError}
            selectedEmployeeId={selectedNextOpeningEmployeeId}
            onSelectEmployee={setSelectedNextOpeningEmployeeId}
            selectedEmployee={selectedNextOpeningEmployee}
            onReloadCandidates={loadOpeningRotation}
            onCancel={() => {
              if (shiftCloseSubmitting) return;
              setShiftCloseOpen(false);
            }}
            onConfirm={handleConfirmCloseShift}
            submitting={shiftCloseSubmitting}
          />
        ) : null}

        {editingOrder ? (
          <div className="rounded-3xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm font-black text-amber-100 shadow-2xl shadow-black/10" dir="rtl">
            أنت الآن تعدل فاتورة رقم {editingOrder.invoice_number || editingOrder.id}
            <button
              type="button"
              onClick={handleClearCart}
              className="mr-3 rounded-full border border-amber-200/30 bg-black/20 px-3 py-1 text-xs text-amber-50"
            >
              إلغاء التعديل
            </button>
          </div>
        ) : null}

        <div className="grid min-w-0 flex-1 gap-4 xl:min-h-0 xl:grid-cols-[minmax(0,1fr)_420px]">
          <section className="min-w-0 space-y-4 rounded-3xl border border-white/10 bg-white/5 p-4 shadow-2xl shadow-black/10 backdrop-blur">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <div className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">Product browser</div>
                <h2 className="text-2xl font-black text-white">Fast add-to-cart grid</h2>
              </div>
              <div className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-300">
                <ScanBarcode className="h-4 w-4 text-emerald-400" />
                F2 focuses search
                <span className="text-zinc-500">•</span>
                Ctrl+K focuses search
              </div>
            </div>

            <ProductGrid
              loading={loading}
              error={error}
              products={visibleProducts}
              search={search}
              onSelectProduct={handleSelectProduct}
              onQuickAdd={quickAddProduct}
            />
          </section>

          <CartSidebar
            cart={cart}
            onIncrease={handleIncrease}
            onDecrease={handleDecrease}
            onRemove={handleRemoveCartItem}
            onClear={handleClearCart}
            customer={customer}
            paymentMode={paymentMode}
            setPaymentMode={setPaymentMode}
            cashAmount={cashAmount}
            setCashAmount={setCashAmount}
            cardAmount={cardAmount}
            setCardAmount={setCardAmount}
            walletAmount={walletAmount}
            setWalletAmount={setWalletAmount}
            loyaltyProfile={loyaltyProfile}
            loyaltyValidation={loyaltyValidation}
            loyaltyUnavailable={loyaltyUnavailable}
            loyaltyRedeemPoints={loyaltyRedeemPoints}
            setLoyaltyRedeemPoints={setLoyaltyRedeemPoints}
            loyaltyDiscount={loyaltyDiscountAmount}
            loyaltyPointsToEarn={loyaltyPointsToEarn}
            walletCashbackToEarn={walletCashbackToEarn}
            totals={cartTotals}
            paymentSummary={paymentSummary}
            invoiceNumber={invoiceNumber}
            onCheckout={handleCheckout}
            onPrint={handlePrint}
            onDownloadPdf={handleDownloadPdf}
            onShareWhatsapp={handleShareWhatsApp}
            onCopyInvoiceLink={handleCopyInvoiceLink}
            onOpenInvoice={handleOpenInvoice}
            checkoutLoading={checkoutLoading}
            checkoutLabel={editingOrder ? "حفظ تعديل الفاتورة" : "Create order"}
            lastInvoiceUrl={currentPublicInvoiceUrl}
            lastInvoiceNumber={lastOrder?.invoice_number || lastShareContext?.invoiceNumber || ""}
            lastPublicToken={lastOrder?.public_token || lastOrder?.publicToken || lastShareContext?.public_token || lastShareContext?.publicToken || ""}
            lastOrderExists={Boolean(lastOrder || lastShareContext)}
            canUseOrderActions={Boolean(lastOrder?.order_id || lastOrder?.id || lastShareContext?.order_id || lastShareContext?.id)}
            marketingAttribution={marketingAttribution}
            setMarketingAttribution={setMarketingAttribution}
            invoiceRef={invoiceRef}
            a4Ref={a4Ref}
            previewMode={previewMode}
            setPreviewMode={setPreviewMode}
            onItemDiscountChange={handleItemDiscount}
            invoiceDiscount={invoiceDiscount}
            setInvoiceDiscount={setInvoiceDiscount}
            serviceFee={serviceFee}
            setServiceFee={setServiceFee}
            couponCode={couponCode}
            setCouponCode={setCouponCode}
            couponValidation={couponValidation}
            couponLoading={couponLoading}
            onApplyCoupon={handleApplyCoupon}
            onRemoveCoupon={handleRemoveCoupon}
            salesEmployees={salesEmployees}
            selectedSalespersonId={selectedSalespersonId}
            setSelectedSalespersonId={setSelectedSalespersonId}
            allowSaleWithoutSalesperson={salesSettings.allow_sale_without_salesperson}
          />
        </div>

        <button
          type="button"
          onClick={() => setRecentOperationsOpen(true)}
          className="fixed bottom-20 right-4 z-40 inline-flex items-center gap-2 rounded-full border border-emerald-300/30 bg-zinc-950/95 px-4 py-3 text-sm font-black text-emerald-100 shadow-2xl shadow-black/40 transition hover:border-emerald-200/50 hover:bg-emerald-500/10 sm:bottom-4 sm:right-44"
          dir="rtl"
        >
          <History className="h-4 w-4" />
          العمليات الأخيرة
        </button>

        <RecentOperationsDrawer
          open={recentOperationsOpen}
          onClose={() => setRecentOperationsOpen(false)}
          onEditOrder={handleEditRecentOrder}
          onResellOrder={handleResellRecentOrder}
          onExchangeStarted={handleExchangeStarted}
          currentCartTotal={cartTotals.total}
        />

        {selectedProduct && topSelectionInfo ? (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 px-4 py-6 lg:items-center">
            <div className="w-full max-w-5xl rounded-[2rem] border border-white/10 bg-zinc-950 p-5 shadow-2xl shadow-black/50">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">{t("pos.labels.variantSelection")}</div>
                  <h3 className="text-2xl font-black text-white">{activeProduct.name}</h3>
                  <p className="mt-1 text-sm text-zinc-400">
                    {t("pos.labels.chooseVariantPrompt")}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedProduct(null)}
                  className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white transition hover:bg-white/10"
                >
                  {t("common.close")}
                </button>
              </div>

              <div className="mt-5 grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
                <div className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
                      <div className="text-xs uppercase tracking-[0.18em] text-zinc-500">{t("pos.labels.color")}</div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {topSelectionInfo.colors.map((color) => (
                          <button
                            key={color || "default"}
                            type="button"
                          onClick={() => {
                            setSelectedColor(color);
                            const firstForColor = (activeProduct.variants || []).find(
                              (variant) =>
                                String(variant.color || "") === String(color || "") &&
                                normalizeStockQuantity(variant.stock_quantity ?? variant.stock) > 0
                            ) || (activeProduct.variants || []).find(
                              (variant) => String(variant.color || "") === String(color || "")
                            );
                            setSelectedSize(firstForColor?.size || "");
                            }}
                            className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                              selectedColor === color
                                ? "bg-emerald-500 text-black"
                                : "border border-white/10 bg-black/30 text-white hover:bg-white/10"
                            }`}
                          >
                            {color || t("pos.labels.default")}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
                      <div className="text-xs uppercase tracking-[0.18em] text-zinc-500">{t("pos.labels.size")}</div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {topSelectionInfo.sizes.map((size) => {
                          const sizeVariant = (activeProduct.variants || []).find(
                            (variant) =>
                              String(variant.color || "") === String(selectedColor || "") &&
                              String(variant.size || "") === String(size || "")
                          );
                          const disabled = !sizeVariant || normalizeStockQuantity(sizeVariant.stock_quantity ?? sizeVariant.stock) <= 0;
                          return (
                            <button
                            key={size || "one-size"}
                            type="button"
                            onClick={() => setSelectedSize(size)}
                            disabled={disabled}
                            className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                              selectedSize === size
                                ? "bg-emerald-500 text-black"
                                : disabled
                                  ? "cursor-not-allowed border border-white/5 bg-black/20 text-zinc-600"
                                  : "border border-white/10 bg-black/30 text-white hover:bg-white/10"
                            }`}
                          >
                            {size || t("pos.labels.oneSize")}
                          </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  <div className="overflow-hidden rounded-3xl border border-white/10">
                    <div className="grid grid-cols-[1.5fr_0.8fr_0.8fr_0.8fr_0.8fr] bg-white/5 px-4 py-3 text-xs uppercase tracking-[0.16em] text-zinc-500">
                      <span>{t("pos.labels.variant")}</span>
                      <span>{t("pos.labels.sku")}</span>
                      <span>{t("pos.labels.barcode")}</span>
                      <span>{t("pos.labels.stock")}</span>
                      <span>{t("pos.labels.action")}</span>
                    </div>
                    <div className="max-h-[28rem] overflow-auto bg-zinc-950">
                      {(activeProduct.variants || []).map((variant) => {
                        const selected =
                          String(variant.color || "") === String(selectedColor || "") &&
                          String(variant.size || "") === String(selectedSize || "");
                        return (
                          <div
                            key={String(variant.variant_id || variant.id)}
                            className={`grid grid-cols-[1.5fr_0.8fr_0.8fr_0.8fr_0.8fr] items-center gap-3 border-t border-white/5 px-4 py-3 text-sm ${
                              selected ? "bg-emerald-500/10" : ""
                            }`}
                          >
                            <div>
                              <div className="font-semibold text-white">
                                {variant.color || t("pos.labels.default")} / {variant.size || t("pos.labels.oneSize")}
                              </div>
                              <div className="text-xs text-zinc-500">
                                {formatCurrency(variant.price || activeProduct.sale_price || 0)}
                              </div>
                            </div>
                            <div className="text-zinc-300">{variant.sku || activeProduct.sku}</div>
                            <div className="text-zinc-300">{variant.barcode || activeProduct.barcode || t("common.notAvailable")}</div>
                            <div className="text-zinc-300">{normalizeStockQuantity(variant.stock_quantity ?? variant.stock)}</div>
                            <button
                              type="button"
                              onClick={() => addVariantToCart(activeProduct, variant)}
                              disabled={normalizeStockQuantity(variant.stock_quantity ?? variant.stock) <= 0}
                              className="inline-flex items-center justify-center rounded-2xl bg-emerald-500 px-3 py-2 text-xs font-black text-black transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {t("pos.labels.add")}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="overflow-hidden rounded-3xl border border-white/10 bg-white/5">
                    {activeVariant?.image_url || activeVariant?.primary_image_url || activeProduct.image_url ? (
                      <img
                        src={activeVariant?.image_url || activeVariant?.primary_image_url || activeProduct.image_url}
                        alt={activeProduct.name}
                        loading="lazy"
                        className="h-64 w-full object-contain p-4"
                        onError={(event) => {
                          event.currentTarget.style.display = "none";
                        }}
                      />
                    ) : (
                      <div className="flex h-64 items-center justify-center text-sm text-zinc-500">{t("pos.labels.noImage")}</div>
                    )}
                  </div>

                  <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
                    <div className="text-xs uppercase tracking-[0.18em] text-zinc-500">{t("pos.labels.selectedVariant")}</div>
                    <div className="mt-2 text-xl font-black text-white">
                      {activeVariant?.color || t("pos.labels.default")} / {activeVariant?.size || t("pos.labels.oneSize")}
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                      <SmallCard label={t("pos.labels.price")} value={formatCurrency(activeVariant?.price || 0)} />
                      <SmallCard label={t("pos.labels.stock")} value={String(normalizeStockQuantity(activeVariant?.stock_quantity ?? activeVariant?.stock))} />
                      <SmallCard label={t("pos.labels.sku")} value={activeVariant?.sku || t("common.notAvailable")} />
                      <SmallCard label={t("pos.labels.barcode")} value={activeVariant?.barcode || t("common.notAvailable")} />
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      if (activeVariant) addVariantToCart(activeProduct, activeVariant);
                      setSelectedProduct(null);
                    }}
                    disabled={!activeVariant || normalizeStockQuantity(activeVariant.stock_quantity ?? activeVariant.stock) <= 0}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-3xl bg-emerald-500 px-4 py-4 text-sm font-black text-black transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {t("pos.labels.addSelectedVariant")}
                    <ChevronRight className="h-4 w-4" />
                  </button>

                  <div className="rounded-3xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-100">
                    <div className="flex items-center gap-2 font-semibold">
                      <AlertTriangle className="h-4 w-4" />
                      {t("pos.labels.stockNote")}
                    </div>
                    <p className="mt-2 text-amber-50/80">
                      {t("pos.labels.stockNoteBody")}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {barcodeShopProduct ? (
          <ProductAvailabilityModal
            product={liveBarcodeShopProduct}
            onClose={() => setBarcodeShopProduct(null)}
            onAddVariant={addVariantToCart}
          />
        ) : null}

        {loading ? (
          <div className="fixed bottom-4 right-4 rounded-full border border-white/10 bg-zinc-950 px-4 py-3 text-sm text-zinc-300 shadow-2xl shadow-black/30">
            <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
            {t("pos.labels.syncingCatalog")}
          </div>
        ) : null}

        <div className="fixed bottom-4 left-4 hidden rounded-full border border-white/10 bg-zinc-950 px-4 py-3 text-xs text-zinc-400 shadow-2xl shadow-black/30 xl:block">
          <span className="font-semibold text-zinc-200">{t("pos.labels.tip")}</span> {t("pos.labels.tipBody")}
        </div>

        <button
          type="button"
          onClick={handleShareWhatsApp}
          className="fixed bottom-4 right-4 inline-flex items-center gap-2 rounded-full bg-emerald-500 px-4 py-3 text-sm font-black text-black shadow-2xl shadow-emerald-950/40 transition hover:bg-emerald-400"
        >
          <MessageCircle className="h-4 w-4" />
          {t("pos.labels.whatsappInvoice")}
        </button>
      </div>
    </div>
  );
}

function ShiftGate({
  employees,
  selectedEmployeeId,
  onSelectEmployee,
  selectedEmployee,
  attendanceSnapshot,
  attendanceLoading,
  onOpenShift,
}) {
  const { t } = useTranslation();
  const branchName = selectedEmployee?.branch_name || attendanceSnapshot?.branch_name || "";
  const hasBranch = Boolean(selectedEmployee?.branch_id);

  return (
    <div className="flex flex-1 items-center justify-center px-2 py-8">
      <section className="w-full max-w-3xl rounded-3xl border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/30">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.2em] text-emerald-200">
              <ShieldCheck className="h-4 w-4" />
              {t("pos.shift.gate")}
            </div>
            <h1 className="mt-3 text-3xl font-black text-white">{t("pos.shift.openShift")}</h1>
            <p className="mt-2 text-sm text-zinc-400">
              {t("pos.shift.instruction")}
            </p>
          </div>
          <Clock3 className="h-6 w-6 text-emerald-300" />
        </div>

        <div className="mt-6 grid gap-4">
          <label className="block">
            <div className="mb-2 text-[11px] font-black uppercase tracking-[0.18em] text-zinc-500">{t("pos.shift.employee")}</div>
            <select
              value={selectedEmployeeId}
              onChange={(e) => onSelectEmployee(e.target.value)}
              className="h-12 w-full rounded-2xl border border-white/10 bg-black/50 px-4 text-sm font-semibold text-white outline-none transition focus:border-emerald-400/50"
            >
              <option value="">{t("pos.shift.selectEmployee")}</option>
              {employees.map((employee) => (
                <option key={String(employee.id)} value={employee.id}>
                  {employee.full_name}
                </option>
              ))}
            </select>
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
              <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.16em] text-zinc-500">
                <Warehouse className="h-4 w-4" />
                {t("pos.shift.assignedBranch")}
              </div>
              <div className="mt-2 text-lg font-black text-white">{branchName || t("pos.shift.noBranchAssigned")}</div>
              <div className="mt-1 text-xs text-zinc-500">{t("pos.shift.readOnly")}</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
              <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.16em] text-zinc-500">
                <Clock3 className="h-4 w-4" />
                {t("pos.shift.status")}
              </div>
              <div className="mt-2 text-lg font-black text-white">
                {attendanceLoading ? t("pos.shift.loading") : attendanceSnapshot?.today_attendance?.check_out ? t("pos.shift.closed") : t("pos.shift.notOpen")}
              </div>
              <div className="mt-1 text-xs text-zinc-500">
                {attendanceSnapshot?.current_shift?.shift_name || t("pos.shift.noTemplate")}
              </div>
            </div>
          </div>

          {!hasBranch && selectedEmployee ? (
            <div className="rounded-2xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm font-semibold text-amber-100">
              {t("pos.shift.noBranchMessage")}
            </div>
          ) : null}

          <button
            type="button"
            onClick={onOpenShift}
            disabled={attendanceLoading || !selectedEmployeeId || !hasBranch}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-5 text-sm font-black text-black transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {attendanceLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Banknote className="h-4 w-4" />}
            {t("pos.shift.open")}
          </button>
        </div>
      </section>
    </div>
  );
}

function formatOpeningDate(value) {
  if (!value) return "No history";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No history";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatOpeningDateTime(value) {
  if (!value) return "Not assigned yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not assigned yet";
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function getShiftRotationLabels(language = "en") {
  const isArabic = String(language || "").toLowerCase().startsWith("ar");
  return isArabic
    ? {
        nextOpeningStaff: "مسؤول فتح الشيفت القادم",
        notAssigned: "لم يتم التحديد بعد",
        assignHint: "أغلق الشيفت لتحديد مسؤول الفتح القادم",
        assigned: "تم التحديد",
        by: "بواسطة",
        shiftClose: "إغلاق الشيفت",
        title: "من سيفتح الشيفت القادم؟",
        helper: "يمكن اختيار أي موظف يدوياً. الترشيح يعتمد على أقدم تاريخ فتح.",
        drawerSummary: "ملخص الدرج",
        expectedDrawer: "المتوقع في الدرج",
        actualDrawer: "المبلغ الفعلي",
        notSelected: "لم يتم الاختيار",
        candidates: "الموظفون المتاحون",
        scheduleHint: "فتح: 12:00-22:00. عادي: 15:00-01:00. المتوقع: 10 ساعات.",
        refresh: "تحديث",
        recommended: "مرشح",
        activeEmployee: "موظف نشط",
        lastOpening: "آخر فتح",
        weekMonth: "الأسبوع / الشهر",
        attendance: "الحضور",
        noHistory: "لا يوجد سجل",
        empty: "لا يوجد موظفون نشطون متاحون. يمكن إغلاق الشيفت بدون تحديد مسؤول فتح، وسيظهر ذلك في لوحة المتابعة.",
        cancel: "إلغاء",
        closeShift: "إغلاق الشيفت",
      }
    : {
        nextOpeningStaff: "Next opening staff",
        notAssigned: "Not assigned yet",
        assignHint: "Close a shift to assign the next opener",
        assigned: "Assigned",
        by: "by",
        shiftClose: "Shift close",
        title: "Who will open the next shift?",
        helper: "Manual override is allowed. The recommendation uses the oldest last opening date.",
        drawerSummary: "Drawer summary",
        expectedDrawer: "Expected drawer",
        actualDrawer: "Actual drawer",
        notSelected: "Not selected",
        candidates: "Opening candidates",
        scheduleHint: "Opening: 12:00-22:00. Regular: 15:00-01:00. Expected: 10h.",
        refresh: "Refresh",
        recommended: "Recommended",
        activeEmployee: "Active employee",
        lastOpening: "Last opening",
        weekMonth: "Week / Month",
        attendance: "Attendance",
        noHistory: "No history",
        empty: "No active employees are available. You can close the shift without a next opener, but the dashboard will show no assignment.",
        cancel: "Cancel",
        closeShift: "Close shift",
      };
}

function NextOpeningWidget({ assignment, loading }) {
  const { i18n } = useTranslation();
  const labels = getShiftRotationLabels(i18n.language);
  const isArabic = String(i18n.language || "").toLowerCase().startsWith("ar");

  return (
    <section dir={isArabic ? "rtl" : "ltr"} className="grid gap-2 rounded-[22px] border border-white/10 bg-zinc-950/70 p-3 shadow-xl shadow-black/20 sm:max-w-md">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.18em] text-emerald-200">
          <UserCheck className="h-4 w-4" />
          {labels.nextOpeningStaff}
        </div>
        {loading ? <Loader2 className="h-4 w-4 animate-spin text-emerald-200" /> : null}
      </div>
      <div className="text-lg font-black text-white">{assignment?.employee_name || labels.notAssigned}</div>
      <div className="text-xs font-semibold text-zinc-400">
        {assignment?.assigned_at ? `${labels.assigned} ${formatOpeningDateTime(assignment.assigned_at)}` : labels.assignHint}
        {assignment?.assigned_by_name ? ` ${labels.by} ${assignment.assigned_by_name}` : ""}
      </div>
    </section>
  );
}

function ShiftCloseModal({
  report,
  actualDrawerAmount,
  onActualDrawerChange,
  candidates,
  loading,
  error,
  selectedEmployeeId,
  onSelectEmployee,
  selectedEmployee,
  onReloadCandidates,
  onCancel,
  onConfirm,
  submitting,
}) {
  const { i18n } = useTranslation();
  const labels = getShiftRotationLabels(i18n.language);
  const isArabic = String(i18n.language || "").toLowerCase().startsWith("ar");
  const expectedDrawer = Number(report?.expectedDrawer || 0);
  const hasCandidates = Array.isArray(candidates) && candidates.length > 0;

  return (
    <div className="fixed inset-0 z-[95] flex items-end justify-center bg-black/75 px-2 py-2 backdrop-blur-sm sm:items-center sm:px-3 sm:py-5">
      <div dir={isArabic ? "rtl" : "ltr"} className="max-h-[96vh] w-full max-w-5xl overflow-y-auto rounded-3xl border border-white/10 bg-zinc-950 p-3 shadow-2xl shadow-black/60 sm:max-h-[92vh] sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.2em] text-emerald-200">
              <CheckCircle2 className="h-4 w-4" />
              {labels.shiftClose}
            </div>
            <h2 className="mt-2 text-xl font-black text-white sm:text-2xl">{labels.title}</h2>
            <p className="mt-1 text-sm font-semibold text-zinc-400">
              {labels.helper}
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="inline-flex h-10 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-sm font-black text-zinc-200 transition hover:bg-white/[0.08] disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-[0.85fr_1.4fr]">
          <section className="rounded-[22px] border border-white/10 bg-white/[0.04] p-4">
            <div className="text-[11px] font-black uppercase tracking-[0.18em] text-zinc-500">{labels.drawerSummary}</div>
            <div className="mt-3 grid gap-3">
              <ShiftReportItem label={labels.expectedDrawer} value={formatCurrency(expectedDrawer)} />
              <label className="block rounded-2xl border border-white/10 bg-black/30 p-4">
                <span className="text-[11px] font-black uppercase tracking-[0.16em] text-zinc-500">{labels.actualDrawer}</span>
                <input
                  type="number"
                  value={actualDrawerAmount}
                  onChange={(event) => onActualDrawerChange(event.target.value)}
                  className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-black/50 px-3 text-base font-black text-white outline-none transition focus:border-emerald-400/60"
                />
              </label>
              <div className="rounded-2xl border border-emerald-400/20 bg-emerald-500/10 p-4 text-sm font-bold text-emerald-100">
                {labels.nextOpeningStaff}: {selectedEmployee?.full_name || labels.notSelected}
              </div>
            </div>
          </section>

          <section className="rounded-[22px] border border-white/10 bg-white/[0.04] p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-[11px] font-black uppercase tracking-[0.18em] text-zinc-500">{labels.candidates}</div>
                <div className="mt-1 text-sm font-semibold text-zinc-400">{labels.scheduleHint}</div>
              </div>
              <button
                type="button"
                onClick={onReloadCandidates}
                disabled={loading || submitting}
                className="inline-flex h-9 items-center justify-center gap-2 rounded-full border border-white/10 bg-black/30 px-3 text-xs font-black text-zinc-200 transition hover:bg-white/[0.08] disabled:opacity-50"
              >
                {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                {labels.refresh}
              </button>
            </div>

            {loading ? (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {[1, 2, 3, 4].map((item) => (
                  <div key={item} className="h-32 animate-pulse rounded-2xl border border-white/10 bg-white/[0.06]" />
                ))}
              </div>
            ) : error ? (
              <div className="mt-4 rounded-2xl border border-rose-400/30 bg-rose-500/10 p-4 text-sm font-semibold text-rose-100">
                {error}
              </div>
            ) : hasCandidates ? (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {candidates.map((employee) => {
                  const employeeId = String(employee.id || employee.employee_id);
                  const selected = String(selectedEmployeeId) === employeeId;
                  return (
                    <button
                      key={employeeId}
                      type="button"
                      onClick={() => onSelectEmployee(employeeId)}
                      className={`min-h-32 rounded-2xl border p-4 text-left transition ${
                        selected
                          ? "border-emerald-300 bg-emerald-400/15 shadow-lg shadow-emerald-950/30"
                          : "border-white/10 bg-black/30 hover:border-emerald-300/40 hover:bg-white/[0.06]"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-base font-black text-white">{employee.full_name}</div>
                          <div className="mt-1 text-xs font-semibold text-zinc-400">{employee.role || employee.branch_name || labels.activeEmployee}</div>
                        </div>
                        {employee.is_recommended ? (
                          <span className="shrink-0 rounded-full border border-emerald-300/30 bg-emerald-400/15 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-emerald-100">
                            {labels.recommended}
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-4 grid gap-2 text-xs font-semibold text-zinc-300">
                        <div>{labels.lastOpening}: {employee.last_opening_at ? formatOpeningDate(employee.last_opening_at) : labels.noHistory}</div>
                        <div>{labels.weekMonth}: {Number(employee.openings_this_week || 0)} / {Number(employee.openings_this_month || 0)}</div>
                        <div>{labels.attendance}: {String(employee.attendance_status || "not_checked_in").replace(/_/g, " ")}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="mt-4 rounded-2xl border border-amber-400/30 bg-amber-500/10 p-4 text-sm font-semibold text-amber-100">
                {labels.empty}
              </div>
            )}
          </section>
        </div>

        <div className="sticky bottom-0 -mx-3 mt-5 flex flex-col gap-3 border-t border-white/10 bg-zinc-950/95 px-3 py-4 backdrop-blur sm:-mx-5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div className="text-sm font-bold text-zinc-300">
            {labels.nextOpeningStaff}: <span className="text-white">{selectedEmployee?.full_name || labels.notSelected}</span>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex">
            <button
              type="button"
              onClick={onCancel}
              disabled={submitting}
              className="inline-flex h-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] px-5 text-sm font-black text-zinc-200 transition hover:bg-white/[0.08] disabled:opacity-50"
            >
              {labels.cancel}
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={submitting || (hasCandidates && !selectedEmployeeId)}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-5 text-sm font-black text-black transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              {labels.closeShift}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ShiftReportModal({ report, onClose }) {
  const { t, i18n } = useTranslation();
  const labels = getShiftRotationLabels(i18n.language);
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 px-4 py-6 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-3xl border border-white/10 bg-zinc-950 p-5 shadow-2xl shadow-black/50">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-black uppercase tracking-[0.2em] text-emerald-200">{t("pos.shift.report")}</div>
            <h2 className="mt-1 text-2xl font-black text-white">{t("pos.shift.closeSummary")}</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-zinc-300">
            {t("pos.shift.close")}
          </button>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <ShiftReportItem label={t("pos.shift.sales")} value={formatCurrency(report.sales)} />
          <ShiftReportItem label="Invoices" value={Number(report.invoices || 0).toLocaleString()} />
          <ShiftReportItem label={t("pos.shift.items")} value={Number(report.items || 0).toLocaleString()} />
          <ShiftReportItem label={t("pos.shift.cash")} value={formatCurrency(report.cash)} />
          <ShiftReportItem label={t("pos.shift.card")} value={formatCurrency(report.card)} />
          <ShiftReportItem label={t("pos.shift.wallet")} value={formatCurrency(report.wallet)} />
          <ShiftReportItem label={t("pos.shift.expectedDrawer")} value={formatCurrency(report.expectedDrawer)} />
          <ShiftReportItem label={t("pos.shift.actualDrawer")} value={report.actualDrawer === null ? t("common.notAvailable") : formatCurrency(report.actualDrawer)} />
          <ShiftReportItem label={t("pos.shift.difference")} value={report.difference === null ? t("common.notAvailable") : formatCurrency(report.difference)} />
          {report.nextOpeningEmployeeName ? <ShiftReportItem label={labels.nextOpeningStaff} value={report.nextOpeningEmployeeName} /> : null}
        </div>
      </div>
    </div>
  );
}

function ShiftReportItem({ label, value }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
      <div className="text-[11px] font-black uppercase tracking-[0.16em] text-zinc-500">{label}</div>
      <div className="mt-2 text-lg font-black text-white">{value}</div>
    </div>
  );
}

function SmartFilterRow({
  label,
  options,
  value,
  onChange,
  filterKey,
  productsSource,
  smart = false,
}) {
  const { t } = useTranslation();
  const source = Array.isArray(productsSource) ? productsSource : [];
  const items = Array.isArray(options) ? options : [];
  const itemsWithCounts = smart && filterKey ? items : items;

  if (items.length === 0) return null;

  return (
    <div className="min-w-0 rounded-[18px] border border-white/10 bg-white/[0.03] p-2.5">
      <div className="mb-1.5 flex min-h-5 items-center">
        <div className="text-[10px] font-black uppercase tracking-[0.22em] text-zinc-500">{label}</div>
      </div>

      <div className="flex min-w-0 flex-wrap gap-1">
        <CategoryPill active={value === "all"} onClick={() => onChange("all")} name={t("pos.labels.all")} count={itemsWithCounts.reduce((sum, option) => sum + Number(option.count || 0), 0)} />
        {itemsWithCounts.map((option) => (
          <CategoryPill
            key={option.id}
            active={value === option.id}
            onClick={() => onChange(option.id)}
            name={option.name}
            count={option.count}
            icon={option.icon}
            color={option.color}
          />
        ))}
      </div>
    </div>
  );
}

function CategoryPill({ active, onClick, name, count, icon, color }) {
  const disabled = !active && Number.isFinite(Number(count)) && Number(count) === 0;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={!active && !disabled && color ? { borderColor: `${color}66`, color } : undefined}
      className={`inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-full border px-3 text-[11px] font-black transition duration-200 ${
        active
          ? "border-emerald-200/60 bg-gradient-to-r from-emerald-300 via-emerald-400 to-lime-300 text-emerald-950 shadow-[0_0_14px_rgba(16,185,129,0.2)]"
          : disabled
            ? "cursor-not-allowed border-white/5 bg-white/[0.02] text-zinc-600"
            : "border-white/10 bg-white/[0.04] text-zinc-200 hover:border-emerald-300/30 hover:bg-emerald-400/10 hover:text-white"
      }`}
    >
      {icon ? <span className="text-[10px] leading-none">{icon}</span> : null}
      <span>{name}</span>
      {Number.isFinite(Number(count)) ? (
        <span className={`rounded-full px-1.5 py-0.5 text-[10px] leading-none ${active ? "bg-black/10 text-emerald-950" : "bg-white/10 text-zinc-300"}`}>
          {count}
        </span>
      ) : null}
    </button>
  );
}

function SmallCard({ label, value }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-3">
      <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">{label}</div>
      <div className="mt-1 truncate text-sm font-semibold text-white">{value}</div>
    </div>
  );
}

export default POSPro;
