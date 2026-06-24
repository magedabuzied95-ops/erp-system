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
import { emitToRooms, normalizeSocketRoomKey, setIo } from "./utils/socket.js";
import { isPerfDebugEnabled, runWithPerfContext, slowestPhaseFromTimings } from "./utils/perfDebug.js";
import { logEmployeePushVapidCheck } from "./services/employeePortalPushService.js";
import { loadEmployeePortalByToken } from "./services/employeePayrollPortalService.js";
import { loadManagerPortalByToken } from "./services/managerPortalService.js";
import { getEvolutionInstanceEventsDebug, syncEvolutionWebhookOnStartup } from "./services/evolutionWebhookSyncService.js";
import { protect } from "./middleware/authMiddleware.js";
import permit from "./middleware/permissionMiddleware.js";
import { listRecentDisplayRefillAlerts } from "./services/displayRefillAlertService.js";
import { ensureUsersLoginSchema } from "./controllers/authController.js";
import { ensureInventoryCountSchema } from "./services/inventoryCountService.js";

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageJson = require("../package.json");

require("dotenv").config({ path: require("path").join(__dirname, ".env"), quiet: true });

const buildInfo = {
  version: packageJson.version || "0.0.0",
  commit: String(
    process.env.RENDER_GIT_COMMIT ||
      process.env.GIT_COMMIT ||
      process.env.SOURCE_VERSION ||
      process.env.COMMIT_SHA ||
      process.env.VERCEL_GIT_COMMIT_SHA ||
      ""
  ).slice(0, 40) || "unknown",
  environment: process.env.NODE_ENV || "development",
};
console.log("[build] version", buildInfo);
console.log("APP_STARTUP_VERSION", {
  app_version: buildInfo.version,
  git_commit: buildInfo.commit,
  render_git_commit: process.env.RENDER_GIT_COMMIT || "",
  node_env: buildInfo.environment,
});
console.log("[env] META_APP_ID loaded:", Boolean(process.env.META_APP_ID));
console.log("[env] META_APP_SECRET loaded:", Boolean(process.env.META_APP_SECRET));
console.log("[env] PUBLIC_BACKEND_URL:", process.env.PUBLIC_BACKEND_URL || "missing");
console.log("[env] PUBLIC_APP_URL:", process.env.PUBLIC_APP_URL || "missing");
const metaSetupStatus = {
  META_APP_ID: process.env.META_APP_ID ? "present" : "missing",
  META_APP_SECRET: process.env.META_APP_SECRET ? "present" : "missing",
  META_REDIRECT_URI: process.env.META_REDIRECT_URI ? "present" : "missing",
  META_VERIFY_TOKEN: process.env.META_VERIFY_TOKEN ? "present" : "missing",
  redirect_uri: process.env.META_REDIRECT_URI || "missing",
  frontend_url: process.env.PUBLIC_APP_URL || process.env.FRONTEND_URL || process.env.VITE_API_URL || "missing",
};
console.log("[meta-setup] status", metaSetupStatus);
if (Object.values(metaSetupStatus).includes("missing")) {
  console.warn("[meta-setup] Meta OAuth is not fully configured. Set missing env vars before testing Connect Meta.");
}
console.log("[env] OPENAI_API_KEY loaded:", Boolean(process.env.OPENAI_API_KEY));
logEmployeePushVapidCheck();
console.log("[env] AI support OpenAI config:", {
  ai_support_enabled: process.env.AI_SUPPORT_ENABLED ?? "",
  ai_support_vision_enabled: process.env.AI_SUPPORT_VISION_ENABLED ?? "",
  text_model: process.env.AI_SUPPORT_MODEL || "gpt-4o-mini",
  vision_model: process.env.OPENAI_VISION_MODEL || process.env.AI_SUPPORT_VISION_MODEL || process.env.AI_SUPPORT_MODEL || "gpt-4o-mini",
  vision_fallback_model: process.env.OPENAI_VISION_FALLBACK_MODEL || "gpt-4o",
  ai_support_enabled_false_disables_vision: false,
});

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

const normalizeOrigin = (value = "") => String(value || "").trim().replace(/\/+$/, "");
const isProductionEnvironment = String(process.env.NODE_ENV || "").toLowerCase() === "production";
const startupArgs = new Set(process.argv.slice(2).map((value) => String(value || "").trim().toLowerCase()));
const shouldSkipStartupSyncs = () => {
  if (isProductionEnvironment) return false;
  const raw = String(process.env.SKIP_STARTUP_SYNCS || process.env.DISABLE_STARTUP_INTEGRATIONS || "")
    .trim()
    .toLowerCase();
  return ["1", "true", "yes", "on"].includes(raw) || startupArgs.has("--skip-startup-syncs") || startupArgs.has("--disable-startup-integrations");
};
const localDevCorsOrigins = isProductionEnvironment
  ? []
  : [
      "http://localhost:5173",
      "http://localhost:5174",
      "http://localhost:5175",
      "http://localhost:5176",
      "http://localhost:5177",
      "http://localhost:5178",
      "http://127.0.0.1:5173",
      "http://127.0.0.1:5174",
      "http://127.0.0.1:5175",
      "http://127.0.0.1:5176",
      "http://127.0.0.1:5177",
      "http://127.0.0.1:5178",
    ];
const configuredCorsOrigins = [
  "https://erp-system-ten-green.vercel.app",
  ...localDevCorsOrigins,
  process.env.PUBLIC_APP_URL,
  process.env.FRONTEND_URL,
  process.env.CLIENT_URL,
  process.env.APP_URL,
  process.env.STORE_FRONT_URL,
  process.env.PUBLIC_FRONTEND_URL,
  process.env.VITE_PUBLIC_APP_URL,
  process.env.VITE_PUBLIC_STOREFRONT_URL,
  process.env.VITE_PUBLIC_FRONTEND_URL,
  process.env.CORS_ALLOWED_ORIGINS,
  process.env.VERCEL_URL ? `https://${String(process.env.VERCEL_URL).replace(/^https?:\/\//i, "").replace(/\/+$/, "")}` : "",
]
  .flatMap((value) => String(value || "").split(","))
  .map(normalizeOrigin)
  .filter(Boolean);
const allowedCorsOrigins = new Set(configuredCorsOrigins);
const corsAllowedHeaderNames = [
  "Content-Type",
  "Authorization",
  "Accept",
  "Origin",
  "Cache-Control",
  "Pragma",
  "Expires",
  "X-Requested-With",
  "Idempotency-Key",
  "X-Tenant-Id",
  "X-Branch-Id",
  "X-Device-Id",
  "X-Request-Id",
  "X-Storefront-Customer-Token",
  "X-Customer-Token",
];

const corsAllowedHeaders = Array.from(
  new Set(corsAllowedHeaderNames.flatMap((header) => [header, header.toLowerCase()]))
);

const corsOptions = {
  origin(origin, callback) {
    if (!origin) {
      callback(null, true);
      return;
    }
    const normalizedOrigin = normalizeOrigin(origin);
    if (allowedCorsOrigins.has(normalizedOrigin)) {
      callback(null, normalizedOrigin);
      return;
    }
    callback(new Error(`CORS origin not allowed: ${normalizedOrigin}`));
  },
  credentials: true,
  methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: corsAllowedHeaders,
  optionsSuccessStatus: 204,
};
const isCorsOriginError = (error) => String(error?.message || "").startsWith("CORS origin not allowed:");

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

    origin: Array.from(allowedCorsOrigins),

    methods: ["GET", "POST"],

    credentials: true
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

const socketUserCanViewEmployees = async (userId, user = {}) => {
  if (user?.is_super_admin) return true;
  const role = normalizeSocketRoomKey(user?.role_name || user?.role || "");
  if (["admin", "super_admin", "superadmin"].includes(role)) return true;
  if (!userId) return false;
  const result = await db.query(
    `
    SELECT p.module, p.action
    FROM users u
    LEFT JOIN role_permissions rp ON rp.role_id = u.role_id
    LEFT JOIN permissions p ON p.id = rp.permission_id
    WHERE u.id = $1
    `,
    [userId]
  );
  return result.rows.some((permission) => {
    const moduleName = String(permission.module || "").trim().toLowerCase();
    const action = String(permission.action || "").trim().toLowerCase();
    return moduleName === "*" || (moduleName === "employees" && ["view", "*"].includes(action));
  });
};

io.on("connection", async (socket) => {
  try {
    const token = socket.handshake?.auth?.token || socket.handshake?.query?.token;
    const employeePortalToken = socket.handshake?.auth?.employeePortalToken || socket.handshake?.query?.employeePortalToken;
    const managerPortalToken = socket.handshake?.auth?.managerPortalToken || socket.handshake?.query?.managerPortalToken;
    if (!token && !employeePortalToken && !managerPortalToken) throw new Error("missing socket token");

    if (employeePortalToken && !token) {
      const employee = await loadEmployeePortalByToken(String(employeePortalToken || ""));
      if (!employee) throw new Error("invalid employee portal token");
      socket.data.employeePortal = {
        employee_id: employee.id,
        tenant_id: employee.tenant_id || null,
        branch_id: employee.branch_id || null,
      };
      socket.join(`employee-chat:employee:${employee.id}`);
      socket.join(`employee:${employee.id}`);
      if (employee.tenant_id) socket.join(`tenant:${employee.tenant_id}`);
      if (employee.branch_id) socket.join(`branch:${employee.branch_id}`);
      socket.on("employee-chat:typing", (payload = {}) => {
        emitToRooms([`employee-chat:tenant:${employee.tenant_id || "global"}`], "employee-chat:typing", {
          thread_id: payload.thread_id || null,
          employee_id: employee.id,
          employee_name: employee.full_name || employee.name || "الموظف",
          sender_type: "employee",
          at: new Date().toISOString(),
        });
      });
      socket.on("employee-chat:stop-typing", (payload = {}) => {
        emitToRooms([`employee-chat:tenant:${employee.tenant_id || "global"}`], "employee-chat:stop-typing", {
          thread_id: payload.thread_id || null,
          employee_id: employee.id,
          sender_type: "employee",
          at: new Date().toISOString(),
        });
      });
      socket.emit("realtime:ready", {
        employee_id: employee.id,
        branch_id: employee.branch_id || null,
        portal: true,
        at: new Date().toISOString(),
      });
      emitOnlineUsers();
      socket.on("disconnect", () => {
        emitOnlineUsers();
      });
      return;
    }

    if (managerPortalToken && !token) {
      const manager = await loadManagerPortalByToken(String(managerPortalToken || ""));
      if (!manager) throw new Error("invalid manager portal token");
      socket.data.managerPortal = {
        employee_id: manager.id,
        tenant_id: manager.tenant_id || null,
        branch_id: manager.branch_id || null,
      };
      socket.join("role:manager");
      socket.join(`role:${String(manager.role || "manager").toLowerCase().replace(/[\s_]+/g, "_")}`);
      socket.join(`employee:${manager.id}`);
      socket.join(`employee-chat:tenant:${manager.tenant_id || "global"}`);
      if (manager.tenant_id) socket.join(`tenant:${manager.tenant_id}`);
      if (manager.branch_id) socket.join(`branch:${manager.branch_id}`);
      socket.emit("realtime:ready", {
        employee_id: manager.id,
        branch_id: manager.branch_id || null,
        manager_portal: true,
        at: new Date().toISOString(),
      });
      emitOnlineUsers();
      socket.on("disconnect", () => {
        emitOnlineUsers();
      });
      return;
    }

    const decoded = jwt.verify(String(token), process.env.JWT_SECRET || "SECRET_KEY");
    const userResult = await db.query(
      `
      SELECT
        u.id,
        u.tenant_id,
        COALESCE(r.name, u.role, $2) AS role_name,
        COALESCE(u.is_super_admin, FALSE) AS is_super_admin,
        e.id AS employee_id,
        e.branch_id AS employee_branch_id,
        e.role AS employee_role
      FROM users u
      LEFT JOIN roles r ON r.id = u.role_id
      LEFT JOIN employees e ON e.user_id = u.id
      WHERE u.id = $1
      ORDER BY e.id DESC NULLS LAST
      LIMIT 1
      `,
      [decoded?.id || decoded?.user_id, decoded?.role || decoded?.role_name || ""]
    );
    const user = userResult.rows[0] || decoded;
    const userId = user?.id || decoded?.id || decoded?.user_id;
    const role = normalizeSocketRoomKey(user?.role_name || user?.role || decoded?.role || decoded?.role_name || "");
    const employeeRole = normalizeSocketRoomKey(user?.employee_role || "");
    const tenantId = user?.tenant_id || decoded?.tenant_id || decoded?.tenantId;
    const branchId = user?.branch_id || user?.employee_branch_id || decoded?.branch_id || decoded?.branchId;

    socket.data.user = {
      id: userId,
      tenant_id: tenantId || null,
      branch_id: branchId || null,
      role,
      employee_id: user?.employee_id || null,
      is_super_admin: Boolean(user?.is_super_admin || decoded?.is_super_admin),
    };
    socket.join("notifications:all");
    if (userId) socket.join(`user:${userId}`);
    if (role) socket.join(`role:${role}`);
    if (employeeRole && employeeRole !== role) socket.join(`role:${employeeRole}`);
    if (tenantId) socket.join(`tenant:${tenantId}`);
    if (branchId) socket.join(`branch:${branchId}`);
    if (await socketUserCanViewEmployees(userId, user)) {
      socket.join(`employee-chat:tenant:${tenantId || "global"}`);
      socket.on("employee-chat:typing", (payload = {}) => {
        const employeeId = Number(payload.employee_id || payload.employeeId || 0);
        if (!employeeId) return;
        emitToRooms([`employee-chat:employee:${employeeId}`], "employee-chat:typing", {
          thread_id: payload.thread_id || null,
          employee_id: employeeId,
          sender_type: "admin",
          at: new Date().toISOString(),
        });
      });
      socket.on("employee-chat:stop-typing", (payload = {}) => {
        const employeeId = Number(payload.employee_id || payload.employeeId || 0);
        if (!employeeId) return;
        emitToRooms([`employee-chat:employee:${employeeId}`], "employee-chat:stop-typing", {
          thread_id: payload.thread_id || null,
          employee_id: employeeId,
          sender_type: "admin",
          at: new Date().toISOString(),
        });
      });
    }
    socket.on("warehouse-pick-alert", (payload = {}) => {
      const alertPayload = {
        productId: payload.productId ?? payload.product_id ?? null,
        productName: String(payload.productName || payload.product_name || "Product").trim() || "Product",
        productImage: String(payload.productImage || payload.product_image || "").trim(),
        article_code: String(payload.article_code || payload.articleCode || "").trim(),
        manufacturer_name: String(payload.manufacturer_name || payload.manufacturerName || payload.manufacturer || "").trim(),
        color: String(payload.color || "").trim(),
        size: String(payload.size || "").trim(),
        stock: Number(payload.stock || 0),
        sellerName: String(payload.sellerName || payload.seller_name || payload.salespersonName || "").trim() || "POS",
        branchId: payload.branchId ?? payload.branch_id ?? (branchId || null),
        timestamp: String(payload.timestamp || new Date().toISOString()),
      };
      io.emit("warehouse-pick-alert", alertPayload);
    });
    socket.emit("realtime:ready", { user_id: userId, branch_id: branchId || null, role, at: new Date().toISOString() });
  } catch (error) {
    console.warn("[socket] authentication failed", error?.message || error);
    socket.emit("realtime:error", { message: "Socket authentication failed" });
    socket.disconnect(true);
    return;
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
const { default: paymobRoutes } = await import("./routes/paymob.js");
const { default: inventoryRoutes } = await import("./routes/inventoryRoutes.js");
const { default: inventoryCountRoutes } = await import("./routes/inventoryCount.js");
const { default: uploadRoutes } = await import("./routes/uploadRoutes.js");
const { default: variantRoutes } = await import("./routes/variantRoutes.js");
const { default: customerRoutes } = await import("./routes/customers.js");
const { default: supplierRoutes } = await import("./routes/suppliers.js");
const { default: brandsRoutes } = await import("./routes/brands.js");
const { default: manufacturersRoutes } = await import("./routes/manufacturers.js");
const { default: purchaseRoutes } = await import("./routes/purchases.js");
const { default: publicInvoiceRoutes } = await import("./routes/publicInvoices.js");
const { default: publicOrderConfirmationRoutes } = await import("./routes/publicOrderConfirmation.js");
const { default: publicProductsRoutes } = await import("./routes/publicProducts.js");
const { getPublicAvailableOgDebugSvg, getPublicAvailableOgImage, getPublicAvailableOgImagePng, getPublicAvailableSharePage, getPublicProductOgImage, getPublicProductShareMetadata, getPublicProductSharePage } = await import("./controllers/publicProductsController.js");
const { default: storefrontRoutes } = await import("./routes/storefront.js");
const { default: shippingRoutes } = await import("./modules/shipping/shipping.routes.js");
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
const { default: employeePenaltyRoutes } = await import("./routes/employeePenalties.js");
const { default: salesEmployeesRoutes } = await import("./routes/salesEmployees.js");
const { default: salesCommissionsRoutes } = await import("./routes/salesCommissions.js");
const { default: attendanceRoutes } = await import("./routes/attendance.js");
const { default: adminAttendanceRoutes } = await import("./routes/adminAttendance.js");
const { default: shiftsRoutes } = await import("./routes/shifts.js");
const { default: marketingRoutes } = await import("./routes/marketing.js");
const { default: aiMarketingCenterRoutes } = await import("./routes/aiMarketingCenter.js");
const { default: couponsRoutes } = await import("./routes/coupons.js");
const { default: dashboardRoutes } = await import("./routes/dashboard.js");
const { default: rolesRoutes } = await import("./routes/roles.js");
const { default: notificationsRoutes } = await import("./routes/notifications.js");
const { default: staffTasksRoutes } = await import("./routes/staffTasks.js");
const { default: employeePortalRoutes } = await import("./routes/employeePortal.js");
const { default: managerPortalRoutes } = await import("./routes/managerPortal.js");
const { default: adminStaffTasksRoutes } = await import("./routes/adminStaffTasks.js");
const { default: settingsRoutes } = await import("./routes/settings.js");
const { default: whatsappGatewayRoutes } = await import("./routes/whatsappGateway.js");
const { default: whatsappDebugRoutes } = await import("./routes/whatsappDebug.js");
const { ensureProductSchema, ensureProductVariantSchema, warmProductsMetadataCache } = await import("./controllers/productsController.js");
const { ensureOrdersSchema } = await import("./controllers/ordersController.js");
const { ensureAccountingSchema } = await import("./services/accountingService.js");
const { ensureProductClassificationSchema } = await import("./services/productClassificationsService.js");
const { ensureProductVariantImagesSchema } = await import("./services/productVariantImagesService.js");
const { ensureStorefrontSchema } = await import("./controllers/storefrontController.js");
const { ensureShippingSchema } = await import("./modules/shipping/shipping.service.js");
const { ensureVariantsInventorySchema } = await import("./routes/variantsInventory.js");
const { warmDashboardMetadataCache } = await import("./services/dashboardAnalyticsService.js");
const { ensureAttendanceSchema } = await import("./utils/attendanceSchema.js");
const { ensureNotificationsSchema } = await import("./services/notificationsService.js");
const { ensureWebsiteSettingsSchema } = await import("./services/liveActivityService.js");
const { runDueStoryPublishes, registerMarketingJobHandlers, startAiMarketingAutomationRunner } = await import("./controllers/marketingController.js");
const { registerBackgroundJobHandlers } = await import("./services/backgroundJobs.js");
const { ensureMarketingSchema } = await import("./utils/marketingSchema.js");
const { ensureCouponsSchema } = await import("./services/couponsService.js");
const { ensureLoyaltySchema } = await import("./services/loyaltyService.js");
const { ensureStorefrontCustomerSessionSchema } = await import("./services/storefrontCustomerSessionService.js");
const { ensureDefaultTenantAndBackfillUsers } = await import("./utils/tenantBootstrap.js");
const { ensureBranchSchema } = await import("./utils/branchSchema.js");
const { ensureSingleBranchModeOnce } = await import("./utils/singleBranchMode.js");
const { repairOrdersShiftForeignKey } = await import("./utils/ordersShiftFkMigration.js");
const { default: db } = await import("./database/db.js");
const { startMetaTokenRefreshScheduler } = await import("./services/metaTokenAutoRefreshService.js");
const { startMarketingAnalyticsSyncScheduler } = await import("./services/marketingAnalyticsService.js");
const { startMarketingAttributionSyncScheduler, resolveTrackedProductRedirect } = await import("./services/marketingAttributionService.js");
const { default: aiRoutes } = await import("./routes/ai.js");
const { default: aiV2Routes } = await import("./routes/aiV2.js");
const { default: aiSupportRoutes } = await import("./routes/aiSupport.js");
const { default: aiAgentOrderRoutes } = await import("./routes/aiAgentOrders.js");
const { default: metaIntegrationRoutes, metaWebhookRoutes, handleMetaWebhookVerification, handleMetaWebhookSelfTest } = await import("./routes/metaIntegration.js");
const { getMetaWebhookUrl, getPublicAppUrl } = await import("./utils/publicUrl.js");
const { default: smartWarehouseRoutes } = await import("./routes/smartWarehouse.js");
const { ensureEmployeePenaltiesSchema, ensureSalesCommissionSchema, repairOrdersSalesEmployeeForeignKey } = await import("./services/salesCommissionService.js");
const { ensureEmployeePayrollPortalSchema } = await import("./services/employeePayrollPortalService.js");
const { ensureDisplayRefillAlertSchema } = await import("./services/displayRefillAlertService.js");
const { ensureAiAgentOrderSchema } = await import("./services/aiAgentOrderService.js");
const { ensureAiSalesAgentSchema } = await import("./services/aiSalesAgentService.js");
const { ensureAiInboxLeadActionsSchema } = await import("./services/aiInboxLeadActionsService.js");
const { ensureStaffTasksSchema, assignDailyInventoryCountTasks, reassignOverdueTasks, sendUpcomingTaskDueReminders } = await import("./services/staffTasksService.js");
const { processStaffTaskEmailQueue } = await import("./services/staffTaskEmailNotificationService.js");
const { ensureAiSupportLogSchema } = await import("./services/aiSupportLogService.js");
const { ensureMetaIntegrationSchema, repairCorruptedArabicText, getMetaWebhookDebugStatus, getMetaPermissionsDebugStatus, getMetaPostCommentsDebugStatus, getMetaPagePostsDebugStatus, getMetaPageSubscriptionsDebugStatus } = await import("./services/metaIntegrationService.js");
const { ensureSystemSettingsSchema } = await import("./services/settingsService.js");
const { ensureSocialAutomationSettingsSchema } = await import("./services/socialAutomationSettingsService.js");

const collectRouterEndpoints = (router, prefix = "") => {
  const endpoints = [];
  const stack = Array.isArray(router?.stack) ? router.stack : [];
  for (const layer of stack) {
    if (!layer?.route?.path) continue;
    const methods = Object.keys(layer.route.methods || {})
      .filter((method) => layer.route.methods[method])
      .map((method) => method.toUpperCase());
    for (const method of methods) {
      endpoints.push(`${method} ${prefix}${layer.route.path}`);
    }
  }
  return endpoints;
};

/* =========================
   PATH FIX
========================= */

/* =========================
   MIDDLEWARE
========================= */

app.use(
  cors(corsOptions)
);
app.options(/.*/, cors(corsOptions));

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
  const context = {
    requestId: req.id,
    route: `${req.method} ${req.originalUrl || req.url || ""}`,
  };

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
    if (!isPerfDebugEnabled() && durationMs < SLOW_REQUEST_MS && res.statusCode < 500) return;
    const slowest = slowestPhaseFromTimings({ total_ms: durationMs, handler_ms: durationMs });
    const level = durationMs >= SLOW_REQUEST_MS || res.statusCode >= 500 ? "warn" : "log";
    console[level]("[erp-perf] api handler", {
      requestId: req.id,
      endpoint: req.route?.path || req.path || req.originalUrl,
      controller: req.baseUrl || "app",
      action: `${req.method} ${req.path || req.originalUrl}`,
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      duration_ms: durationMs,
      durationMs,
      slowest_phase: slowest.name,
      slowest_phase_ms: slowest.ms,
    });
  });

  runWithPerfContext(context, next);
});

app.get("/api/meta/webhook", handleMetaWebhookVerification);
app.get("/api/meta/webhook-self-test", handleMetaWebhookSelfTest);
app.get("/api/debug/meta-webhook-status", async (req, res) => {
  try {
    const tenantId = Number(req.query?.tenant_id || req.user?.tenant_id || 1) || 1;
    const data = await getMetaWebhookDebugStatus({ tenantId, req });
    return res.json({ success: true, data, ...data });
  } catch (error) {
    console.error("[meta-webhook-debug] load failed", {
      message: error?.message || String(error),
      stack: error?.stack || "",
    });
    return res.status(error?.status || 500).json({
      success: false,
      message: error?.message || "Failed to load Meta webhook debug status",
    });
  }
});
app.get("/api/debug/meta-permissions", async (req, res) => {
  try {
    const tenantId = Number(req.query?.tenant_id || req.user?.tenant_id || 1) || 1;
    const data = await getMetaPermissionsDebugStatus({ tenantId, req });
    return res.json({ success: true, data, ...data });
  } catch (error) {
    console.error("[meta-permissions-debug] load failed", {
      message: error?.message || String(error),
      stack: error?.stack || "",
    });
    return res.status(error?.status || 500).json({
      success: false,
      message: error?.message || "Failed to load Meta permissions debug status",
    });
  }
});
app.get("/api/debug/meta-post-comments", async (req, res) => {
  try {
    const tenantId = Number(req.query?.tenant_id || req.user?.tenant_id || 1) || 1;
    const postId = String(req.query?.post_id || "").trim();
    const data = await getMetaPostCommentsDebugStatus({ tenantId, postId });
    return res.json({ success: true, data, ...data });
  } catch (error) {
    console.error("[meta-post-comments-debug] load failed", {
      message: error?.message || String(error),
      stack: error?.stack || "",
    });
    return res.status(error?.status || 500).json({
      success: false,
      message: error?.message || "Failed to load Meta post comments debug status",
    });
  }
});
app.get("/api/debug/meta-page-posts", async (req, res) => {
  try {
    const tenantId = Number(req.query?.tenant_id || req.user?.tenant_id || 1) || 1;
    const limit = Number(req.query?.limit || 20) || 20;
    const data = await getMetaPagePostsDebugStatus({ tenantId, limit });
    return res.json({ success: true, data, ...data });
  } catch (error) {
    console.error("[meta-page-posts-debug] load failed", {
      message: error?.message || String(error),
      stack: error?.stack || "",
    });
    return res.status(error?.status || 500).json({
      success: false,
      message: error?.message || "Failed to load Meta page posts debug status",
    });
  }
});
app.get("/api/debug/meta-page-subscriptions", async (req, res) => {
  try {
    const tenantId = Number(req.query?.tenant_id || req.user?.tenant_id || 1) || 1;
    const data = await getMetaPageSubscriptionsDebugStatus({ tenantId });
    return res.json({ success: true, data, ...data });
  } catch (error) {
    console.error("[meta-page-subscriptions-debug] load failed", {
      message: error?.message || String(error),
      stack: error?.stack || "",
    });
    return res.status(error?.status || 500).json({
      success: false,
      message: error?.message || "Failed to load Meta page subscriptions debug status",
    });
  }
});
app.get("/debug/evolution-instance-events", async (req, res) => {
  try {
    const data = await getEvolutionInstanceEventsDebug();
    return res.json({ success: true, data });
  } catch (error) {
    console.error("[evolution-instance-events:error]", {
      message: error?.message || String(error),
      stack: error?.stack || "",
    });
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to load Evolution instance events debug",
    });
  }
});

app.use(express.json({
  limit: "20mb",
  verify: (req, _res, buf) => {
    req.rawBody = Buffer.from(buf);
  },
}));

app.use((req, res, next) => {
  const json = res.json.bind(res);
  res.json = (body) => {
    res.set("Content-Type", "application/json; charset=utf-8");
    return json(body);
  };
  next();
});

app.use((req, res, next) => {
  if (!isPerfDebugEnabled()) return next();
  console.log("[erp-perf] api start", {
    requestId: req.id,
    method: req.method,
    url: req.originalUrl,
  });
  next();
});

app.use((req, res, next) => {
  const url = req.originalUrl || req.url || "";
  if (url.includes("/api/marketing")) {
    console.log("[marketing-route-hit]", req.method, url);
  }
  next();
});

const shouldLogTemporaryRequestDuration = (req) => {
  const method = String(req.method || "").toUpperCase();
  const url = String(req.originalUrl || req.url || "");
  if (method === "GET" && (url.startsWith("/api/products") || url.startsWith("/api/ai-inbox/conversations"))) return true;
  if (method === "POST" && url.startsWith("/api/whatsapp/webhook")) return true;
  return false;
};

app.use((req, res, next) => {
  res.on("finish", () => {
    if (!shouldLogTemporaryRequestDuration(req)) return;
    const durationMs = Date.now() - (req._startedAt || Date.now());
    console.info("[request-duration]", {
      method: req.method,
      url: req.originalUrl || req.url || "",
      route: req.route?.path || req.path || "",
      status: res.statusCode,
      duration_ms: durationMs,
    });
  });
  next();
});

/* =========================
   HEALTH CHECK
========================= */

const healthPayload = () => ({
  success: true,
  status: "ok",
  version: buildInfo.version,
  commit: buildInfo.commit,
  environment: buildInfo.environment,
  uptime: process.uptime(),
  timestamp: new Date().toISOString(),
});

app.get("/api/health", async (req, res) => {
  res.status(200).json(healthPayload());
});

app.get("/api/debug/pwa", (req, res) => {
  const queryManifestHref = String(req.query.manifestHref || "");
  const currentPath =
    String(req.query.currentPath || "") ||
    (() => {
      try {
        const referer = req.get("referer") || "";
        if (!referer) return "";
        const url = new URL(referer);
        return `${url.pathname}${url.search}`;
      } catch {
        return "";
      }
    })();

  const tokenMatch = queryManifestHref.match(/\/api\/employee-portal\/([^/?#]+)\/manifest\.webmanifest/);
  const token = tokenMatch ? decodeURIComponent(tokenMatch[1]) : "";
  const manifestStartUrl =
    String(req.query.manifestStartUrl || "") || (token ? `/employee-app/${encodeURIComponent(token)}?source=pwa` : "");
  const manifestScope = String(req.query.manifestScope || "") || (token ? "/employee-app/" : "");

  res.status(200).json({
    currentPath,
    manifestHref: queryManifestHref,
    manifestStartUrl,
    manifestScope,
    standalone: String(req.query.standalone || "false") === "true",
    employeePortalLastUrl: String(req.query.employeePortalLastUrl || ""),
  });
});

const resolveFrontendOrigin = (req) => {
  const envOrigin = String(
    process.env.PUBLIC_APP_URL ||
      ""
  ).trim().replace(/\/$/, "");
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
app.use("/api/paymob", paymobRoutes);
app.use("/api/public/invoices", publicInvoiceRoutes);
app.use("/api/public/order-confirmation", publicOrderConfirmationRoutes);
app.use("/api/public/products", publicProductsRoutes);
app.use("/api/storefront", storefrontRoutes);
app.use("/api/shipping", shippingRoutes);
app.get("/shop/product/:identifier", getPublicProductSharePage);
app.get("/share/product/:identifier", getPublicProductSharePage);
app.get("/share/available", getPublicAvailableSharePage);
app.get("/share/available/og-debug-svg", getPublicAvailableOgDebugSvg);
app.get("/share/available/og-image", getPublicAvailableOgImage);
app.get("/share/available/og-image.png", getPublicAvailableOgImagePng);
app.get("/api/website/products/:slug/og-image", getPublicProductOgImage);
app.get("/api/website/products/:slug/share-meta", getPublicProductShareMetadata);
console.log("route_registered:", "/share/available/og-debug-svg");
app.use("/api/website", liveActivityRoutes);
app.use("/api/product-classifications", productClassificationsRoutes);
console.log("Product classifications routes registered");
app.use("/api/customers", customerRoutes);
app.use("/api/suppliers", supplierRoutes);
app.use("/api/brands", brandsRoutes);
app.use("/api/manufacturers", manufacturersRoutes);
app.use("/api/purchases", purchaseRoutes);
app.use("/api/accounting", accountingRoutes);
app.use('/api/expenses', expensesRoutes);
console.log("[routes] expenses mounted at /api/expenses");
const registeredExpensesEndpoints = collectRouterEndpoints(expensesRoutes, "/api/expenses");
console.log("[server] Expenses routes mounted", {
  prefix: "/api/expenses",
  routeCount: registeredExpensesEndpoints.length,
  routes: registeredExpensesEndpoints,
});
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
const registeredEmployeeEndpoints = collectRouterEndpoints(employeeRoutes, "/api/employees");
console.log("[server] Employee routes mounted", {
  prefix: "/api/employees",
  routeCount: registeredEmployeeEndpoints.length,
  hasPortalTokenRegenerate: registeredEmployeeEndpoints.includes("POST /api/employees/:employeeId/portal-token/regenerate"),
  hasEmployeeChatThreads: registeredEmployeeEndpoints.includes("GET /api/employees/chat/threads"),
  hasEmployeeChatThreadDetail: registeredEmployeeEndpoints.includes("GET /api/employees/chat/threads/:threadId"),
  hasEmployeeChatSend: registeredEmployeeEndpoints.includes("POST /api/employees/chat/threads/:threadId/messages"),
  hasEmployeeChatRead: registeredEmployeeEndpoints.includes("PATCH /api/employees/chat/threads/:threadId/read"),
  routes: registeredEmployeeEndpoints,
});
app.use("/api", employeePenaltyRoutes);
console.log("[employee-penalties] routes mounted at /api", {
  routes: collectRouterEndpoints(employeePenaltyRoutes, "/api"),
});
app.use("/api/inventory-count", inventoryCountRoutes);
console.log("[server] inventory count routes mounted at /api/inventory-count");
app.use("/api/sales-employees", salesEmployeesRoutes);
app.use("/api/sales-commissions", salesCommissionsRoutes);
app.use("/api/attendance", attendanceRoutes);
app.use("/api/admin/attendance", adminAttendanceRoutes);
console.log("[attendance] today-attendance reset route enabled");
app.use("/api/shifts", shiftsRoutes);
app.use("/api/marketing/ai-center", aiMarketingCenterRoutes);
const registeredAiMarketingCenterEndpoints = collectRouterEndpoints(aiMarketingCenterRoutes, "/api/marketing/ai-center");
console.log("[ai-marketing-center] mounted at /api/marketing/ai-center");
console.log("[server] AI Marketing Center routes mounted", {
  prefix: "/api/marketing/ai-center",
  routeCount: registeredAiMarketingCenterEndpoints.length,
  routes: registeredAiMarketingCenterEndpoints,
});
app.use("/api/marketing", marketingRoutes);
const registeredMarketingEndpoints = collectRouterEndpoints(marketingRoutes, "/api/marketing");
console.log("Marketing routes mounted", {
  prefix: "/api/marketing",
  routeCount: registeredMarketingEndpoints.length,
});
console.log("[server] registered marketing endpoints", registeredMarketingEndpoints);
app.use("/api/coupons", couponsRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/roles", rolesRoutes);
app.use("/api/notifications", notificationsRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/whatsapp", whatsappGatewayRoutes);
app.use("/api/debug/whatsapp", whatsappDebugRoutes);
app.use("/api/staff-tasks", staffTasksRoutes);
app.use("/api/employee/portal", employeePortalRoutes);
app.use("/api/employee-portal", employeePortalRoutes);
const registeredEmployeePortalEndpoints = collectRouterEndpoints(employeePortalRoutes, "/api/employee-portal");
console.log("[server] Employee portal routes mounted", {
  prefix: "/api/employee-portal",
  routeCount: registeredEmployeePortalEndpoints.length,
  hasEmployeeChat: registeredEmployeePortalEndpoints.includes("GET /api/employee-portal/:token/chat"),
  hasEmployeeChatSend: registeredEmployeePortalEndpoints.includes("POST /api/employee-portal/:token/chat/messages"),
  routes: registeredEmployeePortalEndpoints,
});
app.use("/api/manager-portal", managerPortalRoutes);
const registeredManagerPortalEndpoints = collectRouterEndpoints(managerPortalRoutes, "/api/manager-portal");
console.log("[server] Manager portal routes mounted", {
  prefix: "/api/manager-portal",
  routeCount: registeredManagerPortalEndpoints.length,
  hasManagerChat: registeredManagerPortalEndpoints.includes("GET /api/manager-portal/:token/chat"),
  hasManagerChatSend: registeredManagerPortalEndpoints.includes("POST /api/manager-portal/:token/chat/:threadId/messages"),
  routes: registeredManagerPortalEndpoints,
});
app.use("/api/admin/staff-tasks", adminStaffTasksRoutes);
console.log("[routes] /api/roles mounted");
console.log("[server] marketing automation routes mounted");

app.get("/api/debug/display-refill-alerts", protect, permit("employees", "view"), async (req, res) => {
  try {
    const alerts = await listRecentDisplayRefillAlerts({ limit: 20 });
    const pendingCountByScope = alerts.reduce((acc, alert) => {
      const key = `${alert.tenant_id ?? "null"}:${alert.branch_id ?? "null"}:${alert.employee_id ?? "branch"}`;
      if (!acc[key]) {
        acc[key] = {
          tenant_id: alert.tenant_id ?? null,
          branch_id: alert.branch_id ?? null,
          employee_id: alert.employee_id ?? null,
          scope: alert.employee_id ? "employee" : "branch",
          total: 0,
          pending: 0,
        };
      }
      acc[key].total += 1;
      if (String(alert.status || "pending") === "pending") acc[key].pending += 1;
      return acc;
    }, {});
    return res.json({
      success: true,
      alerts,
      latest_count: alerts.length,
      pending_count_by_scope: Object.values(pendingCountByScope),
    });
  } catch (error) {
    console.error("[display-refill-alert:debug:error]", {
      message: error?.message || String(error),
      code: error?.code || "",
    });
    return res.status(error.status || 500).json({ success: false, message: "Failed to load display refill alert debug data" });
  }
});

/* =========================
   AI LAYERS 🧠
========================= */

app.use("/api/ai", aiRoutes);
app.use("/api/ai/v2", aiV2Routes);
app.use("/api/ai-support", aiSupportRoutes);
app.use("/api/ai-agent", aiAgentOrderRoutes);
app.use("/api/ai-inbox", aiAgentOrderRoutes);
const registeredAiAgentEndpoints = collectRouterEndpoints(aiAgentOrderRoutes, "/api/ai-agent");
const registeredAiInboxEndpoints = collectRouterEndpoints(aiAgentOrderRoutes, "/api/ai-inbox");
const aiDebugInboxRoute = "GET /api/ai-inbox/conversations/:conversationId/ai-debug";
console.log("[ai-debug-route-check]");
console.log(`route registered: ${registeredAiInboxEndpoints.includes(aiDebugInboxRoute)}`);
console.log("path: /api/ai-inbox/conversations/:conversationId/ai-debug");
console.log("[ai-debug] route registered", {
  route: aiDebugInboxRoute,
  mounted: registeredAiInboxEndpoints.includes(aiDebugInboxRoute),
  route_file: "server/routes/aiAgentOrders.js",
  mount_path: "/api/ai-inbox",
});
console.log("[server] AI Agent routes mounted", {
  prefix: "/api/ai-agent",
  routeCount: registeredAiAgentEndpoints.length,
  hasSalesCloser: registeredAiAgentEndpoints.includes("GET /api/ai-agent/conversations/:conversationId/sales-closer"),
  hasTestSalesCloser: registeredAiAgentEndpoints.includes("GET /api/ai-agent/test-sales-closer"),
  hasLogs: registeredAiAgentEndpoints.includes("GET /api/ai-agent/logs"),
  hasSuggestedReplies: registeredAiAgentEndpoints.includes("POST /api/ai-agent/suggested-replies"),
  hasSuggestedRepliesTypoAlias: registeredAiAgentEndpoints.includes("POST /api/ai-agent/sugested-replies"),
  hasInboxReopen: registeredAiAgentEndpoints.includes("POST /api/ai-agent/inbox/:conversationId/reopen"),
  routes: registeredAiAgentEndpoints,
});
console.log("[server] AI Inbox routes mounted", {
  prefix: "/api/ai-inbox",
  routeCount: registeredAiInboxEndpoints.length,
  hasSalesCloser: registeredAiInboxEndpoints.includes("GET /api/ai-inbox/conversations/:conversationId/sales-closer"),
  hasTestSalesCloser: registeredAiInboxEndpoints.includes("GET /api/ai-inbox/test-sales-closer"),
  hasSyncMessengerProfilePost: registeredAiInboxEndpoints.includes("POST /api/ai-inbox/conversations/:conversationId/sync-messenger-profile"),
  hasDebugMessengerProfileGet: registeredAiInboxEndpoints.includes("GET /api/ai-inbox/conversations/:conversationId/debug-messenger-profile"),
  hasDebugMessengerProfilePost: registeredAiInboxEndpoints.includes("POST /api/ai-inbox/conversations/:conversationId/debug-messenger-profile"),
  hasAiDebug: registeredAiInboxEndpoints.includes(aiDebugInboxRoute),
  routes: registeredAiInboxEndpoints,
});
app.use("/api/integrations/meta", metaIntegrationRoutes);
app.use("/api/meta", metaWebhookRoutes);
app.use("/api/meta", (req, res) => {
  console.warn("[meta-webhook] route mismatch", {
    method: req.method,
    url: req.originalUrl || req.url,
    expected_routes: ["GET /api/meta/webhook", "POST /api/meta/webhook", "GET /api/meta/webhook-self-test"],
  });
  res.status(404).json({ success: false, message: "Meta route not found" });
});
console.log("[server] AI Support routes mounted", {
  prefix: "/api/ai-support",
  routes: [
    "GET /knowledge-base",
    "PUT /knowledge-base",
    "DELETE /knowledge-base",
    "POST /chat",
    "GET /history",
    "GET /insights",
    "DELETE /history/test",
  ],
});

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

  if (isCorsOriginError(err)) {
    return res.status(403).json({
      success: false,
      message: "CORS origin not allowed",
    });
  }

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

const runStartupDiagnostics = () => {
  const publicAppUrl = getPublicAppUrl();
  console.log("[startup] public url diagnostics", {
    PUBLIC_APP_URL: process.env.PUBLIC_APP_URL || "missing",
    PUBLIC_BACKEND_URL: process.env.PUBLIC_BACKEND_URL || "missing",
    FRONTEND_URL: process.env.FRONTEND_URL || "missing",
    detected_public_app_url: publicAppUrl || "missing",
    expected_meta_webhook_url: getMetaWebhookUrl(),
  });
  console.log("[startup] route_registered", {
    route: "/share/available/og-debug-svg",
    handler: "getPublicAvailableOgDebugSvg",
    mounted: true,
  });
  if (!publicAppUrl) {
    console.warn("[startup] PUBLIC_APP_URL is missing. Employee portal links and QR codes require a real HTTPS app URL in production.");
  }
};

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

const logStartupFatal = (err) => {
  console.error("[server:start:fatal]", {
    message: err?.message,
    stack: err?.stack,
    code: err?.code,
    detail: err?.detail,
    table: err?.table,
    constraint: err?.constraint,
  });
};

const runDeferredStartupSyncs = async ({ skipStartupSyncs = false } = {}) => {
  console.log("STARTUP_SYNCS_STARTED", {
    skip_startup_syncs: Boolean(skipStartupSyncs),
    at: new Date().toISOString(),
  });

  if (skipStartupSyncs) {
    console.log("[startup] startup syncs disabled for local/dev smoke test", {
      SKIP_STARTUP_SYNCS: process.env.SKIP_STARTUP_SYNCS || "",
      DISABLE_STARTUP_INTEGRATIONS: process.env.DISABLE_STARTUP_INTEGRATIONS || "",
    });
    console.log("STARTUP_SYNCS_COMPLETED", {
      skipped: true,
      failures_count: 0,
      at: new Date().toISOString(),
    });
    return;
  }

  const failures = [];
  try {
    try {
      await syncEvolutionWebhookOnStartup();
    } catch (error) {
      failures.push({
        step: "syncEvolutionWebhookOnStartup",
        message: error?.message || String(error),
      });
      console.warn("[server] evolution webhook sync skipped", {
        message: error?.message || String(error),
      });
    }

    try {
      registerBackgroundJobHandlers();
      registerMarketingJobHandlers();
      startMetaTokenRefreshScheduler();
      startMarketingAnalyticsSyncScheduler();
      startMarketingAttributionSyncScheduler();
      startAiMarketingAutomationRunner();

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

      const taskInterval = setInterval(() => {
        void processStaffTaskEmailQueue().catch((error) => {
          console.error("[server] staff task email queue error", error);
        });
        void reassignOverdueTasks({ tenantId: null }).catch((error) => {
          console.error("[server] staff task overdue reassignment error", error);
        });
        void sendUpcomingTaskDueReminders({ tenantId: null }).catch((error) => {
          console.error("[server] staff task due reminder error", error);
        });
      }, 5 * 60 * 1000);
      backgroundIntervals.add(taskInterval);
      void assignDailyInventoryCountTasks({ tenantId: null, limit: 20 }).catch((error) => {
        console.warn("[server] daily inventory task assignment skipped", error.message);
      });
      void processStaffTaskEmailQueue().catch((error) => {
        console.warn("[server] initial staff task email queue skipped", error.message);
      });
      console.log("[server] staff task schedulers started");
      console.log("[server] story scheduler started");
    } catch (error) {
      failures.push({
        step: "background_startup_jobs",
        message: error?.message || String(error),
      });
      console.warn("[startup] non-critical startup job setup warning", {
        message: error?.message || String(error),
      });
    }

    if (failures.length > 0) {
      console.warn("STARTUP_SYNCS_FAILED_NON_BLOCKING", {
        failures,
        at: new Date().toISOString(),
      });
    }

    console.log("STARTUP_SYNCS_COMPLETED", {
      failures_count: failures.length,
      at: new Date().toISOString(),
    });
  } catch (error) {
    console.warn("STARTUP_SYNCS_FAILED_NON_BLOCKING", {
      message: error?.message || String(error),
      at: new Date().toISOString(),
    });
  }
};

const bootstrapServer = ({ skipStartupSyncs = false } = {}) =>
  new Promise((resolve) => {
    server.listen(PORT, HOST, () => {
      console.log("HTTP_LISTENER_READY", {
        host: HOST,
        port: PORT,
        at: new Date().toISOString(),
      });
      console.log("[server] listening on host/port", { host: HOST, port: PORT });
      console.log("[server] socket.io ready");
      console.log("[server] AI system active (v1 + v2)");
      runStartupDiagnostics();
      void runDeferredStartupSyncs({ skipStartupSyncs });
      resolve();
    });
  });

const bootstrapStartup = async () => {
  globalThis.__SCHEMA_STARTUP_RUNNING = true;
  try {
    await db.query("SELECT 1");
    await ensureNotificationsSchema(db);
    await ensureWebsiteSettingsSchema(db);
    await ensureSystemSettingsSchema(db);
    console.log("[server] database connected");
    await ensureDefaultTenantAndBackfillUsers();
    console.log("[server] default tenant bootstrap ensured");
    await ensureUsersLoginSchema();
    console.log("[server] users.last_login_at schema ensured");
    await ensureBranchSchema();
    await ensureSingleBranchModeOnce();
    console.log("[server] single branch mode ensured");
    await ensureProductSchema();
    console.log("[server] product schema ensured");
    await ensureProductVariantSchema();
    console.log("[server] product variant schema ensured");
    await ensureProductVariantImagesSchema(db);
    console.log("[server] product variant images schema ensured");
    await warmProductsMetadataCache(db);
    console.log("[server] products metadata cache warmed");
    await ensureVariantsInventorySchema(db);
    console.log("[server] variants inventory schema ensured");
    await ensureInventoryCountSchema();
    console.log("[server] inventory count schema ensured");
    await ensureOrdersSchema(db, null);
    console.log("[server] orders schema ensured");
    await ensureAccountingSchema();
    console.log("[server] accounting schema ensured");
    await repairOrdersShiftForeignKey(db, { source: "startup:after_orders_schema" });
    await repairOrdersSalesEmployeeForeignKey(db, { source: "startup:after_orders_schema" });
    await ensureProductClassificationSchema();
    console.log("[server] product classification schema ensured");
    await ensureStorefrontSchema();
    console.log("[server] storefront schema ensured");
    await ensureShippingSchema(db);
    console.log("[server] shipping schema ensured");
    await ensureStorefrontCustomerSessionSchema(db);
    console.log("[server] storefront customer session schema ensured");
    await ensureMarketingSchema();
    console.log("[server] marketing schema ensured");
    await ensureCouponsSchema();
    console.log("[server] coupons schema ensured");
    await ensureLoyaltySchema(db);
    await ensureAttendanceSchema(db);
    console.log("[server] attendance schema ensured");
    await ensureSalesCommissionSchema(db);
    console.log("[server] sales commission schema ensured");
    await ensureEmployeePenaltiesSchema(db);
    console.log("[server] employee penalties schema ensured");
    await ensureEmployeePayrollPortalSchema(db);
    console.log("[server] employee payroll portal schema ensured");
    await ensureDisplayRefillAlertSchema(db);
    console.log("[server] display refill alerts schema ensured");
    await ensureStaffTasksSchema(db);
    console.log("[server] staff tasks schema ensured");
    await ensureAiSupportLogSchema(db);
    console.log("[server] AI support log schema ensured");
    await ensureAiSalesAgentSchema(db);
    console.log("[server] AI sales agent schema ensured");
    await ensureAiInboxLeadActionsSchema(db);
    console.log("[server] AI inbox lead actions schema ensured");
    await ensureAiAgentOrderSchema(db);
    console.log("[server] AI agent order schema ensured");
    await ensureMetaIntegrationSchema(db);
    console.log("[server] meta integration schema ensured");
    await ensureSocialAutomationSettingsSchema(db);
    console.log("[server] social automation settings schema ensured");
    await repairCorruptedArabicText(db);
    await warmDashboardMetadataCache();
    console.log("[server] dashboard metadata cache warmed");
    await bootstrapServer({ skipStartupSyncs: shouldSkipStartupSyncs() });
    console.log("[schema] startup migration complete");
    console.log("[server] boot success");
  } catch (error) {
    logStartupFatal(error);
    process.exit(1);
  } finally {
    globalThis.__SCHEMA_STARTUP_RUNNING = false;
  }
};

try {
  await bootstrapStartup();
} catch (error) {
  logStartupFatal(error);
  process.exit(1);
}
