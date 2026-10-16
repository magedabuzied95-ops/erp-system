import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { CheckCircle2, Loader2, Minus, Package, PackagePlus, Plus, Search, Send, Trash2, X } from "lucide-react";
import toast from "react-hot-toast";

import EmployeePortalNavControls, { buildEmployeePortalHomePath, canNavigateEmployeePortalBack } from "../components/EmployeePortalNavControls";
import usePortalCatalog from "../hooks/usePortalCatalog";
import { getCountSearchIndex, searchCountIndex } from "../services/employeeDrafts/countSearchIndex.js";
import { createEmployeePortalStockReceipt, listEmployeePortalStockReceipts } from "../services/employeePortalInventoryApi";
import { resolveProductImageUrl } from "../../../shared/lib/imageUrls";
import { formatInAppTimezone } from "../../../shared/lib/appTimezone";
import usePageTitle from "../../../shared/hooks/usePageTitle";
import "./EmployeePortalWorkspaces.m1.css";

// استلام بضاعة: the employee finds a model the shop already has (same search as
// the stock count), types how many new pieces arrived per size, and sends it.
// The server turns it into a DRAFT purchase invoice — stock does not move until
// the owner opens it in المشتريات, sets the supplier and prices, and saves.

const formatNumber = (value) => new Intl.NumberFormat("ar-EG").format(Number(value || 0));
const newRef = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `r-${Date.now()}-${Math.random().toString(36).slice(2)}`);
const sheetKey = (token) => `employee-stock-receipt:${token}`;

// The sheet survives a reload or a closed tab: a half-typed delivery is real work.
const readSheet = (token) => {
  try {
    const raw = window.localStorage.getItem(sheetKey(token));
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && Array.isArray(parsed.groups)) return { groups: parsed.groups, notes: String(parsed.notes || ""), ref: String(parsed.ref || newRef()) };
  } catch { /* storage blocked or corrupt: start empty */ }
  return { groups: [], notes: "", ref: newRef() };
};

const STATUS_LABEL = {
  draft: { label: "مستني الإدارة", tone: "bg-primary/10 text-primary border-primary/20" },
  received: { label: "اتعملت فاتورة", tone: "bg-emerald-500/10 text-emerald-600 border-emerald-400/30" },
  cancelled: { label: "اتلغت", tone: "bg-rose-500/10 text-rose-600 border-rose-400/30" },
};

export default function EmployeePortalStockReceipt() {
  usePageTitle("Stock Receipt");
  const navigate = useNavigate();
  const { token = "" } = useParams();
  const location = useLocation();
  const { snapshot, refreshing, refresh } = usePortalCatalog(token);
  // Back from إضافة منتج: skip the catalogue's recheck window once, so the
  // model just added is in the search.
  const refreshAsked = Boolean(location.state?.refreshCatalog);
  useEffect(() => {
    if (refreshAsked) void refresh({ force: true });
  }, [refreshAsked, refresh]);
  const index = useMemo(() => (snapshot ? getCountSearchIndex(snapshot) : []), [snapshot]);

  const initial = useMemo(() => readSheet(token), [token]);
  const [groups, setGroups] = useState(initial.groups);
  const [notes, setNotes] = useState(initial.notes);
  const [clientRef, setClientRef] = useState(initial.ref);
  const [query, setQuery] = useState("");
  const [sending, setSending] = useState(false);
  const [receipts, setReceipts] = useState([]);
  const searchRef = useRef(null);

  useEffect(() => {
    try {
      window.localStorage.setItem(sheetKey(token), JSON.stringify({ groups, notes, ref: clientRef }));
    } catch { /* private mode: the sheet just won't survive a reload */ }
  }, [token, groups, notes, clientRef]);

  const loadReceipts = () => {
    if (!token) return;
    listEmployeePortalStockReceipts(token)
      .then((res) => setReceipts(Array.isArray(res?.receipts) ? res.receipts : []))
      .catch(() => null);
  };
  useEffect(loadReceipts, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  const results = useMemo(() => {
    if (!query.trim()) return [];
    return searchCountIndex(index, query, { limit: 20 }).groups;
  }, [index, query]);

  const onSheet = useMemo(() => new Set(groups.map((group) => group.key)), [groups]);
  const totalUnits = groups.reduce((sum, group) => sum + group.sizes.reduce((acc, size) => acc + (Number(size.qty) || 0), 0), 0);

  const addGroup = (group) => {
    if (onSheet.has(group.key)) {
      document.getElementById(`receipt-${group.key}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      setQuery("");
      return;
    }
    const sizes = (group.variants || [])
      .filter((row) => row.product_variant_id)
      .map((row) => ({ variant_id: String(row.product_variant_id), size: String(row.size || ""), stock: Number(row.stock || 0), qty: 0 }));
    if (!sizes.length) {
      toast.error("الموديل ده مالوش مقاسات");
      return;
    }
    setGroups((current) => [{
      key: group.key,
      product_name: group.product_name,
      color: group.color,
      image_url: group.image_url || "",
      sizes,
    }, ...current]);
    setQuery("");
  };

  const setQty = (groupKey, variantId, value) => {
    const qty = Math.max(0, Math.min(9999, Math.floor(Number(value) || 0)));
    setGroups((current) => current.map((group) => (group.key !== groupKey ? group : {
      ...group,
      sizes: group.sizes.map((size) => (size.variant_id === variantId ? { ...size, qty } : size)),
    })));
  };

  const removeGroup = (groupKey) => setGroups((current) => current.filter((group) => group.key !== groupKey));

  const send = async () => {
    const lines = groups.flatMap((group) => group.sizes.filter((size) => size.qty > 0).map((size) => ({ variant_id: size.variant_id, quantity: size.qty })));
    if (!lines.length) {
      toast.error("اكتب كمية لمقاس واحد على الأقل");
      return;
    }
    try {
      setSending(true);
      await createEmployeePortalStockReceipt(token, { lines, notes, client_ref: clientRef });
      toast.success(`اتبعت ${formatNumber(totalUnits)} قطعة للإدارة`);
      setGroups([]);
      setNotes("");
      setClientRef(newRef());
      loadReceipts();
    } catch (error) {
      toast.error(error?.responseBody?.message || error?.message || "تعذر الإرسال، جرّب تاني");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="employee-portal-workspace min-h-screen bg-background px-3 py-3 pb-28 text-text sm:px-4 sm:py-4">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
        <EmployeePortalNavControls
          onBack={() => {
            if (canNavigateEmployeePortalBack()) navigate(-1);
            else navigate(buildEmployeePortalHomePath({ pathname: window.location.pathname, token }), { replace: true });
          }}
          onHome={() => navigate(buildEmployeePortalHomePath({ pathname: window.location.pathname, token }))}
          className="px-0"
        />

        <section className="rounded-[var(--radius-card)] border border-border bg-surface p-3 shadow-[var(--shadow-card)]">
          <h1 className="m1-page-title flex items-center gap-2 text-text"><PackagePlus className="h-6 w-6" /> استلام بضاعة</h1>
          <p className="mt-1 text-sm font-semibold leading-6 text-text-muted">
            دوّر على الموديل واكتب الكمية الجديدة لكل مقاس. هتتبعت للإدارة مسودة فاتورة مشتريات، والمخزون مش هيتغير غير لما تتحفظ.
          </p>

          {/* A model the shop doesn't have yet: the ERP's own Add Product page at
              desktop width, no ERP login (EmployeePortalProductCreate). A save
              comes back here with a fresh catalogue. */}
          {/* The system's products list and editor too, same page as the ERP;
              every edit is recorded under this employee. */}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => navigate(`${buildEmployeePortalHomePath({ pathname: window.location.pathname, token })}/new-product`)}
              onPointerEnter={() => { void import("./EmployeePortalProductCreate"); }}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-control)] border border-border bg-surface-soft px-3 text-sm font-black text-text transition hover:bg-surface"
            >
              <Plus className="h-4 w-4" />
              إضافة منتج
            </button>
            <button
              type="button"
              onClick={() => navigate(`${buildEmployeePortalHomePath({ pathname: window.location.pathname, token })}/erp-products`)}
              onPointerEnter={() => { void import("./EmployeePortalProductCreate"); }}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-control)] border border-border bg-surface-soft px-3 text-sm font-black text-text transition hover:bg-surface"
            >
              <Package className="h-4 w-4" />
              المنتجات
            </button>
          </div>

          <label className="mt-3 flex items-center gap-2 rounded-[var(--radius-control)] border border-border bg-surface-soft px-3">
            <Search className="h-4 w-4 shrink-0 text-text-muted" />
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={snapshot ? "اسم الموديل أو الكود" : "بيحمّل الموديلات…"}
              className="min-h-12 w-full bg-transparent text-base font-semibold text-text outline-none placeholder:text-text-muted"
            />
            {query ? (
              <button type="button" onClick={() => setQuery("")} aria-label="مسح" className="p-1 text-text-muted"><X className="h-4 w-4" /></button>
            ) : refreshing && !snapshot ? <Loader2 className="h-4 w-4 animate-spin text-text-muted" /> : null}
          </label>

          {query.trim() ? (
            <div className="mt-2 max-h-[55vh] divide-y divide-border overflow-y-auto rounded-[var(--radius-control)] border border-border bg-surface">
              {results.length ? results.map((group) => {
                const image = group.image_url ? resolveProductImageUrl(group.image_url) : "";
                return (
                  <button
                    key={group.key}
                    type="button"
                    onClick={() => addGroup(group)}
                    className="flex w-full items-center gap-3 p-2.5 text-start transition hover:bg-surface-soft"
                  >
                    <span className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-[var(--radius-control)] border border-border bg-surface-soft">
                      {image ? <img src={image} alt="" className="h-full w-full object-cover" loading="lazy" /> : <Package className="h-5 w-5 text-text-muted" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span dir="auto" className="block truncate text-sm font-black text-text">{group.product_name}</span>
                      <span className="block truncate text-xs font-bold text-text-muted">
                        {[group.color, `${formatNumber(group.sizes?.length || 0)} مقاس`, `مخزون ${formatNumber(group.stock)}`].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    {onSheet.has(group.key)
                      ? <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" />
                      : <Plus className="h-5 w-5 shrink-0 text-primary" />}
                  </button>
                );
              }) : (
                <div className="p-4 text-center text-sm font-bold text-text-muted">{snapshot ? "مفيش موديل بالاسم ده" : "بيحمّل الموديلات…"}</div>
              )}
            </div>
          ) : null}
        </section>

        {groups.map((group) => {
          const image = group.image_url ? resolveProductImageUrl(group.image_url) : "";
          const units = group.sizes.reduce((sum, size) => sum + (Number(size.qty) || 0), 0);
          return (
            <article key={group.key} id={`receipt-${group.key}`} className="rounded-[var(--radius-card)] border border-border bg-surface p-3 shadow-[var(--shadow-card)]">
              <div className="flex items-center gap-3">
                <span className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-[var(--radius-control)] border border-border bg-surface-soft">
                  {image ? <img src={image} alt="" className="h-full w-full object-cover" loading="lazy" /> : <Package className="h-5 w-5 text-text-muted" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div dir="auto" className="truncate text-base font-black text-text">{group.product_name}</div>
                  <div className="truncate text-xs font-bold text-text-muted">{[group.color, units ? `${formatNumber(units)} قطعة جديدة` : "اكتب الكميات"].filter(Boolean).join(" · ")}</div>
                </div>
                <button type="button" onClick={() => removeGroup(group.key)} aria-label="شيل الموديل" className="rounded-full border border-border p-2 text-text-muted hover:text-text">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {group.sizes.map((size) => (
                  <div key={size.variant_id} className={`rounded-[var(--radius-control)] border p-2 ${size.qty > 0 ? "border-primary bg-primary/5" : "border-border bg-surface-soft"}`}>
                    <div className="flex items-center justify-between gap-1 text-xs font-black">
                      <span className="truncate text-sm text-text">{size.size || "بدون مقاس"}</span>
                      <span className="shrink-0 text-text-muted">{`موجود ${formatNumber(size.stock)}`}</span>
                    </div>
                    <div className="mt-2 grid grid-cols-[2.5rem_minmax(0,1fr)_2.5rem] gap-1">
                      <button type="button" aria-label="أقل" onClick={() => setQty(group.key, size.variant_id, size.qty - 1)} className="grid h-10 place-items-center rounded-[var(--radius-control)] border border-border bg-surface text-text"><Minus className="h-4 w-4" /></button>
                      <input
                        inputMode="numeric"
                        value={size.qty ? String(size.qty) : ""}
                        placeholder="0"
                        onChange={(event) => setQty(group.key, size.variant_id, event.target.value.replace(/[^0-9]/g, ""))}
                        className="h-10 w-full min-w-0 rounded-[var(--radius-control)] border border-border bg-surface text-center text-base font-black text-text outline-none"
                      />
                      <button type="button" aria-label="أكتر" onClick={() => setQty(group.key, size.variant_id, size.qty + 1)} className="grid h-10 place-items-center rounded-[var(--radius-control)] border border-border bg-surface text-text"><Plus className="h-4 w-4" /></button>
                    </div>
                  </div>
                ))}
              </div>
            </article>
          );
        })}

        {groups.length ? (
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={2}
            placeholder="ملاحظة للإدارة (اختياري) — مثلاً اسم المورد"
            className="w-full rounded-[var(--radius-card)] border border-border bg-surface px-3 py-2 text-base font-semibold text-text outline-none placeholder:text-text-muted"
          />
        ) : (
          <div className="rounded-[var(--radius-card)] border border-dashed border-border p-6 text-center text-sm font-bold text-text-muted">
            دوّر على موديل فوق وضيفه علشان تكتب الكميات
          </div>
        )}

        {receipts.length ? (
          <section className="rounded-[var(--radius-card)] border border-border bg-surface p-3">
            <h2 className="m1-section-title text-text">اللي بعته قبل كده</h2>
            <div className="mt-2 divide-y divide-border">
              {receipts.map((receipt) => {
                const status = STATUS_LABEL[String(receipt.status || "").toLowerCase()] || STATUS_LABEL.received;
                return (
                  <div key={receipt.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                    <div className="min-w-0">
                      <div className="font-black text-text">{`${formatNumber(receipt.units)} قطعة · ${formatNumber(receipt.line_count)} مقاس`}</div>
                      <div className="text-xs font-bold text-text-muted">{formatInAppTimezone(receipt.created_at, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</div>
                    </div>
                    <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-black ${status.tone}`}>{status.label}</span>
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}
      </div>

      {groups.length ? (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface px-3 pt-2 pb-[calc(env(safe-area-inset-bottom,0px)+0.5rem)] shadow-[var(--shadow-overlay)]">
          <button
            type="button"
            onClick={() => void send()}
            disabled={sending || !totalUnits}
            className="mx-auto flex min-h-12 w-full max-w-3xl items-center justify-center gap-2 rounded-[var(--radius-control)] bg-primary px-4 text-base font-black text-[var(--primary-contrast)] disabled:opacity-50"
          >
            {sending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
            {totalUnits ? `ابعت للإدارة (${formatNumber(totalUnits)} قطعة)` : "اكتب الكميات"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
