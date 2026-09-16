/*
 * The ERP side of product reviews: the moderation queue. Mounted at /api/product-reviews.
 *
 * Reading the queue is a products:view right, deciding on a review is products:edit — the
 * same people who own what the product page says own what customers say on it. Rows here carry
 * the customer's full name and phone (the storefront never does): a manager judging a one-star
 * needs to be able to call.
 */

import express from "express";
import { protect } from "../middleware/authMiddleware.js";
import permit from "../middleware/permissionMiddleware.js";
import { getTenantId } from "../utils/requestScope.js";
import {
  REVIEW_STATUSES,
  getReviewCounts,
  listReviewsForModeration,
  moderateReview,
  replyToReview,
} from "../services/productReviewsService.js";

const router = express.Router();
const tid = (req) => getTenantId(req);

const fail = (res, error) =>
  res.status(error?.status || 500).json({ success: false, message: error?.message || "Request failed" });

router.get("/", protect, permit("products", "view"), async (req, res) => {
  try {
    const status = REVIEW_STATUSES.includes(String(req.query?.status || "")) ? String(req.query.status) : "pending";
    const [reviews, counts] = await Promise.all([
      listReviewsForModeration(tid(req), {
        status,
        limit: req.query?.limit,
        offset: req.query?.offset,
      }),
      getReviewCounts(tid(req)),
    ]);
    res.json({ success: true, status, reviews, counts });
  } catch (error) {
    fail(res, error);
  }
});

// status: published | rejected | pending (pending = send it back to the queue).
router.post("/:id/status", protect, permit("products", "edit"), async (req, res) => {
  try {
    const review = await moderateReview({
      tenantId: tid(req),
      reviewId: req.params.id,
      status: req.body?.status,
      note: req.body?.note || "",
      actorId: req.user?.id || null,
    });
    res.json({ success: true, review });
  } catch (error) {
    fail(res, error);
  }
});

// The shop's public answer. An empty body clears it.
router.post("/:id/reply", protect, permit("products", "edit"), async (req, res) => {
  try {
    const review = await replyToReview({ tenantId: tid(req), reviewId: req.params.id, body: req.body?.body || "" });
    res.json({ success: true, review });
  } catch (error) {
    fail(res, error);
  }
});

export default router;
