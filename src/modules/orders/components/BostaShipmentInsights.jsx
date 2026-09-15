import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, BadgeCheck, Calculator, ChevronDown, Clock3, Loader2, Phone, Printer, RefreshCw, Send, Truck } from "lucide-react";
import toast from "react-hot-toast";

import { api } from "../../../shared/api/api";
import { BOSTA_SEVERE_EXCEPTION_CODES, bostaStateLabel } from "../../../../shared/bostaDeliveryInsights";
import { formatCurrency, formatDateTime } from "../lib/ordersStore";

/*
 * What Bosta has told us about this parcel beyond its status: why an attempt failed, how
 * many attempts, the promised day, what Bosta charged, who is carrying it, and Bosta's own
 * history. Every value here was written by the webhook or a details sync — nothing is
 * guessed on the client.
 */

const errorMessage = (error, fallback) => error?.responseBody?.message || error?.message || fallback;

// A label arrives as one base64 PDF, so it becomes a blob the browser can show.
const pdfUrlFromBase64 = (base64) => {
  const binary = window.atob(String(base64 || ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
};

function Fact({ label, value, tone = "" }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-white/10 bg-white/5 p-3">
      <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">{label}</div>
      <div className={`mt-1 text-sm font-semibold ${tone || "text-white"}`}>{value}</div>
    </div>
  );
}

export function BostaFeeEstimate({ orderId, codAmount = "" }) {
  const { t } = useTranslation();
  const [state, setState] = useState({ loading: false, estimate: null });

  const run = async () => {
    try {
      setState({ loading: true, estimate: null });
      const query = String(codAmount ?? "").trim() !== "" ? `?cod=${encodeURIComponent(codAmount)}` : "";
      const result = await api.get(`/orders/${orderId}/shipping/bosta/estimate${query}`);
      setState({ loading: false, estimate: result.estimate || null });
    } catch (error) {
      setState({ loading: false, estimate: null });
      toast.error(errorMessage(error, t("orders.bostaInsights.estimateFailed")));
    }
  };

  const estimate = state.estimate;
  return (
    <div className="rounded-[var(--radius-card)] border border-white/10 bg-white/[0.03] px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-bold text-white">{t("orders.bostaInsights.estimateTitle")}</span>
        <button type="button" onClick={run} disabled={state.loading} className="inline-flex h-[var(--control-height-sm)] items-center gap-1.5 rounded-[var(--radius-control)] border border-white/10 bg-white/5 px-3 text-xs font-black text-white transition hover:bg-white/10 disabled:opacity-60">
          {state.loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Calculator className="h-3.5 w-3.5" />}
          {t("orders.bostaInsights.estimateAction")}
        </button>
      </div>
      {estimate ? (
        estimate.fees !== null && estimate.fees !== undefined ? (
          <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-xs font-semibold text-zinc-400">{t("orders.bostaInsights.estimateRoute", { from: estimate.pickup_city, to: estimate.dropoff_city })}</span>
            <span className="text-lg font-black text-primary">{formatCurrency(estimate.fees)}</span>
          </div>
        ) : (
          <p className="mt-2 text-xs font-semibold text-amber-200/90">{t("orders.bostaInsights.estimateUnreadable")}</p>
        )
      ) : null}
    </div>
  );
}

export default function BostaShipmentInsights({ order, onOrderChange, onBeforePush }) {
  const { t, i18n } = useTranslation();
  const lang = String(i18n.language || "ar").startsWith("ar") ? "ar" : "en";
  const [busy, setBusy] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  if (!order?.id) return null;

  const details = order.bosta_details && typeof order.bosta_details === "object" ? order.bosta_details : {};
  const history = Array.isArray(details.history) ? details.history : [];
  const status = String(order.shipment_status || order.shipping_status || "").toLowerCase();
  const openParcel = !["delivered", "returned", "cancelled"].includes(status);
  const hasException = order.bosta_exception_code !== null && order.bosta_exception_code !== undefined;
  const severe = hasException && BOSTA_SEVERE_EXCEPTION_CODES.has(Number(order.bosta_exception_code));
  const expectedCod = Number(order.courier_collected_amount ?? order.cod_amount ?? 0);
  const reportedCod = order.bosta_reported_cod === null || order.bosta_reported_cod === undefined ? null : Number(order.bosta_reported_cod);
  const codMismatch = reportedCod !== null && Math.abs(reportedCod - expectedCod) >= 1;
  const stateLabel = bostaStateLabel(details.state_code, lang) || details.masked_state || "";
  const editable = ["shipment_created", "picked_up", "in_transit", "failed_delivery"].includes(status);
  const notSynced = t("orders.bostaInsights.notYet");

  const syncDetails = async () => {
    try {
      setBusy("sync");
      const result = await api.post(`/orders/${order.id}/shipping/bosta/details`, {});
      if (result.order) onOrderChange?.(result.order);
      toast.success(t("orders.bostaInsights.synced"));
    } catch (error) {
      toast.error(errorMessage(error, t("orders.bostaInsights.syncFailed")));
    } finally {
      setBusy("");
    }
  };

  const printAwb = async () => {
    // The tab is claimed inside the click, before the await, or the popup blocker eats it.
    const printWindow = window.open("", "_blank");
    try {
      setBusy("print");
      const result = await api.post("/shipping/center/bulk", { action: "print_labels", order_ids: [order.id] });
      if (!result?.pdf_base64) throw new Error(t("orders.bostaInsights.printFailed"));
      const url = pdfUrlFromBase64(result.pdf_base64);
      if (printWindow && !printWindow.closed) {
        printWindow.location.href = url;
      } else {
        // Popup blocked: save it instead of navigating the order page away.
        const link = document.createElement("a");
        link.href = url;
        link.download = `bosta-awb-${order.invoice_number || order.id}.pdf`;
        document.body.appendChild(link);
        link.click();
        link.remove();
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 120000);
    } catch (error) {
      if (printWindow && !printWindow.closed) printWindow.close();
      toast.error(errorMessage(error, t("orders.bostaInsights.printFailed")));
    } finally {
      setBusy("");
    }
  };

  // The edited phone/address is saved on the order first, then the same values go to Bosta.
  const pushUpdate = async () => {
    try {
      setBusy("push");
      if (typeof onBeforePush === "function") {
        const saved = await onBeforePush();
        if (saved === false) return;
      }
      const result = await api.post(`/orders/${order.id}/shipping/bosta/update`, {});
      if (result.order) onOrderChange?.(result.order);
      toast.success(t("orders.bostaInsights.pushed"));
    } catch (error) {
      toast.error(errorMessage(error, t("orders.bostaInsights.pushFailed")));
    } finally {
      setBusy("");
    }
  };

  const actionClass = "inline-flex h-[var(--control-height-md)] items-center gap-1.5 rounded-[var(--radius-control)] border border-white/10 bg-white/5 px-3 text-xs font-black text-white transition hover:bg-white/10 disabled:opacity-60";

  return (
    <div className="mt-3 space-y-3">
      {hasException && openParcel ? (
        <div className={`rounded-xl border px-3 py-3 ${severe ? "border-rose-300/35 bg-rose-400/10 text-rose-50" : "border-amber-300/35 bg-amber-400/10 text-amber-50"}`}>
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="min-w-0">
              <div className="text-sm font-black">{t("orders.bostaInsights.failedAttempt", { attempt: Math.max(1, Number(order.bosta_attempts || 0) || 1) })}</div>
              <div className="mt-1 text-sm font-semibold">{order.bosta_exception_reason || t("orders.bostaInsights.unknownReason")}</div>
              {order.bosta_exception_at ? <div className="mt-1 text-[11px] font-semibold opacity-75">{formatDateTime(order.bosta_exception_at)}</div> : null}
              <p className="mt-2 text-[11px] font-semibold leading-5 opacity-85">{t("orders.bostaInsights.failedHint")}</p>
            </div>
          </div>
        </div>
      ) : null}

      {codMismatch ? (
        <div className="rounded-xl border border-rose-300/35 bg-rose-400/10 px-3 py-2 text-xs font-bold text-rose-50">
          {t("orders.bostaInsights.codMismatch", { reported: formatCurrency(reportedCod), expected: formatCurrency(expectedCod) })}
        </div>
      ) : null}

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        <Fact label={t("orders.bostaInsights.bostaState")} value={stateLabel || notSynced} />
        <Fact label={t("orders.bostaInsights.attempts")} value={order.bosta_attempts === null || order.bosta_attempts === undefined ? notSynced : String(order.bosta_attempts)} tone={Number(order.bosta_attempts) >= 2 ? "text-amber-200" : ""} />
        <Fact label={t("orders.bostaInsights.promiseDate")} value={order.bosta_promise_date ? String(order.bosta_promise_date).slice(0, 10) : notSynced} />
        <Fact label={t("orders.bostaInsights.fees")} value={order.bosta_shipment_fees === null || order.bosta_shipment_fees === undefined ? notSynced : formatCurrency(order.bosta_shipment_fees)} />
        <Fact
          label={t("orders.bostaInsights.courier")}
          value={order.bosta_courier_name ? (
            <span className="inline-flex flex-wrap items-center gap-2">
              <Truck className="h-3.5 w-3.5 text-primary" />
              {order.bosta_courier_name}
              {order.bosta_courier_phone ? (
                <a href={`tel:${order.bosta_courier_phone}`} dir="ltr" className="inline-flex items-center gap-1 text-primary hover:underline"><Phone className="h-3 w-3" />{order.bosta_courier_phone}</a>
              ) : null}
            </span>
          ) : notSynced}
        />
        <Fact
          label={t("orders.bostaInsights.confirmedDelivery")}
          value={order.bosta_confirmed_delivery === null || order.bosta_confirmed_delivery === undefined
            ? notSynced
            : (order.bosta_confirmed_delivery ? <span className="inline-flex items-center gap-1 text-emerald-200"><BadgeCheck className="h-3.5 w-3.5" />{t("orders.bostaInsights.yes")}</span> : t("orders.bostaInsights.no"))}
        />
      </div>

      {details.next_action && openParcel ? (
        <div className="flex items-start gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs font-semibold text-zinc-300">
          <Clock3 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
          <span><span className="font-black text-white">{t("orders.bostaInsights.nextStep")}</span> {details.next_action}</span>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={printAwb} disabled={Boolean(busy)} className={actionClass}>
          {busy === "print" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Printer className="h-3.5 w-3.5" />} {t("orders.bostaInsights.printAwb")}
        </button>
        <button type="button" onClick={syncDetails} disabled={Boolean(busy)} className={actionClass}>
          {busy === "sync" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} {t("orders.bostaInsights.syncDetails")}
        </button>
        {editable ? (
          <button type="button" onClick={pushUpdate} disabled={Boolean(busy)} title={t("orders.bostaInsights.pushHint")} className={actionClass}>
            {busy === "push" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} {t("orders.bostaInsights.pushUpdate")}
          </button>
        ) : null}
      </div>

      {history.length ? (
        <div className="rounded-xl border border-white/10 bg-white/[0.03]">
          <button type="button" onClick={() => setHistoryOpen((open) => !open)} className="flex w-full items-center justify-between gap-2 px-3 py-2 text-xs font-black text-white">
            {t("orders.bostaInsights.history", { total: history.length })}
            <ChevronDown className={`h-4 w-4 transition ${historyOpen ? "rotate-180" : ""}`} />
          </button>
          {historyOpen ? (
            <ol className="space-y-2 border-t border-white/10 px-3 py-3">
              {[...history].reverse().map((entry, index) => (
                <li key={`${entry.date}-${index}`} className="text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-black text-white">{entry.title}</span>
                    {entry.date ? <span className="text-[11px] font-semibold text-zinc-500">{formatDateTime(entry.date)}</span> : null}
                  </div>
                  {(entry.subs || []).map((sub, subIndex) => (
                    <div key={subIndex} className="mt-0.5 ps-3 text-[11px] font-semibold text-zinc-400">{sub.title}</div>
                  ))}
                </li>
              ))}
            </ol>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
