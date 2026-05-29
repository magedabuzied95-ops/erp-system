import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { AlertTriangle, Save, ShieldCheck } from "lucide-react";
import toast from "react-hot-toast";

import { api } from "../../../shared/api/api";
import OrdersShell from "../components/OrdersShell";
import { addReturnRecord, formatCurrency, mockOrders, normalizeOrder } from "../lib/ordersStore";

const resolveOrderItemUnitPrice = (item = {}) => {
  const candidates = [
    item.unit_price,
    item.unitPrice,
    item.price,
    item.sale_price,
    item.salePrice,
    item.selling_price,
    item.sellingPrice,
    item.product_price,
    item.productPrice,
    item.variant_price,
    item.variantPrice,
    item.line_unit_price,
    item.lineUnitPrice,
  ];
  const numbers = candidates
    .filter((value) => value !== null && value !== undefined && value !== "")
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
  return numbers.find((value) => value > 0) ?? numbers[0] ?? 0;
};

function Returns() {
  const { t } = useTranslation();
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
      setError(t("orders.returns.workflowFallback"));
      toast.error(t("orders.returns.usingFallback"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadOrders();
  }, [t]);

  const selectedOrder = useMemo(
    () => orders.find((order) => String(order.id) === String(selectedOrderId)) || null,
    [orders, selectedOrderId]
  );

  const selectedItems = useMemo(() => (selectedOrder ? selectedOrder.items || [] : []), [selectedOrder]);

  useEffect(() => {
    const total = selectedItems.reduce((sum, item) => {
      const qty = Number(returnItems[item.id]?.quantity || 0);
      return sum + qty * resolveOrderItemUnitPrice(item);
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
      toast.error(t("orders.returns.selectOrder"));
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
          refund_amount: Number(item.quantity || 0) * resolveOrderItemUnitPrice(item.item),
        })),
      createdAt: new Date().toISOString(),
    };

    try {
      await api.post("/orders/returns", payload);
      addReturnRecord(payload);
      toast.success(t("orders.returns.saved"));
      setStatus("Submitted");
    } catch (err) {
      console.log(err);
      addReturnRecord(payload);
      toast.error(t("orders.returns.backendUnavailable"));
      setStatus("Submitted");
    }
  };

  return (
    <OrdersShell
      title={t("orders.returns.moduleTitle")}
      subtitle={t("orders.returns.moduleSubtitle")}
      actions={
        <Link
          to="/orders"
          className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
        >
          {t("orders.details.backToOrders")}
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
              <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-zinc-500">{t("orders.cancel.order")}</div>
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
              <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-zinc-500">{t("orders.returns.returnStatus")}</div>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none"
              >
                <option value="Draft">{t("orders.statusLabels.draft")}</option>
                <option value="Submitted">{t("orders.statusLabels.submitted")}</option>
                <option value="Approved">{t("orders.statusLabels.approved")}</option>
                <option value="Rejected">{t("orders.statusLabels.rejected")}</option>
                <option value="Refunded">{t("orders.statusLabels.refunded")}</option>
              </select>
            </label>
            <label className="block">
              <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-zinc-500">{t("orders.shipping.provider")}</div>
              <input
                value={shippingProvider}
                onChange={(e) => setShippingProvider(e.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none"
                placeholder={t("orders.returns.providerPlaceholder")}
              />
            </label>
            <label className="block">
              <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-zinc-500">{t("orders.shipping.trackingNumber")}</div>
              <input
                value={trackingNumber}
                onChange={(e) => setTrackingNumber(e.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none"
                placeholder={t("orders.returns.trackingPlaceholder")}
              />
            </label>
          </div>

          <div className="mt-4 rounded-3xl border border-white/10 bg-white/5 p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-black text-white">{t("orders.returns.returnedItems")}</h3>
              <div className="text-sm text-zinc-400">{selectedOrder?.customer_name || t("orders.fallback.notAvailable")}</div>
            </div>
            <div className="mt-4 space-y-3">
              {selectedItems.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/10 bg-black/20 p-6 text-sm text-zinc-400">
                  {t("orders.returns.noItemsFound")}
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
                          {checked ? t("orders.returns.included") : t("orders.returns.select")}
                        </button>
                        <div className="flex-1">
                          <div className="font-semibold text-white">{item.product_name || item.name}</div>
                          <div className="mt-1 text-sm text-zinc-400">
                            {item.color || t("orders.details.defaultVariant")} / {item.size || t("orders.details.oneSize")} - {t("orders.drawer.qty")} {item.quantity}
                          </div>
                        </div>
                        <div className="text-sm font-semibold text-white">{formatCurrency(resolveOrderItemUnitPrice(item) * (item.quantity || 0))}</div>
                      </div>
                      {checked ? (
                        <div className="mt-3 grid gap-3 md:grid-cols-3">
                          <label className="block">
                            <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-zinc-500">{t("orders.returns.returnQty")}</div>
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
                            <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-zinc-500">{t("orders.returns.reason")}</div>
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
                              placeholder={t("orders.returns.reasonPlaceholder")}
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
            <h3 className="text-xl font-black text-white">{t("orders.returns.returnSummary")}</h3>
            <div className="mt-4 grid gap-3">
              <Info label={t("orders.cancel.order")} value={selectedOrder?.invoice_number || t("orders.fallback.notAvailable")} />
              <Info label={t("orders.drawer.customer")} value={selectedOrder?.customer_name || t("orders.fallback.notAvailable")} />
              <Info label={t("orders.returns.refundAmount")} value={formatCurrency(refundAmount)} />
              <Info label={t("orders.returns.restock")} value={restock ? t("orders.returns.yes") : t("orders.returns.no")} />
              <Info label={t("orders.table.status")} value={t(`orders.statusLabels.${String(status).toLowerCase()}`, status)} />
            </div>
            <label className="mt-4 flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white">
              <span>{t("orders.returns.restockReturnedItems")}</span>
              <input type="checkbox" checked={restock} onChange={(e) => setRestock(e.target.checked)} />
            </label>
            <label className="mt-3 block">
              <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-zinc-500">{t("orders.returns.returnReason")}</div>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={5}
                className="w-full rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white outline-none"
                placeholder={t("orders.returns.overallReasonPlaceholder")}
              />
            </label>
            <button
              type="button"
              onClick={submitReturn}
              className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-black text-black"
            >
              <Save className="h-4 w-4" />
              {t("orders.returns.saveReturn")}
            </button>
          </div>

          <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10">
            <h3 className="text-xl font-black text-white">{t("orders.returns.returnChecklist")}</h3>
            <div className="mt-4 space-y-3 text-sm text-zinc-300">
              <Checklist label={t("orders.returns.checkItemCondition")} />
              <Checklist label={t("orders.returns.checkRefundReviewed")} />
              <Checklist label={t("orders.returns.checkRestockApplied")} />
              <Checklist label={t("orders.returns.checkShippingCaptured")} />
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
