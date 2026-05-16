import express from "express";

import {
  getPublicProductById,
  getPublicProductOgImage,
  getPublicProductShareMetadata,
  logPublicMarketingEvent,
} from "../controllers/publicProductsController.js";

const router = express.Router();

router.get("/:id/share-meta", getPublicProductShareMetadata);
router.get("/:slug/og-image", getPublicProductOgImage);
router.get("/:id", getPublicProductById);
router.post("/:id/events", logPublicMarketingEvent);
router.post("/events", logPublicMarketingEvent);

export default router;
