// TikTok Business comments — ingestion, Center reads, replies, and the poll loop.
//
// WHERE TIKTOK ROWS LIVE
// ----------------------
// The same canonical tables Facebook/Instagram comments live in:
//   * social_comment_automation_runs   (one row per comment; platform='tiktok',
//                                       channel='tiktok_comment')
//   * tiktok_business_comment_map      (TikTok ids <-> canonical rows, dedupe)
//   * tiktok_business_sync_cursors     (per-video pagination + backoff)
//   * tiktok_business_reply_log        (reply idempotency)
//
// Events are stored through the SAME storeSocialCommentAutomationRuns() the
// Meta pollers use, always with skipAutomation: true — the automation engine is
// Meta-only today, and a TikTok row entering it would attempt Graph API calls.
// The Social Comments Center reads TikTok rows through the tiktok branch that
// socialCommentsCenterService.js dispatches to (list/thread/fast-list below).
//
// SYNC STRATEGY
// -------------
// Polling is the guarantee; the comment.update webhook is the accelerator.
// TikTok's docs confirm comment.update fires within ~5 minutes of a comment
// being created/deleted/hidden — but webhook delivery is at-least-once and only
// for events after subscription, so the poll loop remains the source of truth
// for backfill and misses. Webhook events funnel into a targeted single-comment
// sync (comment_ids filter) rather than a full video crawl.

import db from "../database/db.js";
import {
  describeTikTokBusinessFailure,
  isTikTokBusinessRateLimited,
  parseTikTokBusinessWebhookContent,
} from "./tiktokBusinessApiClient.js";
import {
  TIKTOK_BUSINESS_CAPABILITY,
  detectTikTokBusinessCommentsCapability,
  invalidateTikTokBusinessCapabilityCache,
} from "./tiktokBusinessCapabilityService.js";
import {
  TikTokBusinessCommentsUnavailableError,
  commentIdempotencyKey,
  tiktokBusinessCommentsProvider,
} from "./tiktokBusinessCommentsProvider.js";
import { tiktokBusinessCommentsEnabled, tiktokBusinessEnabled } from "./tiktokBusinessConfigService.js";
import {
  ensureTikTokBusinessSchema,
  getTikTokBusinessConnectionRow,
} from "./tiktokBusinessOAuthService.js";

const text = (value = "") => String(value ?? "").trim();
const numberOrNull = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

// Bounded work per sync pass. TikTok caps video pages at 20 and comment pages
// at 30; these bound how many of those pages one pass may consume so a huge
// account cannot wedge the worker.
const MAX_VIDEOS_PER_SYNC = Math.max(1, Number(process.env.TIKTOK_BUSINESS_SYNC_MAX_VIDEOS || 10));
const MAX_COMMENT_PAGES_PER_VIDEO = Math.max(1, Number(process.env.TIKTOK_BUSINESS_SYNC_MAX_COMMENT_PAGES || 5));
const POLL_INTERVAL_MS = Math.max(60_000, Number(process.env.TIKTOK_BUSINESS_COMMENTS_POLL_INTERVAL_MS || 5 * 60 * 1000));
// Exponential backoff on consecutive failures, capped. Rate-limit failures use
// at least one full interval regardless.
const BACKOFF_BASE_MS = 60_000;
const BACKOFF_CAP_MS = 60 * 60 * 1000;

let schemaReadyPromise = null;
const ensureSchemaOnce = () => {
  if (!schemaReadyPromise) {
    schemaReadyPromise = ensureTikTokBusinessSchema().catch((error) => {
      schemaReadyPromise = null;
      throw error;
    });
  }
  return schemaReadyPromise;
};

// ---------------------------------------------------------------------------
// Event building — canonical shape shared with the Meta pollers
// ---------------------------------------------------------------------------

// Mirrors buildMetaPolledCommentEvent's output contract so
// storeSocialCommentAutomationRuns and every downstream reader see a familiar
// row. TikTok-specific identifiers ride inside raw_payload.
export const buildTikTokCommentEvent = ({ tenantId, businessId = "", video = {}, comment = {} } = {}) => {
  const videoId = text(comment.external_conversation_id || video.item_id);
  const commentId = text(comment.external_message_id);
  const parentCommentId = text(comment.parent_external_message_id || "");
  const createdIso = text(comment.created_at) || new Date().toISOString();
  const shareUrl = text(video.share_url);
  const caption = text(video.caption);
  const thumbnail = text(video.thumbnail_url);
  const postCreatedIso = video.create_time ? new Date(Number(video.create_time) * 1000).toISOString() : "";

  return {
    tenant_id: tenantId,
    platform: "tiktok",
    channel: "tiktok_comment",
    post_id: videoId,
    post_full_picture: thumbnail,
    attachment_image: thumbnail,
    post_thumbnail: thumbnail,
    post_permalink: shareUrl,
    post_permalink_url: shareUrl,
    post_message: caption,
    post_caption: caption,
    post_created_time: postCreatedIso,
    comment_id: commentId,
    parent_comment_id: parentCommentId,
    root_comment_id: parentCommentId || commentId,
    commenter_id: text(comment.external_customer_id),
    commenter_name: text(comment.customer_name),
    commenter_profile_picture_url: text(comment.customer_avatar_url),
    original_comment_text: text(comment.body),
    comment_created_time: createdIso,
    comment_permalink_url: shareUrl,
    comment_url: shareUrl,
    classification_label: null,
    classification_score: null,
    action_taken: "ingested",
    public_reply_status: null,
    dm_status: null,
    like_status: null,
    inbox_conversation_id: null,
    error_code: null,
    automation_state: {},
    raw_payload: {
      source: "tiktok_business_comment_sync",
      provider: "tiktok_business",
      business_id: text(businessId),
      video_id: videoId,
      comment_id: commentId,
      parent_comment_id: parentCommentId,
      unique_identifier: text(comment.external_customer_id),
      username: text(comment.customer_username),
      is_reply: Boolean(parentCommentId),
      is_hidden: comment.is_hidden,
      is_pinned: comment.is_pinned,
      is_liked_by_owner: comment.is_liked_by_owner,
      like_count: Number(comment.like_count || 0),
      reply_count: Number(comment.reply_count || 0),
      image_url: text(comment.image_url),
      video: {
        item_id: text(video.item_id),
        caption,
        share_url: shareUrl,
        thumbnail_url: thumbnail,
        create_time: video.create_time ?? null,
        comments: Number(video.comments || 0),
        likes: Number(video.likes || 0),
      },
    },
    processed_at: createdIso,
  };
};

// ---------------------------------------------------------------------------
// Comment map upserts
// ---------------------------------------------------------------------------

const upsertCommentMapRow = async ({ tenantId, businessId, comment, isOwnReply = false, client = db }) => {
  const idempotencyKey = commentIdempotencyKey(
    { comment_id: comment.external_message_id, video_id: comment.external_conversation_id },
    { videoId: comment.external_conversation_id }
  );
  if (!idempotencyKey) return null;
  const { rows } = await client.query(
    `INSERT INTO tiktok_business_comment_map (
       tenant_id, business_id, tiktok_video_id, tiktok_comment_id, tiktok_parent_comment_id,
       tiktok_author_id, is_hidden, is_pinned, is_liked_by_owner, like_count, reply_count,
       is_own_reply, idempotency_key, provider_metadata, comment_created_at, updated_at
     ) VALUES (
       $1::bigint, $2::text, $3::text, $4::text, $5::text,
       $6::text, $7::boolean, $8::boolean, $9::boolean, $10::int, $11::int,
       $12::boolean, $13::text, $14::jsonb, $15::timestamp, NOW()
     )
     ON CONFLICT (tenant_id, idempotency_key) DO UPDATE SET
       is_hidden = EXCLUDED.is_hidden,
       is_pinned = EXCLUDED.is_pinned,
       is_liked_by_owner = EXCLUDED.is_liked_by_owner,
       like_count = EXCLUDED.like_count,
       reply_count = EXCLUDED.reply_count,
       is_own_reply = tiktok_business_comment_map.is_own_reply OR EXCLUDED.is_own_reply,
       updated_at = NOW()
     RETURNING id, (xmax = 0) AS inserted`,
    [
      numberOrNull(tenantId),
      text(businessId),
      text(comment.external_conversation_id),
      text(comment.external_message_id),
      text(comment.parent_external_message_id || ""),
      text(comment.external_customer_id),
      comment.is_hidden,
      comment.is_pinned,
      comment.is_liked_by_owner,
      Number(comment.like_count || 0),
      Number(comment.reply_count || 0),
      Boolean(isOwnReply),
      idempotencyKey,
      JSON.stringify({ username: text(comment.customer_username || "") }),
      comment.created_at || null,
    ]
  );
  return rows[0] || null;
};

// ---------------------------------------------------------------------------
// Cursors + backoff
// ---------------------------------------------------------------------------

const readCursor = async ({ tenantId, resource, resourceKey = "", client = db }) => {
  const { rows } = await client.query(
    `SELECT * FROM tiktok_business_sync_cursors
     WHERE tenant_id = $1::bigint AND resource = $2::text AND resource_key = $3::text
     LIMIT 1`,
    [numberOrNull(tenantId), text(resource), text(resourceKey)]
  );
  return rows[0] || null;
};

const writeCursor = async ({ tenantId, resource, resourceKey = "", cursor = "", hasMore = false, error = null, rateLimited = false, client = db }) => {
  const failed = Boolean(error);
  await client.query(
    `INSERT INTO tiktok_business_sync_cursors (
       tenant_id, resource, resource_key, cursor, has_more, last_synced_at, last_error,
       consecutive_failures, next_attempt_at, updated_at
     ) VALUES (
       $1::bigint, $2::text, $3::text, $4::text, $5::boolean,
       CASE WHEN $6::boolean THEN NULL ELSE NOW() END,
       $7::text,
       CASE WHEN $6::boolean THEN 1 ELSE 0 END,
       CASE WHEN $6::boolean THEN NOW() + ($8::bigint || ' milliseconds')::interval ELSE NULL END,
       NOW()
     )
     ON CONFLICT (tenant_id, resource, resource_key) DO UPDATE SET
       cursor = EXCLUDED.cursor,
       has_more = EXCLUDED.has_more,
       last_synced_at = CASE WHEN $6::boolean THEN tiktok_business_sync_cursors.last_synced_at ELSE NOW() END,
       last_error = EXCLUDED.last_error,
       consecutive_failures = CASE WHEN $6::boolean THEN tiktok_business_sync_cursors.consecutive_failures + 1 ELSE 0 END,
       next_attempt_at = CASE WHEN $6::boolean
         THEN NOW() + (LEAST($9::bigint, $10::bigint * (1 << LEAST(tiktok_business_sync_cursors.consecutive_failures, 6))) || ' milliseconds')::interval
         ELSE NULL END,
       updated_at = NOW()`,
    [
      numberOrNull(tenantId),
      text(resource),
      text(resourceKey),
      text(cursor),
      Boolean(hasMore),
      failed,
      failed ? text(error).slice(0, 500) : "",
      rateLimited ? Math.max(POLL_INTERVAL_MS, BACKOFF_BASE_MS) : BACKOFF_BASE_MS,
      BACKOFF_CAP_MS,
      BACKOFF_BASE_MS,
    ]
  );
};

const cursorBlocked = (row) => Boolean(row?.next_attempt_at) && new Date(row.next_attempt_at).getTime() > Date.now();

// ---------------------------------------------------------------------------
// Ingestion
// ---------------------------------------------------------------------------

const loadStoreDeps = async () => {
  const module = await import("./socialCommentAutomationService.js");
  return { storeSocialCommentAutomationRuns: module.storeSocialCommentAutomationRuns };
};

const knownCommentIdsForVideo = async ({ tenantId, videoId, client = db }) => {
  const { rows } = await client.query(
    `SELECT tiktok_comment_id, is_own_reply FROM tiktok_business_comment_map
     WHERE tenant_id = $1::bigint AND tiktok_video_id = $2::text`,
    [numberOrNull(tenantId), text(videoId)]
  );
  const known = new Map();
  for (const row of rows) known.set(text(row.tiktok_comment_id), { is_own_reply: Boolean(row.is_own_reply) });
  return known;
};

// Ingests one page of normalized comments (top-level plus their inline
// reply_list expansions arrive pre-normalized from the provider). Idempotent:
// already-known comment ids only refresh counters in the map, and the ledger
// insert is skipped for them, so re-syncs never duplicate rows.
const ingestComments = async ({ tenantId, businessId, video, comments, storeDeps, client = db }) => {
  if (!comments.length) return { ingested: 0, refreshed: 0 };
  const videoId = text(video.item_id) || text(comments[0]?.external_conversation_id);
  const known = await knownCommentIdsForVideo({ tenantId, videoId, client });

  let ingested = 0;
  let refreshed = 0;
  for (const comment of comments) {
    const commentId = text(comment.external_message_id);
    if (!commentId) continue;
    const existing = known.get(commentId);
    // `owner === true` means the video owner (us) wrote it — either manually in
    // the TikTok app or via our reply flow. Recorded, never automated on.
    const isOwn = comment.is_owner === true || existing?.is_own_reply === true;

    await upsertCommentMapRow({ tenantId, businessId, comment, isOwnReply: isOwn, client });

    if (existing) {
      refreshed += 1;
      continue;
    }

    const event = buildTikTokCommentEvent({ tenantId, businessId, video, comment });
    // skipAutomation is unconditional for TikTok: the automation engine is
    // Meta-only and must never receive a tiktok row.
    await storeDeps.storeSocialCommentAutomationRuns({ tenantId, events: [event], skipAutomation: true });
    known.set(commentId, { is_own_reply: isOwn });
    ingested += 1;
  }
  return { ingested, refreshed };
};

// Pulls comment pages for one video until exhausted or the per-pass page bound.
export const syncTikTokCommentsForVideo = async ({ tenantId, video = {}, videoId = "", maxPages = MAX_COMMENT_PAGES_PER_VIDEO, commentIds } = {}) => {
  await ensureSchemaOnce();
  const safeVideoId = text(video.item_id) || text(videoId);
  if (!safeVideoId) return { success: false, reason: "video_id_required", comments_seen: 0, comments_saved: 0 };

  const cursorRow = await readCursor({ tenantId, resource: "comments", resourceKey: safeVideoId });
  if (cursorBlocked(cursorRow) && !commentIds?.length) {
    return { success: false, reason: "backoff", next_attempt_at: cursorRow.next_attempt_at, comments_seen: 0, comments_saved: 0 };
  }

  const connection = await getTikTokBusinessConnectionRow({ tenantId });
  const businessId = text(connection?.business_id);
  const storeDeps = await loadStoreDeps();

  let commentsSeen = 0;
  let commentsSaved = 0;
  // A targeted sync (webhook-driven, comment_ids filter) reads one page and
  // does not touch the stored crawl cursor.
  let cursor = commentIds?.length ? undefined : text(cursorRow?.cursor) || undefined;

  try {
    for (let page = 0; page < maxPages; page += 1) {
      const result = await tiktokBusinessCommentsProvider.listComments({
        tenantId,
        videoId: safeVideoId,
        cursor,
        commentIds,
      });
      commentsSeen += result.comments.length;
      const { ingested } = await ingestComments({ tenantId, businessId, video: { ...video, item_id: safeVideoId }, comments: result.comments, storeDeps });
      commentsSaved += ingested;

      if (!result.has_more || commentIds?.length) {
        if (!commentIds?.length) {
          // Crawl exhausted: reset the cursor so the next pass re-reads from the
          // newest comments (create_time desc) instead of resuming a dead tail.
          await writeCursor({ tenantId, resource: "comments", resourceKey: safeVideoId, cursor: "", hasMore: false });
        }
        break;
      }
      cursor = result.cursor;
      await writeCursor({ tenantId, resource: "comments", resourceKey: safeVideoId, cursor, hasMore: true });
    }
    return { success: true, comments_seen: commentsSeen, comments_saved: commentsSaved };
  } catch (error) {
    if (error instanceof TikTokBusinessCommentsUnavailableError) throw error;
    const failure = describeTikTokBusinessFailure(error);
    await writeCursor({
      tenantId,
      resource: "comments",
      resourceKey: safeVideoId,
      cursor: text(cursor || ""),
      hasMore: false,
      error: failure.message || failure.error_code || "sync_failed",
      rateLimited: isTikTokBusinessRateLimited(error),
    });
    console.warn("[tiktok-business] comment sync failed", { tenant_id: numberOrNull(tenantId), video_id: safeVideoId, ...failure });
    return { success: false, reason: "api_error", failure, comments_seen: commentsSeen, comments_saved: commentsSaved };
  }
};

// Full pass: recent videos -> comments per video. The capability gate runs
// once up front so a disabled/disconnected tenant costs one DB read, not an
// HTTP call per video.
export const syncTikTokCommentsForTenant = async ({ tenantId, maxVideos = MAX_VIDEOS_PER_SYNC } = {}) => {
  await ensureSchemaOnce();
  const capability = await detectTikTokBusinessCommentsCapability({ tenantId, probe: false });
  if (!capability.available) {
    return { success: false, reason: capability.status, videos_checked: 0, comments_seen: 0, comments_saved: 0 };
  }

  const totals = { success: true, videos_checked: 0, comments_seen: 0, comments_saved: 0, errors: 0 };
  let videos = [];
  try {
    const result = await tiktokBusinessCommentsProvider.listVideos({ tenantId, maxCount: 20 });
    videos = result.videos.slice(0, Math.max(1, maxVideos));
  } catch (error) {
    const failure = describeTikTokBusinessFailure(error);
    console.warn("[tiktok-business] video list failed", { tenant_id: numberOrNull(tenantId), ...failure });
    return { success: false, reason: "video_list_failed", failure, videos_checked: 0, comments_seen: 0, comments_saved: 0 };
  }

  for (const video of videos) {
    totals.videos_checked += 1;
    const result = await syncTikTokCommentsForVideo({ tenantId, video });
    totals.comments_seen += result.comments_seen;
    totals.comments_saved += result.comments_saved;
    if (!result.success && result.reason === "api_error") totals.errors += 1;
  }

  await db.query(
    `UPDATE tiktok_business_connections SET last_sync_at = NOW(), updated_at = NOW() WHERE tenant_id = $1::bigint`,
    [numberOrNull(tenantId)]
  ).catch(() => {});

  return totals;
};

// ---------------------------------------------------------------------------
// Social Comments Center reads (tiktok branch)
// ---------------------------------------------------------------------------

// Posts list: TikTok videos that have at least one ingested comment, shaped
// like the Meta post cards. Reads only our own ledger — no TikTok call, so the
// Center list stays fast and works even while TikTok is briefly down.
export const listTikTokCommentPosts = async ({ tenantId, limit = 50 } = {}) => {
  await ensureSchemaOnce();
  const safeTenantId = numberOrNull(tenantId);
  if (!safeTenantId) return [];
  const safeLimit = Math.min(200, Math.max(1, Number(limit) || 50));
  const { rows } = await db.query(
    `SELECT
       r.post_id,
       COUNT(*) FILTER (WHERE COALESCE(m.is_own_reply, FALSE) = FALSE) AS comments_count,
       MAX(COALESCE(NULLIF(r.comment_created_time, '')::timestamptz, r.created_at)) AS latest_comment_at,
       (ARRAY_AGG(r.post_caption ORDER BY r.created_at DESC, r.id DESC))[1] AS post_caption,
       (ARRAY_AGG(r.post_message ORDER BY r.created_at DESC, r.id DESC))[1] AS post_message,
       (ARRAY_AGG(r.post_full_picture ORDER BY r.created_at DESC, r.id DESC))[1] AS post_full_picture,
       (ARRAY_AGG(r.post_permalink_url ORDER BY r.created_at DESC, r.id DESC))[1] AS permalink_url,
       (ARRAY_AGG(r.post_created_time ORDER BY r.created_at DESC, r.id DESC))[1] AS post_created_time
     FROM social_comment_automation_runs r
     LEFT JOIN tiktok_business_comment_map m
       ON m.tenant_id = r.tenant_id
      AND m.tiktok_comment_id = r.comment_id
      AND m.tiktok_video_id = r.post_id
     WHERE r.tenant_id = $1::bigint AND r.platform = 'tiktok'
     GROUP BY r.post_id
     ORDER BY MAX(COALESCE(NULLIF(r.comment_created_time, '')::timestamptz, r.created_at)) DESC
     LIMIT $2::int`,
    [safeTenantId, safeLimit]
  );

  return rows.map((row) => ({
    id: text(row.post_id),
    post_id: text(row.post_id),
    canonical_post_id: text(row.post_id),
    platform_post_id: text(row.post_id),
    source_post_id: text(row.post_id),
    platform: "tiktok",
    channel: "tiktok_comment",
    post_caption: text(row.post_caption),
    post_message: text(row.post_message || row.post_caption),
    post_full_picture: text(row.post_full_picture),
    post_thumbnail: text(row.post_full_picture),
    permalink_url: text(row.permalink_url),
    post_permalink_url: text(row.permalink_url),
    post_created_time: text(row.post_created_time),
    display_post_time: text(row.post_created_time) || (row.latest_comment_at ? new Date(row.latest_comment_at).toISOString() : ""),
    comments_count: Number(row.comments_count || 0),
    latest_comment_at: row.latest_comment_at ? new Date(row.latest_comment_at).toISOString() : "",
    linked_products: [],
    linked_products_count: 0,
  }));
};

export const loadTikTokCommentPost = async ({ tenantId, postId } = {}) => {
  const posts = await listTikTokCommentPosts({ tenantId, limit: 200 });
  const safePostId = text(postId);
  return posts.find((post) => post.post_id === safePostId) || null;
};

// Fast-list rows for the Center's unified queue.
export const listTikTokCommentFastList = async ({ tenantId, limit = 20, cursor = "" } = {}) => {
  await ensureSchemaOnce();
  const safeTenantId = numberOrNull(tenantId);
  if (!safeTenantId) return { rows: [], next_cursor: "" };
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 20));
  const cursorId = numberOrNull(cursor);
  const { rows } = await db.query(
    `SELECT r.*
     FROM social_comment_automation_runs r
     WHERE r.tenant_id = $1::bigint
       AND r.platform = 'tiktok'
       AND ($2::bigint IS NULL OR r.id < $2::bigint)
     ORDER BY r.id DESC
     LIMIT $3::int`,
    [safeTenantId, cursorId, safeLimit]
  );
  return {
    rows,
    next_cursor: rows.length === safeLimit ? String(rows[rows.length - 1].id) : "",
  };
};

// ---------------------------------------------------------------------------
// Replies (Phase 5)
// ---------------------------------------------------------------------------

export class TikTokBusinessReplyError extends Error {
  constructor(message, code = "TIKTOK_BUSINESS_REPLY_FAILED", status = 422) {
    super(message);
    this.name = "TikTokBusinessReplyError";
    this.code = code;
    this.status = status;
  }
}

// Explicit-user-action reply. Guarantees, in order:
//   1. the comment was ingested for THIS tenant (ownership validation);
//   2. an identical in-flight/completed request is answered from the log, not
//      re-sent (duplicate protection — the log INSERT is the mutex);
//   3. the provider result (or its failure) is recorded on the log row and the
//      canonical run row.
export const replyToTikTokComment = async ({ tenantId, commentId, text: replyText, userId = null } = {}) => {
  await ensureSchemaOnce();
  const safeTenantId = numberOrNull(tenantId);
  const safeCommentId = text(commentId);
  const body = text(replyText);
  if (!safeTenantId || !safeCommentId) throw new TikTokBusinessReplyError("tenant and comment are required", "TIKTOK_BUSINESS_REPLY_INVALID", 400);
  if (!body) throw new TikTokBusinessReplyError("Reply text is required", "TIKTOK_BUSINESS_REPLY_EMPTY", 400);

  // Ownership: the comment must exist in this tenant's map — which only ever
  // contains comments read with this tenant's token from its own videos.
  const { rows: mapRows } = await db.query(
    `SELECT * FROM tiktok_business_comment_map
     WHERE tenant_id = $1::bigint AND tiktok_comment_id = $2::text
     ORDER BY id DESC LIMIT 1`,
    [safeTenantId, safeCommentId]
  );
  const mapRow = mapRows[0];
  if (!mapRow) {
    throw new TikTokBusinessReplyError(
      "Comment does not belong to this tenant's connected TikTok account",
      "TIKTOK_BUSINESS_COMMENT_NOT_FOUND",
      404
    );
  }
  const videoId = text(mapRow.tiktok_video_id);

  // Duplicate protection: one logical request = (tenant, comment, exact text).
  // The unique INSERT is the race arbiter; the loser reads the winner's row.
  const { createHash } = await import("node:crypto");
  const requestKey = `reply:${safeCommentId}:${createHash("sha256").update(body, "utf8").digest("hex").slice(0, 32)}`;
  const inserted = await db.query(
    `INSERT INTO tiktok_business_reply_log (
       tenant_id, business_id, tiktok_video_id, tiktok_comment_id, request_key, status, created_by_user_id
     ) VALUES ($1::bigint, $2::text, $3::text, $4::text, $5::text, 'pending', $6::bigint)
     ON CONFLICT (tenant_id, request_key) DO NOTHING
     RETURNING id`,
    [safeTenantId, text(mapRow.business_id), videoId, safeCommentId, requestKey, numberOrNull(userId)]
  );
  if (!inserted.rowCount) {
    const { rows: existingRows } = await db.query(
      `SELECT * FROM tiktok_business_reply_log WHERE tenant_id = $1::bigint AND request_key = $2::text LIMIT 1`,
      [safeTenantId, requestKey]
    );
    const existing = existingRows[0];
    if (existing?.status === "sent") {
      return { sent: true, duplicate: true, provider_reply_id: text(existing.provider_reply_id), video_id: videoId };
    }
    throw new TikTokBusinessReplyError(
      "An identical reply to this comment is already in flight",
      "TIKTOK_BUSINESS_REPLY_DUPLICATE",
      409
    );
  }
  const logId = inserted.rows[0].id;

  try {
    const result = await tiktokBusinessCommentsProvider.createReply({
      tenantId: safeTenantId,
      videoId,
      commentId: safeCommentId,
      text: body,
    });
    const providerReplyId = text(result.reply_comment_id);

    await db.query(
      `UPDATE tiktok_business_reply_log
       SET status = 'sent', provider_reply_id = $2::text, updated_at = NOW()
       WHERE id = $1::bigint`,
      [logId, providerReplyId]
    );
    // Record our own reply in the map immediately so the next poll recognises
    // it instead of ingesting it as a new customer comment.
    if (providerReplyId) {
      await upsertCommentMapRow({
        tenantId: safeTenantId,
        businessId: text(mapRow.business_id),
        comment: {
          external_conversation_id: videoId,
          external_message_id: providerReplyId,
          parent_external_message_id: safeCommentId,
          external_customer_id: "",
          customer_username: "",
          body,
          created_at: new Date().toISOString(),
        },
        isOwnReply: true,
      }).catch(() => {});
    }
    await db.query(
      `UPDATE social_comment_automation_runs
       SET public_reply_status = 'sent', updated_at = NOW()
       WHERE tenant_id = $1::bigint AND platform = 'tiktok' AND comment_id = $2::text`,
      [safeTenantId, safeCommentId]
    ).catch(() => {});

    return { sent: true, duplicate: false, provider_reply_id: providerReplyId, video_id: videoId };
  } catch (error) {
    const failure = describeTikTokBusinessFailure(error);
    await db.query(
      `UPDATE tiktok_business_reply_log
       SET status = 'failed', error_code = $2::text, error_message = $3::text, updated_at = NOW()
       WHERE id = $1::bigint`,
      [logId, text(failure.error_code || error?.code), text(failure.message)]
    ).catch(() => {});
    throw error;
  }
};

// ---------------------------------------------------------------------------
// Webhook intake processing (Phase 6)
// ---------------------------------------------------------------------------

// Durable intake row -> targeted comment sync. Deletes fetch nothing (TikTok
// returns nothing to fetch), so the ledger row is marked hidden instead.
export const processTikTokBusinessWebhookEvent = async ({ eventRow } = {}) => {
  const payload = eventRow?.payload || {};
  // Digit-safe parse: the ids inside `content` are unquoted JSON numbers past
  // 2^53 and are extracted as strings, never through Number.
  const content = parseTikTokBusinessWebhookContent(payload.content);
  const commentId = text(content?.comment_id);
  const videoId = text(content?.video_id);
  const action = text(content?.comment_action).toLowerCase();
  const userOpenId = text(payload.user_openid);
  if (!commentId || !videoId) return { processed: false, reason: "missing_ids" };

  const connection = userOpenId
    ? await db.query(
        `SELECT tenant_id FROM tiktok_business_connections WHERE business_id = $1::text LIMIT 1`,
        [userOpenId]
      ).then(({ rows }) => rows[0] || null)
    : null;
  const tenantId = numberOrNull(connection?.tenant_id ?? eventRow?.tenant_id);
  if (!tenantId) return { processed: false, reason: "tenant_unresolved" };

  if (action === "delete") {
    await db.query(
      `UPDATE tiktok_business_comment_map SET is_hidden = TRUE, updated_at = NOW()
       WHERE tenant_id = $1::bigint AND tiktok_comment_id = $2::text`,
      [tenantId, commentId]
    ).catch(() => {});
    return { processed: true, action: "deleted_marked_hidden" };
  }

  const result = await syncTikTokCommentsForVideo({ tenantId, videoId, commentIds: [commentId] });
  return { processed: true, action, sync: result };
};

// ---------------------------------------------------------------------------
// Poll worker
// ---------------------------------------------------------------------------

let workerTimer = null;

const pollOnce = async () => {
  // Every tenant with a live connection. Bounded by the per-tenant caps above.
  const { rows } = await db.query(
    `SELECT tenant_id FROM tiktok_business_connections
     WHERE status = 'connected' AND access_token_encrypted <> ''`
  );
  for (const row of rows) {
    const tenantId = numberOrNull(row.tenant_id);
    if (!tenantId) continue;
    try {
      await syncTikTokCommentsForTenant({ tenantId });
    } catch (error) {
      console.warn("[tiktok-business] poll pass failed", {
        tenant_id: tenantId,
        ...describeTikTokBusinessFailure(error),
      });
    }
  }

  // Drain pending webhook intake rows (at-least-once; event_key dedupes).
  const pending = await db.query(
    `SELECT * FROM tiktok_business_webhook_events
     WHERE status = 'pending' AND event_type = 'comment.update'
     ORDER BY received_at ASC LIMIT 50`
  );
  for (const eventRow of pending.rows) {
    try {
      const result = await processTikTokBusinessWebhookEvent({ eventRow });
      await db.query(
        `UPDATE tiktok_business_webhook_events
         SET status = $2::text, processed_at = NOW(), attempts = attempts + 1, last_error = $3::text
         WHERE id = $1::bigint`,
        [eventRow.id, result.processed ? "processed" : "skipped", result.processed ? "" : text(result.reason)]
      );
    } catch (error) {
      await db.query(
        `UPDATE tiktok_business_webhook_events
         SET status = CASE WHEN attempts >= 5 THEN 'failed' ELSE 'pending' END,
             attempts = attempts + 1, last_error = $2::text
         WHERE id = $1::bigint`,
        [eventRow.id, text(describeTikTokBusinessFailure(error).message)]
      ).catch(() => {});
    }
  }
};

export const startTikTokBusinessCommentsWorker = () => {
  if (!tiktokBusinessEnabled() || !tiktokBusinessCommentsEnabled()) return null;
  if (workerTimer) return workerTimer;
  const run = () => {
    pollOnce()
      .catch((error) => console.warn("[tiktok-business] worker cycle failed", describeTikTokBusinessFailure(error)))
      .finally(() => {
        workerTimer = setTimeout(run, POLL_INTERVAL_MS);
        if (workerTimer.unref) workerTimer.unref();
      });
  };
  // First pass is delayed one interval: boot should never race a cold pool.
  workerTimer = setTimeout(run, Math.min(POLL_INTERVAL_MS, 60_000));
  if (workerTimer.unref) workerTimer.unref();
  console.log("[tiktok-business] comments worker started", { interval_ms: POLL_INTERVAL_MS });
  return workerTimer;
};

export const stopTikTokBusinessCommentsWorker = () => {
  if (workerTimer) clearTimeout(workerTimer);
  workerTimer = null;
};

export { TIKTOK_BUSINESS_CAPABILITY, invalidateTikTokBusinessCapabilityCache };
