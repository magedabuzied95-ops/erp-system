/*
 * The WhatsApp Business Platform (Cloud API) transport.
 *
 * This is the official Graph API path, and it exists next to the Evolution one rather than
 * replacing it: the plan is one number on each. So every function here mirrors the shape of its
 * Evolution twin in whatsappGatewayService.js, and that file decides which transport a given
 * number uses — nothing in here reads WHATSAPP_GATEWAY_PROVIDER or picks sides.
 *
 * Deliberately NOT imported from whatsappGatewayService: that module imports this one, and its
 * helpers are const arrow functions, so a circular import would leave them in the temporal dead
 * zone at module init and fail only at runtime. Phone numbers therefore arrive already
 * normalised, and this file does the last E.164 cleanup itself.
 *
 * What the platform does NOT do, so callers stop expecting it:
 *  - No free-form message outside the 24-hour service window. Use a template (see
 *    whatsappTemplates.js); isWithinServiceWindow() is the test.
 *  - No message editing. There is no Graph endpoint for it at any version.
 *  - No session carousel. Carousels exist only as approved MARKETING templates.
 */

import { buildTemplateMessage } from "./whatsappTemplates.js";

const text = (value, fallback = "") => String(value ?? fallback).trim();

const GRAPH_HOST = "https://graph.facebook.com";
const DEFAULT_GRAPH_VERSION = "v20.0";

/*
 * The window inside which a plain message may be sent at all. Meta counts it from the customer's
 * last inbound; a minute of slack keeps a send that is racing the boundary from being rejected
 * after we already decided it was free-form.
 */
export const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;
const SERVICE_WINDOW_SAFETY_MS = 60 * 1000;

export const cloudConfig = () => ({
  accessToken: text(
    process.env.WHATSAPP_ACCESS_TOKEN ||
      process.env.WHATSAPP_CLOUD_ACCESS_TOKEN ||
      process.env.META_WHATSAPP_ACCESS_TOKEN
  ),
  phoneNumberId: text(
    process.env.WHATSAPP_PHONE_NUMBER_ID ||
      process.env.WHATSAPP_CLOUD_PHONE_NUMBER_ID ||
      process.env.META_WHATSAPP_PHONE_NUMBER_ID
  ),
  businessAccountId: text(
    process.env.WHATSAPP_BUSINESS_ACCOUNT_ID ||
      process.env.WHATSAPP_CLOUD_BUSINESS_ACCOUNT_ID ||
      process.env.META_WHATSAPP_BUSINESS_ACCOUNT_ID
  ),
  graphVersion: text(process.env.META_GRAPH_VERSION) || DEFAULT_GRAPH_VERSION,
});

const cloudError = (message, code = "WHATSAPP_CLOUD_ERROR", status = 500, details = null) => {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  if (details) error.details = details;
  return error;
};

export const requireCloudConfig = ({ phoneNumberId = "" } = {}) => {
  const current = cloudConfig();
  const selected = text(phoneNumberId);
  if (selected) current.phoneNumberId = selected;
  if (!current.accessToken) throw cloudError("WHATSAPP_ACCESS_TOKEN is not configured", "WHATSAPP_ACCESS_TOKEN_MISSING", 409);
  if (!current.phoneNumberId) throw cloudError("WHATSAPP_PHONE_NUMBER_ID is not configured", "WHATSAPP_PHONE_NUMBER_ID_MISSING", 409);
  return current;
};

/*
 * Graph wants the recipient in E.164 with no plus and no separators. Our own normaliser already
 * produces "2010…" for Egypt, so this only strips what a hand-entered number carries.
 */
export const toGraphRecipient = (phone = "") => text(phone).replace(/^\+/, "").replace(/[^\d]/g, "");

export const isWithinServiceWindow = (lastInboundAt = null, now = Date.now()) => {
  if (!lastInboundAt) return false;
  const at = lastInboundAt instanceof Date ? lastInboundAt.getTime() : new Date(lastInboundAt).getTime();
  if (!Number.isFinite(at)) return false;
  return now - at < SERVICE_WINDOW_MS - SERVICE_WINDOW_SAFETY_MS;
};

/*
 * One place where a Graph response becomes either a result or an Error, because the failure modes
 * are what a caller has to act on: a 131047 means the window closed and the message must be a
 * template instead, a 132001 means the template is not approved on this WABA, and a 190 means the
 * token died — three completely different operator actions that all arrive as "HTTP 400".
 */
export const CLOUD_ERROR_MEANINGS = Object.freeze({
  131047: "outside_service_window_use_template",
  131026: "recipient_cannot_receive",
  132000: "template_param_count_mismatch",
  132001: "template_not_found_or_not_approved",
  132005: "template_text_too_long",
  132007: "template_param_format_invalid",
  133010: "phone_number_not_registered",
  190: "access_token_expired_or_invalid",
  4: "app_rate_limit_reached",
  80007: "waba_rate_limit_reached",
  131056: "pair_rate_limit_reached",
});

export const cloudErrorMeaning = (code) => CLOUD_ERROR_MEANINGS[Number(code)] || "";

const graphRequest = async ({ path = "", method = "GET", body = null, accessToken = "", timeoutMs = 15000 } = {}) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  let payload;
  try {
    response = await fetch(`${GRAPH_HOST}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal,
    });
    const raw = await response.text();
    try {
      payload = raw ? JSON.parse(raw) : {};
    } catch {
      payload = { raw };
    }
  } catch (networkError) {
    throw cloudError(
      networkError?.name === "AbortError" ? "WhatsApp Cloud API timed out" : (networkError?.message || "WhatsApp Cloud API is unreachable"),
      networkError?.name === "AbortError" ? "WHATSAPP_CLOUD_TIMEOUT" : "WHATSAPP_CLOUD_UNREACHABLE",
      504
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const graphError = payload?.error || {};
    const meaning = cloudErrorMeaning(graphError.code);
    const error = cloudError(
      text(graphError.message) || `WhatsApp Cloud API returned ${response.status}`,
      meaning ? `WHATSAPP_CLOUD_${meaning.toUpperCase()}` : "WHATSAPP_CLOUD_ERROR",
      response.status,
      {
        graph_code: graphError.code ?? null,
        graph_subcode: graphError.error_subcode ?? null,
        graph_type: text(graphError.type),
        fbtrace_id: text(graphError.fbtrace_id),
        meaning,
      }
    );
    throw error;
  }
  return payload;
};

const postMessage = async ({ message, phoneNumberId = "" } = {}) => {
  const config = requireCloudConfig({ phoneNumberId });
  const result = await graphRequest({
    path: `/${config.graphVersion}/${config.phoneNumberId}/messages`,
    method: "POST",
    body: message,
    accessToken: config.accessToken,
  });
  const messageId = text(result?.messages?.[0]?.id);
  console.info("[whatsapp:cloud-sent]", {
    type: message?.type || "text",
    phone_suffix: toGraphRecipient(message?.to).slice(-4),
    message_id: messageId,
    template: message?.template?.name || "",
  });
  return { provider: "cloud", message_id: messageId, result };
};

export const sendText = async ({ phone, message, phoneNumberId = "", previewUrl = false } = {}) => {
  const to = toGraphRecipient(phone);
  const body = String(message ?? "");
  if (!to) throw cloudError("A valid WhatsApp phone number is required", "WHATSAPP_PHONE_REQUIRED", 400);
  if (!body.trim()) throw cloudError("Message body is required", "WHATSAPP_MESSAGE_REQUIRED", 400);
  /*
   * Link previews stay off, for the same reason they are off on Evolution: a transactional
   * message gains nothing from a preview card and every one of ours carries a link.
   */
  return postMessage({
    phoneNumberId,
    message: {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: { preview_url: previewUrl === true, body },
    },
  });
};

export const sendImage = async ({ phone, imageUrl, caption = "", phoneNumberId = "" } = {}) => {
  const to = toGraphRecipient(phone);
  const link = text(imageUrl);
  if (!to) throw cloudError("A valid WhatsApp phone number is required", "WHATSAPP_PHONE_REQUIRED", 400);
  if (!link) throw cloudError("An image URL is required", "WHATSAPP_IMAGE_REQUIRED", 400);
  return postMessage({
    phoneNumberId,
    message: {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "image",
      image: { link, ...(text(caption) ? { caption: text(caption) } : {}) },
    },
  });
};

export const sendReaction = async ({ phone, targetMessageId = "", emoji = "", phoneNumberId = "" } = {}) => {
  const to = toGraphRecipient(phone);
  const messageId = text(targetMessageId);
  if (!to) throw cloudError("A valid WhatsApp phone number is required", "WHATSAPP_PHONE_REQUIRED", 400);
  if (!messageId) throw cloudError("The message being reacted to is required", "WHATSAPP_REACTION_TARGET_REQUIRED", 400);
  /* An empty emoji is how the platform REMOVES a reaction, so it is not validated away here. */
  return postMessage({
    phoneNumberId,
    message: {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "reaction",
      reaction: { message_id: messageId, emoji: text(emoji) },
    },
  });
};

/*
 * Reply buttons as a SESSION message — valid only inside the 24-hour window. The same three
 * actions outside the window have to travel as the approved template instead, which is what
 * sendTemplate below is for. Cloud caps this at three buttons and 20 characters of button text,
 * so the caller's list is trimmed rather than silently rejected by Graph.
 */
export const sendInteractiveButtons = async ({
  phone,
  bodyText = "",
  title = "",
  footer = "",
  buttons = [],
  phoneNumberId = "",
} = {}) => {
  const to = toGraphRecipient(phone);
  const body = text(bodyText);
  if (!to) throw cloudError("A valid WhatsApp phone number is required", "WHATSAPP_PHONE_REQUIRED", 400);
  if (!body) throw cloudError("Message body is required", "WHATSAPP_MESSAGE_REQUIRED", 400);
  const list = (Array.isArray(buttons) ? buttons : []).filter(Boolean).slice(0, 3);
  if (!list.length) throw cloudError("At least one button is required", "WHATSAPP_BUTTONS_REQUIRED", 400);
  return postMessage({
    phoneNumberId,
    message: {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "interactive",
      interactive: {
        type: "button",
        ...(text(title) ? { header: { type: "text", text: text(title).slice(0, 60) } } : {}),
        body: { text: body },
        ...(text(footer) ? { footer: { text: text(footer).slice(0, 60) } } : {}),
        action: {
          buttons: list.map((button, index) => ({
            type: "reply",
            reply: {
              id: text(button.payload || button.id) || `button_${index + 1}`,
              title: text(button.text || button.title).slice(0, 20),
            },
          })),
        },
      },
    },
  });
};

export const sendCtaUrl = async ({
  phone,
  bodyText = "",
  title = "",
  footer = "",
  displayText = "",
  url = "",
  phoneNumberId = "",
} = {}) => {
  const to = toGraphRecipient(phone);
  const body = text(bodyText);
  const link = text(url);
  if (!to) throw cloudError("A valid WhatsApp phone number is required", "WHATSAPP_PHONE_REQUIRED", 400);
  if (!body) throw cloudError("Message body is required", "WHATSAPP_MESSAGE_REQUIRED", 400);
  if (!link) throw cloudError("A URL is required", "WHATSAPP_CTA_URL_REQUIRED", 400);
  return postMessage({
    phoneNumberId,
    message: {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "interactive",
      interactive: {
        type: "cta_url",
        ...(text(title) ? { header: { type: "text", text: text(title).slice(0, 60) } } : {}),
        body: { text: body },
        ...(text(footer) ? { footer: { text: text(footer).slice(0, 60) } } : {}),
        action: {
          name: "cta_url",
          parameters: { display_text: text(displayText).slice(0, 20) || "افتح", url: link },
        },
      },
    },
  });
};

/*
 * The only thing that may be sent outside the service window. `automationType` is our own name
 * for the message (order_confirmation, invoice_receipt, …); the registry turns it into the
 * approved template name and the ordered variables.
 */
export const sendTemplate = async ({ automationType = "", phone, values = {}, phoneNumberId = "" } = {}) => {
  const to = toGraphRecipient(phone);
  if (!to) throw cloudError("A valid WhatsApp phone number is required", "WHATSAPP_PHONE_REQUIRED", 400);
  return postMessage({ phoneNumberId, message: buildTemplateMessage({ automationType, phone: to, values }) });
};

/*
 * What the operator could never see on Evolution: the number's standing, straight from Meta.
 * quality_rating is GREEN / YELLOW / RED, and the throughput + messaging tier say how many
 * conversations a day the number may start before Graph starts refusing.
 */
export const getStatus = async ({ phoneNumberId = "" } = {}) => {
  const config = cloudConfig();
  const selected = text(phoneNumberId) || config.phoneNumberId;
  const base = {
    provider: "cloud",
    configured: Boolean(config.accessToken && selected),
    access_token_configured: Boolean(config.accessToken),
    phone_number_id_configured: Boolean(selected),
    business_account_id_configured: Boolean(config.businessAccountId),
    graph_version: config.graphVersion,
  };
  if (!base.configured) return { ...base, connected: false, state: "not_configured" };
  try {
    const fields = "display_phone_number,verified_name,quality_rating,code_verification_status,platform_type,throughput";
    const result = await graphRequest({
      path: `/${config.graphVersion}/${selected}?fields=${encodeURIComponent(fields)}`,
      accessToken: config.accessToken,
    });
    return {
      ...base,
      /*
       * There is no socket to be up or down — a registered number is reachable. "connected" is
       * kept in the shape only so the queue's gateway_offline check reads the same on both
       * transports; what actually matters here is quality_rating going RED.
       */
      connected: true,
      state: "registered",
      display_phone_number: text(result?.display_phone_number),
      verified_name: text(result?.verified_name),
      quality_rating: text(result?.quality_rating),
      code_verification_status: text(result?.code_verification_status),
      throughput_level: text(result?.throughput?.level),
      raw: result,
    };
  } catch (error) {
    console.warn("[whatsapp:cloud-status-failed]", {
      code: error?.code || "",
      status: error?.status || 0,
      meaning: error?.details?.meaning || "",
      message: error?.message || String(error),
    });
    return { ...base, connected: false, state: "unreachable", error: error?.message || String(error), error_code: error?.code || "" };
  }
};

/* The management side: what Meta has approved, and submitting what it has not. */
export const listTemplates = async () => {
  const config = cloudConfig();
  if (!config.accessToken) throw cloudError("WHATSAPP_ACCESS_TOKEN is not configured", "WHATSAPP_ACCESS_TOKEN_MISSING", 409);
  if (!config.businessAccountId) throw cloudError("WHATSAPP_BUSINESS_ACCOUNT_ID is not configured", "WHATSAPP_BUSINESS_ACCOUNT_ID_MISSING", 409);
  const result = await graphRequest({
    path: `/${config.graphVersion}/${config.businessAccountId}/message_templates?fields=name,status,category,language,rejected_reason&limit=200`,
    accessToken: config.accessToken,
  });
  return Array.isArray(result?.data) ? result.data : [];
};

export const submitTemplate = async (payload = {}) => {
  const config = cloudConfig();
  if (!config.accessToken) throw cloudError("WHATSAPP_ACCESS_TOKEN is not configured", "WHATSAPP_ACCESS_TOKEN_MISSING", 409);
  if (!config.businessAccountId) throw cloudError("WHATSAPP_BUSINESS_ACCOUNT_ID is not configured", "WHATSAPP_BUSINESS_ACCOUNT_ID_MISSING", 409);
  return graphRequest({
    path: `/${config.graphVersion}/${config.businessAccountId}/message_templates`,
    method: "POST",
    body: payload,
    accessToken: config.accessToken,
  });
};

export default {
  cloudConfig,
  requireCloudConfig,
  isWithinServiceWindow,
  toGraphRecipient,
  cloudErrorMeaning,
  sendText,
  sendImage,
  sendReaction,
  sendInteractiveButtons,
  sendCtaUrl,
  sendTemplate,
  getStatus,
  listTemplates,
  submitTemplate,
};
