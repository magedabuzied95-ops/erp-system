import express from "express";
import db from "../database/db.js";
import { protect } from "../middleware/authMiddleware.js";
import permit from "../middleware/permissionMiddleware.js";
import {
  getSocialAutoReplySettings,
  getSocialCommentCommentByCommentId,
  getSocialCommentPostByCommentId,
  getSocialPostAutoReplyTemplate,
  ignoreSocialComment,
  backfillSocialCommentPostMedia,
  getSocialCommentAutomationConfig,
  upsertSocialCommentAutomationConfig,
  listSocialCommentPosts,
  listSocialCommentThreadComments,
  loadSocialCommentPost,
  processSocialCommentAutoReply,
  listSocialCommentCenterFastList,
  getSocialCommentsPerformanceMetrics,
  saveSocialAutoReplySettings,
  saveSocialPostAutoReplyTemplate,
  ensureSocialCommentsCenterSchema,
} from "../services/socialCommentsCenterService.js";
import { getSocialCommentJobQueueStatus } from "../services/socialCommentJobQueue.js";
import {
  getPostProductLinksV2,
  removePostProductLinksV2,
  resolveSocialPostLinkKey,
  savePostProductLinksV2,
} from "../services/socialPostProductLinksV2Service.js";
import { saveMappings } from "../services/postProductMappingService.js";
import { getSocialRealtimeMetrics } from "../services/socialRealtimeService.js";

const router = express.Router();
const debugRouter = express.Router();
const buildPostIdentityTrace = (payload = {}) => payload;
const normalizeRole = (value = "") => String(value || "").trim().toLowerCase().replace(/[_-]+/g, " ");
const isSocialCommentsAdminUser = (user = {}) => {
  const role = normalizeRole(user.role_name || user.role);
  return ["admin", "super admin", "superadmin"].includes(role) || user.is_super_admin === true || user.permissions?.includes?.("*");
};
const requireSocialCommentsAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: "Authentication required" });
  }
  if (!isSocialCommentsAdminUser(req.user)) {
    return res.status(403).json({ success: false, message: "Admin access required" });
  }
  return next();
};
const isSocialCommentsDebugEnabled = () => String(process.env.DEBUG_SOCIAL_COMMENTS || "").toLowerCase() === "true";
const debugSocialCommentsWarn = (...args) => {
  if (isSocialCommentsDebugEnabled()) console.warn(...args);
};
let socialCommentsSchemaReadyPromise = null;
let socialCommentAutomationRouteDepsPromise = null;
const ensureSocialCommentsSchemaReady = () => {
  if (!socialCommentsSchemaReadyPromise) {
    socialCommentsSchemaReadyPromise = ensureSocialCommentsCenterSchema().catch((error) => {
      socialCommentsSchemaReadyPromise = null;
      throw error;
    });
  }
  return socialCommentsSchemaReadyPromise;
};
const getSocialCommentAutomationRouteDeps = async () => {
  if (!socialCommentAutomationRouteDepsPromise) {
    socialCommentAutomationRouteDepsPromise = import("../services/socialCommentAutomationService.js")
      .then((module) => ({
        listSocialCommentAutomationRuns: module.listRecentSocialCommentAutomationRuns,
        testSocialCommentAutomationRuntime: module.testSocialCommentAutomationRuntime,
      }))
      .catch((error) => {
        socialCommentAutomationRouteDepsPromise = null;
        throw error;
      });
  }
  return socialCommentAutomationRouteDepsPromise;
};

const toTenantId = (req) => Number(req.query?.tenant_id || req.body?.tenant_id || req.headers["x-tenant-id"] || 1) || 1;
const clean = (value = "") => String(value ?? "").trim();
const parseAutomationRoutePostIdentity = (value = "", fallbackPlatform = "") => {
  const raw = String(value || "").trim();
  const normalized = raw
    .replace(/^(social_comment|facebook_comment|instagram_comment|facebook_post|instagram_post):/i, "")
    .replace(/^(facebook|instagram):/i, "")
    .trim();
  if (!normalized) {
    return {
      raw,
      normalized,
      route_platform: clean(fallbackPlatform),
      platform_post_id: "",
      source_post_id: "",
      permalink_post_id: "",
      canonical_post_id: "",
      resolved_post_id: "",
      candidate_post_ids: [],
    };
  }
  if (!normalized.includes("|")) {
    return {
      raw,
      normalized,
      route_platform: clean(fallbackPlatform),
      platform_post_id: normalized,
      source_post_id: normalized,
      permalink_post_id: "",
      canonical_post_id: normalized,
      resolved_post_id: normalized,
      candidate_post_ids: [normalized],
    };
  }
  const [routePlatform = "", platformPostId = "", thirdPart = "", permalinkPostId = "", fifthPart = ""] = normalized
    .split("|")
    .map((part) => String(part || "").trim());
  const canonicalPostId = clean(thirdPart || fifthPart || platformPostId);
  const sourcePostId = clean(fifthPart || thirdPart || platformPostId);
  const resolvedPostId = clean(canonicalPostId || sourcePostId || platformPostId || permalinkPostId);
  return {
    raw,
    normalized,
    route_platform: clean(routePlatform || fallbackPlatform),
    platform_post_id: clean(platformPostId),
    source_post_id: sourcePostId,
    permalink_post_id: clean(permalinkPostId),
    canonical_post_id: canonicalPostId,
    resolved_post_id: resolvedPostId,
    candidate_post_ids: [...new Set([
      canonicalPostId,
      sourcePostId,
      clean(platformPostId),
      clean(permalinkPostId),
      resolvedPostId,
    ].filter(Boolean))],
  };
};
const normalizeAutomationRoutePostId = (value = "", fallbackPlatform = "") => {
  const parsed = parseAutomationRoutePostIdentity(value, fallbackPlatform);
  return parsed.resolved_post_id || parsed.normalized || "";
};
const buildAutomationRouteLookupPost = (post = {}, identity = {}) => {
  const safePost = post && typeof post === "object" && !Array.isArray(post) ? post : {};
  const postId = clean(safePost?.post_id || identity.source_post_id || identity.resolved_post_id || identity.canonical_post_id || "");
  const canonicalPostId = clean(safePost?.canonical_post_id || identity.canonical_post_id || postId);
  const platformPostId = clean(safePost?.platform_post_id || identity.platform_post_id || postId || canonicalPostId);
  const sourcePostId = clean(safePost?.source_post_id || identity.source_post_id || postId || canonicalPostId);
  const permalinkPostId = clean(safePost?.permalink_post_id || identity.permalink_post_id || "");
  const metadata = safePost?.metadata && typeof safePost.metadata === "object" && !Array.isArray(safePost.metadata)
    ? safePost.metadata
    : {};
  return {
    ...safePost,
    post_id: postId,
    canonical_post_id: canonicalPostId,
    platform_post_id: platformPostId,
    source_post_id: sourcePostId,
    permalink_post_id: permalinkPostId,
    metadata: {
      ...metadata,
      post_id: clean(metadata.post_id || sourcePostId || postId || canonicalPostId),
      platform_post_id: clean(metadata.platform_post_id || platformPostId || canonicalPostId),
      canonical_post_id: clean(metadata.canonical_post_id || canonicalPostId),
      source_post_id: clean(metadata.source_post_id || sourcePostId || postId || canonicalPostId),
      permalink_post_id: clean(metadata.permalink_post_id || permalinkPostId),
    },
  };
};
const loadAutomationRoutePost = async ({ tenantId = null, platform = "", requestedPostId = "" } = {}) => {
  const identity = parseAutomationRoutePostIdentity(requestedPostId, platform);
  const candidateIds = [...new Set([
    identity.canonical_post_id,
    identity.resolved_post_id,
    identity.source_post_id,
    identity.platform_post_id,
    identity.permalink_post_id,
    clean(requestedPostId),
  ].filter(Boolean))];
  for (const candidatePostId of candidateIds) {
    const post = await loadSocialCommentPost({ tenantId, platform, postId: candidatePostId }).catch(() => null);
    if (post) {
      return {
        identity,
        post: buildAutomationRouteLookupPost(post, identity),
        matched_post_id: candidatePostId,
      };
    }
  }
  return {
    identity,
    post: buildAutomationRouteLookupPost({}, identity),
    matched_post_id: "",
  };
};
const buildManualLinkPostContext = (req, post = {}, requestedPostId = "") => {
  const identityObject = req.body?.post_identity && typeof req.body.post_identity === "object" && !Array.isArray(req.body.post_identity)
    ? req.body.post_identity
    : req.query?.post_identity && typeof req.query.post_identity === "object" && !Array.isArray(req.query.post_identity)
      ? req.query.post_identity
      : {};
  const normalizedRequestedPostId = normalizeAutomationRoutePostId(requestedPostId || req.params?.postId || "");
  const normalizedCanonicalPostId = clean(
    normalizeAutomationRoutePostId(
      identityObject.canonical_post_id ||
      req.body?.canonical_post_id ||
      req.query?.canonical_post_id ||
      post?.canonical_post_id ||
      post?.post_id ||
      normalizedRequestedPostId
    )
  );
  const normalizedPlatformPostId = clean(
    normalizeAutomationRoutePostId(
      identityObject.platform_post_id ||
      req.body?.platform_post_id ||
      req.query?.platform_post_id ||
      post?.platform_post_id ||
      normalizedCanonicalPostId ||
      normalizedRequestedPostId
    )
  );
  const normalizedSourcePostId = clean(
    normalizeAutomationRoutePostId(
      identityObject.source_post_id ||
      req.body?.source_post_id ||
      req.query?.source_post_id ||
      post?.source_post_id ||
      post?.post_id ||
      normalizedRequestedPostId ||
      normalizedCanonicalPostId
    )
  );
  const normalizedPermalinkPostId = clean(
    normalizeAutomationRoutePostId(
      identityObject.permalink_post_id ||
      req.body?.permalink_post_id ||
      req.query?.permalink_post_id ||
      identityObject.object_id ||
      req.body?.object_id ||
      req.query?.object_id ||
      post?.permalink_post_id ||
      post?.object_id ||
      ""
    )
  );
  const normalizedObjectId = clean(
    normalizeAutomationRoutePostId(
      identityObject.object_id ||
      req.body?.object_id ||
      req.query?.object_id ||
      post?.object_id ||
      normalizedPermalinkPostId ||
      ""
    )
  );
  const identity = {
    ...identityObject,
    platform_post_id: normalizedPlatformPostId,
    source_post_id: normalizedSourcePostId,
    permalink_post_id: normalizedPermalinkPostId,
    canonical_post_id: normalizedCanonicalPostId,
    post_id: clean(
      normalizeAutomationRoutePostId(
        identityObject.post_id ||
        req.body?.post_identity_post_id ||
        req.query?.post_identity_post_id ||
        req.body?.post_id ||
        req.query?.post_id ||
        normalizedSourcePostId ||
        normalizedRequestedPostId ||
        normalizedCanonicalPostId
      )
    ),
    object_id: normalizedObjectId,
  };
  const merged = {
    ...(post || {}),
    platform_post_id: clean(identity.platform_post_id || post?.platform_post_id || normalizedPlatformPostId || normalizedCanonicalPostId || normalizedRequestedPostId),
    source_post_id: clean(identity.source_post_id || post?.source_post_id || post?.post_id || normalizedSourcePostId || normalizedRequestedPostId || normalizedCanonicalPostId),
    permalink_post_id: clean(identity.permalink_post_id || post?.permalink_post_id || normalizedPermalinkPostId),
    object_id: clean(identity.object_id || post?.object_id || normalizedObjectId),
    canonical_post_id: clean(identity.canonical_post_id || post?.canonical_post_id || normalizedCanonicalPostId || normalizedRequestedPostId),
    post_id: clean(identity.post_id || post?.post_id || normalizedSourcePostId || normalizedRequestedPostId || normalizedCanonicalPostId),
  };
  return {
    identity,
    merged,
  };
};

router.use(async (_req, _res, next) => {
  await ensureSocialCommentsSchemaReady().catch(() => {});
  next();
});

router.get("/posts", protect, permit("settings", "view"), async (req, res) => {
  try {
    const tenantId = toTenantId(req);
    const platform = String(req.query?.platform || "").trim();
    if (String(req.query?.debug || "") === "1") {
      console.log("[social-comments-posts-route-hit]", {
        tenant_id: tenantId,
        platform,
      });
    }
    const includeProductLinks = !["0", "false", "no"].includes(String(req.query?.include_product_links || "1").trim().toLowerCase());
    const posts = await listSocialCommentPosts({
      tenantId,
      platform,
      limit: req.query?.limit || 50,
      includeProductLinks,
    });
    const responsePosts = posts.map((post) => ({
      ...post,
      display_post_time: String(post?.display_post_time || post?.post_created_time || post?.metadata_post_created_time || post?.metadata_post_object_created_time || "").trim() || null,
      post_created_time: String(post?.post_created_time || post?.display_post_time || post?.metadata_post_created_time || post?.metadata_post_object_created_time || "").trim() || null,
      id: String(post?.id || post?.post_id || post?.canonical_post_id || post?.platform_post_id || post?.source_post_id || post?.permalink_url || post?.post_link_key || "").trim(),
      post_id: String(post?.post_id || post?.id || post?.canonical_post_id || post?.platform_post_id || post?.source_post_id || post?.permalink_url || "").trim(),
      canonical_post_id: String(post?.canonical_post_id || post?.post_id || post?.id || post?.platform_post_id || post?.source_post_id || "").trim(),
      platform_post_id: String(post?.platform_post_id || post?.post_id || post?.canonical_post_id || post?.id || "").trim(),
      source_post_id: String(post?.source_post_id || post?.post_id || post?.canonical_post_id || post?.id || "").trim(),
      post_link_key: String(post?.post_link_key || post?.postLinkKey || post?.canonical_post_id || post?.post_id || post?.id || post?.permalink_url || "").trim() || null,
      permalink_url: String(post?.permalink_url || post?.post_permalink_url || post?.display_permalink || "").trim() || null,
      comments_count: Number(post?.comments_count ?? post?.commentsCount ?? post?.comment_count ?? post?.total_comments ?? 0) || 0,
      linked_products: Array.isArray(post?.linked_products) ? post.linked_products : [],
      linked_products_count: Number(post?.linked_products_count || post?.product_links_count || (Array.isArray(post?.linked_products) ? post.linked_products.length : 0) || 0) || 0,
    }));
    console.log("SOCIAL_POSTS_API_RESPONSE_SHAPE_TRACE", {
      rows_count: responsePosts.length,
      first_row_keys: Array.isArray(responsePosts) && responsePosts[0] && typeof responsePosts[0] === "object" ? Object.keys(responsePosts[0]).slice(0, 50) : [],
      sample_ids: responsePosts.slice(0, 5).map((post) => String(
        post?.id ||
        post?.post_id ||
        post?.canonical_post_id ||
        post?.platform_post_id ||
        post?.source_post_id ||
        post?.permalink_url ||
        post?.post_link_key ||
        ""
      ).trim()).filter(Boolean),
    });
    console.log("AI_POST_TIME_PAYLOAD", {
      tenant_id: tenantId,
      platform,
      sample: responsePosts.slice(0, 5).map((post) => ({
        post_id: post.post_id || post.conversation_id || "",
        marketing_published_at: post.marketing_published_at || "",
        marketing_created_time: post.marketing_created_time || "",
        metadata_post_created_time: post.metadata_post_created_time || "",
        post_created_time: post.post_created_time || "",
        real_comment_created_time: post.real_comment_created_time || "",
      })),
    });
    if (String(req.query?.debug || "") === "1") {
      console.log("[social-comments-posts-debug]", {
        tenant_id: tenantId,
        platform,
        total: responsePosts.length,
        sample: responsePosts.slice(0, 3).map((post) => ({
          post_id: post.post_id || post.conversation_id || "",
          has_thumbnail: Boolean(post.has_thumbnail),
          thumbnail_source: post.thumbnail_source || "",
          graph_enriched: Boolean(post.graph_enriched),
          reason_if_missing: post.reason_if_missing || "",
        })),
      });
    }
    return res.json({ success: true, posts: responsePosts, total: responsePosts.length });
  } catch (error) {
    console.log("SOCIAL_COMMENTS_POST_FEED_ERROR", {
      route: "/api/social-comments/posts",
      message: error?.message || "Failed to load social comment posts",
      stack: error?.stack || "",
      post_id: "",
    });
    return res.status(error?.status || 500).json({ success: false, message: error?.message || "Failed to load social comment posts" });
  }
});

router.get("/fast-list", protect, permit("settings", "view"), async (req, res) => {
  const tenantId = toTenantId(req);
  const platform = String(req.query?.platform || "").trim();
  const status = String(req.query?.status || "").trim();
  const cursor = String(req.query?.cursor || "").trim();
  const limit = Math.min(100, Math.max(1, Number(req.query?.limit || 20) || 20));
  const startedAt = Date.now();
  let rowsCount = 0;
  console.log("SOCIAL_FAST_LIST_REQUEST", {
    tenant_id: tenantId,
    platform,
    status,
    limit,
    cursor_present: Boolean(cursor),
  });
  try {
    const result = await listSocialCommentCenterFastList({ tenantId, platform, status, limit, cursor });
    rowsCount = Array.isArray(result.items) ? result.items.length : 0;
    console.log("SOCIAL_FAST_LIST_RESULT", {
      tenant_id: tenantId,
      platform,
      status,
      count: rowsCount,
      next_cursor: Boolean(result.next_cursor),
    });
    return res.json({
      success: true,
      items: result.items || [],
      next_cursor: result.next_cursor || "",
    });
  } catch (error) {
    console.log("SOCIAL_FAST_LIST_RESULT", {
      tenant_id: tenantId,
      platform,
      status,
      count: 0,
      next_cursor: false,
      error: error?.message || "",
    });
    return res.status(error?.status || 500).json({ success: false, message: error?.message || "Failed to load social comment fast list" });
  } finally {
    const duration_ms = Date.now() - startedAt;
    console.log("SOCIAL_FAST_LIST_TIMING", {
      tenant_id: tenantId,
      platform,
      status,
      limit,
      duration_ms,
      rows_count: rowsCount,
    });
    if (duration_ms > 150) {
      console.warn("SOCIAL_FAST_LIST_SLOW", {
        tenant_id: tenantId,
        platform,
        status,
        limit,
        duration_ms,
        rows_count: rowsCount,
      });
    }
  }
});

router.get("/jobs/status", protect, permit("settings", "view"), async (_req, res) => {
  try {
    const status = getSocialCommentJobQueueStatus();
    return res.json({
      success: true,
      ...status,
    });
  } catch (error) {
    return res.status(error?.status || 500).json({
      success: false,
      message: error?.message || "Failed to load social comment job queue status",
    });
  }
});

router.get("/jobs/recent", protect, permit("settings", "view"), async (req, res) => {
  try {
    const tenantId = toTenantId(req);
    const limit = Math.min(50, Math.max(1, Number(req.query?.limit || 50) || 50));
    const { listSocialCommentAutomationRuns } = await getSocialCommentAutomationRouteDeps();
    const runs = await listSocialCommentAutomationRuns({ tenantId, limit });
    return res.json({
      success: true,
      items: runs.map((run) => {
        const runtimeMonitor = run.automation_state?.runtime_monitor || {};
        const latencySummary = runtimeMonitor.latency_summary || {};
        return {
          id: run.id || null,
          tenant_id: run.tenant_id || tenantId,
          platform: clean(run.platform || ""),
          post_id: clean(run.post_id || ""),
          comment_id: clean(run.comment_id || ""),
          conversation_id: clean(run.inbox_conversation_id || ""),
          customer_name: clean(run.commenter_name || run.customer_name || ""),
          status: clean(run.status || runtimeMonitor.status || run.public_reply_status || run.dm_status || run.like_status || "queued"),
          public_reply_status: clean(run.public_reply_status || ""),
          private_reply_status: clean(run.dm_status || ""),
          like_status: clean(run.like_status || ""),
          skipped_reason: clean(run.skipped_reason || runtimeMonitor.skipped_reason || ""),
          error_message: clean(run.error_message || run.error_code || runtimeMonitor.error_message || ""),
          webhook_to_enqueue_ms: latencySummary.webhook_to_enqueue_ms ?? null,
          enqueue_to_ai_start_ms: latencySummary.enqueue_to_ai_start_ms ?? null,
          ai_generation_ms: latencySummary.ai_generation_ms ?? null,
          send_ms: latencySummary.send_ms ?? null,
          total_comment_reply_ms: latencySummary.total_comment_reply_ms ?? null,
          latency_trace: runtimeMonitor.latency_trace || {},
          created_at: run.created_at || null,
          updated_at: run.updated_at || null,
        };
      }),
      total: runs.length,
    });
  } catch (error) {
    console.error("SOCIAL_COMMENTS_POST_FEED_ERROR", {
      route: "/api/social-comments/jobs/recent",
      message: error?.message || "Failed to load recent social comment jobs",
      stack: error?.stack || "",
      post_id: "",
    });
    return res.status(error?.status || 500).json({
      success: false,
      message: error?.message || "Failed to load recent social comment jobs",
    });
  }
});

router.get("/performance/summary", protect, permit("settings", "view"), async (_req, res) => {
  try {
    const fastListMetrics = getSocialCommentsPerformanceMetrics();
    const jobStatus = getSocialCommentJobQueueStatus();
    const realtimeMetrics = getSocialRealtimeMetrics();
    return res.json({
      success: true,
      ...fastListMetrics,
      queue_length: jobStatus.queue_length || 0,
      active_jobs: jobStatus.active_jobs || 0,
      job_avg_ms: jobStatus.job_avg_ms || 0,
      job_failed_count: jobStatus.failed_count || 0,
      socket_emit_count: realtimeMetrics.socket_emit_count || 0,
    });
  } catch (error) {
    return res.status(error?.status || 500).json({
      success: false,
      message: error?.message || "Failed to load social comments performance summary",
    });
  }
});

router.get("/debug/run/:id", protect, requireSocialCommentsAdmin, async (req, res) => {
  try {
    const runId = Number(req.params.id || 0) || null;
    if (!runId) {
      return res.status(400).json({ success: false, message: "Invalid run id" });
    }
    const result = await db.query(
      `
      SELECT
        id,
        platform,
        post_id,
        comment_id AS external_comment_id,
        status,
        COALESCE(NULLIF(status, ''), NULLIF(action_taken, ''), NULLIF(public_reply_status, ''), NULLIF(dm_status, ''), '') AS automation_status,
        automation_state,
        public_reply_status,
        dm_status AS private_reply_status,
        created_at,
        processed_at,
        updated_at
      FROM social_comment_automation_runs
      WHERE id = $1::bigint
      LIMIT 1
      `,
      [runId]
    );
    const row = result.rows?.[0] || null;
    if (!row) {
      return res.status(404).json({ success: false, message: "Run not found" });
    }
    return res.json({
      success: true,
      run: {
        id: row.id,
        platform: row.platform,
        post_id: row.post_id,
        external_comment_id: row.external_comment_id,
        status: row.status || "",
        automation_status: row.automation_status || "",
        automation_state: {
          runtime_monitor: row.automation_state?.runtime_monitor || {},
        },
        public_reply_status: row.public_reply_status || "",
        private_reply_status: row.private_reply_status || "",
        created_at: row.created_at || null,
        processed_at: row.processed_at || null,
        updated_at: row.updated_at || null,
      },
    });
  } catch (error) {
    return res.status(error?.status || 500).json({ success: false, message: error?.message || "Failed to load social comment run debug data" });
  }
});

router.get("/debug/by-comment", protect, requireSocialCommentsAdmin, async (req, res) => {
  try {
    const commentId = String(req.query?.comment_id || "").trim();
    if (!commentId) {
      return res.status(400).json({ success: false, message: "comment_id is required" });
    }
    const result = await db.query(
      `
      SELECT
        id,
        platform,
        post_id,
        comment_id AS external_comment_id,
        status,
        COALESCE(NULLIF(status, ''), NULLIF(action_taken, ''), NULLIF(public_reply_status, ''), NULLIF(dm_status, ''), '') AS automation_status,
        automation_state,
        public_reply_status,
        dm_status AS private_reply_status,
        created_at,
        processed_at,
        updated_at
      FROM social_comment_automation_runs
      WHERE comment_id = $1::text
      ORDER BY id DESC
      `,
      [commentId]
    );
    return res.json({
      success: true,
      runs: (result.rows || []).map((row) => ({
        id: row.id,
        platform: row.platform,
        post_id: row.post_id,
        external_comment_id: row.external_comment_id,
        status: row.status || "",
        automation_status: row.automation_status || "",
        automation_state: {
          runtime_monitor: row.automation_state?.runtime_monitor || {},
        },
        public_reply_status: row.public_reply_status || "",
        private_reply_status: row.private_reply_status || "",
        created_at: row.created_at || null,
        processed_at: row.processed_at || null,
        updated_at: row.updated_at || null,
      })),
    });
  } catch (error) {
    return res.status(error?.status || 500).json({ success: false, message: error?.message || "Failed to load social comment debug runs" });
  }
});

router.get("/posts/:postId/comments", protect, permit("settings", "view"), async (req, res) => {
  try {
    const tenantId = toTenantId(req);
    const postId = String(req.params.postId || "").trim();
    const platform = String(req.query?.platform || "").trim();
    debugSocialCommentsWarn("[social-comments:data-debug]", {
      scope: "route",
      tenantId,
      platform,
      incomingPostId: postId,
      query: req.query || {},
    });
    const comments = await listSocialCommentThreadComments({ tenantId, platform, postId });
    const post = await loadSocialCommentPost({ tenantId, platform, postId });
    return res.json({ success: true, post, comments, total: comments.length });
  } catch (error) {
    return res.status(error?.status || 500).json({ success: false, message: error?.message || "Failed to load social comment thread" });
  }
});

router.get("/automation/:postId", protect, permit("settings", "view"), async (req, res) => {
  try {
    const tenantId = toTenantId(req);
    const requestedPostId = String(req.params.postId || "").trim();
    const platform = String(req.query?.platform || req.body?.platform || "").trim();
    const { identity: routeIdentity, post: lookupPost } = await loadAutomationRoutePost({ tenantId, platform, requestedPostId });
    const resolvedPostId = clean(lookupPost?.canonical_post_id || routeIdentity.resolved_post_id || routeIdentity.canonical_post_id || requestedPostId);
    console.info("AUTOMATION_CONFIG_ROUTE_START", {
      tenant_id: tenantId,
      requested_post_id: requestedPostId,
      resolved_post_id: resolvedPostId,
      platform,
    });
    const lookupRow = buildAutomationRouteLookupPost(lookupPost, routeIdentity);
    console.info("AUTOMATION_CONFIG_ROUTE_RESOLVED_POST", {
      tenant_id: tenantId,
      requested_post_id: requestedPostId,
      resolved_post_id: resolvedPostId,
      platform,
      has_lookup_row: Boolean(resolvedPostId),
    });
    const config = await getSocialCommentAutomationConfig({
      tenantId,
      platform,
      postId: resolvedPostId || requestedPostId,
      row: lookupRow,
      post: lookupRow,
      hydratePost: false,
    });
    console.info("AUTOMATION_CONFIG_ROUTE_RESULT", {
      tenant_id: tenantId,
      requested_post_id: requestedPostId,
      resolved_post_id: resolvedPostId,
      platform,
      config_id: config?.id || null,
      enabled: Boolean(config?.enabled),
      template_key: String(config?.template_key || ""),
      source: String(config?.source || ""),
    });
    return res.json({ success: true, config });
  } catch (error) {
    console.error("AUTOMATION_CONFIG_ROUTE_ERROR", {
      tenant_id: toTenantId(req),
      requested_post_id: String(req.params.postId || "").trim(),
      platform: String(req.query?.platform || req.body?.platform || "").trim(),
      message: error?.message || String(error || ""),
      stack: error?.stack || "",
    });
    return res.status(error?.status || 500).json({ success: false, message: error?.message || "Failed to load social comment automation config" });
  }
});

router.put("/automation/:postId", protect, permit("settings", "edit"), async (req, res) => {
  try {
    const tenantId = toTenantId(req);
    const requestedPostId = String(req.params.postId || "").trim();
    const platform = String(req.body?.platform || req.query?.platform || "").trim();
    const { identity: routeIdentity, post: loadedPost } = await loadAutomationRoutePost({ tenantId, platform, requestedPostId });
    const bodyCanonicalPostId = clean(req.body?.canonical_post_id || req.body?.canonicalPostId || req.body?.post_id || req.body?.postId || "");
    const canonicalPostId = clean(
      loadedPost?.canonical_post_id ||
      bodyCanonicalPostId ||
      routeIdentity.canonical_post_id ||
      routeIdentity.resolved_post_id ||
      requestedPostId
    );
    const resolvedPost = buildAutomationRouteLookupPost({
      ...(loadedPost || {}),
      canonical_post_id: canonicalPostId,
      post_id: clean(loadedPost?.post_id || routeIdentity.source_post_id || routeIdentity.resolved_post_id || canonicalPostId),
      source_post_id: clean(loadedPost?.source_post_id || routeIdentity.source_post_id || routeIdentity.resolved_post_id || canonicalPostId),
      platform_post_id: clean(loadedPost?.platform_post_id || routeIdentity.platform_post_id || canonicalPostId),
      permalink_post_id: clean(loadedPost?.permalink_post_id || routeIdentity.permalink_post_id || ""),
    }, routeIdentity);
    const enabledBeforeLookup = await getSocialCommentAutomationConfig({
      tenantId,
      platform,
      postId: canonicalPostId,
      row: resolvedPost,
      post: resolvedPost,
      hydratePost: false,
    }).catch(() => null);
    console.info("AUTOMATION_ENABLE_API_REQUEST", {
      config_id: enabledBeforeLookup?.id || null,
      canonical_post_id: canonicalPostId,
      requested_post_id: requestedPostId,
      resolved_post_id: clean(resolvedPost?.post_id || routeIdentity.resolved_post_id || canonicalPostId),
      enabled_before: Boolean(enabledBeforeLookup?.enabled),
      enabled_after: Object.prototype.hasOwnProperty.call(req.body || {}, "enabled")
        ? Boolean(req.body?.enabled)
        : Boolean(req.body?.settings?.enabled),
      payload_enabled: req.body?.enabled,
      payload_settings_enabled: req.body?.settings?.enabled,
    });
    const config = await upsertSocialCommentAutomationConfig({
      tenantId,
      platform,
      postId: canonicalPostId,
      payload: {
        ...(req.body || {}),
        post_id: canonicalPostId,
        canonical_post_id: canonicalPostId,
        selected_post_id: requestedPostId,
        platform_post_id: resolvedPost?.platform_post_id || req.body?.platform_post_id || req.body?.external_post_id || "",
        source_post_id: resolvedPost?.source_post_id || req.body?.source_post_id || "",
        permalink_post_id: resolvedPost?.permalink_post_id || req.body?.permalink_post_id || "",
        wrapper_post_id: resolvedPost?.wrapper_post_id || req.body?.wrapper_post_id || "",
        internal_post_id: resolvedPost?.internal_post_id || req.body?.internal_post_id || "",
        conversation_id: resolvedPost?.conversation_id || "",
      },
    });
    const savedPostId = String(config?.post_id || canonicalPostId || requestedPostId || "").trim();
    const savedPlatform = String(config?.platform || platform || resolvedPost?.platform || "").trim() || "facebook";
    let readbackConfig = null;
    let readbackError = null;
    readbackConfig = await getSocialCommentAutomationConfig({
      tenantId,
      platform: savedPlatform,
      postId: savedPostId,
      row: resolvedPost,
      post: {
        ...resolvedPost,
        post_id: savedPostId,
        canonical_post_id: canonicalPostId,
      },
      hydratePost: false,
    }).catch((error) => {
      readbackError = error;
      return null;
    });
    if (!readbackConfig) {
      const verifyMessage = readbackError?.message || "Failed to verify saved automation config";
      console.warn("SOCIAL_COMMENT_AUTOMATION_SAVE_VERIFY_FAILED", {
        requested_post_id: requestedPostId,
        resolved_post_id: clean(resolvedPost?.post_id || routeIdentity.resolved_post_id || savedPostId),
        canonical_post_id: canonicalPostId,
        message: verifyMessage,
      });
      return res.json({
        success: true,
        config: {
          ...(config || {}),
          post_id: savedPostId,
          canonical_post_id: canonicalPostId,
        },
        warning: verifyMessage,
      });
    }
    console.info("AUTOMATION_ENABLE_DB_READBACK", {
      config_id: readbackConfig?.id || null,
      canonical_post_id: canonicalPostId,
      enabled_before: Boolean(enabledBeforeLookup?.enabled),
      enabled_after: Boolean(readbackConfig?.enabled),
    });
    console.log("AUTOMATION_CONFIG_SAVED", {
      config_id: readbackConfig?.id || config?.id || null,
      tenant_id: tenantId,
      platform: savedPlatform,
      saved_post_id: savedPostId,
      enabled: Boolean(readbackConfig?.enabled),
      template_key: String(readbackConfig?.template_key || ""),
      settings: readbackConfig?.settings || {},
      message_templates: readbackConfig?.message_templates || {},
      selected_post_id: requestedPostId,
      canonical_post_id: canonicalPostId,
      conversation_id: String(resolvedPost?.conversation_id || resolvedPost?.external_conversation_id || ""),
    });
    console.log("AUTOMATION_CONFIG_READBACK", {
      config_id: readbackConfig?.id || null,
      tenant_id: tenantId,
      platform,
      saved_post_id: savedPostId,
      enabled: Boolean(readbackConfig?.enabled),
      template_key: String(readbackConfig?.template_key || ""),
      settings: readbackConfig?.settings || {},
      message_templates: readbackConfig?.message_templates || {},
    });
    return res.json({ success: true, config: readbackConfig });
  } catch (error) {
    return res.status(error?.status || 500).json({ success: false, message: error?.message || "Failed to save social comment automation config" });
  }
});

router.get("/automation/:postId/runs", protect, permit("settings", "view"), async (req, res) => {
  try {
    const tenantId = toTenantId(req);
    const requestedPostId = String(req.params.postId || "").trim();
    const platform = String(req.query?.platform || req.body?.platform || "").trim();
    const limit = Math.min(50, Math.max(1, Number(req.query?.limit || 20) || 20));
    const { identity: routeIdentity, post } = await loadAutomationRoutePost({ tenantId, platform, requestedPostId });
    const postId = String(post?.canonical_post_id || routeIdentity.canonical_post_id || routeIdentity.resolved_post_id || requestedPostId || "").trim();
    const { listSocialCommentAutomationRuns } = await getSocialCommentAutomationRouteDeps();
    const runs = await listSocialCommentAutomationRuns({ tenantId, platform, postId, limit });
    return res.json({
      success: true,
      items: runs.map((run) => {
        const runtimeMonitor = run.automation_state?.runtime_monitor || {};
        const status = run.status || run.automation_state?.runtime_monitor?.status || "skipped";
        const skippedReason = run.skipped_reason || runtimeMonitor.skipped_reason || "";
        const matchedConfigKey = run.matched_config_key || runtimeMonitor.matched_config_key || "";
        const resolvedPostId = run.resolved_post_id || runtimeMonitor.resolved_post_id || run.post_id || "";
        const resolvedPlatformPostId = run.resolved_platform_post_id || runtimeMonitor.resolved_platform_post_id || run.post_id || "";
        const resolvedProductId = run.resolved_product_id ?? runtimeMonitor.resolved_product_id ?? null;
        const duplicateReason = run.duplicate_reason || runtimeMonitor.duplicate_reason || "";
        const configFound = Boolean(run.config_found ?? runtimeMonitor.config_found ?? false);
        const configEnabled = Boolean(run.config_enabled ?? runtimeMonitor.config_enabled ?? false);
        return {
          id: run.id,
          tenant_id: run.tenant_id,
          post_id: run.post_id,
          comment_id: run.comment_id,
          platform: run.platform,
          config_id: run.config_id || null,
          status,
          step_results: run.step_results || run.automation_state?.runtime_monitor?.step_results || [],
          error_message: run.error_message || run.error_code || "",
          customer_name: run.commenter_name || run.customer_name || "",
          skipped_reason: skippedReason,
          matched_config_key: matchedConfigKey,
          resolved_post_id: resolvedPostId,
          resolved_platform_post_id: resolvedPlatformPostId,
          resolved_product_id: resolvedProductId,
          duplicate_reason: duplicateReason,
          config_found: configFound,
          config_enabled: configEnabled,
          product_link: run.product_link || run.automation_state?.runtime_monitor?.product_link || "",
          checkout_link: run.checkout_link || run.automation_state?.runtime_monitor?.checkout_link || "",
          guidance_mode: run.guidance_mode || run.automation_state?.runtime_monitor?.guidance_mode || "",
          raw_runtime_context: runtimeMonitor.raw_runtime_context || runtimeMonitor || {},
          runtime_monitor: runtimeMonitor,
          would_run: Boolean(run.would_run ?? run.automation_state?.runtime_monitor?.would_run ?? (status !== "duplicate_skipped" && skippedReason !== "duplicate_comment_automation")),
          created_at: run.created_at || null,
          updated_at: run.updated_at || null,
        };
      }),
      total: runs.length,
    });
  } catch (error) {
    return res.status(error?.status || 500).json({ success: false, message: error?.message || "Failed to load social comment automation runs" });
  }
});

router.post("/automation/:postId/test", protect, permit("settings", "view"), async (req, res) => {
  try {
    const tenantId = toTenantId(req);
    const requestedPostId = String(req.params.postId || "").trim();
    const platform = String(req.body?.platform || req.query?.platform || "").trim();
    const { identity: routeIdentity, post } = await loadAutomationRoutePost({ tenantId, platform, requestedPostId });
    const postId = String(post?.canonical_post_id || routeIdentity.canonical_post_id || routeIdentity.resolved_post_id || requestedPostId || "").trim();
    const { testSocialCommentAutomationRuntime } = await getSocialCommentAutomationRouteDeps();
    const result = await testSocialCommentAutomationRuntime({ tenantId, platform, postId });
    return res.json({ success: true, result });
  } catch (error) {
    return res.status(error?.status || 500).json({ success: false, message: error?.message || "Failed to test social comment automation" });
  }
});

router.get("/posts/:postId/product-links", protect, permit("settings", "view"), async (req, res) => {
  try {
    const tenantId = toTenantId(req);
    const requestedPostId = String(req.params.postId || "").trim();
    const platform = String(req.query?.platform || req.body?.platform || "").trim();
    const requestedPostLinkKey = clean(req.query?.post_link_key || req.body?.post_link_key || "");
    const post = await loadSocialCommentPost({ tenantId, platform, postId: requestedPostId }).catch(() => null);
    const { merged: resolvedPost } = buildManualLinkPostContext(req, post || {}, requestedPostId);
    const productLinkIdentity = resolveSocialPostLinkKey({
      tenant_id: tenantId,
      platform,
      ...resolvedPost,
      ...post,
      selected_post_id: requestedPostId,
    });
    const canonicalPostId = String(productLinkIdentity.canonical_post_id || requestedPostId || "").trim();
    const feedPostLinkKey = clean(requestedPostLinkKey || post?.post_link_key || productLinkIdentity.post_link_key || requestedPostId || "");
    const mapping = await getPostProductLinksV2({
      tenantId,
      platform,
      post: resolvedPost || {},
      postId: requestedPostId,
      postLinkKey: feedPostLinkKey,
      selectedPostId: requestedPostId,
      aliasPostLinkKeys: [requestedPostId, productLinkIdentity.post_link_key],
    });
    if (requestedPostId && feedPostLinkKey && requestedPostId !== feedPostLinkKey) {
      const aliasMapping = await getPostProductLinksV2({
        tenantId,
        platform,
        post: resolvedPost || {},
        postId: requestedPostId,
        postLinkKey: requestedPostId,
        selectedPostId: requestedPostId,
      }).catch(() => null);
      console.info("SOCIAL_V2_LINK_KEY_MISMATCH_TRACE", {
        post_title: clean(post?.title || post?.caption || post?.message || resolvedPost?.title || resolvedPost?.caption || resolvedPost?.message || ""),
        feed_post_id: clean(post?.id || post?.post_id || post?.platform_post_id || requestedPostId || ""),
        feed_post_link_key: feedPostLinkKey,
        drawer_post_link_key: requestedPostId,
        selected_post_id: requestedPostId,
        permalink_url: clean(post?.permalink_url || resolvedPost?.permalink_url || ""),
        v2_rows_for_feed_key: Array.isArray(mapping?.product_ids) ? mapping.product_ids.length : 0,
        v2_rows_for_alias_keys: Array.isArray(aliasMapping?.product_ids) ? aliasMapping.product_ids.length : 0,
      });
    }
    const responseProductIds = Array.isArray(mapping?.product_ids) ? mapping.product_ids : [];
    return res.json({
      success: true,
      linked_products: mapping?.linked_products || [],
      primary_product: mapping?.primary_product || null,
      count: Number(mapping?.count || 0) || 0,
      product_ids: responseProductIds,
      rows_affected: Number(mapping?.rows_affected || 0),
      post_id: feedPostLinkKey,
      product_link_identity: productLinkIdentity,
      selected_post_id: requestedPostId,
      canonical_post_id: canonicalPostId,
      linked_products_source: mapping?.linked_products_source || (Array.isArray(mapping?.linked_products) && mapping.linked_products.length ? "v2" : "none"),
      rejected_sources: mapping?.rejected_sources || [],
      saved_platform_post_id: String(mapping?.post_link_key || post?.platform_post_id || post?.post_id || requestedPostId || "").trim(),
      primary_product_name: String(mapping?.primary_product?.name || mapping?.primary_product?.title || mapping?.primary_product?.product_name || "").trim(),
      platform: String(mapping?.platform || platform || "facebook").trim() || "facebook",
      post_link_key: feedPostLinkKey,
      post_identity: {
        platform_post_id: clean(productLinkIdentity.platform_post_id || resolvedPost?.platform_post_id || ""),
        source_post_id: clean(productLinkIdentity.source_post_id || resolvedPost?.source_post_id || ""),
        permalink_post_id: clean(productLinkIdentity.permalink_post_id || resolvedPost?.permalink_post_id || ""),
        canonical_post_id: clean(productLinkIdentity.canonical_post_id || canonicalPostId || ""),
        post_id: clean(productLinkIdentity.post_id || resolvedPost?.post_id || ""),
        object_id: clean(productLinkIdentity.object_id || resolvedPost?.object_id || ""),
      },
    });
  } catch (error) {
    return res.status(error?.status || 500).json({ success: false, message: error?.message || "Failed to load product links" });
  }
});

router.put("/posts/:postId/product-links", protect, permit("settings", "edit"), async (req, res) => {
  try {
    const tenantId = toTenantId(req);
    const requestedPostId = String(req.params.postId || "").trim();
    const platform = String(req.body?.platform || req.query?.platform || "").trim();
    const rawProductIds = Array.isArray(req.body?.product_ids)
      ? req.body.product_ids
      : Array.isArray(req.body?.productIds)
        ? req.body.productIds
        : Array.isArray(req.body?.products)
          ? req.body.products
          : [];
    const productIds = rawProductIds
      .map((item) => {
        if (item && typeof item === "object") {
          return Number(item.id ?? item.product_id ?? item.productId ?? 0) || 0;
        }
        return Number(item) || 0;
      })
      .filter((value) => Number.isFinite(value) && value > 0);
    const primaryProductId = req.body?.primary_product_id ?? req.body?.primaryProductId ?? null;
    const requestedPostLinkKey = clean(req.body?.post_link_key || req.query?.post_link_key || "");
    const post = await loadSocialCommentPost({ tenantId, platform, postId: requestedPostId }).catch(() => null);
    const { identity: manualIdentity, merged: resolvedPost } = buildManualLinkPostContext(req, post || {}, requestedPostId);
    const productLinkIdentity = resolveSocialPostLinkKey({
      tenant_id: tenantId,
      platform,
      ...resolvedPost,
      ...post,
      selected_post_id: requestedPostId,
    });
    const canonicalPostId = clean(normalizeAutomationRoutePostId(productLinkIdentity.canonical_post_id || manualIdentity.canonical_post_id || requestedPostId || ""));
    const feedPostLinkKey = clean(requestedPostLinkKey || post?.post_link_key || productLinkIdentity.post_link_key || canonicalPostId || requestedPostId || "");
    console.info("POST_PRODUCT_LINKS_SAVE_REQUEST", {
      tenant_id: tenantId,
      platform: String(platform || "").trim() || "facebook",
      selected_post_id: requestedPostId,
      canonical_post_id: canonicalPostId,
      platform_post_id: clean(manualIdentity.platform_post_id || resolvedPost?.platform_post_id || ""),
      source_post_id: clean(manualIdentity.source_post_id || resolvedPost?.source_post_id || ""),
      permalink_post_id: clean(manualIdentity.permalink_post_id || resolvedPost?.permalink_post_id || ""),
      object_id: clean(manualIdentity.object_id || resolvedPost?.object_id || ""),
      post_id: clean(manualIdentity.post_id || resolvedPost?.post_id || ""),
      product_ids: productIds,
      primary_product_id: primaryProductId,
      product_link_key: feedPostLinkKey,
    });
    const mapping = await savePostProductLinksV2({
      tenantId,
      platform,
      postId: requestedPostId,
      postLinkKey: feedPostLinkKey,
      selectedPostId: requestedPostId,
      post: resolvedPost || {},
      aliasPostLinkKeys: [requestedPostId, productLinkIdentity.post_link_key],
      productIds,
      primaryProductId,
    });
    const legacyMapping = await saveMappings({
      tenantId,
      platform,
      postId: requestedPostId,
      selectedPostId: requestedPostId,
      row: resolvedPost || {},
      post: resolvedPost || {},
      productIds,
      primaryProductId,
      userId: req.user?.id || null,
    }).catch((error) => {
      console.error("SOCIAL_PRODUCT_LINK_LEGACY_SAVE_ERROR", {
        tenant_id: tenantId,
        platform: String(platform || "").trim() || "facebook",
        requested_post_id: requestedPostId,
        canonical_post_id: canonicalPostId,
        post_link_key: feedPostLinkKey,
        message: error?.message || String(error),
      });
      return null;
    });
    if (requestedPostId && feedPostLinkKey && requestedPostId !== feedPostLinkKey) {
      const aliasMapping = await getPostProductLinksV2({
        tenantId,
        platform,
        post: resolvedPost || {},
        postId: requestedPostId,
        postLinkKey: requestedPostId,
        selectedPostId: requestedPostId,
      }).catch(() => null);
      console.info("SOCIAL_V2_LINK_KEY_MISMATCH_TRACE", {
        post_title: clean(post?.title || post?.caption || post?.message || resolvedPost?.title || resolvedPost?.caption || resolvedPost?.message || ""),
        feed_post_id: clean(post?.id || post?.post_id || post?.platform_post_id || requestedPostId || ""),
        feed_post_link_key: feedPostLinkKey,
        drawer_post_link_key: requestedPostId,
        selected_post_id: requestedPostId,
        permalink_url: clean(post?.permalink_url || resolvedPost?.permalink_url || ""),
        v2_rows_for_feed_key: Array.isArray(mapping?.product_ids) ? mapping.product_ids.length : 0,
        v2_rows_for_alias_keys: Array.isArray(aliasMapping?.product_ids) ? aliasMapping.product_ids.length : 0,
      });
    }
    const rowsAffected = Number(mapping?.rows_affected || 0) || 0;
    const responseProductIds = Array.isArray(mapping?.product_ids) ? mapping.product_ids : productIds;
    console.info("SOCIAL_PRODUCT_LINK_SAVE_READBACK", {
      tenant_id: tenantId,
      platform: String(platform || "").trim() || "facebook",
      requested_post_id: requestedPostId,
      canonical_post_id: canonicalPostId,
      post_link_key: feedPostLinkKey,
      product_ids: responseProductIds,
      v2_rows_count: Number(mapping?.count || mapping?.linked_products?.length || 0) || 0,
      legacy_rows_count: Number(legacyMapping?.count || legacyMapping?.linked_products?.length || 0) || 0,
      saved_table: legacyMapping ? "social_post_product_links_v2+marketing_post_product_links" : "social_post_product_links_v2",
    });
    console.info("POST_PRODUCT_LINK_IDENTITY_TRACE", {
      ...buildPostIdentityTrace({
        tenantId,
        platform,
        selectedPostId: requestedPostId,
        canonicalPostId,
        platformPostId: mapping?.post_link_key || post?.platform_post_id || post?.post_id || requestedPostId || "",
        row: post || {},
        post: post || {},
        matchedMappingKey: mapping?.matched_mapping_key || "",
        productIds: responseProductIds,
        rowsAffected,
      }),
      candidate_post_ids: [],
    });
    console.info("POST_PRODUCT_LINKS_SAVED", {
      tenant_id: tenantId,
      platform: String(platform || post?.platform || "facebook").trim() || "facebook",
      selected_post_id: requestedPostId,
      canonical_post_id: canonicalPostId,
      saved_platform_post_id: String(mapping?.post_link_key || post?.platform_post_id || post?.post_id || requestedPostId || "").trim(),
      product_ids: responseProductIds,
      rows_affected: Number(rowsAffected || 0),
      readback_count: Number(mapping?.count || 0) || 0,
      hydrated_products_count: Number(mapping?.linked_products?.length || 0) || 0,
      product_link_key: feedPostLinkKey,
    });
    console.info("POST_PRODUCT_LINKS_READBACK", {
      tenant_id: tenantId,
      platform: String(mapping?.platform || platform || "facebook").trim() || "facebook",
      selected_post_id: requestedPostId,
      canonical_post_id: canonicalPostId,
      saved_platform_post_id: String(mapping?.post_id || post?.platform_post_id || post?.post_id || requestedPostId || "").trim(),
      product_ids: responseProductIds,
      rows_affected: Number(rowsAffected || 0),
      readback_count: Number(mapping?.count || 0) || 0,
      hydrated_products_count: Number(mapping?.linked_products?.length || 0) || 0,
      product_link_key: feedPostLinkKey,
    });
    return res.json({
      success: true,
      linked_products: mapping?.linked_products || [],
      primary_product: mapping?.primary_product || null,
      count: Number(mapping?.count || 0) || 0,
      linked_products_source: mapping?.linked_products_source || (Array.isArray(mapping?.linked_products) && mapping.linked_products.length ? "v2" : "none"),
      rejected_sources: mapping?.rejected_sources || [],
      product_ids: responseProductIds,
      rows_affected: Number(rowsAffected || 0),
      post_id: feedPostLinkKey,
      product_link_identity: productLinkIdentity,
      selected_post_id: requestedPostId,
      canonical_post_id: canonicalPostId,
      saved_platform_post_id: String(mapping?.post_id || post?.platform_post_id || post?.post_id || requestedPostId || "").trim(),
      primary_product_name: String(mapping?.primary_product?.name || mapping?.primary_product?.title || mapping?.primary_product?.product_name || "").trim(),
      platform: String(mapping?.platform || platform || "facebook").trim() || "facebook",
      post_link_key: feedPostLinkKey,
      post_identity: {
        platform_post_id: clean(productLinkIdentity.platform_post_id || resolvedPost?.platform_post_id || ""),
        source_post_id: clean(productLinkIdentity.source_post_id || resolvedPost?.source_post_id || ""),
        permalink_post_id: clean(productLinkIdentity.permalink_post_id || resolvedPost?.permalink_post_id || ""),
        canonical_post_id: clean(productLinkIdentity.canonical_post_id || canonicalPostId || ""),
        post_id: clean(productLinkIdentity.post_id || resolvedPost?.post_id || ""),
        object_id: clean(productLinkIdentity.object_id || resolvedPost?.object_id || ""),
      },
    });
  } catch (error) {
    return res.status(error?.status || 500).json({ success: false, message: error?.message || "Failed to save product links" });
  }
});

router.delete("/posts/:postId/product-links", protect, permit("settings", "edit"), async (req, res) => {
  try {
    const tenantId = toTenantId(req);
    const requestedPostId = String(req.params.postId || "").trim();
    const platform = String(req.body?.platform || req.query?.platform || "").trim();
    const requestedPostLinkKey = clean(req.body?.post_link_key || req.query?.post_link_key || "");
    const post = await loadSocialCommentPost({ tenantId, platform, postId: requestedPostId }).catch(() => null);
    const { merged: resolvedPost } = buildManualLinkPostContext(req, post || {}, requestedPostId);
    const productLinkIdentity = resolveSocialPostLinkKey({
      tenant_id: tenantId,
      platform,
      ...resolvedPost,
      ...post,
      selected_post_id: requestedPostId,
    });
    const postId = clean(requestedPostLinkKey || post?.post_link_key || productLinkIdentity.post_link_key || normalizeAutomationRoutePostId(post?.canonical_post_id || post?.post_id || requestedPostId || ""));
    const productId = req.body?.product_id ?? req.body?.productId ?? req.query?.product_id ?? req.query?.productId ?? null;
    const mapping = await removePostProductLinksV2({
      tenantId,
      platform,
      postId,
      post: resolvedPost || {},
      productId,
    });
    return res.json({
      success: true,
      linked_products: mapping?.linked_products || [],
      primary_product: mapping?.primary_product || null,
      count: Number(mapping?.count || 0) || 0,
      post_id: postId,
      platform: String(mapping?.platform || platform || "facebook").trim() || "facebook",
    });
  } catch (error) {
    return res.status(error?.status || 500).json({ success: false, message: error?.message || "Failed to remove product links" });
  }
});

router.get("/auto-reply/settings", protect, permit("settings", "view"), async (req, res) => {
  try {
    const tenantId = toTenantId(req);
    const settings = await getSocialAutoReplySettings({ tenantId });
    return res.json({ success: true, settings });
  } catch (error) {
    return res.status(error?.status || 500).json({ success: false, message: error?.message || "Failed to load auto reply settings" });
  }
});

router.post("/auto-reply/settings", protect, permit("settings", "edit"), async (req, res) => {
  try {
    const tenantId = toTenantId(req);
    const settings = await saveSocialAutoReplySettings({ tenantId, payload: req.body || {} });
    return res.json({ success: true, settings });
  } catch (error) {
    return res.status(error?.status || 500).json({ success: false, message: error?.message || "Failed to save auto reply settings" });
  }
});

router.get("/posts/:postId/template", protect, permit("settings", "view"), async (req, res) => {
  try {
    const tenantId = toTenantId(req);
    const postId = String(req.params.postId || "").trim();
    const platform = String(req.query?.platform || "").trim();
    const template = await getSocialPostAutoReplyTemplate({ tenantId, platform, postId });
    return res.json({ success: true, template });
  } catch (error) {
    return res.status(error?.status || 500).json({ success: false, message: error?.message || "Failed to load post auto reply template" });
  }
});

router.post("/posts/:postId/template", protect, permit("settings", "edit"), async (req, res) => {
  try {
    const tenantId = toTenantId(req);
    const postId = String(req.params.postId || "").trim();
    const platform = String(req.body?.platform || req.query?.platform || "").trim();
    const template = await saveSocialPostAutoReplyTemplate({ tenantId, platform, postId, payload: req.body || {} });
    return res.json({ success: true, template });
  } catch (error) {
    return res.status(error?.status || 500).json({ success: false, message: error?.message || "Failed to save post auto reply template" });
  }
});

router.post("/comments/:commentId/auto-reply-preview", protect, permit("settings", "view"), async (req, res) => {
  try {
    const tenantId = toTenantId(req);
    const commentId = String(req.params.commentId || "").trim();
    const platform = String(req.body?.platform || req.query?.platform || "").trim();
    const postId = String(req.body?.post_id || req.query?.post_id || "").trim();
    const comment = await getSocialCommentCommentByCommentId({ tenantId, platform, commentId });
    if (!comment) return res.status(404).json({ success: false, message: "Comment not found" });
    const post = postId ? await loadSocialCommentPost({ tenantId, platform, postId }) : await loadSocialCommentPost({ tenantId, platform, postId: comment.session_id ? String(comment.session_id).split(":").slice(1).join(":") : "" });
    const settings = await getSocialAutoReplySettings({ tenantId });
    const template = postId ? await getSocialPostAutoReplyTemplate({ tenantId, platform, postId }) : null;
    const preview = await processSocialCommentAutoReply({
      tenantId,
      platform,
      postId: postId || post?.metadata?.post_id || "",
      comment,
      post,
      settings,
      template,
      force: false,
    });
    return res.json({ success: true, preview });
  } catch (error) {
    return res.status(error?.status || 500).json({ success: false, message: error?.message || "Failed to preview auto reply" });
  }
});

router.post("/comments/:commentId/auto-reply-send", protect, permit("settings", "edit"), async (req, res) => {
  try {
    const tenantId = toTenantId(req);
    const commentId = String(req.params.commentId || "").trim();
    const platform = String(req.body?.platform || req.query?.platform || "").trim();
    const postId = String(req.body?.post_id || req.query?.post_id || "").trim();
    const force = req.body?.force === true;
    const comment = await getSocialCommentCommentByCommentId({ tenantId, platform, commentId });
    if (!comment) return res.status(404).json({ success: false, message: "Comment not found" });
    const post = postId ? await loadSocialCommentPost({ tenantId, platform, postId }) : await loadSocialCommentPost({ tenantId, platform, postId: comment.session_id ? String(comment.session_id).split(":").slice(1).join(":") : "" });
    const settings = await getSocialAutoReplySettings({ tenantId });
    const template = postId ? await getSocialPostAutoReplyTemplate({ tenantId, platform, postId }) : null;
    const result = await processSocialCommentAutoReply({
      tenantId,
      platform,
      postId: postId || post?.metadata?.post_id || "",
      comment,
      post,
      settings,
      template,
      force,
    });
    return res.json({ success: true, result });
  } catch (error) {
    return res.status(error?.status || 500).json({ success: false, message: error?.message || "Failed to send auto reply" });
  }
});

router.post("/comments/:commentId/ignore", protect, permit("settings", "edit"), async (req, res) => {
  try {
    const tenantId = toTenantId(req);
    const commentId = String(req.params.commentId || "").trim();
    const platform = String(req.body?.platform || req.query?.platform || "").trim();
    const postId = String(req.body?.post_id || req.query?.post_id || "").trim();
    const result = await ignoreSocialComment({ tenantId, platform, postId, commentId, reason: req.body?.reason || "ignored" });
    return res.json({ success: true, result });
  } catch (error) {
    return res.status(error?.status || 500).json({ success: false, message: error?.message || "Failed to ignore comment" });
  }
});

const handleEnrichPostMediaDebug = async (req, res) => {
  try {
    const tenantId = toTenantId(req);
    const platform = String(req.query?.platform || req.body?.platform || "").trim();
    console.log("[social-comments-enrich-post-media-route-hit]", {
      tenant_id: tenantId,
      platform,
      limit: req.query?.limit || req.body?.limit || 200,
    });
    const result = await backfillSocialCommentPostMedia({
      tenantId,
      platform,
      limit: req.query?.limit || req.body?.limit || 200,
    });
    return res.json({ success: true, ...result });
  } catch (error) {
    console.error("[social-comments-enrich-post-media:error]", {
      message: error?.message || String(error),
      stack: error?.stack || "",
    });
    return res.status(error?.status || 500).json({ success: false, message: error?.message || "Failed to enrich social comment post media" });
  }
};

debugRouter.get("/enrich-post-media", handleEnrichPostMediaDebug);
debugRouter.post("/enrich-post-media", handleEnrichPostMediaDebug);

debugRouter.post("/ensure-schema", async (_req, res) => {
  try {
    const before = await db.query(`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'social_comment_auto_reply_runs'
          AND column_name = 'reply_status'
      ) AS reply_status_exists
    `);
    await ensureSocialCommentsCenterSchema().catch(() => {});
    const after = await db.query(`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'social_comment_auto_reply_runs'
          AND column_name = 'reply_status'
      ) AS reply_status_exists
    `);
    return res.json({
      success: true,
      applied: Boolean(!before.rows?.[0]?.reply_status_exists && after.rows?.[0]?.reply_status_exists),
      columns_checked: ["social_comment_auto_reply_runs.reply_status"],
      reply_status_exists: Boolean(after.rows?.[0]?.reply_status_exists),
    });
  } catch (error) {
    return res.status(error?.status || 500).json({ success: false, message: error?.message || "Failed to ensure social comments schema" });
  }
});

export default router;
export { debugRouter as socialCommentsDebugRoutes };
