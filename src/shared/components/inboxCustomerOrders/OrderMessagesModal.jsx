import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Loader2, Send, X } from "lucide-react";

import { api } from "../../api/api";
import { listOrderMessages, sendOrderMessage } from "../../api/orderMessages";
import { hasPermission } from "../../auth/authStorage";
import { formatCurrency } from "../../lib/currency";
import { conversationPhone, conversationSessionId } from "./InboxCustomerOrdersPanel";

// The order page's message picker, opened from the customer drawer in the inbox: pick one of the
// customer's orders, then one of the server's order messages (confirmation, invoice, shipping
// update, payment card). Same registry, same route and same grants as the order page — only the
// order has to be chosen first, because a conversation can have several.

const formatDateTime = (value) => {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
};

export default function OrderMessagesModal({ open, conversation = null, onClose, onNotice = null }) {
  const { t } = useTranslation();
  const [orders, setOrders] = useState(null);
  const [orderId, setOrderId] = useState("");
  const [messages, setMessages] = useState(null);
  const [messageKey, setMessageKey] = useState("");
  const [amount, setAmount] = useState("");
  const [sending, setSending] = useState(false);
  const messagesRequestRef = useRef(0);

  // The inbox hands a fresh onNotice on every render (and it re-renders on each list poll); as an
  // effect dependency it reloaded the orders mid-pick and wiped the typed amount.
  const onNoticeRef = useRef(onNotice);
  onNoticeRef.current = onNotice;
  const notify = useCallback((tone, message) => onNoticeRef.current?.(tone, message), []);
  const sessionId = conversationSessionId(conversation || {});
  const phone = conversationPhone(conversation || {});

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setOrders(null);
    setOrderId("");
    setMessages(null);
    setMessageKey("");
    setAmount("");
    if (!sessionId && !phone) {
      setOrders([]);
      return undefined;
    }
    api.get(`/ai-agent/conversations/${encodeURIComponent(sessionId || phone)}/orders`, { params: phone ? { phone } : {} })
      .then((response) => {
        if (cancelled) return;
        const list = Array.isArray(response?.orders) ? response.orders : [];
        setOrders(list);
        // The newest open order is nearly always the one being talked about.
        const first = list.find((order) => !order.is_closed) || list[0];
        setOrderId(first ? String(first.id) : "");
      })
      .catch((err) => {
        if (cancelled) return;
        setOrders([]);
        notify("error", err?.responseBody?.message || err?.message || t("orders.details.messageSend.failed"));
      });
    return () => { cancelled = true; };
  }, [notify, open, phone, sessionId, t]);

  useEffect(() => {
    if (!open || !orderId) return;
    const requestId = messagesRequestRef.current + 1;
    messagesRequestRef.current = requestId;
    setMessages(null);
    listOrderMessages(orderId)
      .then((list) => {
        if (messagesRequestRef.current !== requestId) return;
        // A message the operator may not send is not offered; the server refuses it anyway.
        const allowed = list.filter((message) => hasPermission(message.permission));
        setMessages(allowed);
        setMessageKey((current) => (allowed.some((message) => message.key === current) ? current : allowed[0]?.key || ""));
      })
      .catch((err) => {
        if (messagesRequestRef.current !== requestId) return;
        setMessages([]);
        notify("error", err?.responseBody?.message || err?.message || t("orders.details.messageSend.failed"));
      });
  }, [notify, open, orderId, t]);

  const handleSend = async () => {
    if (sending || !orderId || !messageKey) return;
    try {
      setSending(true);
      const typed = Number(amount) || 0;
      const body = messageKey === "shipping_fee_payment_card" && typed > 0 ? { amount: typed } : {};
      const response = await sendOrderMessage(orderId, messageKey, { body });
      notify("success", response?.message || t("orders.details.messageSend.sent"));
      onClose?.();
    } catch (err) {
      notify("error", err?.responseBody?.message || err?.message || t("orders.details.messageSend.failed"));
    } finally {
      setSending(false);
    }
  };

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[1100] flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={t("orders.details.messageSend.title")}>
      <button type="button" aria-label={t("common.close")} onClick={() => !sending && onClose?.()} className="absolute inset-0 bg-slate-950/45" />
      <div className="relative flex max-h-[88vh] w-full flex-col rounded-t-3xl border border-border bg-surface text-text shadow-2xl sm:max-w-lg sm:rounded-3xl">
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="text-base font-black text-text">{t("orders.details.messageSend.title")}</div>
          <button type="button" onClick={onClose} disabled={sending} className="rounded-full border border-border bg-surface-soft p-2 text-text">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {orders === null ? (
            <div className="flex items-center gap-2 text-sm text-text-muted">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("orders.details.messageSend.loading")}
            </div>
          ) : orders.length === 0 ? (
            <p className="text-sm text-text-muted">{t("aiSupport.inbox.customer360.noOrders")}</p>
          ) : (
            <>
              <p className="text-xs font-black text-text-muted">{t("orders.details.messageSend.invoice")}</p>
              <div role="radiogroup" className="mt-2 flex gap-2 overflow-x-auto pb-1">
                {orders.map((order) => {
                  const picked = String(order.id) === orderId;
                  return (
                    <button
                      key={order.id}
                      type="button"
                      role="radio"
                      aria-checked={picked}
                      onClick={() => setOrderId(String(order.id))}
                      disabled={sending}
                      className={`shrink-0 rounded-2xl border px-3 py-2 text-start ${picked ? "border-primary bg-primary text-primary-foreground" : "border-border bg-surface-soft text-text"}`}
                    >
                      <div className="text-xs font-black">{order.invoice_number || `#${order.id}`}</div>
                      <div className={`mt-0.5 text-[11px] ${picked ? "opacity-80" : "text-text-muted"}`}>
                        {formatCurrency(Number(order.total_amount || 0))}{order.status ? ` · ${order.status}` : ""}
                      </div>
                    </button>
                  );
                })}
              </div>

              <p className="mt-4 text-xs font-black text-text-muted">{t("orders.details.messageSend.pick")}</p>
              {messages === null ? (
                <div className="mt-2 flex items-center gap-2 text-sm text-text-muted">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t("orders.details.messageSend.loading")}
                </div>
              ) : messages.length === 0 ? (
                <p className="mt-2 text-sm text-text-muted">{t("orders.details.messageSend.none")}</p>
              ) : (
                <div role="radiogroup" className="mt-2 space-y-2">
                  {messages.map((message) => {
                    const picked = message.key === messageKey;
                    return (
                      <button
                        key={message.key}
                        type="button"
                        role="radio"
                        aria-checked={picked}
                        onClick={() => setMessageKey(message.key)}
                        disabled={sending}
                        className={`block w-full rounded-2xl border p-3 text-start transition ${picked ? "border-primary bg-primary/10" : "border-border bg-surface-soft hover:bg-surface-hover"}`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-sm font-black text-text">{t(`orders.details.messageSend.messages.${message.key}.label`, { defaultValue: message.key })}</span>
                          {message.tracks_last_sent ? (
                            <span className="text-[11px] text-text-muted">
                              {t("orders.details.messageSend.lastSent")}: {message.last_sent_at ? formatDateTime(message.last_sent_at) : t("orders.details.messageSend.neverSent")}
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-1 text-xs leading-5 text-text-muted">{t(`orders.details.messageSend.messages.${message.key}.detail`, { defaultValue: "" })}</p>
                      </button>
                    );
                  })}
                </div>
              )}

              {messageKey === "shipping_fee_payment_card" ? (
                <label className="mt-4 block text-xs font-black text-text-muted">
                  {t("orders.details.messageSend.amount")}
                  <input
                    type="number"
                    min="0"
                    inputMode="decimal"
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    disabled={sending}
                    placeholder={t("orders.details.messageSend.amountPlaceholder")}
                    className="mt-1 h-11 w-full rounded-xl border border-border bg-surface-soft px-3 text-sm font-semibold text-text outline-none focus:border-primary"
                  />
                </label>
              ) : null}
            </>
          )}
        </div>

        <div className="flex gap-2 border-t border-border px-4 py-3">
          <button type="button" onClick={onClose} disabled={sending} className="h-11 flex-1 rounded-xl border border-border bg-surface-soft text-sm font-black text-text disabled:opacity-60">
            {t("orders.bulk.cancel")}
          </button>
          <button
            type="button"
            onClick={handleSend}
            disabled={sending || !orderId || !messageKey}
            className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-primary text-sm font-black text-primary-foreground disabled:opacity-60"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {sending ? t("orders.details.messageSend.sending") : t("orders.details.messageSend.confirm")}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
