import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";

import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  DollarSign,
  Eye,
  MoreHorizontal,
  PackageOpen,
  ReceiptText,
  RotateCcw,
  Search,
  ShoppingCart,
} from "lucide-react";

import toast from "react-hot-toast";
import { socket } from "../../../socket";
import { api } from "../../../shared/api/api";
import OrdersShell from "../components/OrdersShell";
import StatusBadge from "../components/StatusBadge";
import {
  buildSearchText,
  deriveKpis,
  formatCurrency,
  formatDateTime,
  mockOrders,
  normalizeOrder,
} from "../lib/ordersStore";
import {
  formatShippingPaymentMethodLabel,
  isInvalidShippingProofUrl,
  resolveShippingProofImageUrl,
} from "../../../shared/lib/imageUrls";

const PAGE_SIZE = 10;
const uniqueValues = (items) => Array.from(new Set(items.filter(Boolean)));
const SOURCE_FILTERS = ["all", "pos", "website", "whatsapp", "instagram", "manual"];
const SOURCE_LABELS = {
  pos: "POS",
  website: "Website",
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  manual: "Manual",
};

const getAttributionLabel = (order = {}) => {
  const source = String(order.attribution_type || order.marketing_source || "").toLowerCase();
  const platform = String(order.marketing_platform || order.marketing_source || "").toLowerCase();
  if (source.includes("instagram") && source.includes("story")) return "Instagram Story";
  if (source.includes("story")) return "Story";
  if (platform === "facebook" || source.includes("facebook")) return "Facebook Post";
  if (platform === "instagram" || source.includes("instagram")) return "Instagram Post";
  if (platform === "whatsapp" || source.includes("whatsapp")) return "WhatsApp Campaign";
  if (platform === "tiktok" || source.includes("tiktok")) return "TikTok Campaign";
  if (order.marketing_campaign) return String(order.marketing_campaign);
  return "";
};

function OrdersDashboard() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [paymentFilter, setPaymentFilter] = useState("all");
  const [channelFilter, setChannelFilter] = useState(() => searchParams.get("channel") || "all");
  const [branchFilter, setBranchFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("");
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState([]);
  const [openMenuId, setOpenMenuId] = useState(null);

  const loadOrders = async () => {
    try {
      setLoading(true);
      setError("");

      const data = await api.get("/orders");
      const baseOrders = Array.isArray(data) ? data : Array.isArray(data.orders) ? data.orders : [];
      const enriched = await Promise.all(
        baseOrders.slice(0, 250).map(async (order) => {
          try {
            const details = await api.get(`/orders/${order.id}`);
            return normalizeOrder(order, {
              items: Array.isArray(details.items) ? details.items : [],
              total: details?.order?.total ?? order.total,
            });
          } catch {
            return normalizeOrder(order, { items: [] });
          }
        })
      );
      setOrders(enriched.length ? enriched : mockOrders());
    } catch (err) {
      console.log(err);
      setOrders(mockOrders());
      setError(t("common.noData"));
      toast.error(t("common.noData"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadOrders();

    const handleNewOrder = (newOrder) => {
      setOrders((prev) => [normalizeOrder(newOrder, { items: [] }), ...prev]);
      toast.success(`${t("orders.title")} #${newOrder.id}`);
    };

    socket.on("new_order", handleNewOrder);
    return () => socket.off("new_order", handleNewOrder);
  }, []);

  const filteredOrders = useMemo(() => {
    const query = search.trim().toLowerCase();
    return orders.filter((order) => {
      const matchesSearch = !query || buildSearchText(order).includes(query);
      const matchesStatus = statusFilter === "all" || order.status === statusFilter;
      const matchesPayment = paymentFilter === "all" || order.paymentStatus === paymentFilter;
      const orderSource = String(order.source || order.channel || "").toLowerCase();
      const matchesChannel = channelFilter === "all" || orderSource === channelFilter;
      const matchesBranch = branchFilter === "all" || order.branch === branchFilter;
      const matchesDate = !dateFilter || String(order.created_at || "").slice(0, 10) === dateFilter;
      return matchesSearch && matchesStatus && matchesPayment && matchesChannel && matchesBranch && matchesDate;
    });
  }, [orders, search, statusFilter, paymentFilter, channelFilter, branchFilter, dateFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredOrders.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const visibleOrders = filteredOrders.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const kpis = deriveKpis(orders);
  const verificationOrders = useMemo(
    () => orders.filter((order) => order.status === "awaiting_verification" || order.paymentStatus === "awaiting_verification"),
    [orders]
  );

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter, paymentFilter, channelFilter, branchFilter, dateFilter]);

  useEffect(() => {
    const channel = searchParams.get("channel") || "all";
    setChannelFilter(channel);
  }, [searchParams]);

  const toggleSelected = (id) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  };

  const bulkSetStatus = (status) => {
    setOrders((prev) =>
      prev.map((order) => (selectedIds.includes(order.id) ? { ...order, status } : order))
    );
    toast.success(`${selectedIds.length} ${t("orders.bulk.selected")}`);
    setSelectedIds([]);
  };

  const updateShippingPayment = async (orderId, action) => {
    try {
      const data = await api.post(`/orders/${orderId}/${action === "confirm" ? "confirm-payment" : "reject-payment"}`, {});
      setOrders((prev) => prev.map((order) => (String(order.id) === String(orderId) ? normalizeOrder(data.order || order, { items: order.items || [] }) : order)));
      toast.success(action === "confirm" ? "Payment confirmed" : "Payment rejected");
    } catch (err) {
      toast.error(err.message || "Failed to update payment");
    }
  };

  return (
    <OrdersShell
      title={t("orders.title")}
      subtitle={t("orders.subtitle")}
      actions={
        <button
          type="button"
          onClick={() => navigate("/orders/returns")}
          className="inline-flex items-center gap-2 rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-2 text-sm font-semibold text-rose-200 transition hover:bg-rose-500/20"
        >
          <RotateCcw className="h-4 w-4" />
          {t("orders.actions.createReturn")}
        </button>
      }
    >
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <KpiCard label={t("orders.kpis.totalOrders")} value={kpis.totalOrders} icon={<ShoppingCart className="h-5 w-5" />} />
        <KpiCard label={t("orders.kpis.paid")} value={kpis.paid} icon={<CheckCircle2 className="h-5 w-5" />} tone="emerald" />
        <KpiCard label={t("orders.kpis.pending")} value={kpis.pending} icon={<Clock3 className="h-5 w-5" />} tone="amber" />
        <KpiCard label={t("orders.kpis.returned")} value={kpis.returned} icon={<RotateCcw className="h-5 w-5" />} tone="rose" />
        <KpiCard label={t("orders.kpis.revenue")} value={formatCurrency(kpis.revenue, i18n.language)} icon={<DollarSign className="h-5 w-5" />} tone="blue" />
      </div>

      {error ? (
        <div className="rounded-3xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-100">
          <AlertTriangle className="mr-2 inline h-4 w-4" />
          {error}
        </div>
      ) : null}

      {verificationOrders.length ? (
        <div className="rounded-3xl border border-amber-500/20 bg-amber-500/10 p-4 shadow-2xl shadow-black/10">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-amber-300">Shipping Payments</div>
              <h2 className="text-xl font-black text-white">Awaiting verification</h2>
            </div>
            <span className="rounded-2xl bg-amber-400/20 px-3 py-1 text-sm font-black text-amber-100">{verificationOrders.length}</span>
          </div>
          <div className="mt-4 grid gap-3 xl:grid-cols-2">
            {verificationOrders.map((order) => (
              (() => {
                const proofUrl = resolveShippingProofImageUrl(order.shipping_payment_screenshot);
                const proofInvalid = isInvalidShippingProofUrl(order.shipping_payment_screenshot);
                return (
              <div key={String(order.id)} className="grid gap-3 rounded-3xl border border-white/10 bg-zinc-950/80 p-4 md:grid-cols-[7rem_minmax(0,1fr)]">
                <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/5">
                  {proofInvalid ? (
                    <div className="grid h-28 place-items-center px-3 text-center text-xs font-semibold text-rose-200">
                      صورة إثبات التحويل غير صالحة
                    </div>
                  ) : proofUrl ? (
                    <img src={proofUrl} alt="Payment proof" className="h-28 w-full object-cover" />
                  ) : (
                    <div className="grid h-28 place-items-center text-xs font-semibold text-zinc-500">No proof</div>
                  )}
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="font-black text-white">{order.invoice_number}</div>
                      <div className="mt-1 text-sm text-zinc-400">{order.customer_name} - {order.customer_phone || "No phone"}</div>
                    </div>
                    <StatusBadge value={order.paymentStatus} />
                  </div>
                  <div className="mt-3 grid gap-2 text-sm text-zinc-300 sm:grid-cols-3">
                    <span>Method: <b className="text-white">{formatShippingPaymentMethodLabel(order.shipping_payment_method || order.payment_method)}</b></span>
                    <span>Shipping: <b className="text-white">{formatCurrency(order.shipping_fee || order.delivery_fee || 0)}</b></span>
                    <span>Ref: <b className="text-white">{order.shipping_payment_reference || "n/a"}</b></span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" disabled={proofInvalid} onClick={() => updateShippingPayment(order.id, "confirm")} className="rounded-2xl bg-emerald-500 px-3 py-2 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-50">
                      Confirm Payment
                    </button>
                    <button type="button" disabled={proofInvalid} onClick={() => updateShippingPayment(order.id, "reject")} className="rounded-2xl bg-rose-500 px-3 py-2 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-50">
                      Reject Payment
                    </button>
                    <button type="button" onClick={() => navigate(`/orders/${order.id}`)} className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-white">
                      View details
                    </button>
                  </div>
                </div>
              </div>
                );
              })()
            ))}
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-4 shadow-2xl shadow-black/10">
          <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_repeat(5,12rem)]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("orders.searchPlaceholder")}
                className="w-full rounded-2xl border border-white/10 bg-white/5 py-3 pl-11 pr-4 text-sm text-white outline-none placeholder:text-zinc-500"
              />
            </div>
            <Select value={statusFilter} onChange={setStatusFilter} options={["all", ...uniqueValues(orders.map((o) => o.status))]} label={t("orders.filters.status")} allLabel={t("orders.filters.all")} />
            <Select value={paymentFilter} onChange={setPaymentFilter} options={["all", ...uniqueValues(orders.map((o) => o.paymentStatus))]} label={t("orders.filters.payment")} allLabel={t("orders.filters.all")} />
            <Select value={channelFilter} onChange={setChannelFilter} options={SOURCE_FILTERS} label="Source" allLabel={t("orders.filters.all")} labels={SOURCE_LABELS} />
            <Select value={branchFilter} onChange={setBranchFilter} options={["all", ...uniqueValues(orders.map((o) => o.branch))]} label={t("orders.filters.branch")} allLabel={t("orders.filters.all")} />
            <input
              type="date"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none"
            />
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => bulkSetStatus("Confirmed")}
              disabled={!selectedIds.length}
              className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40"
            >
              {t("orders.bulk.markConfirmed")}
            </button>
            <button
              type="button"
              onClick={() => bulkSetStatus("Shipped")}
              disabled={!selectedIds.length}
              className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40"
            >
              {t("orders.bulk.markShipped")}
            </button>
            <button
              type="button"
              onClick={() => bulkSetStatus("Cancelled")}
              disabled={!selectedIds.length}
              className="rounded-2xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-sm font-semibold text-rose-200 disabled:opacity-40"
            >
              {t("orders.bulk.cancelSelected")}
            </button>
            <div className="ml-auto text-sm text-zinc-400">{selectedIds.length} {t("orders.bulk.selected")}</div>
          </div>

          <div className="mt-4 overflow-x-auto">
            <div className="min-w-[1100px]">
              <div className="grid grid-cols-[12%_18%_12%_12%_10%_10%_10%_12%_4%] rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-xs uppercase tracking-[0.18em] text-zinc-500">
                <div>{t("orders.table.invoice")}</div>
                <div>{t("orders.table.customer")}</div>
                <div>{t("orders.table.status")}</div>
                <div>{t("orders.table.payment")}</div>
                <div>{t("orders.table.channel")}</div>
                <div>{t("orders.table.branch")}</div>
                <div>{t("orders.table.total")}</div>
                <div>{t("orders.table.date")}</div>
                <div></div>
              </div>

              <div className="mt-2 space-y-2">
                {loading ? (
                  <TableSkeleton />
                ) : visibleOrders.length === 0 ? (
                  <div className="rounded-3xl border border-dashed border-white/10 bg-white/5 p-10 text-center">
                    <PackageOpen className="mx-auto h-12 w-12 text-zinc-500" />
                    <h3 className="mt-4 text-xl font-black text-white">{t("orders.empty.title")}</h3>
                    <p className="mt-2 text-sm text-zinc-400">{t("orders.empty.description")}</p>
                  </div>
                ) : (
                  visibleOrders.map((order) => (
                    <div
                      key={String(order.id)}
                      className={`grid grid-cols-[12%_18%_12%_12%_10%_10%_10%_12%_4%] items-center rounded-2xl border px-4 py-3 transition hover:border-blue-500/40 hover:bg-white/5 ${
                        selectedIds.includes(order.id) ? "border-blue-500/30 bg-blue-500/10" : "border-white/10 bg-zinc-950/90"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <input type="checkbox" checked={selectedIds.includes(order.id)} onChange={() => toggleSelected(order.id)} />
                        <div>
                          <div className="font-bold text-white">{order.invoice_number}</div>
                          <div className="text-xs text-zinc-500">#{order.id}</div>
                        </div>
                      </div>
                      <div>
                        <div className="font-semibold text-white">{order.customer_name}</div>
                        <div className="text-xs text-zinc-500">{order.customer_phone || "No phone"}</div>
                        {getAttributionLabel(order) ? (
                          <div className="mt-2 inline-flex rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2.5 py-1 text-[11px] font-semibold text-cyan-200">
                            {getAttributionLabel(order)}
                          </div>
                        ) : null}
                        {String(order.source || order.channel || "").toLowerCase() === "website" ? (
                          <div className="mt-2 inline-flex rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-200">
                            Online Order
                          </div>
                        ) : null}
                      </div>
                      <StatusBadge value={order.status} />
                      <StatusBadge value={order.paymentStatus} />
                      <div className="text-sm text-zinc-300">{SOURCE_LABELS[String(order.source || order.channel || "").toLowerCase()] || order.source || order.channel}</div>
                      <div className="text-sm text-zinc-300">{order.branch}</div>
                      <div className="font-bold text-white">{formatCurrency(order.total)}</div>
                      <div className="text-xs text-zinc-400">{formatDateTime(order.created_at)}</div>
                      <div className="relative flex justify-end">
                        <button
                          type="button"
                          onClick={() => setOpenMenuId(openMenuId === order.id ? null : order.id)}
                          className="rounded-xl border border-white/10 bg-white/5 p-2 text-white"
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </button>
                        {openMenuId === order.id ? (
                          <div className="absolute right-0 top-11 z-20 w-48 rounded-2xl border border-white/10 bg-zinc-950 p-2 shadow-2xl">
                            <MenuItem to={`/orders/${order.id}`} icon={<Eye className="h-4 w-4" />} label="View details" />
                            <MenuItem to="/orders/returns" icon={<RotateCcw className="h-4 w-4" />} label={t("orders.actions.createReturn")} />
                            <button
                              type="button"
                              onClick={() => {
                                navigator.clipboard.writeText(order.invoice_number);
                                toast.success(t("orders.actions.invoiceCopied"));
                              }}
                              className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-zinc-200 hover:bg-white/5"
                            >
                              <ReceiptText className="h-4 w-4" />
                              {t("orders.actions.copyInvoice")}
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-zinc-400">
              {t("orders.paging.showing")} {visibleOrders.length} {t("orders.paging.of")} {filteredOrders.length} {t("orders.paging.records")}
            </div>
            <div className="flex items-center gap-2">
              <PagerButton onClick={() => setPage((prev) => Math.max(1, prev - 1))} disabled={currentPage === 1} label={t("common.previous")} />
              <span className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-zinc-300">
                {t("orders.paging.page")} {currentPage} / {totalPages}
              </span>
              <PagerButton onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))} disabled={currentPage === totalPages} label={t("common.next")} />
            </div>
          </div>
        </div>

        <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-4 shadow-2xl shadow-black/10">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">{t("orders.summary.quick")}</div>
              <h2 className="text-xl font-black text-white">{t("orders.summary.recentSignals")}</h2>
            </div>
          </div>
          <div className="mt-4 space-y-3">
            {orders.slice(0, 5).map((order) => (
              <button
                key={String(order.id)}
                type="button"
                onClick={() => navigate(`/orders/${order.id}`)}
                className="w-full rounded-3xl border border-white/10 bg-white/5 p-4 text-left transition hover:bg-white/10"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-white">{order.customer_name}</div>
                    <div className="mt-1 text-xs text-zinc-500">{order.invoice_number}</div>
                  </div>
                  <StatusBadge value={order.status} />
                </div>
                <div className="mt-3 flex items-center justify-between text-sm text-zinc-300">
                  <span>{formatDateTime(order.created_at)}</span>
                  <span className="font-bold text-white">{formatCurrency(order.total)}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </OrdersShell>
  );
}

function KpiCard({ label, value, icon, tone = "zinc" }) {
  const toneClasses = {
    emerald: "border-emerald-500/20 bg-emerald-500/10 text-emerald-300",
    amber: "border-amber-500/20 bg-amber-500/10 text-amber-300",
    rose: "border-rose-500/20 bg-rose-500/10 text-rose-300",
    blue: "border-blue-500/20 bg-blue-500/10 text-blue-300",
    zinc: "border-white/10 bg-white/5 text-white",
  };

  return (
    <div className={`rounded-3xl border p-4 shadow-xl ${toneClasses[tone]}`}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">{label}</div>
          <div className="mt-2 text-2xl font-black text-white">{value}</div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-black/20 p-3">{icon}</div>
      </div>
    </div>
  );
}

function Select({ value, onChange, options, label, allLabel = "All", labels = {} }) {
  return (
    <label className="block">
      <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-zinc-500">{label}</div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none"
      >
        {options.map((option) => (
          <option key={String(option)} value={option} className="bg-zinc-950 text-white">
            {option === "all" ? allLabel : labels[option] || option}
          </option>
        ))}
      </select>
    </label>
  );
}

function PagerButton({ onClick, disabled, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
    >
      {label}
    </button>
  );
}

function MenuItem({ to, icon, label }) {
  return (
    <Link to={to} className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-zinc-200 hover:bg-white/5">
      {icon}
      {label}
    </Link>
  );
}

function TableSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 6 }).map((_, index) => (
        <div key={index} className="h-16 animate-pulse rounded-2xl border border-white/10 bg-white/5" />
      ))}
    </div>
  );
}

export default OrdersDashboard;
