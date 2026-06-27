import express from "express";
import { protect } from "../middleware/authMiddleware.js";
import permit from "../middleware/permissionMiddleware.js";
import db from "../database/db.js";
import {
  getSocialAutoReplySettings,
  getSocialCommentCommentByCommentId,
  getSocialCommentPostByCommentId,
  getSocialPostAutoReplyTemplate,
  ignoreSocialComment,
  backfillSocialCommentPostMedia,
  listSocialCommentPosts,
  listSocialCommentThreadComments,
  loadSocialCommentPost,
  processSocialCommentAutoReply,
  saveSocialAutoReplySettings,
  saveSocialPostAutoReplyTemplate,
  ensureSocialCommentsCenterSchema,
} from "../services/socialCommentsCenterService.js";

const router = express.Router();
const debugRouter = express.Router();
const isSocialCommentsDebugEnabled = () => String(process.env.DEBUG_SOCIAL_COMMENTS || "").toLowerCase() === "true";
const debugSocialCommentsWarn = (...args) => {
  if (isSocialCommentsDebugEnabled()) console.warn(...args);
};

const toTenantId = (req) => Number(req.query?.tenant_id || req.body?.tenant_id || req.headers["x-tenant-id"] || 1) || 1;

router.use(async (_req, _res, next) => {
  await ensureSocialCommentsCenterSchema().catch(() => {});
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
