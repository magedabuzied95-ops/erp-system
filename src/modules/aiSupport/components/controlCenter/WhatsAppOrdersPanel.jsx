// WhatsApp catalogue orders — inbox top bar → WhatsApp → Orders.
//
// Every cart a customer sends from the WhatsApp catalogue (an "order" message on the Cloud
// webhook) lands here as "new". Nothing turns one into an ERP order on its own: the team opens the
// conversation, builds the real order there, and marks the cart converted — or cancelled.
// Server: server/routes/whatsappCommerce.js.

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Ban, CheckCircle2, Image as ImageIcon, MessageCircle, RotateCcw } from "lucide-react";

import { api } from "../../../../shared/api/api";
import { ActionButton, PanelSkeleton, clean, formatDateTime } from "../integrations/integrationsUi.jsx";

const SUPPRESSED = { suppressErrorStatuses: [400, 403, 404, 409, 500, 502, 504] };
const PAGE_SIZE = 50;
const STATUSES = ["new", "converted", "cancelled"];

const STATUS_TONE = {
  new: "border-cyan-300/25 bg-cyan-400/10 text-cyan-100",
  converted: "border-emerald-300/25 bg-emerald-400/10 text-emerald-100",
  cancelled: "border-rose-300/25 bg-rose-400/10 text-rose-100",
};
const statusLabel = (t, status) => {
  if (status === "converted") return t("aiSupport.waCommerce.orders.status.converted");
  if (status === "cancelled") return t("aiSupport.waCommerce.orders.status.cancelled");
  return t("aiSupport.waCommerce.orders.status.new");
};

const formatMoney = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  return number.toLocaleString(undefined, { maximumFractionDigits: 2 });
};

// AiInbox reads ?conversation= (+ &channel=) and matches it against the thread's customer id.
const conversationHref = (order) => {
  const params = new URLSearchParams({ conversation: clean(order.customer_phone), channel: "whatsapp" });
  return `/admin/ai-inbox?${params.toString()}`;
};

function StatusBadge({ status }) {
  const { t } = useTranslation();
  return (
    <span className={`inline-flex h-6 items-center rounded-full border px-2.5 text-[10.5px] font-black ${STATUS_TONE[status] || STATUS_TONE.new}`}>
      {statusLabel(t, status)}
    </span>
  );
}

export default function WhatsAppOrdersPanel({ headers }) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState([]);
  const [counts, setCounts] = useState({});
  const [hasMore, setHasMore] = useState(false);
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [detail, setDetail] = useState(null);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState(null);
  const mountedRef = useRef(true);

  useEffect(() => () => { mountedRef.current = false; }, []);

  const load = useCallback(async ({ append = false, offset = 0 } = {}) => {
    try {
      const params = { limit: PAGE_SIZE, offset };
      if (filter !== "all") params.status = filter;
      if (search) params.search = search;
      const payload = await api.get("/whatsapp/commerce/orders", { headers, params, ...SUPPRESSED });
      if (!mountedRef.current) return;
      const list = Array.isArray(payload?.orders) ? payload.orders : [];
      setOrders((current) => (append ? [...current, ...list] : list));
      setCounts(payload?.counts || {});
      setHasMore(list.length === PAGE_SIZE);
    } catch (error) {
      if (mountedRef.current) setNotice({ ok: false, text: error?.message || t("aiSupport.waCommerce.orders.loadFailed") });
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [filter, headers, search, t]);

  useEffect(() => { void load(); }, [load]);

  const open = async (order) => {
    setNotice(null);
    setDetail(order);
    setBusy("detail");
    try {
      const payload = await api.get(`/whatsapp/commerce/orders/${order.id}`, { headers, ...SUPPRESSED });
      if (mountedRef.current && payload?.order) setDetail(payload.order);
    } catch (error) {
      if (mountedRef.current) setNotice({ ok: false, text: error?.message || t("aiSupport.waCommerce.orders.loadFailed") });
    } finally {
      if (mountedRef.current) setBusy("");
    }
  };

  const setStatus = async (status) => {
    if (!detail) return;
    setBusy(status);
    setNotice(null);
    try {
      const payload = await api.patch(`/whatsapp/commerce/orders/${detail.id}`, { status }, { headers, ...SUPPRESSED });
      if (!mountedRef.current) return;
      if (payload?.order) setDetail(payload.order);
      setNotice({ ok: true, text: t("aiSupport.waCommerce.orders.statusSaved") });
      void load();
    } catch (error) {
      if (mountedRef.current) setNotice({ ok: false, text: error?.message || t("aiSupport.waCommerce.orders.actionFailed") });
    } finally {
      if (mountedRef.current) setBusy("");
    }
  };

  if (loading) return <PanelSkeleton rows={3} />;

  const noticeBox = notice ? (
    <p dir="auto" className={`rounded-xl border p-2.5 text-xs font-bold ${notice.ok ? "border-emerald-300/20 bg-emerald-400/10 text-emerald-100" : "border-rose-300/20 bg-rose-400/10 text-rose-100"}`}>{notice.text}</p>
  ) : null;

  if (detail) {
    const items = Array.isArray(detail.items) ? detail.items : [];
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <button type="button" onClick={() => { setDetail(null); setNotice(null); }} className="text-xs font-black text-cyan-200 hover:underline">{t("aiSupport.waCommerce.orders.backToList")}</button>
            <span className="text-slate-600">/</span>
            <span dir="auto" className="truncate text-sm font-black text-white">{detail.customer_name || detail.customer_phone}</span>
            <StatusBadge status={detail.status} />
          </div>
          <div className="flex flex-wrap gap-2">
            <a
              href={conversationHref(detail)}
              className="inline-flex h-9 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.05] px-3 text-xs font-black text-slate-100 transition hover:bg-white/10"
            >
              <MessageCircle className="h-3.5 w-3.5" aria-hidden="true" />
              {t("aiSupport.waCommerce.orders.openConversation")}
            </a>
            {detail.status !== "converted" ? (
              <ActionButton tone="emerald" icon={CheckCircle2} loading={busy === "converted"} disabled={Boolean(busy)} onClick={() => setStatus("converted")}>
                {t("aiSupport.waCommerce.orders.markConverted")}
              </ActionButton>
            ) : null}
            {detail.status !== "cancelled" ? (
              <ActionButton tone="rose" icon={Ban} loading={busy === "cancelled"} disabled={Boolean(busy)} onClick={() => setStatus("cancelled")}>
                {t("aiSupport.waCommerce.orders.markCancelled")}
              </ActionButton>
            ) : null}
            {detail.status !== "new" ? (
              <ActionButton icon={RotateCcw} loading={busy === "new"} disabled={Boolean(busy)} onClick={() => setStatus("new")}>
                {t("aiSupport.waCommerce.orders.reopen")}
              </ActionButton>
            ) : null}
          </div>
        </div>

        {noticeBox}

        <div className="grid gap-2 rounded-2xl border border-white/10 bg-white/[0.02] p-3 text-[11px] text-slate-400 sm:grid-cols-2 lg:grid-cols-4">
          <div>{t("aiSupport.waCommerce.orders.columns.customer")}: <span dir="ltr" className="font-black text-slate-200">{detail.customer_phone}</span></div>
          {detail.catalog_name || detail.catalog_id ? (
            <div>{t("aiSupport.waCommerce.orders.columns.catalog")}: <span dir="auto" className="font-black text-slate-200">{detail.catalog_name || detail.catalog_id}</span></div>
          ) : null}
          <div>{t("aiSupport.waCommerce.orders.columns.date")}: <span className="font-black text-slate-200">{formatDateTime(detail.ordered_at)}</span></div>
          {detail.erp_order_id ? (
            <div>{t("aiSupport.waCommerce.orders.erpOrder")}: <span dir="ltr" className="font-black text-slate-200">#{detail.erp_order_id}</span></div>
          ) : null}
        </div>

        {detail.note ? <p dir="auto" className="rounded-xl border border-white/10 bg-slate-950/40 p-2.5 text-xs text-slate-200">{detail.note}</p> : null}

        <div className={`overflow-x-auto rounded-2xl border border-white/10 transition ${busy === "detail" ? "opacity-60" : ""}`}>
          <table className="w-full min-w-[560px] text-start text-xs">
            <thead className="bg-white/[0.04] text-[10.5px] uppercase tracking-[0.12em] text-slate-500">
              <tr>
                <th className="px-3 py-2 text-start">{t("aiSupport.waCommerce.orders.items.product")}</th>
                <th className="px-3 py-2 text-start">{t("aiSupport.waCommerce.orders.items.quantity")}</th>
                <th className="px-3 py-2 text-start">{t("aiSupport.waCommerce.orders.items.price")}</th>
                <th className="px-3 py-2 text-start">{t("aiSupport.waCommerce.orders.items.lineTotal")}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, index) => (
                <tr key={`${item.product_retailer_id}-${index}`} className="border-t border-white/5 text-slate-200">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2.5">
                      {item.image_url ? (
                        <img src={item.image_url} alt="" loading="lazy" className="h-11 w-11 shrink-0 rounded-lg border border-white/10 object-cover" />
                      ) : (
                        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/[0.04] text-slate-600"><ImageIcon className="h-4 w-4" aria-hidden="true" /></span>
                      )}
                      <div className="min-w-0">
                        {item.name ? <div dir="auto" className="font-black">{item.name}</div> : null}
                        <div dir="ltr" className="text-[11px] text-slate-500">{item.product_retailer_id}</div>
                        {item.erp ? null : <div className="text-[11px] text-amber-200/80">{t("aiSupport.waCommerce.orders.items.notMapped")}</div>}
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2 font-black">{item.quantity}</td>
                  <td className="px-3 py-2" dir="ltr">{formatMoney(item.item_price)}</td>
                  <td className="px-3 py-2 font-black" dir="ltr">{formatMoney(item.line_total ?? Number(item.item_price) * Number(item.quantity))}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-white/10 bg-white/[0.03] text-white">
                <td colSpan={3} className="px-3 py-2.5 text-end text-[11px] font-black uppercase tracking-[0.12em] text-slate-400">{t("aiSupport.waCommerce.orders.columns.total")}</td>
                <td className="px-3 py-2.5 text-sm font-black" dir="ltr">{formatMoney(detail.total)} {detail.currency}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    );
  }

  const total = STATUSES.reduce((sum, key) => sum + (Number(counts[key]) || 0), 0);

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-400">{t("aiSupport.waCommerce.orders.subtitle")}</p>
      {noticeBox}
      <div className="flex flex-wrap items-center gap-1.5">
        {["all", ...STATUSES].map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            className={`h-8 rounded-full border px-3 text-[11px] font-black transition ${filter === key ? "border-cyan-300/40 bg-cyan-400/10 text-cyan-100" : "border-white/10 bg-white/[0.04] text-slate-300 hover:bg-white/[0.08]"}`}
          >
            {key === "all" ? t("aiSupport.waCommerce.orders.all") : statusLabel(t, key)} {key === "all" ? total : counts[key] || 0}
          </button>
        ))}
        <form className="ms-auto" onSubmit={(event) => { event.preventDefault(); setSearch(clean(query)); }}>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("aiSupport.waCommerce.orders.search")}
            className="h-8 w-56 rounded-full border border-white/10 bg-slate-950/70 px-3 text-xs font-bold text-white outline-none placeholder:text-slate-600 focus:border-cyan-300/40"
          />
        </form>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-white/10">
        <table className="w-full min-w-[640px] text-start text-xs">
          <thead className="bg-white/[0.04] text-[10.5px] uppercase tracking-[0.12em] text-slate-500">
            <tr>
              <th className="px-3 py-2 text-start">{t("aiSupport.waCommerce.orders.columns.customer")}</th>
              <th className="px-3 py-2 text-start">{t("aiSupport.waCommerce.orders.columns.catalog")}</th>
              <th className="px-3 py-2 text-start">{t("aiSupport.waCommerce.orders.columns.status")}</th>
              <th className="px-3 py-2 text-start">{t("aiSupport.waCommerce.orders.columns.total")}</th>
              <th className="px-3 py-2 text-start">{t("aiSupport.waCommerce.orders.columns.currency")}</th>
              <th className="px-3 py-2 text-start">{t("aiSupport.waCommerce.orders.columns.date")}</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <tr key={order.id} onClick={() => open(order)} className="cursor-pointer border-t border-white/5 text-slate-200 hover:bg-white/[0.04]">
                <td className="px-3 py-2.5">
                  {order.customer_name ? <div dir="auto" className="font-black">{order.customer_name}</div> : null}
                  <div dir="ltr" className={order.customer_name ? "text-[11px] text-slate-500" : "font-black"}>{order.customer_phone}</div>
                </td>
                <td className="px-3 py-2.5 text-slate-400" dir="auto">{order.catalog_name || order.catalog_id}</td>
                <td className="px-3 py-2.5"><StatusBadge status={order.status} /></td>
                <td className="px-3 py-2.5 font-black" dir="ltr">
                  {formatMoney(order.total)}
                  {order.item_count ? <span className="ms-1.5 text-[11px] font-bold text-slate-500">· {t("aiSupport.waCommerce.orders.itemCount", { count: order.item_count })}</span> : null}
                </td>
                <td className="px-3 py-2.5 text-slate-400" dir="ltr">{order.currency}</td>
                <td className="px-3 py-2.5 text-slate-400">{formatDateTime(order.ordered_at)}</td>
              </tr>
            ))}
            {!orders.length ? (
              <tr><td colSpan={6} className="px-3 py-10 text-center text-slate-500">{t("aiSupport.waCommerce.orders.empty")}</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {hasMore ? (
        <div className="flex justify-center">
          <ActionButton loading={busy === "more"} onClick={async () => { setBusy("more"); await load({ append: true, offset: orders.length }); if (mountedRef.current) setBusy(""); }}>
            {t("aiSupport.waCommerce.orders.loadMore")}
          </ActionButton>
        </div>
      ) : null}
    </div>
  );
}
