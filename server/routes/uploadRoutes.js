import express from "express";
import { createHash } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";

import upload from "../config/multer.js";

import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

const cloudinaryConfig = () => ({
  cloudName: process.env.CLOUDINARY_CLOUD_NAME || process.env.CLOUDINARY_NAME || "",
  apiKey: process.env.CLOUDINARY_API_KEY || "",
  apiSecret: process.env.CLOUDINARY_API_SECRET || "",
  folder: process.env.CLOUDINARY_PRODUCT_FOLDER || "erp/products",
});

const sha1 = (value = "") => createHash("sha1").update(value).digest("hex");

const uploadToCloudinary = async (file) => {
  const config = cloudinaryConfig();
  if (!config.cloudName || !config.apiKey || !config.apiSecret || typeof fetch !== "function" || typeof FormData === "undefined") {
    return null;
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const paramsToSign = {
    folder: config.folder,
    timestamp,
  };
  const signatureBase = Object.keys(paramsToSign)
    .sort()
    .map((key) => `${key}=${paramsToSign[key]}`)
    .join("&");
  const signature = sha1(`${signatureBase}${config.apiSecret}`);
  const buffer = await readFile(file.path);
  const blob = new Blob([buffer], { type: file.mimetype || "application/octet-stream" });
  const formData = new FormData();
  formData.append("file", blob, file.originalname || file.filename || "product-image");
  formData.append("api_key", config.apiKey);
  formData.append("timestamp", String(timestamp));
  formData.append("folder", config.folder);
  formData.append("signature", signature);

  const response = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(config.cloudName)}/image/upload`, {
    method: "POST",
    body: formData,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body?.error?.message || body?.message || "Cloudinary upload failed");
  }
  return body;
};

/* ======================================================
   UPLOAD IMAGE
====================================================== */

router.post(
  "/",

  protect,

  upload.single("image"),

  async (req, res) => {

    try {

      /* ======================================================
         VALIDATION
      ====================================================== */

      if (!req.file) {

        return res.status(400).json({
          success: false,
          message: "No Image Uploaded"
        });
      }

      const cloudinaryResult = await uploadToCloudinary(req.file);
      if (cloudinaryResult?.secure_url) {
        await unlink(req.file.path).catch(() => {});
      }

      /* ======================================================
         IMAGE URL
      ====================================================== */

      const relativeUrl =
        `/uploads/products/${req.file.filename}`;
      const imageUrl = cloudinaryResult?.secure_url || relativeUrl;

      /* ======================================================
         RESPONSE
      ====================================================== */

      res.status(200).json({

        success: true,

        message: "Image Uploaded Successfully",

        url: imageUrl,
        imageUrl,
        secure_url: cloudinaryResult?.secure_url || "",
        public_id: cloudinaryResult?.public_id || "",

        file: {
          filename: req.file.filename,
          mimetype: req.file.mimetype,
          size: req.file.size,
          secure_url: cloudinaryResult?.secure_url || "",
        }
      });

    } catch (error) {

      console.log(error);

      res.status(500).json({
        success: false,
        message: "Failed To Upload Image",
        error: error.message
      });
    }
  }
);

export default router;
