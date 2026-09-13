import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, Truck } from "lucide-react";
import { api } from "../../shared/api/api";
import { getPublicSettingsResponse } from "../../shared/api/publicSettings";
import { describeDeliveryEstimate, formatCutoffCountdown } from "../../shared/lib/deliveryEstimate.js";
import "./deliveryEstimate.css";

/*
 * "متوقع وصول طلبك الثلاثاء 15 سبتمبر".
 *
 * The day comes from the server (storefrontShippingService → delivery_estimate),
 * which owns the Cairo clock, the handling time, each zone's transit days, the
 * cut-off and the days off. The browser only formats it and counts the cut-off
 * down between requests. The governorate the shopper last chose — here or at
 * checkout — is remembered so the product page and checkout promise the same day.
 */

const GOVERNORATE_STORAGE_KEY = "sf:delivery-governorate";
const QUOTE_TTL_MS = 5 * 60_000;

// Only used when the public settings carry no shipping catalogue.
const FALLBACK_GOVERNORATES = [
  ["cairo", "Cairo", "القاهرة"], ["giza", "Giza", "الجيزة"], ["alexandria", "Alexandria", "الإسكندرية"],
  ["qalyubia", "Qalyubia", "القليوبية"], ["dakahlia", "Dakahlia", "الدقهلية"], ["damietta", "Damietta", "دمياط"],
  ["sharqia", "Sharqia", "الشرقية"], ["gharbia", "Gharbia", "الغربية"], ["menofia", "Menofia", "المنوفية"],
  ["kafr-el-sheikh", "Kafr El Sheikh", "كفر الشيخ"], ["beheira", "Beheira", "البحيرة"], ["port-said", "Port Said", "بورسعيد"],
  ["ismailia", "Ismailia", "الإسماعيلية"], ["suez", "Suez", "السويس"], ["fayoum", "Fayoum", "الفيوم"],
  ["beni-suef", "Beni Suef", "بني سويف"], ["minya", "Minya", "المنيا"], ["assiut", "Assiut", "أسيوط"],
  ["sohag", "Sohag", "سوهاج"], ["qena", "Qena", "قنا"], ["luxor", "Luxor", "الأقصر"], ["aswan", "Aswan", "أسوان"],
  ["red-sea", "Red Sea", "البحر الأحمر"], ["matrouh", "Matrouh", "مطروح"], ["new-valley", "New Valley", "الوادي الجديد"],
  ["north-sinai", "North Sinai", "شمال سيناء"], ["south-sinai", "South Sinai", "جنوب سيناء"],
].map(([id, en, ar]) => ({ id, en, ar }));

export const readRememberedGovernorate = () => {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(GOVERNORATE_STORAGE_KEY) || "null");
    return parsed && typeof parsed === "object" && (parsed.id || parsed.name) ? { id: String(parsed.id || ""), name: String(parsed.name || "") } : null;
  } catch {
    return null;
  }
};

export const rememberGovernorate = (governorate) => {
  try {
    if (!governorate?.name && !governorate?.id) return;
    window.localStorage.setItem(GOVERNORATE_STORAGE_KEY, JSON.stringify({ id: governorate.id || "", name: governorate.name || "" }));
  } catch {
    /* storage unavailable */
  }
};

const quoteCache = new Map();

const fetchEstimate = (governorate) => {
  const key = `${governorate?.id || ""}|${governorate?.name || ""}`;
  const cached = quoteCache.get(key);
  if (cached && Date.now() - cached.at < QUOTE_TTL_MS) return cached.promise;
  const params = new URLSearchParams({ governorate: governorate?.name || "", governorate_id: governorate?.id || "" });
  const promise = api
    .get(`/storefront/shipping/quote?${params.toString()}`, { suppressErrorStatuses: [404, 500] })
    .then((data) => {
      const quote = data?.quote || data || {};
      return { estimate: quote.delivery_estimate || null, receivedAt: Date.now() };
    })
    .catch(() => {
      quoteCache.delete(key);
      return { estimate: null, receivedAt: Date.now() };
    });
  quoteCache.set(key, { at: Date.now(), promise });
  return promise;
};

const governorateOptionsFrom = (response) => {
  const settings = response?.settings || {};
  const locations = settings["storefront.shipping_locations"] ?? settings?.storefront?.shipping_locations;
  const seen = new Map();
  (Array.isArray(locations) ? locations : []).forEach((location) => {
    if (location?.active === false) return;
    const id = String(location?.governorate_id || "").trim();
    const en = String(location?.governorate_name_en || location?.governorate || "").trim();
    const ar = String(location?.governorate_name_ar || "").trim();
    const key = id || en || ar;
    if (key && !seen.has(key)) seen.set(key, { id, en, ar });
  });
  return seen.size ? [...seen.values()] : FALLBACK_GOVERNORATES;
};

/** Minutes left to today's cut-off, ticking every 30 seconds while it matters. */
const useCutoffCountdown = (estimate, receivedAt, onExpire) => {
  const [now, setNow] = useState(() => Date.now());
  const active = Boolean(estimate?.ordered_today && estimate?.cutoff_minutes_left > 0);
  useEffect(() => {
    if (!active) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [active]);
  const left = active ? Math.ceil(estimate.cutoff_minutes_left - (now - receivedAt) / 60_000) : 0;
  useEffect(() => {
    if (active && left <= 0) onExpire?.();
  }, [active, left, onExpire]);
  return Math.max(0, left);
};

/** Puts `node` where `{{token}}` sits in a translated sentence, so the date can be bold. */
const withSlot = (sentence, token, node) => {
  const marker = `{{${token}}}`;
  const index = sentence.indexOf(marker);
  if (index < 0) return sentence;
  return (
    <>
      {sentence.slice(0, index)}
      {node}
      {sentence.slice(index + marker.length)}
    </>
  );
};

// Literal keys, so the missing-key guard can see all three.
const daySentence = (t, relative, options) => {
  if (relative === "today") return t("storefront.deliveryEstimate.dayToday", { ...options, defaultValue: "متوقع وصول طلبك النهارده، {{day}}" });
  if (relative === "tomorrow") return t("storefront.deliveryEstimate.dayTomorrow", { ...options, defaultValue: "متوقع وصول طلبك بكرة، {{day}}" });
  return t("storefront.deliveryEstimate.day", { ...options, defaultValue: "متوقع وصول طلبك {{day}}" });
};

/** The headline sentence as a string — checkout's delivery line and the order summary use it. */
export const deliveryEstimateText = (t, estimate, language) => {
  const parts = describeDeliveryEstimate(estimate, language);
  if (!parts) return "";
  if (parts.kind === "range") {
    return t("storefront.deliveryEstimate.range", { from: parts.from, to: parts.to, defaultValue: "متوقع وصول طلبك بين {{from}} و{{to}}" });
  }
  return daySentence(t, parts.relative, { day: parts.day });
};

/** Just the day or the window ("الثلاثاء 15 سبتمبر" / "الأحد 13 – الثلاثاء 15 سبتمبر"), for a field that already has its own label. */
export const deliveryEstimateDays = (estimate, language) => {
  const parts = describeDeliveryEstimate(estimate, language);
  if (!parts) return "";
  return parts.kind === "range" ? `${parts.from} – ${parts.to}` : parts.day;
};

export function DeliveryEstimateHeadline({ estimate, className = "" }) {
  const { t, i18n } = useTranslation();
  const parts = describeDeliveryEstimate(estimate, i18n.language);
  if (!parts) return null;
  const strong = (text) => <strong className="sf-eta__date">{text}</strong>;
  let sentence;
  if (parts.kind === "range") {
    const template = t("storefront.deliveryEstimate.range", { from: "{{from}}", to: "{{to}}", defaultValue: "متوقع وصول طلبك بين {{from}} و{{to}}", interpolation: { escapeValue: false } });
    const [before, after = ""] = template.split("{{from}}");
    sentence = <>{before}{strong(parts.from)}{withSlot(after, "to", strong(parts.to))}</>;
  } else {
    const template = daySentence(t, parts.relative, { day: "{{day}}", interpolation: { escapeValue: false } });
    sentence = withSlot(template, "day", strong(parts.day));
  }
  return <span className={className}>{sentence}</span>;
}

/**
 * Product page block. `inStock` false hides it: a sold-out size has no date to promise.
 */
export default function DeliveryEstimate({ inStock = true, className = "" }) {
  const { t, i18n } = useTranslation();
  const isAr = String(i18n.language || "ar").startsWith("ar");
  const [governorate, setGovernorate] = useState(() => (typeof window === "undefined" ? null : readRememberedGovernorate()));
  const [options, setOptions] = useState([]);
  const [state, setState] = useState({ estimate: null, receivedAt: 0, loading: true });
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getPublicSettingsResponse().then((response) => {
      if (!cancelled) setOptions(governorateOptionsFrom(response));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setState((current) => ({ ...current, loading: true }));
    fetchEstimate(governorate).then((result) => {
      if (!cancelled) setState({ ...result, loading: false });
    });
    return () => {
      cancelled = true;
    };
  }, [governorate, reloadToken]);

  const expire = useCallback(() => {
    quoteCache.clear();
    setReloadToken((value) => value + 1);
  }, []);
  const minutesLeft = useCutoffCountdown(state.estimate, state.receivedAt, expire);

  const selectedOption = options.find((option) =>
    (governorate?.id && option.id === governorate.id) || (governorate?.name && [option.ar, option.en].includes(governorate.name)));
  const selectedValue = selectedOption ? (selectedOption.id || selectedOption.en || selectedOption.ar) : "";
  const selectedLabel = selectedOption ? (isAr ? selectedOption.ar || selectedOption.en : selectedOption.en || selectedOption.ar) : governorate?.name || "";

  if (!inStock || !state.estimate) return null;

  const onPick = (event) => {
    const option = options.find((item) => (item.id || item.en || item.ar) === event.target.value);
    if (!option) return;
    const next = { id: option.id, name: option.ar || option.en };
    rememberGovernorate(next);
    setGovernorate(next);
  };

  return (
    <div className={`sf-eta${state.loading ? " is-loading" : ""}${className ? ` ${className}` : ""}`} aria-live="polite">
      <span className="sf-eta__icon" aria-hidden="true"><Truck strokeWidth={1.8} /></span>
      <div className="sf-eta__body">
        <p className="sf-eta__headline"><DeliveryEstimateHeadline estimate={state.estimate} /></p>
        <p className="sf-eta__sub">
          {minutesLeft > 0 ? (
            <span className="sf-eta__cutoff">
              {withSlot(
                t("storefront.deliveryEstimate.orderWithin", { time: "{{time}}", defaultValue: "اطلب خلال {{time}}", interpolation: { escapeValue: false } }),
                "time",
                <strong className="sf-eta__timer">{formatCutoffCountdown(minutesLeft, i18n.language)}</strong>,
              )}
            </span>
          ) : null}
          {minutesLeft > 0 ? <span className="sf-eta__dot" aria-hidden="true">·</span> : null}
          <span className="sf-eta__place">
            {state.estimate.scope === "zone" && selectedLabel
              ? t("storefront.deliveryEstimate.deliverTo", "التوصيل إلى")
              : t("storefront.deliveryEstimate.byGovernorate", "حسب محافظتك")}
            <label className="sf-eta__picker">
              <span className="sf-eta__picker-label">
                {state.estimate.scope === "zone" && selectedLabel ? selectedLabel : t("storefront.deliveryEstimate.chooseGovernorate", "اختار المحافظة")}
                <ChevronDown aria-hidden="true" />
              </span>
              <select value={selectedValue} onChange={onPick} aria-label={t("storefront.deliveryEstimate.governorateLabel", "محافظة التوصيل")}>
                {!selectedValue ? <option value="">{t("storefront.deliveryEstimate.chooseGovernorate", "اختار المحافظة")}</option> : null}
                {options.map((option) => {
                  const value = option.id || option.en || option.ar;
                  return <option key={value} value={value}>{isAr ? option.ar || option.en : option.en || option.ar}</option>;
                })}
              </select>
            </label>
          </span>
        </p>
      </div>
    </div>
  );
}
