import jwt from "jsonwebtoken";
import db from "../database/db.js";
import { stripSensitiveUserFields } from "../utils/sanitizeUser.js";
import { ensureDefaultTenantAndBackfillUsers } from "../utils/tenantBootstrap.js";
import { isMetaReviewerRole, metaReviewerAccountExpired } from "../services/metaReviewerAccessService.js";

let tenantBootstrapPromise = null;

const ensureTenantBootstrapOnce = async () => {
  if (!tenantBootstrapPromise) {
    tenantBootstrapPromise = ensureDefaultTenantAndBackfillUsers().catch((error) => {
      tenantBootstrapPromise = null;
      throw error;
    });
  }
  return tenantBootstrapPromise;
};

/**
 * Only the staff login (authController) mints a token with a user id and no
 * `type`/`scope` claim; every other token signed with JWT_SECRET is not a session.
 */
export const isStaffSessionToken = (decoded) =>
  Boolean(decoded) &&
  typeof decoded === "object" &&
  !decoded.type &&
  !decoded.scope &&
  decoded.id !== undefined &&
  decoded.id !== null &&
  String(decoded.id).trim() !== "";

export const protect = async (
  req,
  res,
  next
) => {

  try {

    let token =
      req.headers.authorization;

    if (
      token &&
      token.startsWith("Bearer")
    ) {

      token =
        token.split(" ")[1];

      const decoded =
        jwt.verify(

          token,

          process.env.JWT_SECRET || "SECRET_KEY"
        );

      // The storefront OTP/email login and the manager profit-lock sign with the
      // same JWT_SECRET. Without this gate a shopper's token passed `protect`
      // and read staff routes such as /api/pos/recent-orders.
      if (!isStaffSessionToken(decoded)) {
        return res.status(401).json({ message: "Not authorized, not a staff session" });
      }

      try {
        await ensureTenantBootstrapOnce();
        const userResult = await db.query(
          `
          SELECT
            u.*,
            r.name AS role_name
          FROM users u
          LEFT JOIN roles r ON u.role_id = r.id
          WHERE u.id = $1
          LIMIT 1
          `,
          [decoded.id]
        );

        const databaseUser = stripSensitiveUserFields(userResult.rows[0]);
        if (!databaseUser) {
          // A deleted account's token used to keep working on its signed claims.
          return res.status(401).json({
            message: isMetaReviewerRole(decoded?.role) ? "Review account is no longer available" : "Account no longer exists",
          });
        }
        if (databaseUser?.is_active === false) {
          return res.status(403).json({ message: "Account disabled" });
        }
        const effectiveRole = databaseUser?.role || databaseUser?.role_name || decoded?.role;
        if (isMetaReviewerRole(effectiveRole) && (!databaseUser?.account_expires_at || metaReviewerAccountExpired(databaseUser.account_expires_at))) {
          return res.status(403).json({ message: "Temporary review account expired" });
        }
        req.user =
          databaseUser
            ? {
                ...decoded,
                ...databaseUser,
                role: effectiveRole,
              }
            : decoded;
        req.tenantId = req.user?.tenant_id ?? req.user?.tenantId ?? null;
        req.tenant = req.tenantId ? { id: req.tenantId } : undefined;
      } catch {
        if (isMetaReviewerRole(decoded?.role)) {
          return res.status(401).json({ message: "Review account could not be verified" });
        }
        req.user = decoded;
        req.tenantId = req.user?.tenant_id ?? req.user?.tenantId ?? null;
        req.tenant = req.tenantId ? { id: req.tenantId } : undefined;
      }

      console.log("[auth] user available", {
        userId: req.user?.id ?? null,
        role: req.user?.role || req.user?.role_name || decoded.role || null,
        tenantId: req.user?.tenant_id ?? null,
        isSuperAdmin: Boolean(req.user?.is_super_admin),
      });

      next();

    } else {

      return res.status(401).json({

        message:
          "Not authorized, no token"
      });
    }

  } catch {

    return res.status(401).json({

      message:
        "Token failed"
    });
  }
};

const ADMIN_ROLE_NAMES = ["admin", "super admin", "superadmin", "platform admin"];

const normalizeRoleName = (value = "") =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ");

/**
 * The gate for actions no permission row should ever be able to grant - today
 * that is the hard product purge. Deliberately narrower than `permit()`, which
 * resolves a user four different ways: this asks only whether the account is
 * admin-shaped or carries the super-admin flag.
 */
export const isAdminAccount = (user = {}) =>
  user?.is_super_admin === true ||
  ADMIN_ROLE_NAMES.includes(normalizeRoleName(user?.role)) ||
  ADMIN_ROLE_NAMES.includes(normalizeRoleName(user?.role_name));

export const requireAdmin = (req, res, next) => {
  if (isAdminAccount(req.user)) return next();
  return res.status(403).json({
    success: false,
    code: "ADMIN_ONLY",
    message: "This action is restricted to administrators.",
  });
};
