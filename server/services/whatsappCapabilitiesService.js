/**
 * The other half of the Evolution API.
 *
 * `whatsappGatewayService` grew around one job — deliver a sales conversation — so it
 * speaks exactly the five verbs that job needed: text, media, buttons, list, reaction.
 * Everything else Evolution exposes (presence, read receipts, number checks, polls,
 * locations, contact cards, labels, groups, instance settings) was never called once,
 * which is why a customer never sees "بيكتب…", never gets a blue tick, and why an order
 * confirmation is still sent to a number that has no WhatsApp account at all.
 *
 * This module is deliberately a SEPARATE file rather than more lines in the 7k-line
 * gateway service, and it imports nothing from it — the gateway imports *this* for the
 * presence/read/transcription wiring, so the dependency has to run one way only.
 *
 * Contract for everything in here:
 *
 * 1. It addresses a chat the same way the gateway does: a LID customer has no phone, so
 *    `<lid>@lid` is the only thing that reaches them. Scraping digits out of a LID mints
 *    a fake number that lands the message in a stranger's conversation.
 * 2. A raw call throws a readable gateway error (`EVOLUTION_API_ERROR` with Evolution's
 *    own reason), so a route can surface why WhatsApp refused.
 * 3. Anything the reply path calls in-line has a `safe*` twin that never throws and never
 *    blocks: a typing indicator that fails must not cost the customer their answer.
 * 4. Cloud API numbers are refused explicitly. Almost none of this exists on Graph, and a
 *    silent no-op on a `cloud:` instance reads as a broken feature rather than an
 *    unsupported transport.
 */
import { normalizeWhatsappLid, normalizeWhatsappRemoteJid } from "../utils/whatsappIdentity.js";

const text = (value = "", fallback = "") => String(value ?? fallback).trim();
const asArray = (value) => (Array.isArray(value) ? value : []);
const number = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const capabilityError = (message, code = "WHATSAPP_CAPABILITY_ERROR", status = 500, extra = {}) =>
  Object.assign(new Error(message), { code, status, ...extra });

/* ==========================================================================================
 * Plumbing
 * ========================================================================================== */

const apiUrl = () => text(process.env.EVOLUTION_API_URL).replace(/\/+$/g, "");
const apiKey = () => text(process.env.EVOLUTION_API_KEY);
const defaultInstance = () =>
  text(process.env.WHATSAPP_INSTANCE_NAME) || text(process.env.EVOLUTION_INSTANCE_NAME) || "m1-store";

const CLOUD_INSTANCE_PREFIX = "cloud:";

/**
 * Which Evolution instance a call runs against.
 *
 * `instance` is the same argument that threads through every send path from the
 * multi-number work: a plain name is an Evolution instance, `cloud:<id>` is a Meta Cloud
 * number, and empty means the env default.
 */
const requireEvolutionInstance = (instance = "") => {
  const selected = text(instance);
  if (selected.toLowerCase().startsWith(CLOUD_INSTANCE_PREFIX)) {
    throw capabilityError(
      "This WhatsApp capability exists only on an Evolution number, not on Cloud API",
      "WHATSAPP_CAPABILITY_CLOUD_UNSUPPORTED",
      409
    );
  }
  if (!apiUrl()) throw capabilityError("EVOLUTION_API_URL is not configured", "EVOLUTION_API_URL_MISSING", 409);
  if (!apiKey()) throw capabilityError("EVOLUTION_API_KEY is not configured", "EVOLUTION_API_KEY_MISSING", 409);
  const instanceName = selected || defaultInstance();
  if (!instanceName) {
    throw capabilityError("EVOLUTION_INSTANCE_NAME is not configured", "EVOLUTION_INSTANCE_MISSING", 409);
  }
  return instanceName;
};

/*
 * Evolution answers a refusal with `{status, error, response: {message}}`, where `error`
 * is only the HTTP reason phrase and `response.message` carries the reason the call was
 * actually rejected. Read the detail first — the gateway service learned this the hard
 * way, with every failure reaching the logs as the bare words "Bad Request".
 */
const evolutionErrorMessage = (data, status) => {
  const detail = data?.response?.message ?? data?.response?.error ?? data?.message;
  const flattened = (Array.isArray(detail) ? detail : [detail])
    .map((entry) => {
      if (!entry) return "";
      if (typeof entry === "string") return entry.trim();
      return text(entry.message || entry.error || "") || JSON.stringify(entry);
    })
    .filter(Boolean)
    .join("; ");
  if (flattened) return flattened;
  const reason = text(data?.error);
  return reason ? `Evolution API returned ${status} (${reason})` : `Evolution API returned ${status}`;
};

// Every call is bounded. An unbounded fetch against a gateway whose socket has died is how
// a single stuck request becomes a stuck reply path.
const DEFAULT_TIMEOUT_MS = 15_000;

const evolutionCall = async (path, { method = "POST", body = null, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) => {
  const url = `${apiUrl()}${path.startsWith("/") ? path : `/${path}`}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(number(timeoutMs, DEFAULT_TIMEOUT_MS), 1000));
  let response;
  try {
    response = await fetch(url, {
      method,
      signal: controller.signal,
      headers: { apikey: apiKey(), "Content-Type": "application/json" },
      ...(body === null || body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (error) {
    clearTimeout(timer);
    if (error?.name === "AbortError") {
      throw capabilityError(`Evolution API did not answer within ${timeoutMs}ms`, "EVOLUTION_API_TIMEOUT", 504, { path });
    }
    throw capabilityError(error?.message || String(error), "EVOLUTION_API_UNREACHABLE", 502, { path });
  } finally {
    clearTimeout(timer);
  }
  const raw = await response.text();
  let data;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    // Evolution answers some refusals with plain text. Keeping the body under `raw` means the
    // reason still reaches the operator instead of being thrown away as unparseable.
    data = { raw };
  }
  if (!response.ok) {
    throw capabilityError(evolutionErrorMessage(data, response.status), "EVOLUTION_API_ERROR", response.status, {
      data,
      raw,
      path,
    });
  }
  return data;
};

const endpoint = (segment, instanceName) => `${segment}/${encodeURIComponent(instanceName)}`;

/* ==========================================================================================
 * Addressing
 *
 * One rule, applied everywhere: a LID chat travels as `<lid>@lid`, a phone chat as bare
 * digits. Evolution accepts both in the `number` field.
 * ========================================================================================== */

const normalizeEgyptPhone = (phone = "") => {
  const raw = text(phone).replace(/^whatsapp:/i, "");
  if (/@lid$/i.test(raw) || /^lid:/i.test(raw)) return "";
  const localPart = raw.includes("@") ? raw.split("@")[0] : raw;
  if (/[A-Za-z]/.test(localPart)) return "";
  let digits = localPart.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("20") && digits.length === 12) return digits;
  if (digits.startsWith("0") && digits.length === 11) return `20${digits.slice(1)}`;
  if (digits.startsWith("1") && digits.length === 10) return `20${digits}`;
  if (digits.length < 8 || digits.length > 15) return "";
  return digits;
};

export const resolveSendTarget = (value = "") => {
  const lid = normalizeWhatsappLid(value);
  if (lid) return `${lid}@lid`;
  const phone = normalizeEgyptPhone(value);
  return phone;
};

export const resolveChatJid = (value = "") => {
  const normalized = normalizeWhatsappRemoteJid(value);
  if (normalized) return normalized;
  const stripped = text(value).replace(/^whatsapp:/i, "");
  if (stripped.includes("@")) return stripped;
  const phone = normalizeEgyptPhone(stripped);
  return phone ? `${phone}@s.whatsapp.net` : "";
};

const requireTarget = (value, codePrefix) => {
  const target = resolveSendTarget(value);
  if (!target) throw capabilityError("A valid WhatsApp target is required", `${codePrefix}_TARGET_REQUIRED`, 400);
  return target;
};

/* ==========================================================================================
 * 1. Presence — "بيكتب…" / "بيسجل صوت…"
 *
 * The single clearest tell that a reply was written by a machine is that it appears with no
 * warning at all. A human types; the customer watches them type. Evolution exposes exactly
 * that, and we had never called it.
 * ========================================================================================== */

export const WHATSAPP_PRESENCE = Object.freeze({
  TYPING: "composing",
  RECORDING: "recording",
  PAUSED: "paused",
  ONLINE: "available",
  OFFLINE: "unavailable",
});

const VALID_PRESENCE = new Set(Object.values(WHATSAPP_PRESENCE));

/**
 * @param delayMs how long Evolution holds the indicator before clearing it. Held too long
 *   it outlives the reply and the customer watches a bot "type" at an empty chat, so it is
 *   capped rather than passed through.
 */
export const sendWhatsappPresence = async ({
  phone = "",
  presence = WHATSAPP_PRESENCE.TYPING,
  delayMs = 1200,
  instance = "",
} = {}) => {
  const instanceName = requireEvolutionInstance(instance);
  const target = requireTarget(phone, "WHATSAPP_PRESENCE");
  const state = text(presence).toLowerCase();
  if (!VALID_PRESENCE.has(state)) {
    throw capabilityError(`Unsupported presence "${presence}"`, "WHATSAPP_PRESENCE_UNSUPPORTED", 400);
  }
  const delay = Math.min(Math.max(number(delayMs, 1200), 0), 20_000);
  const result = await evolutionCall(endpoint("/chat/sendPresence", instanceName), {
    body: { number: target, delay, presence: state },
    timeoutMs: 8000,
  });
  return { success: true, instanceName, target, presence: state, delay, result };
};

/**
 * The version the reply path calls. Presence is decoration: it must never throw into a
 * send, and it must never make the customer wait for their answer.
 */
export const safeSendWhatsappPresence = async (options = {}) => {
  try {
    return await sendWhatsappPresence(options);
  } catch (error) {
    console.warn("[whatsapp-capabilities] presence skipped", {
      presence: text(options?.presence) || WHATSAPP_PRESENCE.TYPING,
      code: error?.code || "",
      message: error?.message || String(error),
    });
    return { success: false, reason: error?.code || "presence_failed" };
  }
};

/* ==========================================================================================
 * 2. Read receipts
 *
 * Until now the customer's message sat on two grey ticks forever — including the ones the
 * assistant had already read, understood and answered. The blue tick is the cheapest
 * possible "we are here".
 * ========================================================================================== */

export const markWhatsappMessagesRead = async ({ messages = [], instance = "" } = {}) => {
  const instanceName = requireEvolutionInstance(instance);
  const readMessages = asArray(messages)
    .map((entry) => {
      const remoteJid = resolveChatJid(entry?.remoteJid || entry?.remote_jid || entry?.chatJid);
      const id = text(entry?.id || entry?.messageId || entry?.message_id);
      if (!remoteJid || !id) return null;
      return { remoteJid, fromMe: entry?.fromMe === true, id };
    })
    .filter(Boolean);
  if (!readMessages.length) {
    throw capabilityError("At least one message key is required", "WHATSAPP_READ_MESSAGES_REQUIRED", 400);
  }
  const result = await evolutionCall(endpoint("/chat/markMessageAsRead", instanceName), {
    body: { readMessages },
    timeoutMs: 8000,
  });
  return { success: true, instanceName, count: readMessages.length, result };
};

export const safeMarkWhatsappMessagesRead = async (options = {}) => {
  try {
    return await markWhatsappMessagesRead(options);
  } catch (error) {
    console.warn("[whatsapp-capabilities] read receipt skipped", {
      code: error?.code || "",
      message: error?.message || String(error),
    });
    return { success: false, reason: error?.code || "read_receipt_failed" };
  }
};

/* ==========================================================================================
 * 3. Does this number have WhatsApp at all?
 *
 * Order confirmations, shipping notices and abandoned-cart reminders are all sent to a
 * number a human typed into the POS. A landline, a typo, a number that simply never
 * installed WhatsApp — each one is currently a queued send, a retry cycle and a delivery
 * status nobody can explain. One call answers it up front.
 *
 * Cached, because the same customer is checked again on every order, and the answer only
 * changes when somebody installs or uninstalls WhatsApp.
 */
const numberExistsCache = new Map();
const NUMBER_EXISTS_TTL_MS = 24 * 60 * 60 * 1000;

const cachedExistence = (phone) => {
  const entry = numberExistsCache.get(phone);
  if (!entry) return null;
  if (Date.now() - entry.at > NUMBER_EXISTS_TTL_MS) {
    numberExistsCache.delete(phone);
    return null;
  }
  return entry;
};

export const checkWhatsappNumbers = async ({ phones = [], instance = "", useCache = true, timeoutMs = 12_000 } = {}) => {
  const instanceName = requireEvolutionInstance(instance);
  const requested = asArray(phones).map(normalizeEgyptPhone).filter(Boolean);
  const unique = [...new Set(requested)];
  if (!unique.length) throw capabilityError("At least one phone number is required", "WHATSAPP_NUMBERS_REQUIRED", 400);

  const answers = new Map();
  const toAsk = [];
  for (const phone of unique) {
    const cached = useCache ? cachedExistence(phone) : null;
    if (cached) answers.set(phone, { phone, exists: cached.exists, jid: cached.jid, cached: true });
    else toAsk.push(phone);
  }

  if (toAsk.length) {
    const result = await evolutionCall(endpoint("/chat/whatsappNumbers", instanceName), {
      body: { numbers: toAsk },
      timeoutMs,
    });
    const rows = Array.isArray(result) ? result : asArray(result?.data ?? result?.numbers);
    for (const row of rows) {
      const phone = normalizeEgyptPhone(row?.number || row?.jid || "");
      if (!phone) continue;
      const exists = row?.exists === true || row?.exists === "true";
      const jid = text(row?.jid);
      numberExistsCache.set(phone, { exists, jid, at: Date.now() });
      answers.set(phone, { phone, exists, jid, cached: false });
    }
    // A number Evolution simply did not answer for is UNKNOWN, not absent. Recording it as
    // absent would silently stop sending to a customer who does have WhatsApp.
    for (const phone of toAsk) {
      if (!answers.has(phone)) answers.set(phone, { phone, exists: null, jid: "", cached: false });
    }
  }

  return { success: true, instanceName, results: unique.map((phone) => answers.get(phone)) };
};

/**
 * One number, reduced to the question the send path actually asks.
 *
 * Returns `true` when the check could not run at all — an unreachable gateway must not
 * become a reason to stop messaging customers. Only a definite "this number is not on
 * WhatsApp" blocks a send.
 */
export const whatsappNumberIsReachable = async ({ phone = "", instance = "" } = {}) => {
  const normalized = normalizeEgyptPhone(phone);
  if (!normalized) return { reachable: false, known: true, reason: "invalid_phone" };
  try {
    // Deliberately impatient. This runs inside order creation, and the Evolution session
    // does go down: a 12-second wait for a check that fails open would be paid by the
    // cashier standing at the counter, on every order, for no answer at all.
    const { results } = await checkWhatsappNumbers({
      phones: [normalized],
      instance,
      timeoutMs: Math.max(Number(process.env.WHATSAPP_NUMBER_CHECK_TIMEOUT_MS || 3500), 1000),
    });
    const row = results?.[0];
    if (!row || row.exists === null) return { reachable: true, known: false, reason: "unknown" };
    return { reachable: row.exists === true, known: true, reason: row.exists ? "on_whatsapp" : "not_on_whatsapp", jid: row.jid };
  } catch (error) {
    console.warn("[whatsapp-capabilities] number check skipped", {
      code: error?.code || "",
      message: error?.message || String(error),
    });
    return { reachable: true, known: false, reason: "check_failed" };
  }
};

/* ==========================================================================================
 * 4. The message types we never sent
 * ========================================================================================== */

/**
 * A voice note.
 *
 * `audio` is a public URL or base64. `encoding: true` asks Evolution to transcode to the
 * Opus/OGG WhatsApp actually renders as a playable voice bubble — without it an mp3 arrives
 * as a file attachment, which is not the same message at all.
 */
export const sendWhatsappVoiceNote = async ({ phone = "", audio = "", instance = "", delayMs = 0, encode = true } = {}) => {
  const instanceName = requireEvolutionInstance(instance);
  const target = requireTarget(phone, "WHATSAPP_AUDIO");
  const source = text(audio);
  if (!source) throw capabilityError("An audio url or base64 payload is required", "WHATSAPP_AUDIO_REQUIRED", 400);
  const result = await evolutionCall(endpoint("/message/sendWhatsAppAudio", instanceName), {
    body: { number: target, audio: source, encoding: encode !== false, ...(delayMs ? { delay: number(delayMs, 0) } : {}) },
    timeoutMs: 40_000,
  });
  return { success: true, instanceName, target, result };
};

/**
 * A poll.
 *
 * WhatsApp caps a poll at 12 options and refuses a `selectableCount` larger than the
 * option list, so both are clamped here rather than handed to the customer as a raw
 * Evolution rejection.
 */
export const sendWhatsappPoll = async ({ phone = "", question = "", options = [], selectableCount = 1, instance = "" } = {}) => {
  const instanceName = requireEvolutionInstance(instance);
  const target = requireTarget(phone, "WHATSAPP_POLL");
  const name = text(question);
  const values = [...new Set(asArray(options).map((option) => text(option)).filter(Boolean))].slice(0, 12);
  if (!name) throw capabilityError("A poll question is required", "WHATSAPP_POLL_QUESTION_REQUIRED", 400);
  if (values.length < 2) throw capabilityError("A poll needs at least two distinct options", "WHATSAPP_POLL_OPTIONS_REQUIRED", 400);
  const selectable = Math.min(Math.max(number(selectableCount, 1), 1), values.length);
  const result = await evolutionCall(endpoint("/message/sendPoll", instanceName), {
    body: { number: target, name, selectableCount: selectable, values },
    timeoutMs: 20_000,
  });
  return { success: true, instanceName, target, question: name, options: values, selectableCount: selectable, result };
};

export const sendWhatsappLocation = async ({
  phone = "",
  latitude,
  longitude,
  name = "",
  address = "",
  instance = "",
} = {}) => {
  const instanceName = requireEvolutionInstance(instance);
  const target = requireTarget(phone, "WHATSAPP_LOCATION");
  const lat = number(latitude, NaN);
  const lng = number(longitude, NaN);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw capabilityError("A latitude and longitude are required", "WHATSAPP_LOCATION_COORDS_REQUIRED", 400);
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    throw capabilityError("Latitude/longitude out of range", "WHATSAPP_LOCATION_COORDS_INVALID", 400);
  }
  const result = await evolutionCall(endpoint("/message/sendLocation", instanceName), {
    body: { number: target, name: text(name), address: text(address), latitude: lat, longitude: lng },
    timeoutMs: 20_000,
  });
  return { success: true, instanceName, target, latitude: lat, longitude: lng, result };
};

/**
 * A contact card — the delivery rider's number, the branch line.
 *
 * `wuid` is the WhatsApp id (bare digits); `phoneNumber` is what the card displays. Both
 * are derived from the same input so a caller cannot accidentally publish one number and
 * link another.
 */
export const sendWhatsappContactCard = async ({ phone = "", contacts = [], instance = "" } = {}) => {
  const instanceName = requireEvolutionInstance(instance);
  const target = requireTarget(phone, "WHATSAPP_CONTACT");
  const contact = asArray(contacts)
    .map((entry) => {
      const digits = normalizeEgyptPhone(entry?.phone || entry?.number || entry?.phoneNumber);
      const fullName = text(entry?.fullName || entry?.name);
      if (!digits || !fullName) return null;
      return {
        fullName,
        wuid: digits,
        phoneNumber: `+${digits}`,
        ...(text(entry?.organization) ? { organization: text(entry.organization) } : {}),
        ...(text(entry?.email) ? { email: text(entry.email) } : {}),
        ...(text(entry?.url) ? { url: text(entry.url) } : {}),
      };
    })
    .filter(Boolean);
  if (!contact.length) {
    throw capabilityError("At least one contact with a name and phone is required", "WHATSAPP_CONTACT_REQUIRED", 400);
  }
  const result = await evolutionCall(endpoint("/message/sendContact", instanceName), {
    body: { number: target, contact },
    timeoutMs: 20_000,
  });
  return { success: true, instanceName, target, count: contact.length, result };
};

export const sendWhatsappSticker = async ({ phone = "", sticker = "", instance = "" } = {}) => {
  const instanceName = requireEvolutionInstance(instance);
  const target = requireTarget(phone, "WHATSAPP_STICKER");
  const source = text(sticker);
  if (!source) throw capabilityError("A sticker url or base64 payload is required", "WHATSAPP_STICKER_REQUIRED", 400);
  const result = await evolutionCall(endpoint("/message/sendSticker", instanceName), {
    body: { number: target, sticker: source },
    timeoutMs: 30_000,
  });
  return { success: true, instanceName, target, result };
};

/** A round video note. Same transport as a video, different render. */
export const sendWhatsappVideoNote = async ({ phone = "", video = "", instance = "" } = {}) => {
  const instanceName = requireEvolutionInstance(instance);
  const target = requireTarget(phone, "WHATSAPP_PTV");
  const source = text(video);
  if (!source) throw capabilityError("A video url or base64 payload is required", "WHATSAPP_PTV_REQUIRED", 400);
  const result = await evolutionCall(endpoint("/message/sendPtv", instanceName), {
    body: { number: target, video: source },
    timeoutMs: 60_000,
  });
  return { success: true, instanceName, target, result };
};

/**
 * A WhatsApp Status (story).
 *
 * `allContacts: true` publishes to every contact in the phone's address book. That is a
 * broadcast to the entire customer list, so it is never the default — a caller has to ask
 * for it, and otherwise supplies the exact recipients.
 */
export const sendWhatsappStatus = async ({
  type = "text",
  content = "",
  caption = "",
  backgroundColor = "#000000",
  font = 1,
  allContacts = false,
  recipients = [],
  instance = "",
} = {}) => {
  const instanceName = requireEvolutionInstance(instance);
  const statusType = text(type).toLowerCase() || "text";
  if (!["text", "image", "video", "audio"].includes(statusType)) {
    throw capabilityError(`Unsupported status type "${type}"`, "WHATSAPP_STATUS_TYPE_UNSUPPORTED", 400);
  }
  const body = text(content);
  if (!body) throw capabilityError("Status content is required", "WHATSAPP_STATUS_CONTENT_REQUIRED", 400);
  const statusJidList = asArray(recipients)
    .map((entry) => {
      const digits = normalizeEgyptPhone(entry);
      return digits ? `${digits}@s.whatsapp.net` : "";
    })
    .filter(Boolean);
  if (allContacts !== true && !statusJidList.length) {
    throw capabilityError(
      "A status needs recipients, or allContacts explicitly set",
      "WHATSAPP_STATUS_RECIPIENTS_REQUIRED",
      400
    );
  }
  const result = await evolutionCall(endpoint("/message/sendStatus", instanceName), {
    body: {
      type: statusType,
      content: body,
      ...(statusType === "text" ? { backgroundColor: text(backgroundColor) || "#000000", font: number(font, 1) } : {}),
      ...(statusType !== "text" && text(caption) ? { caption: text(caption) } : {}),
      allContacts: allContacts === true,
      ...(statusJidList.length ? { statusJidList } : {}),
    },
    timeoutMs: 60_000,
  });
  return { success: true, instanceName, type: statusType, recipients: statusJidList.length, allContacts: allContacts === true, result };
};

/* ==========================================================================================
 * 5. Chat operations
 * ========================================================================================== */

export const archiveWhatsappChat = async ({ chatJid = "", lastMessageId = "", fromMe = false, archive = true, instance = "" } = {}) => {
  const instanceName = requireEvolutionInstance(instance);
  const jid = resolveChatJid(chatJid);
  if (!jid) throw capabilityError("A chat is required", "WHATSAPP_ARCHIVE_CHAT_REQUIRED", 400);
  const id = text(lastMessageId);
  if (!id) throw capabilityError("The chat's last message id is required", "WHATSAPP_ARCHIVE_MESSAGE_REQUIRED", 400);
  const result = await evolutionCall(endpoint("/chat/archiveChat", instanceName), {
    body: { chat: jid, archive: archive !== false, lastMessage: { key: { remoteJid: jid, fromMe: fromMe === true, id } } },
    timeoutMs: 10_000,
  });
  return { success: true, instanceName, chat: jid, archived: archive !== false, result };
};

export const markWhatsappChatUnread = async ({ chatJid = "", lastMessageId = "", fromMe = false, instance = "" } = {}) => {
  const instanceName = requireEvolutionInstance(instance);
  const jid = resolveChatJid(chatJid);
  if (!jid) throw capabilityError("A chat is required", "WHATSAPP_UNREAD_CHAT_REQUIRED", 400);
  const id = text(lastMessageId);
  if (!id) throw capabilityError("The chat's last message id is required", "WHATSAPP_UNREAD_MESSAGE_REQUIRED", 400);
  const result = await evolutionCall(endpoint("/chat/markChatUnread", instanceName), {
    body: { chat: jid, lastMessage: { key: { remoteJid: jid, fromMe: fromMe === true, id } } },
    timeoutMs: 10_000,
  });
  return { success: true, instanceName, chat: jid, result };
};

/**
 * Delete for everyone.
 *
 * The gateway can already EDIT one of our messages within WhatsApp's 15-minute window;
 * it could never recall one. A wrong price quoted to a customer had to stand.
 */
export const deleteWhatsappMessageForEveryone = async ({
  chatJid = "",
  messageId = "",
  fromMe = true,
  participant = "",
  instance = "",
} = {}) => {
  const instanceName = requireEvolutionInstance(instance);
  const jid = resolveChatJid(chatJid);
  const id = text(messageId);
  if (!jid) throw capabilityError("A chat is required", "WHATSAPP_DELETE_CHAT_REQUIRED", 400);
  if (!id) throw capabilityError("A message id is required", "WHATSAPP_DELETE_MESSAGE_REQUIRED", 400);
  const result = await evolutionCall(endpoint("/chat/deleteMessageForEveryone", instanceName), {
    method: "DELETE",
    body: { id, remoteJid: jid, fromMe: fromMe !== false, ...(text(participant) ? { participant: text(participant) } : {}) },
    timeoutMs: 10_000,
  });
  return { success: true, instanceName, chat: jid, messageId: id, result };
};

/**
 * Block or unblock a contact.
 *
 * Under `/chat/`, not `/message/`: the live build (v2.3.7) answered `/message/updateBlockStatus`
 * with a 404, and blocking is a contact operation, which is where every other one sits —
 * archiveChat, markChatUnread, fetchProfile are all `/chat/` on this build too.
 */
export const setWhatsappBlockStatus = async ({ phone = "", blocked = true, instance = "" } = {}) => {
  const instanceName = requireEvolutionInstance(instance);
  const target = requireTarget(phone, "WHATSAPP_BLOCK");
  const result = await evolutionCall(endpoint("/chat/updateBlockStatus", instanceName), {
    body: { number: target, status: blocked === false ? "unblock" : "block" },
    timeoutMs: 10_000,
  });
  return { success: true, instanceName, target, blocked: blocked !== false, result };
};

export const fetchWhatsappProfile = async ({ phone = "", instance = "" } = {}) => {
  const instanceName = requireEvolutionInstance(instance);
  const target = requireTarget(phone, "WHATSAPP_PROFILE");
  const result = await evolutionCall(endpoint("/chat/fetchProfile", instanceName), {
    body: { number: target },
    timeoutMs: 12_000,
  });
  return { success: true, instanceName, target, profile: result };
};

export const fetchWhatsappBusinessProfile = async ({ phone = "", instance = "" } = {}) => {
  const instanceName = requireEvolutionInstance(instance);
  const target = requireTarget(phone, "WHATSAPP_BUSINESS_PROFILE");
  const result = await evolutionCall(endpoint("/chat/fetchBusinessProfile", instanceName), {
    body: { number: target },
    timeoutMs: 12_000,
  });
  return { success: true, instanceName, target, profile: result };
};

/* ==========================================================================================
 * 6. Labels
 *
 * WhatsApp Business labels are the one piece of ERP state that can be read from inside the
 * WhatsApp app itself. A staff member holding the phone sees "تم الشحن" on the chat without
 * opening anything of ours.
 * ========================================================================================== */

export const listWhatsappLabels = async ({ instance = "" } = {}) => {
  const instanceName = requireEvolutionInstance(instance);
  const result = await evolutionCall(endpoint("/label/findLabels", instanceName), {
    method: "GET",
    timeoutMs: 12_000,
  });
  const rows = Array.isArray(result) ? result : asArray(result?.labels ?? result?.data);
  return {
    success: true,
    instanceName,
    labels: rows.map((row) => ({
      id: text(row?.id ?? row?.labelId),
      name: text(row?.name),
      color: row?.color ?? null,
      predefinedId: text(row?.predefinedId ?? ""),
    })),
  };
};

export const setWhatsappChatLabel = async ({ phone = "", labelId = "", action = "add", instance = "" } = {}) => {
  const instanceName = requireEvolutionInstance(instance);
  const target = requireTarget(phone, "WHATSAPP_LABEL");
  const id = text(labelId);
  if (!id) throw capabilityError("A label id is required", "WHATSAPP_LABEL_ID_REQUIRED", 400);
  const verb = text(action).toLowerCase() === "remove" ? "remove" : "add";
  const result = await evolutionCall(endpoint("/label/handleLabel", instanceName), {
    body: { number: target, labelId: id, action: verb },
    timeoutMs: 12_000,
  });
  return { success: true, instanceName, target, labelId: id, action: verb, result };
};

/* ==========================================================================================
 * 7. Groups
 * ========================================================================================== */

export const listWhatsappGroups = async ({ instance = "", withParticipants = false } = {}) => {
  const instanceName = requireEvolutionInstance(instance);
  const result = await evolutionCall(
    `${endpoint("/group/fetchAllGroups", instanceName)}?getParticipants=${withParticipants ? "true" : "false"}`,
    { method: "GET", timeoutMs: 20_000 }
  );
  const rows = Array.isArray(result) ? result : asArray(result?.groups ?? result?.data);
  return { success: true, instanceName, groups: rows };
};

export const createWhatsappGroup = async ({ subject = "", description = "", participants = [], instance = "" } = {}) => {
  const instanceName = requireEvolutionInstance(instance);
  const title = text(subject);
  if (!title) throw capabilityError("A group subject is required", "WHATSAPP_GROUP_SUBJECT_REQUIRED", 400);
  const members = [...new Set(asArray(participants).map(normalizeEgyptPhone).filter(Boolean))];
  if (!members.length) throw capabilityError("At least one participant is required", "WHATSAPP_GROUP_PARTICIPANTS_REQUIRED", 400);
  const result = await evolutionCall(endpoint("/group/create", instanceName), {
    body: { subject: title, description: text(description), participants: members },
    timeoutMs: 30_000,
  });
  return { success: true, instanceName, subject: title, participants: members.length, result };
};

export const fetchWhatsappGroupInviteCode = async ({ groupJid = "", instance = "" } = {}) => {
  const instanceName = requireEvolutionInstance(instance);
  const jid = text(groupJid);
  if (!jid) throw capabilityError("A group jid is required", "WHATSAPP_GROUP_JID_REQUIRED", 400);
  const result = await evolutionCall(
    `${endpoint("/group/inviteCode", instanceName)}?groupJid=${encodeURIComponent(jid)}`,
    { method: "GET", timeoutMs: 12_000 }
  );
  const code = text(result?.inviteCode ?? result?.code);
  return { success: true, instanceName, groupJid: jid, inviteCode: code, inviteUrl: code ? `https://chat.whatsapp.com/${code}` : "", result };
};

export const updateWhatsappGroupParticipants = async ({ groupJid = "", action = "add", participants = [], instance = "" } = {}) => {
  const instanceName = requireEvolutionInstance(instance);
  const jid = text(groupJid);
  if (!jid) throw capabilityError("A group jid is required", "WHATSAPP_GROUP_JID_REQUIRED", 400);
  const verb = text(action).toLowerCase();
  if (!["add", "remove", "promote", "demote"].includes(verb)) {
    throw capabilityError(`Unsupported participant action "${action}"`, "WHATSAPP_GROUP_ACTION_UNSUPPORTED", 400);
  }
  const members = [...new Set(asArray(participants).map(normalizeEgyptPhone).filter(Boolean))];
  if (!members.length) throw capabilityError("At least one participant is required", "WHATSAPP_GROUP_PARTICIPANTS_REQUIRED", 400);
  const result = await evolutionCall(
    `${endpoint("/group/updateParticipant", instanceName)}?groupJid=${encodeURIComponent(jid)}`,
    { body: { action: verb, participants: members }, timeoutMs: 20_000 }
  );
  return { success: true, instanceName, groupJid: jid, action: verb, participants: members.length, result };
};

export const leaveWhatsappGroup = async ({ groupJid = "", instance = "" } = {}) => {
  const instanceName = requireEvolutionInstance(instance);
  const jid = text(groupJid);
  if (!jid) throw capabilityError("A group jid is required", "WHATSAPP_GROUP_JID_REQUIRED", 400);
  const result = await evolutionCall(
    `${endpoint("/group/leaveGroup", instanceName)}?groupJid=${encodeURIComponent(jid)}`,
    { method: "DELETE", timeoutMs: 20_000 }
  );
  return { success: true, instanceName, groupJid: jid, result };
};

/* ==========================================================================================
 * 8. Instance settings, profile and proxy
 *
 * `/settings/set` had never been called, which means the instance has been running on
 * Evolution's defaults since the day it was created. Two of those defaults matter
 * commercially: calls ring into a phone nobody answers, and the number never appears
 * online.
 * ========================================================================================== */

export const fetchWhatsappInstanceSettings = async ({ instance = "" } = {}) => {
  const instanceName = requireEvolutionInstance(instance);
  const result = await evolutionCall(endpoint("/settings/find", instanceName), { method: "GET", timeoutMs: 12_000 });
  return { success: true, instanceName, settings: result };
};

/**
 * @param rejectCall auto-decline an incoming WhatsApp call.
 * @param msgCall the apology sent when a call is declined — without it, rejecting a call
 *   is indistinguishable from ignoring the customer.
 * @param syncFullHistory deliberately defaulted OFF: turning it on makes Evolution replay
 *   the entire chat history through our webhook, and our inbound path treats each replayed
 *   message as a new one.
 */
export const applyWhatsappInstanceSettings = async ({
  rejectCall = false,
  msgCall = "",
  groupsIgnore = true,
  alwaysOnline = false,
  readMessages = false,
  readStatus = false,
  syncFullHistory = false,
  instance = "",
} = {}) => {
  const instanceName = requireEvolutionInstance(instance);
  const result = await evolutionCall(endpoint("/settings/set", instanceName), {
    body: {
      rejectCall: rejectCall === true,
      msgCall: text(msgCall),
      groupsIgnore: groupsIgnore !== false,
      alwaysOnline: alwaysOnline === true,
      readMessages: readMessages === true,
      readStatus: readStatus === true,
      syncFullHistory: syncFullHistory === true,
    },
    timeoutMs: 15_000,
  });
  return { success: true, instanceName, result };
};

export const updateWhatsappProfileStatus = async ({ status = "", instance = "" } = {}) => {
  const instanceName = requireEvolutionInstance(instance);
  const value = text(status);
  if (!value) throw capabilityError("A profile status is required", "WHATSAPP_PROFILE_STATUS_REQUIRED", 400);
  const result = await evolutionCall(endpoint("/chat/updateProfileStatus", instanceName), {
    body: { status: value },
    timeoutMs: 12_000,
  });
  return { success: true, instanceName, status: value, result };
};

export const updateWhatsappProfilePicture = async ({ pictureUrl = "", instance = "" } = {}) => {
  const instanceName = requireEvolutionInstance(instance);
  const url = text(pictureUrl);
  if (!/^https?:\/\//i.test(url)) {
    throw capabilityError("A public picture url is required", "WHATSAPP_PROFILE_PICTURE_REQUIRED", 400);
  }
  const result = await evolutionCall(endpoint("/chat/updateProfilePicture", instanceName), {
    body: { picture: url },
    timeoutMs: 30_000,
  });
  return { success: true, instanceName, result };
};

export const fetchWhatsappPrivacySettings = async ({ instance = "" } = {}) => {
  const instanceName = requireEvolutionInstance(instance);
  const result = await evolutionCall(endpoint("/chat/fetchPrivacySettings", instanceName), {
    method: "GET",
    timeoutMs: 12_000,
  });
  return { success: true, instanceName, privacy: result };
};

export const updateWhatsappPrivacySettings = async ({
  readreceipts = "all",
  profile = "all",
  status = "contacts",
  online = "all",
  last = "contacts",
  groupadd = "contacts",
  instance = "",
} = {}) => {
  const instanceName = requireEvolutionInstance(instance);
  const result = await evolutionCall(endpoint("/chat/updatePrivacySettings", instanceName), {
    body: {
      readreceipts: text(readreceipts) || "all",
      profile: text(profile) || "all",
      status: text(status) || "contacts",
      online: text(online) || "all",
      last: text(last) || "contacts",
      groupadd: text(groupadd) || "contacts",
    },
    timeoutMs: 15_000,
  });
  return { success: true, instanceName, result };
};

/**
 * Route the instance through a proxy.
 *
 * Kept because it is the only lever available when a number starts being rate-limited from
 * one egress IP — which, for a number that sends every order confirmation, is a live risk.
 */
export const setWhatsappProxy = async ({
  enabled = false,
  host = "",
  port = "",
  protocol = "http",
  username = "",
  password = "",
  instance = "",
} = {}) => {
  const instanceName = requireEvolutionInstance(instance);
  if (enabled === true && (!text(host) || !text(port))) {
    throw capabilityError("A proxy host and port are required", "WHATSAPP_PROXY_HOST_REQUIRED", 400);
  }
  const result = await evolutionCall(endpoint("/proxy/set", instanceName), {
    body: {
      enabled: enabled === true,
      proxy: {
        host: text(host),
        port: text(port),
        protocol: text(protocol) || "http",
        username: text(username),
        password: text(password),
      },
    },
    timeoutMs: 15_000,
  });
  return { success: true, instanceName, enabled: enabled === true, result };
};

export const __testing = { normalizeEgyptPhone, resolveSendTarget, resolveChatJid, evolutionErrorMessage };

export default {
  WHATSAPP_PRESENCE,
  sendWhatsappPresence,
  safeSendWhatsappPresence,
  markWhatsappMessagesRead,
  safeMarkWhatsappMessagesRead,
  checkWhatsappNumbers,
  whatsappNumberIsReachable,
  sendWhatsappVoiceNote,
  sendWhatsappPoll,
  sendWhatsappLocation,
  sendWhatsappContactCard,
  sendWhatsappSticker,
  sendWhatsappVideoNote,
  sendWhatsappStatus,
  archiveWhatsappChat,
  markWhatsappChatUnread,
  deleteWhatsappMessageForEveryone,
  setWhatsappBlockStatus,
  fetchWhatsappProfile,
  fetchWhatsappBusinessProfile,
  listWhatsappLabels,
  setWhatsappChatLabel,
  listWhatsappGroups,
  createWhatsappGroup,
  fetchWhatsappGroupInviteCode,
  updateWhatsappGroupParticipants,
  leaveWhatsappGroup,
  fetchWhatsappInstanceSettings,
  applyWhatsappInstanceSettings,
  updateWhatsappProfileStatus,
  updateWhatsappProfilePicture,
  fetchWhatsappPrivacySettings,
  updateWhatsappPrivacySettings,
  setWhatsappProxy,
};
