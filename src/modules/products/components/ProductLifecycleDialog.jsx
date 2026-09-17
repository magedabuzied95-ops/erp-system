import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  History,
  Loader2,
  Package2,
  PackagePlus,
  RefreshCw,
  ShoppingBag,
  SlidersHorizontal,
  X,
} from "lucide-react";

import { getProductLifecycle, getProductLifecycleEvents } from "../services/productsApi";
import { resolveProductImageUrl } from "../../../shared/lib/imageUrls";

/**
 * "سجل حياة المنتج": opened from the product image on /products. Every colour/size,
 * when it entered the system and who added it, every purchase and sales invoice it sits
 * on, and every other stock movement. The server never sends a cost.
 *
 * Portals to document.body, outside `.m1-shell-content`, so foundation.css does not remap
 * raw Tailwind palette classes here: every colour is a token or a var() mix.
 */

const PAGE_SIZE = 40;
const KINDS = ["created", "purchase", "sale", "movement"];

const KIND_STYLE = {
  created: { tone: "var(--primary)", Icon: PackagePlus },
  purchase: { tone: "var(--success, #22c55e)", Icon: ArrowDownToLine },
  sale: { tone: "var(--warning, #f59e0b)", Icon: ShoppingBag },
  movement: { tone: "var(--text-muted, #94a3b8)", Icon: SlidersHorizontal },
};

const toneStyle = (tone, strength = 14) => ({
  background: `color-mix(in srgb, ${tone} ${strength}%, transparent)`,
  color: tone,
  border: `1px solid color-mix(in srgb, ${tone} 30%, transparent)`,
});

const sizeOrder = (a, b) => {
  const na = Number.parseFloat(a);
  const nb = Number.parseFloat(b);
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
  return String(a).localeCompare(String(b), undefined, { numeric: true });
};

const dayKey = (value) => {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-CA");
};

const signed = (value) => (value > 0 ? `+${value}` : String(value));

// A colour picture that falls back to a neutral tile: 139 catalogue URLs point at
// files that no longer exist, and a broken-image glyph reads as a rendering bug.
function ColorThumb({ src, alt, size = 48 }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  const box = { width: size, height: size };
  if (!src || failed) {
    return (
      <span className="grid shrink-0 place-items-center rounded-[10px] border border-border bg-surface text-text-muted" style={box} aria-hidden="true">
        <Package2 size={Math.round(size * 0.42)} />
      </span>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
      className="shrink-0 rounded-[10px] border border-border bg-white object-contain"
      style={box}
    />
  );
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function ProductLifecycleDialog({ product, onClose }) {
  const { t, i18n } = useTranslation();
  const isArabic = String(i18n.language || "").toLowerCase().startsWith("ar");
  const locale = isArabic ? "ar-EG" : "en-GB";
  const titleId = useId();
  const dialogRef = useRef(null);
  const closeRef = useRef(null);
  const sentinelRef = useRef(null);
  const requestRef = useRef(0);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const productId = product?.id;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("variants");
  const [kind, setKind] = useState("");
  const [color, setColor] = useState("");
  const [size, setSize] = useState("");
  const [events, setEvents] = useState([]);
  const [eventsTotal, setEventsTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsError, setEventsError] = useState("");

  const formatDateTime = useCallback(
    (value) => {
      const date = value ? new Date(value) : null;
      if (!date || Number.isNaN(date.getTime())) return "—";
      return date.toLocaleString(locale, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
    },
    [locale]
  );
  const formatTime = useCallback(
    (value) => {
      const date = value ? new Date(value) : null;
      if (!date || Number.isNaN(date.getTime())) return "";
      return date.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
    },
    [locale]
  );
  const formatDate = useCallback(
    (value) => {
      const date = value ? new Date(value) : null;
      if (!date || Number.isNaN(date.getTime())) return "—";
      return date.toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });
    },
    [locale]
  );
  const formatDay = useCallback(
    (value) => {
      const date = value ? new Date(value) : null;
      if (!date || Number.isNaN(date.getTime())) return "—";
      return date.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    },
    [locale]
  );

  // Header + per-size rows + first timeline page, once per product.
  useEffect(() => {
    if (!productId) return undefined;
    let cancelled = false;
    setLoading(true);
    setError("");
    getProductLifecycle(productId, { limit: PAGE_SIZE })
      .then((response) => {
        if (cancelled) return;
        setData(response || null);
        const timeline = response?.timeline || {};
        setEvents(Array.isArray(timeline.events) ? timeline.events : []);
        setEventsTotal(Number(timeline.total || 0));
        setHasMore(Boolean(timeline.has_more));
      })
      .catch((err) => {
        if (!cancelled) setError(err?.responseBody?.message || err?.message || t("products.lifecycle.loadFailed"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [productId, t]);

  const loadEvents = useCallback(
    async ({ reset }) => {
      if (!productId) return;
      const requestId = ++requestRef.current;
      setEventsLoading(true);
      setEventsError("");
      try {
        const response = await getProductLifecycleEvents(productId, {
          kind,
          color,
          size,
          limit: PAGE_SIZE,
          offset: reset ? 0 : events.length,
        });
        if (requestId !== requestRef.current) return;
        const timeline = response?.timeline || {};
        const page = Array.isArray(timeline.events) ? timeline.events : [];
        setEvents((current) => {
          if (reset) return page;
          const seen = new Set(current.map((event) => event.key));
          return [...current, ...page.filter((event) => !seen.has(event.key))];
        });
        setEventsTotal(Number(timeline.total || 0));
        setHasMore(Boolean(timeline.has_more));
      } catch (err) {
        if (requestId === requestRef.current) {
          setEventsError(err?.responseBody?.message || err?.message || t("products.lifecycle.loadFailed"));
        }
      } finally {
        if (requestId === requestRef.current) setEventsLoading(false);
      }
    },
    [productId, kind, color, size, events.length, t]
  );

  // Filters changed: refetch page one. Skipped on the first render, the header call already has it.
  const filtersKey = `${kind}|${color}|${size}`;
  const lastFiltersKey = useRef(filtersKey);
  useEffect(() => {
    if (lastFiltersKey.current === filtersKey) return;
    lastFiltersKey.current = filtersKey;
    loadEvents({ reset: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersKey]);

  // Infinite scroll on the timeline.
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || tab !== "timeline" || !hasMore || eventsLoading || typeof IntersectionObserver === "undefined") return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) loadEvents({ reset: false });
    }, { root: node.closest("[data-lifecycle-scroll]"), rootMargin: "200px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [tab, hasMore, eventsLoading, loadEvents]);

  // Modal behaviour: Esc closes, Tab stays inside, focus returns to the image.
  useEffect(() => {
    const previouslyFocused = typeof document !== "undefined" ? document.activeElement : null;
    closeRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onCloseRef.current?.();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const nodes = Array.from(dialogRef.current.querySelectorAll(FOCUSABLE)).filter((node) => node.offsetParent !== null);
      if (!nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = previousOverflow;
      if (previouslyFocused && typeof previouslyFocused.focus === "function") previouslyFocused.focus();
    };
  }, []);

  const variants = useMemo(() => (Array.isArray(data?.variants) ? data.variants : []), [data]);
  const summary = data?.summary || null;
  const header = data?.product || product || {};
  const imageUrl = resolveProductImageUrl(header.image_url || product?.image_url || product?.thumbnail_url || "");

  const colorGroups = useMemo(() => {
    const groups = new Map();
    for (const variant of variants) {
      const label = String(variant.color || "").trim() || t("products.lifecycle.noColor");
      const key = label.toLowerCase();
      const group = groups.get(key) || { key, label, rawColor: variant.color || "", rows: [] };
      group.rows.push(variant);
      groups.set(key, group);
    }
    return Array.from(groups.values()).map((group) => ({
      ...group,
      rows: [...group.rows].sort((a, b) => sizeOrder(a.size, b.size)),
      stock: group.rows.filter((row) => !row.archived).reduce((sum, row) => sum + row.stock, 0),
      purchased: group.rows.reduce((sum, row) => sum + row.purchased_quantity, 0),
      sold: group.rows.reduce((sum, row) => sum + row.sold_quantity, 0),
      archived: group.rows.every((row) => row.archived),
      image: resolveProductImageUrl(
        (group.rows.find((row) => row.image_url && !row.archived) || group.rows.find((row) => row.image_url))?.image_url || ""
      ),
    })).sort((a, b) => Number(a.archived) - Number(b.archived));
  }, [variants, t]);

  const colorImages = useMemo(
    () => new Map(colorGroups.filter((group) => group.image).map((group) => [group.key, group.image])),
    [colorGroups]
  );

  const sizeOptions = useMemo(() => {
    const source = color
      ? variants.filter((variant) => String(variant.color || "").trim().toLowerCase() === color.trim().toLowerCase())
      : variants;
    return Array.from(new Set(source.map((variant) => String(variant.size || "").trim()).filter(Boolean))).sort(sizeOrder);
  }, [variants, color]);

  const eventsByDay = useMemo(() => {
    const days = [];
    for (const event of events) {
      const key = dayKey(event.occurred_at);
      const last = days[days.length - 1];
      if (last && last.key === key) last.events.push(event);
      else days.push({ key, date: event.occurred_at, events: [event] });
    }
    return days;
  }, [events]);

  const openTimelineFor = (nextColor = "", nextSize = "") => {
    setKind("");
    setColor(nextColor);
    setSize(nextSize);
    setTab("timeline");
  };

  const channelLabel = (value) => {
    const key = String(value || "").trim().toLowerCase();
    if (!key) return "";
    return t(`products.lifecycle.channels.${key}`, { defaultValue: value });
  };

  const movementLabel = (value) => {
    const key = String(value || "").trim().toUpperCase();
    return t(`products.lifecycle.movementTypes.${key}`, { defaultValue: key.replace(/_/g, " ").toLowerCase() });
  };

  const documentStatusLabel = (value) => {
    const key = String(value || "").trim().toLowerCase();
    if (!key) return "";
    return t(`products.lifecycle.statuses.${key}`, { defaultValue: key.replace(/_/g, " ") });
  };

  const renderEventTitle = (event) => {
    if (event.kind === "created") return t("products.lifecycle.events.created");
    if (event.kind === "purchase") return t("products.lifecycle.events.purchase");
    if (event.kind === "sale") return t("products.lifecycle.events.sale");
    return movementLabel(event.document_status);
  };

  const renderDocumentLink = (event) => {
    if (!event.document_id || !event.document_number) return null;
    const to = event.kind === "purchase" ? `/purchases/${event.document_id}` : event.kind === "sale" ? `/orders/${event.document_id}` : "";
    if (!to) return null;
    return (
      <Link
        to={to}
        onClick={() => onClose?.()}
        className="rounded-full px-2 py-0.5 text-xs font-black underline-offset-2 hover:underline"
        style={toneStyle(KIND_STYLE[event.kind].tone, 10)}
        dir="ltr"
      >
        {event.document_number}
      </Link>
    );
  };

  const renderEvent = (event) => {
    const { tone, Icon } = KIND_STYLE[event.kind] || KIND_STYLE.movement;
    const voided = Boolean(event.voided_at);
    const lines = [...(event.lines || [])].sort((a, b) => sizeOrder(a.size, b.size));
    const quantitySign = event.kind === "sale" ? -1 : 1;
    const extra = event.extra || {};
    const meta = [];
    if (event.kind === "created") {
      meta.push([t("products.lifecycle.fields.addedBy"), event.actor_name || t("products.lifecycle.unknownUser")]);
    } else if (event.kind === "purchase") {
      if (event.party_name) meta.push([t("products.lifecycle.fields.supplier"), event.party_name]);
      meta.push([t("products.lifecycle.fields.createdBy"), event.actor_name || t("products.lifecycle.unknownUser")]);
    } else if (event.kind === "sale") {
      if (extra.seller_name || event.actor_name) meta.push([t("products.lifecycle.fields.seller"), extra.seller_name || event.actor_name]);
      if (extra.cashier_name && extra.cashier_name !== extra.seller_name) meta.push([t("products.lifecycle.fields.cashier"), extra.cashier_name]);
      if (extra.created_by_name && ![extra.seller_name, extra.cashier_name].includes(extra.created_by_name)) {
        meta.push([t("products.lifecycle.fields.createdBy"), extra.created_by_name]);
      }
      if (event.party_name) meta.push([t("products.lifecycle.fields.customer"), event.party_name]);
      if (event.channel) meta.push([t("products.lifecycle.fields.channel"), channelLabel(event.channel)]);
    } else {
      meta.push([t("products.lifecycle.fields.by"), event.actor_name || t("products.lifecycle.unknownUser")]);
      if (extra.reason) meta.push([t("products.lifecycle.fields.reason"), extra.reason]);
    }

    return (
      <li key={event.key} className="relative flex gap-3 ps-1">
        <span className="relative z-[1] mt-1 grid h-9 w-9 shrink-0 place-items-center rounded-full" style={toneStyle(tone, 16)}>
          <Icon size={16} aria-hidden="true" />
        </span>
        <div
          className="min-w-0 flex-1 rounded-[var(--radius-card)] border border-border bg-surface-soft p-3"
          style={voided ? { opacity: 0.6 } : undefined}
        >
          <div className="flex flex-wrap items-center gap-2">
            <p className={`text-sm font-black text-text ${voided ? "line-through" : ""}`}>{renderEventTitle(event)}</p>
            {renderDocumentLink(event)}
            {event.color ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border py-0.5 pe-2 ps-0.5 text-[11px] font-bold text-text">
                <ColorThumb src={colorImages.get(event.color.trim().toLowerCase())} alt="" size={20} />
                {event.color}
              </span>
            ) : null}
            {event.kind === "sale" || event.kind === "purchase" ? (
              event.document_status ? <span className="text-[11px] font-bold text-text-muted">{documentStatusLabel(event.document_status)}</span> : null
            ) : null}
            <span className="ms-auto text-xs font-semibold text-text-muted" dir="ltr">{formatTime(event.occurred_at)}</span>
          </div>

          {voided ? (
            <p className="mt-1 text-xs font-bold" style={{ color: "var(--danger)" }}>
              {event.kind === "movement"
                ? t("products.lifecycle.undone", { by: event.voided_by_name || t("products.lifecycle.unknownUser"), at: formatDateTime(event.voided_at) })
                : extra.reversed && !extra.deleted
                  ? t("products.lifecycle.reversed", { at: formatDateTime(event.voided_at) })
                  : t("products.lifecycle.deleted", { by: event.voided_by_name || t("products.lifecycle.unknownUser"), at: formatDateTime(event.voided_at) })}
            </p>
          ) : null}

          {lines.length ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {lines.map((line, index) => (
                <span
                  key={`${line.variant_id || "x"}-${line.size}-${index}`}
                  className="inline-flex items-center gap-1 rounded-[10px] border border-border bg-surface px-2 py-1 text-xs"
                >
                  <span className="font-bold text-text-muted">{line.size || "—"}</span>
                  {line.quantity !== null && line.quantity !== undefined ? (
                    <bdi className="font-black" style={{ color: tone }} dir="ltr">
                      {event.kind === "movement" ? signed(line.quantity) : signed(line.quantity * quantitySign)}
                    </bdi>
                  ) : null}
                  {line.returned ? (
                    <span className="font-bold" style={{ color: "var(--danger)" }}>
                      {t("products.lifecycle.returnedCount", { count: line.returned })}
                    </span>
                  ) : null}
                  {event.kind === "movement" && line.before !== undefined && line.after !== undefined ? (
                    <bdi className="text-text-muted" dir="ltr">({line.before} → {line.after})</bdi>
                  ) : null}
                </span>
              ))}
            </div>
          ) : null}

          {meta.length ? (
            <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
              {meta.map(([label, value]) => (
                <div key={label} className="flex min-w-0 gap-1">
                  <dt className="text-text-muted">{label}:</dt>
                  <dd className="truncate font-bold text-text">{value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </div>
      </li>
    );
  };

  const stat = (label, value, hint = "") => (
    <div className="min-w-0 rounded-[var(--radius-card)] border border-border bg-surface-soft px-3 py-2">
      <p className="truncate text-[11px] font-bold text-text-muted">{label}</p>
      <p className="mt-0.5 truncate text-base font-black text-text">{value}</p>
      {hint ? <p className="truncate text-[11px] text-text-muted">{hint}</p> : null}
    </div>
  );

  const chip = (active, label, onClick, key) => (
    <button
      key={key}
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`shrink-0 rounded-full border px-3 py-1 text-xs font-bold transition ${active ? "border-transparent" : "border-border text-text-muted hover:text-text"}`}
      style={active ? { background: "var(--primary)", color: "var(--primary-contrast, #fff)" } : undefined}
    >
      {label}
    </button>
  );

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100150] flex items-center justify-center p-3 backdrop-blur-sm sm:p-6"
      // bg-black/* is remapped to a surface token app-wide; the scrim must stay dark.
      style={{ background: "rgba(8, 10, 14, 0.62)" }}
      dir={isArabic ? "rtl" : "ltr"}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex max-h-full w-full max-w-4xl flex-col overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface text-text shadow-2xl shadow-black/50"
        style={{ height: "min(860px, 100%)" }}
      >
        <header className="flex items-start gap-3 border-b border-border p-4 sm:p-5">
          {imageUrl ? (
            <img src={imageUrl} alt="" className="h-16 w-16 shrink-0 rounded-[var(--radius-card)] border border-border bg-white object-contain" />
          ) : (
            <span className="grid h-16 w-16 shrink-0 place-items-center rounded-[var(--radius-card)] border border-border bg-surface-soft text-text-muted">
              <Package2 size={24} />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 text-xs font-bold text-text-muted">
              <History size={14} aria-hidden="true" />
              {t("products.lifecycle.title")}
            </p>
            <h2 id={titleId} className="mt-0.5 truncate text-lg font-black text-text">{header.name || product?.name}</h2>
            {header.sku || header.product_code ? (
              <p className="truncate text-xs font-semibold text-text-muted" dir="ltr">{header.sku || header.product_code}</p>
            ) : null}
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={() => onClose?.()}
            aria-label={t("products.lifecycle.close")}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-border text-text-muted hover:text-text"
          >
            <X size={18} />
          </button>
        </header>

        {loading ? (
          <div className="grid flex-1 place-items-center p-10 text-text-muted" role="status">
            <span className="flex items-center gap-2 text-sm font-bold">
              <Loader2 size={18} className="animate-spin" />
              {t("products.lifecycle.loading")}
            </span>
          </div>
        ) : error ? (
          <div className="grid flex-1 place-items-center p-10 text-center" role="alert">
            <div>
              <p className="text-sm font-bold" style={{ color: "var(--danger)" }}>{error}</p>
            </div>
          </div>
        ) : (
          <>
            {summary ? (
              <div className="flex gap-2 overflow-x-auto border-b border-border p-3 sm:grid sm:grid-cols-5 sm:overflow-visible sm:p-4 sm:px-5 [&>*]:min-w-[118px] sm:[&>*]:min-w-0">
                {stat(t("products.lifecycle.summary.firstSeen"), formatDate(summary.first_seen_at), summary.first_seen_at ? formatTime(summary.first_seen_at) : "")}
                {stat(t("products.lifecycle.summary.colorsSizes"), `${summary.colors} / ${summary.sizes}`)}
                {stat(t("products.lifecycle.summary.purchased"), summary.purchased_quantity)}
                {stat(
                  t("products.lifecycle.summary.sold"),
                  summary.sold_quantity,
                  summary.returned_quantity ? t("products.lifecycle.returnedCount", { count: summary.returned_quantity }) : ""
                )}
                {stat(t("products.lifecycle.summary.stock"), summary.stock)}
              </div>
            ) : null}

            <div className="flex items-center gap-1 border-b border-border px-4 sm:px-5" role="tablist">
              {[
                ["variants", t("products.lifecycle.tabs.variants")],
                ["timeline", t("products.lifecycle.tabs.timeline")],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={tab === value}
                  onClick={() => setTab(value)}
                  className={`-mb-px border-b-2 px-3 py-2.5 text-sm font-black transition ${tab === value ? "text-text" : "border-transparent text-text-muted hover:text-text"}`}
                  style={tab === value ? { borderColor: "var(--primary)" } : undefined}
                >
                  {label}
                </button>
              ))}
            </div>

            <div data-lifecycle-scroll className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
              {tab === "variants" ? (
                colorGroups.length ? (
                  <div className="space-y-3">
                    {colorGroups.map((group) => (
                      <section key={group.key} className="overflow-hidden rounded-[var(--radius-card)] border border-border">
                        <div className="flex flex-wrap items-center gap-2 bg-surface-soft px-3 py-2">
                          <ColorThumb src={group.image} alt={group.label} size={52} />
                          <h3 className="text-sm font-black text-text">{group.label}</h3>
                          {group.archived ? (
                            <span className="rounded-full px-2 py-0.5 text-[10px] font-black" style={toneStyle("var(--danger)")}>{t("products.lifecycle.archived")}</span>
                          ) : null}
                          <span className="text-xs text-text-muted">
                            {t("products.lifecycle.groupTotals", { purchased: group.purchased, sold: group.sold, stock: group.stock })}
                          </span>
                          <button
                            type="button"
                            onClick={() => openTimelineFor(group.rawColor)}
                            className="ms-auto inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs font-bold text-text-muted hover:text-text"
                          >
                            <History size={13} aria-hidden="true" />
                            {t("products.lifecycle.colorHistory")}
                          </button>
                        </div>
                        <div className="sm:overflow-x-auto">
                          <table className="block w-full text-start text-xs sm:table sm:min-w-[540px]">
                            <thead className="hidden sm:table-header-group">
                              <tr className="border-t border-border text-text-muted">
                                <th className="px-3 py-2 text-start font-bold">{t("products.lifecycle.columns.size")}</th>
                                <th className="px-3 py-2 text-start font-bold">{t("products.lifecycle.columns.added")}</th>
                                <th className="px-3 py-2 text-start font-bold">{t("products.lifecycle.columns.purchased")}</th>
                                <th className="px-3 py-2 text-start font-bold">{t("products.lifecycle.columns.sold")}</th>
                                <th className="px-3 py-2 text-start font-bold">{t("products.lifecycle.columns.stock")}</th>
                                <th className="px-3 py-2" aria-label={t("products.lifecycle.colorHistory")} />
                              </tr>
                            </thead>
                            <tbody className="block sm:table-row-group">
                              {group.rows.map((row) => (
                                <tr key={row.id} className="grid grid-cols-2 border-t border-border sm:table-row" style={row.archived ? { opacity: 0.55 } : undefined}>
                                  <td className="col-span-2 px-3 pb-0 pt-2.5 text-sm font-black text-text sm:table-cell sm:py-2 sm:text-xs">
                                    {row.size || "—"}
                                    {row.article_code ? <span className="ms-1 font-semibold text-text-muted" dir="ltr">· {row.article_code}</span> : null}
                                  </td>
                                  <td className="block px-3 py-2 sm:table-cell">
                                    <span className="block text-[10px] font-bold text-text-muted sm:hidden">{t("products.lifecycle.columns.added")}</span>
                                    <p className="font-bold text-text">{formatDateTime(row.created_at)}</p>
                                    <p className="text-text-muted">{row.created_by_name || t("products.lifecycle.unknownUser")}</p>
                                  </td>
                                  <td className="block px-3 py-2 sm:table-cell">
                                    <span className="block text-[10px] font-bold text-text-muted sm:hidden">{t("products.lifecycle.columns.purchased")}</span>
                                    <p className="font-black" style={{ color: KIND_STYLE.purchase.tone }}>
                                      {row.purchased_quantity}
                                      <span className="ms-1 font-semibold text-text-muted">{t("products.lifecycle.invoiceCount", { count: row.purchase_invoices })}</span>
                                    </p>
                                    <p className="text-text-muted">
                                      {row.last_purchase_at ? t("products.lifecycle.lastAt", { at: formatDateTime(row.last_purchase_at) }) : t("products.lifecycle.never")}
                                    </p>
                                  </td>
                                  <td className="block px-3 py-2 sm:table-cell">
                                    <span className="block text-[10px] font-bold text-text-muted sm:hidden">{t("products.lifecycle.columns.sold")}</span>
                                    <p className="font-black" style={{ color: KIND_STYLE.sale.tone }}>
                                      {row.sold_quantity}
                                      <span className="ms-1 font-semibold text-text-muted">{t("products.lifecycle.invoiceCount", { count: row.sale_invoices })}</span>
                                      {row.returned_quantity ? (
                                        <span className="ms-1 font-bold" style={{ color: "var(--danger)" }}>{t("products.lifecycle.returnedCount", { count: row.returned_quantity })}</span>
                                      ) : null}
                                    </p>
                                    <p className="text-text-muted">
                                      {row.last_sale_at ? t("products.lifecycle.lastAt", { at: formatDateTime(row.last_sale_at) }) : t("products.lifecycle.never")}
                                    </p>
                                  </td>
                                  <td className="block px-3 py-2 font-black text-text sm:table-cell">
                                    <span className="block text-[10px] font-bold text-text-muted sm:hidden">{t("products.lifecycle.columns.stock")}</span>
                                    {row.archived ? t("products.lifecycle.archived") : row.stock}
                                  </td>
                                  <td className="col-span-2 block px-3 pb-2.5 pt-0 sm:table-cell sm:py-2 sm:text-end">
                                    <button
                                      type="button"
                                      onClick={() => openTimelineFor(row.color || "", row.size || "")}
                                      className="rounded-full border border-border px-2.5 py-1 font-bold text-text-muted hover:text-text"
                                    >
                                      {t("products.lifecycle.sizeHistory")}
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </section>
                    ))}
                  </div>
                ) : (
                  <p className="py-10 text-center text-sm text-text-muted">{t("products.lifecycle.noVariants")}</p>
                )
              ) : (
                <div>
                  <div className="space-y-2">
                    <div className="flex gap-1.5 overflow-x-auto pb-1">
                      {chip(!kind, t("products.lifecycle.kinds.all"), () => setKind(""), "all")}
                      {KINDS.map((value) => chip(kind === value, t(`products.lifecycle.kinds.${value}`), () => setKind(value), value))}
                    </div>
                    {colorGroups.length > 1 ? (
                      <div className="flex gap-1.5 overflow-x-auto pb-1">
                        {chip(!color, t("products.lifecycle.allColors"), () => { setColor(""); setSize(""); }, "all-colors")}
                        {colorGroups.map((group) =>
                          chip(
                            color.trim().toLowerCase() === group.key,
                            group.label,
                            () => { setColor(group.rawColor); setSize(""); },
                            group.key
                          )
                        )}
                      </div>
                    ) : null}
                    {sizeOptions.length > 1 ? (
                      <div className="flex gap-1.5 overflow-x-auto pb-1">
                        {chip(!size, t("products.lifecycle.allSizes"), () => setSize(""), "all-sizes")}
                        {sizeOptions.map((value) => chip(size === value, value, () => setSize(value), `size-${value}`))}
                      </div>
                    ) : null}
                    <p className="flex items-center gap-2 text-xs text-text-muted" aria-live="polite">
                      {t("products.lifecycle.eventCount", { count: eventsTotal })}
                      {eventsLoading ? <Loader2 size={13} className="animate-spin" /> : null}
                    </p>
                  </div>

                  {eventsByDay.length ? (
                    <div className="mt-3 space-y-5">
                      {eventsByDay.map((day) => (
                        <section key={day.key || "unknown"}>
                          <h3 className="sticky -top-4 z-[2] -mx-1 mb-2 bg-surface px-1 pb-1 pt-2 text-xs font-black text-text-muted sm:-top-5">
                            {formatDay(day.date)}
                          </h3>
                          <ol className="relative space-y-2 before:absolute before:bottom-2 before:start-[22px] before:top-2 before:w-px before:bg-[var(--border)]">
                            {day.events.map(renderEvent)}
                          </ol>
                        </section>
                      ))}
                    </div>
                  ) : !eventsLoading ? (
                    <p className="py-10 text-center text-sm text-text-muted">{t("products.lifecycle.noEvents")}</p>
                  ) : null}

                  {eventsError ? (
                    <div className="mt-3 flex items-center justify-center gap-2 text-sm" role="alert">
                      <span style={{ color: "var(--danger)" }}>{eventsError}</span>
                      <button
                        type="button"
                        onClick={() => loadEvents({ reset: events.length === 0 })}
                        className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs font-bold"
                      >
                        <RefreshCw size={12} />
                        {t("products.lifecycle.retry")}
                      </button>
                    </div>
                  ) : null}

                  {hasMore ? (
                    <div ref={sentinelRef} className="mt-4 flex justify-center">
                      <button
                        type="button"
                        disabled={eventsLoading}
                        onClick={() => loadEvents({ reset: false })}
                        className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-xs font-bold text-text-muted hover:text-text disabled:opacity-60"
                      >
                        {eventsLoading ? <Loader2 size={13} className="animate-spin" /> : <ArrowUpFromLine size={13} className="rotate-180" />}
                        {t("products.lifecycle.loadMore")}
                      </button>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
