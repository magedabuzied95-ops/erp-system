import { getPublishingAccessToken, validateMetaToken } from "./metaTokenService.js";

const GRAPH_API_VERSION = "v19.0";
const GRAPH_API_BASE_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

const trimString = (value) => String(value || "").trim();

const parseMetaResponse = async (response) => {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
};

const getMetaErrorMessage = (payload, fallback = "Meta comment automation request failed") => {
  if (payload?.error?.message) return payload.error.message;
  if (payload?.error) return JSON.stringify(payload.error);
  if (payload?.message) return payload.message;
  return fallback;
};

const callMetaPost = async ({ endpoint, params, label }) => {
  const target = `${GRAPH_API_BASE_URL}${endpoint}`;
  console.log("[comment-dm] Meta request", { target, label });

  const response = await fetch(target, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  const payload = await parseMetaResponse(response);

  if (response.ok) {
    console.log("[comment-dm] Meta response", { label, status: response.status, response: payload });
    return payload;
  }

  console.error("[comment-dm] Meta error", { label, status: response.status, response: payload });
  const error = new Error(getMetaErrorMessage(payload));
  error.status = response.status;
  error.metaResponse = payload;
  throw error;
};

export const normalizeKeywords = (value = []) => {
  if (Array.isArray(value)) return value.map(trimString).filter(Boolean);
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return normalizeKeywords(parsed);
    } catch {
      return value
        .split(",")
        .map(trimString)
        .filter(Boolean);
    }
  }
  return [];
};

export const renderCommentDmMessage = (template = "", context = {}) =>
  trimString(template).replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, key) => trimString(context[key]));

export const commentMatchesRule = (rule = {}, commentText = "") => {
  const text = trimString(commentText).toLowerCase();
  if (!text) return false;

  const excluded = normalizeKeywords(rule.excluded_keywords).map((item) => item.toLowerCase());
  if (excluded.some((keyword) => keyword && text.includes(keyword))) return false;

  const keywords = normalizeKeywords(rule.trigger_keywords).map((item) => item.toLowerCase());
  if (!keywords.length) return true;

  const mode = trimString(rule.match_mode || "any").toLowerCase();
  if (mode === "all") return keywords.every((keyword) => text.includes(keyword));
  if (mode === "exact") return keywords.some((keyword) => text === keyword);
  return keywords.some((keyword) => text.includes(keyword));
};

export const sendCommentPrivateReply = async ({ commentId, message, settings }) => {
  const normalizedCommentId = trimString(commentId);
  const normalizedMessage = trimString(message);
  if (!normalizedCommentId) {
    const error = new Error("Comment ID is required to send an automated DM.");
    error.status = 400;
    throw error;
  }
  if (!normalizedMessage) {
    const error = new Error("Automation response message is required.");
    error.status = 400;
    throw error;
  }

  validateMetaToken(settings);
  return callMetaPost({
    endpoint: `/${encodeURIComponent(normalizedCommentId)}/private_replies`,
    label: "comment_private_reply",
    params: {
      message: normalizedMessage,
      access_token: getPublishingAccessToken(settings),
    },
  });
};

