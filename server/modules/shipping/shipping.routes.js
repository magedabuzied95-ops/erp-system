import express from "express";
import { protect } from "../../middleware/authMiddleware.js";
import permit from "../../middleware/permissionMiddleware.js";
import { jtSandboxCancel, jtSandboxCreate, jtSandboxLabel, jtSandboxQuery, jtSandboxStatus, jtSandboxTrace } from "./jtSandbox.controller.js";
import {
  bulkShippingCenterActionController,
  getShippingCenter,
  getShippingCenterMetaController,
  getShippingCenterSummaryController,
} from "./shipping.center.controller.js";
import {
  cancelBostaPickupController,
  createBostaPickupController,
  getBostaPickupsController,
  getBostaUnpaidCodController,
  getBostaProviderStatus,
  getShipmentNotificationSettings,
  getShippingCities,
  getShippingDistricts,
  getShippingZones,
  handleBostaWebhook,
  listShippingProvidersController,
  searchLocations,
  syncBostaLocationsController,
  testBostaWebhook,
  updateShipmentNotificationSettings,
  updateShippingProviderSettings,
} from "./shipping.controller.js";
import {
  backfillCourierCollectionsController,
  createCourierSettlementController,
  getCourierSettlementController,
  listCourierCollectionsController,
  listCourierSettlementsController,
} from "./shipping.settlements.controller.js";

const router = express.Router();

router.get("/jt/sandbox/status", protect, permit("settings", "view"), jtSandboxStatus);
router.post("/jt/sandbox/orders", protect, permit("settings", "edit"), jtSandboxCreate);
router.post("/jt/sandbox/orders/query", protect, permit("settings", "view"), jtSandboxQuery);
router.post("/jt/sandbox/orders/cancel", protect, permit("settings", "edit"), jtSandboxCancel);
router.post("/jt/sandbox/trace", protect, permit("settings", "view"), jtSandboxTrace);
router.post("/jt/sandbox/label", protect, permit("settings", "view"), jtSandboxLabel);

router.get("/center", protect, permit("orders", "view"), getShippingCenter);
router.get("/center/summary", protect, permit("orders", "view"), getShippingCenterSummaryController);
router.get("/center/meta", protect, permit("orders", "view"), getShippingCenterMetaController);
router.post("/center/bulk", protect, permit("orders", "edit"), bulkShippingCenterActionController);

// Scoped to the orders permission, not settings: the gear lives inside the Shipping
// Center, so whoever runs that page can edit what its messages say.
router.get("/notifications", protect, permit("orders", "view"), getShipmentNotificationSettings);
router.put("/notifications", protect, permit("orders", "edit"), updateShipmentNotificationSettings);

router.get("/cities", getShippingCities);
router.get("/zones", getShippingZones);
router.get("/districts", getShippingDistricts);
router.get("/locations/search", searchLocations);

router.get("/providers", protect, permit("settings", "view"), listShippingProvidersController);
router.put("/providers/:code/settings", protect, permit("settings", "edit"), updateShippingProviderSettings);
router.get("/providers/bosta/status", protect, permit("settings", "view"), getBostaProviderStatus);
router.post("/bosta/sync-locations", protect, permit("settings", "edit"), syncBostaLocationsController);
router.post("/bosta/webhook", handleBostaWebhook);
router.post("/bosta/webhook/test", protect, permit("settings", "view"), testBostaWebhook);

// Pickup requests book a courier to the shop, so creating or cancelling one needs the
// orders edit grant — the same people who create the shipments being picked up.
router.get("/bosta/pickups", protect, permit("orders", "view"), getBostaPickupsController);
router.post("/bosta/pickups", protect, permit("orders", "edit"), createBostaPickupController);
router.delete("/bosta/pickups/:pickupId", protect, permit("orders", "edit"), cancelBostaPickupController);
router.get("/bosta/unpaid-cod", protect, permit("orders", "view"), getBostaUnpaidCodController);

// Courier COD money: what the courier collected at the door (step one, automatic)
// and the bank transfers that settle it (step two, an operator act). Creating a
// settlement moves money on a money account, so it needs the edit grant.
router.get("/settlements/collections", protect, permit("orders", "view"), listCourierCollectionsController);
router.post("/settlements/collections/backfill", protect, permit("orders", "edit"), backfillCourierCollectionsController);
router.get("/settlements", protect, permit("orders", "view"), listCourierSettlementsController);
router.get("/settlements/:id", protect, permit("orders", "view"), getCourierSettlementController);
router.post("/settlements", protect, permit("orders", "edit"), createCourierSettlementController);

export default router;
