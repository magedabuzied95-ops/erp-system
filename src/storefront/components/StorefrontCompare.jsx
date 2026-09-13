import { useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { Check, GitCompareArrows, Plus, X } from "lucide-react";
import {
  COMPARE_MAX_ITEMS,
  clearCompareItems,
  removeCompareItem,
  comparePagePath,
  toggleCompareItem,
  useCompareItems,
  useIsInCompare,
} from "../lib/compareStore";
import { ROOT_PATHS } from "../lib/paths";

const compareSnapshot = ({ product = {}, colorKey = "", colorName = "", image = "" }) => ({
  // A listing card's id is `product:colour`; the list compares models, so every
  // colour card of one model is the same entry (the colour rides in colorKey).
  id: String(product.parent_product_id || product.product_id || product.id || "").split(":")[0],
  slug: product.slug || product.canonical_slug || product.product_slug,
  name: product.name,
  image,
  colorKey: colorKey || product.color_key || product.display_color_key || "",
  colorName: colorName || product.display_color || product.color || "",
  productType: product.product_type || product.productType || "",
});

/**
 * Adds or removes one product from the comparison list and says what happened.
 * `variant="card"` is the round button on a product card's image, `"pdp"` the
 * labelled pill on the product page.
 */
export function CompareToggleButton({ product, colorKey = "", colorName = "", image = "", variant = "card", className = "" }) {
  const { t } = useTranslation();
  const snapshot = compareSnapshot({ product, colorKey, colorName, image });
  const active = useIsInCompare(snapshot.id);

  const handleClick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    const result = toggleCompareItem(snapshot);
    if (result.ok) {
      toast.success(t(result.action === "added" ? "storefront.compare.added" : "storefront.compare.removed"), { id: "storefront-compare" });
      return;
    }
    if (result.reason === "full") toast.error(t("storefront.compare.full", { max: COMPARE_MAX_ITEMS }), { id: "storefront-compare" });
    if (result.reason === "family") toast.error(t("storefront.compare.familyMismatch"), { id: "storefront-compare" });
  };

  const label = active ? t("storefront.compare.remove") : t("storefront.compare.addAria");
  if (variant === "pdp") {
    return (
      <button type="button" onClick={handleClick} className={`sfx-cmp-pill${active ? " is-on" : ""} ${className}`} aria-pressed={active} aria-label={label} title={label}>
        {active ? <Check size={15} aria-hidden="true" /> : <GitCompareArrows size={15} aria-hidden="true" />}
        <span>{active ? t("storefront.compare.inCompare") : t("storefront.compare.add")}</span>
      </button>
    );
  }
  return (
    <button type="button" onClick={handleClick} className={`sfx-cmp-toggle${active ? " is-on" : ""} ${className}`} aria-pressed={active} aria-label={label} title={label}>
      {active ? <Check size={14} strokeWidth={2.4} aria-hidden="true" /> : <GitCompareArrows size={14} strokeWidth={2} aria-hidden="true" />}
    </button>
  );
}

/**
 * The floating bar that collects the picks: up to three thumbnails, a way to
 * drop one, and the button to the comparison. Hidden where it would get in the
 * way (checkout, the comparison itself, the offer story).
 */
export function CompareTray({ hidden = false }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const items = useCompareItems();
  const visible = !hidden && items.length > 0;

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    document.body.classList.toggle("sfx-has-compare-tray", visible);
    return () => document.body.classList.remove("sfx-has-compare-tray");
  }, [visible]);

  if (!visible) return null;
  const canCompare = items.length >= 2;
  const slots = Array.from({ length: COMPARE_MAX_ITEMS }, (_, index) => items[index] || null);

  return (
    <aside className="sfx-cmp-tray" aria-label={t("storefront.compare.trayLabel")}>
      <div className="sfx-cmp-tray__inner">
        <ul className="sfx-cmp-tray__slots">
          {slots.map((item, index) => (
            <li key={item?.id || `empty-${index}`} className={`sfx-cmp-tray__slot${item ? "" : " is-empty"}`}>
              {item ? (
                <>
                  {item.image ? <img src={item.image} alt={item.name} loading="lazy" decoding="async" /> : <span className="sfx-cmp-tray__initial">{item.name.slice(0, 1)}</span>}
                  <button type="button" className="sfx-cmp-tray__remove" onClick={() => removeCompareItem(item.id)} aria-label={`${t("storefront.compare.remove")}: ${item.name}`}>
                    <X size={11} strokeWidth={2.6} aria-hidden="true" />
                  </button>
                </>
              ) : (
                <Link to={ROOT_PATHS.products} aria-label={t("storefront.compare.slotEmpty")} title={t("storefront.compare.slotEmpty")}>
                  <Plus size={16} aria-hidden="true" />
                </Link>
              )}
            </li>
          ))}
        </ul>
        <div className="sfx-cmp-tray__copy">
          <strong>{t("storefront.compare.title")}</strong>
          <span>{canCompare ? t("storefront.compare.itemsCount", { count: items.length, max: COMPARE_MAX_ITEMS }) : t("storefront.compare.pickOneMore")}</span>
        </div>
        <div className="sfx-cmp-tray__actions">
          <button type="button" className="sfx-cmp-tray__clear" onClick={clearCompareItems}>
            {t("storefront.compare.clear")}
          </button>
          <button type="button" className="sfx-cmp-tray__go" disabled={!canCompare} onClick={() => navigate(comparePagePath(items))}>
            <GitCompareArrows size={16} aria-hidden="true" />
            <span>{t("storefront.compare.compareNow")}</span>
          </button>
        </div>
      </div>
    </aside>
  );
}
