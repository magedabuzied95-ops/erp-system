// /api/whatsapp-official/accounts — the official-number account page (Genie "Accounts" form).
// :integrationId = whatsapp_cloud_integrations.id of this tenant, or "env" for the env number.
// Read is settings:view; anything that changes settings or talks to Meta is settings:edit
// (same guards as routes/whatsappTemplates.js and the embedded-signup routes).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import express from "express";
import multer from "multer";

import { protect } from "../../../middleware/authMiddleware.js";
import permit from "../../../middleware/permissionMiddleware.js";
import {
  addStickers,
  getAccountSettings,
  refreshBusinessProfile,
  registerNumber,
  removeSticker,
  requestDisplayNameChange,
  resolveAccount,
  syncAccountStatus,
  updateAccountSettings,
} from "./accountSettings.service.js";

const router = express.Router();

// Same scope the embedded-signup accounts list uses, so the ids the list hands out resolve here.
const tenantOf = (req) => Number(req.user?.tenant_id || req.user?.tenantId || req.tenant?.id || req.headers?.["x-tenant-id"] || 0) || 0;

const fail = (res, error, fallback) => {
  const status = Number(error?.status) || 500;
  if (status >= 500) console.error("[wa-official:accounts]", { code: error?.code, message: error?.message });
  return res.status(status).json({
    success: false,
    message: error?.message || fallback,
    code: error?.code || "WA_ACCOUNT_ERROR",
    meaning: error?.details?.meaning || "",
  });
};

const withAccount = (handler, fallback) => async (req, res) => {
  try {
    const tenantId = tenantOf(req);
    const account = await resolveAccount({ tenantId, integrationId: req.params.integrationId });
    return await handler({ req, res, tenantId, account });
  } catch (error) {
    return fail(res, error, fallback);
  }
};

const view = [protect, permit("settings", "view")];
const edit = [protect, permit("settings", "edit")];

router.get("/:integrationId/settings", ...view, withAccount(async ({ res, tenantId, account }) => (
  res.json({ success: true, ...(await getAccountSettings({ tenantId, account })) })
), "Failed to load the account settings"));

router.put("/:integrationId/settings", ...edit, withAccount(async ({ req, res, tenantId, account }) => (
  res.json({ success: true, ...(await updateAccountSettings({ tenantId, account, body: req.body || {} })) })
), "Failed to save the account settings"));

router.post("/:integrationId/sync-status", ...edit, withAccount(async ({ res, tenantId, account }) => (
  res.json({ success: true, ...(await syncAccountStatus({ tenantId, account })) })
), "Meta did not return the number status"));

router.post("/:integrationId/display-name", ...edit, withAccount(async ({ req, res, tenantId, account }) => (
  res.json({ success: true, ...(await requestDisplayNameChange({ tenantId, account, newDisplayName: req.body?.new_display_name })) })
), "Meta refused the display name change"));

router.post("/:integrationId/register", ...edit, withAccount(async ({ req, res, tenantId, account }) => (
  res.json({ success: true, ...(await registerNumber({ tenantId, account, pin: req.body?.pin })) })
), "Meta refused the registration"));

// Genie's "Sync Participants" — a 1:1 number has no participants, so this refreshes the number's
// status and its WhatsApp business profile instead.
router.post("/:integrationId/sync-participants", ...edit, withAccount(async ({ res, tenantId, account }) => (
  res.json({ success: true, ...(await refreshBusinessProfile({ tenantId, account })) })
), "Meta did not return the business profile"));

/* ── stickers ── stored under /uploads/wa-stickers like the other uploads in this app ── */

const STICKER_DIR = path.join(process.cwd(), "uploads", "wa-stickers");
const STICKER_EXT = /\.(webp|png|gif|jpe?g)$/i;

const stickerUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      try {
        fs.mkdirSync(STICKER_DIR, { recursive: true });
        cb(null, STICKER_DIR);
      } catch (error) {
        cb(error);
      }
    },
    filename: (_req, file, cb) => {
      const ext = (path.extname(String(file.originalname || "")).toLowerCase().match(STICKER_EXT) ? path.extname(file.originalname).toLowerCase() : ".webp");
      cb(null, `${Date.now()}-${crypto.randomBytes(6).toString("hex")}${ext}`);
    },
  }),
  fileFilter: (_req, file, cb) => {
    if (/^image\/(webp|png|gif|jpeg)$/i.test(String(file.mimetype || "")) || STICKER_EXT.test(String(file.originalname || ""))) return cb(null, true);
    return cb(Object.assign(new Error("Stickers must be WEBP, PNG, GIF or JPG images"), { code: "STICKER_TYPE" }));
  },
  limits: { fileSize: 1024 * 1024, files: 20 },
});

router.post(
  "/:integrationId/stickers",
  ...edit,
  (req, res, next) => {
    stickerUpload.array("files", 20)(req, res, (error) => {
      if (!error) return next();
      return res.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({
        success: false,
        message: error.code === "LIMIT_FILE_SIZE" ? "Each sticker must be 1 MB or smaller" : (error.message || "Upload rejected"),
        code: error.code || "STICKER_REJECTED",
      });
    });
  },
  withAccount(async ({ req, res, tenantId, account }) => {
    const files = Array.isArray(req.files) ? req.files : [];
    if (!files.length) return res.status(400).json({ success: false, message: "Choose at least one image", code: "VALIDATION_ERROR" });
    const stickers = files.map((file) => ({
      id: crypto.randomBytes(8).toString("hex"),
      url: `/uploads/wa-stickers/${file.filename}`,
      media_id: null,
      name: String(file.originalname || file.filename).slice(0, 160),
      size: file.size,
      mime: file.mimetype,
      uploaded_at: new Date().toISOString(),
    }));
    return res.json({ success: true, ...(await addStickers({ tenantId, account, stickers })) });
  }, "Failed to save the stickers")
);

router.delete("/:integrationId/stickers/:stickerId", ...edit, withAccount(async ({ req, res, tenantId, account }) => {
  const { removed, result } = await removeSticker({ tenantId, account, stickerId: req.params.stickerId });
  // Only our own upload directory, only a bare file name — never a path from the body.
  const fileName = path.basename(String(removed?.url || ""));
  if (String(removed?.url || "").startsWith("/uploads/wa-stickers/") && fileName) {
    fs.promises.unlink(path.join(STICKER_DIR, fileName)).catch(() => {});
  }
  return res.json({ success: true, ...result });
}, "Failed to remove the sticker"));

export default router;
