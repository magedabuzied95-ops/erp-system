import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { AlertTriangle, CheckCircle2, CloudOff, Image as ImageIcon, Loader2, Printer, RefreshCw, Trash2, X } from "lucide-react";

import { formatCurrency } from "../lib/posUtils";
import {
  OFFLINE_ORDER_STATUS,
  OPEN_OFFLINE_ORDER_STATUSES,
  listOfflineOrders,
  subscribeToOfflineOrderChanges,
} from "../lib/posOfflineOrders";
import { listOfflineCustomers } from "../lib/posOfflineCustomers";
import { listOpenOfflineExpenses } from "../lib/posOfflineExpenses";

const STATUS_TONE = {
  [OFFLINE_ORDER_STATUS.PENDING]: "border-amber-400/40 bg-amber-400/10 text-amber-300",
  [OFFLINE_ORDER_STATUS.FAILED]: "border-orange-400/40 bg-orange-400/10 text-orange-300",
  [OFFLINE_ORDER_STATUS.NEEDS_REVIEW]: "border-rose-400/40 bg-rose-400/10 text-rose-300",
  [OFFLINE_ORDER_STATUS.SYNCED]: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300",
};

const formatWhen = (value) => {
  const parsed = Date.parse(value || "");
  if (!parsed) return "";
  try {
    return new Intl.DateTimeFormat(undefined, {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(parsed));
  } catch {
    return new Date(parsed).toISOString().slice(0, 16).replace("T", " ");
  }
};

/**
 * The cashier's window onto everything this device still owes the server. It is
 * the answer to "did my invoices go through?", which before this had no answer
 * anywhere in the till beyond a single count in the cart.
 */
export default function PosOfflineQueueModal({
  open,
  onClose,
  online = true,
  syncing = false,
  onSyncNow,
  onRetryOrder,
  onDiscardOrder,
  onPrintOrder,
  onRetryExpense,
  onDiscardExpense,
  imageCache = null,
  imageWarming = false,
  onWarmImages,
}) {
  const { t } = useTranslation();
  const label = useCallback(
    (key, fallback) => {
      const full = `pos.offlineQueue.${key}`;
      const value = t(full);
      return value === full ? fallback : value;
    },
    [t]
  );

  const [orders, setOrders] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busyLocalId, setBusyLocalId] = useState("");
  const [confirmDiscardId, setConfirmDiscardId] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [orderRows, customerRows, expenseRows] = await Promise.all([
        listOfflineOrders().catch(() => []),
        listOfflineCustomers().catch(() => []),
        listOpenOfflineExpenses().catch(() => []),
      ]);
      setOrders(orderRows.slice().reverse());
      setCustomers(customerRows.filter((row) => String(row.status || "") !== "synced"));
      setExpenses(expenseRows.slice().reverse());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    void refresh();
    return subscribeToOfflineOrderChanges(() => {
      void refresh();
    });
  }, [open, refresh]);

  const openOrders = useMemo(
    () => orders.filter((order) => OPEN_OFFLINE_ORDER_STATUSES.includes(String(order.status || ""))),
    [orders]
  );
  const needsReview = useMemo(
    () => openOrders.filter((order) => String(order.status || "") === OFFLINE_ORDER_STATUS.NEEDS_REVIEW),
    [openOrders]
  );
  const openTotal = useMemo(
    () => openOrders.reduce((sum, order) => sum + Number(order.totals?.total || 0), 0),
    [openOrders]
  );

  const runRowAction = useCallback(async (localId, action) => {
    setBusyLocalId(localId);
    try {
      await action?.();
    } finally {
      setBusyLocalId("");
    }
  }, []);

  if (!open) return null;
  if (typeof document === "undefined") return null;

  const statusLabel = (status) => {
    switch (String(status || "")) {
      case OFFLINE_ORDER_STATUS.SYNCED:
        return label("status.synced", "Synced");
      case OFFLINE_ORDER_STATUS.NEEDS_REVIEW:
        return label("status.needsReview", "Needs review");
      case OFFLINE_ORDER_STATUS.FAILED:
        return label("status.failed", "Retrying");
      default:
        return label("status.pending", "Waiting to sync");
    }
  };

  const reasonLabel = (order) => {
    switch (String(order.error_reason || "")) {
      case "stock_conflict":
        return label("reason.stockConflict", "The stock for this invoice is no longer available. Adjust the stock, then retry.");
      case "no_open_shift":
        return label("reason.noOpenShift", "Waiting for an open shift.");
      case "rejected":
        return label("reason.rejected", "The server refused this invoice. A manager needs to look at it.");
      case "server_unavailable":
        return label("reason.serverUnavailable", "The server is not answering yet.");
      default:
        return "";
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[96] flex items-center justify-center bg-black/65 p-3 backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label("title", "Offline invoices")}
        className="flex max-h-[94vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--surface-soft)] text-[var(--text)] shadow-[0_30px_80px_rgba(0,0,0,0.5)]"
      >
        <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <span
              className={`grid h-9 w-9 place-items-center rounded-xl border ${
                online
                  ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300"
                  : "border-amber-400/40 bg-amber-400/10 text-amber-300"
              }`}
            >
              <CloudOff className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <div className="truncate text-sm font-black">{label("title", "Offline invoices")}</div>
              <div className="truncate text-[10px] text-[var(--muted)]">
                {online
                  ? label("subtitle.online", "Connected. Anything queued is being sent now.")
                  : label("subtitle.offline", "No connection. Sales are saved on this device and sent automatically.")}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onSyncNow?.()}
              disabled={syncing}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-[11px] font-black text-[var(--text)] transition hover:border-[var(--primary)] disabled:opacity-60"
            >
              {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              {label("actions.syncNow", "Sync now")}
            </button>
            <button
              type="button"
              onClick={() => onClose?.()}
              aria-label={label("actions.close", "Close")}
              className="grid h-9 w-9 place-items-center rounded-xl border border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] transition hover:text-[var(--text)]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 border-b border-[var(--border)] px-4 py-3 text-center">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-2 py-2">
            <div className="text-[10px] font-black text-[var(--muted)]">{label("summary.pending", "Awaiting sync")}</div>
            <div className="text-lg font-black">{openOrders.length}</div>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-2 py-2">
            <div className="text-[10px] font-black text-[var(--muted)]">{label("summary.value", "Value held")}</div>
            <div className="text-lg font-black">{formatCurrency(openTotal)}</div>
          </div>
          <div
            className={`rounded-xl border px-2 py-2 ${
              needsReview.length > 0
                ? "border-rose-400/40 bg-rose-400/10 text-rose-300"
                : "border-[var(--border)] bg-[var(--surface)]"
            }`}
          >
            <div className="text-[10px] font-black opacity-80">{label("summary.needsReview", "Needs review")}</div>
            <div className="text-lg font-black">{needsReview.length}</div>
          </div>
        </div>

        {customers.length > 0 ? (
          <div className="border-b border-[var(--border)] px-4 py-2 text-[11px] text-[var(--muted)]">
            {label("customersPending", "Customers saved on this device, waiting to sync: {{count}}").replace(
              "{{count}}",
              String(customers.length)
            )}
          </div>
        ) : null}

        {/* The till is a picture grid: a cashier picks a product by looking at
            it, so how many photos this device holds is the difference between a
            usable offline catalogue and an unusable one. Shown here, with a way
            to fill it before the connection is needed rather than after. */}
        {imageCache ? (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-4 py-2">
            <div className="flex min-w-0 items-center gap-2 text-[11px] text-[var(--muted)]">
              <ImageIcon className="h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0">
                {label("images.stored", "Product photos saved for offline use: {{count}}").replace(
                  "{{count}}",
                  String(Number(imageCache.cached || 0))
                )}
                {Number(imageCache.expected || 0) > 0 ? ` / ${Number(imageCache.expected)}` : ""}
              </span>
            </div>
            <button
              type="button"
              onClick={() => onWarmImages?.()}
              disabled={imageWarming || !online}
              title={online ? "" : label("images.needsConnection", "A connection is needed to download photos")}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border)] px-2.5 text-[11px] font-black transition hover:border-[var(--primary)] disabled:opacity-60"
            >
              {imageWarming ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImageIcon className="h-3.5 w-3.5" />}
              {label("images.download", "Download photos")}
            </button>
          </div>
        ) : null}

        {expenses.length > 0 ? (
          <div className="border-b border-[var(--border)] px-4 py-2">
            <div className="mb-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-[var(--muted)]">
              {label("expenses.title", "Expenses waiting to sync")}
            </div>
            <ul className="flex flex-col gap-1.5">
              {expenses.map((expense) => (
                <li
                  key={expense.local_id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[12px] font-black">
                        {expense.employee_name || expense.category || label("expenses.fallback", "Expense")}
                      </span>
                      <span
                        className={`rounded-lg border px-1.5 py-0.5 text-[10px] font-black ${
                          STATUS_TONE[String(expense.status || "")] || STATUS_TONE[OFFLINE_ORDER_STATUS.PENDING]
                        }`}
                      >
                        {statusLabel(expense.status)}
                      </span>
                    </div>
                    <div className="truncate text-[10px] text-[var(--muted)]">
                      {[formatWhen(expense.created_at), expense.payment_method, expense.notes].filter(Boolean).join("  ·  ")}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] font-black">{formatCurrency(Number(expense.amount || 0))}</span>
                    <button
                      type="button"
                      disabled={busyLocalId === expense.local_id}
                      onClick={() => runRowAction(expense.local_id, () => onRetryExpense?.(expense))}
                      className="inline-flex h-7 items-center gap-1 rounded-lg border border-[var(--border)] px-2 text-[10px] font-black transition hover:border-[var(--primary)] disabled:opacity-60"
                    >
                      <RefreshCw className="h-3 w-3" />
                      {label("actions.retry", "Retry")}
                    </button>
                    {String(expense.status || "") === OFFLINE_ORDER_STATUS.NEEDS_REVIEW ? (
                      <button
                        type="button"
                        aria-label={label("actions.discard", "Discard")}
                        onClick={() => runRowAction(expense.local_id, () => onDiscardExpense?.(expense))}
                        className="grid h-7 w-7 place-items-center rounded-lg border border-[var(--border)] text-[var(--muted)] transition hover:border-rose-400/50 hover:text-rose-300"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {loading && orders.length === 0 ? (
            <div className="grid place-items-center py-10 text-[var(--muted)]">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : orders.length === 0 ? (
            <div className="grid place-items-center gap-2 py-12 text-center">
              <CheckCircle2 className="h-8 w-8 text-emerald-400/70" />
              <div className="text-sm font-black">{label("empty.title", "Nothing is waiting")}</div>
              <div className="max-w-sm text-[11px] text-[var(--muted)]">
                {label("empty.body", "Every invoice made on this device has reached the server.")}
              </div>
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {orders.map((order) => {
                const status = String(order.status || "");
                const isOpen = OPEN_OFFLINE_ORDER_STATUSES.includes(status);
                const busy = busyLocalId === order.local_id;
                const reason = reasonLabel(order);
                return (
                  <li
                    key={order.local_id}
                    className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-black">
                            {order.invoice_number || order.order_number || order.local_id}
                          </span>
                          <span
                            className={`rounded-lg border px-2 py-0.5 text-[10px] font-black ${
                              STATUS_TONE[status] || STATUS_TONE[OFFLINE_ORDER_STATUS.PENDING]
                            }`}
                          >
                            {statusLabel(status)}
                          </span>
                        </div>
                        <div className="mt-0.5 truncate text-[11px] text-[var(--muted)]">
                          {[
                            formatWhen(order.created_at),
                            order.customer?.name || "",
                            order.customer?.phone || "",
                            label("itemsCount", "{{count}} items").replace(
                              "{{count}}",
                              String(Array.isArray(order.cart_items) ? order.cart_items.length : 0)
                            ),
                          ]
                            .filter(Boolean)
                            .join("  ·  ")}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-black">{formatCurrency(Number(order.totals?.total || 0))}</span>
                        {onPrintOrder ? (
                          <button
                            type="button"
                            onClick={() => onPrintOrder(order)}
                            aria-label={label("actions.print", "Print receipt")}
                            title={label("actions.print", "Print receipt")}
                            className="grid h-8 w-8 place-items-center rounded-lg border border-[var(--border)] text-[var(--muted)] transition hover:text-[var(--text)]"
                          >
                            <Printer className="h-3.5 w-3.5" />
                          </button>
                        ) : null}
                        {isOpen ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => runRowAction(order.local_id, () => onRetryOrder?.(order))}
                            className="inline-flex h-8 items-center gap-1 rounded-lg border border-[var(--border)] px-2 text-[11px] font-black transition hover:border-[var(--primary)] disabled:opacity-60"
                          >
                            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                            {label("actions.retry", "Retry")}
                          </button>
                        ) : null}
                        {status === OFFLINE_ORDER_STATUS.NEEDS_REVIEW ? (
                          confirmDiscardId === order.local_id ? (
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() =>
                                  runRowAction(order.local_id, async () => {
                                    await onDiscardOrder?.(order);
                                    setConfirmDiscardId("");
                                  })
                                }
                                className="h-8 rounded-lg border border-rose-400/50 bg-rose-500/15 px-2 text-[11px] font-black text-rose-200 disabled:opacity-60"
                              >
                                {label("actions.confirmDiscard", "Delete for good")}
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDiscardId("")}
                                className="h-8 rounded-lg border border-[var(--border)] px-2 text-[11px] font-black"
                              >
                                {label("actions.cancel", "Cancel")}
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setConfirmDiscardId(order.local_id)}
                              aria-label={label("actions.discard", "Discard")}
                              title={label("actions.discard", "Discard")}
                              className="grid h-8 w-8 place-items-center rounded-lg border border-[var(--border)] text-[var(--muted)] transition hover:border-rose-400/50 hover:text-rose-300"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )
                        ) : null}
                      </div>
                    </div>
                    {reason || order.error ? (
                      <div
                        className={`mt-2 flex items-start gap-1.5 rounded-xl border px-2 py-1.5 text-[11px] ${
                          status === OFFLINE_ORDER_STATUS.NEEDS_REVIEW
                            ? "border-rose-400/30 bg-rose-400/5 text-rose-200"
                            : "border-[var(--border)] bg-[var(--surface-soft)] text-[var(--muted)]"
                        }`}
                      >
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span className="min-w-0 break-words">{reason || order.error}</span>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
