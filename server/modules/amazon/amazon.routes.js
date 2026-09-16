// /api/amazon - every route: protect → requireAmazonAccess(view|manage) (permission + MFA + audit).
// Responses never contain credentials, access tokens or report URLs.

import express from "express";

import { protect } from "../../middleware/authMiddleware.js";
import { requireAmazonAccess } from "../security/amazonAccess.js";
import { amazonTenantId } from "./amazonConfig.js";
import { AMAZON_AUDIT_EVENTS, auditAmazon } from "./amazonAudit.js";
import { toSafeError } from "./amazonErrors.js";
import { getAmazonStatus, saveSellerId, testAmazonConnection } from "./amazonConnectionService.js";
import { isAmazonSchemaReady } from "./amazonSchema.js";
import { getAmazonDashboard, listAmazonOrders } from "./amazonQueries.js";
import { runAmazonOrdersSync } from "./amazonOrdersSync.js";
import { projectAmazonOrder, projectPendingAmazonOrders } from "./amazonOrderProjection.js";
import {
  listInventoryComparison,
  listListings,
  listPricingComparison,
  runAmazonInventorySync,
  runAmazonListingsSync,
  runAmazonPricingSync,
} from "./amazonCatalogSync.js";
import {
  acceptExactSkuSuggestions,
  listM1ProductsWithAmazonStatus,
  listSkuMappings,
  mapSku,
  refreshSkuSuggestions,
  searchM1Variants,
  unmapSku,
} from "./amazonSkuMapping.js";
import { isAmazonJobRunning, listSyncRuns } from "./amazonSyncRuns.js";
import { AMAZON_WRITE_OPERATIONS, requireAmazonWriteEnabled } from "./amazonWriteGuard.js";
import { amazonSchedulerState } from "./amazonScheduler.js";

const router = express.Router();
const view = [protect, requireAmazonAccess("view")];
const manage = [protect, requireAmazonAccess("manage")];

const tenantOf = (req) => Number(req.user?.tenant_id) || amazonTenantId();

router.use((req, res, next) => {
  if (isAmazonSchemaReady()) return next();
  return res.status(503).json({ success: false, code: "AMAZON_NOT_READY", message: "Amazon integration is not initialised on this server" });
});

const handle = (fn) => async (req, res) => {
  try {
    const data = await fn(req, res);
    if (!res.headersSent) res.json({ success: true, ...data });
  } catch (error) {
    const safe = toSafeError(error);
    const status = Number(error?.status) >= 400 && Number(error?.status) < 600 && error?.name === "AmazonApiError" && [400, 404, 409, 422].includes(Number(error.status))
      ? Number(error.status)
      : safe.category === "invalid_request" ? 400 : 500;
    console.warn("[amazon] request failed", { path: req.path, category: safe.category, status });
    if (!res.headersSent) res.status(status).json({ success: false, code: safe.code || safe.category, message: safe.message });
  }
};

// Starts a sync job in the background; the page follows it through /sync-runs.
const startJob = (jobType, runner, auditDetails = {}) => handle(async (req, res) => {
  if (await isAmazonJobRunning(jobType)) {
    res.status(409).json({ success: false, code: "SYNC_ALREADY_RUNNING", message: "This synchronization is already running" });
    return {};
  }
  const tenantId = tenantOf(req);
  const context = { user: req.user, headers: { "user-agent": req.headers["user-agent"], "x-real-ip": req.headers["x-real-ip"], "cf-connecting-ip": req.headers["cf-connecting-ip"] }, ip: req.ip, socket: req.socket };
  void runner({ tenantId, trigger: "manual", requestedBy: req.user?.id ?? null, req: context })
    .catch((error) => console.warn("[amazon] background job crashed", { job: jobType, message: toSafeError(error).message }));
  res.status(202).json({ success: true, started: true, job: jobType, ...auditDetails });
  return {};
});

// ---------------------------------------------------------------- status & connection
router.get("/status", ...view, handle(async (req) => ({
  status: await getAmazonStatus({ tenantId: tenantOf(req) }),
  scheduler: amazonSchedulerState(),
})));

router.post("/connection/test", ...manage, handle(async (req) => {
  const result = await testAmazonConnection({ tenantId: tenantOf(req) });
  await auditAmazon({
    req,
    eventType: AMAZON_AUDIT_EVENTS.CONNECTION_TEST,
    outcome: result.ok ? "success" : "failure",
    details: { status: result.status, category: result.error?.category || null },
  });
  return { result };
}));

router.put("/settings/seller-id", ...manage, handle(async (req) => {
  const sellerId = await saveSellerId({ tenantId: tenantOf(req), sellerId: req.body?.seller_id });
  await auditAmazon({ req, eventType: AMAZON_AUDIT_EVENTS.SETTINGS_CHANGED, details: { setting: "seller_id", configured: Boolean(sellerId) } });
  return { seller_id: sellerId || null };
}));

router.get("/dashboard", ...view, handle(async (req) => ({
  dashboard: await getAmazonDashboard({ tenantId: tenantOf(req) }),
  status: await getAmazonStatus({ tenantId: tenantOf(req) }),
})));

// ---------------------------------------------------------------- orders
router.get("/orders", ...view, handle(async (req) => listAmazonOrders({
  tenantId: tenantOf(req),
  status: req.query.status,
  fulfilledBy: req.query.fulfilled_by,
  from: req.query.from,
  to: req.query.to,
  search: req.query.search,
  limit: req.query.limit,
  offset: req.query.offset,
})));

router.post("/sync/orders", ...manage, startJob("orders", (args) => runAmazonOrdersSync({ ...args, projectOrder: projectAmazonOrder })));

router.post("/orders/project-pending", ...manage, handle(async (req) => ({
  result: await projectPendingAmazonOrders({ tenantId: tenantOf(req) }),
})));

// ---------------------------------------------------------------- catalog
router.get("/listings", ...view, handle(async (req) => ({
  listings: await listListings({ tenantId: tenantOf(req), search: req.query.search, limit: req.query.limit, offset: req.query.offset }),
})));
router.get("/inventory", ...view, handle(async (req) => ({
  inventory: await listInventoryComparison({ tenantId: tenantOf(req), search: req.query.search, limit: req.query.limit, offset: req.query.offset }),
})));
router.get("/pricing", ...view, handle(async (req) => ({
  pricing: await listPricingComparison({ tenantId: tenantOf(req), search: req.query.search, limit: req.query.limit, offset: req.query.offset }),
})));
router.get("/products", ...view, handle(async (req) => ({
  products: await listM1ProductsWithAmazonStatus({
    tenantId: tenantOf(req),
    search: req.query.search,
    onlyLinked: req.query.only_linked === "1",
    limit: req.query.limit,
    offset: req.query.offset,
  }),
})));

router.post("/sync/listings", ...manage, startJob("listings", runAmazonListingsSync));
router.post("/sync/inventory", ...manage, startJob("inventory", runAmazonInventorySync));
router.post("/sync/pricing", ...manage, startJob("pricing", runAmazonPricingSync));

// ---------------------------------------------------------------- SKU mapping
router.get("/sku-mappings", ...view, handle(async (req) => listSkuMappings({
  tenantId: tenantOf(req),
  status: req.query.status,
  search: req.query.search,
  limit: req.query.limit,
  offset: req.query.offset,
})));
router.get("/m1-variants", ...manage, handle(async (req) => ({
  variants: await searchM1Variants({ tenantId: tenantOf(req), query: req.query.q }),
})));
router.post("/sku-mappings/refresh-suggestions", ...manage, handle(async (req) => ({
  result: await refreshSkuSuggestions({ tenantId: tenantOf(req) }),
})));
router.post("/sku-mappings/accept-exact", ...manage, handle(async (req) => ({
  result: await acceptExactSkuSuggestions({ tenantId: tenantOf(req), req }),
})));
router.put("/sku-mappings/:id", ...manage, handle(async (req) => ({
  mapping: await mapSku({ tenantId: tenantOf(req), mappingId: Number(req.params.id), variantId: Number(req.body?.variant_id), req }),
})));
router.delete("/sku-mappings/:id", ...manage, handle(async (req) => ({
  mapping: await unmapSku({ tenantId: tenantOf(req), mappingId: Number(req.params.id), req }),
})));

// ---------------------------------------------------------------- sync logs
router.get("/sync-runs", ...view, handle(async (req) => ({
  runs: await listSyncRuns({ tenantId: tenantOf(req), jobType: req.query.job_type, limit: req.query.limit }),
})));

// ---------------------------------------------------------------- writes (Phase 14): refused while disabled
router.post(
  "/write/:operation",
  ...manage,
  (req, res, next) => requireAmazonWriteEnabled(req.params.operation)(req, res, next),
  (req, res) => res.status(501).json({
    success: false,
    code: "AMAZON_WRITE_NOT_IMPLEMENTED",
    message: "Amazon write synchronization is not implemented yet",
    operations: Object.values(AMAZON_WRITE_OPERATIONS),
  })
);

export default router;
