import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Boxes } from "lucide-react";
import { api } from "../../../shared/api/api";
import { IS_WHOLESALE_APP } from "../../../shared/constants/app";

// Wholesale copy only: how a model is sold in bulk and its piece price per customer tier,
// right on the product page. The product saves first; then saveWholesale(productId).

const DOZEN = 12;
const EMPTY = {
  sell_piece: true,
  sell_series: false,
  series_pieces: "",
  sell_carton: false,
  carton_pieces: "",
  sell_dozen: false,
  price_wholesale: "",
  price_half_wholesale: "",
};
const fromServer = (s = {}) => ({
  ...EMPTY,
  ...s,
  series_pieces: s.series_pieces ? String(s.series_pieces) : "",
  carton_pieces: s.carton_pieces ? String(s.carton_pieces) : "",
  price_wholesale: s.price_wholesale === null || s.price_wholesale === undefined ? "" : String(s.price_wholesale),
  price_half_wholesale: s.price_half_wholesale === null || s.price_half_wholesale === undefined ? "" : String(s.price_half_wholesale),
});
const toServer = (v) => ({
  sell_piece: v.sell_piece,
  sell_series: v.sell_series,
  series_pieces: v.sell_series ? Number(v.series_pieces) || null : null,
  sell_carton: v.sell_carton,
  carton_pieces: v.sell_carton ? Number(v.carton_pieces) || null : null,
  sell_dozen: v.sell_dozen,
  price_wholesale: v.price_wholesale === "" ? null : Number(v.price_wholesale),
  price_half_wholesale: v.price_half_wholesale === "" ? null : Number(v.price_half_wholesale),
});

/** State for the section; `save(productId)` is called by the page after the product saves. */
export function useWholesaleProductSettings(productId = null) {
  const [value, setValue] = useState(EMPTY);
  const loadedFor = useRef(null);

  useEffect(() => {
    if (!IS_WHOLESALE_APP || !productId || loadedFor.current === productId) return;
    loadedFor.current = productId;
    api.get(`/wholesale/products/${productId}`, { suppressErrorStatuses: [404] })
      .then((res) => setValue(fromServer(res?.data?.settings)))
      .catch(() => {});
  }, [productId]);

  // Checked before the product is saved, so a missing count never leaves half a save.
  const problem = useCallback(() => {
    if (!IS_WHOLESALE_APP) return "";
    if (value.sell_series && !(Number(value.series_pieces) > 0)) return "orders.wholesale.product.needSeriesPieces";
    if (value.sell_carton && !(Number(value.carton_pieces) > 0)) return "orders.wholesale.product.needCartonPieces";
    return "";
  }, [value]);

  const save = useCallback(async (savedProductId) => {
    if (!IS_WHOLESALE_APP || !savedProductId) return null;
    return api.put(`/wholesale/products/${savedProductId}`, { settings: toServer(value) });
  }, [value]);

  return { enabled: IS_WHOLESALE_APP, value, setValue, save, problem };
}

const money = (value) => Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });

export default function WholesaleProductSection({ value, onChange }) {
  const { t } = useTranslation();
  if (!IS_WHOLESALE_APP) return null;
  const set = (patch) => onChange({ ...value, ...patch });
  const digits = (raw) => String(raw || "").replace(/[^\d]/g, "");
  const decimal = (raw) => String(raw || "").replace(/[^\d.]/g, "");

  const units = [
    { key: "piece", flag: "sell_piece", count: 1 },
    { key: "series", flag: "sell_series", countField: "series_pieces" },
    { key: "carton", flag: "sell_carton", countField: "carton_pieces" },
    { key: "dozen", flag: "sell_dozen", count: DOZEN },
  ];
  const piecesOf = (unit) => unit.count || Number(value[unit.countField]) || 0;
  const tiers = [
    { key: "price_wholesale", label: t("orders.wholesale.tiers.wholesale") },
    { key: "price_half_wholesale", label: t("orders.wholesale.tiers.half_wholesale") },
  ];
  const enabledUnits = units.filter((unit) => value[unit.flag] && piecesOf(unit) > 0);

  const inputClass = "h-[var(--control-height-md)] w-full rounded-[var(--radius-control)] border border-border bg-surface px-3 text-sm font-bold text-text outline-none focus:border-primary/50";

  return (
    <section className="rounded-[var(--radius-card)] border border-border bg-surface-soft p-4">
      <div className="flex items-center gap-2">
        <Boxes size={18} className="text-primary" />
        <h3 className="text-base font-black text-text">{t("orders.wholesale.product.title")}</h3>
      </div>
      <p className="mt-1 text-xs font-semibold text-text-muted">{t("orders.wholesale.product.hint")}</p>

      <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
        {units.map((unit) => (
          <div key={unit.key} className={`rounded-[var(--radius-control)] border p-2 ${value[unit.flag] ? "border-primary/40 bg-primary/10" : "border-border bg-surface"}`}>
            <label className="flex items-center gap-2 text-sm font-black text-text">
              <input type="checkbox" checked={Boolean(value[unit.flag])} onChange={(e) => set({ [unit.flag]: e.target.checked })} className="h-4 w-4 accent-[var(--primary)]" />
              {t(`orders.wholesale.units.${unit.key}`)}
            </label>
            {unit.countField && value[unit.flag] ? (
              <label className="mt-2 grid gap-1 text-[11px] font-bold text-text-muted">
                {t("orders.wholesale.product.piecesIn", { unit: t(`orders.wholesale.units.${unit.key}`) })}
                <input className={inputClass} inputMode="numeric" value={value[unit.countField]} onChange={(e) => set({ [unit.countField]: digits(e.target.value) })} />
              </label>
            ) : unit.key === "dozen" && value[unit.flag] ? (
              <p className="mt-2 text-[11px] font-bold text-text-muted">{t("orders.wholesale.product.dozenPieces")}</p>
            ) : null}
          </div>
        ))}
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {tiers.map((tier) => {
          const price = Number(value[tier.key]) || 0;
          return (
            <div key={tier.key} className="rounded-[var(--radius-control)] border border-border bg-surface p-3">
              <label className="grid gap-1 text-xs font-black text-text-muted">
                {t("orders.wholesale.product.piecePrice", { tier: tier.label })}
                <input className={inputClass} inputMode="decimal" value={value[tier.key]} onChange={(e) => set({ [tier.key]: decimal(e.target.value) })} />
              </label>
              {price > 0 && enabledUnits.length ? (
                <ul className="mt-2 grid gap-1 text-xs font-bold text-text">
                  {enabledUnits.filter((unit) => unit.key !== "piece").map((unit) => (
                    <li key={unit.key} className="flex justify-between gap-2">
                      <span className="text-text-muted">{t(`orders.wholesale.units.${unit.key}`)} ({piecesOf(unit)})</span>
                      <span>{money(price * piecesOf(unit))}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-[11px] font-semibold text-text-muted">{t("orders.wholesale.product.halfFallback")}</p>
    </section>
  );
}
