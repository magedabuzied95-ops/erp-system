// Wizard drafts: the form state of every node lives in `spec` (JSONB); the normalized
// columns (name, budgets, goal, targeting, creative fields…) are re-derived from it on
// every save so the Ads Manager lists and the record pages read real values, and so the
// publisher can build Marketing API payloads from columns alone.

import db from "../../../../database/db.js";
import { metaAdsCatalog } from "../../metaAdsCatalog.js";
import { httpError, text } from "../../metaAdsCore.js";
import { CATALOG_CREATIVE_TYPE, DEFAULT_CATALOG_DESCRIPTION, DEFAULT_CATALOG_HEADLINE } from "../../metaAdsCatalogAds.js";
import {
  cairoLocalToIso,
  destinationFor,
  isoToCairoLocal,
  locationsFor,
  promotedObjectFor,
  resolveCta,
  specFromTargeting,
  targetingFromSpec,
  withDefaults,
} from "../../../../../src/modules/metaAds/manager/wizard/wizardModel.js";

export const catalog = metaAdsCatalog();

const money = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) / 100 : null;
};
// A spec written by POST /manager/duplicate for a copied live row ({ source: "copy", … }) is
// not wizard form state: rebuild it from the columns like an empty one.
const isEmptySpec = (spec) => !spec || typeof spec !== "object" || !Object.keys(spec).length || spec.source === "copy";
const json = (value) => JSON.stringify(value ?? null);

// ------------------------------------------------------------------ spec → columns

export const campaignColumns = (raw) => {
  const spec = withDefaults("campaign", raw);
  const budget = spec.cbo ? money(spec.budget) : null;
  return {
    name: text(spec.name),
    objective: text(spec.objective) || null,
    special_ad_categories: spec.special_ad_category ? [spec.special_ad_category] : [],
    campaign_budget_optimization: Boolean(spec.cbo),
    ab_test: Boolean(spec.ab_test),
    daily_budget: spec.cbo && spec.budget_type !== "lifetime" ? budget : null,
    lifetime_budget: spec.cbo && spec.budget_type === "lifetime" ? budget : null,
    bid_strategy: spec.cbo ? spec.bid_strategy || "LOWEST_COST_WITHOUT_CAP" : null,
  };
};

export const adsetColumns = (raw, campaignRaw, account) => {
  const spec = withDefaults("adset", raw);
  const campaign = withDefaults("campaign", campaignRaw);
  const destination = destinationFor(campaign.objective, spec, catalog);
  const budget = campaign.cbo ? null : money(spec.budget);
  return {
    name: text(spec.name),
    optimization_goal: text(spec.optimization_goal) || null,
    billing_event: text(spec.billing_event) || "IMPRESSIONS",
    destination_type: destination || null,
    bid_strategy: campaign.cbo ? null : spec.bid_strategy || "LOWEST_COST_WITHOUT_CAP",
    bid_amount: money(spec.bid_amount),
    daily_budget: budget && spec.budget_type !== "lifetime" ? budget : null,
    lifetime_budget: budget && spec.budget_type === "lifetime" ? budget : null,
    promoted_object: promotedObjectFor({ objective: campaign.objective, adsetSpec: spec, account, catalog }),
    targeting: targetingFromSpec(spec, catalog),
    start_time: cairoLocalToIso(spec.start_time),
    end_time: cairoLocalToIso(spec.end_time),
  };
};

const mediaColumns = (media) => ({
  image_hash: media?.type === "image" ? text(media.image_hash) || null : null,
  image_url: media?.type === "image" ? text(media.url) || null : null,
  video_id: media?.type === "video" ? text(media.video_id) || null : null,
  thumbnail_url: media?.type === "video" ? text(media.thumbnail_url) || null : null,
});

export const creativeColumns = (raw, { campaignSpec, adsetSpec, account }) => {
  const spec = withDefaults("ad", raw);
  const campaign = withDefaults("campaign", campaignSpec);
  const destination = destinationFor(campaign.objective, withDefaults("adset", adsetSpec), catalog);
  // A catalog ad set (promoted product set) makes every ad under it a catalog creative: no
  // media of its own, a template headline/description, one product set.
  const catalogAd = spec.format === "catalog" || Boolean(withDefaults("adset", adsetSpec).product_set_id);
  const carousel = !catalogAd && spec.format === "carousel";
  const media = carousel || catalogAd ? null : spec.media;
  const columns = {
    name: text(spec.name) ? `${text(spec.name)} — creative` : "",
    creative_type: catalogAd ? CATALOG_CREATIVE_TYPE : carousel ? "carousel" : media?.type === "video" ? "video" : "single_image",
    product_set_id: catalogAd ? text(withDefaults("adset", adsetSpec).product_set_id) || null : null,
    page_id: text(account.page_id) || null,
    instagram_user_id: spec.use_instagram && account.instagram_user_id ? text(account.instagram_user_id) : null,
    primary_text: text(spec.primary_text) || null,
    primary_text_options: (spec.primary_text_options || []).map(text).filter(Boolean),
    headline: text(spec.headline) || (catalogAd ? DEFAULT_CATALOG_HEADLINE : null),
    description: text(spec.description) || (catalogAd ? DEFAULT_CATALOG_DESCRIPTION : null),
    destination_url: text(spec.link) || null,
    display_url: text(spec.display_link) || null,
    url_tags: text(spec.url_tags) || null,
    call_to_action: resolveCta({ adSpec: spec, objective: campaign.objective, destination, catalog }),
    ...mediaColumns(media),
    carousel_cards: carousel
      ? spec.cards.map((card) => ({
          headline: text(card.headline),
          link: text(card.link),
          image_hash: card.media?.type === "image" ? text(card.media.image_hash) : "",
          image_url: card.media?.type === "image" ? text(card.media.url) : "",
          video_id: card.media?.type === "video" ? text(card.media.video_id) : "",
          thumbnail_url: card.media?.type === "video" ? text(card.media.thumbnail_url) : "",
        }))
      : [],
    advantage_creative: Boolean(spec.advantage_creative),
  };
  const extra = { lead_form_id: text(spec.lead_form_id) || null, destination: destination || null };
  const { name: _ignored, ...content } = columns;
  extra.fingerprint = JSON.stringify({ ...content, lead_form_id: extra.lead_form_id, destination: extra.destination });
  return { columns, extra };
};

export const trackingSpecsFor = (raw, account) => {
  const spec = withDefaults("ad", raw);
  return spec.track_pixel && account.pixel_id ? [{ "action.type": ["offsite_conversion"], fb_pixel: [text(account.pixel_id)] }] : [];
};

// ------------------------------------------------------------------ columns → spec (live rows opened in the form)

const specCategory = (value) => {
  const list = Array.isArray(value) ? value : [];
  return list.find((item) => item && item !== "NONE") || "";
};

export const campaignSpecFromRow = (row) => {
  if (!isEmptySpec(row.spec)) return withDefaults("campaign", row.spec);
  const lifetime = Number(row.lifetime_budget) > 0;
  return withDefaults("campaign", {
    name: row.name || "",
    objective: row.objective || "",
    special_ad_category: specCategory(row.special_ad_categories),
    product_catalog_id: text(row.raw?.promoted_object?.product_catalog_id),
    ab_test: Boolean(row.ab_test),
    cbo: Boolean(row.campaign_budget_optimization),
    budget_type: lifetime ? "lifetime" : "daily",
    budget: lifetime ? String(Number(row.lifetime_budget)) : row.daily_budget ? String(Number(row.daily_budget)) : "",
    bid_strategy: row.bid_strategy || "LOWEST_COST_WITHOUT_CAP",
  });
};

export const adsetSpecFromRow = (row, campaignSpec) => {
  if (!isEmptySpec(row.spec)) return withDefaults("adset", row.spec);
  const objective = campaignSpec?.objective || "";
  const location = locationsFor(objective, catalog).find((item) => item.destination === row.destination_type)
    || (objective === "OUTCOME_ENGAGEMENT" && row.destination_type === "ON_POST" ? { code: "ON_AD" } : null);
  const lifetime = Number(row.lifetime_budget) > 0;
  return withDefaults("adset", {
    name: row.name || "",
    conversion_location: location?.code || "",
    optimization_goal: row.optimization_goal || "",
    billing_event: row.billing_event || "IMPRESSIONS",
    bid_strategy: row.bid_strategy || "LOWEST_COST_WITHOUT_CAP",
    bid_amount: row.bid_amount ? String(Number(row.bid_amount)) : "",
    conversion_event: row.promoted_object?.custom_event_type || "",
    product_set_id: text(row.promoted_object?.product_set_id),
    budget_type: lifetime ? "lifetime" : "daily",
    budget: lifetime ? String(Number(row.lifetime_budget)) : row.daily_budget ? String(Number(row.daily_budget)) : "",
    start_time: isoToCairoLocal(row.start_time),
    end_time: isoToCairoLocal(row.end_time),
    ...specFromTargeting(row.targeting || {}, catalog),
  });
};

const mediaFromColumns = (row) => {
  if (row?.video_id) return { type: "video", video_id: row.video_id, thumbnail_url: row.thumbnail_url || "", url: row.thumbnail_url || "" };
  if (row?.image_hash || row?.image_url) return { type: "image", image_hash: row.image_hash || "", url: row.image_url || "" };
  return null;
};

export const adSpecFromRow = (row, creative) => {
  if (!isEmptySpec(row.spec)) return withDefaults("ad", row.spec);
  const c = creative || {};
  const raw = c.raw || {};
  const story = raw.object_story_spec || {};
  const cta = story.link_data?.call_to_action || story.video_data?.call_to_action || {};
  const cards = (Array.isArray(c.carousel_cards) ? c.carousel_cards : []).map((card) => ({
    headline: card.headline || "",
    link: card.link || "",
    media: mediaFromColumns({ ...card, thumbnail_url: card.thumbnail_url || card.image_url }),
  }));
  return withDefaults("ad", {
    name: row.name || "",
    use_instagram: Boolean(c.instagram_user_id),
    format: c.creative_type === CATALOG_CREATIVE_TYPE ? "catalog" : c.creative_type === "carousel" ? "carousel" : "single",
    media: c.creative_type === "carousel" || c.creative_type === CATALOG_CREATIVE_TYPE ? null : mediaFromColumns(c),
    cards: cards.length ? cards : undefined,
    primary_text: c.primary_text || "",
    primary_text_options: Array.isArray(c.primary_text_options) ? c.primary_text_options : [],
    headline: c.headline || "",
    description: c.description || "",
    cta: c.call_to_action || "",
    link: c.destination_url || "",
    display_link: c.display_url || "",
    url_tags: c.url_tags || "",
    advantage_creative: Boolean(c.advantage_creative),
    track_pixel: Array.isArray(row.tracking_specs) && row.tracking_specs.length > 0,
    lead_form_id: text(cta.value?.lead_gen_form_id || c.spec?.lead_form_id),
  });
};

// ------------------------------------------------------------------ loading

const PUBLIC_NODE = (row) => ({
  id: row.id,
  meta_id: row.meta_id,
  is_draft: row.is_draft,
  status: row.status,
  effective_status: row.effective_status,
  last_error: row.last_error,
  name: row.name,
  updated_at: row.updated_at,
});

export const getCampaignRow = async (tenantId, campaignId) => {
  const { rows } = await db.query(`SELECT * FROM meta_ads_campaigns WHERE tenant_id = $1 AND id = $2`, [tenantId, campaignId]);
  if (!rows[0]) throw httpError(404, "Campaign not found");
  return rows[0];
};

// Full tree with specs (built from columns when a live row has none).
export const loadTree = async (tenantId, campaignId) => {
  const campaign = await getCampaignRow(tenantId, campaignId);
  const campaignSpec = campaignSpecFromRow(campaign);
  const { rows: adsetRows } = await db.query(
    `SELECT * FROM meta_ads_adsets WHERE tenant_id = $1 AND campaign_id = $2 AND COALESCE(status,'') <> 'DELETED' ORDER BY id`,
    [tenantId, campaign.id],
  );
  const adsetIds = adsetRows.map((row) => row.id);
  const { rows: adRows } = adsetIds.length
    ? await db.query(
        `SELECT * FROM meta_ads_ads WHERE tenant_id = $1 AND adset_id = ANY($2::bigint[]) AND COALESCE(status,'') <> 'DELETED' ORDER BY id`,
        [tenantId, adsetIds],
      )
    : { rows: [] };
  const creativeIds = adRows.map((row) => row.creative_id).filter(Boolean);
  const { rows: creativeRows } = creativeIds.length
    ? await db.query(`SELECT * FROM meta_ads_creatives WHERE tenant_id = $1 AND id = ANY($2::bigint[])`, [tenantId, creativeIds])
    : { rows: [] };
  const creativeById = new Map(creativeRows.map((row) => [String(row.id), row]));
  return {
    campaignRow: campaign,
    campaign: { ...PUBLIC_NODE(campaign), account_id: campaign.account_id, spec: campaignSpec },
    adsets: adsetRows.map((adset) => ({
      ...PUBLIC_NODE(adset),
      row: adset,
      spec: adsetSpecFromRow(adset, campaignSpec),
      ads: adRows
        .filter((ad) => String(ad.adset_id) === String(adset.id))
        .map((ad) => {
          const creative = ad.creative_id ? creativeById.get(String(ad.creative_id)) || null : null;
          return {
            ...PUBLIC_NODE(ad),
            row: ad,
            creative_id: ad.creative_id,
            creativeRow: creative,
            creative: creative ? { id: creative.id, meta_id: creative.meta_id, is_draft: creative.is_draft, last_error: creative.last_error } : null,
            spec: adSpecFromRow(ad, creative),
          };
        }),
    })),
  };
};

// Strip server-only fields before sending a tree to the browser.
export const publicTree = (tree) => ({
  campaign: tree.campaign,
  adsets: tree.adsets.map(({ row: _row, ...adset }) => ({
    ...adset,
    ads: adset.ads.map(({ row: _adRow, creativeRow: _creativeRow, ...ad }) => ad),
  })),
});

// Tree in the shape wizardValidation.validateTree expects (keys = row ids).
export const validationTree = (tree) => ({
  campaign: { key: String(tree.campaign.id), spec: tree.campaign.spec },
  adsets: tree.adsets.map((adset) => ({
    key: String(adset.id),
    spec: adset.spec,
    ads: adset.ads.map((ad) => ({ key: String(ad.id), spec: ad.spec })),
  })),
});

// ------------------------------------------------------------------ upserts

export const upsertCampaignDraft = async ({ tenantId, userId, accountId, id, spec }) => {
  const cols = campaignColumns(spec);
  const params = [
    tenantId, cols.name, cols.objective, json(cols.special_ad_categories), cols.campaign_budget_optimization, cols.ab_test,
    cols.daily_budget, cols.lifetime_budget, cols.bid_strategy, json(withDefaults("campaign", spec)),
  ];
  if (id) {
    const { rows } = await db.query(
      `UPDATE meta_ads_campaigns SET name = $2, objective = COALESCE($3, objective), special_ad_categories = $4::jsonb,
         campaign_budget_optimization = $5, ab_test = $6, daily_budget = $7, lifetime_budget = $8, bid_strategy = $9,
         spec = $10::jsonb, updated_at = NOW()
       WHERE tenant_id = $1 AND id = $11 RETURNING id`,
      [...params, id],
    );
    if (!rows[0]) throw httpError(404, "Campaign not found");
    return rows[0].id;
  }
  const { rows } = await db.query(
    `INSERT INTO meta_ads_campaigns (tenant_id, name, objective, special_ad_categories, campaign_budget_optimization, ab_test,
       daily_budget, lifetime_budget, bid_strategy, spec, account_id, buying_type, status, is_draft, created_by)
     VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10::jsonb,$11,'AUCTION','PAUSED',TRUE,$12) RETURNING id`,
    [...params, accountId, userId || null],
  );
  return rows[0].id;
};

export const upsertAdsetDraft = async ({ tenantId, userId, campaign, account, id, spec }) => {
  const campaignSpec = campaignSpecFromRow(campaign);
  const cols = adsetColumns(spec, campaignSpec, account);
  const params = [
    tenantId, cols.name, cols.optimization_goal, cols.billing_event, cols.destination_type, cols.bid_strategy, cols.bid_amount,
    cols.daily_budget, cols.lifetime_budget, json(cols.promoted_object), json(cols.targeting), cols.start_time, cols.end_time,
    json(withDefaults("adset", spec)),
  ];
  if (id) {
    const { rows } = await db.query(
      `UPDATE meta_ads_adsets SET name = $2, optimization_goal = $3, billing_event = $4, destination_type = $5, bid_strategy = $6,
         bid_amount = $7, daily_budget = $8, lifetime_budget = $9, promoted_object = $10::jsonb, targeting = $11::jsonb,
         start_time = $12, end_time = $13, spec = $14::jsonb, updated_at = NOW()
       WHERE tenant_id = $1 AND id = $15 AND campaign_id = $16 RETURNING id`,
      [...params, id, campaign.id],
    );
    if (!rows[0]) throw httpError(404, "Ad set not found");
    return rows[0].id;
  }
  const { rows } = await db.query(
    `INSERT INTO meta_ads_adsets (tenant_id, name, optimization_goal, billing_event, destination_type, bid_strategy, bid_amount,
       daily_budget, lifetime_budget, promoted_object, targeting, start_time, end_time, spec,
       account_id, campaign_id, campaign_meta_id, status, is_draft, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12,$13,$14::jsonb,$15,$16,$17,'PAUSED',TRUE,$18) RETURNING id`,
    [...params, campaign.account_id, campaign.id, campaign.meta_id || null, userId || null],
  );
  return rows[0].id;
};

const insertCreativeDraft = async ({ tenantId, userId, accountId, columns, extra, spec }) => {
  const { rows } = await db.query(
    `INSERT INTO meta_ads_creatives (tenant_id, account_id, name, creative_type, page_id, instagram_user_id, primary_text,
       primary_text_options, headline, description, destination_url, display_url, url_tags, call_to_action, image_hash, image_url,
       video_id, thumbnail_url, carousel_cards, advantage_creative, spec, status, is_draft, created_by, product_set_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb,$20,$21::jsonb,'ACTIVE',TRUE,$22,$23) RETURNING id`,
    [
      tenantId, accountId, columns.name, columns.creative_type, columns.page_id, columns.instagram_user_id, columns.primary_text,
      json(columns.primary_text_options), columns.headline, columns.description, columns.destination_url, columns.display_url,
      columns.url_tags, columns.call_to_action, columns.image_hash, columns.image_url, columns.video_id, columns.thumbnail_url,
      json(columns.carousel_cards), columns.advantage_creative, json({ ...extra, ad_spec: spec }), userId || null, columns.product_set_id || null,
    ],
  );
  return rows[0].id;
};

const updateCreativeDraft = async ({ tenantId, id, columns, extra, spec }) => {
  await db.query(
    `UPDATE meta_ads_creatives SET name = $3, creative_type = $4, page_id = $5, instagram_user_id = $6, primary_text = $7,
       primary_text_options = $8::jsonb, headline = $9, description = $10, destination_url = $11, display_url = $12, url_tags = $13,
       call_to_action = $14, image_hash = $15, image_url = $16, video_id = $17, thumbnail_url = $18, carousel_cards = $19::jsonb,
       advantage_creative = $20, spec = $21::jsonb, product_set_id = $22, last_error = NULL, updated_at = NOW()
     WHERE tenant_id = $1 AND id = $2`,
    [
      tenantId, id, columns.name, columns.creative_type, columns.page_id, columns.instagram_user_id, columns.primary_text,
      json(columns.primary_text_options), columns.headline, columns.description, columns.destination_url, columns.display_url,
      columns.url_tags, columns.call_to_action, columns.image_hash, columns.image_url, columns.video_id, columns.thumbnail_url,
      json(columns.carousel_cards), columns.advantage_creative, json({ ...extra, ad_spec: spec }), columns.product_set_id || null,
    ],
  );
};

const creativeFingerprint = (row) => {
  if (row?.spec?.fingerprint) return row.spec.fingerprint;
  return null;
};

// Upserts the ad draft and its creative. A live creative is immutable on Meta, so a
// changed live creative becomes a NEW draft creative linked to the ad (the publisher
// creates it and swaps it onto the ad).
export const upsertAdDraft = async ({ tenantId, userId, adset, campaign, account, id, spec }) => {
  const campaignSpec = campaignSpecFromRow(campaign);
  const adsetSpec = adsetSpecFromRow(adset, campaignSpec);
  const fullSpec = withDefaults("ad", spec);
  const { columns, extra } = creativeColumns(fullSpec, { campaignSpec, adsetSpec, account });
  const trackingSpecs = trackingSpecsFor(fullSpec, account);

  let existing = null;
  if (id) {
    const { rows } = await db.query(`SELECT * FROM meta_ads_ads WHERE tenant_id = $1 AND id = $2 AND adset_id = $3`, [tenantId, id, adset.id]);
    existing = rows[0];
    if (!existing) throw httpError(404, "Ad not found");
  }

  let creativeId = existing?.creative_id || null;
  if (creativeId) {
    const { rows } = await db.query(`SELECT * FROM meta_ads_creatives WHERE tenant_id = $1 AND id = $2`, [tenantId, creativeId]);
    const creative = rows[0];
    if (!creative) creativeId = null;
    else if (!creative.meta_id) await updateCreativeDraft({ tenantId, id: creativeId, columns, extra, spec: fullSpec });
    else if (creativeFingerprint(creative) !== extra.fingerprint) {
      // Live creative changed: compare against what it was built from; when unknown
      // (synced from Meta) only replace it if the content really differs.
      const synced = !creative.spec?.fingerprint;
      const same = synced
        && (creative.primary_text || null) === columns.primary_text
        && (creative.headline || null) === columns.headline
        && (creative.destination_url || null) === columns.destination_url
        && (creative.image_hash || null) === columns.image_hash
        && (creative.video_id || null) === columns.video_id
        && (creative.call_to_action || null) === columns.call_to_action
        && columns.creative_type !== "carousel";
      if (!same) creativeId = await insertCreativeDraft({ tenantId, userId, accountId: adset.account_id, columns, extra, spec: fullSpec });
    }
  }
  if (!creativeId) creativeId = await insertCreativeDraft({ tenantId, userId, accountId: adset.account_id, columns, extra, spec: fullSpec });

  if (existing) {
    await db.query(
      `UPDATE meta_ads_ads SET name = $3, creative_id = $4, tracking_specs = $5::jsonb, spec = $6::jsonb,
         creative_meta_id = (SELECT meta_id FROM meta_ads_creatives WHERE id = $4), updated_at = NOW()
       WHERE tenant_id = $1 AND id = $2`,
      [tenantId, existing.id, text(fullSpec.name), creativeId, json(trackingSpecs), json(fullSpec)],
    );
    return { id: existing.id, creative_id: creativeId };
  }
  const { rows } = await db.query(
    `INSERT INTO meta_ads_ads (tenant_id, account_id, adset_id, adset_meta_id, campaign_meta_id, name, creative_id, tracking_specs, spec, status, is_draft, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,'PAUSED',TRUE,$10) RETURNING id`,
    [tenantId, adset.account_id, adset.id, adset.meta_id || null, campaign.meta_id || null, text(fullSpec.name), creativeId, json(trackingSpecs), json(fullSpec), userId || null],
  );
  return { id: rows[0].id, creative_id: creativeId };
};

// Deletes a DRAFT node and its draft children (+ their draft creatives).
export const deleteDraftNode = async (tenantId, level, id) => {
  const table = { campaign: "meta_ads_campaigns", adset: "meta_ads_adsets", ad: "meta_ads_ads" }[level];
  if (!table) throw httpError(400, "Unknown level");
  const { rows } = await db.query(`SELECT id, meta_id FROM ${table} WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
  if (!rows[0]) throw httpError(404, "Not found");
  if (rows[0].meta_id) throw httpError(409, "This object is live on Meta; delete it from Meta instead.", "META_ADS_LIVE_OBJECT");

  let adFilter;
  if (level === "campaign") {
    const { rows: live } = await db.query(
      `SELECT 1 FROM meta_ads_adsets WHERE tenant_id = $1 AND campaign_id = $2 AND meta_id IS NOT NULL LIMIT 1`,
      [tenantId, id],
    );
    if (live[0]) throw httpError(409, "This campaign has live ad sets.", "META_ADS_LIVE_OBJECT");
    adFilter = [`adset_id IN (SELECT id FROM meta_ads_adsets WHERE tenant_id = $1 AND campaign_id = $2)`, [tenantId, id]];
  } else if (level === "adset") {
    const { rows: live } = await db.query(`SELECT 1 FROM meta_ads_ads WHERE tenant_id = $1 AND adset_id = $2 AND meta_id IS NOT NULL LIMIT 1`, [tenantId, id]);
    if (live[0]) throw httpError(409, "This ad set has live ads.", "META_ADS_LIVE_OBJECT");
    adFilter = [`adset_id = $2`, [tenantId, id]];
  } else {
    adFilter = [`id = $2`, [tenantId, id]];
  }
  const { rows: creatives } = await db.query(
    `SELECT creative_id FROM meta_ads_ads WHERE tenant_id = $1 AND ${adFilter[0]} AND creative_id IS NOT NULL`,
    adFilter[1],
  );
  await db.query(`DELETE FROM ${table} WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
  const creativeIds = creatives.map((row) => row.creative_id);
  if (creativeIds.length) {
    await db.query(
      `DELETE FROM meta_ads_creatives c WHERE c.tenant_id = $1 AND c.id = ANY($2::bigint[]) AND c.meta_id IS NULL
         AND NOT EXISTS (SELECT 1 FROM meta_ads_ads a WHERE a.creative_id = c.id)`,
      [tenantId, creativeIds],
    );
  }
  return { deleted: true };
};
