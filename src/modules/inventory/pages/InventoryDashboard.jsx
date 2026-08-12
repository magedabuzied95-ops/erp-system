import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

import {
  AlertTriangle,
  Clock3,
  Filter,
  Layers3,
  Package,
  Search,
  ShoppingBag,
} from "lucide-react";

import toast from "react-hot-toast";
import { api } from "../../../shared/api/api";
import InventoryShell from "../components/InventoryShell";
import StatusBadge from "../../purchases/components/StatusBadge";
import {
  deriveInventoryKpis,
  formatCurrency,
  formatDateTime,
  getInventoryAdjustments,
  getInventoryMovements,
  normalizeWarehouse,
  seedWarehouses,
} from "../../purchases/lib/flowStore";
import { safeSetLocalStorage } from "../../../utils/safeStorage";

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

const resolveLowStockCardImageUrl = (rows = []) => {
  const candidates = [];

  for (const row of rows) {
    candidates.push(
      row?.color_image_url,
      row?.variant_image_url,
      row?.image_url,
      row?.product_image,
      row?.product_image_url,
      row?.main_image,
      row?.main_image_url
    );
  }

  return candidates.map((value) => resolveImageUrl(value)).find(Boolean) || "";
};

const getLowStockCardPriority = (stock) => (Number(stock || 0) <= 0 ? 0 : 1);

const getLowStockRowStatus = (stock, threshold) => {
  const currentStock = Number(stock || 0);
  const lowStockThreshold = Number(threshold || 0);
  if (currentStock <= 0) return { label: "نفد", tone: "critical" };
  if (currentStock <= lowStockThreshold) return { label: "منخفض", tone: "warning" };
  return { label: "متاح", tone: "safe" };
};

const formatInventoryStatusLabel = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "active" || normalized === "متاح" || normalized === "نشط") return "نشط";
  if (normalized === "low" || normalized === "منخفض") return "منخفض";
  if (normalized === "inbound" || normalized === "incoming" || normalized === "وارد") return "وارد";
  if (normalized === "out" || normalized === "outbound" || normalized === "صادر") return "صادر";
  return value || "نشط";
};

const lowStockStatusPillClasses = {
  critical: "border-rose-300/30 bg-rose-500/15 text-rose-100",
  warning: "border-amber-300/30 bg-amber-500/15 text-amber-100",
  safe: "border-emerald-300/25 bg-emerald-500/15 text-emerald-100",
};

const lowStockCardClasses = {
  critical: "border-rose-400/35 bg-gradient-to-br from-rose-500/18 via-rose-500/10 to-orange-500/10 shadow-[0_18px_45px_rgba(190,24,93,0.16)]",
  warning: "border-amber-400/30 bg-gradient-to-br from-amber-500/14 via-white/[0.04] to-orange-500/10 shadow-[0_18px_45px_rgba(217,119,6,0.14)]",
};

const SMART_PURCHASE_DRAFT_STORAGE_KEY = "erp.purchases.smartPurchaseDraft";
const InlineLtrValue = ({ children, className = "" }) => (
  <span dir="ltr" style={{ unicodeBidi: "isolate" }} className={`inline-block tabular-nums ${className}`}>{children}</span>
);

function InventoryDashboard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [variants, setVariants] = useState([]);
  const [lowStockAlerts, setLowStockAlerts] = useState([]);
  const [purchaseAlerts, setPurchaseAlerts] = useState([]);
  const [selectedAlertKeys, setSelectedAlertKeys] = useState([]);
  const [creatingPurchaseDraft, setCreatingPurchaseDraft] = useState(false);
  const [warehouses, setWarehouses] = useState(seedWarehouses());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [purchaseAlertFilters, setPurchaseAlertFilters] = useState({
    brand: "all",
    category: "all",
    manufacturer: "all",
    alertType: "all",
  });

  const loadData = async () => {
    try {
      setLoading(true);
      setError("");
      const [variantsRes, warehousesRes, alertsRes, purchaseAlertsRes] = await Promise.allSettled([
        api.get("/variants-inventory?limit=200&page=1"),
        api.get("/warehouses"),
        api.get("/inventory/low-stock"),
        api.get("/inventory/purchase-alerts"),
      ]);

      if (variantsRes.status === "fulfilled") {
        const rows = Array.isArray(variantsRes.value.variants) ? variantsRes.value.variants : [];
        setVariants(rows);
      }

      if (warehousesRes.status === "fulfilled") {
        const rows = Array.isArray(warehousesRes.value) ? warehousesRes.value : warehousesRes.value?.warehouses || [];
        setWarehouses(rows.length ? rows.map(normalizeWarehouse) : seedWarehouses());
      }

      if (alertsRes.status === "fulfilled") {
        const rows = Array.isArray(alertsRes.value?.alerts) ? alertsRes.value.alerts : [];
        setLowStockAlerts(rows);
      } else {
        console.error("[inventory] failed to load low stock alerts:", alertsRes.reason);
        setLowStockAlerts([]);
      }

      if (purchaseAlertsRes?.status === "fulfilled") {
        const rows = Array.isArray(purchaseAlertsRes.value?.alerts) ? purchaseAlertsRes.value.alerts : [];
        setPurchaseAlerts(rows);
      } else {
        console.error("[inventory] failed to load purchase alerts:", purchaseAlertsRes?.reason);
        setPurchaseAlerts([]);
      }
    } catch (err) {
      console.log(err);
      setError(t("inventory.fallbackError"));
      toast.error(t("inventory.fallbackToast"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadData();
    }, 0);
    window.addEventListener("inventory:stock-updated", loadData);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("inventory:stock-updated", loadData);
    };
  }, []);

  const movements = getInventoryMovements();
  const adjustments = getInventoryAdjustments();
  const kpis = useMemo(() => deriveInventoryKpis({ variants, movements, adjustments }), [variants, movements, adjustments]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return variants.filter((variant) =>
      `${variant.product_name} ${variant.color} ${variant.size} ${variant.sku}`.toLowerCase().includes(query)
    );
  }, [variants, search]);

  const lowStockAlertCards = useMemo(() => {
    const query = search.trim().toLowerCase();
    const productMap = new Map();

    for (const variant of Array.isArray(variants) ? variants : []) {
      const productId = String(variant?.product_id || "").trim();
      if (!productId) continue;
      const current = productMap.get(productId) || {
        product_id: Number(variant.product_id || 0),
        product_slug: String(variant.product_slug || "").trim(),
        product_name: String(variant.product_name || variant.name || "").trim(),
        colors: new Set(),
        alert_rows: [],
        variant_rows: [],
      };
      current.variant_rows.push(variant);
      if (!current.product_name) current.product_name = String(variant.product_name || variant.name || "").trim();
      if (variant.color) current.colors.add(String(variant.color).trim());
      productMap.set(productId, current);
    }

    for (const alert of Array.isArray(lowStockAlerts) ? lowStockAlerts : []) {
      const productId = String(alert?.product_id || "").trim();
      const productSlug = String(alert?.product_slug || "").trim();
      const key = productId || productSlug;
      if (!key) continue;
      const current = productMap.get(key) || {
        product_id: Number(alert.product_id || 0),
        product_slug: productSlug,
        product_name: String(alert.product_name || "").trim(),
        colors: new Set(),
        alert_rows: [],
        variant_rows: [],
      };
      current.alert_rows.push(alert);
      if (!current.product_name) current.product_name = String(alert.product_name || "").trim();
      if (!current.product_slug && productSlug) current.product_slug = productSlug;
      if (alert.color) current.colors.add(String(alert.color).trim());
      productMap.set(key, current);
    }

    return Array.from(productMap.values())
      .map((group) => {
        const productVariants = Array.isArray(group.variant_rows) ? group.variant_rows : [];
        const alertRows = Array.isArray(group.alert_rows) ? group.alert_rows : [];
        const rows = productVariants.length
          ? productVariants
              .map((variant) => {
                const alertRow = alertRows.find((alert) => String(alert.variant_id || "") === String(variant.id || ""));
                return {
                  id: variant.id,
                  variant_id: variant.id,
                  product_id: variant.product_id,
                  product_name: variant.product_name || variant.name || group.product_name,
                  color: variant.color || alertRow?.color || "",
                  size: variant.size || alertRow?.size || "",
                  sku: variant.sku || alertRow?.sku || "",
                  stock: Number(variant.stock || alertRow?.stock || 0),
                  price: Number(variant.price || variant.sale_price || variant.selling_price || 0),
                  low_stock_alert: Number(variant.low_stock_alert || alertRow?.threshold || 2),
                  color_image_url: variant.color_image_url || alertRow?.color_image_url || "",
                  variant_image_url: variant.variant_image_url || alertRow?.variant_image_url || variant.image_url || alertRow?.image_url || "",
                  image_url: variant.image_url || alertRow?.image_url || "",
                  product_image: variant.product_image || alertRow?.product_image || "",
                  product_image_url: variant.product_image_url || alertRow?.product_image_url || "",
                  main_image: variant.main_image || alertRow?.main_image || "",
                  main_image_url: variant.main_image_url || alertRow?.main_image_url || "",
                };
              })
              .sort((left, right) => {
                if (left.stock !== right.stock) return left.stock - right.stock;
                return String(left.size || "").localeCompare(String(right.size || ""), "ar", { numeric: true });
              })
          : alertRows.map((alert) => ({
              id: alert.variant_id || `${alert.product_id || "product"}-${alert.size || "row"}`,
              variant_id: alert.variant_id || null,
              product_id: alert.product_id,
              product_name: alert.product_name || group.product_name,
              color: alert.color || "",
              size: alert.size || "",
              sku: alert.sku || "",
              stock: Number(alert.stock || alert.total_stock || 0),
              price: Number(alert.price || 0),
              low_stock_alert: Number(alert.threshold || alert.low_stock_alert || 2),
              color_image_url: alert.color_image_url || "",
              variant_image_url: alert.variant_image_url || "",
              image_url: alert.image_url || "",
              product_image: alert.product_image || "",
              product_image_url: alert.product_image_url || "",
              main_image: alert.main_image || "",
              main_image_url: alert.main_image_url || "",
            }));

        const totalStock = rows.reduce((sum, row) => sum + Number(row.stock || 0), 0);
        const totalValue = rows.reduce((sum, row) => sum + Number(row.stock || 0) * Number(row.price || 0), 0);
        const imageUrl = resolveLowStockCardImageUrl([...rows, ...alertRows]);
        const colors = Array.from(
          new Set(
            [
              ...group.colors,
              ...rows.map((row) => row.color).filter(Boolean),
              ...alertRows.map((row) => row.color).filter(Boolean),
            ]
              .map((value) => String(value).trim())
              .filter(Boolean)
          )
        );
        const threshold = Number(rows.find((row) => Number.isFinite(Number(row.low_stock_alert)) && Number(row.low_stock_alert) > 0)?.low_stock_alert || alertRows[0]?.threshold || 2);
        const cardStatus = totalStock <= 0 ? { label: "نفد", tone: "critical" } : { label: "منخفض", tone: "warning" };
        const cardKey = String(group.product_slug || group.product_id || group.product_name || "").trim();

        return {
          key: cardKey,
          product_id: group.product_id || alertRows[0]?.product_id || null,
          product_slug: group.product_slug || "",
          product_name: group.product_name || alertRows[0]?.product_name || t("common.notAvailable"),
          color: colors.length === 1 ? colors[0] : colors.join(" / "),
          colors,
          image_url: imageUrl,
          rows,
          total_stock: totalStock,
          total_value: totalValue,
          threshold,
          card_status: cardStatus,
          sort_priority: getLowStockCardPriority(totalStock),
          sort_stock: totalStock <= 0 ? 0 : totalStock,
        };
      })
      .sort((left, right) => {
        if (left.sort_priority !== right.sort_priority) return left.sort_priority - right.sort_priority;
        if (left.sort_stock !== right.sort_stock) return left.sort_stock - right.sort_stock;
        return String(left.product_name || "").localeCompare(String(right.product_name || ""), "ar");
      })
      .filter((card) => {
        if (!query) return true;
        const haystack = [
          card.product_name,
          card.color,
          ...card.rows.flatMap((row) => [row.size, row.sku, row.color]),
        ]
          .map((value) => String(value || "").toLowerCase())
          .join(" ");
        return haystack.includes(query);
      });
  }, [lowStockAlerts, search, t, variants]);

  const purchaseAlertOptions = useMemo(() => {
    const unique = (rows, key) => ["all", ...new Set(rows.map((row) => String(row?.[key] ?? "").trim()).filter(Boolean))];

    return {
      brands: unique(purchaseAlerts, "brand_name"),
      categories: unique(purchaseAlerts, "category_name"),
      manufacturers: unique(purchaseAlerts, "manufacturer_name"),
    };
  }, [purchaseAlerts]);

  const filteredPurchaseAlerts = useMemo(() => {
    return purchaseAlerts.filter((alert) => {
      if (purchaseAlertFilters.alertType !== "all" && alert.alert_type !== purchaseAlertFilters.alertType) return false;
      if (purchaseAlertFilters.brand !== "all" && String(alert.brand_name || "") !== purchaseAlertFilters.brand) return false;
      if (purchaseAlertFilters.category !== "all" && String(alert.category_name || "") !== purchaseAlertFilters.category) return false;
      if (purchaseAlertFilters.manufacturer !== "all" && String(alert.manufacturer_name || "") !== purchaseAlertFilters.manufacturer) return false;
      return true;
    });
  }, [purchaseAlerts, purchaseAlertFilters]);

  const purchaseAlertGroups = useMemo(() => {
    const missingSizes = filteredPurchaseAlerts.filter((alert) => alert.alert_type === "missing_sizes");
    const cartonThreshold = filteredPurchaseAlerts.filter((alert) => alert.alert_type === "carton_threshold");
    return { missingSizes, cartonThreshold };
  }, [filteredPurchaseAlerts]);

  const selectedAlerts = useMemo(
    () => purchaseAlerts.filter((alert) => selectedAlertKeys.includes(String(alert.scope_key || ""))),
    [purchaseAlerts, selectedAlertKeys]
  );

  const selectedVisibleAlerts = useMemo(
    () => filteredPurchaseAlerts.filter((alert) => selectedAlertKeys.includes(String(alert.scope_key || ""))),
    [filteredPurchaseAlerts, selectedAlertKeys]
  );

  const allVisibleSelected = filteredPurchaseAlerts.length > 0 && selectedVisibleAlerts.length === filteredPurchaseAlerts.length;

  const toggleAlertSelection = (alert) => {
    const key = String(alert.scope_key || "");
    if (!key) return;
    setSelectedAlertKeys((current) =>
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key]
    );
  };

  const selectAllVisibleAlerts = () => {
    const keys = filteredPurchaseAlerts.map((alert) => String(alert.scope_key || "")).filter(Boolean);
    if (!keys.length) return;
    setSelectedAlertKeys((current) => Array.from(new Set([...current, ...keys])));
  };

  const clearSelectedAlerts = () => setSelectedAlertKeys([]);

  const handleCreatePurchaseDraft = async () => {
    if (!selectedAlerts.length || creatingPurchaseDraft) return;
    setCreatingPurchaseDraft(true);
    try {
      const response = await api.post("/inventory/purchase-alerts/purchase-draft", {
        selected_alerts: selectedAlerts.map((alert) => ({
          scope_key: alert.scope_key,
          product_id: alert.product_id,
          alert_type: alert.alert_type,
          purchase_alert_by_color: alert.purchase_alert_by_color,
          color: alert.color,
          variant_ids: alert.variant_ids,
        })),
      });

      const draftId = response?.draft_id || response?.purchase?.id || response?.purchase?.purchase_id || null;
      if (draftId) {
        toast.success(t("inventory.purchaseAlerts.messages.draftCreated"));
        navigate(`/purchases/${draftId}/edit`);
        return;
      }

      const draftPayload = response?.draft_payload || response?.purchase || response?.data || null;
      if (draftPayload) {
        safeSetLocalStorage(SMART_PURCHASE_DRAFT_STORAGE_KEY, draftPayload, { maxBytes: 48 * 1024 });
        toast.success(t("inventory.purchaseAlerts.messages.draftQueued"));
        navigate("/purchases/create", { state: { purchaseDraftPayload: draftPayload } });
        return;
      }

      toast.success(t("inventory.purchaseAlerts.messages.draftQueued"));
      navigate("/purchases/create");
    } catch (error) {
      toast.error(error?.responseBody?.message || error?.message || t("inventory.purchaseAlerts.messages.draftFailed"));
    } finally {
      setCreatingPurchaseDraft(false);
    }
  };

  return (
    <InventoryShell
      title={t("inventory.title")}
      subtitle={t("inventory.subtitle")}
      actions={
        <>
          <Link to="/inventory/history" className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10">
            <Clock3 className="h-4 w-4" />
            {t("inventory.history")}
          </Link>
          <Link to="/inventory/adjustments" className="inline-flex items-center gap-2 rounded-2xl bg-primary px-4 py-2 text-sm font-black text-black transition hover:bg-primary">
            <Layers3 className="h-4 w-4" />
            {t("inventory.adjustments")}
          </Link>
        </>
      }
      tabs={[
        { to: "/inventory", label: "المخزون", end: true },
        { to: "/inventory/movements", label: "الحركات" },
        { to: "/inventory/adjustments", label: "التسويات" },
        { to: "/inventory/count", label: t("inventory.tabs.count", "الجرد") },
        { to: "/stock-transfers", label: "التحويلات" },
        { to: "/warehouses", label: "المخازن" },
      ]}
    >
      {error ? (
        <div className="rounded-3xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-100">
          <AlertTriangle className="mr-2 inline h-4 w-4" />
          {error}
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Kpi label={t("inventory.kpis.inventoryValue")} value={<InlineLtrValue>{formatCurrency(kpis.inventoryValue)}</InlineLtrValue>} tone="blue" />
        <Kpi label={t("inventory.kpis.lowStockAlerts")} value={<InlineLtrValue>{lowStockAlerts.length}</InlineLtrValue>} tone="amber" />
        <Kpi label={t("inventory.kpis.inboundMoves")} value={<InlineLtrValue>{kpis.inbound}</InlineLtrValue>} tone="emerald" />
        <Kpi label={t("inventory.kpis.outboundMoves")} value={<InlineLtrValue>{kpis.outbound}</InlineLtrValue>} tone="rose" />
      </div>

      <section className="rounded-3xl border border-amber-400/15 bg-gradient-to-br from-amber-400/10 via-white/[0.03] to-orange-400/10 p-4 shadow-2xl shadow-black/10">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/10 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-amber-200" />
              <h3 className="m1-section-title text-white">{t("inventory.purchaseAlerts.title")}</h3>
            </div>
            <p className="mt-1 text-sm text-zinc-400">{t("inventory.purchaseAlerts.subtitle")}</p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <div className="rounded-full border border-amber-300/25 bg-amber-500/10 px-3 py-1 text-xs font-black text-amber-100">
              {selectedVisibleAlerts.length}/{filteredPurchaseAlerts.length}
            </div>
            <button
              type="button"
              onClick={selectAllVisibleAlerts}
              className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-black text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
              disabled={!filteredPurchaseAlerts.length || allVisibleSelected}
            >
              {t("inventory.purchaseAlerts.actions.selectVisible")}
            </button>
            <button
              type="button"
              onClick={clearSelectedAlerts}
              className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-black text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
              disabled={!selectedAlertKeys.length}
            >
              {t("inventory.purchaseAlerts.actions.clearSelection")}
            </button>
            <button
              type="button"
              onClick={handleCreatePurchaseDraft}
              disabled={!selectedAlerts.length || creatingPurchaseDraft}
              className="inline-flex items-center gap-2 rounded-full bg-emerald-400 px-4 py-2 text-xs font-black text-black transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:bg-emerald-400/35 disabled:text-black/50"
            >
              {creatingPurchaseDraft ? t("inventory.purchaseAlerts.actions.creating") : t("inventory.purchaseAlerts.actions.createDraft")}
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label className="space-y-2">
            <span className="text-xs font-bold uppercase tracking-[0.18em] text-zinc-500">
              {t("inventory.purchaseAlerts.filters.brand")}
            </span>
            <select
              value={purchaseAlertFilters.brand}
              onChange={(event) => setPurchaseAlertFilters((current) => ({ ...current, brand: event.target.value }))}
              className="h-[var(--control-height-lg)] w-full rounded-[var(--radius-control)] border border-white/10 bg-zinc-950/70 px-3 text-sm text-white outline-none"
            >
              {purchaseAlertOptions.brands.map((value) => (
                <option key={value} value={value}>
                  {value === "all" ? t("inventory.purchaseAlerts.filters.all") : value}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-2">
            <span className="text-xs font-bold uppercase tracking-[0.18em] text-zinc-500">
              {t("inventory.purchaseAlerts.filters.category")}
            </span>
            <select
              value={purchaseAlertFilters.category}
              onChange={(event) => setPurchaseAlertFilters((current) => ({ ...current, category: event.target.value }))}
              className="h-[var(--control-height-lg)] w-full rounded-[var(--radius-control)] border border-white/10 bg-zinc-950/70 px-3 text-sm text-white outline-none"
            >
              {purchaseAlertOptions.categories.map((value) => (
                <option key={value} value={value}>
                  {value === "all" ? t("inventory.purchaseAlerts.filters.all") : value}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-2">
            <span className="text-xs font-bold uppercase tracking-[0.18em] text-zinc-500">
              {t("inventory.purchaseAlerts.filters.manufacturer")}
            </span>
            <select
              value={purchaseAlertFilters.manufacturer}
              onChange={(event) => setPurchaseAlertFilters((current) => ({ ...current, manufacturer: event.target.value }))}
              className="h-[var(--control-height-lg)] w-full rounded-[var(--radius-control)] border border-white/10 bg-zinc-950/70 px-3 text-sm text-white outline-none"
            >
              {purchaseAlertOptions.manufacturers.map((value) => (
                <option key={value} value={value}>
                  {value === "all" ? t("inventory.purchaseAlerts.filters.all") : value}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-2">
            <span className="text-xs font-bold uppercase tracking-[0.18em] text-zinc-500">
              {t("inventory.purchaseAlerts.filters.alertType")}
            </span>
            <select
              value={purchaseAlertFilters.alertType}
              onChange={(event) => setPurchaseAlertFilters((current) => ({ ...current, alertType: event.target.value }))}
              className="h-[var(--control-height-lg)] w-full rounded-[var(--radius-control)] border border-white/10 bg-zinc-950/70 px-3 text-sm text-white outline-none"
            >
              <option value="all">{t("inventory.purchaseAlerts.filters.all")}</option>
              <option value="missing_sizes">{t("inventory.purchaseAlerts.groups.missing_sizes")}</option>
              <option value="carton_threshold">{t("inventory.purchaseAlerts.groups.carton_threshold")}</option>
            </select>
          </label>
        </div>

        <div className="mt-5 space-y-6">
          {[
            { key: "missing_sizes", title: t("inventory.purchaseAlerts.groups.missing_sizes"), items: purchaseAlertGroups.missingSizes },
            { key: "carton_threshold", title: t("inventory.purchaseAlerts.groups.carton_threshold"), items: purchaseAlertGroups.cartonThreshold },
          ].map((group) => (
            <div key={group.key} className="rounded-3xl border border-white/10 bg-zinc-950/70 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h4 className="text-lg font-black text-white">{group.title}</h4>
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-black text-zinc-200">
                  <InlineLtrValue>{group.items.length}</InlineLtrValue>
                </span>
              </div>

              {group.items.length > 0 ? (
                <div className="mt-4 grid gap-3 xl:grid-cols-2">
                  {group.items.map((alert) => {
                    const imageUrl = resolveImageUrl(alert.image_url);
                    const cardColor = alert.purchase_alert_by_color ? alert.color : "";
                    const selected = selectedAlertKeys.includes(String(alert.scope_key || ""));
                    return (
                      <div
                        key={String(alert.scope_key)}
                        className={`relative rounded-2xl border p-4 shadow-[0_16px_40px_rgba(0,0,0,0.18)] transition ${ selected ? "border-emerald-400/40 bg-emerald-500/10" : "border-white/10 bg-white/[0.04]" }`}
                      >
                        <button
                          type="button"
                          onClick={() => toggleAlertSelection(alert)}
                          className="absolute right-3 top-3 inline-flex h-[var(--control-height-sm)] w-8 items-center justify-center rounded-full border border-white/10 bg-zinc-950/80 text-white transition hover:border-emerald-400/40 hover:bg-emerald-500/15"
                          aria-pressed={selected}
                          aria-label={selected ? t("inventory.purchaseAlerts.actions.deselectAlert") : t("inventory.purchaseAlerts.actions.selectAlert")}
                        >
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() => toggleAlertSelection(alert)}
                            onClick={(event) => event.stopPropagation()}
                            className="h-4 w-4 accent-emerald-400"
                          />
                        </button>
                        <div className="flex gap-3">
                          <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-zinc-950">
                            {imageUrl ? (
                              <img src={imageUrl} alt={alert.product_name} className="h-full w-full object-contain p-2" />
                            ) : (
                              <Package className="h-8 w-8 text-zinc-500" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-base font-black text-white">{alert.product_name}</div>
                                {cardColor ? <div className="mt-1 text-sm font-semibold text-amber-100">{cardColor}</div> : null}
                              </div>
                              <span className="rounded-full border border-amber-300/25 bg-amber-500/10 px-2.5 py-1 text-[11px] font-black text-amber-100">
                                {alert.alert_title}
                              </span>
                            </div>
                            <p className="mt-2 text-sm leading-6 text-zinc-300">{alert.alert_reason}</p>
                          </div>
                        </div>

                        <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                          <MetaPill label={t("inventory.purchaseAlerts.cards.totalStock")} value={String(alert.total_stock ?? 0)} />
                          <MetaPill label={t("inventory.purchaseAlerts.cards.cartonSize")} value={alert.carton_size ? String(alert.carton_size) : "—"} />
                          <MetaPill label={t("inventory.purchaseAlerts.cards.suggestedCartons")} value={alert.suggested_action || `اطلب ${alert.suggested_purchase_cartons || 1} كرتونة`} />
                          <MetaPill label={t("inventory.purchaseAlerts.cards.alertType")} value={alert.alert_title} />
                        </div>

                        {Array.isArray(alert.missing_sizes) && alert.missing_sizes.length > 0 ? (
                          <div className="mt-4">
                            <div className="text-xs font-bold uppercase tracking-[0.18em] text-zinc-500">
                              {t("inventory.purchaseAlerts.cards.missingSizes")}
                            </div>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {alert.missing_sizes.map((size) => (
                                <span key={`${alert.scope_key}-${size}`} className="rounded-full border border-rose-400/25 bg-rose-500/10 px-3 py-1 text-xs font-black text-rose-100">
                                  {size}
                                </span>
                              ))}
                            </div>
                          </div>
                        ) : null}

                        <div className="mt-4 flex justify-end">
                          <Link
                            to={`/purchases/reorder-suggestions?product_id=${encodeURIComponent(String(alert.product_id || ""))}`}
                            className="inline-flex items-center justify-center rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-2 text-sm font-black text-emerald-100 transition hover:bg-emerald-500/15"
                          >
                            {t("inventory.purchaseAlerts.cards.viewSuggestions")}
                          </Link>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="mt-4 rounded-2xl border border-dashed border-white/10 bg-white/5 p-6 text-center text-sm text-zinc-400">
                  {t("inventory.purchaseAlerts.empty")}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]">
        <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-4 shadow-2xl shadow-black/10">
          <div className="relative">
            <Search className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("inventory.searchPlaceholder")}
              className="w-full rounded-[var(--radius-control)] border border-white/10 bg-white/5 py-3 pr-11 pl-4 text-right text-sm text-white outline-none placeholder:text-zinc-500"
            />
          </div>

          <div className="mt-4 overflow-x-auto">
            <div className="min-w-[980px]">
              <div className="grid grid-cols-[1.6fr_0.8fr_0.8fr_0.8fr_0.8fr_0.8fr_0.8fr] rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-right text-xs uppercase tracking-[0.18em] text-zinc-500">
                <div>{t("inventory.tableHeaders.product")}</div>
                <div>{t("inventory.tableHeaders.variant")}</div>
                <div>{t("inventory.tableHeaders.sku")}</div>
                <div>{t("inventory.tableHeaders.stock")}</div>
                <div>{t("inventory.tableHeaders.value")}</div>
                <div>{t("inventory.tableHeaders.status")}</div>
                <div></div>
              </div>
              <div className="mt-2 space-y-2">
                {loading ? (
                  <div className="space-y-2">
                    {Array.from({ length: 6 }).map((_, index) => (
                      <div key={index} className="h-16 animate-pulse rounded-2xl border border-white/10 bg-white/5" />
                    ))}
                  </div>
                ) : filtered.length === 0 ? (
                  <div className="rounded-3xl border border-dashed border-white/10 bg-white/5 p-10 text-center">
                    <ShoppingBag className="mx-auto h-12 w-12 text-zinc-500" />
                    <h3 className="m1-section-title mt-4 text-white">{t("inventory.empty.rowsTitle")}</h3>
                    <p className="mt-2 text-sm text-zinc-400">{t("inventory.empty.rowsSubtitle")}</p>
                  </div>
                ) : (
                  filtered.map((variant) => {
                    const low = Number(variant.stock || 0) <= 10;
                    return (
                      <div key={String(variant.id)} className="grid grid-cols-[1.6fr_0.8fr_0.8fr_0.8fr_0.8fr_0.8fr_0.8fr] items-center rounded-2xl border border-white/10 bg-zinc-950/90 px-4 py-3 text-right">
                        <div className="min-w-0">
                          <div className="truncate font-semibold text-white">{variant.product_name || variant.name}</div>
                          <div className="mt-1 truncate text-xs text-zinc-500">{variant.color || t("inventory.labels.default")} / {variant.size || t("inventory.labels.oneSize")}</div>
                        </div>
                        <div className="truncate text-sm text-zinc-300">{variant.color || t("inventory.labels.notAvailable")}</div>
                        <div className="truncate text-sm text-zinc-300"><InlineLtrValue>{variant.sku || "—"}</InlineLtrValue></div>
                        <div className="font-bold text-white"><InlineLtrValue>{variant.stock}</InlineLtrValue></div>
                        <div className="truncate text-sm text-zinc-300"><InlineLtrValue>{formatCurrency(Number(variant.stock || 0) * Number(variant.price || 0))}</InlineLtrValue></div>
                        <StatusBadge value={low ? formatInventoryStatusLabel(t("inventory.status.low")) : formatInventoryStatusLabel(t("inventory.status.active"))} />
                        <div className="flex justify-end">
                          <Link to={`/inventory/variant/${variant.id}/history`} className="inline-flex items-center justify-center rounded-xl border border-white/10 bg-white/5 p-2 text-white">
                            <Clock3 className="h-4 w-4" />
                          </Link>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10">
            <h3 className="m1-section-title text-white">{t("inventory.empty.warehouseTitle")}</h3>
            <div className="mt-4 space-y-3">
              {warehouses.map((warehouse) => (
                <div key={String(warehouse.id)} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold text-white">{warehouse.name}</div>
                      <div className="mt-1 text-xs text-zinc-500">{warehouse.location || t("inventory.labels.notAvailable")}</div>
                    </div>
                    <StatusBadge value={formatInventoryStatusLabel(warehouse.status || t("inventory.status.active"))} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10">
            <h3 className="m1-section-title text-white">{t("inventory.empty.timelineTitle")}</h3>
            <div className="mt-4 space-y-3">
              {[...movements].slice(0, 5).map((movement, index) => (
                <div key={`${movement.id || index}`} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold text-white">{movement.product_name || movement.variant_name || t("inventory.tabs.movements")}</div>
                      <div className="mt-1 text-xs text-zinc-500">{formatDateTime(movement.created_at || movement.date)}</div>
                    </div>
                    <StatusBadge value={formatInventoryStatusLabel(movement.direction || t("inventory.status.inbound"))} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="m1-section-title text-white">{t("inventory.alerts.title")}</h3>
                <p className="mt-1 text-sm text-zinc-400">{t("inventory.alerts.subtitle")}</p>
              </div>
              {lowStockAlertCards.length > 0 ? (
                <span className="rounded-full border border-amber-400/30 bg-amber-500/10 px-3 py-1 text-xs font-black text-amber-200">
                  {lowStockAlertCards.length}
                </span>
              ) : null}
            </div>
            <div className="mt-4 space-y-3">
              {lowStockAlertCards.slice(0, 8).map((card) => {
                const cardTone = card.card_status?.tone || "warning";
                const cardClassName = lowStockCardClasses[cardTone] || lowStockCardClasses.warning;
                const cardStatusClass = lowStockStatusPillClasses[cardTone] || lowStockStatusPillClasses.warning;
                return (
                  <div
                    key={card.key}
                    className={`rounded-3xl border p-4 shadow-[0_18px_38px_rgba(15,23,42,0.18)] ${cardClassName}`}
                  >
                    <div className="flex gap-4">
                      <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-white shadow-inner">
                        {card.image_url ? (
                          <img
                            src={card.image_url}
                            alt={card.product_name}
                            className="h-full w-full object-contain p-2"
                          />
                        ) : (
                          <Package className="h-7 w-7 text-zinc-500" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-base font-black text-white">{card.product_name}</div>
                            <div className="mt-1 line-clamp-2 text-sm leading-6 text-zinc-100/85">
                              {card.color ? `اللون: ${card.color}` : "اللون: -"}
                            </div>
                          </div>
                          <span className={`shrink-0 rounded-full border px-3 py-1 text-[10px] font-black ${cardStatusClass}`}>
                            {card.card_status?.label || "تنبيه"}
                          </span>
                        </div>

                        <div className="mt-3 grid grid-cols-1 gap-2 text-xs text-zinc-100 sm:grid-cols-3">
                          <div className="rounded-2xl border border-white/10 bg-zinc-950/25 px-3 py-2">
                            <span className="block text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-300">إجمالي المخزون</span>
                            <span className="mt-1 block text-base font-black text-white"><InlineLtrValue>{card.total_stock}</InlineLtrValue></span>
                          </div>
                          <div className="rounded-2xl border border-white/10 bg-zinc-950/25 px-3 py-2">
                            <span className="block text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-300">إجمالي القيمة</span>
                            <span className="mt-1 block text-base font-black text-white"><InlineLtrValue>{formatCurrency(card.total_value)}</InlineLtrValue></span>
                          </div>
                          <div className="rounded-2xl border border-white/10 bg-zinc-950/25 px-3 py-2">
                            <span className="block text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-300">الحالة</span>
                            <span className="mt-1 block text-base font-black text-white">{card.card_status?.label || "تنبيه"}</span>
                          </div>
                        </div>

                        <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-bold text-zinc-100/80">
                          <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">
                            <InlineLtrValue>{card.rows.length}</InlineLtrValue> قطعة
                          </span>
                          {card.colors.length > 1 ? (
                            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">
                              <InlineLtrValue>{card.colors.length}</InlineLtrValue> ألوان
                            </span>
                          ) : null}
                        </div>

                        <div className="mt-4 overflow-hidden rounded-2xl border border-white/10 bg-zinc-950/30">
                          <div className="grid grid-cols-[1.05fr_1.15fr_0.75fr_0.95fr_0.8fr] gap-2 border-b border-white/10 bg-white/[0.03] px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-zinc-400">
                            <div>المقاس</div>
                            <div>SKU</div>
                            <div>المخزون</div>
                            <div>القيمة</div>
                            <div>الحالة</div>
                          </div>
                          <div className="divide-y divide-white/10">
                            {card.rows.map((row) => {
                              const rowStatus = getLowStockRowStatus(row.stock, row.low_stock_alert || card.threshold);
                              return (
                                <div
                                  key={`${card.key}-${row.variant_id || row.id || row.sku || row.size}`}
                                  className="grid grid-cols-[1.05fr_1.15fr_0.75fr_0.95fr_0.8fr] gap-2 px-3 py-2 text-sm text-white"
                                >
                                  <div className="min-w-0 truncate font-semibold text-white">{row.size || t("inventory.labels.oneSize")}</div>
                                  <div className="truncate text-zinc-300"><InlineLtrValue>{row.sku || "—"}</InlineLtrValue></div>
                                  <div className="font-black text-white"><InlineLtrValue>{row.stock}</InlineLtrValue></div>
                                  <div className="font-bold text-zinc-200"><InlineLtrValue>{formatCurrency(Number(row.stock || 0) * Number(row.price || 0))}</InlineLtrValue></div>
                                  <div>
                                    <span
                                      className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-black ${ lowStockStatusPillClasses[rowStatus.tone] || lowStockStatusPillClasses.warning }`}
                                    >
                                      {rowStatus.label}
                                    </span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        <div className="mt-4 flex justify-end">
                          <Link
                            to={`/inventory/adjustments?productId=${encodeURIComponent(card.product_id || "")}`}
                            className="inline-flex items-center justify-center rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-3 py-1.5 text-xs font-black text-emerald-100 transition hover:bg-emerald-500/15"
                          >
                            افتح المخزون
                          </Link>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-4 space-y-3 hidden">
              {lowStockAlerts.slice(0, 8).map((alert) => {
                const totalStock = Number(alert.total_stock ?? alert.stock ?? 0);
                const productName = alert.product_name || t("common.notAvailable");
                const imageUrl = resolveImageUrl(alert.image_url);
                const isProductTotalAlert = alert.low_stock_tracking_mode === "product_total" || alert.alert_scope === "product_total";
                const activeSizesCount = Number(alert.active_sizes_count ?? 0);
                const minimumSizesRequired = Number(alert.minimum_distinct_sizes_required ?? 0);
                const productThreshold = Number(alert.product_low_stock_threshold ?? alert.threshold ?? 0);
                const alertReason = alert.alert_reason || (Array.isArray(alert.alert_reasons) ? alert.alert_reasons.join(", ") : "");
                return (
                  <div
                    key={`${alert.alert_scope || "variant"}-${String(alert.product_id || "")}-${String(alert.variant_id || "")}`}
                    className="rounded-2xl border border-rose-400/25 bg-rose-500/10 p-3 shadow-[0_18px_38px_rgba(127,29,29,0.18)]"
                  >
                    <div className="flex gap-3">
                      <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-white shadow-inner">
                        {imageUrl ? (
                          <img
                            src={imageUrl}
                            alt={productName}
                            className="h-full w-full object-contain p-1.5"
                          />
                        ) : (
                          <Package className="h-6 w-6 text-zinc-500" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="truncate text-base font-black text-white">
                              {isProductTotalAlert ? productName : "اختيار منخفض المخزون"}
                            </div>
                            <div className="mt-1 line-clamp-2 text-sm leading-6 text-zinc-300">
                              {isProductTotalAlert
                                ? `${alertReason || "تنبيه إجمالي المنتج"}: إجمالي المخزون ${totalStock}، وعدد المقاسات النشطة ${activeSizesCount}.`
                                : `${productName}${alert.size ? ` / المقاس ${alert.size}` : ""}${alert.color ? ` / ${alert.color}` : ""}`}
                            </div>
                          </div>
                          <span className="shrink-0 rounded-full border border-rose-300/30 bg-rose-400/15 px-2.5 py-1 text-[10px] font-black text-rose-100">
                            {isProductTotalAlert ? alertReason || "تنبيه" : alert.badge_text || "تنبيه"}
                          </span>
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-zinc-300">
                          <div className="rounded-xl border border-white/10 bg-zinc-950/35 px-3 py-2">
                            <span className="block text-zinc-500">إجمالي المخزون</span>
                            <span className="font-black text-white">{totalStock}</span>
                          </div>
                          <div className="rounded-xl border border-white/10 bg-zinc-950/35 px-3 py-2">
                            <span className="block text-zinc-500">{isProductTotalAlert ? "حد المنتج" : "الحد"}</span>
                            <span className="font-black text-white">{productThreshold}</span>
                          </div>
                          {isProductTotalAlert ? (
                            <>
                              <div className="rounded-xl border border-white/10 bg-zinc-950/35 px-3 py-2">
                                <span className="block text-zinc-500">المقاسات النشطة</span>
                                <span className="font-black text-white">{activeSizesCount}</span>
                              </div>
                              <div className="rounded-xl border border-white/10 bg-zinc-950/35 px-3 py-2">
                                <span className="block text-zinc-500">الحد الأدنى للمقاسات النشطة</span>
                                <span className="font-black text-white">{minimumSizesRequired}</span>
                              </div>
                            </>
                          ) : null}
                        </div>
                        <div className="mt-3 flex justify-end">
                          <Link
                            to={`/inventory/adjustments?productId=${encodeURIComponent(alert.product_id || "")}`}
                            className="inline-flex items-center justify-center rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-3 py-1.5 text-xs font-black text-emerald-200 transition hover:bg-emerald-500/15"
                          >
                            افتح المخزون
                          </Link>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
              {lowStockAlerts.length === 0 ? (
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-zinc-400">{t("inventory.alerts.empty")}</div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </InventoryShell>
  );
}

function Kpi({ label, value, tone = "zinc" }) {
  const classes = {
    blue: "border-primary/20 bg-primary/10 text-primary",
    amber: "border-amber-500/20 bg-amber-500/10 text-amber-300",
    emerald: "border-emerald-500/20 bg-emerald-500/10 text-emerald-300",
    rose: "border-rose-500/20 bg-rose-500/10 text-rose-300",
    zinc: "border-white/10 bg-white/5 text-white",
  };
  return (
    <div className={`rounded-3xl border p-4 shadow-xl ${classes[tone]}`}>
      <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">{label}</div>
      <div className="mt-2 text-2xl font-black text-white">{value}</div>
    </div>
  );
}

function MetaPill({ label, value }) {
  const normalizedValue = String(value ?? "");
  const isNumericValue = /^-?[\d.,]+$/.test(normalizedValue.trim());
  return (
    <div className="rounded-xl border border-white/10 bg-zinc-950/50 px-3 py-2">
      <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500">{label}</div>
      <div className="mt-1 text-sm font-black text-white">{isNumericValue ? <InlineLtrValue>{normalizedValue}</InlineLtrValue> : value}</div>
    </div>
  );
}

export default InventoryDashboard;

