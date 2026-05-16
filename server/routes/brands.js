import express from "express";

import { protect } from "../middleware/authMiddleware.js";
import { createBrand, deleteBrand, getBrands, updateBrand } from "../controllers/brandsController.js";

const router = express.Router();

router.get("/", protect, getBrands);
router.post("/", protect, createBrand);
router.put("/:id", protect, updateBrand);
router.delete("/:id", protect, deleteBrand);

export default router;
