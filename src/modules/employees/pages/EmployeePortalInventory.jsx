import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Loader2,
  Plus,
  RefreshCw,
  ScanBarcode,
  Search,
  Save,
  Send,
  Menu,
  Trash2,
  Warehouse,
  X,
} from "lucide-react";
import toast from "react-hot-toast";

import BarcodeScanner from "../../../components/BarcodeScanner";
import { resolveProductImageUrl } from "../../../shared/lib/imageUrls";
import EmployeePortalNavControls, { buildEmployeePortalHomePath, canNavigateEmployeePortalBack } from "../components/EmployeePortalNavControls";
import {
  createEmployeePortalInventorySession,
  getEmployeePortalInventorySession,
  listEmployeePortalInventorySessions,
  lookupEmployeePortalInventoryVariants,
  deleteEmployeePortalInventoryColorGroup,
  openEmployeePortalInventorySession,
  reopenEmployeePortalInventorySession,
  submitEmployeePortalInventorySession,
  updateEmployeePortalInventorySession,
  upsertEmployeePortalInventoryItem,
} from "../services/employeePortalInventoryApi";

const clean = (value = "") => String(value || "").trim();
const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const firstNonEmpty = (...values) => values.map((value) => clean(value)).find(Boolean) || "";
const readImageValue = (value) => {
  if (!value) return "";
  if (typeof value === "string") return clean(value);
  if (Array.isArray(value)) return readImageValue(value[0]);
  if (typeof value === "object") {
    return firstNonEmpty(
      value.image_url,
      value.image,
      value.product_image,
      value.color_image,
      value.variant_image,
      value.url,
      value.src,
      value.path,
      value.thumbnail_url,
      value.photo_url,
      value.secure_url,
      value.cloudinary_url
    );
  }
  return "";
};
const resolveInventoryImageUrl = (...sources) => {
  for (const source of sources) {
    const candidate = readImageValue(source);
    const resolved = resolveProductImageUrl(candidate);
    if (resolved) return resolved;
  }
  return "";
};
const getInventoryImageCandidates = (record = {}) => [
  record.image_url,
  record.image,
  record.product_image,
  record.product_image_url,
  record.color_image,
  record.color_image_url,
  record.variant_image,
  record.variant_image_url,
  record.thumbnail_url,
  record.photo_url,
  record.thumbnail,
  record.photo,
  record.images,
  record.product_images,
  record.gallery_images,
];
const resolveCardImage = (record = {}) => {
  const images = Array.isArray(record.images) ? record.images : [];
  useEffect(() => {
    if (!branchDrawerOpen || typeof document === "undefined") return undefined;
    const { body } = document;
    const previousOverflow = body.style.overflow;
    body.style.overflow = "hidden";
    return () => {
      body.style.overflow = previousOverflow;
    };
  }, [branchDrawerOpen]);

  return (
    resolveInventoryImageUrl(
      record.color_image,
      record.variant_image,
      record.product_image,
      record.image_url,
      record.image,
      images[0],
      record.product_images,
      record.gallery_images
    ) || null
  );
};
const createInventoryImagePlaceholder = (label = "") => ({
  src: "",
  alt: label,
});
const normalizeColorKey = (value = "") => {
  const aliases = {
    black: "black",
    اسود: "black",
    "أسود": "black",
    white: "white",
    ابيض: "white",
    "أبيض": "white",
    red: "red",
    احمر: "red",
    "أحمر": "red",
    blue: "blue",
    ازرق: "blue",
    "أزرق": "blue",
    green: "green",
    اخضر: "green",
    "أخضر": "green",
    yellow: "yellow",
    اصفر: "yellow",
    "أصفر": "yellow",
    orange: "orange",
    purple: "purple",
    pink: "pink",
    brown: "brown",
    beige: "beige",
    gray: "gray",
    grey: "gray",
    رمادي: "gray",
    silver: "silver",
    فضي: "silver",
    gold: "gold",
    ذهبي: "gold",
    navy: "navy",
    كحلي: "navy",
    burgundy: "burgundy",
    maroon: "maroon",
    olive: "olive",
    زيتي: "olive",
    cream: "cream",
    كريمي: "cream",
    ivory: "ivory",
    camel: "camel",
    tan: "tan",
    mocha: "mocha",
    coffee: "coffee",
    charcoal: "charcoal",
    volt: "volt",
    cobalt: "cobalt",
    aqua: "aqua",
    mint: "mint",
    rose: "rose",
  };
  const normalized = clean(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[إأآا]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");
  return aliases[normalized] || normalized;
};

const sessionStatusLabels = {
  draft: "مسودة",
  in_progress: "قيد التنفيذ",
  pending_review: "قيد المراجعة",
  rejected: "مرفوضة",
  completed: "مكتملة",
  cancelled: "ملغاة",
};

const sessionStatusTone = {
  draft: "border-slate-200 bg-slate-50 text-slate-700",
  in_progress: "border-amber-200 bg-amber-50 text-amber-700",
  pending_review: "border-sky-200 bg-sky-50 text-sky-700",
  rejected: "border-rose-200 bg-rose-50 text-rose-700",
  completed: "border-emerald-200 bg-emerald-50 text-emerald-700",
  cancelled: "border-zinc-200 bg-zinc-100 text-zinc-600",
};

const sessionFilters = [
  { value: "active", label: "النشطة", statuses: ["draft", "in_progress", "pending_review", "rejected"] },
  { value: "draft", label: "مسودة", statuses: ["draft"] },
  { value: "in_progress", label: "قيد التنفيذ", statuses: ["in_progress"] },
  { value: "pending_review", label: "قيد المراجعة", statuses: ["pending_review"] },
  { value: "rejected", label: "مرفوضة", statuses: ["rejected"] },
  { value: "completed", label: "مكتملة", statuses: ["completed"] },
  { value: "all", label: "الكل", statuses: null },
];

const normalizeVariant = (record = {}) => {
  const productId = record.product_id ?? record.productId ?? null;
  const variantId = record.product_variant_id ?? record.variant_id ?? record.variantId ?? record.id ?? null;
  const productName = clean(record.product_name ?? record.productName ?? record.name ?? "");
  const productSku = clean(record.product_sku ?? record.productSku ?? record.sku ?? "");
  const productBarcode = clean(record.product_barcode ?? record.productBarcode ?? record.barcode ?? "");
  const color = clean(record.color ?? record.variant_color ?? record.color_name ?? "");
  const size = clean(record.size ?? record.variant_size ?? record.size_name ?? "");
  const sku = clean(record.sku ?? record.variant_sku ?? "");
  const barcode = clean(record.barcode ?? record.variant_barcode ?? "");
  const articleCode = clean(record.article_code ?? record.variant_article_code ?? "");
  const imageUrl = resolveInventoryImageUrl(...getInventoryImageCandidates(record));
  const systemQuantity = toNumber(record.system_quantity ?? record.stock ?? record.expected_qty ?? 0);
  const countedQuantity = toNumber(record.counted_quantity ?? record.actual_qty ?? 0);
  const differenceQuantity = toNumber(record.difference_quantity ?? record.difference_qty ?? countedQuantity - systemQuantity);

  return {
    id: record.id ?? null,
    product_id: productId,
    product_variant_id: variantId,
    product_name: productName,
    product_sku: productSku,
    product_barcode: productBarcode,
    color,
    size,
    sku,
    barcode,
    article_code: articleCode,
    image_url: imageUrl,
    image: imageUrl,
    product_image: imageUrl,
    color_image: imageUrl,
    variant_image: imageUrl,
    images: imageUrl ? [imageUrl] : [],
    system_quantity: systemQuantity,
    counted_quantity: countedQuantity,
    difference_quantity: differenceQuantity,
    reason: clean(record.reason ?? ""),
    notes: clean(record.notes ?? ""),
  };
};

const groupVariants = (records = []) => {
  const groups = new Map();
  for (const record of Array.isArray(records) ? records : []) {
    const variant = normalizeVariant(record);
    const productKey = variant.product_id ?? variant.product_name ?? "product";
    const colorKey = normalizeColorKey(variant.color);
    const key = `${productKey}::${colorKey || "default"}`;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        product_id: variant.product_id,
        product_name: variant.product_name,
        color: variant.color,
        color_key: colorKey,
        image_url: variant.image_url,
        image: variant.image_url,
        product_image: variant.image_url,
        color_image: variant.image_url,
        variant_image: variant.image_url,
        images: variant.image_url ? [variant.image_url] : [],
        variants: [],
        system_total: 0,
        counted_total: 0,
        difference_total: 0,
      });
    }
    const group = groups.get(key);
    if (!group.image_url && variant.image_url) {
      group.image_url = variant.image_url;
      group.image = variant.image_url;
      group.product_image = variant.image_url;
      group.color_image = variant.image_url;
      group.variant_image = variant.image_url;
      group.images = variant.image_url ? [variant.image_url] : group.images;
    }
    group.variants.push(variant);
    group.system_total += toNumber(variant.system_quantity, 0);
    group.counted_total += toNumber(variant.counted_quantity, 0);
    group.difference_total += toNumber(variant.difference_quantity, 0);
  }

  return [...groups.values()].map((group) => ({
    ...group,
    variants: group.variants.sort((a, b) => String(a.size || "").localeCompare(String(b.size || ""), "ar")),
  }));
};

const isExactVariantMatch = (query, variant) => {
  const normalized = clean(query).toLowerCase();
  if (!normalized) return false;
  return [variant.barcode, variant.sku, variant.article_code, variant.product_barcode, variant.product_sku]
    .some((value) => clean(value).toLowerCase() === normalized);
};

function InventoryImage({ src, alt = "", className = "" }) {
  const safeSrc = resolveProductImageUrl(src);
  if (safeSrc) {
    return <img src={safeSrc} alt={alt} className={`h-full w-full object-cover ${className}`.trim()} loading="lazy" />;
  }

  return (
    <div className={`flex h-full w-full items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200 text-slate-400 ${className}`.trim()}>
      <Warehouse className="h-5 w-5" />
    </div>
  );
}

function ScannerModal({ onClose, onScan }) {
  return createPortal(
    <div
      className="fixed inset-0 z-[2147483000] flex items-end justify-center bg-black/80 p-3 backdrop-blur-sm sm:items-center sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="flex w-full max-w-md flex-col overflow-hidden rounded-t-3xl border border-white/10 bg-zinc-950 shadow-2xl shadow-black/70 sm:rounded-3xl"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="ماسح الباركود"
        dir="rtl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-white/10 px-4 py-4 text-white">
          <div>
            <div className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-200">Inventory</div>
            <h3 className="mt-1 text-lg font-black">امسح الباركود</h3>
          </div>
          <button type="button" onClick={onClose} className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-zinc-300">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-4">
          <div className="overflow-hidden rounded-3xl border border-white/10 bg-black/60 p-3">
            <BarcodeScanner
              onScan={onScan}
              onPermissionDenied={onClose}
              onUnsupported={onClose}
              onError={onClose}
              className="overflow-hidden rounded-[1.35rem] bg-black"
              scannerClassName="min-h-[320px]"
            />
          </div>
        </div>
      </section>
    </div>,
    document.body
  );
}

export default function EmployeePortalInventory() {
  const { token, sessionId: routeSessionId } = useParams();
  const navigate = useNavigate();
  const [sessions, setSessions] = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState("");
  const [selectedSessionId, setSelectedSessionId] = useState(routeSessionId || "");
  const [session, setSession] = useState(null);
  const [items, setItems] = useState([]);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [sessionSaving, setSessionSaving] = useState(false);
  const [sessionOpening, setSessionOpening] = useState(false);
  const [sessionSubmitting, setSessionSubmitting] = useState(false);
  const [sessionReopening, setSessionReopening] = useState(false);
  const [itemSavingId, setItemSavingId] = useState("");
  const [lookupQuery, setLookupQuery] = useState("");
  const [lookupResults, setLookupResults] = useState([]);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState("active");
  const [sessionSearch, setSessionSearch] = useState("");
  const [titleDraft, setTitleDraft] = useState("");
  const [notesDraft, setNotesDraft] = useState("");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [branchDrawerOpen, setBranchDrawerOpen] = useState(false);

  const isEditable = ["draft", "in_progress"].includes(String(session?.status || ""));
  const isRejected = String(session?.status || "") === "rejected";
  const isPendingReview = String(session?.status || "") === "pending_review";

  const loadSessions = useCallback(async () => {
    try {
      setSessionsLoading(true);
      setSessionsError("");
      const response = await listEmployeePortalInventorySessions(token, { limit: 100, page: 1 });
      const rows = Array.isArray(response?.sessions) ? response.sessions : [];
      setSessions(rows);
    } catch (error) {
      setSessionsError(error?.responseBody?.message || error?.message || "تعذر تحميل الجردات");
    } finally {
      setSessionsLoading(false);
    }
  }, [token]);

  const loadSession = useCallback(async (sessionId) => {
    if (!sessionId) return;
    try {
      setSessionLoading(true);
      const response = await getEmployeePortalInventorySession(token, sessionId);
      const nextSession = response?.session || null;
      const nextItems = Array.isArray(response?.items) ? response.items : [];
      setSession(nextSession);
      setItems(nextItems);
      setTitleDraft(nextSession?.title || "");
      setNotesDraft(nextSession?.notes || "");
      setSelectedSessionId(String(nextSession?.id || sessionId));
    } catch (error) {
      toast.error(error?.responseBody?.message || error?.message || "تعذر تحميل الجرد");
    } finally {
      setSessionLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    if (routeSessionId && routeSessionId !== selectedSessionId) {
      setSelectedSessionId(routeSessionId);
      loadSession(routeSessionId);
    }
  }, [loadSession, routeSessionId, selectedSessionId]);

  useEffect(() => {
    if (routeSessionId || selectedSessionId || sessionLoading || !sessions.length) return;
    const preferred = sessions.find((item) => ["draft", "in_progress", "pending_review", "rejected"].includes(String(item.status || ""))) || sessions[0];
    if (preferred?.id) {
      setSelectedSessionId(String(preferred.id));
      loadSession(preferred.id);
    }
  }, [loadSession, routeSessionId, selectedSessionId, sessionLoading, sessions]);

  useEffect(() => {
    const sessionState = String(session?.status || "");
    if (!session?.id || !lookupQuery.trim() || !isEditable) {
      if (!lookupQuery.trim()) setLookupResults([]);
      return;
    }
    const timer = window.setTimeout(() => {
      setLookupLoading(true);
      lookupEmployeePortalInventoryVariants(token, session.id, { query: lookupQuery, limit: 20 })
        .then((response) => {
          setLookupResults(Array.isArray(response?.items) ? response.items : []);
        })
        .catch((error) => {
          if (sessionState !== "pending_review" && sessionState !== "completed") {
            toast.error(error?.responseBody?.message || error?.message || "تعذر البحث");
          }
        })
        .finally(() => setLookupLoading(false));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [isEditable, isRejected, lookupQuery, session?.id, session?.status, token]);

  const visibleSessions = useMemo(() => {
    const query = clean(sessionSearch).toLowerCase();
    const filter = sessionFilters.find((item) => item.value === statusFilter) || sessionFilters[0];
    return sessions.filter((row) => {
      const status = String(row.status || "draft");
      if (filter.statuses && !filter.statuses.includes(status)) return false;
      if (!query) return true;
      return `${row.title || ""} ${row.branch_name || ""} ${row.warehouse_name || ""} ${status}`.toLowerCase().includes(query);
    });
  }, [sessionSearch, sessions, statusFilter]);

  const groupedItems = useMemo(() => groupVariants(items), [items]);
  const lookupGroups = useMemo(() => groupVariants(lookupResults), [lookupResults]);
  const differenceTotal = useMemo(() => items.reduce((sum, item) => sum + toNumber(item.difference_quantity, 0), 0), [items]);
  const expectedTotal = useMemo(() => items.reduce((sum, item) => sum + toNumber(item.system_quantity, 0), 0), [items]);
  const countedTotal = useMemo(() => items.reduce((sum, item) => sum + toNumber(item.counted_quantity, 0), 0), [items]);

  const refreshCurrentSession = useCallback(async () => {
    if (!selectedSessionId) return;
    await loadSession(selectedSessionId);
    await loadSessions();
  }, [loadSession, loadSessions, selectedSessionId]);

  const selectSession = useCallback((nextSessionId) => {
    setSelectedSessionId(String(nextSessionId));
    navigate(`/employee-portal/${encodeURIComponent(token)}/inventory/${encodeURIComponent(nextSessionId)}`);
    loadSession(nextSessionId);
  }, [loadSession, navigate, token]);

  const handleCreateSession = useCallback(async () => {
    try {
      setSessionSaving(true);
      const response = await createEmployeePortalInventorySession(token, {
        title: "جرد جديد",
        notes: "",
      });
      const created = response?.session || null;
      if (created?.id) {
        await loadSessions();
        navigate(`/employee-portal/${encodeURIComponent(token)}/inventory/${encodeURIComponent(created.id)}`);
        await loadSession(created.id);
        toast.success("تم إنشاء الجرد");
      }
    } catch (error) {
      toast.error(error?.responseBody?.message || error?.message || "تعذر إنشاء الجرد");
    } finally {
      setSessionSaving(false);
    }
  }, [loadSession, loadSessions, navigate, token]);

  const handleSaveSessionMeta = useCallback(async () => {
    if (!session?.id) return;
    try {
      setSessionSaving(true);
      const response = await updateEmployeePortalInventorySession(token, session.id, {
        title: titleDraft,
        notes: notesDraft,
      });
      if (response?.session) {
        setSession(response.session);
      }
      await loadSessions();
      toast.success("تم حفظ الجرد");
    } catch (error) {
      toast.error(error?.responseBody?.message || error?.message || "تعذر حفظ الجرد");
    } finally {
      setSessionSaving(false);
    }
  }, [loadSessions, notesDraft, session?.id, titleDraft, token]);

  const handleOpenSession = useCallback(async () => {
    if (!session?.id) return;
    try {
      setSessionOpening(true);
      const response = await openEmployeePortalInventorySession(token, session.id);
      if (response?.session) setSession(response.session);
      await refreshCurrentSession();
      toast.success("تم بدء الجرد");
    } catch (error) {
      toast.error(error?.responseBody?.message || error?.message || "تعذر بدء الجرد");
    } finally {
      setSessionOpening(false);
    }
  }, [refreshCurrentSession, session?.id, token]);

  const handleSubmitSession = useCallback(async () => {
    if (!session?.id) return;
    try {
      setSessionSubmitting(true);
      const response = await submitEmployeePortalInventorySession(token, session.id);
      if (response?.session) setSession(response.session);
      await refreshCurrentSession();
      toast.success("تم إرسال الجرد للمراجعة");
    } catch (error) {
      toast.error(error?.responseBody?.message || error?.message || "تعذر إرسال الجرد للمراجعة");
    } finally {
      setSessionSubmitting(false);
    }
  }, [refreshCurrentSession, session?.id, token]);

  const handleReopenSession = useCallback(async () => {
    if (!session?.id) return;
    try {
      setSessionReopening(true);
      const response = await reopenEmployeePortalInventorySession(token, session.id);
      if (response?.session) setSession(response.session);
      await refreshCurrentSession();
      toast.success("تم إعادة فتح الجرد للتعديل");
    } catch (error) {
      toast.error(error?.responseBody?.message || error?.message || "تعذر إعادة فتح الجرد");
    } finally {
      setSessionReopening(false);
    }
  }, [refreshCurrentSession, session?.id, token]);

  const saveItem = useCallback(async (variant, patch = {}) => {
    if (!session?.id || !isEditable) return;
    const productVariantId = variant.product_variant_id ?? variant.variant_id ?? variant.id;
    if (!productVariantId) return;
    try {
      setItemSavingId(String(productVariantId));
      const response = await upsertEmployeePortalInventoryItem(token, session.id, {
        productVariantId,
        countedQuantity: patch.countedQuantity ?? patch.counted_quantity ?? variant.counted_quantity,
        systemQuantity: patch.systemQuantity ?? patch.system_quantity ?? variant.system_quantity,
        reason: patch.reason ?? variant.reason ?? "",
        notes: patch.notes ?? variant.notes ?? "",
      });
      if (response?.item) {
        const saved = normalizeVariant(response.item);
        setItems((current) =>
          current.map((row) => {
            const currentId = String(row.product_variant_id ?? row.variant_id ?? row.id ?? "");
            const savedId = String(saved.product_variant_id ?? saved.variant_id ?? saved.id ?? "");
            if (currentId !== savedId) return row;
            const mergedImageUrl = resolveInventoryImageUrl(
              saved.image_url,
              saved.image,
              saved.product_image,
              saved.color_image,
              saved.variant_image,
              row.image_url,
              row.image,
              row.product_image,
              row.color_image,
              row.variant_image
            );
            return {
              ...row,
              ...saved,
              image_url: mergedImageUrl || row.image_url || saved.image_url || "",
              image: mergedImageUrl || row.image || saved.image || "",
              product_image: mergedImageUrl || row.product_image || saved.product_image || "",
              color_image: mergedImageUrl || row.color_image || saved.color_image || "",
              variant_image: mergedImageUrl || row.variant_image || saved.variant_image || "",
              images: mergedImageUrl ? [mergedImageUrl] : row.images || saved.images || [],
            };
          })
        );
      }
      if (response?.session) setSession(response.session);
    } catch (error) {
      toast.error(error?.responseBody?.message || error?.message || "تعذر حفظ القطعة");
    } finally {
      setItemSavingId("");
    }
  }, [isEditable, session?.id, token]);

  const addColorGroup = useCallback(async (group) => {
    if (!group?.variants?.length || !session?.id || !isEditable) return;
    try {
      setItemSavingId(group.key);
      for (const variant of group.variants) {
        const existing = items.find((row) => String(row.product_variant_id ?? row.variant_id ?? row.id ?? "") === String(variant.product_variant_id ?? variant.variant_id ?? variant.id ?? ""));
        await saveItem(variant, {
          countedQuantity: existing ? toNumber(existing.counted_quantity, 0) : 0,
          systemQuantity: variant.system_quantity,
        });
      }
      await refreshCurrentSession();
      toast.success("تمت إضافة اللون للجرد");
    } catch (error) {
      toast.error(error?.responseBody?.message || error?.message || "تعذر إضافة اللون");
    } finally {
      setItemSavingId("");
    }
  }, [isEditable, items, refreshCurrentSession, saveItem, session?.id]);

  const findColorGroupForVariant = useCallback((variant, records = []) => {
    const productId = variant?.product_id ?? null;
    const colorKey = normalizeColorKey(variant?.color ?? "");
    if (!productId || !colorKey) return null;
    return groupVariants(records).find((entry) => String(entry.product_id ?? "") === String(productId) && normalizeColorKey(entry.color || "") === colorKey) || null;
  }, []);

  const handleScan = useCallback(async (value) => {
    setScannerOpen(false);
    const query = clean(value);
    setLookupQuery(query);
    if (!session?.id || !query || !isEditable) return;
    try {
      setLookupLoading(true);
      const response = await lookupEmployeePortalInventoryVariants(token, session.id, { query, limit: 20 });
      const results = Array.isArray(response?.items) ? response.items : [];
      setLookupResults(results);
      const normalizedResults = results.map((variant) => normalizeVariant(variant));
      const exact = normalizedResults.find((variant) => isExactVariantMatch(query, variant));
      if (exact) {
        const group = findColorGroupForVariant(exact, normalizedResults);
        if (group) {
          await addColorGroup(group);
        }
        const existing = items.find((row) => String(row.product_variant_id ?? row.variant_id ?? row.id ?? "") === String(exact.product_variant_id ?? exact.variant_id ?? exact.id ?? ""));
        await saveItem(exact, { countedQuantity: toNumber(existing?.counted_quantity, 0) + 1, systemQuantity: exact.system_quantity });
        toast.success(`تم عد قطعة من مقاس ${exact.size || exact.sku || ""}`.trim());
      }
    } catch (error) {
      toast.error(error?.responseBody?.message || error?.message || "تعذر قراءة الباركود");
    } finally {
      setLookupLoading(false);
    }
  }, [addColorGroup, findColorGroupForVariant, items, saveItem, session?.id, token]);

  const handleVariantCountChange = (variantId, value) => {
    if (!isEditable) return;
    const parsed = Number(value || 0);
    setItems((current) =>
      current.map((row) => {
        const currentId = String(row.product_variant_id ?? row.variant_id ?? row.id ?? "");
        if (currentId !== String(variantId)) return row;
        const difference_quantity = parsed - toNumber(row.system_quantity, 0);
        return {
          ...row,
          counted_quantity: parsed,
          actual_qty: parsed,
          difference_quantity,
          difference_qty: difference_quantity,
        };
      })
    );
  };

  const adjustVariantCount = useCallback(async (variant, delta) => {
    if (!isEditable) return;
    const variantId = String(variant.product_variant_id ?? variant.variant_id ?? variant.id ?? "");
    if (!variantId) return;
    const currentValue = toNumber(variant.counted_quantity, 0);
    const nextValue = Math.max(0, currentValue + Number(delta || 0));
    handleVariantCountChange(variantId, nextValue);
    await saveItem(variant, { countedQuantity: nextValue, systemQuantity: variant.system_quantity });
  }, [handleVariantCountChange, isEditable, saveItem]);

  const handleDeleteColorGroup = useCallback(async (group) => {
    if (!session?.id || !isEditable) return;
    const productId = group?.product_id ?? group?.variants?.[0]?.product_id ?? null;
    const color = clean(group?.color || "");
    if (!productId || !color) {
      toast.error("تعذر تحديد اللون للحذف");
      return;
    }
    const confirmed = window.confirm("هل تريد حذف هذا اللون من الجرد؟");
    if (!confirmed) return;
    try {
      setItemSavingId(String(group.key || productId));
      const response = await deleteEmployeePortalInventoryColorGroup(token, session.id, {
        productId,
        color,
      });
      if (response?.session) {
        setSession(response.session);
      }
      if (Array.isArray(response?.items)) {
        setItems(response.items);
      }
      await refreshCurrentSession();
      toast.success("تم حذف اللون من الجرد");
    } catch (error) {
      toast.error(error?.responseBody?.message || error?.message || "تعذر حذف اللون");
    } finally {
      setItemSavingId("");
    }
  }, [isEditable, refreshCurrentSession, session?.id, token]);

  const currentBalance = differenceTotal === 0
    ? "متوازن"
    : differenceTotal > 0
      ? `زيادة: ${Math.abs(differenceTotal)}`
      : `عجز: ${Math.abs(differenceTotal)}`;

  return (
    <div dir="rtl" className="employee-portal-inventory min-h-screen bg-[radial-gradient(circle_at_top,_rgba(16,185,129,0.10),_transparent_28%),linear-gradient(180deg,#f8fafc_0%,#eef2ff_100%)] px-3 py-3 text-slate-950 sm:px-4 sm:py-4">
      <style>{`
        .employee-portal-inventory {
          width: 100%;
          max-width: 100vw;
          overflow-x: hidden;
          overscroll-behavior-x: contain;
          -webkit-text-size-adjust: 100%;
          touch-action: manipulation;
        }
        .employee-portal-inventory,
        .employee-portal-inventory * {
          box-sizing: border-box;
        }
        .employee-portal-inventory input,
        .employee-portal-inventory select,
        .employee-portal-inventory textarea {
          font-size: 16px !important;
          max-width: 100%;
        }
        .employee-portal-inventory button {
          min-width: 0;
          max-width: 100%;
        }
        .employee-portal-inventory .inventory-wrap {
          min-width: 0;
          max-width: 100%;
        }
        .employee-portal-inventory .inventory-actions {
          flex-wrap: wrap;
        }
        .employee-portal-inventory .inventory-actions > * {
          min-width: 0;
          max-width: 100%;
          flex: 1 1 140px;
        }
        .employee-portal-inventory .inventory-title,
        .employee-portal-inventory .inventory-meta,
        .employee-portal-inventory .inventory-product-title,
        .employee-portal-inventory .inventory-item-main {
          min-width: 0;
          max-width: 100%;
          overflow-wrap: anywhere;
          word-break: break-word;
        }
        .employee-portal-inventory .inventory-grid-columns {
          grid-template-columns: minmax(0, 1fr) 110px 90px;
        }
        @media (max-width: 640px) {
          .employee-portal-inventory {
            padding-left: 12px;
            padding-right: 12px;
          }
          .employee-portal-inventory .inventory-actions > * {
            flex: 1 1 100%;
          }
          .employee-portal-inventory .inventory-grid-columns {
            grid-template-columns: minmax(0, 1fr);
          }
        }
      `}</style>
      <div className="inventory-wrap mx-auto flex w-full max-w-6xl flex-col gap-4">
        <EmployeePortalNavControls
          onBack={() => {
            if (canNavigateEmployeePortalBack()) navigate(-1);
            else navigate(buildEmployeePortalHomePath({ pathname: window.location.pathname, token }), { replace: true });
          }}
          onHome={() => navigate(buildEmployeePortalHomePath({ pathname: window.location.pathname, token }))}
          tone="light"
          className="px-0"
        />

        <section className="rounded-[2rem] border border-white/70 bg-white/95 p-4 shadow-2xl shadow-slate-200/60 backdrop-blur">
          <div className="inventory-wrap flex min-w-0 flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="flex items-center gap-2 text-emerald-700">
                <Warehouse className="h-5 w-5" />
                <span className="text-xs font-black uppercase tracking-[0.18em]">Employee Portal</span>
              </div>
              <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950">الجرد</h1>
              <p className="mt-1 max-w-3xl text-sm font-semibold leading-6 text-slate-500">
                أمين المخزن ينشئ الجرد ويعد الكميات ويرسله للمراجعة فقط. لا يظهر اعتماد نهائي هنا.
              </p>
            </div>
            <div className="inventory-actions flex min-w-0 gap-2">
              <button
                type="button"
                onClick={loadSessions}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-black text-slate-700"
              >
                <RefreshCw className="h-4 w-4" />
                تحديث
              </button>
              <button
                type="button"
                onClick={handleCreateSession}
                disabled={sessionSaving}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 text-sm font-black text-white disabled:opacity-60"
              >
                {sessionSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                جرد جديد
              </button>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {sessionFilters.map((filter) => (
              <button
                key={filter.value}
                type="button"
                onClick={() => setStatusFilter(filter.value)}
                className={`rounded-full border px-4 py-2 text-sm font-black transition ${
                  statusFilter === filter.value
                    ? "border-emerald-500 bg-emerald-500 text-white"
                    : "border-slate-200 bg-white text-slate-600"
                }`}
              >
                {filter.label}
              </button>
            ))}
          </div>
        </section>

        <div className="grid min-w-0 gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="inventory-wrap rounded-[2rem] border border-white/70 bg-white/95 p-4 shadow-2xl shadow-slate-200/60 backdrop-blur">
            <div className="flex min-w-0 items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-lg font-black text-slate-950">جردات الفرع</h2>
                <p className="text-xs font-semibold text-slate-500">المسودة، قيد التنفيذ، المراجعة والمرفوضة.</p>
              </div>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-700">{visibleSessions.length}</span>
            </div>
            <label className="inventory-wrap mt-3 block rounded-2xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
              <div className="flex items-center gap-2 text-xs font-black text-slate-400">
                <Search className="h-4 w-4" />
                بحث
              </div>
              <input
                value={sessionSearch}
                onChange={(event) => setSessionSearch(event.target.value)}
                placeholder="ابحث باسم الجرد أو الفرع"
                className="mt-1 w-full bg-transparent text-base font-semibold text-slate-950 outline-none placeholder:text-slate-400"
              />
            </label>

            <div className="mt-4 space-y-2">
              {sessionsLoading ? (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm font-bold text-slate-500">جاري التحميل...</div>
              ) : sessionsError ? (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold leading-6 text-rose-700">{sessionsError}</div>
              ) : visibleSessions.length ? (
                visibleSessions.map((row) => {
                  const active = String(row.id) === String(selectedSessionId);
                  const status = String(row.status || "draft");
                  return (
                    <button
                      key={row.id}
                      type="button"
                      onClick={() => selectSession(row.id)}
                      className={`w-full rounded-2xl border p-3 text-right transition ${
                        active ? "border-emerald-500 bg-emerald-50 shadow-sm" : "border-slate-200 bg-white hover:bg-slate-50"
                      }`}
                    >
              <div className="flex min-w-0 items-start justify-between gap-3">
                <div className="min-w-0">
                          <div className="truncate text-sm font-black text-slate-950">{row.title || "جرد جديد"}</div>
                          <div className="mt-1 text-xs font-semibold text-slate-500">
                            {row.branch_name || "الفرع"}{row.warehouse_name ? ` • ${row.warehouse_name}` : ""}
                          </div>
                        </div>
                        <span className={`rounded-full border px-2.5 py-1 text-[11px] font-black ${sessionStatusTone[status] || sessionStatusTone.draft}`}>
                          {sessionStatusLabels[status] || status}
                        </span>
                      </div>
                    </button>
                  );
                })
              ) : (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm font-bold leading-6 text-slate-500">
                  لا توجد جردات مطابقة لهذا الفلتر.
                </div>
              )}
            </div>
          </aside>

          <main className="inventory-wrap rounded-[2rem] border border-white/70 bg-white/95 p-4 shadow-2xl shadow-slate-200/60 backdrop-blur">
            {!session && sessionLoading ? (
              <div className="flex min-h-[420px] items-center justify-center gap-2 text-sm font-black text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                جاري تحميل الجرد...
              </div>
            ) : !session ? (
              <div className="flex min-h-[420px] flex-col items-center justify-center rounded-[1.5rem] border border-dashed border-slate-300 bg-slate-50 px-6 text-center">
                <ClipboardList className="h-12 w-12 text-slate-300" />
                <h2 className="mt-4 text-xl font-black text-slate-950">اختر جردًا أو أنشئ جردًا جديدًا</h2>
                <p className="mt-2 max-w-lg text-sm font-semibold leading-6 text-slate-500">
                  الجردات هنا تخص فرعك فقط، والجرد المكتمل لا يظهر إلا عند اختيار فلتر المكتملة.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="inventory-wrap flex min-w-0 flex-col gap-3 rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <h2 className="text-2xl font-black text-slate-950">{titleDraft || session.title || "جرد جديد"}</h2>
                      <span className={`rounded-full border px-2.5 py-1 text-[11px] font-black ${sessionStatusTone[session.status] || sessionStatusTone.draft}`}>
                        {sessionStatusLabels[session.status] || session.status}
                      </span>
                    </div>
                    <div className="mt-1 text-sm font-semibold text-slate-500">
                      {session.branch_name || "الفرع"}{session.warehouse_name ? ` • ${session.warehouse_name}` : ""}
                    </div>
                  </div>
                  <div className="inventory-actions flex min-w-0 gap-2">
                    {session.status === "draft" ? (
                      <button
                        type="button"
                        onClick={handleOpenSession}
                        disabled={sessionOpening}
                        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-black text-slate-700 disabled:opacity-60"
                      >
                        {sessionOpening ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardList className="h-4 w-4" />}
                        بدء الجرد
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={handleSaveSessionMeta}
                      disabled={sessionSaving || !isEditable}
                      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-black text-slate-700 disabled:opacity-60"
                    >
                      <Save className="h-4 w-4" />
                      حفظ
                    </button>
                    <button
                      type="button"
                      onClick={handleSubmitSession}
                      disabled={sessionSubmitting || !isEditable}
                      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 text-sm font-black text-white disabled:opacity-60"
                    >
                      {sessionSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                      إرسال للمراجعة
                    </button>
                  </div>
                </div>

                {isPendingReview ? (
                  <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm font-black text-sky-700">
                    تم إرسال الجرد للمراجعة
                  </div>
                ) : null}

                {isRejected ? (
                  <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold leading-6 text-rose-800">
                    <div className="font-black">سبب الرفض</div>
                    <div className="mt-1">{clean(session.rejection_reason || session.rejectionReason || "") || "لم يتم ذكر سبب."}</div>
                    <button
                      type="button"
                      onClick={handleReopenSession}
                      disabled={sessionReopening}
                      className="mt-3 inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-rose-600 px-4 text-sm font-black text-white disabled:opacity-60"
                    >
                      {sessionReopening ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                      إعادة فتح للتعديل
                    </button>
                  </div>
                ) : null}

                <div className="grid min-w-0 gap-3 lg:grid-cols-[1fr_1fr]">
                  <label className="inventory-wrap block rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                    <div className="text-xs font-black text-slate-400">اسم الجرد</div>
                    <input
                      value={titleDraft}
                      onChange={(event) => setTitleDraft(event.target.value)}
                      disabled={!isEditable}
                      className="mt-2 w-full bg-transparent text-base font-semibold text-slate-950 outline-none disabled:opacity-70"
                    />
                  </label>
                  <label className="inventory-wrap block rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                    <div className="text-xs font-black text-slate-400">ملاحظات</div>
                    <input
                      value={notesDraft}
                      onChange={(event) => setNotesDraft(event.target.value)}
                      disabled={!isEditable}
                      className="mt-2 w-full bg-transparent text-base font-semibold text-slate-950 outline-none disabled:opacity-70"
                    />
                  </label>
                </div>

                <section className="rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div className="inventory-wrap">
                      <h3 className="text-lg font-black text-slate-950">البحث والباركود</h3>
                      <p className="text-xs font-semibold text-slate-500">ابحث عن المنتج أو امسح الباركود لإضافة الكمية.</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setScannerOpen(true)}
                      disabled={!isEditable}
                      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-black text-slate-700 disabled:opacity-60"
                    >
                      <ScanBarcode className="h-4 w-4" />
                      سكان
                    </button>
                  </div>
                  <label className="inventory-search mt-3 flex min-w-0 items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                    <Search className="h-4 w-4 shrink-0 text-slate-400" />
                    <input
                      value={lookupQuery}
                      onChange={(event) => setLookupQuery(event.target.value)}
                      disabled={!isEditable}
                      placeholder="ابحث بالاسم أو الباركود"
                      className="w-full bg-transparent text-base font-semibold text-slate-950 outline-none placeholder:text-slate-400 disabled:opacity-70"
                    />
                  </label>
                  {lookupLoading ? (
                    <div className="mt-3 flex items-center gap-2 text-sm font-black text-slate-500">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      جاري البحث...
                    </div>
                  ) : null}
                  {lookupGroups.length ? (
                    <div className="mt-3 grid min-w-0 gap-3 md:grid-cols-2">
                      {lookupGroups.map((group) => (
                        <div key={group.key} className="inventory-wrap rounded-2xl border border-slate-200 bg-white p-3">
                          <div className="flex min-w-0 items-start gap-3">
                            <div className="h-16 w-16 shrink-0 overflow-hidden rounded-2xl border border-slate-200 bg-slate-100">
                              <InventoryImage src={resolveCardImage(group)} alt={group.product_name || "منتج"} />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-sm font-black text-slate-950">{group.product_name || "منتج"}</div>
                              <div className="mt-1 text-xs font-semibold text-slate-500">
                                {group.color || "لون غير محدد"} • {group.variants.length} قطع
                              </div>
                              <button
                                type="button"
                                onClick={() => addColorGroup(group)}
                                disabled={!isEditable}
                                className="mt-3 inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-3 text-xs font-black text-white disabled:opacity-60"
                              >
                                <Plus className="h-4 w-4" />
                                إضافة اللون
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </section>

                <section className="inventory-wrap rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex min-w-0 items-start justify-between gap-3">
                    <div className="inventory-title">
                      <h3 className="text-lg font-black text-slate-950">عناصر الجرد</h3>
                      <p className="text-xs font-semibold text-slate-500">
                        المتوقع: {expectedTotal} • الفعلي: {countedTotal} • الفرق: {currentBalance}
                      </p>
                    </div>
                    <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-black text-slate-600">
                      {groupedItems.length} لون
                    </div>
                  </div>

                  <div className="mt-4 space-y-3">
                    {groupedItems.length ? groupedItems.map((group) => (
                      <div key={group.key} className="inventory-wrap rounded-2xl border border-slate-200 bg-slate-50 p-3">
                        <div className="flex min-w-0 items-start gap-3">
                          <div className="h-16 w-16 shrink-0 overflow-hidden rounded-2xl border border-slate-200 bg-slate-100">
                            <InventoryImage src={resolveCardImage(group)} alt={group.product_name || "منتج"} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex min-w-0 items-start justify-between gap-2">
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-sm font-black text-slate-950">{group.product_name || "منتج"}</div>
                                <div className="mt-1 text-xs font-semibold text-slate-500">
                                  المتوقع {group.system_total} • الفعلي {group.counted_total}
                                </div>
                              </div>
                              <div className="flex shrink-0 items-center gap-2">
                                <span className="inline-flex max-w-[110px] items-center rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-black text-slate-600">
                                  <span className="truncate">{group.color || "لون غير محدد"}</span>
                                </span>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteColorGroup(group)}
                                  disabled={!isEditable || itemSavingId === group.key}
                                  className="inline-flex h-8 items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2.5 text-[11px] font-black text-rose-700 disabled:opacity-60"
                                  aria-label="حذف اللون"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                  <span className="hidden sm:inline">حذف اللون</span>
                                </button>
                              </div>
                            </div>
                            <div className="mt-2 text-xs font-black text-slate-500">
                              {group.difference_total === 0 ? "متوازن" : group.difference_total > 0 ? `زيادة ${group.difference_total}` : `عجز ${Math.abs(group.difference_total)}`}
                            </div>
                          </div>
                        </div>
                        <div className="mt-3 space-y-2">
                          {group.variants.map((variant) => {
                            const variantId = String(variant.product_variant_id ?? variant.variant_id ?? variant.id ?? "");
                            const saving = itemSavingId === variantId;
                            return (
                              <div key={variantId} className="inventory-item min-w-0 rounded-2xl border border-white/80 bg-white p-3">
                                <div className="flex min-w-0 items-start gap-3">
                                  <div className="h-12 w-12 shrink-0 overflow-hidden rounded-2xl border border-slate-200 bg-slate-100">
                                    <InventoryImage src={resolveCardImage(variant)} alt={`${group.product_name || "منتج"} ${variant.color || ""}`} />
                                  </div>
                                  <div className="inventory-item-main min-w-0 flex-1">
                                    <div className="truncate text-sm font-black text-slate-950">{variant.size || variant.sku || "مقاس غير محدد"}</div>
                                    <div className="mt-1 text-xs font-semibold text-slate-500">
                                      {variant.sku ? `SKU: ${variant.sku}` : variant.barcode ? `Barcode: ${variant.barcode}` : "بدون SKU"}
                                    </div>
                                  </div>
                                  <div className="text-left text-xs font-black">
                                    <span className={variant.difference_quantity === 0 ? "text-emerald-700" : variant.difference_quantity > 0 ? "text-amber-700" : "text-rose-700"}>
                                      {variant.difference_quantity === 0 ? "متوازن" : variant.difference_quantity > 0 ? `زيادة ${variant.difference_quantity}` : `عجز ${Math.abs(variant.difference_quantity)}`}
                                    </span>
                                  </div>
                                </div>
                                <div className="mt-3 grid grid-cols-[56px_minmax(0,1fr)_56px] gap-2">
                                  <button
                                    type="button"
                                    onClick={() => adjustVariantCount(variant, -1)}
                                    disabled={!isEditable || saving}
                                    className="inline-flex h-14 items-center justify-center rounded-2xl border border-slate-200 bg-white text-2xl font-black text-slate-700 disabled:opacity-50"
                                    aria-label="إنقاص الكمية"
                                  >
                                    -
                                  </button>
                                  <input
                                    type="text"
                                    readOnly
                                    inputMode="numeric"
                                    value={variant.counted_quantity}
                                    className="h-14 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 text-center text-base font-black text-slate-950 outline-none"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => adjustVariantCount(variant, 1)}
                                    disabled={!isEditable || saving}
                                    className="inline-flex h-14 items-center justify-center rounded-2xl bg-emerald-600 text-2xl font-black text-white disabled:opacity-50"
                                    aria-label="زيادة الكمية"
                                  >
                                    +
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )) : (
                      <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm font-bold leading-6 text-slate-500">
                        لا توجد عناصر بعد. ابحث عن منتج أو امسح الباركود لبدء الجرد.
                      </div>
                    )}
                  </div>
                </section>
              </div>
            )}
          </main>
        </div>
      </div>

      {scannerOpen ? <ScannerModal onClose={() => setScannerOpen(false)} onScan={handleScan} /> : null}
    </div>
  );
}
