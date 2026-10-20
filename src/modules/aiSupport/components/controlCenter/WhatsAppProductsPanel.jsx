// WhatsApp catalogue products — inbox top bar → WhatsApp → Products.
//
// What Meta's catalogue holds, read live page by page (nothing is stored here). Each row says
// whether its retailer id is one of our sizes — the feed publishes a size under its SKU or as
// "<productId>-<variantId>" — so an item customers can order but the ERP cannot match stands out.
// Server: GET /api/whatsapp/commerce/catalogs/:catalogId/products.

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Image as ImageIcon, Link2, Search } from "lucide-react";

import { api } from "../../../../shared/api/api";
import ThemedSelect from "../../../../shared/ui/ThemedSelect";
import { ActionButton, PanelSkeleton, clean } from "../integrations/integrationsUi.jsx";

const SUPPRESSED = { suppressErrorStatuses: [400, 403, 404, 409, 500, 502, 504] };
const selectTrigger = "h-9 w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 text-xs font-bold text-white";

const AVAILABILITY_TONE = {
  "in stock": "border-emerald-300/25 bg-emerald-400/10 text-emerald-100",
  "out of stock": "border-rose-300/25 bg-rose-400/10 text-rose-100",
};
const availabilityLabel = (t, value) => {
  if (value === "in stock") return t("aiSupport.waCommerce.products.availability.inStock");
  if (value === "out of stock") return t("aiSupport.waCommerce.products.availability.outOfStock");
  if (value === "preorder") return t("aiSupport.waCommerce.products.availability.preorder");
  if (value === "available for order") return t("aiSupport.waCommerce.products.availability.availableForOrder");
  return value;
};

export default function WhatsAppProductsPanel({ headers }) {
  const { t } = useTranslation();
  const [catalogs, setCatalogs] = useState([]);
  const [catalogId, setCatalogId] = useState("");
  const [booting, setBooting] = useState(true);
  const [loading, setLoading] = useState(false);
  const [products, setProducts] = useState([]);
  const [paging, setPaging] = useState({ after: "", before: "" });
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const mountedRef = useRef(true);

  useEffect(() => () => { mountedRef.current = false; }, []);

  useEffect(() => {
    (async () => {
      try {
        const payload = await api.get("/whatsapp/commerce/catalogs", { headers, ...SUPPRESSED });
        const list = Array.isArray(payload?.catalogs) ? payload.catalogs : [];
        const fallbackId = clean(payload?.settings_catalog_id);
        const options = list.length ? list : /^\d+$/.test(fallbackId) ? [{ catalog_id: fallbackId, name: "" }] : [];
        if (!mountedRef.current) return;
        setCatalogs(options);
        setCatalogId((current) => current || options[0]?.catalog_id || "");
      } catch (loadError) {
        if (mountedRef.current) setError(loadError?.message || t("aiSupport.waCommerce.products.loadFailed"));
      } finally {
        if (mountedRef.current) setBooting(false);
      }
    })();
  }, [headers, t]);

  const fetchPage = useCallback(async ({ after = "", before = "" } = {}) => {
    if (!catalogId) return false;
    setLoading(true);
    setError("");
    try {
      const params = { limit: 50 };
      if (search) params.search = search;
      if (after) params.after = after;
      if (before) params.before = before;
      const payload = await api.get(`/whatsapp/commerce/catalogs/${encodeURIComponent(catalogId)}/products`, { headers, params, ...SUPPRESSED });
      if (!mountedRef.current) return false;
      setProducts(Array.isArray(payload?.products) ? payload.products : []);
      setPaging({ after: clean(payload?.paging?.after), before: clean(payload?.paging?.before) });
      return true;
    } catch (loadError) {
      if (mountedRef.current) {
        setProducts([]);
        setPaging({ after: "", before: "" });
        setError(loadError?.message || t("aiSupport.waCommerce.products.loadFailed"));
      }
      return false;
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [catalogId, headers, search, t]);

  useEffect(() => {
    setPage(1);
    void fetchPage();
  }, [fetchPage]);

  const next = async () => { if (await fetchPage({ after: paging.after })) setPage((value) => value + 1); };
  const previous = async () => { if (await fetchPage({ before: paging.before })) setPage((value) => Math.max(1, value - 1)); };

  if (booting) return <PanelSkeleton rows={3} />;

  if (!catalogs.length) {
    return <p className="rounded-xl border border-white/10 bg-white/[0.035] p-4 text-center text-xs text-slate-400">{error || t("aiSupport.waCommerce.products.noCatalog")}</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {catalogs.length > 1 ? (
          <div className="w-56">
            <ThemedSelect
              value={catalogId}
              onChange={(value) => setCatalogId(value)}
              options={catalogs.map((item) => ({ value: item.catalog_id, label: item.name || item.catalog_id }))}
              triggerClassName={selectTrigger}
            />
          </div>
        ) : (
          <span dir="auto" className="text-xs font-black text-slate-300">{catalogs[0].name || catalogs[0].catalog_id}</span>
        )}
        <form
          className="ms-auto flex items-center gap-1.5"
          onSubmit={(event) => { event.preventDefault(); setSearch(clean(query)); }}
        >
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("aiSupport.waCommerce.products.search")}
            className="h-8 w-56 rounded-full border border-white/10 bg-slate-950/70 px-3 text-xs font-bold text-white outline-none placeholder:text-slate-600 focus:border-cyan-300/40"
          />
          <button type="submit" className="grid h-8 w-8 place-items-center rounded-full border border-white/10 bg-white/[0.05] text-slate-200 hover:bg-white/10" aria-label={t("aiSupport.waCommerce.products.search")}>
            <Search className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </form>
      </div>

      {error ? <p dir="auto" className="rounded-xl border border-amber-300/20 bg-amber-400/10 p-2.5 text-xs font-bold text-amber-100">{error}</p> : null}

      <div className={`overflow-x-auto rounded-2xl border border-white/10 transition ${loading ? "opacity-60" : ""}`}>
        <table className="w-full min-w-[640px] text-start text-xs">
          <thead className="bg-white/[0.04] text-[10.5px] uppercase tracking-[0.12em] text-slate-500">
            <tr>
              <th className="px-3 py-2 text-start">{t("aiSupport.waCommerce.products.columns.name")}</th>
              <th className="px-3 py-2 text-start">{t("aiSupport.waCommerce.products.columns.retailerId")}</th>
              <th className="px-3 py-2 text-start">{t("aiSupport.waCommerce.products.columns.price")}</th>
              <th className="px-3 py-2 text-start">{t("aiSupport.waCommerce.products.columns.availability")}</th>
              <th className="px-3 py-2 text-start">{t("aiSupport.waCommerce.products.columns.erp")}</th>
            </tr>
          </thead>
          <tbody>
            {products.map((item) => (
              <tr key={item.id} className="border-t border-white/5 text-slate-200">
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2.5">
                    {item.image_url ? (
                      <img src={item.image_url} alt="" loading="lazy" className="h-10 w-10 shrink-0 rounded-lg border border-white/10 object-cover" />
                    ) : (
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/[0.04] text-slate-600"><ImageIcon className="h-4 w-4" aria-hidden="true" /></span>
                    )}
                    {item.url ? (
                      <a href={item.url} target="_blank" rel="noreferrer" dir="auto" className="min-w-0 font-black hover:underline">{item.name}</a>
                    ) : (
                      <span dir="auto" className="min-w-0 font-black">{item.name}</span>
                    )}
                  </div>
                </td>
                <td className="px-3 py-2 text-slate-400" dir="ltr">{item.retailer_id}</td>
                <td className="px-3 py-2 font-black" dir="ltr">{item.price}</td>
                <td className="px-3 py-2">
                  {item.availability ? (
                    <span className={`inline-flex h-6 items-center rounded-full border px-2.5 text-[10.5px] font-black ${AVAILABILITY_TONE[item.availability] || "border-white/10 bg-white/[0.06] text-slate-300"}`}>
                      {availabilityLabel(t, item.availability)}
                    </span>
                  ) : null}
                </td>
                <td className="px-3 py-2">
                  {item.erp ? (
                    <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-200" title={[item.erp.product_name, item.erp.color, item.erp.size].filter(Boolean).join(" · ")}>
                      <Link2 className="h-3 w-3" aria-hidden="true" />
                      #{item.erp.product_id}{item.erp.size ? ` · ${item.erp.size}` : ""}
                    </span>
                  ) : (
                    <span className="text-[11px] text-slate-500">{t("aiSupport.waCommerce.products.notMapped")}</span>
                  )}
                </td>
              </tr>
            ))}
            {!products.length && !loading ? (
              <tr><td colSpan={5} className="px-3 py-10 text-center text-slate-500">{t("aiSupport.waCommerce.products.empty")}</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {paging.after || paging.before || page > 1 ? (
        <div className="flex items-center justify-end gap-2">
          <ActionButton disabled={!paging.before || loading} onClick={previous}>{t("aiSupport.waCommerce.products.previous")}</ActionButton>
          <span className="text-[11px] font-black text-slate-500">{t("aiSupport.waCommerce.products.page", { page })}</span>
          <ActionButton disabled={!paging.after || loading} onClick={next}>{t("aiSupport.waCommerce.products.next")}</ActionButton>
        </div>
      ) : null}
    </div>
  );
}
