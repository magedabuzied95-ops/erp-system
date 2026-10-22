import { interactiveTranscript, templateTranscript } from "./whatsappCtaTranscript.js";

/*
 * The buttons a message actually went out with, read off the request that sent it.
 *
 * The AI Inbox draws a bubble's header, footer and button rows from typed suggested_actions
 * (`whatsapp_header`, `whatsapp_footer`, `whatsapp_reply_button`, `whatsapp_url_button`, …, see
 * TranscriptMessage → ReplyButtons). Until now every sender had to write those itself, and most
 * never did: the inbox's own template send, the comment automation's quick replies, a Messenger
 * button template, an Evolution list — each new template meant hunting down one more writer that
 * stored the body alone. On top of that, a provider echo landing after the writer could replace
 * the row's buttons with none.
 *
 * So the buttons are no longer the writer's job. `installSentMessageButtonsObserver` watches every
 * successful send at the wire (Cloud API, Messenger/Instagram Graph, Evolution's interactive
 * endpoints), reads the buttons off the request body, and keys them by the message id the provider
 * returned. `persistOutboundTranscriptRow` (aiSupportLogService) asks for them by that id when a
 * row arrives without any, and a row written BEFORE the send's answer was read is patched when it
 * lands. The `whatsapp_*` names are the bubble's vocabulary, used for Meta rows too: the drawing
 * is the same, a row of buttons under the text.
 */

const clean = (value) => String(value ?? "").trim();
const asArray = (value) => (Array.isArray(value) ? value : []);
const asObject = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});

export const isTranscriptAction = (action) => clean(action?.type).startsWith("whatsapp_");
export const hasTranscriptButtons = (actions = []) => asArray(actions).some(isTranscriptAction);

const parts = ({ message = "", actions = [], attachments = [] } = {}) => ({
  message: clean(message),
  actions: asArray(actions).filter(isTranscriptAction),
  attachments: asArray(attachments),
});

/* ── Messenger / Instagram ─────────────────────────────────────────────────────────────────── */

const metaButtonAction = (button = {}) => {
  const type = clean(button?.type).toLowerCase();
  const title = clean(button?.title);
  if (!title) return null;
  if (type === "web_url") return { type: "whatsapp_url_button", title, value: clean(button?.url) };
  if (type === "phone_number") return { type: "whatsapp_call_button", title, value: clean(button?.payload) };
  // postback, and anything newer Meta adds: the customer taps it, nothing opens on our side.
  return { type: "whatsapp_reply_button", id: clean(button?.payload), title };
};

const metaQuickReplyActions = (quickReplies = []) =>
  asArray(quickReplies)
    .map((reply) => {
      const title = clean(reply?.title);
      return title ? { type: "whatsapp_reply_button", id: clean(reply?.payload), title } : null;
    })
    .filter(Boolean);

/*
 * The `message` object of a Send API body: `{ text, quick_replies }`, or an attachment whose
 * template is a button template (text + up to 3 buttons) or a single generic element (title,
 * subtitle, buttons). A generic template with several elements is a carousel — the product-card
 * path owns those (metaTemplateProductCards), so nothing is read from them here.
 */
export const partsFromMetaMessage = (message = {}) => {
  const value = asObject(message);
  const payload = asObject(value.attachment?.payload);
  const templateType = clean(value.attachment?.type).toLowerCase() === "template" ? clean(payload.template_type).toLowerCase() : "";
  const actions = [];
  let body = clean(value.text);
  if (templateType === "button") {
    body = clean(payload.text) || body;
    asArray(payload.buttons).forEach((button) => {
      const action = metaButtonAction(button);
      if (action) actions.push(action);
    });
  } else if (templateType === "generic" && asArray(payload.elements).length === 1) {
    const element = asObject(payload.elements[0]);
    if (clean(element.title)) actions.push({ type: "whatsapp_header", title: clean(element.title) });
    body = clean(element.subtitle) || body;
    asArray(element.buttons).forEach((button) => {
      const action = metaButtonAction(button);
      if (action) actions.push(action);
    });
  }
  actions.push(...metaQuickReplyActions(value.quick_replies));
  return parts({ message: body, actions });
};

// An echo of our own message carries the template as an attachment, the way the send did.
export const partsFromMetaEchoAttachments = (attachments = []) => {
  const template = asArray(attachments).find((attachment) => clean(attachment?.type).toLowerCase() === "template");
  return template ? partsFromMetaMessage({ attachment: template }) : parts();
};

/* ── WhatsApp Cloud API ────────────────────────────────────────────────────────────────────── */

const parameterValue = (parameter = {}) => {
  const value = asObject(parameter);
  const type = clean(value.type).toLowerCase();
  if (type === "text") return clean(value.text);
  if (type === "currency") return clean(value.currency?.fallback_value);
  if (type === "date_time") return clean(value.date_time?.fallback_value);
  if (type === "coupon_code") return clean(value.coupon_code);
  if (type === "payload") return clean(value.payload);
  if (["image", "video", "document"].includes(type)) return clean(value[type]?.link);
  return clean(value.text);
};

// The values a template send carried, in the shape templateTranscript fills a definition with.
export const templateSendValues = (template = {}) => {
  const components = asArray(asObject(template).components);
  const body = components.find((component) => clean(component?.type).toLowerCase() === "body");
  const header = components.find((component) => clean(component?.type).toLowerCase() === "header");
  const headerParameter = asObject(asArray(header?.parameters)[0]);
  const headerType = clean(headerParameter.type).toLowerCase();
  const buttonValues = {};
  components
    .filter((component) => clean(component?.type).toLowerCase() === "button")
    .forEach((component) => {
      const index = Number(component?.index);
      if (Number.isInteger(index)) buttonValues[index] = parameterValue(asArray(component?.parameters)[0]);
    });
  return {
    bodyValues: asArray(body?.parameters).map(parameterValue),
    headerValue: headerType === "text" ? parameterValue(headerParameter) : "",
    headerMediaUrl: ["image", "video", "document"].includes(headerType) ? parameterValue(headerParameter) : "",
    buttonValues,
  };
};

/*
 * A Cloud message body. An interactive message carries its own buttons; a template carries only
 * the values, so its buttons come from the stored definition (whatsapp_message_templates), which
 * `lookupTemplate({ name, language })` supplies.
 */
export const partsFromCloudMessage = async (message = {}, { lookupTemplate = null } = {}) => {
  const value = asObject(message);
  const type = clean(value.type).toLowerCase();
  if (type === "interactive") return parts(interactiveTranscript(value.interactive));
  if (type !== "template" || typeof lookupTemplate !== "function") return parts();
  const template = asObject(value.template);
  const definition = await lookupTemplate({ name: clean(template.name), language: clean(template.language?.code || template.language) });
  if (!definition) return parts();
  return parts(templateTranscript({ template: definition, ...templateSendValues(template) }));
};

/* ── Evolution ─────────────────────────────────────────────────────────────────────────────── */

const evolutionButtonAction = (button = {}) => {
  const type = clean(button?.type).toLowerCase();
  const title = clean(button?.displayText || button?.title || button?.buttonText?.displayText);
  if (type === "url") return title ? { type: "whatsapp_url_button", title, value: clean(button?.url) } : null;
  if (type === "call") return title ? { type: "whatsapp_call_button", title, value: clean(button?.phoneNumber) } : null;
  if (type === "copy") return { type: "whatsapp_copy_button", title, value: clean(button?.copyCode) };
  return title ? { type: "whatsapp_reply_button", id: clean(button?.id || button?.buttonId), title } : null;
};

/*
 * Our own request to /message/sendButtons, /message/sendList or /message/sendCarousel — the shape
 * whatsappGatewayService builds, so the endpoint says which one it is.
 */
export const partsFromEvolutionRequest = (endpoint = "", body = {}) => {
  const value = asObject(body);
  const kind = (clean(endpoint).match(/\/message\/send(Buttons|List|Carousel)\//i) || [])[1]?.toLowerCase() || "";
  const actions = [];
  if (kind === "buttons") {
    if (clean(value.title)) actions.push({ type: "whatsapp_header", title: clean(value.title) });
    if (clean(value.footer)) actions.push({ type: "whatsapp_footer", title: clean(value.footer) });
    asArray(value.buttons).forEach((button) => {
      const action = evolutionButtonAction(button);
      if (action) actions.push(action);
    });
    return parts({ message: value.description, actions });
  }
  if (kind === "list") {
    if (clean(value.title)) actions.push({ type: "whatsapp_header", title: clean(value.title) });
    if (clean(value.footerText)) actions.push({ type: "whatsapp_footer", title: clean(value.footerText) });
    actions.push({ type: "whatsapp_list_button", title: clean(value.buttonText) });
    asArray(value.sections).forEach((section) => {
      asArray(section?.rows).forEach((row) => {
        const title = clean(row?.title);
        if (title) actions.push({ type: "whatsapp_list_row", id: clean(row?.rowId || row?.id), title, description: clean(row?.description), section: clean(section?.title) });
      });
    });
    return parts({ message: value.description, actions });
  }
  if (kind === "carousel") {
    asArray(value.cards).forEach((card) => {
      asArray(card?.buttons).forEach((button) => {
        const action = evolutionButtonAction(button);
        if (action) actions.push(action);
      });
    });
    return parts({ message: value.body, actions });
  }
  return parts();
};

/* ── The registry: message id → what it went out with ──────────────────────────────────────── */

const SENT_TTL_MS = 30 * 60 * 1000;
const MAX_ENTRIES = 5000;
const sentById = new Map();
// Outbound rows written with no buttons while the send's answer was still being read.
const waitingRows = new Map();
let patchStoredRow = null;

const prune = (map) => {
  const now = Date.now();
  for (const [key, entry] of map) {
    if (entry.expiresAt > now && map.size <= MAX_ENTRIES) break;
    map.delete(key);
  }
};

// aiSupportLogService registers how to patch a stored row; kept out of here so this file stays pure.
export const setSentButtonsRowPatcher = (patcher) => {
  patchStoredRow = typeof patcher === "function" ? patcher : null;
};

export const rememberSentMessageButtons = (messageId = "", sent = {}) => {
  const id = clean(messageId);
  const value = parts(sent);
  if (!id || !value.actions.length) return false;
  sentById.set(id, { ...value, expiresAt: Date.now() + SENT_TTL_MS });
  prune(sentById);
  const waiting = waitingRows.get(id);
  if (waiting && patchStoredRow) {
    waitingRows.delete(id);
    Promise.resolve(patchStoredRow({ ...waiting, actions: value.actions })).catch(() => {});
  }
  return true;
};

export const recallSentMessageButtons = (messageId = "") => {
  const entry = sentById.get(clean(messageId));
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    sentById.delete(clean(messageId));
    return null;
  }
  return { message: entry.message, actions: entry.actions, attachments: entry.attachments };
};

export const noteRowAwaitingSentButtons = (messageId = "", row = {}) => {
  const id = clean(messageId);
  if (!id || !row?.id) return;
  waitingRows.set(id, { rowId: row.id, tenantId: row.tenant_id ?? null, sessionId: clean(row.session_id), text: clean(row.message_text), expiresAt: Date.now() + SENT_TTL_MS });
  prune(waitingRows);
};

/*
 * The sent buttons, folded into what a row already carries. The row keeps its own entries (the AI's
 * internal hints are bare strings); a header or footer the writer already printed inside the text is
 * not drawn a second time.
 */
export const mergeSentButtons = (existing = [], sentActions = [], text = "") => {
  const current = asArray(existing);
  if (hasTranscriptButtons(current)) return current;
  const body = clean(text);
  const additions = asArray(sentActions).filter((action) => {
    if (!isTranscriptAction(action)) return false;
    const title = clean(action.title);
    if (action.type === "whatsapp_header" && title && body.startsWith(title)) return false;
    if (action.type === "whatsapp_footer" && title && body.endsWith(title)) return false;
    return true;
  });
  return additions.length ? [...current, ...additions] : current;
};

export const resetSentMessageButtonsForTests = () => {
  sentById.clear();
  waitingRows.clear();
};

/* ── The wire ──────────────────────────────────────────────────────────────────────────────── */

const GRAPH_SEND = /^https:\/\/graph\.(facebook|instagram)\.com\/[^?#]*\/(messages|private_replies)(?:[?#]|$)/i;
const EVOLUTION_SEND = /\/message\/send(Buttons|List|Carousel)\//i;

const parseJson = (value) => {
  try {
    return typeof value === "string" ? JSON.parse(value) : null;
  } catch {
    return null;
  }
};

// A Graph body is JSON, or a form whose `message` field is itself JSON.
const requestBodyObject = (body) => {
  if (!body) return null;
  if (typeof body === "string") return parseJson(body) || requestBodyObject(new URLSearchParams(body));
  if (body instanceof URLSearchParams) {
    const message = parseJson(body.get("message"));
    if (message) return { message };
    if (body.get("messaging_product")) return Object.fromEntries(body.entries());
    return null;
  }
  return asObject(body);
};

export const sentMessageIdFromResponse = (value = {}) => {
  const body = asObject(value);
  return clean(
    body.messages?.[0]?.id
    || body.message_id
    || body.key?.id
    || body.result?.key?.id
    || body.result?.message_id
    || body.data?.key?.id
    || ""
  );
};

let templateLookup = async ({ name = "", language = "" } = {}) => {
  if (!name) return null;
  const { default: db } = await import("../database/db.js");
  const { rows } = await db.query(
    `SELECT header_format, header_text, header_example, header_media_url, body_text, footer_text, buttons
       FROM whatsapp_message_templates
      WHERE name = $1 AND ($2 = '' OR language = $2)
      ORDER BY (status = 'APPROVED') DESC, updated_at DESC
      LIMIT 1`,
    [name, language]
  );
  return rows[0] || null;
};

export const setSentTemplateLookupForTests = (lookup) => {
  templateLookup = lookup;
};

// What one send went out with, or null when the request was not a send this file can read.
export const partsFromSentRequest = async ({ url = "", body = null } = {}) => {
  const target = clean(url);
  if (EVOLUTION_SEND.test(target)) return partsFromEvolutionRequest(target, requestBodyObject(body));
  if (!GRAPH_SEND.test(target)) return null;
  const request = requestBodyObject(body);
  if (!request) return null;
  if (clean(request.messaging_product).toLowerCase() === "whatsapp" || (request.to && !request.recipient)) return partsFromCloudMessage(request, { lookupTemplate: templateLookup });
  return request.message ? partsFromMetaMessage(request.message) : null;
};

// `copy` is a clone of the provider's answer, taken before the caller read the original.
export const observeSentRequest = async ({ url = "", body = null, copy = null } = {}) => {
  const answer = copy ? await copy.json().catch(() => null) : null;
  const messageId = sentMessageIdFromResponse(answer);
  if (!messageId) return false;
  const sent = await partsFromSentRequest({ url, body });
  return sent ? rememberSentMessageButtons(messageId, sent) : false;
};

let observerInstalled = false;
export const installSentMessageButtonsObserver = () => {
  if (observerInstalled || typeof globalThis.fetch !== "function") return false;
  observerInstalled = true;
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async function sentButtonsFetch(input, init) {
    const response = await previousFetch(input, init);
    try {
      const url = typeof input === "string" ? input : input?.url || String(input || "");
      const method = clean(init?.method || input?.method || "GET").toUpperCase();
      if (response.ok && method === "POST" && (GRAPH_SEND.test(url) || EVOLUTION_SEND.test(url))) {
        // Cloned now, read in the background: the caller's own read of the response is untouched.
        const copy = response.clone();
        void observeSentRequest({ url, body: init?.body, copy }).catch(() => {});
      }
    } catch {
      // Watching a send never fails it.
    }
    return response;
  };
  return true;
};
