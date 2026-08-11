import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Filter,
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
import { productMatchesAudience } from "../../../shared/lib/productAudiences";
import EmployeePortalNavControls, { buildEmployeePortalHomePath, canNavigateEmployeePortalBack } from "../components/EmployeePortalNavControls";
import SmartPosFilters from "../../pos/components/SmartPosFilters";
import { normalizePosCatalogProduct, normalizePosSellableProducts } from "../../pos/services/posProductsApi";
import { getEmployeePortalFacets } from "../services/employeePortalProductsApi";
import {
  saveInventoryDraft,
  loadInventoryDraft,
  clearInventoryDraft,
  reconcileInventoryRows,
  sweepExpiredDrafts,
} from "../services/employeeDrafts/employeeDraftStore.js";
import usePageTitle from "../../../shared/hooks/usePageTitle";
import "./EmployeePortalWorkspaces.m1.css";
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

// Map the server identity block (snake_case) to the draft store's camelCase
// identity used to build the token-free namespace key.
const toDraftIdentity = (identity = {}) => ({
  tenantId: identity.tenant_id ?? identity.tenantId ?? null,
  employeeId: identity.employee_id ?? identity.employeeId ?? null,
  branchId: identity.branch_id ?? identity.branchId ?? null,
});

const clean = (value = "") => String(value || "").trim();
const lower = (value = "") => clean(value).toLowerCase();
const uniqueTextValues = (values = []) => [...new Set(values.map((value) => clean(value)).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ar"));
const sortSizes = (sizes = []) => [...sizes].sort((a, b) => {
  const left = Number(a);
  const right = Number(b);
  if (Number.isFinite(left) && Number.isFinite(right)) return left - right;
  return String(a).localeCompare(String(b), "ar");
});
const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const isDevEnvironment = typeof import.meta !== "undefined" && import.meta.env?.DEV;
const logDevDuration = (label, startedAt, payload = {}) => {
  if (!isDevEnvironment) return;
  const durationMs = Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt);
  console.debug(`[employee-portal-inventory] ${label}`, { durationMs, ...payload });
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
  pending_review: "border-primary/30 bg-primary-subtle text-primary",
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

const buildCatalogParams = () => ({
  limit: 120,
  inStockOnly: 1,
});

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
  const articleCode = clean(record.article_code ?? record.variant_article_code ?? record.product_article_code ?? "");
  const gender = clean(record.gender ?? record.product_gender ?? record.product?.gender ?? "");
  const type = clean(record.type ?? record.product_type ?? record.product?.type ?? "");
  const category = clean(record.category ?? record.category_name ?? record.grade ?? record.product?.category ?? "");
  const brand = clean(record.brand ?? record.brand_name ?? record.product?.brand ?? "");
  const manufacturer_name = clean(record.manufacturer_name ?? record.manufacturer ?? record.product?.manufacturer_name ?? record.product?.manufacturer ?? "");
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
    gender,
    type,
    category,
    brand,
    manufacturer_name,
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

const normalizeInventoryFilterRecord = (record = {}) => {
  const normalizedProduct = normalizePosCatalogProduct(record.product || record);
  const normalizedVariant = normalizeVariant({
    ...normalizedProduct,
    ...record,
    product: record.product || normalizedProduct,
  });

  return {
    ...normalizedVariant,
    category: clean(normalizedProduct.category || normalizedProduct.category_name || record.category || record.grade || normalizedVariant.category),
    type: clean(normalizedProduct.type || normalizedProduct.product_type || normalizedProduct.productType || record.type || record.product_type || record.productType || normalizedVariant.type),
    brand: clean(normalizedProduct.brand || normalizedProduct.brand_name || record.brand || record.brand_name || normalizedVariant.brand),
    manufacturer_name: clean(
      normalizedProduct.manufacturer_name ||
      normalizedProduct.manufacturer ||
      record.manufacturer_name ||
      record.manufacturer ||
      record.manufacturerName ||
      normalizedVariant.manufacturer_name
    ),
    gender: clean(normalizedProduct.gender || record.gender || normalizedVariant.gender),
  };
};

const normalizeInventoryCatalog = (payload = []) =>
  normalizePosSellableProducts(Array.isArray(payload) ? payload : [])
    .map((product) => normalizePosCatalogProduct(product));

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
        article_code: variant.article_code,
        category: variant.category,
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
    if (!group.article_code && variant.article_code) group.article_code = variant.article_code;
    if (!group.category && variant.category) group.category = variant.category;
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
  const [manualValue, setManualValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [scannerMessage, setScannerMessage] = useState("");
  const lastResolvedScanRef = useRef({ value: "", at: 0 });
  const manualInputRef = useRef(null);

  const submitScan = useCallback(async (value) => {
    const query = clean(value);
    if (!query || submitting) return;
    const now = Date.now();
    if (lastResolvedScanRef.current.value === query && now - lastResolvedScanRef.current.at < 1500) {
      return;
    }
    setSubmitting(true);
    try {
      const resolved = await onScan(query);
      if (resolved) {
        lastResolvedScanRef.current = { value: query, at: Date.now() };
        setManualValue("");
        onClose();
      }
    } finally {
      setSubmitting(false);
    }
  }, [onClose, onScan, submitting]);

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
              onScan={submitScan}
              onPermissionDenied={(message) => {
                setScannerMessage(message || "تم رفض إذن الكاميرا");
                toast.error(message || "تم رفض إذن الكاميرا");
              }}
              onUnsupported={(message) => {
                setScannerMessage(message || "الكاميرا أو المتصفح لا يدعم الماسح");
                toast.error(message || "الكاميرا أو المتصفح لا يدعم الماسح");
              }}
              onError={(message) => {
                setScannerMessage(message || "تعذر تشغيل ماسح الكاميرا");
                toast.error(message || "تعذر تشغيل ماسح الكاميرا");
              }}
              className="overflow-hidden rounded-[1.35rem] bg-black"
              scannerClassName="min-h-[320px] w-full"
              detectorFormats={["code_128", "ean_13", "ean_8", "upc_a", "upc_e", "qr_code"]}
              html5Fps={25}
              html5Qrbox={{ width: 320, height: 140 }}
              html5AspectRatio={2.2857142857}
              videoConstraints={{
                width: { ideal: 1280 },
                height: { ideal: 720 },
                facingMode: { ideal: "environment" },
                advanced: [{ focusMode: "continuous" }, { exposureMode: "continuous" }],
              }}
              logPrefix="INVENTORY_CAMERA"
              frameHint="قرّب الباركود داخل المستطيل فقط"
              statusPrimary="جاري القراءة..."
              statusSecondary="استخدم إدخال يدوي لو القراءة تأخرت"
              overlayFrameWidthPercent={85}
              overlayFrameHeight={140}
            />
          </div>
          <div className="mt-4 rounded-3xl border border-white/10 bg-white/[0.04] p-3 text-white">
            <button
              type="button"
              onClick={() => manualInputRef.current?.focus()}
              className="text-xs font-black text-emerald-200"
            >
              اكتب الباركود يدويًا
            </button>
            <div className="mt-1 text-[11px] font-semibold text-zinc-400">أدخل الباركود يدويًا ثم اضغط بحث أو Enter</div>
            <div className="mt-2 flex gap-2">
              <input
                ref={manualInputRef}
                value={manualValue}
                onChange={(event) => setManualValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    submitScan(manualValue);
                  }
                }}
                placeholder="أدخل الباركود يدويًا"
                className="h-11 flex-1 rounded-2xl border border-white/10 bg-black/40 px-3 text-sm font-semibold text-white outline-none placeholder:text-zinc-500"
              />
              <button
                type="button"
                onClick={() => submitScan(manualValue)}
                disabled={!clean(manualValue) || submitting}
                className="inline-flex h-11 items-center justify-center rounded-2xl bg-emerald-400 px-4 text-sm font-black text-zinc-950 disabled:opacity-50"
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "بحث"}
              </button>
            </div>
            {scannerMessage ? <div className="mt-2 text-xs font-semibold text-amber-200">{scannerMessage}</div> : null}
          </div>
        </div>
      </section>
    </div>,
    document.body
  );
}

export default function EmployeePortalInventory() {
  const { token, sessionId: routeSessionId } = useParams();
  const [searchParams] = useSearchParams();
  usePageTitle(routeSessionId ? "Inventory Count Session" : "Employee Inventory Count");
  const navigate = useNavigate();
  const [sessions, setSessions] = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState("");
  const [selectedSessionId, setSelectedSessionId] = useState(routeSessionId || "");
  const [session, setSession] = useState(null);
  const [items, setItems] = useState([]);
  // Token-free identity {tenant_id, employee_id, branch_id} for the local draft
  // namespace (server-supplied; never the portal token). editedAtRef stamps the
  // local edit time per variant so a locally-counted row wins reconciliation.
  const [draftIdentity, setDraftIdentity] = useState(null);
  const editedAtRef = useRef(new Map());
  const [sessionLoading, setSessionLoading] = useState(false);
  const [sessionSaving, setSessionSaving] = useState(false);
  const [sessionOpening, setSessionOpening] = useState(false);
  const [sessionSubmitting, setSessionSubmitting] = useState(false);
  const [sessionReopening, setSessionReopening] = useState(false);
  const [itemSavingId, setItemSavingId] = useState("");
  const [catalogProducts, setCatalogProducts] = useState([]);
  const [facets, setFacets] = useState({ categories: [], types: [], brands: [], manufacturers: [], genders: [], grades: [], sizes: [] });
  const [lookupQuery, setLookupQuery] = useState("");
  const [lookupResults, setLookupResults] = useState([]);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState("active");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState({
    category: "all",
    type: "all",
    brand: "all",
    manufacturer: "all",
    gender: "all",
    inStockOnly: true,
  });
  const [selectedFilterSize, setSelectedFilterSize] = useState("all");
  const [sessionSearch, setSessionSearch] = useState("");
  const [titleDraft, setTitleDraft] = useState("");
  const [notesDraft, setNotesDraft] = useState("");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [branchDrawerOpen, setBranchDrawerOpen] = useState(false);
  const itemsRef = useRef(items);
  const itemSaveTimersRef = useRef(new Map());
  const itemSavePatchRef = useRef(new Map());
  const itemSavingIdRef = useRef("");
  const lookupInputRef = useRef(null);
  const filtersPanelRef = useRef(null);
  const taskLaunchHandledRef = useRef(false);
  const taskAutoAddHandledRef = useRef(false);

  const isEditable = ["draft", "in_progress"].includes(String(session?.status || ""));
  const isRejected = String(session?.status || "") === "rejected";
  const isPendingReview = String(session?.status || "") === "pending_review";

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    itemSavingIdRef.current = itemSavingId;
  }, [itemSavingId]);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        // Tiny facets endpoint (brands/types/genders/grades/categories/
        // manufacturers/sizes) instead of the heavy limit=120 product catalog
        // that was downloaded only to populate the filter dropdowns.
        const response = await getEmployeePortalFacets(token);
        if (cancelled) return;
        setFacets(response?.facets || { categories: [], types: [], brands: [], manufacturers: [], genders: [], grades: [], sizes: [] });
      } catch (error) {
        if (cancelled) return;
        console.warn("[employee-portal-inventory] facets load failed", error);
      }
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [token]);

  useEffect(
    () => () => {
      itemSaveTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      itemSaveTimersRef.current.clear();
      itemSavePatchRef.current.clear();
    },
    []
  );

  const loadSessions = useCallback(async () => {
    try {
      setSessionsLoading(true);
      setSessionsError("");
      const response = await listEmployeePortalInventorySessions(token, { limit: 100, page: 1 });
      if (response?.identity) setDraftIdentity(toDraftIdentity(response.identity));
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
    setSessionLoading(true);
    let response = null;
    let serverOk = false;
    try {
      response = await getEmployeePortalInventorySession(token, sessionId);
      serverOk = true;
    } catch (error) {
      // Offline / server error — fall back to the local working draft below so
      // the employee never loses their in-progress count.
      response = null;
    }
    try {
      const identity = response?.identity ? toDraftIdentity(response.identity) : null;
      if (identity) setDraftIdentity(identity);
      const draftId = { ...(identity || draftIdentity || {}), sessionId };
      // Working draft is a fast starting point only; the server stays
      // authoritative. Read is fail-safe (null on any cache error).
      const draft = await loadInventoryDraft(draftId);
      const draftRows = Array.isArray(draft?.rows) ? draft.rows : [];

      if (serverOk) {
        const nextSession = response?.session || null;
        const serverItems = Array.isArray(response?.items) ? response.items : [];
        setSession(nextSession);
        if (draftRows.length) {
          // Overlay locally-counted quantities onto the authoritative server
          // rows (server owns system_quantity + which variants exist). Only
          // rows the employee actually edited on this device win.
          const localRows = draftRows.filter((row) => Number(row.local_updated_at) > 0);
          const merged = reconcileInventoryRows({ localRows, serverRows: serverItems })
            .map((row) => {
              const system = toNumber(row.system_quantity, 0);
              const counted = toNumber(row.counted_quantity, 0);
              const difference_quantity = counted - system;
              return { ...row, difference_quantity, difference_qty: difference_quantity };
            });
          setItems(merged);
        } else {
          setItems(serverItems);
        }
        setTitleDraft(nextSession?.title || "");
        setNotesDraft(nextSession?.notes || "");
        setSelectedSessionId(String(nextSession?.id || sessionId));
      } else if (draftRows.length) {
        // Offline: render the local draft immediately; server state reconciles
        // on the next successful load.
        setItems(draftRows);
        setSelectedSessionId(String(sessionId));
        toast("وضع دون اتصال — تم استرجاع مسودة الجرد المحفوظة محليًا", { icon: "📴" });
      } else {
        toast.error("تعذر تحميل الجرد");
      }
    } catch (error) {
      toast.error(error?.responseBody?.message || error?.message || "تعذر تحميل الجرد");
    } finally {
      setSessionLoading(false);
    }
  }, [token, draftIdentity]);

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

  // ---- Local working-draft persistence (IndexedDB, token-free namespace) ----
  // Opportunistic expiry sweep on mount.
  useEffect(() => { sweepExpiredDrafts(); }, []);

  // Persist the working count draft after edits. Debounced + async inside the
  // store — never blocks the quantity input. Server stays authoritative.
  useEffect(() => {
    if (!session?.id || !isEditable) return;
    const identity = { ...(draftIdentity || {}), sessionId: session.id };
    const rows = items.map((row) => {
      const vid = String(row.product_variant_id ?? row.variant_id ?? row.id ?? "");
      return {
        product_id: row.product_id ?? null,
        product_variant_id: row.product_variant_id ?? row.variant_id ?? row.id ?? null,
        variant_id: row.variant_id ?? row.product_variant_id ?? row.id ?? null,
        color: row.color ?? "",
        size: row.size ?? "",
        sku: row.sku ?? "",
        barcode: row.barcode ?? "",
        product_name: row.product_name ?? "",
        image_url: row.image_url ?? row.image ?? "",
        system_quantity: row.system_quantity ?? 0,
        counted_quantity: row.counted_quantity ?? 0,
        difference_quantity: row.difference_quantity ?? 0,
        // Preserve a prior-session edit marker (survives reload via the draft)
        // or stamp this session's edit; untouched rows stay 0 so the server wins.
        local_updated_at: editedAtRef.current.get(vid) || Number(row.local_updated_at) || 0,
      };
    });
    saveInventoryDraft(identity, { rows, savedAt: Date.now() });
  }, [items, session?.id, isEditable, draftIdentity]);

  // Once the session leaves an editable state (submitted for review / completed
  // / cancelled), authoritative success owns cleanup — drop the local draft.
  useEffect(() => {
    if (!session?.id || !draftIdentity) return;
    if (!["draft", "in_progress"].includes(String(session.status || ""))) {
      clearInventoryDraft({ ...draftIdentity, sessionId: session.id });
      editedAtRef.current.clear();
    }
  }, [session?.status, session?.id, draftIdentity]);

  useEffect(() => {
    const sessionState = String(session?.status || "");
    if (!session?.id || !lookupQuery.trim() || !isEditable) {
      if (!lookupQuery.trim()) setLookupResults([]);
      return;
    }
    const timer = window.setTimeout(() => {
      setLookupLoading(true);
      lookupEmployeePortalInventoryVariants(token, session.id, {
        query: lookupQuery,
        limit: searchParams.get("taskId") ? 100 : 20,
      })
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
  }, [isEditable, isRejected, lookupQuery, searchParams, session?.id, session?.status, token]);

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
  const inventoryCatalogSource = useMemo(() => {
    const seen = new Set();
    const records = [];
    for (const record of catalogProducts) {
      const variant = normalizeInventoryFilterRecord(record);
      const key = [
        variant.product_id,
        variant.product_name,
        variant.color,
        variant.size,
        variant.sku,
        variant.barcode,
        variant.article_code,
      ].map((value) => clean(value)).join("::");
      if (seen.has(key)) continue;
      seen.add(key);
      records.push(variant);
    }
    return records;
  }, [catalogProducts]);
  const inventoryFilterSource = useMemo(() => {
    const seen = new Set();
    const records = [];
    for (const record of [...items, ...lookupResults]) {
      const variant = normalizeInventoryFilterRecord(record);
      const key = [
        variant.product_id,
        variant.product_name,
        variant.color,
        variant.size,
        variant.sku,
        variant.barcode,
        variant.article_code,
      ].map((value) => clean(value)).join("::");
      if (seen.has(key)) continue;
      seen.add(key);
      records.push(variant);
    }
    return records;
  }, [items, lookupResults]);
  const filterOptions = useMemo(() => {
    // Filter dropdowns come from the tiny facets endpoint. Fall back to values
    // derived from the current session items/lookup results so nothing is lost
    // if facets are unavailable.
    const facetOr = (list, derived) => (Array.isArray(list) && list.length ? uniqueTextValues(list) : uniqueTextValues(derived));
    return {
      categories: facetOr(facets.categories, inventoryFilterSource.map((record) => record.category)),
      types: facetOr(facets.types, inventoryFilterSource.map((record) => record.type)),
      brands: facetOr(facets.brands, inventoryFilterSource.map((record) => record.brand)),
      manufacturers: facetOr(facets.manufacturers, inventoryFilterSource.map((record) => record.manufacturer_name)),
      genders: facetOr(facets.genders, inventoryFilterSource.map((record) => record.gender)),
    };
  }, [facets, inventoryFilterSource]);
  const optionWithCounts = useCallback((values, records, valueForRecord) => values.map((value) => ({
    id: value,
    name: value,
    count: records.filter((record) => clean(valueForRecord(record)) === clean(value)).length,
  })), []);
  const activeFilterCount = useMemo(
    () =>
      ["category", "type", "brand", "manufacturer", "gender"].reduce(
        (count, key) => count + (filters[key] !== "all" ? 1 : 0),
        selectedFilterSize !== "all" ? 1 : 0
      ),
    [filters, selectedFilterSize]
  );
  const smartFilterOptions = useMemo(() => ({
    gender: optionWithCounts(filterOptions.genders, inventoryCatalogSource, (record) => record.gender),
    productType: optionWithCounts(filterOptions.types, inventoryCatalogSource, (record) => record.type),
    grade: optionWithCounts(filterOptions.categories, inventoryCatalogSource, (record) => record.category),
  }), [filterOptions, inventoryCatalogSource, optionWithCounts]);
  const brandOptions = useMemo(() => filterOptions.brands.map((brand) => ({ id: brand, name: brand })), [filterOptions.brands]);
  const manufacturerOptions = useMemo(() => filterOptions.manufacturers.map((manufacturer) => ({ id: manufacturer, name: manufacturer })), [filterOptions.manufacturers]);
  const filterGroups = useMemo(() => {
    const sizeCount = new Set(inventoryCatalogSource.map((record) => clean(record.size)).filter(Boolean)).size;
    return [
      { key: "gender", title: "Gender", count: smartFilterOptions.gender?.length || 0 },
      { key: "productType", title: "Product type", count: smartFilterOptions.productType?.length || 0 },
      { key: "grade", title: "Grade", count: smartFilterOptions.grade?.length || 0 },
      { key: "size", title: "Size", count: sizeCount },
      { key: "brand", title: "Brand", count: brandOptions.length },
      { key: "manufacturer", title: "Manufacturer", count: manufacturerOptions.length },
    ];
  }, [inventoryCatalogSource, brandOptions.length, manufacturerOptions.length, smartFilterOptions.gender, smartFilterOptions.productType, smartFilterOptions.grade]);
  const filterDebugText = useMemo(() => {
    const sizeCount = new Set(inventoryCatalogSource.map((record) => clean(record.size)).filter(Boolean)).size;
    return `Filters debug: gender=${smartFilterOptions.gender?.length || 0}, productType=${smartFilterOptions.productType?.length || 0}, grade=${smartFilterOptions.grade?.length || 0}, size=${sizeCount}, brand=${brandOptions.length}, manufacturer=${manufacturerOptions.length}`;
  }, [inventoryCatalogSource, brandOptions.length, manufacturerOptions.length, smartFilterOptions.gender, smartFilterOptions.productType, smartFilterOptions.grade]);
  const resetFilters = useCallback(() => {
    setFilters({
      category: "all",
      type: "all",
      brand: "all",
      manufacturer: "all",
      gender: "all",
      inStockOnly: true,
    });
    setSelectedFilterSize("all");
  }, []);
  const updateFilter = useCallback((key, value) => {
    setFilters((current) => ({ ...current, [key]: value }));
  }, []);
  const matchesInventoryBaseFilters = useCallback((record) => {
    const normalized = normalizeInventoryFilterRecord(record);
    const matchesCategory = filters.category === "all" || clean(normalized.category) === clean(filters.category);
    const matchesType = filters.type === "all" || clean(normalized.type) === clean(filters.type);
    const matchesBrand = filters.brand === "all" || clean(normalized.brand) === clean(filters.brand);
    const matchesManufacturer = filters.manufacturer === "all" || clean(normalized.manufacturer_name) === clean(filters.manufacturer);
    const matchesGender = filters.gender === "all" || productMatchesAudience(record, filters.gender);
    const matchesStock = !filters.inStockOnly || Number(normalized.system_quantity || normalized.stock || 0) > 0;
    return matchesCategory && matchesType && matchesBrand && matchesManufacturer && matchesGender && matchesStock;
  }, [filters]);
  const matchesInventoryFilters = useCallback((record) => {
    const normalized = normalizeInventoryFilterRecord(record);
    const matchesSize = selectedFilterSize === "all" || clean(normalized.size) === clean(selectedFilterSize);
    return matchesInventoryBaseFilters(record) && matchesSize;
  }, [matchesInventoryBaseFilters, selectedFilterSize]);
  const filteredLookupResults = useMemo(() => {
    const normalizedQuery = clean(lookupQuery).toLowerCase();
    const exactCodes = (record) => [
      record.article_code,
      record.variant_article_code,
      record.barcode,
      record.variant_barcode,
      record.product_barcode,
      record.product_article_code,
      record.sku,
      record.variant_sku,
      record.product_sku,
    ].map((value) => clean(value).toLowerCase()).filter(Boolean);
    const hasExactCodeMatch = normalizedQuery && lookupResults.some((record) => exactCodes(record).includes(normalizedQuery));
    return hasExactCodeMatch
      ? lookupResults.filter((record) => exactCodes(record).includes(normalizedQuery))
      : lookupResults.filter(matchesInventoryFilters);
  }, [lookupQuery, lookupResults, matchesInventoryFilters]);
  const lookupGroups = useMemo(() => groupVariants(filteredLookupResults), [filteredLookupResults]);
  const availableSizes = useMemo(() => {
    const filteredBaseRecords = inventoryCatalogSource.filter(matchesInventoryBaseFilters);
    const sizes = new Map();
    for (const record of filteredBaseRecords) {
      if (!record.size) continue;
      sizes.set(record.size, (sizes.get(record.size) || 0) + 1);
    }
    return sortSizes([...sizes.entries()].map(([id, count]) => ({ id, name: id, count })));
  }, [inventoryCatalogSource, matchesInventoryBaseFilters]);

  useEffect(() => {
    if (selectedFilterSize === "all") return;
    if (!availableSizes.some((option) => option.id === selectedFilterSize)) {
      setSelectedFilterSize("all");
    }
  }, [availableSizes, selectedFilterSize]);
  const differenceTotal = useMemo(() => items.reduce((sum, item) => sum + toNumber(item.difference_quantity, 0), 0), [items]);
  const expectedTotal = useMemo(() => items.reduce((sum, item) => sum + toNumber(item.system_quantity, 0), 0), [items]);
  const countedTotal = useMemo(() => items.reduce((sum, item) => sum + toNumber(item.counted_quantity, 0), 0), [items]);
  const progressPercent = useMemo(() => {
    if (!expectedTotal) return 0;
    return Math.max(0, Math.min(100, Math.round((countedTotal / expectedTotal) * 100)));
  }, [countedTotal, expectedTotal]);

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

  useEffect(() => {
    const taskId = clean(searchParams.get("taskId"));
    const taskQuery = clean(searchParams.get("query"));
    const productName = clean(searchParams.get("productName"));
    if (!taskId || taskLaunchHandledRef.current) return;
    taskLaunchHandledRef.current = true;
    setLookupQuery(taskQuery);

    if (routeSessionId) return;
    let cancelled = false;
    const launchTaskInventory = async () => {
      try {
        setSessionSaving(true);
        const response = await createEmployeePortalInventorySession(token, {
          title: productName ? `جرد ${productName}` : `جرد مهمة #${taskId}`,
          notes: `تم إنشاؤه من مهمة الجرد رقم ${taskId}`,
        });
        const created = response?.session;
        if (cancelled || !created?.id) return;
        await loadSessions();
        await loadSession(created.id);
        const params = new URLSearchParams({ taskId, query: taskQuery, productName });
        const portalBase = window.location.pathname.startsWith("/employee-app/") ? "/employee-app" : "/employee-portal";
        navigate(`${portalBase}/${encodeURIComponent(token)}/inventory/${encodeURIComponent(created.id)}?${params.toString()}`, { replace: true });
      } catch (error) {
        if (!cancelled) toast.error(error?.responseBody?.message || error?.message || "تعذر فتح جرد المهمة");
      } finally {
        if (!cancelled) setSessionSaving(false);
      }
    };
    void launchTaskInventory();
    return () => { cancelled = true; };
  }, [loadSession, loadSessions, navigate, routeSessionId, searchParams, token]);

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

  const saveItem = useCallback(async (variant, patch = {}, options = {}) => {
    if (!session?.id || !isEditable) return;
    const productVariantId = variant.product_variant_id ?? variant.variant_id ?? variant.id;
    if (!productVariantId) return;
    try {
      if (options.busy !== false) setItemSavingId(String(productVariantId));
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
          (() => {
            const savedId = String(saved.product_variant_id ?? saved.variant_id ?? saved.id ?? "");
            const index = current.findIndex((row) => String(row.product_variant_id ?? row.variant_id ?? row.id ?? "") === savedId);
            if (index === -1) return current;
            const row = current[index];
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
            const next = current.slice();
            next[index] = {
              ...row,
              ...saved,
              image_url: mergedImageUrl || row.image_url || saved.image_url || "",
              image: mergedImageUrl || row.image || saved.image || "",
              product_image: mergedImageUrl || row.product_image || saved.product_image || "",
              color_image: mergedImageUrl || row.color_image || saved.color_image || "",
              variant_image: mergedImageUrl || row.variant_image || saved.variant_image || "",
              images: mergedImageUrl ? [mergedImageUrl] : row.images || saved.images || [],
            };
            return next;
          })()
        );
      }
      if (response?.session) setSession(response.session);
    } catch (error) {
      toast.error(error?.responseBody?.message || error?.message || "تعذر حفظ القطعة");
    } finally {
      if (options.busy !== false) setItemSavingId("");
    }
  }, [isEditable, session?.id, token]);

  const scheduleItemSave = useCallback((variant, patch = {}, delayMs = 280) => {
    if (!variant || !session?.id || !isEditable) return;
    const variantId = String(variant.product_variant_id ?? variant.variant_id ?? variant.id ?? "");
    if (!variantId) return;

    const nextPatch = {
      ...(itemSavePatchRef.current.get(variantId) || {}),
      ...patch,
    };
    itemSavePatchRef.current.set(variantId, nextPatch);

    const existingTimer = itemSaveTimersRef.current.get(variantId);
    if (existingTimer) window.clearTimeout(existingTimer);

    const timer = window.setTimeout(async () => {
      itemSaveTimersRef.current.delete(variantId);
      const currentVariant = itemsRef.current.find((row) => String(row.product_variant_id ?? row.variant_id ?? row.id ?? "") === variantId) || variant;
      const patchToSave = itemSavePatchRef.current.get(variantId) || nextPatch;
      itemSavePatchRef.current.delete(variantId);
      const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
      try {
        setItemSavingId(variantId);
        await saveItem(currentVariant, patchToSave);
        logDevDuration("save item", startedAt, { variantId });
      } catch (error) {
        toast.error(error?.responseBody?.message || error?.message || "تعذر حفظ القطعة");
      } finally {
        setItemSavingId("");
      }
    }, delayMs);

    itemSaveTimersRef.current.set(variantId, timer);
  }, [isEditable, saveItem, session?.id]);

  const addColorGroup = useCallback(async (group) => {
    if (!group?.variants?.length || !session?.id || !isEditable) return;
    try {
      setItemSavingId(group.key);
      const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
      const seedVariant = group.variants[0] || {};
      const exactLookupValue = clean(
        seedVariant.sku ||
        seedVariant.barcode ||
        seedVariant.article_code ||
        seedVariant.product_sku ||
        seedVariant.product_barcode ||
        ""
      );
      let completeGroup = group;
      if (exactLookupValue) {
        const response = await lookupEmployeePortalInventoryVariants(token, session.id, {
          query: exactLookupValue,
          limit: 25,
        });
        const completeResults = Array.isArray(response?.items) ? response.items.map((row) => normalizeVariant(row)) : [];
        const seedProductId = seedVariant.product_id ?? null;
        const seedColorKey = normalizeColorKey(seedVariant.color || "");
        const resolvedGroup = groupVariants(completeResults).find((entry) =>
          String(entry.product_id ?? "") === String(seedProductId ?? "") &&
          normalizeColorKey(entry.color || "") === seedColorKey
        );
        if (resolvedGroup?.variants?.length) completeGroup = resolvedGroup;
      }
      await Promise.all(completeGroup.variants.map(async (variant) => {
        const existing = items.find((row) => String(row.product_variant_id ?? row.variant_id ?? row.id ?? "") === String(variant.product_variant_id ?? variant.variant_id ?? variant.id ?? ""));
        await saveItem(variant, {
          countedQuantity: existing ? toNumber(existing.counted_quantity, 0) : 0,
          systemQuantity: variant.system_quantity,
        }, { busy: false });
      }));
      await refreshCurrentSession();
      logDevDuration("add color group", startedAt, { groupKey: group.key, variantCount: completeGroup.variants.length });
      toast.success("تمت إضافة اللون للجرد");
    } catch (error) {
      toast.error(error?.responseBody?.message || error?.message || "تعذر إضافة اللون");
    } finally {
      setItemSavingId("");
    }
  }, [isEditable, items, refreshCurrentSession, saveItem, session?.id, token]);

  useEffect(() => {
    const taskId = clean(searchParams.get("taskId"));
    if (
      !taskId ||
      taskAutoAddHandledRef.current ||
      lookupLoading ||
      !session?.id ||
      !isEditable ||
      !lookupGroups.length
    ) return;

    taskAutoAddHandledRef.current = true;
    const addTaskModel = async () => {
      for (const group of lookupGroups) {
        await addColorGroup(group);
      }
      setLookupQuery("");
      toast.success("تمت إضافة ألوان ومقاسات الموديل إلى الجرد");
    };
    void addTaskModel();
  }, [addColorGroup, isEditable, lookupGroups, lookupLoading, searchParams, session?.id]);

  const findColorGroupForVariant = useCallback((variant, records = []) => {
    const productId = variant?.product_id ?? null;
    const colorKey = normalizeColorKey(variant?.color ?? "");
    if (!productId || !colorKey) return null;
    return groupVariants(records).find((entry) => String(entry.product_id ?? "") === String(productId) && normalizeColorKey(entry.color || "") === colorKey) || null;
  }, []);

  const handleScan = useCallback(async (value) => {
    const query = clean(value);
    setLookupQuery(query);
    if (!session?.id || !query || !isEditable) return false;
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
        return true;
      }
      toast.error("لم يتم العثور على منتج مطابق لهذا الباركود");
      return false;
    } catch (error) {
      toast.error(error?.responseBody?.message || error?.message || "تعذر قراءة الباركود");
      return false;
    } finally {
      setLookupLoading(false);
    }
  }, [addColorGroup, findColorGroupForVariant, session?.id, token]);

  const handleVariantCountChange = useCallback((variantId, value) => {
    if (!isEditable) return;
    editedAtRef.current.set(String(variantId), Date.now());
    const parsed = Number(value || 0);
    setItems((current) =>
      (() => {
        const index = current.findIndex((row) => String(row.product_variant_id ?? row.variant_id ?? row.id ?? "") === String(variantId));
        if (index === -1) return current;
        const next = current.slice();
        const row = current[index];
        const difference_quantity = parsed - toNumber(row.system_quantity, 0);
        next[index] = {
          ...row,
          counted_quantity: parsed,
          actual_qty: parsed,
          difference_quantity,
          difference_qty: difference_quantity,
        };
        return next;
      })()
    );
  }, [isEditable]);

  const adjustVariantCount = useCallback(async (variant, delta) => {
    if (!isEditable) return;
    const variantId = String(variant.product_variant_id ?? variant.variant_id ?? variant.id ?? "");
    if (!variantId) return;
    const currentValue = toNumber(variant.counted_quantity, 0);
    const nextValue = Math.max(0, currentValue + Number(delta || 0));
    const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
    handleVariantCountChange(variantId, nextValue);
    scheduleItemSave(variant, { countedQuantity: nextValue, systemQuantity: variant.system_quantity });
    logDevDuration("adjust variant queued", startedAt, { variantId, delta, nextValue });
  }, [handleVariantCountChange, isEditable, scheduleItemSave]);

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

  useEffect(() => {
    if (!branchDrawerOpen || typeof document === "undefined") return undefined;
    const { body } = document;
    const previousOverflow = body.style.overflow;
    body.style.overflow = "hidden";
    return () => {
      body.style.overflow = previousOverflow;
    };
  }, [branchDrawerOpen]);

  const currentBalance = differenceTotal === 0
    ? "متوازن"
    : differenceTotal > 0
      ? `زيادة: ${Math.abs(differenceTotal)}`
      : `عجز: ${Math.abs(differenceTotal)}`;

  return (
    <div dir="rtl" className="employee-portal-workspace employee-portal-inventory min-h-screen bg-[radial-gradient(circle_at_top,_rgba(16,185,129,0.10),_transparent_28%),linear-gradient(180deg,#f8fafc_0%,#eef2ff_100%)] px-3 py-3 text-slate-950 sm:px-4 sm:py-4">
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
      <div className="inventory-wrap mx-auto flex w-full max-w-6xl flex-col gap-2.5 sm:gap-4">
        <EmployeePortalNavControls
          onBack={() => {
            if (canNavigateEmployeePortalBack()) navigate(-1);
            else navigate(buildEmployeePortalHomePath({ pathname: window.location.pathname, token }), { replace: true });
          }}
          onHome={() => navigate(buildEmployeePortalHomePath({ pathname: window.location.pathname, token }))}
          tone="light"
          className="px-0"
        />

        <section className="rounded-2xl border border-white/70 bg-white/95 p-2.5 shadow-xl shadow-slate-200/50 backdrop-blur sm:rounded-[2rem] sm:p-4 sm:shadow-2xl">
          <div className="inventory-wrap flex min-w-0 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="hidden items-center gap-2 text-emerald-700 sm:flex">
                <Warehouse className="h-5 w-5" />
                <span className="text-xs font-black uppercase tracking-[0.18em]">بوابة الموظف</span>
              </div>
              <h1 className="text-xl font-black tracking-tight text-slate-950 sm:mt-2 sm:text-3xl">الجرد</h1>
              <div className="mt-2 hidden max-w-3xl rounded-2xl border border-primary/30 bg-primary-subtle px-3 py-2 text-xs font-bold leading-5 text-primary sm:inline-flex sm:text-sm">
                تُرسل كميات الجرد للمراجعة قبل الاعتماد النهائي.
              </div>
            </div>
            <div className="inventory-actions flex min-w-0 gap-2">
              <button
                type="button"
                onClick={() => setBranchDrawerOpen(true)}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-black text-slate-700 lg:hidden"
                aria-label="جردات الفرع"
              >
                <Menu className="h-4 w-4" />
                جردات الفرع
              </button>
              <button
                type="button"
                onClick={loadSessions}
                className="hidden min-h-11 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-black text-slate-700 lg:inline-flex"
              >
                <RefreshCw className="h-4 w-4" />
                تحديث
              </button>
              <button
                type="button"
                onClick={handleCreateSession}
                disabled={sessionSaving}
                className="hidden min-h-11 items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 text-sm font-black text-white disabled:opacity-60 lg:inline-flex"
              >
                {sessionSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                جرد جديد
              </button>
            </div>
          </div>

          <div className="mt-4 hidden flex-wrap gap-2 lg:flex">
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
          <aside className="inventory-wrap hidden rounded-[2rem] border border-white/70 bg-white/95 p-4 shadow-2xl shadow-slate-200/60 backdrop-blur lg:block">
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

          <main className="inventory-wrap rounded-2xl border border-white/70 bg-white/95 p-2.5 shadow-xl shadow-slate-200/50 backdrop-blur sm:rounded-[2rem] sm:p-4 sm:shadow-2xl">
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
              <div className="space-y-2.5 sm:space-y-4">
                <div className="inventory-wrap flex min-w-0 flex-col gap-2 rounded-[1.5rem] border border-slate-200 bg-slate-50 p-2.5 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <h2 className="text-2xl font-black text-slate-950">{titleDraft || session.title || "جرد جديد"}</h2>
                      <span className={`rounded-full border px-2.5 py-1 text-[11px] font-black ${sessionStatusTone[session.status] || sessionStatusTone.draft}`}>
                        {sessionStatusLabels[session.status] || session.status}
                      </span>
                    </div>
                    <div className="mt-0.5 text-xs font-semibold text-slate-500 sm:mt-1 sm:text-sm">
                      {session.branch_name || "الفرع"}{session.warehouse_name ? ` • ${session.warehouse_name}` : ""}
                    </div>
                  </div>
                  <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
                    {session.status === "draft" ? (
                      <button
                        type="button"
                        onClick={handleOpenSession}
                        disabled={sessionOpening}
                        className="inline-flex min-h-9 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 text-xs font-black text-slate-700 disabled:opacity-60"
                      >
                        {sessionOpening ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardList className="h-4 w-4" />}
                        بدء الجرد
                      </button>
                    ) : null}
                    <div className="grid min-w-0 gap-2 sm:grid-cols-2">
                      <button
                        type="button"
                        onClick={handleSaveSessionMeta}
                        disabled={sessionSaving || !isEditable}
                        className="inline-flex min-h-10 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 text-sm font-black text-slate-700 disabled:opacity-60"
                      >
                        <Save className="h-4 w-4" />
                        حفظ
                      </button>
                      <button
                        type="button"
                        onClick={handleSubmitSession}
                        disabled={sessionSubmitting || !isEditable}
                        className="inline-flex min-h-10 items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-3 text-sm font-black text-white disabled:opacity-60"
                      >
                        {sessionSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                        إرسال للمراجعة
                      </button>
                    </div>
                  </div>
                </div>

                {isPendingReview ? (
                  <div className="rounded-2xl border border-primary/30 bg-primary-subtle px-4 py-3 text-sm font-black text-primary">
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

                <div className="rounded-2xl border border-slate-200 bg-white p-2.5 shadow-sm sm:p-3">
                  <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs font-black text-slate-600">
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1">المنتجات: {groupedItems.length}</span>
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1">الكمية: {countedTotal}</span>
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1">الفروقات: {differenceTotal}</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-3 text-[11px] font-black text-slate-500 sm:mt-3">
                    <span>{countedTotal} قطعة معدودة</span>
                    <span>{progressPercent}%</span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-emerald-500 transition-all"
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>
                </div>

                <div className="grid min-w-0 gap-2 lg:grid-cols-[1fr_1fr]">
                  <label className="inventory-wrap block rounded-2xl border border-slate-200 bg-white p-2.5 shadow-sm">
                    <div className="text-xs font-black text-slate-400">اسم الجرد</div>
                    <input
                      value={titleDraft}
                      onChange={(event) => setTitleDraft(event.target.value)}
                      disabled={!isEditable}
                      className="mt-1.5 w-full bg-transparent text-base font-semibold text-slate-950 outline-none disabled:opacity-70"
                    />
                  </label>
                  <label className="inventory-wrap block rounded-2xl border border-slate-200 bg-white p-2.5 shadow-sm">
                    <div className="text-xs font-black text-slate-400">ملاحظات</div>
                    <input
                      value={notesDraft}
                      onChange={(event) => setNotesDraft(event.target.value)}
                      disabled={!isEditable}
                      className="mt-1.5 w-full bg-transparent text-base font-semibold text-slate-950 outline-none disabled:opacity-70"
                    />
                  </label>
                </div>

                <section className="rounded-[1.5rem] border border-slate-200 bg-white p-3 shadow-sm">
                  <div className="flex min-w-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setFiltersOpen(true)}
                      aria-expanded={filtersOpen}
                      className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border transition ${
                        filtersOpen || activeFilterCount > 0
                          ? "border-violet-400/40 bg-violet-500/10 text-violet-700 shadow-[0_0_18px_rgba(124,58,237,0.12)]"
                          : "border-slate-200 bg-white text-slate-600 hover:border-violet-300 hover:bg-violet-50 hover:text-violet-700"
                      }`}
                      aria-label="الفلاتر"
                      title="الفلاتر"
                    >
                      <span className="relative inline-flex">
                        <Filter className="h-4 w-4" />
                        {activeFilterCount > 0 ? (
                          <span className="absolute -right-2 -top-2 inline-flex min-h-4 min-w-4 items-center justify-center rounded-full bg-violet-600 px-1 text-[10px] font-black text-white">
                            {activeFilterCount > 99 ? "99+" : activeFilterCount}
                          </span>
                        ) : null}
                      </span>
                    </button>
                    <label className="inventory-search flex h-11 min-w-0 flex-1 items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3">
                      <Search className="h-4 w-4 shrink-0 text-slate-400" />
                      <input
                        ref={lookupInputRef}
                        value={lookupQuery}
                        onChange={(event) => setLookupQuery(event.target.value)}
                        disabled={!isEditable}
                        placeholder="ابحث بالاسم أو الباركود أو الأرتكل"
                        className="w-full bg-transparent text-base font-semibold text-slate-950 outline-none placeholder:text-slate-400 disabled:opacity-70"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => setScannerOpen(true)}
                      disabled={!isEditable}
                      className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-600 transition hover:border-violet-300 hover:bg-violet-50 hover:text-violet-700 disabled:opacity-60"
                      aria-label="مسح الباركود"
                      title="مسح الباركود"
                    >
                      <Camera className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 sm:mt-3">
                    {lookupLoading ? (
                      <div className="inline-flex items-center gap-2 text-sm font-black text-slate-500">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        جاري البحث...
                      </div>
                    ) : null}                  </div>
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
                              {(group.article_code || group.category) ? (
                                <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] font-black text-slate-600">
                                  {group.article_code ? (
                                    <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1" dir="ltr">
                                      Article: {group.article_code}
                                    </span>
                                  ) : null}
                                  {group.category ? (
                                    <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-amber-800">
                                      {group.category}
                                    </span>
                                  ) : null}
                                </div>
                              ) : null}
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

                <section className="inventory-wrap rounded-[1.5rem] border border-slate-200 bg-white p-3 shadow-sm">
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

                  <div className="mt-3 space-y-3">
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
                                    className="inline-flex h-14 items-center justify-center rounded-2xl border border-slate-200 bg-white text-2xl font-black text-slate-700 transition-colors disabled:opacity-50"
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
                                    className="inline-flex h-14 items-center justify-center rounded-2xl bg-emerald-600 text-2xl font-black text-white transition-colors disabled:opacity-50"
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
      {branchDrawerOpen ? (
        <BranchInventoryDrawer
          sessionsLoading={sessionsLoading}
          sessionsError={sessionsError}
          visibleSessions={visibleSessions}
          selectedSessionId={selectedSessionId}
          sessionStatusTone={sessionStatusTone}
          sessionStatusLabels={sessionStatusLabels}
          sessionSearch={sessionSearch}
          setSessionSearch={setSessionSearch}
          statusFilter={statusFilter}
          setStatusFilter={setStatusFilter}
          sessionFilters={sessionFilters}
          onClose={() => setBranchDrawerOpen(false)}
          onSelectSession={(sessionId) => {
            setBranchDrawerOpen(false);
            selectSession(sessionId);
          }}
          onCreateSession={handleCreateSession}
          sessionSaving={sessionSaving}
        />
      ) : null}

      <SmartPosFilters
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
    </div>
  );
}

function BranchInventoryDrawer({
  sessionsLoading,
  sessionsError,
  visibleSessions,
  selectedSessionId,
  sessionStatusTone,
  sessionStatusLabels,
  sessionSearch,
  setSessionSearch,
  statusFilter,
  setStatusFilter,
  sessionFilters,
  onClose,
  onSelectSession,
  onCreateSession,
  sessionSaving,
}) {
  return createPortal(
    <div
      className="fixed inset-0 z-[2147483001] bg-black/60 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        className="absolute inset-y-0 end-0 flex h-full w-[min(100vw,22rem)] flex-col border-s border-white/10 bg-white shadow-2xl shadow-black/30"
        dir="rtl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="branch-inventory-drawer-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-4">
          <div className="min-w-0">
            <div className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-700">بوابة الموظف</div>
            <h2 id="branch-inventory-drawer-title" className="mt-1 text-lg font-black text-slate-950">جردات الفرع</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-700 shadow-sm"
            aria-label="إغلاق"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4" style={{ WebkitOverflowScrolling: "touch" }}>
          <div className="flex flex-wrap gap-2">
            {sessionFilters.map((filter) => (
              <button
                key={filter.value}
                type="button"
                onClick={() => setStatusFilter(filter.value)}
                className={`rounded-full border px-3 py-2 text-xs font-black transition ${
                  statusFilter === filter.value
                    ? "border-emerald-500 bg-emerald-500 text-white"
                    : "border-slate-200 bg-white text-slate-600"
                }`}
              >
                {filter.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={onCreateSession}
            disabled={sessionSaving}
            className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 text-sm font-black text-white disabled:opacity-60"
          >
            {sessionSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            جرد جديد
          </button>

          <label className="mt-4 block rounded-2xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
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

          <div className="mt-4 flex items-center justify-between gap-3">
            <div className="text-sm font-black text-slate-950">القائمة</div>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-700">{visibleSessions.length}</span>
          </div>

          <div className="mt-3 space-y-2">
            {sessionsLoading ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm font-bold text-slate-500">جارِ التحميل...</div>
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
                    onClick={() => onSelectSession(row.id)}
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
        </div>
      </aside>
    </div>,
    document.body
  );
}
