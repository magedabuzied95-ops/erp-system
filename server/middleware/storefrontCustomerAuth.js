import jwt from "jsonwebtoken";
import db from "../database/db.js";

const getBearerToken = (req = {}) => {
  const header = String(req.headers?.authorization || "").trim();
  if (!header.toLowerCase().startsWith("bearer ")) return "";
  return header.slice(7).trim();
};

export const hasStorefrontCustomerToken = (req = {}) => Boolean(getBearerToken(req));

export const requireStorefrontCustomerAuth = async (req, res, next) => {
  try {
    const token = getBearerToken(req);
    if (!token) {
      return res.status(401).json({ success: false, error: "OTP_REQUIRED" });
    }
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "SECRET_KEY");
    if (!decoded || decoded.type !== "storefront_customer") {
      return res.status(401).json({ success: false, error: "OTP_REQUIRED" });
    }
    const customerId = decoded.customer_id ?? decoded.customerId ?? null;
    let tenantId = decoded.tenant_id ?? null;
    let phone = decoded.phone ?? "";
    let email = decoded.email ?? "";
    let name = decoded.name ?? decoded.customer_name ?? "";
    if (customerId) {
      const result = await db.query(
        `
        SELECT name, phone, email, tenant_id
        FROM customers
        WHERE id = $1
        LIMIT 1
        `,
        [customerId]
      );
      const customer = result.rows?.[0] || null;
      if (customer) {
        name = customer.name ?? name ?? "";
        phone = customer.phone ?? phone ?? "";
        email = customer.email ?? email ?? "";
        tenantId = tenantId ?? customer.tenant_id ?? null;
      }
    }
    req.storefrontCustomer = {
      type: decoded.type,
      tenant_id: tenantId,
      phone,
      email,
      name,
      customer_id: customerId,
      auth_method: decoded.auth_method || "",
    };
    return next();
  } catch {
    return res.status(401).json({ success: false, error: "OTP_REQUIRED" });
  }
};

export default requireStorefrontCustomerAuth;
