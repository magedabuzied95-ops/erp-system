import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Truck } from "lucide-react";
import { getPublicSettingsResponse } from "../../shared/api/publicSettings";
import "./freeShippingProgress.css";

/*
 * "باقي 250 جنيه وتحصل على شحن مجاني".
 *
 * The number it counts towards is the one the server charges with
 * (storefrontShippingService): a zone's own threshold, else the store-wide
 * `storefront.free_shipping_threshold`, compared with the goods subtotal before
 * any discount. Before a governorate is known only the store-wide one applies;
 * once checkout has a quote, pass the quote's threshold instead.
 */

const readStoreThreshold = (response = {}) => {
  const settings = response?.settings || {};
  const raw = settings["storefront.free_shipping_threshold"] ?? settings?.storefront?.free_shipping_threshold;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : 0;
};

export const usePublicFreeShippingThreshold = () => {
  const [threshold, setThreshold] = useState(0);
  useEffect(() => {
    let cancelled = false;
    getPublicSettingsResponse().then((data) => {
      if (!cancelled) setThreshold(readStoreThreshold(data));
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return threshold;
};

export const freeShippingProgress = (subtotal = 0, threshold = 0) => {
  const goal = Math.max(0, Number(threshold) || 0);
  const amount = Math.max(0, Number(subtotal) || 0);
  if (!goal) return null;
  const remaining = Math.max(0, Math.ceil(goal - amount));
  return {
    threshold: goal,
    remaining,
    reached: remaining === 0,
    percent: Math.min(100, Math.round((amount / goal) * 100)),
  };
};

export default function FreeShippingProgress({ subtotal, threshold, money, className = "" }) {
  const { t } = useTranslation();
  const progress = freeShippingProgress(subtotal, threshold);
  if (!progress) return null;
  const message = progress.reached
    ? t("storefront.freeShippingBar.reached", "طلبك شحنه مجاني")
    : t("storefront.freeShippingBar.remaining", { amount: money(progress.remaining), defaultValue: "باقي {{amount}} وتحصل على شحن مجاني" });
  return (
    <div className={`sf-fsp${progress.reached ? " is-reached" : ""}${className ? ` ${className}` : ""}`}>
      <p className="sf-fsp__text" role="status" aria-live="polite">
        <Truck aria-hidden="true" strokeWidth={1.8} />
        <span>{message}</span>
      </p>
      <div
        className="sf-fsp__track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress.percent}
        aria-label={t("storefront.freeShippingBar.label", "التقدم نحو الشحن المجاني")}
      >
        <span className="sf-fsp__fill" style={{ inlineSize: `${progress.percent}%` }} />
      </div>
    </div>
  );
}
