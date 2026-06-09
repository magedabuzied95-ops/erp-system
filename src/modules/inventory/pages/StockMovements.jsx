import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { ArrowDownRight, ArrowUpRight, Clock3, Search } from "lucide-react";

import InventoryShell from "../components/InventoryShell";
import StatusBadge from "../../purchases/components/StatusBadge";
import { formatDateTime, getInventoryMovements } from "../../purchases/lib/flowStore";

function StockMovements() {
  const [search, setSearch] = useState("");
  const movements = getInventoryMovements();

  const filtered = useMemo(
    () =>
      movements.filter((movement) =>
        `${movement.product_name || ""} ${movement.variant_name || ""} ${movement.reason || ""} ${movement.direction || ""}`
          .toLowerCase()
          .includes(search.trim().toLowerCase())
      ),
    [movements, search]
  );

  return (
    <InventoryShell
      title="Stock Movements"
      subtitle="Inbound / outbound movement history, inventory timeline, and local adjustment records."
      actions={
        <div className="flex flex-wrap gap-2">
          <Link to="/inventory/history" className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white">
            <Clock3 className="mr-2 inline h-4 w-4" />
            Variant history
          </Link>
          <Link to="/inventory/adjustments" className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white">
            New adjustment
          </Link>
        </div>
      }
      tabs={[
        { to: "/inventory", label: "Inventory", end: true },
        { to: "/inventory/movements", label: "Movements", end: true },
        { to: "/inventory/adjustments", label: "Adjustments" },
        { to: "/inventory/count", label: "الجرد" },
        { to: "/stock-transfers", label: "Transfers" },
        { to: "/warehouses", label: "Warehouses" },
      ]}
    >
      <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-4 shadow-2xl shadow-black/10">
        <div className="relative">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search movements..."
            className="w-full rounded-2xl border border-white/10 bg-white/5 py-3 pl-11 pr-4 text-sm text-white outline-none placeholder:text-zinc-500"
          />
        </div>
        <div className="mt-4 space-y-3">
          {filtered.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-white/10 bg-white/5 p-10 text-center text-zinc-400">
              No movements recorded yet.
            </div>
          ) : (
            filtered.map((movement, index) => (
              <div key={String(movement.id || index)} className="rounded-3xl border border-white/10 bg-white/5 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold text-white">{movement.product_name || movement.variant_name || "Movement"}</div>
                    <div className="mt-1 text-xs text-zinc-500">{formatDateTime(movement.created_at || movement.date)}</div>
                  </div>
                  <StatusBadge value={movement.direction || "Inbound"} />
                </div>
                <div className="mt-3 flex items-center gap-2 text-sm text-zinc-300">
                  {movement.direction === "Outbound" ? <ArrowDownRight className="h-4 w-4 text-rose-300" /> : <ArrowUpRight className="h-4 w-4 text-emerald-300" />}
                  Qty {movement.quantity || 0}
                  <span className="text-zinc-500">•</span>
                  {movement.reason || "No reason"}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </InventoryShell>
  );
}

export default StockMovements;
