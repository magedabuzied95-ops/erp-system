import jwt from "jsonwebtoken";

import { isMetaReviewerRole } from "../services/metaReviewerAccessService.js";

const allowedReviewerPath = (req) => {
  const path = String(req.originalUrl || req.url || "").split("?")[0];
  const inboxPrefix = "/api/meta-reviewer/inbox";
  return path === "/api/auth/me" || path === inboxPrefix || path.startsWith(`${inboxPrefix}/`);
};

export const metaReviewerApiBoundary = (req, res, next) => {
  const authorization = String(req.headers.authorization || "");
  if (!authorization.startsWith("Bearer ")) return next();
  try {
    const decoded = jwt.verify(authorization.slice(7), process.env.JWT_SECRET || "SECRET_KEY");
    if (!isMetaReviewerRole(decoded?.role || decoded?.role_name)) return next();
    if (allowedReviewerPath(req)) return next();
    return res.status(403).json({ success: false, message: "This account is limited to the Meta review inbox." });
  } catch {
    return next();
  }
};

export default metaReviewerApiBoundary;
