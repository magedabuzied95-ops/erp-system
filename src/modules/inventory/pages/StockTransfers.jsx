import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { AlertTriangle, Clock3, Save } from "lucide-react";
import toast from "react-hot-toast";

import { api } from "../../../shared/api/api";
import InventoryShell from "../components/InventoryShell";
import StatusBadge from "../../purchases/components/StatusBadge";
import {
  formatDateTime,
  getInventoryTransfers,
  normalizeWarehouse,
  saveInventoryTransfers,
  seedWarehouses,
} from "../../purchases/lib/flowStore";

function StockTransfers() {
  const [warehouses, setWarehouses] = useState(seedWarehouses());
  const [variantId, setVariantId] = useState("");
  const [fromWarehouse, setFromWarehouse] = useState("");
  const [toWarehouse, setToWarehouse] = useState("");
  const [quantity, setQuantity] = useState(0);
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const data = await api.get("/warehouses");
        const rows = Array.isArray(data) ? data : data?.warehouses || [];
        setWarehouses(rows.length ? rows.map(normalizeWarehouse) : seedWarehouses());
      } catch (err) {
        console.log(err);
        setWarehouses(seedWarehouses());
        setError("Transfer endpoint fallback enabled. The backend route may not expose all transfer details.");
        toast.error("Using fallback transfer data");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  useEffect(() => {
    if (!fromWarehouse && warehouses.length) setFromWarehouse(String(warehouses[0].id));
    if (!toWarehouse && warehouses.length > 1) setToWarehouse(String(warehouses[1].id));
  }, [warehouses, fromWarehouse, toWarehouse]);

  const transfers = getInventoryTransfers();

  const submitTransfer = async () => {
    if (!variantId.trim()) {
      toast.error("Variant ID required");
      return;
    }

    const payload = {
      variant_id: Number(variantId),
      from_warehouse: fromWarehouse,
      to_warehouse: toWarehouse,
      quantity: Number(quantity || 0),
    };

    try {
      await api.post("/warehouses/transfer", payload);
      const record = {
        id: `trf-${Date.now()}`,
        ...payload,
        notes,
        created_at: new Date().toISOString(),
        status: "Transferred",
      };
      saveInventoryTransfers([record, ...transfers]);
      toast.success("Transfer submitted");
    } catch (err) {
      console.log(err);
      const record = {
        id: `trf-${Date.now()}`,
        ...payload,
        notes,
        created_at: new Date().toISOString(),
        status: "Draft",
      };
      saveInventoryTransfers([record, ...transfers]);
      toast.error("Transfer endpoint unavailable. Saved locally as placeholder.");
    }
  };

  return (
    <InventoryShell
      title="Warehouse Transfer Placeholder"
      subtitle="Outbound / inbound transfer workflow, stock handoff placeholder, and local transfer history."
      actions={
        <div className="flex flex-wrap gap-2">
          <Link to="/inventory/history" className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white">
            <Clock3 className="mr-2 inline h-4 w-4" />
            Variant history
          </Link>
          <Link to="/warehouses" className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white">
            Warehouse dashboard
          </Link>
        </div>
      }
      tabs={[
        { to: "/inventory", label: "Inventory", end: true },
        { to: "/inventory/movements", label: "Movements" },
        { to: "/inventory/adjustments", label: "Adjustments" },
        { to: "/inventory/count", label: "الجرد" },
        { to: "/stock-transfers", label: "Transfers", end: true },
        { to: "/warehouses", label: "Warehouses" },
      ]}
    >
      {error ? (
        <div className="rounded-3xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-100">
          <AlertTriangle className="mr-2 inline h-4 w-4" />
          {error}
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]">
        <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <Field label="Variant ID" value={variantId} onChange={setVariantId} placeholder="Variant identifier" />
            <Select label="From warehouse" value={fromWarehouse} onChange={setFromWarehouse} options={warehouses} />
            <Select label="To warehouse" value={toWarehouse} onChange={setToWarehouse} options={warehouses} />
            <Field label="Quantity" value={quantity} onChange={setQuantity} type="number" />
          </div>
          <label className="mt-4 block">
            <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-zinc-500">Transfer notes</div>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={5}
              placeholder="Packing notes, driver details, transfer reason..."
              className="w-full rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white outline-none placeholder:text-zinc-500"
            />
          </label>
          <button
            type="button"
            onClick={submitTransfer}
            className="mt-4 inline-flex items-center justify-center gap-2 rounded-2xl bg-blue-500 px-4 py-3 text-sm font-black text-black"
          >
            <Save className="h-4 w-4" />
            Submit transfer
          </button>
        </div>

        <div className="space-y-4">
          <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10">
            <h3 className="text-xl font-black text-white">Transfer history</h3>
            <div className="mt-4 space-y-3">
              {loading ? (
                <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-sm text-zinc-400">Loading warehouses...</div>
              ) : transfers.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/10 bg-white/5 p-6 text-sm text-zinc-400">No transfers recorded locally.</div>
              ) : (
                transfers.map((transfer) => (
                  <div key={String(transfer.id)} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold text-white">Variant {transfer.variant_id}</div>
                        <div className="mt-1 text-xs text-zinc-500">{formatDateTime(transfer.created_at)}</div>
                      </div>
                      <StatusBadge value={transfer.status || "Draft"} />
                    </div>
                    <div className="mt-2 text-sm text-zinc-300">
                      {transfer.from_warehouse} → {transfer.to_warehouse} • Qty {transfer.quantity}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10">
            <h3 className="text-xl font-black text-white">Warehouse transfer placeholder</h3>
            <p className="mt-3 text-sm text-zinc-400">
              This page keeps the ERP workflow intact even when transfer metadata is partial in the backend. The record is persisted locally and the live transfer endpoint is used when available.
            </p>
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

function Select({ label, value, onChange, options }) {
  return (
    <label className="block">
      <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-zinc-500">{label}</div>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none">
        {options.map((option) => (
          <option key={String(option.id)} value={String(option.id)} className="bg-zinc-950 text-white">
            {option.name}
          </option>
        ))}
      </select>
    </label>
  );
}

export default StockTransfers;
