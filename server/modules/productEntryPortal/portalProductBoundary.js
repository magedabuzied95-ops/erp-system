import jwt from "jsonwebtoken";

import { isPortalProductsRole, portalProductsSessionStillValid } from "./portalProductAccess.js";

// A portal product session (see portalProductAccess.js) may reach exactly what
// the ERP product pages the portal shows call — the products list, Add Product
// and the product editor: their lookups, image upload, the AI writing helpers,
// saving a product, its prices, its status flags and its pair. Deleting or
// purging a product, the label print queue, marketing, and every other ERP
// route answer 403 whatever the role happens to hold.

const ID = "\\d+";
const productPath = (rest) => new RegExp(`^/api/products/${ID}${rest}$`);

const READ_ONLY_PATHS = [
  /^\/api\/auth\/me$/,
  /^\/api\/settings\/public$/,
  /^\/api\/products\/entry-employees$/,
  /^\/api\/products\/with-variants$/,
  /^\/api\/products\/color-names$/,
  /^\/api\/products\/admin-list$/,
  productPath("/(full|color-usage|pair|lifecycle|lifecycle/events)"),
  new RegExp(`^/api/wholesale/products/${ID}$`),
  /^\/api\/product-classifications$/,
  /^\/api\/brands$/,
  /^\/api\/manufacturers$/,
];

const CREATE_PATHS = [
  /^\/api\/products$/,
  /^\/api\/products\/entry-employees\/verify$/,
  /^\/api\/product-classifications\/options$/,
  /^\/api\/brands$/,
  /^\/api\/manufacturers$/,
  /^\/api\/uploads?$/,
  /^\/api\/products\/suggest-edition$/,
  /^\/api\/products\/generate-ai-data$/,
  /^\/api\/products\/generate-description$/,
  /^\/api\/products\/generate-seo$/,
  productPath("/generate-ai-thermal-artwork"),
];

// Editing an existing product: the editor's save, the price editor, the list's
// status / offers / POS-favourite / storefront toggles, the pair picker.
const UPDATE_PATHS = {
  PUT: [productPath(""), productPath("/(prices|pair)"), new RegExp(`^/api/wholesale/products/${ID}$`)],
  PATCH: [productPath("/status")],
};

export const portalProductsPathAllowed = (method = "GET", rawPath = "") => {
  const path = String(rawPath || "").split("?")[0].replace(/\/+$/, "");
  const verb = String(method).toUpperCase();
  if (verb === "GET") return READ_ONLY_PATHS.some((pattern) => pattern.test(path));
  if (verb === "POST") return CREATE_PATHS.some((pattern) => pattern.test(path));
  return (UPDATE_PATHS[verb] || []).some((pattern) => pattern.test(path));
};

const deny = (res, status, message, code) => res.status(status).json({ success: false, code, message });

export const portalProductsApiBoundary = async (req, res, next) => {
  const authorization = String(req.headers.authorization || "");
  if (!authorization.startsWith("Bearer ")) return next();
  let decoded;
  try {
    decoded = jwt.verify(authorization.slice(7), process.env.JWT_SECRET || "SECRET_KEY");
  } catch {
    return next();
  }
  const isPortalSession = Boolean(decoded?.portal_products_employee_id) || isPortalProductsRole(decoded?.role);
  if (!isPortalSession) return next();

  if (!portalProductsPathAllowed(req.method, req.originalUrl || req.url)) {
    return deny(res, 403, "This session is limited to the product pages of the employee portal.", "PORTAL_PRODUCTS_SCOPE");
  }
  try {
    const valid = await portalProductsSessionStillValid({
      employeeId: decoded.portal_products_employee_id,
      tokenFingerprint: decoded.portal_token_fp,
    });
    // 401 on purpose: the portal page re-mints from the portal link, and an
    // employee who left (or whose link was regenerated) is refused there.
    if (!valid) return deny(res, 401, "This portal link no longer opens product entry.", "PORTAL_PRODUCTS_CLOSED");
    return next();
  } catch (error) {
    return next(error);
  }
};

export default portalProductsApiBoundary;
