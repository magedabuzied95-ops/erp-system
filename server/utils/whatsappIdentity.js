const text = (value = "", fallback = "") => String(value ?? fallback).trim();

const LID_SUFFIX = /@lid$/i;
const LID_PREFIX = /^lid:/i;
const PHONE_JID_SUFFIX = /@(?:s\.whatsapp\.net|c\.us)$/i;
// A phone identity must still look like a phone number once the JID wrapper is
// gone. Without this bound a WhatsApp username such as "@Ayamohsen180" collapses
// to the digits it happens to contain ("180") and becomes a conversation key.
const MIN_PHONE_DIGITS = 8;
const MAX_PHONE_DIGITS = 15;

const stripChannelPrefix = (value = "") => text(value).replace(/^whatsapp:/i, "");

const isLidValue = (value = "") => {
  const raw = stripChannelPrefix(value);
  return LID_SUFFIX.test(raw) || LID_PREFIX.test(raw);
};

/**
 * A WhatsApp LID is an opaque account id, not a phone number. Since the username
 * rollout it is the only identity many chats carry, so it needs its own key
 * space — scraping its digits mints a fake "phone" that collides with real
 * customers.
 */
export const normalizeWhatsappLid = (value = "") => {
  const raw = stripChannelPrefix(value);
  if (!raw) return "";
  if (LID_SUFFIX.test(raw)) return raw.replace(LID_SUFFIX, "").replace(/\D/g, "");
  if (LID_PREFIX.test(raw)) return raw.replace(LID_PREFIX, "").replace(/\D/g, "");
  return "";
};

export const isWhatsappLidValue = (value = "") => Boolean(normalizeWhatsappLid(value));

const normalizeWhatsAppDigits = (value = "") => {
  let raw = stripChannelPrefix(value);
  if (!raw) return "";
  if (isLidValue(raw)) return "";
  raw = raw.replace(PHONE_JID_SUFFIX, "");
  if (raw.includes("@")) raw = raw.split("@")[0];
  // Usernames are identities, never numbers.
  if (/[A-Za-z]/.test(raw)) return "";
  let digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("20") && digits.length === 12) return digits;
  if (digits.startsWith("0") && digits.length === 11) return `20${digits.slice(1)}`;
  if (digits.startsWith("1") && digits.length === 10) return `20${digits}`;
  if (digits.length < MIN_PHONE_DIGITS || digits.length > MAX_PHONE_DIGITS) return "";
  return digits;
};

export const normalizeWhatsappSessionId = (sessionId = "", phone = "") => {
  const candidates = [sessionId, phone];
  for (const candidate of candidates) {
    const normalized = normalizeWhatsAppDigits(candidate);
    if (normalized) return `whatsapp:${normalized}`;
  }
  // Only once no real phone is available do we fall back to the LID key space,
  // so a customer whose number we later learn merges into `whatsapp:<phone>`
  // instead of living in two threads forever.
  for (const candidate of candidates) {
    const lid = normalizeWhatsappLid(candidate);
    if (lid) return `whatsapp:lid:${lid}`;
  }
  return "";
};

export const legacyWhatsappLidSessionId = (value = "") => {
  const lid = normalizeWhatsappLid(value);
  return lid ? `whatsapp:${lid}` : "";
};

export const normalizeWhatsappRemoteJid = (value = "") => {
  const normalized = normalizeWhatsAppDigits(value);
  if (normalized) return `${normalized}@s.whatsapp.net`;
  const lid = normalizeWhatsappLid(value);
  return lid ? `${lid}@lid` : "";
};

export const normalizeWhatsappPhone = normalizeWhatsAppDigits;
