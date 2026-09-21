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
