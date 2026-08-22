import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Plus, Settings, ShoppingBag, XCircle } from "lucide-react";

import { api } from "../../../shared/api/api";
import { resolveProductImageUrl } from "../../../shared/lib/imageUrls.js";
import RestockWorkflowSettings from "./RestockWorkflowSettings.jsx";
// The create form reuses the order composer's products section (ai-order__*),
// the thumbnail hover-zoom lives in the drawer stylesheet.
import "../pages/AiInboxOrderComposer.m1.css";
import "./Customer360Drawer.css";

const clean = (value = "") => String(value ?? "").trim();
const safeArray = (value) => (Array.isArray(value) ? value : []);
const formatDateTime = (value = "") => {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
};

/**
 * One restock-requests surface for every host (customer 360 drawer, POS):
 * the list of a customer's requests with colour photos, the order-style create
 * cart, edit/cancel/delete, and the gear that opens the workflow settings modal.
 * The host owns the catalogue picker: it calls onRequestPick, then hands the
 * chosen cards back through restockPick (a fresh object per hand-over).
 */
export default function RestockRequestsPanel({
  phone = "",
  customerId = null,
  onRequestPick = null,
  restockPick = null,
  onClearRestockPick = null,
  source = "ai_inbox",
  sourceReference = null,
  title = null,
  className = "",
}) {
  const { t } = useTranslation();
  const restockPhone = clean(phone);
  const [restockIntents, setRestockIntents] = useState([]);
  const [restockLoading, setRestockLoading] = useState(false);
  const [restockMsg, setRestockMsg] = useState("");
  const [restockCreate, setRestockCreate] = useState({ open: false, lines: [], busy: false });
  const [restockSettingsOpen, setRestockSettingsOpen] = useState(false);
  const restockLineKey = (line = {}) => `${line.product_id || ""}:${line.variant_id || ""}:${clean(line.color)}:${clean(line.size)}`;

  const loadRestockIntents = async () => {
    if (!restockPhone) { setRestockIntents([]); return; }
    setRestockLoading(true);
    try {
      const res = await api.get(`/ai-studio/restock-intents`, { params: { phone: restockPhone }, perfComponent: "RestockRequestsPanel", suppressErrorStatuses: [400, 403, 404, 500] });
      setRestockIntents(safeArray(res?.intents));
    } catch { setRestockIntents([]); }
    setRestockLoading(false);
  };
  useEffect(() => { if (restockPhone) void loadRestockIntents(); /* one fetch per open+customer */ // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restockPhone]);

  const cancelRestockIntent = async (id) => {
    if (!window.confirm(t("aiSupport.inbox.customer360.cancelRestockConfirm"))) return;
    try { await api.post(`/ai-studio/restock-intents/${encodeURIComponent(id)}/cancel`, {}, { suppressErrorStatuses: [400, 403, 404, 500] }); await loadRestockIntents(); }
    catch (e) { setRestockMsg(e?.responseBody?.message || "Failed to cancel"); }
  };
  // Finished rows (cancelled / notified / fulfilled) can be removed outright; an
  // active one has to be cancelled first so the audit trail keeps it.
  const deleteRestockIntent = async (id) => {
    if (!window.confirm(t("aiSupport.inbox.customer360.deleteRestockConfirm"))) return;
    try { await api.delete(`/ai-studio/restock-intents/${encodeURIComponent(id)}`, { suppressErrorStatuses: [400, 403, 404, 409, 500] }); await loadRestockIntents(); }
    catch (e) { setRestockMsg(e?.responseBody?.message || "Failed to delete"); }
  };
  // "Edit" = pick a different colour/size; the old request is cancelled only once
  // the new one exists, so a closed picker changes nothing.
  const [restockEditingId, setRestockEditingId] = useState(null);
  const editRestockIntent = (intent) => { setRestockEditingId(intent.id); onRequestPick?.(); };
  const applyRestockEdit = async (intentId, card) => {
    const productId = Number(card?.product_id), variantId = Number(card?.variant_id);
    if (!productId || !variantId) { setRestockMsg(t("aiSupport.inbox.customer360.restockNeedsVariant")); return; }
    try {
      const res = await api.post(`/ai-studio/restock-intents`, { productId, variantId, phone: restockPhone, customerId: customerId || null, source, sourceReference }, { suppressErrorStatuses: [400, 403, 404, 409, 500] });
      if (res?.available_now) { setRestockMsg(t("aiSupport.inbox.customer360.restockAvailableNowCount", { count: 1 })); return; }
      await api.post(`/ai-studio/restock-intents/${encodeURIComponent(intentId)}/cancel`, {}, { suppressErrorStatuses: [400, 403, 404, 500] });
      setRestockMsg(t("aiSupport.inbox.customer360.restockEdited"));
      await loadRestockIntents();
    } catch (e) { setRestockMsg(e?.responseBody?.message || "Failed to edit"); }
  };
  // Explicit, human-confirmed create. Variant is REQUIRED (no fake exact intent). Never autonomous.
  // One request per line, like the order composer's cart: the backend has no batch
  // endpoint, so the lines go one by one and a failed line stays in the form.
  const submitRestockCreate = async () => {
    const lines = restockCreate.lines;
    // The variant is what makes the request actionable — it names the size to
    // watch. The picker can hand back a product with no colour/size chosen, so
    // this stays a hard gate rather than falling back to a product-level row.
    if (!lines.length || lines.some((line) => !Number(line.product_id) || !Number(line.variant_id))) { setRestockMsg(t("aiSupport.inbox.customer360.restockNeedsVariant")); return; }
    if (!restockPhone) { setRestockMsg("This customer has no phone on record."); return; }
    setRestockCreate((s) => ({ ...s, busy: true })); setRestockMsg("");
    const failed = [];
    let created = 0, reused = 0, availableNow = 0;
    for (const line of lines) {
      try {
        const res = await api.post(`/ai-studio/restock-intents`, { productId: Number(line.product_id), variantId: Number(line.variant_id), phone: restockPhone, customerId: customerId || null, source, sourceReference }, { suppressErrorStatuses: [400, 403, 404, 409, 500] });
        if (res?.available_now) availableNow += 1;
        else if (res?.reused) reused += 1;
        else created += 1;
      } catch (e) {
        failed.push({ line, message: e?.responseBody?.message || "" });
      }
    }
    const parts = [];
    if (created) parts.push(t("aiSupport.inbox.customer360.restockCreatedCount", { count: created }));
    if (reused) parts.push(t("aiSupport.inbox.customer360.restockReusedCount", { count: reused }));
    if (availableNow) parts.push(t("aiSupport.inbox.customer360.restockAvailableNowCount", { count: availableNow }));
    if (failed.length) parts.push(`${t("aiSupport.inbox.customer360.restockFailedCount", { count: failed.length })}${failed[0].message ? ` — ${failed[0].message}` : ""}`);
    setRestockMsg(parts.join(" · "));
    if (failed.length) {
      setRestockCreate({ open: true, lines: failed.map((f) => f.line), busy: false });
    } else {
      setRestockCreate({ open: false, lines: [], busy: false });
      onClearRestockPick?.();
    }
    await loadRestockIntents();
  };

  // A pick arriving from the inbox picker also re-opens the create form: the
  // picker covers the drawer, so collapsing it on the way back would drop the
  // product the user just chose. Picks append (deduped per variant) so the form
  // fills up the way the order composer's cart does.
  useEffect(() => {
    if (!restockPick) return;
    const incoming = safeArray(restockPick.cards ?? (restockPick.product_id ? [restockPick] : []));
    if (!incoming.length) return;
    if (restockEditingId) {
      const editing = restockEditingId;
      setRestockEditingId(null);
      onClearRestockPick?.();
      void applyRestockEdit(editing, incoming[0]);
      return;
    }
    setRestockCreate((current) => {
      const seen = new Set(current.lines.map(restockLineKey));
      const appended = incoming.filter((card) => { const key = restockLineKey(card); if (seen.has(key)) return false; seen.add(key); return true; });
      return { ...current, open: true, lines: [...current.lines, ...appended] };
    });
    setRestockMsg("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restockPick]);

  return (
    <div className={`m1-customer-products-section rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[0_8px_24px_rgba(15,23,42,0.04)] ${className}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <div className="text-[11px] font-black uppercase tracking-[0.16em] text-[var(--muted)]">{title || t("aiSupport.inbox.customer360.restockRequests")}</div>
          <button type="button" aria-label={t("aiSupport.inbox.customer360.restockSettingsTitle")} title={t("aiSupport.inbox.customer360.restockSettingsTitle")} onClick={() => setRestockSettingsOpen((v) => !v)} className={`grid h-7 w-7 place-items-center rounded-lg border transition ${restockSettingsOpen ? "border-[var(--primary)] bg-[var(--primary)]/15 text-[var(--primary)]" : "border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] hover:border-[var(--primary)] hover:text-[var(--primary)]"}`}>
            <Settings className="h-3.5 w-3.5" />
          </button>
        </div>
        <button type="button" onClick={() => setRestockCreate((s) => ({ ...s, open: !s.open }))} className="inline-flex items-center gap-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-[11px] font-black text-[var(--text)] hover:border-[var(--primary)] hover:text-[var(--primary)]">{t("aiSupport.inbox.customer360.createRestockRequest")}</button>
      </div>
      <RestockWorkflowSettings open={restockSettingsOpen} onClose={() => setRestockSettingsOpen(false)} />
      {restockMsg ? <div className="mt-2 rounded-xl bg-[var(--surface-soft)] px-3 py-1.5 text-xs font-semibold text-[var(--text-secondary)]">{restockMsg}</div> : null}
      {restockCreate.open ? (
        <div className="mt-2 space-y-2 rounded-2xl border border-[var(--border)] bg-[var(--surface-soft)] p-3">
          <div className="text-xs text-[var(--muted)]">{t("aiSupport.inbox.customer360.restockHint")}</div>
          {/*
           * The two numeric ID fields this replaces asked staff to copy a
           * product id AND a variant id off a card mid-conversation. The
           * variant is mandatory here — a request without one cannot say
           * which size to watch — and it is the id nobody has to hand.
           * The catalogue picker returns both, with the colour and size
           * chosen visually.
           */}
          {/* Same products section as the order composer (ai-order__* classes) so
              staff meet one cart UI: add from the catalogue, pick several, remove a line. */}
          <div className="ai-order__group p-3">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="ai-order__group-title flex items-center gap-2"><ShoppingBag className="ai-order__group-icon h-4 w-4" />{t("aiSupport.inbox.order.productsSection")}</div>
              <button type="button" onClick={() => onRequestPick?.()} className="ai-order__add inline-flex items-center gap-2 px-3">
                <Plus className="h-4 w-4" />{t("aiSupport.inbox.order.addProduct")}
              </button>
            </div>
            {restockCreate.lines.length === 0 ? (
              <button type="button" onClick={() => onRequestPick?.()} className="ai-order__empty w-full p-6 text-center">
                {t("aiSupport.inbox.customer360.restockChooseFromCatalog")}
              </button>
            ) : (
              <div className="space-y-2">
                {restockCreate.lines.map((line) => (
                  <div key={restockLineKey(line)} className="ai-order__line flex items-center gap-3 p-2">
                    <div className="ai-order__line-thumb h-12 w-12 shrink-0 overflow-hidden">
                      {line.image_url ? <img src={line.image_url} alt="" className="h-full w-full object-contain" /> : null}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="ai-order__line-name truncate">{clean(line.product_name) || `#${line.product_id}`}</div>
                      <div className={`ai-order__line-meta truncate${line.variant_id ? "" : " text-amber-600"}`}>
                        {line.variant_id ? [clean(line.color), clean(line.size)].filter(Boolean).join(" / ") || "—" : t("aiSupport.inbox.customer360.restockPickVariant")}
                      </div>
                    </div>
                    <button type="button" aria-label={t("aiSupport.inbox.order.removeLine")} onClick={() => setRestockCreate((s) => ({ ...s, lines: s.lines.filter((item) => restockLineKey(item) !== restockLineKey(line)) }))} className="ai-order__line-remove grid h-9 w-9 shrink-0 place-items-center">
                      <XCircle className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => { setRestockCreate({ open: false, lines: [], busy: false }); onClearRestockPick?.(); }} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-black text-[var(--text-secondary)]">{t("aiSupport.inbox.customer360.cancel")}</button>
            <button type="button" onClick={submitRestockCreate} disabled={restockCreate.busy || !restockCreate.lines.length || restockCreate.lines.some((line) => !line.variant_id)} className="inline-flex items-center gap-1 rounded-lg border border-[var(--primary)] bg-[var(--primary)]/10 px-3 py-1.5 text-xs font-black text-[var(--primary)] disabled:opacity-50">{restockCreate.busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}{restockCreate.lines.length > 1 ? t("aiSupport.inbox.customer360.confirmCreateCount", { count: restockCreate.lines.length }) : t("aiSupport.inbox.customer360.confirmCreate")}</button>
          </div>
        </div>
      ) : null}
      <div className="mt-3 space-y-2">
        {restockLoading ? (
          <div className="flex items-center gap-2 p-2 text-sm text-[var(--muted)]"><Loader2 className="h-4 w-4 animate-spin" />{t("aiSupport.inbox.customer360.loading")}</div>
        ) : restockIntents.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface-soft)] p-4 text-sm text-[var(--muted)]">{t("aiSupport.inbox.customer360.noRestockRequests")}</div>
        ) : restockIntents.map((i) => {
          const intentImage = resolveProductImageUrl(i.image_url || "");
          const intentActive = ["waiting", "recovery_created"].includes(i.status);
          return (
          <div key={i.id} className="flex items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface-soft)] p-2.5">
            <div className="m1-restock-thumb h-14 w-14 shrink-0 overflow-visible rounded-xl border border-[var(--border)] bg-[var(--surface)]">
              {intentImage ? <img src={intentImage} alt="" loading="lazy" /> : null}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-black text-[var(--text)]">{clean(i.product_name) || `Product #${i.product_id}`}</div>
              <div className="mt-0.5 text-xs text-[var(--muted)]">{i.variant_id ? [i.color, i.size ? `Size ${i.size}` : ""].filter(Boolean).join(" · ") || `Variant #${i.variant_id}` : "Product-level — requested size unknown"} · {formatDateTime(i.created_at)}</div>
              <div className="mt-0.5 flex items-center gap-1.5">
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-black uppercase ${i.variant_id ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{i.variant_id ? "Exact variant" : "Legacy product-level"}</span>
                <span className="text-[10px] font-bold text-[var(--text-secondary)]">{i.status}</span>
                <span className="text-[10px] text-[var(--muted)]">{i.source}</span>
              </div>
            </div>
            <div className="flex shrink-0 flex-col gap-1">
              {intentActive ? (
                <>
                  <button type="button" onClick={() => editRestockIntent(i)} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-[11px] font-black text-[var(--text)] hover:border-[var(--primary)] hover:text-[var(--primary)]">{t("aiSupport.inbox.customer360.restockEdit")}</button>
                  <button type="button" onClick={() => cancelRestockIntent(i.id)} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-[11px] font-black text-[var(--text)] hover:border-rose-300 hover:text-rose-500">{t("aiSupport.inbox.customer360.cancel")}</button>
                </>
              ) : (
                <button type="button" onClick={() => deleteRestockIntent(i.id)} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-[11px] font-black text-[var(--text)] hover:border-rose-300 hover:text-rose-500">{t("aiSupport.inbox.customer360.restockDelete")}</button>
              )}
            </div>
          </div>
          );
        })}
      </div>
      <div className="mt-2 text-[10px] text-[var(--muted)]">{t("aiSupport.inbox.customer360.restockNotice")}</div>
    </div>
  );
}
