import { getGoogleReviewUrl } from "./publicUrl.js";

/*
 * A WhatsApp CTA message, as the AI Inbox draws it under the bubble (TranscriptMessage →
 * ReplyButtons): the footer line, then one row per button. The body alone is not what the customer
 * received — their phone shows "⭐ قيّمنا على جوجل" under the delivery message — so a transcript row
 * without these reads as a message that asked for nothing.
 */
const clean = (value) => String(value ?? "").trim();

export const ctaTranscriptButtons = ({ footer = "", buttons = [] } = {}) => {
  const rows = (Array.isArray(buttons) ? buttons : [])
    .map((button) => {
      const title = clean(button?.displayText || button?.title);
      if (!title) return null;
      const copy = clean(button?.type).toLowerCase() === "copy";
      return {
        type: copy ? "whatsapp_copy_button" : "whatsapp_url_button",
        title,
        value: clean(copy ? button?.copyCode : button?.url),
      };
    })
    .filter(Boolean);
  if (!rows.length) return [];
  return [...(clean(footer) ? [{ type: "whatsapp_footer", title: clean(footer) }] : []), ...rows];
};

export const ctaUrlTranscriptButtons = ({ footer = "", displayText = "", url = "" } = {}) =>
  ctaTranscriptButtons({ footer, buttons: [{ type: "url", displayText, url }] });

// What the queue sent, read back off its declarative `send` — so every CTA kind gets its buttons in
// the transcript without each caller having to repeat them.
export const transcriptButtonsForSend = (send = {}) => {
  const kind = clean(send?.kind);
  if (kind === "cta_url") return ctaUrlTranscriptButtons(send);
  if (kind === "cta_buttons") return ctaTranscriptButtons(send);
  return [];
};

export const GOOGLE_REVIEW_BUTTON_TEXT = "⭐ قيّمنا على جوجل";
export const PRODUCT_REVIEW_REQUEST_TITLE = "رأيك يهمنا ⭐";
export const PRODUCT_REVIEW_BUTTON_TEXT = "⭐ قيّم مشترياتك";
const FOOTER = "M1 Store";

/*
 * Rows written before the transcript kept a CTA's buttons. Keyed on the row's detected intent, and
 * only from the day each message actually started leaving with its button (the delivery message on
 * 2026-08-25, the receipt for good on 2026-08-26) so an older plain-text message never gains one.
 *
 * The review request is the one whose stored text also differs: it logged the plain-text fallback
 * (body + link), while the phone shows a header, the body and a button — never the link itself.
 */
const LEGACY_CTA_FROM = {
  whatsapp_delivered: Date.parse("2026-08-26T00:00:00+03:00"),
  whatsapp_invoice: Date.parse("2026-08-27T00:00:00+03:00"),
  whatsapp_pos_invoice: Date.parse("2026-08-27T00:00:00+03:00"),
};

const REVIEW_LINK_TAIL = /\n\s*\n\s*(https?:\/\/\S+\/review\/\S+)\s*$/;

export const inferLegacyCtaTranscript = ({ detectedIntent = "", body = "", createdAt = null } = {}) => {
  const intent = clean(detectedIntent);
  const value = String(body ?? "");
  if (intent === "whatsapp_product_review_request") {
    const match = value.match(REVIEW_LINK_TAIL);
    if (!match) return null;
    const reviewBody = value.slice(0, match.index).trim();
    if (!reviewBody) return null;
    return {
      message: `${PRODUCT_REVIEW_REQUEST_TITLE}\n\n${reviewBody}`,
      buttons: ctaUrlTranscriptButtons({ footer: FOOTER, displayText: PRODUCT_REVIEW_BUTTON_TEXT, url: match[1] }),
    };
  }
  const from = LEGACY_CTA_FROM[intent];
  if (!from) return null;
  const at = createdAt ? new Date(createdAt).getTime() : NaN;
  if (!Number.isFinite(at) || at < from || !value.trim()) return null;
  const url = getGoogleReviewUrl();
  if (!url) return null;
  return {
    message: null,
    buttons: ctaUrlTranscriptButtons({ footer: FOOTER, displayText: GOOGLE_REVIEW_BUTTON_TEXT, url }),
  };
};

/*
 * An interactive or template message from the official (Cloud) number, read back into the shape
 * the inbox bubble draws: the body as the row's text, and around it typed suggested_actions —
 * `whatsapp_header` (bold line on top), `whatsapp_footer` (grey line under the body), then one
 * row per button: `whatsapp_reply_button`, `whatsapp_url_button`, `whatsapp_call_button`,
 * `whatsapp_copy_button`, or a list's `whatsapp_list_button` followed by its `whatsapp_list_row`s.
 * A media header travels as an attachment, which the bubble already knows how to draw.
 *
 * Storing only the body is what made a three-button chatbot message read as a plain sentence.
 */
const headerMediaAttachment = (header = {}) => {
  const kind = clean(header?.type).toLowerCase();
  if (!["image", "video", "document"].includes(kind)) return [];
  const link = clean(header?.[kind]?.link);
  return link ? [{ type: kind, url: link, title: clean(header?.[kind]?.filename) }] : [];
};

export const interactiveTranscript = (interactive = {}) => {
  const value = interactive && typeof interactive === "object" ? interactive : {};
  const kind = clean(value.type).toLowerCase();
  const action = value.action && typeof value.action === "object" ? value.action : {};
  const headerText = clean(value.header?.type).toLowerCase() === "text" ? clean(value.header?.text) : "";
  const actions = [];
  if (headerText) actions.push({ type: "whatsapp_header", title: headerText });
  if (clean(value.footer?.text)) actions.push({ type: "whatsapp_footer", title: clean(value.footer.text) });
  const attachments = headerMediaAttachment(value.header);
  if (kind === "button") {
    (Array.isArray(action.buttons) ? action.buttons : []).forEach((button) => {
      const title = clean(button?.reply?.title);
      if (title) actions.push({ type: "whatsapp_reply_button", id: clean(button?.reply?.id), title });
    });
  } else if (kind === "list") {
    actions.push({ type: "whatsapp_list_button", title: clean(action.button) });
    (Array.isArray(action.sections) ? action.sections : []).forEach((section) => {
      (Array.isArray(section?.rows) ? section.rows : []).forEach((row) => {
        const title = clean(row?.title);
        if (title) actions.push({ type: "whatsapp_list_row", id: clean(row?.id), title, description: clean(row?.description), section: clean(section?.title) });
      });
    });
  } else if (kind === "cta_url") {
    const parameters = action.parameters && typeof action.parameters === "object" ? action.parameters : {};
    if (clean(parameters.display_text)) actions.push({ type: "whatsapp_url_button", title: clean(parameters.display_text), value: clean(parameters.url) });
  } else if (kind === "carousel") {
    (Array.isArray(action.cards) ? action.cards : []).forEach((card) => {
      attachments.push(...headerMediaAttachment(card?.header));
      (Array.isArray(card?.action?.buttons) ? card.action.buttons : []).forEach((button) => {
        const title = clean(button?.quick_reply?.title || button?.reply?.title);
        if (title) actions.push({ type: "whatsapp_reply_button", id: clean(button?.quick_reply?.id || button?.reply?.id), title });
      });
    });
  }
  return { message: clean(value.body?.text), actions, attachments, messageType: "interactive" };
};

// "{{1}}" -> values[0]. A position nothing filled keeps its placeholder, so a gap is visible.
export const fillTemplateText = (body = "", values = []) =>
  String(body ?? "").replace(/\{\{\s*(\d+)\s*\}\}/g, (whole, index) => {
    const value = (Array.isArray(values) ? values : [])[Number(index) - 1];
    return value === undefined || value === null || String(value) === "" ? whole : String(value);
  });

/*
 * A template as the customer's phone shows it. `template` is a stored template's shape
 * (header_format, header_text, body_text, footer_text, buttons[{type,text,url,phone_number,example}])
 * and the values are the ones the send actually carried.
 */
export const templateTranscript = ({
  template = {},
  bodyValues = [],
  headerValue = "",
  headerMediaUrl = "",
  buttonValues = {},
} = {}) => {
  const value = template && typeof template === "object" ? template : {};
  const format = clean(value.header_format).toUpperCase();
  const actions = [];
  const attachments = [];
  if (format === "TEXT" && clean(value.header_text)) {
    actions.push({ type: "whatsapp_header", title: clean(fillTemplateText(value.header_text, [headerValue])) });
  } else if (["IMAGE", "VIDEO", "DOCUMENT"].includes(format) && clean(headerMediaUrl || value.header_media_url)) {
    attachments.push({ type: format.toLowerCase(), url: clean(headerMediaUrl || value.header_media_url), title: "" });
  }
  if (clean(value.footer_text)) actions.push({ type: "whatsapp_footer", title: clean(value.footer_text) });
  const extras = buttonValues && typeof buttonValues === "object" ? buttonValues : {};
  (Array.isArray(value.buttons) ? value.buttons : []).forEach((button, index) => {
    const type = clean(button?.type).toUpperCase();
    const title = clean(button?.text);
    if (type === "QUICK_REPLY" && title) actions.push({ type: "whatsapp_reply_button", id: clean(button?.payload), title });
    else if (type === "URL" && title) actions.push({ type: "whatsapp_url_button", title, value: clean(fillTemplateText(button?.url, [extras[index] ?? button?.example ?? ""])) });
    else if (type === "PHONE_NUMBER" && title) actions.push({ type: "whatsapp_call_button", title, value: clean(button?.phone_number) });
    // Meta writes the copy button's label itself; the bubble supplies it when the title is empty.
    else if (type === "COPY_CODE") actions.push({ type: "whatsapp_copy_button", title, value: clean(extras[index] ?? button?.example) });
  });
  return { message: fillTemplateText(value.body_text, bodyValues).trim(), actions, attachments, messageType: "template" };
};
