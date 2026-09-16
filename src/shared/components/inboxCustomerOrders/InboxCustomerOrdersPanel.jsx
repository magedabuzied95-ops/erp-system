import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Banknote, CheckCircle2, Loader2, RefreshCw, Send, ShoppingBag, XCircle } from "lucide-react";

import { api } from "../../api/api";
import { formatCurrency } from "../../lib/currency";

// The customer's real orders inside the inbox: the confirmation message and the payment review
// are the two things staff used to leave the conversation for. Both surfaces (desktop + PWA)
// render this one panel.

const text = (value = "") => String(value ?? "").trim();
const money = (value) => formatCurrency(Number(value || 0));

const conversationSessionId = (conversation = {}) =>
  text(conversation.session_id || conversation.external_conversation_id || conversation.conversation_key || conversation.id);

const conversationPhone = (conversation = {}) =>
  text(
    conversation.customer_phone ||
      conversation.phone ||
      conversation.customer_profile?.phone ||
      conversation.customer_profile?.customer_phone ||
      ""
  );

export const inboxOrderPaymentChoices = (order = {}) => {
  if (!order?.awaiting_payment_review) return [];
  const advanceAmount = Number(order.shipping_fee_advance?.amount || 0);
  const total = Number(order.total_amount || 0);
  // A screenshot dropped in the shipping-fee slot can still pay the whole order, so staff say
  // which one it is instead of the amount being guessed from where it was uploaded.
  if (advanceAmount > 0 && advanceAmount < total) {
    // What was asked for comes first: pressing the wrong one marks a 200 EGP deposit as a paid
    // order and the courier collects nothing (INV-1583).
    return [
      {
        key: "deposit",
        labelKey: Number(order.shipping_fee_advance?.requested_deposit || 0) > 0 ? "payDeposit" : "payShipping",
        amount: advanceAmount,
        tone: "emerald",
      },
      { key: "order_total", labelKey: "payFull", amount: total, tone: "cyan" },
    ];
  }
  return [{ key: "order_total", labelKey: "payFull", amount: total || advanceAmount, tone: "emerald" }];
};

const LABELS = {
  title: "أوردرات العميل",
  empty: "مفيش أوردرات للعميل ده.",
  loading: "بنحمّل الأوردرات...",
  refresh: "تحديث",
  sendConfirmation: "إرسال رسالة التأكيد",
  requestDeposit: "إرسال طلب ديبوزت",
  depositAmount: "مبلغ الديبوزت",
  depositRequested: "تم إرسال طلب الديبوزت",
  confirmPayment: "تأكيد الدفع",
  payFull: "الأوردر كامل",
  payShipping: "الشحن بس",
  payDeposit: "الديبوزت بس",
  fixPaidAmount: "تصحيح: العميل دفع",
  rejectPayment: "رفض التحويل",
  awaitingReview: "تحويل مستني المراجعة",
  paid: "مدفوع",
  collect: "المندوب هيحصّل",
  total: "الإجمالي",
  confirmationSent: "تم إرسال رسالة التأكيد",
  paymentConfirmed: "تم تأكيد الدفع",
  paymentRejected: "تم رفض التحويل",
  failed: "الإجراء فشل",
  nothingToCollect: "مفيش مبلغ عند الاستلام",
};

// Customer360Drawer is a white surface; the inbox rail is a dark one. Same panel, two skins —
// a dark card dropped on the white drawer reads as ink on ink.
const SKINS = {
  dark: {
    shell: "rounded-2xl border border-white/10 bg-white/[0.045] p-3",
    heading: "inline-flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.14em] text-slate-300",
    refresh: "inline-flex h-8 items-center gap-1 rounded-lg border border-white/10 bg-white/[0.05] px-2 text-[11px] font-black text-slate-200 disabled:opacity-50",
    card: "rounded-2xl border border-white/10 bg-slate-950/70 p-3",
    invoice: "truncate text-sm font-black text-white",
    muted: "mt-1 text-xs text-slate-400",
    tile: "rounded-xl border border-white/10 bg-white/[0.04] p-2",
    tileLabel: "text-[10px] font-black uppercase tracking-[0.12em] text-slate-500",
    tileValue: "mt-1 text-xs font-black text-white",
    empty: "rounded-xl border border-dashed border-white/10 p-4 text-sm text-slate-500",
    loading: "flex items-center gap-2 rounded-xl border border-dashed border-white/10 p-4 text-sm text-slate-400",
    error: "mt-2 rounded-xl border border-rose-300/25 bg-rose-400/10 p-2 text-[11px] font-black text-rose-100",
    secondary: "border border-white/10 bg-white/[0.055] text-white",
    input: "border border-white/10 bg-slate-950/60 text-white placeholder:text-slate-500",
  },
  light: {
    shell: "rounded-2xl border border-[#E2E8F0] bg-white p-3 shadow-[0_8px_24px_rgba(15,23,42,0.04)]",
    heading: "inline-flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.14em] text-slate-600",
    refresh: "inline-flex h-8 items-center gap-1 rounded-lg border border-[#E2E8F0] bg-slate-50 px-2 text-[11px] font-black text-slate-700 disabled:opacity-50",
    card: "rounded-2xl border border-[#E2E8F0] bg-slate-50/70 p-3",
    invoice: "truncate text-sm font-black text-slate-900",
    muted: "mt-1 text-xs text-slate-500",
    tile: "rounded-xl border border-[#E2E8F0] bg-white p-2",
    tileLabel: "text-[10px] font-black uppercase tracking-[0.12em] text-slate-500",
    tileValue: "mt-1 text-xs font-black text-slate-900",
    empty: "rounded-xl border border-dashed border-[#E2E8F0] p-4 text-sm text-slate-500",
    loading: "flex items-center gap-2 rounded-xl border border-dashed border-[#E2E8F0] p-4 text-sm text-slate-500",
    error: "mt-2 rounded-xl border border-rose-200 bg-rose-50 p-2 text-[11px] font-black text-rose-700",
    secondary: "border border-[#E2E8F0] bg-white text-slate-800",
    input: "border border-[#E2E8F0] bg-white text-slate-900 placeholder:text-slate-400",
  },
};

export default function InboxCustomerOrdersPanel({ conversation = null, headers = undefined, tone = "dark", onNotice = null }) {
  const skin = SKINS[tone] || SKINS.dark;
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busyOrderId, setBusyOrderId] = useState(null);
  const [error, setError] = useState("");
  const [depositDraft, setDepositDraft] = useState({});
  const requestRef = useRef(0);

  const sessionId = conversationSessionId(conversation || {});
  const phone = conversationPhone(conversation || {});

  const notify = useCallback((tone, message) => {
    if (typeof onNotice === "function") onNotice(tone, message);
  }, [onNotice]);

  const load = useCallback(async () => {
    if (!sessionId && !phone) {
      setOrders([]);
      return;
    }
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setLoading(true);
    setError("");
    try {
      const response = await api.get(`/ai-agent/conversations/${encodeURIComponent(sessionId || phone)}/orders`, {
        params: phone ? { phone } : {},
        headers,
      });
      if (requestRef.current !== requestId) return;
      setOrders(Array.isArray(response?.orders) ? response.orders : []);
    } catch (err) {
      if (requestRef.current !== requestId) return;
      setOrders([]);
      setError(err?.message || LABELS.failed);
    } finally {
      if (requestRef.current === requestId) setLoading(false);
    }
  }, [headers, phone, sessionId]);

  useEffect(() => {
    load();
  }, [load]);

  const runAction = useCallback(async (order, action, scope = "", amount = 0) => {
    if (!order?.id || busyOrderId) return;
    setBusyOrderId(order.id);
    try {
      if (action === "send_confirmation") {
        await api.post(`/orders/${order.id}/send-confirmation`, {}, { headers });
        notify("success", LABELS.confirmationSent);
      } else if (action === "confirm_payment") {
        const typedAmount = Number(amount) || 0;
        const payload = scope === "order_total"
          ? { scope: "order_total" }
          : typedAmount > 0
            ? { scope: "deposit", amount: typedAmount }
            : {};
        await api.post(`/orders/${order.id}/confirm-payment`, payload, { headers });
        notify("success", LABELS.paymentConfirmed);
      } else if (action === "request_deposit") {
        const typed = Number(scope) || 0;
        await api.post(`/orders/${order.id}/request-shipping-fee`, typed > 0 ? { amount: typed } : {}, { headers });
        setDepositDraft((current) => ({ ...current, [order.id]: "" }));
        notify("success", LABELS.depositRequested);
      } else if (action === "reject_payment") {
        await api.post(`/orders/${order.id}/reject-payment`, {}, { headers });
        notify("success", LABELS.paymentRejected);
      }
      await load();
    } catch (err) {
      const message = err?.responseBody?.message || err?.message || LABELS.failed;
      setError(message);
      notify("error", message);
    } finally {
      setBusyOrderId(null);
    }
  }, [busyOrderId, headers, load, notify]);

  const body = useMemo(() => {
    if (loading && !orders.length) {
      return (
        <div className={skin.loading}>
          <Loader2 className="h-4 w-4 animate-spin" />
          {LABELS.loading}
        </div>
      );
    }
    if (!orders.length) {
      return <div className={skin.empty}>{LABELS.empty}</div>;
    }
    return orders.map((order) => {
      const busy = busyOrderId === order.id;
      const choices = inboxOrderPaymentChoices(order);
      const depositRequired = Boolean(order.shipping_fee_advance?.required) && order.shipping_fee_advance?.status !== "paid";
      // The box opens on the amount the closing system would ask for; staff overwrite it freely.
      const depositAmount = depositDraft[order.id] ?? (depositRequired ? String(order.shipping_fee_advance.amount) : "");
      return (
        <div key={order.id} className={skin.card}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className={skin.invoice}>{order.invoice_number}</div>
              <div className={skin.muted}>{order.status || ""}</div>
            </div>
            {order.awaiting_payment_review ? (
              <span className="shrink-0 rounded-full border border-amber-300/25 bg-amber-300/10 px-2 py-1 text-[10px] font-black text-amber-100">
                {LABELS.awaitingReview}
              </span>
            ) : null}
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <div className={skin.tile}>
              <div className={skin.tileLabel}>{LABELS.total}</div>
              <div className={skin.tileValue}>{money(order.total_amount)}</div>
            </div>
            <div className={skin.tile}>
              <div className={skin.tileLabel}>{LABELS.paid}</div>
              <div className="mt-1 text-xs font-black text-emerald-500">{money(order.paid_amount)}</div>
            </div>
            <div className={skin.tile}>
              <div className={skin.tileLabel}>{LABELS.collect}</div>
              <div className="mt-1 text-xs font-black text-amber-500">
                {Number(order.collect_on_delivery || 0) > 0 ? money(order.collect_on_delivery) : LABELS.nothingToCollect}
              </div>
            </div>
          </div>

          <div className="mt-3 grid gap-2">
            {choices.map((choice) => (
              <button
                key={choice.key}
                type="button"
                disabled={busy}
                onClick={() => runAction(order, "confirm_payment", choice.key, choice.key === "deposit" ? choice.amount : 0)}
                className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-xl px-3 text-xs font-black disabled:opacity-50 ${
                  choice.tone === "emerald"
                    ? "bg-emerald-400 text-slate-950"
                    : "border border-cyan-300/25 bg-cyan-300/10 text-cyan-100"
                }`}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Banknote className="h-4 w-4" />}
                {`${LABELS.confirmPayment} — ${LABELS[choice.labelKey]} (${money(choice.amount)})`}
              </button>
            ))}

            {order.awaiting_payment_review ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => runAction(order, "reject_payment")}
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-rose-300/25 bg-rose-400/10 px-3 text-xs font-black text-rose-100 disabled:opacity-50"
              >
                <XCircle className="h-4 w-4" />
                {LABELS.rejectPayment}
              </button>
            ) : null}

            {/* The closing system decides the default amount; staff can ask for any amount the
                order still owes — the card, the link and the review are the same either way. */}
            {Number(order.collect_on_delivery || 0) > 0 || depositRequired || order.has_payment_proof ? (
              <div className="grid gap-2">
                <input
                  type="number"
                  inputMode="decimal"
                  min="1"
                  step="1"
                  value={depositAmount}
                  onChange={(event) => setDepositDraft((current) => ({ ...current, [order.id]: event.target.value }))}
                  placeholder={LABELS.depositAmount}
                  className={`h-10 w-full rounded-xl px-3 text-xs font-black outline-none ${skin.input}`}
                />
                <button
                  type="button"
                  disabled={busy || !(Number(depositAmount) > 0)}
                  onClick={() => runAction(order, "request_deposit", depositAmount)}
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-amber-300/25 bg-amber-300/10 px-3 text-xs font-black text-amber-600 disabled:opacity-50"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Banknote className="h-4 w-4" />}
                  {Number(depositAmount) > 0 ? `${LABELS.requestDeposit} (${money(depositAmount)})` : LABELS.requestDeposit}
                </button>
                {/* The same box repairs the books: a screenshot approved as the whole order is
                    re-stated at what the customer actually transferred. */}
                {order.has_payment_proof && Number(depositAmount) > 0 && Math.abs(Number(depositAmount) - Number(order.paid_amount || 0)) > 0.009 ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => runAction(order, "confirm_payment", "deposit", depositAmount)}
                    className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-xl px-3 text-xs font-black disabled:opacity-50 ${skin.secondary}`}
                  >
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                    {`${LABELS.fixPaidAmount} ${money(depositAmount)}`}
                  </button>
                ) : null}
              </div>
            ) : null}

            {order.can_send_confirmation ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => runAction(order, "send_confirmation")}
                className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-xl px-3 text-xs font-black disabled:opacity-50 ${skin.secondary}`}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                {LABELS.sendConfirmation}
              </button>
            ) : null}

            {order.customer_confirmed_at ? (
              <div className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-300/20 bg-emerald-400/10 px-3 py-2 text-[11px] font-black text-emerald-100">
                <CheckCircle2 className="h-4 w-4" />
                {LABELS.confirmationSent}
              </div>
            ) : null}
          </div>
        </div>
      );
    });
  }, [busyOrderId, depositDraft, loading, orders, runAction, skin]);

  if (!conversation) return null;

  return (
    <div className={skin.shell}>
      <div className="flex items-center justify-between gap-2">
        <div className={skin.heading}>
          <ShoppingBag className="h-4 w-4" />
          {LABELS.title}
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className={skin.refresh}
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          {LABELS.refresh}
        </button>
      </div>
      {error ? <div className={skin.error}>{error}</div> : null}
      <div className="mt-3 space-y-3">{body}</div>
    </div>
  );
}
