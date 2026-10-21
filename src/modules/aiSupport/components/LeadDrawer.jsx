import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import {
  CalendarDays,
  Check,
  CheckCircle2,
  FileText,
  Loader2,
  MousePointerClick,
  Package,
  Pencil,
  Save,
  ShoppingBag,
  Star,
  UserRound,
  X,
  XCircle,
} from "lucide-react";
import { api } from "../../../shared/api/api";
import { aiInboxConversationEndpoint } from "../lib/conversationHelpers";
import { aiInboxLabelsFromConversation } from "../../../../shared/aiInboxConversationLabels.js";
import { CampaignAttributionCard, useConversationAttribution } from "./CampaignAttribution.jsx";
import { resolveProductImageUrl } from "../../../shared/lib/imageUrls";

/*
 * Genie's "Leads" form for the open conversation, shaped for a shoe shop.
 *
 * Top: Save, the order count (opens Customer 360's orders) and the ad clicks;
 * تم البيع / خسارة, طلب جديد, ابعت قالب; the stage bar. Fields: lead name,
 * customer, phone, owner, expected revenue (suggested from the customer's live
 * orders), success probability (from the stage), priority, expected closing,
 * labels. Tabs: notes, contact, the customer's orders and the shoes they bought,
 * campaign tracking, lost reason, ad clicks. Bottom: log a note (an internal
 * note in the thread).
 *
 * The stage moves through the inbox's own stage route (it may start a stage's
 * follow-up sequence, as a hand-picked stage always has); the other fields save
 * to the conversation (PATCH /conversations/:id/lead).
 */

// Genie's form widens and narrows by dragging its edge; the width is kept per browser.
const WIDTH_STORAGE_KEY = "m1.inbox.leadDrawerWidth";
const MIN_WIDTH = 440;
const readWidth = () => {
  try {
    const value = Number(window.localStorage.getItem(WIDTH_STORAGE_KEY));
    return Number.isFinite(value) && value >= MIN_WIDTH ? value : 980;
  } catch {
    return 980;
  }
};

const STAGE_PROBABILITY = { new: 10, contacted: 25, interested: 45, negotiation: 70, won: 100, lost: 0 };
const LOST_REASONS = ["price", "size_unavailable", "color_unavailable", "bought_elsewhere", "shipping", "no_reply", "not_serious", "other"];
const clean = (value) => String(value ?? "").trim();
const money = (value) => {
  const number = Number(value) || 0;
  try {
    return new Intl.NumberFormat("en-EG", { maximumFractionDigits: 0 }).format(number);
  } catch {
    return String(Math.round(number));
  }
};
const dayOf = (value) => {
  const date = new Date(value || 0);
  if (Number.isNaN(date.getTime()) || date.getTime() <= 0) return "";
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Cairo", day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
};

function Field({ label, children }) {
  return (
    <div className="grid grid-cols-[8.5rem_minmax(0,1fr)] items-center gap-3 py-2">
      <div className="text-sm font-bold text-text">{label}</div>
      <div className="min-w-0 text-sm text-text">{children}</div>
    </div>
  );
}

export default function LeadDrawer({
  open = false,
  conversation = null,
  headers,
  customerName = "",
  stageOptions = [],
  currentStage = "",
  onClose,
  onStageChange,
  onCreateOrder,
  onSendTemplate,
  onOpenOrders,
  onAssign,
  onEditLabels,
  onLogNote,
  onNotice,
}) {
  const { t } = useTranslation();
  const sessionId = clean(conversation?.session_id || conversation?.conversation_id);
  const [lead, setLead] = useState(null);
  const [details, setDetails] = useState({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState("notes");
  const [note, setNote] = useState("");
  const [noting, setNoting] = useState(false);
  const [lostPrompt, setLostPrompt] = useState(false);
  const [width, setWidth] = useState(readWidth);
  const startResize = (event) => {
    event.preventDefault();
    const pointerId = event.pointerId;
    const handle = event.currentTarget;
    handle.setPointerCapture?.(pointerId);
    const move = (moveEvent) => {
      // The drawer hugs the right edge, so its width is the distance from there.
      const next = Math.max(MIN_WIDTH, Math.min(window.innerWidth - 40, window.innerWidth - moveEvent.clientX));
      setWidth(next);
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      setWidth((current) => {
        try { window.localStorage.setItem(WIDTH_STORAGE_KEY, String(Math.round(current))); } catch { /* per-browser nicety only */ }
        return current;
      });
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  };
  const attribution = useConversationAttribution(open ? conversation : null);
  const clicks = Array.isArray(attribution?.clicks) ? attribution.clicks : [];
  const labels = useMemo(() => aiInboxLabelsFromConversation(conversation || {}), [conversation]);

  useEffect(() => {
    if (!open || !sessionId) return undefined;
    let alive = true;
    setLead(null);
    setDirty(false);
    setTab("notes");
    setLostPrompt(false);
    api.get(aiInboxConversationEndpoint(sessionId, "/lead"), { headers, suppressErrorStatuses: [404, 500, 502, 503] })
      .then((payload) => {
        if (!alive) return;
        setLead(payload?.lead || {});
        setDetails(payload?.lead?.details || {});
      })
      .catch(() => { if (alive) { setLead({}); setDetails({}); } });
    return () => { alive = false; };
  }, [headers, open, sessionId]);

  if (!open || !conversation) return null;

  const stage = clean(currentStage) || "";
  const probability = STAGE_PROBABILITY[stage] ?? 0;
  const suggestedRevenue = lead?.orders_summary?.total || 0;
  const set = (patch) => { setDetails((current) => ({ ...current, ...patch })); setDirty(true); };
  const save = async (extra = {}) => {
    setSaving(true);
    try {
      const payload = await api.patch(aiInboxConversationEndpoint(sessionId, "/lead"), { ...details, ...extra }, { headers });
      setDetails(payload?.details || { ...details, ...extra });
      setDirty(false);
      onNotice?.("emerald", t("aiSupport.inbox.lead.saved"));
      return true;
    } catch (err) {
      onNotice?.("rose", err?.message || t("aiSupport.inbox.lead.saveFailed"));
      return false;
    } finally {
      setSaving(false);
    }
  };
  const markLost = async () => {
    if (!clean(details.lost_reason)) {
      setTab("lost");
      setLostPrompt(true);
      return;
    }
    if (await save()) onStageChange?.("lost");
  };
  const logNote = async () => {
    const text = clean(note);
    if (!text || noting) return;
    setNoting(true);
    try {
      await onLogNote?.(text);
      setNote("");
    } finally {
      setNoting(false);
    }
  };

  const tabs = [
    ["notes", t("aiSupport.inbox.lead.tabs.notes")],
    ["contact", t("aiSupport.inbox.lead.tabs.contact")],
    ["orders", t("aiSupport.inbox.lead.tabs.orders")],
    ["campaign", t("aiSupport.inbox.lead.tabs.campaign")],
    ["lost", t("aiSupport.inbox.lead.tabs.lost")],
    ["clicks", t("aiSupport.inbox.lead.tabs.clicks")],
  ];

  return createPortal(
    // dir="ltr" on the backdrop only pins the drawer to the right edge in both
    // languages (Genie); the drawer itself follows the page's direction.
    <div dir="ltr" className="fixed inset-0 z-[1150] flex justify-end bg-black/35" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose?.(); }}>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t("aiSupport.inbox.lead.resize")}
        onPointerDown={startResize}
        data-lead-drawer-resize="true"
        className="group relative z-10 -me-1.5 w-3 shrink-0 cursor-col-resize touch-none"
      >
        <span className="absolute inset-y-0 start-1/2 w-0.5 -translate-x-1/2 bg-border transition group-hover:bg-primary" />
      </div>
      <div role="dialog" dir={typeof document !== "undefined" ? document.documentElement.dir || "ltr" : "ltr"} aria-label={t("aiSupport.inbox.lead.title")} style={{ width: Math.min(width, typeof window !== "undefined" ? window.innerWidth : width) }} className="flex h-full max-w-full flex-col overflow-hidden border-s border-border bg-surface text-text shadow-2xl">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3">
          <button type="button" onClick={onClose} aria-label={t("aiSupport.inbox.lead.close")} className="grid h-9 w-9 place-items-center rounded-lg text-text-muted hover:bg-surface-hover">
            <X className="h-5 w-5" />
          </button>
          <h2 className="truncate text-xl font-bold">{t("aiSupport.inbox.lead.title")} — {customerName}</h2>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2 px-4 pt-3">
          <button type="button" onClick={() => save()} disabled={!dirty || saving} className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-bold text-primary-foreground disabled:opacity-45">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {t("aiSupport.inbox.lead.save")}
          </button>
          <span className="ms-auto" />
          <button type="button" onClick={onOpenOrders} className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-surface-soft px-3 text-sm font-semibold hover:bg-surface-hover">
            <ShoppingBag className="h-4 w-4 text-primary" />
            {t("aiSupport.inbox.lead.orders")}
            <span className="rounded-full bg-primary-subtle px-2 text-xs font-black text-primary">{lead ? lead.orders_summary?.count || 0 : "…"}</span>
          </button>
          <button type="button" onClick={() => setTab("clicks")} className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-surface-soft px-3 text-sm font-semibold hover:bg-surface-hover">
            <MousePointerClick className="h-4 w-4 text-sky-500" />
            {t("aiSupport.inbox.lead.adClicks")}
            <span className="rounded-full bg-primary-subtle px-2 text-xs font-black text-primary">{clicks.length}</span>
          </button>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2 px-4 py-3">
          <button type="button" onClick={() => onStageChange?.("won")} disabled={stage === "won"} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 text-sm font-bold text-emerald-600 disabled:opacity-50">
            <CheckCircle2 className="h-4 w-4" />{t("aiSupport.inbox.lead.markWon")}
          </button>
          <button type="button" onClick={markLost} disabled={stage === "lost"} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 text-sm font-bold text-rose-600 disabled:opacity-50">
            <XCircle className="h-4 w-4" />{t("aiSupport.inbox.lead.markLost")}
          </button>
          {onCreateOrder ? (
            <button type="button" onClick={onCreateOrder} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-semibold hover:bg-surface-hover">
              <Package className="h-4 w-4" />{t("aiSupport.inbox.lead.newOrder")}
            </button>
          ) : null}
          {onSendTemplate ? (
            <button type="button" onClick={onSendTemplate} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-semibold hover:bg-surface-hover">
              <FileText className="h-4 w-4" />{t("aiSupport.inbox.lead.sendTemplate")}
            </button>
          ) : null}
          <div role="radiogroup" aria-label={t("aiSupport.inbox.lead.stage")} className="ms-auto flex flex-wrap overflow-hidden rounded-lg border border-border">
            {stageOptions.map((option) => {
              const on = option.id === stage;
              const passed = (STAGE_PROBABILITY[option.id] ?? 0) < probability && stage !== "lost" && option.id !== "lost";
              return (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => (option.id === "lost" ? markLost() : onStageChange?.(option.id))}
                  className={`inline-flex h-9 items-center gap-1 px-3 text-sm font-semibold transition ${on ? "bg-primary text-primary-foreground" : passed ? "bg-primary-subtle text-primary" : "text-text-muted hover:bg-surface-hover"}`}
                >
                  {passed ? <Check className="h-3.5 w-3.5" /> : null}
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          {!lead ? (
            <div className="flex items-center justify-center gap-2 py-16 text-text-muted"><Loader2 className="h-5 w-5 animate-spin" />{t("aiSupport.inbox.lead.loading")}</div>
          ) : (
            <>
              <div className="grid gap-x-10 rounded-2xl border border-border p-4 md:grid-cols-2">
                <div>
                  <Field label={t("aiSupport.inbox.lead.leadName")}>
                    <input dir="auto" value={details.lead_name ?? ""} onChange={(event) => set({ lead_name: event.target.value })} placeholder={t("aiSupport.inbox.lead.leadNameDefault", { name: customerName })} className="h-9 w-full rounded-lg border border-transparent bg-transparent px-2 hover:border-border focus:border-primary focus:outline-none" />
                  </Field>
                  <Field label={t("aiSupport.inbox.lead.customer")}><span dir="auto">{customerName}</span></Field>
                  <Field label={t("aiSupport.inbox.lead.phone")}><span dir="ltr">{lead.phone || "—"}</span></Field>
                  <Field label={t("aiSupport.inbox.lead.owner")}>
                    <span className="flex items-center gap-2">
                      <UserRound className="h-4 w-4 text-text-muted" />
                      <span className="truncate">{clean(conversation.assigned_user_name || conversation.assigned_user?.name) || t("aiSupport.inbox.filterPanel.unassigned")}</span>
                      {onAssign ? <button type="button" onClick={onAssign} className="text-xs font-bold text-primary hover:underline">{t("aiSupport.inbox.crmCard.reassign")}</button> : null}
                    </span>
                  </Field>
                </div>
                <div>
                  <Field label={t("aiSupport.inbox.lead.expectedRevenue")}>
                    <span className="flex items-center gap-2">
                      <input type="number" min="0" dir="ltr" value={details.expected_revenue ?? ""} onChange={(event) => set({ expected_revenue: event.target.value })} placeholder={suggestedRevenue ? String(Math.round(suggestedRevenue)) : "0"} className="h-9 w-32 rounded-lg border border-border bg-surface-soft px-2 focus:border-primary focus:outline-none" />
                      {suggestedRevenue ? <span className="text-xs text-text-muted">{t("aiSupport.inbox.lead.fromOrders", { amount: money(suggestedRevenue) })}</span> : null}
                    </span>
                  </Field>
                  <Field label={t("aiSupport.inbox.lead.probability")}>
                    <span className="flex items-center gap-2">
                      <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-surface-soft"><span className="block h-full rounded-full bg-gradient-to-r from-rose-500 to-emerald-500" style={{ width: `${probability}%` }} /></span>
                      <span className="w-10 text-end text-xs font-bold">{probability}%</span>
                    </span>
                  </Field>
                  <Field label={t("aiSupport.inbox.lead.priority")}>
                    <span className="flex items-center gap-1">
                      {[1, 2, 3, 4, 5].map((value) => (
                        <button key={value} type="button" onClick={() => set({ priority: Number(details.priority) === value ? 0 : value })} aria-label={String(value)}>
                          <Star className={`h-5 w-5 ${Number(details.priority) >= value ? "fill-amber-400 text-amber-400" : "text-text-muted"}`} />
                        </button>
                      ))}
                    </span>
                  </Field>
                  <Field label={t("aiSupport.inbox.lead.expectedClosing")}>
                    <span className="relative flex h-9 w-44 items-center overflow-hidden rounded-lg border border-border bg-surface-soft">
                      <CalendarDays className="pointer-events-none absolute start-2 h-4 w-4 text-text-muted" />
                      <input type="date" value={details.expected_closing || ""} onChange={(event) => set({ expected_closing: event.target.value })} className="absolute inset-0 h-full w-full appearance-none bg-transparent ps-8 pe-2 text-sm outline-none" style={{ WebkitAppearance: "none" }} />
                    </span>
                  </Field>
                  <Field label={t("aiSupport.inbox.lead.labels")}>
                    <span className="flex flex-wrap items-center gap-1.5">
                      {labels.map((label) => <span key={label.id} className="rounded-full bg-surface-soft px-2 py-0.5 text-xs font-semibold">{label.name}</span>)}
                      {onEditLabels ? <button type="button" onClick={onEditLabels} className="inline-flex items-center gap-1 text-xs font-bold text-primary hover:underline"><Pencil className="h-3 w-3" />{t("aiSupport.inbox.crmCard.editLabels")}</button> : null}
                    </span>
                  </Field>
                </div>
              </div>

              <div role="tablist" className="mt-4 flex flex-wrap border-b border-border">
                {tabs.map(([key, label]) => (
                  <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)} className={`relative px-4 py-2.5 text-sm font-semibold ${tab === key ? "text-primary" : "text-text-muted hover:text-text"}`}>
                    {label}
                    {tab === key ? <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-primary" /> : null}
                  </button>
                ))}
              </div>

              <div className="py-4">
                {tab === "notes" ? (
                  <textarea dir="auto" value={details.notes ?? ""} onChange={(event) => set({ notes: event.target.value })} placeholder={t("aiSupport.inbox.lead.notesPlaceholder")} rows={7} className="w-full rounded-xl border border-border bg-surface-soft p-3 text-sm leading-6 focus:border-primary focus:outline-none" />
                ) : null}
                {tab === "contact" ? (
                  <div className="grid gap-x-10 md:grid-cols-2">
                    <Field label={t("aiSupport.inbox.lead.customer")}><span dir="auto">{customerName}</span></Field>
                    <Field label={t("aiSupport.inbox.lead.phone")}><span dir="ltr">{lead.phone || "—"}</span></Field>
                    <Field label={t("aiSupport.inbox.lead.city")}><span dir="auto">{clean(conversation.customer_profile?.city || conversation.channel_metadata?.city) || "—"}</span></Field>
                    <Field label={t("aiSupport.inbox.lead.channel")}><span>{clean(conversation.channel || conversation.source)}</span></Field>
                    <Field label={t("aiSupport.inbox.lead.preferredSize")}><span dir="auto">{clean(conversation.customer_profile?.preferred_size || conversation.customer_profile?.size_preference) || "—"}</span></Field>
                    <Field label={t("aiSupport.inbox.lead.preferredColors")}><span dir="auto">{[].concat(conversation.customer_profile?.preferred_colors || []).join("، ") || "—"}</span></Field>
                  </div>
                ) : null}
                {tab === "orders" ? (
                  <div className="space-y-4">
                    <div className="flex flex-wrap gap-3 text-sm">
                      <span className="rounded-xl bg-surface-soft px-3 py-2">{t("aiSupport.inbox.lead.ordersCount", { count: lead.orders_summary?.count || 0 })}</span>
                      <span className="rounded-xl bg-surface-soft px-3 py-2">{t("aiSupport.inbox.lead.ordersTotal", { amount: money(lead.orders_summary?.total || 0) })}</span>
                      {onCreateOrder ? <button type="button" onClick={onCreateOrder} className="rounded-xl bg-primary px-3 py-2 font-bold text-primary-foreground">{t("aiSupport.inbox.lead.newOrder")}</button> : null}
                    </div>
                    {(lead.orders || []).length ? (
                      <div className="overflow-hidden rounded-xl border border-border">
                        {(lead.orders || []).map((order) => (
                          <div key={order.id} className="flex items-center gap-3 border-b border-border px-3 py-2 text-sm last:border-b-0">
                            <span className="font-bold" dir="ltr">{order.invoice_number || `#${order.id}`}</span>
                            <span className="text-text-muted">{dayOf(order.created_at)}</span>
                            <span className="rounded-full bg-surface-soft px-2 py-0.5 text-xs">{order.status}</span>
                            <span className="text-xs text-text-muted">{order.source}</span>
                            <span className="ms-auto font-bold" dir="ltr">{money(order.total)}</span>
                          </div>
                        ))}
                      </div>
                    ) : <p className="text-sm text-text-muted">{t("aiSupport.inbox.lead.noOrders")}</p>}
                    {(lead.products || []).length ? (
                      <div>
                        <div className="mb-2 text-sm font-bold">{t("aiSupport.inbox.lead.boughtProducts")}</div>
                        <div className="grid gap-2 sm:grid-cols-2">
                          {(lead.products || []).map((product, index) => (
                            <div key={`${product.variant_id || product.product_id || index}`} className="flex items-center gap-3 rounded-xl border border-border p-2">
                              {product.image_url ? <img src={resolveProductImageUrl(product.image_url)} alt="" className="h-12 w-12 rounded-lg object-cover" loading="lazy" /> : <span className="grid h-12 w-12 place-items-center rounded-lg bg-surface-soft"><Package className="h-5 w-5 text-text-muted" /></span>}
                              <div className="min-w-0">
                                <div dir="auto" className="truncate text-sm font-semibold">{product.name}</div>
                                <div className="text-xs text-text-muted">{[product.size && t("aiSupport.inbox.lead.sizeValue", { size: product.size }), product.color, product.quantity > 1 ? `×${product.quantity}` : ""].filter(Boolean).join(" · ")}</div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {tab === "campaign" ? <CampaignAttributionCard conversation={conversation} variant="desktop" /> : null}
                {tab === "lost" ? (
                  <div className="space-y-3">
                    {lostPrompt ? <p className="rounded-lg bg-danger-subtle px-3 py-2 text-sm text-danger">{t("aiSupport.inbox.lead.lostNeedsReason")}</p> : null}
                    <div className="flex flex-wrap gap-2">
                      {LOST_REASONS.map((reason) => (
                        <button key={reason} type="button" onClick={() => set({ lost_reason: reason })} className={`rounded-full px-3 py-1.5 text-sm font-semibold ${details.lost_reason === reason ? "bg-rose-500 text-slate-50" : "bg-surface-soft text-text hover:bg-surface-hover"}`}>
                          {t(`aiSupport.inbox.lead.lostReasons.${reason}`)}
                        </button>
                      ))}
                    </div>
                    <textarea dir="auto" value={details.lost_notes ?? ""} onChange={(event) => set({ lost_notes: event.target.value })} placeholder={t("aiSupport.inbox.lead.lostNotes")} rows={4} className="w-full rounded-xl border border-border bg-surface-soft p-3 text-sm focus:border-primary focus:outline-none" />
                    {lostPrompt && clean(details.lost_reason) ? (
                      <button type="button" onClick={markLost} className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-bold text-slate-50">{t("aiSupport.inbox.lead.confirmLost")}</button>
                    ) : null}
                  </div>
                ) : null}
                {tab === "clicks" ? (
                  clicks.length ? (
                    <div className="overflow-hidden rounded-xl border border-border">
                      {clicks.map((click, index) => (
                        <div key={click.id || index} className="flex flex-wrap items-center gap-3 border-b border-border px-3 py-2 text-sm last:border-b-0">
                          <MousePointerClick className="h-4 w-4 text-sky-500" />
                          <span dir="auto" className="font-semibold">{click.ad_name || click.ad_headline || click.campaign_name || t("aiSupport.inbox.lead.adClick")}</span>
                          <span className="text-text-muted">{click.channel}</span>
                          <span className="ms-auto text-xs text-text-muted">{dayOf(click.clicked_at)}</span>
                        </div>
                      ))}
                    </div>
                  ) : <p className="text-sm text-text-muted">{t("aiSupport.inbox.lead.noClicks")}</p>
                ) : null}
              </div>

              <div className="rounded-2xl border border-border p-3">
                <div className="mb-2 text-sm font-bold">{t("aiSupport.inbox.lead.activity")}</div>
                <div className="flex items-end gap-2">
                  <textarea dir="auto" rows={2} value={note} onChange={(event) => setNote(event.target.value)} placeholder={t("aiSupport.inbox.lead.logNotePlaceholder")} className="min-w-0 flex-1 rounded-lg border border-border bg-surface-soft p-2 text-sm focus:border-primary focus:outline-none" />
                  <button type="button" onClick={logNote} disabled={!clean(note) || noting} className="h-9 shrink-0 rounded-lg bg-amber-500 px-3 text-sm font-bold text-slate-50 disabled:opacity-45">
                    {noting ? <Loader2 className="h-4 w-4 animate-spin" /> : t("aiSupport.inbox.lead.logNote")}
                  </button>
                </div>
                <ul className="mt-3 space-y-1 text-xs text-text-muted">
                  {lead.crm_lead ? <li>{t("aiSupport.inbox.lead.since", { source: t(`aiSupport.inbox.lead.sources.${clean(lead.crm_lead.source).replace(/^backfill_/, "") || "auto"}`, clean(lead.crm_lead.source)), day: dayOf(lead.crm_lead.at) })}</li> : null}
                  {lead.auto ? <li>{t("aiSupport.inbox.lead.autoMoved", { stage: stageOptions.find((option) => option.id === lead.auto.stage)?.label || lead.auto.stage, day: dayOf(lead.auto.at) })}</li> : null}
                  {details.updated_at ? <li>{t("aiSupport.inbox.lead.lastEdit", { name: details.updated_by || "", day: dayOf(details.updated_at) })}</li> : null}
                </ul>
              </div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.fullscreenElement || document.body
  );
}
