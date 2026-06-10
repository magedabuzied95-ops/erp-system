import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

import {
  AlertTriangle,
  Clock3,
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

function InventoryDashboard() {
  const { t } = useTranslation();
  const [variants, setVariants] = useState([]);
  const [lowStockAlerts, setLowStockAlerts] = useState([]);
  const [warehouses, setWarehouses] = useState(seedWarehouses());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  const loadData = async () => {
    try {
      setLoading(true);
      setError("");
      const [variantsRes, warehousesRes, alertsRes] = await Promise.allSettled([
        api.get("/variants-inventory?limit=200&page=1"),
        api.get("/warehouses"),
        api.get("/inventory/low-stock"),
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
          <Link to="/inventory/adjustments" className="inline-flex items-center gap-2 rounded-2xl bg-blue-500 px-4 py-2 text-sm font-black text-black transition hover:bg-blue-400">
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
        <Kpi label={t("inventory.kpis.inventoryValue")} value={formatCurrency(kpis.inventoryValue)} tone="blue" />
        <Kpi label={t("inventory.kpis.lowStockAlerts")} value={lowStockAlerts.length} tone="amber" />
        <Kpi label={t("inventory.kpis.inboundMoves")} value={kpis.inbound} tone="emerald" />
        <Kpi label={t("inventory.kpis.outboundMoves")} value={kpis.outbound} tone="rose" />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]">
        <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-4 shadow-2xl shadow-black/10">
          <div className="relative">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("inventory.searchPlaceholder")}
              className="w-full rounded-2xl border border-white/10 bg-white/5 py-3 pl-11 pr-4 text-sm text-white outline-none placeholder:text-zinc-500"
            />
          </div>

          <div className="mt-4 overflow-x-auto">
            <div className="min-w-[980px]">
              <div className="grid grid-cols-[1.6fr_0.8fr_0.8fr_0.8fr_0.8fr_0.8fr_0.8fr] rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-xs uppercase tracking-[0.18em] text-zinc-500">
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
                    <h3 className="mt-4 text-xl font-black text-white">{t("inventory.empty.rowsTitle")}</h3>
                    <p className="mt-2 text-sm text-zinc-400">{t("inventory.empty.rowsSubtitle")}</p>
                  </div>
                ) : (
                  filtered.map((variant) => {
                    const low = Number(variant.stock || 0) <= 10;
                    return (
                      <div key={String(variant.id)} className="grid grid-cols-[1.6fr_0.8fr_0.8fr_0.8fr_0.8fr_0.8fr_0.8fr] items-center rounded-2xl border border-white/10 bg-zinc-950/90 px-4 py-3">
                        <div>
                          <div className="font-semibold text-white">{variant.product_name || variant.name}</div>
                          <div className="text-xs text-zinc-500">{variant.color || t("inventory.labels.default")} / {variant.size || t("inventory.labels.oneSize")}</div>
                        </div>
                        <div className="text-sm text-zinc-300">{variant.color || t("inventory.labels.notAvailable")}</div>
                        <div className="text-sm text-zinc-300">{variant.sku}</div>
                        <div className="font-bold text-white">{variant.stock}</div>
                        <div className="text-sm text-zinc-300">{formatCurrency(Number(variant.stock || 0) * Number(variant.price || 0))}</div>
                        <StatusBadge value={low ? t("inventory.status.low") : t("inventory.status.active")} />
                        <div className="text-right">
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
            <h3 className="text-xl font-black text-white">{t("inventory.empty.warehouseTitle")}</h3>
            <div className="mt-4 space-y-3">
              {warehouses.map((warehouse) => (
                <div key={String(warehouse.id)} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold text-white">{warehouse.name}</div>
                      <div className="mt-1 text-xs text-zinc-500">{warehouse.location || t("inventory.labels.notAvailable")}</div>
                    </div>
                    <StatusBadge value={warehouse.status || t("inventory.status.active")} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10">
            <h3 className="text-xl font-black text-white">{t("inventory.empty.timelineTitle")}</h3>
            <div className="mt-4 space-y-3">
              {[...movements].slice(0, 5).map((movement, index) => (
                <div key={`${movement.id || index}`} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold text-white">{movement.product_name || movement.variant_name || t("inventory.tabs.movements")}</div>
                      <div className="mt-1 text-xs text-zinc-500">{formatDateTime(movement.created_at || movement.date)}</div>
                    </div>
                    <StatusBadge value={movement.direction || t("inventory.status.inbound")} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-xl font-black text-white">{t("inventory.alerts.title")}</h3>
                <p className="mt-1 text-sm text-zinc-400">{t("inventory.alerts.subtitle")}</p>
              </div>
              {lowStockAlerts.length > 0 ? (
                <span className="rounded-full border border-amber-400/30 bg-amber-500/10 px-3 py-1 text-xs font-black text-amber-200">
                  {lowStockAlerts.length}
                </span>
              ) : null}
            </div>
            <div className="mt-4 space-y-3">
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
                                : `${productName}${alert.size ? ` / size ${alert.size}` : ""}${alert.color ? ` / ${alert.color}` : ""}`}
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
    blue: "border-blue-500/20 bg-blue-500/10 text-blue-300",
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

export default InventoryDashboard;

