/*
 * The exchange, arranged where the customer asked for it.
 *
 * Two halves on one screen: what comes BACK (picked off the invoice, never typed) and
 * what goes OUT (picked from the catalogue, priced by the server). The figure between
 * them is a preview only - the server prorates the invoice discount out of the credit and
 * decides what the courier collects, so the number shown here is never what is charged.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeftRight, Loader2, Minus, Plus, Trash2, X } from "lucide-react";

import { api } from "../../api/api";
import { formatCurrency } from "../../lib/currency";
import { previewExchangeMoney } from "./exchangePreview";

const text = (value = "") => String(value ?? "").trim();
const money = (value) => formatCurrency(Number(value || 0));
const asArray = (value) => (Array.isArray(value) ? value : []);

const LABELS = {
  title: "استبدال",
  returning: "الراجع من العميل",
  replacement: "البديل اللي هيتبعت",
  pick: "اختار المنتج البديل",
  empty: "اختار القطعة اللي هترجع والقطعة البديلة.",
  credit: "قيمة الراجع",
  newTotal: "إجمالي البديل",
  collect: "المندوب هيحصّل",
  refundToWallet: "هيتحط رصيد للعميل",
  freeShipping: "شحن مجاني للاستبدال",
  reason: "سبب الاستبدال",
  submit: "تنفيذ الاستبدال",
  submitting: "بننفّذ...",
  cancel: "إلغاء",
  note: "الحسبة النهائية بتتعمل على السيرفر، والقطعة بترجع للمخزن لما بوسطه تأكد إنها اتسلمت.",
};

const REASONS = ["مقاس مش مظبوط", "لون مختلف", "المنتج مش زي الصور", "عيب صناعة", "سبب تاني"];

// The picker hands back product cards; an exchange line is one chosen model.
const lineFromCard = (card = {}) => ({
  product_id: card.product_id || card.id || null,
  variant_id: card.variant_id || null,
  product_name: text(card.product_name || card.name),
  color: text(card.color),
  size: text(card.size),
  image_url: card.image_url || card.image || card.thumbnail_url || "",
  price: Number(card.display_price ?? card.price ?? 0) || 0,
  quantity: 1,
});

const lineKey = (line = {}) =>
  `${line.product_id || ""}:${line.variant_id || ""}:${text(line.color).toLowerCase()}:${text(line.size).toLowerCase()}`;

export default function InboxExchangeSheet({
  open,
  order = null,
  tone = "dark",
  headers = undefined,
  picks = null,
  onRequestPick = null,
  onClose = null,
  onDone = null,
}) {
  const dark = tone !== "light";
  const [selection, setSelection] = useState({});
  const [replacement, setReplacement] = useState([]);
  const [freeShipping, setFreeShipping] = useState(true);
  const [reason, setReason] = useState(REASONS[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const consumedBatchRef = useRef("");

  useEffect(() => {
    if (!open) return;
    setSelection({});
    setReplacement([]);
    setFreeShipping(true);
    setReason(REASONS[0]);
    setError("");
    consumedBatchRef.current = "";
  }, [open, order?.id]);

  // The same product picker the order composer uses, so an exchange is picked exactly
  // like a sale - colour and size included.
  useEffect(() => {
    const batch = picks?.batch || "";
    const cards = asArray(picks?.cards);
    if (!open || !batch || !cards.length || consumedBatchRef.current === batch) return;
    consumedBatchRef.current = batch;
    setReplacement((current) => {
      const next = [...current];
      cards.forEach((card) => {
        const line = lineFromCard(card);
        if (!line.product_id) return;
        const existing = next.find((item) => lineKey(item) === lineKey(line));
        if (existing) existing.quantity += 1;
        else next.push(line);
      });
      return next;
    });
  }, [open, picks]);

  const returnable = useMemo(
    () => asArray(order?.items).filter((item) => Number(item.returnable_quantity || 0) > 0),
    [order]
  );
  const returning = useMemo(
    () => returnable
      .map((item) => ({ ...item, selected: Number(selection[item.id] || 0) }))
      .filter((item) => item.selected > 0),
    [returnable, selection]
  );
  const preview = useMemo(
    () => previewExchangeMoney({ returning, replacement, shippingCost: freeShipping ? 0 : Number(order?.shipping_fee || 0) }),
    [returning, replacement, freeShipping, order]
  );

  if (!open || !order) return null;

  const step = (itemId, delta, max) =>
    setSelection((current) => {
      const next = Math.max(0, Math.min(Number(max || 0), Number(current[itemId] || 0) + delta));
      return { ...current, [itemId]: next };
    });

  const submit = async () => {
    setError("");
    if (!returning.length) return setError("اختار القطعة اللي هترجع");
    if (!replacement.length) return setError("اختار المنتج البديل");
    setBusy(true);
    try {
      const response = await api.post(`/orders/${order.id}/exchange`, {
        reason,
        return_lines: returning.map((line) => ({ order_item_id: line.id, quantity: line.selected })),
        replacement: {
          lines: replacement.map((line) => ({
            product_id: line.product_id,
            variant_id: line.variant_id,
            color: line.color,
            size: line.size,
            quantity: line.quantity,
          })),
          // Explicit 0 is the shop deciding, not a missing figure: absent means "quote it".
          ...(freeShipping ? { shipping_cost: 0 } : {}),
        },
      }, { headers });
      onDone?.(response);
      onClose?.();
    } catch (err) {
      setError(err?.message || "تعذر إنشاء الاستبدال");
    } finally {
      setBusy(false);
    }
  };

  const shell = dark
    ? "border-white/10 bg-slate-950 text-white"
    : "border-[#E2E8F0] bg-white text-slate-900";
  const card = dark ? "border-white/10 bg-white/[0.04]" : "border-[#E2E8F0] bg-slate-50";
  const muted = dark ? "text-slate-400" : "text-slate-500";
  const chip = (active) =>
    active
      ? "border-amber-300/40 bg-amber-400/15 text-amber-100"
      : dark
        ? "border-white/10 bg-white/[0.04] text-slate-300"
        : "border-[#E2E8F0] bg-white text-slate-600";

  return (
    <div className="fixed inset-0 z-[120] flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4" dir="rtl">
      <div className={`flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl border sm:rounded-3xl ${shell}`}>
        <div className="flex items-center justify-between gap-3 border-b border-white/10 p-4">
          <div className="inline-flex items-center gap-2 text-sm font-black">
            <ArrowLeftRight className="h-4 w-4" />
            {LABELS.title} · {text(order.invoice_number)}
          </div>
          <button type="button" onClick={() => onClose?.()} className={`rounded-xl border p-2 ${card}`} aria-label={LABELS.cancel}>
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          <section>
            <div className={`mb-2 text-[11px] font-black uppercase tracking-[0.14em] ${muted}`}>{LABELS.returning}</div>
            <div className="space-y-2">
              {returnable.map((item) => {
                const selected = Number(selection[item.id] || 0);
                return (
                  <div key={item.id} className={`flex items-center gap-3 rounded-2xl border p-2 ${card}`}>
                    {item.image_url ? (
                      <img src={item.image_url} alt="" className="h-12 w-12 rounded-xl object-cover" />
                    ) : null}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-black">{item.product_name}</div>
                      <div className={`truncate text-xs ${muted}`}>
                        {[item.color, item.size].filter(Boolean).join(" · ")} · {money(item.unit_price)}
                      </div>
                    </div>
                    <div className="inline-flex items-center gap-1">
                      <button type="button" onClick={() => step(item.id, -1, item.returnable_quantity)} className={`rounded-lg border p-1 ${card}`} aria-label="-">
                        <Minus className="h-3.5 w-3.5" />
                      </button>
                      <span className="w-8 text-center text-sm font-black">{selected}</span>
                      <button type="button" onClick={() => step(item.id, 1, item.returnable_quantity)} className={`rounded-lg border p-1 ${card}`} aria-label="+">
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
              {returnable.length === 0 ? <div className={`rounded-xl border border-dashed p-3 text-xs ${muted}`}>{LABELS.empty}</div> : null}
            </div>
          </section>

          <section>
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className={`text-[11px] font-black uppercase tracking-[0.14em] ${muted}`}>{LABELS.replacement}</span>
              <button type="button" onClick={() => onRequestPick?.()} className={`rounded-xl border px-3 py-1.5 text-[11px] font-black ${card}`}>
                {LABELS.pick}
              </button>
            </div>
            <div className="space-y-2">
              {replacement.map((line) => (
                <div key={lineKey(line)} className={`flex items-center gap-3 rounded-2xl border p-2 ${card}`}>
                  {line.image_url ? <img src={line.image_url} alt="" className="h-12 w-12 rounded-xl object-cover" /> : null}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-black">{line.product_name}</div>
                    <div className={`truncate text-xs ${muted}`}>
                      {[line.color, line.size].filter(Boolean).join(" · ")} · {money(line.price)}
                    </div>
                  </div>
                  <div className="inline-flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setReplacement((current) => current.map((item) => (lineKey(item) === lineKey(line) ? { ...item, quantity: Math.max(1, item.quantity - 1) } : item)))}
                      className={`rounded-lg border p-1 ${card}`}
                      aria-label="-"
                    >
                      <Minus className="h-3.5 w-3.5" />
                    </button>
                    <span className="w-8 text-center text-sm font-black">{line.quantity}</span>
                    <button
                      type="button"
                      onClick={() => setReplacement((current) => current.map((item) => (lineKey(item) === lineKey(line) ? { ...item, quantity: item.quantity + 1 } : item)))}
                      className={`rounded-lg border p-1 ${card}`}
                      aria-label="+"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setReplacement((current) => current.filter((item) => lineKey(item) !== lineKey(line)))}
                      className={`rounded-lg border p-1 ${card}`}
                      aria-label={LABELS.cancel}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="flex flex-wrap items-center gap-2">
            {REASONS.map((item) => (
              <button key={item} type="button" onClick={() => setReason(item)} className={`rounded-xl border px-3 py-1.5 text-[11px] font-black ${chip(reason === item)}`}>
                {item}
              </button>
            ))}
          </section>

          <label className={`flex items-center gap-2 rounded-2xl border p-3 text-xs font-black ${card}`}>
            <input type="checkbox" checked={freeShipping} onChange={(event) => setFreeShipping(event.target.checked)} />
            {LABELS.freeShipping}
          </label>

          <section className={`grid grid-cols-3 gap-2 rounded-2xl border p-3 ${card}`}>
            <div>
              <div className={`text-[10px] font-black uppercase tracking-[0.12em] ${muted}`}>{LABELS.credit}</div>
              <div className="mt-1 text-xs font-black">{money(preview.credit)}</div>
            </div>
            <div>
              <div className={`text-[10px] font-black uppercase tracking-[0.12em] ${muted}`}>{LABELS.newTotal}</div>
              <div className="mt-1 text-xs font-black">{money(preview.new_total)}</div>
            </div>
            <div>
              <div className={`text-[10px] font-black uppercase tracking-[0.12em] ${muted}`}>
                {preview.remaining_credit > 0 ? LABELS.refundToWallet : LABELS.collect}
              </div>
              <div className="mt-1 text-xs font-black">
                {money(preview.remaining_credit > 0 ? preview.remaining_credit : preview.collect_on_delivery)}
              </div>
            </div>
          </section>

          <p className={`text-[11px] ${muted}`}>{LABELS.note}</p>
          {error ? <div className="rounded-xl border border-rose-300/25 bg-rose-400/10 p-2 text-[11px] font-black text-rose-100">{error}</div> : null}
        </div>

        <div className="flex items-center gap-2 border-t border-white/10 p-4">
          <button
            type="button"
            disabled={busy || !returning.length || !replacement.length}
            onClick={submit}
            className="inline-flex h-[var(--control-height-md)] flex-1 items-center justify-center gap-2 rounded-2xl bg-amber-400 px-4 text-sm font-black text-slate-950 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowLeftRight className="h-4 w-4" />}
            {busy ? LABELS.submitting : LABELS.submit}
          </button>
          <button type="button" onClick={() => onClose?.()} className={`h-[var(--control-height-md)] rounded-2xl border px-4 text-sm font-black ${card}`}>
            {LABELS.cancel}
          </button>
        </div>
      </div>
    </div>
  );
}
