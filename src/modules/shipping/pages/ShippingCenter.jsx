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
  Landmark,
  Layers3,
  Loader2,
  MapPin,
  PackageCheck,
  PanelRightClose,
  Printer,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  Settings,
  Truck,
  X,
} from "lucide-react";
import toast from "react-hot-toast";

import { api } from "../../../shared/api/api";
/*
 * The same module the WhatsApp sender uses. The preview below therefore renders through
 * the exact code that builds the real message — a preview with its own rules is a
 * preview that lies, and these messages go to customers.
 */
import {
  renderShipmentTemplate,
  SHIPMENT_NOTIFICATION_DEFAULTS,
  SHIPMENT_NOTIFICATION_LABELS,
  SHIPMENT_NOTIFICATION_TRIGGERS,
  SHIPMENT_NOTIFICATION_TYPES,
  SHIPMENT_TEMPLATE_PLACEHOLDERS,
} from "../../../../shared/shipmentNotificationTemplates";

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

/*
 * Status colour comes from the theme tokens, not from raw Tailwind palette classes.
 * The page carried sky/indigo/cyan/blue tints that the shell normaliser only partly
 * caught, so half these badges stayed the legacy blue in both themes. Eight statuses
 * over six token families need a second axis to stay tellable apart: the progression
 * is OUTLINE then FILL as a shipment advances inside the same family.
 */
const STATUS_META = {
  ready_to_ship: "border-[var(--border-strong)] bg-[var(--surface-soft)] text-[var(--text-secondary)]",
  shipment_created: "border-[color-mix(in_srgb,var(--info)_38%,var(--border))] bg-[var(--surface-soft)] text-[var(--info)]",
  picked_up: "border-[color-mix(in_srgb,var(--info)_38%,var(--border))] bg-[var(--info-soft)] text-[var(--info)]",
  in_transit: "border-[color-mix(in_srgb,var(--primary)_38%,var(--border))] bg-[var(--primary-soft)] text-[var(--primary)]",
  out_for_delivery: "border-[color-mix(in_srgb,var(--warning)_38%,var(--border))] bg-[var(--warning-soft)] text-[var(--warning)]",
  delivered: "border-[color-mix(in_srgb,var(--success)_38%,var(--border))] bg-[var(--success-soft)] text-[var(--success)]",
  returned: "border-[color-mix(in_srgb,var(--danger)_38%,var(--border))] bg-[var(--surface-soft)] text-[var(--danger)]",
  failed_delivery: "border-[color-mix(in_srgb,var(--danger)_38%,var(--border))] bg-[var(--danger-soft)] text-[var(--danger)]",
};

const PROVIDER_LABELS = {
  bosta: "Bosta",
  mylerz: "Mylerz",
  shipblu: "ShipBlu",
  aramex: "Aramex",
  get in_store_delivery() { return tt("shipping.center.providers.inStoreDelivery"); },
};

// A label arrives as one base64 PDF that Bosta already merged, so it becomes a single
// blob the browser can show or save. atob gives latin1 chars, hence the byte copy.
const pdfUrlFromBase64 = (base64) => {
  const binary = window.atob(String(base64 || ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
};

const downloadPdf = (url) => {
  const link = document.createElement("a");
  link.href = url;
  link.download = `bosta-labels-${new Date().toISOString().slice(0, 10)}.pdf`;
  document.body.appendChild(link);
  link.click();
  link.remove();
};

/* Literal keys keep these verifiable by the missing-key guard. */
const SKIP_REASON_KEY = {
  shipment_not_created: "shipping.center.bulk.printReason.shipment_not_created",
  provider_unsupported: "shipping.center.bulk.printReason.provider_unsupported",
  order_not_found: "shipping.center.bulk.printReason.order_not_found",
};

const fmtMoney = (value) => `${Number(value || 0).toLocaleString()} EGP`;
// The `cod_amount` column is 0 on every order that did not come from the website,
// so reading it straight showed "0 EGP" next to shipments the courier does collect
// on. The backend now sends the figure the create call would actually use.
const codOf = (order = {}) => (order.collectible_amount === undefined || order.collectible_amount === null ? order.cod_amount : order.collectible_amount);
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
  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-black ${STATUS_META[status] || "border-[var(--border)] bg-[var(--card)] text-[var(--text)]"}`}>{statusLabel(status)}</span>;
}

function KpiCard({ label, value, active, onClick }) {
  return (
    <button type="button" onClick={onClick} className={`rounded-[var(--radius-control)] border p-4 text-start transition ${active ? "border-emerald-300/50 bg-emerald-400/12" : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--border-strong)] hover:bg-[var(--table-hover)]"}`}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-black uppercase tracking-[0.16em] text-[var(--muted)]">{label}</span>
        <Truck className="h-4 w-4 text-emerald-300" />
      </div>
      <div className="mt-3 text-3xl font-black text-[var(--text)]">{Number(value || 0).toLocaleString()}</div>
    </button>
  );
}

function Select({ value, onChange, children }) {
  return <select value={value} onChange={(event) => onChange(event.target.value)} className="h-[var(--control-height-md)] rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--card)] px-3 text-sm font-bold text-[var(--text)] outline-none focus:border-emerald-300/50">{children}</select>;
}

function ShipmentDrawer({ order, onClose, onPrintLabel }) {
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
      <aside className="ms-auto flex h-full w-full max-w-2xl flex-col border-s border-[var(--border)] bg-[var(--surface)] text-[var(--text)] shadow-2xl">
        <header className="flex items-center justify-between border-b border-[var(--border)] p-5">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.2em] text-emerald-300">{t("shipping.center.drawer.title")}</div>
            <h2 className="m1-section-title mt-1">{order.order_number}</h2>
          </div>
          <button onClick={onClose} className="rounded-[var(--radius-control)] border border-[var(--border)] p-2 text-[var(--text-secondary)] hover:bg-[var(--table-hover)]"><X className="h-5 w-5" /></button>
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
              ["COD Amount", fmtMoney(codOf(order))],
              ["Order Total", fmtMoney(order.order_total)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card-soft)] p-3">
                <div className="text-[11px] font-black uppercase tracking-[0.16em] text-[var(--text-tertiary)]">{label}</div>
                <div className="mt-1 break-words text-sm font-black text-[var(--text)]">{value || "-"}</div>
              </div>
            ))}
          </div>
          <section className="mt-4 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card-soft)] p-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-black"><MapPin className="h-4 w-4 text-emerald-300" /> {t("shipping.center.drawer.address")}</div>
            <p className="text-sm font-semibold leading-6 text-[var(--text-secondary)]">{address || "-"}</p>
            {order.delivery_id || order.shipping_provider_delivery_id ? (
              <button type="button" onClick={() => onPrintLabel?.(order.id)} className="mt-3 rounded-[var(--radius-control)] border border-primary/25 bg-primary/10 px-3 py-2 text-xs font-black text-primary transition hover:bg-primary/20">{t("shipping.center.drawer.printLabel")}</button>
            ) : null}
          </section>
          <section className="mt-4 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card-soft)] p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-black"><Clock3 className="h-4 w-4 text-primary" /> {t("shipping.center.drawer.timeline")}</div>
            <div className="space-y-3">
              {timeline.length ? timeline.map((event, index) => (
                <div key={`${event.at}-${index}`} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
                  <div className="flex flex-wrap items-center gap-2"><StatusBadge status={event.status} /><span className="text-xs font-bold text-[var(--muted)]">{fmtDate(event.at)}</span></div>
                  <div className="mt-1 text-xs font-semibold text-[var(--muted)]">{event.action || "shipment_event"}</div>
                </div>
              )) : <p className="text-sm font-bold text-[var(--text-tertiary)]">{t("shipping.center.drawer.noTimeline")}</p>}
            </div>
          </section>
          <section className="mt-4 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card-soft)] p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-black"><Layers3 className="h-4 w-4 text-[var(--muted)]" /> {t("shipping.center.drawer.webhookEvents")}</div>
            <div className="space-y-3">
              {events.length ? events.map((event) => (
                <div key={event.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
                  <div className="flex flex-wrap items-center gap-2"><StatusBadge status={event.status} /><span className="text-xs font-bold text-[var(--muted)]">{fmtDate(event.created_at)}</span></div>
                  <pre className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap text-[11px] leading-5 text-[var(--muted)]">{JSON.stringify(event.payload || {}, null, 2)}</pre>
                </div>
              )) : <p className="text-sm font-bold text-[var(--text-tertiary)]">{t("shipping.center.drawer.noWebhookEvents")}</p>}
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

/*
 * The four WhatsApp messages a customer receives, editable in place. Each one carries
 * its own on/off switch and its own once-per-order guard on the server, so turning one
 * off silences it without affecting the others.
 */
function NotificationSettingsModal({ open, onClose }) {
  const { t, i18n: instance } = useTranslation();
  const lang = String(instance?.language || "ar").startsWith("ar") ? "ar" : "en";
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    api.get("/shipping/notifications")
      .then((data) => {
        if (!cancelled) setConfig(data?.notifications || SHIPMENT_NOTIFICATION_DEFAULTS);
      })
      .catch((error) => {
        if (cancelled) return;
        toast.error(error.message || t("shipping.center.notifications.loadFailed"));
        setConfig(SHIPMENT_NOTIFICATION_DEFAULTS);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, t]);

  const patch = (type, changes) => setConfig((current) => ({ ...current, [type]: { ...current[type], ...changes } }));

  const save = async () => {
    try {
      setSaving(true);
      const data = await api.put("/shipping/notifications", { notifications: config });
      setConfig(data?.notifications || config);
      toast.success(t("shipping.center.notifications.saved"));
      onClose();
    } catch (error) {
      toast.error(error.message || t("shipping.center.notifications.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  /* A real order's shape, so the preview shows what a customer actually gets. */
  const previewValues = {
    order_number: "INV-539",
    customer_name: t("shipping.center.notifications.sampleCustomer"),
    provider: "Bosta",
    tracking_number: "8844678114",
    tracking_url: "",
    cod_amount: "1,895 ج.م",
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="my-6 w-full max-w-4xl rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <header className="flex items-start justify-between gap-4 border-b border-[var(--border)] p-5">
          <div>
            <h2 className="text-lg font-black">{t("shipping.center.notifications.title")}</h2>
            <p className="mt-1 max-w-2xl text-xs font-semibold leading-5 text-[var(--muted)]">{t("shipping.center.notifications.subtitle")}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full border border-[var(--border)] bg-[var(--card)] p-2 text-[var(--text-secondary)] hover:bg-[var(--table-hover)]"><X className="h-4 w-4" /></button>
        </header>

        <div className="space-y-3 border-b border-[var(--border)] p-5">
          <div className="text-xs font-black uppercase tracking-[0.16em] text-[var(--muted)]">{t("shipping.center.notifications.placeholders")}</div>
          <div className="flex flex-wrap gap-2">
            {SHIPMENT_TEMPLATE_PLACEHOLDERS.map((placeholder) => (
              <span key={placeholder.token} className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1 text-xs font-bold text-emerald-100">
                <code>{`{{${placeholder.token}}}`}</code>
                <span className="ms-2 text-emerald-200/70">{placeholder[lang]}</span>
              </span>
            ))}
          </div>
          <p className="text-xs font-semibold leading-5 text-amber-200/80">{t("shipping.center.notifications.emptyLineRule")}</p>
        </div>

        {loading || !config ? (
          <div className="flex items-center justify-center gap-2 p-10 text-sm font-bold text-[var(--muted)]"><Loader2 className="h-4 w-4 animate-spin" /> {t("shipping.center.notifications.loading")}</div>
        ) : (
          <div className="space-y-4 p-5">
            {SHIPMENT_NOTIFICATION_TYPES.map((type) => {
              const entry = config[type] || SHIPMENT_NOTIFICATION_DEFAULTS[type];
              const preview = renderShipmentTemplate(entry.template, previewValues);
              return (
                <section key={type} className={`rounded-[var(--radius-control)] border p-4 transition ${entry.enabled ? "border-[var(--border)] bg-[var(--card)]" : "border-[var(--border)] bg-[var(--surface-soft)] opacity-70"}`}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-black text-[var(--text)]">{SHIPMENT_NOTIFICATION_LABELS[type][lang]}</h3>
                      <p className="mt-1 text-xs font-semibold text-[var(--muted)]">{SHIPMENT_NOTIFICATION_TRIGGERS[type][lang]}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => patch(type, { template: SHIPMENT_NOTIFICATION_DEFAULTS[type].template })}
                        className="inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--card)] px-2.5 py-1.5 text-[11px] font-black text-[var(--text-secondary)] hover:bg-[var(--table-hover)]"
                      >
                        <RotateCcw className="h-3.5 w-3.5" /> {t("shipping.center.notifications.reset")}
                      </button>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={entry.enabled}
                        onClick={() => patch(type, { enabled: !entry.enabled })}
                        className={`rounded-full px-3 py-1.5 text-xs font-black ${entry.enabled ? "bg-emerald-400/20 text-emerald-100" : "bg-[var(--surface-soft)] text-[var(--text-secondary)]"}`}
                      >
                        {entry.enabled ? t("shipping.center.notifications.on") : t("shipping.center.notifications.off")}
                      </button>
                    </div>
                  </div>

                  <div className="mt-3 grid gap-3 lg:grid-cols-2">
                    <textarea
                      value={entry.template}
                      onChange={(event) => patch(type, { template: event.target.value })}
                      disabled={!entry.enabled}
                      rows={8}
                      dir="auto"
                      className="w-full rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--card)] p-3 text-sm font-semibold leading-6 text-[var(--text)] outline-none focus:border-emerald-300/50 disabled:opacity-50"
                    />
                    <div className="rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--bg)] p-3">
                      <div className="text-[11px] font-black uppercase tracking-[0.16em] text-[var(--text-tertiary)]">{t("shipping.center.notifications.preview")}</div>
                      <pre dir="auto" className="mt-2 whitespace-pre-wrap break-words font-sans text-sm leading-6 text-[var(--text)]">{preview || t("shipping.center.notifications.previewEmpty")}</pre>
                    </div>
                  </div>
                </section>
              );
            })}
          </div>
        )}

        <footer className="flex items-center justify-end gap-2 border-t border-[var(--border)] p-5">
          <button type="button" onClick={onClose} className="rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--card)] px-4 py-2 text-sm font-black text-[var(--text)]">{t("shipping.center.notifications.cancel")}</button>
          <button type="button" onClick={save} disabled={saving || loading || !config} className="inline-flex items-center gap-2 rounded-[var(--radius-control)] bg-primary px-4 py-2 text-sm font-black text-[var(--primary-contrast)] disabled:opacity-60">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {t("shipping.center.notifications.save")}
          </button>
        </footer>
      </div>
    </div>
  );
}

export default function ShippingCenter() {
  const { t } = useTranslation();
  const [filters, setFilters] = useState({ provider: "", branchId: "", shippingStatus: "", paymentStatus: "", paymentType: "", dateFrom: "", dateTo: "", search: "" });
  const [view, setView] = useState("table");
  const [settingsOpen, setSettingsOpen] = useState(false);
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
      /*
       * A per-order failure came back inside a 200, and this used to render it as a
       * green "Action finished with 3 failed" with the reason nowhere on screen. That
       * is how three orders got shipped twice without anyone seeing a word about it.
       */
      const failures = (result.results || []).filter((row) => !row.success);
      if (failures.length) {
        const reasons = [...new Set(failures.map((row) => row.message).filter(Boolean))];
        toast.error(
          `${t("shipping.center.bulk.failedCount", { count: failures.length })}${reasons.length ? `\n${reasons.join("\n")}` : ""}`,
          { duration: 10000 }
        );
      } else {
        toast.success(t("shipping.center.bulk.done"));
      }
      await load();
    } catch (error) {
      toast.error(error.message || "Bulk action failed");
    }
  };

  const printLabels = async (orderIds = selectedIds) => {
    if (!orderIds.length) return toast.error(t("shipping.center.bulk.selectFirst"));
    /*
     * The tab is claimed inside the click, before any await. Opening it after the
     * round trip is a popup with no user gesture behind it, which is exactly what
     * the blocker eats — and the old code opened one per label on top of that.
     */
    const printWindow = window.open("", "_blank");
    const toastId = toast.loading(t("shipping.center.bulk.printPreparing"));
    try {
      const result = await api.post("/shipping/center/bulk", { action: "print_labels", order_ids: orderIds });
      // A blank tab reads as "printing is broken" all over again, so a response with
      // no PDF in it has to surface as an error rather than as an empty document.
      if (!result?.pdf_base64) throw new Error(t("shipping.center.bulk.printFailed"));
      const url = pdfUrlFromBase64(result.pdf_base64);
      if (printWindow && !printWindow.closed) printWindow.location.href = url;
      else downloadPdf(url);
      window.setTimeout(() => URL.revokeObjectURL(url), 120000);

      const printed = Array.isArray(result?.printed) ? result.printed : [];
      toast.success(t("shipping.center.bulk.printReady", { count: printed.length || orderIds.length }), { id: toastId });
      if (!printWindow || printWindow.closed) toast(t("shipping.center.bulk.printPopupBlocked"));

      const skipped = Array.isArray(result?.skipped) ? result.skipped : [];
      if (skipped.length) {
        const listed = skipped
          .slice(0, 5)
          .map((row) => `${row.order_number || row.order_id} (${SKIP_REASON_KEY[row.reason] ? t(SKIP_REASON_KEY[row.reason]) : row.reason})`)
          .join("، ");
        toast.error(t("shipping.center.bulk.printSkipped", { count: skipped.length, orders: listed }));
      }
    } catch (error) {
      if (printWindow && !printWindow.closed) printWindow.close();
      toast.error(error.message || t("shipping.center.bulk.printFailed"), { id: toastId });
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
      codOf(order),
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
    <main className="min-h-screen bg-[var(--bg)] p-4 text-[var(--text)] md:p-6">
      <div className="mx-auto w-full space-y-5">
        <header className="flex flex-col gap-4 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-2xl shadow-[var(--shadow)] lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.24em] text-emerald-300">{t("shipping.center.eyebrow")}</div>
            <h1 className="m1-page-title mt-2">{t("shipping.center.title")}</h1>
            <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-[var(--muted)]">Centralized shipment operations for Bosta and future providers with status monitoring, bulk actions, webhook timelines, and analytics.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setView("table")} className={`rounded-[var(--radius-control)] px-4 py-2 text-sm font-black ${view === "table" ? "bg-primary text-[var(--primary-contrast)]" : "border border-[var(--border)] bg-[var(--card)] text-[var(--text)]"}`}>{t("shipping.center.tableView")}</button>
            <button onClick={() => setView("board")} className={`rounded-[var(--radius-control)] px-4 py-2 text-sm font-black ${view === "board" ? "bg-primary text-[var(--primary-contrast)]" : "border border-[var(--border)] bg-[var(--card)] text-[var(--text)]"}`}>{t("shipping.center.boardView")}</button>
            <button onClick={load} className="inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--card)] px-4 py-2 text-sm font-black text-[var(--text)]"><RefreshCw className="h-4 w-4" /> {t("shipping.center.refresh")}</button>
            <Link to="/operations/shipping/settlements" className="inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-emerald-300/40 bg-emerald-400/10 px-4 py-2 text-sm font-black text-emerald-100 hover:bg-emerald-400/20"><Landmark className="h-4 w-4" /> {t("shipping.settlements.title")}</Link>
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              title={t("shipping.center.notifications.title")}
              aria-label={t("shipping.center.notifications.title")}
              className="inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--card)] px-4 py-2 text-sm font-black text-[var(--text)] hover:border-[var(--border-strong)] hover:bg-[var(--table-hover)]"
            >
              <Settings className="h-4 w-4" /> {t("shipping.center.settings")}
            </button>
          </div>
        </header>

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-8">
          {STATUSES.map((status) => <KpiCard key={status} label={statusLabel(status)} value={data.summary?.statuses?.[status] || 0} active={filters.shippingStatus === status} onClick={() => setFilter("shippingStatus", filters.shippingStatus === status ? "" : status)} />)}
        </section>

        <section className="grid gap-3 lg:grid-cols-5">
          <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4"><div className="text-xs font-black uppercase text-[var(--text-tertiary)]">{t("shipping.center.kpi.successRate")}</div><div className="mt-2 text-2xl font-black text-emerald-200">{analytics.delivery_success_rate || 0}%</div></div>
          <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4"><div className="text-xs font-black uppercase text-[var(--text-tertiary)]">{t("shipping.center.kpi.returnRate")}</div><div className="mt-2 text-2xl font-black text-orange-200">{analytics.return_rate || 0}%</div></div>
          <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4"><div className="text-xs font-black uppercase text-[var(--text-tertiary)]">{t("shipping.center.kpi.avgDeliveryTime")}</div><div className="mt-2 text-2xl font-black text-primary">{Number(analytics.average_delivery_hours || 0).toFixed(1)}h</div></div>
          <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4"><div className="text-xs font-black uppercase text-[var(--text-tertiary)]">{t("shipping.center.kpi.perProvider")}</div><div className="mt-2 text-sm font-bold text-[var(--text-secondary)]">{(analytics.orders_per_provider || []).map((row) => `${PROVIDER_LABELS[row.provider] || row.provider}: ${row.orders}`).join(" · ") || "-"}</div></div>
          <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4"><div className="text-xs font-black uppercase text-[var(--text-tertiary)]">{t("shipping.center.kpi.perCity")}</div><div className="mt-2 text-sm font-bold text-[var(--text-secondary)]">{(analytics.orders_per_city || []).slice(0, 3).map((row) => `${row.city}: ${row.orders}`).join(" · ") || "-"}</div></div>
        </section>

        <section className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-2xl shadow-[var(--shadow)]">
          <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
              <div className="relative md:col-span-2">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-tertiary)]" />
                <input value={filters.search} onChange={(event) => setFilter("search", event.target.value)} placeholder={t("shipping.center.filters.search")} className="h-[var(--control-height-md)] w-full rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--card)] pl-9 pr-3 text-sm font-bold text-[var(--text)] outline-none focus:border-emerald-300/50" />
              </div>
              <Select value={filters.provider} onChange={(value) => setFilter("provider", value)}><option value="">{t("shipping.center.filters.allProviders")}</option>{(data.meta?.providers || ["bosta"]).map((provider) => <option key={provider} value={provider}>{PROVIDER_LABELS[provider] || provider}</option>)}</Select>
              <Select value={filters.branchId} onChange={(value) => setFilter("branchId", value)}><option value="">{t("shipping.center.filters.allBranches")}</option>{(data.meta?.branches || []).map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</Select>
              <Select value={filters.shippingStatus} onChange={(value) => setFilter("shippingStatus", value)}><option value="">{t("shipping.center.filters.allShippingStatuses")}</option>{STATUSES.map((key) => <option key={key} value={key}>{statusLabel(key)}</option>)}</Select>
              <Select value={filters.paymentStatus} onChange={(value) => setFilter("paymentStatus", value)}><option value="">{t("shipping.center.filters.allPaymentStatuses")}</option>{["paid", "unpaid", "partially_paid", "refunded"].map((status) => <option key={status} value={status}>{status}</option>)}</Select>
              <Select value={filters.paymentType} onChange={(value) => setFilter("paymentType", value)}><option value="">{t("shipping.center.filters.codOrPrepaid")}</option><option value="cod">COD</option><option value="prepaid">{t("shipping.center.filters.prepaid")}</option></Select>
              <input type="date" value={filters.dateFrom} onChange={(event) => setFilter("dateFrom", event.target.value)} className="h-[var(--control-height-md)] rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--card)] px-3 text-sm font-bold text-[var(--text)] outline-none" />
              <input type="date" value={filters.dateTo} onChange={(event) => setFilter("dateTo", event.target.value)} className="h-[var(--control-height-md)] rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--card)] px-3 text-sm font-bold text-[var(--text)] outline-none" />
            </div>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => runBulk("create_shipments")} className="inline-flex items-center gap-2 rounded-[var(--radius-control)] bg-primary px-3 py-2 text-xs font-black text-[var(--primary-contrast)]"><Send className="h-4 w-4" /> {t("shipping.center.bulk.createShipments")}</button>
              <button onClick={() => runBulk("refresh_status")} className="inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-xs font-black"><RefreshCw className="h-4 w-4" /> {t("shipping.center.bulk.refreshStatus")}</button>
              <button onClick={() => printLabels()} className="inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-xs font-black"><Printer className="h-4 w-4" /> {t("shipping.center.bulk.printLabels")}</button>
              <button onClick={() => runBulk("mark_ready_to_ship")} className="inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-xs font-black"><PackageCheck className="h-4 w-4" /> {t("shipping.center.bulk.markReady")}</button>
              <button onClick={exportCsv} className="inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-xs font-black"><Download className="h-4 w-4" /> {t("shipping.center.bulk.exportCsv")}</button>
            </div>
          </div>

          {loading ? <div className="grid h-96 place-items-center text-[var(--muted)]"><Loader2 className="h-8 w-8 animate-spin" /></div> : null}

          {!loading && view === "table" ? (
            <div className="overflow-hidden rounded-2xl border border-[var(--border)]">
              <div className="max-h-[620px] overflow-auto" onScroll={virtual.onScroll}>
                <table className="min-w-[1180px] w-full text-sm">
                  <thead className="sticky top-0 z-10 bg-[var(--table-head)] text-xs uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
                    <tr>
                      <th className="w-10 px-3 py-3"><input type="checkbox" checked={allVisibleSelected} onChange={toggleAll} /></th>
                      {["Order #", "Customer", "Phone", "City", "Shipping Provider", "Tracking Number", "Shipment Status", "COD Amount", "Order Total", "Created At", "Last Sync"].map((header) => <th key={header} className="px-3 py-3 text-start font-black">{header}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {virtual.spacerTop ? <tr><td colSpan={12} style={{ height: virtual.spacerTop }} /></tr> : null}
                    {virtual.visibleRows.map((order) => (
                      <tr key={order.id} onClick={() => setDrawerOrder(order)} className="cursor-pointer border-t border-[var(--border)] bg-transparent hover:bg-[var(--table-hover)]">
                        <td className="px-3 py-3" onClick={(event) => event.stopPropagation()}><input type="checkbox" checked={selected.has(order.id)} onChange={() => toggleSelected(order.id)} /></td>
                        <td className="px-3 py-3 font-black text-[var(--text)]"><Link to={`/orders/${order.id}`} className="hover:text-emerald-300" onClick={(event) => event.stopPropagation()}>{order.order_number}</Link></td>
                        <td className="px-3 py-3 font-bold text-[var(--text)]">{order.customer_name || "-"}</td>
                        <td className="px-3 py-3 text-[var(--text-secondary)]">{order.customer_phone || "-"}</td>
                        <td className="px-3 py-3 text-[var(--text-secondary)]">{order.city || "-"}</td>
                        <td className="px-3 py-3"><span className="rounded-full border border-[var(--border)] bg-[var(--card)] px-2.5 py-1 text-xs font-black">{PROVIDER_LABELS[order.shipping_provider_id] || order.shipping_provider_id}</span></td>
                        <td className="px-3 py-3 font-mono text-xs text-primary">{order.tracking_number || "-"}</td>
                        <td className="px-3 py-3"><StatusBadge status={order.shipment_status} /></td>
                        <td className="px-3 py-3 font-bold text-amber-100">{fmtMoney(codOf(order))}</td>
                        <td className="px-3 py-3 font-bold text-[var(--text)]">{fmtMoney(order.order_total)}</td>
                        <td className="px-3 py-3 text-xs text-[var(--muted)]">{fmtDate(order.created_at)}</td>
                        <td className="px-3 py-3 text-xs text-[var(--muted)]">{fmtDate(order.last_sync)}</td>
                      </tr>
                    ))}
                    {virtual.spacerBottom ? <tr><td colSpan={12} style={{ height: virtual.spacerBottom }} /></tr> : null}
                    {!orders.length ? <tr><td colSpan={12} className="px-4 py-16 text-center text-sm font-bold text-[var(--text-tertiary)]">{t("shipping.center.emptyRows")}</td></tr> : null}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {!loading && view === "board" ? (
            <div className="grid grid-flow-col auto-cols-[minmax(15rem,1fr)] gap-3 overflow-x-auto pb-2">
              {STATUSES.map((status) => (
                <div key={status} className="rounded-2xl border border-[var(--border)] bg-[var(--card-soft)]">
                  <div className="sticky top-0 rounded-t-2xl border-b border-[var(--border)] bg-[var(--surface)] p-3"><div className="flex items-center justify-between gap-2"><span className="text-sm font-black">{statusLabel(status)}</span><span className="rounded-full bg-[var(--surface-soft)] px-2 py-1 text-xs font-black">{boardGroups[status]?.length || 0}</span></div></div>
                  <div className="max-h-[620px] space-y-2 overflow-auto p-2">
                    {(boardGroups[status] || []).map((order) => (
                      <button key={order.id} onClick={() => setDrawerOrder(order)} className="w-full rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] p-3 text-start hover:bg-[var(--table-hover)]">
                        <div className="flex items-start justify-between gap-2"><span className="font-black text-[var(--text)]">{order.order_number}</span><ExternalLink className="h-4 w-4 text-[var(--text-tertiary)]" /></div>
                        <div className="mt-1 text-sm font-bold text-[var(--text-secondary)]">{order.customer_name || "-"}</div>
                        <div className="mt-2 flex items-center justify-between gap-2 text-xs font-bold text-[var(--text-tertiary)]"><span className="truncate">{PROVIDER_LABELS[order.shipping_provider_id] || order.shipping_provider_id}</span><span className="shrink-0">{fmtMoney(codOf(order))}</span></div>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </section>
      </div>
      <ShipmentDrawer order={drawerOrder} onClose={() => setDrawerOrder(null)} onPrintLabel={(id) => printLabels([id])} />
      <NotificationSettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </main>
  );
}
