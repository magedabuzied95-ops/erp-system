// "منشورات المنافسين" — a competitor's organic Facebook page posts and their engagement
// (reactions / comments / shares / views), scraped through Apify's Facebook Posts Scraper.
//
// Meta's Graph API does not return another page's posts without Page Public Content Access,
// so this goes through Apify instead. It needs APIFY_TOKEN; without it the scan fails with a
// clear 409 and nothing else changes. A competitor marked is_own_page is the store's own page,
// scraped the same way so the weekly report can compare like with like.

import db from "../../../database/db.js";
import { httpError } from "../metaAdsCore.js";
import { clip, log, lower, text } from "./integrationsCommon.js";

const APIFY_BASE = "https://api.apify.com/v2";
const DEFAULT_ACTOR = "apify~facebook-posts-scraper";

const apifyToken = () => text(process.env.APIFY_TOKEN);
const apifyActor = () => text(process.env.APIFY_FACEBOOK_POSTS_ACTOR).replace("/", "~") || DEFAULT_ACTOR;
const postsPerScan = () => Math.min(100, Math.max(1, Number(process.env.APIFY_FACEBOOK_POSTS_LIMIT ?? 30) || 30));
const scanDays = () => Math.min(90, Math.max(1, Number(process.env.APIFY_FACEBOOK_POSTS_DAYS ?? 14) || 14));
// run-sync waits at most 300 s on Apify's side; stop a little earlier on ours.
const SYNC_TIMEOUT_MS = 290_000;

const FACEBOOK_HOST_RE = /(^|\.)(facebook\.com|fb\.com|fb\.me)$/i;

// The page to scrape: the saved URL, else one built from the page id / username.
export const competitorPageUrl = (competitor = {}) => {
  const saved = text(competitor.facebook_url);
  if (saved) {
    try {
      const url = new URL(/^https?:\/\//i.test(saved) ? saved : `https://${saved}`);
      if (FACEBOOK_HOST_RE.test(url.hostname)) return url.toString();
    } catch {
      // fall through to the page id
    }
    return "";
  }
  const pageId = text(competitor.page_id);
  if (/^\d+$/.test(pageId)) return `https://www.facebook.com/profile.php?id=${pageId}`;
  if (/^[\w.-]+$/.test(pageId)) return `https://www.facebook.com/${pageId}`;
  return "";
};

const count = (...values) => {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number >= 0) return Math.round(number);
  }
  return 0;
};

const mediaTypeOf = (item = {}) => {
  const media = Array.isArray(item.media) ? item.media : [];
  const kinds = media.map((entry) => lower(entry?.__typename || entry?.type));
  if (item.isVideo || kinds.some((kind) => kind.includes("video"))) return "video";
  if (media.length > 1) return "album";
  if (media.length === 1) return "photo";
  if (text(item.link)) return "link";
  return "text";
};

const thumbnailOf = (item = {}) => {
  const media = Array.isArray(item.media) ? item.media : [];
  for (const entry of media) {
    const url = text(entry?.thumbnail || entry?.photo_image?.uri || entry?.image?.uri || entry?.url);
    if (/^https?:\/\//i.test(url)) return url;
  }
  return null;
};

const postedAtOf = (item = {}) => {
  if (item.time) {
    const date = new Date(item.time);
    if (!Number.isNaN(date.getTime())) return date;
  }
  const seconds = Number(item.timestamp);
  if (Number.isFinite(seconds) && seconds > 0) return new Date(seconds < 1e12 ? seconds * 1000 : seconds);
  return null;
};

// One Apify dataset item → the columns we keep. Returns null for an item without an id
// (error rows Apify puts in the dataset for a page it could not open).
export const normalizeApifyPost = (item = {}) => {
  const postId = text(item.postId || item.id || item.feedbackId);
  if (!postId || item.error) return null;
  const likes = count(item.likes, item.reactionsCount, item.topReactionsCount);
  const comments = count(item.comments, item.commentsCount);
  const shares = count(item.shares, item.sharesCount);
  const views = count(item.viewsCount, item.videoViewCount, item.views);
  return {
    post_id: postId,
    url: text(item.url || item.topLevelUrl) || null,
    page_name: text(item.pageName || item.user?.name) || null,
    body: clip(item.text || item.message, 5000) || null,
    media_type: mediaTypeOf(item),
    thumbnail_url: thumbnailOf(item),
    posted_at: postedAtOf(item),
    likes,
    comments,
    shares,
    views,
    engagement: likes + comments + shares,
  };
};

const isoDay = (date) => date.toISOString().slice(0, 10);

export const runApifyPostsScraper = async (pageUrl, { fetchImpl = fetch, token = apifyToken(), now = new Date() } = {}) => {
  if (!token) throw httpError(409, "Set APIFY_TOKEN on the server to scan competitor posts.", "APIFY_NOT_CONFIGURED");
  const since = new Date(now.getTime() - scanDays() * 86400000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SYNC_TIMEOUT_MS);
  let response;
  try {
    response = await fetchImpl(`${APIFY_BASE}/acts/${apifyActor()}/run-sync-get-dataset-items?format=json&clean=true`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        startUrls: [{ url: pageUrl }],
        resultsLimit: postsPerScan(),
        onlyPostsNewerThan: isoDay(since),
      }),
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") throw httpError(504, "Apify took too long to scrape this page — try again later.", "APIFY_TIMEOUT");
    throw httpError(502, `Apify could not be reached: ${clip(error?.message, 200)}`, "APIFY_UNREACHABLE");
  } finally {
    clearTimeout(timer);
  }
  let body;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) {
    const message = text(body?.error?.message) || `HTTP ${response.status}`;
    const code = response.status === 401 || response.status === 403 ? "APIFY_BAD_TOKEN" : "APIFY_FAILED";
    throw httpError(response.status === 401 || response.status === 403 ? 409 : 502, `Apify: ${clip(message, 300)}`, code);
  }
  return Array.isArray(body) ? body : [];
};

export const scanCompetitorPosts = async (tenantId, competitorId, { fetchImpl } = {}) => {
  const { rows } = await db.query(`SELECT * FROM meta_ads_competitors WHERE tenant_id = $1 AND id = $2`, [tenantId, Number(competitorId) || 0]);
  const competitor = rows[0];
  if (!competitor) throw httpError(404, "Competitor not found");
  const pageUrl = competitorPageUrl(competitor);
  if (!pageUrl) throw httpError(400, "Add the competitor's Facebook page link (or page username) first.", "COMPETITOR_PAGE_URL_MISSING");
  let items;
  try {
    items = await runApifyPostsScraper(pageUrl, { fetchImpl });
  } catch (error) {
    await db.query(
      `UPDATE meta_ads_competitors SET posts_scan_error = $3, updated_at = NOW() WHERE tenant_id = $1 AND id = $2`,
      [tenantId, competitor.id, clip(error?.message, 500)],
    );
    throw error;
  }
  let saved = 0;
  let added = 0;
  for (const item of items) {
    const post = normalizeApifyPost(item);
    if (!post) continue;
    const { rows: written } = await db.query(
      `INSERT INTO meta_ads_competitor_posts (tenant_id, competitor_id, post_id, url, page_name, body, media_type, thumbnail_url, posted_at,
         likes, comments, shares, views, engagement, raw)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb)
       ON CONFLICT (tenant_id, competitor_id, post_id) DO UPDATE SET
         url = EXCLUDED.url, page_name = EXCLUDED.page_name, body = EXCLUDED.body, media_type = EXCLUDED.media_type,
         thumbnail_url = EXCLUDED.thumbnail_url, posted_at = COALESCE(EXCLUDED.posted_at, meta_ads_competitor_posts.posted_at),
         likes = EXCLUDED.likes, comments = EXCLUDED.comments, shares = EXCLUDED.shares, views = EXCLUDED.views,
         engagement = EXCLUDED.engagement, last_seen_at = NOW(), raw = EXCLUDED.raw
       RETURNING (xmax = 0) AS inserted`,
      [
        tenantId, competitor.id, post.post_id, post.url, post.page_name, post.body, post.media_type, post.thumbnail_url, post.posted_at,
        post.likes, post.comments, post.shares, post.views, post.engagement, JSON.stringify(item),
      ],
    );
    saved += 1;
    if (written[0]?.inserted) added += 1;
  }
  await db.query(
    `UPDATE meta_ads_competitors SET posts_tracked = (SELECT COUNT(*) FROM meta_ads_competitor_posts WHERE tenant_id = $1 AND competitor_id = $2),
       posts_scanned_at = NOW(), posts_scan_error = NULL, updated_at = NOW() WHERE tenant_id = $1 AND id = $2`,
    [tenantId, competitor.id],
  );
  log("competitor-posts-scan", { tenant_id: tenantId, competitor: competitor.id, items: items.length, saved, new_posts: added });
  return { posts: saved, new_posts: added };
};
