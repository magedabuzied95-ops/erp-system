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
  listSocialPublisherPosts,
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
      const caption = String(req.body?.caption || "").trim();
      const mediaUrl = resolveMediaUrl(req);
      const mediaType = resolveMediaType(req);
      const platforms = req.body?.platforms || [];
      const scheduledAt = req.body?.scheduled_at || req.body?.scheduledAt || null;
      const status = String(req.body?.status || "").trim() || (scheduledAt ? "scheduled" : "draft");
      const post = await createSocialPublisherPostRow({
        tenantId,
        caption,
        mediaUrl,
        mediaType,
        platforms,
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
      });
    } catch (error) {
      console.error("[social-publisher] publish post failed", { message: error?.message, stack: error?.stack });
      res.status(error?.status || 500).json({ success: false, message: error?.message || "Failed to publish social publisher post" });
    }
  }
);

export default router;
