import express from "express";

import { protect } from "../middleware/authMiddleware.js";
import {
  createProductClassificationGroup,
  createProductClassificationOption,
  deleteProductClassificationGroup,
  deleteProductClassificationOption,
  listProductClassificationOptions,
  listProductClassifications,
  updateProductClassificationGroup,
  updateProductClassificationOption,
} from "../controllers/productClassificationsController.js";

const router = express.Router();

router.get(["/", ""], listProductClassifications);
router.get("/:groupKey/options", listProductClassificationOptions);

router.post("/groups", protect, createProductClassificationGroup);
router.patch("/groups/:id", protect, updateProductClassificationGroup);
router.delete("/groups/:id", protect, deleteProductClassificationGroup);

router.post("/options", protect, createProductClassificationOption);
router.patch("/options/:id", protect, updateProductClassificationOption);
router.delete("/options/:id", protect, deleteProductClassificationOption);

export { router };
export default router;

if (typeof module !== "undefined") {
  module.exports = router;
}
