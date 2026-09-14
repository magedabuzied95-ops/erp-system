import jwt from "jsonwebtoken";
import db from "../database/db.js";
import { getPhoneSearchVariants } from "../utils/phoneSearch.js";

const getBearerToken = (req = {}) => {
  const header = String(req.headers?.authorization || "").trim();
  if (!header.toLowerCase().startsWith("bearer ")) return "";
  return header.slice(7).trim();
};

export const hasStorefrontCustomerToken = (req = {}) => Boolean(getBearerToken(req));

// The phone this request has proven it owns, or "". Only the token /auth/verify-otp signs counts:
// it carries no auth_method. An email/password token also carries a phone, but that phone was
// typed at registration and never checked, so it proves nothing.
export const readOtpVerifiedStorefrontPhone = (req = {}) => {
  const token = getBearerToken(req);
  if (!token) return "";
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "SECRET_KEY");
    if (!decoded || decoded.type !== "storefront_customer" || decoded.auth_method) return "";
    return String(decoded.phone || "").trim();
  } catch {
    return "";
  }
};

// Customer tokens live for years and used to be checked for their signature alone, so a token
// taken from a shared device or a hijacked session kept working after the owner reset their
// password, and a customer staff set to inactive kept full access. A token is now refused when
// the customer is inactive, or when it was issued before the password last changed. The grace
// covers `iat` being whole seconds and the Node and database clocks differing slightly, so the
// token handed out in the same moment as a new password is not refused on its first use.
const TOKEN_ISSUED_GRACE_MS = 5_000;
export const isStorefrontTokenRevoked = ({ decoded = {}, customer = null } = {}) => {
  if (!customer) return false;
  if (String(customer.status || "").trim().toLowerCase() === "inactive") return true;
  const changedAt = customer.password_changed_at ? new Date(customer.password_changed_at).getTime() : NaN;
  const issuedAt = Number(decoded?.iat) * 1000;
  if (!Number.isFinite(changedAt)) return false;
  if (!Number.isFinite(issuedAt)) return true;
  return issuedAt + TOKEN_ISSUED_GRACE_MS < changedAt;
};

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
        SELECT name, phone, email, tenant_id, status, password_changed_at
        FROM customers
        WHERE id = $1
        LIMIT 1
        `,
        [customerId]
      );
      const customer = result.rows?.[0] || null;
      if (isStorefrontTokenRevoked({ decoded, customer })) {
        return res.status(401).json({ success: false, error: "OTP_REQUIRED" });
      }
      if (customer) {
        name = customer.name ?? name ?? "";
        phone = customer.phone ?? phone ?? "";
        email = customer.email ?? email ?? "";
        tenantId = tenantId ?? customer.tenant_id ?? null;
      }
    } else if (phone) {
      // An OTP token names only a phone. The customer on that phone decides whether it still counts.
      const variants = getPhoneSearchVariants(phone);
      const result = variants.length
        ? await db.query(
          `
          SELECT status, password_changed_at
          FROM customers
          WHERE ($1::bigint IS NULL OR tenant_id = $1::bigint)
            AND phone = ANY($2::text[])
          ORDER BY updated_at DESC NULLS LAST, id DESC
          LIMIT 1
          `,
          [Number(tenantId) || null, variants]
        )
        : { rows: [] };
      if (isStorefrontTokenRevoked({ decoded, customer: result.rows?.[0] || null })) {
        return res.status(401).json({ success: false, error: "OTP_REQUIRED" });
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
