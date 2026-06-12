import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";

import {
  AlertTriangle,
  Barcode,
  Boxes,
  Building2,
  ChevronDown,
  ChevronUp,
  ClipboardCheck,
  Maximize2,
  Minus,
  Minimize2,
  PackagePlus,
  Percent,
  Plus,
  ReceiptText,
  Search,
  ShoppingCart,
  Trash2,
  Truck,
  X,
} from "lucide-react";

import toast from "react-hot-toast";
import { api } from "../../../shared/api/api";
import { resolveProductImageUrl } from "../../../shared/lib/imageUrls";
import FlowShell from "../components/FlowShell";
import { accountingApi } from "../../accounting/services/accountingApi";
import {
  formatCurrency,
  generateCode,
  getLocalPurchases,
  normalizePurchase,
  normalizeSupplier,
  normalizeWarehouse,
  purchaseCanEditDestructively,
  saveLocalPurchases,
} from "../lib/flowStore";

const toArray = (value) => (Array.isArray(value) ? value : []);
const money = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const safeNumericPayload = (value, fallback = 0) => {
  if (value === "" || value === null || value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const text = (value) => String(value || "").trim();
const normalizeKey = (value) => text(value).toLowerCase();
const firstText = (...values) => values.map(text).find(Boolean) || "";
const SMART_PURCHASE_DRAFT_STORAGE_KEY = "erp.purchases.smartPurchaseDraft";
const createPurchaseSaveId = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `purchase-save-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};
const normalizePaymentMethodKey = (value) => {
  const key = text(value).toLowerCase().replace(/[\s-]+/g, "_");
  if (key === "visa") return "bank_transfer";
  if (key === "bank" || key === "transfer") return "bank_transfer";
  if (key === "vodafone") return "vodafone_cash";
  if (key === "insta_pay") return "instapay";
  return key;
};
const getPurchasePaymentAccountProviderKey = (account = {}) => {
  return normalizeKey(
    firstText(
      account?.provider,
      account?.payment_provider,
      account?.account_provider,
      account?.account_type,
      account?.type,
      account?.name,
      account?.account_name
    )
  );
};
const strictMatchPurchasePaymentAccount = (account = {}, paymentMethod = "") => {
  if (!account || account.is_active === false || account.id == null) return false;
  const method = normalizePaymentMethodKey(paymentMethod);
  if (!method) return false;
  const providerKey = getPurchasePaymentAccountProviderKey(account);
  const typeKey = normalizeKey(account?.account_type || account?.type);
  const nameKey = normalizeKey(firstText(account?.name, account?.account_name));
  const haystack = [providerKey, typeKey, nameKey].filter(Boolean).join(" ");
  if (!haystack) return false;
  if (/(vodafone cash|vodafone|فودافون كاش|فودافون)/i.test(haystack)) return method === "vodafone_cash";
  if (/(instapay|insta pay|انستاباي|انستا ?باي)/i.test(haystack)) return method === "instapay";
  if (/(bank|paymob|visa|card|بنك)/i.test(haystack)) return method === "bank_transfer";
  if (/(cash drawer|cash|safe|till|drawer|خزنة|نقدية)/i.test(haystack)) return method === "cash";
  return false;
};
const matchPurchasePaymentAccount = (account = {}, paymentMethod = "") => {
  if (!account || account.is_active === false || account.id == null) return false;
  const method = normalizePaymentMethodKey(paymentMethod);
  const providerKey = getPurchasePaymentAccountProviderKey(account);
  const typeKey = normalizeKey(account?.account_type || account?.type);
  const nameKey = normalizeKey(firstText(account?.name, account?.account_name));
  const haystack = [providerKey, typeKey, nameKey].filter(Boolean).join(" ");
  if (!haystack) return false;
  if (method === "cash") return /(cash|خزنة|نقدي|safe|drawer|till)/i.test(haystack);
  if (method === "instapay") return /(instapay|insta pay|انستاباي|insta)/i.test(haystack);
  if (method === "vodafone_cash") return /(vodafone|vodafone cash|فودافون|فودافون كاش)/i.test(haystack);
  if (method === "bank_transfer") return /(bank|visa|card|paymob|بنك|بنكي)/i.test(haystack);
  return true;
};
const getAvailablePurchasePaymentAccounts = (accounts = [], paymentMethod = "") => {
  const activeAccounts = accounts.filter((account) => account && account.id != null && account.is_active !== false);
  return activeAccounts.filter((account) => strictMatchPurchasePaymentAccount(account, paymentMethod));
};
const getPurchasePaymentMethodAliases = (paymentMethod = "") => {
  const method = normalizePaymentMethodKey(paymentMethod);
  if (method === "bank_transfer") return new Set(["bank_transfer", "card"]);
  return new Set([method]);
};
const getPurchasePaymentMappingMethodKey = (mapping = {}) => normalizePaymentMethodKey(mapping.payment_method || mapping.paymentMethod || "");
const getPurchasePaymentMappingAccountId = (mapping = {}) => mapping?.financial_account_id ?? mapping?.financialAccountId ?? null;
const getPurchasePaymentMappingsFallbackAccounts = (accounts = [], paymentMethod = "") => {
  const activeAccounts = accounts.filter((account) => account && account.id != null && account.is_active !== false);
  const method = normalizePaymentMethodKey(paymentMethod);
  const matcherByMethod = {
    cash: /(cash|خزنة|نقدي|safe|drawer|till)/i,
    instapay: /(instapay|insta pay|انستاباي|insta)/i,
    vodafone_cash: /(vodafone|vodafone cash|فودافون|فودافون كاش)/i,
    bank_transfer: /(bank|visa|card|paymob|بنك|بنكي)/i,
  };
  const matcher = matcherByMethod[method];
  if (!matcher) return activeAccounts;
  const matchedAccounts = activeAccounts.filter((account) => {
    const haystack = normalizeKey(
      firstText(
        account?.provider,
        account?.payment_provider,
        account?.account_provider,
        account?.account_type,
        account?.type,
        account?.name,
        account?.account_name
      )
    );
    return matcher.test(haystack);
  });
  return matchedAccounts.length ? matchedAccounts : activeAccounts;
};
const getPurchasePaymentMappingSelection = (mappings = [], paymentMethod = "", branchId = "") => {
  const methodAliases = getPurchasePaymentMethodAliases(paymentMethod);
  const normalizedBranchId = text(branchId);
  const activeMappings = mappings.filter((mapping) => {
    if (!mapping || mapping.is_active === false) return false;
    const accountId = getPurchasePaymentMappingAccountId(mapping);
    return accountId !== null && accountId !== undefined && methodAliases.has(getPurchasePaymentMappingMethodKey(mapping));
  });
  if (!activeMappings.length) return null;
  const branchMappings = normalizedBranchId
    ? activeMappings.filter((mapping) => text(mapping.branch_id) === normalizedBranchId)
    : activeMappings.filter((mapping) => !text(mapping.branch_id));
  const ordered = branchMappings.length ? branchMappings : activeMappings.filter((mapping) => !text(mapping.branch_id) && mapping.is_default === true);
  return (ordered.length ? ordered : activeMappings).find((mapping) => mapping.is_default === true) || (ordered.length ? ordered[0] : activeMappings[0]) || null;
};
const getPurchasePaymentAccountsFromMappings = (accounts = [], mappings = [], paymentMethod = "", branchId = "") => {
  const selectedMapping = getPurchasePaymentMappingSelection(mappings, paymentMethod, branchId);
  if (!selectedMapping) return [];
  const accountId = String(getPurchasePaymentMappingAccountId(selectedMapping) || "");
  if (!accountId) return [];
  const account = accounts.find((item) => String(item?.id) === accountId && item?.is_active !== false) || null;
  return account ? [account] : [];
};
const normalizeFinancialAccount = (account = {}) => ({
  ...account,
  id: account?.id ?? account?.account_id ?? null,
  name: account?.name ?? account?.account_name ?? "",
  type: account?.type ?? account?.account_type ?? "",
  account_type: account?.account_type ?? account?.type ?? "",
});
const paymentMethodLabel = (method, isArabic) => {
  const key = normalizePaymentMethodKey(method);
  const labels = isArabic
    ? {
        cash: "نقدي (Cash)",
        vodafone_cash: "فودافون كاش (Vodafone Cash)",
        instapay: "InstaPay",
        bank_transfer: "بنك / Visa",
      }
    : {
        cash: "Cash",
        vodafone_cash: "Vodafone Cash",
        instapay: "InstaPay",
        bank_transfer: "Bank / Visa",
      };
  return labels[key] || method;
};
const paymentStatusLabel = (status, isArabic) => {
  const key = normalizePaymentStatusKey(status);
  const labels = isArabic
    ? { paid: "مسددة", partial: "جزئي", unpaid: "آجل" }
    : { paid: "Paid", partial: "Partial", unpaid: "Credit" };
  return labels[key] || status;
};
const normalizePaymentStatusKey = (value) => {
  const key = text(value).toLowerCase().replace(/[\s-]+/g, "_");
  if (["partially_paid", "partial", "part_paid"].includes(key)) return "partial";
  if (["paid", "settled", "settled_full", "settled_paid"].includes(key)) return "paid";
  return "unpaid";
};
const notifyProductsChanged = () => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("products:refetch", { detail: { source: "purchase-price-sync" } }));
};
const logPurchaseLinePayloads = (items = []) => {
  items.forEach((item) => {
    console.log("[purchase-line-payload]", {
      product_id: item.product_id ?? null,
      variant_id: item.variant_id ?? null,
      purchase_price: safeNumericPayload(item.purchase_price ?? item.purchase_cost ?? item.cost_price ?? item.unit_cost),
      selling_price: safeNumericPayload(item.selling_price ?? item.sell_price ?? item.price),
      sale_price: safeNumericPayload(item.sale_price),
    });
  });
};
const isHexColor = (value) => /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(text(value));
const colorSwatchValue = (value) => {
  const next = text(value);
  if (!next) return "";
  return isHexColor(next) ? next : `#${next}`;
};
const getVariantImage = (variant = {}, product = {}) =>
  firstText(
    variant?.variant_image_url,
    variant?.color_image,
    variant?.color_image_url,
    variant?.image_url,
    variant?.image,
    variant?.thumbnail_url,
    product?.image_url,
    product?.product_image_url,
    product?.image,
    product?.thumbnail_url
  );
const savedPurchaseQty = (item = {}) => {
  if (!item || typeof item !== "object") return null;
  const canUseGenericQuantityAlias = !item.line_id;
  const values = [
    item.purchase_qty,
    item.default_purchase_qty,
    item.purchase_quantity,
    item.bulk_purchase_qty,
    item.planned_qty,
    item.planned_quantity,
    item.stock_qty,
    item.stockQty,
    item.reorder_purchase_qty,
    canUseGenericQuantityAlias ? item.quantity : undefined,
  ];
  for (const value of values) {
    const quantity = Number(value || 0);
    if (Number.isFinite(quantity) && quantity > 0) return quantity;
  }
  return null;
};

const savedColorPurchaseQty = (product = {}, variant = {}) => {
  const color = normalizeKey(variant?.color ?? variant?.color_name ?? variant?.colorName);
  if (!color) return null;

  const groups = [
    ...toArray(product?.planned_quantities),
    ...toArray(product?.colorImages),
    ...toArray(product?.color_images),
    ...toArray(product?.colors),
    ...toArray(product?.variant_groups),
  ];

  const match = groups.find((group) =>
    [
      group?.color,
      group?.color_name,
      group?.colorName,
      group?.color_value,
      group?.name,
      group?.label,
    ].some((value) => normalizeKey(value) === color)
  );

  return savedPurchaseQty(match);
};

const normalizePurchaseDraftPayload = (value = {}) => {
  if (!value || typeof value !== "object") return null;
  const items = Array.isArray(value.items) ? value.items : Array.isArray(value.lines) ? value.lines : Array.isArray(value.purchase?.items) ? value.purchase.items : [];
  return {
    ...value,
    items,
  };
};

const normalizePurchaseItem = (item = {}) => {
  const cost = Number(
    item.unit_cost ??
      item.cost_price ??
      item.purchase_price ??
      item.last_cost ??
      item.purchase_cost ??
      item.cost ??
      0
  );
  const quantity = Number(item.quantity || item.qty || 1);
  const sellingPrice =
    item.selling_price ??
    item.sell_price ??
    item.sellPrice ??
    item.regular_price ??
    item.price ??
    item.retail_price ??
    "";
  const salePrice = item.sale_price ?? item.salePrice ?? item.sale_price_override ?? item.salePriceOverride ?? item.promo_sale_price ?? item.discount_price ?? "";
  const wholesalePrice = item.wholesale_price ?? item.wholesalePrice ?? "";

  return {
    ...item,
    line_id:
      item.line_id ||
      item.id ||
      `${item.product_id || "product"}-${item.variant_id || "base"}-${item.sku || item.barcode || Date.now()}-${item.color || ""}-${item.size || ""}`,
    unit_cost: cost,
    cost_price: cost,
    purchase_price: cost,
    ...(sellingPrice !== "" && sellingPrice !== null && sellingPrice !== undefined
      ? {
          selling_price: money(sellingPrice),
          regular_price: money(sellingPrice),
          price: money(sellingPrice),
        }
      : {}),
    sale_price: salePrice !== "" && salePrice !== null && salePrice !== undefined ? Math.max(0, money(salePrice)) : 0,
    wholesale_price: wholesalePrice !== "" && wholesalePrice !== null && wholesalePrice !== undefined ? Math.max(0, money(wholesalePrice)) : 0,
    quantity,
    subtotal: quantity * cost,
  };
};

const normalizePurchaseCartItem = (item = {}, index = 0) => {
  const cost = money(item.unit_cost ?? item.cost_price ?? item.purchase_price ?? item.purchase_cost ?? item.cost ?? item.price);
  const sellingPrice = money(item.selling_price ?? item.sell_price ?? item.sellPrice ?? item.regular_price ?? item.variant_sale_price ?? item.price ?? 0);
  const salePrice = money(item.sale_price ?? item.salePrice ?? item.sale_price_override ?? item.salePriceOverride ?? item.variant_discount_price ?? item.discount_price ?? 0);
  const quantity = money(item.quantity ?? item.qty ?? 1) || 1;
  return normalizePurchaseItem({
    ...item,
    line_id:
      item.line_id ||
      item.id ||
      `${item.product_id || "product"}-${item.variant_id || "base"}-${item.sku || item.barcode || index}-${item.color || ""}-${item.size || ""}`,
    product_name: item.product_name || item.name || item.product?.name || "Unnamed product",
    image_url:
      firstText(
        item.image_url,
        item.variant_image_url,
        item.color_image_url,
        item.product_image_url,
        item.product?.image_url,
        item.variant?.image_url
      ),
    quantity,
    received_quantity: money(item.received_quantity ?? item.received_qty ?? item.receivedQty ?? 0),
    unit_cost: cost,
    cost_price: cost,
    purchase_price: cost,
    selling_price: sellingPrice,
    regular_price: sellingPrice,
    price: sellingPrice,
    sale_price: salePrice,
  });
};

const normalizeProductsResponse = (data) => {
  const products = Array.isArray(data) ? data : data?.data || data?.products || data?.rows || [];
  if (Array.isArray(products)) return products;
  if (Array.isArray(products?.data)) return products.data;
  if (Array.isArray(products?.products)) return products.products;
  return [];
};

const normalizeBranchesResponse = (data) => {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.branches)) return data.branches;
  return [];
};

const normalizeReorderResponse = (data) => {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.suggestions)) return data.suggestions;
  return [];
};

const normalizeVariantOption = (product, variant = null) => {
  const productId = product?.id ?? product?.product_id ?? variant?.product_id ?? null;
  const variantId = variant?.variant_id ?? variant?.id ?? product?.variant_id ?? null;
  const color = variant?.color ?? product?.color ?? "";
  const size = variant?.size ?? product?.size ?? "";
  const sku = variant?.sku ?? product?.sku ?? `${product?.name || product?.product_name || "product"}-${variantId || productId}`;
  const barcode = variant?.barcode ?? product?.barcode ?? "";
  const stock = money(variant?.current_stock ?? variant?.stock ?? variant?.stock_quantity ?? product?.current_stock ?? product?.stock ?? product?.total_stock ?? 0);
  const purchaseQty =
    savedPurchaseQty(variant) ??
    savedColorPurchaseQty(product, variant) ??
    savedPurchaseQty(product) ??
    null;
  const lowStockThreshold = money(variant?.low_stock_threshold ?? variant?.low_stock_alert ?? product?.low_stock_threshold ?? product?.low_stock_alert ?? 5);
  const costPrice = money(
    variant?.unit_cost ??
      variant?.cost_price ??
      variant?.last_cost ??
      variant?.purchase_cost ??
      variant?.purchase_price ??
      variant?.last_purchase_cost ??
      variant?.cost ??
      product?.unit_cost ??
      product?.cost_price ??
      product?.last_cost ??
      product?.purchase_cost ??
      product?.purchase_price ??
      product?.last_purchase_cost ??
      product?.cost ??
      0
  );
  const sellingPrice = money(
    variant?.selling_price ??
      variant?.regular_price ??
      variant?.price ??
      product?.selling_price ??
      product?.regular_price ??
      product?.price ??
      0
  );
  const salePrice = money(variant?.sale_price ?? product?.sale_price ?? 0);
  const wholesalePrice = money(variant?.wholesale_price ?? product?.wholesale_price ?? 0);

  return {
    line_id: `${productId || "product"}-${variantId || "base"}-${sku}-${barcode}-${color}-${size}`,
    product_id: productId,
    variant_id: variantId,
    product_name: product?.name || product?.product_name || "Unnamed product",
    sku,
    barcode,
    color,
    size,
    stock,
    purchase_qty: purchaseQty,
    purchase_quantity: purchaseQty,
    default_purchase_qty: purchaseQty || 0,
    bulk_purchase_qty: purchaseQty || 0,
    planned_qty: purchaseQty || 0,
    planned_quantity: purchaseQty || 0,
    stock_qty: purchaseQty || 0,
    reorder_purchase_qty: purchaseQty,
    low_stock_threshold: lowStockThreshold,
    image_url: getVariantImage(variant, product),
    color_image_url: firstText(variant?.color_image, variant?.color_image_url),
    variant_image_url: firstText(variant?.variant_image_url),
    color_hex: firstText(variant?.color_hex, variant?.hex, variant?.color_value, product?.color_hex, product?.hex, product?.color_value),
    unit_cost: costPrice,
    cost_price: costPrice,
    purchase_price: costPrice,
    last_cost: costPrice,
    purchase_cost: costPrice,
    selling_price: sellingPrice,
    regular_price: sellingPrice,
    sale_price: salePrice,
    wholesale_price: wholesalePrice,
    price: sellingPrice,
    last_purchase_cost: costPrice,
    last_purchase_date: variant?.last_purchase_date || variant?.last_purchased_at || product?.last_purchase_date || "",
    supplier_id: variant?.supplier_id || product?.supplier_id || null,
    supplier_name: variant?.supplier_name || product?.supplier_name || product?.supplier || "",
    purchase_pack_qty: Math.max(1, money(variant?.purchase_pack_qty || product?.purchase_pack_qty || 1)),
    quantity: 1,
    received_quantity: 0,
    tax: 0,
    discount: 0,
    reorder: null,
  };
};

const flattenProductsWithVariants = (rows = []) =>
  toArray(rows)
    .filter((product) => product && typeof product === "object")
    .flatMap((product) => {
      const variants = toArray(product?.variants).filter((variant) => variant && typeof variant === "object");
      if (variants.length) return variants.map((variant) => normalizeVariantOption(product, variant));
      return [normalizeVariantOption(product)];
    })
    .filter((item) => item.product_id);

const mergeReorderFlags = (products, reorderRows) => {
  const byVariant = new Map();
  const byProduct = new Map();
  reorderRows.forEach((row) => {
    if (row?.variant_id) byVariant.set(String(row.variant_id), row);
    if (row?.product_id) byProduct.set(String(row.product_id), row);
  });

  return products.map((product) => {
    const reorder = byVariant.get(String(product.variant_id || "")) || byProduct.get(String(product.product_id || "")) || null;
    return {
      ...product,
      reorder,
      supplier_name: product.supplier_name || reorder?.supplier_name || "",
      low_stock_threshold: money(reorder?.reorder_point ?? reorder?.min_stock ?? product.low_stock_threshold),
    };
  });
};

const groupByProduct = (products = []) => {
  const groups = new Map();
  products.forEach((item) => {
    const key = String(item.product_id || item.line_id);
    const current = groups.get(key) || {
      product_id: item.product_id,
      product_name: item.product_name,
      image_url: item.image_url,
      supplier_name: item.supplier_name,
      variants: [],
    };
    current.variants.push(item);
    if (!current.image_url && item.image_url) current.image_url = item.image_url;
    if (!current.supplier_name && item.supplier_name) current.supplier_name = item.supplier_name;
    groups.set(key, current);
  });
  return Array.from(groups.values());
};

const searchMatches = (item, query) => {
  if (!query) return true;
  return `${item.product_name} ${item.sku} ${item.barcode} ${item.color} ${item.size} ${item.supplier_name}`.toLowerCase().includes(query);
};

function PurchaseOrder() {
  const { t, i18n } = useTranslation();
  const isArabic = String(i18n.language || "").toLowerCase().startsWith("ar");
  const navigate = useNavigate();
  const location = useLocation();
  const { id: editPurchaseId } = useParams();
  const isEditMode = Boolean(editPurchaseId && /\/edit\/?$/.test(location.pathname));
  const purchaseShellRef = useRef(null);
  const searchRef = useRef(null);
  const searchPanelWrapRef = useRef(null);
  const productPanelRef = useRef(null);
  const draftImportAppliedRef = useRef(false);
  const [suppliers, setSuppliers] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [branches, setBranches] = useState([]);
  const [products, setProducts] = useState([]);
  const [financialAccounts, setFinancialAccounts] = useState([]);
  const [paymentMethodMappings, setPaymentMethodMappings] = useState([]);
  const [paymentMethodMappingsLoadFailed, setPaymentMethodMappingsLoadFailed] = useState(false);
  const [productsLoading, setProductsLoading] = useState(false);
  const [productPickerOpen, setProductPickerOpen] = useState(false);
  const [productPanelExpanded, setProductPanelExpanded] = useState(false);
  const [supplierId, setSupplierId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [search, setSearch] = useState("");
  const status = "received";
  const [discount, setDiscount] = useState(0);
  const shipping = 0;
  const transport = 0;
  const customs = 0;
  const additionalExpenses = 0;
  const [supplierPaymentStatus, setSupplierPaymentStatus] = useState("unpaid");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [paymentAccountId, setPaymentAccountId] = useState("");
  const [supplierPaidAmount, setSupplierPaidAmount] = useState(0);
  const supplierInvoiceNumber = "";
  const deliveryNotes = "";
  const internalNotes = "";
  const attachments = [];
  const [items, setItems] = useState([]);
  const [bulkPriceModal, setBulkPriceModal] = useState(null);
  const [purchaseQtyModal, setPurchaseQtyModal] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [postError, setPostError] = useState("");
  const [editPurchase, setEditPurchase] = useState(null);
  const [confirmReceivedEditSave, setConfirmReceivedEditSave] = useState(false);
  const [cartCostErrors, setCartCostErrors] = useState(new Set());
  const [posting, setPosting] = useState(false);
  const postingRef = useRef(false);
  const purchaseSaveIdRef = useRef("");
  const lastAutoBulkPricingSignatureRef = useRef("");
  const [supplierModalOpen, setSupplierModalOpen] = useState(false);
  const [productModalOpen, setProductModalOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [variantSelector, setVariantSelector] = useState(null);
  const [runModal, setRunModal] = useState(null);
  const [supplierSaving, setSupplierSaving] = useState(false);
  const [supplierError, setSupplierError] = useState("");
  const [supplierForm, setSupplierForm] = useState({
    name: "",
    phone: "",
    whatsapp: "",
    email: "",
    contact_person: "",
    tax_number: "",
    address: "",
    opening_balance: 0,
    notes: "",
    status: "active",
  });
  const [productSaving, setProductSaving] = useState(false);
  const [productError, setProductError] = useState("");
  const [purchaseDraftPayload, setPurchaseDraftPayload] = useState(null);
  const [productForm, setProductForm] = useState({
    name: "",
    category: "",
    brand: "",
    colors: "Black",
    sizes: "41,42,43,44",
    sale_price: 0,
    purchase_cost: 0,
    sku: "",
    barcode: "",
    image_url: "",
  });

  const loadData = async () => {
    try {
      setLoading(true);
      setProductsLoading(true);
      setError("");

      const [suppliersRes, warehousesRes, branchesRes, productsRes, reorderRes, financialAccountsRes, paymentMappingsRes] = await Promise.allSettled([
        api.get("/suppliers?limit=200&page=1"),
        api.get("/warehouses"),
        api.get("/branches"),
        api.get("/products/with-variants"),
        api.get("/purchases/reorder-suggestions"),
        accountingApi.getFinancialAccounts({ include_inactive: true }),
        accountingApi.getPaymentMethodMappings(),
      ]);

      if (suppliersRes.status === "fulfilled") {
        const rows = toArray(suppliersRes.value?.data).length ? suppliersRes.value.data : toArray(suppliersRes.value?.suppliers);
        setSuppliers(rows.map(normalizeSupplier));
      } else {
        setSuppliers([]);
        setError((prev) => `${prev ? `${prev} ` : ""}${t("purchases.create.suppliersLoadFailed")}`);
      }

      if (warehousesRes.status === "fulfilled") {
        const rows = toArray(warehousesRes.value?.data).length
          ? warehousesRes.value.data
          : toArray(warehousesRes.value?.warehouses).length
            ? warehousesRes.value.warehouses
            : toArray(warehousesRes.value);
        setWarehouses(rows.map(normalizeWarehouse));
      } else {
        setWarehouses([]);
        setError((prev) => `${prev ? `${prev} ` : ""}${t("purchases.create.warehousesLoadFailed")}`);
      }

      if (branchesRes.status === "fulfilled") {
        setBranches(normalizeBranchesResponse(branchesRes.value).filter((branch) => branch?.is_active !== false));
      } else {
        setBranches([]);
      }

      const rows = productsRes.status === "fulfilled" ? normalizeProductsResponse(productsRes.value) : [];
      const reorderRows = reorderRes.status === "fulfilled" ? normalizeReorderResponse(reorderRes.value) : [];
      if (productsRes.status === "fulfilled") {
        setProducts(mergeReorderFlags(flattenProductsWithVariants(rows), reorderRows));
      } else {
        setProducts([]);
        setError((prev) => `${prev ? `${prev} ` : ""}${t("purchases.create.productsLoadFailed")}`);
      }

      if (financialAccountsRes.status === "fulfilled") {
        const financialAccountRows = Array.isArray(financialAccountsRes.value?.rows) ? financialAccountsRes.value.rows : [];
        setFinancialAccounts(
          financialAccountRows
            .map(normalizeFinancialAccount)
            .filter((account) => account?.is_active !== false && account?.id !== null && account?.id !== undefined)
        );
      } else {
        setFinancialAccounts([]);
      }

      if (paymentMappingsRes.status === "fulfilled") {
        const rows = Array.isArray(paymentMappingsRes.value?.rows) ? paymentMappingsRes.value.rows : [];
        setPaymentMethodMappings(rows);
        setPaymentMethodMappingsLoadFailed(false);
      } else {
        setPaymentMethodMappings([]);
        setPaymentMethodMappingsLoadFailed(true);
      }

      if (isEditMode) {
        const editResponse = await api.get(`/purchases/${editPurchaseId}`);
        const loadedPurchase = normalizePurchase(editResponse?.purchase || editResponse?.data || {});
        if (!loadedPurchase?.id && !loadedPurchase?.purchase_number && !loadedPurchase?.invoice_number) {
          throw new Error(t("purchases.details.notFoundSubtitle", "لم يتم العثور على فاتورة الشراء."));
        }
        setEditPurchase(loadedPurchase);
        setSupplierId(loadedPurchase.supplier_id ? String(loadedPurchase.supplier_id) : "");
        setWarehouseId(loadedPurchase.warehouse_id ? String(loadedPurchase.warehouse_id) : "");
        setBranchId(loadedPurchase.branch_id ? String(loadedPurchase.branch_id) : "");
        setDiscount(money(loadedPurchase.discount));
        const paidAmount = money(loadedPurchase.paid_amount ?? loadedPurchase.supplier_paid_amount ?? loadedPurchase.amount_paid ?? 0);
        const paymentStatus = String(loadedPurchase.supplier_payment_status || loadedPurchase.payment_status || "").toLowerCase();
        const normalizedPaymentStatus = paymentStatus.includes("partial") ? "partial" : paymentStatus.includes("paid") ? "paid" : "unpaid";
        setSupplierPaymentStatus(normalizedPaymentStatus);
        setSupplierPaidAmount(paidAmount);
        const financialAccountRows =
          financialAccountsRes.status === "fulfilled" && Array.isArray(financialAccountsRes.value?.rows)
            ? financialAccountsRes.value.rows.map(normalizeFinancialAccount)
            : [];
        const loadedFinancialAccountId =
          loadedPurchase.financial_account_id ||
          loadedPurchase.payment_account_id ||
          loadedPurchase.metadata?.payment_account_id ||
          loadedPurchase.metadata?.financial_account_id ||
          "";
        const loadedAccount = financialAccountRows.find((account) => String(account.id) === String(loadedFinancialAccountId)) || null;
        const loadedPaymentMethod = normalizePaymentMethodKey(loadedPurchase.payment_method || loadedPurchase.metadata?.payment_method || "");
        const loadedAccountType = String(loadedAccount?.account_type || "").toLowerCase();
        const loadedAccountProvider = String(loadedAccount?.provider || "").toLowerCase();
        const loadedAccountName = String(loadedAccount?.name || "").toLowerCase();
        const derivedPaymentMethod =
          loadedPaymentMethod ||
          (loadedAccount
            ? ["cash_drawer", "safe"].includes(loadedAccountType)
              ? "cash"
              : ["wallet", "digital_wallet"].includes(loadedAccountType)
                ? loadedAccountProvider.includes("insta") || loadedAccountName.includes("insta")
                  ? "instapay"
                  : "vodafone_cash"
                : ["bank", "card_settlement"].includes(loadedAccountType)
                  ? "bank_transfer"
                  : ""
            : "");
        setPaymentMethod(normalizedPaymentStatus === "unpaid" ? "" : derivedPaymentMethod || "cash");
        setPaymentAccountId(normalizedPaymentStatus === "unpaid" ? "" : String(loadedFinancialAccountId || ""));
        setItems(toArray(loadedPurchase.items).map(normalizePurchaseCartItem));
      } else {
        setEditPurchase(null);
      }
    } catch (err) {
      console.log(err);
      setSuppliers([]);
      setWarehouses([]);
      setBranches([]);
      setProducts([]);
      setFinancialAccounts([]);
      setPaymentMethodMappings([]);
      setPaymentMethodMappingsLoadFailed(true);
      setError(t("purchases.create.setupLoadFailedLong"));
      toast.error(t("purchases.create.setupLoadFailed"));
    } finally {
      setLoading(false);
      setProductsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [editPurchaseId, isEditMode]);

  useEffect(() => {
    if (isEditMode) return;
    const statePayload = normalizePurchaseDraftPayload(location.state?.purchaseDraftPayload || location.state?.draftPayload || null);
    if (statePayload) {
      setPurchaseDraftPayload(statePayload);
      return;
    }
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(SMART_PURCHASE_DRAFT_STORAGE_KEY);
      setPurchaseDraftPayload(raw ? normalizePurchaseDraftPayload(JSON.parse(raw)) : null);
    } catch {
      setPurchaseDraftPayload(null);
    }
  }, [isEditMode, location.key, location.state]);

  useEffect(() => {
    if (isEditMode) return;
    if (loading) return;
    if (!purchaseDraftPayload || draftImportAppliedRef.current) return;

    const importedItems = Array.isArray(purchaseDraftPayload.items)
      ? purchaseDraftPayload.items.map((item) => normalizePurchaseCartItem(item))
      : [];
    if (!importedItems.length) return;

    if (!items.length) {
      setItems(importedItems);
    }

    const supplierMatch =
      suppliers.find((supplier) => String(supplier.id) === String(purchaseDraftPayload.supplier_id || "")) ||
      suppliers.find((supplier) => normalizeKey(supplier.name) === normalizeKey(purchaseDraftPayload.supplier_name || ""));
    const warehouseMatch =
      warehouses.find((warehouse) => String(warehouse.id) === String(purchaseDraftPayload.warehouse_id || "")) ||
      warehouses.find((warehouse) => normalizeKey(warehouse.name) === normalizeKey(purchaseDraftPayload.warehouse_name || ""));

    if (supplierMatch?.id) setSupplierId(String(supplierMatch.id));
    else if (purchaseDraftPayload.supplier_id) setSupplierId(String(purchaseDraftPayload.supplier_id));

    if (warehouseMatch?.id) setWarehouseId(String(warehouseMatch.id));
    else if (purchaseDraftPayload.warehouse_id) setWarehouseId(String(purchaseDraftPayload.warehouse_id));

    if (purchaseDraftPayload.branch_id) setBranchId(String(purchaseDraftPayload.branch_id));

    draftImportAppliedRef.current = true;
    try {
      window.localStorage.removeItem(SMART_PURCHASE_DRAFT_STORAGE_KEY);
    } catch {
      // ignore storage cleanup failures
    }
  }, [isEditMode, loading, purchaseDraftPayload, suppliers, warehouses, items.length]);

  useEffect(() => {
    const syncFullscreenState = () => {
      setIsFullscreen(Boolean(document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement));
    };
    syncFullscreenState();
    document.addEventListener("fullscreenchange", syncFullscreenState);
    document.addEventListener("webkitfullscreenchange", syncFullscreenState);
    document.addEventListener("msfullscreenchange", syncFullscreenState);
    return () => {
      document.removeEventListener("fullscreenchange", syncFullscreenState);
      document.removeEventListener("webkitfullscreenchange", syncFullscreenState);
      document.removeEventListener("msfullscreenchange", syncFullscreenState);
    };
  }, []);

  useEffect(() => {
    if (!productPickerOpen) return undefined;
    const handlePointerDown = (event) => {
      if (searchPanelWrapRef.current?.contains(event.target)) return;
      setProductPickerOpen(false);
    };
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setProductPickerOpen(false);
        searchRef.current?.blur();
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [productPickerOpen]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const closeExpandedPanel = (event) => {
      if (event.key === "Escape") {
        setProductPanelExpanded(false);
        setProductPickerOpen(false);
      }
    };

    if (productPanelExpanded) {
      document.body.style.overflow = "hidden";
      document.addEventListener("keydown", closeExpandedPanel);
    }

    return () => {
      document.removeEventListener("keydown", closeExpandedPanel);
      document.body.style.overflow = previousOverflow;
    };
  }, [productPanelExpanded]);

  useEffect(() => {
    return () => {
      setProductPanelExpanded(false);
      setProductPickerOpen(false);
      document.body.style.overflow = "";
    };
  }, []);

  useEffect(() => {
    const requestedSupplierId = new URLSearchParams(location.search).get("supplier_id");
    if (isEditMode) return;
    if (requestedSupplierId && suppliers.some((supplier) => String(supplier.id) === String(requestedSupplierId))) {
      setSupplierId(String(requestedSupplierId));
      return;
    }
    if (requestedSupplierId && suppliers.length && !suppliers.some((supplier) => String(supplier.id) === String(requestedSupplierId))) {
      setSupplierModalOpen(true);
    }
    if (!supplierId && suppliers.length) setSupplierId(String(suppliers[0].id));
    if (!supplierId && !suppliers.length && !loading) setSupplierModalOpen(true);
    if (!warehouseId && warehouses.length) setWarehouseId(String(warehouses[0].id));
    if (!branchId && branches.length === 1) setBranchId(String(branches[0].id));
  }, [suppliers, warehouses, branches, supplierId, warehouseId, branchId, location.search, loading, isEditMode]);

  const filteredProducts = useMemo(() => {
    const query = search.trim().toLowerCase();
    return products.filter((item) => searchMatches(item, query));
  }, [products, search]);

  const groupedCards = useMemo(() => groupByProduct(filteredProducts).slice(0, 80), [filteredProducts]);

  const variantsByProduct = useMemo(() => {
    return products.reduce((map, item) => {
      const key = String(item.product_id || "");
      if (!key) return map;
      if (!map[key]) map[key] = [];
      map[key].push(item);
      return map;
    }, {});
  }, [products]);

  const cartProductGroups = useMemo(() => bulkProductTargets(items), [items]);
  const cartProductSignature = useMemo(
    () => cartProductGroups.map((group) => `${group.product_id || group.product_name}:${group.items.length}`).join("|"),
    [cartProductGroups]
  );

  useEffect(() => {
    if (cartProductGroups.length <= 1) return;
    if (!cartProductSignature || lastAutoBulkPricingSignatureRef.current === cartProductSignature) return;
    if (variantSelector || runModal || purchaseQtyModal || supplierModalOpen || productModalOpen || confirmReceivedEditSave) return;
    lastAutoBulkPricingSignatureRef.current = cartProductSignature;
    setBulkPriceModal("model-pricing");
  }, [cartProductGroups.length, cartProductSignature, variantSelector, runModal, purchaseQtyModal, supplierModalOpen, productModalOpen, confirmReceivedEditSave]);

  const purchaseQtyLabels = isArabic
    ? {
        button: "استخدم كميات المنتج",
        toastApplied: "تم إضافة الموديل وتطبيق كميات المنتج المحفوظة",
      }
    : {
        button: "Use Product Purchase Qty",
        toastApplied: "Model added and saved product purchase quantities applied",
      };

  const subtotal = items.reduce((sum, item) => sum + money(item.subtotal ?? money(item.quantity) * money(item.cost_price)), 0);
  const expenses = money(shipping) + money(transport) + money(customs) + money(additionalExpenses);
  const total = Math.max(0, subtotal + expenses - money(discount));
  const effectiveSupplierPaidAmount =
    supplierPaymentStatus === "paid"
      ? total
      : supplierPaymentStatus === "partial"
        ? Math.min(total, money(supplierPaidAmount))
        : 0;
  const effectiveSupplierRemainingAmount = Math.max(0, total - effectiveSupplierPaidAmount);
  const selectedPaymentAccount = financialAccounts.find((account) => String(account.id) === String(paymentAccountId)) || null;
  const selectedPaymentMethodMapping = useMemo(
    () => getPurchasePaymentMappingSelection(paymentMethodMappings, paymentMethod, branchId),
    [paymentMethodMappings, paymentMethod, branchId]
  );
  const availablePaymentAccounts = useMemo(
    () => {
      if (paymentMethodMappingsLoadFailed) {
        return getPurchasePaymentMappingsFallbackAccounts(financialAccounts, paymentMethod);
      }
      return getPurchasePaymentAccountsFromMappings(financialAccounts, paymentMethodMappings, paymentMethod, branchId);
    },
    [financialAccounts, paymentMethodMappings, paymentMethodMappingsLoadFailed, paymentMethod, branchId]
  );
  const paymentStatusOptions = useMemo(
    () => [
      { value: "paid", label: paymentStatusLabel("paid", isArabic) },
      { value: "partial", label: paymentStatusLabel("partial", isArabic) },
      { value: "unpaid", label: paymentStatusLabel("unpaid", isArabic) },
    ],
    [isArabic]
  );
  const paymentMethodOptions = useMemo(
    () => [
      { value: "cash", label: paymentMethodLabel("cash", isArabic) },
      { value: "vodafone_cash", label: paymentMethodLabel("vodafone_cash", isArabic) },
      { value: "instapay", label: paymentMethodLabel("instapay", isArabic) },
      { value: "bank_transfer", label: paymentMethodLabel("bank_transfer", isArabic) },
    ],
    [isArabic]
  );
  const addProduct = (product, quantity = 1) => {
    if (!product) return;
    const qty = Math.max(1, money(quantity) || 1);
    setItems((prev) => {
      const existing = prev.find((item) => String(item.line_id) === String(product.line_id));
      if (existing) {
        return prev.map((item) =>
          String(item.line_id) === String(product.line_id)
            ? normalizePurchaseItem({ ...item, quantity: money(item.quantity) + qty })
            : item
        );
      }
      return [...prev, normalizePurchaseItem({ ...product, quantity: qty, received_quantity: product.received_quantity || 0 })];
    });
    setCartCostErrors((prev) => {
      const next = new Set(prev);
      next.delete(String(product.line_id));
      return next;
    });
    setProductPickerOpen(false);
    setProductPanelExpanded(false);
    window.setTimeout(() => searchRef.current?.focus(), 40);
  };

  const addProductCard = (group) => {
    const variants = toArray(group?.variants);
    if (variants.length > 1) {
      setVariantSelector(group);
      return;
    }
    addProduct(variants[0]);
  };

  const addRunItems = (rows) => {
    rows.filter((row) => money(row.quantity) > 0).forEach((row) => addProduct(row.product, row.quantity));
    setRunModal(null);
  };

  const updateItem = (lineId, patch) => {
    setItems((prev) =>
      prev.map((item) => {
        if (String(item.line_id) !== String(lineId)) return item;
        const next = { ...item, ...patch };
        if (Object.prototype.hasOwnProperty.call(patch, "unit_cost") || Object.prototype.hasOwnProperty.call(patch, "cost_price")) {
          const cost = money(patch.unit_cost ?? patch.cost_price ?? patch.purchase_price);
          return normalizePurchaseItem({ ...next, unit_cost: cost, cost_price: cost, purchase_price: cost });
        }
        if (Object.prototype.hasOwnProperty.call(patch, "selling_price") || Object.prototype.hasOwnProperty.call(patch, "price")) {
          const price = money(patch.selling_price ?? patch.price);
          return normalizePurchaseItem({ ...next, selling_price: price, regular_price: price, price });
        }
        if (Object.prototype.hasOwnProperty.call(patch, "sale_price")) {
          return normalizePurchaseItem({ ...next, sale_price: Math.max(0, money(patch.sale_price)) });
        }
        if (Object.prototype.hasOwnProperty.call(patch, "wholesale_price")) {
          return normalizePurchaseItem({ ...next, wholesale_price: Math.max(0, money(patch.wholesale_price)) });
        }
        return normalizePurchaseItem(next);
      })
    );
    setCartCostErrors((prev) => {
      const next = new Set(prev);
      next.delete(String(lineId));
      return next;
    });
  };

  const applyBulkPrice = ({ type, value, method = "fixed", target = "all", productId = "" }) => {
    const price = money(value);
    if (!Number.isFinite(price) || price < 0) {
      toast.error(t("purchases.create.validPriceRequired"));
      return false;
    }
    if (!items.length) {
      toast.error(t("purchases.create.addItemsFirst"));
      return false;
    }
    if (target === "product" && !items.some((item) => String(item.product_id || "") === String(productId || ""))) {
      toast.error(t("purchases.create.selectProductInInvoice"));
      return false;
    }

    const isInScope = (item) => {
      if (target === "all") return true;
      return String(item.product_id || "") === String(productId || "");
    };
    const nextSalePrice = (item) => {
      const sellingPrice = money(item.selling_price ?? item.price ?? 0);
      if (method === "percent") return Math.max(0, sellingPrice - (sellingPrice * price) / 100);
      if (method === "amount") return Math.max(0, sellingPrice - price);
      return price;
    };
    let belowCost = 0;
    let aboveSelling = 0;

    setItems((prev) =>
      prev.map((item) => {
        if (!isInScope(item)) return item;
        if (type === "purchase") {
          return normalizePurchaseItem({
            ...item,
            unit_cost: price,
            cost_price: price,
            purchase_price: price,
          });
        }
        if (type === "sale") {
          const salePrice = nextSalePrice(item);
          if (salePrice > 0 && salePrice < money(item.cost_price)) belowCost += 1;
          if (salePrice > money(item.selling_price ?? item.price ?? 0)) aboveSelling += 1;
          return normalizePurchaseItem({
            ...item,
            sale_price: salePrice,
          });
        }
        return normalizePurchaseItem({
          ...item,
          selling_price: price,
          price,
        });
      })
    );
    if (type === "purchase") setCartCostErrors(new Set());
    if (type === "sale") {
      if (belowCost) toast.error(t("purchases.create.saleBelowCost", { count: belowCost }));
      if (aboveSelling) toast.error(t("purchases.create.saleAboveSelling", { count: aboveSelling }));
      toast.success(t("purchases.create.bulkSalePriceApplied"));
    } else {
      toast.success(t(type === "purchase" ? "purchases.create.bulkPurchasePriceApplied" : "purchases.create.bulkSellingPriceApplied"));
    }
    setBulkPriceModal(null);
    return true;
  };

  const applyModelPrices = (rows = []) => {
    const patches = new Map(
      rows.map((row) => [
        String(row.product_id || row.product_name || ""),
        {
          selling_price: money(row.selling_price),
          sale_price: row.sale_price === "" ? 0 : money(row.sale_price),
          wholesale_price: row.wholesale_price === "" ? 0 : money(row.wholesale_price),
        },
      ])
    );
    if (!patches.size) return false;
    setItems((prev) =>
      prev.map((item) => {
        const patch = patches.get(String(item.product_id || item.product_name || ""));
        if (!patch) return item;
        return normalizePurchaseItem({
          ...item,
          selling_price: patch.selling_price,
          regular_price: patch.selling_price,
          price: patch.selling_price,
          sale_price: patch.sale_price,
          wholesale_price: patch.wholesale_price,
        });
      })
    );
    toast.success(t("purchases.create.bulkSellingPriceApplied"));
    return true;
  };

  const removeItem = (lineId) => {
    setItems((prev) => prev.filter((item) => String(item.line_id) !== String(lineId)));
    setCartCostErrors((prev) => {
      const next = new Set(prev);
      next.delete(String(lineId));
      return next;
    });
  };

  const changeQty = (lineId, delta) => {
    setItems((prev) =>
      prev.map((item) =>
        String(item.line_id) === String(lineId)
          ? normalizePurchaseItem({ ...item, quantity: Math.max(1, money(item.quantity) + delta) })
          : item
      )
    );
  };

  const changeItemVariant = (lineId, nextVariantId) => {
    setItems((prev) =>
      prev.map((item) => {
        if (String(item.line_id) !== String(lineId)) return item;
        const variants = variantsByProduct[String(item.product_id)] || [];
        const next = variants.find((variant) => String(variant.variant_id || "") === String(nextVariantId || ""));
        return next ? normalizePurchaseItem({ ...next, quantity: item.quantity, received_quantity: item.received_quantity || 0 }) : item;
      })
    );
    setCartCostErrors((prev) => {
      const next = new Set(prev);
      next.delete(String(lineId));
      return next;
    });
  };

  const buildPurchaseQtyRows = (group) => {
    const sourceVariants = toArray(group?.variants);
    return sourceVariants
      .map((variant) => {
        const existing =
          items.find((item) => String(item.line_id) === String(variant.line_id)) ||
          items.find((item) => String(item.variant_id || "") === String(variant.variant_id || ""));
        const savedQty = savedPurchaseQty(variant);
        return {
          line_id: variant.line_id,
          variant,
          product_name: variant.product_name,
          color: variant.color || "افتراضي",
          size: variant.size || "مقاس واحد",
          currentQty: existing ? money(existing.quantity) : 0,
          savedQty,
          newQty: savedQty,
        };
      })
      .filter((row) => row.savedQty !== null);
  };

  const openPurchaseQtyPreview = (group) => {
    if (!group) return;
    const rows = buildPurchaseQtyRows(group);
    if (!rows.length) {
      toast.error(t("purchases.create.noSavedPurchaseQty"));
      return;
    }
    setPurchaseQtyModal({ group, rows });
  };

  const applyProductPurchaseQty = (group) => {
    const rows = buildPurchaseQtyRows(group);
    if (!rows.length) {
      toast.error(t("purchases.create.noSavedPurchaseQty"));
      return false;
    }
    const byLineId = new Map(rows.map((row) => [String(row.line_id), row]));
    setItems((prev) =>
      [
        ...prev.map((item) => {
          const row =
            byLineId.get(String(item.line_id)) ||
            rows.find((candidate) => String(candidate.variant?.variant_id || "") === String(item.variant_id || ""));
          return row ? normalizePurchaseItem({ ...item, quantity: row.savedQty }) : item;
        }),
        ...rows
          .filter((row) =>
            !prev.some((item) =>
              String(item.line_id) === String(row.line_id) ||
              String(item.variant_id || "") === String(row.variant?.variant_id || "")
            )
          )
          .map((row) => normalizePurchaseItem({ ...row.variant, quantity: row.savedQty, received_quantity: 0 })),
      ]
    );
    toast.success(purchaseQtyLabels.toastApplied);
    setPurchaseQtyModal(null);
    return true;
  };

  const handleBarcodeSubmit = (event) => {
    if (event.key !== "Enter") return;
    const query = search.trim();
    if (!query) return;
    event.preventDefault();
    const exact =
      products.find((item) => normalizeKey(item.barcode) === normalizeKey(query)) ||
      products.find((item) => normalizeKey(item.sku) === normalizeKey(query)) ||
      filteredProducts[0];
    if (exact) {
      addProduct(exact);
      setSearch("");
      toast.success(t("purchases.create.productAdded"));
    } else {
      toast.error(t("purchases.create.noProductMatched"));
    }
  };

  const saveSupplierFromOrder = async (event) => {
    event.preventDefault();
    const name = text(supplierForm.name);
    if (!name) {
      setSupplierError(t("purchases.suppliersDashboard.supplierNameRequired"));
      return;
    }
    try {
      setSupplierSaving(true);
      setSupplierError("");
      const response = await api.post("/suppliers", {
        ...supplierForm,
        name,
        current_balance: money(supplierForm.opening_balance),
      });
      const created = response?.data || response?.supplier;
      if (created) {
        const normalized = normalizeSupplier({ ...created, status: created.status === "inactive" ? "Inactive" : "Active" });
        setSuppliers((prev) => [normalized, ...prev]);
        setSupplierId(String(normalized.id));
      }
      setSupplierModalOpen(false);
      setSupplierForm({
        name: "",
        phone: "",
        whatsapp: "",
        email: "",
        contact_person: "",
        tax_number: "",
        address: "",
        opening_balance: 0,
        notes: "",
        status: "active",
      });
      toast.success(t("purchases.suppliersDashboard.supplierCreated"));
    } catch (err) {
      console.error(err);
      const message = err?.responseBody?.message || err?.message || t("purchases.create.supplierCreateFailed");
      setSupplierError(message);
      toast.error(message);
    } finally {
      setSupplierSaving(false);
    }
  };

  const createInlineProduct = async (event) => {
    event.preventDefault();
    const name = text(productForm.name);
    if (!name) {
      setProductError(t("purchases.create.productNameRequired"));
      return;
    }

    const colors = productForm.colors.split(",").map(text).filter(Boolean);
    const sizes = productForm.sizes.split(",").map(text).filter(Boolean);
    const variants = colors.flatMap((color) =>
      sizes.map((size, index) => ({
        color,
        size,
        sku: text(productForm.sku) ? `${productForm.sku}-${color}-${size}`.replace(/\s+/g, "-").toUpperCase() : "",
        barcode: index === 0 ? text(productForm.barcode) : "",
        unit_cost: money(productForm.purchase_cost),
        purchase_price: money(productForm.purchase_cost),
        cost_price: money(productForm.purchase_cost),
        purchase_cost: money(productForm.purchase_cost),
        price: money(productForm.sale_price),
        selling_price: money(productForm.sale_price),
        regular_price: money(productForm.sale_price),
        sale_price: 0,
        wholesale_price: 0,
        stock: 0,
        image_url: text(productForm.image_url),
      }))
    );

    try {
      setProductSaving(true);
      setProductError("");
      const response = await api.post("/products", {
        name,
        category: productForm.category,
        brand: productForm.brand,
        price: money(productForm.sale_price),
        sale_price: 0,
        unit_cost: money(productForm.purchase_cost),
        cost_price: money(productForm.purchase_cost),
        selling_price: money(productForm.sale_price),
        regular_price: money(productForm.sale_price),
        wholesale_price: 0,
        purchase_cost: money(productForm.purchase_cost),
        purchase_price: money(productForm.purchase_cost),
        sku: productForm.sku,
        barcode: productForm.barcode,
        image_url: productForm.image_url,
        variation_mode: variants.length ? "full_variations" : "simple",
        variants,
        variant_groups_count: colors.length,
        variant_rows_count: variants.length,
      });
      const product = response?.data || response?.product;
      const normalized = flattenProductsWithVariants([product]);
      setProducts((prev) => [...normalized, ...prev]);
      normalized.forEach((item) => addProduct(normalizePurchaseItem(item)));
      setProductModalOpen(false);
      toast.success(t("purchases.create.productCreatedAndAdded"));
    } catch (err) {
      const message = err?.responseBody?.message || err?.message || t("purchases.create.productCreateFailed");
      setProductError(message);
      toast.error(message);
    } finally {
      setProductSaving(false);
    }
  };

  const buildLocalRecord = (nextStatus) =>
    normalizePurchase({
      id: generateCode("draft"),
      invoice_number: generateCode("DRF"),
      supplier_id: supplierId,
      supplier_name: suppliers.find((supplier) => String(supplier.id) === String(supplierId))?.name || "Unknown",
      warehouse_name: warehouses.find((warehouse) => String(warehouse.id) === String(warehouseId))?.name || "Main Warehouse",
      status: nextStatus,
      payment_status: supplierPaymentStatus === "partial" ? "partially_paid" : supplierPaymentStatus,
      paid_amount: effectiveSupplierPaidAmount,
      supplier_payment_status: supplierPaymentStatus,
      supplier_paid_amount: effectiveSupplierPaidAmount,
      payment_method: paymentMethod || "",
      financial_account_id: paymentAccountId || null,
      remaining_amount: effectiveSupplierRemainingAmount,
      total,
      subtotal,
      tax: 0,
      discount,
      notes: internalNotes,
      metadata: {
        payment_method: paymentMethod || "",
        financial_account_id: paymentAccountId || null,
        remaining_amount: effectiveSupplierRemainingAmount,
      },
      created_at: new Date().toISOString(),
      items: items.map(normalizePurchaseItem),
    });

  const saveDraft = () => {
    const records = [buildLocalRecord("draft"), ...getLocalPurchases().map(normalizePurchase)];
    saveLocalPurchases(records);
    toast.success(t("purchases.create.draftSavedLocally"));
  };

  const handlePaymentStatusChange = (nextStatus) => {
    const normalized = normalizePaymentStatusKey(nextStatus);
    setSupplierPaymentStatus(normalized);
    if (normalized === "unpaid") {
      setPaymentMethod("");
      setPaymentAccountId("");
      setSupplierPaidAmount(0);
      return;
    }
    if (!paymentMethod) setPaymentMethod("cash");
  };

  const handlePaymentMethodChange = (nextMethod) => {
    const normalized = normalizePaymentMethodKey(nextMethod);
    setPaymentMethod(normalized);
  };

  const handlePaymentAccountChange = (nextAccountId) => {
    setPaymentAccountId(String(nextAccountId || ""));
  };

  useEffect(() => {
    if (normalizePaymentStatusKey(supplierPaymentStatus) === "unpaid") return;
    if (!availablePaymentAccounts.length) {
      if (paymentAccountId) setPaymentAccountId("");
      return;
    }
    const currentStillExists = availablePaymentAccounts.some((account) => String(account.id) === String(paymentAccountId));
    if (currentStillExists) return;
    setPaymentAccountId(String(availablePaymentAccounts[0].id));
  }, [availablePaymentAccounts, paymentAccountId, supplierPaymentStatus]);

  const handleToggleFullscreen = async () => {
    const getFullscreenElement = () =>
      document.fullscreenElement ||
      document.webkitFullscreenElement ||
      document.msFullscreenElement ||
      null;
    try {
      if (getFullscreenElement()) {
        const exitFullscreen =
          document.exitFullscreen ||
          document.webkitExitFullscreen ||
          document.msExitFullscreen;
        if (exitFullscreen) await exitFullscreen.call(document);
        return;
      }

      const target = purchaseShellRef.current || document.documentElement;
      const requestFullscreen =
        target.requestFullscreen ||
        target.webkitRequestFullscreen ||
        target.msRequestFullscreen;
      if (requestFullscreen) {
        await requestFullscreen.call(target);
      } else {
        toast.error(t("pos.fullscreenUnavailable", "Fullscreen is not available in this browser"));
      }
    } catch (err) {
      toast.error(err?.message || t("pos.fullscreenFailed", "Could not toggle fullscreen"));
    }
  };

  const postPurchase = async (nextStatus = "received", options = {}) => {
    if (postingRef.current || posting) return;
    postingRef.current = true;
    setPosting(true);
    setPostError("");
    const releasePostingLock = () => {
      postingRef.current = false;
      setPosting(false);
    };
    const purchaseSaveId = purchaseSaveIdRef.current || createPurchaseSaveId();
    purchaseSaveIdRef.current = purchaseSaveId;

    if (items.length === 0) {
      toast.error(t("purchases.create.addAtLeastOneItem"));
      releasePostingLock();
      return;
    }
    if (!supplierId) {
      const message = t("purchases.create.selectSupplierFirst");
      setPostError(message);
      toast.error(message);
      releasePostingLock();
      return;
    }
    if (!warehouseId) {
      const message = t("purchases.create.selectWarehouseFirst");
      setPostError(message);
      toast.error(message);
      releasePostingLock();
      return;
    }
    const normalizedItems = items.map(normalizePurchaseItem);
    const invalidCostIds = normalizedItems
      .filter((item) => !item.unit_cost || item.unit_cost <= 0)
      .map((item) => String(item.line_id));
    if (invalidCostIds.length) {
      const message = t("purchases.create.enterPurchaseCost");
      setCartCostErrors(new Set(invalidCostIds));
      setPostError(message);
      toast.error(message);
      releasePostingLock();
      return;
    }
    const normalizedPaymentStatus = normalizePaymentStatusKey(supplierPaymentStatus);
    const normalizedPaymentMethod = normalizePaymentMethodKey(paymentMethod);
    const selectedPaymentAccountMatch = financialAccounts.find((account) => String(account.id) === String(paymentAccountId)) || null;
    const normalizedFinancialAccountId = normalizedPaymentStatus === "unpaid" ? null : Number(paymentAccountId);
    const normalizedPaymentMethodForPayload = normalizedPaymentStatus === "unpaid" ? null : normalizedPaymentMethod;
    if (import.meta.env.DEV) {
      console.log("[purchase-payment-debug]", {
        paymentStatus: normalizedPaymentStatus,
        paymentMethod: normalizedPaymentMethod,
        paymentAccountId,
        selectedPaymentAccount: selectedPaymentAccountMatch,
        financialAccounts: financialAccounts.map((a) => ({
          id: a.id,
          name: a.name || a.account_name,
          type: a.type || a.account_type,
        })),
      });
    }
    if (normalizedPaymentStatus === "unpaid") {
      if (paymentMethod || paymentAccountId) {
        console.warn("[purchase-payment-warning] clearing payment fields for unpaid purchase", {
          paymentMethod,
          paymentAccountId,
        });
        setPaymentMethod("");
        setPaymentAccountId("");
      }
    } else {
      if (!normalizedPaymentMethod) {
        const message = isArabic ? "اختر طريقة الدفع أولاً." : "Choose a payment method first.";
        setPostError(message);
        toast.error(message);
        releasePostingLock();
        return;
      }
      if (!paymentAccountId || !selectedPaymentAccountMatch) {
        const message = isArabic ? "اختر الحساب المالي المناسب أولاً." : "Choose the matching financial account first.";
        setPostError(message);
        toast.error(message);
        releasePostingLock();
        return;
      }
      if (import.meta.env.DEV && selectedPaymentAccountMatch && !matchPurchasePaymentAccount(selectedPaymentAccountMatch, normalizedPaymentMethod)) {
        console.warn("[purchase-payment-warning] account type does not match payment method, allowing save", {
          paymentMethod: normalizedPaymentMethod,
          selectedPaymentAccountMatch: {
            id: selectedPaymentAccountMatch.id,
            name: selectedPaymentAccountMatch.name || selectedPaymentAccountMatch.account_name,
            type: selectedPaymentAccountMatch.type || selectedPaymentAccountMatch.account_type,
          },
        });
      }
      if (normalizedPaymentStatus === "paid") {
        if (total <= 0) {
          const message = isArabic ? "إجمالي الفاتورة غير صالح." : "Invoice total is invalid.";
          setPostError(message);
          toast.error(message);
          releasePostingLock();
          return;
        }
      }
      if (normalizedPaymentStatus === "partial") {
        if (effectiveSupplierPaidAmount <= 0 || effectiveSupplierPaidAmount >= total) {
          const message = isArabic ? "أدخل مبلغاً مدفوعاً صحيحاً أقل من إجمالي الفاتورة." : "Enter a valid paid amount less than the invoice total.";
          setPostError(message);
          toast.error(message);
          releasePostingLock();
          return;
        }
      }
    }
    setItems(normalizedItems);
    setCartCostErrors(new Set());

    if (isEditMode && editPurchase && !purchaseCanEditDestructively(editPurchase) && !options.confirmReceivedEdit) {
      setConfirmReceivedEditSave(true);
      releasePostingLock();
      return;
    }

    const payload = {
      client_request_id: purchaseSaveId,
      purchase_save_id: purchaseSaveId,
      supplier_id: supplierId,
      warehouse_id: warehouseId,
      branch_id: branchId || null,
      items: normalizedItems.map((item) => ({
        product_id: item.product_id,
        variant_id: item.variant_id || null,
        sku: item.sku || "",
        barcode: item.barcode || "",
        color: item.color || "",
        size: item.size || "",
        quantity: safeNumericPayload(item.quantity),
        qty: safeNumericPayload(item.quantity),
        received_quantity: safeNumericPayload(item.quantity),
        unit_cost: safeNumericPayload(item.unit_cost),
        cost_price: safeNumericPayload(item.cost_price),
        purchase_cost: safeNumericPayload(item.purchase_price ?? item.cost_price ?? item.unit_cost),
        purchase_price: safeNumericPayload(item.purchase_price ?? item.cost_price ?? item.unit_cost),
        selling_price: safeNumericPayload(item.selling_price ?? item.price),
        regular_price: safeNumericPayload(item.selling_price ?? item.price),
        sale_price: safeNumericPayload(item.sale_price),
        price: safeNumericPayload(item.price ?? item.selling_price),
        subtotal: safeNumericPayload(item.subtotal),
        total: safeNumericPayload(item.subtotal, safeNumericPayload(item.quantity) * safeNumericPayload(item.cost_price)),
        metadata: {
          image_url: item.image_url,
          last_purchase_cost: item.last_purchase_cost,
          last_purchase_date: item.last_purchase_date,
          supplier_name: item.supplier_name,
          selling_price: safeNumericPayload(item.selling_price ?? item.price),
          sale_price: safeNumericPayload(item.sale_price),
          price: safeNumericPayload(item.price ?? item.selling_price),
        },
      })),
      status: nextStatus,
      notes: [internalNotes, deliveryNotes ? `Delivery: ${deliveryNotes}` : "", supplierInvoiceNumber ? `Supplier invoice: ${supplierInvoiceNumber}` : ""].filter(Boolean).join("\n"),
      subtotal,
      tax: 0,
      discount,
      discount_amount: discount,
      shipping,
      transport,
      customs,
      additional_expenses: additionalExpenses,
      total,
      grand_total: total,
      payment_status: normalizedPaymentStatus === "partial" ? "partially_paid" : normalizedPaymentStatus,
      paid_amount: effectiveSupplierPaidAmount,
      supplier_payment_status: normalizedPaymentStatus,
      supplier_paid_amount: effectiveSupplierPaidAmount,
      remaining_amount: effectiveSupplierRemainingAmount,
      payment_method: normalizedPaymentMethodForPayload,
      financial_account_id: normalizedFinancialAccountId,
      metadata: {
        source: "purchase_pos",
        client_request_id: purchaseSaveId,
        purchase_save_id: purchaseSaveId,
        branch_id: branchId || null,
        supplier_payment_status: normalizedPaymentStatus,
        supplier_paid_amount: effectiveSupplierPaidAmount,
        remaining_amount: effectiveSupplierRemainingAmount,
        supplier_invoice_number: supplierInvoiceNumber,
        delivery_notes: deliveryNotes,
        internal_notes: internalNotes,
        payment_method: normalizedPaymentMethodForPayload,
        financial_account_id: normalizedFinancialAccountId,
        expenses: { shipping, transport, customs, additional_expenses: additionalExpenses },
        attachments: attachments.map((file) => ({ name: file.name, size: file.size, type: file.type })),
      },
    };

    try {
      if (isEditMode && editPurchase) {
        const selectedSupplier = suppliers.find((supplier) => String(supplier.id) === String(supplierId));
        const selectedWarehouse = warehouses.find((warehouse) => String(warehouse.id) === String(warehouseId));
        const editPayload = {
          supplier_id: supplierId,
          warehouse_id: warehouseId,
          branch_id: branchId || null,
          supplier_name: selectedSupplier?.name || editPurchase.supplier_name || "Unknown",
          warehouse_name: selectedWarehouse?.name || editPurchase.warehouse_name || "Main Warehouse",
          payment_status: normalizedPaymentStatus === "partial" ? "partially_paid" : normalizedPaymentStatus,
          paid_amount: effectiveSupplierPaidAmount,
          supplier_paid_amount: effectiveSupplierPaidAmount,
          supplier_payment_status: normalizedPaymentStatus,
          remaining_amount: effectiveSupplierRemainingAmount,
          payment_method: normalizedPaymentMethodForPayload,
          financial_account_id: normalizedFinancialAccountId,
          supplier_invoice_number: editPurchase.metadata?.supplier_invoice_number || editPurchase.supplier_invoice_number || "",
          notes: editPurchase.notes || "",
          subtotal,
          discount,
          discount_amount: discount,
          total,
          grand_total: total,
          metadata: {
            ...(editPurchase.metadata || {}),
            source: "purchase_pos_edit",
            supplier_payment_status: normalizedPaymentStatus,
            supplier_paid_amount: effectiveSupplierPaidAmount,
            remaining_amount: effectiveSupplierRemainingAmount,
            payment_method: normalizedPaymentMethodForPayload,
            financial_account_id: normalizedFinancialAccountId,
            branch_id: branchId || null,
          },
          items: normalizedItems.map((item) => ({
            ...item,
            quantity: safeNumericPayload(item.quantity),
            qty: safeNumericPayload(item.quantity),
            received_quantity: safeNumericPayload(item.received_quantity),
            unit_cost: safeNumericPayload(item.unit_cost),
            cost_price: safeNumericPayload(item.cost_price),
            purchase_cost: safeNumericPayload(item.purchase_price ?? item.cost_price ?? item.unit_cost),
            purchase_price: safeNumericPayload(item.purchase_price ?? item.cost_price ?? item.unit_cost),
            selling_price: safeNumericPayload(item.selling_price ?? item.price),
            regular_price: safeNumericPayload(item.selling_price ?? item.price),
            sale_price: safeNumericPayload(item.sale_price),
            price: safeNumericPayload(item.price ?? item.selling_price),
            subtotal: safeNumericPayload(item.subtotal),
            total: safeNumericPayload(item.subtotal, safeNumericPayload(item.quantity) * safeNumericPayload(item.cost_price)),
          })),
        };
        logPurchaseLinePayloads(editPayload.items);
        const response = await api.patch(`/purchases/${editPurchase.id || editPurchaseId}`, editPayload);
        const updated = normalizePurchase(response?.purchase || response?.data || { ...editPurchase, ...editPayload });
        saveLocalPurchases([
          updated,
          ...getLocalPurchases().map(normalizePurchase).filter((purchase) => String(purchase.id) !== String(updated.id)),
        ]);
        notifyProductsChanged();
        toast.success(t("purchases.toasts.updated"));
        setConfirmReceivedEditSave(false);
        navigate(`/purchases/${updated.id || editPurchase.id || editPurchaseId}`);
        return;
      }

      logPurchaseLinePayloads(payload.items);
      const response = await api.post("/purchases", payload, {
        headers: { "Idempotency-Key": purchaseSaveId },
      });
      const record = normalizePurchase({
        id: response?.purchase?.id || generateCode("pur"),
        invoice_number: response?.purchase?.purchase_number || undefined,
        purchase_number: response?.purchase?.purchase_number || undefined,
        supplier_name: suppliers.find((supplier) => String(supplier.id) === String(supplierId))?.name || "Unknown",
        warehouse_name: warehouses.find((warehouse) => String(warehouse.id) === String(warehouseId))?.name || "Main Warehouse",
        status: nextStatus,
        payment_status: normalizedPaymentStatus === "partial" ? "partially_paid" : normalizedPaymentStatus,
        paid_amount: effectiveSupplierPaidAmount,
        supplier_payment_status: normalizedPaymentStatus,
        supplier_paid_amount: effectiveSupplierPaidAmount,
        remaining_amount: effectiveSupplierRemainingAmount,
        payment_method: normalizedPaymentMethodForPayload,
        financial_account_id: normalizedFinancialAccountId,
        total,
        subtotal,
        tax: 0,
        discount,
        notes: internalNotes,
        created_at: new Date().toISOString(),
        items: normalizedItems,
      });

      saveLocalPurchases([record, ...getLocalPurchases().map(normalizePurchase)]);
      notifyProductsChanged();
      toast.success(t(nextStatus === "received" ? "purchases.create.postedAndReceived" : "purchases.create.orderSaved"));
      purchaseSaveIdRef.current = "";
      navigate("/purchases");
    } catch (err) {
      console.error("[purchase-create-ui-failed]", err);
      const message =
        err?.responseBody?.error ||
        err?.responseBody?.detail ||
        err?.responseBody?.details ||
        err?.responseBody?.message ||
        err?.message ||
        t("purchases.create.postFailed");
      setPostError(message);
      toast.error(message);
    } finally {
      releasePostingLock();
    }
  };

  const activeSupplier = suppliers.find((supplier) => String(supplier.id) === String(supplierId));

  return (
    <FlowShell
      compact
      wide={isFullscreen}
      shellRef={purchaseShellRef}
      title={t("purchases.create.title")}
      subtitle={t("purchases.create.subtitle")}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleToggleFullscreen}
            aria-label={isArabic ? "ملء الشاشة" : "Fullscreen"}
            aria-pressed={isFullscreen}
            title={isArabic ? "ملء الشاشة" : "Fullscreen"}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.05] text-zinc-200 shadow-[0_0_18px_rgba(0,0,0,0.18)] transition hover:border-white/20 hover:bg-white/[0.09] hover:text-white"
          >
            {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
          {isEditMode && editPurchase ? (
            <button type="button" onClick={() => navigate(`/purchases/${editPurchase.id || editPurchaseId}`)} className="inline-flex h-9 items-center gap-2 rounded-xl border border-amber-300/25 bg-amber-400/10 px-3 text-xs font-black text-amber-100 transition hover:border-amber-300/45 hover:bg-amber-400/15">
              <X className="h-4 w-4" />
              Cancel edit
            </button>
          ) : null}
          <button type="button" onClick={() => setProductModalOpen(true)} className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-white/10">
            <PackagePlus className="h-4 w-4" />
            {t("purchases.create.newProduct")}
          </button>
          <Link to="/purchases" className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-white/10">
            {t("purchases.create.backToDashboard")}
          </Link>
        </div>
      }
      tabs={[
        { to: "/purchases", label: t("purchases.tabs.purchases"), end: true },
        { to: "/purchases/create", label: t("purchases.tabs.createPo") },
        { to: "/purchases/reorder-suggestions", label: t("purchases.tabs.smartReorder") },
        { to: "/suppliers", label: t("purchases.tabs.suppliers") },
        { to: "/inventory", label: t("purchases.tabs.inventory") },
        { to: "/warehouses", label: t("purchases.tabs.warehouses") },
      ]}
    >
      {error ? <Banner tone="amber" message={error} /> : null}
      {postError ? <Banner tone="rose" message={postError} /> : null}
      {isEditMode && editPurchase ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-300/25 bg-amber-400/10 px-4 py-3 text-sm font-black text-amber-100 shadow-xl shadow-black/10">
          <div>
            <span>Editing {editPurchase.invoice_number || editPurchase.purchase_number || `INV-${editPurchase.id}`}</span>
            {!purchaseCanEditDestructively(editPurchase) ? (
              <div className="mt-1 text-xs font-semibold text-amber-200/80">
                {t("purchases.details.receivedEditWarning")}
              </div>
            ) : null}
          </div>
          <button type="button" onClick={() => navigate(`/purchases/${editPurchase.id || editPurchaseId}`)} className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-black text-white transition hover:bg-white/10">
            <X className="h-4 w-4" />
            Cancel edit
          </button>
        </div>
      ) : null}

      <div className="sticky top-0 z-20 rounded-2xl border border-white/10 bg-zinc-950/95 p-2 shadow-2xl shadow-black/20 backdrop-blur">
        <div className="grid gap-2 lg:grid-cols-[minmax(10rem,1fr)_minmax(10rem,0.9fr)_minmax(9rem,0.8fr)_minmax(16rem,1.35fr)_auto]">
          <Select label={t("purchases.filters.supplier")} value={supplierId} onChange={setSupplierId} options={suppliers.map((supplier) => ({ value: supplier.id, label: `${supplier.supplier_code ? `${supplier.supplier_code} - ` : ""}${supplier.name}` }))} emptyLabel={t("purchases.create.createSupplierFirst")} />
          <Select label={t("purchases.filters.warehouse")} value={warehouseId} onChange={setWarehouseId} options={warehouses.map((warehouse) => ({ value: warehouse.id, label: warehouse.name }))} emptyLabel={t("purchases.create.mainWarehouse")} />
          {branches.length > 1 ? <Select label={t("purchases.filters.branch")} value={branchId} onChange={setBranchId} options={branches.map((branch) => ({ value: branch.id, label: branch.name }))} emptyLabel={t("purchases.create.allBranches")} /> : null}
          <div ref={searchPanelWrapRef} className="relative">
            <div className="mb-1.5 flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-zinc-500">
              <Barcode className="h-3.5 w-3.5" />
              {t("purchases.create.searchBarcode")}
            </div>
            <Search className="pointer-events-none absolute start-3 top-[1.9rem] h-4 w-4 text-zinc-500" />
            <input
              ref={searchRef}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={handleBarcodeSubmit}
              onFocus={() => setProductPickerOpen(true)}
              placeholder={t("purchases.create.searchProductPlaceholder")}
              className="h-9 w-full rounded-xl border border-white/10 bg-black/35 py-2 pe-3 ps-9 text-sm font-semibold text-white outline-none transition placeholder:text-zinc-500 focus:border-emerald-400/50 focus:shadow-[0_0_0_3px_rgba(16,185,129,0.12)]"
            />
            {productPickerOpen ? <ProductSearchPanel search={search} products={products} results={filteredProducts} loading={productsLoading} onAdd={addProduct} /> : null}
          </div>
          <div className="flex items-end gap-2">
            <button type="button" onClick={() => setSupplierModalOpen(true)} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white hover:bg-white/10">
              {t("purchases.filters.supplier")}
            </button>
            <button type="button" onClick={() => setRunModal({ mode: "size", product: groupedCards[0] || null })} className="rounded-xl bg-emerald-500 px-3 py-2 text-xs font-black text-black disabled:opacity-40" disabled={!groupedCards.length}>
              {t("purchases.create.sizeRun")}
            </button>
          </div>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-3 xl:grid-cols-[minmax(0,48%)_minmax(0,52%)]">
        <div className="order-2 min-w-0 xl:order-1">
          <PurchaseCart
            items={items}
            variantsByProduct={variantsByProduct}
            subtotal={subtotal}
            expenses={expenses}
            discount={discount}
            total={total}
            supplierPaymentStatus={supplierPaymentStatus}
            supplierPaidAmount={supplierPaidAmount}
            paymentMethod={paymentMethod}
            paymentAccountId={paymentAccountId}
            paymentStatusOptions={paymentStatusOptions}
            paymentMethodOptions={paymentMethodOptions}
            paymentAccounts={availablePaymentAccounts}
            selectedPaymentAccount={selectedPaymentAccount}
            posting={posting}
            activeSupplier={activeSupplier}
            cartCostErrors={cartCostErrors}
            onChangeVariant={changeItemVariant}
            onUpdate={updateItem}
            onQty={changeQty}
            onRemove={removeItem}
            onDiscount={setDiscount}
            onSupplierPaymentStatus={handlePaymentStatusChange}
            onSupplierPaidAmount={setSupplierPaidAmount}
            onPaymentMethodChange={handlePaymentMethodChange}
            onPaymentAccountChange={handlePaymentAccountChange}
            onBulkPrice={setBulkPriceModal}
            onSaveInvoice={() => postPurchase("received")}
            saveLabel={isEditMode ? "Save changes" : undefined}
          />
        </div>

        {productPanelExpanded ? (
          <button
            type="button"
            className="fixed inset-0 z-40 cursor-default bg-black/65 backdrop-blur-sm"
            onClick={() => {
              setProductPanelExpanded(false);
              setProductPickerOpen(false);
            }}
            aria-label="إغلاق لوحة المنتج"
          />
        ) : null}

        <div
          ref={productPanelRef}
          className={`order-1 min-w-0 space-y-3 transition-all duration-300 ease-out xl:order-2 ${
            productPanelExpanded
              ? "fixed inset-3 z-50 flex flex-col overflow-hidden rounded-3xl border border-white/10 bg-zinc-950/98 p-3 shadow-2xl shadow-black/60 sm:inset-5"
              : ""
          }`}
        >
          {productPanelExpanded ? (
            <button
              type="button"
              onClick={() => {
                setProductPanelExpanded(false);
                setProductPickerOpen(false);
              }}
              className="fixed right-6 top-6 z-[60] inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-zinc-950/95 text-white shadow-2xl shadow-black/40 transition hover:bg-white/10 sm:right-8 sm:top-8"
              aria-label="طي لوحة المنتج"
              title="طي لوحة المنتج"
            >
              <Minimize2 className="h-4 w-4" />
            </button>
          ) : null}

          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <ActionTile icon={<Boxes className="h-5 w-5" />} label={t("purchases.create.addFullModel")} onClick={() => setRunModal({ mode: "full", product: groupedCards[0] || null })} disabled={!groupedCards.length} />
            <ActionTile icon={<ReceiptText className="h-5 w-5" />} label={t("purchases.create.addSizeRun")} onClick={() => setRunModal({ mode: "size", product: groupedCards[0] || null })} disabled={!groupedCards.length} />
            <ActionTile icon={<Building2 className="h-5 w-5" />} label={t("purchases.create.addColorRun")} onClick={() => setRunModal({ mode: "color", product: groupedCards[0] || null })} disabled={!groupedCards.length} />
            <ActionTile icon={<Truck className="h-5 w-5" />} label={t("purchases.create.cartonMode")} onClick={() => setRunModal({ mode: "carton", product: groupedCards[0] || null })} disabled={!groupedCards.length} />
          </div>

          <section className={`min-w-0 overflow-hidden rounded-2xl border border-white/10 bg-white/5 p-2 shadow-xl shadow-black/10 backdrop-blur transition-all duration-300 ${productPanelExpanded ? "flex min-h-0 flex-1 flex-col" : ""}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">{t("purchases.create.productCards")}</div>
                <h3 className="mt-0.5 text-lg font-black text-white">{t("purchases.create.variantProcurementGrid")}</h3>
              </div>
              <div className="flex items-center gap-2">
                <div className="text-xs text-zinc-400">{t("purchases.create.variantsCount", { count: filteredProducts.length })}</div>
                <button
                  type="button"
                  onClick={() => {
                    setProductPanelExpanded((next) => !next);
                    setProductPickerOpen(false);
                  }}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-zinc-200 transition hover:border-emerald-300/30 hover:bg-emerald-400/10 hover:text-white"
                  aria-label={productPanelExpanded ? "طي لوحة المنتج" : "توسيع لوحة المنتج"}
                  title={productPanelExpanded ? "طي لوحة المنتج" : "توسيع لوحة المنتج"}
                >
                  {productPanelExpanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                </button>
                {productPanelExpanded ? (
                  <button
                    type="button"
                    onClick={() => {
                      setProductPanelExpanded(false);
                      setProductPickerOpen(false);
                    }}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-zinc-200 transition hover:border-rose-300/30 hover:bg-rose-400/10 hover:text-white"
                    aria-label="إغلاق لوحة المنتج"
                    title="إغلاق لوحة المنتج"
                  >
                    <X className="h-4 w-4" />
                  </button>
                ) : null}
              </div>
            </div>
            {productsLoading ? (
              <CardSkeleton />
            ) : groupedCards.length === 0 ? (
              <div className="mt-3 rounded-2xl border border-dashed border-white/10 bg-white/5 p-8 text-center">
                <PackagePlus className="mx-auto h-12 w-12 text-zinc-500" />
                <h3 className="mt-4 text-xl font-black text-white">{t("purchases.create.noProductsFound")}</h3>
                <button type="button" onClick={() => setProductModalOpen(true)} className="mt-4 rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-black text-black">
                  {t("purchases.create.addProduct")}
                </button>
              </div>
            ) : (
              <div className={`mt-3 grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2.5 ${productPanelExpanded ? "min-h-0 flex-1 overflow-y-auto pr-1" : ""}`}>
                {groupedCards.map((group) => (
                  <ProductCard
                    key={String(group.product_id)}
                    group={group}
                    purchaseQtyLabel={purchaseQtyLabels.button}
                    onClick={() => addProductCard(group)}
                    onSizeRun={() => setRunModal({ mode: "size", product: group })}
                    onColorRun={() => setRunModal({ mode: "color", product: group })}
                    onUsePurchaseQty={() => openPurchaseQtyPreview(group)}
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      </div>

      {variantSelector ? <VariantSelector group={variantSelector} onAdd={addProduct} onClose={() => setVariantSelector(null)} /> : null}
      {runModal ? <RunModal mode={runModal.mode} initialProduct={runModal.product} productGroups={groupByProduct(products)} onClose={() => setRunModal(null)} onAdd={addRunItems} /> : null}
      {bulkPriceModal === "model-pricing" ? (
        <BulkModelPricingModal
          items={items}
          onClose={() => setBulkPriceModal(null)}
          onApply={applyModelPrices}
        />
      ) : bulkPriceModal ? (
        <BulkPriceModal mode={bulkPriceModal} items={items} onClose={() => setBulkPriceModal(null)} onApply={(payload) => applyBulkPrice({ type: bulkPriceModal, ...payload })} />
      ) : null}
      {purchaseQtyModal ? <ProductPurchaseQtyModal data={purchaseQtyModal} onClose={() => setPurchaseQtyModal(null)} onApply={() => applyProductPurchaseQty(purchaseQtyModal.group)} /> : null}
      {supplierModalOpen ? <QuickSupplierModal form={supplierForm} setForm={setSupplierForm} saving={supplierSaving} error={supplierError} onClose={() => setSupplierModalOpen(false)} onSubmit={saveSupplierFromOrder} /> : null}
      {productModalOpen ? <QuickProductModal form={productForm} setForm={setProductForm} saving={productSaving} error={productError} onClose={() => setProductModalOpen(false)} onSubmit={createInlineProduct} /> : null}
      {confirmReceivedEditSave ? (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-black/75 p-4 backdrop-blur">
          <div className="w-full max-w-md rounded-3xl border border-amber-400/20 bg-zinc-950 p-5 shadow-2xl">
            <h3 className="text-xl font-black text-white">{t("purchases.details.confirmReceivedEdit")}</h3>
            <p className="mt-3 text-sm font-semibold leading-6 text-amber-100">
              {t("purchases.details.receivedSaveWarning")}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmReceivedEditSave(false)} disabled={posting} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{t("common.cancel")}</button>
              <button type="button" onClick={() => postPurchase("received", { confirmReceivedEdit: true })} disabled={posting} className="rounded-2xl bg-emerald-500 px-4 py-2 text-sm font-black text-black disabled:opacity-60">{posting ? t("purchases.details.savingAdjustments") : t("purchases.details.saveAdjustments")}</button>
            </div>
          </div>
        </div>
      ) : null}
    </FlowShell>
  );
}

function Banner({ tone, message }) {
  const classes = tone === "rose" ? "border-rose-500/20 bg-rose-500/10 text-rose-100" : "border-amber-500/20 bg-amber-500/10 text-amber-100";
  return (
    <div className={`rounded-2xl border p-3 text-sm ${classes}`}>
      <AlertTriangle className="mr-2 inline h-4 w-4" />
      {message}
    </div>
  );
}

function ActionTile({ icon, label, onClick, disabled }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="flex min-h-12 items-center gap-2 rounded-xl border border-white/10 bg-white/5 p-2.5 text-left transition hover:border-emerald-400/30 hover:bg-emerald-400/10 disabled:opacity-40">
      <span className="rounded-lg bg-emerald-500/10 p-1.5 text-emerald-300">{icon}</span>
      <span className="text-xs font-black text-white">{label}</span>
    </button>
  );
}

function ProductCard({ group, purchaseQtyLabel, onClick, onSizeRun, onColorRun, onUsePurchaseQty }) {
  const { t } = useTranslation();
  const variants = toArray(group.variants);
  const first = variants[0] || {};

  return (
    <div className="group overflow-hidden rounded-xl border border-white/10 bg-white/[0.04] transition hover:border-emerald-400/30 hover:bg-white/[0.07]">
      <button type="button" onClick={onClick} className="block w-full text-left">
        <div className="aspect-[5/3] bg-zinc-900">
          <ProductImage src={group.image_url || first.image_url} name={group.product_name} className="h-full w-full object-cover" />
        </div>
        <div className="p-2.5">
          <div className="line-clamp-1 text-sm font-black text-white">{group.product_name}</div>
          <div className="mt-1 text-xs text-zinc-500">{first.sku || first.barcode ? `SKU ${first.sku || first.barcode}` : t("purchases.create.variantsCount", { count: variants.length })}</div>
        </div>
      </button>
      <div className="grid grid-cols-1 border-t border-white/10 sm:grid-cols-3">
        <button type="button" onClick={onSizeRun} className="px-2 py-1.5 text-[11px] font-black text-emerald-300 hover:bg-white/5">{t("purchases.create.sizeRun")}</button>
        <button type="button" onClick={onColorRun} className="border-t border-white/10 px-2 py-1.5 text-[11px] font-black text-cyan-300 hover:bg-white/5 sm:border-l sm:border-t-0">{t("purchases.create.colorRun")}</button>
        <button type="button" onClick={onUsePurchaseQty} className="inline-flex items-center justify-center gap-1.5 border-t border-white/10 px-2 py-1.5 text-[11px] font-black text-amber-200 hover:bg-amber-400/10 sm:border-l sm:border-t-0">
          <ClipboardCheck className="h-3.5 w-3.5" />
          {purchaseQtyLabel}
        </button>
      </div>
    </div>
  );
}

function ProductImage({ src, name, className = "h-12 w-12 rounded-xl object-cover" }) {
  const [failed, setFailed] = useState(false);
  const imageUrl = resolveProductImageUrl(src);
  useEffect(() => {
    setFailed(false);
  }, [imageUrl]);
  if (imageUrl && !failed) return <img src={imageUrl} alt="" className={className} loading="lazy" onError={() => setFailed(true)} />;
  return <div className={`${className} flex items-center justify-center bg-white/5 text-lg font-black text-zinc-500`}>{String(name || "?").slice(0, 1).toUpperCase()}</div>;
}

function ColorIdentity({ color, variant, productName, sizes = 0, compact = false }) {
  const { t } = useTranslation();
  const swatch = colorSwatchValue(variant?.color_hex);
  const showSwatch = isHexColor(swatch);
  const imageSrc = firstText(variant?.variant_image_url, variant?.color_image, variant?.color_image_url, variant?.image_url);
  return (
    <div className={`rounded-2xl border border-white/10 bg-black/20 ${compact ? "p-2" : "p-3"}`}>
      <div className={`grid items-center gap-3 ${compact ? "grid-cols-[2.5rem_minmax(0,1fr)]" : "grid-cols-[4.5rem_minmax(0,1fr)]"}`}>
        <ProductImage
          src={imageSrc}
          name={productName || color}
          className={`${compact ? "h-10 w-10 rounded-xl" : "h-20 w-full rounded-2xl"} object-cover ring-1 ring-white/10`}
        />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {showSwatch ? <span className="h-3.5 w-3.5 shrink-0 rounded-full border border-white/30" style={{ backgroundColor: swatch }} /> : null}
            <div className="truncate text-sm font-black text-white">{color || t("purchases.create.defaultVariant")}</div>
          </div>
          <div className="mt-1 truncate text-xs text-zinc-500">{productName || t("purchases.create.variantColor")}</div>
          {sizes ? <div className="mt-1 text-[11px] font-semibold text-emerald-300">{t("purchases.create.sizesCount", { count: sizes })}</div> : null}
        </div>
      </div>
    </div>
  );
}

function ColorImageDropdown({ label = "Color", value, onChange, options = [], productName }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef(null);
  const filteredOptions = options.filter((option) => normalizeKey(option.color).includes(normalizeKey(query)));
  const selectedOption = options.find((option) => String(option.color) === String(value)) || options[0] || null;

  useEffect(() => {
    if (!open) return undefined;
    const handlePointer = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    const handleKey = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const selectedIndex = Math.max(0, filteredOptions.findIndex((option) => String(option.color) === String(value)));
    setActiveIndex(selectedIndex);
  }, [filteredOptions.length, open, value]);

  const chooseOption = (option) => {
    if (!option) return;
    onChange(option.color);
    setOpen(false);
    setQuery("");
  };

  const handleButtonKey = (event) => {
    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setOpen(true);
    }
  };

  const handleListKey = (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => Math.min(filteredOptions.length - 1, index + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(0, index - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      chooseOption(filteredOptions[activeIndex]);
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-zinc-500">{label}</div>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((next) => !next)}
        onKeyDown={handleButtonKey}
        className="flex w-full items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/5 p-2 text-left outline-none transition hover:border-emerald-400/40 focus:border-emerald-400/60"
      >
        {selectedOption ? (
          <div className="min-w-0 flex-1">
            <ColorIdentity color={selectedOption.color} variant={selectedOption.variant} productName={productName} sizes={selectedOption.count} compact />
          </div>
        ) : (
          <span className="px-2 py-3 text-sm font-semibold text-zinc-500">{t("purchases.create.noColors")}</span>
        )}
        <ChevronDown className={`h-4 w-4 shrink-0 text-zinc-400 transition ${open ? "rotate-180" : ""}`} />
      </button>

      {open ? (
        <div className="absolute left-0 right-0 top-full z-30 mt-2 overflow-hidden rounded-2xl border border-white/10 bg-zinc-950 shadow-2xl shadow-black/60">
          <div className="border-b border-white/10 p-2">
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={handleListKey}
              placeholder={t("purchases.create.searchColor")}
              className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-emerald-400/50"
            />
          </div>
          <div role="listbox" tabIndex={-1} onKeyDown={handleListKey} className="max-h-72 overflow-y-auto p-2">
            {filteredOptions.length ? (
              filteredOptions.map((option, index) => {
                const selected = String(option.color) === String(value);
                const active = index === activeIndex;
                return (
                  <button
                    key={option.color}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => chooseOption(option)}
                    className={`mb-2 w-full rounded-2xl text-left transition last:mb-0 ${selected ? "ring-1 ring-emerald-400/70" : ""} ${active ? "bg-white/10" : "hover:bg-white/5"}`}
                  >
                    <ColorIdentity color={option.color} variant={option.variant} productName={productName} sizes={option.count} compact />
                  </button>
                );
              })
            ) : (
              <div className="px-3 py-4 text-sm font-semibold text-zinc-500">{t("purchases.create.noMatchingColors")}</div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Badge({ tone = "zinc", label }) {
  const classes = {
    amber: "bg-amber-400 text-black",
    emerald: "bg-emerald-400 text-black",
    cyan: "bg-cyan-400 text-black",
    rose: "bg-rose-400 text-black",
    zinc: "bg-white/10 text-white",
  };
  return <span className={`rounded-full px-2 py-1 text-[10px] font-black uppercase ${classes[tone]}`}>{label}</span>;
}

function Metric({ label, value }) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/20 p-2">
      <div className="text-[10px] uppercase text-zinc-500">{label}</div>
      <div className="mt-1 truncate font-bold text-white">{value}</div>
    </div>
  );
}

function PurchaseCart({
  compact = false,
  items,
  variantsByProduct,
  subtotal,
  expenses,
  discount,
  total,
  supplierPaymentStatus,
  supplierPaidAmount,
  paymentMethod,
  paymentAccountId,
  paymentStatusOptions,
  paymentMethodOptions,
  paymentAccounts,
  selectedPaymentAccount,
  posting,
  activeSupplier,
  cartCostErrors = new Set(),
  onChangeVariant,
  onUpdate,
  onQty,
  onRemove,
  onDiscount,
  onSupplierPaymentStatus,
  onSupplierPaidAmount,
  onPaymentMethodChange,
  onPaymentAccountChange,
  onBulkPrice,
  onSaveInvoice,
  onClose,
  saveLabel,
}) {
  const { t, i18n } = useTranslation();
  const isArabic = String(i18n.language || "").toLowerCase().startsWith("ar");
  const hasItems = items.length > 0;
  const labels = isArabic
    ? {
        supplierPayment: "حالة دفع فاتورة المورد",
        unpaid: "غير مسددة",
        paid: "مسددة",
        partial: "مسددة جزئيًا",
        paidAmount: "المبلغ المدفوع",
        grandTotal: "الإجمالي",
        saveInvoice: "حفظ الفاتورة",
        saving: "جارٍ الحفظ...",
      }
    : {
        supplierPayment: "Supplier Invoice Payment",
        unpaid: "Unpaid",
        paid: "Paid",
        partial: "Partially Paid",
        paidAmount: "Paid Amount",
        grandTotal: "Grand total",
        saveInvoice: "Save Invoice",
        saving: "Saving...",
      };

  return (
    <aside className={`${compact ? "flex max-h-[82vh] flex-col" : "flex max-h-none flex-col xl:sticky xl:top-20 xl:max-h-[calc(100vh-6rem)]"} min-w-0 overflow-hidden rounded-2xl border border-white/10 bg-zinc-950/90 shadow-2xl shadow-black/10`}>
      <div className="flex shrink-0 items-center justify-between border-b border-white/10 p-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">{t("purchases.create.purchaseCart")}</div>
          <h3 className="mt-0.5 text-lg font-black text-white">{formatCurrency(total)}</h3>
          {activeSupplier ? <div className="mt-1 text-xs text-zinc-500">{activeSupplier.name}</div> : null}
        </div>
        <div className="flex items-center gap-2">
          {onClose ? <button type="button" onClick={onClose} className="rounded-xl border border-white/10 bg-white/5 p-2 text-white"><X className="h-4 w-4" /></button> : null}
        </div>
      </div>

      <div className="shrink-0 border-b border-white/10 p-2.5">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
          <button
            type="button"
            onClick={() => onBulkPrice?.("purchase")}
            disabled={!hasItems}
            className="group inline-flex min-h-9 items-center justify-center gap-1.5 rounded-xl border border-emerald-400/25 bg-emerald-400/10 px-2 py-1.5 text-[11px] font-black text-emerald-100 shadow-lg shadow-emerald-950/10 transition hover:border-emerald-300/60 hover:bg-emerald-400/20 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ReceiptText className="h-4 w-4 text-emerald-300" />
            سعر شراء جماعي
          </button>
          <button
            type="button"
            onClick={() => onBulkPrice?.("selling")}
            disabled={!hasItems}
            className="group inline-flex min-h-9 items-center justify-center gap-1.5 rounded-xl border border-cyan-400/25 bg-cyan-400/10 px-2 py-1.5 text-[11px] font-black text-cyan-100 shadow-lg shadow-cyan-950/10 transition hover:border-cyan-300/60 hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ShoppingCart className="h-4 w-4 text-cyan-300" />
            سعر بيع جماعي
          </button>
          <button
            type="button"
            onClick={() => onBulkPrice?.("sale")}
            disabled={!hasItems}
            className="group inline-flex min-h-9 items-center justify-center gap-1.5 rounded-xl border border-amber-400/25 bg-amber-400/10 px-2 py-1.5 text-[11px] font-black text-amber-100 shadow-lg shadow-amber-950/10 transition hover:border-amber-300/60 hover:bg-amber-400/20 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Percent className="h-4 w-4 text-amber-300" />
            سعر خصم جماعي
          </button>
        </div>
        <p className="mt-1.5 text-[11px] leading-4 text-zinc-500">
          {t("purchases.create.bulkChangesHelper")}
        </p>
      </div>

      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-2">
        {items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/10 bg-white/5 p-6 text-center text-sm text-zinc-400">
            {t("purchases.create.emptyCartHelper")}
          </div>
        ) : (
          items.map((item) => (
            <CartLine key={String(item.line_id)} item={item} variants={variantsByProduct[String(item.product_id)] || []} showCostError={cartCostErrors.has(String(item.line_id))} onChangeVariant={onChangeVariant} onUpdate={onUpdate} onQty={onQty} onRemove={onRemove} />
          ))
        )}
      </div>

      <div className="sticky bottom-0 shrink-0 border-t border-white/10 bg-zinc-950/95 p-3 backdrop-blur">
        <div className="grid grid-cols-2 gap-2">
          <Summary label={t("purchases.details.subtotal")} value={formatCurrency(subtotal)} />
          <Summary label={t("purchases.create.expenses")} value={formatCurrency(expenses)} />
          <label className="rounded-xl border border-white/10 bg-white/5 p-2.5">
            <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">{t("purchases.create.orderDiscount")}</div>
            <input type="number" min="0" value={discount} onChange={(event) => onDiscount(money(event.target.value))} className="mt-1 w-full bg-transparent text-sm font-semibold text-white outline-none" />
          </label>
        </div>
        <div className="mt-2 flex items-center justify-between rounded-xl bg-emerald-500 px-3 py-2.5 text-black">
          <span className="text-sm font-black">{labels.grandTotal}</span>
          <span className="text-lg font-black">{formatCurrency(total)}</span>
        </div>
        <div className="mt-2 rounded-2xl border border-white/10 bg-white/[0.04] p-3">
          <div className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-200">{isArabic ? "طريقة الدفع والحساب" : "Payment method & account"}</div>
          <div className="mt-2 grid gap-2">
            <Select
              label={labels.supplierPayment}
              value={supplierPaymentStatus}
              onChange={onSupplierPaymentStatus}
              options={paymentStatusOptions}
            />
            {supplierPaymentStatus !== "unpaid" ? (
              <>
                <Select
                  label={isArabic ? "طريقة الدفع" : "Payment method"}
                  value={paymentMethod}
                  onChange={onPaymentMethodChange}
                  options={paymentMethodOptions}
                  emptyLabel={isArabic ? "اختر طريقة الدفع" : "Choose a payment method"}
                />
                <Select
                  label={isArabic ? "الحساب المالي" : "Financial account"}
                  value={paymentAccountId}
                  onChange={onPaymentAccountChange}
                  options={paymentAccounts.map((account) => ({
                    value: String(account.id),
                    label: `${account.name}${account.provider ? ` - ${account.provider}` : ""}${account.branch_name ? ` - ${account.branch_name}` : ""}`,
                  }))}
                  emptyLabel={isArabic ? "اختر الحساب" : "Choose an account"}
                />
                {supplierPaymentStatus === "partial" ? (
                  <label className="block rounded-xl border border-white/10 bg-white/5 p-2.5">
                    <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">{labels.paidAmount}</div>
                    <input type="number" min="0" max={total} value={supplierPaidAmount} onChange={(event) => onSupplierPaidAmount(money(event.target.value))} className="mt-1 w-full bg-transparent text-sm font-semibold text-white outline-none" />
                  </label>
                ) : null}
              </>
            ) : null}
            <div className="grid grid-cols-2 gap-2">
              <Summary label={isArabic ? "طريقة الدفع" : "Payment method"} value={supplierPaymentStatus === "unpaid" ? (isArabic ? "آجل" : "Credit") : paymentMethodLabel(paymentMethod, isArabic)} />
              <Summary label={isArabic ? "الحساب" : "Account"} value={supplierPaymentStatus === "unpaid" ? (isArabic ? "لا يوجد" : "None") : selectedPaymentAccount?.name || selectedPaymentAccount?.account_name || (isArabic ? "غير محدد" : "Not selected")} />
              <Summary label={labels.paidAmount} value={formatCurrency(supplierPaymentStatus === "paid" ? total : supplierPaidAmount)} />
              <Summary label={isArabic ? "المتبقي" : "Remaining"} value={formatCurrency(supplierPaymentStatus === "partial" ? Math.max(0, total - supplierPaidAmount) : supplierPaymentStatus === "paid" ? 0 : total)} />
            </div>
            <button type="button" onClick={onSaveInvoice} disabled={posting || !hasItems} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-black text-black transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40">
              {posting ? labels.saving : saveLabel || labels.saveInvoice}
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}

function CartLine({ item, variants, showCostError = false, onChangeVariant, onUpdate, onQty, onRemove }) {
  const { i18n } = useTranslation();
  const isArabic = String(i18n.language || "").toLowerCase().startsWith("ar");
  const sellingPrice = money(item.selling_price ?? item.price ?? 0);
  const salePrice = Math.max(0, money(item.sale_price));
  const purchasePrice = money(item.cost_price);
  const saleBelowCost = salePrice > 0 && salePrice < purchasePrice;
  const saleAboveSelling = salePrice > sellingPrice;
  const lineTotal = money(item.quantity) * purchasePrice;
  const numberInputClass = "h-5 w-full bg-transparent text-right text-xs font-semibold text-white outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none";
  const labels = {
    quantity: "الكمية",
    purchasePrice: "سعر الشراء",
    sellingPrice: "سعر البيع",
    salePrice: "سعر الخصم",
    variant: "المتغير",
    total: "الإجمالي",
    lastPurchase: "آخر شراء",
    enterCost: "أدخل سعر الشراء",
    saleOptional: "اختياري للتخفيضات والعروض",
    belowCost: "سعر الخصم أقل من سعر الشراء",
    aboveSelling: "سعر الخصم أعلى من سعر البيع",
  };

  return (
    <div className="relative rounded-xl border border-white/10 bg-white/[0.035] p-2 transition hover:border-white/15 hover:bg-white/[0.055]">
      <button type="button" onClick={() => onRemove(item.line_id)} className="absolute end-2 top-2 flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 bg-black/25 text-zinc-300 transition hover:border-rose-300/35 hover:bg-rose-500/10 hover:text-rose-100">
        <Trash2 className="h-3.5 w-3.5" />
      </button>

      <div className="flex min-w-0 items-center gap-2 pe-8">
        <ProductImage src={item.image_url} name={item.product_name} className="h-10 w-10 shrink-0 rounded-lg object-cover" />
        <div className="min-w-0">
          <div className="truncate text-[13px] font-black leading-5 text-white">{item.product_name}</div>
          <div className="truncate text-[10px] font-semibold leading-4 text-zinc-500">
            {item.barcode || item.sku || "بدون SKU"} • {item.color || "افتراضي"} / {item.size || "مقاس واحد"}
          </div>
        </div>
      </div>

      <div className="mt-2 grid min-w-0 grid-cols-2 gap-1.5 sm:grid-cols-[minmax(6.5rem,0.95fr)_7.75rem_minmax(5.5rem,1fr)_minmax(5.5rem,1fr)_minmax(5.5rem,1fr)_auto]">
        <label className="min-w-0 rounded-lg border border-white/10 bg-zinc-950/45 px-2 py-1">
          <div className="truncate text-[8px] font-black uppercase tracking-[0.1em] text-zinc-500">{labels.variant}</div>
          {variants.length > 1 ? (
            <select value={item.variant_id || ""} onChange={(event) => onChangeVariant(item.line_id, event.target.value)} className="h-5 w-full bg-transparent text-[11px] font-semibold text-zinc-200 outline-none focus:text-white">
              {variants.map((variant) => (
                <option key={variant.line_id} value={variant.variant_id || ""}>
                  {variant.color || "افتراضي"} / {variant.size || "مقاس واحد"}
                </option>
              ))}
            </select>
          ) : (
            <div className="h-5 truncate text-[11px] font-semibold leading-5 text-zinc-400">
              {item.color || "افتراضي"} / {item.size || "مقاس واحد"}
            </div>
          )}
        </label>

        <label className="rounded-lg border border-white/10 bg-white/5 px-2 py-1">
          <div className="text-[8px] font-black uppercase tracking-[0.1em] text-zinc-500">{labels.quantity}</div>
          <div className="flex h-5 items-center">
            <button type="button" onClick={() => onQty(item.line_id, -1)} className="flex h-5 w-7 items-center justify-center rounded-md text-zinc-300 hover:bg-white/5 hover:text-white"><Minus className="h-3 w-3" /></button>
            <input type="number" min="1" value={item.quantity} onChange={(event) => onUpdate(item.line_id, { quantity: Math.max(1, money(event.target.value)) })} className="h-5 min-w-0 flex-1 bg-transparent text-center text-sm font-black text-white outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" dir="ltr" />
            <button type="button" onClick={() => onQty(item.line_id, 1)} className="flex h-5 w-7 items-center justify-center rounded-md text-zinc-300 hover:bg-white/5 hover:text-white"><Plus className="h-3 w-3" /></button>
          </div>
        </label>

        <label className={`rounded-lg border px-2 py-1 ${showCostError ? "border-rose-400/60 bg-rose-500/10" : "border-emerald-400/20 bg-emerald-400/8"}`}>
          <div className="truncate text-[8px] font-black uppercase tracking-[0.1em] text-emerald-200">{labels.purchasePrice}</div>
          <input type="number" min="0" step="0.01" value={item.cost_price} onChange={(event) => onUpdate(item.line_id, { cost_price: money(event.target.value) })} className={`${numberInputClass} font-black`} dir="ltr" />
        </label>

        <label className="rounded-lg border border-white/10 bg-zinc-950/45 px-2 py-1">
          <div className="truncate text-[8px] font-black uppercase tracking-[0.1em] text-zinc-500">{labels.sellingPrice}</div>
          <input type="number" min="0" step="0.01" value={sellingPrice} onChange={(event) => onUpdate(item.line_id, { selling_price: money(event.target.value), price: money(event.target.value) })} className={`${numberInputClass} text-zinc-200`} dir="ltr" />
        </label>

        <label className={`rounded-lg border px-2 py-1 ${saleBelowCost || saleAboveSelling ? "border-amber-400/35 bg-amber-500/10" : "border-white/10 bg-zinc-950/35"}`} title={labels.saleOptional}>
          <div className="truncate text-[8px] font-black uppercase tracking-[0.1em] text-zinc-500">{labels.salePrice}</div>
          <input type="number" min="0" step="0.01" value={salePrice || ""} onChange={(event) => onUpdate(item.line_id, { sale_price: Math.max(0, money(event.target.value)) })} placeholder="0.00" className={`${numberInputClass} text-zinc-200 placeholder:text-zinc-700`} dir="ltr" />
        </label>

        <div className="col-span-2 flex min-h-[2.625rem] items-end justify-end sm:col-span-1 sm:justify-start">
          <div className="truncate pb-1 text-right text-[11px] font-black text-emerald-100 sm:text-left">
            {labels.total}: {formatCurrency(lineTotal)}
          </div>
        </div>
      </div>

      {(saleBelowCost || saleAboveSelling || showCostError || item.last_purchase_cost || item.last_purchase_date) ? (
        <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 text-[10px] font-semibold">
          <div className="min-w-0 truncate text-zinc-600">
            {labels.lastPurchase}: {formatCurrency(item.last_purchase_cost || item.cost_price || 0)} {item.last_purchase_date ? `| ${String(item.last_purchase_date).slice(0, 10)}` : ""}
          </div>
          <div className="flex flex-wrap justify-end gap-x-2 gap-y-0.5">
            {saleBelowCost ? <span className="text-amber-200">{labels.belowCost}</span> : null}
            {saleAboveSelling ? <span className="text-amber-200">{labels.aboveSelling}</span> : null}
            {showCostError ? <span className="text-rose-200">{labels.enterCost}</span> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
function ProductSearchPanel({ search, products, results, loading, onAdd }) {
  const { t } = useTranslation();
  const hasSearch = Boolean(text(search));
  const hasProducts = Array.isArray(products) && products.length > 0;
  const rows = Array.isArray(results) ? results.slice(0, 12) : [];

  return (
    <div className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-30 overflow-hidden rounded-2xl border border-white/10 bg-zinc-950 shadow-2xl shadow-black/40">
      <div className="border-b border-white/10 px-4 py-3 text-xs font-semibold text-zinc-400">
        {loading ? t("purchases.create.loadingProducts") : hasSearch ? t("purchases.create.matchingProducts") : t("purchases.create.startTypingProducts")}
      </div>
      {loading ? (
        <div className="px-4 py-5 text-sm text-zinc-400">{t("purchases.create.loadingProducts")}</div>
      ) : !hasProducts ? (
        <div className="px-4 py-5">
          <div className="text-sm font-semibold text-white">{t("purchases.create.noProductsFound")}</div>
          <Link to="/products/create" className="mt-3 inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-3 py-2 text-xs font-black text-black">
            <Plus className="h-4 w-4" /> {t("purchases.create.addProduct")}
          </Link>
        </div>
      ) : rows.length === 0 ? (
        <div className="px-4 py-5 text-sm text-zinc-400">{t("purchases.create.noMatchingProducts")}</div>
      ) : (
        <div className="max-h-96 overflow-y-auto p-2">
          {rows.map((product) => (
            <button key={product.line_id} type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => onAdd(product)} className="grid w-full grid-cols-[3rem_minmax(0,1fr)_auto] items-center gap-3 rounded-xl px-3 py-3 text-left transition hover:bg-white/10 focus:bg-white/10 focus:outline-none">
              <ProductImage src={product.image_url} name={product.product_name} />
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-white">{product.product_name}</div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-400">
                  <span>SKU {product.sku || t("purchases.supplierDetails.notAvailable")}</span>
                  <span>{product.color || t("purchases.create.defaultVariant")}</span>
                  <span>{product.size || t("purchases.create.oneSize")}</span>
                </div>
              </div>
              <div className="text-right text-xs">
                <div className="font-semibold text-zinc-200">{t("purchases.create.stockWithValue", { stock: product.stock })}</div>
                <div className="mt-1 text-emerald-300">{formatCurrency(product.cost_price || 0)}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function VariantSelector({ group, onAdd, onClose }) {
  const { t } = useTranslation();
  return (
    <Modal title={group.product_name} eyebrow={t("purchases.create.selectVariant")} onClose={onClose}>
      <div className="grid gap-2 sm:grid-cols-2">
        {toArray(group.variants).map((variant) => (
          <button key={variant.line_id} type="button" onClick={() => { onAdd(variant); onClose(); }} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-3 text-left hover:bg-white/10">
            <ProductImage src={variant.image_url} name={variant.product_name} />
            <div className="min-w-0">
              <div className="font-black text-white">{variant.color || t("purchases.create.defaultVariant")} / {variant.size || t("purchases.create.oneSize")}</div>
              <div className="text-xs text-zinc-500">{variant.sku || t("purchases.supplierDetails.notAvailable")} | {t("purchases.create.stockWithValue", { stock: variant.stock })}</div>
              <div className="text-xs text-emerald-300">{formatCurrency(variant.cost_price)}</div>
            </div>
          </button>
        ))}
      </div>
    </Modal>
  );
}

function ProductPurchaseQtyModal({ data, onClose, onApply }) {
  const { i18n } = useTranslation();
  const isArabic = String(i18n.language || "").toLowerCase().startsWith("ar");
  const rows = toArray(data?.rows);
  const labels = isArabic
    ? {
        eyebrow: "كميات الشراء",
        title: "استخدم كميات المنتج",
        description: "راجع الكميات المحفوظة قبل تطبيقها على سطور فاتورة الشراء الحالية فقط.",
        variant: "المقاس / اللون",
        current: "الكمية الحالية",
        saved: "كمية المنتج المحفوظة",
        next: "الكمية الجديدة",
        notSaved: "غير محفوظة",
        noChanges: "لا توجد كميات محفوظة قابلة للتطبيق",
        cancel: "إلغاء",
        apply: "تطبيق الكميات",
      }
    : {
        eyebrow: "Purchase quantities",
        title: "Use Product Purchase Qty",
        description: "Review saved product quantities before applying them to current purchase invoice lines only.",
        variant: "Size / color",
        current: "Current quantity",
        saved: "Saved product purchase qty",
        next: "New quantity",
        notSaved: "Not saved",
        noChanges: "No saved purchase quantities to apply",
        cancel: "Cancel",
        apply: "Apply quantities",
      };
  const canApply = rows.some((row) => row.savedQty !== null);

  return (
    <Modal eyebrow={labels.eyebrow} title={labels.title} onClose={onClose}>
      <div className="space-y-4" dir={isArabic ? "rtl" : "ltr"}>
        <div className="rounded-3xl border border-amber-400/25 bg-amber-400/10 p-4">
          <div className="text-sm font-black text-white">{data?.group?.product_name || "Product"}</div>
          <p className="mt-2 text-sm leading-6 text-zinc-300">{labels.description}</p>
        </div>

        <div className="max-h-80 overflow-auto rounded-2xl border border-white/10 bg-black/20">
          <table className="min-w-full text-start text-xs">
            <thead className="sticky top-0 bg-zinc-950 text-zinc-500">
              <tr>
                <th className="px-3 py-2 font-black uppercase">{labels.variant}</th>
                <th className="px-3 py-2 font-black uppercase">{labels.current}</th>
                <th className="px-3 py-2 font-black uppercase">{labels.saved}</th>
                <th className="px-3 py-2 font-black uppercase">{labels.next}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {rows.map((row) => (
                <tr key={String(row.line_id)} className="text-zinc-300">
                  <td className="px-3 py-2 font-semibold text-white">{row.color} / {row.size}</td>
                  <td className="px-3 py-2" dir="ltr">{row.currentQty}</td>
                  <td className={`px-3 py-2 font-black ${row.savedQty === null ? "text-zinc-500" : "text-amber-100"}`} dir="ltr">
                    {row.savedQty === null ? labels.notSaved : row.savedQty}
                  </td>
                  <td className="px-3 py-2 font-black text-emerald-200" dir="ltr">{row.newQty}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!canApply ? <div className="rounded-2xl border border-amber-400/25 bg-amber-500/10 px-4 py-3 text-sm font-semibold text-amber-100">{labels.noChanges}</div> : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <button type="button" onClick={onClose} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10">
            {labels.cancel}
          </button>
          <button type="button" onClick={onApply} disabled={!canApply} className="rounded-2xl bg-amber-400 px-4 py-3 text-sm font-black text-black transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-40">
            {labels.apply}
          </button>
        </div>
      </div>
    </Modal>
  );
}

const resolveBulkSalePrice = (item, method, value) => {
  const amount = money(value);
  const sellingPrice = money(item.selling_price ?? item.price ?? 0);
  if (method === "percent") return Math.max(0, sellingPrice - (sellingPrice * amount) / 100);
  if (method === "amount") return Math.max(0, sellingPrice - amount);
  return amount;
};

const uniqueValues = (values) => Array.from(new Set(values.map((value) => text(value)).filter(Boolean)));

const formatValueRange = (values) => {
  const normalized = values.map(money);
  if (!normalized.length) return "-";
  const min = Math.min(...normalized);
  const max = Math.max(...normalized);
  return min === max ? formatCurrency(min) : `${formatCurrency(min)} - ${formatCurrency(max)}`;
};

const bulkProductTargets = (items = []) => {
  const groups = new Map();
  items.forEach((item) => {
    const key = String(item.product_id || item.product_name || "");
    if (!key) return;
    const current = groups.get(key) || {
      product_id: item.product_id,
      product_name: item.product_name || "Product",
      items: [],
    };
    current.items.push(item);
    groups.set(key, current);
  });
  return Array.from(groups.values());
};

const bulkOldPrice = (item, mode) => {
  if (mode === "purchase") return money(item.cost_price ?? item.purchase_price ?? item.unit_cost ?? 0);
  if (mode === "sale") return money(item.sale_price ?? 0);
  return money(item.selling_price ?? item.price ?? 0);
};

const bulkNewPrice = (item, mode, method, value) => {
  if (mode === "sale") return resolveBulkSalePrice(item, method, value);
  return money(value);
};

const priceInputValue = (value) => {
  const numeric = money(value);
  return numeric > 0 ? String(numeric) : "";
};

const summarizeValues = (values, fallback) => {
  const normalized = uniqueValues(values);
  if (!normalized.length) return fallback;
  if (normalized.length <= 3) return normalized.join(", ");
  return `${normalized.slice(0, 3).join(", ")} +${normalized.length - 3}`;
};

const modelPricingInitialRows = (items = []) =>
  bulkProductTargets(items).map((group) => {
    const first = group.items[0] || {};
    return {
      product_id: group.product_id,
      product_name: group.product_name,
      colors: uniqueValues(group.items.map((item) => item.color || "افتراضي")),
      sizes: uniqueValues(group.items.map((item) => item.size || "مقاس واحد")),
      variants_count: group.items.length,
      selling_price: priceInputValue(first.selling_price ?? first.price),
      sale_price: priceInputValue(first.sale_price),
      wholesale_price: priceInputValue(first.wholesale_price),
    };
  });

const validateModelPricingRow = (row) => {
  const sellingPrice = Number(row.selling_price);
  const salePrice = row.sale_price === "" ? null : Number(row.sale_price);
  const wholesalePrice = row.wholesale_price === "" ? null : Number(row.wholesale_price);
  if (!Number.isFinite(sellingPrice) || sellingPrice <= 0) return "يجب أن يكون سعر البيع أكبر من 0.";
  if (salePrice !== null && (!Number.isFinite(salePrice) || salePrice <= 0)) return "يجب أن يكون سعر الخصم أكبر من 0.";
  if (wholesalePrice !== null && (!Number.isFinite(wholesalePrice) || wholesalePrice <= 0)) return "يجب أن يكون سعر الجملة أكبر من 0.";
  if (salePrice !== null && salePrice > sellingPrice) return "لا يجب أن يكون سعر الخصم أكبر من سعر البيع.";
  if (wholesalePrice !== null && wholesalePrice > sellingPrice) return "لا يجب أن يكون سعر الجملة أكبر من سعر البيع.";
  return "";
};

function BulkModelPricingModal({ items = [], onClose, onApply }) {
  const { t } = useTranslation();
  const [rows, setRows] = useState(() => modelPricingInitialRows(items));
  const [errors, setErrors] = useState({});
  const productGroups = useMemo(() => bulkProductTargets(items), [items]);
  const productCount = productGroups.length;
  const variantsCount = productGroups.reduce((sum, group) => sum + group.items.length, 0);
  const completedCount = rows.filter((row) => !validateModelPricingRow(row)).length;

  useEffect(() => {
    setRows((current) => {
      const currentMap = new Map(current.map((row) => [String(row.product_id || row.product_name || ""), row]));
      return modelPricingInitialRows(items).map((row) => ({
        ...row,
        ...(currentMap.get(String(row.product_id || row.product_name || "")) || {}),
        colors: row.colors,
        sizes: row.sizes,
        variants_count: row.variants_count,
      }));
    });
  }, [items]);

  const setRowField = (key, field, value) => {
    setRows((current) =>
      current.map((row) => (String(row.product_id || row.product_name || "") === String(key) ? { ...row, [field]: value } : row))
    );
    setErrors((current) => {
      const next = { ...current };
      delete next[String(key)];
      return next;
    });
  };

  const validate = () => {
    const nextErrors = {};
    rows.forEach((row) => {
      const error = validateModelPricingRow(row);
      if (error) nextErrors[String(row.product_id || row.product_name || "")] = error;
    });
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const apply = () => {
    if (!validate()) return false;
    return onApply(rows);
  };

  const saveAndClose = () => {
    if (apply()) onClose();
  };

  return (
    <Modal eyebrow="تسعير جماعي" title="أسعار نموذج المنتج" onClose={onClose}>
      <div className="flex max-h-[82vh] flex-col gap-4">
        <div className="rounded-3xl border border-cyan-400/25 bg-cyan-400/10 p-4">
          <div className="text-sm font-black text-white">تحديد سعر البيع وسعر الخصم وسعر الجملة حسب المنتج أو النموذج.</div>
          <p className="mt-2 text-sm leading-6 text-zinc-300">
            تطبيق الأسعار يحدّث بنود فاتورة الشراء محليًا فقط، ولا ينفّذ الاستلام.
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          <div className="grid gap-3">
            {rows.map((row) => {
              const key = String(row.product_id || row.product_name || "");
              return (
                <div key={key} className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                  <div className="grid gap-3 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1.35fr)]">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-black text-white">{row.product_name}</div>
                      <div className="mt-2 grid gap-1.5 text-xs font-semibold text-zinc-400 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
                        <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
                          <div className="text-[10px] uppercase tracking-[0.16em] text-zinc-600">الألوان</div>
                          <div className="mt-1 truncate text-zinc-200">{summarizeValues(row.colors, "افتراضي")}</div>
                        </div>
                        <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
                          <div className="text-[10px] uppercase tracking-[0.16em] text-zinc-600">المقاسات</div>
                          <div className="mt-1 truncate text-zinc-200">{summarizeValues(row.sizes, "مقاس واحد")}</div>
                        </div>
                        <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
                          <div className="text-[10px] uppercase tracking-[0.16em] text-zinc-600">الخيارات</div>
                          <div className="mt-1 text-zinc-200">{row.variants_count}</div>
                        </div>
                      </div>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-3">
                      <ModelPriceField label="سعر البيع" value={row.selling_price} required onChange={(value) => setRowField(key, "selling_price", value)} />
                      <ModelPriceField label="سعر الخصم" value={row.sale_price} onChange={(value) => setRowField(key, "sale_price", value)} />
                      <ModelPriceField label="سعر الجملة" value={row.wholesale_price} onChange={(value) => setRowField(key, "wholesale_price", value)} />
                    </div>
                  </div>
                  {errors[key] ? <div className="mt-2 rounded-xl border border-rose-400/25 bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-100">{errors[key]}</div> : null}
                </div>
              );
            })}
          </div>
        </div>

        <div className="shrink-0 rounded-2xl border border-white/10 bg-zinc-950/95 p-3">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs font-semibold text-zinc-400">
            <span>المنتجات: <b className="text-white">{productCount}</b></span>
            <span>الخيارات: <b className="text-white">{variantsCount}</b></span>
            <span>تمت: <b className="text-emerald-200">{completedCount}</b> / {productCount}</span>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <button type="button" onClick={apply} className="rounded-2xl bg-cyan-400 px-4 py-3 text-sm font-black text-black transition hover:bg-cyan-300">
              تطبيق الأسعار
            </button>
            <button type="button" onClick={saveAndClose} className="rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-black text-black transition hover:bg-emerald-400">
              حفظ وإغلاق
            </button>
            <button type="button" onClick={onClose} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10">
              إغلاق دون حفظ
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function ModelPriceField({ label, value, required = false, onChange }) {
  return (
    <label className="rounded-xl border border-white/10 bg-zinc-950/45 px-3 py-2">
      <div className="truncate text-[10px] font-black uppercase tracking-[0.14em] text-zinc-500">
        {label}{required ? <span className="text-rose-300"> *</span> : null}
      </div>
      <input
        type="number"
        min="0"
        step="0.01"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={required ? "0.00" : "اختياري"}
        className="mt-1 h-9 w-full bg-transparent text-sm font-black text-white outline-none placeholder:text-zinc-700 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        dir="ltr"
      />
    </label>
  );
}

function BulkPriceModal({ mode, items = [], onClose, onApply }) {
  const { t } = useTranslation();
  const [value, setValue] = useState("");
  const [method, setMethod] = useState("fixed");
  const [target, setTarget] = useState("all");
  const productGroups = useMemo(() => bulkProductTargets(items), [items]);
  const [productId, setProductId] = useState(String(productGroups[0]?.product_id || ""));
  const [error, setError] = useState("");
  const isPurchase = mode === "purchase";
  const isSale = mode === "sale";
  const price = Number(value);
  const selectedGroups = target === "all" ? productGroups : productGroups.filter((group) => String(group.product_id) === String(productId));
  const affectedItems = selectedGroups.flatMap((group) => group.items);
  const hasValidValue = Number.isFinite(price) && price >= 0 && value !== "";
  const previewRows = selectedGroups.map((group) => {
    const colors = uniqueValues(group.items.map((item) => item.color || "افتراضي"));
    const sizes = uniqueValues(group.items.map((item) => item.size || "مقاس واحد"));
    const oldPrices = group.items.map((item) => bulkOldPrice(item, mode));
    const newPrices = hasValidValue ? group.items.map((item) => bulkNewPrice(item, mode, method, price)) : [];
    return {
      group,
      colors,
      sizes,
      oldPriceRange: formatValueRange(oldPrices),
      newPriceRange: hasValidValue ? formatValueRange(newPrices) : "-",
      affectedVariants: group.items.length,
    };
  });
  const belowCostCount = isSale && hasValidValue ? affectedItems.filter((item) => {
    const salePrice = resolveBulkSalePrice(item, method, price);
    return salePrice > 0 && salePrice < money(item.cost_price);
  }).length : 0;
  const aboveSellingCount = isSale && hasValidValue ? affectedItems.filter((item) => resolveBulkSalePrice(item, method, price) > money(item.selling_price ?? item.price ?? 0)).length : 0;

  const submit = (event) => {
    event.preventDefault();
    if (!Number.isFinite(price) || price < 0 || value === "") {
      setError(t("purchases.create.validNumberRequired"));
      return;
    }
    if (isSale && method === "percent" && price > 100) {
      setError(t("purchases.create.percentTooHigh"));
      return;
    }
    if (target === "product" && !productId) {
      setError(t("purchases.create.selectProductModel"));
      return;
    }
    const applied = onApply({ value: price, method, target, productId });
    if (!applied) setError(t("purchases.create.priceApplyFailed"));
  };

  const tone = isPurchase
    ? "border-emerald-400/25 bg-emerald-400/10"
    : isSale
      ? "border-amber-400/25 bg-amber-400/10"
      : "border-cyan-400/25 bg-cyan-400/10";
  const title = isPurchase ? t("purchases.create.bulkPurchasePrice") : isSale ? t("purchases.create.bulkSalePrice") : t("purchases.create.bulkSellingPrice");

  return (
    <Modal
      eyebrow={t("purchases.create.bulkPricing")}
      title={title}
      onClose={onClose}
    >
      <form onSubmit={submit} className="space-y-4">
        <div className={`rounded-3xl border p-4 ${tone}`}>
          <div className="text-sm font-black text-white">
            {isPurchase
              ? t("purchases.create.bulkPurchasePriceSummary")
              : isSale
                ? t("purchases.create.bulkSalePriceSummary")
                : t("purchases.create.bulkSellingPriceSummary")}
          </div>
          <p className="mt-2 text-sm leading-6 text-zinc-300">
            {isPurchase
              ? t("purchases.create.bulkPurchasePriceHelper")
              : isSale
                ? t("purchases.create.bulkSalePriceHelper")
                : t("purchases.create.bulkSellingPriceHelper")}
          </p>
        </div>

        <div className={`grid gap-3 ${isSale ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
          <Select
            label={t("purchases.create.target")}
            value={target}
            onChange={(next) => {
              setTarget(next);
              setError("");
            }}
            options={[
              { value: "all", label: t("purchases.create.allProductsInInvoice") },
              { value: "product", label: t("purchases.create.specificProductModel") },
            ]}
          />
          {target === "product" ? (
            <Select
              label={t("purchases.create.productModel")}
              value={productId}
              onChange={setProductId}
              options={productGroups.map((group) => ({ value: String(group.product_id), label: group.product_name }))}
              emptyLabel={t("purchases.create.noProductsInCart")}
            />
          ) : null}
          {isSale ? (
            <Select
              label={t("purchases.create.salePriceMethod")}
              value={method}
              onChange={(next) => {
                setMethod(next);
                setError("");
              }}
              options={[
                { value: "fixed", label: t("purchases.create.fixedSalePrice") },
                { value: "percent", label: t("purchases.create.percentOffSellingPrice") },
                { value: "amount", label: t("purchases.create.fixedDiscount") },
              ]}
            />
          ) : null}
        </div>

        {target === "all" ? (
          <div className="rounded-2xl border border-amber-400/25 bg-amber-500/10 px-4 py-3 text-sm font-semibold text-amber-100">
            سيتم تحديث جميع المنتجات في فاتورة الشراء هذه.
          </div>
        ) : null}

        <label className="block">
          <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-zinc-500">
            {isSale && method === "percent" ? "نسبة الخصم" : isSale && method === "amount" ? "قيمة الخصم" : "السعر"}
          </div>
          <input
            autoFocus
            type="number"
            min="0"
            max={isSale && method === "percent" ? "100" : undefined}
            step="0.01"
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              setError("");
            }}
            placeholder="0.00"
            className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-lg font-black text-white outline-none placeholder:text-zinc-600 focus:border-emerald-400/50"
          />
          {error ? <div className="mt-2 text-sm font-semibold text-rose-200">{error}</div> : null}
        </label>

        <div className="rounded-3xl border border-white/10 bg-black/20 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">{t("purchases.create.preview")}</div>
            <div className="text-xs font-semibold text-zinc-400">{t("purchases.create.variantsCount", { count: affectedItems.length })}</div>
          </div>
          {belowCostCount ? <div className="mt-2 rounded-xl border border-amber-400/25 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-100">{t("purchases.create.saleBelowCost", { count: belowCostCount })}</div> : null}
          {aboveSellingCount ? <div className="mt-2 rounded-xl border border-amber-400/25 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-100">{t("purchases.create.saleAboveSelling", { count: aboveSellingCount })}</div> : null}
          <div className="mt-3 max-h-72 overflow-auto rounded-2xl border border-white/10">
            <table className="min-w-full text-left text-xs">
              <thead className="sticky top-0 bg-zinc-950 text-zinc-500">
                <tr>
                  <th className="px-3 py-2 font-black uppercase">{t("purchases.create.productModel")}</th>
                  <th className="px-3 py-2 font-black uppercase">{t("purchases.create.affectedVariants")}</th>
                  <th className="px-3 py-2 font-black uppercase">{t("purchases.create.oldPriceRange")}</th>
                  <th className="px-3 py-2 font-black uppercase">{t("purchases.create.newPrice")}</th>
                  <th className="px-3 py-2 font-black uppercase">{t("purchases.create.sizesColors")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {previewRows.map((row) => (
                  <tr key={String(row.group.product_id)} className="text-zinc-300">
                    <td className="max-w-56 px-3 py-2 font-semibold text-white">{row.group.product_name}</td>
                    <td className="px-3 py-2">{row.affectedVariants}</td>
                    <td className="px-3 py-2">{row.oldPriceRange}</td>
                    <td className="px-3 py-2 font-black text-amber-100">{row.newPriceRange}</td>
                    <td className="px-3 py-2">
                      <div className="max-w-64 truncate">{t("purchases.create.sizesWithValue", { value: row.sizes.join(", ") || t("purchases.create.oneSize") })}</div>
                      <div className="mt-1 max-w-64 truncate text-zinc-500">{t("purchases.create.colorsWithValue", { value: row.colors.join(", ") || t("purchases.create.defaultVariant") })}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <button type="button" onClick={onClose} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10">
            {t("common.cancel")}
          </button>
          <button type="submit" className={`rounded-2xl px-4 py-3 text-sm font-black text-black transition ${isPurchase ? "bg-emerald-500 hover:bg-emerald-400" : isSale ? "bg-amber-400 hover:bg-amber-300" : "bg-cyan-400 hover:bg-cyan-300"}`}>
            {t("purchases.create.apply")}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function RunModal({ mode, initialProduct, productGroups, onClose, onAdd }) {
  const { t } = useTranslation();
  const [productId, setProductId] = useState(String(initialProduct?.product_id || productGroups[0]?.product_id || ""));
  const selected = productGroups.find((group) => String(group.product_id) === String(productId)) || productGroups[0] || null;
  const colors = Array.from(new Set(toArray(selected?.variants).map((item) => item.color || "افتراضي")));
  const [color, setColor] = useState(colors[0] || "افتراضي");
  const [expandedColors, setExpandedColors] = useState(() => new Set(colors));
  const [qtyMap, setQtyMap] = useState({});
  const [cartonQty, setCartonQty] = useState(1);

  useEffect(() => {
    const nextColors = Array.from(new Set(toArray(selected?.variants).map((item) => item.color || "افتراضي")));
    setColor(nextColors[0] || "افتراضي");
    setExpandedColors(new Set(nextColors));
    setQtyMap({});
  }, [productId]);

  const colorOptions = colors.map((colorName) => {
    const variants = toArray(selected?.variants).filter((item) => (item.color || "افتراضي") === colorName);
    const variant =
      variants.find((item) => firstText(item.variant_image_url, item.color_image, item.color_image_url)) ||
      variants.find((item) => item.image_url) ||
      variants[0] ||
      {};
    return {
      color: colorName,
      variant,
      count: variants.length,
    };
  });
  const visibleColors = mode === "color" || mode === "full" || mode === "carton" ? colors : [color];
  const rows = visibleColors.map((colorName) => ({
    color: colorName,
    variants: toArray(selected?.variants).filter((item) => (item.color || "افتراضي") === colorName),
  }));
  const selectedColorVariants = toArray(selected?.variants).filter((item) => (item.color || "افتراضي") === color);
  const selectedColorVariant = colorOptions.find((option) => String(option.color) === String(color))?.variant || selectedColorVariants[0] || toArray(selected?.variants)[0] || {};

  const setAll = (qty) => {
    const next = {};
    rows.forEach((section) => section.variants.forEach((variant) => { next[variant.line_id] = qty; }));
    setQtyMap(next);
  };

  const addRun = () => {
    const lines = [];
    rows.forEach((section) => {
      section.variants.forEach((variant) => {
        const quantity = mode === "carton" ? money(cartonQty) : money(qtyMap[variant.line_id]);
        if (quantity > 0) lines.push({ product: variant, quantity });
      });
    });
    if (!lines.length) {
      toast.error(t("purchases.create.enterQuantitiesFirst"));
      return;
    }
    onAdd(lines);
  };

  return (
    <Modal title={mode === "carton" ? t("purchases.create.cartonPurchasing") : mode === "color" ? t("purchases.create.colorRun") : mode === "full" ? t("purchases.create.fullModelEntry") : t("purchases.create.sizeRun")} eyebrow={t("purchases.create.bulkVariants")} onClose={onClose}>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_13rem]">
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label={t("purchases.create.model")} value={productId} onChange={setProductId} options={productGroups.map((group) => ({ value: group.product_id, label: group.product_name }))} />
          {mode === "size" ? <ColorImageDropdown label={t("purchases.create.color")} value={color} onChange={setColor} options={colorOptions} productName={selected?.product_name} /> : null}
        </div>
        <ColorIdentity
          color={mode === "size" ? color : `${colors.length || 0} colors`}
          variant={mode === "size" ? selectedColorVariant : toArray(selected?.variants).find((variant) => variant.image_url) || toArray(selected?.variants)[0]}
          productName={selected?.product_name}
          sizes={mode === "size" ? selectedColorVariants.length : toArray(selected?.variants).length}
        />
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={() => setAll(1)} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-black text-white">{t("purchases.create.fillAllOne")}</button>
        <button type="button" onClick={() => setAll(2)} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-black text-white">{t("purchases.create.fillAllTwo")}</button>
        <button type="button" onClick={() => setAll(0)} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-black text-white">{t("purchases.create.clearAll")}</button>
        {mode === "carton" ? (
          <label className="ml-auto flex items-center gap-2 rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-3 py-2 text-xs font-black text-emerald-200">
            {t("purchases.create.cartonQty")}
            <input type="number" min="1" value={cartonQty} onChange={(event) => setCartonQty(Math.max(1, money(event.target.value)))} className="w-16 bg-transparent text-white outline-none" />
          </label>
        ) : null}
      </div>
      <div className="mt-4 max-h-[55vh] space-y-3 overflow-y-auto">
        {rows.map((section) => {
          const expanded = expandedColors.has(section.color);
          const sectionVariant = section.variants.find((variant) => variant.image_url) || section.variants[0] || {};
          return (
            <div key={section.color} className="rounded-2xl border border-white/10 bg-white/5">
              <button type="button" onClick={() => setExpandedColors((prev) => {
                const next = new Set(prev);
                if (next.has(section.color)) next.delete(section.color);
                else next.add(section.color);
                return next;
              })} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
                {mode === "size" ? (
                  <div className="min-w-0">
                    <div className="truncate text-sm font-black text-white">{section.color || t("purchases.create.defaultVariant")}</div>
                    <div className="mt-1 text-xs font-semibold text-emerald-300">
                      {t("purchases.create.sizesCount", { count: section.variants.length })}
                    </div>
                  </div>
                ) : (
                  <div className="min-w-0 flex-1">
                    <ColorIdentity color={section.color} variant={sectionVariant} productName={selected?.product_name} sizes={section.variants.length} compact />
                  </div>
                )}
                {expanded ? <ChevronUp className="h-4 w-4 text-zinc-400" /> : <ChevronDown className="h-4 w-4 text-zinc-400" />}
              </button>
              {expanded ? (
                <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-4">
                  {section.variants.map((variant) => (
                    <label key={variant.line_id} className="rounded-xl border border-white/10 bg-zinc-950/70 p-3 transition hover:border-white/20">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-base font-black text-white">{variant.size || t("purchases.create.oneSize")}</div>
                          <div className="mt-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">{t("purchases.create.size")}</div>
                        </div>
                        <div className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[11px] font-bold text-zinc-300">
                          {t("purchases.create.stockWithValue", { stock: variant.stock })}
                        </div>
                      </div>
                      <div className="mt-3 flex items-center rounded-lg bg-white/5">
                        <button type="button" onClick={() => setQtyMap((prev) => ({ ...prev, [variant.line_id]: Math.max(0, money(prev[variant.line_id]) - 1) }))} className="p-2 text-white"><Minus className="h-3 w-3" /></button>
                        <input value={mode === "carton" ? cartonQty : qtyMap[variant.line_id] || ""} disabled={mode === "carton"} onChange={(event) => setQtyMap((prev) => ({ ...prev, [variant.line_id]: money(event.target.value) }))} className="w-full bg-transparent text-center text-sm font-black text-white outline-none disabled:text-emerald-300" />
                        <button type="button" onClick={() => setQtyMap((prev) => ({ ...prev, [variant.line_id]: money(prev[variant.line_id]) + 1 }))} disabled={mode === "carton"} className="p-2 text-white disabled:opacity-30"><Plus className="h-3 w-3" /></button>
                      </div>
                    </label>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      <button type="button" onClick={addRun} className="mt-4 w-full rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-black text-black">
        {t("purchases.create.addRun")}
      </button>
    </Modal>
  );
}

function Modal({ eyebrow, title, children, onClose }) {
  const { t } = useTranslation();
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center">
      <button type="button" className="absolute inset-0 cursor-default" onClick={onClose} aria-label={t("purchases.suppliersDashboard.close")} />
      <div className="relative w-full max-w-4xl rounded-t-3xl border border-white/10 bg-zinc-950 p-5 shadow-2xl shadow-black sm:rounded-3xl">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300">{eyebrow}</div>
            <h3 className="mt-1 text-xl font-black text-white">{title}</h3>
          </div>
          <button type="button" onClick={onClose} className="rounded-xl border border-white/10 bg-white/5 p-2 text-white">
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Select({ label, value, onChange, options, emptyLabel }) {
  const { t } = useTranslation();
  const fallbackEmptyLabel = emptyLabel || t("purchases.create.noOptions");
  return (
    <label className="block">
      <div className="mb-1.5 text-[10px] uppercase tracking-[0.18em] text-zinc-500">{label}</div>
      <select value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm capitalize text-white outline-none">
        {options.length === 0 ? <option value="" className="bg-zinc-950 text-white">{fallbackEmptyLabel}</option> : null}
        {options.map((option) => (
          <option key={String(option.value)} value={option.value} className="bg-zinc-950 text-white">
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function Field({ label, value, onChange, type = "text", placeholder }) {
  return (
    <label className="block">
      <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-zinc-500">{label}</div>
      <input type={type} value={value} onChange={(event) => onChange(type === "number" ? money(event.target.value) : event.target.value)} placeholder={placeholder} className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none placeholder:text-zinc-500" />
    </label>
  );
}

function Summary({ label, value }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-2.5">
      <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">{label}</div>
      <div className="mt-1 text-sm font-semibold text-white">{value}</div>
    </div>
  );
}

function CardSkeleton() {
  return (
    <div className="mt-4 grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
      {Array.from({ length: 6 }).map((_, index) => <div key={index} className="h-80 animate-pulse rounded-2xl border border-white/10 bg-white/5" />)}
    </div>
  );
}

function QuickSupplierModal({ form, setForm, saving, error, onClose, onSubmit }) {
  const { t } = useTranslation();
  const setField = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));
  return (
    <Modal eyebrow={t("purchases.suppliersDashboard.supplier")} title={t("purchases.create.quickCreateSupplier")} onClose={onClose}>
      <form onSubmit={onSubmit}>
        {error ? <div className="mb-4 rounded-2xl border border-rose-500/20 bg-rose-500/10 p-3 text-sm text-rose-100">{error}</div> : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("purchases.suppliersDashboard.supplierNameRequiredLabel")} value={form.name} onChange={(value) => setField("name", value)} />
          <Field label={t("purchases.supplierDetails.phone")} value={form.phone} onChange={(value) => setField("phone", value)} />
          <Field label={t("purchases.suppliersDashboard.whatsapp")} value={form.whatsapp} onChange={(value) => setField("whatsapp", value)} />
          <Field label={t("purchases.supplierDetails.email")} value={form.email} onChange={(value) => setField("email", value)} />
          <Field label={t("purchases.suppliersDashboard.contactPerson")} value={form.contact_person} onChange={(value) => setField("contact_person", value)} />
          <Field label={t("purchases.supplierDetails.openingBalance")} type="number" value={form.opening_balance} onChange={(value) => setField("opening_balance", money(value))} />
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <button type="button" onClick={onClose} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white">{t("common.cancel")}</button>
          <button type="submit" disabled={saving} className="rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-black text-black disabled:opacity-40">{saving ? t("purchases.details.saving") : t("purchases.create.createAndSelect")}</button>
        </div>
      </form>
    </Modal>
  );
}

function QuickProductModal({ form, setForm, saving, error, onClose, onSubmit }) {
  const { t } = useTranslation();
  const setField = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));
  return (
    <Modal eyebrow={t("purchases.details.product")} title={t("purchases.create.quickCreateProduct")} onClose={onClose}>
      <form onSubmit={onSubmit}>
        {error ? <div className="mb-4 rounded-2xl border border-rose-500/20 bg-rose-500/10 p-3 text-sm text-rose-100">{error}</div> : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("purchases.create.productName")} value={form.name} onChange={(value) => setField("name", value)} />
          <Field label={t("purchases.create.category")} value={form.category} onChange={(value) => setField("category", value)} />
          <Field label={t("purchases.create.brand")} value={form.brand} onChange={(value) => setField("brand", value)} />
          <Field label={t("purchases.create.colors")} value={form.colors} onChange={(value) => setField("colors", value)} />
          <Field label={t("purchases.create.sizes")} value={form.sizes} onChange={(value) => setField("sizes", value)} />
          <Field label={t("purchases.create.purchaseCost")} type="number" value={form.purchase_cost} onChange={(value) => setField("purchase_cost", value)} />
          <Field label={t("purchases.create.sellingPrice")} type="number" value={form.sale_price} onChange={(value) => setField("sale_price", value)} />
          <Field label={t("purchases.create.barcodeSkuPrefix")} value={form.sku} onChange={(value) => setField("sku", value)} />
          <Field label={t("purchases.create.barcode")} value={form.barcode} onChange={(value) => setField("barcode", value)} />
          <Field label={t("purchases.create.imageUrl")} value={form.image_url} onChange={(value) => setField("image_url", value)} />
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <button type="button" onClick={onClose} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white">{t("common.cancel")}</button>
          <button type="submit" disabled={saving} className="rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-black text-black disabled:opacity-40">{saving ? t("purchases.create.creating") : t("purchases.create.createAndAdd")}</button>
        </div>
      </form>
    </Modal>
  );
}

export default PurchaseOrder;
