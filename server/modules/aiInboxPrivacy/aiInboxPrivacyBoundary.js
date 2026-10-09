import jwt from "jsonwebtoken";

import {
  isConversationVisibleToViewer,
  tenantUsesConversationPrivacy,
} from "./conversationPrivacy.js";
import { resolveInboxViewer } from "./inboxViewer.js";

// One door for ~50 conversation-scoped inbox routes.
//
// The list query already hides a private conversation, but that is not enough on
// its own: targeted `sessionKeys` lookups skip the list filters by design so
// send/reply can resolve an id, and a conversation id pasted into the URL would
// otherwise open the thread. So every request that names a conversation passes
// through here, before protect, and a viewer who may not see it gets 403 —
// including on reply, send, read, delete and product-card routes, and including
// any route added later.
//
// Mounted in server.js next to portalInboxBoundary. It costs nothing for a shop
// that hides nothing: the tenant check is cached and returns first.

const CONVERSATION_PATH = /^\/api\/ai-(?:inbox|agent)\/(?:conversations|inbox)\/([^/?]+)/i;
// Collection actions that are not a conversation id.
const COLLECTION_SEGMENTS = new Set(["read-all", "readall", "unread-all"]);

const text = (value = "") => String(value ?? "").trim();

export const conversationIdFromPath = (rawPath = "") => {
  const path = text(rawPath).split("?")[0];
  const match = CONVERSATION_PATH.exec(path);
  if (!match) return "";
  let id = match[1];
  try {
    id = decodeURIComponent(id);
  } catch {
    // A malformed escape is not an id we can resolve; fall through with the raw value.
  }
  if (COLLECTION_SEGMENTS.has(id.toLowerCase())) return "";
  return text(id);
};

// Some routes carry the conversation in the body instead (draft orders, suggested
// replies). The body parser runs before this middleware, so it is readable here.
export const conversationIdFromBody = (body = {}) => {
  if (!body || typeof body !== "object") return "";
  return text(body.conversation_id || body.conversationId || body.session_id || body.sessionId);
};

const isInboxApiPath = (rawPath = "") => /^\/api\/ai-(?:inbox|agent)\//i.test(text(rawPath).split("?")[0]);

/**
 * `deps` exists for the tests: Express only ever passes (req, res, next), so the
 * defaults are what runs in production.
 */
export const runAiInboxPrivacyBoundary = async (req, res, next, deps = {}) => {
  const {
    usesPrivacy = tenantUsesConversationPrivacy,
    resolveViewer = resolveInboxViewer,
    isVisible = isConversationVisibleToViewer,
    verify = (token) => jwt.verify(token, process.env.JWT_SECRET || "SECRET_KEY"),
  } = deps;
  try {
    const rawPath = req.originalUrl || req.url || "";
    if (!isInboxApiPath(rawPath)) return next();
    const conversationId = conversationIdFromPath(rawPath) || conversationIdFromBody(req.body);
    if (!conversationId) return next();

    const authorization = text(req.headers?.authorization);
    if (!authorization.startsWith("Bearer ")) return next();
    let decoded;
    try {
      decoded = verify(authorization.slice(7));
    } catch {
      return next();
    }
    const tenantId = decoded?.tenant_id ?? decoded?.tenantId ?? null;
    if (!tenantId) return next();
    if (!(await usesPrivacy({ tenantId }))) return next();

    const viewer = await resolveViewer({ decoded });
    if (viewer.isAdmin) return next();
    const visible = await isVisible({
      tenantId,
      conversationId,
      employeeId: viewer.employeeId,
      isAdmin: false,
    });
    if (visible) return next();
    return res.status(403).json({
      success: false,
      code: "CONVERSATION_PRIVATE",
      message: "This conversation is private.",
    });
  } catch (error) {
    return next(error);
  }
};

// Express treats a four-argument middleware as an ERROR handler, so the mounted
// function keeps the (req, res, next) shape and the injectable one sits behind it.
export const aiInboxPrivacyBoundary = (req, res, next) => runAiInboxPrivacyBoundary(req, res, next);

export default aiInboxPrivacyBoundary;
