import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { AlertTriangle, Clock3, Save, Shuffle } from "lucide-react";
import toast from "react-hot-toast";

import { api } from "../../../shared/api/api";
import InventoryShell from "../components/InventoryShell";
import StatusBadge from "../../purchases/components/StatusBadge";
import {
  formatCurrency,
  getInventoryAdjustments,
  getInventoryMovements,
  normalizeWarehouse,
  saveInventoryAdjustments,
  saveInventoryMovements,
  seedWarehouses,
} from "../../purchases/lib/flowStore";

function StockAdjustments() {
  const [warehouses, setWarehouses] = useState(seedWarehouses());
  const [variantId, setVariantId] = useState("");
  const [quantity, setQuantity] = useState(0);
  const [warehouseId, setWarehouseId] = useState("");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const loadWarehouses = async () => {
    try {
      setLoading(true);
      const data = await api.get("/warehouses");
      const rows = Array.isArray(data) ? data : data?.warehouses || [];
      setWarehouses(rows.length ? rows.map(normalizeWarehouse) : seedWarehouses());
    } catch (err) {
      console.log(err);
      setWarehouses(seedWarehouses());
      setError("Warehouse endpoint unavailable. Inventory adjustment will still save locally.");
      toast.error("Using fallback warehouses");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadWarehouses();
  }, []);

  useEffect(() => {
    if (!warehouseId && warehouses.length) setWarehouseId(String(warehouses[0].id));
  }, [warehouses, warehouseId]);

  const adjustments = getInventoryAdjustments();
  const movements = getInventoryMovements();

  const submitAdjustment = async () => {
    if (!variantId.trim()) {
      toast.error("Variant id required");
      return;
    }

    setSaving(true);
    const payload = {
      variantId: Number(variantId),
      quantity: Number(quantity || 0),
      reason,
    };

    try {
      await api.put("/inventory/update-stock", payload);
      const record = {
        id: `adj-${Date.now()}`,
        variant_id: variantId,
        quantity: Number(quantity || 0),
        warehouse_id: warehouseId,
        reason,
        created_at: new Date().toISOString(),
      };
      saveInventoryAdjustments([record, ...adjustments]);
      saveInventoryMovements([
        {
          id: `move-${Date.now()}`,
          direction: "Adjustment",
          variant_id: variantId,
          quantity: Number(quantity || 0),
          created_at: new Date().toISOString(),
          reason,
        },
        ...movements,
      ]);
      toast.success("Stock updated and tracked locally");
      setReason("");
    } catch (err) {
      console.log(err);
      const record = {
        id: `adj-${Date.now()}`,
        variant_id: variantId,
        quantity: Number(quantity || 0),
        warehouse_id: warehouseId,
        reason,
        created_at: new Date().toISOString(),
      };
      saveInventoryAdjustments([record, ...adjustments]);
      toast.error("Backend update-stock unavailable. Saved adjustment locally.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <InventoryShell
      title="Stock Adjustments"
      subtitle="Adjust inventory quantities, record inbound/outbound changes, and keep a local audit trail when the backend lacks a movement endpoint."
      actions={
        <div className="flex flex-wrap gap-2">
          <Link to="/inventory/history" className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10">
            <Clock3 className="mr-2 inline h-4 w-4" />
            Variant history
          </Link>
          <Link to="/inventory" className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10">
            Back to inventory
          </Link>
        </div>
      }
      tabs={[
        { to: "/inventory", label: "Inventory", end: true },
        { to: "/inventory/movements", label: "Movements" },
        { to: "/inventory/adjustments", label: "Adjustments", end: true },
        { to: "/inventory/count", label: "الجرد" },
        { to: "/stock-transfers", label: "Transfers" },
        { to: "/warehouses", label: "Warehouses" },
      ]}
    >
      {error ? (
        <div className="rounded-3xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-100">
          <AlertTriangle className="mr-2 inline h-4 w-4" />
          {error}
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(380px,0.85fr)]">
        <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <Field label="Variant ID" value={variantId} onChange={setVariantId} placeholder="e.g. 102" />
            <Field label="Quantity" value={quantity} onChange={setQuantity} type="number" />
            <label className="block">
              <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-zinc-500">Warehouse</div>
              <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none">
                {warehouses.map((warehouse) => (
                  <option key={String(warehouse.id)} value={String(warehouse.id)} className="bg-zinc-950 text-white">
                    {warehouse.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="mt-4 block">
            <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-zinc-500">Reason</div>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={5}
              placeholder="Damage, count correction, receipt variance, manual correction..."
              className="w-full rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white outline-none placeholder:text-zinc-500"
            />
          </label>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setQuantity((prev) => Number(prev || 0) + 1)}
              className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white"
            >
              <PlusLabel label="Increment" />
            </button>
            <button
              type="button"
              onClick={() => setQuantity((prev) => Math.max(0, Number(prev || 0) - 1))}
              className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white"
            >
              <PlusLabel label="Decrement" />
            </button>
          </div>

          <button
            type="button"
            onClick={submitAdjustment}
            disabled={saving}
            className="mt-4 inline-flex items-center justify-center gap-2 rounded-2xl bg-blue-500 px-4 py-3 text-sm font-black text-black disabled:opacity-40"
          >
            <Save className="h-4 w-4" />
            {saving ? "Saving..." : "Apply stock adjustment"}
          </button>
        </div>

        <div className="space-y-4">
          <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10">
            <h3 className="text-xl font-black text-white">Adjustment timeline</h3>
            <div className="mt-4 space-y-3">
              {adjustments.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/10 bg-white/5 p-6 text-sm text-zinc-400">No adjustments recorded locally.</div>
              ) : (
                adjustments.map((adjustment) => (
                  <div key={String(adjustment.id)} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold text-white">Variant {adjustment.variant_id}</div>
                        <div className="mt-1 text-xs text-zinc-500">{formatCurrency(Number(adjustment.quantity || 0))}</div>
                      </div>
                      <StatusBadge value="Active" />
                    </div>
                    <div className="mt-2 text-xs text-zinc-500">{adjustment.reason || "No reason"}</div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10">
            <h3 className="text-xl font-black text-white">Warehouse selection</h3>
            <div className="mt-4 space-y-3">
              {loading ? (
                <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-sm text-zinc-400">Loading warehouses...</div>
              ) : (
                warehouses.map((warehouse) => (
                  <div key={String(warehouse.id)} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="font-semibold text-white">{warehouse.name}</div>
                        <div className="mt-1 text-xs text-zinc-500">{warehouse.location || "n/a"}</div>
                      </div>
                      <StatusBadge value={warehouse.status || "Active"} />
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
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
        onChange={(e) => onChange(type === "number" ? Number(e.target.value || 0) : e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none"
      />
    </label>
  );
}

function PlusLabel({ label }) {
  return (
    <span className="inline-flex items-center gap-2">
      <Shuffle className="h-4 w-4" />
      {label}
    </span>
  );
}

export default StockAdjustments;
