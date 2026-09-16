import express from "express";
import {
  changeExpiredPassword,
  changeMyPassword,
  confirmLoginMfaEnrollment,
  confirmMyMfaEnrollment,
  disableMyMfa,
  getMySecurity,
  login,
  me,
  regenerateMyRecoveryCodes,
  register,
  startLoginMfaEnrollment,
  startMyMfaEnrollment,
  verifyLoginMfa,
} from "../controllers/authController.js";
import { protect, requireAdmin } from "../middleware/authMiddleware.js";
import { staffLoginIpRateLimit } from "../utils/staffLoginThrottle.js";

const router = express.Router();

// register takes role/role_id from the body and returns a signed token, so an
// open route let anyone on the internet mint an Admin account. Only an
// administrator may create accounts through it.
router.post("/register", protect, requireAdmin, register);
router.post("/login", staffLoginIpRateLimit, login);
router.get("/me", protect, me);

// Sign-in steps after the password (each needs the short-lived challenge_token from /login).
router.post("/login/mfa", staffLoginIpRateLimit, verifyLoginMfa);
router.post("/login/mfa-enroll/start", staffLoginIpRateLimit, startLoginMfaEnrollment);
router.post("/login/mfa-enroll/confirm", staffLoginIpRateLimit, confirmLoginMfaEnrollment);
router.post("/login/password-change", staffLoginIpRateLimit, changeExpiredPassword);

// Signed-in self-service.
router.get("/security", protect, getMySecurity);
router.post("/password", protect, staffLoginIpRateLimit, changeMyPassword);
router.post("/mfa/enroll/start", protect, startMyMfaEnrollment);
router.post("/mfa/enroll/confirm", protect, staffLoginIpRateLimit, confirmMyMfaEnrollment);
router.post("/mfa/disable", protect, staffLoginIpRateLimit, disableMyMfa);
router.post("/mfa/recovery-codes", protect, staffLoginIpRateLimit, regenerateMyRecoveryCodes);

export default router;
