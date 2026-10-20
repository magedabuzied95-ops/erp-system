import { useEffect, useId, useMemo, useState } from "react";
import { LoaderCircle, Users } from "lucide-react";
import { useTranslation } from "react-i18next";

import { formatCompact, localeFor } from "../../../shared/metaAdsFormat";
import { wizardApi } from "../wizardApi";

// "تحديد الجمهور": gauge محدد ↔ واسع + "حجم الجمهور التقديري" from /estimate/reach.
const LOW = 4; // 10k people  → needle fully "specific"
const HIGH = 8.3; // 200M people → needle fully "broad"

function Gauge({ ratio }) {
  // Unique per instance: the card renders twice (side rail + hidden inline copy) and a
  // gradient referenced from a display:none subtree does not paint.
  const gradientId = `wzGauge${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const cx = 90;
  const cy = 90;
  const r = 70;
  const clamped = Math.min(1, Math.max(0, ratio));
  const angle = Math.PI - clamped * Math.PI;
  const x = cx + r * Math.cos(angle);
  const y = cy - r * Math.sin(angle);
  const nx = cx + (r - 14) * Math.cos(angle);
  const ny = cy - (r - 14) * Math.sin(angle);
  return (
    <svg viewBox="0 0 180 100" className="wz-gauge" aria-hidden="true">
      <defs>
        <linearGradient id={gradientId} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stopColor="#f2b705" />
          <stop offset="100%" stopColor="#22a447" />
        </linearGradient>
      </defs>
      <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`} fill="none" stroke="var(--wz-gauge-track)" strokeWidth="14" strokeLinecap="round" />
      {clamped > 0.01 ? (
        <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)}`} fill="none" stroke={`url(#${gradientId})`} strokeWidth="14" strokeLinecap="round" />
      ) : null}
      <line x1={cx} y1={cy} x2={nx.toFixed(2)} y2={ny.toFixed(2)} stroke="var(--text)" strokeWidth="3" strokeLinecap="round" />
      <circle cx={cx} cy={cy} r="4.5" fill="var(--text)" />
    </svg>
  );
}

export default function ReachCard({ accountId, targeting, goal, hasLocations }) {
  const { t, i18n } = useTranslation();
  const locale = localeFor(i18n.language);
  const [state, setState] = useState({ loading: false, lower: null, upper: null, done: false });
  const key = useMemo(() => JSON.stringify({ targeting, goal, accountId }), [targeting, goal, accountId]);

  useEffect(() => {
    if (!hasLocations || !accountId) {
      setState({ loading: false, lower: null, upper: null, done: false });
      return undefined;
    }
    let alive = true;
    setState((prev) => ({ ...prev, loading: true }));
    const timer = setTimeout(async () => {
      try {
        const body = JSON.parse(key);
        const res = await wizardApi.estimateReach({ account_id: body.accountId, targeting: body.targeting, optimization_goal: body.goal || "REACH" });
        if (alive) setState({ loading: false, lower: res?.users_lower_bound ?? null, upper: res?.users_upper_bound ?? null, done: true });
      } catch {
        if (alive) setState({ loading: false, lower: null, upper: null, done: true });
      }
    }, 900);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [key, hasLocations, accountId]);

  const size = state.upper || state.lower;
  const ratio = size ? (Math.log10(size) - LOW) / (HIGH - LOW) : 0.5;
  let value;
  if (!hasLocations) value = t("metaAdsWizard.reach.pickLocation");
  else if (state.loading && !state.done) value = t("metaAdsWizard.reach.estimating");
  else if (size) {
    value = state.lower && state.upper && state.lower !== state.upper
      ? `${formatCompact(state.lower, t, locale)} - ${formatCompact(state.upper, t, locale)}`
      : formatCompact(size, t, locale);
  } else value = t("metaAdsWizard.reach.unavailable");

  return (
    <section className="wz-side-card">
      <h3 className="wz-side-card__title">{t("metaAdsWizard.reach.title")}</h3>
      <div className="wz-gauge-wrap">
        <Gauge ratio={ratio} />
        <div className="wz-gauge-labels">
          <span>{t("metaAdsWizard.reach.specific")}</span>
          <span>{t("metaAdsWizard.reach.broad")}</span>
        </div>
      </div>
      <div className="wz-reach">
        <div className="wz-reach__label">
          <Users size={15} aria-hidden="true" />
          <span>{t("metaAdsWizard.reach.estimated")}</span>
          {state.loading ? <LoaderCircle size={13} className="m1-spin" aria-hidden="true" /> : null}
        </div>
        <div className="wz-reach__value">{value}</div>
        <p className="wz-reach__note">{t("metaAdsWizard.reach.disclaimer")}</p>
      </div>
    </section>
  );
}
