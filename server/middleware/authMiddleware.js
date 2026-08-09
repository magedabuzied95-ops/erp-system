import jwt from "jsonwebtoken";
import db from "../database/db.js";
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

        const databaseUser = userResult.rows[0];
        if (!databaseUser && isMetaReviewerRole(decoded?.role)) {
          return res.status(401).json({ message: "Review account is no longer available" });
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
