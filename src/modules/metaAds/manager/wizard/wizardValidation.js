// One rule set for the wizard's live "N مشكلة بحاجة إلى إصلاح" counter and for the
// server's POST /validate + publish gate (the server imports this file).
//
// tree = { campaign: { key, spec }, adsets: [{ key, spec, ads: [{ key, spec }] }] }
// Every issue = { level, id: node key, field, key: i18n key under metaAdsWizard.issues.* }

import {
  LIMITS,
  MIN_CAROUSEL_CARDS,
  adNeedsWebsite,
  billingEventsFor,
  destinationFor,
  effectiveBidStrategy,
  goalsFor,
  isLifetimeBudget,
  locationFor,
  needsBidAmount,
  promotedNeeds,
  usesInstantForm,
  withDefaults,
} from "./wizardModel.js";

const blank = (value) => value === undefined || value === null || String(value).trim() === "";
const positive = (value) => Number.isFinite(Number(value)) && Number(value) > 0;
const isUrl = (value) => /^https?:\/\/[^\s.]+\.[^\s]+$/i.test(String(value || "").trim());

export const validateCampaign = (node, { adsetCount = 1 } = {}) => {
  const spec = withDefaults("campaign", node.spec);
  const issues = [];
  const add = (field, key) => issues.push({ level: "campaign", id: node.key, field, key });
  if (blank(spec.objective)) add("objective", "objectiveRequired");
  if (blank(spec.name)) add("name", "campaignNameRequired");
  if (spec.cbo && !positive(spec.budget)) add("budget", "campaignBudgetRequired");
  if (adsetCount < 1) add("", "noAdsets");
  return issues;
};

export const validateAdset = (node, { campaignSpec, account = {}, catalog, adCount = 1 }) => {
  const campaign = withDefaults("campaign", campaignSpec);
  const spec = withDefaults("adset", node.spec);
  const issues = [];
  const add = (field, key) => issues.push({ level: "adset", id: node.key, field, key });
  const objective = campaign.objective;

  if (blank(spec.name)) add("name", "adsetNameRequired");

  if (objective && objective !== "OUTCOME_AWARENESS" && !locationFor(objective, spec.conversion_location, catalog)) {
    add("conversion_location", "conversionLocationRequired");
  }
  const goals = goalsFor(objective, spec.conversion_location, catalog);
  if (objective && (objective === "OUTCOME_AWARENESS" || spec.conversion_location)) {
    if (blank(spec.optimization_goal)) add("optimization_goal", "goalRequired");
    else if (!goals.includes(spec.optimization_goal)) add("optimization_goal", "goalInvalid");
    else if (!billingEventsFor(spec.optimization_goal, catalog).includes(spec.billing_event || "IMPRESSIONS")) add("billing_event", "billingEventInvalid");
  }

  if (spec.optimization_goal) {
    const needs = promotedNeeds({ objective, adsetSpec: spec, catalog });
    if (needs.page && !account.page_id) add("conversion_location", "pageRequired");
    if (needs.pixel && !account.pixel_id) add("optimization_goal", "pixelRequired");
    if (needs.pixel && account.pixel_id && blank(spec.conversion_event)) add("conversion_event", "conversionEventRequired");
    if (needs.app && (!account.application_id || !account.app_store_url)) add("conversion_location", "appRequired");
  }

  if (!campaign.cbo && !positive(spec.budget)) add("budget", "budgetRequired");
  if (needsBidAmount(effectiveBidStrategy(campaign, spec)) && !positive(spec.bid_amount)) add("bid_amount", "bidAmountRequired");
  if (isLifetimeBudget(campaign, spec) && blank(spec.end_time)) add("end_time", "endTimeRequired");
  if (!blank(spec.start_time) && !blank(spec.end_time) && String(spec.end_time) <= String(spec.start_time)) add("end_time", "endBeforeStart");

  if (!spec.locations.some((loc) => !loc.exclude)) add("locations", "locationsRequired");
  if (Number(spec.age_min) > Number(spec.age_max)) add("age", "ageRangeInvalid");
  if (spec.advantage_audience && Number(spec.age_max) < 65) add("age", "advantageAgeMax");
  if (spec.advantage_audience && Number(spec.age_min) > 25) add("age", "advantageAgeMin");

  if (spec.placements === "manual") {
    if (!spec.platforms.length) add("placements", "placementsRequired");
    else if (!spec.platforms.includes("facebook") && (spec.platforms.includes("messenger") || spec.platforms.includes("audience_network"))) {
      add("placements", "placementsNeedFacebook");
    }
  }
  if (adCount < 1) add("", "noAds");
  return issues;
};

export const validateAd = (node, { campaignSpec, adsetSpec, account = {}, catalog }) => {
  const campaign = withDefaults("campaign", campaignSpec);
  const adset = withDefaults("adset", adsetSpec);
  const spec = withDefaults("ad", node.spec);
  const issues = [];
  const add = (field, key) => issues.push({ level: "ad", id: node.key, field, key });
  const destination = destinationFor(campaign.objective, adset, catalog);

  if (blank(spec.name)) add("name", "adNameRequired");
  if (!account.page_id) add("identity", "adPageRequired");

  if (spec.format === "carousel") {
    if (spec.cards.length < MIN_CAROUSEL_CARDS) add("media", "carouselMinCards");
    else if (spec.cards.some((card) => !card.media)) add("media", "carouselCardMedia");
  } else if (!spec.media) {
    add("media", "mediaRequired");
  }

  if (blank(spec.primary_text)) add("primary_text", "primaryTextRequired");
  else if (String(spec.primary_text).length > 2200) add("primary_text", "primaryTextTooLong");
  if (String(spec.headline || "").length > 255) add("headline", "headlineTooLong");

  if (adNeedsWebsite(destination)) {
    if (blank(spec.link)) add("link", "linkRequired");
    else if (!isUrl(spec.link)) add("link", "linkInvalid");
  } else if (destination === "PHONE_CALL") {
    if (!/^tel:\+?\d{6,}$/.test(String(spec.link || "").replace(/[\s-]/g, ""))) add("link", "phoneLinkRequired");
  } else if (!blank(spec.link) && !isUrl(spec.link)) {
    add("link", "linkInvalid");
  }
  if (spec.format === "carousel" && spec.cards.some((card) => !blank(card.link) && !isUrl(card.link))) add("media", "cardLinkInvalid");

  if (usesInstantForm(campaign.objective, adset) && blank(spec.lead_form_id)) add("lead_form_id", "leadFormRequired");
  return issues;
};

export const validateTree = (tree, { account = {}, catalog } = {}) => {
  const issues = [];
  const campaignSpec = tree?.campaign?.spec || {};
  const adsets = tree?.adsets || [];
  issues.push(...validateCampaign(tree.campaign || { key: "campaign", spec: {} }, { adsetCount: adsets.length }));
  for (const adset of adsets) {
    const ads = adset.ads || [];
    issues.push(...validateAdset(adset, { campaignSpec, account, catalog, adCount: ads.length }));
    for (const ad of ads) issues.push(...validateAd(ad, { campaignSpec, adsetSpec: adset.spec, account, catalog }));
  }
  return issues;
};

// Soft limits shown as counters (Meta truncates in some placements; not blocking).
export const SOFT_LIMITS = LIMITS;
