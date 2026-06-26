import jwt from "jsonwebtoken";

const getBearerToken = (req = {}) => {
  const header = String(req.headers?.authorization || "").trim();
  if (!header.toLowerCase().startsWith("bearer ")) return "";
  return header.slice(7).trim();
};

export const requireStorefrontCustomerAuth = (req, res, next) => {
  try {
    const token = getBearerToken(req);
    if (!token) {
      return res.status(401).json({ success: false, message: "Not authorized, no token" });
    }
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "SECRET_KEY");
    if (!decoded || decoded.type !== "storefront_customer") {
      return res.status(401).json({ success: false, message: "Token failed" });
    }
    req.storefrontCustomer = {
      type: decoded.type,
      tenant_id: decoded.tenant_id ?? null,
      phone: decoded.phone ?? "",
    };
    return next();
  } catch {
    return res.status(401).json({ success: false, message: "Token failed" });
  }
};

export default requireStorefrontCustomerAuth;
