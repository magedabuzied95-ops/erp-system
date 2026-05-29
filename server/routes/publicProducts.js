import express from "express";

import {
  getPublicProductById,
  getPublicProductOgImage,
  getPublicProductShareMetadata,
  logPublicMarketingEvent,
} from "../controllers/publicProductsController.js";

const router = express.Router();

router.get("/:identifier/share-meta", getPublicProductShareMetadata);
router.get("/:identifier/og-image", getPublicProductOgImage);
router.get("/:identifier", getPublicProductById);
router.post("/:identifier/events", logPublicMarketingEvent);
router.post("/events", logPublicMarketingEvent);

export default router;
