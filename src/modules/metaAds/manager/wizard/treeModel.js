import { defaultAdSpec, defaultAdsetSpec, defaultCampaignSpec, goalsFor, locationFor, withDefaults } from "./wizardModel";

// Client-side tree helpers for the wizard. Nodes carry a stable client `key`; rows that
// exist on the server also carry `id` (and ads a `creative_id`).

let seq = 0;
export const newKey = (prefix) => {
  seq += 1;
  return `${prefix}-new-${Date.now().toString(36)}-${seq}`;
};

export const nodeLabel = (t, level, spec) => {
  const name = String(spec?.name || "").trim();
  if (name) return name;
  if (level === "campaign") return t("metaAdsWizard.tree.newCampaign");
  if (level === "adset") return t("metaAdsWizard.tree.newAdset");
  return t("metaAdsWizard.tree.newAd");
};

export const newAd = () => ({ key: newKey("ad"), id: null, creative_id: null, meta_id: null, last_error: null, spec: defaultAdSpec() });
export const newAdset = () => ({ key: newKey("adset"), id: null, meta_id: null, last_error: null, spec: defaultAdsetSpec(), ads: [newAd()] });

export const freshTree = () => ({
  campaign: { key: newKey("campaign"), id: null, meta_id: null, last_error: null, spec: defaultCampaignSpec() },
  adsets: [newAdset()],
});

const fromServerNode = (level, row) => ({
  key: `${level}-${row.id}`,
  id: row.id,
  meta_id: row.meta_id || null,
  last_error: row.last_error || null,
  status: row.status,
  is_draft: row.is_draft,
  spec: withDefaults(level, row.spec),
});

export const treeFromServer = (data) => ({
  campaign: { ...fromServerNode("campaign", data.campaign), account_id: data.campaign.account_id },
  adsets: (data.adsets || []).map((adset) => ({
    ...fromServerNode("adset", adset),
    ads: (adset.ads || []).map((ad) => ({ ...fromServerNode("ad", ad), creative_id: ad.creative_id || null })),
  })),
});

export const findNode = (tree, level, key) => {
  if (!tree) return null;
  if (level === "campaign") return tree.campaign.key === key ? tree.campaign : null;
  for (const adset of tree.adsets) {
    if (level === "adset" && adset.key === key) return adset;
    if (level === "ad") {
      const ad = adset.ads.find((row) => row.key === key);
      if (ad) return ad;
    }
  }
  return null;
};

export const parentOf = (tree, adKey) => tree.adsets.find((adset) => adset.ads.some((ad) => ad.key === adKey)) || null;

export const mapNodes = (tree, fn) => ({
  campaign: fn("campaign", tree.campaign) || tree.campaign,
  adsets: tree.adsets.map((adset) => {
    const nextAdset = fn("adset", adset) || adset;
    return { ...nextAdset, ads: nextAdset.ads.map((ad) => fn("ad", ad) || ad) };
  }),
});

// When the objective changes, drop conversion locations / goals that no longer apply.
export const sanitizeAdsetSpec = (spec, objective, catalog) => {
  let next = spec;
  if (spec.conversion_location && !locationFor(objective, spec.conversion_location, catalog)) next = { ...next, conversion_location: "" };
  const goals = goalsFor(objective, next.conversion_location, catalog);
  if (next.optimization_goal && !goals.includes(next.optimization_goal)) next = { ...next, optimization_goal: objective === "OUTCOME_AWARENESS" ? goals[0] || "" : "" };
  if (!next.optimization_goal && objective === "OUTCOME_AWARENESS") next = { ...next, optimization_goal: goals[0] || "" };
  return next;
};

export const validationShape = (tree) => ({
  campaign: { key: tree.campaign.key, spec: tree.campaign.spec },
  adsets: tree.adsets.map((adset) => ({ key: adset.key, spec: adset.spec, ads: adset.ads.map((ad) => ({ key: ad.key, spec: ad.spec })) })),
});

export const levelOfKey = (tree, key) => {
  if (tree.campaign.key === key) return "campaign";
  for (const adset of tree.adsets) {
    if (adset.key === key) return "adset";
    if (adset.ads.some((ad) => ad.key === key)) return "ad";
  }
  return null;
};
