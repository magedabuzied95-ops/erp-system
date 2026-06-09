import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { Clock3, Loader2, Search, SlidersHorizontal } from "lucide-react";
import toast from "react-hot-toast";

import { api } from "../../../shared/api/api";
import InventoryShell from "../components/InventoryShell";
import { formatDateTime } from "../../purchases/lib/flowStore";

function StockMovements() {
  const [search, setSearch] = useState("");
  const [movementType, setMovementType] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [movements, setMovements] = useState([]);

  useEffect(() => {
    let alive = true;
    const timer = setTimeout(async () => {
      try {
        setLoading(true);
        setError("");

        const params = new URLSearchParams();
        if (search.trim()) params.set("search", search.trim());
        if (movementType.trim()) params.set("movement_type", movementType.trim());
        params.set("limit", "200");

        const response = await api.get(`/inventory/movements?${params.toString()}`);
        if (!alive) return;

        const rows = Array.isArray(response?.movements) ? response.movements : [];
        setMovements(rows);
      } catch (err) {
        if (!alive) return;
        setMovements([]);
        setError(err?.message || "Failed to load inventory movements");
        toast.error(err?.message || "Failed to load inventory movements");
      } finally {
        if (alive) setLoading(false);
      }
    }, 250);

    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [movementType, search]);

  const movementTypes = useMemo(() => {
    const values = new Set();
    movements.forEach((movement) => {
      if (movement?.movement_type) values.add(String(movement.movement_type));
    });
    return Array.from(values).sort();
  }, [movements]);

  return (
    <InventoryShell
      title="Stock Movements"
      subtitle="Real inventory ledger with purchase receipts, sales, returns, transfers, adjustments, and count approvals."
      actions={
        <div className="flex flex-wrap gap-2">
          <Link to="/inventory/history" className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white">
            <Clock3 className="mr-2 inline h-4 w-4" />
            Variant history
          </Link>
        </div>
      }
      tabs={[
        { to: "/inventory", label: "Inventory", end: true },
        { to: "/inventory/movements", label: "Movements", end: true },
        { to: "/inventory/adjustments", label: "Adjustments" },
        { to: "/inventory/count", label: "Count" },
        { to: "/stock-transfers", label: "Transfers" },
        { to: "/warehouses", label: "Warehouses" },
      ]}
    >
      <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-4 shadow-2xl shadow-black/10">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px_auto]">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search product, SKU, reason, user, warehouse..."
              className="w-full rounded-2xl border border-white/10 bg-white/5 py-3 pl-11 pr-4 text-sm text-white outline-none placeholder:text-zinc-500"
            />
          </label>

          <label className="block">
            <div className="mb-2 flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-zinc-500">
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Movement type
            </div>
            <select
              value={movementType}
              onChange={(e) => setMovementType(e.target.value)}
              className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none"
            >
              <option value="">All types</option>
              {movementTypes.map((type) => (
                <option key={type} value={type} className="bg-zinc-950 text-white">
                  {type}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            onClick={() => {
              setSearch("");
              setMovementType("");
            }}
            className="self-end rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
          >
            Reset
          </button>
        </div>
      </div>

      <div className="rounded-3xl border border-white/10 bg-zinc-950/90 shadow-2xl shadow-black/10">
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div>
            <h3 className="text-xl font-black text-white">Movement ledger</h3>
            <p className="mt-1 text-sm text-zinc-400">Every stock change is journaled here from live backend data.</p>
          </div>
          <div className="text-sm text-zinc-400">{movements.length} rows</div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16 text-zinc-400">
            <Loader2 className="mr-2 h-5 w-5 animate-spin text-emerald-400" />
            Loading inventory movements...
          </div>
        ) : error ? (
          <div className="p-5 text-sm text-red-100">
            <div className="rounded-3xl border border-red-500/20 bg-red-500/10 p-5">{error}</div>
          </div>
        ) : movements.length === 0 ? (
          <div className="p-8 text-center text-zinc-400">
            <div className="rounded-3xl border border-dashed border-white/10 bg-white/5 p-10">
              No movements found.
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full border-separate border-spacing-y-2 px-3 pb-3">
              <thead>
                <tr className="text-left text-xs uppercase tracking-[0.18em] text-zinc-500">
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Product</th>
                  <th className="px-3 py-2">Color</th>
                  <th className="px-3 py-2">Size</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Qty +/-</th>
                  <th className="px-3 py-2">Before</th>
                  <th className="px-3 py-2">After</th>
                  <th className="px-3 py-2">Reference</th>
                  <th className="px-3 py-2">Reason</th>
                  <th className="px-3 py-2">User</th>
                </tr>
              </thead>
              <tbody>
                {movements.map((movement) => {
                  const delta = Number(movement.quantity_delta ?? movement.quantity_change ?? movement.quantity ?? 0);
                  return (
                    <tr key={String(movement.id)} className="rounded-2xl border border-white/10 bg-white/5 transition hover:bg-white/10">
                      <td className="px-3 py-4 text-sm text-zinc-300">{formatDateTime(movement.created_at)}</td>
                      <td className="px-3 py-4">
                        <div className="font-semibold text-white">{movement.product_name || "Unknown product"}</div>
                        <div className="text-xs text-zinc-500">
                          {movement.sku || movement.barcode || "No SKU"} | {movement.warehouse_name || "No warehouse"} | {movement.branch_name || "No branch"}
                        </div>
                      </td>
                      <td className="px-3 py-4 text-sm text-zinc-300">{movement.color || "-"}</td>
                      <td className="px-3 py-4 text-sm text-zinc-300">{movement.size || "-"}</td>
                      <td className="px-3 py-4">
                        <MovementBadge type={movement.movement_type} />
                      </td>
                      <td className={`px-3 py-4 text-sm font-semibold ${delta >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                        {delta >= 0 ? "+" : ""}
                        {delta}
                      </td>
                      <td className="px-3 py-4 text-sm text-zinc-300">{Number(movement.quantity_before ?? 0)}</td>
                      <td className="px-3 py-4 text-sm text-zinc-300">{Number(movement.quantity_after ?? 0)}</td>
                      <td className="px-3 py-4 text-sm text-zinc-300">
                        <div>{movement.reference_type || "-"}</div>
                        <div className="text-xs text-zinc-500">#{movement.reference_id || "-"}</div>
                      </td>
                      <td className="px-3 py-4 text-sm text-zinc-300">{movement.reason || "-"}</td>
                      <td className="px-3 py-4 text-sm text-zinc-300">{movement.created_by_name || "-"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </InventoryShell>
  );
}

function MovementBadge({ type }) {
  const value = String(type || "movement").toUpperCase();
  const palette = {
    PURCHASE_IN: "border-emerald-500/20 bg-emerald-500/10 text-emerald-300",
    SALE_OUT: "border-rose-500/20 bg-rose-500/10 text-rose-300",
    RETURN_IN: "border-blue-500/20 bg-blue-500/10 text-blue-300",
    ADJUSTMENT: "border-white/10 bg-white/5 text-white",
    TRANSFER_IN: "border-sky-500/20 bg-sky-500/10 text-sky-300",
    TRANSFER_OUT: "border-sky-500/20 bg-sky-500/10 text-sky-300",
    COUNT_ADJUSTMENT: "border-violet-500/20 bg-violet-500/10 text-violet-300",
    ORDER_CANCEL_RESTORE: "border-amber-500/20 bg-amber-500/10 text-amber-300",
    OPENING_BALANCE: "border-cyan-500/20 bg-cyan-500/10 text-cyan-300",
  };

  return (
    <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] ${palette[value] || "border-white/10 bg-white/5 text-white"}`}>
      {value}
    </span>
  );
}

export default StockMovements;
