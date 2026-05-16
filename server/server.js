import { createRequire } from "node:module";
import express from "express";

import cors from "cors";

import path from "path";

import http from "http";

import process from "node:process";
import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";

import { Server }
from "socket.io";

import { fileURLToPath }
from "url";
import { setIo } from "./utils/socket.js";

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

require("dotenv").config({ path: require("path").join(__dirname, ".env"), quiet: true });

console.log("[env] META_APP_ID loaded:", Boolean(process.env.META_APP_ID));
console.log("[env] META_APP_SECRET loaded:", Boolean(process.env.META_APP_SECRET));
console.log("[env] PUBLIC_BACKEND_URL:", process.env.PUBLIC_BACKEND_URL || "missing");

const resolveDbCheckInfo = () => {
  if (process.env.DATABASE_URL) {
    try {
      const parsed = new URL(process.env.DATABASE_URL);
      return {
        host: parsed.hostname || "localhost",
        port: parsed.port ? Number(parsed.port) : 5432,
        database: parsed.pathname ? decodeURIComponent(parsed.pathname.replace(/^\//, "")) : "",
        user: parsed.username ? decodeURIComponent(parsed.username) : "",
      };
    } catch {
      return {
        host: "DATABASE_URL_PARSE_ERROR",
        port: null,
        database: "",
        user: "",
      };
    }
  }

  return {
    host: process.env.PGHOST || "localhost",
    port: Number(process.env.PGPORT) || 5432,
    database: process.env.PGDATABASE || "erp_db",
    user: process.env.PGUSER || "postgres",
  };
};

console.log("[DB CHECK]", resolveDbCheckInfo());

/* =========================
   ROUTES IMPORTS
========================= */


/* =========================
   AI ROUTES 🧠
========================= */


/* =========================
   APP
========================= */

const app = express();
app.disable("x-powered-by");

const REQUEST_TIMEOUT_MS = Math.max(Number(process.env.REQUEST_TIMEOUT_MS || 60_000), 5_000);
const SLOW_REQUEST_MS = Math.max(Number(process.env.SLOW_REQUEST_MS || 2_000), 250);
const SHUTDOWN_TIMEOUT_MS = Math.max(Number(process.env.SHUTDOWN_TIMEOUT_MS || 10_000), 1_000);
const backgroundIntervals = new Set();
let isShuttingDown = false;

/* =========================
   HTTP SERVER
========================= */

const server = http.createServer(app);
server.requestTimeout = REQUEST_TIMEOUT_MS;
server.headersTimeout = REQUEST_TIMEOUT_MS + 5_000;
server.keepAliveTimeout = 5_000;

/* =========================
   SOCKET IO
========================= */

export let io = new Server(server, {

  cors: {

    origin: true,

    methods: ["GET", "POST"]
  }
});
setIo(io);

/* =========================
   SOCKET CONNECTION
========================= */

const emitOnlineUsers = () => {
  io.emit("dashboard:online-users", {
    count: io.engine.clientsCount || 0,
    at: new Date().toISOString(),
  });
};

io.on("connection", (socket) => {
  try {
    const token = socket.handshake?.auth?.token || socket.handshake?.query?.token;
    if (token) {
      const decoded = jwt.verify(String(token), process.env.JWT_SECRET || "SECRET_KEY");
      const userId = decoded?.id || decoded?.user_id;
      const role = String(decoded?.role || decoded?.role_name || "").trim().toLowerCase();
      const tenantId = decoded?.tenant_id || decoded?.tenantId;
      const branchId = decoded?.branch_id || decoded?.branchId;
      socket.join("notifications:all");
      if (userId) socket.join(`user:${userId}`);
      if (role) socket.join(`role:${role}`);
      if (tenantId) socket.join(`tenant:${tenantId}`);
      if (branchId) socket.join(`branch:${branchId}`);
    }
  } catch (error) {
    console.warn("[socket] notification room join skipped", error?.message || error);
  }
  emitOnlineUsers();

  console.log("⚡ User Connected:", socket.id);

  socket.on("disconnect", () => {
    emitOnlineUsers();

    console.log("❌ User Disconnected:", socket.id);

  });

});

const { default: authRoutes } = await import("./routes/auth.js");
const { default: productsRoutes } = await import("./routes/products.js");
const { default: ordersRoutes } = await import("./routes/orders.js");
const { default: posRoutes } = await import("./routes/pos.js");
const { default: inventoryRoutes } = await import("./routes/inventoryRoutes.js");
const { default: uploadRoutes } = await import("./routes/uploadRoutes.js");
const { default: variantRoutes } = await import("./routes/variantRoutes.js");
const { default: customerRoutes } = await import("./routes/customers.js");
const { default: supplierRoutes } = await import("./routes/suppliers.js");
const { default: brandsRoutes } = await import("./routes/brands.js");
const { default: manufacturersRoutes } = await import("./routes/manufacturers.js");
const { default: purchaseRoutes } = await import("./routes/purchases.js");
const { default: publicInvoiceRoutes } = await import("./routes/publicInvoices.js");
const { default: publicProductsRoutes } = await import("./routes/publicProducts.js");
const { getPublicProductOgImage, getPublicProductShareMetadata } = await import("./controllers/publicProductsController.js");
const { default: storefrontRoutes } = await import("./routes/storefront.js");
const { default: liveActivityRoutes } = await import("./routes/liveActivity.js");
const { default: productClassificationsRoutes } = await import("./routes/productClassifications.js");
const { default: variantsInventoryRoutes } = await import("./routes/variantsInventory.js");
const { default: accountingRoutes } = await import("./routes/accounting.js");
const { default: expensesRoutes } = await import("./routes/expenses.js");
const { default: warehouseRoutes } = await import("./routes/warehouses.js");
const { default: branchRoutes } = await import("./routes/branches.js");
const { default: tenantsRoutes } = await import("./routes/tenants.js");
const { default: subscriptionsRoutes } = await import("./routes/subscriptions.js");
const { default: analyticsRoutes } = await import("./routes/analytics.js");
const { default: reportsRoutes } = await import("./routes/reports.js");
const { default: loyaltyRoutes } = await import("./routes/loyalty.js");
const { default: employeeRoutes } = await import("./routes/employees.js");
const { default: salesEmployeesRoutes } = await import("./routes/salesEmployees.js");
const { default: salesCommissionsRoutes } = await import("./routes/salesCommissions.js");
const { default: attendanceRoutes } = await import("./routes/attendance.js");
const { default: shiftsRoutes } = await import("./routes/shifts.js");
const { default: marketingRoutes } = await import("./routes/marketing.js");
const { default: couponsRoutes } = await import("./routes/coupons.js");
const { default: dashboardRoutes } = await import("./routes/dashboard.js");
const { default: rolesRoutes } = await import("./routes/roles.js");
const { default: notificationsRoutes } = await import("./routes/notifications.js");
const { ensureProductSchema, ensureProductVariantSchema } = await import("./controllers/productsController.js");
const { ensureProductClassificationSchema } = await import("./services/productClassificationsService.js");
const { ensureStorefrontSchema } = await import("./controllers/storefrontController.js");
const { ensureNotificationsSchema } = await import("./services/notificationsService.js");
const { ensureWebsiteSettingsSchema } = await import("./services/liveActivityService.js");
const { runDueStoryPublishes, registerMarketingJobHandlers } = await import("./controllers/marketingController.js");
const { registerBackgroundJobHandlers } = await import("./services/backgroundJobs.js");
const { ensureMarketingSchema } = await import("./utils/marketingSchema.js");
const { ensureCouponsSchema } = await import("./services/couponsService.js");
const { ensureLoyaltySchema } = await import("./services/loyaltyService.js");
const { ensureDefaultTenantAndBackfillUsers } = await import("./utils/tenantBootstrap.js");
const { default: db } = await import("./database/db.js");
const { startMetaTokenRefreshScheduler } = await import("./services/metaTokenAutoRefreshService.js");
const { startMarketingAnalyticsSyncScheduler } = await import("./services/marketingAnalyticsService.js");
const { startMarketingAttributionSyncScheduler, resolveTrackedProductRedirect } = await import("./services/marketingAttributionService.js");
const { default: aiRoutes } = await import("./routes/ai.js");
const { default: aiV2Routes } = await import("./routes/aiV2.js");
const { default: smartWarehouseRoutes } = await import("./routes/smartWarehouse.js");
const { ensureSalesCommissionSchema } = await import("./services/salesCommissionService.js");

/* =========================
   PATH FIX
========================= */

/* =========================
   MIDDLEWARE
========================= */

app.use(
  cors({
    origin: true,
    credentials: true,
  })
);

app.use((req, res, next) => {
  if (isShuttingDown) {
    return res.status(503).json({
      success: false,
      message: "Server is shutting down",
    });
  }
  next();
});

app.use((req, res, next) => {
  req._startedAt = Date.now();
  req.id = req.headers["x-request-id"] || randomUUID();
  res.setHeader("X-Request-Id", req.id);

  let timedOut = false;
  const onTimeout = () => {
    if (timedOut) return;
    timedOut = true;
    console.warn("[api] request timeout", {
      requestId: req.id,
      method: req.method,
      url: req.originalUrl,
      timeoutMs: REQUEST_TIMEOUT_MS,
    });
    if (!res.headersSent) {
      res.status(503).json({
        success: false,
        message: "Request timed out",
      });
    }
  };

  req.setTimeout(REQUEST_TIMEOUT_MS, onTimeout);
  res.setTimeout(REQUEST_TIMEOUT_MS, onTimeout);

  res.on("finish", () => {
    if (timedOut) return;
    const durationMs = Date.now() - req._startedAt;
    const level = durationMs >= SLOW_REQUEST_MS || res.statusCode >= 500 ? "warn" : "log";
    console[level]("[api] request complete", {
      requestId: req.id,
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      durationMs,
    });
  });

  next();
});

app.use(express.json({
  limit: "20mb",
  verify: (req, _res, buf) => {
    req.rawBody = Buffer.from(buf);
  },
}));

app.use((req, res, next) => {
  console.log("[api] request start", {
    requestId: req.id,
    method: req.method,
    url: req.originalUrl,
  });
  next();
});

/* =========================
   HEALTH CHECK
========================= */

const healthPayload = () => ({
  success: true,
  status: "ok",
  uptime: process.uptime(),
  timestamp: new Date().toISOString(),
});

app.get("/api/health", async (req, res) => {
  res.status(200).json(healthPayload());
});

const resolveFrontendOrigin = (req) => {
  const envOrigin = String(process.env.FRONTEND_URL || process.env.CLIENT_URL || process.env.APP_URL || "").trim().replace(/\/$/, "");
  if (envOrigin) return envOrigin;
  const forwardedProto = String(req?.get?.("x-forwarded-proto") || "").split(",")[0].trim();
  const forwardedHost = String(req?.get?.("x-forwarded-host") || "").split(",")[0].trim();
  const protocol = forwardedProto || req?.protocol || "http";
  const host = forwardedHost || req?.get?.("host") || "";
  if (!host) return "";
  return `${protocol}://${host}`;
};

app.get("/track/:code", async (req, res) => {
  try {
    const result = await resolveTrackedProductRedirect({ code: req.params.code, req });
    if (!result?.post?.product_id) {
      return res.status(404).send("Tracking code not found");
    }

    const origin = resolveFrontendOrigin(req);
    const query = new URLSearchParams();
    if (result.post.tracking_source) query.set("src", result.post.tracking_source);
    if (result.post.tracking_kind) query.set("kind", result.post.tracking_kind);
    if (result.post.campaign_name) query.set("campaign", result.post.campaign_name);
    if (result.post.tracking_code) query.set("code", result.post.tracking_code);
    if (result.post.post_id) query.set("post", String(result.post.post_id));
    if (result.post.tenant_id) query.set("tenant_id", String(result.post.tenant_id));

    const targetPath = `/p/${encodeURIComponent(String(result.post.product_id))}${query.toString() ? `?${query.toString()}` : ""}`;
    const target = origin ? `${origin}${targetPath}` : targetPath;
    return res.redirect(302, target);
  } catch (error) {
    console.error("[track] redirect error", error);
    return res.status(500).send("Unable to resolve tracking link");
  }
});

app.get("/health", async (req, res) => {
  res.status(200).json({
    ...healthPayload(),
  });
});

/* =========================
   STATIC FILES
========================= */

const uploadsStaticOptions = {
  setHeaders: (res) => {
    res.setHeader("Cache-Control", "public, max-age=86400");
  },
};

app.use("/uploads", express.static(path.join(process.cwd(), "uploads"), uploadsStaticOptions));
app.use("/uploads", express.static(path.join(__dirname, "uploads"), uploadsStaticOptions));
app.use("/uploads", express.static(path.join(__dirname, "..", "uploads"), uploadsStaticOptions));

/* =========================
   API ROUTES
========================= */

app.use("/api/auth", authRoutes);
app.use("/api/products", productsRoutes);
app.use("/api/variants", variantRoutes);
app.use("/api/inventory", inventoryRoutes);
app.use("/api/variants-inventory", variantsInventoryRoutes);
app.use("/api/orders", ordersRoutes);
app.use("/api/pos", posRoutes);
app.use("/api/public/invoices", publicInvoiceRoutes);
app.use("/api/public/products", publicProductsRoutes);
app.use("/api/storefront", storefrontRoutes);
app.get("/api/website/products/:slug/og-image", getPublicProductOgImage);
app.get("/api/website/products/:slug/share-meta", getPublicProductShareMetadata);
app.use("/api/website", liveActivityRoutes);
app.use("/api/product-classifications", productClassificationsRoutes);
console.log("Product classifications routes registered");
app.use("/api/customers", customerRoutes);
app.use("/api/suppliers", supplierRoutes);
app.use("/api/brands", brandsRoutes);
app.use("/api/manufacturers", manufacturersRoutes);
app.use("/api/purchases", purchaseRoutes);
app.use("/api/accounting", accountingRoutes);
app.use("/api/expenses", expensesRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/uploads", uploadRoutes);
app.use("/api/warehouses", warehouseRoutes);
app.use("/api/smart-warehouse", smartWarehouseRoutes);
app.use("/api/branches", branchRoutes);
console.log("[server] branches routes mounted at /api/branches");
app.use("/api/tenants", tenantsRoutes);
app.use("/api/subscriptions", subscriptionsRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/reports", reportsRoutes);
app.use("/api/loyalty", loyaltyRoutes);
app.use("/api/employees", employeeRoutes);
app.use("/api/sales-employees", salesEmployeesRoutes);
app.use("/api/sales-commissions", salesCommissionsRoutes);
app.use("/api/attendance", attendanceRoutes);
app.use("/api/shifts", shiftsRoutes);
app.use("/api/marketing", marketingRoutes);
app.use("/api/coupons", couponsRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/roles", rolesRoutes);
app.use("/api/notifications", notificationsRoutes);
console.log("[routes] /api/roles mounted");
console.log("[server] marketing automation routes mounted");

/* =========================
   AI LAYERS 🧠
========================= */

app.use("/api/ai", aiRoutes);
app.use("/api/ai/v2", aiV2Routes);

app.get("/test", (req, res) => {
  res.send("TEST WORKING");
});

app.get("/", (req, res) => {
  res.send("ERP API Running...");
});

/* =========================
   ERROR HANDLER
========================= */

app.use((err, req, res, next) => {

  console.log("SERVER ERROR:", err);
  void next;

  if (err?.type === "entity.too.large") {
    return res.status(413).json({
      success: false,
      message: "Request payload too large",
    });
  }

  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    return res.status(400).json({
      success: false,
      message: "Invalid JSON payload",
    });
  }

  if (err?.name === "MulterError") {
    const status = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    return res.status(status).json({
      success: false,
      message: err.code === "LIMIT_FILE_SIZE" ? "Uploaded file is too large" : "Invalid upload",
    });
  }

  if (err?.message === "Images only" || err?.message === "INVALID_PAYMENT_PROOF_TYPE") {
    return res.status(400).json({
      success: false,
      message: "Invalid image upload",
    });
  }

  res.status(500).json({
    success: false,
    message: err.message || "Server Error"
  });

});

/* =========================
   SERVER START
========================= */

const PORT = Number(process.env.PORT) || 8000;
const HOST = process.env.HOST || "::";

server.on("error", (error) => {
  console.error("[server] listen error", error);
  process.exit(1);
});

process.on("uncaughtException", (error) => {
  console.error("[server] uncaught exception", error);
});

process.on("unhandledRejection", (error) => {
  console.error("[server] unhandled rejection", error);
});

const gracefulShutdown = (signal) => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.warn("[server] graceful shutdown started", { signal });

  for (const interval of backgroundIntervals) {
    clearInterval(interval);
  }
  backgroundIntervals.clear();

  const forceExit = setTimeout(() => {
    console.error("[server] graceful shutdown timed out", { signal });
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref?.();

  io.close(() => {
    server.close(async (error) => {
      if (error) {
        console.error("[server] shutdown close error", error);
        clearTimeout(forceExit);
        process.exit(1);
      }
      try {
        await db.end?.();
      } catch (dbError) {
        console.error("[server] db shutdown error", dbError);
      }
      clearTimeout(forceExit);
      console.warn("[server] graceful shutdown complete", { signal });
      process.exit(0);
    });
  });
};

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

server.listen(PORT, HOST, () => {

  console.log("[server] listening on host/port", { host: HOST, port: PORT });
  console.log(`[server] running on http://127.0.0.1:${PORT}`);
  console.log("[server] socket.io ready");
  console.log("[server] AI system active (v1 + v2)");

  void (async () => {
    try {
      await db.query("SELECT 1");
      await ensureNotificationsSchema(db);
      await ensureWebsiteSettingsSchema(db);
      console.log("[server] database connected");
      await ensureDefaultTenantAndBackfillUsers();
      console.log("[server] default tenant bootstrap ensured");
      await ensureProductSchema();
      console.log("[server] product schema ensured");
      await ensureProductVariantSchema();
      console.log("[server] product variant schema ensured");
      await ensureProductClassificationSchema();
      console.log("[server] product classification schema ensured");
      await ensureStorefrontSchema();
      console.log("[server] storefront schema ensured");
      await ensureMarketingSchema();
      console.log("[server] marketing schema ensured");
      await ensureCouponsSchema();
      await ensureLoyaltySchema(db);
      await ensureSalesCommissionSchema(db);
      console.log("[server] sales commission schema ensured");
      console.log("[server] coupons schema ensured");
      registerBackgroundJobHandlers();
      registerMarketingJobHandlers();
      startMetaTokenRefreshScheduler();
      startMarketingAnalyticsSyncScheduler();
      startMarketingAttributionSyncScheduler();
      const safeRunDueStoryPublishes = () => {
        void runDueStoryPublishes().catch((error) => {
          console.error("[server] story publish error", error);
        });
      };
      const storyInterval = setInterval(() => {
        safeRunDueStoryPublishes();
      }, 60 * 1000);
      backgroundIntervals.add(storyInterval);
      safeRunDueStoryPublishes();
      console.log("[server] story scheduler started");
      console.log("[server] boot success");
    } catch (error) {
      console.error("[server] startup non-fatal schema error", error);
    }
  })();

});
