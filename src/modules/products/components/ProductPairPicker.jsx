import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Link2, Loader2, Search, X } from "lucide-react";

import { SECTION_PANEL_CLASSES, buttonClasses } from "../lib/formChrome";
import { getProductPair, getProductsAdminList, setProductPair } from "../services/productsApi";
import { resolveProductImageUrl } from "../../../shared/lib/imageUrls";

/* "Pairs well with" — which product the storefront suggests beside this one.
 *
 * Saved the moment it is picked, on its own endpoint, not with the product form:
 * a pairing is a merchandising choice, and it should not wait on — or be lost
 * with — an unrelated edit to prices or variants. No pin means the storefront
 * picks a product for the same audience automatically. */
export default function ProductPairPicker({ productId, t }) {
  const text = (key, fallback) => t(`products.editor.pair.${key}`, fallback);
  const [pair, setPair] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (!productId) return undefined;
    let active = true;
    setLoading(true);
    getProductPair(productId)
      .then((value) => { if (active) setPair(value); })
      .catch(() => { if (active) setPair(null); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [productId]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setResults([]); return undefined; }
    let active = true;
    const timer = setTimeout(async () => {
      try {
        setSearching(true);
        const { products } = await getProductsAdminList({ params: { search: q, limit: 8 } });
        if (!active) return;
        setResults((Array.isArray(products) ? products : []).filter((item) => String(item.id) !== String(productId)));
      } catch {
        if (active) setResults([]);
      } finally {
        if (active) setSearching(false);
      }
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [productId, query]);

  const save = async (nextId) => {
    setSaving(true);
    try {
      const saved = await setProductPair(productId, nextId);
      setPair(saved);
      setQuery("");
      setResults([]);
      toast.success(nextId ? text("saved", "Pair saved") : text("cleared", "Back to the automatic pick"));
    } catch (error) {
      toast.error(error?.responseBody?.message || error?.message || text("saveFailed", "Could not save the pair"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`${SECTION_PANEL_CLASSES} mt-4 p-4`}>
      <div className="flex items-center gap-2 text-sm font-bold text-text">
        <Link2 size={16} className="text-text-muted" />
        {text("title", "Pairs well with")}
      </div>
      <p className="mt-1 text-xs text-text-muted">
        {text("hint", "The product suggested under the buy buttons on the storefront. Leave it empty and the store picks one for the same audience. Saved immediately.")}
      </p>

      <div className="mt-3">
        {loading ? (
          <div className="flex items-center gap-2 text-xs text-text-muted"><Loader2 size={14} className="animate-spin" />{text("loading", "Loading…")}</div>
        ) : pair ? (
          <div className="flex items-center gap-3 rounded-[var(--radius-control)] border border-border bg-surface p-2">
            {pair.image_url ? (
              <img src={resolveProductImageUrl(pair.image_url)} alt="" className="h-12 w-12 shrink-0 rounded-[var(--radius-control)] bg-white object-contain p-1" />
            ) : null}
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-text">{pair.name}</div>
              <div className="text-xs text-text-muted">#{pair.id}</div>
            </div>
            <button type="button" onClick={() => save(null)} disabled={saving} className={buttonClasses("ghost", "h-9 rounded-[var(--radius-control)] px-3")}>
              {saving ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}
              {text("clear", "Use automatic")}
            </button>
          </div>
        ) : (
          <div className="text-xs font-semibold text-text-muted">{text("automatic", "Automatic — same audience, in stock")}</div>
        )}
      </div>

      <div className="relative mt-3">
        <Search size={15} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-text-muted" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={text("search", "Search a product by name or code")}
          disabled={saving}
          className="h-[var(--control-height-md)] w-full rounded-[var(--radius-control)] border border-border bg-surface-soft ps-9 pe-3 text-sm text-text outline-none transition placeholder:text-text-muted hover:border-primary/40 focus:border-primary focus:bg-surface"
        />
        {searching ? <Loader2 size={14} className="absolute end-3 top-1/2 -translate-y-1/2 animate-spin text-text-muted" /> : null}
        {results.length ? (
          <div className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-[var(--radius-card)] border border-border bg-surface-raised shadow-[var(--shadow-card)]">
            {results.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => save(item.id)}
                className="flex w-full items-center gap-3 px-3 py-2 text-start text-sm text-text hover:bg-surface-hover"
              >
                <span className="min-w-0 flex-1 truncate">{item.name || item.title}</span>
                <span className="text-xs text-text-muted">#{item.id}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
