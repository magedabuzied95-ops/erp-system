import { useTranslation } from "react-i18next";
import { AlertTriangle, X } from "lucide-react";
import { sfText } from "../lib/sfText";

/*
 * What the cart re-price found (lib/cartReprice.js): lines whose price moved since they were added and
 * lines that can no longer be bought as they stand. Shown on the cart page and at checkout, above the
 * lines, until the shopper dismisses it or the next re-price finds nothing. Nothing is removed for them.
 */

const unavailableKey = {
  low_stock: "storefront.cart.repriceLowStock",
  out_of_stock: "storefront.cart.repriceOutOfStock",
};

export default function CartRepriceNotice({ notice, money = (value) => String(value), onDismiss }) {
  // Subscribes the notice to language switches; the copy itself goes through sfText.
  useTranslation();
  const changed = Array.isArray(notice?.changed) ? notice.changed : [];
  const unavailable = Array.isArray(notice?.unavailable) ? notice.unavailable : [];
  if (!notice || (!changed.length && !unavailable.length && !notice.checkoutRetry)) return null;
  const danger = unavailable.some((line) => line.reason !== "low_stock");
  return (
    <div className={`sfx-notice ${danger ? "sfx-notice--danger" : "sfx-notice--accent"} sf-cart-reprice-notice`} role="status" aria-live="polite">
      <AlertTriangle aria-hidden="true" />
      <div style={{ flex: 1, minWidth: 0 }}>
        {notice.checkoutRetry ? <p style={{ margin: 0 }}>{sfText("storefront.cart.repriceCheckoutRetry")}</p> : null}
        {changed.length ? (
          <>
            <p style={{ margin: 0, fontWeight: 600 }}>{sfText("storefront.cart.repriceChangedTitle")}</p>
            <ul style={{ margin: 0, paddingInlineStart: "1.1em" }}>
              {changed.map((line) => (
                <li key={`changed-${line.lineId}`}>
                  {sfText("storefront.cart.repriceChangedLine", undefined, { name: line.name, from: money(line.from), to: money(line.to) })}
                </li>
              ))}
            </ul>
          </>
        ) : null}
        {unavailable.length ? (
          <ul style={{ margin: 0, paddingInlineStart: "1.1em" }}>
            {unavailable.map((line) => (
              <li key={`unavailable-${line.lineId}`}>
                {sfText(unavailableKey[line.reason] || "storefront.cart.repriceUnavailable", undefined, { name: line.name, stock: line.stock })}
              </li>
            ))}
          </ul>
        ) : null}
        {changed.length && !notice.checkoutRetry ? <p style={{ margin: 0 }}>{sfText("storefront.cart.repriceReview")}</p> : null}
      </div>
      {onDismiss ? (
        <button type="button" className="sfx-link-btn" onClick={onDismiss} aria-label={sfText("storefront.cart.repriceDismiss")}>
          <X size={16} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
