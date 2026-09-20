import { createPortal } from "react-dom";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  CloudOff,
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
  Wifi,
  X,
} from "lucide-react";
import toast from "react-hot-toast";

import BarcodeScanner from "../../../components/BarcodeScanner";
import { resolveProductImageUrl } from "../../../shared/lib/imageUrls";
import EmployeePortalNavControls, { buildEmployeePortalHomePath, canNavigateEmployeePortalBack } from "../components/EmployeePortalNavControls";
import SmartPosFilters from "../../pos/components/SmartPosFilters";
import { getEmployeePortalFacets } from "../services/employeePortalProductsApi";
import {
  saveInventoryDraft,
  loadInventoryDraft,
  clearInventoryDraft,
  reconcileInventoryRows,
  sweepExpiredDrafts,
} from "../services/employeeDrafts/employeeDraftStore.js";
import {
  isOfflineFailure,
  outboxSize,
  outboxToItems,
  queueCountedQuantity,
  settleOutbox,
} from "../services/employeeDrafts/inventoryCountSync.js";
import usePortalCatalog from "../hooks/usePortalCatalog";
import CountProductSearch from "../components/CountProductSearch";
import { countIndexFacets, findCountGroupByCode, getCountSearchIndex, searchCountIndex } from "../services/employeeDrafts/countSearchIndex.js";
import usePageTitle from "../../../shared/hooks/usePageTitle";
import "./EmployeePortalWorkspaces.m1.css";
import {
  bulkUpsertEmployeePortalInventoryItems,
  createEmployeePortalInventorySession,
  getEmployeePortalInventorySession,
  listEmployeePortalInventorySessions,
  lookupEmployeePortalInventoryVariants,
  deleteEmployeePortalInventoryColorGroup,
  openEmployeePortalInventorySession,
  reopenEmployeePortalInventorySession,
  submitEmployeePortalInventorySession,
  updateEmployeePortalInventorySession,
} from "../services/employeePortalInventoryApi";

import { useTranslation } from "react-i18next";

import i18n from "../../../i18n/i18n";

/** Module-scope translator for helpers defined outside a component. */
const tt = (key, options) => i18n.t(key, options);

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
    .replace(/[إأآا]/g, tt("employeePortal.initials.alef"))
    .replace(/ى/g, tt("employeePortal.initials.ya"))
    .replace(/ة/g, tt("employeePortal.initials.ha"))
    .replace(/\s+/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");
  return aliases[normalized] || normalized;
};

const sessionStatusLabels = {
  get draft() { return tt("employeePortal.status.draft"); },
  get in_progress() { return tt("employeePortal.status.inProgress"); },
  get pending_review() { return tt("employeePortal.status.underReview"); },
  get rejected() { return tt("employeePortal.status.rejected"); },
  get completed() { return tt("employeePortal.status.completed"); },
  get cancelled() { return tt("employeePortal.status.cancelled"); },};

const sessionStatusTone = {
  draft: "border-border bg-surface-soft text-text",
  in_progress: "border-border bg-warning-subtle text-text",
  pending_review: "border-primary/30 bg-primary-subtle text-text",
  rejected: "border-border bg-danger-subtle text-text",
  completed: "border-border bg-success-subtle text-text",
  cancelled: "border-border bg-surface-soft text-text-muted",
};

// Module-scope array: stores translation KEYS and resolves them at render, so the
// labels follow a language change instead of freezing at import time.
const sessionFilters = [
  { value: "active", labelKey: "employeePortal.products.active", statuses: ["draft", "in_progress", "pending_review", "rejected"] },
  { value: "draft", labelKey: "employeePortal.status.draft", statuses: ["draft"] },
  { value: "in_progress", labelKey: "employeePortal.status.inProgress", statuses: ["in_progress"] },
  { value: "pending_review", labelKey: "employeePortal.status.underReview", statuses: ["pending_review"] },
  { value: "rejected", labelKey: "employeePortal.status.rejected", statuses: ["rejected"] },
  { value: "completed", labelKey: "employeePortal.status.completed", statuses: ["completed"] },
  { value: "all", labelKey: "employeePortal.common.all", statuses: null },
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
    <div className={`flex h-full w-full items-center justify-center bg-surface-soft text-text-muted ${className}`.trim()}>
      <Warehouse className="h-5 w-5" />
    </div>
  );
}

// What a colour card actually renders from: its size rows' quantities and which
// of them still owe the server. A count tap rewrites `items`, which re-groups
// EVERY colour into new objects — without this, one tap re-rendered every
// stepper on a sheet that can hold hundreds of them.
const groupSignature = (group, outbox) =>
  group.variants
    .map((variant) => {
      const id = String(variant.product_variant_id ?? variant.variant_id ?? variant.id ?? "");
      return `${id}:${variant.counted_quantity}:${variant.system_quantity}:${outbox[id] ? 1 : 0}`;
    })
    .join("|");

const CountColorCard = memo(function CountColorCard({ group, outbox, isEditable, deleting, flash, onAdjust, onSet, onDelete }) {
  return (
    <div
        data-count-group={group.key}
        data-count-variant={group.variants.map((variant) => `v${variant.product_variant_id ?? variant.variant_id ?? variant.id ?? ""}`).join(" ")}
        className={`inventory-wrap inventory-color-card rounded-2xl border bg-surface-soft p-2.5 ${flash ? "inventory-color-card--flash border-border" : "border-border"}`}
      >
      <div className="flex min-w-0 items-center gap-2.5">
        <div className="h-12 w-12 shrink-0 overflow-hidden rounded-[var(--radius-control)] border border-border bg-surface-soft">
          <InventoryImage src={resolveCardImage(group)} alt={group.product_name || tt("employeePortal.common.product")} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-black text-text">{group.product_name || tt("employeePortal.common.product")}</div>
          <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-1.5 text-[11px] font-bold text-text-muted">
            <span className="max-w-[9rem] truncate rounded-full border border-border bg-surface px-2 py-0.5 text-text">
              {group.color || tt("employeePortal.stockCount.unknownColor")}
            </span>
            <span dir="ltr">{group.counted_total} / {group.system_total}</span>
            <span className={group.difference_total === 0 ? "text-success" : group.difference_total > 0 ? "text-warning" : "text-danger"}>
              {group.difference_total === 0 ? tt("employeePortal.status.balanced") : group.difference_total > 0 ? `زيادة ${group.difference_total}` : `عجز ${Math.abs(group.difference_total)}`}
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => onDelete(group)}
          disabled={!isEditable || deleting}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-border bg-danger-subtle text-text disabled:opacity-60"
          aria-label={tt("employeePortal.stockCount.deleteColor")}
          title={tt("employeePortal.stockCount.deleteColor")}
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      {/* One tile per size, two or three to a row: the whole
          colour is countable without a single scroll, and the
          quantity is typeable instead of only tappable. */}
      <div className="inventory-size-grid mt-2.5">
        {group.variants.map((variant) => {
          const variantId = String(variant.product_variant_id ?? variant.variant_id ?? variant.id ?? "");
          const difference = toNumber(variant.difference_quantity, 0);
          const pending = Boolean(outbox[variantId]);
          return (
            <div
              key={variantId}
              className={`inventory-size-tile rounded-[var(--radius-card)] border bg-surface p-2 ${difference === 0 ? "border-border" : difference > 0 ? "border-border" : "border-border"}`}
            >
              <div className="flex min-w-0 items-center justify-between gap-1">
                <span className="truncate text-sm font-black text-text">{variant.size || tt("employeePortal.stockCount.unknownSize")}</span>
                <span className="shrink-0 text-[10px] font-bold text-text-muted" dir="ltr">{tt("employeePortal.stockCount.expectedShort")} {toNumber(variant.system_quantity, 0)}</span>
              </div>
              <div className="mt-1.5 grid grid-cols-[44px_minmax(0,1fr)_44px] gap-1">
                <button
                  type="button"
                  onClick={() => onAdjust(variant, -1)}
                  disabled={!isEditable}
                  className="inline-flex h-12 items-center justify-center rounded-[var(--radius-control)] border border-border bg-surface text-2xl font-black text-text active:bg-surface-soft disabled:opacity-50"
                  aria-label={tt("employeePortal.stockCount.decrement")}
                >
                  -
                </button>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={variant.counted_quantity}
                  onFocus={(event) => event.target.select()}
                  onChange={(event) => {
                    const digits = event.target.value.replace(/[^0-9]/g, "");
                    onSet(variant, digits === "" ? 0 : Number(digits));
                  }}
                  disabled={!isEditable}
                  className="h-12 w-full rounded-[var(--radius-control)] border border-border bg-surface-soft px-1 text-center text-lg font-black text-text outline-none focus:border-border focus:bg-surface disabled:opacity-70"
                  aria-label={`${group.product_name || ""} ${variant.size || ""}`}
                />
                <button
                  type="button"
                  onClick={() => onAdjust(variant, 1)}
                  disabled={!isEditable}
                  className="inline-flex h-12 items-center justify-center rounded-[var(--radius-control)] bg-primary text-2xl font-black text-[var(--primary-contrast)] active:opacity-80 disabled:opacity-50"
                  aria-label={tt("employeePortal.stockCount.increment")}
                >
                  +
                </button>
              </div>
              <div className="mt-1 flex items-center justify-between gap-1 text-[10px] font-black">
                <span className={difference === 0 ? "text-success" : difference > 0 ? "text-warning" : "text-danger"} dir="ltr">
                  {difference === 0 ? tt("employeePortal.status.balanced") : difference > 0 ? `+${difference}` : difference}
                </span>
                {pending ? (
                  <span className="inline-flex items-center gap-0.5 text-warning" title={tt("employeePortal.sync.pending")}>
                    <CloudOff className="h-3 w-3" />
                  </span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}, (previous, next) =>
  previous.signature === next.signature &&
  previous.isEditable === next.isEditable &&
  previous.deleting === next.deleting &&
  previous.flash === next.flash &&
  previous.group.key === next.group.key &&
  previous.onAdjust === next.onAdjust &&
  previous.onSet === next.onSet &&
  previous.onDelete === next.onDelete
);

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
      className="fixed inset-0 z-[2147483000] flex items-end justify-center bg-surface-soft p-3 backdrop-blur-sm sm:items-center sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="flex w-full max-w-md flex-col overflow-hidden rounded-t-3xl border border-border bg-background shadow-[var(--shadow-overlay)] sm:rounded-3xl"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={tt("employeePortal.scanner.title")}
        dir="rtl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-4 text-text">
          <div>
            <div className="text-[10px] font-black uppercase tracking-[0.2em] text-success">{tt("employeePortal.chrome.inventory")}</div>
            <h3 className="m1-section-title mt-1">{tt("employeePortal.scanner.scanNow")}</h3>
          </div>
          <button type="button" onClick={onClose} className="inline-flex h-[var(--control-height-md)] w-10 items-center justify-center rounded-[var(--radius-control)] border border-border bg-surface-soft text-text-muted">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-4">
          <div className="overflow-hidden rounded-3xl border border-border bg-surface-soft p-3">
            <BarcodeScanner
              onScan={submitScan}
              onPermissionDenied={(message) => {
                setScannerMessage(message || tt("employeePortal.scanner.permissionDenied"));
                toast.error(message || tt("employeePortal.scanner.permissionDenied"));
              }}
              onUnsupported={(message) => {
                setScannerMessage(message || tt("employeePortal.scanner.unsupported"));
                toast.error(message || tt("employeePortal.scanner.unsupported"));
              }}
              onError={(message) => {
                setScannerMessage(message || tt("employeePortal.scanner.startFailed"));
                toast.error(message || tt("employeePortal.scanner.startFailed"));
              }}
              className="overflow-hidden rounded-[1.35rem] bg-surface"
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
              frameHint={tt("employeePortal.scanner.alignHint")}
              statusPrimary={tt("employeePortal.scanner.reading")}
              statusSecondary={tt("employeePortal.scanner.fallbackHint")}
              overlayFrameWidthPercent={85}
              overlayFrameHeight={140}
            />
          </div>
          <div className="mt-4 rounded-[var(--radius-card)] border border-border bg-surface-soft p-3 text-text">
            <button
              type="button"
              onClick={() => manualInputRef.current?.focus()}
              className="text-xs font-black text-success"
            >
              {tt("employeePortal.scanner.typeManually")}
            </button>
            <div className="mt-1 text-[11px] font-semibold text-text-muted">{tt("employeePortal.scanner.manualHint")}</div>
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
                placeholder={tt("employeePortal.scanner.manualEntry")}
                className="h-[var(--control-height-lg)] flex-1 rounded-[var(--radius-control)] border border-border bg-surface-soft px-3 text-sm font-semibold text-text outline-none placeholder:text-text-muted"
              />
              <button
                type="button"
                onClick={() => submitScan(manualValue)}
                disabled={!clean(manualValue) || submitting}
                className="inline-flex h-[var(--control-height-lg)] items-center justify-center rounded-[var(--radius-control)] bg-primary px-4 text-sm font-black text-[var(--primary-contrast)] disabled:opacity-50"
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : tt("employeePortal.common.search")}
              </button>
            </div>
            {scannerMessage ? <div className="mt-2 text-xs font-semibold text-warning">{scannerMessage}</div> : null}
          </div>
        </div>
      </section>
    </div>,
    document.body
  );
}

export default function EmployeePortalInventory() {
  // Subscribes this screen to language changes; strings resolve through tt().
  const { i18n: i18nRuntime } = useTranslation();
  const { token, sessionId: routeSessionId } = useParams();
  const [searchParams] = useSearchParams();
  usePageTitle(routeSessionId ? "Inventory Count Session" : "Employee Inventory Count");
  const navigate = useNavigate();
  const [sessions, setSessions] = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState("");
  // Starts EMPTY even when the URL names a session. Seeding it with the route id
  // made the loader below see "already selected" on a cold open of
  // /inventory/:id, so a shared or re-launched session link showed the empty
  // "pick a count" state forever. Empty here, the effect loads it.
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [session, setSession] = useState(null);
  const [items, setItems] = useState([]);
  // Token-free identity {tenant_id, employee_id, branch_id} for the local draft
  // namespace (server-supplied; never the portal token). editedAtRef stamps the
  // local edit time per variant so a locally-counted row wins reconciliation.
  const [draftIdentity, setDraftIdentity] = useState(null);
  const editedAtRef = useRef(new Map());
  // ---- Offline count engine -------------------------------------------------
  // A tap is recorded locally and owed to the server, never awaited. `outbox`
  // holds the LATEST quantity per variant; it is persisted with the draft, so a
  // count survives a dead connection, a reload and a closed app.
  const [outbox, setOutbox] = useState({});
  const outboxRef = useRef(outbox);
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine !== false));
  const [syncing, setSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  const flushTimerRef = useRef(null);
  const flushInFlightRef = useRef(false);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [sessionSaving, setSessionSaving] = useState(false);
  const [sessionOpening, setSessionOpening] = useState(false);
  const [sessionSubmitting, setSessionSubmitting] = useState(false);
  const [sessionReopening, setSessionReopening] = useState(false);
  const [itemSavingId, setItemSavingId] = useState("");
  const [facets, setFacets] = useState({ categories: [], types: [], brands: [], manufacturers: [], genders: [], grades: [], sizes: [] });
  const [statusFilter, setStatusFilter] = useState("active");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState({
    category: "all",
    type: "all",
    brand: "all",
    manufacturer: "all",
    gender: "all",
    // A count exists to find what the system got wrong, zero-stock colours included.
    inStockOnly: false,
  });
  const [selectedFilterSize, setSelectedFilterSize] = useState("all");
  const [sessionSearch, setSessionSearch] = useState("");
  const [titleDraft, setTitleDraft] = useState("");
  const [notesDraft, setNotesDraft] = useState("");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [branchDrawerOpen, setBranchDrawerOpen] = useState(false);
  const itemsRef = useRef(items);
  const itemSavingIdRef = useRef("");
  const [flashGroupKey, setFlashGroupKey] = useState("");
  const [searchActive, setSearchActive] = useState(false);
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
    outboxRef.current = outbox;
  }, [outbox]);

  useEffect(() => {
    itemSavingIdRef.current = itemSavingId;
  }, [itemSavingId]);

  // The browser's own connection flag is the cheapest signal we have; a flush
  // that fails anyway just puts its rows back in the outbox.
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

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

  const loadSessions = useCallback(async () => {
    try {
      setSessionsLoading(true);
      setSessionsError("");
      const response = await listEmployeePortalInventorySessions(token, { limit: 100, page: 1 });
      if (response?.identity) setDraftIdentity(toDraftIdentity(response.identity));
      const rows = Array.isArray(response?.sessions) ? response.sessions : [];
      setSessions(rows);
    } catch (error) {
      setSessionsError(error?.responseBody?.message || error?.message || tt("employeePortal.stockCount.loadListFailed"));
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
      // Quantities counted on this device that never reached the server (the
      // app was closed offline, or the flush failed). They are restored BEFORE
      // the rows render so the badge is honest from the first frame.
      const restoredOutbox = draft?.outbox && typeof draft.outbox === "object" ? draft.outbox : {};
      if (Object.keys(restoredOutbox).length) setOutbox(restoredOutbox);

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
        toast(tt("employeePortal.stockCount.offlineDraft"), { icon: "📴" });
      } else {
        toast.error(tt("employeePortal.stockCount.loadFailed"));
      }
    } catch (error) {
      toast.error(error?.responseBody?.message || error?.message || tt("employeePortal.stockCount.loadFailed"));
    } finally {
      setSessionLoading(false);
    }
  }, [token, draftIdentity]);

  /**
   * Send everything the outbox owes the server in ONE request.
   *
   * Returns true when nothing is left owing. A failure is not an error the
   * employee has to act on: the rows stay in the outbox and go out with the
   * next tap, the next reconnection, or the send-for-review button.
   */
  const flushOutbox = useCallback(async ({ silent = true } = {}) => {
    const sessionId = session?.id;
    const pending = outboxRef.current;
    if (!sessionId || !isEditable) return false;
    if (!outboxSize(pending)) return true;
    if (flushInFlightRef.current) return false;
    if (typeof navigator !== "undefined" && navigator?.onLine === false) return false;

    flushInFlightRef.current = true;
    setSyncing(true);
    const sent = pending;
    try {
      const response = await bulkUpsertEmployeePortalInventoryItems(token, sessionId, outboxToItems(sent));
      // Only what was actually accepted is cleared, and only if the employee has
      // not re-counted that variant while the request was in flight.
      setOutbox((current) => settleOutbox(current, sent));
      if (response?.session) setSession(response.session);
      // A row added from the phone's catalogue carries the stock the snapshot
      // remembered. The server has now written the row against the REAL stock,
      // so its expected quantity replaces the remembered one — the counted value
      // on screen is left alone; only what it is measured against is corrected.
      const authoritative = new Map(
        (Array.isArray(response?.items) ? response.items : []).map((row) => [
          String(row.product_variant_id ?? row.variant_id ?? ""),
          { system: toNumber(row.system_quantity, 0), countedAt: row.counted_at || null },
        ])
      );
      if (authoritative.size) {
        setItems((current) => current.map((row) => {
          const id = String(row.product_variant_id ?? row.variant_id ?? row.id ?? "");
          if (!authoritative.has(id)) return row;
          // counted_at comes back too: it is what keeps a size that was counted
          // as ZERO marked as visited once its outbox entry is gone.
          const { system, countedAt } = authoritative.get(id);
          const sameStock = system === toNumber(row.system_quantity, 0);
          if (sameStock && (row.counted_at || null) === countedAt) return row;
          const difference = toNumber(row.counted_quantity, 0) - system;
          return { ...row, counted_at: countedAt, system_quantity: system, expected_qty: system, difference_quantity: difference, difference_qty: difference };
        }));
      }
      setLastSyncedAt(Date.now());
      const rejected = Array.isArray(response?.rejected) ? response.rejected : [];
      if (rejected.length && !silent) {
        toast.error(tt("employeePortal.stockCount.someRowsRejected", { count: rejected.length }));
      }
      return true;
    } catch (error) {
      if (isOfflineFailure(error)) {
        setOnline(false);
        if (!silent) toast(tt("employeePortal.stockCount.queuedOffline"), { icon: "📴" });
      } else if (!silent) {
        toast.error(error?.responseBody?.message || error?.message || tt("employeePortal.stockCount.saveItemFailed"));
      }
      return false;
    } finally {
      flushInFlightRef.current = false;
      setSyncing(false);
    }
  }, [isEditable, session?.id, token]);

  // Counting must never wait on the network, so the flush trails the taps: it
  // fires once the employee pauses, not once per tap.
  useEffect(() => {
    if (!outboxSize(outbox) || !online || !session?.id || !isEditable) return undefined;
    if (flushTimerRef.current) window.clearTimeout(flushTimerRef.current);
    flushTimerRef.current = window.setTimeout(() => { void flushOutbox({ silent: true }); }, 1200);
    return () => {
      if (flushTimerRef.current) window.clearTimeout(flushTimerRef.current);
    };
  }, [outbox, online, session?.id, isEditable, flushOutbox]);

  // Leaving the screen or backgrounding the app is the last chance to send.
  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const onHide = () => {
      if (document.visibilityState === "hidden") void flushOutbox({ silent: true });
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      void flushOutbox({ silent: true });
    };
  }, [flushOutbox]);

  // ---- The phone's product catalogue ----------------------------------------
  // Shared with the products screen: one download, one cache, one set of warmed
  // pictures. It answers a search or a scan at once; the server only refines.
  const { snapshot: catalogSnapshot, refreshing: catalogLoading, refresh: refreshCatalog } = usePortalCatalog(token, { identity: draftIdentity });

  const refreshOfflineCatalog = useCallback(async () => {
    const result = await refreshCatalog({ force: true });
    const count = result?.snapshot?.variants?.length || 0;
    if (result?.refreshed && count) toast.success(tt("employeePortal.stockCount.catalogReady", { count }));
    else if (!count) toast.error(tt("employeePortal.stockCount.catalogFailed"));
  }, [refreshCatalog]);

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
        counted_at: row.counted_at ?? null,
        // Preserve a prior-session edit marker (survives reload via the draft)
        // or stamp this session's edit; untouched rows stay 0 so the server wins.
        local_updated_at: editedAtRef.current.get(vid) || Number(row.local_updated_at) || 0,
      };
    });
    // The outbox rides with the rows: reopening the app offline has to restore
    // both what was counted AND what the server has not been told yet.
    saveInventoryDraft(identity, { rows, outbox, savedAt: Date.now() });
  }, [items, outbox, session?.id, isEditable, draftIdentity]);

  // Once the session leaves an editable state (submitted for review / completed
  // / cancelled), authoritative success owns cleanup — drop the local draft.
  useEffect(() => {
    if (!session?.id || !draftIdentity) return;
    if (!["draft", "in_progress"].includes(String(session.status || ""))) {
      clearInventoryDraft({ ...draftIdentity, sessionId: session.id });
      editedAtRef.current.clear();
      // The session is closed to edits, so an outbox entry can no longer be
      // written; keeping it would show a permanent "not sent yet" badge.
      setOutbox({});
    }
  }, [session?.status, session?.id, draftIdentity]);

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
  // ---- Search index + filter options, both from the phone's catalogue -------
  // Built once per snapshot. The filter panel used to be fed by a list that was
  // never populated, so every option showed a count of 0 and the size filter
  // reset itself on each render; the index gives it real colours-per-option.
  const searchIndex = useMemo(() => getCountSearchIndex(catalogSnapshot), [catalogSnapshot]);
  const indexFacets = useMemo(() => countIndexFacets(searchIndex), [searchIndex]);
  const facetFallback = useCallback((list) => uniqueTextValues(Array.isArray(list) ? list : []).map((name) => ({ id: name, name })), []);
  const smartFilterOptions = useMemo(() => ({
    gender: indexFacets.gender.length ? indexFacets.gender : facetFallback(facets.genders),
    productType: indexFacets.type.length ? indexFacets.type : facetFallback(facets.types),
    grade: indexFacets.grade.length ? indexFacets.grade : facetFallback(facets.grades?.length ? facets.grades : facets.categories),
  }), [facetFallback, facets, indexFacets]);
  const brandOptions = useMemo(() => (indexFacets.brand.length ? indexFacets.brand : facetFallback(facets.brands)), [facetFallback, facets.brands, indexFacets.brand]);
  const manufacturerOptions = useMemo(() => (indexFacets.manufacturer.length ? indexFacets.manufacturer : facetFallback(facets.manufacturers)), [facetFallback, facets.manufacturers, indexFacets.manufacturer]);
  const availableSizes = useMemo(() => (indexFacets.size.length ? indexFacets.size : facetFallback(facets.sizes)), [facetFallback, facets.sizes, indexFacets.size]);
  const activeFilterCount = useMemo(
    () =>
      ["category", "type", "brand", "manufacturer", "gender"].reduce(
        (count, key) => count + (filters[key] !== "all" ? 1 : 0),
        selectedFilterSize !== "all" ? 1 : 0
      ),
    [filters, selectedFilterSize]
  );
  const resetFilters = useCallback(() => {
    setFilters({ category: "all", type: "all", brand: "all", manufacturer: "all", gender: "all", inStockOnly: false });
    setSelectedFilterSize("all");
  }, []);
  const updateFilter = useCallback((key, value) => {
    setFilters((current) => ({ ...current, [key]: value }));
  }, []);
  const openFilters = useCallback(() => setFiltersOpen(true), []);
  const openScanner = useCallback(() => setScannerOpen(true), []);

  // Which size rows are already on the sheet. Re-made only when the SET of ids
  // changes, so counting (which rewrites `items` on every tap) does not make the
  // search box re-render.
  const sheetIdsKey = useMemo(
    () => items.map((row) => String(row.product_variant_id ?? row.variant_id ?? row.id ?? "")).join(","),
    [items]
  );
  const sheetVariantIds = useMemo(() => new Set(sheetIdsKey ? sheetIdsKey.split(",") : []), [sheetIdsKey]);

  const differenceTotal = useMemo(() => items.reduce((sum, item) => sum + toNumber(item.difference_quantity, 0), 0), [items]);
  const expectedTotal = useMemo(() => items.reduce((sum, item) => sum + toNumber(item.system_quantity, 0), 0), [items]);
  const countedTotal = useMemo(() => items.reduce((sum, item) => sum + toNumber(item.counted_quantity, 0), 0), [items]);
  // Progress is COVERAGE — how many size rows have been visited — not a ratio of
  // quantities. A count that finds half the expected stock is not "50% done";
  // it is finished and short by half, which is the whole point of counting.
  // Only quantities the employee actually entered. A colour that was merely put
  // on the sheet also sits in the outbox (the server still has to create its
  // rows), and counting those made a freshly added colour read "5 of 5 counted".
  const countedRowKeys = useMemo(
    () => new Set(Object.entries(outbox).filter(([, entry]) => entry?.counted !== false).map(([id]) => id)),
    [outbox]
  );
  const visitedRows = useMemo(
    () =>
      items.filter((item) => {
        const id = String(item.product_variant_id ?? item.variant_id ?? item.id ?? "");
        if (countedRowKeys.has(id)) return true;
        if (item.counted_at) return true;
        return Boolean(item.counted_by_name) || toNumber(item.counted_quantity, 0) > 0;
      }).length,
    [items, countedRowKeys]
  );
  const progressPercent = useMemo(() => {
    if (!items.length) return 0;
    return Math.max(0, Math.min(100, Math.round((visitedRows / items.length) * 100)));
  }, [items.length, visitedRows]);
  const pendingCount = useMemo(() => outboxSize(outbox), [outbox]);

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
        title: tt("employeePortal.stockCount.new"),
        notes: "",
      });
      const created = response?.session || null;
      if (created?.id) {
        await loadSessions();
        navigate(`/employee-portal/${encodeURIComponent(token)}/inventory/${encodeURIComponent(created.id)}`);
        await loadSession(created.id);
        toast.success(tt("employeePortal.stockCount.created"));
      }
    } catch (error) {
      toast.error(error?.responseBody?.message || error?.message || tt("employeePortal.stockCount.createFailed"));
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
        if (!cancelled) toast.error(error?.responseBody?.message || error?.message || tt("employeePortal.stockCount.openTaskFailed"));
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
      toast.success(tt("employeePortal.stockCount.saved"));
    } catch (error) {
      toast.error(error?.responseBody?.message || error?.message || tt("employeePortal.stockCount.saveFailed"));
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
      toast.success(tt("employeePortal.stockCount.started"));
    } catch (error) {
      toast.error(error?.responseBody?.message || error?.message || tt("employeePortal.stockCount.startFailed"));
    } finally {
      setSessionOpening(false);
    }
  }, [refreshCurrentSession, session?.id, token]);

  const handleSubmitSession = useCallback(async () => {
    if (!session?.id) return;
    try {
      setSessionSubmitting(true);
      // Nothing may be submitted for review while a counted quantity is still
      // sitting on the phone: a manager would be approving an incomplete count.
      if (outboxSize(outboxRef.current)) {
        // The trailing flush may already be mid-request, which makes the first
        // attempt a no-op rather than a failure — one short retry tells the two
        // apart before accusing the employee of having no connection.
        let flushed = await flushOutbox({ silent: false });
        if (!flushed && outboxSize(outboxRef.current)) {
          await new Promise((resolve) => window.setTimeout(resolve, 900));
          flushed = await flushOutbox({ silent: false });
        }
        if (!flushed) {
          toast.error(tt("employeePortal.stockCount.submitNeedsSync", { count: outboxSize(outboxRef.current) }));
          return;
        }
      }
      const response = await submitEmployeePortalInventorySession(token, session.id);
      if (response?.session) setSession(response.session);
      await refreshCurrentSession();
      toast.success(tt("employeePortal.stockCount.submitted"));
    } catch (error) {
      toast.error(error?.responseBody?.message || error?.message || tt("employeePortal.stockCount.submitFailed"));
    } finally {
      setSessionSubmitting(false);
    }
  }, [flushOutbox, refreshCurrentSession, session?.id, token]);

  const handleReopenSession = useCallback(async () => {
    if (!session?.id) return;
    try {
      setSessionReopening(true);
      const response = await reopenEmployeePortalInventorySession(token, session.id);
      if (response?.session) setSession(response.session);
      await refreshCurrentSession();
      toast.success(tt("employeePortal.stockCount.reopened"));
    } catch (error) {
      toast.error(error?.responseBody?.message || error?.message || tt("employeePortal.stockCount.reopenFailed"));
    } finally {
      setSessionReopening(false);
    }
  }, [refreshCurrentSession, session?.id, token]);

  // Bring a colour's card into view and flash it: the answer to "where did the
  // thing I just added go" on a sheet that can be fifty colours long.
  const revealGroup = useCallback((variantLike) => {
    const variantId = String(variantLike?.product_variant_id ?? variantLike?.variant_id ?? variantLike?.variantIds?.[0] ?? variantLike?.id ?? "");
    if (!variantId || typeof window === "undefined") return;
    // A timer, not requestAnimationFrame: rAF never fires while the tab is in the
    // background, and the card has to exist (React has committed) either way.
    window.setTimeout(() => {
      const node = document.querySelector(`[data-count-variant~="v${variantId}"]`);
      if (!node) return;
      node.scrollIntoView({ behavior: "smooth", block: "center" });
      const key = node.getAttribute("data-count-group") || "";
      setFlashGroupKey(key);
      window.setTimeout(() => setFlashGroupKey((current) => (current === key ? "" : current)), 1600);
    }, 60);
  }, []);

  /**
   * Put a colour's whole size run on the sheet.
   *
   * Local first: the sizes appear immediately and the rows are owed to the
   * server through the outbox, so adding a colour works with no signal and does
   * not make the employee wait. They are queued as NOT counted — the employee
   * has only listed the colour, and the product history must not claim they
   * counted a size they have not touched.
   */
  const addColorGroup = useCallback(async (group) => {
    if (!group?.variants?.length || !session?.id || !isEditable) return;
    const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
    let completeGroup = group;

    // A group from the phone's index already holds the colour's whole size run,
    // so it goes on the sheet at once. Only a group from a capped server page
    // (`complete: false`) is re-resolved — that lookup used to run on EVERY add
    // and was the wait between tapping "add" and seeing the sizes.
    if (online && group.complete !== true) {
      // The online search returns a capped page, so a colour can come back with
      // only some of its sizes; re-resolve it by code before adding.
      const seedVariant = group.variants[0] || {};
      const exactLookupValue = clean(
        seedVariant.sku ||
        seedVariant.barcode ||
        seedVariant.article_code ||
        seedVariant.product_sku ||
        seedVariant.product_barcode ||
        ""
      );
      if (exactLookupValue) {
        try {
          setItemSavingId(group.key);
          const response = await lookupEmployeePortalInventoryVariants(token, session.id, { query: exactLookupValue, limit: 25 });
          const completeResults = Array.isArray(response?.items) ? response.items.map((row) => normalizeVariant(row)) : [];
          const seedProductId = seedVariant.product_id ?? null;
          const seedColorKey = normalizeColorKey(seedVariant.color || "");
          const resolvedGroup = groupVariants(completeResults).find((entry) =>
            String(entry.product_id ?? "") === String(seedProductId ?? "") &&
            normalizeColorKey(entry.color || "") === seedColorKey
          );
          if (resolvedGroup?.variants?.length) completeGroup = resolvedGroup;
        } catch (error) {
          if (isOfflineFailure(error)) setOnline(false);
          // Fall through with what the search already gave us.
        } finally {
          setItemSavingId("");
        }
      }
    }

    // Which sizes are genuinely new is decided HERE, off the live rows ref —
    // not inside the setItems updater. React runs that updater lazily, so a list
    // collected inside it is still empty on the next line, and the rows would
    // reach the screen while never reaching the outbox: the colour would show on
    // the employee's phone and be missing from the sheet the manager reviews.
    const known = new Set(itemsRef.current.map((row) => String(row.product_variant_id ?? row.variant_id ?? row.id ?? "")));
    const added = [];
    for (const variant of completeGroup.variants) {
      const variantId = String(variant.product_variant_id ?? variant.variant_id ?? variant.id ?? "");
      if (!variantId || known.has(variantId)) continue;
      known.add(variantId);
      const row = normalizeVariant({ ...variant, counted_quantity: 0 });
      added.push({ ...row, counted_quantity: 0, difference_quantity: -toNumber(row.system_quantity, 0) });
    }
    if (!added.length) return;

    setItems((current) => {
      const present = new Set(current.map((row) => String(row.product_variant_id ?? row.variant_id ?? row.id ?? "")));
      return [...current, ...added.filter((row) => !present.has(String(row.product_variant_id ?? row.variant_id ?? row.id ?? "")))];
    });
    setOutbox((current) => added.reduce((acc, row) => queueCountedQuantity(acc, {
      variantId: String(row.product_variant_id ?? row.variant_id ?? row.id ?? ""),
      countedQuantity: 0,
      systemQuantity: toNumber(row.system_quantity, 0),
      counted: false,
    }), current));
    logDevDuration("add color group", startedAt, { groupKey: group.key, variantCount: completeGroup.variants.length, added: added.length });
    revealGroup(added[0]);
  }, [isEditable, online, revealGroup, session?.id, token]);

  const serverGroupsFor = useCallback(async (query, limit) => {
    const response = await lookupEmployeePortalInventoryVariants(token, session.id, { query, limit });
    const rows = Array.isArray(response?.items) ? response.items.map((row) => normalizeVariant(row)) : [];
    return groupVariants(rows).map((entry) => ({ ...entry, complete: false }));
  }, [session?.id, token]);

  // A count launched from a task adds the task's model by itself: the phone's
  // index first, the server only if the phone does not know the product.
  useEffect(() => {
    const taskId = clean(searchParams.get("taskId"));
    const taskQuery = clean(searchParams.get("query"));
    if (!taskId || !taskQuery || taskAutoAddHandledRef.current || !session?.id || !isEditable) return;
    if (!searchIndex.length && catalogLoading) return; // the catalogue is on its way
    taskAutoAddHandledRef.current = true;
    const addTaskModel = async () => {
      try {
        let groups = searchCountIndex(searchIndex, taskQuery, { limit: 100 }).groups.map((entry) => ({ ...entry, complete: true }));
        if (!groups.length && online) groups = await serverGroupsFor(taskQuery, 100);
        if (!groups.length) return;
        for (const group of groups) await addColorGroup(group);
        toast.success(tt("employeePortal.stockCount.modelAdded"));
      } catch (error) {
        toast.error(error?.responseBody?.message || error?.message || tt("employeePortal.stockCount.addColorFailed"));
      }
    };
    void addTaskModel();
  }, [addColorGroup, catalogLoading, isEditable, online, searchIndex, searchParams, serverGroupsFor, session?.id]);

  // A scan is an exact code. The phone resolves it at once; the server is asked
  // only for a code the phone has never seen.
  const handleScan = useCallback(async (value) => {
    const query = clean(value);
    if (!session?.id || !query || !isEditable) return false;
    const deviceGroup = findCountGroupByCode(searchIndex, query);
    if (deviceGroup) {
      await addColorGroup({ ...deviceGroup, complete: true });
      return true;
    }
    if (!online) {
      toast.error(tt("employeePortal.scanner.noMatchingProduct"));
      return false;
    }
    try {
      const groups = await serverGroupsFor(query, 20);
      const match = groups.find((entry) => entry.variants.some((variant) => isExactVariantMatch(query, variant)));
      if (!match) {
        toast.error(tt("employeePortal.scanner.noMatchingProduct"));
        return false;
      }
      await addColorGroup(match);
      return true;
    } catch (error) {
      if (isOfflineFailure(error)) setOnline(false);
      toast.error(isOfflineFailure(error) ? tt("employeePortal.scanner.noMatchingProduct") : error?.responseBody?.message || error?.message || tt("employeePortal.scanner.readFailed"));
      return false;
    }
  }, [addColorGroup, isEditable, online, searchIndex, serverGroupsFor, session?.id]);

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

  /**
   * Record a counted quantity. Local state and the outbox only — no request.
   *
   * This is the whole speed story: the old path fired a save per tap and made a
   * long count feel like waiting on a server, and made a count impossible with
   * no signal. The quantity is the employee's as soon as they tap it; the
   * server hears about it when the network allows.
   */
  const setVariantCount = useCallback((variant, nextValue) => {
    if (!isEditable) return;
    const variantId = String(variant.product_variant_id ?? variant.variant_id ?? variant.id ?? "");
    if (!variantId) return;
    const counted = Math.max(0, toNumber(nextValue, 0));
    const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
    handleVariantCountChange(variantId, counted);
    setOutbox((current) => queueCountedQuantity(current, {
      variantId,
      countedQuantity: counted,
      systemQuantity: toNumber(variant.system_quantity, 0),
      countedAt: new Date().toISOString(),
    }));
    logDevDuration("count recorded locally", startedAt, { variantId, counted });
  }, [handleVariantCountChange, isEditable]);

  const adjustVariantCount = useCallback((variant, delta) => {
    setVariantCount(variant, toNumber(variant.counted_quantity, 0) + Number(delta || 0));
  }, [setVariantCount]);

  const handleDeleteColorGroup = useCallback(async (group) => {
    if (!session?.id || !isEditable) return;
    const productId = group?.product_id ?? group?.variants?.[0]?.product_id ?? null;
    const color = clean(group?.color || "");
    if (!productId || !color) {
      toast.error(tt("employeePortal.stockCount.colorNotResolved"));
      return;
    }
    const confirmed = window.confirm(tt("employeePortal.stockCount.confirmDeleteColor"));
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
      toast.success(tt("employeePortal.stockCount.colorDeleted"));
    } catch (error) {
      toast.error(error?.responseBody?.message || error?.message || tt("employeePortal.stockCount.deleteColorFailed"));
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
    ? tt("employeePortal.status.balanced")
    : differenceTotal > 0
      ? `زيادة: ${Math.abs(differenceTotal)}`
      : `عجز: ${Math.abs(differenceTotal)}`;

  return (
    <div dir="rtl" className={`${searchActive ? "inventory-searching " : ""}employee-portal-workspace employee-portal-inventory min-h-screen bg-background px-3 py-3 text-text sm:px-4 sm:py-4`}>
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
        /* Size tiles: as many as fit, never narrower than a thumb-sized
           stepper plus a two-digit quantity. */
        .employee-portal-inventory .inventory-size-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(168px, 1fr));
          gap: 8px;
        }
        .employee-portal-inventory .inventory-size-tile {
          min-width: 0;
        }
        /* A colour that was just added or jumped to announces itself once. */
        @keyframes inventory-card-flash {
          0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--primary) 55%, transparent); }
          100% { box-shadow: 0 0 0 14px transparent; }
        }
        .employee-portal-inventory .inventory-color-card { scroll-margin-top: 220px; content-visibility: auto; contain-intrinsic-size: auto 260px; }
        .employee-portal-inventory .inventory-color-card--flash { animation: inventory-card-flash 0.8s ease-out 2; }
        @media (prefers-reduced-motion: reduce) {
          .employee-portal-inventory .inventory-color-card--flash { animation: none; }
        }
        /* The send button follows the thumb through a long count. */
        .employee-portal-inventory .inventory-send-bar {
          position: sticky;
          bottom: 0;
          z-index: 20;
          margin: 0 -2px;
          padding: 8px 2px calc(8px + env(safe-area-inset-bottom, 0px));
          background: linear-gradient(180deg, transparent 0%, color-mix(in srgb, var(--bg) 92%, transparent) 42%, var(--bg) 100%);
        }
        /* The count header follows the sizes so progress and the sync state are
           always one glance away. */
        .employee-portal-inventory .inventory-head {
          position: sticky;
          top: 0;
          z-index: 21;
        }
        /* While searching, the header lets go: the search box has to reach the top
           of the screen so its results clear the phone's keyboard. */
        .employee-portal-inventory.inventory-searching .inventory-head {
          position: static;
        }
        .employee-portal-inventory .inventory-search-card {
          scroll-margin-top: 8px;
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
          className="px-0"
        />

        <section className="rounded-[var(--radius-card)] border border-border bg-surface/95 p-2.5 shadow-[var(--shadow-card)] backdrop-blur sm:rounded-[2rem] sm:p-4 sm:shadow-[var(--shadow-overlay)]">
          <div className="inventory-wrap flex min-w-0 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="hidden items-center gap-2 text-success sm:flex">
                <Warehouse className="h-5 w-5" />
                <span className="text-xs font-black uppercase tracking-[0.18em]">{tt("employeePortal.shell.title")}</span>
              </div>
              <h1 className="m1-page-title text-text sm:mt-2">{tt("employeePortal.nav.stockCount")}</h1>
              <div className="mt-2 hidden max-w-3xl rounded-2xl border border-primary/30 bg-primary-subtle px-3 py-2 text-xs font-bold leading-5 text-text sm:inline-flex sm:text-sm">
                {tt("employeePortal.stockCount.reviewHint")}
              </div>
            </div>
            <div className="inventory-actions flex min-w-0 gap-2">
              <button
                type="button"
                onClick={() => setBranchDrawerOpen(true)}
                className="inline-flex min-h-[var(--control-height-lg)] items-center justify-center gap-2 rounded-[var(--radius-control)] border border-border bg-surface px-4 text-sm font-black text-text lg:hidden"
                aria-label={tt("employeePortal.stockCount.branchCounts")}
              >
                <Menu className="h-4 w-4" />
                {tt("employeePortal.stockCount.branchCounts")}
              </button>
              <button
                type="button"
                onClick={loadSessions}
                className="hidden min-h-[var(--control-height-lg)] items-center justify-center gap-2 rounded-[var(--radius-control)] border border-border bg-surface px-4 text-sm font-black text-text lg:inline-flex"
              >
                <RefreshCw className="h-4 w-4" />
                {tt("employeePortal.common.refresh")}
              </button>
              <button
                type="button"
                onClick={handleCreateSession}
                disabled={sessionSaving}
                className="hidden min-h-[var(--control-height-lg)] items-center justify-center gap-2 rounded-[var(--radius-control)] bg-primary px-4 text-sm font-black text-[var(--primary-contrast)] disabled:opacity-60 lg:inline-flex"
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
                className={`rounded-full border px-4 py-2 text-sm font-black transition ${ statusFilter === filter.value ? "border-border bg-primary text-[var(--primary-contrast)]" : "border-border bg-surface text-text-muted" }`}
              >
                {tt(filter.labelKey)}
              </button>
            ))}
          </div>
        </section>

        <div className="grid min-w-0 gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="inventory-wrap hidden rounded-[2rem] border border-border bg-surface/95 p-4 shadow-[var(--shadow-overlay)] backdrop-blur lg:block">
            <div className="flex min-w-0 items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="m1-section-title text-text">{tt("employeePortal.stockCount.branchCounts")}</h2>
                <p className="text-xs font-semibold text-text-muted">{tt("employeePortal.stockCount.filterHint")}</p>
              </div>
              <span className="rounded-full bg-surface-soft px-3 py-1 text-xs font-black text-text">{visibleSessions.length}</span>
            </div>
            <label className="inventory-wrap mt-3 block rounded-[var(--radius-card)] border border-border bg-surface px-3 py-2 shadow-sm">
              <div className="flex items-center gap-2 text-xs font-black text-text-muted">
                <Search className="h-4 w-4" />
                {tt("employeePortal.common.search")}
              </div>
              <input
                value={sessionSearch}
                onChange={(event) => setSessionSearch(event.target.value)}
                placeholder={tt("employeePortal.stockCount.searchPlaceholder")}
                className="mt-1 w-full bg-transparent text-base font-semibold text-text outline-none placeholder:text-text-muted"
              />
            </label>

            <div className="mt-4 space-y-2">
              {sessionsLoading ? (
                <div className="rounded-2xl border border-border bg-surface-soft p-4 text-sm font-bold text-text-muted">{tt("employeePortal.common.loading")}</div>
              ) : sessionsError ? (
                <div className="rounded-2xl border border-border bg-danger-subtle p-4 text-sm font-bold leading-6 text-text">{sessionsError}</div>
              ) : visibleSessions.length ? (
                visibleSessions.map((row) => {
                  const active = String(row.id) === String(selectedSessionId);
                  const status = String(row.status || "draft");
                  return (
                    <button
                      key={row.id}
                      type="button"
                      onClick={() => selectSession(row.id)}
                      className={`w-full rounded-[var(--radius-control)] border p-3 text-right transition ${ active ? "border-border bg-success-subtle shadow-sm" : "border-border bg-surface hover:bg-surface-soft" }`}
                    >
              <div className="flex min-w-0 items-start justify-between gap-3">
                <div className="min-w-0">
                          <div className="truncate text-sm font-black text-text">{row.title || tt("employeePortal.stockCount.new")}</div>
                          <div className="mt-1 text-xs font-semibold text-text-muted">
                            {row.branch_name || tt("employeePortal.common.branch")}{row.warehouse_name ? ` • ${row.warehouse_name}` : ""}
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
                <div className="rounded-2xl border border-border bg-surface-soft p-4 text-sm font-bold leading-6 text-text-muted">
                  {tt("employeePortal.stockCount.noMatch")}
                </div>
              )}
            </div>
          </aside>

          <main className="inventory-wrap rounded-[var(--radius-card)] border border-border bg-surface/95 p-2.5 shadow-[var(--shadow-card)] backdrop-blur sm:rounded-[2rem] sm:p-4 sm:shadow-[var(--shadow-overlay)]">
            {!session && sessionLoading ? (
              <div className="flex min-h-[420px] items-center justify-center gap-2 text-sm font-black text-text-muted">
                <Loader2 className="h-4 w-4 animate-spin" />
                {tt("employeePortal.stockCount.loading")}
              </div>
            ) : !session ? (
              <div className="flex min-h-[420px] flex-col items-center justify-center rounded-[1.5rem] border border-dashed border-border bg-surface-soft px-6 text-center">
                <ClipboardList className="h-12 w-12 text-text-muted" />
                <h2 className="m1-section-title mt-4 text-text">{tt("employeePortal.stockCount.pickOrCreate")}</h2>
                <p className="mt-2 max-w-lg text-sm font-semibold leading-6 text-text-muted">
                  {tt("employeePortal.stockCount.scopeHint")}
                </p>
              </div>
            ) : (
              <div className="space-y-2.5 sm:space-y-4">
                {/* Count header: what is being counted, how far it has got, and
                    whether anything is still owed to the server. Everything the
                    employee needs to trust the sheet, in one strip. */}
                <div className="inventory-head inventory-wrap rounded-[1.25rem] border border-border bg-surface p-2.5 shadow-sm">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <h2 className="m1-section-title min-w-0 flex-1 truncate text-text">{titleDraft || session.title || tt("employeePortal.stockCount.new")}</h2>
                    <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-black ${sessionStatusTone[session.status] || sessionStatusTone.draft}`}>
                      {sessionStatusLabels[session.status] || session.status}
                    </span>
                  </div>
                  <div className="mt-0.5 truncate text-xs font-semibold text-text-muted">
                    {session.branch_name || tt("employeePortal.common.branch")}{session.warehouse_name ? ` • ${session.warehouse_name}` : ""}
                  </div>

                  <div className="mt-2 grid grid-cols-3 gap-1.5 text-center">
                    <div className="rounded-[var(--radius-control)] border border-border bg-surface-soft px-1.5 py-1.5">
                      <div className="text-base font-black leading-5 text-text">{groupedItems.length}</div>
                      <div className="truncate text-[10px] font-bold text-text-muted">{tt("employeePortal.stockCount.colorsCounted")}</div>
                    </div>
                    <div className="rounded-[var(--radius-control)] border border-border bg-surface-soft px-1.5 py-1.5">
                      <div className="text-base font-black leading-5 text-text">{countedTotal}</div>
                      <div className="truncate text-[10px] font-bold text-text-muted">{tt("employeePortal.stockCount.piecesCounted")}</div>
                    </div>
                    <div className={`rounded-[var(--radius-control)] border px-1.5 py-1.5 ${differenceTotal === 0 ? "border-border bg-success-subtle" : differenceTotal > 0 ? "border-border bg-warning-subtle" : "border-border bg-danger-subtle"}`}>
                      <div className={`text-base font-black leading-5 ${differenceTotal === 0 ? "text-success" : differenceTotal > 0 ? "text-warning" : "text-danger"}`} dir="ltr">
                        {differenceTotal > 0 ? `+${differenceTotal}` : differenceTotal}
                      </div>
                      <div className="truncate text-[10px] font-bold text-text-muted">{tt("employeePortal.chrome.differences")}</div>
                    </div>
                  </div>

                  <div className="mt-2 flex items-center justify-between gap-2 text-[11px] font-black text-text-muted">
                    <span>{tt("employeePortal.stockCount.coverage", { done: visitedRows, total: items.length })}</span>
                    <span dir="ltr">{progressPercent}%</span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-soft">
                    <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progressPercent}%` }} />
                  </div>

                  {/* The sync line is the offline promise made visible: counted
                      rows are safe on the device, and this says what is still
                      owed to the server. */}
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-black ${online ? "border-border bg-success-subtle text-text" : "border-border bg-warning-subtle text-text"}`}>
                      {online ? <Wifi className="h-3.5 w-3.5" /> : <CloudOff className="h-3.5 w-3.5" />}
                      {online ? tt("employeePortal.stockCount.online") : tt("employeePortal.stockCount.offline")}
                    </span>
                    {pendingCount ? (
                      <button
                        type="button"
                        onClick={() => flushOutbox({ silent: false })}
                        disabled={syncing || !online}
                        className="inline-flex items-center gap-1 rounded-full border border-border bg-warning-subtle px-2 py-1 text-[11px] font-black text-text disabled:opacity-60"
                      >
                        {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                        {tt("employeePortal.stockCount.pendingRows", { count: pendingCount })}
                      </button>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-soft px-2 py-1 text-[11px] font-black text-text-muted">
                        <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                        {tt("employeePortal.stockCount.allSynced")}
                        {lastSyncedAt ? (
                          <span className="font-bold text-text-muted" dir="ltr">
                            {new Date(lastSyncedAt).toLocaleTimeString(i18nRuntime.language === "en" ? "en-GB" : "ar-EG", { hour: "numeric", minute: "2-digit" })}
                          </span>
                        ) : null}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={refreshOfflineCatalog}
                      disabled={catalogLoading || !online}
                      className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2 py-1 text-[11px] font-black text-text-muted disabled:opacity-60"
                      title={tt("employeePortal.stockCount.catalogHint")}
                    >
                      {catalogLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ScanBarcode className="h-3.5 w-3.5" />}
                      {catalogSnapshot?.variants?.length
                        ? tt("employeePortal.stockCount.catalogReady", { count: catalogSnapshot.variants.length })
                        : tt("employeePortal.stockCount.catalogDownload")}
                    </button>
                  </div>

                  {session.status === "draft" ? (
                    <button
                      type="button"
                      onClick={handleOpenSession}
                      disabled={sessionOpening}
                      className="mt-2 inline-flex min-h-[var(--control-height-md)] w-full items-center justify-center gap-2 rounded-[var(--radius-control)] border border-border bg-surface px-3 text-xs font-black text-text disabled:opacity-60"
                    >
                      {sessionOpening ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardList className="h-4 w-4" />}
                      بدء الجرد
                    </button>
                  ) : null}
                </div>

                {isPendingReview ? (
                  <div className="rounded-2xl border border-primary/30 bg-primary-subtle px-4 py-3 text-sm font-black text-text">
                    {tt("employeePortal.stockCount.submitted")}
                  </div>
                ) : null}

                {isRejected ? (
                  <div className="rounded-2xl border border-border bg-danger-subtle px-4 py-3 text-sm font-bold leading-6 text-text">
                    <div className="font-black">{tt("employeePortal.stockCount.rejectionReason")}</div>
                    <div className="mt-1">{clean(session.rejection_reason || session.rejectionReason || "") || tt("employeePortal.stockCount.noReasonGiven")}</div>
                    <button
                      type="button"
                      onClick={handleReopenSession}
                      disabled={sessionReopening}
                      className="mt-3 inline-flex min-h-[var(--control-height-lg)] items-center justify-center gap-2 rounded-[var(--radius-control)] bg-danger px-4 text-sm font-black text-[var(--primary-contrast)] disabled:opacity-60"
                    >
                      {sessionReopening ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                      إعادة فتح للتعديل
                    </button>
                  </div>
                ) : null}

                {/* Name and notes are set once at the start and never during the
                    count itself, so they fold away instead of pushing the sizes
                    off the first screen. */}
                <details className="inventory-wrap rounded-[var(--radius-card)] border border-border bg-surface shadow-sm">
                  <summary className="cursor-pointer list-none px-3 py-2.5 text-xs font-black text-text-muted">
                    {tt("employeePortal.stockCount.details")}
                  </summary>
                  <div className="grid min-w-0 gap-2 px-3 pb-3 lg:grid-cols-[1fr_1fr]">
                    <label className="inventory-wrap block rounded-[var(--radius-control)] border border-border bg-surface-soft p-2.5">
                      <div className="text-xs font-black text-text-muted">{tt("employeePortal.stockCount.name")}</div>
                      <input
                        value={titleDraft}
                        onChange={(event) => setTitleDraft(event.target.value)}
                        disabled={!isEditable}
                        className="mt-1.5 w-full bg-transparent text-base font-semibold text-text outline-none disabled:opacity-70"
                      />
                    </label>
                    <label className="inventory-wrap block rounded-[var(--radius-control)] border border-border bg-surface-soft p-2.5">
                      <div className="text-xs font-black text-text-muted">{tt("employeePortal.common.notes")}</div>
                      <input
                        value={notesDraft}
                        onChange={(event) => setNotesDraft(event.target.value)}
                        disabled={!isEditable}
                        className="mt-1.5 w-full bg-transparent text-base font-semibold text-text outline-none disabled:opacity-70"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={handleSaveSessionMeta}
                      disabled={sessionSaving || !isEditable || !online}
                      className="inline-flex min-h-[var(--control-height-md)] items-center justify-center gap-2 rounded-[var(--radius-control)] border border-border bg-surface px-3 text-sm font-black text-text disabled:opacity-60 lg:col-span-2"
                    >
                      {sessionSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      {tt("employeePortal.common.save")}
                    </button>
                  </div>
                </details>

                <CountProductSearch
                  snapshot={catalogSnapshot}
                  filters={filters}
                  selectedSize={selectedFilterSize}
                  activeFilterCount={activeFilterCount}
                  filtersOpen={filtersOpen}
                  onOpenFilters={openFilters}
                  onResetFilters={resetFilters}
                  onOpenScanner={openScanner}
                  disabled={!isEditable}
                  online={online}
                  token={token}
                  sessionId={session.id}
                  sheetVariantIds={sheetVariantIds}
                  onAdd={addColorGroup}
                  onJump={revealGroup}
                  onActiveChange={setSearchActive}
                />

                <section className="inventory-wrap rounded-[1.5rem] border border-border bg-surface p-2.5 shadow-sm sm:p-3">
                  <div className="flex min-w-0 items-start justify-between gap-3">
                    <div className="inventory-title">
                      <h3 className="m1-section-title text-text">{tt("employeePortal.stockCount.items")}</h3>
                      <p className="text-xs font-semibold text-text-muted">
                        المتوقع: {expectedTotal} • الفعلي: {countedTotal} • الفرق: {currentBalance}
                      </p>
                    </div>
                    <div className="shrink-0 rounded-full border border-border bg-surface-soft px-3 py-1 text-xs font-black text-text-muted">
                      {groupedItems.length} لون
                    </div>
                  </div>

                  <div className="mt-3 space-y-2.5">
                    {groupedItems.length ? groupedItems.map((group) => (
                      <CountColorCard
                        key={group.key}
                        group={group}
                        signature={groupSignature(group, outbox)}
                        outbox={outbox}
                        isEditable={isEditable}
                        deleting={itemSavingId === group.key}
                        flash={flashGroupKey === group.key}
                        onAdjust={adjustVariantCount}
                        onSet={setVariantCount}
                        onDelete={handleDeleteColorGroup}
                      />
                    )) : (
                      <div className="rounded-2xl border border-dashed border-border bg-surface-soft p-6 text-sm font-bold leading-6 text-text-muted">
                        {tt("employeePortal.stockCount.noItemsYet")}
                      </div>
                    )}
                  </div>
                </section>

                {/* The send button stays under the thumb for the whole count,
                    and never lets a quantity still sitting on the phone pass
                    as a reviewed count. */}
                {isEditable ? (
                  <div className="inventory-send-bar">
                    <button
                      type="button"
                      onClick={handleSubmitSession}
                      disabled={sessionSubmitting || !items.length}
                      className="inline-flex min-h-[var(--control-height-lg)] w-full items-center justify-center gap-2 rounded-[var(--radius-control)] bg-primary px-4 text-sm font-black text-[var(--primary-contrast)] shadow-[var(--shadow-card)] disabled:opacity-60"
                    >
                      {sessionSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                      {pendingCount ? tt("employeePortal.stockCount.sendWithPending", { count: pendingCount }) : "إرسال للمراجعة"}
                    </button>
                  </div>
                ) : null}
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
      className="fixed inset-0 z-[2147483001] bg-surface-soft backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        className="absolute inset-y-0 end-0 flex h-full w-[min(100vw,22rem)] flex-col border-s border-border bg-surface shadow-[var(--shadow-overlay)] "
        dir="rtl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="branch-inventory-drawer-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-4">
          <div className="min-w-0">
            <div className="text-[10px] font-black uppercase tracking-[0.2em] text-success">{tt("employeePortal.shell.title")}</div>
            <h2 id="branch-inventory-drawer-title" className="m1-section-title mt-1 text-text">{tt("employeePortal.stockCount.branchCounts")}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-[var(--control-height-lg)] w-11 items-center justify-center rounded-[var(--radius-control)] border border-border bg-surface text-text shadow-sm"
            aria-label={tt("employeePortal.common.close")}
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
                className={`rounded-full border px-3 py-2 text-xs font-black transition ${ statusFilter === filter.value ? "border-border bg-primary text-[var(--primary-contrast)]" : "border-border bg-surface text-text-muted" }`}
              >
                {tt(filter.labelKey)}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={onCreateSession}
            disabled={sessionSaving}
            className="mt-4 inline-flex min-h-[var(--control-height-lg)] w-full items-center justify-center gap-2 rounded-[var(--radius-control)] bg-primary px-4 text-sm font-black text-[var(--primary-contrast)] disabled:opacity-60"
          >
            {sessionSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            جرد جديد
          </button>

          <label className="mt-4 block rounded-[var(--radius-card)] border border-border bg-surface px-3 py-2 shadow-sm">
            <div className="flex items-center gap-2 text-xs font-black text-text-muted">
              <Search className="h-4 w-4" />
              {tt("employeePortal.common.search")}
            </div>
            <input
              value={sessionSearch}
              onChange={(event) => setSessionSearch(event.target.value)}
              placeholder={tt("employeePortal.stockCount.searchPlaceholder")}
              className="mt-1 w-full bg-transparent text-base font-semibold text-text outline-none placeholder:text-text-muted"
            />
          </label>

          <div className="mt-4 flex items-center justify-between gap-3">
            <div className="text-sm font-black text-text">{tt("employeePortal.nav.menu")}</div>
            <span className="rounded-full bg-surface-soft px-3 py-1 text-xs font-black text-text">{visibleSessions.length}</span>
          </div>

          <div className="mt-3 space-y-2">
            {sessionsLoading ? (
              <div className="rounded-2xl border border-border bg-surface-soft p-4 text-sm font-bold text-text-muted">{tt("employeePortal.common.loadingAlt")}</div>
            ) : sessionsError ? (
              <div className="rounded-2xl border border-border bg-danger-subtle p-4 text-sm font-bold leading-6 text-text">{sessionsError}</div>
            ) : visibleSessions.length ? (
              visibleSessions.map((row) => {
                const active = String(row.id) === String(selectedSessionId);
                const status = String(row.status || "draft");
                return (
                  <button
                    key={row.id}
                    type="button"
                    onClick={() => onSelectSession(row.id)}
                    className={`w-full rounded-[var(--radius-control)] border p-3 text-right transition ${ active ? "border-border bg-success-subtle shadow-sm" : "border-border bg-surface hover:bg-surface-soft" }`}
                  >
                    <div className="flex min-w-0 items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-black text-text">{row.title || tt("employeePortal.stockCount.new")}</div>
                        <div className="mt-1 text-xs font-semibold text-text-muted">
                          {row.branch_name || tt("employeePortal.common.branch")}{row.warehouse_name ? ` • ${row.warehouse_name}` : ""}
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
              <div className="rounded-2xl border border-border bg-surface-soft p-4 text-sm font-bold leading-6 text-text-muted">
                {tt("employeePortal.stockCount.noMatch")}
              </div>
            )}
          </div>
        </div>
      </aside>
    </div>,
    document.body
  );
}
