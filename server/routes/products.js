import express from "express";
import db from "../database/db.js";
import { protect } from "../middleware/authMiddleware.js";
import permit from "../middleware/permissionMiddleware.js";
import {
  createProduct,
  createVariant,
  deleteProduct,
  deleteVariant,
  getProductsAdminList,
  getProductFull,
  getProductByQrToken,
  getProducts,
  getProductsWithVariants,
  getPosCatalogVersion,
  getAvailableProductSizes,
  getProductsBySize,
  regenerateAiShoeCover,
  updateProduct,
  updateProductPrices,
  updateProductStatus,
  updateVariant,
} from "../controllers/productsController.js";
import { generateAiProductDataController } from "../controllers/aiProductDataController.js";
import { suggestMirrorEditionName } from "../controllers/editionSuggestionsController.js";
import { generateProductDescription, generateSocialPublisherCaption } from "../services/openaiProductDescriptionService.js";
import { getActiveBarcodePrintQueueItem } from "../services/barcodePrintQueueService.js";
import { scheduleThermalColorArtworkJobs } from "../services/thermalColorJobPlanner.js";
import { getTenantId, tenantContextMissingResponse } from "../utils/requestScope.js";
import {
  bulkAddBarcodePrintQueueController,
  deleteBarcodePrintQueueController,
  getBarcodePrintQueue,
  markBarcodePrintQueuePrintedController,
  requeueBarcodePrintQueueController,
} from "../controllers/barcodePrintQueueController.js";

const router = express.Router();

const normalizeThermalText = (value = "") => String(value || "").trim();
const normalizeThermalColorKey = (body = {}) =>
  normalizeThermalText(
    body?.color_key ||
      body?.colorKey ||
      body?.color ||
      body?.color_name ||
      body?.colorName ||
      body?.color_group_id ||
      body?.colorGroupId ||
      body?.color_id ||
      body?.colorId ||
      body?.group_id ||
      body?.groupId
  ).toLowerCase();
const normalizeThermalVariantIds = (value = []) => {
  const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  return [...new Set(raw.map((item) => Number(item)).filter((item) => Number.isFinite(item) && item > 0))];
};

const handleQueuedThermalColorRequest = async ({
  req,
  res,
  tenantId,
  productId,
  productRow,
  route,
}) => {
  const regenerate = req.body?.regenerate === true || String(req.body?.regenerate || "").toLowerCase() === "true";
  const colorImageUrl = normalizeThermalText(req.body?.color_image_url || req.body?.colorImageUrl);
  const sourceImageUrl = normalizeThermalText(req.body?.image_url || req.body?.source_image_url || req.body?.cover_image_url);
  const existingThermalImageUrl = normalizeThermalText(
    req.body?.thermal_image_url || req.body?.ai_thermal_artwork_url || req.body?.aiThermalArtworkUrl
  );
  const color = normalizeThermalText(req.body?.color || req.body?.color_name || req.body?.colorName);
  const colorKey = normalizeThermalColorKey(req.body || {});
  const variantIds = normalizeThermalVariantIds(req.body?.variant_ids || req.body?.variantIds || []);

  if (!productId || !colorImageUrl || !colorKey) {
    console.log("AI_THERMAL_BLOCK_PRODUCT_COVER", {
      route,
      productId,
      color,
      colorKey,
      sourceImageUrl,
      colorImageUrl,
      reason: !productId ? "missing_product_id" : !colorImageUrl ? "missing_color_image" : "missing_color_identifier",
    });
    return res.status(400).json({
      success: false,
      message: "AI Thermal Artwork requires a saved product color image",
      status: "blocked_product_cover",
      thermal_image_url: "",
    });
  }

  if (sourceImageUrl && sourceImageUrl !== colorImageUrl) {
    console.log("AI_THERMAL_BLOCK_PRODUCT_COVER", {
      route,
      productId,
      color,
      colorKey,
      sourceImageUrl,
      colorImageUrl,
      reason: "non_color_source_image",
    });
  }

  if (existingThermalImageUrl && !regenerate) {
    console.log("AI_THERMAL_SKIP_EXISTING_COLOR", {
      route,
      productId,
      color,
      colorKey,
      thermalImageUrl: existingThermalImageUrl,
    });
    return res.json({
      success: true,
      status: "skipped_existing",
      queued: false,
      thermal_image_url: existingThermalImageUrl,
    });
  }

  const activeJob = await getActiveBarcodePrintQueueItem({
    tenantId,
    productId,
    colorKey,
  });
  if (activeJob) {
    console.log("AI_THERMAL_SKIP_ACTIVE_JOB", {
      route,
      productId,
      color,
      colorKey,
      activeStatus: activeJob.status,
    });
    return res.json({
      success: true,
      status: "skipped_active_job",
      queued: false,
      thermal_image_url: "",
    });
  }

  scheduleThermalColorArtworkJobs({
    productId,
    tenantId,
    productName: productRow?.name || normalizeThermalText(req.body?.product_name || req.body?.name),
    groups: [
      {
        productId,
        color,
        colorKey,
        primaryImageUrl: colorImageUrl,
        existingThermalUrl: existingThermalImageUrl,
        variantIds,
        representativeVariantId: variantIds[0] || null,
        source: "color-group",
        regenerate,
        explicitRegenerate: regenerate,
      },
    ],
    previousThermalUrlMap: existingThermalImageUrl ? new Map([[colorImageUrl.toLowerCase(), existingThermalImageUrl]]) : new Map(),
  });

  console.log("AI_THERMAL_CREATE_COLOR_JOB", {
    route,
    productId,
    color,
    colorKey,
    colorImageUrl,
    variantIds,
    regenerate,
  });

  return res.json({
    success: true,
    status: "queued",
    queued: true,
    thermal_image_url: "",
  });
};

router.use((req, res, next) => {
  console.log("[products] route hit:", req.method, req.originalUrl);
  next();
});

router.get("/admin-list", protect, permit("products", "view"), getProductsAdminList);
router.get("/", protect, permit("products", "view"), getProducts);
router.get("/with-variants", protect, permit("products", "view"), getProductsWithVariants);
router.get("/pos-catalog-version", protect, permit("products", "view"), getPosCatalogVersion);
router.get("/available-sizes", protect, permit("products", "view"), getAvailableProductSizes);
router.get("/by-size", protect, permit("products", "view"), getProductsBySize);
router.get("/:id/full", protect, permit("products", "view"), getProductFull);
router.get("/qr/:token", protect, permit("products", "view"), getProductByQrToken);
router.post("/generate-ai-data", protect, permit("products", "edit"), generateAiProductDataController);
router.post("/generate-description", protect, permit("products", "edit"), async (req, res) => {
  const startedAt = Date.now();
  const requestId = `product-description-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    console.log("[products] generate-description start", {
      requestId,
      target: req.body?.target || "all",
      productName: req.body?.current?.product_name || req.body?.current?.name || req.body?.product_name || req.body?.name || "",
    });
    const result = await generateProductDescription({
      ...(req.body || {}),
      request_id: requestId,
    });
    console.log("[products] generate-description end", {
      requestId,
      source: result.source,
      durationMs: Date.now() - startedAt,
    });
    res.json({
      success: true,
      arabic_description: result.arabic_description || "",
      english_description: result.english_description || "",
      source: result.source,
      error: result.error,
    });
  } catch (error) {
    console.error("[products] generate-description failed", {
      requestId,
      durationMs: Date.now() - startedAt,
      message: error?.message,
      stack: error?.stack,
    });
    res.status(500).json({
      success: false,
      message: process.env.NODE_ENV === "production" ? "Product description generation failed" : error?.message || "Product description generation failed",
      arabic_description: "",
      english_description: "",
    });
  }
});
router.post("/generate-social-caption", protect, permit("products", "edit"), async (req, res) => {
  const startedAt = Date.now();
  const requestId = `social-caption-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    console.log("[products] generate-social-caption start", {
      requestId,
      productName: req.body?.current?.product_name || req.body?.current?.name || req.body?.product_name || req.body?.name || "",
    });
    const result = await generateSocialPublisherCaption({
      ...(req.body || {}),
      request_id: requestId,
    });
    console.log("[products] generate-social-caption end", {
      requestId,
      source: result.source,
      durationMs: Date.now() - startedAt,
    });
    res.json({
      success: true,
      caption: result.caption || "",
      hook: result.hook || "",
      body: result.body || "",
      cta: result.cta || "",
      hashtags: result.hashtags || [],
      source: result.source,
      error: result.error,
      error_reason: result.error_reason || "",
    });
  } catch (error) {
    console.error("[products] generate-social-caption failed", {
      requestId,
      durationMs: Date.now() - startedAt,
      message: error?.message,
      stack: error?.stack,
    });
    res.status(500).json({
      success: false,
      message: process.env.NODE_ENV === "production" ? "Social caption generation failed" : error?.message || "Social caption generation failed",
      caption: "",
    });
  }
});
router.post("/generate-ai-thermal-artwork", protect, permit("products", "edit"), async (req, res) => {
  const startedAt = Date.now();
  try {
    console.log("THERMAL_ROUTE_START", {
      route: "/generate-ai-thermal-artwork",
      method: req.method,
      path: req.path,
    });
    const tenantId = getTenantId(req, req.user?.tenant_id);
    if (!tenantId) {
      return tenantContextMissingResponse(res);
    }

    const productId = req.body?.product_id ?? req.body?.productId ?? null;

    let productRow = null;
    if (Number.isFinite(Number(productId)) && Number(productId) > 0) {
      const result = await db.query(
        `
        SELECT id, tenant_id, name, image_url, product_image_url, thermal_image_url
        FROM products
        WHERE id = $1
          AND tenant_id = $2
        LIMIT 1
        `,
        [Number(productId), tenantId]
      );
      productRow = result.rows[0] || null;
      if (!productRow) {
        return res.status(404).json({
          success: false,
          message: "Product not found",
        });
      }
    }

    const response = await handleQueuedThermalColorRequest({
      req,
      res,
      tenantId,
      productId: productRow?.id || Number(productId) || null,
      productRow,
      route: "/generate-ai-thermal-artwork",
    });
    console.log("[products] generate-ai-thermal-artwork end", {
      durationMs: Date.now() - startedAt,
      productId: productRow?.id || productId || "",
    });
    return response;
  } catch (error) {
    console.error("THERMAL_ROUTE_ERROR", {
      route: "/generate-ai-thermal-artwork",
      message: error?.message,
      stack: error?.stack,
      status: error?.status,
      code: error?.code,
      response: error?.response?.data,
      cause: error?.cause?.message,
    });
    console.error("THERMAL_ARTWORK_ROUTE_ERROR", {
      message: error?.message,
      stack: error?.stack,
      status: error?.status,
      code: error?.code,
      response: error?.response?.data,
      cause: error?.cause?.message,
    });
    return res.status(500).json({
      success: false,
      message: "Thermal artwork generation failed",
      debug_message: error?.message,
      debug_code: error?.code,
      debug_status: error?.status,
      thermal_image_url: "",
    });
  }
});
router.post("/:id/generate-ai-thermal-artwork", protect, permit("products", "edit"), async (req, res) => {
  const startedAt = Date.now();
  try {
    console.log("THERMAL_ROUTE_START", {
      route: "/:id/generate-ai-thermal-artwork",
      method: req.method,
      path: req.path,
    });
    const tenantId = getTenantId(req, req.user?.tenant_id);
    if (!tenantId) {
      return tenantContextMissingResponse(res);
    }

    const productId = Number(req.params.id || 0);
    if (!Number.isFinite(productId) || productId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid product id",
      });
    }

    const productResult = await db.query(
      `
      SELECT id, tenant_id, name, image_url, product_image_url, thermal_image_url
      FROM products
      WHERE id = $1
        AND tenant_id = $2
      LIMIT 1
      `,
      [productId, tenantId]
    );
    const productRow = productResult.rows[0] || null;
    if (!productRow) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    console.log("THERMAL_PRODUCT_ROUTE_PAYLOAD", {
      route: "/:id/generate-ai-thermal-artwork",
      productId: req.params.id,
      bodyRegenerate: req.body?.regenerate,
      bodyKeys: Object.keys(req.body || {}),
    });

    const response = await handleQueuedThermalColorRequest({
      req,
      res,
      tenantId,
      productId,
      productRow,
      route: "/:id/generate-ai-thermal-artwork",
    });

    console.log("[products] product thermal artwork generated", {
      productId,
      durationMs: Date.now() - startedAt,
    });
    return response;
  } catch (error) {
    console.error("THERMAL_ROUTE_ERROR", {
      route: "/:id/generate-ai-thermal-artwork",
      message: error?.message,
      stack: error?.stack,
      status: error?.status,
      code: error?.code,
      response: error?.response?.data,
      cause: error?.cause?.message,
    });
    console.error("THERMAL_ARTWORK_ROUTE_ERROR", {
      message: error?.message,
      stack: error?.stack,
      status: error?.status,
      code: error?.code,
      response: error?.response?.data,
      cause: error?.cause?.message,
    });
    return res.status(500).json({
      success: false,
      message: "Thermal artwork generation failed",
      debug_message: error?.message,
      debug_code: error?.code,
      debug_status: error?.status,
      thermal_image_url: "",
    });
  }
});
router.post("/suggest-edition", protect, permit("products", "edit"), suggestMirrorEditionName);
router.post("/edition-suggestions", protect, permit("products", "edit"), suggestMirrorEditionName);
router.get("/barcode-print-queue", protect, permit("products", "barcode_shop"), getBarcodePrintQueue);
router.post("/barcode-print-queue/bulk-add", protect, permit("products", "barcode_shop"), bulkAddBarcodePrintQueueController);
router.post("/barcode-print-queue/:id/mark-printed", protect, permit("products", "barcode_shop"), markBarcodePrintQueuePrintedController);
router.post("/barcode-print-queue/:id/requeue", protect, permit("products", "barcode_shop"), requeueBarcodePrintQueueController);
router.delete("/barcode-print-queue/:id", protect, permit("products", "barcode_shop"), deleteBarcodePrintQueueController);
router.post("/:id/regenerate-ai-shoe-cover", protect, permit("products", "edit"), regenerateAiShoeCover);
router.post("/", protect, permit("products", "create"), createProduct);
router.post("/:id/variants", protect, permit("products", "edit"), createVariant);
router.put("/variants/:id", protect, permit("products", "edit"), updateVariant);
router.delete("/variants/:id", protect, permit("products", "delete"), deleteVariant);
router.put("/:id/prices", protect, permit("products", "edit"), updateProductPrices);
router.patch("/:id/status", protect, permit("products", "edit"), updateProductStatus);
router.put("/:id", protect, permit("products", "edit"), updateProduct);
router.delete("/:id", protect, permit("products", "delete"), deleteProduct);

export default router;
