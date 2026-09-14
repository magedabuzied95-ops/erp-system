import express from "express";
import { login, me, register } from "../controllers/authController.js";
import { protect, requireAdmin } from "../middleware/authMiddleware.js";

const router = express.Router();

// register takes role/role_id from the body and returns a signed token, so an
// open route let anyone on the internet mint an Admin account. Only an
// administrator may create accounts through it.
router.post("/register", protect, requireAdmin, register);
router.post("/login", login);
router.get("/me", protect, me);

export default router;
