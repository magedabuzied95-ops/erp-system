import jwt from "jsonwebtoken";

import { isPortalInboxRole, portalInboxSessionStillValid } from "./portalInboxAccess.js";

// A portal inbox session (see portalInboxAccess.js) may reach the AI Inbox message
// routes and the reads its composer needs — nothing else. Social comments, comment
// replies, private replies from a comment, settings and every other ERP route
// answer 403, whatever the role happens to hold.

const COMMENT_SEGMENT = /\/(comments?|social-comments|private-message)(\/|$)/i;
// Diagnostics and operator overrides that live beside the message routes.
const OPERATOR_ONLY_SEGMENT = /\/(ai-debug|ai-trace|ai-harness|ai-pipeline-debug|debug-messenger-profile|test-meta-send|force-send-last-ai-reply|reset-ai-state)(\/|$)/i;

const READ_ONLY_PATHS = [
  /^\/api\/auth\/me$/,
  /^\/api\/ai-inbox\/quick-replies$/,
  /^\/api\/ai-inbox\/shipping-quote$/,
  /^\/api\/products\/with-variants$/,
  /^\/api\/products\/available-sizes$/,
  /^\/api\/products\/by-size$/,
  /^\/api\/products\/pos-catalog-version$/,
  /^\/api\/product-classifications$/,
  /^\/api\/settings\/public$/,
  /^\/api\/shipping\/(cities|zones|districts)$/,
  /^\/api\/customers\/[^/]+\/profile$/,
];

const ANY_METHOD_PATHS = [
  /^\/api\/ai-(inbox|agent)\/conversations(\/.*)?$/,
  /^\/api\/ai-agent\/inbox\/[^/]+(\/.*)?$/,
  /^\/api\/ai-inbox\/push\/.+$/,
];

export const portalInboxPathAllowed = (method = "GET", rawPath = "") => {
  const path = String(rawPath || "").split("?")[0].replace(/\/+$/, "");
  if (COMMENT_SEGMENT.test(path) || OPERATOR_ONLY_SEGMENT.test(path)) return false;
  if (ANY_METHOD_PATHS.some((pattern) => pattern.test(path))) return true;
  return String(method).toUpperCase() === "GET" && READ_ONLY_PATHS.some((pattern) => pattern.test(path));
};

const deny = (res, status, message, code) => res.status(status).json({ success: false, code, message });

export const portalInboxApiBoundary = async (req, res, next) => {
  const authorization = String(req.headers.authorization || "");
  if (!authorization.startsWith("Bearer ")) return next();
  let decoded;
  try {
    decoded = jwt.verify(authorization.slice(7), process.env.JWT_SECRET || "SECRET_KEY");
  } catch {
    return next();
  }
  const isPortalSession = Boolean(decoded?.portal_inbox_employee_id) || isPortalInboxRole(decoded?.role);
  if (!isPortalSession) return next();

  if (!portalInboxPathAllowed(req.method, req.originalUrl || req.url)) {
    return deny(res, 403, "This session is limited to the messages inbox.", "PORTAL_INBOX_SCOPE");
  }
  try {
    const valid = await portalInboxSessionStillValid({
      employeeId: decoded.portal_inbox_employee_id,
      tokenFingerprint: decoded.portal_token_fp,
    });
    // 401 on purpose: the portal page re-mints the session, and a switched-off
    // employee gets the "not enabled" answer from there.
    if (!valid) return deny(res, 401, "Messages access was closed for this employee.", "PORTAL_INBOX_CLOSED");
    return next();
  } catch (error) {
    return next(error);
  }
};

export default portalInboxApiBoundary;
