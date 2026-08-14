import express from "express";
import fs from "fs";
import path from "path";
import multer from "multer";

import { protect } from "../middleware/authMiddleware.js";
import permit from "../middleware/permissionMiddleware.js";
import { getTenantId } from "../utils/requestScope.js";
import {
  createSocialPublisherPostRow,
  getSocialPublisherPostRow,
  listSocialPublisherMetaAccounts,
  listSocialPublisherPosts,
  searchSocialPublisherProducts,
  publishSocialPublisherPostRow,
} from "../services/socialPublisherPostsService.js";

const router = express.Router();

const mediaUploadDir = path.join(process.cwd(), "uploads", "social-publisher");
if (!fs.existsSync(mediaUploadDir)) {
  fs.mkdirSync(mediaUploadDir, { recursive: true });
}

const mediaUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, mediaUploadDir),
    filename: (_req, file, cb) => {
      const safeOriginal = String(file.originalname || "media")
        .replace(/[^a-zA-Z0-9._-]+/g, "_")
        .replace(/_+/g, "_")
        .slice(0, 120);
      cb(null, `${Date.now()}-${safeOriginal}`);
    },
  }),
  fileFilter: (_req, file, cb) => {
    const allowedMime = /^(image|video)\//i;
    const allowedExt = /\.(jpe?g|png|webp|gif|mp4|mov|m4v|webm)$/i.test(String(file.originalname || ""));
    if (allowedMime.test(String(file.mimetype || "")) || allowedExt) {
      cb(null, true);
      return;
    }
    cb(new Error("Image and video files only"));
  },
  limits: {
    fileSize: Math.max(Number(process.env.SOCIAL_PUBLISHER_MAX_BYTES || 50 * 1024 * 1024), 1024 * 1024),
    files: 1,
  },
});

const resolveMediaUrl = (req) => {
  if (req.file?.filename) {
    return `/uploads/social-publisher/${req.file.filename}`;
  }
  return String(req.body?.media_url || req.body?.mediaUrl || "").trim();
};

const resolveMediaType = (req) => {
  if (req.file?.mimetype?.startsWith("video/")) return "video";
  if (req.file?.mimetype?.startsWith("image/")) return "image";
  const explicit = String(req.body?.media_type || req.body?.mediaType || "").trim().toLowerCase();
  return explicit === "video" ? "video" : "image";
};

router.get(
  "/products/search",
  protect,
  permit("marketing", "view"),
  async (req, res) => {
    try {
      const tenantId = getTenantId(req, req.user?.tenant_id) || 1;
      const q = String(req.query?.q || req.query?.query || "").trim();
      const limit = Number(req.query?.limit || 20);
      const offset = Number(req.query?.offset || 0);
      const products = await searchSocialPublisherProducts({ tenantId, query: q, limit, offset });
      res.json({ success: true, data: products });
    } catch (error) {
      console.error("[social-publisher] product search failed", {
        message: error?.message || "unknown",
        code: error?.code || "",
        stack: error?.stack || "",
      });
      res.status(error?.status || 500).json({ success: false, message: error?.message || "Failed to search social publisher products" });
    }
  }
);

router.get(
  "/meta-accounts",
  protect,
  permit("marketing", "view"),
  async (req, res) => {
    console.log("[social-publisher-meta-accounts-route-hit]", {
      tenant: getTenantId(req, req.user?.tenant_id) || 1,
      user_id: req.user?.id || req.user?.user_id || null,
      url: req.originalUrl || req.url || "",
    });
    try {
      const tenantId = getTenantId(req, req.user?.tenant_id) || 1;
      console.log("[social-publisher-meta-accounts] route_entered", {
        tenant: tenantId,
        user_id: req.user?.id || req.user?.user_id || null,
      });
      const accounts = await listSocialPublisherMetaAccounts({ tenantId });
      console.log("[social-publisher-meta-accounts] route_success", {
        tenant: tenantId,
        pages_count: Array.isArray(accounts?.pages) ? accounts.pages.length : null,
        instagram_count: Array.isArray(accounts?.instagram_accounts) ? accounts.instagram_accounts.length : null,
      });
      res.json({ success: true, data: accounts });
    } catch (error) {
      console.error("[social-publisher-meta-accounts] route_failed", {
        message: error?.message || "unknown",
        code: error?.code || "",
        stack: error?.stack || "",
      });
      res.status(500).json({ success: false, message: error?.message || "Failed to load social publisher meta accounts" });
    }
  }
);

router.get(
  "/posts",
  protect,
  permit("marketing", "view"),
  async (req, res) => {
    try {
      const tenantId = getTenantId(req, req.user?.tenant_id) || 1;
      const limit = req.query?.limit || 20;
      const posts = await listSocialPublisherPosts({ tenantId, limit });
      res.json({ success: true, data: posts });
    } catch (error) {
      console.error("[social-publisher] list posts failed", { message: error?.message, stack: error?.stack });
      res.status(500).json({ success: false, message: error?.message || "Failed to load social publisher posts" });
    }
  }
);

router.post(
  "/posts",
  protect,
  permit("marketing", "create"),
  mediaUpload.single("media"),
  async (req, res) => {
    try {
      const tenantId = getTenantId(req, req.user?.tenant_id) || 1;
      const productId = Number(req.body?.product_id || req.body?.productId || 0) || null;
      const caption = String(req.body?.caption || "").trim();
      const firstComment = String(req.body?.first_comment || req.body?.firstComment || "").trim();
      const mediaUrl = resolveMediaUrl(req);
      const mediaUrls = (() => {
        try {
          const parsed = JSON.parse(String(req.body?.media_urls || "[]"));
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [];
        }
      })();
      const mediaType = resolveMediaType(req);
      const platforms = req.body?.platforms || [];
      const scheduledAt = req.body?.scheduled_at || req.body?.scheduledAt || null;
      const status = String(req.body?.status || "").trim() || (scheduledAt ? "scheduled" : "draft");
      let publishSettings = {};
      try {
        publishSettings = req.body?.publish_settings ? JSON.parse(String(req.body.publish_settings)) : {};
      } catch {
        publishSettings = {};
      }
      const post = await createSocialPublisherPostRow({
        tenantId,
        productId,
        caption,
        firstComment,
        mediaUrl,
        mediaUrls,
        mediaType,
        platforms,
        publishSettings,
        status,
        scheduledAt,
      });
      res.status(201).json({ success: true, data: post });
    } catch (error) {
      console.error("[social-publisher] create post failed", { message: error?.message, stack: error?.stack });
      res.status(error?.status || 500).json({ success: false, message: error?.message || "Failed to create social publisher post" });
    }
  }
);

router.post(
  "/posts/:id/publish",
  protect,
  permit("marketing", "publish"),
  async (req, res) => {
    try {
      const tenantId = getTenantId(req, req.user?.tenant_id) || 1;
      const result = await publishSocialPublisherPostRow({ tenantId, id: req.params.id });
      if (result.status === 404) {
        return res.status(404).json({ success: false, message: result.message || "Post not found" });
      }
      const refreshed = result.data ? await getSocialPublisherPostRow({ tenantId, id: req.params.id }) : null;
      res.json({
        success: Boolean(result.success),
        message: result.message || (result.success ? "Published successfully" : "Publish failed"),
        data: refreshed || result.data,
        meta_result: result.meta_result || null,
        // Needed by the composer to poll the real TikTok publish status; the
        // initial 202 only means TikTok accepted the upload, not that it is live.
        tiktok_result: result.tiktok_result || null,
      });
    } catch (error) {
      // error.status arrives already classified by the provider: 422 for a
      // content rejection, 429 rate limit, 409 reconnect, 503/502 for a real
      // upstream outage. It used to collapse to 502, which the browser surfaced
      // as a bare "NetworkError" with the real reason nowhere to be seen.
      const status = Number(error?.status) || 500;
      console.error("[social-publisher] publish post failed", {
        error_code: error?.code || "",
        status,
        message: error?.message,
        stack: error?.stack,
      });
      res.status(status).json({
        success: false,
        // The provider's own error code, so the UI can show something
        // actionable instead of a generic failure.
        code: error?.code || "",
        message: error?.message || "Failed to publish social publisher post",
      });
    }
  }
);

export default router;
