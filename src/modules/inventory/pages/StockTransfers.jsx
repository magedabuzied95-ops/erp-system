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

import { useTranslation } from "react-i18next";

import i18n from "../../../i18n/i18n";

/** Module-scope translator for helpers defined outside a component. */
const tt = (key, options) => i18n.t(key, options);

function StockTransfers() {
  // Subscribes this screen to language changes; strings resolve through tt().
  useTranslation();
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
        setError(tt("inventory.transfers.fallbackEnabled"));
        toast.error(tt("inventory.transfers.usingFallback"));
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
      toast.error(tt("inventory.transfers.variantIdRequired"));
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
        status: tt("inventory.transfers.transferred"),
      };
      saveInventoryTransfers([record, ...transfers]);
      toast.success(tt("inventory.transfers.sent"));
    } catch (err) {
      console.log(err);
      const record = {
        id: `trf-${Date.now()}`,
        ...payload,
        notes,
        created_at: new Date().toISOString(),
        status: tt("inventory.count.status.draft"),
      };
      saveInventoryTransfers([record, ...transfers]);
      toast.error(tt("inventory.transfers.routeUnavailable"));
    }
  };

  return (
    <InventoryShell
      title={tt("inventory.transfers.title")}
      subtitle={tt("inventory.transfers.pageSubtitle")}
      actions={
        <div className="flex flex-wrap gap-2">
          <Link to="/inventory/history" className="rounded-[var(--radius-card)] border border-border bg-surface-soft px-4 py-2 text-sm font-semibold text-text">
            <Clock3 className="mr-2 inline h-4 w-4" />
            {tt("inventory.movements.variantHistoryList")}
          </Link>
          <Link to="/warehouses" className="rounded-[var(--radius-card)] border border-border bg-surface-soft px-4 py-2 text-sm font-semibold text-text">
            {tt("warehouses.title")}
          </Link>
        </div>
      }
      tabs={[
        { to: "/inventory", label: tt("inventory.table.stock"), end: true },
        { to: "/inventory/movements", label: tt("inventory.tabs.movements") },
        { to: "/inventory/adjustments", label: tt("inventory.tabs.adjustments") },
        { to: "/inventory/count", label: tt("inventory.tabs.count") },
        { to: "/stock-transfers", label: tt("inventory.tabs.transfers"), end: true },
        { to: "/warehouses", label: tt("inventory.tabs.warehouses") },
      ]}
    >
      {error ? (
        <div className="rounded-[var(--radius-card)] border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-100">
          <AlertTriangle className="mr-2 inline h-4 w-4" />
          {error}
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]">
        <div className="rounded-[var(--radius-card)] border border-border bg-surface p-5 shadow-2xl shadow-black/10">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <Field label={tt("inventory.movements.variantId")} value={variantId} onChange={setVariantId} placeholder={tt("inventory.transfers.enterVariantId")} />
            <Select label={tt("inventory.transfers.fromWarehouse")} value={fromWarehouse} onChange={setFromWarehouse} options={warehouses} />
            <Select label={tt("inventory.transfers.toWarehouse")} value={toWarehouse} onChange={setToWarehouse} options={warehouses} />
            <Field label={tt("inventory.labels.quantity")} value={quantity} onChange={setQuantity} type="number" />
          </div>
          <label className="mt-4 block">
            <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-text-muted">{tt("inventory.transfers.notes")}</div>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={5}
              placeholder={tt("inventory.transfers.notesPlaceholder")}
              className="w-full rounded-[var(--radius-control)] border border-border bg-surface-soft p-4 text-sm text-text outline-none placeholder:text-text-muted"
            />
          </label>
          <button
            type="button"
            onClick={submitTransfer}
            className="mt-4 inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] bg-primary px-4 py-3 text-sm font-black text-[var(--primary-contrast)]"
          >
            <Save className="h-4 w-4" />
            {tt("inventory.transfers.send")}
          </button>
        </div>

        <div className="space-y-4">
          <div className="rounded-[var(--radius-card)] border border-border bg-surface p-5 shadow-2xl shadow-black/10">
            <h3 className="m1-section-title text-text">{tt("inventory.transfers.log")}</h3>
            <div className="mt-4 space-y-3">
              {loading ? (
                <div className="rounded-[var(--radius-card)] border border-border bg-surface-soft p-6 text-sm text-text-muted">{tt("inventory.adjustments.loadingWarehouses")}</div>
              ) : transfers.length === 0 ? (
                <div className="rounded-[var(--radius-card)] border border-dashed border-border bg-surface-soft p-6 text-sm text-text-muted">{tt("inventory.transfers.emptyLog")}</div>
              ) : (
                transfers.map((transfer) => (
                  <div key={String(transfer.id)} className="rounded-[var(--radius-card)] border border-border bg-surface-soft p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold text-text">الاختيار {transfer.variant_id}</div>
                        <div className="mt-1 text-xs text-text-muted">{formatDateTime(transfer.created_at)}</div>
                      </div>
                      <StatusBadge value={transfer.status || tt("inventory.count.status.draft")} />
                    </div>
                    <div className="mt-2 text-sm text-text-muted">
                      {transfer.from_warehouse} ← {transfer.to_warehouse} • الكمية {transfer.quantity}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-[var(--radius-card)] border border-border bg-surface p-5 shadow-2xl shadow-black/10">
            <h3 className="m1-section-title text-text">{tt("inventory.transfers.title")}</h3>
            <p className="mt-3 text-sm text-text-muted">
              {tt("inventory.transfers.resilienceHint")}
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
      <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-text-muted">{label}</div>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(type === "number" ? Number(e.target.value || 0) : e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-[var(--radius-control)] border border-border bg-surface-soft px-4 py-3 text-sm text-text outline-none"
      />
    </label>
  );
}

function Select({ label, value, onChange, options }) {
  return (
    <label className="block">
      <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-text-muted">{label}</div>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-[var(--radius-control)] border border-border bg-surface-soft px-4 py-3 text-sm text-text outline-none">
        {options.map((option) => (
          <option key={String(option.id)} value={String(option.id)} className="bg-surface text-text">
            {option.name}
          </option>
        ))}
      </select>
    </label>
  );
}

export default StockTransfers;
