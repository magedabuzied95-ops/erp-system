// "المنافسون" — competitor ads from Meta's Ad Library API (GET /ads_archive) plus a
// short AI read of each new ad (angle / offer / hook / summary, in Arabic).
//
// Meta only returns ads in the Library API for political/issue ads everywhere, and for
// all other ads only when they were delivered in the EU/UK. For an Egyptian competitor
// an empty result is normal: we record the scan time and keep the count, no error.

import db from "../../../database/db.js";
import { graphGetAll } from "../metaAdsGraph.js";
import { httpError } from "../metaAdsCore.js";
import { anyTenantToken, clip, log, text, warn } from "./integrationsCommon.js";

const AD_FIELDS = [
  "id", "page_name", "ad_creative_bodies", "ad_creative_link_titles", "ad_creative_link_captions", "ad_creative_link_descriptions",
  "ad_delivery_start_time", "ad_delivery_stop_time", "ad_snapshot_url", "publisher_platforms", "languages",
].join(",");

const analysesPerScan = () => Math.max(0, Number(process.env.META_ADS_COMPETITOR_AI_PER_SCAN ?? 5));

const countriesFor = (competitor) => {
  const raw = text(competitor.country).toUpperCase();
  if (!raw || raw === "ALL") return [text(process.env.META_ADS_LIBRARY_COUNTRY).toUpperCase() || "EG"];
  return raw.split(/[,\s]+/).filter((code) => /^[A-Z]{2}$/.test(code));
};

// ad_snapshot_url embeds the access token used for the call; it must never reach a browser.
const stripToken = (url) => {
  const value = text(url);
  if (!value) return null;
  try {
    const parsed = new URL(value);
    parsed.searchParams.delete("access_token");
    return parsed.toString();
  } catch {
    return null;
  }
};

const dayDiff = (from, to) => Math.max(0, Math.round((to.getTime() - from.getTime()) / 86400000));
const first = (list) => (Array.isArray(list) ? text(list.find((item) => text(item))) : "");

export const scanCompetitor = async (tenantId, competitorId) => {
  const { rows } = await db.query(`SELECT * FROM meta_ads_competitors WHERE tenant_id = $1 AND id = $2`, [tenantId, Number(competitorId) || 0]);
  const competitor = rows[0];
  if (!competitor) throw httpError(404, "Competitor not found");
  const auth = await anyTenantToken(tenantId);
  if (!auth) throw httpError(409, "Connect a Meta ad account first — the Ad Library needs a Facebook token.", "META_ADS_NOT_CONNECTED");
  const params = {
    ad_reached_countries: countriesFor(competitor),
    ad_active_status: "ALL",
    ad_type: "ALL",
    fields: AD_FIELDS,
  };
  const pageId = text(competitor.page_id).replace(/\D/g, "");
  if (pageId) params.search_page_ids = [pageId];
  else params.search_terms = text(competitor.name);
  let ads;
  try {
    ads = await graphGetAll("/ads_archive", auth.token, params, { limit: 300 });
  } catch (error) {
    await db.query(
      `UPDATE meta_ads_competitors SET last_scan_error = $3, updated_at = NOW() WHERE tenant_id = $1 AND id = $2`,
      [tenantId, competitor.id, clip(error?.userMessage || error?.message, 500)],
    );
    throw error;
  }
  const now = new Date();
  const newIds = [];
  for (const ad of ads) {
    const archiveId = text(ad.id);
    if (!archiveId) continue;
    const start = ad.ad_delivery_start_time ? new Date(ad.ad_delivery_start_time) : null;
    const stop = ad.ad_delivery_stop_time ? new Date(ad.ad_delivery_stop_time) : null;
    const active = !stop || stop.getTime() >= now.getTime() - 86400000;
    const body = first(ad.ad_creative_bodies);
    const headline = first(ad.ad_creative_link_titles) || body.split("\n")[0].slice(0, 200);
    const { rows: saved } = await db.query(
      `INSERT INTO meta_ads_competitor_ads (tenant_id, competitor_id, archive_id, page_name, headline, body, link_title, platforms, snapshot_url,
         is_active, started_at, ended_at, days_running, first_seen_at, last_seen_at, raw)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,NOW(),CASE WHEN $10 THEN NOW() ELSE NULL END,$14::jsonb)
       ON CONFLICT (tenant_id, archive_id) DO UPDATE SET
         page_name = EXCLUDED.page_name, headline = EXCLUDED.headline, body = EXCLUDED.body, link_title = EXCLUDED.link_title,
         platforms = EXCLUDED.platforms, snapshot_url = EXCLUDED.snapshot_url, is_active = EXCLUDED.is_active,
         started_at = EXCLUDED.started_at, ended_at = EXCLUDED.ended_at, days_running = EXCLUDED.days_running,
         last_seen_at = CASE WHEN EXCLUDED.is_active THEN NOW() ELSE meta_ads_competitor_ads.last_seen_at END, raw = EXCLUDED.raw
       RETURNING id, (xmax = 0) AS inserted`,
      [
        tenantId, competitor.id, archiveId, text(ad.page_name) || null, clip(headline, 500) || null, clip(body, 5000) || null,
        clip(first(ad.ad_creative_link_titles) || first(ad.ad_creative_link_captions), 500) || null,
        JSON.stringify(ad.publisher_platforms || []), stripToken(ad.ad_snapshot_url), active,
        start, stop, start ? dayDiff(start, stop && stop < now ? stop : now) : 0,
        JSON.stringify({ ...ad, ad_snapshot_url: stripToken(ad.ad_snapshot_url) }),
      ],
    );
    if (saved[0]?.inserted) newIds.push(saved[0].id);
  }
  if (ads.length) {
    await db.query(
      `UPDATE meta_ads_competitors SET ads_tracked = (SELECT COUNT(*) FROM meta_ads_competitor_ads WHERE tenant_id = $1 AND competitor_id = $2),
         last_scanned_at = NOW(), last_scan_error = NULL, updated_at = NOW() WHERE tenant_id = $1 AND id = $2`,
      [tenantId, competitor.id],
    );
  } else {
    await db.query(`UPDATE meta_ads_competitors SET last_scanned_at = NOW(), last_scan_error = NULL, updated_at = NOW() WHERE tenant_id = $1 AND id = $2`, [tenantId, competitor.id]);
  }
  let analysed = 0;
  for (const id of newIds.slice(0, analysesPerScan())) {
    try {
      await analyzeCompetitorAd(tenantId, id);
      analysed += 1;
    } catch (error) {
      warn("competitor-ai", error, { tenant_id: tenantId, ad: id });
      if (error?.code === "NO_PROVIDER") break;
    }
  }
  log("competitor-scan", { tenant_id: tenantId, competitor: competitor.id, ads: ads.length, new_ads: newIds.length, analysed });
  return { ads: ads.length, new_ads: newIds.length, analysed };
};

const ANALYSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["angle", "offer", "hook", "summary"],
  properties: {
    angle: { type: "string" },
    offer: { type: "string" },
    hook: { type: "string" },
    summary: { type: "string" },
  },
};

export const analyzeCompetitorAd = async (tenantId, adId) => {
  const { rows } = await db.query(`SELECT * FROM meta_ads_competitor_ads WHERE tenant_id = $1 AND id = $2`, [tenantId, Number(adId) || 0]);
  const ad = rows[0];
  if (!ad) throw httpError(404, "Competitor ad not found");
  const { resolveTextProvider, requestStructuredJson } = await import("../../../services/openaiProductDescriptionService.js");
  const provider = resolveTextProvider();
  if (!provider || provider.kind === "none") throw Object.assign(httpError(503, "No AI text provider is configured on the server."), { code: "NO_PROVIDER" });
  const content = [
    ad.page_name ? `Page: ${ad.page_name}` : "",
    ad.headline ? `Headline: ${clip(ad.headline, 200)}` : "",
    ad.body ? `Text: ${clip(ad.body, 700)}` : "",
    ad.link_title ? `Link: ${clip(ad.link_title, 150)}` : "",
  ].filter(Boolean).join("\n");
  if (!content) throw httpError(422, "This ad has no text to analyse.");
  // Short on purpose: text + vision share one daily token budget.
  const result = await requestStructuredJson({
    provider,
    label: "meta-ads-competitor",
    instructions: "أنت محلل إعلانات. اقرأ إعلان المنافس وأجب بالعربية باختصار شديد بصيغة JSON فقط: angle (زاوية الإعلان في كلمات), offer (العرض أو الخصم، أو \"لا يوجد\"), hook (الجملة الجاذبة كما وردت), summary (جملة أو جملتان).",
    prompt: content,
    schemaName: "competitor_ad",
    schema: ANALYSIS_SCHEMA,
    verbosity: "low",
    maxTokens: 260,
  });
  const values = {
    ai_angle: clip(result?.angle, 300) || null,
    ai_offer: clip(result?.offer, 300) || null,
    ai_hook: clip(result?.hook, 300) || null,
    ai_summary: clip(result?.summary, 1000) || null,
  };
  await db.query(
    `UPDATE meta_ads_competitor_ads SET ai_angle = $3, ai_offer = $4, ai_hook = $5, ai_summary = $6 WHERE tenant_id = $1 AND id = $2`,
    [tenantId, ad.id, values.ai_angle, values.ai_offer, values.ai_hook, values.ai_summary],
  );
  return values;
};
