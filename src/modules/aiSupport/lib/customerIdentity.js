/*
 * Who is this Messenger / Instagram customer, for display.
 *
 * One order, on both inbox surfaces:
 *   1. the real profile name Meta returned (Business Asset User Profile Access)
 *   2. the name already stored on the conversation (an older capture, or one typed by staff)
 *   3. the Instagram username, shown as @handle
 *   4. the tail of the Meta-scoped user id, so two nameless customers still tell apart
 *
 * Pure: no React, no fetch, so it is unit-tested directly.
 */

const clean = (value = "") => String(value ?? "").trim();

export const isMetaScopedUserId = (value = "") => /^\d{5,}$/.test(clean(value).replace(/\s+/g, ""));

const GENERIC_NAMES = new Set([
  "customer",
  "unknown",
  "unknown customer",
  "guest",
  "anonymous",
  "commenter",
  "user",
  "عميل",
  "العميل",
  "مستخدم",
  "مستخدم instagram",
  "مستخدم ماسنجر",
  "زائر",
]);

export const isGenericMetaCustomerName = (value = "") => {
  const normalized = clean(value).toLowerCase().replace(/\s+/g, " ");
  return !normalized || GENERIC_NAMES.has(normalized);
};

const MESSAGE_LIKE = /(السلام عليكم|سلام عليكم|عليكم السلام|ممكن|عايز|عايزة|عايزه|عاوز|عاوزه|محتاج|محتاجة|محتاجه|بكام|وريني|ابعت|ابعتلي|هاتلي|فين|متاح|السعر|سعر|المقاس|مقاس|اللون|صوره|صور|عندكم|available|price|size|color)/i;

// A "name" that is really the customer's first message (a capture bug from before the
// profile API worked) must not win over a username or an id tail.
export const looksLikeMessageText = (value = "") => {
  const candidate = clean(value);
  if (!candidate) return false;
  if (candidate.length > 60) return true;
  if (/[?!؟]/.test(candidate)) return true;
  if (candidate.split(/\s+/).length > 5) return true;
  return MESSAGE_LIKE.test(candidate);
};

export const isUsableStoredName = (value = "") => {
  const candidate = clean(value);
  if (!candidate) return false;
  if (isGenericMetaCustomerName(candidate)) return false;
  if (isMetaScopedUserId(candidate)) return false;
  if (looksLikeMessageText(candidate)) return false;
  return true;
};

// A name Meta returned is authoritative: it only has to look like a name, not pass
// the message-fragment heuristics that guard names captured from chat text. Those
// rules reject real people ("Ahmed 2020", "Mohamed A.", a five-word Arabic name).
export const isPlausibleProfileName = (value = "") => {
  const candidate = clean(value).replace(/\s+/g, " ");
  if (!candidate || candidate.length > 80) return false;
  if (/[\r\n\t]/.test(candidate)) return false;
  if (isMetaScopedUserId(candidate.replace(/\s+/g, ""))) return false;
  if (isGenericMetaCustomerName(candidate)) return false;
  return /\p{L}/u.test(candidate);
};

export const metaChannelKind = (conversation = {}) => {
  const raw = clean(conversation?.channel || conversation?.source || conversation?.provider || conversation?.platform).toLowerCase();
  const threadKind = clean(conversation?.thread_kind || conversation?.channel_metadata?.thread_kind).toLowerCase();
  if (raw.includes("_comment") || threadKind === "comment") return "";
  if (raw === "instagram" || raw.includes("instagram")) return "instagram";
  if (["facebook_messenger", "facebook", "messenger"].includes(raw) || raw.includes("messenger")) return "messenger";
  return "";
};

export const isMetaDmConversation = (conversation = {}) => Boolean(metaChannelKind(conversation));

export const shortIdTail = (value = "", length = 4) => {
  const id = clean(value);
  if (!id) return "";
  return id.length <= length ? id : id.slice(-length);
};

const profileOf = (conversation = {}) => conversation?.customer_profile && typeof conversation.customer_profile === "object" ? conversation.customer_profile : {};
const metaProfileOf = (conversation = {}) => {
  const channelMetadata = conversation?.channel_metadata && typeof conversation.channel_metadata === "object" ? conversation.channel_metadata : {};
  const nested = channelMetadata.messenger_profile || channelMetadata.instagram_profile || channelMetadata.customer_profile || conversation?.customer_profile?.messenger_profile || {};
  return nested && typeof nested === "object" ? nested : {};
};

export const metaCustomerUsername = (conversation = {}) => {
  const profile = profileOf(conversation);
  const metaProfile = metaProfileOf(conversation);
  const channelMetadata = conversation?.channel_metadata || {};
  return clean(
    conversation?.customer_username ||
      profile.username ||
      metaProfile.username ||
      channelMetadata.username ||
      conversation?.username ||
      ""
  ).replace(/^@/, "");
};

// The name Meta actually returned, if any. Stored names that merely repeat an id or a
// message are not "real".
export const metaCustomerProfileName = (conversation = {}) => {
  const profile = profileOf(conversation);
  const metaProfile = metaProfileOf(conversation);
  const candidates = [
    metaProfile.name,
    metaProfile.display_name,
    [metaProfile.first_name, metaProfile.last_name].filter(Boolean).join(" "),
    profile.display_name,
    profile.facebook_name,
    profile.messenger_name,
    [profile.first_name, profile.last_name].filter(Boolean).join(" "),
    profile.name,
    conversation?.display_name,
    conversation?.facebook_name,
    conversation?.messenger_name,
  ];
  return clean(candidates.find((candidate) => isPlausibleProfileName(candidate)) || "");
};

export const metaCustomerStoredName = (conversation = {}) => {
  const candidates = [
    conversation?.customer_name,
    conversation?.customer?.name,
    conversation?.channel_metadata?.customer_name,
    conversation?.channel_metadata?.ai_memory?.customer_name,
    conversation?.metadata?.customer_name,
  ];
  return clean(candidates.find((candidate) => isUsableStoredName(candidate)) || "");
};

export const metaCustomerExternalId = (conversation = {}) => {
  const profile = profileOf(conversation);
  const channelMetadata = conversation?.channel_metadata || {};
  const sessionId = clean(conversation?.session_id || conversation?.external_conversation_id || conversation?.conversation_id || "");
  const fromSession = sessionId.includes(":") ? sessionId.slice(sessionId.lastIndexOf(":") + 1) : "";
  return clean(
    [
      conversation?.external_customer_id,
      conversation?.sender_psid,
      profile.external_customer_id,
      channelMetadata.sender_psid,
      channelMetadata.customer_psid,
      channelMetadata.psid,
      fromSession,
    ].map(clean).find((value) => isMetaScopedUserId(value)) || ""
  );
};

const ID_TAIL_LABELS = {
  instagram: { en: "Instagram", ar: "مستخدم Instagram" },
  messenger: { en: "Messenger", ar: "مستخدم ماسنجر" },
};

// { name, source } — source is one of profile | stored | username | external_id | none.
export const resolveMetaCustomerIdentity = (conversation = {}, { language = "ar" } = {}) => {
  const kind = metaChannelKind(conversation);
  const profileName = metaCustomerProfileName(conversation);
  if (profileName) return { name: profileName, source: "profile", kind };
  const storedName = metaCustomerStoredName(conversation);
  if (storedName) return { name: storedName, source: "stored", kind };
  const username = metaCustomerUsername(conversation);
  if (username) return { name: `@${username}`, source: "username", kind };
  const tail = shortIdTail(metaCustomerExternalId(conversation));
  if (tail) {
    const labels = ID_TAIL_LABELS[kind] || { en: "Meta", ar: "عميل" };
    const label = language === "en" ? labels.en : labels.ar;
    return { name: `${label} …${tail}`, source: "external_id", kind };
  }
  return { name: "", source: "none", kind };
};

export const metaCustomerDisplayName = (conversation = {}, options = {}) => resolveMetaCustomerIdentity(conversation, options).name;

// Every place a picture can live, most authoritative first.
export const metaCustomerAvatarUrl = (conversation = {}) => {
  const profile = profileOf(conversation);
  const metaProfile = metaProfileOf(conversation);
  const channelMetadata = conversation?.channel_metadata || {};
  return clean(
    [
      conversation?.customer_avatar_url,
      profile.profile_pic_url,
      profile.avatar_url,
      profile.profile_pic,
      metaProfile.profile_pic,
      metaProfile.profile_pic_url,
      channelMetadata.customer_avatar_url,
      channelMetadata.profile_pic,
      conversation?.profile_pic_url,
      conversation?.avatar_url,
    ].map(clean).find((value) => /^https?:\/\//i.test(value)) || ""
  );
};

// Picture URLs that failed to load this session. A dead URL is not retried on every
// re-render; the fallback renders straight away.
const deadAvatarUrls = new Set();
export const rememberDeadAvatar = (url = "") => {
  const key = clean(url);
  if (key) deadAvatarUrls.add(key);
};
export const isKnownDeadAvatar = (url = "") => deadAvatarUrls.has(clean(url));
export const __resetDeadAvatarsForTests = () => deadAvatarUrls.clear();

// Two letters for the placeholder when there is no picture — the first letters of
// the first two words, or the first letter when there is only one.
export const avatarInitials = (name = "") => {
  const words = clean(name).replace(/^@/, "").replace(/…/g, " ").split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word));
  if (!words.length) return "";
  const letters = words.slice(0, 2).map((word) => [...word].find((char) => /[\p{L}\p{N}]/u.test(char)) || "");
  return letters.join("").toUpperCase();
};
