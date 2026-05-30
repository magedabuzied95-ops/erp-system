import jwt from "jsonwebtoken";
import db from "../database/db.js";
import { ensureDefaultTenantAndBackfillUsers } from "../utils/tenantBootstrap.js";

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

        req.user =
          userResult.rows[0]
            ? {
                ...decoded,
                ...userResult.rows[0],
                role: userResult.rows[0].role || userResult.rows[0].role_name || decoded.role,
              }
            : decoded;
        req.tenantId = req.user?.tenant_id ?? req.user?.tenantId ?? null;
        req.tenant = req.tenantId ? { id: req.tenantId } : undefined;
      } catch {
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
