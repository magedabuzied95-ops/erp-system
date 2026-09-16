import permit from "../../middleware/permissionMiddleware.js";
import { recordSecurityEvent } from "./securityAudit.js";

// Gate for every route that returns or changes Amazon Information (SP-API data):
//   1. the role must hold amazon.<action> (admins pass permit() as everywhere else);
//   2. the account must have MFA enabled - Amazon data is never served to a password-only session;
//   3. every allowed or refused access is written to security_audit_events.
// Usage: router.get("/orders", protect, requireAmazonAccess("view"), handler)

export const AMAZON_PERMISSIONS = Object.freeze([
  ["amazon", "view"],
  ["amazon", "manage"],
]);

export const requireAmazonAccess = (action = "view") => {
  const permissionGate = permit("amazon", action);
  return (req, res, next) => {
    const base = () => ({
      req,
      eventType: "amazon_access",
      userId: req.user?.id ?? null,
      tenantId: req.user?.tenant_id ?? null,
      details: { action, method: req.method, path: String(req.originalUrl || "").split("?")[0] },
    });
    let passedPermission = false;
    // permit() answers a refusal itself, so the denial is caught on the way out.
    res.once?.("finish", () => {
      if (!passedPermission && res.statusCode === 403) {
        void recordSecurityEvent({ ...base(), outcome: "denied_permission" });
      }
    });
    return permissionGate(req, res, async (permissionError) => {
      if (permissionError) return next(permissionError);
      passedPermission = true;
      if (req.user?.mfa_enabled !== true) {
        await recordSecurityEvent({ ...base(), outcome: "denied_mfa_missing" });
        return res.status(403).json({
          success: false,
          code: "MFA_REQUIRED_FOR_AMAZON",
          message: "الوصول لبيانات أمازون يتطلب تفعيل التحقق الثنائي على حسابك",
        });
      }
      await recordSecurityEvent({ ...base(), outcome: "allowed" });
      return next();
    });
  };
};
