import express from "express";

import { protect } from "../middleware/authMiddleware.js";
import {
  createManufacturer,
  deleteManufacturer,
  getManufacturers,
  updateManufacturer,
} from "../controllers/manufacturersController.js";

const router = express.Router();

router.get("/", protect, getManufacturers);
router.post("/", protect, createManufacturer);
router.put("/:id", protect, updateManufacturer);
router.delete("/:id", protect, deleteManufacturer);

export default router;
