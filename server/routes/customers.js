import express from "express";
import multer from "multer";
import { protect } from "../middleware/authMiddleware.js";
import permit from "../middleware/permissionMiddleware.js";
import {
  createCustomer,
  adjustCustomerWallet,
  deleteCustomer,
  getCustomerLoyalty,
  getCustomerLoyaltyHistory,
  getCustomerOrders,
  getCustomerProfile,
  getCustomerStatement,
  getCustomerEmployeeOptions,
  getCustomerWalletAudit,
  importCustomers,
  listCustomers,
  previewCustomerImport,
  updateCustomer,
} from "../controllers/customersController.js";

const router = express.Router();
const importUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /\.(csv|xls|xlsx)$/i.test(file.originalname || "");
    cb(allowed ? null : new Error("Only CSV, XLS, and XLSX files are allowed"), allowed);
  },
});

router.get("/", protect, permit("customers", "view"), listCustomers);
router.post("/import/preview", protect, permit("customers", "create"), importUpload.single("file"), previewCustomerImport);
router.post("/import/confirm", protect, permit("customers", "create"), importUpload.single("file"), importCustomers);
// Registered before "/:id/..." so "employee-options" is never read as an id.
router.get("/employee-options", protect, permit("customers", "edit"), getCustomerEmployeeOptions);
router.post("/", protect, permit("customers", "create"), createCustomer);
router.get("/:id/profile", protect, permit("customers", "view"), getCustomerProfile);
router.get("/:id/orders", protect, permit("customers", "view"), getCustomerOrders);
router.get("/:id/loyalty", protect, permit("customers", "view"), getCustomerLoyalty);
router.get("/:id/loyalty/history", protect, permit("customers", "view"), getCustomerLoyaltyHistory);
router.get("/:id/wallet/audit", protect, permit("customers", "view"), getCustomerWalletAudit);
router.get("/:id/statement", protect, permit("customers", "view"), getCustomerStatement);
router.post("/:id/wallet/adjust", protect, permit("customers", "edit"), adjustCustomerWallet);
router.put("/:id", protect, permit("customers", "edit"), updateCustomer);
router.delete("/:id", protect, permit("customers", "delete"), deleteCustomer);

export default router;
