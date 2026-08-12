import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Clock3,
  History,
  ImageOff,
  Loader2,
  Minus,
  Plus,
  Save,
  Search,
  ShieldAlert,
  X,
} from "lucide-react";
import toast from "react-hot-toast";

import BarcodeScanner, { barcodeScannerMessages } from "../../../components/BarcodeScanner";
import { api } from "../../../shared/api/api";
import { getCurrentUser, hasPermission } from "../../../shared/auth/authStorage";
import { notifyProductRefresh } from "../../../shared/lib/productRefreshSignal";
import InventoryShell from "../components/InventoryShell";
import { getProductsWithVariants } from "../../products/services/productsApi";
import {
  formatDateTime,
  getInventoryAdjustments,
  getInventoryMovements,
  normalizeWarehouse,
  saveInventoryAdjustments,
  saveInventoryMovements,
  seedWarehouses,
} from "../../purchases/lib/flowStore";

const APPROVAL_THRESHOLD_KEY = "erp.inventory.adjustment.approvalThreshold";
const DEFAULT_APPROVAL_THRESHOLD = 25;

const ADJUSTMENT_TYPES = [
  { value: "increase", label: "زيادة المخزون", tone: "emerald" },
  { value: "decrease", label: "خفض المخزون", tone: "rose" },
];

const REASON_OPTIONS = [
  "صنف تالف",
  "صنف مفقود",
  "تصحيح المخزون",
  "فرق الجرد",
  "تصحيح يدوي",
  "أخرى",
];

const normalizeText = (value) => String(value ?? "").trim();

const normalizeLookup = (value) =>
  normalizeText(value)
    .toLowerCase()
    .replace(/\s+/g, " ");

const asNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const getImageUrl = (product = {}, variant = {}) =>
  normalizeText(
    variant.image_url ||
      variant.variant_image_url ||
      variant.color_image_url ||
      variant.image ||
      product.image_url ||
      product.image ||
      product.photo_url ||
      product.thumbnail_url ||
      ""
  );

const getProductDisplayName = (product = {}, variant = {}) =>
  normalizeText(product.name || product.product_name || variant.product_name || variant.name || "منتج غير مسمى");

const getWarehouseName = (variant = {}, warehouses = []) => {
  const direct = normalizeText(variant.warehouse_name || variant.warehouse || "");
  if (direct) return direct;
  const warehouseId = String(variant.warehouse_id || "");
  const match = warehouses.find((warehouse) => String(warehouse.id) === warehouseId);
  return normalizeText(match?.name || "");
};

const getVariantLabel = (variant = {}) =>
  [normalizeText(variant.color || "افتراضي"), normalizeText(variant.size || "مقاس موحد")]
    .filter(Boolean)
    .join(" / ");

const buildVariantSearchText = (product = {}, variant = {}) =>
  [
    product.name,
    product.product_name,
    product.sku,
    product.barcode,
    variant.name,
    variant.product_name,
    variant.color,
    variant.size,
    variant.sku,
    variant.barcode,
    variant.article_code,
    variant.warehouse_name,
    variant.warehouse,
  ]
    .filter(Boolean)
    .map((value) => normalizeLookup(value))
    .join(" ");

const flattenVariants = (products = []) => {
  const rows = [];

  products.forEach((product) => {
    const rawVariants = Array.isArray(product.variants)
      ? product.variants
      : Array.isArray(product.product_variants)
        ? product.product_variants
        : Array.isArray(product.productVariants)
          ? product.productVariants
          : Array.isArray(product.variant_rows)
            ? product.variant_rows
            : Array.isArray(product.variantRows)
              ? product.variantRows
              : [];

    if (rawVariants.length > 0) {
      rawVariants.forEach((variant, index) => {
        const normalizedVariant = {
          ...variant,
          id: variant.id ?? variant.variant_id ?? `${product.id || "product"}-${index}`,
          variant_id: variant.variant_id ?? variant.id ?? product.variant_id ?? product.id ?? null,
          product_id: variant.product_id ?? product.id ?? null,
          product_name: getProductDisplayName(product, variant),
          color: normalizeText(variant.color || variant.color_name || ""),
          size: normalizeText(variant.size || variant.size_name || ""),
          sku: normalizeText(variant.sku || product.sku || ""),
          barcode: normalizeText(variant.barcode || product.barcode || ""),
          stock: asNumber(variant.stock ?? variant.quantity ?? product.stock ?? 0, 0),
          warehouse_id: variant.warehouse_id ?? product.warehouse_id ?? null,
          branch_id: variant.branch_id ?? product.branch_id ?? null,
          warehouse_name: normalizeText(variant.warehouse_name || product.warehouse_name || ""),
          branch_name: normalizeText(variant.branch_name || product.branch_name || ""),
          image_url: getImageUrl(product, variant),
          search_text: buildVariantSearchText(product, variant),
          raw_product: product,
          raw_variant: variant,
        };
        rows.push(normalizedVariant);
      });
      return;
    }

    rows.push({
      ...product,
      id: product.id ?? product.product_id ?? null,
      variant_id: product.variant_id ?? product.id ?? null,
      product_id: product.id ?? product.product_id ?? null,
      product_name: getProductDisplayName(product),
      color: normalizeText(product.color || ""),
      size: normalizeText(product.size || ""),
      sku: normalizeText(product.sku || ""),
      barcode: normalizeText(product.barcode || ""),
      stock: asNumber(product.stock ?? 0, 0),
      warehouse_id: product.warehouse_id ?? null,
      branch_id: product.branch_id ?? null,
      warehouse_name: normalizeText(product.warehouse_name || ""),
      branch_name: normalizeText(product.branch_name || ""),
      image_url: getImageUrl(product, {}),
      search_text: buildVariantSearchText(product, {}),
      raw_product: product,
      raw_variant: null,
    });
  });

  return rows;
};

const scoreVariant = (variant = {}, query = "") => {
  const needle = normalizeLookup(query);
  if (!needle) return 0;

  const exactCodes = [
    variant.sku,
    variant.barcode,
    variant.article_code,
    String(variant.variant_id ?? ""),
    String(variant.product_id ?? ""),
  ]
    .map((value) => normalizeLookup(value))
    .filter(Boolean);

  if (exactCodes.includes(needle)) return 1000;

  let score = 0;
  const haystack = normalizeLookup(variant.search_text || "");

  if (haystack.startsWith(needle)) score += 300;
  if (normalizeLookup(variant.product_name).includes(needle)) score += 180;
  if (normalizeLookup(variant.sku).includes(needle)) score += 160;
  if (normalizeLookup(variant.barcode).includes(needle)) score += 160;
  if (normalizeLookup(variant.color).includes(needle)) score += 60;
  if (normalizeLookup(variant.size).includes(needle)) score += 60;
  if (normalizeLookup(variant.warehouse_name).includes(needle)) score += 20;
  return score;
};

const getCurrentStock = (variant) => asNumber(variant?.stock ?? 0, 0);

const getThresholdFromStorage = () => {
  if (typeof window === "undefined") return DEFAULT_APPROVAL_THRESHOLD;
  const raw = window.localStorage.getItem(APPROVAL_THRESHOLD_KEY);
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_APPROVAL_THRESHOLD;
};

function StockAdjustments() {
  const currentUser = getCurrentUser() || {};
  const canAdjust = hasPermission("inventory.edit");
  const isManager = Boolean(
    currentUser?.is_super_admin ||
      currentUser?.is_admin ||
      ["admin", "super_admin", "superadmin", "manager", "branch manager"].includes(
        normalizeLookup(currentUser?.role || currentUser?.role_name || "")
      )
  );

  const [searchParams] = useSearchParams();
  const [warehouses, setWarehouses] = useState(seedWarehouses());
  const [catalog, setCatalog] = useState([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState("");
  const [warehouseLoading, setWarehouseLoading] = useState(true);
  const [warehouseError, setWarehouseError] = useState("");
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [selectedVariantId, setSelectedVariantId] = useState("");
  const [adjustmentType, setAdjustmentType] = useState("increase");
  const [quantity, setQuantity] = useState(1);
  const [warehouseId, setWarehouseId] = useState("");
  const [reason, setReason] = useState(REASON_OPTIONS[0]);
  const [notes, setNotes] = useState("");
  const [approvalThreshold, setApprovalThreshold] = useState(getThresholdFromStorage);
  const [approvalConfirmed, setApprovalConfirmed] = useState(false);
  const [approvalName, setApprovalName] = useState("");
  const [approvalNotes, setApprovalNotes] = useState("");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [historyMovements, setHistoryMovements] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [localAdjustments, setLocalAdjustments] = useState(() => getInventoryAdjustments());
  const [localMovements, setLocalMovements] = useState(() => getInventoryMovements());

  useEffect(() => {
    const loadWarehouses = async () => {
      try {
        setWarehouseLoading(true);
        const data = await api.get("/warehouses");
        const rows = Array.isArray(data) ? data : data?.warehouses || [];
        setWarehouses(rows.length ? rows.map(normalizeWarehouse) : seedWarehouses());
      } catch (error) {
        console.log(error);
        setWarehouses(seedWarehouses());
        setWarehouseError("قائمة المخازن غير متاحة. سيستمر التعديل باستخدام المخزن المحدد محليًا.");
        toast.error("جارٍ استخدام مخازن احتياطية");
      } finally {
        setWarehouseLoading(false);
      }
    };

    loadWarehouses();
  }, []);

  useEffect(() => {
    let active = true;

    const loadCatalog = async () => {
      try {
        setCatalogLoading(true);
        setCatalogError("");
        const response = await getProductsWithVariants();
        if (!active) return;
        setCatalog(Array.isArray(response) ? response : []);
      } catch (error) {
        if (!active) return;
        setCatalog([]);
        setCatalogError(error?.message || "تعذر تحميل المنتجات");
        toast.error(error?.message || "تعذر تحميل المنتجات");
      } finally {
        if (active) setCatalogLoading(false);
      }
    };

    loadCatalog();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(APPROVAL_THRESHOLD_KEY, String(approvalThreshold || DEFAULT_APPROVAL_THRESHOLD));
  }, [approvalThreshold]);

  useEffect(() => {
    if (!warehouses.length) return;
    if (warehouseId && warehouses.some((warehouse) => String(warehouse.id) === String(warehouseId))) return;
    setWarehouseId(String(warehouses[0]?.id || ""));
  }, [warehouses, warehouseId]);

  const allVariants = useMemo(() => flattenVariants(catalog), [catalog]);
  const selectedVariant = useMemo(
    () => allVariants.find((variant) => String(variant.variant_id) === String(selectedVariantId)) || null,
    [allVariants, selectedVariantId]
  );

  useEffect(() => {
    const queryVariantId = normalizeText(searchParams.get("variantId") || searchParams.get("variant_id") || searchParams.get("productId") || "");
    if (!queryVariantId || !allVariants.length) return;
    const matched = allVariants.find((variant) => String(variant.variant_id) === queryVariantId || String(variant.product_id) === queryVariantId);
    if (matched) {
      setSelectedVariantId(String(matched.variant_id));
      setSearch([matched.product_name, matched.sku, matched.barcode].filter(Boolean).join(" "));
    }
  }, [allVariants, searchParams]);

  useEffect(() => {
    if (!selectedVariant) return;
    if (!warehouseId && selectedVariant.warehouse_id) {
      setWarehouseId(String(selectedVariant.warehouse_id));
    }
  }, [selectedVariant, warehouseId]);

  const filteredVariants = useMemo(() => {
    const query = normalizeLookup(deferredSearch);
    const rows = query
      ? allVariants
          .filter((variant) => normalizeLookup(variant.search_text || "").includes(query))
          .map((variant) => ({ variant, score: scoreVariant(variant, query) }))
      : [];

    return rows.sort((a, b) => b.score - a.score || normalizeLookup(a.variant.product_name).localeCompare(normalizeLookup(b.variant.product_name))).slice(0, 30);
  }, [allVariants, deferredSearch]);

  const selectedWarehouseName = useMemo(() => {
    if (!warehouseId) return normalizeText(selectedVariant?.warehouse_name || "");
    const match = warehouses.find((warehouse) => String(warehouse.id) === String(warehouseId));
    return normalizeText(match?.name || selectedVariant?.warehouse_name || "");
  }, [selectedVariant, warehouseId, warehouses]);

  const currentStock = getCurrentStock(selectedVariant);
  const quantityDelta = Math.max(0, asNumber(quantity, 0));
  const signedDelta = adjustmentType === "decrease" ? -quantityDelta : quantityDelta;
  const requestedTargetStock = currentStock + signedDelta;
  const targetStock = Math.max(0, requestedTargetStock);
  const requiresManagerApproval = Boolean(selectedVariant) && !isManager && Math.abs(signedDelta) >= asNumber(approvalThreshold, DEFAULT_APPROVAL_THRESHOLD);
  const approvalReady = !requiresManagerApproval || (approvalConfirmed && normalizeText(approvalName).length > 0);

  const openScanner = () => setScannerOpen(true);

  const selectVariant = (variant) => {
    if (!variant) return;
    setSelectedVariantId(String(variant.variant_id));
    setSearch([variant.product_name, variant.sku, variant.barcode, variant.color, variant.size].filter(Boolean).join(" "));
    if (!warehouseId && variant.warehouse_id) {
      setWarehouseId(String(variant.warehouse_id));
    }
  };

  const handleScan = (value) => {
    const scanned = normalizeText(value);
    if (!scanned) return;
    setSearch(scanned);
    const exactMatch = allVariants.find((variant) => {
      const codes = [variant.sku, variant.barcode, variant.article_code, String(variant.variant_id), String(variant.product_id)]
        .map((item) => normalizeLookup(item))
        .filter(Boolean);
      return codes.includes(normalizeLookup(scanned));
    });

    if (exactMatch) {
      selectVariant(exactMatch);
      toast.success("تمت مطابقة الباركود مع أحد الاختيارات");
    } else {
      toast("لم يتم العثور على تطابق دقيق للباركود");
    }

    setScannerOpen(false);
  };

  const submitAdjustment = async () => {
    if (!canAdjust) {
      toast.error("ليس لديك صلاحية تنفيذ تسويات المخزون");
      return;
    }
    if (!selectedVariant) {
      toast.error("اختر اختيارًا للمنتج أولًا");
      return;
    }
    if (!quantityDelta || quantityDelta < 1) {
      toast.error("يجب أن تكون الكمية 1 على الأقل");
      return;
    }
    if (adjustmentType === "decrease" && requestedTargetStock < 0) {
      toast.error("لا يمكن أن ينخفض المخزون إلى أقل من صفر");
      return;
    }
    if (requiresManagerApproval && !approvalReady) {
      toast.error("هذه التسوية تحتاج إلى اعتماد المدير");
      return;
    }

    setSubmitting(true);

    const timestamp = new Date().toISOString();
    const finalNotes = [
      normalizeText(notes),
      requiresManagerApproval ? `اعتماد المدير: ${normalizeText(approvalName)}${approvalNotes ? ` - ${normalizeText(approvalNotes)}` : ""}` : "",
    ]
      .filter(Boolean)
      .join(" | ");

    const payload = {
      variantId: Number(selectedVariant.variant_id),
      quantity: targetStock,
      reason: normalizeText(reason) || "تصحيح المخزون",
      notes: finalNotes,
      warehouseId: warehouseId ? Number(warehouseId) || warehouseId : null,
      warehouse_id: warehouseId ? Number(warehouseId) || warehouseId : null,
      branchId: selectedVariant.branch_id || null,
      branch_id: selectedVariant.branch_id || null,
    };

    try {
      const response = await api.put("/inventory/update-stock", payload);
      const savedVariant = response?.variant || response?.data?.variant || null;
      const savedStock = Math.max(0, asNumber(savedVariant?.stock ?? targetStock, targetStock));
      const actualDelta = savedStock - currentStock;

      setCatalog((current) =>
        current.map((product) => {
          const variants = Array.isArray(product?.variants) ? product.variants : [];
          let matched = false;
          const nextVariants = variants.map((variant) => {
            if (String(variant?.variant_id ?? variant?.id) !== String(selectedVariant.variant_id)) return variant;
            matched = true;
            return {
              ...variant,
              ...(savedVariant || {}),
              stock: savedStock,
              stock_quantity: savedStock,
              available_quantity: savedStock,
              available: savedStock > 0,
            };
          });
          if (!matched) return product;
          const totalStock = nextVariants.reduce(
            (sum, variant) => sum + Math.max(0, asNumber(variant?.stock ?? variant?.stock_quantity, 0)),
            0
          );
          return {
            ...product,
            variants: nextVariants,
            stock: totalStock,
            total_stock: totalStock,
            stock_quantity: totalStock,
          };
        })
      );

      notifyProductRefresh("inventory-adjustment", {
        productId: selectedVariant.product_id,
        variantId: selectedVariant.variant_id,
      });

      const savedRecord = {
        id: `adj-${Date.now()}`,
        movement_type: "ADJUSTMENT",
        adjustment_type: adjustmentType,
        variant_id: selectedVariant.variant_id,
        product_id: selectedVariant.product_id,
        product_name: selectedVariant.product_name,
        image_url: selectedVariant.image_url,
        color: selectedVariant.color,
        size: selectedVariant.size,
        sku: selectedVariant.sku,
        barcode: selectedVariant.barcode,
        warehouse_id: warehouseId,
        warehouse_name: selectedWarehouseName,
        quantity_change: actualDelta,
        quantity_before: currentStock,
        quantity_after: savedStock,
        reason: normalizeText(reason) || "تصحيح المخزون",
        notes: finalNotes,
        user_name: normalizeText(currentUser?.name || currentUser?.full_name || currentUser?.email || "المستخدم الحالي"),
        created_at: timestamp,
        approval_threshold: approvalThreshold,
        approval_required: requiresManagerApproval,
        approval_name: normalizeText(approvalName),
        approval_notes: normalizeText(approvalNotes),
      };

      const nextAdjustments = [savedRecord, ...localAdjustments];
      const nextMovements = [
        {
          ...savedRecord,
        direction: actualDelta >= 0 ? "وارد" : "صادر",
        },
        ...localMovements,
      ];

      saveInventoryAdjustments(nextAdjustments);
      saveInventoryMovements(nextMovements);
      setLocalAdjustments(nextAdjustments);
      setLocalMovements(nextMovements);

      toast.success("تم تحديث المخزون وتسجيل الحركة");
      setNotes("");
      setReason(REASON_OPTIONS[0]);
      setQuantity(1);
      setApprovalConfirmed(false);
      setApprovalName("");
      setApprovalNotes("");
      setConfirmOpen(false);
    } catch (error) {
      console.log(error);
      toast.error(error?.message || "تعذر تحديث المخزون");
    } finally {
      setSubmitting(false);
    }
  };

  const openConfirmation = () => {
    if (!canAdjust) {
      toast.error("ليس لديك صلاحية تنفيذ تسويات المخزون");
      return;
    }
    if (!selectedVariant) {
      toast.error("اختر اختيارًا للمنتج أولًا");
      return;
    }
    if (!quantityDelta || quantityDelta < 1) {
      toast.error("يجب أن تكون الكمية 1 على الأقل");
      return;
    }
    if (adjustmentType === "decrease" && requestedTargetStock < 0) {
      toast.error("لا يمكن أن ينخفض المخزون إلى أقل من صفر");
      return;
    }
    setConfirmOpen(true);
  };

  const openHistory = async () => {
    if (!selectedVariant?.variant_id) return;
    try {
      setHistoryOpen(true);
      setHistoryLoading(true);
      setHistoryError("");
      const params = new URLSearchParams({
        variantId: String(selectedVariant.variant_id),
        productId: String(selectedVariant.product_id || ""),
        limit: "100",
      });
      const response = await api.get(`/inventory/variant/${selectedVariant.variant_id}/history?${params.toString()}`);
      setHistoryMovements(Array.isArray(response?.movements) ? response.movements : []);
    } catch (error) {
      console.log(error);
      setHistoryMovements([]);
      setHistoryError(error?.message || "تعذر تحميل سجل المنتج");
      toast.error(error?.message || "تعذر تحميل سجل المنتج");
    } finally {
      setHistoryLoading(false);
    }
  };

  const recentAdjustments = useMemo(() => {
    const records = [...localAdjustments];
    return records
      .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
      .slice(0, 8)
      .map((record) => {
        const matched = allVariants.find(
          (variant) => String(variant.variant_id) === String(record.variant_id) || String(variant.product_id) === String(record.product_id)
        );
        return {
          ...record,
          product_name: normalizeText(record.product_name || matched?.product_name || "منتج غير معروف"),
          image_url: normalizeText(record.image_url || matched?.image_url || ""),
          color: normalizeText(record.color || matched?.color || ""),
          size: normalizeText(record.size || matched?.size || ""),
          sku: normalizeText(record.sku || matched?.sku || ""),
          barcode: normalizeText(record.barcode || matched?.barcode || ""),
          warehouse_name: normalizeText(record.warehouse_name || matched?.warehouse_name || ""),
          user_name: normalizeText(record.user_name || currentUser?.name || "المستخدم الحالي"),
        };
      });
  }, [allVariants, currentUser?.name, localAdjustments]);

  return (
    <InventoryShell
      title="تسويات المخزون"
      subtitle="ابحث عن المنتجات بالاسم أو SKU أو الباركود، وراجع الرصيد الحالي قبل التعديل، واحفظ كل تغيير داخل سجل حركات المخزون."
      actions={
        <div className="flex flex-wrap gap-2">
          <Link
            to="/inventory/history"
            className="rounded-[var(--radius-card)] border border-border bg-surface-soft px-4 py-2 text-sm font-semibold text-text transition hover:bg-surface-hover"
          >
            <Clock3 className="mr-2 inline h-4 w-4" />
            السجل الكامل
          </Link>
          <Link
            to="/inventory/movements"
            className="rounded-[var(--radius-card)] border border-border bg-surface-soft px-4 py-2 text-sm font-semibold text-text transition hover:bg-surface-hover"
          >
            <History className="mr-2 inline h-4 w-4" />
            الحركات
          </Link>
        </div>
      }
      tabs={[
        { to: "/inventory", label: "المخزون", end: true },
        { to: "/inventory/movements", label: "الحركات" },
        { to: "/inventory/adjustments", label: "التسويات", end: true },
        { to: "/inventory/count", label: "الجرد" },
        { to: "/stock-transfers", label: "التحويلات" },
        { to: "/warehouses", label: "المخازن" },
      ]}
    >
      {!canAdjust ? (
        <div className="mb-4 rounded-[var(--radius-card)] border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-50">
          <ShieldAlert className="mr-2 inline h-4 w-4" />
            تسويات المخزون متاحة فقط للمستخدمين الذين لديهم صلاحية تعديل المخزون.
        </div>
      ) : null}

      {catalogError ? (
        <div className="mb-4 rounded-[var(--radius-card)] border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-50">
          <AlertTriangle className="mr-2 inline h-4 w-4" />
          {catalogError}
        </div>
      ) : null}

      {warehouseError ? (
        <div className="mb-4 rounded-[var(--radius-card)] border border-border bg-surface-soft p-4 text-sm text-text-muted">
          {warehouseError}
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(380px,0.8fr)]">
        <div className="space-y-4">
          <div className="rounded-[var(--radius-card)] border border-border bg-surface p-5 shadow-2xl shadow-black/10">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
              <label className="relative block flex-1">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="ابحث بالاسم أو SKU أو الباركود"
                  className="w-full rounded-[var(--radius-control)] border border-border bg-surface-soft py-3 pl-11 pr-4 text-sm text-text outline-none placeholder:text-text-muted"
                />
              </label>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={openScanner}
                  className="inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-border bg-surface-soft px-4 py-3 text-sm font-semibold text-text transition hover:bg-surface-hover"
                >
                  <Camera className="h-4 w-4" />
                  مسح الباركود
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSearch("");
                    setSelectedVariantId("");
                  }}
                  className="inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-border bg-surface-soft px-4 py-3 text-sm font-semibold text-text transition hover:bg-surface-hover"
                >
                  <X className="h-4 w-4" />
                  مسح
                </button>
              </div>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <PolicyCard label="سياسة التسوية" value={`حد الاعتماد: ${approvalThreshold}`} tone="blue" />
              <PolicyCard
                label="وضع الاعتماد"
                value={requiresManagerApproval ? "يلزم اعتماد المدير" : "اعتماد عادي"}
                tone={requiresManagerApproval ? "amber" : "emerald"}
              />
              <label className="block">
                <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-text-muted">حد الاعتماد القابل للتعديل</div>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={approvalThreshold}
                  onChange={(event) => setApprovalThreshold(Math.max(1, asNumber(event.target.value, DEFAULT_APPROVAL_THRESHOLD)))}
                  className="w-full rounded-[var(--radius-control)] border border-border bg-surface-soft px-4 py-3 text-sm text-text outline-none"
                />
              </label>
            </div>
            {warehouseLoading ? <div className="mt-3 text-xs text-text-muted">جارٍ تحميل المخازن...</div> : null}
          </div>

          <div className="rounded-[var(--radius-card)] border border-border bg-surface shadow-2xl shadow-black/10">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div>
                <h3 className="m1-section-title text-text">نتائج البحث عن المنتجات</h3>
                <p className="mt-1 text-sm text-text-muted">ابحث بالاسم أو SKU أو الباركود. اضغط أي اختيار لتحميل الرصيد والمخزن الخاص به.</p>
              </div>
                <div className="text-sm text-text-muted">{filteredVariants.length} نتيجة</div>
            </div>

            {catalogLoading ? (
              <div className="flex items-center justify-center py-16 text-text-muted">
                <Loader2 className="mr-2 h-5 w-5 animate-spin text-emerald-400" />
                جارٍ تحميل المنتجات...
              </div>
            ) : filteredVariants.length === 0 ? (
              <div className="p-8 text-center text-text-muted">
                <div className="rounded-[var(--radius-card)] border border-dashed border-border bg-surface-soft p-10">
                  اكتب كلمة بحث واحدة على الأقل للوصول إلى اختيار المنتج، أو امسح الباركود للانتقال مباشرة إلى نتيجة مطابقة.
                </div>
              </div>
            ) : (
              <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-1">
                {filteredVariants.map(({ variant }) => {
                  const selected = String(variant.variant_id) === String(selectedVariantId);
                  return (
                    <button
                      key={String(variant.variant_id)}
                      type="button"
                      onClick={() => selectVariant(variant)}
                      className={`flex w-full items-center gap-4 rounded-[var(--radius-control)] border p-4 text-left transition ${ selected ? "border-primary/30 bg-primary/10 shadow-lg shadow-primary/10" : "border-border bg-surface-soft hover:bg-surface-hover" }`}
                    >
                      <ProductThumb imageUrl={variant.image_url} productName={variant.product_name} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-base font-semibold text-text">{variant.product_name}</div>
                            <div className="mt-1 text-sm text-text-muted">{getVariantLabel(variant) || "افتراضي / مقاس موحد"}</div>
                          </div>
                          <div className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] ${selected ? "bg-primary text-[var(--primary-contrast)]" : "border border-border bg-surface-soft text-[var(--primary-contrast)]"}`}>
                            {selected ? "محدد" : "تحديد"}
                          </div>
                        </div>
                        <div className="mt-3 grid gap-2 text-xs text-text-muted sm:grid-cols-2">
                          <div>رمز الصنف: {variant.sku || "غير متاح"}</div>
                          <div>الباركود: {variant.barcode || "غير متاح"}</div>
                          <div>الرصيد: {asNumber(variant.stock, 0).toLocaleString()}</div>
                          <div>المخزن: {getWarehouseName(variant, warehouses) || "غير متاح"}</div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-[var(--radius-card)] border border-border bg-surface p-5 shadow-2xl shadow-black/10">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="m1-section-title text-text">المنتج المحدد</h3>
                <p className="mt-1 text-sm text-text-muted">يتم عرض الرصيد الحالي قبل تطبيق أي تسوية.</p>
              </div>
            </div>

            {!selectedVariant ? (
              <div className="rounded-[var(--radius-card)] border border-dashed border-border bg-surface-soft p-6 text-sm text-text-muted">
                اختر اختيارًا من نتائج البحث لمراجعة الرصيد الحالي وإكمال التسوية.
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex gap-4">
                  <ProductThumb imageUrl={selectedVariant.image_url} productName={selectedVariant.product_name} large />
                  <div className="min-w-0 flex-1">
                    <div className="text-2xl font-black text-text">{selectedVariant.product_name}</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                        <InfoPill label="اللون" value={selectedVariant.color || "افتراضي"} />
                        <InfoPill label="المقاس" value={selectedVariant.size || "مقاس موحد"} />
                    </div>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <DetailCard label="رمز الصنف" value={selectedVariant.sku || "غير متاح"} />
                  <DetailCard label="الباركود" value={selectedVariant.barcode || "غير متاح"} />
                  <DetailCard label="الرصيد الحالي" value={asNumber(selectedVariant.stock, 0).toLocaleString()} tone="emerald" />
                  <DetailCard label="المخزن" value={selectedWarehouseName || "غير متاح"} />
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={openHistory}
                    className="inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-border bg-surface-soft px-4 py-3 text-sm font-semibold text-text transition hover:bg-surface-hover"
                  >
                    <History className="h-4 w-4" />
                    عرض سجل المنتج
                  </button>
                  <button
                    type="button"
                    onClick={() => setSearch([selectedVariant.product_name, selectedVariant.sku, selectedVariant.barcode].filter(Boolean).join(" "))}
                    className="inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-border bg-surface-soft px-4 py-3 text-sm font-semibold text-text transition hover:bg-surface-hover"
                  >
                    <Search className="h-4 w-4" />
                    بحث من جديد
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="rounded-[var(--radius-card)] border border-border bg-surface p-5 shadow-2xl shadow-black/10">
            <div className="mb-4">
                <h3 className="m1-section-title text-text">نموذج التسوية</h3>
                <p className="mt-1 text-sm text-text-muted">حدد طريقة حركة المخزون ثم أكد التغيير بعد مراجعة الرصيد المستهدف.</p>
            </div>

            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="block">
                  <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-text-muted">نوع التسوية</div>
                  <div className="grid grid-cols-2 gap-2">
                    {ADJUSTMENT_TYPES.map((type) => {
                      const active = adjustmentType === type.value;
                      return (
                        <button
                          key={type.value}
                          type="button"
                          onClick={() => setAdjustmentType(type.value)}
                          className={`rounded-[var(--radius-control)] border px-4 py-3 text-sm font-semibold transition ${ active ? type.tone === "emerald" ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-200" : "border-rose-400/30 bg-rose-500/10 text-rose-200" : "border-border bg-surface-soft text-text hover:bg-surface-hover" }`}
                        >
                          {type.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <label className="block">
                  <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-text-muted">الكمية</div>
                  <div className="flex items-stretch gap-2">
                    <button
                      type="button"
                      onClick={() => setQuantity((value) => Math.max(1, asNumber(value, 1) - 1))}
                      className="inline-flex w-12 items-center justify-center rounded-[var(--radius-control)] border border-border bg-surface-soft text-text transition hover:bg-surface-hover"
                    >
                      <Minus className="h-4 w-4" />
                    </button>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={quantity}
                      onChange={(event) => setQuantity(Math.max(1, asNumber(event.target.value, 1)))}
                      className="w-full rounded-[var(--radius-control)] border border-border bg-surface-soft px-4 py-3 text-sm text-text outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setQuantity((value) => asNumber(value, 1) + 1)}
                      className="inline-flex w-12 items-center justify-center rounded-[var(--radius-control)] border border-border bg-surface-soft text-text transition hover:bg-surface-hover"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </div>
                </label>
              </div>

              <label className="block">
                  <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-text-muted">السبب</div>
                <select
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  className="w-full rounded-[var(--radius-control)] border border-border bg-surface-soft px-4 py-3 text-sm text-text outline-none"
                >
                  {REASON_OPTIONS.map((option) => (
                    <option key={option} value={option} className="bg-surface text-text">
                      {option}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-text-muted">ملاحظات اختيارية</div>
                <textarea
                  rows={4}
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="أضف ملاحظة قصيرة لسجل حركة المخزون"
                  className="w-full rounded-[var(--radius-control)] border border-border bg-surface-soft p-4 text-sm text-text outline-none placeholder:text-text-muted"
                />
              </label>

              <div className="rounded-[var(--radius-card)] border border-border bg-surface-soft p-4">
                <div className="grid gap-3 sm:grid-cols-3">
                  <DetailCard label="الرصيد قبل" value={asNumber(currentStock, 0).toLocaleString()} />
                  <DetailCard label="التغيير" value={`${signedDelta >= 0 ? "+" : ""}${signedDelta.toLocaleString()}`} tone={signedDelta >= 0 ? "emerald" : "rose"} />
                  <DetailCard label="الرصيد بعد" value={targetStock.toLocaleString()} tone={targetStock >= currentStock ? "emerald" : "rose"} />
                </div>

                {requiresManagerApproval ? (
                  <div className="mt-4 rounded-[var(--radius-card)] border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-50">
                    <ShieldAlert className="mr-2 inline h-4 w-4" />
                    هذه التسوية تتجاوز الحد المحدد وهو {approvalThreshold}. يلزم اعتماد المدير قبل تطبيقها.
                  </div>
                ) : null}

                <button
                  type="button"
                  onClick={openConfirmation}
                  disabled={!selectedVariant || !canAdjust || catalogLoading}
                  className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-[var(--radius-control)] bg-primary px-4 py-3 text-sm font-black text-[var(--primary-contrast)] transition hover:bg-primary disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Save className="h-4 w-4" />
                  تطبيق التسوية
                </button>
              </div>
            </div>
          </div>

          <div className="rounded-[var(--radius-card)] border border-border bg-surface shadow-2xl shadow-black/10">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div>
                <h3 className="m1-section-title text-text">آخر التسويات</h3>
                <p className="mt-1 text-sm text-text-muted">أحدث سجلات التسوية المحلية مع سياق المنتج.</p>
              </div>
              <div className="text-sm text-text-muted">{recentAdjustments.length} عنصر</div>
            </div>

            <div className="space-y-3 p-4">
              {recentAdjustments.length === 0 ? (
                <div className="rounded-[var(--radius-card)] border border-dashed border-border bg-surface-soft p-6 text-sm text-text-muted">
                  لم تُسجَّل أي تسويات بعد.
                </div>
              ) : (
                recentAdjustments.map((adjustment) => {
                  const delta = asNumber(adjustment.quantity_change, 0);
                  const isIncrease = delta >= 0;
                  return (
                    <div key={String(adjustment.id)} className="rounded-[var(--radius-card)] border border-border bg-surface-soft p-4">
                      <div className="flex items-start gap-3">
                        <ProductThumb imageUrl={adjustment.image_url} productName={adjustment.product_name} compact />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="truncate font-semibold text-text">{adjustment.product_name}</div>
                              <div className="mt-1 text-xs text-text-muted">{[adjustment.color, adjustment.size].filter(Boolean).join(" / ") || "افتراضي"}</div>
                            </div>
                            <div className={`rounded-full px-3 py-1 text-xs font-semibold ${isIncrease ? "bg-emerald-500/10 text-emerald-200" : "bg-rose-500/10 text-rose-200"}`}>
                              {isIncrease ? "+" : ""}
                              {delta}
                            </div>
                          </div>

                          <div className="mt-3 grid gap-2 text-xs text-text-muted sm:grid-cols-2">
                            <div>النوع: {adjustment.adjustment_type === "decrease" ? "خفض المخزون" : "زيادة المخزون"}</div>
                            <div>المستخدم: {adjustment.user_name || "غير متاح"}</div>
                            <div>الوقت: {formatDateTime(adjustment.created_at)}</div>
                            <div>المخزن: {adjustment.warehouse_name || "غير متاح"}</div>
                          </div>

                          <div className="mt-3 text-sm text-text-muted">{adjustment.reason || "لم يتم توفير سبب"}</div>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>

      {scannerOpen ? (
        <ScannerModal
          onClose={() => setScannerOpen(false)}
          onScan={handleScan}
          onPermissionDenied={(message) => {
            setScannerOpen(false);
            toast.error(message || barcodeScannerMessages.permissionDenied);
          }}
          onUnsupported={(message) => {
            setScannerOpen(false);
            toast.error(message || barcodeScannerMessages.unsupported);
          }}
          onError={(message) => {
            toast.error(message || barcodeScannerMessages.startFailed);
          }}
        />
      ) : null}

      {confirmOpen && selectedVariant ? (
        <ConfirmationModal
          productName={selectedVariant.product_name}
          imageUrl={selectedVariant.image_url}
          color={selectedVariant.color}
          size={selectedVariant.size}
          sku={selectedVariant.sku}
          barcode={selectedVariant.barcode}
          currentStock={currentStock}
          signedDelta={signedDelta}
          targetStock={targetStock}
          adjustmentType={adjustmentType}
          reason={reason}
          notes={notes}
          warehouseName={selectedWarehouseName}
          requiresManagerApproval={requiresManagerApproval}
          approvalThreshold={approvalThreshold}
          approvalConfirmed={approvalConfirmed}
          approvalName={approvalName}
          approvalNotes={approvalNotes}
          setApprovalConfirmed={setApprovalConfirmed}
          setApprovalName={setApprovalName}
          setApprovalNotes={setApprovalNotes}
          onClose={() => setConfirmOpen(false)}
          onConfirm={submitAdjustment}
          submitting={submitting}
        />
      ) : null}

      {historyOpen && selectedVariant ? (
        <ProductHistoryDrawer
          productName={selectedVariant.product_name}
          variantLabel={getVariantLabel(selectedVariant) || "افتراضي / مقاس موحد"}
          movements={historyMovements}
          loading={historyLoading}
          error={historyError}
          onClose={() => setHistoryOpen(false)}
          warehouseName={selectedWarehouseName}
        />
      ) : null}
    </InventoryShell>
  );
}

function PolicyCard({ label, value, tone = "zinc" }) {
  const toneClasses = {
    zinc: "border-border bg-surface-soft text-text",
    blue: "border-primary/20 bg-primary/10 text-primary",
    emerald: "border-emerald-500/20 bg-emerald-500/10 text-emerald-200",
    amber: "border-amber-500/20 bg-amber-500/10 text-amber-200",
  };

  return (
    <div className={`rounded-[var(--radius-card)] border p-4 ${toneClasses[tone] || toneClasses.zinc}`}>
      <div className="text-[10px] uppercase tracking-[0.18em] text-text-muted">{label}</div>
      <div className="mt-2 text-sm font-semibold">{value}</div>
    </div>
  );
}

function DetailCard({ label, value, tone = "zinc" }) {
  const toneClasses = {
    zinc: "border-border bg-surface-soft text-text",
    emerald: "border-emerald-500/20 bg-emerald-500/10 text-emerald-200",
    rose: "border-rose-500/20 bg-rose-500/10 text-rose-200",
  };

  return (
    <div className={`rounded-[var(--radius-card)] border p-4 ${toneClasses[tone] || toneClasses.zinc}`}>
      <div className="text-[10px] uppercase tracking-[0.18em] text-text-muted">{label}</div>
      <div className="mt-2 break-words text-sm font-semibold">{value}</div>
    </div>
  );
}

function InfoPill({ label, value }) {
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-border bg-surface-soft px-3 py-1 text-xs font-semibold text-text">
      <span className="text-text-muted">{label}:</span>
      <span>{value}</span>
    </div>
  );
}

function ProductThumb({ imageUrl, productName, large = false, compact = false }) {
  const sizeClass = large ? "h-24 w-24" : compact ? "h-14 w-14" : "h-20 w-20";
  return (
    <div className={`flex ${sizeClass} shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface-soft`}>
      {imageUrl ? (
        <img src={imageUrl} alt={productName || "Product"} className="h-full w-full object-cover" loading="lazy" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-text-muted">
          <ImageOff className={large ? "h-8 w-8" : "h-5 w-5"} />
        </div>
      )}
    </div>
  );
}

function ScannerModal({ onClose, onScan, onPermissionDenied, onUnsupported, onError }) {
  return (
    <div className="fixed inset-0 z-50">
      <button type="button" onClick={onClose} className="absolute inset-0 bg-black/80" aria-label="إغلاق الماسح" />
      <div className="absolute inset-x-0 bottom-0 top-0 mx-auto flex w-full max-w-3xl items-center justify-center p-4">
        <div className="w-full rounded-[var(--radius-card)] border border-border bg-surface shadow-[0_30px_100px_rgba(0,0,0,0.55)]">
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <div>
              <div className="text-xs uppercase tracking-[0.24em] text-text-muted">ماسح الباركود</div>
              <h3 className="m1-section-title mt-1 text-text">امسح باركود المنتج</h3>
            </div>
            <button type="button" onClick={onClose} className="rounded-[var(--radius-control)] border border-border bg-surface-soft px-3 py-2 text-sm font-semibold text-text">
              إغلاق
            </button>
          </div>
          <div className="space-y-4 p-5">
            <div className="rounded-[var(--radius-card)] border border-border bg-surface-soft p-4 text-sm text-text-muted">
              سيتم استخدام الكاميرا عند توفرها. إذا كان الجهاز لا يدعم المسح، أدخل رمز الصنف أو الباركود في مربع البحث بدلًا من ذلك.
            </div>
            <div className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-black">
              <BarcodeScanner
                className="w-full"
                scannerClassName="min-h-[320px] w-full"
                onScan={onScan}
                onPermissionDenied={onPermissionDenied}
                onUnsupported={onUnsupported}
                onError={onError}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={onClose} className="inline-flex items-center gap-2 rounded-[var(--radius-control)] bg-primary px-4 py-3 text-sm font-black text-[var(--primary-contrast)]">
                <CheckCircle2 className="h-4 w-4" />
                تم
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ConfirmationModal({
  productName,
  imageUrl,
  color,
  size,
  sku,
  barcode,
  currentStock,
  signedDelta,
  targetStock,
  adjustmentType,
  reason,
  notes,
  warehouseName,
  requiresManagerApproval,
  approvalThreshold,
  approvalConfirmed,
  approvalName,
  approvalNotes,
  setApprovalConfirmed,
  setApprovalName,
  setApprovalNotes,
  onClose,
  onConfirm,
  submitting,
}) {
  return (
    <div className="fixed inset-0 z-50">
      <button type="button" onClick={onClose} className="absolute inset-0 bg-black/80" aria-label="إغلاق تأكيد التسوية" />
      <div className="absolute inset-x-0 bottom-0 top-0 mx-auto flex w-full max-w-3xl items-center justify-center p-4">
        <div className="w-full rounded-[var(--radius-card)] border border-border bg-surface shadow-[0_30px_100px_rgba(0,0,0,0.55)]">
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <div>
              <div className="text-xs uppercase tracking-[0.24em] text-text-muted">تأكيد التسوية</div>
              <h3 className="m1-section-title mt-1 text-text">{productName}</h3>
            </div>
            <button type="button" onClick={onClose} className="rounded-[var(--radius-control)] border border-border bg-surface-soft px-3 py-2 text-sm font-semibold text-text">
              إغلاق
            </button>
          </div>

          <div className="grid gap-5 p-5 lg:grid-cols-[auto_1fr]">
            <ProductThumb imageUrl={imageUrl} productName={productName} large />

            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <DetailCard label="الاختيار" value={[color, size].filter(Boolean).join(" / ") || "افتراضي"} />
                <DetailCard label="المخزن" value={warehouseName || "غير متاح"} />
                <DetailCard label="رمز الصنف" value={sku || "غير متاح"} />
                <DetailCard label="الباركود" value={barcode || "غير متاح"} />
                <DetailCard label="الرصيد الحالي" value={currentStock.toLocaleString()} />
                <DetailCard label="الرصيد المستهدف" value={targetStock.toLocaleString()} tone={targetStock >= currentStock ? "emerald" : "rose"} />
              </div>

              <div className="rounded-[var(--radius-card)] border border-border bg-surface-soft p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm text-text-muted">نوع التسوية</div>
                  <div className="rounded-full border border-border bg-surface-soft px-3 py-1 text-sm font-semibold text-text">
                    {adjustmentType === "decrease" ? "خفض المخزون" : "زيادة المخزون"}
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between gap-3 text-sm text-text-muted">
                  <span>التغيير في الكمية</span>
                  <span className={signedDelta >= 0 ? "text-emerald-200" : "text-rose-200"}>
                    {signedDelta >= 0 ? "+" : ""}
                    {signedDelta.toLocaleString()}
                  </span>
                </div>
                <div className="mt-2 text-sm text-text-muted">
                  السبب: <span className="font-semibold text-text">{reason || "غير متاح"}</span>
                </div>
                {notes ? (
                  <div className="mt-2 text-sm text-text-muted">
                    الملاحظات: <span className="font-semibold text-text">{notes}</span>
                  </div>
                ) : null}
              </div>

              {requiresManagerApproval ? (
                <div className="rounded-[var(--radius-card)] border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-50">
                  <ShieldAlert className="mr-2 inline h-4 w-4" />
              هذا التغيير يتجاوز الحد المحدد وهو {approvalThreshold}. يلزم اعتماد المدير قبل الحفظ.
                  <div className="mt-4 grid gap-3">
                    <label className="block">
                      <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-amber-100/70">اسم المعتمد</div>
                      <input
                        value={approvalName}
                        onChange={(event) => setApprovalName(event.target.value)}
                        placeholder="اسم المدير"
                        className="w-full rounded-[var(--radius-control)] border border-border bg-surface px-4 py-3 text-sm text-text outline-none placeholder:text-text-muted"
                      />
                    </label>
                    <label className="block">
                      <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-amber-100/70">ملاحظات الاعتماد</div>
                      <textarea
                        rows={3}
                        value={approvalNotes}
                        onChange={(event) => setApprovalNotes(event.target.value)}
                        placeholder="ملاحظة اعتماد اختيارية"
                        className="w-full rounded-[var(--radius-control)] border border-border bg-surface p-4 text-sm text-text outline-none placeholder:text-text-muted"
                      />
                    </label>
                    <label className="flex items-center gap-3 rounded-[var(--radius-card)] border border-border bg-surface px-4 py-3 text-sm text-text">
                      <input
                        type="checkbox"
                        checked={approvalConfirmed}
                        onChange={(event) => setApprovalConfirmed(event.target.checked)}
                        className="h-4 w-4 rounded border-border bg-transparent text-primary"
                      />
                      المدير اعتمد هذه التسوية
                    </label>
                  </div>
                </div>
              ) : (
                <div className="rounded-[var(--radius-card)] border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-50">
                  <CheckCircle2 className="mr-2 inline h-4 w-4" />
                  لا يلزم اعتماد إضافي لهذه التسوية.
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={onClose} className="rounded-[var(--radius-control)] border border-border bg-surface-soft px-4 py-3 text-sm font-semibold text-text">
                  إلغاء
                </button>
                <button
                  type="button"
                  onClick={onConfirm}
                  disabled={submitting || (requiresManagerApproval && (!approvalConfirmed || !normalizeText(approvalName)))}
                  className="inline-flex items-center gap-2 rounded-[var(--radius-control)] bg-primary px-4 py-3 text-sm font-black text-[var(--primary-contrast)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  {requiresManagerApproval ? "اعتماد وتطبيق" : "تطبيق التسوية"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ProductHistoryDrawer({ productName, variantLabel, movements, loading, error, onClose, warehouseName }) {
  return (
    <div className="fixed inset-0 z-50">
      <button type="button" onClick={onClose} className="absolute inset-0 bg-black/70" aria-label="إغلاق سجل المنتج" />
      <div className="absolute right-0 top-0 h-full w-full max-w-[720px] border-l border-border bg-surface shadow-[0_30px_100px_rgba(0,0,0,0.5)]">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-text-muted">سجل المنتج</p>
            <h3 className="m1-section-title mt-1 text-text">{productName}</h3>
            <p className="mt-1 text-sm text-text-muted">{[variantLabel, warehouseName].filter(Boolean).join(" / ")}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-[var(--radius-control)] border border-border bg-surface-soft px-3 py-2 text-sm font-semibold text-text">
            إغلاق
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto p-5">
          {loading ? (
            <div className="flex items-center justify-center rounded-[var(--radius-card)] border border-border bg-surface-soft py-16 text-text-muted">
              <Loader2 className="mr-2 h-5 w-5 animate-spin text-emerald-400" />
              جارٍ تحميل سجل المنتج...
            </div>
          ) : error ? (
            <div className="rounded-[var(--radius-card)] border border-red-500/20 bg-red-500/10 p-5 text-sm text-red-100">{error}</div>
          ) : movements.length === 0 ? (
            <div className="rounded-[var(--radius-card)] border border-dashed border-border bg-surface-soft p-8 text-sm text-text-muted">
              لا توجد حركات مخزون لهذا الاختيار.
            </div>
          ) : (
            movements.map((movement) => {
              const delta = asNumber(movement.quantity_change ?? movement.quantity_delta ?? movement.quantity ?? 0, 0);
              const before = asNumber(movement.quantity_before ?? 0, 0);
              const after = asNumber(movement.quantity_after ?? 0, 0);
              return (
                <div key={String(movement.id)} className="rounded-[var(--radius-card)] border border-border bg-surface-soft p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold text-text">{movement.movement_type || "تسوية"}</div>
                      <div className="mt-1 text-xs text-text-muted">{formatDateTime(movement.created_at)}</div>
                    </div>
                    <div className={`rounded-full px-3 py-1 text-xs font-semibold ${delta >= 0 ? "bg-emerald-500/10 text-emerald-200" : "bg-rose-500/10 text-rose-200"}`}>
                      {delta >= 0 ? "+" : ""}
                      {delta}
                    </div>
                  </div>

                  <div className="mt-4 grid gap-2 text-sm text-text-muted sm:grid-cols-2">
                    <div>قبل: {before.toLocaleString()}</div>
                    <div>بعد: {after.toLocaleString()}</div>
                    <div>المستخدم: {movement.created_by_name || movement.user_name || "غير متاح"}</div>
                    <div>المخزن: {movement.warehouse_name || "غير متاح"}</div>
                    <div className="sm:col-span-2">السبب: {movement.reason || movement.notes || "غير متاح"}</div>
                    <div className="sm:col-span-2">المرجع: {movement.reference_type || "غير متاح"} #{movement.reference_id || "غير متاح"}</div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

export default StockAdjustments;
