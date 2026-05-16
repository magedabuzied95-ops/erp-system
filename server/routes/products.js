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
  updateVariant,
} from "../controllers/productsController.js";
import { generateAiProductDataController } from "../controllers/aiProductDataController.js";
import { suggestMirrorEditionName } from "../controllers/editionSuggestionsController.js";

const router = express.Router();

router.use((req, res, next) => {
  console.log("[products] route hit:", req.method, req.originalUrl);
  next();
});

router.get("/", protect, getProducts);
router.get("/with-variants", protect, getProductsWithVariants);
router.get("/qr/:token", protect, getProductByQrToken);
router.post("/generate-ai-data", protect, generateAiProductDataController);
router.post("/suggest-edition", protect, suggestMirrorEditionName);
router.post("/edition-suggestions", protect, suggestMirrorEditionName);
router.post("/", protect, createProduct);
router.post("/:id/variants", protect, createVariant);
router.put("/variants/:id", protect, updateVariant);
router.delete("/variants/:id", protect, deleteVariant);
router.put("/:id", protect, updateProduct);
router.delete("/:id", protect, deleteProduct);

export default router;
