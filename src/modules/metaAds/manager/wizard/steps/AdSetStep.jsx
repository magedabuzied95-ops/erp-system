import { useState } from "react";
import { useTranslation } from "react-i18next";

import AudienceCard from "../audience/AudienceCard";
import PlacementsCard from "../audience/PlacementsCard";
import { MoreToggle, RadioCard, Segmented, WzCard, WzField, WzInput, WzSelect } from "../parts";
import {
  CONVERSION_EVENTS,
  billingEventsFor,
  goalMeta,
  goalsFor,
  locationsFor,
  needsBidAmount,
} from "../wizardModel";
import { BudgetInput } from "./BudgetInput";

export default function AdSetStep({ spec, update, campaignSpec, catalog, account, currency, fieldError, savedAudiences, onAudienceSaved }) {
  const { t } = useTranslation();
  const [more, setMore] = useState(() => needsBidAmount(spec.bid_strategy) || spec.billing_event !== "IMPRESSIONS");
  const objective = campaignSpec.objective;
  const locations = locationsFor(objective, catalog);
  const goals = goalsFor(objective, spec.conversion_location, catalog);
  const billingEvents = billingEventsFor(spec.optimization_goal, catalog);
  const cbo = Boolean(campaignSpec.cbo);
  const strategy = cbo ? campaignSpec.bid_strategy : spec.bid_strategy;
  const pixelGoal = goalMeta(spec.optimization_goal, catalog)?.promoted === "pixel";
  const websiteEvent = spec.conversion_location === "WEBSITE" && ["OUTCOME_SALES", "OUTCOME_LEADS"].includes(objective) && account?.pixel_id;

  const chooseLocation = (code) => {
    const nextGoals = goalsFor(objective, code, catalog);
    const goal = nextGoals.includes(spec.optimization_goal) ? spec.optimization_goal : nextGoals[0] || "";
    const billing = billingEventsFor(goal, catalog).includes(spec.billing_event) ? spec.billing_event : "IMPRESSIONS";
    update({ conversion_location: code, optimization_goal: goal, billing_event: billing });
  };
  const chooseGoal = (goal) => {
    const billing = billingEventsFor(goal, catalog).includes(spec.billing_event) ? spec.billing_event : "IMPRESSIONS";
    update({ optimization_goal: goal, billing_event: billing });
  };

  const goalOptions = goals.map((code) => ({ value: code, label: t(`metaAds.goals.${code}`) }));
  const bidOptions = (catalog?.bid_strategies || []).map((code) => ({ value: code, label: t(`metaAds.bidStrategies.${code}`) }));
  const billingOptions = billingEvents.map((code) => ({ value: code, label: t(`metaAds.billingEvents.${code}`) }));
  const eventOptions = CONVERSION_EVENTS.map((code) => ({ value: code, label: t(`metaAdsWizard.events.${code}`) }));
  // A catalog campaign: this ad set's ads render one of the catalogue's product sets.
  const catalogId = campaignSpec.product_catalog_id;
  const productSetOptions = catalogId
    ? (Array.isArray(account?.product_sets) ? account.product_sets : [])
      .filter((set) => String(set.catalog_id) === String(catalogId))
      .map((set) => ({ value: String(set.meta_id), label: set.product_count ? `${set.name} (${set.product_count})` : set.name }))
    : [];

  return (
    <>
      <WzCard title={t("metaAdsWizard.adset.nameTitle")} field="name">
        <WzField error={fieldError("name")}>
          <WzInput
            value={spec.name}
            onChange={(event) => update({ name: event.target.value })}
            placeholder={t("metaAdsWizard.adset.namePlaceholder")}
            invalid={Boolean(fieldError("name"))}
            maxLength={400}
          />
        </WzField>
      </WzCard>

      <WzCard title={t("metaAdsWizard.adset.conversionTitle")} subtitle={t("metaAdsWizard.adset.conversionSubtitle")} field="conversion_location">
        {locations.length ? (
          <WzField label={t("metaAdsWizard.adset.conversionLocation")} error={fieldError("conversion_location")}>
            <div className="wz-stack-sm" role="radiogroup" aria-label={t("metaAdsWizard.adset.conversionLocation")}>
              {locations.map((location) => (
                <RadioCard
                  key={location.code}
                  checked={spec.conversion_location === location.code}
                  onSelect={() => chooseLocation(location.code)}
                  title={t(`metaAdsWizard.locations.${location.code}.title`)}
                  description={t(`metaAdsWizard.locations.${location.code}.desc`)}
                />
              ))}
            </div>
          </WzField>
        ) : !objective ? (
          <div className="wz-hint">{t("metaAdsWizard.adset.pickObjectiveFirst")}</div>
        ) : null}

        <WzField label={t("metaAdsWizard.adset.goal")} error={fieldError("optimization_goal")} field="optimization_goal">
          <WzSelect
            value={spec.optimization_goal}
            onChange={chooseGoal}
            options={goalOptions}
            placeholder={t("metaAdsWizard.adset.goalPlaceholder")}
            ariaLabel={t("metaAdsWizard.adset.goal")}
            disabled={!goalOptions.length}
          />
        </WzField>

        {catalogId ? (
          <WzField label={t("metaAdsWizard.adset.productSet")} error={fieldError("product_set_id")} field="product_set_id" hint={productSetOptions.length ? "" : t("metaAdsWizard.adset.noProductSets")}>
            <WzSelect
              value={spec.product_set_id}
              onChange={(value) => update({ product_set_id: value })}
              options={productSetOptions}
              placeholder={t("metaAdsWizard.adset.productSetPlaceholder")}
              ariaLabel={t("metaAdsWizard.adset.productSet")}
              disabled={!productSetOptions.length}
            />
          </WzField>
        ) : null}

        {pixelGoal || websiteEvent ? (
          <WzField label={t("metaAdsWizard.adset.conversionEvent")} error={fieldError("conversion_event")} field="conversion_event"
            hint={account?.pixel_id ? t("metaAdsWizard.adset.pixelHint", { id: account.pixel_id }) : t("metaAdsWizard.tracking.noPixel")}
          >
            <WzSelect
              value={spec.conversion_event}
              onChange={(value) => update({ conversion_event: value })}
              options={eventOptions}
              placeholder={t("metaAdsWizard.adset.conversionEventPlaceholder")}
              ariaLabel={t("metaAdsWizard.adset.conversionEvent")}
              disabled={!account?.pixel_id}
            />
          </WzField>
        ) : null}

        <MoreToggle open={more} onToggle={() => setMore((value) => !value)} label={t("metaAdsWizard.common.moreOptions")} />
        {more ? (
          <div className="wz-stack">
            {cbo ? (
              <div className="wz-hint">{t("metaAdsWizard.adset.bidOnCampaign", { strategy: t(`metaAds.bidStrategies.${strategy}`) })}</div>
            ) : (
              <WzField label={t("metaAdsWizard.adset.bidStrategy")}>
                <WzSelect value={spec.bid_strategy} onChange={(value) => update({ bid_strategy: value })} options={bidOptions} ariaLabel={t("metaAdsWizard.adset.bidStrategy")} />
              </WzField>
            )}
            {needsBidAmount(strategy) ? (
              <WzField
                label={strategy === "COST_CAP" ? t("metaAdsWizard.adset.costCapAmount") : t("metaAdsWizard.adset.bidCapAmount")}
                error={fieldError("bid_amount")}
                field="bid_amount"
              >
                <BudgetInput value={spec.bid_amount} currency={currency} invalid={Boolean(fieldError("bid_amount"))} onChange={(value) => update({ bid_amount: value })} />
              </WzField>
            ) : null}
            <WzField label={t("metaAdsWizard.adset.billing")} error={fieldError("billing_event")} field="billing_event">
              <WzSelect
                value={spec.billing_event}
                onChange={(value) => update({ billing_event: value })}
                options={billingOptions.length ? billingOptions : [{ value: "IMPRESSIONS", label: t("metaAds.billingEvents.IMPRESSIONS") }]}
                ariaLabel={t("metaAdsWizard.adset.billing")}
              />
            </WzField>
          </div>
        ) : null}
      </WzCard>

      <WzCard title={t("metaAdsWizard.budget.title")} field="budget">
        {cbo ? (
          <div className="wz-note">{t("metaAdsWizard.budget.onCampaign")}</div>
        ) : (
          <WzField label={t("metaAdsWizard.budget.label")} error={fieldError("budget")}>
            <div className="wz-budget-row">
              <Segmented
                value={spec.budget_type}
                onChange={(value) => update({ budget_type: value })}
                ariaLabel={t("metaAdsWizard.budget.label")}
                options={[
                  { value: "daily", label: t("metaAdsWizard.budget.daily") },
                  { value: "lifetime", label: t("metaAdsWizard.budget.lifetime") },
                ]}
              />
              <BudgetInput value={spec.budget} currency={currency} invalid={Boolean(fieldError("budget"))} onChange={(value) => update({ budget: value })} />
            </div>
          </WzField>
        )}
        <div className="wz-dates">
          <WzField label={t("metaAdsWizard.budget.start")} field="start_time">
            <input type="datetime-local" className="wz-date" value={spec.start_time || ""} onChange={(event) => update({ start_time: event.target.value })} />
          </WzField>
          <WzField
            label={t("metaAdsWizard.budget.end")}
            field="end_time"
            error={fieldError("end_time")}
            hint={(cbo ? campaignSpec.budget_type : spec.budget_type) === "lifetime" ? t("metaAdsWizard.budget.endRequired") : t("metaAdsWizard.budget.endOptional")}
          >
            <input
              type="datetime-local"
              className={`wz-date ${fieldError("end_time") ? "is-invalid" : ""}`.trim()}
              value={spec.end_time || ""}
              min={spec.start_time || undefined}
              onChange={(event) => update({ end_time: event.target.value })}
            />
          </WzField>
        </div>
      </WzCard>

      <AudienceCard
        spec={spec}
        update={update}
        account={account}
        catalog={catalog}
        fieldError={fieldError}
        savedAudiences={savedAudiences}
        onAudienceSaved={onAudienceSaved}
      />

      <PlacementsCard spec={spec} update={update} catalog={catalog} fieldError={fieldError} />
    </>
  );
}
