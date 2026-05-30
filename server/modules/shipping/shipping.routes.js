import express from "express";
import { protect } from "../../middleware/authMiddleware.js";
import permit from "../../middleware/permissionMiddleware.js";
import {
  getBostaProviderSettings,
  getShippingCities,
  getShippingDistricts,
  getShippingZones,
  handleBostaWebhook,
  searchLocations,
  syncBostaLocationsController,
  testBostaWebhook,
  updateBostaProviderSettings,
} from "./shipping.controller.js";

const router = express.Router();

router.get("/cities", getShippingCities);
router.get("/zones", getShippingZones);
router.get("/districts", getShippingDistricts);
router.get("/locations/search", searchLocations);

router.get("/providers/bosta/settings", protect, permit("settings", "view"), getBostaProviderSettings);
router.put("/providers/bosta/settings", protect, permit("settings", "edit"), updateBostaProviderSettings);
router.post("/bosta/sync-locations", protect, permit("settings", "edit"), syncBostaLocationsController);
router.post("/bosta/webhook", handleBostaWebhook);
router.post("/bosta/webhook/test", protect, permit("settings", "view"), testBostaWebhook);

export default router;
