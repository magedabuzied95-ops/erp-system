import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import db from "../database/db.js";
import { INBOX_ATTACHMENT_DIR, INBOX_ATTACHMENT_URL_PREFIX } from "../config/inboxAttachmentUpload.js";
import { fetchMetaShareablePosts } from "./metaIntegrationService.js";
import { fetchTikTokBusinessVideos } from "./tiktokBusinessApiClient.js";
import { getValidTikTokBusinessAccessToken } from "./tiktokBusinessOAuthService.js";

/*
 * The posts the inbox's "Share post" sheet offers: our own published posts on
 * Instagram, Facebook and TikTok.
 *
 * The sheet has to open the way TikTok's does — instantly — so it is never fed
 * straight from Graph or TikTok. Each source's list is kept in one row per
 * tenant and handed back at once; when it is older than SHARE_POSTS_FRESH_MS the
 * same request also starts a refresh in the background, so the next open is
 * current and this one did not wait. Only an empty cache waits on the platform.
 *
 * Thumbnails stay as the platform's CDN URLs here (they live for days, the list
 * for minutes). A post that is actually SENT gets its cover copied to our own
 * disk, because the bubble in the thread has to outlive the CDN link.
 */

const text = (value = "") => String(value ?? "").trim();
const asArray = (value) => (Array.isArray(value) ? value : []);

export const SHARE_POST_SOURCES = Object.freeze(["instagram", "facebook", "tiktok"]);
const SHARE_POSTS_FRESH_MS = Math.max(60_000, Number(process.env.INBOX_SHARE_POSTS_FRESH_MS || 10 * 60_000));

export const normalizeSharePostSource = (value = "") => {
  const source = text(value).toLowerCase();
  if (source === "ig") return "instagram";
  if (source === "fb" || source === "messenger" || source === "facebook_messenger") return "facebook";
  return SHARE_POST_SOURCES.includes(source) ? source : "";
};

// The source a conversation's own platform shares best. WhatsApp and Telegram
// have no posts of their own; Instagram's reels are the shop's main shelf.
export const defaultSharePostSource = (channel = "") => {
  const value = text(channel).toLowerCase();
  if (value.includes("tiktok")) return "tiktok";
  if (value.includes("messenger") || value === "facebook") return "facebook";
  return "instagram";
};

let schemaPromise = null;
const ensureSchema = () => {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await db.query(`
        CREATE TABLE IF NOT EXISTS inbox_share_posts_cache (
          tenant_id INTEGER NOT NULL,
          source TEXT NOT NULL,
          posts JSONB NOT NULL DEFAULT '[]'::jsonb,
          error TEXT NOT NULL DEFAULT '',
          fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (tenant_id, source)
        )
      `);
      await db.query(`
        CREATE TABLE IF NOT EXISTS inbox_share_post_favorites (
          tenant_id INTEGER NOT NULL,
          source TEXT NOT NULL,
          post_id TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (tenant_id, source, post_id)
        )
      `);
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
};

const tiktokShareablePost = (video = {}) => ({
  id: text(video.item_id),
  source: "tiktok",
  kind: "reel",
  thumbnail_url: text(video.thumbnail_url),
  video_url: "",
  permalink: text(video.share_url),
  caption: text(video.caption).slice(0, 300),
  likes: Number(video.likes || 0) || 0,
  comments: Number(video.comments || 0) || 0,
  views: 0,
  created_at: Number(video.create_time) ? new Date(Number(video.create_time) * 1000).toISOString() : "",
});

const fetchTikTokShareablePosts = async ({ tenantId }) => {
  const { accessToken, businessId } = await getValidTikTokBusinessAccessToken({ tenantId });
  const data = await fetchTikTokBusinessVideos({ accessToken, businessId, maxCount: 20 });
  return asArray(data?.videos).map(tiktokShareablePost).filter((post) => post.id && post.thumbnail_url);
};

const fetchFromPlatform = ({ tenantId, source, deps = {} }) => {
  if (source === "tiktok") return (deps.fetchTikTok || fetchTikTokShareablePosts)({ tenantId });
  return (deps.fetchMeta || fetchMetaShareablePosts)({ tenantId, source });
};

// One refresh per tenant+source at a time: ten operators opening the sheet
// together must not become ten Graph calls on the shared app budget.
const inflight = new Map();

export const refreshSharePosts = ({ tenantId, source, deps = {} }) => {
  const key = `${tenantId}:${source}`;
  if (inflight.has(key)) return inflight.get(key);
  const run = (async () => {
    await ensureSchema();
    try {
      const posts = await fetchFromPlatform({ tenantId, source, deps });
      await db.query(
        `INSERT INTO inbox_share_posts_cache (tenant_id, source, posts, error, fetched_at)
         VALUES ($1, $2, $3::jsonb, '', NOW())
         ON CONFLICT (tenant_id, source) DO UPDATE SET posts = EXCLUDED.posts, error = '', fetched_at = NOW()`,
        [tenantId, source, JSON.stringify(posts)]
      );
      return { posts, error: "", fetched_at: new Date().toISOString() };
    } catch (error) {
      const message = text(error?.message || "The platform did not return the posts").slice(0, 300);
      // A failed refresh keeps the last good list and only records why.
      await db.query(
        `INSERT INTO inbox_share_posts_cache (tenant_id, source, error, fetched_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (tenant_id, source) DO UPDATE SET error = EXCLUDED.error, fetched_at = NOW()`,
        [tenantId, source, message]
      ).catch(() => {});
      throw Object.assign(error instanceof Error ? error : new Error(message), { status: error?.status || 502 });
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, run);
  return run;
};

const loadFavorites = async ({ tenantId, source }) => {
  const { rows } = await db.query(
    "SELECT post_id FROM inbox_share_post_favorites WHERE tenant_id = $1 AND source = $2",
    [tenantId, source]
  );
  return new Set(rows.map((row) => text(row.post_id)));
};

const withFavorites = (posts, favorites) => asArray(posts).map((post) => ({ ...post, favorite: favorites.has(text(post.id)) }));

export const listSharePosts = async ({ tenantId, source, refresh = false, deps = {} } = {}) => {
  const safeSource = normalizeSharePostSource(source);
  if (!safeSource) throw Object.assign(new Error("Unknown post source"), { status: 400, code: "SHARE_POST_SOURCE_INVALID" });
  await ensureSchema();
  const [cacheResult, favorites] = await Promise.all([
    db.query("SELECT posts, error, fetched_at FROM inbox_share_posts_cache WHERE tenant_id = $1 AND source = $2", [tenantId, safeSource]),
    loadFavorites({ tenantId, source: safeSource }),
  ]);
  const cached = cacheResult.rows[0];
  const cachedPosts = asArray(cached?.posts);
  const age = cached?.fetched_at ? Date.now() - new Date(cached.fetched_at).getTime() : Infinity;

  if (!cachedPosts.length || refresh) {
    try {
      const fresh = await refreshSharePosts({ tenantId, source: safeSource, deps });
      return { source: safeSource, posts: withFavorites(fresh.posts, favorites), fetched_at: fresh.fetched_at, stale: false, error: "" };
    } catch (error) {
      if (!cachedPosts.length) {
        return { source: safeSource, posts: [], fetched_at: cached?.fetched_at || null, stale: true, error: text(error?.message) };
      }
    }
  } else if (age > SHARE_POSTS_FRESH_MS) {
    refreshSharePosts({ tenantId, source: safeSource, deps }).catch(() => {});
  }
  return {
    source: safeSource,
    posts: withFavorites(cachedPosts, favorites),
    fetched_at: cached?.fetched_at || null,
    stale: age > SHARE_POSTS_FRESH_MS,
    error: text(cached?.error),
  };
};

export const setSharePostFavorite = async ({ tenantId, source, postId, favorite = true } = {}) => {
  const safeSource = normalizeSharePostSource(source);
  const safeId = text(postId);
  if (!safeSource || !safeId) throw Object.assign(new Error("source and post id are required"), { status: 400 });
  await ensureSchema();
  if (favorite) {
    await db.query(
      `INSERT INTO inbox_share_post_favorites (tenant_id, source, post_id) VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [tenantId, safeSource, safeId]
    );
  } else {
    await db.query("DELETE FROM inbox_share_post_favorites WHERE tenant_id = $1 AND source = $2 AND post_id = $3", [tenantId, safeSource, safeId]);
  }
  return { source: safeSource, post_id: safeId, favorite: Boolean(favorite) };
};

/**
 * The post as the server knows it. The client only names a post; its URLs come
 * from our own cache, never from the request, so a send cannot be pointed at an
 * arbitrary file.
 */
export const findSharePost = async ({ tenantId, source, postId, deps = {} } = {}) => {
  const safeSource = normalizeSharePostSource(source);
  const safeId = text(postId);
  if (!safeSource || !safeId) return null;
  await ensureSchema();
  const { rows } = await db.query("SELECT posts FROM inbox_share_posts_cache WHERE tenant_id = $1 AND source = $2", [tenantId, safeSource]);
  const hit = asArray(rows[0]?.posts).find((post) => text(post.id) === safeId);
  if (hit) return hit;
  const fresh = await refreshSharePosts({ tenantId, source: safeSource, deps }).catch(() => null);
  return asArray(fresh?.posts).find((post) => text(post.id) === safeId) || null;
};

/**
 * The post's cover, copied under /uploads/inbox so the sent bubble keeps its
 * picture after the CDN link expires. Returns "" when the copy fails; the
 * caller then falls back to the CDN URL.
 */
export const persistSharePostCover = async (post = {}, { fetchImpl = fetch } = {}) => {
  const source = text(post.thumbnail_url);
  if (!/^https?:\/\//i.test(source)) return "";
  try {
    const response = await fetchImpl(source);
    if (!response.ok) return "";
    const mime = text(response.headers?.get?.("content-type")).split(";")[0].toLowerCase();
    if (mime && !mime.startsWith("image/")) return "";
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length || bytes.length > 4 * 1024 * 1024) return "";
    const extension = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
    const safeId = text(post.id).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 60) || String(Date.now());
    const fileName = `shared-${text(post.source) || "post"}-${safeId}.${extension}`;
    await mkdir(INBOX_ATTACHMENT_DIR, { recursive: true });
    await writeFile(path.join(INBOX_ATTACHMENT_DIR, fileName), bytes);
    return `${INBOX_ATTACHMENT_URL_PREFIX}/${fileName}`;
  } catch {
    return "";
  }
};
