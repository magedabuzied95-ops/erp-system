import express from "express";

import {
  getPublicInvoiceByToken,
  getPublicInvoicePdfByToken,
} from "../controllers/ordersController.js";

const router = express.Router();

router.get("/:token", getPublicInvoiceByToken);
router.get("/:token/pdf", getPublicInvoicePdfByToken);

export default router;
