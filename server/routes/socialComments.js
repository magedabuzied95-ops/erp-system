import express from "express";
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
  getMappings as getPostProductMappings,
  removeMapping as removePostProductMapping,
  saveMappings as savePostProductMappings,
} from "../services/postProductMappingService.js";
import postProductMappingService from "../services/postProductMappingService.js";
import { getSocialRealtimeMetrics } from "../services/socialRealtimeService.js";
import {
  listRecentSocialCommentAutomationRuns as listSocialCommentAutomationRuns,
  testSocialCommentAutomationRuntime,
} from "../services/socialCommentAutomationService.js";

const router = express.Router();
const debugRouter = express.Router();
const buildPostIdentityTrace = postProductMappingService.buildPostIdentityTrace || ((payload = {}) => payload);
const isSocialCommentsDebugEnabled = () => String(process.env.DEBUG_SOCIAL_COMMENTS || "").toLowerCase() === "true";
const debugSocialCommentsWarn = (...args) => {
  if (isSocialCommentsDebugEnabled()) console.warn(...args);
};
let socialCommentsSchemaReadyPromise = null;
const ensureSocialCommentsSchemaReady = () => {
  if (!socialCommentsSchemaReadyPromise) {
    socialCommentsSchemaReadyPromise = ensureSocialCommentsCenterSchema().catch((error) => {
      socialCommentsSchemaReadyPromise = null;
      throw error;
    });
  }
  return socialCommentsSchemaReadyPromise;
};

const toTenantId = (req) => Number(req.query?.tenant_id || req.body?.tenant_id || req.headers["x-tenant-id"] || 1) || 1;
const normalizeAutomationRoutePostId = (value = "") => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return raw
    .replace(/^(social_comment|facebook_comment|instagram_comment|facebook_post|instagram_post):/i, "")
    .replace(/^(facebook|instagram):/i, "")
    .trim();
};
const clean = (value = "") => String(value ?? "").trim();
const buildManualLinkPostContext = (req, post = {}) => {
  const identityObject = req.body?.post_identity && typeof req.body.post_identity === "object" && !Array.isArray(req.body.post_identity)
    ? req.body.post_identity
    : req.query?.post_identity && typeof req.query.post_identity === "object" && !Array.isArray(req.query.post_identity)
      ? req.query.post_identity
      : {};
  const identity = {
    ...identityObject,
    platform_post_id: clean(identityObject.platform_post_id || req.body?.platform_post_id || req.query?.platform_post_id || ""),
    source_post_id: clean(identityObject.source_post_id || req.body?.source_post_id || req.query?.source_post_id || ""),
    permalink_post_id: clean(identityObject.permalink_post_id || req.body?.permalink_post_id || req.query?.permalink_post_id || ""),
    canonical_post_id: clean(identityObject.canonical_post_id || req.body?.canonical_post_id || req.query?.canonical_post_id || ""),
    post_id: clean(identityObject.post_id || req.body?.post_identity_post_id || req.query?.post_identity_post_id || req.body?.post_id || req.query?.post_id || ""),
    object_id: clean(identityObject.object_id || req.body?.object_id || req.query?.object_id || ""),
  };
  const merged = {
    ...(post || {}),
    platform_post_id: clean(identity.platform_post_id || post?.platform_post_id || ""),
    source_post_id: clean(identity.source_post_id || post?.source_post_id || ""),
    permalink_post_id: clean(identity.permalink_post_id || post?.permalink_post_id || ""),
    object_id: clean(identity.object_id || post?.object_id || ""),
    canonical_post_id: clean(identity.canonical_post_id || post?.canonical_post_id || ""),
    post_id: clean(identity.post_id || post?.post_id || ""),
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
    const posts = await listSocialCommentPosts({ tenantId, platform, limit: req.query?.limit || 50 });
    console.log("AI_POST_TIME_PAYLOAD", {
      tenant_id: tenantId,
      platform,
      sample: posts.slice(0, 5).map((post) => ({
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
        total: posts.length,
        sample: posts.slice(0, 3).map((post) => ({
          post_id: post.post_id || post.conversation_id || "",
          has_thumbnail: Boolean(post.has_thumbnail),
          thumbnail_source: post.thumbnail_source || "",
          graph_enriched: Boolean(post.graph_enriched),
          reason_if_missing: post.reason_if_missing || "",
        })),
      });
    }
    return res.json({ success: true, posts, total: posts.length });
  } catch (error) {
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
    const resolvedPostId = normalizeAutomationRoutePostId(requestedPostId);
    console.info("AUTOMATION_CONFIG_ROUTE_START", {
      tenant_id: tenantId,
      requested_post_id: requestedPostId,
      resolved_post_id: resolvedPostId,
      platform,
    });
    const lookupRow = resolvedPostId
      ? {
          post_id: resolvedPostId,
          canonical_post_id: resolvedPostId,
          metadata: { post_id: resolvedPostId },
        }
      : {};
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
    const post = await loadSocialCommentPost({ tenantId, platform, postId: requestedPostId }).catch(() => null);
    const canonicalPostId = String(post?.canonical_post_id || post?.post_id || post?.automation_run_post_id || post?.conversation_id || requestedPostId || "").trim();
    const enabledBeforeLookup = await getSocialCommentAutomationConfig({
      tenantId,
      platform,
      postId: canonicalPostId,
      row: post || {},
      post: post || {},
      hydratePost: false,
    }).catch(() => null);
    console.info("AUTOMATION_ENABLE_API_REQUEST", {
      config_id: enabledBeforeLookup?.id || null,
      canonical_post_id: canonicalPostId,
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
        platform_post_id: post?.platform_post_id || req.body?.platform_post_id || req.body?.external_post_id || "",
        wrapper_post_id: post?.wrapper_post_id || req.body?.wrapper_post_id || "",
        internal_post_id: post?.internal_post_id || req.body?.internal_post_id || "",
        conversation_id: post?.conversation_id || "",
      },
    });
    const savedPostId = String(config?.post_id || canonicalPostId || requestedPostId || "").trim();
    const savedPlatform = String(config?.platform || platform || post?.platform || "").trim() || "facebook";
    const readbackConfig = await getSocialCommentAutomationConfig({
      tenantId,
      platform: savedPlatform,
      postId: savedPostId,
      row: post || {},
      post: {
        ...(post || {}),
        post_id: savedPostId,
        canonical_post_id: canonicalPostId,
      },
      hydratePost: false,
    });
    if (!readbackConfig) {
      throw Object.assign(new Error("Failed to verify saved automation config"), { status: 500 });
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
      conversation_id: String(post?.conversation_id || post?.external_conversation_id || ""),
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
    const post = await loadSocialCommentPost({ tenantId, platform, postId: requestedPostId }).catch(() => null);
    const postId = String(post?.canonical_post_id || post?.post_id || post?.automation_run_post_id || post?.conversation_id || requestedPostId || "").trim();
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
    const post = await loadSocialCommentPost({ tenantId, platform, postId: requestedPostId }).catch(() => null);
    const postId = String(post?.canonical_post_id || post?.post_id || post?.automation_run_post_id || post?.conversation_id || requestedPostId || "").trim();
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
    const post = await loadSocialCommentPost({ tenantId, platform, postId: requestedPostId }).catch(() => null);
    const { merged: resolvedPost } = buildManualLinkPostContext(req, post || {});
    const canonicalPostId = String(post?.canonical_post_id || post?.post_id || post?.automation_run_post_id || post?.conversation_id || requestedPostId || "").trim();
    const postId = canonicalPostId;
    const mapping = await getPostProductMappings({ tenantId, platform, postId, selectedPostId: requestedPostId, row: resolvedPost || {}, post: resolvedPost || {} });
    const responseProductIds = Array.isArray(mapping?.product_ids)
      ? mapping.product_ids
      : Array.isArray(mapping?.linked_products)
        ? mapping.linked_products.map((item) => item.product_id || item.id || null).filter(Boolean)
        : [];
    return res.json({
      success: true,
      linked_products: mapping?.linked_products || [],
      primary_product: mapping?.primary_product || null,
      count: Number(mapping?.count || 0) || 0,
      product_ids: responseProductIds,
      rows_affected: Number(mapping?.rows_affected || 0),
      post_id: postId,
      selected_post_id: requestedPostId,
      canonical_post_id: canonicalPostId,
      saved_platform_post_id: String(mapping?.post_id || post?.platform_post_id || post?.post_id || requestedPostId || "").trim(),
      primary_product_name: String(mapping?.primary_product?.name || mapping?.primary_product?.title || mapping?.primary_product?.product_name || "").trim(),
      platform: String(mapping?.platform || platform || "facebook").trim() || "facebook",
      post_identity: {
        platform_post_id: clean(resolvedPost?.platform_post_id || ""),
        source_post_id: clean(resolvedPost?.source_post_id || ""),
        permalink_post_id: clean(resolvedPost?.permalink_post_id || ""),
        canonical_post_id: clean(resolvedPost?.canonical_post_id || canonicalPostId || ""),
        post_id: clean(resolvedPost?.post_id || ""),
        object_id: clean(resolvedPost?.object_id || ""),
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
    console.info("POST_PRODUCT_LINKS_SAVE_REQUEST", {
      tenant_id: tenantId,
      platform: String(platform || "").trim() || "facebook",
      selected_post_id: requestedPostId,
      canonical_post_id: "",
      platform_post_id: "",
      product_ids: productIds,
      primary_product_id: primaryProductId,
    });
    if (!productIds.length) {
      return res.status(400).json({ success: false, message: "No product ids received" });
    }
    const post = await loadSocialCommentPost({ tenantId, platform, postId: requestedPostId }).catch(() => null);
    const { identity: manualIdentity, merged: resolvedPost } = buildManualLinkPostContext(req, post || {});
    const canonicalPostId = String(post?.canonical_post_id || post?.post_id || post?.automation_run_post_id || post?.conversation_id || requestedPostId || "").trim();
    const postId = canonicalPostId;
    const mapping = await savePostProductMappings({
      tenantId,
      platform,
      postId,
      selectedPostId: requestedPostId,
      row: resolvedPost || {},
      post: resolvedPost || {},
      productIds,
      primaryProductId,
      userId: req.user?.id || req.user?.user_id || null,
    });
    const readback = await getPostProductMappings({ tenantId, platform, postId, selectedPostId: requestedPostId, row: resolvedPost || {}, post: resolvedPost || {} });
    const rowsAffected = Number(mapping?.rows_affected ?? readback?.rows_affected ?? 0) || 0;
    const responseProductIds = Array.isArray(readback?.product_ids)
      ? readback.product_ids
      : Array.isArray(mapping?.product_ids)
        ? mapping.product_ids
        : Array.isArray(readback?.linked_products)
          ? readback.linked_products.map((item) => item.product_id || item.id || null).filter(Boolean)
          : productIds;
    console.info("POST_PRODUCT_LINK_IDENTITY_TRACE", {
      ...buildPostIdentityTrace({
        tenantId,
        platform,
        selectedPostId: requestedPostId,
        canonicalPostId,
        platformPostId: readback?.post_id || post?.platform_post_id || post?.post_id || requestedPostId || "",
        row: post || {},
        post: post || {},
        matchedMappingKey: readback?.matched_mapping_key || "",
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
      saved_platform_post_id: String(readback?.post_id || post?.platform_post_id || post?.post_id || requestedPostId || "").trim(),
      product_ids: responseProductIds,
      rows_affected: Number(rowsAffected || 0),
      readback_count: Number(readback?.count || 0) || 0,
      hydrated_products_count: Number(readback?.linked_products?.length || 0) || 0,
    });
    console.info("POST_PRODUCT_LINKS_READBACK", {
      tenant_id: tenantId,
      platform: String(readback?.platform || platform || "facebook").trim() || "facebook",
      selected_post_id: requestedPostId,
      canonical_post_id: canonicalPostId,
      saved_platform_post_id: String(readback?.post_id || post?.platform_post_id || post?.post_id || requestedPostId || "").trim(),
      product_ids: responseProductIds,
      rows_affected: Number(rowsAffected || 0),
      readback_count: Number(readback?.count || 0) || 0,
      hydrated_products_count: Number(readback?.linked_products?.length || 0) || 0,
    });
    return res.json({
      success: true,
      linked_products: readback?.linked_products || [],
      primary_product: readback?.primary_product || null,
      count: Number(readback?.count || 0) || 0,
      product_ids: responseProductIds,
      rows_affected: Number(rowsAffected || 0),
      post_id: postId,
      selected_post_id: requestedPostId,
      canonical_post_id: canonicalPostId,
      saved_platform_post_id: String(readback?.post_id || post?.platform_post_id || post?.post_id || requestedPostId || "").trim(),
      primary_product_name: String(readback?.primary_product?.name || readback?.primary_product?.title || readback?.primary_product?.product_name || "").trim(),
      platform: String(readback?.platform || platform || "facebook").trim() || "facebook",
      post_identity: {
        platform_post_id: clean(manualIdentity.platform_post_id || resolvedPost?.platform_post_id || ""),
        source_post_id: clean(manualIdentity.source_post_id || resolvedPost?.source_post_id || ""),
        permalink_post_id: clean(manualIdentity.permalink_post_id || resolvedPost?.permalink_post_id || ""),
        canonical_post_id: clean(manualIdentity.canonical_post_id || canonicalPostId || ""),
        post_id: clean(manualIdentity.post_id || resolvedPost?.post_id || ""),
        object_id: clean(manualIdentity.object_id || resolvedPost?.object_id || ""),
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
    const post = await loadSocialCommentPost({ tenantId, platform, postId: requestedPostId }).catch(() => null);
    const { merged: resolvedPost } = buildManualLinkPostContext(req, post || {});
    const postId = String(post?.canonical_post_id || post?.post_id || requestedPostId || "").trim();
    const productId = req.body?.product_id ?? req.body?.productId ?? req.query?.product_id ?? req.query?.productId ?? null;
    const mapping = await removePostProductMapping({
      tenantId,
      platform,
      postId,
      row: resolvedPost || {},
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
