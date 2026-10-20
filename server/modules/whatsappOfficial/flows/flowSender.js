// Turns one flow node into the Cloud API message(s) and sends them on the given number.
// Also writes what was sent into the inbox transcript so the team sees the bot's side of the chat.
import db from "../../../database/db.js";
import {
  sendCloudPayload,
  sendDocument,
  sendImage,
  sendText,
  sendVideo,
  toGraphRecipient,
} from "../../../services/whatsappCloudProvider.js";
import { absolutePublicUploadUrl } from "../../../utils/publicUrl.js";
import { interactiveTranscript, templateTranscript } from "../../../utils/whatsappCtaTranscript.js";
import { LIMITS, renderVars } from "./flowGraph.js";

const str = (value) => String(value ?? "").trim();
const arr = (value) => (Array.isArray(value) ? value : []);
const cut = (value, max) => str(value).slice(0, max);

const mediaLink = (value) => {
  const raw = str(value);
  if (!raw) return "";
  return absolutePublicUploadUrl(raw) || raw;
};

const textHeader = (value, vars) => {
  const header = cut(renderVars(value, vars), LIMITS.header);
  return header ? { header: { type: "text", text: header } } : {};
};
const footerPart = (value, vars) => {
  const footer = cut(renderVars(value, vars), LIMITS.footer);
  return footer ? { footer: { text: footer } } : {};
};

const variableCount = (value) => {
  const found = new Set();
  String(value ?? "").replace(/\{\{\s*(\d+)\s*\}\}/g, (match, index) => { found.add(Number(index)); return match; });
  return found.size ? Math.max(...found) : 0;
};

/* ------------------------------------------------------------------ template */

const loadTemplate = async (tenantId, templateId) => {
  const result = await db.query(
    `SELECT * FROM whatsapp_message_templates WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
    [Number(tenantId) || 0, Number(templateId) || 0]
  );
  return result.rows[0] || null;
};

export const buildTemplatePayload = (template, data = {}, vars = {}) => {
  const components = [];
  const format = str(template.header_format).toUpperCase();
  if (format === "TEXT" && variableCount(template.header_text)) {
    components.push({ type: "header", parameters: [{ type: "text", text: renderVars(data.header_variable, vars) || "-" }] });
  } else if (["IMAGE", "VIDEO", "DOCUMENT"].includes(format)) {
    const link = mediaLink(data.header_media_url || template.header_media_url);
    if (link) {
      const kind = format.toLowerCase();
      components.push({ type: "header", parameters: [{ type: kind, [kind]: { link } }] });
    }
  }
  const bodyCount = variableCount(template.body_text);
  if (bodyCount) {
    const values = arr(data.variables);
    components.push({
      type: "body",
      parameters: Array.from({ length: bodyCount }, (unused, index) => ({ type: "text", text: renderVars(values[index], vars) || "-" })),
    });
  }
  const replies = new Map(arr(data.buttons).map((button) => [Number(button.index), str(button.id)]));
  const buttonVariables = data.button_variables && typeof data.button_variables === "object" ? data.button_variables : {};
  arr(template.buttons).forEach((button, index) => {
    const type = str(button?.type).toUpperCase();
    if (type === "QUICK_REPLY" && replies.get(index)) {
      components.push({ type: "button", sub_type: "quick_reply", index: String(index), parameters: [{ type: "payload", payload: replies.get(index) }] });
    } else if (type === "URL" && variableCount(button?.url)) {
      components.push({ type: "button", sub_type: "url", index: String(index), parameters: [{ type: "text", text: renderVars(buttonVariables[index], vars) || "-" }] });
    }
  });
  return {
    type: "template",
    template: { name: str(template.name), language: { code: str(template.language) || "ar" }, ...(components.length ? { components } : {}) },
  };
};

// The template as the customer reads it, filled with the same values buildTemplatePayload sends.
export const buildTemplateTranscript = (template, data = {}, vars = {}) => {
  const values = arr(data.variables);
  const buttonVariables = data.button_variables && typeof data.button_variables === "object" ? data.button_variables : {};
  return templateTranscript({
    template,
    bodyValues: Array.from({ length: variableCount(template.body_text) }, (unused, index) => renderVars(values[index], vars) || "-"),
    headerValue: renderVars(data.header_variable, vars) || "-",
    headerMediaUrl: mediaLink(data.header_media_url || template.header_media_url),
    buttonValues: Object.fromEntries(Object.entries(buttonVariables).map(([index, value]) => [index, renderVars(value, vars) || "-"])),
  });
};

/* ------------------------------------------------------------------ interactive payloads */

export const buildInteractivePayload = (node, vars = {}) => {
  const data = node.data || {};
  if (node.type === "interactive_buttons") {
    return {
      type: "interactive",
      interactive: {
        type: "button",
        ...textHeader(data.header, vars),
        body: { text: cut(renderVars(data.body, vars), LIMITS.body) },
        ...footerPart(data.footer, vars),
        action: {
          buttons: arr(data.buttons).slice(0, LIMITS.buttons).map((button) => ({
            type: "reply",
            reply: { id: str(button.id), title: cut(renderVars(button.title, vars), LIMITS.buttonTitle) },
          })),
        },
      },
    };
  }
  if (node.type === "interactive_list") {
    const sections = arr(data.sections).filter((section) => arr(section?.rows).length);
    return {
      type: "interactive",
      interactive: {
        type: "list",
        ...textHeader(data.header, vars),
        body: { text: cut(renderVars(data.body, vars), LIMITS.body) },
        ...footerPart(data.footer, vars),
        action: {
          button: cut(renderVars(data.button_label, vars), LIMITS.listButton) || "Options",
          sections: sections.map((section) => ({
            ...(str(section.title) ? { title: cut(renderVars(section.title, vars), LIMITS.sectionTitle) } : {}),
            rows: arr(section.rows).map((row) => ({
              id: str(row.id),
              title: cut(renderVars(row.title, vars), LIMITS.rowTitle),
              ...(str(row.description) ? { description: cut(renderVars(row.description, vars), LIMITS.rowDescription) } : {}),
            })),
          })),
        },
      },
    };
  }
  if (node.type === "cta_url") {
    return {
      type: "interactive",
      interactive: {
        type: "cta_url",
        ...textHeader(data.header, vars),
        body: { text: cut(renderVars(data.body, vars), LIMITS.body) },
        ...footerPart(data.footer, vars),
        action: { name: "cta_url", parameters: { display_text: cut(renderVars(data.display_text, vars), LIMITS.ctaText), url: str(renderVars(data.url, vars)) } },
      },
    };
  }
  if (node.type === "carousel") {
    // Interactive media carousel (session message): image header + body + quick-reply buttons per card.
    return {
      type: "interactive",
      interactive: {
        type: "carousel",
        body: { text: cut(renderVars(data.body, vars), LIMITS.body) },
        action: {
          cards: arr(data.cards).slice(0, LIMITS.carouselMax).map((card, index) => ({
            card_index: index,
            type: "button",
            header: { type: "image", image: { link: mediaLink(card.image_url) } },
            ...(str(card.body) ? { body: { text: cut(renderVars(card.body, vars), LIMITS.cardBody) } } : {}),
            action: {
              buttons: arr(card.buttons).slice(0, LIMITS.cardButtons).map((button) => ({
                type: "quick_reply",
                quick_reply: { id: str(button.id), title: cut(renderVars(button.title, vars), LIMITS.buttonTitle) },
              })),
            },
          })),
        },
      },
    };
  }
  return null;
};

/* ------------------------------------------------------------------ transcript */

const transcriptSummary = (node, vars) => {
  const data = node.data || {};
  switch (node.type) {
    case "interactive_buttons":
    case "interactive_list":
    case "cta_url":
    case "carousel":
    case "text":
      return str(renderVars(data.body, vars));
    case "template":
      return `[template] ${str(data.template_name)}`;
    case "image":
    case "video":
    case "document":
      return str(renderVars(data.caption, vars)) || `[${node.type}]`;
    case "audio":
      return "[audio]";
    default:
      return "";
  }
};

const transcriptButtons = (node, vars) => {
  const data = node.data || {};
  if (node.type === "interactive_buttons") return arr(data.buttons).map((button) => renderVars(button.title, vars));
  if (node.type === "interactive_list") return arr(data.sections).flatMap((section) => arr(section.rows).map((row) => renderVars(row.title, vars)));
  if (node.type === "carousel") return arr(data.cards).flatMap((card) => arr(card.buttons).map((button) => renderVars(button.title, vars)));
  if (node.type === "template") return arr(data.buttons).map((button) => button.title);
  if (node.type === "cta_url") return [renderVars(data.display_text, vars)];
  return [];
};

const transcriptMedia = (node) => {
  const data = node.data || {};
  if (["image", "video", "audio", "document"].includes(node.type) && str(data.url)) {
    return [{ type: node.type, url: str(data.url), title: str(data.filename || data.caption) }];
  }
  if (node.type === "carousel") {
    return arr(data.cards).filter((card) => str(card.image_url)).map((card) => ({ type: "image", url: str(card.image_url), title: str(card.body) }));
  }
  return [];
};

export const recordTranscript = async ({ tenantId, conversationKey, phone, phoneNumberId, node, vars, messageId, flowName = "", transcript = null }) => {
  try {
    // An interactive or template send hands over its own transcript (built from the payload, so
    // header, footer and every button are what the phone shows); the rest summarise the node.
    const structured = transcript && typeof transcript === "object" && str(transcript.message) ? transcript : null;
    const message = structured ? str(structured.message) : transcriptSummary(node, vars);
    if (!message) return;
    const { appendWhatsappOutboundSupportReply } = await import("../../../services/aiSupportLogService.js");
    const saved = await appendWhatsappOutboundSupportReply({
      tenantId,
      sessionId: conversationKey,
      message,
      // 'interactive' / 'template' tell the inbox the actions are the phone's header, footer and
      // buttons; message_text stays the body alone so search and previews read as before.
      messageType: structured ? str(structured.messageType) || "interactive" : "text",
      senderType: "system",
      // source_path/insert_source "wa_chatbot_flow" mark the row as a chatbot reply; the flow's
      // name rides in staff_user_name (staff_user_id stays NULL) so the inbox can name the flow.
      staffUserName: str(flowName).slice(0, 120),
      suggestedActions: structured ? arr(structured.actions) : transcriptButtons(node, vars).filter(Boolean),
      visualAttachments: structured ? arr(structured.attachments) : transcriptMedia(node),
      source: "wa_chatbot_flow",
      channel: "whatsapp",
      deliveryStatus: "sent",
      externalMessageId: messageId,
      providerMessageId: messageId,
      whatsappInstance: phoneNumberId ? `cloud:${phoneNumberId}` : "",
      remoteJid: conversationKey,
      resolvedReplyJid: conversationKey,
      resolvedPhone: phone,
      preserveExactMessage: true,
      upsertSession: true,
      sessionStatus: "ai_active",
      sessionSource: "whatsapp",
      sessionChannel: "whatsapp",
      sourcePath: "wa_chatbot_flow",
      insertSource: "wa_chatbot_flow",
      confidence: 1,
      detectedIntent: "wa_chatbot_flow",
    });
    if (saved && tenantId) {
      const { emitToRooms } = await import("../../../utils/socket.js");
      emitToRooms([`tenant:${tenantId}`], "ai_inbox:message", {
        tenant_id: tenantId,
        session_id: conversationKey,
        channel: "whatsapp",
        message: { ...saved, from_me: true, direction: "outbound" },
      });
    }
  } catch (error) {
    console.warn("[wa-flows] transcript not saved", { message: String(error?.message || error).slice(0, 200) });
  }
};

/* ------------------------------------------------------------------ send */

/**
 * Sends one node. Returns { ok, message_id, error }. Never throws.
 */
export const sendFlowNode = async ({ tenantId, phoneNumberId, phone, node, vars = {} }) => {
  const to = toGraphRecipient(phone);
  const data = node?.data || {};
  try {
    let result = null;
    let transcript = null;
    switch (node?.type) {
      case "text":
        result = await sendText({ phone: to, message: cut(renderVars(data.body, vars), LIMITS.text), phoneNumberId, previewUrl: true });
        break;
      case "image":
        result = await sendImage({ phone: to, imageUrl: mediaLink(data.url), caption: renderVars(data.caption, vars), phoneNumberId });
        break;
      case "video":
        result = await sendVideo({ phone: to, videoUrl: mediaLink(data.url), caption: renderVars(data.caption, vars), phoneNumberId });
        break;
      case "document":
        result = await sendDocument({ phone: to, documentUrl: mediaLink(data.url), fileName: str(data.filename), caption: renderVars(data.caption, vars), phoneNumberId });
        break;
      case "audio":
        result = await sendCloudPayload({ phoneNumberId, message: { to, type: "audio", audio: { link: mediaLink(data.url) } } });
        break;
      case "template": {
        const template = await loadTemplate(tenantId, data.template_id);
        if (!template) throw Object.assign(new Error("Template not found"), { code: "WA_FLOW_TEMPLATE_MISSING" });
        result = await sendCloudPayload({ phoneNumberId, message: { to, ...buildTemplatePayload(template, data, vars) } });
        transcript = buildTemplateTranscript(template, data, vars);
        break;
      }
      default: {
        const payload = buildInteractivePayload(node, vars);
        if (!payload) throw Object.assign(new Error(`Unknown node type ${node?.type}`), { code: "WA_FLOW_NODE_UNKNOWN" });
        result = await sendCloudPayload({ phoneNumberId, message: { to, ...payload } });
        transcript = interactiveTranscript(payload.interactive);
      }
    }
    return { ok: true, message_id: str(result?.message_id), transcript };
  } catch (error) {
    console.warn("[wa-flows] send failed", {
      node: node?.id,
      type: node?.type,
      code: error?.code || "",
      meaning: error?.details?.meaning || "",
      message: String(error?.message || error).slice(0, 200),
    });
    return { ok: false, error: String(error?.message || error).slice(0, 300), code: error?.code || "" };
  }
};

export default { sendFlowNode, recordTranscript, buildInteractivePayload, buildTemplatePayload };
