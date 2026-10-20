// Creates / updates / deletes Meta objects from our rows. Owned by the wizard area;
// the record pages (records/) call these for "Push to Meta", "Update on Meta" and
// "Delete on Meta".
//
// Contract (all async, ctx = getAccountContext(...) from ../../metaAdsCore.js):
//   publishCampaignTree(ctx, campaignId, { userId })  → { campaign_meta_id, adsets: [...], ads: [...], errors: [...] }
//       publishes a draft campaign with all its draft ad sets / ads / creatives, in order.
//   pushObject(ctx, level, id)        level ∈ campaign|adset|ad|creative — create on Meta when meta_id is NULL
//                                     (parents must already be on Meta) → { meta_id }
//   updateObject(ctx, level, id)      send the row's editable fields to Meta → { meta_id }
//   setObjectStatus(ctx, level, id, status)   status ∈ ACTIVE|PAUSED → { meta_id, status }
//   deleteObject(ctx, level, id)      DELETE on Meta, then mark the row DELETED → { meta_id }
//
// publishCampaignTree throws a 422 (code META_ADS_INVALID, error.issues = [...]) when the
// tree fails wizardValidation; Meta failures do not throw — they are written to the
// failing row's last_error and returned in `errors` ({ level, id, message, title }).
// Re-publishing continues where it stopped: rows that already have a meta_id are
// updated, not re-created.
//
// Payloads are built from the row's normalized COLUMNS (the wizard keeps them in sync
// with `spec` on every draft save), so rows created elsewhere publish the same way.
// The campaign is created PAUSED, children are created ACTIVE underneath it, and the
// campaign is flipped to ACTIVE last — a failure half-way never leaves anything delivering.

import db from "../../../../database/db.js";
import { MetaAdsGraphError, graphDelete, graphGet, graphPost, toMinorUnits } from "../../metaAdsGraph.js";
import { httpError, requireToken, text } from "../../metaAdsCore.js";
import {
  APP_DESTINATION,
  isMessagingDestination,
  needsBidAmount,
  targetedCountries,
  targetsEu,
} from "../../../../../src/modules/metaAds/manager/wizard/wizardModel.js";
import { validateTree } from "../../../../../src/modules/metaAds/manager/wizard/wizardValidation.js";
import { catalog, loadTree, validationTree } from "./wizardDrafts.js";

const TABLE = {
  campaign: "meta_ads_campaigns",
  adset: "meta_ads_adsets",
  ad: "meta_ads_ads",
  creative: "meta_ads_creatives",
};

const tableFor = (level) => {
  const table = TABLE[level];
  if (!table) throw httpError(400, "Unknown level");
  return table;
};

const json = (value) => JSON.stringify(value ?? null);
const isoOrNull = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};
const nonEmpty = (obj) => obj && typeof obj === "object" && Object.keys(obj).length > 0;

const errorText = (error) => {
  if (error instanceof MetaAdsGraphError) return { message: error.userMessage || error.message, title: error.userTitle || "" };
  return { message: text(error?.message) || "Request failed", title: "" };
};

const getRow = async (tenantId, level, id) => {
  const { rows } = await db.query(`SELECT * FROM ${tableFor(level)} WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
  if (!rows[0]) throw httpError(404, `${level} not found`);
  return rows[0];
};

const setError = async (tenantId, level, id, message) => {
  await db.query(`UPDATE ${tableFor(level)} SET last_error = $3, updated_at = NOW() WHERE tenant_id = $1 AND id = $2`, [
    tenantId, id, text(message).slice(0, 2000) || null,
  ]);
};

const markLive = async (tenantId, level, id, metaId, { status = null, extraSql = "", extraParams = [] } = {}) => {
  await db.query(
    `UPDATE ${tableFor(level)} SET meta_id = $3, is_draft = FALSE, last_error = NULL, status = COALESCE($4::text, status),
       meta_created_time = COALESCE(meta_created_time, NOW()), meta_updated_time = NOW(), updated_at = NOW() ${extraSql}
     WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id, metaId, status, ...extraParams],
  );
};

const touchLive = async (tenantId, level, id) => {
  await db.query(`UPDATE ${tableFor(level)} SET last_error = NULL, meta_updated_time = NOW(), updated_at = NOW() WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
};

// ------------------------------------------------------------------ payload builders

const campaignParams = (row, { currency, countries = [], forCreate }) => {
  const params = { name: text(row.name) };
  const cbo = Boolean(row.campaign_budget_optimization) || Number(row.daily_budget) > 0 || Number(row.lifetime_budget) > 0;
  if (forCreate) {
    const categories = (Array.isArray(row.special_ad_categories) ? row.special_ad_categories : []).filter((c) => c && c !== "NONE");
    Object.assign(params, {
      objective: row.objective,
      status: "PAUSED",
      special_ad_categories: categories,
      buying_type: "AUCTION",
    });
    if (categories.length && countries.length) params.special_ad_category_country = countries;
    if (!cbo) params.is_adset_budget_sharing_enabled = false;
  }
  if (cbo) {
    if (Number(row.lifetime_budget) > 0) params.lifetime_budget = toMinorUnits(row.lifetime_budget, currency);
    else if (Number(row.daily_budget) > 0) params.daily_budget = toMinorUnits(row.daily_budget, currency);
    params.bid_strategy = row.bid_strategy || "LOWEST_COST_WITHOUT_CAP";
  }
  return params;
};

const adsetTargetsEu = (row) => {
  const spec = row.spec || {};
  if (Array.isArray(spec.locations)) return targetsEu(spec, catalog);
  const eu = new Set(catalog.eu_countries || []);
  return (row.targeting?.geo_locations?.countries || []).some((code) => eu.has(String(code).toUpperCase()));
};

const adsetParams = (row, { campaign, account, currency, forCreate }) => {
  const cbo = Boolean(campaign.campaign_budget_optimization);
  const params = { name: text(row.name), targeting: row.targeting || {} };
  if (forCreate) {
    Object.assign(params, {
      campaign_id: campaign.meta_id,
      optimization_goal: row.optimization_goal,
      billing_event: row.billing_event || "IMPRESSIONS",
      status: "ACTIVE",
    });
    if (row.destination_type) params.destination_type = row.destination_type;
    if (nonEmpty(row.promoted_object)) params.promoted_object = row.promoted_object;
    // EU / EEA targeting needs the DSA beneficiary + payer (we use the page name).
    if (adsetTargetsEu(row)) {
      const who = text(account.page_name) || text(account.name);
      if (who) Object.assign(params, { dsa_beneficiary: who, dsa_payor: who });
    }
  }
  const start = isoOrNull(row.start_time);
  const end = isoOrNull(row.end_time);
  if (start && (forCreate || new Date(start) > new Date())) params.start_time = start;
  if (end) params.end_time = end;
  if (!cbo) {
    if (Number(row.lifetime_budget) > 0) params.lifetime_budget = toMinorUnits(row.lifetime_budget, currency);
    else if (Number(row.daily_budget) > 0) params.daily_budget = toMinorUnits(row.daily_budget, currency);
    params.bid_strategy = row.bid_strategy || "LOWEST_COST_WITHOUT_CAP";
  }
  const strategy = cbo ? campaign.bid_strategy : row.bid_strategy;
  if (needsBidAmount(strategy) && Number(row.bid_amount) > 0) params.bid_amount = toMinorUnits(row.bid_amount, currency);
  return params;
};

// Advantage+ creative. Since v22 the `standard_enhancements` bundle is deprecated, so
// each enhancement is enrolled (or opted out) individually.
const ENHANCEMENTS_IMAGE = ["image_touchups", "image_brightness_and_contrast", "text_optimizations", "enhance_cta"];
const ENHANCEMENTS_VIDEO = ["text_optimizations", "enhance_cta"];
const degreesOfFreedom = (enabled, isVideo) => {
  const status = enabled ? "OPT_IN" : "OPT_OUT";
  const features = isVideo ? ENHANCEMENTS_VIDEO : ENHANCEMENTS_IMAGE;
  return { creative_features_spec: Object.fromEntries(features.map((name) => [name, { enroll_status: status }])) };
};

const videoThumbnail = async (videoId, token) => {
  if (!videoId) return "";
  try {
    const res = await graphGet(`/${videoId}/thumbnails`, token, {});
    const list = res?.data || [];
    return text((list.find((row) => row.is_preferred) || list[0])?.uri);
  } catch {
    return "";
  }
};

const creativeParams = async (row, { account, destination, token }) => {
  const pageId = text(row.page_id || account.page_id);
  if (!pageId) throw httpError(422, "No Facebook page is linked to this ad account.");
  const spec = row.spec || {};
  const messaging = isMessagingDestination(destination);
  const pageLink = `https://www.facebook.com/${pageId}`;
  const typed = text(row.destination_url);
  const isPhone = destination === "PHONE_CALL";
  const appStore = destination === "APP" ? text(account.app_store_url) : "";
  const link = appStore || (isPhone ? pageLink : typed) || pageLink;
  const ctaType = text(row.call_to_action);

  let callToAction = null;
  if (ctaType && ctaType !== "NO_BUTTON") {
    let value;
    if (messaging) value = { app_destination: APP_DESTINATION[destination] || "MESSENGER" };
    else if (spec.lead_form_id) value = { lead_gen_form_id: text(spec.lead_form_id) };
    else if (isPhone) value = { link: typed };
    else value = { link };
    callToAction = { type: ctaType, value };
  }

  const story = { page_id: pageId };
  if (row.instagram_user_id) story.instagram_user_id = text(row.instagram_user_id);
  const isVideo = row.creative_type === "video";

  if (row.creative_type === "carousel") {
    const cards = Array.isArray(row.carousel_cards) ? row.carousel_cards : [];
    const children = [];
    for (const card of cards) {
      const child = { link: text(card.link) || link };
      if (card.headline) child.name = text(card.headline);
      if (card.description) child.description = text(card.description);
      if (card.video_id) {
        child.video_id = text(card.video_id);
        const picture = text(card.thumbnail_url) || (await videoThumbnail(card.video_id, token));
        if (picture) child.picture = picture;
      } else {
        child.image_hash = text(card.image_hash);
      }
      if (callToAction) child.call_to_action = callToAction;
      children.push(child);
    }
    story.link_data = { link, child_attachments: children, multi_share_end_card: false, multi_share_optimized: true };
    if (row.primary_text) story.link_data.message = text(row.primary_text);
    if (row.display_url) story.link_data.caption = text(row.display_url);
    if (callToAction) story.link_data.call_to_action = callToAction;
  } else if (isVideo) {
    const imageUrl = text(row.thumbnail_url) || (await videoThumbnail(row.video_id, token));
    story.video_data = { video_id: text(row.video_id) };
    if (imageUrl) story.video_data.image_url = imageUrl;
    if (row.primary_text) story.video_data.message = text(row.primary_text);
    if (row.headline) story.video_data.title = text(row.headline);
    if (row.description) story.video_data.link_description = text(row.description);
    if (callToAction) story.video_data.call_to_action = callToAction;
  } else {
    story.link_data = { link };
    if (row.image_hash) story.link_data.image_hash = text(row.image_hash);
    if (row.primary_text) story.link_data.message = text(row.primary_text);
    if (row.headline) story.link_data.name = text(row.headline);
    if (row.description) story.link_data.description = text(row.description);
    if (row.display_url) story.link_data.caption = text(row.display_url);
    if (callToAction) story.link_data.call_to_action = callToAction;
  }

  const params = { name: text(row.name) || `Creative ${row.id}`, object_story_spec: story };
  if (row.url_tags) params.url_tags = text(row.url_tags).replace(/^\?/, "");
  params.degrees_of_freedom_spec = degreesOfFreedom(Boolean(row.advantage_creative), isVideo);
  return params;
};

const adParams = (row, { adset, creativeMetaId, forCreate }) => {
  const params = { name: text(row.name) };
  if (forCreate) Object.assign(params, { adset_id: adset.meta_id, creative: { creative_id: creativeMetaId }, status: "ACTIVE" });
  else if (creativeMetaId) params.creative = { creative_id: creativeMetaId };
  if (Array.isArray(row.tracking_specs) && row.tracking_specs.length) params.tracking_specs = row.tracking_specs;
  return params;
};

// ------------------------------------------------------------------ per-level create / update

const countriesForCampaign = async (tenantId, campaignId) => {
  const { rows } = await db.query(`SELECT spec, targeting FROM meta_ads_adsets WHERE tenant_id = $1 AND campaign_id = $2`, [tenantId, campaignId]);
  const set = new Set();
  for (const row of rows) {
    const fromSpec = Array.isArray(row.spec?.locations) ? targetedCountries(row.spec) : [];
    const fromTargeting = row.targeting?.geo_locations?.countries || [];
    for (const code of [...fromSpec, ...fromTargeting]) if (code) set.add(String(code).toUpperCase());
  }
  return [...set];
};

const createCampaign = async (ctx, row) => {
  const tenantId = ctx.account.tenant_id;
  const countries = await countriesForCampaign(tenantId, row.id);
  const res = await graphPost(`/${ctx.actId}/campaigns`, ctx.token, campaignParams(row, { currency: ctx.account.currency, countries, forCreate: true }));
  const metaId = text(res.id);
  await markLive(tenantId, "campaign", row.id, metaId, { status: "PAUSED" });
  await db.query(`UPDATE meta_ads_adsets SET campaign_meta_id = $3 WHERE tenant_id = $1 AND campaign_id = $2`, [tenantId, row.id, metaId]);
  return metaId;
};

const createAdset = async (ctx, row, campaign) => {
  const tenantId = ctx.account.tenant_id;
  if (!campaign.meta_id) throw httpError(409, "Publish the campaign first.");
  const res = await graphPost(`/${ctx.actId}/adsets`, ctx.token, adsetParams(row, { campaign, account: ctx.account, currency: ctx.account.currency, forCreate: true }));
  const metaId = text(res.id);
  await markLive(tenantId, "adset", row.id, metaId, { status: "ACTIVE", extraSql: ", campaign_meta_id = $5", extraParams: [campaign.meta_id] });
  await db.query(`UPDATE meta_ads_ads SET adset_meta_id = $3, campaign_meta_id = $4 WHERE tenant_id = $1 AND adset_id = $2`, [tenantId, row.id, metaId, campaign.meta_id]);
  return metaId;
};

const createCreative = async (ctx, creative, { destination }) => {
  const tenantId = ctx.account.tenant_id;
  const params = await creativeParams(creative, { account: ctx.account, destination, token: ctx.token });
  const res = await graphPost(`/${ctx.actId}/adcreatives`, ctx.token, params);
  const metaId = text(res.id);
  await markLive(tenantId, "creative", creative.id, metaId, { extraSql: ", raw = $5::jsonb", extraParams: [json({ id: metaId, ...params })] });
  await db.query(`UPDATE meta_ads_ads SET creative_meta_id = $3 WHERE tenant_id = $1 AND creative_id = $2`, [tenantId, creative.id, metaId]);
  return metaId;
};

const createAd = async (ctx, row, { adset, creativeMetaId }) => {
  const tenantId = ctx.account.tenant_id;
  if (!adset.meta_id) throw httpError(409, "Publish the ad set first.");
  const res = await graphPost(`/${ctx.actId}/ads`, ctx.token, adParams(row, { adset, creativeMetaId, forCreate: true }));
  const metaId = text(res.id);
  await markLive(tenantId, "ad", row.id, metaId, {
    status: "ACTIVE",
    extraSql: ", adset_meta_id = $5, campaign_meta_id = $6, creative_meta_id = $7",
    extraParams: [adset.meta_id, adset.campaign_meta_id, creativeMetaId],
  });
  return metaId;
};

const updateCampaignOnMeta = async (ctx, row) => {
  await graphPost(`/${row.meta_id}`, ctx.token, campaignParams(row, { currency: ctx.account.currency, forCreate: false }));
  await touchLive(ctx.account.tenant_id, "campaign", row.id);
};

const updateAdsetOnMeta = async (ctx, row, campaign) => {
  await graphPost(`/${row.meta_id}`, ctx.token, adsetParams(row, { campaign, account: ctx.account, currency: ctx.account.currency, forCreate: false }));
  await touchLive(ctx.account.tenant_id, "adset", row.id);
};

// A live ad: push its name/tracking, and swap in a new creative when the wizard made one.
const updateAdOnMeta = async (ctx, row, { adset, creative }) => {
  let creativeMetaId = null;
  if (creative && !creative.meta_id) creativeMetaId = await createCreative(ctx, creative, { destination: adset.destination_type });
  await graphPost(`/${row.meta_id}`, ctx.token, adParams(row, { adset, creativeMetaId, forCreate: false }));
  await touchLive(ctx.account.tenant_id, "ad", row.id);
  if (creativeMetaId) {
    await db.query(`UPDATE meta_ads_ads SET creative_meta_id = $3 WHERE tenant_id = $1 AND id = $2`, [ctx.account.tenant_id, row.id, creativeMetaId]);
  }
};

// ------------------------------------------------------------------ contract

export const publishCampaignTree = async (ctx, campaignId, { userId: _userId } = {}) => {
  requireToken(ctx);
  const tenantId = ctx.account.tenant_id;
  const tree = await loadTree(tenantId, campaignId);
  if (String(tree.campaignRow.account_id) !== String(ctx.account.id)) throw httpError(409, "Campaign belongs to another ad account.");
  const issues = validateTree(validationTree(tree), { account: ctx.account, catalog });
  if (issues.length) throw Object.assign(httpError(422, "The campaign has issues to fix before publishing.", "META_ADS_INVALID"), { issues });

  const result = { campaign_meta_id: tree.campaignRow.meta_id || null, adsets: [], ads: [], errors: [] };
  const STOP = Symbol("stop");
  const step = async (level, id, fn) => {
    try {
      return await fn();
    } catch (error) {
      const { message, title } = errorText(error);
      await setError(tenantId, level, id, title ? `${title}: ${message}` : message);
      result.errors.push({ level, id, message, title });
      throw STOP;
    }
  };

  try {
    let campaign = tree.campaignRow;
    const wasNew = !campaign.meta_id;
    const pendingActivation = wasNew || Boolean(campaign.spec?.__publish_pending);
    if (wasNew) {
      await db.query(`UPDATE meta_ads_campaigns SET spec = spec || '{"__publish_pending":true}'::jsonb WHERE tenant_id = $1 AND id = $2`, [tenantId, campaign.id]);
      result.campaign_meta_id = await step("campaign", campaign.id, () => createCampaign(ctx, campaign));
    } else {
      await step("campaign", campaign.id, () => updateCampaignOnMeta(ctx, campaign));
    }
    campaign = await getRow(tenantId, "campaign", campaign.id);

    for (const adsetNode of tree.adsets) {
      let adset = await getRow(tenantId, "adset", adsetNode.id);
      if (!adset.meta_id) await step("adset", adset.id, () => createAdset(ctx, adset, campaign));
      else await step("adset", adset.id, () => updateAdsetOnMeta(ctx, adset, campaign));
      adset = await getRow(tenantId, "adset", adset.id);
      result.adsets.push({ id: adset.id, meta_id: adset.meta_id });

      for (const adNode of adsetNode.ads) {
        const ad = await getRow(tenantId, "ad", adNode.id);
        const creative = ad.creative_id ? await getRow(tenantId, "creative", ad.creative_id) : null;
        if (!ad.meta_id) {
          const creativeMetaId = await step("ad", ad.id, async () => {
            if (!creative) throw httpError(422, "The ad has no creative.");
            return creative.meta_id || createCreative(ctx, creative, { destination: adset.destination_type });
          });
          await step("ad", ad.id, () => createAd(ctx, ad, { adset, creativeMetaId }));
        } else {
          await step("ad", ad.id, () => updateAdOnMeta(ctx, ad, { adset, creative }));
        }
        const fresh = await getRow(tenantId, "ad", ad.id);
        result.ads.push({ id: fresh.id, meta_id: fresh.meta_id });
      }
    }

    // Everything exists: switch the campaign on (Ads Manager publishes ACTIVE).
    if (pendingActivation) {
      const wantActive = (campaign.spec?.publish_status || "ACTIVE") === "ACTIVE";
      if (wantActive) {
        await step("campaign", campaign.id, async () => {
          await graphPost(`/${campaign.meta_id}`, ctx.token, { status: "ACTIVE" });
          await db.query(`UPDATE meta_ads_campaigns SET status = 'ACTIVE' WHERE tenant_id = $1 AND id = $2`, [tenantId, campaign.id]);
        });
      }
      await db.query(`UPDATE meta_ads_campaigns SET spec = spec - '__publish_pending' WHERE tenant_id = $1 AND id = $2`, [tenantId, campaign.id]);
    }
  } catch (error) {
    if (error !== STOP) throw error;
  }
  return result;
};

export const pushObject = async (ctx, level, id) => {
  requireToken(ctx);
  const tenantId = ctx.account.tenant_id;
  const row = await getRow(tenantId, level, id);
  if (row.meta_id) return updateObject(ctx, level, id);
  try {
    let metaId;
    if (level === "campaign") {
      metaId = await createCampaign(ctx, row);
    } else if (level === "adset") {
      metaId = await createAdset(ctx, row, await getRow(tenantId, "campaign", row.campaign_id));
    } else if (level === "creative") {
      metaId = await createCreative(ctx, row, { destination: row.spec?.destination || "" });
    } else if (level === "ad") {
      const adset = await getRow(tenantId, "adset", row.adset_id);
      const creative = row.creative_id ? await getRow(tenantId, "creative", row.creative_id) : null;
      if (!creative) throw httpError(422, "The ad has no creative.");
      const creativeMetaId = creative.meta_id || (await createCreative(ctx, creative, { destination: adset.destination_type }));
      metaId = await createAd(ctx, row, { adset, creativeMetaId });
    } else {
      throw httpError(400, "Unknown level");
    }
    return { meta_id: metaId };
  } catch (error) {
    await setError(tenantId, level, id, errorText(error).message);
    throw error;
  }
};

export const updateObject = async (ctx, level, id) => {
  requireToken(ctx);
  const tenantId = ctx.account.tenant_id;
  const row = await getRow(tenantId, level, id);
  if (!row.meta_id) throw httpError(409, "This object is not on Meta yet; push it first.");
  try {
    if (level === "campaign") {
      await updateCampaignOnMeta(ctx, row);
    } else if (level === "adset") {
      await updateAdsetOnMeta(ctx, row, await getRow(tenantId, "campaign", row.campaign_id));
    } else if (level === "ad") {
      const adset = await getRow(tenantId, "adset", row.adset_id);
      const creative = row.creative_id ? await getRow(tenantId, "creative", row.creative_id) : null;
      await updateAdOnMeta(ctx, row, { adset, creative });
    } else if (level === "creative") {
      // Creatives are immutable on Meta apart from their name.
      await graphPost(`/${row.meta_id}`, ctx.token, { name: text(row.name) });
      await touchLive(tenantId, "creative", row.id);
    } else {
      throw httpError(400, "Unknown level");
    }
    return { meta_id: row.meta_id };
  } catch (error) {
    await setError(tenantId, level, id, errorText(error).message);
    throw error;
  }
};

export const setObjectStatus = async (ctx, level, id, status) => {
  requireToken(ctx);
  const wanted = String(status || "").toUpperCase();
  if (!["ACTIVE", "PAUSED"].includes(wanted)) throw httpError(400, "status must be ACTIVE or PAUSED");
  if (level === "creative") throw httpError(400, "Creatives have no delivery status");
  const tenantId = ctx.account.tenant_id;
  const row = await getRow(tenantId, level, id);
  if (!row.meta_id) throw httpError(409, "This object is not on Meta yet.");
  await graphPost(`/${row.meta_id}`, ctx.token, { status: wanted });
  let effective = null;
  try {
    const info = await graphGet(`/${row.meta_id}`, ctx.token, { fields: "status,effective_status" });
    effective = text(info?.effective_status) || null;
  } catch {
    // best effort: the next sync fills it in
  }
  await db.query(
    `UPDATE ${tableFor(level)} SET status = $3, effective_status = COALESCE($4::text, effective_status), last_error = NULL,
       meta_updated_time = NOW(), updated_at = NOW() WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id, wanted, effective],
  );
  return { meta_id: row.meta_id, status: wanted, effective_status: effective };
};

export const deleteObject = async (ctx, level, id) => {
  requireToken(ctx);
  const tenantId = ctx.account.tenant_id;
  const row = await getRow(tenantId, level, id);
  if (!row.meta_id) throw httpError(409, "This object is not on Meta.");
  try {
    await graphDelete(`/${row.meta_id}`, ctx.token);
  } catch (error) {
    // Already gone on Meta (code 100): still mark it deleted here.
    if (!(error instanceof MetaAdsGraphError && Number(error.code) === 100)) {
      await setError(tenantId, level, id, errorText(error).message);
      throw error;
    }
  }
  const statusSql = level === "creative" ? "" : ", status = 'DELETED', effective_status = 'DELETED'";
  await db.query(`UPDATE ${tableFor(level)} SET last_error = NULL, updated_at = NOW() ${statusSql} WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
  return { meta_id: row.meta_id };
};
