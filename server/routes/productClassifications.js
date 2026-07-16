import express from "express";

import { protect } from "../middleware/authMiddleware.js";
import permit from "../middleware/permissionMiddleware.js";
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

router.post("/groups", protect, permit("products", "create"), createProductClassificationGroup);
router.patch("/groups/:id", protect, permit("products", "edit"), updateProductClassificationGroup);
router.delete("/groups/:id", protect, permit("products", "delete"), deleteProductClassificationGroup);

router.post("/options", protect, permit("products", "create"), createProductClassificationOption);
router.patch("/options/:id", protect, permit("products", "edit"), updateProductClassificationOption);
router.delete("/options/:id", protect, permit("products", "delete"), deleteProductClassificationOption);

export { router };
export default router;

if (typeof module !== "undefined") {
  module.exports = router;
}
