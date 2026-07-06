import express from "express";
import db from "../database/db.js";
import { protect } from "../middleware/authMiddleware.js";
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
  regenerateAiShoeCover,
  updateProduct,
  updateProductPrices,
  updateProductStatus,
  updateVariant,
} from "../controllers/productsController.js";
import { generateAiProductDataController } from "../controllers/aiProductDataController.js";
import { suggestMirrorEditionName } from "../controllers/editionSuggestionsController.js";
import { generateProductDescription, generateSocialPublisherCaption } from "../services/openaiProductDescriptionService.js";
import { generateThermalArtwork } from "../services/thermalArtworkService.js";
import { getTenantId, tenantContextMissingResponse } from "../utils/requestScope.js";
import {
  bulkAddBarcodePrintQueueController,
  deleteBarcodePrintQueueController,
  getBarcodePrintQueue,
  markBarcodePrintQueuePrintedController,
  requeueBarcodePrintQueueController,
} from "../controllers/barcodePrintQueueController.js";

const router = express.Router();

router.use((req, res, next) => {
  console.log("[products] route hit:", req.method, req.originalUrl);
  next();
});

router.get("/admin-list", protect, getProductsAdminList);
router.get("/", protect, getProducts);
router.get("/with-variants", protect, getProductsWithVariants);
router.get("/:id/full", protect, getProductFull);
router.get("/qr/:token", protect, getProductByQrToken);
router.post("/generate-ai-data", protect, generateAiProductDataController);
router.post("/generate-description", protect, async (req, res) => {
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
router.post("/generate-social-caption", protect, async (req, res) => {
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
router.post("/generate-ai-thermal-artwork", protect, async (req, res) => {
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

    const sourceImageUrl = String(req.body?.image_url || req.body?.source_image_url || req.body?.cover_image_url || "").trim();
    const regenerate = req.body?.regenerate === true || String(req.body?.regenerate || "").toLowerCase() === "true";
    const existingThermalImageUrl = String(req.body?.thermal_image_url || "").trim();
    const productId = req.body?.product_id ?? req.body?.productId ?? null;
    const variantId = req.body?.variant_id ?? req.body?.variantId ?? null;
    const colorImageUrl = String(req.body?.color_image_url || req.body?.colorImageUrl || "").trim();

    console.log("THERMAL_ROUTE_REQUEST", {
      route: "/generate-ai-thermal-artwork",
      productId,
      variantId,
      imageUrl: sourceImageUrl,
      colorImageUrl,
    });

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

    console.log("THERMAL_ROUTE_BEFORE_OPENAI", {
      route: "/generate-ai-thermal-artwork",
      productId: productRow?.id || productId || null,
      variantId,
    });
    const result = await generateThermalArtwork({
      sourceImageUrl: sourceImageUrl || productRow?.image_url || productRow?.product_image_url || "",
      productId: productRow?.id || productId || null,
      tenantId,
      existingThermalImageUrl: existingThermalImageUrl || productRow?.thermal_image_url || "",
      regenerate,
      productName: productRow?.name || req.body?.product_name || req.body?.name || "",
    });
    console.log("THERMAL_ROUTE_AFTER_OPENAI", {
      route: "/generate-ai-thermal-artwork",
      productId: productRow?.id || productId || null,
      variantId,
      source: result.source || "",
      cached: result.cached === true,
      storage: result.storage || "",
    });

    console.log("[products] generate-ai-thermal-artwork end", {
      durationMs: Date.now() - startedAt,
      productId: productRow?.id || productId || "",
      source: result.source,
      cached: result.cached === true,
      storage: result.storage || "",
    });

    return res.json({
      success: true,
      thermal_image_url: result.thermal_image_url || "",
      source: result.source || "",
      cached: Boolean(result.cached),
      storage: result.storage || "",
      updated: result.updated === true,
      prompt: result.prompt || "",
      model: result.model || "",
    });
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
router.post("/:id/generate-ai-thermal-artwork", protect, async (req, res) => {
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

    const regenerate = req.body?.regenerate === true || String(req.body?.regenerate || "").toLowerCase() === "true";
    const variantId = req.body?.variant_id ?? req.body?.variantId ?? null;
    const colorImageUrl = String(req.body?.color_image_url || req.body?.colorImageUrl || "").trim();
    const imageUrl = String(req.body?.image_url || productRow.image_url || productRow.product_image_url || "").trim();
    console.log("THERMAL_PRODUCT_ROUTE_PAYLOAD", {
      route: "/:id/generate-ai-thermal-artwork",
      productId: req.params.id,
      bodyRegenerate: req.body?.regenerate,
      bodyKeys: Object.keys(req.body || {}),
    });

    console.log("THERMAL_ROUTE_REQUEST", {
      route: "/:id/generate-ai-thermal-artwork",
      productId,
      variantId,
      imageUrl,
      colorImageUrl,
    });

    console.log("THERMAL_ROUTE_BEFORE_OPENAI", {
      route: "/:id/generate-ai-thermal-artwork",
      productId,
      variantId,
    });
    const result = await generateThermalArtwork({
      sourceImageUrl: imageUrl,
      productId,
      tenantId,
      existingThermalImageUrl: String(req.body?.thermal_image_url || productRow.thermal_image_url || "").trim(),
      regenerate,
      productName: productRow.name || "",
    });
    console.log("THERMAL_ROUTE_AFTER_OPENAI", {
      route: "/:id/generate-ai-thermal-artwork",
      productId,
      variantId,
      source: result.source || "",
      cached: result.cached === true,
      storage: result.storage || "",
    });

    console.log("[products] product thermal artwork generated", {
      productId,
      durationMs: Date.now() - startedAt,
      source: result.source,
      cached: result.cached === true,
      updated: result.updated === true,
    });

    return res.json({
      success: true,
      thermal_image_url: result.thermal_image_url || "",
      source: result.source || "",
      cached: Boolean(result.cached),
      storage: result.storage || "",
      updated: result.updated === true,
      prompt: result.prompt || "",
      model: result.model || "",
    });
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
router.post("/suggest-edition", protect, suggestMirrorEditionName);
router.post("/edition-suggestions", protect, suggestMirrorEditionName);
router.get("/barcode-print-queue", protect, getBarcodePrintQueue);
router.post("/barcode-print-queue/bulk-add", protect, bulkAddBarcodePrintQueueController);
router.post("/barcode-print-queue/:id/mark-printed", protect, markBarcodePrintQueuePrintedController);
router.post("/barcode-print-queue/:id/requeue", protect, requeueBarcodePrintQueueController);
router.delete("/barcode-print-queue/:id", protect, deleteBarcodePrintQueueController);
router.post("/:id/regenerate-ai-shoe-cover", protect, regenerateAiShoeCover);
router.post("/", protect, createProduct);
router.post("/:id/variants", protect, createVariant);
router.put("/variants/:id", protect, updateVariant);
router.delete("/variants/:id", protect, deleteVariant);
router.put("/:id/prices", protect, updateProductPrices);
router.patch("/:id/status", protect, updateProductStatus);
router.put("/:id", protect, updateProduct);
router.delete("/:id", protect, deleteProduct);

export default router;
