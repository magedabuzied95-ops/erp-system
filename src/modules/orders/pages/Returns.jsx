import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { AlertTriangle, Save, ShieldCheck } from "lucide-react";
import toast from "react-hot-toast";

import { api } from "../../../shared/api/api";
import OrdersShell from "../components/OrdersShell";
import { addReturnRecord, formatCurrency, mockOrders, normalizeOrder } from "../lib/ordersStore";

function Returns() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedOrderId, setSelectedOrderId] = useState("");
  const [reason, setReason] = useState("");
  const [restock, setRestock] = useState(true);
  const [returnItems, setReturnItems] = useState({});
  const [refundAmount, setRefundAmount] = useState(0);
  const [status, setStatus] = useState("Draft");
  const [shippingProvider, setShippingProvider] = useState("");
  const [trackingNumber, setTrackingNumber] = useState("");

  const loadOrders = async () => {
    try {
      setLoading(true);
      setError("");
      const data = await api.get("/orders");
      const baseOrders = Array.isArray(data) ? data : Array.isArray(data.orders) ? data.orders : [];
      const normalized = baseOrders.length ? baseOrders.map((order) => normalizeOrder(order, { items: [] })) : mockOrders();
      setOrders(normalized);
      setSelectedOrderId(String(normalized[0]?.id || ""));
    } catch (err) {
      console.log(err);
      const fallback = mockOrders();
      setOrders(fallback);
      setSelectedOrderId(String(fallback[0]?.id || ""));
      setError("Orders endpoint unavailable. Return workflow is using local fallback data.");
      toast.error("Using fallback return data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadOrders();
  }, []);

  const selectedOrder = useMemo(
    () => orders.find((order) => String(order.id) === String(selectedOrderId)) || null,
    [orders, selectedOrderId]
  );

  const selectedItems = useMemo(() => (selectedOrder ? selectedOrder.items || [] : []), [selectedOrder]);

  useEffect(() => {
    const total = selectedItems.reduce((sum, item) => {
      const qty = Number(returnItems[item.id]?.quantity || 0);
      return sum + qty * Number(item.price || 0);
    }, 0);
    setRefundAmount(total);
  }, [returnItems, selectedItems]);

  const toggleItem = (item) => {
    setReturnItems((prev) => {
      const existing = prev[item.id];
      if (existing) {
        const next = { ...prev };
        delete next[item.id];
        return next;
      }
      return { ...prev, [item.id]: { quantity: 1, reason: "", item } };
    });
  };

  const updateItemQuantity = (itemId, quantity) => {
    setReturnItems((prev) => ({
      ...prev,
      [itemId]: {
        ...prev[itemId],
        quantity: Number(quantity || 0),
      },
    }));
  };

  const submitReturn = async () => {
    if (!selectedOrder) {
      toast.error("Select an order");
      return;
    }

    const payload = {
      orderId: selectedOrder.id,
      orderNumber: selectedOrder.invoice_number,
      reason,
      restock,
      refundAmount,
      status,
      shippingProvider,
      trackingNumber,
      items: Object.values(returnItems)
        .filter((item) => Number(item.quantity || 0) > 0)
        .map((item) => ({
          orderItemId: item.item.id,
          variantId: item.item.variant_id || item.item.variantId || null,
          quantity: Number(item.quantity || 0),
          refund_amount: Number(item.quantity || 0) * Number(item.item.price || 0),
        })),
      createdAt: new Date().toISOString(),
    };

    try {
      await api.post("/orders/returns", payload);
      addReturnRecord(payload);
      toast.success("Return saved");
      setStatus("Submitted");
    } catch (err) {
      console.log(err);
      addReturnRecord(payload);
      toast.error("Backend returns endpoint unavailable. Saved locally.");
      setStatus("Submitted");
    }
  };

  return (
    <OrdersShell
      title="Returns Module"
      subtitle="Create returns from orders, pick line items, control restock behavior, and record refund outcomes."
      actions={
        <Link
          to="/orders"
          className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
        >
          Back to orders
        </Link>
      }
    >
      {error ? (
        <div className="rounded-3xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-100">
          <AlertTriangle className="mr-2 inline h-4 w-4" />
          {error}
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(420px,0.85fr)]">
        <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <label className="block">
              <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-zinc-500">Order</div>
              <select
                value={selectedOrderId}
                onChange={(e) => setSelectedOrderId(e.target.value)}
                disabled={loading}
                className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none"
              >
                {orders.map((order) => (
                  <option key={String(order.id)} value={String(order.id)} className="bg-zinc-950 text-white">
                    {order.invoice_number} • {order.customer_name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-zinc-500">Return status</div>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none"
              >
                <option>Draft</option>
                <option>Submitted</option>
                <option>Approved</option>
                <option>Rejected</option>
                <option>Refunded</option>
              </select>
            </label>
            <label className="block">
              <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-zinc-500">Shipping provider</div>
              <input
                value={shippingProvider}
                onChange={(e) => setShippingProvider(e.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none"
                placeholder="Provider placeholder"
              />
            </label>
            <label className="block">
              <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-zinc-500">Tracking number</div>
              <input
                value={trackingNumber}
                onChange={(e) => setTrackingNumber(e.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none"
                placeholder="Tracking placeholder"
              />
            </label>
          </div>

          <div className="mt-4 rounded-3xl border border-white/10 bg-white/5 p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-black text-white">Returned items</h3>
              <div className="text-sm text-zinc-400">{selectedOrder?.customer_name || "n/a"}</div>
            </div>
            <div className="mt-4 space-y-3">
              {selectedItems.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/10 bg-black/20 p-6 text-sm text-zinc-400">
                  No order items found. Live returns use the order detail endpoint when available.
                </div>
              ) : (
                selectedItems.map((item, index) => {
                  const checked = Boolean(returnItems[item.id]);
                  const value = returnItems[item.id]?.quantity ?? 1;
                  return (
                    <div key={String(item.id || index)} className="rounded-2xl border border-white/10 bg-zinc-950 p-4">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                        <button
                          type="button"
                          onClick={() => toggleItem(item)}
                          className={`rounded-2xl px-3 py-2 text-sm font-semibold ${
                            checked ? "bg-emerald-500 text-black" : "border border-white/10 bg-white/5 text-white"
                          }`}
                        >
                          {checked ? "Included" : "Select"}
                        </button>
                        <div className="flex-1">
                          <div className="font-semibold text-white">{item.product_name || item.name}</div>
                          <div className="mt-1 text-sm text-zinc-400">
                            {item.color || "Default"} / {item.size || "One size"} • Qty {item.quantity}
                          </div>
                        </div>
                        <div className="text-sm font-semibold text-white">{formatCurrency((item.price || 0) * (item.quantity || 0))}</div>
                      </div>
                      {checked ? (
                        <div className="mt-3 grid gap-3 md:grid-cols-3">
                          <label className="block">
                            <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-zinc-500">Return qty</div>
                            <input
                              type="number"
                              min="1"
                              max={item.quantity}
                              value={value}
                              onChange={(e) => updateItemQuantity(item.id, e.target.value)}
                              className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none"
                            />
                          </label>
                          <label className="block md:col-span-2">
                            <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-zinc-500">Reason</div>
                            <input
                              value={returnItems[item.id]?.reason || reason}
                              onChange={(e) =>
                                setReturnItems((prev) => ({
                                  ...prev,
                                  [item.id]: {
                                    ...prev[item.id],
                                    reason: e.target.value,
                                  },
                                }))
                              }
                              className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none"
                              placeholder="Damaged, wrong size, customer changed mind..."
                            />
                          </label>
                        </div>
                      ) : null}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10">
            <h3 className="text-xl font-black text-white">Return summary</h3>
            <div className="mt-4 grid gap-3">
              <Info label="Order" value={selectedOrder?.invoice_number || "n/a"} />
              <Info label="Customer" value={selectedOrder?.customer_name || "n/a"} />
              <Info label="Refund amount" value={formatCurrency(refundAmount)} />
              <Info label="Restock" value={restock ? "Yes" : "No"} />
              <Info label="Status" value={status} />
            </div>
            <label className="mt-4 flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white">
              <span>Restock returned items</span>
              <input type="checkbox" checked={restock} onChange={(e) => setRestock(e.target.checked)} />
            </label>
            <label className="mt-3 block">
              <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-zinc-500">Return reason</div>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={5}
                className="w-full rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white outline-none"
                placeholder="Overall reason for the return..."
              />
            </label>
            <button
              type="button"
              onClick={submitReturn}
              className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-black text-black"
            >
              <Save className="h-4 w-4" />
              Save return
            </button>
          </div>

          <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10">
            <h3 className="text-xl font-black text-white">Return checklist</h3>
            <div className="mt-4 space-y-3 text-sm text-zinc-300">
              <Checklist label="Customer confirms item condition" />
              <Checklist label="Refund amount reviewed" />
              <Checklist label="Restock policy applied" />
              <Checklist label="Shipping and delivery notes captured" />
            </div>
          </div>
        </div>
      </div>
    </OrdersShell>
  );
}

function Info({ label, value }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">{label}</div>
      <div className="mt-1 text-sm font-semibold text-white">{value}</div>
    </div>
  );
}

function Checklist({ label }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-4">
      <ShieldCheck className="h-4 w-4 text-emerald-400" />
      <span>{label}</span>
    </div>
  );
}

export default Returns;
