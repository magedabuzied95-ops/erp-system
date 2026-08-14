import { useTranslation } from "react-i18next";
import {
  getGroupedPurchaseAlertPresentation,
  getUserFacingTriggerVariants,
} from "../lib/purchaseAlertPresentation";

const joined = (values = []) => values.filter(Boolean).join(" / ");

const triggerReasonLabel = (t, reasonCode) => {
  if (reasonCode === "out_of_stock") return t("inventory.purchaseAlerts.reasons.out_of_stock");
  if (reasonCode === "low_stock") return t("inventory.purchaseAlerts.reasons.low_stock");
  return t("inventory.purchaseAlerts.reasons.low_stock");
};

export default function PurchaseAlertPatternSummary({ alert = {} }) {
  const { t } = useTranslation();
  const suggestion = alert.purchase_suggestion || {};
  const triggers = getUserFacingTriggerVariants(alert);
  const valid = alert.purchase_composition_valid !== false;
  const groupedPresentation = getGroupedPurchaseAlertPresentation(alert);

  return (
    <div
      data-testid="purchase-alert-pattern-summary"
      data-purchase-unit={suggestion.unit || ""}
      data-total-units={suggestion.total_units ?? 0}
      className={`mt-3 rounded-[var(--radius-control)] border px-3 py-3 text-xs ${valid ? "border-border-strong bg-success-subtle text-text" : "border-danger bg-danger-subtle text-text"}`}
    >
      <div className="font-black">{t("inventory.purchaseAlerts.cards.purchaseSuggestion")}</div>
      <dl className="mt-2 grid gap-1.5">
        <div className="flex flex-wrap justify-between gap-2">
          <dt className="text-text-muted">{t("inventory.purchaseAlerts.cards.purchaseMode")}</dt>
          <dd className="font-black">{suggestion.mode_label_ar || t("inventory.purchaseAlerts.cards.currentPurchaseMode")}</dd>
        </div>
        {groupedPresentation?.mode === "FULL_COLOR_RUN" && groupedPresentation.color ? (
          <div className="flex flex-wrap justify-between gap-2">
            <dt className="text-text-muted">{t("inventory.purchaseAlerts.cards.color")}</dt>
            <dd className="font-black">{groupedPresentation.color}</dd>
          </div>
        ) : groupedPresentation?.mode === "FULL_CARTON" ? (
          <div className="flex flex-wrap justify-between gap-2">
            <dt className="text-text-muted">{t("inventory.purchaseAlerts.cards.purchaseColors")}</dt>
            <dd className="font-black">{t("inventory.purchaseAlerts.cards.colorsCount", { count: groupedPresentation.colorCount })}</dd>
          </div>
        ) : suggestion.colors?.length ? (
          <div className="flex flex-wrap justify-between gap-2">
            <dt className="text-text-muted">{t("inventory.purchaseAlerts.cards.purchaseColors")}</dt>
            <dd className="font-black">{joined(suggestion.colors)}</dd>
          </div>
        ) : null}
        {groupedPresentation?.sizeRange ? (
          <div className="flex flex-wrap justify-between gap-2">
            <dt className="text-text-muted">
              {groupedPresentation.mode === "FULL_CARTON"
                ? t("inventory.purchaseAlerts.cards.sizesPerColor")
                : t("inventory.purchaseAlerts.cards.purchaseSizes")}
            </dt>
            <dd className="font-black">{groupedPresentation.sizeRange}</dd>
          </div>
        ) : suggestion.sizes?.length ? (
          <div className="flex flex-wrap justify-between gap-2">
            <dt className="text-text-muted">{t("inventory.purchaseAlerts.cards.purchaseSizes")}</dt>
            <dd className="font-black">{joined(suggestion.sizes)}</dd>
          </div>
        ) : null}
        <div className="flex flex-wrap justify-between gap-2">
          <dt className="text-text-muted">{t("inventory.purchaseAlerts.cards.totalSuggestedUnits")}</dt>
          <dd className="font-black">{t("inventory.purchaseAlerts.cards.piecesCount", { count: suggestion.total_units || 0 })}</dd>
        </div>
      </dl>
      {groupedPresentation ? (
        <div className="mt-3 border-t border-border pt-2">
          <div className="font-black text-text-muted">{t("inventory.purchaseAlerts.cards.triggerReason")}</div>
          <div className="mt-1 font-bold text-text">
            {t(`inventory.purchaseAlerts.reasons.${groupedPresentation.reasonKey}`)}
          </div>
        </div>
      ) : triggers.length ? (
        <div className="mt-3 border-t border-border pt-2">
          <div className="font-black text-text-muted">{t("inventory.purchaseAlerts.cards.triggerReason")}</div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {triggers.map((trigger) => (
              <span key={`${trigger.variant_id}-${trigger.color}-${trigger.size}`} className="rounded-full border border-border bg-surface px-2 py-1 font-bold">
                {trigger.color ? `${trigger.color} / ` : ""}{t("inventory.purchaseAlerts.cards.sizeWithValue", { size: trigger.size })}{" \u2014 "}{triggerReasonLabel(t, trigger.reason_code)}
              </span>
            ))}
          </div>
        </div>
      ) : null}
      {!valid ? (
        <div className="mt-2 font-bold text-danger">
          {(alert.purchase_configuration_errors || []).map((item) => item.message).filter(Boolean).join(" \u00b7 ")}
        </div>
      ) : null}
    </div>
  );
}
