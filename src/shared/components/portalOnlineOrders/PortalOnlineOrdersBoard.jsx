import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  Check,
  Clock,
  Copy,
  ExternalLink,
  FileText,
  ListChecks,
  Loader2,
  MapPin,
  MessageCircle,
  Package,
  Phone,
  Printer,
  Receipt,
  RefreshCw,
  Search,
  Truck,
  User,
  Users,
  X,
} from "lucide-react";
import { formatCurrency, formatNumber } from "../../lib/currency";
import { formatInAppTimezone } from "../../lib/appTimezone";
import { resolveProductImageUrl, resolveShippingProofImageUrl } from "../../lib/imageUrls";
import { normalizeOrderLifecycleStatus, normalizeShippingLifecycleStatus } from "../../../../shared/orderStatus.js";
import { getConfirmationState } from "../../../modules/orders/components/ConfirmationBadge";
import { PORTAL_ACTION_ERROR_CODES, pdfUrlFromBase64, portalOrderActionsFor } from "./portalOrderActions";
import { currentBuildId } from "../../lib/portalBuildUpdate";

// أوردرات الشحن — one board, mounted by both the employee portal (its own page) and
// the manager portal (a tab). The host only supplies how to fetch; everything the
// person sees is decided here so the two portals can never drift apart.
//
// Colours are theme tokens only (bg-surface, text-text-muted, bg-success-subtle …):
// the ERP remaps raw Tailwind palette classes, and a board that renders inside two
// different shells cannot lean on either shell's normalisation.

const GROUPS = ["all", "new", "confirmed", "shipping", "delivered", "closed"];
const RANGES = ["today", "7d", "30d", "90d", "all"];
const DEFAULT_RANGE = "30d";
const POLL_MS = 60_000;
const PROVIDER_KEYS = ["bosta", "in_store_delivery", "manual", "pickup"];
const EMPTY_BULK = { running: "", done: 0, total: 0, confirming: false, results: null, error: "", notice: "" };

// A window opened before the request (after an await it is a blocked popup); if the
// browser refused it anyway, fall back to opening the blob in a new tab.
const openPdf = (base64, printWindow) => {
  const url = pdfUrlFromBase64(base64);
  if (printWindow && !printWindow.closed) {
    printWindow.location.href = url;
  } else {
    const link = document.createElement("a");
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
  }
  window.setTimeout(() => URL.revokeObjectURL(url), 120000);
};

// The status tokens measure ~3.1–4.1:1 as text on their own soft fills (below AA), so a
// tinted pill keeps the body ink and carries its colour in a dot instead.
const TONES = {
  warning: { fill: "bg-warning-subtle", dot: "bg-warning" },
  info: { fill: "bg-info-subtle", dot: "bg-info" },
  success: { fill: "bg-success-subtle", dot: "bg-success" },
  danger: { fill: "bg-danger-subtle", dot: "bg-danger" },
  muted: { fill: "bg-surface-soft", dot: "bg-text-muted" },
  solid: { fill: "bg-primary", ink: "text-primary-foreground" },
};

const GROUP_TONE = {
  new: "warning",
  confirmed: "info",
  shipping: "solid",
  delivered: "success",
  closed: "danger",
};

const CONFIRMATION_TONE = {
  confirmed: "success",
  cancelled: "danger",
  edit_requested: "warning",
  awaiting: "warning",
  not_sent: "muted",
};

const text = (value = "") => String(value ?? "").trim();
const lower = (value = "") => text(value).toLowerCase();

const appendById = (previous, incoming) => {
  const known = new Set(previous.map((order) => String(order.id)));
  return [...previous, ...incoming.filter((order) => !known.has(String(order.id)))];
};

const phoneDigits = (value = "") => text(value).replace(/\D/g, "");
const telHref = (phone = "") => {
  const cleaned = text(phone).replace(/[^\d+]/g, "");
  return cleaned ? `tel:${cleaned}` : "";
};
// Egyptian numbers arrive as 010…, +2010… or 2010…; wa.me wants 2010… .
const whatsappHref = (phone = "") => {
  let digits = phoneDigits(phone);
  if (!digits) return "";
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0") && digits.length === 11) digits = `2${digits}`;
  else if (digits.startsWith("1") && digits.length === 10) digits = `20${digits}`;
  return `https://wa.me/${digits}`;
};

const copyToClipboard = async (value = "") => {
  const content = String(value || "");
  if (!content) return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(content);
      return true;
    }
  } catch {
    // Fall through to the textarea path (iOS PWA, insecure context).
  }
  const textarea = document.createElement("textarea");
  textarea.value = content;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  return copied;
};

const paymentMethodKey = (method = "") => {
  const key = lower(method).replace(/[\s-]+/g, "_");
  if (!key) return "";
  if (key === "cod" || key.includes("cash_on_delivery")) return "cod";
  if (key.includes("instapay")) return "instapay";
  if (key.includes("vodafone")) return "vodafone_cash";
  if (key.includes("wallet")) return "wallet";
  if (["card", "paymob", "online", "visa", "credit", "apple_pay"].some((needle) => key.includes(needle))) return "card";
  if (key === "cash") return "cash";
  return "";
};

const paymentStatusKey = (status = "") => {
  const key = lower(status).replace(/[\s-]+/g, "_");
  if (["paid", "completed", "complete", "settled"].includes(key)) return "paid";
  if (["partial", "partially_paid"].includes(key)) return "partial";
  if (["unpaid", "pending", "awaiting_verification", ""].includes(key)) return "unpaid";
  return "";
};

const proofStatusKey = (status = "") => {
  const key = lower(status);
  if (key === "pending") return "proofPending";
  if (key === "approved") return "proofApproved";
  if (key === "rejected") return "proofRejected";
  return "";
};

function useBoardText() {
  const { t, i18n } = useTranslation();
  const language = String(i18n.resolvedLanguage || i18n.language || "ar").startsWith("ar") ? "ar" : "en";
  const locale = language === "ar" ? "ar-EG" : "en-GB";
  return useMemo(() => {
    const tb = (key, options) => t(`orders.portalBoard.${key}`, options);
    const money = (value) => formatCurrency(Number(value || 0), language);
    const count = (value) => formatNumber(Number(value || 0), language);
    const dateTime = (value) =>
      value ? formatInAppTimezone(value, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }, locale) : "";
    const statusLabel = (status) => tb(`statuses.${normalizeOrderLifecycleStatus(status, "pending")}`);
    const shippingLabel = (status) => tb(`shippingStatuses.${normalizeShippingLifecycleStatus(status, "pending")}`);
    const paymentMethodLabel = (method) => {
      const key = paymentMethodKey(method);
      return key ? tb(`payment.${key}`) : text(method) || "-";
    };
    const paymentStatusLabel = (status) => {
      const key = paymentStatusKey(status);
      return key ? tb(`payment.${key}`) : text(status) || "-";
    };
    const confirmationLabel = (state) => (state ? t(state.labelKey, state.fallback) : "");
    const providerLabel = (provider) => {
      const key = lower(provider).replace(/[\s-]+/g, "_");
      if (!key) return "";
      if (PROVIDER_KEYS.includes(key)) return tb(`providers.${key}`);
      return key.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
    };
    return { t, tb, language, dir: language === "ar" ? "rtl" : "ltr", money, count, dateTime, statusLabel, shippingLabel, paymentMethodLabel, paymentStatusLabel, confirmationLabel, providerLabel };
  }, [t, language, locale]);
}

function Pill({ className = "", children, title }) {
  return (
    <span title={title} className={`inline-flex max-w-full items-center gap-1 truncate rounded-full px-2 py-0.5 text-[11px] font-black leading-5 ${className}`}>
      {children}
    </span>
  );
}

function TonePill({ tone = "muted", children }) {
  const style = TONES[tone] || TONES.muted;
  return (
    <Pill className={`${style.fill} ${style.ink || "text-text"}`}>
      {style.dot ? <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${style.dot}`} /> : null}
      <span className="truncate">{children}</span>
    </Pill>
  );
}

function CopyButton({ value, label, copiedLabel, className = "" }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef(null);
  useEffect(() => () => window.clearTimeout(timerRef.current), []);
  if (!value) return null;
  return (
    <button
      type="button"
      onClick={async (event) => {
        event.stopPropagation();
        if (await copyToClipboard(value)) {
          setCopied(true);
          window.clearTimeout(timerRef.current);
          timerRef.current = window.setTimeout(() => setCopied(false), 1600);
        }
      }}
      className={`inline-flex min-h-9 items-center justify-center gap-1.5 rounded-[var(--radius-control)] border border-border bg-surface px-2.5 text-xs font-black text-text transition hover:bg-surface-hover ${className}`}
      aria-label={label}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
      <span>{copied ? copiedLabel : label}</span>
    </button>
  );
}

function ContactButtons({ phone, ui, size = "sm" }) {
  const tel = telHref(phone);
  const wa = whatsappHref(phone);
  if (!tel && !wa) return null;
  const base = size === "lg"
    ? "min-h-[var(--control-height-lg)] px-4 text-sm"
    : "min-h-9 px-3 text-xs";
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      {tel ? (
        <a
          href={tel}
          onClick={(event) => event.stopPropagation()}
          className={`inline-flex items-center justify-center gap-1.5 rounded-[var(--radius-control)] border border-border bg-surface font-black text-text transition hover:bg-surface-hover ${base}`}
          aria-label={ui.tb("actions.call")}
        >
          <Phone className="h-4 w-4" />
          <span>{ui.tb("actions.call")}</span>
        </a>
      ) : null}
      {wa ? (
        <a
          href={wa}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(event) => event.stopPropagation()}
          className={`inline-flex items-center justify-center gap-1.5 rounded-[var(--radius-control)] bg-success-subtle font-black text-text transition hover:opacity-90 ${base}`}
          aria-label={ui.tb("actions.whatsapp")}
        >
          <MessageCircle className="h-4 w-4 text-success" />
          <span>{ui.tb("actions.whatsapp")}</span>
        </a>
      ) : null}
    </div>
  );
}

function ProductThumb({ src, size = "h-12 w-12", onOpen }) {
  const [failed, setFailed] = useState(false);
  const url = src && !failed ? resolveProductImageUrl(src) : "";
  const body = url ? (
    <img src={url} alt="" loading="lazy" onError={() => setFailed(true)} className={`${size} shrink-0 rounded-xl border border-border bg-surface-soft object-cover`} />
  ) : (
    <span className={`${size} grid shrink-0 place-items-center rounded-xl border border-border bg-surface-soft text-text-muted`}>
      <Package className="h-5 w-5" />
    </span>
  );
  if (!url || !onOpen) return body;
  return (
    <button type="button" onClick={(event) => { event.stopPropagation(); onOpen(url); }} className="shrink-0 rounded-xl">
      {body}
    </button>
  );
}

const locationLine = (order = {}) =>
  [order.address?.governorate, order.address?.city, order.address?.district].map(text).filter(Boolean).filter((value, index, list) => list.indexOf(value) === index).join(" · ");

const fullAddressText = (order = {}, ui) => {
  const address = order.address || {};
  const parts = [
    locationLine(order),
    address.street ? `${ui.tb("detail.street")}: ${address.street}` : "",
    address.building ? `${ui.tb("detail.building")}: ${address.building}` : "",
    address.floor ? `${ui.tb("detail.floor")}: ${address.floor}` : "",
    address.apartment ? `${ui.tb("detail.apartment")}: ${address.apartment}` : "",
    address.landmark ? `${ui.tb("detail.landmark")}: ${address.landmark}` : "",
    address.full,
  ].map(text).filter(Boolean);
  return parts.join("\n");
};

function ItemLine({ item, ui }) {
  return (
    <div className="flex items-center gap-3 rounded-[var(--radius-control)] bg-surface-soft p-2">
      <ProductThumb src={item.image_url} size="h-20 w-20" />
      <div className="min-w-0 flex-1">
        <div className="line-clamp-2 text-sm font-black leading-5 text-text" dir="auto">{item.product_name}</div>
        <div className="mt-1.5 flex flex-wrap gap-1">
          {item.size ? <Pill className="bg-surface text-text">{ui.tb("detail.size")}: <span dir="ltr">{item.size}</span></Pill> : null}
          {item.color ? <Pill className="bg-surface text-text"><span dir="auto">{item.color}</span></Pill> : null}
          {item.article_code ? <Pill className="bg-surface text-text">{ui.tb("detail.article")}: <span dir="ltr">{item.article_code}</span></Pill> : null}
          {Number(item.quantity) > 1 ? <Pill className="bg-surface text-text">× {ui.count(item.quantity)}</Pill> : null}
        </div>
      </div>
    </div>
  );
}

function OrderCard({ order, ui, onOpen, selectable = false, selected = false, onToggleSelect }) {
  const confirmation = getConfirmationState(order);
  const items = Array.isArray(order.items) ? order.items : [];
  // What was ordered is read from the card itself: a photo big enough to recognise the
  // shoe, with its name, size and article code beside it (owner request 2026-09-10).
  const shownItems = items.slice(0, 2);
  const hiddenItems = Math.max(0, items.length - shownItems.length);
  const activate = () => (selectable ? onToggleSelect?.(order) : onOpen(order));
  const location = locationLine(order);
  const collect = Number(order.money?.collect_on_delivery || 0);
  const tracking = text(order.shipment?.tracking_number);
  const statusText = order.group === "shipping" && text(order.shipping_status)
    ? ui.shippingLabel(order.shipping_status)
    : ui.statusLabel(order.status);

  return (
    <article
      role={selectable ? "checkbox" : "button"}
      aria-checked={selectable ? selected : undefined}
      tabIndex={0}
      onClick={activate}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          activate();
        }
      }}
      className={`portal-online-order-card cursor-pointer rounded-[var(--radius-card)] border bg-surface p-3 text-start shadow-sm transition hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${selected ? "border-primary ring-2 ring-[var(--primary)]" : "border-border"}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            {selectable ? (
              <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-md border-2 ${selected ? "border-transparent bg-primary text-primary-foreground" : "border-[var(--border-strong)] bg-surface"}`} aria-hidden="true">
                {selected ? <Check className="h-3.5 w-3.5" /> : null}
              </span>
            ) : null}
            <span className="text-sm font-black text-text" dir="ltr">{order.order_number}</span>
            <Pill className="bg-surface-soft text-text-muted">{ui.tb(`sources.${order.source || "website"}`)}</Pill>
          </div>
          <div className="mt-0.5 text-[11px] font-bold text-text-muted">{ui.dateTime(order.created_at)}</div>
        </div>
        <div className="flex max-w-[55%] flex-col items-end gap-1">
          <TonePill tone={GROUP_TONE[order.group] || GROUP_TONE.new}>{statusText}</TonePill>
          {confirmation ? <TonePill tone={CONFIRMATION_TONE[confirmation.key] || CONFIRMATION_TONE.not_sent}>{ui.confirmationLabel(confirmation)}</TonePill> : null}
        </div>
      </div>

      <div className="mt-2.5 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 truncate text-sm font-black text-text">
            <User className="h-3.5 w-3.5 shrink-0 text-text-muted" />
            <span className="truncate" dir="auto">{order.customer?.name || ui.tb("card.noName")}</span>
          </div>
          <div className="mt-0.5 text-xs font-bold text-text-muted" dir="ltr">{order.customer?.phone || ui.tb("card.noPhone")}</div>
        </div>
        <ContactButtons phone={order.customer?.phone} ui={ui} />
      </div>

      <div className="mt-2 flex items-center gap-1.5 text-xs font-bold text-text-muted">
        <MapPin className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate" dir="auto">{location || text(order.address?.full) || ui.tb("card.noAddress")}</span>
      </div>

      {items.length ? (
        <div className="mt-2.5 space-y-2">
          {shownItems.map((item) => <ItemLine key={item.id} item={item} ui={ui} />)}
          <div className="flex items-center justify-between gap-2 text-xs font-black text-text-muted">
            <span>{hiddenItems > 0 ? ui.tb("card.moreItems", { count: ui.count(hiddenItems) }) : ""}</span>
            <span>{ui.tb("card.pieces", { count: ui.count(order.items_count) })}</span>
          </div>
        </div>
      ) : null}

      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2.5">
        <div className="flex items-baseline gap-1.5">
          <span className="text-[11px] font-bold text-text-muted">{ui.tb("card.total")}</span>
          <span className="text-sm font-black text-text">{ui.money(order.money?.total)}</span>
        </div>
        {collect > 0 ? (
          <div className="flex items-baseline gap-1.5">
            <span className="text-[11px] font-bold text-text-muted">{ui.tb("card.collect")}</span>
            <span className="text-sm font-black text-text">{ui.money(collect)}</span>
          </div>
        ) : null}
        {tracking ? (
          <Pill className="bg-surface-soft text-text">
            <Truck className="h-3 w-3" />
            <span dir="ltr">{tracking}</span>
          </Pill>
        ) : null}
      </div>
    </article>
  );
}

function Section({ icon: Icon, title, action, children }) {
  return (
    <section className="rounded-[var(--radius-card)] border border-border bg-surface p-3 shadow-sm">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-black text-text">
          {Icon ? <Icon className="h-4 w-4 text-text-muted" /> : null}
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function Field({ label, value, ltr = false, wide = false }) {
  if (value === null || value === undefined || text(value) === "") return null;
  return (
    <div className={`rounded-[var(--radius-control)] bg-surface-soft px-3 py-2 ${wide ? "col-span-2" : ""}`}>
      <div className="text-[11px] font-bold text-text-muted">{label}</div>
      <div className="mt-0.5 whitespace-pre-line break-words text-sm font-black text-text" dir={ltr ? "ltr" : "auto"}>{value}</div>
    </div>
  );
}

function MoneyRow({ label, value, strong = false, tone = "" }) {
  return (
    <div className={`flex items-center justify-between gap-3 py-1.5 text-sm ${strong ? "border-t border-border pt-2.5" : ""}`}>
      <span className="font-bold text-text-muted">{label}</span>
      <span className={`font-black ${tone || "text-text"} ${strong ? "text-base" : ""}`}>{value}</span>
    </div>
  );
}

function timelineLabel(event, ui) {
  if (event.kind === "shipment") return ui.tb("timeline.shipment", { status: ui.shippingLabel(event.status) });
  if (event.kind === "courier_collected") return ui.tb("timeline.courier_collected", { amount: ui.money(event.amount) });
  if (event.kind.startsWith("staff_")) return ui.tb(`timeline.${event.kind}`, { actor: event.actor || "-" });
  return ui.tb(`timeline.${event.kind}`);
}

const ACTION_ICON = { confirm: Check, ready_to_ship: Package, create_shipment: Truck, print_awb: Printer };
const ACTION_LABEL = { confirm: "actions.confirmOrder", ready_to_ship: "actions.readyToShip", create_shipment: "actions.createShipment", print_awb: "actions.printAwb" };

function OrderActionBar({ order, ui, state = {}, onAction, onCancelConfirm }) {
  const actions = portalOrderActionsFor(order);
  if (!actions.length && !state.notice && !state.actionError) return null;
  const busy = Boolean(state.busy);
  return (
    <div className="portal-online-order-actions border-t border-border bg-surface px-3 pt-2.5 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] sm:px-4">
      {state.notice ? (
        <div className="mb-2 flex items-center gap-2 rounded-[var(--radius-control)] bg-success-subtle px-3 py-2 text-xs font-black text-text" role="status">
          <Check className="h-4 w-4 shrink-0 text-success" />
          {state.notice}
        </div>
      ) : null}
      {state.actionError ? (
        <div className="mb-2 flex items-start gap-2 rounded-[var(--radius-control)] bg-danger-subtle px-3 py-2 text-xs font-black text-text" role="alert">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
          <span>{state.actionError}</span>
        </div>
      ) : null}
      {state.confirming === "create_shipment" ? (
        <div className="rounded-[var(--radius-control)] bg-warning-subtle p-3">
          <div className="text-sm font-black text-text">{ui.tb("actions.createConfirmTitle")}</div>
          <div className="mt-1 text-xs font-bold leading-5 text-text">
            {ui.tb("actions.createConfirmBody", { amount: ui.money(order.money?.collect_on_delivery) })}
          </div>
          <div className="mt-2.5 grid grid-cols-2 gap-2">
            <button type="button" disabled={busy} onClick={() => onAction("create_shipment")} className="inline-flex min-h-[var(--control-height-lg)] items-center justify-center gap-2 rounded-[var(--radius-control)] bg-primary px-3 text-sm font-black text-primary-foreground disabled:opacity-60">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Truck className="h-4 w-4" />}
              {ui.tb("actions.createConfirmYes")}
            </button>
            <button type="button" disabled={busy} onClick={onCancelConfirm} className="inline-flex min-h-[var(--control-height-lg)] items-center justify-center rounded-[var(--radius-control)] border border-border bg-surface px-3 text-sm font-black text-text disabled:opacity-60">
              {ui.tb("actions.cancel")}
            </button>
          </div>
        </div>
      ) : actions.length ? (
        <div className={`grid gap-2 ${actions.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
          {actions.map((action, index) => {
            const Icon = ACTION_ICON[action];
            const primary = index === 0;
            return (
              <button
                key={action}
                type="button"
                disabled={busy}
                onClick={() => onAction(action)}
                className={`inline-flex min-h-[var(--control-height-lg)] items-center justify-center gap-2 rounded-[var(--radius-control)] px-3 text-sm font-black disabled:opacity-60 ${primary ? "bg-primary text-primary-foreground" : "border border-border bg-surface text-text"}`}
              >
                {state.busy === action ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
                {ui.tb(ACTION_LABEL[action])}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function OrderDetailSheet({ selection, ui, onClose, onRetry, canAct = false, onAction, onCancelConfirm }) {
  const [imagePreview, setImagePreview] = useState("");
  const order = selection.order || {};
  useEffect(() => {
    const onKey = (event) => {
      if (event.key !== "Escape") return;
      if (imagePreview) setImagePreview("");
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [imagePreview, onClose]);

  const confirmation = getConfirmationState(order);
  const items = Array.isArray(order.items) ? order.items : [];
  const money = order.money || {};
  const shipment = order.shipment || {};
  const people = order.people || {};
  const address = order.address || {};
  const proofUrl = resolveShippingProofImageUrl(money.payment_proof_url);
  const proofKey = proofStatusKey(money.transfer_proof_status);
  const timeline = Array.isArray(order.timeline) ? order.timeline : [];
  const addressText = fullAddressText(order, ui);

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-[rgba(2,6,23,0.55)] sm:items-center" dir={ui.dir}>
      <button type="button" aria-label={ui.tb("actions.close")} onClick={onClose} className="absolute inset-0 cursor-default" />
      <section
        role="dialog"
        aria-modal="true"
        aria-label={order.order_number}
        className="portal-online-order-sheet relative flex max-h-[94dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-[1.75rem] border border-border bg-background shadow-2xl sm:rounded-[1.75rem]"
      >
        <header className="flex items-start justify-between gap-3 border-b border-border bg-surface px-4 py-3">
          <div className="min-w-0">
            <div className="text-[11px] font-black text-text-muted">{ui.tb("title")}</div>
            <h2 className="mt-0.5 text-lg font-black text-text" dir="ltr">{order.order_number}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <TonePill tone={GROUP_TONE[order.group] || GROUP_TONE.new}>{ui.tb(`groups.${order.group || "new"}`)}</TonePill>
              <Pill className="bg-surface-soft text-text-muted">{ui.tb(`sources.${order.source || "website"}`)}</Pill>
              {confirmation ? <TonePill tone={CONFIRMATION_TONE[confirmation.key] || CONFIRMATION_TONE.not_sent}>{ui.confirmationLabel(confirmation)}</TonePill> : null}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-[var(--control-height-md)] w-10 shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-primary text-primary-foreground"
            aria-label={ui.tb("actions.close")}
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-3 py-3 pb-[calc(env(safe-area-inset-bottom)+1rem)] sm:px-4">
          {selection.loading ? (
            <div className="flex items-center gap-2 rounded-[var(--radius-control)] bg-surface-soft px-3 py-2 text-xs font-bold text-text-muted">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {ui.tb("loading")}
            </div>
          ) : null}
          {selection.error ? (
            <div className="flex items-center justify-between gap-2 rounded-[var(--radius-control)] bg-danger-subtle px-3 py-2 text-xs font-black text-text">
              <span className="flex items-center gap-1.5"><AlertTriangle className="h-4 w-4 text-danger" />{ui.tb("error.detail")}</span>
              <button type="button" onClick={onRetry} className="underline">{ui.tb("error.retry")}</button>
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-2">
            <Field label={ui.tb("detail.orderStatus")} value={ui.statusLabel(order.status)} />
            <Field label={ui.tb("detail.shippingStatus")} value={ui.shippingLabel(order.shipping_status)} />
            <Field label={ui.tb("detail.createdAt")} value={ui.dateTime(order.created_at)} />
            <Field label={ui.tb("detail.source")} value={ui.tb(`sources.${order.source || "website"}`)} />
          </div>

          <Section icon={User} title={ui.tb("detail.customer")}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-base font-black text-text" dir="auto">{order.customer?.name || ui.tb("card.noName")}</div>
                <div className="mt-0.5 text-sm font-bold text-text-muted" dir="ltr">{order.customer?.phone || ui.tb("card.noPhone")}</div>
                {order.customer?.email ? <div className="mt-0.5 text-xs font-bold text-text-muted" dir="ltr">{order.customer.email}</div> : null}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <ContactButtons phone={order.customer?.phone} ui={ui} size="lg" />
                <CopyButton value={order.customer?.phone} label={ui.tb("actions.copy")} copiedLabel={ui.tb("actions.copied")} className="min-h-[var(--control-height-lg)]" />
              </div>
            </div>
          </Section>

          <Section
            icon={MapPin}
            title={ui.tb("detail.address")}
            action={<CopyButton value={addressText} label={ui.tb("actions.copyAddress")} copiedLabel={ui.tb("actions.copied")} />}
          >
            <div className="grid grid-cols-2 gap-2">
              <Field label={ui.tb("detail.governorate")} value={address.governorate} />
              <Field label={ui.tb("detail.city")} value={address.city} />
              <Field label={ui.tb("detail.district")} value={address.district !== address.city ? address.district : ""} />
              <Field label={ui.tb("detail.street")} value={address.street} />
              <Field label={ui.tb("detail.building")} value={address.building} />
              <Field label={ui.tb("detail.floor")} value={address.floor} />
              <Field label={ui.tb("detail.apartment")} value={address.apartment} />
              <Field label={ui.tb("detail.landmark")} value={address.landmark} wide />
              <Field label={ui.tb("detail.fullAddress")} value={address.full && address.full !== address.street ? address.full : ""} wide />
              <Field label={ui.tb("detail.deliveryNotes")} value={order.delivery_notes} wide />
              <Field label={ui.tb("detail.orderNotes")} value={order.order_notes} wide />
            </div>
            {!addressText ? <div className="text-sm font-bold text-text-muted">{ui.tb("card.noAddress")}</div> : null}
          </Section>

          <Section icon={Package} title={`${ui.tb("detail.products")} · ${ui.tb("card.pieces", { count: ui.count(order.items_count) })}`}>
            <div className="space-y-2">
              {items.map((item) => (
                <div key={item.id} className="flex items-start gap-3 rounded-[var(--radius-control)] bg-surface-soft p-2">
                  <ProductThumb src={item.image_url} size="h-20 w-20" onOpen={setImagePreview} />
                  <div className="min-w-0 flex-1">
                    <div className="line-clamp-2 text-sm font-black leading-5 text-text" dir="auto">{item.product_name}</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {item.color ? <Pill className="bg-surface text-text">{ui.tb("detail.color")}: <span dir="auto">{item.color}</span></Pill> : null}
                      {item.size ? <Pill className="bg-surface text-text">{ui.tb("detail.size")}: <span dir="ltr">{item.size}</span></Pill> : null}
                      {item.article_code ? <Pill className="bg-surface text-text">{ui.tb("detail.article")}: <span dir="ltr">{item.article_code}</span></Pill> : null}
                      <Pill className="bg-surface text-text">{ui.tb("detail.quantity")}: {ui.count(item.quantity)}</Pill>
                      {Number(item.returned_quantity) > 0 ? <TonePill tone="danger">{ui.tb("detail.returned", { count: ui.count(item.returned_quantity) })}</TonePill> : null}
                    </div>
                    {item.sku ? <div className="mt-1 truncate text-[11px] font-bold text-text-muted" dir="ltr">{item.sku}</div> : null}
                  </div>
                  <div className="shrink-0 text-end">
                    <div className="text-sm font-black text-text">{ui.money(item.line_total)}</div>
                    {Number(item.quantity) > 1 ? <div className="text-[11px] font-bold text-text-muted">{ui.money(item.unit_price)} × {ui.count(item.quantity)}</div> : null}
                  </div>
                </div>
              ))}
            </div>
          </Section>

          <Section icon={Receipt} title={ui.tb("detail.money")}>
            <div>
              <MoneyRow label={ui.tb("detail.subtotal")} value={ui.money(money.subtotal)} />
              {Number(money.discount) > 0 ? (
                <MoneyRow label={money.coupon_code ? ui.tb("detail.coupon", { code: money.coupon_code }) : ui.tb("detail.discount")} value={`- ${ui.money(money.discount)}`} />
              ) : null}
              <MoneyRow label={ui.tb("detail.shippingFee")} value={ui.money(money.shipping_fee)} />
              <MoneyRow label={ui.tb("detail.total")} value={ui.money(money.total)} strong />
              <MoneyRow label={ui.tb("detail.paid")} value={ui.money(money.paid)} />
              <MoneyRow label={ui.tb("detail.owed")} value={ui.money(money.owed)} />
              {Number(money.collect_on_delivery) > 0 ? (
                <div className="mt-1.5 flex items-center justify-between gap-3 rounded-[var(--radius-control)] bg-warning-subtle px-3 py-2">
                  <span className="flex items-center gap-1.5 text-sm font-black text-text"><span className="h-2 w-2 rounded-full bg-warning" />{ui.tb("detail.collect")}</span>
                  <span className="text-base font-black text-text">{ui.money(money.collect_on_delivery)}</span>
                </div>
              ) : null}
            </div>
            <div className="mt-2.5 grid grid-cols-2 gap-2">
              <Field label={ui.tb("detail.paymentMethod")} value={ui.paymentMethodLabel(money.payment_method)} />
              <Field label={ui.tb("detail.paymentStatus")} value={ui.paymentStatusLabel(money.payment_status)} />
              {proofKey ? <Field label={ui.tb("detail.paymentProof")} value={ui.tb(`payment.${proofKey}`)} wide /> : null}
              {money.courier_collected_amount !== null && money.courier_collected_amount !== undefined ? (
                <Field label={ui.tb("detail.courierCollected")} value={ui.money(money.courier_collected_amount)} wide />
              ) : null}
            </div>
            {proofUrl ? (
              <button type="button" onClick={() => setImagePreview(proofUrl)} className="mt-2 flex items-center gap-2 rounded-[var(--radius-control)] bg-surface-soft p-2 text-start">
                <img src={proofUrl} alt="" loading="lazy" className="h-16 w-16 rounded-lg border border-border object-cover" />
                <span className="text-xs font-black text-text">{ui.tb("detail.paymentProof")}</span>
              </button>
            ) : null}
          </Section>

          <Section icon={Truck} title={ui.tb("detail.shipment")}>
            {shipment.tracking_number || shipment.delivery_id ? (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <Field label={ui.tb("detail.provider")} value={ui.providerLabel(shipment.provider)} />
                  <Field label={ui.tb("detail.shippingStatus")} value={ui.shippingLabel(order.shipping_status)} />
                  <Field label={ui.tb("detail.trackingNumber")} value={shipment.tracking_number || shipment.delivery_id} ltr />
                  <Field label={ui.tb("detail.lastSync")} value={ui.dateTime(shipment.last_synced_at)} />
                  {shipment.allow_open_package !== null && shipment.allow_open_package !== undefined ? (
                    <Field label={ui.tb("detail.openPackage")} value={shipment.allow_open_package ? ui.tb("detail.yes") : ui.tb("detail.no")} />
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <CopyButton value={shipment.tracking_number || shipment.delivery_id} label={ui.tb("actions.copy")} copiedLabel={ui.tb("actions.copied")} />
                  {shipment.tracking_url ? (
                    <a href={shipment.tracking_url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 items-center gap-1.5 rounded-[var(--radius-control)] border border-border bg-surface px-2.5 text-xs font-black text-text">
                      <ExternalLink className="h-3.5 w-3.5" />
                      {ui.tb("actions.trackShipment")}
                    </a>
                  ) : null}
                  {shipment.label_url ? (
                    <a href={shipment.label_url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 items-center gap-1.5 rounded-[var(--radius-control)] border border-border bg-surface px-2.5 text-xs font-black text-text">
                      <FileText className="h-3.5 w-3.5" />
                      {ui.tb("actions.openLabel")}
                    </a>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="text-sm font-bold text-text-muted">{ui.tb("detail.noShipment")}</div>
            )}
          </Section>

          {people.seller || people.cashier || people.created_by || people.branch ? (
            <Section icon={Users} title={ui.tb("detail.people")}>
              <div className="grid grid-cols-2 gap-2">
                <Field label={ui.tb("detail.seller")} value={people.seller} />
                <Field label={ui.tb("detail.cashier")} value={people.cashier} />
                <Field label={ui.tb("detail.createdBy")} value={people.created_by} />
                <Field label={ui.tb("detail.branch")} value={people.branch} />
              </div>
            </Section>
          ) : null}

          {timeline.length ? (
            <Section icon={Clock} title={ui.tb("detail.timeline")}>
              <ol className="space-y-2">
                {timeline.map((event, index) => (
                  <li key={`${event.kind}-${event.at}-${index}`} className="flex items-start gap-2.5">
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />
                    <div className="min-w-0">
                      <div className="text-sm font-black text-text">{timelineLabel(event, ui)}</div>
                      <div className="text-[11px] font-bold text-text-muted">{ui.dateTime(event.at)}</div>
                    </div>
                  </li>
                ))}
              </ol>
            </Section>
          ) : null}
        </div>
        {canAct ? <OrderActionBar order={order} ui={ui} state={selection} onAction={onAction} onCancelConfirm={onCancelConfirm} /> : null}
      </section>

      {imagePreview ? (
        <div className="fixed inset-0 z-[95] flex items-center justify-center bg-[rgba(0,0,0,0.88)] p-4" onClick={() => setImagePreview("")}>
          <img src={imagePreview} alt="" className="max-h-full max-w-full rounded-2xl object-contain" />
          <button
            type="button"
            onClick={() => setImagePreview("")}
            className="absolute end-4 top-[calc(env(safe-area-inset-top)+1rem)] inline-flex h-11 w-11 items-center justify-center rounded-full bg-surface text-text"
            aria-label={ui.tb("actions.close")}
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      ) : null}
    </div>
  );
}

export default function PortalOnlineOrdersBoard({
  loadList,
  loadDetail,
  runAction = null,
  printLabels = null,
  // Where the multi-select bar floats: above the manager portal's bottom nav, or at the
  // screen edge on the employee page, which has none.
  bulkBarOffset = "calc(env(safe-area-inset-bottom) + 0.75rem)",
  className = "",
}) {
  const ui = useBoardText();
  const [canAct, setCanAct] = useState(false);
  const runActionRef = useRef(runAction);
  runActionRef.current = runAction;
  const [group, setGroup] = useState("all");
  const [range, setRange] = useState(DEFAULT_RANGE);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [board, setBoard] = useState({ orders: [], counts: {}, page: 1, hasMore: false, loading: true, loadingMore: false, error: "", loadedAt: 0 });
  const [selection, setSelection] = useState(null);
  const requestRef = useRef(0);
  const boardRef = useRef(board);
  boardRef.current = board;
  const loadListRef = useRef(loadList);
  loadListRef.current = loadList;
  const loadDetailRef = useRef(loadDetail);
  loadDetailRef.current = loadDetail;

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchInput.trim()), 350);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const fetchPage = useCallback(async ({ page = 1, silent = false } = {}) => {
    const requestId = ++requestRef.current;
    setBoard((current) => ({
      ...current,
      loading: page === 1 && !silent,
      loadingMore: page > 1,
      error: page === 1 && !silent ? "" : current.error,
    }));
    try {
      const payload = await loadListRef.current({ group, range, search, page });
      if (requestId !== requestRef.current) return;
      const orders = Array.isArray(payload?.orders) ? payload.orders : [];
      setCanAct(Boolean(runActionRef.current) && payload?.permissions?.can_act === true);
      setBoard((current) => ({
        orders: page > 1 ? appendById(current.orders, orders) : orders,
        counts: payload?.counts || {},
        page,
        hasMore: Boolean(payload?.has_more),
        loading: false,
        loadingMore: false,
        error: "",
        loadedAt: Date.now(),
      }));
    } catch (error) {
      if (requestId !== requestRef.current) return;
      setBoard((current) => ({
        ...current,
        loading: false,
        loadingMore: false,
        error: error?.responseBody?.message || error?.message || ui.tb("error.title"),
      }));
    }
  }, [group, range, search, ui]);

  useEffect(() => {
    void fetchPage({ page: 1 });
  }, [fetchPage]);

  // New orders keep arriving while the page is open. Refresh the first page quietly
  // while it is on screen — never once the person has paged further, which would
  // throw away what they scrolled to.
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      const current = boardRef.current;
      if (current.loading || current.loadingMore || current.page > 1) return;
      if (Date.now() - current.loadedAt < POLL_MS - 5_000) return;
      void fetchPage({ page: 1, silent: true });
    };
    const interval = window.setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [fetchPage]);

  const loadSelection = useCallback(async (order) => {
    setSelection({ id: order.id, order, loading: true, error: "" });
    try {
      const detail = await loadDetailRef.current(order.id);
      setSelection((current) => (current && current.id === order.id
        ? { ...current, order: { ...current.order, ...(detail || {}) }, loading: false, error: "" }
        : current));
    } catch (error) {
      setSelection((current) => (current && current.id === order.id
        ? { ...current, loading: false, error: error?.message || "error" }
        : current));
    }
  }, []);

  const closeSelection = useCallback(() => setSelection(null), []);
  const patchSelection = useCallback((orderId, patch) => {
    setSelection((current) => (current && current.id === orderId ? { ...current, ...patch } : current));
  }, []);

  const actionErrorText = useCallback((error) => {
    const code = text(error?.responseBody?.code || error?.code);
    if (PORTAL_ACTION_ERROR_CODES.includes(code)) return ui.tb(`actionErrors.${code}`);
    const message = text(error?.responseBody?.message || error?.message);
    return message ? `${ui.tb("actionErrors.generic")} — ${message}` : ui.tb("actionErrors.generic");
  }, [ui]);

  const handleAction = useCallback(async (action) => {
    const current = selection;
    if (!current || !runActionRef.current || current.busy) return;
    const orderId = current.id;
    // A Bosta parcel is real (the courier is booked, the customer is messaged), so it
    // takes a second, explicit tap that shows the amount the courier will collect.
    if (action === "create_shipment" && current.confirming !== "create_shipment") {
      patchSelection(orderId, { confirming: "create_shipment", actionError: "", notice: "" });
      return;
    }
    // Opened before the request: a window opened after an await is a popup the browser blocks.
    const printWindow = action === "print_awb" ? window.open("", "_blank") : null;
    patchSelection(orderId, { busy: action, actionError: "", notice: "" });
    try {
      const response = await runActionRef.current(orderId, action);
      if (action === "print_awb") {
        openPdf(response?.pdf_base64, printWindow);
        patchSelection(orderId, { busy: "", confirming: "", notice: ui.tb("actionDone.print_awb") });
        return;
      }
      const nextOrder = response?.order || null;
      setSelection((existing) => (existing && existing.id === orderId
        ? { ...existing, order: nextOrder ? { ...existing.order, ...nextOrder } : existing.order, busy: "", confirming: "", actionError: "", notice: ui.tb(`actionDone.${action}`) }
        : existing));
      if (nextOrder) {
        setBoard((existing) => ({ ...existing, orders: existing.orders.map((row) => (String(row.id) === String(orderId) ? { ...row, ...nextOrder } : row)) }));
      }
      // The order may have moved tab; refresh the counts (and the first page) quietly.
      if (boardRef.current.page === 1) void fetchPage({ page: 1, silent: true });
    } catch (error) {
      if (printWindow && !printWindow.closed) printWindow.close();
      patchSelection(orderId, { busy: "", confirming: "", actionError: actionErrorText(error) });
    }
  }, [selection, patchSelection, actionErrorText, fetchPage, ui]);

  // ---- Multi-select: book or print several orders at once (owner request 2026-09-10).
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [bulk, setBulk] = useState(EMPTY_BULK);
  const printLabelsRef = useRef(printLabels);
  printLabelsRef.current = printLabels;

  const selectedOrders = useMemo(() => board.orders.filter((order) => selectedIds.has(String(order.id))), [board.orders, selectedIds]);
  const creatableOrders = selectedOrders.filter((order) => portalOrderActionsFor(order).includes("create_shipment"));
  const printableOrders = selectedOrders.filter((order) => portalOrderActionsFor(order).includes("print_awb"));
  const creatableCollect = creatableOrders.reduce((sum, order) => sum + Number(order.money?.collect_on_delivery || 0), 0);

  const toggleSelect = useCallback((order) => {
    setBulk((current) => (current.running ? current : { ...current, confirming: false }));
    setSelectedIds((current) => {
      const next = new Set(current);
      const key = String(order.id);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);
  const exitSelectMode = () => {
    if (bulk.running) return;
    setSelectMode(false);
    setSelectedIds(new Set());
    setBulk(EMPTY_BULK);
  };
  const selectAllVisible = () => setSelectedIds(new Set(board.orders.map((order) => String(order.id))));

  const runBulkCreate = async () => {
    if (bulk.running || !creatableOrders.length || !runActionRef.current) return;
    if (!bulk.confirming) {
      setBulk({ ...EMPTY_BULK, confirming: true });
      return;
    }
    // One order per request, in turn: every request stays far inside the 60s server
    // timeout, Bosta is never hit in parallel, and each result is known as it lands.
    const targets = creatableOrders;
    setBulk({ ...EMPTY_BULK, running: "create", total: targets.length });
    const results = [];
    for (const [index, order] of targets.entries()) {
      try {
        const response = await runActionRef.current(order.id, "create_shipment");
        results.push({ order, ok: true });
        if (response?.order) {
          setBoard((existing) => ({ ...existing, orders: existing.orders.map((row) => (String(row.id) === String(order.id) ? { ...row, ...response.order } : row)) }));
        }
      } catch (error) {
        results.push({ order, ok: false, reason: actionErrorText(error) });
      }
      setBulk((current) => ({ ...current, done: index + 1 }));
    }
    setBulk((current) => ({ ...current, running: "", results }));
    // Keep the ones that failed selected, so fixing and retrying is one tap.
    setSelectedIds(new Set(results.filter((result) => !result.ok).map((result) => String(result.order.id))));
    if (boardRef.current.page === 1) void fetchPage({ page: 1, silent: true });
  };

  const runBulkPrint = async () => {
    if (bulk.running || !printableOrders.length || !printLabelsRef.current) return;
    const printWindow = window.open("", "_blank");
    setBulk({ ...EMPTY_BULK, running: "print" });
    try {
      const response = await printLabelsRef.current(printableOrders.map((order) => order.id));
      openPdf(response?.pdf_base64, printWindow);
      setBulk({ ...EMPTY_BULK, notice: ui.tb("bulk.printed", { count: ui.count(response?.printed || printableOrders.length) }) });
    } catch (error) {
      if (printWindow && !printWindow.closed) printWindow.close();
      setBulk({ ...EMPTY_BULK, error: actionErrorText(error) });
    }
  };

  const canBulk = canAct && Boolean(runAction);
  const counts = board.counts || {};

  return (
    <div className={`portal-online-orders space-y-3 ${className}`} dir={ui.dir}>
      <div className="flex items-center gap-2">
        <label className="relative flex min-w-0 flex-1 items-center">
          <Search className="pointer-events-none absolute start-2.5 h-4 w-4 text-text-muted" />
          <input
            type="search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder={ui.tb("searchPlaceholder")}
            className={`min-h-[var(--control-height-lg)] w-full rounded-[var(--radius-control)] border border-border bg-surface ps-8 text-sm font-bold text-text placeholder:text-text-muted ${searchInput ? "pe-9" : "pe-2"}`}
            enterKeyHint="search"
          />
          {searchInput ? (
            <button type="button" onClick={() => setSearchInput("")} className="absolute end-2 inline-flex h-7 w-7 items-center justify-center rounded-full text-text-muted" aria-label={ui.tb("clearSearch")}>
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </label>
        <button
          type="button"
          onClick={() => void fetchPage({ page: 1 })}
          className="inline-flex min-h-[var(--control-height-lg)] w-11 shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-border bg-surface text-text"
          aria-label={ui.tb("refresh")}
          title={ui.tb("refresh")}
        >
          <RefreshCw className={`h-4 w-4 ${board.loading ? "animate-spin" : ""}`} />
        </button>
        {canBulk ? (
          <button
            type="button"
            onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
            aria-pressed={selectMode}
            className={`inline-flex min-h-[var(--control-height-lg)] shrink-0 items-center justify-center gap-1.5 rounded-[var(--radius-control)] px-3 text-sm font-black ${selectMode ? "bg-primary text-primary-foreground" : "border border-border bg-surface text-text"}`}
          >
            <ListChecks className="h-4 w-4" />
            <span>{selectMode ? ui.tb("bulk.done") : ui.tb("bulk.select")}</span>
          </button>
        ) : null}
      </div>

      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none]">
        {RANGES.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setRange(key)}
            aria-pressed={range === key}
            className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-black transition ${range === key ? "bg-text text-background" : "bg-surface-soft text-text-muted"}`}
          >
            {ui.tb(`ranges.${key}`)}
          </button>
        ))}
      </div>

      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none]" role="tablist">
        {GROUPS.map((key) => {
          const active = group === key;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setGroup(key)}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-[var(--radius-control)] border px-3 py-2 text-xs font-black transition ${active ? "border-transparent bg-primary text-primary-foreground" : "border-border bg-surface text-text"}`}
            >
              <span>{ui.tb(`groups.${key}`)}</span>
              <span className={`inline-flex min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] leading-5 ${active ? "bg-[rgba(255,255,255,0.22)]" : "bg-surface-soft text-text-muted"}`}>
                {ui.count(counts[key] || 0)}
              </span>
            </button>
          );
        })}
      </div>

      {board.error && !board.loading ? (
        <div className="flex flex-col items-center gap-2 rounded-[var(--radius-card)] border border-border bg-surface px-4 py-8 text-center">
          <AlertTriangle className="h-6 w-6 text-danger" />
          <div className="text-sm font-black text-text">{ui.tb("error.title")}</div>
          <div className="text-xs font-bold text-text-muted">{board.error}</div>
          <button type="button" onClick={() => void fetchPage({ page: 1 })} className="mt-1 rounded-[var(--radius-control)] bg-primary px-4 py-2 text-xs font-black text-primary-foreground">
            {ui.tb("error.retry")}
          </button>
        </div>
      ) : board.loading && !board.orders.length ? (
        <div className="space-y-2" aria-busy="true">
          {[0, 1, 2].map((key) => (
            <div key={key} className="h-44 animate-pulse rounded-[var(--radius-card)] border border-border bg-surface-soft" />
          ))}
        </div>
      ) : !board.orders.length ? (
        <div className="flex flex-col items-center gap-1.5 rounded-[var(--radius-card)] border border-border bg-surface px-4 py-10 text-center">
          <Truck className="h-7 w-7 text-text-muted" />
          <div className="text-sm font-black text-text">{ui.tb("empty.title")}</div>
          <div className="text-xs font-bold text-text-muted">{ui.tb("empty.body")}</div>
        </div>
      ) : (
        <div className={`grid gap-2.5 md:grid-cols-2 ${board.loading ? "opacity-60" : ""}`}>
          {board.orders.map((order) => (
            <OrderCard
              key={order.id}
              order={order}
              ui={ui}
              onOpen={loadSelection}
              selectable={selectMode}
              selected={selectedIds.has(String(order.id))}
              onToggleSelect={toggleSelect}
            />
          ))}
        </div>
      )}

      {selectMode ? (
        <>
          {/* Room under the last card, so the floating bar never hides it. */}
          <div className="h-48" aria-hidden="true" />
          <div
            className="portal-online-orders-bulkbar fixed inset-x-3 z-[45] mx-auto max-w-2xl rounded-[var(--radius-card)] border border-border bg-surface p-3 text-text shadow-2xl"
            style={{ bottom: bulkBarOffset }}
            role="region"
            aria-label={ui.tb("bulk.select")}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-black">{ui.tb("bulk.selected", { count: ui.count(selectedOrders.length) })}</span>
              <div className="flex items-center gap-1.5">
                <button type="button" disabled={Boolean(bulk.running)} onClick={selectAllVisible} className="rounded-[var(--radius-control)] border border-border bg-surface px-2.5 py-1.5 text-xs font-black disabled:opacity-60">
                  {ui.tb("bulk.selectAll")}
                </button>
                <button type="button" disabled={Boolean(bulk.running)} onClick={exitSelectMode} className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-control)] border border-border bg-surface disabled:opacity-60" aria-label={ui.tb("actions.close")}>
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {bulk.running === "create" ? (
              <div className="mt-2.5">
                <div className="flex items-center gap-2 text-sm font-black">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {ui.tb("bulk.progress", { done: ui.count(bulk.done), total: ui.count(bulk.total) })}
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-soft">
                  <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${bulk.total ? Math.round((bulk.done / bulk.total) * 100) : 0}%` }} />
                </div>
              </div>
            ) : bulk.confirming ? (
              <div className="mt-2.5 rounded-[var(--radius-control)] bg-warning-subtle p-3">
                <div className="text-sm font-black">{ui.tb("bulk.createConfirmTitle", { count: ui.count(creatableOrders.length) })}</div>
                <div className="mt-1 text-xs font-bold leading-5">{ui.tb("bulk.createConfirmBody", { amount: ui.money(creatableCollect) })}</div>
                <div className="mt-2.5 grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => void runBulkCreate()} className="inline-flex min-h-[var(--control-height-lg)] items-center justify-center gap-2 rounded-[var(--radius-control)] bg-primary px-3 text-sm font-black text-primary-foreground">
                    <Truck className="h-4 w-4" />
                    {ui.tb("bulk.createConfirmYes")}
                  </button>
                  <button type="button" onClick={() => setBulk(EMPTY_BULK)} className="inline-flex min-h-[var(--control-height-lg)] items-center justify-center rounded-[var(--radius-control)] border border-border bg-surface px-3 text-sm font-black">
                    {ui.tb("actions.cancel")}
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-2.5 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={!creatableOrders.length || Boolean(bulk.running)}
                  onClick={() => void runBulkCreate()}
                  className="inline-flex min-h-[var(--control-height-lg)] items-center justify-center gap-2 rounded-[var(--radius-control)] bg-primary px-3 text-sm font-black text-primary-foreground disabled:opacity-50"
                >
                  <Truck className="h-4 w-4" />
                  {ui.tb("bulk.createShipments", { count: ui.count(creatableOrders.length) })}
                </button>
                <button
                  type="button"
                  disabled={!printableOrders.length || Boolean(bulk.running) || !printLabels}
                  onClick={() => void runBulkPrint()}
                  className="inline-flex min-h-[var(--control-height-lg)] items-center justify-center gap-2 rounded-[var(--radius-control)] border border-border bg-surface px-3 text-sm font-black disabled:opacity-50"
                >
                  {bulk.running === "print" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
                  {ui.tb("bulk.printLabels", { count: ui.count(printableOrders.length) })}
                </button>
              </div>
            )}

            {selectedOrders.length && !creatableOrders.length && !printableOrders.length && !bulk.running ? (
              <div className="mt-2 text-xs font-bold text-text-muted">{ui.tb("bulk.noneEligible")}</div>
            ) : null}
            {bulk.notice ? (
              <div className="mt-2 flex items-center gap-2 rounded-[var(--radius-control)] bg-success-subtle px-3 py-2 text-xs font-black" role="status">
                <Check className="h-4 w-4 shrink-0 text-success" />
                {bulk.notice}
              </div>
            ) : null}
            {bulk.error ? (
              <div className="mt-2 flex items-start gap-2 rounded-[var(--radius-control)] bg-danger-subtle px-3 py-2 text-xs font-black" role="alert">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
                <span>{bulk.error}</span>
              </div>
            ) : null}
            {bulk.results ? (
              <div className="mt-2 space-y-1.5" role="status">
                <div className="flex items-center gap-2 rounded-[var(--radius-control)] bg-success-subtle px-3 py-2 text-xs font-black">
                  <Check className="h-4 w-4 shrink-0 text-success" />
                  {ui.tb("bulk.summary", { ok: ui.count(bulk.results.filter((result) => result.ok).length) })}
                  {bulk.results.some((result) => !result.ok) ? ` · ${ui.tb("bulk.failedCount", { count: ui.count(bulk.results.filter((result) => !result.ok).length) })}` : ""}
                </div>
                {bulk.results.filter((result) => !result.ok).map((result) => (
                  <div key={result.order.id} className="flex items-start gap-2 rounded-[var(--radius-control)] bg-danger-subtle px-3 py-2 text-xs font-bold">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger" />
                    <span><span dir="ltr" className="font-black">{result.order.order_number}</span> — {result.reason}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </>
      ) : null}

      {board.hasMore && !board.error ? (
        <button
          type="button"
          disabled={board.loadingMore}
          onClick={() => void fetchPage({ page: board.page + 1 })}
          className="inline-flex min-h-[var(--control-height-lg)] w-full items-center justify-center gap-2 rounded-[var(--radius-control)] border border-border bg-surface text-sm font-black text-text disabled:opacity-60"
        >
          {board.loadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {ui.tb("loadMore")}
        </button>
      ) : null}

      {board.loadedAt ? (
        <div className="text-center text-[11px] font-bold text-text-muted">
          {ui.tb("updatedAt", { time: formatInAppTimezone(board.loadedAt, { hour: "numeric", minute: "2-digit" }, ui.language === "ar" ? "ar-EG" : "en-GB") })}
          {/* Which deployment this phone is running — a screenshot then answers "is it updated?". */}
          {currentBuildId() ? <span dir="ltr"> · {ui.tb("version", { build: currentBuildId().slice(0, 7) })}</span> : null}
        </div>
      ) : null}

      {selection ? (
        <OrderDetailSheet
          selection={selection}
          ui={ui}
          onClose={closeSelection}
          onRetry={() => void loadSelection(selection.order)}
          canAct={canAct}
          onAction={(action) => void handleAction(action)}
          onCancelConfirm={() => patchSelection(selection.id, { confirming: "" })}
        />
      ) : null}
    </div>
  );
}
