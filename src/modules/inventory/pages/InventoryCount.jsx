import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import {
  ArrowLeft,
  Camera,
  CheckCircle2,
  ClipboardList,
  Loader2,
  PackageSearch,
  Plus,
  RotateCcw,
  ScanBarcode,
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
import InventoryShell from "../components/InventoryShell";
import StatusBadge from "../../purchases/components/StatusBadge";
import { formatDateTime, normalizeWarehouse } from "../../purchases/lib/flowStore";
import {
  approveInventoryCountSession,
  cancelInventoryCountSession,
  createInventoryCountSession,
  getInventoryCountSession,
  listInventoryCountSessions,
  openInventoryCountSession,
  searchInventoryCountVariants,
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

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeText = (value = "") => String(value || "").trim();

const sizeSortValue = (value) => {
  const text = normalizeText(value);
  if (!text) return Number.POSITIVE_INFINITY;
  const numeric = Number.parseFloat(text.replace(",", "."));
  return Number.isFinite(numeric) ? numeric : Number.POSITIVE_INFINITY;
};

const normalizeCountVariant = (record = {}) => {
  const productId = record.product_id ?? record.productId ?? record.product?.id ?? null;
  const variantId = record.product_variant_id ?? record.variant_id ?? record.variantId ?? record.id ?? null;
  const productName = normalizeText(record.product_name ?? record.productName ?? record.name ?? "");
  const color = normalizeText(record.color ?? record.variant_color ?? record.color_name ?? "");
  const size = normalizeText(record.size ?? record.variant_size ?? record.size_name ?? "");
  const sku = normalizeText(record.sku ?? record.variant_sku ?? "");
  const barcode = normalizeText(record.barcode ?? record.variant_barcode ?? "");
  const articleCode = normalizeText(record.article_code ?? record.variant_article_code ?? "");
  const imageUrl = normalizeText(record.image_url ?? record.variant_image_url ?? "");
  const systemQuantity = toNumber(record.system_quantity ?? record.stock ?? record.expected_qty ?? 0);
  const countedQuantity = toNumber(record.counted_quantity ?? record.actual_qty ?? 0);
  const differenceQuantity = toNumber(record.difference_quantity ?? record.difference_qty ?? countedQuantity - systemQuantity);

  return {
    id: record.id ?? null,
    product_id: productId,
    product_variant_id: variantId,
    product_name: productName,
    color,
    size,
    sku,
    barcode,
    article_code: articleCode,
    image_url: imageUrl,
    system_quantity: systemQuantity,
    counted_quantity: countedQuantity,
    difference_quantity: differenceQuantity,
    reason: normalizeText(record.reason ?? ""),
    notes: normalizeText(record.notes ?? ""),
    variant_color: color,
    variant_size: size,
    variant_sku: sku,
    variant_barcode: barcode,
    variant_article_code: articleCode,
    variant_image_url: imageUrl,
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
        color: variant.color,
        image_url: variant.image_url,
        variants: [],
        system_total: 0,
        counted_total: 0,
        difference_total: 0,
      });
    }

    const group = groups.get(key);
    if (!group.image_url && variant.image_url) group.image_url = variant.image_url;
    group.variants.push(variant);
    group.system_total += toNumber(variant.system_quantity, 0);
    group.counted_total += toNumber(variant.counted_quantity, 0);
    group.difference_total += toNumber(variant.difference_quantity, variant.counted_quantity - variant.system_quantity);
  }

  return Array.from(groups.values()).map((group) => ({
    ...group,
    variants: group.variants.sort((a, b) => {
      const bySize = sizeSortValue(a.size) - sizeSortValue(b.size);
      if (bySize !== 0) return bySize;
      return String(a.size || "").localeCompare(String(b.size || ""));
    }),
  }));
};

const isExactIdentifierMatch = (query, variant) => {
  const normalizedQuery = normalizeText(query).toLowerCase();
  if (!normalizedQuery) return false;
  return [variant.barcode, variant.sku, variant.article_code].some((value) => normalizeText(value).toLowerCase() === normalizedQuery);
};

function InventoryCountPage() {
  const { id: routeSessionId } = useParams();
  const navigate = useNavigate();
  const isDetail = Boolean(routeSessionId);

  const [sessions, setSessions] = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState("");
  const [sessionSearch, setSessionSearch] = useState("");
  const [session, setSession] = useState(null);
  const [items, setItems] = useState([]);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [sessionError, setSessionError] = useState("");
  const [savingDraft, setSavingDraft] = useState(false);
  const [openingSession, setOpeningSession] = useState(false);
  const [approvingSession, setApprovingSession] = useState(false);
  const [cancellingSession, setCancellingSession] = useState(false);
  const [lookupQuery, setLookupQuery] = useState("");
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupResults, setLookupResults] = useState([]);
  const [busyGroupKey, setBusyGroupKey] = useState("");
  const [scannerOpen, setScannerOpen] = useState(false);
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

  const groupedLookupResults = useMemo(() => groupCountVariants(lookupResults), [lookupResults]);
  const groupedItems = useMemo(() => groupCountVariants(items), [items]);
  const visibleGroupedItems = useMemo(
    () => groupedItems.filter((group) => !hiddenGroups.includes(group.key)),
    [groupedItems, hiddenGroups]
  );

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

  const loadSessions = async () => {
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
  };

  const loadSession = async () => {
    if (!routeSessionId) return;
    try {
      setSessionLoading(true);
      setSessionError("");
      const response = await getInventoryCountSession(routeSessionId);
      const nextSession = response?.session || null;
      const nextItems = Array.isArray(response?.items) ? response.items : [];
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
  };

  useEffect(() => {
    void loadLookups();
  }, []);

  useEffect(() => {
    if (isDetail) {
      void loadSession();
    } else {
      void loadSessions();
    }
  }, [isDetail, routeSessionId]);

  useEffect(() => {
    setHiddenGroups([]);
  }, [routeSessionId]);

  const mergeSavedItem = (savedItem) => {
    if (!savedItem) return;
    setItems((current) => {
      const next = current.filter((row) => String(row.id) !== String(savedItem.id) && String(row.product_variant_id || row.variant_id) !== String(savedItem.product_variant_id || savedItem.variant_id));
      return [normalizeCountVariant(savedItem), ...next];
    });
  };

  const persistVariant = async (variant, patch = {}) => {
    if (!routeSessionId || !variant) return null;
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

  const createSessionHandler = async () => {
    try {
      const response = await createInventoryCountSession({
        title: newSessionForm.title || "جرد جديد",
        branchId: newSessionForm.branchId || null,
        warehouseId: newSessionForm.warehouseId || null,
        notes: newSessionForm.notes || "",
      });
      const createdSession = response?.session;
      if (!createdSession?.id) throw new Error("فشل إنشاء الجلسة");
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

  const approveSessionHandler = async () => {
    if (!routeSessionId) return;
    const confirmed = window.confirm("هل تريد اعتماد الجرد؟ سيتم إنشاء حركات المخزون لكل فرق.");
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

  const lookupVariants = async () => {
    if (!routeSessionId || !lookupQuery.trim()) return;
    try {
      setLookupLoading(true);
      const query = lookupQuery.trim();
      const response = await searchInventoryCountVariants(routeSessionId, { query, limit: 25 });
      const results = Array.isArray(response?.items) ? response.items : [];
      setLookupResults(results);

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
        return;
      }

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

  const updateLocalItem = (itemId, updater) => {
    setItems((current) =>
      current.map((row) => {
        if (String(row.id) !== String(itemId)) return row;
        return {
          ...row,
          ...updater(row),
        };
      })
    );
  };

  const handleCountedChange = (itemId, value) => {
    const parsed = Number(value || 0);
    updateLocalItem(itemId, (row) => ({
      counted_quantity: parsed,
      difference_quantity: parsed - toNumber(row.system_quantity, 0),
      actual_qty: parsed,
      difference_qty: parsed - toNumber(row.system_quantity, 0),
    }));
  };

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
      for (const variant of group.variants) {
        const existing = items.find((item) => String(item.product_variant_id || item.variant_id || item.id) === String(variant.product_variant_id || variant.variant_id || variant.id));
        await persistVariant(variant, {
          counted_quantity: existing ? toNumber(existing.counted_quantity, 0) : 0,
          system_quantity: variant.system_quantity,
          reason: existing?.reason || "",
          notes: existing?.notes || "",
        });
      }
      await loadSession();
      toast.success("تمت إضافة اللون للجرد");
    } catch (error) {
      console.error("[inventory-count] add color group", error);
      toast.error(error?.message || "تعذر إضافة اللون للجرد");
    } finally {
      setBusyGroupKey("");
    }
  };

  const setGroupCount = async (group, value, toastLabel) => {
    if (!routeSessionId) return;
    try {
      setBusyGroupKey(group.key);
      for (const variant of group.variants) {
        await persistVariant(variant, {
          counted_quantity: value === null || value === undefined ? variant.system_quantity : value,
          system_quantity: variant.system_quantity,
          reason: variant.reason || "",
          notes: variant.notes || "",
        });
      }
      await loadSession();
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
      for (const variant of group.variants) {
        await persistVariant(variant, {
          counted_quantity: variant.system_quantity,
          system_quantity: variant.system_quantity,
          reason: variant.reason || "",
          notes: variant.notes || "",
        });
      }
      setHiddenGroups((current) => (current.includes(group.key) ? current : [...current, group.key]));
      await loadSession();
      toast.success("تم حذف اللون من العرض");
    } catch (error) {
      console.error("[inventory-count] remove group", error);
      toast.error(error?.message || "تعذر حذف اللون");
    } finally {
      setBusyGroupKey("");
    }
  };

  const sessionSummary = useMemo(
    () =>
      sessions.reduce(
        (acc, row) => {
          acc.total += 1;
          const status = String(row.status || "draft");
          if (status === "draft") acc.draft += 1;
          if (status === "in_progress") acc.inProgress += 1;
          if (status === "completed") acc.completed += 1;
          if (status === "cancelled") acc.cancelled += 1;
          return acc;
        },
        { total: 0, draft: 0, inProgress: 0, completed: 0, cancelled: 0 }
      ),
    [sessions]
  );

  const filteredSessions = useMemo(() => {
    const query = sessionSearch.trim().toLowerCase();
    if (!query) return sessions;
    return sessions.filter((row) =>
      `${row.title || ""} ${row.branch_name || ""} ${row.warehouse_name || ""} ${row.status || ""} ${row.notes || ""} ${row.id || ""}`
        .toLowerCase()
        .includes(query)
    );
  }, [sessionSearch, sessions]);

  const itemSummary = useMemo(() => {
    const visibleItems = visibleGroupedItems.flatMap((group) => group.variants);
    const positive = visibleItems.filter((item) => toNumber(item.difference_quantity, 0) > 0).length;
    const negative = visibleItems.filter((item) => toNumber(item.difference_quantity, 0) < 0).length;
    const absoluteDiff = visibleItems.reduce((sum, item) => sum + Math.abs(toNumber(item.difference_quantity, 0)), 0);
    return {
      total: visibleItems.length,
      positive,
      negative,
      absoluteDiff,
      groups: visibleGroupedItems.length,
    };
  }, [visibleGroupedItems]);

  const selectedBranchName = branches.find((branch) => String(branch.id) === String(newSessionForm.branchId))?.name || "";
  const selectedWarehouseName = warehouses.find((warehouse) => String(warehouse.id) === String(newSessionForm.warehouseId))?.name || "";

  return (
    <>
      <InventoryShell
        title="الجرد"
        subtitle="إدارة جلسات الجرد، البحث بالباركود أو SKU، واعتماد الفروقات عبر حركات مخزون رسمية فقط."
        actions={
          <div className="flex flex-wrap gap-2">
            {isDetail ? (
              <Link to="/inventory/count" className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10">
                <ArrowLeft className="h-4 w-4" />
                العودة إلى القائمة
              </Link>
            ) : null}
            <button
              type="button"
              onClick={() => setScopeModalOpen(true)}
              className="inline-flex items-center gap-2 rounded-2xl bg-emerald-500 px-4 py-2 text-sm font-black text-black transition hover:bg-emerald-400"
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

              <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge value={SESSION_STATUS_LABELS[session?.status || "draft"] || session?.status || "مسودة"} />
                      <span className={`rounded-full border px-3 py-1 text-xs font-black ${statusTone[session?.status || "draft"] || statusTone.draft}`}>
                        {session?.status === "completed" ? "مغلق" : session?.status === "cancelled" ? "ملغي" : session?.status === "in_progress" ? "نشط" : "مسودة"}
                      </span>
                    </div>
                    <h1 className="mt-3 text-3xl font-black tracking-tight text-white">{newSessionForm.title || "جرد جديد"}</h1>
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
                      disabled={savingDraft || session?.status === "completed" || session?.status === "cancelled"}
                      className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10 disabled:opacity-40"
                    >
                      {savingDraft ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      حفظ كمسودة
                    </button>
                    <button
                      type="button"
                      onClick={openSessionHandler}
                      disabled={openingSession || session?.status === "completed" || session?.status === "cancelled"}
                      className="inline-flex items-center gap-2 rounded-2xl border border-amber-400/20 bg-amber-500/10 px-4 py-2 text-sm font-semibold text-amber-100 transition hover:bg-amber-500/15 disabled:opacity-40"
                    >
                      {openingSession ? <Loader2 className="h-4 w-4 animate-spin" /> : <SquareArrowOutUpRight className="h-4 w-4" />}
                      فتح الجرد
                    </button>
                    <button
                      type="button"
                      onClick={approveSessionHandler}
                      disabled={approvingSession || session?.status === "completed" || session?.status === "cancelled"}
                      className="inline-flex items-center gap-2 rounded-2xl bg-emerald-500 px-4 py-2 text-sm font-black text-black transition hover:bg-emerald-400 disabled:opacity-40"
                    >
                      {approvingSession ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                      اعتماد الجرد
                    </button>
                    <button
                      type="button"
                      onClick={cancelSessionHandler}
                      disabled={cancellingSession || session?.status === "completed" || session?.status === "cancelled"}
                      className="inline-flex items-center gap-2 rounded-2xl border border-rose-400/20 bg-rose-500/10 px-4 py-2 text-sm font-semibold text-rose-100 transition hover:bg-rose-500/15 disabled:opacity-40"
                    >
                      {cancellingSession ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                      إلغاء
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

              <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <h2 className="text-xl font-black text-white">بحث / سكان باركود</h2>
                    <p className="mt-1 text-sm text-zinc-400">ابحث بالباركود أو SKU، ولو كان التطابق مباشرًا سيتم عد قطعة تلقائيًا.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setScannerOpen(true)}
                    className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
                  >
                    <Camera className="h-4 w-4" />
                    سكانر
                  </button>
                </div>

                <div className="mt-4 flex flex-col gap-3 lg:flex-row">
                  <div className="relative flex-1">
                    <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                    <input
                      value={lookupQuery}
                      onChange={(event) => setLookupQuery(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          void lookupVariants();
                        }
                      }}
                      placeholder="ابحث بالباركود أو SKU أو اسم المنتج"
                      className="w-full rounded-2xl border border-white/10 bg-white/5 py-3 pl-11 pr-4 text-sm text-white outline-none placeholder:text-zinc-500"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={lookupVariants}
                    disabled={lookupLoading}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl bg-blue-500 px-4 py-3 text-sm font-black text-black transition hover:bg-blue-400 disabled:opacity-40"
                  >
                    {lookupLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageSearch className="h-4 w-4" />}
                    بحث
                  </button>
                </div>

                <div className="mt-4 space-y-3">
                  {groupedLookupResults.length === 0 && lookupQuery.trim() && !lookupLoading ? (
                    <div className="rounded-3xl border border-dashed border-white/10 bg-white/5 p-8 text-center text-zinc-400">
                      لا توجد نتائج مجمعة لهذا البحث.
                    </div>
                  ) : null}

                  {groupedLookupResults.map((group) => (
                    <LookupGroupCard
                      key={group.key}
                      group={group}
                      busy={busyGroupKey === group.key}
                      onAddColor={() => addColorGroupToCount(group)}
                    />
                  ))}
                </div>

                <div className="mt-5 space-y-3">
                  {sessionLoading ? (
                    <div className="rounded-3xl border border-dashed border-white/10 bg-white/5 p-10 text-center text-zinc-400">
                      <Loader2 className="mx-auto h-10 w-10 animate-spin text-emerald-400" />
                      <p className="mt-3">جاري تحميل جلسة الجرد...</p>
                    </div>
                  ) : visibleGroupedItems.length === 0 ? (
                    <div className="rounded-3xl border border-dashed border-white/10 bg-white/5 p-10 text-center text-zinc-400">
                      <ClipboardList className="mx-auto h-12 w-12 text-zinc-500" />
                      <h3 className="mt-4 text-xl font-black text-white">لا توجد أصناف بعد</h3>
                      <p className="mt-2 text-sm text-zinc-400">ابدأ بالسكان أو البحث ثم أضف اللون للجرد.</p>
                    </div>
                  ) : (
                    visibleGroupedItems.map((group) => (
                      <GroupedCountCard
                        key={group.key}
                        group={group}
                        disabled={session?.status === "completed" || session?.status === "cancelled"}
                        busy={busyGroupKey === group.key}
                        onAddColor={() => addColorGroupToCount(group)}
                        onMatchSystem={() => matchGroupToSystem(group)}
                        onZero={() => zeroGroup(group)}
                        onRemove={() => removeGroupFromView(group)}
                        onCountChange={handleCountedChange}
                        onCountCommit={handlePersistCounted}
                        onReasonCommit={handlePersistReason}
                        onNotesCommit={handlePersistNotes}
                      />
                    ))
                  )}
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10">
                <h3 className="text-xl font-black text-white">بيانات الجلسة</h3>
                <div className="mt-4 grid gap-3">
                  <Field label="اسم الجلسة" value={newSessionForm.title} onChange={(value) => setNewSessionForm((current) => ({ ...current, title: value }))} />
                  <SelectField
                    label="الفرع"
                    value={newSessionForm.branchId}
                    onChange={(value) => setNewSessionForm((current) => ({ ...current, branchId: value }))}
                    options={[{ value: "", label: "بدون فرع" }, ...branches.map((branch) => ({ value: String(branch.id), label: branch.name }))]}
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
                      rows={5}
                      placeholder="ملاحظات عامة حول الجرد أو منطقة العمل"
                      className="w-full rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white outline-none placeholder:text-zinc-500"
                    />
                  </label>
                </div>
                <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-zinc-300">
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

              <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10">
                <h3 className="text-xl font-black text-white">إرشادات</h3>
                <ul className="mt-4 space-y-3 text-sm leading-7 text-zinc-300">
                  <li>• استخدم السكانر أو البحث السريع لإضافة قطعة مباشرة عند التطابق الدقيق.</li>
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
                  <h2 className="text-2xl font-black text-white">جلسات الجرد</h2>
                  <p className="mt-1 text-sm text-zinc-400">راجع الجلسات الحالية وافتح أي جلسة لمتابعة الأصناف أو اعتماد الفروقات.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setScopeModalOpen(true)}
                  className="inline-flex items-center gap-2 rounded-2xl bg-emerald-500 px-4 py-2 text-sm font-black text-black transition hover:bg-emerald-400"
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
                    className="w-full rounded-2xl border border-white/10 bg-white/5 py-3 pl-11 pr-4 text-sm text-white outline-none placeholder:text-zinc-500"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => void loadSessions()}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
                >
                  <RotateCcw className="h-4 w-4" />
                  تحديث
                </button>
                <Link to="/inventory" className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10">
                  <Warehouse className="h-4 w-4" />
                  المخزون
                </Link>
              </div>

              <div className="mt-5 space-y-3">
                {sessionsLoading ? (
                  <div className="rounded-3xl border border-dashed border-white/10 bg-white/5 p-10 text-center text-zinc-400">
                    <Loader2 className="mx-auto h-10 w-10 animate-spin text-emerald-400" />
                    <p className="mt-3">جاري تحميل جلسات الجرد...</p>
                  </div>
                ) : filteredSessions.length === 0 ? (
                  <div className="rounded-3xl border border-dashed border-white/10 bg-white/5 p-10 text-center text-zinc-400">
                    <ClipboardList className="mx-auto h-12 w-12 text-zinc-500" />
                    <h3 className="mt-4 text-xl font-black text-white">لا توجد جلسات جرد بعد</h3>
                    <p className="mt-2 text-sm text-zinc-400">ابدأ جردًا جديدًا ثم افتحه للمسح أو الاعتماد.</p>
                  </div>
                ) : (
                  filteredSessions.map((row) => (
                    <button
                      key={String(row.id)}
                      type="button"
                      onClick={() => navigate(`/inventory/count/${row.id}`)}
                      className="w-full rounded-3xl border border-white/10 bg-white/5 p-4 text-start transition hover:bg-white/10"
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
                          <span className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-xs font-semibold text-white">
                            <SquareArrowOutUpRight className="h-4 w-4" />
                            فتح
                          </span>
                        </div>
                      </div>
                    </button>
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
          onUnsupported={(message) => toast.error(message || "السكانر غير مدعوم")}
          onPermissionDenied={(message) => toast.error(message || "تم رفض إذن الكاميرا")}
          onError={(message) => toast.error(message || "تعذر تشغيل السكانر")}
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
        className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none placeholder:text-zinc-500"
      />
    </label>
  );
}

function SelectField({ label, value, onChange, options = [] }) {
  return (
    <label className="block">
      <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-zinc-500">{label}</div>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} className="bg-zinc-950 text-white">
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function LookupGroupCard({ group, busy, onAddColor }) {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 gap-3">
          <div className="h-16 w-16 shrink-0 overflow-hidden rounded-2xl border border-white/10 bg-zinc-900">
            {group.image_url ? (
              <img src={group.image_url} alt={group.product_name} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-zinc-500">
                <ClipboardList className="h-6 w-6" />
              </div>
            )}
          </div>
          <div className="min-w-0">
            <div className="text-lg font-bold text-white">{group.product_name || "منتج"}</div>
            <div className="mt-1 text-sm text-zinc-400">{group.color || "لون غير محدد"}</div>
            <div className="mt-1 text-xs text-zinc-500">
              عدد المقاسات: {group.variants.length} · السيستم: {group.system_total}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={onAddColor}
          disabled={busy}
          className="inline-flex items-center justify-center gap-2 rounded-2xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-100 transition hover:bg-emerald-500/15 disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          إضافة اللون للجرد
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

function GroupedCountCard({ group, disabled, busy, onAddColor, onMatchSystem, onZero, onRemove, onCountChange, onCountCommit, onReasonCommit, onNotesCommit }) {
  return (
    <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-4 shadow-2xl shadow-black/10">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="text-lg font-black text-white">
            {group.product_name || "منتج"} - {group.color || "لون"}
          </div>
          <div className="mt-1 text-sm text-zinc-400">
            {group.variants.length} مقاس · السيستم: {group.system_total} · الفعلي: {group.counted_total} · الفرق: {group.difference_total}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onAddColor}
            disabled={disabled || busy}
            className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white transition hover:bg-white/10 disabled:opacity-40"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            إضافة اللون للجرد
          </button>
          <button
            type="button"
            onClick={onMatchSystem}
            disabled={disabled || busy}
            className="inline-flex items-center gap-2 rounded-2xl border border-emerald-400/20 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-100 transition hover:bg-emerald-500/15 disabled:opacity-40"
          >
            <CheckCircle2 className="h-4 w-4" />
            مطابقة السيستم
          </button>
          <button
            type="button"
            onClick={onZero}
            disabled={disabled || busy}
            className="inline-flex items-center gap-2 rounded-2xl border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-100 transition hover:bg-amber-500/15 disabled:opacity-40"
          >
            <RotateCcw className="h-4 w-4" />
            تصفير
          </button>
          <button
            type="button"
            onClick={onRemove}
            disabled={disabled || busy}
            className="inline-flex items-center gap-2 rounded-2xl border border-rose-400/20 bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-100 transition hover:bg-rose-500/15 disabled:opacity-40"
          >
            <Trash2 className="h-4 w-4" />
            حذف اللون
          </button>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        {group.variants.map((variant) => (
          <GroupedCountRow
            key={String(variant.id)}
            item={variant}
            disabled={disabled}
            onCountChange={onCountChange}
            onCountCommit={onCountCommit}
            onReasonCommit={onReasonCommit}
            onNotesCommit={onNotesCommit}
          />
        ))}
      </div>
    </div>
  );
}

function GroupedCountRow({ item, disabled, onCountChange, onCountCommit, onReasonCommit, onNotesCommit }) {
  const counted = Number(item.counted_quantity || 0);
  const system = Number(item.system_quantity || 0);
  const diff = Number(item.difference_quantity || counted - system);
  const [notes, setNotes] = useState(item.notes || "");

  useEffect(() => {
    setNotes(item.notes || "");
  }, [item.notes]);

  const diffTone = diff > 0 ? "text-emerald-300" : diff < 0 ? "text-rose-300" : "text-zinc-300";

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
      <div className="flex flex-col gap-3 xl:grid xl:grid-cols-[minmax(120px,1fr)_90px_120px_90px_160px_minmax(0,1fr)_44px] xl:items-center">
        <div className="min-w-0">
          <div className="font-semibold text-white">{item.size || "مقاس غير محدد"}</div>
          <div className="mt-1 text-xs text-zinc-400">
            SKU: {item.variant_sku || "n/a"} · Barcode: {item.variant_barcode || "n/a"}
          </div>
        </div>

        <div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">السيستم</div>
          <div className="mt-1 text-sm font-black text-white">{system}</div>
        </div>

        <label className="block">
          <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">الفعلي</div>
          <input
            type="number"
            disabled={disabled}
            value={counted}
            onChange={(event) => onCountChange(item.id, event.target.value)}
            onBlur={(event) => onCountCommit(item.id, { counted_quantity: Number(event.target.value || 0) })}
            className="mt-1 w-full rounded-xl border border-white/10 bg-zinc-950/70 px-3 py-2 text-sm text-white outline-none disabled:opacity-50"
          />
        </label>

        <div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">الفرق</div>
          <div className={`mt-1 text-sm font-black ${diffTone}`}>{diff > 0 ? "+" : ""}{diff}</div>
        </div>

        <label className="block">
          <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">السبب</div>
          <select
            disabled={disabled}
            value={item.reason || "أخرى"}
            onChange={(event) => onReasonCommit(item.id, { reason: event.target.value })}
            className="mt-1 w-full rounded-xl border border-white/10 bg-zinc-950/70 px-3 py-2 text-sm text-white outline-none disabled:opacity-50"
          >
            {COUNT_REASONS.map((reason) => (
              <option key={reason} value={reason} className="bg-zinc-950 text-white">
                {reason}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">ملاحظات</div>
          <input
            disabled={disabled}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            onBlur={(event) => onNotesCommit(item.id, { notes: event.target.value })}
            placeholder="ملاحظات"
            className="mt-1 w-full rounded-xl border border-white/10 bg-zinc-950/70 px-3 py-2 text-sm text-white outline-none placeholder:text-zinc-500 disabled:opacity-50"
          />
        </label>

        <div className="flex justify-end">
          <button
            type="button"
            disabled={disabled}
            onClick={() => onCountCommit(item.id, { counted_quantity: counted })}
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-white transition hover:bg-white/10 disabled:opacity-40"
            title="حفظ"
          >
            <Save className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function ScopeModal({ branches, warehouses, form, setForm, onClose, onCreate }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-4">
      <button type="button" className="absolute inset-0 cursor-default" onClick={onClose} aria-label="Close" />
      <div className="relative w-full max-w-2xl rounded-t-3xl border border-white/10 bg-zinc-950 p-5 shadow-2xl shadow-black sm:rounded-3xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300">بدء جرد جديد</div>
            <h3 className="mt-1 text-xl font-black text-white">حدد نطاق الجرد</h3>
            <p className="mt-2 text-sm leading-6 text-zinc-400">اختر فرعًا أو مخزنًا إذا كان متاحًا، ثم ابدأ جلسة الجرد.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-xl border border-white/10 bg-white/5 p-2 text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <Field label="اسم الجلسة" value={form.title} onChange={(value) => setForm((current) => ({ ...current, title: value }))} />
          <SelectField
            label="الفرع"
            value={form.branchId}
            onChange={(value) => setForm((current) => ({ ...current, branchId: value }))}
            options={[{ value: "", label: "بدون فرع" }, ...branches.map((branch) => ({ value: String(branch.id), label: branch.name }))]}
          />
          <SelectField
            label="المخزن"
            value={form.warehouseId}
            onChange={(value) => setForm((current) => ({ ...current, warehouseId: value }))}
            options={[{ value: "", label: "بدون مخزن" }, ...warehouses.map((warehouse) => ({ value: String(warehouse.id), label: warehouse.name }))]}
          />
          <label className="block md:col-span-2">
            <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-zinc-500">ملاحظات</div>
            <textarea
              value={form.notes}
              onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
              rows={4}
              placeholder="ملاحظات عامة"
              className="w-full rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white outline-none placeholder:text-zinc-500"
            />
          </label>
        </div>

        <div className="mt-5 flex justify-end gap-3">
          <button type="button" onClick={onClose} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10">
            إلغاء
          </button>
          <button type="button" onClick={onCreate} className="rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-black text-black transition hover:bg-emerald-400">
            بدء الجرد
          </button>
        </div>
      </div>
    </div>
  );
}

function ScannerModal({ onClose, onScan, onPermissionDenied, onUnsupported, onError }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
      <button type="button" className="absolute inset-0" onClick={onClose} aria-label="Close scanner" />
      <div className="relative w-full max-w-2xl rounded-3xl border border-white/10 bg-zinc-950 p-4 shadow-2xl shadow-black">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">سكانر الباركود</div>
            <h3 className="mt-1 text-xl font-black text-white">امسح الباركود أو QR</h3>
          </div>
          <button type="button" onClick={onClose} className="rounded-xl border border-white/10 bg-white/5 p-2 text-white">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="overflow-hidden rounded-2xl border border-white/10 bg-black">
          <BarcodeScanner
            onScan={onScan}
            onPermissionDenied={onPermissionDenied}
            onUnsupported={onUnsupported}
            onError={onError}
            className="w-full"
            scannerClassName="h-[420px] w-full"
          />
        </div>
      </div>
    </div>
  );
}

export default InventoryCountPage;
