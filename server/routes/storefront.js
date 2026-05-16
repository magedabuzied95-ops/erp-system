import express from "express";
import {
  accountByPhone,
  createShipment,
  createWebsiteOrder,
  getProduct,
  listGenderClassifications,
  listLastPieceProducts,
  listNotifications,
  listProducts,
  listShippingProviders,
  saveRecentlyViewed,
  saveWishlist,
  searchProducts,
  trackOrder,
} from "../controllers/storefrontController.js";
import paymentProofUpload from "../config/paymentProofUpload.js";

const router = express.Router();
const checkoutUpload = (req, res, next) => {
  paymentProofUpload.single("shipping_payment_screenshot")(req, res, (error) => {
    if (error) {
      return res.status(400).json({
        success: false,
        message: "يرجى رفع صورة إثبات تحويل صالحة",
      });
    }
    next();
  });
};

router.get("/products", listProducts);
router.get("/classifications/gender", listGenderClassifications);
router.get("/last-piece", listLastPieceProducts);
router.get("/products/search", searchProducts);
router.get("/products/:id", getProduct);
router.post("/checkout", checkoutUpload, createWebsiteOrder);
router.get("/track", trackOrder);
router.post("/track", trackOrder);
router.get("/account", accountByPhone);
router.post("/wishlist", saveWishlist);
router.delete("/wishlist", saveWishlist);
router.post("/recently-viewed", saveRecentlyViewed);
router.get("/notifications", listNotifications);
router.get("/shipping/providers", listShippingProviders);
router.post("/shipping/orders/:orderId/create-shipment", createShipment);

export default router;
