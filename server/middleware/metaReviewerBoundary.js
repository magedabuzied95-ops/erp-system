import jwt from "jsonwebtoken";

import { isMetaReviewerRole } from "../services/metaReviewerAccessService.js";
import {
  listMetaReviewerConversations,
  loadMetaReviewerMessages,
  sendMetaReviewerMessage,
} from "../services/metaReviewerInboxService.js";

const text = (value) => String(value ?? "").trim();
const reviewerChannel = (value = "") => text(value).toLowerCase().includes("instagram") ? "instagram" : text(value).toLowerCase().includes("messenger") || text(value).toLowerCase().includes("facebook") ? "messenger" : "";

const presentConversation = (row = {}) => ({
  ...row,
  id: row.id,
  session_id: row.id,
  conversation_id: row.id,
  conversation_key: `${row.channel}:${row.id}`,
  source: row.channel,
  is_live_meta: true,
  live_sending_available: true,
  last_message: row.latest_message_preview || "",
  last_activity_at: row.last_message_at || null,
  updated_at: row.last_message_at || null,
  message_count: 1,
  messages: [],
});

const presentMessage = (message = {}) => ({
  ...message,
  customer_message: message.sender_type === "customer" ? message.text : "",
  staff_message: message.sender_type === "customer" ? "" : message.text,
  message_text: message.text,
  manual_message: message.sender_type !== "customer",
  visual_attachments: Array.isArray(message.attachments) ? message.attachments : [],
});

const handleStandardInboxCompatibility = async (req, res, decoded) => {
  const path = String(req.originalUrl || req.url || "").split("?")[0];
  if (req.method === "GET" && path === "/api/ai-inbox/conversations") {
    const channel = reviewerChannel(req.query?.channel_filter || req.query?.channel);
    if (!channel) return res.json({ success: true, conversations: [], followups: [] });
    const payload = await listMetaReviewerConversations({ channel, search: req.query?.search, limit: req.query?.limit });
    return res.json({ success: true, conversations: payload.conversations.map(presentConversation), followups: [] });
  }

  const match = path.match(/^\/api\/ai-inbox\/conversations\/([^/]+)\/(messages|send)$/);
  if (!match) return false;
  const conversationRef = decodeURIComponent(match[1]);
  const requestedChannel = reviewerChannel(req.query?.channel || req.body?.channel || req.headers?.["x-review-channel"]);
  const candidateChannels = requestedChannel ? [requestedChannel] : ["messenger", "instagram"];
  if (match[2] === "messages" && req.method === "GET") {
    let payload = null;
    for (const channel of candidateChannels) {
      payload = await loadMetaReviewerMessages({ channel, conversationRef, limit: req.query?.limit });
      if (payload) break;
    }
    if (!payload) return res.status(403).json({ success: false, message: "Conversation is outside the Meta review scope." });
    return res.json({ success: true, conversation: payload.conversation, messages: payload.messages.map(presentMessage), total: payload.messages.length, has_more: false });
  }
  if (match[2] === "send" && req.method === "POST") {
    let payload = null;
    let lastError = null;
    for (const channel of candidateChannels) {
      try {
        payload = await sendMetaReviewerMessage({ channel, conversationRef, message: req.body?.message, actorUserId: decoded?.id });
        break;
      } catch (error) {
        lastError = error;
        if (error?.status !== 403) throw error;
      }
    }
    if (!payload) throw lastError || Object.assign(new Error("Conversation is outside the Meta review scope."), { status: 403 });
    return res.json({ ...payload, message: presentMessage(payload.message) });
  }
  return false;
};

const allowedReviewerPath = (req) => {
  const path = String(req.originalUrl || req.url || "").split("?")[0];
  const inboxPrefix = "/api/meta-reviewer/inbox";
  return path === "/api/auth/me" || path === inboxPrefix || path.startsWith(`${inboxPrefix}/`);
};

export const metaReviewerApiBoundary = async (req, res, next) => {
  const authorization = String(req.headers.authorization || "");
  if (!authorization.startsWith("Bearer ")) return next();
  try {
    const decoded = jwt.verify(authorization.slice(7), process.env.JWT_SECRET || "SECRET_KEY");
    if (!isMetaReviewerRole(decoded?.role || decoded?.role_name)) return next();
    if (allowedReviewerPath(req)) return next();
    const compatibilityResult = await handleStandardInboxCompatibility(req, res, decoded);
    if (compatibilityResult !== false) return compatibilityResult;
    return res.status(403).json({ success: false, message: "This account is limited to the Meta review inbox." });
  } catch (error) {
    if (res.headersSent) return undefined;
    if (error?.status) return res.status(error.status).json({ success: false, message: error.message });
    return next();
  }
};

export default metaReviewerApiBoundary;
