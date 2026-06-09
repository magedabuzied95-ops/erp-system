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

function InventoryCountPage() {
  const { id: routeSessionId } = useParams();
  const navigate = useNavigate();
  const isDetail = Boolean(routeSessionId);
  const [sessions, setSessions] = useState([]);
  const [sessionsPagination, setSessionsPagination] = useState({ total: 0, page: 1, limit: 25, totalPages: 1 });
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
  const [scannerOpen, setScannerOpen] = useState(false);
  const [branches, setBranches] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [scopeModalOpen, setScopeModalOpen] = useState(false);
  const [newSessionForm, setNewSessionForm] = useState({
    title: "جرد جديد",
    branchId: "",
    warehouseId: "",
    notes: "",
  });

  const loadLookups = async () => {
    try {
      const [branchesRes, warehousesRes] = await Promise.allSettled([
        api.get("/branches"),
        api.get("/warehouses"),
      ]);

      if (branchesRes.status === "fulfilled") {
        const rows = Array.isArray(branchesRes.value) ? branchesRes.value : branchesRes.value?.branches || [];
        setBranches(rows.map((branch) => ({
          id: branch.id,
          name: branch.name || branch.branch_name || `فرع ${branch.id}`,
          code: branch.code || "",
          is_active: branch.is_active !== false,
        })));
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
      setSessionsPagination(response?.pagination || { total: 0, page: 1, limit: 25, totalPages: 1 });
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

  const createSessionHandler = async () => {
    try {
      const response = await createInventoryCountSession({
        title: newSessionForm.title || "جرد جديد",
        branchId: newSessionForm.branchId || null,
        warehouseId: newSessionForm.warehouseId || null,
        notes: newSessionForm.notes || "",
      });
      const createdSession = response?.session;
      if (!createdSession?.id) {
        throw new Error("فشل إنشاء الجلسة");
      }
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
      setItems((current) => current.map((item) => ({
        ...item,
        counted_quantity: Number(item.counted_quantity || 0),
        difference_quantity: Number(item.difference_quantity || 0),
      })));
      toast.success("تم اعتماد الجرد");
      await loadSession();
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
      toast.success("تم إلغاء الجرد");
      await loadSession();
    } catch (error) {
      console.error("[inventory-count] cancel session", error);
      toast.error(error?.message || "تعذر إلغاء الجرد");
    } finally {
      setCancellingSession(false);
    }
  };

  const addVariantToSession = async (variant) => {
    if (!routeSessionId) return;
    try {
      const existing = items.find((item) => String(item.product_variant_id || item.variant_id) === String(variant.product_variant_id));
      const nextCount = existing ? Number(existing.counted_quantity || 0) + 1 : 1;
      const response = await upsertInventoryCountItem(routeSessionId, {
        productVariantId: variant.product_variant_id,
        countedQuantity: nextCount,
        reason: existing?.reason || "أخرى",
        notes: existing?.notes || "",
      });
      const updatedItem = response?.item;
      if (updatedItem) {
        setItems((current) => {
          const rest = current.filter((item) => String(item.product_variant_id || item.variant_id) !== String(updatedItem.product_variant_id || updatedItem.variant_id));
          return [updatedItem, ...rest].sort((a, b) => Number(a.id) - Number(b.id));
        });
      }
      setLookupQuery("");
      setLookupResults([]);
      setSession(response?.session || session);
      toast.success("تمت إضافة الصنف");
    } catch (error) {
      console.error("[inventory-count] add variant", error);
      toast.error(error?.message || "تعذر إضافة الصنف");
    }
  };

  const lookupVariants = async () => {
    if (!routeSessionId || !lookupQuery.trim()) return;
    try {
      setLookupLoading(true);
      const response = await searchInventoryCountVariants(routeSessionId, { query: lookupQuery.trim(), limit: 8 });
      const results = Array.isArray(response?.items) ? response.items : [];
      setLookupResults(results);
      if (results.length === 1) {
        await addVariantToSession(results[0]);
      }
      if (results.length === 0) {
        toast.error("لم يتم العثور على صنف مطابق");
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
      const response = await searchInventoryCountVariants(routeSessionId, { query: String(value || "").trim(), limit: 8 });
      const results = Array.isArray(response?.items) ? response.items : [];
      setLookupResults(results);
      if (results.length === 1) {
        await addVariantToSession(results[0]);
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

  const persistItem = async (itemId, patch = {}) => {
    if (!routeSessionId) return;
    const target = items.find((row) => String(row.id) === String(itemId));
    if (!target) return;
    const payload = {
      productVariantId: target.product_variant_id || target.variant_id,
      countedQuantity: patch.counted_quantity ?? target.counted_quantity,
      systemQuantity: patch.system_quantity ?? target.system_quantity,
      reason: patch.reason ?? target.reason ?? "أخرى",
      notes: patch.notes ?? target.notes ?? "",
    };
    try {
      const response = await upsertInventoryCountItem(routeSessionId, payload);
      const updatedItem = response?.item;
      if (updatedItem) {
        setItems((current) => current.map((row) => (String(row.id) === String(updatedItem.id) ? updatedItem : row)));
        setSession(response?.session || session);
      }
    } catch (error) {
      console.error("[inventory-count] persist item", error);
      toast.error(error?.message || "تعذر حفظ الصنف");
    }
  };

  const handleCountedQuantityChange = (itemId, value) => {
    const parsed = Number(value || 0);
    setItems((current) =>
      current.map((row) =>
        String(row.id) === String(itemId)
          ? {
              ...row,
              counted_quantity: parsed,
              difference_quantity: parsed - Number(row.system_quantity || 0),
              actual_qty: parsed,
              difference_qty: parsed - Number(row.system_quantity || 0),
            }
          : row
      )
    );
  };

  const itemSummary = useMemo(() => {
    const total = items.length;
    const positive = items.filter((item) => Number(item.difference_quantity || 0) > 0).length;
    const negative = items.filter((item) => Number(item.difference_quantity || 0) < 0).length;
    const absoluteDiff = items.reduce((sum, item) => sum + Math.abs(Number(item.difference_quantity || 0)), 0);
    return { total, positive, negative, absoluteDiff };
  }, [items]);

  const sessionSummary = useMemo(() => {
    return sessions.reduce(
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
    );
  }, [sessions]);

  const filteredSessions = useMemo(() => {
    const query = sessionSearch.trim().toLowerCase();
    if (!query) return sessions;
    return sessions.filter((row) =>
      `${row.title || ""} ${row.branch_name || ""} ${row.warehouse_name || ""} ${row.status || ""} ${row.notes || ""} ${row.id || ""}`
        .toLowerCase()
        .includes(query)
    );
  }, [sessionSearch, sessions]);

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
                الرجوع إلى القائمة
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
              {sessionError ? (
                <div className="rounded-3xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-100">{sessionError}</div>
              ) : null}

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
                <MetricCard label="إجمالي الأصناف" value={itemSummary.total} tone="blue" />
                <MetricCard label="فروقات موجبة" value={itemSummary.positive} tone="emerald" />
                <MetricCard label="فروقات سالبة" value={itemSummary.negative} tone="rose" />
                <MetricCard label="إجمالي الفرق" value={itemSummary.absoluteDiff} tone="amber" />
              </div>

              <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <h2 className="text-xl font-black text-white">بحث / سكان باركود</h2>
                    <p className="mt-1 text-sm text-zinc-400">ابحث بالباركود أو SKU ثم أضف الصنف مباشرة إلى الجرد.</p>
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

                {lookupResults.length > 1 ? (
                  <div className="mt-4 space-y-3">
                    {lookupResults.map((variant) => (
                      <div key={String(variant.product_variant_id)} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                          <div>
                            <div className="font-semibold text-white">{variant.product_name || "منتج"}</div>
                            <div className="mt-1 text-sm text-zinc-400">
                              {variant.color || "لون غير محدد"} / {variant.size || "مقاس غير محدد"} / SKU: {variant.sku || "n/a"} / Barcode: {variant.barcode || "n/a"}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => addVariantToSession(variant)}
                            className="inline-flex items-center gap-2 rounded-2xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-100 transition hover:bg-emerald-500/15"
                          >
                            <Plus className="h-4 w-4" />
                            إضافة
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}

                <div className="mt-5 overflow-x-auto">
                  <div className="min-w-[1200px]">
                    <div className="grid grid-cols-[1.6fr_0.8fr_0.8fr_0.8fr_0.8fr_0.8fr_1fr_1.2fr_0.6fr] rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-xs uppercase tracking-[0.18em] text-zinc-500">
                      <div>المنتج</div>
                      <div>اللون</div>
                      <div>المقاس</div>
                      <div>كمية السيستم</div>
                      <div>الكمية الفعلية</div>
                      <div>الفرق</div>
                      <div>السبب</div>
                      <div>ملاحظات</div>
                      <div></div>
                    </div>

                    <div className="mt-2 space-y-2">
                      {sessionLoading ? (
                        <div className="rounded-3xl border border-dashed border-white/10 bg-white/5 p-10 text-center text-zinc-400">
                          <Loader2 className="mx-auto h-10 w-10 animate-spin text-emerald-400" />
                          <p className="mt-3">جاري تحميل جلسة الجرد...</p>
                        </div>
                      ) : items.length === 0 ? (
                        <div className="rounded-3xl border border-dashed border-white/10 bg-white/5 p-10 text-center text-zinc-400">
                          <ClipboardList className="mx-auto h-12 w-12 text-zinc-500" />
                          <h3 className="mt-4 text-xl font-black text-white">لا توجد أصناف بعد</h3>
                          <p className="mt-2 text-sm text-zinc-400">ابدأ بالسكان أو البحث ثم أضف الأصناف إلى الجرد.</p>
                        </div>
                      ) : (
                        items.map((item) => (
                          <InventoryCountRow
                            key={String(item.id)}
                            item={item}
                            disabled={session?.status === "completed" || session?.status === "cancelled"}
                            onCountedChange={handleCountedQuantityChange}
                            onCountedCommit={persistItem}
                            onReasonCommit={persistItem}
                            onNotesCommit={persistItem}
                          />
                        ))
                      )}
                    </div>
                  </div>
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
                    <span>عدد الأصناف</span>
                    <span className="font-black text-white">{itemSummary.total}</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <span>فروقات مطلقة</span>
                    <span className="font-black text-white">{itemSummary.absoluteDiff}</span>
                  </div>
                </div>
              </div>

              <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10">
                <h3 className="text-xl font-black text-white">إرشادات</h3>
                <ul className="mt-4 space-y-3 text-sm leading-7 text-zinc-300">
                  <li>• استخدم السكانر أو البحث السريع لإضافة الأصناف.</li>
                  <li>• كل تعديل في الكمية أو السبب يُحفظ مباشرة على الجلسة.</li>
                  <li>• الاعتماد ينشئ حركة مخزون من نوع <span className="font-mono">inventory_adjustment</span> لكل فرق.</li>
                  <li>• الإلغاء لا يغيّر المخزون ويوقف الجلسة نهائياً.</li>
                </ul>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {sessionsError ? (
              <div className="rounded-3xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-100">{sessionsError}</div>
            ) : null}

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
                    <p className="mt-2 text-sm text-zinc-400">ابدأ جردًا جديدًا وابدأ المسح أو البحث ثم اعتمد النتائج.</p>
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
                            <span>الأصناف: {row.item_count || 0}</span>
                            <span>الفرق: {row.difference_total || 0}</span>
                            <span>آخر تعديل: {formatDateTime(row.updated_at || row.created_at)}</span>
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

function InventoryCountRow({ item, disabled, onCountedChange, onCountedCommit, onReasonCommit, onNotesCommit }) {
  const counted = Number(item.counted_quantity || 0);
  const system = Number(item.system_quantity || 0);
  const diff = Number(item.difference_quantity || counted - system);
  const [notes, setNotes] = useState(item.notes || "");

  useEffect(() => {
    setNotes(item.notes || "");
  }, [item.notes]);

  const variantLabel = [item.product_name, item.variant_color, item.variant_size].filter(Boolean).join(" / ") || "صنف";

  return (
    <div className="grid grid-cols-[1.6fr_0.8fr_0.8fr_0.8fr_0.8fr_0.8fr_1fr_1.2fr_0.6fr] items-center rounded-2xl border border-white/10 bg-zinc-950/90 px-4 py-3">
      <div>
        <div className="font-semibold text-white">{variantLabel}</div>
        <div className="mt-1 text-xs text-zinc-500">
          SKU: {item.variant_sku || "n/a"} / Barcode: {item.variant_barcode || "n/a"}
        </div>
      </div>
      <div className="text-sm text-zinc-300">{item.variant_color || "n/a"}</div>
      <div className="text-sm text-zinc-300">{item.variant_size || "n/a"}</div>
      <div className="text-sm font-bold text-white">{system}</div>
      <div>
        <input
          type="number"
          disabled={disabled}
          value={counted}
          onChange={(event) => onCountedChange(item.id, event.target.value)}
          onBlur={(event) => onCountedCommit(item.id, { counted_quantity: Number(event.target.value || 0) })}
          className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none disabled:opacity-50"
        />
      </div>
      <div className={`font-black ${diff >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{diff >= 0 ? "+" : ""}{diff}</div>
      <div>
        <select
          disabled={disabled}
          value={item.reason || "أخرى"}
          onChange={(event) => onReasonCommit(item.id, { reason: event.target.value })}
          className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none disabled:opacity-50"
        >
          {COUNT_REASONS.map((reason) => (
            <option key={reason} value={reason} className="bg-zinc-950 text-white">
              {reason}
            </option>
          ))}
        </select>
      </div>
      <div>
        <input
          disabled={disabled}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          onBlur={(event) => onNotesCommit(item.id, { notes: event.target.value })}
          placeholder="ملاحظات"
          className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none placeholder:text-zinc-500 disabled:opacity-50"
        />
      </div>
      <div className="flex justify-end">
        <button
          type="button"
          disabled={disabled}
          onClick={() => onCountedCommit(item.id, { counted_quantity: counted })}
          className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-white transition hover:bg-white/10 disabled:opacity-40"
          title="حفظ"
        >
          <Save className="h-4 w-4" />
        </button>
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
