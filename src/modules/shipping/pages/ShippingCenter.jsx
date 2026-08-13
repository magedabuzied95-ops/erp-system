import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import i18n from "../../../i18n/i18n";

/** Module scope: resolve through i18n at CALL time, never eagerly at import. */
const tt = (key, options) => i18n.t(key, options);
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowDownUp,
  CheckCircle2,
  Clock3,
  Download,
  ExternalLink,
  Filter,
  Layers3,
  Loader2,
  MapPin,
  PackageCheck,
  PanelRightClose,
  Printer,
  RefreshCw,
  Search,
  Send,
  Truck,
  X,
} from "lucide-react";
import toast from "react-hot-toast";

import { api } from "../../../shared/api/api";

/*
 * First element is the RAW shipping status enum: it is the statusLabel()
 * lookup key and the <option value> sent to the query. Only the second is
 * display, and it resolves per read so a module constant cannot freeze it.
 */
const STATUS_KEYS = [
  "ready_to_ship", "shipment_created", "picked_up", "in_transit",
  "out_for_delivery", "delivered", "returned", "failed_delivery",
];
const STATUSES = STATUS_KEYS;

const STATUS_META = {
  ready_to_ship: "border-sky-400/25 bg-sky-400/10 text-sky-100",
  shipment_created: "border-indigo-400/25 bg-indigo-400/10 text-indigo-100",
  picked_up: "border-cyan-400/25 bg-cyan-400/10 text-cyan-100",
  in_transit: "border-blue-400/25 bg-blue-400/10 text-blue-100",
  out_for_delivery: "border-amber-400/25 bg-amber-400/10 text-amber-100",
  delivered: "border-emerald-400/25 bg-emerald-400/10 text-emerald-100",
  returned: "border-orange-400/25 bg-orange-400/10 text-orange-100",
  failed_delivery: "border-rose-400/25 bg-rose-400/10 text-rose-100",
};

const PROVIDER_LABELS = {
  bosta: "Bosta",
  mylerz: "Mylerz",
  shipblu: "ShipBlu",
  aramex: "Aramex",
  get in_store_delivery() { return tt("shipping.center.providers.inStoreDelivery"); },
};

const fmtMoney = (value) => `${Number(value || 0).toLocaleString()} EGP`;
const fmtDate = (value) => (value ? new Date(value).toLocaleString() : "-");
/* Literal keys keep these verifiable by the missing-key guard. */
const STATUS_LABEL_KEY = {
  ready_to_ship: "shipping.center.status.ready_to_ship",
  shipment_created: "shipping.center.status.shipment_created",
  picked_up: "shipping.center.status.picked_up",
  in_transit: "shipping.center.status.in_transit",
  out_for_delivery: "shipping.center.status.out_for_delivery",
  delivered: "shipping.center.status.delivered",
  returned: "shipping.center.status.returned",
  failed_delivery: "shipping.center.status.failed_delivery",
};
const statusLabel = (status) =>
  (STATUS_LABEL_KEY[status] ? i18n.t(STATUS_LABEL_KEY[status]) : status) || "-";

function StatusBadge({ status }) {
  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-black ${STATUS_META[status] || "border-white/10 bg-white/5 text-slate-200"}`}>{statusLabel(status)}</span>;
}

function KpiCard({ label, value, active, onClick }) {
  return (
    <button type="button" onClick={onClick} className={`rounded-[var(--radius-control)] border p-4 text-start transition ${active ? "border-emerald-300/50 bg-emerald-400/12" : "border-white/10 bg-white/[0.04] hover:border-white/20 hover:bg-white/[0.07]"}`}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">{label}</span>
        <Truck className="h-4 w-4 text-emerald-300" />
      </div>
      <div className="mt-3 text-3xl font-black text-white">{Number(value || 0).toLocaleString()}</div>
    </button>
  );
}

function Select({ value, onChange, children }) {
  return <select value={value} onChange={(event) => onChange(event.target.value)} className="h-[var(--control-height-md)] rounded-[var(--radius-control)] border border-white/10 bg-slate-950/80 px-3 text-sm font-bold text-white outline-none focus:border-emerald-300/50">{children}</select>;
}

function ShipmentDrawer({ order, onClose }) {
  const { t } = useTranslation();
  if (!order) return null;
  const timeline = Array.isArray(order.shipment_timeline) ? order.shipment_timeline : [];
  const events = Array.isArray(order.webhook_events) ? order.webhook_events : [];
  const cityName = order.shipping_city_name_ar || order.shipping_city_name_en || order.city || "";
  const zoneName = order.shipping_zone_name_ar || order.shipping_zone_name_en || "";
  const districtName = order.shipping_district_name_ar || order.shipping_district_name_en || "";
  const address = [order.shipping_address_line || order.customer_address, order.street_address, order.building_number ? `Building ${order.building_number}` : "", order.floor_number ? `Floor ${order.floor_number}` : "", order.apartment_number ? `Apartment ${order.apartment_number}` : "", order.landmark].filter(Boolean).join(" · ");
  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm">
      <aside className="ms-auto flex h-full w-full max-w-2xl flex-col border-s border-white/10 bg-slate-950 text-white shadow-2xl">
        <header className="flex items-center justify-between border-b border-white/10 p-5">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.2em] text-emerald-300">{t("shipping.center.drawer.title")}</div>
            <h2 className="m1-section-title mt-1">{order.order_number}</h2>
          </div>
          <button onClick={onClose} className="rounded-[var(--radius-control)] border border-white/10 p-2 text-slate-300 hover:bg-white/10"><X className="h-5 w-5" /></button>
        </header>
        <div className="flex-1 overflow-auto p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              ["Customer", order.customer_name],
              ["Phone", order.customer_phone],
              ["Provider", PROVIDER_LABELS[order.shipping_provider_id] || order.shipping_provider],
              ["City", cityName || "-"],
              ["Zone", zoneName || "-"],
              ["District", districtName || "-"],
              ["Status", <StatusBadge status={order.shipment_status} />],
              ["Tracking Number", order.tracking_number || "-"],
              ["Delivery ID", order.delivery_id || "-"],
              ["Label URL", order.shipping_label_url || "-"],
              ["COD Amount", fmtMoney(order.cod_amount)],
              ["Order Total", fmtMoney(order.order_total)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-[var(--radius-card)] border border-white/10 bg-white/[0.04] p-3">
                <div className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">{label}</div>
                <div className="mt-1 break-words text-sm font-black text-slate-100">{value || "-"}</div>
              </div>
            ))}
          </div>
          <section className="mt-4 rounded-[var(--radius-card)] border border-white/10 bg-white/[0.04] p-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-black"><MapPin className="h-4 w-4 text-emerald-300" /> {t("shipping.center.drawer.address")}</div>
            <p className="text-sm font-semibold leading-6 text-slate-300">{address || "-"}</p>
            {order.shipping_label_url ? (
              <button type="button" onClick={() => window.open(order.shipping_label_url, "_blank", "noopener,noreferrer")} className="mt-3 rounded-[var(--radius-control)] border border-primary/25 bg-primary/10 px-3 py-2 text-xs font-black text-primary transition hover:bg-primary/20">{t("shipping.center.drawer.printLabel")}</button>
            ) : null}
          </section>
          <section className="mt-4 rounded-[var(--radius-card)] border border-white/10 bg-white/[0.04] p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-black"><Clock3 className="h-4 w-4 text-primary" /> {t("shipping.center.drawer.timeline")}</div>
            <div className="space-y-3">
              {timeline.length ? timeline.map((event, index) => (
                <div key={`${event.at}-${index}`} className="rounded-xl border border-white/10 bg-black/20 p-3">
                  <div className="flex flex-wrap items-center gap-2"><StatusBadge status={event.status} /><span className="text-xs font-bold text-slate-400">{fmtDate(event.at)}</span></div>
                  <div className="mt-1 text-xs font-semibold text-slate-400">{event.action || "shipment_event"}</div>
                </div>
              )) : <p className="text-sm font-bold text-slate-500">{t("shipping.center.drawer.noTimeline")}</p>}
            </div>
          </section>
          <section className="mt-4 rounded-[var(--radius-card)] border border-white/10 bg-white/[0.04] p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-black"><Layers3 className="h-4 w-4 text-violet-300" /> {t("shipping.center.drawer.webhookEvents")}</div>
            <div className="space-y-3">
              {events.length ? events.map((event) => (
                <div key={event.id} className="rounded-xl border border-white/10 bg-black/20 p-3">
                  <div className="flex flex-wrap items-center gap-2"><StatusBadge status={event.status} /><span className="text-xs font-bold text-slate-400">{fmtDate(event.created_at)}</span></div>
                  <pre className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap text-[11px] leading-5 text-slate-400">{JSON.stringify(event.payload || {}, null, 2)}</pre>
                </div>
              )) : <p className="text-sm font-bold text-slate-500">{t("shipping.center.drawer.noWebhookEvents")}</p>}
            </div>
          </section>
        </div>
      </aside>
    </div>
  );
}

function useVirtualRows(rows, rowHeight = 58, viewportHeight = 620) {
  const [scrollTop, setScrollTop] = useState(0);
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - 5);
  const visibleCount = Math.ceil(viewportHeight / rowHeight) + 10;
  const end = Math.min(rows.length, start + visibleCount);
  return { start, end, visibleRows: rows.slice(start, end), spacerTop: start * rowHeight, spacerBottom: Math.max(0, (rows.length - end) * rowHeight), onScroll: (event) => setScrollTop(event.currentTarget.scrollTop) };
}

export default function ShippingCenter() {
  const { t } = useTranslation();
  const [filters, setFilters] = useState({ provider: "", branchId: "", shippingStatus: "", paymentStatus: "", paymentType: "", dateFrom: "", dateTo: "", search: "" });
  const [view, setView] = useState("table");
  const [data, setData] = useState({ orders: [], total: 0, summary: { statuses: {}, analytics: {} }, meta: { providers: [], branches: [], statuses: [] } });
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(new Set());
  const [drawerOrder, setDrawerOrder] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { ...filters, limit: 500 };
      const response = await api.get("/shipping/center", { params });
      setData({
        orders: Array.isArray(response.orders) ? response.orders : [],
        total: response.total || 0,
        summary: response.summary || { statuses: {}, analytics: {} },
        meta: response.meta || { providers: [], branches: [], statuses: [] },
      });
    } catch (error) {
      toast.error(error.message || "Failed to load Shipping Center");
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    const timer = window.setTimeout(load, 220);
    return () => window.clearTimeout(timer);
  }, [load]);

  const orders = data.orders;
  const analytics = data.summary?.analytics || {};
  const virtual = useVirtualRows(orders);
  const selectedIds = [...selected];
  const allVisibleSelected = orders.length > 0 && orders.every((order) => selected.has(order.id));

  const setFilter = (key, value) => setFilters((current) => ({ ...current, [key]: value }));
  const toggleSelected = (id) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const toggleAll = () => setSelected(allVisibleSelected ? new Set() : new Set(orders.map((order) => order.id)));

  const runBulk = async (action) => {
    if (!selectedIds.length) return toast.error(t("shipping.center.bulk.selectFirst"));
    try {
      const result = await api.post("/shipping/center/bulk", { action, order_ids: selectedIds });
      toast.success(action === "print_labels" ? "Labels prepared" : `Action finished${result.failed ? ` with ${result.failed} failed` : ""}`);
      if (action === "print_labels") {
        const urls = (result.labels || []).map((label) => label.label_url).filter(Boolean);
        urls.forEach((url) => window.open(url, "_blank", "noopener,noreferrer"));
      }
      await load();
    } catch (error) {
      toast.error(error.message || "Bulk action failed");
    }
  };

  const exportCsv = () => {
    const headers = ["Order #", "Customer", "Phone", "City", "Shipping Provider", "Tracking Number", "Shipment Status", "COD Amount", "Order Total", "Created At", "Last Sync"];
    const lines = orders.map((order) => [
      order.order_number,
      order.customer_name,
      order.customer_phone,
      order.city,
      PROVIDER_LABELS[order.shipping_provider_id] || order.shipping_provider_id,
      order.tracking_number,
      statusLabel(order.shipment_status),
      order.cod_amount,
      order.order_total,
      order.created_at,
      order.last_sync,
    ].map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(","));
    const blob = new Blob([[headers.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `shipping-center-${Date.now()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const boardGroups = useMemo(() => Object.fromEntries(STATUSES.map((status) => [status, orders.filter((order) => order.shipment_status === status)])), [orders]);

  return (
    <main className="min-h-screen bg-[#050816] p-4 text-white md:p-6">
      <div className="mx-auto w-full space-y-5">
        <header className="flex flex-col gap-4 rounded-[var(--radius-card)] border border-white/10 bg-white/[0.04] p-5 shadow-2xl shadow-black/20 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.24em] text-emerald-300">{t("shipping.center.eyebrow")}</div>
            <h1 className="m1-page-title mt-2">{t("shipping.center.title")}</h1>
            <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-slate-400">Centralized shipment operations for Bosta and future providers with status monitoring, bulk actions, webhook timelines, and analytics.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setView("table")} className={`rounded-[var(--radius-control)] px-4 py-2 text-sm font-black ${view === "table" ? "bg-primary text-[var(--primary-contrast)]" : "border border-white/10 bg-white/5 text-slate-200"}`}>{t("shipping.center.tableView")}</button>
            <button onClick={() => setView("board")} className={`rounded-[var(--radius-control)] px-4 py-2 text-sm font-black ${view === "board" ? "bg-primary text-[var(--primary-contrast)]" : "border border-white/10 bg-white/5 text-slate-200"}`}>{t("shipping.center.boardView")}</button>
            <button onClick={load} className="inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-white/10 bg-white/5 px-4 py-2 text-sm font-black text-slate-200"><RefreshCw className="h-4 w-4" /> {t("shipping.center.refresh")}</button>
          </div>
        </header>

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-8">
          {STATUSES.map((status) => <KpiCard key={status} label={statusLabel(status)} value={data.summary?.statuses?.[status] || 0} active={filters.shippingStatus === status} onClick={() => setFilter("shippingStatus", filters.shippingStatus === status ? "" : status)} />)}
        </section>

        <section className="grid gap-3 lg:grid-cols-5">
          <div className="rounded-[var(--radius-card)] border border-white/10 bg-white/[0.04] p-4"><div className="text-xs font-black uppercase text-slate-500">{t("shipping.center.kpi.successRate")}</div><div className="mt-2 text-2xl font-black text-emerald-200">{analytics.delivery_success_rate || 0}%</div></div>
          <div className="rounded-[var(--radius-card)] border border-white/10 bg-white/[0.04] p-4"><div className="text-xs font-black uppercase text-slate-500">{t("shipping.center.kpi.returnRate")}</div><div className="mt-2 text-2xl font-black text-orange-200">{analytics.return_rate || 0}%</div></div>
          <div className="rounded-[var(--radius-card)] border border-white/10 bg-white/[0.04] p-4"><div className="text-xs font-black uppercase text-slate-500">{t("shipping.center.kpi.avgDeliveryTime")}</div><div className="mt-2 text-2xl font-black text-primary">{Number(analytics.average_delivery_hours || 0).toFixed(1)}h</div></div>
          <div className="rounded-[var(--radius-card)] border border-white/10 bg-white/[0.04] p-4"><div className="text-xs font-black uppercase text-slate-500">{t("shipping.center.kpi.perProvider")}</div><div className="mt-2 text-sm font-bold text-slate-300">{(analytics.orders_per_provider || []).map((row) => `${PROVIDER_LABELS[row.provider] || row.provider}: ${row.orders}`).join(" · ") || "-"}</div></div>
          <div className="rounded-[var(--radius-card)] border border-white/10 bg-white/[0.04] p-4"><div className="text-xs font-black uppercase text-slate-500">{t("shipping.center.kpi.perCity")}</div><div className="mt-2 text-sm font-bold text-slate-300">{(analytics.orders_per_city || []).slice(0, 3).map((row) => `${row.city}: ${row.orders}`).join(" · ") || "-"}</div></div>
        </section>

        <section className="rounded-[var(--radius-card)] border border-white/10 bg-white/[0.04] p-4 shadow-2xl shadow-black/20">
          <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
              <div className="relative md:col-span-2">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <input value={filters.search} onChange={(event) => setFilter("search", event.target.value)} placeholder={t("shipping.center.filters.search")} className="h-[var(--control-height-md)] w-full rounded-[var(--radius-control)] border border-white/10 bg-slate-950/80 pl-9 pr-3 text-sm font-bold text-white outline-none focus:border-emerald-300/50" />
              </div>
              <Select value={filters.provider} onChange={(value) => setFilter("provider", value)}><option value="">{t("shipping.center.filters.allProviders")}</option>{(data.meta?.providers || ["bosta"]).map((provider) => <option key={provider} value={provider}>{PROVIDER_LABELS[provider] || provider}</option>)}</Select>
              <Select value={filters.branchId} onChange={(value) => setFilter("branchId", value)}><option value="">{t("shipping.center.filters.allBranches")}</option>{(data.meta?.branches || []).map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</Select>
              <Select value={filters.shippingStatus} onChange={(value) => setFilter("shippingStatus", value)}><option value="">{t("shipping.center.filters.allShippingStatuses")}</option>{STATUSES.map((key) => <option key={key} value={key}>{statusLabel(key)}</option>)}</Select>
              <Select value={filters.paymentStatus} onChange={(value) => setFilter("paymentStatus", value)}><option value="">{t("shipping.center.filters.allPaymentStatuses")}</option>{["paid", "unpaid", "partially_paid", "refunded"].map((status) => <option key={status} value={status}>{status}</option>)}</Select>
              <Select value={filters.paymentType} onChange={(value) => setFilter("paymentType", value)}><option value="">{t("shipping.center.filters.codOrPrepaid")}</option><option value="cod">COD</option><option value="prepaid">{t("shipping.center.filters.prepaid")}</option></Select>
              <input type="date" value={filters.dateFrom} onChange={(event) => setFilter("dateFrom", event.target.value)} className="h-[var(--control-height-md)] rounded-[var(--radius-control)] border border-white/10 bg-slate-950/80 px-3 text-sm font-bold text-white outline-none" />
              <input type="date" value={filters.dateTo} onChange={(event) => setFilter("dateTo", event.target.value)} className="h-[var(--control-height-md)] rounded-[var(--radius-control)] border border-white/10 bg-slate-950/80 px-3 text-sm font-bold text-white outline-none" />
            </div>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => runBulk("create_shipments")} className="inline-flex items-center gap-2 rounded-[var(--radius-control)] bg-primary px-3 py-2 text-xs font-black text-[var(--primary-contrast)]"><Send className="h-4 w-4" /> {t("shipping.center.bulk.createShipments")}</button>
              <button onClick={() => runBulk("refresh_status")} className="inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-white/10 bg-white/5 px-3 py-2 text-xs font-black"><RefreshCw className="h-4 w-4" /> {t("shipping.center.bulk.refreshStatus")}</button>
              <button onClick={() => runBulk("print_labels")} className="inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-white/10 bg-white/5 px-3 py-2 text-xs font-black"><Printer className="h-4 w-4" /> {t("shipping.center.bulk.printLabels")}</button>
              <button onClick={() => runBulk("mark_ready_to_ship")} className="inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-white/10 bg-white/5 px-3 py-2 text-xs font-black"><PackageCheck className="h-4 w-4" /> {t("shipping.center.bulk.markReady")}</button>
              <button onClick={exportCsv} className="inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-white/10 bg-white/5 px-3 py-2 text-xs font-black"><Download className="h-4 w-4" /> {t("shipping.center.bulk.exportCsv")}</button>
            </div>
          </div>

          {loading ? <div className="grid h-96 place-items-center text-slate-400"><Loader2 className="h-8 w-8 animate-spin" /></div> : null}

          {!loading && view === "table" ? (
            <div className="overflow-hidden rounded-2xl border border-white/10">
              <div className="max-h-[620px] overflow-auto" onScroll={virtual.onScroll}>
                <table className="min-w-[1180px] w-full text-sm">
                  <thead className="sticky top-0 z-10 bg-slate-950 text-xs uppercase tracking-[0.14em] text-slate-500">
                    <tr>
                      <th className="w-10 px-3 py-3"><input type="checkbox" checked={allVisibleSelected} onChange={toggleAll} /></th>
                      {["Order #", "Customer", "Phone", "City", "Shipping Provider", "Tracking Number", "Shipment Status", "COD Amount", "Order Total", "Created At", "Last Sync"].map((header) => <th key={header} className="px-3 py-3 text-start font-black">{header}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {virtual.spacerTop ? <tr><td colSpan={12} style={{ height: virtual.spacerTop }} /></tr> : null}
                    {virtual.visibleRows.map((order) => (
                      <tr key={order.id} onClick={() => setDrawerOrder(order)} className="cursor-pointer border-t border-white/10 bg-white/[0.025] hover:bg-white/[0.07]">
                        <td className="px-3 py-3" onClick={(event) => event.stopPropagation()}><input type="checkbox" checked={selected.has(order.id)} onChange={() => toggleSelected(order.id)} /></td>
                        <td className="px-3 py-3 font-black text-white"><Link to={`/orders/${order.id}`} className="hover:text-emerald-300" onClick={(event) => event.stopPropagation()}>{order.order_number}</Link></td>
                        <td className="px-3 py-3 font-bold text-slate-200">{order.customer_name || "-"}</td>
                        <td className="px-3 py-3 text-slate-300">{order.customer_phone || "-"}</td>
                        <td className="px-3 py-3 text-slate-300">{order.city || "-"}</td>
                        <td className="px-3 py-3"><span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-black">{PROVIDER_LABELS[order.shipping_provider_id] || order.shipping_provider_id}</span></td>
                        <td className="px-3 py-3 font-mono text-xs text-primary">{order.tracking_number || "-"}</td>
                        <td className="px-3 py-3"><StatusBadge status={order.shipment_status} /></td>
                        <td className="px-3 py-3 font-bold text-amber-100">{fmtMoney(order.cod_amount)}</td>
                        <td className="px-3 py-3 font-bold text-slate-100">{fmtMoney(order.order_total)}</td>
                        <td className="px-3 py-3 text-xs text-slate-400">{fmtDate(order.created_at)}</td>
                        <td className="px-3 py-3 text-xs text-slate-400">{fmtDate(order.last_sync)}</td>
                      </tr>
                    ))}
                    {virtual.spacerBottom ? <tr><td colSpan={12} style={{ height: virtual.spacerBottom }} /></tr> : null}
                    {!orders.length ? <tr><td colSpan={12} className="px-4 py-16 text-center text-sm font-bold text-slate-500">{t("shipping.center.emptyRows")}</td></tr> : null}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {!loading && view === "board" ? (
            <div className="grid gap-3 overflow-x-auto pb-2 xl:grid-cols-8">
              {STATUSES.map((status) => (
                <div key={status} className="min-w-64 rounded-2xl border border-white/10 bg-slate-950/55">
                  <div className="sticky top-0 rounded-t-2xl border-b border-white/10 bg-white/[0.04] p-3"><div className="flex items-center justify-between gap-2"><span className="text-sm font-black">{statusLabel(status)}</span><span className="rounded-full bg-white/10 px-2 py-1 text-xs font-black">{boardGroups[status]?.length || 0}</span></div></div>
                  <div className="max-h-[620px] space-y-2 overflow-auto p-2">
                    {(boardGroups[status] || []).map((order) => (
                      <button key={order.id} onClick={() => setDrawerOrder(order)} className="w-full rounded-[var(--radius-control)] border border-white/10 bg-white/[0.04] p-3 text-start hover:bg-white/[0.08]">
                        <div className="flex items-start justify-between gap-2"><span className="font-black text-white">{order.order_number}</span><ExternalLink className="h-4 w-4 text-slate-500" /></div>
                        <div className="mt-1 text-sm font-bold text-slate-300">{order.customer_name || "-"}</div>
                        <div className="mt-2 flex items-center justify-between text-xs font-bold text-slate-500"><span>{PROVIDER_LABELS[order.shipping_provider_id] || order.shipping_provider_id}</span><span>{fmtMoney(order.cod_amount)}</span></div>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </section>
      </div>
      <ShipmentDrawer order={drawerOrder} onClose={() => setDrawerOrder(null)} />
    </main>
  );
}
