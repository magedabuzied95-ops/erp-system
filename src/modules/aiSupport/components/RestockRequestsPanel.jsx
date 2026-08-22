import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Plus, Settings, ShoppingBag, SlidersHorizontal, Tags, XCircle } from "lucide-react";

import { api } from "../../../shared/api/api";
import { resolveProductImageUrl } from "../../../shared/lib/imageUrls.js";
import RestockWorkflowSettings from "./RestockWorkflowSettings.jsx";
import { useProductClassifications } from "../../products/hooks/useProductClassifications";
import { classificationGroupsToFieldOptions } from "../../products/lib/productClassifications";
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

  // ---- Criteria requests: "any men's mirror sneakers in 45", no product yet ----
  // The backend binds the row to the real variant when matching stock arrives.
  const CRITERIA_KEYS = ["gender", "product_type", "grade", "brand"];
  const CRITERIA_LABEL_KEY = { gender: "aiSupport.inbox.customer360.criteria_gender", product_type: "aiSupport.inbox.customer360.criteria_product_type", grade: "aiSupport.inbox.customer360.criteria_grade", brand: "aiSupport.inbox.customer360.criteria_brand" };
  const emptyCriteria = { gender: "", product_type: "", grade: "", brand: "", size: "" };
  const [criteriaForm, setCriteriaForm] = useState({ open: false, editingId: null, values: emptyCriteria, busy: false });
  const [criteriaOptions, setCriteriaOptions] = useState(null);
  const { groups: classificationGroups } = useProductClassifications({ includeInactive: false });
  const classificationLabels = useMemo(() => {
    const fields = classificationGroupsToFieldOptions(classificationGroups, {}, { includeInactive: true, includeCurrentValue: false });
    const map = { gender: new Map(), product_type: new Map(), grade: new Map() };
    const fill = (key, list) => (list || []).forEach((o) => { const v = String(o.value || o.id || "").trim().toLowerCase(); if (v) map[key].set(v, o.label_ar || o.label_en || o.label || v); });
    fill("gender", fields.gender); fill("product_type", fields.productType); fill("grade", fields.grade);
    return map;
  }, [classificationGroups]);
  const criteriaLabel = (key, value) => {
    const v = String(value || "").trim().toLowerCase();
    if (!v) return "";
    if (key === "brand") return String(value || "").trim();
    return classificationLabels[key]?.get(v) || String(value || "").trim();
  };
  const describeCriteria = (criteria = {}) =>
    [criteriaLabel("gender", criteria.gender), criteriaLabel("product_type", criteria.product_type), criteriaLabel("grade", criteria.grade), criteriaLabel("brand", criteria.brand), criteria.size ? `مقاس ${criteria.size}` : ""].filter(Boolean).join(" · ");
  const openCriteriaForm = (intent = null) => {
    setRestockMsg("");
    setCriteriaForm({ open: true, editingId: intent?.id || null, values: { ...emptyCriteria, ...(intent?.criteria || {}) }, busy: false });
    if (!criteriaOptions) {
      api.get("/ai-studio/restock-intents/criteria-options", { suppressErrorStatuses: [400, 403, 404, 500] })
        .then((res) => setCriteriaOptions({ gender: safeArray(res?.gender), product_type: safeArray(res?.product_type), grade: safeArray(res?.grade), brand: safeArray(res?.brand), sizes: safeArray(res?.sizes) }))
        .catch(() => setCriteriaOptions({ gender: [], product_type: [], grade: [], brand: [], sizes: [] }));
    }
  };
  const setCriteriaValue = (key, value) => setCriteriaForm((f) => ({ ...f, values: { ...f.values, [key]: f.values[key] === value ? "" : value } }));
  const criteriaValid = Boolean(clean(criteriaForm.values.size)) && CRITERIA_KEYS.some((key) => clean(criteriaForm.values[key]));
  const submitCriteria = async () => {
    if (!criteriaValid) { setRestockMsg(t("aiSupport.inbox.customer360.criteriaNeedsSizeAndOne")); return; }
    if (!restockPhone) { setRestockMsg("This customer has no phone on record."); return; }
    setCriteriaForm((f) => ({ ...f, busy: true })); setRestockMsg("");
    try {
      const criteria = Object.fromEntries(Object.entries(criteriaForm.values).filter(([, v]) => clean(v)));
      const res = await api.post("/ai-studio/restock-intents", { criteria, phone: restockPhone, customerId: customerId || null, source, sourceReference }, { suppressErrorStatuses: [400, 403, 404, 409, 500] });
      if (res?.success === false) { setRestockMsg(res?.message || "Failed"); setCriteriaForm((f) => ({ ...f, busy: false })); return; }
      if (res?.available_now) {
        const sample = safeArray(res?.matches).slice(0, 3).map((m) => `${clean(m.product_name)} (${[m.color, m.size].filter(Boolean).join(" / ")}) ×${m.stock}`).join("، ");
        setRestockMsg(`${t("aiSupport.inbox.customer360.criteriaAvailableNow")} ${sample}`);
        setCriteriaForm((f) => ({ ...f, busy: false }));
        return;
      }
      if (criteriaForm.editingId) {
        await api.post(`/ai-studio/restock-intents/${encodeURIComponent(criteriaForm.editingId)}/cancel`, {}, { suppressErrorStatuses: [400, 403, 404, 500] });
        setRestockMsg(t("aiSupport.inbox.customer360.restockEdited"));
      } else {
        setRestockMsg(res?.reused ? t("aiSupport.inbox.customer360.restockReusedCount", { count: 1 }) : t("aiSupport.inbox.customer360.restockCreatedCount", { count: 1 }));
      }
      setCriteriaForm({ open: false, editingId: null, values: emptyCriteria, busy: false });
      await loadRestockIntents();
    } catch (e) { setRestockMsg(e?.responseBody?.message || "Failed to create request"); setCriteriaForm((f) => ({ ...f, busy: false })); }
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
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={() => (criteriaForm.open ? setCriteriaForm((f) => ({ ...f, open: false })) : openCriteriaForm())} className={`inline-flex items-center gap-1 rounded-xl border px-2.5 py-1 text-[11px] font-black transition ${criteriaForm.open ? "border-[var(--primary)] bg-[var(--primary)]/15 text-[var(--primary)]" : "border-[var(--border)] bg-[var(--surface)] text-[var(--text)] hover:border-[var(--primary)] hover:text-[var(--primary)]"}`}>
            <SlidersHorizontal className="h-3.5 w-3.5" />{t("aiSupport.inbox.customer360.createCriteriaRequest")}
          </button>
          <button type="button" onClick={() => setRestockCreate((s) => ({ ...s, open: !s.open }))} className="inline-flex items-center gap-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-[11px] font-black text-[var(--text)] hover:border-[var(--primary)] hover:text-[var(--primary)]">{t("aiSupport.inbox.customer360.createRestockRequest")}</button>
        </div>
      </div>
      <RestockWorkflowSettings open={restockSettingsOpen} onClose={() => setRestockSettingsOpen(false)} />
      {restockMsg ? <div className="mt-2 rounded-xl bg-[var(--surface-soft)] px-3 py-1.5 text-xs font-semibold text-[var(--text-secondary)]">{restockMsg}</div> : null}
      {criteriaForm.open ? (
        <div className="mt-2 space-y-2 rounded-2xl border border-[var(--border)] bg-[var(--surface-soft)] p-3">
          <div className="text-xs text-[var(--muted)]">{t("aiSupport.inbox.customer360.criteriaHint")}</div>
          {!criteriaOptions ? (
            <div className="flex items-center gap-2 p-2 text-sm text-[var(--muted)]"><Loader2 className="h-4 w-4 animate-spin" />{t("aiSupport.inbox.customer360.loading")}</div>
          ) : (
            <>
              {CRITERIA_KEYS.map((key) => (
                <div key={key} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2">
                  <div className="text-[10px] font-black uppercase tracking-[0.12em] text-[var(--muted)]">{t(CRITERIA_LABEL_KEY[key])}</div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {safeArray(criteriaOptions[key]).length === 0 ? <span className="text-[11px] text-[var(--muted)]">—</span> : null}
                    {safeArray(criteriaOptions[key]).map((option) => {
                      const active = clean(criteriaForm.values[key]).toLowerCase() === option.value;
                      return (
                        <button key={option.value} type="button" onClick={() => setCriteriaValue(key, option.value)} className={`rounded-lg border px-2.5 py-1 text-[11px] font-black transition ${active ? "border-[var(--primary)] bg-[var(--primary)] text-[#171714]" : "border-[var(--border)] bg-[var(--surface-soft)] text-[var(--text)] hover:border-[var(--primary)]"}`}>
                          {criteriaLabel(key, option.value)}<span className={`ms-1 text-[9px] ${active ? "text-[#171714]/70" : "text-[var(--muted)]"}`}>{option.count}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2">
                <div className="text-[10px] font-black uppercase tracking-[0.12em] text-[var(--muted)]">{t("aiSupport.inbox.customer360.criteria_size")} *</div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {safeArray(criteriaOptions.sizes).map((size) => {
                    const active = clean(criteriaForm.values.size).toLowerCase() === String(size).toLowerCase();
                    return (
                      <button key={size} type="button" onClick={() => setCriteriaForm((f) => ({ ...f, values: { ...f.values, size: active ? "" : size } }))} className={`min-w-10 rounded-lg border px-2 py-1 text-center text-[12px] font-black transition ${active ? "border-[var(--primary)] bg-[var(--primary)] text-[#171714]" : "border-[var(--border)] bg-[var(--surface-soft)] text-[var(--text)] hover:border-[var(--primary)]"}`}>{size}</button>
                    );
                  })}
                </div>
              </div>
              <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs font-black text-[var(--text)]">
                {describeCriteria(criteriaForm.values) || t("aiSupport.inbox.customer360.criteriaEmptySummary")}
              </div>
            </>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setCriteriaForm({ open: false, editingId: null, values: emptyCriteria, busy: false })} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-black text-[var(--text-secondary)]">{t("aiSupport.inbox.customer360.cancel")}</button>
            <button type="button" onClick={submitCriteria} disabled={criteriaForm.busy || !criteriaValid || !criteriaOptions} className="inline-flex items-center gap-1 rounded-lg border border-[var(--primary)] bg-[var(--primary)]/10 px-3 py-1.5 text-xs font-black text-[var(--primary)] disabled:opacity-50">{criteriaForm.busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}{criteriaForm.editingId ? t("aiSupport.inbox.customer360.restockEdit") : t("aiSupport.inbox.customer360.confirmCreate")}</button>
          </div>
        </div>
      ) : null}
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
          const isCriteria = Boolean(i.criteria) && !i.product_id;
          const wasCriteria = Boolean(i.criteria) && Boolean(i.product_id);
          return (
          <div key={i.id} className="flex items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface-soft)] p-2.5">
            <div className="m1-restock-thumb h-14 w-14 shrink-0 overflow-visible rounded-xl border border-[var(--border)] bg-[var(--surface)]">
              {intentImage ? <img src={intentImage} alt="" loading="lazy" /> : isCriteria ? <div className="grid h-full w-full place-items-center text-[var(--muted)]"><Tags className="h-5 w-5" /></div> : null}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-black text-[var(--text)]">{isCriteria ? describeCriteria(i.criteria) : clean(i.product_name) || `Product #${i.product_id}`}</div>
              <div className="mt-0.5 text-xs text-[var(--muted)]">{isCriteria ? t("aiSupport.inbox.customer360.criteriaWaitingHint") : i.variant_id ? [i.color, i.size ? `Size ${i.size}` : ""].filter(Boolean).join(" · ") || `Variant #${i.variant_id}` : "Product-level — requested size unknown"}{wasCriteria ? ` · ${t("aiSupport.inbox.customer360.criteriaMatchedFrom", { criteria: describeCriteria(i.criteria) })}` : ""} · {formatDateTime(i.created_at)}</div>
              <div className="mt-0.5 flex items-center gap-1.5">
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-black uppercase ${isCriteria ? "bg-sky-100 text-sky-700" : i.variant_id ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{isCriteria ? t("aiSupport.inbox.customer360.criteriaBadge") : i.variant_id ? "Exact variant" : "Legacy product-level"}</span>
                <span className="text-[10px] font-bold text-[var(--text-secondary)]">{i.status}</span>
                <span className="text-[10px] text-[var(--muted)]">{i.source}</span>
              </div>
            </div>
            <div className="flex shrink-0 flex-col gap-1">
              {intentActive ? (
                <>
                  <button type="button" onClick={() => (isCriteria ? openCriteriaForm(i) : editRestockIntent(i))} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-[11px] font-black text-[var(--text)] hover:border-[var(--primary)] hover:text-[var(--primary)]">{t("aiSupport.inbox.customer360.restockEdit")}</button>
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
