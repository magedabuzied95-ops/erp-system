import { Megaphone, MessageCircleHeart, MousePointerClick, ShoppingCart, TabletSmartphone, UserPlus } from "lucide-react";
import { useTranslation } from "react-i18next";

import { RadioCard, Segmented, ToggleCard, WzCard, WzField, WzInput, WzSelect } from "../parts";
import { BudgetInput } from "./BudgetInput";

const ICONS = { Megaphone, MousePointerClick, MessageCircleHeart, UserPlus, TabletSmartphone, ShoppingCart };

export default function CampaignStep({ spec, update, catalog, currency, fieldError }) {
  const { t } = useTranslation();
  const objectives = catalog?.objectives || [];

  const categoryOptions = [
    { value: "", label: t("metaAdsWizard.campaign.noCategory") },
    ...(catalog?.special_ad_categories || []).map((code) => ({ value: code, label: t(`metaAds.specialCategories.${code}`) })),
  ];
  const bidOptions = (catalog?.bid_strategies || []).map((code) => ({ value: code, label: t(`metaAds.bidStrategies.${code}`) }));

  return (
    <>
      <WzCard title={t("metaAdsWizard.campaign.objectiveTitle")} subtitle={t("metaAdsWizard.campaign.objectiveSubtitle")} field="objective">
        <div className="wz-objectives" role="radiogroup" aria-label={t("metaAdsWizard.campaign.objectiveTitle")}>
          {objectives.map((objective) => (
            <RadioCard
              key={objective.code}
              checked={spec.objective === objective.code}
              onSelect={() => update({ objective: objective.code })}
              icon={ICONS[objective.icon]}
              title={t(`metaAds.objectives.${objective.code}.label`)}
              description={t(`metaAds.objectives.${objective.code}.description`)}
            />
          ))}
        </div>
        {spec.objective ? (
          <div className="wz-goodfor">
            <div className="wz-goodfor__label">{t("metaAdsWizard.campaign.goodFor")}</div>
            <div className="wz-chips">
              {(objectives.find((row) => row.code === spec.objective)?.goodFor || []).map((code) => (
                <span key={code} className="wz-chip wz-chip--static">{t(`metaAds.goodFor.${code}`)}</span>
              ))}
            </div>
          </div>
        ) : null}
        {fieldError("objective") ? <div className="wz-error">{fieldError("objective")}</div> : null}
      </WzCard>

      <WzCard title={t("metaAdsWizard.campaign.nameTitle")} field="name">
        <WzField error={fieldError("name")}>
          <WzInput
            value={spec.name}
            onChange={(event) => update({ name: event.target.value })}
            placeholder={t("metaAdsWizard.campaign.namePlaceholder")}
            invalid={Boolean(fieldError("name"))}
            maxLength={400}
          />
        </WzField>
      </WzCard>

      <WzCard title={t("metaAdsWizard.campaign.categoriesTitle")} subtitle={t("metaAdsWizard.campaign.categoriesSubtitle")} field="special_ad_category">
        <WzSelect
          value={spec.special_ad_category}
          onChange={(value) => update({ special_ad_category: value })}
          options={categoryOptions}
          placeholder={t("metaAdsWizard.campaign.categoriesPlaceholder")}
          ariaLabel={t("metaAdsWizard.campaign.categoriesTitle")}
        />
      </WzCard>

      <WzCard field="ab_test">
        <ToggleCard
          title={t("metaAdsWizard.campaign.abTitle")}
          description={t("metaAdsWizard.campaign.abBody")}
          checked={spec.ab_test}
          onChange={(value) => update({ ab_test: value })}
        />
      </WzCard>

      <WzCard field="cbo">
        <ToggleCard
          title={t("metaAdsWizard.campaign.cboTitle")}
          description={t("metaAdsWizard.campaign.cboBody")}
          checked={spec.cbo}
          onChange={(value) => update({ cbo: value })}
        />
        {spec.cbo ? (
          <div className="wz-stack wz-cbo" data-wz-field="budget">
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
            <WzField label={t("metaAdsWizard.adset.bidStrategy")}>
              <WzSelect value={spec.bid_strategy} onChange={(value) => update({ bid_strategy: value })} options={bidOptions} ariaLabel={t("metaAdsWizard.adset.bidStrategy")} />
            </WzField>
            {spec.budget_type === "lifetime" ? <div className="wz-hint">{t("metaAdsWizard.budget.lifetimeNeedsEnd")}</div> : null}
          </div>
        ) : null}
      </WzCard>
    </>
  );
}
