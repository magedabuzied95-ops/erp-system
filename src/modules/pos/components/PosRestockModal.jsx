import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { BellRing, Loader2, Search, X } from "lucide-react";

import { api } from "../../../shared/api/api";
import RestockRequestsPanel from "../../aiSupport/components/RestockRequestsPanel";
import ProductCardPicker from "../../aiSupport/components/ProductCardPicker";
import { matchesPhoneSearch, normalizePhone } from "../lib/phoneSearch";

const text = (value = "") => String(value ?? "").trim();
const customerPhone = (customer = {}) => text(customer?.phone || customer?.mobile || customer?.whatsapp || "");

/**
 * POS entry to the same restock-request surface the AI Inbox uses: pick the
 * customer, then the panel (list + order-style create cart + settings gear) and
 * the catalogue picker are the exact components the customer 360 drawer mounts.
 * Anything improved there lands here untouched.
 */
export default function PosRestockModal({ open = false, onClose = null, customers = [], initialCustomer = null }) {
  const { t } = useTranslation();
  const [customer, setCustomer] = useState(initialCustomer || null);
  const [search, setSearch] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [restockPick, setRestockPick] = useState(null);
  const [remote, setRemote] = useState({ term: "", rows: [], loading: false });
  const remoteTimer = useRef(null);

  // Re-seed from the POS selection each time the modal opens.
  useEffect(() => {
    if (!open) return;
    setCustomer(initialCustomer || null);
    setSearch("");
    setRestockPick(null);
    setPickerOpen(false);
  }, [open, initialCustomer]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => { if (event.key === "Escape" && !pickerOpen) onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, pickerOpen, onClose]);

  // The POS preloads only ~200 customers; the rest live server-side, so the
  // search asks /customers the way the POS header does and merges the answer.
  useEffect(() => {
    const term = text(search);
    if (remoteTimer.current) clearTimeout(remoteTimer.current);
    if (term.length < 2) { setRemote({ term: "", rows: [], loading: false }); return undefined; }
    setRemote((current) => ({ ...current, loading: true }));
    remoteTimer.current = setTimeout(async () => {
      try {
        const data = await api.get("/customers", { params: { limit: 30, page: 1, search: term }, suppressErrorStatuses: [400, 403, 404, 500] });
        const payload = data?.data ?? data;
        const rows = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.customers) ? payload.customers : [];
        setRemote({ term, rows, loading: false });
      } catch {
        setRemote({ term, rows: [], loading: false });
      }
    }, 250);
    return () => { if (remoteTimer.current) clearTimeout(remoteTimer.current); };
  }, [search]);

  const matches = useMemo(() => {
    const needle = text(search).toLowerCase();
    if (!needle) return [];
    const digits = normalizePhone(search).replace(/\D/g, "");
    const seen = new Set();
    const pool = [...(Array.isArray(customers) ? customers : []), ...(remote.term === text(search) ? remote.rows : [])].filter((item) => {
      const key = String(item?.id || item?.customer_id || customerPhone(item) || "");
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return pool
      .filter((item) => {
        const haystack = `${item?.name || ""} ${item?.phone || ""} ${item?.mobile || ""} ${item?.whatsapp || ""}`.toLowerCase();
        if (haystack.includes(needle)) return true;
        if (!digits) return false;
        return [item?.phone, item?.mobile, item?.whatsapp].some((value) => matchesPhoneSearch(value, search));
      })
      .slice(0, 8);
  }, [customers, remote, search]);

  if (!open || typeof document === "undefined") return null;

  const phone = customerPhone(customer);
  const name = text(customer?.name || customer?.customer_name || "");

  return createPortal(
    <>
      <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/60 p-3 backdrop-blur-[2px]" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose?.(); }}>
        <div role="dialog" aria-modal="true" aria-label={t("pos.restock.title")} className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--surface-soft)] text-[var(--text)] shadow-[0_30px_80px_rgba(0,0,0,0.5)]">
          <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="grid h-9 w-9 place-items-center rounded-xl border border-[var(--primary)]/40 bg-[var(--primary)]/10 text-[var(--primary)]"><BellRing className="h-4 w-4" /></span>
              <div>
                <div className="text-sm font-black">{t("pos.restock.title")}</div>
                <div className="text-[10px] text-[var(--muted)]">{t("pos.restock.subtitle")}</div>
              </div>
            </div>
            <button type="button" onClick={() => onClose?.()} aria-label={t("pos.restock.close")} className="grid h-8 w-8 place-items-center rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)]"><X className="h-4 w-4" /></button>
          </div>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
            {/* Customer: the POS selection is the default, but a restock request is
                often for someone who is NOT buying right now, so the search is here too. */}
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3">
              <div className="text-[11px] font-black uppercase tracking-[0.14em] text-[var(--muted)]">{t("pos.restock.customer")}</div>
              {customer ? (
                <div className="mt-2 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-black">{name || t("pos.restock.unnamed")}</div>
                    <div className="text-xs text-[var(--text-secondary)]" dir="ltr">{phone || t("pos.restock.noPhone")}</div>
                  </div>
                  <button type="button" onClick={() => { setCustomer(null); setSearch(""); }} className="shrink-0 rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] px-2.5 py-1 text-[11px] font-black text-[var(--text)] hover:border-[var(--primary)] hover:text-[var(--primary)]">{t("pos.restock.changeCustomer")}</button>
                </div>
              ) : (
                <div className="relative mt-2">
                  <Search className="pointer-events-none absolute inset-y-0 start-3 my-auto h-4 w-4 text-[var(--muted)]" />
                  <input
                    autoFocus
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder={t("pos.restock.searchCustomer")}
                    className="h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] ps-9 pe-3 text-sm text-[var(--text)] outline-none focus:border-[var(--primary)]"
                  />
                  {matches.length ? (
                    <div className="mt-2 max-h-56 space-y-1 overflow-y-auto">
                      {matches.map((item) => (
                        <button key={item.id || item.customer_id || customerPhone(item)} type="button" onClick={() => setCustomer(item)} className="flex w-full items-center justify-between gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-2 text-start hover:border-[var(--primary)]">
                          <span className="truncate text-sm font-black">{text(item.name) || t("pos.restock.unnamed")}</span>
                          <span className="shrink-0 text-xs text-[var(--text-secondary)]" dir="ltr">{customerPhone(item)}</span>
                        </button>
                      ))}
                    </div>
                  ) : remote.loading ? (
                    <div className="mt-2 flex items-center gap-2 text-xs text-[var(--muted)]"><Loader2 className="h-3.5 w-3.5 animate-spin" />{t("pos.restock.searching")}</div>
                  ) : text(search).length >= 2 ? (
                    <div className="mt-2 text-xs text-[var(--muted)]">{t("pos.restock.noMatches")}</div>
                  ) : null}
                </div>
              )}
            </div>

            {customer && !phone ? (
              <div className="rounded-xl border border-amber-300/40 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-700">{t("pos.restock.phoneRequired")}</div>
            ) : null}

            {customer && phone ? (
              <RestockRequestsPanel
                phone={phone}
                customerId={customer.id || customer.customer_id || null}
                source="admin"
                sourceReference="pos"
                onRequestPick={() => setPickerOpen(true)}
                restockPick={restockPick}
                onClearRestockPick={() => setRestockPick(null)}
              />
            ) : null}
          </div>
        </div>
      </div>

      <ProductCardPicker
        open={pickerOpen}
        mode="desktopInbox"
        restockMode
        allowMultiple
        onClose={() => setPickerOpen(false)}
        onSubmit={(cards) => {
          const picked = (Array.isArray(cards) ? cards : []).filter((card) => card && (card.product_id || card.id));
          if (picked.length) setRestockPick({ batch: performance.now(), cards: picked.map((card) => ({ ...card, product_id: card.product_id || card.id })) });
          setPickerOpen(false);
          return Promise.resolve();
        }}
      />
    </>,
    document.body
  );
}
