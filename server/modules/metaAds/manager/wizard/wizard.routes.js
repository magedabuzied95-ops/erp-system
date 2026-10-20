// /api/meta-ads/manager/wizard — the campaign create / edit wizard.
//
//   GET  /drafts/:campaignId          → { campaign, adsets: [{…, ads: [{…, creative}]}] }   (live campaigns too)
//   POST /drafts/campaign             { account_id, id?, spec }  → { id }
//   POST /drafts/adset                { campaign_id, id?, spec } → { id }
//   POST /drafts/ad                   { adset_id, id?, spec }    → { id, creative_id }
//   POST /drafts/delete               { level, id }              → { deleted }   (drafts only; live → 409)
//   POST /validate                    { campaign_id }            → { issues: [{ level, id, field, key }] }
//   POST /publish                     { campaign_id }            → { ok, result, tree }   (422 + issues when invalid)
//   POST /media/upload                multipart file (+ account_id) → { type:"image", image_hash, url } | { type:"video", video_id, thumbnail_url }
//   GET  /search/locations?account_id=&q=&locale=  → { results: [{ key, name, type, country_code, region }] }
//   GET  /search/interests?account_id=&q=&locale=  → { results: [{ id, name, audience_size_lower_bound, audience_size_upper_bound, path }] }
//   GET  /search/locales?account_id=&q=            → { results: [{ key, name }] }
//   GET  /geo/geocode?lat=&lng=&lang=              → { name, latitude, longitude }
//   POST /estimate/reach              { account_id, targeting, optimization_goal } → { users_lower_bound, users_upper_bound }
//   GET  /saved-audiences?account_id=               → { audiences }
//   POST /saved-audiences/save        { account_id, id?, name, targeting } → { audience }
//   GET  /saved-audiences/:id                       → { audience }
//   POST /saved-audiences/delete      { id }        → { deleted }
//   POST /preview                     { ad_id, ad_format? } → { html }

import express from "express";
import multer from "multer";

import db from "../../../../database/db.js";
import { META_ADS_GRAPH_VERSION, graphGet, graphRequest } from "../../metaAdsGraph.js";
import { getAccountContext, getAccountPublic, handle, httpError, requireToken, tenantOf, text } from "../../metaAdsCore.js";
import { metaAdsManage, metaAdsView } from "../../metaAdsGuards.js";
import { LOCATION_SEARCH_TYPES } from "../../../../../src/modules/metaAds/manager/wizard/wizardModel.js";
import { validateTree } from "../../../../../src/modules/metaAds/manager/wizard/wizardValidation.js";
import { publishCampaignTree } from "./metaAdsPublisher.js";
import {
  catalog,
  deleteDraftNode,
  getCampaignRow,
  loadTree,
  publicTree,
  upsertAdDraft,
  upsertAdsetDraft,
  upsertCampaignDraft,
  validationTree,
} from "./wizardDrafts.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024, files: 1 } });

const userIdOf = (req) => Number(req.user?.id) || null;
const idOf = (value) => {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
};
const specOf = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});
const metaLocale = (value) => (String(value || "").startsWith("ar") ? "ar_AR" : String(value || "") ? "en_US" : undefined);

const getAdsetRow = async (tenantId, id) => {
  const { rows } = await db.query(`SELECT * FROM meta_ads_adsets WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
  if (!rows[0]) throw httpError(404, "Ad set not found");
  return rows[0];
};

// Re-derive children columns after a parent change that affects them (objective,
// CBO, conversion location…): the children's columns are computed from the parent.
const resyncAds = async ({ tenantId, userId, adset, campaign, account }) => {
  const { rows } = await db.query(
    `SELECT id, spec FROM meta_ads_ads WHERE tenant_id = $1 AND adset_id = $2 AND spec <> '{}'::jsonb AND COALESCE(status,'') <> 'DELETED'`,
    [tenantId, adset.id],
  );
  for (const ad of rows) await upsertAdDraft({ tenantId, userId, adset, campaign, account, id: ad.id, spec: ad.spec });
};

const resyncAdsets = async ({ tenantId, userId, campaign, account }) => {
  const { rows } = await db.query(
    `SELECT id, spec FROM meta_ads_adsets WHERE tenant_id = $1 AND campaign_id = $2 AND spec <> '{}'::jsonb AND COALESCE(status,'') <> 'DELETED'`,
    [tenantId, campaign.id],
  );
  for (const adset of rows) {
    await upsertAdsetDraft({ tenantId, userId, campaign, account, id: adset.id, spec: adset.spec });
    await resyncAds({ tenantId, userId, adset: await getAdsetRow(tenantId, adset.id), campaign, account });
  }
};

const sameKeys = (a = {}, b = {}, keys) => keys.every((key) => JSON.stringify(a?.[key] ?? null) === JSON.stringify(b?.[key] ?? null));

// ------------------------------------------------------------------ drafts

router.get(
  "/drafts/:campaignId",
  metaAdsView,
  handle(async (req) => {
    const tenantId = tenantOf(req);
    const id = idOf(req.params.campaignId);
    if (!id) throw httpError(400, "Invalid campaign id");
    return publicTree(await loadTree(tenantId, id));
  }),
);

router.post(
  "/drafts/campaign",
  metaAdsManage,
  handle(async (req) => {
    const tenantId = tenantOf(req);
    const userId = userIdOf(req);
    const spec = specOf(req.body?.spec);
    const id = idOf(req.body?.id);
    let accountId = idOf(req.body?.account_id);
    let before = null;
    if (id) {
      before = await getCampaignRow(tenantId, id);
      accountId = before.account_id;
    }
    if (!accountId) throw httpError(400, "account_id is required");
    const account = await getAccountPublic(tenantId, accountId);
    const savedId = await upsertCampaignDraft({ tenantId, userId, accountId: account.id, id, spec });
    if (before && !sameKeys(before.spec, spec, ["objective", "cbo", "budget_type", "bid_strategy"])) {
      await resyncAdsets({ tenantId, userId, campaign: await getCampaignRow(tenantId, savedId), account });
    }
    return { id: savedId };
  }),
);

router.post(
  "/drafts/adset",
  metaAdsManage,
  handle(async (req) => {
    const tenantId = tenantOf(req);
    const userId = userIdOf(req);
    const campaignId = idOf(req.body?.campaign_id);
    if (!campaignId) throw httpError(400, "campaign_id is required");
    const campaign = await getCampaignRow(tenantId, campaignId);
    const account = await getAccountPublic(tenantId, campaign.account_id);
    const id = idOf(req.body?.id);
    const spec = specOf(req.body?.spec);
    const before = id ? await getAdsetRow(tenantId, id) : null;
    const savedId = await upsertAdsetDraft({ tenantId, userId, campaign, account, id, spec });
    if (before && !sameKeys(before.spec, spec, ["conversion_location", "optimization_goal"])) {
      await resyncAds({ tenantId, userId, adset: await getAdsetRow(tenantId, savedId), campaign, account });
    }
    return { id: savedId };
  }),
);

router.post(
  "/drafts/ad",
  metaAdsManage,
  handle(async (req) => {
    const tenantId = tenantOf(req);
    const adsetId = idOf(req.body?.adset_id);
    if (!adsetId) throw httpError(400, "adset_id is required");
    const adset = await getAdsetRow(tenantId, adsetId);
    const campaign = await getCampaignRow(tenantId, adset.campaign_id);
    const account = await getAccountPublic(tenantId, campaign.account_id);
    return upsertAdDraft({ tenantId, userId: userIdOf(req), adset, campaign, account, id: idOf(req.body?.id), spec: specOf(req.body?.spec) });
  }),
);

router.post(
  "/drafts/delete",
  metaAdsManage,
  handle(async (req) => {
    const id = idOf(req.body?.id);
    if (!id) throw httpError(400, "id is required");
    return deleteDraftNode(tenantOf(req), text(req.body?.level), id);
  }),
);

// ------------------------------------------------------------------ validate / publish

router.post(
  "/validate",
  metaAdsView,
  handle(async (req) => {
    const tenantId = tenantOf(req);
    const id = idOf(req.body?.campaign_id);
    if (!id) throw httpError(400, "campaign_id is required");
    const tree = await loadTree(tenantId, id);
    const account = await getAccountPublic(tenantId, tree.campaignRow.account_id);
    return { issues: validateTree(validationTree(tree), { account, catalog }) };
  }),
);

router.post(
  "/publish",
  metaAdsManage,
  handle(async (req, res) => {
    const tenantId = tenantOf(req);
    const id = idOf(req.body?.campaign_id);
    if (!id) throw httpError(400, "campaign_id is required");
    const campaign = await getCampaignRow(tenantId, id);
    const ctx = await getAccountContext(tenantId, campaign.account_id);
    try {
      const result = await publishCampaignTree(ctx, id, { userId: userIdOf(req) });
      return { ok: result.errors.length === 0, result, tree: publicTree(await loadTree(tenantId, id)) };
    } catch (error) {
      if (Array.isArray(error?.issues)) {
        res.status(422).json({ success: false, code: error.code, message: error.message, issues: error.issues });
        return undefined;
      }
      throw error;
    }
  }),
);

// ------------------------------------------------------------------ media

router.post(
  "/media/upload",
  metaAdsManage,
  (req, res, next) => {
    upload.single("file")(req, res, (error) => {
      if (!error) return next();
      const status = error.code === "LIMIT_FILE_SIZE" ? 413 : 400;
      return res.status(status).json({ success: false, code: error.code, message: error.message });
    });
  },
  handle(async (req) => {
    const file = req.file;
    if (!file?.buffer?.length) throw httpError(400, "file is required");
    const ctx = await getAccountContext(tenantOf(req), idOf(req.body?.account_id));
    const token = requireToken(ctx);
    const mime = String(file.mimetype || "");
    const name = text(file.originalname) || (mime.startsWith("video/") ? "video.mp4" : "image.jpg");

    if (mime.startsWith("image/")) {
      const form = new FormData();
      form.append("filename", new Blob([file.buffer], { type: mime }), name);
      const res = await graphRequest({ method: "POST", path: `/${ctx.actId}/adimages`, token, form, timeoutMs: 120000 });
      const image = Object.values(res?.images || {})[0] || {};
      if (!image.hash) throw httpError(502, "Meta did not return an image hash");
      return { type: "image", image_hash: image.hash, url: image.url || image.permalink_url || "" };
    }
    if (mime.startsWith("video/")) {
      const form = new FormData();
      form.append("source", new Blob([file.buffer], { type: mime }), name);
      form.append("name", name);
      const res = await graphRequest({
        method: "POST",
        path: `https://graph-video.facebook.com/${META_ADS_GRAPH_VERSION}/${ctx.actId}/advideos`,
        token,
        form,
        timeoutMs: 600000,
      });
      const videoId = text(res?.id);
      if (!videoId) throw httpError(502, "Meta did not return a video id");
      let thumbnail = "";
      try {
        const info = await graphGet(`/${videoId}`, token, { fields: "picture,thumbnails{uri,is_preferred}" });
        const thumbs = info?.thumbnails?.data || [];
        thumbnail = text((thumbs.find((row) => row.is_preferred) || thumbs[0])?.uri || info?.picture);
      } catch {
        // Meta is still processing the video; the publisher fetches the thumbnail later.
      }
      return { type: "video", video_id: videoId, thumbnail_url: thumbnail };
    }
    throw httpError(415, "Only images and videos can be uploaded");
  }),
);

// ------------------------------------------------------------------ search

router.get(
  "/search/locations",
  metaAdsView,
  handle(async (req) => {
    const q = text(req.query.q);
    if (q.length < 2) return { results: [] };
    const ctx = await getAccountContext(tenantOf(req), idOf(req.query.account_id));
    const res = await graphGet("/search", requireToken(ctx), {
      type: "adgeolocation",
      location_types: LOCATION_SEARCH_TYPES,
      q,
      limit: 12,
      locale: metaLocale(req.query.locale),
    });
    return {
      results: (res?.data || []).map((row) => ({
        key: text(row.key),
        name: text(row.name),
        type: text(row.type),
        country_code: text(row.country_code),
        country_name: text(row.country_name),
        region: text(row.region),
      })),
    };
  }),
);

router.get(
  "/search/interests",
  metaAdsView,
  handle(async (req) => {
    const q = text(req.query.q);
    if (q.length < 2) return { results: [] };
    const ctx = await getAccountContext(tenantOf(req), idOf(req.query.account_id));
    const res = await graphGet("/search", requireToken(ctx), { type: "adinterest", q, limit: 15, locale: metaLocale(req.query.locale) });
    return {
      results: (res?.data || []).map((row) => ({
        id: text(row.id),
        name: text(row.name),
        audience_size_lower_bound: row.audience_size_lower_bound ?? null,
        audience_size_upper_bound: row.audience_size_upper_bound ?? null,
        path: Array.isArray(row.path) ? row.path : [],
      })),
    };
  }),
);

router.get(
  "/search/locales",
  metaAdsView,
  handle(async (req) => {
    const q = text(req.query.q);
    if (!q) return { results: [] };
    const ctx = await getAccountContext(tenantOf(req), idOf(req.query.account_id));
    const res = await graphGet("/search", requireToken(ctx), { type: "adlocale", q, limit: 15 });
    return { results: (res?.data || []).map((row) => ({ key: String(row.key), name: text(row.name) })) };
  }),
);

router.get(
  "/geo/geocode",
  metaAdsView,
  handle(async (req) => {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw httpError(400, "Invalid coordinates");
    const fallback = { name: `${lat.toFixed(4)}, ${lng.toFixed(4)}`, latitude: lat, longitude: lng };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const url = new URL("https://nominatim.openstreetmap.org/reverse");
      url.search = new URLSearchParams({ format: "json", lat: String(lat), lon: String(lng), zoom: "14", "accept-language": String(req.query.lang || "ar") }).toString();
      const response = await fetch(url, { headers: { "User-Agent": "M1-ERP-MetaAds/1.0 (ads location pin)" }, signal: controller.signal });
      if (!response.ok) return fallback;
      const data = await response.json();
      const a = data?.address || {};
      const name = [a.suburb || a.neighbourhood || a.village || a.town, a.city || a.state, a.country].filter(Boolean).join("، ") || text(data?.display_name);
      return { ...fallback, name: name || fallback.name, country_code: text(a.country_code).toUpperCase() };
    } catch {
      return fallback;
    } finally {
      clearTimeout(timer);
    }
  }),
);

router.post(
  "/estimate/reach",
  metaAdsView,
  handle(async (req) => {
    const empty = { users_lower_bound: null, users_upper_bound: null };
    try {
      const ctx = await getAccountContext(tenantOf(req), idOf(req.body?.account_id));
      if (!ctx.token) return empty;
      const targeting = req.body?.targeting;
      if (!targeting || typeof targeting !== "object") return empty;
      const res = await graphGet(`/${ctx.actId}/delivery_estimate`, ctx.token, {
        targeting_spec: targeting,
        optimization_goal: text(req.body?.optimization_goal) || "REACH",
      });
      const row = res?.data?.[0] || {};
      const lower = row.estimate_mau_lower_bound ?? row.users_lower_bound ?? null;
      const upper = row.estimate_mau_upper_bound ?? row.users_upper_bound ?? null;
      return { users_lower_bound: lower === null ? null : Number(lower), users_upper_bound: upper === null ? null : Number(upper) };
    } catch {
      return empty;
    }
  }),
);

// ------------------------------------------------------------------ saved audiences

const audienceRow = (row) => ({ id: row.id, account_id: row.account_id, name: row.name, targeting: row.targeting || {}, updated_at: row.updated_at });

router.get(
  "/saved-audiences",
  metaAdsView,
  handle(async (req) => {
    const tenantId = tenantOf(req);
    const accountId = idOf(req.query.account_id);
    const { rows } = await db.query(
      `SELECT * FROM meta_ads_saved_audiences WHERE tenant_id = $1 AND ($2::bigint IS NULL OR account_id = $2::bigint) ORDER BY name, id`,
      [tenantId, accountId],
    );
    return { audiences: rows.map(audienceRow) };
  }),
);

router.post(
  "/saved-audiences/save",
  metaAdsManage,
  handle(async (req) => {
    const tenantId = tenantOf(req);
    const name = text(req.body?.name).slice(0, 200);
    if (!name) throw httpError(400, "name is required");
    const targeting = specOf(req.body?.targeting);
    const id = idOf(req.body?.id);
    if (id) {
      const { rows } = await db.query(
        `UPDATE meta_ads_saved_audiences SET name = $3, targeting = $4::jsonb, updated_at = NOW() WHERE tenant_id = $1 AND id = $2 RETURNING *`,
        [tenantId, id, name, JSON.stringify(targeting)],
      );
      if (!rows[0]) throw httpError(404, "Audience not found");
      return { audience: audienceRow(rows[0]) };
    }
    const account = await getAccountPublic(tenantId, idOf(req.body?.account_id));
    const { rows } = await db.query(
      `INSERT INTO meta_ads_saved_audiences (tenant_id, account_id, name, targeting, created_by) VALUES ($1,$2,$3,$4::jsonb,$5) RETURNING *`,
      [tenantId, account.id, name, JSON.stringify(targeting), userIdOf(req)],
    );
    return { audience: audienceRow(rows[0]) };
  }),
);

router.get(
  "/saved-audiences/:id",
  metaAdsView,
  handle(async (req) => {
    const { rows } = await db.query(`SELECT * FROM meta_ads_saved_audiences WHERE tenant_id = $1 AND id = $2`, [tenantOf(req), idOf(req.params.id)]);
    if (!rows[0]) throw httpError(404, "Audience not found");
    return { audience: audienceRow(rows[0]) };
  }),
);

router.post(
  "/saved-audiences/delete",
  metaAdsManage,
  handle(async (req) => {
    const { rowCount } = await db.query(`DELETE FROM meta_ads_saved_audiences WHERE tenant_id = $1 AND id = $2`, [tenantOf(req), idOf(req.body?.id)]);
    if (!rowCount) throw httpError(404, "Audience not found");
    return { deleted: true };
  }),
);

// ------------------------------------------------------------------ preview (published ads)

const PREVIEW_FORMATS = ["DESKTOP_FEED_STANDARD", "MOBILE_FEED_STANDARD", "INSTAGRAM_STANDARD", "INSTAGRAM_STORY"];

router.post(
  "/preview",
  metaAdsView,
  handle(async (req) => {
    const tenantId = tenantOf(req);
    const { rows } = await db.query(`SELECT id, account_id, meta_id FROM meta_ads_ads WHERE tenant_id = $1 AND id = $2`, [tenantId, idOf(req.body?.ad_id)]);
    const ad = rows[0];
    if (!ad) throw httpError(404, "Ad not found");
    if (!ad.meta_id) return { html: "" };
    const format = PREVIEW_FORMATS.includes(req.body?.ad_format) ? req.body.ad_format : "MOBILE_FEED_STANDARD";
    const ctx = await getAccountContext(tenantId, ad.account_id);
    const res = await graphGet(`/${ad.meta_id}/previews`, requireToken(ctx), { ad_format: format });
    return { html: text(res?.data?.[0]?.body) };
  }),
);

export default router;
