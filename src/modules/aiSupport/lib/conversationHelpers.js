/*
 * Conversation helpers shared by the two AI Inbox surfaces.
 *
 * /admin/ai-inbox (AiInbox.jsx) and /inbox (AiInboxPwa.jsx) are two separate
 * implementations of the same product. They defined 70 top-level helpers under
 * the SAME NAME: 40 were the same function written twice, and the other 30 had
 * already drifted into different behaviour.
 *
 * Everything here comes from the identical set and was moved verbatim, so this
 * changes no behaviour on either surface. What it changes is the failure mode: a
 * fix to any of these now lands on both surfaces instead of one, which is how
 * the nameless-greeting guard came to exist on the private reply path and not
 * the public one.
 *
 * The helpers that DIFFER are deliberately not here, and neither is anything
 * that reaches one of them. Several are real algorithmic differences --
 * mergeMessagesByIdentity dedupes through an index map on one side and an
 * O(n^2) identity scan on the other; conversationKey derives WhatsApp identity
 * differently -- so picking a winner is a behavioural decision that belongs in
 * its own change with its own tests, not in a mechanical move.
 *
 * tests/ai-inbox-shared-helpers.test.js fails when a NEW same-named helper
 * appears in both pages, so the duplication cannot grow back meanwhile.
 */

export const asArray = (value) => (Array.isArray(value) ? value : []);

export const clean = (value = "") => String(value || "").trim();

export const GENERIC_CUSTOMER_NAMES = new Set([
  "customer",
  "customers",
  "client",
  "guest",
  "unknown",
  "anonymous",
  "user",
  "lead",
  "عميل",
  "العميل",
  "زائر",
  "مستخدم",
  "غير معروف",
  ".",
  "-",
  "n/a",
  "null",
  "undefined",
]);

export const isGenericCustomerName = (value = "") => {
  const normalized = clean(value).toLowerCase().replace(/\s+/g, " ");
  return !normalized || GENERIC_CUSTOMER_NAMES.has(normalized);
};

export const MESSAGE_LIKE_NAME_KEYWORDS = /(السلام عليكم|سلام عليكم|عليكم السلام|ممكن|عايز|عايزة|عايزه|عاوز|عاوزه|محتاج|محتاجة|محتاجه|محتاجين|بكام|بكاام|وريني|ورينى|ابعت|ابعتلي|ابعتلى|هاتلي|هاتلى|فين|متاح|السعر|سعر|المقاس|مقاس|اللون|لون|صوره|صور|عندكم|عندكو|available|price|size|color)/i;

export const looksLikeMessageName = (value = "") => {
  const normalized = clean(value);
  if (!normalized) return false;
  if (normalized.length > 40) return true;
  if (/[?!؟…]/.test(normalized)) return true;
  return MESSAGE_LIKE_NAME_KEYWORDS.test(normalized);
};

export const firstUsefulCustomerName = (...values) =>
  values.map((value) => clean(value)).find((value) => value && !isGenericCustomerName(value)) || "";

export const ENABLE_SOCIAL_FAST_CENTER = true;

export const normalizeValidationSummary = (value = {}) => {
  const validation = value && typeof value === "object" ? value : {};
  const violations = asArray(validation.violations || validation.issues || []);
  const warnings = asArray(validation.warnings || []);
  const violationsCount = Number(validation.violations_count ?? validation.violationsCount ?? violations.length ?? 0) || 0;
  const warningsCount = Number(validation.warnings_count ?? validation.warningsCount ?? warnings.length ?? 0) || 0;
  const confidence = Number(validation.confidence ?? validation.confidence_pct ?? 0);
  const confidencePercent = Number.isFinite(confidence) ? Math.max(0, Math.min(100, confidence <= 1 ? confidence * 100 : confidence)) : 0;
  const hasErrors = violations.some((item) => clean(item?.severity || "").toLowerCase() === "error");
  const status =
    clean(validation.status || validation.state || "") ||
    (violationsCount > 0 ? (hasErrors ? "خطر / تحقق قبل الإرسال" : "يحتاج مراجعة") : warningsCount > 0 ? "يحتاج مراجعة" : "آمن");
  const details = [
    ...violations.slice(0, 3).map((item) => clean(item?.message || item?.type || item)),
    ...warnings.slice(0, 3).map((item) => clean(item?.message || item?.type || item)),
  ].filter(Boolean).slice(0, 3);
  return {
    confidencePercent,
    violationsCount,
    warningsCount,
    status,
    details,
    violations,
    warnings,
  };
};

export const normalizeProductCardsValue = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
    } catch {
      return [];
    }
  }
  if (value && typeof value === "object") return [value];
  return [];
};

export const encodeConversationId = (value = "") => {
  const raw = clean(value);
  try {
    return encodeURIComponent(decodeURIComponent(raw));
  } catch {
    return encodeURIComponent(raw);
  }
};

export const buildClientRequestId = () => {
  if (typeof crypto !== "undefined" && crypto?.randomUUID) return crypto.randomUUID();
  return `req_${Date.now()}_${Math.random().toString(16).slice(2)}`;
};

export const aiInboxConversationEndpoint = (sessionId = "", suffix = "") =>
  `/ai-inbox/conversations/${encodeConversationId(sessionId)}${suffix}`;

export const aiAgentInboxEndpoint = (sessionId = "", suffix = "") =>
  `/ai-agent/inbox/${encodeConversationId(sessionId)}${suffix}`;

export const aiReplyCorrectionEndpoint = (sessionId = "", messageId = "") =>
  aiAgentInboxEndpoint(sessionId, `/messages/${encodeConversationId(messageId)}/correction`);

export const isSocialPostSummary = (item = {}) =>
  Object.prototype.hasOwnProperty.call(item, "comments_count") ||
  Object.prototype.hasOwnProperty.call(item, "new_comments_count") ||
  Object.prototype.hasOwnProperty.call(item, "last_comment_text") ||
  Object.prototype.hasOwnProperty.call(item, "post_full_picture") ||
  Object.prototype.hasOwnProperty.call(item, "full_picture");

export const isConversationAiEnabled = (conversation = {}) => conversation?.ai_enabled !== false;

export const isLikelyMessengerExternalId = (value = "") => {
  const candidate = clean(value).replace(/\s+/g, "");
  return Boolean(candidate) && /^\d{5,}$/.test(candidate);
};

export const getConversationThreadMetadata = (item = {}) => {
  const channelMetadata = item?.channel_metadata && typeof item.channel_metadata === "object" && !Array.isArray(item.channel_metadata) ? item.channel_metadata : {};
  const metadata = item?.metadata && typeof item.metadata === "object" && !Array.isArray(item.metadata) ? item.metadata : {};
  return { channelMetadata, metadata };
};

export const isUsefulCommenterName = (value = "") => {
  const name = clean(value);
  return Boolean(name) && !/^\d+$/.test(name) && !["customer", "unknown", "guest", "anonymous", "commenter", "عميل", "العميل"].includes(name.toLowerCase());
};

export const messageIdentityKeys = (message = {}) =>
  [
    clean(message.message_identity_key || message.messageIdentityKey || ""),
    clean(message.client_request_id || message.clientRequestId || ""),
    clean(message.idempotency_key || message.idempotencyKey || ""),
    clean(message.dedupe_key || message.dedupeKey || ""),
    clean(message.provider_message_id || message.providerMessageId || ""),
    clean(message.external_message_id || message.externalMessageId || ""),
    clean(message.id || ""),
  ].filter(Boolean);

export const isFromMeMessage = (message = {}) =>
  message?.from_me === true ||
  message?.fromMe === true ||
  message?.is_from_me === true;

export const transcriptDayKey = (value) => {
  const date = new Date(value || 0);
  return Number.isFinite(date.getTime()) && date.getTime() > 0 ? `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}` : "";
};

export const transcriptDayLabel = (value) => {
  const date = new Date(value || 0);
  if (!Number.isFinite(date.getTime()) || date.getTime() <= 0) return "";
  const key = transcriptDayKey(value);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (key === transcriptDayKey(today)) return "اليوم";
  if (key === transcriptDayKey(yesterday)) return "أمس";
  try {
    return new Intl.DateTimeFormat("ar-EG-u-nu-latn", { day: "numeric", month: "long", year: "numeric" }).format(date);
  } catch {
    return date.toLocaleDateString();
  }
};

export const transcriptRowTime = (row = {}) =>
  row.created_at || row.createdAt || row.timestamp || row.sent_at || row.message_created_at || row.created || row.time || "";
