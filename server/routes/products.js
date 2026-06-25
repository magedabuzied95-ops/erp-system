import express from "express";
import { protect } from "../middleware/authMiddleware.js";
import {
  createProduct,
  createVariant,
  deleteProduct,
  deleteVariant,
  getProductByQrToken,
  getProducts,
  getProductsWithVariants,
  updateProduct,
  updateProductPrices,
  updateProductStatus,
  updateVariant,
} from "../controllers/productsController.js";
import { generateAiProductDataController } from "../controllers/aiProductDataController.js";
import { suggestMirrorEditionName } from "../controllers/editionSuggestionsController.js";
import { generateProductDescription, generateSocialPublisherCaption } from "../services/openaiProductDescriptionService.js";

const router = express.Router();

router.use((req, res, next) => {
  console.log("[products] route hit:", req.method, req.originalUrl);
  next();
});

router.get("/", protect, getProducts);
router.get("/with-variants", protect, getProductsWithVariants);
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
      source: result.source,
      error: result.error,
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
router.post("/suggest-edition", protect, suggestMirrorEditionName);
router.post("/edition-suggestions", protect, suggestMirrorEditionName);
router.post("/", protect, createProduct);
router.post("/:id/variants", protect, createVariant);
router.put("/variants/:id", protect, updateVariant);
router.delete("/variants/:id", protect, deleteVariant);
router.put("/:id/prices", protect, updateProductPrices);
router.patch("/:id/status", protect, updateProductStatus);
router.put("/:id", protect, updateProduct);
router.delete("/:id", protect, deleteProduct);

export default router;
