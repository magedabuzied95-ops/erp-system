import express from "express";

import upload from "../config/multer.js";

import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

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

      /* ======================================================
         IMAGE URL
      ====================================================== */

      const relativeUrl =
        `/uploads/products/${req.file.filename}`;

      /* ======================================================
         RESPONSE
      ====================================================== */

      res.status(200).json({

        success: true,

        message: "Image Uploaded Successfully",

        url: relativeUrl,
        imageUrl: relativeUrl,

        file: {
          filename: req.file.filename,
          mimetype: req.file.mimetype,
          size: req.file.size
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
