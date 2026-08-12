import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import {
  ArrowLeft,
  ArrowRight,
  Camera,
  CheckCircle2,
  ChevronLeft,
  ClipboardList,
  Filter,
  Loader2,
  Plus,
  RotateCcw,
  Search,
  Save,
  SquareArrowOutUpRight,
  Trash2,
  Warehouse,
  X,
} from "lucide-react";
import toast from "react-hot-toast";

import BarcodeScanner from "../../../components/BarcodeScanner";
import { api } from "../../../shared/api/api";
import { getProductAudienceValues, productMatchesAudience } from "../../../shared/lib/productAudiences";
import { getCurrentUser, getUserRole, isAdminUser } from "../../../shared/auth/authStorage";
import InventoryShell from "../components/InventoryShell";
import StatusBadge from "../../purchases/components/StatusBadge";
import SmartPosFilters from "../../pos/components/SmartPosFilters";
import { formatDateTime, normalizeWarehouse } from "../../purchases/lib/flowStore";
import {
  approveInventoryCountSession,
  cancelInventoryCountSession,
  createInventoryCountSession,
  deleteInventoryCountSession,
  getInventoryCountSession,
  listInventoryCountSessions,
  openInventoryCountSession,
  addInventoryCountModel,
  searchInventoryCountVariants,
  reopenInventoryCountSession,
  rejectInventoryCountSession,
  submitInventoryCountSession,
  updateInventoryCountSession,
  upsertInventoryCountItem,
} from "../services/inventoryCountApi";

const COUNT_REASONS = [
  "خطأ بيع",
  "خطأ استلام",
  "تالف",
  "فقد",
  "تسوية يدوية",
  "أخرى",
];

const SESSION_STATUS_LABELS = {
  draft: "مسودة",
  in_progress: "قيد الجرد",
  completed: "مكتمل",
  cancelled: "ملغي",
};

const statusTone = {
  draft: "border-white/10 bg-white/5 text-white",
  in_progress: "border-amber-500/25 bg-amber-500/10 text-amber-100",
  completed: "border-emerald-500/25 bg-emerald-500/10 text-emerald-100",
  cancelled: "border-rose-500/25 bg-rose-500/10 text-rose-100",
};

Object.assign(SESSION_STATUS_LABELS, {
  pending_review: "قيد المراجعة",
  rejected: "مرفوض",
});

Object.assign(statusTone, {
  pending_review: "border-sky-500/25 bg-sky-500/10 text-sky-100",
  rejected: "border-rose-500/25 bg-rose-500/10 text-rose-100",
});

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeText = (value = "") => String(value || "").trim();
const isDevEnvironment = typeof import.meta !== "undefined" && import.meta.env?.DEV;
const logDevDuration = (label, startedAt, payload = {}) => {
  if (!isDevEnvironment) return;
  const durationMs = Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt);
  console.debug(`[inventory-count] ${label}`, { durationMs, ...payload });
};

const normalizeImageValue = (value = "") => {
  if (!value) return "";
  if (Array.isArray(value)) return normalizeImageValue(value[0]);
  if (typeof value === "object") {
    return normalizeImageValue(
      value.image_url ||
        value.imageUrl ||
        value.url ||
        value.path ||
        value.src ||
        value.image ||
        value.photo_url ||
        value.thumbnail_url ||
        value.secure_url ||
        ""
    );
  }
  return normalizeText(value);
};

const resolveCountVariantImageData = (record = {}) => {
  const colorImage = normalizeImageValue(
    record.color_image_url ||
      record.primary_image_url ||
      record.color?.main_image_url ||
      record.color?.main_image ||
      record.color?.image_url ||
      record.color?.image ||
      record.color?.url ||
      ""
  );
  const variantImage = normalizeImageValue(
    record.variant_image_url ||
      record.product_variant_image_url ||
      record.image_url ||
      record.image ||
      record.main_image_url ||
      record.main_image ||
      record.variant?.image_url ||
      record.variant?.main_image_url ||
      record.variant?.main_image ||
      record.variant?.image ||
      record.variant?.url ||
      ""
  );
  const productImage = normalizeImageValue(
    record.product_image ||
      record.product_image_url ||
      record.product_main_image ||
      record.product_main_image_url ||
      record.main_image ||
      record.main_image_url ||
      record.product?.image_url ||
      record.product?.product_image_url ||
      record.product?.main_image_url ||
      record.product?.main_image ||
      record.product?.image ||
      ""
  );
  const firstProductImage = normalizeImageValue(
    record.product_images?.[0] ||
      record.gallery_images?.[0] ||
      record.product?.images?.[0] ||
      record.product?.gallery_images?.[0] ||
      record.images?.[0] ||
      ""
  );
  const mainImage = normalizeImageValue(
    record.main_image ||
      record.main_image_url ||
      record.product_main_image ||
      record.product_main_image_url ||
      productImage ||
      variantImage ||
      colorImage ||
      firstProductImage ||
      ""
  );

  const imageUrl = colorImage || variantImage || mainImage || productImage || firstProductImage || "";
  const imageSourceRank = colorImage ? 1 : variantImage || mainImage ? 2 : productImage ? 3 : firstProductImage ? 4 : 0;

  return {
    image_url: imageUrl,
    color_image_url: colorImage || "",
    variant_image_url: variantImage || "",
    product_image: productImage || "",
    product_image_url: productImage || "",
    main_image: mainImage || "",
    main_image_url: mainImage || "",
    primary_image_url: colorImage || variantImage || productImage || firstProductImage || "",
    image_source_rank: imageSourceRank,
  };
};

const resolveInventoryImage = (record = {}) =>
  normalizeImageValue(
    record.color_image_url ||
      record.variant_image_url ||
      record.image_url ||
      record.product_image ||
      record.product_image_url ||
      record.main_image ||
      record.main_image_url ||
      ""
  );

const pickBestCountImageData = (records = []) => {
  let best = {
    image_url: "",
    color_image_url: "",
    variant_image_url: "",
    product_image: "",
    product_image_url: "",
    main_image: "",
    main_image_url: "",
    primary_image_url: "",
    image_source_rank: Number.POSITIVE_INFINITY,
  };

  for (const record of Array.isArray(records) ? records : []) {
    const imageData = resolveCountVariantImageData(record);
    if (!imageData.image_url) continue;

    const rank = Number(imageData.image_source_rank || Number.POSITIVE_INFINITY);
    if (rank < best.image_source_rank) {
      best = imageData;
      best.image_source_rank = rank;
      continue;
    }

    if (rank === best.image_source_rank && !best.image_url) {
      best = imageData;
      best.image_source_rank = rank;
    }
  }

  return best;
};

const normalizeInventoryCountItems = (records = []) =>
  (Array.isArray(records) ? records : []).map((record) => ({
    ...record,
    ...resolveCountVariantImageData(record),
  }));

const sizeSortValue = (value) => {
  const text = normalizeText(value);
  if (!text) return Number.POSITIVE_INFINITY;
  const numeric = Number.parseFloat(text.replace(",", "."));
  return Number.isFinite(numeric) ? numeric : Number.POSITIVE_INFINITY;
};

const normalizeCountVariant = (record = {}) => {
  const productId = record.product_id || record.productId || (record.product ? record.product.id : null) || null;
  const variantId = record.product_variant_id || record.variant_id || record.variantId || record.id || null;
  const productName = normalizeText(record.product_name || record.productName || record.name || "");
  const productSku = normalizeText(record.product_sku || record.productSku || record.sku || "");
  const productBarcode = normalizeText(record.product_barcode || record.productBarcode || record.barcode || "");
  const productCode = normalizeText(record.product_code || record.productCode || "");
  const category = normalizeText(record.category || record.category_name || record.grade || "");
  const type = normalizeText(record.type || record.product_type || record.productType || "");
  const brand = normalizeText(record.brand || record.brand_name || "");
  const manufacturerName = normalizeText(record.manufacturer_name || record.manufacturer || "");
  const gender = normalizeText(record.audience || record.variant_audience || record.gender || "");
  const color = normalizeText(record.color || record.variant_color || record.color_name || "");
  const size = normalizeText(record.size || record.variant_size || record.size_name || "");
  const sku = normalizeText(record.sku || record.variant_sku || "");
  const barcode = normalizeText(record.barcode || record.variant_barcode || "");
  const variantCode = normalizeText(record.variant_code || record.variantCode || "");
  const articleCode = normalizeText(record.article_code || record.variant_article_code || "");
  const imageData = resolveCountVariantImageData(record);
  const systemQuantity = toNumber(record.system_quantity ?? record.stock ?? record.expected_qty ?? 0);
  const countedQuantity = toNumber(record.counted_quantity ?? record.actual_qty ?? 0);
  const differenceQuantity = toNumber(record.difference_quantity ?? record.difference_qty ?? (countedQuantity - systemQuantity));

  return {
    id: record.id || null,
    product_id: productId,
    product_variant_id: variantId,
    product_name: productName,
    product_sku: productSku,
    product_barcode: productBarcode,
    product_code: productCode,
    category,
    type,
    brand,
    manufacturer_name: manufacturerName,
    gender,
    color,
    size,
    sku,
    barcode,
    variant_code: variantCode,
    article_code: articleCode,
    ...imageData,
    system_quantity: systemQuantity,
    counted_quantity: countedQuantity,
    difference_quantity: differenceQuantity,
    reason: normalizeText(record.reason || ""),
    notes: normalizeText(record.notes || ""),
    variant_color: color,
    variant_size: size,
    variant_sku: sku,
    variant_barcode: barcode,
    variant_code: variantCode,
    variant_article_code: articleCode,
    variant_product_sku: productSku,
    variant_product_barcode: productBarcode,
    variant_product_code: productCode,
    variant_category: category,
    variant_type: type,
    variant_brand: brand,
    variant_manufacturer_name: manufacturerName,
    variant_gender: gender,
    variant_image_url: imageData.variant_image_url || imageData.image_url,
    actual_qty: countedQuantity,
    expected_qty: systemQuantity,
    difference_qty: differenceQuantity,
  };
};

const groupCountVariants = (records = []) => {
  const groups = new Map();

  for (const record of records) {
    const variant = normalizeCountVariant(record);
    const productKey = variant.product_id ? String(variant.product_id) : variant.product_name.toLowerCase();
    const colorKey = variant.color.toLowerCase() || "default";
    const key = `${productKey}::${colorKey}`;

      if (!groups.has(key)) {
        groups.set(key, {
          key,
          product_id: variant.product_id,
          product_name: variant.product_name,
          category: variant.category,
          type: variant.type,
          brand: variant.brand,
          manufacturer_name: variant.manufacturer_name,
          gender: variant.gender,
          color: variant.color,
          image_url: variant.image_url,
          image_source_rank: variant.image_source_rank || 0,
          color_image_url: variant.color_image_url || "",
          variant_image_url: variant.variant_image_url || "",
          product_image: variant.product_image || "",
          main_image: variant.main_image || "",
          main_image_url: variant.main_image_url || "",
          variants: [],
          system_total: 0,
          counted_total: 0,
          difference_total: 0,
        });
    }

    const group = groups.get(key);
    const currentRank = Number(group.image_source_rank || 0);
    const candidateRank = Number(variant.image_source_rank || 0);
    if (!group.image_url || (candidateRank > 0 && (currentRank === 0 || candidateRank < currentRank))) {
      group.image_url = variant.image_url;
      group.image_source_rank = candidateRank || currentRank || 0;
      group.color_image_url = variant.color_image_url || group.color_image_url || "";
      group.variant_image_url = variant.variant_image_url || group.variant_image_url || "";
      group.product_image = variant.product_image || group.product_image || "";
    }
    group.variants.push(variant);
    group.system_total += toNumber(variant.system_quantity, 0);
    group.counted_total += toNumber(variant.counted_quantity, 0);
    group.difference_total += toNumber(variant.difference_quantity, variant.counted_quantity - variant.system_quantity);
  }

    return Array.from(groups.values()).map((group) => {
      const bestImage = pickBestCountImageData([group, ...group.variants]);
      return {
        ...group,
        ...bestImage,
        variants: group.variants.sort((a, b) => {
          const bySize = sizeSortValue(a.size) - sizeSortValue(b.size);
          if (bySize !== 0) return bySize;
          return String(a.size || "").localeCompare(String(b.size || ""));
        }),
      };
    });
  };

const groupLookupModels = (records = []) => {
  const groups = new Map();

  for (const record of records) {
    const variant = normalizeCountVariant(record);
    const productKey = variant.product_id ? String(variant.product_id) : variant.product_name.toLowerCase();

      if (!groups.has(productKey)) {
        groups.set(productKey, {
          key: productKey,
          product_id: variant.product_id,
          product_name: variant.product_name,
          product_sku: variant.product_sku,
          product_barcode: variant.product_barcode,
          category: variant.category,
          type: variant.type,
          brand: variant.brand,
          manufacturer_name: variant.manufacturer_name,
          gender: variant.gender,
          image_url: variant.image_url,
          image_source_rank: variant.image_source_rank || 0,
          color_image_url: variant.color_image_url || "",
          variant_image_url: variant.variant_image_url || "",
          product_image: variant.product_image || "",
          main_image: variant.main_image || "",
          main_image_url: variant.main_image_url || "",
          variants: [],
          colors: new Set(),
          sizes: new Set(),
          system_total: 0,
        });
    }

    const group = groups.get(productKey);
    const currentRank = Number(group.image_source_rank || 0);
    const candidateRank = Number(variant.image_source_rank || 0);
    if (!group.image_url || (candidateRank > 0 && (currentRank === 0 || candidateRank < currentRank))) {
      group.image_url = variant.image_url;
      group.image_source_rank = candidateRank || currentRank || 0;
      group.color_image_url = variant.color_image_url || group.color_image_url || "";
      group.variant_image_url = variant.variant_image_url || group.variant_image_url || "";
      group.product_image = variant.product_image || group.product_image || "";
    }
    group.variants.push(variant);
    if (variant.color) group.colors.add(variant.color);
    if (variant.size) group.sizes.add(variant.size);
    group.system_total += toNumber(variant.system_quantity, 0);
  }

    return Array.from(groups.values()).map((group) => {
      const bestImage = pickBestCountImageData([group, ...group.variants]);
      return {
        ...group,
        ...bestImage,
        colors: Array.from(group.colors),
        sizes: Array.from(group.sizes),
        variants: group.variants.sort((a, b) => {
          const byColor = String(a.color || "").localeCompare(String(b.color || ""));
          if (byColor !== 0) return byColor;
          const bySize = sizeSortValue(a.size) - sizeSortValue(b.size);
          if (bySize !== 0) return bySize;
          return String(a.size || "").localeCompare(String(b.size || ""));
        }),
      };
    });
  };

const buildFilterOptions = (records = [], fields) => {
  const options = new Map();
  const fieldList = Array.isArray(fields) ? fields : [fields];

  for (const record of Array.isArray(records) ? records : []) {
    for (const field of fieldList) {
      const value = normalizeText(record?.[field] || "");
      if (!value) continue;
      const key = value.toLowerCase();
      const current = options.get(key) || { id: value, name: value, count: 0 };
      current.count += 1;
      options.set(key, current);
    }
  }

  return Array.from(options.values()).sort((a, b) => a.name.localeCompare(b.name, "ar"));
};

const matchesInventoryFilters = (group = {}, filters = {}, selectedSize = "all") => {
  const normalize = (value) => normalizeText(value).toLowerCase();
  const selectedGender = normalize(filters.gender);
  const selectedType = normalize(filters.type);
  const selectedCategory = normalize(filters.category);
  const selectedBrand = normalize(filters.brand);
  const selectedManufacturer = normalize(filters.manufacturer);
  const selectedSizeValue = normalizeText(selectedSize);
  const hasSize = selectedSizeValue === "" || selectedSizeValue === "all" || selectedSizeValue === "الكل";

  const matchesSize = hasSize
    ? true
    : Array.isArray(group.variants) && group.variants.some((variant) => normalizeText(variant.size) === selectedSizeValue);

  return (
    (filters.gender === "all" || !selectedGender || productMatchesAudience(group, selectedGender)) &&
    (filters.type === "all" || !selectedType || normalize(group.type) === selectedType) &&
    (filters.category === "all" || !selectedCategory || normalize(group.category) === selectedCategory) &&
    (filters.brand === "all" || !selectedBrand || normalize(group.brand) === selectedBrand) &&
    (filters.manufacturer === "all" || !selectedManufacturer || normalize(group.manufacturer_name) === selectedManufacturer) &&
    matchesSize
  );
};

const isExactIdentifierMatch = (query, variant) => {
  const normalizedQuery = normalizeText(query).toLowerCase();
  if (!normalizedQuery) return false;
  return [
    variant.barcode,
    variant.sku,
    variant.article_code,
    variant.product_barcode,
    variant.product_sku,
    variant.product_code,
    variant.variant_code,
  ].some((value) => normalizeText(value).toLowerCase() === normalizedQuery);
};

const useMediaQuery = (query) => {
  const getMatches = () => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    return window.matchMedia(query).matches;
  };

  const [matches, setMatches] = useState(getMatches);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined;

    const mediaQuery = window.matchMedia(query);
    const onChange = (event) => setMatches(event.matches);

    setMatches(mediaQuery.matches);
    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", onChange);
      return () => mediaQuery.removeEventListener("change", onChange);
    }

    mediaQuery.addListener(onChange);
    return () => mediaQuery.removeListener(onChange);
  }, [query]);

  return matches;
};

function InventoryCountPage() {
  const { id: routeSessionId } = useParams();
  const navigate = useNavigate();
  const isDetail = Boolean(routeSessionId);

  const [sessions, setSessions] = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState("");
  const [sessionSearch, setSessionSearch] = useState("");
  const [sessionStatusFilter, setSessionStatusFilter] = useState("all");
  const [session, setSession] = useState(null);
  const [items, setItems] = useState([]);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [sessionError, setSessionError] = useState("");
  const [savingDraft, setSavingDraft] = useState(false);
  const [itemSavingId, setItemSavingId] = useState("");
  const [openingSession, setOpeningSession] = useState(false);
  const [approvingSession, setApprovingSession] = useState(false);
  const [cancellingSession, setCancellingSession] = useState(false);
  const [deletingSession, setDeletingSession] = useState(false);
  const [lookupQuery, setLookupQuery] = useState("");
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupResults, setLookupResults] = useState([]);
  const [selectedLookupProductId, setSelectedLookupProductId] = useState("");
  const [busyGroupKey, setBusyGroupKey] = useState("");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedFilterSize, setSelectedFilterSize] = useState("all");
  const [filters, setFilters] = useState({
    gender: "all",
    type: "all",
    category: "all",
    brand: "all",
    manufacturer: "all",
    inStockOnly: false,
  });
  const [branches, setBranches] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [scopeModalOpen, setScopeModalOpen] = useState(false);
  const [hiddenGroups, setHiddenGroups] = useState([]);
  const [newSessionForm, setNewSessionForm] = useState({
    title: "جرد جديد",
    branchId: "",
    warehouseId: "",
    notes: "",
  });

  const itemsRef = useRef(items);
  const itemSaveTimersRef = useRef(new Map());
  const itemSavePatchRef = useRef(new Map());
  const itemSavingIdRef = useRef("");
  const filtersPanelRef = useRef(null);
  const searchInputRef = useRef(null);

  const currentUser = getCurrentUser();
  const currentRole = getUserRole(currentUser);
  const canReviewInventoryCount = isAdminUser(currentUser) || ["manager", "branch manager"].includes(String(currentRole || "").toLowerCase());
  const sessionIsLockedForEditing = ["pending_review", "rejected", "completed", "cancelled"].includes(session?.status || "");
  const isCompactInventoryLayout = useMediaQuery("(max-width: 1366px)");

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    itemSavingIdRef.current = itemSavingId;
  }, [itemSavingId]);

  useEffect(
    () => () => {
      itemSaveTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      itemSaveTimersRef.current.clear();
      itemSavePatchRef.current.clear();
    },
    []
  );

  const groupedItems = useMemo(() => groupCountVariants(items), [items]);
  const visibleGroupedItems = useMemo(
    () => groupedItems.filter((group) => !hiddenGroups.includes(group.key) && matchesInventoryFilters(group, filters, selectedFilterSize)),
    [groupedItems, hiddenGroups, filters, selectedFilterSize]
  );
  const lookupSourceGroups = useMemo(() => groupLookupModels(lookupResults), [lookupResults]);
  const filteredLookupGroups = useMemo(
    () => lookupSourceGroups.filter((group) => matchesInventoryFilters(group, filters, selectedFilterSize)),
    [lookupSourceGroups, filters, selectedFilterSize]
  );
  const selectedLookupGroup = useMemo(
    () => filteredLookupGroups.find((group) => String(group.product_id || "") === String(selectedLookupProductId || "")) || filteredLookupGroups[0] || null,
    [filteredLookupGroups, selectedLookupProductId]
  );
  const smartFilterOptions = useMemo(
    () => ({
      gender: buildFilterOptions(
        groupedItems.flatMap((group) => getProductAudienceValues(group).map((audience) => ({ audience }))),
        "audience"
      ),
      productType: buildFilterOptions(groupedItems.flatMap((group) => group.variants), "variant_type"),
      grade: buildFilterOptions(groupedItems.flatMap((group) => group.variants), "variant_category"),
    }),
    [groupedItems]
  );
  const brandOptions = useMemo(
    () => buildFilterOptions(groupedItems.flatMap((group) => group.variants), "variant_brand"),
    [groupedItems]
  );
  const manufacturerOptions = useMemo(
    () => buildFilterOptions(groupedItems.flatMap((group) => group.variants), "variant_manufacturer_name"),
    [groupedItems]
  );
  const availableSizes = useMemo(
    () => buildFilterOptions(groupedItems.flatMap((group) => group.variants), "size"),
    [groupedItems]
  );
  const activeFilterCount = useMemo(
    () =>
      [
        filters.gender !== "all",
        filters.type !== "all",
        filters.category !== "all",
        filters.brand !== "all",
        filters.manufacturer !== "all",
        selectedFilterSize !== "all",
      ].filter(Boolean).length,
    [filters, selectedFilterSize]
  );
  const [expandedGroupKey, setExpandedGroupKey] = useState("");

  const loadLookups = async () => {
    try {
      const [branchesRes, warehousesRes] = await Promise.allSettled([api.get("/branches"), api.get("/warehouses")]);

      if (branchesRes.status === "fulfilled") {
        const rows = Array.isArray(branchesRes.value) ? branchesRes.value : branchesRes.value?.branches || [];
        setBranches(
          rows.map((branch) => ({
            id: branch.id,
            name: branch.name || branch.branch_name || `فرع ${branch.id}`,
            code: branch.code || "",
            is_active: branch.is_active !== false,
          }))
        );
      }

      if (warehousesRes.status === "fulfilled") {
        const rows = Array.isArray(warehousesRes.value) ? warehousesRes.value : warehousesRes.value?.warehouses || [];
        setWarehouses(rows.length ? rows.map(normalizeWarehouse) : []);
      }
    } catch (error) {
      console.warn("[inventory-count] lookup load failed", error);
    }
  };

  const loadSessions = useCallback(async () => {
    try {
      setSessionsLoading(true);
      setSessionsError("");
      const response = await listInventoryCountSessions({ limit: 40 });
      setSessions(Array.isArray(response?.sessions) ? response.sessions : []);
    } catch (error) {
      console.error("[inventory-count] load sessions", error);
      setSessions([]);
      setSessionsError(error?.message || "تعذر تحميل جلسات الجرد");
      toast.error(error?.message || "تعذر تحميل جلسات الجرد");
    } finally {
      setSessionsLoading(false);
    }
  }, []);

  const loadSession = useCallback(async () => {
    if (!routeSessionId) return;
    try {
      setSessionLoading(true);
      setSessionError("");
      const response = await getInventoryCountSession(routeSessionId);
      const nextSession = response?.session || null;
      const nextItems = normalizeInventoryCountItems(Array.isArray(response?.items) ? response.items : []);
      setSession(nextSession);
      setItems(nextItems);
      setNewSessionForm({
        title: nextSession?.title || "جرد جديد",
        branchId: nextSession?.branch_id ? String(nextSession.branch_id) : "",
        warehouseId: nextSession?.warehouse_id ? String(nextSession.warehouse_id) : "",
        notes: nextSession?.notes || "",
      });
    } catch (error) {
      console.error("[inventory-count] load session", error);
      setSession(null);
      setItems([]);
      setSessionError(error?.message || "تعذر تحميل جلسة الجرد");
      toast.error(error?.message || "تعذر تحميل جلسة الجرد");
    } finally {
      setSessionLoading(false);
    }
  }, [routeSessionId]);

  useEffect(() => {
    void loadLookups();
  }, []);

  useEffect(() => {
    if (isDetail) {
      void loadSession();
    } else {
      void loadSessions();
    }
  }, [isDetail, loadSession, loadSessions]);

  useEffect(() => {
    setHiddenGroups([]);
    setExpandedGroupKey("");
  }, [routeSessionId]);

  const mergeSavedItem = (savedItem) => {
    if (!savedItem) return;
    setItems((current) => {
      const next = current.filter(
        (row) =>
          String(row.id) !== String(savedItem.id) &&
          String(row.product_variant_id || row.variant_id) !== String(savedItem.product_variant_id || savedItem.variant_id)
      );
      return [normalizeCountVariant({ ...savedItem, ...resolveCountVariantImageData(savedItem) }), ...next];
    });
  };

  const persistVariant = async (variant, patch = {}) => {
    if (!routeSessionId || !variant) return null;
    if (sessionIsLockedForEditing) {
      toast.error("الجرد في انتظار موافقة المدير");
      return null;
    }
    const response = await upsertInventoryCountItem(routeSessionId, {
      productVariantId: variant.product_variant_id || variant.variant_id || variant.id,
      countedQuantity: patch.counted_quantity ?? patch.countedQuantity ?? variant.counted_quantity,
      systemQuantity: patch.system_quantity ?? patch.systemQuantity ?? variant.system_quantity,
      reason: patch.reason ?? variant.reason ?? "",
      notes: patch.notes ?? variant.notes ?? "",
    });
    if (response?.item) {
      mergeSavedItem(response.item);
    }
    if (response?.session) {
      setSession(response.session);
    }
    return response?.item || null;
  };

  const scheduleVariantSave = (variant, patch = {}, delayMs = 280) => {
    if (!variant || sessionIsLockedForEditing || !routeSessionId) return;
    const variantId = String(variant.product_variant_id || variant.variant_id || variant.id || "");
    if (!variantId) return;

    const queuedPatch = {
      ...(itemSavePatchRef.current.get(variantId) || {}),
      ...patch,
    };
    itemSavePatchRef.current.set(variantId, queuedPatch);

    const existingTimer = itemSaveTimersRef.current.get(variantId);
    if (existingTimer) window.clearTimeout(existingTimer);

    const timer = window.setTimeout(async () => {
      itemSaveTimersRef.current.delete(variantId);
      const currentVariant = itemsRef.current.find((row) => String(row.product_variant_id || row.variant_id || row.id || "") === variantId) || variant;
      const patchToSave = itemSavePatchRef.current.get(variantId) || queuedPatch;
      itemSavePatchRef.current.delete(variantId);
      const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
      try {
        setItemSavingId(variantId);
        const saved = await persistVariant(currentVariant, patchToSave);
        if (saved) mergeSavedItem(saved);
        logDevDuration("save item", startedAt, { variantId });
      } catch (error) {
        toast.error(error?.message || "تعذر حفظ القطعة");
      } finally {
        setItemSavingId("");
      }
    }, delayMs);

    itemSaveTimersRef.current.set(variantId, timer);
  };

  const createSessionHandler = async () => {
    try {
      const response = await createInventoryCountSession({
        title: newSessionForm.title || "جرد جديد",
        branchId: newSessionForm.branchId || null,
        warehouseId: newSessionForm.warehouseId || null,
        notes: newSessionForm.notes || "",
      });
      const createdSession = response?.session;
      if (!createdSession?.id) throw new Error("فشل إنشاء جلسة الجرد");
      setScopeModalOpen(false);
      toast.success("تم بدء جلسة الجرد");
      navigate(`/inventory/count/${createdSession.id}`);
    } catch (error) {
      console.error("[inventory-count] create session", error);
      toast.error(error?.message || "تعذر بدء جلسة الجرد");
    }
  };

  const saveDraftHandler = async () => {
    if (!routeSessionId) return;
    try {
      setSavingDraft(true);
      const response = await updateInventoryCountSession(routeSessionId, {
        title: newSessionForm.title || "جرد جديد",
        branchId: newSessionForm.branchId || null,
        warehouseId: newSessionForm.warehouseId || null,
        notes: newSessionForm.notes || "",
      });
      setSession(response?.session || session);
      toast.success("تم حفظ المسودة");
    } catch (error) {
      console.error("[inventory-count] save draft", error);
      toast.error(error?.message || "تعذر حفظ المسودة");
    } finally {
      setSavingDraft(false);
    }
  };

  const openSessionHandler = async () => {
    if (!routeSessionId) return;
    try {
      setOpeningSession(true);
      const response = await openInventoryCountSession(routeSessionId);
      setSession(response?.session || session);
      toast.success("تم فتح جلسة الجرد");
    } catch (error) {
      console.error("[inventory-count] open session", error);
      toast.error(error?.message || "تعذر فتح جلسة الجرد");
    } finally {
      setOpeningSession(false);
    }
  };

  const submitSessionHandler = async () => {
    if (!routeSessionId) return;
    try {
      setApprovingSession(true);
      const response = await submitInventoryCountSession(routeSessionId);
      setSession(response?.session || session);
      await loadSession();
      toast.success("تم إرسال الجرد للمراجعة");
    } catch (error) {
      console.error("[inventory-count] submit session", error);
      toast.error(error?.message || "تعذر إرسال الجرد للمراجعة");
    } finally {
      setApprovingSession(false);
    }
  };

  const approveSessionHandler = async () => {
    if (!routeSessionId) return;
    const confirmed = window.confirm("هل تريد اعتماد الجرد الآن؟ سيتم إنشاء حركات مخزون رسمية لكل فرق.");
    if (!confirmed) return;
    try {
      setApprovingSession(true);
      const response = await approveInventoryCountSession(routeSessionId);
      setSession(response?.session || session);
      await loadSession();
      toast.success("تم اعتماد الجرد");
    } catch (error) {
      console.error("[inventory-count] approve session", error);
      toast.error(error?.message || "تعذر اعتماد الجرد");
    } finally {
      setApprovingSession(false);
    }
  };

  const rejectSessionHandler = async () => {
    if (!routeSessionId) return;
    const rejectionReason = window.prompt("ما سبب رفض الجرد؟", session?.rejection_reason || "");
    if (rejectionReason === null) return;
    try {
      setApprovingSession(true);
      const response = await rejectInventoryCountSession(routeSessionId, { rejectionReason });
      setSession(response?.session || session);
      await loadSession();
      toast.success("تم رفض الجرد");
    } catch (error) {
      console.error("[inventory-count] reject session", error);
      toast.error(error?.message || "تعذر رفض الجرد");
    } finally {
      setApprovingSession(false);
    }
  };

  const reopenSessionHandler = async () => {
    if (!routeSessionId) return;
    try {
      setOpeningSession(true);
      const response = await reopenInventoryCountSession(routeSessionId);
      setSession(response?.session || session);
      await loadSession();
      toast.success("تمت إعادة فتح الجرد للتعديل");
    } catch (error) {
      console.error("[inventory-count] reopen session", error);
      toast.error(error?.message || "تعذر إعادة فتح الجرد");
    } finally {
      setOpeningSession(false);
    }
  };

  const cancelSessionHandler = async () => {
    if (!routeSessionId) return;
    const confirmed = window.confirm("هل تريد إلغاء جلسة الجرد؟");
    if (!confirmed) return;
    try {
      setCancellingSession(true);
      const response = await cancelInventoryCountSession(routeSessionId, { notes: newSessionForm.notes || "" });
      setSession(response?.session || session);
      await loadSession();
      toast.success("تم إلغاء الجرد");
    } catch (error) {
      console.error("[inventory-count] cancel session", error);
      toast.error(error?.message || "تعذر إلغاء الجرد");
    } finally {
      setCancellingSession(false);
    }
  };

  const deleteSessionHandler = async (targetSessionId = routeSessionId, targetSessionStatus = session?.status) => {
    if (!targetSessionId) return;
    if (String(targetSessionStatus || "") === "completed") {
      toast.error("لا يمكن حذف جلسة مكتملة");
      return;
    }
    const confirmed = window.confirm("هل تريد حذف جلسة الجرد بالكامل؟ سيتم حذف كل عناصر الجرد داخلها ولا يمكن التراجع.");
    if (!confirmed) return;
    try {
      setDeletingSession(true);
      const response = await deleteInventoryCountSession(targetSessionId);
      const deletedId = String(response?.session?.id || targetSessionId);
      setSessions((current) => current.filter((row) => String(row.id) !== deletedId));
      if (String(routeSessionId || "") === deletedId) {
        setSession(null);
        setItems([]);
        setSessionError("");
        navigate("/inventory/count");
      } else {
        await loadSessions();
      }
      toast.success("تم حذف جلسة الجرد");
    } catch (error) {
      console.error("[inventory-count] delete session", error);
      toast.error(error?.message || "تعذر حذف جلسة الجرد");
    } finally {
      setDeletingSession(false);
    }
  };

  const lookupVariants = async () => {
    if (!routeSessionId || !lookupQuery.trim()) return;
    try {
      setLookupLoading(true);
      const query = lookupQuery.trim();
      const response = await searchInventoryCountVariants(routeSessionId, { query, limit: 25 });
      const results = Array.isArray(response?.items) ? response.items : [];
      setLookupResults(results);

      const exactVariant = results.find((variant) => isExactIdentifierMatch(query, variant));
      const grouped = groupLookupModels(results);
      if (response?.resolvedProductId) {
        setSelectedLookupProductId(String(response.resolvedProductId));
      } else if (exactVariant?.product_id) {
        setSelectedLookupProductId(String(exactVariant.product_id));
      } else if (grouped.length) {
        setSelectedLookupProductId(String(grouped[0].product_id || ""));
      } else {
        setSelectedLookupProductId("");
      }

      console.log("[inventory-count] lookup resolve", {
        query,
        resolvedProductId: response?.resolvedProductId ?? null,
        resolvedVariantId: response?.resolvedVariantId ?? null,
        matchedBy: response?.matchedBy || "",
        resolutionType: response?.resolutionType || "",
      });

      if (results.length === 0) {
        toast.error("لم يتم العثور على نتائج مطابقة");
      }
    } catch (error) {
      console.error("[inventory-count] lookup variants", error);
      toast.error(error?.message || "تعذر البحث");
    } finally {
      setLookupLoading(false);
    }
  };

  const handleScannerScan = async (value) => {
    setScannerOpen(false);
    setLookupQuery(String(value || "").trim());
    if (!routeSessionId) return;
    try {
      setLookupLoading(true);
      const query = String(value || "").trim();
      const response = await searchInventoryCountVariants(routeSessionId, { query, limit: 25 });
      const results = Array.isArray(response?.items) ? response.items : [];
      setLookupResults(results);

      const scanExactVariant = results.find((variant) => isExactIdentifierMatch(query, variant));
      const resolvedProductId = response?.resolvedProductId || scanExactVariant?.product_id || null;
      const existingBeforeScan = scanExactVariant
        ? items.find((item) => String(item.product_variant_id || item.variant_id || item.id) === String(scanExactVariant.product_variant_id || scanExactVariant.variant_id || scanExactVariant.id))
        : null;

      console.log("[inventory-count] scanner resolve", {
        query,
        resolvedProductId,
        resolvedVariantId: response?.resolvedVariantId ?? scanExactVariant?.product_variant_id ?? null,
        matchedBy: response?.matchedBy || "",
        resolutionType: response?.resolutionType || "",
        existingBeforeScan: Boolean(existingBeforeScan),
      });

      if (resolvedProductId) {
        const addModelResponse = await addInventoryCountModel(routeSessionId, {
          productId: resolvedProductId,
          scanValue: query,
        });
        if (addModelResponse?.session) {
          setSession(addModelResponse.session);
        }
        if (Array.isArray(addModelResponse?.items)) {
          setItems(normalizeInventoryCountItems(addModelResponse.items));
        }
        await loadSession(routeSessionId);

        if (scanExactVariant && existingBeforeScan) {
          const nextCount = toNumber(existingBeforeScan.counted_quantity, 0) + 1;
          const saved = await persistVariant(scanExactVariant, {
            counted_quantity: nextCount,
            system_quantity: scanExactVariant.system_quantity,
            reason: existingBeforeScan?.reason || "",
            notes: existingBeforeScan?.notes || "",
          });
          await loadSession(routeSessionId);
          toast.success(`طھظ… ط¹ط¯ ظ‚ط·ط¹ط© ظ…ظ† ظ…ظ‚ط§ط³ ${saved?.variant_size || scanExactVariant.size || "ط؛ظٹط± ظ…ط­ط¯ط¯"}`);
        } else {
          toast.success("طھظ… ط¥ط¶ط§ظپط© ط§ظ„ظ…ظˆط¯ظٹظ„ ط¨ظ†ط¬ط§ط­");
        }
        setLookupQuery("");
        setLookupResults([]);
        setLookupLoading(false);
        return;
      }

      const exactVariant = results.find((variant) => isExactIdentifierMatch(query, variant));
      if (exactVariant) {
        const existing = items.find((item) => String(item.product_variant_id || item.variant_id || item.id) === String(exactVariant.product_variant_id || exactVariant.variant_id || exactVariant.id));
        const nextCount = existing ? toNumber(existing.counted_quantity, 0) + 1 : 1;
        const saved = await persistVariant(exactVariant, {
          counted_quantity: nextCount,
          system_quantity: exactVariant.system_quantity,
          reason: existing?.reason || "",
          notes: existing?.notes || "",
        });
        setLookupQuery("");
        setLookupResults([]);
        toast.success(`تم عد قطعة من مقاس ${saved?.variant_size || exactVariant.size || "غير محدد"}`);
      } else if (results.length === 0) {
        toast.error("الباركود غير موجود");
      }
    } catch (error) {
      console.error("[inventory-count] scanner lookup", error);
      toast.error(error?.message || "تعذر قراءة الباركود");
    } finally {
      setLookupLoading(false);
    }
  };

  const updateLocalItem = useCallback((itemId, updater) => {
    setItems((current) => {
      const index = current.findIndex((row) => String(row.id) === String(itemId));
      if (index === -1) return current;
      const next = current.slice();
      const row = current[index];
      next[index] = {
        ...row,
        ...updater(row),
      };
      return next;
    });
  }, []);

  const handleCountedChange = useCallback((itemId, value) => {
    if (sessionIsLockedForEditing) return;
    const parsed = Number(value || 0);
    updateLocalItem(itemId, (row) => ({
      counted_quantity: parsed,
      difference_quantity: parsed - toNumber(row.system_quantity, 0),
      actual_qty: parsed,
      difference_qty: parsed - toNumber(row.system_quantity, 0),
    }));
  }, [sessionIsLockedForEditing, updateLocalItem]);

  const handlePersistCounted = async (itemId, patch = {}) => {
    if (!routeSessionId) return;
    const target = items.find((row) => String(row.id) === String(itemId));
    if (!target) return;
    try {
      const saved = await persistVariant(target, {
        counted_quantity: patch.counted_quantity ?? patch.countedQuantity ?? target.counted_quantity,
        system_quantity: patch.system_quantity ?? patch.systemQuantity ?? target.system_quantity,
        reason: patch.reason ?? target.reason ?? "",
        notes: patch.notes ?? target.notes ?? "",
      });
      if (saved) {
        mergeSavedItem(saved);
      }
    } catch (error) {
      console.error("[inventory-count] persist item", error);
      toast.error(error?.message || "تعذر حفظ الصنف");
    }
  };

  const handlePersistReason = async (itemId, patch = {}) => {
    await handlePersistCounted(itemId, patch);
  };

  const handlePersistNotes = async (itemId, patch = {}) => {
    await handlePersistCounted(itemId, patch);
  };

  const addColorGroupToCount = async (group) => {
    if (!routeSessionId) return;
    try {
      setBusyGroupKey(group.key);
      const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
      await Promise.all(group.variants.map(async (variant) => {
        const existing = items.find((item) => String(item.product_variant_id || item.variant_id || item.id) === String(variant.product_variant_id || variant.variant_id || variant.id));
        await persistVariant(variant, {
          counted_quantity: existing ? toNumber(existing.counted_quantity, 0) : 0,
          system_quantity: variant.system_quantity,
          reason: existing?.reason || "",
          notes: existing?.notes || "",
        });
      }));
      await loadSession();
      logDevDuration("add color group", startedAt, { groupKey: group.key });
      toast.success("تمت إضافة اللون للجرد");
    } catch (error) {
      console.error("[inventory-count] add color group", error);
      toast.error(error?.message || "تعذر إضافة اللون للجرد");
    } finally {
      setBusyGroupKey("");
    }
  };

  const addFullModelToCount = async (group) => {
    if (!routeSessionId || !group?.product_id) return;
    try {
      setBusyGroupKey(group.key);
      const payload = { productId: group.product_id };
      const response = await addInventoryCountModel(routeSessionId, payload);
      if (response?.session) {
        setSession(response.session);
      }
      if (Array.isArray(response?.items)) {
        setItems(normalizeInventoryCountItems(response.items));
      }
      await loadSession();
      setSelectedLookupProductId(String(group.product_id));
      setLookupQuery("");
      setLookupResults([]);
      setSelectedLookupProductId("");
      toast.success("تمت إضافة الموديل للجرد");
    } catch (error) {
      console.error("[inventory-count] add model", error);
      toast.error(error?.message || "تعذر إضافة الموديل للجرد");
    } finally {
      setBusyGroupKey("");
    }
  };

  const setGroupCount = async (group, value, toastLabel) => {
    if (!routeSessionId) return;
    try {
      setBusyGroupKey(group.key);
      const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
      await Promise.all(group.variants.map(async (variant) => {
        await persistVariant(variant, {
          counted_quantity: value === null || value === undefined ? variant.system_quantity : value,
          system_quantity: variant.system_quantity,
          reason: variant.reason || "",
          notes: variant.notes || "",
        });
      }));
      await loadSession();
      logDevDuration("set group count", startedAt, { groupKey: group.key, value });
      if (toastLabel) toast.success(toastLabel);
    } catch (error) {
      console.error("[inventory-count] group update", error);
      toast.error(error?.message || "تعذر تحديث اللون");
    } finally {
      setBusyGroupKey("");
    }
  };

  const matchGroupToSystem = async (group) => {
    await setGroupCount(group, undefined, "تمت مطابقة السيستم");
  };

  const zeroGroup = async (group) => {
    await setGroupCount(group, 0, "تم تصفير اللون");
  };

  const removeGroupFromView = async (group) => {
    const confirmed = window.confirm("هل تريد حذف هذا اللون من الجرد؟ سيتم تركه مطابقًا للسيستم بدون فرق.");
    if (!confirmed) return;
    try {
      setBusyGroupKey(group.key);
      const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
      await Promise.all(group.variants.map(async (variant) => {
        await persistVariant(variant, {
          counted_quantity: variant.system_quantity,
          system_quantity: variant.system_quantity,
          reason: variant.reason || "",
          notes: variant.notes || "",
        });
      }));
      setHiddenGroups((current) => (current.includes(group.key) ? current : [...current, group.key]));
      await loadSession();
      logDevDuration("remove group", startedAt, { groupKey: group.key });
      toast.success("تم حذف اللون من العرض");
    } catch (error) {
      console.error("[inventory-count] remove group", error);
      toast.error(error?.message || "تعذر حذف اللون");
    } finally {
      setBusyGroupKey("");
    }
  };

  const updateFilter = useCallback((key, value) => {
    setFilters((current) => ({ ...current, [key]: value }));
  }, []);

  const resetFilters = useCallback(() => {
    setFilters({
      gender: "all",
      type: "all",
      category: "all",
      brand: "all",
      manufacturer: "all",
      inStockOnly: false,
    });
    setSelectedFilterSize("all");
  }, []);

  const sessionSummary = useMemo(
    () =>
      sessions.reduce(
        (acc, row) => {
          acc.total += 1;
          const status = String(row.status || "draft");
          if (status === "draft") acc.draft += 1;
          if (status === "in_progress") acc.inProgress += 1;
          if (status === "pending_review") acc.pendingReview += 1;
          if (status === "completed") acc.completed += 1;
          if (status === "cancelled") acc.cancelled += 1;
          if (status === "rejected") acc.rejected += 1;
          return acc;
        },
        { total: 0, draft: 0, inProgress: 0, pendingReview: 0, completed: 0, cancelled: 0, rejected: 0 }
      ),
    [sessions]
  );

  const filteredSessions = useMemo(() => {
    const query = sessionSearch.trim().toLowerCase();
    return sessions.filter((row) => {
      const status = String(row.status || "draft");
      const matchesStatus = sessionStatusFilter === "all" || status === sessionStatusFilter;
      if (!matchesStatus) return false;
      if (!query) return true;
      return `${row.title || ""} ${row.branch_name || ""} ${row.warehouse_name || ""} ${row.status || ""} ${row.notes || ""} ${row.id || ""}`
        .toLowerCase()
        .includes(query);
    });
  }, [sessionSearch, sessionStatusFilter, sessions]);

  const itemSummary = useMemo(() => {
    const visibleItems = visibleGroupedItems.flatMap((group) => group.variants);
    const positive = visibleItems.filter((item) => toNumber(item.difference_quantity, 0) > 0).length;
    const negative = visibleItems.filter((item) => toNumber(item.difference_quantity, 0) < 0).length;
    const absoluteDiff = visibleItems.reduce((sum, item) => sum + Math.abs(toNumber(item.difference_quantity, 0)), 0);
    const countedQuantity = visibleItems.reduce((sum, item) => sum + toNumber(item.counted_quantity, 0), 0);
    const systemQuantity = visibleItems.reduce((sum, item) => sum + toNumber(item.system_quantity, 0), 0);
    return {
      total: visibleItems.length,
      positive,
      negative,
      absoluteDiff,
      groups: visibleGroupedItems.length,
      countedQuantity,
      systemQuantity,
      varianceQuantity: countedQuantity - systemQuantity,
    };
  }, [visibleGroupedItems]);
  const countProgressPercent = Math.min(
    100,
    Math.round(((itemSummary.countedQuantity || 0) / Math.max(itemSummary.systemQuantity || itemSummary.countedQuantity || 1, 1)) * 100)
  );

  const selectedBranchName = branches.find((branch) => String(branch.id) === String(newSessionForm.branchId))?.name || "";
  const selectedWarehouseName = warehouses.find((warehouse) => String(warehouse.id) === String(newSessionForm.warehouseId))?.name || "";

  return (
    <>
      <InventoryShell
        title="الجرد"
        subtitle="إدارة جلسات الجرد، والبحث بالباركود أو رمز الصنف، واعتماد الفروقات عبر حركات مخزون رسمية فقط."
        actions={
          <div className="flex flex-wrap gap-2">
            {isDetail ? (
              <Link to="/inventory/count" className="inline-flex items-center gap-2 rounded-[var(--radius-card)] border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10">
                <ArrowLeft className="h-4 w-4" />
                العودة إلى القائمة
              </Link>
            ) : null}
            <button
              type="button"
              onClick={() => setScopeModalOpen(true)}
              className="inline-flex items-center gap-2 rounded-[var(--radius-control)] bg-primary px-4 py-2 text-sm font-black text-black transition hover:bg-primary"
            >
              <Plus className="h-4 w-4" />
              بدء جرد جديد
            </button>
          </div>
        }
        tabs={[
          { to: "/inventory", label: "المخزون", end: true },
          { to: "/inventory/count", label: "الجرد", end: true },
          { to: "/inventory/movements", label: "الحركات" },
          { to: "/inventory/adjustments", label: "التسويات" },
          { to: "/stock-transfers", label: "التحويلات" },
          { to: "/warehouses", label: "المخازن" },
        ]}
      >
        {isDetail ? (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_360px]">
            <div className="space-y-4">
              {sessionError ? <div className="rounded-3xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-100">{sessionError}</div> : null}

              <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-4 shadow-2xl shadow-black/10">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge value={SESSION_STATUS_LABELS[session?.status || "draft"] || session?.status || "مسودة"} />
                      <span className={`rounded-full border px-3 py-1 text-xs font-black ${statusTone[session?.status || "draft"] || statusTone.draft}`}>
                        {SESSION_STATUS_LABELS[session?.status || "draft"] || "مسودة"}
                      </span>
                    </div>
                    <h1 className="m1-page-title mt-3 text-white">{newSessionForm.title || "جرد جديد"}</h1>
                    <div className="mt-2 flex flex-wrap gap-3 text-sm text-zinc-400">
                      <span>الفرع: {session?.branch_name || selectedBranchName || "غير محدد"}</span>
                      <span>المخزن: {session?.warehouse_name || selectedWarehouseName || "غير محدد"}</span>
                      <span>آخر تحديث: {formatDateTime(session?.updated_at || session?.created_at)}</span>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={saveDraftHandler}
                      disabled={savingDraft || sessionIsLockedForEditing}
                      className="inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10 disabled:opacity-40"
                    >
                      {savingDraft ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      حفظ كمسودة
                    </button>
                    <button
                      type="button"
                      onClick={openSessionHandler}
                      disabled={openingSession || sessionIsLockedForEditing}
                      className="inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-amber-400/20 bg-amber-500/10 px-4 py-2 text-sm font-semibold text-amber-100 transition hover:bg-amber-500/15 disabled:opacity-40"
                    >
                      {openingSession ? <Loader2 className="h-4 w-4 animate-spin" /> : <SquareArrowOutUpRight className="h-4 w-4" />}
                      فتح الجرد
                    </button>
                    <button
                      type="button"
                      onClick={session?.status === "pending_review" && canReviewInventoryCount ? approveSessionHandler : submitSessionHandler}
                      disabled={
                        approvingSession ||
                        session?.status === "completed" ||
                        session?.status === "cancelled" ||
                        session?.status === "rejected" ||
                        (session?.status === "pending_review" && !canReviewInventoryCount)
                      }
                      className="inline-flex items-center gap-2 rounded-[var(--radius-control)] bg-primary px-4 py-2 text-sm font-black text-black transition hover:bg-primary disabled:opacity-40"
                    >
                      {approvingSession ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                      اعتماد الجرد
                    </button>
                    {session?.status === "pending_review" && canReviewInventoryCount ? (
                      <button
                        type="button"
                        onClick={rejectSessionHandler}
                        disabled={approvingSession}
                        className="inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-rose-400/20 bg-rose-500/10 px-4 py-2 text-sm font-semibold text-rose-100 transition hover:bg-rose-500/15 disabled:opacity-40"
                      >
                        رفض وإرجاع للتعديل
                      </button>
                    ) : null}
                    {session?.status === "rejected" && canReviewInventoryCount ? (
                      <button
                        type="button"
                        onClick={reopenSessionHandler}
                        disabled={openingSession}
                        className="inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-primary/20 bg-primary/10 px-4 py-2 text-sm font-semibold text-primary transition hover:bg-primary/15 disabled:opacity-40"
                      >
                        {openingSession ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                        إعادة فتح للتعديل
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={cancelSessionHandler}
                      disabled={cancellingSession || sessionIsLockedForEditing}
                      className="inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-rose-400/20 bg-rose-500/10 px-4 py-2 text-sm font-semibold text-rose-100 transition hover:bg-rose-500/15 disabled:opacity-40"
                    >
                      {cancellingSession ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                      إلغاء
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteSessionHandler(routeSessionId, session?.status)}
                      disabled={deletingSession || session?.status === "completed"}
                      className="inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-rose-500/30 bg-rose-500/15 px-4 py-2 text-sm font-black text-rose-100 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {deletingSession ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                      حذف الجلسة
                    </button>
                  </div>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-4">
                <MetricCard label="إجمالي السطور" value={itemSummary.total} tone="blue" />
                <MetricCard label="فروقات موجبة" value={itemSummary.positive} tone="emerald" />
                <MetricCard label="فروقات سالبة" value={itemSummary.negative} tone="rose" />
                <MetricCard label="إجمالي الفروق" value={itemSummary.absoluteDiff} tone="amber" />
              </div>

              <section className="mt-3 rounded-[1.5rem] border border-white/10 bg-white/[0.03] p-3 shadow-[0_20px_50px_rgba(0,0,0,0.2)] backdrop-blur">
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="m1-section-title text-white">البحث ومسح الباركود</h2>
                    <div className="mt-2 inline-flex max-w-full rounded-2xl border border-primary/15 bg-primary/10 px-3 py-2 text-[11px] font-bold leading-5 text-primary">
                      Inventory counts are submitted for review before final approval.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setScannerOpen(true)}
                    className="hidden h-[var(--control-height-lg)] w-11 shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-white/10 bg-white/[0.04] text-zinc-200 transition hover:border-emerald-300/30 hover:bg-emerald-400/10 disabled:cursor-not-allowed disabled:opacity-50 sm:inline-flex"
                    aria-label="فتح ماسح الكاميرا"
                    title="فتح ماسح الكاميرا"
                  >
                    <Camera className="h-4 w-4" />
                  </button>
                </div>

                <div className="mt-3 grid gap-2">
                  <button
                    type="button"
                    onClick={() => setScannerOpen(true)}
                    className="inline-flex min-h-[var(--control-height-lg)] w-full items-center justify-center gap-2 rounded-[var(--radius-control)] bg-primary px-4 py-3 text-sm font-black text-black shadow-[0_10px_28px_rgba(16,185,129,0.22)] transition hover:bg-primary"
                  >
                    <Camera className="h-4 w-4" />
                    امسح الباركود
                  </button>
                  <div className="hidden items-center gap-2 text-[10px] font-black uppercase tracking-[0.22em] text-zinc-500 sm:flex">
                    <span className="h-px w-10 bg-white/10" />
                    OR
                    <span className="h-px w-10 bg-white/10" />
                  </div>
                </div>

                <div className="mt-4 flex min-w-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setFiltersOpen(true)}
                    aria-expanded={filtersOpen}
                    className={`inline-flex h-[var(--control-height-lg)] w-11 shrink-0 items-center justify-center rounded-[var(--radius-control)] border transition ${ filtersOpen || activeFilterCount > 0 ? "border-emerald-400/40 bg-emerald-400/15 text-emerald-100 shadow-[0_0_18px_rgba(16,185,129,0.14)]" : "border-white/10 bg-white/[0.04] text-zinc-200 hover:border-emerald-300/30 hover:bg-emerald-400/10" }`}
                    aria-label="الفلتر"
                    title="الفلتر"
                  >
                    <span className="relative inline-flex">
                      <Filter className="h-4 w-4" />
                      {activeFilterCount > 0 ? (
                        <span className="absolute -right-2 -top-2 inline-flex min-h-4 min-w-4 items-center justify-center rounded-full bg-emerald-400 px-1 text-[10px] font-black text-zinc-950">
                          {activeFilterCount > 99 ? "99+" : activeFilterCount}
                        </span>
                      ) : null}
                    </span>
                    <span className="sr-only">الفلتر</span>
                  </button>

                  <label className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-2xl border border-white/10 bg-black/30 px-3">
                    <Search className="h-4 w-4 shrink-0 text-zinc-500" />
                    <input
                      ref={searchInputRef}
                      value={lookupQuery}
                      onChange={(event) => setLookupQuery(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          void lookupVariants();
                        }
                      }}
                      placeholder="ابحث بالاسم أو الموديل أو الباركود أو الكود"
                      className="w-full bg-transparent text-sm font-semibold text-white outline-none placeholder:text-zinc-500"
                    />
                  </label>

                  <button
                    type="button"
                    onClick={() => {
                      setScannerOpen(true);
                    }}
                    className="hidden h-[var(--control-height-lg)] w-11 shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-white/10 bg-white/[0.04] text-zinc-200 transition hover:border-emerald-300/30 hover:bg-emerald-400/10 disabled:cursor-not-allowed disabled:opacity-50 sm:inline-flex"
                    aria-label="فتح ماسح الكاميرا"
                    title="فتح ماسح الكاميرا"
                  >
                    <Camera className="h-4 w-4" />
                  </button>
                </div>

                <div className="mt-3 grid gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setLookupQuery("");
                      setSelectedLookupProductId("");
                      searchInputRef.current?.focus?.();
                    }}
                    className="inline-flex min-h-[var(--control-height-lg)] items-center gap-2 self-start rounded-[var(--radius-control)] border border-white/10 bg-white/[0.04] px-4 text-xs font-black text-white transition hover:bg-white/[0.08]"
                  >
                    + إضافة منتج يدوياً
                  </button>

                  <div className="grid gap-3 rounded-2xl border border-white/10 bg-black/20 p-3 sm:grid-cols-3">
                    <div>
                      <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">Products Counted</div>
                      <div className="mt-1 text-lg font-black text-white">{itemSummary.groups}</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">Total Quantity Counted</div>
                      <div className="mt-1 text-lg font-black text-white">{itemSummary.countedQuantity}</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">Variance Count</div>
                      <div className={`mt-1 text-lg font-black ${itemSummary.varianceQuantity > 0 ? "text-rose-200" : itemSummary.varianceQuantity < 0 ? "text-amber-200" : "text-emerald-200"}`}>
                        {itemSummary.varianceQuantity > 0 ? `+${itemSummary.varianceQuantity}` : itemSummary.varianceQuantity < 0 ? itemSummary.varianceQuantity : "0"}
                      </div>
                    </div>
                  </div>

                  {session?.status === "in_progress" ? (
                    <div className="rounded-2xl border border-emerald-400/20 bg-emerald-500/10 px-3 py-3 text-sm font-bold text-emerald-50">
                      <div className="flex items-center justify-between gap-3">
                        <span>{itemSummary.countedQuantity} units counted</span>
                        <span className="text-emerald-100/80">{countProgressPercent}%</span>
                      </div>
                      <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
                        <div className="h-full rounded-full bg-emerald-400 transition-all duration-300" style={{ width: `${countProgressPercent}%` }} />
                      </div>
                    </div>
                  ) : null}
                </div>

                <InventoryCountFiltersModal
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

                {selectedLookupGroup ? (
                  <div className="mt-3 flex flex-col gap-3 rounded-3xl border border-emerald-400/20 bg-emerald-500/10 p-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="min-w-0">
                      <div className="text-[10px] font-black uppercase tracking-[0.18em] text-emerald-200">الموديل المحدد</div>
                      <div className="mt-1 truncate text-sm font-bold text-white">{selectedLookupGroup.product_name || "منتج"}</div>
                      <div className="mt-1 text-xs text-emerald-100/80">
                        {selectedLookupGroup.colors?.length || 0} ألوان · {selectedLookupGroup.variants.length} مقاسات
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => addFullModelToCount(selectedLookupGroup)}
                      disabled={busyGroupKey === selectedLookupGroup.key}
                      className="inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] bg-primary px-4 py-3 text-sm font-black text-black transition hover:bg-primary disabled:opacity-40"
                    >
                      {busyGroupKey === selectedLookupGroup.key ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                      إضافة الموديل للجرد
                    </button>
                  </div>
                ) : null}

                <div className="mt-4 space-y-3">
                  {filteredLookupGroups.length === 0 && lookupQuery.trim() && !lookupLoading ? (
                    <div className="rounded-[var(--radius-card)] border border-dashed border-white/10 bg-white/5 p-8 text-center text-zinc-400">
                      لا توجد نتائج مجمعة لهذا البحث.
                    </div>
                  ) : null}

                  {filteredLookupGroups.map((group) => (
                    <MemoLookupGroupCard
                      key={group.key}
                      group={group}
                      busy={busyGroupKey === group.key}
                      selected={String(selectedLookupGroup?.product_id || "") === String(group.product_id || "")}
                      onAddModel={() => addFullModelToCount(group)}
                    />
                  ))}
                </div>

                <div className="mt-5 space-y-3">
                  {sessionLoading ? (
                    <div className="rounded-[var(--radius-card)] border border-dashed border-white/10 bg-white/5 p-10 text-center text-zinc-400">
                      <Loader2 className="mx-auto h-10 w-10 animate-spin text-emerald-400" />
                      <p className="mt-3">جاري تحميل جلسة الجرد...</p>
                    </div>
                  ) : visibleGroupedItems.length === 0 ? (
                    <div className="rounded-[var(--radius-card)] border border-dashed border-white/10 bg-white/5 p-10 text-center text-zinc-400">
                      <ClipboardList className="mx-auto h-12 w-12 text-zinc-500" />
                      <h3 className="m1-section-title mt-4 text-white">لا توجد أصناف بعد</h3>
                      <p className="mt-2 text-sm text-zinc-400">ابدأ بالمسح أو البحث ثم أضف اللون إلى الجرد.</p>
                    </div>
                  ) : (
                    visibleGroupedItems.map((group) => (
                      <MemoGroupedCountCard
                        key={group.key}
                        group={group}
                        compact={isCompactInventoryLayout}
                        disabled={sessionIsLockedForEditing}
                        busy={busyGroupKey === group.key}
                        onAddColor={() => addColorGroupToCount(group)}
                        onMatchSystem={() => matchGroupToSystem(group)}
                        onZero={() => zeroGroup(group)}
                        onRemove={() => removeGroupFromView(group)}
                        onCountChange={handleCountedChange}
                        onCountCommit={handlePersistCounted}
                        onReasonCommit={handlePersistReason}
                        onNotesCommit={handlePersistNotes}
                        expanded={expandedGroupKey === group.key}
                        onToggleExpanded={() => setExpandedGroupKey((current) => (current === group.key ? "" : group.key))}
                      />
                    ))
                  )}
                </div>
              </section>
            </div>

            <div className="space-y-4">
              <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-4 shadow-2xl shadow-black/10">
                <h3 className="m1-section-title text-white">بيانات الجلسة</h3>
                <div className="mt-3 grid gap-2">
                  <Field label="اسم الجلسة" value={newSessionForm.title} onChange={(value) => setNewSessionForm((current) => ({ ...current, title: value }))} />
                  <SelectField
                    label="الفرع"
                    value={newSessionForm.branchId}
                    onChange={(value) => setNewSessionForm((current) => ({ ...current, branchId: value }))}
                    options={[{ value: "", label: "بدون فرع" }, ...branches.map((branch) => ({ value: String(branch.id), label: branch.name }))]}
                    compactAction
                    badge={itemSummary.groups || 0}
                  />
                  <SelectField
                    label="المخزن"
                    value={newSessionForm.warehouseId}
                    onChange={(value) => setNewSessionForm((current) => ({ ...current, warehouseId: value }))}
                    options={[{ value: "", label: "بدون مخزن" }, ...warehouses.map((warehouse) => ({ value: String(warehouse.id), label: warehouse.name }))]}
                  />
                  <label className="block">
                    <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-zinc-500">ملاحظات الجلسة</div>
                    <textarea
                      value={newSessionForm.notes}
                      onChange={(event) => setNewSessionForm((current) => ({ ...current, notes: event.target.value }))}
                    rows={4}
                    placeholder="ملاحظات عامة حول الجرد أو منطقة العمل"
                    className="w-full rounded-[var(--radius-control)] border border-white/10 bg-white/5 p-3 text-sm text-white outline-none placeholder:text-zinc-500"
                  />
                </label>
              </div>
                <div className="mt-3 rounded-[var(--radius-card)] border border-white/10 bg-white/5 p-3 text-sm text-zinc-300">
                  <div className="flex items-center justify-between gap-3">
                    <span>عدد المجموعات</span>
                    <span className="font-black text-white">{itemSummary.groups}</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <span>إجمالي الفروق</span>
                    <span className="font-black text-white">{itemSummary.absoluteDiff}</span>
                  </div>
                </div>
              </div>

              <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-4 shadow-2xl shadow-black/10">
                <h3 className="m1-section-title text-white">إرشادات</h3>
                <ul className="mt-3 space-y-2 text-sm leading-6 text-zinc-300">
                  <li>• استخدم الماسح أو البحث السريع لإضافة قطعة مباشرة عند التطابق الدقيق.</li>
                  <li>• البحث باسم المنتج يعرض كروت مجمعة حسب المنتج واللون فقط.</li>
                  <li>• زر إضافة اللون للجرد يضيف كل المقاسات مرة واحدة بقيم فعلية صفرية.</li>
                  <li>• مطابقة السيستم وتصفير اللون يعملان على كل المقاسات داخل اللون.</li>
                  <li>• حذف اللون يتركه مطابقًا للسيستم حتى لا ينتج عنه فرق عند الاعتماد.</li>
                </ul>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {sessionsError ? <div className="rounded-3xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-100">{sessionsError}</div> : null}

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <MetricCard label="إجمالي الجلسات" value={sessionSummary.total} tone="blue" />
              <MetricCard label="مسودات" value={sessionSummary.draft} tone="amber" />
              <MetricCard label="قيد الجرد" value={sessionSummary.inProgress} tone="emerald" />
              <MetricCard label="مكتملة" value={sessionSummary.completed} tone="rose" />
            </div>

            <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h2 className="m1-section-title text-white">جلسات الجرد</h2>
                  <p className="mt-1 text-sm text-zinc-400">راجع الجلسات الحالية وافتح أي جلسة لمتابعة الأصناف أو اعتماد الفروقات.</p>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {[
                    { key: "all", label: "الكل" },
                    { key: "draft", label: "مسودة" },
                    { key: "in_progress", label: "قيد الجرد" },
                    { key: "pending_review", label: "قيد المراجعة" },
                    { key: "completed", label: "مكتملة" },
                    { key: "rejected", label: "مرفوضة" },
                  ].map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => setSessionStatusFilter(item.key)}
                      className={`rounded-full border px-3 py-1 text-xs font-bold transition ${ sessionStatusFilter === item.key ? "border-emerald-400/30 bg-emerald-500/15 text-emerald-100" : "border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10" }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => setScopeModalOpen(true)}
                  className="inline-flex items-center gap-2 rounded-[var(--radius-control)] bg-primary px-4 py-2 text-sm font-black text-black transition hover:bg-primary"
                >
                  <Plus className="h-4 w-4" />
                  بدء جرد جديد
                </button>
              </div>

              <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_160px_160px]">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                  <input
                    value={sessionSearch}
                    onChange={(event) => setSessionSearch(event.target.value)}
                    placeholder="ابحث في الجلسات..."
                    className="w-full rounded-[var(--radius-control)] border border-white/10 bg-white/5 py-3 pl-11 pr-4 text-sm text-white outline-none placeholder:text-zinc-500"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => void loadSessions()}
                  className="inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
                >
                  <RotateCcw className="h-4 w-4" />
                  تحديث
                </button>
                <Link to="/inventory" className="inline-flex items-center justify-center gap-2 rounded-[var(--radius-card)] border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10">
                  <Warehouse className="h-4 w-4" />
                  المخزون
                </Link>
              </div>

              <div className="mt-5 space-y-3">
                {sessionsLoading ? (
                  <div className="rounded-[var(--radius-card)] border border-dashed border-white/10 bg-white/5 p-10 text-center text-zinc-400">
                    <Loader2 className="mx-auto h-10 w-10 animate-spin text-emerald-400" />
                    <p className="mt-3">جاري تحميل جلسات الجرد...</p>
                  </div>
                ) : filteredSessions.length === 0 ? (
                  <div className="rounded-[var(--radius-card)] border border-dashed border-white/10 bg-white/5 p-10 text-center text-zinc-400">
                    <ClipboardList className="mx-auto h-12 w-12 text-zinc-500" />
                    <h3 className="m1-section-title mt-4 text-white">لا توجد جلسات جرد بعد</h3>
                    <p className="mt-2 text-sm text-zinc-400">ابدأ جردًا جديدًا ثم افتحه للمسح أو الاعتماد.</p>
                  </div>
                ) : (
                  filteredSessions.map((row) => (
                    <div
                      key={String(row.id)}
                      onClick={() => navigate(`/inventory/count/${row.id}`)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          navigate(`/inventory/count/${row.id}`);
                        }
                      }}
                      className="w-full rounded-[var(--radius-card)] border border-white/10 bg-white/5 p-4 text-start transition hover:bg-white/10"
                    >
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <StatusBadge value={SESSION_STATUS_LABELS[row.status || "draft"] || row.status || "مسودة"} />
                            <span className="text-xs text-zinc-500">#{row.id}</span>
                          </div>
                          <div className="mt-2 text-lg font-bold text-white">{row.title || "جرد جديد"}</div>
                          <div className="mt-2 flex flex-wrap gap-3 text-sm text-zinc-400">
                            <span>الفرع: {row.branch_name || "غير محدد"}</span>
                            <span>المخزن: {row.warehouse_name || "غير محدد"}</span>
                            <span>عدد الأصناف: {row.item_count || 0}</span>
                            <span>إجمالي الفرق: {row.difference_total || 0}</span>
                            <span>آخر تحديث: {formatDateTime(row.updated_at || row.created_at)}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`rounded-full border px-3 py-1 text-xs font-black ${statusTone[row.status || "draft"] || statusTone.draft}`}>
                            {SESSION_STATUS_LABELS[row.status || "draft"] || row.status || "مسودة"}
                          </span>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              navigate(`/inventory/count/${row.id}`);
                            }}
                            className="inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-white/10 bg-black/20 px-3 py-2 text-xs font-semibold text-white transition hover:bg-black/30"
                          >
                            <SquareArrowOutUpRight className="h-4 w-4" />
                            فتح
                          </button>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              void deleteSessionHandler(row.id, row.status);
                            }}
                            disabled={deletingSession || String(row.status || "") === "completed"}
                            className="inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-rose-400/25 bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-100 transition hover:bg-rose-500/15 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            {deletingSession ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                            حذف
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </InventoryShell>

      {scopeModalOpen ? (
        <ScopeModal
          branches={branches}
          warehouses={warehouses}
          form={newSessionForm}
          setForm={setNewSessionForm}
          onClose={() => setScopeModalOpen(false)}
          onCreate={createSessionHandler}
          selectedBranchName={selectedBranchName}
          selectedWarehouseName={selectedWarehouseName}
        />
      ) : null}

      {scannerOpen ? (
        <ScannerModal
          onClose={() => setScannerOpen(false)}
          onScan={handleScannerScan}
          onUnsupported={(message) => toast.error(message || "الماسح غير مدعوم على هذا الجهاز")}
          onPermissionDenied={(message) => toast.error(message || "تم رفض إذن الكاميرا")}
          onError={(message) => toast.error(message || "تعذر تشغيل الماسح")}
        />
      ) : null}
    </>
  );
}

function MetricCard({ label, value, tone = "blue" }) {
  const classes = {
    blue: "border-blue-500/20 bg-blue-500/10 text-blue-100",
    amber: "border-amber-500/20 bg-amber-500/10 text-amber-100",
    emerald: "border-emerald-500/20 bg-emerald-500/10 text-emerald-100",
    rose: "border-rose-500/20 bg-rose-500/10 text-rose-100",
  };

  return (
    <div className={`rounded-3xl border p-4 shadow-xl ${classes[tone]}`}>
      <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">{label}</div>
      <div className="mt-2 text-2xl font-black text-white">{value}</div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder = "" }) {
  return (
    <label className="block">
      <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-zinc-500">{label}</div>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full rounded-[var(--radius-control)] border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none placeholder:text-zinc-500"
      />
    </label>
  );
}

function SelectField({ label, value, onChange, options = [], badge = null, compactAction = false }) {
  return (
    <label className="block">
      <div className="mb-2 flex items-center justify-between gap-2 text-[10px] uppercase tracking-[0.18em] text-zinc-500">
        <span>{label}</span>
        {badge !== null ? <span className="inline-flex min-h-5 items-center justify-center rounded-full bg-white/10 px-2 text-[10px] font-black text-white">{badge}</span> : null}
      </div>
      <div className="relative">
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={`w-full appearance-none rounded-[var(--radius-control)] border bg-white/5 py-3 text-sm text-white outline-none ${compactAction ? "cursor-pointer border-emerald-400/25 px-4 pr-12 font-black shadow-sm" : "border-white/10 px-4"}`}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value} className="bg-zinc-950 text-white">
              {option.label}
            </option>
          ))}
        </select>
        <ChevronLeft className={`pointer-events-none absolute end-4 top-1/2 h-4 w-4 -translate-y-1/2 ${compactAction ? "text-emerald-200" : "text-zinc-500"}`} />
      </div>
    </label>
  );
}

function LookupGroupCard({ group, busy, selected, onAddModel }) {
  const resolvedImage = resolveInventoryImage(group);
  return (
    <div className={`rounded-[var(--radius-card)] border p-4 ${selected ? "border-emerald-400/40 bg-emerald-500/10" : "border-white/10 bg-white/5"}`}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 gap-3">
          <div className="h-16 w-16 shrink-0 overflow-hidden rounded-2xl border border-white/10 bg-zinc-900">
            {resolvedImage ? (
              <img src={resolvedImage} alt={group.product_name || "منتج"} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-zinc-800 to-zinc-950 text-zinc-500">
                <ClipboardList className="h-6 w-6" />
              </div>
            )}
          </div>
          <div className="min-w-0">
            <div className="text-lg font-bold text-white">{group.product_name || "منتج"}</div>
            <div className="mt-1 text-sm text-zinc-400">{group.colors?.length ? `${group.colors.length} ألوان` : "لون غير محدد"}</div>
            <div className="mt-1 text-xs text-zinc-500">عدد المقاسات: {group.variants.length} · السيستم: {group.system_total}</div>
          </div>
        </div>

        <button type="button" onClick={onAddModel} disabled={busy} className="inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] border border-emerald-400/20 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-100 transition hover:bg-emerald-500/15 disabled:opacity-40">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          إضافة الموديل للجرد
        </button>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        {group.variants.map((variant) => (
          <div key={String(variant.product_variant_id || variant.id)} className="rounded-2xl border border-white/10 bg-zinc-950/70 p-3">
            <div className="text-sm font-black text-white">{variant.size || "غير محدد"}</div>
            <div className="mt-1 text-xs text-zinc-400">السيستم: {variant.system_quantity}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function GroupedCountCard({
  group,
  compact,
  disabled,
  busy,
  onAddColor,
  onMatchSystem,
  onZero,
  onRemove,
  onCountChange,
  onCountCommit,
  onReasonCommit,
  onNotesCommit,
  expanded,
  onToggleExpanded,
}) {
  if (compact) {
    return (
      <MemoMobileGroupedCountCard
        group={group}
        disabled={disabled}
        busy={busy}
        onAddColor={onAddColor}
        onMatchSystem={onMatchSystem}
        onZero={onZero}
        onRemove={onRemove}
        onCountChange={onCountChange}
        onCountCommit={onCountCommit}
        onReasonCommit={onReasonCommit}
        onNotesCommit={onNotesCommit}
        expanded={expanded}
        onToggleExpanded={onToggleExpanded}
      />
    );
  }

  return (
    <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-4 shadow-2xl shadow-black/10">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="text-lg font-black text-white">{group.product_name || "منتج"} - {group.color || "لون"}</div>
          <div className="mt-1 text-sm text-zinc-400">{group.variants.length} مقاس · السيستم: {group.system_total} · الفعلي: {group.counted_total} · الفرق: {group.difference_total}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={onAddColor} disabled={disabled || busy} className="inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white transition hover:bg-white/10 disabled:opacity-40">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}إضافة اللون للجرد</button>
          <button type="button" onClick={onMatchSystem} disabled={disabled || busy} className="inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-emerald-400/20 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-100 transition hover:bg-emerald-500/15 disabled:opacity-40"><CheckCircle2 className="h-4 w-4" />مطابقة السيستم</button>
          <button type="button" onClick={onZero} disabled={disabled || busy} className="inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-100 transition hover:bg-amber-500/15 disabled:opacity-40"><RotateCcw className="h-4 w-4" />تصفير</button>
          <button type="button" onClick={onRemove} disabled={disabled || busy} className="inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-rose-400/20 bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-100 transition hover:bg-rose-500/15 disabled:opacity-40"><Trash2 className="h-4 w-4" />حذف اللون</button>
        </div>
      </div>
      <div className="mt-4 space-y-3">
        {group.variants.map((variant) => (
          <MemoDesktopGroupedCountRow key={String(variant.id)} item={variant} disabled={disabled} onCountChange={onCountChange} onCountCommit={onCountCommit} onReasonCommit={onReasonCommit} onNotesCommit={onNotesCommit} />
        ))}
      </div>
    </div>
  );
}

function DesktopGroupedCountRow({ item, disabled, onCountChange, onCountCommit, onReasonCommit, onNotesCommit }) {
  const counted = Number(item.counted_quantity || 0);
  const system = Number(item.system_quantity || 0);
  const diff = Number(item.difference_quantity || counted - system);
  const [notes, setNotes] = useState(item.notes || "");
  useEffect(() => {
    setNotes(item.notes || "");
  }, [item.notes]);
  const diffTone = diff > 0 ? "text-emerald-300" : diff < 0 ? "text-rose-300" : "text-zinc-300";
  return (
    <div className="rounded-[var(--radius-card)] border border-white/10 bg-white/5 p-3">
      <div className="flex flex-col gap-3 xl:grid xl:grid-cols-[minmax(120px,1fr)_90px_120px_90px_160px_minmax(0,1fr)_44px] xl:items-center">
        <div className="min-w-0">
          <div className="font-semibold text-white">{item.size || "مقاس غير محدد"}</div>
          <div className="mt-1 text-xs text-zinc-400">رمز الصنف: {item.variant_sku || "غير متاح"} · الباركود: {item.variant_barcode || "غير متاح"}</div>
        </div>
        <div><div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">السيستم</div><div className="mt-1 text-sm font-black text-white">{system}</div></div>
        <label className="block"><div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">الفعلي</div><input type="number" disabled={disabled} value={counted} onChange={(event) => onCountChange(item.id, event.target.value)} onBlur={(event) => onCountCommit(item.id, { counted_quantity: Number(event.target.value || 0) })} className="mt-1 w-full rounded-[var(--radius-control)] border border-white/10 bg-zinc-950/70 px-3 py-2 text-sm text-white outline-none disabled:opacity-50" /></label>
        <div><div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">الفرق</div><div className={`mt-1 text-sm font-black ${diffTone}`}>{diff > 0 ? "+" : ""}{diff}</div></div>
        <label className="block"><div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">السبب</div><select disabled={disabled} value={item.reason || "أخرى"} onChange={(event) => onReasonCommit(item.id, { reason: event.target.value })} className="mt-1 w-full rounded-[var(--radius-control)] border border-white/10 bg-zinc-950/70 px-3 py-2 text-sm text-white outline-none disabled:opacity-50">{COUNT_REASONS.map((reason) => (<option key={reason} value={reason} className="bg-zinc-950 text-white">{reason}</option>))}</select></label>
        <label className="block"><div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">ملاحظات</div><input disabled={disabled} value={notes} onChange={(event) => setNotes(event.target.value)} onBlur={(event) => onNotesCommit(item.id, { notes: event.target.value })} placeholder="ملاحظات" className="mt-1 w-full rounded-[var(--radius-control)] border border-white/10 bg-zinc-950/70 px-3 py-2 text-sm text-white outline-none placeholder:text-zinc-500 disabled:opacity-50" /></label>
        <div className="flex justify-end"><button type="button" disabled={disabled} onClick={() => onCountCommit(item.id, { counted_quantity: counted })} className="inline-flex h-[var(--control-height-md)] w-10 items-center justify-center rounded-[var(--radius-control)] border border-white/10 bg-white/5 text-white transition hover:bg-white/10 disabled:opacity-40" title="حفظ"><Save className="h-4 w-4" /></button></div>
      </div>
    </div>
  );
}

function MobileGroupedCountCard({ group, disabled, busy, onAddColor, onMatchSystem, onZero, onRemove, onCountChange, onCountCommit, onReasonCommit, onNotesCommit, expanded, onToggleExpanded }) {
  const inputRefs = useRef(new Map());
  const resolvedImage = resolveInventoryImage(group);
  const focusNextSize = (itemId, currentInput) => {
    const currentIndex = group.variants.findIndex((variant) => String(variant.id) === String(itemId));
    const nextVariant = group.variants[currentIndex + 1];
    if (!nextVariant) { currentInput?.blur?.(); return; }
    const nextInput = inputRefs.current.get(String(nextVariant.id));
    nextInput?.focus?.();
    nextInput?.select?.();
  };
  return (
    <div className="rounded-2xl border border-white/10 bg-zinc-950/90 p-3 shadow-lg shadow-black/10">
      <button type="button" onClick={onToggleExpanded} className="w-full text-start" aria-expanded={expanded}>
        <div className="flex items-start gap-3">
          <div className="h-14 w-14 shrink-0 overflow-hidden rounded-2xl border border-white/10 bg-zinc-900">{resolvedImage ? <img src={resolvedImage} alt={group.product_name || "منتج"} className="h-full w-full object-cover" /> : <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-zinc-800 to-zinc-950 text-zinc-500"><ClipboardList className="h-6 w-6" /></div>}</div>
          <div className="min-w-0 flex-1">
            <div className="text-lg font-black leading-snug text-white">{group.product_name || "منتج"} - {group.color || "لون"}</div>
            <div className="mt-1 text-sm text-zinc-400">{group.variants.length} مقاس · السيستم: {group.system_total} · الفعلي: {group.counted_total}</div>
            <div className={`mt-1 text-sm font-black ${group.difference_total > 0 ? "text-rose-300" : group.difference_total < 0 ? "text-amber-300" : "text-emerald-300"}`}>{group.difference_total > 0 ? `زيادة ${group.difference_total}` : group.difference_total < 0 ? `عجز ${Math.abs(group.difference_total)}` : "مطابق"}</div>
          </div>
        </div>
        <div className="mt-3 inline-flex items-center gap-2 rounded-[var(--radius-card)] border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-white">{expanded ? "إخفاء المقاسات" : "عرض المقاسات"}</div>
      </button>
      {expanded ? <div className="mt-3 space-y-2">{group.variants.map((variant) => (<MemoGroupedCountRow key={String(variant.id)} item={variant} compact disabled={disabled} inputRef={(node) => { if (node) { inputRefs.current.set(String(variant.id), node); } else { inputRefs.current.delete(String(variant.id)); } }} onCountChange={onCountChange} onCountCommit={onCountCommit} onReasonCommit={onReasonCommit} onNotesCommit={onNotesCommit} onAdvance={focusNextSize} />))}<div className="flex flex-wrap gap-2 pt-2"><button type="button" onClick={onAddColor} disabled={disabled || busy} className="inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-emerald-400/20 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-100 transition hover:bg-emerald-500/15 disabled:opacity-40">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}إضافة اللون للجرد</button><button type="button" onClick={onMatchSystem} disabled={disabled || busy} className="inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white transition hover:bg-white/10 disabled:opacity-40"><CheckCircle2 className="h-4 w-4" />مطابقة</button><button type="button" onClick={onZero} disabled={disabled || busy} className="inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-100 transition hover:bg-amber-500/15 disabled:opacity-40"><RotateCcw className="h-4 w-4" />تصفير</button><button type="button" onClick={onRemove} disabled={disabled || busy} className="inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-rose-400/20 bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-100 transition hover:bg-rose-500/15 disabled:opacity-40"><Trash2 className="h-4 w-4" />حذف اللون</button></div></div> : null}
    </div>
  );
}

function GroupedCountRow({ item, compact = false, disabled, inputRef, onCountChange, onCountCommit, onReasonCommit, onNotesCommit, onAdvance }) {
  const counted = Number(item.counted_quantity || 0);
  const system = Number(item.system_quantity || 0);
  const diff = Number(item.difference_quantity || counted - system);
  const diffTone = diff > 0 ? "text-rose-300" : diff < 0 ? "text-amber-300" : "text-emerald-300";
  const hasDetails = Boolean(item.variant_sku || item.variant_barcode || item.variant_article_code || item.product_id || item.product_variant_id || item.id);
  const [reasonDraft, setReasonDraft] = useState(item.reason || "أخرى");
  const [notes, setNotes] = useState(item.notes || "");
  const [showDetails, setShowDetails] = useState(false);
  const saveTimerRef = useRef(null);
  const reasonDraftRef = useRef(reasonDraft);
  const notesRef = useRef(notes);
  useEffect(() => { setReasonDraft(item.reason || "أخرى"); }, [item.reason]);
  useEffect(() => { setNotes(item.notes || ""); }, [item.notes]);
  useEffect(() => { reasonDraftRef.current = reasonDraft; }, [reasonDraft]);
  useEffect(() => { notesRef.current = notes; }, [notes]);
  useEffect(() => () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); }, []);
  const scheduleCountSave = (nextValue) => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); saveTimerRef.current = setTimeout(() => { void onCountCommit(item.id, { counted_quantity: Number(nextValue || 0), reason: reasonDraftRef.current || "", notes: notesRef.current || "" }); }, 250); };
  const handleCountChange = (value) => { if (disabled) return; onCountChange(item.id, value); scheduleCountSave(value); };
  const commitCount = (nextValue) => { if (disabled) return; const normalized = Math.max(0, Number(nextValue || 0)); onCountChange(item.id, String(normalized)); scheduleCountSave(normalized); };
  const incrementCount = () => commitCount(counted + 1);
  const decrementCount = () => commitCount(Math.max(0, counted - 1));
  const handleReasonChange = (reason) => { if (disabled) return; setReasonDraft(reason); void onReasonCommit(item.id, { reason }); };
  const handleNotesBlur = (value) => { if (disabled) return; void onNotesCommit(item.id, { notes: value }); };
  if (compact) {
    return (<div className="inventory-count-mobile-row-compact rounded-[var(--radius-card)] border border-white/10 bg-white/[0.04] shadow-none" style={{ boxShadow: "none", borderRadius: "14px", padding: "8px 10px" }}><span style={{ display: "none" }} data-testid="mobile-grouped-count-row" /><div className="grid min-h-[52px] grid-cols-[minmax(0,1fr)_72px_minmax(0,1.35fr)_64px] items-center gap-2"><div className="min-w-0"><div className="truncate text-sm font-black leading-tight text-white">{item.size || "--"}</div><div className="mt-0.5 text-[9px] uppercase tracking-[0.16em] text-zinc-500">مقاس</div></div><div className="min-w-0"><div className="text-[9px] font-bold uppercase tracking-[0.16em] text-zinc-500">المتوقع</div><div className="mt-0.5 text-sm font-black tabular-nums text-white">{system}</div></div><div className="min-w-0"><div className="text-[9px] font-bold uppercase tracking-[0.16em] text-zinc-500">الفعلي</div><div className="mt-1 flex items-center gap-1.5"><button type="button" disabled={disabled} onClick={decrementCount} className="inline-flex h-[var(--control-height-sm)] w-7 shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-white/10 bg-black/30 text-base font-black text-white transition-colors hover:bg-white/10 disabled:opacity-40" aria-label="إنقاص الكمية">-</button><input ref={inputRef} type="number" inputMode="numeric" disabled={disabled} value={counted} onChange={(event) => handleCountChange(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); onAdvance?.(item.id, event.currentTarget); } }} className="h-[var(--control-height-sm)] w-16 shrink-0 rounded-[var(--radius-control)] border border-white/10 bg-zinc-950/70 px-1.5 text-center text-sm font-black text-white outline-none tabular-nums placeholder:text-zinc-500 disabled:opacity-50" /><button type="button" disabled={disabled} onClick={incrementCount} className="inline-flex h-[var(--control-height-sm)] w-7 shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-white/10 bg-emerald-500/15 text-base font-black text-emerald-200 transition-colors hover:bg-emerald-500/25 disabled:opacity-40" aria-label="زيادة الكمية">+</button></div></div><div className="min-w-[64px] text-end"><div className="text-[9px] font-bold uppercase tracking-[0.16em] text-zinc-500">الفرق</div><div className={`mt-0.5 text-sm font-black tabular-nums ${diffTone}`}>{diff > 0 ? `+${diff}` : diff < 0 ? `-${Math.abs(diff)}` : "مطابق"}</div></div></div></div>);
  }
  return (<div className="inventory-count-mobile-row-compact rounded-[var(--radius-card)] border border-white/10 bg-white/[0.04] px-2 py-2 shadow-none" style={{ boxShadow: "none", borderRadius: "14px", padding: "8px 10px" }}><span style={{ display: "none" }} data-testid="mobile-grouped-count-row" /><div className="grid min-h-[48px] grid-cols-[44px_minmax(0,1fr)_72px] items-center gap-2"><div className="min-w-0"><div className="truncate text-sm font-black leading-tight text-white">{item.size || "--"}</div><div className="mt-0.5 text-[9px] uppercase tracking-[0.16em] text-zinc-500">مقاس</div></div><div className="min-w-0"><div className="flex items-center gap-2 text-[10px] font-semibold text-zinc-400"><span className="uppercase tracking-[0.18em]">المتوقع</span><span className="tabular-nums text-white">{system}</span></div><div className="mt-1.5 flex items-center gap-1.5"><button type="button" disabled={disabled} onClick={decrementCount} className="inline-flex h-[var(--control-height-sm)] w-7 shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-white/10 bg-black/30 text-base font-black text-white transition-colors hover:bg-white/10 disabled:opacity-40" aria-label="إنقاص الكمية">-</button><input ref={inputRef} type="number" inputMode="numeric" disabled={disabled} value={counted} onChange={(event) => handleCountChange(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); onAdvance?.(item.id, event.currentTarget); } }} className="h-[var(--control-height-sm)] w-14 shrink-0 rounded-[var(--radius-control)] border border-white/10 bg-zinc-950/70 px-1.5 text-center text-sm font-black text-white outline-none tabular-nums placeholder:text-zinc-500 disabled:opacity-50" /><button type="button" disabled={disabled} onClick={incrementCount} className="inline-flex h-[var(--control-height-sm)] w-7 shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-white/10 bg-emerald-500/15 text-base font-black text-emerald-200 transition-colors hover:bg-emerald-500/25 disabled:opacity-40" aria-label="زيادة الكمية">+</button></div></div><div className="min-w-[72px] text-end"><div className="text-[9px] font-bold uppercase tracking-[0.16em] text-zinc-500">الفرق</div><div className={`mt-0.5 text-sm font-black tabular-nums ${diffTone}`}>{diff > 0 ? `+${diff}` : diff < 0 ? `-${Math.abs(diff)}` : "مطابق"}</div></div></div>{hasDetails ? <div className="mt-2"><button type="button" onClick={() => setShowDetails((current) => !current)} className="inline-flex items-center rounded-[var(--radius-control)] border border-white/10 bg-black/20 px-2.5 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-white/10">{showDetails ? "إخفاء التفاصيل" : "تفاصيل إضافية"}</button>{showDetails ? <div className="mt-2 rounded-2xl border border-white/10 bg-black/20 p-3 text-xs leading-6 text-zinc-400">{item.variant_sku ? <div className="truncate">رمز الصنف: {item.variant_sku}</div> : null}{item.variant_barcode ? <div className="truncate">الباركود: {item.variant_barcode}</div> : null}{item.variant_article_code ? <div className="truncate">رقم الصنف: {item.variant_article_code}</div> : null}{item.product_id ? <div className="truncate">معرّف المنتج: {item.product_id}</div> : null}{item.product_variant_id || item.id ? <div className="truncate">معرّف المتغير: {item.product_variant_id || item.id}</div> : null}<label className="mt-2 block"><div className="mb-1 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">السبب</div><select disabled={disabled} value={reasonDraft} onChange={(event) => handleReasonChange(event.target.value)} className="w-full rounded-[var(--radius-control)] border border-white/10 bg-zinc-950/70 px-3 py-2 text-sm text-white outline-none disabled:opacity-50">{COUNT_REASONS.map((reason) => (<option key={reason} value={reason} className="bg-zinc-950 text-white">{reason}</option>))}</select></label><label className="mt-2 block"><div className="mb-1 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">ملاحظات</div><input disabled={disabled} value={notes} onChange={(event) => setNotes(event.target.value)} onBlur={(event) => handleNotesBlur(event.target.value)} placeholder="ملاحظات" className="w-full rounded-[var(--radius-control)] border border-white/10 bg-zinc-950/70 px-3 py-2 text-sm text-white outline-none placeholder:text-zinc-500 disabled:opacity-50" /></label></div> : null}</div> : null}</div>);
}

const areRowPropsEqual = (prev, next) =>
  prev.disabled === next.disabled &&
  prev.compact === next.compact &&
  prev.inputRef === next.inputRef &&
  prev.onCountChange === next.onCountChange &&
  prev.onCountCommit === next.onCountCommit &&
  prev.onReasonCommit === next.onReasonCommit &&
  prev.onNotesCommit === next.onNotesCommit &&
  prev.onAdvance === next.onAdvance &&
  prev.item === next.item;

const areSameGroupData = (prevGroup = {}, nextGroup = {}) =>
  prevGroup.key === nextGroup.key &&
  prevGroup.product_id === nextGroup.product_id &&
  prevGroup.product_name === nextGroup.product_name &&
  prevGroup.color === nextGroup.color &&
  resolveInventoryImage(prevGroup) === resolveInventoryImage(nextGroup) &&
  prevGroup.system_total === nextGroup.system_total &&
  prevGroup.counted_total === nextGroup.counted_total &&
  prevGroup.difference_total === nextGroup.difference_total &&
  Array.isArray(prevGroup.variants) &&
  Array.isArray(nextGroup.variants) &&
  prevGroup.variants.length === nextGroup.variants.length &&
  prevGroup.variants.every((variant, index) => variant === nextGroup.variants[index]);

const areGroupedCardPropsEqual = (prev, next) =>
  prev.disabled === next.disabled &&
  prev.busy === next.busy &&
  prev.compact === next.compact &&
  prev.expanded === next.expanded &&
  areSameGroupData(prev.group, next.group);

const MemoLookupGroupCard = memo(
  LookupGroupCard,
  (prev, next) =>
    prev.busy === next.busy &&
    prev.selected === next.selected &&
    areSameGroupData(prev.group, next.group)
);
const MemoGroupedCountCard = memo(GroupedCountCard, areGroupedCardPropsEqual);
const MemoDesktopGroupedCountRow = memo(DesktopGroupedCountRow, areRowPropsEqual);
const MemoMobileGroupedCountCard = memo(MobileGroupedCountCard, areGroupedCardPropsEqual);
const MemoGroupedCountRow = memo(GroupedCountRow, areRowPropsEqual);

function ScopeModal({ branches, warehouses, form, setForm, onClose, onCreate }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-4">
      <button type="button" className="absolute inset-0 cursor-default" onClick={onClose} aria-label="إغلاق" />
      <div className="relative w-full max-w-2xl rounded-t-3xl border border-white/10 bg-zinc-950 p-5 shadow-2xl shadow-black sm:rounded-3xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300">بدء جرد جديد</div>
            <h3 className="m1-section-title mt-1 text-white">حدد نطاق الجرد</h3>
            <p className="mt-2 text-sm leading-6 text-zinc-400">اختر فرعًا أو مخزنًا إذا كان متاحًا، ثم ابدأ جلسة الجرد.</p>
          </div>
          <button type="button" onClick={onClose} className="inline-flex min-h-[var(--control-height-md)] items-center gap-2 rounded-[var(--radius-control)] border border-white/10 bg-white/5 px-3 text-sm font-black text-white transition hover:bg-white/10" aria-label="رجوع">
            <ArrowRight className="h-4 w-4" />
            <span>رجوع</span>
          </button>
        </div>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <Field label="اسم الجلسة" value={form.title} onChange={(value) => setForm((current) => ({ ...current, title: value }))} />
          <SelectField label="الفرع" value={form.branchId} onChange={(value) => setForm((current) => ({ ...current, branchId: value }))} options={[{ value: "", label: "بدون فرع" }, ...branches.map((branch) => ({ value: String(branch.id), label: branch.name }))]} />
          <SelectField label="المخزن" value={form.warehouseId} onChange={(value) => setForm((current) => ({ ...current, warehouseId: value }))} options={[{ value: "", label: "بدون مخزن" }, ...warehouses.map((warehouse) => ({ value: String(warehouse.id), label: warehouse.name }))]} />
          <label className="block md:col-span-2"><div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-zinc-500">ملاحظات</div><textarea value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} rows={4} placeholder="ملاحظات عامة" className="w-full rounded-[var(--radius-control)] border border-white/10 bg-white/5 p-4 text-sm text-white outline-none placeholder:text-zinc-500" /></label>
        </div>
        <div className="mt-5 flex justify-end gap-3">
          <button type="button" onClick={onClose} className="rounded-[var(--radius-control)] border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10">إلغاء</button>
          <button type="button" onClick={onCreate} className="rounded-[var(--radius-control)] bg-primary px-4 py-3 text-sm font-black text-black transition hover:bg-primary">بدء الجرد</button>
        </div>
      </div>
    </div>
  );
}

function InventoryCountFiltersModal({
  open,
  panelRef,
  smartFilterOptions,
  selectedGender,
  onGenderChange,
  selectedProductType,
  onProductTypeChange,
  selectedGrade,
  onGradeChange,
  brandOptions,
  selectedBrandId,
  onBrandChange,
  manufacturerOptions,
  selectedManufacturerId,
  onManufacturerChange,
  sizeOptions,
  selectedSize,
  onSizeChange,
  activeSmartFilterCount,
  onReset,
  onClose,
}) {
  return (
    <SmartPosFilters
      open={open}
      panelRef={panelRef}
      smartFilterOptions={smartFilterOptions}
      selectedGender={selectedGender}
      onGenderChange={onGenderChange}
      selectedProductType={selectedProductType}
      onProductTypeChange={onProductTypeChange}
      selectedGrade={selectedGrade}
      onGradeChange={onGradeChange}
      brandOptions={brandOptions}
      selectedBrandId={selectedBrandId}
      onBrandChange={onBrandChange}
      manufacturerOptions={manufacturerOptions}
      selectedManufacturerId={selectedManufacturerId}
      onManufacturerChange={onManufacturerChange}
      sizeOptions={sizeOptions}
      selectedSize={selectedSize}
      onSizeChange={onSizeChange}
      activeSmartFilterCount={activeSmartFilterCount}
      onReset={onReset}
      onClose={onClose}
    />
  );
}

function ScannerModal({ onClose, onScan, onPermissionDenied, onUnsupported, onError }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
      <button type="button" className="absolute inset-0" onClick={onClose} aria-label="إغلاق الماسح" />
      <div className="relative w-full max-w-2xl rounded-3xl border border-white/10 bg-zinc-950 p-4 shadow-2xl shadow-black">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">ماسح الباركود</div>
            <h3 className="m1-section-title mt-1 text-white">امسح الباركود أو رمز QR</h3>
          </div>
          <button type="button" onClick={onClose} className="inline-flex min-h-[var(--control-height-md)] items-center gap-2 rounded-[var(--radius-control)] border border-white/10 bg-white/5 px-3 text-sm font-black text-white transition hover:bg-white/10" aria-label="رجوع">
            <ArrowRight className="h-4 w-4" />
            <span>رجوع</span>
          </button>
        </div>
        <div className="overflow-hidden rounded-2xl border border-white/10 bg-black">
          <BarcodeScanner onScan={onScan} onPermissionDenied={onPermissionDenied} onUnsupported={onUnsupported} onError={onError} className="w-full" scannerClassName="h-[420px] w-full" />
        </div>
      </div>
    </div>
  );
}
export default InventoryCountPage;


