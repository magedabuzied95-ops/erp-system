import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { Clock3, History, Loader2, Search, X } from "lucide-react";
import toast from "react-hot-toast";

import { api } from "../../../shared/api/api";
import { formatCurrency } from "../../../shared/lib/currency";
import { Pagination } from "../../../shared/ui";
import InventoryShell from "../components/InventoryShell";
import { formatDateTime } from "../../purchases/lib/flowStore";

import { useTranslation } from "react-i18next";

import i18n from "../../../i18n/i18n";

/** Module-scope translator for helpers defined outside a component. */
const tt = (key, options) => i18n.t(key, options);

const MOVEMENT_TYPES = [
  "",
  "opening_stock",
  "purchase",
  "sale",
  "return_in",
  "return_out",
  "manual_adjustment",
  "transfer_in",
  "transfer_out",
  "damaged",
  "product_stock_edit",
  "edit_variant_stock",
  "inventory_adjustment",
];

const movementTypeLabelAr = (value = "") => {
  const labels = {
    opening_stock: tt("inventory.movements.types.opening"),
    purchase: tt("inventory.movements.types.purchase"),
    sale: tt("inventory.movements.types.sale"),
    return_in: tt("inventory.movements.types.returnIn"),
    return_out: tt("inventory.movements.types.returnOut"),
    manual_adjustment: tt("inventory.movements.types.manualEdit"),
    transfer_in: tt("inventory.movements.types.transferIn"),
    transfer_out: tt("inventory.movements.types.transferOut"),
    damaged: tt("inventory.adjustments.damaged"),
    product_stock_edit: tt("inventory.movements.types.productStockEdit"),
    edit_variant_stock: tt("inventory.movements.types.variantStockEdit"),
    inventory_adjustment: tt("inventory.movements.types.stockAdjustment"),
  };

  return labels[value] || tt("inventory.movements.movement");
};

function InventoryHistory() {
  // Subscribes this screen to language changes; strings resolve through tt().
  useTranslation();
  const { id: routeVariantId } = useParams();
  const [filters, setFilters] = useState({
    search: "",
    productId: "",
    variantId: routeVariantId || "",
    movementType: "",
    dateFrom: "",
    dateTo: "",
  });
  const [movements, setMovements] = useState([]);
  const [pagination, setPagination] = useState({ total: 0, limit: 25, offset: 0 });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeMovement, setActiveMovement] = useState(null);

  useEffect(() => {
    let alive = true;
    const timer = setTimeout(async () => {
      try {
        setLoading(true);
        setError("");

        const params = new URLSearchParams();
        if (filters.search.trim()) params.set("search", filters.search.trim());
        if (filters.productId.trim()) params.set("productId", filters.productId.trim());
        if (filters.variantId.trim()) params.set("variantId", filters.variantId.trim());
        if (filters.movementType.trim()) params.set("movementType", filters.movementType.trim());
        if (filters.dateFrom) params.set("dateFrom", filters.dateFrom);
        if (filters.dateTo) params.set("dateTo", filters.dateTo);
        params.set("limit", String(pageSize));
        params.set("offset", String((page - 1) * pageSize));

        const endpoint = routeVariantId
          ? `/inventory/variant/${routeVariantId}/history?${params.toString()}`
          : `/inventory/history?${params.toString()}`;

        const response = await api.get(endpoint);
        if (!alive) return;

        const rows = Array.isArray(response?.movements) ? response.movements : Array.isArray(response) ? response : [];
        setMovements(rows);
        setPagination(response?.pagination || { total: rows.length, limit: pageSize, offset: (page - 1) * pageSize });
      } catch (err) {
        console.log(err);
        if (!alive) return;
        setMovements([]);
        setError(err?.message || tt("inventory.history.errors.load"));
        toast.error(err?.message || tt("inventory.history.errors.load"));
      } finally {
        if (alive) setLoading(false);
      }
    }, 250);

    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [filters, page, pageSize, routeVariantId]);

  useEffect(() => {
    setPage(1);
  }, [filters.search, filters.productId, filters.variantId, filters.movementType, filters.dateFrom, filters.dateTo]);

  const summary = useMemo(() => {
    const inbound = movements.filter((movement) => Number(movement.quantity_change || 0) > 0).length;
    const outbound = movements.filter((movement) => Number(movement.quantity_change || 0) < 0).length;
    return { inbound, outbound };
  }, [movements]);

  return (
    <InventoryShell
      title={tt("inventory.history")}
      subtitle={tt("inventory.history.pageSubtitle")}
      actions={
        <>
          <Link
            to="/inventory"
            className="inline-flex items-center gap-2 rounded-[var(--radius-card)] border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
          >
            <Clock3 className="h-4 w-4" />
            {tt("inventory.title")}
          </Link>
          <Link
            to="/inventory/adjustments"
            className="inline-flex items-center gap-2 rounded-2xl bg-primary px-4 py-2 text-sm font-black text-black transition hover:bg-primary"
          >
            <History className="h-4 w-4" />
            {tt("inventory.adjustments")}
          </Link>
        </>
      }
      tabs={[
        { to: "/inventory", label: tt("inventory.table.stock"), end: true },
        { to: "/inventory/history", label: tt("inventory.labels.history"), end: true },
        { to: "/inventory/movements", label: tt("inventory.tabs.movements") },
        { to: "/inventory/adjustments", label: tt("inventory.tabs.adjustments") },
        { to: "/inventory/count", label: tt("inventory.tabs.count") },
        { to: "/stock-transfers", label: tt("inventory.tabs.transfers") },
      ]}
    >
      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-4">
        <Metric label={tt("inventory.tabs.movements")} value={movements.length} />
        <Metric label={tt("inventory.movements.inbound")} value={summary.inbound} tone="emerald" />
        <Metric label={tt("inventory.movements.outbound")} value={summary.outbound} tone="rose" />
        <Metric label={tt("inventory.metrics.totalRows")} value={pagination.total || movements.length} tone="blue" />
      </div>

      <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-4 shadow-2xl shadow-black/10">
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1.2fr)_160px_160px_180px_180px_180px_auto]">
          <label className="relative block xl:col-span-1">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
            <input
              value={filters.search}
              onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))}
              placeholder={tt("inventory.history.searchPlaceholder")}
              className="w-full rounded-[var(--radius-control)] border border-white/10 bg-white/5 py-3 pl-11 pr-4 text-sm text-white outline-none placeholder:text-zinc-500"
            />
          </label>

          <Field label={tt("inventory.table.product")} value={filters.productId} onChange={(value) => setFilters((prev) => ({ ...prev, productId: value }))} placeholder={tt("inventory.movements.productId")} />
          <Field label={tt("inventory.tableHeaders.variant")} value={filters.variantId} onChange={(value) => setFilters((prev) => ({ ...prev, variantId: value }))} placeholder={tt("inventory.movements.variantId")} />
          <Field label={tt("inventory.labels.from")} value={filters.dateFrom} onChange={(value) => setFilters((prev) => ({ ...prev, dateFrom: value }))} type="date" />
          <Field label={tt("inventory.labels.to")} value={filters.dateTo} onChange={(value) => setFilters((prev) => ({ ...prev, dateTo: value }))} type="date" />

          <label className="block">
            <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-zinc-500">{tt("inventory.movements.type")}</div>
            <select
              value={filters.movementType}
              onChange={(e) => setFilters((prev) => ({ ...prev, movementType: e.target.value }))}
              className="w-full rounded-[var(--radius-control)] border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none"
            >
              <option value="">{tt("inventory.purchaseAlerts.filters.all")}</option>
              {MOVEMENT_TYPES.filter(Boolean).map((type) => (
                <option key={type} value={type} className="bg-zinc-950 text-white">
                  {movementTypeLabelAr(type)}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            onClick={() => setFilters((prev) => ({ ...prev, search: "", productId: "", variantId: routeVariantId || "", movementType: "", dateFrom: "", dateTo: "" }))}
            className="inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
          >
            <X className="h-4 w-4" />
            {tt("inventory.actions.reset")}
          </button>
        </div>
      </div>

      <div className="rounded-3xl border border-white/10 bg-zinc-950/90 shadow-2xl shadow-black/10">
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div>
            <h3 className="m1-section-title text-white">{tt("inventory.movements.log")}</h3>
            <p className="mt-1 text-sm text-zinc-400">{tt("inventory.history.rowHint")}</p>
          </div>
          <div className="text-sm text-zinc-400">{movements.length} صفًا ظاهرًا</div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16 text-zinc-400">
            <Loader2 className="mr-2 h-5 w-5 animate-spin text-emerald-400" />
            {tt("inventory.history.loading")}
          </div>
        ) : error ? (
          <div className="p-5 text-sm text-red-100">
            <div className="rounded-3xl border border-red-500/20 bg-red-500/10 p-5">{error}</div>
          </div>
        ) : movements.length === 0 ? (
          <div className="p-8 text-center text-zinc-400">
            <div className="rounded-[var(--radius-card)] border border-dashed border-white/10 bg-white/5 p-10">{tt("inventory.history.empty")}</div>
          </div>
        ) : (
          <div className="m1-table-container overflow-x-auto">
            <table className="m1-table m1-table--compact m1-table--separate min-w-full border-separate px-3 pb-3">
              <thead>
                <tr className="text-left text-xs uppercase tracking-[0.18em] text-zinc-500">
                  <th className="px-3 py-2">{tt("inventory.movements.time")}</th>
                  <th className="px-3 py-2">{tt("inventory.table.product")}</th>
                  <th className="px-3 py-2">{tt("inventory.tableHeaders.variant")}</th>
                  <th className="px-3 py-2">{tt("inventory.labels.type")}</th>
                  <th className="px-3 py-2">{tt("inventory.movements.before")}</th>
                  <th className="px-3 py-2">{tt("inventory.adjustments.change")}</th>
                  <th className="px-3 py-2">{tt("inventory.movements.after")}</th>
                  <th className="px-3 py-2">{tt("inventory.movements.user")}</th>
                  <th className="px-3 py-2">{tt("inventory.movements.reference")}</th>
                </tr>
              </thead>
              <tbody>
                {movements.map((movement) => {
                  const change = Number(movement.quantity_change || movement.quantity || 0);
                  return (
                    <tr
                      key={String(movement.id)}
                      onClick={() => setActiveMovement(movement)}
                      className="cursor-pointer rounded-[var(--radius-card)] border border-white/10 bg-white/5 transition hover:bg-white/10"
                    >
                      <td className="px-3 py-4 text-sm text-zinc-300">{formatDateTime(movement.created_at)}</td>
                      <td className="px-3 py-4">
                        <div className="font-semibold text-white">{movement.product_name || tt("inventory.labels.unknownProduct")}</div>
                        <div className="text-xs text-zinc-500">{movement.product_brand || tt("inventory.labels.notAvailable")}</div>
                      </td>
                      <td className="px-3 py-4 text-sm text-zinc-300">
                        <div>{movement.variant_color || movement.variant_name || tt("inventory.labels.default")}</div>
                        <div className="text-xs text-zinc-500">{movement.variant_size || movement.variant_sku || tt("inventory.labels.notAvailable")}</div>
                      </td>
                      <td className="px-3 py-4">
                        <MovementBadge type={movement.movement_type} />
                      </td>
                      <td className="px-3 py-4 text-sm text-zinc-300">{Number(movement.quantity_before || 0)}</td>
                      <td className={`px-3 py-4 text-sm font-semibold ${change >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                        {change >= 0 ? "+" : ""}
                        {change}
                      </td>
                      <td className="px-3 py-4 text-sm text-zinc-300">{Number(movement.quantity_after || 0)}</td>
                      <td className="px-3 py-4 text-sm text-zinc-300">{movement.created_by_name || tt("inventory.labels.notAvailable")}</td>
                      <td className="px-3 py-4 text-sm text-zinc-300">
                        <div>{movement.reference_type || tt("inventory.labels.notAvailable")}</div>
                        <div className="text-xs text-zinc-500">#{movement.reference_id || tt("inventory.labels.notAvailable")}</div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <Pagination
          className="border-t border-white/10 px-4 pb-4"
          page={page}
          pages={Math.max(1, Math.ceil(Number(pagination.total || 0) / pageSize))}
          total={Number(pagination.total || 0)}
          pageSize={pageSize}
          visible={movements.length}
          disabled={loading}
          onChange={setPage}
          onPageSizeChange={(value) => { setPageSize(value); setPage(1); }}
        />
      </div>

      {activeMovement ? <TimelineDrawer movement={activeMovement} onClose={() => setActiveMovement(null)} /> : null}
    </InventoryShell>
  );
}

function Field({ label, value, onChange, type = "text", placeholder }) {
  return (
    <label className="block">
      <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-zinc-500">{label}</div>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-[var(--radius-control)] border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none placeholder:text-zinc-500"
      />
    </label>
  );
}

function Metric({ label, value, tone = "zinc" }) {
  const classes = {
    blue: "border-blue-500/20 bg-blue-500/10 text-blue-300",
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

function MovementBadge({ type }) {
  const palette = {
    purchase: "border-emerald-500/20 bg-emerald-500/10 text-emerald-300",
    sale: "border-rose-500/20 bg-rose-500/10 text-rose-300",
    return_in: "border-blue-500/20 bg-blue-500/10 text-blue-300",
    return_out: "border-amber-500/20 bg-amber-500/10 text-amber-300",
    transfer_in: "border-sky-500/20 bg-sky-500/10 text-sky-300",
    transfer_out: "border-sky-500/20 bg-sky-500/10 text-sky-300",
    damaged: "border-red-500/20 bg-red-500/10 text-red-300",
    manual_adjustment: "border-white/10 bg-white/5 text-white",
    opening_stock: "border-violet-500/20 bg-violet-500/10 text-violet-300",
    edit_variant_stock: "border-indigo-500/20 bg-indigo-500/10 text-indigo-300",
  };

  return (
    <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] ${palette[type] || "border-white/10 bg-white/5 text-white"}`}>
      {movementTypeLabelAr(type)}
    </span>
  );
}

function TimelineDrawer({ movement, onClose }) {
  const change = Number(movement.quantity_change || movement.quantity || 0);

  return (
    <div className="fixed inset-0 z-50">
      <button type="button" className="absolute inset-0 bg-black/70" onClick={onClose} aria-label={tt("inventory.history.closeDetails")} />
      <div className="absolute right-0 top-0 h-full w-full max-w-[520px] border-l border-white/10 bg-zinc-950 shadow-[0_30px_100px_rgba(0,0,0,0.5)]">
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">{tt("inventory.empty.timelineTitle")}</p>
            <h3 className="m1-section-title mt-1 text-white">{movement.product_name || tt("inventory.history.details")}</h3>
          </div>
          <button type="button" onClick={onClose} className="rounded-[var(--radius-control)] border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-white">
            {tt("common.close")}
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto p-5">
          <Detail label={tt("inventory.movements.type")} value={movement.movement_type} />
          <Detail label={tt("inventory.movements.qtyBefore")} value={String(movement.quantity_before ?? 0)} />
          <Detail label={tt("inventory.adjustments.quantityChange")} value={change >= 0 ? `+${change}` : String(change)} />
          <Detail label={tt("inventory.movements.qtyAfter")} value={String(movement.quantity_after ?? 0)} />
          <Detail label={tt("inventory.movements.reference")} value={`${movement.reference_type || tt("inventory.labels.notAvailable")} #${movement.reference_id || tt("inventory.labels.notAvailable")}`} />
          <Detail label={tt("inventory.movements.user")} value={movement.created_by_name || tt("inventory.labels.notAvailable")} />
          <Detail label={tt("inventory.movements.time")} value={formatDateTime(movement.created_at)} />
          <Detail label={tt("inventory.labels.warehouse")} value={movement.warehouse_id || movement.branch_id || tt("inventory.labels.notAvailable")} />
          <Detail label={tt("inventory.labels.cost")} value={movement.total_cost !== null && movement.total_cost !== undefined ? formatCurrency(movement.total_cost) : tt("inventory.labels.notAvailable")} />
          <Detail label={tt("inventory.labels.notes")} value={movement.notes || movement.note || tt("inventory.labels.notAvailable")} />
        </div>
      </div>
    </div>
  );
}

function Detail({ label, value }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-white/10 bg-white/5 p-4">
      <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">{label}</div>
      <div className="mt-1 text-sm font-semibold text-white">{value}</div>
    </div>
  );
}

export default InventoryHistory;
