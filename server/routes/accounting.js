import express from "express";

import {
  createJournalEntryController,
  getAccountingDashboardController,
  getAccountingSummary,
  getJournalEntriesController,
  getJournalEntryDetailController,
} from "../controllers/accountingController.js";

import { protect } from "../middleware/authMiddleware.js";

import permit from "../middleware/permissionMiddleware.js";

const router = express.Router();

/* ======================================================
   ACCOUNTING SUMMARY
====================================================== */

router.get(
  "/summary",

  protect,
  permit("accounting", "view"),
  getAccountingSummary
);

router.get(
  "/dashboard",
  protect,
  permit("accounting", "view"),
  getAccountingDashboardController
);

router.get(
  "/journal-entries",
  protect,
  permit("accounting", "view"),
  getJournalEntriesController
);

router.get(
  "/journal-entries/:id",
  protect,
  permit("accounting", "view"),
  getJournalEntryDetailController
);

router.post(
  "/journal-entries",
  protect,
  permit("accounting", "create"),
  createJournalEntryController
);

export default router;
