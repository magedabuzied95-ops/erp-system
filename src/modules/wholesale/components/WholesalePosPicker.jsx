import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Plus, X } from "lucide-react";
import toast from "react-hot-toast";
import { api } from "../../../shared/api/api";
import { IS_WHOLESALE_APP } from "../../../shared/constants/app";

// Wholesale copy only: the POS sells by piece / series / carton / dozen at the customer's
// tier piece price (wholesale or half-wholesale) set on the product page.

const UNIT_ORDER = ["carton", "series", "dozen", "piece"];
const unitOn = (unit, s = {}) => Boolean(
  unit === "piece" ? s.sell_piece
    : unit === "series" ? s.sell_series && s.series_pieces
      : unit === "carton" ? s.sell_carton && s.carton_pieces
        : s.sell_dozen
);
const piecesIn = (unit, s = {}) => (unit === "series" ? s.series_pieces : unit === "carton" ? s.carton_pieces : unit === "dozen" ? 12 : 1);
const money = (value) => Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });

/**
 * Tier prices for the whole catalogue plus the selected customer's tier.
 * priceOf(productId) -> the piece price the cart should use, or null (not set up).
 */
export function useWholesalePosPricing(customerId) {
  const [prices, setPrices] = useState({});
  const [tier, setTier] = useState("wholesale");

  const reloadPrices = useCallback(() => {
    if (!IS_WHOLESALE_APP) return;
    api.get("/wholesale/prices").then((res) => setPrices(res?.data || {})).catch(() => {});
  }, []);
  useEffect(() => { reloadPrices(); }, [reloadPrices]);

  useEffect(() => {
    if (!IS_WHOLESALE_APP) return;
    if (!customerId) { setTier("wholesale"); return; }
    let cancelled = false;
    api.get(`/wholesale/customers/${customerId}/terms`)
      .then((res) => { if (!cancelled) setTier(res?.data?.tier || "wholesale"); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [customerId]);

  const priceOf = useCallback((productId) => {
    if (!IS_WHOLESALE_APP) return null;
    const row = prices[productId];
    if (!row) return null;
    const half = row.price_half_wholesale;
    const whole = row.price_wholesale;
    const value = tier === "half_wholesale" && half !== null && half !== undefined ? half : whole;
    return value === null || value === undefined ? null : Number(value);
  }, [prices, tier]);

  return { enabled: IS_WHOLESALE_APP, tier, setTier, priceOf, prices, reloadPrices };
}

/** The product card shows the tier price instead of "price required". */
export const withWholesalePrice = (product, price) => {
  if (price === null || price === undefined) return product;
  const variants = Array.isArray(product.variants)
    ? product.variants.map((variant) => ({ ...variant, price, sale_price: price, regular_price: price, original_price: price }))
    : product.variants;
  return { ...product, price, sale_price: price, base_price: price, min_price: price, max_price: price, regular_price: price, original_price: price, variants };
};

/** The POS catalogue with tier prices, for every cart-vs-catalogue reconciliation. */
export const priceCatalogForWholesale = (catalog, priceOf) => {
  if (typeof priceOf !== "function" || !Array.isArray(catalog)) return catalog;
  return catalog.map((product) => withWholesalePrice(product, priceOf(product?.product_id ?? product?.id)));
};

export default function WholesalePosPicker({ product, customerId, tier, onTierChange, onAdd, onClose }) {
  const { t } = useTranslation();
  const productId = product?.product_id ?? product?.id;
  const [data, setData] = useState(null);
  const [unit, setUnit] = useState("piece");
  const [qty, setQty] = useState("1");
  const [color, setColor] = useState("");
  const [size, setSize] = useState("");
  const [colors, setColors] = useState([]);
  const [preview, setPreview] = useState(null);
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.get(`/wholesale/products/${productId}`)
      .then((res) => {
        if (cancelled) return;
        const d = res.data;
        setData(d);
        setUnit(UNIT_ORDER.find((u) => unitOn(u, d.settings)) || "piece");
        const firstInStock = d.colors.find((c) => (d.stock_by_color?.[c] || 0) > 0) || d.colors[0] || "";
        setColor(firstInStock);
        setSize(d.sizes_by_color?.[firstInStock]?.[0] || "");
      })
      .catch((error) => { toast.error(error.message); onClose(); });
    return () => { cancelled = true; };
  }, [productId, onClose]);

  const settings = data?.settings || {};
  const units = UNIT_ORDER.filter((u) => unitOn(u, settings));
  const sizes = data?.sizes_by_color?.[color] || [];
  const quantity = Number(qty);

  const line = useMemo(() => {
    if (!data || !Number.isInteger(quantity) || quantity <= 0) return null;
    if (unit === "carton") return colors.length ? { product_id: productId, unit, qty: quantity, colors } : null;
    if (!color) return null;
    return { product_id: productId, unit, qty: quantity, color, ...(unit === "piece" && sizes.length > 1 ? { size } : {}) };
  }, [data, quantity, unit, colors, color, size, sizes.length, productId]);

  // The server splits the unit into pieces per colour and checks stock; nothing is
  // added to the cart from a guess.
  useEffect(() => {
    if (!line) { setPreview(null); setProblem(""); return; }
    let cancelled = false;
    const id = setTimeout(() => {
      api.post("/wholesale/invoices/preview", { customer_id: customerId || null, tier, lines: [line] })
        .then((res) => {
          if (cancelled) return;
          setPreview(res.data);
          const short = res.data?.shortages?.[0];
          setProblem(short ? t("orders.wholesale.pos.shortage", { where: short.size ? `${short.color} / ${short.size}` : short.color, wanted: short.wanted, stock: short.stock }) : "");
        })
        .catch((error) => { if (!cancelled) { setPreview(null); setProblem(error.message); } });
    }, 150);
    return () => { cancelled = true; clearTimeout(id); };
  }, [line, customerId, tier, t]);

  const priced = preview?.lines?.[0];
  const canAdd = Boolean(priced && !problem && !busy);

  const add = () => {
    if (!canAdd) return;
    setBusy(true);
    onAdd(priced);
    setBusy(false);
    onClose();
  };

  const chip = (on) => `rounded-full border px-3 py-1.5 text-sm font-black ${on ? "border-primary bg-primary text-[var(--primary-contrast)]" : "border-border bg-surface text-text"}`;
  const inputClass = "h-[var(--control-height-md)] w-24 rounded-[var(--radius-control)] border border-border bg-surface px-3 text-center text-sm font-black text-text outline-none";

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-t-[var(--radius-card)] border border-border bg-surface p-4 sm:rounded-[var(--radius-card)]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-black text-text">{product?.name || product?.product_name}</h3>
            <div className="mt-2 flex flex-wrap gap-2">
              {["wholesale", "half_wholesale"].map((key) => (
                <button key={key} type="button" className={chip(tier === key)} onClick={() => onTierChange(key)}>{t(`orders.wholesale.tiers.${key}`)}</button>
              ))}
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-full border border-border p-2 text-text" aria-label={t("orders.wholesale.common.remove")}><X size={16} /></button>
        </div>

        {!data ? (
          <p className="mt-4 flex items-center gap-2 text-sm font-bold text-text-muted"><Loader2 size={16} className="animate-spin" />{t("orders.wholesale.common.loading")}</p>
        ) : !units.length || !data.configured ? (
          <p className="mt-4 text-sm font-black text-amber-500">{t("orders.wholesale.pos.notSetUp")}</p>
        ) : (
          <div className="mt-4 grid gap-4">
            <div className="flex flex-wrap gap-2">
              {units.map((u) => (
                <button key={u} type="button" className={chip(unit === u)} onClick={() => setUnit(u)}>
                  {t(`orders.wholesale.units.${u}`)}{u !== "piece" ? ` (${piecesIn(u, settings)})` : ""}
                </button>
              ))}
            </div>

            <div>
              <p className="text-xs font-black text-text-muted">
                {unit === "carton" ? t("orders.wholesale.pos.cartonColors") : t("orders.wholesale.common.color")}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {data.colors.map((c) => {
                  const on = unit === "carton" ? colors.includes(c) : color === c;
                  const stock = data.stock_by_color?.[c] ?? 0;
                  return (
                    <button
                      key={c}
                      type="button"
                      disabled={stock <= 0}
                      className={`${chip(on)} disabled:opacity-40`}
                      onClick={() => {
                        if (unit === "carton") setColors((cur) => (cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]));
                        else { setColor(c); setSize(data.sizes_by_color?.[c]?.[0] || ""); }
                      }}
                    >
                      {c} ({stock})
                    </button>
                  );
                })}
              </div>
            </div>

            {unit === "piece" && sizes.length > 1 ? (
              <div className="flex flex-wrap gap-2">
                {sizes.map((s) => <button key={s} type="button" className={chip(size === s)} onClick={() => setSize(s)}>{s}</button>)}
              </div>
            ) : null}

            <div className="flex items-end gap-3">
              <label className="grid gap-1 text-xs font-black text-text-muted">
                {t("orders.wholesale.common.qty")}
                <input className={inputClass} inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value.replace(/[^\d]/g, ""))} />
              </label>
              {priced ? (
                <div className="flex-1 text-end">
                  <div className="text-xs font-bold text-text-muted">
                    {t("orders.wholesale.pos.summary", { pieces: priced.pieces, price: money(priced.piece_price) })}
                  </div>
                  <div className="text-2xl font-black text-text">{money(priced.line_total)} {t("orders.wholesale.common.egp")}</div>
                </div>
              ) : null}
            </div>

            {problem ? <p className="text-sm font-black text-red-500">{problem}</p> : null}

            <button type="button" disabled={!canAdd} onClick={add} className="inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] bg-primary px-4 py-3 text-sm font-black text-[var(--primary-contrast)] disabled:opacity-50">
              <Plus size={16} /> {t("orders.wholesale.pos.add")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
